import { appendFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeError, writeOut } from "./lib/core.ts";

function clock(): string {
  return process.env.RUN_LOG_NOW ?? new Date().toISOString().slice(0, 19).replace("T", " ");
}
function duration(seconds: number): string {
  const total = Math.max(0, Math.trunc(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours
    ? `${hours}h ${String(minutes).padStart(2, "0")}m`
    : minutes
      ? `${minutes}m ${String(secs).padStart(2, "0")}s`
      : `${secs}s`;
}
function closeOpen(log: string, now: string): void {
  if (!existsSync(log)) return;
  const lines = readFileSync(log, "utf8").split(/\r?\n/);
  const head = /^## (.+) \((\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) UTC\)$/;
  const found: { index: number; title: string; start: string }[] = [];
  lines.forEach((line: string, index: number) => {
    const match = head.exec(line);
    if (match) found.push({ index, title: match[1], start: match[2] });
  });
  const last = found.at(-1);
  if (!last) return;
  const closeLabel = `section ${last.title} took `;
  if (lines.slice(last.index + 1).some((line: string) => line.startsWith("- ") && line.includes(closeLabel))) return;
  const start = Date.parse(`${last.start.replace(" ", "T")}Z`);
  const end = Date.parse(`${now.replace(" ", "T")}Z`);
  const seconds = Math.max(0, Math.trunc((end - start) / 1000));
  appendFileSync(log, `- ${now.slice(11)}Z ${closeLabel}${duration(seconds)}\n`);
}
function write(args: string[], quiet = false): number {
  const [directory, ...parts] = args;
  if (!directory) {
    if (!quiet) writeError("usage: run-log.sh <dispatch> <text...> | --section <title> | --close");
    return 1;
  }
  if (!existsSync(directory)) {
    if (!quiet) writeError(`run-log: no such dispatch directory: ${directory}`);
    return 1;
  }
  const log = join(directory, "run-log.md");
  const timestamp = clock();
  if (parts[0] === "--section") {
    if (!parts[1]) {
      if (!quiet) writeError("usage: run-log.sh <dispatch> --section <title>");
      return 1;
    }
    closeOpen(log, timestamp);
    appendFileSync(log, `\n## ${parts[1]} (${timestamp} UTC)\n\n`);
  } else if (parts[0] === "--close") closeOpen(log, timestamp);
  else if (parts.length === 0 || parts[0] === "") {
    if (!quiet) writeError("usage: run-log.sh <dispatch> <text...> | --section <title> | --close");
    return 1;
  } else appendFileSync(log, `- ${timestamp.slice(11)}Z ${parts.join(" ")}\n`);
  return 0;
}

function selfTest(): number {
  const temp = mkdtempSync(join(tmpdir(), "run-log-"));
  const directory = join(temp, "RUN");
  mkdirSync(directory);
  const log = join(directory, "run-log.md");
  let failures = 0;
  const ok = (label: string) => writeOut(`  ok   ${label}`);
  const fail = (label: string, detail = "") => {
    writeOut(`  FAIL ${label}${detail ? `: ${detail}` : ""}`);
    if (existsSync(log)) for (const line of readFileSync(log, "utf8").split(/\r?\n/)) writeOut(`         ${line}`);
    failures++;
  };
  const has = (label: string, line: string) =>
    readFileSync(log, "utf8").split(/\r?\n/).includes(line) ? ok(label) : fail(label, `no line "${line}"`);
  const setNow = (value: string) => {
    process.env.RUN_LOG_NOW = value;
  };
  try {
    setNow("2026-01-01 12:00:00");
    write([directory, "--section", "Harvest"]);
    setNow("2026-01-01 12:03:07");
    write([directory, "luna", "harvested,", "4", "commits"]);
    setNow("2026-01-01 12:30:00");
    write([directory, "--section", "Synthesis"]);
    setNow("2026-01-01 12:45:30");
    write([directory, "--close"]);
    setNow("2026-01-01 12:50:00");
    write([directory, "--close"]);
    writeOut("positive controls");
    has("a section heading carries its start time", "## Harvest (2026-01-01 12:00:00 UTC)");
    has("an entry carries the time", "- 12:03:07Z luna harvested, 4 commits");
    has("starting a section closes the last, with its time", "- 12:30:00Z section Harvest took 30m 00s");
    has("--close closes the open section", "- 12:45:30Z section Synthesis took 15m 30s");
    writeOut("negative controls");
    const closeCount = readFileSync(log, "utf8").split("section Synthesis took").length - 1;
    closeCount === 1 ? ok("closing twice writes one line") : fail("closing twice writes one line");
    rmSync(log);
    setNow("2026-01-01 13:00:00");
    write([directory, "--close"]);
    !existsSync(log) || readFileSync(log, "utf8").length === 0
      ? ok("--close with no open section writes nothing")
      : fail("--close with no open section writes nothing");
    if (write([join(temp, "nowhere"), "x"], true) === 1) ok("a missing dispatch directory is refused");
    else fail("a missing dispatch directory is refused");
  } finally {
    delete process.env.RUN_LOG_NOW;
    rmSync(temp, { recursive: true, force: true });
  }
  writeOut("");
  writeOut(failures === 0 ? "self-test: all controls behaved" : `self-test: ${failures} control(s) misbehaved`);
  return failures === 0 ? 0 : 1;
}

const args = process.argv.slice(2);
if (args[0] === "--self-test") {
  if (args.length === 1) process.exit(selfTest());
  writeError("usage: run-log.sh <dispatch> <text...> | --section <title> | --close | --self-test");
  process.exit(1);
}
if (args.length === 0) {
  writeError("usage: run-log.sh <dispatch> <text...> | --section <title> | --close | --self-test");
  process.exit(1);
}
process.exit(write(args));
