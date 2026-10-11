// Oracle for #324, committed before the change: one session makes a verifier for
// each surface it is given, in a folder with an index. Pins only what runs
// without a model: the multi prompt rendering (one verifier per surface, the
// folder, the index, the upkeep line, no verifier for unlisted surfaces), the
// discovery-name mapping with its dedup, and the usage exits. C1 to C5 need a
// live model session, about twice #323's eight minutes in the trial, so they
// stay hand-verified and out of this file: the session runs during
// implementation, and its transcript and proof sit in the run record. Every
// case drives git or scripts/run as a subprocess.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./lib/proc.ts";
import { RUN, commitAll, initRepo, writeRepoFile } from "./acceptance-323.ts";
import { UPKEEP_LINE } from "./acceptance-324.ts";

function tempRepo(): { dir: string; repo: string } {
  const dir = mkdtempSync(join(tmpdir(), "acceptance-324-"));
  const repo = join(dir, "app");
  initRepo(repo);
  writeRepoFile(repo, "README.md", "# app\n");
  commitAll(repo, "first");
  return { dir, repo };
}

function promptOrThrow(repo: string, ...surfaces: string[]): string {
  const r = run(RUN, ["verifier", "prompt", repo, ...surfaces]);
  if (r.code !== 0) {
    throw new Error(`verifier prompt exited ${r.code}: ${r.err.trim() || r.out.trim()}`);
  }
  expect(r.code).toBe(0);
  return r.out;
}

describe("C1: several surfaces render one verifier per surface, one after another", () => {
  test("two discovery names render two verifiers with their folders", () => {
    const { dir, repo } = tempRepo();
    try {
      const out = promptOrThrow(repo, "cli-examples", "browser-suite");
      expect(out).toContain("Make 2 verifiers");
      expect(out).toContain("one after another");
      expect(out).toContain("verifier/cli/");
      expect(out).toContain("verifier/web/");
      expect(out).toContain("verifier/cli/README.md");
      expect(out).toContain("verifier/web/README.md");
      expect(out).toContain("command line");
      expect(out).toContain("web pages");
      expect(out).toContain("HANDOVER.md");
      expect(out).not.toContain("verify-app/");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the old names render several verifiers too", () => {
    const { dir, repo } = tempRepo();
    try {
      const out = promptOrThrow(repo, "cli", "web");
      expect(out).toContain("Make 2 verifiers");
      expect(out).toContain("verifier/cli/");
      expect(out).toContain("verifier/web/");
      expect(out).toContain(UPKEEP_LINE);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("three names render three verifiers", () => {
    const { dir, repo } = tempRepo();
    try {
      const out = promptOrThrow(repo, "cli-examples", "browser-suite", "library-tests");
      expect(out).toContain("Make 3 verifiers");
      expect(out).toContain("verifier/cli/");
      expect(out).toContain("verifier/web/");
      expect(out).toContain("verifier/library/");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("argument order never changes the rendering", () => {
    const { dir, repo } = tempRepo();
    try {
      expect(promptOrThrow(repo, "web", "cli")).toBe(promptOrThrow(repo, "cli", "web"));
      expect(promptOrThrow(repo, "library-tests", "cli-examples")).toBe(
        promptOrThrow(repo, "cli-examples", "library-tests"),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("C2 and C3: the verifiers share one visible folder with an index", () => {
  test("the folder and its index mandate", () => {
    const { dir, repo } = tempRepo();
    try {
      const out = promptOrThrow(repo, "cli-examples", "browser-suite");
      expect(out).toContain("verifier/README.md");
      expect(out).toContain("one bullet per verifier");
      expect(out).toContain("Every file of every verifier lives under verifier/");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("C4: each verifier carries the upkeep line", () => {
  test("the line verbatim, where an agent reads first", () => {
    const { dir, repo } = tempRepo();
    try {
      const out = promptOrThrow(repo, "cli-examples", "browser-suite");
      expect(out).toContain("verbatim");
      expect(out).toContain(UPKEEP_LINE);
      expect(out).toContain("where an agent reads first");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a single surface keeps the #323 rendering without the line", () => {
    const { dir, repo } = tempRepo();
    try {
      const out = promptOrThrow(repo, "cli");
      expect(out).not.toContain(UPKEEP_LINE);
      expect(out).not.toContain("verifier/cli");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("C5: a noticed but unlisted surface gets no verifier", () => {
  test("the unlisted surface is named with no verifier for it", () => {
    const { dir, repo } = tempRepo();
    try {
      const out = promptOrThrow(repo, "cli-examples", "browser-suite");
      expect(out).toContain("Make no verifier for the library interface.");
      expect(out).not.toContain("verifier/library/");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("nothing is unlisted when every surface is given", () => {
    const { dir, repo } = tempRepo();
    try {
      const out = promptOrThrow(repo, "cli-examples", "browser-suite", "library-tests");
      expect(out).not.toContain("Make no verifier for");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("discovery names map to the #323 surfaces and dedup", () => {
  test("one discovery name renders its #323 surface byte for byte", () => {
    const { dir, repo } = tempRepo();
    try {
      expect(promptOrThrow(repo, "cli-examples")).toBe(promptOrThrow(repo, "cli"));
      expect(promptOrThrow(repo, "browser-suite")).toBe(promptOrThrow(repo, "web"));
      expect(promptOrThrow(repo, "web-journey")).toBe(promptOrThrow(repo, "web"));
      expect(promptOrThrow(repo, "library-tests")).toBe(promptOrThrow(repo, "library"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("names of one surface dedup to its single rendering", () => {
    const { dir, repo } = tempRepo();
    try {
      expect(promptOrThrow(repo, "browser-suite", "web-journey")).toBe(promptOrThrow(repo, "web"));
      expect(promptOrThrow(repo, "cli", "cli")).toBe(promptOrThrow(repo, "cli"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("usage", () => {
  test("prompt with an unknown surface exits 2 and lists the discovery names", () => {
    const { dir, repo } = tempRepo();
    try {
      const r = run(RUN, ["verifier", "prompt", repo, "telegraph"]);
      expect(r.code).toBe(2);
      expect(r.err).toContain("usage: run verifier");
      expect(r.err).toContain("cli-examples");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("prompt with no surface exits 2 and prints usage", () => {
    const { dir, repo } = tempRepo();
    try {
      const r = run(RUN, ["verifier", "prompt", repo]);
      expect(r.code).toBe(2);
      expect(r.err).toContain("usage: run verifier");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("prompt with an unknown name among known names exits 2", () => {
    const { dir, repo } = tempRepo();
    try {
      const r = run(RUN, ["verifier", "prompt", repo, "cli", "telegraph"]);
      expect(r.code).toBe(2);
      expect(r.err).toContain("usage: run verifier");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("make with several surfaces but no --run exits 2 and prints usage", () => {
    const { dir, repo } = tempRepo();
    try {
      const r = run(RUN, ["verifier", "make", repo, "cli", "web"]);
      expect(r.code).toBe(2);
      expect(r.err).toContain("usage: run verifier");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("make with an unknown name among known names exits 2", () => {
    const { dir, repo } = tempRepo();
    try {
      const r = run(RUN, ["verifier", "make", repo, "cli-examples", "telegraph", "--run", dir]);
      expect(r.code).toBe(2);
      expect(r.err).toContain("usage: run verifier");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
