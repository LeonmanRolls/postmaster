import {
  appendFileSync,
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  rmdirSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { command, scriptDir, writeError, writeOut } from "./lib/core.ts";

const states = ["todo", "in-progress", "blocked", "done", "cancelled"];
const args = process.argv.slice(2);
const unsetGit = {
  GIT_DIR: undefined,
  GIT_WORK_TREE: undefined,
  GIT_COMMON_DIR: undefined,
  GIT_INDEX_FILE: undefined,
  GIT_OBJECT_DIRECTORY: undefined,
  GIT_ALTERNATE_OBJECT_DIRECTORIES: undefined,
  GIT_NAMESPACE: undefined,
};
class LocalFailure extends Error {
  constructor(
    message: string,
    readonly code = 1,
  ) {
    super(message);
  }
}
function die(message: string, code = 1): never {
  throw new LocalFailure(message, code);
}
function usage(text: string): never {
  return die(`usage: local.sh <repo> ${text}`);
}
function utf8(value: string, what: string): string {
  if (value.includes("\ufffd")) die(`the ${what} is not UTF-8`);
  return value;
}
function titleArg(value: string): string {
  const title = utf8(value, "title").trim();
  if (!title) die("the title is empty");
  if (title.includes("\n") || title.includes("\r")) die("the title is more than one line");
  return title;
}
function numberArg(value: string): bigint {
  if (!/^#?0*[1-9]\d*$/.test(value)) die(`not a ticket number: ${value}`);
  return BigInt(value.replace(/^#/, ""));
}
function stateArg(value: string): string {
  if (!states.includes(value)) die(`invalid state ${value} (one of: ${states.join(", ")})`, 2);
  return value;
}
function commonGitPath(repo: string, option: string): string {
  const result = command("git", ["-C", repo, "rev-parse", option], { env: unsetGit });
  if (result.code !== 0) die(`not a git repository: ${repo}`);
  const value = result.stdout.trim();
  let physicalRepo: string;
  try {
    physicalRepo = realpathSync(repo);
  } catch {
    physicalRepo = resolve(repo);
  }
  try {
    return realpathSync(value.startsWith("/") ? value : join(physicalRepo, value));
  } catch {
    return resolve(repo, value);
  }
}
type RepoInfo = { store: string; main: string; repo: string };
function repoInfo(repo: string): RepoInfo {
  if (!existsSync(repo) || !statSync(repo).isDirectory()) die(`no such directory: ${repo}`);
  const common = commonGitPath(repo, "--git-common-dir");
  const gitdir = commonGitPath(repo, "--git-dir");
  let main = "";
  if (gitdir !== common) {
    const result = command("git", ["-C", repo, "worktree", "list", "--porcelain"], { env: unsetGit });
    main =
      result.stdout
        .split(/\r?\n/)
        .find((line: string) => line.startsWith("worktree "))
        ?.slice("worktree ".length) ?? "the main checkout";
  }
  return { store: join(common, "postmaster", "tickets"), main, repo };
}
type Meta = { title: string; state: string; labels: string[]; created: string; log: string[]; [key: string]: unknown };
function needStore(store: string): void {
  if (!existsSync(store) || !statSync(store).isDirectory())
    die(`no ticket store at ${store}; with the user's word, run: local.sh <repo> store init`, 3);
}
function ticketPath(store: string, number: bigint, ext: string): string {
  return join(store, `${number}.${ext}`);
}
function oneLine(value: string): string {
  return value.split(/\s+/).filter(Boolean).join(" ");
}
function readBytes(path: string, what: string): Uint8Array {
  try {
    return readFileSync(path) as Uint8Array;
  } catch (error) {
    const reason =
      (error as any)?.code === "EACCES"
        ? "Permission denied"
        : (error as any)?.code === "ENOENT"
          ? "No such file or directory"
          : String((error as any)?.message ?? error);
    die(`cannot read ${what} ${path}: ${reason}`);
  }
}
function decode(bytes: Uint8Array, path: string, what: string, fatal = true): string {
  try {
    return new TextDecoder("utf-8", { fatal }).decode(bytes);
  } catch {
    die(`cannot read ${what} ${path}: it is not UTF-8`);
  }
}
function bodyFile(path: string): Uint8Array {
  let data = readBytes(path, "body file");
  if (data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) data = data.slice(3);
  if (!decode(data, path, "body file").trim()) die(`the body file ${path} is empty`);
  return data;
}
function normal(value: string): string {
  const lines = value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd());
  while (lines.length && !lines[0]) lines.shift();
  while (lines.length && !lines.at(-1)) lines.pop();
  return lines.join("\n");
}
function load(store: string, number: bigint): { meta?: Meta; why?: string } {
  const path = ticketPath(store, number, "json");
  let text: string;
  try {
    text = new TextDecoder("utf-8").decode(readFileSync(path) as Uint8Array);
  } catch (error) {
    const code = (error as any)?.code;
    if (code === "ENOENT") return { why: `no ticket #${number} in ${store}` };
    return { why: `cannot read ticket #${number} at ${path}: ${String((error as any)?.message ?? error)}` };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { why: `ticket #${number} at ${path} is not valid JSON: ${String((error as any)?.message ?? error)}` };
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    return { why: `ticket #${number} at ${path} is not a JSON object` };
  const meta = value as Record<string, unknown>;
  for (const key of ["title", "state", "created"])
    if (typeof meta[key] !== "string") return { why: `ticket #${number} at ${path} has no ${key} string` };
  for (const key of ["labels", "log"]) {
    const list = meta[key] ?? [];
    if (!Array.isArray(list) || list.some((item) => typeof item !== "string"))
      return { why: `ticket #${number} at ${path}: its ${key} is not a list of strings` };
    meta[key] = list;
  }
  return { meta: meta as Meta };
}
function metaOrDie(store: string, number: bigint): Meta {
  const result = load(store, number);
  if (result.why) die(result.why);
  return result.meta!;
}
function body(store: string, number: bigint): Uint8Array {
  return readBytes(ticketPath(store, number, "md"), `the body of #${number} at`);
}
function atomicFile(path: string, bytes: Uint8Array): void {
  const temporary = `${path}.${process.pid}.tmp`;
  let fd: number | undefined;
  try {
    fd = openSync(temporary, "w", 0o666);
    writeFileSync(fd, bytes);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temporary, path);
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    try {
      rmSync(temporary, { force: true });
    } catch {
      /* The failed temp may already be gone. */
    }
    die(`cannot write ${path}: ${String((error as any)?.message ?? error)}`);
  }
}
function writeMeta(store: string, number: bigint, meta: Meta): void {
  atomicFile(ticketPath(store, number, "json"), new TextEncoder().encode(`${JSON.stringify(meta, null, 2)}\n`));
}
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as any)?.code === "EPERM";
  }
}
function locked<T>(store: string, action: () => T): T {
  needStore(store);
  const lock = join(store, ".lock");
  let fd: number | undefined;
  const start = Date.now();
  while (fd === undefined) {
    try {
      fd = openSync(lock, "wx", 0o644);
      writeFileSync(fd, `${process.pid}\n`);
      fsyncSync(fd);
    } catch (error) {
      if ((error as any)?.code !== "EEXIST") {
        needStore(store);
        die(`cannot lock the store ${store}: ${String((error as any)?.message ?? error)}`);
      }
      try {
        const contents = readFileSync(lock, "utf8").trim();
        const pid = Number(contents);
        if (contents && Number.isInteger(pid) && pid > 0 && !alive(pid)) rmSync(lock, { force: true });
        else if (Date.now() - statSync(lock).mtimeMs > 60000) rmSync(lock, { force: true });
      } catch {
        /* A competing process may have released it. */
      }
      if (Date.now() - start > 120000) die(`cannot lock the store ${store}: lock wait timed out`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15);
    }
  }
  try {
    needStore(store);
    return action();
  } finally {
    if (fd !== undefined) closeSync(fd);
    try {
      rmSync(lock, { force: true });
    } catch {
      /* Store removal may have consumed it. */
    }
  }
}
function numbers(store: string): bigint[] {
  return (readdirSync(store) as string[])
    .filter((name: string) => /^\d+\.json$/.test(name))
    .map((name: string) => BigInt(name.slice(0, -5)))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
function nextNumber(store: string): bigint {
  const used = (readdirSync(store) as string[])
    .filter((name: string) => /^\d+\.(?:json|md)$/.test(name))
    .map((name: string) => BigInt(name.split(".")[0]));
  return used.reduce((max, current) => (current > max ? current : max), 0n) + 1n;
}
function minuteNow(): string {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function run(args: string[]): number {
  if (args.length < 2) return usage("store|create|edit|read|title|state|comment|list ... | --self-test");
  const info = repoInfo(args[0]);
  const [cmd, ...rest] = args.slice(1);
  const { store, main } = info;
  const mainOnly = (what: string) => {
    if (main) die(`${what} runs only from the repository's main checkout, ${main}, never from a linked worktree`);
  };
  if (cmd === "store") {
    if (rest.length === 0) {
      needStore(store);
      writeOut(store);
      return 0;
    }
    if (rest.length === 1 && rest[0] === "init") {
      mainOnly("store init");
      const existed = existsSync(store);
      try {
        mkdirSync(store, { recursive: true });
      } catch (error) {
        die(`cannot make ${store}: ${String((error as any)?.message ?? error)}`);
      }
      writeOut(`store ${existed ? "exists" : "created"}: ${store}`);
      return 0;
    }
    if (rest.length === 1 && rest[0] === "remove") {
      mainOnly("store remove");
      needStore(store);
      locked(store, () => {
        const names = readdirSync(store) as string[];
        const held = new Set(names.filter((name) => /^\d+\.(?:json|md)$/.test(name)).map((name) => name.split(".")[0]));
        if (held.size) die(`the store at ${store} holds ${held.size} ticket(s); it is removed only when it holds none`);
        for (const name of names)
          if (name === ".lock" || /^\d+\.(?:json|md)\.\d+\.tmp$/.test(name)) rmSync(join(store, name), { force: true });
      });
      try {
        rmdirSync(store);
      } catch (error) {
        die(`cannot remove ${store}: ${String((error as any)?.message ?? error)}`);
      }
      try {
        rmdirSync(dirname(store));
      } catch {
        /* postmaster/ can hold other files. */
      }
      writeOut(`store removed: ${store}`);
      return 0;
    }
    return usage("store [init|remove]");
  }
  if (cmd === "create") {
    if (rest.length !== 2) return usage("create <title> <body-file>");
    const title = titleArg(rest[0]);
    const content = bodyFile(rest[1]);
    needStore(store);
    const number = locked(store, () => {
      const n = nextNumber(store);
      atomicFile(ticketPath(store, n, "md"), content);
      const created = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
      writeMeta(store, n, { title, state: "todo", labels: [], created, log: [] });
      return n;
    });
    writeOut(String(number));
    return 0;
  }
  if (cmd === "edit") {
    if (rest.length !== 3 || !existsSync(rest[1]))
      return usage(`edit <n> <body-file> <base-file>${rest.length === 3 ? `; no such body file: ${rest[1]}` : ""}`);
    const number = numberArg(rest[0]);
    const content = bodyFile(rest[1]);
    const base = decode(readBytes(rest[2], "base file"), rest[2], "base file");
    needStore(store);
    locked(store, () => {
      metaOrDie(store, number);
      const current = new TextDecoder("utf-8").decode(body(store, number));
      if (normal(current) !== normal(base.replace(/^\ufeff/, "")))
        die(`#${number} changed since ${rest[2]} was read; read it again`, 4);
      atomicFile(ticketPath(store, number, "md"), content);
    });
    writeOut(`#${number}: edited`);
    return 0;
  }
  if (cmd === "read") {
    const bodyOnly = rest.length === 2 && rest[1] === "--body";
    if (rest.length !== 1 && !bodyOnly) return usage("read <n> [--body]");
    const number = numberArg(rest[0]);
    needStore(store);
    const meta = metaOrDie(store, number);
    const data = body(store, number);
    if (bodyOnly) {
      process.stdout.write(data[data.length - 1] === 10 ? data : new Uint8Array([...data, 10]));
      return 0;
    }
    const displayBody = new TextDecoder("utf-8")
      .decode(data)
      .replace(/^\ufeff/, "")
      .trim();
    const lines = [
      `id: #${number}`,
      `title: ${oneLine(meta.title)}`,
      `state: ${oneLine(meta.state)}`,
      `labels: ${meta.labels.map(oneLine).join(", ")}`,
      `created: ${meta.created.slice(0, 10)}`,
      `path: ${ticketPath(store, number, "md")}`,
      "",
      displayBody,
    ];
    if (meta.log.length) lines.push("", "## Log", ...meta.log.map((entry) => `- ${oneLine(entry)}`));
    process.stdout.write(`${lines.join("\n")}\n`);
    return 0;
  }
  if (cmd === "title") {
    if (rest.length !== 2) return usage("title <n> <title>");
    const number = numberArg(rest[0]);
    const title = titleArg(rest[1]);
    needStore(store);
    locked(store, () => {
      const meta = metaOrDie(store, number);
      meta.title = title;
      writeMeta(store, number, meta);
    });
    writeOut(`#${number}: title changed`);
    return 0;
  }
  if (cmd === "state") {
    if (rest.length !== 2) return usage("state <n> <state>");
    const number = numberArg(rest[0]);
    const state = stateArg(rest[1]);
    needStore(store);
    locked(store, () => {
      const meta = metaOrDie(store, number);
      meta.state = state;
      writeMeta(store, number, meta);
    });
    writeOut(`#${number}: ${state}`);
    return 0;
  }
  if (cmd === "comment") {
    if (rest.length < 3) return usage("comment <n> <actor> <text>");
    const number = numberArg(rest[0]);
    const actor = utf8(rest[1], "actor");
    const text = utf8(rest.slice(2).join(" "), "comment");
    const line = oneLine(`${minuteNow()} ${actor}: ${text}`);
    needStore(store);
    locked(store, () => {
      const meta = metaOrDie(store, number);
      meta.log.push(line);
      writeMeta(store, number, meta);
    });
    writeOut(`#${number}: ${line}`);
    return 0;
  }
  if (cmd === "list") {
    if (rest.length > 1) return usage("list [state]");
    const wanted = rest.length ? stateArg(rest[0]) : undefined;
    needStore(store);
    const rows: [bigint, string, string][] = [];
    const unread: string[] = [];
    for (const number of numbers(store)) {
      const loaded = load(store, number);
      if (loaded.why) unread.push(loaded.why);
      else rows.push([number, oneLine(loaded.meta!.state), oneLine(loaded.meta!.title)]);
    }
    const rank = (state: string) => {
      const index = states.indexOf(state);
      return index < 0 ? states.length : index;
    };
    rows.sort((a, b) => rank(a[1]) - rank(b[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    for (const [number, state, title] of rows)
      if (!wanted || state === wanted) writeOut(`#${number}\t${state}\t${title}`);
    for (const why of unread) writeError(`local: ${why}`);
    return unread.length ? 1 : 0;
  }
  return usage("store|create|edit|read|title|state|comment|list ...");
}

async function selfTest(): Promise<number> {
  const self = join(scriptDir(import.meta.url), "local.sh");
  const here = scriptDir(import.meta.url);
  const temp = makeTemp("local-self-test-");
  const oldEnv = new Map<string, string | undefined>();
  const envKeys = [
    "HOME",
    "XDG_CONFIG_HOME",
    "PATH",
    "POSTMASTER_CONFIG",
    "GIT_CONFIG_NOSYSTEM",
    "GIT_CONFIG_GLOBAL",
    "GIT_CEILING_DIRECTORIES",
    "GIT_AUTHOR_NAME",
    "GIT_AUTHOR_EMAIL",
    "GIT_COMMITTER_NAME",
    "GIT_COMMITTER_EMAIL",
    "http_proxy",
    "https_proxy",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "all_proxy",
    "ALL_PROXY",
  ];
  for (const key of envKeys) oldEnv.set(key, process.env[key]);
  mkdirSync(join(temp, "bin"), { recursive: true });
  mkdirSync(join(temp, "home", ".config"), { recursive: true });
  const ghLog = join(temp, "gh.log");
  const gh = join(temp, "bin", "gh");
  writeFileSync(gh, `#!/bin/sh\nprintf 'gh %s\\n' "$*" >> '${ghLog}'\nexit 1\n`);
  chmodSync(gh, 0o755);
  process.env.HOME = join(temp, "home");
  process.env.XDG_CONFIG_HOME = join(temp, "home", ".config");
  process.env.PATH = `${join(temp, "bin")}:${oldEnv.get("PATH") ?? ""}`;
  process.env.POSTMASTER_CONFIG = join(temp, "home", "no-config.toml");
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  process.env.GIT_CONFIG_GLOBAL = "/dev/null";
  process.env.GIT_CEILING_DIRECTORIES = temp;
  for (const key of ["http_proxy", "https_proxy", "HTTP_PROXY", "HTTPS_PROXY", "all_proxy", "ALL_PROXY"])
    process.env[key] = "http://127.0.0.1:9";
  process.env.GIT_AUTHOR_NAME = "self-test";
  process.env.GIT_AUTHOR_EMAIL = "self-test@example.org";
  process.env.GIT_COMMITTER_NAME = "self-test";
  process.env.GIT_COMMITTER_EMAIL = "self-test@example.org";
  const ok = (label: string) => writeOut(`  ok   ${label}`);
  let fails = 0;
  const fail = (label: string, detail = "") => {
    writeOut(
      `  FAIL ${label}${
        detail
          ? `\n${detail
              .split(/\r?\n/)
              .map((line) => `         ${line}`)
              .join("\n")}`
          : ""
      }`,
    );
    fails++;
  };
  const invoke = (repo: string, ...commandArgs: string[]) => command(self, [repo, ...commandArgs]);
  const output = (result: { stdout: string; stderr: string }) =>
    `${result.stdout.replace(/\n+$/, "")}${result.stderr ? `${result.stdout && !result.stdout.endsWith("\n") ? "\n" : ""}${result.stderr.replace(/\n+$/, "")}` : ""}`;
  const lt = (repo: string, ...commandArgs: string[]) => {
    const result = invoke(repo, ...commandArgs);
    return { code: result.code, out: output(result), stdout: result.stdout, stderr: result.stderr };
  };
  const newRepo = (repo: string): boolean => {
    mkdirSync(repo, { recursive: true });
    if (
      command("git", ["init", "-q", repo]).code !== 0 ||
      command("git", ["-C", repo, "commit", "-q", "--allow-empty", "-m", "Initial commit"]).code !== 0
    )
      return false;
    mkdirSync(join(repo, ".git", "info"), { recursive: true });
    appendFileSync(join(repo, ".git", "info", "exclude"), ".worktrees/\n");
    return true;
  };
  const snapshot = (store: string): string => {
    try {
      return (readdirSync(store) as string[])
        .sort()
        .map((name) => {
          const path = join(store, name);
          return statSync(path).isFile() ? `${name} ${readFileSync(path).toString("hex")}` : "";
        })
        .filter(Boolean)
        .join("\n");
    } catch {
      return "";
    }
  };
  let trackerStore = "";
  const check = (label: string, result: { code: number; out: string }, wanted: number, text = "") => {
    if (result.code === wanted && (!text || result.out.includes(text))) ok(label);
    else fail(`${label}: wanted exit ${wanted}${text ? ` with "${text}"` : ""}, got exit ${result.code}`, result.out);
  };
  const refused = (label: string, wanted: number, text: string, repo: string, ...commandArgs: string[]) => {
    const before = snapshot(trackerStore);
    const result = lt(repo, ...commandArgs);
    result.code === wanted && result.out.includes(text) && snapshot(trackerStore) === before
      ? ok(label)
      : fail(`${label}: wanted exit ${wanted} with "${text}" and no file changed, got exit ${result.code}`, result.out);
  };
  const put = (path: string, text: string) => writeFileSync(path, text);
  try {
    const bodyPath = join(temp, "body.md");
    const crlfPath = join(temp, "crlf.md");
    const newPath = join(temp, "new.md");
    const emptyPath = join(temp, "empty.md");
    const bomPath = join(temp, "bom.md");
    put(
      bodyPath,
      '## Problem / feature\nA ticket with `code`, "quotes" and a trailing space. \n\n## Acceptance criteria\n1. It is read back as written.\n\n## Direction\nNone: any approach that meets the criteria.\n\n## Turnpikes\ndefault\n',
    );
    put(crlfPath, "## Problem / feature\r\nStored with CRLF line endings.\r\n");
    put(newPath, "## Problem / feature\nThe new body.\n");
    put(emptyPath, " \n\n");
    writeFileSync(bomPath, new Uint8Array([0xef, 0xbb, 0xbf, ...readFileSync(bodyPath)]));
    put(join(temp, "github.toml"), '[tracker]\nkind = "github"\n');
    put(join(temp, "plane.toml"), '[tracker]\nkind = "plane"\n');
    const repo = join(temp, "repo");
    const worktree = join(repo, ".worktrees", "7");
    const unticketed = join(temp, "unticketed");
    if (!newRepo(repo) || !newRepo(unticketed)) throw new Error("could not make local tracker fixtures");
    mkdirSync(join(repo, "sub"), { recursive: true });
    if (command("git", ["-C", repo, "worktree", "add", "-q", worktree, "-b", "7"]).code !== 0)
      throw new Error("could not make linked worktree fixture");
    const store = join(repo, ".git", "postmaster", "tickets");
    trackerStore = store;

    writeOut("negative controls: a repository with no store");
    check("store says there is none, exit 3, and names store init", lt(repo, "store"), 3, "store init");
    for (const [label, args] of [
      ["create", ["create", "A title", bodyPath]],
      ["read", ["read", "1"]],
      ["read --body", ["read", "1", "--body"]],
      ["edit", ["edit", "1", newPath, bodyPath]],
      ["title", ["title", "1", "A title"]],
      ["state", ["state", "1", "done"]],
      ["comment", ["comment", "1", "postmaster", "hello"]],
      ["list", ["list"]],
      ["store remove", ["store", "remove"]],
    ] as [string, string[]][])
      check(`${label} exits 3`, lt(repo, ...args), 3, "no ticket store");
    check(
      "store init from a linked worktree is refused, and names the main checkout",
      lt(worktree, "store", "init"),
      1,
      `main checkout, ${repo}`,
    );
    !existsSync(store) ? ok("and none of them made a store") : fail("and none of them made a store");
    const plain = join(temp, "plain");
    mkdirSync(plain);
    check("a directory that is not a git repository exits 1", lt(plain, "list"), 1, "not a git repository");

    writeOut("positive controls");
    const refs = command("git", ["-C", repo, "for-each-ref"]).stdout;
    const commits = command("git", ["-C", repo, "rev-list", "--all"]).stdout.trim().split(/\r?\n/).length;
    check(
      "store init from the main checkout makes the store in the repository's git directory",
      lt(join(repo, "sub"), "store", "init"),
      0,
      `store created: ${store}`,
    );
    check("store init on an empty store leaves it as it was", lt(repo, "store", "init"), 0, "store exists:");
    const same = [repo, join(repo, "sub"), worktree].every((path) => {
      const r = lt(path, "store");
      return r.code === 0 && r.out === store;
    });
    same
      ? ok("the main checkout, a directory in it and a linked worktree find the same store")
      : fail("the main checkout, a directory in it and a linked worktree find the same store");
    const dayBefore = new Date().toISOString().slice(0, 10);
    check(
      "create prints the new ticket's number, 1",
      lt(repo, "create", "  A tracker that needs no service  ", bodyPath),
      0,
      "1",
    );
    const dayAfter = new Date().toISOString().slice(0, 10);
    check("the next create prints 2", lt(repo, "create", "Line endings", crlfPath), 0, "2");
    let result = invoke(repo, "read", "1", "--body");
    result.code === 0 && BufferLike(result.stdout) === BufferLike(readFileSync(bodyPath))
      ? ok("read --body prints the body byte for byte")
      : fail(`read --body prints the body byte for byte (exit ${result.code})`, result.stdout);
    result = invoke(repo, "read", "2", "--body");
    result.code === 0 && BufferLike(result.stdout) === BufferLike(readFileSync(crlfPath))
      ? ok("a CRLF body keeps its line endings")
      : fail("a CRLF body keeps its line endings", result.stdout);
    const read1 = lt(repo, "read", "1");
    const head = read1.out.split("\n").slice(0, 7).join("|");
    const validHead = [
      `id: #1|title: A tracker that needs no service|state: todo|labels: |created: ${dayBefore}|path: ${store}/1.md|`,
      `id: #1|title: A tracker that needs no service|state: todo|labels: |created: ${dayAfter}|path: ${store}/1.md|`,
    ].includes(head);
    validHead && read1.code === 0 && bodyline(read1.out) === "## Problem / feature"
      ? ok("read prints id, title, state, labels, created and path, a blank line, then the body")
      : fail("read prints id, title, state, labels, created and path, a blank line, then the body", read1.out);
    const fromWorktree = lt(worktree, "read", "1");
    const fromSubdir = lt(join(repo, "sub"), "read", "1");
    fromWorktree.code === 0 && fromSubdir.out === fromWorktree.out
      ? ok("a linked worktree and a subdirectory read the same ticket")
      : fail("a linked worktree and a subdirectory read the same ticket", fromSubdir.out);
    lt(worktree, "state", "1", "in-progress");
    const stateRead = lt(repo, "read", "1");
    stateRead.out.includes("state: in-progress")
      ? ok("a state set from a linked worktree is the state the main checkout reads")
      : fail("a state set from a linked worktree is the state the main checkout reads", stateRead.out);
    const comment = lt(join(repo, "sub"), "comment", "1", "coachman", "Harvested both\nlanes.");
    const commentRead = lt(repo, "read", "1");
    const commentLine = /#1: \d{4}-\d{2}-\d{2} \d{2}:\d{2} coachman: Harvested both lanes\./;
    commentLine.test(comment.out) &&
    commentRead.out
      .split("\n")
      .some((line) => /^- \d{4}-\d{2}-\d{2} \d{2}:\d{2} coachman: Harvested both lanes\.$/.test(line))
      ? ok("comment adds one dated line to the log, actor first, on one line")
      : fail("comment adds one dated line to the log, actor first, on one line", `${comment.out}\n${commentRead.out}`);
    result = invoke(repo, "read", "1", "--body");
    put(join(temp, "base.md"), result.stdout);
    check(
      "edit against the body as read replaces it",
      lt(repo, "edit", "1", newPath, join(temp, "base.md")),
      0,
      "#1: edited",
    );
    const updatedBody = invoke(repo, "read", "1", "--body").stdout;
    const updatedRead = lt(repo, "read", "1");
    BufferLike(updatedBody) === BufferLike(readFileSync(newPath)) &&
    updatedRead.out.includes("title: A tracker that needs no service") &&
    updatedRead.out.includes("state: in-progress")
      ? ok("the body is the new one, and the title and state are as they were")
      : fail("the body is the new one, and the title and state are as they were", updatedRead.out);
    put(join(temp, "base-crlf.md"), "## Problem / feature  \r\nThe new body.  \r\n\r\n");
    check(
      "a base that differs only in line endings and trailing spaces matches",
      lt(repo, "edit", "1", newPath, join(temp, "base-crlf.md")),
      0,
      "#1: edited",
    );
    check("title replaces the title", lt(repo, "title", "1", "  Tickets with no service  "), 0, "#1: title changed");
    result = invoke(repo, "read", "1", "--body");
    const titled = lt(repo, "read", "1");
    titled.out.includes("title: Tickets with no service") &&
    titled.out.includes("state: in-progress") &&
    BufferLike(result.stdout) === BufferLike(readFileSync(newPath))
      ? ok("and leaves the body and state as they were")
      : fail("and leaves the body and state as they were", titled.out);
    lt(repo, "create", "Blocked one", bodyPath);
    lt(repo, "state", "3", "blocked");
    lt(repo, "create", "Done one", bodyPath);
    lt(repo, "state", "4", "done");
    lt(repo, "create", "Cancelled one", bodyPath);
    lt(repo, "state", "5", "cancelled");
    lt(repo, "create", "Another todo", bodyPath);
    lt(repo, "state", "2", "done");
    const wantList =
      "#6\ttodo\tAnother todo\n#1\tin-progress\tTickets with no service\n#3\tblocked\tBlocked one\n#2\tdone\tLine endings\n#4\tdone\tDone one\n#5\tcancelled\tCancelled one";
    const listAll = lt(repo, "list");
    listAll.code === 0 && listAll.out === wantList
      ? ok("list groups every ticket by state, in the flow's order, then by number")
      : fail("list groups every ticket by state, in the flow's order, then by number", listAll.out);
    const listDone = lt(repo, "list", "done");
    listDone.code === 0 && listDone.out === "#2\tdone\tLine endings\n#4\tdone\tDone one"
      ? ok("list <state> lists only that state")
      : fail("list <state> lists only that state", listDone.out);
    const beforeInit = snapshot(store);
    const initAgain = lt(repo, "store", "init");
    const listedAgain = lt(repo, "list");
    snapshot(store) === beforeInit && listedAgain.out === wantList && initAgain.out.includes("store exists:")
      ? ok("store init on a store holding tickets changes none of them")
      : fail("store init on a store holding tickets changes none of them", `${initAgain.out}\n${listedAgain.out}`);
    const made = lt(repo, "create", "With a byte-order mark", bomPath);
    const number = made.out;
    const bomRead = invoke(repo, "read", number, "--body");
    const bomHeader = lt(repo, "read", number);
    BufferLike(bomRead.stdout) === BufferLike(readFileSync(bodyPath)) &&
    bodyline(bomHeader.out) === "## Problem / feature"
      ? ok("create drops a body's byte-order mark")
      : fail("create drops a body's byte-order mark", bomRead.stdout);
    writeFileSync(
      ticketPath(store, BigInt(number), "md"),
      new Uint8Array([0xef, 0xbb, 0xbf, ...readFileSync(bodyPath)]),
    );
    const bomStored = lt(repo, "read", number);
    bodyline(bomStored.out) === "## Problem / feature"
      ? ok("read shows the first heading of a body that gained a byte-order mark")
      : fail("read shows the first heading of a body that gained a byte-order mark", bodyline(bomStored.out));
    const stdinCreate = command(self, [repo, "create", "From a pipe", "/dev/stdin"], {
      input: readFileSync(bodyPath, "utf8"),
    });
    const stdinRead = invoke(repo, "read", stdinCreate.stdout.trim(), "--body");
    stdinCreate.code === 0 && BufferLike(stdinRead.stdout) === BufferLike(readFileSync(bodyPath))
      ? ok("create takes its body from /dev/stdin")
      : fail("create takes its body from /dev/stdin", `${stdinCreate.stdout}\n${stdinRead.stdout}`);
    const stdinBase = invoke(repo, "read", stdinCreate.stdout.trim(), "--body");
    put(join(temp, "stdin-base.md"), stdinBase.stdout);
    const stdinEdit = command(
      self,
      [repo, "edit", stdinCreate.stdout.trim(), "/dev/stdin", join(temp, "stdin-base.md")],
      { input: readFileSync(newPath, "utf8") },
    );
    const afterStdin = invoke(repo, "read", stdinCreate.stdout.trim(), "--body");
    stdinEdit.code === 0 && BufferLike(afterStdin.stdout) === BufferLike(readFileSync(newPath))
      ? ok("edit takes its body from /dev/stdin")
      : fail("edit takes its body from /dev/stdin", stdinEdit.stdout + stdinEdit.stderr);
    const stdinReadForBase = invoke(repo, "read", stdinCreate.stdout.trim(), "--body");
    const baseEdit = command(self, [repo, "edit", stdinCreate.stdout.trim(), bodyPath, "/dev/stdin"], {
      input: stdinReadForBase.stdout,
    });
    baseEdit.code === 0
      ? ok("edit takes its base from /dev/stdin")
      : fail("edit takes its base from /dev/stdin", baseEdit.stderr);
    const cleanTree = command("git", ["-C", repo, "status", "--porcelain", "--ignored=no"]).stdout.trim() === "";
    const refsAfter = command("git", ["-C", repo, "for-each-ref"]).stdout;
    const commitsAfter = command("git", ["-C", repo, "rev-list", "--all"]).stdout.trim().split(/\r?\n/).length;
    const wtClean = command("git", ["-C", worktree, "status", "--porcelain"]).stdout.trim() === "";
    cleanTree && refs === refsAfter && commits === commitsAfter && wtClean
      ? ok("no ticket is in a working tree, on a branch or in a commit")
      : fail(
          "no ticket is in a working tree, on a branch or in a commit",
          command("git", ["-C", repo, "status", "--porcelain"]).stdout,
        );

    const concurrent = join(temp, "concurrent");
    if (!newRepo(concurrent) || invoke(concurrent, "store", "init").code !== 0)
      throw new Error("could not make concurrency fixture");
    const children = Array.from({ length: 10 }, (_, index) =>
      Bun.spawn([self, concurrent, "create", `Ticket ${index + 1}`, bodyPath], { stdout: "pipe", stderr: "pipe" }),
    );
    const childResults = await Promise.all(
      children.map(async (child: any) => ({
        code: await child.exited,
        stdout: await new Response(child.stdout).text(),
      })),
    );
    const ids = childResults.map((child) => Number(child.stdout.trim())).sort((a, b) => a - b);
    const concurrentList = command(self, [concurrent, "list"]);
    childResults.every((child) => child.code === 0) &&
    ids.join(" ") === "1 2 3 4 5 6 7 8 9 10" &&
    concurrentList.stdout.trim().split("\n").length === 10
      ? ok("ten creates at once get ten different numbers")
      : fail(
          "ten creates at once get ten different numbers",
          `${ids.join(" ")}\n${childResults.map((c) => c.code).join(",")}`,
        );

    writeOut("controls: what the caller's environment must not change");
    const mine = lt(repo, "store").out;
    const diverted = command(self, [repo, "store"], {
      env: {
        GIT_DIR: join(unticketed, ".git"),
        GIT_WORK_TREE: unticketed,
        GIT_INDEX_FILE: join(unticketed, ".git", "index"),
      },
    });
    const other = join(temp, "other");
    newRepo(other);
    command(self, [other, "store", "init"], { env: { GIT_DIR: join(unticketed, ".git"), GIT_WORK_TREE: unticketed } });
    diverted.code === 0 &&
    output(diverted) === mine &&
    existsSync(join(other, ".git", "postmaster", "tickets")) &&
    !existsSync(join(unticketed, ".git", "postmaster"))
      ? ok("a GIT_DIR from the caller does not steer it to another repository")
      : fail("a GIT_DIR from the caller does not steer it to another repository", output(diverted));
    const cdp = command(self, ["repo", "store"], { cwd: temp, env: { CDPATH: ".:/nonexistent" } });
    cdp.code === 0 && cdp.stdout.trim() === store
      ? ok("an exported CDPATH does not move a relative <repo>")
      : fail("an exported CDPATH does not move a relative <repo>", output(cdp));
    const symlinkRepo = join(temp, "shadow-link");
    newRepo(symlinkRepo);
    symlinkSync(join(repo, "sub"), join(symlinkRepo, "link"));
    const throughLink = invoke(join(symlinkRepo, "link"), "store");
    invoke(join(symlinkRepo, "link"), "store", "init");
    throughLink.code === 0 &&
    throughLink.stdout.trim() === store &&
    !existsSync(join(symlinkRepo, ".git", "postmaster"))
      ? ok(
          "a symlink to a directory in the repository finds its store, not the store of the repository holding the link",
        )
      : fail(
          "a symlink to a directory in the repository finds its store, not the store of the repository holding the link",
          throughLink.stdout,
        );
    const shadow = join(temp, "shadowing");
    newRepo(shadow);
    command(self, [shadow, "store", "init"]);
    command(self, [shadow, "create", "Shadowed", bodyPath]);
    mkdirSync(join(shadow, "json"));
    for (const name of ["signal", "re", "contextlib", "datetime", "tomllib", "json/__init__"])
      put(
        join(shadow, `${name}.py`),
        `open('${join(temp, "imported")}', 'a').write('${name}\\n')\nraise SystemExit(9)\n`,
      );
    const shadowList = command(self, [".", "list"], { cwd: shadow });
    const discovered = command("bun", [join(here, "discover-project.ts"), "."], {
      cwd: shadow,
      env: { POSTMASTER_CONFIG: join(temp, "github.toml") },
    });
    const shadowKind = discovered.stdout.match(/^tracker=(.*)$/m)?.[1];
    const otherKind = command("bun", [join(here, "tracker-kind.ts"), unticketed], {
      cwd: shadow,
      env: { POSTMASTER_CONFIG: join(temp, "github.toml") },
    });
    shadowList.code === 0 &&
    shadowKind === "local" &&
    otherKind.stdout.trim() === "github" &&
    !existsSync(join(temp, "imported")) &&
    !existsSync(join(shadow, "__pycache__"))
      ? ok("modules in the target's own directory are never imported")
      : fail("modules in the target's own directory are never imported", output(shadowList));

    writeOut("negative controls: nothing is written");
    const currentBase = invoke(repo, "read", "1", "--body");
    put(join(temp, "base.md"), currentBase.stdout);
    put(join(temp, "stale.md"), "## Problem / feature\nChanged in the store since.\n");
    refused(
      "a base the ticket no longer matches exits 4",
      4,
      "#1 changed since",
      repo,
      "edit",
      "1",
      bodyPath,
      join(temp, "stale.md"),
    );
    refused("an empty body file exits 1", 1, "is empty", repo, "edit", "1", emptyPath, join(temp, "base.md"));
    refused(
      "a missing base file exits 1",
      1,
      "cannot read base file",
      repo,
      "edit",
      "1",
      bodyPath,
      join(temp, "nowhere.md"),
    );
    refused("the form with a title is a usage error", 1, "usage:", repo, "edit", "1", "A title", bodyPath);
    refused(
      "edit on an unknown ticket exits 1",
      1,
      "no ticket #99",
      repo,
      "edit",
      "99",
      bodyPath,
      join(temp, "base.md"),
    );
    refused("an invalid state exits 2", 2, "invalid state", repo, "state", "1", "finished");
    refused("state on an unknown ticket exits 1", 1, "no ticket #99", repo, "state", "99", "done");
    refused("a comment on an unknown ticket exits 1", 1, "no ticket #99", repo, "comment", "99", "coachman", "hello");
    refused(
      "a comment that is not UTF-8 exits 1",
      1,
      "comment is not UTF-8",
      repo,
      "comment",
      "1",
      "coachman",
      "na\ufffdve",
    );
    refused(
      "an actor that is not UTF-8 exits 1",
      1,
      "actor is not UTF-8",
      repo,
      "comment",
      "1",
      "r\ufffdviewer",
      "hello",
    );
    refused("create with an empty body exits 1", 1, "is empty", repo, "create", "A title", emptyPath);
    refused("create with an empty title exits 1", 1, "title is empty", repo, "create", "  ", bodyPath);
    refused(
      "create with a title of two lines exits 1",
      1,
      "more than one line",
      repo,
      "create",
      "Two\nlines",
      bodyPath,
    );
    refused(
      "create with a title that is not UTF-8 exits 1",
      1,
      "title is not UTF-8",
      repo,
      "create",
      "caf\ufffd",
      bodyPath,
    );
    refused("title with an empty title exits 1", 1, "title is empty", repo, "title", "1", " ");
    refused("title with two lines exits 1", 1, "more than one line", repo, "title", "1", "Two\nlines");
    refused("title that is not UTF-8 exits 1", 1, "title is not UTF-8", repo, "title", "1", "\ufffd");
    refused("title on an unknown ticket exits 1", 1, "no ticket #99", repo, "title", "99", "A title");
    refused("something that is not a number exits 1", 1, "not a ticket number", repo, "read", "PM-1");
    refused("an unknown ticket exits 1", 1, "no ticket #99", repo, "read", "99");
    refused("list with an invalid state exits 2", 2, "invalid state", repo, "list", "finished");
    refused(
      "store init from a linked worktree is refused where a store exists too",
      1,
      "never from a linked worktree",
      worktree,
      "store",
      "init",
    );
    refused(
      "store remove from a linked worktree exits 1",
      1,
      "never from a linked worktree",
      worktree,
      "store",
      "remove",
    );
    refused(
      "store remove on a store holding tickets exits 1",
      1,
      "removed only when it holds none",
      repo,
      "store",
      "remove",
    );
    !existsSync(ghLog) ? ok("no command called gh") : fail("no command called gh", readFileSync(ghLog, "utf8"));

    writeOut("controls: a ticket file that is not as this script writes it");
    const damaged = join(temp, "damaged");
    const damagedStore = join(damaged, ".git", "postmaster", "tickets");
    newRepo(damaged);
    command(self, [damaged, "store", "init"]);
    for (const title of ["One", "Two", "Three"]) command(self, [damaged, "create", title, bodyPath]);
    copyFileSync(join(damagedStore, "2.json"), join(temp, "2.json"));
    put(join(damagedStore, "2.json"), '{"title": "Two", "state": "todo",\n');
    const damagedList = command(self, [damaged, "list"]);
    const damagedErr = damagedList.stderr;
    damagedList.code === 1 &&
    damagedList.stdout.trim() === "#1\ttodo\tOne\n#3\ttodo\tThree" &&
    damagedErr.includes("ticket #2")
      ? ok("list prints the tickets it can read, names the one it cannot, and exits 1")
      : fail("list prints the tickets it can read, names the one it cannot, and exits 1", output(damagedList));
    writeFileSync(
      join(damagedStore, "2.json"),
      new Uint8Array([0xef, 0xbb, 0xbf, ...readFileSync(join(temp, "2.json"))]),
    );
    const threeMetaPath = join(damagedStore, "3.json");
    let damagedMeta = JSON.parse(readFileSync(threeMetaPath, "utf8"));
    damagedMeta.log = "a line";
    put(threeMetaPath, JSON.stringify(damagedMeta));
    const beforeComment = snapshot(damagedStore);
    const badLog = lt(damaged, "comment", "3", "coachman", "hello");
    badLog.code === 1 && badLog.out.includes("log is not a list") && snapshot(damagedStore) === beforeComment
      ? ok("a log that is not a list is refused, not split into characters")
      : fail("a log that is not a list is refused, not split into characters", badLog.out);
    damagedMeta = JSON.parse(readFileSync(threeMetaPath, "utf8"));
    damagedMeta.log = [];
    damagedMeta.labels = "bug";
    put(threeMetaPath, JSON.stringify(damagedMeta));
    check("labels that are not a list are refused", lt(damaged, "read", "3"), 1, "labels is not a list");
    damagedMeta = JSON.parse(readFileSync(threeMetaPath, "utf8"));
    damagedMeta.labels = [];
    put(threeMetaPath, JSON.stringify(damagedMeta));
    const repairedList = lt(damaged, "list");
    repairedList.code === 0 && repairedList.out === "#1\ttodo\tOne\n#2\ttodo\tTwo\n#3\ttodo\tThree"
      ? ok("a ticket file saved with a byte-order mark still reads")
      : fail("a ticket file saved with a byte-order mark still reads", repairedList.out);

    writeOut("controls: store init and store remove, from the main checkout only");
    const guarded = join(temp, "guarded");
    newRepo(guarded);
    command("git", ["-C", guarded, "worktree", "add", "-q", join(guarded, ".worktrees/lane"), "-b", "lane"]);
    const laneInit = invoke(join(guarded, ".worktrees/lane"), "store", "init");
    laneInit.code === 1 && !existsSync(join(guarded, ".git", "postmaster"))
      ? ok("a lane's worktree cannot make its repository a store")
      : fail("a lane's worktree cannot make its repository a store", laneInit.stderr);
    invoke(guarded, "store", "init");
    check(
      "store remove on a store that holds no ticket removes it",
      lt(guarded, "store", "remove"),
      0,
      "store removed:",
    );
    const afterRemoval = command("bun", [join(here, "tracker-kind.ts"), guarded], {
      env: { POSTMASTER_CONFIG: join(temp, "github.toml") },
    });
    afterRemoval.code === 0 && afterRemoval.stdout.trim() === "github"
      ? ok("and the repository is back on the config's kind")
      : fail("and the repository is back on the config's kind", afterRemoval.stderr);

    writeOut("controls: a repository whose store exists uses this tracker, whatever the config names");
    const tracker = (configPath: string, path: string) =>
      command("bun", [join(here, "discover-project.ts"), path], {
        env: { POSTMASTER_CONFIG: configPath },
      }).stdout.match(/^tracker=(.*)$/m)?.[1] ?? "";
    tracker(join(temp, "github.toml"), repo) === "local" && tracker(join(temp, "github.toml"), worktree) === "local"
      ? ok("discover-project.sh names local for it and its worktree, with a config naming github")
      : fail("discover-project.sh names local for it and its worktree, with a config naming github");
    tracker(join(temp, "github.toml"), unticketed) === "github" &&
    tracker(join(temp, "plane.toml"), unticketed) === "plane" &&
    tracker(join(temp, "home/no-config.toml"), unticketed) === ""
      ? ok("a repository with no store gets the config's kind, and none without a config")
      : fail("a repository with no store gets the config's kind, and none without a config");
    const trackerPlain = command("bun", [join(here, "tracker-kind.ts"), plain], {
      env: { POSTMASTER_CONFIG: join(temp, "github.toml") },
    });
    trackerPlain.code === 1 &&
    trackerPlain.stderr.includes("not a git repository") &&
    tracker(join(temp, "github.toml"), plain) === ""
      ? ok("a store that cannot be looked for is not taken for no store")
      : fail("a store that cannot be looked for is not taken for no store", trackerPlain.stderr);
    const relativeConfig = command("bun", [join(here, "discover-project.ts"), unticketed], {
      cwd: temp,
      env: { POSTMASTER_CONFIG: "plane.toml" },
    });
    relativeConfig.stdout.match(/^tracker=(.*)$/m)?.[1] === "plane"
      ? ok("a relative POSTMASTER_CONFIG is read from the caller's directory")
      : fail("a relative POSTMASTER_CONFIG is read from the caller's directory", relativeConfig.stdout);
    const noHome = command("bun", [join(here, "discover-project.ts"), unticketed], {
      env: { HOME: undefined, POSTMASTER_CONFIG: undefined },
    });
    noHome.code === 0 && /^tracker=$/m.test(noHome.stdout) && /^gate=/m.test(noHome.stdout)
      ? ok("with HOME unset, discover-project.sh still reports, with the kind left to ask")
      : fail("with HOME unset, discover-project.sh still reports, with the kind left to ask", noHome.stdout);
    const relativePath = command("bun", ["scripts/discover-project.ts", repo], {
      cwd: dirname(here),
      env: { CDPATH: ".:/nonexistent", POSTMASTER_CONFIG: join(temp, "github.toml") },
    });
    relativePath.stdout.match(/^tracker=(.*)$/m)?.[1] === "local"
      ? ok("discover-project.sh run by a relative path with CDPATH exported still finds the rule")
      : fail(
          "discover-project.sh run by a relative path with CDPATH exported still finds the rule",
          relativePath.stdout,
        );
    const noRemoteErr = join(temp, "err");
    const hostedErr = join(temp, "err-hosted");
    const noRemote = command("bun", [join(here, "discover-project.ts"), unticketed], {
      env: { POSTMASTER_CONFIG: join(temp, "github.toml") },
    });
    writeFileSync(noRemoteErr, noRemote.stderr);
    const hosted = join(temp, "hosted");
    newRepo(hosted);
    command("git", ["-C", hosted, "remote", "add", "origin", "https://github.com/o/r.git"]);
    const hasRemote = command("bun", [join(here, "discover-project.ts"), hosted], {
      env: { POSTMASTER_CONFIG: join(temp, "github.toml") },
    });
    writeFileSync(hostedErr, hasRemote.stderr);
    readFileSync(noRemoteErr, "utf8").includes("store init") && !readFileSync(hostedErr, "utf8").includes("store init")
      ? ok("a github target with no origin remote is pointed at store init, and one with a remote is not")
      : fail(
          "a github target with no origin remote is pointed at store init, and one with a remote is not",
          `${noRemote.stderr}\n${hasRemote.stderr}`,
        );
    const ticketCheck = command("bun", [join(here, "ticket-check.ts"), repo, "3"], {
      env: { POSTMASTER_CONFIG: join(temp, "github.toml") },
    });
    const ticketCheckSeven = command("bun", [join(here, "ticket-check.ts"), repo, "7"], {
      env: { POSTMASTER_CONFIG: join(temp, "github.toml") },
    });
    ticketCheck.code === 0 &&
    ticketCheck.stdout.includes("well-formed") &&
    ticketCheckSeven.code === 0 &&
    !existsSync(ghLog)
      ? ok("ticket-check.sh reads tickets through this store with a config naming github, a byte-order mark aside")
      : fail(
          "ticket-check.sh reads tickets through this store with a config naming github, a byte-order mark aside",
          output(ticketCheck),
        );
    const githubCheck = command("bun", [join(here, "ticket-check.ts"), unticketed, "3"], {
      env: { POSTMASTER_CONFIG: join(temp, "github.toml") },
    });
    githubCheck.code === 1 && githubCheck.stdout.includes("github adapter") && existsSync(ghLog)
      ? ok("without a store it goes to the github adapter, and the gh on PATH saw the call")
      : fail("without a store it goes to the github adapter, and the gh on PATH saw the call", output(githubCheck));
  } catch (error) {
    fail("self-test setup or execution", String(error));
  } finally {
    rmSync(temp, { recursive: true, force: true });
    for (const [key, value] of oldEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  writeOut("");
  writeOut(fails === 0 ? "self-test: all controls behaved" : `self-test: ${fails} control(s) misbehaved`);
  return fails === 0 ? 0 : 1;
}
function BufferLike(value: string | Uint8Array): string {
  return typeof value === "string" ? value : new TextDecoder().decode(value);
}
function bodyline(value: string): string {
  return value.split(/\r?\n/)[7] ?? "";
}
function makeTemp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}
if (args[0] === "--self-test") process.exit(await selfTest());
try {
  process.exit(run(args));
} catch (error) {
  if (error instanceof LocalFailure) {
    writeError(`local: ${error.message}`);
    process.exit(error.code);
  }
  writeError(`local: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
