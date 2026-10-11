// Oracle for #477, committed before the change: making verifiers keeps one
// verifier per named surface in the project's .postmaster folder and leaves
// the repository as it was, unless the user asks for the repository. Every
// case drives git or scripts/run as a subprocess. C6, a fixture run from this
// branch scoring clean, needs a dispatched run and stays out of this file.
import { afterAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitOrThrow, PSTACK_SKILL, ROOT, sharedRuns } from "./acceptance-323.ts";
import {
  branchHasFile,
  cleanup,
  cleanupTemplate,
  freshApp,
  handoverDoc,
  handoverEntry,
  headOf,
  makeDispatch,
  plantBranch,
  runLand,
  verifierFiles,
  HELPER_GOOD,
  writeHandover,
  writeProof,
} from "./acceptance-325.ts";
import { noCommitRepo, scratchRepo, writeMinimalConfig } from "./acceptance-326.ts";
import {
  localWork,
  plantLocal,
  plainRepo,
  repoMultiWork,
  repoSingleWork,
  writeLocalStub,
  type LocalSurface,
} from "./acceptance-477.ts";
import {
  makeEnv,
  makeSandbox,
  RUN,
  summaryLine,
  writeStubSession,
  type Sandbox,
} from "./acceptance-344.ts";
import { run, type RunResult } from "./lib/proc.ts";

afterAll(() => {
  cleanupTemplate();
});

/** Assert a driven command's exit code, quoting its stderr when it differs. */
function expectCode(r: RunResult, code: number): void {
  if (r.code !== code) {
    throw new Error(`exited ${r.code}, expected ${code}: ${(r.err || r.out).trim()}`);
  }
}

const CLI: LocalSurface = { seg: "cli", prose: "command line", name: "cli" };
const WEB: LocalSurface = { seg: "web", prose: "web pages", name: "web" };
const ADMIN: LocalSurface = { seg: "admin", prose: "web pages", name: "web:admin" };
const SHOP: LocalSurface = { seg: "shop", prose: "web pages", name: "web:shop" };
const API: LocalSurface = { seg: "api", prose: "backend service", name: "backend:api" };

function localMake(sandbox: Sandbox, surfaces: string[], work: string[]): RunResult {
  writeLocalStub(sandbox.bin, work.join("\n"));
  return run(RUN, ["verifier", "make", sandbox.repo, ...surfaces, "--run", sandbox.dispatch], {
    env: makeEnv(sandbox, { POSTMASTER_HOST: "none" }),
  });
}

describe("C1: making verifiers keeps the proven ones in the .postmaster folder", () => {
  test("verifier make keeps the proven verifier and drops the unproven one", () => {
    const sandbox = makeSandbox();
    try {
      const r = localMake(sandbox, ["cli"], localWork([CLI], [WEB]));
      expectCode(r, 0);
      expect(r.out).toContain("kept .postmaster/verifier");
      expect(r.out).toContain("left out: web (no proof file)");
      const kept = join(sandbox.repo, ".postmaster", "verifier");
      expect(existsSync(join(kept, "README.md"))).toBe(true);
      expect(existsSync(join(kept, "cli", "README.md"))).toBe(true);
      expect(existsSync(join(kept, "cli", "features", "README.md"))).toBe(true);
      for (const page of ["f1.md", "f2.md", "f3.md"]) {
        expect(existsSync(join(kept, "cli", "features", page))).toBe(true);
      }
      expect(existsSync(join(kept, "web"))).toBe(false);
      const index = readFileSync(join(kept, "README.md"), "utf8");
      expect(index).toContain("command line");
      expect(index).toContain(".postmaster/verifier/cli/");
      const handover = summaryLine(r.out, "handover");
      expect(handover).not.toBe("");
      expect(existsSync(handover)).toBe(true);
      expect(handover.startsWith(sandbox.dispatch)).toBe(true);
      expect(gitOrThrow(sandbox.repo, "branch", "--list", "verify-*").trim()).toBe("");
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });

  test("setup-verifiers keeps them too, with no land", () => {
    const sandbox = makeSandbox();
    try {
      // The stub takes the config's harness name: setup runs on the
      // effective config, whose coachman is muse, not the sandbox's claude.
      writeLocalStub(sandbox.bin, localWork([CLI], []).join("\n"), "muse");
      const config = writeMinimalConfig(sandbox.dir);
      const r = run(RUN, ["setup-verifiers", sandbox.repo, "cli", "--run", sandbox.dispatch], {
        env: makeEnv(sandbox, { POSTMASTER_HOST: "none", POSTMASTER_CONFIG: config }),
      });
      expectCode(r, 0);
      expect(r.out).toContain("kept: .postmaster/verifier");
      expect(r.out).not.toContain("landed:");
      expect(existsSync(join(sandbox.repo, ".postmaster", "verifier", "cli", "README.md"))).toBe(
        true,
      );
      const actions = readFileSync(join(sandbox.dispatch, "actions.jsonl"), "utf8");
      expect(actions).toContain("kept .postmaster/verifier");
      expect(gitOrThrow(sandbox.repo, "branch", "--list", "verify-*").trim()).toBe("");
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });

  test("an index naming a dropped verifier fails, keeping nothing", () => {
    const sandbox = makeSandbox();
    try {
      const r = localMake(sandbox, ["cli", "web"], localWork([CLI], [WEB], [WEB]));
      expectCode(r, 1);
      expect(r.err).toMatch(/no proof/iu);
      expect(existsSync(join(sandbox.repo, ".postmaster", "verifier"))).toBe(false);
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });

  test("a held destination refuses before any session starts", () => {
    const sandbox = makeSandbox();
    try {
      plantLocal(sandbox.repo, [CLI]);
      // No stub session: the refusal must land before the launch.
      const r = run(RUN, ["verifier", "make", sandbox.repo, "cli", "--run", sandbox.dispatch]);
      expectCode(r, 2);
      expect(r.err).toContain("already holds .postmaster/verifier");
      expect(existsSync(join(sandbox.dir, "app-verify-cli"))).toBe(false);
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });

  test("a session proving nothing keeps nothing and fails", () => {
    const sandbox = makeSandbox();
    try {
      const r = localMake(sandbox, ["cli"], localWork([], [CLI]));
      expectCode(r, 1);
      expect(r.err).toMatch(/proved no verifier/iu);
      expect(existsSync(join(sandbox.repo, ".postmaster", "verifier"))).toBe(false);
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });
});

describe("C2: the repository shows nothing new", () => {
  function repoState(repo: string): string {
    return [
      gitOrThrow(repo, "for-each-ref"),
      gitOrThrow(repo, "log", "--all", "--oneline"),
      gitOrThrow(repo, "worktree", "list"),
      gitOrThrow(repo, "stash", "list"),
    ].join("\n---\n");
  }

  test("refs, log, worktrees and stashes read the same before and after", () => {
    const sandbox = makeSandbox();
    try {
      const before = repoState(sandbox.repo);
      const r = localMake(sandbox, ["cli"], localWork([CLI], []));
      expectCode(r, 0);
      expect(repoState(sandbox.repo)).toBe(before);
      const clean = run(RUN, ["check-target", sandbox.repo]);
      expectCode(clean, 0);
      expect(gitOrThrow(sandbox.repo, "status", "--porcelain").trim()).toBe("");
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });

  test("a bare origin's refs read the same before and after", () => {
    const sandbox = makeSandbox();
    const bare = mkdtempSync(join(tmpdir(), "acceptance-477-bare-"));
    try {
      gitOrThrow(bare, "init", "-q", "--bare", bare);
      gitOrThrow(sandbox.repo, "remote", "add", "origin", bare);
      gitOrThrow(sandbox.repo, "push", "-q", "origin", "main");
      const before = run("git", ["--git-dir", bare, "for-each-ref"]).out;
      const r = localMake(sandbox, ["cli"], localWork([CLI], []));
      expectCode(r, 0);
      expect(run("git", ["--git-dir", bare, "for-each-ref"]).out).toBe(before);
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
      rmSync(bare, { recursive: true, force: true });
    }
  });

  test("a hand-planted verifier folder reads clean once the folder's rules ensure it", () => {
    const { dir, repo } = plainRepo();
    try {
      plantLocal(repo, [CLI]);
      const ensured = run(RUN, ["project-settings", "ensure", repo]);
      expectCode(ensured, 0);
      const clean = run(RUN, ["check-target", repo]);
      expectCode(clean, 0);
      expect(gitOrThrow(repo, "status", "--porcelain").trim()).toBe("");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("C3: one verifier for each surface the user names", () => {
  test("make keeps three folders and an index naming all three", () => {
    const sandbox = makeSandbox();
    try {
      const surfaces = [ADMIN, SHOP, API];
      const r = localMake(
        sandbox,
        ["web:admin", "web:shop", "backend:api"],
        localWork(surfaces, []),
      );
      expectCode(r, 0);
      const kept = join(sandbox.repo, ".postmaster", "verifier");
      for (const s of surfaces) {
        expect(existsSync(join(kept, s.seg, "README.md"))).toBe(true);
        for (const page of ["f1.md", "f2.md", "f3.md"]) {
          expect(existsSync(join(kept, s.seg, "features", page))).toBe(true);
        }
      }
      const index = readFileSync(join(kept, "README.md"), "utf8");
      for (const s of surfaces) {
        expect(index).toContain(s.prose);
        expect(index).toContain(`.postmaster/verifier/${s.seg}/`);
      }
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });

  test("prompt renders one section per surface, each naming its own folder", () => {
    const { dir, repo } = plainRepo();
    try {
      const r = run(RUN, ["verifier", "prompt", repo, "web:admin", "web:shop", "backend:api"]);
      expectCode(r, 0);
      for (const n of [1, 2, 3]) expect(r.out).toContain(`Verifier ${n} of 3`);
      for (const label of ["web:admin", "web:shop", "backend:api"]) {
        expect(r.out).toContain(label);
      }
      for (const seg of ["admin", "shop", "api"]) {
        expect(r.out).toContain(`verifier/${seg}/`);
      }
      expect(r.out).toMatch(/drive .* through the requests it answers/iu);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a backend without a name, a bad name and a shared folder fail", () => {
    const { dir, repo } = plainRepo();
    try {
      const bare = run(RUN, ["verifier", "prompt", repo, "backend"]);
      expectCode(bare, 2);
      expect(bare.err).toContain("backend takes a name, as backend:api");
      const bad = run(RUN, ["verifier", "prompt", repo, "web:Admin"]);
      expectCode(bad, 2);
      expect(bad.err).toContain("bad surface name");
      const reserved = run(RUN, ["verifier", "prompt", repo, "web:cli"]);
      expectCode(reserved, 2);
      expect(reserved.err).toContain("is a surface kind");
      const shared = run(RUN, ["verifier", "prompt", repo, "web:admin", "cli:admin"]);
      expectCode(shared, 2);
      expect(shared.err).toContain("share a folder");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("setup-verifiers takes the same names, an hour per surface", () => {
    const { dir, repo } = noCommitRepo();
    try {
      const dispatch = mkdtempSync(join(dir, "dispatch-"));
      const config = writeMinimalConfig(dir);
      const r = run(
        RUN,
        ["setup-verifiers", repo, "web:admin", "web:shop", "backend:api", "--run", dispatch],
        { env: { POSTMASTER_HOST: "none", POSTMASTER_CONFIG: config } },
      );
      expectCode(r, 2);
      expect(r.err).toContain("no commit to cut from");
      expect(r.out).toContain("surfaces web:admin,web:shop,backend:api");
      expect(r.out).toContain("kinds web,backend");
      expect(r.out).toContain("timeout 10800");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the backend rendering copies no eight-word run of pstack's skill", () => {
    const { dir, repo } = plainRepo();
    try {
      const r = run(RUN, ["verifier", "prompt", repo, "backend:api"]);
      expectCode(r, 0);
      const skill = readFileSync(PSTACK_SKILL, "utf8");
      const shared = sharedRuns(r.out, skill, 8);
      if (shared.length > 0) {
        throw new Error(`shared runs:\n${shared.slice(0, 3).join("\n")}`);
      }
      expect(shared).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("list names the backend's surface", () => {
    const { dir, repo } = plainRepo();
    try {
      plantLocal(repo, [API]);
      const r = run(RUN, ["verifier", "list", repo]);
      expectCode(r, 0);
      expect(r.out).toContain("verifier: .postmaster/verifier/api");
      expect(r.out).toContain("surface: backend service");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the launch card proposes discovery's surfaces and lets the user name, add or drop them", () => {
    const skill = readFileSync(join(ROOT, "skills", "postmaster", "SKILL.md"), "utf8");
    expect(skill).toContain("proposes the discovery's surfaces=");
    expect(skill).toContain("adding or dropping");
    expect(skill).toContain("kind:name");
    expect(skill).toContain("kept in the project's .postmaster folder unless the user asks");
  });
});

describe("C4: the readers name local verifiers", () => {
  test("list prints the local index and the verifier block", () => {
    const { dir, repo } = plainRepo();
    try {
      plantLocal(repo, [CLI]);
      const r = run(RUN, ["verifier", "list", repo]);
      expectCode(r, 0);
      expect(r.out).toContain("index: .postmaster/verifier/README.md");
      expect(r.out).toContain("verifier: .postmaster/verifier/cli");
      expect(r.out).toContain("surface: command line");
      expect(r.out).toContain(
        "features: .postmaster/verifier/cli/features/f1.md " +
          ".postmaster/verifier/cli/features/f2.md .postmaster/verifier/cli/features/f3.md",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the clerk's brief prints the local listing", () => {
    const { dir, repo } = plainRepo();
    try {
      plantLocal(repo, [CLI]);
      const init = run(RUN, ["local", repo, "store", "init"]);
      expectCode(init, 0);
      const body = join(dir, "body.md");
      writeFileSync(body, "A body.\n");
      const created = run(RUN, ["local", repo, "create", "Fix the list", body]);
      expectCode(created, 0);
      const id = created.out.trim();
      const cfg = writeMinimalConfig(dir);
      const r = run(RUN, ["clerk", "brief", repo, id], { env: { POSTMASTER_CONFIG: cfg } });
      expectCode(r, 0);
      const brief = readFileSync(join(repo, ".postmaster", "clerk", `${id}.brief.md`), "utf8");
      expect(brief).toContain("verifier: .postmaster/verifier/cli");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("discovery ends docs with the local index and names the folder", () => {
    const { dir, repo } = plainRepo();
    try {
      plantLocal(repo, [CLI]);
      const r = run(RUN, ["discover-project", repo]);
      expectCode(r, 0);
      const docs = r.out.split("\n").find((l) => l.startsWith("docs=")) ?? "";
      expect(docs.endsWith(".postmaster/verifier/README.md")).toBe(true);
      const verifiers = r.out.split("\n").find((l) => l.startsWith("verifiers=")) ?? "";
      expect(verifiers).toContain(".postmaster/verifier");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("setup-verifiers refuses a project already holding local verifiers", () => {
    const { dir, repo } = scratchRepo("bin");
    try {
      plantLocal(repo, [CLI]);
      const dispatch = mkdtempSync(join(dir, "dispatch-"));
      const r = run(RUN, ["setup-verifiers", repo, "cli", "--run", dispatch]);
      expectCode(r, 2);
      expect(r.err).toContain("already holds verifiers");
      expect(existsSync(join(dispatch, "run.json"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("C5: with the word, the repository route works as today", () => {
  test("make --repository cuts the branch with the session's commit", () => {
    const sandbox = makeSandbox();
    try {
      writeStubSession(sandbox.bin);
      const r = run(
        RUN,
        ["verifier", "make", sandbox.repo, "cli", "--run", sandbox.dispatch, "--repository"],
        { env: makeEnv(sandbox, { POSTMASTER_HOST: "none" }) },
      );
      expectCode(r, 0);
      expect(r.out).toContain("branch verify-cli");
      const log = gitOrThrow(sandbox.repo, "log", "verify-cli", "--oneline").trim();
      expect(log).toContain("stub");
      const tree = gitOrThrow(sandbox.repo, "ls-tree", "-r", "--name-only", "verify-cli").trim();
      expect(tree).toContain("verify-app/README.md");
      const promptFile = summaryLine(r.out, "prompt");
      expect(readFileSync(promptFile, "utf8")).toContain("Commit the verifier on this branch.");
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });

  test("land merges the branch as today", () => {
    const { dir, repo } = freshApp();
    try {
      const proof = writeProof(dir, "proof-cli.log");
      const handover = writeHandover(
        dir,
        "HANDOVER.md",
        handoverDoc(handoverEntry("cli", "verify-app", proof)),
      );
      const dispatch = makeDispatch(dir, "postmaster");
      plantBranch(repo, "verify-cli", verifierFiles("verify-app", HELPER_GOOD), "clean verifier");
      const before = headOf(repo, "main");
      const r = runLand(repo, "verify-cli", dispatch, handover, ["--landing", "local"]);
      expectCode(r, 0);
      expect(r.out).toContain("merge: verify-cli into main");
      expect(headOf(repo, "main")).not.toBe(before);
      expect(branchHasFile(repo, "main", "verify-app/README.md")).toBe(true);
    } finally {
      cleanup(dir);
    }
  });

  test("make --repository with three surfaces holds one folder per surface", () => {
    const sandbox = makeSandbox();
    try {
      const surfaces = [ADMIN, SHOP, API];
      writeLocalStub(sandbox.bin, repoMultiWork(surfaces).join("\n"));
      const r = run(
        RUN,
        [
          "verifier",
          "make",
          sandbox.repo,
          "web:admin",
          "web:shop",
          "backend:api",
          "--run",
          sandbox.dispatch,
          "--repository",
        ],
        { env: makeEnv(sandbox, { POSTMASTER_HOST: "none" }) },
      );
      expectCode(r, 0);
      const branch = summaryLine(r.out, "branch");
      expect(branch).not.toBe("");
      const tree = gitOrThrow(sandbox.repo, "ls-tree", "-r", "--name-only", branch).trim();
      for (const s of surfaces) {
        expect(tree).toContain(`verifier/${s.seg}/README.md`);
      }
      expect(tree).toContain("verifier/README.md");
    } finally {
      rmSync(sandbox.dir, { recursive: true, force: true });
    }
  });

  test("setup-verifiers --repository lands the branch", () => {
    const { dir, repo } = freshApp();
    try {
      const bin = join(dir, "bin");
      mkdirSync(bin, { recursive: true });
      writeLocalStub(bin, repoSingleWork(CLI).join("\n"), "muse");
      const dispatch = mkdtempSync(join(dir, "dispatch-"));
      const config = writeMinimalConfig(dir);
      const before = headOf(repo, "main");
      const r = run(RUN, ["setup-verifiers", repo, "cli", "--run", dispatch, "--repository"], {
        env: {
          PATH: `${bin}:${process.env.PATH ?? ""}`,
          POSTMASTER_HOST: "none",
          POSTMASTER_CONFIG: config,
          ORACLE_ROOT: realpathSync(dir),
        },
      });
      expectCode(r, 0);
      expect(r.out).toContain("landed:");
      expect(headOf(repo, "main")).not.toBe(before);
      expect(branchHasFile(repo, "main", "verify-app/README.md")).toBe(true);
    } finally {
      cleanup(dir);
    }
  });
});
