import { describe, expect, test } from "bun:test";
import {
  type LeverFinding,
  type LeverRun,
  leverEffect,
  roundsWithout,
  withDescendants,
} from "./levers.ts";

const f = (
  run: string,
  round: number,
  target: string,
  fixOf: string[] = [],
  placedBefore: string | null = null,
): LeverFinding => ({
  run,
  round,
  target,
  fixOf,
  placedBefore,
});

describe("rounds without some findings", () => {
  const run: LeverRun = { run: "1", rounds: 5, best: [3, 2, 1, 1, 0] };
  test("removing the findings of the last rounds ends the run one round after the new last", () => {
    expect(roundsWithout(run, [0, 0, 0, 1, 0])).toBe(4);
    expect(roundsWithout(run, [0, 0, 1, 1, 0])).toBe(3);
  });
  test("removing findings of a middle round only leaves the rounds as they were (negative control)", () => {
    expect(roundsWithout(run, [0, 1, 0, 0, 0])).toBe(5);
  });
  test("removing every finding leaves one round", () => {
    expect(roundsWithout(run, [3, 2, 1, 1, 0])).toBe(1);
  });
});

describe("what a removed finding leads to", () => {
  const a = f("1", 1, "a.ts:1");
  const b = f("1", 2, "a.ts:9", ["a.ts:1"]);
  const c = f("1", 3, "a.ts:20", ["a.ts:9"]);
  const d = f("1", 3, "z.ts:2");
  const e = f("1", 4, "q.ts:5", [], "a.ts:20");
  test("a finding in a fix of a removed one goes, and so do the ones in its fix and its lines", () => {
    const all = [a, b, c, d, e];
    const gone = withDescendants(all, new Set([a]));
    expect([...gone].map((x) => x.target).sort()).toEqual([
      "a.ts:1",
      "a.ts:20",
      "a.ts:9",
      "q.ts:5",
    ]);
  });
  test("an unrelated finding stays (negative control)", () => {
    const gone = withDescendants([a, d], new Set([a]));
    expect(gone.has(d)).toBe(false);
  });
});

describe("the effect on the rounds", () => {
  const run: LeverRun = { run: "1", rounds: 4, best: [2, 1, 1, 0] };
  const findings = [
    f("1", 1, "x:1"),
    f("1", 1, "x:2"),
    f("1", 2, "y:1", ["x:1"]),
    f("1", 3, "z:1", ["y:1"]),
  ];
  test("removing a root and its descendants removes the rounds they alone held", () => {
    const e = leverEffect([run], findings, new Set([findings[0] as LeverFinding]));
    expect(e?.findings).toBe(3);
    expect(e?.runs).toBe(1);
    expect(e.roundsRemoved).toBe(2);
    expect(e.perRun[0]).toEqual({ run: "1", before: 4, after: 2 });
  });
  test("without the cascade only the chosen finding goes", () => {
    const e = leverEffect([run], findings, new Set([findings[0] as LeverFinding]), false);
    expect(e.findings).toBe(1);
    expect(e.roundsRemoved).toBe(0);
  });
});
