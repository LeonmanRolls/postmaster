import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, rmdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sumDispatch, sumUsageRecords, writeUsageRecord, type UsageRecord } from "./usage.ts";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "usage");
const script = join(dirname(fileURLToPath(import.meta.url)), "usage.ts");

const controls = {
  codex: { input_tokens: 12345, output_tokens: 678 },
  grok: { input_tokens: 23456, output_tokens: 789, cost_usd: 0.42 },
  agy: { input_tokens: 34567, output_tokens: 890 },
  claude: { input_tokens: 45678, output_tokens: 901, cost_usd: 0.64 },
  pi: { input_tokens: 56789, output_tokens: 12, cost_usd: 0.08 },
  muse: { input_tokens: 67890, output_tokens: 123 },
  mimo: { input_tokens: 78901, output_tokens: 234, cost_usd: 0 },
} as const;

const readThroughCommand = (harness: string, events: string, sessionRecord?: string) => {
  const result = Bun.spawnSync({
    cmd: [process.execPath, script, "read", harness, events, ...(sessionRecord ? [sessionRecord] : [])],
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = new TextDecoder().decode(result.stdout).trim();
  const stderr = new TextDecoder().decode(result.stderr).trim();
  expect(result.exitCode, stderr).toBe(0);
  return JSON.parse(stdout) as Record<string, number>;
};

describe("per-harness usage controls", () => {
  for (const [harness, expected] of Object.entries(controls)) {
    test(`${harness}: a recorded stream reports its figures`, () => {
      const events = join(fixtureDir, `${harness}-with.jsonl`);
      const sessionRecord = harness === "muse" ? join(fixtureDir, "muse-with.session.json") : undefined;
      expect(readThroughCommand(harness, events, sessionRecord)).toEqual(expected);
    });

    test(`${harness}: a recorded stream without usage omits every figure`, () => {
      const events = join(fixtureDir, `${harness}-none.jsonl`);
      const sessionRecord = harness === "muse" ? join(fixtureDir, "muse-none.session.json") : undefined;
      const result = readThroughCommand(harness, events, sessionRecord);
      expect(result).toEqual({});
      expect(Object.values(result)).not.toContain(0);
    });
  }
});

test("a launch with a reported zero cost keeps that zero", () => {
  const result = readThroughCommand("mimo", join(fixtureDir, "mimo-with.jsonl"));
  expect(result.cost_usd).toBe(0);
});

test("the sum keeps missing figures absent and marks partial launch coverage", () => {
  const records: UsageRecord[] = [
    {
      schema_version: 1,
      harness: "codex",
      role: "workhorse",
      lane: "luna",
      stream: "luna-a.jsonl",
      input_tokens: 321,
      output_tokens: 12,
    },
    {
      schema_version: 1,
      harness: "codex",
      role: "workhorse",
      lane: "luna",
      stream: "luna-b.jsonl",
    },
    {
      schema_version: 1,
      harness: "agy",
      role: "coachman",
      lane: "synthesis",
      stream: "coachman.jsonl",
    },
  ];
  const summary = sumUsageRecords(records);
  expect(summary).toContain("cost: workhorse luna (codex): 321 (1 of 2 launches) in, 12 (1 of 2 launches) out, cost not reported");
  expect(summary).toContain("cost: coachman synthesis (agy): not reported in, not reported out, cost not reported");
  expect(summary).toContain("cost: harness agy reports nothing");
  expect(summary).not.toContain("$0");
});

test("re-reading a grown stream replaces its record with the whole stream total", async () => {
  const temporary = await mkdtemp(join(fixtureDir, ".record-test-"));
  const dispatch = join(temporary, "dispatch");
  const logs = join(dispatch, "logs");
  const events = join(logs, "luna-events.jsonl");
  const sidecar = `${events}.usage.json`;
  try {
    await mkdir(logs, { recursive: true });
    await writeFile(events, '{"type":"turn.completed","usage":{"input_tokens":12,"output_tokens":5}}\n');
    await writeUsageRecord({ harness: "codex", role: "workhorse", lane: "luna", eventsPath: events });
    await writeFile(events, '{"type":"turn.completed","usage":{"input_tokens":12,"output_tokens":5}}\n{"type":"turn.completed","usage":{"input_tokens":3,"output_tokens":4}}\n');
    await writeUsageRecord({ harness: "codex", role: "workhorse", lane: "luna", eventsPath: events });
    const record = JSON.parse(await readFile(sidecar, "utf8")) as UsageRecord;
    expect(record.input_tokens).toBe(15);
    expect(record.output_tokens).toBe(9);
    expect((await readdir(logs)).filter((file) => file.endsWith(".usage.json"))).toEqual(["luna-events.jsonl.usage.json"]);
    expect(await sumDispatch(dispatch)).toContain("15 in, 9 out, cost not reported");
  } finally {
    await unlink(sidecar).catch(() => {});
    await unlink(events).catch(() => {});
    await rmdir(logs).catch(() => {});
    await rmdir(dispatch).catch(() => {});
    await rmdir(temporary).catch(() => {});
  }
});
