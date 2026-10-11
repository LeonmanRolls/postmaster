import { readFileSync, readdirSync } from "node:fs";
import { run } from "./proc.ts";

export type ProcessState = "live" | "zombie" | "absent";

export type ProcessInfo = Readonly<{
  pid: number;
  parent: number;
  group: number;
  session: number;
  /** Foreground group of the controlling terminal, null when there is none. */
  terminal: number | null;
  start: string;
  state: ProcessState;
  name: string;
}>;

type ProcStat = Readonly<{ name: string; fields: string[] }>;

function procRoot(): string {
  return process.env.POSTMASTER_PROC_ROOT || "/proc";
}

function validPid(pid: number): boolean {
  return Number.isSafeInteger(pid) && pid > 0;
}

/** A raw tpgid field as the terminal it names: a positive group id, or null
 * when the process has no terminal. Both backends print -1 there, and a
 * foreign ps its own nothing, so anything but a positive number reads as none. */
function terminalGroup(raw: string | undefined): number | null {
  if (raw === undefined || !/^-?[0-9]+$/u.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function readProcStat(pid: number): ProcStat | null {
  try {
    const raw = readFileSync(`${procRoot()}/${pid}/stat`, "utf8");
    const close = raw.lastIndexOf(")");
    if (close < 0) return null;
    return {
      name: raw.slice(raw.indexOf("(") + 1, close),
      fields: raw
        .slice(close + 1)
        .trim()
        // ASCII: /proc/<pid>/stat past the name is kernel-emitted ASCII numerics.
        .split(/\s+/u),
    };
  } catch {
    return null;
  }
}

function canSignal(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function psState(pid: number): ProcessState | null {
  const result = run("ps", ["-o", "stat=", "-p", String(pid)], { env: { LC_ALL: "C" } });
  const state = result.out.trim().split(" ")[0];
  if (state) return state.startsWith("Z") ? "zombie" : "live";
  return result.code === 0 ? null : "absent";
}

export function processState(pid: number): ProcessState {
  if (!validPid(pid) || !canSignal(pid)) return "absent";
  const stat = readProcStat(pid);
  if (stat) return stat.fields[0] === "Z" ? "zombie" : "live";
  // The signal won a race with the exit: ps finds nothing, so it has ended.
  return psState(pid) ?? "absent";
}

export function processIsLive(pid: number): boolean {
  return processState(pid) === "live";
}

/** Return the lock-compatible start value for a live process, or null. */
export function processStart(pid: number): string | null {
  if (!validPid(pid) || processState(pid) !== "live") return null;
  const stat = readProcStat(pid);
  if (stat) return stat.fields[19] || null;
  const result = run("ps", ["-o", "lstart=", "-p", String(pid)], { env: { LC_ALL: "C" } });
  const words = result.out
    .trim()
    .split(/[ \t]+/u)
    .filter(Boolean);
  return words.length === 5 ? words.join(" ") : null;
}

function parseLinuxProcess(pid: number, stat: ProcStat): ProcessInfo | null {
  const fields = stat.fields;
  if (fields.length < 20) return null;
  return {
    pid,
    parent: Number(fields[1]),
    group: Number(fields[2]),
    session: Number(fields[3]),
    terminal: terminalGroup(fields[5]),
    start: fields[19] ?? "",
    state: fields[0] === "Z" ? "zombie" : "live",
    name: stat.name,
  };
}

function psProcessInfo(pid: number): ProcessInfo | null {
  // sess, not sid: macOS rejects sid, and Linux accepts both. tpgid rides
  // along: the terminal's foreground group, -1 when there is no terminal.
  const result = run(
    "ps",
    ["-o", "pid=,ppid=,pgid=,sess=,tpgid=,stat=,lstart=,comm=", "-p", String(pid)],
    {
      env: { LC_ALL: "C" },
    },
  );
  const fields = result.out.trim().split(/[ \t]+/u);
  if (fields.length < 12 || !fields.slice(0, 4).every((field) => /^[0-9]+$/u.test(field)))
    return null;
  return {
    pid: Number(fields[0]),
    parent: Number(fields[1]),
    group: Number(fields[2]),
    session: Number(fields[3]),
    terminal: terminalGroup(fields[4]),
    state: fields[5]!.startsWith("Z") ? "zombie" : "live",
    start: fields.slice(6, 11).join(" "),
    name: fields.slice(11).join(" "),
  };
}

export function processInfo(pid: number): ProcessInfo | null {
  if (!validPid(pid)) return null;
  const stat = readProcStat(pid);
  if (stat) return parseLinuxProcess(pid, stat);
  return psProcessInfo(pid);
}

export function processTable(): Map<number, ProcessInfo> {
  const table = new Map<number, ProcessInfo>();
  try {
    for (const entry of readdirSync(procRoot())) {
      if (!/^[0-9]+$/u.test(entry)) continue;
      const pid = Number(entry);
      const stat = readProcStat(pid);
      const info = stat ? parseLinuxProcess(pid, stat) : null;
      if (info) table.set(pid, info);
    }
    // A live proc root always lists pids; none means the root is not a procfs.
    if (table.size > 0) return table;
  } catch {
    // A missing or non-proc root forces the portable ps path used on macOS.
  }

  // sess, not sid: macOS rejects sid, and Linux accepts both. tpgid rides
  // along: the terminal's foreground group, -1 when there is no terminal.
  const result = run("ps", ["-A", "-o", "pid=,ppid=,pgid=,sess=,tpgid=,stat=,lstart=,comm="], {
    env: { LC_ALL: "C" },
  });
  for (const line of result.out.split(/\r?\n/u)) {
    // No split limit: JS drops everything past it, and comm may hold spaces.
    const fields = line.trim().split(/[ \t]+/u);
    if (fields.length < 12 || !fields.slice(0, 4).every((field) => /^[0-9]+$/u.test(field)))
      continue;
    table.set(Number(fields[0]), {
      pid: Number(fields[0]),
      parent: Number(fields[1]),
      group: Number(fields[2]),
      session: Number(fields[3]),
      terminal: terminalGroup(fields[4]),
      state: fields[5]!.startsWith("Z") ? "zombie" : "live",
      start: fields.slice(6, 11).join(" "),
      name: fields.slice(11).join(" "),
    });
  }
  return table;
}

export function processCommandLine(pid: number): string {
  try {
    return readFileSync(`${procRoot()}/${pid}/cmdline`, "utf8").replace(/\0/gu, " ").trim();
  } catch {
    return run("ps", ["-o", "args=", "-p", String(pid)], { env: { LC_ALL: "C" } }).out.trim();
  }
}

/** Every process's command line in one listing: the /proc tree when it
 * lists pids, else a single portable ps. A per-pid caller would pay a
 * spawn per process on macOS. */
export function processCommandLines(): Map<number, string> {
  const table = new Map<number, string>();
  try {
    const root = procRoot();
    for (const entry of readdirSync(root)) {
      if (!/^[0-9]+$/u.test(entry)) continue;
      const pid = Number(entry);
      try {
        table.set(pid, readFileSync(`${root}/${pid}/cmdline`, "utf8").replace(/\0/gu, " ").trim());
      } catch {
        // A process that exits mid-listing simply has no line.
      }
    }
    // A live proc root always lists pids; none means the root is not a procfs.
    if (table.size > 0) return table;
  } catch {
    // A missing or non-proc root forces the portable ps path used on macOS.
  }
  const result = run("ps", ["-A", "-o", "pid=,args="], { env: { LC_ALL: "C" } });
  for (const row of result.out.split(/\r?\n/u)) {
    const pid = Number(row.trim().split(/[ \t]+/u)[0]);
    if (!Number.isSafeInteger(pid) || pid <= 0) continue;
    table.set(pid, row.trim());
  }
  return table;
}

/** Pids under rootPid, transitively, from a pid-to-parent map: children and
 * grandchildren, but never rootPid itself. The one descendant walk; the test
 * preload's snapshotter and the stuck-suite stop share it. */
export function descendantPids(parents: ReadonlyMap<number, number>, rootPid: number): number[] {
  const children = new Map<number, number[]>();
  for (const [pid, ppid] of parents) {
    const list = children.get(ppid) ?? [];
    list.push(pid);
    children.set(ppid, list);
  }
  const found: number[] = [];
  const seen = new Set<number>([rootPid]);
  const queue = [...(children.get(rootPid) ?? [])];
  while (queue.length > 0) {
    const pid = queue.pop()!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    found.push(pid);
    queue.push(...(children.get(pid) ?? []));
  }
  return found;
}

/** One process in a single-pass snapshot: identity, parent, the raw state
 * word, the full command, and the start as epoch milliseconds (null when it
 * cannot be read). The test preload polls these several times a second, so
 * one pass reads everything: /proc where it lists pids, else a single ps. */
export interface ProcessSnapshot {
  pid: number;
  ppid: number;
  stat: string;
  command: string;
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
    .split(/[ \t]+/u);
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
export function parsePsSnapshot(text: string, nowMs: number): ProcessSnapshot[] {
  const out: ProcessSnapshot[] = [];
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

let snapshotBootMs: number | null | undefined;
let snapshotHz: number | undefined;

function snapshotStarted(ticks: number | null): number | null {
  if (ticks === null) return null;
  if (snapshotBootMs === undefined) {
    const boot = bootTime();
    snapshotBootMs = boot === null ? null : boot * 1000;
  }
  if (snapshotBootMs === null) return null;
  if (snapshotHz === undefined) {
    snapshotHz = 100;
    const probed = Number(run("getconf", ["CLK_TCK"]).out.trim());
    if (Number.isSafeInteger(probed) && probed > 0) snapshotHz = probed;
  }
  return ticksToEpochMs(ticks, snapshotBootMs, snapshotHz);
}

function snapshotLinux(rootPid: number): ProcessSnapshot[] | null {
  let names: string[];
  try {
    names = readdirSync(procRoot());
  } catch {
    return null;
  }
  // The stat lines alone first: the walk needs every parent, but only
  // the descendants' command lines are ever read.
  const stats = new Map<number, { state: string; ppid: number; startTicks: number | null }>();
  const parents = new Map<number, number>();
  for (const name of names) {
    if (!/^[0-9]+$/u.test(name)) continue;
    const pid = Number(name);
    let parsed: { state: string; ppid: number; startTicks: number | null } | null;
    try {
      parsed = parseProcStat(readFileSync(`${procRoot()}/${pid}/stat`, "utf8"));
    } catch {
      // A process that exits mid-scan simply has no entry.
      continue;
    }
    if (parsed === null) continue;
    stats.set(pid, parsed);
    parents.set(pid, parsed.ppid);
  }
  // A live proc root always lists pids; none means the root is not a procfs.
  if (stats.size === 0) return null;
  const entries: ProcessSnapshot[] = [];
  for (const pid of descendantPids(parents, rootPid)) {
    const parsed = stats.get(pid);
    if (parsed === undefined) continue;
    let command: string;
    try {
      command = readFileSync(`${procRoot()}/${pid}/cmdline`, "utf8").replace(/\0/gu, " ").trim();
    } catch {
      // Exited between the scan and the read.
      continue;
    }
    entries.push({
      pid,
      ppid: parsed.ppid,
      stat: parsed.state,
      command,
      started: snapshotStarted(parsed.startTicks),
    });
  }
  return entries;
}

async function snapshotPs(): Promise<ProcessSnapshot[]> {
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
    return parsePsSnapshot(out, Date.now()).filter((entry) => entry.pid !== child.pid);
  } catch {
    // A listing that cannot run reports nothing; silence is safer than noise.
    return [];
  }
}

/** The living descendants of rootPid: /proc where it lists pids (stat
 * lines for the walk, command lines for the descendants alone), else a
 * single ps. Async for the ps listing; the /proc scan is synchronous,
 * so the poll reads the least it can at a preload's cadence. */
export async function snapshotDescendants(rootPid: number): Promise<Map<number, ProcessSnapshot>> {
  const linux = snapshotLinux(rootPid);
  const entries = linux ?? (await snapshotPs());
  const byPid = new Map<number, ProcessSnapshot>();
  const parents = new Map<number, number>();
  for (const entry of entries) {
    byPid.set(entry.pid, entry);
    parents.set(entry.pid, entry.ppid);
  }
  const found = new Map<number, ProcessSnapshot>();
  for (const pid of descendantPids(parents, rootPid)) {
    const entry = byPid.get(pid);
    if (entry !== undefined) found.set(pid, entry);
  }
  return found;
}

function runC(...args: string[]): string {
  return run(args[0]!, args.slice(1), { env: { LC_ALL: "C" } }).out.trim();
}

/** `sysctl -n kern.boottime`'s whole seconds, or null when it cannot be read.
 * The seconds survive a corrected clock, which the microseconds and the local
 * date text do not. */
function macBootSeconds(): number | null {
  // ASCII: sysctl kern.boottime is kernel-emitted ASCII on macOS.
  const text = run("sysctl", ["-n", "kern.boottime"], { env: { LC_ALL: "C" } }).out;
  // ASCII: the words of kernel-emitted ASCII, split on spaces.
  const words = text.replace(/,/gu, " ").split(/\s+/u);
  const at = words.indexOf("sec");
  if (at < 0 || at + 2 >= words.length) return null;
  const seconds = Number(words[at + 2]);
  return Number.isInteger(seconds) ? seconds : null;
}

/** The machine's boot id: the Linux file when the root holds it (the test
 * setting sends a run down the portable path), else macOS's
 * `kern.bootsessionuuid`, which a corrected clock leaves alone, else the whole
 * seconds of `kern.boottime`. Empty when none can be read. The root defaults
 * to the process root; a test passes another root to force the portable path
 * on Linux. */
export function bootId(root = procRoot()): string {
  try {
    return readFileSync(`${root}/sys/kernel/random/boot_id`, "utf8").trim();
  } catch {
    // A missing root forces the portable path used on macOS.
  }
  const session = run("sysctl", ["-n", "kern.bootsessionuuid"], { env: { LC_ALL: "C" } });
  const uuid = session.out.trim();
  if (session.code === 0 && uuid !== "") return uuid;
  const seconds = macBootSeconds();
  return seconds === null ? "" : String(seconds);
}

/** The boot time in epoch seconds, or null when neither source holds one. Takes
 * an explicit root where a test forces the sysctl reading on Linux; the default
 * stays the real /proc, which a forced process root never moves. */
export function bootTime(procRoot = "/proc"): number | null {
  try {
    const text = readFileSync(`${procRoot}/stat`, "utf8");
    const line = text.split("\n").find((row) => row.startsWith("btime "));
    // ASCII: /proc/stat btime is kernel-emitted ASCII.
    if (line) return Number(line.split(/\s+/u)[1]);
  } catch {
    // A missing root forces the sysctl reading macOS uses.
  }
  // ASCII: sysctl kern.boottime is kernel-emitted ASCII on macOS.
  const words = runC("sysctl", "-n", "kern.boottime").replace(/,/gu, " ").split(/\s+/u);
  // `{ sec = <t>, ... }`: the value sits two words past `sec`.
  const at = words.indexOf("sec");
  if (at < 0 || at + 2 >= words.length) return null;
  const seconds = Number(words[at + 2]);
  return Number.isInteger(seconds) ? seconds : null;
}

/** A recorded `sysctl kern.boottime` text, as this module's seconds form. */
function recordedBootSeconds(text: string): number | null {
  if (/^[0-9]+$/u.test(text)) return Number(text);
  // ASCII: `sec = <n>` is sysctl's kernel-emitted ASCII.
  const match = /sec\s*=\s*([0-9]+)/u.exec(text);
  return match ? Number(match[1]) : null;
}

/** Whether a recorded boot id names the current boot. Equal ids match; a
 * record in the older `kern.boottime` text form matches while its whole
 * seconds still name this boot, so a run already going keeps its launches. */
export function sameBoot(recorded: string, current: string): boolean {
  if (recorded === current) return true;
  const recordedSeconds = recordedBootSeconds(recorded);
  if (recordedSeconds === null) return false;
  const currentSeconds = recordedBootSeconds(current) ?? macBootSeconds();
  return currentSeconds !== null && recordedSeconds === currentSeconds;
}
