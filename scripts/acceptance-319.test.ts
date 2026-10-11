// Oracle for #319, committed before the change: a ticket has at most five
// acceptance criteria not counting the fixture line (C1); the parts check
// warns without failing above five (C2); the clerk's instructions allow only
// leaving work out or splitting by outcome (C3); a split is one umbrella over
// slices (C4); and keeping more is recorded as the user's word while the
// warning stays (C5).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CLERK,
  COPY_MADE,
  DECISION,
  FIXTURE,
  outcome,
  runParts,
  TEMPLATE,
  ticketBody,
  warned,
} from "./acceptance-319.ts";

let tmp = "";
let seq = 0;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "acceptance-319-"));
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("C1: the template states the limit", () => {
  test("at most five criteria, and the fixture line is not counted", () => {
    const template = readFileSync(TEMPLATE, "utf8");
    expect(template).toContain("at most five acceptance criteria");
    expect(template).toContain("not counted");
  });
});

describe("C2: the parts check warns above five without failing", () => {
  const five = [0, 1, 2, 3, 4].map(outcome);
  const six = [0, 1, 2, 3, 4, 5].map(outcome);
  const cases: Array<{ name: string; criteria: string[]; warns: number | null }> = [
    { name: "seven with the fixture line last", criteria: [...six, FIXTURE], warns: 6 },
    {
      name: "seven with the fixture line last and a fixture-like middle line",
      criteria: [outcome(0), outcome(1), COPY_MADE, outcome(3), outcome(4), outcome(5), FIXTURE],
      warns: 6,
    },
    { name: "six with the fixture line last", criteria: [...five, FIXTURE], warns: null },
    { name: "six with no fixture line", criteria: six, warns: 6 },
    { name: "six with the fixture line first", criteria: [FIXTURE, ...five], warns: 6 },
    { name: "five with no fixture line", criteria: five, warns: null },
  ];
  for (const c of cases) {
    for (const flags of [["--final"], []] as Array<string[]>) {
      const label = flags.length > 0 ? flags.join(" ") : "no flag";
      test(`${c.name} (${label})`, () => {
        const out = runParts(
          tmp,
          `t${seq++}.md`,
          ticketBody(c.criteria, "(proposed)", DECISION),
          flags,
        );
        expect(out.code).toBe(0);
        expect(out.findings).toEqual([]);
        expect(out.notes).toContain(
          `criteria ${c.criteria.length}, decisions 1, technical notes 1`,
        );
        const found = warned(out.notes);
        if (c.warns === null) {
          expect(found).toEqual([]);
        } else {
          expect(found.length).toBe(1);
          const first = found[0] ?? "";
          expect(first.startsWith(`more than five criteria: ${c.warns}`)).toBe(true);
          expect(first).toContain("leave work out");
          expect(first).toContain("split");
        }
      });
    }
  }
});

describe("C3: the clerk's instructions allow two ways under the limit", () => {
  test("leave work out or split by outcome; packing and moving are not ways", () => {
    const clerk = readFileSync(CLERK, "utf8");
    expect(clerk).toContain("leave work out of the ticket");
    expect(clerk).toContain("slices the user can each check on their own");
    expect(clerk).toContain("packing ideas into one criterion");
    expect(clerk).toContain("moving a criterion into the decisions");
    expect(clerk).toContain("is not one of them");
  });
});

describe("C4: a split is one umbrella over slices", () => {
  test("umbrella shape in the template and the clerk's instructions", () => {
    const template = readFileSync(TEMPLATE, "utf8");
    const clerk = readFileSync(CLERK, "utf8");
    expect(template).toContain("umbrella");
    expect(clerk).toContain("umbrella");
    expect(template).toContain("slice");
    expect(clerk).toContain("slice");
    const both = `${template}\n${clerk}`;
    expect(both).toContain("never marked ready");
    expect(both).toContain("every slice it lists has landed");
    expect(both).toContain("the slices it needs");
    expect(both).toContain("restate");
    expect(both).toContain("only it follows");
  });
});

describe("C5: keeping more is the user's word, and the warning stays", () => {
  test("the template or the clerk's instructions say how it is recorded", () => {
    const template = readFileSync(TEMPLATE, "utf8");
    const clerk = readFileSync(CLERK, "utf8");
    expect(`${template}\n${clerk}`).toContain("how many criteria it keeps and why");
  });

  test("a seven-criteria ticket carrying the user's word still warns", () => {
    const seven = [0, 1, 2, 3, 4, 5, 6].map(outcome);
    const out = runParts(
      tmp,
      `t${seq++}.md`,
      ticketBody(
        seven,
        "(given by the user)",
        "This ticket keeps 7 criteria because the outcomes cannot be checked apart.",
      ),
      ["--final"],
    );
    expect(out.code).toBe(0);
    expect(out.findings).toEqual([]);
    const found = warned(out.notes);
    expect(found.length).toBe(1);
    const first = found[0] ?? "";
    expect(first.startsWith("more than five criteria: 7")).toBe(true);
  });
});
