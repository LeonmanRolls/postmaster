// Tests beside scripts/run-times.ts, moved from its --self-test on #109: 10 controls.
// Each test re-runs times() over its section's planted log; times() only reads, so tests
// sharing a section are independent. The two negative tests plant their own log inline.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { times } from "./run-times";

let tmp: string;

function line(ts: string, action: string, target = ""): string {
  return JSON.stringify({
    ts: `2026-01-01T${ts}:00Z`,
    project: "p",
    run: "r",
    actor: "coachman",
    action,
    target,
    detail: "",
  });
}

function writeLog(lines: string[]): void {
  writeFileSync(join(tmp, "actions.jsonl"), `${lines.join("\n")}\n`);
}

function runTimes(): { rc: number; out: string } {
  const origLog = console.log;
  const origErr = console.error;
  let out = "";
  console.log = (s: string) => {
    out += `${s}\n`;
  };
  console.error = (s: string) => {
    out += `${s}\n`;
  };
  let rc: number;
  try {
    rc = times(tmp);
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
  return { rc, out };
}

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "run-times-"));
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("a full run, two legs, with a wait between them", () => {
  beforeAll(() => {
    writeLog([
      line("12:00", "dispatch", "r"),
      line("12:01", "handoff-accept", "1"),
      line("12:02", "stage", "bootstrapped"),
      line("12:05", "stage", "planning"),
      line("12:25", "stage", "workhorses-running"),
      line("12:35", "stage", "synthesis"),
      line("12:50", "stage", "checkpoint-1"),
      line("12:52", "handoff", "1"),
      line("12:55", "handoff-accept", "2"),
      line("12:56", "stage", "review"),
      line("13:10", "handoff", "2"),
      line("13:10", "stage", "done"),
    ]);
  });

  test("the dispatched stage runs from dispatch to bootstrapped", () => {
    const { rc, out } = runTimes();
    expect(rc).toBe(0);
    expect(out).toContain("dispatched                 2026-01-01 12:00:00   2m 00s     1m 00s");
  }, 10000);

  test("the planning stage times the review", () => {
    const { rc, out } = runTimes();
    expect(rc).toBe(0);
    expect(out).toContain("planning                   2026-01-01 12:05:00   20m 00s    0s");
  }, 10000);

  test("a stage inside one leg has no waiting", () => {
    const { rc, out } = runTimes();
    expect(rc).toBe(0);
    expect(out).toContain("workhorses-running         2026-01-01 12:25:00   10m 00s    0s");
  }, 10000);

  test("a stage across the leg boundary counts the gap", () => {
    const { rc, out } = runTimes();
    expect(rc).toBe(0);
    expect(out).toContain("checkpoint-1               2026-01-01 12:50:00   6m 00s     3m 00s");
  }, 10000);

  test("a terminal stage is a moment, not a span", () => {
    const { rc, out } = runTimes();
    expect(rc).toBe(0);
    expect(out).toContain("done                       2026-01-01 13:10:00   -          -");
  }, 10000);

  test("the total adds up", () => {
    const { rc, out } = runTimes();
    expect(rc).toBe(0);
    expect(out).toContain("total                                            1h 10m     4m 00s");
  }, 10000);
});

describe("a dispatch in the same second as the first stage", () => {
  beforeAll(() => {
    writeLog([
      line("12:00", "dispatch", "r"),
      line("12:00", "stage", "bootstrapped"),
      line("12:03", "stage", "done"),
    ]);
  });

  test("the dispatched row is still shown", () => {
    const { rc, out } = runTimes();
    expect(rc).toBe(0);
    expect(out).toContain("dispatched                 2026-01-01 12:00:00   0s");
  }, 10000);
});

describe("a run still in progress", () => {
  beforeAll(() => {
    writeLog([
      line("12:00", "dispatch", "r"),
      line("12:02", "stage", "bootstrapped"),
      line("12:09", "note", "x"),
    ]);
  });

  test("the last non-terminal stage is open, to the last action", () => {
    const { rc, out } = runTimes();
    expect(rc).toBe(0);
    expect(out).toContain("bootstrapped (open)        2026-01-01 12:02:00   7m 00s     -");
  }, 10000);
});

describe("negative controls", () => {
  test("a log with no stage lines says so, and times nothing", () => {
    writeLog([line("12:00", "dispatch", "r"), line("12:05", "note", "x")]);
    const { rc, out } = runTimes();
    expect(rc).toBe(3);
    expect(out).toContain("no stage changes logged");
  }, 10000);

  test("an unreadable log is refused", () => {
    writeFileSync(join(tmp, "actions.jsonl"), "not json\n");
    const { rc, out } = runTimes();
    expect(rc).toBe(1);
    expect(out).toContain("is not a log line");
  }, 10000);
});
