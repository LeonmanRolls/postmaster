// Tests beside scripts/raw-promote.ts.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const HERE = resolve(import.meta.dir);
const SCRIPT = join(HERE, "raw-promote.sh");

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
  scratch = mkdtempSync(join(tmpdir(), "raw-promote-"));
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

describe("raw-promote", () => {
  test("a clean file is copied byte for byte", () => {
    const r = repo("clean");
    mkdirSync(join(r, "src"), { recursive: true });
    writeFileSync(join(r, "src", "notes.md"), "ordinary words\n");
    const result = run(["src/notes.md", "raw/trials/t1/notes.md"], r);
    expect(result.code).toBe(0);
    expect(readFileSync(join(r, "raw/trials/t1/notes.md"), "utf-8")).toBe("ordinary words\n");
  });

  test("a finding is replaced with a placeholder naming its rule", () => {
    const r = repo("scrub");
    mkdirSync(join(r, "src"), { recursive: true });
    writeFileSync(join(r, "src", "notes.md"), "contact: " + SUSPECT + " ok\n");
    const result = run(["src/notes.md", "raw/trials/t1/notes.md"], r);
    expect(result.code).toBe(0);
    const out = readFileSync(join(r, "raw/trials/t1/notes.md"), "utf-8");
    expect(out).toContain("<redacted:email>");
    expect(out).not.toContain(SUSPECT);
    expect(result.out).toContain("scrubbed");
    expect(result.out).not.toContain(SUSPECT);
  });

  test("the destination outside raw/ is refused", () => {
    const r = repo("outside");
    writeFileSync(join(r, "notes.md"), "ordinary words\n");
    const result = run(["notes.md", "not-raw/t1/notes.md"], r);
    expect(result.code).toBe(2);
  });

  test("an existing destination is refused", () => {
    const r = repo("exists");
    mkdirSync(join(r, "raw/trials/t1"), { recursive: true });
    writeFileSync(join(r, "raw/trials/t1/notes.md"), "already here\n");
    writeFileSync(join(r, "notes.md"), "ordinary words\n");
    const result = run(["notes.md", "raw/trials/t1/notes.md"], r);
    expect(result.code).toBe(2);
    expect(result.err).toContain("already exists");
  });
});
