// Oracle for #167, committed before the change: a report shows how long each
// user message waited to be seen and for its answer, and how many times the
// conversation was compacted, from Claude Code's own session record. Every
// case drives scripts/run responsiveness as a subprocess on made-up records.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  compaction,
  customTitle,
  idleTyped,
  PLANTED,
  queuedHuman,
  queuedTask,
  runResponsiveness,
  writeClaudeRecord,
  writeRecord,
} from "./acceptance-167.ts";

const withTemp = (body: (dir: string) => void): void => {
  const dir = mkdtempSync(join(tmpdir(), "acceptance-167-"));
  try {
    body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe("C1: message waits from a Claude Code record", () => {
  test("(a) a queued message reports its seen wait and its answer wait", () => {
    withTemp((dir) => {
      const record = writeRecord(dir, "session.jsonl", queuedHuman(0, 20, 720));
      const r = runResponsiveness([record]);
      expect(r.code).toBe(0);
      expect(r.out).toContain("Claude Code");
      expect(r.out).toContain("message 1: seen: 20 s; answer: 11 min 40 s");
    });
  });

  test("(b) an answer ending 90 s after delivery reports 90 s", () => {
    withTemp((dir) => {
      const record = writeRecord(dir, "session.jsonl", queuedHuman(1000, 1005, 1095));
      const r = runResponsiveness([record]);
      expect(r.code).toBe(0);
      expect(r.out).toContain("message 1: seen: 5 s; answer: 90 s");
    });
  });

  test("(c) a message typed while idle reports no seen wait and its turn length", () => {
    withTemp((dir) => {
      const record = writeRecord(dir, "session.jsonl", idleTyped(2000, 2045));
      const r = runResponsiveness([record]);
      expect(r.code).toBe(0);
      expect(r.out).toContain("message 1: seen: no wait; answer: 45 s");
    });
  });

  test("(d) no message text appears in the output, and task notifications are not messages", () => {
    withTemp((dir) => {
      const record = writeRecord(dir, "session.jsonl", [
        ...queuedTask(0, 10),
        ...queuedHuman(20, 40, 200),
        ...idleTyped(300, 360),
      ]);
      const r = runResponsiveness([record]);
      expect(r.code).toBe(0);
      expect(r.out).not.toContain(PLANTED);
      expect(r.err).not.toContain(PLANTED);
      expect(r.out).toContain("messages: 2");
      expect(r.out).toContain("message 1: seen: 20 s; answer: 2 min 40 s");
      expect(r.out).toContain("message 2: seen: no wait; answer: 60 s");
    });
  });

  test("(e) a harness the report does not read gives one unsupported line and a non-zero exit", () => {
    withTemp((dir) => {
      const record = writeRecord(dir, "session.jsonl", idleTyped(0, 30));
      const r = runResponsiveness([record, "--harness", "codex"]);
      expect(r.code).not.toBe(0);
      const combined = `${r.out}\n${r.err}`.trim();
      expect(combined.split("\n").filter((line) => line.trim() !== "")).toHaveLength(1);
      expect(combined.toLowerCase()).toContain("unsupported");
      expect(combined).toContain("codex");
    });
  });

  test("a record found by session id under the Claude config dir is reported", () => {
    withTemp((dir) => {
      const config = join(dir, "claude-config");
      const repo = join(dir, "app");
      writeClaudeRecord(config, repo, "sess-by-id", idleTyped(0, 30));
      const r = runResponsiveness(["sess-by-id"], { CLAUDE_CONFIG_DIR: config });
      expect(r.code).toBe(0);
      expect(r.out).toContain("message 1: seen: no wait; answer: 30 s");
    });
  });

  test("with no session named, the newest postmaster-titled record in the project folder is reported", () => {
    withTemp((dir) => {
      const config = join(dir, "claude-config");
      const repo = join(dir, "app");
      writeClaudeRecord(
        config,
        repo,
        "sess-old-postmaster",
        [customTitle("postmaster"), ...idleTyped(0, 30)],
        1000,
      );
      writeClaudeRecord(
        config,
        repo,
        "sess-new-clerk",
        [customTitle("booking clerk"), ...idleTyped(0, 99)],
        2000,
      );
      const r = runResponsiveness(["--repo", repo], { CLAUDE_CONFIG_DIR: config });
      expect(r.code).toBe(0);
      expect(r.out).toContain("message 1: seen: no wait; answer: 30 s");
      expect(r.out).not.toContain("99 s");
    });
  });
});

describe("C2: compactions are counted", () => {
  test("a record holding two compactions reports two", () => {
    withTemp((dir) => {
      const record = writeRecord(dir, "session.jsonl", [
        ...idleTyped(0, 30),
        compaction(40),
        compaction(50),
      ]);
      const r = runResponsiveness([record]);
      expect(r.code).toBe(0);
      expect(r.out).toContain("compactions: 2");
    });
  });

  test("a record holding no compaction reports zero", () => {
    withTemp((dir) => {
      const record = writeRecord(dir, "session.jsonl", idleTyped(0, 30));
      const r = runResponsiveness([record]);
      expect(r.code).toBe(0);
      expect(r.out).toContain("compactions: 0");
    });
  });
});
