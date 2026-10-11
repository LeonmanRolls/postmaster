import { describe, expect, test } from "bun:test";
import { startedDuringTest } from "./test-children.ts";

describe("startedDuringTest", () => {
  test("unreadable counts as the test's, and the slop covers clock granularity", () => {
    expect(startedDuringTest(null, 10_000)).toBe(true);
    expect(startedDuringTest(10_100, 10_000)).toBe(true);
    expect(startedDuringTest(9_000, 10_000)).toBe(true);
    expect(startedDuringTest(8_499, 10_000)).toBe(false);
  });
});
