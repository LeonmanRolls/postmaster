// Tests beside scripts/verify-merge.ts.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const HERE = resolve(import.meta.dir);
const SCRIPT = join(HERE, "verify-merge.sh");

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

const AT = "@";
const SUSPECT = "contact-413" + AT + "relay-413" + ".net";

let scratch: string;

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), "verify-merge-"));
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

function branch(r: string, name: string, line: string): void {
  git(["checkout", "-qb", name], r);
  writeFileSync(join(r, "base.txt"), line + "\n");
  git(["commit", "-qam", `${name} side`], r);
  git(["checkout", "-q", "main"], r);
}

describe("verify-merge", () => {
  test("a clean merge passes, silent", () => {
    const r = repo("clean");
    branch(r, "side", "side line");
    writeFileSync(join(r, "main.txt"), "main line\n");
    git(["add", "main.txt"], r);
    git(["commit", "-qm", "main side"], r);
    spawnSync("git", ["merge", "-q", "--no-ff", "-m", "Merge branch 'side'", "side"], { cwd: r });
    const result = run([r], r);
    expect(result.code).toBe(0);
    expect(result.out).toBe("");
  });

  test("a suspect in the resolution fails, named", () => {
    const r = repo("dirty-res");
    branch(r, "side", "side line");
    writeFileSync(join(r, "base.txt"), "main line\n");
    git(["commit", "-qam", "main side"], r);
    spawnSync("git", ["merge", "-q", "--no-ff", "side"], { cwd: r });
    writeFileSync(join(r, "base.txt"), "resolved by the relay at " + SUSPECT + "\n");
    git(["add", "base.txt"], r);
    git(["commit", "-qm", "Merge branch 'side'"], r);
    const result = run([r], r);
    expect(result.code).toBe(1);
    expect(result.out).toContain("base.txt:1: email");
    expect(result.out).not.toContain(SUSPECT);
    expect(result.err).not.toContain(SUSPECT);
  });

  test("a suspect in the merge message fails, named", () => {
    const r = repo("dirty-msg");
    branch(r, "side", "side line");
    writeFileSync(join(r, "main.txt"), "main line\n");
    git(["add", "main.txt"], r);
    git(["commit", "-qm", "main side"], r);
    spawnSync("git", ["merge", "-q", "--no-ff", "-m", "Merge branch 'side'\n\nReached at " + SUSPECT, "side"], { cwd: r });
    const result = run([r], r);
    expect(result.code).toBe(1);
    expect(result.out).toContain("(message):3: email");
    expect(result.out).not.toContain(SUSPECT);
  });

  test("a head that is not a merge is refused", () => {
    const r = repo("not-merge");
    const result = run([r], r);
    expect(result.code).toBe(2);
  });

  test("an unresolvable merge is refused", () => {
    const r = repo("bad-ref");
    const result = run([r, "no-such-commit"], r);
    expect(result.code).toBe(2);
  });

  test("a path that is not a repository is refused", () => {
    const result = run([scratch], scratch);
    expect(result.code).toBe(2);
  });
});
