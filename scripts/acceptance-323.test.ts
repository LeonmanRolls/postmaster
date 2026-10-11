// Oracle for #323, committed before the change: one session makes and proves a verifier.
// Pins only what runs without a model: the prompt rendering, the section mandates, the C5
// overlap comparison in both directions, and the usage exits. C1 to C4 need a live model
// session, about eight minutes in the trial, so they stay hand-verified and out of this
// file: the session ran once during implementation, and its transcript and proof sit in
// the run record. Every case drives git or scripts/run as a subprocess.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./lib/proc.ts";
import {
  PSTACK_DIR,
  PSTACK_SHA256,
  PSTACK_SKILL,
  RUN,
  commitAll,
  firstSentence,
  initRepo,
  sharedRuns,
  writeRepoFile,
} from "./acceptance-323.ts";

function tempRepo(): { dir: string; repo: string } {
  const dir = mkdtempSync(join(tmpdir(), "acceptance-323-"));
  const repo = join(dir, "app");
  initRepo(repo);
  writeRepoFile(repo, "README.md", "# app\n");
  commitAll(repo, "first");
  return { dir, repo };
}

function promptOrThrow(repo: string, surface: string): string {
  const r = run(RUN, ["verifier", "prompt", repo, surface]);
  if (r.code !== 0) {
    throw new Error(`verifier prompt exited ${r.code}: ${r.err.trim() || r.out.trim()}`);
  }
  expect(r.code).toBe(0);
  return r.out;
}

describe("C5: the instructions copy no passage of pstack's skill", () => {
  test("no shared run of eight words", () => {
    const { dir, repo } = tempRepo();
    try {
      const out = promptOrThrow(repo, "cli");
      const skill = readFileSync(PSTACK_SKILL, "utf8");
      const shared = sharedRuns(out, skill, 8);
      if (shared.length > 0) {
        throw new Error(`shared runs:\n${shared.slice(0, 3).join("\n")}`);
      }
      expect(shared).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("one copied sentence fails the same comparison", () => {
    const { dir, repo } = tempRepo();
    try {
      const out = promptOrThrow(repo, "cli");
      const skill = readFileSync(PSTACK_SKILL, "utf8");
      const control = `${out}\n${firstSentence(skill, 8)}\n`;
      expect(sharedRuns(control, skill, 8).length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the fixture is the skill at 23e4138, with its source and licence named", () => {
    const bytes = readFileSync(PSTACK_SKILL);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(PSTACK_SHA256);
    const readme = readFileSync(join(PSTACK_DIR, "README.md"), "utf8");
    expect(readme).toContain("23e4138");
    expect(readme).toContain("MIT");
    const license = readFileSync(join(PSTACK_DIR, "LICENSE"), "utf8");
    expect(license.startsWith("MIT License")).toBe(true);
  });
});

describe("the prompt names its repo and surface and mandates the sections", () => {
  test("repo, surface, six sections, three to five pages, hand-over, pstack credit", () => {
    const { dir, repo } = tempRepo();
    try {
      const out = promptOrThrow(repo, "cli");
      expect(out).toContain(repo);
      // LOWER: lowered for an ASCII keyword match
      expect(out.toLowerCase()).toContain("command line");
      const lower = out.toLowerCase(); // LOWER: lowered for an ASCII keyword match
      for (const stem of ["launch", "health check", "drive", "evidence", "cleanup", "helper"]) {
        expect(lower).toContain(stem);
      }
      expect(out).toMatch(/three to five/iu);
      expect(out).toMatch(/hand-?over/iu);
      expect(out).toContain("pstack");
      expect(out).toContain("23e4138");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("all three surfaces render", () => {
    const { dir, repo } = tempRepo();
    try {
      for (const surface of ["cli", "web", "library"]) {
        const out = promptOrThrow(repo, surface);
        expect(out).toContain(repo);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("usage", () => {
  test("prompt with an unknown surface exits 2 and prints usage", () => {
    const { dir, repo } = tempRepo();
    try {
      const r = run(RUN, ["verifier", "prompt", repo, "telegraph"]);
      expect(r.code).toBe(2);
      expect(r.err).toContain("usage: run verifier");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("prompt without arguments exits 2 and prints usage", () => {
    const r = run(RUN, ["verifier", "prompt"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("usage: run verifier");
  });

  test("prompt on a path that is not a repo exits 2", () => {
    const dir = mkdtempSync(join(tmpdir(), "acceptance-323-"));
    try {
      const r = run(RUN, ["verifier", "prompt", join(dir, "nope"), "cli"]);
      expect(r.code).toBe(2);
      expect(r.err).toContain("usage: run verifier");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("make without --run exits 2 and prints usage", () => {
    const { dir, repo } = tempRepo();
    try {
      const r = run(RUN, ["verifier", "make", repo, "cli"]);
      expect(r.code).toBe(2);
      expect(r.err).toContain("usage: run verifier");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("make with an unknown surface exits 2", () => {
    const { dir, repo } = tempRepo();
    try {
      const r = run(RUN, ["verifier", "make", repo, "telegraph", "--run", dir]);
      expect(r.code).toBe(2);
      expect(r.err).toContain("usage: run verifier");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("bare verifier exits 2 and prints usage", () => {
    const r = run(RUN, ["verifier"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("usage: run verifier");
  });
});
