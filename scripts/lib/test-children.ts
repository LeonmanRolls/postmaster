// Per-test child-process tracking for the test preload: when a test ends
// with processes it started still running, its failure names them with pid,
// command and start state. A preload cannot wrap test or
// node:child_process.spawn (ESM live bindings bypass require-patching), and
// Bun reaps a timed-out test's children before afterEach runs, so this
// snapshots the test process's descendants instead: every 250 ms from each
// test's start, and the report lists what was alive at the last check and
// started after the test did. Attribution is by start time against the
// test's start with a 1.5 s slop for the one-second granularity of boot and
// listing clocks; a start that cannot be read counts as the test's. Tests
// under 250 ms are never snapshotted, so stated timeouts under 250 ms get
// no list, and a test blocked in spawnSync cannot report in-process.
// Snapshots are one pass: /proc where it lists pids, else a single ps,
// since a per-pid caller would pay a spawn per process on macOS.
import { afterEach, beforeEach } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { bootTime } from "./processes.ts";

export interface ChildEntry {
  pid: number;
  ppid: number;
  stat: string;
  command: string;
  /** Start as epoch milliseconds, or null when it cannot be read. */
  started: number | null;
}

/** A /proc/<pid>/stat line as its state, parent and start-time ticks. The
 * name sits between the first "(" and the last ")", and may itself hold
 * spaces and parens; the start time is the 20th field past it. */
export function parseProcStat(
  text: string,
): { state: string; ppid: number; startTicks: number | null } | null {
  const close = text.lastIndexOf(")");
  if (close < 0) return null;
  const fields = text
    .slice(close + 1)
    .trim()
    .split(/\s+/u);
  if (fields.length < 20 || fields[0] === undefined || fields[1] === undefined) return null;
  const ppid = Number(fields[1]);
  if (!Number.isSafeInteger(ppid) || ppid < 0) return null;
  const ticks = Number(fields[19]);
  return {
    state: fields[0],
    ppid,
    startTicks: Number.isSafeInteger(ticks) && ticks >= 0 ? ticks : null,
  };
}

/** Start-time ticks as epoch milliseconds, from the boot time and clock
 * ticks per second the edge reads once per worker. */
export function ticksToEpochMs(ticks: number, bootMs: number, hz: number): number {
  return bootMs + (ticks * 1000) / hz;
}

const MONTHS: Record<string, number> = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};

/** A ps lstart word run as epoch milliseconds, in this machine's zone: the
 * ctime shape with a year, or the yearless shape read as its most recent
 * past occurrence. Null when the words are neither. */
export function parseLstart(words: string[], nowMs: number): number | null {
  const text = words.join(" ");
  const m =
    /^[A-Z][a-z]{2} ([A-Z][a-z]{2}) ([0-9]{1,2}) ([0-9]{2}):([0-9]{2}):([0-9]{2})(?: ([0-9]{4}))?$/u.exec(
      text,
    );
  if (m === null) return null;
  const month = MONTHS[m[1]!];
  if (month === undefined) return null;
  const day = Number(m[2]);
  const [hh, mm, ss] = [Number(m[3]), Number(m[4]), Number(m[5])];
  const thisYear = new Date(nowMs).getFullYear();
  if (m[6] !== undefined) {
    const t = new Date(Number(m[6]), month, day, hh, mm, ss).getTime();
    return Number.isNaN(t) ? null : t;
  }
  let t = new Date(thisYear, month, day, hh, mm, ss).getTime();
  if (Number.isNaN(t)) return null;
  if (t > nowMs) t = new Date(thisYear - 1, month, day, hh, mm, ss).getTime();
  return Number.isNaN(t) ? null : t;
}

/** `ps -A -o pid=,ppid=,stat=,lstart=,args=` output, one entry per
 * well-formed line. The start words run from the third field through the
 * clock time plus an optional year; the command is every field past them,
 * since it may hold spaces. nowMs dates a yearless start. */
export function parsePsSnapshot(text: string, nowMs: number): ChildEntry[] {
  const out: ChildEntry[] = [];
  for (const line of text.split("\n")) {
    const fields = line.trim().split(/[ \t]+/u);
    if (fields.length < 7) continue;
    const [pidRaw, ppidRaw, stat, ...rest] = fields as [string, string, string, ...string[]];
    if (stat === undefined || !/^[0-9]+$/u.test(pidRaw) || !/^[0-9]+$/u.test(ppidRaw)) continue;
    const clockAt = rest.findIndex((word) => /^[0-9]{2}:[0-9]{2}:[0-9]{2}$/u.test(word));
    if (clockAt < 3) continue;
    const yearWord = rest[clockAt + 1];
    const yearful = yearWord !== undefined && /^[0-9]{4}$/u.test(yearWord);
    const started = parseLstart(rest.slice(0, clockAt + (yearful ? 2 : 1)), nowMs);
    out.push({
      pid: Number(pidRaw),
      ppid: Number(ppidRaw),
      stat,
      command: rest.slice(clockAt + (yearful ? 2 : 1)).join(" "),
      started,
    });
  }
  return out;
}

/** Every entry under rootPid, transitively: children and grandchildren, but
 * never rootPid itself. Parent links, not names: a reparented grandchild
 * still hangs under the test worker. */
export function descendantsOf(
  entries: Iterable<ChildEntry>,
  rootPid: number,
): Map<number, ChildEntry> {
  const children = new Map<number, ChildEntry[]>();
  for (const entry of entries) {
    const list = children.get(entry.ppid) ?? [];
    list.push(entry);
    children.set(entry.ppid, list);
  }
  const found = new Map<number, ChildEntry>();
  const queue = [...(children.get(rootPid) ?? [])];
  while (queue.length > 0) {
    const entry = queue.pop()!;
    if (entry.pid === rootPid || found.has(entry.pid)) continue;
    found.set(entry.pid, entry);
    queue.push(...(children.get(entry.pid) ?? []));
  }
  return found;
}

/** Whether a start belongs to a test begun at t0: unreadable counts as the
 * test's, and the slop covers the one-second granularity of boot and listing
 * clocks on either side. */
export function startedDuringTest(started: number | null, t0: number): boolean {
  return started === null || started >= t0 - 1500;
}

let bootMs: number | null | undefined;
let hz: number | undefined;

function linuxStarted(ticks: number | null): number | null {
  if (ticks === null) return null;
  if (bootMs === undefined) {
    const boot = bootTime();
    bootMs = boot === null ? null : boot * 1000;
  }
  if (bootMs === null) return null;
  if (hz === undefined) {
    hz = 100;
    try {
      const n = Number(spawnSync("getconf", ["CLK_TCK"], { encoding: "utf8" }).stdout.trim());
      if (Number.isSafeInteger(n) && n > 0) hz = n;
    } catch {
      // The fallback stands: every system this runs on ticks at 100.
    }
  }
  return ticksToEpochMs(ticks, bootMs, hz);
}

function snapshotLinux(): Map<number, ChildEntry> | null {
  let names: string[];
  try {
    names = readdirSync("/proc");
  } catch {
    return null;
  }
  const entries: ChildEntry[] = [];
  for (const name of names) {
    if (!/^[0-9]+$/u.test(name)) continue;
    const pid = Number(name);
    let parsed: { state: string; ppid: number; startTicks: number | null } | null;
    let command: string;
    try {
      parsed = parseProcStat(readFileSync(`/proc/${pid}/stat`, "utf8"));
      command = readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/gu, " ").trim();
    } catch {
      // A process that exits mid-scan simply has no entry.
      continue;
    }
    if (parsed === null) continue;
    entries.push({
      pid,
      ppid: parsed.ppid,
      stat: parsed.state,
      command,
      started: linuxStarted(parsed.startTicks),
    });
  }
  // A live proc root always lists pids; none means the root is not a procfs.
  return entries.length > 0 ? descendantsOf(entries, process.pid) : null;
}

async function snapshotPs(): Promise<Map<number, ChildEntry>> {
  try {
    const child = Bun.spawn(["ps", "-A", "-o", "pid=,ppid=,stat=,lstart=,args="], {
      stdout: "pipe",
      stderr: "ignore",
      env: { ...process.env, LC_ALL: "C" },
    });
    // Drain before waiting: a full process table exceeds the pipe buffer,
    // and awaiting the exit first would deadlock the listing.
    const out = await new Response(child.stdout).text();
    await child.exited;
    const entries = parsePsSnapshot(out, Date.now()).filter((entry) => entry.pid !== child.pid);
    return descendantsOf(entries, process.pid);
  } catch {
    // A listing that cannot run reports nothing; silence is safer than noise.
    return new Map();
  }
}

/** The test worker's living descendants: /proc in one pass where it lists
 * pids, else one ps. Exported for the unit tests beside this file. */
export async function snapshotDescendants(): Promise<Map<number, ChildEntry>> {
  return snapshotLinux() ?? snapshotPs();
}

const POLL_MS = 250;
const GRACE_MS = 100;

let generation = 0;
let polling: ReturnType<typeof setInterval> | null = null;
let pollActive = false;
let testStart = 0;
let last: Map<number, ChildEntry> | null = null;

beforeEach(() => {
  const g = ++generation;
  testStart = Date.now();
  last = null;
  pollActive = false;
  polling = setInterval(() => {
    if (g !== generation || pollActive) return;
    pollActive = true;
    void snapshotDescendants().then(
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
  if ([...seen.values()].some((entry) => startedDuringTest(entry.started, t0)))
    await Bun.sleep(GRACE_MS);
  const end = await snapshotDescendants();
  const candidates = new Map<number, ChildEntry>();
  for (const entry of [...seen.values(), ...end.values()]) {
    if (startedDuringTest(entry.started, t0))
      candidates.set(entry.pid, end.get(entry.pid) ?? entry);
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
