#!/usr/bin/env bun
// Run commands in a clean checkout of a branch, outside the project folder, so a project
// tool that walks the whole folder never reads the run's working copies under .worktrees/.
// Why: wiki/concepts/clean-checkout-gates.md.
//
//   bun scripts/clean-checkout.ts <repo> <branch> <command> [<command>...]
//
// Makes a detached git worktree of <branch> (a branch, tag, or commit) in a temporary
// directory outside the project folder, populates its submodules where the branch has any,
// runs each <command> there in turn through bash -e -o pipefail (the project check
// contract's flags), stopping at the first failure, removes the checkout afterwards even
// when a command fails, and reports the failing command's exit, or the last command's.
// The checkout holds only that branch's content: no .worktrees/, no uncommitted files. A
// git worktree, rather than an archive export, so gates that read git metadata keep
// working. Separate commands, rather than one shell string joined with &&, so a failed
// preparation can never be hidden by a later statement. Each command runs in a process
// group of its own with verify.sh's bound (1800s, or CLEAN_CHECKOUT_TIMEOUT for a test);
// the whole group is killed when the bound is reached, and a timeout fails with 124.
//
//   exit 0..255  the failing command's exit, or the last command's when all passed; a
//                cleanup that needed its fallback but left nothing behind is on stderr
//                and does not change the exit
//   exit 1       usage, no such repo or branch, a checkout that could not be made (no
//                command is run), or cleanup residue left behind after passing commands
//   exit 124     a command outlived its bound (its whole process group was killed)
import { spawn, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdtempSync, realpathSync, rmSync, rmdirSync } from "node:fs";
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
  // Beside the repository first, whose ancestors belong to the operator, and the shared
  // temp directory only as a fallback. Build tools read configuration from ancestor
  // directories, and the shared temp directory's ancestors are writable by every local
  // account, so a checkout there lets another account influence the gate. Either way the
  // parent must be outside the project itself.
  const candidates = [...new Set([dirname(repo), tmpdir()])];
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

// git -C does not override GIT_* from the environment, so a polluted caller env would point
// every git call here, and the gate's own git calls, at the wrong repository. Scrub the same
// list the shell scripts unset, for every spawn below.
const GIT_ENV_KEYS = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_COMMON_DIR",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_NAMESPACE",
];

const scrubbedEnv = (): Record<string, string | undefined> =>
  Object.fromEntries(Object.entries(process.env).filter(([key]) => !GIT_ENV_KEYS.includes(key)));

const gitOk = (repo: string, args: string[], env: Record<string, string | undefined>): boolean =>
  spawnSync("git", ["-C", repo, ...args], { stdio: "ignore", env }).status === 0;

// verify.sh's bound, not a new one: each command gets 1800s unless the caller overrides it
// for a test. A timeout kills the command's whole process group and fails with 124, the
// timeout(1) convention: a timeout is a failure, never a pass.
const DEFAULT_TIMEOUT_SECS = 1800;
const TIMEOUT_EXIT = 124;

const timeoutSecs = (): number => {
  const raw = process.env.CLEAN_CHECKOUT_TIMEOUT;
  if (raw === undefined) return DEFAULT_TIMEOUT_SECS;
  const n = Number(raw);
  if (Number.isInteger(n) && n > 0) return n;
  process.stderr.write(
    `clean-checkout: ignoring invalid CLEAN_CHECKOUT_TIMEOUT ${JSON.stringify(raw)}\n`,
  );
  return DEFAULT_TIMEOUT_SECS;
};

const runBounded = (
  command: string,
  checkoutPath: string,
  env: Record<string, string | undefined>,
  timeout: number,
): Promise<number> =>
  new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn("bash", ["-e", "-o", "pipefail", "-c", command], {
        cwd: checkoutPath,
        stdio: "inherit",
        env,
        detached: true,
      });
    } catch (error) {
      process.stderr.write(`clean-checkout: ${String(error)}\n`);
      resolve(1);
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      process.stderr.write(`clean-checkout: timed out after ${timeout}s\n`);
      finish(TIMEOUT_EXIT);
    }, timeout * 1000);
    const finish = (code: number): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // The whole group goes, left-behind children included, as verify.sh does.
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          // Already gone.
        }
      }
      resolve(code);
    };
    child.on("error", (error) => {
      process.stderr.write(`clean-checkout: ${error.message}\n`);
      finish(1);
    });
    child.on("close", (code) => finish(code ?? 1));
  });

export const cleanCheckout = async (
  repoArg: string,
  branch: string,
  ...commands: string[]
): Promise<CleanCheckoutResult> => {
  if (!repoArg || !branch || commands.length === 0 || commands.some((c) => !c))
    throw new Error("repo, branch and at least one command are required");

  const env = scrubbedEnv();
  const repo = realpathSync(repoArg);
  if (!gitOk(repo, ["rev-parse", "--show-toplevel"], env))
    throw new Error(`${repoArg} is not in a git repository`);
  if (!gitOk(repo, ["rev-parse", "--verify", "-q", `${branch}^{commit}`], env))
    throw new Error(`${repo} has no branch or commit ${branch}`);

  const scratch = temporaryRoot(repo);
  const checkoutPath = join(scratch, "checkout");
  const added = spawnSync(
    "git",
    ["-C", repo, "worktree", "add", "--quiet", "--detach", checkoutPath, branch],
    {
      stdio: "inherit",
      env,
    },
  );

  if (added.error) process.stderr.write(`clean-checkout: ${added.error.message}\n`);
  let exitCode = status(added);
  let registered = exitCode === 0;
  if (!registered) exitCode = 1;

  if (registered && existsSync(join(checkoutPath, ".gitmodules"))) {
    // Local-path submodule URLs need the file transport, which this git blocks by default;
    // no new trust: the checkout already runs the branch's own gate as this user.
    const sub = spawnSync(
      "git",
      ["-C", checkoutPath, "-c", "protocol.file.allow=always", "submodule", "update", "--init"],
      { stdio: "inherit", env },
    );
    if (status(sub) !== 0)
      process.stderr.write(
        "clean-checkout: could not populate submodules; running on the checkout as made\n",
      );
  }

  if (registered) {
    // Each command runs on its own, in turn, so a failed preparation can never be hidden
    // by a later statement the way one shell string with `&&` and `;` would hide it.
    const timeout = timeoutSecs();
    for (const command of commands) {
      exitCode = await runBounded(command, checkoutPath, env, timeout);
      if (exitCode !== 0) break;
    }
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
      env,
    });
    checkoutRemoved = removed.status === 0;
    if (!checkoutRemoved)
      process.stderr.write("clean-checkout: could not remove the temporary git worktree\n");
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

  if (registered && !checkoutRemoved && scratchType !== "other") {
    // The directory is gone (removed above, or never there); drop the stale registration too.
    // Prune only touches entries whose directory no longer exists, so live worktrees are
    // unaffected. A registration left behind is residue, and residue fails the run.
    const pruned = spawnSync("git", ["-C", repo, "worktree", "prune"], { stdio: "ignore", env });
    if (pruned.status !== 0) {
      process.stderr.write("clean-checkout: could not prune the worktree registration\n");
      if (exitCode === 0) exitCode = 1;
    }
  }

  return { exitCode, checkoutPath };
};

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length < 3) {
    process.stderr.write("usage: clean-checkout.ts <repo> <branch> <command> [<command>...]\n");
    process.exitCode = 1;
  } else {
    try {
      process.exitCode = (await cleanCheckout(args[0], args[1], ...args.slice(2))).exitCode;
    } catch (error) {
      process.stderr.write(`clean-checkout: ${String(error)}\n`);
      process.exitCode = 1;
    }
  }
}
