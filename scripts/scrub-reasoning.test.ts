import { expect, test } from "bun:test";
import { hasReasoning, isLiveReasoning, redactReasoning } from "./scrub-reasoning.ts";
import { REASONING_PLACEHOLDER } from "./scrub-report.ts";

const sealed = (): string => ["sealed", "text"].join("");

test("a live reasoning field counts whatever the record type's case", () => {
  expect(isLiveReasoning("thinking", "signature", sealed())).toBe(true);
  expect(isLiveReasoning("Thinking", "signature", sealed())).toBe(true);
  expect(isLiveReasoning("THINKING", "signature", sealed())).toBe(true);
  expect(isLiveReasoning("redacted_thinking", "data", sealed())).toBe(true);
  expect(isLiveReasoning("Redacted_Thinking", "data", sealed())).toBe(true);
  expect(isLiveReasoning("thinking", "data", sealed())).toBe(false);
  expect(isLiveReasoning("note", "signature", sealed())).toBe(false);
  expect(isLiveReasoning("thinking", "signature", REASONING_PLACEHOLDER)).toBe(false);
  expect(hasReasoning({ type: "Thinking", signature: sealed() })).toBe(true);
  expect(hasReasoning({ type: "thinking", signature: sealed() })).toBe(true);
  expect(hasReasoning({ type: "Thinking", signature: REASONING_PLACEHOLDER })).toBe(false);
});

test("reasoning inside prose-embedded JSON counts on both sides", () => {
  const line = JSON.stringify({ note: `says {"encrypted_content": "${sealed()}"} aloud` });
  expect(hasReasoning(JSON.parse(line) as unknown)).toBe(true);
  const redacted = redactReasoning(line);
  expect(redacted.count).toBe(1);
  expect(redacted.text).toContain(REASONING_PLACEHOLDER);
  expect(redacted.text).not.toContain(sealed());
  expect(hasReasoning({ note: "plain prose, no braces" })).toBe(false);
  expect(hasReasoning({ note: "unbalanced { brace" })).toBe(false);
});

test("nested JSON strings and arrays count on both sides", () => {
  const nested = JSON.stringify({ encrypted_content: sealed() });
  expect(hasReasoning({ nested })).toBe(true);
  expect(redactReasoning(JSON.stringify({ nested })).count).toBe(1);
  expect(hasReasoning([{ type: "thinking", signature: sealed() }])).toBe(true);
  expect(hasReasoning({ encrypted_content: REASONING_PLACEHOLDER })).toBe(false);
  expect(redactReasoning('{"encrypted_content": "<redacted:encrypted-reasoning>"}').count).toBe(0);
});

test("detection and redaction agree line for line", () => {
  // The promoter and the tree check share this definition so one cannot see
  // reasoning the other misses: flags if and only if scrubs.
  const lines = [
    JSON.stringify({ encrypted_content: sealed() }),
    JSON.stringify({ type: "Thinking", signature: sealed() }),
    JSON.stringify({ type: "REDACTED_THINKING", data: sealed() }),
    JSON.stringify({ note: `says {"encrypted_content": "${sealed()}"} aloud` }),
    JSON.stringify({ nested: JSON.stringify({ encrypted_content: sealed() }) }),
    JSON.stringify({ encrypted_content: REASONING_PLACEHOLDER }),
    JSON.stringify({ note: "nothing sensitive here" }),
    JSON.stringify(JSON.stringify({ encrypted_content: sealed() })),
    "not json at all",
    "",
  ];
  for (const line of lines) {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      /* falls through as unscannable */
    }
    expect(hasReasoning(parsed)).toBe(redactReasoning(line).count > 0);
  }
});
