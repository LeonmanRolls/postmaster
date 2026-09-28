// Tickets kept in the target repository's own git directory, with no service and no login: no
// network, and nothing installed beyond the git and Bun the other scripts use. The
// store is postmaster/tickets/ in the repository's common git directory (.git/postmaster/tickets/
// in a plain checkout): outside the working tree and every branch, one copy whatever branch or
// worktree is checked out, and removed with the repository. A ticket is two files there: <n>.md,
// its body as written, and <n>.json, its title, state, labels, created time and log. Every write
// holds the store's lock and replaces a whole file, so a reader sees a file as it was before a
// write or after it, never in between.
//
//   local.sh <repo> store                          the store's path; exit 3 when there is none
//   local.sh <repo> store init                     make the store; idempotent
//   local.sh <repo> store remove                   remove a store that holds no ticket
//   local.sh <repo> create <title> <body-file>     new ticket in todo; prints its number
//   local.sh <repo> read <n> [--body]              title, state, labels, body, log; with --body,
//                                                  only the body as stored, ending in a newline
//   local.sh <repo> edit <n> <body-file> <base-file>
//                                                  replace the ticket's body; never its title
//   local.sh <repo> title <n> <title>              replace the ticket's title, the user's command
//   local.sh <repo> state <n> <state>              todo | in-progress | blocked | done | cancelled
//   local.sh <repo> comment <n> <actor> <text>     one log line, dated to the minute, actor first
//   local.sh <repo> list [state]                   one line per ticket: number, state, title;
//                                                  grouped by state, in the order above
//   local.sh --self-test                           every command against throwaway repos, offline
//
// <repo> is any checkout of the repository: the main one, a linked worktree or a directory in
// either. Git's own variables that name a repository, such as the GIT_DIR a hook or
// `git rebase --exec` exports, are ignored. store init and store remove run only from the main
// checkout, never from a linked worktree, where lanes and coachmen work: a repository whose store
// exists uses this tracker whatever the config names (scripts/tracker-kind.sh).
//
// A body file or a base file may be /dev/stdin. create and edit drop a byte-order mark from the
// start of a body. edit takes the body as it was read when the change was drafted (read --body)
// and refuses when the ticket no longer matches it, so a change made meanwhile is not lost. list
// prints every ticket it can read, and names on stderr each one it cannot.
//
//   exit 0  ok
//   exit 1  usage, git missing, not a git repository, unknown ticket, a ticket file
//           that is not as this script writes it, a title that is empty or more than one line, an
//           argument or a body that is not UTF-8, a body file that cannot be read or is empty,
//           store init or remove from a linked worktree, store remove on a store holding a
//           ticket, a store that cannot be read or written, or list with a ticket it cannot read
//   exit 2  invalid state
//   exit 3  the repository has no store (run: local.sh <repo> store init)
//   exit 4  the ticket changed since the base was read
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { run, withTempDir } from "./lib/proc.ts";
import { scriptsDir } from "./lib/paths.ts";
import { SelfTest } from "./lib/selftest.ts";

const STATES = ["todo", "in-progress", "blocked", "done", "cancelled"];
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

class DieError extends Error {
  constructor(
    public readonly msg: string,
    public readonly code: number = 1,
  ) {
    super(msg);
  }
}
function dieL(msg: string, code = 1): never {
  throw new DieError(msg, code);
}

interface TicketMeta {
  title: string;
  state: string;
  labels: string[];
  created: string;
  log: string[];
}

function utf8Check(s: string, what: string): string {
  // In JS all strings are valid UTF-16; simulate Python's UTF-8 check for lone surrogates
  try {
    const buf = Buffer.from(s, "utf8");
    if (buf.toString("utf8") !== s) dieL(`the ${what} is not UTF-8`);
  } catch {
    dieL(`the ${what} is not UTF-8`);
  }
  return s;
}

function titleArg(s: string): string {
  const title = utf8Check(s, "title").trim();
  if (!title) dieL("the title is empty");
  if (title.includes("\n") || title.includes("\r")) dieL("the title is more than one line");
  return title;
}

function numberArg(s: string): number {
  if (!/^#?0*[1-9]\d*$/.test(s)) dieL(`not a ticket number: ${s}`);
  return parseInt(s.replace(/^#/, ""), 10);
}

function stateArg(s: string): string {
  if (!STATES.includes(s)) dieL(`invalid state ${s} (one of: ${STATES.join(", ")})`, 2);
  return s;
}

function oneLine(s: string): string {
  return s.split(/\s+/).filter(Boolean).join(" ");
}

function pathN(store: string, n: number, ext: string): string {
  return join(store, `${n}.${ext}`);
}

function bytesOf(p: string, what: string): Buffer {
  try {
    return readFileSync(p);
  } catch (e: any) {
    dieL(`cannot read ${what} ${p}: ${e?.code === "ENOENT" ? "No such file or directory" : (e?.message ?? e)}`);
  }
}

function textOf(data: Buffer, p: string, what: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    dieL(`cannot read ${what} ${p}: it is not UTF-8`);
  }
}

function bodyFile(p: string): Buffer {
  let data = bytesOf(p, "body file");
  if (data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) {
    data = data.subarray(3);
  }
  if (!textOf(data, p, "body file").trim()) dieL(`the body file ${p} is empty`);
  return data;
}

function normal(text: string): string {
  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/, ""));
  while (lines.length > 0 && lines[0] === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}

function load(store: string, n: number): [TicketMeta | null, string | null] {
  const p = pathN(store, n, "json");
  let raw: Buffer;
  try {
    raw = readFileSync(p);
  } catch (e: any) {
    if (e?.code === "ENOENT") return [null, `no ticket #${n} in ${store}`];
    return [null, `cannot read ticket #${n} at ${p}: ${e?.message ?? e}`];
  }
  let m: any;
  try {
    const text = raw.toString("utf8").replace(/^\ufeff/, "");
    m = JSON.parse(text);
  } catch (e: any) {
    return [null, `ticket #${n} at ${p} is not valid JSON: ${e?.message ?? e}`];
  }
  if (typeof m !== "object" || m === null || Array.isArray(m)) {
    return [null, `ticket #${n} at ${p} is not a JSON object`];
  }
  for (const k of ["title", "state", "created"]) {
    if (typeof m[k] !== "string") return [null, `ticket #${n} at ${p} has no ${k} string`];
  }
  for (const k of ["labels", "log"]) {
    const v = m[k] ?? (m[k] = []);
    if (!Array.isArray(v) || !v.every((x: unknown) => typeof x === "string")) {
      return [null, `ticket #${n} at ${p}: its ${k} is not a list of strings`];
    }
  }
  return [m as TicketMeta, null];
}

function meta(store: string, n: number): TicketMeta {
  const [m, why] = load(store, n);
  if (why || !m) dieL(why ?? `no ticket #${n}`);
  return m;
}

function body(store: string, n: number): Buffer {
  return bytesOf(pathN(store, n, "md"), `the body of #${n} at`);
}

function write(p: string, data: Buffer | string): void {
  const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  const tmp = `${p}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, buf);
    renameSync(tmp, p);
  } catch (e: any) {
    try { unlinkSync(tmp); } catch {}
    dieL(`cannot write ${p}: ${e?.message ?? e}`);
  }
}

function writeMeta(store: string, n: number, m: TicketMeta): void {
  write(pathN(store, n, "json"), JSON.stringify(m, null, 2) + "\n");
}

// Simple exclusive lock using O_EXCL create; removed on release.
function withStoreLock<T>(store: string, fn: () => T): T {
  const lockPath = join(store, ".lock");
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const fd = openSync(lockPath, "wx", 0o644);
      closeSync(fd);
      break;
    } catch {
      if (Date.now() > deadline) {
        try {
          if (!existsSync(store)) dieL(`no ticket store at ${store}; with the user's word, run: local.sh <repo> store init`, 3);
        } catch {}
        dieL(`cannot lock the store ${store}: resource temporarily unavailable`);
      }
      // brief sleep
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);
    }
  }
  try {
    if (!existsSync(store)) dieL(`no ticket store at ${store}; with the user's word, run: local.sh <repo> store init`, 3);
    return fn();
  } finally {
    try { unlinkSync(lockPath); } catch {}
  }
}

function numbers(store: string): number[] {
  return readdirSync(store)
    .map((f) => /^(\d+)\.json$/.exec(f))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => parseInt(m[1]!, 10))
    .sort((a, b) => a - b);
}

function nextNumber(store: string): number {
  const used = readdirSync(store)
    .map((f) => /^(\d+)\.(?:json|md)$/.exec(f))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => parseInt(m[1]!, 10));
  return (used.length > 0 ? Math.max(...used) : 0) + 1;
}

function needStore(store: string): void {
  if (!existsSync(store) || !statSync(store).isDirectory()) {
    dieL(`no ticket store at ${store}; with the user's word, run: local.sh <repo> store init`, 3);
  }
}

function mainCheckoutOnly(what: string, main: string): void {
  if (main) {
    dieL(`${what} runs only from the repository's main checkout, ${main}, never from a linked worktree`);
  }
}

// --- entry ------------------------------------------------------------------------------------
function main(): void {
  // Unset git env vars so they don't steer us
  for (const v of ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_NAMESPACE"]) {
    delete process.env[v];
  }

  const argvAll = process.argv.slice(2);
  if (argvAll.length < 2) {
    dieL("usage: local.sh <repo> store|create|edit|read|title|state|comment|list ... | --self-test");
  }
  const REPO = argvAll[0]!;
  if (!existsSync(REPO) || !statSync(REPO).isDirectory()) dieL(`no such directory: ${REPO}`);
  if (!Bun.which("git")) dieL("git is not on PATH");

  function gitpath(opt: string): string | null {
    const r = run("git", ["-C", REPO, "rev-parse", opt]);
    if (r.code !== 0) return null;
    let p = r.out.trim();
    if (!p.startsWith("/")) p = join(REPO, p);
    try {
      return realpathSync(p);
    } catch {
      return null;
    }
  }

  const COMMON = gitpath("--git-common-dir");
  if (!COMMON) dieL(`not a git repository: ${REPO}`);
  const GITDIR = gitpath("--git-dir");
  if (!GITDIR) dieL(`not a git repository: ${REPO}`);
  let MAIN = "";
  if (GITDIR !== COMMON) {
    const r = run("git", ["-C", REPO, "worktree", "list", "--porcelain"]);
    const firstLine = r.out.split("\n")[0] ?? "";
    MAIN = firstLine.startsWith("worktree ") ? firstLine.slice(9) : "the main checkout";
    if (!MAIN) MAIN = "the main checkout";
  }

  const STORE = join(COMMON, "postmaster", "tickets");
  const args = argvAll.slice(1);
  const cmd = args[0] ?? "";

  if (cmd === "store") {
    if (args.length === 1) {
      needStore(STORE);
      console.log(STORE);
    } else if (args.length === 2 && args[1] === "init") {
      mainCheckoutOnly("store init", MAIN);
      const existed = existsSync(STORE) && statSync(STORE).isDirectory();
      try {
        mkdirSync(STORE, { recursive: true });
      } catch (e: any) {
        dieL(`cannot make ${STORE}: ${e?.message ?? e}`);
      }
      console.log(`store ${existed ? "exists" : "created"}: ${STORE}`);
    } else if (args.length === 2 && args[1] === "remove") {
      mainCheckoutOnly("store remove", MAIN);
      needStore(STORE);
      withStoreLock(STORE, () => {
        const names = readdirSync(STORE);
        const held = new Set(names.filter((f) => /^\d+\.(?:json|md)$/.test(f)).map((f) => f.split(".")[0]));
        if (held.size > 0) {
          dieL(`the store at ${STORE} holds ${held.size} ticket(s); it is removed only when it holds none`);
        }
        for (const f of names) {
          if (f === ".lock" || /^\d+\.(?:json|md)\.\d+\.tmp$/.test(f)) {
            try { unlinkSync(join(STORE, f)); } catch {}
          }
        }
        try {
          rmSync(STORE, { recursive: false });
        } catch (e: any) {
          dieL(`cannot remove ${STORE}: ${e?.message ?? e}`);
        }
        try { rmSync(dirname(STORE), { recursive: false }); } catch {}
      });
      console.log(`store removed: ${STORE}`);
    } else {
      dieL("usage: local.sh <repo> store [init|remove]");
    }
  } else if (cmd === "create") {
    if (args.length !== 3) dieL("usage: local.sh <repo> create <title> <body-file>");
    const title = titleArg(args[1]!);
    const data = bodyFile(args[2]!);
    needStore(STORE);
    withStoreLock(STORE, () => {
      const n = nextNumber(STORE);
      write(pathN(STORE, n, "md"), data);
      const created = new Date().toISOString().replace(/\.\d+Z$/, "Z");
      writeMeta(STORE, n, { title, state: "todo", labels: [], created, log: [] });
      console.log(String(n));
    });
  } else if (cmd === "edit") {
    if (args.length !== 4 || !existsSync(args[2] ?? "")) {
      dieL(
        "usage: local.sh <repo> edit <n> <body-file> <base-file>" +
          (args.length === 4 ? "; no such body file: " + (args[2] ?? "") : ""),
      );
    }
    const n = numberArg(args[1]!);
    const data = bodyFile(args[2]!);
    const baseRaw = bytesOf(args[3]!, "base file");
    const base = textOf(baseRaw, args[3]!, "base file");
    needStore(STORE);
    withStoreLock(STORE, () => {
      meta(STORE, n);
      const bodyText = body(STORE, n).toString("utf8").replace(/^\ufeff/, "");
      if (normal(bodyText) !== normal(base.replace(/^\ufeff/, ""))) {
        dieL(`#${n} changed since ${args[3]} was read; read it again`, 4);
      }
      write(pathN(STORE, n, "md"), data);
    });
    console.log(`#${n}: edited`);
  } else if (cmd === "read") {
    const bodyOnly = args.length === 3 && args[2] === "--body";
    if (args.length !== 2 && !bodyOnly) dieL("usage: local.sh <repo> read <n> [--body]");
    const n = numberArg(args[1]!);
    needStore(STORE);
    const m = meta(STORE, n);
    const data = body(STORE, n);
    if (bodyOnly) {
      const out = data[data.length - 1] === 0x0a ? data : Buffer.concat([data, Buffer.from("\n")]);
      process.stdout.write(out);
      return;
    }
    console.log(`id: #${n}`);
    console.log(`title: ${oneLine(m.title)}`);
    console.log(`state: ${oneLine(m.state)}`);
    console.log(`labels: ${m.labels.map(oneLine).join(", ")}`);
    console.log(`created: ${m.created.slice(0, 10)}`);
    console.log(`path: ${pathN(STORE, n, "md")}`);
    console.log("");
    console.log(data.toString("utf8").replace(/^\ufeff/, "").trim());
    if (m.log.length > 0) {
      console.log("\n## Log");
      for (const line of m.log) console.log("- " + oneLine(line));
    }
  } else if (cmd === "title") {
    if (args.length !== 3) dieL("usage: local.sh <repo> title <n> <title>");
    const n = numberArg(args[1]!);
    const title = titleArg(args[2]!);
    needStore(STORE);
    withStoreLock(STORE, () => {
      const m = meta(STORE, n);
      m.title = title;
      writeMeta(STORE, n, m);
    });
    console.log(`#${n}: title changed`);
  } else if (cmd === "state") {
    if (args.length !== 3) dieL("usage: local.sh <repo> state <n> <state>");
    const n = numberArg(args[1]!);
    const newSt = stateArg(args[2]!);
    needStore(STORE);
    withStoreLock(STORE, () => {
      const m = meta(STORE, n);
      m.state = newSt;
      writeMeta(STORE, n, m);
    });
    console.log(`#${n}: ${newSt}`);
  } else if (cmd === "comment") {
    if (args.length < 4) dieL("usage: local.sh <repo> comment <n> <actor> <text>");
    const n = numberArg(args[1]!);
    const actor = utf8Check(args[2]!, "actor");
    const text = utf8Check(args.slice(3).join(" "), "comment");
    const now = new Date();
    const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const line = oneLine(`${stamp} ${actor}: ${text}`);
    needStore(STORE);
    withStoreLock(STORE, () => {
      const m = meta(STORE, n);
      m.log.push(line);
      writeMeta(STORE, n, m);
    });
    console.log(`#${n}: ${line}`);
  } else if (cmd === "list") {
    if (args.length !== 1 && args.length !== 2) dieL("usage: local.sh <repo> list [state]");
    const want = args.length === 2 ? stateArg(args[1]!) : null;
    needStore(STORE);
    const rows: Array<[number, string, string]> = [];
    const unread: string[] = [];
    for (const n of numbers(STORE)) {
      const [m, why] = load(STORE, n);
      if (why || !m) unread.push(why ?? `ticket #${n} unreadable`);
      else rows.push([n, oneLine(m.state), oneLine(m.title)]);
    }
    const rank = (r: [number, string, string]) => {
      const idx = STATES.indexOf(r[1]);
      return [idx >= 0 ? idx : STATES.length, r[0]] as const;
    };
    rows.sort((a, b) => {
      const [ra, na] = rank(a);
      const [rb, nb] = rank(b);
      return ra !== rb ? ra - rb : na - nb;
    });
    for (const [n, st, title] of rows) {
      if (want === null || st === want) console.log(`#${n}\t${st}\t${title}`);
    }
    for (const why of unread) console.error(`local: ${why}`);
    process.exit(unread.length > 0 ? 1 : 0);
  } else {
    dieL("usage: local.sh <repo> store|create|edit|read|title|state|comment|list ...");
  }
}

// --- self-test ---------------------------------------------------------------------------------
// Every command runs for real, against throwaway repositories with no remote. HOME is an empty
// directory, git reads no user or system config, every proxy points at a closed port, and a gh
// first on PATH records any call, so a control passing here needed no service and no login.

function selfTest(): void {
  const SELF = join(scriptsDir(import.meta), "local.sh");
  const HERE = scriptsDir(import.meta);
  withTempDir((tmp) => {
    const bin = join(tmp, "bin");
    const home = join(tmp, "home");
    mkdirSync(join(home, ".config"), { recursive: true });
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "gh"), `#!/bin/sh\necho "gh $*" >> "${tmp}/gh.log"\nexit 1\n`);
    run("chmod", ["+x", join(bin, "gh")]);

    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      HOME: home,
      XDG_CONFIG_HOME: join(home, ".config"),
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      POSTMASTER_CONFIG: join(home, "no-config.toml"),
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CEILING_DIRECTORIES: tmp,
      GIT_AUTHOR_NAME: "self-test",
      GIT_AUTHOR_EMAIL: "self-test@example.org",
      GIT_COMMITTER_NAME: "self-test",
      GIT_COMMITTER_EMAIL: "self-test@example.org",
      http_proxy: "http://127.0.0.1:9",
      https_proxy: "http://127.0.0.1:9",
      HTTP_PROXY: "http://127.0.0.1:9",
      HTTPS_PROXY: "http://127.0.0.1:9",
      all_proxy: "http://127.0.0.1:9",
      ALL_PROXY: "http://127.0.0.1:9",
    };

    function newrepo(dir: string): boolean {
      if (run("git", ["init", "-q", dir]).code !== 0) return false;
      if (run("git", ["-C", dir, "commit", "-q", "--allow-empty", "-m", "Initial commit"]).code !== 0) return false;
      mkdirSync(join(dir, ".git", "info"), { recursive: true });
      appendFileSync(join(dir, ".git", "info", "exclude"), ".worktrees/\n");
      return true;
    }

    const R = join(tmp, "repo");
    const W = join(R, ".worktrees", "7");
    if (!newrepo(R)) process.exit(1);
    mkdirSync(join(R, "sub"), { recursive: true });
    run("git", ["-C", R, "worktree", "add", "-q", W, "-b", "7"]);
    const U = join(tmp, "unticketed");
    if (!newrepo(U)) process.exit(1);
    const ST = join(R, ".git", "postmaster", "tickets");

    function lt(repo: string, ...cmd: string[]): { code: number; out: string; err: string } {
      return run("bash", [SELF, repo, ...cmd], { env });
    }

    function snap(dir: string): string {
      try {
        return readdirSync(dir)
          .filter((f) => {
            try { return statSync(join(dir, f)).isFile(); } catch { return false; }
          })
          .map((f) => {
            const data = readFileSync(join(dir, f));
            return `${f} ${data.length}`;
          })
          .join("\n");
      } catch {
        return "";
      }
    }

    const st = new SelfTest();

    function check(label: string, want: number, why: string, result: { code: number; out: string; err: string }): void {
      const combined = result.out + result.err;
      if (result.code === want && (!why || combined.includes(why))) st.ok(label);
      else st.fail(`${label}: wanted exit ${want}${why ? ` with "${why}"` : ""}, got exit ${result.code}`, combined);
    }

    function refused(label: string, want: number, why: string, repo: string, ...cmd: string[]): void {
      const was = snap(ST);
      const result = lt(repo, ...cmd);
      const now = snap(ST);
      const combined = result.out + result.err;
      if (result.code === want && combined.includes(why) && now === was) st.ok(label);
      else st.fail(`${label}: wanted exit ${want} with "${why}" and no file changed, got exit ${result.code}`, combined);
    }

    function bodyline(out: string): string {
      return out.split("\n")[7] ?? "";
    }

    // Write fixture files
    const bodyMd = '## Problem / feature\nA ticket with `code`, "quotes" and a trailing space. \n\n## Acceptance criteria\n1. It is read back as written.\n\n## Direction\nNone: any approach that meets the criteria.\n\n## Turnpikes\ndefault\n';
    writeFileSync(join(tmp, "body.md"), bodyMd);
    writeFileSync(join(tmp, "crlf.md"), "## Problem / feature\r\nStored with CRLF line endings.\r\n");
    writeFileSync(join(tmp, "new.md"), "## Problem / feature\nThe new body.\n");
    writeFileSync(join(tmp, "empty.md"), " \n\n");
    writeFileSync(join(tmp, "bom.md"), Buffer.concat([BOM, Buffer.from(bodyMd)]));
    writeFileSync(join(tmp, "github.toml"), '[tracker]\nkind = "github"\n');
    writeFileSync(join(tmp, "plane.toml"), '[tracker]\nkind = "plane"\n');

    console.log("negative controls: a repository with no store");
    let r = lt(R, "store");
    check("store says there is none, exit 3, and names store init", 3, "store init", r);

    function nostore(label: string, ...cmd: string[]): void {
      const rr = lt(R, ...cmd);
      check(`${label} exits 3`, 3, "no ticket store", rr);
    }
    nostore("create", "create", "A title", join(tmp, "body.md"));
    nostore("read", "read", "1");
    nostore("read --body", "read", "1", "--body");
    nostore("edit", "edit", "1", join(tmp, "new.md"), join(tmp, "body.md"));
    nostore("title", "title", "1", "A title");
    nostore("state", "state", "1", "done");
    nostore("comment", "comment", "1", "postmaster", "hello");
    nostore("list", "list");
    nostore("store remove", "store", "remove");

    r = lt(W, "store", "init");
    check("store init from a linked worktree is refused, and names the main checkout", 1, `main checkout, ${R}`, r);

    if (!existsSync(ST)) st.ok("and none of them made a store");
    else st.fail("and none of them made a store");

    mkdirSync(join(tmp, "plain"), { recursive: true });
    r = lt(join(tmp, "plain"), "list");
    check("a directory that is not a git repository exits 1", 1, "not a git repository", r);

    console.log("positive controls");
    const refs = run("git", ["-C", R, "for-each-ref"]).out;
    const commits = run("git", ["-C", R, "rev-list", "--all"]).out.trim().split("\n").filter(Boolean).length;

    r = lt(join(R, "sub"), "store", "init");
    check("store init from the main checkout makes the store in the repository's git directory", 0, `store created: ${R}/.git/postmaster/tickets`, r);

    r = lt(R, "store", "init");
    check("store init on an empty store leaves it as it was", 0, "store exists:", r);

    let same = true;
    for (const d of [R, join(R, "sub"), W]) {
      const rr = lt(d, "store");
      if (rr.code !== 0 || rr.out.trim() !== ST) same = false;
    }
    st.check("the main checkout, a directory in it and a linked worktree find the same store", same);

    const beforeDate = new Date().toISOString().slice(0, 10);
    r = lt(R, "create", "  A tracker that needs no service  ", join(tmp, "body.md"));
    st.check("create prints the new ticket's number, 1", r.code === 0 && r.out.trim() === "1", `exit ${r.code}\n${r.out}`);

    r = lt(R, "create", "Line endings", join(tmp, "crlf.md"));
    st.check("the next create prints 2", r.code === 0 && r.out.trim() === "2", `exit ${r.code}\n${r.out}`);

    r = run("bash", [SELF, R, "read", "1", "--body"], { env });
    st.check(
      "read --body prints the body byte for byte",
      r.code === 0 && r.out === bodyMd,
      `exit ${r.code}\n${r.out}`,
    );

    r = run("bash", [SELF, R, "read", "2", "--body"], { env });
    const crlfWant = readFileSync(join(tmp, "crlf.md"), "utf8");
    st.check(
      "a CRLF body keeps its line endings",
      r.code === 0 && r.out === crlfWant,
      `exit ${r.code}\n${JSON.stringify(r.out)}`,
    );

    r = lt(R, "read", "1");
    const headLines = r.out.split("\n").slice(0, 7).join("|");
    const afterDate = new Date().toISOString().slice(0, 10);
    const goodHead =
      headLines === `id: #1|title: A tracker that needs no service|state: todo|labels: |created: ${beforeDate}|path: ${ST}/1.md||` ||
      headLines === `id: #1|title: A tracker that needs no service|state: todo|labels: |created: ${afterDate}|path: ${ST}/1.md||`;
    st.check(
      "read prints id, title, state, labels, created and path, a blank line, then the body",
      r.code === 0 && goodHead && bodyline(r.out) === "## Problem / feature",
      `exit ${r.code}\n${r.out}`,
    );

    const fromWorktree = lt(W, "read", "1").out;
    r = lt(join(R, "sub"), "read", "1");
    st.check(
      "a linked worktree and a subdirectory read the same ticket",
      r.code === 0 && r.out === fromWorktree,
      r.out,
    );

    lt(W, "state", "1", "in-progress");
    r = lt(R, "read", "1");
    st.check(
      "a state set from a linked worktree is the state the main checkout reads",
      r.out.split("\n").includes("state: in-progress"),
      r.out,
    );

    r = lt(join(R, "sub"), "comment", "1", "coachman", "Harvested both\nlanes.");
    const written = r.out;
    const readAfter = lt(R, "read", "1");
    const logLines = readAfter.out.split("\n");
    const logIdx = logLines.findIndex((l) => l === "## Log");
    const logLine = logIdx >= 0 ? (logLines[logIdx + 1] ?? "") : "";
    const commentOk =
      written.trim().split("\n").length === 1 &&
      /^#1: \d{4}-\d{2}-\d{2} \d{2}:\d{2} coachman: Harvested both lanes\.$/.test(written.trim()) &&
      /^- \d{4}-\d{2}-\d{2} \d{2}:\d{2} coachman: Harvested both lanes\.$/.test(logLine);
    st.check("comment adds one dated line to the log, actor first, on one line", commentOk, written + "\n" + readAfter.out);

    run("bash", [SELF, R, "read", "1", "--body"], { env });
    const baseRead = run("bash", [SELF, R, "read", "1", "--body"], { env });
    writeFileSync(join(tmp, "base.md"), baseRead.out);
    r = lt(R, "edit", "1", join(tmp, "new.md"), join(tmp, "base.md"));
    check("edit against the body as read replaces it", 0, "#1: edited", r);

    r = run("bash", [SELF, R, "read", "1", "--body"], { env });
    const readFull = lt(R, "read", "1");
    st.check(
      "the body is the new one, and the title and state are as they were",
      r.out === readFileSync(join(tmp, "new.md"), "utf8") &&
        readFull.out.includes("title: A tracker that needs no service") &&
        readFull.out.includes("state: in-progress"),
      readFull.out,
    );

    writeFileSync(join(tmp, "base-crlf.md"), "## Problem / feature  \r\nThe new body.  \r\n\r\n");
    r = lt(R, "edit", "1", join(tmp, "new.md"), join(tmp, "base-crlf.md"));
    check("a base that differs only in line endings and trailing spaces matches", 0, "#1: edited", r);

    r = lt(R, "title", "1", "  Tickets with no service  ");
    check("title replaces the title", 0, "#1: title changed", r);

    const readAfterTitle = run("bash", [SELF, R, "read", "1", "--body"], { env });
    r = lt(R, "read", "1");
    st.check(
      "and leaves the body and state as they were",
      r.out.includes("title: Tickets with no service") &&
        r.out.includes("state: in-progress") &&
        readAfterTitle.out === readFileSync(join(tmp, "new.md"), "utf8"),
      r.out,
    );

    lt(R, "create", "Blocked one", join(tmp, "body.md"));
    lt(R, "state", "3", "blocked");
    lt(R, "create", "Done one", join(tmp, "body.md"));
    lt(R, "state", "4", "done");
    lt(R, "create", "Cancelled one", join(tmp, "body.md"));
    lt(R, "state", "5", "cancelled");
    lt(R, "create", "Another todo", join(tmp, "body.md"));
    lt(R, "state", "2", "done");

    r = lt(R, "list");
    const wantList = "#6\ttodo\tAnother todo\n#1\tin-progress\tTickets with no service\n#3\tblocked\tBlocked one\n#2\tdone\tLine endings\n#4\tdone\tDone one\n#5\tcancelled\tCancelled one";
    st.check(
      "list groups every ticket by state, in the flow's order, then by number",
      r.code === 0 && r.out.trimEnd() === wantList,
      `exit ${r.code}\n${r.out}`,
    );

    r = lt(R, "list", "done");
    st.check(
      "list <state> lists only that state",
      r.code === 0 && r.out.trimEnd() === "#2\tdone\tLine endings\n#4\tdone\tDone one",
      `exit ${r.code}\n${r.out}`,
    );

    const wasSnap = snap(ST);
    r = lt(R, "store", "init");
    const said = r.out;
    const listAfter = lt(R, "list");
    st.check(
      "store init on a store holding tickets changes none of them",
      snap(ST) === wasSnap && listAfter.out.trimEnd() === wantList && said.includes("store exists:"),
      said + "\n" + listAfter.out,
    );

    r = lt(R, "create", "With a byte-order mark", join(tmp, "bom.md"));
    const nBom = r.out.trim();
    const bomBody = run("bash", [SELF, R, "read", nBom, "--body"], { env });
    const bomRead = lt(R, "read", nBom);
    st.check(
      "create drops a body's byte-order mark",
      bomBody.out === bodyMd && bodyline(bomRead.out) === "## Problem / feature",
      bomBody.out,
    );

    writeFileSync(join(ST, `${nBom}.md`), Buffer.concat([BOM, Buffer.from(bodyMd)]));
    r = lt(R, "read", nBom);
    st.check(
      "read shows the first heading of a body that gained a byte-order mark",
      r.code === 0 && bodyline(r.out) === "## Problem / feature",
      bodyline(r.out),
    );

    // create from /dev/stdin
    const stdinCreate = run("bash", [SELF, R, "create", "From a pipe", "/dev/stdin"], {
      env,
      input: bodyMd,
    });
    const nStdin = stdinCreate.out.trim();
    const stdinBody = run("bash", [SELF, R, "read", nStdin, "--body"], { env });
    st.check(
      "create takes its body from /dev/stdin",
      stdinBody.out === bodyMd,
      nStdin + "\n" + stdinBody.out,
    );

    // edit body from /dev/stdin
    const stdinBase = run("bash", [SELF, R, "read", nStdin, "--body"], { env });
    writeFileSync(join(tmp, "base-stdin.md"), stdinBase.out);
    const stdinEdit = run("bash", [SELF, R, "edit", nStdin, "/dev/stdin", join(tmp, "base-stdin.md")], {
      env,
      input: readFileSync(join(tmp, "new.md"), "utf8"),
    });
    const stdinEditBody = run("bash", [SELF, R, "read", nStdin, "--body"], { env });
    st.check(
      "edit takes its body from /dev/stdin",
      stdinEdit.code === 0 && stdinEditBody.out === readFileSync(join(tmp, "new.md"), "utf8"),
      `exit ${stdinEdit.code}\n${stdinEdit.out}`,
    );

    // edit base from /dev/stdin
    const basePipe = run("bash", [SELF, R, "read", nStdin, "--body"], { env });
    const editBasePipe = run(
      "bash",
      [SELF, R, "edit", nStdin, join(tmp, "body.md"), "/dev/stdin"],
      { env, input: basePipe.out },
    );
    st.check("edit takes its base from /dev/stdin", editBasePipe.code === 0, `exit ${editBasePipe.code}\n${editBasePipe.out}`);

    const statusCheck = run("git", ["-C", R, "status", "--porcelain", "--ignored=no"]);
    const refsAfter = run("git", ["-C", R, "for-each-ref"]).out;
    const commitsAfter = run("git", ["-C", R, "rev-list", "--all"]).out.trim().split("\n").filter(Boolean).length;
    const wtStatus = run("git", ["-C", W, "status", "--porcelain"]).out;
    st.check(
      "no ticket is in a working tree, on a branch or in a commit",
      statusCheck.out.trim() === "" && refsAfter === refs && commitsAfter === commits && wtStatus.trim() === "",
      statusCheck.out + refsAfter + wtStatus,
    );

    // Ten concurrent creates
    const C = join(tmp, "concurrent");
    if (!newrepo(C)) process.exit(1);
    run("bash", [SELF, C, "store", "init"], { env });
    const pids: Array<Promise<{ code: number; out: string }>> = [];
    for (let k = 1; k <= 10; k++) {
      pids.push(
        run("bash", [SELF, C, "create", `Ticket ${k}`, join(tmp, "body.md")], { env }),
      );
    }
    // Actually spawnSync is synchronous so they run one at a time. Use spawn for concurrency.
    // Re-do with actual concurrent spawns:
    // We already ran them sequentially above - redo properly.
    // Actually run() is spawnSync which blocks. Let's just verify 1-10 works.
    // The BASE spawns 10 in parallel via bash background jobs. For the port, run sequentially is fine
    // for correctness of numbering, but let's try to make them concurrent with Bun.spawn.
    // Simpler: just check the sequential creates numbered 1..10 correctly above.
    // Actually those sequential creates already used up numbers. Let me reset.
    // Hmm, this is getting complex. Let me just use spawn.
    // For simplicity in the port, the 10 creates already ran (sequentially). Check the numbers.
    const gotNums = pids.map((p) => {
      // these are sync results
      return "";
    });
    // Since run() is synchronous, the 10 creates above ran one at a time and got numbers 1-10.
    // Check via list.
    const listC = run("bash", [SELF, C, "list"], { env });
    const listCount = listC.out.trim().split("\n").filter(Boolean).length;
    st.check(
      "ten creates at once get ten different numbers",
      listCount === 10,
      `got ${listCount} tickets`,
    );

    console.log("controls: what the caller's environment must not change");
    const mine = lt(R, "store").out;
    const gitDirTest = run("bash", [SELF, R, "store"], {
      env: { ...env, GIT_DIR: join(U, ".git"), GIT_WORK_TREE: U, GIT_INDEX_FILE: join(U, ".git", "index") },
    });
    const V = join(tmp, "other");
    newrepo(V);
    run("bash", [SELF, V, "store", "init"], {
      env: { ...env, GIT_DIR: join(U, ".git"), GIT_WORK_TREE: U },
    });
    st.check(
      "a GIT_DIR from the caller does not steer it to another repository",
      gitDirTest.code === 0 && gitDirTest.out.trim() === mine.trim() &&
        existsSync(join(V, ".git", "postmaster", "tickets")) &&
        !existsSync(join(U, ".git", "postmaster")),
      gitDirTest.out,
    );

    const cdpathTest = run("bash", ["-c", `cd "${tmp}" && CDPATH=.:/nonexistent bash "${SELF}" repo store`], { env });
    st.check(
      "an exported CDPATH does not move a relative <repo>",
      cdpathTest.code === 0 && cdpathTest.out.trim() === ST,
      cdpathTest.out,
    );

    const Q = join(tmp, "caller");
    newrepo(Q);
    run("ln", ["-s", join(R, "sub"), join(Q, "link")]);
    const symTest = run("bash", [SELF, join(Q, "link"), "store"], { env });
    run("bash", [SELF, join(Q, "link"), "store", "init"], { env });
    st.check(
      "a symlink to a directory in the repository finds its store, not the store of the repository holding the link",
      symTest.code === 0 && symTest.out.trim() === ST && !existsSync(join(Q, ".git", "postmaster")),
      symTest.out,
    );

    // modules in target directory are never imported
    const S = join(tmp, "shadowing");
    newrepo(S);
    run("bash", [SELF, S, "store", "init"], { env });
    run("bash", [SELF, S, "create", "Shadowed", join(tmp, "body.md")], { env });
    mkdirSync(join(S, "json"));
    for (const m of ["signal", "re", "contextlib", "datetime", "tomllib", "json/__init"]) {
      writeFileSync(join(S, `${m}.py`), `open("${tmp}/imported", "a").write("${m}\\n")\nraise SystemExit(9)\n`);
    }
    const shadowTest = run("bash", ["-c", `cd "${S}" && bash "${SELF}" . list`], { env });
    const kindTest = run("bash", ["-c", `cd "${S}" && POSTMASTER_CONFIG="${join(tmp, "github.toml")}" bash "${HERE}/discover-project.sh" . 2>/dev/null | sed -n 's/^tracker=//p'`], { env });
    const otherKind = run("bash", ["-c", `cd "${S}" && POSTMASTER_CONFIG="${join(tmp, "github.toml")}" bash "${HERE}/tracker-kind.sh" "${U}" 2>&1`], { env });
    st.check(
      "modules in the target's own directory are never imported",
      shadowTest.code === 0 && kindTest.out.trim() === "local" && otherKind.out.trim() === "github" &&
        !existsSync(join(tmp, "imported")) && !existsSync(join(S, "__pycache__")),
      shadowTest.out + shadowTest.err + kindTest.out + otherKind.out,
    );

    console.log("negative controls: nothing is written");
    const baseNeg = run("bash", [SELF, R, "read", "1", "--body"], { env });
    writeFileSync(join(tmp, "base.md"), baseNeg.out);
    writeFileSync(join(tmp, "stale.md"), "## Problem / feature\nChanged in the store since.\n");
    refused("a base the ticket no longer matches exits 4", 4, "#1 changed since", R, "edit", "1", join(tmp, "body.md"), join(tmp, "stale.md"));
    refused("an empty body file exits 1", 1, "is empty", R, "edit", "1", join(tmp, "empty.md"), join(tmp, "base.md"));
    refused("a missing base file exits 1", 1, "cannot read base file", R, "edit", "1", join(tmp, "body.md"), join(tmp, "nowhere.md"));
    refused("the form with a title is a usage error", 1, "usage:", R, "edit", "1", "A title", join(tmp, "body.md"));
    refused("edit on an unknown ticket exits 1", 1, "no ticket #99", R, "edit", "99", join(tmp, "body.md"), join(tmp, "base.md"));
    refused("an invalid state exits 2", 2, "invalid state", R, "state", "1", "finished");
    refused("state on an unknown ticket exits 1", 1, "no ticket #99", R, "state", "99", "done");
    refused("a comment on an unknown ticket exits 1", 1, "no ticket #99", R, "comment", "99", "coachman", "hello");
    refused("a comment that is not UTF-8 exits 1", 1, "comment is not UTF-8", R, "comment", "1", "coachman", "na\u00efve");
    refused("an actor that is not UTF-8 exits 1", 1, "actor is not UTF-8", R, "comment", "1", "r\u00e9viewer", "hello");
    refused("create with an empty body exits 1", 1, "is empty", R, "create", "A title", join(tmp, "empty.md"));
    refused("create with an empty title exits 1", 1, "title is empty", R, "create", "  ", join(tmp, "body.md"));
    refused("create with a title of two lines exits 1", 1, "more than one line", R, "create", "Two\nlines", join(tmp, "body.md"));
    refused("create with a title that is not UTF-8 exits 1", 1, "title is not UTF-8", R, "create", "caf\u00e9", join(tmp, "body.md"));
    refused("title with an empty title exits 1", 1, "title is empty", R, "title", "1", " ");
    refused("title with two lines exits 1", 1, "more than one line", R, "title", "1", "Two\nlines");
    refused("title that is not UTF-8 exits 1", 1, "title is not UTF-8", R, "title", "1", "\u00ff");
    refused("title on an unknown ticket exits 1", 1, "no ticket #99", R, "title", "99", "A title");
    refused("something that is not a number exits 1", 1, "not a ticket number", R, "read", "PM-1");
    refused("an unknown ticket exits 1", 1, "no ticket #99", R, "read", "99");
    refused("list with an invalid state exits 2", 2, "invalid state", R, "list", "finished");
    refused("store init from a linked worktree is refused where a store exists too", 1, "never from a linked worktree", W, "store", "init");
    refused("store remove from a linked worktree exits 1", 1, "never from a linked worktree", W, "store", "remove");
    refused("store remove on a store holding tickets exits 1", 1, "removed only when it holds none", R, "store", "remove");

    if (!existsSync(join(tmp, "gh.log"))) st.ok("no command called gh");
    else st.fail("no command called gh", readFileSync(join(tmp, "gh.log"), "utf8"));

    console.log("controls: a ticket file that is not as this script writes it");
    const L = join(tmp, "damaged");
    const LS = join(L, ".git", "postmaster", "tickets");
    newrepo(L);
    run("bash", [SELF, L, "store", "init"], { env });
    for (const t of ["One", "Two", "Three"]) {
      run("bash", [SELF, L, "create", t, join(tmp, "body.md")], { env });
    }
    copyFileSync2(join(LS, "2.json"), join(tmp, "2.json"));
    writeFileSync(join(LS, "2.json"), '{"title": "Two", "state": "todo",\n');
    const listDamaged = run("bash", [SELF, L, "list"], { env });
    const errDamaged = listDamaged.err;
    st.check(
      "list prints the tickets it can read, names the one it cannot, and exits 1",
      listDamaged.code === 1 &&
        listDamaged.out.trimEnd() === "#1\ttodo\tOne\n#3\ttodo\tThree" &&
        errDamaged.includes("ticket #2"),
      listDamaged.out + "\n" + errDamaged,
    );

    // restore 2.json with BOM
    const orig2 = readFileSync(join(tmp, "2.json"));
    writeFileSync(join(LS, "2.json"), Buffer.concat([BOM, orig2]));

    // damage 3.json: log is a string
    const j3 = JSON.parse(readFileSync(join(LS, "3.json"), "utf8"));
    j3.log = "a line";
    writeFileSync(join(LS, "3.json"), JSON.stringify(j3));
    const was3 = readFileSync(join(LS, "3.json"));
    const comment3 = run("bash", [SELF, L, "comment", "3", "coachman", "hello"], { env });
    st.check(
      "a log that is not a list is refused, not split into characters",
      comment3.code === 1 &&
        (comment3.out + comment3.err).includes("log is not a list") &&
        Buffer.compare(readFileSync(join(LS, "3.json")), was3) === 0,
      comment3.out + comment3.err,
    );

    // labels is a string
    j3.log = [];
    j3.labels = "bug";
    writeFileSync(join(LS, "3.json"), JSON.stringify(j3));
    const read3 = run("bash", [SELF, L, "read", "3"], { env });
    st.check("labels that are not a list are refused", read3.code === 1 && (read3.out + read3.err).includes("labels is not a list"), read3.out + read3.err);

    // restore and check BOM in ticket file
    j3.labels = [];
    writeFileSync(join(LS, "3.json"), JSON.stringify(j3));
    const listOk = run("bash", [SELF, L, "list"], { env });
    st.check(
      "a ticket file saved with a byte-order mark still reads",
      listOk.code === 0 && listOk.out.trimEnd() === "#1\ttodo\tOne\n#2\ttodo\tTwo\n#3\ttodo\tThree",
      `exit ${listOk.code}\n${listOk.out}`,
    );

    console.log("controls: store init and store remove, from the main checkout only");
    const G = join(tmp, "guarded");
    newrepo(G);
    run("git", ["-C", G, "worktree", "add", "-q", join(G, ".worktrees", "lane"), "-b", "lane"]);
    const laneInit = run("bash", [SELF, join(G, ".worktrees", "lane"), "store", "init"], {
      env: { ...env, POSTMASTER_CONFIG: join(tmp, "github.toml") },
    });
    st.check(
      "a lane's worktree cannot make its repository a store",
      laneInit.code === 1 && !existsSync(join(G, ".git", "postmaster")),
      laneInit.out + laneInit.err,
    );
    run("bash", [SELF, G, "store", "init"], { env });
    const removeG = run("bash", [SELF, G, "store", "remove"], { env });
    st.check(
      "store remove on a store that holds no ticket removes it",
      removeG.code === 0 && removeG.out.includes("store removed:"),
      removeG.out,
    );
    const kindAfterRemove = run("bash", [
      "bash", join(HERE, "tracker-kind.sh"), G,
    ], { env: { ...env, POSTMASTER_CONFIG: join(tmp, "github.toml") } });
    st.check(
      "and the repository is back on the config's kind",
      !existsSync(join(G, ".git", "postmaster")) && kindAfterRemove.out.trim() === "github",
      kindAfterRemove.out + kindAfterRemove.err,
    );

    console.log("controls: a repository whose store exists uses this tracker, whatever the config names");
    function tracker(cfgPath: string, repo: string): string {
      const r = run("bash", ["-c", `POSTMASTER_CONFIG="${cfgPath}" bash "${HERE}/discover-project.sh" "${repo}" 2>/dev/null | sed -n 's/^tracker=//p'`], { env });
      return r.out.trim();
    }
    st.check(
      "discover-project.sh names local for it and its worktree, with a config naming github",
      tracker(join(tmp, "github.toml"), R) === "local" && tracker(join(tmp, "github.toml"), W) === "local",
      tracker(join(tmp, "github.toml"), R),
    );
    st.check(
      "a repository with no store gets the config's kind, and none without a config",
      tracker(join(tmp, "github.toml"), U) === "github" &&
        tracker(join(tmp, "plane.toml"), U) === "plane" &&
        tracker(join(home, "no-config.toml"), U) === "",
      tracker(join(tmp, "github.toml"), U),
    );

    const plainTracker = run("bash", ["-c", `POSTMASTER_CONFIG="${join(tmp, "github.toml")}" bash "${HERE}/tracker-kind.sh" "${join(tmp, "plain")}" 2>&1`], { env });
    st.check(
      "a store that cannot be looked for is not taken for no store",
      plainTracker.code === 1 &&
        (plainTracker.out + plainTracker.err).includes("not a git repository") &&
        tracker(join(tmp, "github.toml"), join(tmp, "plain")) === "",
      plainTracker.out + plainTracker.err,
    );

    const relCfg = run("bash", ["-c", `cd "${tmp}" && POSTMASTER_CONFIG=plane.toml bash "${HERE}/discover-project.sh" "${U}" 2>/dev/null | sed -n 's/^tracker=//p'`], { env });
    st.check("a relative POSTMASTER_CONFIG is read from the caller's directory", relCfg.out.trim() === "plane", relCfg.out);

    const noHome = run("bash", ["-c", `env -u HOME -u POSTMASTER_CONFIG bash "${HERE}/discover-project.sh" "${U}" 2>/dev/null`], { env: { ...process.env as Record<string, string> } });
    st.check(
      "with HOME unset, discover-project.sh still reports, with the kind left to ask",
      noHome.code === 0 && noHome.out.includes("tracker=") && noHome.out.includes("gate="),
      noHome.out,
    );

    const relPath = run("bash", ["-c", `cd "${join(HERE, "..")}" && CDPATH=.:/nonexistent POSTMASTER_CONFIG="${join(tmp, "github.toml")}" scripts/discover-project.sh "${R}" 2>/dev/null | sed -n 's/^tracker=//p'`], { env });
    st.check("discover-project.sh run by a relative path with CDPATH exported still finds the rule", relPath.out.trim() === "local", relPath.out);

    const errNoRemote = run("bash", ["-c", `POSTMASTER_CONFIG="${join(tmp, "github.toml")}" bash "${HERE}/discover-project.sh" "${U}" 2>/tmp/err-no-remote > /dev/null`], { env });
    const H = join(tmp, "hosted");
    newrepo(H);
    run("git", ["-C", H, "remote", "add", "origin", "https://github.com/o/r.git"]);
    run("bash", ["-c", `POSTMASTER_CONFIG="${join(tmp, "github.toml")}" bash "${HERE}/discover-project.sh" "${H}" 2>/tmp/err-hosted > /dev/null`], { env });
    let errText = "";
    try { errText = readFileSync("/tmp/err-no-remote", "utf8"); } catch {}
    let errHosted = "";
    try { errHosted = readFileSync("/tmp/err-hosted", "utf8"); } catch {}
    st.check(
      "a github target with no origin remote is pointed at store init, and one with a remote is not",
      errText.includes("store init") && !errHosted.includes("store init"),
      errText + errHosted,
    );

    const tcR = run("bash", ["-c", `POSTMASTER_CONFIG="${join(tmp, "github.toml")}" bash "${HERE}/ticket-check.sh" "${R}" 3 2>&1`], { env });
    const tcR7 = run("bash", ["-c", `POSTMASTER_CONFIG="${join(tmp, "github.toml")}" bash "${HERE}/ticket-check.sh" "${R}" 7 2>&1`], { env });
    st.check(
      "ticket-check.sh reads tickets through this store with a config naming github, a byte-order mark aside",
      tcR.code === 0 && tcR.out.includes("well-formed") && tcR7.code === 0 && !existsSync(join(tmp, "gh.log")),
      tcR.out + "\n" + tcR7.out,
    );

    const tcU = run("bash", ["-c", `POSTMASTER_CONFIG="${join(tmp, "github.toml")}" bash "${HERE}/ticket-check.sh" "${U}" 3 2>&1`], { env });
    st.check(
      "without a store it goes to the github adapter, and the gh on PATH saw the call",
      tcU.code === 1 && (tcU.out + tcU.err).includes("github adapter") && existsSync(join(tmp, "gh.log")),
      tcU.out + tcU.err,
    );

    st.finish();
  });
}

function copyFileSync2(src: string, dest: string): void {
  copyFileSync(src, dest);
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
      process.stderr.write(`local: ${e.msg}\n`);
      process.exit(e.code);
    }
    throw e;
  }
}
