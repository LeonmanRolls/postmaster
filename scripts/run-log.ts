// Append to a run's narrative, run-log.md, with the time on every entry. This is the one way the
// narrative is written, so a reader can see when each thing happened and how long each part of
// the work took.
//
//   run-log.sh <dispatch> <text...>            one entry:  - 12:35:07Z <text>
//   run-log.sh <dispatch> --section <title>    close the open section, start a new one
//   run-log.sh <dispatch> --close              close the open section; nothing if none is open
//   run-log.sh --self-test
//
// A section starts with a heading carrying its start time, and ends with a line saying how long
// it took, written when the next section starts or when --close is called. The narrative is for
// reading; what a run is audited from is actions.jsonl.
//
//   exit 0  written
//   exit 1  usage, or no such dispatch directory
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { withTempDir } from "./lib/proc.ts";
import { SelfTest } from "./lib/selftest.ts";

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
  const head = /^## (.+) \((\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) UTC\)$/;
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
function write(d: string, args: string[]): number {
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
      console.error("usage: run-log.sh <dispatch> --section <title>");
      return 1;
    }
    closeOpen(log, t);
    appendFileSync(log, `\n## ${title} (${t} UTC)\n\n`);
  } else if (a0 === "--close") {
    closeOpen(log, t);
  } else if (a0 === undefined || a0 === "") {
    console.error("usage: run-log.sh <dispatch> <text...> | --section <title> | --close");
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
if (argv[0] !== "--self-test") {
  if (argv.length < 1) {
    console.error(
      "usage: run-log.sh <dispatch> <text...> | --section <title> | --close | --self-test",
    );
    process.exit(1);
  }
  const d = argv[0];
  if (d === undefined) process.exit(1);
  process.exit(write(d, argv.slice(1)));
}

// --- self-test ----------------------------------------------------------------------------
withTempDir((tmp) => {
  const d = join(tmp, "RUN");
  mkdirSync(d);
  const log = join(d, "run-log.md");
  const st = new SelfTest();

  const has = (label: string, line: string): void => {
    let found = false;
    try {
      found = readFileSync(log, "utf8")
        .split("\n")
        .some((l) => l === line);
    } catch {
      found = false;
    }
    if (found) st.ok(label);
    else {
      let body = "";
      try {
        body = readFileSync(log, "utf8");
      } catch {
        body = "(no log)";
      }
      st.fail(`${label}: no line "${line}"`, body);
    }
  };
  const count = (needle: string): number => {
    try {
      return readFileSync(log, "utf8").split(needle).length - 1;
    } catch {
      return 0;
    }
  };

  process.env.RUN_LOG_NOW = "2026-01-01 12:00:00";
  write(d, ["--section", "Harvest"]);
  process.env.RUN_LOG_NOW = "2026-01-01 12:03:07";
  write(d, ["luna harvested, 4 commits"]);
  process.env.RUN_LOG_NOW = "2026-01-01 12:30:00";
  write(d, ["--section", "Synthesis"]);
  process.env.RUN_LOG_NOW = "2026-01-01 12:45:30";
  write(d, ["--close"]);
  process.env.RUN_LOG_NOW = "2026-01-01 12:50:00";
  write(d, ["--close"]);

  console.log("positive controls");
  has("a section heading carries its start time", "## Harvest (2026-01-01 12:00:00 UTC)");
  has("an entry carries the time", "- 12:03:07Z luna harvested, 4 commits");
  has(
    "starting a section closes the last, with its time",
    "- 12:30:00Z section Harvest took 30m 00s",
  );
  has("--close closes the open section", "- 12:45:30Z section Synthesis took 15m 30s");

  console.log("negative controls");
  st.check("closing twice writes one line", count("section Synthesis took") === 1);
  try {
    rmSync(log);
  } catch {
    /* already gone */
  }
  process.env.RUN_LOG_NOW = "2026-01-01 13:00:00";
  write(d, ["--close"]);
  let empty = true;
  try {
    empty = !existsSync(log) || readFileSync(log, "utf8") === "";
  } catch {
    empty = true;
  }
  st.check("--close with no open section writes nothing", empty);
  const rc = (() => {
    const orig = process.stderr.write.bind(process.stderr);
    process.stderr.write = (() => true) as typeof process.stderr.write;
    try {
      return write(join(tmp, "nowhere"), ["x"]);
    } finally {
      process.stderr.write = orig;
    }
  })();
  st.check("a missing dispatch directory is refused", rc === 1, `exit ${rc}`);

  st.finish();
});
