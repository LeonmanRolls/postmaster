import { describe, expect, test } from "bun:test";
import { cost, INSTANCE_TYPES, type InstanceType } from "./cost.ts";
import type { RunTime } from "./instance-time.ts";
import { auditTotals, breakEven, isoSpan, totalsCost, totalsTable } from "./tables.ts";

const standard3 = INSTANCE_TYPES["standard-3"] as InstanceType;

const runTime = (run: string, lanes: number[], reviewers: number[], coachmanUpper: number): RunTime => ({
  run,
  lanes: { each: lanes },
  lanesUnmeasured: 0,
  reviewers: { each: reviewers },
  gatesOnLanes: { each: [] },
  gatesOnSynthesis: { each: [] },
  coachmanUpper,
});

const times = [runTime("a", [3600, 1800], [600], 36_000), runTime("b", [7200], [1200, 1200], 18_000)];
const uptime = new Map([["a", 7200]]);

describe("auditTotals", () => {
  test("positive control: sums lanes and reviewers, the floor where there is one and every ceiling", () => {
    const t = auditTotals(times, uptime);
    expect(t.runs).toBe(2);
    expect(t.lanesAndReviewers).toBe(3600 + 1800 + 600 + 7200 + 1200 + 1200);
    expect(t.coachmanFloor).toBe(7200);
    expect(t.coachmanFloorRuns).toBe(1);
    expect(t.coachmanCeiling).toBe(54_000);
  });

  test("negative control: no runs read zero everywhere", () => {
    expect(auditTotals([], new Map())).toEqual({
      runs: 0,
      lanesAndReviewers: 0,
      coachmanFloor: 0,
      coachmanFloorRuns: 0,
      coachmanCeiling: 0,
    });
  });

  test("a run with no uptime adds to the ceiling and not to the floor", () => {
    const t = auditTotals(times, new Map());
    expect(t.coachmanFloor).toBe(0);
    expect(t.coachmanCeiling).toBe(54_000);
  });
});

describe("totalsCost", () => {
  const totals = auditTotals(times, uptime);

  test("worked by hand at standard-3 with the CPU idle: 15,600 s and 7,200 s against 54,000 s", () => {
    // per second at standard-3, idle: 8 x 0.0000025 + 16 x 0.00000007 = 0.00002112
    const c = totalsCost(totals, "standard-3", 0);
    expect(c.low).toBeCloseTo((15_600 + 7200) * 0.00002112, 9);
    expect(c.high).toBeCloseTo((15_600 + 54_000) * 0.00002112, 9);
    expect(c.average).toBeCloseTo(c.high / 2, 12);
  });

  test("the low end is below the high end, and a busier CPU costs more", () => {
    const idle = totalsCost(totals, "standard-3", 0);
    const busy = totalsCost(totals, "standard-3", 1);
    expect(idle.low).toBeLessThan(idle.high);
    expect(busy.high).toBeGreaterThan(idle.high);
  });

  test("negative control: no runs cost nothing and the average is 0, not NaN", () => {
    expect(totalsCost(auditTotals([], new Map()), "standard-3", 0.25)).toEqual({ low: 0, high: 0, average: 0 });
  });

  test("summing run by run gives the same as the totals", () => {
    const perRun = times.map((t) => cost(t.lanes.each.concat(t.reviewers.each).reduce((a, b) => a + b, 0) + t.coachmanUpper, standard3, 0.25));
    expect(perRun.reduce((a, b) => a + b, 0)).toBeCloseTo(totalsCost(totals, "standard-3", 0.25).high, 9);
  });
});

describe("totalsTable", () => {
  test("has a row for each size and CPU use, with the size's shape", () => {
    const text = totalsTable(auditTotals(times, uptime), ["standard-3", "standard-4"]);
    expect(text.split("\n")).toHaveLength(2 + 6);
    expect(text).toContain("standard-3 (2 vCPU, 8 GiB) | 25%");
    expect(text).toContain("standard-4 (4 vCPU, 12 GiB) | 100%");
  });
});

describe("breakEven", () => {
  test("positive control: $50 a month against a $5 plan and $4.50 a run is 10 runs", () => {
    expect(breakEven([50], 4.5, 5)[0]).toBeCloseTo(10, 9);
  });

  test("negative control: a price at or under the plan fee is never beaten, and a free run reads 0 not infinity", () => {
    expect(breakEven([5, 3], 4, 5)).toEqual([0, 0]);
    expect(breakEven([50], 0, 5)).toEqual([0]);
  });
});

describe("isoSpan", () => {
  test("finds the earliest and latest timestamps in nested data, and ignores other strings", () => {
    const span = isoSpan({
      id: "201",
      stages: [{ from: "2026-10-01T09:21:20Z" }, { to: "2026-10-03T00:23:57Z" }],
      note: "not a time",
      deep: { a: ["2026-09-30T00:00:00Z"] },
    });
    expect(span).toEqual({ first: "2026-09-30T00:00:00Z", last: "2026-10-03T00:23:57Z" });
  });

  test("negative control: data with no timestamp has no span", () => {
    expect(isoSpan({ a: 1, b: ["x", { c: "2026-10" }] })).toBeNull();
    expect(isoSpan(null)).toBeNull();
  });
});
