// Tests beside scripts/run-clash.ts: the AC3 self-test. Each case runs the script the way
// Stage B does — `bun scripts/run-clash.ts <repo> <ticket-id>` — against a throwaway git
// repository, so a clean pass and every refusal are shown through the identical command.

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, symlinkSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  collectClashes,
  formatFree,
  formatReport,
  isUsableTicketId,
  isWbBranch,
  isTicketBranch,
  parseBranchNames,
  runDirPath,
  stripGitLocationEnv,
  GIT_LOCATION_ENV,
  ADVICE,
} from "./run-clash";

const script = join(import.meta.dir, "run-clash.ts");

function git(repo: string, ...args: string[]): string {
  const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  }
  return r.stdout;
}

function freshRepo(root: string, name: string): string {
  const repo = join(root, name);
  mkdirSync(repo, { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "332054101+brindlewick@users.noreply.github.com");
  git(repo, "config", "user.name", "brindlewick");
  writeFileSync(join(repo, "README"), "x\n");
  git(repo, "add", "README");
  git(repo, "commit", "-q", "-m", "init");
  return repo;
}

function plantRunDir(repo: string, ticketId: string): string {
  const dir = runDirPath(repo, ticketId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "manifest.json"), "{}\n");
  return dir;
}

function plantBranch(repo: string, name: string): void {
  git(repo, "branch", name);
}

function runClash(repo: string, ticketId: string, extraEnv?: Record<string, string>) {
  const r = spawnSync("bun", [script, repo, ticketId], {
    encoding: "utf8",
    env: { ...process.env, ...extraEnv },
  });
  return {
    code: r.status ?? -1,
    out: `${r.stdout ?? ""}${r.stderr ?? ""}`,
  };
}

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "run-clash-"));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("pure core", () => {
  test("a ticket id that is empty, holds a slash, or is . or .. is unusable", () => {
    expect(isUsableTicketId("")).toBe(false);
    expect(isUsableTicketId("a/b")).toBe(false);
    expect(isUsableTicketId("../x")).toBe(false);
    expect(isUsableTicketId(".")).toBe(false);
    expect(isUsableTicketId("..")).toBe(false);
    expect(isUsableTicketId("75")).toBe(true);
    expect(isUsableTicketId("T-1")).toBe(true);
  });

  test("the run directory path is absolute, under the repo's run root", () => {
    expect(runDirPath("/r", "7")).toBe(resolve("/r/.postmaster/runs/7"));
    expect(runDirPath("r", "7")).toBe(resolve("r/.postmaster/runs/7"));
  });

  test("the ticket branch matches only the exact id", () => {
    expect(isTicketBranch("7", "7")).toBe(true);
    expect(isTicketBranch("7", "70")).toBe(false);
    expect(isTicketBranch("7", "wb/7-lane")).toBe(false);
  });

  test("a wb branch matches only wb/<id>-, so 7 does not take 70", () => {
    expect(isWbBranch("7", "wb/7-lane")).toBe(true);
    expect(isWbBranch("7", "wb/7-")).toBe(true);
    expect(isWbBranch("7", "wb/7")).toBe(false);
    expect(isWbBranch("7", "wb/70-lane")).toBe(false);
    expect(isWbBranch("75", "wb/75-mimo")).toBe(true);
  });

  test("parseBranchNames strips refs/heads/ and skips anything else", () => {
    expect(parseBranchNames("refs/heads/75\nrefs/heads/wb/75-a\n")).toEqual([
      "75",
      "wb/75-a",
    ]);
    expect(parseBranchNames("refs/heads/main\n\nrefs/tags/75\n")).toEqual(["main"]);
    expect(parseBranchNames("")).toEqual([]);
  });

  test("stripGitLocationEnv drops git's location variables and keeps the rest", () => {
    expect(stripGitLocationEnv({ GIT_DIR: "/x", PATH: "/bin", EMPTY: undefined })).toEqual({
      PATH: "/bin",
    });
    const all: Record<string, string | undefined> = { KEEP: "1" };
    for (const name of GIT_LOCATION_ENV) all[name] = "/x";
    expect(stripGitLocationEnv(all)).toEqual({ KEEP: "1" });
  });

  test("collectClashes names the run directory and every matching branch, in order", () => {
    const clashes = collectClashes({
      ticketId: "7",
      runDirExists: true,
      runDirPath: "/r/.postmaster/runs/7",
      branches: ["main", "7", "wb/7-a", "70", "wb/70-a", "wb/7-b"],
    });
    expect(clashes).toEqual([
      { kind: "run-directory", path: "/r/.postmaster/runs/7" },
      { kind: "branch", name: "7" },
      { kind: "branch", name: "wb/7-a" },
      { kind: "branch", name: "wb/7-b" },
    ]);
  });

  test("a free id reports free; a clash report names each and offers the three choices", () => {
    expect(formatFree("75")).toBe("run-clash: free 75");
    expect(formatReport([{ kind: "branch", name: "75" }])).toEqual([
      "run-clash: branch already exists: 75",
      `run-clash: ${ADVICE}`,
    ]);
  });
});

describe("run-clash.ts through its own command line", () => {
  test("a clean repository passes and names the id as free", () => {
    const repo = freshRepo(root, "clean");
    const { code, out } = runClash(repo, "75");
    expect(code).toBe(0);
    expect(out).toContain("run-clash: free 75");
    expect(out).not.toContain("already exists");
  });

  test("an existing run directory is refused and named", () => {
    const repo = freshRepo(root, "run-dir");
    const dir = plantRunDir(repo, "75");
    const { code, out } = runClash(repo, "75");
    expect(code).toBe(2);
    expect(out).toContain(`run-clash: run directory already exists: ${dir}`);
    expect(out).toContain(ADVICE);
  });

  test("a run directory that is a plain file is refused the same way", () => {
    const repo = freshRepo(root, "run-file");
    const dir = runDirPath(repo, "75");
    mkdirSync(dirname(dir), { recursive: true });
    writeFileSync(dir, "not a directory\n");
    const { code, out } = runClash(repo, "75");
    expect(code).toBe(2);
    expect(out).toContain(`run-clash: run directory already exists: ${dir}`);
  });

  test("a symlink at the run path is refused, dangling or not", () => {
    const repo = freshRepo(root, "run-link");
    const dir = runDirPath(repo, "75");
    mkdirSync(dirname(dir), { recursive: true });
    symlinkSync(join(root, "nowhere"), dir);
    let { code, out } = runClash(repo, "75");
    expect(code).toBe(2);
    expect(out).toContain(`run-clash: run directory already exists: ${dir}`);
    rmSync(dir);
    const target = join(root, "run-link-target");
    mkdirSync(target, { recursive: true });
    symlinkSync(target, dir);
    ({ code, out } = runClash(repo, "75"));
    expect(code).toBe(2);
    expect(out).toContain(`run-clash: run directory already exists: ${dir}`);
  });

  test("a run path that cannot be checked is refused, never free", () => {
    const repo = freshRepo(root, "unreadable-runs");
    plantRunDir(repo, "75");
    const runs = dirname(runDirPath(repo, "75"));
    chmodSync(runs, 0);
    try {
      const { code, out } = runClash(repo, "75");
      expect(code).toBe(1);
      expect(out).toContain("run-clash: could not check run directory");
      expect(out).not.toContain("free 75");
    } finally {
      chmodSync(runs, 0o755);
    }
    const blocked = freshRepo(root, "runs-is-file");
    const blockedRuns = join(blocked, ".postmaster", "runs");
    mkdirSync(dirname(blockedRuns), { recursive: true });
    writeFileSync(blockedRuns, "not a directory\n");
    const { code, out } = runClash(blocked, "75");
    expect(code).toBe(1);
    expect(out).toContain("run-clash: could not check run directory");
  });

  test("an existing ticket branch is refused and named", () => {
    const repo = freshRepo(root, "ticket-branch");
    plantBranch(repo, "75");
    const { code, out } = runClash(repo, "75");
    expect(code).toBe(2);
    expect(out).toContain("run-clash: branch already exists: 75");
    expect(out).not.toContain("run directory");
    expect(out).toContain(ADVICE);
  });

  test("existing wb/<id>-* branches are refused and each is named", () => {
    const repo = freshRepo(root, "wb-branches");
    plantBranch(repo, "wb/75-mimo");
    plantBranch(repo, "wb/75-luna");
    const { code, out } = runClash(repo, "75");
    expect(code).toBe(2);
    expect(out).toContain("run-clash: branch already exists: wb/75-mimo");
    expect(out).toContain("run-clash: branch already exists: wb/75-luna");
  });

  test("several kinds of clash are refused together and all are named", () => {
    const repo = freshRepo(root, "many");
    const dir = plantRunDir(repo, "75");
    plantBranch(repo, "75");
    plantBranch(repo, "wb/75-mimo");
    const { code, out } = runClash(repo, "75");
    expect(code).toBe(2);
    expect(out).toContain(`run-clash: run directory already exists: ${dir}`);
    expect(out).toContain("run-clash: branch already exists: 75");
    expect(out).toContain("run-clash: branch already exists: wb/75-mimo");
  });

  test("colliding tags do not hide branches from the check", () => {
    const repo = freshRepo(root, "colliding-tags");
    plantBranch(repo, "75");
    git(repo, "tag", "75");
    plantBranch(repo, "wb/75-mimo");
    git(repo, "tag", "wb/75-mimo");
    const { code, out } = runClash(repo, "75");
    expect(code).toBe(2);
    expect(out).toContain("run-clash: branch already exists: 75");
    expect(out).toContain("run-clash: branch already exists: wb/75-mimo");
  });

  test("a GIT_DIR from the caller does not steer the check to another repository", () => {
    const repo = freshRepo(root, "git-dir");
    plantBranch(repo, "75");
    const other = freshRepo(root, "git-dir-other");
    const { code, out } = runClash(repo, "75", { GIT_DIR: join(other, ".git") });
    expect(code).toBe(2);
    expect(out).toContain("run-clash: branch already exists: 75");
  });

  test("near-misses do not clash: ticket 7 against 70 and wb/70-*", () => {
    const repo = freshRepo(root, "near-miss");
    plantRunDir(repo, "70");
    plantBranch(repo, "70");
    plantBranch(repo, "wb/70-lane");
    const { code, out } = runClash(repo, "7");
    expect(code).toBe(0);
    expect(out).toContain("run-clash: free 7");
    expect(out).not.toContain("already exists");
  });

  test("a run directory and branches for another ticket leave this id free", () => {
    const repo = freshRepo(root, "other-ticket");
    plantRunDir(repo, "75");
    plantBranch(repo, "75");
    plantBranch(repo, "wb/75-mimo");
    const { code, out } = runClash(repo, "76");
    expect(code).toBe(0);
    expect(out).toContain("run-clash: free 76");
  });

  test("a missing repo is refused, and so is a path that is not a git repository", () => {
    const missing = join(root, "nowhere");
    let { code, out } = runClash(missing, "75");
    expect(code).toBe(1);
    expect(out).toContain("not a git repository");
    const notRepo = join(root, "plain");
    mkdirSync(notRepo, { recursive: true });
    ({ code, out } = runClash(notRepo, "75"));
    expect(code).toBe(1);
    expect(out).toContain("not a git repository");
  });

  test("an empty or slash-bearing ticket id is refused as usage", () => {
    const repo = freshRepo(root, "bad-id");
    let { code, out } = runClash(repo, "");
    expect(code).toBe(1);
    expect(out).toContain("unusable ticket id");
    ({ code, out } = runClash(repo, "a/b"));
    expect(code).toBe(1);
    expect(out).toContain("unusable ticket id");
    expect(out).toContain("usage:");
  });

  test("dot ids are refused as usage, not read as run directories", () => {
    const repo = freshRepo(root, "dot-id");
    for (const id of [".", ".."]) {
      const { code, out } = runClash(repo, id);
      expect(code).toBe(1);
      expect(out).toContain("unusable ticket id");
      expect(out).not.toContain("already exists");
    }
  });

  test("an id git will not take as a branch is refused as usage, never free", () => {
    const repo = freshRepo(root, "git-invalid-id");
    const { code, out } = runClash(repo, "a..b");
    expect(code).toBe(1);
    expect(out).toContain("unusable ticket id");
    expect(out).not.toContain("already exists");
  });

  test("wrong arity is refused as usage", () => {
    const r = spawnSync("bun", [script], { encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(`${r.stdout}${r.stderr}`).toContain("usage:");
  });

  test("the check writes nothing into the repository", () => {
    const repo = freshRepo(root, "read-only");
    plantRunDir(repo, "75");
    plantBranch(repo, "wb/75-mimo");
    const before = git(repo, "status", "--porcelain");
    runClash(repo, "75");
    runClash(repo, "76");
    expect(git(repo, "status", "--porcelain")).toBe(before);
    expect(existsSync(runDirPath(repo, "76"))).toBe(false);
  });
});
