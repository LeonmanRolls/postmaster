#!/usr/bin/env bun
// The one shared definition of what counts as encrypted reasoning. The
// promoter scrubs by it and the tree check flags by it, so the two cannot
// disagree: the record type whatever its case, reasoning inside
// prose-embedded JSON, a record pretty-printed across lines through the one
// whole-file entry, and a field the promoter already scrubbed (exactly
// the placeholder, nothing else) counting as clean on both sides.
//
// The two traversals differ on purpose and must stay that way: the
// transform recurses, so extreme nesting throws and fails closed at the
// gate; the detector walks iteratively and uncapped, so no nesting depth
// is a bypass. What they share is the match below, the brace scan and the
// embedded walk: neither side scans prose for JSON on its own.
import { pyLower, pyTrim } from "./lib/text.ts";
import { REASONING_PLACEHOLDER } from "./scrub-report.ts";

export function isLiveReasoning(type: unknown, key: string, value: unknown): boolean {
  if (value === REASONING_PLACEHOLDER) return false;
  const normalized = typeof type === "string" ? pyLower(type) : "";
  return (
    key === "encrypted_content" ||
    (normalized === "thinking" && key === "signature") ||
    (normalized === "redacted_thinking" && key === "data")
  );
}

export function balancedEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// The one walk over prose-embedded JSON: both the detector and the
// transform visit every balanced parseable span through here, so the two
// cannot advance differently again (an unbalanced brace is stepped past,
// never a stop). A visit that consumes its span advances past it.
export function scanEmbedded(
  text: string,
  visit: (parsed: unknown, start: number, end: number) => boolean,
): void {
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "{") {
      i++;
      continue;
    }
    const end = balancedEnd(text, i);
    if (end === -1) {
      i++;
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text.slice(i, end + 1)) as unknown;
    } catch {
      i++;
      continue;
    }
    i = visit(parsed, i, end) ? end + 1 : i + 1;
  }
}

function spliceEmbedded(value: string): { value: string; count: number } {
  let count = 0;
  let out = "";
  let cursor = 0;
  scanEmbedded(value, (parsed, start, end) => {
    const transformed = transformReasoning(parsed);
    if (!transformed.count) return false;
    out += value.slice(cursor, start) + JSON.stringify(transformed.value);
    cursor = end + 1;
    count += transformed.count;
    return true;
  });
  if (!count) return { value, count: 0 };
  return { value: out + value.slice(cursor), count };
}

export function transformReasoning(value: unknown): { value: unknown; count: number } {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const nested = JSON.parse(value) as unknown;
        const transformed = transformReasoning(nested);
        if (transformed.count)
          return { value: JSON.stringify(transformed.value), count: transformed.count };
        return { value, count: 0 };
      } catch {
        /* not pure JSON; scan for embedded objects below */
      }
    }
    return spliceEmbedded(value);
  }
  if (Array.isArray(value)) {
    let count = 0;
    const result = value.map((item) => {
      const next = transformReasoning(item);
      count += next.count;
      return next.value;
    });
    return { value: result, count };
  }
  if (typeof value !== "object" || value === null) return { value, count: 0 };
  const object = value as Record<string, unknown>;
  let count = 0;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(object)) {
    if (isLiveReasoning(object.type, key, item)) {
      result[key] = REASONING_PLACEHOLDER;
      count++;
    } else {
      const next = transformReasoning(item);
      result[key] = next.value;
      count += next.count;
    }
  }
  return { value: result, count };
}

// The whole-file fallback both sides share: when a file's full text parses
// as one JSON value (a pretty-printed record spanning lines), the promoter
// scrubs it and the tree check flags it through the same entry, so the two
// cannot split again. Single-line files and JSONL never qualify: a lone
// line is already handled per line, and several values cannot parse whole.
// The cap bounds the re-read DoS-style inputs to a fixed multiple of the
// longest-line budget; past it the per-line path stands.
export const WHOLE_JSON_CAP = 32 * 1024 * 1024;

export function firstNonWsChar(text: string): string {
  // The whole-file entry's first-character probe, shared so the promoter and
  // the detector cannot disagree on where the blob starts. Python whitespace
  // covers JSON's, so only unparseable bytes are ever skipped past; iteration
  // keeps astral characters whole. A UTF-8 byte-order mark rides ahead of
  // the value and is skipped too, wherever it sits among the whitespace.
  // Review round 11 (bug-60).
  const trimmed = pyTrim(text.replace(/\uFEFF/gu, ""));
  for (const ch of trimmed) return ch;
  return "";
}

export function maybeWholeJson(
  lineCount: number,
  firstNonWs: string,
  anyParseFail: boolean,
): boolean {
  return lineCount > 1 && (firstNonWs === "{" || firstNonWs === "[") && anyParseFail;
}

export function parseWholeJson(text: string): unknown | undefined {
  // A UTF-8 byte-order mark ahead of the value is skipped, matching the
  // gate; one inside the value is content and left for JSON to judge.
  // Review round 11 (bug-60).
  try {
    return JSON.parse(text.replace(/^\uFEFF+/u, "")) as unknown;
  } catch {
    return undefined;
  }
}

export function redactReasoning(line: string): { text: string; count: number } {
  // No shape gate: a bare JSON string can hold an object with reasoning, and
  // skipping it here while the detector walks it would split the two again.
  try {
    const parsed = JSON.parse(line) as unknown;
    const transformed = transformReasoning(parsed);
    return transformed.count
      ? { text: JSON.stringify(transformed.value), count: transformed.count }
      : { text: line, count: 0 };
  } catch {
    // A prose line can embed reasoning JSON without parsing whole; the
    // shared string walk visits the same spans the detector walks.
    const walked = transformReasoning(line);
    if (!walked.count || typeof walked.value !== "string") return { text: line, count: 0 };
    return { text: walked.value, count: walked.count };
  }
}

export function hasReasoning(value: unknown): boolean {
  // Iterative and uncapped: a depth limit here is a bypass by nesting.
  // The string walk mirrors the transform exactly: pure JSON parses and
  // walks, anything else scans for embedded objects. Takes a parsed JSON
  // value (or null for an unscannable line), as the tree check calls it.
  const stack: unknown[] = [value];
  while (stack.length) {
    const current = stack.pop()!;
    if (typeof current === "string") {
      const trimmed = current.trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        try {
          stack.push(JSON.parse(current) as unknown);
          continue;
        } catch {
          /* not pure JSON; scan for embedded objects below */
        }
      }
      scanEmbedded(current, (parsed) => {
        stack.push(parsed);
        return false;
      });
      continue;
    }
    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }
    if (typeof current !== "object" || current === null) continue;
    const record = current as Record<string, unknown>;
    for (const [key, item] of Object.entries(record)) {
      if (isLiveReasoning(record.type, key, item)) return true;
      stack.push(item);
    }
  }
  return false;
}
