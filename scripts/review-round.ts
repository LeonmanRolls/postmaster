// A review round's bookkeeping: its time limit, collecting it, recording and stopping the
// reviewers that do not finish in time, and tearing its scratches down with nothing of the
// round still running in them.
//
//   run review-round start    <dispatch> <round>
//   run review-round wait     <dispatch> <round> <repo> [<lens>:<lane>...]
//   run review-round teardown <dispatch> <round> <repo> [<lens>:<lane>...]
//
//   exit 0  wait: every marker is in · start and teardown: done
//   exit 3  wait: the deadline passed; each reviewer with no marker is recorded and stopped
//   exit 4  wait: the deadline passed, but a record could not be written
//   exit 1  usage; the round was not started, or the machine restarted or the round was started
//           again since the wait began; a marker no reviewer of the round lands; teardown: a
//           scratch left in place
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { scriptsDir } from "./lib/paths.ts";
import { mkstempSync, run } from "./lib/proc.ts";
import { PY_S_CLASS } from "./lib/text.ts";

const HERE = scriptsDir(import.meta);
const DEFAULT_LIMIT = 2400;
const MAX_LIMIT = 86400;
const USAGE =
  "usage: run review-round cut|launch <dispatch> <round> | start <dispatch> <round> | wait|teardown <dispatch> <round> <repo> [<lens>:<lane>...]";

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

type ReviewResult = Readonly<{ code: number; out: string; err: string }>;
type ReviewRunner = (program: string, args: readonly string[]) => ReviewResult;

const TOOL_RUN = join(HERE, "run");
const runScript: ReviewRunner = (program, args) => run(program, [...args]);

interface ReviewContext {
  dispatch: string;
  repo: string;
  synthesis: string;
  base: string;
  ticket: string;
  lenses: string[];
}

function field(text: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`^${escaped}:[\\t ]*(.+)$`, "mu").exec(text)?.[1]?.trim() ?? "";
}

function reviewContext(dispatch: string): ReviewContext {
  const brief = readFileSync(join(dispatch, "brief.md"), "utf8");
  const record = JSON.parse(readFileSync(join(dispatch, "run.json"), "utf8")) as Record<
    string,
    unknown
  >;
  const beforeTicket = brief.split(/^## /mu, 1)[0] ?? "";
  const turnpikes = field(beforeTicket, "turnpikes");
  const lenses = turnpikes === "none" ? [] : turnpikes.split(",").map((lens) => lens.trim());
  const context = {
    dispatch: resolve(dispatch),
    repo: field(brief, "repo"),
    synthesis: field(brief, "synthesis worktree"),
    base: typeof record.base === "string" ? record.base : "",
    ticket: basename(dispatch),
    lenses,
  };
  if (!context.repo || !context.synthesis || !context.base)
    throw new Error(`review-round: ${dispatch} is missing repo, synthesis worktree or base`);
  if (lenses.some((lens) => !["style", "bug", "security"].includes(lens)))
    throw new Error(`review-round: ${dispatch} has an unknown review turnpike`);
  return context;
}

function laneNames(
  dispatch: string,
  lens: string,
  runner: ReviewRunner,
  failed?: (result: ReviewResult) => void,
): string[] | null {
  const lanes = runner(TOOL_RUN, ["reviewers", "lanes", join(dispatch, "brief.md"), lens]);
  if (lanes.code !== 0) {
    failed?.(lanes);
    return null;
  }
  return lanes.out
    .split(/\r?\n/u)
    .map((lane) => lane.trim())
    .filter((lane) => lane !== "");
}

export function cutReviewRound(
  dispatch: string,
  round: string,
  runner: ReviewRunner = runScript,
): ReviewResult {
  const context = reviewContext(dispatch);
  const output: string[] = [];
  const errors: string[] = [];
  const head = runner("git", ["-C", context.synthesis, "rev-parse", "HEAD"]);
  if (head.code !== 0) return head;
  const snapshot = head.out.trim();
  const checkPath = join(context.dispatch, "logs", `review-r${round}-checks.txt`);
  const verified = runner(TOOL_RUN, ["verify", "run", context.synthesis, context.dispatch]);
  writeFileSync(checkPath, verified.out, "utf8");
  output.push(verified.out);
  errors.push(verified.err);
  const gate = runner(TOOL_RUN, [
    "log-action",
    context.dispatch,
    "coachman",
    "gate",
    snapshot,
    `review round ${round}, run verify exit ${verified.code}`,
  ]);
  output.push(gate.out);
  errors.push(gate.err);
  if (gate.code !== 0) return { code: gate.code, out: output.join(""), err: errors.join("") };
  if (verified.code !== 0 && verified.code !== 3)
    return { code: 1, out: output.join(""), err: errors.join("") };
  if (verified.code === 3) {
    let inNotRun = false;
    for (const line of verified.out.split(/\r?\n/u)) {
      if (/: not run, /u.test(line)) inNotRun = true;
      else if (!inNotRun || !/^  /u.test(line)) inNotRun = false;
      if (inNotRun) {
        const logged = runner(TOOL_RUN, [
          "run-log",
          context.dispatch,
          `review round ${round} gate not run: ${line}`,
        ]);
        output.push(logged.out);
        errors.push(logged.err);
        if (logged.code !== 0)
          return { code: logged.code, out: output.join(""), err: errors.join("") };
      }
    }
  }
  const pruned = runner("git", ["-C", context.repo, "worktree", "prune"]);
  output.push(pruned.out);
  errors.push(pruned.err);
  for (const lens of context.lenses) {
    const lanes = laneNames(context.dispatch, lens, runner, (result) => errors.push(result.err));
    if (lanes === null) return { code: 1, out: output.join(""), err: errors.join("") };
    for (const lane of lanes) {
      const dest = scratch(context.repo, context.ticket, lens, lane);
      if (existsSync(dest)) {
        const changed = runner("git", ["-C", dest, "diff", "--name-only", snapshot]);
        for (const file of changed.out.split(/\r?\n/u).filter((line) => line !== ""))
          output.push(`LEFT BEHIND AND MODIFIED, ${dest}: ${file}\n`);
        errors.push(changed.err);
        const removed = runner(TOOL_RUN, [
          "review-round",
          "teardown",
          context.dispatch,
          round,
          context.repo,
          `${lens}:${lane}`,
        ]);
        output.push(removed.out);
        errors.push(removed.err);
        if (removed.code !== 0) return { code: 1, out: output.join(""), err: errors.join("") };
      }
      const args = ["cut-scratch", context.repo, context.synthesis, dest, snapshot];
      if (lens === "security") args.push("--clone", context.base);
      const cut = runner(TOOL_RUN, args);
      output.push(cut.out);
      errors.push(cut.err);
      if (cut.code !== 0)
        output.push(
          `SCRATCH BROKEN: ${dest} is not cut at ${snapshot}; fix before launching ${lane} under ${lens}\n`,
        );
    }
  }
  return { code: 0, out: output.join(""), err: errors.join("") };
}

export function launchReviewRound(
  dispatch: string,
  round: string,
  runner: ReviewRunner = runScript,
): ReviewResult {
  const context = reviewContext(dispatch);
  const reviewers: string[] = [];
  const output: string[] = [];
  const errors: string[] = [];
  const head = runner("git", ["-C", context.synthesis, "rev-parse", "HEAD"]);
  if (head.code !== 0) return head;
  const snapshot = head.out.trim();
  const prompts = new Map<string, string>();
  for (const lens of context.lenses) {
    const briefPath = resolve(context.dispatch, `review-${lens}-brief.md`);
    const prompt = `Read ${briefPath} and execute it. Report findings as your final message. Do not modify any file you are reviewing.\n`;
    const promptPath = join(context.dispatch, `review-r${round}-${lens}-prompt.txt`);
    writeFileSync(promptPath, prompt, "utf8");
    prompts.set(lens, promptPath);
    const lanes = laneNames(context.dispatch, lens, runner, (result) => errors.push(result.err));
    if (lanes === null) return { code: 1, out: output.join(""), err: errors.join("") };
    if (lens === "security") {
      for (const lane of lanes) {
        const skill = runner(TOOL_RUN, [
          "launch",
          "skill",
          lane,
          "security-review",
          "--run",
          context.dispatch,
        ]);
        errors.push(skill.err);
        const path = join(context.dispatch, `review-r${round}-security-${lane}-prompt.txt`);
        if (skill.code === 0) writeFileSync(path, skill.out, "utf8");
        else if (skill.code === 3) writeFileSync(path, prompt, "utf8");
        else {
          output.push(`NO SECURITY PROMPT FOR ${lane}; nothing launched\n`);
          return { code: 1, out: output.join(""), err: errors.join("") };
        }
      }
    }
  }
  for (const lens of context.lenses) {
    const lanes = laneNames(context.dispatch, lens, runner, (result) => errors.push(result.err));
    if (lanes === null) return { code: 1, out: output.join(""), err: errors.join("") };
    for (const lane of lanes) {
      const dest = scratch(context.repo, context.ticket, lens, lane);
      const args = ["cut-scratch", "--check", dest, snapshot];
      if (lens === "security") args.push("--clone", context.base);
      const checked = runner(TOOL_RUN, args);
      errors.push(checked.err);
      output.push(checked.out);
      if (checked.code !== 0) {
        output.push(`SCRATCH NOT READY: ${context.ticket}-rev-${lens}-${lane}; nothing launched\n`);
        return { code: 1, out: output.join(""), err: errors.join("") };
      }
    }
  }
  const started = runner(TOOL_RUN, ["review-round", "start", context.dispatch, round]);
  output.push(started.out);
  errors.push(started.err);
  if (started.code !== 0) return { code: started.code, out: output.join(""), err: errors.join("") };
  for (const lens of context.lenses) {
    const lanes = laneNames(context.dispatch, lens, runner, (result) => errors.push(result.err));
    if (lanes === null) return { code: 1, out: output.join(""), err: errors.join("") };
    for (const lane of lanes) {
      const dest = scratch(context.repo, context.ticket, lens, lane);
      const name = runner(TOOL_RUN, [
        "host",
        "name",
        context.dispatch,
        "review",
        lane,
        lens,
        round,
      ]);
      errors.push(name.err);
      if (name.code !== 0)
        return { code: name.code, out: output.join("") + name.out, err: errors.join("") };
      const events = join(context.dispatch, "logs", `review-r${round}-${lens}-${lane}.jsonl`);
      const errorPath = join(context.dispatch, "logs", `review-r${round}-${lens}-${lane}.err`);
      const marker = join(context.dispatch, "logs", `review-r${round}-${lens}-${lane}.done`);
      const launch =
        lens === "bug"
          ? [
              TOOL_RUN,
              "launch",
              "review",
              lane,
              dest,
              context.base,
              "--last",
              join(context.dispatch, "logs", `review-r${round}-bug-${lane}-last.md`),
              "--run",
              context.dispatch,
            ]
          : [
              TOOL_RUN,
              "launch",
              "launch",
              lane,
              dest,
              lens === "security"
                ? join(context.dispatch, `review-r${round}-security-${lane}-prompt.txt`)
                : (prompts.get(lens) ?? ""),
              "--run",
              context.dispatch,
            ];
      const startedLane = runner(TOOL_RUN, [
        "host",
        "run",
        name.out.trim(),
        dest,
        "--under",
        context.dispatch,
        "--role",
        "reviewer",
        "--run",
        context.dispatch,
        "--out",
        events,
        "--err",
        errorPath,
        "--marker",
        marker,
        "--",
        ...launch,
      ]);
      output.push(startedLane.out);
      errors.push(startedLane.err);
      if (startedLane.code !== 0)
        return { code: startedLane.code, out: output.join(""), err: errors.join("") };
      reviewers.push(`${lens}:${lane}`);
    }
  }
  const waited = runner(TOOL_RUN, [
    "review-round",
    "wait",
    context.dispatch,
    round,
    context.repo,
    ...reviewers,
  ]);
  return {
    code: waited.code,
    out: output.join("") + waited.out,
    err: errors.join("") + waited.err,
  };
}

// --- entry ------------------------------------------------------------------------------
if (import.meta.main) {
  const argv = process.argv.slice(2);

  const cmd = argv[0];
  if ((cmd === "cut" || cmd === "launch") && argv.length === 3) {
    const roundArg = argv[2] ?? "";
    if (!/^[0-9]+$/u.test(roundArg) || roundArg.startsWith("0") || roundArg.length > 6)
      die(`a round is a whole number from 1: ${roundArg}`);
    try {
      const result =
        cmd === "cut" ? cutReviewRound(argv[1]!, roundArg) : launchReviewRound(argv[1]!, roundArg);
      process.stdout.write(result.out);
      process.stderr.write(result.err);
      process.exit(result.code);
    } catch (error) {
      die(error instanceof Error ? error.message : String(error));
    }
  }
  if (cmd !== "start" && cmd !== "wait" && cmd !== "teardown") die(USAGE);
  if (cmd === "start" && argv.length !== 3) die(USAGE);
  if ((cmd === "wait" || cmd === "teardown") && argv.length < 4) die(USAGE);
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
