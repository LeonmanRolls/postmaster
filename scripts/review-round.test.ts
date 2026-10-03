// Tests beside scripts/review-round.ts, moved from its --self-test on #109: 38 controls.
// The sequence runs once in beforeAll with a recording check(); one test per recorded label.
// Skip branches use the top-level conds; their in-sequence skip logs are replaced by those notices.
// The process-exit cleanup is an afterAll; withTempDir still owns the temp dir.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
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
import { ARG_SPLIT_RE, monotonic } from "./review-round.ts";

const self = join(import.meta.dir, "review-round.sh");

const skipBootId = !existsSync("/proc/sys/kernel/random/boot_id");
if (skipBootId) {
  console.log(
    "skip a round started before the machine restarted is not waited on: no /proc/sys/kernel/random/boot_id",
  );
}
const skipRoot = process.getuid?.() === 0;
if (skipRoot) {
  console.log(
    "skip a timeout whose degrade line cannot be written exits 4, and says what was not recorded: root writes anywhere",
  );
}

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
  slow) setsid sleep 300 & echo $! > "$2"; exec sleep 300 ;;
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
      const r = run(self, args);
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
      try {
        const r = run("ps", ["-o", "stat=", "-p", String(pid)]);
        const s = r.out.trim();
        return s !== "" && !s.startsWith("Z");
      } catch {
        return false;
      }
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
        join(import.meta.dir, "host.sh"),
        [
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
      // host.sh run waits 10s for the launch pid itself; this covers a slower
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
      dead(slow, 60) && dead(child, 60),
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
    const readState2 = (): Record<string, any> => {
      try {
        return JSON.parse(readFileSync(join(d, "logs/review-r2.json"), "utf8"));
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
      `exec "${self}" wait "${d}" 2 "${repo}" bug:three > "${firstOut}" 2>&1`,
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
      `"${self}" wait "${d}" 4 "${repo}" bug:four > "${staleOut}" 2>&1; echo $? > "${staleRcFile}"`,
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
      `cd "$1" && "${self}" teardown "${d}" 4 "${repo}" bug:four`,
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
