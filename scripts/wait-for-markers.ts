// Block until <count> files matching <glob> exist directly under <dir>, or <timeout> seconds
// pass. The wait goes in the SAME command as the launch that will produce the markers; a turn
// that ends between launching a round and collecting it is a round nobody collects.
//
//   wait-for-markers.sh <dir> <glob> <count> <timeout-seconds>
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
import { readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

function matchGlob(name: string, pattern: string): boolean {
  const re = new RegExp(
    "^" +
      pattern
        .replace(/[.+^${}()|[\]\\]/gu, "\\$&")
        .replace(/\*/gu, "[^/]*")
        .replace(/\?/gu, ".") +
      "$",
    "u",
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
    if (!/^[0-9]+$/u.test(n)) {
      console.error(`wait-for-markers: '${n}' is not a whole number of markers or seconds`);
      return 1;
    }
    const stripped = n.replace(/^0+(?=[0-9])/u, "");
    if (stripped.length > 9) {
      console.error(`wait-for-markers: '${n}' is more than 9 digits`);
      return 1;
    }
  }
  const COUNT = parseInt(countRaw.replace(/^0+(?=[0-9])/u, ""), 10);
  const TIMEOUT = parseInt(timeoutRaw.replace(/^0+(?=[0-9])/u, ""), 10);

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

  if (countdown(() => count(glob), COUNT, TIMEOUT) === "timeout") {
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
  console.log(`all ${COUNT} markers present`);
  return 0;
}

/** Poll until countFn reaches count or timeout seconds elapse. The timeout
 * counts slept seconds through sleep alone and never reads the wall clock,
 * so time asleep is not counted and a clock set forward cannot end the wait
 * early. Naps are 20 seconds but the last, which is the remainder. */
export function countdown(
  countFn: () => number,
  count: number,
  timeout: number,
  sleep: (ms: number) => void = (ms) => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  },
): "present" | "timeout" {
  let left = timeout;
  while (countFn() < count) {
    if (left <= 0) return "timeout";
    const nap = left < 20 ? left : 20;
    sleep(nap * 1000);
    left -= nap;
  }
  return "present";
}

// --- entry ------------------------------------------------------------------------------
const argv = process.argv.slice(2);
if (import.meta.main) {
  if (argv.length < 4) {
    console.error("usage: wait-for-markers.sh <dir> <glob> <count> <timeout-seconds>");
    process.exit(1);
  }
  process.exit(wait(argv[0] as string, argv[1] as string, argv[2] as string, argv[3] as string));
}
