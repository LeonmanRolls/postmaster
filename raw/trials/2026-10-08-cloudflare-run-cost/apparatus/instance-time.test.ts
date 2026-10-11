import { describe, expect, test } from "bun:test";
import type { RunRecord } from "../../2026-10-03-lane-audit/apparatus/records.ts";
import { covered, runTime, seconds, summarizeRole } from "./instance-time.ts";

/** Only the fields the functions read; the rest of a RunRecord is not needed here. */
function run(over: Record<string, unknown>): RunRecord {
  return {
    id: "t1",
    kind: "real",
    parked: false,
    synthesis: { ranked: [] },
    lanes: [],
    gates: [],
    stages: [],
    reviewLaunches: [],
    reviewDone: [],
    ...over,
  } as unknown as RunRecord;
}

const lane = (implementSeconds: number | null) => ({ lane: "x", implementSeconds });
const gate = (seconds: number, lane: string | null, name = "gate") => ({ name, seconds, lane });
const stage = (name: string, seconds: number | null) => ({ stage: name, at: "", seconds });

describe("runTime", () => {
  const record = run({
    lanes: [lane(2001), lane(2443), lane(null)],
    gates: [gate(932, "sol"), gate(930, "mimo"), gate(924, null), gate(12, null), gate(40, null, "wiki-lint")],
    stages: [
      stage("dispatched", 3),
      stage("planning", 100),
      stage("workhorses-running", 50),
      stage("synthesis", 10),
      stage("checkpoint-1", 5),
      stage("review", 200),
      stage("shipping", 999),
    ],
    reviewLaunches: [
      { ts: "2026-10-02T12:00:00Z", lane: "luna", lens: "bug", round: 1 },
      { ts: "2026-10-02T12:00:02Z", lane: "mimo", lens: "bug", round: 1 },
      { ts: "2026-10-02T12:00:04Z", lane: "opus", lens: "security", round: 1 },
    ],
    reviewDone: [
      { round: 1, lens: "bug", lane: "luna", done: "2026-10-02T12:10:00Z" },
      { round: 1, lens: "bug", lane: "mimo", done: "2026-10-02T12:11:40Z" },
      { round: 1, lens: "security", lane: "opus", done: "2026-10-02T12:08:20Z" },
    ],
  });
  const t = runTime(record);

  test("lanes keep their recorded seconds and count the unmeasured one apart", () => {
    expect(t.lanes.each).toEqual([2001, 2443]);
    expect(t.lanesUnmeasured).toBe(1);
  });

  test("gates split by lane branch and synthesis, and other checks are not gates", () => {
    expect(t.gatesOnLanes.each).toEqual([932, 930]);
    expect(t.gatesOnSynthesis.each).toEqual([924, 12]);
  });

  test("the coachman's upper bound is the stages a leg can run in, not shipping or dispatch", () => {
    expect(t.coachmanUpper).toBe(100 + 50 + 10 + 5 + 200);
  });

  test("each reviewer runs from its round's first launch to its own exit", () => {
    // 12:10:00, 12:11:40 and 12:08:20 less 12:00:00
    expect(t.reviewers.each.sort((a, b) => a - b)).toEqual([500, 600, 700]);
  });
});

describe("a run with nothing recorded", () => {
  const t = runTime(run({}));

  test("negative control: every role reads zero and nothing divides by zero", () => {
    expect(seconds(t.lanes)).toBe(0);
    expect(seconds(t.reviewers)).toBe(0);
    expect(seconds(t.gatesOnLanes)).toBe(0);
    expect(seconds(t.gatesOnSynthesis)).toBe(0);
    expect(t.coachmanUpper).toBe(0);
    expect(t.lanesUnmeasured).toBe(0);
  });

  test("an empty set of runs summarizes to no launches and no medians", () => {
    const s = summarizeRole([], "lanes");
    expect(s).toEqual({
      launches: 0,
      totalSeconds: 0,
      medianPerRun: null,
      medianEach: null,
      p90Each: null,
      longestEach: null,
    });
  });
});

describe("summarizeRole", () => {
  const a = runTime(run({ id: "a", lanes: [lane(100), lane(300)] }));
  const b = runTime(run({ id: "b", lanes: [lane(200), lane(600)] }));

  test("totals, medians per run and per launch", () => {
    const s = summarizeRole([a, b], "lanes");
    expect(s.launches).toBe(4);
    expect(s.totalSeconds).toBe(1200);
    expect(s.medianPerRun).toBe(600); // runs sum to 400 and 800
    expect(s.medianEach).toBe(250); // 100, 200, 300, 600
    expect(s.longestEach).toBe(600);
  });

  test("the 90th percentile is below the longest launch when there are enough launches", () => {
    const many = runTime(run({ id: "m", lanes: Array.from({ length: 20 }, (_, i) => lane((i + 1) * 100)) }));
    const s = summarizeRole([many], "lanes");
    expect(s.p90Each).toBe(1900);
    expect(s.longestEach).toBe(2000);
  });

  test("negative control: with a single launch the 90th percentile and the longest are the same", () => {
    const one = summarizeRole([runTime(run({ id: "o", lanes: [lane(700)] }))], "lanes");
    expect(one.p90Each).toBe(700);
    expect(one.longestEach).toBe(700);
  });
});

describe("covered", () => {
  test("keeps real runs that reached synthesis and drops parked runs and other kinds", () => {
    const runs = [
      run({ id: "1" }),
      run({ id: "2", parked: true }),
      run({ id: "3", synthesis: null }),
      run({ id: "4", kind: "fixture" }),
    ];
    expect(covered(runs, "real").map((r) => r.id)).toEqual(["1"]);
    expect(covered(runs, "fixture").map((r) => r.id)).toEqual(["4"]);
  });
});
