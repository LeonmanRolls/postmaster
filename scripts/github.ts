// GitHub Issues as tickets, on a GitHub Projects board as the kanban. One board per target
// repo, linked to it and found through that link, so nothing is configured: the board's Status
// column, which every new board has as Todo, In Progress and Done, carries the flow's state,
// and closing an issue is done. GitHub has no blocked column by default, so blocked is a label
// named `blocked`, added without moving the card and removed by the next state change.
//
//   github.sh <repo> board                         the linked board; exit 3 when there is none
//   github.sh <repo> board init [title]            create a board named after the repo and
//                                                  link it; idempotent
//   github.sh <repo> create <title> <body-file>    new issue on the board in Todo; prints its number
//                                                  (exit 5: created, but not put on the board)
//   github.sh <repo> read <n> [--body]             title, state, labels, body, comments; with
//                                                  --body, only the body, exactly as stored
//   github.sh <repo> edit <n> <body-file> <base-file>
//                                                  replace the issue's body; never its title
//   github.sh <repo> state <n> <state>             todo | in-progress | blocked | done | cancelled
//   github.sh <repo> comment <n> <actor> <text>    one comment, dated to the minute, actor first
//   github.sh <repo> list [state]                  one line per issue: number, state, title
//   github.sh <repo> access                        the user's permission on the repository:
//                                                  ADMIN, MAINTAIN, WRITE, TRIAGE or READ
//   github.sh <repo> search <text>                 one line per issue holding the text in its
//                                                  title, body or comments: number, open or
//                                                  closed, title (GitHub's index, not exact; a
//                                                  colon or a quote in the text counts as a space)
//
// <repo> is a local checkout; the GitHub repository is read from its origin remote. Everything
// goes through the gh CLI, which must be logged in with the `project` scope
// (`gh auth refresh -s project`); scripts/probe-trackers.sh says whether it is.
//
// edit takes the body as it was read when the change was drafted (read --body) and refuses when
// the issue no longer matches it, so a change made in the tracker meanwhile is not lost.
//
//   exit 0  ok
//   exit 1  usage, gh missing or not logged in, no origin remote, unknown issue (a pull request
//           is not one), a body file that cannot be read or is empty, or gh failed
//   exit 2  invalid state
//   exit 3  the repo has no linked board (run: github.sh <repo> board init)
//   exit 4  the issue changed since the base was read
//   exit 5  create made the issue, and printed its number, but could not put it on the board
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { scriptsDir } from "./lib/paths.ts";
import { run } from "./lib/proc.ts";
import { digitValue, END_OF_STRING, pyLower, pyWords, W_CLASS } from "./lib/text.ts";

const STATES = ["todo", "in-progress", "blocked", "done", "cancelled"];
const COLUMN: Record<string, string> = {
  todo: "todo",
  "in-progress": "inprogress",
  done: "done",
  cancelled: "done",
};
const BLOCKED = "blocked";

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
}
interface ListItem {
  number: number;
  title: string;
  state: string;
  stateReason: string | null;
  labels: IssueLabel[];
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

function ghj<T = any>(argv: string[]): T {
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
  const data = ghj<any>([
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
  return (nodes as Board[]).filter((n) => !n.closed);
}

let REPO_DIR = "";

function trackerBinding(): string | null {
  const r = run(join(scriptsDir(import.meta), "project-settings.sh"), ["inspect", REPO_DIR]);
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
    dieGh(`${nwo} has no linked board; run: github.sh <repo> board init`, 3);
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
  if (!b) dieGh(`${nwo} has no linked board; run: github.sh <repo> board init`, 3);
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
  const made = ghj<any>([
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

function statusField(b: Board): [string, Record<string, string>] {
  const fields = ghj<any>([
    "project",
    "field-list",
    String(b.number),
    "--owner",
    b.ownerLogin ?? "",
    "--format",
    "json",
  ]);
  for (const f of fields.fields ?? []) {
    if (pyLower(f.name ?? "") === "status" && f.options != null) {
      const opts: Record<string, string> = {};
      for (const o of f.options) {
        opts[pyLower((o.name as string).replace(NONWORD_RE, ""))] = o.id;
      }
      return [f.id, opts];
    }
  }
  dieGh(`board #${b.number} has no Status field`);
}

function itemId(b: Board, nwo: string, number: number, url: string): [string, string | null] {
  const items = ghj<any>([
    "project",
    "item-list",
    String(b.number),
    "--owner",
    b.ownerLogin ?? "",
    "--format",
    "json",
    "--limit",
    "1000",
  ]);
  for (const it of items.items ?? []) {
    const c = it.content ?? {};
    if (c.type === "Issue" && c.number === number && c.repository === nwo) {
      return [it.id, it.status ?? null];
    }
  }
  const added = ghj<any>([
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
  return [added.id, null];
}

function setColumn(b: Board, nwo: string, number: number, url: string, flow: string): void {
  const [field, opts] = statusField(b);
  const key = COLUMN[flow];
  if (key === undefined || !(key in opts)) {
    dieGh(
      `board #${b.number} has no Status column for ${flow} (its columns: ${Object.keys(opts).join(", ")})`,
    );
  }
  const [iid] = itemId(b, nwo, number, url);
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

function boardStatuses(b: Board, nwo: string): Record<number, string> {
  const items = ghj<any>([
    "project",
    "item-list",
    String(b.number),
    "--owner",
    b.ownerLogin ?? "",
    "--format",
    "json",
    "--limit",
    "1000",
  ]);
  const out: Record<number, string> = {};
  for (const it of items.items ?? []) {
    const c = it.content ?? {};
    if (c.type === "Issue" && c.repository === nwo) {
      out[c.number as number] = it.status ?? "";
    }
  }
  return out;
}

// --- issues -----------------------------------------------------------------------------------
function issueOf(owner: string, name: string, nwo: string, number: number): Issue {
  const q =
    "query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){" +
    "issue(number:$number){number title body state stateReason url createdAt " +
    "labels(first:50){nodes{name}} comments(first:100){nodes{body createdAt author{login}}}}}}";
  const data = ghj<any>([
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
  const iss = data?.data?.repository?.issue;
  if (!iss) dieGh(`no issue #${number} in ${nwo}`);
  iss.labels = iss.labels?.nodes ?? [];
  iss.comments = iss.comments?.nodes ?? [];
  return iss as Issue;
}

function allIssues(owner: string, name: string): ListItem[] {
  const q =
    "query($owner:String!,$name:String!,$after:String){repository(owner:$owner,name:$name){" +
    "issues(first:100,after:$after,states:[OPEN,CLOSED],orderBy:{field:CREATED_AT,direction:ASC}){" +
    "pageInfo{hasNextPage endCursor} nodes{number title state stateReason labels(first:50){nodes{name}}}}}}";
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
    const page = ghj<any>(argv)?.data?.repository?.issues ?? {};
    for (const n of page.nodes ?? []) {
      out.push({
        number: n.number,
        title: n.title,
        state: n.state,
        stateReason: n.stateReason ?? null,
        labels: n.labels?.nodes ?? [],
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

function ensureLabel(nwo: string): void {
  const labels = ghj<Array<{ name: string }>>([
    "label",
    "list",
    "-R",
    nwo,
    "--json",
    "name",
    "--limit",
    "200",
  ]);
  const names = new Set(labels.map((l) => pyLower(l.name)));
  if (!names.has(BLOCKED)) {
    gh([
      "label",
      "create",
      BLOCKED,
      "-R",
      nwo,
      "--color",
      "B60205",
      "--description",
      "Waiting on something outside the run",
    ]);
  }
}

function setLabel(nwo: string, number: number, present: boolean): void {
  if (present) {
    ensureLabel(nwo);
    gh(["issue", "edit", String(number), "-R", nwo, "--add-label", BLOCKED]);
  } else {
    gh(["issue", "edit", String(number), "-R", nwo, "--remove-label", BLOCKED]);
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
  } catch (e: any) {
    dieGh(`cannot read ${what} ${path}: ${e?.message ?? e}`);
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
    dieGh("usage: github.sh <repo> board|create|edit|read|state|comment|list|access ...");
  }
  if (argvAll.length < 2) {
    dieGh("usage: github.sh <repo> board|create|edit|read|state|comment|list|access ...");
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
      dieGh("usage: github.sh <repo> board [init [title]]");
    }
  } else if (cmd === "create") {
    if (args.length !== 3) dieGh("usage: github.sh <repo> create <title> <body-file>");
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
      setColumn(b, NWO, number, url, "todo");
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
        "usage: github.sh <repo> edit <n> <body-file> <base-file>" +
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
  } else if (cmd === "read") {
    const bodyOnly = args.slice(2).length === 1 && args[2] === "--body";
    if (args.length !== 2 && !bodyOnly) dieGh("usage: github.sh <repo> read <n> [--body]");
    const n = numberArg(args[1] ?? "");
    const iss = issueOf(OWNER, NAME, NWO, n);
    const b = boardOf(NWO, OWNER, NAME);
    if (bodyOnly) {
      process.stdout.write(`${iss.body ?? ""}\n`);
      return;
    }
    const statuses = boardStatuses(b, NWO);
    console.log(`id: #${n}`);
    console.log(`title: ${iss.title ?? ""}`);
    console.log(`state: ${flowState(iss, statuses[n])}`);
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
    if (args.length !== 3) dieGh("usage: github.sh <repo> state <n> <state>");
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
      setColumn(b, NWO, n, iss.url, newSt);
    }
    console.log(`#${n}: ${newSt}`);
  } else if (cmd === "comment") {
    if (args.length < 4) dieGh("usage: github.sh <repo> comment <n> <actor> <text>");
    const n = numberArg(args[1] ?? "");
    const actor = args[2] ?? "";
    const text = args.slice(3).join(" ");
    const now = new Date();
    const stamp = `${now.getFullYear()}-${padZ(now.getMonth() + 1)}-${padZ(now.getDate())} ${padZ(now.getHours())}:${padZ(now.getMinutes())}`;
    const line = `${stamp} ${actor}: ${text}`;
    gh(["issue", "comment", String(n), "-R", NWO, "--body", line]);
    console.log(`#${n}: ${line}`);
  } else if (cmd === "list") {
    if (args.length !== 1 && args.length !== 2) dieGh("usage: github.sh <repo> list [state]");
    const want = args.length === 2 ? args[1] : null;
    if (want && !STATES.includes(want)) {
      dieGh(`invalid state ${want} (one of: ${STATES.join(", ")})`, 2);
    }
    const statuses = boardStatuses(boardOf(NWO, OWNER, NAME), NWO);
    for (const iss of [...allIssues(OWNER, NAME)].sort((a, b) => a.number - b.number)) {
      const st = flowState(iss, statuses[iss.number]);
      if (want === null || st === want) {
        console.log(`#${iss.number}\t${st}\t${iss.title ?? ""}`);
      }
    }
  } else if (cmd === "access") {
    if (args.length !== 1) dieGh("usage: github.sh <repo> access");
    const q =
      "query($owner:String!,$name:String!){repository(owner:$owner,name:$name){viewerPermission}}";
    const data = ghj<any>([
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
    if (args.length !== 2) dieGh("usage: github.sh <repo> search <text>");
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
    dieGh("usage: github.sh <repo> board|create|edit|read|state|comment|list|access|search ...");
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
