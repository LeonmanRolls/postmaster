import { describe, expect, test } from "bun:test";
import type { RunRecord } from "../../2026-10-03-lane-audit/apparatus/records.ts";
import {
  type Interval,
  intervalsOf,
  load,
  loadTable,
  longerThan,
  peakInOneRun,
  runHours,
  shareAtLeast,
  windowOf,
} from "./concurrency.ts";

describe("load", () => {
  test("positive control, worked by hand: [0,10], [5,15] and [20,30] over [0,30]", () => {
    const l = load([
      [0, 10],
      [5, 15],
      [20, 30],
    ]);
    expect(l.peak).toBe(2);
    expect(l.seconds).toBe(30);
    expect(l.average).toBeCloseTo(1, 12); // 30 seconds of interval over a 30 second window
    expect(l.hist).toEqual({ 0: 5, 1: 20, 2: 5 });
    expect(shareAtLeast(l, 2)).toBeCloseTo(5 / 30, 12);
  });

  test("the seconds at each count add up to the window", () => {
    const l = load([
      [0, 100],
      [10, 40],
      [30, 90],
      [200, 300],
    ]);
    expect(Object.values(l.hist).reduce((a, b) => a + b, 0)).toBe(l.seconds);
  });

  test("two launches that touch end to end are not at once", () => {
    expect(load([[0, 10], [10, 20]]).peak).toBe(1);
  });

  test("an interval is clipped to a window", () => {
    const l = load([[0, 100]], [40, 60]);
    expect(l.seconds).toBe(20);
    expect(l.average).toBe(1);
    expect(l.peak).toBe(1);
  });

  test("negative control: no intervals, or a window with no length, read zero", () => {
    expect(load([])).toEqual({ peak: 0, average: 0, seconds: 0, hist: {} });
    expect(load([[5, 5]]).peak).toBe(0);
    expect(shareAtLeast(load([]), 1)).toBe(0);
    expect(windowOf([])).toBeNull();
  });
});

const iso = (s: number): string => new Date(s * 1000).toISOString().replace(".000Z", "Z");

describe("intervalsOf", () => {
  const run = {
    lanes: [
      { implementFrom: iso(100), finished: iso(700) },
      { implementFrom: iso(100), finished: null },
    ],
    reviewLaunches: [
      { ts: iso(1000), lane: "a", lens: "bug", round: 1 },
      { ts: iso(1002), lane: "b", lens: "bug", round: 1 },
    ],
    reviewDone: [
      { round: 1, lens: "bug", lane: "a", done: iso(1300) },
      { round: 2, lens: "bug", lane: "a", done: iso(1500) },
    ],
    gates: [
      { name: "gate", ts: iso(2000), seconds: 600 },
      { name: "other", ts: iso(2100), seconds: 50 },
    ],
    stages: [
      { stage: "planning", at: iso(0), seconds: 100 },
      { stage: "done", at: iso(5000), seconds: 10 },
      { stage: "review", at: iso(900), seconds: null },
      { stage: "synthesis", at: iso(700), seconds: 300 },
    ],
  } as unknown as RunRecord;
  const k = intervalsOf(run);

  test("a lane runs from its implementing start to its exit, and a lane with no exit is left out", () => {
    expect(k.lanes).toEqual([[100, 700]]);
  });

  test("a reviewer runs from its round's first launch line to its exit, and a round with no launch line is left out", () => {
    expect(k.reviewers).toEqual([[1000, 1300]]);
  });

  test("a gate ends when it was logged and runs for its seconds; only the gate counts", () => {
    expect(k.gates).toEqual([[1400, 2000]]);
  });

  test("the coachman is in the stages a leg can run in, with a length", () => {
    const sorted = [...k.coachman].sort((a: Interval, b: Interval) => a[0] - b[0]);
    expect(sorted).toEqual([
      [0, 100],
      [700, 1000],
    ]);
  });
});

describe("loadTable", () => {
  test("has a row for each kind and for the kinds together", () => {
    const text = loadTable({ lanes: [[0, 10]], reviewers: [[5, 20]], gates: [], coachman: [[0, 20]] });
    expect(text.split("\n")).toHaveLength(2 + 5);
    expect(text).toContain("| workhorse lanes | 1 |");
    expect(text).toContain("| gate runs | 0 | 0.0 | 0% | 0% |");
  });
});

describe("runHours", () => {
  test("a run's life is the hours from its first to its last timestamp, and a run with no timestamp has none", () => {
    const withTimes = { id: "a", stages: [{ at: iso(0) }, { at: iso(7200) }], note: "x" } as unknown as RunRecord;
    const none = { id: "b" } as unknown as RunRecord;
    expect(runHours([withTimes, none])).toEqual([2]);
    expect(runHours([])).toEqual([]);
  });
});

describe("peakInOneRun", () => {
  const withIntervals = (lanes: Array<[number, number]>, stages: Array<[number, number]>): RunRecord =>
    ({
      lanes: lanes.map(([a, b]) => ({ implementFrom: iso(a), finished: iso(b) })),
      reviewLaunches: [],
      reviewDone: [],
      gates: [],
      stages: stages.map(([at, seconds]) => ({ stage: "planning", at: iso(at), seconds })),
    }) as unknown as RunRecord;

  test("positive control: the peak is taken inside each run, not across runs that overlap in time", () => {
    const a = withIntervals([[0, 100], [0, 100]], []);
    const b = withIntervals([[0, 100]], []);
    expect(peakInOneRun([a, b], false)).toBe(2);
  });

  test("the coachman's stages count only when asked", () => {
    const a = withIntervals([[0, 100]], [[0, 100]]);
    expect(peakInOneRun([a], false)).toBe(1);
    expect(peakInOneRun([a], true)).toBe(2);
  });

  test("negative control: no runs have a peak of zero", () => {
    expect(peakInOneRun([], true)).toBe(0);
  });
});

describe("longerThan", () => {
  test("positive control: a stage one second over 24 hours counts and one of exactly 24 hours does not", () => {
    const day = 24 * 3600;
    expect(longerThan([[0, day + 1]], 24).count).toBe(1);
    expect(longerThan([[0, day]], 24).count).toBe(0);
  });

  test("the longest is in hours, and no intervals give zero", () => {
    expect(longerThan([[0, 3600], [0, 7200]], 24)).toEqual({ count: 0, longest: 2 });
    expect(longerThan([], 24)).toEqual({ count: 0, longest: 0 });
  });
});
