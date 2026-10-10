import { expect, test } from "bun:test";
import {
  firstNonWsChar,
  hasReasoning,
  isLiveReasoning,
  parseWholeJson,
  redactReasoning,
  transformReasoning,
} from "./scrub-reasoning.ts";
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
    JSON.stringify({ note: `stray { brace then {"encrypted_content": "${sealed()}"}` }),
    JSON.stringify({ note: `x {y {"encrypted_content": "${sealed()}"}}` }),
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

test("a pretty-printed record counts on both sides through the whole-file entry", () => {
  // Review round 9 (bug-36): per-line callers never saw a record spanning
  // lines. Both sides share parseWholeJson, so they cannot split again.
  const pretty = JSON.stringify({ type: "reasoning", encrypted_content: sealed() }, null, 2);
  expect(pretty.includes("\n")).toBe(true);
  const whole = parseWholeJson(pretty);
  expect(whole).not.toBe(undefined);
  expect(hasReasoning(whole)).toBe(true);
  const transformed = transformReasoning(whole);
  expect(transformed.count).toBe(1);
  expect(JSON.stringify(transformed.value)).toContain(REASONING_PLACEHOLDER);
  expect(parseWholeJson(`${pretty}\n${pretty}`)).toBe(undefined);
  expect(parseWholeJson("not json at all")).toBe(undefined);
});

test("a byte-order mark ahead of JSON counts on both sides", () => {
  // Review round 11 (bug-60): the whole-file gate read U+FEFF as the
  // first character, so a BOM-prefixed record skipped the whole entry.
  expect(firstNonWsChar("\uFEFF{")).toBe("{");
  expect(firstNonWsChar("  \uFEFF{")).toBe("{");
  expect(firstNonWsChar("\uFEFF\uFEFF{")).toBe("{");
  expect(firstNonWsChar("\uFEFF")).toBe("");
  const pretty = JSON.stringify({ type: "reasoning", encrypted_content: sealed() }, null, 2);
  const whole = parseWholeJson(`\uFEFF${pretty}`);
  expect(whole).not.toBe(undefined);
  expect(hasReasoning(whole)).toBe(true);
  const kept = parseWholeJson(JSON.stringify({ note: "\uFEFFkept" }));
  expect((kept as { note: string }).note).toBe("\uFEFFkept");
});

test("reasoning in a prose line's embedded JSON counts on both sides", () => {
  // Review round 10 (bug-53): both sides only recognised whole lines that
  // parse as JSON, so a prose line embedding a reasoning record sailed
  // through promote and the tree check alike.
  const blob = `{"type":"reasoning","encrypted_content":"${sealed()}"}`;
  const line = `note: ${blob} done`;
  expect(hasReasoning(line)).toBe(true);
  const redacted = redactReasoning(line);
  expect(redacted.count).toBe(1);
  expect(redacted.text).toContain(REASONING_PLACEHOLDER);
  expect(redacted.text).not.toContain(sealed());
  expect(redacted.text.startsWith("note: ")).toBe(true);
  expect(redacted.text.endsWith(" done")).toBe(true);
});

test("the whole-file probe reads the first visible character", () => {
  expect(firstNonWsChar("")).toBe("");
  expect(firstNonWsChar("   \t ")).toBe("");
  expect(firstNonWsChar('  {"a": 1}')).toBe("{");
  expect(firstNonWsChar("\u00a0[1]")).toBe("[");
  expect(firstNonWsChar("\x1c{junk}")).toBe("{");
  expect(firstNonWsChar("\u{1F600}x")).toBe("\u{1F600}");
});
