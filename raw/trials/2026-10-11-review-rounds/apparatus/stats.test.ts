import { describe, expect, test } from "bun:test";
import {
  kappa,
  lineFit,
  mean,
  median,
  partialSpearman,
  permutationP,
  quantile,
  ranks,
  spearman,
  wilson,
} from "./stats.ts";

describe("summaries", () => {
  test("median of odd and even lists", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(Number.isNaN(median([]))).toBe(true);
  });
  test("mean and nearest-rank quantile", () => {
    expect(mean([1, 2, 3, 6])).toBe(3);
    expect(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBe(9);
    expect(quantile([5], 0.5)).toBe(5);
  });
  test("ties share their mean rank", () => {
    expect(ranks([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4]);
  });
});

describe("correlation", () => {
  test("a list against itself reads 1 and against its reverse -1 (controls)", () => {
    const x = [1, 2, 3, 4, 5, 6];
    expect(spearman(x, x)).toBeCloseTo(1, 10);
    expect(spearman(x, [...x].reverse())).toBeCloseTo(-1, 10);
  });
  test("a constant list has no correlation", () => {
    expect(Number.isNaN(spearman([1, 1, 1, 1], [1, 2, 3, 4]))).toBe(true);
  });
});

describe("agreement and intervals", () => {
  test("kappa is 1 for identical labels and below 0.2 for unrelated ones", () => {
    const a = ["yes", "no", "yes", "no", "unclear", "no", "yes", "no"];
    expect(kappa(a, a)).toBe(1);
    const shuffled = ["no", "yes", "no", "no", "yes", "unclear", "no", "yes"];
    expect(kappa(a, shuffled)).toBeLessThan(0.2);
  });
  test("a Wilson interval holds the share and stays inside 0 and 1", () => {
    const [lo, hi] = wilson(8, 10);
    expect(lo).toBeLessThan(0.8);
    expect(hi).toBeGreaterThan(0.8);
    const [l0, h0] = wilson(0, 5);
    expect(l0).toBeCloseTo(0, 10);
    expect(h0).toBeLessThan(1);
  });
});

describe("permutation test", () => {
  test("a clear difference gives a small p and equal groups a large one", () => {
    expect(permutationP([8, 9, 10, 11, 12, 9], [1, 2, 3, 2, 1, 3], 4000)).toBeLessThan(0.01);
    expect(permutationP([1, 2, 3, 4], [1, 2, 3, 4], 4000)).toBeGreaterThan(0.4);
  });
  test("the same seed gives the same p", () => {
    const a = [3, 5, 4, 8];
    const b = [2, 3, 1, 4, 2];
    expect(permutationP(a, b, 2000, 7)).toBe(permutationP(a, b, 2000, 7));
  });
});

describe("partial correlation and line fit", () => {
  test("x and y that both follow z lose most of their correlation once z is held (positive control)", () => {
    const z = Array.from({ length: 16 }, (_, i) => i + 1);
    const x = z.map((v, i) => v + ((i * 7) % 5) - 2);
    const y = z.map((v, i) => v + ((i * 3) % 5) - 2);
    expect(spearman(x, y)).toBeGreaterThan(0.8);
    expect(Math.abs(partialSpearman(x, y, z))).toBeLessThan(0.6);
  });
  test("a straight line is fitted exactly by both methods", () => {
    const x = [0, 1, 2, 3, 4];
    const y = x.map((v) => 2 + 0.5 * v);
    const fit = lineFit(x, y);
    expect(fit.theilSen.slope).toBeCloseTo(0.5, 10);
    expect(fit.theilSen.intercept).toBeCloseTo(2, 10);
    expect(fit.ols.slope).toBeCloseTo(0.5, 10);
  });
});
