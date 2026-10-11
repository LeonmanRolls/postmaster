// The session host: where a launch runs and how the user watches it. Herdr wherever a Herdr
// server answers, tmux where it does not, and a detached background process with neither.
// skills/postmaster/hosts.md records each form per host; this script is their executable
// form, and the two change together.
//
//   run host detect                        herdr, tmux or none, on stdout
//   run host name <dispatch>               the run's ticket name, cut to 30 characters
//   run host name <dispatch> coachman <leg-name> <leg-number>
//   run host name <dispatch> workhorse <lane>
//   run host name <dispatch> review <lane> <lens> <round>
//   run host name <dispatch> postmaster
//   run host name <dispatch> role <text...>                          any other launch, by its role alone
//   run host run-state [--watch] <dispatch>   the ticket, stage and wait, for the run tab's
//                                         state pane; --watch reprints every 60 seconds
//   run host leg launch|takeover <dispatch> <worktree> <leg> <number> <prompt>
//   run host leg resume <dispatch> <worktree> <leg> <number> <thread-id> <prompt>
//   run host leg retry <dispatch> <worktree> <leg> <number>
//   run host leg outcome <dispatch> <number>
//   run host leg backfill <dispatch> <leg> <number>
//   run host leg waiting add|remove|list <runs> <ticket> [<question-file>]
//   run host run <name> <cwd> [--under <dispatch>] [--role lane|coachman|reviewer] [--run <dispatch>]
//               [--project <repo>] [--out <file>] [--err <file>] [--append] [--marker <file>]
//               [--pidfile <file>] -- <command...>
//   run host workhorse <dispatch> <lane> <worktree>
//                                         launch one workhorse into its worktree: its name from
//                                         `name ... workhorse`, its events/err/marker under the
//                                         dispatch's logs, `run launch launch` with --run
//   run host stop-pidfile <pidfile>        stop the recorded launch and its group while its
//                                         identity matches, else report the leftover members
//   run host limits [--role lane|coachman|reviewer] [--run <dispatch>|--project <repo>]
//                                         print the launch limits that would apply:
//                                         memory=<max> and tasks=<max>
//   run host stop <worktree>               stop every launch still running in a worktree, and
//                                         everything each one started
//   run host close <worktree>              close its panes/tabs/space (Herdr) and its windows (tmux)
//   run host stop-run <dispatch>           stop launches in every worktree the run created,
//                                         and at a fixture copy's root
//   run host close-run <dispatch>          close the run tab and every worktree's panes/windows,
//                                         and for a fixture copy the copy's own space too
//   run host spawn <handle> <cwd> [--label <text>] -- <command...>   an interactive session;
//                                         the handle becomes a Herdr agent name
//   run host send <handle> <file> [--wait [<seconds>]]   submit the file's text to that session,
//                                         and with --wait block until it settles (default 600)
//   run host wait <handle> [<seconds>]     block until it settles, when nothing was just sent
//   run host read <handle> [<lines>]       print what it shows (default 120 lines)
//   run host close-handle <handle>         close every session recorded under the handle, on each
//                                         host that answers; a spawned session from before this
//                                         form exists closes by hand
//   run host --live-test                   the ticket's controls, against the hosts on this machine
//
// run: <command> is the same headless command a caller would otherwise background with `&`. It
// runs from the directory run host was called in, with the caller's environment except for
// Claude Code session identity and caller Herdr variables, and an empty stdin, in a session of
// its own with no terminal; its stdout goes to --out, added to with
// --append, and its stderr to --err, which holds only this launch's errors. --marker is removed
// as it starts and touched when it exits,
// whatever its exit, and also when run host cannot start it, with the reason in --err. --pidfile
// gets its pid, which is also its process group, with the start, boot and command that prove
// it: stop-pidfile stops all of it while that identity matches, else reports the leftover
// members. <cwd> is the directory the launch belongs to, usually its worktree: in Herdr the
// launch runs in a new pane of the run's one tab in the repository's space; in tmux in a
// window of session postmaster-<repo>; with no host, detached from
// the caller. A run launch's <cwd>, including a reviewer's scratch clone, is its pane's working
// directory: a pane's working directory is its own. In tmux a scratch clone joins
// the session of the repository it was cut from. <name> labels the pane and its title, and
// names the thread where the harness can (POSTMASTER_LAUNCH_NAME, read by run launch).
// If --out is set, its absolute path also reaches run launch as POSTMASTER_EVENT_STREAM so that a
// run can retain the harness's durable session beside that event stream. For a run launch,
// --role reaches a run's run launch command as POSTMASTER_LAUNCH_ROLE; it is the explicit role
// used in its usage record, and is removed before the harness starts.
// Pass a role-specific `run host name` result as the launch name and pass the dispatch separately,
// so the ticket title labels only the run tab and never passes through a shell. A pane shows
// the stream through run view-stream. A launch carries its own pane's identity (Herdr's six
// HERDR_* pane values, or TMUX_PANE), never its caller's. It drops caller HERDR_* and Claude
// session identity: CLAUDECODE, CLAUDE_PID, CLAUDE_CODE_SESSION_ID,
// CLAUDE_CODE_CHILD_SESSION, CLAUDE_CODE_ENTRYPOINT, CLAUDE_CODE_EXECPATH,
// CLAUDE_CODE_SESSION_ATTENDED, CLAUDE_CODE_MESSAGING_SOCKET,
// CLAUDE_CODE_MESSAGING_TOKEN, CLAUDE_CODE_TOOL_USE_ID, and the
// CLAUDE_CODE_SESSION_*, CLAUDE_CODE_MESSAGING_* and CLAUDE_CODE_CHILD_*
// families. Add an exact identity name or family
// to runLaunch's filter and its test controls; keep unrelated CLAUDE_CODE_* configuration.
// If the host cannot place it, it runs in the background. On Linux with a working systemd user
// manager, the command and its descendants run in a transient scope with MemoryMax,
// MemorySwapMax=0 and TasksMax;
// otherwise it runs uncapped and records that in --err. While it runs it is registered under
// POSTMASTER_HOST_STATE (default ~/.postmaster/host), whatever its host, so stop and close see it.
// The record names its group leader by start time and boot, so a pid another process reuses,
// after a reboot or within one, is never taken for the launch.
//
// stop: a launch's processes are its process group and everything they started, whatever session
// that moved to, as a harness that runs each tool command in a session of its own does. They are
// found by process id and parent, never by a command line; frozen first, so nothing forks
// between the listing and the signal; sent TERM; and sent KILL if still there after
// POSTMASTER_HOST_STOP_WAIT seconds. The process that ran stop, and those above it, never are.
// Before it signals anything it checks the whole set, and refuses, leaving everything running,
// if the set holds a systemd manager, the Herdr server or a Herdr client, the moshi-hook daemon,
// code-server, the tmux server, sshd, a process that is neither in a verified launch's group nor
// descended from one, or more than POSTMASTER_HOST_STOP_MAX processes.
//
// POSTMASTER_HOST=herdr|tmux|none overrides detection; nothing needs setting to get the default.
// POSTMASTER_HOST_CLAIM_WAIT (20) is how long a new pane has to start its launch,
// POSTMASTER_HOST_CLOSE_WAIT (15) how long close waits for a launch that is just ending, and
// POSTMASTER_HOST_FINISH_DELAY (0.2) lets the pane finish rendering after its marker lands,
// POSTMASTER_HOST_STOP_WAIT (20) how long stop waits after TERM before it sends KILL, and
// POSTMASTER_HOST_STOP_MAX (512) the most processes one stop may signal.
//
//   exit 0  detected, named, started, stopped, closed, sent, settled or read
//   exit 1  usage, or nothing could be started
//   exit 2  close refused: a launch still runs in the worktree, or an affected pane or space
//           holds something run host did not open; or stop left something of a launch running,
//           named, or refused a set of processes it could not vouch for, saying why
//   exit 3  spawn, send, wait or read with no host that keeps an interactive session; or a send
//           or wait that did not settle, stopped at an approval or a question, or showed no turn
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  accessSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { clerkSessionPath } from "./clerk.ts";
import { parseTomlText } from "./lib/data.ts";
import { effectiveConfigForProject, globalConfigPath } from "./lib/effective-config.ts";
import { scriptsDir, toolRoot } from "./lib/paths.ts";
import { mkstempSync, run, signalExitCode } from "./lib/proc.ts";
import {
  bootId,
  processCommandLine,
  processCommandLines,
  processInfo,
  processIsLive,
  processStart,
  processState,
  processTable as sharedProcessTable,
  sameBoot,
} from "./lib/processes.ts";
import {
  BOUND_L,
  BOUND_R,
  END_OF_STRING,
  PY_DOT,
  PY_S_CLASS,
  casefold,
  pySplitLines,
  pyTrim,
  pyWords,
} from "./lib/text.ts";

const HERE = scriptsDir(import.meta);
const TOOL = toolRoot(import.meta);
const SOURCE = "custom:postmaster";
const META = "custom:postmaster-meta";
let STATE = process.env.POSTMASTER_HOST_STATE ?? join(homedir(), ".postmaster", "host");
const PANE_IDS = ["HERDR_PANE_ID", "HERDR_TAB_ID", "HERDR_WORKSPACE_ID", "TMUX_PANE"];
// Caller session identity, stripped where every run launch crosses into its own environment:
// the exact Claude names plus the session-identity families. Other CLAUDE_CODE_* names
// configure the harness and pass through, as do all non-identity caller variables.
const CLAUDE_IDENTITY = new Set([
  "CLAUDECODE",
  "CLAUDE_PID",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_SESSION_ATTENDED",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_CODE_TOOL_USE_ID",
]);
const CLAUDE_IDENTITY_FAMILIES = [
  "CLAUDE_CODE_SESSION_",
  "CLAUDE_CODE_MESSAGING_",
  "CLAUDE_CODE_CHILD_",
];
function isCallerIdentity(key: string): boolean {
  if (key.startsWith("HERDR_") || CLAUDE_IDENTITY.has(key)) return true;
  return CLAUDE_IDENTITY_FAMILIES.some((family) => key.startsWith(family));
}
let PLACE_ENV: string[] = [];

const HOST_ERROR = Symbol("host-error");
type HostError = Error & { [HOST_ERROR]: number };
function hostError(message: string, code = 1): HostError {
  return Object.assign(new Error(message), { [HOST_ERROR]: code });
}
function isHostError(error: unknown): error is HostError {
  return (
    error instanceof Error && typeof (error as { [HOST_ERROR]?: unknown })[HOST_ERROR] === "number"
  );
}
function hostCode(error: HostError): number {
  return error[HOST_ERROR];
}
function die(message: string, code = 1): never {
  throw hostError(message, code);
}
function warn(message: string): void {
  console.error(`host: ${message}`);
}
function which(program: string): string {
  for (const path of (process.env.PATH ?? "").split(":")) {
    const candidate = join(path || ".", program);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // not executable here
    }
  }
  return "";
}
function has(program: string): boolean {
  return which(program) !== "";
}
function hasOwn(obj: object, key: string): boolean {
  return Object.hasOwn(obj, key);
}
function limit(seconds: number, program: string, args: string[] = []) {
  // timeout(1) where it exists; otherwise run()'s own millisecond timeout, so
  // a program that never answers cannot hold a launch or a close forever on a
  // system without coreutils.
  return has("timeout")
    ? run("timeout", [String(seconds), program, ...args])
    : run(program, args, { timeout: seconds * 1000 });
}
function clean(value: string): string {
  return [...value]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join("");
}
// The run level shows the ticket number and the start of its title, in 30
// characters at most: the phone's sidebar is narrow, and the number finds
// the rest. Launch names stay whole.
const RUN_NAME_LIMIT = 30;
function shortName(value: string): string {
  return [...value].slice(0, RUN_NAME_LIMIT).join("");
}
function count(value: string | undefined, what: string): number {
  if (value === undefined || !/^[0-9]+$/u.test(value))
    die(`${what} must be a whole number, not '${String(value ?? "")}'`);
  const result = Number(value);
  if (!Number.isSafeInteger(result)) die(`${what} must be a whole number, not '${value}'`);
  return result;
}
function quote(value: string): string {
  return `'${value.replace(/'/gu, "'\\''")}'`;
}
// Shapes of the Herdr CLI's JSON replies, per call site.
interface HerdrReply {
  result?: unknown;
  error?: { code?: unknown };
}
interface HerdrTokens {
  postmaster?: unknown;
  state?: unknown;
}
interface HerdrSpace {
  workspace_id?: unknown;
  worktree?: unknown;
  tokens?: HerdrTokens;
}
interface HerdrPane {
  pane_id?: unknown;
  tab_id?: unknown;
  tokens?: HerdrTokens;
}
interface HerdrPlaced {
  workspace?: HerdrSpace;
  tab?: { tab_id?: unknown };
  root_pane?: { pane_id?: unknown };
}

function parseJson<T = HerdrReply>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
function jsonValue(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}
function _jsonStdout(text: string, expression: (data: HerdrReply | null) => unknown): string {
  const value = parseJson(text);
  return value === null ? "" : jsonValue(expression(value));
}
function herdrUp(): boolean {
  return has("herdr") && limit(5, "herdr", ["workspace", "list"]).code === 0;
}
function detect(): string {
  const forced = process.env.POSTMASTER_HOST ?? "";
  if (forced === "none") return "none";
  if (!["", "auto", "herdr", "tmux"].includes(forced))
    warn(`POSTMASTER_HOST=${forced} is not herdr, tmux, none or auto; detecting`);
  if (forced === "tmux") {
    if (has("tmux")) return "tmux";
    warn("POSTMASTER_HOST=tmux, but tmux is not on PATH; detecting");
  }
  if (herdrUp()) return "herdr";
  if (forced === "herdr") warn("POSTMASTER_HOST=herdr, but no Herdr server answers; detecting");
  return has("tmux") ? "tmux" : "none";
}
function cloneOrigin(path: string): string {
  const result = run(join(HERE, "run"), ["cut-scratch", "--kind", path]);
  return result.code === 0 && result.out.startsWith("clone ") ? result.out.trim().slice(6) : "";
}
function repoOf(path: string): string {
  const clone = cloneOrigin(path);
  if (clone) return clone;
  const result = run("git", [
    "-C",
    path,
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ]);
  if (result.code !== 0) return "";
  const common = result.out.trim();
  return common.endsWith("/.git") ? dirname(common) : common;
}
function tmuxSession(path: string): string {
  const repo = repoOf(path) || path;
  return `postmaster-${basename(repo).replace(/[.:]/gu, "_")}`;
}
// A fixture copy: made by run fixture new for one run, marked with
// .postmaster/fixture and postmaster.fixture in its local git config.
export function isFixtureRepo(root: string): boolean {
  if (!root) return false;
  try {
    if (statSync(join(root, ".postmaster", "fixture")).isFile()) return true;
  } catch {}
  const result = run("git", ["-C", root, "config", "--local", "--get", "postmaster.fixture"]);
  return result.code === 0 && result.out.trim() !== "";
}
// The repository a run's synthesis worktree stands in, "" when the waybill
// names none: the same guards runWorktreePaths applies to the same path.
function dispatchRepo(givenDispatch: string): string {
  const dispatch = realpathLoose(givenDispatch);
  const synthesis = dispatchInfo(dispatch).worktree;
  if (!synthesis) return "";
  const synth = realpathLoose(synthesis);
  if (basename(dirname(synth)) !== ".worktrees") return "";
  return dirname(dirname(synth));
}
function handleOf(text: string): string {
  // Byte for byte the way BASE's tr sees it: tr folds ASCII case and replaces
  // every other BYTE, so one non-ASCII character becomes several dashes.
  let handle = "";
  for (const b of new TextEncoder().encode(text)) {
    const lower = b >= 0x41 && b <= 0x5a ? b + 0x20 : b;
    const kept =
      (lower >= 0x61 && lower <= 0x7a) ||
      (lower >= 0x30 && lower <= 0x39) ||
      lower === 0x5f ||
      lower === 0x2d;
    handle += kept ? String.fromCharCode(lower) : "-";
  }
  if (!/^[a-z]/u.test(handle)) handle = `p${handle}`;
  if (handle.length > 32) {
    // ASCII: cksum prints CRC and size as ASCII digits; the first field is the checksum.
    const crc = run("cksum", [], { input: text }).out.split(/\s+/u, 1)[0] ?? "0";
    handle = `${handle.slice(0, 23)}-${Number(crc).toString(16).padStart(8, "0")}`;
  }
  return handle;
}
// text.ts: BASE re.sub(r"\s{2,}\(.*\)$", "", line[5:]).strip() (host.sh:142).
const NOTE_STRIP = new RegExp("[" + PY_S_CLASS + "]{2,}\\(" + PY_DOT + "*\\)" + END_OF_STRING, "u");

export function dispatchInfo(dispatch: string): { name: string; worktree: string } {
  let lines: string[] = [];
  try {
    lines = pySplitLines(readFileSync(join(dispatch, "brief.md"), "utf8"));
  } catch {}
  let name = "";
  let worktree = "";
  let inDispatch = false;
  for (const line of lines) {
    if (line.startsWith("## ")) inDispatch = pyTrim(line) === "## Dispatch";
    else if (inDispatch && line.startsWith("name:"))
      name = pyTrim(line.slice(5).replace(NOTE_STRIP, ""));
    else if (inDispatch && line.startsWith("synthesis worktree:"))
      worktree = pyTrim(line.slice(line.indexOf(":") + 1));
  }
  return { name, worktree };
}

// CPython's default int<->str digit cap: past it int() raises, and main refuses the number.
const INT_CONVERT_LIMIT = 4300;
const WHOLE_NUMBER = new RegExp("^[0-9]+" + END_OF_STRING, "u");
const LEGACY_REVIEW = new RegExp(
  "^([^" + PY_S_CLASS + "]+) (style|bug|security) review" + END_OF_STRING,
  "u",
);
const REVIEW_ROUND_FILE = new RegExp("^review-r([0-9]+)\\.json" + END_OF_STRING, "u");
const HERDR_TAB_ID = new RegExp("^w[A-Za-z0-9]+:t[0-9A-Za-z]+" + END_OF_STRING, "u");
const PATH_COMPONENT = new RegExp("^[A-Za-z0-9._-]+$", "u");
const LENS_WORD = new RegExp(BOUND_L + "(style|bug|security)" + BOUND_R, "u");

function isPathComponent(value: unknown): boolean {
  return (
    typeof value === "string" &&
    value !== "" &&
    value !== "." &&
    value !== ".." &&
    PATH_COMPONENT.test(value)
  );
}

// Stores are third-party text: anything not a mapping is no store at all.
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nameCmd(dispatch: string, ...args: string[]): string {
  if (!dispatch)
    die(
      "usage: run host name <dispatch> [coachman <leg-name> <leg-number> | workhorse <lane> | review <lane> <lens> <round> | postmaster | role <text...>]",
    );
  let brief: string[] = [];
  try {
    brief = pySplitLines(readFileSync(join(dispatch, "brief.md"), "utf8"));
  } catch {}
  let ticket = "";
  let inDispatch = false;
  for (const line of brief) {
    if (line.startsWith("## ")) inDispatch = pyTrim(line) === "## Dispatch";
    else if (inDispatch && line.startsWith("name:")) {
      ticket = pyTrim(line.slice(5).replace(NOTE_STRIP, ""));
      break;
    }
  }
  ticket = ticket || basename(dispatch);
  if (!args.length) return shortName(clean(ticket));
  let runStore: unknown = {};
  try {
    runStore = JSON.parse(readFileSync(join(dispatch, "run.json"), "utf8"));
  } catch {
    runStore = {};
  }
  const config = asRecord(asRecord(runStore).config);
  const lanes = asRecord(config.lanes);
  const team = asRecord(config.team);
  // A model id as a label part: the provider prefix never tells launches apart.
  const shown = (model: unknown): string => String(model).split("/").pop() ?? "";
  const needManifestLeg = (): number => {
    let raw: unknown = 0;
    try {
      raw = asRecord(JSON.parse(readFileSync(join(dispatch, "manifest.json"), "utf8"))).leg ?? 0;
    } catch {
      die("cannot resolve the coachman leg from manifest.json");
    }
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1)
      die("cannot resolve the coachman leg from manifest.json");
    return raw;
  };
  const needLaneModel = (lane: string, role: string): Record<string, unknown> => {
    const spec: unknown = hasOwn(lanes, lane) ? lanes[lane] : undefined;
    if (
      typeof spec !== "object" ||
      spec === null ||
      Array.isArray(spec) ||
      !(spec as Record<string, unknown>)["model"]
    )
      die(`no recorded model for ${role} lane ${lane}`);
    return spec as Record<string, unknown>;
  };
  const needCoachmanModel = (legName: string): Record<string, unknown> => {
    const legs = asRecord(team.coachman_legs);
    const spec: unknown = (hasOwn(legs, legName) ? legs[legName] : undefined) || team.coachman;
    if (
      typeof spec !== "object" ||
      spec === null ||
      Array.isArray(spec) ||
      !(spec as Record<string, unknown>)["model"]
    )
      die(`no recorded model for coachman leg ${legName}`);
    return spec as Record<string, unknown>;
  };
  const needLens = (lens: string): string => {
    if (lens !== "style" && lens !== "bug" && lens !== "security")
      die("review lens must be style, bug or security");
    return lens;
  };
  const turnpikeLegs = (): string[][] => {
    const legs = run(join(HERE, "run"), ["turnpikes", "legs", dispatch]);
    if (legs.code !== 0) return [];
    return pySplitLines(legs.out).map((line) => pyWords(line));
  };
  const needLegName = (name: string): string => {
    if (!name) die("coachman leg name must not be empty");
    const known = new Set<string>();
    for (const fields of turnpikeLegs()) if (fields.length > 1) known.add(fields[1]!);
    if (!known.has(name)) die(`unknown coachman leg ${name}`);
    return name;
  };
  const needLegNumber = (text: string): bigint => {
    if (!WHOLE_NUMBER.test(text) || text.length > INT_CONVERT_LIMIT)
      die("coachman leg number must be a whole number");
    const n = BigInt(text);
    if (n < 1n) die("coachman leg number must be 1 or more");
    return n;
  };
  const needRound = (text: string): bigint => {
    if (!WHOLE_NUMBER.test(text) || text.length > INT_CONVERT_LIMIT)
      die("review round must be a whole number");
    const n = BigInt(text);
    if (n < 1n) die("review round must be 1 or more");
    let isFile = false;
    try {
      isFile = statSync(join(dispatch, "logs", `review-r${n}.json`)).isFile();
    } catch {}
    if (!isFile) die(`unknown review round ${n}`);
    return n;
  };
  if (args.length === 1 && args[0] === "coachman") {
    const n = needManifestLeg();
    let legName = "";
    for (const fields of turnpikeLegs()) {
      if (fields.length > 1 && fields[0] === String(n)) {
        legName = fields[1]!;
        break;
      }
    }
    if (!legName) die(`cannot resolve leg ${n} from the waybill's turnpikes`);
    // Resolved names re-validate below; the second listing is cheap and keeps the invariant total.
    args = ["coachman", legName, String(n)];
  } else if (args.length === 1 && hasOwn(lanes, args[0]!)) {
    const lane = args[0]!;
    const workhorses = team.workhorses;
    args = Array.isArray(workhorses) && workhorses.includes(lane) ? ["workhorse", lane] : args;
  } else if (args.length === 1) {
    const legacy = LEGACY_REVIEW.exec(args[0]!);
    if (legacy) {
      const lane = legacy[1]!;
      const lens = legacy[2]!;
      const rounds: bigint[] = [];
      try {
        for (const file of readdirSync(join(dispatch, "logs"))) {
          const match = REVIEW_ROUND_FILE.exec(file);
          if (match) rounds.push(BigInt(match[1]!));
        }
      } catch {}
      const top = rounds.length ? rounds.reduce((a, b) => (a > b ? a : b)) : 1n;
      args = ["review", lane, lens, top.toString()];
    }
  }
  const mode = args[0]!;
  let parts: string[] = [];
  if (mode === "postmaster" && args.length === 1) parts = ["postmaster"];
  else if (mode === "coachman" && args.length === 3) {
    const legName = needLegName(args[1]!);
    const legInt = needLegNumber(args[2]!);
    parts = ["coachman", shown(needCoachmanModel(legName).model), `leg ${legInt}`];
  } else if (mode === "workhorse" && args.length === 2)
    parts = [args[1]!, "workhorse", shown(needLaneModel(args[1]!, "workhorse").model)];
  else if (mode === "review" && args.length === 4) {
    const lane = args[1]!;
    const spec = needLaneModel(lane, "reviewer");
    parts = [lane, `${needLens(args[2]!)} review`, shown(spec.model), `r${needRound(args[3]!)}`];
  } else if (mode === "role" && args.length >= 2) parts = args.slice(1);
  else die("invalid launch identity; use coachman, workhorse, review, postmaster or role");
  return clean(parts.join(" · "));
}

// What the run tab's state pane shows while no lane runs: the ticket, the
// stage and what the run waits for, read from the run's records. It writes
// nothing. With --watch it reprints every 60 seconds, for the pane.
function runStateWaiting(dispatch: string, stage: string, pending: string[]): string {
  switch (stage) {
    case "dispatched":
    case "bootstrapped":
      return "the run to start";
    case "workhorses-running":
      return pending.length
        ? pending.map((lane) => `workhorse ${lane}`).join(", ")
        : "the coachman to synthesize";
    case "synthesis":
      return "the coachman to compose the synthesis";
    case "checkpoint-1":
      return "the next leg to start";
    case "review": {
      const rounds: bigint[] = [];
      try {
        for (const file of readdirSync(join(dispatch, "logs"))) {
          const match = REVIEW_ROUND_FILE.exec(file);
          if (match) rounds.push(BigInt(match[1]!));
        }
      } catch {}
      if (!rounds.length) return "the review loop";
      return `review round ${rounds.reduce((a, b) => (a > b ? a : b))}`;
    }
    case "shipping":
      return "landing";
    case "shipped":
    case "done":
    case "abandoned":
      return "nothing — the run is complete";
    default:
      return "unknown — the run's records name no stage run host knows";
  }
}

function runStateLines(dispatch: string): string[] {
  const info = dispatchInfo(dispatch);
  const name = clean(info.name || basename(dispatch));
  let stage = "unknown";
  let leg = "";
  let pending: string[] = [];
  try {
    const manifest = JSON.parse(readFileSync(join(dispatch, "manifest.json"), "utf8")) as Record<
      string,
      unknown
    > | null;
    if (manifest && typeof manifest === "object" && !Array.isArray(manifest)) {
      if (typeof manifest.stage === "string" && manifest.stage) stage = manifest.stage;
      if (typeof manifest.leg === "number" && Number.isInteger(manifest.leg))
        leg = ` · leg ${manifest.leg}`;
      const lanes = asRecord(manifest.lanes);
      pending = Object.keys(lanes)
        .filter((lane) => {
          const outcome = asRecord(lanes[lane]).outcome;
          return typeof outcome !== "string" || !outcome;
        })
        .sort();
    }
  } catch {}
  return [
    name,
    `stage: ${stage}${leg}`,
    `waiting on: ${runStateWaiting(dispatch, stage, pending)}`,
    `as of ${new Date().toISOString()}`,
  ];
}

async function runStateCmd(args: string[]): Promise<void> {
  let watch = false;
  const rest: string[] = [];
  for (const arg of args) {
    if (arg === "--watch") watch = true;
    else rest.push(arg);
  }
  if (rest.length !== 1 || !rest[0]) die("usage: run host run-state [--watch] <dispatch>");
  const dispatch = rest[0]!;
  for (;;) {
    for (const line of runStateLines(dispatch)) console.log(line);
    if (!watch) return;
    console.log("");
    await Bun.sleep(60000);
  }
}

type ProcessInfo = { group: number; start: string };
type Registry = {
  dir: string;
  name: string;
  start: string;
  boot: string;
  members: Array<[number, string]>;
};
function runBoot(...args: string[]): string {
  return run(args[0]!, args.slice(1), { env: { LC_ALL: "C" } }).out.trim();
}

function bootTime(): number | null {
  try {
    const text = readFileSync("/proc/stat", "utf8");
    const line = text.split("\n").find((row: string) => row.startsWith("btime "));
    // ASCII: /proc/stat btime is kernel-emitted ASCII.
    if (line) return Number(line.split(/\s+/u)[1]);
  } catch {}
  // ASCII: sysctl kern.boottime is kernel-emitted ASCII on macOS.
  const words = runBoot("sysctl", "-n", "kern.boottime").replace(/,/gu, " ").split(/\s+/u);
  // `{ sec = <t>, ... }`: the value sits two words past `sec`, as main reads it.
  const at = words.indexOf("sec");
  if (at < 0 || at + 2 >= words.length) return null;
  const seconds = Number(words[at + 2]);
  return Number.isInteger(seconds) ? seconds : null;
}
function startOf(pid: number): string {
  return processStart(pid) ?? "";
}
export function processes(): Map<number, ProcessInfo> {
  const table = new Map<number, ProcessInfo>();
  for (const [pid, info] of sharedProcessTable()) {
    if (info.state === "live" && info.start)
      table.set(pid, { group: info.group, start: info.start });
  }
  return table;
}
function asciiLower(value: string): string {
  return value.replace(/[A-Z]/gu, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
}
// time.strptime(start, "%a %b %d %H:%M:%S %Y") in the C locale, as main parses a ps lstart.
const LSTART_PATTERN = new RegExp(
  "^([A-Za-z]+) ([A-Za-z]+) +([0-9]+) ([0-9]+):([0-9]+):([0-9]+) +([0-9]+)" + END_OF_STRING,
  "u",
);
const WEEKDAYS = new Set(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
const MONTHS = new Map(
  ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].map(
    (name, index) => [name, index],
  ),
);
function parseLstart(start: string): number | null {
  const match = LSTART_PATTERN.exec(start);
  if (!match) return null;
  if (!WEEKDAYS.has(asciiLower(match[1]!))) return null;
  const month = MONTHS.get(asciiLower(match[2]!));
  if (month === undefined) return null;
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const year = Number(match[7]);
  if (day < 1 || day > 31 || hour > 23 || minute > 59 || second > 61 || year < 1 || year > 9999)
    return null;
  const date = new Date(year, month, day, hour, minute, second);
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day)
    return null;
  return date.getTime() / 1000;
}
function startedAt(start: string): number | null {
  if (/^[0-9]+$/u.test(start)) {
    const booted = bootTime();
    const hz = Number(run("getconf", ["CLK_TCK"], { env: { LC_ALL: "C" } }).out.trim()) || 100;
    return booted === null ? null : booted + Number(start) / hz;
  }
  return parseLstart(start);
}
function registryDir(): string {
  return join(STATE, "launches");
}
function recordPath(group: number): string {
  return join(registryDir(), String(group));
}
function loadRecord(path: string): Registry | null {
  try {
    const lines = readFileSync(path, "utf8").split("\n");
    const rec: Registry = {
      dir: lines[0] ?? "",
      name: lines[1] ?? "",
      start: "",
      boot: "",
      members: [],
    };
    for (const line of lines.slice(2)) {
      const at = line.indexOf(" ");
      if (at < 0) continue;
      const key = line.slice(0, at);
      const value = line.slice(at + 1);
      if (key === "start") rec.start = value;
      else if (key === "boot") rec.boot = value;
      else if (key === "member") {
        const separator = value.indexOf(" ");
        const pid = separator < 0 ? value : value.slice(0, separator);
        const start = separator < 0 ? "" : value.slice(separator + 1);
        if (/^[0-9]+$/u.test(pid ?? "") && start) rec.members.push([Number(pid), start]);
      }
    }
    return rec;
  } catch {
    return null;
  }
}
function saveRecord(path: string, rec: Registry): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = mkstempSync(dirname(path), "tmp");
  const body =
    rec.dir +
    "\n" +
    rec.name +
    "\nstart " +
    rec.start +
    "\nboot " +
    rec.boot +
    "\n" +
    rec.members.map(([pid, start]) => `member ${pid} ${start}\n`).join("");
  writeFileSync(temp, body, { mode: 0o600 });
  renameSync(temp, path);
}
function recordRoots(
  path: string,
  group: number,
  rec: Registry,
  procs: Map<number, ProcessInfo>,
  boot: string,
): string[] {
  if (!rec.start && !rec.boot) {
    const booted = bootTime();
    let written = 0;
    try {
      written = statSync(path).mtimeMs / 1000;
    } catch {
      return [];
    }
    if (!procs.has(group) || booted === null || written < booted) return [];
    const began = startedAt(procs.get(group)!.start);
    if (began === null || began > written + 2) return [];
    rec.start = procs.get(group)!.start;
    rec.boot = boot;
    saveRecord(path, rec);
  }
  if (!rec.boot || !sameBoot(rec.boot, boot)) return [];
  if (procs.has(group) && rec.start && procs.get(group)!.start === rec.start)
    return [`group|${group}|${rec.start}`];
  return rec.members
    .filter(([pid, start]) => procs.has(pid) && procs.get(pid)!.start === start)
    .map(([pid, start]) => `tree|${pid}|${start}`);
}
function fixtureGuard(): void {
  const fixture = process.env.POSTMASTER_HOST_FIXTURE;
  if (!fixture) return;
  if (resolve(STATE).startsWith(resolve(fixture) + sep)) return;
  warn(`refusing the registry at ${STATE}: a test uses only its fixture, ${fixture}`);
  throw hostError("registry is outside the test fixture", 1);
}
function registryAdd(group: number, dir: string, name: string): void {
  fixtureGuard();
  const rec: Registry = { dir, name, start: startOf(group), boot: bootId(), members: [] };
  saveRecord(recordPath(group), rec);
}
function registryMembers(group: number): void {
  fixtureGuard();
  const path = recordPath(group);
  const rec = loadRecord(path);
  if (!rec) return;
  rec.members = [...processes()]
    .filter(([, value]) => value.group === group)
    .map(([pid, value]): [number, string] => [pid, value.start])
    .sort((a, b) => a[0] - b[0]);
  if (rec.members.length) saveRecord(path, rec);
  else rmSync(path, { force: true });
}
function registryScan(dir: string): Array<{ group: string; name: string; roots: string[] }> {
  fixtureGuard();
  const procs = processes();
  const boot = bootId();
  let names: string[] = [];
  try {
    names = readdirSync(registryDir()).sort();
  } catch {}
  const found: Array<{ group: string; name: string; roots: string[] }> = [];
  for (const name of names) {
    if (!/^[0-9]+$/u.test(name)) continue;
    const path = join(registryDir(), name);
    const rec = loadRecord(path);
    if (!rec) continue;
    const roots = recordRoots(path, Number(name), rec, procs, boot);
    if (!roots.length) rmSync(path, { force: true });
    else if (rec.dir === dir) found.push({ group: name, name: rec.name, roots });
  }
  return found;
}
function herdr(args: string[], timeout = 0) {
  return timeout ? limit(timeout, "herdr", args) : run("herdr", args);
}
function herdrData(args: string[]): { agent?: { agent_status?: unknown } } | null {
  const result = herdr(args);
  return result.code === 0
    ? ((parseJson(result.out)?.result ?? null) as { agent?: { agent_status?: unknown } } | null)
    : null;
}
function herdrPlace(
  name: string,
  cwd: string,
  where = "worktree",
  dispatch = "",
  handle = "",
): { space: string; tab: string; pane: string } | null {
  const rootResult = run("git", ["-C", cwd, "rev-parse", "--show-toplevel"]);
  const top = rootResult.code === 0 ? resolve(rootResult.out.trim()) : "";
  let source = "";
  let root = "";
  let repoName = "";
  let worktreePath = "";
  let worktreeKind = "";
  let open = "";
  const listed = top ? herdr(["worktree", "list", "--cwd", cwd]) : null;
  if (listed?.code === 0) {
    try {
      const data = parseJson<{ result?: Record<string, unknown> }>(listed.out)?.result;
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("bad list");
      const src = (data.source ?? {}) as Record<string, unknown>;
      if (typeof src !== "object" || src === null || Array.isArray(src))
        throw new Error("bad list");
      const rows = data.worktrees ?? [];
      if (!Array.isArray(rows)) throw new Error("bad list");
      source = jsonValue(src.source_workspace_id);
      root = jsonValue(src.repo_root);
      repoName = jsonValue(src.repo_name);
      for (const entry of rows) {
        if (!entry || typeof entry !== "object" || typeof entry.path !== "string")
          throw new Error("bad list");
        if (resolve(entry.path) === top) {
          worktreePath = jsonValue(entry.path);
          worktreeKind = entry.is_linked_worktree ? "linked" : "main";
          open = jsonValue(entry.open_workspace_id);
          break;
        }
      }
    } catch {
      // Main's parser failing reads as no checkout Herdr can place: a space of its own.
      source = "";
      root = "";
      repoName = "";
      worktreePath = "";
      worktreeKind = "";
      open = "";
    }
  }
  // A fixture copy's launches join its one tab in the postmaster project's
  // space: the copy never gets a space of its own.
  if (isFixtureRepo(root)) return herdrFixturePlace(name, cwd, root, dispatch, "", handle);
  if (!root || !worktreePath || (!open && top && cloneOrigin(top))) {
    const response = herdr([
      "workspace",
      "create",
      "--cwd",
      cwd,
      "--label",
      name,
      "--no-focus",
      ...PLACE_ENV,
    ]);
    if (response.code !== 0) return null;
    const data = parseJson<{ result?: HerdrPlaced }>(response.out)?.result;
    const space = jsonValue(data?.workspace?.workspace_id);
    const tab = jsonValue(data?.tab?.tab_id);
    const pane = jsonValue(data?.root_pane?.pane_id);
    if (!space || !tab || !pane) return null;
    herdr([
      "workspace",
      "report-metadata",
      space,
      "--source",
      META,
      "--token",
      "postmaster=opened",
    ]);
    herdr([
      "pane",
      "report-metadata",
      pane,
      "--source",
      META,
      "--title",
      name,
      "--token",
      "postmaster=launch",
    ]);
    return { space, tab, pane };
  }
  let opened = false;
  let space = "";
  let tab = "";
  let pane = "";
  if (!source) {
    const response = herdr([
      "workspace",
      "create",
      "--cwd",
      root,
      "--label",
      repoName,
      "--no-focus",
      ...PLACE_ENV,
    ]);
    if (response.code !== 0) return null;
    const created = parseJson<{ result?: HerdrPlaced }>(response.out)?.result;
    source = jsonValue(created?.workspace?.workspace_id);
    // This is the first pane of the project space. Use it for a project-level launch such as
    // the postmaster, instead of leaving an empty shell beside the launch tab.
    if (where === "repo" || worktreeKind === "main") {
      tab = jsonValue(created?.tab?.tab_id);
      pane = jsonValue(created?.root_pane?.pane_id);
    }
  }
  if (where === "repo" || worktreeKind === "main") space = source;
  else if (open) space = open;
  else {
    const response = herdr([
      "worktree",
      "open",
      "--workspace",
      source,
      "--path",
      worktreePath,
      "--label",
      name,
      "--no-focus",
    ]);
    if (response.code !== 0) return null;
    const data = parseJson<{ result?: HerdrPlaced }>(response.out)?.result;
    space = jsonValue(data?.workspace?.workspace_id);
    tab = jsonValue(data?.tab?.tab_id);
    pane = jsonValue(data?.root_pane?.pane_id);
    if (tab) herdr(["tab", "rename", tab, name]);
    opened = true;
  }
  if (!pane) {
    const response = herdr([
      "tab",
      "create",
      "--workspace",
      space,
      "--cwd",
      cwd,
      "--label",
      name,
      "--no-focus",
      ...PLACE_ENV,
    ]);
    if (response.code !== 0) return null;
    const data = parseJson<{ result?: HerdrPlaced }>(response.out)?.result;
    tab = jsonValue(data?.tab?.tab_id);
    pane = jsonValue(data?.root_pane?.pane_id);
  }
  if (!space || !tab || !pane) return null;
  if (opened)
    herdr([
      "workspace",
      "report-metadata",
      space,
      "--source",
      META,
      "--token",
      "postmaster=opened",
    ]);
  herdr(["tab", "rename", tab, name]);
  herdr([
    "pane",
    "report-metadata",
    pane,
    "--source",
    META,
    "--title",
    name,
    "--token",
    "postmaster=launch",
  ]);
  if (!herdrRecordPlacement(space, tab, pane, cwd, dispatch, handle)) {
    // The pane was tagged but never ran the launch. Keep the ownership token
    // alongside its settled state so a later close can safely remove it.
    herdr([
      "pane",
      "report-metadata",
      pane,
      "--source",
      META,
      "--token",
      "postmaster=launch",
      "--token",
      "state=done",
    ]);
    return null;
  }
  return { space, tab, pane };
}

function realpathLoose(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

// Remember the panes this host opens: each launch of a run has its own pane in
// the run's one tab, and each spawned session its own tab. A later
// `close <worktree>` can then close that checkout's panes without closing a
// tab it shares or one opened by the user. The record is keyed by pane,
// which is unique per launch; the tab is shared.
function herdrRecordPlacement(
  space: string,
  tab: string,
  pane: string,
  cwd: string,
  dispatch: string,
  handle = "",
): boolean {
  const directory = join(STATE, "placements");
  try {
    mkdirSync(directory, { recursive: true });
  } catch {
    return false;
  }
  let temporary = "";
  try {
    temporary = mkstempSync(directory, ".placement-");
    writeFileSync(
      temporary,
      `${JSON.stringify({ workspace: space, tab, pane, cwd: realpathLoose(cwd), run: dispatch ? realpathLoose(dispatch) : "", ...(handle ? { handle } : {}) })}\n`,
    );
    renameSync(
      temporary,
      join(directory, `${createHash("sha256").update(pane).digest("hex")}.json`),
    );
    return true;
  } catch {
    if (temporary) markerRemove(temporary);
    return false;
  }
}

// One run tab per run: the tab a run's launches share in the repository's
// space, found again across launches and legs through this record. It lives
// apart from the launch placements: it outlives every launch, from the run's
// first placement to close-run, while each launch placement goes with its
// launch. The state pane is the tab's first pane; it shows the run's state
// and keeps the tab listed between launches.
function runTabDir(): string {
  return join(STATE, "runtabs");
}
function runTabPath(dispatch: string): string {
  return join(
    runTabDir(),
    `${createHash("sha256").update(realpathLoose(dispatch)).digest("hex")}.json`,
  );
}
function readRunTab(dispatch: string): { workspace: string; tab: string; pane: string } | null {
  let item: unknown;
  try {
    item = JSON.parse(readFileSync(runTabPath(dispatch), "utf8"));
  } catch {
    return null;
  }
  if (typeof item !== "object" || item === null || Array.isArray(item)) return null;
  const rec = item as Record<string, unknown>;
  if (
    typeof rec.workspace !== "string" ||
    typeof rec.tab !== "string" ||
    typeof rec.pane !== "string"
  )
    return null;
  if (!rec.workspace || !rec.tab || !rec.pane) return null;
  return { workspace: rec.workspace, tab: rec.tab, pane: rec.pane };
}
function writeRunTab(dispatch: string, workspace: string, tab: string, pane: string): boolean {
  const directory = runTabDir();
  try {
    mkdirSync(directory, { recursive: true });
  } catch {
    return false;
  }
  let temporary = "";
  try {
    temporary = mkstempSync(directory, ".runtab-");
    writeFileSync(
      temporary,
      `${JSON.stringify({ workspace, tab, pane, run: realpathLoose(dispatch) })}\n`,
    );
    renameSync(temporary, runTabPath(dispatch));
    return true;
  } catch {
    if (temporary) markerRemove(temporary);
    return false;
  }
}
function removeRunTab(dispatch: string): void {
  markerRemove(runTabPath(dispatch));
}
function runTabById(tab: string): boolean {
  for (const directory of [runTabDir(), fixTabDir()]) {
    let files: string[] = [];
    try {
      files = readdirSync(directory).filter((entry) => entry.endsWith(".json"));
    } catch {
      continue;
    }
    for (const file of files) {
      try {
        const item = JSON.parse(readFileSync(join(directory, file), "utf8")) as Record<
          string,
          unknown
        > | null;
        if (item && typeof item === "object" && !Array.isArray(item) && item.tab === tab)
          return true;
      } catch {}
    }
  }
  return false;
}

// A fixture copy's one tab in the postmaster project's space, labelled for the
// fixture: the copy's folder name with the word that marks it, in the run
// level's 30 characters.
function fixtureLabel(copyRoot: string): string {
  return shortName(clean(`fixture · ${basename(copyRoot)}`));
}

// One fixture tab per copy: the tab the copy's own launches and its run's
// launches share, found again across launches through this record, keyed by
// the copy's root rather than a dispatch the copy's launches never carry. The
// flag says a run launch has started the run-state loop in the tab's first
// pane, so a second adoption never starts a second loop.
interface FixTab {
  workspace: string;
  tab: string;
  pane: string;
  stateloop: boolean;
}
function fixTabDir(): string {
  return join(STATE, "fixtabs");
}
function fixTabPath(copyRoot: string): string {
  return join(
    fixTabDir(),
    `${createHash("sha256").update(realpathLoose(copyRoot)).digest("hex")}.json`,
  );
}
function readFixTab(copyRoot: string): FixTab | null {
  let item: unknown;
  try {
    item = JSON.parse(readFileSync(fixTabPath(copyRoot), "utf8"));
  } catch {
    return null;
  }
  if (typeof item !== "object" || item === null || Array.isArray(item)) return null;
  const rec = item as Record<string, unknown>;
  if (
    typeof rec.workspace !== "string" ||
    typeof rec.tab !== "string" ||
    typeof rec.pane !== "string"
  )
    return null;
  if (!rec.workspace || !rec.tab || !rec.pane) return null;
  return {
    workspace: rec.workspace,
    tab: rec.tab,
    pane: rec.pane,
    stateloop: rec.stateloop === true,
  };
}
function writeFixTab(
  copyRoot: string,
  workspace: string,
  tab: string,
  pane: string,
  stateloop: boolean,
): boolean {
  const directory = fixTabDir();
  try {
    mkdirSync(directory, { recursive: true });
  } catch {
    return false;
  }
  let temporary = "";
  try {
    temporary = mkstempSync(directory, ".fixtab-");
    writeFileSync(
      temporary,
      `${JSON.stringify({ workspace, tab, pane, root: realpathLoose(copyRoot), stateloop })}\n`,
    );
    renameSync(temporary, fixTabPath(copyRoot));
    return true;
  } catch {
    if (temporary) markerRemove(temporary);
    return false;
  }
}
function removeFixTab(copyRoot: string): void {
  markerRemove(fixTabPath(copyRoot));
}
// The first launch of a run creates its tab. Launches start one at a time,
// so this lock is belt and braces for two shells racing: a mkdir lock, stale
// after 30 seconds, since a holder this slow already failed its placement.
// The holder stamps its pid and start time inside; a contender evicts only a
// stale lock whose owner is gone, never a live holder, however slow its Herdr
// calls, and releases only a lock it still owns. On a timeout the launch runs
// in the background instead of risking a second tab.
function readRunTabLockOwner(lock: string): { pid: number; start: string } | null {
  let lines: string[];
  try {
    lines = readFileSync(join(lock, "owner"), "utf8").split("\n");
  } catch {
    return null;
  }
  const pid = Number(lines[0]?.trim() ?? "");
  if (!Number.isInteger(pid) || pid <= 0) return null;
  return { pid, start: (lines[1] ?? "").trim() };
}
export function runTabLockOwnerAlive(lock: string): boolean {
  const owner = readRunTabLockOwner(lock);
  if (!owner) return false;
  if (!processIsLive(owner.pid)) return false;
  if (!owner.start) return true;
  return processStart(owner.pid) === owner.start;
}
function withRunTabLock<T>(fn: () => T | null): T | null {
  const directory = runTabDir();
  try {
    mkdirSync(directory, { recursive: true });
  } catch {
    return null;
  }
  const lock = join(directory, ".lock");
  const me = process.pid;
  const deadline = Date.now() + 60000;
  for (;;) {
    try {
      mkdirSync(lock);
      try {
        writeFileSync(join(lock, "owner"), `${me}\n${processStart(me) ?? ""}\n`);
      } catch {
        rmSync(lock, { recursive: true, force: true });
        return null;
      }
      break;
    } catch {
      try {
        if (Date.now() - statSync(lock).mtimeMs > 30000 && !runTabLockOwnerAlive(lock)) {
          rmSync(lock, { recursive: true, force: true });
          continue;
        }
      } catch {}
      if (Date.now() > deadline) return null;
      sleepSync(50);
    }
  }
  try {
    return fn();
  } finally {
    try {
      if (readRunTabLockOwner(lock)?.pid === me) rmSync(lock, { recursive: true, force: true });
    } catch {}
  }
}

function rollbackRunTab(tab: string): void {
  if (herdr(["tab", "close", tab]).code !== 0)
    warn(`could not roll back run tab ${tab} after a failed placement; close it by hand`);
}

function rollbackLaunchPane(pane: string): void {
  if (herdr(["pane", "close", pane]).code !== 0)
    warn(`could not roll back launch pane ${pane} after a failed placement; close it by hand`);
}

function undash(value: unknown): string {
  if (!value) return "";
  const text = jsonValue(value);
  return text === "-" ? "" : text;
}

function herdrSpaceOpened(space: string): boolean {
  const info = herdr(["workspace", "get", space]);
  if (info.code !== 0) return false;
  return (
    _jsonStdout(
      info.out,
      (d) =>
        (d as { result?: { workspace?: HerdrSpace } } | null)?.result?.workspace?.tokens
          ?.postmaster,
    ) === "opened"
  );
}

function herdrSpaceGone(space: string): boolean {
  const list = herdr(["workspace", "list"]);
  if (list.code !== 0) return false;
  const data = parseJson<{ result?: { workspaces?: HerdrSpace[] } }>(list.out);
  if (data === null || typeof data !== "object" || Array.isArray(data)) return false;
  const result = data.result;
  if (result === null || typeof result !== "object" || Array.isArray(result)) return false;
  const workspaces = result.workspaces ?? [];
  if (!Array.isArray(workspaces)) return false;
  // BASE builds the id list first: any entry without .get fails the whole
  // check, so a non-mapping entry refuses rather than counting as absent.
  for (const entry of workspaces) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return false;
    if (entry.workspace_id === space) return false;
  }
  return true;
}

function tmuxWindowGone(window: string): boolean {
  const rows = run("tmux", ["list-windows", "-a", "-F", "#{window_id}\t#{window_name}"]);
  if (rows.code !== 0) {
    // A server that answers nothing holds no windows: tmux windows die with
    // their server, so this is proven, not assumed. A server that answers but
    // cannot list is unprovable, and the record stays for a retry.
    return run("tmux", ["ls"]).code !== 0;
  }
  for (const line of pySplitLines(rows.out)) {
    const tab = line.indexOf("\t");
    if ((tab < 0 ? line : line.slice(0, tab)) === window) return false;
  }
  return true;
}

function finishOwnership(panesText: string, target: string, tab: string): string {
  const rows = parseJson<{ result?: { panes?: HerdrPane[] } }>(panesText)?.result?.panes;
  if (!Array.isArray(rows)) throw new Error("bad panes");
  for (const row of rows) {
    if (row === null || typeof row !== "object" || Array.isArray(row)) throw new Error("bad panes");
  }
  const pane = rows.find((row) => row.pane_id === target) ?? null;
  if (pane === null) return "missing";
  if (tokensOf(pane).postmaster !== "launch") return "unowned";
  if (!HERDR_TAB_ID.test((pane.tab_id ?? "") as string) || pane.tab_id !== tab) return "pane";
  if (
    rows.some((row) => row.pane_id !== target && !HERDR_TAB_ID.test((row.tab_id ?? "") as string))
  )
    return "pane";
  if (rows.some((row) => row.pane_id !== target && row.tab_id === tab)) return "pane";
  return "tab";
}

function herdrFinishPlacement(space: string, tab: string, pane: string): number {
  const file = join(STATE, "placements", `${createHash("sha256").update(pane).digest("hex")}.json`);
  const panes = herdr(["pane", "list", "--workspace", space]);
  if (panes.code !== 0) {
    // A space the server says is gone was settled concurrently; anything
    // else is a dead server, and the record stays for a retry.
    if (herdrSpaceGone(space)) {
      markerRemove(file);
      return 0;
    }
    warn(`could not inspect completed launch pane ${pane} in space ${space}; left it open`);
    return 2;
  }
  let ownership = "";
  try {
    ownership = finishOwnership(panes.out, pane, tab);
  } catch {
    warn(`could not verify completed launch pane ${pane} in space ${space}; left it open`);
    return 2;
  }
  switch (ownership) {
    case "missing":
      break;
    case "unowned":
      warn(`completed launch pane ${pane} is no longer owned by run host; left it open`);
      return 2;
    case "pane":
      if (herdr(["pane", "close", pane]).code !== 0) {
        warn(`herdr could not close completed launch pane ${pane}; left it open`);
        return 2;
      }
      break;
    case "tab":
      // A run tab lives in the repository's space, which run host never
      // closes: a launch finishing as its tab's last pane still closes only
      // its pane, and the next launch rebuilds the tab if it went with it.
      if (!herdrSpaceOpened(space)) {
        if (!runTabById(tab)) {
          warn(
            `completed launch tab ${tab} is in space ${space}, which run host did not open; left it open`,
          );
          return 2;
        }
        if (herdr(["pane", "close", pane]).code !== 0) {
          warn(`herdr could not close completed launch pane ${pane}; left it open`);
          return 2;
        }
        break;
      }
      if (herdr(["tab", "close", tab]).code !== 0) {
        warn(`herdr could not close completed launch tab ${tab}; left it open`);
        return 2;
      }
      break;
    default:
      warn(`could not verify completed launch pane ${pane} in space ${space}; left it open`);
      return 2;
  }
  markerRemove(file);
  return 0;
}

function tmuxFinishPlacement(window: string, pane: string): number {
  const listed = run("tmux", [
    "list-panes",
    "-t",
    window,
    "-F",
    "#{pane_id}\t#{@postmaster_owned}",
  ]);
  if (listed.code !== 0) {
    // A window the server no longer lists was settled concurrently; anything
    // else is unprovable, and the window stays for a retry.
    if (tmuxWindowGone(window)) return 0;
    warn(`could not inspect completed tmux pane ${pane}; left it open`);
    return 2;
  }
  let total = 0;
  let present = false;
  let found = false;
  for (const line of pySplitLines(listed.out)) {
    const tab = line.indexOf("\t");
    const id = tab < 0 ? line : line.slice(0, tab);
    const owned = tab < 0 ? "" : line.slice(tab + 1);
    if (!id) continue;
    total++;
    if (id === pane) {
      present = true;
      if (owned === "yes") found = true;
    }
  }
  // The recorded pane is gone but the window stands: only panes run host did not
  // open remain, so this refuses like a split rather than reporting success.
  if (!present) {
    warn(`tmux window ${window} holds only panes run host did not open; left them open`);
    return 2;
  }
  if (!found) {
    warn(`completed tmux pane ${pane} is no longer owned by run host; left it open`);
    return 2;
  }
  if (total === 1) {
    if (run("tmux", ["kill-window", "-t", window]).code !== 0) {
      warn(`tmux could not close completed window ${window}; left it open`);
      return 2;
    }
  } else {
    if (run("tmux", ["kill-pane", "-t", pane]).code !== 0) {
      warn(`tmux could not close completed pane ${pane}; left it open`);
      return 2;
    }
    warn(`tmux window ${window} holds panes run host did not open; left them open`);
    return 2;
  }
  return 0;
}

function finishPriorHerdr(cwd: string, runPath: string): void {
  try {
    if (!statSync(join(STATE, "placements")).isDirectory()) return;
  } catch {
    return;
  }
  const patience = count(
    process.env.POSTMASTER_HOST_CLOSE_WAIT ?? "15",
    "POSTMASTER_HOST_CLOSE_WAIT",
  );
  for (let i = 0; ; i++) {
    const live = registryScan(cwd);
    if (!live.length) break;
    if (i >= patience) {
      warn(`a launch is still running in ${cwd}: ${live.map((item) => item.name).join(";")}`);
      throw hostError("", 2);
    }
    sleepSync(1000);
  }
  const runReal = realpathLoose(runPath);
  for (const file of placementFiles()) {
    let fields: string[] | null = null;
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) continue;
      const item = parsed as Record<string, unknown>;
      if (typeof item.cwd !== "string") continue;
      if (realpathLoose(item.cwd) !== realpathLoose(cwd) || item.run !== runReal) continue;
      fields = ["workspace", "tab", "pane"].map((key) => jsonValue(item[key]));
    } catch {
      continue;
    }
    if (!fields) continue;
    const [space, tab, pane] = fields as [string, string, string];
    if (!space || !tab || !pane) {
      warn(`invalid prior launch placement in ${file}; left it open`);
      throw hostError("", 2);
    }
    if (herdrFinishPlacement(space, tab, pane) !== 0) {
      const panes = herdr(["pane", "list", "--workspace", space]);
      if (panes.code === 0) {
        let present = false;
        try {
          const rows = parseJson<{ result?: { panes?: HerdrPane[] } }>(panes.out)?.result?.panes;
          present = Array.isArray(rows) && rows.some((row) => row?.pane_id === pane);
        } catch {
          present = false;
        }
        if (present) throw hostError("", 2);
        markerRemove(file);
      } else if (herdrSpaceGone(space)) {
        markerRemove(file);
      } else {
        throw hostError("", 2);
      }
    }
  }
}

function finishPriorTmux(cwd: string, runPath: string): void {
  const session = tmuxSession(cwd);
  if (run("tmux", ["has-session", "-t", `=${session}`]).code !== 0) return;
  const patience = count(
    process.env.POSTMASTER_HOST_CLOSE_WAIT ?? "15",
    "POSTMASTER_HOST_CLOSE_WAIT",
  );
  for (let i = 0; ; i++) {
    const live = registryScan(cwd);
    if (!live.length) break;
    if (i >= patience) {
      warn(`a launch is still running in ${cwd}: ${live.map((item) => item.name).join(";")}`);
      throw hostError("", 2);
    }
    sleepSync(1000);
  }
  const rows = run("tmux", [
    "list-windows",
    "-t",
    `=${session}`,
    "-F",
    "#{window_id}\t#{@postmaster_cwd}\t#{@postmaster_run}\t#{@postmaster_pane}",
  ]);
  if (rows.code !== 0) throw hostError("", 2);
  for (const line of pySplitLines(rows.out)) {
    const [window, oldcwd, oldrun, ...paneRest] = line.split("\t");
    const pane = paneRest.join("\t");
    if (oldcwd !== cwd || oldrun !== runPath) continue;
    if (!pane) {
      warn(`prior tmux window ${window} has no recorded launch pane; left it open`);
      throw hostError("", 2);
    }
    if (tmuxFinishPlacement(window, pane) !== 0) {
      const listed = run("tmux", ["list-panes", "-t", window, "-F", "#{pane_id}"]);
      if (listed.code === 0) {
        if (pySplitLines(listed.out).includes(pane)) throw hostError("", 2);
      } else if (!tmuxWindowGone(window)) {
        throw hostError("", 2);
      }
    }
  }
}

function finishPriorLaunch(host: string, cwd: string, runPath: string): void {
  if (host === "herdr") finishPriorHerdr(cwd, runPath);
  else if (host === "tmux") finishPriorTmux(cwd, runPath);
}

async function finishWait(
  host: string,
  space: string,
  tab: string,
  pane: string,
  _cwd: string,
  marker: string,
  delay: string,
): Promise<number> {
  while (!existsSync(marker)) await Bun.sleep(100);
  const parsed = Number(delay);
  const seconds = delay.trim() === "" || !Number.isFinite(parsed) ? 0.2 : Math.max(0, parsed);
  await Bun.sleep(seconds * 1000);
  if (host === "herdr") return herdrFinishPlacement(space, tab, pane);
  if (host === "tmux") return tmuxFinishPlacement(tab, pane);
  return 1;
}

function startFinishWatcher(
  host: string,
  space: string,
  tab: string,
  pane: string,
  cwd: string,
  marker: string,
): void {
  if (!marker) return;
  // BASE double-forks a python watcher that waits for the marker, sleeps the
  // finish delay, then execs back into _finish. The port's watcher is a
  // detached _finish-wait re-entry: the same wait, delay and finish, with its
  // pid beside the marker in the fixture's finishers file.
  const pid = startDetached([
    "_finish-wait",
    host,
    space,
    tab,
    pane,
    cwd,
    marker,
    process.env.POSTMASTER_HOST_FINISH_DELAY || "0.2",
  ]);
  const fixture = process.env.POSTMASTER_HOST_FIXTURE ?? "";
  if (fixture) {
    try {
      writeFileSync(join(fixture, "finishers"), `${pid}\t${marker}\n`, { flag: "a" });
    } catch {}
  }
}

function herdrRunPlace(
  name: string,
  cwd: string,
  dispatch: string,
): { space: string; tab: string; pane: string } | null {
  const info = dispatchInfo(dispatch);
  const runName = shortName(clean(info.name));
  const runPath = info.worktree;
  if (!runName || !runPath) return null;
  try {
    if (!statSync(runPath).isDirectory()) return null;
  } catch {
    return null;
  }
  // A fixture copy's run joins the copy's one tab in the postmaster project's
  // space, resolved through this tool's checkout rather than the copy.
  const copyRepo = dispatchRepo(dispatch);
  if (copyRepo && isFixtureRepo(copyRepo))
    return herdrFixturePlace(name, cwd, copyRepo, dispatch, runPath, "");
  const listed = herdr(["worktree", "list", "--cwd", runPath]);
  if (listed.code !== 0) return null;
  let source = "";
  let root = "";
  let repoName = "";
  try {
    const data = parseJson<{ result?: Record<string, unknown> }>(listed.out)?.result;
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("bad list");
    // Main reads d.get("source", {}): an explicit null is a failure, not an empty source.
    if (data.source === null) throw new Error("bad list");
    const src = (data.source ?? {}) as Record<string, unknown>;
    if (typeof src !== "object" || Array.isArray(src)) throw new Error("bad list");
    const rows = data.worktrees ?? [];
    if (!Array.isArray(rows)) throw new Error("bad list");
    for (const entry of rows) {
      if (!entry || typeof entry !== "object" || typeof entry.path !== "string")
        throw new Error("bad list");
    }
    source = undash(src.source_workspace_id);
    root = undash(src.repo_root);
    repoName = undash(src.repo_name);
  } catch {
    return null;
  }
  // A hand-shaped dispatch the waybill guard above could not place still joins
  // the fixture tab when the run stands in a fixture copy.
  if (isFixtureRepo(root)) return herdrFixturePlace(name, cwd, root, dispatch, runPath, "");
  if (!source) {
    if (!root || !repoName) return null;
    const response = herdr([
      "workspace",
      "create",
      "--cwd",
      root,
      "--label",
      repoName,
      "--no-focus",
    ]);
    if (response.code !== 0) return null;
    const created = parseJson<{ result?: HerdrPlaced }>(response.out)?.result;
    source = jsonValue(created?.workspace?.workspace_id);
  }
  if (!source) return null;
  // The run's one tab in the repository's space, shared by every launch of
  // the run: found again through the run tab record, created once under the
  // lock. A launch never opens a space or a tab of its own.
  const placed = withRunTabLock(() => {
    const current = readRunTab(dispatch);
    if (current && current.workspace === source) return current;
    return createRunTab(source, runName, runPath, dispatch);
  });
  if (!placed) return null;
  let tab = placed.tab;
  let anchor = placed.pane;
  let pane = splitRunPane(anchor, cwd);
  if (!pane) {
    // The recorded state pane may be gone (closed by hand): split off
    // another run pane in the tab when one is live, and rebuild the tab
    // when none is. Whatever fails here runs in the background.
    anchor = runTabAnchor(source, placed.tab, placed.pane);
    if (!anchor) {
      const recreated = withRunTabLock(() => {
        const current = readRunTab(dispatch);
        if (current && current.workspace === source && current.tab !== placed.tab) return current;
        return createRunTab(source, runName, runPath, dispatch);
      });
      if (!recreated) return null;
      tab = recreated.tab;
      anchor = recreated.pane;
    }
    pane = splitRunPane(anchor, cwd);
    if (!pane) return null;
  }
  return finishRunLaunch(source, tab, pane, name, cwd, dispatch);
}

// Open the run's tab in the repository's space. Its first pane shows the
// run's state while no lane runs and keeps the tab listed between launches;
// close-run takes it with the tab. A failure rolls the tab back, so a failed
// first placement leaves nothing a later close could refuse.
function createRunTab(
  source: string,
  runName: string,
  runPath: string,
  dispatch: string,
): { tab: string; pane: string } | null {
  const response = herdr([
    "tab",
    "create",
    "--workspace",
    source,
    "--cwd",
    runPath,
    "--label",
    runName,
    "--no-focus",
  ]);
  if (response.code !== 0) return null;
  const created = parseJson<{ result?: HerdrPlaced }>(response.out)?.result;
  const tab = jsonValue(created?.tab?.tab_id);
  const rootPane = jsonValue(created?.root_pane?.pane_id);
  if (!tab || !rootPane) return null;
  if (herdr(["pane", "rename", rootPane, runName]).code !== 0) {
    rollbackRunTab(tab);
    return null;
  }
  if (
    herdr([
      "pane",
      "report-metadata",
      rootPane,
      "--source",
      META,
      "--title",
      runName,
      "--token",
      "postmaster=launch",
      "--token",
      "role=runstate",
    ]).code !== 0
  ) {
    rollbackRunTab(tab);
    return null;
  }
  startStateLoop(rootPane, runPath, dispatch, tab);
  if (!writeRunTab(dispatch, source, tab, rootPane)) {
    rollbackRunTab(tab);
    return null;
  }
  return { tab, pane: rootPane };
}

// Split a launch pane off a pane of the run's tab. A pane's working
// directory is its own, so each launch keeps its own checkout. The split
// takes no focus: a launch starting must never steal the user's context.
// env carries --env pairs for the new pane; a run launch passes none.
function splitRunPane(anchor: string, cwd: string, env: string[] = []): string {
  const split = herdr([
    "pane",
    "split",
    anchor,
    "--direction",
    "down",
    "--cwd",
    cwd,
    ...env,
    "--no-focus",
  ]);
  if (split.code !== 0) return "";
  const result = parseJson<{ result?: { pane?: unknown } }>(split.out)?.result?.pane;
  if (typeof result === "string") return result;
  if (typeof result === "object" && result !== null)
    return jsonValue((result as Record<string, unknown>).pane_id);
  return "";
}

// A live pane of the run's tab to split off: the recorded state pane when it
// is live, else another pane run host opened there. Empty when the tab holds
// no run pane at all, so the caller rebuilds it; the recorded pane when the
// list cannot be read, for one retry on the same anchor.
function runTabAnchor(source: string, tab: string, preferred: string): string {
  const panes = herdr(["pane", "list", "--workspace", source]);
  if (panes.code !== 0) return preferred;
  let rows: HerdrPane[] | undefined;
  try {
    rows = parseJson<{ result?: { panes?: HerdrPane[] } }>(panes.out)?.result?.panes;
    if (!Array.isArray(rows)) throw new Error("bad panes");
    for (const row of rows) {
      if (row === null || typeof row !== "object" || Array.isArray(row))
        throw new Error("bad panes");
      tokensOf(row);
    }
  } catch {
    return preferred;
  }
  if (rows.some((row) => row.pane_id === preferred)) return preferred;
  return jsonValue(
    rows.find((row) => row.tab_id === tab && tokensOf(row).postmaster === "launch")?.pane_id,
  );
}

// Name a split launch pane and record it. An id-less split names nothing to
// roll back: without an id there is nothing to close, and sweeping untagged
// panes would risk a racing launch's.
function finishRunLaunch(
  space: string,
  tab: string,
  pane: string,
  name: string,
  cwd: string,
  dispatch: string,
  handle = "",
): { space: string; tab: string; pane: string } | null {
  if (!pane) return null;
  if (herdr(["pane", "rename", pane, name]).code !== 0) {
    rollbackLaunchPane(pane);
    return null;
  }
  if (
    herdr([
      "pane",
      "report-metadata",
      pane,
      "--source",
      META,
      "--title",
      name,
      "--token",
      "postmaster=launch",
    ]).code !== 0
  ) {
    rollbackLaunchPane(pane);
    return null;
  }
  // A placement the record refuses still shuts: its pane is tagged, so close
  // vouches for the tab without the record. A control pins it.
  if (!herdrRecordPlacement(space, tab, pane, cwd, dispatch, handle)) {
    // Placement will fall back to the background; this host-owned pane never
    // ran the launch, so label it settled for a later safe close.
    herdr([
      "pane",
      "report-metadata",
      pane,
      "--source",
      META,
      "--token",
      "postmaster=launch",
      "--token",
      "state=done",
    ]);
    return null;
  }
  return { space, tab, pane };
}

// The postmaster project's space: the repository this tool checkout stands in,
// through a worktree list at the checkout itself. Every launch of a fixture
// run flows through a checkout of that repository, so each resolves the same
// space. Opened when the repository has no space yet, like any repository's
// first launch; never tagged, since it is shared and close-run must leave it
// standing.
function fixtureProjectSpace(): string {
  const listed = herdr(["worktree", "list", "--cwd", TOOL]);
  if (listed.code !== 0) return "";
  let source = "";
  let root = "";
  let repoName = "";
  try {
    const data = parseJson<{ result?: Record<string, unknown> }>(listed.out)?.result;
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("bad list");
    // Main reads d.get("source", {}): an explicit null is a failure, not an empty source.
    if (data.source === null) throw new Error("bad list");
    const src = (data.source ?? {}) as Record<string, unknown>;
    if (typeof src !== "object" || Array.isArray(src)) throw new Error("bad list");
    source = undash(src.source_workspace_id);
    root = undash(src.repo_root);
    repoName = undash(src.repo_name);
  } catch {
    return "";
  }
  if (!source) {
    if (!root || !repoName) return "";
    const response = herdr([
      "workspace",
      "create",
      "--cwd",
      root,
      "--label",
      repoName,
      "--no-focus",
    ]);
    if (response.code !== 0) return "";
    const created = parseJson<{ result?: HerdrPlaced }>(response.out)?.result;
    source = jsonValue(created?.workspace?.workspace_id);
  }
  return source;
}

// Start the run-state loop in a tab's first pane: the pane shows the run's
// state while no lane runs. A pane that will not take it keeps the tab listed
// without the display; the launch still runs.
function startStateLoop(pane: string, runPath: string, dispatch: string, tab: string): void {
  // Through the isolated entry, never a bare Bun call: the pane starts in the
  // synthesis worktree, and a bare call would load that project's .env and
  // Bun config into this flow-owned loop.
  const loop = `cd -- ${quote(runPath)} && ${quote(join(HERE, "run"))} host run-state --watch ${quote(dispatch)}`;
  if (herdr(["pane", "run", pane, loop]).code !== 0)
    warn(`could not start the run state pane in tab ${tab}; leaving it at its prompt`);
}

// A run launch adopting a fixture tab starts the run-state loop in the tab's
// first pane and marks it a state pane, so a tab the copy's launches opened
// first ends identical to one a run launch opened. The record carries the
// flag, written before the loop starts, so a second adoption never starts a
// second loop. Both tokens go together: the stub replaces where the server
// merges, and the pane must keep its launch token either way.
function adoptStateLoop(
  current: FixTab,
  copyRoot: string,
  runPath: string,
  dispatch: string,
): void {
  if (!dispatch || !runPath || current.stateloop) return;
  if (!writeFixTab(copyRoot, current.workspace, current.tab, current.pane, true)) {
    warn(`could not record the run state loop for fixture tab ${current.tab}; leaving it holding`);
    return;
  }
  if (
    herdr([
      "pane",
      "report-metadata",
      current.pane,
      "--source",
      META,
      "--token",
      "postmaster=launch",
      "--token",
      "role=runstate",
    ]).code !== 0
  )
    warn(`could not mark fixture tab ${current.tab}'s first pane as the run state pane`);
  startStateLoop(current.pane, runPath, dispatch, current.tab);
}

// Open a fixture copy's one tab in the postmaster project's space. Its first
// pane holds the tab from the first launch, whatever kind that launch is. A
// failure rolls the tab back: it is brand new and unshared.
function createFixtureTab(
  source: string,
  copyRoot: string,
  dispatch: string,
  runPath: string,
): { tab: string; pane: string } | null {
  const label = fixtureLabel(copyRoot);
  const response = herdr([
    "tab",
    "create",
    "--workspace",
    source,
    "--cwd",
    runPath || copyRoot,
    "--label",
    label,
    "--no-focus",
  ]);
  if (response.code !== 0) return null;
  const created = parseJson<{ result?: HerdrPlaced }>(response.out)?.result;
  const tab = jsonValue(created?.tab?.tab_id);
  const holding = jsonValue(created?.root_pane?.pane_id);
  if (!tab || !holding) return null;
  if (herdr(["pane", "rename", holding, label]).code !== 0) {
    rollbackRunTab(tab);
    return null;
  }
  if (
    herdr([
      "pane",
      "report-metadata",
      holding,
      "--source",
      META,
      "--title",
      label,
      "--token",
      "postmaster=launch",
    ]).code !== 0
  ) {
    rollbackRunTab(tab);
    return null;
  }
  if (!writeFixTab(copyRoot, source, tab, holding, false)) {
    rollbackRunTab(tab);
    return null;
  }
  adoptStateLoop(
    { workspace: source, tab, pane: holding, stateloop: false },
    copyRoot,
    runPath,
    dispatch,
  );
  return { tab, pane: holding };
}

// Find a fixture copy's tab in the project space or open it, under the run tab
// lock: the copy's launches and the run's launches rendezvous here, whatever
// order they arrive in. A run launch also records the run's tab, so close-run
// and the state readers find it by dispatch; only a tab this call opened is
// ever rolled back, never a shared one.
function obtainFixtureTab(
  source: string,
  copyRoot: string,
  dispatch: string,
  runPath: string,
  excludeTab: string,
): { tab: string; pane: string } | null {
  const current = readFixTab(copyRoot);
  if (current && current.workspace === source && current.tab !== excludeTab) {
    adoptStateLoop(current, copyRoot, runPath, dispatch);
    if (dispatch && !writeRunTab(dispatch, source, current.tab, current.pane)) {
      warn(`could not record the run tab for fixture tab ${current.tab}; the launch still runs`);
      return null;
    }
    return current;
  }
  const created = createFixtureTab(source, copyRoot, dispatch, runPath);
  if (!created) return null;
  if (dispatch && !writeRunTab(dispatch, source, created.tab, created.pane)) {
    rollbackRunTab(created.tab);
    removeFixTab(copyRoot);
    return null;
  }
  return created;
}

// Place a launch of a fixture copy: the copy's postmaster, its watcher, or a
// launch of its run. Every one goes to the copy's one tab in the postmaster
// project's space, split off the tab's first pane or another live one, with
// its own checkout as the pane's working directory. dispatch is "" for the
// copy's own launches and the run for a run launch.
function herdrFixturePlace(
  name: string,
  cwd: string,
  copyRoot: string,
  dispatch: string,
  runPath: string,
  handle: string,
): { space: string; tab: string; pane: string } | null {
  const source = fixtureProjectSpace();
  if (!source) return null;
  const placed = withRunTabLock(() => obtainFixtureTab(source, copyRoot, dispatch, runPath, ""));
  if (!placed) return null;
  // The copy's own launches run with the caller POSTMASTER_* settings, as a
  // spawn's fresh tab would carry them; run launches take none, as the run
  // tab's splits never have.
  const env = dispatch ? [] : PLACE_ENV;
  let tab = placed.tab;
  let anchor = placed.pane;
  let pane = splitRunPane(anchor, cwd, env);
  if (!pane) {
    // The recorded first pane may be gone (closed by hand): split off
    // another run pane in the tab when one is live, and rebuild the tab
    // when none is. Whatever fails here runs in the background.
    anchor = runTabAnchor(source, placed.tab, placed.pane);
    if (!anchor) {
      const recreated = withRunTabLock(() =>
        obtainFixtureTab(source, copyRoot, dispatch, runPath, placed.tab),
      );
      if (!recreated) return null;
      tab = recreated.tab;
      anchor = recreated.pane;
    }
    pane = splitRunPane(anchor, cwd, env);
    if (!pane) return null;
  }
  return finishRunLaunch(source, tab, pane, name, cwd, dispatch, handle);
}
type Spec = {
  name: string;
  cwd: string;
  rundir: string;
  state: string;
  out: string;
  err: string;
  marker: string;
  pidfile: string;
  append: string;
  role: string;
  memory: string;
  tasks: string;
  capmode: string;
  systemd_run: string;
  systemctl: string;
  setsid: string;
  unit: string;
  argv: string[];
};
const SPEC_FIELDS = [
  "name",
  "cwd",
  "rundir",
  "state",
  "out",
  "err",
  "marker",
  "pidfile",
  "append",
  "role",
  "memory",
  "tasks",
  "capmode",
  "systemd_run",
  "systemctl",
  "setsid",
  "unit",
  "argv",
  "env",
];
function writeSpec(spec: string, fields: Spec): void {
  mkdirSync(spec, { recursive: true, mode: 0o700 });
  for (const name of SPEC_FIELDS.slice(0, -2))
    writeFileSync(join(spec, name), (fields as unknown as Record<string, string>)[name], {
      mode: 0o600,
    });
  writeFileSync(join(spec, "argv"), `${fields.argv.join("\0")}\0`, { mode: 0o600 });
}
function readSpec(spec: string): Spec {
  const get = (name: string) => readFileSync(join(spec, name), "utf8");
  // The writer joins argv with NUL and appends one; only that trailing empty
  // is framing. An empty argument in the middle is data, as read -d '' reads.
  const argvParts = get("argv").split("\0");
  if (argvParts.length > 0 && argvParts[argvParts.length - 1] === "") argvParts.pop();
  return {
    name: get("name"),
    cwd: get("cwd"),
    rundir: get("rundir"),
    state: get("state"),
    out: get("out"),
    err: get("err"),
    marker: get("marker"),
    pidfile: get("pidfile"),
    append: get("append"),
    role: get("role"),
    memory: get("memory"),
    tasks: get("tasks"),
    capmode: get("capmode"),
    systemd_run: get("systemd_run"),
    systemctl: get("systemctl"),
    setsid: get("setsid"),
    unit: get("unit"),
    argv: argvParts,
  };
}
function dropSpec(spec: string): void {
  for (const name of SPEC_FIELDS) {
    try {
      rmSync(join(spec, name), { force: true });
    } catch {}
  }
  try {
    rmSync(join(spec, "claimed"), { recursive: true, force: true });
    rmSync(spec, { recursive: true, force: true });
  } catch {}
}

function posixErrorName(error: unknown): string {
  const code = (error as { code?: string }).code;
  if (code === "ENOENT") return "FileNotFoundError";
  if (code === "EACCES") return "PermissionError";
  if (code === "EISDIR") return "IsADirectoryError";
  return "OSError";
}

function isRegularFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function readable(path: string): boolean {
  try {
    accessSync(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function processAlive(pid: number): boolean {
  return pid > 0 && processState(pid) === "live";
}

const MEMORY_MAX_PATTERN = new RegExp("^[1-9][0-9]*(?:K|M|G|T)" + END_OF_STRING, "u");

function launchLimits(
  role: string,
  dispatch: string,
  configPath: string,
  project = "",
): { memory: string; tasks: number } {
  const memoryDefault = "8G";
  const tasksDefault = 512;
  let config: unknown = {};
  if (dispatch) {
    let text: string;
    try {
      text = readFileSync(join(dispatch, "run.json"), "utf8");
    } catch (error) {
      die(`cannot read launch limits: ${posixErrorName(error)}`);
    }
    let top: unknown;
    try {
      top = JSON.parse(text);
    } catch {
      die("cannot read launch limits: JSONDecodeError");
    }
    if (typeof top !== "object" || top === null || Array.isArray(top))
      die("run.json must hold an object");
    config = (top as Record<string, unknown>).config ?? {};
  } else if (project) {
    const resolved = effectiveConfigForProject(project, configPath);
    if (resolved.notice !== null) console.error(resolved.notice);
    if (resolved.config === null || resolved.error !== null) {
      die(`cannot read launch limits: ${resolved.error ?? "cannot resolve project settings"}`);
    }
    config = resolved.config;
  } else if (isRegularFile(configPath)) {
    let text: string;
    try {
      text = readFileSync(configPath, "utf8");
    } catch (error) {
      die(`cannot read launch limits: ${posixErrorName(error)}`);
    }
    try {
      config = parseTomlText(text);
    } catch {
      die("cannot read launch limits: TOMLDecodeError");
    }
  }
  if (typeof config !== "object" || config === null || Array.isArray(config))
    die("config must be a table");
  const scope = config as Record<string, unknown>;
  const limits = scope.limits ?? {};
  if (typeof limits !== "object" || limits === null || Array.isArray(limits))
    die("limits must be a table");
  const table = limits as Record<string, unknown>;
  const roleLimits = (role !== "default" ? table[role] : undefined) ?? {};
  if (typeof roleLimits !== "object" || roleLimits === null || Array.isArray(roleLimits))
    die(`limits.${role} must be a table`);
  const scoped = roleLimits as Record<string, unknown>;
  const memory = hasOwn(scoped, "memory_max")
    ? scoped.memory_max
    : hasOwn(table, "memory_max")
      ? table.memory_max
      : memoryDefault;
  const tasks = hasOwn(scoped, "tasks_max")
    ? scoped.tasks_max
    : hasOwn(table, "tasks_max")
      ? table.tasks_max
      : tasksDefault;
  if (typeof memory !== "string" || !MEMORY_MAX_PATTERN.test(memory))
    die("memory_max must be a positive whole number followed by K, M, G or T");
  if (typeof tasks !== "number" || !Number.isInteger(tasks) || tasks < 1 || tasks > 2147483647)
    die("tasks_max must be a whole number from 1 to 2147483647");
  return { memory, tasks };
}

function limitsCmd(args: string[]): void {
  let role = "default";
  let dispatch = "";
  let project = "";
  let at = 0;
  while (at < args.length) {
    const option = args[at]!;
    if (option === "--role" || option === "--run" || option === "--project") {
      if (at + 1 >= args.length) die(`${option} needs a value`);
      if (option === "--role") role = args[at + 1]!;
      else if (option === "--run") dispatch = args[at + 1]!;
      else project = args[at + 1]!;
      at += 2;
    } else {
      die(
        "usage: run host limits [--role lane|coachman|reviewer] [--run <dispatch>|--project <repo>]",
      );
    }
  }
  if (role !== "default" && role !== "lane" && role !== "coachman" && role !== "reviewer")
    die(`unknown launch role: ${role}`);
  const limits = launchLimits(role, absolute(dispatch), globalConfigPath(), absolute(project));
  console.log(`memory=${limits.memory}\ntasks=${limits.tasks}`);
}

function random31(): number {
  return Math.floor(Math.random() * 32768);
}

function readCgroupFile(path: string): string {
  try {
    return readFileSync(path, "utf8").replace(/\n+$/u, "");
  } catch {
    return "";
  }
}

function cgroupHasWord(text: string, word: string): boolean {
  // grep -qw: the word between non-word characters, as the controllers file needs it.
  return text.split(/[^A-Za-z0-9_]+/u).includes(word);
}

async function systemdCapability(): Promise<{
  run: string;
  systemctl: string;
  setsid: string;
} | null> {
  if (run("uname", ["-s"]).out.replace(/\n+$/u, "") !== "Linux") return null;
  const runBin = which("systemd-run");
  const ctlBin = which("systemctl");
  const sidBin = which("setsid");
  const sleepBin = which("sleep");
  if (!runBin || !ctlBin || !sidBin || !sleepBin) return null;
  if (!readable("/sys/fs/cgroup/cgroup.controllers")) return null;
  const controllers = readCgroupFile("/sys/fs/cgroup/cgroup.controllers");
  if (!controllers || !cgroupHasWord(controllers, "memory") || !cgroupHasWord(controllers, "pids"))
    return null;
  if (limit(2, ctlBin, ["--user", "show-environment"]).code !== 0) return null;
  const unit = `postmaster-cap-probe-${process.pid}-${random31()}.scope`;
  const probeBin = has("timeout") ? "timeout" : runBin;
  const probeArgs = [
    ...(has("timeout") ? ["2", runBin] : []),
    "--user",
    "--scope",
    "--quiet",
    `--unit=${unit}`,
    "--property=MemoryMax=128M",
    "--property=MemorySwapMax=0",
    "--property=TasksMax=32",
    "--property=OOMPolicy=kill",
    "--",
    sleepBin,
    "0.35",
  ];
  const probe = spawn(probeBin, probeArgs, { stdio: "ignore" });
  const probePid = probe.pid ?? 0;
  let probeDone = false;
  let probeCode = 1;
  probe.once("error", () => {
    probeDone = true;
  });
  probe.once("exit", (code: number | null) => {
    probeDone = true;
    probeCode = code ?? 1;
  });
  let verified = false;
  for (let i = 0; i < 30; i++) {
    let cg = "";
    const shown = limit(1, ctlBin, ["--user", "show", unit, "--property=ControlGroup", "--value"]);
    if (shown.code === 0) cg = shown.out.replace(/\n+$/u, "");
    if (!cg.startsWith("/")) cg = "";
    if (
      cg &&
      readable(`/sys/fs/cgroup${cg}/memory.max`) &&
      readable(`/sys/fs/cgroup${cg}/pids.max`)
    ) {
      const mem = readCgroupFile(`/sys/fs/cgroup${cg}/memory.max`);
      const swap = readCgroupFile(`/sys/fs/cgroup${cg}/memory.swap.max`);
      const tasks = readCgroupFile(`/sys/fs/cgroup${cg}/pids.max`);
      const oom = readCgroupFile(`/sys/fs/cgroup${cg}/memory.oom.group`);
      if (mem === "134217728" && swap === "0" && tasks === "32" && oom === "1") verified = true;
      break;
    }
    if (!processAlive(probePid)) break;
    await Bun.sleep(25);
  }
  while (!probeDone) await Bun.sleep(25);
  if (probeCode !== 0) return null;
  if (!verified) return null;
  return { run: runBin, systemctl: ctlBin, setsid: sidBin };
}

function cgroupEvents(path: string): Record<string, number> {
  try {
    const lines = readFileSync(path, "utf8").split("\n");
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    const events: Record<string, number> = {};
    for (const line of lines) {
      const fields = pyWords(line);
      if (fields.length !== 2 || !/^[-+]?[0-9]+$/u.test(fields[1]!)) return {};
      events[fields[0]!] = Number(fields[1]);
    }
    return events;
  } catch {
    return {};
  }
}

async function watchCapEvents(
  systemctl: string,
  unit: string,
  eventFile: string,
  runnerPid: number,
): Promise<void> {
  const show = (property: string): string => {
    const result = run(systemctl, ["--user", "show", unit, `--property=${property}`, "--value"], {
      timeout: 400,
    });
    return result.code === 0 ? pyTrim(result.out) : "";
  };
  const note = (kind: string): void => {
    writeFileSync(eventFile, `${kind}\n`, "ascii");
    run(systemctl, ["--user", "kill", "--kill-whom=all", "--signal=SIGKILL", unit], {
      timeout: 1000,
    });
  };
  const deadline = Date.now() + 5000;
  let cgroup = "";
  while (Date.now() < deadline && processAlive(runnerPid)) {
    cgroup = show("ControlGroup");
    if (cgroup.startsWith("/") && !cgroup.split("/").includes("..")) break;
    await Bun.sleep(25);
  }
  if (!cgroup.startsWith("/") || cgroup.split("/").includes("..")) return;
  // POSTMASTER_CGROUP_ROOT points the watcher at a fixture tree for tests; unset,
  // it reads the live controllers. Only the launch environment sets it, which a
  // lane cannot reach back into, so a launch cannot blind its own watcher.
  const root = (process.env.POSTMASTER_CGROUP_ROOT || "/sys/fs/cgroup") + cgroup;
  const pidsPath = join(root, "pids.events");
  const memPath = join(root, "memory.events");
  const tripped = (): string => {
    if ((cgroupEvents(pidsPath).max ?? 0) !== 0) return "process";
    // Memory trips on this cgroup's OOM decision, not on pressure and not on any
    // victim here: `max` fires hundreds of times while reclaim succeeds (a healthy
    // cache-heavy launch brushing the cap), and `oom_kill` counts victims of any
    // OOM killer including a host-wide one, which would blame MemoryMax for the
    // machine running out. `oom` fires exactly when this cgroup's usage reached
    // its limit and allocation was about to fail. A refused fork has no reclaim
    // analogue, so the process cap keeps `max`.
    if ((cgroupEvents(memPath).oom ?? 0) !== 0) return "memory";
    return "";
  };
  // Main blocks in select.poll on the events files; with no poll primitive this
  // port re-reads on the 100 ms cadence main itself falls back to.
  let kind = tripped();
  while (!kind) {
    try {
      if (!statSync(root).isDirectory()) break;
    } catch {
      break;
    }
    if (!processAlive(runnerPid)) break;
    await Bun.sleep(100);
    kind = tripped();
  }
  if (!kind) kind = tripped();
  if (kind) note(kind);
}
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
function touch(path: string): void {
  if (!path) return;
  try {
    writeFileSync(path, "", { flag: "a" });
    const now = new Date();
    utimesSync(path, now, now);
  } catch {}
}
function markerRemove(path: string): void {
  if (path)
    try {
      rmSync(path, { force: true });
    } catch {}
}
// A reused marker's prior watchers are dead legs walking: the previous
// launch's _watch polls its payload every 500ms and may still be polling
// when the marker is reset, and its late touch would read as the new
// launch's completion, finishing it before its payload prints. Kill them
// before the reset; the new launch spawns its own during placement.
// SIGKILL, not SIGTERM: the watcher is stateless, and only a synchronous
// death closes the race. One listing, not a scan per pid: the portable ps
// path costs a spawn per process.
function killPriorWatchers(marker: string): void {
  if (!marker) return;
  for (const [pid, line] of processCommandLines()) {
    if (pid === process.pid) continue;
    if (!line.split(/[ \t]+/u).includes("_watch") || !line.includes(marker)) continue;
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
}
function _writeEnvPipe(path: string): void {
  let fd = -1;
  const deadline = Date.now() + 120_000;
  while (fd < 0 && Date.now() < deadline && existsSync(dirname(path))) {
    try {
      fd = openSync(path, constants.O_WRONLY | constants.O_NONBLOCK);
    } catch (error) {
      if ((error as { code?: string }).code !== "ENXIO") return;
      sleepSync(100);
    }
  }
  if (fd < 0) return;
  try {
    const body = new TextEncoder().encode(
      `${Object.entries(process.env)
        .filter((entry): entry is [string, string] => entry[1] !== undefined)
        .map(([key, value]) => `${key}=${value}\0`)
        .join("")}POSTMASTER_ENV_OK=1\0`,
    );
    let at = 0;
    while (at < body.length) at += writeSync(fd, body, at, body.length - at);
  } finally {
    closeSync(fd);
  }
}
function readEnvPipe(path: string): Record<string, string> | null {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  } catch {
    return null;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  const deadline = Date.now() + 30_000;
  try {
    while (Date.now() < deadline) {
      const part = new Uint8Array(65536);
      let read = 0;
      try {
        read = readSync(fd, part, 0, part.length, null);
      } catch (error) {
        if (
          (error as { code?: string }).code !== "EAGAIN" &&
          (error as { code?: string }).code !== "EWOULDBLOCK"
        )
          throw error;
      }
      if (read > 0) {
        chunks.push(part.slice(0, read));
        total += read;
        const joined = new Uint8Array(total);
        let pos = 0;
        for (const chunk of chunks) {
          joined.set(chunk, pos);
          pos += chunk.length;
        }
        if (new TextDecoder().decode(joined).includes("POSTMASTER_ENV_OK=1\0")) {
          const env: Record<string, string> = {};
          for (const kv of new TextDecoder().decode(joined).split("\0")) {
            const at = kv.indexOf("=");
            if (at > 0) env[kv.slice(0, at)] = kv.slice(at + 1);
          }
          delete env.POSTMASTER_ENV_OK;
          return env;
        }
      }
      sleepSync(50);
    }
  } finally {
    closeSync(fd);
  }
  return null;
}

function absolute(path: string): string {
  // Main joins $PWD and the path without normalizing: the exact --out path,
  // `..` and all, is what the launch sees as POSTMASTER_EVENT_STREAM.
  if (path === "" || path.startsWith("/")) return path;
  return `${process.env.PWD || process.cwd()}/${path}`;
}
function appendFailure(err: string, marker: string, message: string): never {
  if (err)
    try {
      writeFileSync(err, `host: ${message}\n`, { flag: "a" });
    } catch {}
  touch(marker);
  die(message);
}
function startDetached(args: string[], env?: Record<string, string | undefined>) {
  const child = spawn(process.execPath, [join(HERE, "host.ts"), ...args], {
    detached: true,
    stdio: "ignore",
    env: env ?? process.env,
  });
  child.unref();
  return child.pid ?? 0;
}
async function watch(pid: number, marker: string): Promise<void> {
  while (true) {
    if (processState(pid) !== "live") break;
    await Bun.sleep(500);
  }
  touch(marker);
}
async function envWrite(path: string): Promise<void> {
  const until = Date.now() + 120_000;
  while (Date.now() < until && existsSync(dirname(path))) {
    let fd: number;
    try {
      fd = openSync(path, constants.O_WRONLY | constants.O_NONBLOCK);
    } catch (error) {
      // ENXIO: no reader yet; ENOENT: no FIFO yet. Anything else cannot arrive.
      if (
        (error as { code?: string }).code !== "ENXIO" &&
        (error as { code?: string }).code !== "ENOENT"
      )
        return;
      await Bun.sleep(100);
      continue;
    }
    try {
      const data = new TextEncoder().encode(
        `${Object.entries(process.env)
          .filter((entry): entry is [string, string] => entry[1] !== undefined)
          .map(([key, value]) => `${key}=${value}\0`)
          .join("")}POSTMASTER_ENV_OK=1\0`,
      );
      let at = 0;
      while (at < data.length) {
        try {
          at += writeSync(fd, data, at, data.length - at);
        } catch (error) {
          const code = (error as { code?: string }).code;
          // The FIFO is full: wait for the reader to drain it and write the
          // rest, so an environment larger than the pipe arrives whole.
          if (code === "EAGAIN" || code === "EWOULDBLOCK") {
            if (Date.now() >= until) return;
            await Bun.sleep(10);
            continue;
          }
          return; // the reader is gone; nothing more can arrive
        }
      }
      return;
    } finally {
      closeSync(fd);
    }
  }
}
function spawnStrerror(error: unknown): string {
  const code = (error as { code?: string }).code;
  if (code === "ENOENT") return "No such file or directory";
  if (code === "EACCES") return "Permission denied";
  if (code === "ENOTDIR") return "Not a directory";
  if (code === "ELOOP") return "Too many levels of symbolic links";
  if (code === "ENAMETOOLONG") return "File name too long";
  if (code === "ENOEXEC") return "Exec format error";
  return String((error as Error)?.message ?? error);
}

async function runLaunch(specDir: string, mode: string): Promise<number> {
  if (mode !== "bg") {
    try {
      mkdirSync(join(specDir, "claimed"));
    } catch {
      console.log("host: this launch was started elsewhere; nothing to do here.");
      return 0;
    }
  }
  let spec: Spec;
  try {
    spec = readSpec(specDir);
  } catch {
    appendFailure("", "", "launch specification is incomplete");
  }
  STATE = spec.state;
  const paneEnv = mode === "bg" ? { ...process.env } : readEnvPipe(join(specDir, "env"));
  dropSpec(specDir);
  if (!paneEnv) {
    const message = `the caller's environment never arrived, so '${spec.name}' did not start`;
    console.log(`host: ${message}`);
    if (spec.err) {
      try {
        writeFileSync(spec.err, `host: ${message}\n`, { flag: "a" });
      } catch {}
    }
    touch(spec.marker);
    throw hostError("", 1);
  }
  if (paneEnv.POSTMASTER_PROC_ROOT === undefined) delete process.env.POSTMASTER_PROC_ROOT;
  else process.env.POSTMASTER_PROC_ROOT = paneEnv.POSTMASTER_PROC_ROOT;
  // Strip caller identity at the one boundary every run launch crosses. The Claude list is
  // intentionally exact plus session-identity families: other CLAUDE_CODE_* names configure
  // the harness and must reach it. Add a new identity name or family here and to the
  // controls. Herdr values are all caller identity; a Herdr pane's own six are re-added
  // below from this runner's environment, never from the caller pipe. POSTMASTER_LAUNCH_ROLE
  // is dropped with them so an inherited role cannot replace the run's explicit host role,
  // re-added below.
  const env: Record<string, string> = {};
  const drop = new Set([
    "POSTMASTER_LAUNCH_NAME",
    "POSTMASTER_LAUNCH_ROLE",
    "POSTMASTER_EVENT_STREAM",
    ...PANE_IDS,
  ]);
  const keep =
    mode === "herdr"
      ? [
          "HERDR_PANE_ID",
          "HERDR_TAB_ID",
          "HERDR_WORKSPACE_ID",
          "HERDR_ENV",
          "HERDR_SOCKET_PATH",
          "HERDR_BIN_PATH",
        ]
      : mode === "tmux"
        ? ["TMUX", "TMUX_PANE"]
        : [];
  if (mode === "tmux") drop.add("TMUX");
  for (const [key, value] of Object.entries(paneEnv))
    if (!isCallerIdentity(key) && !drop.has(key) && value !== undefined) env[key] = value;
  for (const key of keep) if (process.env[key] !== undefined) env[key] = process.env[key]!;
  env.POSTMASTER_LAUNCH_NAME = spec.name;
  const isLaunch = basename(spec.argv[0] ?? "") === "run" && (spec.argv[1] ?? "") === "launch";
  if (isLaunch && (spec.role === "lane" || spec.role === "coachman" || spec.role === "reviewer"))
    env.POSTMASTER_LAUNCH_ROLE = spec.role;
  if (spec.out) env.POSTMASTER_EVENT_STREAM = spec.out;

  const launchNotice = (text: string): void => {
    if (spec.err) {
      try {
        writeFileSync(spec.err, `host: ${text}\n`, { flag: "a" });
      } catch {}
    }
    if (mode !== "bg") console.error(`host: ${text}`);
  };
  const emitCannotRun = (error: unknown): void => {
    const text = `host: cannot run ${spec.argv[0] ?? ""}: ${spawnStrerror(error)}\n`;
    if (spec.err) {
      try {
        writeFileSync(spec.err, text, { flag: "a" });
      } catch {}
    } else if (mode !== "bg") process.stderr.write(text);
  };

  const from = spec.append === "1" && spec.out ? pidSize(spec.out) : 0;
  let stdoutFd = -1;
  let stderrFd = -1;
  try {
    const outPath = spec.out || (mode === "bg" ? "/dev/null" : "");
    const errPath = spec.err || (mode === "bg" ? "/dev/null" : "");
    // Emptied once, then only ever appended to: the launch inherits append
    // descriptors, so a notice appended while it writes cannot clobber it.
    if (outPath) {
      if (spec.append !== "1" || !spec.out) writeFileSync(outPath, "");
      stdoutFd = openSync(outPath, "a", 0o666);
    }
    if (errPath) {
      writeFileSync(errPath, "");
      stderrFd = openSync(errPath, "a", 0o666);
    }
  } catch (error) {
    if (stdoutFd >= 0) closeSync(stdoutFd);
    if (stderrFd >= 0) closeSync(stderrFd);
    appendFailure(
      spec.err,
      spec.marker,
      `cannot open launch output: ${String((error as Error).message)}`,
    );
  }
  const started = Date.now();
  const eventFile = `${specDir}.cap`;
  markerRemove(eventFile);
  const stdioFor = (fd: number): number | "ignore" | "inherit" =>
    fd >= 0 ? fd : mode === "bg" ? "ignore" : "inherit";
  let child: ReturnType<typeof spawn> | null = null;
  let spawnError: unknown = null;
  // The wrapper phase's command-line prefix, where the plain path wraps: the
  // settled command waits past it, since a python wrapper outlasts the window.
  let wrapperPrefix: string | null = null;
  try {
    if (spec.capmode === "systemd") {
      child = spawn(
        spec.setsid,
        [
          spec.systemd_run,
          "--user",
          "--scope",
          "--quiet",
          `--unit=${spec.unit}`,
          `--property=MemoryMax=${spec.memory}`,
          "--property=MemorySwapMax=0",
          `--property=TasksMax=${spec.tasks}`,
          "--property=OOMPolicy=kill",
          "--",
          ...spec.argv,
        ],
        {
          cwd: spec.rundir,
          env,
          stdio: ["ignore", stdioFor(stdoutFd), stdioFor(stderrFd)],
        },
      );
    } else {
      launchNotice("launch running uncapped (no supported per-launch limits available)");
      // A session of its own without systemd: setsid(1) where it exists, else
      // python's setsid, since macOS ships no setsid binary. Either execs the
      // command in place, so the pidfile still names the launch's own pid —
      // which is why this spawn is not detached: a detached child is already
      // a group leader, and setsid would fork past the recorded pid.
      let bin = spec.argv[0] ?? "";
      let args = spec.argv.slice(1);
      let alone = false;
      const sid = which("setsid");
      if (sid) {
        args = [bin, ...args];
        bin = sid;
        alone = true;
        wrapperPrefix = `${sid} `;
      } else {
        const py = which("python3");
        if (py) {
          // Shed a group leadership first: setsid fails on a group leader,
          // and a spawn that arrives already leading would die without ever
          // execing. Either failure still execs, group-led at worst.
          args = [
            "-c",
            [
              "import os,sys",
              "try:",
              " os.setpgid(0,os.getpgid(os.getppid()))",
              "except Exception:",
              " pass",
              "try:",
              " os.setsid()",
              "except Exception:",
              " pass",
              "os.execvp(sys.argv[1],sys.argv[1:])",
            ].join("\n"),
            bin,
            ...args,
          ];
          bin = py;
          alone = true;
          // The -c program's first line: only this wrapper's command line
          // starts this way, so a python target still settles by name.
          wrapperPrefix = `${py} -c import os,sys`;
        }
      }
      child = spawn(bin, args, {
        cwd: spec.rundir,
        env,
        ...(alone ? {} : { detached: true }),
        stdio: ["ignore", stdioFor(stdoutFd), stdioFor(stderrFd)],
      });
    }
  } catch (error) {
    spawnError = error;
  }
  if (stdoutFd >= 0) closeSync(stdoutFd);
  if (stderrFd >= 0) closeSync(stderrFd);
  const exited = child
    ? new Promise<number>((resolveCode) => {
        let settled = false;
        child!.once("error", (error: unknown) => {
          if (!settled) {
            settled = true;
            emitCannotRun(error);
            resolveCode(127);
          }
        });
        child!.once("exit", (exitCode: number | null, signal: string | null) => {
          if (!settled) {
            settled = true;
            resolveCode(exitCode ?? (signal ? signalExitCode(signal) : 1));
          }
        });
      })
    : Promise.resolve(127);
  if (!child && spawnError) emitCannotRun(spawnError);
  const pid = child?.pid ?? 0;
  // The marker's watcher and the registry record come before the pidfile, since run returns to
  // its caller the moment the pidfile holds a pid: a caller that stops or kills the launch then
  // finds it registered, and its marker still lands.
  if (pid) {
    if (mode !== "bg" && spec.marker) startDetached(["_watch", String(pid), spec.marker]);
    try {
      registryAdd(pid, spec.cwd, spec.name);
    } catch {}
    if (spec.pidfile) {
      try {
        // The start, boot and command identity travels with the pid, so stop-pidfile
        // refuses a number the OS has since reused for another process. Each missing
        // line weakens the form: without a command it checks start and boot, and a
        // bare pid checks nothing.
        const start = startOf(pid);
        const boot = bootId();
        const wrapper = spec.capmode === "systemd" && spec.setsid ? basename(spec.setsid) : null;
        const command = await settledCommand(pid, wrapper, wrapperPrefix);
        const body =
          start && boot && command
            ? `${pid}\n${start}\n${boot}\n${command}\n`
            : start && boot
              ? `${pid}\n${start}\n${boot}\n`
              : `${pid}\n`;
        writeFileSync(spec.pidfile, body);
      } catch {}
    }
  }
  for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      if (!pid) return;
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        try {
          process.kill(pid, "SIGTERM");
        } catch {}
      }
    });
  }
  const capwatch =
    spec.capmode === "systemd" ? watchCapEvents(spec.systemctl, spec.unit, eventFile, pid) : null;
  let followed: Promise<unknown> | null = null;
  let reported: Promise<unknown> | null = null;
  if (mode !== "bg") {
    process.stdout.write(`${String.fromCharCode(27)}]0;${spec.name}${String.fromCharCode(7)}`);
    if (mode === "tmux")
      run("tmux", ["select-pane", "-t", process.env.TMUX_PANE ?? "", "-T", spec.name]);
    const clock = new Date().toTimeString().slice(0, 8);
    console.log(`${spec.name}\nstarted ${clock} in ${spec.rundir}`);
    if (spec.out) console.log(`events: ${spec.out}`);
    console.log("----");
    if (spec.out)
      followed = new Promise((resolveFollow) => {
        const follower = spawn(
          process.execPath,
          [
            join(HERE, "view-stream.ts"),
            "--follow",
            spec.out,
            "--pid",
            String(pid),
            "--from",
            String(from),
          ],
          { stdio: "inherit" },
        );
        follower.once("error", () => resolveFollow(null));
        follower.once("exit", () => resolveFollow(null));
      });
    if (mode === "herdr" && process.env.HERDR_PANE_ID) reported = herdrReport(pid, spec.name);
    if (mode === "tmux")
      run("tmux", [
        "set-option",
        "-w",
        "-t",
        process.env.TMUX_PANE ?? "",
        "@postmaster_state",
        "running",
      ]);
  }
  const code = await exited;
  if (capwatch) await capwatch.catch(() => {});
  if (spec.capmode === "systemd") {
    let capEvent = "";
    try {
      capEvent = readFileSync(eventFile, "utf8").replace(/\n+$/u, "");
    } catch {}
    if (!capEvent) {
      // systemctl's Result can lag an OOM kill, reading success or nothing for a
      // while after the scope is dead; poll briefly while the scope is not yet
      // settled so a fast OOM is still named. success with the scope still
      // active is transient, not a verdict; a settled scope breaks at once,
      // so a launch that never tripped pays for one query only.
      for (let tries = 0; tries < 40; tries++) {
        // By name, not by line: --value prints properties in its own order no
        // matter the --property order, so positional parsing would silently swap.
        const verdict = run(spec.systemctl, [
          "--user",
          "show",
          spec.unit,
          "--property=Result",
          "--property=ActiveState",
        ]);
        const results: string[] = [];
        const actives: string[] = [];
        for (const line of verdict.out.split("\n")) {
          if (line.startsWith("Result=")) results.push(line.slice(7));
          else if (line.startsWith("ActiveState=")) actives.push(line.slice(12));
        }
        if (results.join("\n") === "oom-kill") {
          capEvent = "memory";
          break;
        }
        const active = actives.join("\n");
        if (active === "inactive" || active === "failed") break;
        await Bun.sleep(50);
      }
    }
    if (capEvent === "process") launchNotice(`process cap reached (TasksMax=${spec.tasks})`);
    else if (capEvent === "memory") launchNotice(`memory cap reached (MemoryMax=${spec.memory})`);
    run(spec.systemctl, ["--user", "reset-failed", spec.unit]);
  }
  touch(spec.marker);
  if (pid) {
    try {
      registryMembers(pid);
    } catch {}
  }
  markerRemove(eventFile);
  if (mode === "bg") return 0;
  if (followed) await followed;
  if (reported) await reported;
  if (mode !== "bg") {
    if (mode === "tmux")
      run("tmux", [
        "set-option",
        "-w",
        "-t",
        process.env.TMUX_PANE ?? "",
        "@postmaster_state",
        "done",
      ]);
    console.log(
      "----\nexit " +
        code +
        " at " +
        new Date().toTimeString().slice(0, 8) +
        " after " +
        Math.floor((Date.now() - started) / 1000) +
        "s" +
        (spec.marker ? `, marker ${spec.marker}` : ""),
    );
  }
  return 0;
}
async function runCmd(args: string[]): Promise<void> {
  const name = args[0] ?? "";
  const givenCwd = args[1] ?? "";
  let under = "";
  let role = "default";
  let dispatch = "";
  let project = "";
  let out = "";
  let err = "";
  let marker = "";
  let pidfile = "";
  let append = false;
  let bad = "";
  let at = 2;
  while (at < args.length) {
    const option = args[at]!;
    if (
      option === "--under" ||
      option === "--role" ||
      option === "--run" ||
      option === "--project" ||
      option === "--out" ||
      option === "--err" ||
      option === "--marker" ||
      option === "--pidfile"
    ) {
      if (at + 1 >= args.length) {
        bad = `${option} needs a value`;
        break;
      }
      if (option === "--under") under = args[at + 1]!;
      else if (option === "--role") role = args[at + 1]!;
      else if (option === "--run") dispatch = args[at + 1]!;
      else if (option === "--project") project = args[at + 1]!;
      else if (option === "--out") out = args[at + 1]!;
      else if (option === "--err") err = args[at + 1]!;
      else if (option === "--marker") marker = args[at + 1]!;
      else if (option === "--pidfile") pidfile = args[at + 1]!;
      at += 2;
    } else if (option === "--append") {
      append = true;
      at++;
    } else if (option === "--") {
      at++;
      break;
    } else {
      bad = `unknown option for run: ${option} (the command goes after --)`;
      break;
    }
  }
  out = absolute(out);
  err = absolute(err);
  marker = absolute(marker);
  pidfile = absolute(pidfile);
  dispatch = absolute(dispatch);
  project = absolute(project);
  under = absolute(under);
  if (bad) appendFailure(err, marker, bad);
  if (!name || !givenCwd)
    appendFailure(err, marker, "usage: run host run <name> <cwd> [options] -- <command...>");
  const argv = args.slice(at);
  if (!argv.length) appendFailure(err, marker, "run needs a command after --");
  if (!existsSync(givenCwd) || !statSync(givenCwd).isDirectory())
    appendFailure(err, marker, `no such directory: ${givenCwd}`);
  let cwd = "";
  try {
    cwd = realpathSync(givenCwd);
  } catch {
    appendFailure(err, marker, "cannot resolve launch directory");
  }
  const launchName = clean(name);
  if (role !== "default" && role !== "lane" && role !== "coachman" && role !== "reviewer")
    appendFailure(err, marker, `unknown launch role: ${role}`);
  if ((role === "lane" || role === "coachman" || role === "reviewer") && !under)
    appendFailure(err, marker, `a ${role} launch needs --under <dispatch> to name its run tab`);
  if (dispatch && !under)
    appendFailure(err, marker, "--run needs --under <dispatch> to name its run tab");
  if (under) {
    let underIsDir = false;
    try {
      underIsDir = statSync(under).isDirectory();
    } catch {}
    if (!underIsDir) appendFailure(err, marker, `no run directory: ${under}`);
    try {
      under = realpathSync(under);
    } catch {
      appendFailure(err, marker, "cannot resolve run directory");
    }
    // BASE's dispatch_info fails only when python itself breaks, which the port
    // has no equivalent of; an unreadable waybill reads as no worktree below.
    // A dispatch without a waybill still names its space when it carries run.json:
    // setup launches its verifier session before any ticket run, and its run dir
    // holds the record but no waybill and no synthesis worktree. But run.json
    // names the space only for such a waybill-less dispatch: one that names a
    // worktree needs it live, so a run whose worktree was pruned still refuses
    // instead of launching into the background.
    const underInfo = dispatchInfo(under);
    const underPath = underInfo.worktree;
    let underPathIsDir = false;
    try {
      underPathIsDir = !!underPath && statSync(underPath).isDirectory();
    } catch {}
    let underHasRun = false;
    try {
      underHasRun = statSync(join(under, "run.json")).isFile();
    } catch {}
    const briefLess = underInfo.name === "" && underInfo.worktree === "";
    if (!underPathIsDir && !(underHasRun && briefLess))
      appendFailure(
        err,
        marker,
        `the run at ${under} has no existing synthesis worktree or run.json to place its tab`,
      );
  }
  if (dispatch) {
    let dispatchIsDir = false;
    try {
      dispatchIsDir = statSync(dispatch).isDirectory();
    } catch {}
    if (dispatchIsDir) {
      try {
        dispatch = realpathSync(dispatch);
      } catch {
        dispatch = "";
      }
    }
  }
  let memory = "";
  let tasks = "";
  try {
    const limits = launchLimits(role, dispatch, globalConfigPath(), project);
    memory = limits.memory;
    tasks = String(limits.tasks);
  } catch (error) {
    if (isHostError(error))
      appendFailure(err, marker, `could not resolve launch limits: ${error.message}`);
    throw error;
  }
  let capMode = "uncapped";
  let systemdRun = "";
  let systemctl = "";
  let setsidBin = "";
  let unit = "";
  const capability = await systemdCapability();
  if (capability) {
    systemdRun = capability.run;
    systemctl = capability.systemctl;
    setsidBin = capability.setsid;
    capMode = "systemd";
  } else {
    warn(`launch '${name}' running uncapped: per-launch cgroup limits are unavailable`);
  }
  if (capMode === "systemd")
    unit = `postmaster-host-${process.pid}-${random31()}-${random31()}.scope`;
  let claimWait: number;
  try {
    claimWait = count(process.env.POSTMASTER_HOST_CLAIM_WAIT ?? "20", "POSTMASTER_HOST_CLAIM_WAIT");
  } catch (error) {
    warn(String((error as Error).message));
    appendFailure(err, marker, "no launch: POSTMASTER_HOST_CLAIM_WAIT");
  }
  const host = detect();
  if (marker && existsSync(marker) && under) {
    try {
      finishPriorLaunch(host, cwd, under);
    } catch (error) {
      // The settle warns its own reason; a die inside (a bad count) keeps its.
      if (isHostError(error) && !error.message)
        appendFailure(
          err,
          marker,
          "could not settle the previous launch before reusing its marker",
        );
      throw error;
    }
  }
  if (pidfile) markerRemove(pidfile);
  // A marker that already exists may still have the previous launch's
  // _watch polling behind it; without the kill its late touch lands after
  // the reset and finishes this launch before its payload prints.
  if (marker && existsSync(marker)) killPriorWatchers(marker);
  if (marker) markerRemove(marker);
  const specDir = mkdtempSync(join(tmpdir(), "postmaster-host."));
  writeSpec(specDir, {
    name: launchName,
    cwd,
    rundir: process.env.PWD || process.cwd(),
    state: STATE,
    out,
    err,
    marker,
    pidfile,
    append: append ? "1" : "0",
    role,
    memory,
    tasks,
    capmode: capMode,
    systemd_run: systemdRun,
    systemctl,
    setsid: setsidBin,
    unit,
    argv,
  });
  let where = "";
  if (host === "herdr") {
    // A dispatch with no waybill names no run space: setup launches its
    // session before any ticket run exists, so place it by the worktree and
    // keep its tab and its watched wait. A dispatch that names a space keeps
    // run placement alone.
    const underBrief = under === "" ? null : dispatchInfo(under);
    const briefLess = underBrief !== null && (underBrief.name === "" || underBrief.worktree === "");
    const placed = !under
      ? herdrPlace(launchName, cwd, "worktree", dispatch)
      : briefLess
        ? herdrPlace(launchName, cwd, "worktree", under)
        : herdrRunPlace(launchName, cwd, under);
    if (placed) {
      startFinishWatcher("herdr", placed.space, placed.tab, placed.pane, cwd, marker);
      run("mkfifo", [join(specDir, "env")]);
      startDetached(["_env-write", join(specDir, "env")]);
      const line = ` cd -- ${quote(cwd)} && ${quote(process.execPath)} ${quote(join(HERE, "host.ts"))} _run herdr ${quote(specDir)}`;
      if (herdr(["pane", "run", placed.pane, line]).code === 0)
        where = `host=herdr space=${placed.space} tab=${placed.tab} pane=${placed.pane}`;
    }
    if (!where) warn(`Herdr could not place '${launchName}'; running it in the background`);
  } else if (host === "tmux") {
    const session = tmuxSession(cwd);
    run("mkfifo", [join(specDir, "env")]);
    startDetached(["_env-write", join(specDir, "env")]);
    const argsForPane = [
      "bash",
      "-c",
      `${quote(process.execPath)} "$0" _run tmux "$1"; exec "${String.fromCharCode(36)}{SHELL:-/bin/sh}"`,
      join(HERE, "host.ts"),
      specDir,
    ];
    const target = `=${session}`;
    let result: ReturnType<typeof run>;
    if (run("tmux", ["has-session", "-t", target]).code === 0)
      result = run("tmux", [
        "new-window",
        "-d",
        "-P",
        "-F",
        "#{window_id}",
        "-t",
        `${target}:`,
        "-n",
        launchName,
        "-c",
        cwd,
        ...argsForPane,
      ]);
    else
      result = run("tmux", [
        "new-session",
        "-d",
        "-P",
        "-F",
        "#{window_id}",
        "-s",
        session,
        "-n",
        launchName,
        "-c",
        cwd,
        ...argsForPane,
      ]);
    const window = result.out.trim();
    if (window) {
      run("tmux", ["set-option", "-w", "-t", window, "@postmaster_cwd", cwd]);
      if (under) run("tmux", ["set-option", "-w", "-t", window, "@postmaster_run", under]);
      run("tmux", ["set-option", "-w", "-t", window, "automatic-rename", "off"]);
      const pane = run("tmux", ["display-message", "-p", "-t", window, "#{pane_id}"]).out.trim();
      if (
        pane &&
        run("tmux", ["set-option", "-p", "-t", pane, "@postmaster_owned", "yes"]).code === 0
      ) {
        if (run("tmux", ["set-option", "-w", "-t", window, "@postmaster_pane", pane]).code !== 0)
          warn(
            `could not record tmux pane ${pane} in window ${window}; close it manually if needed`,
          );
        startFinishWatcher("tmux", "", window, pane, cwd, marker);
      }
      where = `host=tmux session=${session} window=${window}`;
    } else warn(`tmux could not open a window for '${launchName}'; running it in the background`);
  }
  let runnerPid = 0;
  if (where) {
    for (
      let i = 0;
      i < claimWait * 4 && existsSync(specDir) && !existsSync(join(specDir, "claimed"));
      i++
    )
      await Bun.sleep(250);
    try {
      mkdirSync(join(specDir, "claimed"));
      where = "";
      warn(
        "the " +
          host +
          " pane did not start '" +
          launchName +
          "' within " +
          claimWait +
          "s; running it in the background",
      );
    } catch {}
  } else {
    try {
      mkdirSync(join(specDir, "claimed"));
    } catch {}
  }
  if (!where) {
    runnerPid = startDetached(["_run", "bg", specDir]);
    where = "host=none";
  }
  for (let i = 0; i < 120 && existsSync(specDir); i++) {
    if (runnerPid && processState(runnerPid) !== "live") break;
    await Bun.sleep(250);
  }
  if (existsSync(specDir) && runnerPid && processState(runnerPid) !== "live") {
    dropSpec(specDir);
    appendFailure(err, marker, `'${launchName}' did not start in the background`);
  }
  // BASE waits for a NONEMPTY pid file: the runner creates it before its first
  // write lands, and a reader that stops at created reads an empty pid.
  if (pidfile && !existsSync(specDir))
    for (let i = 0; i < 40 && pidSize(pidfile) === 0; i++) await Bun.sleep(250);
  console.log(where);
}

function pidSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}
type ProcRow = { ppid: number; group: number; start: string; zombie: boolean; name: string };
function processTable(): Map<number, ProcRow> {
  const rows = new Map<number, ProcRow>();
  for (const [pid, info] of sharedProcessTable()) {
    rows.set(pid, {
      ppid: info.parent,
      group: info.group,
      start: info.start,
      zombie: info.state === "zombie",
      name: info.name,
    });
  }
  return rows;
}
function commandLine(pid: number): string {
  return processCommandLine(pid);
}
function protectedProcess(pid: number, name: string): string {
  // ASCII: argv words are NUL-separated and the joiner spaces them;
  // ASCII: non-ASCII bytes glue to their word, never split it.
  const words = commandLine(pid).split(/\s+/u);
  const tail = words.slice(1);
  const identity = basename(words[0] ?? name);
  if (pid === 1) return "the init process";
  if (name === "systemd" || identity === "systemd") return "a systemd manager";
  if (
    (name === "herdr" || identity === "herdr") &&
    (!tail.length || tail.includes("server") || tail.some((word) => word.startsWith("--session")))
  )
    return "the Herdr server or a Herdr client";
  if ((name === "moshi-hook" || identity === "moshi-hook") && tail.includes("serve"))
    return "the moshi-hook daemon";
  if (words.some((word) => word.includes("code-server"))) return "code-server";
  if (
    (name.startsWith("tmux") || identity.startsWith("tmux")) &&
    (name.includes("server") || identity.includes("server") || !tail.length)
  )
    return "the tmux server";
  if (name === "sshd" || identity === "sshd") return "sshd";
  return "";
}
function killPids(pids: Iterable<number>, signal: string): void {
  for (const pid of pids)
    try {
      process.kill(pid, signal);
    } catch {}
}
function treeFor(
  table: Map<number, ProcRow>,
  groups: Set<number>,
  seeds: Set<number>,
  spare: Set<number>,
): Set<number> {
  const live = new Set(
    [...table]
      .filter(([, row]) => !row.zombie)
      .map(([pid]) => pid)
      .filter((pid) => !spare.has(pid)),
  );
  const hit = new Set(
    [...live].filter((pid) => groups.has(table.get(pid)!.group) || seeds.has(pid)),
  );
  const children = new Map<number, number[]>();
  for (const [pid, row] of table) children.set(row.ppid, [...(children.get(row.ppid) ?? []), pid]);
  const queue = [...hit];
  while (queue.length)
    for (const child of children.get(queue.pop()!) ?? [])
      if (live.has(child) && !hit.has(child)) {
        hit.add(child);
        queue.push(child);
      }
  return hit;
}
function registryRoots(path: string): { count: number; roots: string[]; names: string[] } {
  const found = registryScan(path);
  return {
    count: found.length,
    roots: found.flatMap((record) => record.roots),
    names: found.map((record) => record.name),
  };
}
async function stopTree(
  grace: number,
  most: number,
  roots: string[],
): Promise<{ code: number; text: string }> {
  const parsed: Array<{ kind: string; pid: number; start: string }> = [];
  for (const root of roots) {
    const match = /^(group|tree)\|([0-9]+)\|(.+)$/u.exec(root);
    if (match) parsed.push({ kind: match[1]!, pid: Number(match[2]), start: match[3]! });
  }
  let table = processTable();
  if (!table.has(process.pid)) return { code: 1, text: "cannot list processes" };
  const spare = new Set([0, 1]);
  let ancestor = process.pid;
  while (table.has(ancestor) && !spare.has(ancestor)) {
    spare.add(ancestor);
    ancestor = table.get(ancestor)!.ppid;
  }
  const accepted = parsed.filter(
    (root) =>
      table.has(root.pid) &&
      table.get(root.pid)!.start === root.start &&
      !table.get(root.pid)!.zombie,
  );
  const groups = new Set(accepted.filter((root) => root.kind === "group").map((root) => root.pid));
  const seeds = new Set(accepted.map((root) => root.pid));
  const frozen = new Set<number>();
  const refuse = (reason: string): { code: number; text: string } => {
    if (frozen.size) killPids(frozen, "SIGCONT");
    return {
      code: 3,
      text:
        "refused\t" +
        reason +
        (frozen.size
          ? `; the ${frozen.size} processes frozen before it was found were resumed`
          : ""),
    };
  };
  for (let round = 0; round < 20; round++) {
    const batch = [...treeFor(table, groups, seeds, spare)].filter((pid) => !frozen.has(pid));
    if (!batch.length) break;
    const all = new Set([...frozen, ...batch]);
    if (all.size > most)
      return refuse(`${all.size} processes, more than POSTMASTER_HOST_STOP_MAX (${most})`);
    for (const pid of batch.sort((a, b) => a - b)) {
      const name = table.get(pid)!.name;
      const protectedWhy = protectedProcess(pid, name);
      if (protectedWhy) return refuse(`${pid}/${name} is ${protectedWhy}`);
      let current = pid;
      const seen = new Set<number>();
      let belongs = false;
      while (table.has(current) && !seen.has(current) && current !== 0 && current !== 1) {
        if (seeds.has(current) || groups.has(table.get(current)!.group)) {
          belongs = true;
          break;
        }
        seen.add(current);
        current = table.get(current)!.ppid;
      }
      if (!belongs) return refuse(`${pid}/${name} is not a process of these launches`);
    }
    killPids(batch, "SIGSTOP");
    batch.forEach((pid) => {
      frozen.add(pid);
    });
    table = processTable();
  }
  const known = new Map<number, string>(
    [...frozen].filter((pid) => table.has(pid)).map((pid) => [pid, table.get(pid)!.start]),
  );
  killPids(known.keys(), "SIGTERM");
  killPids(known.keys(), "SIGCONT");
  const leftNow = (current: Map<number, ProcRow>) =>
    new Set([
      ...[...known]
        .filter(
          ([pid, start]) =>
            current.has(pid) && current.get(pid)!.start === start && !current.get(pid)!.zombie,
        )
        .map(([pid]) => pid),
      ...treeFor(current, groups, seeds, spare),
    ]);
  const graceEnd = Date.now() + grace * 1000;
  while (Date.now() < graceEnd && leftNow(processTable()).size) await Bun.sleep(250);
  const killEnd = Date.now() + 5000;
  let survivors = new Set<number>();
  while (true) {
    table = processTable();
    survivors = leftNow(table);
    if (!survivors.size || Date.now() >= killEnd) break;
    killPids(survivors, "SIGKILL");
    for (const pid of survivors) if (table.has(pid)) known.set(pid, table.get(pid)!.start);
    await Bun.sleep(250);
  }
  const names = [...survivors]
    .sort((a, b) => a - b)
    .map((pid) => `${pid}/${table.get(pid)?.name ?? "unknown"}`)
    .join(" ");
  return { code: survivors.size ? 2 : 0, text: `${known.size}\t${names}` };
}
/** One workhorse, named and placed as the runbook's block did: the host owns the composition. */
async function workhorseCmd(args: string[]): Promise<void> {
  const [dispatch, lane, worktree] = args;
  if (args.length !== 3 || !dispatch || !lane || !worktree)
    die("usage: run host workhorse <dispatch> <lane> <worktree>");
  const d = absolute(dispatch);
  const name = nameCmd(d, "workhorse", lane);
  await runCmd([
    name,
    worktree,
    "--under",
    d,
    "--role",
    "lane",
    "--run",
    d,
    "--out",
    join(d, "logs", `${lane}-events.jsonl`),
    "--err",
    join(d, "logs", `${lane}.err`),
    "--marker",
    join(d, "logs", `${lane}.done`),
    "--",
    join(HERE, "run"),
    "launch",
    "launch",
    lane,
    worktree,
    join(d, `${lane}-prompt.txt`),
    "--last",
    join(d, "logs", `${lane}-last.md`),
    "--run",
    d,
  ]);
}

/** A process name as a pidfile records it: one line, since the form is line-based. */
function pidfileCommand(name: string): string {
  return name.split("\n")[0] ?? "";
}

/**
 * The leader's command once it is past every exec: a child read before it execs still
 * looks like its parent (same command line, stably, until it is scheduled), mid-exec
 * its command line can read empty, and the launch chain execs twice more — the spawned
 * wrapper becomes systemd-run, which execs the target in place after scope setup, a
 * D-Bus roundtrip no stability window can outwait — so a reading counts only past the
 * parent's command line, the transient names and the wrapper's own command line, and
 * the name is recorded after three such stable readings. "" when the process is gone
 * or never settles, in which case the pidfile holds no command.
 */
async function settledCommand(
  pid: number,
  spawned: string | null,
  wrapperPrefix: string | null,
): Promise<string> {
  const parent = processCommandLine(process.pid);
  // The chain's turning names: the wrapper run spawned, and a --scope systemd-run,
  // which always becomes its target (or, under a systemd that waits instead, the
  // record honestly degrades to start and boot). The plain path's wrapper is known
  // by its command line instead: a setsid phase by name would also match a target
  // that wraps itself, and a python phase by name would swallow a python target,
  // while the wrapper's own invocation matches nothing else.
  const transient = new Set([spawned, "systemd-run"]);
  let prev: string | null = null;
  let stable = 0;
  const end = Date.now() + 2000;
  for (;;) {
    const cur = processCommandLine(pid);
    const name = cur === "" ? "" : pidfileCommand(processInfo(pid)?.name ?? "");
    const wrapped = wrapperPrefix !== null && cur.startsWith(wrapperPrefix);
    const ready = cur !== "" && cur !== parent && name !== "" && !transient.has(name) && !wrapped;
    if (!ready) {
      if (cur === "" && processState(pid) === "absent") return "";
      // Unreadable but present (mid-exec, or a zombie awaiting reap), pre-exec, or a
      // turning name: none of it is the target, so wait it out.
      stable = 0;
      prev = null;
    } else if (cur === prev) {
      stable += 1;
      if (stable >= 2) return name;
    } else {
      stable = 0;
      prev = cur;
    }
    if (Date.now() >= end) return "";
    await Bun.sleep(10);
  }
}

/** A leftover member for the report: its command line, or its bare name. */
function describeCommand(pid: number, name: string): string {
  // ASCII: \s stays ASCII under u; collapsing ASCII runs is the whole of this report line.
  const line = clean(processCommandLine(pid).replace(/\s+/gu, " ").trim());
  if (line !== "") return line.slice(0, 200);
  return name;
}

/**
 * The process group a pidfile names, stopped as `stop` stops a worktree's launches.
 * A pidfile in the form `run` writes (pid, start, boot, command) stops only the launch it
 * recorded: the leader and its group die only while the recorded start, boot and command
 * still match the holder of the number, live or zombie. A legacy pidfile without the
 * command (pid, start, boot) is checked on start and boot alone. A bare pid stops
 * whatever live holder and group hold the number now. Members no check proves are never
 * killed: they are reported as leftover members, each pid with its command, and the stop
 * exits 2 so the caller sees it. Nothing here assumes a dead leader means an owned group:
 * a stranger's group may hold the number with a zombie leader or with none.
 */
async function stopPidfileCmd(args: string[]): Promise<void> {
  const file = args[0] ?? "";
  if (!file) die("usage: run host stop-pidfile <pidfile>");
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    die(`no such pidfile: ${file}`);
  }
  const parts = text.trim().split("\n");
  const pidText =
    parts.length === 1 || parts.length === 3 || parts.length === 4 ? (parts[0] ?? "") : "";
  if (!/^[0-9]+$/u.test(pidText)) die(`${file} does not hold a pid: ${text.trim()}`);
  const pid = Number(pidText);
  if (pid <= 0) die(`${file} does not hold a pid: ${text.trim()}`);
  const recorded = parts.length === 3 || parts.length === 4;
  const table = processTable();
  const row = table.get(pid);
  // The live members of the numbered group, the holder included: the processes a stop
  // would end. A zombie needs no killing and is never reported as leftover.
  const members = [...table]
    .filter(([, r]) => r.group === pid && !r.zombie)
    .map(([member]) => member)
    .sort((a, b) => a - b);
  const matches =
    recorded &&
    row !== undefined &&
    row.start === parts[1] &&
    sameBoot(parts[2], bootId()) &&
    (parts.length === 3 || pidfileCommand(row.name) === parts[3]);
  if (matches || (!recorded && row !== undefined && !row.zombie)) {
    // Proven, so the leader and its group die: through the group while the leader is
    // live, else through the proven members one by one, since a stop root needs a
    // live holder.
    const roots =
      row !== undefined && !row.zombie
        ? [`group|${pid}|${row.start}`]
        : members.map((member) => `tree|${member}|${table.get(member)!.start}`);
    if (roots.length === 0) {
      console.log(`no process group of ${pid} is running`);
      return;
    }
    const grace = count(process.env.POSTMASTER_HOST_STOP_WAIT ?? "20", "POSTMASTER_HOST_STOP_WAIT");
    const most = count(process.env.POSTMASTER_HOST_STOP_MAX ?? "512", "POSTMASTER_HOST_STOP_MAX");
    const result = await stopTree(grace, most, roots);
    const fields = result.text.split("\t");
    if (result.code === 0)
      console.log(`stopped the process group of ${pid}: ${fields[0]} process(es)`);
    else if (result.code === 2) {
      warn(`stopped the process group of ${pid}, but these still run: ${fields[1] ?? ""}`);
      throw hostError("", 2);
    } else if (result.code === 3) {
      warn(
        `refused to stop the process group of ${pid}, and left it running: ${fields.slice(1).join("\t")}`,
      );
      throw hostError("", 2);
    } else die(`could not stop the process group of ${pid}: ${result.text}`);
    return;
  }
  if (members.length === 0) {
    console.log(`no process group of ${pid} is running`);
    return;
  }
  const pairs = members
    .map((member) => `${member} ${describeCommand(member, table.get(member)!.name)}`)
    .join(", ");
  const reason = !recorded
    ? "the pidfile records no identity and the leader is gone"
    : row === undefined
      ? "the recorded leader is gone"
      : "the recorded identity does not match";
  warn(
    `left ${members.length} leftover member(s) of ${pid} running: ${pairs} (${reason}; killed nothing)`,
  );
  throw hostError("", 2);
}

async function stopCmd(args: string[]): Promise<void> {
  const path = worktreeArg(args[0] ?? "", "stop");
  if ((resolve(process.cwd()) + sep).startsWith(path + sep))
    die(`not stopping the launches in ${path} from inside it: that stops this session too`);
  const grace = count(process.env.POSTMASTER_HOST_STOP_WAIT ?? "20", "POSTMASTER_HOST_STOP_WAIT");
  const most = count(process.env.POSTMASTER_HOST_STOP_MAX ?? "512", "POSTMASTER_HOST_STOP_MAX");
  const scan = registryRoots(path);
  if (!scan.count) {
    console.log(`no launch is running in ${path}`);
    return;
  }
  const result = await stopTree(grace, most, scan.roots);
  const fields = result.text.split("\t");
  if (result.code === 0)
    console.log(`stopped ${scan.count} launch(es) in ${path}: ${fields[0]} process(es)`);
  else if (result.code === 2) {
    warn(`stopped ${scan.count} launch(es) in ${path}, but these still run: ${fields[1] ?? ""}`);
    throw hostError("", 2);
  } else if (result.code === 3) {
    warn(
      `refused to stop the launches in ${path}, and left them running: ${fields.slice(1).join("\t")}`,
    );
    throw hostError("", 2);
  } else die(`could not stop the launches in ${path}: ${result.text}`);
}
function worktreeArg(path: string, what: string): string {
  if (!path) die(`usage: run host ${what} <worktree>`);
  if (!existsSync(path) || !statSync(path).isDirectory()) die(`no such directory: ${path}`);
  return realpathSync(path);
}
async function closeCmd(args: string[]): Promise<void> {
  const path = worktreeArg(args[0] ?? "", "close");
  const patience = count(
    process.env.POSTMASTER_HOST_CLOSE_WAIT ?? "15",
    "POSTMASTER_HOST_CLOSE_WAIT",
  );
  for (let seconds = 0; ; seconds++) {
    const live = registryScan(path);
    if (!live.length) break;
    if (seconds >= patience)
      throw hostError(
        `a launch is still running in ${path}: ${live.map((item) => item.name).join(";")}`,
        2,
      );
    await Bun.sleep(1000);
  }
  let code = 0;
  if (has("tmux")) code = closeTmux(path) || code;
  if (herdrUp()) code = closeHerdr(path) || code;
  if (!code) console.log(`closed what run host opened for ${path}`);
  if (code) throw hostError("", code);
}

function noSessionHost(): never {
  die(
    "no Herdr or tmux here to keep an interactive session; run it headless as a native session (hosts.md, none)",
    3,
  );
}
function isKind(kind: string): boolean {
  const result = herdr(["agent"]);
  return `${result.err}\n${result.out}`.split(/\r?\n/u).some((line) => {
    if (!/^ *kinds: /u.test(line)) return false;
    return line
      .replace(/^ *kinds: /u, "")
      .split("|")
      .includes(kind);
  });
}
function tmuxTarget(handle: string): string {
  const result = run("tmux", ["list-windows", "-a", "-F", "#{window_id}\t#{window_name}"]);
  const hits = result.out
    .split(/\r?\n/u)
    .filter((line) => line.split("\t")[1] === handle)
    .map((line) => line.split("\t")[0]!);
  if (!hits.length) die(`no tmux window named ${handle}`);
  if (hits.length !== 1) die(`more than one tmux window is named ${handle}`);
  return hits[0]!;
}
function envOptions(prefix: string): string[] {
  const args: string[] = [];
  for (const [key, value] of Object.entries(process.env))
    if (key.startsWith(prefix) && value !== undefined) args.push("--env", `${key}=${value}`);
  return args;
}
function herdrReport(pid: number, name: string): Promise<void> {
  const pane = process.env.HERDR_PANE_ID ?? "";
  if (!pane) return Promise.resolve();
  herdr([
    "pane",
    "report-agent",
    pane,
    "--source",
    SOURCE,
    "--agent",
    "headless",
    "--state",
    "working",
  ]);
  herdr([
    "pane",
    "report-metadata",
    pane,
    "--source",
    META,
    "--title",
    name,
    "--display-agent",
    name,
    "--token",
    "postmaster=launch",
    "--token",
    "state=running",
    "--token",
    `pgid=${pid}`,
  ]);
  return (async () => {
    while (processState(pid) === "live") await Bun.sleep(250);
    herdr(["pane", "release-agent", pane, "--source", SOURCE, "--agent", "headless"]);
    herdr([
      "pane",
      "report-metadata",
      pane,
      "--source",
      META,
      "--title",
      name,
      "--display-agent",
      name,
      "--token",
      "postmaster=launch",
      "--token",
      "state=done",
      "--token",
      `pgid=${pid}`,
    ]);
  })();
}
function spawnCmd(args: string[]): void {
  const originalHandle = args[0] ?? "";
  const givenCwd = args[1] ?? "";
  if (!originalHandle || !givenCwd)
    die("usage: run host spawn <handle> <cwd> [--label <text>] -- <command...>");
  let label = "";
  let at = 2;
  while (at < args.length) {
    if (args[at] === "--label") {
      if (!args[at + 1]) die("--label needs text");
      label = args[at + 1]!;
      at += 2;
    } else if (args[at] === "--") {
      at++;
      break;
    } else die(`unknown option for spawn: ${args[at]}`);
  }
  const commandArgs = args.slice(at);
  if (!commandArgs.length) die("spawn needs a command after --");
  if (!existsSync(givenCwd) || !statSync(givenCwd).isDirectory())
    die(`no such directory: ${givenCwd}`);
  const cwd = realpathSync(givenCwd);
  label = clean(label || originalHandle);
  const handle = handleOf(originalHandle);
  const postmasterEnv = Object.entries(process.env)
    .filter(([key]) => key.startsWith("POSTMASTER_") && process.env[key] !== undefined)
    .flatMap(([key, value]) => ["-e", `${key}=${value}`]);
  PLACE_ENV = envOptions("POSTMASTER_");
  const host = detect();
  if (host === "herdr") {
    if (herdr(["agent", "get", handle]).code === 0)
      die(`a live Herdr agent is already named ${handle}; spawn under another handle`);
    const placed = herdrPlace(label, cwd, "repo", "", handle);
    if (!placed) die(`Herdr could not open a tab for ${handle}`);
    const kind = basename(commandArgs[0]!);
    if (isKind(kind)) {
      const started = herdr([
        "agent",
        "start",
        handle,
        "--kind",
        kind,
        "--pane",
        placed.pane,
        "--",
        ...commandArgs.slice(1),
      ]);
      if (started.code !== 0) {
        const code = parseJson(started.err)?.error?.code;
        if (code === "agent_not_ready")
          warn(
            handle +
              " is asking something before it takes a message; the user answers it in space " +
              placed.space +
              ", then send",
          );
        else die(`herdr could not start ${handle}: ${code || started.err.trim()}`);
      }
    } else {
      const shellCommand = commandArgs.map(quote).join(" ");
      if (herdr(["pane", "run", placed.pane, shellCommand]).code !== 0)
        die(`herdr could not start ${handle}`);
      herdr(["agent", "rename", placed.pane, handle]);
    }
    console.log(
      `host=herdr space=${placed.space} tab=${placed.tab} pane=${placed.pane} handle=${handle}`,
    );
    return;
  }
  if (host === "tmux") {
    const listed = run("tmux", ["list-windows", "-a", "-F", "#{window_name}"]);
    if (listed.out.split(/\r?\n/u).filter((window) => window === handle).length)
      die(`a tmux window is already named ${handle}; spawn under another handle`);
    const session = tmuxSession(cwd);
    let result: ReturnType<typeof run>;
    if (run("tmux", ["has-session", "-t", `=${session}`]).code === 0)
      result = run("tmux", [
        "new-window",
        "-d",
        "-P",
        "-F",
        "#{window_id}",
        "-t",
        `=${session}:`,
        ...postmasterEnv,
        "-n",
        handle,
        "-c",
        cwd,
        ...commandArgs,
      ]);
    else
      result = run("tmux", [
        "new-session",
        "-d",
        "-P",
        "-F",
        "#{window_id}",
        "-s",
        session,
        ...postmasterEnv,
        "-n",
        handle,
        "-c",
        cwd,
        ...commandArgs,
      ]);
    const window = result.out.trim();
    if (!window) die(`tmux could not start ${handle}`);
    run("tmux", ["set-option", "-w", "-t", window, "@postmaster_cwd", cwd]);
    run("tmux", ["set-option", "-w", "-t", window, "@postmaster_handle", handle]);
    run("tmux", ["set-option", "-w", "-t", window, "automatic-rename", "off"]);
    const pane = run("tmux", ["display-message", "-p", "-t", window, "#{pane_id}"]).out.trim();
    if (pane) {
      run("tmux", ["set-option", "-p", "-t", pane, "@postmaster_owned", "yes"]);
      run("tmux", ["set-option", "-w", "-t", window, "@postmaster_pane", pane]);
    }
    console.log(`host=tmux session=${session} window=${window} handle=${handle}`);
    return;
  }
  noSessionHost();
}
async function sendCmd(args: string[]): Promise<void> {
  const rawHandle = args[0] ?? "",
    file = args[1] ?? "";
  if (!rawHandle || !file) die("usage: run host send <handle> <file> [--wait [<seconds>]]");
  const waitFor = args[2] === "--wait" ? count(args[3] ?? "600", "seconds") : null;
  const handle = handleOf(rawHandle);
  if (!existsSync(file) || !statSync(file).isFile()) die(`no such file: ${file}`);
  const host = detect();
  if (host === "herdr") {
    const text = readFileSync(file, "utf8");
    if (waitFor === null) {
      if (herdr(["agent", "prompt", handle, text]).code !== 0)
        die(`herdr could not prompt ${handle}`);
    } else {
      const result = herdr([
        "agent",
        "prompt",
        handle,
        text,
        "--wait",
        "--timeout",
        String(waitFor * 1000),
      ]);
      if (result.code !== 0) {
        const code = parseJson(result.err)?.error?.code;
        if (code === "agent_prompt_stalled")
          die(
            `${handle} got the message, but Herdr saw no turn start; read the session before sending it again`,
            3,
          );
        if (code === "agent_blocked")
          die(`${handle} is at an approval or a question; the user answers it in Herdr first`, 3);
        if (code === "timeout") {
          console.log(`sent; ${handle} did not settle within ${waitFor}s`);
          throw hostError("", 3);
        }
        die(`herdr could not prompt ${handle}: ${code || result.err.trim()}`);
      }
      const status = herdrData(["agent", "get", handle])?.agent?.agent_status;
      if (status === "blocked") {
        console.log(
          `sent; ${handle} stopped at an approval or a question: the user answers it in Herdr`,
        );
        throw hostError("", 3);
      }
    }
  } else if (host === "tmux") {
    const target = tmuxTarget(handle);
    const buffer = `postmaster-send-${process.pid}`;
    if (
      run("tmux", ["load-buffer", "-b", buffer, file]).code !== 0 ||
      run("tmux", ["paste-buffer", "-p", "-d", "-b", buffer, "-t", target]).code !== 0
    )
      die(`tmux could not paste into ${handle}`);
    await Bun.sleep(500);
    run("tmux", ["send-keys", "-t", target, "Enter"]);
    if (waitFor !== null)
      try {
        await waitCmd([handle, String(waitFor)]);
      } catch {
        console.log(`sent; ${handle} did not settle within ${waitFor}s`);
        throw hostError("", 3);
      }
  } else noSessionHost();
  const byteCount = readFileSync(file).length;
  console.log(`sent ${byteCount} bytes to ${handle}${waitFor !== null ? ", and it settled" : ""}`);
}
async function waitCmd(args: string[]): Promise<void> {
  const rawHandle = args[0] ?? "";
  if (!rawHandle) die("usage: run host wait <handle> [<seconds>]");
  const seconds = count(args[1] ?? "600", "seconds");
  const handle = handleOf(rawHandle);
  const host = detect();
  if (host === "herdr") {
    const result = herdr(["agent", "wait", handle, "--timeout", String(seconds * 1000)]);
    if (result.code !== 0) {
      console.log(`${handle} did not settle within ${seconds}s`);
      throw hostError("", 3);
    }
    if (herdrData(["agent", "get", handle])?.agent?.agent_status === "blocked") {
      console.log(`${handle} stopped at an approval or a question: the user answers it in Herdr`);
      throw hostError("", 3);
    }
    console.log(`${handle} settled`);
    return;
  }
  if (host === "tmux") {
    const quiet = count(process.env.POSTMASTER_HOST_QUIET ?? "10", "POSTMASTER_HOST_QUIET");
    const target = tmuxTarget(handle);
    const end = Date.now() + seconds * 1000;
    let last = "",
      same = 0;
    while (Date.now() < end) {
      const read = run("tmux", ["capture-pane", "-p", "-t", target]);
      if (read.code !== 0) die(`tmux cannot read ${handle}`);
      if (read.out === last) same++;
      else {
        same = 0;
        last = read.out;
      }
      if (same >= quiet) {
        console.log(`${handle} settled`);
        return;
      }
      await Bun.sleep(1000);
    }
    console.log(`${handle} did not settle within ${seconds}s`);
    throw hostError("", 3);
  }
  noSessionHost();
}
function readCmd(args: string[]): void {
  const rawHandle = args[0] ?? "";
  if (!rawHandle) die("usage: run host read <handle> [<lines>]");
  const lines = count(args[1] ?? "120", "lines");
  const handle = handleOf(rawHandle);
  const host = detect();
  if (host === "herdr") {
    const result = herdr([
      "agent",
      "read",
      handle,
      "--source",
      "recent-unwrapped",
      "--lines",
      String(lines),
    ]);
    if (result.out) process.stdout.write(result.out);
    if (result.err) process.stderr.write(result.err);
    if (result.code) throw hostError("", result.code);
  } else if (host === "tmux") {
    const target = tmuxTarget(handle);
    const result = run("tmux", ["capture-pane", "-p", "-J", "-S", `-${lines}`, "-t", target]);
    if (result.out) process.stdout.write(result.out);
    if (result.err) process.stderr.write(result.err);
    if (result.code) throw hostError("", result.code);
  } else noSessionHost();
}
// A spawned session still shows: a live Herdr agent under the handle, a
// recorded pane that still answers, or a tmux window carrying its tag. A
// shell spawn registers no agent and a user rename changes the window name,
// so neither the agent list nor the name decides alone. Gone servers hold no
// sessions.
function sessionPresent(handle: string): boolean {
  if (herdrUp()) {
    if (herdr(["agent", "get", handle]).code === 0) return true;
    for (const file of placementFiles()) {
      let item: Record<string, unknown> | null = null;
      try {
        item = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
      if (item.handle !== handle) continue;
      if (typeof item.pane !== "string" || !item.pane) continue;
      if (herdr(["pane", "get", item.pane]).code === 0) return true;
    }
  }
  if (has("tmux")) {
    const rows = run("tmux", [
      "list-windows",
      "-a",
      "-F",
      "#{window_id}\t#{window_name}\t#{@postmaster_cwd}\t#{@postmaster_handle}\t#{@postmaster_pane}",
    ]);
    if (rows.code === 0) {
      for (const line of pySplitLines(rows.out)) {
        const cells = line.split("\t");
        if (cells[0] && cells[3] === handle) return true;
      }
    }
  }
  return false;
}
function closeHandleHerdr(handle: string): { code: number; found: boolean } {
  const records: Array<{ file: string; space: string; tab: string; pane: string }> = [];
  for (const file of placementFiles()) {
    let item: Record<string, unknown> | null = null;
    try {
      item = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
    if (item.handle !== handle) continue;
    if (
      typeof item.workspace !== "string" ||
      typeof item.tab !== "string" ||
      typeof item.pane !== "string"
    )
      continue;
    records.push({ file, space: item.workspace, tab: item.tab, pane: item.pane });
  }
  if (!records.length) {
    if (herdr(["agent", "get", handle]).code === 0) {
      warn(`session ${handle} is live but run host recorded no tab for it; left it open`);
      return { code: 2, found: true };
    }
    return { code: 0, found: false };
  }
  let rc = 0;
  for (const rec of records) {
    if (herdrCloseOnePlacement(rec.space, rec.tab, rec.pane, rec.file, "session") !== 0) rc = 2;
  }
  return { code: rc, found: true };
}
function closeHandleTmux(handle: string): { code: number; found: boolean } {
  const rows = run("tmux", [
    "list-windows",
    "-a",
    "-F",
    "#{window_id}\t#{window_name}\t#{@postmaster_cwd}\t#{@postmaster_handle}\t#{@postmaster_pane}",
  ]);
  if (rows.code !== 0) {
    if (run("tmux", ["ls"]).code !== 0) return { code: 0, found: false };
    warn(`could not inspect tmux windows for session ${handle}; left it open`);
    return { code: 2, found: true };
  }
  const hits: Array<{ window: string; pane: string }> = [];
  let named = "";
  for (const line of pySplitLines(rows.out)) {
    const [w, name, , tag, ...paneRest] = line.split("\t");
    if (!w) continue;
    if (tag === handle) hits.push({ window: w, pane: paneRest.join("\t") });
    if (name === handle) named = w;
  }
  if (!hits.length) {
    if (named) {
      warn(`tmux window ${named} is named ${handle} but run host did not open it; left it open`);
      return { code: 2, found: true };
    }
    return { code: 0, found: false };
  }
  let rc = 0;
  for (const hit of hits) {
    if (tmuxCloseWindow(hit.window, hit.pane) !== 0) rc = 2;
    else console.log(`host=tmux: closed session window ${hit.window}`);
  }
  return { code: rc, found: true };
}
// Every session recorded under the handle closes, on each host that
// answers: handles are unique per spawn, so two matches means two spawns
// under one name, and a close that left one behind would lie about it.
function closeHandleCore(handle: string): number {
  let rc = 0;
  let found = false;
  if (has("tmux")) {
    const tm = closeHandleTmux(handle);
    if (tm.code !== 0) rc = tm.code;
    found = found || tm.found;
  }
  if (herdrUp()) {
    const hd = closeHandleHerdr(handle);
    if (hd.code !== 0) rc = hd.code;
    found = found || hd.found;
  }
  if (rc !== 0) return rc;
  console.log(found ? `closed ${handle}` : `no session ${handle}`);
  return 0;
}
function closeHandleCmd(args: string[]): void {
  const raw = args[0] ?? "";
  if (!raw || args.length !== 1) die("usage: run host close-handle <handle>");
  const rc = closeHandleCore(handleOf(raw));
  if (rc !== 0) throw hostError("", rc);
}
// A booking clerk session after its ticket is marked ready: ticket-ready mark
// starts this detached, since the mark runs inside the session's own turn. It
// waits for the turn to end, closes that one session, and drops its record.
// The handle arrives on the command line, bound at marking: the record is
// read only to drop it, so a replacement session recorded since is never
// waited on or closed here. The record goes only when it still names this
// session: a new clerk for the same ticket starts under another handle and is
// never touched here.
async function clerkCloseCmd(args: string[]): Promise<void> {
  const repo = args[0] ?? "";
  const id = args[1] ?? "";
  const handle = args[2] ?? "";
  if (!repo || !id || !handle || args.length !== 3)
    die("usage: run host _clerk-close <repo> <id> <handle>");
  const drop = (): void => {
    try {
      const raw = JSON.parse(readFileSync(clerkSessionPath(repo, id), "utf8")) as {
        handle?: unknown;
      };
      if (raw.handle === handle) rmSync(clerkSessionPath(repo, id), { force: true });
    } catch {}
  };
  const settled = handleOf(handle);
  if (!sessionPresent(settled)) {
    console.log(`${handle} is already gone; dropping its record`);
    const gone = closeHandleCore(settled);
    if (gone !== 0) throw hostError("", gone);
    drop();
    return;
  }
  let patience = 600;
  try {
    patience = count(process.env.POSTMASTER_CLERK_CLOSE_WAIT ?? "600", "seconds");
  } catch (error) {
    warn(
      `POSTMASTER_CLERK_CLOSE_WAIT is not a number; waiting 600s: ${String((error as Error).message)}`,
    );
  }
  try {
    await waitCmd([handle, String(patience)]);
  } catch (error) {
    if (!sessionPresent(settled)) {
      const gone = closeHandleCore(settled);
      if (gone !== 0) throw hostError("", gone);
      drop();
      return;
    }
    throw error;
  }
  const rc = closeHandleCore(settled);
  if (rc !== 0) throw hostError("", rc);
  drop();
  console.log(`closed clerk session ${handle}`);
}

// --- coachman legs ---------------------------------------------------------------------------
// One attempt at a time per leg, every attempt recorded: a start validates, takes the leg's
// lock, backfills whatever died unrecorded, writes its intent and phase, and runs _leg_exec,
// which owns the lock, runs run launch, and classifies the attempt from its stream slice.
const LEG_WALL_TERMS = [
  "quota",
  "usage limit",
  "rate limit",
  "payment required",
  "insufficient_quota",
  "overloaded",
  "resource exhausted",
  "spawn failed",
  "failed to spawn",
  "stale session lock",
  "session lock",
];
// Python int(): surrounding whitespace stripped, an optional sign, digits with underscores
// between them; anything else is not a number.
const PY_INT = /^[+-]?[0-9]([0-9_]*[0-9])?$/u;
function pyIntStrict(text: string): number | null {
  const trimmed = text.trim();
  if (!PY_INT.test(trimmed)) return null;
  return Number(trimmed.replace(/_/gu, ""));
}
// Python int() over a JSON value: booleans count, floats truncate, strings parse, the rest
// is not a number. Missing values read as the default first.
function pyIntJson(value: unknown, dflt: number): number | null {
  if (value === undefined) value = dflt;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") return Number.isFinite(value) ? Math.trunc(value) : null;
  if (typeof value === "string") return pyIntStrict(value);
  return null;
}
// Python str(value or ""): a falsy value reads empty, the rest reads as written.
function intentStr(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "True" : "False";
  if (Array.isArray(value)) return value.length ? JSON.stringify(value) : "";
  if (typeof value === "object") return Object.keys(value).length ? JSON.stringify(value) : "";
  return "";
}
// Python json.dumps with the default ensure_ascii: structure prints as JSON does, every
// non-ASCII character escapes as \uXXXX, astral ones as a surrogate pair. Only DEL and up
// needs escaping: JSON.stringify already escapes every C0 control inside strings, so any
// raw one left in the output is indent structure, which stays literal.
function dumps(value: unknown, indent?: number): string {
  return JSON.stringify(value, null, indent ?? 0).replace(/[\x7f-\u{10ffff}]/gu, (ch) => {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp > 0xffff) {
      const hi = Math.floor((cp - 0x10000) / 0x400) + 0xd800;
      const lo = ((cp - 0x10000) % 0x400) + 0xdc00;
      return `\\u${hi.toString(16).padStart(4, "0")}\\u${lo.toString(16).padStart(4, "0")}`;
    }
    return `\\u${cp.toString(16).padStart(4, "0")}`;
  });
}
function legNumber(text: string): number {
  const n = count(text, "leg number");
  if (n <= 0) die("leg number must be positive");
  return n;
}
// A process's start time in the lock's owner format, or null when it has none.
function legStartOf(pid: number): string | null {
  return processStart(pid);
}
// This process's start time, in the lock's owner format.
function legSelfStart(): string | null {
  return processStart(process.pid);
}
// End a newline-less tail line, if the file has one: a record write torn by a kill leaves a
// tail with no line terminator, and the next append would fuse onto it and stay corrupt.
function legTerminateTail(path: string): void {
  try {
    const fd = openSync(path, "r+");
    try {
      const size = fstatSync(fd).size;
      if (size > 0) {
        const last = Buffer.alloc(1);
        readSync(fd, last, 0, 1, size - 1);
        // An explicit position: a positioned read leaves the offset where it was, so a
        // position-less write would land at the start of the file instead of its end.
        if (last[0] !== 10) writeSync(fd, "\n", size, "utf8");
      }
    } finally {
      try {
        closeSync(fd);
      } catch {}
    }
  } catch {}
}
// fcntl.flock has no Node spelling, so the leg mutex is a lock file holding the owner's pid,
// after run-meta.ts: O_EXCL creation is the mutual exclusion, and only a dead owner loses
// it — kill(pid, 0) refusing ESRCH — or a file empty and older than five seconds, the bash
// flow's resting state, which carries no owner either way. Anything else waits; a fresh
// empty file is a creator between its creation and its pid write. The mutex serializes the
// check-and-write sections only — acquire, claim and release each drop it before returning —
// so a kill mid-section leaves a dead owner's file the next take steals.
type MutexVerdict = "absent" | "live" | "dead";
function legMutexVerdict(mutexPath: string): { verdict: MutexVerdict; text: string | null } {
  let text: string;
  try {
    text = readFileSync(mutexPath, "utf8");
  } catch (error) {
    return {
      verdict: (error as NodeJS.ErrnoException)?.code === "ENOENT" ? "absent" : "live",
      text: null,
    };
  }
  if (text.trim() === "") {
    try {
      return {
        verdict: Date.now() - statSync(mutexPath).mtimeMs > 5000 ? "dead" : "live",
        text,
      };
    } catch {
      return { verdict: "dead", text };
    }
  }
  const pid = Number(text.trim());
  if (!Number.isInteger(pid) || pid <= 0) return { verdict: "live", text };
  return { verdict: processState(pid) !== "live" ? "dead" : "live", text };
}
type MutexTake = { status: "taken" } | { status: "busy" } | { status: "error"; error: unknown };
// The steal re-verifies the file it verdicts: the verdict names a pid, but the
// unlink acts on a path, and a verdict that spans a drop and a fresh create —
// the old owner exits after dropping, the liveness check straddles it — would
// otherwise unlink the fresh holder's file and hold the mutex beside it. Only
// a file still carrying the dead verdict's content is stolen; anything else
// waits for the next try. Callers whose write must survive still verify it
// after the write and redo, rather than trusting the hold alone.
function legMutexRead(mutexPath: string): string | null {
  try {
    return readFileSync(mutexPath, "utf8");
  } catch {
    return null;
  }
}
function legMutexTake(mutexPath: string, maxTries: number): MutexTake {
  for (let i = 0; maxTries < 0 || i < maxTries; i++) {
    try {
      const fd = openSync(mutexPath, "wx", 0o644);
      try {
        writeSync(fd, `${process.pid}\n`);
      } catch {}
      try {
        closeSync(fd);
      } catch {}
      return { status: "taken" };
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") return { status: "error", error };
      // A file already gone steals nothing, and a file changed since the
      // verdict belongs to a fresh holder: unlinking either would take a live
      // file with it. Only the dead verdict's own content is stolen.
      const seen = legMutexVerdict(mutexPath);
      if (seen.verdict === "dead" && seen.text !== null && legMutexRead(mutexPath) === seen.text) {
        try {
          rmSync(mutexPath, { force: true });
        } catch {}
      }
      sleepSync(10);
    }
  }
  return { status: "busy" };
}
function legMutexDrop(mutexPath: string): void {
  try {
    rmSync(mutexPath, { force: true });
  } catch {}
}
// Hold the leg's lock, or refuse: the fast path is one atomic create, the slow path decides
// under the mutex, so two starters never both proceed. A lock is stolen only when its owner
// is dead; a live owner refuses, however stale the markers look. 0 holds, 1 refuses on a
// live owner, 2 on another starter, 3 on an internal error taking the lock at all.
function legAcquire(lock: string, mutexPath: string, selfPid: number): number {
  const selfStart = legStartOf(selfPid);
  if (selfStart === null) {
    console.error("cannot establish attempt ownership: the starter has no readable start time");
    return 3;
  }
  const claim = (): boolean => {
    try {
      const fd = openSync(lock, "wx", 0o666);
      try {
        writeSync(fd, `${selfPid} ${selfStart}\n`);
      } catch {}
      try {
        closeSync(fd);
      } catch {}
      return true;
    } catch {
      return false;
    }
  };
  if (claim()) return 0;
  const take = legMutexTake(mutexPath, 200);
  if (take.status === "error") {
    console.error("cannot open the start mutex");
    return 3;
  }
  if (take.status === "busy") return 2;
  try {
    if (claim()) return 0;
    let owner: number | null = null;
    let ownerStart: string | null = null;
    try {
      const content = readFileSync(lock, "utf8").trim();
      const at = content.indexOf(" ");
      owner = pyIntStrict(at === -1 ? content : content.slice(0, at));
      ownerStart = owner === null ? null : at === -1 ? "" : content.slice(at + 1);
    } catch {
      owner = null;
      ownerStart = null;
    }
    if (owner !== null && ownerStart !== null && legStartOf(owner) === ownerStart) {
      console.error("leg already has an active attempt");
      return 1;
    }
    // A present lock with no readable owner is a creator mid-write (create and
    // the pid write are two calls) or a dead creator's remnant. Main steals it
    // at once, racing the creator; the port refuses a fresh one as another
    // start in progress and steals only once no live creator can be mid-write.
    if (owner === null || ownerStart === null || ownerStart === "") {
      let fresh = true;
      try {
        const st = statSync(lock);
        fresh = !st.isDirectory() && Date.now() - st.mtimeMs <= 5000;
      } catch {
        fresh = false;
      }
      if (fresh) return 2;
    }
    try {
      if (statSync(lock).isDirectory()) rmdirSync(lock);
      else unlinkSync(lock);
    } catch {
      console.error("leg already has an active attempt");
      return 1;
    }
    if (!claim()) {
      console.error("leg already has an active attempt");
      return 1;
    }
    return 0;
  } finally {
    legMutexDrop(mutexPath);
  }
}
// Release a lock taken by legAcquire, only if it still names this process. The check and
// the removal hold the mutex, so a steal decision in another process cannot land between
// them. A lock naming another owner is kept; a legacy empty dir holds no owner and is always
// releasable. Best-effort: a mutex that cannot be taken keeps the claim, and the next start
// steals it once this process is gone.
function legRelease(lock: string, mutexPath: string): void {
  const start = legSelfStart() ?? "";
  if (legMutexTake(mutexPath, -1).status !== "taken") return;
  try {
    let content: string | null = null;
    try {
      content = readFileSync(lock, "utf8").trim();
    } catch {}
    if (content !== null && content !== `${process.pid} ${start}`) return;
    try {
      unlinkSync(lock);
    } catch {}
    try {
      rmdirSync(lock);
    } catch {}
  } finally {
    legMutexDrop(mutexPath);
  }
}
// The launch owns the lock: replace the starter's identity with its own, through a
// temporary file, so a concurrent reader sees the starter or the launch, never an empty
// lock. Only a lock naming the starter, the launch or nothing readable is replaced; a lock
// naming anyone else aborts the attempt rather than risk joining it.
function legClaim(
  lock: string,
  mutexPath: string,
  starterPid: string,
  starterStart: string,
): boolean {
  const start = legSelfStart();
  if (!start) return false;
  const mine = `${process.pid} ${start}`;
  const take = legMutexTake(mutexPath, -1);
  if (take.status !== "taken") {
    console.error(
      `leg: cannot open the start mutex: ${spawnStrerror(take.status === "error" ? take.error : null)}`,
    );
    return false;
  }
  try {
    let content = "";
    try {
      content = readFileSync(lock, "utf8").trim();
    } catch {}
    if (content !== "" && content !== `${starterPid} ${starterStart}` && content !== mine) {
      console.error("leg: the lock names another attempt; not starting");
      return false;
    }
    let tmp = "";
    try {
      tmp = mkstempSync(dirname(lock) || ".", ".owner.");
      writeFileSync(tmp, `${mine}\n`);
      renameSync(tmp, lock);
    } catch (error) {
      if (tmp) {
        try {
          rmSync(tmp, { force: true });
        } catch {}
      }
      console.error(`leg: cannot own the lock: ${spawnStrerror(error)}`);
      return false;
    }
    return true;
  } finally {
    legMutexDrop(mutexPath);
  }
}
// The last attempt's retry fields: request, role, prompt, thread id, outcome.
function legLatest(attempts: string): [string, string, string, string, string] | null {
  let rows: string[];
  try {
    rows = readFileSync(attempts, "utf8")
      .split("\n")
      .filter((line) => pyTrim(line) !== "");
  } catch {
    return null;
  }
  if (!rows.length) return null;
  // A torn tail is superseded history, not the record: a retry reads past it to
  // the newest line that parses, so one crashed append never wedges the leg.
  let rec: Record<string, unknown> | null = null;
  for (let i = rows.length - 1; i >= 0 && rec === null; i--) {
    try {
      const row: unknown = JSON.parse(rows[i] ?? "");
      if (typeof row === "object" && row !== null && !Array.isArray(row))
        rec = row as Record<string, unknown>;
    } catch {
      // keep walking upward past the torn line
    }
  }
  if (rec === null) return null;
  return [
    intentStr(rec.request),
    intentStr(rec.role),
    intentStr(rec.prompt),
    intentStr(rec.thread_id),
    intentStr(rec.outcome),
  ];
}
// One classifier for a live attempt and a backfilled one: scan this attempt's stream slice
// for structured wall events, classify from phase, wall, thread and hand-off, append the
// record, update the manifest. start and end are byte offsets into the stream; an empty end
// means EOF.
function legClassify(params: {
  d: string;
  wt: string;
  leg: string;
  n: string;
  request: string;
  role: string;
  prompt: string;
  thread: string;
  stream: string;
  done: string;
  attempts: string;
  attempt: string;
  phase: string;
  wall: string;
  rc: string;
  start: string;
  end: string;
  backfilled: string;
}): void {
  const p = params;
  legTerminateTail(p.attempts);
  const number = Number(p.n);
  let raw: Buffer;
  try {
    raw = readFileSync(p.stream);
  } catch {
    raw = Buffer.alloc(0);
  }
  let startOff = Math.max(0, pyIntStrict(p.start) ?? 0);
  let endOff = p.end === "" ? raw.length : (pyIntStrict(p.end) ?? raw.length);
  if (startOff > raw.length) startOff = raw.length;
  if (endOff > raw.length || endOff < startOff) endOff = raw.length;
  let text = new TextDecoder("utf-8").decode(raw.subarray(startOff, endOff));
  let phaseValue = "refused";
  try {
    phaseValue = pyTrim(readFileSync(p.phase, "utf8"));
  } catch {}
  if (phaseValue !== "started") {
    // Only a started attempt is scanned. Anything else — refused, missing, empty or
    // foreign — means the harness never ran for this attempt, so no event here is its. The
    // record keeps the intent's thread only.
    text = "";
  }
  const dictField = (value: unknown): string => {
    if (value === undefined) return "";
    if (value === null) return "None";
    if (typeof value === "string") return value;
    if (typeof value === "number") return String(value);
    if (typeof value === "boolean") return value ? "True" : "False";
    return JSON.stringify(value) ?? "";
  };
  const selected = (value: unknown): string => {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      const rec = value as Record<string, unknown>;
      return ["code", "status", "message", "type", "subtype", "error"]
        .map((key) => dictField(rec[key]))
        .join(" ");
    }
    if (!value) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number") return String(value);
    if (typeof value === "boolean") return value ? "True" : "False";
    return Array.isArray(value) && value.length ? JSON.stringify(value) : "";
  };
  const isWall = (value: unknown): boolean => {
    const s = casefold(selected(value));
    const code = new RegExp(`${BOUND_L}(?:402|429)${BOUND_R}`, "u");
    return code.test(s) || LEG_WALL_TERMS.some((term) => s.includes(term));
  };
  for (const line of pySplitLines(text)) {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof event !== "object" || event === null || Array.isArray(event)) continue;
    const ev = event as Record<string, unknown>;
    if (ev.type === "rate_limit_event") {
      const info = ev.rate_limit_info;
      const status =
        typeof info === "object" && info !== null && !Array.isArray(info)
          ? (info as Record<string, unknown>).status
          : undefined;
      if (status !== undefined && status !== null && status !== "allowed") {
        writeFileSync(p.wall, "wall\n");
        break;
      }
    }
    if (
      ev.type === "error" ||
      ev.type === "thread.failed" ||
      ev.type === "response.failed" ||
      ev.type === "response.error"
    ) {
      if (isWall(ev.error) || isWall(ev)) {
        writeFileSync(p.wall, "wall\n");
        break;
      }
    }
  }
  let walled = false;
  try {
    walled = statSync(p.wall).isFile();
  } catch {
    walled = false;
  }
  let handoff = false;
  try {
    handoff = statSync(p.done).isFile();
  } catch {
    handoff = false;
  }
  let runStore: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(p.d, "run.json"), "utf8"));
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed))
      runStore = parsed as Record<string, unknown>;
  } catch {}
  const cfg = asRecord(runStore.config);
  const team = asRecord(cfg.team);
  let spec: unknown = team[p.role === "coachman_fallback" ? "coachman_fallback" : "coachman"] ?? {};
  if (
    p.role === "coachman" &&
    typeof team.coachman_legs === "object" &&
    team.coachman_legs !== null &&
    !Array.isArray(team.coachman_legs)
  ) {
    const legSpec = (team.coachman_legs as Record<string, unknown>)[p.leg];
    if (legSpec !== undefined) spec = legSpec;
  }
  const harness =
    typeof spec === "object" && spec !== null && !Array.isArray(spec)
      ? String((spec as Record<string, unknown>).harness ?? "")
      : "";
  const idKeys: readonly string[] =
    (
      {
        codex: ["thread_id"],
        grok: ["thread_id", "session_id", "sessionId", "conversationId", "uuid"],
        agy: ["conversationId", "conversation_id"],
        claude: ["session_id"],
        pi: [],
        muse: [],
        mimo: ["sessionID", "session_id"],
      } as Record<string, string[]>
    )[harness] ?? [];
  let thread: unknown = p.thread || "";
  if (!thread) {
    for (const line of pySplitLines(text)) {
      let event: unknown;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof event !== "object" || event === null || Array.isArray(event)) continue;
      const ev = event as Record<string, unknown>;
      if (
        harness === "muse" &&
        typeof ev.stream === "object" &&
        ev.stream !== null &&
        !Array.isArray(ev.stream) &&
        (ev.stream as Record<string, unknown>).kind === "session"
      ) {
        const id = (ev.stream as Record<string, unknown>).id;
        thread = thread || (id === undefined ? "" : id);
      }
      if (harness === "pi" && ev.type === "session") {
        thread = thread || (ev.id === undefined ? "" : ev.id);
      }
      for (const key of idKeys) {
        const value = ev[key];
        if (typeof value === "string" && value) {
          thread = thread || value;
          break;
        }
      }
      if (thread) break;
    }
  }
  let outcome: string;
  if (handoff) outcome = "finished";
  else if (phaseValue !== "started") outcome = "refused";
  else if (walled) outcome = "walled";
  else if (!thread) outcome = "pre-thread";
  else outcome = "incomplete";
  let onAnswer: string;
  if (
    outcome === "refused" ||
    outcome === "pre-thread" ||
    (outcome === "walled" && p.role === "coachman_fallback")
  )
    onAnswer = "retry";
  else if (outcome === "incomplete") onAnswer = "resume";
  else onAnswer = "none";
  const record = {
    attempt: Number(p.attempt),
    leg: number,
    name: p.leg,
    request: p.request,
    role: p.role,
    prompt: p.prompt,
    thread_id: thread,
    outcome,
    on_answer: onAnswer,
    backfilled: p.backfilled === "1",
    exit: pyIntStrict(p.rc) ?? -1,
    ended: new Date().toISOString(),
  };
  writeFileSync(p.attempts, `${dumps(record)}\n`, { flag: "a" });
  try {
    const manifestPath = join(p.d, "manifest.json");
    const parsed: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return;
    const manifest = parsed as Record<string, unknown>;
    if (manifest.coachman === undefined) manifest.coachman = {};
    if (
      typeof manifest.coachman !== "object" ||
      manifest.coachman === null ||
      Array.isArray(manifest.coachman)
    )
      return;
    const coachman = manifest.coachman as Record<string, unknown>;
    if (coachman.legs === undefined) coachman.legs = {};
    if (typeof coachman.legs !== "object" || coachman.legs === null || Array.isArray(coachman.legs))
      return;
    const legs = coachman.legs as Record<string, unknown>;
    const key = String(number);
    if (legs[key] === undefined) legs[key] = {};
    if (typeof legs[key] !== "object" || legs[key] === null || Array.isArray(legs[key])) return;
    const item = legs[key] as Record<string, unknown>;
    item.name = p.role;
    item.role = p.role;
    if (thread) item.thread_id = thread;
    const tmp = mkstempSync(p.d, ".manifest.");
    try {
      writeFileSync(tmp, `${dumps(manifest, 2)}\n`);
      renameSync(tmp, manifestPath);
    } catch {
      try {
        rmSync(tmp, { force: true });
      } catch {}
    }
  } catch {}
}
// Classify attempt m, which started but died without its record, from the evidence it left:
// its intent, phase, wall signal and stream slice.
function legBackfillOne(
  d: string,
  wt: string,
  leg: string,
  n: string,
  m: number,
  off: number,
  end: string,
  stream: string,
  done: string,
  attempts: string,
): void {
  const logs = join(d, "logs");
  const phase = join(logs, `coachman-leg-${n}-phase-${m}`);
  const wall = join(logs, `coachman-leg-${n}-wall-${m}`);
  const intentF = join(logs, `coachman-leg-${n}-intent-${m}.json`);
  let request = "";
  let role = "";
  let prompt = "";
  let thread = "";
  let hasIntent = false;
  try {
    hasIntent = statSync(intentF).isFile();
  } catch {}
  if (hasIntent) {
    let parsed: unknown = {};
    try {
      parsed = JSON.parse(readFileSync(intentF, "utf8"));
    } catch {
      parsed = {};
    }
    const rec = asRecord(parsed);
    request = intentStr(rec.request);
    role = intentStr(rec.role);
    prompt = intentStr(rec.prompt);
    thread = intentStr(rec.thread_id);
  }
  if (!request) request = "launch";
  if (!role) {
    role = "coachman";
    try {
      const manifest: unknown = JSON.parse(readFileSync(join(d, "manifest.json"), "utf8"));
      if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest))
        throw new Error("shape");
      const co = (manifest as Record<string, unknown>).coachman;
      if (co !== null && co !== undefined && co !== "" && co !== 0 && co !== false) {
        if (typeof co !== "object" || Array.isArray(co)) throw new Error("shape");
        const legs = asRecord((co as Record<string, unknown>).legs);
        const item = legs[n];
        const name =
          typeof item === "object" && item !== null && !Array.isArray(item)
            ? ((item as Record<string, unknown>).name as unknown)
            : undefined;
        role = typeof name === "string" ? name : "coachman";
      }
    } catch {
      role = "coachman";
    }
    if (role !== "coachman" && role !== "coachman_fallback") role = "coachman";
  }
  legClassify({
    d,
    wt,
    leg,
    n,
    request,
    role,
    prompt,
    thread,
    stream,
    done,
    attempts,
    attempt: String(m),
    phase,
    wall,
    rc: "-1",
    start: String(off),
    end,
    backfilled: "1",
  });
}
// Every started attempt ends in a record: classify each attempt below next that has an intent
// or phase file but no record, oldest first, each over its own stream slice.
function legBackfill(
  d: string,
  wt: string,
  leg: string,
  n: string,
  next: number,
  stream: string,
  done: string,
  attempts: string,
): void {
  const logs = join(d, "logs");
  const have = new Set<number>();
  try {
    for (const line of readFileSync(join(logs, `coachman-leg-${n}-attempts.jsonl`), "utf8").split(
      "\n",
    )) {
      if (pyTrim(line) === "") continue;
      let row: unknown;
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof row !== "object" || row === null || Array.isArray(row)) continue;
      const a = pyIntJson((row as Record<string, unknown>).attempt, -1);
      if (a !== null) have.add(a);
    }
  } catch {}
  let names: string[] = [];
  try {
    names = readdirSync(logs);
  } catch {}
  const intents = new Map<number, Record<string, unknown>>();
  for (const name of names) {
    if (!name.startsWith(`coachman-leg-${n}-intent-`) || !name.endsWith(".json")) continue;
    const tail = name.slice(name.lastIndexOf("-") + 1).split(".")[0] ?? "";
    if (!/^[0-9]+$/u.test(tail)) continue;
    try {
      const loaded: unknown = JSON.parse(readFileSync(join(logs, name), "utf8"));
      intents.set(Number(tail), asRecord(loaded));
    } catch {}
  }
  const phases = new Set<number>();
  for (const name of names) {
    if (!name.startsWith(`coachman-leg-${n}-phase-`)) continue;
    const tail = name.slice(name.lastIndexOf("-") + 1);
    if (!/^[0-9]+$/u.test(tail)) continue;
    phases.add(Number(tail));
  }
  const missing = [...new Set([...intents.keys(), ...phases])]
    .filter((m) => !have.has(m))
    .sort((a, b) => a - b);
  for (const m of missing) {
    if (m < 1 || m >= next) continue;
    const off = pyIntJson(intents.get(m)?.stream_off, 0) ?? 0;
    let end = "";
    const off0 = (v: Record<string, unknown>): boolean => pyIntJson(v.stream_off, 0) === 0;
    // A later zero is ignored only when that attempt never wrote a phase: it died before it
    // could spawn, so it wrote no byte. A later launch that reached its phase may have
    // truncated the stream, and there is no spawn-truth signal to say it did not — refused
    // phases included, since run launch refuses after the runner truncates. The earlier
    // attempt's bytes may be gone, so its slice reads empty rather than foreign.
    const reset = [...new Set([...phases, ...intents.keys()])].some(
      (k) => k > m && phases.has(k) && (!intents.has(k) || off0(intents.get(k)!)),
    );
    if (reset) {
      end = String(off);
    } else {
      const later: number[] = [];
      let corrupt = false;
      for (const [k, v] of intents) {
        if (k > m && (have.has(k) || !off0(v))) {
          const bound = pyIntJson(v.stream_off, 0);
          if (bound === null) {
            // A corrupt bound fails closed: the earlier slice reads empty rather than
            // running to the end of the stream through the later bytes.
            corrupt = true;
            break;
          }
          later.push(bound);
        }
      }
      if (corrupt) end = String(off);
      else if (later.length) end = String(Math.min(...later));
    }
    legBackfillOne(d, wt, leg, n, m, off, end, stream, done, attempts);
  }
}
// One past the highest attempt seen anywhere: records, phase files and intent files.
function legNextAttempt(attempts: string, logs: string, n: string): number {
  let best = 0;
  try {
    for (const line of readFileSync(attempts, "utf8").split("\n")) {
      if (pyTrim(line) === "") continue;
      let row: unknown;
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof row !== "object" || row === null || Array.isArray(row)) continue;
      const a = pyIntJson((row as Record<string, unknown>).attempt, 0);
      if (a !== null && a > best) best = a;
    }
  } catch {}
  let names: string[] = [];
  try {
    names = readdirSync(logs);
  } catch {}
  for (const name of names) {
    if (name.startsWith(`coachman-leg-${n}-phase-`)) {
      const tail = name.slice(name.lastIndexOf("-") + 1).split(".")[0] ?? "";
      if (/^[0-9]+$/u.test(tail)) best = Math.max(best, Number(tail));
    } else if (name.startsWith(`coachman-leg-${n}-intent-`) && name.endsWith(".json")) {
      const tail = name.slice(name.lastIndexOf("-") + 1).split(".")[0] ?? "";
      if (/^[0-9]+$/u.test(tail)) best = Math.max(best, Number(tail));
    }
  }
  return best + 1;
}
// Classify unrecorded attempts, starting nothing.
function legBackfillOnly(dispatchArg: string, leg: string, numberText: string): void {
  if (leg !== "synthesis" && leg !== "review" && leg !== "ship")
    die(`unknown coachman leg: ${leg}`);
  const n = legNumber(numberText);
  let d = "";
  try {
    const resolved = realpathSync(dispatchArg);
    if (statSync(resolved).isDirectory()) d = resolved;
  } catch {}
  if (!d) die(`no such dispatch: ${dispatchArg}`);
  const logs = join(d, "logs");
  const attempts = join(logs, `coachman-leg-${n}-attempts.jsonl`);
  const stream = join(logs, `coachman-leg-${n}-events.jsonl`);
  const done = join(d, `.leg-${n}-done`);
  const active = join(d, `.leg-${n}-active`);
  const mutex = join(d, `.leg-${n}-mutex`);
  const acquired = legAcquire(active, mutex, process.pid);
  if (acquired !== 0) {
    if (acquired === 2) die(`leg ${n} has another start in progress`);
    if (acquired === 3) die(`leg ${n} cannot take its lock`);
    die(`leg ${n} has a live attempt; backfill runs only on INSPECT`);
  }
  let next = 0;
  try {
    next = legNextAttempt(attempts, logs, String(n));
  } catch {
    legRelease(active, mutex);
    die("cannot count prior attempts");
  }
  try {
    legBackfill(d, "", leg, String(n), next, stream, done, attempts);
  } catch {
    legRelease(active, mutex);
    die("cannot backfill the unrecorded attempt");
  }
  legRelease(active, mutex);
}
async function legStart(
  request: string,
  dArg: string,
  wtArg: string,
  leg: string,
  numberText: string,
  promptArg: string,
  threadArg = "",
  roleArg = "",
): Promise<void> {
  let prompt = promptArg;
  const thread = threadArg;
  let role = roleArg;
  if (request !== "launch" && request !== "resume" && request !== "takeover")
    die(`unknown leg operation: ${request}`);
  if (leg !== "synthesis" && leg !== "review" && leg !== "ship")
    die(`unknown coachman leg: ${leg}`);
  const n = legNumber(numberText);
  let d = "";
  try {
    const resolved = realpathSync(dArg);
    if (statSync(resolved).isDirectory()) d = resolved;
  } catch {}
  if (!d) die(`no such dispatch: ${dArg}`);
  let wt = "";
  try {
    const resolved = realpathSync(wtArg);
    if (statSync(resolved).isDirectory()) wt = resolved;
  } catch {}
  if (!wt) die(`no such worktree: ${wtArg}`);
  if (!prompt.startsWith("/")) prompt = `${process.env.PWD ?? ""}/${prompt}`;
  let promptOk = false;
  try {
    const st = statSync(prompt);
    accessSync(prompt, constants.R_OK);
    promptOk = st.isFile() && st.size > 0;
  } catch {
    promptOk = false;
  }
  if (!promptOk) die(`prompt file missing, unreadable or empty: ${prompt}`);
  let briefed = false;
  try {
    briefed = statSync(join(d, "run.json")).isFile() && statSync(join(d, "manifest.json")).isFile();
  } catch {
    briefed = false;
  }
  if (!briefed) die("dispatch needs run.json and manifest.json");
  // A pinned run serves only its own checkout: a start from anywhere else is refused, so a
  // retry can never run a leg on live scripts. A run with no checkout recorded keeps its
  // waybill's tool and skips the check, as does a record that cannot be read.
  let checkout = "";
  try {
    const runStore: unknown = JSON.parse(readFileSync(join(d, "run.json"), "utf8"));
    if (typeof runStore === "object" && runStore !== null && !Array.isArray(runStore)) {
      const pm = (runStore as Record<string, unknown>).postmaster ?? {};
      if (typeof pm === "object" && pm !== null && !Array.isArray(pm)) {
        const co = (pm as Record<string, unknown>).checkout;
        if (typeof co === "string" && co !== "") checkout = co;
      }
    }
  } catch {
    checkout = "";
  }
  if (checkout !== "") {
    let mine = "";
    try {
      mine = realpathSync(join(HERE, ".."));
    } catch {
      die("cannot resolve this checkout");
    }
    let pinned = "";
    try {
      const resolved = realpathSync(checkout);
      if (statSync(resolved).isDirectory()) pinned = resolved;
    } catch {}
    if (!pinned) die(`run's pinned checkout is gone: ${checkout}`);
    if (mine !== pinned) die(`leg starts for this run serve from ${pinned}, not ${mine}`);
  }
  const logs = join(d, "logs");
  try {
    mkdirSync(logs, { recursive: true });
  } catch {
    die("cannot create the dispatch log directory");
  }
  const stream = join(logs, `coachman-leg-${n}-events.jsonl`);
  const err = join(logs, `coachman-leg-${n}.err`);
  const done = join(d, `.leg-${n}-done`);
  const exited = join(d, `.leg-${n}-exited`);
  const attempts = join(logs, `coachman-leg-${n}-attempts.jsonl`);
  const active = join(d, `.leg-${n}-active`);
  const mutex = join(d, `.leg-${n}-mutex`);
  // Everything validatable is validated before the lock is taken: a refusal to this point
  // leaves markers, stream and records untouched.
  let append = false;
  if (request === "launch") {
    if (!role) role = "coachman";
  } else if (request === "resume") {
    if (!role) {
      let recorded = false;
      try {
        recorded = statSync(attempts).size > 0;
      } catch {}
      if (!recorded) die(`resume has no recorded attempt for leg ${n}`);
      const last = legLatest(attempts);
      if (!last || last.length < 5) die("cannot read the last leg attempt");
      role = last[1]!;
      if (role !== "coachman" && role !== "coachman_fallback")
        die("last attempt has no valid role");
    }
    if (!thread) die("resume needs the leg's thread id");
    append = true;
  } else {
    role = "coachman_fallback";
  }
  if (role !== "coachman" && role !== "coachman_fallback") die(`unknown coachman role: ${role}`);
  let label: string;
  if (role === "coachman") {
    try {
      label = nameCmd(d, "coachman", leg, String(n));
    } catch (error) {
      if (isHostError(error) && error.message) console.error(`host: ${error.message}`);
      die("cannot name the coachman");
    }
  } else {
    try {
      label = nameCmd(d, "role", `coachman_fallback ${leg} leg ${n}`);
    } catch (error) {
      if (isHostError(error) && error.message) console.error(`host: ${error.message}`);
      die("cannot name the fallback");
    }
  }
  // Exactly one starter proceeds; a stale lock is stolen, a live one refuses.
  const acquired = legAcquire(active, mutex, process.pid);
  if (acquired !== 0) {
    if (acquired === 2) die(`leg ${n} has another start in progress`);
    if (acquired === 3) die(`leg ${n} cannot take its lock`);
    die(`leg ${n} already has an active attempt`);
  }
  let attempt = 0;
  try {
    attempt = legNextAttempt(attempts, logs, String(n));
  } catch {
    legRelease(active, mutex);
    die("cannot count prior attempts");
  }
  // An attempt that died without its record is classified now, from the evidence it left,
  // before the new attempt starts.
  try {
    legBackfill(d, wt, leg, String(n), attempt, stream, done, attempts);
  } catch {
    legRelease(active, mutex);
    die("cannot backfill the unrecorded attempt");
  }
  const phase = join(logs, `coachman-leg-${n}-phase-${attempt}`);
  const wall = join(logs, `coachman-leg-${n}-wall-${attempt}`);
  const intent = join(logs, `coachman-leg-${n}-intent-${attempt}.json`);
  let streamOff = 0;
  if (request === "resume") {
    try {
      streamOff = statSync(stream).size;
    } catch {
      streamOff = 0;
    }
  }
  // The previous attempt's markers clear before the intent is written, so a crash between
  // the writes cannot leave a rejected hand-off's done marker for backfill to read as
  // finished: every gap state reads without it.
  markerRemove(wall);
  markerRemove(done);
  markerRemove(exited);
  // The intent lands before the phase, and each lands whole: a temp file and a rename, so a
  // kill between or inside the writes leaves intent-without-phase at worst — never
  // phase-without-intent, and never a torn file a reader can half-see.
  try {
    const tmp = mkstempSync(logs, ".intent.");
    try {
      writeFileSync(
        tmp,
        dumps({ attempt, request, role, prompt, thread_id: thread, stream_off: streamOff }),
      );
      renameSync(tmp, intent);
    } catch (error) {
      try {
        rmSync(tmp, { force: true });
      } catch {}
      throw error;
    }
  } catch {
    legRelease(active, mutex);
    die("cannot write the attempt intent");
  }
  try {
    const tmp = mkstempSync(logs, ".phase.");
    try {
      writeFileSync(tmp, "refused\n");
      renameSync(tmp, phase);
    } catch (error) {
      try {
        rmSync(tmp, { force: true });
      } catch {}
      throw error;
    }
  } catch {
    legRelease(active, mutex);
    die("cannot write attempt phase");
  }
  if (request === "takeover") {
    let streamIsFile = false;
    try {
      streamIsFile = statSync(stream).isFile();
    } catch {}
    if (streamIsFile) {
      let backup = join(logs, `coachman-leg-${n}-walled-events.jsonl`);
      if (existsSync(backup))
        backup = join(logs, `coachman-leg-${n}-walled-attempt-${attempt}-events.jsonl`);
      try {
        renameSync(stream, backup);
      } catch {
        legRelease(active, mutex);
        die("cannot preserve the walled stream");
      }
    }
    let errIsFile = false;
    try {
      errIsFile = statSync(err).isFile();
    } catch {}
    if (errIsFile) {
      let errBackup = join(logs, `coachman-leg-${n}-walled.err`);
      if (existsSync(errBackup))
        errBackup = join(logs, `coachman-leg-${n}-walled-attempt-${attempt}.err`);
      try {
        renameSync(err, errBackup);
      } catch {
        legRelease(active, mutex);
        die("cannot preserve the walled errors");
      }
    }
  }
  const starterStart = legSelfStart();
  if (!starterStart) {
    legRelease(active, mutex);
    die("cannot establish attempt ownership: the starter has no readable start time");
  }
  const runargs = [
    label,
    wt,
    "--under",
    d,
    "--role",
    "coachman",
    "--run",
    d,
    "--out",
    stream,
    "--err",
    err,
    "--marker",
    exited,
    "--pidfile",
    join(logs, `coachman-leg-${n}.pid`),
  ];
  if (append) runargs.push("--append");
  runargs.push(
    "--",
    process.execPath,
    join(HERE, "host.ts"),
    "_leg_exec",
    d,
    wt,
    leg,
    String(n),
    request,
    role,
    prompt,
    thread,
    stream,
    err,
    done,
    attempts,
    String(attempt),
    phase,
    wall,
    active,
    String(process.pid),
    starterStart,
  );
  const savedPhase = process.env.POSTMASTER_ATTEMPT_PHASE;
  process.env.POSTMASTER_ATTEMPT_PHASE = phase;
  let rc = 0;
  try {
    await runCmd(runargs);
  } catch (error) {
    if (isHostError(error)) {
      rc = hostCode(error);
      if (error.message) console.error(`host: ${error.message}`);
    } else {
      rc = 1;
      console.error(`host: ${String((error as Error)?.message ?? error)}`);
    }
  } finally {
    if (savedPhase === undefined) delete process.env.POSTMASTER_ATTEMPT_PHASE;
    else process.env.POSTMASTER_ATTEMPT_PHASE = savedPhase;
  }
  if (rc !== 0) {
    legRelease(active, mutex);
    legTerminateTail(attempts);
    let rows: unknown[] = [];
    try {
      rows = readFileSync(attempts, "utf8")
        .split("\n")
        .filter((line) => pyTrim(line) !== "")
        .map((line) => JSON.parse(line) as unknown);
    } catch {
      rows = [];
    }
    let recorded = false;
    if (rows.length) {
      const lastRow = rows[rows.length - 1];
      if (
        typeof lastRow !== "object" ||
        lastRow === null ||
        Array.isArray(lastRow) ||
        (lastRow as Record<string, unknown>).attempt === attempt
      )
        recorded = true;
    }
    if (!recorded) {
      try {
        const record = {
          attempt,
          leg: n,
          name: leg,
          request,
          role,
          prompt,
          thread_id: thread,
          outcome: "refused",
          on_answer: "retry",
          backfilled: false,
          exit: rc,
          ended: new Date().toISOString(),
        };
        writeFileSync(attempts, `${dumps(record)}\n`, { flag: "a" });
      } catch {}
    }
    console.error(`leg: host could not start attempt ${attempt} for leg ${n} (exit ${rc})`);
    throw hostError("", rc);
  }
  // The attempt outlives this process, and names itself in the lock as its first act; the
  // starter infers nothing from the pidfile.
}
// The last attempt record, as JSON.
function legOutcome(dispatch: string, numberText: string): void {
  const n = legNumber(numberText);
  let rows: string[];
  try {
    rows = readFileSync(join(dispatch, "logs", `coachman-leg-${n}-attempts.jsonl`), "utf8")
      .split("\n")
      .filter((line) => pyTrim(line) !== "");
  } catch {
    die("no attempt recorded for that leg");
  }
  if (!rows.length) die("no attempt recorded for that leg");
  process.stdout.write(`${rows[rows.length - 1]}\n`);
}
// The waiting list is always replaced whole, never rewritten in place: a reader beside
// a writer sees the old list or the new one, never a torn half, so a reread that
// misses an entry proves a clobber and never a partial read. Same directory, so the
// rename is one atomic step; a stale temp from a crashed writer is replaced, not read.
function legWaitingStore(f: string, content: string): void {
  const tmp = `${f}.tmp.${process.pid}`;
  try {
    rmSync(tmp, { force: true });
  } catch {}
  writeFileSync(tmp, content);
  renameSync(tmp, f);
}
function legWaitingHas(text: string, ticket: string): boolean {
  for (const b of text.split(/^## /mu).slice(1)) {
    if (pyTrim(b) === "") continue;
    if (pyTrim(pySplitLines(b)[0] ?? "") === ticket) return true;
  }
  return false;
}
function legWaitingEscape(question: string): string {
  return pySplitLines(question)
    .map((line) => (line.startsWith("## ") ? `\\## ${line.slice(3)}` : line))
    .join("\n");
}
function legWaitingRead(f: string): string | null {
  try {
    if (!statSync(f).isFile()) return null;
  } catch {
    return null;
  }
  try {
    return readFileSync(f, "utf8");
  } catch {
    return null;
  }
}
// The update stores only onto the content it read: a second read past the
// compute that differs means another writer landed between, so this one
// reports unwritten and the caller redoes from the newer list. False never
// means the ticket is missing, only that this write did not land.
function legWaitingAddInner(f: string, ticket: string, escaped: string): boolean {
  const text = legWaitingRead(f) ?? "";
  const blocks = text.split(/^## /mu);
  const head = blocks[0] ?? "";
  const rest: string[] = [];
  for (const b of blocks.slice(1)) {
    if (pyTrim(b) === "") continue;
    if (pyTrim(pySplitLines(b)[0] ?? "") !== ticket) rest.push(b);
  }
  rest.push(`${ticket}\n${escaped}\n`);
  if ((legWaitingRead(f) ?? "") !== text) return false;
  legWaitingStore(f, head + rest.map((b) => `## ${b}`).join(""));
  return true;
}
function legWaitingRemoveInner(f: string, ticket: string): boolean {
  const text = legWaitingRead(f);
  if (text === null) return true;
  const parts = text.split(/^## /mu);
  const keep: string[] = [parts[0] ?? ""];
  for (const b of parts.slice(1)) {
    if (pyTrim(pySplitLines(b)[0] ?? "") !== ticket) keep.push(`## ${b}`);
  }
  const out = keep.join("");
  if ((legWaitingRead(f) ?? "") !== text) return false;
  legWaitingStore(f, pyTrim(out) === "" ? "" : out);
  if (pyTrim(out) === "") rmSync(f);
  return true;
}
// Run the inner waiting update with the kernel holding the list: flock runs us
// again as its child, so the read and the write are exclusive by construction —
// no steal, no race, and a crashed holder releases by dying. False when flock(1)
// is missing and the caller falls back to the pid mutex; a failed inner already
// printed, so the outer only carries its code out.
function legWaitingUnderFlock(lockPath: string, inner: string[]): boolean {
  if (Bun.which("flock") === null) return false;
  const self = fileURLToPath(import.meta.url);
  const r = spawnSync("flock", ["-x", lockPath, process.execPath, self, ...inner], {
    stdio: "inherit",
  });
  if (r.error) return false;
  if (r.status !== 0) process.exit(r.status ?? 1);
  return true;
}
function legWaitingAdd(runs: string, ticket: string, qfile: string): void {
  let questionIsFile = false;
  try {
    questionIsFile = statSync(qfile).isFile();
  } catch {}
  if (!questionIsFile) die(`no such question file: ${qfile}`);
  const f = join(runs, "postmaster", "ESCALATION.md");
  try {
    mkdirSync(dirname(f), { recursive: true });
  } catch {
    die(`cannot create ${dirname(f)}`);
  }
  // The question is opaque text: a heading inside it is escaped, so it never splits into a
  // phantom entry and remove takes the whole block. The escape renders identically in markdown.
  const escaped = legWaitingEscape(pyTrim(readFileSync(qfile, "utf8")));
  // Two postmasters adding together read one list and the last write wins, dropping an
  // entry, so the kernel holds the list instead: flock runs the inner update
  // exclusively. Without flock(1) the pid mutex with verify-and-redo is the
  // fallback, whose steal takes only a stale file — contended files never
  // age one, so under contention the atomic create alone decides.
  const lock = join(runs, "postmaster", ".waiting.lock");
  if (legWaitingUnderFlock(lock, ["_waiting_add", runs, ticket, qfile])) return;
  for (let attempt = 0; attempt < 10; attempt++) {
    const take = legMutexTake(lock, -1);
    if (take.status !== "taken")
      die(
        `leg: cannot take the waiting-list mutex: ${spawnStrerror(take.status === "error" ? take.error : null)}`,
      );
    try {
      if (!legWaitingAddInner(f, ticket, escaped)) continue;
      let back = "";
      try {
        back = readFileSync(f, "utf8");
      } catch {}
      if (legWaitingHas(back, ticket)) return;
    } finally {
      legMutexDrop(lock);
    }
  }
  die("leg: cannot add to the waiting list: contested");
}
function legWaitingRemove(runs: string, ticket: string): void {
  const f = join(runs, "postmaster", "ESCALATION.md");
  let isFile = false;
  try {
    isFile = statSync(f).isFile();
  } catch {}
  if (!isFile) return;
  const lock = join(runs, "postmaster", ".waiting.lock");
  if (legWaitingUnderFlock(lock, ["_waiting_remove", runs, ticket])) return;
  for (let attempt = 0; attempt < 10; attempt++) {
    const take = legMutexTake(lock, -1);
    if (take.status !== "taken")
      die(
        `leg: cannot take the waiting-list mutex: ${spawnStrerror(take.status === "error" ? take.error : null)}`,
      );
    try {
      if (!legWaitingRemoveInner(f, ticket)) continue;
      let back: string | null = null;
      try {
        back = readFileSync(f, "utf8");
      } catch {}
      // A file gone under us is a removal some parallel remove finished: the
      // ticket is absent either way, which is what this call promised.
      if (back === null || !legWaitingHas(back, ticket)) return;
    } finally {
      legMutexDrop(lock);
    }
  }
  die("leg: cannot remove from the waiting list: contested");
}
function legWaitingList(runs: string): void {
  const f = join(runs, "postmaster", "ESCALATION.md");
  let isFile = false;
  try {
    isFile = statSync(f).isFile();
  } catch {}
  if (isFile) process.stdout.write(readFileSync(f, "utf8"));
}
async function legCmd(args: string[]): Promise<void> {
  const request = args[0] ?? "";
  if (args.length === 0)
    die("usage: run host leg launch|resume|takeover|retry|outcome|backfill|waiting ...");
  const rest = args.slice(1);
  switch (request) {
    case "launch":
      if (rest.length !== 5)
        die("usage: run host leg launch <dispatch> <worktree> <leg> <number> <prompt>");
      await legStart("launch", rest[0]!, rest[1]!, rest[2]!, rest[3]!, rest[4]!);
      return;
    case "resume":
      if (rest.length !== 6)
        die("usage: run host leg resume <dispatch> <worktree> <leg> <number> <thread-id> <prompt>");
      await legStart("resume", rest[0]!, rest[1]!, rest[2]!, rest[3]!, rest[5]!, rest[4]!);
      return;
    case "takeover":
      if (rest.length !== 5)
        die("usage: run host leg takeover <dispatch> <worktree> <leg> <number> <prompt>");
      await legStart("takeover", rest[0]!, rest[1]!, rest[2]!, rest[3]!, rest[4]!);
      return;
    case "outcome":
      if (rest.length !== 2) die("usage: run host leg outcome <dispatch> <number>");
      legOutcome(rest[0]!, rest[1]!);
      return;
    case "backfill":
      if (rest.length !== 3) die("usage: run host leg backfill <dispatch> <leg> <number>");
      legBackfillOnly(rest[0]!, rest[1]!, rest[2]!);
      return;
    case "waiting": {
      const sub = rest[0] ?? "";
      const subRest = rest.slice(1);
      if (sub === "add") {
        if (subRest.length !== 3)
          die("usage: run host leg waiting add <runs> <ticket> <question-file>");
        legWaitingAdd(subRest[0]!, subRest[1]!, subRest[2]!);
      } else if (sub === "remove") {
        if (subRest.length !== 2) die("usage: run host leg waiting remove <runs> <ticket>");
        legWaitingRemove(subRest[0]!, subRest[1]!);
      } else if (sub === "list") {
        if (subRest.length !== 1) die("usage: run host leg waiting list <runs>");
        legWaitingList(subRest[0]!);
      } else die("usage: run host leg waiting add|remove|list ...");
      return;
    }
    case "retry": {
      if (rest.length !== 4) die("usage: run host leg retry <dispatch> <worktree> <leg> <number>");
      const d = rest[0]!;
      const wt = rest[1]!;
      const leg = rest[2]!;
      const n = rest[3]!;
      const attempts = join(d, "logs", `coachman-leg-${n}-attempts.jsonl`);
      let recorded = false;
      try {
        recorded = statSync(attempts).size > 0;
      } catch {}
      if (!recorded) die(`leg ${n} has no attempt to retry`);
      const last = legLatest(attempts);
      if (!last || last.length < 5) die("cannot read the last leg attempt");
      const role = last[1]!;
      const prompt = last[2]!;
      const thread = last[3]!;
      const outcome = last[4]!;
      const retryAs = thread !== "" ? "resume" : "launch";
      if (outcome !== "refused" && outcome !== "pre-thread" && outcome !== "walled")
        die(`leg ${n}'s last attempt is ${outcome}, not waiting for a retry`);
      if (outcome === "walled" && role === "coachman")
        die(`leg ${n}'s last attempt is a primary wall: take it over, do not retry it`);
      await legStart(retryAs, d, wt, leg, n, prompt, thread, role);
      return;
    }
    default:
      die("usage: run host leg launch|resume|takeover|retry|outcome|backfill|waiting ...");
  }
}
// The hosted executor; the caller owns paths and clears markers. Ownership is established by
// the owner, not inferred by the starter: the launch names itself before anything else, and
// never runs unowned. An abort here leaves no record; the next start backfills this attempt
// as refused.
async function legExec(args: string[]): Promise<void> {
  const at = (i: number): string => args[i] ?? "";
  const d = at(0);
  const wt = at(1);
  const leg = at(2);
  const n = at(3);
  const request = at(4);
  const role = at(5);
  const prompt = at(6);
  const thread = at(7);
  const stream = at(8);
  const err = at(9);
  const done = at(10);
  const attempts = at(11);
  const attempt = at(12);
  const phase = at(13);
  const wall = at(14);
  const active = at(15);
  const starterPid = at(16);
  const starterStart = at(17);
  const mutex = join(d, `.leg-${n}-mutex`);
  if (!legClaim(active, mutex, starterPid, starterStart)) throw hostError("", 1);
  try {
    // This attempt's events start here: on a resume the stream still holds prior attempts,
    // whose wall events and thread ids must not classify this one.
    let startOff = 0;
    try {
      startOff = statSync(stream).size;
    } catch {
      startOff = 0;
    }
    const launchMode = request === "resume" ? "resume" : "launch";
    // Observe stderr as it arrives, while teeing it to the user-readable .err file. A wall
    // is an error shaped like one: a line-anchored 402/429, an HTTP status line carrying
    // one, a bare API term prose never holds, or an error word beside a wall term or code.
    const markers = ["error", "fail", "exceed", "denied", "exception"];
    const bare = ["insufficient_quota", "resource exhausted", "payment required"];
    const anchored = new RegExp(`^[${PY_S_CLASS}]*(?:402|429)${BOUND_R}`, "u");
    const httpStatus = new RegExp(
      `http/[^${PY_S_CLASS}]+[${PY_S_CLASS}]+(?:402|429)${BOUND_R}`,
      "u",
    );
    const anyCode = new RegExp(`${BOUND_L}(?:402|429)${BOUND_R}`, "u");
    let wallSeen = false;
    const scanLine = (line: string): void => {
      if (wallSeen) return;
      const s = casefold(line);
      if (anchored.test(s) || httpStatus.test(s) || bare.some((t) => s.includes(t))) {
        wallSeen = true;
      } else if (
        markers.some((m) => s.includes(m)) &&
        (anyCode.test(s) || LEG_WALL_TERMS.some((t) => s.includes(t)))
      ) {
        wallSeen = true;
      }
    };
    const errFd = openSync(err, "a", 0o666);
    // The runner injects the host role only when its child is run launch itself; the leg's
    // child is _leg_exec, so the role arrives here unsaid. Say it: every leg attempt runs
    // with the coachman host role, fallback takeovers included.
    process.env.POSTMASTER_LAUNCH_ROLE = "coachman";
    const child = spawn(
      join(HERE, "run"),
      launchMode === "resume"
        ? ["launch", "resume", role, wt, thread, prompt, "--leg", leg, "--run", d]
        : ["launch", "launch", role, wt, prompt, "--leg", leg, "--run", d],
      {
        env: process.env,
        stdio: ["ignore", "inherit", "pipe"],
      },
    );
    // The consumer drains to EOF: breaking early would SIGPIPE the launch and lose the later
    // stderr the postmaster reads to explain the failure.
    const drained = (async (): Promise<void> => {
      const decoder = new TextDecoder("utf-8");
      // Raw bytes split on line breaks, each line decoded whole: a multibyte character never
      // holds a break byte, so no character is ever split across a decode.
      let carry = new Uint8Array(0);
      try {
        const stderr = child.stderr as unknown as AsyncIterable<Uint8Array> | null;
        if (stderr) {
          for await (const chunk of stderr) {
            try {
              writeSync(errFd, chunk);
            } catch {}
            const buf = new Uint8Array(carry.length + chunk.length);
            buf.set(carry, 0);
            buf.set(chunk, carry.length);
            let start = 0;
            for (let i = 0; i < buf.length; i++) {
              if (buf[i] === 10 || buf[i] === 13) {
                scanLine(decoder.decode(buf.subarray(start, i)));
                start = i + 1;
              }
            }
            carry = buf.slice(start);
          }
        }
        if (carry.length) scanLine(decoder.decode(carry));
      } catch {}
    })();
    const exited = new Promise<number>((resolve) => {
      let settled = false;
      child.once("error", (error: unknown) => {
        if (!settled) {
          settled = true;
          resolve((error as { code?: string }).code === "EACCES" ? 126 : 127);
        }
      });
      child.once("exit", (code: number | null, signal: string | null) => {
        if (!settled) {
          settled = true;
          resolve(code ?? (signal ? signalExitCode(signal) : 1));
        }
      });
    });
    const procEvents = process as unknown as {
      removeListener(signal: string, handler: () => void): void;
    };
    const forwarders: Array<{ signal: NodeJS.Signals; handler: () => void }> = [];
    for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"] as const) {
      const handler = (): void => {
        const pid = child.pid ?? 0;
        if (pid) {
          try {
            process.kill(-pid, "SIGTERM");
          } catch {
            try {
              process.kill(pid, "SIGTERM");
            } catch {}
          }
        }
        procEvents.removeListener(signal, handler);
        try {
          process.kill(process.pid, signal);
        } catch {}
        setTimeout(() => {
          process.exit(signalExitCode(signal));
        }, 100);
      };
      process.on(signal, handler);
      forwarders.push({ signal, handler });
    }
    const rc = await exited;
    await drained;
    try {
      closeSync(errFd);
    } catch {}
    for (const { signal, handler } of forwarders) procEvents.removeListener(signal, handler);
    if (wallSeen) {
      try {
        writeFileSync(wall, "wall\n");
      } catch {}
    }
    legClassify({
      d,
      wt,
      leg,
      n,
      request,
      role,
      prompt,
      thread,
      stream,
      done,
      attempts,
      attempt,
      phase,
      wall,
      rc: String(rc),
      start: String(startOff),
      end: "",
      backfilled: "0",
    });
  } finally {
    legRelease(active, mutex);
  }
}
async function liveTest(): Promise<void> {
  const result = await import("./host-self-test.ts");
  await result.live();
}
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const operation = args.shift() ?? "";
  switch (operation) {
    case "detect":
      console.log(detect());
      return;
    case "name":
      console.log(nameCmd(args[0] ?? "", ...args.slice(1)));
      return;
    case "run-state":
      await runStateCmd(args);
      return;
    case "leg":
      await legCmd(args);
      return;
    case "run":
      await runCmd(args);
      return;
    case "workhorse":
      await workhorseCmd(args);
      return;
    case "limits":
      limitsCmd(args);
      return;
    case "stop":
      await stopCmd(args);
      return;
    case "stop-pidfile":
      await stopPidfileCmd(args);
      return;
    case "close":
      await closeCmd(args);
      return;
    case "stop-run":
      await stopRunCmd(args);
      return;
    case "close-run":
      await closeRunCmd(args);
      return;
    case "spawn":
      spawnCmd(args);
      return;
    case "send":
      await sendCmd(args);
      return;
    case "wait":
      await waitCmd(args);
      return;
    case "read":
      readCmd(args);
      return;
    case "close-handle":
      closeHandleCmd(args);
      return;
    case "_clerk-close":
      await clerkCloseCmd(args);
      return;
    case "_leg_exec":
      await legExec(args);
      return;
    case "_waiting_add": {
      if (args.length !== 3) die("usage: run host _waiting_add <runs> <ticket> <question-file>");
      const runs = args[0]!;
      const f = join(runs, "postmaster", "ESCALATION.md");
      try {
        mkdirSync(dirname(f), { recursive: true });
      } catch {
        die(`cannot create ${dirname(f)}`);
      }
      legWaitingAddInner(f, args[1]!, legWaitingEscape(pyTrim(readFileSync(args[2]!, "utf8"))));
      return;
    }
    case "_waiting_remove": {
      if (args.length !== 2) die("usage: run host _waiting_remove <runs> <ticket>");
      legWaitingRemoveInner(join(args[0]!, "postmaster", "ESCALATION.md"), args[1]!);
      return;
    }
    case "_run":
      await runLaunch(args[1] ?? "", args[0] ?? "");
      return;
    case "_finish": {
      const kind = args[0] ?? "";
      if (kind === "herdr") {
        const code = herdrFinishPlacement(args[1] ?? "", args[2] ?? "", args[3] ?? "");
        if (code !== 0) throw hostError("", code);
      } else if (kind === "tmux") {
        const code = tmuxFinishPlacement(args[2] ?? "", args[3] ?? "");
        if (code !== 0) throw hostError("", code);
      } else throw hostError("", 1);
      return;
    }
    case "_finish-wait": {
      const code = await finishWait(
        args[0] ?? "",
        args[1] ?? "",
        args[2] ?? "",
        args[3] ?? "",
        args[4] ?? "",
        args[5] ?? "",
        args[6] ?? "0.2",
      );
      if (code !== 0) throw hostError("", code);
      return;
    }
    case "_handle":
      console.log(handleOf(args[0] ?? ""));
      return;
    case "_env-write":
      await envWrite(args[0] ?? "");
      return;
    case "_watch":
      await watch(Number(args[0]), args[1] ?? "");
      return;
    case "--live-test":
      await liveTest();
      return;
    default:
      die(
        "usage: run host leg | detect | name | run-state | run [--under <dispatch>] [--role lane|coachman|reviewer] [--run <dispatch>] [--project <repo>] | limits | stop | close | stop-run | close-run | spawn | send | wait | read | close-handle | --live-test (see the header)",
      );
  }
}
// The one entry: imported for its helpers (aftercare.ts), the module runs nothing.
if (import.meta.main)
  main().catch((error: unknown) => {
    if (isHostError(error)) {
      if (error.message) console.error(`host: ${error.message}`);
      process.exit(hostCode(error));
    }
    console.error(`host: ${String((error as Error)?.message ?? error)}`);
    process.exit(1);
  });
function tmuxCloseWindow(window: string, pane: string): number {
  if (pane) return tmuxFinishPlacement(window, pane);
  // A window from before panes were recorded: a lone pane is the host's own
  // shell, while more panes may hold the user's and stay open.
  const panes = run("tmux", ["list-panes", "-t", window, "-F", "#{pane_id}"]);
  if (panes.code !== 0) {
    if (tmuxWindowGone(window)) return 0;
    warn(`could not inspect tmux window ${window}; left it open`);
    return 2;
  }
  const n = pySplitLines(panes.out).filter((line) => line !== "").length;
  if (n === 1) {
    if (run("tmux", ["kill-window", "-t", window]).code !== 0) {
      warn(`tmux could not close legacy window ${window}; left it open`);
      return 2;
    }
  } else {
    warn(`tmux window ${window} has no recorded launch pane and holds ${n} panes; left it open`);
    return 2;
  }
  return 0;
}

function closeTmux(path: string): number {
  const session = tmuxSession(path);
  if (run("tmux", ["has-session", "-t", `=${session}`]).code !== 0) return 0;
  // A list that fails after its session answered is a genuine failure, never
  // an empty session: fail closed, and a concurrent settle heals on retry.
  const rows = run("tmux", [
    "list-windows",
    "-t",
    `=${session}`,
    "-F",
    "#{window_id}\t#{@postmaster_cwd}\t#{@postmaster_pane}",
  ]);
  if (rows.code !== 0) {
    warn(`could not inspect tmux session ${session}; left it open`);
    return 2;
  }
  let countClosed = 0;
  let rc = 0;
  for (const line of pySplitLines(rows.out)) {
    const [window, cwd, ...paneRest] = line.split("\t");
    if (!window || cwd !== path) continue;
    const code = tmuxCloseWindow(window, paneRest.join("\t"));
    if (code === 0) countClosed++;
    else rc = code;
  }
  if (countClosed > 0) console.log(`host=tmux: closed ${countClosed} recorded launch pane(s)`);
  return rc;
}
function placementFiles(): string[] {
  const directory = join(STATE, "placements");
  try {
    if (!statSync(directory).isDirectory()) return [];
  } catch {
    return [];
  }
  try {
    return readdirSync(directory)
      .filter((entry) => entry.endsWith(".json"))
      .sort()
      .map((entry) => join(directory, entry));
  } catch {
    return [];
  }
}

function tokensOf(entry: { tokens?: unknown }): Record<string, unknown> {
  const tokens = entry.tokens || {};
  if (typeof tokens !== "object" || tokens === null || Array.isArray(tokens))
    throw new Error("bad tokens");
  return tokens as Record<string, unknown>;
}

function placementOwnership(panesText: string, paneId: string, tabId: string): string {
  const panes = parseJson<{ result?: { panes?: HerdrPane[] } }>(panesText)?.result?.panes;
  if (!Array.isArray(panes)) throw new Error("bad panes");
  for (const entry of panes)
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("bad panes");
  const placed = (value: unknown): boolean => typeof value === "string" && HERDR_TAB_ID.test(value);
  const pane = panes.find((entry) => entry.pane_id === paneId);
  if (!pane) return "missing";
  if (tokensOf(pane).postmaster !== "launch") return "unowned";
  if (!placed(pane.tab_id)) return "idless";
  if (panes.some((entry) => !placed(entry.tab_id))) return "mixed";
  if (
    panes
      .filter((entry) => entry.tab_id === tabId)
      .every((entry) => tokensOf(entry).postmaster === "launch")
  )
    return panes.some((entry) => entry.tab_id === tabId && entry.pane_id !== paneId)
      ? "owned-shared"
      : "owned";
  return "split";
}

function herdrClosePlacements(worktree: string): number {
  for (const file of placementFiles()) {
    try {
      if (!statSync(file).isFile()) continue;
    } catch {
      continue;
    }
    let space = "";
    let tab = "";
    let pane = "";
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) continue;
      const item = parsed as Record<string, unknown>;
      if (
        typeof item.cwd !== "string" ||
        typeof item.workspace !== "string" ||
        typeof item.tab !== "string" ||
        typeof item.pane !== "string"
      )
        continue;
      if (realpathLoose(item.cwd) !== realpathLoose(worktree)) continue;
      space = item.workspace;
      tab = item.tab;
      pane = item.pane;
    } catch {
      continue;
    }
    if (herdrCloseOnePlacement(space, tab, pane, file, "launch") !== 0) return 2;
  }
  return 0;
}

// Close one recorded launch: a run launch's pane, or a spawned session's tab.
// A tab closes only when it holds the recorded pane alone and every pane in
// it carries the launch token, as a space does. A tab the list cannot fully
// place refuses too: a row counts as placed only when its tab_id is a string
// of the shape Herdr sends (w…:t…), and anything else is unattributable. A
// split tab keeps the user's pane and stays open, named in the refusal; a
// shared run tab keeps its other run panes and stays open by design, with
// only the recorded pane closed. Where the recorded pane itself carries no
// attributable tab, only that pane closes, never the tab, whose sharers are
// unknown.
function herdrCloseOnePlacement(
  space: string,
  tab: string,
  pane: string,
  file: string,
  noun: string,
): number {
  if (!space || !tab || !pane) {
    warn(`invalid ${noun} placement in ${file}; left it open`);
    return 2;
  }
  const panesResult = herdr(["pane", "list", "--workspace", space]);
  if (panesResult.code !== 0) {
    if (herdrSpaceGone(space)) {
      markerRemove(file);
      return 0;
    }
    warn(`could not inspect ${noun} tab ${tab} in space ${space}; left it open`);
    return 2;
  }
  let ownership = "";
  try {
    ownership = placementOwnership(panesResult.out, pane, tab);
  } catch {
    warn(`could not verify ownership of ${noun} tab ${tab}; left it open`);
    return 2;
  }
  if (ownership === "missing") {
    markerRemove(file);
    return 0;
  }
  if (ownership === "split") {
    if (herdr(["pane", "close", pane]).code !== 0) {
      warn(`herdr could not close ${noun} pane ${pane}; left it open`);
      return 2;
    }
    markerRemove(file);
    warn(`${noun} tab ${tab} in space ${space} holds panes run host did not open; left it open`);
    return 2;
  }
  if (ownership === "mixed") {
    warn(`${noun} tab ${tab} in space ${space} holds panes run host cannot place; left it open`);
    return 2;
  }
  if (ownership === "idless") {
    if (herdr(["pane", "close", pane]).code !== 0) {
      warn(`herdr could not close ${noun} pane ${pane}; left it open`);
      return 2;
    }
    markerRemove(file);
    console.log(`host=herdr: closed ${noun} pane ${pane}`);
    return 0;
  }
  // A run tab holds every launch's pane beside the run's state pane: closing
  // one checkout's pane leaves the shared tab for the rest, by design rather
  // than as a refusal.
  if (ownership === "owned-shared") {
    if (herdr(["pane", "close", pane]).code !== 0) {
      warn(`herdr could not close ${noun} pane ${pane}; left it open`);
      return 2;
    }
    markerRemove(file);
    console.log(`host=herdr: closed ${noun} pane ${pane}; its tab holds other run panes`);
    return 0;
  }
  if (ownership !== "owned") {
    warn(`${noun} tab ${tab} in space ${space} is no longer owned by run host; left it open`);
    return 2;
  }
  if (herdr(["tab", "close", tab]).code !== 0) {
    warn(`herdr could not close ${noun} tab ${tab}; left it open`);
    return 2;
  }
  markerRemove(file);
  console.log(`host=herdr: closed ${noun} tab ${tab}`);
  return 0;
}

function herdrForgetSpace(workspace: string): void {
  for (const file of placementFiles()) {
    try {
      if (!statSync(file).isFile()) continue;
    } catch {
      continue;
    }
    try {
      const item = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown> | null;
      if (item?.workspace === workspace) markerRemove(file);
    } catch {}
  }
}

function spaceVerdict(infoText: string, panesText: string): string {
  const ws = parseJson<{ result?: { workspace?: HerdrSpace } }>(infoText)?.result?.workspace;
  const panes = parseJson<{ result?: { panes?: HerdrPane[] } }>(panesText)?.result?.panes;
  if (!ws || typeof ws !== "object" || Array.isArray(ws)) throw new Error("bad space");
  if (!Array.isArray(panes)) throw new Error("bad panes");
  for (const entry of panes)
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("bad panes");
  if (tokensOf(ws).postmaster !== "opened") {
    if (ws.workspace_id === undefined || ws.workspace_id === null) throw new Error("bad space");
    return `refuse\tspace ${jsonValue(ws.workspace_id)} was not opened by run host`;
  }
  for (const entry of panes) {
    const tokens = tokensOf(entry);
    if (tokens.postmaster === "root" && tokens.state === "done") continue;
    if (tokens.postmaster === "launch") {
      if (tokens.state === "done") continue;
      return `check\t${jsonValue(entry.pane_id)}`;
    }
    if (
      entry.pane_id === undefined ||
      entry.pane_id === null ||
      ws.workspace_id === undefined ||
      ws.workspace_id === null
    )
      throw new Error("bad panes");
    return `refuse\tpane ${jsonValue(entry.pane_id)} in space ${jsonValue(ws.workspace_id)} was not opened by run host`;
  }
  return "ok";
}

function herdrPlacementCwd(workspace: string, pane: string): string {
  for (const file of placementFiles()) {
    let item: Record<string, unknown> | null = null;
    try {
      item = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    } catch {
      continue;
    }
    // BASE's scan aborts the whole lookup on a file without .get: a non-mapping
    // entry refuses rather than letting a later file answer.
    if (item === null || typeof item !== "object" || Array.isArray(item)) return "";
    if ((hasOwn(item, "host") ? item.host : "herdr") !== "herdr") continue;
    if (item.workspace !== workspace || item.pane !== pane) continue;
    return hasOwn(item, "cwd") ? jsonValue(item.cwd) : "";
  }
  return "";
}

function closeHerdr(path: string): number {
  const placed = herdrClosePlacements(path);
  if (placed !== 0) return placed;
  const listed = herdr(["worktree", "list", "--cwd", path]);
  let space = "";
  let kind = "";
  // BASE's $(...) strips trailing newlines before the emptiness check.
  const listText = listed.out.replace(/\n+$/u, "");
  if (listed.code !== 0 || listText === "") {
    space = "-";
    kind = "main";
  } else {
    try {
      const data = parseJson<{ result?: Record<string, unknown> }>(listText)?.result;
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("bad list");
      const rows = data.worktrees ?? [];
      if (!Array.isArray(rows)) throw new Error("bad list");
      const here = realpathLoose(path);
      let match: Record<string, unknown> | null = null;
      for (const entry of rows) {
        if (!entry || typeof entry !== "object" || typeof entry.path !== "string")
          throw new Error("bad list");
        if (realpathLoose(entry.path) === here) {
          match = entry as Record<string, unknown>;
          break;
        }
      }
      space = match?.open_workspace_id ? jsonValue(match.open_workspace_id) : "-";
      kind = match?.is_linked_worktree ? "linked" : "main";
    } catch {
      space = "";
      kind = "";
    }
  }
  let infoText = "";
  if (space === "-") {
    const workspaces = herdr(["workspace", "list"]);
    let candidates: string[] = [];
    if (workspaces.code === 0) {
      try {
        const data = parseJson<{ result?: { workspaces?: HerdrSpace[] } }>(workspaces.out);
        const result = data?.result;
        if (result === null || typeof result !== "object" || Array.isArray(result))
          throw new Error("bad spaces");
        const all = result.workspaces ?? [];
        if (!Array.isArray(all)) throw new Error("bad spaces");
        // BASE prints ids until a row without .get aborts it: entries before
        // the bad one stay, and rows without a string id never print.
        for (const entry of all) {
          if (entry === null || typeof entry !== "object" || Array.isArray(entry)) break;
          if (typeof entry.workspace_id === "string") candidates.push(entry.workspace_id);
        }
      } catch {
        candidates = [];
      }
    }
    for (const candidate of candidates) {
      if (!candidate) continue;
      const got = herdr(["workspace", "get", candidate]);
      if (got.code !== 0) {
        if (herdrSpaceGone(candidate)) continue;
        warn(`could not inspect space ${candidate}; left it open`);
        return 2;
      }
      const tree = asRecord(
        parseJson<{ result?: { workspace?: HerdrSpace } }>(got.out)?.result?.workspace?.worktree,
      );
      const actualPath = jsonValue(tree.checkout_path || tree.path);
      let resolved = "";
      try {
        resolved = actualPath ? realpathSync(actualPath) : "";
      } catch {
        resolved = "";
      }
      if (!actualPath || resolved !== path) continue;
      space = candidate;
      infoText = got.out;
      break;
    }
  }
  if (space === "-") return 0;
  if (kind === "main" && !cloneOrigin(path)) {
    warn(`${path} is a repository's own checkout; its space is never closed`);
    return 2;
  }
  if (!infoText) {
    const infoResult = herdr(["workspace", "get", space]);
    if (infoResult.code !== 0) {
      warn(`could not inspect space ${space}; left it open`);
      return 2;
    }
    infoText = infoResult.out;
  }
  const tree = asRecord(
    parseJson<{ result?: { workspace?: HerdrSpace } }>(infoText)?.result?.workspace?.worktree,
  );
  const actualPath = jsonValue(tree.checkout_path || tree.path);
  if (!actualPath) return 0;
  try {
    if (realpathSync(actualPath) !== path) return 0;
  } catch {
    return 0;
  }
  const patience = count(
    process.env.POSTMASTER_HOST_CLOSE_WAIT ?? "15",
    "POSTMASTER_HOST_CLOSE_WAIT",
  );
  let waited = 0;
  for (;;) {
    const panesResult = herdr(["pane", "list", "--workspace", space]);
    if (panesResult.code !== 0) {
      warn(`could not inspect panes in space ${space}; left it open`);
      return 2;
    }
    let verdict = "";
    try {
      verdict = spaceVerdict(infoText, panesResult.out);
    } catch {
      verdict = "";
    }
    const tabAt = verdict.indexOf("\t");
    const action = tabAt < 0 ? verdict : verdict.slice(0, tabAt);
    const pane = tabAt < 0 ? "" : verdict.slice(tabAt + 1);
    if (action === "ok") break;
    if (action === "check") {
      const panePath = herdrPlacementCwd(space, pane);
      if (!panePath) {
        warn(`launch pane ${pane} in space ${space} has no placement record; left it open`);
        return 2;
      }
      // BASE also refuses when its registry scan fails, which the port's scan
      // never does: every unreadable record reads as no launch there.
      const live = registryScan(panePath);
      if (live.length) {
        if (waited >= patience) {
          warn(`launch pane ${pane} in space ${space} is still running; left it open`);
          return 2;
        }
        sleepSync(1000);
        waited++;
        const again = herdr(["workspace", "get", space]);
        if (again.code !== 0) {
          warn(`could not inspect space ${space}; left it open`);
          return 2;
        }
        infoText = again.out;
      } else {
        if (
          herdr([
            "pane",
            "report-metadata",
            pane,
            "--source",
            META,
            "--token",
            "postmaster=launch",
            "--token",
            "state=done",
          ]).code !== 0
        ) {
          warn(`could not settle completed launch pane ${pane} in space ${space}; left it open`);
          return 2;
        }
      }
    } else if (action === "refuse") {
      warn(`${pane}; left space ${space} open`);
      return 2;
    } else {
      warn(`could not read space ${space}; left it open`);
      return 2;
    }
  }
  if (herdr(["workspace", "close", space]).code !== 0) {
    warn(`herdr could not close space ${space}; left it open`);
    return 2;
  }
  herdrForgetSpace(space);
  console.log(`host=herdr: closed space ${space}`);
  return 0;
}

function pyStrScalar(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

/** The launch registry's record for a group leader, as `run` writes it. aftercare.ts reads
 * it to verify a recorded launch before signalling its process group. */
export function launchRecord(group: number): Registry | null {
  return loadRecord(recordPath(group));
}

/** Live launches registered for one directory, read-only: their names, as close's scan
 * finds them, with nothing removed. aftercare.ts's dry run reads this, skipping the preview
 * group it plans to stop. */
export function liveLaunchNames(dir: string, exceptGroup?: number): string[] {
  const procs = processes();
  const boot = bootId();
  let names: string[] = [];
  try {
    names = readdirSync(registryDir()).sort();
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const name of names) {
    if (!/^[0-9]+$/u.test(name)) continue;
    const rec = loadRecord(join(registryDir(), name));
    if (!rec || rec.dir !== dir) continue;
    const group = Number(name);
    if (exceptGroup !== undefined && group === exceptGroup) continue;
    const live =
      (rec.start !== "" && procs.get(group)?.start === rec.start) ||
      rec.members.some(([pid, start]) => procs.get(pid)?.start === start) ||
      (rec.start === "" && procs.has(group));
    if (live && (!rec.boot || sameBoot(rec.boot, boot))) found.push(rec.name);
  }
  return found;
}

// NUL-separated worktrees made for one dispatch, from its waybill and records.
export function runWorktreePaths(givenDispatch: string): string[] {
  // One parser for the waybill: dispatch_info takes the last ## Dispatch
  // section, so ticket text quoting a waybill cannot redirect teardown.
  const dispatch = realpathLoose(givenDispatch);
  const synthesis = dispatchInfo(dispatch).worktree;
  if (!synthesis) throw hostError("run waybill has no synthesis worktree", 2);
  const synth = realpathLoose(synthesis);
  if (basename(dirname(synth)) !== ".worktrees")
    throw hostError("synthesis worktree is not under .worktrees", 2);
  const repo = dirname(dirname(synth));
  const worktreesDir = join(repo, ".worktrees");
  let ticket = basename(dispatch);
  const synthBase = basename(synth);
  if (!isPathComponent(ticket) || !(synthBase === ticket || synthBase.startsWith(`${ticket}-`)))
    ticket = synthBase;
  const paths: string[] = [];
  const add = (name: string): void => {
    if (!isPathComponent(name)) return;
    const p = realpathLoose(join(repo, ".worktrees", name));
    if (dirname(p) === worktreesDir && !paths.includes(p)) paths.push(p);
  };
  const names = new Set<string>();
  let laneFiles = 0;
  let laneParsed = 0;
  // A missing lane file is a life stage (nothing launched yet); a present one
  // that does not parse is corruption. When files exist but none parses,
  // the lane set is unknown, and silently treating it as empty would skip
  // workhorse copies, so this fails instead.
  if (existsSync(join(dispatch, "run.json"))) {
    laneFiles++;
    try {
      const run = JSON.parse(readFileSync(join(dispatch, "run.json"), "utf8"));
      const config = asRecord(typeof run === "object" && run !== null ? run.config : undefined);
      const team = asRecord(config.team);
      const workhorses = Array.isArray(team.workhorses) ? team.workhorses : [];
      for (const entry of workhorses) if (isPathComponent(entry)) names.add(entry);
      laneParsed++;
    } catch {
      // a present file that does not parse is corruption, counted below
    }
  }
  if (existsSync(join(dispatch, "manifest.json"))) {
    laneFiles++;
    try {
      const manifest = JSON.parse(readFileSync(join(dispatch, "manifest.json"), "utf8"));
      const lanes = asRecord(
        typeof manifest === "object" && manifest !== null ? manifest.lanes : undefined,
      );
      for (const key of Object.keys(lanes)) if (isPathComponent(key)) names.add(key);
      laneParsed++;
    } catch {
      // a present file that does not parse is corruption, counted below
    }
  }
  if (laneFiles && !laneParsed) throw hostError("run lane records unreadable", 2);
  for (const lane of [...names].sort()) add(`${ticket}-${lane}`);
  const reviewers = new Set<string>();
  let reviewFiles: string[] = [];
  try {
    reviewFiles = readdirSync(join(dispatch, "logs"));
  } catch {
    reviewFiles = [];
  }
  for (const entry of reviewFiles) {
    // Only the round records: findings lists, usage records and anything else
    // that shares the folder are not state for this lookup.
    if (!REVIEW_ROUND_FILE.test(entry)) continue;
    let state: Record<string, unknown> | null = null;
    try {
      state = JSON.parse(readFileSync(join(dispatch, "logs", entry), "utf8")) as Record<
        string,
        unknown
      >;
    } catch {
      continue;
    }
    // A non-mapping state aborts the whole lookup, naming the record.
    if (state === null || typeof state !== "object" || Array.isArray(state))
      throw hostError(`run review record is not a mapping: ${join(dispatch, "logs", entry)}`, 2);
    // BASE iterates whatever .get returns: a non-list either raises
    // TypeError (None, a number), which the file skips, or yields items the
    // shape check below rejects (a string, a mapping). Only a list can add.
    const raw = state.reviewers === undefined ? [] : state.reviewers;
    if (!Array.isArray(raw)) continue;
    for (const pair of raw) {
      if (
        Array.isArray(pair) &&
        pair.length === 2 &&
        (pair[0] === "style" || pair[0] === "bug" || pair[0] === "security") &&
        isPathComponent(pair[1])
      )
        reviewers.add(`${pair[0]}\t${pair[1]}`);
    }
  }
  try {
    const actionLog = join(dispatch, "actions.jsonl");
    for (const [lineIndex, line] of pySplitLines(readFileSync(actionLog, "utf8")).entries()) {
      let action: Record<string, unknown> | null = null;
      try {
        action = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      // As above, a non-mapping action line refuses teardown and identifies its source.
      if (action === null || typeof action !== "object" || Array.isArray(action))
        throw hostError(
          `run action log line is not a mapping: ${actionLog} line ${lineIndex + 1}`,
          2,
        );
      if (action.action !== "review-launch") continue;
      const detail = hasOwn(action, "detail") ? pyStrScalar(action.detail) : "";
      const lens = LENS_WORD.exec(detail);
      if (isPathComponent(action.target) && lens) reviewers.add(`${lens[1]}\t${action.target}`);
    }
  } catch (error) {
    if (isHostError(error)) throw error;
    // a missing actions file is a life stage, not corruption
  }
  const ordered = [...reviewers].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const key of ordered) {
    const [lens, lane] = key.split("\t");
    add(`${ticket}-rev-${lens}-${lane}`);
  }
  if (!paths.includes(synth)) paths.push(synth);
  return paths;
}

async function stopRunCmd(args: string[]): Promise<void> {
  const given = args[0] ?? "";
  let givenIsDir = false;
  try {
    givenIsDir = !!given && statSync(given).isDirectory();
  } catch {}
  if (!givenIsDir) die("usage: run host stop-run <dispatch>");
  let dispatch = "";
  try {
    dispatch = realpathSync(given);
  } catch {
    dispatch = "";
  }
  let paths: string[];
  try {
    paths = runWorktreePaths(dispatch);
  } catch (error) {
    if (isHostError(error)) {
      if (error.message) console.error(`host: ${error.message}`);
      throw hostError("", hostCode(error));
    }
    throw error;
  }
  let rc = 0;
  for (const path of paths) {
    let isDir = false;
    try {
      isDir = statSync(path).isDirectory();
    } catch {}
    if (!isDir) continue;
    try {
      await stopCmd([path]);
    } catch (error) {
      if (isHostError(error)) {
        if (error.message) console.error(`host: ${error.message}`);
        rc = hostCode(error);
      } else throw error;
    }
  }
  // A fixture copy exists for its one run: launches at the copy's root, such
  // as its watcher, stop with the run, so the later close can take their tabs.
  const repo = dispatchRepo(dispatch);
  if (repo !== "" && isFixtureRepo(repo)) {
    let isDir = false;
    try {
      isDir = statSync(repo).isDirectory();
    } catch {}
    if (isDir) {
      try {
        await stopCmd([repo]);
      } catch (error) {
        if (isHostError(error)) {
          if (error.message) console.error(`host: ${error.message}`);
          rc = hostCode(error);
        } else throw error;
      }
    }
  }
  if (rc !== 0) throw hostError("", rc);
}

function runSpaceVerdict(infoText: string, panesText: string): string {
  const ws = parseJson<{ result?: { workspace?: HerdrSpace } }>(infoText)?.result?.workspace;
  if (ws === null || typeof ws !== "object" || Array.isArray(ws)) throw new Error("bad space");
  const panes = parseJson<{ result?: { panes?: HerdrPane[] } }>(panesText)?.result?.panes;
  if (!Array.isArray(panes)) throw new Error("bad panes");
  for (const entry of panes) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry))
      throw new Error("bad panes");
  }
  if (tokensOf(ws).postmaster !== "opened") return "space was not opened by run host";
  for (const entry of panes) {
    const tokens = tokensOf(entry);
    if (tokens.postmaster !== "launch" && tokens.postmaster !== "root")
      return `pane ${pyStrScalar(entry.pane_id)} was not opened by run host`;
    if (tokens.postmaster === "launch" && tokens.state !== "done")
      return `launch pane ${pyStrScalar(entry.pane_id)} is still running`;
  }
  return "ok";
}

// Close the run's tab in the repository's space: only while every pane in it
// carries the launch token — the state pane and settled launch panes do —
// and never the space around it. A tab already gone drops its record.
function herdrCloseRunTab(dispatch: string, space: string, tab: string): number {
  const panes = herdr(["pane", "list", "--workspace", space]);
  if (panes.code !== 0) {
    if (herdrSpaceGone(space)) {
      removeRunTab(dispatch);
      return 0;
    }
    warn(`could not inspect run tab ${tab} in space ${space}; left it open`);
    return 2;
  }
  let rows: HerdrPane[] | undefined;
  try {
    rows = parseJson<{ result?: { panes?: HerdrPane[] } }>(panes.out)?.result?.panes;
    if (!Array.isArray(rows)) throw new Error("bad panes");
    for (const row of rows) {
      if (row === null || typeof row !== "object" || Array.isArray(row))
        throw new Error("bad panes");
      tokensOf(row);
    }
  } catch {
    warn(`could not verify ownership of run tab ${tab}; left it open`);
    return 2;
  }
  // A row counts as placed only when its tab_id has the shape Herdr sends;
  // anything else is unattributable and may sit in this tab, so one such row
  // refuses the close, as a launch close does.
  const placed = (value: unknown): boolean => typeof value === "string" && HERDR_TAB_ID.test(value);
  if (rows.some((row) => !placed(row.tab_id))) {
    warn(`run tab ${tab} in space ${space} holds panes run host cannot place; left it open`);
    return 2;
  }
  const held = rows.filter((row) => row.tab_id === tab);
  if (!held.length) {
    removeRunTab(dispatch);
    return 0;
  }
  for (const row of held) {
    if (tokensOf(row).postmaster !== "launch") {
      warn(`run tab ${tab} in space ${space} holds panes run host did not open; left it open`);
      return 2;
    }
  }
  if (herdr(["tab", "close", tab]).code !== 0) {
    warn(`herdr could not close run tab ${tab}; left it open`);
    return 2;
  }
  removeRunTab(dispatch);
  console.log(`host=herdr: closed run tab ${tab}`);
  return 0;
}

function herdrCloseRunPlacements(givenDispatch: string): number {
  const dispatch = realpathLoose(givenDispatch);
  const repo = dispatchRepo(dispatch);
  const fixture = repo !== "" && isFixtureRepo(repo);
  // A fixture copy exists for its one run: placements recorded with no run and
  // the copy's checkout as their cwd belong to that run, told apart from the
  // project's own watcher by the checkout, never by a label.
  const mine = (item: Record<string, unknown>): boolean => {
    if (item.run === dispatch) return true;
    if (!fixture || item.run !== "") return false;
    return typeof item.cwd === "string" && realpathLoose(item.cwd) === repo;
  };
  // No early return when placements are missing: the run tab has its own
  // record outside them, and it still needs closing. The placement loops
  // below are no-ops over an empty list.
  // BASE collects, then joins: one non-mapping file, or one non-string
  // workspace id, aborts the print, so no space closes from this list.
  const found = new Set<string>();
  let collectOk = true;
  for (const file of placementFiles()) {
    let item: Record<string, unknown> | null = null;
    try {
      item = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      collectOk = false;
      break;
    }
    if (mine(item) && item.workspace) {
      if (typeof item.workspace !== "string") {
        collectOk = false;
        break;
      }
      found.add(item.workspace);
    }
  }
  if (!collectOk) found.clear();
  let rc = 0;
  for (const file of placementFiles()) {
    try {
      if (!statSync(file).isFile()) continue;
    } catch {
      continue;
    }
    let fields: string[] | null = null;
    try {
      const item = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
      if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
      if (!mine(item)) continue;
      fields = ["workspace", "tab", "pane", "cwd"].map((key) => jsonValue(item[key]));
    } catch {
      continue;
    }
    if (!fields) continue;
    const [space, tab, pane, cwd] = fields as [string, string, string, string];
    const live = registryScan(cwd);
    if (live.length) {
      warn(`a launch is still running in ${cwd}: ${live.map((item) => item.name).join(";")}`);
      rc = 2;
      continue;
    }
    if (herdrFinishPlacement(space, tab, pane) !== 0) {
      if (herdrSpaceGone(space)) markerRemove(file);
      else rc = 2;
    }
  }
  // The run's tab lives in the repository's space: close it once no launch
  // runs, while its panes are all run host's own. A user pane inside keeps
  // it open, named in the refusal.
  if (rc === 0) {
    const runTab = readRunTab(dispatch);
    if (runTab) {
      rc = herdrCloseRunTab(dispatch, runTab.workspace, runTab.tab);
      if (rc === 0 && fixture) {
        // A copy-level launch may have recreated the fixture tab after the
        // run record went stale at a dead tab: close the live tab too, so
        // its record is never removed from under it.
        const fix = readFixTab(repo);
        if (fix && fix.tab !== runTab.tab) rc = herdrCloseRunTab(dispatch, fix.workspace, fix.tab);
        if (rc === 0) removeFixTab(repo);
      }
    } else if (fixture) {
      // The run never launched, so its tab record was never written, but the
      // copy's own launches opened the fixture tab. Close it by that record.
      const fix = readFixTab(repo);
      if (fix) {
        rc = herdrCloseRunTab(dispatch, fix.workspace, fix.tab);
        if (rc === 0) removeFixTab(repo);
      }
    }
  }
  for (const ws of [...found].sort()) {
    if (!ws) continue;
    const info = herdr(["workspace", "get", ws]);
    if (info.code !== 0) {
      if (herdrSpaceGone(ws)) continue;
      warn(`could not inspect run space ${ws}; left it open`);
      rc = 2;
      continue;
    }
    const panes = herdr(["pane", "list", "--workspace", ws]);
    if (panes.code !== 0) {
      rc = 2;
      continue;
    }
    let verdict = "";
    try {
      verdict = runSpaceVerdict(info.out, panes.out);
    } catch {
      verdict = "";
    }
    if (verdict === "ok") {
      if (herdr(["workspace", "close", ws]).code !== 0) {
        warn(`herdr could not close run space ${ws}`);
        rc = 2;
        continue;
      }
      herdrForgetSpace(ws);
    } else if (verdict === "space was not opened by run host") {
      // The repository's space is shared: run host closes the run tab, never
      // the space, so a space it did not open is simply not its to sweep.
      continue;
    } else {
      warn(`${verdict}; left run space ${ws} open`);
      rc = 2;
    }
  }
  return rc;
}

function tmuxCloseRunWindows(givenDispatch: string): number {
  const dispatch = realpathLoose(givenDispatch);
  const repo = dispatchRepo(dispatch);
  const fixture = repo !== "" && isFixtureRepo(repo);
  const rows = run("tmux", [
    "list-windows",
    "-a",
    "-F",
    "#{window_id}\t#{@postmaster_cwd}\t#{@postmaster_run}\t#{@postmaster_pane}",
  ]);
  if (rows.code !== 0) {
    if (run("tmux", ["ls"]).code !== 0) return 0; // no server: nothing to sweep
    warn(`could not sweep tmux windows for run ${dispatch}; left them open`);
    return 2;
  }
  let rc = 0;
  for (const line of pySplitLines(rows.out)) {
    const [w, cwd, runTag, ...paneRest] = line.split("\t");
    if (!w) continue;
    // A fixture copy's untagged windows belong to its one run when their
    // checkout is the copy's, told apart from the project's own watcher by
    // the checkout, never by a label.
    const fixtureOwn = fixture && !runTag && !!cwd && realpathLoose(cwd) === repo;
    if (runTag !== dispatch && !fixtureOwn) continue;
    if (!cwd) {
      warn(`run window ${w} has no recorded directory; left it open`);
      rc = 2;
      continue;
    }
    const live = registryScan(cwd);
    if (live.length) {
      warn(`a launch is still running in ${cwd}; left run window ${w} open`);
      rc = 2;
      continue;
    }
    if (tmuxCloseWindow(w, paneRest.join("\t")) !== 0) rc = 2;
  }
  return rc;
}

async function closeRunCmd(args: string[]): Promise<void> {
  const given = args[0] ?? "";
  let givenIsDir = false;
  try {
    givenIsDir = !!given && statSync(given).isDirectory();
  } catch {}
  if (!givenIsDir) die("usage: run host close-run <dispatch>");
  let dispatch = "";
  try {
    dispatch = realpathSync(given);
  } catch {
    dispatch = "";
  }
  let paths: string[];
  try {
    paths = runWorktreePaths(dispatch);
  } catch (error) {
    if (isHostError(error)) {
      if (error.message) console.error(`host: ${error.message}`);
      throw hostError("", hostCode(error));
    }
    throw error;
  }
  let rc = 0;
  for (const path of paths) {
    let isDir = false;
    try {
      isDir = statSync(path).isDirectory();
    } catch {}
    if (!isDir) continue;
    try {
      await closeCmd([path]);
    } catch (error) {
      if (isHostError(error)) {
        if (error.message) console.error(`host: ${error.message}`);
        rc = hostCode(error);
      } else throw error;
    }
  }
  if (herdrUp()) {
    if (herdrCloseRunPlacements(dispatch) !== 0) rc = 2;
  }
  if (has("tmux")) {
    if (tmuxCloseRunWindows(dispatch) !== 0) rc = 2;
  }
  if (rc !== 0) throw hostError("", rc);
}
