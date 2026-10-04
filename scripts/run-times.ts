// How long each stage of a run took, computed from the run's own action log. Nothing here is
// written by hand: a stage starts at the `stage` line that entered it (scripts/run stage writes
// those) and ends at the next one, and the first stage, `dispatched`, starts at the postmaster's
// `dispatch` line.
//
//   run run-times <dispatch>      the table, from <dispatch>/actions.jsonl
//
// Waiting is the part of a stage when no coachman leg was running: from one leg's `handoff`
// to the next leg's `handoff-accept`. A run whose log has neither shows waiting as "-".
// A terminal stage (done, abandoned) is a moment, not a span. A last stage that is not
// terminal is open, and is measured to the last logged action.
//
// `computeTimes` is the same computation for a caller that wants the figures rather than the
// print: the fixture score appends this table and compares its waiting and total, so both
// read the log exactly once, through this.
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

export function parseTs(s: string): Date | null {
  // BASE format is %Y-%m-%dT%H:%M:%SZ; accept that form, and the space-separated one too.
  const iso = s.endsWith("Z") ? s : `${s.replace(" ", "T")}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function fmt(sec: number): string {
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

/** One stage's figures: `tookSec` and `waitSec` are null where the table shows "-". */
export interface StageRow {
  stage: string;
  started: Date;
  tookSec: number | null;
  waitSec: number | null;
}

export interface TimesTable {
  /** The table exactly as `run run-times` prints it, with a trailing newline. */
  text: string;
  rows: StageRow[];
  totalSec: number;
  /** null where the log has no legs, so waiting shows "-". */
  waitedSec: number | null;
}

export type TimesResult =
  | { ok: true; table: TimesTable }
  | { ok: false; code: 1 | 3; message: string; stream: "stdout" | "stderr" };

export function computeTimes(dispatch: string): TimesResult {
  const log = join(dispatch, "actions.jsonl");
  if (!existsSync(log)) {
    return { ok: false, code: 1, message: `run-times: no action log at ${log}`, stream: "stderr" };
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
      return {
        ok: false,
        code: 1,
        message: `run-times: ${log} line ${n + 1} is not a log line`,
        stream: "stderr",
      };
    }
  }
  if (events.length === 0) {
    return { ok: false, code: 1, message: `run-times: ${log} is empty`, stream: "stderr" };
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
    return {
      ok: false,
      code: 3,
      message: `no stage changes logged in ${log}`,
      stream: "stdout",
    };
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

  const rows: StageRow[] = [];
  const display: Array<[string, Date, string, string]> = [];
  let total = 0;
  let waited = 0;
  for (let i = 0; i < starts.length; i++) {
    const [t, stage] = starts[i]!;
    if (TERMINAL.has(stage)) {
      rows.push({ stage, started: t, tookSec: null, waitSec: null });
      display.push([stage, t, "-", "-"]);
      continue;
    }
    const end = i + 1 < starts.length ? starts[i + 1]?.[0] : last;
    const note = i + 1 < starts.length ? "" : " (open)";
    const span = (end.getTime() - t.getTime()) / 1000;
    total += span;
    let wait: string;
    let waitSec: number | null = null;
    if (knownLegs) {
      const w = span - working(t, end);
      waited += w;
      waitSec = w;
      wait = fmt(w);
    } else {
      wait = "-";
    }
    rows.push({ stage: stage + note, started: t, tookSec: span, waitSec });
    display.push([stage + note, t, fmt(span), wait]);
  }

  const hdr = (s: string, t: string, took: string, w: string) =>
    `${s.padEnd(26)} ${t.padEnd(21)} ${took.padEnd(10)} ${w}`;
  const textLines = [hdr("stage", "started (UTC)", "took", "waiting")];
  for (const [stage, t, took, wait] of display) {
    const ts = t.toISOString().slice(0, 19).replace("T", " ");
    textLines.push(hdr(stage, ts, took, wait));
  }
  textLines.push(hdr("total", "", fmt(total), knownLegs ? fmt(waited) : "-"));
  return {
    ok: true,
    table: {
      text: `${textLines.join("\n")}\n`,
      rows,
      totalSec: total,
      waitedSec: knownLegs ? waited : null,
    },
  };
}

export function times(dispatch: string): number {
  const r = computeTimes(dispatch);
  if (r.ok) {
    // console.log of the table minus its trailing newline prints the same bytes as one
    // line per call, and stays capturable beside the script.
    console.log(r.table.text.replace(/\n$/u, ""));
    return 0;
  }
  if (r.stream === "stdout") console.log(r.message);
  else console.error(r.message);
  return r.code;
}

// --- entry ------------------------------------------------------------------------------
const argv = process.argv.slice(2);
if (import.meta.main) {
  if (argv.length !== 1) {
    console.error("usage: run run-times <dispatch>");
    process.exit(1);
  }
  process.exit(times(argv[0] as string));
}
