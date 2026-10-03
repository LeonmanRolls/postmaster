// Tests beside scripts/scrub-rewrite.ts.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const HERE = resolve(import.meta.dir);
const SCRIPT = join(HERE, "scrub-rewrite.sh");

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
  scratch = mkdtempSync(join(tmpdir(), "scrub-rewrite-"));
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

describe("scrub-rewrite", () => {
  test("a clean range is left alone, exit 0", () => {
    const r = repo("clean");
    writeFileSync(join(r, "notes.txt"), "ordinary words\n");
    git(["add", "notes.txt"], r);
    git(["commit", "-qm", "add notes"], r);
    const result = run(["HEAD~1", "HEAD"], r);
    expect(result.code).toBe(0);
  });

  test("a finding in a commit message is refused with the commit named", () => {
    const r = repo("msg");
    writeFileSync(join(r, "notes.txt"), "ordinary words\n");
    git(["add", "notes.txt"], r);
    git(
      ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "contact: " + SUSPECT],
      r,
    );
    const result = run(["HEAD~1", "HEAD"], r);
    expect(result.code).toBe(2);
    expect(result.err).toContain("needs hands");
  });
});
