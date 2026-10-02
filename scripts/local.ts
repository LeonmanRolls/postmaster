import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { argvHasUndecodableBytes, run } from "./lib/proc.ts";
import { digitValue, pyWords } from "./lib/text.ts";

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
  // A U+FFFD in a decoded argument is undecodable input only when the raw
  // argv bytes prove it; on its own it is a legitimate character, as under
  // the surrogateescape gate it replaces.
  if (value.includes("\ufffd") && argvHasUndecodableBytes()) die(`the ${what} is not UTF-8`);
  return value;
}
function titleArg(value: string): string {
  const title = utf8(value, "title").trim();
  if (!title) die("the title is empty");
  if (title.includes("\n") || title.includes("\r")) die("the title is more than one line");
  return title;
}
// text.ts: BASE's local.sh embeds Python; its #?0*[1-9]\d* is Unicode (local.sh:102).
export const NUMBER_RE = /^#?0*[1-9]\p{Nd}*$/u;
// text.ts: BASE re.fullmatch(r"(\d+)\.json") on listdir names (local.sh:212).
const STORE_JSON_RE = /^\p{Nd}+\.json$/u;
// text.ts: BASE re.fullmatch(r"\d+\.(?:json|md)") (local.sh:215,234).
export const STORE_FILE_RE = /^\p{Nd}+\.(?:json|md)$/u;
// text.ts: BASE re.fullmatch(r"\d+\.(?:json|md)\.\d+\.tmp") (local.sh:237).
export const STORE_TMP_RE = /^\p{Nd}+\.(?:json|md)\.\p{Nd}+\.tmp$/u;

export function numberArg(value: string): bigint {
  if (!NUMBER_RE.test(value)) die(`not a ticket number: ${value}`);
  return BigInt(digitValue(value.replace(/^#/u, "")));
}
function stateArg(value: string): string {
  if (!states.includes(value)) die(`invalid state ${value} (one of: ${states.join(", ")})`, 2);
  return value;
}
function commonGitPath(repo: string, option: string): string {
  const result = run("git", ["-C", repo, "rev-parse", option], { env: unsetGit });
  if (result.code !== 0) die(`not a git repository: ${repo}`);
  const value = result.out.trim();
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
    const result = run("git", ["-C", repo, "worktree", "list", "--porcelain"], { env: unsetGit });
    main =
      result.out
        .split(/\r?\n/u)
        .find((line: string) => line.startsWith("worktree "))
        ?.slice("worktree ".length) ?? "the main checkout";
  }
  return { store: join(common, "postmaster", "tickets"), main, repo };
}
type Meta = {
  title: string;
  state: string;
  labels: string[];
  created: string;
  log: string[];
  [key: string]: unknown;
};
function needStore(store: string): void {
  if (!existsSync(store) || !statSync(store).isDirectory())
    die(`no ticket store at ${store}; with the user's word, run: local.sh <repo> store init`, 3);
}
export function ticketPath(store: string, number: bigint, ext: string): string {
  return join(store, `${number}.${ext}`);
}
export function oneLine(value: string): string {
  // text.ts: BASE one_line is " ".join(s.split()); PY_WS_RUN is Python-\s.
  return pyWords(value).join(" ");
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
function decodeFatal(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
function decode(bytes: Uint8Array, path: string, what: string, fatal = true): string {
  try {
    return fatal ? decodeFatal(bytes) : new TextDecoder("utf-8").decode(bytes);
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
    .replace(/\r\n/gu, "\n")
    .replace(/\r/gu, "\n")
    .split("\n")
    .map((line) => line.trimEnd());
  while (lines.length && !lines[0]) lines.shift();
  while (lines.length && !lines.at(-1)) lines.pop();
  return lines.join("\n");
}
function load(store: string, number: bigint): { meta?: Meta; why?: string } {
  const path = ticketPath(store, number, "json");
  let raw: Uint8Array;
  try {
    raw = readFileSync(path) as Uint8Array;
  } catch (error) {
    const code = (error as any)?.code;
    if (code === "ENOENT") return { why: `no ticket #${number} in ${store}` };
    return {
      why: `cannot read ticket #${number} at ${path}: ${String((error as any)?.message ?? error)}`,
    };
  }
  // Strictly decoded through the file's fatal decoder, as BASE reads it:
  // undecodable bytes refuse the ticket rather than listing it with
  // replacements. A leading BOM still parses, as the decoder strips it by
  // default and BASE's utf-8-sig strips it; JSON.parse would throw on one,
  // so the decoder must keep stripping.
  let text: string;
  try {
    text = decodeFatal(raw);
  } catch {
    return {
      why: `ticket #${number} at ${path} is not valid JSON: it is not UTF-8`,
    };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return {
      why: `ticket #${number} at ${path} is not valid JSON: ${String((error as any)?.message ?? error)}`,
    };
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    return { why: `ticket #${number} at ${path} is not a JSON object` };
  const meta = value as Record<string, unknown>;
  for (const key of ["title", "state", "created"])
    if (typeof meta[key] !== "string")
      return { why: `ticket #${number} at ${path} has no ${key} string` };
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
  atomicFile(
    ticketPath(store, number, "json"),
    new TextEncoder().encode(`${JSON.stringify(meta, null, 2)}\n`),
  );
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
        if (contents === "" && Date.now() - statSync(lock).mtimeMs > 5000) {
          // The bash flow's resting state (flock on the fd, never written,
          // never removed) carries no owner either way, so once it is old
          // enough that no live creator is between creation and its pid
          // write, it is stolen rather than waited out: waiting would stall
          // every write on a store the bash flow touched. Exclusion between
          // the two flows is best-effort during the transition, and exact
          // within this one.
          rmSync(lock, { force: true });
        } else if (contents !== "" && Number.isInteger(pid) && pid > 0) {
          // A live owner keeps its lock whatever its age, as under flock;
          // only a confirmed dead owner is reaped.
          if (!alive(pid)) rmSync(lock, { force: true });
        } else if (Date.now() - statSync(lock).mtimeMs > 60000) {
          rmSync(lock, { force: true });
        }
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
    .filter((name: string) => STORE_JSON_RE.test(name))
    .map((name: string) => BigInt(digitValue(name.slice(0, -5))))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
export function nextNumber(store: string): bigint {
  const used = (readdirSync(store) as string[])
    .filter((name: string) => STORE_FILE_RE.test(name))
    .map((name: string) => BigInt(digitValue(name.split(".")[0])));
  return used.reduce((max, current) => (current > max ? current : max), 0n) + 1n;
}
function minuteNow(): string {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function main(args: string[]): number {
  if (args.length < 2) return usage("store|create|edit|read|title|state|comment|list ...");
  const info = repoInfo(args[0]);
  const [cmd, ...rest] = args.slice(1);
  const { store, main } = info;
  const mainOnly = (what: string) => {
    if (main)
      die(
        `${what} runs only from the repository's main checkout, ${main}, never from a linked worktree`,
      );
  };
  if (cmd === "store") {
    if (rest.length === 0) {
      needStore(store);
      console.log(store);
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
      console.log(`store ${existed ? "exists" : "created"}: ${store}`);
      return 0;
    }
    if (rest.length === 1 && rest[0] === "remove") {
      mainOnly("store remove");
      needStore(store);
      locked(store, () => {
        const names = readdirSync(store) as string[];
        const held = new Set(
          names.filter((name) => STORE_FILE_RE.test(name)).map((name) => name.split(".")[0]),
        );
        if (held.size)
          die(
            `the store at ${store} holds ${held.size} ticket(s); it is removed only when it holds none`,
          );
        for (const name of names)
          if (name === ".lock" || STORE_TMP_RE.test(name))
            rmSync(join(store, name), { force: true });
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
      console.log(`store removed: ${store}`);
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
      const created = new Date().toISOString().replace(/\.[0-9]{3}Z$/u, "Z");
      writeMeta(store, n, { title, state: "todo", labels: [], created, log: [] });
      return n;
    });
    console.log(String(number));
    return 0;
  }
  if (cmd === "edit") {
    if (rest.length !== 3 || !existsSync(rest[1]))
      return usage(
        `edit <n> <body-file> <base-file>${rest.length === 3 ? `; no such body file: ${rest[1]}` : ""}`,
      );
    const number = numberArg(rest[0]);
    const content = bodyFile(rest[1]);
    const base = decode(readBytes(rest[2], "base file"), rest[2], "base file");
    needStore(store);
    locked(store, () => {
      metaOrDie(store, number);
      const current = new TextDecoder("utf-8").decode(body(store, number));
      if (normal(current) !== normal(base.replace(/^\ufeff/u, "")))
        die(`#${number} changed since ${rest[2]} was read; read it again`, 4);
      atomicFile(ticketPath(store, number, "md"), content);
    });
    console.log(`#${number}: edited`);
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
      .replace(/^\ufeff/u, "")
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
    if (meta.log.length)
      lines.push("", "## Log", ...meta.log.map((entry) => `- ${oneLine(entry)}`));
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
    console.log(`#${number}: title changed`);
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
    console.log(`#${number}: ${state}`);
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
    console.log(`#${number}: ${line}`);
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
      if (!wanted || state === wanted) console.log(`#${number}\t${state}\t${title}`);
    for (const why of unread) console.error(`local: ${why}`);
    return unread.length ? 1 : 0;
  }
  return usage("store|create|edit|read|title|state|comment|list ...");
}

if (import.meta.main) {
  try {
    process.exit(main(args));
  } catch (error) {
    if (error instanceof LocalFailure) {
      console.error(`local: ${error.message}`);
      process.exit(error.code);
    }
    console.error(`local: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
