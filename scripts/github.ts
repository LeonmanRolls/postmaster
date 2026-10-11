// GitHub Issues as tickets, on a GitHub Projects board as the kanban. One board per target
// repo, linked to it and found through that link, so nothing is configured: the board's Status
// column, which every new board has as Todo, In Progress and Done, carries the flow's state,
// and closing an issue is done. GitHub has no blocked column by default, so blocked is a label
// named `blocked`, added without moving the card and removed by the next state change.
//
//   run github <repo> board                         the linked board; exit 3 when there is none
//   run github <repo> board init [title]            create a board named after the repo and
//                                                  link it; idempotent
//   run github <repo> create <title> <body-file>    new issue on the board in Todo; prints its number
//                                                  (exit 5: created, but not put on the board)
//   run github <repo> read <n> [--body]             title, state, labels, body, comments; with
//                                                  read --body prints the stored body followed by one newline
//   run github <repo> edit <n> <body-file> <base-file>
//                                                  replace the issue's body; never its title
//   run github <repo> title <n> <title>             change the issue's title
//   run github <repo> state <n> <state>             todo | in-progress | blocked | done | cancelled
//   run github <repo> label <n> add|remove <label>   add or remove a label, creating it when
//                                                  missing; a state change leaves `ready` alone
//   run github <repo> comment <n> <actor> <text>    one comment, dated to the minute, actor first
//   run github <repo> list [state]                  one line per issue: number, state, title
//   run github <repo> access                        the user's permission on the repository:
//                                                  ADMIN, MAINTAIN, WRITE, TRIAGE or READ
//   run github <repo> search <text>                 one line per issue holding the text in its
//                                                  title, body or comments: number, open or
//                                                  closed, title (GitHub's index, not exact; a
//                                                  colon or a quote in the text counts as a space)
//
// <repo> is a local checkout; the GitHub repository is read from its origin remote. Everything
// goes through the gh CLI, which must be logged in with the `project` scope
// (`gh auth refresh -s project`); scripts/run probe-trackers says whether it is.
//
// Cost: GitHub gives all tools and agents together 5,000 GraphQL points an hour, and listing a
// board of about 200 items costs about 300 of them. So a ticket's column is read from the issue's
// own project items in the one query that reads the issue, an item is found the same way, `list`
// asks for each issue's column in the query that lists the issues, and a label is added or
// removed over REST, which has a budget of its own. Nothing here lists the board.
//
// edit takes the body as it was read when the change was drafted (read --body) and refuses when
// the issue no longer matches it, so a change made in the tracker meanwhile is not lost.
//
//   exit 0  ok
//   exit 1  usage, gh missing or not logged in, no origin remote, unknown issue (a pull request
//           is not one), a body file that cannot be read or is empty, or gh failed
//   exit 2  invalid state
//   exit 3  the repo has no linked board (run: run github <repo> board init)
//   exit 4  the issue changed since the base was read
//   exit 5  create made the issue, and printed its number, but could not put it on the board
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { scriptsDir } from "./lib/paths.ts";
import { run } from "./lib/proc.ts";
import { digitValue, END_OF_STRING, pyLower, pyWords, W_CLASS } from "./lib/text.ts";
import { thrownDetail } from "./lib/thrown.ts";

const STATES = ["todo", "in-progress", "blocked", "done", "cancelled"];
const COLUMN: Record<string, string> = {
  todo: "todo",
  "in-progress": "inprogress",
  done: "done",
  cancelled: "done",
};
const BLOCKED = "blocked";
const READY = "ready";

class DieError extends Error {
  constructor(
    public readonly msg: string,
    public readonly code: number = 1,
  ) {
    super(msg);
  }
}

function dieGh(msg: string, code = 1): never {
  throw new DieError(msg, code);
}

interface Board {
  id: string;
  number: number;
  title: string;
  closed?: boolean;
  url?: string;
  owner?: { login?: string } | null;
  ownerLogin?: string;
}
interface IssueLabel {
  name: string;
}
interface IssueComment {
  body?: string;
  createdAt?: string;
  author?: { login?: string } | null;
}
interface ProjectItemNode {
  id: string;
  project?: { id?: string } | null;
  fieldValueByName?: { name?: string } | null;
}
interface Issue {
  number: number;
  title: string;
  body: string;
  state: string;
  stateReason: string | null;
  url: string;
  createdAt: string;
  labels: IssueLabel[];
  comments: IssueComment[];
  items: ProjectItemNode[];
}
interface ListItem {
  number: number;
  title: string;
  state: string;
  stateReason: string | null;
  labels: IssueLabel[];
  items: ProjectItemNode[];
}
// An issue as the read query returns it, before its node lists are flattened.
interface IssueRaw {
  number: number;
  title: string;
  body: string;
  state: string;
  stateReason: string | null;
  url: string;
  createdAt: string;
  labels?: { nodes?: IssueLabel[] };
  comments?: { nodes?: IssueComment[] };
  projectItems?: { nodes?: ProjectItemNode[] };
}
// A node of the list query, before its node lists are flattened.
interface IssueNode {
  number: number;
  title: string;
  state: string;
  stateReason?: string | null;
  labels?: { nodes?: IssueLabel[] };
  projectItems?: { nodes?: ProjectItemNode[] };
}
interface IssuesPage {
  nodes?: IssueNode[];
  pageInfo?: { hasNextPage?: boolean; endCursor: string };
}
interface BoardsData {
  data?: { repository?: { projectsV2?: { nodes?: Board[] } } };
}
interface IssueData {
  data?: { repository?: { issue?: IssueRaw } };
}
interface IssuesData {
  data?: { repository?: { issues?: IssuesPage } };
}
interface StatusFieldData {
  data?: { node?: { field?: { id?: string; options?: Array<{ id: string; name: string }> } } };
}
interface PermissionData {
  data?: { repository?: { viewerPermission?: string } };
}

// --- remote parsing ---------------------------------------------------------------------------
const REMOTE_RE = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/u;

// --- gh helper --------------------------------------------------------------------------------
function gh(argv: string[], ok: number[] = [0]): string {
  const r = run("gh", argv);
  if (!ok.includes(r.code)) {
    dieGh(`gh ${argv.slice(0, 3).join(" ")}: ${(r.err || r.out).trim().slice(0, 300)}`);
  }
  return r.out;
}

function ghj<T = unknown>(argv: string[]): T {
  const out = gh(argv);
  try {
    return JSON.parse(out) as T;
  } catch {
    dieGh(`gh ${argv.slice(0, 3).join(" ")} returned no JSON`);
  }
}

// --- the board --------------------------------------------------------------------------------
function linkedBoards(owner: string, name: string): Board[] {
  const q =
    "query($owner:String!,$name:String!){repository(owner:$owner,name:$name){" +
    "projectsV2(first:20){nodes{id number title closed url " +
    "owner{... on User{login} ... on Organization{login}}}}}}";
  const data = ghj<BoardsData>([
    "api",
    "graphql",
    "-f",
    `query=${q}`,
    "-F",
    `owner=${owner}`,
    "-F",
    `name=${name}`,
  ]);
  const nodes = data?.data?.repository?.projectsV2?.nodes ?? [];
  return nodes.filter((n) => !n.closed);
}

let REPO_DIR = "";

function trackerBinding(): string | null {
  const r = run(join(scriptsDir(import.meta), "run"), ["project-settings", "inspect", REPO_DIR]);
  if (r.code !== 0) dieGh(r.err.trim() || "cannot read the project's tracker binding");
  try {
    return JSON.parse(r.out).tracker?.binding ?? null;
  } catch (e) {
    dieGh(`project settings gave no JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function boardOf(nwo: string, owner: string, name: string): Board {
  const boards = linkedBoards(owner, name);
  if (boards.length === 0) {
    dieGh(`${nwo} has no linked board; run: run github <repo> board init`, 3);
  }
  const binding = trackerBinding();
  const named = boards.filter((b) => b.title === (binding || name));
  if (binding) {
    if (named.length === 0)
      dieGh(`the project's tracker binding '${binding}' is not a linked GitHub Projects board`);
    if (named.length > 1)
      dieGh(`the project's tracker binding '${binding}' matches more than one linked board`);
  }
  const b = boards.length > 1 && named.length > 0 ? named[0] : boards[0];
  if (!b) dieGh(`${nwo} has no linked board; run: run github <repo> board init`, 3);
  b.ownerLogin = b.owner?.login || owner;
  return b;
}

function boardInit(owner: string, name: string, nwo: string, title: string): void {
  const boards = linkedBoards(owner, name);
  if (boards.length > 0) {
    const b = boards[0];
    if (!b) return;
    console.log(`board exists: #${b.number} ${b.title} ${b.url}`);
    return;
  }
  const made = ghj<{ number: number; url?: string }>([
    "project",
    "create",
    "--owner",
    owner,
    "--title",
    title,
    "--format",
    "json",
  ]);
  gh(["project", "link", String(made.number), "--owner", owner, "--repo", nwo]);
  console.log(`board created: #${made.number} ${title} ${made.url ?? ""}`);
}

// The board's Status field and its options by one direct query on the board's node id: gh's
// own `project field-list` reads every field with its options and costs about 100 points.
function statusField(b: Board): [string, Record<string, string>] {
  const q =
    "query($id:ID!){node(id:$id){... on ProjectV2{" +
    'field(name:"Status"){... on ProjectV2SingleSelectField{id options{id name}}}}}}';
  const data = ghj<StatusFieldData>(["api", "graphql", "-f", `query=${q}`, "-F", `id=${b.id}`]);
  const f = data?.data?.node?.field;
  if (!f?.id || !Array.isArray(f.options)) dieGh(`board #${b.number} has no Status field`);
  const opts: Record<string, string> = {};
  for (const o of f.options) {
    opts[pyLower(o.name.replace(NONWORD_RE, ""))] = o.id;
  }
  return [f.id, opts];
}

// The issue's own project items, asked for in the query that reads the issue (about one point
// where a board listing costs about 300). `project{id}` tells the boards apart.
const ITEMS_QUERY =
  "projectItems(first:20){nodes{id project{id} " +
  'fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name}}}}';

function boardItem(
  items: ProjectItemNode[] | undefined,
  b: Board,
): { id: string; status: string | null } | null {
  for (const it of items ?? []) {
    if (it.project?.id === b.id) return { id: it.id, status: it.fieldValueByName?.name ?? null };
  }
  return null;
}

// The id of the issue's item on the board: the one it already has, else a new one. item-add is
// idempotent, so an issue that a board workflow added meanwhile gets its existing item back.
function itemId(b: Board, url: string, item: { id: string } | null): string {
  if (item) return item.id;
  const added = ghj<{ id: string }>([
    "project",
    "item-add",
    String(b.number),
    "--owner",
    b.ownerLogin ?? "",
    "--url",
    url,
    "--format",
    "json",
  ]);
  return added.id;
}

function setColumn(b: Board, url: string, flow: string, item: { id: string } | null): void {
  const [field, opts] = statusField(b);
  const key = COLUMN[flow];
  if (key === undefined || !(key in opts)) {
    dieGh(
      `board #${b.number} has no Status column for ${flow} (its columns: ${Object.keys(opts).join(", ")})`,
    );
  }
  const iid = itemId(b, url, item);
  gh([
    "project",
    "item-edit",
    "--project-id",
    b.id,
    "--id",
    iid,
    "--field-id",
    field,
    "--single-select-option-id",
    opts[key] ?? "",
  ]);
}

// --- issues -----------------------------------------------------------------------------------
function issueOf(owner: string, name: string, nwo: string, number: number): Issue {
  const q =
    "query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){" +
    "issue(number:$number){number title body state stateReason url createdAt " +
    "labels(first:50){nodes{name}} comments(first:100){nodes{body createdAt author{login}}} " +
    `${ITEMS_QUERY}}}}`;
  let data: IssueData;
  try {
    data = ghj<IssueData>([
      "api",
      "graphql",
      "-f",
      `query=${q}`,
      "-F",
      `owner=${owner}`,
      "-F",
      `name=${name}`,
      "-F",
      `number=${number}`,
    ]);
  } catch (e) {
    if (e instanceof DieError) dieGh(`could not read issue #${number} in ${nwo}: ${e.msg}`);
    throw e;
  }
  const iss = data?.data?.repository?.issue;
  if (!iss) dieGh(`no issue #${number} in ${nwo}`);
  const shaped = iss as unknown as Issue;
  shaped.labels = iss.labels?.nodes ?? [];
  shaped.comments = iss.comments?.nodes ?? [];
  shaped.items = iss.projectItems?.nodes ?? [];
  return shaped;
}

function allIssues(owner: string, name: string): ListItem[] {
  const q =
    "query($owner:String!,$name:String!,$after:String){repository(owner:$owner,name:$name){" +
    "issues(first:100,after:$after,states:[OPEN,CLOSED],orderBy:{field:CREATED_AT,direction:ASC}){" +
    "pageInfo{hasNextPage endCursor} nodes{number title state stateReason labels(first:50){nodes{name}} " +
    `${ITEMS_QUERY}}}}}`;
  const out: ListItem[] = [];
  let after: string | null = null;
  for (;;) {
    const argv: string[] = [
      "api",
      "graphql",
      "-f",
      `query=${q}`,
      "-F",
      `owner=${owner}`,
      "-F",
      `name=${name}`,
    ];
    if (after) argv.push("-F", `after=${after}`);
    const page: IssuesPage = ghj<IssuesData>(argv)?.data?.repository?.issues ?? {};
    for (const n of page.nodes ?? []) {
      out.push({
        number: n.number,
        title: n.title,
        state: n.state,
        stateReason: n.stateReason ?? null,
        labels: n.labels?.nodes ?? [],
        items: n.projectItems?.nodes ?? [],
      });
    }
    if (!page.pageInfo?.hasNextPage) return out;
    after = page.pageInfo.endCursor;
  }
}

function flowState(
  iss: { state: string; stateReason?: string | null; labels?: IssueLabel[] },
  status: string | undefined,
): string {
  if (iss.state === "CLOSED") return iss.stateReason === "NOT_PLANNED" ? "cancelled" : "done";
  if ((iss.labels ?? []).some((l) => pyLower(l.name ?? "") === BLOCKED)) return "blocked";
  return pyLower((status ?? "").replace(NONWORD_RE, "")) === "inprogress" ? "in-progress" : "todo";
}

const LABEL_COLORS: Record<string, [string, string]> = {
  [BLOCKED]: ["B60205", "Waiting on something outside the run"],
  [READY]: ["0E8A16", "Signed off by the user, ready to run"],
};

const NOT_FOUND_RE = /404|Not Found|does not exist/iu;

// One REST call. `false` when GitHub says 404 and the caller allows it; any other failure stops.
function rest(argv: string[], allow404 = false): boolean {
  const r = run("gh", ["api", ...argv, "--silent"]);
  if (r.code === 0) return true;
  const said = `${r.err}\n${r.out}`;
  if (allow404 && NOT_FOUND_RE.test(said)) return false;
  dieGh(`gh api ${argv.slice(0, 3).join(" ")}: ${said.trim().slice(0, 300)}`);
}

function ensureLabel(nwo: string, name: string): void {
  if (rest([`repos/${nwo}/labels/${encodeURIComponent(name)}`], true)) return;
  const [color, description] = LABEL_COLORS[pyLower(name)] ?? ["D4C5F9", name];
  rest([
    "-X",
    "POST",
    `repos/${nwo}/labels`,
    "-f",
    `name=${name}`,
    "-f",
    `color=${color}`,
    "-f",
    `description=${description}`,
  ]);
}

// Labels go over REST: gh's own `issue edit --add-label` reads the issue's projects and labels
// through GraphQL first, about 100 points each time. Removing a label the issue lacks is fine.
function setLabel(nwo: string, number: number, present: boolean, name = BLOCKED): void {
  if (present) {
    ensureLabel(nwo, name);
    rest(["-X", "POST", `repos/${nwo}/issues/${number}/labels`, "-f", `labels[]=${name}`]);
  } else {
    rest(
      ["-X", "DELETE", `repos/${nwo}/issues/${number}/labels/${encodeURIComponent(name)}`],
      true,
    );
  }
}

export const NONWORD_RE = new RegExp(`[^${W_CLASS}]`, "gu");
export const NUMBER_RE = new RegExp(`^#?\\p{Nd}+${END_OF_STRING}`, "u");
export const DATE_PREFIX_RE = /^\p{Nd}{4}-\p{Nd}{2}-\p{Nd}{2} /u;

// --- helpers ----------------------------------------------------------------------------------
function numberArg(s: string): number {
  if (!NUMBER_RE.test(s)) dieGh(`not an issue number: ${s}`);
  return parseInt(digitValue(s.replace(/^#/u, "")), 10);
}

function textOf(path: string, what: string): string {
  try {
    const buf = readFileSync(path);
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch (e) {
    dieGh(`cannot read ${what} ${path}: ${thrownDetail(e)}`);
  }
}

function bodyFile(path: string): string {
  const text = textOf(path, "body file");
  if (!text.trim()) dieGh(`the body file ${path} is empty`);
  return text;
}

function normal(text: string): string {
  const lines = text
    .replace(/\r\n/gu, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/u, ""));
  while (lines.length > 0 && lines[0] === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}

function padZ(n: number): string {
  return String(n).padStart(2, "0");
}

// --- entry ------------------------------------------------------------------------------------
function main(): void {
  const argvAll = process.argv.slice(2);
  const REPO = argvAll[0];
  if (!REPO) {
    dieGh(
      "usage: run github <repo> board|create|edit|title|read|state|label|comment|list|access ...",
    );
  }
  if (argvAll.length < 2) {
    dieGh(
      "usage: run github <repo> board|create|edit|title|read|state|label|comment|list|access ...",
    );
  }
  if (!existsSync(REPO) || !statSync(REPO).isDirectory()) dieGh(`no such directory: ${REPO}`);
  REPO_DIR = REPO;
  if (!Bun.which("gh")) dieGh("gh is not on PATH");
  const ghCheck = run("gh", ["auth", "status"]);
  if (ghCheck.code !== 0) dieGh("gh is not logged in; the user runs: gh auth login");
  const remoteR = run("git", ["-C", REPO, "remote", "get-url", "origin"]);
  if (remoteR.code !== 0) dieGh(`${REPO} has no origin remote`);
  const REMOTE = remoteR.out.trim();

  const m = REMOTE_RE.exec(REMOTE);
  if (!m) dieGh(`origin is not a GitHub remote: ${REMOTE}`);
  const OWNER = m[1] ?? "";
  const NAME = m[2] ?? "";
  const NWO = `${OWNER}/${NAME}`;
  const args = argvAll.slice(1);
  const cmd = args[0] ?? "";

  if (cmd === "board") {
    if (args.length === 1) {
      const b = boardOf(NWO, OWNER, NAME);
      console.log(`#${b.number}\t${b.title}\t${b.url}`);
    } else if (args[1] === "init" && (args.length === 2 || args.length === 3)) {
      boardInit(OWNER, NAME, NWO, args.length === 3 ? (args[2] ?? NAME) : trackerBinding() || NAME);
    } else {
      dieGh("usage: run github <repo> board [init [title]]");
    }
  } else if (cmd === "create") {
    if (args.length !== 3) dieGh("usage: run github <repo> create <title> <body-file>");
    bodyFile(args[2] ?? "");
    const b = boardOf(NWO, OWNER, NAME);
    const [, opts] = statusField(b);
    if (!("todo" in opts)) {
      dieGh(`board #${b.number} has no Status column for todo; nothing was created`);
    }
    const createOut = gh([
      "issue",
      "create",
      "-R",
      NWO,
      "--title",
      args[1] ?? "",
      "--body-file",
      args[2] ?? "",
    ]);
    const url = createOut.trim().split("\n").pop() ?? "";
    const number = parseInt(url.replace(/\/$/u, "").split("/").pop() ?? "0", 10);
    try {
      setColumn(b, url, "todo", null);
    } catch (e) {
      if (e instanceof DieError) {
        console.log(String(number));
        process.stderr.write(`github: #${number} was created, but is not on the board\n`);
        process.exit(5);
      }
      throw e;
    }
    console.log(String(number));
  } else if (cmd === "edit") {
    if (args.length !== 4 || !existsSync(args[2] ?? "") || statSync(args[2] ?? "").isDirectory()) {
      dieGh(
        "usage: run github <repo> edit <n> <body-file> <base-file>" +
          (args.length === 4 ? `; no such body file: ${args[2] ?? ""}` : ""),
      );
    }
    const n = numberArg(args[1] ?? "");
    bodyFile(args[2] ?? "");
    const base = textOf(args[3] ?? "", "base file");
    boardOf(NWO, OWNER, NAME);
    const iss = issueOf(OWNER, NAME, NWO, n);
    if (normal(iss.body ?? "") !== normal(base)) {
      dieGh(`#${n} changed since ${args[3]} was read; read it again`, 4);
    }
    gh(["issue", "edit", String(n), "-R", NWO, "--body-file", args[2] ?? ""]);
    console.log(`#${n}: edited`);
  } else if (cmd === "title") {
    if (args.length !== 3) dieGh("usage: run github <repo> title <n> <title>");
    const n = numberArg(args[1] ?? "");
    const title = args[2] ?? "";
    issueOf(OWNER, NAME, NWO, n);
    gh(["issue", "edit", String(n), "-R", NWO, "--title", title]);
    console.log(`#${n}: title changed`);
  } else if (cmd === "label") {
    if (args.length !== 4 || (args[2] !== "add" && args[2] !== "remove"))
      dieGh("usage: run github <repo> label <n> add|remove <label>");
    const n = numberArg(args[1] ?? "");
    const verb = args[2] as "add" | "remove";
    const name = args[3] ?? "";
    issueOf(OWNER, NAME, NWO, n);
    setLabel(NWO, n, verb === "add", name);
    console.log(`#${n}: label ${verb === "add" ? "added" : "removed"} ${name}`);
  } else if (cmd === "has-label") {
    if (args.length !== 3) dieGh("usage: run github <repo> has-label <n> <label>");
    const n = numberArg(args[1] ?? "");
    const name = args[2] ?? "";
    const iss = issueOf(OWNER, NAME, NWO, n);
    // Exact membership: a label name may itself hold commas, so the
    // comma-joined `labels:` line is display-only and never parsed back.
    console.log(
      (iss.labels ?? []).some((l) => pyLower(l.name ?? "") === pyLower(name))
        ? "present"
        : "absent",
    );
  } else if (cmd === "read") {
    const bodyOnly = args.slice(2).length === 1 && args[2] === "--body";
    if (args.length !== 2 && !bodyOnly) dieGh("usage: run github <repo> read <n> [--body]");
    const n = numberArg(args[1] ?? "");
    const iss = issueOf(OWNER, NAME, NWO, n);
    const b = boardOf(NWO, OWNER, NAME);
    if (bodyOnly) {
      process.stdout.write(`${iss.body ?? ""}\n`);
      return;
    }
    console.log(`id: #${n}`);
    console.log(`title: ${iss.title ?? ""}`);
    console.log(`state: ${flowState(iss, boardItem(iss.items, b)?.status ?? undefined)}`);
    console.log(`labels: ${(iss.labels ?? []).map((l) => l.name).join(", ")}`);
    console.log(`created: ${String(iss.createdAt ?? "").slice(0, 10)}`);
    console.log(`url: ${iss.url ?? ""}`);
    console.log("");
    console.log((iss.body ?? "").trim());
    const comments = iss.comments ?? [];
    if (comments.length > 0) {
      console.log("\n## Log");
      const sorted = [...comments].sort((a, b) =>
        (a.createdAt ?? "").localeCompare(b.createdAt ?? ""),
      );
      for (const c of sorted) {
        let text = pyWords(c.body ?? "").join(" ");
        if (!DATE_PREFIX_RE.test(text)) {
          text = `${String(c.createdAt ?? "").slice(0, 10)} ${c.author?.login ?? "?"}: ${text}`;
        }
        console.log(`- ${text}`);
      }
    }
  } else if (cmd === "state") {
    if (args.length !== 3) dieGh("usage: run github <repo> state <n> <state>");
    const n = numberArg(args[1] ?? "");
    const newSt = args[2] ?? "";
    if (!STATES.includes(newSt)) {
      dieGh(`invalid state ${newSt} (one of: ${STATES.join(", ")})`, 2);
    }
    const b = boardOf(NWO, OWNER, NAME);
    const iss = issueOf(OWNER, NAME, NWO, n);
    const blockedNow = (iss.labels ?? []).some((l) => pyLower(l.name ?? "") === BLOCKED);
    const closed = iss.state === "CLOSED";
    if (newSt === "blocked") {
      if (closed) gh(["issue", "reopen", String(n), "-R", NWO]);
      if (!blockedNow) setLabel(NWO, n, true);
    } else {
      if (blockedNow) setLabel(NWO, n, false);
      if ((newSt === "todo" || newSt === "in-progress") && closed) {
        gh(["issue", "reopen", String(n), "-R", NWO]);
      } else if (newSt === "done" && !closed) {
        gh(["issue", "close", String(n), "-R", NWO, "--reason", "completed"]);
      } else if (newSt === "cancelled" && !(closed && iss.stateReason === "NOT_PLANNED")) {
        if (closed) gh(["issue", "reopen", String(n), "-R", NWO]);
        gh(["issue", "close", String(n), "-R", NWO, "--reason", "not planned"]);
      }
      setColumn(b, iss.url, newSt, boardItem(iss.items, b));
    }
    console.log(`#${n}: ${newSt}`);
  } else if (cmd === "comment") {
    if (args.length < 4) dieGh("usage: run github <repo> comment <n> <actor> <text>");
    const n = numberArg(args[1] ?? "");
    const actor = args[2] ?? "";
    const text = args.slice(3).join(" ");
    const now = new Date();
    const stamp = `${now.getFullYear()}-${padZ(now.getMonth() + 1)}-${padZ(now.getDate())} ${padZ(now.getHours())}:${padZ(now.getMinutes())}`;
    const line = `${stamp} ${actor}: ${text}`;
    gh(["issue", "comment", String(n), "-R", NWO, "--body", line]);
    console.log(`#${n}: ${line}`);
  } else if (cmd === "list") {
    if (args.length !== 1 && args.length !== 2) dieGh("usage: run github <repo> list [state]");
    const want = args.length === 2 ? args[1] : null;
    if (want && !STATES.includes(want)) {
      dieGh(`invalid state ${want} (one of: ${STATES.join(", ")})`, 2);
    }
    const board = boardOf(NWO, OWNER, NAME);
    for (const iss of [...allIssues(OWNER, NAME)].sort((a, b) => a.number - b.number)) {
      const st = flowState(iss, boardItem(iss.items, board)?.status ?? undefined);
      if (want === null || st === want) {
        console.log(`#${iss.number}\t${st}\t${iss.title ?? ""}`);
      }
    }
  } else if (cmd === "access") {
    if (args.length !== 1) dieGh("usage: run github <repo> access");
    const q =
      "query($owner:String!,$name:String!){repository(owner:$owner,name:$name){viewerPermission}}";
    const data = ghj<PermissionData>([
      "api",
      "graphql",
      "-f",
      `query=${q}`,
      "-F",
      `owner=${OWNER}`,
      "-F",
      `name=${NAME}`,
    ]);
    const perm = data?.data?.repository?.viewerPermission;
    if (!perm) dieGh(`no permission on ${NWO} could be read`);
    console.log(perm);
  } else if (cmd === "search") {
    if (args.length !== 2) dieGh("usage: run github <repo> search <text>");
    const text = (args[1] ?? "").replace(/[":]/gu, " ").trim();
    const hits = ghj<Array<{ number: number; title: string; state: string }>>([
      "search",
      "issues",
      `"${text}"`,
      "--repo",
      NWO,
      "--json",
      "number,title,state",
      "--limit",
      "100",
    ]);
    for (const h of [...hits].sort((a, b) => a.number - b.number)) {
      console.log(`#${h.number}\t${pyLower(String(h.state ?? ""))}\t${h.title ?? ""}`);
    }
  } else {
    dieGh(
      "usage: run github <repo> board|create|edit|title|read|state|label|comment|list|access|search ...",
    );
  }
}

// --- dispatch ---------------------------------------------------------------------------------
if (import.meta.main) {
  try {
    main();
    process.exit(0);
  } catch (e) {
    if (e instanceof DieError) {
      process.stderr.write(`github: ${e.msg}\n`);
      process.exit(e.code);
    }
    throw e;
  }
}
