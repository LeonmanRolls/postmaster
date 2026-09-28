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
//   github.sh --self-test                          read, edit, create, access and search against a
//                                                  stub gh, offline
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
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { scriptsDir } from "./lib/paths.ts";
import { run, withTempDir } from "./lib/proc.ts";
import { SelfTest } from "./lib/selftest.ts";

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
const REMOTE_RE = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/;

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

function boardOf(nwo: string, owner: string, name: string): Board {
  const boards = linkedBoards(owner, name);
  if (boards.length === 0) {
    dieGh(`${nwo} has no linked board; run: github.sh <repo> board init`, 3);
  }
  const named = boards.filter((b) => b.title === name);
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
    if ((f.name ?? "").toLowerCase() === "status" && f.options != null) {
      const opts: Record<string, string> = {};
      for (const o of f.options) {
        opts[(o.name as string).replace(/\W/g, "").toLowerCase()] = o.id;
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
  if ((iss.labels ?? []).some((l) => (l.name ?? "").toLowerCase() === BLOCKED)) return "blocked";
  return (status ?? "").replace(/\W/g, "").toLowerCase() === "inprogress" ? "in-progress" : "todo";
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
  const names = new Set(labels.map((l) => l.name.toLowerCase()));
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

// --- helpers ----------------------------------------------------------------------------------
function numberArg(s: string): number {
  if (!/^#?\d+$/.test(s)) dieGh(`not an issue number: ${s}`);
  return parseInt(s.replace(/^#/, ""), 10);
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
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/, ""));
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
      "usage: github.sh <repo> board|create|edit|read|state|comment|list|access ... | --self-test",
    );
  }
  if (argvAll.length < 2) {
    dieGh(
      "usage: github.sh <repo> board|create|edit|read|state|comment|list|access ... | --self-test",
    );
  }
  if (!existsSync(REPO) || !statSync(REPO).isDirectory()) dieGh(`no such directory: ${REPO}`);
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
      boardInit(OWNER, NAME, NWO, args.length === 3 ? (args[2] ?? NAME) : NAME);
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
    const number = parseInt(url.replace(/\/$/, "").split("/").pop() ?? "0", 10);
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
        let text = (c.body ?? "").split(/\s+/).filter(Boolean).join(" ");
        if (!/^\d{4}-\d{2}-\d{2} /.test(text)) {
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
    const blockedNow = (iss.labels ?? []).some((l) => (l.name ?? "").toLowerCase() === BLOCKED);
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
    const text = (args[1] ?? "").replace(/[":]/g, " ").trim();
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
      console.log(`#${h.number}\t${String(h.state ?? "").toLowerCase()}\t${h.title ?? ""}`);
    }
  } else {
    dieGh("usage: github.sh <repo> board|create|edit|read|state|comment|list|access|search ...");
  }
}

// --- self-test ---------------------------------------------------------------------------------
// read and edit run for real, against a stub gh first on PATH: it answers the queries from
// canned files and records every issue edit, so nothing reaches GitHub.

function catA(text: string): string {
  return text
    .replace(/\t/g, "^I")
    .split("\n")
    .map((l, i, arr) => (i < arr.length - 1 ? `${l}$` : l))
    .join("\n");
}

function selfTest(): void {
  const SELF = join(scriptsDir(import.meta), "github.sh");
  withTempDir((tmp) => {
    const S = join(tmp, "stub");
    const bin = join(tmp, "bin");
    mkdirSync(bin, { recursive: true });
    mkdirSync(S, { recursive: true });

    const stubGh = `#!/usr/bin/env bash
d=$GITHUB_SH_STUB
case "$1 $2" in
  "auth status") exit 0 ;;
  "api graphql")
    q="" n=""
    for a in "$@"; do case $a in query=*) q=$a ;; number=*) n=\${a#number=} ;; esac; done
    case $q in
      *projectsV2*) cat "$d/boards.json" ;;
      *viewerPermission*) cat "$d/access.json" ;;
      *"issue(number:"*) if [ -f "$d/issue-$n.json" ]; then cat "$d/issue-$n.json"
                         else echo '{"data": {"repository": {"issue": null}}}'; fi ;;
      *) echo "stub gh: unexpected query" >&2; exit 1 ;;
    esac ;;
  "project item-list") cat "$d/items.json" ;;
  "project field-list") cat "$d/fields.json" ;;
  "project item-add") if [ -f "$d/no-item-add" ]; then echo "stub gh: item-add refused" >&2; exit 1; fi
                      echo '{"id": "PVTI_new"}' ;;
  "project item-edit") exit 0 ;;
  "issue create") printf 'create\\n' >> "$d/creates.log"; echo "https://github.com/o/r/issues/60" ;;
  "search issues") printf '%s\\n' "$*" >> "$d/searches.log"; cat "$d/search.json" ;;
  "issue edit")
    f="" prev=""
    for a in "$@"; do [ "$prev" = --body-file ] && f=$a; prev=$a; done
    printf 'call:%s\\n' "$(printf ' [%s]' "$@")" >> "$d/edits.log"
    cp -- "$f" "$d/edited-body" ;;
  *) echo "stub gh: unexpected: $*" >&2; exit 1 ;;
esac
`;
    writeFileSync(join(bin, "gh"), stubGh);
    chmodSync(join(bin, "gh"), 0o755);

    if (run("git", ["init", "-q", join(tmp, "repo")]).code !== 0) process.exit(1);
    if (
      run("git", ["-C", join(tmp, "repo"), "remote", "add", "origin", "https://github.com/o/r.git"])
        .code !== 0
    )
      process.exit(1);

    const BOARD =
      '{"data": {"repository": {"projectsV2": {"nodes": [{"id": "PVT_1", "number": 1, "title": "r", "closed": false, "url": "https://github.com/users/o/projects/1", "owner": {"login": "o"}}]}}}}';
    writeFileSync(join(S, "boards.json"), `${BOARD}\n`);
    writeFileSync(
      join(S, "items.json"),
      '{"items": [{"id": "PVTI_7", "status": "Todo", "content": {"type": "Issue", "number": 7, "repository": "o/r"}}]}' +
        "\n",
    );
    writeFileSync(
      join(S, "fields.json"),
      '{"fields": [{"id": "F1", "name": "Status", "options": [{"id": "o1", "name": "Todo"}, {"id": "o2", "name": "In Progress"}, {"id": "o3", "name": "Done"}]}]}' +
        "\n",
    );

    function stored(n: number, file: string): void {
      const body = readFileSync(file, "utf8");
      const obj = {
        data: {
          repository: {
            issue: {
              number: n,
              title: "Check a ticket's shape",
              body,
              state: "OPEN",
              stateReason: null,
              url: `https://github.com/o/r/issues/${n}`,
              createdAt: "2026-09-23T00:00:00Z",
              labels: { nodes: [] },
              comments: { nodes: [] },
            },
          },
        },
      };
      writeFileSync(join(S, `issue-${n}.json`), `${JSON.stringify(obj)}\n`);
    }

    function ghSh(args: string[]): { code: number; out: string; err: string } {
      return run("bash", [SELF, join(tmp, "repo"), ...args], {
        env: { PATH: `${bin}:${process.env.PATH ?? ""}`, GITHUB_SH_STUB: S },
      });
    }

    function editsCount(): number {
      try {
        return readFileSync(join(S, "edits.log"), "utf8")
          .split("\n")
          .filter((l) => l.startsWith("call:")).length;
      } catch {
        return 0;
      }
    }

    function createsCount(): number {
      try {
        return readFileSync(join(S, "creates.log"), "utf8")
          .split("\n")
          .filter((l) => l !== "").length;
      } catch {
        return 0;
      }
    }

    const st = new SelfTest();

    const lfMd =
      '## Problem / feature\nA body with `code`, "quotes" and a trailing space. \n\n## Direction\nNone.';
    writeFileSync(join(tmp, "lf.md"), lfMd);
    const crlfMd =
      "## Problem / feature\r\nStored with CRLF line endings.\r\n\r\n## Direction\r\nNone.\r\n";
    writeFileSync(join(tmp, "crlf.md"), crlfMd);
    const newMd =
      "## Problem / feature\nThe new body.\n\n## Direction\nNone: any approach that meets the criteria.\n";
    writeFileSync(join(tmp, "new.md"), newMd);

    console.log("positive controls");

    // 1. read --body prints the stored body byte for byte, then one newline
    stored(7, join(tmp, "lf.md"));
    let r = ghSh(["read", "7", "--body"]);
    const want1 = Buffer.concat([readFileSync(join(tmp, "lf.md")), Buffer.from("\n")]);
    st.check(
      "read --body prints the stored body byte for byte, then one newline",
      r.code === 0 && Buffer.compare(Buffer.from(r.out, "utf8"), want1) === 0,
      `exit ${r.code}\n${catA(r.out)}`,
    );

    // 2. read --body keeps a CRLF body's line endings
    stored(7, join(tmp, "crlf.md"));
    r = ghSh(["read", "7", "--body"]);
    const want2 = Buffer.concat([readFileSync(join(tmp, "crlf.md")), Buffer.from("\n")]);
    st.check(
      "read --body keeps a CRLF body's line endings",
      r.code === 0 && Buffer.compare(Buffer.from(r.out, "utf8"), want2) === 0,
      `exit ${r.code}\n${catA(r.out)}`,
    );

    // 3. read without --body still prints the header before the body
    stored(7, join(tmp, "lf.md"));
    r = ghSh(["read", "7"]);
    const lines3 = r.out.split("\n");
    st.check(
      "read without --body still prints the header before the body",
      r.code === 0 && lines3[0] === "id: #7" && lines3.includes("title: Check a ticket's shape"),
      `exit ${r.code}\n${r.out}`,
    );

    // 4. edit against the body as read calls gh issue edit once, with the body file and no title
    const baseRead = ghSh(["read", "7", "--body"]);
    writeFileSync(join(tmp, "base.md"), baseRead.out);
    writeFileSync(join(S, "edits.log"), "");
    r = ghSh(["edit", "7", join(tmp, "new.md"), join(tmp, "base.md")]);
    const edits1 = editsCount();
    let editsLog = "";
    try {
      editsLog = readFileSync(join(S, "edits.log"), "utf8");
    } catch {
      editsLog = "";
    }
    let editedBodyMatches = false;
    try {
      editedBodyMatches =
        Buffer.compare(readFileSync(join(S, "edited-body")), readFileSync(join(tmp, "new.md"))) ===
        0;
    } catch {
      editedBodyMatches = false;
    }
    st.check(
      "edit against the body as read calls gh issue edit once, with the body file and no title",
      r.code === 0 &&
        r.out.trim() === "#7: edited" &&
        edits1 === 1 &&
        editsLog.includes("[--body-file]") &&
        !editsLog.includes("[--title]") &&
        editedBodyMatches,
      `exit ${r.code}, ${edits1} edit(s)\n${r.out}\n${editsLog}`,
    );

    // 5. a body stored with CRLF matches the same base with LF
    stored(7, join(tmp, "crlf.md"));
    writeFileSync(
      join(tmp, "base-lf.md"),
      readFileSync(join(tmp, "crlf.md"), "utf8").replace(/\r/g, ""),
    );
    writeFileSync(join(S, "edits.log"), "");
    r = ghSh(["edit", "7", join(tmp, "new.md"), join(tmp, "base-lf.md")]);
    st.check(
      "a body stored with CRLF matches the same base with LF",
      r.code === 0 && r.out.trim() === "#7: edited" && editsCount() === 1,
      `exit ${r.code}, ${editsCount()} edit(s)\n${r.out}`,
    );

    console.log("negative controls: nothing is written");

    function refused(label: string, want: number, why: string, editArgs: string[]): void {
      writeFileSync(join(S, "edits.log"), "");
      const rr = ghSh(["edit", ...editArgs]);
      const ed = editsCount();
      const combined = rr.out + rr.err;
      if (rr.code === want && ed === 0 && combined.includes(why)) {
        st.ok(label);
      } else {
        st.fail(
          `${label}: wanted exit ${want} with "${why}" and no edit, got exit ${rr.code} and ${ed} edit(s)`,
          combined,
        );
      }
    }

    stored(7, join(tmp, "lf.md"));
    writeFileSync(join(tmp, "stale.md"), "## Problem / feature\nChanged in the tracker since.\n");
    writeFileSync(join(tmp, "empty.md"), " \n\n");

    refused("a base the issue no longer matches exits 4", 4, "#7 changed since", [
      "7",
      join(tmp, "new.md"),
      join(tmp, "stale.md"),
    ]);
    refused("an empty body file exits 1", 1, "is empty", [
      "7",
      join(tmp, "empty.md"),
      join(tmp, "base.md"),
    ]);
    refused("a missing base file exits 1", 1, "cannot read base file", [
      "7",
      join(tmp, "new.md"),
      join(tmp, "nowhere.md"),
    ]);
    refused("a pull request number exits 1", 1, "no issue #34", [
      "34",
      join(tmp, "new.md"),
      join(tmp, "base.md"),
    ]);
    refused("the old form, with a title, is a usage error", 1, "usage:", [
      "7",
      "Check a ticket's shape",
      join(tmp, "new.md"),
    ]);

    writeFileSync(
      join(S, "boards.json"),
      '{"data": {"repository": {"projectsV2": {"nodes": []}}}}' + "\n",
    );
    refused("no linked board exits 3", 3, "no linked board", [
      "7",
      join(tmp, "new.md"),
      join(tmp, "base.md"),
    ]);
    r = ghSh(["read", "7", "--body"]);
    st.check("read --body without a linked board exits 3", r.code === 3, `exit ${r.code}`);
    writeFileSync(join(S, "boards.json"), `${BOARD}\n`);

    console.log("access");
    writeFileSync(
      join(S, "access.json"),
      '{"data": {"repository": {"viewerPermission": "ADMIN"}}}' + "\n",
    );
    r = ghSh(["access"]);
    st.check(
      "access prints the user's permission",
      r.code === 0 && r.out.trim() === "ADMIN",
      `exit ${r.code}\n${r.out}`,
    );
    writeFileSync(
      join(S, "access.json"),
      '{"data": {"repository": {"viewerPermission": "READ"}}}' + "\n",
    );
    r = ghSh(["access"]);
    st.check(
      "a repository the user only reads says READ",
      r.code === 0 && r.out.trim() === "READ",
      `exit ${r.code}\n${r.out}`,
    );
    writeFileSync(join(S, "access.json"), '{"data": {"repository": null}}' + "\n");
    r = ghSh(["access"]);
    st.check(
      "a repository gh cannot see exits 1",
      r.code === 1 && (r.out + r.err).includes("no permission on o/r"),
      `exit ${r.code}\n${r.out}${r.err}`,
    );

    console.log("create and search");
    writeFileSync(join(S, "creates.log"), "");
    r = ghSh(["create", "A title", join(tmp, "new.md")]);
    st.check(
      "create files the issue and prints its number",
      r.code === 0 && r.out.trim() === "60" && createsCount() === 1,
      `exit ${r.code}\n${r.out}`,
    );

    writeFileSync(join(S, "creates.log"), "");
    writeFileSync(join(S, "no-item-add"), "");
    const rCreate5 = ghSh(["create", "A title", join(tmp, "new.md")]);
    st.check(
      "an issue that misses the board still prints its number, and exits 5",
      rCreate5.code === 5 &&
        rCreate5.out.trim() === "60" &&
        createsCount() === 1 &&
        rCreate5.err.includes("#60 was created, but is not on the board"),
      `exit ${rCreate5.code}\n${rCreate5.out}${rCreate5.err}`,
    );
    rmSync(join(S, "no-item-add"));

    writeFileSync(join(S, "creates.log"), "");
    const origFields = readFileSync(join(S, "fields.json"));
    writeFileSync(
      join(S, "fields.json"),
      '{"fields": [{"id": "F1", "name": "Status", "options": [{"id": "o1", "name": "Backlog"}, {"id": "o3", "name": "Done"}]}]}' +
        "\n",
    );
    r = ghSh(["create", "A title", join(tmp, "new.md")]);
    st.check(
      "a board with no Todo column is refused before anything is created",
      r.code === 1 && createsCount() === 0 && (r.out + r.err).includes("nothing was created"),
      `exit ${r.code}\n${r.out}${r.err}`,
    );
    writeFileSync(join(S, "fields.json"), origFields);

    writeFileSync(
      join(S, "search.json"),
      '[{"number": 9, "title": "Later", "state": "CLOSED"}, {"number": 4, "title": "Earlier", "state": "OPEN"}]' +
        "\n",
    );
    r = ghSh(["search", "tf-0a1b2c3d"]);
    const wantSearch = "#4\topen\tEarlier\n#9\tclosed\tLater";
    let searchesLog = "";
    try {
      searchesLog = readFileSync(join(S, "searches.log"), "utf8");
    } catch {
      searchesLog = "";
    }
    st.check(
      "search asks for the phrase in this repository, and prints number, state and title",
      r.code === 0 &&
        r.out.trimEnd() === wantSearch &&
        searchesLog.includes('"tf-0a1b2c3d" --repo o/r'),
      `exit ${r.code}\n${r.out}`,
    );

    ghSh(["search", "Tool fault in scripts/x.sh:"]);
    try {
      searchesLog = readFileSync(join(S, "searches.log"), "utf8");
    } catch {
      searchesLog = "";
    }
    const lastSearch = searchesLog.trimEnd().split("\n").pop() ?? "";
    st.check(
      "a colon in the text is searched as a space, which GitHub's query accepts",
      lastSearch.includes('"Tool fault in scripts/x.sh" --repo o/r'),
      lastSearch,
    );

    st.finish();
  });
}

// --- dispatch ---------------------------------------------------------------------------------
const firstArg = process.argv[2];
if (firstArg === "--self-test") {
  selfTest();
} else {
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
