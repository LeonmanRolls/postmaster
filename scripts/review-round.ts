// A review round's bookkeeping: its time limit, collecting it, recording and stopping the
// reviewers that do not finish in time, and tearing its scratches down with nothing of the
// round still running in them. The round itself is cut, launch, then the runbook's loop:
// wait-next returns as each reviewer finishes so its findings are fixed while the others
// still work, harvest normalizes one bug report at a time, fix saves each fix with its
// record in one step, and gate runs the gate on the fixed tree while the round is open.
// Launch starts no reviewer while a brief one of its reviewers needs is missing, keeps
// the first starting state when the round is retried, and refuses a round whose check is
// already recorded. The round's reach check is collected when the whole round is in,
// completing an unfinished collection and never repeating a finished one. A cut at a
// commit with a recorded pass reuses it instead of running verify again.
//
//   run review-round start    <dispatch> <round> [<lens>:<lane>...]
//   run review-round cut      <dispatch> <round> <repo> <synthesis-wt>
//   run review-round launch   <dispatch> <round> <repo> <synthesis-wt>
//   run review-round harvest  <dispatch> <round> <repo> [<lens>:<lane>...]
//   run review-round wait     <dispatch> <round> <repo> [<lens>:<lane>...]
//   run review-round wait-next <dispatch> <round> <repo> [<lens>:<lane>...]
//   run review-round teardown <dispatch> <round> <repo> [<lens>:<lane>...]
//   run review-round gate     <dispatch> <round> <synthesis-wt>
//   run review-round fix      <dispatch> <synthesis-wt> --message <m> --findings <csv> -- <path>...
//
//   exit 0  wait: every marker is in · wait-next: new finishes reported, or every
//           reviewer reported · start, teardown, fix and gate: done · cut and harvest:
//           done · launch: every reviewer started · a whole-round collection also ran
//           the round's reach check, found it already recorded, or had no starting state
//   exit 3  wait and wait-next: the deadline passed; each reviewer with no marker is
//           recorded and stopped; a whole-round close also ran the round's reach
//           check, found it already recorded, or had no starting state
//   exit 4  wait and wait-next: a record could not be written, a reviewer is still
//           running and the round's check is not run, or the round's reach check
//           failed; stop the leg
//   exit 1  usage; the round was not started, or the machine restarted or the round was started
//           again since the wait began; a marker no reviewer of the round lands; a pairs wait
//           or wait-next with no reviewers recorded and a starting state saved; start: the
//           round already reported finishers, resume it with wait-next;
//           wait-next: the action log cannot be read; teardown: a
//           scratch left in place; cut: run verify exited other than 0 or 3, the run's legs or
//           a lens's lanes did not resolve, or a left-behind scratch did not tear down;
//           launch: the same resolution failures, a round whose reach check is already
//           recorded, a brief a reviewer needs that is missing, a prompt that could not be
//           written, the round's starting state that could not be saved, a scratch that was
//           not ready, a reviewer that did not start, or the round did not start;
//           harvest: a named reviewer that is
//           not a bug reviewer of the round; gate: a dirty tree, an unwritable pass file, or a
//           failing gate; fix: unstageable paths, an uncommittable fix, or an unrecorded apply;
//           the round's own teardown, naming
//           no reviewers, comes before the reach check of a round that took its reach snapshot
//           (nothing is removed)
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { scriptsDir } from "./lib/paths.ts";
import { mkstempSync, run } from "./lib/proc.ts";
import { bootId, sameBoot } from "./lib/processes.ts";
import { PY_S_CLASS } from "./lib/text.ts";
import { reachActions } from "./reach.ts";
import { uncommittedFiles } from "./verify.ts";
import { countdown, sleepMs } from "./wait-for-markers.ts";
import { lostWallFor, wallFor } from "./walls.ts";

const HERE = scriptsDir(import.meta);
const DEFAULT_LIMIT = 2400;
const MAX_LIMIT = 86400;
const USAGE =
  "usage: run review-round start <dispatch> <round> [<lens>:<lane>...] | cut|launch <dispatch> <round> <repo> <synthesis-wt>" +
  " | harvest <dispatch> <round> <repo> [<lens>:<lane>...] | wait|wait-next|teardown <dispatch> <round> <repo> [<lens>:<lane>...]" +
  " | gate <dispatch> <round> <synthesis-wt> | fix <dispatch> <synthesis-wt> --message <m> --findings <csv> -- <path>...";

function die(msg: string): never {
  console.error(`review-round: ${msg}`);
  process.exit(1);
}

export function monotonic(): number {
  try {
    const up = readFileSync("/proc/uptime", "utf8").split(" ")[0];
    return parseFloat(up ?? "0");
  } catch {
    return Date.now() / 1000;
  }
}

/**
 * Whether teardown must still wait for the round's reach check: it is the round's own teardown,
 * the round took its reach snapshot, and no point named for the round is recorded.
 */
export function reachCheckMissing(
  waitsForReach: boolean,
  points: readonly string[],
  round: string,
): boolean {
  return waitsForReach && !points.includes(`r${round}`);
}

/**
 * Whether the round's reach check is recorded: a reach point named for the
 * round in the journal. False when the record cannot be read, so a refusal
 * is never told from a broken journal. The launch and the wait read this one
 * definition, so they never disagree about whether a round is collected.
 */
export function roundPointRecorded(dispatch: string, round: string): boolean {
  try {
    return reachActions(dispatch).some(
      ({ event }) => event.kind === "point" && String(event.point) === `r${round}`,
    );
  } catch {
    return false;
  }
}

interface RoundState {
  attempt: string;
  boot: string;
  limit: number;
  source: string;
  deadline: number;
  started: string;
  reviewers: Array<[string, string]>;
}

function stateLoad(path: string): RoundState {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as RoundState;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      die(`round not started: no ${path}; start runs before the round's launches`);
    }
    die(`${path} cannot be read: ${String(e)}`);
  }
}

function stateSave(path: string, st: RoundState): void {
  const tmp = mkstempSync(dirname(path), "tmp");
  writeFileSync(tmp, `${JSON.stringify(st, null, 2)}\n`);
  renameSync(tmp, path);
}

export const ARG_SPLIT_RE = new RegExp(`[${PY_S_CLASS},]+`, "u");

function stateCmd(
  what: string,
  path: string,
  args: string[],
): { code: number; out: string; err: string } {
  const out: string[] = [];
  const err: string[] = [];
  if (what === "start") {
    const runJson = args[0] ?? "";
    const def = parseInt(args[1] ?? "2400", 10);
    const most = parseInt(args[2] ?? "86400", 10);
    let limit: number;
    let source: string;
    const fall = (why: string): void => {
      err.push(`review-round: ${why}; the round's time limit is the default, ${def}s`);
      limit = def;
      source = "the default";
    };
    try {
      const runData = JSON.parse(readFileSync(runJson, "utf8")) as Record<string, unknown>;
      const cfg = runData.config;
      const review =
        cfg !== null && typeof cfg === "object" && !Array.isArray(cfg)
          ? (cfg as Record<string, unknown>).review
          : undefined;
      const v =
        review !== null && typeof review === "object" && !Array.isArray(review)
          ? (review as Record<string, unknown>).round_timeout_seconds
          : undefined;
      if (v === undefined || v === null) {
        limit = def;
        source = "the default";
      } else if (
        typeof v === "number" &&
        Number.isInteger(v) &&
        !Number.isNaN(v) &&
        v >= 1 &&
        v <= most
      ) {
        limit = v;
        source = "review.round_timeout_seconds in run.json";
      } else {
        fall(
          `review.round_timeout_seconds in ${runJson} is ${JSON.stringify(v)}, not a whole number of seconds from 1 to ${most}`,
        );
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        fall(`no run.json at ${runJson}`);
      } else {
        fall(`${runJson} cannot be read (${String(e)})`);
      }
    }
    const attemptBytes = new Uint8Array(8);
    crypto.getRandomValues(attemptBytes);
    const attempt = Array.from(attemptBytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const now = new Date();
    stateSave(path, {
      attempt,
      boot: bootId(),
      limit: limit!,
      source: source!,
      deadline: monotonic() + limit!,
      started: now.toISOString().replace(/\.[0-9]+Z$/u, "Z"),
      reviewers: [],
    });
    out.push(`${limit!}\t${source!}`);
    return {
      code: 0,
      out: `${out.join("\n")}\n`,
      err: err.join("\n") ? `${err.join("\n")}\n` : "",
    };
  }
  if (what === "check") {
    const st = stateLoad(path);
    const b = bootId();
    if (st.boot && b && !sameBoot(st.boot, b)) {
      die(
        "the machine has restarted since the round started, so none of its reviewers runs; start the round again",
      );
    }
    const left = Math.max(0, Math.ceil(st.deadline - monotonic()));
    out.push(`${st.attempt}\t${left}\t${st.limit}\t${st.source}`);
    return { code: 0, out: `${out.join("\n")}\n`, err: "" };
  }
  if (what === "reviewers" || what === "pairs") {
    const st: RoundState =
      what === "reviewers"
        ? stateLoad(path)
        : ({
            attempt: "",
            boot: "",
            limit: 0,
            source: "",
            deadline: 0,
            started: "",
            reviewers: [],
          } as RoundState);
    const given = args.flatMap((a) => a.split(ARG_SPLIT_RE)).filter((x) => x !== "");
    if (given.length > 0) {
      const pairs: Array<[string, string]> = [];
      const bad: string[] = [];
      for (const x of given) {
        const m = /^([A-Za-z0-9._-]+):([A-Za-z0-9._-]+)$/u.exec(x);
        if (!m || ["", ".", ".."].includes(m[1] ?? "") || ["", ".", ".."].includes(m[2] ?? "")) {
          bad.push(x);
        } else if (!pairs.some((p) => p[0] === m[1] && p[1] === m[2])) {
          pairs.push([m[1] ?? "", m[2] ?? ""]);
        }
      }
      if (bad.length > 0) {
        die(`not a <lens>:<lane>: ${bad.join(", ")}`);
      }
      st.reviewers = pairs;
      if (what === "reviewers") stateSave(path, st);
    }
    if (!st.reviewers || st.reviewers.length === 0) {
      die("no reviewers given, and none recorded for this round");
    }
    for (const [lens, lane] of st.reviewers) {
      out.push(`${lens}\t${lane}`);
    }
    return { code: 0, out: `${out.join("\n")}\n`, err: "" };
  }
  die(`unknown state command: ${what}`);
}

function scratch(repo: string, ticket: string, lens: string, lane: string): string {
  return join(repo, ".worktrees", `${ticket}-rev-${lens}-${lane}`);
}

/**
 * The round's collection records, as `lens\\0lane`: finish rows are wait-next's
 * memory of whom it reported, harvest rows of whom the coachman collected, and
 * degrade rows of whom is out. A missing log reads as none; an unreadable or
 * malformed one stops the wait rather than report twice or skip one.
 */
interface RoundRecords {
  finished: Set<string>;
  harvested: Set<string>;
  degraded: Set<string>;
}

function roundRecords(dispatch: string, round: string): RoundRecords {
  const finished = new Set<string>();
  const harvested = new Set<string>();
  const degraded = new Set<string>();
  let contents: string;
  try {
    contents = readFileSync(join(dispatch, "actions.jsonl"), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { finished, harvested, degraded };
    die(`cannot read the action log at ${join(dispatch, "actions.jsonl")}: ${String(e)}`);
  }
  for (const line of contents.split("\n")) {
    if (line.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      die("actions.jsonl has a line that is not JSON");
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      die("actions.jsonl has a line that is not an action object");
    }
    const row = parsed as Record<string, unknown>;
    if (typeof row.target !== "string" || row.target === "") continue;
    const words = typeof row.detail === "string" ? row.detail.trim().split(/[ \t\r\n]+/u) : [];
    const lens = words[0] ?? "";
    if (lens === "") continue;
    const key = `${lens}\0${row.target}`;
    if (row.action === "review-finish" || row.action === "review-harvest") {
      if (words.length >= 3 && words[1] === "round" && words[2] === round) {
        (row.action === "review-finish" ? finished : harvested).add(key);
      }
    } else if (row.action === "degrade") {
      // `<lens> r<N>: ...` (timeout, wall, reach) or `bug round <N>: ...`
      // (a harvest that failed): every shape that takes a reviewer out. The
      // colon rides on the number in both, as review-decide reads them.
      if (words[1] === `r${round}:` || (words[1] === "round" && words[2] === `${round}:`)) {
        degraded.add(key);
      }
    }
  }
  return { finished, harvested, degraded };
}

/**
 * The run's wall for a reviewer, recorded or lost. The host lands the marker
 * whatever the exit, so a wall the launch detected but could not record
 * (logs/<lane>.wall-lost, walls.ts) would otherwise read as a clean finish
 * and its verdict would count without its wall. A lost wall reads as a wall
 * whose message says how it arrived; `walls open` still refuses on the file,
 * so the card still waits on its ruling (D8).
 */
function wallOrLostWall(
  dispatch: string,
  lane: string,
  lens: string,
  round: string,
): { message: string } | null {
  const w = wallFor(dispatch, lane, lens, round);
  if (w !== null) return w;
  const lost = lostWallFor(dispatch, lane, lens, round);
  if (lost === null) return null;
  return { message: `detected but not recorded: ${lost.message}` };
}

function unswitch(s: string, ticket: string): string {
  const k = run(join(HERE, "run"), ["cut-scratch", "--kind", s]);
  if (k.code === 0) return "";
  const ref = run("git", ["-C", s, "symbolic-ref", "-q", "--short", "HEAD"]);
  if (ref.code !== 0) return "";
  const b = ref.out.trim();
  if (b === ticket || b.startsWith(`wb/${ticket}-`)) return "";
  const co = run("git", ["-C", s, "checkout", "-q", "--detach"]);
  if (co.code === 0)
    return `a reviewer had switched it onto branch ${b}; detached, and the branch kept`;
  return "";
}

// --- the round's three steps: cut, launch, harvest ---------------------------------------------
// The runbook's review round is these three calls. Each does what its shell block did: the
// records, the files, the output and the stops. The scripts they run (and git) arrive as
// StepDeps, so a test can stand in for each and record its arguments.

export interface StepChild {
  code: number;
  out: string;
  err: string;
}

export interface StepDeps {
  tool: (name: string, args: string[]) => StepChild;
  git: (args: string[]) => StepChild;
}

export interface StepArgs {
  dispatch: string;
  round: string;
  repo: string;
  synthesis: string;
}

export interface StepResult {
  code: number;
  out: string[];
  err: string[];
}

function lineList(s: string): string[] {
  if (s === "") return [];
  const t = s.endsWith("\n") ? s.slice(0, -1) : s;
  return t === "" ? [] : t.split("\n");
}

function passErr(res: StepResult, child: StepChild): void {
  res.err.push(...lineList(child.err));
}

function passOut(res: StepResult, child: StepChild): void {
  res.out.push(...lineList(child.out));
}

/** A run-log or log-action line: its stderr shows, and a failure says what was not recorded. */
function recordStep(
  res: StepResult,
  deps: StepDeps,
  name: "run-log" | "log-action",
  args: string[],
): void {
  const r = deps.tool(name, args);
  passErr(res, r);
  if (r.code !== 0) {
    const what =
      name === "run-log"
        ? `run-log.md: ${args[1] ?? ""}`
        : `actions.jsonl: ${args.slice(2).join(" ")}`;
    res.out.push(`NOT RECORDED in ${what}`);
  }
}

/** manifest.json's base: the sha the round reviews from. */
function manifestBase(dispatch: string): string {
  try {
    const m = JSON.parse(readFileSync(join(dispatch, "manifest.json"), "utf8")) as Record<
      string,
      unknown
    >;
    if (typeof m.base === "string") return m.base;
  } catch {
    // a missing or unreadable manifest gives no base; the caller stops
  }
  return "";
}

/** The checks-file lines run verify marks `not run` and the lines that reason with them. */
function notRunLines(text: string): string[] {
  const out: string[] = [];
  let cont = false;
  for (const line of text.split("\n")) {
    if (line.includes(": not run, ")) {
      out.push(line);
      cont = true;
    } else if (cont && line.startsWith("  ")) {
      out.push(line);
    } else {
      cont = false;
    }
  }
  return out;
}

/**
 * The open lenses of this round, each with its lanes: the review leg's turnpikes, style
 * dropped from round 2 on. A turnpikes, waybill or lens that does not resolve stops the
 * step with res.code 1 and null.
 */
function resolveLenses(
  a: StepArgs,
  deps: StepDeps,
  res: StepResult,
): Array<[string, string[]]> | null {
  const legs = deps.tool("turnpikes", ["legs", a.dispatch]);
  if (legs.code !== 0) {
    passErr(res, legs);
    res.err.push("review-round: the run's legs cannot be read");
    res.code = 1;
    return null;
  }
  const review = lineList(legs.out)
    .map((l) => l.split(/[ \t]+/u))
    .find((fields) => fields[1] === "review");
  if (!review) {
    res.err.push("review-round: the run lists no review leg");
    res.code = 1;
    return null;
  }
  const names = review.slice(2).filter((n) => a.round === "1" || n !== "style");
  const pairs: Array<[string, string[]]> = [];
  for (const lens of names) {
    const r = deps.tool("reviewers", ["lanes", join(a.dispatch, "brief.md"), lens]);
    if (r.code !== 0) {
      passErr(res, r);
      res.code = 1;
      return null;
    }
    pairs.push([lens, lineList(r.out).filter((x) => x.trim() !== "")]);
  }
  return pairs;
}

function snapshotOf(a: { synthesis: string }, deps: StepDeps, res: StepResult): string {
  const g = deps.git(["-C", a.synthesis, "rev-parse", "HEAD"]);
  if (g.code !== 0) {
    passErr(res, g);
    res.err.push(`review-round: no snapshot at ${a.synthesis}`);
    res.code = 1;
    return "";
  }
  return g.out.trim();
}

/** Whether the synthesis worktree holds exactly its commit: the dirt check `verify run`
 * refuses on, shared so a reused pass and a fresh run test the same clean tree. A status
 * that cannot be read is not clean: the caller runs verify, which refuses as today. */
function treeClean(a: { synthesis: string }, deps: StepDeps): boolean {
  const status = deps.git(["-C", a.synthesis, "status", "--porcelain", "--untracked-files=all"]);
  if (status.code !== 0) return false;
  return uncommittedFiles(status.out).length === 0;
}

interface GatePass {
  exit: number;
  fromRound: string;
  file: string;
  text: string;
}

const CUT_RUN_RE = /^review round ([1-9][0-9]*), run verify exit ([0-9]+)$/u;
const MIDROUND_RUN_RE = /^review round ([1-9][0-9]*), run verify exit ([0-9]+), mid-round gate$/u;
const REUSE_PASS_RE =
  /^review round ([1-9][0-9]*), gate pass reused from round ([1-9][0-9]*) \(run verify exit ([03])\)$/u;

/**
 * The newest recorded gate pass on a commit that still has its checks text, kept
 * under logs/gate-<commit>.txt by the cut or mid-round gate that recorded it. The
 * text lives under its commit, never under the round: a later cut of the same round
 * at another commit rewrites the round's checks file, and must not move it.
 * The latest verify evidence decides: a fail row (exit 2: the checks ran and a
 * check failed) on the commit after the newest pass reuses nothing, and the
 * cut runs verify again. A refusal (exit 1: verify never ran) is not evidence
 * about the commit and moves nothing, and a reuse row carries no fresh
 * evidence, so only exit-2 cut and mid-round rows move the decision.
 * Anything unreadable yields no pass: the cut runs verify, as today. The log's
 * strict reader stays review-decide.
 */
export function findGatePass(dispatch: string, snap: string): GatePass | null {
  let contents: string;
  try {
    contents = readFileSync(join(dispatch, "actions.jsonl"), "utf8");
  } catch {
    return null;
  }
  const candidates: Array<{ exit: number; fromRound: string; file: string }> = [];
  let newestPass = -1;
  let newestFail = -1;
  const lines = contents.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.trim() === "") continue;
    let row: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(line);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      row = parsed as Record<string, unknown>;
    } catch {
      continue;
    }
    if (row.action !== "gate" || row.target !== snap) continue;
    const detail = typeof row.detail === "string" ? row.detail : "";
    const file = join(dispatch, "logs", `gate-${snap}.txt`);
    const run = CUT_RUN_RE.exec(detail) ?? MIDROUND_RUN_RE.exec(detail);
    if (run) {
      const exit = Number(run[2]);
      if (exit === 0 || exit === 3) {
        candidates.push({ exit, fromRound: run[1] ?? "", file });
        newestPass = i;
      } else if (exit === 2) {
        newestFail = i;
      }
      continue;
    }
    const m = REUSE_PASS_RE.exec(detail);
    if (m) {
      // The reused row's own round keeps the chain of rows followable round by
      // round; the text sits under the commit either way.
      candidates.push({ exit: Number(m[3]), fromRound: m[1] ?? "", file });
    }
  }
  if (newestFail > newestPass) return null;
  for (let i = candidates.length - 1; i >= 0; i--) {
    const candidate = candidates[i]!;
    try {
      return { ...candidate, text: readFileSync(candidate.file, "utf8") };
    } catch {
      // a pass whose text is gone reuses nothing; an older pass still may
    }
  }
  return null;
}

function scratchPath(repo: string, ticket: string, lens: string, lane: string): string {
  return join(repo, ".worktrees", `${ticket}-rev-${lens}-${lane}`);
}

/** cut: verify the snapshot, or reuse a recorded pass on it, then log the gate, prune,
 * resolve the lenses and cut every scratch. */
export function cutRound(a: StepArgs, deps: StepDeps): StepResult {
  const res: StepResult = { code: 0, out: [], err: [] };
  const snap = snapshotOf(a, deps, res);
  if (res.code !== 0) return res;
  const base = manifestBase(a.dispatch);
  if (base === "") {
    res.err.push("review-round: manifest.json gives no base");
    res.code = 1;
    return res;
  }
  const checks = join(a.dispatch, "logs", `review-r${a.round}-checks.txt`);
  try {
    // The shell's redirection opens the file before the command runs.
    writeFileSync(checks, "");
  } catch (e) {
    res.err.push(
      `review-round: ${checks} cannot be written (${e instanceof Error ? e.message : String(e)})`,
    );
    res.code = 1;
    return res;
  }
  // A pass recorded on exactly this commit, with its checks text, is reused: no second
  // verify run on the same code. A tree verify would refuse never reuses: it runs
  // verify, which refuses as today.
  const pass = findGatePass(a.dispatch, snap);
  let verifyCode: number;
  let verifyOut: string;
  let reusedFrom: string | null = null;
  if (pass !== null && treeClean(a, deps)) {
    verifyCode = pass.exit;
    verifyOut = pass.text;
    reusedFrom = pass.fromRound;
  } else {
    const v = deps.tool("verify", ["run", a.synthesis, a.dispatch]);
    verifyCode = v.code;
    verifyOut = v.out;
    passErr(res, v);
  }
  let wroteChecks = true;
  try {
    writeFileSync(checks, verifyOut);
  } catch (e) {
    res.err.push(
      `review-round: ${checks} cannot be written (${e instanceof Error ? e.message : String(e)})`,
    );
    wroteChecks = false;
  }
  // Keep the pass text under its commit, beside the round's view of it, so a
  // later cut finds it whatever round file was rewritten since. A reuse writes
  // the same text it read. Anything but a pass keeps its hands off the kept
  // text: a failure must not pose as the pass an older row points at.
  let wrotePass = true;
  if (verifyCode === 0 || verifyCode === 3) {
    try {
      writeFileSync(join(a.dispatch, "logs", `gate-${snap}.txt`), verifyOut);
    } catch (e) {
      res.err.push(
        `review-round: gate-${snap}.txt cannot be written (${e instanceof Error ? e.message : String(e)})`,
      );
      wrotePass = false;
    }
  }
  res.out.push(...lineList(verifyOut));
  if (reusedFrom !== null) {
    res.out.push(
      `review-round: round ${a.round} reuses the gate pass on ${snap.slice(0, 12)} from round ${reusedFrom}`,
    );
  }
  recordStep(res, deps, "log-action", [
    a.dispatch,
    "coachman",
    "gate",
    snap,
    reusedFrom !== null
      ? `review round ${a.round}, gate pass reused from round ${reusedFrom} (run verify exit ${verifyCode})`
      : `review round ${a.round}, run verify exit ${verifyCode}`,
  ]);
  if (!wroteChecks || !wrotePass || (verifyCode !== 0 && verifyCode !== 3)) {
    res.code = 1;
    return res;
  }
  if (verifyCode === 3) {
    for (const line of notRunLines(verifyOut)) {
      recordStep(res, deps, "run-log", [
        a.dispatch,
        `review round ${a.round} gate not run: ${line}`,
      ]);
    }
  }
  const prune = deps.git(["-C", a.repo, "worktree", "prune"]);
  passErr(res, prune);
  const lenses = resolveLenses(a, deps, res);
  if (lenses === null) return res;
  const ticket = basename(a.dispatch);
  for (const [lens, lanes] of lenses) {
    for (const lane of lanes) {
      const dest = scratchPath(a.repo, ticket, lens, lane);
      if (existsSync(dest)) {
        const diff = deps.git(["-C", dest, "diff", "--name-only", snap]);
        for (const file of lineList(diff.out)) {
          if (file.trim() !== "") res.out.push(`LEFT BEHIND AND MODIFIED, ${dest}: ${file}`);
        }
        const t = deps.tool("review-round", [
          "teardown",
          a.dispatch,
          a.round,
          a.repo,
          `${lens}:${lane}`,
        ]);
        passOut(res, t);
        passErr(res, t);
        if (t.code !== 0) {
          res.code = 1;
          return res;
        }
      }
      const cut = deps.tool("cut-scratch", [a.repo, a.synthesis, dest, snap, "--clone", base]);
      passOut(res, cut);
      passErr(res, cut);
      if (cut.code !== 0) {
        res.out.push(
          `SCRATCH BROKEN: ${dest} is not cut at ${snap}; fix before launching ${lane} under ${lens}`,
        );
      }
    }
  }
  return res;
}

/** launch: briefs, prompt files, ready scratches, the starting state, the round's start
 * with its reviewers, then every reviewer through the host. The runbook collects them with
 * wait-next, fixing each report while the others still work; the launch itself no longer waits. */
export function launchRound(a: StepArgs, deps: StepDeps): StepResult {
  const res: StepResult = { code: 0, out: [], err: [] };
  const snap = snapshotOf(a, deps, res);
  if (res.code !== 0) return res;
  const base = manifestBase(a.dispatch);
  if (base === "") {
    res.err.push("review-round: manifest.json gives no base");
    res.code = 1;
    return res;
  }
  const lenses = resolveLenses(a, deps, res);
  if (lenses === null) return res;
  // A collected round is never launched again: its reviewers already ran, and
  // launching it would run new reviewers the recorded check cannot see.
  if (roundPointRecorded(a.dispatch, a.round)) {
    res.err.push(
      `review-round: round ${a.round} already has its reach check recorded; nothing launched`,
    );
    res.code = 1;
    return res;
  }
  const ticket = basename(a.dispatch);
  const lensPrompt = (lens: string): string =>
    join(a.dispatch, `review-r${a.round}-${lens}-prompt.txt`);
  // A round starts no reviewer while a brief one of its reviewers needs is
  // missing. Every lens but bug is launched from a prompt that points at the
  // lens's brief, except a security lane whose harness has its own skill.
  const briefOf = (lens: string): string => join(a.dispatch, `review-${lens}-brief.md`);
  const securityPrompts = new Map<string, string>();
  for (const [lens, lanes] of lenses) {
    if (lens === "bug") continue;
    let needBrief = [...lanes];
    if (lens === "security") {
      needBrief = [];
      for (const lane of lanes) {
        const skill = deps.tool("launch", ["skill", lane, "security-review", "--run", a.dispatch]);
        if (skill.code === 0) {
          securityPrompts.set(lane, skill.out);
        } else if (skill.code === 3) {
          securityPrompts.set(lane, "");
          needBrief.push(lane);
        } else {
          passErr(res, skill);
          res.out.push(`NO SECURITY PROMPT FOR ${lane}; nothing launched`);
          res.code = 1;
          return res;
        }
      }
    }
    if (needBrief.length > 0 && !existsSync(briefOf(lens))) {
      res.err.push(
        `review-round: ${briefOf(lens)} is missing, and ${needBrief.join(", ")} under ${lens} reads it; nothing launched`,
      );
      res.code = 1;
      return res;
    }
  }
  for (const [lens, lanes] of lenses) {
    if (lens !== "bug") {
      try {
        writeFileSync(
          lensPrompt(lens),
          `Read ${a.dispatch}/review-${lens}-brief.md and execute it. Report findings as your final message. Do not modify any file you are reviewing.\n`,
        );
      } catch (e) {
        res.err.push(
          `review-round: ${lensPrompt(lens)} cannot be written (${e instanceof Error ? e.message : String(e)})`,
        );
        res.code = 1;
        return res;
      }
    }
    if (lens === "security") {
      for (const lane of lanes) {
        const lanePrompt = join(a.dispatch, `review-r${a.round}-security-${lane}-prompt.txt`);
        const skilled = securityPrompts.get(lane) ?? "";
        try {
          writeFileSync(lanePrompt, skilled === "" ? readFileSync(lensPrompt(lens)) : skilled);
        } catch (e) {
          res.err.push(
            `review-round: ${lanePrompt} cannot be written (${e instanceof Error ? e.message : String(e)})`,
          );
          res.code = 1;
          return res;
        }
      }
    }
  }
  for (const [lens, lanes] of lenses) {
    for (const lane of lanes) {
      const dest = scratchPath(a.repo, ticket, lens, lane);
      const check = deps.tool("cut-scratch", ["--check", dest, snap, "--clone", base]);
      if (check.code !== 0) {
        passOut(res, check);
        passErr(res, check);
        res.out.push(`SCRATCH NOT READY: ${ticket}-rev-${lens}-${lane}; nothing launched`);
        res.code = 1;
        return res;
      }
    }
  }
  const pairs: string[] = [];
  for (const [lens, lanes] of lenses) {
    for (const lane of lanes) pairs.push(`${lens}:${lane}`);
  }
  if (pairs.length === 0) {
    res.err.push(`review-round: round ${a.round} has no reviewers; nothing launched`);
    res.code = 1;
    return res;
  }
  // A retried round keeps its first starting state: the first attempt's
  // reviewers ran under it, so saving again would fold anything they changed
  // outside their scratches into the new baseline, past the eventual check.
  const snapPath = join(a.dispatch, "reach", `before-r${a.round}.json`);
  if (existsSync(snapPath)) {
    res.out.push(`review-round: round ${a.round} keeps its first starting state`);
  } else {
    const before = deps.tool("reach", ["before", a.dispatch, a.round]);
    passOut(res, before);
    passErr(res, before);
    if (before.code !== 0) {
      res.err.push("review-round: the round's starting state could not be saved; nothing launched");
      res.code = 1;
      return res;
    }
  }
  const start = deps.tool("review-round", ["start", a.dispatch, a.round, ...pairs]);
  passOut(res, start);
  passErr(res, start);
  if (start.code !== 0) {
    res.code = 1;
    return res;
  }
  const entry = join(HERE, "run");
  for (const [lens, lanes] of lenses) {
    for (const lane of lanes) {
      const dest = scratchPath(a.repo, ticket, lens, lane);
      const named = deps.tool("host", ["name", a.dispatch, "review", lane, lens, a.round]);
      if (named.code !== 0) {
        passErr(res, named);
        res.err.push(`review-round: no name for ${lens} ${lane}`);
        res.code = 1;
        return res;
      }
      const name = named.out.trim();
      const prompt =
        lens === "security"
          ? join(a.dispatch, `review-r${a.round}-security-${lane}-prompt.txt`)
          : lensPrompt(lens);
      const launch =
        lens === "bug"
          ? [
              entry,
              "launch",
              "review",
              lane,
              dest,
              base,
              "--last",
              join(a.dispatch, "logs", `review-r${a.round}-bug-${lane}-last.md`),
              "--run",
              a.dispatch,
            ]
          : [entry, "launch", "launch", lane, dest, prompt, "--run", a.dispatch];
      const started = deps.tool("host", [
        "run",
        name,
        dest,
        "--under",
        a.dispatch,
        "--role",
        "reviewer",
        "--run",
        a.dispatch,
        "--out",
        join(a.dispatch, "logs", `review-r${a.round}-${lens}-${lane}.jsonl`),
        "--err",
        join(a.dispatch, "logs", `review-r${a.round}-${lens}-${lane}.err`),
        "--marker",
        join(a.dispatch, "logs", `review-r${a.round}-${lens}-${lane}.done`),
        "--",
        ...launch,
      ]);
      passOut(res, started);
      passErr(res, started);
      // A reviewer that never started is launches not done: stop the round
      // before its first launch row, and re-run it whole, from the cut.
      if (started.code !== 0) {
        res.err.push(
          `review-round: ${lens} ${lane} did not start; re-run the round whole, from the cut`,
        );
        res.code = 1;
        return res;
      }
      recordStep(res, deps, "log-action", [
        a.dispatch,
        "coachman",
        "review-launch",
        lane,
        `${lens} round ${a.round}`,
      ]);
    }
  }
  res.out.push(
    `review-round: round ${a.round} launched, ${pairs.length} reviewers; collect them with wait-next`,
  );
  return res;
}

/** harvest: each bug lane's report, or only the named reviewers' reports, degrading on
 * a harvest that fails and reading a report the normalizer cannot. A named reviewer under
 * another lens has no normalized report; the runbook reads its raw report by hand. */
export function harvestRound(
  a: { dispatch: string; round: string; repo: string; only?: Array<[string, string]> },
  deps: StepDeps,
): StepResult {
  const res: StepResult = { code: 0, out: [], err: [] };
  const logs = join(a.dispatch, "logs");
  const lanesCall = deps.tool("reviewers", ["lanes", join(a.dispatch, "brief.md"), "bug"]);
  let lanes: string[] = [];
  if (lanesCall.code === 0) {
    lanes = lineList(lanesCall.out).filter((x) => x.trim() !== "");
  } else {
    // The shell showed the refusal and looped over nothing.
    passErr(res, lanesCall);
  }
  let wanted: string[] | null = null;
  if (a.only && a.only.length > 0) {
    wanted = [];
    for (const [lens, lane] of a.only) {
      if (lens !== "bug") {
        res.out.push(
          `review round ${a.round} ${lane}: ${lens} has no normalized report; reading the raw report by hand`,
        );
        continue;
      }
      if (!lanes.includes(lane)) {
        res.err.push(`review-round: ${lane} is not a bug reviewer of round ${a.round}`);
        res.code = 1;
        return res;
      }
      if (!wanted.includes(lane)) wanted.push(lane);
    }
  }
  const ticket = basename(a.dispatch);
  const normalizeFailed: string[] = [];
  for (const lane of wanted ?? lanes) {
    const dest = scratchPath(a.repo, ticket, "bug", lane);
    const events = join(logs, `review-r${a.round}-bug-${lane}.jsonl`);
    const prefix = `review-r${a.round}-bug-${lane}`;
    const harvest = deps.tool("review-findings", ["harvest", events, logs, "--prefix", prefix]);
    if (harvest.code !== 0) {
      const msg = `${harvest.out}${harvest.err}`.replace(/\n+$/u, "");
      recordStep(res, deps, "log-action", [
        a.dispatch,
        "coachman",
        "degrade",
        lane,
        `bug round ${a.round}: ${msg}`,
      ]);
      recordStep(res, deps, "run-log", [a.dispatch, `${lane} bug: DEGRADED, ${msg}`]);
      continue;
    }
    const findings = join(logs, `${prefix}-findings.json`);
    const last = join(logs, `${prefix}-last.md`);
    const normalize = deps.tool("review-findings", [
      "normalize",
      lane,
      dest,
      events,
      "--last",
      last,
      "--run",
      a.dispatch,
    ]);
    passErr(res, normalize);
    if (normalize.code !== 0) {
      rmSync(findings, { force: true });
      normalizeFailed.push(lane);
      continue;
    }
    try {
      writeFileSync(findings, normalize.out);
    } catch {
      rmSync(findings, { force: true });
      normalizeFailed.push(lane);
    }
  }
  for (const lane of normalizeFailed) {
    recordStep(res, deps, "run-log", [
      a.dispatch,
      `review round ${a.round} ${lane}: normalize failed; reading the raw report by hand`,
    ]);
  }
  return res;
}

export interface FixArgs {
  dispatch: string;
  synthesis: string;
  message: string;
  findings: string[];
  paths: string[];
}

/** Whether an apply row for a commit landed in the action log. Anything unreadable
 * reads as not landed: the caller rolls back rather than risk an unrecorded fix. */
function applyLanded(dispatch: string, sha: string): boolean {
  let contents: string;
  try {
    contents = readFileSync(join(dispatch, "actions.jsonl"), "utf8");
  } catch {
    return false;
  }
  for (const line of contents.split("\n")) {
    if (line.trim() === "") continue;
    let row: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(line);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      row = parsed as Record<string, unknown>;
    } catch {
      continue;
    }
    if (row.action === "apply" && row.target === sha) return true;
  }
  return false;
}

/** fix: commit the named paths and write the fix's apply row in one step, so a fix the
 * coachman makes during a round never meets the round's integrity check unrecorded. When
 * the row cannot be recorded the commit is rolled back, unless the row landed and only
 * the ledger write failed, in which case the recorded commit is kept and the gap named. */
export function fixRound(a: FixArgs, deps: StepDeps): StepResult {
  const res: StepResult = { code: 0, out: [], err: [] };
  const parent = deps.git(["-C", a.synthesis, "rev-parse", "HEAD"]);
  if (parent.code !== 0) {
    passErr(res, parent);
    res.err.push(`review-round: no commit at ${a.synthesis}`);
    res.code = 1;
    return res;
  }
  const before = parent.out.trim();
  // Unstage what a failed add or commit staged, so no leftover rides into a
  // later plain commit with no apply row. True when the index is clean.
  const unstage = (): boolean => {
    const now = deps.git(["-C", a.synthesis, "rev-parse", "HEAD"]);
    if (now.code !== 0 || now.out.trim() !== before) return false;
    const un = deps.git(["-C", a.synthesis, "reset", "-q", "--mixed", before]);
    passErr(res, un);
    return un.code === 0;
  };
  const add = deps.git(["-C", a.synthesis, "add", "--", ...a.paths]);
  if (add.code !== 0) {
    passErr(res, add);
    res.err.push("review-round: cannot stage the fix");
    if (!unstage()) {
      res.err.push("review-round: the staged paths are left staged; unstage them by hand");
    }
    res.code = 1;
    return res;
  }
  const commit = deps.git(["-C", a.synthesis, "commit", "-m", a.message, "--", ...a.paths]);
  if (commit.code !== 0) {
    passOut(res, commit);
    passErr(res, commit);
    res.err.push("review-round: cannot commit the fix");
    if (!unstage()) {
      res.err.push("review-round: the staged paths are left staged; unstage them by hand");
    }
    res.code = 1;
    return res;
  }
  const head = deps.git(["-C", a.synthesis, "rev-parse", "HEAD"]);
  if (head.code !== 0 || head.out.trim() === "" || head.out.trim() === before) {
    passErr(res, head);
    res.err.push("review-round: the fix left no new commit");
    res.code = 1;
    return res;
  }
  const sha = head.out.trim();
  const row = deps.tool("log-action", [a.dispatch, "coachman", "apply", sha, a.findings.join(" ")]);
  passErr(res, row);
  if (row.code !== 0) {
    if (applyLanded(a.dispatch, sha)) {
      res.out.push(
        `review-round: fix ${sha} recorded but the ledger write failed; the commit is kept, escalate the ledger gap`,
      );
      res.code = 1;
      return res;
    }
    const now = deps.git(["-C", a.synthesis, "rev-parse", "HEAD"]);
    if (now.code === 0 && now.out.trim() === sha) {
      // Mixed, not soft: staged content would ride into the next plain commit
      // with no apply row, while unstaged content fails the dirt checks aloud.
      const back = deps.git(["-C", a.synthesis, "reset", "-q", "--mixed", before]);
      passErr(res, back);
      if (back.code === 0) {
        res.out.push(
          `review-round: fix ${sha} was not recorded; rolled back to ${before} and unstaged`,
        );
      } else {
        res.err.push(
          `review-round: fix ${sha} was not recorded and the rollback failed; record the apply by hand and escalate`,
        );
      }
    } else {
      res.err.push(
        `review-round: fix ${sha} was not recorded and HEAD moved meanwhile; record the apply by hand and escalate`,
      );
    }
    res.code = 1;
    return res;
  }
  res.out.push(`review-round: fix ${sha} recorded (${a.findings.join(" ")})`);
  return res;
}

export interface GateArgs {
  dispatch: string;
  round: string;
  synthesis: string;
}

/** gate: run the recorded checks on the fixed tree while the round is open, saving the
 * pass under logs/gate-<sha>.txt with its gate row, so the next round starts on it when
 * no fix follows. A dirty tree is refused: no result would belong to the commit. */
export function gateRound(a: GateArgs, deps: StepDeps): StepResult {
  const res: StepResult = { code: 0, out: [], err: [] };
  const snap = snapshotOf(a, deps, res);
  if (res.code !== 0) return res;
  const status = deps.git(["-C", a.synthesis, "status", "--porcelain", "--untracked-files=all"]);
  if (status.code !== 0) {
    passErr(res, status);
    res.err.push(`review-round: cannot read the synthesis worktree status at ${a.synthesis}`);
    res.code = 1;
    return res;
  }
  const dirt = uncommittedFiles(status.out);
  if (dirt.length > 0) {
    const listed =
      dirt.slice(0, 10).join(", ") + (dirt.length > 10 ? ` and ${dirt.length - 10} more` : "");
    res.err.push(
      `review-round: ${a.synthesis} has files git sees that its commit does not hold, so no result would belong to a commit: ${listed}`,
    );
    res.code = 1;
    return res;
  }
  const v = deps.tool("verify", ["run", a.synthesis, a.dispatch]);
  const verifyCode = v.code;
  const verifyOut = v.out;
  passErr(res, v);
  const passFile = join(a.dispatch, "logs", `gate-${snap}.txt`);
  // A failure keeps its hands off the kept text: only a pass may write it, so
  // a failing rerun never poses as the pass an older row points at.
  let wrotePass = true;
  if (verifyCode === 0 || verifyCode === 3) {
    try {
      writeFileSync(passFile, verifyOut);
    } catch (e) {
      res.err.push(
        `review-round: ${passFile} cannot be written (${e instanceof Error ? e.message : String(e)})`,
      );
      wrotePass = false;
    }
  }
  res.out.push(...lineList(verifyOut));
  recordStep(res, deps, "log-action", [
    a.dispatch,
    "coachman",
    "gate",
    snap,
    `review round ${a.round}, run verify exit ${verifyCode}, mid-round gate`,
  ]);
  if (!wrotePass || (verifyCode !== 0 && verifyCode !== 3)) {
    res.code = 1;
    return res;
  }
  res.out.push(`review-round: recorded gate on ${snap}, run verify exit ${verifyCode}`);
  return res;
}

// --- entry ------------------------------------------------------------------------------
if (import.meta.main) {
  const argv = process.argv.slice(2);

  const cmd = argv[0];
  if (
    cmd !== "start" &&
    cmd !== "wait" &&
    cmd !== "wait-next" &&
    cmd !== "teardown" &&
    cmd !== "cut" &&
    cmd !== "launch" &&
    cmd !== "harvest" &&
    cmd !== "gate" &&
    cmd !== "fix"
  )
    die(USAGE);
  if (cmd === "start" && argv.length < 3) die(USAGE);
  if ((cmd === "wait" || cmd === "wait-next" || cmd === "teardown") && argv.length < 4) die(USAGE);
  if ((cmd === "cut" || cmd === "launch") && argv.length !== 5) die(USAGE);
  if (cmd === "harvest" && argv.length < 4) die(USAGE);
  if (cmd === "gate" && argv.length !== 4) die(USAGE);
  if (cmd === "fix" && argv.length < 9) die(USAGE);
  const dRaw = argv[1] ?? "";
  const dR = run("bash", ["-c", `cd "$1" 2>/dev/null && pwd -P`, "_", dRaw]);
  const D = dR.code === 0 ? dR.out.trim() : die(`no such dispatch directory: ${dRaw}`);

  if (cmd === "fix") {
    const sRaw = argv[2] ?? "";
    const sR = run("bash", ["-c", `cd "$1" 2>/dev/null && pwd -P`, "_", sRaw]);
    const synthesis = sR.code === 0 ? sR.out.trim() : die(`no such synthesis worktree: ${sRaw}`);
    const rest = argv.slice(3);
    const sep = rest.indexOf("--");
    if (sep === -1) die(USAGE);
    const flags = rest.slice(0, sep);
    const paths = rest.slice(sep + 1);
    let message: string | null = null;
    let findings: string[] | null = null;
    for (let i = 0; i < flags.length; ) {
      const key = flags[i];
      const value = flags[i + 1];
      if ((key !== "--message" && key !== "--findings") || value === undefined) die(USAGE);
      if (key === "--message") {
        if (message !== null) die(USAGE);
        message = value;
      } else {
        if (findings !== null) die(USAGE);
        findings = value
          .split(",")
          .map((t) => t.trim())
          .filter((t) => t !== "");
      }
      i += 2;
    }
    if (
      message === null ||
      message === "" ||
      !findings ||
      findings.length === 0 ||
      paths.length === 0
    )
      die(USAGE);
    const deps: StepDeps = {
      tool: (name, args) => run(join(HERE, "run"), [name, ...args]),
      git: (args) => run("git", args),
    };
    const result = fixRound({ dispatch: D, synthesis, message, findings, paths }, deps);
    for (const line of result.out) console.log(line);
    for (const line of result.err) console.error(line);
    process.exit(result.code);
  }

  const roundArg = argv[2] ?? "";
  if (!/^[0-9]+$/u.test(roundArg) || roundArg.startsWith("0") || roundArg.length > 6) {
    die(`a round is a whole number from 1: ${roundArg}`);
  }
  const R = roundArg;
  const TICKET = basename(D);
  const LOGS = join(D, "logs");
  const STATE = join(D, "logs", `review-r${R}.json`);

  if (cmd === "start") {
    // Finish rows are wait-next's memory and carry no attempt: starting again
    // after any was reported would make the new attempt misreport the old
    // reviewers as collected. Refuse before touching anything, and resume.
    const collected = roundRecords(D, R).finished;
    if (collected.size > 0) {
      die(
        `round ${R} already reported ${collected.size} finisher${collected.size === 1 ? "" : "s"}; resume it with wait-next instead of starting it again`,
      );
    }
    mkdirSync(LOGS, { recursive: true });
    for (const f of readdirSync(LOGS)) {
      if (f.startsWith(`review-r${R}-`) && f.endsWith(".done")) {
        rmSync(join(LOGS, f), { force: true });
      }
    }
    const r = stateCmd("start", STATE, [
      join(D, "run.json"),
      String(DEFAULT_LIMIT),
      String(MAX_LIMIT),
    ]);
    if (r.err) process.stderr.write(r.err);
    if (r.code !== 0) die(`could not start round ${R}`);
    const [lim, src] = r.out.trim().split("\t");
    let recorded = "";
    if (argv.length > 3) {
      const pr = stateCmd("reviewers", STATE, argv.slice(3));
      if (pr.err) process.stderr.write(pr.err);
      const n = pr.out
        .trim()
        .split("\n")
        .filter((l) => l !== "").length;
      recorded = `, ${n} reviewers recorded`;
    }
    console.log(
      `review-round: round ${R} started, markers cleared, time limit ${lim}s (${src})${recorded}`,
    );
    process.exit(0);
  }

  let REPO = "";
  if (cmd !== "gate") {
    const repoRaw = argv[3] ?? "";
    const repoR = run("bash", ["-c", `cd "$1" 2>/dev/null && pwd -P`, "_", repoRaw]);
    REPO = repoR.code === 0 ? repoR.out.trim() : die(`no such repo: ${repoRaw}`);
    const gitCheck = run("git", ["-C", REPO, "rev-parse", "--git-dir"]);
    if (gitCheck.code !== 0) die(`not a git repository: ${repoRaw}`);
  }
  const reviewerArgs = argv.slice(4);
  const CALLER = run("bash", ["-c", "pwd -P"]).out.trim();
  process.chdir("/");

  if (cmd === "cut" || cmd === "launch" || cmd === "harvest" || cmd === "gate") {
    let synthesis = "";
    if (cmd === "cut" || cmd === "launch") {
      const sRaw = argv[4] ?? "";
      const sR = run("bash", ["-c", `cd "$1" 2>/dev/null && pwd -P`, "_", sRaw]);
      synthesis = sR.code === 0 ? sR.out.trim() : die(`no such synthesis worktree: ${sRaw}`);
    } else if (cmd === "gate") {
      const sRaw = argv[3] ?? "";
      const sR = run("bash", ["-c", `cd "$1" 2>/dev/null && pwd -P`, "_", sRaw]);
      synthesis = sR.code === 0 ? sR.out.trim() : die(`no such synthesis worktree: ${sRaw}`);
    }
    const deps: StepDeps = {
      tool: (name, args) => run(join(HERE, "run"), [name, ...args]),
      git: (args) => run("git", args),
    };
    const stepArgs = { dispatch: D, round: R, repo: REPO, synthesis };
    let result: StepResult;
    if (cmd === "cut") result = cutRound(stepArgs, deps);
    else if (cmd === "launch") result = launchRound(stepArgs, deps);
    else if (cmd === "gate") result = gateRound({ dispatch: D, round: R, synthesis }, deps);
    else {
      let only: Array<[string, string]> | undefined;
      if (reviewerArgs.length > 0) {
        const pr = stateCmd("pairs", "-", reviewerArgs);
        only = pr.out
          .trim()
          .split("\n")
          .filter((l) => l !== "")
          .map((l) => {
            const [lens, lane] = l.split("\t");
            return [lens ?? "", lane ?? ""] as [string, string];
          });
      }
      result = harvestRound({ dispatch: D, round: R, repo: REPO, only }, deps);
    }
    for (const line of result.out) console.log(line);
    for (const line of result.err) console.error(line);
    process.exit(result.code);
  }

  const record = (text: string, ...logArgs: string[]): void => {
    console.log(text);
    const rl = run(join(HERE, "run"), ["run-log", D, text]);
    if (rl.code !== 0) {
      console.log(`NOT RECORDED in run-log.md: ${text}`);
      (globalThis as Record<string, unknown>).UNRECORDED = 1;
    }
    const la = run(join(HERE, "run"), ["log-action", D, "coachman", ...logArgs]);
    if (la.code !== 0) {
      console.log(`NOT RECORDED in actions.jsonl: ${logArgs.join(" ")}`);
      (globalThis as Record<string, unknown>).UNRECORDED = 1;
    }
  };

  const readReviewers = (
    how: "reviewers" | "pairs",
    ...rest: string[]
  ): Array<[string, string]> => {
    let r: { code: number; out: string; err: string };
    if (how === "pairs" && rest.length > 0) {
      r = stateCmd("pairs", "-", rest);
    } else {
      r = stateCmd("reviewers", STATE, rest);
    }
    if (r.code !== 0) {
      if (r.err) process.stderr.write(r.err);
      process.exit(1);
    }
    return r.out
      .trim()
      .split("\n")
      .filter((l) => l !== "")
      .map((l) => {
        const [lens, lane] = l.split("\t");
        return [lens ?? "", lane ?? ""] as [string, string];
      });
  };
  /**
   * The bug lanes' forked-task transcripts, copied for the check to tie what
   * it finds to a lane, as the harvest does later. Best effort: a copy that
   * fails is reported by the harvest with its degrade, and the check goes on
   * with the streams alone.
   */
  const copyTaskTranscripts = (reviewers: Array<[string, string]>): void => {
    for (const [lens, lane] of reviewers) {
      if (lens !== "bug") continue;
      const events = join(LOGS, `review-r${R}-bug-${lane}.jsonl`);
      const copied = run(join(HERE, "run"), [
        "review-findings",
        "harvest",
        events,
        LOGS,
        "--prefix",
        `review-r${R}-bug-${lane}`,
      ]);
      if (copied.out) process.stdout.write(copied.out);
      if (copied.err) process.stderr.write(copied.err);
    }
  };

  /**
   * The round's check for changes by its reviewers: null when the round took
   * no starting state or a past collection finished it, else the step's exit.
   * The check runs once, at the first whole-round collection; fixes the fix
   * step saved read as explained through their `apply` rows.
   * A collection cut short after the point but before the restore finishes is
   * completed, never skipped: the point means the check voided what it found,
   * so only the restore is unfinished. A finished collection, marked when its
   * step exits 0, is never repeated.
   */
  const runRoundCheck = (reviewers: Array<[string, string]>): number | null => {
    if (!existsSync(join(D, "reach", `before-r${R}.json`))) return null;
    const marker = join(D, "reach", `r${R}.collected`);
    const finish = (code: number): number => {
      if (code === 0) {
        try {
          writeFileSync(marker, "");
        } catch (e) {
          console.log(
            `review-round: round ${R} is collected but its marker is not written (${e instanceof Error ? e.message : String(e)}); the next collection restores again`,
          );
        }
      }
      return code;
    };
    if (roundPointRecorded(D, R)) {
      if (existsSync(marker)) {
        console.log(`review-round: round ${R} already has its reach check recorded`);
        return null;
      }
      console.log(
        `review-round: round ${R} already has its reach check recorded; completing its restore`,
      );
      const restore = run(join(HERE, "run"), ["reach", "restore", D, `r${R}`]);
      if (restore.out) process.stdout.write(restore.out);
      if (restore.err) process.stderr.write(restore.err);
      return finish(restore.code);
    }
    copyTaskTranscripts(reviewers);
    const child = run(join(HERE, "run"), ["reach", "round", D, `r${R}`]);
    if (child.out) process.stdout.write(child.out);
    if (child.err) process.stderr.write(child.err);
    return finish(child.code);
  };

  const collectRoundCheck = (reviewers: Array<[string, string]>): void => {
    // No starting state, no check to run: return quietly, as the check itself
    // would. The roster comparison below only matters when a check is at stake.
    if (!existsSync(join(D, "reach", `before-r${R}.json`))) return;
    // The check needs the whole round's finished streams: a subset collection
    // records nothing, so a partial picture is never kept as the round's check.
    // The whole-round collection that follows runs it instead.
    const recorded = stateLoad(STATE).reviewers ?? [];
    const want = new Set(recorded.map(([lens, lane]) => `${lens}\0${lane}`));
    const have = reviewers.map(([lens, lane]) => `${lens}\0${lane}`);
    if (have.length !== want.size || !have.every((k) => want.has(k))) {
      console.log(
        "review-round: the round's reach check waits for the whole round; this collection covers only part of it",
      );
      return;
    }
    const code = runRoundCheck(reviewers);
    if (code !== null && code !== 0) {
      console.log(`review-round: round ${R} reach check exited ${code}; stop the leg`);
      process.exit(4);
    }
  };

  // The deadline close wait and wait-next share: whoever had not finished is recorded and
  // stopped. A round started again meanwhile stands down and records nothing. The walled
  // reviewers among the finished are recorded with it; wait-next passes none, having
  // recorded each wall as its reviewer finished. A reviewer still running stops the leg
  // with no check, and a whole-round close otherwise collects the round's reach check.
  const closeTimedOut = (
    attempt: string | undefined,
    reviewers: Array<[string, string]>,
    missing: number[],
    lim: string | undefined,
    walls: Array<[string, string, string]>,
  ): never => {
    const nowCheck = stateCmd("check", STATE, []);
    if (nowCheck.code !== 0) process.exit(1);
    const nowAttempt = nowCheck.out.trim().split("\t")[0];
    if (nowAttempt !== attempt) {
      die(
        `round ${R} was started again while this wait ran; it stands down, and records and stops nothing`,
      );
    }

    const n = reviewers.length;
    const reported = n - missing.length;
    record(
      `round ${R}: WAIT-TIMEOUT after ${lim}s; ${reported} of ${n} reviewers reported`,
      "note",
      `r${R}`,
      `WAIT-TIMEOUT after ${lim}s: ${reported} of ${n} reviewers reported`,
    );
    for (const i of missing) {
      const [lens, lane] = reviewers[i]!;
      console.log(`TIMEOUT ${lens} ${lane}: DEGRADED, timeout`);
      record(`${lane} ${lens}: DEGRADED, timeout`, "degrade", lane, `${lens} r${R}: timeout`);
    }
    for (const [lane, lens, message] of walls) {
      console.log(`WALL ${lens} ${lane}: DEGRADED, provider wall: "${message}"`);
      record(
        `${lane} ${lens}: DEGRADED, provider wall: "${message}"`,
        "degrade",
        lane,
        `${lens} r${R}: provider wall: "${message}"`,
      );
    }
    const stopPids: Array<number | null> = [];
    for (const i of missing) {
      const s = scratch(REPO, TICKET, reviewers[i]?.[0], reviewers[i]?.[1]);
      if (existsSync(s)) {
        const stopOut = join(LOGS, `.stop-r${R}-${i}`);
        const child = run(join(HERE, "run"), ["host", "stop", s]);
        writeFileSync(stopOut, child.out + child.err);
        stopPids.push(child.code);
      } else {
        stopPids.push(null);
      }
    }
    let stillRunning = false;
    for (let j = 0; j < missing.length; j++) {
      const i = missing[j]!;
      const [lens, lane] = reviewers[i]!;
      const s = scratch(REPO, TICKET, lens, lane);
      const stopOut = join(LOGS, `.stop-r${R}-${i}`);
      let out = "";
      try {
        out = readFileSync(stopOut, "utf8");
      } catch {
        out = "";
      }
      rmSync(stopOut, { force: true });
      const stopRc = stopPids[j];
      if (stopRc === null) {
        console.log(`  no scratch at ${s}`);
      } else if (stopRc === 0) {
        console.log(`  ${out.trimEnd()}`);
        if (!out.startsWith("no launch is running")) {
          record(
            `${lane} ${lens}: at the time limit, ${out.trimEnd()}`,
            "note",
            s,
            `r${R} ${lens} ${lane}: at the time limit, ${out.trimEnd()}`,
          );
        }
      } else {
        console.log(`  STILL RUNNING in ${s}: ${out.trimEnd()}`);
        record(
          `${lane} ${lens}: still running after the time limit, ${out.trimEnd()}`,
          "note",
          s,
          `r${R} ${lens} ${lane}: still running after the time limit, ${out.trimEnd()}`,
        );
        stillRunning = true;
      }
    }
    if (stillRunning) {
      // A reviewer that is still running can still change what the check
      // restores, so the check waits for the ruling like every other record.
      console.log(
        `review-round: round ${R} has a reviewer still running; the round's check is not run: stop the leg`,
      );
      process.exit(4);
    }
    collectRoundCheck(reviewers);
    if ((globalThis as Record<string, unknown>).UNRECORDED) process.exit(4);
    process.exit(3);
  };

  if (cmd === "wait") {
    const check = stateCmd("check", STATE, []);
    if (check.code !== 0) process.exit(1);
    const [attempt, leftStr, lim, src] = check.out.trim().split("\t");
    // Pairs stay call-local: only start records the round's reviewers, so a
    // subset wait must not narrow what later bare calls see.
    const reviewers = readReviewers("pairs", ...reviewerArgs);
    // A pairs wait with no recorded roster cannot tell a whole round from a
    // subset, and with a starting state collecting it could record a partial
    // check as the round's. Refuse before anything is collected, while
    // starting again is still open.
    if (
      reviewerArgs.length > 0 &&
      (stateLoad(STATE).reviewers ?? []).length === 0 &&
      existsSync(join(D, "reach", `before-r${R}.json`))
    ) {
      die(`round ${R} has no reviewers recorded; start it again with its <lens>:<lane> pairs`);
    }
    const n = reviewers.length;
    console.log(
      `review-round: round ${R}, ${n} reviewers, ${leftStr}s left of its ${lim}s limit (${src})`,
    );
    const wf = run(join(HERE, "run"), [
      "wait-for-markers",
      LOGS,
      `review-r${R}-*.done`,
      String(n),
      leftStr ?? "0",
    ]);
    const rc = wf.code;
    if (rc !== 0 && rc !== 3) die(`the wait ended with exit ${rc}, so nothing is recorded`);
    const missing: number[] = [];
    let expected = "";
    for (let i = 0; i < n; i++) {
      const f = `review-r${R}-${reviewers[i]?.[0]}-${reviewers[i]?.[1]}.done`;
      expected += ` ${f} `;
      if (!existsSync(join(LOGS, f))) missing.push(i);
    }
    // A reviewer whose launch ended on a provider wall is recorded as DEGRADED with the
    // provider's message, as a timeout is: the round closes without waiting for it (C11).
    // A walled reviewer takes part in the next round as any DEGRADED lane does (C12).
    (globalThis as Record<string, unknown>).UNRECORDED = 0;
    const wallLines: Array<[string, string, string]> = [];
    for (let i = 0; i < n; i++) {
      if (missing.includes(i)) continue;
      const [lens, lane] = reviewers[i]!;
      const w = wallOrLostWall(D, lane, lens, R);
      if (w !== null) wallLines.push([lane, lens, w.message]);
    }
    if (missing.length === 0) {
      if (rc === 3) {
        console.log(
          "review-round: every marker was in by the time the reviewers were named; none timed out",
        );
      }
      for (const [lane, lens, message] of wallLines) {
        console.log(`WALL ${lens} ${lane}: DEGRADED, provider wall: "${message}"`);
        record(
          `${lane} ${lens}: DEGRADED, provider wall: "${message}"`,
          "degrade",
          lane,
          `${lens} r${R}: provider wall: "${message}"`,
        );
      }
      collectRoundCheck(reviewers);
      if ((globalThis as Record<string, unknown>).UNRECORDED) process.exit(4);
      process.exit(0);
    }
    if (rc === 0) {
      let strays = "";
      for (const f of readdirSync(LOGS)) {
        if (f.startsWith(`review-r${R}-`) && f.endsWith(".done") && !expected.includes(` ${f} `)) {
          strays += ` ${f}`;
        }
      }
      die(`the count was made up by markers no reviewer of round ${R} lands:${strays}`);
    }
    closeTimedOut(attempt, reviewers, missing, lim, wallLines);
  }

  if (cmd === "wait-next") {
    const check = stateCmd("check", STATE, []);
    if (check.code !== 0) process.exit(1);
    const [attempt, leftStr, lim, src] = check.out.trim().split("\t");
    // Pairs stay call-local: only start records the round's reviewers, so a
    // subset wait must not narrow what later bare calls see.
    const reviewers = readReviewers("pairs", ...reviewerArgs);
    // A pairs wait with no recorded roster cannot tell a whole round from a
    // subset, and with a starting state collecting it could record a partial
    // check as the round's. Refuse before anything is collected, while
    // starting again is still open.
    if (
      reviewerArgs.length > 0 &&
      (stateLoad(STATE).reviewers ?? []).length === 0 &&
      existsSync(join(D, "reach", `before-r${R}.json`))
    ) {
      die(`round ${R} has no reviewers recorded; start it again with its <lens>:<lane> pairs`);
    }
    const n = reviewers.length;
    console.log(
      `review-round: round ${R}, ${n} reviewers, ${leftStr}s left of its ${lim}s limit (${src})`,
    );
    (globalThis as Record<string, unknown>).UNRECORDED = 0;
    const records = roundRecords(D, R);
    const markerIn = (lens: string, lane: string): boolean =>
      existsSync(join(LOGS, `review-r${R}-${lens}-${lane}.done`));
    // A finisher without a harvest row is said again: the coachman was
    // interrupted before collecting its report, and a resume must replay it
    // rather than drop it. A degraded reviewer stays out either way.
    const fresh = (): Array<[string, string]> =>
      reviewers.filter(([lens, lane]) => {
        const key = `${lens}\0${lane}`;
        if (records.harvested.has(key) || records.degraded.has(key)) return false;
        if (!records.finished.has(key)) return markerIn(lens, lane);
        return true;
      });
    let newly = fresh();
    // Every reviewer of this call, not the row count: a subset call must not
    // read another reviewer's finish row as its own reviewers reported.
    const allReported = reviewers.every(([lens, lane]) => records.finished.has(`${lens}\0${lane}`));
    if (newly.length === 0 && allReported) {
      console.log(`review-round: round ${R}, every reviewer reported`);
      collectRoundCheck(reviewers);
      process.exit(0);
    }
    if (newly.length === 0) {
      const left = parseInt(leftStr ?? "0", 10);
      countdown(() => (fresh().length > 0 ? 1 : 0), 1, Number.isNaN(left) ? 0 : left, sleepMs, 1);
      newly = fresh();
    }
    if (newly.length > 0) {
      const nowCheck = stateCmd("check", STATE, []);
      if (nowCheck.code !== 0) process.exit(1);
      const nowAttempt = nowCheck.out.trim().split("\t")[0];
      if (nowAttempt !== attempt) {
        die(
          `round ${R} was started again while this wait ran; it stands down, and records and stops nothing`,
        );
      }
      for (const [lens, lane] of newly) {
        const key = `${lens}\0${lane}`;
        console.log(`FINISHED ${lens} ${lane}`);
        // A replayed finisher keeps its first row: the row times the finish.
        if (!records.finished.has(key)) {
          record(
            `${lane} ${lens}: finished round ${R}`,
            "review-finish",
            lane,
            `${lens} round ${R}`,
          );
        }
        // The wall check runs whenever no degrade row exists yet, so an
        // interruption between the two rows cannot lose the wall.
        if (!records.degraded.has(key)) {
          const w = wallOrLostWall(D, lane, lens, R);
          if (w !== null) {
            console.log(`WALL ${lens} ${lane}: DEGRADED, provider wall: "${w.message}"`);
            record(
              `${lane} ${lens}: DEGRADED, provider wall: "${w.message}"`,
              "degrade",
              lane,
              `${lens} r${R}: provider wall: "${w.message}"`,
            );
          }
        }
      }
      if ((globalThis as Record<string, unknown>).UNRECORDED) process.exit(4);
      process.exit(0);
    }
    const missing: number[] = [];
    for (let i = 0; i < n; i++) {
      if (!markerIn(reviewers[i]?.[0] ?? "", reviewers[i]?.[1] ?? "")) missing.push(i);
    }
    closeTimedOut(attempt, reviewers, missing, lim, []);
  }

  // teardown
  const reviewers = readReviewers("pairs", ...reviewerArgs);
  // A teardown that names its reviewers cleans up named scratches, as the cut does for one an
  // interrupted round left behind. The round's own teardown names none and follows its reach check.
  const waitsForReach =
    reviewerArgs.length === 0 && existsSync(join(D, "reach", `before-r${R}.json`));
  let points: string[] = [];
  if (waitsForReach) {
    try {
      points = reachActions(D)
        .filter(({ event }) => event.kind === "point")
        .map(({ event }) => String(event.point));
    } catch (e) {
      die(`cannot read the reach record to teardown round ${R}: ${String(e)}`);
    }
  }
  if (reachCheckMissing(waitsForReach, points, R)) {
    record(
      `round ${R} took its reach snapshot and no reach check r${R} is recorded: nothing was removed. Collect the round with review-round wait, which runs its check, then teardown again`,
      "note",
      D,
      `r${R}: teardown waits for the reach check`,
    );
    process.exit(1);
  }
  let removed = 0;
  let kept = 0;
  let gone = 0;
  for (const [lens, lane] of reviewers) {
    const s = scratch(REPO, TICKET, lens, lane);
    if (!existsSync(s)) {
      console.log(`no scratch at ${s}`);
      gone += 1;
      continue;
    }
    let why = "";
    let finished = false;
    if (existsSync(join(LOGS, `review-r${R}-${lens}-${lane}.done`))) finished = true;
    const sPhys = run("bash", ["-c", `cd "$1" 2>/dev/null && pwd -P`, "_", s]).out.trim();
    if (CALLER.startsWith(`${sPhys}/`) || CALLER === sPhys) {
      why = "the shell that ran this works in it; run teardown from outside it";
    }
    if (!why) {
      const stopR = run(join(HERE, "run"), ["host", "stop", s]);
      if (stopR.code !== 0) {
        why = `it could not be stopped: ${stopR.out + stopR.err}`;
      } else {
        let out = stopR.out.trimEnd();
        if (!out.startsWith("no launch is running")) {
          out = finished
            ? `${out}, left behind by a reviewer that had finished`
            : `${out}; its reviewer had not finished`;
          console.log(`${s}: ${out}`);
          record(`${lane} ${lens}: at teardown, ${out}`, "note", s, `r${R}: at teardown, ${out}`);
        }
        const closeR = run(join(HERE, "run"), ["host", "close", s]);
        if (closeR.code !== 0) {
          why = `its space was not closed: ${closeR.out + closeR.err}`;
        } else {
          const un = unswitch(s, TICKET);
          if (un) {
            console.log(`${s}: ${un}`);
            record(`${basename(s)}: ${un}`, "note", s, `r${R}: ${un}`);
          }
          const rmR = run(join(HERE, "run"), ["cut-scratch", "--remove", REPO, s]);
          if (rmR.code !== 0) {
            why = `it was not removed: ${rmR.out + rmR.err}`;
          }
        }
      }
    }
    if (!why) {
      console.log(`removed ${s}`);
      removed += 1;
      const la = run(join(HERE, "run"), [
        "log-action",
        D,
        "coachman",
        "teardown",
        s,
        `review scratch, round ${R}`,
      ]);
      if (la.code !== 0) {
        console.log(`NOT RECORDED in actions.jsonl: teardown ${s}`);
      }
    } else {
      why = why.replace(/\n/gu, " ");
      console.log(`LEFT IN PLACE ${s}: ${why}`);
      kept += 1;
      record(
        `${basename(s)}: left in place at teardown, ${why}`,
        "note",
        s,
        `r${R}: left in place at teardown, ${why}`,
      );
    }
  }
  const summary = `round ${R}: removed ${removed} of ${reviewers.length} scratches${
    gone === 0 ? "" : `, ${gone} already gone`
  }${kept === 0 ? "" : `, ${kept} left in place`}`;
  const rl = run(join(HERE, "run"), ["run-log", D, summary]);
  if (rl.code !== 0) console.log(`NOT RECORDED in run-log.md: round ${R} teardown`);
  process.exit(kept === 0 ? 0 : 1);
}
