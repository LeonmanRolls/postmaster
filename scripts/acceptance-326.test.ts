// Oracle for #326, committed before the change: when a postmaster starts on a
// project with no verifiers, the launch card offers one per surface setup finds
// (one for the main surface when it finds none); a no changes nothing; a yes
// makes and lands them before any ticket is dispatched; a fixture copy is never
// offered them. Pins only what runs without a model: discover-project's
// surfaces= and verifiers= lines with the fixture suppression, setup-verifiers'
// usage, fixture and verifiers-exist refusals, host and timeout selection, the
// run.json it writes, and land's --word. The launch-card offer, the no and yes
// front-door passes, and the fixture run's clean score need a hand pass or a
// live session, so they stay hand-verified and out of this file: the passes ran
// during implementation, one live headless session covered the make-to-land
// wiring, and the transcripts sit in the run record. Every case drives git or
// scripts/run as a subprocess.
import { afterAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RUN, commitAll, gitOrThrow, writeRepoFile } from "./acceptance-323.ts";
import {
  cleanup,
  cleanupTemplate,
  freshApp,
  handoverDoc,
  handoverEntry,
  headOf,
  makeDispatch,
  parentsOf,
  plantBranch,
  runLand,
  verifierFiles,
  writeHandover,
  writeProof,
  HELPER_GOOD,
} from "./acceptance-325.ts";
import {
  fakeTmuxDir,
  lineValue,
  markFixture,
  noCommitRepo,
  scratchRepo,
  writeMinimalConfig,
} from "./acceptance-326.ts";
import { run } from "./lib/proc.ts";

afterAll(cleanupTemplate);

function discover(repo: string): { code: number; out: string; err: string } {
  const r = run(RUN, ["discover-project", repo]);
  if (r.code !== 0) throw new Error(`discover-project exited ${r.code}: ${r.err.trim()}`);
  return r;
}

describe("C1 and C2: discover-project names the surfaces to offer", () => {
  test("bin names the command line", () => {
    const { dir, repo } = scratchRepo("bin");
    try {
      expect(lineValue(discover(repo).out, "surfaces")).toBe("cli");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a vite dependency names web pages", () => {
    const { dir, repo } = scratchRepo("vite");
    try {
      expect(lineValue(discover(repo).out, "surfaces")).toBe("web");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("bin and vite name both", () => {
    const { dir, repo } = scratchRepo("bin-vite");
    try {
      expect(lineValue(discover(repo).out, "surfaces")).toBe("cli,web");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("exports names the library interface", () => {
    const { dir, repo } = scratchRepo("exports");
    try {
      expect(lineValue(discover(repo).out, "surfaces")).toBe("library");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a Makefile-only repo names nothing", () => {
    const { dir, repo } = scratchRepo("makefile");
    try {
      expect(lineValue(discover(repo).out, "surfaces")).toBe("");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a project that declares its checks still names discovery's surfaces", () => {
    const { dir, repo } = scratchRepo("bin");
    try {
      writeRepoFile(
        repo,
        ".postmaster/project.toml",
        '[checks.gate]\ncommand = "true"\nshows = "nothing"\n',
      );
      commitAll(repo, "declare checks");
      const r = discover(repo);
      expect(lineValue(r.out, "surfaces")).toBe("cli");
      expect(lineValue(r.out, "check.gate")).toBe("declared: nothing");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("criterion 1: discover-project reports the verifiers a project holds", () => {
  test("no verifier folder reports empty", () => {
    const { dir, repo } = scratchRepo("bin");
    try {
      expect(lineValue(discover(repo).out, "verifiers")).toBe("");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a verifier folder reports its name", () => {
    const { dir, repo } = scratchRepo("bin");
    try {
      writeRepoFile(repo, "verifier/README.md", "# verifiers\n");
      commitAll(repo, "verifiers");
      expect(lineValue(discover(repo).out, "verifiers")).toBe("verifier");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a single-surface folder reports its name", () => {
    const { dir, repo } = scratchRepo("bin");
    try {
      writeRepoFile(repo, "verify-app/README.md", "# verifier\n");
      commitAll(repo, "verifier");
      expect(lineValue(discover(repo).out, "verifiers")).toBe("verify-app");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("C5: a fixture copy is offered nothing", () => {
  test("a marked copy names no surfaces", () => {
    const { dir, repo } = scratchRepo("bin-vite");
    try {
      markFixture(repo);
      expect(lineValue(discover(repo).out, "surfaces")).toBe("");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a marked copy still reports the verifiers it holds", () => {
    const { dir, repo } = scratchRepo("bin");
    try {
      writeRepoFile(repo, "verifier/README.md", "# verifiers\n");
      commitAll(repo, "verifiers");
      markFixture(repo);
      const r = discover(repo);
      expect(lineValue(r.out, "surfaces")).toBe("");
      expect(lineValue(r.out, "verifiers")).toBe("verifier");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a copy with only the committed marker names no surfaces", () => {
    const { dir, repo } = scratchRepo("bin-vite");
    try {
      writeRepoFile(repo, ".postmaster/fixture", "postmaster fixture v1\n");
      commitAll(repo, "fixture marker");
      expect(lineValue(discover(repo).out, "surfaces")).toBe("");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("setup-verifiers usage", () => {
  test("no arguments exits 2 and prints usage", () => {
    const r = run(RUN, ["setup-verifiers"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("usage: run setup-verifiers <repo> <surface>... --run <dispatch>");
  });

  test("a repo with no surface exits 2", () => {
    const { dir, repo } = scratchRepo("bin");
    try {
      const dispatch = mkdtempSync(join(dir, "dispatch-"));
      const r = run(RUN, ["setup-verifiers", repo, "--run", dispatch]);
      expect(r.code).toBe(2);
      expect(r.err).toContain("usage: run setup-verifiers");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an unknown surface exits 2 and names it", () => {
    const { dir, repo } = scratchRepo("bin");
    try {
      const dispatch = mkdtempSync(join(dir, "dispatch-"));
      const r = run(RUN, ["setup-verifiers", repo, "cli", "telegraph", "--run", dispatch]);
      expect(r.code).toBe(2);
      expect(r.err).toContain("unknown surface: telegraph");
      expect(existsSync(join(dispatch, "run.json"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("no --run exits 2 and prints usage", () => {
    const { dir, repo } = scratchRepo("bin");
    try {
      const r = run(RUN, ["setup-verifiers", repo, "cli"]);
      expect(r.code).toBe(2);
      expect(r.err).toContain("usage: run setup-verifiers");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a path that is not a git repository exits 2", () => {
    const dir = mkdtempSync(join(tmpdir(), "acceptance-326-"));
    try {
      const dispatch = mkdtempSync(join(dir, "dispatch-"));
      const r = run(RUN, ["setup-verifiers", dir, "cli", "--run", dispatch]);
      expect(r.code).toBe(2);
      expect(r.err).toContain("not a git repository");
      expect(existsSync(join(dispatch, "run.json"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a subdirectory of the repo exits 2", () => {
    const { dir, repo } = scratchRepo("bin");
    try {
      writeRepoFile(repo, "sub/note.txt", "note\n");
      commitAll(repo, "subdir");
      const dispatch = mkdtempSync(join(dir, "dispatch-"));
      const r = run(RUN, ["setup-verifiers", join(repo, "sub"), "cli", "--run", dispatch]);
      expect(r.code).toBe(2);
      expect(r.err).toContain("not the top of its repository");
      expect(existsSync(join(dispatch, "run.json"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a fixture copy exits 2, writing nothing and cutting nothing", () => {
    const { dir, repo } = scratchRepo("bin");
    try {
      markFixture(repo);
      const dispatch = mkdtempSync(join(dir, "dispatch-"));
      const r = run(RUN, ["setup-verifiers", repo, "cli", "--run", dispatch]);
      expect(r.code).toBe(2);
      expect(r.err).toContain("fixture copy");
      expect(existsSync(join(dispatch, "run.json"))).toBe(false);
      expect(gitOrThrow(repo, "branch", "--list", "verify-*").trim()).toBe("");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a project holding verifiers exits 2 and writes nothing", () => {
    const { dir, repo } = scratchRepo("bin");
    try {
      writeRepoFile(repo, "verifier/README.md", "# verifiers\n");
      commitAll(repo, "verifiers");
      const dispatch = mkdtempSync(join(dir, "dispatch-"));
      const r = run(RUN, ["setup-verifiers", repo, "cli", "--run", dispatch]);
      expect(r.code).toBe(2);
      expect(r.err).toContain("already holds verifiers: verifier");
      expect(existsSync(join(dispatch, "run.json"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a target off its default branch exits 2 naming the branch", () => {
    const { dir, repo } = scratchRepo("bin");
    try {
      gitOrThrow(repo, "checkout", "-b", "feature");
      const dispatch = mkdtempSync(join(dir, "dispatch-"));
      const config = writeMinimalConfig(dir);
      const r = run(RUN, ["setup-verifiers", repo, "cli", "--run", dispatch], {
        env: { POSTMASTER_HOST: "none", POSTMASTER_CONFIG: config },
      });
      expect(r.code).toBe(2);
      expect(r.err).toContain("is on feature, not main");
      expect(existsSync(join(dispatch, "run.json"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("D5 and D6: the wait follows the host", () => {
  test("with no host the timeout is an hour for each surface offered", () => {
    const { dir, repo } = noCommitRepo();
    try {
      const dispatch = mkdtempSync(join(dir, "dispatch-"));
      const config = writeMinimalConfig(dir);
      const r = run(RUN, ["setup-verifiers", repo, "cli", "web", "--run", dispatch], {
        env: { POSTMASTER_HOST: "none", POSTMASTER_CONFIG: config },
      });
      expect(r.code).toBe(2);
      expect(r.err).toContain("no commit to cut from");
      expect(r.out).toContain("host none");
      expect(r.out).toContain("timeout 7200");
      expect(r.out).toContain("kinds cli,web");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("names of one surface count once", () => {
    const { dir, repo } = noCommitRepo();
    try {
      const dispatch = mkdtempSync(join(dir, "dispatch-"));
      const config = writeMinimalConfig(dir);
      const r = run(
        RUN,
        [
          "setup-verifiers",
          repo,
          "cli-examples",
          "browser-suite",
          "web-journey",
          "--run",
          dispatch,
        ],
        { env: { POSTMASTER_HOST: "none", POSTMASTER_CONFIG: config } },
      );
      expect(r.code).toBe(2);
      expect(r.out).toContain("timeout 7200");
      expect(r.out).toContain("kinds cli,web");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a comma-joined surfaces value counts its surfaces", () => {
    const { dir, repo } = noCommitRepo();
    try {
      const dispatch = mkdtempSync(join(dir, "dispatch-"));
      const config = writeMinimalConfig(dir);
      const r = run(RUN, ["setup-verifiers", repo, "cli,web", "--run", dispatch], {
        env: { POSTMASTER_HOST: "none", POSTMASTER_CONFIG: config },
      });
      expect(r.code).toBe(2);
      expect(r.err).toContain("no commit to cut from");
      expect(r.out).toContain("timeout 7200");
      expect(r.out).toContain("kinds cli,web");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("with a host the session waits without a limit", () => {
    const { dir, repo } = noCommitRepo();
    try {
      const dispatch = mkdtempSync(join(dir, "dispatch-"));
      const config = writeMinimalConfig(dir);
      const bin = fakeTmuxDir(dir);
      const r = run(RUN, ["setup-verifiers", repo, "cli", "--run", dispatch], {
        env: {
          POSTMASTER_HOST: "tmux",
          POSTMASTER_CONFIG: config,
          PATH: `${bin}:${process.env.PATH ?? ""}`,
        },
      });
      expect(r.code).toBe(2);
      expect(r.err).toContain("no commit to cut from");
      expect(r.out).toContain("host tmux");
      expect(r.out).toContain("timeout 0");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the dispatch records the config the setup acted on", () => {
    const { dir, repo } = noCommitRepo();
    try {
      const dispatch = mkdtempSync(join(dir, "dispatch-"));
      const config = writeMinimalConfig(dir);
      const r = run(RUN, ["setup-verifiers", repo, "library", "--run", dispatch], {
        env: { POSTMASTER_HOST: "none", POSTMASTER_CONFIG: config },
      });
      expect(r.code).toBe(2);
      const stored = JSON.parse(readFileSync(join(dispatch, "run.json"), "utf8")) as Record<
        string,
        unknown
      >;
      const cfg = stored.config as Record<string, unknown>;
      const team = cfg.team as Record<string, unknown>;
      const coachman = team.coachman as Record<string, unknown>;
      expect(coachman.harness).toBe("muse");
      expect(typeof stored.written).toBe("string");
      expect(r.out).toContain("timeout 3600");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the dispatch logs the session before make runs", () => {
    const { dir, repo } = noCommitRepo();
    try {
      const dispatch = mkdtempSync(join(dir, "dispatch-"));
      const config = writeMinimalConfig(dir);
      const r = run(RUN, ["setup-verifiers", repo, "library", "--run", dispatch], {
        env: { POSTMASTER_HOST: "none", POSTMASTER_CONFIG: config },
      });
      expect(r.code).toBe(2);
      const actions = readFileSync(join(dispatch, "actions.jsonl"), "utf8");
      expect(actions).toContain("dispatching verifier session for kinds library");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the dispatch record absolutizes project-relative env files", () => {
    const { dir, repo } = noCommitRepo();
    try {
      writeRepoFile(repo, ".postmaster/settings.toml", '[team.coachman]\nenv_file = "coach.env"\n');
      const dispatch = mkdtempSync(join(dir, "dispatch-"));
      const config = writeMinimalConfig(dir);
      const r = run(RUN, ["setup-verifiers", repo, "library", "--run", dispatch], {
        env: { POSTMASTER_HOST: "none", POSTMASTER_CONFIG: config },
      });
      expect(r.code).toBe(2);
      const stored = JSON.parse(readFileSync(join(dispatch, "run.json"), "utf8")) as Record<
        string,
        unknown
      >;
      const cfg = stored.config as Record<string, unknown>;
      const team = cfg.team as Record<string, unknown>;
      const coachman = team.coachman as Record<string, unknown>;
      expect(coachman.env_file).toBe(join(realpathSync(repo), "coach.env"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("land --word: the launch-card yes is the merge word", () => {
  test("without the word a user-authority landing waits", () => {
    const { dir, repo } = freshApp();
    try {
      const proof = writeProof(dir, "proof-cli.log");
      const handover = writeHandover(
        dir,
        "HANDOVER.md",
        handoverDoc(handoverEntry("cli", "verify-app", proof)),
      );
      const dispatch = makeDispatch(dir, "user");
      plantBranch(repo, "verify-cli", verifierFiles("verify-app", HELPER_GOOD), "clean verifier");
      const before = headOf(repo, "main");
      const r = runLand(repo, "verify-cli", dispatch, handover, [
        "--folder",
        "verify-app",
        "--landing",
        "local",
      ]);
      expect(r.code).toBe(0);
      expect(r.out).toContain("waiting: verify-cli is ready to merge into main");
      expect(headOf(repo, "main")).toBe(before);
    } finally {
      cleanup(dir);
    }
  });

  test("with the word it merges on a setup dispatch", () => {
    const { dir, repo } = freshApp();
    try {
      const proof = writeProof(dir, "proof-cli.log");
      const handover = writeHandover(
        dir,
        "HANDOVER.md",
        handoverDoc(handoverEntry("cli", "verify-app", proof)),
      );
      const dispatch = makeDispatch(dir, "user");
      const record = JSON.parse(readFileSync(join(dispatch, "run.json"), "utf8")) as Record<
        string,
        unknown
      >;
      writeFileSync(
        join(dispatch, "run.json"),
        JSON.stringify({ ...record, kind: "setup-verifiers" }),
      );
      plantBranch(repo, "verify-cli", verifierFiles("verify-app", HELPER_GOOD), "clean verifier");
      const before = headOf(repo, "main");
      const r = runLand(repo, "verify-cli", dispatch, handover, [
        "--folder",
        "verify-app",
        "--landing",
        "local",
        "--word",
      ]);
      expect(r.code).toBe(0);
      expect(r.out).toContain("merge: verify-cli into main");
      expect(headOf(repo, "main")).not.toBe(before);
      expect(parentsOf(repo, "main")).toHaveLength(2);
    } finally {
      cleanup(dir);
    }
  });

  test("with the word on a ticket dispatch it waits", () => {
    const { dir, repo } = freshApp();
    try {
      const proof = writeProof(dir, "proof-cli.log");
      const handover = writeHandover(
        dir,
        "HANDOVER.md",
        handoverDoc(handoverEntry("cli", "verify-app", proof)),
      );
      const dispatch = makeDispatch(dir, "user");
      plantBranch(repo, "verify-cli", verifierFiles("verify-app", HELPER_GOOD), "clean verifier");
      const before = headOf(repo, "main");
      const r = runLand(repo, "verify-cli", dispatch, handover, [
        "--folder",
        "verify-app",
        "--landing",
        "local",
        "--word",
      ]);
      expect(r.code).toBe(0);
      expect(r.out).toContain("waiting: verify-cli is ready to merge into main");
      expect(headOf(repo, "main")).toBe(before);
    } finally {
      cleanup(dir);
    }
  });
});
