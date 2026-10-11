// Oracle for #327, committed before the change: the clerk's brief lists the
// project's checks beside its verifiers, the runbook drives checks through the
// verifier, and discovery names the verifiers' index among the docs to read
// first. Every case plants a scratch app (a copy of fixtures/app), except the
// undeclared-gate case, which plants a bare repo, and drives git or
// scripts/run as a subprocess. The live clerk session behind C2 and C3
// needs a user to sign off, so it stays hand-verified like #324's model cases:
// what runs here pins the runbook sentence that session follows, and the run
// record carries a drive of the scratch verifier with its proof.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  cleanup,
  docsOf,
  freshBareScratch,
  freshScratch,
  localTicket,
  plantMultiVerifier,
  plantSingleVerifier,
  ROOT,
  RUN,
  runBrief,
  runChecksLines,
  runDiscover,
  runList,
  stubConfig,
  VERIFIER_RULE,
} from "./acceptance-327.ts";
import { run } from "./lib/proc.ts";

function briefOf(repo: string, id: string): string {
  return readFileSync(join(repo, ".postmaster", "clerk", `${id}.brief.md`), "utf8");
}

function briefOrThrow(repo: string, title: string, dir: string): { id: string; brief: string } {
  const id = localTicket(repo, title);
  const r = runBrief(repo, id, stubConfig(dir));
  if (r.code !== 0)
    throw new Error(`clerk brief exited ${r.code}: ${r.err.trim() || r.out.trim()}`);
  return { id, brief: briefOf(repo, id) };
}

describe("C1: the brief lists the checks beside the verifiers", () => {
  test("multi: the checks verbatim, the cli verifier with its surface and pages", () => {
    const { dir, repo } = freshScratch();
    try {
      plantMultiVerifier(repo);
      const { brief } = briefOrThrow(repo, "Use the verifier", dir);
      expect(brief).toContain("## Checks and verifiers");
      const checks = runChecksLines(repo);
      expect(checks.code).toBe(0);
      for (const line of checks.out.split("\n").filter((l) => l !== "")) {
        expect(brief).toContain(line);
      }
      expect(brief).toContain("verifier/README.md");
      expect(brief).toContain("verifier/cli");
      expect(brief).toContain("command line");
      expect(brief).toContain("verifier/cli/features/add.md");
      expect(brief).toContain("verifier/cli/features/done.md");
      expect(brief).toContain("verifier/cli/features/list.md");
    } finally {
      cleanup(dir);
    }
  });

  test("single: the verify-app verifier with its surface and pages", () => {
    const { dir, repo } = freshScratch();
    try {
      plantSingleVerifier(repo);
      const { brief } = briefOrThrow(repo, "Use the verifier", dir);
      expect(brief).toContain("## Checks and verifiers");
      expect(brief).toContain("verify-app/README.md");
      expect(brief).toContain("verify-app");
      expect(brief).toContain("command line");
      expect(brief).toContain("verify-app/features/add.md");
      expect(brief).toContain("verify-app/features/done.md");
      expect(brief).toContain("verify-app/features/list.md");
    } finally {
      cleanup(dir);
    }
  });

  test("without verifiers: the checks alone", () => {
    const { dir, repo } = freshScratch();
    try {
      const { brief } = briefOrThrow(repo, "No verifier yet", dir);
      expect(brief).toContain("## Checks and verifiers");
      const checks = runChecksLines(repo);
      expect(checks.code).toBe(0);
      for (const line of checks.out.split("\n").filter((l) => l !== "")) {
        expect(brief).toContain(line);
      }
      expect(brief).toContain("Verifiers: none.");
      expect(brief).not.toContain("verifier/");
      expect(brief).not.toContain("verify-app");
    } finally {
      cleanup(dir);
    }
  });

  test("without a declared gate: the brief shows the gate discovery finds", () => {
    const { dir, repo } = freshBareScratch();
    try {
      const { brief } = briefOrThrow(repo, "No declared gate", dir);
      expect(brief).toContain("## Checks and verifiers");
      expect(brief).toContain("gate\tdefault:gate\tcargo test");
    } finally {
      cleanup(dir);
    }
  });
});

describe("C2 and C3: the runbook drives checks through the verifier", () => {
  test("clerk.md carries the rule word for word", () => {
    const clerkMd = readFileSync(join(ROOT, "skills/clerk/clerk.md"), "utf8");
    // ASCII: widening to Unicode whitespace only folds more runs, never splits a match
    const flat = (s: string): string => s.replace(/\s+/gu, " ");
    expect(flat(clerkMd)).toContain(flat(VERIFIER_RULE));
  });
});

describe("C4: discovery names the verifiers' index among the docs", () => {
  test("multi: docs= names verifier/README.md beside the docs of today", () => {
    const { dir, repo } = freshScratch();
    try {
      plantMultiVerifier(repo);
      const r = runDiscover(repo);
      expect(r.code).toBe(0);
      const docs = docsOf(r.out);
      expect(docs).toContain("AGENTS.md");
      expect(docs).toContain("verifier/README.md");
    } finally {
      cleanup(dir);
    }
  });

  test("single: docs= names verify-app/README.md", () => {
    const { dir, repo } = freshScratch();
    try {
      plantSingleVerifier(repo);
      const r = runDiscover(repo);
      expect(r.code).toBe(0);
      expect(docsOf(r.out)).toContain("verify-app/README.md");
    } finally {
      cleanup(dir);
    }
  });

  test("without verifiers: docs= is as today", () => {
    const { dir, repo } = freshScratch();
    try {
      const r = runDiscover(repo);
      expect(r.code).toBe(0);
      expect(docsOf(r.out)).toBe("AGENTS.md CLAUDE.md README.md");
    } finally {
      cleanup(dir);
    }
  });
});

describe("run verifier list", () => {
  test("multi: the index, the cli verifier, its surface and pages", () => {
    const { dir, repo } = freshScratch();
    try {
      plantMultiVerifier(repo);
      const r = runList(repo);
      expect(r.code).toBe(0);
      expect(r.out).toContain("index: verifier/README.md");
      expect(r.out).toContain("verifier: verifier/cli");
      expect(r.out).toContain("surface: command line");
      expect(r.out).toContain("verifier/cli/features/add.md");
      expect(r.out).toContain("verifier/cli/features/done.md");
      expect(r.out).toContain("verifier/cli/features/list.md");
    } finally {
      cleanup(dir);
    }
  });

  test("single: the verify-app verifier with its surface and pages", () => {
    const { dir, repo } = freshScratch();
    try {
      plantSingleVerifier(repo);
      const r = runList(repo);
      expect(r.code).toBe(0);
      expect(r.out).toContain("index: verify-app/README.md");
      expect(r.out).toContain("verifier: verify-app");
      expect(r.out).toContain("surface: command line");
      expect(r.out).toContain("verify-app/features/add.md");
    } finally {
      cleanup(dir);
    }
  });

  test("without verifiers: one none line", () => {
    const { dir, repo } = freshScratch();
    try {
      const r = runList(repo);
      expect(r.code).toBe(0);
      expect(r.out.trim()).toBe("verifiers: none");
    } finally {
      cleanup(dir);
    }
  });

  test("usage: no repo exits 2 and prints usage", () => {
    const r = run(RUN, ["verifier", "list"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("usage: run verifier");
  });

  test("usage: a path that is not a repo exits 2 and prints usage", () => {
    const { dir } = freshScratch();
    try {
      const r = run(RUN, ["verifier", "list", join(dir, "nowhere")]);
      expect(r.code).toBe(2);
      expect(r.err).toContain("usage: run verifier");
    } finally {
      cleanup(dir);
    }
  });
});
