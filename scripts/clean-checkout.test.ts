import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { cleanCheckout } from "./clean-checkout";

const helper = join(import.meta.dir, "clean-checkout.ts");
const roots: string[] = [];
const realGit = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();

const command = (program: string, args: string[], cwd?: string): void => {
  const result = spawnSync(program, args, { cwd, stdio: "ignore" });
  if (result.status !== 0)
    throw new Error(`${program} exited ${result.status ?? "without a status"}`);
};

const withRepo = async (run: (repo: string) => void | Promise<void>): Promise<void> => {
  const root = mkdtempSync(join(tmpdir(), "clean-checkout-test-"));
  roots.push(root);
  const repo = join(root, "repo");
  mkdirSync(repo);
  command("git", ["init", "-q", "-b", "main", repo]);
  command("git", ["-C", repo, "config", "user.name", "test"]);
  command("git", ["-C", repo, "config", "user.email", "test@example.invalid"]);
  // The check a folder-walking project would use: fail whenever a copy exists under .worktrees/
  writeFileSync(
    join(repo, "check.sh"),
    [
      "#!/usr/bin/env bash",
      'if [ -d .worktrees ] && [ -n "$(ls -A .worktrees 2>/dev/null)" ]; then',
      '  echo "check: a copy exists under .worktrees/" >&2',
      "  exit 1",
      "fi",
      "exit 0",
      "",
    ].join("\n"),
  );
  writeFileSync(join(repo, "app.ts"), "export const x = 1;\n");
  command("git", ["-C", repo, "add", "check.sh", "app.ts"]);
  command("git", ["-C", repo, "commit", "-q", "-m", "base"]);
  writeFileSync(join(repo, ".git", "info", "exclude"), ".worktrees/\n");
  await run(repo);
};

const inside = (parent: string, child: string): boolean => {
  const rel = relative(parent, child);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
};

const worktreeList = (repo: string): string =>
  spawnSync("git", ["-C", repo, "worktree", "list", "--porcelain"], { encoding: "utf8" }).stdout ??
  "";

const runHelper = (
  args: string[],
  env?: Record<string, string>,
): { status: number; out: string } => {
  const r = spawnSync("bun", [helper, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: env ? { ...process.env, ...env } : process.env,
  });
  return { status: r.status ?? 1, out: (r.stdout || "") + (r.stderr || "") };
};

// A bin dir holding a git that refuses each "<subcommand> <verb>" pair with its exit
// and passes everything else to the real git, for the failure-path tests.
const refusingGit = (refusals: [pair: string, exit: number][]): string => {
  const dir = mkdtempSync(join(tmpdir(), "clean-checkout-git-"));
  roots.push(dir);
  writeFileSync(
    join(dir, "git"),
    [
      "#!/usr/bin/env bash",
      'prev=""',
      'for a in "$@"; do',
      ...refusals.map(
        ([pair, exit]) =>
          `  if [ "$prev $a" = "${pair}" ]; then echo "wrapped git: refusing ${pair}" >&2; exit ${exit}; fi`,
      ),
      '  prev="$a"',
      "done",
      `exec "${realGit}" "$@"`,
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  return dir;
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("cleanCheckout", () => {
  test("AC3: the identical check fails in the project and passes from the clean checkout", async () => {
    await withRepo(async (repo) => {
      const marker = join(repo, ".worktrees", "lane");
      mkdirSync(marker, { recursive: true });
      writeFileSync(join(marker, "copy.txt"), "uncommitted lane copy\n");

      const negative = spawnSync("bash", ["./check.sh"], { cwd: repo, stdio: "ignore" });
      expect(negative.status).not.toBe(0);

      const positive = await cleanCheckout(repo, "main", "bash ./check.sh");
      expect(positive.exitCode).toBe(0);
      expect(inside(realpathSync(repo), positive.checkoutPath)).toBe(false);
      expect(existsSync(positive.checkoutPath)).toBe(false);
      expect(worktreeList(repo)).not.toContain(positive.checkoutPath);
    });
  });

  test("runs the command on the branch's content", async () => {
    await withRepo(async (repo) => {
      const result = await cleanCheckout(
        repo,
        "main",
        "test -f app.ts && test -f check.sh && test ! -e .worktrees",
      );
      expect(result.exitCode).toBe(0);
    });
  });

  test("removes the temporary checkout when the command fails and preserves its exit", async () => {
    await withRepo(async (repo) => {
      const result = await cleanCheckout(repo, "main", "exit 23");
      expect(result.exitCode).toBe(23);
      expect(existsSync(result.checkoutPath)).toBe(false);
      expect(worktreeList(repo)).not.toContain(result.checkoutPath);
    });
  });

  test("refuses a repo that is not a repository, and a branch it does not have", async () => {
    await withRepo(async (repo) => {
      const plain = mkdtempSync(join(tmpdir(), "clean-checkout-plain-"));
      roots.push(plain);
      const notRepo = runHelper([plain, "main", "true"]);
      expect(notRepo.status).toBe(1);
      expect(notRepo.out).toContain("not in a git repository");
      const branch = runHelper([repo, "no-such-branch", "true"]);
      expect(branch.status).toBe(1);
      expect(branch.out).toContain("has no branch or commit");
    });
  });

  test("a refusal leaves no scratch behind", async () => {
    await withRepo(async (repo) => {
      const refused = runHelper([repo, "no-such-branch", "true"]);
      expect(refused.status).toBe(1);
      expect(
        readdirSync(dirname(repo)).filter((n) => n.startsWith("postmaster-clean-checkout-")),
      ).toEqual([]);
    });
  });

  test("places the checkout beside the repo rather than under TMPDIR", async () => {
    await withRepo(async (repo) => {
      const priv = mkdtempSync(join(tmpdir(), "clean-checkout-tmpdir-"));
      roots.push(priv);
      const marker = join(priv, "where");
      const ran = runHelper([repo, "main", `pwd -P > ${marker}`], { TMPDIR: priv });
      expect(ran.status).toBe(0);
      const where = readFileSync(marker, "utf8").trim();
      expect(inside(realpathSync(dirname(repo)), where)).toBe(true);
      expect(inside(realpathSync(priv), where)).toBe(false);
    });
  });

  test("runs the command with the check contract's fail-fast flags", async () => {
    await withRepo(async (repo) => {
      expect((await cleanCheckout(repo, "main", "false; echo survived")).exitCode).not.toBe(0);
      expect((await cleanCheckout(repo, "main", "false | true")).exitCode).not.toBe(0);
    });
  });

  test("checks out the named ref's content", async () => {
    await withRepo(async (repo) => {
      writeFileSync(join(repo, "vers.txt"), "one\n");
      command("git", ["-C", repo, "add", "vers.txt"]);
      command("git", ["-C", repo, "commit", "-q", "-m", "one"]);
      const sha = spawnSync("git", ["-C", repo, "rev-parse", "HEAD"], {
        encoding: "utf8",
      }).stdout.trim();
      command("git", ["-C", repo, "tag", "v-one"]);
      writeFileSync(join(repo, "vers.txt"), "two\n");
      command("git", ["-C", repo, "commit", "-q", "-am", "two"]);
      expect((await cleanCheckout(repo, sha, 'test "$(cat vers.txt)" = one')).exitCode).toBe(0);
      expect((await cleanCheckout(repo, "v-one", 'test "$(cat vers.txt)" = one')).exitCode).toBe(0);
      expect((await cleanCheckout(repo, "main", 'test "$(cat vers.txt)" = one')).exitCode).not.toBe(
        0,
      );
    });
  });

  test("populates submodules in the checkout", async () => {
    await withRepo(async (repo) => {
      const lib = mkdtempSync(join(tmpdir(), "clean-checkout-lib-"));
      roots.push(lib);
      command("git", ["init", "-q", "-b", "main", lib]);
      command("git", ["-C", lib, "config", "user.name", "test"]);
      command("git", ["-C", lib, "config", "user.email", "test@example.invalid"]);
      writeFileSync(join(lib, "lib.txt"), "lib\n");
      command("git", ["-C", lib, "add", "lib.txt"]);
      command("git", ["-C", lib, "commit", "-q", "-m", "lib"]);
      command("git", [
        "-C",
        repo,
        "-c",
        "protocol.file.allow=always",
        "submodule",
        "add",
        "-q",
        lib,
        "vendor",
      ]);
      command("git", ["-C", repo, "add", ".gitmodules", "vendor"]);
      command("git", ["-C", repo, "commit", "-q", "-m", "vendor"]);
      expect((await cleanCheckout(repo, "main", "test -f vendor/lib.txt")).exitCode).toBe(0);
    });
  });

  test("a checkout that cannot be made exits 1 without running the command and leaves no scratch", async () => {
    await withRepo(async (repo) => {
      const root = dirname(repo);
      const bin = refusingGit([["worktree add", 128]]);
      const marker = join(root, "ran");
      const failed = runHelper([repo, "main", `touch ${marker}`], {
        PATH: `${bin}:${process.env.PATH ?? ""}`,
      });
      expect(failed.status).toBe(1);
      expect(existsSync(marker)).toBe(false);
      expect(readdirSync(root).filter((n) => n.startsWith("postmaster-clean-checkout-"))).toEqual(
        [],
      );
      expect(worktreeList(repo)).not.toContain("postmaster-clean-checkout-");
    });
  });

  test("a removal that needs its fallback still reports the passing command", async () => {
    await withRepo(async (repo) => {
      const root = dirname(repo);
      const bin = refusingGit([["worktree remove", 1]]);
      const removed = runHelper([repo, "main", "true"], {
        PATH: `${bin}:${process.env.PATH ?? ""}`,
      });
      expect(removed.status).toBe(0);
      expect(removed.out).toContain("could not remove the temporary git worktree");
      expect(worktreeList(repo)).not.toContain("postmaster-clean-checkout-");
      expect(readdirSync(root).filter((n) => n.startsWith("postmaster-clean-checkout-"))).toEqual(
        [],
      );
    });
  });

  test("cleanup residue left behind fails the run", async () => {
    await withRepo(async (repo) => {
      const bin = refusingGit([
        ["worktree remove", 1],
        ["worktree prune", 1],
      ]);
      const removed = runHelper([repo, "main", "true"], {
        PATH: `${bin}:${process.env.PATH ?? ""}`,
      });
      expect(removed.status).toBe(1);
      expect(removed.out).toContain("could not prune the worktree registration");
      expect(worktreeList(repo)).toContain("postmaster-clean-checkout-");
      command("git", ["-C", repo, "worktree", "prune"]);
      expect(worktreeList(repo)).not.toContain("postmaster-clean-checkout-");
    });
  });

  test("a polluted GIT_* environment still checks out the named repo", async () => {
    await withRepo(async (repo) => {
      const decoy = mkdtempSync(join(tmpdir(), "clean-checkout-decoy-"));
      roots.push(decoy);
      command("git", ["init", "-q", "-b", "main", decoy]);
      command("git", ["-C", decoy, "config", "user.name", "test"]);
      command("git", ["-C", decoy, "config", "user.email", "test@example.invalid"]);
      writeFileSync(join(decoy, "who.txt"), "decoy\n");
      command("git", ["-C", decoy, "add", "who.txt"]);
      command("git", ["-C", decoy, "commit", "-q", "-m", "decoy"]);
      writeFileSync(join(repo, "who.txt"), "real\n");
      command("git", ["-C", repo, "add", "who.txt"]);
      command("git", ["-C", repo, "commit", "-q", "-m", "who"]);
      const polluted = runHelper([repo, "main", 'test "$(cat who.txt)" = real'], {
        GIT_DIR: join(decoy, ".git"),
        GIT_WORK_TREE: decoy,
        GIT_COMMON_DIR: join(decoy, ".git"),
        GIT_INDEX_FILE: join(decoy, ".git", "index"),
        GIT_OBJECT_DIRECTORY: join(decoy, ".git", "objects"),
        GIT_ALTERNATE_OBJECT_DIRECTORIES: join(decoy, ".git", "objects"),
        GIT_NAMESPACE: "decoy",
      });
      expect(polluted.status).toBe(0);
      expect(worktreeList(decoy)).not.toContain("postmaster-clean-checkout-");
    });
  });

  test("runs each command in turn and stops at the first failure", async () => {
    await withRepo(async (repo) => {
      const dir = mkdtempSync(join(tmpdir(), "clean-checkout-marks-"));
      roots.push(dir);
      const first = join(dir, "first");
      const second = join(dir, "second");
      const failed = await cleanCheckout(
        repo,
        "main",
        `touch ${first} && exit 3`,
        `touch ${second}`,
      );
      expect(failed.exitCode).toBe(3);
      expect(existsSync(first)).toBe(true);
      expect(existsSync(second)).toBe(false);
      expect(existsSync(failed.checkoutPath)).toBe(false);
      const passed = await cleanCheckout(repo, "main", "true", `touch ${second}`);
      expect(passed.exitCode).toBe(0);
      expect(existsSync(second)).toBe(true);
    });
  });

  test("a command that finishes inside its bound passes as before", async () => {
    await withRepo(async (repo) => {
      const quick = runHelper([repo, "main", "true"], { CLEAN_CHECKOUT_TIMEOUT: "60" });
      expect(quick.status).toBe(0);
      expect(quick.out).not.toContain("timed out");
    });
  });

  test("a command that outlives its bound fails as a timeout and leaves no process behind", async () => {
    await withRepo(async (repo) => {
      const dir = mkdtempSync(join(tmpdir(), "clean-checkout-marks-"));
      roots.push(dir);
      const control = join(dir, "control");
      const survivor = join(dir, "survivor");
      // Positive control: the marker construct works when nothing is killed.
      const quick = runHelper([repo, "main", `(sleep 1 && touch ${control}) & sleep 2`], {
        CLEAN_CHECKOUT_TIMEOUT: "30",
      });
      expect(quick.status).toBe(0);
      expect(existsSync(control)).toBe(true);
      // The bound kills the whole group: the 5s marker never lands.
      const timed = runHelper([repo, "main", `(sleep 5 && touch ${survivor}) & sleep 30`], {
        CLEAN_CHECKOUT_TIMEOUT: "2",
      });
      expect(timed.status).toBe(124);
      expect(timed.out).toContain("timed out after 2s");
      expect(existsSync(survivor)).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, 5000));
      expect(existsSync(survivor)).toBe(false);
    });
  }, 30000);
});
