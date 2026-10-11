// Tests beside the pre-card merge step: its parsers and report by unit, and
// its guards, count restarts and failure paths in scratch repositories. The
// ticket's checks live in the oracle, scripts/acceptance-379.test.ts, whose
// scratch builders these tests reuse without changing it.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  RUN,
  countMerges,
  drive,
  gitOrThrow,
  headOf,
  mainMove,
  mergeDefault,
  moveAlwaysStub,
  passStub,
  readActions,
  recordGate,
  removeDir,
  scratchDir,
  scratchLayout,
  verifyRun,
} from "./acceptance-379.ts";
import { run } from "./lib/proc.ts";
import {
  buildReport,
  countAttemptMerges,
  parseMergeDetail,
  parsePorcelainZ,
} from "./merge-default.ts";

const NUL = String.fromCharCode(0);
const SHA = "ab".repeat(20);
const OTHER = "cd".repeat(20);

describe("porcelain", () => {
  test("clean reads clean", () => {
    expect(parsePorcelainZ("")).toEqual({ unmerged: false, dirtyTracked: false });
    expect(parsePorcelainZ(`?? new${NUL}`)).toEqual({ unmerged: false, dirtyTracked: false });
  });

  test("tracked changes read dirty", () => {
    expect(parsePorcelainZ(`M ticket.txt${NUL}`)).toEqual({
      unmerged: false,
      dirtyTracked: true,
    });
    expect(parsePorcelainZ(`A added${NUL} M modified${NUL}`)).toEqual({
      unmerged: false,
      dirtyTracked: true,
    });
    expect(parsePorcelainZ(`?? new${NUL} D gone${NUL}`)).toEqual({
      unmerged: false,
      dirtyTracked: true,
    });
  });

  test("unmerged entries read unmerged, never dirty", () => {
    for (const xy of ["UU", "AA", "DD", "UD", "DU", "AU", "UA"]) {
      expect(parsePorcelainZ(`${xy} clash.txt${NUL}`)).toEqual({
        unmerged: true,
        dirtyTracked: false,
      });
    }
  });
});

describe("merge detail", () => {
  test("a clean line parses", () => {
    expect(parseMergeDetail(`main=${SHA} into t379`)).toEqual({
      main: SHA,
      branch: "t379",
      conflict: [],
    });
  });

  test("a conflict line parses its files", () => {
    expect(parseMergeDetail(`main=${SHA} into t379 conflict=a b/c`)).toEqual({
      main: SHA,
      branch: "t379",
      conflict: ["a", "b/c"],
    });
  });

  test("prose and short forms parse to nothing", () => {
    expect(parseMergeDetail("origin/main abc1234 into t379, clean")).toBeNull();
    expect(parseMergeDetail(`main=${SHA.slice(0, 12)} into t379`)).toBeNull();
    expect(parseMergeDetail(`main=${SHA}`)).toBeNull();
    expect(parseMergeDetail("")).toBeNull();
  });
});

describe("attempt count", () => {
  test("with no resume every coachman merge counts", () => {
    const got = countAttemptMerges([
      { actor: "coachman", action: "merge", detail: `main=${SHA} into t379` },
      { actor: "coachman", action: "verify", detail: "on=t379@abc result=pass" },
      { actor: "coachman", action: "merge", detail: "origin/main abc into t379, clean" },
      { actor: "coachman", action: "merge", detail: `main=${OTHER} into t379 conflict=b a` },
    ]);
    expect(got.count).toBe(3);
    expect(got.lastMain).toBe(OTHER);
    expect(got.hand).toEqual(["a", "b"]);
  });

  test("a postmaster resume restarts the count", () => {
    const got = countAttemptMerges([
      { actor: "coachman", action: "merge", detail: `main=${SHA} into t379` },
      { actor: "postmaster", action: "resume", detail: "leg 1 synthesis, thread t" },
      { actor: "coachman", action: "merge", detail: `main=${OTHER} into t379 conflict=z` },
    ]);
    expect(got.count).toBe(1);
    expect(got.lastMain).toBe(OTHER);
    expect(got.hand).toEqual(["z"]);
  });

  test("a lane resume and a landing merge restart nothing", () => {
    const got = countAttemptMerges([
      { actor: "coachman", action: "merge", detail: `main=${SHA} into t379` },
      { actor: "coachman", action: "resume", detail: "blocked lane" },
      { actor: "postmaster", action: "merge", detail: "pull request 1 merged" },
      { actor: "coachman", action: "merge", detail: `main=${OTHER} into t379` },
    ]);
    expect(got.count).toBe(2);
    expect(got.lastMain).toBe(OTHER);
  });
});

describe("report", () => {
  test("no merge needed", () => {
    expect(buildReport({ ref: "main", holds: SHA, tip: null, count: 0, hand: [] })).toBe(
      `## Merge\nHolds main ${SHA} (main); no merge was needed\nResolved by hand: none\n`,
    );
  });

  test("merges name their count and hand files", () => {
    expect(buildReport({ ref: "main", holds: SHA, tip: null, count: 1, hand: [] })).toContain(
      "merged once in this step",
    );
    expect(
      buildReport({ ref: "origin/main", holds: SHA, tip: null, count: 2, hand: ["b", "a"] }),
    ).toBe(
      `## Merge\nHolds main ${SHA} (origin/main), merged twice in this step\nResolved by hand: b a\n`,
    );
  });

  test("a card anyway names the held main and the current tip", () => {
    expect(buildReport({ ref: "main", holds: SHA, tip: OTHER, count: 2, hand: [] })).toBe(
      `## Merge\nHolds main ${SHA} (main then); current main is ${OTHER}, not held, and the card was raised anyway\nResolved by hand: none\n`,
    );
  });
});

describe("guards and restarts", () => {
  let tmp = "";

  beforeAll(() => {
    tmp = scratchDir("merge-default-");
  });

  afterAll(() => {
    removeDir(tmp);
  });

  test("usage", () => {
    const bare = run(RUN, ["merge-default"]);
    expect(bare.code).toBe(1);
    expect(bare.err).toContain("usage: run merge-default");
    const short = run(RUN, ["merge-default", "--repo", "x"]);
    expect(short.code).toBe(1);
  });

  test("tracked dirt refuses", () => {
    const layout = scratchLayout(tmp, "dirty");
    recordGate(layout, passStub(layout));
    writeFileSync(join(layout.wt, "ticket.txt"), "dirty\n", "utf8");
    const r = mergeDefault(layout);
    expect(r.code).toBe(1);
    expect(r.err).toContain("uncommitted tracked changes");
  });

  test("untracked files do not block the card", () => {
    const layout = scratchLayout(tmp, "untracked");
    recordGate(layout, passStub(layout));
    expect(verifyRun(layout).code).toBe(0);
    writeFileSync(join(layout.wt, "scratch-note.txt"), "notes\n", "utf8");
    const r = mergeDefault(layout);
    expect(r.code).toBe(0);
    expect(r.out.split("\n")[0]).toContain("CARD:");
  });

  test("a merge in progress refuses", () => {
    const layout = scratchLayout(tmp, "merging");
    recordGate(layout, passStub(layout));
    writeFileSync(join(layout.repo, "clash.txt"), "main\n", "utf8");
    gitOrThrow(layout.repo, "add", "clash.txt");
    gitOrThrow(layout.repo, "commit", "-q", "-m", "main touches the line");
    writeFileSync(join(layout.wt, "clash.txt"), "ticket\n", "utf8");
    gitOrThrow(layout.wt, "add", "clash.txt");
    gitOrThrow(layout.wt, "commit", "-q", "-m", "ticket touches the line");
    run("git", ["-C", layout.wt, "merge", "main"]);
    const r = mergeDefault(layout);
    expect(r.code).toBe(1);
    expect(r.err).toContain("merge in progress");
  });

  test("a detached worktree refuses only when merging", () => {
    const stale = scratchLayout(tmp, "detached-stale");
    recordGate(stale, passStub(stale));
    mainMove(stale.repo, "after dispatch\n", "main moves after dispatch");
    gitOrThrow(stale.wt, "checkout", "-q", "--detach");
    const refused = mergeDefault(stale);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain("not on a branch");
    const fresh = scratchLayout(tmp, "detached-fresh");
    recordGate(fresh, passStub(fresh));
    expect(verifyRun(fresh).code).toBe(0);
    gitOrThrow(fresh.wt, "checkout", "-q", "--detach");
    const card = mergeDefault(fresh);
    expect(card.code).toBe(0);
    expect(card.out.split("\n")[0]).toContain("CARD:");
  });

  test("HEAD names the move to the ticket head", () => {
    const layout = scratchLayout(tmp, "head");
    recordGate(layout, passStub(layout));
    expect(verifyRun(layout).code).toBe(0);
    gitOrThrow(layout.wt, "checkout", "-q", headOf(layout.repo, "main"));
    const r = mergeDefault(layout);
    expect(r.code).toBe(2);
    expect(r.out.split("\n")[0]).toContain("HEAD:");
    expect(r.out).toContain("move the worktree to the ticket head");
  });

  test("a postmaster resume restarts the budget", () => {
    const layout = scratchLayout(tmp, "resume");
    recordGate(layout, moveAlwaysStub(layout));
    mainMove(layout.repo, "after dispatch\n", "main moves after dispatch");
    const first = drive(layout);
    expect(first.verdicts).toEqual(["MERGED", "MERGED", "CARD-ANYWAY"]);
    const ruled = run(RUN, [
      "log-action",
      layout.dispatch,
      "postmaster",
      "resume",
      "#379",
      "leg 1 synthesis, thread t",
    ]);
    expect(ruled.code).toBe(0);
    const second = drive(layout);
    expect(second.verdicts).toEqual(["MERGED", "MERGED", "CARD-ANYWAY"]);
    expect(countMerges(layout.repo, layout.ticket)).toBe(4);
    const merges = readActions(layout.dispatch).filter(
      (a) => a.actor === "coachman" && a.action === "merge",
    );
    expect(merges.length).toBe(4);
  });

  test("an unlogged merge fails closed with its recovery", () => {
    const layout = scratchLayout(tmp, "unlogged");
    recordGate(layout, passStub(layout));
    expect(verifyRun(layout).code).toBe(0);
    mainMove(layout.repo, "after dispatch\n", "main moves after dispatch");
    const log = join(layout.dispatch, "actions.jsonl");
    chmodSync(log, 0o444);
    try {
      const r = mergeDefault(layout);
      expect(r.code).toBe(1);
      expect(r.err).toContain("was not logged");
      expect(r.err).toContain("log-action");
      expect(countMerges(layout.repo, layout.ticket)).toBe(1);
    } finally {
      chmodSync(log, 0o644);
    }
  });

  test("prose merges count, with the merge base as the fallback main", () => {
    const layout = scratchLayout(tmp, "prose");
    recordGate(layout, passStub(layout));
    const base = headOf(layout.repo, "main");
    for (const n of [1, 2]) {
      const logged = run(RUN, [
        "log-action",
        layout.dispatch,
        "coachman",
        "merge",
        layout.ticket,
        `origin/main abc000${n} into ${layout.ticket}, clean`,
      ]);
      expect(logged.code).toBe(0);
    }
    mainMove(layout.repo, "after dispatch\n", "main moves after dispatch");
    const r = mergeDefault(layout);
    expect(r.code).toBe(0);
    expect(r.out.split("\n")[0]).toContain("CARD-ANYWAY:");
    expect(r.out).toContain(base);
    expect(r.out).toContain("raised anyway");
    expect(countMerges(layout.repo, layout.ticket)).toBe(0);
  });
});
