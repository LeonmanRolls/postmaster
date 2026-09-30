#!/usr/bin/env bun
// Paired controls for usage.ts: for every harness the adapter knows, one made-up stream that
// reports usage and one that does not, read through the identical command. The with-usage
// stream must yield the figures it carries; the no-usage stream must yield no figure and must
// never yield zero. Fixtures hold made-up values only, in each harness's exact event shape.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "fixtures", "usage");
const script = join(here, "usage.ts");

function run(...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync("bun", [script, ...args], { encoding: "utf8", timeout: 15_000 });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function readJson(events: string, harness: string, session?: string): Record<string, unknown> {
  const args = ["read", events, harness];
  if (session) args.push(session);
  const r = run(...args);
  expect(r.status).toBe(0);
  return JSON.parse(r.stdout);
}

const harnesses = ["codex", "grok", "agy", "claude", "pi", "muse", "mimo"];

const expected: Record<string, Record<string, number>> = {
  claude: { input_tokens: 1234, output_tokens: 567, cost_usd: 0.0060272 },
  codex: { input_tokens: 3, output_tokens: 4 },
  mimo: { input_tokens: 1000, output_tokens: 200, cost_usd: 0.25 },
  muse: { input_tokens: 900, output_tokens: 110 },
  pi: { input_tokens: 50, output_tokens: 7, cost_usd: 0.012 },
  agy: { input_tokens: 80, output_tokens: 12 },
  grok: { input_tokens: 40, output_tokens: 6 },
};

describe("a stream that reports usage reads its figures", () => {
  for (const h of harnesses) {
    test(h, () => {
      const events = join(fixtures, `${h}-with-usage.jsonl`);
      const session = join(fixtures, `${h}-with-usage.session.json`);
      const got = readJson(events, h, exists(session) ? session : undefined);
      expect(got).toEqual(expected[h]);
      for (const [k, v] of Object.entries(expected[h])) {
        if (k.endsWith("tokens")) expect(v).toBeGreaterThan(0);
      }
    });
  }
});

describe("a stream that does not report usage records nothing, never zero", () => {
  for (const h of harnesses) {
    test(h, () => {
      const events = join(fixtures, `${h}-no-usage.jsonl`);
      const session = join(fixtures, `${h}-no-usage.session.json`);
      const got = readJson(events, h, exists(session) ? session : undefined);
      expect(got).toEqual({});
      expect(got.input_tokens).toBeUndefined();
      expect(got.output_tokens).toBeUndefined();
      expect(got.cost_usd).toBeUndefined();
    });
  }
});

describe("record and sum", () => {
  test("record writes the launch's figures, per role and lane", () => {
    const tmp = mkdtempSync(join(tmpdir(), "usage-"));
    try {
      mkdirSync(join(tmp, "logs"), { recursive: true });
      copyFileSync(join(fixtures, "claude-with-usage.jsonl"), join(tmp, "logs", "luna-events.jsonl"));
      const r = run(
        "record",
        join(tmp, "logs", "luna-events.jsonl"),
        "claude",
        "luna",
        tmp,
        "--role",
        "workhorse",
        "--lane",
        "luna",
      );
      expect(r.status).toBe(0);
      const rec = JSON.parse(readFileSync(join(tmp, "logs", "luna-events-usage.json"), "utf8"));
      expect(rec.input_tokens).toBe(1234);
      expect(rec.output_tokens).toBe(567);
      expect(rec.cost_usd).toBe(0.0060272);
      expect(rec.role).toBe("workhorse");
      expect(rec.lane).toBe("luna");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("record omits a figure the harness did not report", () => {
    const tmp = mkdtempSync(join(tmpdir(), "usage-"));
    try {
      mkdirSync(join(tmp, "logs"), { recursive: true });
      copyFileSync(join(fixtures, "agy-no-usage.jsonl"), join(tmp, "logs", "other-events.jsonl"));
      const r = run(
        "record",
        join(tmp, "logs", "other-events.jsonl"),
        "agy",
        "other",
        tmp,
        "--role",
        "workhorse",
        "--lane",
        "other",
      );
      expect(r.status).toBe(0);
      const rec = JSON.parse(readFileSync(join(tmp, "logs", "other-events-usage.json"), "utf8"));
      expect(rec.input_tokens).toBeUndefined();
      expect(rec.output_tokens).toBeUndefined();
      expect(rec.cost_usd).toBeUndefined();
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
        const r = run(
          "record",
          join(tmp, "logs", events),
          harness,
          name,
          tmp,
          "--role",
          role,
          "--lane",
          lane,
        );
        expect(r.status).toBe(0);
      }
      const r = run("sum", tmp);
      expect(r.status).toBe(0);
      const out = r.stdout;
      expect(out).toContain("cost: workhorse luna (claude): 1234 in, 567 out");
      expect(out).toContain("cost: harness agy reports nothing");
      expect(out).toContain("in not reported");
      expect(out).not.toMatch(/cost: workhorse other .*0 in/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

function exists(path: string): boolean {
  try {
    readFileSync(path);
    return true;
  } catch {
    return false;
  }
}
