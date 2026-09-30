import { afterEach, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dir, "run-clash.ts");
const scratchDirs: string[] = [];

function git(repo: string, ...args: string[]): string {
  const result = Bun.spawnSync({
    cmd: ["git", "-C", repo, ...args],
    stdout: "pipe",
    stderr: "pipe",
  });
  const decoder = new TextDecoder();
  const stdout = decoder.decode(result.stdout);
  const stderr = decoder.decode(result.stderr);
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${stderr || stdout}`);
  }
  return stdout.trim();
}

function makeRepo(): string {
  const scratch = mkdtempSync(join(tmpdir(), "postmaster-run-clash-"));
  scratchDirs.push(scratch);
  const repo = join(scratch, "repo");
  const init = Bun.spawnSync({ cmd: ["git", "init", "--quiet", repo] });
  if (init.exitCode !== 0) throw new Error("could not initialize test repository");
  git(repo, "config", "user.name", "brindlewick");
  git(repo, "config", "user.email", "332054101+brindlewick@users.noreply.github.com");
  git(repo, "commit", "--allow-empty", "--quiet", "-m", "fixture");
  return repo;
}

function runCheck(repo: string, ticketId: string) {
  const result = Bun.spawnSync({
    cmd: [process.execPath, script, repo, ticketId],
    stdout: "pipe",
    stderr: "pipe",
  });
  const decoder = new TextDecoder();
  return {
    exitCode: result.exitCode,
    output: decoder.decode(result.stdout) + decoder.decode(result.stderr),
  };
}

afterEach(() => {
  for (const scratch of scratchDirs.splice(0)) {
    rmSync(scratch, { recursive: true, force: true });
  }
});

it("passes when the run directory and matching branches are free", () => {
  const repo = makeRepo();
  const result = runCheck(repo, "7");

  expect(result.exitCode).toBe(0);
  expect(result.output).toContain("ticket id 7 is free");
  expect(existsSync(join(repo, ".postmaster", "runs", "7"))).toBe(false);
});

it("names an existing run directory", () => {
  const repo = makeRepo();
  const runPath = join(repo, ".postmaster", "runs", "7");
  mkdirSync(runPath, { recursive: true });
  const result = runCheck(repo, "7");

  expect(result.exitCode).toBe(2);
  expect(result.output).toContain(`existing run directory ${runPath}`);
});

it("names a run path that exists as a file", () => {
  const repo = makeRepo();
  const runPath = join(repo, ".postmaster", "runs", "7");
  mkdirSync(join(repo, ".postmaster", "runs"), { recursive: true });
  writeFileSync(runPath, "existing");
  const result = runCheck(repo, "7");

  expect(result.exitCode).toBe(2);
  expect(result.output).toContain(`existing run directory ${runPath}`);
});

it("names an existing ticket branch", () => {
  const repo = makeRepo();
  git(repo, "branch", "7");
  const result = runCheck(repo, "7");

  expect(result.exitCode).toBe(2);
  expect(result.output).toContain("existing branch 7");
});

it("names every matching workhorse branch", () => {
  const repo = makeRepo();
  git(repo, "branch", "wb/7-luna");
  git(repo, "branch", "wb/7-review");
  const result = runCheck(repo, "7");

  expect(result.exitCode).toBe(2);
  expect(result.output).toContain("existing branch wb/7-luna");
  expect(result.output).toContain("existing branch wb/7-review");
});

it("names all clashes together", () => {
  const repo = makeRepo();
  const runPath = join(repo, ".postmaster", "runs", "7");
  mkdirSync(runPath, { recursive: true });
  git(repo, "branch", "7");
  git(repo, "branch", "wb/7-luna");
  const result = runCheck(repo, "7");

  expect(result.exitCode).toBe(2);
  expect(result.output).toContain(`existing run directory ${runPath}`);
  expect(result.output).toContain("existing branch 7");
  expect(result.output).toContain("existing branch wb/7-luna");
});

it("does not confuse a ticket id with a longer id", () => {
  const repo = makeRepo();
  git(repo, "branch", "70");
  git(repo, "branch", "wb/70-lane");
  const result = runCheck(repo, "7");

  expect(result.exitCode).toBe(0);
  expect(result.output).toContain("ticket id 7 is free");
});

it("refuses an id that cannot be one safe branch and path component", () => {
  const repo = makeRepo();
  const result = runCheck(repo, "../7");

  expect(result.exitCode).toBe(1);
  expect(result.output).toContain("usage: bun scripts/run-clash.ts");
});
