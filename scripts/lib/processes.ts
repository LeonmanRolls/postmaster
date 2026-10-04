// Every process fact postmaster reads comes from here: whether a process is
// still running, when it started, its command line, and the process table.
// Nothing else reads /proc/<pid>/stat, lists /proc, runs ps, or probes with
// kill(pid, 0); the containment test beside this file enforces that.
//
// Linux has /proc. A Mac has none, so every check takes the ps path. Tests
// force that path on Linux by pointing POSTMASTER_PROC_ROOT at a folder that
// does not exist; real runs never set it. The setting is this module's alone:
// production code reads no other platform setting, and callers never branch
// on the platform themselves.
//
// Boot id, uptime and a script's own raw arguments (/proc/self/cmdline) stay
// where they are, for #259. A test that forces the Mac path on Linux says so;
// it never claims to have run on a Mac.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { run } from "./proc.ts";

/** live: running. zombie: exited, not yet reaped — it has ended. absent: gone. */
export type ProcessState = "live" | "zombie" | "absent";

export type ProcRow = {
  ppid: number;
  group: number;
  /** Start time in the registry's format: /proc's field-19 tick count, or ps lstart's five words. */
  start: string;
  zombie: boolean;
  name: string;
};

/** The proc root: POSTMASTER_PROC_ROOT, or /proc when that is unset or empty.
 * A root that does not exist is the Mac path — every check falls to ps. */
export function procRoot(): string {
  return process.env.POSTMASTER_PROC_ROOT || "/proc";
}

function rootExists(): boolean {
  try {
    return statSync(procRoot()).isDirectory();
  } catch {
    return false;
  }
}

/** /proc/<pid>/stat, parsed past the command name: name in parens and the
 * numeric fields after it. Null where the root has no such entry. */
export function statOf(pid: number): { name: string; fields: string[] } | null {
  try {
    const raw = readFileSync(join(procRoot(), String(pid), "stat"), "utf8");
    const pos = raw.lastIndexOf(")");
    return {
      name: raw.slice(raw.indexOf("(") + 1, pos),
      fields: raw
        .slice(pos + 1)
        .trim()
        // ASCII: /proc/<pid>/stat past the name is kernel-emitted ASCII numerics.
        .split(/\s+/u),
    };
  } catch {
    return null;
  }
}

/** ps -o stat= -p <pid>, or "" when ps reports no such process. Always the
 * C locale, so a non-C locale never changes the state letters. */
function psState(pid: number): string {
  return run("ps", ["-o", "stat=", "-p", String(pid)], { env: { LC_ALL: "C" } }).out.trim();
}

/** live, zombie, or absent. kill(pid, 0) answers presence first (ESRCH is
 * absent), then the state field decides between live and zombie: a zombie
 * has ended. */
export function processState(pid: number): ProcessState {
  if (!pid || pid <= 0 || !Number.isInteger(pid)) return "absent";
  let present = false;
  try {
    process.kill(pid, 0);
    present = true;
  } catch (error) {
    present = (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
  if (!present) return "absent";
  if (rootExists()) {
    const stat = statOf(pid);
    // kill said present and the entry is gone: the process exited in between.
    if (!stat) return "absent";
    return stat.fields[0] === "Z" ? "zombie" : "live";
  }
  const state = psState(pid);
  // kill said present and ps cannot find it: treat as gone rather than live.
  if (state === "") return "absent";
  return state.startsWith("Z") ? "zombie" : "live";
}

/** Whether the process is still running. A zombie has ended. */
export function processAlive(pid: number): boolean {
  return processState(pid) === "live";
}

/** The process's start time in the form registry records and leg locks use —
 * /proc's field-19 tick count, or ps lstart's five words — or null when the
 * process has ended or has none. Start times keep their present form so a
 * record written before this module still matches. */
export function processStart(pid: number): string | null {
  if (!pid || pid <= 0 || !Number.isInteger(pid)) return null;
  if (rootExists()) {
    const stat = statOf(pid);
    if (!stat) return null;
    return stat.fields[0] !== "Z" ? (stat.fields[19] ?? null) : null;
  }
  const out = run("ps", ["-o", "stat=,lstart=", "-p", String(pid)], { env: { LC_ALL: "C" } }).out;
  // ASCII: ps -o stat/lstart is tool-emitted ASCII; the date holds single spaces.
  const fields = out.trim().split(/\s+/u);
  return fields.length >= 6 && !fields[0]!.startsWith("Z") ? fields.slice(1, 6).join(" ") : null;
}

/** Every process, keyed by pid: parent, group, start, zombie flag and the
 * command name. Includes zombies, which callers filter when they want live
 * members only. */
export function processTable(): Map<number, ProcRow> {
  const rows = new Map<number, ProcRow>();
  if (rootExists()) {
    let entries: string[] = [];
    try {
      entries = readdirSync(procRoot());
    } catch {
      return rows;
    }
    for (const entry of entries) {
      if (!/^[0-9]+$/u.test(entry)) continue;
      const stat = statOf(Number(entry));
      if (!stat) continue;
      rows.set(Number(entry), {
        ppid: Number(stat.fields[1]),
        group: Number(stat.fields[2]),
        start: stat.fields[19] ?? "",
        zombie: stat.fields[0] === "Z",
        name: stat.name,
      });
    }
    return rows;
  }
  const output = run("ps", ["-A", "-o", "pid=,ppid=,pgid=,stat=,lstart=,comm="], {
    env: { LC_ALL: "C" },
  }).out;
  for (const line of output.split(/\r?\n/u)) {
    // ASCII: ps -A -o ... is tool-emitted ASCII; comm may hold spaces, hence the limit.
    const fields = line.trim().split(/\s+/u, 10);
    if (
      fields.length !== 10 ||
      !/^[0-9]+$/u.test(fields[0]!) ||
      !/^[0-9]+$/u.test(fields[1]!) ||
      !/^[0-9]+$/u.test(fields[2]!)
    )
      continue;
    rows.set(Number(fields[0]), {
      ppid: Number(fields[1]),
      group: Number(fields[2]),
      start: fields.slice(4, 9).join(" "),
      zombie: fields[3]!.startsWith("Z"),
      name: fields[9]!,
    });
  }
  return rows;
}

/** Another process's command line, arguments joined by spaces. Empty where it
 * cannot be read; a script's own raw arguments are not this — see
 * rawArgvBytes in proc.ts, which reads /proc/self/cmdline and stays there. */
export function commandLine(pid: number): string {
  if (rootExists()) {
    try {
      return readFileSync(join(procRoot(), String(pid), "cmdline"), "utf8")
        .replace(/\0/gu, " ")
        .trim();
    } catch {
      return "";
    }
  }
  return run("ps", ["-o", "args=", "-p", String(pid)], { env: { LC_ALL: "C" } }).out.trim();
}

// --- the containment guard: the shapes only this module may hold ---
// A /proc/<pid>/stat read, a /proc listing, a read of another process's
// command line, a ps call, or a bare kill(pid, 0) probe. A script's own
// /proc/self/cmdline does not trip it, and neither does a kill with a real
// signal. The scan is a tripwire for the common shapes, not a parser: it
// strips line and block comments first, then matches the code that is left.

export type ProcessHit = { file: string; line: number; kind: string; text: string };

const CONTAINMENT_KINDS: Array<[string, RegExp]> = [
  ["proc-stat", /\/proc\/(?:\$\{[^}]+\}|[0-9]+)\/stat/u],
  ["proc-list", /readdirSync\(\s*(?:["'`]\/proc["'`]|procRoot\(\))/u],
  ["proc-cmdline", /\/proc\/(?:\$\{[^}]+\}|[0-9]+)\/cmdline/u],
  ["ps-call", /(?:run|spawn|spawnSync)\(\s*["']ps["']|Bun\.spawn\(\s*\[\s*["']ps["']/u],
  ["kill-probe", /process\.kill\([^,]+,\s*0\s*\)/u],
];

/** Strip line and block comments so a comment never trips the scan. */
function stripComments(src: string): string[] {
  const out: string[] = [];
  let inBlock = false;
  for (const raw of src.split("\n")) {
    let line = raw;
    if (inBlock) {
      const end = line.indexOf("*/");
      if (end < 0) {
        out.push("");
        continue;
      }
      inBlock = false;
      line = line.slice(end + 2);
    }
    for (;;) {
      const block = line.indexOf("/*");
      const sl = line.indexOf("//");
      if (block >= 0 && (sl < 0 || block < sl)) {
        const end = line.indexOf("*/", block + 2);
        if (end < 0) {
          line = line.slice(0, block);
          inBlock = true;
          break;
        }
        line = line.slice(0, block) + line.slice(end + 2);
        continue;
      }
      if (sl >= 0) {
        line = line.slice(0, sl);
      }
      break;
    }
    out.push(line);
  }
  return out;
}

/** Scan one source for the shapes only the module may hold. */
export function scanProcessesSource(name: string, src: string): ProcessHit[] {
  const hits: ProcessHit[] = [];
  const lines = stripComments(src);
  for (let n = 0; n < lines.length; n++) {
    const raw = lines[n]!;
    // Own raw argv is allowed: never another pid's.
    const cleaned = raw.replace(/\/proc\/self\/cmdline/gu, "");
    for (const [kind, re] of CONTAINMENT_KINDS) {
      if (re.test(cleaned)) hits.push({ file: name, line: n + 1, kind, text: raw.trim() });
    }
  }
  return hits;
}

/** Shapes the scan must catch, with the kind each one is. */
export const PLANTED: Array<{ src: string; kind: string }> = [
  { src: "const s = readFileSync(`/proc/${pid}/stat`, 'utf8');", kind: "proc-stat" },
  { src: "const s = readFileSync(`/proc/123/stat`, 'utf8');", kind: "proc-stat" },
  { src: "for (const e of readdirSync('/proc')) {}", kind: "proc-list" },
  { src: "for (const e of readdirSync(procRoot())) {}", kind: "proc-list" },
  { src: "const c = readFileSync(`/proc/${pid}/cmdline`, 'utf8');", kind: "proc-cmdline" },
  { src: 'run("ps", ["-o", "stat=", "-p", String(pid)]);', kind: "ps-call" },
  { src: 'spawn("ps", ["-A"]);', kind: "ps-call" },
  { src: "process.kill(pid, 0);", kind: "kill-probe" },
  { src: "process.kill(Number(x), 0);", kind: "kill-probe" },
];

/** Shapes the scan must miss, and why each is allowed. */
export const PLANTED_MISS: Array<{ src: string; why: string }> = [
  { src: "const r = readFileSync('/proc/self/cmdline');", why: "own raw argv" },
  { src: "const b = readFileSync('/proc/sys/kernel/random/boot_id');", why: "boot id stays" },
  { src: "const u = readFileSync('/proc/uptime');", why: "uptime stays" },
  { src: "process.kill(pid, 'SIGKILL');", why: "a real signal, not a probe" },
  { src: "process.kill(-pid, 'SIGTERM');", why: "a real signal, not a probe" },
  { src: "// process.kill(pid, 0);", why: "a comment" },
];
