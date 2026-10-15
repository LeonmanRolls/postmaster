import { describe, expect, test } from "bun:test";
import {
  type BlameLine,
  groupOf,
  identity,
  type OwnCommit,
  originOf,
  parseBlame,
  parseTarget,
  phaseOf,
  snapshotOf,
} from "./origin.ts";

describe("a finding's target", () => {
  test("a file and a line, a range, and an L-range are read", () => {
    expect(parseTarget("scripts/lib/effective-config.ts:663")).toEqual({
      file: "scripts/lib/effective-config.ts",
      first: 663,
      last: 663,
    });
    expect(parseTarget("scripts/front-door.sh:51-56")).toEqual({
      file: "scripts/front-door.sh",
      first: 51,
      last: 56,
    });
    expect(parseTarget("skills/postmaster/postmaster.md:L5-L99")?.last).toBe(99);
  });
  test("a sentence, or a file with no line, names no place (negative control)", () => {
    expect(parseTarget("O1 P1 PEM body survives scrub")).toBeNull();
    expect(parseTarget("scripts/scrub-check.sh F1-F8")).toBeNull();
    expect(parseTarget("scripts/launch.ts")).toBeNull();
  });
  test("a range of more than 400 lines is not a place", () => {
    expect(parseTarget("a.ts:1-900")).toBeNull();
  });
});

describe("phases and snapshots", () => {
  // round 1 launched at 100, round 2 at 200, round 3 at 300
  const launches = new Map([
    [1, 100],
    [2, 200],
    [3, 300],
  ]);
  test("a commit at or before round 1 is the change", () => {
    expect(phaseOf(50, launches)).toEqual({ kind: "change" });
    expect(phaseOf(100, launches)).toEqual({ kind: "change" });
  });
  test("a commit between two launches is a fix of the earlier round", () => {
    expect(phaseOf(101, launches)).toEqual({ kind: "fix", round: 1 });
    expect(phaseOf(200, launches)).toEqual({ kind: "fix", round: 1 });
    expect(phaseOf(250, launches)).toEqual({ kind: "fix", round: 2 });
  });
  test("a commit after the last launch is later", () => {
    expect(phaseOf(301, launches)).toEqual({ kind: "later" });
  });
  test("the snapshot is the last own commit at or before the launch, picks of main skipped", () => {
    const own: OwnCommit[] = [
      { sha: "a", time: 50, parents: 1, onMain: false },
      { sha: "b", time: 90, parents: 1, onMain: true },
      { sha: "c", time: 150, parents: 1, onMain: false },
    ];
    expect(snapshotOf(own, 100)).toBe("a");
    expect(snapshotOf(own, 200)).toBe("c");
    expect(snapshotOf(own, 10)).toBeNull();
  });
});

describe("blame and origin", () => {
  const sha1 = "1".repeat(40);
  const sha2 = "2".repeat(40);
  const porcelain = [
    `${sha1} 10 5 1`,
    "author x",
    "filename scripts/a.ts",
    "\tconst a = 1;",
    `${sha2} 3 6 1`,
    "author y",
    "filename scripts/a.ts",
    "\tconst b = 2;",
    `${sha1} 11 7`,
    "\tconst c = 3;",
  ].join("\n");
  test("each blamed line gets its commit, its original line, its file and its content", () => {
    const lines = parseBlame(porcelain);
    expect(lines.map((l) => l.sha)).toEqual([sha1, sha2, sha1]);
    expect(lines[0]).toEqual({
      sha: sha1,
      origLine: 10,
      finalLine: 5,
      file: "scripts/a.ts",
      content: "const a = 1;",
    });
    expect(lines[2]?.file).toBe("scripts/a.ts");
    expect(identity(lines[1] as BlameLine)).toBe(`${sha2}:scripts/a.ts:3`);
  });
  const lines: BlameLine[] = [
    { sha: "f", origLine: 1, finalLine: 1, file: "a", content: "" },
    { sha: "c", origLine: 2, finalLine: 2, file: "a", content: "" },
    { sha: "b", origLine: 3, finalLine: 3, file: "a", content: "" },
  ];
  const classify = (sha: string) =>
    sha === "f"
      ? ({ kind: "fix", round: 2 } as const)
      : sha === "c"
        ? ({ kind: "change" } as const)
        : ("base" as const);
  test("a line a fix of an earlier round wrote beats the change's, which beats the base's", () => {
    expect(originOf(lines, 3, classify)).toEqual({ kind: "fix", round: 2, sha: "f" });
    expect(originOf(lines.slice(1), 3, classify)).toEqual({ kind: "change", sha: "c" });
    expect(originOf(lines.slice(2), 3, classify)).toEqual({ kind: "base", sha: "b" });
  });
  test("a fix of the same round or a later one is not an earlier fix", () => {
    expect(originOf(lines.slice(0, 1), 2, classify).kind).toBe("base");
  });
  test("no line blamed is unplaced", () => {
    expect(originOf([], 2, classify).kind).toBe("unplaced");
  });
});

describe("the groups of rule.md", () => {
  const base = { round: 3, placedBefore: false, lensReviewedBefore: true };
  test("held open: named before and not rewritten by a fix", () => {
    expect(groupOf({ ...base, origin: { kind: "change", sha: "a" }, placedBefore: true })).toBe(
      "held-open",
    );
    expect(groupOf({ ...base, origin: { kind: "base", sha: "a" }, placedBefore: true })).toBe(
      "held-open",
    );
  });
  test("made by the last fix, or an older one", () => {
    expect(groupOf({ ...base, origin: { kind: "fix", round: 2, sha: "a" } })).toBe(
      "made-by-last-fix",
    );
    expect(groupOf({ ...base, origin: { kind: "fix", round: 1, sha: "a" } })).toBe(
      "made-by-older-fix",
    );
  });
  test("a place a fix rewrote is made by a fix even where it was named before", () => {
    expect(
      groupOf({ ...base, placedBefore: true, origin: { kind: "fix", round: 2, sha: "a" } }),
    ).toBe("made-by-last-fix");
  });
  test("missed, with or without a reviewer of its lens before", () => {
    expect(groupOf({ ...base, origin: { kind: "change", sha: "a" } })).toBe("missed-lens-reviewed");
    expect(
      groupOf({ ...base, lensReviewedBefore: false, origin: { kind: "change", sha: "a" } }),
    ).toBe("missed-not-asked");
  });
  test("outside the change, and unplaced", () => {
    expect(groupOf({ ...base, origin: { kind: "base", sha: "a" } })).toBe("outside");
    expect(groupOf({ ...base, origin: { kind: "unplaced", why: "x" } })).toBe("unplaced");
  });
});
