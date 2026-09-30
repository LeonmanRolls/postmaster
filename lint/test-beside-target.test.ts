import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OXLINTRC = join(import.meta.dir, "..", ".oxlintrc.json");

type Diagnostic = { message: string; code: string; filename: string };

const runOxlint = (dir: string): { code: number; diagnostics: Diagnostic[]; stdout: string; stderr: string } => {
  const p = Bun.spawnSync(
    ["bun", "x", "--bun", "oxlint", "-c", OXLINTRC, "--format=json", dir],
    { stdout: "pipe", stderr: "pipe", cwd: join(import.meta.dir, "..") },
  );
  const stdout = new TextDecoder().decode(p.stdout);
  const stderr = new TextDecoder().decode(p.stderr);
  let diagnostics: Diagnostic[] = [];
  try {
    diagnostics = JSON.parse(stdout).diagnostics ?? [];
  } catch {
    // leave empty; the control will fail on the count
  }
  return { code: p.exitCode ?? -1, diagnostics, stdout, stderr };
};

const caseDir = (): string => mkdtempSync(join(tmpdir(), "oxlint-case-"));

const write = (dir: string, path: string): void => {
  const full = join(dir, path);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, "export const x = 1;\n");
};

// Each control runs through Oxlint on Bun with the project's config, and is read back exactly.

describe("test-beside-target", () => {
  test("a test file beside its target passes with no problem", () => {
    const dir = caseDir();
    write(dir, "src/foo.ts");
    write(dir, "src/foo.test.ts");
    const r = runOxlint(dir);
    expect(r.diagnostics).toEqual([]);
    expect(r.code).toBe(0);
  });

  test("a test file with no target fails with one problem naming the file", () => {
    const dir = caseDir();
    write(dir, "src/foo.test.ts");
    const r = runOxlint(dir);
    expect(r.diagnostics.length).toBe(1);
    expect(r.diagnostics[0]?.code).toBe("postmaster(test-beside-target)");
    expect(r.diagnostics[0]?.message).toBe("foo.test.ts has no sibling target foo.ts");
    expect(r.diagnostics[0]?.filename.endsWith("foo.test.ts")).toBe(true);
    expect(r.code).toBe(1);
  });

  test("a test file inside a test/ folder fails with one problem naming the file", () => {
    const dir = caseDir();
    write(dir, "src/test/foo.ts");
    write(dir, "src/test/foo.test.ts");
    const r = runOxlint(dir);
    expect(r.diagnostics.length).toBe(1);
    expect(r.diagnostics[0]?.code).toBe("postmaster(test-beside-target)");
    expect(r.diagnostics[0]?.message).toContain("foo.test.ts");
    expect(r.diagnostics[0]?.message).toContain("test folder");
    expect(r.diagnostics[0]?.filename.endsWith("foo.test.ts")).toBe(true);
    expect(r.code).toBe(1);
  });
});
