import { describe, expect, test } from "bun:test";
import { addedIn, compareCounts, parseAuditTable } from "./controls.ts";
import type { RunRow } from "./inventory.ts";

const row = (run: string, rounds: number, byRound: number[]): RunRow =>
  ({
    run,
    rounds,
    seriousByRound: byRound,
    seriousTotal: byRound.reduce((a, b) => a + b, 0),
  }) as RunRow;

describe("the comparison with the audit's table", () => {
  const table = [
    "| Run | Rounds | Severe in round 1 | Severe in all | By round |",
    "| [#57](https://example.org/57) | 6 | 11 | 24 | 1: 11 |",
    "| [#98](https://example.org/98) | 2 | 3 | 3 | 1: 3 |",
  ].join("\n");
  test("rows are read as run, rounds, round 1 and all", () => {
    expect(parseAuditTable(table).get("57")).toEqual({ rounds: 6, r1: 11, all: 24 });
  });
  test("a run that agrees is not listed, and one that differs is (positive and negative control)", () => {
    const rows = [row("57", 6, [11, 6, 2, 4, 1, 0]), row("98", 2, [3, 1])];
    const cmp = compareCounts(rows, parseAuditTable(table));
    expect(cmp.compared).toBe(2);
    expect(cmp.differ.map((d) => d.run)).toEqual(["98"]);
  });
  test("a line is added by a patch where an added line holds it", () => {
    const patch = "--- a\n+++ b\n@@\n-old\n+const a = 1;\n context";
    expect(addedIn(patch, "  const a = 1;")).toBe(true);
    expect(addedIn(patch, "old")).toBe(false);
    expect(addedIn(patch, "")).toBe(false);
  });
});
