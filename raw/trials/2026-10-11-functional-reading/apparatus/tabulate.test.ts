import { describe, expect, test } from "bun:test";
import {
  isValid,
  lcg,
  pairedDifference,
  perQuestion,
  ratioOfMeans,
  type Session,
  takeValid,
  tally,
} from "./tabulate.ts";

const effort = { outputTokens: 100, thinkingTokens: 80, seconds: 10, dollars: 0.01 };

const session = (
  arrangement: string,
  sample: string,
  results: [string, string, boolean][],
  valid = true,
): Session => ({
  model: "m",
  module: "x",
  arrangement,
  sample,
  valid,
  effort,
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

describe("which sessions count", () => {
  test("answers that were read and are not mostly a bail-out", () => {
    expect(isValid(null, 4)).toBe(false);
    expect(isValid({ a: 1, b: 2, c: "undetermined", d: "undetermined" }, 4)).toBe(true);
    expect(isValid({ a: 1, b: "undetermined", c: "undetermined", d: "undetermined" }, 4)).toBe(
      false,
    );
    expect(isValid({ a: " Undetermined ", b: "undetermined" }, 2)).toBe(false);
  });

  test("the first n valid sessions of an arrangement are taken, in order", () => {
    const many = [
      session("original", "s1", [], false),
      session("original", "s2", []),
      session("original", "s3", []),
      session("original", "s4", []),
      session("functional", "s1", []),
    ];
    expect(takeValid(many, 2).map((s) => `${s.arrangement}:${s.sample}`)).toEqual([
      "original:s2",
      "original:s3",
      "functional:s1",
    ]);
    expect(takeValid(many, undefined)).toHaveLength(4);
  });
});

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

describe("the ratio of efforts", () => {
  test("is the ratio of means, with an interval around it", () => {
    const r = ratioOfMeans([100, 110, 90, 100], [50, 55, 45, 50]);
    expect(r.ratio).toBeCloseTo(0.5, 10);
    expect(r.lo).toBeLessThan(0.5);
    expect(r.hi).toBeGreaterThan(0.5);
  });

  test("the same efforts read as a ratio of one, and an empty side as nothing", () => {
    expect(ratioOfMeans([5, 5], [5, 5])).toEqual({ ratio: 1, lo: 1, hi: 1 });
    expect(ratioOfMeans([], [1])).toEqual({ ratio: 0, lo: 0, hi: 0 });
  });
});
