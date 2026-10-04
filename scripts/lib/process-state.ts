import { readFileSync, readdirSync } from "node:fs";
import { run } from "./proc.ts";

export type ProcessState = "live" | "zombie" | "absent";

export type ProcessInfo = Readonly<{
  pid: number;
  parent: number;
  group: number;
  session: number;
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
  return psState(pid) ?? "live";
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
    start: fields[19] ?? "",
    state: fields[0] === "Z" ? "zombie" : "live",
    name: stat.name,
  };
}

function psProcessInfo(pid: number): ProcessInfo | null {
  const result = run("ps", ["-o", "pid=,ppid=,pgid=,sid=,stat=,lstart=,comm=", "-p", String(pid)], {
    env: { LC_ALL: "C" },
  });
  const fields = result.out.trim().split(/[ \t]+/u);
  if (fields.length < 11 || !fields.slice(0, 4).every((field) => /^[0-9]+$/u.test(field)))
    return null;
  return {
    pid: Number(fields[0]),
    parent: Number(fields[1]),
    group: Number(fields[2]),
    session: Number(fields[3]),
    state: fields[4]!.startsWith("Z") ? "zombie" : "live",
    start: fields.slice(5, 10).join(" "),
    name: fields.slice(10).join(" "),
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
    return table;
  } catch {
    // A missing or non-proc root forces the portable ps path used on macOS.
  }

  const result = run("ps", ["-A", "-o", "pid=,ppid=,pgid=,sid=,stat=,lstart=,comm="], {
    env: { LC_ALL: "C" },
  });
  for (const line of result.out.split(/\r?\n/u)) {
    const fields = line.trim().split(/[ \t]+/u, 11);
    if (fields.length !== 11 || !fields.slice(0, 4).every((field) => /^[0-9]+$/u.test(field)))
      continue;
    table.set(Number(fields[0]), {
      pid: Number(fields[0]),
      parent: Number(fields[1]),
      group: Number(fields[2]),
      session: Number(fields[3]),
      state: fields[4]!.startsWith("Z") ? "zombie" : "live",
      start: fields.slice(5, 10).join(" "),
      name: fields[10]!,
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
