// How long each stage of a run took, computed from the run's own action log. Nothing here is
// written by hand: a stage starts at the `stage` line that entered it (scripts/stage.sh writes
// those) and ends at the next one, and the first stage, `dispatched`, starts at the postmaster's
// `dispatch` line.
//
//   run-times.sh <dispatch>      the table, from <dispatch>/actions.jsonl
//   run-times.sh --self-test     known logs give known answers; a log with no stage lines says so
//
// Waiting is the part of a stage when no coachman leg was running: from one leg's `handoff`
// to the next leg's `handoff-accept`. A run whose log has neither shows waiting as "-".
// A terminal stage (done, abandoned) is a moment, not a span. A last stage that is not
// terminal is open, and is measured to the last logged action.
//
//   exit 0  printed
//   exit 1  usage, or the log is missing or unreadable
//   exit 3  the log has no stage changes to time
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { withTempDir } from "./lib/proc.ts";
import { SelfTest } from "./lib/selftest.ts";

interface Event {
  ts: Date;
  action: string;
  target: string;
}

function parseTs(s: string): Date | null {
  // BASE format is %Y-%m-%dT%H:%M:%SZ; accept that form, and the space-separated one too.
  const iso = s.endsWith("Z") ? s : `${s.replace(" ", "T")}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmt(sec: number): string {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const rem = s % 3600;
  const m = Math.floor(rem / 60);
  const ss = rem % 60;
  return h
    ? `${h}h ${String(m).padStart(2, "0")}m`
    : m
      ? `${m}m ${String(ss).padStart(2, "0")}s`
      : `${ss}s`;
}

function times(dispatch: string): number {
  const log = join(dispatch, "actions.jsonl");
  if (!existsSync(log)) {
    console.error(`run-times: no action log at ${log}`);
    return 1;
  }
  const events: Event[] = [];
  const lines = readFileSync(log, "utf8").split("\n");
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    if (!line || line.trim() === "") continue;
    try {
      const e = JSON.parse(line);
      const ts = parseTs(String(e.ts));
      if (ts === null || typeof e.action !== "string") throw new Error("bad");
      events.push({ ts, action: e.action, target: typeof e.target === "string" ? e.target : "" });
    } catch {
      console.error(`run-times: ${log} line ${n + 1} is not a log line`);
      return 1;
    }
  }
  if (events.length === 0) {
    console.error(`run-times: ${log} is empty`);
    return 1;
  }

  const TERMINAL = new Set(["done", "abandoned"]);
  const starts: Array<[Date, string]> = events
    .filter((e) => e.action === "stage")
    .map((e) => [e.ts, e.target] as [Date, string]);
  const dispatchEv = events.find((e) => e.action === "dispatch");
  if (dispatchEv && (starts.length === 0 || dispatchEv.ts <= starts[0]?.[0])) {
    starts.unshift([dispatchEv.ts, "dispatched"]);
  }
  if (starts.length < 2 && !events.some((e) => e.action === "stage")) {
    console.log(`no stage changes logged in ${log}`);
    return 3;
  }
  const last = events[events.length - 1]?.ts;

  // leg working spans: each handoff-accept to the next handoff
  const legs: Array<[Date, Date]> = [];
  let opened: Date | null = null;
  for (const e of events) {
    if (e.action === "handoff-accept") {
      opened = e.ts;
    } else if (e.action === "handoff" && opened !== null) {
      legs.push([opened, e.ts]);
      opened = null;
    }
  }
  if (opened !== null) legs.push([opened, last]);
  const knownLegs = events.some((e) => e.action === "handoff" || e.action === "handoff-accept");

  const working = (a: Date, b: Date): number =>
    legs.reduce((sum, [x, y]) => {
      const lo = Math.max(a.getTime(), x.getTime());
      const hi = Math.min(b.getTime(), y.getTime());
      return sum + Math.max(0, (hi - lo) / 1000);
    }, 0);

  const rows: Array<[string, Date, string, string]> = [];
  let total = 0;
  let waited = 0;
  for (let i = 0; i < starts.length; i++) {
    const [t, stage] = starts[i]!;
    if (TERMINAL.has(stage)) {
      rows.push([stage, t, "-", "-"]);
      continue;
    }
    const end = i + 1 < starts.length ? starts[i + 1]?.[0] : last;
    const note = i + 1 < starts.length ? "" : " (open)";
    const span = (end.getTime() - t.getTime()) / 1000;
    total += span;
    let wait: string;
    if (knownLegs) {
      const w = span - working(t, end);
      waited += w;
      wait = fmt(w);
    } else {
      wait = "-";
    }
    rows.push([stage + note, t, fmt(span), wait]);
  }

  const hdr = (s: string, t: string, took: string, w: string) =>
    `${s.padEnd(26)} ${t.padEnd(21)} ${took.padEnd(10)} ${w}`;
  console.log(hdr("stage", "started (UTC)", "took", "waiting"));
  for (const [stage, t, took, wait] of rows) {
    const ts = t.toISOString().slice(0, 19).replace("T", " ");
    console.log(hdr(stage, ts, took, wait));
  }
  console.log(hdr("total", "", fmt(total), knownLegs ? fmt(waited) : "-"));
  return 0;
}

// --- entry ------------------------------------------------------------------------------
const argv = process.argv.slice(2);
if (argv[0] !== "--self-test") {
  if (argv.length !== 1) {
    console.error("usage: run-times.sh <dispatch> | --self-test");
    process.exit(1);
  }
  process.exit(times(argv[0] as string));
}

// --- self-test ----------------------------------------------------------------------------
withTempDir((tmp) => {
  const st = new SelfTest();
  const line = (ts: string, action: string, target = ""): string =>
    JSON.stringify({
      ts: `2026-01-01T${ts}:00Z`,
      project: "p",
      run: "r",
      actor: "coachman",
      action,
      target,
      detail: "",
    });

  const writeLog = (lines: string[]): void => {
    writeFileSync(join(tmp, "actions.jsonl"), `${lines.join("\n")}\n`);
  };

  const check = (label: string, wantExit: number, ...texts: string[]): void => {
    const origLog = console.log;
    const origErr = console.error;
    let out = "";
    console.log = (s: string) => {
      out += `${s}\n`;
    };
    console.error = (s: string) => {
      out += `${s}\n`;
    };
    let rc: number;
    try {
      rc = times(tmp);
    } finally {
      console.log = origLog;
      console.error = origErr;
    }
    const missing = texts.filter((text) => !out.includes(text));
    if (rc === wantExit && missing.length === 0) {
      st.ok(label);
    } else {
      const bad: string[] = [];
      if (rc !== wantExit) bad.push(`exit ${rc}, wanted ${wantExit}`);
      for (const m of missing) bad.push(`missing: ${m}`);
      st.fail(`${label}: ${bad.join("; ")}`, out);
    }
  };

  console.log("a full run, two legs, with a wait between them");
  writeLog([
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
  ]);
  check(
    "the dispatched stage runs from dispatch to bootstrapped",
    0,
    "dispatched                 2026-01-01 12:00:00   2m 00s     1m 00s",
  );
  check(
    "a stage inside one leg has no waiting",
    0,
    "workhorses-running         2026-01-01 12:05:00   30m 00s    0s",
  );
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
  check(
    "the total adds up",
    0,
    "total                                            1h 10m     4m 00s",
  );

  console.log("a dispatch in the same second as the first stage");
  writeLog([
    line("12:00", "dispatch", "r"),
    line("12:00", "stage", "bootstrapped"),
    line("12:03", "stage", "done"),
  ]);
  check(
    "the dispatched row is still shown",
    0,
    "dispatched                 2026-01-01 12:00:00   0s",
  );

  console.log("a run still in progress");
  writeLog([
    line("12:00", "dispatch", "r"),
    line("12:02", "stage", "bootstrapped"),
    line("12:09", "note", "x"),
  ]);
  check(
    "the last non-terminal stage is open, to the last action",
    0,
    "bootstrapped (open)        2026-01-01 12:02:00   7m 00s     -",
  );

  console.log("negative controls");
  writeLog([line("12:00", "dispatch", "r"), line("12:05", "note", "x")]);
  check("a log with no stage lines says so, and times nothing", 3, "no stage changes logged");
  writeFileSync(join(tmp, "actions.jsonl"), "not json\n");
  check("an unreadable log is refused", 1, "is not a log line");

  st.finish();
});
