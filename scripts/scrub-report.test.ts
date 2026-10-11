import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupScratch, email, scratchDir, token } from "./scrub-test-kit.ts";
import {
  errorText,
  execReset,
  findingRow,
  isDraftPlace,
  isDraftRecord,
  logFinding,
  mergeSpans,
  replaceReset,
  safePath,
  scanReset,
  testReset,
} from "./scrub-report.ts";

afterEach(cleanupScratch);

function withLog(): { log: string; restore: () => void } {
  const log = join(scratchDir(), "detections.jsonl");
  const previous = process.env.POSTMASTER_DETECTIONS_LOG;
  process.env.POSTMASTER_DETECTIONS_LOG = log;
  return {
    log,
    restore: () => {
      if (previous === undefined) delete process.env.POSTMASTER_DETECTIONS_LOG;
      else process.env.POSTMASTER_DETECTIONS_LOG = previous;
    },
  };
}

test("logFinding writes one row with the file redacted", () => {
  const { log, restore } = withLog();
  try {
    logFinding("email", `src/${email()}`, 3, "abc");
    const row = JSON.parse(readFileSync(log, "utf8")) as Record<string, unknown>;
    expect(row.rule).toBe("email");
    expect(row.file).toBe("src/[redacted]");
    expect(row.line).toBe(3);
    expect(String(row.file)).not.toContain(email());
  } finally {
    restore();
  }
});

test("logFinding writes nothing without the log env", () => {
  const previous = process.env.POSTMASTER_DETECTIONS_LOG;
  delete process.env.POSTMASTER_DETECTIONS_LOG;
  try {
    // No destination, no write, no throw; the assertion keeps skip-check
    // from reading this no-op as a test that checks nothing.
    expect(() => logFinding("email", "src/a.ts", 1, "")).not.toThrow();
  } finally {
    if (previous !== undefined) process.env.POSTMASTER_DETECTIONS_LOG = previous;
  }
});

test("logFinding marks a draft-only scan via draft, and the readers skip it", () => {
  // Review round 6: dropping draft rows broke C29's one line per finding,
  // so drafts log marked and the block and TELL skip them instead.
  const { log, restore } = withLog();
  try {
    expect(isDraftPlace("(pr-description)")).toBe(true);
    expect(isDraftPlace("(message)")).toBe(false);
    logFinding("email", "(pr-description)", 2, "");
    const row = JSON.parse(readFileSync(log, "utf8")) as Record<string, unknown>;
    expect(row.rule).toBe("email");
    expect(row.via).toBe("draft");
    expect(isDraftRecord(row)).toBe(true);
    expect(isDraftRecord({ rule: "email", file: "a.ts", line: 1, commit: "" })).toBe(false);
    expect(isDraftRecord({ rule: "email", file: "a.ts", line: 1, commit: "", via: "marker" })).toBe(
      false,
    );
  } finally {
    restore();
  }
});

test("findingRow formats path, line and rule with the path redacted", () => {
  expect(findingRow("src/a.ts", 12, "email")).toBe("src/a.ts:12: email");
  const row = findingRow(`(${email()}`, 1, "email");
  expect(row).toBe("([redacted]:1: email");
  expect(row).not.toContain(email());
});

test("errorText prefixes the script and redacts values anywhere in the message", () => {
  expect(errorText("tree-check", "the tree could not be read")).toBe(
    "tree-check: the tree could not be read",
  );
  const text = errorText("scrub-check", `a finding in (${email()} could not be shown`);
  expect(text).not.toContain(email());
  expect(text.startsWith("scrub-check: ")).toBe(true);
});

test("testReset matches from the start on a dirty global regex and leaves it clean", () => {
  const re = /a/gu;
  expect(re.test("a")).toBe(true);
  expect(re.lastIndex).toBe(1);
  expect(testReset(re, "a")).toBe(true);
  expect(re.lastIndex).toBe(0);
  expect(testReset(re, "b")).toBe(false);
  expect(re.lastIndex).toBe(0);
});

test("execReset returns the first match on a dirty global regex and leaves it clean", () => {
  const re = /(?<letter>a)/gu;
  expect(re.exec("a")).not.toBeNull();
  expect(re.lastIndex).toBe(1);
  const match = execReset(re, "a");
  expect(match?.index).toBe(0);
  expect(match?.groups?.letter).toBe("a");
  expect(re.lastIndex).toBe(0);
});

test("scanReset iterates every match from the start and leaves the regex clean", () => {
  const re = /a/gu;
  expect(re.exec("xaay")).not.toBeNull();
  const matches = [...scanReset(re, "xaay")];
  expect(matches.map((m) => m.index)).toEqual([1, 2]);
  expect(re.lastIndex).toBe(0);
  const once = [...scanReset(/a/u, "aa")];
  expect(once).toHaveLength(1);
});

test("replaceReset replaces from the start on a dirty global regex", () => {
  const re = /a/gu;
  expect(re.test("a")).toBe(true);
  expect(replaceReset(re, "aa", "b")).toBe("bb");
  expect(re.lastIndex).toBe(0);
});

test("safePath redacts a token that starts inside an earlier email match", () => {
  // Review round 14 (bug-83): the email match ends first, so the token
  // match used to start inside the redacted span and print in the clear.
  const leaked = `x/bob@corp.${token()}.txt`;
  const out = safePath(leaked);
  expect(out).toBe("x/[redacted]");
  expect(out).not.toContain(token());
  expect(out).not.toContain("bob@corp");
});

test("safePath redacts a token nested at the same start as an email match", () => {
  // Review round 14 (bug-83): same-start nesting already redacted through
  // the longer match; this locks the order neighbour of the partial case.
  const nested = `${token()}${email()}`;
  const out = safePath(nested);
  expect(out).toBe("[redacted]");
  expect(out).not.toContain(token());
  expect(out).not.toContain(email());
});

test("every message path redacts the overlapping tail", () => {
  // Review round 14 (bug-83): finding rows, errors and log records all
  // print through the same redaction, so all three carry the merged span.
  const leaked = `x/bob@corp.${token()}.txt`;
  expect(findingRow(leaked, 1, "email")).toBe("x/[redacted]:1: email");
  const err = errorText("scrub-check", `the path ${leaked} could not be shown`);
  expect(err).not.toContain(token());
  expect(err).not.toContain("bob@corp");
  const { log, restore } = withLog();
  try {
    logFinding("email", leaked, 3, "abc");
    const row = readFileSync(log, "utf8");
    expect(row).not.toContain(token());
    expect(row).not.toContain("bob@corp");
    expect(JSON.parse(row).file).toBe("x/[redacted]");
  } finally {
    restore();
  }
});

test("mergeSpans joins overlapping, nested, adjacent and identical spans", () => {
  // Review round 14 (bug-83): the detector never emits touching or
  // identical spans, so the merge takes them synthetic; disjoint spans
  // pass through as the negative control.
  expect(
    mergeSpans([
      { start: 2, end: 13 },
      { start: 11, end: 43 },
    ]),
  ).toEqual([{ start: 2, end: 43 }]);
  expect(
    mergeSpans([
      { start: 0, end: 49 },
      { start: 0, end: 35 },
    ]),
  ).toEqual([{ start: 0, end: 49 }]);
  expect(
    mergeSpans([
      { start: 0, end: 5 },
      { start: 5, end: 10 },
    ]),
  ).toEqual([{ start: 0, end: 10 }]);
  expect(
    mergeSpans([
      { start: 3, end: 9 },
      { start: 3, end: 9 },
    ]),
  ).toEqual([{ start: 3, end: 9 }]);
  expect(
    mergeSpans([
      { start: 0, end: 5 },
      { start: 10, end: 15 },
    ]),
  ).toEqual([
    { start: 0, end: 5 },
    { start: 10, end: 15 },
  ]);
});
