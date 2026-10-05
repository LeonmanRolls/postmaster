#!/usr/bin/env bun
// The one shared module for logging a finding, printing a value or a path,
// and state-safe redaction matching. Every scrub script calls it; no script
// keeps its own copy.
//
// - Logging: logFinding writes detections.jsonl, and drops draft-only scans:
//   a draft is reworded and scanned again, never resolved, so a draft row
//   must never sit in the log waiting for a resolution.
// - Printing: findingRow formats a finding row with its path redacted, and
//   errorText/fail redact the whole message, so no message a person reads
//   shows a finding's value, even when the value is in a file name.
// - Redaction: safePath hides finding-shaped spans, and the *Reset helpers
//   run a shared global regex without leaking lastIndex between calls; an
//   ad-hoc lastIndex reset anywhere else is a copy of this discipline.
//
// The import edge to scrub-core.ts runs both ways (safePath detects through
// it, detection matches through here) and is runtime-only on both sides:
// neither file calls the other's imports while evaluating.
import { closeSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { detectLine } from "./scrub-core.ts";

// --- logging -----------------------------------------------------------------

const DRAFT_PLACES: ReadonlySet<string> = new Set(["(pr-description)"]);

export function isDraftPlace(file: string): boolean {
  return DRAFT_PLACES.has(file);
}

export function logFinding(rule: string, file: string, line: number, commit = "", via = ""): void {
  if (isDraftPlace(file)) return;
  const log = process.env.POSTMASTER_DETECTIONS_LOG;
  if (!log) return;
  const record: Record<string, unknown> = {
    rule,
    file: safePath(file),
    line,
    commit,
    time: new Date().toISOString(),
  };
  if (via) record.via = via;
  try {
    mkdirSync(dirname(log), { recursive: true });
    const fd = openSync(log, "a", 0o600);
    try {
      writeFileSync(fd, `${JSON.stringify(record)}\n`, "utf8");
    } finally {
      closeSync(fd);
    }
  } catch {
    throw new Error("could not write detections log");
  }
}

// --- printing ------------------------------------------------------------------

export function findingRow(path: string, line: number, rule: string): string {
  return `${safePath(path)}:${line}: ${rule}`;
}

export function errorText(prefix: string, message: string): string {
  return `${prefix}: ${safePath(message)}`;
}

export function fail(prefix: string, message: string): never {
  console.error(errorText(prefix, message));
  process.exit(2);
}

// --- redaction -------------------------------------------------------------------

export function safePath(path: string): string {
  const matches = detectLine(path).sort((a, b) => a.start - b.start || b.end - a.end);
  let out = "";
  let cursor = 0;
  for (const f of matches) {
    if (f.start < cursor) continue;
    out += path.slice(cursor, f.start) + "[redacted]";
    cursor = f.end;
  }
  return out + path.slice(cursor);
}

export const REASONING_PLACEHOLDER = "<redacted:encrypted-reasoning>";

export function testReset(re: RegExp, value: string): boolean {
  re.lastIndex = 0;
  try {
    return re.test(value);
  } finally {
    re.lastIndex = 0;
  }
}

export function execReset(re: RegExp, value: string): RegExpExecArray | null {
  re.lastIndex = 0;
  try {
    return re.exec(value);
  } finally {
    re.lastIndex = 0;
  }
}

export function* scanReset(re: RegExp, value: string): Generator<RegExpExecArray> {
  re.lastIndex = 0;
  try {
    let match: RegExpExecArray | null;
    while ((match = re.exec(value)) !== null) {
      yield match;
      if (!re.global && !re.sticky) break;
    }
  } finally {
    re.lastIndex = 0;
  }
}

export function replaceReset(re: RegExp, value: string, replacement: string): string {
  re.lastIndex = 0;
  try {
    return value.replace(re, replacement);
  } finally {
    re.lastIndex = 0;
  }
}
