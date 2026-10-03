// A lane's reach outside its own folder: what its own record of tool calls shows it read or
// wrote, and what the run's own branches and synthesis worktree show changed around a review
// round. Reads each lane's record of its tool calls, never the lane's report, and contacts no
// remote.
//
//   reach.ts stream <D> <lane> <events> <own-folder>
//   reach.ts before <D> <n>
//   reach.ts check  <D> workhorses | r<n> | card
//   reach.ts restore <D> r<n>
//
//   D          the run's dispatch directory, <repo>/.postmaster/runs/<T>
//   lane       a lane name; its harness comes from run.json's config.lanes
//   events     the lane's events stream (its own record of tool calls)
//   own-folder the lane's own worktree or scratch
//   n          a review round, a whole number from 1
//
// `stream` reports every place outside the lane's folder its record shows the lane read or
// wrote. `before` records this run's own refs, the main checkout's head and branch, and the
// synthesis worktree's head and status before a round. `check` runs at a point: `workhorses`
// after the workhorses finish, `r<n>` after a review round, `card` before the ship card. It
// lists every changed or new file in the main checkout, says when the checkout is not on its
// default branch, and at `workhorses` and `r<n>` lists every place outside a lane's folder
// that lane read or wrote. `restore` puts the run's own branches and synthesis worktree back
// as `before` recorded them, keeping a copy of what it undid and moving any new file out of
// the synthesis worktree into the run's records.
//
// Exit codes for `stream` and `check`:
//   0  clean: nothing to report
//   1  cannot check: a fault in the check itself, such as a main checkout it cannot read
//   2  a finding: a write outside a lane's folder, or a main checkout change no lane's record
//      explains at `workhorses`
//   3  notes only: reads, refused attempts, a main checkout change at a round or at the card
//
// Lanes and harnesses come from run.json's config, workhorses from manifest.json, a round's
// reviewers from logs/review-r<n>.json. A lane whose record cannot be read is reported as not
// checked, never as clean. The tools with a reader are codex, Claude Code, Muse Code, MiMo
// Code and pi; grok and Antigravity have none yet and read not checked.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { tryJsonFile } from "./lib/data.ts";
import { toolRoot } from "./lib/paths.ts";
import { run } from "./lib/proc.ts";

// --- vocabulary --------------------------------------------------------------------------
/** Where a path sits, as the check names it. `normal` is not reported. */
export type Place = "inside" | "main" | "synthesis" | "worktree" | "elsewhere" | "normal";
/** The strongest access a lane had at a path. */
export type Access = "read" | "write" | "refused";
/** One lane and one path, with the strongest access the lane had there. */
export interface Entry {
  lane: string;
  path: string;
  access: Access;
  place: Place;
  /** True when the access was through git on a folder, not a file edit. */
  viaGit?: boolean;
  /** The run ref this access moved, when it moved one. */
  ref?: string;
}

const READERS = new Set(["codex", "claude", "muse", "mimo", "pi"]);

/** Paths outside the repository and $HOME, for reading: system files. */
function isSystemPath(p: string): boolean {
  return (
    !p.startsWith("/home/") &&
    !p.startsWith("/Users/") &&
    !isUnderHome(p) &&
    !p.startsWith("/tmp") &&
    !p.startsWith("/private/tmp") &&
    !p.startsWith("/var/folders")
  );
}

function home(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? "";
}

function isUnderHome(p: string): boolean {
  const h = home();
  return h !== "" && (p === h || p.startsWith(`${h}/`));
}

/** Reading these under $HOME is normal: the lane's own settings and data. */
function isNormalRead(p: string): boolean {
  const h = home();
  const rel = isUnderHome(p) ? p.slice(h.length + 1) : "";
  if (rel === "") return false;
  return (
    rel === ".codex" ||
    rel.startsWith(".codex/") ||
    rel === ".claude" ||
    rel.startsWith(".claude/") ||
    rel === ".claude.json" ||
    rel === ".config/muse" ||
    rel.startsWith(".config/muse/") ||
    rel === ".config/mimocode" ||
    rel.startsWith(".config/mimocode/") ||
    rel === ".mimocode" ||
    rel.startsWith(".mimocode/") ||
    rel === ".pi/agent" ||
    rel.startsWith(".pi/agent/")
  );
}

/** Reading and writing the home caches is normal. */
function isNormalHomeRW(p: string): boolean {
  const h = home();
  const rel = isUnderHome(p) ? p.slice(h.length + 1) : "";
  if (rel === ".npm" || rel.startsWith(".npm/")) return true;
  if (rel === ".cache" || rel.startsWith(".cache/")) return true;
  if (rel === ".bun" || rel.startsWith(".bun/")) return true;
  return false;
}

/** Reading and writing the temp folder and /dev is normal, away from $HOME. */
function isNormalTemp(p: string): boolean {
  const tmp = process.env.TMPDIR ?? "/tmp";
  if (isUnderHome(p)) return false;
  if (p === tmp || p.startsWith(`${tmp}/`)) return true;
  if (p === "/tmp" || p.startsWith("/tmp/")) return true;
  if (p === "/private/tmp" || p.startsWith("/private/tmp/")) return true;
  if (p === "/var/folders" || p.startsWith("/var/folders/")) return true;
  if (p === "/dev" || p.startsWith("/dev/")) return true;
  return false;
}

/** Reading and writing these is normal: temp, /dev, caches, the tool's own data. */
function isNormalReadWrite(p: string): boolean {
  return isNormalHomeRW(p) || isNormalTemp(p);
}

/** The run's tool checkout, the lane's prompt and brief files in the dispatch folder. */
function isRunNormal(p: string, D: string, tool: string): boolean {
  if (tool !== "" && (p === tool || p.startsWith(`${tool}/`))) return true;
  if (p === D || p.startsWith(`${D}/`)) {
    const base = basename(p);
    if (base === "brief.md") return true;
    if (base.endsWith("-prompt.txt")) return true;
    return false;
  }
  return false;
}

// --- paths ---------------------------------------------------------------------------------
/** Resolve a path the way a lane's folder would: `~`, `$HOME`, relative, `..`, links. */
export function resolvePath(raw: string, cwd: string): string {
  let p = raw;
  if (p === "~") p = home();
  else if (p.startsWith("~/")) p = join(home(), p.slice(2));
  else if (p === "$HOME") p = home();
  else if (p.startsWith("$HOME/")) p = join(home(), p.slice(6));
  if (!isAbsolute(p)) p = resolve(cwd, p);
  p = normalize(p);
  try {
    return realpathSync(p);
  } catch {
    // A path that does not resolve still names a place: return the normalized form.
    return p;
  }
}

/** Whether a path needs a variable other than $HOME or a glob: skipped. */
export function needsVariableOrGlob(p: string): boolean {
  if (/[?*[\]]/u.test(p)) return true;
  return /\$(?!HOME\b)[A-Za-z_]/u.test(p);
}

/** A path's place in the run's layout. */
export function placeOf(
  p: string,
  ownFolder: string,
  repo: string,
  ticket: string,
  tool: string,
  D: string,
): Place {
  const own = resolvePath(ownFolder, ownFolder);
  const abs = isAbsolute(p) ? normalize(p) : resolvePath(p, ownFolder);
  const resolved = (() => {
    try {
      return realpathSync(abs);
    } catch {
      return abs;
    }
  })();
  if (resolved === own || resolved.startsWith(`${own}/`)) return "inside";
  const worktrees = join(repo, ".worktrees");
  const synth = join(worktrees, ticket);
  if (resolved === synth || resolved.startsWith(`${synth}/`)) return "synthesis";
  if (resolved.startsWith(`${worktrees}/`)) return "worktree";
  if (resolved === repo || resolved.startsWith(`${repo}/`)) return "main";
  // Under $HOME the lane's own settings and caches are normal; anything else is elsewhere.
  if (isUnderHome(resolved)) {
    if (isNormalRead(resolved) || isNormalReadWrite(resolved)) return "normal";
    return "elsewhere";
  }
  if (isNormalReadWrite(resolved)) return "normal";
  if (isRunNormal(resolved, D, tool)) return "normal";
  if (isSystemPath(resolved)) return "normal";
  return "elsewhere";
}

// --- records: run.json, manifest.json, review-r<n>.json ------------------------------------
interface LaneSpec {
  harness: string;
  model?: string;
  effort?: string;
}

export interface RunConfig {
  lanes: Record<string, LaneSpec>;
  team: {
    workhorses?: string[];
    coachman?: { harness?: string; model?: string; effort?: string };
    [k: string]: unknown;
  };
}

export interface RunJson {
  config?: RunConfig;
  target?: { head?: string | null; branch?: string | null };
  postmaster?: { checkout?: string };
  [k: string]: unknown;
}

export function loadRunJson(D: string): RunJson {
  const path = join(D, "run.json");
  const data = tryJsonFile<RunJson>(path);
  if (data === null) throw new Error(`reach: cannot read ${path}`);
  return data;
}

export function loadManifest(D: string): { lanes: Record<string, unknown> } {
  const path = join(D, "manifest.json");
  const data = tryJsonFile<{ lanes: Record<string, unknown> }>(path);
  if (data === null || typeof data.lanes !== "object" || data.lanes === null) {
    return { lanes: {} };
  }
  return { lanes: data.lanes };
}

/** A round's reviewers, as [lens, lane] pairs, from logs/review-r<n>.json. */
export function loadReviewers(D: string, n: string): Array<[string, string]> {
  const path = join(D, "logs", `review-r${n}.json`);
  const data = tryJsonFile<{ reviewers?: Array<[string, string]> }>(path);
  if (data === null || !Array.isArray(data.reviewers)) return [];
  return data.reviewers.filter(
    (r): r is [string, string] =>
      Array.isArray(r) && typeof r[0] === "string" && typeof r[1] === "string",
  );
}

/** The repository root, three levels above the dispatch directory. */
export function repoOf(D: string): string {
  return dirname(dirname(dirname(D)));
}

/** The ticket name, the dispatch directory's own name. */
export function ticketOf(D: string): string {
  return basename(D);
}

/** The run's tool checkout from run.json, or "" when it records none. */
export function toolOf(D: string): string {
  const r = loadRunJson(D);
  return typeof r.postmaster?.checkout === "string" ? r.postmaster.checkout : "";
}

// --- shell commands -------------------------------------------------------------------------
/** Git subcommands that only show something. */
const GIT_READS = new Set([
  "status",
  "diff",
  "log",
  "show",
  "rev-parse",
  "rev-list",
  "merge-base",
  "ls-files",
  "ls-tree",
  "cat-file",
  "show-ref",
  "for-each-ref",
  "describe",
  "blame",
  "grep",
  "worktree",
  "stash",
  "branch",
  "tag",
]);

/** Commands whose path arguments are written, not read. */
const WRITERS = new Set(["cp", "mv", "rm", "mkdir", "touch", "tee", "sed", "ln", "install"]);

/** A shell fragment: one command after splitting on `;`, `&&`, `||`, `|`. */
export interface Fragment {
  /** The words of the command, after `cd` application. */
  words: string[];
  /** Whether this fragment is a redirect target that is written. */
  writePaths: string[];
  /** Paths this fragment reads. */
  readPaths: string[];
  /** Whether the fragment runs git, and against which folder. */
  git?: { cwd: string; write: boolean; ref?: string };
}

/** Unwrap `bash -lc '…'` and `/bin/bash -lc '…'`, returning the inner command or null. */
export function unwrapBash(words: string[]): string | null {
  if (words.length < 3) return null;
  const cmd = words[0] ?? "";
  if (cmd !== "bash" && cmd !== "/bin/bash" && cmd !== "/usr/bin/bash") return null;
  const flag = words[1] ?? "";
  if (flag !== "-lc" && flag !== "-c") return null;
  return words[2] ?? null;
}

/** Split a shell line on `;`, `&&`, `||`, `|` and `$(…)`, respecting quotes. Quote characters
 * are kept in the fragment so `tokenize` can read `-lc '<a command>'` as one word. */
export function splitShell(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let i = 0;
  let quote: string | null = null;
  const push = (): void => {
    const t = cur.trim();
    if (t !== "") out.push(t);
    cur = "";
  };
  while (i < line.length) {
    const ch = line[i]!;
    if (quote !== null) {
      cur += ch;
      if (ch === quote) quote = null;
      else if (ch === "\\" && quote === '"' && i + 1 < line.length) {
        cur += line[i + 1]!;
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      cur += ch;
      i++;
      continue;
    }
    if (ch === "\\") {
      cur += ch + (line[i + 1] ?? "");
      i += 2;
      continue;
    }
    // Command substitution: treat its contents as a nested command.
    if (ch === "$" && line[i + 1] === "(") {
      push();
      let depth = 1;
      let j = i + 2;
      let inner = "";
      while (j < line.length && depth > 0) {
        if (line[j] === "(") depth++;
        else if (line[j] === ")") {
          depth--;
          if (depth === 0) break;
        }
        inner += line[j];
        j++;
      }
      out.push(...splitShell(inner));
      i = j + 1;
      continue;
    }
    if (ch === ";") {
      push();
      i++;
      continue;
    }
    if (ch === "&" && line[i + 1] === "&") {
      push();
      i += 2;
      continue;
    }
    if (ch === "|" && line[i + 1] === "|") {
      push();
      i += 2;
      continue;
    }
    if (ch === "|") {
      push();
      i++;
      continue;
    }
    cur += ch;
    i++;
  }
  push();
  return out;
}

/** Tokenize one fragment into words, respecting quotes. */
export function tokenize(cmd: string): string[] {
  const words: string[] = [];
  let cur = "";
  let quote: string | null = null;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i]!;
    if (quote !== null) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === " " || ch === "\t") {
      if (cur !== "") {
        words.push(cur);
        cur = "";
      }
      continue;
    }
    cur += ch;
  }
  if (cur !== "") words.push(cur);
  return words;
}

function isFlag(w: string): boolean {
  return w.startsWith("-") && w !== "-" && w !== "--";
}

/** Paths a command names as file arguments (not flags). */
function pathArgs(words: string[]): string[] {
  const out: string[] = [];
  for (let i = 1; i < words.length; i++) {
    const w = words[i]!;
    if (isFlag(w)) continue;
    if (w.includes("=") && w.startsWith("--")) continue;
    out.push(w);
  }
  return out;
}

/** The git folder a fragment aims at: -C, --git-dir, --work-tree, GIT_DIR=, or the cwd. */
function gitCwd(words: string[], cwd: string): string {
  for (let i = 1; i < words.length; i++) {
    const w = words[i]!;
    if (w === "-C" || w === "--git-dir" || w === "--work-tree") {
      const v = words[i + 1];
      if (v !== undefined && !isFlag(v)) return resolvePath(v, cwd);
    }
    if (w.startsWith("--git-dir=")) return resolvePath(w.slice("--git-dir=".length), cwd);
    if (w.startsWith("--work-tree=")) return resolvePath(w.slice("--work-tree=".length), cwd);
    if (w.startsWith("GIT_DIR=")) return resolvePath(w.slice("GIT_DIR=".length), cwd);
  }
  return cwd;
}

/** A git subcommand's name, the first non-flag word after the git folder. */
function gitSubcommand(words: string[]): string {
  for (let i = 1; i < words.length; i++) {
    const w = words[i]!;
    if (isFlag(w)) {
      if (w === "-C" || w === "--git-dir" || w === "--work-tree") i++;
      continue;
    }
    return w;
  }
  return "";
}

/** Whether a git subcommand only shows something. A bare `branch` or `tag` reads. */
function gitIsRead(sub: string, words: string[]): boolean {
  if (!GIT_READS.has(sub)) return false;
  if (sub === "branch" || sub === "tag") {
    // `branch -f` or `tag -f` moves a ref; a bare list reads.
    return !words.some(
      (w) =>
        w === "-f" ||
        w === "--force" ||
        w === "-d" ||
        w === "--delete" ||
        w === "-D" ||
        w === "-m" ||
        w === "--move" ||
        (w === "-a" && false),
    );
  }
  if (sub === "config") {
    return words.some((w) => w === "--get" || w === "--get-all");
  }
  if (sub === "worktree") {
    return words.includes("list");
  }
  if (sub === "stash") {
    return words.includes("list");
  }
  return true;
}

/** The ref a git write moves, when the command names one. */
function gitRefOf(words: string[]): string | undefined {
  for (let i = 1; i < words.length; i++) {
    const w = words[i]!;
    if (w.startsWith("refs/heads/")) return w;
  }
  return undefined;
}

/** Parse one shell fragment into read and write paths and a possible git call. */
export function parseFragment(cmd: string, cwd: string): Fragment {
  let words = tokenize(cmd);
  // Unwrap bash -lc.
  const cmdName = words[0] ?? "";
  if (cmdName === "bash" || cmdName === "/bin/bash" || cmdName === "/usr/bin/bash") {
    const inner = unwrapBash(words);
    if (inner !== null && inner !== "") {
      return parseFragment(inner, cwd);
    }
  }
  // Apply cd: `cd <path>` moves the cwd for later fragments; a `cd <path> && …` carries it here.
  if (cmdName === "cd") {
    const target = words[1];
    if (target !== undefined && !needsVariableOrGlob(target)) {
      return { words: [], writePaths: [], readPaths: [] };
    }
    return { words: [], writePaths: [], readPaths: [] };
  }
  // Redirects: the target of `>` or `>>` is written.
  const writePaths: string[] = [];
  const readPaths: string[] = [];
  const gitParts: string[] = [];
  const words2: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    if (w === ">" || w === ">>" || w === ">|" || w === "1>" || w === "2>" || w === "&>") {
      const target = words[i + 1];
      if (target !== undefined && !needsVariableOrGlob(target)) writePaths.push(target);
      i++;
      continue;
    }
    if (w === "<") {
      const target = words[i + 1];
      if (target !== undefined && !needsVariableOrGlob(target)) readPaths.push(target);
      i++;
      continue;
    }
    words2.push(w);
  }
  words = words2;
  const name = words[0] ?? "";
  // git
  if (name === "git" || name.endsWith("/git")) {
    const gcwd = gitCwd(words, cwd);
    const sub = gitSubcommand(words);
    const write = !gitIsRead(sub, words);
    const ref = write ? gitRefOf(words) : undefined;
    if (sub !== "" && sub !== "-C" && !isFlag(sub)) {
      gitParts.push(gcwd);
    }
    return {
      words,
      writePaths: write ? [gcwd] : [],
      readPaths: write ? [] : [gcwd],
      git: { cwd: gcwd, write, ref },
    };
  }
  // Writer commands: every path argument is written.
  if (WRITERS.has(name) || name.endsWith("/cp") || name.endsWith("/mv") || name.endsWith("/rm")) {
    for (const p of pathArgs(words)) {
      if (!needsVariableOrGlob(p)) writePaths.push(p);
    }
    return { words, writePaths, readPaths };
  }
  // sed -i writes its file operands.
  if (name === "sed" && words.some((w) => w === "-i" || w.startsWith("-i"))) {
    for (const p of pathArgs(words)) {
      if (!needsVariableOrGlob(p) && !p.startsWith("-")) writePaths.push(p);
    }
    return { words, writePaths, readPaths };
  }
  // Any other path a command names is read (D17).
  for (const p of pathArgs(words)) {
    if (!needsVariableOrGlob(p)) readPaths.push(p);
  }
  return { words, writePaths, readPaths };
}

// --- harness stream parsing ----------------------------------------------------------------
/** One tool call a stream shows, with the paths it names and how it ended. */
export interface ToolCall {
  /** The tool's own name, as the harness records it. */
  tool: string;
  /** The command it ran, when it ran one. */
  command?: string;
  /** Paths it wrote by file tool. */
  fileWrites: string[];
  /** Paths it read by file tool. */
  fileReads: string[];
  /** Paths its command named. */
  cmdWrites: string[];
  cmdReads: string[];
  /** The result text, for refusal detection. */
  output: string;
  /** Whether the tool reported an error. */
  error: boolean;
  /** Whether the result is a refusal. */
  refused: boolean;
}

const REFUSAL_RE =
  /Permission denied|Operation not permitted|Read-only file system|EACCES|EPERM|EROFS/iu;

function isRefusal(text: string): boolean {
  return REFUSAL_RE.test(text);
}

/** A record's tool calls, whatever harness's shape it is. */
export function parseStream(text: string, harness: string): ToolCall[] {
  const rows = jsonRows(text);
  if (harness === "codex") return parseCodex(rows);
  if (harness === "claude") return parseClaude(rows);
  if (harness === "mimo") return parseMimo(rows);
  if (harness === "pi") return parsePi(rows);
  if (harness === "muse") return parseMuse(rows);
  return [];
}

function jsonRows(text: string): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t === "") continue;
    try {
      const v = JSON.parse(t) as unknown;
      if (v !== null && typeof v === "object" && !Array.isArray(v))
        rows.push(v as Record<string, unknown>);
    } catch {
      // A line that is not JSON is not a tool call.
    }
  }
  return rows;
}

function asRec(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** codex: `item.completed` items `command_execution` and `file_change`. */
function parseCodex(rows: Array<Record<string, unknown>>): ToolCall[] {
  const out: ToolCall[] = [];
  for (const r of rows) {
    if (r.type !== "item.completed") continue;
    const it = asRec(r.item);
    const k = str(it.type);
    if (k === "command_execution") {
      const command = str(it.command);
      const output = str(it.aggregated_output);
      const code = typeof it.exit_code === "number" ? it.exit_code : 0;
      out.push(commandCall(command, output, code !== 0, isRefusal(output)));
    } else if (k === "file_change") {
      const changes = Array.isArray(it.changes) ? it.changes : [];
      const paths = changes.map((c) => str(asRec(c).path)).filter((p) => p !== "");
      out.push({
        tool: "file_change",
        fileWrites: paths,
        fileReads: [],
        cmdWrites: [],
        cmdReads: [],
        output: "",
        error: false,
        refused: false,
      });
    }
  }
  return out;
}

/** Claude Code: `assistant` `tool_use` blocks and their `tool_result`. */
function parseClaude(rows: Array<Record<string, unknown>>): ToolCall[] {
  const out: ToolCall[] = [];
  const results = new Map<string, { output: string; error: boolean }>();
  for (const r of rows) {
    const t = str(r.type);
    if (t === "user") {
      const msg = asRec(r.message);
      const content = Array.isArray(msg.content) ? msg.content : [];
      for (const b of content) {
        const blk = asRec(b);
        if (str(blk.type) === "tool_result") {
          const id = str(blk.tool_use_id);
          const text = textOf(blk.content);
          results.set(id, { output: text, error: blk.is_error === true });
        }
      }
    }
  }
  for (const r of rows) {
    const t = str(r.type);
    if (t !== "assistant") continue;
    const msg = asRec(r.message);
    const content = Array.isArray(msg.content) ? msg.content : [];
    for (const b of content) {
      const blk = asRec(b);
      if (str(blk.type) !== "tool_use") continue;
      const name = str(blk.name);
      const input = asRec(blk.input);
      const id = str(blk.id);
      const res = results.get(id) ?? { output: "", error: false };
      const call = claudeCall(name, input, res.output, res.error);
      out.push(call);
    }
  }
  return out;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        const o = asRec(b);
        return str(o.text);
      })
      .filter((s) => s !== "")
      .join("\n");
  }
  return "";
}

function claudeCall(
  name: string,
  input: Record<string, unknown>,
  output: string,
  error: boolean,
): ToolCall {
  const file = str(input.file_path) || str(input.notebook_path) || str(input.path);
  const command = str(input.command);
  const refused = isRefusal(output);
  if (name === "Bash" || name === "BashOutput" || command !== "") {
    return commandCall(command, output, error, refused);
  }
  if (name === "Write" || name === "Edit" || name === "MultiEdit" || name === "NotebookEdit") {
    return {
      tool: name,
      fileWrites: file !== "" ? [file] : [],
      fileReads: [],
      cmdWrites: [],
      cmdReads: [],
      output,
      error,
      refused,
    };
  }
  if (name === "Read") {
    return {
      tool: name,
      fileWrites: [],
      fileReads: file !== "" ? [file] : [],
      cmdWrites: [],
      cmdReads: [],
      output,
      error,
      refused,
    };
  }
  // A tool not known to change files counts as reading the paths it names (D17).
  return {
    tool: name,
    fileWrites: [],
    fileReads: file !== "" ? [file] : [],
    cmdWrites: [],
    cmdReads: [],
    output,
    error,
    refused,
  };
}

/** MiMo Code: `tool_use` with `part.tool` and `part.state`. */
function parseMimo(rows: Array<Record<string, unknown>>): ToolCall[] {
  const out: ToolCall[] = [];
  for (const r of rows) {
    if (r.type !== "tool_use") continue;
    const part = asRec(r.part);
    const tool = str(part.tool);
    const state = asRec(part.state);
    const input = asRec(state.input);
    const output = str(state.output);
    const meta = asRec(state.metadata);
    const code = typeof meta.exit === "number" ? meta.exit : 0;
    const refused = isRefusal(output);
    const command = str(input.command);
    const file = str(input.file_path) || str(input.path);
    if (tool === "bash" || command !== "") {
      out.push(commandCall(command, output, code !== 0, refused));
    } else if (tool === "write" || tool === "edit" || tool === "multiedit") {
      out.push({
        tool,
        fileWrites: file !== "" ? [file] : [],
        fileReads: [],
        cmdWrites: [],
        cmdReads: [],
        output,
        error: state.status === "error",
        refused,
      });
    } else if (tool === "read" || tool === "read_file") {
      out.push({
        tool,
        fileWrites: [],
        fileReads: file !== "" ? [file] : [],
        cmdWrites: [],
        cmdReads: [],
        output,
        error: state.status === "error",
        refused,
      });
    } else {
      out.push({
        tool,
        fileWrites: [],
        fileReads: file !== "" ? [file] : [],
        cmdWrites: [],
        cmdReads: [],
        output,
        error: state.status === "error",
        refused,
      });
    }
  }
  return out;
}

/** pi: `tool_execution_start` (`toolName`, `args`) and `tool_execution_end`. */
function parsePi(rows: Array<Record<string, unknown>>): ToolCall[] {
  const out: ToolCall[] = [];
  const errors = new Map<string, boolean>();
  for (const r of rows) {
    if (r.type === "tool_execution_end") {
      errors.set(str(r.toolName), r.isError === true);
    }
  }
  for (const r of rows) {
    if (r.type !== "tool_execution_start") continue;
    const tool = str(r.toolName);
    const args = asRec(r.args);
    const command = str(args.command);
    const file = str(args.file_path) || str(args.path);
    const error = errors.get(tool) === true;
    if (tool === "bash" || tool === "shell" || tool === "exec" || command !== "") {
      out.push(commandCall(command, "", error, false));
    } else if (
      tool === "write" ||
      tool === "edit" ||
      tool === "write_file" ||
      tool === "edit_file"
    ) {
      out.push({
        tool,
        fileWrites: file !== "" ? [file] : [],
        fileReads: [],
        cmdWrites: [],
        cmdReads: [],
        output: "",
        error,
        refused: false,
      });
    } else {
      out.push({
        tool,
        fileWrites: [],
        fileReads: file !== "" ? [file] : [],
        cmdWrites: [],
        cmdReads: [],
        output: "",
        error,
        refused: false,
      });
    }
  }
  return out;
}

/** Muse Code: `tool.result` with `correlation_facts`, `edit_facts`, and the result text. */
function parseMuse(rows: Array<Record<string, unknown>>): ToolCall[] {
  const out: ToolCall[] = [];
  for (const r of rows) {
    if (r.payload_type !== "tool.result") continue;
    const p = asRec(r.payload);
    const facts = asRec(p.correlation_facts);
    const tool = str(facts.tool_name) || "tool";
    const ef = asRec(p.edit_facts);
    const text = str(p.text);
    const outcome = facts.outcome;
    const error = outcome === "error";
    const refused = isRefusal(text);
    const writePath = str(ef.path) || str(ef.file_path);
    if (writePath !== "") {
      out.push({
        tool,
        fileWrites: [writePath],
        fileReads: [],
        cmdWrites: [],
        cmdReads: [],
        output: text,
        error,
        refused,
      });
      continue;
    }
    // A bash result's text is JSON with the command; a read_file's text opens with "Read text file `path`".
    let command = "";
    let readPath = "";
    const t = text.replace(/^\s+/u, "");
    if (t.startsWith("{")) {
      try {
        const blob = JSON.parse(t) as Record<string, unknown>;
        command = str(blob.command) || str(blob.cmd);
        readPath = str(blob.file_path) || str(blob.path);
      } catch {
        /* not JSON */
      }
    } else {
      const m = /^Read text file `([^`]+)`/u.exec(t);
      if (m?.[1]) readPath = m[1];
    }
    if (command !== "") {
      out.push(commandCall(command, text, error, refused));
    } else {
      out.push({
        tool,
        fileWrites: [],
        fileReads: readPath !== "" ? [readPath] : [],
        cmdWrites: [],
        cmdReads: [],
        output: text,
        error,
        refused,
      });
    }
  }
  return out;
}

/** A shell command's paths, split into reads and writes. */
function commandCall(command: string, output: string, error: boolean, refused: boolean): ToolCall {
  const cmdWrites: string[] = [];
  const cmdReads: string[] = [];
  if (command !== "") {
    const fragments = splitShell(command);
    // cd carries its path for later fragments.
    let cwd = "";
    for (const f of fragments) {
      const words = tokenize(f);
      const name = words[0] ?? "";
      if (name === "cd") {
        const target = words[1];
        if (target !== undefined && !needsVariableOrGlob(target)) cwd = target;
        continue;
      }
      const parsed = parseFragment(f, cwd);
      cmdWrites.push(...parsed.writePaths);
      cmdReads.push(...parsed.readPaths);
      if (parsed.git) {
        // Every git call is judged: the strongest wins. A write is a write to the folder.
        if (parsed.git.write) cmdWrites.push(parsed.git.cwd);
        else cmdReads.push(parsed.git.cwd);
      }
    }
  }
  return {
    tool: "bash",
    command,
    fileWrites: [],
    fileReads: [],
    cmdWrites,
    cmdReads,
    output,
    error,
    refused,
  };
}

// --- entries from calls -------------------------------------------------------------------
/** Turn tool calls into one entry per lane and path, with the strongest access. */
export function entriesFromCalls(
  lane: string,
  calls: ToolCall[],
  ownFolder: string,
  repo: string,
  ticket: string,
  tool: string,
  D: string,
): Entry[] {
  const byPath = new Map<string, Entry>();
  const add = (raw: string, access: Access, viaGit: boolean, ref?: string): void => {
    if (raw === "" || needsVariableOrGlob(raw)) return;
    const abs = resolvePath(raw, ownFolder);
    const place = placeOf(abs, ownFolder, repo, ticket, tool, D);
    if (place === "normal") return;
    const key = abs;
    const prev = byPath.get(key);
    const strength: Record<Access, number> = { read: 1, refused: 1, write: 2 };
    if (prev === undefined) {
      byPath.set(key, { lane, path: abs, access, place, viaGit, ref });
    } else {
      // The strongest wins; a refusal is a note even where a write landed in another call.
      if (strength[access] > strength[prev.access]) {
        prev.access = access;
      }
      if (viaGit) prev.viaGit = true;
      if (ref !== undefined && prev.ref === undefined) prev.ref = ref;
    }
  };
  for (const call of calls) {
    for (const p of call.fileWrites) add(p, call.refused ? "refused" : "write", false);
    for (const p of call.fileReads) add(p, call.refused ? "refused" : "read", false);
    for (const p of call.cmdWrites) add(p, call.refused ? "refused" : "write", true);
    for (const p of call.cmdReads) add(p, call.refused ? "refused" : "read", true);
  }
  return [...byPath.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** A path outside the lane's folder that is not normal is a finding when written, a note
 * otherwise. Inside and normal are `expected`, never a finding or a note. */
export function classify(e: Entry): "finding" | "note" | "expected" {
  if (e.place === "inside" || e.place === "normal") return "expected";
  if (e.access === "write") return "finding";
  return "note";
}

// --- main checkout -------------------------------------------------------------------------
/** The main checkout's status through check-target's reach form. */
export interface Checkout {
  /** Each changed or new file, as check-target lists it. */
  paths: string[];
  /** The branch the checkout is on. */
  branch: string;
  /** The default branch. */
  defaultBranch: string;
  /** Whether the checkout is off its default branch. */
  offDefault: boolean;
  /** The checkout's HEAD. */
  head: string;
  /** Whether the check could read the checkout at all. */
  fault: string;
}

/** Run check-target.ts in its reach form: list every path, no fetch. */
export function checkoutReach(repo: string, defaultBranch: string): Checkout {
  const script = join(toolRoot(import.meta), "scripts", "check-target.sh");
  const r = run(script, ["--reach", repo, defaultBranch]);
  const paths: string[] = [];
  let branch = "";
  let head = "";
  let offDefault = false;
  for (const line of r.out.split("\n")) {
    const m = /^branch (.*)$/u.exec(line);
    if (m) branch = m[1] ?? "";
    const h = /^head (.*)$/u.exec(line);
    if (h) head = h[1] ?? "";
    if (line.startsWith("off ")) offDefault = true;
    const p = /^path (.*)$/u.exec(line);
    if (p) paths.push(p[1] ?? "");
  }
  if (r.code === 1) {
    return {
      paths: [],
      branch: "",
      defaultBranch,
      offDefault: false,
      head: "",
      fault: r.err || r.out,
    };
  }
  // exit 2 is a dirty or off-default checkout: that is an answer, not a fault.
  return { paths, branch, defaultBranch, offDefault, head, fault: "" };
}

// --- refs and synthesis worktree -----------------------------------------------------------
export interface Refs {
  /** This run's own refs, and what they point at. */
  refs: Record<string, string>;
  /** The main checkout's HEAD and branch. */
  mainHead: string;
  mainBranch: string;
  /** The synthesis worktree's HEAD. */
  synthHead: string;
  /** The synthesis worktree's status, every path. */
  synthStatus: string[];
}

/** Record this run's refs, the main checkout's head and branch, and the synthesis worktree. */
export function recordRefs(D: string, repo: string, ticket: string): Refs {
  const refs: Record<string, string> = {};
  const list = run("git", [
    "-C",
    repo,
    "for-each-ref",
    "--format=%(refname) %(objectname)",
    "refs/heads",
  ]);
  for (const line of list.out.split("\n")) {
    const [name, sha] = line.split(" ");
    if (!name || !sha) continue;
    if (name === `refs/heads/${ticket}` || name.startsWith(`refs/heads/wb/${ticket}-`)) {
      refs[name] = sha;
    }
  }
  const mainHead = run("git", ["-C", repo, "rev-parse", "HEAD"]).out.trim();
  const mainBranch = run("git", ["-C", repo, "rev-parse", "--abbrev-ref", "HEAD"]).out.trim();
  const synth = join(repo, ".worktrees", ticket);
  let synthHead = "";
  const synthStatus: string[] = [];
  if (existsSync(synth)) {
    synthHead = run("git", ["-C", synth, "rev-parse", "HEAD"]).out.trim();
    const st = run("git", ["-C", synth, "status", "--porcelain", "-uall"]);
    for (const line of st.out.split("\n")) {
      if (line.trim() !== "") synthStatus.push(line);
    }
  }
  return { refs, mainHead, mainBranch, synthHead, synthStatus };
}

// --- logging -------------------------------------------------------------------------------
/** Write one `reach` line to the run's log. */
export function logReach(D: string, actor: string, target: string, detail: string): void {
  const script = join(toolRoot(import.meta), "scripts", "log-action.sh");
  run(script, [D, actor, "reach", target, detail]);
}

// --- entry ---------------------------------------------------------------------------------
function usage(): never {
  console.error(
    "usage: reach.ts stream <D> <lane> <events> <own-folder> | before <D> <n> | check <D> workhorses|r<n>|card | restore <D> r<n>",
  );
  process.exit(1);
}

/** The layout a check runs on. */
interface Layout {
  D: string;
  repo: string;
  ticket: string;
  tool: string;
  runJson: RunJson;
  manifest: { lanes: Record<string, unknown> };
}

function layout(D: string): Layout {
  const repo = repoOf(D);
  const ticket = ticketOf(D);
  const runJson = loadRunJson(D);
  const manifest = loadManifest(D);
  const tool = typeof runJson.postmaster?.checkout === "string" ? runJson.postmaster.checkout : "";
  return { D, repo, ticket, tool, runJson, manifest };
}

/** Every workhorse lane, from manifest.json. */
function workhorseLanes(L: Layout): string[] {
  return Object.keys(L.manifest.lanes);
}

/** Every lane in the run's config, with its harness. */
function laneHarness(L: Layout, lane: string): string {
  return L.runJson.config?.lanes?.[lane]?.harness ?? "";
}

/** A lane's own folder. */
function ownFolderOf(L: Layout, lane: string): string {
  return join(L.repo, ".worktrees", `${L.ticket}-${lane}`);
}

/** A reviewer's own folder, a scratch. */
function scratchOf(L: Layout, lens: string, lane: string): string {
  return join(L.repo, ".worktrees", `${L.ticket}-rev-${lens}-${lane}`);
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (cmd === "stream") {
    if (argv.length !== 5) usage();
    const [D, lane, events, ownFolder] = [argv[1]!, argv[2]!, argv[3]!, argv[4]!];
    let L: Layout;
    try {
      L = layout(D);
    } catch (e) {
      console.log(`not checked ${(e as Error).message}`);
      process.exit(3);
    }
    const harness = laneHarness(L, lane);
    if (!READERS.has(harness)) {
      console.log(`not checked ${lane}: ${harness || "no harness"} has no reader`);
      process.exit(3);
    }
    if (!existsSync(events)) {
      console.log(`not checked ${lane}: no record at ${events}`);
      process.exit(3);
    }
    let text: string;
    try {
      text = readFileSync(events, "utf8");
    } catch {
      console.log(`not checked ${lane}: ${events} cannot be read`);
      process.exit(3);
    }
    const calls = parseStream(text, harness);
    if (calls.length === 0) {
      console.log(`not checked ${lane}: no tool call in its record`);
      process.exit(3);
    }
    // A Claude Code bug lane's writes are also in its copied task file.
    if (harness === "claude") {
      const logs = join(D, "logs");
      const stem = basename(events).replace(/\.jsonl?$/u, "");
      if (existsSync(logs)) {
        for (const f of readdirSync(logs)) {
          if (f.startsWith(`${stem}-claude-task-`) || f.includes("claude-task-")) {
            try {
              const t = readFileSync(join(logs, f), "utf8");
              calls.push(...parseStream(t, harness));
            } catch {
              /* an unread task file adds nothing */
            }
          }
        }
      }
    }
    const entries = entriesFromCalls(lane, calls, ownFolder, L.repo, L.ticket, L.tool, L.D);
    let finding = false;
    let note = false;
    for (const e of entries) {
      const kind = classify(e);
      const placeName =
        e.place === "main"
          ? "main checkout"
          : e.place === "synthesis"
            ? "synthesis worktree"
            : e.place === "worktree"
              ? "another worktree"
              : e.place;
      const rel = displayPath(e.path, L.repo, home());
      const accessName = e.access === "refused" ? "refused" : e.access;
      if (kind === "expected") {
        console.log(`expected ${rel} ${accessName} (${placeName})`);
        continue;
      }
      console.log(`${kind} ${rel} ${accessName} (${placeName})`);
      if (kind === "finding") finding = true;
      else note = true;
    }
    process.exit(finding ? 2 : note ? 3 : 0);
  } else if (cmd === "before") {
    if (argv.length !== 3) usage();
    const [D, n] = [argv[1]!, argv[2]!];
    if (!/^[0-9]+$/u.test(n) || n.startsWith("0")) {
      console.error(`reach: a round is a whole number from 1: ${n}`);
      process.exit(1);
    }
    const L = layout(D);
    const refs = recordRefs(L.D, L.repo, L.ticket);
    const dir = join(L.D, "reach");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `before-r${n}.json`), `${JSON.stringify(refs, null, 2)}\n`);
    console.log(`recorded before r${n}`);
    process.exit(0);
  } else if (cmd === "check") {
    if (argv.length !== 3) usage();
    const [D, point] = [argv[1]!, argv[2]!];
    let L: Layout;
    try {
      L = layout(D);
    } catch (e) {
      console.log(`cannot check: ${(e as Error).message}`);
      process.exit(1);
    }
    const out = checkAt(L, point);
    for (const line of out.lines) console.log(line);
    process.exit(out.code);
  } else if (cmd === "restore") {
    if (argv.length !== 3) usage();
    const [D, n] = [argv[1]!, argv[2]!];
    if (!/^[0-9]+$/u.test(n) || n.startsWith("0")) {
      console.error(`reach: a round is a whole number from 1: ${n}`);
      process.exit(1);
    }
    const L = layout(D);
    restoreRound(L, n);
    console.log(`restored after r${n}`);
    process.exit(0);
  } else {
    usage();
  }
}

/** A path on the card and in the check's own output: relative to the repository when inside
 * it, relative to $HOME when under it, absolute otherwise. The full path stays in the log. */
export function displayPath(p: string, repo: string, h: string): string {
  if (p === repo || p.startsWith(`${repo}/`)) {
    const rel = relative(repo, p);
    return rel === "" ? "." : rel;
  }
  if (h !== "" && (p === h || p.startsWith(`${h}/`))) {
    const rel = relative(h, p);
    return rel === "" ? "~" : rel;
  }
  return p;
}

/** The check at one point. */
export function checkAt(L: Layout, point: string): { code: number; lines: string[] } {
  const lines: string[] = [];
  let code = 0;
  const raise = (c: number): void => {
    if (c === 2) code = 2;
    else if (c === 3 && code !== 2) code = 3;
    else if (c === 1) code = 1;
  };
  // The main checkout, at every point.
  const defBranch = L.runJson.target?.branch ?? "main";
  const checkout = checkoutReach(L.repo, defBranch);
  if (checkout.fault !== "") {
    lines.push(`cannot check: ${checkout.fault}`);
    logReach(L.D, "coachman", point, `fault ${checkout.fault}`);
    return { code: 1, lines };
  }
  if (checkout.offDefault) {
    lines.push(`off ${checkout.branch} (default ${defBranch})`);
    raise(2);
  }
  if (checkout.paths.length > 0) {
    // A dirty main checkout is never clean: it raises the exit at every point (C3). At
    // workhorses it is a finding, since it escalates before synthesis (AC8); at a round or
    // the card it is a note on the card and stops nothing (AC13, C13).
    raise(2);
    const kind = point === "workhorses" ? "finding" : "note";
    logReach(L.D, "coachman", point, `main ${checkout.paths.length} path(s)`);
    for (const p of checkout.paths) {
      lines.push(`${kind} main ${p}`);
      logReach(L.D, "coachman", point, `main path ${p}`);
    }
  } else {
    logReach(L.D, "coachman", point, "clean");
  }
  // Lane records, at workhorses and at a round.
  const lanes: Array<{ lane: string; folder: string }> = [];
  if (point === "workhorses") {
    for (const lane of workhorseLanes(L)) {
      lanes.push({ lane, folder: ownFolderOf(L, lane) });
    }
  } else if (/^r[0-9]+$/u.test(point)) {
    const n = point.slice(1);
    for (const [lens, lane] of loadReviewers(L.D, n)) {
      lanes.push({ lane, folder: scratchOf(L, lens, lane) });
    }
    // Compare this run's own branches and synthesis worktree with `before`.
    const beforePath = join(L.D, "reach", `before-r${n}.json`);
    if (existsSync(beforePath)) {
      const before = tryJsonFile<Refs>(beforePath);
      if (before) {
        const now = recordRefs(L.D, L.repo, L.ticket);
        for (const [name, sha] of Object.entries(now.refs)) {
          const was = before.refs[name];
          if (was !== undefined && was !== sha) {
            lines.push(`ref ${name} ${was}..${sha}`);
            raise(2);
          } else if (was === undefined) {
            lines.push(`ref ${name} new ${sha}`);
            raise(2);
          }
        }
        for (const name of Object.keys(before.refs)) {
          if (!(name in now.refs)) {
            lines.push(`ref ${name} gone`);
            raise(2);
          }
        }
        if (before.synthHead !== now.synthHead && now.synthHead !== "") {
          lines.push(`synth ${before.synthHead}..${now.synthHead}`);
          raise(2);
        }
        const beforeSet = new Set(before.synthStatus);
        for (const st of now.synthStatus) {
          if (!beforeSet.has(st)) {
            lines.push(`synth ${st}`);
            raise(2);
          }
        }
      }
    }
  }
  for (const { lane, folder } of lanes) {
    const harness = laneHarness(L, lane);
    const events = join(L.D, "logs", `${lane}-events.jsonl`);
    // A reviewer's stream is review-r<n>-<lens>-<lane>.jsonl; find it.
    let stream = events;
    if (/^r[0-9]+$/u.test(point)) {
      const n = point.slice(1);
      const logs = join(L.D, "logs");
      if (existsSync(logs)) {
        const m = readdirSync(logs).find(
          (f) => f.startsWith(`review-r${n}-`) && f.includes(lane) && f.endsWith(".jsonl"),
        );
        if (m) stream = join(logs, m);
      }
    }
    if (!READERS.has(harness)) {
      lines.push(`not checked ${lane}: ${harness || "no harness"} has no reader`);
      logReach(L.D, "coachman", point, `not checked ${lane}`);
      raise(3);
      continue;
    }
    if (!existsSync(stream)) {
      lines.push(`not checked ${lane}: no record at ${stream}`);
      logReach(L.D, "coachman", point, `not checked ${lane}`);
      raise(3);
      continue;
    }
    let text: string;
    try {
      text = readFileSync(stream, "utf8");
    } catch {
      lines.push(`not checked ${lane}: ${stream} cannot be read`);
      logReach(L.D, "coachman", point, `not checked ${lane}`);
      raise(3);
      continue;
    }
    const calls = parseStream(text, harness);
    if (calls.length === 0) {
      lines.push(`not checked ${lane}: no tool call in its record`);
      logReach(L.D, "coachman", point, `not checked ${lane}`);
      raise(3);
      continue;
    }
    if (harness === "claude") {
      const logs = join(L.D, "logs");
      const stem = basename(stream).replace(/\.jsonl?$/u, "");
      if (existsSync(logs)) {
        for (const f of readdirSync(logs)) {
          if (f.startsWith(`${stem}-claude-task-`) || f.includes("claude-task-")) {
            try {
              calls.push(...parseStream(readFileSync(join(logs, f), "utf8"), harness));
            } catch {
              /* ignore */
            }
          }
        }
      }
    }
    const entries = entriesFromCalls(lane, calls, folder, L.repo, L.ticket, L.tool, L.D);
    for (const e of entries) {
      const kind = classify(e);
      const placeName =
        e.place === "main"
          ? "main checkout"
          : e.place === "synthesis"
            ? "synthesis worktree"
            : e.place === "worktree"
              ? "another worktree"
              : e.place;
      const rel = displayPath(e.path, L.repo, home());
      const accessName = e.access === "refused" ? "refused" : e.access;
      if (kind === "expected") {
        lines.push(`expected ${rel} ${accessName} (${placeName})`);
        continue;
      }
      lines.push(`${kind} ${rel} ${accessName} (${placeName})`);
      logReach(L.D, "coachman", point, `${kind} ${lane} ${e.path} ${accessName} ${placeName}`);
      if (kind === "finding") raise(2);
      else raise(3);
    }
    // A write that moved a run ref is also a finding from the lane's own stream.
    for (const e of entries) {
      if (e.ref !== undefined) {
        lines.push(`ref ${e.ref} by ${lane}`);
        logReach(L.D, "coachman", point, `finding ${lane} ${e.ref} ref`);
        raise(2);
      }
    }
  }
  return { code, lines };
}

/** Put the run's own branches and synthesis worktree back as `before` recorded them. */
export function restoreRound(L: Layout, n: string): void {
  const beforePath = join(L.D, "reach", `before-r${n}.json`);
  if (!existsSync(beforePath)) return;
  const before = tryJsonFile<Refs>(beforePath);
  if (!before) return;
  const saved = join(L.D, "reach", `r${n}`);
  mkdirSync(saved, { recursive: true });
  // Save what is undone, then reset.
  for (const [name, was] of Object.entries(before.refs)) {
    const now = run("git", ["-C", L.repo, "rev-parse", name]).out.trim();
    if (now !== was && now !== "") {
      const diff = run("git", ["-C", L.repo, "diff", "--binary", was, now]);
      if (diff.out !== "") {
        writeFileSync(join(saved, `${name.replace(/[\\/]/gu, "_")}.diff`), diff.out);
      }
    }
  }
  const synth = join(L.repo, ".worktrees", L.ticket);
  if (existsSync(synth) && before.synthHead !== "") {
    const now = run("git", ["-C", synth, "rev-parse", "HEAD"]).out.trim();
    if (now !== before.synthHead) {
      const diff = run("git", ["-C", synth, "diff", "--binary", before.synthHead, now]);
      if (diff.out !== "") {
        writeFileSync(join(saved, "synthesis.diff"), diff.out);
      }
    }
  }
  // Move every new file in the synthesis worktree to D/reach/r<n>/, keeping its path.
  if (existsSync(synth)) {
    const st = run("git", ["-C", synth, "status", "--porcelain", "-uall"]);
    for (const line of st.out.split("\n")) {
      const m = /^\?\? (.*)$/u.exec(line);
      if (m?.[1]) {
        const p = m[1];
        const src = join(synth, p);
        const dst = join(saved, p);
        mkdirSync(dirname(dst), { recursive: true });
        try {
          const data = readFileSync(src);
          writeFileSync(dst, data);
        } catch {
          /* a file that cannot be read is still recorded as moved */
        }
        try {
          run("rm", ["-f", src]);
        } catch {
          /* ignore */
        }
      }
    }
  }
  // Reset each worktree that has a run branch checked out to its commit before the round.
  // The saved diffs stay under D/reach/ as a record of what was undone; they are not re-applied.
  for (const [name, was] of Object.entries(before.refs)) {
    const short = name.replace(/^refs\/heads\//u, "");
    const wt =
      short === L.ticket
        ? synth
        : join(
            L.repo,
            ".worktrees",
            `${L.ticket}-${short.replace(new RegExp(`^wb/${L.ticket}-`), "")}`,
          );
    if (existsSync(wt)) {
      run("git", ["-C", wt, "reset", "--hard", was]);
    }
    run("git", ["-C", L.repo, "update-ref", name, was]);
  }
  if (existsSync(synth) && before.synthHead !== "") {
    run("git", ["-C", synth, "reset", "--hard", before.synthHead]);
  }
}
