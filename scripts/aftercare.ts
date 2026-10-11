// Take a landed run to done in one command, in place of the postmaster's hand steps: save
// what is left in each of the run's working folders, close and remove them, stop the preview,
// stop a fixture copy's root launches, close the run's windows, write the closing words and
// the ticket's closing comment, mark the run done and release its pinned tool. It runs from
// the live checkout of the tool, never the run's pin, and logs every action it takes as it
// happens.
//
//   <tool>/scripts/run aftercare <dispatch>
//        [--dry-run] [--json] [--comment <text>] [--run-log <text>]
//
// Ready means the manifest's stage is shipped (or done on a rerun), the last leg has exited
// and the style findings are sorted; anything else changes nothing. A folder is saved before
// it is removed, its windows closed before that, and a folder that cannot be cleaned is left
// in place and named while the rest go on. The closing steps run in this order once every run
// folder is gone: the run-log line, the ticket's state, the comment, stage done, release.
//
//   exit 0  done, or a dry run whose plan meets no stop it can tell
//   exit 1  a fault in the call: bad arguments, a run this command does not serve, records
//           that cannot be read, a log line that cannot be written, a save that cannot be made
//   exit 2  not ready, nothing changed
//   exit 3  stopped partway: a folder left in place, the copy's launches or the run's
//           windows would not stop and close, a closing step that failed
//
// The summary is plain lines by default; with --json, stdout holds one object with `run`,
// `dry_run`, `outcome`, `steps`, `folders` and `next`. Whatever stops it, the command prints a
// line naming the step and a line saying what to do next; nothing ends silently.
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, dirname, join, resolve, sep } from "node:path";
import {
  dispatchInfo,
  isFixtureRepo,
  launchRecord,
  liveLaunchNames,
  processes,
  runWorktreePaths,
} from "./host.ts";
import { beside } from "./lib/paths.ts";
import { argvDecoded, run, signalExitCode } from "./lib/proc.ts";
import { bootId, processIsLive } from "./lib/processes.ts";
import type { RunResult } from "./lib/proc.ts";
import { pyWords } from "./lib/text.ts";
import { isCurrent } from "./stage.ts";

type Code = 0 | 1 | 2 | 3;

interface Step {
  name: string;
  status: string;
  detail: string;
}

interface Folder {
  path: string;
  saves: string[];
  result: string;
  flagged: boolean;
  why: string | null;
}

interface Stop {
  step: string;
  reason: string;
  next: string;
}

interface Args {
  dispatch: string | null;
  dryRun: boolean;
  json: boolean;
  comment: string | null;
  runLog: string | null;
  usage: string | null;
}

const USAGE =
  "usage: bun --no-env-file --config=/dev/null <tool>/scripts/aftercare.ts <dispatch> " +
  "[--dry-run] [--json] [--comment <text>] [--run-log <text>]";

class Fault extends Error {
  constructor(
    readonly code: Code,
    readonly step: string,
    readonly reason: string,
    readonly whatNext: string,
  ) {
    super(reason);
  }
}

// --- small helpers ------------------------------------------------------------------------

function tail(result: RunResult): string {
  const text = `${result.out}\n${result.err}`.trim();
  if (!text) return `exit ${result.code} with no message`;
  const lines = text.split("\n").filter((line) => line !== "");
  return lines[lines.length - 1] ?? `exit ${result.code}`;
}

function full(result: RunResult): string {
  return `${result.out}\n${result.err}`.trim();
}

interface BytesResult {
  code: number;
  out: Buffer;
  err: string;
}

/** run() without the UTF-8 decode: tar streams and git bytes pass through untouched, so a
 * save of non-UTF-8 files is byte-identical. Exit reporting matches run(): 127/126 when the
 * command never starts, 128 plus the signal's number when killed. */
function runBytes(cmd: string, args: string[], input?: string | Uint8Array): BytesResult {
  const r = spawnSync(cmd, args, {
    input,
    maxBuffer: 64 * 1024 * 1024,
  });
  const error = r.error as NodeJS.ErrnoException | undefined;
  if (error && (r.status === null || r.status === undefined) && !r.signal) {
    if (error.code === "ENOENT")
      return { code: 127, out: Buffer.alloc(0), err: `${cmd}: command not found\n` };
    if (error.code === "EACCES")
      return { code: 126, out: Buffer.alloc(0), err: `${cmd}: permission denied\n` };
    return {
      code: 1,
      out: Buffer.alloc(0),
      err: `${cmd}: ${error.message}\n`,
    };
  }
  let code: number;
  if (r.status !== null && r.status !== undefined) code = r.status;
  else if (r.signal) code = signalExitCode(r.signal);
  else code = 1;
  return {
    code,
    out: Buffer.from(r.stdout ?? Buffer.alloc(0)),
    err: String(r.stderr ?? ""),
  };
}

function tailBytes(result: BytesResult): string {
  const text = result.err.trim();
  if (!text) return `exit ${result.code} with no message`;
  const lines = text.split("\n").filter((line) => line !== "");
  return lines[lines.length - 1] ?? `exit ${result.code}`;
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** ms of quiet sleep, without going async: the pattern run-meta's scan child uses. */
function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function phys(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

const PATH_COMPONENT = /^[A-Za-z0-9._-]+$/u;

function isPathComponent(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value !== "" &&
    value !== "." &&
    value !== ".." &&
    PATH_COMPONENT.test(value)
  );
}

// --- the run's records ---------------------------------------------------------------------

function readJson(path: string, what: string): Record<string, unknown> {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    throw new Fault(
      1,
      "run records",
      `cannot read ${what} at ${path}: ${String((error as NodeJS.ErrnoException)?.message ?? error)}`,
      `repair the run's records under ${dirname(path)}, then run again`,
    );
  }
  const value = parse(raw);
  const record = asRecord(value);
  if (record === null) {
    throw new Fault(
      1,
      "run records",
      `${what} at ${path} is not a JSON object`,
      `repair ${path}, then run again`,
    );
  }
  return record;
}

function actionsOf(dispatch: string): Record<string, unknown>[] {
  let raw: string;
  try {
    raw = readFileSync(join(dispatch, "actions.jsonl"), "utf8");
  } catch {
    return [];
  }
  const actions: Record<string, unknown>[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const record = asRecord(parse(line));
    if (record !== null) actions.push(record);
  }
  return actions;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Whether this command already logged its style-sort note for the run. */
function hasStyleNote(actions: Record<string, unknown>[]): boolean {
  return actions.some(
    (a) =>
      text(a.actor) === "postmaster" &&
      text(a.action) === "note" &&
      text(a.target) === "style-sort",
  );
}

/** Whether this command already posted its closing comment for the run: its own marker in
 * the detail, so a comment the postmaster left while landing is not mistaken for it. */
function hasClosingComment(actions: Record<string, unknown>[], ticket: string): boolean {
  return actions.some(
    (a) =>
      text(a.actor) === "postmaster" &&
      text(a.action) === "ticket-comment" &&
      text(a.target) === ticket &&
      text(a.detail).startsWith("closing comment"),
  );
}

/** Folders already logged as removed, so a rerun shows them as done instead of absent. */
function priorTeardowns(actions: Record<string, unknown>[]): Set<string> {
  const paths = new Set<string>();
  for (const a of actions) {
    if (text(a.actor) === "postmaster" && text(a.action) === "teardown") {
      const target = text(a.target);
      if (target.startsWith("/")) paths.add(target);
    }
  }
  return paths;
}

// --- argument parsing ----------------------------------------------------------------------

function parseArgs(argv: string[]): Args {
  const args: Args = {
    dispatch: null,
    dryRun: false,
    json: false,
    comment: null,
    runLog: null,
    usage: null,
  };
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i]!;
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--comment" || arg === "--run-log") {
      const value = argv[i + 1];
      if (value === undefined || value === "") {
        args.usage = `${arg} needs a value`;
        return args;
      }
      if (arg === "--comment") args.comment = value;
      else args.runLog = value;
      i += 2;
      continue;
    } else if (arg.startsWith("-")) {
      args.usage = `unknown option '${arg}'`;
      return args;
    } else if (args.dispatch === null) {
      args.dispatch = arg;
      i += 1;
      continue;
    } else {
      args.usage = `unexpected argument '${arg}'`;
      return args;
    }
    i += 1;
  }
  if (args.dispatch === null) args.usage = "no dispatch directory given";
  return args;
}

// --- the run's folders ---------------------------------------------------------------------

interface FolderSet {
  repo: string;
  worktreesDir: string;
  ticket: string;
  folders: string[];
  links: Set<string>;
}

/** The run's folders: those its records name (host.ts's runWorktreePaths), plus every entry
 * of the project's .worktrees named for the ticket and a dash — the blind-test scratches a
 * person may have cut. Nothing outside .worktrees is ever a candidate. */
function folderSet(dispatch: string, alreadyRemoved: Set<string>): FolderSet {
  const dispatchR = phys(dispatch);
  const info = dispatchInfo(dispatchR);
  const synthesis = info.worktree ? phys(info.worktree) : "";
  if (!synthesis || basename(dirname(synthesis)) !== ".worktrees") {
    throw new Fault(
      1,
      "run records",
      `the waybill at ${join(dispatchR, "brief.md")} names no synthesis worktree under .worktrees`,
      "repair the waybill's ## Dispatch section, then run again",
    );
  }
  const repo = dirname(dirname(synthesis));
  const worktreesDir = phys(join(repo, ".worktrees"));
  let ticket = basename(dispatchR);
  const synthBase = basename(synthesis);
  if (!isPathComponent(ticket) || !(synthBase === ticket || synthBase.startsWith(`${ticket}-`)))
    ticket = synthBase;
  let derived: string[];
  try {
    derived = runWorktreePaths(dispatchR);
  } catch (error) {
    throw new Fault(
      1,
      "run records",
      `the run's folders cannot be read: ${String((error as Error)?.message ?? error)}`,
      "repair the run's records (the waybill and the logs), then run again",
    );
  }
  const candidates = new Set<string>();
  const links = new Set<string>();
  const add = (path: string): void => {
    if (dirname(path) === worktreesDir) candidates.add(path);
  };
  for (const path of derived) add(phys(path));
  // A scratch the records never named is only in the log once this command removed it; a
  // rerun still has to show it as done.
  for (const path of alreadyRemoved) if (dirname(path) === worktreesDir) candidates.add(path);
  let entries: string[];
  try {
    entries = readdirSync(worktreesDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") entries = [];
    else
      throw new Fault(
        1,
        `folder ${worktreesDir}`,
        `cannot list ${worktreesDir}: ${String((error as NodeJS.ErrnoException)?.message ?? error)}`,
        `make ${worktreesDir} listable, then run again`,
      );
  }
  for (const name of entries) {
    if (!(name === ticket || name.startsWith(`${ticket}-`))) continue;
    const raw = join(worktreesDir, name);
    if (isSymbolicLink(raw)) {
      candidates.add(raw);
      links.add(raw);
      continue;
    }
    add(phys(raw));
  }
  const folders = [...candidates]
    .filter((path) => isDir(path) || alreadyRemoved.has(path) || links.has(path))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return { repo, worktreesDir, ticket, folders, links };
}

function isSymbolicLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

// --- saving what is left ---------------------------------------------------------------------

function gitIn(where: string, args: string[]): RunResult {
  return run("git", ["-C", where, ...args]);
}

function gitBytes(where: string, args: string[], folder: string): Buffer {
  const result = runBytes("git", ["-C", where, ...args]);
  if (result.code !== 0) {
    throw new Fault(
      1,
      `save ${folder}`,
      `git ${args.join(" ")} failed in ${where}: ${tailBytes(result)}`,
      `inspect ${folder}, then run again`,
    );
  }
  return result.out;
}

function gitText(where: string, args: string[], folder: string): string {
  const result = gitIn(where, args);
  if (result.code !== 0) {
    throw new Fault(
      1,
      `save ${folder}`,
      `git ${args.join(" ")} failed in ${where}: ${tail(result)}`,
      `inspect ${folder}, then run again`,
    );
  }
  return result.out;
}

/** Which of the five save parts a folder has, read-only: the dry run prints these names and
 * the real run writes them. A part with nothing in it is not written. Every capture is bytes,
 * so names and content outside UTF-8 survive the save exactly. */
function savePresence(folder: string): {
  status: Buffer;
  diff: Buffer;
  staged: Buffer;
  untracked: Buffer[];
  commits: string[];
} {
  const status = gitBytes(folder, ["status", "--short"], folder);
  const diff = gitBytes(folder, ["diff", "--binary"], folder);
  const staged = gitBytes(folder, ["diff", "--cached", "--binary"], folder);
  const rawList = gitBytes(folder, ["ls-files", "--others", "--exclude-standard", "-z"], folder);
  const untracked =
    rawList.length === 0 ? [] : splitNul(rawList).filter((name) => name.length !== 0);
  const rawCommits = gitText(folder, ["rev-list", "HEAD", "--not", "--branches"], folder);
  const commits = rawCommits.split("\n").filter((line) => line !== "");
  return { status, diff, staged, untracked, commits };
}

function splitNul(raw: Buffer): Buffer[] {
  const parts: Buffer[] = [];
  let start = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === 0) {
      parts.push(Buffer.from(raw.subarray(start, i)));
      start = i + 1;
    }
  }
  if (start < raw.length) parts.push(Buffer.from(raw.subarray(start)));
  return parts;
}

function untrackedTarBytes(folder: string, names: Buffer[]): Buffer {
  const list = Buffer.concat(names.map((name) => Buffer.concat([name, Buffer.alloc(1)])));
  const result = runBytes("tar", ["-cf", "-", "-C", folder, "--null", "-T", "-"], list);
  if (result.code !== 0) {
    throw new Fault(
      1,
      `save ${folder}`,
      `tar could not archive the untracked files of ${folder}: ${tailBytes(result)}`,
      `inspect ${folder}, then run again`,
    );
  }
  return result.out;
}

function commitPatchBytes(folder: string, commits: string[]): Buffer {
  const oldest = commits[commits.length - 1]!;
  const newest = commits[0]!;
  const hasParent = gitIn(folder, ["rev-parse", "-q", "--verify", `${oldest}^`]).code === 0;
  const pieces: Buffer[] = [];
  if (hasParent) {
    const r = runBytes("git", ["-C", folder, "format-patch", "--stdout", `${oldest}^..${newest}`]);
    if (r.code !== 0 || r.out.length === 0) {
      throw new Fault(
        1,
        `save ${folder}`,
        `git format-patch failed in ${folder}: ${r.code === 0 ? "no output" : tailBytes(r)}`,
        `inspect ${folder}, then run again`,
      );
    }
    return r.out;
  }
  for (const commit of [...commits].reverse()) {
    const r = runBytes("git", ["-C", folder, "format-patch", "--stdout", "--root", commit]);
    if (r.code !== 0 || r.out.length === 0) {
      throw new Fault(
        1,
        `save ${folder}`,
        `git format-patch failed in ${folder}: ${r.code === 0 ? "no output" : tailBytes(r)}`,
        `inspect ${folder}, then run again`,
      );
    }
    pieces.push(r.out);
  }
  return Buffer.concat(pieces);
}

const PARTS = ["status", "diff", "staged.diff", "untracked.tar", "commits.patch"] as const;
type Part = (typeof PARTS)[number];

function partFile(name: string, generation: number | null, part: Part): string {
  return generation === null ? `${name}.${part}` : `${name}.${generation}.${part}`;
}

function existingSaves(stray: string, name: string, part: Part): string[] {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const pattern = new RegExp(`^${esc}(?:\\.[0-9]+)?\\.${part.replace(/\./gu, "\\.")}$`, "u");
  let entries: string[] = [];
  try {
    entries = readdirSync(stray);
  } catch {
    return [];
  }
  return entries.filter((entry) => pattern.test(entry)).sort();
}

/** Save the folder's leftovers to <dispatch>/stray/<folder>.*. A part whose bytes already
 * sit there is not written again; a changed part goes beside the first, which stays. */
function saveFolder(dispatch: string, folder: string, name: string, dryRun: boolean): string[] {
  const presence = savePresence(folder);
  const wanted: { part: Part; bytes: Buffer }[] = [];
  if (presence.status.length) wanted.push({ part: "status", bytes: presence.status });
  if (presence.diff.length) wanted.push({ part: "diff", bytes: presence.diff });
  if (presence.staged.length) wanted.push({ part: "staged.diff", bytes: presence.staged });
  if (presence.untracked.length)
    wanted.push({
      part: "untracked.tar",
      bytes: untrackedTarBytes(folder, presence.untracked),
    });
  if (presence.commits.length)
    wanted.push({
      part: "commits.patch",
      bytes: commitPatchBytes(folder, presence.commits),
    });
  if (!wanted.length) return [];
  const stray = join(dispatch, "stray");
  const writes: { file: string; bytes: Buffer }[] = [];
  const names: string[] = [];
  for (const { part, bytes: content } of wanted) {
    if (content.length === 0) continue;
    const existing = existingSaves(stray, name, part);
    let covered = false;
    for (const entry of existing) {
      let held: Buffer;
      try {
        held = readFileSync(join(stray, entry));
      } catch {
        continue;
      }
      if (held.equals(content)) {
        covered = true;
        break;
      }
    }
    if (covered) continue;
    let file = partFile(name, null, part);
    if (existing.includes(file)) {
      let generation = 2;
      while (existing.includes(partFile(name, generation, part))) generation += 1;
      file = partFile(name, generation, part);
    }
    names.push(`stray/${file}`);
    writes.push({ file, bytes: content });
  }
  if (dryRun || !writes.length) return names;
  try {
    mkdirSync(stray, { recursive: true });
  } catch (error) {
    throw new Fault(
      1,
      `save ${folder}`,
      `cannot make ${stray}: ${String((error as NodeJS.ErrnoException)?.message ?? error)}`,
      `make ${stray} writable, then run again`,
    );
  }
  for (const { file, bytes } of writes) {
    try {
      writeFileSync(join(stray, file), bytes);
    } catch (error) {
      throw new Fault(
        1,
        `save ${folder}`,
        `cannot write ${join(stray, file)}: ${String((error as NodeJS.ErrnoException)?.message ?? error)}`,
        `fix ${stray}, then run again`,
      );
    }
  }
  return names;
}

// --- flagging work that never landed ------------------------------------------------------------

/** Paths whose content, in the index, the work tree or a commit no branch holds, is in no
 * commit a local branch of the PROJECT holds — at any path. A deletion or a mode change alone
 * never flags; an unmerged path always does; untracked files never do. */
function flaggedFiles(repo: string, folder: string): string[] {
  const flagged = new Set<string>();
  const status = gitIn(folder, ["status", "--porcelain", "--no-renames", "-z"]);
  if (status.code !== 0)
    throw new Fault(
      1,
      `flag ${folder}`,
      `git status failed in ${folder}: ${tail(status)}`,
      `inspect ${folder}, then run again`,
    );
  const entries = status.out.split("\0").filter((entry) => entry !== "");
  const unmerged = new Set<string>();
  for (const entry of entries) {
    const code = entry.slice(0, 2);
    const path = entry.slice(3);
    if (code === "??") continue;
    if (code.includes("U") || code === "AA" || code === "DD") unmerged.add(path);
  }
  for (const path of [...unmerged].sort()) flagged.add(path);

  const candidates = new Map<string, Set<string>>();
  const candidate = (blob: string, path: string): void => {
    if (/^0+$/u.test(blob)) return;
    let set = candidates.get(blob);
    if (!set) {
      set = new Set();
      candidates.set(blob, set);
    }
    set.add(path);
  };
  const rawDiff = (args: string[]): string => {
    const r = gitIn(folder, args);
    if (r.code !== 0)
      throw new Fault(
        1,
        `flag ${folder}`,
        `git ${args.join(" ")} failed in ${folder}: ${tail(r)}`,
        `inspect ${folder}, then run again`,
      );
    return r.out;
  };
  // -z throughout: NUL-separated header/path pairs, paths never quoted, so a non-ASCII
  // name arrives spellable and hashable. (--no-renames keeps one path per entry.)
  const readRawEntries = (output: string): { meta: string[]; path: string }[] => {
    const chunks = output.split("\0");
    const entries: { meta: string[]; path: string }[] = [];
    for (let i = 0; i + 1 < chunks.length; i += 2) {
      const header = chunks[i] ?? "";
      const path = chunks[i + 1] ?? "";
      if (!header.startsWith(":") || path === "") continue;
      entries.push({ meta: header.split(" "), path });
    }
    return entries;
  };
  const readRawWorktree = (output: string): void => {
    for (const { meta, path } of readRawEntries(output)) {
      if (meta.length < 5) continue;
      const oldBlob = meta[2] ?? "";
      if (unmerged.has(path)) continue;
      const hashed = gitIn(folder, ["hash-object", "--", path]);
      if (hashed.code !== 0) continue; // deleted in the work tree: never flags
      const content = hashed.out.trim();
      if (!content || content === oldBlob) continue;
      candidate(content, path);
    }
  };
  const readRaw = (output: string): void => {
    for (const { meta, path } of readRawEntries(output)) {
      if (meta.length < 5) continue;
      const oldBlob = meta[2] ?? "";
      const newBlob = meta[3] ?? "";
      if (oldBlob === newBlob) continue; // a mode change alone never flags
      if (unmerged.has(path)) continue;
      candidate(newBlob, path);
    }
  };
  readRaw(rawDiff(["diff", "--cached", "--raw", "--no-renames", "-z", "HEAD"]));
  // The worktree side of `git diff --raw` is all zeros: git does not hash the file on disk
  // into the output, so each modified path is hashed here, and a deletion or a mode change
  // alone never flags.
  readRawWorktree(rawDiff(["diff", "--raw", "--no-renames", "-z"]));
  const commits = gitText(folder, ["rev-list", "HEAD", "--not", "--branches"], folder)
    .split("\n")
    .filter((line) => line !== "");
  for (const commit of commits) {
    const r = gitIn(folder, [
      "diff-tree",
      "-r",
      "--root",
      "--no-commit-id",
      "--no-renames",
      "-z",
      commit,
    ]);
    if (r.code !== 0)
      throw new Fault(
        1,
        `flag ${folder}`,
        `git diff-tree failed in ${folder}: ${tail(r)}`,
        `inspect ${folder}, then run again`,
      );
    readRaw(r.out);
  }
  for (const [blob, paths] of candidates) {
    const seen = gitIn(repo, ["log", "--branches", `--find-object=${blob}`, "--format=%H"]);
    if (seen.code !== 0)
      throw new Fault(
        1,
        `flag ${folder}`,
        `git log --find-object failed in ${repo}: ${tail(seen)}`,
        `inspect the project's branches, then run again`,
      );
    if (seen.out.trim() === "")
      for (const path of [...paths].sort()) {
        if (!unmerged.has(path)) flagged.add(path);
      }
  }
  return [...flagged].sort();
}

// --- acting on a folder ------------------------------------------------------------------------

interface Kind {
  mode: "scratch" | "worktree" | "none";
  detail: string;
}

/** A detached worktree or a shared clone of the repository (cut-scratch --kind), a worktree
 * of it on a branch, or neither — which is left in place and named. */
function classify(repo: string, path: string): Kind {
  const kind = run(beside(import.meta, "run"), ["cut-scratch", "--kind", path]);
  if (kind.code === 0) {
    const out = kind.out.trim();
    const at = out.indexOf(" ");
    const what = at === -1 ? out : out.slice(0, at);
    const kindRepo = at === -1 ? "" : out.slice(at + 1);
    if (kindRepo !== repo)
      return { mode: "none", detail: `a ${what} of ${kindRepo}, not of ${repo}` };
    return { mode: "scratch", detail: out };
  }
  if (kind.code !== 1)
    throw new Fault(
      1,
      `folder ${path}`,
      `cut-scratch --kind could not read ${path}: ${tail(kind)}`,
      `inspect ${path}, then run again`,
    );
  const common = gitIn(path, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (common.code !== 0)
    return { mode: "none", detail: `not a git folder: neither a worktree nor a clone of ${repo}` };
  const commonPath = common.out.trim();
  const main = commonPath.endsWith("/.git") ? dirname(commonPath) : commonPath;
  if (phys(main) !== phys(repo))
    return { mode: "none", detail: `a checkout of ${main}, not of ${repo}` };
  return { mode: "worktree", detail: "a worktree on a branch" };
}

/** Submodules with local changes the save cannot capture: the superproject's status and
 * file list do not descend into them, so their contents would go with the folder. Failing
 * to look leaves the folder too: an unreadable submodule state is not a clean one. */
function dirtySubmodules(folder: string): { ok: boolean; dirty: string[]; why: string } {
  const seen = gitIn(folder, [
    "submodule",
    "foreach",
    "--recursive",
    "git",
    "status",
    "--porcelain",
  ]);
  if (seen.code !== 0)
    return { ok: false, dirty: [], why: `its submodules cannot be read: ${tail(seen)}` };
  const dirty: string[] = [];
  let current = "";
  let currentDirty = false;
  let stray = false;
  const flush = (): void => {
    if (current !== "" && currentDirty) dirty.push(current);
    current = "";
    currentDirty = false;
  };
  for (const line of seen.out.split("\n")) {
    const entering = /^Entering '(.+)'$/u.exec(line);
    if (entering) {
      flush();
      current = entering[1] ?? "";
    } else if (line !== "") {
      if (current === "") stray = true;
      else currentDirty = true;
    }
  }
  flush();
  if (dirty.length === 0 && stray) dirty.push("a submodule");
  return { ok: true, dirty, why: "" };
}

/** Unbranched merge commits: format-patch omits merges even in range, so their resolutions
 * would go with the folder unsaved. */
function unbranchedMerges(folder: string): { ok: boolean; merges: string[]; why: string } {
  const found = gitIn(folder, ["rev-list", "--merges", "HEAD", "--not", "--branches"]);
  if (found.code !== 0)
    return { ok: false, merges: [], why: `its unbranched merges cannot be listed: ${tail(found)}` };
  return {
    ok: true,
    merges: found.out.split("\n").filter((line) => line !== ""),
    why: "",
  };
}

/** Whether run-meta release would take the pin: a locked pin, or a pin that is not a git
 * checkout, stops the real run, so the dry run predicts the stop. Mirrors run-meta's own
 * locked check (its common dir plus `worktrees/<name>/locked`). */
function pinReleasable(pin: string): string {
  const common = gitIn(pin, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (common.code !== 0) return `${pin} is not a git checkout`;
  const locked = join(common.out.trim(), "worktrees", basename(pin), "locked");
  let reason: string;
  try {
    reason = readFileSync(locked, "utf8").trim();
  } catch {
    return "";
  }
  return reason === "" ? `${pin} is locked` : `${pin} is locked: ${reason}`;
}

/** A worktree git would refuse to remove: `remove --force` still bows to a lock. The dry
 * run predicts the refusal; the real run meets it at removal. */
function worktreeLocked(folder: string): string | null {
  const gitDir = gitIn(folder, ["rev-parse", "--path-format=absolute", "--git-dir"]);
  if (gitDir.code !== 0) return null;
  let reason: string;
  try {
    reason = readFileSync(join(gitDir.out.trim(), "locked"), "utf8").trim();
  } catch {
    return null;
  }
  return reason === "" ? "locked" : `locked: ${reason}`;
}

/** Close the folder's windows before it is removed; the dry run reads the launch registry
 * instead, so it closes nothing. In a dry run that would stop the preview, its group is
 * already spoken for and does not hold the folder. */
function closeFolder(
  path: string,
  dryRun: boolean,
  exceptGroup?: number,
): { ok: boolean; why: string } {
  if (dryRun) {
    const live = liveLaunchNames(path, exceptGroup);
    if (live.length)
      return { ok: false, why: `a launch is still running in ${path}: ${live.join(";")}` };
    return { ok: true, why: "" };
  }
  const closed = run(beside(import.meta, "run"), ["host", "close", path]);
  if (closed.code !== 0) return { ok: false, why: tail(closed) };
  return { ok: true, why: "" };
}

/** Remove the saved folder: a scratch through cut-scratch, a branch worktree with git, from
 * outside it. A refusal leaves the folder in place; the caller names it. */
function removeFolder(
  repo: string,
  path: string,
  mode: "scratch" | "worktree",
): {
  ok: boolean;
  why: string;
} {
  const removed =
    mode === "scratch"
      ? run(beside(import.meta, "run"), ["cut-scratch", "--remove", repo, path])
      : gitIn(repo, ["worktree", "remove", "--force", path]);
  if (removed.code !== 0) return { ok: false, why: tail(removed) };
  return { ok: true, why: "" };
}

/** One line in the run's log and the project's ledger, right after the action it records. */
function logAction(
  dispatch: string,
  action: string,
  target: string,
  detail: string,
  step: string,
): void {
  const logged = run(beside(import.meta, "run"), [
    "log-action",
    dispatch,
    "postmaster",
    action,
    target,
    detail,
  ]);
  if (logged.code !== 0)
    throw new Fault(
      1,
      step,
      `log-action could not write its ${action} line: ${tail(logged)}`,
      `fix ${join(dispatch, "actions.jsonl")} and the project ledger, then run again`,
    );
}

// --- the preview server ---------------------------------------------------------------------

interface Preview {
  status: "none" | "would" | "stopped" | "already" | "left" | "noted";
  detail: string;
  path: string | null;
  next: string;
  /** The preview's process group, where a stop is planned or done. */
  group?: number;
}

function groupAlive(pid: number, members: Array<[number, string]>): boolean {
  const procs = processes();
  for (const [, info] of procs) if (info.group === pid) return true;
  for (const [member, start] of members) if (procs.get(member)?.start === start) return true;
  return false;
}

/** Stop the preview's whole process group, and only while the launch registry still records
 * that pid with its start time for this run's synthesis folder, so a pid since reused by
 * another launch is never signalled. */
function stopPreview(dispatch: string, dryRun: boolean, synthesis: string): Preview {
  const pidfile = join(dispatch, "render", "preview.pid");
  if (!existsSync(pidfile)) return { status: "none", detail: "", path: null, next: "" };
  const raw = (() => {
    try {
      // The pid is the first line; later lines carry the start, boot and command
      // identity, which the registry verification below checks in its own way.
      return (readFileSync(pidfile, "utf8").trim().split("\n")[0] ?? "").trim();
    } catch {
      return "";
    }
  })();
  if (!/^[0-9]+$/u.test(raw))
    return {
      status: "already",
      detail: "the pid file names no process; already stopped",
      path: null,
      next: "",
    };
  const pid = Number(raw);
  const procs = processes();
  const boot = bootId();
  const rec = launchRecord(pid);
  if (rec === null) {
    if (procs.has(pid))
      // A live process no record names is not this run's preview: never signal it, note
      // it, and carry on. Stopping here would wedge every rerun on a stale pid file.
      return {
        status: "noted",
        detail: `the pid file names live pid ${pid}, which no launch record names; left alone, nothing to stop`,
        path: null,
        next: "",
      };
    return {
      status: "already",
      detail: "no launch record and no process; already stopped",
      path: null,
      next: "",
    };
  }
  const bootOk = rec.boot === "" || rec.boot === boot;
  const recorded =
    bootOk &&
    ((rec.start !== "" && procs.get(pid)?.start === rec.start) ||
      rec.members.some(([member, start]) => procs.get(member)?.start === start));
  if (!recorded) {
    if (procs.has(pid) || groupAlive(pid, rec.members))
      // A record that matches nothing running is verified as nobody's preview, same as
      // no record: never signal the reused pid, note it, and carry on.
      return {
        status: "noted",
        detail: `the registry record for pid ${pid} matches nothing running; not signalling a reused pid, nothing to stop`,
        path: null,
        next: "",
      };
    return {
      status: "already",
      detail: "the preview's process is gone; already stopped",
      path: null,
      next: "",
    };
  }
  const path = phys(rec.dir);
  if (path !== synthesis) {
    // The pid was reused by a launch outside this run's synthesis folder, which overwrote
    // the record: the start check passes for a process that is not this run's preview.
    // Never signal it, note it, and carry on; the folder it runs in stays named below.
    return {
      status: "noted",
      detail: `the registry record for pid ${pid} names ${rec.dir}, not this run's synthesis folder; left alone, nothing to stop`,
      path: null,
      next: "",
    };
  }
  if (dryRun)
    return {
      status: "would",
      detail: `would stop the preview process group ${pid}`,
      path,
      next: "",
      group: pid,
    };
  const signal = (name: string): void => {
    try {
      process.kill(-pid, name);
    } catch {
      /* the group may already be gone */
    }
    const live = processes();
    for (const [member, start] of rec.members) {
      if (member === pid) continue;
      if (live.get(member)?.start !== start) continue;
      try {
        process.kill(member, name);
      } catch {
        /* it may already be gone */
      }
    }
  };
  signal("SIGTERM");
  let wait = Date.now() + 3000;
  while (Date.now() < wait && groupAlive(pid, rec.members)) pause(100);
  if (groupAlive(pid, rec.members)) {
    signal("SIGKILL");
    wait = Date.now() + 1500;
    while (Date.now() < wait && groupAlive(pid, rec.members)) pause(100);
  }
  if (groupAlive(pid, rec.members))
    return {
      status: "left",
      detail: `the preview process group ${pid} outlives its stop`,
      path,
      next: `stop the preview's process group ${pid}, then run again`,
    };
  return { status: "stopped", detail: `stopped the preview process group ${pid}`, path, next: "" };
}

// --- records a rerun reads ---------------------------------------------------------------------

/** Whether this run's closing line is already in run-log.md: this command's own note, or
 * a line carrying exactly the text (run-log writes `- HH:MM:SSZ <text>`). A substring
 * anywhere in the file is not enough: the rerun must write the line it was given. */
function runLogDone(
  dispatch: string,
  actions: Record<string, unknown>[],
  line: string | null,
): boolean {
  if (
    actions.some(
      (a) =>
        text(a.actor) === "postmaster" && text(a.action) === "note" && text(a.target) === "run-log",
    )
  )
    return true;
  if (line === null || line === "") return false;
  let raw: string;
  try {
    raw = readFileSync(join(dispatch, "run-log.md"), "utf8");
  } catch {
    return false;
  }
  // ASCII: run-log timestamps are tool-emitted HH:MM:SS digits.
  return raw
    .split("\n")
    .some((entry) => /^- [0-9]{2}:[0-9]{2}:[0-9]{2}Z (.*)$/u.exec(entry)?.[1] === line);
}

/** How this command invokes a tracker adapter through the run dispatcher: plane takes
 * no repo argument, its command is argv[0] (ticket-check.ts invokes it the same way). */
export function trackerArgv(adapter: string, repo: string, cmd: string, ticket: string): string[] {
  const rung = beside(import.meta, "run");
  if (adapter === "plane") return [rung, "plane", cmd, ticket];
  return [rung, adapter, repo, cmd, ticket];
}

function ticketState(
  adapter: string,
  repo: string,
  ticket: string,
): { state: string; read: string } {
  const argv = trackerArgv(adapter, repo, "read", ticket);
  const read = run(argv[0]!, argv.slice(1));
  if (read.code !== 0) {
    throw new Fault(
      3,
      "ticket-state",
      tail(read),
      `fix the ticket in the tracker (the message above), then run again`,
    );
  }
  for (const line of read.out.split("\n")) {
    if (line.startsWith("state: "))
      return { state: line.slice("state: ".length).trim(), read: read.out };
  }
  throw new Fault(
    3,
    "ticket-state",
    `${adapter} read of ticket ${ticket} printed no state line`,
    `read the ticket yourself, then run again`,
  );
}

/** Whether the ticket's log already carries this command's closing comment: every adapter
 * prints its log as `- <stamp> <actor>: <text>` lines under `## Log`, with whitespace runs
 * collapsed. A post the tracker took but whose log line never landed is reconciled, not
 * reposted. */
function ticketHasComment(read: string, comment: string | null): boolean {
  const collapsed = pyWords(comment ?? "").join(" ");
  if (collapsed === "") return false;
  const want = `postmaster: ${collapsed}`;
  let inLog = false;
  for (const line of read.split("\n")) {
    if (line === "## Log") inLog = true;
    else if (inLog && line.startsWith("- ") && line.endsWith(want)) return true;
  }
  return false;
}

// --- the flow ------------------------------------------------------------------------------------

interface Result {
  code: Code;
  run: string;
  dryRun: boolean;
  outcome: string;
  steps: Step[];
  folders: Folder[];
  stops: Stop[];
  next: string | null;
}

function outcomeOf(code: Code): string {
  return code === 0 ? "done" : code === 1 ? "fault" : code === 2 ? "not-ready" : "stopped";
}

const CLOSING = ["run-log", "ticket-state", "ticket-comment", "stage", "release"];

function mainFlow(args: Args): Result {
  const dispatch = phys(args.dispatch!);
  const dryRun = args.dryRun;
  const steps: Step[] = [];
  const folders: Folder[] = [];
  const stops: Stop[] = [];
  let actions = actionsOf(dispatch);
  let locked = false;

  const pendingClosing = (from: number): void => {
    for (let i = from; i < CLOSING.length; i++)
      steps.push({ name: CLOSING[i]!, status: "waiting", detail: "waiting for the stop above" });
  };
  const pendingWindows = (): void => {
    steps.push({ name: "close-run", status: "waiting", detail: "waiting for the stop above" });
  };

  function finish(
    endCode: Code,
    doneSteps: Step[],
    doneFolders: Folder[],
    doneStops: Stop[],
  ): Result {
    const next = doneStops.length === 0 ? null : doneStops.map((stop) => stop.next).join("; ");
    return {
      code: endCode,
      run: dispatch,
      dryRun,
      outcome: outcomeOf(endCode),
      steps: doneSteps,
      folders: doneFolders,
      stops: doneStops,
      next,
    };
  }

  let alreadyRemoved = priorTeardowns(actions);
  let postLock = false;
  try {
    if (!isDir(dispatch))
      throw new Fault(1, "run records", `no such dispatch directory: ${dispatch}`, USAGE);
    const runJson = join(dispatch, "run.json");
    const manifestPath = join(dispatch, "manifest.json");
    if (!existsSync(runJson) || !isCurrent(dispatch))
      throw new Fault(
        1,
        "run records",
        `run.json does not record coachman contract 2: ${runJson}`,
        "this run predates the two-leg contract: close it with Legacy Stage G (postmaster.md)",
      );
    const runRecord = readJson(runJson, "run.json");
    const manifest = readJson(manifestPath, "manifest.json");
    const stage = text(manifest.stage);
    if (stage === "abandoned")
      throw new Fault(
        1,
        "run records",
        "the run's stage is abandoned",
        "an abandoned run is closed by the abandoning steps (postmaster.md, Abandoning), not this command",
      );

    // Ready: shipped (or done on a rerun), the last leg exited, the style findings sorted.
    if (stage !== "shipped" && stage !== "done")
      throw new Fault(
        2,
        "ready",
        `the run's stage is ${stage || "unset"}, not shipped`,
        "mark the run shipped once the landing check has confirmed the merge (Stage F), then run again",
      );
    const leg = manifest.leg;
    if (!Number.isInteger(leg) || (leg as number) < 1)
      throw new Fault(
        1,
        "run records",
        `the manifest's leg is not a number: ${String(leg)}`,
        `repair ${manifestPath}, then run again`,
      );
    const exited = join(dispatch, `.leg-${String(leg)}-exited`);
    if (!existsSync(exited))
      throw new Fault(
        2,
        "ready",
        `the last leg has not exited: ${exited} is missing`,
        `wait for leg ${String(leg)} to exit; if its process is gone, remount it (Stage D), then run again`,
      );
    const style = run(beside(import.meta, "run"), ["style-findings", "check", dispatch]);
    if (style.code === 2)
      throw new Fault(
        2,
        "ready",
        full(style)
          .split("\n")
          .filter((line) => line !== "")
          .join("; "),
        `write ${join(dispatch, "style-sort.md")} as coachman.md's sorting rules say, then run again`,
      );
    if (style.code !== 0)
      throw new Fault(
        1,
        "ready",
        `style-findings check could not read the run: ${tail(style)}`,
        "repair the run's records (the message above), then run again",
      );
    const styleLast =
      full(style)
        .split("\n")
        .filter((line) => line !== "")
        .pop() ?? "no style findings";
    steps.push({
      name: "ready",
      status: "done",
      detail: `stage ${stage}; leg ${String(leg)} exited; ${styleLast}`,
    });

    // One aftercare at a time on a run.
    const lock = join(dispatch, ".aftercare.lock");
    const holder = (): number => {
      try {
        const value = Number(readFileSync(lock, "utf8").trim());
        return Number.isInteger(value) && value > 0 ? value : 0;
      } catch {
        return 0;
      }
    };
    if (dryRun) {
      const held = holder();
      if (existsSync(lock) && held > 0 && held !== process.pid && processIsLive(held))
        throw new Fault(
          1,
          "aftercare lock",
          `aftercare is already running on this run (pid ${String(held)})`,
          "wait for that run to finish, then run again",
        );
    } else {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const fd = openSync(lock, "wx");
          writeFileSync(fd, `${process.pid}\n`);
          closeSync(fd);
          locked = true;
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException)?.code !== "EEXIST")
            throw new Fault(
              1,
              "aftercare lock",
              `cannot take ${lock}: ${String((error as NodeJS.ErrnoException)?.message ?? error)}`,
              `make ${dispatch} writable, then run again`,
            );
          const pid = holder();
          if (pid !== 0 && pid !== process.pid && processIsLive(pid))
            throw new Fault(
              1,
              "aftercare lock",
              `aftercare is already running on this run (pid ${String(pid)})`,
              "wait for that run to finish, then run again",
            );
          if (attempt === 1)
            throw new Fault(
              1,
              "aftercare lock",
              `cannot take ${lock}: it cannot be replaced`,
              `remove ${lock} if no aftercare runs, then run again`,
            );
          rmSync(lock, { force: true });
        }
      }
      if (!locked)
        throw new Fault(
          1,
          "aftercare lock",
          `cannot take ${lock}`,
          `make ${dispatch} writable, then run again`,
        );
    }
    postLock = true;
    // The log may have moved between the first read and the lock: a run that finished in
    // between posted its markers, and this run must see them before judging any step done.
    actions = actionsOf(dispatch);
    alreadyRemoved = priorTeardowns(actions);

    // Closing words: required while any closing step remains, judged from the fresh markers.
    const commentPosted = hasClosingComment(actions, basename(dispatch));
    const wordsNeeded = stage !== "done" || !commentPosted;
    if (wordsNeeded && (args.comment === null || args.runLog === null))
      throw new Fault(
        1,
        "closing words",
        "--comment and --run-log are required while closing steps remain",
        `run again with --comment "<text>" --run-log "<text>"`,
      );

    // The style-sort note: one line, once per run.
    if (hasStyleNote(actions)) {
      steps.push({ name: "style-sort", status: "already", detail: "note already logged" });
    } else if (dryRun) {
      steps.push({ name: "style-sort", status: "would", detail: `would log a note: ${styleLast}` });
    } else {
      logAction(dispatch, "note", "style-sort", styleLast, "style-sort");
      steps.push({ name: "style-sort", status: "done", detail: `note logged: ${styleLast}` });
    }

    // Every folder the run made: from the records, plus the ticket-prefixed scratches.
    const set = folderSet(dispatch, alreadyRemoved);
    const synthesis = phys(dispatchInfo(dispatch).worktree);

    // The preview server: stopped first, so closing the folders never waits on it. A preview
    // that outlives its stop leaves the synthesis folder in place.
    const preview = stopPreview(dispatch, dryRun, synthesis);
    const leftEarly = new Map<string, string>();
    if (preview.status !== "none") {
      steps.push({ name: "preview", status: preview.status, detail: preview.detail });
      if (preview.status === "left") {
        if (set.folders.includes(synthesis)) leftEarly.set(synthesis, preview.detail);
        else stops.push({ step: "preview", reason: preview.detail, next: preview.next });
      }
    }

    for (const path of set.folders) {
      const name = basename(path);
      const entry: Folder = { path, saves: [], result: "", flagged: false, why: null };
      folders.push(entry);
      if (set.links.has(path)) {
        entry.result = "left";
        entry.why = "a symbolic link, not a worktree or clone; left in place";
        if (!dryRun)
          logAction(dispatch, "note", path, `left in place: ${entry.why}`, `folder ${path}`);
        continue;
      }
      if (!isDir(path)) {
        entry.result = alreadyRemoved.has(path) ? "already removed" : "already gone";
        continue;
      }
      const cwd = phys(process.cwd());
      if (cwd === path || cwd.startsWith(`${path}${sep}`)) {
        entry.result = "left";
        entry.why = "this command runs inside it; left in place";
        if (!dryRun)
          logAction(dispatch, "note", path, `left in place: ${entry.why}`, `folder ${path}`);
        continue;
      }
      const early = leftEarly.get(path);
      if (early !== undefined) {
        entry.result = "left";
        entry.why = early;
        continue;
      }
      const kind = classify(set.repo, path);
      if (kind.mode === "none") {
        entry.result = "left";
        entry.why = `${kind.detail}; left in place`;
        if (!dryRun)
          logAction(dispatch, "note", path, `left in place: ${entry.why}`, `folder ${path}`);
        continue;
      }
      const merges = unbranchedMerges(path);
      if (!merges.ok || merges.merges.length) {
        const shown = merges.merges.slice(0, 3).join(" ");
        const rest = merges.merges.length > 3 ? ` and ${merges.merges.length - 3} more` : "";
        entry.result = "left";
        entry.why = merges.ok
          ? `unbranched merge ${shown}${rest}, whose resolutions no patch can carry; left in place`
          : `${merges.why}; left in place`;
        if (!dryRun)
          logAction(dispatch, "note", path, `left in place: ${entry.why}`, `folder ${path}`);
        continue;
      }
      const submodules = dirtySubmodules(path);
      if (!submodules.ok || submodules.dirty.length) {
        entry.result = "left";
        entry.why = submodules.ok
          ? `submodule ${submodules.dirty.join(" ")} has local changes the save cannot capture; left in place`
          : `${submodules.why}; left in place`;
        if (!dryRun)
          logAction(dispatch, "note", path, `left in place: ${entry.why}`, `folder ${path}`);
        continue;
      }
      const except = preview.status === "would" ? preview.group : undefined;
      const closed = closeFolder(path, dryRun, except);
      if (!closed.ok) {
        entry.result = "left";
        entry.why = `${closed.why}; left in place`;
        if (!dryRun)
          logAction(dispatch, "note", path, `left in place: ${entry.why}`, `folder ${path}`);
        continue;
      }
      const saves = saveFolder(dispatch, path, name, dryRun);
      entry.saves = saves;
      if (saves.length && !dryRun)
        logAction(dispatch, "note", path, `saved ${saves.join(" ")}`, `folder ${path}`);
      const flagged = flaggedFiles(set.repo, path);
      entry.flagged = flagged.length > 0;
      if (dryRun) {
        const locked = worktreeLocked(path);
        if (locked !== null) {
          entry.result = "left";
          entry.why = `${locked}; the real run would leave it in place`;
          continue;
        }
        entry.result = "would remove";
        if (entry.flagged) entry.why = `flagged: ${flagged.join(" ")}`;
        continue;
      }
      const removed = removeFolder(set.repo, path, kind.mode);
      if (!removed.ok) {
        entry.result = "left";
        entry.why = `${removed.why}; left in place`;
        logAction(dispatch, "note", path, `left in place: ${entry.why}`, `folder ${path}`);
        continue;
      }
      entry.result = "removed";
      if (entry.flagged) {
        entry.why = `flagged: ${flagged.join(" ")}`;
        logAction(
          dispatch,
          "teardown",
          path,
          `removed; flagged: ${flagged.join(" ")}`,
          `folder ${path}`,
        );
      } else {
        logAction(dispatch, "teardown", path, "removed", `folder ${path}`);
      }
    }

    const left = folders.filter((f) => f.result === "left");
    if (left.length) {
      pendingWindows();
      pendingClosing(0);
      stops.push(
        ...left.map((f) => ({
          step: `folder ${f.path}`,
          reason: f.why ?? "left in place",
          next: `clear what holds ${f.path} (the reason above), then run again`,
        })),
      );
      return finish(3, steps, folders, stops);
    }
    if (stops.length) {
      // Only the preview can have stopped without leaving a folder: the synthesis folder
      // was already gone while its preview outlived the stop. The run stays open.
      pendingWindows();
      pendingClosing(0);
      return finish(3, steps, folders, stops);
    }

    // A fixture copy exists for its one run: stop the copy's root launches, such
    // as its watcher, before the close below takes their tabs. The stop runs
    // from beside the copy, since run host stop refuses from inside it.
    if (isFixtureRepo(set.repo)) {
      if (dryRun) {
        steps.push({
          name: "stop-run",
          status: "would",
          detail: "would stop the copy's launches at its root",
        });
      } else {
        const stopped = run(beside(import.meta, "run"), ["host", "stop-run", dispatch], {
          cwd: dirname(set.repo),
        });
        if (stopped.code !== 0) {
          steps.push({ name: "stop-run", status: "failed", detail: tail(stopped) });
          pendingWindows();
          pendingClosing(0);
          stops.push({
            step: "stop-run",
            reason: `the copy's launches would not stop: ${tail(stopped)}`,
            next: `stop the run's launches (run host stop-run ${dispatch} reports why), then run again`,
          });
          return finish(3, steps, folders, stops);
        }
        steps.push({
          name: "stop-run",
          status: "done",
          detail: "the copy's launches at its root stopped",
        });
      }
    }

    // The run's spaces and windows, once every folder is gone.
    if (dryRun) {
      steps.push({ name: "close-run", status: "would", detail: "would close the run's spaces" });
    } else {
      const windows = run(beside(import.meta, "run"), ["host", "close-run", dispatch]);
      if (windows.code !== 0) {
        steps.push({ name: "close-run", status: "failed", detail: tail(windows) });
        pendingClosing(0);
        stops.push({
          step: "close-run",
          reason: `the run's windows would not close: ${tail(windows)}`,
          next: `clear the run's windows (run host close-run ${dispatch} reports why), then run again`,
        });
        return finish(3, steps, folders, stops);
      }
      steps.push({
        name: "close-run",
        status: "done",
        detail: "the run's spaces and windows closed",
      });
    }

    // Closing steps, in order: the run-log line, the ticket's state, the comment, done, release.
    let closingIndex = 0;
    const runClosing = <T>(body: () => T): T => {
      try {
        return body();
      } catch (error) {
        if (error instanceof Fault) {
          if (!steps.some((step) => step.name === error.step))
            steps.push({ name: error.step, status: "failed", detail: error.reason });
          pendingClosing(closingIndex + 1);
        }
        throw error;
      }
    };

    // 1. the run-log line
    closingIndex = 0;
    const runLogText = args.runLog;
    if (runLogDone(dispatch, actions, runLogText)) {
      steps.push({ name: "run-log", status: "already", detail: "the closing line is written" });
    } else if (runLogText === null) {
      throw new Fault(
        1,
        "closing words",
        "the closing line is not in run-log.md and --run-log was not given",
        `run again with --run-log "<text>"`,
      );
    } else if (dryRun) {
      steps.push({ name: "run-log", status: "would", detail: `would write: ${runLogText}` });
    } else {
      runClosing(() => {
        const written = run(beside(import.meta, "run"), ["run-log", dispatch, runLogText]);
        if (written.code !== 0)
          throw new Fault(
            1,
            "run-log",
            `run run-log could not write: ${tail(written)}`,
            `make ${join(dispatch, "run-log.md")} writable, then run again`,
          );
        logAction(dispatch, "note", "run-log", `closing line written: ${runLogText}`, "run-log");
      });
      steps.push({ name: "run-log", status: "done", detail: `written: ${runLogText}` });
    }

    // 2 and 3. the ticket's state and its closing comment
    const kindResult = run(beside(import.meta, "run"), ["tracker-kind", set.repo]);
    const kind = kindResult.code === 0 ? kindResult.out.trim() : "";
    const adapter =
      kind === "local" ? "local" : kind === "github" ? "github" : kind === "plane" ? "plane" : null;
    const ticket = basename(dispatch);
    if (adapter === null) {
      const why =
        kindResult.code === 0
          ? `tracker '${kind}' has no adapter: the postmaster sets the ticket's state and comment itself`
          : `the tracker kind cannot be told: ${tail(kindResult)}`;
      if (kindResult.code !== 0) {
        // The dry run exits as the real run would where it can tell: a stop here stops there too.
        if (dryRun) {
          steps.push({ name: "ticket-state", status: "failed", detail: why });
          pendingClosing(2);
          stops.push({
            step: "ticket-state",
            reason: why,
            next: `check the tracker, then run again`,
          });
          return finish(3, steps, folders, stops);
        }
        throw new Fault(3, "ticket-state", why, `check the tracker, then run again`);
      }
      steps.push({ name: "ticket-state", status: "skipped", detail: why });
      steps.push({ name: "ticket-comment", status: "skipped", detail: why });
    } else {
      // state
      closingIndex = 1;
      const read = runClosing(() => ticketState(adapter, set.repo, ticket));
      const state = read.state;
      const ticketRead = read.read;
      if (state === "done") {
        steps.push({ name: "ticket-state", status: "already", detail: `ticket ${ticket} is done` });
      } else if (state === "cancelled") {
        steps.push({
          name: "ticket-state",
          status: "skipped",
          detail: `ticket ${ticket} left cancelled, as its own state stands`,
        });
      } else if (!["todo", "in-progress", "blocked"].includes(state)) {
        throw new Fault(
          3,
          "ticket-state",
          `ticket ${ticket} is in state '${state}', which this command does not move`,
          `set the ticket to done yourself if it should close, then run again`,
        );
      } else if (dryRun) {
        steps.push({
          name: "ticket-state",
          status: "would",
          detail: `would set ticket ${ticket} to done`,
        });
      } else {
        runClosing(() => {
          const argv = [...trackerArgv(adapter, set.repo, "state", ticket), "done"];
          const set_ = run(argv[0]!, argv.slice(1));
          if (set_.code !== 0)
            throw new Fault(
              3,
              "ticket-state",
              tail(set_),
              "fix the tracker (the message above), then run again",
            );
          logAction(dispatch, "ticket-state", ticket, `done from ${state}`, "ticket-state");
        });
        steps.push({
          name: "ticket-state",
          status: "done",
          detail: `ticket ${ticket}: ${state} -> done`,
        });
      }
      // comment
      closingIndex = 2;
      const reconciled = ticketHasComment(ticketRead, args.comment);
      if (hasClosingComment(actions, ticket)) {
        steps.push({
          name: "ticket-comment",
          status: "already",
          detail: "the closing comment is posted",
        });
      } else if (reconciled && dryRun) {
        steps.push({
          name: "ticket-comment",
          status: "already",
          detail: "the closing comment is on the ticket",
        });
      } else if (reconciled) {
        runClosing(() => {
          logAction(
            dispatch,
            "ticket-comment",
            ticket,
            `closing comment already on ticket: ${args.comment ?? ""}`,
            "ticket-comment",
          );
        });
        steps.push({
          name: "ticket-comment",
          status: "done",
          detail: "reconciled: the closing comment is already on the ticket",
        });
      } else if (dryRun) {
        steps.push({
          name: "ticket-comment",
          status: "would",
          detail: `would post the closing comment once`,
        });
      } else {
        runClosing(() => {
          const argv = [
            ...trackerArgv(adapter, set.repo, "comment", ticket),
            "postmaster",
            args.comment ?? "",
          ];
          const posted = run(argv[0]!, argv.slice(1));
          if (posted.code !== 0)
            throw new Fault(
              3,
              "ticket-comment",
              tail(posted),
              "fix the tracker (the message above), then run again",
            );
          logAction(
            dispatch,
            "ticket-comment",
            ticket,
            `closing comment: ${args.comment ?? ""}`,
            "ticket-comment",
          );
        });
        steps.push({
          name: "ticket-comment",
          status: "done",
          detail: `posted once for ticket ${ticket}`,
        });
      }
    }

    // 4. the done mark
    closingIndex = 3;
    if (stage === "done") {
      steps.push({ name: "stage", status: "already", detail: "the run is done" });
    } else if (dryRun) {
      steps.push({ name: "stage", status: "would", detail: "would set the stage to done" });
    } else {
      runClosing(() => {
        const marked = run(beside(import.meta, "run"), ["stage", dispatch, "done", "postmaster"]);
        if (marked.code !== 0)
          throw new Fault(
            3,
            "stage",
            `run stage could not mark the run done: ${tail(marked)}`,
            `fix run stage's message, then run again`,
          );
      });
      steps.push({ name: "stage", status: "done", detail: `${stage} -> done` });
    }

    // 5. the pinned tool, once the run is done
    closingIndex = 4;
    const postmasterRecord = asRecord(runRecord.postmaster);
    const pinPath =
      postmasterRecord && typeof postmasterRecord.checkout === "string"
        ? postmasterRecord.checkout
        : "";
    if (!existsSync(pinPath)) {
      steps.push({ name: "release", status: "already", detail: "the pin is already released" });
    } else if (dryRun) {
      const claims = `${pinPath}.claims`;
      let keeps = false;
      if (!existsSync(claims)) keeps = true;
      try {
        for (const line of readFileSync(claims, "utf8").split("\n")) {
          if (!line || phys(line) === dispatch) continue;
          const other = asRecord(parse(readFileSync(join(line, "manifest.json"), "utf8") ?? ""));
          const otherStage = other ? text(other.stage) : "";
          if (otherStage !== "done" && otherStage !== "abandoned") keeps = true;
        }
      } catch {
        keeps = true;
      }
      if (!keeps) {
        const blocked = pinReleasable(pinPath);
        if (blocked !== "") {
          steps.push({ name: "release", status: "failed", detail: blocked });
          stops.push({
            step: "release",
            reason: blocked,
            next: blocked.includes("is locked")
              ? `unlock the pin, then run again`
              : `fix the pin, then run again`,
          });
          return finish(3, steps, folders, stops);
        }
      }
      steps.push({
        name: "release",
        status: "would",
        detail: keeps ? "would keep the pin: another run uses it" : `would release ${pinPath}`,
      });
    } else {
      runClosing(() => {
        const released = run(beside(import.meta, "run"), ["run-meta", "release", dispatch]);
        if (released.code !== 0) {
          const message = tail(released);
          const locked = message.includes("is locked");
          throw new Fault(
            3,
            "release",
            `run-meta release could not release the pin: ${message}`,
            locked
              ? `unlock the pin, then run again`
              : `fix run-meta release's message (the pin stays), then run again`,
          );
        }
        const out = full(released);
        const removed = /^run-meta: removed (.+)$/mu.exec(out);
        if (removed) {
          logAction(
            dispatch,
            "teardown",
            removed[1]!.trim(),
            "removed the run's pinned tool",
            "release",
          );
          steps.push({ name: "release", status: "done", detail: `removed ${removed[1]!.trim()}` });
        } else if (/another run in flight still uses it/u.test(out)) {
          steps.push({
            name: "release",
            status: "done",
            detail: "the pin kept: another run in flight still uses it",
          });
        } else {
          steps.push({ name: "release", status: "already", detail: "nothing to release" });
        }
      });
    }

    return finish(0, steps, folders, stops);
  } catch (error) {
    if (error instanceof Fault) {
      if (!steps.some((step) => step.name === error.step))
        steps.push({ name: error.step, status: "failed", detail: error.reason });
      if (postLock && error.code !== 2) {
        if (!steps.some((step) => step.name === "close-run")) pendingWindows();
        // Steps after the failed one wait; runClosing may have listed them already.
        if (!steps.some((step) => step.status === "waiting")) {
          const at = CLOSING.indexOf(error.step);
          if (at >= 0) pendingClosing(at + 1);
          else if (!steps.some((step) => CLOSING.includes(step.name))) pendingClosing(0);
        }
      }
      stops.push({ step: error.step, reason: error.reason, next: error.whatNext });
      return finish(error.code, steps, folders, stops);
    }
    const message = String((error as Error)?.message ?? error);
    if (postLock) {
      if (!steps.some((step) => step.name === "close-run")) pendingWindows();
      if (!steps.some((step) => CLOSING.includes(step.name))) pendingClosing(0);
    }
    stops.push({
      step: "aftercare",
      reason: message,
      next: "a fault in the command: put it to the user, as a fault in a control (controls.md)",
    });
    return finish(1, steps, folders, stops);
  } finally {
    if (locked) {
      try {
        rmSync(join(dispatch, ".aftercare.lock"), { force: true });
      } catch {
        /* best effort */
      }
    }
  }
}

// --- the summary -------------------------------------------------------------------------------

function printPlain(result: Result): void {
  console.log(`aftercare: run ${result.run}${result.dryRun ? " (dry run)" : ""}`);
  for (const step of result.steps) {
    // A skipped step shows as already done, in the ticket's words; the JSON
    // record keeps the short status.
    const shown = step.status === "already" ? "already done" : step.status;
    console.log(`step ${step.name}: ${shown}${step.detail ? ` — ${step.detail}` : ""}`);
  }
  for (const folder of result.folders) {
    const bits: string[] = [];
    if (folder.saves.length)
      bits.push(`${result.dryRun ? "would save" : "saved"} ${folder.saves.join(" ")}`);
    if (folder.why) bits.push(folder.why);
    console.log(
      `folder ${folder.path}: ${folder.result}${bits.length ? ` — ${bits.join(" — ")}` : ""}`,
    );
  }
  for (const folder of result.folders)
    if (folder.flagged && folder.result !== "already removed" && folder.result !== "already gone")
      console.log(`flagged folder: ${folder.path} — ${folder.why ?? ""}`);
  console.log(`outcome: ${result.outcome}`);
  if (result.dryRun)
    console.log("note: the real run may still stop where the dry run could not tell");
  if (result.next !== null) console.log(`next: ${result.next}`);
}

function printJson(result: Result): void {
  console.log(
    JSON.stringify({
      run: result.run,
      dry_run: result.dryRun,
      outcome: result.outcome,
      steps: result.steps.map((step) => ({
        name: step.name,
        status: step.status,
        detail: step.detail,
      })),
      folders: result.folders.map((folder) => ({
        path: folder.path,
        saves: folder.saves,
        result: folder.result,
        flagged: folder.flagged,
        why: folder.why,
      })),
      next: result.next,
    }),
  );
}

function printStops(result: Result): void {
  for (const stop of result.stops) {
    console.error(`aftercare: stop at ${stop.step}: ${stop.reason}`);
    console.error(`aftercare: next: ${stop.next}`);
  }
}

// --- entry --------------------------------------------------------------------------------------

function main(argv: string[]): number {
  // Ambient git location overrides redirect every `git -C` below at the wrong checkout,
  // so a save would capture another folder's state before this one goes. This command
  // names every checkout explicitly and inherits none of these.
  for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"])
    delete process.env[name];
  const args = parseArgs(argv);
  if (args.usage !== null) {
    console.error(`aftercare: stop at arguments: ${args.usage}`);
    console.error(`aftercare: next: ${USAGE}`);
    return 1;
  }
  const result = mainFlow(args);
  if (args.json) printJson(result);
  else printPlain(result);
  printStops(result);
  return result.code;
}

if (import.meta.main) {
  process.exit(main(argvDecoded()));
}
