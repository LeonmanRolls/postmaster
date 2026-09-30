// Controls for the one-spec shape of spec-decisions, beside the script: a one-spec
// package, a changes round, an approval, a stop, and a decisions file from before the
// one-spec change. The controls the script carries inside it still cover its refusals.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "spec-decisions.sh");

function withRun(fn: (d: string) => void): void {
  const tmp = mkdtempSync(join(tmpdir(), "spec-decisions-test-"));
  try {
    const d = join(tmp, "project", ".postmaster", "runs", "RUN-1");
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "manifest.json"), '{"lanes": {"alpha": {}, "beta": {}}}\n');
    fn(d);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function go(d: string, ...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("bash", [script, d, ...args], { encoding: "utf8", timeout: 15_000 });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function count(d: string): { status: number | null; approved: number; changes: number } {
  const r = go(d, "count");
  const lines = r.stdout.trim().split("\n");
  const approved = Number((lines[0] ?? "").replace("approved ", ""));
  const changes = Number((lines[1] ?? "").replace("changes ", ""));
  return { status: r.status, approved, changes };
}

describe("a one-spec package", () => {
  test("fresh then record writes one ## spec stanza", () => {
    withRun((d) => {
      expect(go(d, "fresh").status).toBe(0);
      expect(go(d, "record", "approved", "abc123").status).toBe(0);
      const text = readFileSync(join(d, "spec-decisions.md"), "utf8");
      expect(text).toContain("## spec");
      expect(text).toContain("decision: approved");
      expect(text).toContain("commit: abc123");
      expect(text.split("## ").length - 1).toBe(1);
    });
  });

  test("the log line targets the spec, not a lane", () => {
    withRun((d) => {
      go(d, "fresh");
      go(d, "record", "approved", "abc123");
      const last = readFileSync(join(d, "actions.jsonl"), "utf8").trim().split("\n").pop() ?? "";
      expect(last).toContain('"target":"spec"');
      expect(last).toContain('"detail":"approved abc123"');
    });
  });
});

describe("an approval", () => {
  test("count reads approved 1 and changes 0", () => {
    withRun((d) => {
      go(d, "fresh");
      go(d, "record", "approved", "abc123");
      const c = count(d);
      expect(c.status).toBe(0);
      expect(c.approved).toBe(1);
      expect(c.changes).toBe(0);
    });
  });
});

describe("a changes round", () => {
  test("count reads approved 0 and changes 1, and the words are logged", () => {
    withRun((d) => {
      go(d, "fresh");
      expect(go(d, "record", "changes", "abc123", "narrow", "the", "scope").status).toBe(0);
      const c = count(d);
      expect(c.status).toBe(0);
      expect(c.approved).toBe(0);
      expect(c.changes).toBe(1);
      const last = readFileSync(join(d, "actions.jsonl"), "utf8").trim().split("\n").pop() ?? "";
      expect(last).toContain('"detail":"changes abc123 narrow the scope"');
    });
  });

  test("a revised package after changes can be approved", () => {
    withRun((d) => {
      go(d, "fresh");
      go(d, "record", "changes", "abc123", "narrow", "the", "scope");
      go(d, "fresh");
      go(d, "record", "approved", "def456");
      const c = count(d);
      expect(c.approved).toBe(1);
      expect(c.changes).toBe(0);
    });
  });
});

describe("a stop", () => {
  test("count reads approved 0 and changes 0", () => {
    withRun((d) => {
      go(d, "fresh");
      expect(go(d, "record", "dropped", "abc123", "stop", "the", "run").status).toBe(0);
      const c = count(d);
      expect(c.status).toBe(0);
      expect(c.approved).toBe(0);
      expect(c.changes).toBe(0);
    });
  });
});

describe("a decisions file from before the change", () => {
  test("per-lane changes stanzas still count as changes 2", () => {
    withRun((d) => {
      writeFileSync(
        join(d, "spec-decisions.md"),
        "## alpha\ndecision: changes\ncommit: abc123\nwords: tighter\n\n## beta\ndecision: changes\ncommit: def456\nwords: smaller\n\n",
      );
      const c = count(d);
      expect(c.status).toBe(0);
      expect(c.approved).toBe(0);
      expect(c.changes).toBe(2);
    });
  });

  test("per-lane approvals still count, each lane once", () => {
    withRun((d) => {
      writeFileSync(join(d, "manifest.json"), '{"lanes": {"alpha": {"outcome": "approved"}, "beta": {}}}\n');
      writeFileSync(
        join(d, "spec-decisions.md"),
        "## alpha\ndecision: approved\ncommit: abc123\nwords: \n\n## beta\ndecision: approved\ncommit: def456\nwords: \n\n",
      );
      const c = count(d);
      expect(c.status).toBe(0);
      expect(c.approved).toBe(2);
      expect(c.changes).toBe(0);
    });
  });
});
