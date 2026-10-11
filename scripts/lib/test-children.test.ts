import { describe, expect, test } from "bun:test";
import { countsTowardReport, startedDuringTest } from "./test-children.ts";

describe("startedDuringTest", () => {
  test("unreadable counts as the test's, and the slop covers clock granularity", () => {
    expect(startedDuringTest(null, 10_000)).toBe(true);
    expect(startedDuringTest(10_100, 10_000)).toBe(true);
    expect(startedDuringTest(9_000, 10_000)).toBe(true);
    expect(startedDuringTest(8_499, 10_000)).toBe(false);
  });
});

describe("countsTowardReport", () => {
  const entry = (over: { stat?: string; started?: number | null; command?: string }) => ({
    pid: 1,
    ppid: 0,
    stat: over.stat ?? "S",
    command: over.command ?? "sleep 30",
    started: over.started ?? 10_100,
  });

  test("a running start of the test counts, and a zombie never does", () => {
    expect(countsTowardReport(entry({}), 10_000)).toBe(true);
    expect(countsTowardReport(entry({ stat: "Z" }), 10_000)).toBe(false);
    expect(countsTowardReport(entry({ stat: "Z+", command: "" }), 10_000)).toBe(false);
    expect(countsTowardReport(entry({ started: 8_000 }), 10_000)).toBe(false);
  });
});
