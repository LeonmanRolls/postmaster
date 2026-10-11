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
