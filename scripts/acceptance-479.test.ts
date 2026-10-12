// Oracle for #479, committed before the change: the stale check marks local
// verifiers, an upkeep pass checks them, and a correcting pass writes its
// corrections into them in place, leaving the repository showing nothing new.
// Every case drives git or scripts/run as a subprocess. C6, a fixture run
// from this branch scoring clean, needs a dispatched run and stays out.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { commitAll, gitOrThrow, ROOT, writeRepoFile } from "./acceptance-323.ts";
import { makeEnv, summaryLine } from "./acceptance-344.ts";
import { expectCode } from "./acceptance-478.ts";
import {
  CLAIM_NAME,
  correctingOverlay,
  LOCAL,
  PAGE1,
  PAGE3,
  PAGES,
  REPORT_CHANGED,
  REPORT_CORRECTED,
  REPORT_UNDERRIVEN,
  RUN,
  runUpkeep,
  scratchLocalApp,
  VDIR,
  writeReport,
  writeStubLocalUpkeep,
} from "./acceptance-479.ts";
import { run } from "./lib/proc.ts";

describe("C1: the stale check marks a local verifier", () => {
  test("a changed depended file marks the local verifier", () => {
    const app = scratchLocalApp();
    try {
      writeRepoFile(app.repo, "src/cli.txt", "v2\n");
      commitAll(app.repo, "cli v2");
      const r = run(RUN, ["verifier", "stale", app.repo]);
      expectCode(r, 0);
      expect(r.out).toContain(`stale: ${VDIR}: src/cli.txt`);
    } finally {
      rmSync(app.dir, { recursive: true, force: true });
    }
  });

  test("the confirming commit compares clean", () => {
    const app = scratchLocalApp();
    try {
      writeRepoFile(app.repo, "src/cli.txt", "v2\n");
      commitAll(app.repo, "cli v2");
      const r = run(RUN, ["verifier", "stale", app.repo, "--at", app.first]);
      expectCode(r, 0);
      expect(r.out).toContain("stale: none");
    } finally {
      rmSync(app.dir, { recursive: true, force: true });
    }
  });

  test("an unknown confirmation commit reads unconfirmed", () => {
    const app = scratchLocalApp();
    try {
      const unknown = "0".repeat(40);
      writeRepoFile(
        app.repo,
        `${LOCAL}/README.md`,
        readFileSync(join(app.repo, LOCAL, "README.md"), "utf8").replace(app.first, unknown),
      );
      const r = run(RUN, ["verifier", "stale", app.repo]);
      expectCode(r, 0);
      expect(r.out).toContain(`stale: ${VDIR}: unconfirmed (unknown commit ${unknown})`);
    } finally {
      rmSync(app.dir, { recursive: true, force: true });
    }
  });
});

describe("C2: an upkeep pass checks the local verifiers", () => {
  test("the prompt lists the local pages and the pass reports the stale claim", () => {
    const app = scratchLocalApp();
    try {
      writeRepoFile(app.repo, "src/cli.txt", "v2\n");
      commitAll(app.repo, "cli v2");
      const p = run(RUN, ["verifier", "upkeep-prompt", app.repo]);
      expectCode(p, 0);
      for (const page of PAGES) expect(p.out).toContain(`- ${page}`);
      writeStubLocalUpkeep(app.bin);
      const report = writeReport(app.dir, REPORT_CHANGED);
      const env = makeEnv(app, { POSTMASTER_HOST: "none", ORACLE_REPORT: report });
      const r = runUpkeep(app.repo, app.dispatch, env);
      expectCode(r, 1);
      expect(r.out).toContain(`stale: ${CLAIM_NAME} (${PAGE1})`);
      expect(r.out).toContain("features driven: 3, stale: 1, unchecked: 0");
      expect(r.out).not.toContain("corrected:");
      expect(summaryLine(r.out, "branch")).toBe("");
      const promptFile = summaryLine(r.out, "prompt");
      expect(promptFile).not.toBe("");
      const prompt = readFileSync(promptFile, "utf8");
      for (const page of PAGES) expect(prompt).toContain(`- ${page}`);
      const saved = summaryLine(r.out, "report");
      expect(saved.startsWith(app.dispatch)).toBe(true);
      expect(existsSync(saved)).toBe(true);
      expect(gitOrThrow(app.repo, "worktree", "list")).not.toContain("upkeep");
    } finally {
      rmSync(app.dir, { recursive: true, force: true });
    }
  });

  test("a report that leaves a page undriven is refused, leaving the copy with no branch", () => {
    const app = scratchLocalApp();
    try {
      writeStubLocalUpkeep(app.bin);
      const report = writeReport(app.dir, REPORT_UNDERRIVEN);
      const env = makeEnv(app, { POSTMASTER_HOST: "none", ORACLE_REPORT: report });
      const r = runUpkeep(app.repo, app.dispatch, env);
      expectCode(r, 1);
      expect(r.err).toContain(`the report names no outcome for ${PAGE3}`);
      expect(gitOrThrow(app.repo, "worktree", "list")).toContain("upkeep");
      expect(gitOrThrow(app.repo, "branch", "--list", "upkeep*")).toBe("");
    } finally {
      rmSync(app.dir, { recursive: true, force: true });
    }
  });
});

describe("C3: a correcting pass writes into the local verifiers in place", () => {
  test("corrections land in the folder and the record keeps what was there", () => {
    const app = scratchLocalApp();
    try {
      writeRepoFile(app.repo, "src/cli.txt", "v2\n");
      commitAll(app.repo, "cli v2");
      const head = gitOrThrow(app.repo, "rev-parse", "HEAD").trim();
      writeStubLocalUpkeep(app.bin);
      const report = writeReport(app.dir, REPORT_CORRECTED);
      const overlay = correctingOverlay(app.dir, app.repo, app.first, head);
      const env = makeEnv(app, {
        POSTMASTER_HOST: "none",
        ORACLE_REPORT: report,
        ORACLE_OVERLAY: overlay,
      });
      const r = runUpkeep(app.repo, app.dispatch, env, ["--correct"]);
      expectCode(r, 0);
      expect(r.out).toContain(`corrected: ${CLAIM_NAME} (${PAGE1})`);
      expect(r.out).toContain("every claim holds");
      expect(readFileSync(join(app.repo, PAGE1), "utf8")).toContain(
        "Corrected to what the app does.",
      );
      expect(readFileSync(join(app.repo, LOCAL, "README.md"), "utf8")).toContain(
        `Confirmed: ${head}`,
      );
      const snap = join(app.dispatch, "verifier-before-upkeep");
      expect(readFileSync(join(snap, "README.md"), "utf8")).toContain(`Confirmed: ${app.first}`);
      expect(readFileSync(join(snap, "cli", "features", "f1.md"), "utf8")).not.toContain(
        "Corrected to what the app does.",
      );
      const saved = summaryLine(r.out, "report");
      expect(saved.startsWith(app.dispatch)).toBe(true);
      expect(readFileSync(saved, "utf8")).toContain("## Feature:");
    } finally {
      rmSync(app.dir, { recursive: true, force: true });
    }
  });

  test("a pass that reaches past the verifiers is refused and changes nothing", () => {
    const app = scratchLocalApp();
    try {
      writeRepoFile(app.repo, "src/cli.txt", "v2\n");
      commitAll(app.repo, "cli v2");
      const head = gitOrThrow(app.repo, "rev-parse", "HEAD").trim();
      writeStubLocalUpkeep(app.bin);
      const report = writeReport(app.dir, REPORT_CORRECTED);
      const before = readFileSync(join(app.repo, PAGE1), "utf8");
      const overlay = correctingOverlay(app.dir, app.repo, app.first, head, {
        "src/cli.txt": "v3\n",
      });
      const env = makeEnv(app, {
        POSTMASTER_HOST: "none",
        ORACLE_REPORT: report,
        ORACLE_OVERLAY: overlay,
      });
      const r = runUpkeep(app.repo, app.dispatch, env, ["--correct"]);
      expectCode(r, 1);
      expect(r.err).toContain("outside the verifiers' folder: src/cli.txt");
      expect(readFileSync(join(app.repo, PAGE1), "utf8")).toBe(before);
      expect(readFileSync(join(app.repo, "src/cli.txt"), "utf8")).toBe("v2\n");
      expect(gitOrThrow(app.repo, "worktree", "list")).toContain("upkeep");
      expect(gitOrThrow(app.repo, "branch", "--list", "upkeep*")).toBe("");
    } finally {
      rmSync(app.dir, { recursive: true, force: true });
    }
  });
});

describe("C4: a correcting pass on local verifiers leaves no trace", () => {
  test("refs, history, worktrees and dirt read the same before and after", () => {
    const app = scratchLocalApp();
    try {
      writeRepoFile(app.repo, "src/cli.txt", "v2\n");
      commitAll(app.repo, "cli v2");
      const head = gitOrThrow(app.repo, "rev-parse", "HEAD").trim();
      writeStubLocalUpkeep(app.bin);
      const report = writeReport(app.dir, REPORT_CORRECTED);
      const overlay = correctingOverlay(app.dir, app.repo, app.first, head);
      const env = makeEnv(app, {
        POSTMASTER_HOST: "none",
        ORACLE_REPORT: report,
        ORACLE_OVERLAY: overlay,
      });
      const refsBefore = gitOrThrow(app.repo, "for-each-ref");
      const logBefore = gitOrThrow(app.repo, "log", "--all", "--oneline");
      const wtBefore = gitOrThrow(app.repo, "worktree", "list");
      const r = runUpkeep(app.repo, app.dispatch, env, ["--correct"]);
      expectCode(r, 0);
      expect(r.out).toContain("every claim holds");
      expect(gitOrThrow(app.repo, "for-each-ref")).toBe(refsBefore);
      expect(gitOrThrow(app.repo, "log", "--all", "--oneline")).toBe(logBefore);
      expect(gitOrThrow(app.repo, "worktree", "list")).toBe(wtBefore);
      expectCode(run(RUN, ["check-target", app.repo]), 0);
    } finally {
      rmSync(app.dir, { recursive: true, force: true });
    }
  });
});

describe("C5: after a landing the step lands only a printed branch", () => {
  test("the step lands a printed branch and reports local corrections as kept", () => {
    const postmaster = readFileSync(join(ROOT, "skills/postmaster/postmaster.md"), "utf8");
    const step = postmaster.indexOf("any verifier may have gone stale");
    expect(step).toBeGreaterThanOrEqual(0);
    const land = postmaster.indexOf("only where the pass printed one", step);
    expect(land).toBeGreaterThan(step);
    expect(postmaster.indexOf("run verifier land", land)).toBeGreaterThan(land);
    expect(postmaster.indexOf("prints no branch", step)).toBeGreaterThan(step);
    expect(postmaster.indexOf("report them as kept", step)).toBeGreaterThan(step);
  });

  test("a correcting pass on local verifiers prints no branch line", () => {
    const app = scratchLocalApp();
    try {
      writeRepoFile(app.repo, "src/cli.txt", "v2\n");
      commitAll(app.repo, "cli v2");
      const head = gitOrThrow(app.repo, "rev-parse", "HEAD").trim();
      writeStubLocalUpkeep(app.bin);
      const report = writeReport(app.dir, REPORT_CORRECTED);
      const overlay = correctingOverlay(app.dir, app.repo, app.first, head);
      const env = makeEnv(app, {
        POSTMASTER_HOST: "none",
        ORACLE_REPORT: report,
        ORACLE_OVERLAY: overlay,
      });
      const r = runUpkeep(app.repo, app.dispatch, env, ["--correct"]);
      expectCode(r, 0);
      expect(summaryLine(r.out, "branch")).toBe("");
      const promptFile = summaryLine(r.out, "prompt");
      expect(promptFile).not.toBe("");
      const prompt = readFileSync(promptFile, "utf8");
      expect(prompt).toContain("Commit nothing");
      expect(prompt).not.toContain("branch");
    } finally {
      rmSync(app.dir, { recursive: true, force: true });
    }
  });
});
