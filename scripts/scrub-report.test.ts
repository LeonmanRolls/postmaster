import { afterEach, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupScratch, email, scratchDir } from "./scrub-test-kit.ts";
import {
  errorText,
  execReset,
  findingRow,
  isDraftPlace,
  isDraftRecord,
  logFinding,
  replaceReset,
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
    logFinding("email", "src/a.ts", 1, "");
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
  const text = errorText("scrub-rewrite", `a finding in (${email()} needs a manual reword`);
  expect(text).not.toContain(email());
  expect(text.startsWith("scrub-rewrite: ")).toBe(true);
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
