// Oracle for #478, committed before the change: a run reads the local
// verifiers from its own copy, and what it adds is kept when it is merged.
// Every case drives git or scripts/run as a subprocess. C6, a fixture run
// from this branch scoring clean, needs a dispatched run and stays out.
import { describe, expect, test } from "bun:test";
import {
  appendFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { gitOrThrow, ROOT, writeRepoFile } from "./acceptance-323.ts";
import { makeEnv, makeSandbox } from "./acceptance-344.ts";
import { UPKEEP_SENTENCE } from "./acceptance-477.ts";
import {
  cutWorktree,
  expectCode,
  extraDispatch,
  readTree,
  RUN,
  scratchApp,
  snapshotTree,
  writeLaneConfig,
  writeLaneStub,
} from "./acceptance-478.ts";
import { startCheck } from "./lib/confine.ts";
import { run } from "./lib/proc.ts";

/** Two trees hold the same files byte for byte, except the skipped ones. */
function expectTreesEqual(a: string, b: string, except: string[] = []): void {
  const skip = new Set(except);
  const ra = readTree(a);
  const rb = readTree(b);
  const ka = [...ra.keys()].filter((k) => !skip.has(k)).sort();
  const kb = [...rb.keys()].filter((k) => !skip.has(k)).sort();
  expect(ka).toEqual(kb);
  const hex = (m: Map<string, Buffer>, k: string): string =>
    (m.get(k) ?? Buffer.alloc(0)).toString("hex");
  expect(ka.map((k) => [k, hex(ra, k)])).toEqual(ka.map((k) => [k, hex(rb, k)]));
}

const EDIT_LINE = "driven against the ticket branch";

/**
 * The C2 coachman edit, played by hand: one changed page in the synthesis
 * copy, and a whole added verifier for a surface with none, with its README,
 * three feature pages and its index bullet confirmed at the base.
 */
function coachmanEdit(syn: string, base: string): void {
  const root = join(syn, ".postmaster/verifier");
  appendFileSync(join(root, "cli/features/f1.md"), `${EDIT_LINE}\n`);
  writeRepoFile(
    syn,
    ".postmaster/verifier/api/README.md",
    `# api verifier\n\nFor the backend service.\n\n${UPKEEP_SENTENCE}\n`,
  );
  writeRepoFile(
    syn,
    ".postmaster/verifier/api/features/README.md",
    `Files: README.md\nConfirmed: ${base}\n`,
  );
  for (const page of ["f1.md", "f2.md", "f3.md"]) {
    writeRepoFile(syn, `.postmaster/verifier/api/features/${page}`, `# ${page}\n`);
  }
  appendFileSync(
    join(root, "README.md"),
    `- The backend service verifier in .postmaster/verifier/api/: drives it. Files: README.md, Confirmed: ${base}\n`,
  );
}

/** A ticket branch with one file, merged into main: the merge commit. */
function landTicket(repo: string, branch: string, file: string): string {
  gitOrThrow(repo, "checkout", "-q", "-b", branch);
  writeRepoFile(repo, file, `${branch}\n`);
  gitOrThrow(repo, "add", file);
  gitOrThrow(repo, "commit", "-q", "-m", branch);
  gitOrThrow(repo, "checkout", "-q", "main");
  gitOrThrow(repo, "merge", "-q", "--no-ff", branch, "-m", `merge ${branch}`);
  return gitOrThrow(repo, "rev-parse", "HEAD").trim();
}

describe("C1: a run's working copies hold their own copy of the local verifiers", () => {
  test("record keeps the dispatch copy and arm places it byte for byte in each copy", () => {
    const app = scratchApp();
    try {
      const rec = run(RUN, ["verifier", "record", app.repo, app.dispatch]);
      expectCode(rec, 0);
      expect(rec.out).toContain("recorded .postmaster/verifier");
      const again = run(RUN, ["verifier", "record", app.repo, app.dispatch]);
      expectCode(again, 0);
      expect(again.out).toContain("already recorded");
      const atDispatch = join(app.dispatch, "verifier-at-dispatch");
      expectTreesEqual(join(app.repo, ".postmaster/verifier"), atDispatch);
      const syn = cutWorktree(app.repo, app.dir, "syn", "wsyn");
      const horse = cutWorktree(app.repo, app.dir, "horse", "wb/478-stub");
      for (const wt of [syn, horse]) {
        const a = run(RUN, ["verifier", "arm", wt, app.dispatch]);
        expectCode(a, 0);
        expect(a.out).toContain("armed");
      }
      for (const wt of [syn, horse]) {
        expectTreesEqual(join(wt, ".postmaster/verifier"), atDispatch);
        expect(gitOrThrow(wt, "status", "--porcelain", "--untracked-files=all")).toBe("");
      }
      appendFileSync(join(app.repo, ".postmaster/verifier/README.md"), "\nlate edit\n");
      const index = readFileSync(join(atDispatch, "README.md"), "utf8");
      for (const wt of [syn, horse]) {
        expect(readFileSync(join(wt, ".postmaster/verifier/README.md"), "utf8")).toBe(index);
      }
    } finally {
      rmSync(app.dir, { recursive: true, force: true });
    }
  });

  test("a lane reads its copy's index relative to its cwd, confined and unconfined", () => {
    const avail = startCheck();
    for (const confine of ["on", "off"] as const) {
      const app = scratchApp();
      try {
        expectCode(run(RUN, ["verifier", "record", app.repo, app.dispatch]), 0);
        const wt = cutWorktree(app.repo, app.dir, "lane", "wlane");
        expectCode(run(RUN, ["verifier", "arm", wt, app.dispatch]), 0);
        writeLaneStub(app.bin);
        const config = writeLaneConfig(app.dir, confine);
        const prompt = join(app.dir, "prompt.txt");
        writeFileSync(prompt, "read the index\n");
        const r = run(RUN, ["launch", "launch", "stub", wt, prompt], {
          env: makeEnv(app, { POSTMASTER_CONFIG: config }),
        });
        expectCode(r, 0);
        const index = readFileSync(join(app.dispatch, "verifier-at-dispatch", "README.md"), "utf8");
        expect(r.out).toContain(index);
        if (confine === "on") {
          if (avail.ok) expect(r.err).not.toContain("unconfined");
          else expect(r.err).toContain("running stub unconfined");
        } else {
          expect(r.err).not.toContain("unconfined");
        }
      } finally {
        rmSync(app.dir, { recursive: true, force: true });
      }
    }
  });

  test("the runbooks record the copy at dispatch and arm it into each copy", () => {
    const postmaster = readFileSync(join(ROOT, "skills/postmaster/postmaster.md"), "utf8");
    expect(postmaster).toContain("verifier record");
    const coachman = readFileSync(join(ROOT, "skills/postmaster/coachman.md"), "utf8");
    expect(coachman).toContain("verifier arm");
  });
});

describe("C2: the coachman adds what a criterion needs to the synthesis copy", () => {
  test("an edit and a whole added verifier stay in the synthesis copy only", () => {
    const app = scratchApp();
    try {
      expectCode(run(RUN, ["verifier", "record", app.repo, app.dispatch]), 0);
      const syn = cutWorktree(app.repo, app.dir, "syn", "wsyn");
      const horse = cutWorktree(app.repo, app.dir, "horse", "wb/478-stub");
      expectCode(run(RUN, ["verifier", "arm", syn, app.dispatch]), 0);
      expectCode(run(RUN, ["verifier", "arm", horse, app.dispatch]), 0);
      coachmanEdit(syn, app.sha);
      expectTreesEqual(
        join(horse, ".postmaster/verifier"),
        join(app.dispatch, "verifier-at-dispatch"),
      );
      const root = join(syn, ".postmaster/verifier");
      expect(readFileSync(join(root, "cli/features/f1.md"), "utf8")).toContain(EDIT_LINE);
      for (const f of [
        "api/README.md",
        "api/features/README.md",
        "api/features/f1.md",
        "api/features/f2.md",
        "api/features/f3.md",
      ]) {
        expect(existsSync(join(root, f))).toBe(true);
      }
      expect(readFileSync(join(root, "README.md"), "utf8")).toContain(".postmaster/verifier/api/");
    } finally {
      rmSync(app.dir, { recursive: true, force: true });
    }
  });

  test("the coachman runbook carries the synthesis-copy duties", () => {
    const coachman = readFileSync(join(ROOT, "skills/postmaster/coachman.md"), "utf8");
    expect(coachman).toContain("adds what a criterion needs to the synthesis worktree's copy");
    expect(coachman).toContain("up to a whole verifier");
    expect(coachman).toContain("the pages of features the ticket adds, changes or removes");
  });

  test("no script or runbook outside the tests runs git clean", () => {
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir).sort()) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (!full.endsWith(".test.ts") && readFileSync(full, "utf8").includes("git clean")) {
          hits.push(full);
        }
      }
    };
    walk(join(ROOT, "scripts"));
    walk(join(ROOT, "skills"));
    expect(hits).toEqual([]);
  });
});

describe("C3: the ship card shows the run's verifier changes", () => {
  test("changes names the changed page with its diff and the added verifier's files", () => {
    const app = scratchApp();
    try {
      expectCode(run(RUN, ["verifier", "record", app.repo, app.dispatch]), 0);
      const syn = cutWorktree(app.repo, app.dir, "syn", "wsyn");
      expectCode(run(RUN, ["verifier", "arm", syn, app.dispatch]), 0);
      coachmanEdit(syn, app.sha);
      const r = run(RUN, ["verifier", "changes", syn, app.dispatch]);
      expectCode(r, 0);
      expect(r.out).toContain("## Verifier changes");
      expect(r.out).toContain("Changed:");
      expect(r.out).toContain("cli/features/f1.md");
      expect(r.out).toContain("@@");
      expect(r.out).toContain(`+${EDIT_LINE}`);
      expect(r.out).toContain("Added:");
      for (const f of [
        "api/README.md",
        "api/features/README.md",
        "api/features/f1.md",
        "api/features/f2.md",
        "api/features/f3.md",
      ]) {
        expect(r.out).toContain(f);
      }
      expect(r.out).toContain("- The backend service verifier in .postmaster/verifier/api/");
      expect(r.out).not.toContain("Removed:");
    } finally {
      rmSync(app.dir, { recursive: true, force: true });
    }
  });

  test("changes on an unchanged copy prints one line", () => {
    const app = scratchApp();
    try {
      expectCode(run(RUN, ["verifier", "record", app.repo, app.dispatch]), 0);
      const syn = cutWorktree(app.repo, app.dir, "syn", "wsyn");
      expectCode(run(RUN, ["verifier", "arm", syn, app.dispatch]), 0);
      const r = run(RUN, ["verifier", "changes", syn, app.dispatch]);
      expectCode(r, 0);
      expect(r.out.trim()).toBe("verifiers unchanged");
    } finally {
      rmSync(app.dir, { recursive: true, force: true });
    }
  });

  test("Stage 3 carries the section onto the card", () => {
    const coachman = readFileSync(join(ROOT, "skills/postmaster/coachman.md"), "utf8");
    const stage3 = coachman.indexOf("## Stage 3");
    expect(stage3).toBeGreaterThanOrEqual(0);
    expect(coachman.indexOf("verifier changes", stage3)).toBeGreaterThan(stage3);
    expect(coachman.indexOf("## Verifier changes", stage3)).toBeGreaterThan(stage3);
  });
});

describe("C4: the project's verifiers take the run's changes only at the merge", () => {
  test("keep applies the frozen changes at the merge and confirms them", () => {
    const app = scratchApp();
    try {
      expectCode(run(RUN, ["verifier", "record", app.repo, app.dispatch]), 0);
      const syn = cutWorktree(app.repo, app.dir, "syn", "wsyn");
      expectCode(run(RUN, ["verifier", "arm", syn, app.dispatch]), 0);
      coachmanEdit(syn, app.sha);
      expectCode(run(RUN, ["verifier", "changes", syn, app.dispatch, "--freeze"]), 0);
      expectTreesEqual(join(app.dispatch, "verifier-final"), join(syn, ".postmaster/verifier"));
      const merge = landTicket(app.repo, "478", "feature.txt");
      // keep reads the record, not the worktree: the copy is gone by then.
      snapshotTree(join(syn, ".postmaster/verifier"), join(app.dir, "syn-had"));
      gitOrThrow(app.repo, "worktree", "remove", "--force", syn);
      snapshotTree(join(app.repo, ".postmaster/verifier"), join(app.dir, "before"));
      const refsBefore = gitOrThrow(app.repo, "for-each-ref");
      const logBefore = gitOrThrow(app.repo, "log", "--all", "--oneline");
      const wtBefore = gitOrThrow(app.repo, "worktree", "list");
      const k = run(RUN, ["verifier", "keep", app.repo, "--run", app.dispatch, "--at", merge]);
      expectCode(k, 0);
      expect(k.out).toContain("kept .postmaster/verifier");
      expect(k.out).toContain(`confirmed cli at ${merge}`);
      expect(k.out).toContain(`confirmed api at ${merge}`);
      expectTreesEqual(join(app.repo, ".postmaster/verifier"), join(app.dir, "syn-had"), [
        "README.md",
      ]);
      const index = readFileSync(join(app.repo, ".postmaster/verifier/README.md"), "utf8");
      expect(index.match(new RegExp(`Confirmed: ${merge}`, "g"))?.length).toBe(2);
      expectTreesEqual(join(app.dispatch, "verifier-before-keep"), join(app.dir, "before"));
      expect(gitOrThrow(app.repo, "for-each-ref")).toBe(refsBefore);
      expect(gitOrThrow(app.repo, "log", "--all", "--oneline")).toBe(logBefore);
      expect(gitOrThrow(app.repo, "worktree", "list")).toBe(wtBefore);
      expectCode(run(RUN, ["check-target", app.repo]), 0);
    } finally {
      rmSync(app.dir, { recursive: true, force: true });
    }
  });

  test("the postmaster keeps the run's changes before the stale query", () => {
    const postmaster = readFileSync(join(ROOT, "skills/postmaster/postmaster.md"), "utf8");
    const stageG = postmaster.indexOf("## Stage G");
    expect(stageG).toBeGreaterThanOrEqual(0);
    const keep = postmaster.indexOf("verifier keep", stageG);
    expect(keep).toBeGreaterThan(stageG);
    expect(postmaster.indexOf("not kept", keep)).toBeGreaterThan(keep);
  });

  test("an unmerged run's aftercare leaves the project's folder as it was", () => {
    const app = scratchApp();
    try {
      expectCode(run(RUN, ["verifier", "record", app.repo, app.dispatch]), 0);
      const syn = cutWorktree(app.repo, app.dir, "syn", "wsyn");
      expectCode(run(RUN, ["verifier", "arm", syn, app.dispatch]), 0);
      coachmanEdit(syn, app.sha);
      snapshotTree(join(app.repo, ".postmaster/verifier"), join(app.dir, "before"));
      writeFileSync(
        join(app.dispatch, "manifest.json"),
        JSON.stringify({ stage: "dispatched", leg: 1 }),
      );
      const a = run(RUN, ["aftercare", app.dispatch]);
      expect(a.code).not.toBe(0);
      expectTreesEqual(join(app.repo, ".postmaster/verifier"), join(app.dir, "before"));
    } finally {
      rmSync(app.dir, { recursive: true, force: true });
    }
  });
});

describe("C5: a clash is not kept, and the user is told which", () => {
  test("same-line changes clash, an added page keeps, disjoint pages apply", () => {
    const app = scratchApp();
    try {
      const d1 = app.dispatch;
      const d2 = extraDispatch(app, "dispatch-2");
      expectCode(run(RUN, ["verifier", "record", app.repo, d1]), 0);
      expectCode(run(RUN, ["verifier", "record", app.repo, d2]), 0);
      const syn1 = cutWorktree(app.repo, app.dir, "syn1", "wt1");
      const syn2 = cutWorktree(app.repo, app.dir, "syn2", "wt2");
      expectCode(run(RUN, ["verifier", "arm", syn1, d1]), 0);
      expectCode(run(RUN, ["verifier", "arm", syn2, d2]), 0);
      writeRepoFile(syn1, ".postmaster/verifier/cli/features/f1.md", "# f1 run one\n");
      writeRepoFile(syn2, ".postmaster/verifier/cli/features/f1.md", "# f1 run two\n");
      writeRepoFile(syn2, ".postmaster/verifier/cli/features/f4.md", "# f4\n");
      expectCode(run(RUN, ["verifier", "changes", syn1, d1, "--freeze"]), 0);
      expectCode(run(RUN, ["verifier", "changes", syn2, d2, "--freeze"]), 0);
      const merge1 = landTicket(app.repo, "run1", "one.txt");
      expectCode(run(RUN, ["verifier", "keep", app.repo, "--run", d1, "--at", merge1]), 0);
      const merge2 = landTicket(app.repo, "run2", "two.txt");
      const k2 = run(RUN, ["verifier", "keep", app.repo, "--run", d2, "--at", merge2]);
      expectCode(k2, 1);
      expect(k2.out).toContain("not kept: cli/features/f1.md");
      expect(k2.out).toContain("confirmed cli at");
      expect(readFileSync(join(app.repo, ".postmaster/verifier/cli/features/f1.md"), "utf8")).toBe(
        "# f1 run one\n",
      );
      expect(readFileSync(join(app.repo, ".postmaster/verifier/cli/features/f4.md"), "utf8")).toBe(
        "# f4\n",
      );
      const d3 = extraDispatch(app, "dispatch-3");
      expectCode(run(RUN, ["verifier", "record", app.repo, d3]), 0);
      const syn3 = cutWorktree(app.repo, app.dir, "syn3", "wt3");
      expectCode(run(RUN, ["verifier", "arm", syn3, d3]), 0);
      writeRepoFile(syn3, ".postmaster/verifier/cli/features/f2.md", "# f2 run three\n");
      expectCode(run(RUN, ["verifier", "changes", syn3, d3, "--freeze"]), 0);
      const merge3 = landTicket(app.repo, "run3", "three.txt");
      expectCode(run(RUN, ["verifier", "keep", app.repo, "--run", d3, "--at", merge3]), 0);
      expect(readFileSync(join(app.repo, ".postmaster/verifier/cli/features/f2.md"), "utf8")).toBe(
        "# f2 run three\n",
      );
    } finally {
      rmSync(app.dir, { recursive: true, force: true });
    }
  });
});

describe("a project with no verifiers yet", () => {
  test("record notes none, and a whole added verifier keeps", () => {
    const sandbox = makeSandbox();
    try {
      const rec = run(RUN, ["verifier", "record", sandbox.repo, sandbox.dispatch]);
      expectCode(rec, 0);
      expect(rec.out).toContain("no local verifiers");
      const wt = cutWorktree(sandbox.repo, sandbox.dir, "syn", "wsyn");
      const a = run(RUN, ["verifier", "arm", wt, sandbox.dispatch]);
      expectCode(a, 0);
      expect(a.out).toContain("no verifiers recorded");
      expect(existsSync(join(wt, ".postmaster/verifier"))).toBe(false);
      const base = gitOrThrow(sandbox.repo, "rev-parse", "HEAD").trim();
      writeRepoFile(
        wt,
        ".postmaster/verifier/cli/README.md",
        `# cli verifier\n\nFor the command line.\n\n${UPKEEP_SENTENCE}\n`,
      );
      writeRepoFile(
        wt,
        ".postmaster/verifier/cli/features/README.md",
        `Files: README.md\nConfirmed: ${base}\n`,
      );
      for (const page of ["f1.md", "f2.md", "f3.md"]) {
        writeRepoFile(wt, `.postmaster/verifier/cli/features/${page}`, `# ${page}\n`);
      }
      writeRepoFile(
        wt,
        ".postmaster/verifier/README.md",
        `# Verifiers\n\n- The command line verifier in .postmaster/verifier/cli/: drives it. Files: README.md, Confirmed: ${base}\n`,
      );
      const ch = run(RUN, ["verifier", "changes", wt, sandbox.dispatch, "--freeze"]);
      expectCode(ch, 0);
      expect(ch.out).toContain("## Verifier changes");
      expect(ch.out).toContain("Added:");
      expect(ch.out).toContain("cli/README.md");
      const merge = landTicket(sandbox.repo, "t", "feature.txt");
      const k = run(RUN, [
        "verifier",
        "keep",
        sandbox.repo,
        "--run",
        sandbox.dispatch,
        "--at",
        merge,
      ]);
      expectCode(k, 0);
      expect(readFileSync(join(sandbox.repo, ".postmaster/verifier/README.md"), "utf8")).toContain(
        `Confirmed: ${merge}`,
      );
      expectCode(run(RUN, ["check-target", sandbox.repo]), 0);
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });
});
