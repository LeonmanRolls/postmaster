// Tests beside scripts/take-in.ts for the workhorse-copy bring-in: a copy
// path that is no repository fails loud, a partial import still logs the
// lane it brought in, and a rejected bring-in names git's reason. Each test
// builds a scratch run T and drives the real scripts as subprocesses,
// through the fixture helpers of scripts/acceptance-348.ts.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkLane,
  commitAll,
  cutWorkhorse,
  gitOrThrow,
  laneCommit,
  makeRun,
  readActions,
  repoBranchHead,
  takeIn,
  touchDone,
  writeRepoFile,
  type RunFixture,
} from "./acceptance-348.ts";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "take-in-"));
}

function withRun(body: (fx: RunFixture) => void): void {
  const dir = tempDir();
  try {
    body(makeRun(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function both(r: { out: string; err: string }): string {
  return `${r.out}\n${r.err}`;
}

/** Two lanes cut, committed, checked and done; the run is ready to take in. */
function readyRun(fx: RunFixture): { luna: string; mimo: string } {
  expect(cutWorkhorse(fx, "luna").code).toBe(0);
  expect(cutWorkhorse(fx, "mimo").code).toBe(0);
  const luna = laneCommit(fx, "luna", "work.txt", "luna work\n");
  const mimo = laneCommit(fx, "mimo", "work.txt", "mimo work\n");
  checkLane(fx, "luna");
  checkLane(fx, "mimo");
  touchDone(fx, "luna");
  touchDone(fx, "mimo");
  return { luna, mimo };
}

/** A stale branch for the lane, on a commit off its copy's history. */
function staleBranch(fx: RunFixture, lane: string): void {
  writeRepoFile(fx.repo, "stale.txt", "stale\n");
  commitAll(fx.repo, "stale");
  gitOrThrow(fx.repo, "branch", fx.branch(lane));
}

describe("take-in over workhorse copies", () => {
  test("a copy path that is no repository fails loud, not as nothing", () => {
    withRun((fx) => {
      mkdirSync(fx.worktree("luna"), { recursive: true });
      mkdirSync(fx.worktree("mimo"), { recursive: true });
      touchDone(fx, "luna");
      touchDone(fx, "mimo");
      const r = takeIn(fx);
      expect(r.code).toBe(1);
      expect(both(r)).toContain("no copy at");
      expect(readActions(fx).filter((a) => a.action === "take-in")).toEqual([]);
      expect(repoBranchHead(fx, "luna")).toBeNull();
      expect(repoBranchHead(fx, "mimo")).toBeNull();
    });
  });

  test("a partial import logs the lane it brought in", () => {
    withRun((fx) => {
      const heads = readyRun(fx);
      staleBranch(fx, "mimo");
      const r = takeIn(fx);
      expect(r.code).toBe(1);
      expect(repoBranchHead(fx, "luna")).toBe(heads.luna);
      const lines = readActions(fx).filter((a) => a.action === "take-in");
      expect(lines.filter((a) => a.target === "luna").length).toBe(1);
      expect(lines.find((a) => a.target === "luna")?.detail).toContain(heads.luna);
      expect(lines.filter((a) => a.target === "mimo")).toEqual([]);
    });
  });

  test("a rejected bring-in names git's reason", () => {
    withRun((fx) => {
      readyRun(fx);
      staleBranch(fx, "mimo");
      const r = takeIn(fx);
      expect(r.code).toBe(1);
      expect(both(r)).toMatch(/could not bring .* in from .+: ./u);
    });
  });
});
