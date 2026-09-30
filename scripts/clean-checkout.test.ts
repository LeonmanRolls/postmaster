import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const helper = join(import.meta.dir, "clean-checkout.ts");

function git(args: string[], cwd?: string): void {
  const r = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
}

function makeProject(root: string): string {
  const repo = join(root, "project");
  mkdirSync(repo);
  git(["init", "-q", "-b", "main", repo]);
  // The check a folder-walking project would use: fail whenever a copy exists under .worktrees/
  writeFileSync(
    join(repo, "check.sh"),
    [
      "#!/usr/bin/env bash",
      "if [ -d .worktrees ] && [ -n \"$(ls -A .worktrees 2>/dev/null)\" ]; then",
      '  echo "check: a copy exists under .worktrees/" >&2',
      "  exit 1",
      "fi",
      "exit 0",
      "",
    ].join("\n"),
  );
  writeFileSync(join(repo, "app.ts"), "export const x = 1;\n");
  git(["add", "check.sh", "app.ts"], repo);
  git(["commit", "-qm", "init"], repo);
  return repo;
}

function cleanCheckout(repo: string, branch: string, cmd: string[]): { status: number; out: string } {
  const r = spawnSync("bun", [helper, repo, branch, ...cmd], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { status: r.status === null ? 1 : r.status, out: (r.stdout || "") + (r.stderr || "") };
}

function leftoverCheckouts(): string[] {
  // clean-checkout-* under the system temp dir; only this test's leftovers matter.
  const base = tmpdir();
  return existsSync(base)
    ? readdirSync(base)
        .filter((n) => n.startsWith("clean-checkout-"))
        .map((n) => join(base, n))
    : [];
}

describe("clean-checkout", () => {
  test("runs the command on the branch's content, outside the project folder", () => {
    const root = mkdtempSync(join(tmpdir(), "clean-checkout-test-"));
    try {
      const repo = makeProject(root);
      const seen = cleanCheckout(repo, "main", ["bash", "-c", 'test -f app.ts && test -f check.sh && pwd']);
      expect(seen.status).toBe(0);
      expect(seen.out.trim().startsWith(root)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("AC3: a check that fails on a copy under .worktrees/ passes from the clean checkout, and fails in the main checkout when a copy is left there", () => {
    const root = mkdtempSync(join(tmpdir(), "clean-checkout-test-"));
    try {
      const repo = makeProject(root);
      // Positive side of the pair: the identical check, from a checkout that never held .worktrees/
      const clean = cleanCheckout(repo, "main", ["bash", "./check.sh"]);
      expect(clean.status).toBe(0);
      // Negative control: leave a copy where the main checkout's gate would read
      mkdirSync(join(repo, ".worktrees", "lane"), { recursive: true });
      writeFileSync(join(repo, ".worktrees", "lane", "copy.txt"), "copy\n");
      const dirty = spawnSync("bash", ["./check.sh"], {
        cwd: repo,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      expect(dirty.status).toBe(1);
      // The clean checkout still passes: it never saw the copy
      const again = cleanCheckout(repo, "main", ["bash", "./check.sh"]);
      expect(again.status).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("reports the command's exit unchanged", () => {
    const root = mkdtempSync(join(tmpdir(), "clean-checkout-test-"));
    try {
      const repo = makeProject(root);
      expect(cleanCheckout(repo, "main", ["bash", "-c", "exit 7"]).status).toBe(7);
      expect(cleanCheckout(repo, "main", ["bash", "-c", "exit 0"]).status).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("removes the checkout afterwards even when the command fails", () => {
    const root = mkdtempSync(join(tmpdir(), "clean-checkout-test-"));
    const before = leftoverCheckouts();
    try {
      const repo = makeProject(root);
      const failed = cleanCheckout(repo, "main", ["bash", "-c", "test -f app.ts && exit 3"]);
      expect(failed.status).toBe(3);
      expect(leftoverCheckouts()).toEqual(before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("refuses a repo that is not a repository, and a branch it does not have", () => {
    const root = mkdtempSync(join(tmpdir(), "clean-checkout-test-"));
    try {
      const repo = makeProject(root);
      expect(cleanCheckout(join(root, "nowhere"), "main", ["true"]).status).toBe(1);
      expect(cleanCheckout(repo, "no-such-branch", ["true"]).status).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
