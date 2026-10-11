import { describe, expect, test } from "bun:test";
import { lcg, pairedDifference, perQuestion, type Session, tally } from "./tabulate.ts";

const session = (
  arrangement: string,
  sample: string,
  results: [string, string, boolean][],
): Session => ({
  model: "m",
  module: "x",
  arrangement,
  sample,
  scored: results.map(([id, type, correct]) => ({ id, type, answered: true, correct })),
});

const sessions: Session[] = [
  session("original", "s1", [
    ["Q1", "trace", true],
    ["Q2", "state", false],
  ]),
  session("original", "s2", [
    ["Q1", "trace", true],
    ["Q2", "state", false],
  ]),
  session("functional", "s1", [
    ["Q1", "trace", true],
    ["Q2", "state", true],
  ]),
  session("functional", "s2", [
    ["Q1", "trace", false],
    ["Q2", "state", true],
  ]),
];

describe("tally", () => {
  test("counts right and asked per type and for all", () => {
    const rows = tally(sessions);
    const get = (arrangement: string, type: string) =>
      rows.find((r) => r.arrangement === arrangement && r.type === type);
    expect(get("original", "all")).toMatchObject({ right: 2, asked: 4, sessions: 2 });
    expect(get("functional", "state")).toMatchObject({ right: 2, asked: 2 });
    expect(get("functional", "trace")).toMatchObject({ right: 1, asked: 2 });
  });
});

describe("paired difference", () => {
  test("is the mean over questions of the share right, one arrangement against the other", () => {
    const a = perQuestion(sessions, "original");
    const b = perQuestion(sessions, "functional");
    expect(a.get("Q1")).toBe(1);
    expect(b.get("Q1")).toBe(0.5);
    const d = pairedDifference(a, b);
    expect(d.n).toBe(2);
    expect(d.mean).toBeCloseTo((-0.5 + 1) / 2, 10);
    expect(d.lo).toBeLessThanOrEqual(d.mean);
    expect(d.hi).toBeGreaterThanOrEqual(d.mean);
  });

  test("an arrangement against itself reads zero, with a zero-width interval", () => {
    const a = perQuestion(sessions, "original");
    expect(pairedDifference(a, a)).toEqual({ n: 2, mean: 0, lo: 0, hi: 0 });
  });

  test("nothing in common reads as no questions", () => {
    expect(pairedDifference(new Map(), new Map([["Q1", 1]])).n).toBe(0);
  });

  test("the generator repeats", () => {
    const x = lcg(7);
    const y = lcg(7);
    expect([x(), x(), x()]).toEqual([y(), y(), y()]);
  });
});
