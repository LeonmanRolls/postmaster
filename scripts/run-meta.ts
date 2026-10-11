// Write a run's fixed facts to <dispatch>/run.json, once, at dispatch, and pin the run to the
// postmaster commit it was dispatched from. Written once and never edited: the manifest is the
// run's current state, this is what the run started from and the checkout it runs on.
//
//   run run-meta <dispatch> <repo> [--mode <synthesis|single-thread>] [--ticket-notes <given|held-back>]
//                                    <repo> is the target project's checkout; also cuts the pin
//   run run-meta pin <repo> <commit> a shared checkout of <repo> at <commit> under $POSTMASTER_TOOL_PINS
//   run run-meta path <dispatch>     print the canonical path of the run's tool checkout
//   run run-meta mode <dispatch>     print the run's mode, its source and the setting at dispatch
//   run run-meta ticket-notes <dispatch>  print the run's ticket notes, its source and the setting
//   run run-meta check <dispatch>    the run's checkout still serves its dispatch commit
//   run run-meta release <dispatch>  remove the pin when no claimed run is in flight
//   run run-meta efforts <dispatch>  print the waybill's efforts line from run.json
//   run run-meta run-pinned <dispatch> <name> [args...]  run a script from the run's pinned checkout
//
// The dispatch mode resolves at dispatch: the user's --mode first, then the machine config's
// team.mode (synthesis, the default; single-thread; or alternate, which gives this project the
// mode its latest run did not have, a run that records no mode counting as synthesis and a
// project with no run starting at single-thread). The record keeps the mode, its source
// (user or setting) and the setting's value at dispatch as top-level keys beside confinement;
// a config without team.mode reads as synthesis. `mode` prints the three. `check` also compares
// the waybill's Team section `mode:` line with the record: both present and different fails
// naming both, one side missing fails naming the side that has one, and a run with neither
// is accepted.
//
// The run's ticket notes resolve at dispatch: the user's --ticket-notes first, then the
// machine config's team.ticket_notes (given, the default; or held-back). The record keeps
// the value, its source (user or setting) and the setting's value at dispatch as top-level
// keys beside the mode; a config without team.ticket_notes reads as given. `ticket-notes`
// prints the three. A record from before the user could name a value prints its config's
// value with unrecorded sources.
//
// Records when it was written; the run and project; the target repo's HEAD and branch; the
// postmaster commit that dispatched it, and whether that checkout had uncommitted changes,
// since a run keeps the runbooks it started with; the coachman contract version; the pinned
// checkout of that commit, which every leg launch, resume and takeover runs from (the
// waybill's `tool:`); the machine config with local role choices resolved; the project
// settings and their sources; and the version each harness reports. Env files are named by
// the machine config, never read. A run.json that already exists is left alone.
//
// The pin is a detached worktree of the postmaster repo at the dispatch commit, under
// $POSTMASTER_TOOL_PINS (default ~/.postmaster/tool-pins), one directory per commit so every
// run dispatched at that commit shares it. It is the run's `<tool>`: its run host, its run launch
// and the runbooks its prompts name. The live checkout still serves the front door and the
// postmaster's own supervision. A bare `pin` holds no claim; each dispatch appends its own
// path to the pin's claims file beside it, so release finds every run that names the pin,
// whatever project it lives in and whichever runs layout it uses.
//
// check is the control that a run still runs on its own versions after main has moved on: it
// reads the pin's HEAD and tree against the commit run.json records. release removes the pin
// only when no claimed run is still in flight (manifest stage other than done or abandoned,
// a claim that cannot be read counting as in flight); a pin with no claims file falls back to
// scanning the runs root the dispatch sits under, and runs it cannot list keep the pin.
// Dispatch holds one lock across its pin, claim and run.json write and release across its
// check and removal, so the two serialize; release force-removes an unreferenced pin that is
// not clean, and leaves a locked one alone. A dispatch whose run.json write fails drops the
// claim it just made, so the pin stays unreferenced; a crash between the two leaves a stale
// claim that keeps the pin, for manual recovery. The postmaster releases
// after it closes or abandons a run, never
// before the last leg's process has exited. A run with no checkout recorded (an old unpinned
// waybill) resolves to the tool path its waybill already names; check asks only that it is a
// git checkout, and release leaves it alone.
//
//   exit 0  written, already there, a pin made or reused, path printed, the pin still serves
//           its commit, or the pin was released or kept as the in-flight runs require
//   exit 1  usage, no such dispatch directory or repo or commit, no config, the file could not
//           be written, the pin lock could not be taken, no pin or it does not serve its
//           commit, or git could not make or remove it
//
// Port notes (main scripts/run run-meta): the flock(2) pin lock is an O_EXCL lock file holding
// the owner's PID, stolen from a dead owner or an empty file old enough that no live
// creator is mid-write, never by age otherwise, since a dispatch legitimately holds it
// across 15-second harness probes; the lock file is removed on release rather than left
// behind. An empty file is the bash flow's resting state (it opens with > and flocks the
// fd, never removing it), so it reads as unlocked: exclusion between the two flows is
// best-effort during the transition, exact within this one. The pin scan keeps its
// subprocess shape (a hidden `run-meta-scan`
// mode of this same script, exit 42 the reserved drop signal) so a killed scan is still
// observed and kept; the child is spawned with PATH alone, the tool bunfig.toml anchoring
// config discovery the way the wrapper does. POSTMASTER_SCAN_HOLD_MS is test-only: the
// scan child sleeps that long before enumerating, so the killed-scan control kills
// deterministically instead of racing a millisecond scan.
import { spawnSync } from "node:child_process";
import {
  accessSync,
  appendFileSync,
  closeSync,
  constants,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { tryJsonFile } from "./lib/data.ts";
import {
  absolutizeProjectEnvFiles,
  acceptanceStorePath,
  effectiveConfigForProject,
  globalConfigPath,
  inspect,
  isDie,
  sortedJson,
} from "./lib/effective-config.ts";
import { runPinned } from "./lib/pinned.ts";
import { toolRoot } from "./lib/paths.ts";
import { TICKET_NOTES_VALUES, resolveTicketNotes } from "./lib/ticket-notes.ts";
import { mkstempSync, run, signalExitCode } from "./lib/proc.ts";
import { processState } from "./lib/processes.ts";
import { pySplitLines, pyTrim } from "./lib/text.ts";

const TOOL = toolRoot(import.meta);
const SCRIPT = import.meta.path;

const USAGE =
  "usage: run run-meta <dispatch> <repo> [--mode <synthesis|single-thread>] [--ticket-notes <given|held-back>] | pin <repo> <commit> | path <dispatch> | mode <dispatch> | run-pinned <dispatch> <name> [args...] | check <dispatch> | release <dispatch> | efforts <dispatch>";

// Every command returns its exit code with the bytes for each stream; the CLI boundary writes
// them, and the tests inspect them. stdout carries results (the pin path, the checkout,
// kept/removed, wrote, already-written); stderr carries failures.
interface Outcome {
  code: number;
  out: string;
  err: string;
}

const ok = (out = ""): Outcome => ({ code: 0, out, err: "" });
const fail = (err: string, code = 1): Outcome => ({ code, out: "", err });

export function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function git(where: string, ...args: string[]): string | null {
  const r = run("git", ["-C", where, ...args]);
  return r.code === 0 ? r.out.trim() : null;
}

// canon <dir>: its absolute physical path, or null. cd -P requires a directory that exists.
function canon(p: string): string | null {
  try {
    const rp = realpathSync(p);
    return statSync(rp).isDirectory() ? rp : null;
  } catch {
    return null;
  }
}

const short12 = (s: string): string => s.slice(0, 12);

// strftime("%Y-%m-%dT%H:%M:%SZ"): UTC, second resolution, no fractional part.
function utcStamp(d: Date): string {
  const p2 = (n: number): string => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}` +
    `T${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}Z`
  );
}

// json.dump(ensure_ascii=True): every non-ASCII code point leaves as \uXXXX, astral ones as a
// surrogate pair, hex lowercase. JSON.stringify escapes neither, so the port escapes after.
function asciiJson(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(/[^\x00-\x7F]/gu, (c) => {
    const cp = c.codePointAt(0) as number;
    if (cp < 0x10000) return `\\u${cp.toString(16).padStart(4, "0")}`;
    const h = 0xd800 + ((cp - 0x10000) >> 10);
    const l = 0xdc00 + ((cp - 0x10000) & 0x3ff);
    return `\\u${h.toString(16)}\\u${l.toString(16)}`;
  });
}

function version(harness: string): string {
  if (Bun.which(harness) === null) return "not on PATH";
  // BASE names the exception: TimeoutExpired for the 15-second cutoff, the
  // OSError kind otherwise. spawnSync reports both in error, never by throwing.
  const r = spawnSync(harness, ["--version"], { encoding: "utf8", timeout: 15000 });
  const err = r.error as NodeJS.ErrnoException | undefined;
  if (err?.code === "ETIMEDOUT") return "no version: TimeoutExpired";
  if (err?.code === "ENOENT") return "no version: FileNotFoundError";
  if (err?.code === "EACCES") return "no version: PermissionError";
  if (err) return "no version: OSError";
  const lines = pySplitLines(pyTrim((r.stdout || r.stderr || "") as string));
  return lines.length > 0 ? (lines[0] as string) : "no version output";
}

// --- pin lock -------------------------------------------------------------------------------
// flock(2) has no Node spelling, so the pin lock is a lock file holding the owner's PID:
// O_EXCL creation is the mutual exclusion, and only a dead owner loses it. Never by age: a
// dispatch legitimately holds the lock across 15-second harness probes, so an old lock is
// still live. An empty file older than five seconds is the bash flow's shape (flock on the
// fd, truncated on every open, never removed), which carries no owner either way — but it
// reads as unlocked only when no flock holder is live on it: the bash flow holds that
// flock across its whole critical section, so stealing past a live holder would admit a
// second dispatcher beside it. A non-blocking flock probe tells the resting state, which
// is stolen, from a held one, which is waited on. A fresh empty file is still waited on:
// creation and the pid write are two calls, and a creator is briefly between them. The
// probe and the steal are two calls too, so a bash open landing exactly between them can
// still slip past; that window is one unlink wide, against the whole critical section
// before. Where flock(1) is missing no legacy holder can exist — the bash flow needs the
// same binary — so the old empty file is stolen as before. An unreadable file is still
// waited on, never stolen; past two minutes the wait fails as "could not lock", the way
// flock failing does.
function flockHeld(lockPath: string): boolean {
  // No flock binary, no legacy holder: the bash flow's `flock 9` needs it too.
  if (Bun.which("flock") === null) return false;
  return run("flock", ["-n", lockPath, "true"]).code !== 0;
}
function lockOwnerDead(lockPath: string): boolean {
  let text: string;
  try {
    text = readFileSync(lockPath, "utf8");
  } catch (e) {
    // Gone between the failed creation and this read: nobody holds it.
    return (e as NodeJS.ErrnoException)?.code === "ENOENT";
  }
  if (text.trim() === "") {
    let old: boolean;
    try {
      old = Date.now() - statSync(lockPath).mtimeMs > 5000;
    } catch {
      // Gone while reading: nobody holds it.
      return true;
    }
    // Old and empty is the bash flow's resting state — unless its flock is
    // still held, in which case the holder is mid-critical-section and the
    // steal waits for it.
    return old && !flockHeld(lockPath);
  }
  const pid = Number(text.trim());
  if (!Number.isInteger(pid) || pid <= 0) return false;
  return processState(pid) !== "live";
}

function withPinLock<T>(
  tools: string,
  action: () => T,
): { locked: true; value: T } | { locked: false } {
  const lockPath = join(tools, ".pin.lock");
  const start = Date.now();
  for (;;) {
    try {
      const fd = openSync(lockPath, "wx", 0o644);
      try {
        writeSync(fd, `${process.pid}\n`);
      } catch {
        // Best effort: a missing PID only costs a later waiter its fast steal.
      }
      try {
        closeSync(fd);
      } catch {
        // ignore
      }
      try {
        return { locked: true, value: action() };
      } finally {
        try {
          rmSync(lockPath, { force: true });
        } catch {
          // ignore
        }
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code !== "EEXIST") return { locked: false };
      if (lockOwnerDead(lockPath)) {
        try {
          rmSync(lockPath, { force: true });
        } catch {
          // ignore; the wait below still times out
        }
      }
      if (Date.now() - start > 120000) return { locked: false };
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
}

// --- run.json reads ---------------------------------------------------------------------------
type Claim = { kind: "unknown" } | { kind: "no" } | { kind: "checkout"; path: string };

// claim <run.json>: `checkout` with the path when the run names one, `no` when its postmaster
// record names none, `unknown` when the record cannot be read at all; the scan fails closed
// on unknown. JSON.parse reads in-process, so no user site or startup file can reach the read.
function claim(runJson: string): Claim {
  let r: unknown;
  try {
    r = JSON.parse(readFileSync(runJson, "utf8")) as unknown;
  } catch {
    return { kind: "unknown" };
  }
  if (typeof r !== "object" || r === null || Array.isArray(r)) return { kind: "unknown" };
  const pm = (r as Record<string, unknown>).postmaster;
  if (typeof pm !== "object" || pm === null || Array.isArray(pm)) return { kind: "unknown" };
  const co = (pm as Record<string, unknown>).checkout;
  if (co === undefined || co === null || co === "") return { kind: "no" };
  if (typeof co !== "string") return { kind: "unknown" };
  return { kind: "checkout", path: co };
}

// stage_of <manifest>: its stage, or "" when it cannot be read. Only "done" and "abandoned"
// ever compare equal downstream, so every non-string stage reads as "" with the same outcome.
function stageOf(manifest: string): string {
  try {
    const r = JSON.parse(readFileSync(manifest, "utf8")) as unknown;
    if (typeof r !== "object" || r === null || Array.isArray(r)) return "";
    const stage = (r as Record<string, unknown>).stage;
    return typeof stage === "string" ? stage : "";
  } catch {
    return "";
  }
}

// field <run.json>: the postmaster commit the record names, "" when it names none. Only
// reached when claim already read the postmaster record, so a missing record reads as "".
function fieldCommit(runJson: string): string {
  const c = claim(runJson);
  if (c.kind !== "checkout") return "";
  let r: unknown;
  try {
    r = JSON.parse(readFileSync(runJson, "utf8")) as unknown;
  } catch {
    return "";
  }
  const pm = (r as Record<string, unknown>).postmaster as Record<string, unknown>;
  const commit = pm.commit;
  if (commit === undefined || commit === null) return "";
  if (typeof commit === "string") return commit;
  // main prints str(commit): True/False for booleans, str() for numbers (an integer-valued
  // float prints "1.0" there, "1" here). Objects and arrays would print Python repr; JSON is
  // the documented approximation for those pathological shapes, which compare unequal to a
  // commit either way.
  if (typeof commit === "boolean") return commit ? "True" : "False";
  if (typeof commit === "number") return String(commit);
  return JSON.stringify(commit) ?? "";
}

// --- dispatch mode ---------------------------------------------------------------------------
// The values the machine config's team.mode takes, and the values a run's mode takes.
export const SETTING_MODES = ["synthesis", "single-thread", "alternate"];
export const RUN_MODES = ["synthesis", "single-thread"];

// previousRunMode <dispatch>: the mode of the project's latest run under the run root (the
// dispatch's parent), by the `written` time in its run.json, whatever its stage. A latest run
// that records no mode is a synthesis run; null when the project has no run yet. Setup
// records are not runs and are skipped. Ties break by file time, then directory name,
// so the answer never depends on directory order.
function previousRunMode(dispatch: string): string | null {
  const root = dirname(dispatch);
  let names: string[];
  try {
    names = readdirSync(root).sort();
  } catch {
    return null;
  }
  let latest: { written: number; mtime: number; name: string; mode: string } | null = null;
  for (const name of names) {
    const candidate = join(root, name);
    if (candidate === dispatch || !isDir(candidate)) continue;
    const path = join(candidate, "run.json");
    const record = tryJsonFile<Record<string, unknown>>(path);
    if (!record) continue;
    if (record.kind === "setup-verifiers") continue;
    let mtime = 0;
    try {
      mtime = statSync(path).mtimeMs;
    } catch {
      continue;
    }
    const parsed = typeof record.written === "string" ? Date.parse(record.written) : Number.NaN;
    const written = Number.isFinite(parsed) ? parsed : mtime;
    const mode: string = record.mode === "single-thread" ? "single-thread" : "synthesis";
    if (
      latest === null ||
      written > latest.written ||
      (written === latest.written &&
        (mtime > latest.mtime || (mtime === latest.mtime && name > latest.name)))
    ) {
      latest = { written, mtime, name, mode };
    }
  }
  return latest?.mode ?? null;
}

// resolveRunMode <config> <dispatch> <requested>: the run's mode, its source and the setting.
// The user's mode wins; otherwise the setting, with alternate resolved against the project's
// latest run. A config without team.mode reads as synthesis; anything else is a question back
// to the caller, never a silent default.
function resolveRunMode(
  config: Record<string, unknown>,
  dispatch: string,
  requested: string | undefined,
): { mode: string; source: "user" | "setting"; setting: string } | { error: string } {
  const team = config.team;
  const configured =
    typeof team === "object" && team !== null && !Array.isArray(team)
      ? (team as Record<string, unknown>).mode
      : undefined;
  const setting = configured === undefined ? "synthesis" : configured;
  if (typeof setting !== "string" || !SETTING_MODES.includes(setting)) {
    return {
      error: `run-meta: team.mode must be synthesis, single-thread, alternate, not ${String(setting)}`,
    };
  }
  if (requested !== undefined) return { mode: requested, source: "user", setting };
  if (setting !== "alternate") return { mode: setting, source: "setting", setting };
  const previous = previousRunMode(dispatch);
  return {
    mode: previous === "single-thread" ? "synthesis" : "single-thread",
    source: "setting",
    setting,
  };
}

// --- waybill fallback ---------------------------------------------------------------------------
// grep/sed [[:space:]] is the C-locale six (glibc isspace is ASCII-only in every locale), and
// awk splits records on \n only, so the port splits on \n and trims an explicit class.
const WS_LEAD_RE = /^[ \t\v\f\r]+/u;
const WS_TRAIL_RE = /[ \t\v\f\r]+$/u;
export const TRAIL_NL_RE = /\n+$/u;

// The Dispatch section of a waybill: after the last "## Dispatch" header up to the next "## "
// header, the way the awk reset (buf="" on every match) reads it. "" when there is none.
function dispatchSection(brief: string): string {
  const buf: string[] = [];
  let f = false;
  for (const line of brief.split("\n")) {
    if (line.startsWith("## Dispatch")) {
      buf.length = 0;
      f = true;
      continue;
    }
    if (f && line.startsWith("## ")) f = false;
    if (f) buf.push(line);
  }
  if (buf.length === 0) return "";
  return `${buf.join("\n")}\n`.replace(TRAIL_NL_RE, "");
}

// Every `tool:` line's path, the way grep -E '^tool:[[:space:]]*\S' plus the two sed strips
// reads them: "tool:", spaces, a non-space, then trailing spaces off.
function toolCandidates(section: string): string[] {
  const found: string[] = [];
  for (const line of section.split("\n")) {
    if (!line.startsWith("tool:")) continue;
    const rest = line.slice("tool:".length).replace(WS_LEAD_RE, "");
    if (rest === "") continue;
    found.push(rest.replace(WS_TRAIL_RE, ""));
  }
  return found;
}

// path_of <dispatch>: the run's tool checkout, canonical; the waybill's for an old run.
function pathOf(d: string): Outcome {
  const runJson = join(d, "run.json");
  if (!isFile(runJson)) return fail(`run-meta: no run.json in ${d}\n`);
  const c = claim(runJson);
  if (c.kind === "unknown") {
    return fail(`run-meta: ${d}/run.json records an unreadable checkout\n`);
  }
  let checkout: string;
  if (c.kind === "checkout") {
    checkout = c.path;
  } else {
    // An old unpinned waybill keeps the tool path it already names. The ticket travels in
    // the waybill verbatim and may show a tool: line of its own, so only the Dispatch
    // section counts; a waybill without one reads whole, as before.
    const briefPath = join(d, "brief.md");
    if (!isFile(briefPath)) {
      return fail(`run-meta: ${d}/run.json records no checkout and there is no waybill\n`);
    }
    let section: string;
    try {
      const brief = readFileSync(briefPath, "utf8");
      section = dispatchSection(brief);
      if (section === "") section = brief.replace(TRAIL_NL_RE, "");
    } catch {
      return fail(`run-meta: the waybill must name exactly one tool: path\n`);
    }
    const tools = toolCandidates(section);
    if (tools.length !== 1) {
      return fail("run-meta: the waybill must name exactly one tool: path\n");
    }
    checkout = tools[0] as string;
  }
  const original = checkout;
  const canonical = canon(checkout);
  if (canonical === null) return fail(`run-meta: no checkout at ${original}\n`);
  return ok(`${canonical}\n`);
}

// check_confinement <run.json>: the recorded mode agrees with the recorded config.
// Mode disagreeing with config.confine fails; a run without the object is accepted
// only when its config resolves to off.
function checkConfinement(runJson: string): Outcome {
  let r: unknown;
  try {
    r = JSON.parse(readFileSync(runJson, "utf8")) as unknown;
  } catch {
    return fail(`run-meta: ${runJson} cannot be read\n`);
  }
  if (typeof r !== "object" || r === null || Array.isArray(r)) {
    return fail(`run-meta: ${runJson} is not an object\n`);
  }
  const rec = r as Record<string, unknown>;
  const cfg = rec.config;
  const configConfine =
    typeof cfg === "object" && cfg !== null && !Array.isArray(cfg)
      ? String((cfg as Record<string, unknown>).confine ?? "") === "on"
      : false;
  const conf = rec.confinement;
  if (conf === undefined || conf === null) {
    // A run without the object is accepted only when its config resolves to off.
    if (configConfine) {
      return fail(
        `run-meta: ${runJson} records no confinement object but its config has confine on\n`,
      );
    }
    return ok();
  }
  if (typeof conf !== "object" || Array.isArray(conf)) {
    return fail(`run-meta: ${runJson} records a confinement that is not an object\n`);
  }
  const mode = (conf as Record<string, unknown>).mode;
  const recordedOn = mode === "on";
  if (recordedOn !== configConfine) {
    return fail(
      `run-meta: ${runJson} records confinement mode "${String(mode)}" but its config confine is ${configConfine ? "on" : "not on"}\n`,
    );
  }
  return ok();
}

// check_pin <dispatch>: the run's checkout still serves its dispatch commit,
// and its recorded confinement mode agrees with its config. Silent on success.
function checkPinAndConfinement(d: string): Outcome {
  const runJson = join(d, "run.json");
  const at = pathOf(d);
  if (at.code !== 0) return at;
  const checkout = at.out.trim();
  const c = claim(runJson);
  if (c.kind === "unknown") {
    return fail(`run-meta: ${d}/run.json records an unreadable checkout\n`);
  }
  if (c.kind === "no") {
    // An old unpinned waybill: the path only has to be a git checkout.
    if (git(checkout, "rev-parse", "--git-dir") === null) {
      return fail(`run-meta: ${checkout} is not a git checkout\n`);
    }
    return checkConfinement(runJson);
  }
  const commit = fieldCommit(runJson);
  if (commit === "") return fail(`run-meta: ${d}/run.json records no postmaster commit\n`);
  if (!isDir(checkout)) return fail(`run-meta: no pinned checkout at ${checkout}\n`);
  const head = git(checkout, "rev-parse", "--verify", "-q", "HEAD");
  if (head === null) return fail(`run-meta: ${checkout} is not a git checkout\n`);
  if (head !== commit) {
    return fail(
      `run-meta: ${checkout} is at ${short12(head)}, not the recorded ${short12(commit)}\n`,
    );
  }
  const dirty = git(checkout, "status", "--porcelain");
  if (dirty === null) return fail(`run-meta: could not read ${checkout}\n`);
  if (dirty !== "") {
    return fail(
      `run-meta: ${checkout} is not clean at ${short12(commit)}; ` +
        "it does not serve that commit's versions\n",
    );
  }
  return checkConfinement(runJson);
}

// --- pin scan -------------------------------------------------------------------------------
// pin_scan <runs-root> <checkout>: code 42 when no run uses this pin, 0 otherwise. The
// enumeration reads directories literally, so star-named, bracket-named, mixed-case and
// dot-prefixed projects all enumerate, and no shell state can reach it. Only directories
// descend, the way the `*/` globs do; symlinks to directories count, dangling ones do not.
function childDirs(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    // The glob that cannot list matches nothing; the -r/-x checks below are what keep.
    return [];
  }
  const found: string[] = [];
  for (const e of entries) {
    const full = join(dir, e);
    try {
      if (statSync(full).isDirectory()) found.push(full);
    } catch {
      // A dangling link or a vanished entry: the glob would not match it either.
    }
  }
  return found.sort();
}

function readableDir(p: string): boolean {
  try {
    accessSync(p, constants.R_OK | constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function isLiveStage(stage: string): boolean {
  return stage !== "done" && stage !== "abandoned";
}

function pinScan(root: string, checkout: string): { code: number; err: string } {
  // Two loops so an unreadable level is seen: one flat pass drops its branch silently.
  if (!readableDir(root)) {
    return { code: 0, err: `run-meta: cannot list ${root}; keeping ${checkout}\n` };
  }
  for (const p of childDirs(root)) {
    if (!readableDir(p)) {
      return { code: 0, err: `run-meta: cannot list ${p}/; keeping ${checkout}\n` };
    }
    for (const d of childDirs(p)) {
      if (!readableDir(d)) {
        return { code: 0, err: `run-meta: cannot list ${d}/; keeping ${checkout}\n` };
      }
      if (!isFile(join(d, "run.json"))) {
        // No record attributes this directory: a live manifest keeps the pin, so a
        // run whose record vanished still protects it; no manifest or a done one
        // drops, which is what an empty directory is. An unreadable manifest is a
        // file, so it reads as "" below and keeps.
        if (!isFile(join(d, "manifest.json"))) continue;
        if (isLiveStage(stageOf(join(d, "manifest.json")))) return { code: 0, err: "" };
        continue;
      }
      const c = claim(join(d, "run.json"));
      if (c.kind === "unknown") return { code: 0, err: "" };
      if (c.kind === "no") continue;
      const got = c.path;
      if (got !== checkout) {
        // The same checkout recorded through a symlink spells differently; a path that
        // resolves nowhere cannot be this pin, which exists.
        const resolved = canon(got);
        if (resolved === null || resolved !== checkout) continue;
      }
      if (isLiveStage(stageOf(join(d, "manifest.json")))) return { code: 0, err: "" };
    }
  }
  return { code: 42, err: "" }; // the one reserved drop signal; the caller keeps on anything else
}

const HOLD_RE = /^[0-9]+$/u;

// POSTMASTER_SCAN_HOLD_MS, test-only: the scan child sleeps this long before enumerating.
function scanHoldMs(): number {
  const v = process.env.POSTMASTER_SCAN_HOLD_MS ?? "";
  if (!HOLD_RE.test(v)) return 0;
  return Math.min(Number(v), 120000);
}

function runScanChild(root: string, checkout: string): { code: number; out: string; err: string } {
  const args = [
    "--no-env-file",
    `--config=${join(TOOL, "bunfig.toml")}`,
    SCRIPT,
    "run-meta-scan",
    root,
    checkout,
  ];
  const hold = scanHoldMs();
  if (hold > 0) args.push(String(hold));
  // The scan runs where the caller's environment cannot reach it: PATH alone crosses over,
  // and the tool bunfig.toml anchors config discovery, so no HOME, no startup file and no
  // working-directory config reaches the scan.
  const r = spawnSync(process.execPath, args, {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "" },
  });
  let code: number;
  if (r.status !== null && r.status !== undefined) code = r.status;
  else if (r.signal) code = signalExitCode(r.signal);
  else code = 1;
  return { code, out: String(r.stdout ?? ""), err: String(r.stderr ?? "") };
}

// in_flight <runs-root> <checkout>: yes when some run still uses this pin.
function inFlight(root: string, checkout: string): { flying: boolean; out: string; err: string } {
  const r = runScanChild(root, checkout);
  if (r.code === 42) return { flying: false, out: r.out, err: r.err };
  if (r.code === 0) return { flying: true, out: r.out, err: r.err };
  return {
    flying: true,
    out: r.out,
    err:
      r.err +
      `run-meta: pin scan ended status ${r.code}, not its drop signal; keeping ${checkout}\n`,
  };
}

// worktree_locked <common-dir> <checkout>: yes when an admin locked this pin.
function worktreeLocked(common: string, checkout: string): boolean {
  if (isFile(join(common, "worktrees", basename(checkout), "locked"))) return true;
  const r = run("git", ["--git-dir", common, "worktree", "list", "--porcelain"]);
  let w = "";
  for (const line of r.out.split("\n")) {
    if (line.startsWith("worktree ")) w = line.slice("worktree ".length);
    if (w === checkout && line.startsWith("locked")) return true;
  }
  return false;
}

// unclaim <commit> <dispatch>: drop one claim line; the caller holds the lock.
function unclaim(tools: string, commit: string, dispatch: string): Outcome {
  const claims = join(tools, `${commit}.claims`);
  if (!isFile(claims)) return ok();
  let text: string;
  try {
    text = readFileSync(claims, "utf8");
  } catch {
    return fail(`run-meta: could not rewrite ${claims}\n`);
  }
  // grep -vxF: every line but the claim, each newline-terminated; an emptied file stays empty.
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const kept = lines.filter((l) => l !== dispatch);
  const tmp = `${claims}.tmp`;
  try {
    writeFileSync(tmp, kept.length > 0 ? `${kept.join("\n")}\n` : "");
    renameSync(tmp, claims);
  } catch {
    return fail(`run-meta: could not rewrite ${claims}\n`);
  }
  return ok();
}

// claimed_in_flight <claims-file>: yes when a claimed run is still in flight. A claim that
// cannot be read counts as in flight. Lines read raw: a suffixed carriage return or a blank
// line names no manifest, whose stage reads "" and keeps.
function claimedInFlight(claims: string): { flying: boolean; err: string } {
  const unreadable = `run-meta: claims file ${claims} cannot be read; keeping the pin\n`;
  let text: string;
  try {
    text = readFileSync(claims, "utf8");
  } catch {
    return { flying: true, err: unreadable };
  }
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  for (const line of lines) {
    if (isLiveStage(stageOf(`${line}/manifest.json`))) return { flying: true, err: "" };
  }
  return { flying: false, err: "" };
}

// --- pin -------------------------------------------------------------------------------
// pin_inner <repo> <commit> <dest>: cut or reuse the pin; the caller holds the lock.
function pinInner(repo: string, commit: string, dest: string): Outcome {
  if (existsSync(dest)) {
    const at = git(dest, "rev-parse", "--verify", "-q", "HEAD");
    if (at === null) {
      return fail(`run-meta: ${dest} exists but is not a git checkout; left alone\n`);
    }
    if (at !== commit) {
      return fail(`run-meta: ${dest} is at ${short12(at)}, not ${short12(commit)}; left alone\n`);
    }
    // The same commit is the same content, whatever repo cut it, so any checkout at the
    // commit is shared; but it must be clean, or it does not serve that commit's versions.
    const dirty = git(dest, "status", "--porcelain");
    if (dirty === null) return fail(`run-meta: could not read ${dest}\n`);
    if (dirty !== "") {
      return fail(
        `run-meta: ${dest} is not clean at ${short12(commit)}; clean it or remove it with ` +
          "'git worktree remove --force' and dispatch again\n",
      );
    }
    return ok(`${dest}\n`);
  }
  const r = run("git", ["-C", repo, "worktree", "add", "--detach", dest, commit]);
  if (r.code !== 0) return fail(`run-meta: git could not create ${dest} at ${commit}\n`);
  return ok(`${dest}\n`);
}

// pin <repo> <commit>: a checkout of <repo> at <commit> under the pins root, shared per commit.
export function pin(repo: string, want: string, tools: string): Outcome {
  const commit = git(repo, "rev-parse", "--verify", "-q", `${want}^{commit}`);
  if (commit === null) return fail(`run-meta: no such commit in ${repo}: ${want}\n`);
  const dest = join(tools, commit);
  try {
    mkdirSync(tools, { recursive: true });
  } catch {
    return fail(`run-meta: could not make ${tools}\n`);
  }
  // One lock around cutting, recording and removing pins: dispatch takes it across its pin
  // and run.json write and release across its scan and removal, so a pin is never removed
  // between the two.
  const held = withPinLock(tools, () => pinInner(repo, commit, dest));
  if (!held.locked) return fail(`run-meta: could not lock ${tools}\n`);
  return held.value;
}

// --- record -------------------------------------------------------------------------------
function projectName(dispatch: string): string {
  // <project>/.postmaster/runs/<TICKET>: the project root's basename. An older
  // runs/<project>/<TICKET> layout is still read as that project.
  const p = realpathSync(dispatch);
  const parent = basename(dirname(p));
  const grand = basename(dirname(dirname(p)));
  if (parent === "runs" && grand === ".postmaster") return basename(dirname(dirname(dirname(p))));
  return parent;
}

function collectHarnesses(cfg: Record<string, unknown>): string[] {
  const harnesses = new Set<string>();
  const lanes = (cfg.lanes ?? {}) as Record<string, Record<string, unknown>>;
  for (const lane of Object.values(lanes)) {
    if (lane && typeof lane === "object" && lane.harness) harnesses.add(String(lane.harness));
  }
  const team = (cfg.team ?? {}) as Record<string, unknown>;
  for (const role of ["coachman", "coachman_fallback", "postmaster"]) {
    const v = team[role];
    if (v && typeof v === "object" && (v as Record<string, unknown>).harness) {
      harnesses.add(String((v as Record<string, unknown>).harness));
    }
  }
  const legs = (team.coachman_legs ?? {}) as Record<string, Record<string, unknown>>;
  for (const leg of Object.values(legs)) {
    if (leg && typeof leg === "object" && leg.harness) harnesses.add(String(leg.harness));
  }
  return [...harnesses].sort();
}

const LOWEST_EFFORT: Readonly<Record<string, string>> = {
  codex: "low",
  claude: "low",
  muse: "minimal",
  mimo: "low",
};

function teamSpecs(cfg: Record<string, unknown>): [string, Record<string, unknown>][] {
  const specs: [string, Record<string, unknown>][] = [];
  const lanes = (cfg.lanes ?? {}) as Record<string, Record<string, unknown>>;
  for (const [name, spec] of Object.entries(lanes)) {
    if (spec && typeof spec === "object") specs.push([name, spec]);
  }
  const team = (cfg.team ?? {}) as Record<string, unknown>;
  for (const name of ["coachman", "coachman_fallback", "postmaster"]) {
    const spec = team[name];
    if (spec && typeof spec === "object") specs.push([name, spec as Record<string, unknown>]);
  }
  const legs = (team.coachman_legs ?? {}) as Record<string, Record<string, unknown>>;
  for (const [name, spec] of Object.entries(legs)) {
    if (spec && typeof spec === "object") specs.push([`coachman.${name}`, spec]);
  }
  return specs;
}

function fixtureEfforts(cfg: Record<string, unknown>): string[] {
  const warnings: string[] = [];
  for (const [name, spec] of teamSpecs(cfg)) {
    if (typeof spec.effort !== "string" || !spec.effort) continue;
    const harness = String(spec.harness ?? "");
    const lowest = LOWEST_EFFORT[harness];
    if (lowest === undefined) {
      warnings.push(`run-meta: no lowest effort for ${name} on ${harness}; keeping ${spec.effort}`);
    } else {
      spec.effort = lowest;
    }
  }
  return warnings;
}

export function effortsLine(cfg: Record<string, unknown>): string {
  const pairs = teamSpecs(cfg)
    .filter(
      ([name, spec]) => name !== "postmaster" && typeof spec.effort === "string" && !!spec.effort,
    )
    .map(([name, spec]) => `${name}=${spec.effort}`);
  return `efforts:${pairs.length > 0 ? ` ${pairs.join(", ")}` : ""}`;
}

export function efforts(d: string): Outcome {
  const record = tryJsonFile<Record<string, unknown>>(join(d, "run.json"));
  if (!record) return fail(`run-meta: no readable run.json in ${d}\n`);
  const cfg = record.config;
  if (!cfg || typeof cfg !== "object") return fail(`run-meta: no config in ${d}/run.json\n`);
  return ok(`${effortsLine(cfg as Record<string, unknown>)}\n`);
}

// mode <dispatch>: the run's mode, its source and the setting's value at dispatch. A record
// with no mode is a synthesis run written before the mode existed, so its mode prints as
// synthesis and its sources as unrecorded.
export function mode(d: string): Outcome {
  const runJson = join(d, "run.json");
  if (!isFile(runJson)) return fail(`run-meta: no run.json in ${d}\n`);
  let rec: unknown;
  try {
    rec = JSON.parse(readFileSync(runJson, "utf8")) as unknown;
  } catch {
    return fail(`run-meta: ${runJson} cannot be read\n`);
  }
  if (typeof rec !== "object" || rec === null || Array.isArray(rec)) {
    return fail(`run-meta: ${runJson} is not an object\n`);
  }
  const r = rec as Record<string, unknown>;
  const m = typeof r.mode === "string" && r.mode !== "" ? r.mode : "synthesis";
  const source =
    typeof r.mode_source === "string" && r.mode_source !== "" ? r.mode_source : "unrecorded";
  const setting =
    typeof r.mode_setting === "string" && r.mode_setting !== "" ? r.mode_setting : "unrecorded";
  return ok(`mode: ${m}\nmode source: ${source}\nmode setting: ${setting}\n`);
}

// ticket-notes <dispatch>: the run's ticket notes, its source and the setting's value at
// dispatch, from the record's top-level keys. A record with none is a run from before the
// user could name a value, so its config's value prints with unrecorded sources.
export function ticketNotesVerb(d: string): Outcome {
  const runJson = join(d, "run.json");
  if (!isFile(runJson)) return fail(`run-meta: no run.json in ${d}\n`);
  let rec: unknown;
  try {
    rec = JSON.parse(readFileSync(runJson, "utf8")) as unknown;
  } catch {
    return fail(`run-meta: ${runJson} cannot be read\n`);
  }
  if (typeof rec !== "object" || rec === null || Array.isArray(rec)) {
    return fail(`run-meta: ${runJson} is not an object\n`);
  }
  const r = rec as Record<string, unknown>;
  const top = r.ticket_notes;
  if (top !== undefined) {
    if (top !== "given" && top !== "held-back") {
      const shown = typeof top === "string" ? top : JSON.stringify(top);
      return fail(`run-meta: ${runJson} records ticket_notes ${shown}, not given or held-back\n`);
    }
    const source =
      typeof r.ticket_notes_source === "string" && r.ticket_notes_source !== ""
        ? r.ticket_notes_source
        : "unrecorded";
    const setting =
      typeof r.ticket_notes_setting === "string" && r.ticket_notes_setting !== ""
        ? r.ticket_notes_setting
        : "unrecorded";
    return ok(
      `ticket-notes: ${top}\nticket-notes source: ${source}\nticket-notes setting: ${setting}\n`,
    );
  }
  const config = r.config;
  const team =
    typeof config === "object" && config !== null && !Array.isArray(config)
      ? (config as Record<string, unknown>).team
      : undefined;
  const recorded =
    typeof team === "object" && team !== null && !Array.isArray(team)
      ? (team as Record<string, unknown>).ticket_notes
      : undefined;
  if (
    typeof recorded === "string" &&
    recorded !== "" &&
    recorded !== "given" &&
    recorded !== "held-back"
  ) {
    return fail(
      `run-meta: ${runJson} records team.ticket_notes ${recorded}, not given or held-back\n`,
    );
  }
  const v = recorded === "held-back" ? "held-back" : "given";
  const source = typeof recorded === "string" && recorded !== "" ? "setting" : "unrecorded";
  const setting = typeof recorded === "string" && recorded !== "" ? recorded : "unrecorded";
  return ok(
    `ticket-notes: ${v}\nticket-notes source: ${source}\nticket-notes setting: ${setting}\n`,
  );
}

// check_mode <dispatch>: the waybill's Team section `mode:` line and the record's mode agree.
// A mismatch fails naming both; a run that names neither is accepted, so a dispatch from
// before the mode existed still passes. One side missing fails too: a missing line reads as
// synthesis, so accepting it would let a mistreated single-thread run down the workhorse path.
function checkMode(d: string): Outcome {
  const runJson = join(d, "run.json");
  let rec: unknown;
  try {
    rec = JSON.parse(readFileSync(runJson, "utf8")) as unknown;
  } catch {
    return ok(); // an unreadable record is the pin check's refusal, not this one's
  }
  const recorded =
    typeof rec === "object" &&
    rec !== null &&
    !Array.isArray(rec) &&
    typeof (rec as Record<string, unknown>).mode === "string" &&
    (rec as Record<string, unknown>).mode !== ""
      ? ((rec as Record<string, unknown>).mode as string)
      : "";
  let waybill = "";
  try {
    waybill = teamModeLine(readFileSync(join(d, "brief.md"), "utf8"));
  } catch {
    waybill = "";
  }
  if (recorded === "" && waybill === "") return ok();
  if (recorded !== "" && waybill !== "" && recorded === waybill) return ok();
  if (recorded === "") {
    return fail(`run-meta: the waybill names mode ${waybill}, but the run records no mode\n`);
  }
  if (waybill === "") {
    return fail(`run-meta: the run records mode ${recorded}, but the waybill names no mode\n`);
  }
  return fail(
    `run-meta: the waybill names mode ${waybill}, and the run records mode ${recorded}\n`,
  );
}

// teamModeLine <brief>: the value of the `mode:` line in the waybill's Team section, "" when
// the section or the line is absent. Read from the last Team section: the ticket is copied
// verbatim before the generated one, so the first match may be a quoted heading.
export function teamModeLine(brief: string): string {
  const lines = brief.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^##[ \t]+Team[ \t]*$/iu.test(lines[i] as string)) start = i;
  }
  if (start < 0) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^##[ \t]+/u.test(l));
  const team = (end < 0 ? rest : rest.slice(0, end)).join("\n");
  // ASCII: the waybill's mode token is template-written, so \S with this marker reads ASCII-only.
  const m = /^mode:[ \t]*(\S+)/imu.exec(team);
  return m ? (m[1] as string) : "";
}

type Built =
  | { ok: true; record: Record<string, unknown>; warnings: string[]; notice: string | null }
  | { ok: false; messages: string[]; notice: string | null };

// Resolve the effective config and project settings, then build the record. Expected
// failures report their message; unexpected throws fail bare.
function buildRecord(
  d: string,
  resolvedRepo: string,
  config: string,
  checkout: string,
  pinnedCommit: string,
  requestedMode: string | undefined,
  requestedNotes: string | undefined,
): Built {
  const resolved = effectiveConfigForProject(resolvedRepo, config);
  if (resolved.config === null || resolved.error !== null) {
    return {
      ok: false,
      messages: [`run-meta: ${resolved.error ?? "effective config could not be resolved"}`],
      notice: resolved.notice,
    };
  }
  let settings: unknown;
  try {
    settings = JSON.parse(
      sortedJson(inspect(resolvedRepo, { storePath: acceptanceStorePath(config) })),
    ) as unknown;
  } catch (e) {
    if (isDie(e)) {
      return { ok: false, messages: [`run-meta: ${e.message}`], notice: resolved.notice };
    }
    throw e;
  }
  // Sorted back through JSON so run.json keeps the key order the printed
  // project-settings output always had.
  const resolvedConfig = JSON.parse(sortedJson(resolved.config)) as Record<string, unknown>;
  // The record carries the project base in its values: project-set relative
  // env paths resolve against the project root here, so --run launches
  // agree with --project ones.
  if (resolved.projectFile !== null) {
    absolutizeProjectEnvFiles(
      resolvedConfig,
      resolved.local,
      dirname(dirname(resolved.projectFile)),
    );
  }
  const mode = resolveRunMode(resolvedConfig, d, requestedMode);
  if ("error" in mode) return { ok: false, messages: [mode.error], notice: resolved.notice };
  const notes = resolveTicketNotes(resolvedConfig, requestedNotes);
  if ("error" in notes)
    return { ok: false, messages: [`run-meta: ${notes.error}`], notice: resolved.notice };
  const warnings = existsSync(join(resolvedRepo, ".postmaster", "fixture"))
    ? fixtureEfforts(resolvedConfig)
    : [];
  const harnessVersions: Record<string, string> = {};
  for (const h of collectHarnesses(resolvedConfig)) harnessVersions[h] = version(h);
  const confineVal = resolvedConfig.confine;
  const confinementMode = String(confineVal ?? "") === "on" ? "on" : "off";
  return {
    ok: true,
    warnings,
    notice: resolved.notice,
    record: {
      written: utcStamp(new Date()),
      coachman_contract: 2,
      project: projectName(d),
      run: basename(realpathSync(d)),
      project_settings: settings,
      target: {
        head: git(resolvedRepo, "rev-parse", "HEAD"),
        branch: git(resolvedRepo, "symbolic-ref", "--short", "-q", "HEAD"),
      },
      postmaster: {
        commit: pinnedCommit,
        uncommitted_changes: (git(TOOL, "status", "--porcelain") ?? "") !== "",
        checkout,
      },
      config: resolvedConfig,
      confinement: { mode: confinementMode },
      mode: mode.mode,
      mode_source: mode.source,
      mode_setting: mode.setting,
      ticket_notes: notes.value,
      ticket_notes_source: notes.source,
      ticket_notes_setting: notes.setting,
      harness_versions: harnessVersions,
    },
  };
}

function readConfig(): string {
  return globalConfigPath();
}

function readTools(): string {
  return process.env.POSTMASTER_TOOL_PINS ?? join(homedir(), ".postmaster/tool-pins");
}

// meta <dispatch> <repo> [--mode <mode>] [--ticket-notes <notes>]
export function meta(
  d: string,
  repo: string,
  requestedMode?: string,
  requestedNotes?: string,
): Outcome {
  if (requestedMode !== undefined && !RUN_MODES.includes(requestedMode)) {
    return fail(`run-meta: --mode must be synthesis or single-thread, not ${requestedMode}\n`);
  }
  if (
    requestedNotes !== undefined &&
    !(TICKET_NOTES_VALUES as readonly string[]).includes(requestedNotes)
  ) {
    return fail(`run-meta: --ticket-notes must be given or held-back, not ${requestedNotes}\n`);
  }
  const config = readConfig();
  const tools = readTools();
  if (!isDir(d)) return fail(`run-meta: no such dispatch directory: ${d}\n`);
  if (git(repo, "rev-parse", "--git-dir") === null) {
    return fail(`run-meta: not a git repo: ${repo}\n`);
  }
  const resolvedRepo = canon(repo);
  if (resolvedRepo === null) return fail(`run-meta: cannot resolve project ${repo}\n`);
  const runJson = join(d, "run.json");
  if (existsSync(runJson)) return ok(`run-meta: ${d}/run.json already written; left alone\n`);
  const head = run("git", ["-C", TOOL, "rev-parse", "HEAD"]);
  if (head.code !== 0) return fail(`${head.err}run-meta: no commit in ${TOOL}\n`);
  const commit = head.out.trim();
  try {
    mkdirSync(tools, { recursive: true });
  } catch {
    return fail(`run-meta: could not make ${tools}\n`);
  }
  // The pin, the claim on it and the run.json that records it land under one lock, which
  // release takes across its check and removal: a dispatch either lands wholly before a
  // release's check and is kept, or cuts wholly after its removal.
  const held = withPinLock(tools, (): Outcome => {
    if (existsSync(runJson)) return ok(`run-meta: ${d}/run.json already written; left alone\n`);
    const cut = pinInner(TOOL, commit, join(tools, commit));
    if (cut.code !== 0) return cut;
    const checkout = cut.out.trim();
    const dc = canon(d);
    if (dc === null) return fail(`run-meta: cannot resolve dispatch ${d}\n`);
    try {
      appendFileSync(join(tools, `${commit}.claims`), `${dc}\n`);
    } catch {
      return fail(`run-meta: could not record the claim on ${checkout}\n`);
    }
    let built: Built;
    try {
      built = buildRecord(d, resolvedRepo, config, checkout, commit, requestedMode, requestedNotes);
    } catch {
      built = { ok: false, messages: [], notice: null };
    }
    if (!built.ok) {
      let err = built.notice !== null ? `${built.notice}\n` : "";
      for (const m of built.messages) err += `${m}\n`;
      err += `run-meta: could not write ${d}/run.json\n`;
      err += unclaim(tools, commit, dc).err;
      return { code: 1, out: "", err };
    }
    let tmp: string | null = null;
    try {
      tmp = mkstempSync(d, "tmp");
      writeFileSync(tmp, `${asciiJson(built.record)}\n`);
      renameSync(tmp, runJson);
    } catch {
      if (tmp !== null) {
        try {
          rmSync(tmp);
        } catch {
          // ignore
        }
      }
      let err = `run-meta: could not write ${d}/run.json\n`;
      err += unclaim(tools, commit, dc).err;
      return { code: 1, out: "", err };
    }
    const commit12 = (commit === "" ? "?" : commit).slice(0, 12);
    const warnings = built.warnings.map((warning) => `${warning}\n`).join("");
    return {
      code: 0,
      out: `run-meta: wrote ${runJson} (postmaster ${commit12}, pinned at ${checkout}, mode=${String(built.record.mode)}, mode_source=${String(built.record.mode_source)}, mode_setting=${String(built.record.mode_setting)}, ticket_notes=${String(built.record.ticket_notes)}, ticket_notes_source=${String(built.record.ticket_notes_source)}, ticket_notes_setting=${String(built.record.ticket_notes_setting)})\n`,
      err: built.notice !== null ? `${built.notice}\n${warnings}` : warnings,
    };
  });
  if (!held.locked) return fail(`run-meta: could not lock ${tools}\n`);
  return held.value;
}

// --- release ------------------------------------------------------------------------------
// release_pin <dispatch>: remove the pin when no claimed run is in flight.
function releasePin(d: string): Outcome {
  const tools = readTools();
  const runJson = join(d, "run.json");
  if (!isFile(runJson)) return fail(`run-meta: no run.json in ${d}\n`);
  const c = claim(runJson);
  if (c.kind === "unknown") {
    return fail(`run-meta: ${d}/run.json records an unreadable checkout; left alone\n`);
  }
  if (c.kind === "no") {
    return ok(`run-meta: ${d}/run.json records no pinned checkout; nothing to release\n`);
  }
  const recorded = c.path;
  if (!isDir(recorded)) {
    return ok(`run-meta: no pinned checkout at ${recorded}; nothing to release\n`);
  }
  const canonical = canon(recorded);
  if (canonical === null) {
    return ok(`run-meta: no pinned checkout at ${recorded}; nothing to release\n`);
  }
  const checkout = canonical;
  let toolsCanon: string;
  try {
    toolsCanon = realpathSync(tools);
  } catch {
    toolsCanon = tools;
  }
  if (!checkout.startsWith(`${toolsCanon}/`)) {
    return {
      code: 1,
      out: `run-meta: ${checkout} is not a pin under ${tools}; left alone\n`,
      err: "",
    };
  }
  const commit = basename(checkout);
  const claims = join(tools, `${commit}.claims`);
  // The check and the removal hold one lock, which dispatch takes across its pin, claim and
  // run.json write: a release either sees a dispatch's claim and keeps the pin, or removes
  // wholly before the dispatch cuts. Every check below re-runs under the lock, so two
  // releases at once serialize and the loser finds the pin already gone.
  const held = withPinLock(tools, (): Outcome => {
    if (existsSync(claims) && !isFile(claims)) {
      return fail(`run-meta: ${claims} is not a file; keeping ${checkout}\n`, 0);
    }
    let out = "";
    let err = "";
    if (isFile(claims)) {
      const cif = claimedInFlight(claims);
      err += cif.err;
      if (cif.flying) {
        out += `run-meta: kept ${checkout}; another run in flight still uses it\n`;
        return { code: 0, out, err };
      }
    } else {
      let root: string | null;
      try {
        root = realpathSync(join(d, "..", ".."));
      } catch {
        root = null;
      }
      if (root === null) {
        return fail(`run-meta: could not determine the runs root for ${d}; left alone\n`);
      }
      const flying = inFlight(root, checkout);
      out += flying.out;
      err += flying.err;
      if (flying.flying) {
        out += `run-meta: kept ${checkout}; another run in flight still uses it\n`;
        return { code: 0, out, err };
      }
    }
    const dropClaims = (): void => {
      try {
        rmSync(claims, { force: true });
      } catch {
        // ignore
      }
    };
    if (!existsSync(checkout)) {
      dropClaims();
      out += `run-meta: ${checkout} was already removed\n`;
      return { code: 0, out, err };
    }
    const common = git(checkout, "rev-parse", "--path-format=absolute", "--git-common-dir");
    if (common === null) {
      err += `run-meta: ${checkout} is not a git checkout; left alone\n`;
      return { code: 1, out, err };
    }
    if (run("git", ["--git-dir", common, "worktree", "remove", checkout]).code === 0) {
      dropClaims();
      out += `run-meta: removed ${checkout}\n`;
      return { code: 0, out, err };
    }
    if (!existsSync(checkout)) {
      dropClaims();
      out += `run-meta: ${checkout} was already removed\n`;
      return { code: 0, out, err };
    }
    if (worktreeLocked(common, checkout)) {
      err += `run-meta: ${checkout} is locked; left alone\n`;
      return { code: 1, out, err };
    }
    const dirty = git(checkout, "status", "--porcelain") ?? "?";
    if (
      dirty !== "" &&
      run("git", ["--git-dir", common, "worktree", "remove", "--force", checkout]).code === 0
    ) {
      dropClaims();
      out += `run-meta: removed ${checkout}, which was not clean\n`;
      return { code: 0, out, err };
    }
    if (dirty !== "") {
      err += `run-meta: git could not remove ${checkout} even with --force\n`;
      return { code: 1, out, err };
    }
    err += `run-meta: git could not remove ${checkout}\n`;
    return { code: 1, out, err };
  });
  if (!held.locked) return fail(`run-meta: could not lock ${tools}\n`);
  return held.value;
}

// --- entry ------------------------------------------------------------------------------
function usage(): never {
  process.stderr.write(`${USAGE}\n`);
  process.exit(1);
  throw new Error("unreachable");
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  // Hidden scan mode: the pin scan as a child process, so a scan that dies mid-way is observed
  // and keeps the pin. Never in usage; release is its only caller.
  if (argv[0] === "run-meta-scan" && (argv.length === 3 || argv.length === 4)) {
    const holdRaw = argv.length === 4 ? (argv[3] as string) : "";
    let holdMs = 0;
    if (HOLD_RE.test(holdRaw)) holdMs = Math.min(Number(holdRaw), 120000);
    if (holdMs > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, holdMs);
    const found = pinScan(argv[1] as string, argv[2] as string);
    if (found.err !== "") process.stderr.write(found.err);
    process.exit(found.code);
  }
  {
    const cmd = argv[0];
    const verbs = [
      "pin",
      "path",
      "mode",
      "ticket-notes",
      "check",
      "release",
      "efforts",
      "run-pinned",
    ];
    let outcome: Outcome;
    if (cmd === "pin" && argv.length === 3)
      outcome = pin(argv[1] as string, argv[2] as string, readTools());
    else if (cmd === "path" && argv.length === 2) outcome = pathOf(argv[1] as string);
    else if (cmd === "mode" && argv.length === 2) outcome = mode(argv[1] as string);
    else if (cmd === "ticket-notes" && argv.length === 2)
      outcome = ticketNotesVerb(argv[1] as string);
    else if (cmd === "check" && argv.length === 2) {
      const pinCheck = checkPinAndConfinement(argv[1] as string);
      outcome = pinCheck.code !== 0 ? pinCheck : checkMode(argv[1] as string);
    } else if (cmd === "release" && argv.length === 2) outcome = releasePin(argv[1] as string);
    else if (cmd === "run-pinned" && argv.length >= 3) {
      const pinned = pathOf(argv[1] as string);
      if (pinned.code !== 0) outcome = pinned;
      else {
        const result = runPinned(pinned.out.trim(), argv[2] as string, argv.slice(3));
        outcome = { code: result.code, out: result.out, err: result.err };
      }
    } else if (cmd === "efforts" && argv.length === 2) outcome = efforts(argv[1] as string);
    else if (
      cmd !== undefined &&
      !verbs.includes(cmd) &&
      (argv.length === 2 || argv.length === 4 || argv.length === 6)
    ) {
      let requestedMode: string | undefined;
      let requestedNotes: string | undefined;
      const rest = argv.slice(2);
      let bad = rest.length % 2 !== 0;
      for (let i = 0; !bad && i < rest.length; i += 2) {
        const flag = rest[i];
        const value = rest[i + 1];
        if (flag === "--mode" && requestedMode === undefined) requestedMode = value;
        else if (flag === "--ticket-notes" && requestedNotes === undefined) requestedNotes = value;
        else bad = true;
      }
      if (bad) usage();
      outcome = meta(argv[0] as string, argv[1] as string, requestedMode, requestedNotes);
    } else usage();
    if (outcome.out !== "") process.stdout.write(outcome.out);
    if (outcome.err !== "") process.stderr.write(outcome.err);
    process.exit(outcome.code);
  }
}
