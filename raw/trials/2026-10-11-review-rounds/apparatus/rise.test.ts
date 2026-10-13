import { describe, expect, test } from "bun:test";
import type { RunInput } from "./analysis.ts";
import {
  byRule,
  firstRise,
  groupRows,
  type LoopRule,
  riseReplay,
  roundOneWarning,
  ruleOf,
} from "./rise.ts";

describe("firstRise", () => {
  test("a round that logs more than the round before is a rise, counted from round 2", () => {
    expect(firstRise([3, 5])).toBe(2);
    expect(firstRise([4, 2, 1, 3])).toBe(4);
  });
  test("an equal or falling count is not a rise", () => {
    expect(firstRise([5, 3, 0])).toBeNull();
    expect(firstRise([4, 4, 0])).toBeNull();
  });
  test("a single round and no rounds cannot rise", () => {
    expect(firstRise([2])).toBeNull();
    expect(firstRise([])).toBeNull();
  });
  test("a rise from none counts", () => {
    expect(firstRise([0, 1])).toBe(2);
  });
  test("a rise after a round with none is not one the rule reaches", () => {
    expect(firstRise([4, 0, 1])).toBeNull();
    expect(firstRise([4, 3, 0, 2])).toBeNull();
  });
});

describe("ruleOf", () => {
  test("a commit holding the rise change carries the rise rule", () => {
    expect(ruleOf(true, true)).toBe("rise");
  });
  test("one holding only the scripted decision carries the cap", () => {
    expect(ruleOf(true, false)).toBe("scripted-cap");
  });
  test("one holding neither goes on until clean", () => {
    expect(ruleOf(false, false)).toBe("until-clean");
  });
  test("an unknown commit has no rule", () => {
    expect(ruleOf(null, false)).toBeNull();
    expect(ruleOf(true, null)).toBeNull();
  });
});

describe("riseReplay", () => {
  const runs = [
    { run: "1", rounds: 2, best: [2, 0] },
    { run: "2", rounds: 3, best: [1, 3, 0] },
    { run: "3", rounds: 7, best: [3, 2, 2, 4, 3, 1, 0] },
    { run: "4", rounds: 3, best: [4, 4, 0] },
  ];
  test("counts the runs that rose and the rounds that followed the first rise", () => {
    const r = riseReplay(runs);
    expect(r.runs).toBe(4);
    expect(r.rounds).toBe(15);
    expect(r.rose).toBe(2);
    expect(r.neverRose).toBe(2);
    expect(r.firstRounds).toEqual([2, 4]);
    expect(r.roundsAfterFirstRise).toBe(1 + 3);
    expect(r.roundsMedianRose).toBe(5);
    expect(r.roundsMedianNever).toBe(2.5);
    expect(r.long).toBe(1);
    expect(r.longRose).toBe(1);
  });
  test("a set in which nothing rises reports none", () => {
    const r = riseReplay([{ run: "1", rounds: 2, best: [2, 0] }]);
    expect(r.rose).toBe(0);
    expect(r.roundsAfterFirstRise).toBe(0);
    expect(Number.isNaN(r.roundsMedianRose)).toBe(true);
  });
});

describe("byRule", () => {
  const rules = new Map<string, LoopRule>([
    ["1", "scripted-cap"],
    ["2", "scripted-cap"],
    ["3", "rise"],
  ]);
  test("groups the runs by their rule and leaves out runs with none", () => {
    const rows = byRule(
      [
        { run: "1", rounds: 2 },
        { run: "2", rounds: 5 },
        { run: "3", rounds: 4 },
        { run: "9", rounds: 8 },
      ],
      rules,
    );
    const capped = rows.find((r) => r.rule === "scripted-cap");
    expect(capped?.runs).toBe(2);
    expect(capped?.rounds).toBe(7);
    expect(capped?.median).toBe(3.5);
    expect(capped?.most).toBe(5);
    expect(capped?.pastThree).toBe(1);
    expect(rows.find((r) => r.rule === "rise")?.runs).toBe(1);
    expect(rows.find((r) => r.rule === "until-clean")?.runs).toBe(0);
  });
});

describe("roundOneWarning", () => {
  const runs = [
    { run: "1", rounds: 2, best: [1, 0] },
    { run: "2", rounds: 7, best: [6, 3, 2, 2, 1, 1, 0] },
    { run: "3", rounds: 5, best: [5, 3, 2, 1, 0] },
    { run: "4", rounds: 6, best: [2, 2, 3, 1, 1, 0] },
  ];
  test("flags the runs with at least the threshold in round 1", () => {
    const w = roundOneWarning(runs, 5);
    expect(w.flagged).toBe(2);
    expect(w.flaggedRounds).toBe(12);
    expect(w.long).toBe(2);
    expect(w.longFlagged).toBe(1);
    expect(w.roundsMedianFlagged).toBe(6);
    expect(w.roundsMedianNot).toBe(4);
  });
  test("a threshold above every count flags nothing", () => {
    const w = roundOneWarning(runs, 100);
    expect(w.flagged).toBe(0);
    expect(w.flaggedRounds).toBe(0);
    expect(w.longFlagged).toBe(0);
  });
});

describe("groupRows", () => {
  const base: Omit<
    RunInput,
    "run" | "mode" | "shape" | "rounds" | "best" | "criteria" | "changeLines"
  > = {
    lines: [],
    decisions: null,
    checks: null,
    notes: null,
    chars: null,
    changeFiles: null,
    fixLines: null,
    dispatchedAt: null,
  };
  const mk = (
    run: string,
    mode: RunInput["mode"],
    shape: RunInput["shape"],
    best: number[],
    criteria: number | null,
    changeLines: number | null,
  ): RunInput => ({ ...base, run, mode, shape, rounds: best.length, best, criteria, changeLines });
  const inputs = [
    mk("1", "synthesis", "one-part", [8, 4, 0], 4, 1000),
    mk("2", "synthesis", "one-part", [2, 0], 5, 500),
    mk("3", "synthesis", "two-part", [4, 0], 10, 4000),
    mk("4", "single-thread", "two-part", [1, 0], 4, null),
  ];
  const rules = new Map<string, LoopRule>([
    ["1", "until-clean"],
    ["2", "scripted-cap"],
    ["3", "scripted-cap"],
    ["4", "rise"],
  ]);
  test("splits A at the scripted decision and keeps its parts adding up to the whole", () => {
    const rows = groupRows(inputs, rules);
    const get = (label: string) => rows.find((r) => r.label === label);
    expect(get("A, all")?.runs).toBe(2);
    expect(get("A, before the script")?.runs).toBe(1);
    expect(get("A, from the script")?.runs).toBe(1);
    expect(get("B")?.runs).toBe(1);
    expect(get("C")?.runs).toBe(1);
    expect(
      (get("A, before the script")?.rounds ?? 0) + (get("A, from the script")?.rounds ?? 0),
    ).toBe(get("A, all")?.rounds ?? -1);
  });
  test("computes the per-criterion and per-line figures and skips unknown sizes", () => {
    const rows = groupRows(inputs, rules);
    const b = rows.find((r) => r.label === "B");
    expect(b?.perCriterionMedian).toBeCloseTo(0.4, 5);
    expect(b?.perThousandLinesMedian).toBeCloseTo(1, 5);
    const c = rows.find((r) => r.label === "C");
    expect(Number.isNaN(c?.perThousandLinesMedian ?? 0)).toBe(true);
  });
});
