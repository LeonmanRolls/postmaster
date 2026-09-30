#!/usr/bin/env bun
// Paired controls for usage.ts: for every harness the adapter knows, one made-up stream that
// reports usage and one that does not, read through the identical command. The with-usage
// stream must yield the figures it carries; the no-usage stream must yield no figure and must
// never yield zero. Fixtures hold made-up values only, in each harness's exact event shape.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "fixtures", "usage");
const script = join(here, "usage.ts");

const run = (...args: string[]): { status: number | null; stdout: string; stderr: string } => {
  const result = spawnSync("bun", [script, ...args], { encoding: "utf8", timeout: 15_000 });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
};

const readJson = (events: string, harness: string, session?: string): Record<string, unknown> => {
  const result = run("read", events, harness, ...(session ? [session] : []));
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout) as Record<string, unknown>;
};

const sessionFixture = (harness: string, kind: "with-usage" | "no-usage"): string | undefined => {
  if (harness !== "muse") return undefined;
  return join(fixtures, `muse-${kind}.session.json`);
};

const harnesses = ["codex", "grok", "agy", "claude", "pi", "muse", "mimo"];

const expected: Record<string, Record<string, number>> = {
  // Codex turns report cumulative session usage: the last turn wins. A reader that summed
  // turns would report 13990 in and 850 out here.
  codex: { input_tokens: 9870, output_tokens: 540 },
  grok: { input_tokens: 40, output_tokens: 6, cost_usd: 0.003 },
  // Antigravity results are cumulative session usage: the last result wins. A reader that
  // summed results would report 170 in and 19 out here.
  agy: { input_tokens: 120, output_tokens: 14 },
  // Claude's result is the run's own report and is taken whole; the assistant messages alone
  // would sum to 1100 in and 500 out.
  claude: { input_tokens: 1234, output_tokens: 567, cost_usd: 1.25 },
  pi: { input_tokens: 50, output_tokens: 7, cost_usd: 0.012 },
  // The session carries both model_completed and goal_usage_attribution for the same call,
  // plus an unreported attribution decoy: the total is counted once.
  muse: { input_tokens: 900, output_tokens: 110 },
  mimo: { input_tokens: 1000, output_tokens: 200, cost_usd: 0.25 },
};

describe("a stream that reports usage reads its figures", () => {
  for (const harness of harnesses) {
    test(harness, () => {
      const got = readJson(
        join(fixtures, `${harness}-with-usage.jsonl`), harness, sessionFixture(harness, "with-usage"));
      expect(got).toEqual(expected[harness]);
      for (const [key, value] of Object.entries(expected[harness] as Record<string, number>)) {
        if (key.endsWith("tokens")) expect(value).toBeGreaterThan(0);
      }
    });
  }
});

describe("a stream that does not report usage records nothing, never zero", () => {
  for (const harness of harnesses) {
    test(harness, () => {
      const got = readJson(
        join(fixtures, `${harness}-no-usage.jsonl`), harness, sessionFixture(harness, "no-usage"));
      expect(got).toEqual({});
      expect(got.input_tokens).toBeUndefined();
      expect(got.output_tokens).toBeUndefined();
      expect(got.cost_usd).toBeUndefined();
    });
  }
});

describe("reading rules", () => {
  test("a claude stream that ends without a result is summed from its assistant messages", () => {
    const tmp = mkdtempSync(join(tmpdir(), "usage-"));
    try {
      const events = join(tmp, "claude-cut.jsonl");
      writeFileSync(events, [
        JSON.stringify({ message: { role: "assistant", usage: { input_tokens: 60, output_tokens: 8 } }, type: "assistant" }),
        JSON.stringify({ message: { role: "assistant", usage: { input_tokens: 40, output_tokens: 2 } }, type: "assistant" }),
        "",
      ].join("\n"));
      expect(readJson(events, "claude")).toEqual({ input_tokens: 100, output_tokens: 10 });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("a launch with a reported zero cost keeps that zero", () => {
    const tmp = mkdtempSync(join(tmpdir(), "usage-"));
    try {
      const events = join(tmp, "mimo-free.jsonl");
      writeFileSync(events, [
        JSON.stringify({ part: { cost: 0, tokens: { input: 30, output: 4 } }, sessionID: "ses_madeup_9", type: "step_finish" }),
        "",
      ].join("\n"));
      expect(readJson(events, "mimo")).toEqual({ input_tokens: 30, output_tokens: 4, cost_usd: 0 });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("a resumed claude stream sums result usage and takes cost from the last result", () => {
    const tmp = mkdtempSync(join(tmpdir(), "usage-"));
    try {
      const events = join(tmp, "claude-resumed.jsonl");
      writeFileSync(events, [
        JSON.stringify({ type: "result", usage: { input_tokens: 60, output_tokens: 8 }, total_cost_usd: 0.1 }),
        JSON.stringify({ type: "result", usage: { input_tokens: 40, output_tokens: 2 }, total_cost_usd: 0.16 }),
        "",
      ].join("\n"));
      // Result usage is per-invocation (summed); total_cost_usd is cumulative (last wins).
      expect(readJson(events, "claude")).toEqual({ input_tokens: 100, output_tokens: 10, cost_usd: 0.16 });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("a codex stream takes the last terminal that carries figures", () => {
    const tmp = mkdtempSync(join(tmpdir(), "usage-"));
    try {
      const events = join(tmp, "codex-interrupted.jsonl");
      writeFileSync(events, [
        JSON.stringify({ type: "turn.completed", usage: { input_tokens: 100, output_tokens: 10 } }),
        JSON.stringify({ type: "turn.interrupted" }),
        "",
      ].join("\n"));
      expect(readJson(events, "codex")).toEqual({ input_tokens: 100, output_tokens: 10 });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("grok and agy readers skip a terminal without figures", () => {
    const tmp = mkdtempSync(join(tmpdir(), "usage-"));
    try {
      const grokEvents = join(tmp, "grok-empty-end.jsonl");
      writeFileSync(grokEvents, [
        JSON.stringify({ type: "end", usage: { input_tokens: 40, output_tokens: 6 }, total_cost_usd: 0.003 }),
        JSON.stringify({ type: "end" }),
        "",
      ].join("\n"));
      expect(readJson(grokEvents, "grok")).toEqual({ input_tokens: 40, output_tokens: 6, cost_usd: 0.003 });
      const agyEvents = join(tmp, "agy-empty-result.jsonl");
      writeFileSync(agyEvents, [
        JSON.stringify({ event: "result", result: { usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 14 } } }),
        JSON.stringify({ event: "result", result: {} }),
        "",
      ].join("\n"));
      expect(readJson(agyEvents, "agy")).toEqual({ input_tokens: 120, output_tokens: 14 });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("record and sum", () => {
  test("record writes the launch's figures, per role and lane", () => {
    const tmp = mkdtempSync(join(tmpdir(), "usage-"));
    try {
      mkdirSync(join(tmp, "logs"), { recursive: true });
      copyFileSync(join(fixtures, "claude-with-usage.jsonl"), join(tmp, "logs", "luna-events.jsonl"));
      const result = run("record", join(tmp, "logs", "luna-events.jsonl"), "claude", "luna", tmp,
        "--role", "workhorse", "--lane", "luna");
      expect(result.status).toBe(0);
      const record = JSON.parse(readFileSync(join(tmp, "logs", "luna-events-usage.json"), "utf8"));
      expect(record.input_tokens).toBe(1234);
      expect(record.output_tokens).toBe(567);
      expect(record.cost_usd).toBe(1.25);
      expect(record.role).toBe("workhorse");
      expect(record.lane).toBe("luna");
      expect(record.harness).toBe("claude");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("record omits a figure the harness did not report", () => {
    const tmp = mkdtempSync(join(tmpdir(), "usage-"));
    try {
      mkdirSync(join(tmp, "logs"), { recursive: true });
      copyFileSync(join(fixtures, "agy-no-usage.jsonl"), join(tmp, "logs", "other-events.jsonl"));
      const result = run("record", join(tmp, "logs", "other-events.jsonl"), "agy", "other", tmp,
        "--role", "workhorse", "--lane", "other");
      expect(result.status).toBe(0);
      const record = JSON.parse(readFileSync(join(tmp, "logs", "other-events-usage.json"), "utf8"));
      expect(record.input_tokens).toBeUndefined();
      expect(record.output_tokens).toBeUndefined();
      expect(record.cost_usd).toBeUndefined();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("re-reading a grown stream replaces its record with the whole-stream reading", () => {
    const tmp = mkdtempSync(join(tmpdir(), "usage-"));
    try {
      mkdirSync(join(tmp, "logs"), { recursive: true });
      const events = join(tmp, "logs", "luna-events.jsonl");
      copyFileSync(join(fixtures, "mimo-with-usage.jsonl"), events);
      const record = (...extra: string[]) =>
        run("record", events, "mimo", "luna", tmp, "--role", "workhorse", "--lane", "luna", ...extra);
      expect(record().status).toBe(0);
      writeFileSync(events, readFileSync(events, "utf8")
        + JSON.stringify({ part: { cost: 0.05, tokens: { input: 100, output: 10 } }, sessionID: "ses_madeup_1", type: "step_finish" }) + "\n");
      expect(record().status).toBe(0);
      const saved = JSON.parse(readFileSync(join(tmp, "logs", "luna-events-usage.json"), "utf8"));
      expect(saved.input_tokens).toBe(1100);
      expect(saved.output_tokens).toBe(210);
      expect(saved.cost_usd).toBeCloseTo(0.3, 10);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("record reads muse usage from the launch's own session export", () => {
    const tmp = mkdtempSync(join(tmpdir(), "usage-"));
    try {
      mkdirSync(join(tmp, "logs"), { recursive: true });
      mkdirSync(join(tmp, "sessions", "coachman"), { recursive: true });
      copyFileSync(join(fixtures, "muse-with-usage.jsonl"), join(tmp, "logs", "coachman-events.jsonl"));
      copyFileSync(join(fixtures, "muse-with-usage.session.json"),
        join(tmp, "sessions", "coachman", "madeup-session-1.json"));
      const result = run("record", join(tmp, "logs", "coachman-events.jsonl"), "muse", "coachman", tmp,
        "--role", "coachman", "--lane", "synthesis");
      expect(result.status).toBe(0);
      const record = JSON.parse(readFileSync(join(tmp, "logs", "coachman-events-usage.json"), "utf8"));
      expect(record.input_tokens).toBe(900);
      expect(record.output_tokens).toBe(110);
      expect(record.read_error).toBeUndefined();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("record without the muse session export saves an unreadable record, never zeros", () => {
    const tmp = mkdtempSync(join(tmpdir(), "usage-"));
    try {
      mkdirSync(join(tmp, "logs"), { recursive: true });
      copyFileSync(join(fixtures, "muse-with-usage.jsonl"), join(tmp, "logs", "coachman-events.jsonl"));
      const result = run("record", join(tmp, "logs", "coachman-events.jsonl"), "muse", "coachman", tmp,
        "--role", "coachman", "--lane", "synthesis");
      // Exit 0: the record IS saved; a nonzero exit would tell the launch site it was not recorded.
      expect(result.status).toBe(0);
      expect(result.stderr).toContain("usage record saved without figures");
      const record = JSON.parse(readFileSync(join(tmp, "logs", "coachman-events-usage.json"), "utf8"));
      expect(record.read_error).toBe("session-record-unavailable");
      expect(record.input_tokens).toBeUndefined();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("sum reports per role and lane, names a harness that reports nothing, never writes a missing figure as zero", () => {
    const tmp = mkdtempSync(join(tmpdir(), "usage-"));
    try {
      mkdirSync(join(tmp, "logs"), { recursive: true });
      copyFileSync(join(fixtures, "claude-with-usage.jsonl"), join(tmp, "logs", "luna-events.jsonl"));
      copyFileSync(join(fixtures, "agy-no-usage.jsonl"), join(tmp, "logs", "other-events.jsonl"));
      for (const [events, harness, name, role, lane] of [
        ["luna-events.jsonl", "claude", "luna", "workhorse", "luna"],
        ["other-events.jsonl", "agy", "other", "workhorse", "other"],
      ]) {
        expect(run("record", join(tmp, "logs", events), harness, name, tmp,
          "--role", role, "--lane", lane).status).toBe(0);
      }
      writeFileSync(join(tmp, "logs", "broken-usage.json"), "{not json");
      const result = run("sum", tmp);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("cost: workhorse luna (claude): 1234 in, 567 out, $1.25");
      expect(result.stdout).toContain("cost: workhorse other (agy): not reported in, not reported out, cost not reported");
      expect(result.stdout).toContain("cost: harness agy reports nothing");
      expect(result.stdout).toContain("cost: broken-usage.json could not be read");
      expect(result.stdout).not.toMatch(/0 in/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("sum marks partial launch coverage per figure", () => {
    const tmp = mkdtempSync(join(tmpdir(), "usage-"));
    try {
      mkdirSync(join(tmp, "logs"), { recursive: true });
      copyFileSync(join(fixtures, "mimo-with-usage.jsonl"), join(tmp, "logs", "a-events.jsonl"));
      copyFileSync(join(fixtures, "mimo-no-usage.jsonl"), join(tmp, "logs", "b-events.jsonl"));
      for (const events of ["a-events.jsonl", "b-events.jsonl"]) {
        expect(run("record", join(tmp, "logs", events), "mimo", "luna", tmp,
          "--role", "workhorse", "--lane", "luna").status).toBe(0);
      }
      const result = run("sum", tmp);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("1000 (1 of 2 launches) in");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("sum prints a reported cost as a decimal, never scientific and never $0", () => {
    const tmp = mkdtempSync(join(tmpdir(), "usage-"));
    try {
      mkdirSync(join(tmp, "logs"), { recursive: true });
      for (const [name, cost] of [["tiny", 1e-7], ["tinier", 4.9e-10], ["plain", 0.003]] as const) {
        const events = join(tmp, "logs", `${name}-events.jsonl`);
        writeFileSync(events, JSON.stringify({
          type: "end", usage: { input_tokens: 10, output_tokens: 2 }, total_cost_usd: cost,
        }) + "\n");
        expect(run("record", events, "grok", name, tmp,
          "--role", "workhorse", "--lane", name).status).toBe(0);
      }
      const result = run("sum", tmp);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("$0.0000001");
      expect(result.stdout).toContain("$0.0000000005");
      expect(result.stdout).toContain("$0.003");
      expect(result.stdout).not.toMatch(/\$[\d.]+e/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("sum without a logs directory names the logs directory", () => {
    const tmp = mkdtempSync(join(tmpdir(), "usage-"));
    try {
      const result = run("sum", tmp);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`no such logs directory: ${join(tmp, "logs")}`);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
