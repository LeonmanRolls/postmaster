#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { atomicWrite, command, makeTemp, removeTree, scriptDir, writeError, writeOut } from "./lib/core.ts";

const here = scriptDir(import.meta.url);
const waitPath = join(here, "wait-for-markers.sh");
const hostPath = join(here, "host.sh");
const cutPath = join(here, "cut-scratch.sh");
const logPath = join(here, "run-log.sh");
const actionPath = join(here, "log-action.sh");
const defaultLimit = 2400,
  maxLimit = 86400;
const usageText =
  "usage: review-round.sh start <dispatch> <round> | wait|teardown <dispatch> <round> <repo> [<lens>:<lane>...] | --self-test";
class ExitFault extends Error {
  constructor(
    message: string,
    readonly code = 1,
  ) {
    super(message);
  }
}
type Pair = [string, string];
type RoundState = {
  attempt: string;
  boot: string;
  limit: number;
  source: string;
  deadline: number;
  started: string;
  reviewers: Pair[];
};
type ChildResult = { code: number; stdout: string; stderr: string };
function die(message: string, code = 1): never {
  throw new ExitFault(message, code);
}
function bootId(): string {
  try {
    return readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
  } catch {
    const r = command("sysctl", ["-n", "kern.boottime"]);
    return r.code === 0 ? r.stdout.trim() : "";
  }
}
function monoSeconds(): number {
  const clock = (globalThis as any).performance;
  return (clock.timeOrigin + clock.now()) / 1000;
}
function readState(path: string): RoundState {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as RoundState;
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT")
      die("round not started: no " + path + "; start runs before the round's launches");
    die(path + " cannot be read: " + String(error).replace(/^Error: /, ""));
  }
}
function saveState(path: string, state: RoundState): void {
  atomicWrite(path, JSON.stringify(state, null, 2) + "\n");
}
function startRound(path: string, runJson: string): [number, string] {
  let limit = defaultLimit,
    source = "the default";
  const warn = (reason: string) =>
    writeError("review-round: " + reason + "; the round's time limit is the default, " + defaultLimit + "s");
  try {
    const config = JSON.parse(readFileSync(runJson, "utf8")).config;
    const value = config && typeof config === "object" ? config.review?.round_timeout_seconds : undefined;
    if (value === undefined || value === null) limit = defaultLimit;
    else if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= maxLimit) {
      limit = value;
      source = "review.round_timeout_seconds in run.json";
    } else
      warn(
        "review.round_timeout_seconds in " +
          runJson +
          " is " +
          JSON.stringify(value) +
          ", not a whole number of seconds from 1 to " +
          maxLimit,
      );
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") warn("no run.json at " + runJson);
    else warn(runJson + " cannot be read (" + String(error).replace(/^Error: /, "") + ")");
  }
  saveState(path, {
    attempt: randomBytes(8).toString("hex"),
    boot: bootId(),
    limit,
    source,
    deadline: monoSeconds() + limit,
    started: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    reviewers: [],
  });
  return [limit, source];
}
function checkedState(path: string): RoundState {
  const state = readState(path),
    currentBoot = bootId();
  if (state.boot && currentBoot && state.boot !== currentBoot)
    die("the machine has restarted since the round started, so none of its reviewers runs; start the round again");
  return state;
}
function secondsLeft(state: RoundState): number {
  return Math.max(0, Math.ceil(state.deadline - monoSeconds()));
}
function reviewerPairs(given: string[], recorded: Pair[] = []): Pair[] {
  const tokens = given.flatMap((arg) => arg.split(/[\s,]+/).filter(Boolean));
  if (!tokens.length) {
    if (recorded.length) return recorded;
    die("no reviewers given, and none recorded for this round");
  }
  const pairs: Pair[] = [],
    bad: string[] = [];
  for (const token of tokens) {
    const m = /^([A-Za-z0-9._-]+):([A-Za-z0-9._-]+)$/.exec(token);
    if (!m || ["", ".", ".."].some((s) => m[1] === s || m[2] === s)) bad.push(token);
    else if (!pairs.some((pair) => pair[0] === m[1] && pair[1] === m[2])) pairs.push([m[1]!, m[2]!]);
  }
  if (bad.length) die("not a <lens>:<lane>: " + bad.join(", "));
  return pairs;
}
function stateReviewers(path: string, given: string[], persist: boolean): Pair[] {
  const state = readState(path),
    pairs = reviewerPairs(given, state.reviewers ?? []);
  if (given.length && persist) {
    state.reviewers = pairs;
    saveState(path, state);
  }
  return pairs;
}
function scratch(repo: string, ticket: string, pair: Pair): string {
  return join(repo, ".worktrees", ticket + "-rev-" + pair[0] + "-" + pair[1]);
}
function unswitch(path: string, ticket: string): string {
  if (command(cutPath, ["--kind", path]).code === 0) return "";
  const branch = command("git", ["-C", path, "symbolic-ref", "-q", "--short", "HEAD"]);
  if (branch.code !== 0) return "";
  const name = branch.stdout.trim();
  if (name === ticket || name.startsWith("wb/" + ticket + "-")) return "";
  return command("git", ["-C", path, "checkout", "-q", "--detach"]).code === 0
    ? "a reviewer had switched it onto branch " + name + "; detached, and the branch kept"
    : "";
}
let unrecorded = false;
function record(dispatch: string, text: string, args: string[]): void {
  if (command(logPath, [dispatch, text]).code !== 0) {
    writeOut("NOT RECORDED in run-log.md: " + text);
    unrecorded = true;
  }
  if (command(actionPath, [dispatch, "coachman", ...args]).code !== 0) {
    writeOut("NOT RECORDED in actions.jsonl: " + args.join(" "));
    unrecorded = true;
  }
}
function child(
  program: string,
  args: string[],
  env?: Record<string, string | undefined>,
  cwd?: string,
): Promise<ChildResult> {
  return new Promise((done) => {
    const proc = spawn(program, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "",
      stderr = "";
    proc.stdout?.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    proc.stderr?.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    proc.on("error", (error: Error) => done({ code: 127, stdout, stderr: stderr + error.message }));
    proc.on("close", (code: number | null) => done({ code: code ?? 1, stdout, stderr }));
  });
}
async function waitRound(
  dispatch: string,
  repo: string,
  round: string,
  statePath: string,
  logs: string,
  ticket: string,
  given: string[],
): Promise<number> {
  const state = checkedState(statePath),
    attempt = state.attempt,
    limit = state.limit,
    source = state.source;
  const pairs = stateReviewers(statePath, given, true),
    left = secondsLeft(state);
  writeOut(
    "review-round: round " +
      round +
      ", " +
      pairs.length +
      " reviewers, " +
      left +
      "s left of its " +
      limit +
      "s limit (" +
      source +
      ")",
  );
  const waited = command(waitPath, [logs, "review-r" + round + "-*.done", String(pairs.length), String(left)]);
  if (waited.stdout) process.stdout.write(waited.stdout);
  if (waited.stderr) process.stderr.write(waited.stderr);
  if (waited.code !== 0 && waited.code !== 3)
    die("the wait ended with exit " + waited.code + ", so nothing is recorded");
  const expected = new Set(pairs.map((pair) => "review-r" + round + "-" + pair[0] + "-" + pair[1] + ".done"));
  const missing = pairs
    .map((pair) => ({ pair, file: "review-r" + round + "-" + pair[0] + "-" + pair[1] + ".done" }))
    .filter((item) => !existsSync(join(logs, item.file)));
  if (!missing.length) {
    if (waited.code === 3)
      writeOut("review-round: every marker was in by the time the reviewers were named; none timed out");
    return 0;
  }
  if (waited.code === 0) {
    const strays = readdirSync(logs, { encoding: "utf8" }).filter(
      (f: string) => f.startsWith("review-r" + round + "-") && f.endsWith(".done") && !expected.has(f),
    );
    die(
      "the count was made up by markers no reviewer of round " +
        round +
        " lands:" +
        (strays.length ? " " + strays.join(" ") : ""),
    );
  }
  if (checkedState(statePath).attempt !== attempt)
    die("round " + round + " was started again while this wait ran; it stands down, and records and stops nothing");
  unrecorded = false;
  const reported = pairs.length - missing.length;
  record(
    dispatch,
    "round " +
      round +
      ": WAIT-TIMEOUT after " +
      limit +
      "s; " +
      reported +
      " of " +
      pairs.length +
      " reviewers reported",
    [
      "note",
      "r" + round,
      "WAIT-TIMEOUT after " + limit + "s: " + reported + " of " + pairs.length + " reviewers reported",
    ],
  );
  for (const item of missing) {
    writeOut("TIMEOUT " + item.pair[0] + " " + item.pair[1] + ": DEGRADED, timeout");
    record(dispatch, item.pair[1] + " " + item.pair[0] + ": DEGRADED, timeout", [
      "degrade",
      item.pair[1],
      item.pair[0] + " r" + round + ": timeout",
    ]);
  }
  const stops = await Promise.all(
    missing.map(async (item) => {
      const dir = scratch(repo, ticket, item.pair);
      return { item, dir, result: existsSync(dir) ? await child(hostPath, ["stop", dir]) : null };
    }),
  );
  for (const stop of stops) {
    const output = stop.result ? (stop.result.stdout + stop.result.stderr).trim() : "";
    if (!stop.result) {
      writeOut("  no scratch at " + stop.dir);
      continue;
    }
    if (stop.result.code === 0) {
      writeOut("  " + output);
      if (!output.startsWith("no launch is running"))
        record(dispatch, stop.item.pair[1] + " " + stop.item.pair[0] + ": at the time limit, " + output, [
          "note",
          stop.dir,
          "r" + round + " " + stop.item.pair[0] + " " + stop.item.pair[1] + ": at the time limit, " + output,
        ]);
    } else {
      writeOut("  STILL RUNNING in " + stop.dir + ": " + output);
      record(
        dispatch,
        stop.item.pair[1] + " " + stop.item.pair[0] + ": still running after the time limit, " + output,
        [
          "note",
          stop.dir,
          "r" +
            round +
            " " +
            stop.item.pair[0] +
            " " +
            stop.item.pair[1] +
            ": still running after the time limit, " +
            output,
        ],
      );
    }
  }
  return unrecorded ? 4 : 3;
}
function teardownRound(
  dispatch: string,
  repo: string,
  round: string,
  logs: string,
  ticket: string,
  given: string[],
  caller: string,
): number {
  const stateFile = join(logs, "review-r" + round + ".json");
  const pairs = given.length ? reviewerPairs(given) : stateReviewers(stateFile, [], false);
  let removed = 0,
    kept = 0,
    gone = 0;
  for (const pair of pairs) {
    const dir = scratch(repo, ticket, pair);
    if (!existsSync(dir)) {
      writeOut("no scratch at " + dir);
      gone++;
      continue;
    }
    const finished = existsSync(join(logs, "review-r" + round + "-" + pair[0] + "-" + pair[1] + ".done"));
    let why = "";
    if (caller === dir || caller.startsWith(dir + "/"))
      why = "the shell that ran this works in it; run teardown from outside it";
    if (!why) {
      const stopped = command(hostPath, ["stop", dir]),
        stopOut = (stopped.stdout + stopped.stderr).trim();
      if (stopped.code !== 0) why = "it could not be stopped: " + stopOut;
      else {
        if (!stopOut.startsWith("no launch is running")) {
          const detail =
            stopOut + (finished ? ", left behind by a reviewer that had finished" : "; its reviewer had not finished");
          writeOut(dir + ": " + detail);
          record(dispatch, pair[1] + " " + pair[0] + ": at teardown, " + detail, [
            "note",
            dir,
            "r" + round + " " + pair[0] + " " + pair[1] + ": at teardown, " + detail,
          ]);
        }
        const closed = command(hostPath, ["close", dir]);
        if (closed.code !== 0) why = "its space was not closed: " + (closed.stdout + closed.stderr).trim();
        else {
          const switched = unswitch(dir, ticket);
          if (switched) {
            writeOut(dir + ": " + switched);
            record(dispatch, dir.split("/").at(-1) + ": " + switched, ["note", dir, "r" + round + ": " + switched]);
          }
          const cut = command(cutPath, ["--remove", repo, dir]);
          if (cut.code !== 0) why = "it was not removed: " + (cut.stdout + cut.stderr).trim();
        }
      }
    }
    if (!why) {
      writeOut("removed " + dir);
      removed++;
      if (command(actionPath, [dispatch, "coachman", "teardown", dir, "review scratch, round " + round]).code !== 0)
        writeOut("NOT RECORDED in actions.jsonl: teardown " + dir);
    } else {
      why = why.replace(/\n/g, " ");
      writeOut("LEFT IN PLACE " + dir + ": " + why);
      kept++;
      record(dispatch, dir.split("/").at(-1) + ": left in place at teardown, " + why, [
        "note",
        dir,
        "r" + round + ": left in place at teardown, " + why,
      ]);
    }
  }
  const summary =
    "round " +
    round +
    ": removed " +
    removed +
    " of " +
    pairs.length +
    " scratches" +
    (gone ? ", " + gone + " already gone" : "") +
    (kept ? ", " + kept + " left in place" : "");
  if (command(logPath, [dispatch, summary]).code !== 0)
    writeOut("NOT RECORDED in run-log.md: round " + round + " teardown");
  return kept ? 1 : 0;
}
async function selfTest(): Promise<number> {
  const tmp = makeTemp("review-round-test-");
  const repo = join(tmp, "repo"),
    dispatch = join(tmp, "runs", "proj", "T-1"),
    logs = join(dispatch, "logs");
  const bin = join(tmp, "bin"),
    hostState = join(tmp, "host"),
    pids = join(tmp, "pids"),
    elsewhere = join(tmp, "elsewhere");
  mkdirSync(logs, { recursive: true });
  mkdirSync(bin);
  mkdirSync(hostState);
  mkdirSync(pids);
  mkdirSync(elsewhere);
  mkdirSync(repo);
  let fails = 0,
    last: ChildResult = { code: 0, stdout: "", stderr: "" },
    took = 0,
    launches = 0;
  const originalEnv = {
    PATH: process.env.PATH,
    POSTMASTER_HOST: process.env.POSTMASTER_HOST,
    POSTMASTER_HOST_STATE: process.env.POSTMASTER_HOST_STATE,
    POSTMASTER_HOST_STOP_WAIT: process.env.POSTMASTER_HOST_STOP_WAIT,
    POSTMASTER_HOST_CLOSE_WAIT: process.env.POSTMASTER_HOST_CLOSE_WAIT,
  };
  const env: Record<string, string> = {
    PATH: bin + ":" + (process.env.PATH ?? ""),
    POSTMASTER_HOST: "none",
    POSTMASTER_HOST_STATE: hostState,
    POSTMASTER_HOST_STOP_WAIT: "2",
    POSTMASTER_HOST_CLOSE_WAIT: "1",
  };
  const check = (label: string, good: boolean, detail = "") => {
    writeOut((good ? "  ok   " : "  FAIL ") + label);
    if (!good) {
      for (const line of detail.split("\n")) writeOut("         " + line);
      fails++;
    }
  };
  const run = async (args: string[], cwd?: string): Promise<ChildResult> => {
    const start = Date.now();
    last = command(scriptPath, args, { cwd, env });
    took = Math.round((Date.now() - start) / 1000);
    return last;
  };
  const has = (text: string) => (last.stdout + last.stderr).includes(text);
  const logLines = (action: string) => {
    try {
      return readFileSync(join(dispatch, "actions.jsonl"), "utf8")
        .split("\n")
        .filter(Boolean)
        .filter((line: string) => line.includes('"action":"' + action + '"')).length;
    } catch {
      return 0;
    }
  };
  const limit = (value: string | number) =>
    writeFileSync(
      join(dispatch, "run.json"),
      '{"config":{"review":{"round_timeout_seconds":' + JSON.stringify(value) + "}}}\n",
    );
  const cut = (lens: string, lane: string) => {
    const path = scratch(repo, "T-1", [lens, lane]);
    mkdirSync(join(repo, ".worktrees"), { recursive: true });
    const made = command("git", ["-C", repo, "worktree", "add", "-q", "--detach", path, "HEAD"]);
    if (made.code !== 0) throw new Error(made.stderr || "could not create test scratch");
    return path;
  };
  const launch = async (round: number, lens: string, lane: string, kind: "fast" | "slow" | "leaves") => {
    launches++;
    const childPid = join(pids, "child." + launches),
      launchPid = join(pids, "launch." + launches);
    const path = scratch(repo, "T-1", [lens, lane]);
    const result = command(
      hostPath,
      [
        "run",
        "T-1 " + lane + " " + lens + " review",
        path,
        "--marker",
        join(logs, "review-r" + round + "-" + lens + "-" + lane + ".done"),
        "--pidfile",
        launchPid,
        "--",
        join(tmp, "reviewer.sh"),
        kind,
        childPid,
      ],
      { cwd: tmp, env },
    );
    if (result.code !== 0) throw new Error(result.stderr || "could not launch test reviewer");
    if (kind !== "fast") {
      for (let i = 0; i < 50 && !existsSync(childPid); i++) await new Promise((r) => setTimeout(r, 100));
      if (!existsSync(childPid)) throw new Error("test reviewer did not start");
    }
    return {
      launchPid: existsSync(launchPid) ? readFileSync(launchPid, "utf8").trim() : "",
      childPid: existsSync(childPid) ? readFileSync(childPid, "utf8").trim() : "",
    };
  };
  const alive = (pid: string) => {
    if (!pid) return false;
    const p = command("ps", ["-o", "stat=", "-p", pid]);
    return p.code === 0 && !!p.stdout.trim() && !p.stdout.trim().startsWith("Z");
  };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  try {
    command("git", ["init", "-q", "-b", "main", repo]);
    command("git", [
      "-C",
      repo,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "first",
    ]);
    for (const name of ["herdr", "tmux"]) writeFileSync(join(bin, name), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    writeFileSync(
      join(tmp, "reviewer.sh"),
      [
        "#!/bin/sh",
        "case $1 in",
        "fast) exit 0 ;;",
        'leaves) sleep 300 & echo $! > "$2"; exit 0 ;;',
        'slow) setsid sleep 300 & echo $! > "$2"; exec sleep 300 ;;',
        "esac",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );

    writeOut("positive controls");
    limit(3);
    cut("bug", "one");
    cut("bug", "two");
    last = await run(["start", dispatch, "1"]);
    check(
      "start clears the round's markers and fixes its limit from run.json",
      last.code === 0 &&
        has("time limit 3s (review.round_timeout_seconds in run.json)") &&
        existsSync(join(logs, "review-r1.json")),
    );
    await launch(1, "bug", "one", "fast");
    const slow = await launch(1, "bug", "two", "slow");
    last = await run(["wait", dispatch, "1", repo, "bug:one bug:two"]);
    const waitOut = last;
    check(
      "at the deadline, wait exits 3 and names the reviewer with no marker",
      last.code === 3 && has("WAIT-TIMEOUT") && has("TIMEOUT bug two: DEGRADED, timeout") && !has("TIMEOUT bug one"),
    );
    check(
      "run-log.md records it as <lane> <lens>: DEGRADED, timeout",
      readFileSync(join(dispatch, "run-log.md"), "utf8").includes(" two bug: DEGRADED, timeout"),
    );
    check(
      "a degrade line records it, with the lens, the round and the cause",
      readFileSync(join(dispatch, "actions.jsonl"), "utf8").includes(
        '"action":"degrade","target":"two","detail":"bug r1: timeout"',
      ) && logLines("degrade") === 1,
    );
    check(
      "host.sh stop ends it, and its child in a session of its own",
      !alive(slow.launchPid) && !alive(slow.childPid),
    );
    last = await run(["teardown", dispatch, "1", repo]);
    check(
      "teardown takes the reviewers the wait recorded, and removes each scratch",
      last.code === 0 &&
        !existsSync(scratch(repo, "T-1", ["bug", "one"])) &&
        !existsSync(scratch(repo, "T-1", ["bug", "two"])) &&
        logLines("teardown") === 2,
      last.stdout + last.stderr,
    );

    limit(4);
    cut("bug", "three");
    await run(["start", dispatch, "2"]);
    const three = await launch(2, "bug", "three", "slow");
    const state2 = JSON.parse(readFileSync(join(logs, "review-r2.json"), "utf8"));
    state2.reviewers = [["bug", "three"]];
    writeFileSync(join(logs, "review-r2.json"), JSON.stringify(state2));
    await sleep(2100);
    last = await run(["wait", dispatch, "2", repo]);
    check(
      "a wait run again keeps the round's deadline rather than starting a new one",
      last.code === 3 && took <= 3 && has("TIMEOUT bug three") && !alive(three.launchPid),
      last.stdout + last.stderr,
    );
    await run(["teardown", dispatch, "2", repo, "bug:three"]);

    limit(60);
    cut("style", "one");
    await run(["start", dispatch, "3"]);
    const left = await launch(3, "style", "one", "leaves");
    last = await run(["wait", dispatch, "3", repo, "style:one"]);
    check(
      "when every marker is in, wait exits 0 and records nothing",
      last.code === 0 && logLines("degrade") === 2,
      last.stdout + last.stderr,
    );
    command("git", ["-C", scratch(repo, "T-1", ["style", "one"]), "switch", "-q", "-c", "probe"]);
    last = await run(["teardown", dispatch, "3", repo, "style:one"]);
    check(
      "teardown stops what a finished reviewer's launch left running, and says so",
      last.code === 0 && !alive(left.childPid) && has("left behind by a reviewer that had finished"),
    );
    check(
      "a scratch a reviewer switched onto a branch is still removed, and the branch kept",
      !existsSync(scratch(repo, "T-1", ["style", "one"])) &&
        has("switched it onto branch probe") &&
        command("git", ["-C", repo, "rev-parse", "-q", "--verify", "refs/heads/probe"]).code === 0,
    );

    writeOut("negative controls");
    last = waitOut;
    check(
      "a reviewer that reported is neither recorded nor stopped",
      !has("TIMEOUT bug one") && !readFileSync(join(dispatch, "run-log.md"), "utf8").includes("one bug: DEGRADED"),
    );
    limit(2);
    cut("bug", "four");
    await run(["start", dispatch, "4"]);
    const four = await launch(4, "bug", "four", "slow");
    const stale = child(scriptPath, ["wait", dispatch, "4", repo, "bug:four"], env);
    await sleep(500);
    limit(60);
    await run(["start", dispatch, "4"]);
    const staleResult = await stale;
    last = staleResult;
    check(
      "a wait from an earlier start of the round stands down, and records and stops nothing",
      last.code === 1 &&
        has("started again") &&
        alive(four.launchPid) &&
        !readFileSync(join(dispatch, "run-log.md"), "utf8").includes("four bug: DEGRADED"),
    );
    const fourDir = scratch(repo, "T-1", ["bug", "four"]);
    last = command(scriptPath, ["teardown", dispatch, "4", repo, "bug:four"], { cwd: fourDir, env });
    check(
      "teardown from inside a scratch leaves it in place, and stops nothing",
      last.code === 1 &&
        (last.stdout + last.stderr).includes("LEFT IN PLACE") &&
        existsSync(fourDir) &&
        alive(four.launchPid),
    );
    last = await run(["teardown", dispatch, "4", repo, "bug:four"]);
    check(
      "from outside, teardown stops the unfinished reviewer first, says so, then removes it",
      last.code === 0 && !alive(four.launchPid) && has("its reviewer had not finished") && !existsSync(fourDir),
    );
    cut("bug", "seven");
    last = await run(["teardown", dispatch, "12", repo, "bug:seven"]);
    check(
      "teardown given its reviewers needs no start, as at the cut, and records none for the round",
      last.code === 0 &&
        !existsSync(scratch(repo, "T-1", ["bug", "seven"])) &&
        !existsSync(join(logs, "review-r12.json")),
    );
    const fake = scratch(repo, "T-1", ["bug", "five"]);
    mkdirSync(fake, { recursive: true });
    last = await run(["teardown", dispatch, "4", repo, "bug:five"]);
    check(
      "a directory that is no scratch is left in place",
      last.code === 1 && has("it was not removed") && existsSync(fake),
    );
    const own = scratch(repo, "T-1", ["style", "two"]);
    mkdirSync(join(repo, ".worktrees"), { recursive: true });
    command("git", ["-C", repo, "worktree", "add", "-q", "-b", "wb/T-1-luna", own, "HEAD"]);
    last = await run(["teardown", dispatch, "4", repo, "style:two"]);
    check(
      "a worktree on the run's own branch is never detached or removed",
      last.code === 1 &&
        has("LEFT IN PLACE") &&
        command("git", ["-C", own, "symbolic-ref", "-q", "--short", "HEAD"]).stdout.trim() === "wb/T-1-luna",
    );

    writeFileSync(join(logs, "review-r6-bug-one.done"), "done\n");
    writeFileSync(join(logs, "review-r6-style-one.done"), "stray\n");
    writeFileSync(
      join(logs, "review-r6.json"),
      JSON.stringify({ attempt: "a", boot: "", limit: 1, source: "t", deadline: 0, reviewers: [] }),
    );
    last = await run(["wait", dispatch, "6", repo, "bug:one,bug:two"]);
    check(
      "a marker another reviewer landed never stands in for a missing one",
      last.code === 1 && has("review-r6-style-one.done"),
    );
    writeFileSync(
      join(logs, "review-r7.json"),
      JSON.stringify({
        attempt: "a",
        boot: "another-boot",
        limit: 1,
        source: "t",
        deadline: monoSeconds() + 60,
        reviewers: [],
      }),
    );
    if (existsSync("/proc/sys/kernel/random/boot_id")) {
      last = await run(["wait", dispatch, "7", repo, "bug:one"]);
      check("a round started before the machine restarted is not waited on", last.code === 1 && has("restarted"));
    }
    last = await run(["wait", dispatch, "8", repo, "bug:one"]);
    check("a round that was never started is not waited on", last.code === 1 && has("round not started"));
    for (const value of ['"7"', "0", "-3", "true", "1.5", "86401"]) {
      writeFileSync(join(dispatch, "run.json"), '{"config":{"review":{"round_timeout_seconds":' + value + "}}}\n");
      last = await run(["start", dispatch, "9"]);
      check(
        "a limit of " + value + " is not used: the default, and the warning says why",
        last.code === 0 &&
          has("time limit 2400s (the default)") &&
          has("not a whole number of seconds from 1 to 86400"),
      );
    }
    rmSync(join(dispatch, "run.json"), { force: true });
    last = await run(["start", dispatch, "9"]);
    check(
      "no run.json gets the default, and says so",
      last.code === 0 && has("no run.json") && has("time limit 2400s"),
    );
    limit(1);
    last = await run(["start", dispatch, "10"]);
    cut("bug", "six");
    if (process.getuid?.() !== 0) {
      // The action log's mode is restored before cleanup; this control uses the same denied-write condition.
      const actions = join(dispatch, "actions.jsonl");
      command("chmod", ["a-w", actions]);
      last = await run(["wait", dispatch, "10", repo, "bug:six"]);
      command("chmod", ["u+w", actions]);
      check(
        "a timeout whose degrade line cannot be written exits 4, and says what was not recorded",
        last.code === 4 && has("NOT RECORDED in actions.jsonl"),
      );
    } else writeOut("  skip a record that cannot be written (root writes anywhere)");
    await run(["teardown", dispatch, "10", repo, "bug:six"]);
    limit(1);
    last = await run(["start", dispatch, "11"]);
    const invalid = [
      ["wait", dispatch, "11", repo, "bug"],
      ["wait", dispatch, "11", repo, "bug:../x"],
      ["wait", dispatch, "0", repo, "bug:one"],
      ["wait", join(tmp, "nowhere"), "1", repo, "bug:one"],
      ["wait", dispatch, "11", elsewhere, "bug:one"],
      ["stop", dispatch, "11", repo, "bug:one"],
      ["start", dispatch],
    ];
    for (const args of invalid) {
      last = await run(args);
      check("refused: review-round.sh " + args.join(" ").replaceAll(tmp, "<tmp>"), last.code === 1);
    }
    last = await run(["wait", dispatch, "11", repo, "bug:one\nbug:one security:two"]);
    check(
      "reviewers on several lines, one given twice, are each waited on once",
      last.code === 3 && has("round 11, 2 reviewers"),
    );
  } catch (error) {
    check("self-test setup and controls complete", false, String(error));
  } finally {
    for (const name of readdirSync(pids)) {
      try {
        const pid = readFileSync(join(pids, name), "utf8").trim();
        if (pid) command("kill", ["-KILL", pid]);
      } catch {}
    }
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    removeTree(tmp);
  }
  writeOut("");
  writeOut(fails ? "self-test: " + fails + " control(s) misbehaved" : "self-test: all controls behaved");
  return fails ? 1 : 0;
}
const scriptPath = join(here, "review-round.sh");
async function run(args: string[]): Promise<number> {
  try {
    if (args[0] === "--self-test") return args.length === 1 ? await selfTest() : die(usageText);
    const cmd = args[0] ?? "";
    if (
      (cmd === "start" && args.length !== 3) ||
      ((cmd === "wait" || cmd === "teardown") && args.length < 4) ||
      !["start", "wait", "teardown"].includes(cmd)
    )
      die(usageText);
    let dispatch: string;
    try {
      dispatch = realpathSync(args[1]!);
    } catch {
      die("no such dispatch directory: " + args[1]);
    }
    if (!statSync(dispatch!).isDirectory()) die("no such dispatch directory: " + args[1]);
    const round = args[2]!;
    if (!/^[1-9][0-9]{0,5}$/.test(round)) die("a round is a whole number from 1: " + round);
    const logs = join(dispatch!, "logs"),
      statePath = join(logs, "review-r" + round + ".json");
    const ticket = dispatch!.split("/").at(-1)!;
    if (cmd === "start") {
      mkdirSync(logs, { recursive: true });
      for (const file of readdirSync(logs))
        if (file.startsWith("review-r" + round + "-") && file.endsWith(".done"))
          rmSync(join(logs, file), { force: true });
      const [limit, source] = startRound(statePath, join(dispatch!, "run.json"));
      writeOut(
        "review-round: round " + round + " started, markers cleared, time limit " + limit + "s (" + source + ")",
      );
      return 0;
    }
    let repo: string;
    try {
      repo = realpathSync(args[3]!);
    } catch {
      die("no such repo: " + args[3]);
    }
    if (!statSync(repo!).isDirectory()) die("no such repo: " + args[3]);
    if (command("git", ["-C", repo!, "rev-parse", "--git-dir"]).code !== 0) die("not a git repository: " + args[3]);
    const caller = process.cwd();
    if (cmd === "wait") return await waitRound(dispatch!, repo!, round, statePath, logs, ticket, args.slice(4));
    return teardownRound(dispatch!, repo!, round, logs, ticket, args.slice(4), caller);
  } catch (error) {
    if (error instanceof ExitFault) {
      writeError("review-round: " + error.message);
      return error.code;
    }
    writeError("review-round: " + String(error).replace(/^Error: /, ""));
    return 1;
  }
}
void run(process.argv.slice(2)).then((code) => process.exit(code));
