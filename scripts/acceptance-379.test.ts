// Oracle for #379, committed before the change: the coachman merges main and
// runs the gate as the last step before it raises its card. C2 drives the step
// in scratch repositories with a gate stub that can move main while it runs;
// C3 drives the conflict and the failing gate; C4's conflict clause is asserted
// by C3's conflict test. C1, C5 and C4's fixture clause need a dispatched
// fixture run with model lanes and stay hand-verified by the postmaster at
// landing. Every case drives scripts/run as a subprocess.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  TICKET,
  countMerges,
  drive,
  failStub,
  gitOrThrow,
  headOf,
  isAncestor,
  landingFresh,
  mainMove,
  mergeHeadExists,
  moveAlwaysStub,
  moveOnceStub,
  passStub,
  readActions,
  recordGate,
  removeDir,
  scratchDir,
  scratchLayout,
  unmergedPaths,
  verifyRun,
} from "./acceptance-379.ts";

let tmp = "";

beforeAll(() => {
  tmp = scratchDir("acceptance-379-");
});

afterAll(() => {
  removeDir(tmp);
});

describe("C1: the fixture run takes in a moved main", () => {
  test.skipIf(true)("the card is fresh on a main that moved after dispatch", () => {
    // Needs the C5 fixture run with a commit added to its main right after
    // dispatch: landing fresh prints fresh at the card, the card's head holds
    // that commit, and actions.jsonl holds the coachman merge line before the
    // gate pass. The postmaster checks it at landing.
  });
});

describe("C2: the step merges main and gates", () => {
  test("main moves during the first gate only: one more merge, then the card", () => {
    const layout = scratchLayout(tmp, "c2a");
    recordGate(layout, moveOnceStub(layout));
    const moved = mainMove(layout.repo, "after dispatch\n", "main moves after dispatch");
    const driven = drive(layout);
    expect(driven.verdicts).toEqual(["MERGED", "MERGED", "CARD"]);
    expect(driven.gates).toBe(2);
    expect(countMerges(layout.repo, layout.ticket)).toBe(2);
    const actions = readActions(layout.dispatch);
    const merges = actions.filter((a) => a.actor === "coachman" && a.action === "merge");
    expect(merges.length).toBe(2);
    expect(merges[0]?.detail).toBe(`main=${moved} into ${TICKET}`);
    const second = /^main=([0-9a-f]{40}) into t379$/u.exec(merges[1]?.detail ?? "");
    expect(second?.[1]).toBeDefined();
    expect(second?.[1]).not.toBe(moved);
    const verifies = actions.filter((a) => a.action === "verify" && a.target === "gate");
    expect(verifies.length).toBe(2);
    for (const v of verifies) expect(v.detail).toContain("result=pass");
    const lastVerify = actions.lastIndexOf(verifies[verifies.length - 1]);
    for (const m of merges) expect(actions.indexOf(m)).toBeLessThan(lastVerify);
    const head = headOf(layout.wt);
    expect(isAncestor(layout.repo, moved, head)).toBe(true);
    expect(isAncestor(layout.repo, second?.[1] ?? "", head)).toBe(true);
    expect(driven.last.code).toBe(0);
    expect(driven.last.out).toContain("## Merge");
    expect(driven.last.out).toContain(headOf(layout.repo, "main"));
    expect(driven.last.out).toContain("Resolved by hand: none");
    const fresh = landingFresh(layout);
    expect(fresh.code).toBe(0);
    expect(fresh.out.trim()).toBe("fresh");
  });

  test("main moves during both gates: one more merge, never a third", () => {
    const layout = scratchLayout(tmp, "c2b");
    recordGate(layout, moveAlwaysStub(layout));
    mainMove(layout.repo, "after dispatch\n", "main moves after dispatch");
    const driven = drive(layout);
    expect(driven.verdicts).toEqual(["MERGED", "MERGED", "CARD-ANYWAY"]);
    expect(driven.gates).toBe(2);
    expect(countMerges(layout.repo, layout.ticket)).toBe(2);
    const actions = readActions(layout.dispatch);
    const merges = actions.filter((a) => a.actor === "coachman" && a.action === "merge");
    expect(merges.length).toBe(2);
    const second = /^main=([0-9a-f]{40}) into t379$/u.exec(merges[1]?.detail ?? "");
    const current = headOf(layout.repo, "main");
    expect(second?.[1]).toBeDefined();
    expect(second?.[1]).not.toBe(current);
    expect(driven.last.code).toBe(0);
    expect(driven.last.out).toContain("## Merge");
    expect(driven.last.out).toContain(second?.[1] ?? "");
    expect(driven.last.out).toContain(current);
    const fresh = landingFresh(layout);
    expect(fresh.code).toBe(2);
    expect(fresh.out).toContain("stale:");
  });

  test("already fresh: merges nothing and runs no gate", () => {
    const layout = scratchLayout(tmp, "c2c");
    recordGate(layout, passStub(layout));
    const setup = verifyRun(layout);
    expect(setup.code).toBe(0);
    const before = headOf(layout.wt);
    const linesBefore = readActions(layout.dispatch).filter((a) => a.action === "verify").length;
    const driven = drive(layout);
    expect(driven.verdicts).toEqual(["CARD"]);
    expect(driven.gates).toBe(0);
    expect(headOf(layout.wt)).toBe(before);
    expect(countMerges(layout.repo, layout.ticket)).toBe(0);
    const actions = readActions(layout.dispatch);
    expect(actions.filter((a) => a.actor === "coachman" && a.action === "merge").length).toBe(0);
    expect(actions.filter((a) => a.action === "verify").length).toBe(linesBefore);
    expect(driven.last.out).toContain("## Merge");
    expect(driven.last.out).toContain(headOf(layout.repo, "main"));
    expect(driven.last.out).toContain("Resolved by hand: none");
    const fresh = landingFresh(layout);
    expect(fresh.code).toBe(0);
    expect(fresh.out.trim()).toBe("fresh");
  });
});

describe("C3: conflicts and a failing gate stop the step", () => {
  test("a conflict is reported with the file and left for the coachman", () => {
    const layout = scratchLayout(tmp, "c3-conflict");
    recordGate(layout, passStub(layout));
    writeFileSync(join(layout.repo, "clash.txt"), "main\n", "utf8");
    gitOrThrow(layout.repo, "add", "clash.txt");
    gitOrThrow(layout.repo, "commit", "-q", "-m", "main touches the line");
    const main = headOf(layout.repo, "main");
    writeFileSync(join(layout.wt, "clash.txt"), "ticket\n", "utf8");
    gitOrThrow(layout.wt, "add", "clash.txt");
    gitOrThrow(layout.wt, "commit", "-q", "-m", "ticket touches the line");
    const conflicted = drive(layout);
    expect(conflicted.verdicts).toEqual(["CONFLICT"]);
    expect(conflicted.last.code).toBe(2);
    expect(conflicted.last.out).toContain(main);
    expect(conflicted.last.out).toContain("clash.txt");
    expect(mergeHeadExists(layout.wt)).toBe(true);
    expect(unmergedPaths(layout.wt)).toContain("clash.txt");
    const actions = readActions(layout.dispatch);
    const merges = actions.filter((a) => a.actor === "coachman" && a.action === "merge");
    expect(merges.length).toBe(1);
    expect(merges[0]?.detail).toBe(`main=${main} into ${TICKET} conflict=clash.txt`);
    writeFileSync(join(layout.wt, "clash.txt"), "resolved\n", "utf8");
    gitOrThrow(layout.wt, "add", "clash.txt");
    gitOrThrow(layout.wt, "commit", "-q", "--no-edit");
    const settled = drive(layout);
    expect(settled.verdicts).toEqual(["GATE-NEEDED", "CARD"]);
    expect(settled.gates).toBe(1);
    expect(settled.last.out).toContain("## Merge");
    expect(settled.last.out).toContain(main);
    expect(settled.last.out).toContain("clash.txt");
    const fresh = landingFresh(layout);
    expect(fresh.code).toBe(0);
    expect(fresh.out.trim()).toBe("fresh");
  });

  test("a failing gate is reported by check name, never as a card", () => {
    const layout = scratchLayout(tmp, "c3-gatefail");
    recordGate(layout, failStub(layout));
    mainMove(layout.repo, "after dispatch\n", "main moves after dispatch");
    const driven = drive(layout);
    expect(driven.verdicts).toEqual(["MERGED", "GATE-FAILED"]);
    expect(driven.last.code).toBe(2);
    expect(driven.last.out).toContain("GATE-FAILED gate:");
    expect(driven.last.out).not.toContain("CARD");
    const actions = readActions(layout.dispatch);
    expect(actions.filter((a) => a.actor === "coachman" && a.action === "merge").length).toBe(1);
    expect(countMerges(layout.repo, layout.ticket)).toBe(1);
  });
});

describe("C4: the card carries the step's report", () => {
  // The conflict clause is asserted by C3's conflict test above: its CARD
  // report names the conflicted file. The clean path is asserted by C2's
  // reports naming the main with no file resolved by hand.
  test.skipIf(true)("the fixture run's card names the main it holds", () => {
    // Needs the C5 fixture run: at .card-ready its card carries the step's
    // report naming the C1 commit as the main the branch holds. The
    // postmaster checks it at landing.
  });
});

describe("C5: the fixture run scores clean", () => {
  test.skipIf(true)("a run from this branch scores clean", () => {
    // Needs a model run from this branch against a fixture repository with
    // the C1 commit on its main; the postmaster dispatches and scores it at
    // landing, and coachman-contract names this change a contract change.
  });
});
