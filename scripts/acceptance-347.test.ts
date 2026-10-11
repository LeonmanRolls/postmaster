// Oracle for #347, committed before the change: the coachman takes in the
// workhorses' work only once none is running or waiting (C1), and only at the
// commit its checks ran on (C2). Each test builds a scratch run T and drives
// the real scripts as subprocesses, never importing the change.
import { describe, expect, test } from "bun:test";
import {
  appendFileSync,
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./lib/proc.ts";
import {
  branchHead,
  checkLane,
  hostEnv,
  laneCommit,
  logAction,
  makeRun,
  readActions,
  RUN,
  setOutcome,
  takeIn,
  touchDone,
  writeRepoFile,
  commitAll,
  type RunFixture,
} from "./acceptance-347.ts";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "acceptance-347-"));
}

function withRun(body: (fx: RunFixture) => void): void {
  const dir = tempDir();
  try {
    body(makeRun(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function takeLines(fx: RunFixture) {
  return readActions(fx)
    .filter((a) => a.action === "take-in")
    .map((a) => ({ action: a.action, target: a.target, detail: a.detail }));
}

describe("C1: taken in only once no workhorse is running or waiting", () => {
  test("a live registered launch refuses, naming that workhorse", () => {
    withRun((fx) => {
      const lunaHead = laneCommit(fx, "luna", "luna.txt", "luna\n");
      const mimoHead = laneCommit(fx, "mimo", "mimo.txt", "mimo\n");
      checkLane(fx, "luna");
      checkLane(fx, "mimo");
      touchDone(fx, "luna");
      touchDone(fx, "mimo");
      const env = hostEnv(fx);
      const wt = fx.worktree("luna");
      const started = run(
        RUN,
        [
          "host",
          "run",
          "take-in-test-luna",
          wt,
          "--out",
          join(fx.dir, "launch.out"),
          "--err",
          join(fx.dir, "launch.err"),
          "--",
          "sleep",
          "60",
        ],
        { env },
      );
      expect(started.code).toBe(0);
      try {
        const r = run(RUN, ["take-in", fx.dispatch], { env });
        expect(r.code).toBe(2);
        expect(r.out).toBe("");
        expect(r.err).toContain("luna");
        expect(r.err).not.toContain("mimo");
        expect(takeLines(fx)).toEqual([]);
        expect(branchHead(fx, "luna")).toBe(lunaHead);
        expect(branchHead(fx, "mimo")).toBe(mimoHead);
      } finally {
        run(RUN, ["host", "stop", wt], { env });
      }
    });
  });

  test("a missing done marker refuses before the commit check runs", () => {
    withRun((fx) => {
      laneCommit(fx, "mimo", "mimo.txt", "mimo\n");
      touchDone(fx, "luna");
      const r = takeIn(fx);
      expect(r.code).toBe(2);
      expect(r.err).toContain("mimo");
      expect(r.err).not.toContain("luna");
      expect(takeLines(fx)).toEqual([]);
    });
  });

  test("an unruled wall refuses, naming that workhorse", () => {
    withRun((fx) => {
      laneCommit(fx, "mimo", "mimo.txt", "mimo\n");
      checkLane(fx, "mimo");
      touchDone(fx, "luna");
      touchDone(fx, "mimo");
      logAction(fx, "lane:luna", "wall", "luna", "workhorse - - none usage limit reached");
      const open = run(RUN, ["walls", "open", fx.dispatch]);
      expect(open.code).toBe(1);
      const r = takeIn(fx);
      expect(r.code).toBe(2);
      expect(r.err).toContain("luna");
      expect(r.err).not.toContain("mimo");
      expect(takeLines(fx)).toEqual([]);
    });
  });

  test("outcome blocked refuses, naming that workhorse", () => {
    withRun((fx) => {
      laneCommit(fx, "luna", "luna.txt", "luna\n");
      laneCommit(fx, "mimo", "mimo.txt", "mimo\n");
      checkLane(fx, "luna");
      checkLane(fx, "mimo");
      touchDone(fx, "luna");
      touchDone(fx, "mimo");
      setOutcome(fx, "mimo", "blocked");
      const r = takeIn(fx);
      expect(r.code).toBe(2);
      expect(r.err).toContain("mimo");
      expect(r.err).not.toContain("luna");
      expect(takeLines(fx)).toEqual([]);
    });
  });

  test("once quiescent it takes each workhorse in with one line each", () => {
    withRun((fx) => {
      const lunaHead = laneCommit(fx, "luna", "luna.txt", "luna\n");
      const mimoHead = laneCommit(fx, "mimo", "mimo.txt", "mimo\n");
      checkLane(fx, "luna");
      checkLane(fx, "mimo");
      touchDone(fx, "luna");
      touchDone(fx, "mimo");
      setOutcome(fx, "luna", "harvested");
      setOutcome(fx, "mimo", "harvested");
      const r = takeIn(fx);
      expect(r.code).toBe(0);
      expect(r.err).toBe("");
      expect(r.out).toBe(`luna=${lunaHead}\nmimo=${mimoHead}\n`);
      expect(takeLines(fx)).toEqual([
        { action: "take-in", target: "luna", detail: `on=wb/T-luna@${lunaHead}` },
        { action: "take-in", target: "mimo", detail: `on=wb/T-mimo@${mimoHead}` },
      ]);
    });
  });

  test("take-in lines come after harvest and carry, before stage synthesis", () => {
    withRun((fx) => {
      const mimoHead = laneCommit(fx, "mimo", "mimo.txt", "mimo\n");
      checkLane(fx, "mimo");
      touchDone(fx, "luna");
      touchDone(fx, "mimo");
      logAction(fx, "lane:luna", "wall", "luna", "workhorse - - none usage limit reached");
      logAction(fx, "postmaster", "told", "luna", "workhorse - -");
      logAction(fx, "postmaster", "rule", "luna", "wall go-on");
      const carried = run(RUN, ["walls", "carry", fx.dispatch, "luna"]);
      expect(carried.code).toBe(0);
      logAction(fx, "coachman", "harvest", "luna", "summary");
      logAction(fx, "coachman", "harvest", "mimo", "summary");
      const r = takeIn(fx);
      expect(r.code).toBe(0);
      const staged = run(RUN, ["stage", fx.dispatch, "synthesis"]);
      expect(staged.code).toBe(0);
      const actions = readActions(fx);
      const lastHarvest = actions.map((a) => a.action).lastIndexOf("harvest");
      const carry = actions.map((a) => a.action).lastIndexOf("carry");
      const firstTake = actions.map((a) => a.action).indexOf("take-in");
      const stage = actions.findIndex((a) => a.action === "stage" && a.target === "synthesis");
      expect(lastHarvest).toBeGreaterThanOrEqual(0);
      expect(carry).toBeGreaterThanOrEqual(0);
      expect(firstTake).toBeGreaterThan(lastHarvest);
      expect(firstTake).toBeGreaterThan(carry);
      expect(stage).toBeGreaterThan(firstTake);
      expect(takeLines(fx)).toEqual([
        {
          action: "take-in",
          target: "luna",
          detail: `on=wb/T-luna@${fx.base} contributing=nothing`,
        },
        { action: "take-in", target: "mimo", detail: `on=wb/T-mimo@${mimoHead}` },
      ]);
    });
  });
});

describe("C2: taken in only at the commit its checks ran on", () => {
  test("the logged id, the shares id and the branch HEAD are the same", () => {
    withRun((fx) => {
      const lunaHead = laneCommit(fx, "luna", "luna.txt", "luna\n");
      const mimoHead = laneCommit(fx, "mimo", "mimo.txt", "mimo\n");
      checkLane(fx, "luna");
      checkLane(fx, "mimo");
      touchDone(fx, "luna");
      touchDone(fx, "mimo");
      const r = takeIn(fx);
      expect(r.code).toBe(0);
      const taken = Object.fromEntries(
        r.out
          .trim()
          .split("\n")
          .map((l) => l.split("=") as [string, string]),
      );
      const synthWt = join(fx.repo, ".worktrees", "T");
      writeRepoFile(synthWt, "synth.txt", "synthesis\n");
      commitAll(synthWt, "synthesis");
      const synthHead = run("git", ["-C", fx.repo, "rev-parse", "T"]).out.trim();
      const shares = run(
        RUN,
        [
          "synthesis-shares",
          "--base",
          fx.base,
          "--synthesis",
          synthHead,
          "--lane",
          `luna=${taken["luna"]}`,
          "--lane",
          `mimo=${taken["mimo"]}`,
          "--record",
          fx.dispatch,
        ],
        { cwd: fx.repo },
      );
      expect(shares.code).toBe(0);
      const record = JSON.parse(readFileSync(join(fx.dispatch, "shares.json"), "utf8")) as {
        lanes: Array<{ name: string; head: string }>;
      };
      const heads = Object.fromEntries(record.lanes.map((l) => [l.name, l.head]));
      expect(heads["luna"]).toBe(taken["luna"]);
      expect(heads["mimo"]).toBe(taken["mimo"]);
      expect(taken["luna"]).toBe(lunaHead);
      expect(taken["mimo"]).toBe(mimoHead);
      expect(branchHead(fx, "luna")).toBe(lunaHead);
      expect(branchHead(fx, "mimo")).toBe(mimoHead);
    });
  });

  test("a branch moved after its checks refuses with both ids", () => {
    withRun((fx) => {
      const lunaHead = laneCommit(fx, "luna", "luna.txt", "luna\n");
      const checkedHead = laneCommit(fx, "mimo", "mimo.txt", "mimo\n");
      checkLane(fx, "luna");
      checkLane(fx, "mimo");
      const movedHead = laneCommit(fx, "mimo", "more.txt", "more\n");
      expect(movedHead).not.toBe(checkedHead);
      touchDone(fx, "luna");
      touchDone(fx, "mimo");
      const r = takeIn(fx);
      expect(r.code).toBe(3);
      expect(r.out).toBe("");
      expect(r.err).toContain("mimo");
      expect(r.err).toContain(checkedHead);
      expect(r.err).toContain(movedHead);
      expect(r.err).not.toContain("luna");
      expect(takeLines(fx)).toEqual([]);
      expect(branchHead(fx, "luna")).toBe(lunaHead);
    });
  });

  test("commits with no verify line refuse the same way", () => {
    withRun((fx) => {
      laneCommit(fx, "luna", "luna.txt", "luna\n");
      const mimoHead = laneCommit(fx, "mimo", "mimo.txt", "mimo\n");
      checkLane(fx, "luna");
      touchDone(fx, "luna");
      touchDone(fx, "mimo");
      const r = takeIn(fx);
      expect(r.code).toBe(3);
      expect(r.err).toContain("mimo");
      expect(r.err).toContain(mimoHead);
      expect(r.err).toContain("no verify line");
      expect(takeLines(fx)).toEqual([]);
    });
  });

  test("a workhorse still at BASE is taken as contributing nothing", () => {
    withRun((fx) => {
      const mimoHead = laneCommit(fx, "mimo", "mimo.txt", "mimo\n");
      checkLane(fx, "mimo");
      touchDone(fx, "luna");
      touchDone(fx, "mimo");
      const r = takeIn(fx);
      expect(r.code).toBe(0);
      expect(r.out).toBe(`luna=${fx.base}\nmimo=${mimoHead}\n`);
      expect(takeLines(fx)).toEqual([
        {
          action: "take-in",
          target: "luna",
          detail: `on=wb/T-luna@${fx.base} contributing=nothing`,
        },
        { action: "take-in", target: "mimo", detail: `on=wb/T-mimo@${mimoHead}` },
      ]);
    });
  });

  test("checks run on a scratch match the branch by commit", () => {
    withRun((fx) => {
      laneCommit(fx, "luna", "luna.txt", "luna\n");
      const mimoHead = laneCommit(fx, "mimo", "mimo.txt", "mimo\n");
      checkLane(fx, "luna");
      const mimoWt = fx.worktree("mimo");
      writeRepoFile(mimoWt, "uncommitted.txt", "left behind\n");
      const scratch = join(fx.dir, "scratch-mimo");
      const cut = run(RUN, ["cut-scratch", fx.repo, mimoWt, scratch, mimoHead]);
      expect(cut.code).toBe(0);
      const checked = run(RUN, ["verify", "run", scratch, fx.dispatch]);
      expect(checked.code).toBe(0);
      const onLines = readActions(fx).filter(
        (a) => a.action === "verify" && a.detail.startsWith("on=detached@"),
      );
      expect(onLines.length).toBeGreaterThan(0);
      touchDone(fx, "luna");
      touchDone(fx, "mimo");
      const r = takeIn(fx);
      expect(r.code).toBe(0);
      expect(takeLines(fx)).toEqual([
        {
          action: "take-in",
          target: "luna",
          detail: `on=wb/T-luna@${branchHead(fx, "luna")}`,
        },
        { action: "take-in", target: "mimo", detail: `on=wb/T-mimo@${mimoHead}` },
      ]);
    });
  });

  test("a broken action line stops the read", () => {
    withRun((fx) => {
      laneCommit(fx, "luna", "luna.txt", "luna\n");
      laneCommit(fx, "mimo", "mimo.txt", "mimo\n");
      checkLane(fx, "luna");
      checkLane(fx, "mimo");
      touchDone(fx, "luna");
      touchDone(fx, "mimo");
      appendFileSync(join(fx.dispatch, "actions.jsonl"), "not json\n");
      const r = takeIn(fx);
      expect(r.code).toBe(1);
      expect(r.err).toContain("does not parse");
      expect(readFileSync(join(fx.dispatch, "actions.jsonl"), "utf8")).not.toContain('"take-in"');
    });
  });
});

describe("abandoning a lane on a ruling", () => {
  test("--skip takes the rest without the skipped lane", () => {
    withRun((fx) => {
      const lunaHead = laneCommit(fx, "luna", "luna.txt", "luna\n");
      laneCommit(fx, "mimo", "mimo.txt", "mimo\n");
      checkLane(fx, "luna");
      touchDone(fx, "luna");
      touchDone(fx, "mimo");
      const r = takeIn(fx, "--skip", "mimo");
      expect(r.code).toBe(0);
      expect(r.out).toBe(`luna=${lunaHead}\n`);
      expect(takeLines(fx)).toEqual([
        { action: "take-in", target: "luna", detail: `on=wb/T-luna@${lunaHead}` },
      ]);
    });
  });

  test("--skip refuses an unknown lane and skipping every lane", () => {
    withRun((fx) => {
      laneCommit(fx, "luna", "luna.txt", "luna\n");
      laneCommit(fx, "mimo", "mimo.txt", "mimo\n");
      checkLane(fx, "luna");
      checkLane(fx, "mimo");
      touchDone(fx, "luna");
      touchDone(fx, "mimo");
      const unknown = takeIn(fx, "--skip", "zed");
      expect(unknown.code).toBe(1);
      expect(unknown.err).toContain("zed");
      const all = takeIn(fx, "--skip", "luna", "--skip", "mimo");
      expect(all.code).toBe(1);
      expect(takeLines(fx)).toEqual([]);
    });
  });

  test("--skip does not waive quiescence", () => {
    withRun((fx) => {
      laneCommit(fx, "luna", "luna.txt", "luna\n");
      laneCommit(fx, "mimo", "mimo.txt", "mimo\n");
      checkLane(fx, "luna");
      checkLane(fx, "mimo");
      touchDone(fx, "luna");
      const r = takeIn(fx, "--skip", "mimo");
      expect(r.code).toBe(2);
      expect(r.err).toContain("mimo");
      expect(takeLines(fx)).toEqual([]);
    });
  });

  test("usage and environment failures exit 1", () => {
    withRun((fx) => {
      expect(run(RUN, ["take-in"]).code).toBe(1);
      expect(run(RUN, ["take-in", join(fx.dir, "no-such-dispatch")]).code).toBe(1);
      expect(takeLines(fx)).toEqual([]);
    });
  });
});

describe("review round 1: the step reads its inputs as they are", () => {
  test("a dispatch given as . is read from the current directory", () => {
    withRun((fx) => {
      const lunaHead = laneCommit(fx, "luna", "luna.txt", "luna\n");
      const mimoHead = laneCommit(fx, "mimo", "mimo.txt", "mimo\n");
      checkLane(fx, "luna");
      checkLane(fx, "mimo");
      touchDone(fx, "luna");
      touchDone(fx, "mimo");
      const r = run(RUN, ["take-in", "."], { cwd: fx.dispatch });
      expect(r.code).toBe(0);
      expect(r.out).toBe(`luna=${lunaHead}\nmimo=${mimoHead}\n`);
    });
  });

  test("an unreadable action log exits 1, not 3", () => {
    withRun((fx) => {
      laneCommit(fx, "luna", "luna.txt", "luna\n");
      laneCommit(fx, "mimo", "mimo.txt", "mimo\n");
      checkLane(fx, "luna");
      checkLane(fx, "mimo");
      touchDone(fx, "luna");
      touchDone(fx, "mimo");
      const log = join(fx.dispatch, "actions.jsonl");
      chmodSync(log, 0o000);
      try {
        const r = takeIn(fx);
        expect(r.code).toBe(1);
        expect(r.err).toContain("cannot read");
      } finally {
        chmodSync(log, 0o644);
      }
      expect(takeLines(fx)).toEqual([]);
    });
  });

  test("a missing action log still admits lanes at BASE as contributing nothing", () => {
    withRun((fx) => {
      touchDone(fx, "luna");
      touchDone(fx, "mimo");
      unlinkSync(join(fx.dispatch, "actions.jsonl"));
      const r = takeIn(fx);
      expect(r.code).toBe(0);
      expect(r.out).toBe(`luna=${fx.base}\nmimo=${fx.base}\n`);
    });
  });

  test("a recorded repo that is a file exits 1 as not a directory", () => {
    withRun((fx) => {
      const plain = join(fx.dir, "plain-file");
      writeFileSync(plain, "not a repo\n");
      const p = join(fx.dispatch, "checks.json");
      const c = JSON.parse(readFileSync(p, "utf8")) as { repo: string };
      c.repo = plain;
      writeFileSync(p, JSON.stringify(c));
      touchDone(fx, "luna");
      touchDone(fx, "mimo");
      const r = takeIn(fx);
      expect(r.code).toBe(1);
      expect(r.err).toContain("not a directory");
      expect(takeLines(fx)).toEqual([]);
    });
  });
});
