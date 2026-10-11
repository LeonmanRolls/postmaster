import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import {
  descendantsOf,
  parseLstart,
  parseProcStat,
  parsePsSnapshot,
  snapshotDescendants,
  startedDuringTest,
  ticksToEpochMs,
} from "./test-children.ts";

describe("parsePsSnapshot", () => {
  // Recorded `ps -A -o pid=,ppid=,stat=,lstart=,args=` shape: blank-padded
  // ids, a stat word, ctime start words, and the command with its own
  // spacing intact.
  const SAMPLE = [
    "    1       0 Ss   Mon Oct 11 07:30:00 2026 /sbin/launchd",
    "  456       1 Ss   Mon Oct 11 07:30:01 2026 /bin/zsh -l",
    "  789     456 Z+   Mon Oct 11 07:30:02 2026 (sleep)",
    "  790     456 R+   Mon Oct 11 07:30:03 2026 sleep 30",
    "not a process line",
    "  12",
    "",
  ].join("\n");
  const NOW = new Date(2026, 9, 11, 7, 31, 0).getTime();

  test("reads pid, parent, state, start and the full command", () => {
    const entries = parsePsSnapshot(SAMPLE, NOW);
    expect(
      entries.map((entry) => ({
        pid: entry.pid,
        ppid: entry.ppid,
        stat: entry.stat,
        command: entry.command,
      })),
    ).toEqual([
      { pid: 1, ppid: 0, stat: "Ss", command: "/sbin/launchd" },
      { pid: 456, ppid: 1, stat: "Ss", command: "/bin/zsh -l" },
      { pid: 789, ppid: 456, stat: "Z+", command: "(sleep)" },
      { pid: 790, ppid: 456, stat: "R+", command: "sleep 30" },
    ]);
    expect(entries.map((entry) => entry.started)).toEqual([
      new Date(2026, 9, 11, 7, 30, 0).getTime(),
      new Date(2026, 9, 11, 7, 30, 1).getTime(),
      new Date(2026, 9, 11, 7, 30, 2).getTime(),
      new Date(2026, 9, 11, 7, 30, 3).getTime(),
    ]);
  });
});

describe("parseLstart", () => {
  test("a yearless start reads as its most recent past occurrence", () => {
    const now = new Date(2026, 0, 1, 0, 30, 0).getTime();
    expect(parseLstart(["Mon", "Dec", "31", "23:59:00"], now)).toBe(
      new Date(2025, 11, 31, 23, 59, 0).getTime(),
    );
    expect(parseLstart(["Thu", "Jan", "01", "00:15:00"], now)).toBe(
      new Date(2026, 0, 1, 0, 15, 0).getTime(),
    );
  });

  test("control: words that are neither shape read as nothing", () => {
    expect(parseLstart(["Mon", "Oct", "11"], Date.now())).toBeNull();
    expect(parseLstart(["Mon", "Foo", "11", "07:30:05", "2026"], Date.now())).toBeNull();
  });
});

describe("parseProcStat", () => {
  test("reads state, parent and start ticks past a name with spaces and parens", () => {
    expect(
      parseProcStat("12345 (my (weird) proc) R 12340 1 1 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 123456"),
    ).toEqual({ state: "R", ppid: 12340, startTicks: 123456 });
  });

  test("control: a line without the name's close paren reads as nothing", () => {
    expect(parseProcStat("12345 broken S 1")).toBeNull();
  });
});

describe("ticksToEpochMs", () => {
  test("boot plus ticks at the clock rate", () => {
    expect(ticksToEpochMs(100, 1_000_000, 100)).toBe(1_001_000);
  });
});

describe("startedDuringTest", () => {
  test("unreadable counts as the test's, and the slop covers clock granularity", () => {
    expect(startedDuringTest(null, 10_000)).toBe(true);
    expect(startedDuringTest(10_100, 10_000)).toBe(true);
    expect(startedDuringTest(9_000, 10_000)).toBe(true);
    expect(startedDuringTest(8_499, 10_000)).toBe(false);
  });
});

describe("descendantsOf", () => {
  test("collects children and grandchildren, never the root or outsiders", () => {
    const entries = [
      { pid: 100, ppid: 1, stat: "Ss", command: "worker", started: 1 },
      { pid: 101, ppid: 100, stat: "S", command: "child", started: 2 },
      { pid: 102, ppid: 101, stat: "S", command: "grandchild", started: 3 },
      { pid: 103, ppid: 1, stat: "S", command: "outsider", started: 4 },
    ];
    const found = descendantsOf(entries, 100);
    expect([...found.keys()].sort((a, b) => a - b)).toEqual([101, 102]);
  });
});

describe("snapshotDescendants", () => {
  test("sees a spawned child with a fresh start, and drops it once reaped", async () => {
    const before = Date.now();
    const child = spawn("sleep", ["30"]);
    try {
      const seen = await snapshotDescendants();
      const entry = child.pid === undefined ? undefined : seen.get(child.pid);
      expect(entry).toBeDefined();
      expect(entry?.command).toContain("sleep 30");
      expect(entry?.started).toBeGreaterThanOrEqual(before - 5000);
      expect(entry?.started).toBeLessThanOrEqual(Date.now() + 5000);
    } finally {
      child.kill("SIGKILL");
      await new Promise((resolve) => child.once("exit", resolve));
    }
    const gone = await snapshotDescendants();
    expect(child.pid === undefined || !gone.has(child.pid)).toBe(true);
  });
});
