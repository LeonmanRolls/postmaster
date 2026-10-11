// Per-test child-process tracking for the test preload: when a test ends
// with processes it started still running, its failure names them with pid,
// command and state. A preload cannot wrap test or
// node:child_process.spawn (ESM live bindings bypass require-patching), and
// Bun reaps a timed-out test's children before afterEach runs, so this
// snapshots the test process's descendants instead: every 500 ms from each
// test's start, and the report lists what was alive at the last check and
// started after the test did. Attribution is by start time against the
// test's start with a 1.5 s slop for the one-second granularity of boot and
// listing clocks; a start that cannot be read counts as the test's. Tests
// under 500 ms are never snapshotted, so stated timeouts under 500 ms get
// no list, and a test blocked in spawnSync cannot report in-process.
import { afterEach, beforeEach } from "bun:test";
import { snapshotDescendants, type ProcessSnapshot } from "./processes.ts";

/** Whether a start belongs to a test begun at t0: unreadable counts as the
 * test's, and the slop covers the one-second granularity of boot and listing
 * clocks on either side. */
export function startedDuringTest(started: number | null, t0: number): boolean {
  return started === null || started >= t0 - 1500;
}

/** Whether a sighting counts toward the report: started with the test, and
 * not a zombie, which has already finished and is only awaiting reaping. */
export function countsTowardReport(entry: ProcessSnapshot, t0: number): boolean {
  return !entry.stat.startsWith("Z") && startedDuringTest(entry.started, t0);
}

const POLL_MS = 500;
const GRACE_MS = 100;

let generation = 0;
let polling: ReturnType<typeof setInterval> | null = null;
let pollActive = false;
let testStart = 0;
let last: Map<number, ProcessSnapshot> | null = null;

beforeEach(() => {
  const g = ++generation;
  testStart = Date.now();
  last = null;
  pollActive = false;
  polling = setInterval(() => {
    if (g !== generation || pollActive) return;
    pollActive = true;
    void snapshotDescendants(process.pid).then(
      (seen) => {
        if (g === generation) last = seen;
        pollActive = false;
      },
      () => {
        pollActive = false;
      },
    );
  }, POLL_MS);
});

afterEach(async () => {
  generation++;
  if (polling !== null) {
    clearInterval(polling);
    polling = null;
  }
  const seen = last;
  last = null;
  if (seen === null) return;
  const t0 = testStart;
  if ([...seen.values()].some((entry) => countsTowardReport(entry, t0))) await Bun.sleep(GRACE_MS);
  const end = await snapshotDescendants(process.pid);
  const candidates = new Map<number, ProcessSnapshot>();
  for (const entry of [...seen.values(), ...end.values()]) {
    if (countsTowardReport(entry, t0)) candidates.set(entry.pid, end.get(entry.pid) ?? entry);
  }
  if (candidates.size === 0) return;
  const noun = candidates.size === 1 ? "1 child process" : `${candidates.size} child processes`;
  console.error(`test-children: ${noun} still running at the test's last check:`);
  for (const [pid, entry] of [...candidates].sort(([a], [b]) => a - b)) {
    const live = end.get(pid);
    const state =
      live === undefined
        ? "reaped as the test ended"
        : live.stat.startsWith("Z")
          ? "zombie"
          : "running";
    console.error(`test-children: pid ${pid}: ${state}: ${live?.command || entry.command}`);
  }
});
