// Append to a run's narrative, run-log.md, with the time on every entry. This is the one way the
// narrative is written, so a reader can see when each thing happened and how long each part of
// the work took.
//
//   run run-log <dispatch> <text...>            one entry:  - 12:35:07Z <text>
//   run run-log <dispatch> --section <title>    close the open section, start a new one
//   run run-log <dispatch> --close              close the open section; nothing if none is open
//
// A section starts with a heading carrying its start time, and ends with a line saying how long
// it took, written when the next section starts or when --close is called. The narrative is for
// reading; what a run is audited from is actions.jsonl.
//
//   exit 0  written
//   exit 1  usage, or no such dispatch directory
import { appendFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function now(): string {
  return process.env.RUN_LOG_NOW ?? new Date().toISOString().slice(0, 19).replace("T", " ");
}

function parseTime(s: string): number {
  // "%Y-%m-%d %H:%M:%S" as a UTC timestamp in seconds
  return Date.parse(`${s.replace(" ", "T")}Z`) / 1000;
}

function clockOf(t: number): string {
  return new Date(t * 1000).toISOString().slice(11, 19);
}

/** close_open <log> <now>; writes the open section's duration, if any. */
function closeOpen(log: string, now: string): void {
  if (!existsSync(log)) return;
  const lines = readFileSync(log, "utf8").split("\n");
  // drop a trailing empty line from the final newline
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const head =
    /^## (.+) \(([0-9]{4}-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9]) UTC\)$/u;
  const found: Array<{ i: number; m: RegExpMatchArray }> = [];
  lines.forEach((l, i) => {
    const m = head.exec(l);
    if (m) found.push({ i, m });
  });
  if (found.length === 0) return;
  const last = found[found.length - 1];
  if (!last) return;
  const title = last.m[1] ?? "";
  const start = parseTime(last.m[2] ?? "");
  const closed = `section ${title} took `;
  if (lines.slice(last.i + 1).some((l) => l.startsWith("- ") && l.includes(closed))) return;
  const sec = Math.max(0, Math.floor(parseTime(now) - start));
  const h = Math.floor(sec / 3600);
  const rem = sec % 3600;
  const m_ = Math.floor(rem / 60);
  const s = rem % 60;
  const took = h
    ? `${h}h ${String(m_).padStart(2, "0")}m`
    : m_
      ? `${m_}m ${String(s).padStart(2, "0")}s`
      : `${s}s`;
  appendFileSync(log, `- ${clockOf(parseTime(now))}Z ${closed}${took}\n`);
}

/** write <dispatch> <args...> */
export function write(d: string, args: string[]): number {
  if (!existsSync(d) || !isDirectory(d)) {
    console.error(`run-log: no such dispatch directory: ${d}`);
    return 1;
  }
  const log = join(d, "run-log.md");
  const t = now();
  const a0 = args[0];
  if (a0 === "--section") {
    const title = args[1];
    if (title === undefined || title === "") {
      console.error("usage: run run-log <dispatch> --section <title>");
      return 1;
    }
    closeOpen(log, t);
    appendFileSync(log, `\n## ${title} (${t} UTC)\n\n`);
  } else if (a0 === "--close") {
    closeOpen(log, t);
  } else if (a0 === undefined || a0 === "") {
    console.error("usage: run run-log <dispatch> <text...> | --section <title> | --close");
    return 1;
  } else {
    const hhmmss = t.includes(" ") ? t.slice(t.indexOf(" ") + 1) : t;
    appendFileSync(log, `- ${hhmmss}Z ${args.join(" ")}\n`);
  }
  return 0;
}

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// --- entry ------------------------------------------------------------------------------
const argv = process.argv.slice(2);
if (import.meta.main) {
  if (argv.length < 1) {
    console.error("usage: run run-log <dispatch> <text...> | --section <title> | --close");
    process.exit(1);
  }
  const d = argv[0];
  if (d === undefined) process.exit(1);
  process.exit(write(d, argv.slice(1)));
}
