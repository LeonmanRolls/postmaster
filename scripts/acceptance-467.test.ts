// Oracle for #467: the flow's commands take over the steps a coachman missed at
// the lowest effort. Each test spawns the commands the way they are run: a
// review round's launch and wait, the stage command, and the leg's end.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { actions, gitOrThrow, machine, tool, type Machine } from "./acceptance-467.ts";
import { withTempDir } from "./lib/proc.ts";

const HANDOFF = `## Decisions
The oracle decision: blind acceptance tests written as the first commit.

## Deferred findings
None.

## Verified by execution
The leg-end command exits 0 on this fixture.

## Unverified
Nothing.

## Branches and lanes
Branch T-1; no lanes ran.

## Open questions
None.

## Next leg
Leg 2 starts from this hand-off.
`;

function reachPoint(m: Machine, round: string): Record<string, unknown> | null {
  for (const line of actions(m)) {
    if (line.action !== "reach" || line.target !== round) continue;
    const detail = JSON.parse(line.detail) as Record<string, unknown>;
    if (detail.kind === "point") return { ts: line.ts, ...detail };
  }
  return null;
}

function voids(m: Machine): number {
  let n = 0;
  for (const line of actions(m)) {
    if (line.action !== "reach") continue;
    try {
      if ((JSON.parse(line.detail) as { kind?: string }).kind === "void") n += 1;
    } catch {
      // not a reach detail; the reach lines all are
    }
  }
  return n;
}

/** A full round 1 with the ghost reviewer, which is collected at once. */
function launchedRound(m: Machine): { code: number; out: string; err: string } {
  const scratch = join(m.repo, ".worktrees", "T-1-rev-style-ghost");
  const cut = tool(m, "cut-scratch", m.repo, m.synthesis, scratch, m.snap, "--clone", m.base);
  expect(cut.code).toBe(0);
  return tool(m, "review-round", "launch", m.dispatch, "1", m.repo, m.synthesis);
}

describe("C1: launch saves the round's starting state", () => {
  test(
    "launch writes before-r1.json before the first reviewer starts",
    () => {
      withTempDir((root) => {
        const m = machine(root, { briefs: ["style"] });
        const launched = launchedRound(m);
        expect(launched.code).toBe(0);
        const snapshot = join(m.dispatch, "reach", "before-r1.json");
        expect(existsSync(snapshot)).toBe(true);
        const saved = JSON.parse(readFileSync(snapshot, "utf8")) as {
          round: number;
          synthesisHead: string;
        };
        expect(saved.round).toBe(1);
        expect(saved.synthesisHead).toBe(m.snap);
        const marker = join(m.dispatch, "logs", "review-r1-style-ghost.done");
        expect(existsSync(marker)).toBe(true);
        expect(statSync(snapshot).mtimeMs).toBeLessThan(statSync(marker).mtimeMs);
      }, "acceptance-467-c1-");
    },
    300_000,
  );
});

describe("C2: wait runs the round's reach check", () => {
  test(
    "after launch returns, the round's point is logged after the markers",
    () => {
      withTempDir((root) => {
        const m = machine(root, { briefs: ["style"] });
        const launched = launchedRound(m);
        expect(launched.code).toBe(0);
        expect(launched.out).toContain("r1: ");
        const point = reachPoint(m, "r1");
        expect(point).not.toBeNull();
        const lines = actions(m);
        let lastLaunch = -1;
        let atPoint = -1;
        lines.forEach((line, i) => {
          if (line.action === "review-launch") lastLaunch = i;
          if (line.action === "reach" && line.target === "r1") atPoint = i;
        });
        expect(lastLaunch).toBeGreaterThanOrEqual(0);
        expect(atPoint).toBeGreaterThan(lastLaunch);
        const marker = join(m.dispatch, "logs", "review-r1-style-ghost.done");
        const journal = join(m.dispatch, "actions.jsonl");
        expect(statSync(marker).mtimeMs).toBeLessThan(statSync(journal).mtimeMs);
        writeFileSync(join(m.synthesis, "later.txt"), "after\n");
        gitOrThrow(m.synthesis, "add", "later.txt");
        gitOrThrow(m.synthesis, "commit", "-q", "-m", "later fix");
        expect(actions(m).filter((l) => l.action === "degrade").length).toBe(0);
        expect(voids(m)).toBe(0);
      }, "acceptance-467-c2-");
    },
    300_000,
  );

  test("wait run alone ends with the round's check", () => {
    withTempDir((root) => {
      const m = machine(root, { briefs: ["style"] });
      expect(tool(m, "reach", "before", m.dispatch, "1").code).toBe(0);
      expect(tool(m, "review-round", "start", m.dispatch, "1").code).toBe(0);
      writeFileSync(join(m.dispatch, "logs", "review-r1-style-ghost.done"), "");
      const waited = tool(m, "review-round", "wait", m.dispatch, "1", m.repo, "style:ghost");
      expect(waited.code).toBe(0);
      expect(waited.out).toContain("r1: ");
      expect(reachPoint(m, "r1")).not.toBeNull();
      writeFileSync(join(m.synthesis, "later.txt"), "after\n");
      gitOrThrow(m.synthesis, "add", "later.txt");
      gitOrThrow(m.synthesis, "commit", "-q", "-m", "later fix");
      expect(actions(m).filter((l) => l.action === "degrade").length).toBe(0);
      expect(voids(m)).toBe(0);
    }, "acceptance-467-c2b-");
  });
});

describe("C3: launch refuses a missing brief", () => {
  test("a missing style brief is named, and no reviewer starts", () => {
    withTempDir((root) => {
      const m = machine(root, {});
      const launched = tool(m, "review-round", "launch", m.dispatch, "1", m.repo, m.synthesis);
      expect(launched.code).not.toBe(0);
      expect(`${launched.out}\n${launched.err}`).toContain("review-style-brief.md");
      expect(actions(m).filter((l) => l.action === "review-launch").length).toBe(0);
      expect(readdirSync(join(m.dispatch, "logs")).filter((f) => f.endsWith(".done")).length).toBe(
        0,
      );
    }, "acceptance-467-c3-");
  });

  test("with the brief present the round launches past the brief gate", () => {
    withTempDir((root) => {
      const m = machine(root, { briefs: ["style"] });
      const launched = tool(m, "review-round", "launch", m.dispatch, "1", m.repo, m.synthesis);
      expect(launched.code).not.toBe(0);
      expect(`${launched.out}\n${launched.err}`).toContain("SCRATCH NOT READY");
    }, "acceptance-467-c3b-");
  });

  test("a security lane with its own skill needs no brief", () => {
    withTempDir((root) => {
      const m = machine(root, {
        turnpikes: "security",
        reviewers: "luna",
        lanes: { luna: { harness: "claude", model: "m" } },
      });
      const launched = tool(m, "review-round", "launch", m.dispatch, "1", m.repo, m.synthesis);
      expect(launched.code).not.toBe(0);
      expect(`${launched.out}\n${launched.err}`).toContain("SCRATCH NOT READY");
    }, "acceptance-467-c3c-");
  });

  test("a security lane without a skill is refused on the missing brief", () => {
    withTempDir((root) => {
      const m = machine(root, {
        turnpikes: "security",
        reviewers: "luna",
        lanes: { luna: { harness: "codex", model: "m" } },
      });
      const launched = tool(m, "review-round", "launch", m.dispatch, "1", m.repo, m.synthesis);
      expect(launched.code).not.toBe(0);
      expect(`${launched.out}\n${launched.err}`).toContain("review-security-brief.md");
      expect(actions(m).filter((l) => l.action === "review-launch").length).toBe(0);
    }, "acceptance-467-c3d-");
  });

  test("the bug lens launches with no brief at all", () => {
    withTempDir((root) => {
      const m = machine(root, {
        turnpikes: "bug",
        teamExtra: ["bug reviewers: ghost"],
      });
      const launched = tool(m, "review-round", "launch", m.dispatch, "1", m.repo, m.synthesis);
      expect(launched.code).not.toBe(0);
      expect(`${launched.out}\n${launched.err}`).toContain("SCRATCH NOT READY");
    }, "acceptance-467-c3e-");
  });
});

describe("C4: stage refuses a skipped stage", () => {
  test("a single-thread run entering checkpoint-1 from bootstrapped is refused naming synthesis", () => {
    withTempDir((root) => {
      const m = machine(root, {
        mode: "single-thread",
        stage: "bootstrapped",
        stageHistory: ["bootstrapped"],
      });
      const refused = tool(m, "stage", m.dispatch, "checkpoint-1");
      expect(refused.code).not.toBe(0);
      expect(`${refused.out}\n${refused.err}`).toContain("synthesis");
      const manifest = JSON.parse(readFileSync(join(m.dispatch, "manifest.json"), "utf8")) as {
        stage: string;
      };
      expect(manifest.stage).toBe("bootstrapped");
      expect(tool(m, "stage", m.dispatch, "synthesis").code).toBe(0);
      expect(tool(m, "stage", m.dispatch, "checkpoint-1").code).toBe(0);
    }, "acceptance-467-c4-");
  });

  test("a synthesis run entering checkpoint-1 from bootstrapped names workhorses-running", () => {
    withTempDir((root) => {
      const m = machine(root, { stage: "bootstrapped", stageHistory: ["bootstrapped"] });
      const refused = tool(m, "stage", m.dispatch, "checkpoint-1");
      expect(refused.code).not.toBe(0);
      expect(`${refused.out}\n${refused.err}`).toContain("workhorses-running");
    }, "acceptance-467-c4b-");
  });

  test("checkpoint-1 to shipping with no review leg is not refused", () => {
    withTempDir((root) => {
      const m = machine(root, {
        turnpikes: "none",
        stage: "checkpoint-1",
        stageHistory: ["bootstrapped", "workhorses-running", "synthesis", "checkpoint-1"],
      });
      expect(tool(m, "stage", m.dispatch, "shipping").code).toBe(0);
    }, "acceptance-467-c4c-");
  });

  test("setting the stage a run is already in is not refused", () => {
    withTempDir((root) => {
      const m = machine(root, {
        stage: "checkpoint-1",
        stageHistory: ["bootstrapped", "workhorses-running", "synthesis", "checkpoint-1"],
      });
      expect(tool(m, "stage", m.dispatch, "checkpoint-1").code).toBe(0);
    }, "acceptance-467-c4d-");
  });

  test("abandoned from any stage is not refused", () => {
    withTempDir((root) => {
      const m = machine(root, { stage: "bootstrapped", stageHistory: ["bootstrapped"] });
      expect(tool(m, "stage", m.dispatch, "abandoned", "postmaster").code).toBe(0);
    }, "acceptance-467-c4e-");
  });
});

describe("C5: one command ends a leg", () => {
  test("a first leg ends with .leg-1-done alone", () => {
    withTempDir((root) => {
      const m = machine(root, {});
      writeFileSync(join(m.dispatch, "handoff-1.md"), HANDOFF);
      expect(tool(m, "run-log", m.dispatch, "--section", "synthesis").code).toBe(0);
      const ended = tool(m, "leg-end", m.dispatch, "1", "leg 1 ends: synthesis green");
      expect(ended.code).toBe(0);
      expect(existsSync(join(m.dispatch, ".leg-1-done"))).toBe(true);
      expect(existsSync(join(m.dispatch, ".card-ready"))).toBe(false);
      expect(actions(m).filter((l) => l.action === "handoff").length).toBe(1);
    }, "acceptance-467-c5-");
  });

  test("a last leg ends with both markers", () => {
    withTempDir((root) => {
      const m = machine(root, { turnpikes: "none" });
      writeFileSync(join(m.dispatch, "handoff-1.md"), HANDOFF);
      expect(tool(m, "run-log", m.dispatch, "--section", "synthesis").code).toBe(0);
      const ended = tool(m, "leg-end", m.dispatch, "1", "leg 1 ends: synthesis green");
      expect(ended.code).toBe(0);
      expect(existsSync(join(m.dispatch, ".leg-1-done"))).toBe(true);
      expect(existsSync(join(m.dispatch, ".card-ready"))).toBe(true);
    }, "acceptance-467-c5b-");
  });

  test("a hand-off that fails handoff-check writes no marker", () => {
    withTempDir((root) => {
      const m = machine(root, { turnpikes: "none" });
      writeFileSync(
        join(m.dispatch, "handoff-1.md"),
        HANDOFF.replace("## Next leg\nLeg 2 starts from this hand-off.\n", ""),
      );
      const ended = tool(m, "leg-end", m.dispatch, "1", "leg 1 ends: synthesis green");
      expect(ended.code).not.toBe(0);
      expect(existsSync(join(m.dispatch, ".leg-1-done"))).toBe(false);
      expect(existsSync(join(m.dispatch, ".card-ready"))).toBe(false);
    }, "acceptance-467-c5c-");
  });

  test("after a withdrawal the same command puts both markers back", () => {
    withTempDir((root) => {
      const m = machine(root, { turnpikes: "none" });
      writeFileSync(join(m.dispatch, "handoff-1.md"), HANDOFF);
      expect(tool(m, "run-log", m.dispatch, "--section", "synthesis").code).toBe(0);
      expect(tool(m, "leg-end", m.dispatch, "1", "leg 1 ends: synthesis green").code).toBe(0);
      rmSync(join(m.dispatch, ".leg-1-done"));
      rmSync(join(m.dispatch, ".card-ready"));
      const ended = tool(m, "leg-end", m.dispatch, "1", "leg 1 ends again: card raised");
      expect(ended.code).toBe(0);
      expect(existsSync(join(m.dispatch, ".leg-1-done"))).toBe(true);
      expect(existsSync(join(m.dispatch, ".card-ready"))).toBe(true);
    }, "acceptance-467-c5d-");
  });
});
