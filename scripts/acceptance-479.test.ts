// Oracle for #479, committed before the change: the stale check marks local
// verifiers, an upkeep pass checks them, and a correcting pass writes its
// corrections into them in place, leaving the repository showing nothing new.
// Every case drives git or scripts/run as a subprocess. C6, a fixture run
// from this branch scoring clean, needs a dispatched run and stays out.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { commitAll, gitOrThrow, ROOT, writeRepoFile } from "./acceptance-323.ts";
import { makeEnv, summaryLine } from "./acceptance-344.ts";
import { expectCode } from "./acceptance-478.ts";
import {
  CLAIM_NAME,
  correctingOverlay,
  LOCAL,
  PAGE1,
  PAGE2,
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

/** The oracle's upkeep stub with extra shell lines played after the overlay. */
function extendStub(bin: string, lines: string[]): void {
  const path = join(bin, "claude");
  writeStubLocalUpkeep(bin);
  writeFileSync(path, `${readFileSync(path, "utf8")}${lines.join("\n")}\n`);
}

/** A second local kind the pass was not asked for, confirmed at the first commit. */
function plantApiKind(repo: string, first: string): string {
  const page = `${LOCAL}/api/features/g1.md`;
  writeRepoFile(repo, `${LOCAL}/api/README.md`, "# api verifier\n");
  writeRepoFile(repo, page, "# g1\n");
  const index = join(repo, LOCAL, "README.md");
  writeFileSync(
    index,
    `${readFileSync(index, "utf8")}- The backend service verifier in ${LOCAL}/api/: drives it. Files: src/cli.txt, Confirmed: ${first}\n`,
  );
  return page;
}

describe("R1: the keep applies the pass's changes and nothing else", () => {
  test("a page the pass deletes is gone after the keep", () => {
    const app = scratchLocalApp();
    try {
      writeRepoFile(app.repo, "src/cli.txt", "v2\n");
      commitAll(app.repo, "cli v2");
      const head = gitOrThrow(app.repo, "rev-parse", "HEAD").trim();
      extendStub(app.bin, [`rm -f ${PAGE3}`]);
      const report = writeReport(app.dir, REPORT_CORRECTED);
      const overlay = correctingOverlay(app.dir, app.repo, app.first, head);
      const env = makeEnv(app, {
        POSTMASTER_HOST: "none",
        ORACLE_REPORT: report,
        ORACLE_OVERLAY: overlay,
      });
      const r = runUpkeep(app.repo, app.dispatch, env, ["--correct"]);
      expectCode(r, 0);
      expect(r.out).toContain("every claim holds");
      expect(() => readFileSync(join(app.repo, PAGE3), "utf8")).toThrow();
      expect(readFileSync(join(app.repo, PAGE1), "utf8")).toContain(
        "Corrected to what the app does.",
      );
    } finally {
      rmSync(app.dir, { recursive: true, force: true });
    }
  });

  test("an edit made while the pass ran survives where the pass left it alone", () => {
    const app = scratchLocalApp();
    try {
      writeRepoFile(app.repo, "src/cli.txt", "v2\n");
      commitAll(app.repo, "cli v2");
      const head = gitOrThrow(app.repo, "rev-parse", "HEAD").trim();
      extendStub(app.bin, [
        'if [ -z "${ORACLE_REPO:-}" ]; then echo "stub refuses: ORACLE_REPO is unset" >&2; exit 1; fi',
        'printf "%s\\n" "$ORACLE_CONCURRENT_LINE" >> "$ORACLE_REPO/$ORACLE_CONCURRENT_FILE"',
      ]);
      const report = writeReport(app.dir, REPORT_CORRECTED);
      const overlay = correctingOverlay(app.dir, app.repo, app.first, head);
      const env = makeEnv(app, {
        POSTMASTER_HOST: "none",
        ORACLE_REPORT: report,
        ORACLE_OVERLAY: overlay,
        ORACLE_REPO: app.repo,
        ORACLE_CONCURRENT_FILE: PAGE2,
        ORACLE_CONCURRENT_LINE: "concurrent edit while the pass ran",
      });
      const r = runUpkeep(app.repo, app.dispatch, env, ["--correct"]);
      expectCode(r, 0);
      expect(r.out).toContain("every claim holds");
      expect(readFileSync(join(app.repo, PAGE2), "utf8")).toContain(
        "concurrent edit while the pass ran",
      );
      expect(readFileSync(join(app.repo, PAGE1), "utf8")).toContain(
        "Corrected to what the app does.",
      );
    } finally {
      rmSync(app.dir, { recursive: true, force: true });
    }
  });

  test("an edit the pass also changed refuses the keep and keeps the edit", () => {
    const app = scratchLocalApp();
    try {
      writeRepoFile(app.repo, "src/cli.txt", "v2\n");
      commitAll(app.repo, "cli v2");
      const head = gitOrThrow(app.repo, "rev-parse", "HEAD").trim();
      extendStub(app.bin, [
        'if [ -z "${ORACLE_REPO:-}" ]; then echo "stub refuses: ORACLE_REPO is unset" >&2; exit 1; fi',
        'printf "%s\\n" "$ORACLE_CONCURRENT_LINE" >> "$ORACLE_REPO/$ORACLE_CONCURRENT_FILE"',
      ]);
      const report = writeReport(app.dir, REPORT_CORRECTED);
      const overlay = correctingOverlay(app.dir, app.repo, app.first, head);
      const env = makeEnv(app, {
        POSTMASTER_HOST: "none",
        ORACLE_REPORT: report,
        ORACLE_OVERLAY: overlay,
        ORACLE_REPO: app.repo,
        ORACLE_CONCURRENT_FILE: PAGE1,
        ORACLE_CONCURRENT_LINE: "concurrent edit while the pass ran",
      });
      const r = runUpkeep(app.repo, app.dispatch, env, ["--correct"]);
      expectCode(r, 1);
      expect(r.err).toContain("the keep was refused");
      expect(r.err).toContain("cli/features/f1.md (changed on both sides)");
      const page = readFileSync(join(app.repo, PAGE1), "utf8");
      expect(page).toContain("concurrent edit while the pass ran");
      expect(page).not.toContain("Corrected to what the app does.");
      expect(gitOrThrow(app.repo, "worktree", "list")).toContain("upkeep");
      expect(gitOrThrow(app.repo, "branch", "--list", "upkeep*")).toBe("");
    } finally {
      rmSync(app.dir, { recursive: true, force: true });
    }
  });
});

describe("R1: the pass refuses what it must not drive", () => {
  test("a symlinked verifier root refuses before any session starts", () => {
    const app = scratchLocalApp();
    try {
      const external = join(app.dir, "external-verifier");
      renameSync(join(app.repo, LOCAL), external);
      symlinkSync(external, join(app.repo, LOCAL), "dir");
      const pageBefore = readFileSync(join(external, "cli", "features", "f1.md"), "utf8");
      const r = runUpkeep(app.repo, app.dispatch, makeEnv(app, { POSTMASTER_HOST: "none" }));
      expectCode(r, 1);
      expect(r.err).toContain("must not be a symlink");
      expect(readFileSync(join(external, "cli", "features", "f1.md"), "utf8")).toBe(pageBefore);
      expect(gitOrThrow(app.repo, "worktree", "list")).not.toContain("upkeep");
    } finally {
      rmSync(app.dir, { recursive: true, force: true });
    }
  });

  test("a scoped pass that reaches a sibling verifier is refused", () => {
    const app = scratchLocalApp();
    try {
      const apiPage = plantApiKind(app.repo, app.first);
      writeRepoFile(app.repo, "src/cli.txt", "v2\n");
      commitAll(app.repo, "cli v2");
      const head = gitOrThrow(app.repo, "rev-parse", "HEAD").trim();
      writeStubLocalUpkeep(app.bin);
      const report = writeReport(app.dir, REPORT_CORRECTED);
      const overlay = correctingOverlay(app.dir, app.repo, app.first, head, {
        [apiPage]: "# g1\nsibling edit\n",
      });
      const env = makeEnv(app, {
        POSTMASTER_HOST: "none",
        ORACLE_REPORT: report,
        ORACLE_OVERLAY: overlay,
      });
      const r = runUpkeep(app.repo, app.dispatch, env, ["--correct", "--folder", VDIR]);
      expectCode(r, 1);
      expect(r.err).toContain(`outside the verifiers' folder: ${apiPage}`);
      expect(readFileSync(join(app.repo, apiPage), "utf8")).toBe("# g1\n");
      expect(gitOrThrow(app.repo, "worktree", "list")).toContain("upkeep");
    } finally {
      rmSync(app.dir, { recursive: true, force: true });
    }
  });

  test("a scoped pass that stays in its folder keeps through the shared index", () => {
    const app = scratchLocalApp();
    try {
      plantApiKind(app.repo, app.first);
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
      const r = runUpkeep(app.repo, app.dispatch, env, ["--correct", "--folder", VDIR]);
      expectCode(r, 0);
      expect(r.out).toContain(`corrected: ${CLAIM_NAME} (${PAGE1})`);
      expect(readFileSync(join(app.repo, PAGE1), "utf8")).toContain(
        "Corrected to what the app does.",
      );
    } finally {
      rmSync(app.dir, { recursive: true, force: true });
    }
  });

  test("an untracked ignore file the tool copies refuses nothing", () => {
    const app = scratchLocalApp();
    try {
      writeRepoFile(app.repo, "src/cli.txt", "v2\n");
      commitAll(app.repo, "cli v2");
      writeRepoFile(app.repo, ".postmaster/.gitignore", "*.log\n");
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
      expect(r.out).toContain("every claim holds");
    } finally {
      rmSync(app.dir, { recursive: true, force: true });
    }
  });
});
