import { describe, expect, test } from "bun:test";
import { SUPPLEMENT, withSupplement } from "./supplement.ts";

describe("the supplement", () => {
  test("a round with no finding line takes the run's own figure (positive control)", () => {
    const lines = [13, 5, 5, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1];
    const { best, filled } = withSupplement("124", lines);
    expect(best[4]).toBe(6);
    expect(best[17]).toBe(5);
    expect(best[0]).toBe(13);
    expect(filled).toHaveLength(14);
  });
  test("a run with no entry is left as it is (negative control)", () => {
    expect(withSupplement("335", [7, 3, 2])).toEqual({ best: [7, 3, 2], filled: [] });
  });
  test("a round that has finding lines is not replaced", () => {
    expect(withSupplement("38", [9, 7, 6, 2, 4]).best[4]).toBe(4);
  });
  test("every entry names the record it was read from", () => {
    for (const e of Object.values(SUPPLEMENT)) expect(e.source.length).toBeGreaterThan(20);
  });
});
