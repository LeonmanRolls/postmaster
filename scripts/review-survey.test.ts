// Tests beside scripts/review-survey.ts: the pure pieces the #329 oracle
// drives through the command (attribution, parts, sections, renders).
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildRounds,
  degradeRound,
  findingRound,
  gateRound,
  launchRound,
  missingParts,
  parseRound,
  plainWords,
  readSections,
  renderEscalation,
  renderQuestion,
  resolveTimeout,
} from "./review-survey.ts";

describe("round attribution", () => {
  test("findings read strictly", () => {
    expect(findingRound("gating P2 r3 bug luna, verified by reading")).toBe(3);
    expect(findingRound("style P3 r1 style mimo, verified by reading")).toBe(1);
    expect(findingRound("gating P2 x3 bug luna")).toBe(null);
    expect(findingRound("gating P4 r3 bug luna")).toBe(null);
    expect(findingRound("note P2 r3 bug luna")).toBe(null);
    expect(findingRound("gating r3 bug luna")).toBe(null);
  });

  test("launches read strictly, then leniently", () => {
    expect(launchRound("bug round 2")).toBe(2);
    expect(launchRound("security round 10")).toBe(10);
    expect(launchRound("bug r7")).toBe(7);
    expect(launchRound("bug round 2 retry")).toBe(2);
    expect(launchRound('{"snapshot":"abc"}')).toBe(null);
    expect(launchRound("bug round x")).toBe(null);
  });

  test("degrades read strictly, then leniently", () => {
    expect(degradeRound("bug r2: timeout")).toBe(2);
    expect(degradeRound("bug round 2: harvest failed")).toBe(2);
    expect(degradeRound("security round 6 attempt 1: stopped twice")).toBe(6);
    expect(degradeRound("security r6: stopped twice")).toBe(6);
    expect(degradeRound("bug round two: timeout")).toBe(null);
  });

  test("a surveyor degrade attributes to no round", () => {
    expect(degradeRound("survey rise-r5: exit 1")).toBe(null);
  });

  test("gate lines match their round on a word boundary", () => {
    expect(gateRound("review round 2, run verify exit 0", 2)).toBe(true);
    expect(gateRound("review round 2 retry, run verify exit 0", 2)).toBe(true);
    expect(gateRound("review round 20, run verify exit 0", 2)).toBe(false);
    expect(gateRound("round 2 fixes, bun run check exit 0", 2)).toBe(false);
    expect(gateRound("review round 2", 2)).toBe(true);
  });

  test("rounds parse strictly", () => {
    expect(parseRound("2")).toBe(2);
    expect(parseRound("0")).toBe(null);
    expect(parseRound("x")).toBe(null);
    expect(parseRound("2x")).toBe(null);
    expect(parseRound("")).toBe(null);
  });
});

describe("parts and plain words", () => {
  const ANSWER = [
    "## Conclusion",
    "",
    "It is the ticket.",
    "",
    "## What the findings share",
    "",
    "The sites.",
    "",
    "## Where the cause lies",
    "",
    "In the ticket.",
    "",
    "## What is still open",
    "",
    "The scope.",
    "",
    "## Whether another round is likely to help",
    "",
    "No.",
    "",
    "## What I could not tell",
    "",
    "Nothing.",
    "",
    "The ticket asks for too much, so each round finds more. Scope it instead.",
    "",
  ].join("\n");

  test("a full answer misses nothing", () => {
    expect(missingParts(ANSWER)).toEqual([]);
  });

  test("headings match case-insensitively with decoration", () => {
    const decorated = ANSWER.replace("## Where the cause lies", "## Part 2: WHERE THE CAUSE LIES");
    expect(missingParts(decorated)).toEqual([]);
  });

  test("a part named only in body text still misses", () => {
    const dropped = ANSWER.replace("## What is still open\n", "What is still open\n");
    expect(missingParts(dropped)).toEqual(["What is still open"]);
  });

  test("missing parts come back in question order", () => {
    const dropped = ANSWER.replace("## Whether another round is likely to help\n", "").replace(
      "## What the findings share\n",
      "",
    );
    expect(missingParts(dropped)).toEqual([
      "What the findings share",
      "Whether another round is likely to help",
    ]);
  });

  test("the plain words are the closing paragraph", () => {
    expect(plainWords(ANSWER)).toBe(
      "The ticket asks for too much, so each round finds more. Scope it instead.",
    );
    expect(plainWords("## Only\n\nFirst.\n\nSecond.\n\n\n")).toBe("Second.");
    expect(plainWords("   \n\n  ")).toBe("");
  });
});

describe("sections", () => {
  test("three sections read verbatim and trimmed", () => {
    const parsed = readSections(
      "## Residue\n\nLeftovers.\n\n## Options\n\n1. Fix.\n\n## Advice\n\nFix.\n",
      ["Residue", "Options", "Advice"],
    );
    expect("values" in parsed).toBe(true);
    if ("values" in parsed) {
      expect(parsed.values.get("Residue")).toBe("Leftovers.");
      expect(parsed.values.get("Options")).toBe("1. Fix.");
      expect(parsed.values.get("Advice")).toBe("Fix.");
    }
  });

  test("headings match case-insensitively; content stops at the next heading", () => {
    const parsed = readSections("## OPTIONS\n\n1. Fix.\n## Notes\n\nAside.\n", ["Options"]);
    expect("values" in parsed).toBe(true);
    if ("values" in parsed) expect(parsed.values.get("Options")).toBe("1. Fix.");
  });

  test("missing and empty sections are named", () => {
    const parsed = readSections("## Residue\n\nLeftovers.\n\n## Advice\n\n", [
      "Residue",
      "Options",
      "Advice",
    ]);
    expect(parsed).toEqual({ missing: ["Options", "Advice"] });
  });
});

describe("renders", () => {
  const SECTIONS = { residue: "R.", options: "1. O.", advice: "A." };

  test("the escalation carries the survey and its gaps", () => {
    expect(
      renderEscalation(
        5,
        "RULING 5: more; escalate with residue",
        {
          record: "surveys/rise-r5.md",
          missing: ["Where the cause lies"],
        },
        SECTIONS,
      ),
    ).toBe(
      "# Escalation: review loop stopped at round 5\n\nDecision: RULING 5: more; escalate with residue\nSurvey: surveys/rise-r5.md\nMissing parts: Where the cause lies\n\n## Residue\n\nR.\n\n## Options\n\n1. O.\n\n## Advice\n\nA.\n",
    );
  });

  test("the escalation carries a missing survey without gaps", () => {
    const text = renderEscalation(
      5,
      "RULING 5: more; escalate with residue",
      {
        reason: "the surveyor lane exited 1.",
      },
      SECTIONS,
    );
    expect(text).toContain("Survey missing: the surveyor lane exited 1.\n");
    expect(text).not.toContain("Missing parts");
  });

  test("the question opens with its first paragraph", () => {
    expect(renderQuestion("Plain words.", { options: "1. O.", advice: "A." })).toBe(
      "Plain words.\n\n## Options\n\n1. O.\n\n## Advice\n\nA.\n",
    );
  });
});

describe("rounds assembly", () => {
  test("lines stay verbatim with counts and snapshots", () => {
    const raw1 = JSON.stringify({
      action: "finding",
      target: "a.ts:1",
      detail: "gating P2 r1 bug luna, verified by reading",
    });
    const raw2 = JSON.stringify({
      action: "finding",
      target: "b.ts:1",
      detail: "gating P1 r2 bug luna, verified by reading",
    });
    const text = buildRounds(
      [
        { action: "gate", target: "aaa", detail: "review round 1, run verify exit 0", raw: "g1" },
        {
          action: "finding",
          target: "a.ts:1",
          detail: "gating P2 r1 bug luna, verified by reading",
          raw: raw1,
        },
        { action: "note", target: "x", detail: "aside", raw: "n1" },
        {
          action: "finding",
          target: "b.ts:1",
          detail: "gating P1 r2 bug luna, verified by reading",
          raw: raw2,
        },
      ],
      2,
      "zzz",
    );
    expect(text).toContain(raw1);
    expect(text).toContain(raw2);
    expect(text).not.toContain("g1");
    expect(text).not.toContain("n1");
    expect(text).toContain("counts: r1=1 r2=1");
    expect(text).toContain("round-snapshots: r1=aaa r2=zzz");
    expect(text).toContain("survey-snapshot: zzz");
  });

  test("a malformed finding faults", () => {
    expect(() =>
      buildRounds(
        [{ action: "finding", target: "a.ts:1", detail: "gating P9 r1 bug luna", raw: "bad" }],
        1,
        "zzz",
      ),
    ).toThrow("severity");
  });
});

describe("timeout", () => {
  test("absent reads as the default, wrong reads warned", () => {
    const dir = mkdtempSync(join(tmpdir(), "rise-timeout-"));
    try {
      expect(resolveTimeout(dir)).toBe(2400);
      writeFileSync(
        join(dir, "run.json"),
        JSON.stringify({ config: { review: { round_timeout_seconds: 99 } } }),
      );
      expect(resolveTimeout(dir)).toBe(99);
      writeFileSync(
        join(dir, "run.json"),
        JSON.stringify({ config: { review: { round_timeout_seconds: "soon" } } }),
      );
      expect(resolveTimeout(dir)).toBe(2400);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
