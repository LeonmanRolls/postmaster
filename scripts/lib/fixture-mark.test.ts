import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitAll, gitOrThrow, initRepo, writeRepoFile } from "../acceptance-323.ts";
import { isFixtureCopy } from "./fixture-mark.ts";

describe("isFixtureCopy", () => {
  test("an unmarked repo is not a fixture copy", () => {
    const dir = mkdtempSync(join(tmpdir(), "fixture-mark-"));
    try {
      const repo = join(dir, "app");
      initRepo(repo);
      writeRepoFile(repo, "README.md", "# app\n");
      commitAll(repo, "first");
      expect(isFixtureCopy(repo)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a marked repo is one", () => {
    const dir = mkdtempSync(join(tmpdir(), "fixture-mark-"));
    try {
      const repo = join(dir, "app");
      initRepo(repo);
      writeRepoFile(repo, "README.md", "# app\n");
      commitAll(repo, "first");
      gitOrThrow(repo, "config", "--local", "postmaster.fixture", "326");
      expect(isFixtureCopy(repo)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an empty path and a non-repo read as unmarked", () => {
    const dir = mkdtempSync(join(tmpdir(), "fixture-mark-"));
    try {
      expect(isFixtureCopy("")).toBe(false);
      expect(isFixtureCopy(dir)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a copy with only the committed marker is one, from its top", () => {
    const dir = mkdtempSync(join(tmpdir(), "fixture-mark-"));
    try {
      const repo = join(dir, "app");
      initRepo(repo);
      writeRepoFile(repo, ".postmaster/fixture", "postmaster fixture v1\n");
      commitAll(repo, "fixture marker");
      expect(isFixtureCopy(repo)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a copy with only the committed marker is one, from a subdirectory", () => {
    const dir = mkdtempSync(join(tmpdir(), "fixture-mark-"));
    try {
      const repo = join(dir, "app");
      initRepo(repo);
      writeRepoFile(repo, ".postmaster/fixture", "postmaster fixture v1\n");
      commitAll(repo, "fixture marker");
      const sub = join(repo, "sub");
      mkdirSync(sub, { recursive: true });
      expect(isFixtureCopy(sub)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
