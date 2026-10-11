import { describe, expect, test } from "bun:test";
import {
  buildPrompt,
  canonical,
  extractAnswers,
  isCorrect,
  scoreRun,
  wilson,
  type Question,
} from "./reading.ts";

const questions: Question[] = [
  { id: "Q01", type: "trace", prompt: "What is 1 + 1?" },
  { id: "Q02", type: "state", prompt: "Which words?" },
];

describe("the prompt", () => {
  test("holds the source, the glossary and every question, and none of the truth", () => {
    const prompt = buildPrompt({
      file: "scripts/x.ts",
      source: "export const A = 1;\n",
      glossary: "- pyTrim: Python's strip()",
      questions,
    });
    expect(prompt).toContain("## Source: scripts/x.ts");
    expect(prompt).toContain("export const A = 1;");
    expect(prompt).toContain("- pyTrim: Python's strip()");
    expect(prompt).toContain("### Q01\nWhat is 1 + 1?");
    expect(prompt).toContain("### Q02\nWhich words?");
  });

  test("a careful reader is told to trace, a quick one to write nothing but the answers", () => {
    const args = { file: "scripts/x.ts", source: "x", glossary: "g", questions };
    const careful = buildPrompt({ ...args, mode: "careful" });
    const quick = buildPrompt({ ...args, mode: "quick" });
    expect(careful).toContain("Trace it carefully, step by step");
    expect(quick).not.toContain("Trace it carefully");
    expect(quick).toContain("Do not write out your reasoning");
    expect(buildPrompt(args)).toBe(careful);
  });
});

describe("reading the answers back", () => {
  test("takes the last json block", () => {
    const reply = 'first\n```json\n{"Q01": 1}\n```\nthen\n```json\n{"Q01": 2}\n```';
    expect(extractAnswers(reply)).toEqual({ Q01: 2 });
  });

  test("falls back to the last object in the text", () => {
    expect(extractAnswers('thinking... {"a": 1} and finally {"Q01": "x"}')).toEqual({ Q01: "x" });
  });

  test("a reply with no object reads as nothing", () => {
    expect(extractAnswers("I cannot tell.")).toBeNull();
    expect(extractAnswers("```json\n[1, 2]\n```")).toBeNull();
  });
});

describe("scoring", () => {
  test("a number and its string, and yes and true, compare equal", () => {
    expect(isCorrect("3", 3)).toBe(true);
    expect(isCorrect("yes", true)).toBe(true);
    expect(isCorrect("no", true)).toBe(false);
    expect(canonical([1, "2"])).toBe(canonical(["1", 2]));
  });

  test("lists are ordered and strings are exact apart from spacing", () => {
    expect(isCorrect(["a", "b"], ["b", "a"])).toBe(false);
    expect(isCorrect(" a  b ", "a b")).toBe(true);
    expect(isCorrect("A", "a")).toBe(false);
  });

  test("the undetermined control accepts only that answer, in any case", () => {
    expect(isCorrect("Undetermined", "undetermined")).toBe(true);
    expect(isCorrect("42", "undetermined")).toBe(false);
  });

  test("a missing answer is wrong and not answered", () => {
    const scored = scoreRun({ Q01: 2 }, { Q01: 2, Q02: ["a"] }, questions);
    expect(scored).toEqual([
      { id: "Q01", type: "trace", answered: true, correct: true },
      { id: "Q02", type: "state", answered: false, correct: false },
    ]);
  });

  test("no answers at all scores every question wrong", () => {
    expect(scoreRun(null, { Q01: 2, Q02: 1 }, questions).every((s) => !s.correct)).toBe(true);
  });
});

describe("the interval", () => {
  test("is the Wilson interval and brackets the share", () => {
    const [lo, hi] = wilson(8, 10);
    expect(lo).toBeCloseTo(0.49, 2);
    expect(hi).toBeCloseTo(0.94, 2);
    expect(wilson(0, 0)).toEqual([0, 1]);
  });
});
