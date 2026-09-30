#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { lstatSync, mkdtempSync, realpathSync, rmSync, rmdirSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { tmpdir } from "node:os";

export type CleanCheckoutResult = {
  readonly exitCode: number;
  readonly checkoutPath: string;
};

const contains = (parent: string, child: string): boolean => {
  const rel = relative(parent, child);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
};

const temporaryRoot = (repo: string): string => {
  const candidates = [...new Set([tmpdir(), dirname(repo)])];
  for (const candidate of candidates) {
    try {
      const parent = realpathSync(candidate);
      if (!contains(repo, parent)) return mkdtempSync(join(parent, "postmaster-clean-checkout-"));
    } catch {
      // Try the next parent when this one is unavailable or inside the project.
    }
  }
  throw new Error(`could not create a temporary checkout outside ${repo}`);
};

const status = (result: ReturnType<typeof spawnSync>): number => result.status ?? 1;

export const cleanCheckout = (repoArg: string, branch: string, command: string): CleanCheckoutResult => {
  if (!repoArg || !branch || !command) throw new Error("repo, branch and command are required");

  const repo = realpathSync(repoArg);
  const scratch = temporaryRoot(repo);
  const checkoutPath = join(scratch, "checkout");
  const added = spawnSync("git", ["-C", repo, "worktree", "add", "--quiet", "--detach", checkoutPath, branch], {
    stdio: "inherit",
  });

  if (added.error) process.stderr.write(`clean-checkout: ${added.error.message}\n`);
  let exitCode = status(added);
  let registered = exitCode === 0;

  if (registered) {
    const run = spawnSync("bash", ["-c", command], { cwd: checkoutPath, stdio: "inherit" });
    if (run.error) process.stderr.write(`clean-checkout: ${run.error.message}\n`);
    exitCode = status(run);
  }

  const scratchType = (() => {
    try {
      return lstatSync(scratch).isDirectory() ? "directory" : "other";
    } catch {
      return "missing";
    }
  })();
  let checkoutRemoved = false;
  if (registered && scratchType !== "other") {
    const removed = spawnSync("git", ["-C", repo, "worktree", "remove", "--force", checkoutPath], {
      stdio: "ignore",
    });
    checkoutRemoved = removed.status === 0;
    if (!checkoutRemoved) process.stderr.write("clean-checkout: could not remove the temporary git worktree\n");
  }

  try {
    if (scratchType === "directory") {
      if (!checkoutRemoved) rmSync(checkoutPath, { recursive: true, force: true });
      rmdirSync(scratch);
    } else if (scratchType === "other") {
      throw new Error("the temporary parent is no longer a directory");
    }
  } catch (error) {
    process.stderr.write(`clean-checkout: could not remove ${scratch}: ${String(error)}\n`);
    if (exitCode === 0) exitCode = 1;
  }

  if (registered && !checkoutRemoved && exitCode === 0) exitCode = 1;

  return { exitCode, checkoutPath };
};

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length !== 3) {
    process.stderr.write("usage: clean-checkout.ts <repo> <branch> <command>\n");
    process.exitCode = 1;
  } else {
    try {
      process.exitCode = cleanCheckout(args[0], args[1], args[2]).exitCode;
    } catch (error) {
      process.stderr.write(`clean-checkout: ${String(error)}\n`);
      process.exitCode = 1;
    }
  }
}
