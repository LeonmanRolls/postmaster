#!/usr/bin/env bun
// Run a command in a clean checkout of a branch, outside the project folder, so a project
// tool that walks the whole folder never reads the run's working copies under .worktrees/.
// Why: wiki/concepts/clean-checkout-gates.md.
//
//   bun scripts/clean-checkout.ts <repo> <branch> <command> [args...]
//
// Makes a clean checkout of <repo> at <branch> in a temporary directory outside the project
// folder, runs <command> there, removes the checkout afterwards even when the command fails,
// and exits with the command's exit. The checkout holds only that branch's content: no
// .worktrees/, no uncommitted files, nothing else the main working tree carries.
//
//   exit 0..255  the command's own exit
//   exit 1       usage, no such repo or branch, or the checkout could not be made (the
//                command is not run)

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const usage = "usage: clean-checkout.ts <repo> <branch> <command> [args...]";

function text(cmd: string, args: string[], cwd?: string): { ok: boolean; out: string } {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return { ok: r.status === 0, out: (r.stdout || "") + (r.stderr || "") };
}

function unpackBranch(repo: string, branch: string, dest: string): boolean {
  const archive = spawnSync("git", ["-C", repo, "archive", "--format=tar", branch], {
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 256 * 1024 * 1024,
  });
  if (archive.status !== 0 || !archive.stdout) return false;
  const untar = spawnSync("tar", ["-x", "-C", dest], {
    input: archive.stdout,
    stdio: ["pipe", "ignore", "pipe"],
  });
  return untar.status === 0;
}

function main(argv: string[]): number {
  if (argv.length < 3) {
    console.error(usage);
    return 1;
  }
  const [repoArg, branch, ...cmd] = argv;
  const found = text("git", ["-C", repoArg, "rev-parse", "--show-toplevel"]);
  if (!found.ok) {
    console.error(`clean-checkout: ${repoArg} is not in a git repository`);
    return 1;
  }
  const repo = resolve(found.out.trim());
  const ref = text("git", ["-C", repo, "rev-parse", "--verify", "-q", `${branch}^{commit}`]);
  if (!ref.ok) {
    console.error(`clean-checkout: ${repo} has no branch or commit ${branch}`);
    return 1;
  }
  // Outside the project folder: a temporary directory of the machine, never under the repo.
  const dest = mkdtempSync(join(tmpdir(), "clean-checkout-"));
  try {
    if (!unpackBranch(repo, branch, dest)) {
      console.error(`clean-checkout: could not unpack ${branch} from ${repo}`);
      return 1;
    }
    const child = spawnSync(cmd[0], cmd.slice(1), { cwd: dest, stdio: "inherit" });
    return child.status === null ? 1 : child.status;
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
}

process.exit(main(process.argv.slice(2)));
