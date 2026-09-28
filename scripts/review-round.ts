// A review round's bookkeeping: its time limit, collecting it, recording and stopping the
// reviewers that do not finish in time, and tearing its scratches down with nothing of the
// round still running in them.
//
//   review-round.sh start    <dispatch> <round>
//   review-round.sh wait     <dispatch> <round> <repo> [<lens>:<lane>...]
//   review-round.sh teardown <dispatch> <round> <repo> [<lens>:<lane>...]
//   review-round.sh --self-test
//
//   exit 0  wait: every marker is in · start and teardown: done
//   exit 3  wait: the deadline passed; each reviewer with no marker is recorded and stopped
//   exit 4  wait: the deadline passed, but a record could not be written
//   exit 1  usage; the round was not started, or the machine restarted or the round was started
//           again since the wait began; a marker no reviewer of the round lands; teardown: a
//           scratch left in place
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { scriptsDir } from "./lib/paths.ts";
import { run, withTempDir } from "./lib/proc.ts";
import { SelfTest } from "./lib/selftest.ts";

const HERE = scriptsDir(import.meta);
const DEFAULT_LIMIT = 2400;
const MAX_LIMIT = 86400;
const USAGE =
  "usage: review-round.sh start <dispatch> <round> | wait|teardown <dispatch> <round> <repo> [<lens>:<lane>...] | --self-test";

function die(msg: string): never {
  console.error(`review-round: ${msg}`);
  process.exit(1);
}

function monotonic(): number {
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
    try {
      const r = run("sysctl", ["-n", "kern.boottime"]);
      return r.code === 0 ? r.out.trim() : "";
    } catch {
      return "";
    }
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
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(st, null, 2)}\n`);
  renameSync(tmp, path);
}

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
      started: now.toISOString().replace(/\.\d+Z$/, "Z"),
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
    const given = args.flatMap((a) => a.split(/[\s,]+/)).filter((x) => x !== "");
    if (given.length > 0) {
      const pairs: Array<[string, string]> = [];
      const bad: string[] = [];
      for (const x of given) {
        const m = /^([A-Za-z0-9._-]+):([A-Za-z0-9._-]+)$/.exec(x);
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
  const k = run(join(HERE, "cut-scratch.sh"), ["--kind", s]);
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

// --- entry ------------------------------------------------------------------------------
const argv = process.argv.slice(2);

if (argv[0] !== "--self-test") {
  const cmd = argv[0];
  if (cmd !== "start" && cmd !== "wait" && cmd !== "teardown") die(USAGE);
  if (cmd === "start" && argv.length !== 3) die(USAGE);
  if ((cmd === "wait" || cmd === "teardown") && argv.length < 4) die(USAGE);
  const dRaw = argv[1] ?? "";
  const dR = run("bash", ["-c", `cd "$1" 2>/dev/null && pwd -P`, "_", dRaw]);
  const D = dR.code === 0 ? dR.out.trim() : die(`no such dispatch directory: ${dRaw}`);
  const roundArg = argv[2] ?? "";
  if (!/^[0-9]+$/.test(roundArg) || roundArg.startsWith("0") || roundArg.length > 6) {
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
    const rl = run(join(HERE, "run-log.sh"), [D, text]);
    if (rl.code !== 0) {
      console.log(`NOT RECORDED in run-log.md: ${text}`);
      (globalThis as Record<string, unknown>).UNRECORDED = 1;
    }
    const la = run(join(HERE, "log-action.sh"), [D, "coachman", ...logArgs]);
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
    const wf = run(join(HERE, "wait-for-markers.sh"), [
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
        const child = run(join(HERE, "host.sh"), ["stop", s]);
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
      const stopR = run(join(HERE, "host.sh"), ["stop", s]);
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
        const closeR = run(join(HERE, "host.sh"), ["close", s]);
        if (closeR.code !== 0) {
          why = `its space was not closed: ${closeR.out + closeR.err}`;
        } else {
          const un = unswitch(s, TICKET);
          if (un) {
            console.log(`${s}: ${un}`);
            record(`${basename(s)}: ${un}`, "note", s, `r${R}: ${un}`);
          }
          const rmR = run(join(HERE, "cut-scratch.sh"), ["--remove", REPO, s]);
          if (rmR.code !== 0) {
            why = `it was not removed: ${rmR.out + rmR.err}`;
          }
        }
      }
    }
    if (!why) {
      console.log(`removed ${s}`);
      removed += 1;
      const la = run(join(HERE, "log-action.sh"), [
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
      why = why.replace(/\n/g, " ");
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
  const rl = run(join(HERE, "run-log.sh"), [D, summary]);
  if (rl.code !== 0) console.log(`NOT RECORDED in run-log.md: round ${R} teardown`);
  process.exit(kept === 0 ? 0 : 1);
}

// --- self-test ----------------------------------------------------------------------------
const self = join(HERE, "review-round.sh");
withTempDir((tmpRaw) => {
  const tmp = run("bash", ["-c", `cd "$1" && pwd -P`, "_", tmpRaw]).out.trim() || tmpRaw;
  // Clean up pids and the temp dir on exit.
  const cleanupPids: number[] = [];
  process.on("exit", () => {
    for (const pid of cleanupPids) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* already gone */
      }
    }
    try {
      run("chmod", ["-R", "u+w", tmp]);
      rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });

  const repo = join(tmp, "repo");
  const d = join(tmp, "runs/proj/T-1");
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
    "user.email=t@t",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "first",
  ]);
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

  const st = new SelfTest();
  let out = "";
  let rc = 0;
  let took = 0;
  let n = 0;

  const has = (s: string): boolean => out.includes(s);
  const check = (label: string, cond: boolean): void => {
    if (cond) st.ok(label);
    else st.fail(`${label} (exit ${rc})`, out);
  };
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
  const limit = (v: string): void => {
    writeFileSync(join(d, "run.json"), `{"config": {"review": {"round_timeout_seconds": ${v}}}}\n`);
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
      join(HERE, "host.sh"),
      [
        "run",
        `T-1 · ${lane} ${lens} review`,
        join(repo, ".worktrees", `T-1-rev-${lens}-${lane}`),
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
    if (kind === "fast") return;
    let i = 0;
    while (i < 50) {
      try {
        const s = readFileSync(join(tmp, "pids", `child.${n}`), "utf8").trim();
        if (s) break;
      } catch {
        /* not yet */
      }
      run("sleep", ["0.1"]);
      i += 1;
    }
    try {
      const s = readFileSync(join(tmp, "pids", `child.${n}`), "utf8").trim();
      if (!s) console.log(`  (the ${kind} reviewer never started)`);
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
    runLog.includes(" two bug: DEGRADED, timeout"),
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
    !alive(slow) && !alive(child),
  );
  runSelf("teardown", d, "1", repo);
  check(
    "teardown takes the reviewers the wait recorded, and removes each scratch",
    rc === 0 &&
      !existsSync(join(repo, ".worktrees/T-1-rev-bug-one")) &&
      !existsSync(join(repo, ".worktrees/T-1-rev-bug-two")) &&
      actionsLines('"action":"teardown"') === 2,
  );

  limit("4");
  cutScratch("bug", "three");
  runSelf("start", d, "2");
  launch(2, "bug", "three", "slow");
  try {
    slow = parseInt(readFileSync(join(tmp, "pids", `launch.${n}`), "utf8").trim(), 10);
  } catch {
    /* ignore */
  }
  run("timeout", ["1", self, "wait", d, "2", repo, "bug:three"]);
  run("sleep", ["1"]);
  runSelf("wait", d, "2", repo);
  check(
    "a wait run again keeps the round's deadline rather than starting a new one",
    rc === 3 && took <= 3 && has("TIMEOUT bug three") && !alive(slow),
  );
  runSelf("teardown", d, "2", repo, "bug:three");

  limit("60");
  cutScratch("style", "one");
  runSelf("start", d, "3");
  launch(3, "style", "one", "leaves");
  let left = 0;
  try {
    left = parseInt(readFileSync(join(tmp, "pids", `child.${n}`), "utf8").trim(), 10);
    cleanupPids.push(left);
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
    rc === 0 && !alive(left) && has("left behind by a reviewer that had finished"),
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
  limit("2");
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
  // Background the stale wait, restart the round, then collect the result.
  const staleScript = [
    `"${self}" wait "${d}" 4 "${repo}" bug:four > "${staleOut}" 2>&1 &`,
    "stale=$!",
    "sleep 0.5",
    `printf '{"config": {"review": {"round_timeout_seconds": 60}}}\\n' > "${d}/run.json"`,
    `"${self}" start "${d}" 4`,
    "wait $stale",
    "echo exit:$?",
  ].join("\n");
  const staleR = run("bash", ["-c", staleScript]);
  const staleExit = (staleR.out.match(/exit:(\d+)/)?.[1] ?? "1").trim();
  let staleStdout = "";
  try {
    staleStdout = readFileSync(staleOut, "utf8");
  } catch {
    staleStdout = "";
  }
  out = staleStdout;
  rc = parseInt(staleExit, 10);
  check(
    "a wait from an earlier start of the round stands down, and records and stops nothing",
    rc === 1 && has("started again") && alive(slow) && !runLog.includes("four bug: DEGRADED"),
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
      !alive(slow) &&
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
  if (existsSync("/proc/sys/kernel/random/boot_id")) {
    runSelf("wait", d, "7", repo, "bug:one");
    check(
      "a round started before the machine restarted is not waited on",
      rc === 1 && has("restarted"),
    );
  } else {
    console.log("  skip a round started before the machine restarted (no boot_id)");
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
  if (process.getuid?.() !== 0) {
    chmodSync(join(d, "actions.jsonl"), 0o444);
    runSelf("wait", d, "10", repo, "bug:six");
    chmodSync(join(d, "actions.jsonl"), 0o644);
    check(
      "a timeout whose degrade line cannot be written exits 4, and says what was not recorded",
      rc === 4 && has("NOT RECORDED in actions.jsonl"),
    );
  } else {
    console.log("  skip a record that cannot be written (root writes anywhere)");
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

  st.finish();
});
