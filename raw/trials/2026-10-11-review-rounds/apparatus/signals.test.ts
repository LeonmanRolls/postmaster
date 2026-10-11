import { describe, expect, test } from "bun:test";
import {
  pathKind,
  RULES,
  type RunFacts,
  roundFacts,
  signalRows,
  simulate,
  transitions,
  unseenEstimate,
} from "./signals.ts";

const run: RunFacts = {
  run: "1",
  rounds: 4,
  pair: ["luna", "mimo"],
  best: [3, 2, 1, 0],
  findings: [
    { round: 1, severity: "P2", lanes: ["luna"], file: "a.ts", group: null },
    { round: 1, severity: "P2", lanes: ["mimo"], file: "b.ts", group: null },
    { round: 1, severity: "P1", lanes: ["luna", "mimo"], file: "c.ts", group: null },
    { round: 2, severity: "P2", lanes: ["luna"], file: "a.ts", group: "made-by-last-fix" },
    { round: 2, severity: "P2", lanes: ["mimo"], file: "d.ts", group: "missed-lens-reviewed" },
    { round: 3, severity: "P2", lanes: ["luna"], file: "a.ts", group: "made-by-last-fix" },
  ],
  commits: [
    { phase: "change", added: 100, deleted: 0, paths: ["a.ts"], onMain: false },
    { phase: "fix:1", added: 10, deleted: 5, paths: ["a.ts", "a.test.ts"], onMain: false },
    { phase: "fix:2", added: 4, deleted: 2, paths: ["README.md"], onMain: false },
    { phase: "fix:3", added: 3, deleted: 0, paths: ["a.ts"], onMain: false },
  ],
};

describe("what is known at the end of a round", () => {
  const facts = roundFacts(run);
  test("counts, lanes and corroboration of a round", () => {
    expect(facts[0]?.n).toBe(3);
    expect(facts[0]?.traced).toBe(3);
    expect(facts[0]?.complete).toBe(true);
    expect(facts[0]?.p1).toBe(1);
    expect(facts[0]?.corroborated).toBe(1);
    expect(facts[0]?.first).toBe(2);
    expect(facts[0]?.second).toBe(2);
    expect(facts[0]?.both).toBe(1);
    expect(facts[0]?.lanes).toEqual(["luna", "mimo"]);
  });
  test("a finding in a file an earlier round named is a same-file finding", () => {
    expect(facts[1]?.sameFile).toBe(1);
    expect(facts[1]?.madeByFix).toBe(1);
    expect(facts[1]?.missed).toBe(1);
  });
  test("the lines of a round's fixes, in all files and in code", () => {
    expect(facts[0]?.fixLines).toBe(15);
    expect(facts[0]?.fixCodeLines).toBe(15);
    expect(facts[0]?.fixCommits).toBe(1);
    expect(facts[1]?.fixLines).toBe(6);
    expect(facts[1]?.fixCodeLines).toBe(0);
    expect(facts[1]?.fixCommits).toBe(1);
  });
  test("a path is a test, a document or code", () => {
    expect(pathKind("scripts/a.test.ts")).toBe("test");
    expect(pathKind("wiki/concepts/a.md")).toBe("doc");
    expect(pathKind("scripts/a.ts")).toBe("code");
  });
});

describe("transitions and rules", () => {
  test("a transition is a round that ended and was followed by another", () => {
    const ts = transitions([run]);
    expect(ts.map((t) => [t.round, t.next, t.clean])).toEqual([
      [1, 2, false],
      [2, 1, false],
      [3, 0, true],
    ]);
  });
  test("the rows count where a signal holds and the next round was clean", () => {
    const rows = signalRows(transitions([run]));
    const one = rows.find((r) => r.id === "one");
    expect(one?.flagged).toBe(1);
    expect(one?.flaggedClean).toBe(1);
    expect(one?.other).toBe(2);
    expect(one?.otherClean).toBe(0);
  });
  test("a rule stops a run at the first round it fires and counts what it skipped", () => {
    const rule = RULES.find((r) => r.id === "one-and-tiny");
    const s = simulate(rule as (typeof RULES)[number], [run]);
    expect(s?.fires).toBe(1);
    expect(s?.roundsSaved).toBe(1);
    expect(s?.seriousSkipped).toBe(0);
    expect(s?.cleanSkips).toBe(1);
    expect(s?.confirmingRounds).toBe(1);
  });
  test("a run the rule never fires on saves nothing (negative control)", () => {
    const rule = RULES.find((r) => r.id === "words-only");
    const quiet: RunFacts = { ...run, commits: run.commits.filter((c) => c.phase !== "fix:2") };
    const s = simulate(rule as (typeof RULES)[number], [quiet]);
    expect(s.fires).toBe(0);
    expect(s.roundsSaved).toBe(0);
  });
  test("the capture-recapture estimate of what two lanes leave unseen", () => {
    expect(unseenEstimate({ first: 2, second: 2, both: 2 })).toBeCloseTo(0, 5);
    expect(unseenEstimate({ first: 3, second: 3, both: 0 })).toBeGreaterThan(5);
  });
});
