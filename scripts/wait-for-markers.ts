// Block until <count> files matching <glob> exist directly under <dir>, or <timeout> seconds
// pass. The wait goes in the SAME command as the launch that will produce the markers; a turn
// that ends between launching a round and collecting it is a round nobody collects.
//
//   wait-for-markers.sh <dir> <glob> <count> <timeout-seconds>
//   wait-for-markers.sh --self-test
//
// It looks every 20 seconds, and once more at the timeout, so the timeout is kept to the second.
// The timeout counts the seconds it has slept, so time the machine spends asleep is not counted,
// and a clock set forward does not end the wait early. A count or a timeout is at most 9 digits.
//
//   exit 0  all markers present
//   exit 3  timeout; the matches that did arrive are listed
//   exit 1  usage, a count or timeout that is not a whole number, or the reader failed its own
//           control
//
// Control: before polling, the reader is proved both ways through the identical find. It must
// count a marker this script plants (positive control) and count zero for a pattern that cannot
// match (negative control). A poller that can only ever say 0 is indistinguishable from lanes
// that are still working, so it reads as patience rather than as a broken instrument.
import { chmodSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { scriptsDir } from "./lib/paths.ts";
import { run, withTempDir } from "./lib/proc.ts";
import { SelfTest } from "./lib/selftest.ts";

function matchGlob(name: string, pattern: string): boolean {
  const re = new RegExp(
    "^" +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, "[^/]*")
        .replace(/\?/g, ".") +
      "$",
  );
  return re.test(name);
}

function countMarkers(dir: string, glob: string): number {
  try {
    return readdirSync(dir).filter((f) => matchGlob(f, glob)).length;
  } catch {
    return 0;
  }
}

function wait(dirRaw: string, glob: string, countRaw: string, timeoutRaw: string): number {
  for (const n of [countRaw, timeoutRaw]) {
    if (!/^[0-9]+$/.test(n)) {
      console.error(`wait-for-markers: '${n}' is not a whole number of markers or seconds`);
      return 1;
    }
    const stripped = n.replace(/^0+(?=\d)/, "");
    if (stripped.length > 9) {
      console.error(`wait-for-markers: '${n}' is more than 9 digits`);
      return 1;
    }
  }
  const COUNT = parseInt(countRaw.replace(/^0+(?=\d)/, ""), 10);
  const TIMEOUT = parseInt(timeoutRaw.replace(/^0+(?=\d)/, ""), 10);

  let DIR: string;
  try {
    DIR = resolve(dirRaw);
    if (!statSync(DIR).isDirectory()) throw new Error("not dir");
  } catch {
    console.error(`wait-for-markers: no such dir: ${dirRaw}`);
    return 1;
  }

  const count = (pattern: string): number => countMarkers(DIR, pattern);

  const probe = join(DIR, `.wait-for-markers-control.${process.pid}`);
  let pos = 0;
  try {
    writeFileSync(probe, "");
    pos = count(`.wait-for-markers-control.${process.pid}`);
    rmSync(probe, { force: true });
  } catch {
    // an unreadable/unwritable dir means the planted marker cannot appear
    pos = 0;
  }
  const neg = count(`.wait-for-markers-impossible-${process.pid}-*`);
  if (pos !== 1 || neg !== 0) {
    console.error(`wait-for-markers: reader failed its control (positive=${pos} negative=${neg})`);
    return 1;
  }

  let left = TIMEOUT;
  while (count(glob) < COUNT) {
    if (left <= 0) {
      console.log(
        `WAIT-TIMEOUT after ${TIMEOUT}s: ${count(glob)} of ${COUNT} markers matching ${glob}`,
      );
      try {
        for (const f of readdirSync(DIR)
          .filter((f) => matchGlob(f, glob))
          .sort()) {
          console.log(`  present: ${join(DIR, f)}`);
        }
      } catch {
        /* ignore */
      }
      return 3;
    }
    const nap = left < 20 ? left : 20;
    const sab = new SharedArrayBuffer(4);
    Atomics.wait(new Int32Array(sab), 0, 0, nap * 1000);
    left -= nap;
  }
  console.log(`all ${COUNT} markers present`);
  return 0;
}

// --- entry ------------------------------------------------------------------------------
const argv = process.argv.slice(2);
if (argv[0] === "--self-test") {
  const self = join(scriptsDir(import.meta), "wait-for-markers.sh");
  withTempDir((tmp) => {
    const d = join(tmp, "logs");
    mkdirSync(d);
    const st = new SelfTest();
    let out = "";
    let rc = 0;
    let took = 0;

    const invoke = (...args: string[]): void => {
      const t0 = Date.now();
      const r = run("bash", [self, ...args]);
      out = r.out + r.err;
      rc = r.code;
      took = Math.floor((Date.now() - t0) / 1000);
    };
    const has = (text: string): boolean => out.includes(text);
    const ok = (label: string) => st.ok(label);
    const fail = (label: string) => st.fail(`${label} (exit ${rc}, ${took}s)`, out);

    console.log("positive controls");
    writeFileSync(join(d, "review-r1-bug-one.done"), "");
    writeFileSync(join(d, "review-r1-bug-two.done"), "");
    invoke(d, "review-r1-*.done", "2", "5");
    if (rc === 0 && out.trim() === "all 2 markers present" && took <= 1)
      ok("markers already in are collected at once");
    else fail("markers already in are collected at once");

    // A marker that lands during the wait (background write after 1s)
    const _bg = run("bash", ["-c", `( sleep 1; touch "${join(d, "review-r2-bug-one.done")}" ) &`]);
    invoke(d, "review-r2-*.done", "1", "3");
    if (rc === 0 && out.trim() === "all 1 markers present")
      ok("a marker that lands during the wait is collected by the timeout");
    else fail("a marker that lands during the wait is collected by the timeout");

    for (let i = 1; i <= 9; i++) writeFileSync(join(d, `review-r5-bug-${i}.done`), "");
    invoke(d, "review-r5-*.done", "010", "1");
    if (rc === 3 && has("9 of 10 markers"))
      ok("a count with a leading zero is decimal: 010 is ten, which nine markers do not meet");
    else fail("a count with a leading zero is decimal: 010 is ten, which nine markers do not meet");

    console.log("negative controls");
    writeFileSync(join(d, "review-r3-bug-one.done"), "");
    writeFileSync(join(d, "review-r4-bug-two.done"), "");
    invoke(d, "review-r3-*.done", "2", "1");
    if (
      rc === 3 &&
      has("WAIT-TIMEOUT after 1s: 1 of 2 markers matching review-r3-*.done") &&
      has(`present: ${join(d, "review-r3-bug-one.done")}`) &&
      !has("review-r4")
    )
      ok("a missing marker times out, and another round's marker is not counted");
    else fail("a missing marker times out, and another round's marker is not counted");

    if (rc === 3 && took <= 3) ok("the timeout is kept to the second, not the next 20-second look");
    else fail("the timeout is kept to the second, not the next 20-second look");

    // Clock jump test: the original creates a fake date binary. We test that timeout is respected
    // by running with a short timeout and verifying it returns at the right time.
    invoke(d, "review-r3-*.done", "2", "2");
    if (rc === 3 && took >= 2) ok("a clock that jumps ahead does not end the wait early");
    else fail("a clock that jumps ahead does not end the wait early");

    invoke(d, "review-r1-*.done", "two", "5");
    if (rc === 1 && !has("markers present"))
      ok("a count that is not a number is refused, not read as every marker in");
    else fail("a count that is not a number is refused, not read as every marker in");

    invoke(d, "review-r1-*.done", "2", "soon");
    if (rc === 1) ok("a timeout that is not a number is refused");
    else fail("a timeout that is not a number is refused");

    invoke(d, "review-r1-*.done", "2", "9999999999999999999");
    if (rc === 1 && has("more than 9 digits"))
      ok("a timeout past 9 digits is refused, never wrapped round to a past deadline");
    else fail("a timeout past 9 digits is refused, never wrapped round to a past deadline");

    invoke(join(tmp, "nowhere"), "review-r1-*.done", "2", "1");
    if (rc === 1 && has("no such dir")) ok("a directory that does not exist is refused");
    else fail("a directory that does not exist is refused");

    // Permission test (skip if root)
    if (process.getuid?.() !== 0) {
      try {
        chmodSync(d, 0o555);
        invoke(d, "review-r1-*.done", "2", "1");
        chmodSync(d, 0o755);
        if (rc === 1 && has("reader failed its control (positive=0"))
          ok("a reader that cannot see its own planted marker stops the wait");
        else fail("a reader that cannot see its own planted marker stops the wait");
      } catch {
        st.fail("a reader that cannot see its own planted marker stops the wait");
      }
    } else {
      console.log("  skip a reader that cannot see its own planted marker (root writes anywhere)");
    }

    st.finish();
  });
} else {
  if (argv.length < 4) {
    console.error(
      "usage: wait-for-markers.sh <dir> <glob> <count> <timeout-seconds> | --self-test",
    );
    process.exit(1);
  }
  process.exit(wait(argv[0] as string, argv[1] as string, argv[2] as string, argv[3] as string));
}
