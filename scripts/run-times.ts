// How long each stage of a run took, computed from the run's own action log. Nothing here is
// written by hand: a stage starts at the `stage` line that entered it (scripts/stage.sh writes
// those) and ends at the next one, and the first stage, `dispatched`, starts at the postmaster's
// `dispatch` line.
//
//   run-times.sh <dispatch>      the table, from <dispatch>/actions.jsonl
//
// Waiting is the part of a stage when no coachman leg was running: from one leg's `handoff`
// to the next leg's `handoff-accept`. A run whose log has neither shows waiting as "-".
// A terminal stage (done, abandoned) is a moment, not a span. A last stage that is not
// terminal is open, and is measured to the last logged action.
//
//   exit 0  printed
//   exit 1  usage, or the log is missing or unreadable
//   exit 3  the log has no stage changes to time
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

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

export function times(dispatch: string): number {
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
if (import.meta.main) {
  if (argv.length !== 1) {
    console.error("usage: run-times.sh <dispatch>");
    process.exit(1);
  }
  process.exit(times(argv[0] as string));
}
