import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeError, writeOut } from "./lib/core.ts";

type Event = { date: number; action: string; target: string };
type Result = { code: number; stdout: string; stderr: string };
const terminal = new Set(["done", "abandoned"]);
function fmt(seconds: number): string {
  const sec = Math.round(seconds);
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const rest = sec % 60;
  return hours
    ? `${hours}h ${String(minutes).padStart(2, "0")}m`
    : minutes
      ? `${minutes}m ${String(rest).padStart(2, "0")}s`
      : `${rest}s`;
}
function times(directory: string): Result {
  const log = join(directory, "actions.jsonl");
  if (!existsSync(log)) return { code: 1, stdout: "", stderr: `run-times: no action log at ${log}` };
  const events: Event[] = [];
  const lines = readFileSync(log, "utf8").split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line) as { ts: string; action: string; target?: string };
      const date = Date.parse(obj.ts.replace(/Z$/, "Z"));
      if (!Number.isFinite(date) || !obj.action) throw new Error();
      events.push({ date, action: obj.action, target: obj.target ?? "" });
    } catch {
      return { code: 1, stdout: "", stderr: `run-times: ${log} line ${index + 1} is not a log line` };
    }
  }
  if (events.length === 0) return { code: 1, stdout: "", stderr: `run-times: ${log} is empty` };
  const starts = events
    .filter((event) => event.action === "stage")
    .map((event) => ({ date: event.date, stage: event.target }));
  const dispatch = events.find((event) => event.action === "dispatch")?.date;
  if (dispatch !== undefined && (starts.length === 0 || dispatch <= starts[0].date))
    starts.unshift({ date: dispatch, stage: "dispatched" });
  if (starts.length < 2 && !events.some((event) => event.action === "stage"))
    return { code: 3, stdout: `no stage changes logged in ${log}`, stderr: "" };
  const last = events.at(-1)!.date;
  const legs: [number, number][] = [];
  let opened: number | undefined;
  for (const event of events) {
    if (event.action === "handoff-accept") opened = event.date;
    else if (event.action === "handoff" && opened !== undefined) {
      legs.push([opened, event.date]);
      opened = undefined;
    }
  }
  if (opened !== undefined) legs.push([opened, last]);
  const knownLegs = events.some((event) => event.action === "handoff" || event.action === "handoff-accept");
  const working = (a: number, b: number) =>
    legs.reduce((sum, [x, y]) => sum + Math.max(0, Math.min(b, y) - Math.max(a, x)) / 1000, 0);
  const rows: [string, string, string, string][] = [];
  let total = 0;
  let waited = 0;
  for (let index = 0; index < starts.length; index++) {
    const { date, stage } = starts[index];
    const stamp = new Date(date).toISOString().slice(0, 19).replace("T", " ");
    if (terminal.has(stage)) {
      rows.push([stage, stamp, "-", "-"]);
      continue;
    }
    const end = starts[index + 1]?.date ?? last;
    const note = index + 1 < starts.length ? "" : " (open)";
    const span = (end - date) / 1000;
    total += span;
    const wait = knownLegs ? fmt(span - working(date, end)) : "-";
    if (knownLegs) waited += span - working(date, end);
    rows.push([stage + note, stamp, fmt(span), wait]);
  }
  const row = (stage: string, started: string, took: string, wait: string) =>
    `${stage.padEnd(26)} ${started.padEnd(21)} ${took.padEnd(10)} ${wait}`;
  const output = [
    row("stage", "started (UTC)", "took", "waiting"),
    ...rows.map((r) => row(...r)),
    row("total", "", fmt(total), knownLegs ? fmt(waited) : "-"),
  ].join("\n");
  return { code: 0, stdout: `${output}\n`, stderr: "" };
}
function selfTest(): number {
  const temp = mkdtempSync(join(tmpdir(), "run-times-"));
  let failures = 0;
  const line = (minute: string, action: string, target = "") =>
    `{"ts":"2026-01-01T${minute}:00Z","project":"p","run":"r","actor":"coachman","action":"${action}","target":"${target}","detail":""}`;
  const check = (label: string, expected: number, contains = "") => {
    const result = times(temp);
    const output = result.stdout + result.stderr;
    if (result.code === expected && (!contains || output.includes(contains))) writeOut(`  ok   ${label}`);
    else {
      writeOut(
        `  FAIL ${label}: exit ${result.code}, wanted ${expected}${contains && !output.includes(contains) ? `; missing ${contains}` : ""}`,
      );
      for (const text of output.trim().split("\n")) writeOut(`         ${text}`);
      failures++;
    }
  };
  try {
    writeOut("a full run, two legs, with a wait between them");
    writeFileSync(
      join(temp, "actions.jsonl"),
      [
        line("12:00", "dispatch", "r"),
        line("12:01", "handoff-accept", "1"),
        line("12:02", "stage", "bootstrapped"),
        line("12:05", "stage", "workhorses-running"),
        line("12:35", "stage", "synthesis"),
        line("12:50", "stage", "checkpoint-1"),
        line("12:52", "handoff", "1"),
        line("12:55", "handoff-accept", "2"),
        line("12:56", "stage", "review"),
        line("13:10", "handoff", "2"),
        line("13:10", "stage", "done"),
      ].join("\n") + "\n",
    );
    check(
      "the dispatched stage runs from dispatch to bootstrapped",
      0,
      "dispatched                 2026-01-01 12:00:00   2m 00s     1m 00s",
    );
    check("a stage inside one leg has no waiting", 0, "workhorses-running         2026-01-01 12:05:00   30m 00s    0s");
    check(
      "a stage across the leg boundary counts the gap",
      0,
      "checkpoint-1               2026-01-01 12:50:00   6m 00s     3m 00s",
    );
    check(
      "a terminal stage is a moment, not a span",
      0,
      "done                       2026-01-01 13:10:00   -          -",
    );
    check("the total adds up", 0, "total                                            1h 10m     4m 00s");
    writeOut("a dispatch in the same second as the first stage");
    writeFileSync(
      join(temp, "actions.jsonl"),
      [line("12:00", "dispatch", "r"), line("12:00", "stage", "bootstrapped"), line("12:03", "stage", "done")].join(
        "\n",
      ) + "\n",
    );
    check("the dispatched row is still shown", 0, "dispatched                 2026-01-01 12:00:00   0s");
    writeOut("a run still in progress");
    writeFileSync(
      join(temp, "actions.jsonl"),
      [line("12:00", "dispatch", "r"), line("12:02", "stage", "bootstrapped"), line("12:09", "note", "x")].join("\n") +
        "\n",
    );
    check(
      "the last non-terminal stage is open, to the last action",
      0,
      "bootstrapped (open)        2026-01-01 12:02:00   7m 00s     -",
    );
    writeOut("negative controls");
    writeFileSync(
      join(temp, "actions.jsonl"),
      [line("12:00", "dispatch", "r"), line("12:05", "note", "x")].join("\n") + "\n",
    );
    check("a log with no stage lines says so, and times nothing", 3, "no stage changes logged");
    writeFileSync(join(temp, "actions.jsonl"), "not json\n");
    check("an unreadable log is refused", 1, "is not a log line");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
  writeOut("");
  writeOut(failures === 0 ? "self-test: all controls behaved" : `self-test: ${failures} control(s) misbehaved`);
  return failures === 0 ? 0 : 1;
}

const args = process.argv.slice(2);
if (args[0] === "--self-test") process.exit(args.length === 1 ? selfTest() : 1);
if (args.length !== 1) {
  writeError("usage: run-times.sh <dispatch> | --self-test");
  process.exit(1);
}
const result = times(args[0]);
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) writeError(result.stderr);
process.exit(result.code);
