import { describe, expect, test } from "bun:test";
import type { RunRecord } from "../../2026-10-03-lane-audit/apparatus/records.ts";
import type { Launch } from "./measure.ts";
import {
  CONTRIBUTOR_TIER,
  perRun,
  perRunSection,
  type Prices,
  roleDollars,
  STANDARD_TIER,
  withRatesOf,
} from "./model-bill.ts";

const entry = (input: number, cachedInput: number, output: number) => ({
  input,
  cachedInput,
  cacheWrite: input,
  output,
  source: "a page",
  tier: "a tier",
  read: "a day",
});

const prices: Prices = {
  models: {
    [CONTRIBUTOR_TIER]: entry(0.1, 0.002, 0.2),
    [STANDARD_TIER]: entry(1.25, 0.15, 4.25),
    "claude-opus-5-5": entry(4, 0.2, 20),
  },
};

const run = {
  id: "r1",
  team: {
    coachman: { model: CONTRIBUTOR_TIER },
    lanes: { opus: { model: "claude-opus-5-5" } },
  },
} as unknown as RunRecord;
const runs = new Map([["r1", run]]);

const coachman: Launch = {
  run: "r1",
  role: "coachman",
  lane: "coachman",
  harness: "muse",
  tokens: { uncached: 1_000_000, cacheRead: 10_000_000, cacheWrite: 0, output: 100_000, reportedUsd: null },
};
const opus: Launch = {
  run: "r1",
  role: "reviewer",
  lane: "opus",
  harness: "claude",
  tokens: { uncached: 0, cacheRead: 0, cacheWrite: 0, output: 0, reportedUsd: 5 },
  modelUsage: { "claude-opus-5-5": { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 } },
};

describe("re-pricing the coachman at the standard tier", () => {
  test("positive control: the coachman's tokens priced by hand at each tier", () => {
    // 1M x 0.1 + 10M x 0.002 + 0.1M x 0.2 = 0.14; 1M x 1.25 + 10M x 0.15 + 0.1M x 4.25 = 3.175
    expect(roleDollars([coachman, opus], runs, prices, "coachman")).toBeCloseTo(0.14, 9);
    const standard = withRatesOf(prices, { from: CONTRIBUTOR_TIER, to: STANDARD_TIER });
    expect(roleDollars([coachman, opus], runs, standard, "coachman")).toBeCloseTo(3.175, 9);
  });

  test("a run's other dollars move and the Opus dollars, which are the harness's own figure, do not", () => {
    const base = perRun([coachman, opus], runs, prices);
    const standard = perRun([coachman, opus], runs, withRatesOf(prices, { from: CONTRIBUTOR_TIER, to: STANDARD_TIER }));
    expect(base).toHaveLength(1);
    expect(base[0]?.opus).toBe(5);
    expect(base[0]?.other).toBeCloseTo(0.14, 9);
    expect(standard).toHaveLength(1);
    expect(standard[0]?.opus).toBe(5);
    expect(standard[0]?.other).toBeCloseTo(3.175, 9);
  });

  test("negative control: swapping a model no launch used, or a model for itself, changes nothing", () => {
    const base = perRun([coachman, opus], runs, prices);
    expect(perRun([coachman, opus], runs, withRatesOf(prices, { from: "nobody", to: STANDARD_TIER }))).toEqual(base);
    expect(perRun([coachman, opus], runs, withRatesOf(prices, { from: STANDARD_TIER, to: STANDARD_TIER }))).toEqual(base);
  });

  test("negative control: a role with no launches reads zero", () => {
    expect(roleDollars([opus], runs, prices, "coachman")).toBe(0);
  });

  test("a target with no price is an error, not a silent zero", () => {
    expect(() => withRatesOf(prices, { from: CONTRIBUTOR_TIER, to: "no-such-model" })).toThrow("no price for no-such-model");
  });
});

describe("perRunSection", () => {
  test("states the mean, median and most, and the two shares add to 100", () => {
    const text = perRunSection(
      [
        { run: "a", opus: 30, other: 10 },
        { run: "b", opus: 10, other: 10 },
      ],
      "dollars as measured",
    );
    expect(text).toContain("Per run (2 runs with priced launches), dollars as measured:");
    expect(text).toContain("| mean | 20.00 | 10.00 | 30.00 |");
    expect(text).toContain("| median | 20.00 | 10.00 | 30.00 |");
    expect(text).toContain("| most | 30.00 | 10.00 | 40.00 |");
    expect(text).toContain("| share of all dollars | 67% | 33% | |");
  });
});
