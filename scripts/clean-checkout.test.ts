import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { cleanCheckout } from "./clean-checkout";

const roots: string[] = [];

const command = (program: string, args: string[], cwd?: string): void => {
  const result = spawnSync(program, args, { cwd, stdio: "ignore" });
  if (result.status !== 0) throw new Error(`${program} exited ${result.status ?? "without a status"}`);
};

const withRepo = (run: (repo: string) => void): void => {
  const root = mkdtempSync(join(tmpdir(), "clean-checkout-test-"));
  roots.push(root);
  const repo = join(root, "repo");
  mkdirSync(repo);
  command("git", ["init", "-q", "-b", "main", repo]);
  command("git", ["-C", repo, "config", "user.name", "test"]);
  command("git", ["-C", repo, "config", "user.email", "test@example.invalid"]);
  writeFileSync(join(repo, "README.md"), "fixture\n");
  command("git", ["-C", repo, "add", "README.md"]);
  command("git", ["-C", repo, "commit", "-q", "-m", "base"]);
  writeFileSync(join(repo, ".git", "info", "exclude"), ".worktrees/\n");
  run(repo);
};

const inside = (parent: string, child: string): boolean => {
  const rel = relative(parent, child);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("cleanCheckout", () => {
  test("the same fail-on-copy check fails in the project and passes outside it", () => {
    withRepo((repo) => {
      const marker = join(repo, ".worktrees", "lane");
      mkdirSync(marker, { recursive: true });
      writeFileSync(join(marker, "README.md"), "uncommitted lane copy\n");

      const check = "test ! -e .worktrees/lane";
      const negative = spawnSync("bash", ["-c", check], { cwd: repo, stdio: "ignore" });
      expect(negative.status).not.toBe(0);

      const positive = cleanCheckout(repo, "main", check);
      expect(positive.exitCode).toBe(0);
      expect(inside(realpathSync(repo), positive.checkoutPath)).toBe(false);
      expect(existsSync(positive.checkoutPath)).toBe(false);
    });
  });

  test("removes the temporary checkout when the command fails and preserves its exit", () => {
    withRepo((repo) => {
      const result = cleanCheckout(repo, "main", "exit 23");
      expect(result.exitCode).toBe(23);
      expect(existsSync(result.checkoutPath)).toBe(false);
    });
  });
});
