// Paired controls for the shared session-record finding: an exact claude
// name and a codex rollout name are found, a longer id that hides the wanted
// one inside it is not, and the newest postmaster-titled record wins.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findNativeRecord, findNewestPostmasterRecord } from "./session-record.ts";

const withTemp = (body: (dir: string) => void): void => {
  const dir = mkdtempSync(join(tmpdir(), "session-record-"));
  try {
    body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const write = (path: string, content: string, mtime?: number): void => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
  if (mtime !== undefined) {
    const when = new Date(mtime * 1000);
    utimesSync(path, when, when);
  }
};

describe("findNativeRecord", () => {
  test("a claude record named for the thread exactly is found", () => {
    withTemp((dir) => {
      const config = join(dir, "claude");
      const wanted = join(config, "projects", "-app", "thread-1.jsonl");
      write(wanted, "{}\n");
      write(join(config, "projects", "-app", "thread-10.jsonl"), "{}\n");
      expect(findNativeRecord("claude", "thread-1", { CLAUDE_CONFIG_DIR: config })).toBe(wanted);
    });
  });

  test("a codex rollout carrying the thread after its timestamp is found", () => {
    withTemp((dir) => {
      const home = join(dir, "codex-home");
      const wanted = join(home, "sessions", "rollout-2026-01-03T00-00-00-thread-9.jsonl");
      write(wanted, "{}\n");
      write(join(home, "sessions", "rollout-2026-01-03T00-00-00-thread-90.jsonl"), "{}\n");
      expect(findNativeRecord("codex", "thread-9", { CODEX_HOME: home })).toBe(wanted);
    });
  });

  test("a missing thread throws its durable-record error", () => {
    withTemp((dir) => {
      const config = join(dir, "claude");
      mkdirSync(join(config, "projects"), { recursive: true });
      expect(() => findNativeRecord("claude", "nope", { CLAUDE_CONFIG_DIR: config })).toThrow(
        "no durable claude record was found for thread nope",
      );
    });
  });
});

describe("findNewestPostmasterRecord", () => {
  test("the newest postmaster-titled record wins over a newer clerk record", () => {
    withTemp((dir) => {
      const config = join(dir, "claude");
      const repo = join(dir, "app");
      const folder = join(config, "projects", repo.replaceAll("/", "-"));
      write(
        join(folder, "old.jsonl"),
        `${JSON.stringify({ customTitle: "postmaster", type: "custom-title" })}\n`,
        1000,
      );
      write(
        join(folder, "new.jsonl"),
        `${JSON.stringify({ customTitle: "booking clerk", type: "custom-title" })}\n`,
        2000,
      );
      expect(findNewestPostmasterRecord(repo, { CLAUDE_CONFIG_DIR: config })).toBe(
        join(folder, "old.jsonl"),
      );
    });
  });
});
