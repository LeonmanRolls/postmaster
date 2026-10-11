// A run's style findings. They gate nothing: the review leg logs them and applies none, the ship
// card counts them, and aftercare sorts each into a rule for a linter the project's gate runs, a
// convention for the project's own docs, or neither. The postmaster puts the sort to the user
// after the merge.
//
//   run style-findings list <dispatch>    each style finding: its id, where it is, the rest of its line
//   run style-findings count <dispatch>   how many style findings the run has
//   run style-findings gate <dispatch>    what the gate runs, as the run's branch has it
//   run style-findings check <dispatch>   whether <dispatch>/style-sort.md sorts every style finding
//
//   exit 0  printed
//   exit 1  usage; no waybill, action log, or branch named for the run; a file that cannot be read
//   exit 2  list/count: a finding whose class is neither gating nor style. gate: the waybill
//           names no gate, or no repo that exists. check: a finding with neither class; no sort,
//           with style findings to sort; or a sort that is wrong.
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, posix, resolve } from "node:path";
import { run } from "./lib/proc.ts";
import { thrownCode, thrownMessage } from "./lib/thrown.ts";
import {
  BOUND_R,
  DOT_ALL,
  digitValue,
  END_OF_STRING,
  PY_DOT,
  PY_S_CLASS,
  pyLower,
  pyTrim,
  pyWords,
  W_CLASS,
} from "./lib/text.ts";

// --- constants ------------------------------------------------------------------------------
const FORMS =
  'a sort line is one of: "S<n> linter <linter> enable <rule>: <reason>", ' +
  '"S<n> linter <linter> write <rule>: <reason>", either with "via <file>" after the rule, ' +
  '"S<n> docs <doc>: <reason>", "S<n> neither: <reason>", and ' +
  '"N<n> new-linter <linter> S<n>[,S<m>...]: <reason>", with "not-in-gate" after the findings';
const SHOWN = 20;
const LONG = 4000;

// --- helpers --------------------------------------------------------------------------------
function die(msg: string): never {
  console.error(`style-findings: ${msg}`);
  process.exit(1);
  throw new Error("unreachable");
}

function read(path: string, what: string): string {
  try {
    // BASE opened text with utf-8-sig: a byte-order mark is not part of the content.
    return readFileSync(path, "utf8").replace(/^\uFEFF/u, "");
  } catch (e) {
    if (thrownCode(e) === "ENOENT") die(`no ${what} at ${path}`);
    die(`cannot read ${path}: ${thrownMessage(e) ?? "error"}`);
  }
}

// The map with `key` set to `value`; a key already there keeps its place.
function withEntry<V>(map: ReadonlyMap<string, V>, key: string, value: V): Map<string, V> {
  const entry: [string, V] = [key, value];
  return new Map([...map, entry]);
}

function plain(word: string): string {
  return word.replace(/^[`*_"]+|[`*_"]+$/gu, "");
}

function named(name: string, text: string): boolean {
  const re = new RegExp(
    `(?<![A-Za-z0-9_-])${name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?![A-Za-z0-9_-])`,
    "iu",
  );
  return re.test(text);
}

export const JSTARS = new RegExp("^[" + PY_S_CLASS + "]*\\*", "u");
export const JSCOM = new RegExp(
  "(^|[" + PY_S_CLASS + "])\\/\\/(" + PY_DOT + "*)" + END_OF_STRING + "",
  "u",
);
export const SHCOM = new RegExp(
  "(^|[" + PY_S_CLASS + "])[#;](" + PY_DOT + "*)" + END_OF_STRING + "",
  "u",
);
export const JALIAS = new RegExp(
  "^alias[" +
    PY_S_CLASS +
    "]+([" +
    W_CLASS +
    "-]+)[" +
    PY_S_CLASS +
    "]*:=[" +
    PY_S_CLASS +
    "]*([" +
    W_CLASS +
    "-]+)",
  "u",
);
export const JVAR = new RegExp(
  "^(?:export[" +
    PY_S_CLASS +
    "]+)?([A-Za-z_][" +
    W_CLASS +
    "-]*)[" +
    PY_S_CLASS +
    "]*:=[" +
    PY_S_CLASS +
    "]*(" +
    PY_DOT +
    "*)" +
    END_OF_STRING +
    "",
  "u",
);
export const JRECIPE = new RegExp(
  "^@?([A-Za-z_][" +
    W_CLASS +
    "-]*)" +
    BOUND_R +
    "[^:]*:(?!=)(" +
    PY_DOT +
    "*)" +
    END_OF_STRING +
    "",
  "u",
);
export const JDEPS = new RegExp("[A-Za-z_][" + W_CLASS + "-]*", "gu");
export const MAKEINC = new RegExp(
  "^(?:-include|sinclude|include)[" + PY_S_CLASS + "]+(" + PY_DOT + "*)" + END_OF_STRING + "",
  "u",
);
export const RULE = new RegExp(
  "^([^:=]+?)[" + PY_S_CLASS + "]*::?(?!=)(" + PY_DOT + "*)" + END_OF_STRING + "",
  "u",
);
export const YPKGS = new RegExp("^packages[" + PY_S_CLASS + "]*:", "u");
export const YITEM = new RegExp("^[" + PY_S_CLASS + "]+-[" + PY_S_CLASS + "]*", "u");
export const YOUT = new RegExp(
  "^[" +
    PY_S_CLASS +
    "]+-[" +
    PY_S_CLASS +
    "]*|[" +
    PY_S_CLASS +
    "]+#(" +
    PY_DOT +
    "*)" +
    END_OF_STRING +
    "",
  "gu",
);
export const YIND = new RegExp("^[" + PY_S_CLASS + "]", "u");
export const MVER = /^\p{Nd}+(\.\p{Nd}+)?$/u;
export const MUSTACHE = new RegExp(
  "\\{\\{[" + PY_S_CLASS + "]*([A-Za-z_][" + W_CLASS + "-]*)[" + PY_S_CLASS + "]*\\}\\}",
  "gu",
);
export const COVERSPLIT = new RegExp("[," + PY_S_CLASS + "]+" + "", "u");
export const YARNRE = /^yarn@(\p{Nd}+)/u;
export const MENDEF = new RegExp("^[" + PY_S_CLASS + "]*endef" + BOUND_R + "", "u");
export const MIFCOND = new RegExp("^(?:ifeq|ifneq|ifdef|ifndef|else|endif)" + BOUND_R + "", "u");
export const MDEFINE = new RegExp(
  "^(?:(?:export|override)[" + PY_S_CLASS + "]+)*define" + BOUND_R + "",
  "u",
);

function stripJs(text: string): string {
  // text.ts: [\s\S] is every char in both languages; DOT_ALL spells it bare.
  const withoutBlocks = text.replace(new RegExp("/\\*" + DOT_ALL + "*?" + "\\*/", "gu"), " ");
  return withoutBlocks
    .split("\n")
    .filter((l) => !JSTARS.test(l))
    .map((l) => l.replace(JSCOM, "$1"))
    .join("\n");
}

function configText(text: string, path: string): string {
  if (/\.[cm]?[jt]s$/u.test(path)) return stripJs(text);
  if (path.endsWith(".json")) return text;
  return text
    .split("\n")
    .map((l) => l.replace(SHCOM, "$1"))
    .join("\n");
}

// --- glob matching (fnmatch.fnmatchcase) ---------------------------------------------------
function fnmatchCase(name: string, pattern: string): boolean {
  const re = new RegExp(
    "^" +
      pattern
        .replace(/[.+^${}()|[\]\\]/gu, "\\$&")
        .replace(/\*/gu, "[^/]*")
        .replace(/\?/gu, ".") +
      "$",
    "u",
  );
  return re.test(name);
}

// --- the run's findings -----------------------------------------------------------------------
interface Finding {
  id: string;
  target: string;
  rest: string;
}

// A finding as the action log holds it: the class its detail opens with, and the rest of it.
interface Logged {
  target: string;
  cls: string;
  rest: string;
}

type Judged = { kind: "fault"; message: string } | { kind: "logged"; entry: Logged };

type ActionLog = { ok: true; style: Finding[]; faults: string[] } | { ok: false; line: number };

function parseJson(line: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(line) };
  } catch {
    return { ok: false };
  }
}

function judge(n: number, e: Record<string, unknown>): Judged {
  // text.ts: BASE words = str(detail).split(None, 1); first-word + rest.
  const words = pyWords(String(e.detail ?? ""));
  const first = words[0] ?? "";
  if (first !== "gating" && first !== "style") {
    return {
      kind: "fault",
      message: `actions.jsonl line ${n}: a finding whose detail opens with ${words.length > 0 ? `"${first}"` : "nothing"}, not gating or style`,
    };
  }
  const entry = { target: String(e.target ?? ""), cls: first, rest: words.slice(1).join(" ") };
  return { kind: "logged", entry };
}

// What the lines of an action log say about findings. The first line that is not JSON ends the
// reading and is named by its number.
function readActionLog(text: string): ActionLog {
  const present = text
    .split("\n")
    .map((line, k) => ({ line, n: k + 1 }))
    .filter(({ line }) => line && line.trim() !== "");
  const parsed = present.map(({ line, n }) => ({ n, json: parseJson(line) }));
  const broken = parsed.find(({ json }) => !json.ok);
  if (broken) return { ok: false, line: broken.n };

  const events = parsed.flatMap(({ n, json }) => {
    if (!json.ok) return [];
    const e = json.value as Record<string, unknown> | null;
    return e && typeof e === "object" && e.action === "finding" ? [{ n, e }] : [];
  });
  const judged = events.map(({ n, e }) => judge(n, e));
  const faults = judged.flatMap((j) => (j.kind === "fault" ? [j.message] : []));
  const logged = judged.flatMap((j) => (j.kind === "logged" ? [j.entry] : []));
  // A target keeps its latest entry only, and stands where that entry was logged.
  const lastAt = new Map(logged.map((entry, k): [string, number] => [entry.target, k]));
  const latest = logged.filter((entry, k) => lastAt.get(entry.target) === k);
  const style = latest
    .filter((entry) => entry.cls === "style")
    .map((entry, k) => ({ id: `S${k + 1}`, target: entry.target, rest: entry.rest }));
  return { ok: true, style, faults };
}

export function findings(dispatch: string): { style: Finding[]; faults: string[] } {
  const path = join(dispatch, "actions.jsonl");
  const log = readActionLog(read(path, "action log"));
  if (!log.ok) die(`${path} line ${log.line} is not JSON`);
  return { style: log.style, faults: log.faults };
}

// --- the waybill ------------------------------------------------------------------------------
const MARK = "(?:\\*\\*|__)?";

export function field(line: string, key: string, stops: string[]): string | null {
  // text.ts: BASE re.match(r"\s*(?:[-*+]\s+)?MARK key MARK\s*:MARK(.*)$", re.I).
  const m = new RegExp(
    `[${PY_S_CLASS}]*(?:[-*+][${PY_S_CLASS}]+)?${MARK}${key}${MARK}[${PY_S_CLASS}]*:${MARK}(${PY_DOT}*)${END_OF_STRING}`,
    "iu",
  ).exec(line);
  if (!m) return null;
  const value = m[1] ?? "";
  const stopPat = stops.map((s) => s.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("|");
  const nxt = new RegExp(
    `[${PY_S_CLASS}]+${MARK}(?:${stopPat})${MARK}[${PY_S_CLASS}]*:${MARK}(?=[${PY_S_CLASS}]|${END_OF_STRING})`,
    "iu",
  ).exec(value);
  const upToNext = nxt ? value.slice(0, nxt.index) : value;
  const trimmed = pyTrim(upToNext);
  const quoted = trimmed.length > 1 && trimmed[0] === "`" && trimmed[trimmed.length - 1] === "`";
  return quoted ? pyTrim(trimmed.slice(1, -1)) : trimmed;
}

function firstField(lines: string[], key: string, stops: string[]): string | null {
  for (const l of lines) {
    const v = field(l, key, stops);
    if (v !== null) return v;
  }
  return null;
}

// The repo and the gate the last Project profile of a waybill names.
function projectProfile(text: string): { repo: string | null; gate: string | null } {
  const lines = text.split("\n");
  const heads = lines.flatMap((l, i) =>
    /^ {0,3}##[ \t]+project profile[ \t:#]*\r?$/iu.test(l) ? [i] : [],
  );
  const last = heads.at(-1);
  const after = lines.slice(last === undefined ? 0 : last + 1);
  const end = after.findIndex((l) => /^ {0,3}#{1,2}(?:[ \t]|\r?$)/u.test(l));
  const section = end < 0 ? after : after.slice(0, end);
  const repo = firstField(section, "repo", ["default branch", "BASE"]);
  const gate = firstField(section, "gate", ["build", "browser suite"]);
  return {
    repo: repo || null,
    gate: gate && pyLower(gate) !== "none" ? gate : null,
  };
}

function profile(dispatch: string): { repo: string | null; gate: string | null } {
  return projectProfile(read(join(dispatch, "brief.md"), "waybill"));
}

// --- the repo, as the run's branch has it -------------------------------------------------------
function git(repo: string, ...args: string[]): string | null {
  const r = run("git", ["-C", repo, ...args], { timeout: 120000 });
  return r.code === 0 ? r.out : null;
}

interface BlobEntry {
  mode: string;
  sha: string;
}

// The branch's files and directories, and the blobs fetched so far: a sha maps to what
// `git cat-file blob` printed, or to null where git could not print it.
interface Tree {
  readonly repo: string;
  readonly blobs: ReadonlyMap<string, BlobEntry>;
  readonly dirs: ReadonlySet<string>;
  readonly fetched: ReadonlyMap<string, string | null>;
}

// A computation over a tree throws this to ask for blobs the tree has not fetched yet. The edge
// fetches them and runs the computation again.
class BlobNeeded extends Error {
  constructor(readonly shas: string[]) {
    super(`blobs ${shas.join(" ")} are not fetched yet`);
  }
}

// A directory and all the directories above it, up to the one that is its own parent.
function ancestors(d: string): string[] {
  const parent = posix.dirname(d);
  return parent === d ? [d] : [d, ...ancestors(parent)];
}

// One line of `git ls-tree -r -z`: the blob it names, or nothing for any other kind of entry.
function blobEntry(ent: string): Array<{ path: string; mode: string; sha: string }> {
  if (!ent) return [];
  const tabIdx = ent.indexOf("\t");
  if (tabIdx < 0) return [];
  const meta = ent.slice(0, tabIdx);
  const path = ent.slice(tabIdx + 1);
  // ASCII: git ls-tree --format prints mode, blob-sha and path tab-separated in ASCII.
  const f = meta.split(/\s+/u);
  return f.length === 3 && f[1] === "blob" ? [{ path, mode: f[0]!, sha: f[2]! }] : [];
}

function listTree(lsRaw: string): { blobs: Map<string, BlobEntry>; dirs: Set<string> } {
  const entries = lsRaw.split("\0").flatMap(blobEntry);
  const blobs = new Map(
    entries.map((b): [string, BlobEntry] => [b.path, { mode: b.mode, sha: b.sha }]),
  );
  const dirs = new Set(["", ...entries.flatMap((b) => ancestors(posix.dirname(b.path)))]);
  return { blobs, dirs };
}

function loadTree(repo: string, branch: string): Tree {
  const shaRaw = git(repo, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}^{commit}`);
  const sha = shaRaw?.trim() ?? "";
  if (!sha) die(`no branch ${branch} in ${repo}: the gate is read as the run's branch has it`);
  const lsRaw = git(repo, "ls-tree", "-r", "-z", "--full-tree", sha) ?? "";
  const { blobs, dirs } = listTree(lsRaw);
  return { repo, blobs, dirs, fetched: new Map() };
}

function withBlob(tree: Tree, sha: string): Tree {
  const text = git(tree.repo, "cat-file", "blob", sha);
  return { ...tree, fetched: withEntry(tree.fetched, sha, text) };
}

function attempt<T>(
  tree: Tree,
  compute: (tree: Tree) => T,
): { done: true; value: T } | { done: false; shas: string[] } {
  try {
    return { done: true, value: compute(tree) };
  } catch (e) {
    if (e instanceof BlobNeeded) return { done: false, shas: e.shas };
    throw e;
  }
}

// Runs `compute` on the tree, fetching the blobs it asks for and running it again, until it
// runs through.
function settle<T>(tree: Tree, compute: (tree: Tree) => T): T {
  const outcome = attempt(tree, compute);
  if (outcome.done) return outcome.value;
  return settle(outcome.shas.reduce(withBlob, tree), compute);
}

function blobText(tree: Tree, sha: string): string | null {
  const text = tree.fetched.get(sha);
  if (text === undefined) throw new BlobNeeded([sha]);
  return text;
}

// Asks for the blobs of `paths` all at once, where a computation is about to read each of them.
function needBlobs(tree: Tree, paths: string[]): void {
  const missing = paths.flatMap((p) => {
    const sha = tree.blobs.get(p)?.sha;
    return sha !== undefined && !tree.fetched.has(sha) ? [sha] : [];
  });
  if (missing.length > 0) throw new BlobNeeded([...new Set(missing)]);
}

function treePath(cwd: string, p: string): string | null {
  if (!p || p.startsWith("/") || p.startsWith("~")) return null;
  const q = posix.normalize(posix.join(cwd, p));
  if (q === ".") return "";
  if (q === ".." || q.startsWith("../")) return null;
  return q;
}

function treeFile(tree: Tree, cwd: string, p: string): string | null {
  const q = treePath(cwd, p);
  if (q === null) return null;
  const entry = tree.blobs.get(q);
  if (entry === undefined) return null;
  if (entry.mode !== "120000") return q;
  const linkTarget = (blobText(tree, entry.sha) ?? "").trim();
  const target = treePath(posix.dirname(q), linkTarget);
  if (target === null) return null;
  const targetEntry = tree.blobs.get(target);
  if (targetEntry === undefined || targetEntry.mode === "120000") return null;
  return target;
}

function treeDir(tree: Tree, cwd: string, p: string): string | null {
  const q = treePath(cwd, p);
  return q !== null && tree.dirs.has(q) ? q : null;
}

function treeRead(tree: Tree, p: string): string | null {
  const entry = tree.blobs.get(p);
  const data = entry ? blobText(tree, entry.sha) : null;
  if (data === null || data.length > 512 * 1024 || data.slice(0, 8192).includes("\0")) return null;
  // BASE decoded utf-8-sig: a byte-order mark is not part of the content.
  return data.replace(/^\uFEFF/u, "");
}

function treeGlob(tree: Tree, cwd: string, pattern: string): string[] {
  const q = treePath(cwd, pattern);
  if (q === null) return [];
  if (!/[*?[]/u.test(q)) return tree.blobs.has(q) ? [q] : [];
  return [...tree.blobs.keys()].filter((p) => fnmatchCase(p, q)).toSorted();
}

function treeUp(tree: Tree, cwd: string, names: string[]): string | null {
  const here = names.map((n) => (cwd ? posix.join(cwd, n) : n)).find((p) => tree.blobs.has(p));
  if (here !== undefined) return here;
  if (!cwd) return null;
  return treeUp(tree, posix.dirname(cwd), names);
}

// --- reading shell -----------------------------------------------------------------------------
const PUNCT = new Set([";", "&", "|", "(", ")", "<", ">"]);
const SHELL_WORDS = new Set([
  "!",
  "{",
  "}",
  "if",
  "then",
  "do",
  "else",
  "elif",
  "while",
  "until",
  "time",
  "exec",
  "builtin",
  "nohup",
]);
const INERT = new Set([
  "echo",
  "printf",
  ":",
  "true",
  "false",
  "exit",
  "return",
  "test",
  "[",
  "[[",
  "export",
  "set",
  "unset",
  "read",
  "shift",
  "local",
  "declare",
  "typeset",
  "trap",
  "wait",
  "sleep",
  "cat",
  "tee",
  "head",
  "tail",
  "wc",
  "sort",
  "uniq",
  "date",
  "pwd",
  "which",
  "type",
  "hash",
  "touch",
  "rm",
  "cp",
  "mv",
  "mkdir",
  "rmdir",
  "ln",
  "chmod",
  "chown",
  "ls",
  "fi",
  "done",
  "esac",
  "popd",
]);
const INTERPRETERS = new Set([
  "bash",
  "sh",
  "zsh",
  "dash",
  "ksh",
  "source",
  ".",
  "node",
  "nodejs",
  "python",
  "python3",
  "bun",
  "deno",
  "tsx",
  "ts-node",
  "ruby",
  "perl",
]);
const BUILTINS: Record<string, Set<string>> = {
  pnpm: new Set([
    "add",
    "install",
    "i",
    "update",
    "up",
    "upgrade",
    "remove",
    "rm",
    "uninstall",
    "link",
    "ln",
    "unlink",
    "import",
    "rebuild",
    "rb",
    "prune",
    "fetch",
    "patch",
    "patch-commit",
    "exec",
    "dlx",
    "create",
    "run",
    "publish",
    "pack",
    "audit",
    "list",
    "ls",
    "outdated",
    "why",
    "root",
    "bin",
    "config",
    "c",
    "env",
    "setup",
    "store",
    "init",
    "deploy",
    "licenses",
    "server",
    "doctor",
  ]),
  yarn: new Set([
    "add",
    "install",
    "remove",
    "up",
    "upgrade",
    "run",
    "exec",
    "dlx",
    "workspace",
    "workspaces",
    "info",
    "why",
    "pack",
    "npm",
    "plugin",
    "set",
    "config",
    "version",
    "node",
    "bin",
    "cache",
    "dedupe",
    "explain",
    "init",
    "link",
    "unlink",
    "patch",
    "rebuild",
    "stage",
    "unplug",
    "global",
    "publish",
  ]),
  bun: new Set([
    "run",
    "test",
    "x",
    "repl",
    "exec",
    "install",
    "i",
    "add",
    "a",
    "remove",
    "rm",
    "update",
    "outdated",
    "link",
    "unlink",
    "publish",
    "patch",
    "patch-commit",
    "pm",
    "build",
    "init",
    "create",
    "c",
    "upgrade",
    "completions",
    "discord",
    "help",
    "audit",
    "why",
    "info",
  ]),
};
const RUNNERS: Record<string, string[]> = {
  "pre-commit": [".pre-commit-config.yaml", ".pre-commit-config.yml"],
  prek: [".pre-commit-config.yaml", ".pre-commit-config.yml"],
  lefthook: [
    "lefthook.yml",
    "lefthook.yaml",
    ".lefthook.yml",
    ".lefthook.yaml",
    "lefthook.toml",
    "lefthook.json",
  ],
  "lint-staged": [
    ".lintstagedrc",
    ".lintstagedrc.json",
    ".lintstagedrc.yaml",
    ".lintstagedrc.yml",
    ".lintstagedrc.js",
    ".lintstagedrc.cjs",
    ".lintstagedrc.mjs",
    "lint-staged.config.js",
    "lint-staged.config.cjs",
    "lint-staged.config.mjs",
  ],
  tox: ["tox.ini"],
  nox: ["noxfile.py"],
};

// Strips the innermost $( ) layer of a line on each pass, for at most `passes` passes.
function flattenSubstitutions(text: string, passes: number): string {
  if (passes === 0) return text;
  const next = text.replace(/\$\(([^()]*)\)/gu, "$1");
  return next === text ? text : flattenSubstitutions(next, passes - 1);
}

function subst(line: string): string {
  const withMake = line.replace(/\$\(MAKE\)|\$\{MAKE\}/gu, "make");
  const withDefaults = withMake.replace(/\$\{[A-Za-z_][A-Za-z0-9_]*:?[-=]([^{}]*)\}/gu, "$1");
  const flattened = flattenSubstitutions(withDefaults, 10);
  return flattened.replace(/\$\{[^{}]*\}/gu, "_").replace(/`/gu, " ");
}

// Reads `line` from `i` on, remembering the quote it is inside, and cuts it where a # starts a
// comment.
function cutAtComment(line: string, i: number, quote: string | null): string {
  if (i >= line.length) return line;
  const c = line[i]!;
  if (c === "\\" && quote !== "'") return cutAtComment(line, i + 2, quote);
  if (quote) return cutAtComment(line, i + 1, c === quote ? null : quote);
  if (c === "'" || c === '"') return cutAtComment(line, i + 1, c);
  if (c === "#" && (i === 0 || " \t;&|()".includes(line[i - 1]!))) return line.slice(0, i);
  return cutAtComment(line, i + 1, quote);
}

function uncomment(line: string): string {
  return cutAtComment(line, 0, null);
}

function punctuationAt(line: string, i: number): string {
  const c = line[i]!;
  // Group punctuation: && || |& etc.
  if ((c === "&" || c === "|") && line[i + 1] === c) return c + c;
  if (c === ">" && line[i + 1] === ">") return ">>";
  if (c === "<" && line[i + 1] === "<") return "<<";
  return c;
}

// The inside of a double-quoted stretch from `i`: a backslash takes the character after it, and
// the stretch ends at the closing quote.
function doubleQuoted(line: string, i: number, text: string): { text: string; next: number } {
  if (i >= line.length) return { text, next: i + 1 };
  const c = line[i]!;
  // skip closing quote
  if (c === '"') return { text, next: i + 1 };
  if (c === "\\" && i + 1 < line.length) return doubleQuoted(line, i + 2, text + line[i + 1]);
  return doubleQuoted(line, i + 1, text + c);
}

// A word from `i`: quotes and backslashes are resolved, and it ends at a space, a tab or
// punctuation.
function wordFrom(line: string, i: number, word: string): { word: string; next: number } {
  const c = line[i];
  if (c === undefined || PUNCT.has(c) || c === " " || c === "\t") return { word, next: i };
  if (c === "\\" && i + 1 < line.length) return wordFrom(line, i + 2, word + line[i + 1]);
  if (c === "'") {
    const close = line.indexOf("'", i + 1);
    const end = close < 0 ? line.length : close;
    // skip closing quote
    return wordFrom(line, end + 1, word + line.slice(i + 1, end));
  }
  if (c === '"') {
    const quoted = doubleQuoted(line, i + 1, "");
    return wordFrom(line, quoted.next, word + quoted.text);
  }
  return wordFrom(line, i + 1, word + c);
}

function tokensFrom(line: string, i: number, found: string[]): string[] {
  if (i >= line.length) return found;
  const c = line[i]!;
  if (c === " " || c === "\t") return tokensFrom(line, i + 1, found);
  if (PUNCT.has(c)) {
    const token = punctuationAt(line, i);
    return tokensFrom(line, i + token.length, [...found, token]);
  }
  // Word
  const { word, next } = wordFrom(line, i, "");
  return tokensFrom(line, next, word === "" ? found : [...found, word]);
}

// Shell tokenizer (approximates shlex with punctuation_chars)
function shellTokens(line: string): string[] {
  return tokensFrom(line, 0, []);
}

// What a line of shell breaks into: a command's words, or the separator between commands.
type Piece = { kind: "cmd"; words: string[] } | { kind: "sep"; token: string };

interface Pieces {
  done: Piece[];
  words: string[];
  skipNext: boolean;
}

function isPunctuation(t: string): boolean {
  return t !== "" && [...t].every((c) => PUNCT.has(c));
}

function pieceStep(state: Pieces, t: string): Pieces {
  if (state.skipNext) return { ...state, skipNext: false };
  if (!isPunctuation(t)) return { ...state, words: [...state.words, t] };
  if (t.includes("<") || t.includes(">")) return { ...state, skipNext: true };
  const flushed: Piece[] = state.words.length > 0 ? [{ kind: "cmd", words: state.words }] : [];
  return {
    done: [...state.done, ...flushed, { kind: "sep", token: t }],
    words: [],
    skipNext: false,
  };
}

function commands(line: string): Piece[] {
  const tokens = shellTokens(subst(uncomment(line)));
  const start: Pieces = { done: [], words: [], skipNext: false };
  const end = tokens.reduce(pieceStep, start);
  const last: Piece[] = end.words.length > 0 ? [{ kind: "cmd", words: end.words }] : [];
  return [...end.done, ...last];
}

// Index after the flags that start at `j`, and after the `--` that ends them.
function pastFlags(words: string[], j: number, valued: string[]): number {
  const w = words[j];
  if (j < words.length && w?.startsWith("-") && w !== "--") {
    return pastFlags(words, j + (valued.includes(w) ? 2 : 1), valued);
  }
  return j < words.length && w === "--" ? j + 1 : j;
}

// Index of the first word that is the command itself, past the wrappers, assignments and flags
// that lead the line.
function commandStart(words: string[], i: number): number {
  if (i >= words.length) return i;
  const w = words[i]!;
  const b = posix.basename(w);
  const nxt = i + 1 < words.length ? words[i + 1]! : "";
  if (SHELL_WORDS.has(w) || /^[A-Za-z_][A-Za-z0-9_]*=/u.test(w)) {
    return commandStart(words, i + 1);
  }
  if (b === "command") {
    return nxt === "-v" || nxt === "-V" ? words.length : commandStart(words, i + 1);
  }
  if (b === "env") {
    const valued = ["-u", "--unset", "-C", "--chdir", "-S", "--split-string"];
    return commandStart(words, pastFlags(words, i + 1, valued));
  }
  if (b === "cross-env" || b === "cross-env-shell" || b === "stdbuf" || b === "nice") {
    return commandStart(words, pastFlags(words, i + 1, ["-n", "--adjustment"]));
  }
  if (b === "timeout") {
    const valued = ["-s", "--signal", "-k", "--kill-after"];
    return commandStart(words, pastFlags(words, i + 1, valued) + 1);
  }
  if (b === "npx" || b === "pnpx" || b === "bunx") {
    return commandStart(words, pastFlags(words, i + 1, ["-p", "--package"]));
  }
  if (b === "dotenv" || b === "dotenvx") {
    const di = words.indexOf("--", i);
    const afterFlags = di >= 0 ? di + 1 : pastFlags(words, i + 1, ["-e", "-f", "-c", "-v"]);
    const next =
      afterFlags < words.length && words[afterFlags] === "run" ? afterFlags + 1 : afterFlags;
    return commandStart(words, next);
  }
  const runners = ["uv", "poetry", "pipenv", "hatch", "pdm", "rye"];
  if (runners.includes(b) && nxt === "run") {
    return commandStart(
      words,
      pastFlags(words, i + 2, ["--with", "--env", "-e", "--python", "-p"]),
    );
  }
  if (b === "bundle" && nxt === "exec") return commandStart(words, i + 2);
  if (b === "xargs") {
    return commandStart(
      words,
      pastFlags(words, i + 1, ["-n", "-I", "-L", "-P", "-d", "-s", "-E", "-a"]),
    );
  }
  return i;
}

function unwrap(words: string[]): string[] {
  return words.slice(commandStart(words, 0));
}

// --- justfile parsing ---------------------------------------------------------------------------
interface JustRecipe {
  deps: string[];
  body: string[];
}

interface JustRecipes {
  recipes: ReadonlyMap<string, JustRecipe>;
  vars: ReadonlyMap<string, string>;
  first: string | null;
}

// A justfile read up to a line: what it holds so far, and the recipe whose body is being read.
interface JustScan extends JustRecipes {
  current: string | null;
}

function justLine(scan: JustScan, line: string): JustScan {
  // text.ts: BASE strips justfile lines with Python whitespace.
  if (
    scan.current !== null &&
    (line.startsWith(" ") || line.startsWith("\t") || pyTrim(line) === "")
  ) {
    const recipe = scan.recipes.get(scan.current);
    if (!pyTrim(line) || recipe === undefined) return scan;
    const grown = { ...recipe, body: [...recipe.body, pyTrim(line)] };
    return { ...scan, recipes: withEntry(scan.recipes, scan.current, grown) };
  }
  const s = pyTrim(line);
  const between: JustScan = { ...scan, current: null };
  if (
    !s ||
    s.startsWith("#") ||
    s.startsWith("[") ||
    s.startsWith("set ") ||
    s.startsWith("import ") ||
    s.startsWith("mod ")
  ) {
    return between;
  }
  const alias = JALIAS.exec(s);
  if (alias) {
    const recipes = withEntry(scan.recipes, alias[1]!, { deps: [alias[2]!], body: [] });
    return { ...between, recipes };
  }
  const variable = JVAR.exec(s);
  if (variable) {
    const value = variable[2]?.trim().replace(/^['"]|['"]$/gu, "");
    return { ...between, vars: withEntry(scan.vars, variable[1]!, value) };
  }
  const header = JRECIPE.exec(s);
  if (header) {
    const name = header[1]!;
    const deps = header[2]?.replace(/\([^)]*\)/gu, "").match(JDEPS) ?? [];
    return {
      recipes: withEntry(scan.recipes, name, { deps, body: [] }),
      vars: scan.vars,
      first: scan.first === null ? name : scan.first,
      current: name,
    };
  }
  return between;
}

function parseJust(text: string): JustRecipes {
  const start: JustScan = { recipes: new Map(), vars: new Map(), first: null, current: null };
  const end = text.split("\n").reduce(justLine, start);
  return { recipes: end.recipes, vars: end.vars, first: end.first };
}

// --- makefile parsing ---------------------------------------------------------------------------
export const Makefile = {
  // text.ts: BASE ASSIGN splits Python whitespace; values bar only LF.
  ASSIGN: new RegExp(
    "^(?:(?:export|override)[" +
      PY_S_CLASS +
      "]+)*([A-Za-z0-9_.-]+)[" +
      PY_S_CLASS +
      "]*(:{1,3}=|[?+!]?=)[" +
      PY_S_CLASS +
      "]*(" +
      PY_DOT +
      "*)" +
      END_OF_STRING +
      "",
    "u",
  ),
};

interface MakeRule {
  prereqs: string[];
  recipe: string[];
}

// One thing a makefile says of a target: a rule line that names it, with what the line makes it
// depend on and its inline recipe, or a recipe line that follows such a rule.
type MakeEntry =
  | { kind: "rule"; target: string; prereqs: string[]; inline: string }
  | { kind: "recipe"; target: string; text: string };

// What reading a makefile, and what it includes, has found so far.
interface MakeState {
  vars: ReadonlyMap<string, string>;
  entries: readonly MakeEntry[];
  first: string | null;
}

// A makefile read whole, with the target `make` builds when none is named.
interface MakeFile {
  path: string;
  vars: ReadonlyMap<string, string>;
  rules: ReadonlyMap<string, MakeRule>;
  goal: string;
}

// What stays the same while a makefile is read: the tree, the directory its globs are taken in,
// and the variables the command line fixed.
interface MakeEnv {
  tree: Tree;
  cwd: string;
  fixed: ReadonlySet<string>;
}

// A makefile read up to a line: what it holds so far, the targets whose recipe lines come next,
// and whether the line is inside a define.
interface MakeScan {
  state: MakeState;
  current: string[] | null;
  define: boolean;
}

function expandMake(vars: ReadonlyMap<string, string>, s: string, depth: number): string {
  if (depth > 10 || !s.includes("$")) return s;
  const one = (m: string, p1: string, p2: string): string => {
    const name = p1 || p2;
    const value = vars.get(name);
    if (value !== undefined) return expandMake(vars, value, depth + 1);
    return name === "MAKE" ? "make" : m;
  };
  return s
    .replace(/\$\$/gu, "\0")
    .replace(/\$\(([A-Za-z0-9_.-]+)\)|\$\{([A-Za-z0-9_.-]+)\}/gu, (m, p1, p2) =>
      one(m, p1 ?? "", p2 ?? ""),
    )
    .replace(/\0/gu, "$$");
}

function makeRecipe(mk: MakeFile, line: string): string {
  const bare = line.replace(new RegExp("^[" + PY_S_CLASS + "]*[@+-]*", "u"), "");
  return expandMake(mk.vars, bare, 0).replace(/\$\$/gu, "$");
}

// The state with `text` added to the recipe of each of `targets`.
function withRecipeText(state: MakeState, targets: string[], text: string): MakeState {
  const added: MakeEntry[] = targets.map((target) => ({ kind: "recipe", target, text }));
  return { ...state, entries: [...state.entries, ...added] };
}

// The state with one rule line applied to the target `t`.
function withRuleFor(state: MakeState, t: string, prereqs: string[], inline: string): MakeState {
  const added: MakeEntry = { kind: "rule", target: t, prereqs, inline };
  const startsFirst = state.first === null && !t.startsWith(".") && !t.includes("%");
  return {
    vars: state.vars,
    entries: [...state.entries, added],
    first: startsFirst ? t : state.first,
  };
}

// The rules of a makefile: for each target, what its lines made it depend on and what they run,
// in the order the lines came.
function groupRules(entries: readonly MakeEntry[]): Map<string, MakeRule> {
  const targets = [...new Set(entries.map((e) => e.target))];
  return new Map(
    targets.map((t): [string, MakeRule] => {
      const own = entries.filter((e) => e.target === t);
      const prereqs = own.flatMap((e) => (e.kind === "rule" ? e.prereqs : []));
      const recipe = own.flatMap((e) => {
        if (e.kind === "recipe") return [e.text];
        return e.inline ? [e.inline] : [];
      });
      return [t, { prereqs, recipe }];
    }),
  );
}

function assignVariable(
  env: MakeEnv,
  state: MakeState,
  name: string,
  op: string,
  value: string,
): MakeState {
  if (env.fixed.has(name) || op === "!=") return state;
  if (op === "?=") {
    return state.vars.has(name) ? state : { ...state, vars: withEntry(state.vars, name, value) };
  }
  if (op === "+=") {
    const joined = pyTrim(`${state.vars.get(name) ?? ""} ${value}`);
    return { ...state, vars: withEntry(state.vars, name, joined) };
  }
  const assigned = op.startsWith(":") ? expandMake(state.vars, value, 0) : value;
  return { ...state, vars: withEntry(state.vars, name, assigned) };
}

// The state after the makefiles an include line names, each read in the order the line gives.
function includeMakefiles(env: MakeEnv, state: MakeState, names: string, depth: number): MakeState {
  if (depth >= 10) return state;
  const patterns = pyWords(expandMake(state.vars, names, 0));
  const paths = patterns.flatMap((inc) => treeGlob(env.tree, env.cwd, inc));
  return paths.reduce((now, p) => readMakefile(env, now, p, depth + 1), state);
}

function makeLine(env: MakeEnv, scan: MakeScan, line: string, depth: number): MakeScan {
  if (scan.define) return { ...scan, define: !MENDEF.test(line) };
  if (line.startsWith("\t")) {
    return { ...scan, state: withRecipeText(scan.state, scan.current ?? [], line.slice(1)) };
  }
  const s = line.replace(/(?<!\\)#.*$/u, "").trim();
  if (!s || MIFCOND.test(s)) return scan;
  if (MDEFINE.test(s)) return { ...scan, current: null, define: true };
  const include = MAKEINC.exec(s);
  if (include) {
    const state = includeMakefiles(env, scan.state, include[1]!, depth);
    return { ...scan, state, current: null };
  }
  const assign = Makefile.ASSIGN.exec(s);
  if (assign) {
    const [, name, op, value] = assign;
    const state = assignVariable(env, scan.state, name!, op!, value!);
    return { ...scan, state, current: null };
  }
  const rule = RULE.exec(s);
  if (!rule || Makefile.ASSIGN.test(pyTrim(rule[2] ?? ""))) return { ...scan, current: null };
  const [, targets, rest] = rule;
  const semiIdx = rest!.indexOf(";");
  const prereqText = semiIdx >= 0 ? rest!.slice(0, semiIdx) : rest!;
  const inline = semiIdx >= 0 ? pyTrim(rest!.slice(semiIdx + 1)) : "";
  const current = pyWords(expandMake(scan.state.vars, targets!, 0));
  const prereqs = pyWords(expandMake(scan.state.vars, prereqText, 0)).filter((p) => p !== "|");
  const state = current.reduce((now, t) => withRuleFor(now, t, prereqs, inline), scan.state);
  return { ...scan, state, current };
}

function readMakefile(env: MakeEnv, state: MakeState, path: string, depth: number): MakeState {
  const text = treeRead(env.tree, path);
  const lines = (text ?? "").replace(/\\\r?\n/gu, " ").split("\n");
  const start: MakeScan = { state, current: null, define: false };
  return lines.reduce((scan, line) => makeLine(env, scan, line, depth), start).state;
}

function parseMakefile(
  tree: Tree,
  path: string,
  cwd: string,
  sets: Array<[string, string]>,
): MakeFile {
  const env: MakeEnv = { tree, cwd, fixed: new Set(sets.map(([name]) => name)) };
  const start: MakeState = { vars: new Map(sets), entries: [], first: null };
  const done = readMakefile(env, start, path, 0);
  const wanted = expandMake(done.vars, done.vars.get(".DEFAULT_GOAL") ?? "", 0).trim();
  const rules = groupRules(done.entries);
  return { path, vars: done.vars, rules, goal: wanted || done.first || "" };
}

// --- Reach: what a gate command reaches -----------------------------------------------------------
type Pkg = Record<string, unknown>;

// Which workspaces a package-manager command is aimed at: all of them, the ones named, or none.
type Workspaces = "all" | string[] | null;

// Everything a gate command is found to reach so far. Each step of the walk takes one of these
// and returns the next.
interface Reach {
  readonly t: Tree;
  readonly cmds: ReadonlyArray<{ where: string; words: string[] }>;
  readonly texts: ReadonlyArray<{ where: string; text: string }>;
  readonly lines: ReadonlyArray<{ where: string; line: string }>;
  readonly seen: ReadonlySet<string>;
  readonly warnings: readonly string[];
  readonly pkgs: ReadonlyMap<string, Pkg>;
}

// A place in the walk: the Reach so far and the directory the shell is in.
interface Walk {
  reach: Reach;
  cwd: string;
}

interface Commanded {
  reach: Reach;
  cwd: string;
  nested: boolean;
}

function withSeen(reach: Reach, key: string): Reach {
  return { ...reach, seen: new Set([...reach.seen, key]) };
}

// The package.json of directory `d`, and the warning when it is there and does not parse.
function packageJsonPath(d: string): string {
  return d ? posix.join(d, "package.json") : "package.json";
}

function parsePackage(tree: Tree, d: string): { pkg: Pkg; warning: string | null } {
  const p = packageJsonPath(d);
  if (!tree.blobs.has(p)) return { pkg: {}, warning: null };
  const text = treeRead(tree, p) ?? "";
  try {
    const parsed: unknown = JSON.parse(text);
    const pkg = parsed && typeof parsed === "object" ? (parsed as Pkg) : {};
    return { pkg, warning: null };
  } catch {
    return { pkg: {}, warning: `${p} does not parse, so no script of it was followed` };
  }
}

// The Reach that has looked at the package.json of `d`: the first look at a directory keeps what
// it found, and its warning once.
function withPackage(reach: Reach, d: string): Reach {
  if (reach.pkgs.has(d)) return reach;
  const found = parsePackage(reach.t, d);
  return {
    ...reach,
    pkgs: withEntry(reach.pkgs, d, found.pkg),
    warnings: found.warning === null ? reach.warnings : [...reach.warnings, found.warning],
  };
}

function packageIn(reach: Reach, d: string): Pkg {
  return reach.pkgs.get(d) ?? parsePackage(reach.t, d).pkg;
}

function scriptsIn(reach: Reach, d: string): Record<string, string> {
  const s = packageIn(reach, d).scripts;
  if (!s || typeof s !== "object") return {};
  // A script named `__proto__` is not kept: an object takes no entry for that key.
  const strings = Object.entries(s as Record<string, unknown>).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string" && entry[0] !== "__proto__",
  );
  return Object.fromEntries(strings);
}

function berry(reach: Reach): boolean {
  const pm = String(packageIn(reach, "").packageManager ?? "");
  const m = YARNRE.exec(pm);
  return (m ? Number(digitValue(m[1]!)) >= 2 : false) || reach.t.blobs.has(".yarnrc.yml");
}

function isString(g: unknown): g is string {
  return typeof g === "string";
}

function packageGlobs(declared: unknown): string[] {
  const listed =
    declared && typeof declared === "object" && !Array.isArray(declared)
      ? (declared as Record<string, unknown>).packages
      : declared;
  return Array.isArray(listed) ? listed.filter(isString) : [];
}

function lernaGlobs(tree: Tree): string[] {
  if (!tree.blobs.has("lerna.json")) return [];
  const text = treeRead(tree, "lerna.json") ?? "";
  try {
    const v: unknown = (JSON.parse(text) as Record<string, unknown>).packages;
    return Array.isArray(v) ? v.filter(isString) : [];
  } catch {
    /* ignore */
    return [];
  }
}

function pnpmLine(
  acc: { inside: boolean; globs: string[] },
  l: string,
): { inside: boolean; globs: string[] } {
  if (YPKGS.test(l)) return { ...acc, inside: true };
  if (acc.inside && YITEM.test(l)) {
    const glob = l
      .replace(YOUT, "")
      .trim()
      .replace(/^['"]|['"]$/gu, "");
    return { ...acc, globs: [...acc.globs, glob] };
  }
  if (acc.inside && l.trim() && !YIND.test(l)) return { ...acc, inside: false };
  return acc;
}

function pnpmGlobs(tree: Tree): string[] {
  if (!tree.blobs.has("pnpm-workspace.yaml")) return [];
  const lines = (treeRead(tree, "pnpm-workspace.yaml") ?? "").split("\n");
  return lines.reduce(pnpmLine, { inside: false, globs: [] as string[] }).globs;
}

// The package directories the root declares as workspaces, sorted.
function workspaces(reach: Reach): string[] {
  const globs = [
    ...packageGlobs(packageIn(reach, "").workspaces),
    ...lernaGlobs(reach.t),
    ...pnpmGlobs(reach.t),
  ];
  const keep = globs.filter((g) => !g.startsWith("!")).map((g) => g.replace(/\/$/u, ""));
  const drop = globs.filter((g) => g.startsWith("!")).map((g) => g.slice(1).replace(/\/$/u, ""));
  const dirs = [...reach.t.blobs.keys()]
    .filter((p) => posix.basename(p) === "package.json")
    .map((p) => posix.dirname(p))
    .filter((d) => d !== "");
  return dirs
    .filter((d) => keep.some((g) => fnmatchCase(d, g)) && !drop.some((g) => fnmatchCase(d, g)))
    .toSorted();
}

function selects(reach: Reach, sel: string, d: string): boolean {
  const stripped = sel
    .trim()
    .replace(/^\.\.\.|\.\.\.$/gu, "")
    .replace(/^\{|\}$/gu, "")
    .trim();
  const s = stripped.startsWith("./") ? stripped.slice(2) : stripped;
  const name = String(packageIn(reach, d).name ?? "");
  return (
    s === d ||
    s === posix.basename(d) ||
    s === name ||
    fnmatchCase(d, s) ||
    (name !== "" && fnmatchCase(name, s))
  );
}

// The package directories a command works in, and the Reach that has looked at them.
function packageDirs(reach: Reach, ws: Workspaces, cwd: string): { dirs: string[]; reach: Reach } {
  if (ws === null) {
    const p = treeUp(reach.t, cwd, ["package.json"]);
    return { dirs: p ? [posix.dirname(p)] : [], reach };
  }
  const rooted = withPackage(reach, "");
  const dirs = workspaces(rooted);
  // Every one of these package.json files is read below, so they are asked for together.
  needBlobs(reach.t, dirs.map(packageJsonPath));
  if (ws === "all") return { dirs, reach: rooted };
  const looked = dirs.reduce((now, d) => withPackage(now, d), rooted);
  const chosen = dirs.filter((d) => ws.some((s) => selects(looked, s, d)));
  return { dirs: chosen.length > 0 ? chosen : dirs, reach: looked };
}

// "--key=value" as its key, whether it had a value, and the value.
function keyValue(arg: string): { key: string; hasEq: boolean; inline: string } {
  const eqIdx = arg.indexOf("=");
  if (eqIdx < 0) return { key: arg, hasEq: false, inline: "" };
  return { key: arg.slice(0, eqIdx), hasEq: true, inline: arg.slice(eqIdx + 1) };
}

// The flags a package manager gets before its subcommand, from `i` on: where they end, which
// workspaces they select, and the directory they move to.
function managerFlags(
  tree: Tree,
  pm: string,
  args: string[],
  i: number,
  ws: Workspaces,
  cwd: string,
): { i: number; ws: Workspaces; cwd: string } {
  const arg = args[i];
  if (arg === undefined || !arg.startsWith("-")) return { i, ws, cwd };
  const { key, hasEq, inline } = keyValue(arg);
  const takes =
    ["-C", "--dir", "--prefix", "--cwd", "--filter", "-F"].includes(key) ||
    (["-w", "--workspace"].includes(key) && pm !== "pnpm");
  const val = hasEq ? inline : i + 1 < args.length ? args[i + 1]! : "";
  const next = i + (takes && !hasEq ? 2 : 1);
  if (["-r", "--recursive", "-ws", "--workspaces"].includes(key)) {
    return managerFlags(tree, pm, args, next, "all", cwd);
  }
  if (["-C", "--dir", "--prefix", "--cwd"].includes(key)) {
    const d = treeDir(tree, cwd, val);
    return managerFlags(tree, pm, args, next, ws, d === null ? cwd : d);
  }
  if (takes) {
    const selected = Array.isArray(ws) ? [...ws, val] : [val];
    return managerFlags(tree, pm, args, next, selected, cwd);
  }
  return managerFlags(tree, pm, args, next, ws, cwd);
}

function manager(reach: Reach, where: string, pm: string, args: string[], cwd: string): Reach {
  const flags = managerFlags(reach.t, pm, args, 0, null, cwd);
  if (flags.i >= args.length) return reach;
  const sub = args[flags.i]!;
  const after = args.slice(flags.i + 1);
  const ws: Workspaces = after.includes("-ws") || after.includes("--workspaces") ? "all" : flags.ws;
  const names = after.filter((a) => !a.startsWith("-"));
  if (["run", "run-script", "rum", "urn"].includes(sub)) {
    return names.length > 0 ? runScript(reach, pm, names[0]!, ws, flags.cwd) : reach;
  }
  if (pm === "npm" && ["test", "t", "tst", "start", "stop", "restart"].includes(sub)) {
    return runScript(reach, pm, { t: "test", tst: "test" }[sub] ?? sub, ws, flags.cwd);
  }
  if (
    (pm === "npm" && (sub === "exec" || sub === "x")) ||
    (pm === "pnpm" && (sub === "exec" || sub === "dlx")) ||
    (pm === "yarn" && (sub === "exec" || sub === "dlx")) ||
    (pm === "bun" && sub === "x")
  ) {
    const firstOther = after.findIndex((a) => !a.startsWith("-") || a === "--");
    const j = firstOther < 0 ? after.length : firstOther;
    const words = after[j] === "--" ? after.slice(j + 1) : after.slice(j);
    return command(reach, where, words, flags.cwd).reach;
  }
  if (pm === "yarn" && sub === "workspaces" && names[0] === "foreach") {
    const runIdx = after.indexOf("run");
    const left = after.slice(runIdx >= 0 ? runIdx + 1 : 1).filter((a) => !a.startsWith("-"));
    return left.length > 0 ? runScript(reach, pm, left[0]!, "all", flags.cwd) : reach;
  }
  if (pm === "yarn" && sub === "workspace" && names.length > 1) {
    const left = names[1] === "run" ? names.slice(2) : names.slice(1);
    return left.length > 0 ? runScript(reach, pm, left[0]!, [names[0]!], flags.cwd) : reach;
  }
  if (pm !== "npm" && !BUILTINS[pm]?.has(sub)) return runScript(reach, pm, sub, ws, flags.cwd);
  return reach;
}

// Follows `npm run <name>` and its kin: the script in every package the command selects.
function runScript(reach: Reach, pm: string, name: string, ws: Workspaces, cwd: string): Reach {
  const found = packageDirs(reach, ws, cwd);
  const followed = found.dirs.reduce((now, d) => {
    const looked = withPackage(now, d);
    return name in scriptsIn(looked, d) ? followScript(looked, d, name, pm) : looked;
  }, found.reach);
  if (pm !== "bun" || ws !== null) return followed;
  if (found.dirs.some((d) => name in scriptsIn(followed, d))) return followed;
  const p = treeFile(followed.t, cwd, name);
  return p ? followFile(followed, p, cwd) : followed;
}

// Follows one script of package `d`, with the pre and post scripts the package manager runs.
function followScript(reach: Reach, d: string, name: string, pm: string): Reach {
  const looked = withPackage(reach, d);
  const s = scriptsIn(looked, d);
  const rooted = pm === "yarn" ? withPackage(looked, "") : looked;
  const hooks = pm === "yarn" && berry(rooted) ? [] : [`pre${name}`, `post${name}`];
  const all = [...hooks.slice(0, 1), name, ...hooks.slice(1)];
  return all.reduce((now, n) => {
    const key = `script|${d}|${n}`;
    if (!(n in s) || now.seen.has(key)) return now;
    return shell(withSeen(now, key), `${d ? `${d}/` : ""}package.json scripts.${n}`, s[n]!, d);
  }, rooted);
}

// Follows every script of the package at `cwd` whose name ends as `pattern` says.
function scriptsLike(reach: Reach, pattern: string, cwd: string): Reach {
  const parts = pattern.match(/\*\*|\*|\?|[^*?]+/gu) ?? [];
  const patSrc = parts
    .map((t) =>
      t === "**"
        ? ".*"
        : t === "*"
          ? "[^:]*"
          : t === "?"
            ? "[^:]"
            : t.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"),
    )
    .join("");
  const pat = new RegExp(`${patSrc}$`, "u");
  const found = packageDirs(reach, null, cwd);
  return found.dirs.reduce((now, d) => {
    const looked = withPackage(now, d);
    const matching = Object.keys(scriptsIn(looked, d))
      .toSorted()
      .filter((n) => pat.test(n));
    return matching.reduce((inner, n) => followScript(inner, d, n, "npm"), looked);
  }, found.reach);
}

// The selectors and the task names of a turbo or lerna command line, from `i` on.
function taskArgs(
  args: string[],
  i: number,
  sels: string[],
  names: string[],
): { sels: string[]; names: string[] } {
  if (i >= args.length || args[i] === "--") return { sels, names };
  const arg = args[i]!;
  const { key, hasEq, inline } = keyValue(arg);
  const val = hasEq ? inline : i + 1 < args.length ? args[i + 1]! : "";
  if (["--filter", "-F", "--scope"].includes(key)) {
    return taskArgs(args, i + (hasEq ? 1 : 2), [...sels, val], names);
  }
  if (!arg.startsWith("-")) return taskArgs(args, i + 1, sels, [...names, arg]);
  return taskArgs(args, i + 1, sels, names);
}

function tasks(reach: Reach, args: string[], cwd: string): Reach {
  const found = taskArgs(args, 0, [], []);
  const lead = found.names[0];
  const names = lead === "run" ? found.names.slice(1) : lead === "exec" ? [] : found.names;
  return names.reduce((now, n) => {
    if (n.startsWith("//#")) return runScript(now, "npm", n.slice(3), null, "");
    return runScript(now, "npm", n, found.sels.length > 0 ? found.sels : "all", cwd);
  }, reach);
}

// What a make command line holds: the directory it works in, the makefiles and targets it
// names, and the variables it sets.
interface MakeArgs {
  d: string;
  files: string[];
  targets: string[];
  sets: Array<[string, string]>;
}

const MAKE_VALUED = [
  "-C",
  "--directory",
  "-f",
  "--file",
  "--makefile",
  "-I",
  "--include-dir",
  "-o",
  "--old-file",
  "--assume-old",
  "-W",
  "--what-if",
  "--new-file",
  "--assume-new",
  "--eval",
];

// The effect of one make flag, by its key, on what the command line holds.
function makeFlag(tree: Tree, found: MakeArgs, arg: string, val: string): MakeArgs {
  const { key, hasEq } = keyValue(arg);
  if (key === "-C" || key === "--directory") {
    const nd = treeDir(tree, found.d, val);
    return nd === null ? found : { ...found, d: nd };
  }
  if (key === "-f" || key === "--file" || key === "--makefile") {
    return { ...found, files: [...found.files, val] };
  }
  // A variable named `__proto__` is not kept: an object takes no entry for that key.
  if (hasEq && !arg.startsWith("-") && key !== "__proto__") {
    return { ...found, sets: [...found.sets, [key, val]] };
  }
  return found;
}

function makeArgs(tree: Tree, args: string[], i: number, found: MakeArgs): MakeArgs {
  if (i >= args.length) return found;
  const a = args[i]!;
  const { hasEq, inline } = keyValue(a);
  const val = hasEq ? inline : i + 1 < args.length ? args[i + 1]! : "";
  if (MAKE_VALUED.includes(a) && i + 1 < args.length) {
    return makeArgs(tree, args, i + 2, makeFlag(tree, found, a, val));
  }
  if (
    ["-j", "--jobs", "-l", "--load-average", "--max-load"].includes(a) &&
    i + 1 < args.length &&
    MVER.test(args[i + 1]!)
  ) {
    return makeArgs(tree, args, i + 2, found);
  }
  if ((a.startsWith("-C") || a.startsWith("-f")) && a.length > 2 && !a.startsWith("--")) {
    const k = a.slice(0, 2);
    const v = a.slice(2);
    if (k === "-C") {
      const nd = treeDir(tree, found.d, v);
      return makeArgs(tree, args, i + 1, nd === null ? found : { ...found, d: nd });
    }
    return makeArgs(tree, args, i + 1, { ...found, files: [...found.files, v] });
  }
  if (!hasEq && !a.startsWith("-")) {
    return makeArgs(tree, args, i + 1, { ...found, targets: [...found.targets, a] });
  }
  return makeArgs(tree, args, i + 1, makeFlag(tree, found, a, val));
}

function make(reach: Reach, args: string[], cwd: string): Reach {
  const start: MakeArgs = { d: cwd, files: [], targets: [], sets: [] };
  const { d, files, targets, sets } = makeArgs(reach.t, args, 0, start);
  const candidates = files.length > 0 ? files : ["GNUmakefile", "makefile", "Makefile"];
  const p = firstFile(reach.t, d, candidates);
  if (!p) return reach;
  const mk = parseMakefile(reach.t, p, d, sets);
  const goals = targets.length > 0 ? targets : mk.goal ? [mk.goal] : [];
  return goals.reduce((now, t) => makeTarget(now, mk, t, d), reach);
}

// Follows a make target: its prerequisites first, then each line of its recipe.
function makeTarget(reach: Reach, mk: MakeFile, t: string, d: string): Reach {
  const key = `make|${mk.path}|${d}|${t}`;
  const rule = mk.rules.get(t);
  if (reach.seen.has(key) || rule === undefined) return reach;
  const marked = withSeen(reach, key);
  const afterPrereqs = rule.prereqs.reduce((now, p) => makeTarget(now, mk, p, d), marked);
  return rule.recipe.reduce(
    (now, line) => shell(now, `${mk.path} ${t}`, makeRecipe(mk, line), d),
    afterPrereqs,
  );
}

// What a just command line holds: the justfile and working directory it names, and the recipes.
interface JustArgs {
  jf: string | null;
  wd: string | null;
  names: string[];
}

function justArgs(args: string[], i: number, found: JustArgs): JustArgs {
  if (i >= args.length) return found;
  const arg = args[i]!;
  const { key, hasEq, inline } = keyValue(arg);
  if (key === "-f" || key === "--justfile" || key === "-d" || key === "--working-directory") {
    const val = hasEq ? inline : i + 1 < args.length ? args[i + 1]! : "";
    const named =
      key === "-f" || key === "--justfile" ? { ...found, jf: val } : { ...found, wd: val };
    return justArgs(args, i + (hasEq ? 1 : 2), named);
  }
  if (key === "--set") return justArgs(args, i + 2, found);
  if (!arg.startsWith("-"))
    return justArgs(args, i + 1, { ...found, names: [...found.names, arg] });
  return justArgs(args, i + 1, found);
}

function just(reach: Reach, args: string[], cwd: string): Reach {
  const { jf, wd, names } = justArgs(args, 0, { jf: null, wd: null, names: [] });
  const p = jf
    ? treeFile(reach.t, cwd, jf)
    : treeUp(reach.t, cwd, ["justfile", "Justfile", ".justfile", "JUSTFILE"]);
  if (!p) return reach;
  const parsed = parseJust(treeRead(reach.t, p) ?? "");
  const workDir = wd ? treeDir(reach.t, cwd, wd) : null;
  const d = workDir === null ? posix.dirname(p) : workDir;
  const toRun = names.filter((n) => parsed.recipes.has(n));
  const chosen = toRun.length > 0 ? toRun : parsed.first ? [parsed.first] : [];
  return chosen.reduce((now, n) => justRecipe(now, parsed, p, n, d), reach);
}

// Follows a justfile recipe: its dependencies first, then each line of its body, with the
// justfile's variables filled in.
function justRecipe(reach: Reach, parsed: JustRecipes, p: string, n: string, d: string): Reach {
  const key = `just|${p}|${n}`;
  const found = parsed.recipes.get(n);
  if (reach.seen.has(key) || found === undefined) return reach;
  const marked = withSeen(reach, key);
  const afterDeps = found.deps.reduce((now, dep) => justRecipe(now, parsed, p, dep, d), marked);
  return found.body.reduce((now, line) => {
    const filled = line.replace(MUSTACHE, (_, name) => parsed.vars.get(name) ?? `{{${name}}}`);
    return shell(now, `${p} ${n}`, filled.replace(/^[@-]+/u, ""), d);
  }, afterDeps);
}

// The Reach that has read a runner's config: its text and each of its lines, once.
function addConfig(reach: Reach, found: { where: string; text: string }): Reach {
  const key = `config|${found.where}`;
  if (reach.seen.has(key)) return reach;
  const trimmed = found.text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l);
  return {
    ...reach,
    seen: new Set([...reach.seen, key]),
    texts: [...reach.texts, { where: found.where, text: found.text }],
    lines: [...reach.lines, ...trimmed.map((line) => ({ where: found.where, line }))],
  };
}

function configs(reach: Reach, head: string, cwd: string): Reach {
  const files = (RUNNERS[head] ?? []).flatMap((n) => {
    const p = treeUp(reach.t, cwd, [n]);
    return p ? [{ where: p, text: configText(treeRead(reach.t, p) ?? "", p) }] : [];
  });
  const pj = head === "lint-staged" ? treeUp(reach.t, cwd, ["package.json"]) : null;
  const looked = pj ? withPackage(reach, posix.dirname(pj)) : reach;
  const configured = pj ? packageIn(looked, posix.dirname(pj))["lint-staged"] : undefined;
  const inPackage =
    pj && configured ? [{ where: `${pj} lint-staged`, text: JSON.stringify(configured) }] : [];
  return [...files, ...inPackage].reduce(addConfig, looked);
}

function followFile(reach: Reach, p: string, cwd: string): Reach {
  const key = `file|${p}`;
  if (reach.seen.has(key)) return reach;
  const marked = withSeen(reach, key);
  const text = treeRead(marked.t, p);
  if (text === null) return marked;
  return shell(marked, p, /\.[cm]?[jt]sx?$/u.test(p) ? stripJs(text) : text, cwd, true);
}

// The first of `names` that names a file of the branch.
function firstFile(tree: Tree, cwd: string, names: string[]): string | null {
  for (const n of names) {
    const p = treeFile(tree, cwd, n);
    if (p) return p;
  }
  return null;
}

// What a known tool's command line leads to.
function followTool(reach: Reach, where: string, head: string, rest: string[], cwd: string): Reach {
  if (head === "npm" || head === "pnpm" || head === "yarn" || head === "bun") {
    return manager(reach, where, head, rest, cwd);
  }
  if (head === "npm-run-all" || head === "npm-run-all2" || head === "run-s" || head === "run-p") {
    return rest
      .filter((a) => !a.startsWith("-"))
      .reduce((now, a) => scriptsLike(now, a, cwd), reach);
  }
  if (head === "make" || head === "gmake") return make(reach, rest, cwd);
  if (head === "just") return just(reach, rest, cwd);
  if (head === "turbo" || head === "lerna") return tasks(reach, rest, cwd);
  if (head in RUNNERS) return configs(reach, head, cwd);
  return reach;
}

// What a command that is itself a script, or runs one, leads to.
function followScriptFile(
  reach: Reach,
  head: string,
  w: string[],
  rest: string[],
  cwd: string,
): Reach {
  if (INTERPRETERS.has(head)) {
    const p = firstFile(
      reach.t,
      cwd,
      rest.filter((a) => !a.startsWith("-")),
    );
    return p ? followFile(reach, p, cwd) : reach;
  }
  if (w[0]?.includes("/")) {
    const p = treeFile(reach.t, cwd, w[0]!);
    return p ? followFile(reach, p, cwd) : reach;
  }
  return reach;
}

function command(reach: Reach, where: string, words: string[], cwd: string): Commanded {
  const w = unwrap(words);
  if (w.length === 0) return { reach, cwd, nested: words.length === 0 };
  const head = posix.basename(w[0]!);
  const rest = w.slice(1);
  if (head === "cd" || head === "pushd") {
    const args = rest.filter((a) => !a.startsWith("-"));
    const d = args.length > 0 ? treeDir(reach.t, cwd, args[0]!) : null;
    return { reach, cwd: d === null ? cwd : d, nested: false };
  }
  if (INERT.has(head)) return { reach, cwd, nested: false };
  const logged: Reach = { ...reach, cmds: [...reach.cmds, { where, words: w }] };
  const viaTool = followTool(logged, where, head, rest, cwd);
  const viaNpm = rest
    .filter((a) => a.startsWith("npm:"))
    .reduce((now, a) => scriptsLike(now, a.slice(4), cwd), viaTool);
  return { reach: followScriptFile(viaNpm, head, w, rest, cwd), cwd, nested: true };
}

// One piece of a line, in the walk of the line it is part of: `saved` holds the directories to
// return to at each ) that closes a (.
interface Scanning {
  reach: Reach;
  cwd: string;
  saved: string[];
}

function scanPiece(scanning: Scanning, where: string, piece: Piece): Scanning {
  if (piece.kind === "sep") {
    if (piece.token === "(") return { ...scanning, saved: [...scanning.saved, scanning.cwd] };
    if (piece.token === ")" && scanning.saved.length > 0) {
      return {
        ...scanning,
        cwd: scanning.saved[scanning.saved.length - 1]!,
        saved: scanning.saved.slice(0, -1),
      };
    }
    return scanning;
  }
  const ran = command(scanning.reach, where, piece.words, scanning.cwd);
  const quoted = ran.nested ? piece.words.filter((w) => /[ \t\r\n]/u.test(w)) : [];
  const reach = quoted.reduce((now, w) => scan(now, where, w, ran.cwd).reach, ran.reach);
  return { ...scanning, reach, cwd: ran.cwd };
}

function scan(reach: Reach, where: string, line: string, cwd: string): Walk {
  const start: Scanning = { reach, cwd, saved: [] };
  const end = commands(line).reduce((now, piece) => scanPiece(now, where, piece), start);
  return { reach: end.reach, cwd: end.cwd };
}

function shellLine(walk: Walk, where: string, raw: string, keepCd: boolean): Walk {
  const line = uncomment(raw).trim();
  if (!line) return walk;
  const logged: Reach = { ...walk.reach, lines: [...walk.reach.lines, { where, line }] };
  if (line.length > LONG) return { reach: logged, cwd: walk.cwd };
  const scanned = scan(logged, where, line, walk.cwd);
  return { reach: scanned.reach, cwd: keepCd ? scanned.cwd : walk.cwd };
}

function shell(reach: Reach, where: string, text: string, cwd: string, keepCd = false): Reach {
  const rawLines = text.replace(/\\\r?\n/gu, " ").split("\n");
  const start: Walk = { reach, cwd };
  return rawLines.reduce((walk, raw) => shellLine(walk, where, raw, keepCd), start).reach;
}

function reachOf(tree: Tree, gate: string): Reach {
  const none: Reach = {
    t: tree,
    cmds: [],
    texts: [],
    lines: [],
    seen: new Set(),
    warnings: [],
    pkgs: new Map(),
  };
  return shell(none, "gate", gate, "");
}

// Where the gate runs `linter`: the first command that names it, or else the first config text.
function runs(reach: Reach, linter: string): string | null {
  const viaCommand = reach.cmds.find(({ words }) =>
    words.some((w) => !/[ \t\r\n]/u.test(w) && named(linter, w)),
  );
  if (viaCommand) return viaCommand.where;
  const viaText = reach.texts.find((t) => named(linter, t.text));
  return viaText ? viaText.where : null;
}

// --- linter detection ---------------------------------------------------------------------------
// How many manifests are fetched together while looking for a linter in them.
const MANIFEST_GROUP = 16;

const MANIFESTS =
  /(^|\/)(package\.json|pyproject\.toml|setup\.cfg|tox\.ini|requirements[^/]*\.txt|Pipfile|Gemfile|go\.mod|Cargo\.toml|composer\.json|\.pre-commit-config\.ya?ml|\.tool-versions|mise\.toml)$/u;

function hasLinter(tree: Tree, linter: string): string | null {
  const own = new RegExp(
    `\\.?${linter.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(rc)?([._-].*)?$`,
    "iu",
  );
  const paths = [...tree.blobs.keys()].toSorted();
  const ownFile = paths.find((p) => own.test(posix.basename(p)));
  if (ownFile !== undefined) return ownFile;
  const manifests = paths.filter((p) => MANIFESTS.test(p));
  const groups = Array.from({ length: Math.ceil(manifests.length / MANIFEST_GROUP) }, (_, k) =>
    manifests.slice(k * MANIFEST_GROUP, (k + 1) * MANIFEST_GROUP),
  );
  for (const group of groups) {
    needBlobs(tree, group);
    const hit = group.find((p) => named(linter, configText(treeRead(tree, p) ?? "", p)));
    if (hit !== undefined) return hit;
  }
  return null;
}

// What the project's ledger last records of each style proposal, as the words a sort prints.
function ledgerStates(text: string): Record<string, string> {
  const events = text.split("\n").flatMap((row) => {
    const parsed = parseJson(row);
    if (!parsed.ok) return [];
    const e = parsed.value as Record<string, unknown> | null;
    return e && typeof e === "object" ? [e] : [];
  });
  return events.reduce(ledgerEvent, {} as Record<string, string>);
}

// The notes with `key` set to `note`. A key named `__proto__` is not kept: an object takes no
// entry for that key.
function noted(known: Record<string, string>, key: string, note: string): Record<string, string> {
  return key === "__proto__" ? known : { ...known, [key]: note };
}

function ledgerEvent(
  known: Record<string, string>,
  e: Record<string, unknown>,
): Record<string, string> {
  const a = e.action;
  const d = String(e.detail ?? "");
  const runName = e.run ?? "?";
  if (a === "ticket-create" && d.startsWith("style proposal: ")) {
    return noted(known, d.slice(16).trim(), `filed ${e.target ?? "?"} in ${runName}`);
  }
  if (a === "note" && d.startsWith("style proposal declined: ")) {
    const key = d.slice(25).split(": ", 1)[0]!.trim();
    return noted(known, key, `declined in ${runName}`);
  }
  if (a === "note" && d.startsWith("style proposal asked: ")) {
    const k = d.slice(22).trim();
    const was = known[k] ?? "";
    if (!was.startsWith("filed") && !was.startsWith("declined")) {
      return noted(known, k, `asked in ${runName}`);
    }
  }
  return known;
}

function readLedger(path: string): string | null {
  try {
    // BASE opened the ledger with utf-8-sig: a byte-order mark is not part of the content.
    return readFileSync(path, "utf8").replace(/^\uFEFF/u, "");
  } catch {
    return null;
  }
}

function states(dispatch: string): Record<string, string> {
  const LEDGER = join(dirname(resolve(dispatch)), "ledger.jsonl");
  const text = readLedger(LEDGER);
  return text === null ? {} : ledgerStates(text);
}

// --- sort line parsing ---------------------------------------------------------------------------
const ENTRY = new RegExp(
  "^(?:[-*+][ \t]+)?(S\\p{Nd}+|N\\p{Nd}+)[ \t]+(" +
    PY_DOT +
    "+?):(?:[ \t]+(" +
    PY_DOT +
    "*))?" +
    END_OF_STRING +
    "",
  "u",
);

function isLinterHead(head: string[]): boolean {
  return (
    head[0] === "linter" &&
    (head.length === 4 || (head.length === 6 && head[4] === "via")) &&
    (head[2] === "enable" || head[2] === "write")
  );
}

export function shape(line: string): { id: string; head: string[]; reason: string } | null {
  const m = ENTRY.exec(line);
  if (!m) return null;
  const i = m[1]!;
  const head = pyWords(m[2] ?? "");
  const reason = pyTrim(m[3] ?? "");
  const ok =
    i[0] === "S"
      ? isLinterHead(head) ||
        (head.length === 2 && head[0] === "docs") ||
        (head.length === 1 && head[0] === "neither")
      : head.length >= 3 && head[0] === "new-linter";
  return ok ? { id: i, head, reason } : null;
}

// --- commands -------------------------------------------------------------------------------------
type Shaped = NonNullable<ReturnType<typeof shape>>;

// A line of a sort that is not blank and not a comment, and the shape it has, if any.
interface SortEntry {
  n: number;
  line: string;
  got: Shaped | null;
}

// One proposal a sort line makes, grouped under its key when they are printed.
interface Proposal {
  id: string;
  key: string;
  via: string | null;
  newInfo: [string[], boolean] | null;
}

// What a sort line says that has to be true of the branch.
type Check =
  | { n: number; id: string; kind: "linter"; lint: string; extra: string | null }
  | { n: number; id: string; kind: "new"; lint: string; extra: boolean };

function sortEntries(text: string): SortEntry[] {
  return text.split("\n").flatMap((raw, k) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return [];
    return [{ n: k + 1, line, got: shape(line) }];
  });
}

// The findings a new-linter line covers, and whether it says the linter is not in the gate.
function covered(head: string[]): { covers: string[]; marked: boolean } {
  const rest = head.slice(2);
  const marked = rest[rest.length - 1] === "not-in-gate";
  const covers = (marked ? rest.slice(0, -1) : rest).join(" ").split(COVERSPLIT).filter(Boolean);
  return { covers, marked };
}

// What is wrong with one line of a sort, given the findings of the run and the new-linter lines
// before it.
function lineFaults(entry: SortEntry, earlierNew: SortEntry[], ids: string[]): string[] {
  const { n, line, got } = entry;
  if (!got) return [`line ${n} is not a sort line: ${line}`];
  const { id: i, head, reason } = got;
  const noReason = reason ? [] : [`line ${n}: ${i} has no reason`];
  if (i[0] === "S") {
    const unknown = ids.includes(i) ? [] : [`line ${n}: ${i} is not a style finding of this run`];
    return [...noReason, ...unknown];
  }
  const { covers } = covered(head);
  const none =
    covers.length === 0 ? [`line ${n}: ${i} names no finding the linter would enforce`] : [];
  const strangers = covers
    .filter((c) => !ids.includes(c))
    .map((c) => `line ${n}: ${i} names ${c}, which is not a style finding of this run`);
  const lint = plain(head[1]!);
  const was = earlierNew.find((e) => pyLower(plain(e.got!.head[1]!)) === pyLower(lint));
  const again = was
    ? [
        `line ${n}: ${i} proposes ${lint} again, as ${was.got!.id} on line ${was.n} does: propose it once, for every finding it would enforce`,
      ]
    : [];
  return [...noReason, ...none, ...strangers, ...again];
}

function isNewLine(entry: SortEntry): boolean {
  return entry.got !== null && entry.got.id[0] !== "S";
}

// Every id the style findings have that no line of the sort is for.
function unsortedFaults(entries: SortEntry[], ids: string[]): string[] {
  return ids
    .filter((i) => !entries.some((e) => e.got !== null && e.got.id === i))
    .map((i) => `${i} is not sorted`);
}

// Every id that two lines or more are for, style findings first.
function repeatedFaults(entries: SortEntry[]): string[] {
  const shaped = entries.flatMap((e) => (e.got ? [{ n: e.n, id: e.got.id }] : []));
  const sIds = [...new Set(shaped.filter((s) => s.id[0] === "S").map((s) => s.id))];
  const nIds = [...new Set(shaped.filter((s) => s.id[0] !== "S").map((s) => s.id))];
  return [...sIds, ...nIds].flatMap((id) => {
    const where = shaped.filter((s) => s.id === id).map((s) => s.n);
    return where.length > 1 ? [`${id} is sorted twice, on lines ${where.join(", ")}`] : [];
  });
}

// The proposal a shaped line makes, and the check it needs of the branch, if any.
function entryParts(n: number, got: Shaped): { prop: Proposal; check: Check | null } {
  const { id: i, head } = got;
  if (i[0] === "S" && head[0] !== "linter") {
    const key = head[0] === "docs" ? `docs ${plain(head[1]!)}` : "neither";
    return { prop: { id: i, key, via: null, newInfo: null }, check: null };
  }
  if (i[0] === "S") {
    const lint = plain(head[1]!);
    const via = head.length === 6 ? plain(head[5]!) : null;
    const key = `linter ${pyLower(lint)} ${head[2]} ${plain(head[3]!)}`;
    return {
      prop: { id: i, key, via, newInfo: null },
      check: { n, id: i, kind: "linter", lint, extra: via },
    };
  }
  const { covers, marked } = covered(head);
  const lint = plain(head[1]!);
  return {
    prop: { id: i, key: `new-linter ${pyLower(lint)}`, via: null, newInfo: [covers, marked] },
    check: { n, id: i, kind: "new", lint, extra: marked },
  };
}

// A sort read against the style findings of the run: what is wrong with its lines, what it
// proposes, and what of the branch it needs checked.
interface Sorted {
  faults: string[];
  badShape: boolean;
  props: Proposal[];
  checks: Check[];
  newLinters: number;
}

function readSort(text: string, ids: string[]): Sorted {
  const entries = sortEntries(text);
  const perLine = entries.flatMap((entry, k) =>
    lineFaults(entry, entries.slice(0, k).filter(isNewLine), ids),
  );
  const faults = [...perLine, ...unsortedFaults(entries, ids), ...repeatedFaults(entries)];
  const parts = entries.flatMap((e) => (e.got ? [entryParts(e.n, e.got)] : []));
  const newLints = entries.filter(isNewLine).map((e) => pyLower(plain(e.got!.head[1]!)));
  return {
    faults,
    badShape: entries.some((e) => e.got === null),
    props: parts.map((p) => p.prop),
    checks: parts.flatMap((p) => (p.check ? [p.check] : [])),
    newLinters: new Set(newLints).size,
  };
}

// Why a check fails against the branch, or null when it holds. `reach` is what the gate reaches,
// null where the waybill names no gate.
function checkFault(tree: Tree, reach: Reach | null, c: Check): string | null {
  const { n, id: i, lint } = c;
  if (c.kind === "linter" && c.extra) {
    const p = treeFile(tree, "", c.extra);
    if (p === null) {
      return `line ${n}: ${i} names ${lint} via ${c.extra}, which the run's branch does not have`;
    }
    if (!named(lint, configText(treeRead(tree, p) ?? "", p))) {
      return `line ${n}: ${i} names ${lint} via ${c.extra}, which does not name ${lint}`;
    }
    return null;
  }
  if (c.kind === "linter" && reach === null) {
    return `line ${n}: ${i} names ${lint}, and the waybill's Project profile has no gate to check it against`;
  }
  if (c.kind === "linter" && reach !== null && !runs(reach, lint)) {
    return `line ${n}: ${i} names ${lint}, which \`gate\` does not show the gate running: if the gate runs it some way \`gate\` does not follow, add via and the file that runs it after the rule; if it does not, sort the finding docs or neither, and propose ${lint} on a new-linter line`;
  }
  if (c.kind === "new") {
    const at = reach === null ? null : runs(reach, lint);
    if (at) {
      return `line ${n}: ${i} proposes ${lint}, which the gate already runs (${at}): sort its findings as linter lines`;
    }
    const own = hasLinter(tree, lint);
    if (own && !c.extra) {
      return `line ${n}: ${i} proposes ${lint}, which the project already has (${own}): if the gate runs it, sort its findings as linter lines, with via if \`gate\` does not show it; if the gate does not, add not-in-gate after the findings`;
    }
  }
  return null;
}

// What the checks find wrong with the branch, and what reading the gate warned of on the way.
function verifyChecks(
  tree: Tree,
  gate: string | null,
  checks: Check[],
): { warnings: string[]; faults: string[] } {
  const reach = gate ? reachOf(tree, gate) : null;
  const faults = checks.flatMap((c) => {
    const fault = checkFault(tree, reach, c);
    return fault === null ? [] : [fault];
  });
  return { warnings: reach ? [...reach.warnings] : [], faults };
}

// The line a group of proposals is printed as.
function groupLine(key: string, members: Proposal[], seenState: Record<string, string>): string {
  const ids = members.map((m) => m.id).join(" ");
  const vias = [...new Set(members.flatMap((m) => (m.via ? [m.via] : [])))];
  const newInfo = members.map((m) => m.newInfo).find((info) => info !== null) ?? null;
  const notes = [
    ...(newInfo ? [`for ${newInfo[0].join(" ")}`] : []),
    ...vias.map((v) => `via ${v}`),
    ...(newInfo?.[1] ? ["not in the gate"] : []),
    ...(key !== "neither" && key in seenState ? [seenState[key]!] : []),
  ];
  return `${ids}: ${key}${notes.length > 0 ? ` [${notes.join("; ")}]` : ""}`;
}

function plural(k: number, one: string, many: string): string {
  return `${k} ${k === 1 ? one : many}`;
}

// What a sort that has no fault prints: each proposal, then the counts.
function proposalLines(
  sorted: Sorted,
  seenState: Record<string, string>,
  styleCount: number,
): string[] {
  const { props, newLinters } = sorted;
  const rank: Record<string, number> = { linter: 0, docs: 1, "new-linter": 2, neither: 3 };
  const keys = [...new Set(props.map((p) => p.key))];
  const sortedKeys = keys.toSorted(
    (a, b) => (rank[a.split(" ")[0]!] ?? 9) - (rank[b.split(" ")[0]!] ?? 9),
  );
  const groups = sortedKeys.map((key) =>
    groupLine(
      key,
      props.filter((p) => p.key === key),
      seenState,
    ),
  );
  const kinds = props.filter((p) => p.id[0] === "S").map((p) => p.key.split(" ")[0]!);
  const count = (kind: string) => kinds.filter((k) => k === kind).length;
  const summary = `sorted ${plural(styleCount, "style finding", "style findings")}: ${count("linter")} to a linter, ${count("docs")} to the docs, ${count("neither")} to neither; ${plural(newLinters, "new linter", "new linters")} proposed`;
  return [...groups, summary];
}

// The lines `gate` shows: the first SHOWN of each file or script, in the order they were read,
// then a count of the lines of each that were read and not shown.
function gateLines(lines: ReadonlyArray<{ where: string; line: string }>): string[] {
  const indexed = lines.map((l, k) => ({ ...l, k }));
  const wheres = [...new Set(lines.map((l) => l.where))];
  const byWhere = wheres.map((where) => indexed.filter((l) => l.where === where));
  const shown = byWhere.flatMap((group) => group.slice(0, SHOWN)).toSorted((a, b) => a.k - b.k);
  const shownLines = shown.map(
    ({ where, line }) => `${where}: ${line.length <= 200 ? line : `${line.slice(0, 197)}...`}`,
  );
  const hidden = byWhere
    .filter((group) => group.length > SHOWN)
    .map((group) => `${group[0]!.where}: ${group.length - SHOWN} more lines, read and not shown`);
  return [...shownLines, ...hidden];
}

// Each command below reads what it needs, decides with the functions above, and prints.
function formsCommand(file: string): number {
  for (const line of read(file, "file").split("\n")) {
    const t = line.trim();
    if (t) console.log((shape(t) ? "ok  " : "bad ") + t);
  }
  return 0;
}

function listCommand(cmd: string, dispatch: string): number {
  const { style, faults } = findings(dispatch);
  if (faults.length > 0) {
    console.log(faults.join("\n"));
    return 2;
  }
  if (cmd === "count") console.log(String(style.length));
  for (const f of cmd === "list" ? style : []) {
    console.log([f.id, f.target, f.rest].filter(Boolean).join(" "));
  }
  return 0;
}

function gateCommand(dispatch: string, runName: string): number {
  const { repo, gate } = profile(dispatch);
  if (!gate || !repo || !existsSync(repo)) {
    console.log(
      !gate
        ? "the waybill's Project profile names no gate"
        : `the waybill's Project profile names no repo that exists${repo ? `: ${repo}` : ""}`,
    );
    return 2;
  }
  const reach = settle(loadTree(repo, runName), (tree) => reachOf(tree, gate));
  for (const w of reach.warnings) console.error(`style-findings: ${w}`);
  for (const line of gateLines(reach.lines)) console.log(line);
  return 0;
}

// What the checks of a sort find wrong with the run's branch.
function branchFaults(dispatch: string, runName: string, checks: Check[]): string[] {
  const { repo, gate } = profile(dispatch);
  if (!repo || !existsSync(repo)) {
    return checks.map(
      ({ n, id: i, lint }) =>
        `line ${n}: ${i} names ${lint}, and the waybill's Project profile names no repo that exists to check it against`,
    );
  }
  const verdict = settle(loadTree(repo, runName), (tree) => verifyChecks(tree, gate, checks));
  for (const w of verdict.warnings) console.error(`style-findings: ${w}`);
  return verdict.faults;
}

function checkCommand(dispatch: string, runName: string, sortPath: string): number {
  const { style, faults } = findings(dispatch);
  const ids = style.map((s) => s.id);
  if (!existsSync(sortPath)) {
    if (faults.length > 0 || style.length > 0) {
      console.log(
        [
          ...faults,
          `no style-sort.md in ${dispatch}, and ${style.length} style finding${style.length === 1 ? "" : "s"} to sort`,
        ].join("\n"),
      );
      return 2;
    }
    console.log("no style findings, so nothing to sort");
    return 0;
  }

  const sorted = readSort(read(sortPath, "sort"), ids);
  const onBranch = sorted.checks.length > 0 ? branchFaults(dispatch, runName, sorted.checks) : [];
  const allFaults = [...faults, ...sorted.faults, ...onBranch];
  if (allFaults.length > 0) {
    console.log([...allFaults, ...(sorted.badShape ? [FORMS] : [])].join("\n"));
    return 2;
  }

  // Print proposals
  for (const line of proposalLines(sorted, states(dispatch), ids.length)) console.log(line);
  return 0;
}

export function core(cmd: string, dispatch: string): number {
  const RUN = basename(resolve(dispatch));
  const SORT = join(dispatch, "style-sort.md");

  if (cmd === "forms") return formsCommand(dispatch);
  if (cmd === "list" || cmd === "count") return listCommand(cmd, dispatch);
  if (cmd === "gate") return gateCommand(dispatch, RUN);
  // check
  return checkCommand(dispatch, RUN, SORT);
}

// --- entry -----------------------------------------------------------------------------------------
function usage(): number {
  console.error("usage: run style-findings list|count|gate|check <dispatch>");
  return 1;
}

function main(argv: string[]): number {
  const sub = argv[0];
  if (sub !== "list" && sub !== "count" && sub !== "gate" && sub !== "check") return usage();
  if (argv.length !== 2) return usage();
  const d = argv[1]!;
  if (!existsSync(d)) {
    console.error(`style-findings: no dispatch directory at ${d}`);
    return 1;
  }
  return core(sub, d);
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
