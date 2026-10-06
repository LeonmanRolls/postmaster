#!/usr/bin/env bun
// The one shared definition of what counts as encrypted reasoning. The
// promoter scrubs by it and the tree check flags by it, so the two cannot
// disagree: the record type whatever its case, reasoning inside
// prose-embedded JSON, and a field the promoter already scrubbed (exactly
// the placeholder, nothing else) counting as clean on both sides.
//
// The two traversals differ on purpose and must stay that way: the
// transform recurses, so extreme nesting throws and fails closed at the
// gate; the detector walks iteratively and uncapped, so no nesting depth
// is a bypass. What they share is the match below and the brace scan.
import { pyLower } from "./lib/text.ts";
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

function spliceEmbedded(value: string): { value: string; count: number } {
  let count = 0;
  let out = "";
  let cursor = 0;
  let i = 0;
  while (i < value.length) {
    if (value[i] !== "{") {
      i++;
      continue;
    }
    const end = balancedEnd(value, i);
    if (end === -1) {
      i++;
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(value.slice(i, end + 1)) as unknown;
    } catch {
      i++;
      continue;
    }
    const transformed = transformReasoning(parsed);
    if (!transformed.count) {
      i++;
      continue;
    }
    out += value.slice(cursor, i) + JSON.stringify(transformed.value);
    cursor = end + 1;
    i = end + 1;
    count += transformed.count;
  }
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
    return { text: line, count: 0 };
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
      let i = 0;
      while (i < current.length) {
        if (current[i] !== "{") {
          i++;
          continue;
        }
        const end = balancedEnd(current, i);
        if (end === -1) break;
        try {
          stack.push(JSON.parse(current.slice(i, end + 1)) as unknown);
        } catch {
          /* not JSON; keep scanning past the brace */
        }
        i++;
      }
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
