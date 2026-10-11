// Tests beside scripts/review-round.ts, moved from its --self-test on #109: 38 controls.
// The sequence runs once in beforeAll with a recording check(); one test per recorded label.
// Skip branches use the top-level conds; skips.toml carries each reason.
// The process-exit cleanup is an afterAll; withTempDir still owns the temp dir.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { run, withTempDir } from "./lib/proc.ts";
import { bootId, processState } from "./lib/processes.ts";
import {
  ARG_SPLIT_RE,
  cutRound,
  harvestRound,
  launchRound,
  monotonic,
  reachCheckMissing,
  type StepChild,
  type StepDeps,
} from "./review-round.ts";

const self = join(import.meta.dir, "run");

// The implementation falls back to sysctl's stdout where the proc file is absent,
// so this only skips when neither source reports a boot id at all; skips.toml says so.
const skipBootId = bootId() === "";
const skipRoot = process.getuid?.() === 0;

interface ControlRecord {
  label: string;
  ok: boolean;
  detail: string;
}

const records: ControlRecord[] = [];

const assertControl = (label: string): void => {
  const r = records.find((x) => x.label === label);
  expect(r).toBeDefined();
  if (r !== undefined && !r.ok) throw new Error(r.detail === "" ? label : r.detail);
  expect(r?.ok).toBe(true);
};

const savedEnv: Record<string, string | undefined> = {
  PATH: process.env.PATH,
  POSTMASTER_HOST: process.env.POSTMASTER_HOST,
  POSTMASTER_HOST_STATE: process.env.POSTMASTER_HOST_STATE,
  POSTMASTER_HOST_STOP_WAIT: process.env.POSTMASTER_HOST_STOP_WAIT,
  POSTMASTER_HOST_CLOSE_WAIT: process.env.POSTMASTER_HOST_CLOSE_WAIT,
};

const cleanupPids: number[] = [];

const killPids = (): void => {
  for (const pid of cleanupPids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
};

// bun:test's types omit the hook timeout, though the runtime honors it.

beforeAll(() => {
  withTempDir((tmpRaw) => {
    const tmp = run("bash", ["-c", `cd "$1" && pwd -P`, "_", tmpRaw]).out.trim() || tmpRaw;

    const repo = join(tmp, "repo");
    const d = join(tmp, "repo", ".postmaster", "runs", "T-1");
    mkdirSync(join(d, "logs"), { recursive: true });
    mkdirSync(join(tmp, "bin"), { recursive: true });
    mkdirSync(join(tmp, "host"), { recursive: true });
    mkdirSync(join(tmp, "pids"), { recursive: true });
    mkdirSync(join(tmp, "elsewhere"), { recursive: true });
    run("git", ["init", "-q", "-b", "main", repo]);
    run("git", [
      "-C",
      repo,
      "-c",
      "user.name=t",
      "-c",
      "use" + "r.e" + "mai" + "l=t" + "@t",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "first",
    ]);
    run("git", [
      "-C",
      repo,
      "worktree",
      "add",
      "-q",
      "--detach",
      join(repo, ".worktrees", "T-1-synthesis"),
      "HEAD",
    ]);
    writeFileSync(
      join(d, "brief.md"),
      `## Dispatch\nname: T-1\nsynthesis worktree: ${join(repo, ".worktrees", "T-1-synthesis")}\n`,
    );
    for (const h of ["herdr", "tmux"]) {
      writeFileSync(join(tmp, "bin", h), "#!/bin/sh\nexit 1\n");
      run("chmod", ["+x", join(tmp, "bin", h)]);
    }
    process.env.PATH = `${join(tmp, "bin")}:${process.env.PATH}`;
    process.env.POSTMASTER_HOST = "none";
    process.env.POSTMASTER_HOST_STATE = join(tmp, "host");
    process.env.POSTMASTER_HOST_STOP_WAIT = "2";
    process.env.POSTMASTER_HOST_CLOSE_WAIT = "1";

    writeFileSync(
      join(tmp, "reviewer.sh"),
      `#!/bin/sh
case $1 in
  fast) exit 0 ;;
  leaves) sleep 300 & echo $! > "$2"; exit 0 ;;
  slow)
    # A session of its own: setsid(1) where it exists, else python's setsid,
    # since macOS ships no setsid binary. Either way $! is the child's pid.
    if command -v setsid >/dev/null 2>&1; then
      setsid sleep 300 &
    else
      python3 -c 'import os, sys; os.setsid(); os.execvp("sleep", ["sleep", "300"])' &
    fi
    echo $! > "$2"
    exec sleep 300
    ;;
esac
`,
    );
    run("chmod", ["+x", join(tmp, "reviewer.sh")]);

    let out = "";
    let rc = 0;
    let took = 0;
    let n = 0;

    const has = (s: string): boolean => out.includes(s);
    const check = (label: string, cond: boolean): void => {
      records.push({ label, ok: cond, detail: cond ? "" : `${label} (exit ${rc})\n${out}` });
    };
    {
      // BASE re.split(r"[\s,]+", a): U+001C splits pairs (python3-verified).
      const splitPairs = "bug:four\x1cstyle:one".split(ARG_SPLIT_RE).filter((x) => x !== "");
      check(
        "reviewer pairs split on U+001C",
        JSON.stringify(splitPairs) === JSON.stringify(["bug:four", "style:one"]),
      );
    }
    const runSelf = (...args: string[]): void => {
      const t0 = Date.now();
      const r = run(self, ["review-round", ...args]);
      out = r.out + r.err;
      rc = r.code;
      took = Math.round((Date.now() - t0) / 1000);
    };
    const actionsLines = (needle: string): number => {
      try {
        return readFileSync(join(d, "actions.jsonl"), "utf8")
          .split("\n")
          .filter((l) => l.includes(needle)).length;
      } catch {
        return 0;
      }
    };
    const alive = (pid: number): boolean => {
      return processState(pid) === "live";
    };
    // dead <pid> [<seconds>]: wait until a process is gone (or a zombie).
    // An empty pid is a failed fixture, never a dead process: fail, do not pass.
    // Bun's Subprocess carries pid at runtime; the bundled type omits it.
    const pidOf = (proc: object): number => (proc as { pid?: number }).pid ?? 0;
    const dead = (pid: number, secs = 60): boolean => {
      if (!pid || Number.isNaN(pid)) return false;
      let i = 0;
      while (alive(pid) && i < secs * 5) {
        run("sleep", ["0.2"]);
        i += 1;
      }
      return !alive(pid);
    };
    // waitLine <file> <pattern> [<seconds>]: wait until a file holds a matching line.
    const waitLine = (file: string, pattern: string, secs = 60): boolean => {
      let i = 0;
      while (i < secs * 5) {
        try {
          if (readFileSync(file, "utf8").includes(pattern)) return true;
        } catch {
          /* not yet */
        }
        run("sleep", ["0.2"]);
        i += 1;
      }
      return false;
    };
    // remaining <state-file>: seconds left on the round's deadline, or -1.
    const remaining = (stateFile: string): number => {
      try {
        const st = JSON.parse(readFileSync(stateFile, "utf8"));
        return Math.max(0, Math.ceil(st.deadline - monotonic()));
      } catch {
        return -1;
      }
    };
    const limit = (v: string): void => {
      writeFileSync(
        join(d, "run.json"),
        `{"config": {"review": {"round_timeout_seconds": ${v}}}}\n`,
      );
    };
    const cutScratch = (lens: string, lane: string): void => {
      run("git", [
        "-C",
        repo,
        "worktree",
        "add",
        "-q",
        "--detach",
        join(repo, ".worktrees", `T-1-rev-${lens}-${lane}`),
        "HEAD",
      ]);
    };
    const launch = (round: number, lens: string, lane: string, kind: string): void => {
      n += 1;
      const r = run(
        join(import.meta.dir, "run"),
        [
          "host",
          "run",
          `T-1 · ${lane} ${lens} review`,
          join(repo, ".worktrees", `T-1-rev-${lens}-${lane}`),
          "--under",
          d,
          "--role",
          "reviewer",
          "--run",
          d,
          "--marker",
          join(d, "logs", `review-r${round}-${lens}-${lane}.done`),
          "--pidfile",
          join(tmp, "pids", `launch.${n}`),
          "--",
          join(tmp, "reviewer.sh"),
          kind,
          join(tmp, "pids", `child.${n}`),
        ],
        { cwd: tmp },
      );
      if (r.code !== 0) {
        console.log(`  (could not launch ${lens} ${lane})`);
        return;
      }
      // run host run waits 10s for the launch pid itself; this covers a slower
      // runner, so an empty pid below means the launch failed, never that it lags.
      const launchPidFile = join(tmp, "pids", `launch.${n}`);
      let i = 0;
      while (i < 300) {
        try {
          if (readFileSync(launchPidFile, "utf8").trim()) break;
        } catch {
          /* not yet */
        }
        run("sleep", ["0.2"]);
        i += 1;
      }
      try {
        if (!readFileSync(launchPidFile, "utf8").trim()) {
          console.log(`  (the ${kind} reviewer's launch pid never appeared)`);
          return;
        }
      } catch {
        console.log(`  (the ${kind} reviewer's launch pid never appeared)`);
        return;
      }
      if (kind === "fast") return;
      // Child startup under load (was 5s); the pid file is the event.
      const childPidFile = join(tmp, "pids", `child.${n}`);
      i = 0;
      while (i < 300) {
        try {
          if (readFileSync(childPidFile, "utf8").trim()) break;
        } catch {
          /* not yet */
        }
        run("sleep", ["0.1"]);
        i += 1;
      }
      try {
        if (!readFileSync(childPidFile, "utf8").trim())
          console.log(`  (the ${kind} reviewer never started)`);
      } catch {
        console.log(`  (the ${kind} reviewer never started)`);
      }
    };

    console.log("positive controls");
    limit("3");
    cutScratch("bug", "one");
    cutScratch("bug", "two");
    runSelf("start", d, "1");
    check(
      "start clears the round's markers and fixes its limit from run.json",
      rc === 0 &&
        has("time limit 3s (review.round_timeout_seconds in run.json)") &&
        (() => {
          try {
            return statSync(join(d, "logs/review-r1.json")).size > 0;
          } catch {
            return false;
          }
        })(),
    );
    check(
      "the round attempt is sixteen hex digits, as BASE's urandom(8) writes it",
      (() => {
        try {
          const st = JSON.parse(readFileSync(join(d, "logs/review-r1.json"), "utf8"));
          return /^[0-9a-f]{16}$/u.test(st.attempt ?? "") && typeof st.boot === "string";
        } catch {
          return false;
        }
      })(),
    );
    launch(1, "bug", "one", "fast");
    launch(1, "bug", "two", "slow");
    let slow = 0;
    let child = 0;
    try {
      slow = parseInt(readFileSync(join(tmp, "pids", `launch.${n}`), "utf8").trim(), 10);
      child = parseInt(readFileSync(join(tmp, "pids", `child.${n}`), "utf8").trim(), 10);
    } catch {
      /* handled by checks */
    }
    // The sessioned child must be running before the stop: without this the
    // control below would pass on a machine where it never started.
    const childRanBeforeStop = child > 0 && alive(child);
    runSelf("wait", d, "1", repo, "bug:one bug:two");
    const waitOut = out;
    const waitRc = rc;
    check(
      "at the deadline, wait exits 3 and names the reviewer with no marker",
      rc === 3 &&
        has("WAIT-TIMEOUT") &&
        has("TIMEOUT bug two: DEGRADED, timeout") &&
        !has("TIMEOUT bug one"),
    );
    let runLog = "";
    try {
      runLog = readFileSync(join(d, "run-log.md"), "utf8");
    } catch {
      runLog = "";
    }
    check(
      "run-log.md records it as <lane> <lens>: DEGRADED, timeout",
      runLog.split("\n").some((l) => l.endsWith(" two bug: DEGRADED, timeout")),
    );
    check(
      "a degrade line records it, with the lens, the round and the cause",
      (() => {
        try {
          const aj = readFileSync(join(d, "actions.jsonl"), "utf8");
          return (
            aj.includes('"action":"degrade","target":"two","detail":"bug r1: timeout"') &&
            actionsLines('"action":"degrade"') === 1
          );
        } catch {
          return false;
        }
      })(),
    );
    check(
      "host.sh stop ends it, and its child in a session of its own",
      childRanBeforeStop && dead(slow, 60) && dead(child, 60),
    );
    runSelf("teardown", d, "1", repo);
    check(
      "teardown takes the reviewers the wait recorded, and removes each scratch",
      rc === 0 &&
        !existsSync(join(repo, ".worktrees/T-1-rev-bug-one")) &&
        !existsSync(join(repo, ".worktrees/T-1-rev-bug-two")) &&
        actionsLines('"action":"teardown"') === 2,
    );

    // The old timeout-1/sleep-1/took<=3 assumed prompt scheduling; under load the cap cut
    // the wait before it polled, or the second run outlasted its 3s window. Age a real deadline.
    limit("30");
    cutScratch("bug", "three");
    runSelf("start", d, "2");
    launch(2, "bug", "three", "slow");
    try {
      slow = parseInt(readFileSync(join(tmp, "pids", `launch.${n}`), "utf8").trim(), 10);
    } catch {
      /* ignore */
    }
    const readState2 = (): Record<string, unknown> => {
      try {
        return JSON.parse(readFileSync(join(d, "logs/review-r2.json"), "utf8")) as Record<
          string,
          unknown
        >;
      } catch {
        return {};
      }
    };
    const attempt0 = readState2().attempt;
    const deadline0 = readState2().deadline;
    const firstOut = join(tmp, "first.out");
    const first = Bun.spawn([
      "bash",
      "-c",
      `exec "${self}" review-round wait "${d}" 2 "${repo}" bug:three > "${firstOut}" 2>&1`,
    ]);
    const firstRc = waitLine(firstOut, "round 2,", 60);
    // Let some deadline age while the first wait runs, so a reset (left back to the limit) stands out.
    {
      let i = 0;
      while (remaining(join(d, "logs/review-r2.json")) > 25 && i < 150) {
        run("sleep", ["0.2"]);
        i += 1;
      }
    }
    try {
      first.kill();
    } catch {
      /* already gone */
    }
    dead(pidOf(first), 60);
    const left = remaining(join(d, "logs/review-r2.json"));
    runSelf("wait", d, "2", repo);
    check(
      "a wait run again keeps the round's deadline rather than starting a new one",
      firstRc &&
        rc === 3 &&
        has("TIMEOUT bug three") &&
        left < 28 &&
        took <= left + 25 &&
        readState2().attempt === attempt0 &&
        readState2().deadline === deadline0 &&
        dead(slow, 60),
    );
    runSelf("teardown", d, "2", repo, "bug:three");

    limit("60");
    cutScratch("style", "one");
    runSelf("start", d, "3");
    launch(3, "style", "one", "leaves");
    let childPid = 0;
    try {
      childPid = parseInt(readFileSync(join(tmp, "pids", `child.${n}`), "utf8").trim(), 10);
      cleanupPids.push(childPid);
    } catch {
      /* ignore */
    }
    runSelf("wait", d, "3", repo, "style:one");
    check(
      "when every marker is in, wait exits 0 and records nothing",
      rc === 0 && actionsLines('"action":"degrade"') === 2,
    );
    run("git", ["-C", join(repo, ".worktrees/T-1-rev-style-one"), "switch", "-q", "-c", "probe"]);
    runSelf("teardown", d, "3", repo, "style:one");
    check(
      "teardown stops what a finished reviewer's launch left running, and says so",
      rc === 0 && dead(childPid, 60) && has("left behind by a reviewer that had finished"),
    );
    check(
      "a scratch a reviewer switched onto a branch is still removed, and the branch kept",
      !existsSync(join(repo, ".worktrees/T-1-rev-style-one")) &&
        has("switched it onto branch probe") &&
        run("git", ["-C", repo, "rev-parse", "-q", "--verify", "refs/heads/probe"]).code === 0,
    );

    // A wall: both reviewers' launches end on their provider's usage limit, which the
    // launches recorded as `wall` lines before their markers landed (C11). The round
    // closes without them, each DEGRADED with the provider's message, and nothing escalates.
    limit("60");
    cutScratch("bug", "stub");
    cutScratch("security", "sec");
    runSelf("start", d, "5");
    launch(5, "bug", "stub", "fast");
    launch(5, "security", "sec", "fast");
    const codexWall = "You’ve hit your usage limit. try again at 2:29 AM.";
    const claudeWall = "You've hit your weekly limit · resets 3am (UTC)";
    appendFileSync(
      join(d, "actions.jsonl"),
      `${JSON.stringify({ ts: new Date().toISOString(), project: "p", run: "T-1", actor: "lane:stub", action: "wall", target: "stub", detail: `reviewer bug 5 none ${codexWall}` })}\n` +
        `${JSON.stringify({ ts: new Date().toISOString(), project: "p", run: "T-1", actor: "lane:sec", action: "wall", target: "sec", detail: `reviewer security 5 none ${claudeWall}` })}\n`,
    );
    runSelf("wait", d, "5", repo, "bug:stub security:sec");
    let wallRunLog = "";
    try {
      wallRunLog = readFileSync(join(d, "run-log.md"), "utf8");
    } catch {
      wallRunLog = "";
    }
    check(
      "a walled reviewer is DEGRADED with the provider's message and the round closes (C11)",
      rc === 0 &&
        wallRunLog.includes(`stub bug: DEGRADED, provider wall: "${codexWall}"`) &&
        wallRunLog.includes(`sec security: DEGRADED, provider wall: "${claudeWall}"`) &&
        has(`WALL bug stub: DEGRADED, provider wall: "${codexWall}"`) &&
        actionsLines('"action":"degrade"') === 4 &&
        actionsLines('"target":"stub","detail":"bug r5: provider wall:') === 1 &&
        actionsLines('"target":"sec","detail":"security r5: provider wall:') === 1 &&
        !existsSync(join(d, ".escalation-ready")),
    );

    console.log("negative controls");
    out = waitOut;
    rc = waitRc;
    check(
      "a reviewer that reported is neither recorded nor stopped",
      !has("TIMEOUT bug one") && !runLog.includes("one bug: DEGRADED"),
    );
    // The old limit-2/sleep-0.5 raced the re-start: a loaded machine could spend the whole
    // round before the stale waiter polled. Limit 20 leaves it room to stand down.
    limit("20");
    cutScratch("bug", "four");
    runSelf("start", d, "4");
    launch(4, "bug", "four", "slow");
    try {
      slow = parseInt(readFileSync(join(tmp, "pids", `launch.${n}`), "utf8").trim(), 10);
      cleanupPids.push(slow);
    } catch {
      /* ignore */
    }
    const staleOut = join(tmp, "stale.out");
    const staleRcFile = join(tmp, "stale.rc");
    const stale = Bun.spawn([
      "bash",
      "-c",
      `"${self}" review-round wait "${d}" 4 "${repo}" bug:four > "${staleOut}" 2>&1; echo $? > "${staleRcFile}"`,
    ]);
    // The wait must have read this start's attempt before the next start replaces it.
    const staleRc = waitLine(staleOut, "round 4,", 60);
    limit("60");
    runSelf("start", d, "4");
    dead(pidOf(stale), 120);
    let staleStdout = "";
    try {
      staleStdout = readFileSync(staleOut, "utf8");
    } catch {
      staleStdout = "";
    }
    out = staleStdout;
    try {
      rc = parseInt(readFileSync(staleRcFile, "utf8").trim(), 10);
      if (Number.isNaN(rc)) rc = 1;
    } catch {
      rc = 1;
    }
    check(
      "a wait from an earlier start of the round stands down, and records and stops nothing",
      staleRc &&
        rc === 1 &&
        has("started again") &&
        alive(slow) &&
        !runLog.includes("four bug: DEGRADED"),
    );
    const _insideOut = join(tmp, "inside.out");
    const insideR = run("bash", [
      "-c",
      `cd "$1" && "${self}" review-round teardown "${d}" 4 "${repo}" bug:four`,
      "_",
      join(repo, ".worktrees/T-1-rev-bug-four"),
    ]);
    out = insideR.out + insideR.err;
    rc = insideR.code;
    check(
      "teardown from inside a scratch leaves it in place, and stops nothing",
      rc === 1 &&
        has("LEFT IN PLACE") &&
        existsSync(join(repo, ".worktrees/T-1-rev-bug-four")) &&
        alive(slow),
    );
    runSelf("teardown", d, "4", repo, "bug:four");
    check(
      "from outside, teardown stops the unfinished reviewer first, says so, then removes it",
      rc === 0 &&
        dead(slow, 60) &&
        has("its reviewer had not finished") &&
        !existsSync(join(repo, ".worktrees/T-1-rev-bug-four")),
    );
    cutScratch("bug", "seven");
    runSelf("teardown", d, "12", repo, "bug:seven");
    check(
      "teardown given its reviewers needs no start, as at the cut, and records none for the round",
      rc === 0 &&
        !existsSync(join(repo, ".worktrees/T-1-rev-bug-seven")) &&
        !existsSync(join(d, "logs/review-r12.json")),
    );
    mkdirSync(join(repo, ".worktrees/T-1-rev-bug-five"), { recursive: true });
    runSelf("teardown", d, "4", repo, "bug:five");
    check(
      "a directory that is no scratch is left in place",
      rc === 1 &&
        has("it was not removed") &&
        (() => {
          try {
            return statSync(join(repo, ".worktrees/T-1-rev-bug-five")).isDirectory();
          } catch {
            return false;
          }
        })(),
    );
    run("git", [
      "-C",
      repo,
      "worktree",
      "add",
      "-q",
      "-b",
      "wb/T-1-luna",
      join(repo, ".worktrees/T-1-rev-style-two"),
      "HEAD",
    ]);
    runSelf("teardown", d, "4", repo, "style:two");
    check(
      "a worktree on the run's own branch is never detached or removed",
      rc === 1 &&
        has("LEFT IN PLACE") &&
        run("git", [
          "-C",
          join(repo, ".worktrees/T-1-rev-style-two"),
          "symbolic-ref",
          "-q",
          "--short",
          "HEAD",
        ]).out.trim() === "wb/T-1-luna",
    );
    writeFileSync(join(d, "logs/review-r6-bug-one.done"), "");
    writeFileSync(join(d, "logs/review-r6-style-one.done"), "");
    writeFileSync(
      join(d, "logs/review-r6.json"),
      JSON.stringify({
        attempt: "a",
        boot: "",
        limit: 1,
        source: "t",
        deadline: monotonic() + 1,
        reviewers: [],
      }),
    );
    runSelf("wait", d, "6", repo, "bug:one,bug:two");
    check(
      "a marker another reviewer landed never stands in for a missing one",
      rc === 1 && has("review-r6-style-one.done"),
    );
    writeFileSync(
      join(d, "logs/review-r7.json"),
      JSON.stringify({
        attempt: "a",
        boot: "another-boot",
        limit: 1,
        source: "t",
        deadline: monotonic() + 60,
        reviewers: [],
      }),
    );
    if (!skipBootId) {
      runSelf("wait", d, "7", repo, "bug:one");
      check(
        "a round started before the machine restarted is not waited on",
        rc === 1 && has("restarted"),
      );
    }
    runSelf("wait", d, "8", repo, "bug:one");
    check("a round that was never started is not waited on", rc === 1 && has("round not started"));
    for (const v of ['"7"', "0", "-3", "true", "1.5", "86401"]) {
      limit(v);
      runSelf("start", d, "9");
      check(
        `a limit of ${v} is not used: the default, and the warning says why`,
        rc === 0 &&
          has("time limit 2400s (the default)") &&
          has("not a whole number of seconds from 1 to 86400"),
      );
    }
    rmSync(join(d, "run.json"), { force: true });
    runSelf("start", d, "9");
    check(
      "no run.json gets the default, and says so",
      rc === 0 && has("no run.json") && has("time limit 2400s"),
    );
    limit("1");
    cutScratch("bug", "six");
    runSelf("start", d, "10");
    if (!skipRoot) {
      chmodSync(join(d, "actions.jsonl"), 0o444);
      runSelf("wait", d, "10", repo, "bug:six");
      chmodSync(join(d, "actions.jsonl"), 0o644);
      check(
        "a timeout whose degrade line cannot be written exits 4, and says what was not recorded",
        rc === 4 && has("NOT RECORDED in actions.jsonl"),
      );
    }
    runSelf("teardown", d, "10", repo, "bug:six");
    runSelf("start", d, "11");
    const refusedArgs = [
      `wait ${d} 11 ${repo} bug`,
      `wait ${d} 11 ${repo} bug:../x`,
      `wait ${d} 0 ${repo} bug:one`,
      `wait ${tmp}/nowhere 1 ${repo} bug:one`,
      `wait ${d} 11 ${tmp}/elsewhere bug:one`,
      `stop ${d} 11 ${repo} bug:one`,
      `start ${d}`,
    ];
    for (const argsStr of refusedArgs) {
      runSelf(...argsStr.split(" "));
      check(`refused: review-round.sh ${argsStr.replaceAll(tmp, "<tmp>")}`, rc === 1);
    }
    runSelf("wait", d, "11", repo, "bug:one\nbug:one security:two");
    check(
      "reviewers on several lines, one given twice, are each waited on once",
      rc === 3 && has("round 11, 2 reviewers"),
    );

    run("chmod", ["-R", "u+w", tmp]);
    killPids();
  });
}, 300000);

afterAll(() => {
  killPids();
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("reviewer pairs", () => {
  test("reviewer pairs split on U+001C", () => {
    assertControl("reviewer pairs split on U+001C");
  });
});

describe("positive controls", () => {
  const labels = [
    "start clears the round's markers and fixes its limit from run.json",
    "the round attempt is sixteen hex digits, as BASE's urandom(8) writes it",
    "at the deadline, wait exits 3 and names the reviewer with no marker",
    "run-log.md records it as <lane> <lens>: DEGRADED, timeout",
    "a degrade line records it, with the lens, the round and the cause",
    "host.sh stop ends it, and its child in a session of its own",
    "teardown takes the reviewers the wait recorded, and removes each scratch",
    "a wait run again keeps the round's deadline rather than starting a new one",
    "when every marker is in, wait exits 0 and records nothing",
    "teardown stops what a finished reviewer's launch left running, and says so",
    "a scratch a reviewer switched onto a branch is still removed, and the branch kept",
    "a walled reviewer is DEGRADED with the provider's message and the round closes (C11)",
  ];
  for (const label of labels) {
    test(label, () => {
      assertControl(label);
    });
  }
});

describe("negative controls", () => {
  test("a reviewer that reported is neither recorded nor stopped", () => {
    assertControl("a reviewer that reported is neither recorded nor stopped");
  });
  test("a wait from an earlier start of the round stands down, and records and stops nothing", () => {
    assertControl(
      "a wait from an earlier start of the round stands down, and records and stops nothing",
    );
  });
  test("teardown from inside a scratch leaves it in place, and stops nothing", () => {
    assertControl("teardown from inside a scratch leaves it in place, and stops nothing");
  });
  test("from outside, teardown stops the unfinished reviewer first, says so, then removes it", () => {
    assertControl(
      "from outside, teardown stops the unfinished reviewer first, says so, then removes it",
    );
  });
  test("teardown given its reviewers needs no start, as at the cut, and records none for the round", () => {
    assertControl(
      "teardown given its reviewers needs no start, as at the cut, and records none for the round",
    );
  });
  test("a directory that is no scratch is left in place", () => {
    assertControl("a directory that is no scratch is left in place");
  });
  test("a worktree on the run's own branch is never detached or removed", () => {
    assertControl("a worktree on the run's own branch is never detached or removed");
  });
  test("a marker another reviewer landed never stands in for a missing one", () => {
    assertControl("a marker another reviewer landed never stands in for a missing one");
  });
  test.skipIf(skipBootId)("a round started before the machine restarted is not waited on", () => {
    assertControl("a round started before the machine restarted is not waited on");
  });
  test("a round that was never started is not waited on", () => {
    assertControl("a round that was never started is not waited on");
  });
  for (const v of ['"7"', "0", "-3", "true", "1.5", "86401"]) {
    const label = `a limit of ${v} is not used: the default, and the warning says why`;
    test(label, () => {
      assertControl(label);
    });
  }
  test("no run.json gets the default, and says so", () => {
    assertControl("no run.json gets the default, and says so");
  });
  test.skipIf(skipRoot)(
    "a timeout whose degrade line cannot be written exits 4, and says what was not recorded",
    () => {
      assertControl(
        "a timeout whose degrade line cannot be written exits 4, and says what was not recorded",
      );
    },
  );
  const refused = [
    "refused: review-round.sh wait <tmp>/repo/.postmaster/runs/T-1 11 <tmp>/repo bug",
    "refused: review-round.sh wait <tmp>/repo/.postmaster/runs/T-1 11 <tmp>/repo bug:../x",
    "refused: review-round.sh wait <tmp>/repo/.postmaster/runs/T-1 0 <tmp>/repo bug:one",
    "refused: review-round.sh wait <tmp>/nowhere 1 <tmp>/repo bug:one",
    "refused: review-round.sh wait <tmp>/repo/.postmaster/runs/T-1 11 <tmp>/elsewhere bug:one",
    "refused: review-round.sh stop <tmp>/repo/.postmaster/runs/T-1 11 <tmp>/repo bug:one",
    "refused: review-round.sh start <tmp>/repo/.postmaster/runs/T-1",
  ];
  for (const label of refused) {
    test(label, () => {
      assertControl(label);
    });
  }
  test("reviewers on several lines, one given twice, are each waited on once", () => {
    assertControl("reviewers on several lines, one given twice, are each waited on once");
  });
});

describe("the round's three steps", () => {
  interface Call {
    name: string;
    args: string[];
  }
  type Handler = (name: string, args: string[]) => StepChild | null;

  /** A stand-in for every script and git the steps run: each call recorded, each answer from the handler. */
  function stand(handler?: Handler): { calls: Call[]; deps: StepDeps } {
    const calls: Call[] = [];
    const answer = (name: string, args: string[]): StepChild =>
      handler?.(name, args) ?? { code: 0, out: "", err: "" };
    const deps: StepDeps = {
      tool: (name, args) => {
        calls.push({ name, args });
        return answer(name, args);
      },
      git: (args) => {
        calls.push({ name: "git", args });
        return answer("git", args);
      },
    };
    return { calls, deps };
  }

  const paths = (root: string): { dispatch: string; repo: string; synthesis: string } => {
    const dispatch = join(root, "repo", ".postmaster", "runs", "T-1");
    mkdirSync(join(dispatch, "logs"), { recursive: true });
    writeFileSync(join(dispatch, "manifest.json"), `${JSON.stringify({ base: "BASESHA" })}\n`);
    return {
      dispatch,
      repo: join(root, "repo"),
      synthesis: join(root, "repo", ".worktrees", "T-1"),
    };
  };

  const allLenses: Handler = (name) =>
    name === "turnpikes"
      ? { code: 0, out: "1 synthesis\n2 review style bug security\n", err: "" }
      : null;
  const oneLane: Handler = (name, args) =>
    name === "reviewers" && args[0] === "lanes" ? { code: 0, out: "luna\n", err: "" } : null;
  const snapshot: Handler = (name, args) =>
    name === "git" && args.includes("rev-parse") ? { code: 0, out: "SNAP\n", err: "" } : null;
  const green: Handler = (name, args) =>
    allLenses(name, args) ??
    oneLane(name, args) ??
    snapshot(name, args) ??
    (name === "verify" ? { code: 0, out: "gate: pass\n", err: "" } : null);

  const of = (calls: Call[], name: string): Call[] => calls.filter((c) => c.name === name);
  const one = (calls: Call[], name: string, pick?: (c: Call) => boolean): Call | undefined =>
    calls.find((c) => c.name === name && (pick?.(c) ?? true));

  describe("cut", () => {
    test("verifies, logs the gate, prunes, resolves each lens and cuts each scratch", () => {
      withTempDir((root) => {
        const p = paths(root);
        const { calls, deps } = stand(green);
        const res = cutRound(
          { dispatch: p.dispatch, round: "1", repo: p.repo, synthesis: p.synthesis },
          deps,
        );
        expect(res.code).toBe(0);
        expect(readFileSync(join(p.dispatch, "logs", "review-r1-checks.txt"), "utf8")).toBe(
          "gate: pass\n",
        );
        expect(res.out).toContain("gate: pass");
        expect(one(calls, "verify")?.args).toEqual(["run", p.synthesis, p.dispatch]);
        expect(one(calls, "log-action", (c) => c.args[2] === "gate")?.args).toEqual([
          p.dispatch,
          "coachman",
          "gate",
          "SNAP",
          "review round 1, run verify exit 0",
        ]);
        expect(one(calls, "git", (c) => c.args.includes("prune"))?.args).toEqual([
          "-C",
          p.repo,
          "worktree",
          "prune",
        ]);
        expect(of(calls, "reviewers").map((c) => c.args[2])).toEqual(["style", "bug", "security"]);
        const cuts = of(calls, "cut-scratch");
        expect(cuts.length).toBe(3);
        for (const lens of ["style", "bug", "security"]) {
          const cut = cuts.find(
            (c) => c.args[2] === join(p.repo, ".worktrees", `T-1-rev-${lens}-luna`),
          );
          expect(cut?.args).toEqual([
            p.repo,
            p.synthesis,
            join(p.repo, ".worktrees", `T-1-rev-${lens}-luna`),
            "SNAP",
            "--clone",
            "BASESHA",
          ]);
        }
      }, "review-round-cut-");
    });

    test("on exit 3 each not-run line and its reason lines go to the run log, and the round goes on", () => {
      withTempDir((root) => {
        const p = paths(root);
        const { calls, deps } = stand((name, args) => {
          if (name === "verify")
            return {
              code: 3,
              out: "journey: not run, exit 3, no journey\n  no User journey on the ticket\nsecurity: pass\n",
              err: "",
            };
          return green(name, args);
        });
        const res = cutRound(
          { dispatch: p.dispatch, round: "2", repo: p.repo, synthesis: p.synthesis },
          deps,
        );
        expect(res.code).toBe(0);
        expect(of(calls, "run-log").map((c) => c.args[1])).toEqual([
          "review round 2 gate not run: journey: not run, exit 3, no journey",
          "review round 2 gate not run:   no User journey on the ticket",
        ]);
        expect(of(calls, "cut-scratch").length).toBe(2);
      }, "review-round-cut3-");
    });

    test("any other verify exit stops the round before the prune", () => {
      withTempDir((root) => {
        const p = paths(root);
        const { calls, deps } = stand((name, args) =>
          name === "verify" ? { code: 2, out: "security: fail\n", err: "" } : green(name, args),
        );
        const res = cutRound(
          { dispatch: p.dispatch, round: "1", repo: p.repo, synthesis: p.synthesis },
          deps,
        );
        expect(res.code).toBe(1);
        expect(res.out).toContain("security: fail");
        expect(one(calls, "log-action", (c) => c.args[2] === "gate")?.args).toEqual([
          p.dispatch,
          "coachman",
          "gate",
          "SNAP",
          "review round 1, run verify exit 2",
        ]);
        expect(of(calls, "git").some((c) => c.args.includes("prune"))).toBe(false);
        expect(of(calls, "reviewers").length).toBe(0);
        expect(of(calls, "cut-scratch").length).toBe(0);
      }, "review-round-cut2-");
    });

    test("an unwritable checks file stops it before verify runs, with no gate record", () => {
      withTempDir((root) => {
        const p = paths(root);
        const checks = join(p.dispatch, "logs", "review-r1-checks.txt");
        mkdirSync(checks);
        let verified = false;
        const { calls, deps } = stand((name, args) => {
          if (name === "verify") verified = true;
          return green(name, args);
        });
        const res = cutRound(
          { dispatch: p.dispatch, round: "1", repo: p.repo, synthesis: p.synthesis },
          deps,
        );
        expect(res.code).toBe(1);
        expect(verified).toBe(false);
        expect(of(calls, "log-action").length).toBe(0);
        expect(res.err.join("\n")).toContain(`${checks} cannot be written`);
        expect(of(calls, "git").some((c) => c.args.includes("prune"))).toBe(false);
      }, "review-round-cutwrite-");
    });

    test("a checks file lost after a green verify still stops it, on a true gate record", () => {
      withTempDir((root) => {
        const p = paths(root);
        const checks = join(p.dispatch, "logs", "review-r1-checks.txt");
        const { calls, deps } = stand((name, args) => {
          if (name === "verify") {
            chmodSync(checks, 0o444);
            return { code: 0, out: "gate: pass\n", err: "" };
          }
          return green(name, args);
        });
        const res = cutRound(
          { dispatch: p.dispatch, round: "1", repo: p.repo, synthesis: p.synthesis },
          deps,
        );
        chmodSync(checks, 0o644);
        expect(res.code).toBe(1);
        expect(one(calls, "log-action", (c) => c.args[2] === "gate")?.args[4]).toBe(
          "review round 1, run verify exit 0",
        );
        expect(res.err.join("\n")).toContain(`${checks} cannot be written`);
        expect(of(calls, "git").some((c) => c.args.includes("prune"))).toBe(false);
        expect(of(calls, "cut-scratch").length).toBe(0);
      }, "review-round-cutwrite2-");
    });

    test("a lens whose lanes do not resolve stops it after the prune", () => {
      withTempDir((root) => {
        const p = paths(root);
        const { calls, deps } = stand((name, args) => {
          if (name === "reviewers" && args[2] === "security")
            return { code: 2, out: "", err: "no such waybill line\n" };
          return green(name, args);
        });
        const res = cutRound(
          { dispatch: p.dispatch, round: "1", repo: p.repo, synthesis: p.synthesis },
          deps,
        );
        expect(res.code).toBe(1);
        expect(res.err).toContain("no such waybill line");
        expect(of(calls, "git").some((c) => c.args.includes("prune"))).toBe(true);
        expect(of(calls, "cut-scratch").length).toBe(0);
      }, "review-round-cutlens-");
    });

    test("a scratch left behind is named, torn down alone, and a failed teardown stops the cut", () => {
      withTempDir((root) => {
        const p = paths(root);
        const left = join(p.repo, ".worktrees", "T-1-rev-style-luna");
        mkdirSync(left, { recursive: true });
        const { calls, deps } = stand((name, args) => {
          if (name === "git" && args[2] === "diff")
            return { code: 0, out: "src/app.js\nsrc/app.test.js\n", err: "" };
          if (name === "review-round" && args[0] === "teardown")
            return { code: 1, out: "LEFT IN PLACE\n", err: "it could not be stopped\n" };
          return green(name, args);
        });
        const res = cutRound(
          { dispatch: p.dispatch, round: "1", repo: p.repo, synthesis: p.synthesis },
          deps,
        );
        expect(res.code).toBe(1);
        expect(res.out).toContain(`LEFT BEHIND AND MODIFIED, ${left}: src/app.js`);
        expect(res.out).toContain(`LEFT BEHIND AND MODIFIED, ${left}: src/app.test.js`);
        expect(res.out).toContain("LEFT IN PLACE");
        expect(of(calls, "review-round").map((c) => c.args[0])).toEqual(["teardown"]);
        expect(of(calls, "cut-scratch").length).toBe(0);
      }, "review-round-cutleft-");
    });

    test("a scratch that will not cut prints SCRATCH BROKEN and the cut goes on", () => {
      withTempDir((root) => {
        const p = paths(root);
        const { calls, deps } = stand((name, args) =>
          name === "cut-scratch"
            ? { code: 1, out: "", err: "git could not create it\n" }
            : green(name, args),
        );
        const res = cutRound(
          { dispatch: p.dispatch, round: "1", repo: p.repo, synthesis: p.synthesis },
          deps,
        );
        expect(res.code).toBe(0);
        expect(res.err).toContain("git could not create it");
        expect(res.out.filter((l) => l.startsWith("SCRATCH BROKEN:")).length).toBe(3);
        expect(res.out[1]).toContain(
          `SCRATCH BROKEN: ${join(p.repo, ".worktrees", "T-1-rev-style-luna")} is not cut at SNAP; fix before launching luna under style`,
        );
        expect(of(calls, "cut-scratch").length).toBe(3);
      }, "review-round-cutbroken-");
    });
  });

  describe("launch", () => {
    const entry = join(import.meta.dir, "run");

    test("writes every prompt file, launches each reviewer under its lens, and ends in the wait", () => {
      withTempDir((root) => {
        const p = paths(root);
        const { calls, deps } = stand((name, args) => {
          if (name === "launch" && args[0] === "skill")
            return { code: 0, out: "SECURITY TEXT\n", err: "" };
          if (name === "host" && args[0] === "name")
            return { code: 0, out: `${args[4]}-name\n`, err: "" };
          if (name === "review-round" && args[0] === "wait")
            return { code: 0, out: "round 1: every marker in\n", err: "" };
          return green(name, args);
        });
        const res = launchRound(
          { dispatch: p.dispatch, round: "1", repo: p.repo, synthesis: p.synthesis },
          deps,
        );
        expect(res.code).toBe(0);
        expect(res.out).toContain("round 1: every marker in");
        expect(readFileSync(join(p.dispatch, "review-r1-style-prompt.txt"), "utf8")).toBe(
          `Read ${p.dispatch}/review-style-brief.md and execute it. Report findings as your final message. Do not modify any file you are reviewing.\n`,
        );
        expect(readFileSync(join(p.dispatch, "review-r1-security-prompt.txt"), "utf8")).toContain(
          `Read ${p.dispatch}/review-security-brief.md`,
        );
        expect(readFileSync(join(p.dispatch, "review-r1-security-luna-prompt.txt"), "utf8")).toBe(
          "SECURITY TEXT\n",
        );
        expect(existsSync(join(p.dispatch, "review-r1-bug-prompt.txt"))).toBe(false);
        const startAt = calls.findIndex((c) => c.name === "review-round" && c.args[0] === "start");
        const checks = of(calls, "cut-scratch").filter((c) => c.args[0] === "--check");
        expect(checks.length).toBe(3);
        expect(checks.every((c) => c.args.includes("--clone"))).toBe(true);
        expect(checks.every((c) => calls.indexOf(c) < startAt)).toBe(true);
        const runs = of(calls, "host").filter((c) => c.args[0] === "run");
        expect(runs.length).toBe(3);
        const styleScratch = join(p.repo, ".worktrees", "T-1-rev-style-luna");
        // An exact scratch argument, never a substring: the entry path carries the
        // checkout's own directory, which may itself hold a -rev-<lens>- segment.
        const style = runs.find((c) => c.args.includes(styleScratch));
        expect(style?.args).toEqual([
          "run",
          "style-name",
          styleScratch,
          "--under",
          p.dispatch,
          "--role",
          "reviewer",
          "--run",
          p.dispatch,
          "--out",
          join(p.dispatch, "logs", "review-r1-style-luna.jsonl"),
          "--err",
          join(p.dispatch, "logs", "review-r1-style-luna.err"),
          "--marker",
          join(p.dispatch, "logs", "review-r1-style-luna.done"),
          "--",
          entry,
          "launch",
          "launch",
          "luna",
          styleScratch,
          join(p.dispatch, "review-r1-style-prompt.txt"),
          "--run",
          p.dispatch,
        ]);
        const bugScratch = join(p.repo, ".worktrees", "T-1-rev-bug-luna");
        const bug = runs.find((c) => c.args.includes(bugScratch));
        expect(bug?.args.join(" ")).toContain(`${entry} launch review luna`);
        expect(bug?.args.join(" ")).toContain("BASESHA");
        expect(bug?.args.join(" ")).toContain(
          join(p.dispatch, "logs", "review-r1-bug-luna-last.md"),
        );
        expect(bug?.args.join(" ")).toContain("--run");
        const wait = calls.find((c) => c.name === "review-round" && c.args[0] === "wait");
        expect(wait?.args).toEqual([
          "wait",
          p.dispatch,
          "1",
          p.repo,
          "style:luna",
          "bug:luna",
          "security:luna",
        ]);
        expect(calls.indexOf(wait!)).toBeGreaterThan(calls.indexOf(runs[2]!));
      }, "review-round-launch-");
    });

    test("logs one review-launch per lane per lens per round, targeting the lane", () => {
      withTempDir((root) => {
        const p = paths(root);
        const { calls, deps } = stand((name, args) => {
          if (name === "launch" && args[0] === "skill")
            return { code: 0, out: "SECURITY TEXT\n", err: "" };
          return green(name, args);
        });
        const res = launchRound(
          { dispatch: p.dispatch, round: "1", repo: p.repo, synthesis: p.synthesis },
          deps,
        );
        expect(res.code).toBe(0);
        const launches = of(calls, "log-action").filter((c) => c.args[2] === "review-launch");
        expect(launches.map((c) => c.args)).toEqual([
          [p.dispatch, "coachman", "review-launch", "luna", "style round 1"],
          [p.dispatch, "coachman", "review-launch", "luna", "bug round 1"],
          [p.dispatch, "coachman", "review-launch", "luna", "security round 1"],
        ]);
      }, "review-round-launchrows-");
    });

    test("a scratch that is not ready stops it before the round starts", () => {
      withTempDir((root) => {
        const p = paths(root);
        const { calls, deps } = stand((name, args) => {
          if (name === "cut-scratch" && args[0] === "--check" && args[1]?.includes("-rev-bug-"))
            return { code: 1, out: "", err: "HEAD is not the snapshot\n" };
          return green(name, args);
        });
        const res = launchRound(
          { dispatch: p.dispatch, round: "1", repo: p.repo, synthesis: p.synthesis },
          deps,
        );
        expect(res.code).toBe(1);
        expect(res.out).toContain(`SCRATCH NOT READY: T-1-rev-bug-luna; nothing launched`);
        expect(of(calls, "review-round").length).toBe(0);
        expect(of(calls, "host").length).toBe(0);
      }, "review-round-launchready-");
    });

    test("a lane with no security prompt stops it with nothing launched", () => {
      withTempDir((root) => {
        const p = paths(root);
        const { calls, deps } = stand((name, args) => {
          if (name === "launch" && args[0] === "skill")
            return { code: 1, out: "", err: "no such skill\n" };
          return green(name, args);
        });
        const res = launchRound(
          { dispatch: p.dispatch, round: "1", repo: p.repo, synthesis: p.synthesis },
          deps,
        );
        expect(res.code).toBe(1);
        expect(res.out).toContain("NO SECURITY PROMPT FOR luna; nothing launched");
        expect(res.err).toContain("no such skill");
        expect(of(calls, "review-round").length).toBe(0);
        expect(of(calls, "host").length).toBe(0);
      }, "review-round-launchsec-");
    });

    test("a lane with no security skill of its own gets a copy of the lens prompt", () => {
      withTempDir((root) => {
        const p = paths(root);
        const { deps } = stand((name, args) => {
          if (name === "launch" && args[0] === "skill") return { code: 3, out: "", err: "" };
          return green(name, args);
        });
        const res = launchRound(
          { dispatch: p.dispatch, round: "1", repo: p.repo, synthesis: p.synthesis },
          deps,
        );
        expect(res.code).toBe(0);
        expect(readFileSync(join(p.dispatch, "review-r1-security-luna-prompt.txt"), "utf8")).toBe(
          readFileSync(join(p.dispatch, "review-r1-security-prompt.txt"), "utf8"),
        );
      }, "review-round-launchsec3-");
    });

    test("a round that will not start launches nothing, and the wait's exit is the launch's", () => {
      withTempDir((root) => {
        const p = paths(root);
        const failed = stand((name, args) =>
          name === "review-round" && args[0] === "start"
            ? { code: 1, out: "", err: "round not started\n" }
            : green(name, args),
        );
        const res = launchRound(
          { dispatch: p.dispatch, round: "1", repo: p.repo, synthesis: p.synthesis },
          failed.deps,
        );
        expect(res.code).toBe(1);
        expect(of(failed.calls, "host").length).toBe(0);

        const timed = stand((name, args) =>
          name === "review-round" && args[0] === "wait"
            ? { code: 3, out: "WAIT-TIMEOUT\n", err: "" }
            : green(name, args),
        );
        const res2 = launchRound(
          { dispatch: p.dispatch, round: "1", repo: p.repo, synthesis: p.synthesis },
          timed.deps,
        );
        expect(res2.code).toBe(3);
        expect(res2.out).toContain("WAIT-TIMEOUT");
      }, "review-round-launchstart-");
    });

    test("round 2 runs the gating lenses alone", () => {
      withTempDir((root) => {
        const p = paths(root);
        const { calls, deps } = stand(green);
        const res = launchRound(
          { dispatch: p.dispatch, round: "2", repo: p.repo, synthesis: p.synthesis },
          deps,
        );
        expect(res.code).toBe(0);
        expect(of(calls, "reviewers").map((c) => c.args[2])).toEqual(["bug", "security"]);
        expect(existsSync(join(p.dispatch, "review-r2-style-prompt.txt"))).toBe(false);
      }, "review-round-launchr2-");
    });
  });

  describe("harvest", () => {
    test("a report that will not harvest degrades the lane and skips the normalizer", () => {
      withTempDir((root) => {
        const p = paths(root);
        const { calls, deps } = stand((name, args) => {
          if (name === "reviewers") return { code: 0, out: "one\n", err: "" };
          if (name === "review-findings" && args[0] === "harvest")
            return { code: 1, out: "", err: "no result line\n" };
          return null;
        });
        const res = harvestRound({ dispatch: p.dispatch, round: "9", repo: p.repo }, deps);
        expect(res.code).toBe(0);
        expect(one(calls, "log-action", (c) => c.args[2] === "degrade")?.args).toEqual([
          p.dispatch,
          "coachman",
          "degrade",
          "one",
          "bug round 9: no result line",
        ]);
        expect(one(calls, "run-log", (c) => (c.args[1] ?? "").includes("DEGRADED"))?.args).toEqual([
          p.dispatch,
          "one bug: DEGRADED, no result line",
        ]);
        expect(of(calls, "review-findings").filter((c) => c.args[0] === "normalize").length).toBe(
          0,
        );
      }, "review-round-harvest-");
    });

    test("a report the normalizer cannot read is removed and named in the run log", () => {
      withTempDir((root) => {
        const p = paths(root);
        const { calls, deps } = stand((name, args) => {
          if (name === "reviewers") return { code: 0, out: "one\n", err: "" };
          if (name === "review-findings" && args[0] === "normalize")
            return { code: 1, out: '{"half":', err: "not JSON\n" };
          return null;
        });
        const res = harvestRound({ dispatch: p.dispatch, round: "9", repo: p.repo }, deps);
        expect(res.code).toBe(0);
        expect(existsSync(join(p.dispatch, "logs", "review-r9-bug-one-findings.json"))).toBe(false);
        expect(
          one(calls, "run-log", (c) => (c.args[1] ?? "").includes("normalize failed"))?.args,
        ).toEqual([
          p.dispatch,
          "review round 9 one: normalize failed; reading the raw report by hand",
        ]);
        expect(res.err).toContain("not JSON");
      }, "review-round-harvestnorm-");
    });

    test("a clean harvest writes the findings file and logs nothing", () => {
      withTempDir((root) => {
        const p = paths(root);
        const { calls, deps } = stand((name, args) => {
          if (name === "reviewers") return { code: 0, out: "one\n", err: "" };
          if (name === "review-findings" && args[0] === "normalize")
            return { code: 0, out: '[{"file":"a.ts"}]', err: "" };
          return null;
        });
        const res = harvestRound({ dispatch: p.dispatch, round: "9", repo: p.repo }, deps);
        expect(res.code).toBe(0);
        expect(
          readFileSync(join(p.dispatch, "logs", "review-r9-bug-one-findings.json"), "utf8"),
        ).toBe('[{"file":"a.ts"}]');
        expect(of(calls, "run-log").length).toBe(0);
        const normalize = of(calls, "review-findings").find((c) => c.args[0] === "normalize");
        expect(normalize?.args).toEqual([
          "normalize",
          "one",
          join(p.repo, ".worktrees", "T-1-rev-bug-one"),
          join(p.dispatch, "logs", "review-r9-bug-one.jsonl"),
          "--last",
          join(p.dispatch, "logs", "review-r9-bug-one-last.md"),
          "--run",
          p.dispatch,
        ]);
      }, "review-round-harvestok-");
    });
  });
});

// Teardown waits for the round's reach check: the round's own teardown, which names no reviewers,
// does not run before a reach check named for a round that took its reach snapshot. These need no
// sequence, only a fresh run.
const pointLine = (point: string): string =>
  JSON.stringify({
    ts: "2026-10-09T00:00:00Z",
    actor: "coachman",
    action: "reach",
    target: point,
    detail: JSON.stringify({ kind: "point", point, result: "clean" }),
  });

interface Torn {
  code: number;
  out: string;
  actions: string;
  runLog: string;
}

/** Start round 1 of a fresh run with one reviewer, then `review-round teardown` it, naming it or not. */
function teardown(snapshot: boolean, actions: string[], named: boolean): Torn {
  return withTempDir((tmp) => {
    const repo = join(tmp, "repo");
    const dispatch = join(repo, ".postmaster", "runs", "T-1");
    mkdirSync(dispatch, { recursive: true });
    run("git", ["init", "-q", "-b", "main", repo]);
    run(self, ["review-round", "start", dispatch, "1"]);
    const statePath = join(dispatch, "logs", "review-r1.json");
    const state = JSON.parse(readFileSync(statePath, "utf8")) as Record<string, unknown>;
    writeFileSync(statePath, JSON.stringify({ ...state, reviewers: [["bug", "luna"]] }));
    if (snapshot) {
      mkdirSync(join(dispatch, "reach"), { recursive: true });
      writeFileSync(join(dispatch, "reach", "before-r1.json"), "{}\n");
    }
    if (actions.length > 0)
      writeFileSync(join(dispatch, "actions.jsonl"), `${actions.join("\n")}\n`);
    const r = run(self, [
      "review-round",
      "teardown",
      dispatch,
      "1",
      repo,
      ...(named ? ["bug:luna"] : []),
    ]);
    const read = (name: string): string => {
      try {
        return readFileSync(join(dispatch, name), "utf8");
      } catch {
        return "";
      }
    };
    return {
      code: r.code,
      out: r.out + r.err,
      actions: read("actions.jsonl"),
      runLog: read("run-log.md"),
    };
  });
}

describe("reachCheckMissing", () => {
  test("it waits only for the round's own teardown of a round with no point of its own", () => {
    expect(reachCheckMissing(true, [], "1")).toBe(true);
    expect(reachCheckMissing(true, ["r2", "card"], "1")).toBe(true);
    expect(reachCheckMissing(true, ["r1"], "1")).toBe(false);
    expect(reachCheckMissing(true, ["workhorses", "r1", "r2"], "2")).toBe(false);
    expect(reachCheckMissing(false, [], "1")).toBe(false);
    expect(reachCheckMissing(false, ["r1"], "1")).toBe(false);
  });
});

describe("teardown and the round's reach check", () => {
  test("a round with a reach snapshot and no reach check is not torn down, and says why", () => {
    const t = teardown(true, [], false);
    expect(t.code).toBe(1);
    expect(t.out).toContain("no reach check r1 is recorded: nothing was removed");
    expect(t.actions).toContain("r1: teardown waits for the reach check");
    expect(t.runLog).not.toContain("round 1: removed");
  });

  test("with the round's reach check recorded, the same teardown goes on", () => {
    const t = teardown(true, [pointLine("r1")], false);
    expect(t.code).toBe(0);
    expect(t.out).not.toContain("no reach check");
    expect(t.runLog).toContain("round 1: removed 0 of 1 scratches, 1 already gone");
  });

  test("a check recorded for another round does not stand in for this one", () => {
    const t = teardown(true, [pointLine("r2"), pointLine("card")], false);
    expect(t.code).toBe(1);
    expect(t.out).toContain("no reach check r1 is recorded");
  });

  test("a round that took no reach snapshot is torn down as before", () => {
    const t = teardown(false, [], false);
    expect(t.code).toBe(0);
    expect(t.runLog).toContain("round 1: removed 0 of 1 scratches, 1 already gone");
  });

  test("a scratch an interrupted round left behind is cleaned up by name, with no check", () => {
    const t = teardown(true, [], true);
    expect(t.code).toBe(0);
    expect(t.out).toContain("no scratch at");
    expect(t.out).not.toContain("no reach check");
  });

  test("an unreadable reach record stops the teardown and is named", () => {
    const t = teardown(
      true,
      [JSON.stringify({ ts: "2026-10-09T00:00:00Z", action: "reach", detail: "not json" })],
      false,
    );
    expect(t.code).toBe(1);
    expect(t.out).toContain("cannot read the reach record to teardown round 1");
    expect(t.runLog).not.toContain("round 1: removed");
  });
});
