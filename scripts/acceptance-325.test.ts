// Oracle for #325, committed before the change: a project's verifiers land only when
// they pass its checks. Every case plants branches of the scratch app (a copy of
// fixtures/app) and drives git or scripts/run as subprocesses.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitAll, gitOrThrow, writeRepoFile } from "./acceptance-323.ts";
import {
  bareOrigin,
  branchHasFile,
  checksDirExists,
  cleanup,
  cleanupTemplate,
  freshApp,
  gateLogOf,
  HELPER_BAD,
  HELPER_GOOD,
  handoverDoc,
  handoverEntry,
  headOf,
  makeDispatch,
  PR_URL,
  parentsOf,
  plantBranch,
  pointOriginHead,
  RUN,
  readActions,
  runCheck,
  runLand,
  sleepRepo,
  stubFailingGh,
  stubGh,
  suitelessRepo,
  templateApp,
  verifierFiles,
  withBinOnPath,
  writeHandover,
  writeProof,
} from "./acceptance-325.ts";
import { run } from "./lib/proc.ts";

afterAll(() => {
  cleanupTemplate();
});

function goodHandover(dir: string, proof: string): string {
  return writeHandover(dir, "HANDOVER.md", handoverDoc(handoverEntry("cli", "verify-app", proof)));
}

describe("C1: the project's checks decide", () => {
  test("sanity: the scratch app template passes its own gate", () => {
    const gate = run("npm", ["run", "check"], { cwd: templateApp() });
    expect(gate.code).toBe(0);
  });

  test("a branch whose helper fails the format check is refused", () => {
    const { dir, repo } = freshApp();
    try {
      const proof = writeProof(dir, "proof-cli.log");
      const handover = goodHandover(dir, proof);
      const dispatch = makeDispatch(dir, "postmaster");
      plantBranch(repo, "verify-cli", verifierFiles("verify-app", HELPER_BAD), "rough helper");
      const r = runCheck(repo, "verify-cli", dispatch, handover);
      expect(r.code).toBe(1);
      expect(r.out).toBe("refuse: verify-cli lands nothing: checks failed (gate: fail)\n");
      const log = gateLogOf(dispatch);
      expect(log).toContain("verify-app/helper.ts");
      expect(log).toMatch(/format/iu);
      expect(branchHasFile(repo, "main", "verify-app/README.md")).toBe(false);
    } finally {
      cleanup(dir);
    }
  });

  test("a branch touching only the folder, gate green, is accepted", () => {
    const { dir, repo } = freshApp();
    try {
      const proof = writeProof(dir, "proof-cli.log");
      const handover = goodHandover(dir, proof);
      const dispatch = makeDispatch(dir, "postmaster");
      plantBranch(repo, "verify-cli", verifierFiles("verify-app", HELPER_GOOD), "clean verifier");
      const r = runCheck(repo, "verify-cli", dispatch, handover);
      const want =
        `accept: verify-cli lands 1 verifier: cli (verify-app, proof ${proof}); ` +
        "left out: none";
      expect(r.code).toBe(0);
      expect(r.out).toBe(`${want}\n`);
      const actions = readActions(dispatch);
      expect(actions).toHaveLength(1);
      expect(actions[0]?.action).toBe("note");
      expect(actions[0]?.target).toBe("verify-cli");
      expect(actions[0]?.detail).toBe(want);
    } finally {
      cleanup(dir);
    }
  });
});

describe("C2: nothing outside the folder changes", () => {
  const cases: Array<{ file: string; change: (text: string) => string }> = [
    {
      file: "biome.json",
      change: (t) => t.replace('"indentWidth": 2', '"indentWidth": 4'),
    },
    { file: ".gitignore", change: (t) => `${t}scratch/\n` },
    { file: "AGENTS.md", change: (t) => `${t}\nExtra line.\n` },
    { file: "src/cli.ts", change: (t) => `${t}\n// scratch\n` },
  ];

  for (const { file, change } of cases) {
    test(`a branch changing ${file} is refused, naming it`, () => {
      const { dir, repo } = freshApp();
      try {
        const proof = writeProof(dir, "proof-cli.log");
        const handover = goodHandover(dir, proof);
        const dispatch = makeDispatch(dir, "postmaster");
        const before = readFileSync(join(repo, file), "utf8");
        const after = change(before);
        expect(after).not.toBe(before);
        plantBranch(
          repo,
          "verify-cli",
          { ...verifierFiles("verify-app", HELPER_GOOD), [file]: after },
          `verifier plus ${file}`,
        );
        const r = runCheck(repo, "verify-cli", dispatch, handover);
        expect(r.code).toBe(1);
        expect(r.out).toBe(
          `refuse: verify-cli lands nothing: outside the verifiers' folder: ${file}\n`,
        );
        expect(checksDirExists(dispatch)).toBe(false);
      } finally {
        cleanup(dir);
      }
    });
  }

  test("a rename from outside the folder into it is refused, naming the source", () => {
    const { dir, repo } = freshApp();
    try {
      const proof = writeProof(dir, "proof-cli.log");
      const handover = goodHandover(dir, proof);
      const dispatch = makeDispatch(dir, "postmaster");
      plantBranch(repo, "verify-cli", verifierFiles("verify-app", HELPER_GOOD), "clean verifier");
      gitOrThrow(repo, "checkout", "-q", "verify-cli");
      gitOrThrow(repo, "mv", "src/cli.ts", "verify-app/moved-cli.ts");
      commitAll(repo, "move the cli into the folder");
      gitOrThrow(repo, "checkout", "-q", "main");
      const r = runCheck(repo, "verify-cli", dispatch, handover);
      expect(r.code).toBe(1);
      expect(r.out).toBe(
        "refuse: verify-cli lands nothing: outside the verifiers' folder: src/cli.ts\n",
      );
      expect(checksDirExists(dispatch)).toBe(false);
    } finally {
      cleanup(dir);
    }
  });
});

describe("C3: one change, by the project's route", () => {
  test("local land with merge authority postmaster merges once with --no-ff", () => {
    const { dir, repo } = freshApp();
    try {
      const proof = writeProof(dir, "proof-cli.log");
      const handover = goodHandover(dir, proof);
      const dispatch = makeDispatch(dir, "postmaster");
      plantBranch(repo, "verify-cli", verifierFiles("verify-app", HELPER_GOOD), "clean verifier");
      const before = headOf(repo, "main");
      const r = runLand(repo, "verify-cli", dispatch, handover, ["--landing", "local"]);
      const want =
        `accept: verify-cli lands 1 verifier: cli (verify-app, proof ${proof}); ` +
        "left out: none";
      expect(r.code).toBe(0);
      const after = headOf(repo, "main");
      expect(after).not.toBe(before);
      const short = gitOrThrow(repo, "rev-parse", "--short", after).trim();
      expect(r.out).toBe(`${want}\nmerge: verify-cli into main (${short})\n`);
      expect(parentsOf(repo, "main")).toHaveLength(2);
      expect(gitOrThrow(repo, "log", "-1", "--format=%s", "main").trim()).toBe(
        "Merge branch 'verify-cli'",
      );
      expect(branchHasFile(repo, "main", "verify-app/README.md")).toBe(true);
      const actions = readActions(dispatch);
      expect(actions.map((a) => a.action)).toEqual(["note", "merge"]);
      expect(actions[0]?.detail).toBe(want);
      expect(actions[1]?.detail).toBe(`merge: verify-cli into main (${short})`);
    } finally {
      cleanup(dir);
    }
  });

  test("local land with merge authority user merges nothing until the word", () => {
    const { dir, repo } = freshApp();
    try {
      const proof = writeProof(dir, "proof-cli.log");
      const handover = goodHandover(dir, proof);
      const dispatch = makeDispatch(dir, "user");
      plantBranch(repo, "verify-cli", verifierFiles("verify-app", HELPER_GOOD), "clean verifier");
      const before = headOf(repo, "main");
      const r = runLand(repo, "verify-cli", dispatch, handover, ["--landing", "local"]);
      const want =
        `accept: verify-cli lands 1 verifier: cli (verify-app, proof ${proof}); ` +
        "left out: none";
      expect(r.code).toBe(0);
      expect(r.out).toBe(
        `${want}\nwaiting: verify-cli is ready to merge into main; ` +
          "waiting for the user's word\n",
      );
      expect(headOf(repo, "main")).toBe(before);
      expect(branchHasFile(repo, "main", "verify-app/README.md")).toBe(false);
      const actions = readActions(dispatch);
      expect(actions.map((a) => a.action)).toEqual(["note", "note"]);
      expect(actions[1]?.detail).toContain("waiting for the user's word");
    } finally {
      cleanup(dir);
    }
  });

  test("pull-request land pushes, opens one pull request, and waits for the merge word", () => {
    const { dir, repo } = freshApp();
    try {
      const bare = bareOrigin(dir);
      gitOrThrow(repo, "remote", "add", "origin", bare);
      const { bin, state } = stubGh(dir);
      const proof = writeProof(dir, "proof-cli.log");
      const handover = goodHandover(dir, proof);
      const dispatch = makeDispatch(dir, "postmaster");
      plantBranch(repo, "verify-cli", verifierFiles("verify-app", HELPER_GOOD), "clean verifier");
      const before = headOf(repo, "main");
      const r = runLand(
        repo,
        "verify-cli",
        dispatch,
        handover,
        ["--landing", "pull-request"],
        withBinOnPath(bin),
      );
      const want =
        `accept: verify-cli lands 1 verifier: cli (verify-app, proof ${proof}); ` +
        "left out: none";
      expect(r.code).toBe(0);
      expect(r.out).toBe(
        `${want}\npull-request: pushed verify-cli to origin and opened ${PR_URL} against main; ` +
          "waiting for the user's word that it merged\n",
      );
      expect(headOf(repo, "main")).toBe(before);
      expect(headOf(bare, "verify-cli")).toBe(headOf(repo, "verify-cli"));
      const args = readFileSync(join(state, "args"), "utf8");
      for (const word of ["pr", "create", "--base", "main", "--head", "verify-cli"]) {
        expect(args).toContain(word);
      }
      expect(args).toContain("--title");
      expect(args).toContain("--body");
      expect(readFileSync(join(state, "cwd"), "utf8").trim()).toBe(realpathSync(repo));
      const actions = readActions(dispatch);
      expect(actions.map((a) => a.action)).toEqual(["note", "note"]);
      expect(actions[1]?.detail).toContain(PR_URL);
    } finally {
      cleanup(dir);
    }
  });

  test("the route defaults to pull-request when the repo has an origin", () => {
    const { dir, repo } = freshApp();
    try {
      const bare = bareOrigin(dir);
      gitOrThrow(repo, "remote", "add", "origin", bare);
      const { bin } = stubGh(dir);
      const proof = writeProof(dir, "proof-cli.log");
      const handover = goodHandover(dir, proof);
      const dispatch = makeDispatch(dir, "postmaster");
      plantBranch(repo, "verify-cli", verifierFiles("verify-app", HELPER_GOOD), "clean verifier");
      const r = runLand(repo, "verify-cli", dispatch, handover, [], withBinOnPath(bin));
      expect(r.code).toBe(0);
      expect(r.out).toContain(`opened ${PR_URL} against main`);
      expect(headOf(bare, "verify-cli")).toBe(headOf(repo, "verify-cli"));
    } finally {
      cleanup(dir);
    }
  });

  test("the route defaults to local when the repo has no origin", () => {
    const { dir, repo } = freshApp();
    try {
      const proof = writeProof(dir, "proof-cli.log");
      const handover = goodHandover(dir, proof);
      const dispatch = makeDispatch(dir, "user");
      plantBranch(repo, "verify-cli", verifierFiles("verify-app", HELPER_GOOD), "clean verifier");
      const before = headOf(repo, "main");
      const r = runLand(repo, "verify-cli", dispatch, handover);
      expect(r.code).toBe(0);
      expect(r.out).toContain("waiting: verify-cli is ready to merge into main");
      expect(headOf(repo, "main")).toBe(before);
    } finally {
      cleanup(dir);
    }
  });

  test("local land follows origin's head, not a stale local main", () => {
    const { dir, repo } = freshApp();
    try {
      gitOrThrow(repo, "branch", "master");
      pointOriginHead(repo, "master");
      gitOrThrow(repo, "checkout", "-q", "master");
      const proof = writeProof(dir, "proof-cli.log");
      const handover = goodHandover(dir, proof);
      const dispatch = makeDispatch(dir, "postmaster");
      plantBranch(
        repo,
        "verify-cli",
        verifierFiles("verify-app", HELPER_GOOD),
        "clean verifier",
        "master",
      );
      const mainBefore = headOf(repo, "main");
      const r = runLand(repo, "verify-cli", dispatch, handover, ["--landing", "local"]);
      expect(r.code).toBe(0);
      expect(r.out.split("\n")[0]).toContain("accept: verify-cli lands 1 verifier");
      expect(r.out).toContain("merge: verify-cli into master");
      expect(parentsOf(repo, "master")).toContain(headOf(repo, "verify-cli"));
      expect(headOf(repo, "main")).toBe(mainBefore);
      expect(branchHasFile(repo, "master", "verify-app/README.md")).toBe(true);
    } finally {
      cleanup(dir);
    }
  });

  test("local land reaches a trunk default", () => {
    const { dir, repo } = freshApp();
    try {
      gitOrThrow(repo, "branch", "-m", "main", "trunk");
      pointOriginHead(repo, "trunk");
      const proof = writeProof(dir, "proof-cli.log");
      const handover = goodHandover(dir, proof);
      const dispatch = makeDispatch(dir, "postmaster");
      plantBranch(
        repo,
        "verify-cli",
        verifierFiles("verify-app", HELPER_GOOD),
        "clean verifier",
        "trunk",
      );
      const r = runLand(repo, "verify-cli", dispatch, handover, ["--landing", "local"]);
      expect(r.code).toBe(0);
      expect(r.out.split("\n")[0]).toContain("accept: verify-cli lands 1 verifier");
      expect(r.out).toContain("merge: verify-cli into trunk");
      expect(parentsOf(repo, "trunk")).toContain(headOf(repo, "verify-cli"));
    } finally {
      cleanup(dir);
    }
  });

  test("a failed pull request opening reports the push that landed", () => {
    const { dir, repo } = freshApp();
    try {
      const bare = bareOrigin(dir);
      gitOrThrow(repo, "remote", "add", "origin", bare);
      const { bin } = stubFailingGh(dir);
      const proof = writeProof(dir, "proof-cli.log");
      const handover = goodHandover(dir, proof);
      const dispatch = makeDispatch(dir, "postmaster");
      plantBranch(repo, "verify-cli", verifierFiles("verify-app", HELPER_GOOD), "clean verifier");
      const r = runLand(
        repo,
        "verify-cli",
        dispatch,
        handover,
        ["--landing", "pull-request"],
        withBinOnPath(bin),
      );
      expect(r.code).toBe(1);
      expect(r.out.split("\n")[0]).toContain("accept: verify-cli lands 1 verifier");
      expect(r.out).toContain(
        "error: pushed verify-cli to origin, but gh pr create failed: stub gh: pr create refused\n",
      );
      expect(headOf(bare, "verify-cli")).toBe(headOf(repo, "verify-cli"));
      const actions = readActions(dispatch);
      expect(actions.map((a) => a.action)).toEqual(["note", "note"]);
      expect(actions[1]?.detail).toContain("pushed verify-cli to origin");
    } finally {
      cleanup(dir);
    }
  });
});

describe("C4: a verifier that fails its proof is left out", () => {
  test("the failed verifier absent, the other lands and the user is told", () => {
    const { dir, repo } = freshApp();
    try {
      const proof = writeProof(dir, "proof-web.log");
      const handover = writeHandover(
        dir,
        "HANDOVER.md",
        handoverDoc(
          handoverEntry("cli", "verify-app/cli", "none - the drive never finished"),
          handoverEntry("web", "verify-app/web", proof),
        ),
      );
      const dispatch = makeDispatch(dir, "postmaster");
      plantBranch(
        repo,
        "verify-both",
        {
          ...verifierFiles("verify-app/web", HELPER_GOOD),
          "verify-app/README.md": "# verifiers\n",
        },
        "web verifier only",
      );
      const r = runLand(repo, "verify-both", dispatch, handover, ["--landing", "local"]);
      const want =
        `accept: verify-both lands 1 verifier: web (verify-app/web, proof ${proof}); ` +
        "left out: cli (no proof file)";
      expect(r.code).toBe(0);
      expect(r.out.split("\n")[0]).toBe(want);
      expect(r.out.split("\n")[1]).toMatch(/^merge: verify-both into main \([0-9a-f]+\)$/u);
      expect(branchHasFile(repo, "main", "verify-app/web/README.md")).toBe(true);
      expect(branchHasFile(repo, "main", "verify-app/README.md")).toBe(true);
      expect(branchHasFile(repo, "main", "verify-app/cli/README.md")).toBe(false);
      const actions = readActions(dispatch);
      expect(actions.map((a) => a.action)).toEqual(["note", "merge"]);
      expect(actions[0]?.detail).toBe(want);
    } finally {
      cleanup(dir);
    }
  });

  test("the failed verifier's folder still on the branch refuses, naming it", () => {
    const { dir, repo } = freshApp();
    try {
      const proof = writeProof(dir, "proof-web.log");
      const handover = writeHandover(
        dir,
        "HANDOVER.md",
        handoverDoc(
          handoverEntry("cli", "verify-app/cli", "none - the drive never finished"),
          handoverEntry("web", "verify-app/web", proof),
        ),
      );
      const dispatch = makeDispatch(dir, "postmaster");
      plantBranch(
        repo,
        "verify-both",
        {
          ...verifierFiles("verify-app/cli", HELPER_GOOD),
          ...verifierFiles("verify-app/web", HELPER_GOOD),
        },
        "both verifiers",
      );
      const r = runCheck(repo, "verify-both", dispatch, handover);
      expect(r.code).toBe(1);
      expect(r.out).toBe(
        "refuse: verify-both lands nothing: failed verifier still on the branch: " +
          "cli (verify-app/cli)\n",
      );
      expect(checksDirExists(dispatch)).toBe(false);
    } finally {
      cleanup(dir);
    }
  });
});

describe("C5: the user is told what was left out, or why nothing landed", () => {
  test("a session with no proven verifier lands nothing and says so", () => {
    const { dir, repo } = freshApp();
    try {
      const gone = join(dir, "gone.log");
      const handover = writeHandover(
        dir,
        "HANDOVER.md",
        handoverDoc(
          handoverEntry("cli", "verify-app/cli", "none - the drive never finished"),
          handoverEntry("web", "verify-app/web", gone),
        ),
      );
      const dispatch = makeDispatch(dir, "postmaster");
      plantBranch(repo, "verify-cli", verifierFiles("verify-app", HELPER_GOOD), "clean verifier");
      const before = headOf(repo, "main");
      const r = runLand(repo, "verify-cli", dispatch, handover, ["--landing", "local"]);
      const want =
        "refuse: verify-cli lands nothing: no proven verifier " +
        `(cli: no proof file; web: proof ${gone} missing)`;
      expect(r.code).toBe(1);
      expect(r.out).toBe(`${want}\n`);
      expect(headOf(repo, "main")).toBe(before);
      expect(checksDirExists(dispatch)).toBe(false);
      const actions = readActions(dispatch);
      expect(actions).toHaveLength(1);
      expect(actions[0]?.detail).toBe(want);
    } finally {
      cleanup(dir);
    }
  });

  test("a hand-over naming no verifier lands nothing and says so", () => {
    const { dir, repo } = freshApp();
    try {
      const handover = writeHandover(dir, "HANDOVER.md", "# Handover\n\nNothing was proved.\n");
      const dispatch = makeDispatch(dir, "postmaster");
      plantBranch(repo, "verify-cli", verifierFiles("verify-app", HELPER_GOOD), "clean verifier");
      const r = runCheck(repo, "verify-cli", dispatch, handover);
      const want =
        "refuse: verify-cli lands nothing: no proven verifier (the hand-over names none)";
      expect(r.code).toBe(1);
      expect(r.out).toBe(`${want}\n`);
      const actions = readActions(dispatch);
      expect(actions).toHaveLength(1);
      expect(actions[0]?.detail).toBe(want);
    } finally {
      cleanup(dir);
    }
  });

  test("a session past its limit lands nothing; a generous limit lands it", () => {
    const dir = mkdtempSync(join(tmpdir(), "acceptance-325-limit-"));
    try {
      const repo = sleepRepo(dir);
      const proof = writeProof(dir, "proof-sleepy.log");
      const handover = writeHandover(
        dir,
        "HANDOVER.md",
        handoverDoc(handoverEntry("sleepy", "verify-sleepy", proof)),
      );
      plantBranch(
        repo,
        "verify-sleepy",
        { "verify-sleepy/README.md": "# sleepy verifier\n" },
        "sleepy verifier",
      );
      const before = headOf(repo, "main");
      const dispatch = makeDispatch(dir, "postmaster");
      const r = runLand(repo, "verify-sleepy", dispatch, handover, [
        "--landing",
        "local",
        "--timeout",
        "1",
      ]);
      const want =
        "refuse: verify-sleepy lands nothing: past its limit (the checks ran longer than 1s)";
      expect(r.code).toBe(1);
      expect(r.out).toBe(`${want}\n`);
      expect(headOf(repo, "main")).toBe(before);
      expect(readActions(dispatch)).toHaveLength(1);
      expect(readActions(dispatch)[0]?.detail).toBe(want);
      const listed = gitOrThrow(repo, "worktree", "list", "--porcelain");
      expect(listed.split("\n").filter((l) => l.startsWith("worktree "))).toHaveLength(1);
      const dispatch2 = makeDispatch(dir, "postmaster");
      const r2 = runLand(repo, "verify-sleepy", dispatch2, handover, [
        "--landing",
        "local",
        "--timeout",
        "30",
      ]);
      expect(r2.code).toBe(0);
      expect(r2.out.split("\n")[0]).toBe(
        `accept: verify-sleepy lands 1 verifier: sleepy (verify-sleepy, proof ${proof}); ` +
          "left out: none",
      );
    } finally {
      cleanup(dir);
    }
  });

  test("verifiers failing the checks land nothing, and the log has the same line", () => {
    const { dir, repo } = freshApp();
    try {
      const proof = writeProof(dir, "proof-cli.log");
      const handover = goodHandover(dir, proof);
      const dispatch = makeDispatch(dir, "postmaster");
      plantBranch(repo, "verify-cli", verifierFiles("verify-app", HELPER_BAD), "rough helper");
      const before = headOf(repo, "main");
      const r = runLand(repo, "verify-cli", dispatch, handover, ["--landing", "local"]);
      const want = "refuse: verify-cli lands nothing: checks failed (gate: fail)";
      expect(r.code).toBe(1);
      expect(r.out).toBe(`${want}\n`);
      expect(headOf(repo, "main")).toBe(before);
      const actions = readActions(dispatch);
      expect(actions).toHaveLength(1);
      expect(actions[0]?.detail).toBe(want);
    } finally {
      cleanup(dir);
    }
  });

  test("a project check that never runs refuses the landing, naming it", () => {
    const dir = mkdtempSync(join(tmpdir(), "acceptance-325-suiteless-"));
    try {
      const repo = suitelessRepo(dir);
      const proof = writeProof(dir, "proof-suiteless.log");
      const handover = writeHandover(
        dir,
        "HANDOVER.md",
        handoverDoc(handoverEntry("suiteless", "verify-suiteless", proof)),
      );
      plantBranch(
        repo,
        "verify-suiteless",
        { "verify-suiteless/README.md": "# suiteless verifier\n" },
        "suiteless verifier",
      );
      const dispatch = makeDispatch(dir, "postmaster");
      const r = runCheck(repo, "verify-suiteless", dispatch, handover);
      const want = "refuse: verify-suiteless lands nothing: checks not run (browser: not run)";
      expect(r.code).toBe(1);
      expect(r.out).toBe(`${want}\n`);
      const actions = readActions(dispatch);
      expect(actions).toHaveLength(1);
      expect(actions[0]?.detail).toBe(want);
    } finally {
      cleanup(dir);
    }
  });
});

describe("landing refuses cleanly", () => {
  test("a merge that conflicts is aborted and reported", () => {
    const { dir, repo } = freshApp();
    try {
      const proof = writeProof(dir, "proof-cli.log");
      const handover = goodHandover(dir, proof);
      const dispatch = makeDispatch(dir, "postmaster");
      plantBranch(repo, "verify-cli", verifierFiles("verify-app", HELPER_GOOD), "clean verifier");
      writeRepoFile(repo, "verify-app/README.md", "# conflicting verifier\n");
      commitAll(repo, "main adds its own verifier readme");
      const before = headOf(repo, "main");
      const r = runLand(repo, "verify-cli", dispatch, handover, ["--landing", "local"]);
      expect(r.code).toBe(1);
      expect(r.out.split("\n")[0]).toContain("accept: verify-cli lands 1 verifier");
      expect(
        r.out.split("\n")[1]?.startsWith("error: the merge of verify-cli into main failed"),
      ).toBe(true);
      expect(headOf(repo, "main")).toBe(before);
      expect(gitOrThrow(repo, "status", "--porcelain").trim()).toBe("");
      expect(readActions(dispatch).map((a) => a.action)).toEqual(["note", "note"]);
    } finally {
      cleanup(dir);
    }
  });

  test("a proven verifier with no files on the branch is refused", () => {
    const { dir, repo } = freshApp();
    try {
      const proof = writeProof(dir, "proof-cli.log");
      const handover = writeHandover(
        dir,
        "HANDOVER.md",
        handoverDoc(handoverEntry("cli", "verify-app/cli", proof)),
      );
      const dispatch = makeDispatch(dir, "postmaster");
      plantBranch(
        repo,
        "verify-web",
        verifierFiles("verify-app/web", HELPER_GOOD),
        "web files only",
      );
      const r = runCheck(repo, "verify-web", dispatch, handover);
      expect(r.code).toBe(1);
      expect(r.out).toBe(
        "refuse: verify-web lands nothing: proven verifier has no files on the branch: " +
          "cli (verify-app/cli)\n",
      );
    } finally {
      cleanup(dir);
    }
  });

  test("a hand-over entry naming no folder is refused", () => {
    const { dir, repo } = freshApp();
    try {
      const proof = writeProof(dir, "proof-web.log");
      const handover = writeHandover(dir, "HANDOVER.md", `## Verifier: web\nProof: ${proof}\n`);
      const dispatch = makeDispatch(dir, "postmaster");
      plantBranch(
        repo,
        "verify-web",
        verifierFiles("verify-app/web", HELPER_GOOD),
        "web files only",
      );
      const r = runCheck(repo, "verify-web", dispatch, handover);
      expect(r.code).toBe(1);
      expect(r.out).toBe(
        "refuse: verify-web lands nothing: the hand-over names no folder for web\n",
      );
    } finally {
      cleanup(dir);
    }
  });

  test("--folder lands a differently named folder", () => {
    const { dir, repo } = freshApp();
    try {
      const proof = writeProof(dir, "proof-cli.log");
      const handover = writeHandover(
        dir,
        "HANDOVER.md",
        handoverDoc(handoverEntry("cli", "custom", proof)),
      );
      plantBranch(repo, "verify-custom", verifierFiles("custom", HELPER_GOOD), "custom folder");
      const dispatch = makeDispatch(dir, "postmaster");
      const r1 = runCheck(repo, "verify-custom", dispatch, handover);
      expect(r1.code).toBe(1);
      expect(r1.out).toBe(
        "refuse: verify-custom lands nothing: outside the verifiers' folder: custom/README.md, " +
          "custom/features/README.md, custom/features/add.md, custom/features/done.md, " +
          "custom/features/list.md, custom/helper.ts\n",
      );
      const dispatch2 = makeDispatch(dir, "postmaster");
      const r2 = runCheck(repo, "verify-custom", dispatch2, handover, ["--folder", "custom"]);
      expect(r2.code).toBe(0);
      expect(r2.out).toBe(
        `accept: verify-custom lands 1 verifier: cli (custom, proof ${proof}); left out: none\n`,
      );
    } finally {
      cleanup(dir);
    }
  });
});

describe("the session instructions carry the landable hand-over shape", () => {
  test("prompt names the hand-over sections and the removal of unproven folders", () => {
    const { dir, repo } = freshApp();
    try {
      const r = run(RUN, ["verifier", "prompt", repo, "cli"]);
      expect(r.code).toBe(0);
      expect(r.out).toContain("## Verifier:");
      expect(r.out).toContain("Folder:");
      expect(r.out).toContain("Proof:");
      expect(r.out).toMatch(/remove its folder/iu);
    } finally {
      cleanup(dir);
    }
  });
});

describe("usage", () => {
  test("check and land refuse bad input with exit 2", () => {
    const { dir, repo } = freshApp();
    try {
      const dispatch = makeDispatch(dir, "postmaster");
      const proof = writeProof(dir, "p.log");
      const handover = goodHandover(dir, proof);
      plantBranch(repo, "verify-cli", verifierFiles("verify-app", HELPER_GOOD), "clean verifier");
      expect(run(RUN, ["verifier", "check", repo, "verify-cli", "--run", dispatch]).code).toBe(2);
      expect(run(RUN, ["verifier", "check", repo, "verify-cli", "--handover", handover]).code).toBe(
        2,
      );
      expect(runLand(repo, "verify-cli", dispatch, handover, ["--landing", "sideways"]).code).toBe(
        2,
      );
      expect(runCheck(repo, "verify-nope", dispatch, handover).code).toBe(2);
      expect(runCheck(repo, "main", dispatch, handover).code).toBe(2);
      expect(runCheck(repo, "verify-cli", dispatch, handover, ["--folder", "/tmp/x"]).code).toBe(2);
      expect(runCheck(join(dir, "nope"), "verify-cli", dispatch, handover).code).toBe(2);
      expect(runCheck(repo, "verify-cli", dispatch, join(dir, "gone.md")).code).toBe(2);
    } finally {
      cleanup(dir);
    }
  });
});
