// How many launches ran at once (see ../method.md): each launch is an interval of time, and the load is how
// many intervals cover each moment. Pure functions over the lane audit's derived data; `run.ts` writes the table.
import type { RunRecord } from "../../2026-10-03-lane-audit/apparatus/records.ts";
import { isoSpan } from "./tables.ts";

/** Start and end, in seconds since the epoch. */
export type Interval = readonly [start: number, end: number];

export type Load = {
  /** the most intervals covering one moment */
  peak: number;
  /** the intervals' total seconds over the window's seconds */
  average: number;
  /** the window's seconds */
  seconds: number;
  /** seconds spent at each count of intervals */
  hist: Record<number, number>;
};

const seconds = (iso: string): number => Date.parse(iso) / 1000;

/** The window that covers every interval, or null for none. */
export function windowOf(intervals: readonly Interval[]): Interval | null {
  if (intervals.length === 0) return null;
  return [Math.min(...intervals.map((i) => i[0])), Math.max(...intervals.map((i) => i[1]))];
}

/** The load of a set of intervals over a window (by default the one that just covers them). */
export function load(intervals: readonly Interval[], window: Interval | null = windowOf(intervals)): Load {
  if (window === null || window[1] <= window[0]) return { peak: 0, average: 0, seconds: 0, hist: {} };
  const [from, to] = window;
  const points: Array<[number, number]> = [];
  let total = 0;
  for (const [a, b] of intervals) {
    const start = Math.max(a, from);
    const end = Math.min(b, to);
    if (end <= start) continue;
    points.push([start, 1], [end, -1]);
    total += end - start;
  }
  points.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const hist: Record<number, number> = {};
  let count = 0;
  let peak = 0;
  let last = from;
  for (const [at, delta] of points) {
    if (at > last) hist[count] = (hist[count] ?? 0) + (at - last);
    count += delta;
    peak = Math.max(peak, count);
    last = at;
  }
  if (to > last) hist[count] = (hist[count] ?? 0) + (to - last);
  return { peak, average: total / (to - from), seconds: to - from, hist };
}

/** The share of the window spent with at least `n` intervals running, 0 to 1. */
export function shareAtLeast(l: Load, n: number): number {
  if (l.seconds === 0) return 0;
  let at = 0;
  for (const [count, secs] of Object.entries(l.hist)) if (Number(count) >= n) at += secs;
  return at / l.seconds;
}

export type Kinds = { lanes: Interval[]; reviewers: Interval[]; gates: Interval[]; coachman: Interval[] };

/** The stages in which a coachman leg can be running; planning includes the wait for the spec's review. */
export const COACHMAN_STAGES = ["planning", "workhorses-running", "synthesis", "checkpoint-1", "review"];

/** Each launch of a run as an interval. A reviewer runs from its round's first launch line to its own exit. */
export function intervalsOf(run: RunRecord): Kinds {
  const lanes: Interval[] = run.lanes.flatMap((l): Interval[] =>
    l.implementFrom !== null && l.finished !== null ? [[seconds(l.implementFrom), seconds(l.finished)]] : [],
  );
  const firstLaunch = new Map<number, number>();
  for (const l of run.reviewLaunches) {
    if (l.round === null) continue;
    const at = seconds(l.ts);
    firstLaunch.set(l.round, Math.min(firstLaunch.get(l.round) ?? at, at));
  }
  const reviewers: Interval[] = run.reviewDone.flatMap((d): Interval[] => {
    const start = firstLaunch.get(d.round);
    const end = seconds(d.done);
    return start !== undefined && end >= start ? [[start, end]] : [];
  });
  const gates: Interval[] = run.gates
    .filter((g) => g.name === "gate")
    .map((g): Interval => [seconds(g.ts) - g.seconds, seconds(g.ts)]);
  const coachman: Interval[] = run.stages
    .filter((s) => COACHMAN_STAGES.includes(s.stage) && s.seconds !== null && s.seconds > 0)
    .map((s): Interval => [seconds(s.at), seconds(s.at) + (s.seconds as number)]);
  return { lanes, reviewers, gates, coachman };
}

/** The intervals of several runs, kind by kind. */
export function intervalsOfRuns(runs: readonly RunRecord[]): Kinds {
  const all: Kinds = { lanes: [], reviewers: [], gates: [], coachman: [] };
  for (const run of runs) {
    const k = intervalsOf(run);
    all.lanes.push(...k.lanes);
    all.reviewers.push(...k.reviewers);
    all.gates.push(...k.gates);
    all.coachman.push(...k.coachman);
  }
  return all;
}

/** The most launches at once inside any one run, counting the coachman's stages or not. */
export function peakInOneRun(runs: readonly RunRecord[], withCoachman: boolean): number {
  let peak = 0;
  for (const run of runs) {
    const k = intervalsOf(run);
    const set = [...k.lanes, ...k.reviewers, ...k.gates, ...(withCoachman ? k.coachman : [])];
    peak = Math.max(peak, load(set).peak);
  }
  return peak;
}

/** How many intervals run longer than `hours`, and the length of the longest in hours. */
export function longerThan(intervals: readonly Interval[], hours: number): { count: number; longest: number } {
  const lengths = intervals.map(([a, b]) => (b - a) / 3600);
  return { count: lengths.filter((h) => h > hours).length, longest: lengths.length === 0 ? 0 : Math.max(...lengths) };
}

const pct = (x: number): string => `${Math.round(100 * x)}%`;
const row = (cells: string[]): string => `| ${cells.join(" | ")} |`;

/** A markdown table of the load of each kind and the kinds together, over one common window. */
export function loadTable(k: Kinds): string {
  const everything = [...k.lanes, ...k.reviewers, ...k.gates, ...k.coachman];
  const window = windowOf(everything);
  const sets: Array<[string, Interval[]]> = [
    ["workhorse lanes", k.lanes],
    ["reviewers", k.reviewers],
    ["gate runs", k.gates],
    ["lanes, reviewers and gates together", [...k.lanes, ...k.reviewers, ...k.gates]],
    ["those and the coachman, whenever a run is in one of its stages", everything],
  ];
  const lines = [
    row(["Launches", "Most at once", "Average at once", "Time with 5 or more", "Time with 10 or more"]),
    row(["---", "---", "---", "---", "---"]),
  ];
  for (const [label, intervals] of sets) {
    const l = load(intervals, window);
    lines.push(
      row([label, String(l.peak), l.average.toFixed(1), pct(shareAtLeast(l, 5)), pct(shareAtLeast(l, 10))]),
    );
  }
  return lines.join("\n");
}

/** The hours from the first to the last timestamp in each run's record: its life, waits included. */
export function runHours(runs: readonly RunRecord[]): number[] {
  return runs.flatMap((r): number[] => {
    const span = isoSpan(r);
    return span === null ? [] : [(seconds(span.last) - seconds(span.first)) / 3600];
  });
}
