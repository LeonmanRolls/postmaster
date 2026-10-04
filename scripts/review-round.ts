// A review round's bookkeeping: its time limit, collecting it, recording and stopping the
// reviewers that do not finish in time, and tearing its scratches down with nothing of the
// round still running in them. The round itself is three calls: cut prepares the snapshot
// and the scratches, launch runs the reviewers and waits for them, harvest normalizes the
// bug reports.
//
//   run review-round start    <dispatch> <round>
//   run review-round cut      <dispatch> <round> <repo> <synthesis-wt>
//   run review-round launch   <dispatch> <round> <repo> <synthesis-wt>
//   run review-round harvest  <dispatch> <round> <repo>
//   run review-round wait     <dispatch> <round> <repo> [<lens>:<lane>...]
//   run review-round teardown <dispatch> <round> <repo> [<lens>:<lane>...]
//
//   exit 0  wait: every marker is in · start and teardown: done · cut and harvest: done ·
//           launch: the wait's own exit when every reviewer reported
//   exit 3  wait: the deadline passed; each reviewer with no marker is recorded and stopped;
//           launch: the wait's exit 3, as wait itself records it
//   exit 4  wait: the deadline passed, but a record could not be written
//   exit 1  usage; the round was not started, or the machine restarted or the round was started
//           again since the wait began; a marker no reviewer of the round lands; teardown: a
//           scratch left in place; cut: run verify exited other than 0 or 3, the run's legs or
//           a lens's lanes did not resolve, or a left-behind scratch did not tear down;
//           launch: the same resolution failures, a prompt that could not be written, a scratch
//           that was not ready, or the round did not start
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
import { PY_S_CLASS } from "./lib/text.ts";

const HERE = scriptsDir(import.meta);
const DEFAULT_LIMIT = 2400;
const MAX_LIMIT = 86400;
const USAGE =
  "usage: run review-round start <dispatch> <round> | cut|launch <dispatch> <round> <repo> <synthesis-wt>" +
  " | harvest <dispatch> <round> <repo> | wait|teardown <dispatch> <round> <repo> [<lens>:<lane>...]";

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

function bootId(): string {
  try {
    return readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
  } catch {
    // BASE reads sysctl's stdout unchecked: a sysctl that fails still yields
    // whatever it printed, and a missing one yields nothing. run() never throws.
    return run("sysctl", ["-n", "kern.boottime"]).out.trim();
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
    if (st.boot && b && st.boot !== b) {
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

function snapshotOf(a: StepArgs, deps: StepDeps, res: StepResult): string {
  const g = deps.git(["-C", a.synthesis, "rev-parse", "HEAD"]);
  if (g.code !== 0) {
    passErr(res, g);
    res.err.push(`review-round: no snapshot at ${a.synthesis}`);
    res.code = 1;
    return "";
  }
  return g.out.trim();
}

function scratchPath(repo: string, ticket: string, lens: string, lane: string): string {
  return join(repo, ".worktrees", `${ticket}-rev-${lens}-${lane}`);
}

/** cut: verify the snapshot, log the gate, prune, resolve the lenses, cut every scratch. */
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
  let verifyCode = 1;
  let verifyOut = "";
  try {
    // The shell's redirection opens the file before the command runs.
    writeFileSync(checks, "");
  } catch (e) {
    res.err.push(
      `review-round: ${checks} cannot be written (${e instanceof Error ? e.message : String(e)})`,
    );
  }
  if (res.err.length === 0) {
    const v = deps.tool("verify", ["run", a.synthesis, a.dispatch]);
    verifyCode = v.code;
    verifyOut = v.out;
    passErr(res, v);
    try {
      writeFileSync(checks, verifyOut);
    } catch (e) {
      res.err.push(
        `review-round: ${checks} cannot be written (${e instanceof Error ? e.message : String(e)})`,
      );
    }
    res.out.push(...lineList(verifyOut));
  }
  recordStep(res, deps, "log-action", [
    a.dispatch,
    "coachman",
    "gate",
    snap,
    `review round ${a.round}, run verify exit ${verifyCode}`,
  ]);
  if (verifyCode !== 0 && verifyCode !== 3) {
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
      const cut = deps.tool("cut-scratch", [
        a.repo,
        a.synthesis,
        dest,
        snap,
        ...(lens === "security" ? ["--clone", base] : []),
      ]);
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

/** launch: prompt files, ready scratches, the round's start, every reviewer, then the wait. */
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
  const ticket = basename(a.dispatch);
  const lensPrompt = (lens: string): string =>
    join(a.dispatch, `review-r${a.round}-${lens}-prompt.txt`);
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
        const skill = deps.tool("launch", ["skill", lane, "security-review", "--run", a.dispatch]);
        const lanePrompt = join(a.dispatch, `review-r${a.round}-security-${lane}-prompt.txt`);
        if (skill.code === 0) {
          try {
            writeFileSync(lanePrompt, skill.out);
          } catch (e) {
            res.err.push(
              `review-round: ${lanePrompt} cannot be written (${e instanceof Error ? e.message : String(e)})`,
            );
            res.code = 1;
            return res;
          }
        } else if (skill.code === 3) {
          try {
            writeFileSync(lanePrompt, readFileSync(lensPrompt(lens)));
          } catch (e) {
            res.err.push(
              `review-round: ${lanePrompt} cannot be written (${e instanceof Error ? e.message : String(e)})`,
            );
            res.code = 1;
            return res;
          }
        } else {
          passErr(res, skill);
          res.out.push(`NO SECURITY PROMPT FOR ${lane}; nothing launched`);
          res.code = 1;
          return res;
        }
      }
    }
  }
  for (const [lens, lanes] of lenses) {
    for (const lane of lanes) {
      const dest = scratchPath(a.repo, ticket, lens, lane);
      const check = deps.tool("cut-scratch", [
        "--check",
        dest,
        snap,
        ...(lens === "security" ? ["--clone", base] : []),
      ]);
      if (check.code !== 0) {
        passOut(res, check);
        passErr(res, check);
        res.out.push(`SCRATCH NOT READY: ${ticket}-rev-${lens}-${lane}; nothing launched`);
        res.code = 1;
        return res;
      }
    }
  }
  const start = deps.tool("review-round", ["start", a.dispatch, a.round]);
  passOut(res, start);
  passErr(res, start);
  if (start.code !== 0) {
    res.code = 1;
    return res;
  }
  const entry = join(HERE, "run");
  const pairs: string[] = [];
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
      pairs.push(`${lens}:${lane}`);
    }
  }
  const wait = deps.tool("review-round", ["wait", a.dispatch, a.round, a.repo, ...pairs]);
  passOut(res, wait);
  passErr(res, wait);
  res.code = wait.code;
  return res;
}

/** harvest: each bug lane's report, degrading on a harvest that fails and reading a report the normalizer cannot. */
export function harvestRound(
  a: { dispatch: string; round: string; repo: string },
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
  const ticket = basename(a.dispatch);
  const normalizeFailed: string[] = [];
  for (const lane of lanes) {
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

// --- entry ------------------------------------------------------------------------------
if (import.meta.main) {
  const argv = process.argv.slice(2);

  const cmd = argv[0];
  if (
    cmd !== "start" &&
    cmd !== "wait" &&
    cmd !== "teardown" &&
    cmd !== "cut" &&
    cmd !== "launch" &&
    cmd !== "harvest"
  )
    die(USAGE);
  if (cmd === "start" && argv.length !== 3) die(USAGE);
  if ((cmd === "wait" || cmd === "teardown") && argv.length < 4) die(USAGE);
  if ((cmd === "cut" || cmd === "launch") && argv.length !== 5) die(USAGE);
  if (cmd === "harvest" && argv.length !== 4) die(USAGE);
  const dRaw = argv[1] ?? "";
  const dR = run("bash", ["-c", `cd "$1" 2>/dev/null && pwd -P`, "_", dRaw]);
  const D = dR.code === 0 ? dR.out.trim() : die(`no such dispatch directory: ${dRaw}`);
  const roundArg = argv[2] ?? "";
  if (!/^[0-9]+$/u.test(roundArg) || roundArg.startsWith("0") || roundArg.length > 6) {
    die(`a round is a whole number from 1: ${roundArg}`);
  }
  const R = roundArg;
  const TICKET = basename(D);
  const LOGS = join(D, "logs");
  const STATE = join(D, "logs", `review-r${R}.json`);

  if (cmd === "start") {
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
    console.log(`review-round: round ${R} started, markers cleared, time limit ${lim}s (${src})`);
    process.exit(0);
  }

  const repoRaw = argv[3] ?? "";
  const repoR = run("bash", ["-c", `cd "$1" 2>/dev/null && pwd -P`, "_", repoRaw]);
  const REPO = repoR.code === 0 ? repoR.out.trim() : die(`no such repo: ${repoRaw}`);
  const gitCheck = run("git", ["-C", REPO, "rev-parse", "--git-dir"]);
  if (gitCheck.code !== 0) die(`not a git repository: ${repoRaw}`);
  const reviewerArgs = argv.slice(4);
  const CALLER = run("bash", ["-c", "pwd -P"]).out.trim();
  process.chdir("/");

  if (cmd === "cut" || cmd === "launch" || cmd === "harvest") {
    let synthesis = "";
    if (cmd !== "harvest") {
      const sRaw = argv[4] ?? "";
      const sR = run("bash", ["-c", `cd "$1" 2>/dev/null && pwd -P`, "_", sRaw]);
      synthesis = sR.code === 0 ? sR.out.trim() : die(`no such synthesis worktree: ${sRaw}`);
    }
    const deps: StepDeps = {
      tool: (name, args) => run(join(HERE, "run"), [name, ...args]),
      git: (args) => run("git", args),
    };
    const stepArgs = { dispatch: D, round: R, repo: REPO, synthesis };
    const result =
      cmd === "cut"
        ? cutRound(stepArgs, deps)
        : cmd === "launch"
          ? launchRound(stepArgs, deps)
          : harvestRound({ dispatch: D, round: R, repo: REPO }, deps);
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

  if (cmd === "wait") {
    const check = stateCmd("check", STATE, []);
    if (check.code !== 0) process.exit(1);
    const [attempt, leftStr, lim, src] = check.out.trim().split("\t");
    const reviewers = readReviewers("reviewers", ...reviewerArgs);
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
    if (missing.length === 0) {
      if (rc === 3) {
        console.log(
          "review-round: every marker was in by the time the reviewers were named; none timed out",
        );
      }
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
    const nowCheck = stateCmd("check", STATE, []);
    if (nowCheck.code !== 0) process.exit(1);
    const nowAttempt = nowCheck.out.trim().split("\t")[0];
    if (nowAttempt !== attempt) {
      die(
        `round ${R} was started again while this wait ran; it stands down, and records and stops nothing`,
      );
    }

    (globalThis as Record<string, unknown>).UNRECORDED = 0;
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
      }
    }
    if ((globalThis as Record<string, unknown>).UNRECORDED) process.exit(4);
    process.exit(3);
  }

  // teardown
  const reviewers = readReviewers("pairs", ...reviewerArgs);
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
