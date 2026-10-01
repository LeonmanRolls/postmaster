#!/usr/bin/env bun
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const repo = dirname(here);
const script = join(here, "summary-evidence.ts");
const casesRoot = join(repo, ".postmaster", "verify", "summary-evidence-tests");

type CaseFiles = { summary: string; worktree: string };

function makeCase(name: string, ticket: string, summary: string, artifacts: string[] = []): CaseFiles {
  const root = join(casesRoot, name);
  const worktree = join(root, "worktree");
  const verify = join(worktree, ".postmaster", "verify");
  mkdirSync(verify, { recursive: true });
  writeFileSync(join(verify, "ticket.md"), ticket, "utf8");
  for (const artifact of artifacts) {
    const path = join(worktree, artifact);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `evidence for ${artifact}\n`, "utf8");
  }
  const summaryPath = join(root, "WORKHORSE-SUMMARY.md");
  writeFileSync(summaryPath, summary, "utf8");
  return { summary: summaryPath, worktree };
}

function run(files: CaseFiles): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("bun", ["--no-env-file", "--config=/dev/null", script, files.summary, files.worktree], {
    cwd: repo,
    encoding: "utf8",
    timeout: 15_000,
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

const ticket = `# Ticket

## Acceptance criteria
1. First criterion works with realistic input.
2. Second criterion handles its edge case:
    1. This nested item is not a criterion.

## Direction
Keep the change small.
`;

beforeAll(() => {
  rmSync(casesRoot, { recursive: true, force: true });
  mkdirSync(casesRoot, { recursive: true });
});

afterAll(() => rmSync(casesRoot, { recursive: true, force: true }));

describe("summary evidence", () => {
  test("accepts existing evidence for every ticket criterion", () => {
    const files = makeCase(
      "complete",
      ticket,
      [
        "# Summary",
        "",
        "## Evidence",
        "1. `.postmaster/verify/evidence/ac1.md`",
        "2. `.postmaster/verify/evidence/ac2.md`",
        "",
      ].join("\n"),
      [
        ".postmaster/verify/evidence/ac1.md",
        ".postmaster/verify/evidence/ac2.md",
      ],
    );
    const result = run(files);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("evidence shape holds for 2 criteria");
  });

  test("names a criterion missing from the evidence section", () => {
    const files = makeCase(
      "missing-criterion",
      ticket,
      "## Evidence\n\n1. `.postmaster/verify/evidence/ac1.md`\n",
      [".postmaster/verify/evidence/ac1.md"],
    );
    const result = run(files);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("criterion AC2 is missing from the evidence section");
  });

  test("names evidence that does not exist", () => {
    const files = makeCase(
      "missing-file",
      ticket,
      "## Evidence\n\n1. `.postmaster/verify/evidence/missing.md`\n",
    );
    const result = run(files);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("criterion AC1 evidence does not exist");
  });

  test("accepts a not shown line with its reason", () => {
    const files = makeCase(
      "not-shown",
      ticket,
      [
        "## Evidence",
        "",
        "1. `.postmaster/verify/evidence/ac1.md`",
        "2. not shown: this harness has no browser backend",
        "",
      ].join("\n"),
      [".postmaster/verify/evidence/ac1.md"],
    );
    const result = run(files);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("evidence shape holds for 2 criteria (1 not shown)");
  });
});
