// Tests beside scripts/leg-end.ts: one command ends a leg with every marker.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scriptsDir } from "./lib/paths.ts";
import { run, withTempDir } from "./lib/proc.ts";
import { endLeg } from "./leg-end.ts";

const HERE = scriptsDir(import.meta);

const HANDOFF = `## Decisions
Done.

## Deferred findings
None.

## Verified by execution
Run.

## Unverified
Nothing.

## Branches and lanes
One branch.

## Open questions
None.

## Next leg
Leg 2 starts here.
`;

const fresh = (root: string, turnpikes: string): string => {
  const d = join(root, "T-1");
  mkdirSync(join(d, "logs"), { recursive: true });
  writeFileSync(join(d, "run.json"), '{"coachman_contract": 2}\n');
  writeFileSync(join(d, "brief.md"), `# Waybill: T-1\nturnpikes: ${turnpikes}\n\n## Ticket\n\ntest\n`);
  writeFileSync(join(d, "run-log.md"), "");
  writeFileSync(join(d, "actions.jsonl"), "");
  writeFileSync(join(d, "handoff-1.md"), HANDOFF);
  return d;
};

const handoffs = (d: string): number => {
  try {
    return readFileSync(join(d, "actions.jsonl"), "utf8")
      .split("\n")
      .filter((l) => l.includes('"action":"handoff"')).length;
  } catch {
    return 0;
  }
};

describe("leg-end", () => {
  test("a first leg ends with .leg-1-done alone, and the handoff is logged", () => {
    withTempDir((root) => {
      const d = fresh(root, "style");
      expect(endLeg(d, "1", "leg 1 ends: synthesis green")).toBe(0);
      expect(existsSync(join(d, ".leg-1-done"))).toBe(true);
      expect(existsSync(join(d, ".card-ready"))).toBe(false);
      expect(handoffs(d)).toBe(1);
      expect(readFileSync(join(d, "actions.jsonl"), "utf8")).toContain("leg 1 ends: synthesis green");
    }, "leg-end-");
  });

  test("a last leg ends with both markers", () => {
    withTempDir((root) => {
      const d = fresh(root, "none");
      expect(endLeg(d, "1", "leg 1 ends: synthesis green")).toBe(0);
      expect(existsSync(join(d, ".leg-1-done"))).toBe(true);
      expect(existsSync(join(d, ".card-ready"))).toBe(true);
    }, "leg-end-");
  });

  test("a hand-off that fails handoff-check writes no marker and logs nothing", () => {
    withTempDir((root) => {
      const d = fresh(root, "none");
      writeFileSync(join(d, "handoff-1.md"), HANDOFF.replace("## Next leg\nLeg 2 starts here.\n", ""));
      expect(endLeg(d, "1", "leg 1 ends")).toBe(2);
      expect(existsSync(join(d, ".leg-1-done"))).toBe(false);
      expect(existsSync(join(d, ".card-ready"))).toBe(false);
      expect(handoffs(d)).toBe(0);
    }, "leg-end-");
  });

  test("a missing hand-off writes no marker", () => {
    withTempDir((root) => {
      const d = fresh(root, "none");
      expect(endLeg(d, "2", "leg 2 ends")).toBe(1);
      expect(existsSync(join(d, ".leg-2-done"))).toBe(false);
      expect(existsSync(join(d, ".card-ready"))).toBe(false);
    }, "leg-end-");
  });

  for (const leg of ["0", "x", "1x"]) {
    test(`leg ${leg} is refused`, () => {
      withTempDir((root) => {
        const d = fresh(root, "none");
        expect(endLeg(d, leg, "ends")).toBe(1);
        expect(handoffs(d)).toBe(0);
      }, "leg-end-");
    });
  }

  test("unreadable legs write no marker", () => {
    withTempDir((root) => {
      const d = fresh(root, "none");
      writeFileSync(join(d, "brief.md"), "# Waybill: T-1\n\n## Ticket\n\nno turnpikes line\n");
      expect(endLeg(d, "1", "leg 1 ends")).toBe(1);
      expect(existsSync(join(d, ".leg-1-done"))).toBe(false);
      expect(handoffs(d)).toBe(0);
    }, "leg-end-");
  });

  test("usage without a detail is refused", () => {
    const r = run(join(HERE, "run"), ["leg-end", "somewhere", "1"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("usage: run leg-end");
  });
});
