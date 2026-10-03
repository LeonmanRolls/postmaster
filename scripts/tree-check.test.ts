// Tests beside scripts/tree-check.ts.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const HERE = resolve(import.meta.dir);
const SCRIPT = join(HERE, "tree-check.sh");

function git(args: string[], cwd: string): string {
  return spawnSync("git", args, { cwd, encoding: "utf-8" }).stdout.trim();
}

function run(args: string[], cwd: string) {
  const r = spawnSync(SCRIPT, args, {
    cwd,
    encoding: "utf-8",
    env: { ...process.env, POSTMASTER_DETECTIONS_LOG: "" },
  });
  return { code: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

let scratch: string;

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), "tree-check-"));
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function repo(name: string): string {
  const r = join(scratch, name);
  mkdirSync(r, { recursive: true });
  git(["init", "-q", "--initial-branch=main"], r);
  git(["config", "user.name", "Fixture"], r);
  git(["config", "user.email", "fixture@example.invalid"], r);
  writeFileSync(join(r, "base.txt"), "base\n");
  git(["add", "base.txt"], r);
  git(["commit", "-qm", "base"], r);
  return r;
}

describe("tree-check", () => {
  test("a staged .postmaster/ file fails, named", () => {
    const r = repo("staged");
    mkdirSync(join(r, ".postmaster", "verify"), { recursive: true });
    writeFileSync(join(r, ".postmaster", "verify", "checks.json"), "run record\n");
    git(["add", ".postmaster/verify/checks.json"], r);
    const result = run(["main", "HEAD"], r);
    expect(result.code).toBe(1);
    expect(result.out).toContain(".postmaster/verify/checks.json");
  });

  test("a committed .postmaster/ file fails, named", () => {
    const r = repo("committed");
    mkdirSync(join(r, ".postmaster", "verify"), { recursive: true });
    writeFileSync(join(r, ".postmaster", "verify", "checks.json"), "run record\n");
    git(["add", ".postmaster/verify/checks.json"], r);
    git(["commit", "-qm", "add run record"], r);
    const result = run(["main", "HEAD"], r);
    expect(result.code).toBe(1);
    expect(result.out).toContain(".postmaster/verify/checks.json");
  });

  test("project.toml alone is clean", () => {
    const r = repo("project-toml");
    mkdirSync(join(r, ".postmaster"), { recursive: true });
    writeFileSync(join(r, ".postmaster", "project.toml"), "# settings\n");
    git(["add", "-f", ".postmaster/project.toml"], r);
    git(["commit", "-qm", "add project settings"], r);
    const result = run(["main", "HEAD"], r);
    expect(result.code).toBe(0);
    expect(result.out).toBe("");
  });

  test("a clean change passes", () => {
    const r = repo("clean");
    writeFileSync(join(r, "notes.txt"), "ordinary words\n");
    git(["add", "notes.txt"], r);
    git(["commit", "-qm", "add notes"], r);
    const result = run(["main", "HEAD"], r);
    expect(result.code).toBe(0);
    expect(result.out).toBe("");
  });
});
