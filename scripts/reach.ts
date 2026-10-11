// Check observed changes against the paths lane records name, by lane.
//
//   run reach stream <dispatch> <lane> <events> <own-folder>
//   run reach before <dispatch> <round>
//   run reach check <dispatch> workhorses|r<round>|card
//   run reach restore <dispatch> r<round>
//   run reach round <dispatch> r<round>
//
//   exit 0  checked, no findings or notes
//   exit 1  the check could not run
//   exit 2  an observed change was found
//   exit 3  notes or records not checked
//
//   round checks, then restores unless the check faulted: exit 1 with no
//   restore when the check could not run, else restore's exit.
//
// A finding comes only from an observed change: the main checkout, or this
// run's branches and synthesis worktree around a round. What a lane's record
// names outside its own folder is a note listing the lane and the path; it
// never says read or write, and never voids a verdict. A change is tied to a
// lane when that lane's record names the path or the branch.

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { reachTarget } from "./check-target.ts";
import { toolRoot } from "./lib/paths.ts";
import { run } from "./lib/proc.ts";

type RecordOf<T = unknown> = Record<string, T>;
type Harness = "codex" | "claude" | "muse" | "mimo" | "pi" | string;
/** Observed changes read "read" or "write"; a named path reads "names", never either. */
type Access = "read" | "write" | "names";
type Place = "inside" | "main checkout" | "synthesis worktree" | "another worktree" | "elsewhere";

interface ToolCall {
  name: string;
  input: RecordOf;
  output: string;
  exitCode: unknown;
  direct: Array<{ path: string; access: Access }>;
}

interface Touch {
  path: string;
  access: Access;
  place: Place;
  kind: "expected" | "finding" | "note";
  lane: string;
  lens?: string;
  source: "stream" | "checkout" | "round";
  user?: boolean;
  detail?: string;
}

interface LaneRead {
  lane: string;
  harness: Harness;
  ownFolder: string;
  lens?: string;
  events: string;
  calls: ToolCall[];
  touches: Touch[];
  /** Verbatim refs/heads/ and refs/tags/ tokens from the lane's commands. */
  refs: string[];
  status: "checked" | "not checked";
  reason?: string;
}

interface RunInfo {
  dispatch: string;
  repo: string;
  ticket: string;
  run: RecordOf;
  config: RecordOf;
  lanes: RecordOf;
  manifest: RecordOf;
  defaultBranch: string;
  tool: string;
  home: string;
}

interface Snapshot {
  round: number;
  refs: Record<string, string>;
  synthesisHead: string;
  synthesisBranch: string;
  synthesisStatus: Record<string, string>;
  mainHead: string;
  mainBranch: string;
}

interface ReachEvent {
  kind: "point" | "finding" | "note" | "void";
  point: string;
  result?: "clean" | "finding" | "note" | "not checked";
  lane?: string;
  lens?: string;
  access?: string;
  place?: string;
  path?: string;
  reason?: string;
  before?: string;
  after?: string;
  harness?: string;
  [key: string]: unknown;
}

const TOOL = toolRoot(import.meta);
const RUN = join(TOOL, "scripts", "run");

const DATA_RE = /^[ \t\r\n]*\{[^]*\}[ \t\r\n]*$/u;

function rec(value: unknown): RecordOf {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordOf)
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readJson(path: string, what: string): RecordOf {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (e) {
    throw new Error(`${what} cannot be read: ${path} (${String(e)})`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${what} is not an object: ${path}`);
  }
  return parsed as RecordOf;
}

export function physical(path: string): string {
  const absolute = resolve(path);
  const suffix: string[] = [];
  let probe = absolute;
  while (!existsSync(probe)) {
    const parent = dirname(probe);
    if (parent === probe) return normalize(absolute);
    suffix.unshift(basename(probe));
    probe = parent;
  }
  try {
    return normalize(join(realpathSync(probe), ...suffix));
  } catch {
    return normalize(absolute);
  }
}

function inside(path: string, dir: string): boolean {
  const rel = relative(dir, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/** A waybill section by heading; the last one wins, since the ticket may quote one. */
function briefSection(brief: string, heading: string): string {
  const lines = brief.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]?.startsWith(heading)) start = i + 1;
  }
  if (start < 0) return "";
  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    if (lines[i]?.startsWith("## ")) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

function pathFromBrief(
  dispatch: string,
  repo: string,
  run: RecordOf,
): { repo: string; branch: string } {
  const brief = readFileSync(join(dispatch, "brief.md"), "utf8");
  // The ticket travels in the waybill verbatim and may quote a repo: line, so
  // only the Project profile section counts; a waybill without one reads whole.
  const scope = briefSection(brief, "## Project profile") || brief;
  // The path runs to the end of the line: it may itself hold spaces, and only
  // a "default branch:" marker ends it early.
  const profile =
    /^repo:[ \t]*([^ \r\n]*(?:[ \t]+(?!default branch:)[^ \t\r\n]+)*)(?:[ \t]+default branch:[ \t]*([^ \t\r\n]+))?/mu.exec(
      scope,
    );
  const namedRepo = profile?.[1] ? physical(profile[1]) : repo;
  const target = rec(run.target);
  let defaultBranch = profile?.[2] ?? text(target.branch);
  if (!defaultBranch || defaultBranch === "(detached HEAD)") {
    const originHead = runGit(namedRepo, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
    if (originHead.code === 0) defaultBranch = originHead.out.trim().replace(/^origin\//u, "");
  }
  if (!defaultBranch) {
    const configured = runGit(namedRepo, ["config", "--get", "init.defaultBranch"]);
    if (configured.code === 0) defaultBranch = configured.out.trim();
  }
  if (!defaultBranch) throw new Error(`cannot determine the default branch for ${namedRepo}`);
  return { repo: namedRepo, branch: defaultBranch };
}

// Inherited directory overrides make git honor them over -C, so every git
// subprocess in this control runs without them.
const UNSET_GIT = {
  GIT_DIR: undefined,
  GIT_WORK_TREE: undefined,
  GIT_COMMON_DIR: undefined,
  GIT_INDEX_FILE: undefined,
  GIT_OBJECT_DIRECTORY: undefined,
  GIT_ALTERNATE_OBJECT_DIRECTORIES: undefined,
  GIT_NAMESPACE: undefined,
};

function runGit(repo: string, args: string[], cwd?: string) {
  return run("git", ["-C", repo, ...args], { env: UNSET_GIT, ...(cwd ? { cwd } : {}) });
}

function loadRun(dispatchArg: string): RunInfo {
  const dispatch = physical(dispatchArg);
  if (!statSync(dispatch).isDirectory()) throw new Error(`no dispatch directory: ${dispatch}`);
  const runData = readJson(join(dispatch, "run.json"), "run.json");
  const manifest = readJson(join(dispatch, "manifest.json"), "manifest.json");
  const configured = rec(runData.config);
  const lanes = rec(configured.lanes);
  const targetRoot = dirname(dirname(dirname(dispatch)));
  const resolved = pathFromBrief(dispatch, targetRoot, runData);
  const postmaster = rec(runData.postmaster);
  let tool = text(postmaster.checkout);
  if (!tool) {
    const brief = readFileSync(join(dispatch, "brief.md"), "utf8");
    const scope = briefSection(brief, "## Dispatch") || brief;
    const found = /^tool:[ \t]*([^ \t\r\n]+)/mu.exec(scope);
    tool = found?.[1] ?? TOOL;
  }
  return {
    dispatch,
    repo: resolved.repo,
    ticket: basename(dispatch),
    run: runData,
    config: configured,
    lanes,
    manifest,
    defaultBranch: resolved.branch,
    tool: physical(tool),
    home: physical(process.env.HOME || homedir()),
  };
}

function placeOf(info: RunInfo, path: string, ownFolder: string): Place {
  // An empty folder means no lane owns the path; never resolve it against the
  // working directory.
  if (ownFolder !== "" && inside(path, ownFolder)) return "inside";
  const worktrees = join(info.repo, ".worktrees");
  if (inside(path, worktrees)) {
    const rel = relative(worktrees, path);
    const worktreeName = rel.split(sep)[0] ?? "";
    if (worktreeName === info.ticket) return "synthesis worktree";
    return "another worktree";
  }
  if (inside(path, info.repo)) return "main checkout";
  return "elsewhere";
}

function expandPath(token: string, cwd: string): string | null {
  if (!token || /[*?[\]]/u.test(token)) return null;
  let value = token;
  if (value.startsWith("~")) {
    if (value !== "~" && !value.startsWith("~/")) return null;
    value = join(process.env.HOME || homedir(), value.slice(2));
  }
  value = value.replace(/\$HOME(?=\/|$)/gu, process.env.HOME || homedir());
  value = value.replace(/\$TMPDIR(?=\/|$)/gu, process.env.TMPDIR || "\0");
  value = value.replace(/\$\{HOME\}(?=\/|$)/gu, process.env.HOME || homedir());
  if (value.includes("$") || value.includes("\u0000")) return null;
  if (!isAbsolute(value)) value = resolve(cwd, value);
  return physical(value);
}

function toolCallsFromEvents(harness: Harness, events: unknown[]): ToolCall[] {
  const calls: ToolCall[] = [];
  const add = (
    name: unknown,
    input: unknown,
    output = "",
    exitCode: unknown = undefined,
    direct: ToolCall["direct"] = [],
  ): number => {
    calls.push({ name: text(name) || "tool", input: rec(input), output, exitCode, direct });
    return calls.length - 1;
  };
  const linked = new Map<string, number>();
  const pending = new Map<string, number>();
  for (const raw of events) {
    const event = rec(raw);
    if (harness === "codex") {
      if (event.type !== "item.completed") continue;
      const item = rec(event.item);
      if (item.type === "command_execution") {
        add(
          "shell",
          { command: text(item.command) },
          `${text(item.aggregated_output)}\n${text(item.output)}`,
          item.exit_code,
        );
      } else if (item.type === "file_change") {
        const direct = array(item.changes).flatMap((entry) => {
          const path = text(rec(entry).path);
          return path ? [{ path, access: "write" as const }] : [];
        });
        add("file_change", {}, "", undefined, direct);
      } else if (item.type === "mcp_tool_call") {
        add("mcp", item);
      }
    } else if (harness === "claude") {
      const msg = rec(event.message);
      for (const blockValue of array(msg.content)) {
        const block = rec(blockValue);
        if (event.type === "assistant" && block.type === "tool_use") {
          const index = add(block.name, block.input);
          if (typeof block.id === "string") linked.set(block.id, index);
        } else if (event.type === "user" && block.type === "tool_result") {
          const id = text(block.tool_use_id);
          const index = linked.get(id);
          if (index !== undefined) {
            const body =
              typeof block.content === "string"
                ? block.content
                : JSON.stringify(block.content ?? "");
            calls[index]!.output += `\n${body}`;
          }
        }
      }
    } else if (harness === "mimo") {
      if (event.type !== "tool_use") continue;
      const part = rec(event.part);
      const state = rec(part.state);
      add(part.tool, state.input, text(state.output), rec(state.metadata).exit);
    } else if (harness === "pi") {
      if (event.type === "tool_execution_start") {
        const index = add(event.toolName, event.args);
        const id = text(event.toolCallId || event.callId || event.id);
        if (id) linked.set(id, index);
        else pending.set(text(event.toolName), index);
      } else if (event.type === "tool_execution_end") {
        const id = text(event.toolCallId || event.callId || event.id);
        const index = linked.get(id) ?? pending.get(text(event.toolName));
        if (index !== undefined) calls[index]!.output = text(event.result ?? event.output);
      }
    } else if (harness === "muse") {
      if (event.payload_type !== "tool.result") continue;
      const payload = rec(event.payload);
      const facts = rec(payload.correlation_facts);
      const editFacts = rec(payload.edit_facts);
      let input: RecordOf = { ...editFacts };
      const resultText = text(payload.text);
      if (resultText.trimStart().startsWith("{")) {
        const first = resultText.trimStart().split("\n", 1)[0] ?? "";
        if (DATA_RE.test(first)) {
          try {
            input = { ...(JSON.parse(first) as RecordOf), ...input };
          } catch {
            // Non-JSON result text can still carry the edit_facts record.
          }
        }
      } else {
        const readFile = /^Read text file `([^`]+)`/u.exec(resultText.trimStart());
        if (readFile?.[1] && !input.path && !input.file_path) input.path = readFile[1];
      }
      const direct: ToolCall["direct"] = [];
      const toolName = text(facts.tool_name);
      const access: Access =
        /write|edit|create|patch|apply|delete|remove|move|copy|install|save/iu.test(toolName)
          ? "write"
          : "read";
      for (const field of ["path", "file_path"]) {
        const p = text(input[field]);
        if (p) direct.push({ path: p, access });
      }
      add(toolName, input, resultText, facts.outcome, direct);
    }
  }
  return calls;
}

function parseEventFile(path: string): unknown[] | null {
  let contents: string;
  try {
    contents = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  const events: unknown[] = [];
  for (const line of contents.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as unknown);
    } catch {
      return null;
    }
  }
  return events;
}

function parseTaskFile(path: string): unknown[] | null {
  return parseEventFile(path);
}

function inputPath(input: RecordOf): string | null {
  for (const key of ["file_path", "path", "filePath", "filename", "target"]) {
    const value = text(input[key]);
    if (value) return value;
  }
  return null;
}

/**
 * A command token that names a path: starting at /, ~ or $HOME, or climbing
 * out with a .. segment. Flags, assignments, bare words, patterns and
 * substitutions standing alone name nothing.
 */
function isMentionToken(token: string): boolean {
  if (token.startsWith("/") || token.startsWith("~")) return true;
  if (
    token === "$HOME" ||
    token === "${HOME}" ||
    token.startsWith("$HOME/") ||
    token.startsWith("${HOME}/")
  )
    return true;
  return token.split("/").includes("..");
}

/** Strip the quoting and trailing punctuation prose leaves on a token. */
function stripToken(token: string): string {
  return token
    .replace(/^['"`]+/u, "")
    .replace(/['"`]+[.,:;!?]*$/u, "")
    .replace(/[.,:;!?]+$/u, "");
}

function mentionTouch(
  info: RunInfo,
  lane: string,
  ownFolder: string,
  path: string,
  detail: string,
  lens?: string,
): Touch {
  const place = placeOf(info, path, ownFolder);
  return {
    path,
    access: "names",
    place,
    kind: place === "inside" ? "expected" : "note",
    lane,
    ...(lens ? { lens } : {}),
    source: "stream",
    ...(detail ? { detail } : {}),
  };
}

function unresolvedTouch(lane: string, token: string, lens?: string): Touch {
  // The raw token stays in the path, so the run log keeps it; the reason
  // stays generic, so the card cannot leak a private path through it.
  return {
    path: token,
    access: "names",
    place: "elsewhere",
    kind: "note",
    lane,
    ...(lens ? { lens } : {}),
    source: "stream",
    detail: "unresolved",
  };
}

/**
 * The paths a shell command names, without judging them: each operand-shaped
 * token outside the lane's folder becomes a note, each ref-shaped token a
 * branch naming for the tie. Nothing here says read or write.
 */
function commandMentions(
  command: string,
  info: RunInfo,
  lane: string,
  ownFolder: string,
  lens?: string,
): { touches: Touch[]; refs: string[] } {
  const touches: Touch[] = [];
  const refs: string[] = [];
  // Codex wraps every command; open the wrapper but never execute it.
  let unwrapped = command;
  if (unwrapped.startsWith("/bin/bash -lc '")) {
    unwrapped = unwrapped.slice("/bin/bash -lc '".length);
    if (unwrapped.endsWith("'")) unwrapped = unwrapped.slice(0, -1);
  }
  for (const raw of unwrapped.split(/[ \t\r\n;&|()<>]+/u)) {
    const token = stripToken(raw);
    if (!token) continue;
    if (/^refs\/(?:heads|tags)\/[^ \t\r\n]+$/u.test(token)) {
      refs.push(token);
      continue;
    }
    if (!isMentionToken(token)) continue;
    const absolute = expandPath(token, ownFolder);
    if (absolute === null) {
      touches.push(unresolvedTouch(lane, token, lens));
      continue;
    }
    touches.push(mentionTouch(info, lane, ownFolder, absolute, "", lens));
  }
  return { touches, refs };
}

function directCallMentions(
  calls: ToolCall[],
  info: RunInfo,
  lane: string,
  ownFolder: string,
  lens?: string,
): { touches: Touch[]; refs: string[] } {
  const touches: Touch[] = [];
  const refs: string[] = [];
  for (const call of calls) {
    const command = text(call.input.command ?? call.input.cmd);
    if (command) {
      const named = commandMentions(command, info, lane, ownFolder, lens);
      touches.push(...named.touches);
      refs.push(...named.refs);
      continue;
    }
    // A file tool's path is a path, never a pattern: no shape test.
    const direct = [...call.direct];
    const path = inputPath(call.input);
    if (path) direct.push({ path, access: "names" });
    for (const item of direct) {
      const absolute = expandPath(item.path, ownFolder);
      if (!absolute) {
        touches.push(unresolvedTouch(lane, item.path, lens));
        continue;
      }
      touches.push(mentionTouch(info, lane, ownFolder, absolute, "", lens));
    }
  }
  return { touches, refs };
}

function mergeTouches(touches: Touch[]): Touch[] {
  const byPath = new Map<string, Touch>();
  for (const touch of touches) {
    const key = `${touch.lane}\0${touch.lens ?? ""}\0${touch.path}`;
    // Mentions merge by path: one note per lane and path, the first telling kept.
    if (!byPath.has(key)) byPath.set(key, touch);
  }
  return [...byPath.values()].sort((a, b) =>
    `${a.lane}\0${a.lens ?? ""}\0${a.path}`.localeCompare(`${b.lane}\0${b.lens ?? ""}\0${b.path}`),
  );
}

function readLane(
  info: RunInfo,
  lane: string,
  events: string,
  ownFolder: string,
  lens?: string,
): LaneRead {
  const harness = text(rec(info.lanes[lane]).harness);
  const laneRecord: LaneRead = {
    lane,
    harness,
    ownFolder: physical(ownFolder),
    ...(lens ? { lens } : {}),
    events,
    calls: [],
    touches: [],
    refs: [],
    status: "not checked",
  };
  if (!["codex", "claude", "muse", "mimo", "pi"].includes(harness)) {
    laneRecord.reason = `${harness || "unknown harness"} has no reach reader`;
    return laneRecord;
  }
  const parsed = parseEventFile(events);
  if (parsed === null) {
    laneRecord.reason = "the lane record cannot be read";
    return laneRecord;
  }
  const allEvents = [...parsed];
  if (harness === "claude") {
    const logs = join(info.dispatch, "logs");
    // The review harvester prefixes copied Claude fork records with the bug lane's stream name.
    const streamName = basename(events).replace(/\.jsonl$/u, "");
    const taskPrefix = streamName.startsWith("review-r") ? streamName : lane;
    const taskName = `${taskPrefix}-claude-task-`;
    try {
      for (const name of readdirSync(logs)) {
        if (name.startsWith(taskName)) {
          const task = parseTaskFile(join(logs, name));
          if (task === null) {
            laneRecord.reason = `the task transcript cannot be read: ${name}`;
            return laneRecord;
          }
          allEvents.push(...task);
        }
      }
    } catch {
      // A missing task directory is ordinary; a task file the stream does name is reported by harvest.
    }
  }
  laneRecord.calls = toolCallsFromEvents(harness, allEvents);
  if (laneRecord.calls.length === 0) {
    laneRecord.reason = "no recognized tool call in the lane record";
    return laneRecord;
  }
  laneRecord.status = "checked";
  // An unresolvable naming is a note, never not checked: only a record that
  // cannot be read at all leaves the lane not checked.
  const judged = directCallMentions(laneRecord.calls, info, lane, laneRecord.ownFolder, lens);
  laneRecord.touches = mergeTouches(judged.touches);
  laneRecord.refs = [...new Set(judged.refs)];
  return laneRecord;
}

function noShellDisplay(touch: Touch): string {
  if (touch.kind === "expected") return `expected ${touch.access} ${touch.path}`;
  return `${touch.kind} ${touch.access} ${touch.path} (${touch.place})${touch.detail ? ` · ${touch.detail}` : ""}`;
}

function readStreamMode(info: RunInfo, lane: string, stream: string, ownFolder: string): number {
  const result = readLane(info, lane, stream, ownFolder);
  for (const touch of result.touches) console.log(noShellDisplay(touch));
  if (result.status === "not checked") console.log(`not checked: ${result.reason}`);
  if (result.touches.some((touch) => touch.kind === "finding")) return 2;
  if (result.status === "not checked" || result.touches.some((touch) => touch.kind === "note"))
    return 3;
  console.log("clean");
  return 0;
}

function gitOutput(repo: string, args: string[]): string {
  const result = runGit(repo, args);
  if (result.code !== 0)
    throw new Error(`git ${args.join(" ")} failed in ${repo}: ${result.err.trim()}`);
  return result.out;
}

function currentHead(repo: string, where = repo): string {
  return gitOutput(repo, ["-C", where, "rev-parse", "--verify", "HEAD"]).trim();
}

function branchName(repo: string, where = repo): string {
  const branch = runGit(where, ["symbolic-ref", "--short", "-q", "HEAD"]);
  return branch.code === 0 ? branch.out.trim() : "(detached HEAD)";
}

function statusMap(repo: string, where: string): Record<string, string> {
  const result = runGit(where, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  if (result.code !== 0) throw new Error(`cannot read status in ${where}: ${result.err.trim()}`);
  const fields = result.out.split("\0").filter(Boolean);
  const status: Record<string, string> = {};
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i] ?? "";
    const path = field.slice(3);
    if (path) status[path] = field.slice(0, 2);
    if (/^(?:R|C)/u.test(field.slice(0, 2))) i++;
  }
  return status;
}

function runRefs(repo: string, ticket: string): Record<string, string> {
  const result = runGit(repo, ["for-each-ref", "--format=%(refname) %(objectname)", "refs/heads"]);
  if (result.code !== 0)
    throw new Error(`cannot read run branches in ${repo}: ${result.err.trim()}`);
  const refs: Record<string, string> = {};
  for (const line of result.out.split("\n")) {
    const [ref, hash] = line.trim().split(" ");
    if (
      ref &&
      hash &&
      (ref === `refs/heads/${ticket}` || ref.startsWith(`refs/heads/wb/${ticket}-`))
    )
      refs[ref] = hash;
  }
  return refs;
}

function synthesisPath(info: RunInfo): string {
  return join(info.repo, ".worktrees", info.ticket);
}

/**
 * The synthesis worktree must be the worktree it claims to be before any read
 * or reset runs inside it: git climbs to the main checkout when `.git` is
 * missing, and a reset there would move the default branch.
 */
function assertSynth(info: RunInfo, needBranch: boolean): void {
  const synth = synthesisPath(info);
  // Lstat the path itself: a symlink to the main checkout would resolve both
  // sides of the comparison below to the same directory and pass.
  let stat: { isDirectory(): boolean; isSymbolicLink(): boolean } | null = null;
  try {
    stat = lstatSync(synth);
  } catch {
    stat = null;
  }
  if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`synthesis worktree is not a worktree: ${synth}`);
  }
  const top = runGit(synth, ["rev-parse", "--show-toplevel"]);
  if (top.code !== 0 || physical(top.out.trim()) !== physical(synth)) {
    throw new Error(`synthesis worktree is not a worktree: ${synth}`);
  }
  if (needBranch && branchName(info.repo, synth) !== info.ticket) {
    throw new Error(`synthesis worktree is not on ${info.ticket}`);
  }
}

/** The next free save directory for a round's restore, so a rerun never wipes one. */
function saveDir(info: RunInfo, round: number): string {
  const base = join(info.dispatch, "reach", `r${round}`);
  for (let i = 0; ; i++) {
    const dir = i === 0 ? base : `${base}-${i + 1}`;
    try {
      if (readdirSync(dir).length === 0) return dir;
    } catch {
      return dir;
    }
  }
}

function snapshotPath(info: RunInfo, round: number): string {
  return join(info.dispatch, "reach", `before-r${round}.json`);
}

function saveSnapshot(info: RunInfo, round: number): number {
  if (!Number.isInteger(round) || round < 1) throw new Error(`round is not positive: ${round}`);
  assertSynth(info, true);
  const synth = synthesisPath(info);
  const result = reachTarget(info.repo, info.defaultBranch);
  if (result.code === 1) throw new Error(result.out.trim());
  const snapshot: Snapshot = {
    round,
    refs: runRefs(info.repo, info.ticket),
    synthesisHead: currentHead(info.repo, synth),
    synthesisBranch: branchName(info.repo, synth),
    synthesisStatus: statusMap(info.repo, synth),
    mainHead: currentHead(info.repo, info.repo),
    mainBranch: branchName(info.repo, info.repo),
  };
  const path = snapshotPath(info, round);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`before r${round}: ${snapshot.synthesisHead}`);
  return 0;
}

function loadSnapshot(info: RunInfo, round: number): Snapshot {
  const parsed = readJson(snapshotPath(info, round), `before r${round}`);
  if (
    parsed.round !== round ||
    typeof parsed.synthesisHead !== "string" ||
    typeof parsed.refs !== "object"
  ) {
    throw new Error(`before r${round} is malformed`);
  }
  return parsed as unknown as Snapshot;
}

function expectedWorkhorseNames(info: RunInfo): string[] {
  const lanes = rec(info.manifest.lanes);
  return Object.keys(lanes)
    .filter((lane) => Object.hasOwn(info.lanes, lane))
    .sort();
}

function reviewersFor(info: RunInfo, round: number): Array<[string, string]> {
  const state = readJson(
    join(info.dispatch, "logs", `review-r${round}.json`),
    `round ${round} reviewer record`,
  );
  const pairs = array(state.reviewers);
  const reviewers: Array<[string, string]> = [];
  for (const pair of pairs) {
    if (
      !Array.isArray(pair) ||
      pair.length < 2 ||
      typeof pair[0] !== "string" ||
      typeof pair[1] !== "string"
    ) {
      throw new Error(`round ${round} has a malformed reviewer record`);
    }
    reviewers.push([pair[0], pair[1]]);
  }
  return reviewers;
}

function roundOwnFolder(info: RunInfo, lens: string, lane: string): string {
  return join(info.repo, ".worktrees", `${info.ticket}-rev-${lens}-${lane}`);
}

function workhorseEvents(info: RunInfo, lane: string): string {
  return join(info.dispatch, "logs", `${lane}-events.jsonl`);
}

function reviewerEvents(info: RunInfo, round: number, lens: string, lane: string): string {
  return join(info.dispatch, "logs", `review-r${round}-${lens}-${lane}.jsonl`);
}

function aggregateLaneReads(reads: LaneRead[]): Touch[] {
  return reads.flatMap((read) => read.touches);
}

function pathChangeTouch(
  info: RunInfo,
  path: string,
  access: Access,
  lane: string,
  detail: string,
): Touch {
  const absolute =
    path.startsWith("refs/") || isAbsolute(path) ? path : physical(join(info.repo, path));
  const place = path.startsWith("refs/") ? "elsewhere" : placeOf(info, absolute, "");
  return {
    lane,
    path: absolute,
    access,
    place,
    kind: access === "write" ? "finding" : "note",
    source: "round",
    detail,
  };
}

function addMainChanges(
  info: RunInfo,
  point: string,
  touches: Touch[],
  initial: boolean,
): { result: ReturnType<typeof reachTarget>; mainDirty: boolean } {
  const result = reachTarget(info.repo, info.defaultBranch);
  if (result.code === 1) throw new Error(result.out.trim());
  for (const path of result.changed) {
    const absolute = resolve(info.repo, path);
    const target = physical(absolute);
    const ties = touches.filter(
      (touch) =>
        (touch.path === absolute || touch.path === target) &&
        touch.kind !== "expected" &&
        touch.lane !== "",
    );
    // One tying lane each: a main checkout change a lane's record names is
    // tied to every lane that names it. At the workhorses point an untied
    // change is the finding; at a round, a tied change is a finding about
    // each of its reviewers, and an untied one a note.
    const seen = new Set<string>();
    const lanes = ties.filter((tie) => {
      const key = `${tie.lens ?? ""}\0${tie.lane}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (lanes.length === 0) {
      touches.push({
        lane: "",
        path: absolute,
        access: "write",
        place: "main checkout",
        kind: initial ? "finding" : "note",
        source: "checkout",
        detail: "main checkout changed without a lane record",
      });
      continue;
    }
    for (const tie of lanes) {
      touches.push({
        lane: tie.lane,
        ...(tie.lens ? { lens: tie.lens } : {}),
        path: absolute,
        access: "write",
        place: "main checkout",
        kind: initial ? "note" : "finding",
        source: "checkout",
        detail: `tied to ${tie.lane}`,
      });
    }
  }
  if (result.offDefault) {
    touches.push({
      lane: "",
      path: info.repo,
      access: "write",
      place: "main checkout",
      kind: initial ? "finding" : "note",
      source: "checkout",
      detail: `branch ${result.branch} is not the default branch ${info.defaultBranch}`,
    });
  }
  return { result, mainDirty: result.code === 2 };
}

/** Coachman apply targets, oldest first, expanded to full commits.
 * An unreadable log or an unresolvable target excuses nothing: the
 * caller treats a null return as no exemption. */
function loggedApplies(repo: string, dispatch: string): string[] | null {
  let contents: string;
  try {
    contents = readFileSync(join(dispatch, "actions.jsonl"), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    return null;
  }
  const targets: string[] = [];
  for (const line of contents.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return null;
    }
    if (row.action !== "apply" || row.actor !== "coachman") continue;
    if (typeof row.target !== "string" || !/^[0-9a-f]{4,40}$/iu.test(row.target)) return null;
    targets.push(row.target);
  }
  const expanded: string[] = [];
  for (const target of targets) {
    const sha = runGit(repo, ["rev-parse", "--verify", "--quiet", `${target}^{commit}`]);
    if (sha.code !== 0 || !/^[0-9a-f]{40}$/u.test(sha.out.trim())) return null;
    expanded.push(sha.out.trim());
  }
  return expanded;
}

/** How a changed path prints: refs verbatim, files relative to the repo. */
function displayPath(info: RunInfo, path: string): string {
  return path.startsWith("refs/") ? path : relative(info.repo, path) || path;
}

/** Whether a run-branch move is exactly the logged applies, in order.
 * Anything else — an unlogged commit, a rewind, a longer chain — reads
 * as unexplained, as before. */
function moveExplained(
  repo: string,
  applies: string[] | null,
  before: string,
  after: string,
): boolean {
  if (applies === null) return false;
  if (!/^[0-9a-f]{40}$/u.test(before) || !/^[0-9a-f]{40}$/u.test(after)) return false;
  const chain = runGit(repo, [
    "rev-list",
    "--reverse",
    `--max-count=${applies.length + 1}`,
    `${before}..${after}`,
  ]);
  if (chain.code !== 0) return false;
  const commits = chain.out.split("\n").filter(Boolean);
  if (commits.length === 0 || commits.length > applies.length) return false;
  const inChain = new Set(commits);
  const logged = applies.filter((sha) => inChain.has(sha));
  return logged.length === commits.length && logged.every((sha, i) => sha === commits[i]);
}

function roundChanges(
  info: RunInfo,
  round: number,
  snapshot: Snapshot,
  reads: LaneRead[],
): { touches: Touch[]; unassignedTracked: boolean } {
  const touches: Touch[] = [];
  const refsNow = runRefs(info.repo, info.ticket);
  const refs = new Set([...Object.keys(snapshot.refs), ...Object.keys(refsNow)]);
  const ticketWorktree = synthesisPath(info);
  const changes: Array<{ path: string; before: string; after: string; tracked: boolean }> = [];
  for (const ref of [...refs].sort()) {
    const before = snapshot.refs[ref] ?? "(absent)";
    const after = refsNow[ref] ?? "(absent)";
    if (before !== after) changes.push({ path: ref, before, after, tracked: true });
  }
  const head = currentHead(info.repo, ticketWorktree);
  if (head !== snapshot.synthesisHead) {
    changes.push({
      path: ticketWorktree,
      before: snapshot.synthesisHead,
      after: head,
      tracked: true,
    });
  }
  const current = statusMap(info.repo, ticketWorktree);
  const fileNames = new Set([...Object.keys(snapshot.synthesisStatus), ...Object.keys(current)]);
  for (const name of fileNames) {
    const before = snapshot.synthesisStatus[name] ?? "(absent)";
    const after = current[name] ?? "(absent)";
    if (before !== after) {
      const absolute = resolve(ticketWorktree, name);
      const tracked = before !== "(absent)" || after !== "??";
      changes.push({ path: absolute, before, after, tracked });
    }
  }
  let unassignedTracked = false;
  const ticketRef = `refs/heads/${info.ticket}`;
  const checked = reads.filter((read) => read.status === "checked");
  // A change is tied to a lane when that lane's record names the path or
  // the branch: a mention of the path, or a verbatim refs/ naming.
  const named = (read: LaneRead, path: string): boolean =>
    read.touches.some((touch) => touch.path === path) || read.refs.includes(path);
  const worktreeOf = (refName: string): string => {
    if (refName === ticketRef) return ticketWorktree;
    if (refName.startsWith(`refs/heads/wb/${info.ticket}-`)) {
      const lane = refName.slice(`refs/heads/wb/${info.ticket}-`.length);
      return join(info.repo, ".worktrees", `${info.ticket}-${lane}`);
    }
    return "";
  };
  // A file change rides with the ticket-branch move only through a lane that
  // owns the move, and only when the move produced it: the file differs
  // between the two commits, and the disk matches one side or the other. A
  // disk edit no record names stays unexplained even beside a merge.
  const ticketRiders = new Set<LaneRead>();
  for (const change of changes) {
    const refName = change.path.startsWith("refs/heads/") ? change.path : "";
    const isHead = change.path === ticketWorktree;
    const isTicket = refName === ticketRef || isHead;
    if (!isTicket) continue;
    const checkedOut = refName ? worktreeOf(refName) : "";
    for (const read of checked) {
      if (
        (refName && named(read, refName)) ||
        (checkedOut && named(read, checkedOut)) ||
        (isHead && named(read, ticketWorktree))
      )
        ticketRiders.add(read);
    }
  }
  const ticketMove =
    changes.find((change) => change.path === ticketRef) ??
    changes.find((change) => change.path === ticketWorktree);
  const movedPair =
    ticketMove && ticketMove.before !== "(absent)" && ticketMove.after !== "(absent)"
      ? { before: ticketMove.before, after: ticketMove.after }
      : null;
  const movedFiles = new Set<string>();
  const diskDiffers = new Set<string>();
  if (movedPair && ticketRiders.size > 0) {
    const moved = runGit(info.repo, [
      "diff",
      "--no-renames",
      "--name-only",
      movedPair.before,
      movedPair.after,
    ]);
    if (moved.code !== 0) throw new Error(`cannot diff the ticket move: ${moved.err.trim()}`);
    for (const name of moved.out.split("\n").filter(Boolean)) movedFiles.add(name);
    for (const side of [movedPair.before, movedPair.after]) {
      const disk = runGit(ticketWorktree, ["diff", "--no-renames", "--name-only", side]);
      if (disk.code !== 0) throw new Error(`cannot diff the worktree: ${disk.err.trim()}`);
      for (const name of disk.out.split("\n").filter(Boolean)) diskDiffers.add(`${side}:${name}`);
    }
  }
  const moveProduced = (name: string): boolean => {
    if (!movedPair) return true;
    if (!movedFiles.has(name)) return false;
    // The disk matches one side: a merge updates it, an update-ref leaves it.
    return (
      !diskDiffers.has(`${movedPair.after}:${name}`) ||
      !diskDiffers.has(`${movedPair.before}:${name}`)
    );
  };
  const ticketRefOwner = checked.find((read) => named(read, ticketRef));
  const applies = loggedApplies(info.repo, info.dispatch);
  for (const change of changes) {
    const refName = change.path.startsWith("refs/heads/") ? change.path : "";
    const exactPath = change.path;
    const checkedOutWorktree = refName ? worktreeOf(refName) : "";
    const owners = checked.filter((read) => {
      if (refName || exactPath === ticketWorktree) {
        if (named(read, exactPath)) return true;
        if (checkedOutWorktree && named(read, checkedOutWorktree)) return true;
        return false;
      }
      if (named(read, exactPath)) return true;
      if (!ticketRiders.has(read)) return false;
      return moveProduced(relative(ticketWorktree, exactPath));
    });
    // Every tied reviewer gets the finding: voiding derives from findings, and a
    // tied reviewer past the first must not stay trusted.
    const allOwners =
      owners.length > 0
        ? owners
        : exactPath === ticketWorktree && ticketRefOwner && ticketRiders.has(ticketRefOwner)
          ? [ticketRefOwner]
          : [];
    if (allOwners.length > 0) {
      for (const owner of allOwners) {
        const touch = pathChangeTouch(
          info,
          change.path,
          "write",
          owner.lane,
          `${change.before} -> ${change.after}`,
        );
        touch.lens = owner.lens;
        touches.push(touch);
      }
    } else {
      // A run-branch move that is exactly the coachman's logged applies, in
      // order, is the coachman's own fix, not an unexplained change. Tied
      // lanes keep their findings; anything unlogged reads as before.
      const isTicket = refName === ticketRef || exactPath === ticketWorktree;
      if (isTicket && moveExplained(info.repo, applies, change.before, change.after)) continue;
      const humanPath = displayPath(info, change.path);
      const detail = `${change.before} -> ${change.after}`;
      const touch = pathChangeTouch(info, change.path, "read", "", `unexplained change ${detail}`);
      touch.kind = "note";
      touch.detail = `unexplained ${humanPath}: ${detail}`;
      touches.push(touch);
      if (change.tracked) unassignedTracked = true;
    }
  }
  return { touches, unassignedTracked };
}

function eventOf(touch: Touch, point: string): ReachEvent {
  if (touch.kind === "expected") throw new Error("expected lane access is not a reach event");
  return {
    kind: touch.kind,
    point,
    ...(touch.lane ? { lane: touch.lane } : {}),
    ...(touch.lens ? { lens: touch.lens } : {}),
    access: touch.access,
    place: touch.place,
    path: touch.path,
    ...(touch.user !== undefined ? { user: touch.user } : {}),
    ...(touch.detail ? { reason: touch.detail } : {}),
  };
}

function writeAction(
  info: RunInfo,
  actor: string,
  action: string,
  target: string,
  detail: string,
): void {
  const result = run(RUN, ["log-action", info.dispatch, actor, action, target, detail]);
  if (result.code !== 0)
    throw new Error(`log-action failed: ${result.err.trim() || result.out.trim()}`);
}

function writeRunLog(info: RunInfo, value: string): void {
  const result = run(RUN, ["run-log", info.dispatch, value]);
  if (result.code !== 0)
    throw new Error(`run-log failed: ${result.err.trim() || result.out.trim()}`);
}

function laneStatusEvents(reads: LaneRead[], point: string): ReachEvent[] {
  const events: ReachEvent[] = [];
  for (const read of reads) {
    if (read.status === "not checked") {
      events.push({
        kind: "note",
        point,
        lane: read.lane,
        lens: read.lens,
        path: read.events,
        reason: `not checked: ${read.reason}`,
      });
    }
    for (const touch of read.touches) {
      if (touch.kind === "expected") continue;
      events.push(eventOf(touch, point));
    }
  }
  return events;
}

function logPoint(
  info: RunInfo,
  point: string,
  reads: LaneRead[],
  touches: Touch[],
  result: ReturnType<typeof reachTarget>,
): { status: string; code: number } {
  const all = [
    ...laneStatusEvents(reads, point),
    ...touches.filter((touch) => touch.source !== "stream").map((touch) => eventOf(touch, point)),
  ];
  const hasFinding = all.some((event) => event.kind === "finding");
  const hasNote = all.some((event) => event.kind === "note");
  const notChecked = reads.some((read) => read.status === "not checked");
  const status = hasFinding ? "finding" : hasNote || notChecked ? "note" : "clean";
  writeAction(
    info,
    "coachman",
    "reach",
    point,
    JSON.stringify({
      kind: "point",
      point,
      result: status,
      main: {
        branch: result.branch,
        defaultBranch: result.defaultBranch,
        head: result.head,
        changed: result.changed,
        offDefault: result.offDefault,
      },
      lanes: reads.map((read) => ({
        lane: read.lane,
        lens: read.lens ?? "",
        harness: read.harness,
        status: read.status,
        reason: read.reason ?? "",
      })),
    }),
  );
  for (const event of all) {
    const actor = event.lane ? `lane:${event.lane}` : "coachman";
    writeAction(info, actor, "reach", point, JSON.stringify(event));
  }
  for (const touch of all) {
    console.log(
      `${touch.kind} ${touch.lane || "main checkout"}${touch.lens ? ` ${touch.lens}` : ""}: ${touch.access ?? "change"} ${touch.path ?? ""}${touch.place ? ` (${touch.place})` : ""}${touch.reason ? ` · ${touch.reason}` : ""}`,
    );
  }
  console.log(`${point}: ${status}`);
  const anyUnknown = notChecked || hasNote;
  return { status, code: hasFinding || result.code === 2 ? 2 : anyUnknown ? 3 : 0 };
}

function checkWorkhorses(info: RunInfo): number {
  const lanes = expectedWorkhorseNames(info);
  const reads = lanes.map((lane) =>
    readLane(
      info,
      lane,
      workhorseEvents(info, lane),
      join(info.repo, ".worktrees", `${info.ticket}-${lane}`),
    ),
  );
  const touches = aggregateLaneReads(reads);
  const { result } = addMainChanges(info, "workhorses", touches, true);
  const outcome = logPoint(info, "workhorses", reads, touches, result);
  return outcome.code;
}

function checkRound(info: RunInfo, round: number): number {
  // Reads only: a detached synthesis worktree is reported, never a fault.
  assertSynth(info, false);
  const reviewers = reviewersFor(info, round);
  const reads = reviewers.map(([lens, lane]) =>
    readLane(
      info,
      lane,
      reviewerEvents(info, round, lens, lane),
      roundOwnFolder(info, lens, lane),
      lens,
    ),
  );
  const touches = aggregateLaneReads(reads);
  for (const touch of touches.filter((entry) => entry.kind === "finding")) {
    touch.user = !runOwnedWrite(info, touch.path);
  }
  const snapshot = loadSnapshot(info, round);
  const changes = roundChanges(info, round, snapshot, reads);
  touches.push(...changes.touches);
  const { result } = addMainChanges(info, `r${round}`, touches, false);

  const voided = new Set<string>();
  // A reviewer's verdict is voided when an observed change is tied to that
  // reviewer: a round finding, or a main checkout change naming them.
  for (const touch of touches) {
    if (touch.kind === "finding" && touch.lane) {
      voided.add(`${touch.lens ?? ""}\0${touch.lane}`);
    }
  }
  if (changes.unassignedTracked) {
    for (const [lens, lane] of reviewers) voided.add(`${lens}\0${lane}`);
  }
  for (const key of voided) {
    const [lens = "", lane = ""] = key.split("\0");
    const reason = changes.unassignedTracked ? "unexplained round change" : "reach";
    writeAction(info, "coachman", "degrade", lane, `${lens} r${round}: reach`);
    writeRunLog(info, `${lane} ${lens}: DEGRADED, reach`);
    const event: ReachEvent = { kind: "void", point: `r${round}`, lane, lens, reason };
    writeAction(info, `lane:${lane}`, "reach", `r${round}`, JSON.stringify(event));
    console.log(`voided verdict ${lens} ${lane} r${round}: ${reason}`);
  }
  for (const touch of touches) {
    if (touch.kind !== "finding") continue;
    touch.user = !runOwnedWrite(info, touch.path);
    if (touch.user && touch.lane) console.log(`escalate: ${touch.lane} ${touch.path}`);
  }
  const logged = logPoint(info, `r${round}`, reads, touches, result);
  return logged.code;
}

function runOwnedWrite(info: RunInfo, path: string): boolean {
  if (path.startsWith("refs/heads/")) {
    const branch = path.slice("refs/heads/".length);
    return branch === info.ticket || branch.startsWith(`wb/${info.ticket}-`);
  }
  if (!isAbsolute(path)) return false;
  const worktrees = join(info.repo, ".worktrees");
  if (!inside(path, worktrees)) return false;
  const name = relative(worktrees, path).split(sep)[0] ?? "";
  return name === info.ticket || name.startsWith(`${info.ticket}-`);
}

function checkCard(info: RunInfo): number {
  const touches: Touch[] = [];
  const { result } = addMainChanges(info, "card", touches, false);
  const outcome = logPoint(info, "card", [], touches, result);
  return outcome.code;
}

function refsMap(repo: string, ticket: string): Record<string, string> {
  return runRefs(repo, ticket);
}

function savePatch(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function ensureInside(parent: string, path: string): void {
  const absoluteParent = physical(parent);
  const absolutePath = resolve(path);
  const realParent = physical(dirname(absolutePath));
  if (!inside(absolutePath, resolve(parent)) || !inside(realParent, absoluteParent)) {
    throw new Error(`refusing to move a path outside ${parent}`);
  }
}

function pathExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function restoreRound(info: RunInfo, round: number): number {
  // The worktree must be verifiable, but it may be detached or switched: the
  // reattach below puts the recorded branch back.
  assertSynth(info, false);
  const snapshot = loadSnapshot(info, round);
  const saved = saveDir(info, round);
  mkdirSync(saved, { recursive: true });
  // The same rule as check: a move that is exactly the logged applies, in
  // order, is the coachman's own fix and is left as it is, never archived
  // as undone work. Everything else restores exactly as before.
  const applies = loggedApplies(info.repo, info.dispatch);
  const ticketRef = `refs/heads/${info.ticket}`;
  const nowRefs = refsMap(info.repo, info.ticket);
  const refExplained = moveExplained(
    info.repo,
    applies,
    snapshot.refs[ticketRef] ?? "",
    nowRefs[ticketRef] ?? "",
  );
  const changedRefs = new Set([...Object.keys(snapshot.refs), ...Object.keys(nowRefs)]);
  for (const ref of [...changedRefs].sort()) {
    const before = snapshot.refs[ref] ?? "";
    const after = nowRefs[ref] ?? "";
    if (before === after) continue;
    if (ref === ticketRef && refExplained) {
      console.log(
        `left an explained move in place: ${displayPath(info, ref)}: ${before} -> ${after}`,
      );
      continue;
    }
    const safe = ref.replace(/[^A-Za-z0-9._-]/gu, "_");
    const patch =
      before && after
        ? runGit(info.repo, ["diff", "--binary", before, after])
        : { code: 0, out: "" };
    if (patch.code !== 0) throw new Error(`cannot save branch diff for ${ref}`);
    savePatch(join(saved, "branches", `${safe}.patch`), patch.out);
    savePatch(
      join(saved, "branches", `${safe}.json`),
      `${JSON.stringify({ ref, before: before || null, after: after || null }, null, 2)}\n`,
    );
  }

  const synth = synthesisPath(info);
  const currentHead = currentHeadForRestore(info.repo, synth);
  const synthExplained = moveExplained(info.repo, applies, snapshot.synthesisHead, currentHead);
  if (synthExplained) {
    console.log(
      `left an explained move in place: ${displayPath(info, synth)}: ${snapshot.synthesisHead} -> ${currentHead}`,
    );
  }
  const tracked = runGit(synth, ["diff", "--binary", "HEAD"]);
  if (tracked.code !== 0)
    throw new Error(`cannot save synthesis worktree diff: ${tracked.err.trim()}`);
  const commitPatch =
    synthExplained || snapshot.synthesisHead === currentHead
      ? ""
      : runGit(info.repo, ["diff", "--binary", snapshot.synthesisHead, currentHead]).out;
  savePatch(join(saved, "synthesis.patch"), `${commitPatch}${tracked.out}`);
  savePatch(
    join(saved, "synthesis.json"),
    `${JSON.stringify({ before: snapshot.synthesisHead, after: currentHead }, null, 2)}\n`,
  );

  // Move new synthesis files into the run before the reattach, so nothing
  // already saved can block it.
  const beforeFiles = new Set(Object.keys(snapshot.synthesisStatus));
  const afterFiles = statusMap(info.repo, synth);
  for (const path of Object.keys(afterFiles)) {
    if (beforeFiles.has(path) || afterFiles[path] !== "??") continue;
    const source = join(synth, path);
    const destination = join(saved, path);
    ensureInside(synth, source);
    ensureInside(saved, destination);
    if (pathExists(destination))
      throw new Error(`reach restore copy already exists: ${destination}`);
    mkdirSync(dirname(destination), { recursive: true });
    renameSync(source, destination);
  }

  // Restore the checked-out ticket branch through its worktree first, then restore the other
  // run branches by ref. Reviewers can move a branch with update-ref from any scratch, and can
  // detach or switch the worktree: the checkout reattaches the recorded branch either way.
  const recorded = snapshot.synthesisBranch ?? info.ticket;
  const anchor = refExplained
    ? (nowRefs[ticketRef] ?? "")
    : (snapshot.refs[ticketRef] ?? snapshot.synthesisHead);
  const reattach = runGit(synth, ["checkout", "-f", "-B", recorded, anchor]);
  if (reattach.code !== 0)
    throw new Error(`cannot restore synthesis branch: ${reattach.err.trim()}`);
  for (const ref of [...changedRefs].sort()) {
    if (ref === `refs/heads/${info.ticket}`) continue;
    const before = snapshot.refs[ref] ?? "";
    const after = nowRefs[ref] ?? "";
    if (before === after) continue;
    const branch = ref.replace(/^refs\/heads\//u, "");
    const prefix = `wb/${info.ticket}-`;
    const lane = branch.startsWith(prefix) ? branch.slice(prefix.length) : "";
    const worktree = lane ? join(info.repo, ".worktrees", `${info.ticket}-${lane}`) : "";
    if (before && !after) {
      // The ref is gone but the worktree still names the branch, and its
      // diff against HEAD fails. Put the ref back before reading the tree.
      const update = runGit(info.repo, ["update-ref", ref, before]);
      if (update.code !== 0) throw new Error(`cannot restore deleted ${ref}: ${update.err.trim()}`);
    }
    if (before && worktree && existsSync(worktree) && branchName(info.repo, worktree) === branch) {
      const safe = ref.replace(/[^A-Za-z0-9._-]/gu, "_");
      const dirt = runGit(worktree, ["diff", "HEAD"]);
      if (dirt.code !== 0) throw new Error(`cannot save ${ref} worktree diff: ${dirt.err.trim()}`);
      if (dirt.out) savePatch(join(saved, "branches", `${safe}.worktree.patch`), dirt.out);
      const move = runGit(worktree, ["reset", "--hard", before]);
      if (move.code !== 0) throw new Error(`cannot restore ${ref}: ${move.err.trim()}`);
    } else if (before) {
      const update = runGit(info.repo, ["update-ref", ref, before]);
      if (update.code !== 0) throw new Error(`cannot restore ${ref}: ${update.err.trim()}`);
    } else {
      const remove = runGit(info.repo, ["update-ref", "-d", ref]);
      if (remove.code !== 0)
        throw new Error(`cannot remove new run branch ${ref}: ${remove.err.trim()}`);
    }
  }

  console.log(`restored r${round}; saved changes under ${saved}`);
  return 0;
}

function currentHeadForRestore(repo: string, where: string): string {
  return currentHead(repo, where);
}

/** The round reach step the runbook runs before any fix: check, then restore
 * unless the check faulted. A faulted check (exit 1) stops before restore;
 * any other check exit restores, and the step exits with restore's code. */
function roundStep(info: RunInfo, round: number): number {
  const checked = checkRound(info, round);
  if (checked === 1) return 1;
  return restoreRound(info, round);
}

function pointFromAction(line: string, index: number): { actor: string; event: ReachEvent } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line) as unknown;
  } catch {
    throw new Error(`actions.jsonl line ${index} is not JSON`);
  }
  const row = rec(parsed);
  if (row.action !== "reach") throw new Error(`actions.jsonl line ${index} is not a reach action`);
  let detail: unknown;
  try {
    detail = JSON.parse(text(row.detail)) as unknown;
  } catch {
    throw new Error(`actions.jsonl line ${index} has an unreadable reach detail`);
  }
  return { actor: text(row.actor), event: rec(detail) as ReachEvent };
}

export function reachActions(dispatch: string): Array<{ actor: string; event: ReachEvent }> {
  const path = join(dispatch, "actions.jsonl");
  let contents: string;
  try {
    contents = readFileSync(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error(`cannot read ${path}: ${String(e)}`);
  }
  const out: Array<{ actor: string; event: ReachEvent }> = [];
  let i = 0;
  for (const line of contents.split(/\r?\n/u)) {
    if (!line) continue;
    i++;
    let row: RecordOf;
    try {
      row = JSON.parse(line) as RecordOf;
    } catch {
      throw new Error(`actions.jsonl line ${i} is not JSON`);
    }
    if (row.action === "reach") out.push(pointFromAction(line, i));
  }
  return out;
}

function usage(): never {
  console.error(
    "usage: reach.ts stream <dispatch> <lane> <events> <own-folder> | before <dispatch> <round> | check <dispatch> workhorses|r<round>|card | restore <dispatch> r<round>",
  );
  process.exit(1);
}

function main(argv: string[]): number {
  try {
    const command = argv[0];
    if (command === "stream") {
      if (argv.length !== 5) usage();
      const info = loadRun(argv[1]!);
      return readStreamMode(info, argv[2]!, argv[3]!, argv[4]!);
    }
    if (command === "before") {
      if (argv.length !== 3 || !/^[1-9][0-9]*$/u.test(argv[2]!)) usage();
      return saveSnapshot(loadRun(argv[1]!), Number(argv[2]));
    }
    if (command === "check") {
      if (argv.length !== 3) usage();
      const info = loadRun(argv[1]!);
      if (argv[2] === "workhorses") return checkWorkhorses(info);
      if (argv[2] === "card") return checkCard(info);
      const round = /^r([1-9][0-9]*)$/u.exec(argv[2]!);
      if (round) return checkRound(info, Number(round[1]));
      usage();
    }
    if (command === "restore") {
      if (argv.length !== 3) usage();
      const info = loadRun(argv[1]!);
      const round = /^r([1-9][0-9]*)$/u.exec(argv[2]!);
      if (!round) usage();
      return restoreRound(info, Number(round[1]));
    }
    if (command === "round") {
      if (argv.length !== 3) usage();
      const info = loadRun(argv[1]!);
      const round = /^r([1-9][0-9]*)$/u.exec(argv[2]!);
      if (!round) usage();
      return roundStep(info, Number(round[1]));
    }
    usage();
  } catch (e) {
    console.error(`reach: ${String(e)}`);
    return 1;
  }
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
