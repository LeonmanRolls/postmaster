// Oracle for #391, committed before the change: a verified finding is fixed
// while the other reviewers of its round are still working. C1 drives the
// per-reviewer wait, the atomic fix step and the round close as subprocesses
// over a scratch run; C2 the gate reuse at the next cut; C3 the fix step
// against the integrity check; C4 a reviewer's swept-in change; C5 the
// later-report record in review-decide. Covered: C1-C5. Not covered: C6,
// the fixture run from the final head, which landing dispatches and scores.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  RUN,
  actionLines,
  addCommit,
  cleanup,
  git,
  landMarkerAfter,
  makeLayout,
  mimo,
  tool,
  writeAction,
  writeReviewer,
  type Layout,
} from "./acceptance-391.ts";
import { run } from "./lib/proc.ts";

afterEach(cleanup);

function out(r: { out: string; err: string }): string {
  return `${r.out}${r.err}`;
}

function degrades(layout: Layout): string[] {
  return actionLines(layout)
    .filter((line) => line.action === "degrade")
    .map((line) => String(line.target))
    .sort();
}

function rowIndex(layout: Layout, action: string, target: string): number {
  return actionLines(layout).findIndex(
    (line) => line.action === action && String(line.target) === target,
  );
}

describe("C1: the wait returns as each reviewer finishes, and the fix lands between finishes", () => {
  test("wait-next names the finished reviewer while the other is still out; the apply row lands between the two finish rows; the round closes clean", () => {
    const layout = makeLayout(
      [
        { lens: "bug", lane: "fast", harness: "codex" },
        { lens: "bug", lane: "slow", harness: "codex" },
      ],
      { timeoutSeconds: 30 },
    );
    expect(tool(layout, "reach", "before", layout.dispatch, "1").code).toBe(0);
    const start = tool(
      layout,
      "review-round",
      "start",
      layout.dispatch,
      "1",
      "bug:fast",
      "bug:slow",
    );
    expect(start.code).toBe(0);
    landMarkerAfter(join(layout.dispatch, "logs", "review-r1-bug-fast.done"), 1000);

    const first = tool(layout, "review-round", "wait-next", layout.dispatch, "1", layout.repo);
    expect(first.code).toBe(0);
    expect(first.out).toContain("FINISHED bug fast");
    expect(first.out).not.toContain("FINISHED bug slow");
    expect(existsSync(join(layout.dispatch, "logs", "review-r1-bug-slow.done"))).toBe(false);

    writeAction(
      layout,
      "coachman",
      "finding",
      "README.md:1",
      "gating P2 r1 bug fast reading: base text is wrong",
    );
    writeFileSync(join(layout.synth, "README.md"), "fixed text\n");
    const fix = tool(
      layout,
      "review-round",
      "fix",
      layout.dispatch,
      layout.synth,
      "--message",
      "Fix the README wording",
      "--findings",
      "README.md:1",
      "--",
      "README.md",
    );
    expect(fix.code).toBe(0);
    const fixed = git(layout.repo, "-C", layout.synth, "rev-parse", "HEAD");

    writeFileSync(join(layout.dispatch, "logs", "review-r1-bug-slow.done"), "");
    const second = tool(layout, "review-round", "wait-next", layout.dispatch, "1", layout.repo);
    expect(second.code).toBe(0);
    expect(second.out).toContain("FINISHED bug slow");
    const last = tool(layout, "review-round", "wait-next", layout.dispatch, "1", layout.repo);
    expect(last.code).toBe(0);
    expect(last.out).toContain("every reviewer reported");

    const lines = actionLines(layout);
    const fastFinish = rowIndex(layout, "review-finish", "fast");
    const apply = rowIndex(layout, "apply", fixed);
    const slowFinish = rowIndex(layout, "review-finish", "slow");
    expect(fastFinish).toBeGreaterThanOrEqual(0);
    expect(apply).toBeGreaterThanOrEqual(0);
    expect(slowFinish).toBeGreaterThanOrEqual(0);
    expect(fastFinish).toBeLessThan(apply);
    expect(apply).toBeLessThan(slowFinish);
    expect(lines[fastFinish]?.detail).toBe("bug round 1");
    expect(lines[slowFinish]?.detail).toBe("bug round 1");
    expect(lines[apply]?.detail).toBe("README.md:1");

    const round = tool(layout, "reach", "round", layout.dispatch, "r1");
    expect(round.code).toBe(0);
    expect(out(round)).toContain("r1: clean");
    expect(out(round)).not.toContain("voided");
    expect(degrades(layout)).toEqual([]);
    expect(git(layout.repo, "rev-parse", "refs/heads/T")).toBe(fixed);
    expect(readFileSync(join(layout.synth, "README.md"), "utf8")).toBe("fixed text\n");
  });

  test("at the deadline wait-next records the straggler as timed out and stops it, and keeps the finished reviewer's finish", () => {
    const layout = makeLayout(
      [
        { lens: "bug", lane: "fast", harness: "codex" },
        { lens: "bug", lane: "slow", harness: "codex" },
      ],
      { timeoutSeconds: 3 },
    );
    const start = tool(
      layout,
      "review-round",
      "start",
      layout.dispatch,
      "1",
      "bug:fast",
      "bug:slow",
    );
    expect(start.code).toBe(0);
    landMarkerAfter(join(layout.dispatch, "logs", "review-r1-bug-fast.done"), 500);
    const first = tool(layout, "review-round", "wait-next", layout.dispatch, "1", layout.repo);
    expect(first.code).toBe(0);
    expect(first.out).toContain("FINISHED bug fast");

    const late = tool(layout, "review-round", "wait-next", layout.dispatch, "1", layout.repo);
    expect(late.code).toBe(3);
    expect(out(late)).toContain("WAIT-TIMEOUT");
    expect(out(late)).toContain("TIMEOUT bug slow: DEGRADED, timeout");
    expect(degrades(layout)).toEqual(["slow"]);
    expect(rowIndex(layout, "review-finish", "fast")).toBeGreaterThanOrEqual(0);
    expect(rowIndex(layout, "review-finish", "slow")).toBe(-1);
  });

  test("a finished reviewer with a provider wall is reported finished and recorded as walled, once", () => {
    const layout = makeLayout(
      [
        { lens: "bug", lane: "fast", harness: "codex" },
        { lens: "bug", lane: "slow", harness: "codex" },
      ],
      { timeoutSeconds: 30 },
    );
    const start = tool(
      layout,
      "review-round",
      "start",
      layout.dispatch,
      "1",
      "bug:fast",
      "bug:slow",
    );
    expect(start.code).toBe(0);
    writeAction(layout, "coachman", "wall", "slow", "reviewer bug 1 none usage limit hit");
    writeFileSync(join(layout.dispatch, "logs", "review-r1-bug-slow.done"), "");
    const next = tool(layout, "review-round", "wait-next", layout.dispatch, "1", layout.repo);
    expect(next.code).toBe(0);
    expect(next.out).toContain("FINISHED bug slow");
    expect(out(next)).toContain('WALL bug slow: DEGRADED, provider wall: "usage limit hit"');
    const walls = actionLines(layout).filter(
      (line) => line.action === "degrade" && String(line.target) === "slow",
    );
    expect(walls.length).toBe(1);
    expect(walls[0]?.detail).toBe('bug r1: provider wall: "usage limit hit"');
  });
});

describe("C2: a recorded pass on the cut's commit is reused without running verify", () => {
  function cut2Layout(): Layout {
    return makeLayout([{ lens: "bug", lane: "luna", harness: "codex" }]);
  }

  function verifyRows(layout: Layout): number {
    return actionLines(layout).filter((line) => line.action === "verify").length;
  }

  function poisonGate(layout: Layout): void {
    writeFileSync(
      join(layout.dispatch, "checks.json"),
      `${JSON.stringify({ checks: [{ name: "gate", source: "declared", kind: "project", command: "false", shows: "x" }] })}\n`,
    );
  }

  test("a mid-round pass on X is reused at the round 2 cut: no verify run, round 2's checks from the pass, not-run lines carried", () => {
    const layout = cut2Layout();
    const cut1 = tool(
      layout,
      "review-round",
      "cut",
      layout.dispatch,
      "1",
      layout.repo,
      layout.synth,
    );
    expect(cut1.code).toBe(0);
    const snap1 = git(layout.repo, "-C", layout.synth, "rev-parse", "HEAD");
    const fix = addCommit(layout.repo, layout.synth, "src/fix.txt", "a fix\n");
    expect(fix).not.toBe(snap1);
    const gate = tool(layout, "review-round", "gate", layout.dispatch, "1", layout.synth);
    expect(gate.code).toBe(0);
    const passText = readFileSync(join(layout.dispatch, "logs", `gate-${fix}.txt`), "utf8");
    expect(passText).toContain("not run");
    const rowsBefore = verifyRows(layout);
    expect(rowsBefore).toBeGreaterThan(0);
    poisonGate(layout);

    const cut2 = tool(
      layout,
      "review-round",
      "cut",
      layout.dispatch,
      "2",
      layout.repo,
      layout.synth,
    );
    expect(cut2.code).toBe(0);
    expect(cut2.out).toContain("reuses the gate pass");
    expect(verifyRows(layout)).toBe(rowsBefore);
    expect(readFileSync(join(layout.dispatch, "logs", "review-r2-checks.txt"), "utf8")).toBe(
      passText,
    );
    const gate2 = actionLines(layout).find(
      (line) =>
        line.action === "gate" &&
        String(line.target) === fix &&
        String(line.detail ?? "").includes("reused from round"),
    );
    expect(String(gate2?.detail ?? "")).toContain("reused from round 1");
    const logged = readFileSync(join(layout.dispatch, "run-log.md"), "utf8");
    expect(logged).toContain("review round 2 gate not run: ");
  });

  test("a cut pass on an unchanged snapshot is reused: round 2's checks from round 1's", () => {
    const layout = cut2Layout();
    const cut1 = tool(
      layout,
      "review-round",
      "cut",
      layout.dispatch,
      "1",
      layout.repo,
      layout.synth,
    );
    expect(cut1.code).toBe(0);
    const snap = git(layout.repo, "-C", layout.synth, "rev-parse", "HEAD");
    const rowsBefore = verifyRows(layout);
    poisonGate(layout);

    const cut2 = tool(
      layout,
      "review-round",
      "cut",
      layout.dispatch,
      "2",
      layout.repo,
      layout.synth,
    );
    expect(cut2.code).toBe(0);
    expect(verifyRows(layout)).toBe(rowsBefore);
    expect(readFileSync(join(layout.dispatch, "logs", "review-r2-checks.txt"), "utf8")).toBe(
      readFileSync(join(layout.dispatch, "logs", "review-r1-checks.txt"), "utf8"),
    );
    const gate2 = actionLines(layout).filter(
      (line) => line.action === "gate" && String(line.target) === snap,
    );
    expect(gate2.length).toBe(2);
  });

  test("negative control: a cut at a commit with no passing gate runs verify as today", () => {
    const layout = cut2Layout();
    const cut1 = tool(
      layout,
      "review-round",
      "cut",
      layout.dispatch,
      "1",
      layout.repo,
      layout.synth,
    );
    expect(cut1.code).toBe(0);
    addCommit(layout.repo, layout.synth, "src/fix.txt", "an ungated fix\n");
    const rowsBefore = verifyRows(layout);

    const cut2 = tool(
      layout,
      "review-round",
      "cut",
      layout.dispatch,
      "2",
      layout.repo,
      layout.synth,
    );
    expect(cut2.code).toBe(0);
    expect(cut2.out).not.toContain("reuses the gate pass");
    expect(verifyRows(layout)).toBeGreaterThan(rowsBefore);
  });

  test("a dirty tree never reuses: the cut runs verify, which refuses as today", () => {
    const layout = cut2Layout();
    const cut1 = tool(
      layout,
      "review-round",
      "cut",
      layout.dispatch,
      "1",
      layout.repo,
      layout.synth,
    );
    expect(cut1.code).toBe(0);
    writeFileSync(join(layout.synth, "src", "dirty.txt"), "uncommitted\n");
    const cut2 = tool(
      layout,
      "review-round",
      "cut",
      layout.dispatch,
      "2",
      layout.repo,
      layout.synth,
    );
    expect(cut2.code).toBe(1);
    expect(out(cut2)).toContain("dirty.txt");
  });

  test("the gate step refuses a dirty tree with no row and no pass file", () => {
    const layout = cut2Layout();
    writeFileSync(join(layout.synth, "src", "dirty.txt"), "uncommitted\n");
    const before = actionLines(layout).filter((line) => line.action === "gate").length;
    const gate = tool(layout, "review-round", "gate", layout.dispatch, "1", layout.synth);
    expect(gate.code).toBe(1);
    expect(out(gate)).toContain("dirty.txt");
    expect(actionLines(layout).filter((line) => line.action === "gate").length).toBe(before);
    expect(
      actionLines(layout).some(
        (line) => line.action === "gate" && String(line.detail ?? "").includes("mid-round"),
      ),
    ).toBe(false);
  });
});

describe("C3: a fix saved through the fix step never costs the round its reviews", () => {
  function roundLayout(): Layout {
    return makeLayout([
      { lens: "bug", lane: "codex", harness: "codex" },
      { lens: "bug", lane: "mimo", harness: "mimo" },
    ]);
  }

  test("a fix saved through the fix step during the round reads clean and stays on the branch", () => {
    const layout = roundLayout();
    expect(tool(layout, "reach", "before", layout.dispatch, "1").code).toBe(0);
    writeAction(
      layout,
      "coachman",
      "finding",
      "README.md:1",
      "gating P2 r1 bug codex reading: base text is wrong",
    );
    writeFileSync(join(layout.synth, "README.md"), "fixed text\n");
    const fix = tool(
      layout,
      "review-round",
      "fix",
      layout.dispatch,
      layout.synth,
      "--message",
      "Fix the README wording",
      "--findings",
      "README.md:1",
      "--",
      "README.md",
    );
    expect(fix.code).toBe(0);
    const fixed = git(layout.repo, "-C", layout.synth, "rev-parse", "HEAD");

    const round = tool(layout, "reach", "round", layout.dispatch, "r1");
    expect(round.code).toBe(0);
    expect(out(round)).toContain("r1: clean");
    expect(out(round)).not.toContain("voided");
    expect(out(round)).not.toContain("degrade");
    expect(degrades(layout)).toEqual([]);
    expect(git(layout.repo, "rev-parse", "refs/heads/T")).toBe(fixed);
    expect(git(layout.repo, "-C", layout.synth, "rev-parse", "HEAD")).toBe(fixed);
    expect(readFileSync(join(layout.synth, "README.md"), "utf8")).toBe("fixed text\n");
  });

  test("control: a commit made outside the fix step and recorded after the check still voids every reviewer as an unexplained round change", () => {
    const layout = roundLayout();
    expect(tool(layout, "reach", "before", layout.dispatch, "1").code).toBe(0);
    const snap = git(layout.repo, "-C", layout.synth, "rev-parse", "HEAD");
    const fix = addCommit(layout.repo, layout.synth, "README.md", "fixed outside\n");
    const round = tool(layout, "reach", "round", layout.dispatch, "r1");
    writeAction(layout, "coachman", "apply", fix, "README.md:1");
    expect(out(round)).toContain("voided verdict bug codex r1: unexplained round change");
    expect(out(round)).toContain("voided verdict bug mimo r1: unexplained round change");
    expect(degrades(layout)).toEqual(["codex", "mimo"]);
    expect(git(layout.repo, "rev-parse", "refs/heads/T")).toBe(snap);
  });

  test("when the apply row cannot be recorded the fix step rolls the commit back and says so", () => {
    const layout = roundLayout();
    expect(tool(layout, "reach", "before", layout.dispatch, "1").code).toBe(0);
    const parent = git(layout.repo, "-C", layout.synth, "rev-parse", "HEAD");
    mkdirSync(join(layout.dispatch, "actions.jsonl"));
    writeFileSync(join(layout.synth, "README.md"), "fixed text\n");
    const fix = tool(
      layout,
      "review-round",
      "fix",
      layout.dispatch,
      layout.synth,
      "--message",
      "Fix the README wording",
      "--findings",
      "README.md:1",
      "--",
      "README.md",
    );
    expect(fix.code).toBe(1);
    expect(out(fix)).toContain("rolled back");
    expect(git(layout.repo, "-C", layout.synth, "rev-parse", "HEAD")).toBe(parent);
    // The worktree keeps the fix content; only the commit is undone.
    expect(readFileSync(join(layout.synth, "README.md"), "utf8")).toBe("fixed text\n");
  });

  test("when only the ledger write fails the fix step keeps the recorded commit and says so", () => {
    const layout = roundLayout();
    expect(tool(layout, "reach", "before", layout.dispatch, "1").code).toBe(0);
    mkdirSync(join(layout.dispatch, "..", "ledger.jsonl"));
    writeFileSync(join(layout.synth, "README.md"), "fixed text\n");
    const fix = tool(
      layout,
      "review-round",
      "fix",
      layout.dispatch,
      layout.synth,
      "--message",
      "Fix the README wording",
      "--findings",
      "README.md:1",
      "--",
      "README.md",
    );
    expect(fix.code).toBe(1);
    expect(out(fix)).toContain("kept");
    const kept = git(layout.repo, "-C", layout.synth, "rev-parse", "HEAD");
    const rows = actionLines(layout).filter(
      (line) => line.action === "apply" && String(line.target) === kept,
    );
    expect(rows.length).toBe(1);
  });
});

describe("C4: a reviewer's change never outlives the round", () => {
  function roundLayout(): Layout {
    return makeLayout([
      { lens: "bug", lane: "codex", harness: "codex" },
      { lens: "bug", lane: "mimo", harness: "mimo" },
    ]);
  }

  test("a fix holding a reviewer-named file voids that reviewer and resets the branch and worktree to the snapshot, saving both", () => {
    const layout = roundLayout();
    const named = join(layout.synth, "README.md");
    writeReviewer(layout, "bug", "mimo", [mimo("write_file", { path: named })]);
    expect(tool(layout, "reach", "before", layout.dispatch, "1").code).toBe(0);
    const snap = git(layout.repo, "-C", layout.synth, "rev-parse", "HEAD");
    // The reviewer's edit lands in the synthesis worktree; the coachman's fix
    // holds it together with its own change.
    writeFileSync(named, "reviewer text\ncoachman fix\n");
    writeAction(
      layout,
      "coachman",
      "finding",
      "README.md:1",
      "gating P2 r1 bug codex reading: base text is wrong",
    );
    const fix = tool(
      layout,
      "review-round",
      "fix",
      layout.dispatch,
      layout.synth,
      "--message",
      "Fix the README wording",
      "--findings",
      "README.md:1",
      "--",
      "README.md",
    );
    expect(fix.code).toBe(0);

    const round = tool(layout, "reach", "round", layout.dispatch, "r1");
    expect(out(round)).toContain("voided verdict bug mimo r1: reach");
    expect(out(round)).not.toContain("voided verdict bug codex");
    expect(degrades(layout)).toEqual(["mimo"]);
    expect(git(layout.repo, "rev-parse", "refs/heads/T")).toBe(snap);
    expect(git(layout.repo, "-C", layout.synth, "rev-parse", "HEAD")).toBe(snap);
    expect(readFileSync(named, "utf8")).toBe("base text\n");
    const saved = readFileSync(
      join(layout.dispatch, "reach", "r1", "branches", "refs_heads_T.patch"),
      "utf8",
    );
    expect(saved).toContain("reviewer text");
    expect(saved).toContain("coachman fix");
    expect(existsSync(join(layout.dispatch, "reach", "r1", "synthesis.patch"))).toBe(true);
  });

  test("control: a reviewer naming a file the round's fixes did not change leaves the recorded fix in place", () => {
    const layout = roundLayout();
    writeReviewer(layout, "bug", "mimo", [
      mimo("write_file", { path: join(layout.synth, "src", "other.txt") }),
    ]);
    expect(tool(layout, "reach", "before", layout.dispatch, "1").code).toBe(0);
    writeAction(
      layout,
      "coachman",
      "finding",
      "README.md:1",
      "gating P2 r1 bug codex reading: base text is wrong",
    );
    writeFileSync(join(layout.synth, "README.md"), "fixed text\n");
    const fix = tool(
      layout,
      "review-round",
      "fix",
      layout.dispatch,
      layout.synth,
      "--message",
      "Fix the README wording",
      "--findings",
      "README.md:1",
      "--",
      "README.md",
    );
    expect(fix.code).toBe(0);
    const fixed = git(layout.repo, "-C", layout.synth, "rev-parse", "HEAD");

    const round = tool(layout, "reach", "round", layout.dispatch, "r1");
    expect(round.code).toBe(0);
    expect(out(round)).toContain("r1: note");
    expect(out(round)).toContain("names");
    expect(out(round)).not.toContain("voided");
    expect(degrades(layout)).toEqual([]);
    expect(git(layout.repo, "rev-parse", "refs/heads/T")).toBe(fixed);
    expect(readFileSync(join(layout.synth, "README.md"), "utf8")).toBe("fixed text\n");
  });
});

describe("C5: a finding reported again in its round is counted once", () => {
  function logged(d: string, action: string, target: string, detail: string): void {
    writeFileSync(
      join(d, "actions.jsonl"),
      `{"ts":"2026-10-11T00:00:00Z","project":"p","run":"r","actor":"coachman","action":"${action}","target":"${target}","detail":"${detail}"}\n`,
      { flag: "a" },
    );
  }

  function decide(d: string, round: string): { code: number; out: string } {
    const r = run(RUN, ["review-decide", d, round]);
    return { code: r.code, out: `${r.out}${r.err}` };
  }

  test("a later report of a fixed finding counts once, names both reviewers, and runs round 3", () => {
    const layout = makeLayout([{ lens: "bug", lane: "haiku", harness: "codex" }]);
    const d = layout.dispatch;
    logged(d, "finding", "src/a.ts:10", "gating P2 r1 bug haiku reading: a defect");
    logged(d, "apply", "abc1234", "src/a.ts:10");
    logged(d, "finding", "src/b.ts:20", "gating P2 r2 bug haiku reading: a defect");
    logged(d, "apply", "def5678", "src/b.ts:20");
    writeAction(
      layout,
      "coachman",
      "finding-also",
      "src/b.ts:20",
      "gating P2 r2 bug luna reading: the same defect, later report",
    );
    const r = decide(d, "2");
    expect(r.code).toBe(0);
    expect(r.out.replace(/\n+$/u, "")).toBe(
      "RUN 3: round 2 logged no more P1 or P2 findings than round 1",
    );
    const text = readFileSync(join(d, "actions.jsonl"), "utf8");
    expect(text).toContain("bug haiku reading: a defect");
    expect(text).toContain("bug luna reading: the same defect, later report");
  });

  test("a later report with no finding line in its round faults", () => {
    const layout = makeLayout([{ lens: "bug", lane: "haiku", harness: "codex" }]);
    const d = layout.dispatch;
    logged(d, "finding", "src/a.ts:10", "gating P2 r1 bug haiku reading: a defect");
    logged(d, "apply", "abc1234", "src/a.ts:10");
    writeAction(
      layout,
      "coachman",
      "finding-also",
      "src/a.ts:10",
      "gating P2 r2 bug luna reading: a later report with no round 2 finding",
    );
    const r = decide(d, "2");
    expect(r.code).toBe(1);
    expect(r.out).toContain("no finding line");
  });

  test("a later report opening with another severity faults", () => {
    const layout = makeLayout([{ lens: "bug", lane: "haiku", harness: "codex" }]);
    const d = layout.dispatch;
    logged(d, "finding", "src/a.ts:10", "gating P2 r1 bug haiku reading: a defect");
    logged(d, "apply", "abc1234", "src/a.ts:10");
    logged(d, "finding", "src/b.ts:20", "gating P2 r2 bug haiku reading: a defect");
    logged(d, "apply", "def5678", "src/b.ts:20");
    writeAction(
      layout,
      "coachman",
      "finding-also",
      "src/b.ts:20",
      "gating P1 r2 bug luna reading: the same defect graded higher",
    );
    const r = decide(d, "2");
    expect(r.code).toBe(1);
    expect(r.out).toContain("not the finding's");
  });
});
