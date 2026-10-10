// Tests beside scripts/verifier.ts: argument parsing, prompt rendering, naming, base
// detection and the wall scan. The live session stays out; acceptance-323 covers the
// command boundary as a subprocess.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitAll, gitOrThrow, initRepo, RUN, writeRepoFile } from "./acceptance-323.ts";
import { run } from "./lib/proc.ts";
import {
  acceptLine,
  addedFeaturePages,
  addedPaths,
  addedUnder,
  branchFileText,
  branchHasPath,
  type CheapFacts,
  type ChecksOutcome,
  type ClassifiedEntry,
  checkMultiVerifiers,
  classifyEntries,
  commitsPastBase,
  committedFeaturePages,
  decideCheap,
  decideChecks,
  defaultBase,
  defaultLanding,
  deliverInstructions,
  detectFolders,
  dirLines,
  failureOutcome,
  featurePageNames,
  featurePages,
  handoverFresh,
  hasUpkeepLine,
  indexNames,
  isFeaturePage,
  isSurface,
  joinBodies,
  kindProse,
  landTarget,
  lastLine,
  listVerifiers,
  mergeAuthorityOf,
  modeBlocks,
  normalizeFolder,
  orderKinds,
  outsideAdded,
  outsidePaths,
  parseArgs,
  parseHandover,
  parseUpkeepReport,
  parseVerifyResults,
  pickBranch,
  pickUpkeepBranch,
  pickUpkeepWorktree,
  pickWorktree,
  proseList,
  pruneWorktrees,
  refuseLine,
  remoteFromSymbolicRef,
  removeProvisioning,
  renderListing,
  renderPrompt,
  renderTemplate,
  repoTop,
  roleHarness,
  scopeVdirs,
  scrubGitEnv,
  sendText,
  sendVerdict,
  spawnCommand,
  strayVerifierPaths,
  surfaceFromReadme,
  surfaceKind,
  surfaceProse,
  timeoutMs,
  UPKEEP_LINE,
  unlistedSentence,
  unrunProject,
  type UpkeepReport,
  upkeepScope,
  upkeepSendText,
  UPKEEP_HEADLESS_UNASKED,
  verdictUpkeep,
  verifierHandle,
  verifyDirName,
  waitForFile,
  waitForHandover,
  wallInStream,
} from "./verifier.ts";

function tempDir(): string {
  // Resolved: on macOS the temporary folder sits behind a link (/var to
  // /private/var) and git prints the resolved path, so an unresolved expected
  // path never matches it. host, local and reach already do this.
  return realpathSync(mkdtempSync(join(tmpdir(), "verifier-")));
}

describe("parseArgs", () => {
  test("prompt takes a repo and a surface", () => {
    expect(parseArgs(["prompt", "/r", "cli"])).toEqual({
      ok: true,
      req: { cmd: "prompt", repo: "/r", surfaces: ["cli"], headless: false },
    });
  });

  test("prompt takes several surfaces as distinct kinds in canonical order", () => {
    expect(parseArgs(["prompt", "/r", "web", "cli"])).toEqual({
      ok: true,
      req: { cmd: "prompt", repo: "/r", surfaces: ["cli", "web"], headless: false },
    });
    expect(parseArgs(["prompt", "/r", "cli", "cli-examples"])).toEqual({
      ok: true,
      req: { cmd: "prompt", repo: "/r", surfaces: ["cli"], headless: false },
    });
    expect(parseArgs(["prompt", "/r", "browser-suite", "web-journey"])).toEqual({
      ok: true,
      req: { cmd: "prompt", repo: "/r", surfaces: ["web"], headless: false },
    });
  });

  test("no command and an unknown command fail", () => {
    expect(parseArgs([])).toEqual({ ok: false, error: "no command" });
    expect(parseArgs(["mend"])).toEqual({ ok: false, error: "unknown command: mend" });
  });

  test("a missing surface and an unknown surface fail", () => {
    expect(parseArgs(["prompt", "/r"])).toEqual({
      ok: false,
      error: "prompt takes a repo and a surface",
    });
    expect(parseArgs(["prompt", "/r", "telegraph"])).toEqual({
      ok: false,
      error:
        "unknown surface: telegraph (cli, web, library, cli-examples, browser-suite, web-journey or library-tests)",
    });
    expect(parseArgs(["prompt", "/r", "cli", "telegraph"]).ok).toBe(false);
  });

  test("prototype names are unknown surfaces, not silent empty kinds", () => {
    for (const name of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(parseArgs(["prompt", "/r", name]).ok).toBe(false);
      expect(parseArgs(["prompt", "/r", "cli", name]).ok).toBe(false);
    }
  });

  test("prompt takes --headless and refuses any other flag", () => {
    expect(parseArgs(["prompt", "/r", "cli", "--headless"])).toEqual({
      ok: true,
      req: { cmd: "prompt", repo: "/r", surfaces: ["cli"], headless: true },
    });
    expect(parseArgs(["prompt", "/r", "cli", "--fresh"])).toEqual({
      ok: false,
      error: "unknown flag for prompt: --fresh",
    });
    expect(parseArgs(["prompt", "/r", "cli", "--headless", "--headless"])).toEqual({
      ok: false,
      error: "prompt takes a repo and a surface",
    });
  });

  test("make needs --run and defaults the timeout", () => {
    expect(parseArgs(["make", "/r", "web", "--run", "/d"])).toEqual({
      ok: true,
      req: { cmd: "make", repo: "/r", surfaces: ["web"], dispatch: "/d", timeout: 3600 },
    });
    expect(parseArgs(["make", "/r", "web", "--run", "/d", "--timeout", "60"])).toEqual({
      ok: true,
      req: { cmd: "make", repo: "/r", surfaces: ["web"], dispatch: "/d", timeout: 60 },
    });
    expect(parseArgs(["make", "/r", "cli-examples", "browser-suite", "--run", "/d"])).toEqual({
      ok: true,
      req: {
        cmd: "make",
        repo: "/r",
        surfaces: ["cli", "web"],
        dispatch: "/d",
        timeout: 3600,
      },
    });
  });

  test("make without --run fails", () => {
    expect(parseArgs(["make", "/r", "web"])).toEqual({
      ok: false,
      error: "make needs --run <dispatch>",
    });
  });

  test("a bad timeout and an unknown flag fail", () => {
    expect(parseArgs(["make", "/r", "web", "--run", "/d", "--timeout", "0"]).ok).toBe(false);
    expect(parseArgs(["make", "/r", "web", "--run", "/d", "--timeout", "soon"]).ok).toBe(false);
    expect(parseArgs(["make", "/r", "web", "--run", "/d", "--timeout", "1234567890"]).ok).toBe(
      false,
    );
    expect(parseArgs(["make", "/r", "web", "--run", "/d", "--fresh"]).ok).toBe(false);
    expect(parseArgs(["make", "/r", "web", "--run"]).ok).toBe(false);
  });
});

describe("surfaces", () => {
  test("the three surfaces and their prose", () => {
    expect(isSurface("cli")).toBe(true);
    expect(isSurface("web")).toBe(true);
    expect(isSurface("library")).toBe(true);
    expect(isSurface("telegraph")).toBe(false);
    expect(surfaceProse("cli")).toBe("command line");
    expect(surfaceProse("web")).toBe("web pages");
    expect(surfaceProse("library")).toBe("library interface");
    expect(() => surfaceProse("telegraph")).toThrow("unknown surface: telegraph");
  });
});

describe("renderPrompt", () => {
  test("fills every placeholder", () => {
    const out = renderPrompt(
      "{{REPO}} {{SURFACE}} {{SURFACE_PROSE}} {{VERIFY_DIR}} {{BASE}} {{ASK_RULE}} {{SECRETS_RULE}} {{HANDOVER_UNASKED}}",
      {
        repo: "/r",
        surface: "cli",
        surfaceProse: "command line",
        verifyDir: "verify-app",
        base: "origin/main",
        askRule: "ask",
        secretsRule: "secrets",
        handoverUnasked: "unasked",
      },
    );
    expect(out).toBe("/r cli command line verify-app origin/main ask secrets unasked");
  });

  test("dollar patterns in a value copy literally", () => {
    const out = renderPrompt("{{REPO}} {{VERIFY_DIR}}", {
      repo: "/x/app$$x",
      surface: "cli",
      surfaceProse: "command line",
      verifyDir: "verify-$&-'",
      base: "main",
      askRule: "ask",
      secretsRule: "secrets",
      handoverUnasked: "",
    });
    expect(out).toBe("/x/app$$x verify-$&-'");
  });

  test("placeholder-shaped text in a value copies literally", () => {
    const out = renderPrompt("{{REPO}} {{BASE}}", {
      repo: "/x/{{BASE}}-app",
      surface: "cli",
      surfaceProse: "command line",
      verifyDir: "verify-app",
      base: "origin/main",
      askRule: "ask",
      secretsRule: "secrets",
      handoverUnasked: "",
    });
    expect(out).toBe("/x/{{BASE}}-app origin/main");
    const unknown = renderPrompt("{{REPO}}", {
      repo: "/x/{{NAME}}-app",
      surface: "cli",
      surfaceProse: "command line",
      verifyDir: "verify-app",
      base: "main",
      askRule: "ask",
      secretsRule: "secrets",
      handoverUnasked: "",
    });
    expect(unknown).toBe("/x/{{NAME}}-app");
  });

  test("a leftover placeholder throws", () => {
    expect(() =>
      renderPrompt("{{REPO}} {{NOPE}}", {
        repo: "/r",
        surface: "cli",
        surfaceProse: "command line",
        verifyDir: "verify-app",
        base: "main",
        askRule: "ask",
        secretsRule: "secrets",
        handoverUnasked: "",
      }),
    ).toThrow("unknown placeholder in the prompt template: {{NOPE}}");
  });
});

describe("modeBlocks", () => {
  test("the interactive session asks and names secret files", () => {
    const blocks = modeBlocks(false);
    expect(blocks.askRule).toContain("ask the user only what you cannot observe");
    expect(blocks.secretsRule).toContain("name of the file that holds it");
    expect(blocks.handoverUnasked).toBe("");
  });

  test("the headless session cannot ask and lists what it could not", () => {
    const blocks = modeBlocks(true);
    expect(blocks.askRule).toContain("cannot ask anyone anything");
    expect(blocks.secretsRule).toContain("Never invent a value");
    expect(blocks.handoverUnasked).toContain("Unasked questions");
  });

  test("the default deliverable is HANDOVER.md, as make renders", () => {
    expect(modeBlocks(false)).toEqual(modeBlocks(false, "HANDOVER.md"));
    expect(modeBlocks(true)).toEqual(modeBlocks(true, "HANDOVER.md"));
    expect(modeBlocks(true).askRule).toContain("HANDOVER.md");
  });

  test("an upkeep pass names UPKEEP.md in both forms, never HANDOVER.md", () => {
    for (const headless of [false, true]) {
      const blocks = modeBlocks(headless, "UPKEEP.md");
      expect(blocks.askRule).not.toContain("HANDOVER.md");
      expect(blocks.secretsRule).not.toContain("HANDOVER.md");
      expect(blocks.secretsRule).toContain("UPKEEP.md");
    }
    expect(modeBlocks(true, "UPKEEP.md").askRule).toContain("UPKEEP.md");
    expect(modeBlocks(false, "UPKEEP.md").askRule).toContain(
      "ask the user only what you cannot observe",
    );
  });
});

describe("naming", () => {
  test("the verifier folder slugs the repo name", () => {
    expect(verifyDirName("/x/todo")).toBe("verify-todo");
    expect(verifyDirName("/x/Todo_App")).toBe("verify-todo-app");
    expect(verifyDirName("/x/!!!")).toBe("verify-app");
  });

  test("the branch numbers past branches taken", () => {
    expect(pickBranch(() => false, "cli")).toBe("verify-cli");
    expect(pickBranch((n) => n === "verify-cli", "cli")).toBe("verify-cli-2");
    expect(pickBranch((n) => n !== "verify-cli-3", "cli")).toBe("verify-cli-3");
  });

  test("the worktree sits beside the repo, numbered past paths taken", () => {
    expect(pickWorktree("/x/app", "cli", () => false)).toBe("/x/app-verify-cli");
    expect(pickWorktree("/x/app", "cli", (p) => p === "/x/app-verify-cli")).toBe(
      "/x/app-verify-cli-2",
    );
  });

  test("the handle names the repo and the branch, tagged by its path", () => {
    expect(verifierHandle("/x/app", "verify-cli")).toMatch(
      /^verifier-app-verify-cli-[0-9a-f]{8}$/u,
    );
    expect(verifierHandle("/x/app", "verify-cli-2")).toMatch(
      /^verifier-app-verify-cli-2-[0-9a-f]{8}$/u,
    );
  });

  test("the same directory name in different parents gets different handles", () => {
    const a = verifierHandle("/x/app", "verify-cli");
    expect(verifierHandle("/x/app", "verify-cli")).toBe(a);
    expect(verifierHandle("/y/app", "verify-cli")).not.toBe(a);
  });
});

describe("sendText", () => {
  test("points the session at its instructions file", () => {
    const text = sendText("/d/logs/verifier-verify-cli-prompt.txt");
    expect(text).toContain("/d/logs/verifier-verify-cli-prompt.txt");
    expect(text.endsWith("\n")).toBe(true);
  });
});

describe("spawnCommand", () => {
  test("starts the form in the worktree explicitly, then execs it", () => {
    expect(spawnCommand("/wt", ["muse", "--model", "probe-model"])).toEqual([
      "bash",
      "-c",
      `cd -- '/wt' && exec "$@"`,
      "_",
      "muse",
      "--model",
      "probe-model",
    ]);
  });

  test("quotes spaces and single quotes in the worktree path", () => {
    expect(spawnCommand("/o'brien/r e", ["muse"])[2]).toBe(
      "cd -- '/o'\\''brien/r e' && exec \"$@\"",
    );
  });
});

describe("sendVerdict", () => {
  test("settled and still-working both count as delivered", () => {
    expect(sendVerdict(0, "sent 10 bytes to h, and it settled")).toBe("sent");
    expect(sendVerdict(3, "sent; h did not settle within 60s")).toBe("sent");
  });

  test("no turn started retries, anything else fails", () => {
    expect(sendVerdict(3, "h got the message, but Herdr saw no turn start")).toBe("retry");
    expect(sendVerdict(1, "herdr could not prompt h")).toBe("failed");
    expect(sendVerdict(3, "no Herdr or tmux here")).toBe("failed");
  });

  test("a block after accepting keeps the prompt; a block before accepting fails", () => {
    expect(sendVerdict(3, "sent; h stopped at an approval or a question")).toBe("sent");
    expect(
      sendVerdict(3, "h is at an approval or a question; the user answers it in Herdr first"),
    ).toBe("failed");
  });
});

describe("deliverInstructions", () => {
  type Run = { code: number; out: string; err: string };
  const sent: Run = { code: 0, out: "sent 10 bytes to h, and it settled", err: "" };
  const stalled: Run = { code: 3, out: "", err: "h got the message, but Herdr saw no turn start" };
  const readOk: Run = { code: 0, out: "You are making a verifier", err: "" };

  test("a first-try send makes no other call", () => {
    const calls: string[][] = [];
    const r = deliverInstructions(
      (args) => {
        calls.push(args);
        return sent;
      },
      "h",
      "/f",
    );
    expect(r).toEqual({ delivered: true, attempts: 1, lastError: "" });
    expect(calls).toEqual([["host", "send", "h", "/f", "--wait", "60"]]);
  });

  test("a dropped prompt is read and resent", () => {
    const calls: string[][] = [];
    let sends = 0;
    const r = deliverInstructions(
      (args) => {
        calls.push(args);
        if (args[1] === "read") return readOk;
        sends++;
        return sends === 1 ? stalled : sent;
      },
      "h",
      "/f",
    );
    expect(r).toEqual({ delivered: true, attempts: 2, lastError: "" });
    expect(calls).toEqual([
      ["host", "send", "h", "/f", "--wait", "60"],
      ["host", "read", "h", "20"],
      ["host", "send", "h", "/f", "--wait", "60"],
    ]);
  });

  test("a failure that is not a drop stops at once", () => {
    const calls: string[][] = [];
    const r = deliverInstructions(
      (args) => {
        calls.push(args);
        return { code: 1, out: "", err: "herdr could not prompt h" };
      },
      "h",
      "/f",
    );
    expect(r.delivered).toBe(false);
    expect(r.attempts).toBe(1);
    expect(r.lastError).toContain("could not prompt");
    expect(calls).toHaveLength(1);
  });

  test("drops past the bound fail with the last send's error", () => {
    const calls: string[][] = [];
    const r = deliverInstructions(
      (args) => {
        calls.push(args);
        return args[1] === "read" ? readOk : stalled;
      },
      "h",
      "/f",
    );
    expect(r.delivered).toBe(false);
    expect(r.attempts).toBe(3);
    expect(r.lastError).toContain("no turn start");
    expect(calls.filter((c) => c[1] === "send")).toHaveLength(3);
    expect(calls.filter((c) => c[1] === "read")).toHaveLength(2);
  });

  test("a handle the read cannot reach fails without another send", () => {
    const calls: string[][] = [];
    const r = deliverInstructions(
      (args) => {
        calls.push(args);
        if (args[1] === "read") return { code: 1, out: "", err: "no live Herdr agent named h" };
        return stalled;
      },
      "h",
      "/f",
    );
    expect(r.delivered).toBe(false);
    expect(r.lastError).toContain("never registered");
    expect(calls.filter((c) => c[1] === "send")).toHaveLength(1);
  });
});

describe("pruneWorktrees", () => {
  test("a hand-deleted worktree frees its path again", () => {
    const dir = tempDir();
    try {
      const repo = join(dir, "app");
      initRepo(repo);
      writeRepoFile(repo, "README.md", "# app\n");
      commitAll(repo, "first");
      const wt = join(dir, "app-verify-cli");
      gitOrThrow(repo, "worktree", "add", wt, "-b", "verify-cli", "main");
      rmSync(wt, { recursive: true, force: true });
      pruneWorktrees(repo);
      gitOrThrow(repo, "worktree", "add", wt, "-b", "verify-cli-2", "main");
      expect(gitOrThrow(repo, "branch", "--list", "verify-cli-2")).toContain("verify-cli-2");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("remoteFromSymbolicRef", () => {
  test("reads origin's head and refuses the rest", () => {
    expect(remoteFromSymbolicRef("refs/remotes/origin/main\n")).toBe("origin/main");
    expect(remoteFromSymbolicRef("refs/heads/main\n")).toBe(null);
    expect(remoteFromSymbolicRef("refs/remotes/\n")).toBe(null);
    expect(remoteFromSymbolicRef("")).toBe(null);
  });
});

describe("defaultBase", () => {
  test("main wins over master, master over nothing", () => {
    const dir = tempDir();
    try {
      const repo = join(dir, "app");
      initRepo(repo);
      writeRepoFile(repo, "README.md", "# app\n");
      commitAll(repo, "first");
      expect(defaultBase(repo)).toBe("main");
      const other = join(dir, "old");
      const r = run("git", ["init", "-q", "-b", "master", other]);
      expect(r.code).toBe(0);
      gitOrThrow(other, "config", "user.name", "brindlewick");
      gitOrThrow(other, "config", "user.email", "332054101+brindlewick@users.noreply.github.com");
      writeRepoFile(other, "README.md", "# old\n");
      commitAll(other, "first");
      expect(defaultBase(other)).toBe("master");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a clone cuts from origin's head", () => {
    const dir = tempDir();
    try {
      const src = join(dir, "src");
      initRepo(src);
      writeRepoFile(src, "README.md", "# src\n");
      commitAll(src, "first");
      const dst = join(dir, "dst");
      const r = run("git", ["clone", "-q", src, dst]);
      expect(r.code).toBe(0);
      expect(defaultBase(dst)).toBe("origin/main");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a lone branch cuts from its head, an empty repo from nothing", () => {
    const dir = tempDir();
    try {
      const repo = join(dir, "feat");
      const r = run("git", ["init", "-q", "-b", "feature", repo]);
      expect(r.code).toBe(0);
      gitOrThrow(repo, "config", "user.name", "brindlewick");
      gitOrThrow(repo, "config", "user.email", "332054101+brindlewick@users.noreply.github.com");
      writeRepoFile(repo, "README.md", "# feat\n");
      commitAll(repo, "first");
      expect(defaultBase(repo)).toBe(gitOrThrow(repo, "rev-parse", "HEAD").trim());
      const empty = join(dir, "empty");
      initRepo(empty);
      expect(defaultBase(empty)).toBe(null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("landTarget", () => {
  const pointOriginHead = (repo: string, branch: string): void => {
    const sha = gitOrThrow(repo, "rev-parse", "HEAD").trim();
    gitOrThrow(repo, "update-ref", `refs/remotes/origin/${branch}`, sha);
    gitOrThrow(repo, "symbolic-ref", "refs/remotes/origin/HEAD", `refs/remotes/origin/${branch}`);
  };

  test("origin's head wins over a stale local main", () => {
    const dir = tempDir();
    try {
      const repo = join(dir, "app");
      initRepo(repo);
      writeRepoFile(repo, "README.md", "# app\n");
      commitAll(repo, "first");
      gitOrThrow(repo, "branch", "master");
      pointOriginHead(repo, "master");
      expect(landTarget(repo)).toBe("master");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a trunk default lands onto trunk", () => {
    const dir = tempDir();
    try {
      const repo = join(dir, "app");
      initRepo(repo);
      writeRepoFile(repo, "README.md", "# app\n");
      commitAll(repo, "first");
      gitOrThrow(repo, "branch", "-m", "main", "trunk");
      pointOriginHead(repo, "trunk");
      expect(landTarget(repo)).toBe("trunk");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("without an origin, main wins over master", () => {
    const dir = tempDir();
    try {
      const repo = join(dir, "app");
      initRepo(repo);
      writeRepoFile(repo, "README.md", "# app\n");
      commitAll(repo, "first");
      gitOrThrow(repo, "branch", "master");
      expect(landTarget(repo)).toBe("main");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a default that is not checked out lands nowhere", () => {
    const dir = tempDir();
    try {
      const repo = join(dir, "app");
      initRepo(repo);
      writeRepoFile(repo, "README.md", "# app\n");
      commitAll(repo, "first");
      pointOriginHead(repo, "other");
      expect(landTarget(repo)).toBe(null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("prompt needs a commit to name", () => {
  test("prompt on a repo with no commit exits 2", () => {
    const dir = tempDir();
    try {
      const repo = join(dir, "empty");
      initRepo(repo);
      const r = run(RUN, ["verifier", "prompt", repo, "cli"]);
      expect(r.code).toBe(2);
      expect(r.err).toContain("usage: run verifier");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("prompt on a path below the repo top exits 2", () => {
    const dir = tempDir();
    try {
      const repo = join(dir, "app");
      initRepo(repo);
      writeRepoFile(repo, "README.md", "# app\n");
      writeRepoFile(repo, "src/keep.md", "x\n");
      commitAll(repo, "first");
      const r = run(RUN, ["verifier", "prompt", join(repo, "src"), "cli"]);
      expect(r.code).toBe(2);
      expect(r.err).toContain("not the top of its repository");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an inherited GIT_DIR does not redirect the repo check", () => {
    const dir = tempDir();
    try {
      const repo = join(dir, "app");
      initRepo(repo);
      writeRepoFile(repo, "README.md", "# app\n");
      commitAll(repo, "first");
      const r = run(RUN, ["verifier", "prompt", dir, "cli"], {
        env: { GIT_DIR: join(repo, ".git") },
      });
      expect(r.code).toBe(2);
      expect(r.err).toContain("not a git repository");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("scrubGitEnv", () => {
  test("drops the redirectors and keeps the rest", () => {
    expect(scrubGitEnv({ GIT_DIR: "/x", GIT_WORK_TREE: "/y", PATH: "/bin", HOME: "/h" })).toEqual({
      PATH: "/bin",
      HOME: "/h",
    });
    expect(scrubGitEnv({ PATH: "/bin" })).toEqual({ PATH: "/bin" });
  });
});

describe("repoTop", () => {
  test("the top for the top and its subdir, none outside a repo", () => {
    const dir = tempDir();
    try {
      const repo = join(dir, "app");
      initRepo(repo);
      writeRepoFile(repo, "README.md", "# app\n");
      writeRepoFile(repo, "src/keep.md", "x\n");
      commitAll(repo, "first");
      expect(repoTop(repo)).toBe(repo);
      expect(repoTop(join(repo, "src"))).toBe(repo);
      expect(repoTop(join(dir, "nope"))).toBe(null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("branchHasPath", () => {
  test("a committed file reads present, an uncommitted one absent", () => {
    const dir = tempDir();
    try {
      const repo = join(dir, "app");
      initRepo(repo);
      writeRepoFile(repo, "README.md", "# app\n");
      commitAll(repo, "first");
      gitOrThrow(repo, "branch", "verify-cli");
      writeRepoFile(repo, "verify-app/README.md", "v\n");
      writeRepoFile(repo, "note.md", "hi\n");
      gitOrThrow(repo, "checkout", "-q", "verify-cli");
      gitOrThrow(repo, "add", "note.md");
      gitOrThrow(repo, "commit", "-q", "-m", "other file");
      expect(branchHasPath(repo, "verify-cli", "verify-app/README.md")).toBe(false);
      expect(branchHasPath(repo, "verify-cli", "note.md")).toBe(true);
      expect(branchHasPath(repo, "verify-cli", "missing.md")).toBe(false);
      expect(branchHasPath(repo, "nope", "note.md")).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("handoverFresh", () => {
  test("written at or after the cut reads fresh, before reads stale", () => {
    expect(handoverFresh(2000, 1000)).toBe(true);
    expect(handoverFresh(1000, 1000)).toBe(true);
    expect(handoverFresh(999, 1000)).toBe(false);
  });
});

describe("waitForHandover", () => {
  test("a fresh handover already there returns after one settle nap", () => {
    const dir = tempDir();
    try {
      const wt = join(dir, "wt");
      mkdirSync(wt, { recursive: true });
      writeFileSync(join(wt, "HANDOVER.md"), "hi\n");
      const naps: number[] = [];
      expect(
        waitForHandover(
          wt,
          0,
          60,
          (ms) => {
            naps.push(ms);
          },
          () => 1000,
        ),
      ).toBe(true);
      expect(naps).toEqual([5000]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("no handover sleeps in short naps until the timeout, then gives up", () => {
    const dir = tempDir();
    try {
      const wt = join(dir, "wt");
      mkdirSync(wt, { recursive: true });
      const naps: number[] = [];
      let now = 0;
      const ok = waitForHandover(
        wt,
        0,
        12,
        (ms) => {
          naps.push(ms);
          now += ms;
        },
        () => now,
      );
      expect(ok).toBe(false);
      expect(naps).toEqual([5000, 5000, 2000]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a stale handover never counts, however long the wait", () => {
    const dir = tempDir();
    try {
      const wt = join(dir, "wt");
      mkdirSync(wt, { recursive: true });
      writeFileSync(join(wt, "HANDOVER.md"), "old\n");
      const naps: number[] = [];
      let now = 0;
      const ok = waitForHandover(
        wt,
        999999999999999,
        6,
        (ms) => {
          naps.push(ms);
          now += ms;
        },
        () => now,
      );
      expect(ok).toBe(false);
      expect(naps).toEqual([5000, 1000]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a handover landing mid-wait ends the wait once settled", () => {
    const dir = tempDir();
    try {
      const wt = join(dir, "wt");
      mkdirSync(wt, { recursive: true });
      const naps: number[] = [];
      let now = 0;
      const ok = waitForHandover(
        wt,
        0,
        60,
        (ms) => {
          naps.push(ms);
          now += ms;
          if (!existsSync(join(wt, "HANDOVER.md"))) {
            writeFileSync(join(wt, "HANDOVER.md"), "hi\n");
          }
        },
        () => now,
      );
      expect(ok).toBe(true);
      expect(naps).toEqual([5000, 5000]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("failureOutcome", () => {
  test("a started session keeps its worktree and branch, named", () => {
    expect(failureOutcome(true, "/x/app-verify-cli", "verify-cli")).toEqual({
      cleanup: false,
      suffix: "; the worktree /x/app-verify-cli and branch verify-cli were left behind",
    });
  });

  test("a failure before any session cleans up", () => {
    expect(failureOutcome(false, "/x/app-verify-cli", "verify-cli")).toEqual({
      cleanup: true,
      suffix: "",
    });
  });
});

describe("removeProvisioning", () => {
  test("removes the worktree and the branch", () => {
    const dir = tempDir();
    try {
      const repo = join(dir, "app");
      initRepo(repo);
      writeRepoFile(repo, "README.md", "# app\n");
      commitAll(repo, "first");
      const wt = join(dir, "app-verify-cli");
      gitOrThrow(repo, "worktree", "add", wt, "-b", "verify-cli", "main");
      expect(removeProvisioning(repo, wt, "verify-cli")).toBe("");
      expect(existsSync(wt)).toBe(false);
      expect(gitOrThrow(repo, "branch", "--list", "verify-cli").trim()).toBe("");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("names what it could not remove", () => {
    const dir = tempDir();
    try {
      const repo = join(dir, "app");
      initRepo(repo);
      writeRepoFile(repo, "README.md", "# app\n");
      commitAll(repo, "first");
      const out = removeProvisioning(repo, join(dir, "nope"), "nope");
      expect(out.startsWith("; the cleanup failed too: ")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("committedFeaturePages", () => {
  test("committed pages besides the index, uncommitted ones excluded", () => {
    const dir = tempDir();
    try {
      const repo = join(dir, "app");
      initRepo(repo);
      writeRepoFile(repo, "README.md", "# app\n");
      writeRepoFile(repo, "verify-app/README.md", "v\n");
      writeRepoFile(repo, "verify-app/features/README.md", "map\n");
      writeRepoFile(repo, "verify-app/features/add.md", "a\n");
      writeRepoFile(repo, "verify-app/features/list.md", "l\n");
      writeRepoFile(repo, "verify-app/features/café.md", "c\n");
      commitAll(repo, "first");
      writeRepoFile(repo, "verify-app/features/done.md", "d\n");
      const pages = committedFeaturePages(repo, "main", "verify-app");
      expect(pages?.sort()).toEqual([
        "verify-app/features/add.md",
        "verify-app/features/café.md",
        "verify-app/features/list.md",
      ]);
      expect(committedFeaturePages(repo, "nope", "verify-app")).toBe(null);
      expect(committedFeaturePages(repo, "main", "verify-other")).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("commitsPastBase", () => {
  test("none on a fresh branch, one after a commit, none for a bad base", () => {
    const dir = tempDir();
    try {
      const repo = join(dir, "app");
      initRepo(repo);
      writeRepoFile(repo, "README.md", "# app\n");
      commitAll(repo, "first");
      gitOrThrow(repo, "branch", "verify-cli");
      expect(commitsPastBase(repo, "main", "verify-cli")).toBe(0);
      gitOrThrow(repo, "checkout", "-q", "verify-cli");
      writeRepoFile(repo, "note.md", "hi\n");
      commitAll(repo, "second");
      expect(commitsPastBase(repo, "main", "verify-cli")).toBe(1);
      expect(commitsPastBase(repo, "nope", "verify-cli")).toBe(null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("wallInStream", () => {
  test("reads a wall ending in each recorded shape", () => {
    expect(
      wallInStream(
        '{"type":"turn.completed"}\n{"type":"turn.failed","error":{"message":"Rate limit exceeded, retry later"}}\n',
        "codex",
      ),
    ).toBe("Rate limit exceeded, retry later");
    expect(
      wallInStream(
        '{"type":"assistant"}\n{"type":"result","is_error":true,"result":"Too many requests"}\n',
        "claude",
      ),
    ).toBe("Too many requests");
    expect(
      wallInStream(
        '{"payload_type":"run.terminal.failed","payload":{"reason":"Usage limit reached"}}\n',
        "muse",
      ),
    ).toBe("Usage limit reached");
  });

  test("a clean end, a non-wall error and an unread shape read as no wall", () => {
    expect(wallInStream('{"type":"result","is_error":false,"result":"done"}\n', "claude")).toBe(
      null,
    );
    expect(
      wallInStream('{"type":"turn.failed","error":{"message":"bad gateway"}}\n', "codex"),
    ).toBe(null);
    expect(
      wallInStream('{"type":"turn.failed","error":{"message":"Rate limit exceeded"}}\n', "grok"),
    ).toBe(null);
    expect(wallInStream("", "codex")).toBe(null);
  });
});

describe("roleHarness", () => {
  const config = {
    team: {
      coachman: { harness: "muse" },
      coachman_fallback: { harness: "codex" },
    },
  };

  test("each role reads its own harness", () => {
    expect(roleHarness(config, "coachman", "synthesis")).toBe("muse");
    expect(roleHarness(config, "coachman_fallback", "synthesis")).toBe("codex");
  });

  test("a per-leg coachman wins over the shared one", () => {
    const legged = {
      team: {
        coachman: { harness: "muse" },
        coachman_legs: { synthesis: { harness: "claude" } },
      },
    };
    expect(roleHarness(legged, "coachman", "synthesis")).toBe("claude");
    expect(roleHarness(legged, "coachman", "review")).toBe("muse");
  });

  test("a missing table or harness reads as none", () => {
    expect(roleHarness({}, "coachman", "synthesis")).toBe(null);
    expect(roleHarness({ team: {} }, "coachman_fallback", "synthesis")).toBe(null);
    expect(roleHarness(null, "coachman", "synthesis")).toBe(null);
    expect(roleHarness(config, "postmaster", "synthesis")).toBe(null);
  });
});

describe("surfaceKind", () => {
  test("both vocabularies denote their kind, the rest denote none", () => {
    expect(surfaceKind("cli")).toBe("cli");
    expect(surfaceKind("web")).toBe("web");
    expect(surfaceKind("library")).toBe("library");
    expect(surfaceKind("cli-examples")).toBe("cli");
    expect(surfaceKind("browser-suite")).toBe("web");
    expect(surfaceKind("web-journey")).toBe("web");
    expect(surfaceKind("library-tests")).toBe("library");
    expect(surfaceKind("telegraph")).toBe(null);
    expect(surfaceKind("")).toBe(null);
    expect(surfaceKind("constructor")).toBe(null);
    expect(surfaceKind("toString")).toBe(null);
    expect(surfaceKind("__proto__")).toBe(null);
    expect(surfaceKind("hasOwnProperty")).toBe(null);
  });
});

describe("orderKinds", () => {
  test("dedups to canonical cli, web, library order", () => {
    expect(orderKinds(["web", "cli"])).toEqual(["cli", "web"]);
    expect(orderKinds(["library", "library", "cli"])).toEqual(["cli", "library"]);
    expect(orderKinds([])).toEqual([]);
  });
});

describe("renderTemplate", () => {
  test("fills from explicit names and refuses leftovers", () => {
    expect(renderTemplate("{{A}} and {{B}}", { A: "x", B: "y" })).toBe("x and y");
    expect(() => renderTemplate("{{A}} {{NOPE}}", { A: "x" })).toThrow(
      "unknown placeholder in the prompt template: {{NOPE}}",
    );
  });

  test("a value copies literally, never rescanned", () => {
    expect(renderTemplate("{{A}}", { A: "$& {{B}}" })).toBe("$& {{B}}");
  });
});

describe("hasUpkeepLine", () => {
  test("the line reads present exact near the top, even wrapped across lines", () => {
    expect(hasUpkeepLine(`# Title\n\nParagraph.\n\n${UPKEEP_LINE}\n\n## Launch`)).toBe(true);
    expect(hasUpkeepLine(UPKEEP_LINE.replace(/ /gu, "\n"))).toBe(true);
  });

  test("a changed case, a buried copy and a paraphrase read absent", () => {
    expect(
      hasUpkeepLine(
        "A CHANGE which adds, changes or removes a feature updates that feature's page in the same change.",
      ),
    ).toBe(false);
    expect(hasUpkeepLine(`${"filler\n".repeat(30)}${UPKEEP_LINE}`)).toBe(false);
    expect(hasUpkeepLine("Keep the pages current when features change.")).toBe(false);
    expect(hasUpkeepLine("")).toBe(false);
  });
});

describe("indexNames", () => {
  test("folder and prose together read named", () => {
    expect(indexNames("- cli (verifier/cli/): command line", "cli")).toBe(true);
    expect(indexNames("- WEB (verifier/web/): Web Pages", "web")).toBe(true);
  });

  test("a relative folder link reads named", () => {
    expect(indexNames("- [cli](cli/) verifies the command line.", "cli")).toBe(true);
    expect(indexNames("- [web](web/) verifies the web pages.", "web")).toBe(true);
  });

  test("a missing folder or prose reads unnamed", () => {
    expect(indexNames("- cli: command line", "cli")).toBe(false);
    expect(indexNames("- cli (verifier/cli/)", "cli")).toBe(false);
    expect(indexNames("- [cli](cli/)", "cli")).toBe(false);
    expect(indexNames("", "cli")).toBe(false);
  });

  test("a wrong folder with the prose elsewhere reads unnamed", () => {
    expect(indexNames("- [cli](verifier/cli-extra/): command line", "cli")).toBe(false);
    expect(
      indexNames("- [cli](verifier/cli/): command line. See web pages at https://x/web/.", "web"),
    ).toBe(false);
    expect(
      indexNames("- [cli](cli/): command line. Web pages (web/) are not covered here.", "web"),
    ).toBe(false);
  });

  test("folder and prose on different lines read unnamed", () => {
    expect(indexNames("- [cli](cli/)\n- the command line verifier", "cli")).toBe(false);
  });
});

describe("proseList", () => {
  test("joins the prose with commas", () => {
    expect(proseList(["cli", "web"])).toBe("command line, web pages");
    expect(proseList(["library"])).toBe("library interface");
  });
});

describe("dirLines", () => {
  test("one mapping line per kind", () => {
    expect(dirLines(["cli", "web"])).toBe(
      "- the command line (cli) verifier goes in verifier/cli/\n- the web pages (web) verifier goes in verifier/web/",
    );
  });
});

describe("unlistedSentence", () => {
  test("none left out leaves no sentence", () => {
    expect(unlistedSentence(["cli", "web", "library"])).toBe("");
  });

  test("one left out is named", () => {
    expect(unlistedSentence(["cli", "web"])).toBe(
      "- Make no verifier for the library interface. If you notice it while you work, leave it out.",
    );
  });

  test("two left out share the sentence", () => {
    expect(unlistedSentence(["web"])).toBe(
      "- Make no verifier for the command line and the library interface. If you notice them while you work, leave them out.",
    );
  });
});

describe("joinBodies", () => {
  test("numbers each body and separates with rules", () => {
    expect(
      joinBodies([
        { kind: "cli", text: "CLI BODY" },
        { kind: "web", text: "WEB BODY" },
      ]),
    ).toBe(
      "---\n\n**Verifier 1 of 2: command line (cli).**\n\nCLI BODY\n\n---\n\n**Verifier 2 of 2: web pages (web).**\n\nWEB BODY",
    );
  });
});

describe("branchFileText", () => {
  test("a committed file reads its text, the rest read null", () => {
    const dir = tempDir();
    try {
      const repo = join(dir, "app");
      initRepo(repo);
      writeRepoFile(repo, "note.md", "hi");
      commitAll(repo, "first");
      expect(branchFileText(repo, "main", "note.md")).toBe("hi");
      expect(branchFileText(repo, "main", "missing.md")).toBe(null);
      expect(branchFileText(repo, "nope", "note.md")).toBe(null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("addedPaths", () => {
  test("lists paths added past the base, null for a bad ref", () => {
    const dir = tempDir();
    try {
      const repo = join(dir, "app");
      initRepo(repo);
      writeRepoFile(repo, "README.md", "# app\n");
      commitAll(repo, "base");
      const base = gitOrThrow(repo, "rev-parse", "HEAD").trim();
      gitOrThrow(repo, "checkout", "-qb", "verify-cli-web");
      writeRepoFile(repo, "verifier/README.md", "index\n");
      writeRepoFile(repo, "README.md", "# app changed\n");
      commitAll(repo, "session work");
      expect(addedPaths(repo, base, "verify-cli-web")).toEqual(["verifier/README.md"]);
      expect(addedPaths(repo, base, "nope")).toBe(null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("outsideAdded", () => {
  test("flags added paths outside verifier/, besides the handover", () => {
    expect(outsideAdded(["verifier/README.md", "HANDOVER.md"])).toEqual([]);
    expect(outsideAdded(["verifier/cli/README.md", "verify-old/x.md"])).toEqual([
      "verify-old/x.md",
    ]);
    expect(outsideAdded(["verifier/cli/README.md", "verifier-cli/README.md"])).toEqual([
      "verifier-cli/README.md",
    ]);
    expect(outsideAdded(["notes.md"])).toEqual(["notes.md"]);
  });
});

describe("addedUnder", () => {
  test("keeps added paths under a directory", () => {
    expect(
      addedUnder(["verifier/web/README.md", "verifier/cli/README.md"], "verifier/web"),
    ).toEqual(["verifier/web/README.md"]);
    expect(addedUnder(["verifier/README.md"], "verifier/web")).toEqual([]);
  });
});

describe("strayVerifierPaths", () => {
  test("keeps added verifier paths outside the listed verifiers and the index", () => {
    expect(
      strayVerifierPaths(
        [
          "verifier/README.md",
          "verifier/cli/README.md",
          "verifier/library/README.md",
          "verifier/api/README.md",
          "verifier/notes.md",
        ],
        ["cli", "web"],
      ).sort(),
    ).toEqual(["verifier/api/README.md", "verifier/library/README.md", "verifier/notes.md"]);
    expect(strayVerifierPaths(["verifier/README.md", "verifier/cli/x.md"], ["cli"])).toEqual([]);
  });
});

describe("addedFeaturePages", () => {
  test("counts added markdown pages besides the features index", () => {
    expect(
      addedFeaturePages(
        ["verifier/cli/features/README.md", "verifier/cli/features/a.md", "verifier/cli/x.txt"],
        "verifier/cli",
      ),
    ).toEqual(["verifier/cli/features/a.md"]);
  });
});

function seedMultiBranch(
  repo: string,
  baseFiles: Record<string, string>,
  branchFiles: Record<string, string>,
): { base: string; branch: string } {
  for (const [rel, text] of Object.entries(baseFiles)) writeRepoFile(repo, rel, text);
  commitAll(repo, "base");
  const base = gitOrThrow(repo, "rev-parse", "HEAD").trim();
  gitOrThrow(repo, "checkout", "-qb", "verify-cli-web");
  for (const [rel, text] of Object.entries(branchFiles)) writeRepoFile(repo, rel, text);
  commitAll(repo, "session work");
  return { base, branch: "verify-cli-web" };
}

function goodVerifiers(
  kinds: ("cli" | "web" | "library")[] = ["cli", "web"],
): Record<string, string> {
  const prose: Record<string, string> = {
    cli: "command line",
    web: "web pages",
    library: "library interface",
  };
  const files: Record<string, string> = {
    "verifier/README.md": `# Verifiers\n\n${kinds
      .map((k) => `- [${k}](${k}/) verifies the ${prose[k]}.`)
      .join("\n")}\n`,
    "HANDOVER.md": "proved both\n",
  };
  for (const kind of kinds) {
    files[`verifier/${kind}/README.md`] = `# ${kind}\n\nDrives it.\n\n${UPKEEP_LINE}\n`;
    files[`verifier/${kind}/features/README.md`] = "# features\n";
    for (const page of ["a.md", "b.md", "c.md"]) {
      files[`verifier/${kind}/features/${page}`] = "# f\n";
    }
  }
  return files;
}

function checkBranch(
  baseFiles: Record<string, string>,
  branchFiles: Record<string, string>,
  surfaces: ("cli" | "web" | "library")[],
): () => void {
  const dir = tempDir();
  const repo = join(dir, "app");
  initRepo(repo);
  const { base, branch } = seedMultiBranch(repo, baseFiles, branchFiles);
  return () => {
    try {
      checkMultiVerifiers(repo, branch, base, surfaces);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

describe("checkMultiVerifiers", () => {
  test("a branch adding two complete verifiers passes", () => {
    expect(checkBranch({ "README.md": "# app\n" }, goodVerifiers(), ["cli", "web"])).not.toThrow();
  });

  test("a missing index fails", () => {
    const files = goodVerifiers();
    delete files["verifier/README.md"];
    expect(checkBranch({ "README.md": "# app\n" }, files, ["cli", "web"])).toThrow();
  });

  test("a missing verifier README fails", () => {
    const files = goodVerifiers();
    delete files["verifier/cli/README.md"];
    expect(checkBranch({ "README.md": "# app\n" }, files, ["cli", "web"])).toThrow();
  });

  test("a missing features index fails", () => {
    const files = goodVerifiers();
    delete files["verifier/cli/features/README.md"];
    expect(checkBranch({ "README.md": "# app\n" }, files, ["cli", "web"])).toThrow();
  });

  test("a missing feature page fails", () => {
    const files = goodVerifiers();
    delete files["verifier/cli/features/c.md"];
    expect(checkBranch({ "README.md": "# app\n" }, files, ["cli", "web"])).toThrow();
  });

  test("a missing upkeep line and a wrong index entry fail", () => {
    const noUpkeep = goodVerifiers();
    noUpkeep["verifier/cli/README.md"] = "# cli\n\nDrives it.\n";
    expect(checkBranch({ "README.md": "# app\n" }, noUpkeep, ["cli", "web"])).toThrow(/upkeep/u);
    const wrongIndex = goodVerifiers();
    wrongIndex["verifier/README.md"] =
      "# Verifiers\n\n- [cli](verifier/cli-extra/): command line.\n- [web](web/) verifies the web pages.\n";
    expect(checkBranch({ "README.md": "# app\n" }, wrongIndex, ["cli", "web"])).toThrow(
      /names no command line/u,
    );
  });

  test("an added unlisted verifier fails, pre-existing content passes", () => {
    const stray = goodVerifiers();
    stray["verifier/library/README.md"] = "# library\n";
    expect(checkBranch({ "README.md": "# app\n" }, stray, ["cli", "web"])).toThrow(
      /unlisted library/u,
    );
    expect(
      checkBranch(
        { "README.md": "# app\n", "verifier/web/README.md": "# old web\n" },
        goodVerifiers(["cli", "library"]),
        ["cli", "library"],
      ),
    ).not.toThrow();
  });

  test("an unknown verifier folder and a stray index sibling fail", () => {
    const api = goodVerifiers();
    api["verifier/api/README.md"] = "# api\n";
    expect(checkBranch({ "README.md": "# app\n" }, api, ["cli", "web"])).toThrow(/unlisted api/u);
    const sibling = goodVerifiers();
    sibling["verifier/notes.md"] = "stray\n";
    expect(checkBranch({ "README.md": "# app\n" }, sibling, ["cli", "web"])).toThrow(
      /unlisted notes\.md/u,
    );
  });

  test("files added outside verifier/ fail, wherever they land", () => {
    const top = goodVerifiers();
    top["verifier-cli/README.md"] = "# stray\n";
    expect(checkBranch({ "README.md": "# app\n" }, top, ["cli", "web"])).toThrow(
      /outside verifier/u,
    );
    const nested = goodVerifiers();
    nested["verify-app/extra.md"] = "stray\n";
    expect(
      checkBranch({ "README.md": "# app\n", "verify-app/README.md": "# old\n" }, nested, [
        "cli",
        "web",
      ]),
    ).toThrow(/outside verifier/u);
  });

  test("an unlistable comparison fails instead of passing", () => {
    const dir = tempDir();
    try {
      const repo = join(dir, "app");
      initRepo(repo);
      const { base } = seedMultiBranch(repo, { "README.md": "# app\n" }, goodVerifiers());
      expect(() => checkMultiVerifiers(repo, "nope", base, ["cli", "web"])).toThrow(
        /cannot be compared/u,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("check and land args", () => {
  test("check takes a repo, a branch, a run and a hand-over", () => {
    expect(parseArgs(["check", "/r", "verify-x", "--run", "/d", "--handover", "/h"])).toEqual({
      ok: true,
      req: {
        cmd: "check",
        repo: "/r",
        branch: "verify-x",
        dispatch: "/d",
        handover: "/h",
        folder: null,
        timeout: 3600,
      },
    });
  });

  test("land takes the same plus an optional route", () => {
    expect(
      parseArgs([
        "land",
        "/r",
        "verify-x",
        "--run",
        "/d",
        "--handover",
        "/h",
        "--folder",
        "custom/",
        "--timeout",
        "60",
        "--landing",
        "local",
      ]),
    ).toEqual({
      ok: true,
      req: {
        cmd: "land",
        repo: "/r",
        branch: "verify-x",
        dispatch: "/d",
        handover: "/h",
        folder: "custom",
        timeout: 60,
        landing: "local",
      },
    });
    const bare = parseArgs(["land", "/r", "verify-x", "--run", "/d", "--handover", "/h"]);
    expect(bare).toEqual({
      ok: true,
      req: {
        cmd: "land",
        repo: "/r",
        branch: "verify-x",
        dispatch: "/d",
        handover: "/h",
        folder: null,
        timeout: 3600,
        landing: null,
      },
    });
  });

  test("a missing branch, run, hand-over or folder value fails", () => {
    expect(parseArgs(["check", "/r"])).toEqual({
      ok: false,
      error: "check takes a repo and a branch",
    });
    expect(parseArgs(["check", "/r", "b", "--handover", "/h"])).toEqual({
      ok: false,
      error: "check needs --run <dispatch>",
    });
    expect(parseArgs(["land", "/r", "b", "--run", "/d"])).toEqual({
      ok: false,
      error: "land needs --handover <file>",
    });
    expect(parseArgs(["check", "/r", "b", "--run", "/d", "--handover", "/h", "--folder"])).toEqual({
      ok: false,
      error: "check needs --folder <dir>",
    });
  });

  test("a bad folder, route, timeout or flag fails", () => {
    expect(
      parseArgs(["check", "/r", "b", "--run", "/d", "--handover", "/h", "--folder", "/abs"]).ok,
    ).toBe(false);
    expect(
      parseArgs(["land", "/r", "b", "--run", "/d", "--handover", "/h", "--landing", "sideways"]),
    ).toEqual({ ok: false, error: "bad landing: sideways (local or pull-request)" });
    expect(
      parseArgs(["check", "/r", "b", "--run", "/d", "--handover", "/h", "--landing", "local"]),
    ).toEqual({ ok: false, error: "unknown flag for check: --landing" });
    expect(
      parseArgs(["land", "/r", "b", "--run", "/d", "--handover", "/h", "--timeout", "soon"]).ok,
    ).toBe(false);
    expect(parseArgs(["check", "/r", "b", "--run", "/d", "--handover", "/h", "--fresh"]).ok).toBe(
      false,
    );
  });
});

describe("normalizeFolder", () => {
  test("strips a leading ./ and trailing slashes", () => {
    expect(normalizeFolder("verify-app/")).toEqual({ ok: true, folder: "verify-app" });
    expect(normalizeFolder("./verify-app")).toEqual({ ok: true, folder: "verify-app" });
    expect(normalizeFolder("./a/b//")).toEqual({ ok: true, folder: "a/b" });
    expect(normalizeFolder("a/b")).toEqual({ ok: true, folder: "a/b" });
  });

  test("an empty, absolute or escaping folder fails", () => {
    expect(normalizeFolder("").ok).toBe(false);
    expect(normalizeFolder(".").ok).toBe(false);
    expect(normalizeFolder("/tmp/x").ok).toBe(false);
    expect(normalizeFolder("a/../b").ok).toBe(false);
    expect(normalizeFolder("..").ok).toBe(false);
  });
});

describe("parseHandover", () => {
  test("one section with its folder and proof", () => {
    expect(
      parseHandover("# Handover\n\n## Verifier: cli\nFolder: verify-app\nProof: /tmp/p.log\n"),
    ).toEqual({
      ok: true,
      entries: [{ name: "cli", folder: "verify-app", proof: "/tmp/p.log" }],
    });
  });

  test("several sections keep their order and prose is ignored", () => {
    const parsed = parseHandover(
      [
        "# Handover",
        "",
        "Proved below.",
        "## Verifier: cli",
        "Folder: verify-app/cli",
        "Proof: none - the drive never finished",
        "",
        "What was left undone: the cli drive.",
        "## Verifier: web",
        "Folder: verify-app/web/",
        "Drive: second",
        "Proof: /tmp/w.log",
        "",
      ].join("\n"),
    );
    expect(parsed).toEqual({
      ok: true,
      entries: [
        { name: "cli", folder: "verify-app/cli", proof: "none - the drive never finished" },
        { name: "web", folder: "verify-app/web", proof: "/tmp/w.log" },
      ],
    });
  });

  test("the first Folder: and Proof: line wins, and no section means no entries", () => {
    const parsed = parseHandover(
      "## Verifier: cli\nFolder: a\nFolder: b\nProof: /tmp/1\nProof: /tmp/2\n",
    );
    expect(parsed).toEqual({
      ok: true,
      entries: [{ name: "cli", folder: "a", proof: "/tmp/1" }],
    });
    expect(parseHandover("# Handover\n\nNothing was proved.\n")).toEqual({ ok: true, entries: [] });
  });

  test("a missing Proof: line names no proof file", () => {
    expect(parseHandover("## Verifier: cli\nFolder: verify-app\n")).toEqual({
      ok: true,
      entries: [{ name: "cli", folder: "verify-app", proof: null }],
    });
  });

  test("a missing or escaping folder, a missing or doubled name fails", () => {
    expect(parseHandover("## Verifier: cli\nProof: /tmp/p\n")).toEqual({
      ok: false,
      error: "the hand-over names no folder for cli",
    });
    expect(parseHandover("## Verifier: cli\nFolder: /tmp/x\nProof: /tmp/p\n")).toEqual({
      ok: false,
      error: "the hand-over folder for cli is not inside the repo: /tmp/x",
    });
    expect(parseHandover("## Verifier:\nFolder: a\n")).toEqual({
      ok: false,
      error: "the hand-over has a verifier with no name",
    });
    expect(parseHandover("## Verifier: cli\nFolder: a\n## Verifier: cli\nFolder: b\n")).toEqual({
      ok: false,
      error: "the hand-over names cli twice",
    });
  });
});

describe("classifyEntries", () => {
  const entries = [
    { name: "kept", folder: "v/kept", proof: "/tmp/kept.log" },
    { name: "gone", folder: "v/gone", proof: "/tmp/gone.log" },
    { name: "none", folder: "v/none", proof: "none - no drive" },
    { name: "blank", folder: "v/blank", proof: null },
  ];
  const isFile = (p: string): boolean => p === "/tmp/kept.log";

  test("proven means the proof names an existing absolute file", () => {
    const out = classifyEntries(entries, isFile);
    expect(out.filter((e) => e.proven).map((e) => e.name)).toEqual(["kept"]);
    expect(out.find((e) => e.name === "gone")?.failReason).toBe("proof /tmp/gone.log missing");
    expect(out.find((e) => e.name === "none")?.failReason).toBe("no proof file");
    expect(out.find((e) => e.name === "blank")?.failReason).toBe("no proof file");
  });

  test("a relative proof is no proof file", () => {
    const out = classifyEntries([{ name: "r", folder: "v/r", proof: "proof.log" }], () => true);
    expect(out[0]?.proven).toBe(false);
    expect(out[0]?.failReason).toBe("no proof file");
  });
});

describe("outsidePaths", () => {
  test("only paths under the folder pass", () => {
    expect(outsidePaths(["verify-app/a.md", "verify-app/x/b.ts"], "verify-app")).toEqual([]);
    expect(outsidePaths(["biome.json", "verify-app/a.md", "src/x.ts"], "verify-app")).toEqual([
      "biome.json",
      "src/x.ts",
    ]);
    expect(outsidePaths(["verify-app"], "verify-app")).toEqual(["verify-app"]);
    expect(outsidePaths(["verify-app2/a.md"], "verify-app")).toEqual(["verify-app2/a.md"]);
  });
});

describe("parseVerifyResults", () => {
  test("the gate, the failures and every result in order", () => {
    const summary = parseVerifyResults(
      [
        "gate: pass, exit 0, 1s: npm run check",
        "examples: not run, exit 3, 0s: /tool/scripts/run verify-examples",
        "  the ticket has no User journey",
        "cli: pass, exit 0, 0s: bun src/cli.ts",
      ].join("\n"),
    );
    expect(summary.gate).toBe("pass");
    expect(summary.failed).toEqual([]);
    expect(summary.notRun).toEqual(["examples"]);
    expect(summary.results).toEqual([
      { name: "gate", result: "pass" },
      { name: "examples", result: "not run" },
      { name: "cli", result: "pass" },
    ]);
  });

  test("failures are named and a missing gate reads as none", () => {
    const summary = parseVerifyResults(
      ["gate: fail, exit 1, 1s: npm run check", "cli: fail, exit 1, 0s: bun src/cli.ts"].join("\n"),
    );
    expect(summary.gate).toBe("fail");
    expect(summary.failed).toEqual(["gate", "cli"]);
    expect(summary.notRun).toEqual([]);
    expect(parseVerifyResults("nothing reported\n").gate).toBe(null);
  });
});

describe("unrunProject", () => {
  const kinds = { gate: "project", browser: "project", examples: "tool", journey: "tool" };

  test("a project check unrun refuses; a tool check unrun is expected", () => {
    expect(unrunProject(["browser"], kinds)).toEqual(["browser"]);
    expect(unrunProject(["examples", "journey"], kinds)).toEqual([]);
    expect(unrunProject(["examples", "browser", "journey"], kinds)).toEqual(["browser"]);
  });

  test("the gate stays out, and an unknown kind fails closed", () => {
    expect(unrunProject(["gate"], kinds)).toEqual([]);
    expect(unrunProject(["strange"], kinds)).toEqual(["strange"]);
  });
});

describe("mergeAuthorityOf and defaultLanding", () => {
  test("postmaster is named, anything else is the user", () => {
    expect(mergeAuthorityOf('{"config":{"ship":{"merge_authority":"postmaster"}}}')).toBe(
      "postmaster",
    );
    expect(mergeAuthorityOf('{"config":{"ship":{"merge_authority":"user"}}}')).toBe("user");
    expect(mergeAuthorityOf("{}")).toBe("user");
    expect(mergeAuthorityOf("not json")).toBe("user");
    expect(mergeAuthorityOf("")).toBe("user");
  });

  test("an origin remote means a pull request", () => {
    expect(defaultLanding(true)).toBe("pull-request");
    expect(defaultLanding(false)).toBe("local");
  });
});

describe("timeoutMs and lastLine", () => {
  test("seconds to milliseconds, capped past the timer's range", () => {
    expect(timeoutMs(1)).toBe(1000);
    expect(timeoutMs(3600)).toBe(3600000);
    expect(timeoutMs(999999999)).toBe(2147483647);
  });

  test("the last non-empty trimmed line, or the exit", () => {
    expect(lastLine("first\nsecond\n", 1)).toBe("second");
    expect(lastLine("  padded  \n\n", 2)).toBe("padded");
    expect(lastLine("", 3)).toBe("exit 3");
    expect(lastLine("   \n", 127)).toBe("exit 127");
  });
});

describe("decideCheap and decideChecks", () => {
  const entry = (
    name: string,
    folder: string,
    proven: boolean,
    failReason: string,
    proof: string | null = null,
  ): ClassifiedEntry => ({ name, folder, proof, proven, failReason });
  const cheap = (over: Partial<CheapFacts>): CheapFacts => ({
    branch: "verify-x",
    classified: [],
    failedPresent: [],
    provenEmpty: [],
    outside: [],
    ...over,
  });

  test("no proven verifier names each failure", () => {
    expect(
      decideCheap(
        cheap({
          classified: [
            entry("cli", "v/cli", false, "no proof file"),
            entry("web", "v/web", false, "proof /tmp/w missing", "/tmp/w"),
          ],
        }),
      ),
    ).toBe("no proven verifier (cli: no proof file; web: proof /tmp/w missing)");
    expect(decideCheap(cheap({}))).toBe("no proven verifier (the hand-over names none)");
  });

  test("a failed folder, an empty proven verifier, then outside paths", () => {
    const landed = [entry("web", "v/web", true, "", "/tmp/w")];
    expect(
      decideCheap(
        cheap({
          classified: [...landed, entry("cli", "v/cli", false, "no proof file")],
          failedPresent: [entry("cli", "v/cli", false, "no proof file")],
        }),
      ),
    ).toBe("failed verifier still on the branch: cli (v/cli)");
    expect(
      decideCheap(
        cheap({ classified: landed, provenEmpty: [entry("web", "v/web", true, "", "/tmp/w")] }),
      ),
    ).toBe("proven verifier has no files on the branch: web (v/web)");
    expect(decideCheap(cheap({ classified: landed, outside: ["biome.json", "AGENTS.md"] }))).toBe(
      "outside the verifiers' folder: biome.json, AGENTS.md",
    );
    expect(decideCheap(cheap({ classified: landed }))).toBe(null);
  });

  test("a long outside list is capped", () => {
    const landed = [entry("web", "v/web", true, "", "/tmp/w")];
    const outside = Array.from({ length: 12 }, (_, n) => `f${n}.md`);
    expect(decideCheap(cheap({ classified: landed, outside }))).toBe(
      "outside the verifiers' folder: f0.md, f1.md, f2.md, f3.md, f4.md, f5.md, f6.md, f7.md, f8.md, f9.md and 2 more",
    );
  });

  test("the timeout, the failures, then the gate", () => {
    const ran = (summary: { gate: string | null; failed: string[] }): ChecksOutcome => ({
      kind: "ran",
      summary: { ...summary, notRun: [], results: [] },
      unrunProject: [],
    });
    expect(decideChecks({ kind: "timeout", seconds: 1 })).toBe(
      "past its limit (the checks ran longer than 1s)",
    );
    expect(decideChecks({ kind: "unrunnable", error: "the checks could not run: exit 1" })).toBe(
      "the checks could not run: exit 1",
    );
    expect(decideChecks(ran({ gate: "fail", failed: ["gate", "cli"] }))).toBe(
      "checks failed (gate: fail; cli: fail)",
    );
    expect(decideChecks(ran({ gate: "not run", failed: [] }))).toBe("gate did not pass (not run)");
    expect(decideChecks(ran({ gate: null, failed: [] }))).toBe("gate did not pass (not reported)");
    expect(decideChecks(ran({ gate: "pass", failed: [] }))).toBe(null);
  });

  test("an unrun project check refuses, after the failures", () => {
    const ran = (unrunProject: string[], failed: string[] = []): ChecksOutcome => ({
      kind: "ran",
      summary: { gate: "pass", failed, notRun: unrunProject, results: [] },
      unrunProject,
    });
    expect(decideChecks(ran(["browser"]))).toBe("checks not run (browser: not run)");
    expect(decideChecks(ran(["browser", "cli"]))).toBe(
      "checks not run (browser: not run; cli: not run)",
    );
    expect(decideChecks(ran(["browser"], ["cli"]))).toBe("checks failed (cli: fail)");
    expect(decideChecks(ran([]))).toBe(null);
  });
});

describe("acceptLine and refuseLine", () => {
  test("one line naming what lands and what stays out", () => {
    expect(
      acceptLine("verify-both", [
        { name: "cli", folder: "v/cli", proof: null, proven: false, failReason: "no proof file" },
        { name: "web", folder: "v/web", proof: "/tmp/w", proven: true, failReason: "" },
      ]),
    ).toBe(
      "accept: verify-both lands 1 verifier: web (v/web, proof /tmp/w); left out: cli (no proof file)",
    );
    expect(
      acceptLine("verify-cli", [
        { name: "cli", folder: "v", proof: "/tmp/p", proven: true, failReason: "" },
      ]),
    ).toBe("accept: verify-cli lands 1 verifier: cli (v, proof /tmp/p); left out: none");
    expect(refuseLine("verify-x", "no proven verifier (none named)")).toBe(
      "refuse: verify-x lands nothing: no proven verifier (none named)",
    );
  });
});

describe("listArgs", () => {
  test("list takes a repo alone", () => {
    expect(parseArgs(["list", "/r"])).toEqual({ ok: true, req: { cmd: "list", repo: "/r" } });
  });

  test("list without a repo or with a third word fails", () => {
    expect(parseArgs(["list"])).toEqual({ ok: false, error: "list takes a repo" });
    expect(parseArgs(["list", "/r", "cli"])).toEqual({ ok: false, error: "list takes a repo" });
  });
});

describe("kindProse", () => {
  test("known kinds read in prose, unknown kinds read null", () => {
    expect(kindProse("cli")).toBe("command line");
    expect(kindProse("web")).toBe("web pages");
    expect(kindProse("library")).toBe("library interface");
    expect(kindProse("telegraph")).toBeNull();
  });
});

describe("surfaceFromReadme", () => {
  test("the H1 prose names the surface", () => {
    expect(surfaceFromReadme("# todo on the command line\n")).toBe("command line");
    expect(surfaceFromReadme("# Driving the web pages\n")).toBe("web pages");
    expect(surfaceFromReadme("# Notes on the library interface\n")).toBe("library interface");
  });

  test("the earliest phrase wins over a later aside", () => {
    expect(surfaceFromReadme("For the web pages, unlike the command line below")).toBe("web pages");
    expect(surfaceFromReadme("On the command line, never the web pages")).toBe("command line");
  });

  test("a short token alone names its surface", () => {
    expect(surfaceFromReadme("Run `bun src/cli.ts` with a fresh file.\n")).toBe("command line");
  });

  test("a token inside a longer word names nothing", () => {
    expect(surfaceFromReadme("Click the button twice.\n")).toBeNull();
  });

  test("a bare library names nothing: it is usually the project's own code", () => {
    expect(surfaceFromReadme("Driven through the project's own library.\n")).toBeNull();
  });

  test("past the head, and an empty file, name nothing", () => {
    const buried = `${"filler\n".repeat(30)}on the command line\n`;
    expect(surfaceFromReadme(buried)).toBeNull();
    expect(surfaceFromReadme("")).toBeNull();
  });
});

describe("featurePageNames", () => {
  test("markdown besides the index, sorted", () => {
    expect(featurePageNames(["list.md", "README.md", "helper.ts", "add.md"])).toEqual([
      "add.md",
      "list.md",
    ]);
    expect(featurePageNames(["README.md"])).toEqual([]);
  });
});

describe("renderListing", () => {
  test("no verifiers print the none line", () => {
    expect(renderListing({ indexes: [], verifiers: [] })).toBe("verifiers: none");
  });

  test("one verifier prints its block under the index", () => {
    expect(
      renderListing({
        indexes: ["verifier/README.md"],
        verifiers: [
          {
            folder: "verifier/cli",
            surface: "command line",
            pages: ["verifier/cli/features/add.md", "verifier/cli/features/list.md"],
          },
        ],
      }),
    ).toBe(
      [
        "index: verifier/README.md",
        "verifier: verifier/cli",
        "surface: command line",
        "features: verifier/cli/features/add.md verifier/cli/features/list.md",
      ].join("\n"),
    );
  });

  test("a verifier without pages prints features none", () => {
    expect(
      renderListing({
        indexes: ["verify-app/README.md"],
        verifiers: [{ folder: "verify-app", surface: "command line", pages: [] }],
      }),
    ).toContain("features: none");
  });
});

describe("listVerifiers", () => {
  const plant = (root: string, rel: string, text: string): void => {
    const target = join(root, rel);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, text);
  };

  test("multi: the index with one verifier per folder", () => {
    const root = tempDir();
    try {
      plant(root, "verifier/README.md", "# Verifiers\n");
      plant(root, "verifier/cli/README.md", "# todo on the command line\n");
      plant(root, "verifier/cli/features/add.md", "# add\n");
      plant(root, "verifier/cli/features/README.md", "# features\n");
      expect(listVerifiers(root)).toEqual({
        indexes: ["verifier/README.md"],
        verifiers: [
          {
            folder: "verifier/cli",
            surface: "command line",
            pages: ["verifier/cli/features/add.md"],
          },
        ],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("multi without the index: each verifier README is the read-first entry", () => {
    const root = tempDir();
    try {
      plant(root, "verifier/cli/README.md", "# todo on the command line\n");
      expect(listVerifiers(root)).toEqual({
        indexes: ["verifier/cli/README.md"],
        verifiers: [{ folder: "verifier/cli", surface: "command line", pages: [] }],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("single: a verify- folder with a README", () => {
    const root = tempDir();
    try {
      plant(root, "verify-app/README.md", "Run `bun src/cli.ts`.\n");
      plant(root, "verify-app/features/add.md", "# add\n");
      expect(listVerifiers(root)).toEqual({
        indexes: ["verify-app/README.md"],
        verifiers: [
          {
            folder: "verify-app",
            surface: "command line",
            pages: ["verify-app/features/add.md"],
          },
        ],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a surface the README never states reads unstated", () => {
    const root = tempDir();
    try {
      plant(root, "verify-app/README.md", "# Notes\n\nDrive it somehow.\n");
      expect(listVerifiers(root)?.verifiers[0]?.surface).toBe("unstated");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a verify- file, a README-less folder and a bare tree hold nothing", () => {
    const root = tempDir();
    try {
      plant(root, "verify-notes.txt", "not a verifier\n");
      mkdirSync(join(root, "verify-empty"));
      expect(listVerifiers(root)).toEqual({ indexes: [], verifiers: [] });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("upkeep args", () => {
  test("upkeep takes a repo, a run, a timeout and a folder", () => {
    expect(
      parseArgs(["upkeep", "/r", "--run", "/d", "--timeout", "60", "--folder", "custom/"]),
    ).toEqual({
      ok: true,
      req: { cmd: "upkeep", repo: "/r", dispatch: "/d", timeout: 60, folder: "custom" },
    });
    expect(parseArgs(["upkeep", "/r", "--run", "/d"])).toEqual({
      ok: true,
      req: { cmd: "upkeep", repo: "/r", dispatch: "/d", timeout: 3600, folder: null },
    });
  });

  test("upkeep-prompt takes a repo, a headless flag and a folder", () => {
    expect(parseArgs(["upkeep-prompt", "/r", "--headless", "--folder", "./v"])).toEqual({
      ok: true,
      req: { cmd: "upkeep-prompt", repo: "/r", headless: true, folder: "v" },
    });
    expect(parseArgs(["upkeep-prompt", "/r"])).toEqual({
      ok: true,
      req: { cmd: "upkeep-prompt", repo: "/r", headless: false, folder: null },
    });
  });

  test("upkeep-report takes a repo, a run, a report and a folder", () => {
    expect(
      parseArgs(["upkeep-report", "/r", "--run", "/d", "--report", "/u", "--folder", "v/"]),
    ).toEqual({
      ok: true,
      req: { cmd: "upkeep-report", repo: "/r", dispatch: "/d", report: "/u", folder: "v" },
    });
  });

  test("a missing repo, run, report or flag value fails", () => {
    expect(parseArgs(["upkeep"])).toEqual({ ok: false, error: "upkeep takes a repo" });
    expect(parseArgs(["upkeep", "/r"])).toEqual({
      ok: false,
      error: "upkeep needs --run <dispatch>",
    });
    expect(parseArgs(["upkeep-report", "/r", "--run", "/d"])).toEqual({
      ok: false,
      error: "upkeep-report needs --report <file>",
    });
    expect(parseArgs(["upkeep-prompt", "/r", "--folder"])).toEqual({
      ok: false,
      error: "upkeep-prompt needs --folder <dir>",
    });
    expect(parseArgs(["upkeep", "/r", "--run"])).toEqual({
      ok: false,
      error: "upkeep needs --run <dispatch>",
    });
  });

  test("a misplaced flag fails", () => {
    expect(parseArgs(["upkeep", "/r", "--run", "/d", "--headless"])).toEqual({
      ok: false,
      error: "unknown flag for upkeep: --headless",
    });
    expect(parseArgs(["upkeep-prompt", "/r", "--run", "/d"])).toEqual({
      ok: false,
      error: "unknown flag for upkeep-prompt: --run",
    });
    expect(
      parseArgs(["upkeep-report", "/r", "--run", "/d", "--report", "/u", "--timeout", "5"]),
    ).toEqual({
      ok: false,
      error: "unknown flag for upkeep-report: --timeout",
    });
    expect(parseArgs(["upkeep", "/r", "--run", "/d", "--report", "/u"])).toEqual({
      ok: false,
      error: "unknown flag for upkeep: --report",
    });
    expect(parseArgs(["upkeep-prompt", "/r", "--fresh"])).toEqual({
      ok: false,
      error: "unknown flag for upkeep-prompt: --fresh",
    });
  });

  test("a bad folder or timeout fails", () => {
    expect(parseArgs(["upkeep", "/r", "--run", "/d", "--folder", "/abs"]).ok).toBe(false);
    expect(parseArgs(["upkeep", "/r", "--run", "/d", "--timeout", "soon"]).ok).toBe(false);
  });
});

describe("upkeep naming", () => {
  test("the upkeep branch numbers past branches taken", () => {
    expect(pickUpkeepBranch(() => false)).toBe("upkeep");
    expect(pickUpkeepBranch((n) => n === "upkeep")).toBe("upkeep-2");
    expect(pickUpkeepBranch((n) => n !== "upkeep-3")).toBe("upkeep-3");
  });

  test("the upkeep worktree sits beside the repo, numbered past paths taken", () => {
    expect(pickUpkeepWorktree("/x/app", () => false)).toBe("/x/app-upkeep");
    expect(pickUpkeepWorktree("/x/app", (p) => p === "/x/app-upkeep")).toBe("/x/app-upkeep-2");
  });
});

describe("upkeepSendText", () => {
  test("points the session at its instructions file", () => {
    const text = upkeepSendText("/d/logs/verifier-upkeep-prompt.txt");
    expect(text).toContain("/d/logs/verifier-upkeep-prompt.txt");
    expect(text).toMatch(/upkeep pass/u);
    expect(text.endsWith("\n")).toBe(true);
  });
});

describe("upkeep unasked rule", () => {
  test("the headless rule files unasked questions in the report", () => {
    expect(UPKEEP_HEADLESS_UNASKED).toContain("UPKEEP.md");
    expect(UPKEEP_HEADLESS_UNASKED).toContain("## Unasked:");
    expect(UPKEEP_HEADLESS_UNASKED).toContain("Needed:");
  });
});

describe("waitForFile", () => {
  test("a fresh file already there returns after one settle nap", () => {
    const dir = tempDir();
    try {
      const wt = join(dir, "wt");
      mkdirSync(wt, { recursive: true });
      writeFileSync(join(wt, "UPKEEP.md"), "hi\n");
      const naps: number[] = [];
      expect(
        waitForFile(
          wt,
          "UPKEEP.md",
          0,
          60,
          (ms) => {
            naps.push(ms);
          },
          () => 1000,
        ),
      ).toBe(true);
      expect(naps).toEqual([5000]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a file still being written waits for it to settle", () => {
    const dir = tempDir();
    try {
      const wt = join(dir, "wt");
      mkdirSync(wt, { recursive: true });
      const naps: number[] = [];
      let now = 0;
      let writes = 0;
      const ok = waitForFile(
        wt,
        "UPKEEP.md",
        0,
        60,
        (ms) => {
          naps.push(ms);
          now += ms;
          writes++;
          // Grows every nap but the third: two writes may share an mtime,
          // so the growing size is what keeps the wait from settling early.
          if (writes <= 2)
            writeFileSync(join(wt, "UPKEEP.md"), `part ${writes}\n${"x".repeat(writes)}`);
        },
        () => now,
      );
      expect(ok).toBe(true);
      expect(naps).toEqual([5000, 5000, 5000]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a file that never settles gives up at the timeout", () => {
    const dir = tempDir();
    try {
      const wt = join(dir, "wt");
      mkdirSync(wt, { recursive: true });
      const naps: number[] = [];
      let now = 0;
      let writes = 0;
      const ok = waitForFile(
        wt,
        "UPKEEP.md",
        0,
        12,
        (ms) => {
          naps.push(ms);
          now += ms;
          writes++;
          writeFileSync(join(wt, "UPKEEP.md"), `${"x".repeat(writes)}\n`);
        },
        () => now,
      );
      expect(ok).toBe(false);
      expect(naps).toEqual([5000, 5000, 2000]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a sibling file never counts, however long the wait", () => {
    const dir = tempDir();
    try {
      const wt = join(dir, "wt");
      mkdirSync(wt, { recursive: true });
      writeFileSync(join(wt, "HANDOVER.md"), "wrong file\n");
      const naps: number[] = [];
      let now = 0;
      const ok = waitForFile(
        wt,
        "UPKEEP.md",
        0,
        6,
        (ms) => {
          naps.push(ms);
          now += ms;
        },
        () => now,
      );
      expect(ok).toBe(false);
      expect(naps).toEqual([5000, 1000]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("upkeep scope", () => {
  test("a feature page is markdown under its verifier's features folder, besides its index", () => {
    expect(isFeaturePage("verify-app", "verify-app/features/a.md")).toBe(true);
    expect(isFeaturePage("verifier/cli", "verifier/cli/features/a.md")).toBe(true);
    expect(isFeaturePage("verify-app", "verify-app/features/README.md")).toBe(false);
    expect(isFeaturePage("verifier/cli", "verifier/cli/features/README.md")).toBe(false);
    expect(isFeaturePage("verify-app", "verify-app/README.md")).toBe(false);
    expect(isFeaturePage("verify-app", "verify-app/features/helper.ts")).toBe(false);
    expect(isFeaturePage("verify-app", "other/features/a.md")).toBe(false);
    expect(isFeaturePage("verify-app", "verify-app/features.md")).toBe(false);
    expect(isFeaturePage("verify-app", "verify-app/features-old/a.md")).toBe(false);
  });

  test("a nested page counts, as make counts it", () => {
    expect(isFeaturePage("verify-app", "verify-app/features/deep/a.md")).toBe(true);
    expect(isFeaturePage("verifier/cli", "verifier/cli/features/deep/a.md")).toBe(true);
  });

  test("a features folder below a subdir is no verifier's, and the multi root is none", () => {
    expect(isFeaturePage("verify-app", "verify-app/notes/features/a.md")).toBe(false);
    expect(isFeaturePage("verifier/cli", "verifier/cli/notes/features/a.md")).toBe(false);
    expect(isFeaturePage("verifier", "verifier/cli/features/a.md")).toBe(false);
  });

  test("detectFolders spans every shape present, the single front page first", () => {
    const dir = tempDir();
    try {
      const repo = join(dir, "app");
      initRepo(repo);
      writeRepoFile(repo, "README.md", "# app\n");
      commitAll(repo, "first");
      expect(detectFolders(repo, null)).toEqual([]);
      expect(detectFolders(repo, "custom")).toEqual(["custom"]);
      writeRepoFile(repo, "verify-app/README.md", "# v\n");
      commitAll(repo, "single");
      expect(detectFolders(repo, null)).toEqual(["verify-app"]);
      writeRepoFile(repo, "verifier/README.md", "- cli\n");
      commitAll(repo, "multi");
      expect(detectFolders(repo, null)).toEqual(["verify-app", "verifier"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("scopeVdirs finds the folder's verifier dirs, and no subdir features", () => {
    const dir = tempDir();
    try {
      const repo = join(dir, "app");
      initRepo(repo);
      writeRepoFile(repo, "verify-app/README.md", "# v\n");
      writeRepoFile(repo, "verify-app/features/a.md", "# a\n");
      writeRepoFile(repo, "verify-app/notes/features/stray.md", "# s\n");
      writeRepoFile(repo, "verifier/README.md", "- cli\n- web\n");
      writeRepoFile(repo, "verifier/cli/README.md", "# c\n");
      writeRepoFile(repo, "verifier/cli/features/a.md", "# a\n");
      writeRepoFile(repo, "verifier/web/README.md", "# w\n");
      writeRepoFile(repo, "verifier/web/features/b.md", "# b\n");
      writeRepoFile(repo, "verifier/empty/README.md", "# e\n");
      commitAll(repo, "first");
      expect(scopeVdirs(repo, "verify-app")).toEqual(["verify-app"]);
      expect(scopeVdirs(repo, "verifier")).toEqual(["verifier/cli", "verifier/web"]);
      expect(scopeVdirs(repo, "missing")).toEqual([]);
      expect(scopeVdirs(join(dir, "nowhere"), "verify-app")).toBe(null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("featurePages lists the folder's pages at the current commit, sorted", () => {
    const dir = tempDir();
    try {
      const repo = join(dir, "app");
      initRepo(repo);
      writeRepoFile(repo, "verify-app/README.md", "# v\n");
      writeRepoFile(repo, "verify-app/features/README.md", "# i\n");
      writeRepoFile(repo, "verify-app/features/b.md", "# b\n");
      writeRepoFile(repo, "verify-app/features/a.md", "# a\n");
      writeRepoFile(repo, "verify-app/control.ts", "// helper\n");
      commitAll(repo, "first");
      expect(featurePages(repo, "verify-app")).toEqual([
        "verify-app/features/a.md",
        "verify-app/features/b.md",
      ]);
      expect(featurePages(repo, "missing")).toEqual([]);
      expect(featurePages(join(dir, "nowhere"), "verify-app")).toBe(null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("featurePages lists nested pages with the flat ones", () => {
    const dir = tempDir();
    try {
      const repo = join(dir, "app");
      initRepo(repo);
      writeRepoFile(repo, "verify-app/README.md", "# v\n");
      writeRepoFile(repo, "verify-app/features/README.md", "# i\n");
      writeRepoFile(repo, "verify-app/features/a.md", "# a\n");
      writeRepoFile(repo, "verify-app/features/deep/b.md", "# b\n");
      commitAll(repo, "first");
      expect(featurePages(repo, "verify-app")).toEqual([
        "verify-app/features/a.md",
        "verify-app/features/deep/b.md",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("featurePages unites a multi folder's kinds, skipping a stray features dir", () => {
    const dir = tempDir();
    try {
      const repo = join(dir, "app");
      initRepo(repo);
      writeRepoFile(repo, "verifier/README.md", "- cli\n");
      writeRepoFile(repo, "verifier/cli/README.md", "# c\n");
      writeRepoFile(repo, "verifier/cli/features/b.md", "# b\n");
      writeRepoFile(repo, "verifier/cli/features/a.md", "# a\n");
      writeRepoFile(repo, "verifier/cli/notes/features/stray.md", "# s\n");
      commitAll(repo, "first");
      expect(featurePages(repo, "verifier")).toEqual([
        "verifier/cli/features/a.md",
        "verifier/cli/features/b.md",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("upkeepScope spans every detected folder's pages", () => {
    const dir = tempDir();
    try {
      const repo = join(dir, "app");
      initRepo(repo);
      writeRepoFile(repo, "verify-app/README.md", "# v\n");
      writeRepoFile(repo, "verify-app/features/old.md", "# o\n");
      writeRepoFile(repo, "verifier/README.md", "- cli\n");
      writeRepoFile(repo, "verifier/cli/README.md", "# c\n");
      writeRepoFile(repo, "verifier/cli/features/new.md", "# n\n");
      commitAll(repo, "first");
      expect(upkeepScope(repo, null)).toEqual({
        folders: ["verify-app", "verifier"],
        pages: ["verifier/cli/features/new.md", "verify-app/features/old.md"],
      });
      expect(upkeepScope(repo, "verifier")).toEqual({
        folders: ["verifier"],
        pages: ["verifier/cli/features/new.md"],
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("upkeepScope refuses a repo with no verifiers, or a folder with no pages", () => {
    const dir = tempDir();
    try {
      const repo = join(dir, "app");
      initRepo(repo);
      writeRepoFile(repo, "README.md", "# app\n");
      commitAll(repo, "first");
      expect(() => upkeepScope(repo, null)).toThrow(`no verifiers in ${repo}`);
      writeRepoFile(repo, "verifier/README.md", "- cli\n");
      writeRepoFile(repo, "verifier/cli/README.md", "# c\n");
      commitAll(repo, "index without verifiers");
      expect(() => upkeepScope(repo, null)).toThrow("no verifiers under verifier in");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("parseUpkeepReport", () => {
  test("reads verifiers, features, claims and unasked questions in order", () => {
    const text = [
      "# Upkeep pass",
      "",
      "## Verifier: cli",
      "Folder: verify-app",
      "prose the parser skips",
      "",
      "## Feature: verify-app/features/add.md",
      "Outcome: changed",
      "",
      "## Claim: add: one task",
      "Page: verify-app/features/add.md",
      "Verdict: stale",
      "Stated: stdout is added 1",
      "Found: stdout is added 2",
      "",
      "## Unasked: the token file",
      "Needed: the login step",
      "",
    ].join("\n");
    expect(parseUpkeepReport(text)).toEqual({
      ok: true,
      report: {
        verifiers: [{ name: "cli", folder: "verify-app" }],
        features: [{ page: "verify-app/features/add.md", outcome: "changed" }],
        claims: [
          {
            name: "add: one task",
            page: "verify-app/features/add.md",
            verdict: "stale",
            stated: "stdout is added 1",
            found: "stdout is added 2",
            because: null,
          },
        ],
        unasked: [{ question: "the token file", needed: "the login step" }],
      },
    });
  });

  test("only the first labeled line of each kind is read", () => {
    const text = [
      "## Feature: p",
      "Outcome: changed",
      "Outcome: clean",
      "",
      "## Claim: c",
      "Page: p",
      "Verdict: stale",
      "Stated: s",
      "Found: first",
      "Found: second",
      "",
    ].join("\n");
    const parsed = parseUpkeepReport(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("the report should parse");
    expect(parsed.report.features).toEqual([{ page: "p", outcome: "changed" }]);
    expect(parsed.report.claims[0]?.found).toBe("first");
  });

  test("a missing folder, outcome, page, verdict, stated result, finding, reason or need fails", () => {
    expect(parseUpkeepReport("## Verifier: cli\n")).toEqual({
      ok: false,
      error: "the report names no folder for cli",
    });
    expect(parseUpkeepReport("## Feature: p\n")).toEqual({
      ok: false,
      error: "the report names no outcome for p",
    });
    expect(parseUpkeepReport("## Claim: c\nVerdict: stale\nStated: s\nFound: f\n")).toEqual({
      ok: false,
      error: "the report names no page for c",
    });
    expect(parseUpkeepReport("## Claim: c\nPage: p\nStated: s\nFound: f\n")).toEqual({
      ok: false,
      error: "the report names no verdict for c",
    });
    expect(parseUpkeepReport("## Claim: c\nPage: p\nVerdict: stale\nFound: f\n")).toEqual({
      ok: false,
      error: "the report names no stated result for c",
    });
    expect(parseUpkeepReport("## Claim: c\nPage: p\nVerdict: stale\nStated: s\n")).toEqual({
      ok: false,
      error: "the report names no finding for c",
    });
    expect(parseUpkeepReport("## Claim: c\nPage: p\nVerdict: unchecked\nStated: s\n")).toEqual({
      ok: false,
      error: "the report names no reason for c",
    });
    expect(parseUpkeepReport("## Unasked: q\n")).toEqual({
      ok: false,
      error: "the report names nothing its unasked question needed: q",
    });
  });

  test("an unknown outcome or verdict fails", () => {
    expect(parseUpkeepReport("## Feature: p\nOutcome: stale\n")).toEqual({
      ok: false,
      error: "the outcome for p is not clean, changed or blocked: stale",
    });
    expect(parseUpkeepReport("## Claim: c\nPage: p\nVerdict: clean\nStated: s\n")).toEqual({
      ok: false,
      error: "the verdict for c is not stale or unchecked: clean",
    });
  });

  test("a section with no name, and a name twice, fails", () => {
    expect(parseUpkeepReport("## Claim:\n").ok).toBe(false);
    const twice = [
      "## Claim: c",
      "Page: p",
      "Verdict: stale",
      "Stated: s",
      "Found: f",
      "",
      "## Claim: c",
      "Page: p",
      "Verdict: stale",
      "Stated: s",
      "Found: f",
      "",
    ].join("\n");
    expect(parseUpkeepReport(twice)).toEqual({
      ok: false,
      error: "the report names c twice",
    });
    expect(
      parseUpkeepReport("## Feature: p\nOutcome: clean\n\n## Feature: p\nOutcome: clean\n"),
    ).toEqual({ ok: false, error: "the report names p twice" });
  });
});

describe("verdictUpkeep", () => {
  const pages = ["v/features/a.md", "v/features/b.md"];
  const verifiers = [{ name: "cli", folder: "v" }];
  function report(over: Partial<UpkeepReport>): UpkeepReport {
    return { verifiers, features: [], claims: [], unasked: [], ...over };
  }

  test("a clean report prints only the summary", () => {
    const decided = verdictUpkeep(
      pages,
      ["v"],
      report({ features: pages.map((page) => ({ page, outcome: "clean" as const })) }),
    );
    expect(decided).toEqual({
      ok: true,
      verdict: { lines: ["features driven: 2, stale: 0, unchecked: 0"], stale: 0, unchecked: 0 },
    });
  });

  test("stale, unchecked and unasked print in report order with the summary", () => {
    const decided = verdictUpkeep(
      ["v/features/a.md"],
      ["v"],
      report({
        features: [{ page: "v/features/a.md", outcome: "changed" }],
        claims: [
          {
            name: "a: one",
            page: "v/features/a.md",
            verdict: "stale",
            stated: "s1",
            found: "f1",
            because: null,
          },
        ],
        unasked: [{ question: "q", needed: "n" }],
      }),
    );
    expect(decided).toEqual({
      ok: true,
      verdict: {
        lines: [
          "stale: a: one (v/features/a.md)",
          "  stated: s1",
          "  found: f1",
          "unasked: q",
          "  needed: n",
          "features driven: 1, stale: 1, unchecked: 0",
        ],
        stale: 1,
        unchecked: 0,
      },
    });
  });

  test("no verifier, or one outside the folder, fails", () => {
    expect(verdictUpkeep(pages, ["v"], report({ verifiers: [] }))).toEqual({
      ok: false,
      error: "the report names no verifier",
    });
    expect(
      verdictUpkeep(pages, ["v"], report({ verifiers: [{ name: "cli", folder: "elsewhere" }] })),
    ).toEqual({
      ok: false,
      error: "the report's verifier cli sits outside v: elsewhere",
    });
  });

  test("a verifier under any spanned folder counts, outside every folder fails", () => {
    const both = ["verify-app", "verifier"];
    const ok = verdictUpkeep(
      ["verify-app/features/a.md"],
      both,
      report({
        verifiers: [{ name: "cli", folder: "verifier/cli" }],
        features: [{ page: "verify-app/features/a.md", outcome: "clean" }],
      }),
    );
    expect(ok).toEqual({
      ok: true,
      verdict: { lines: ["features driven: 1, stale: 0, unchecked: 0"], stale: 0, unchecked: 0 },
    });
    expect(
      verdictUpkeep(
        ["verify-app/features/a.md"],
        both,
        report({
          verifiers: [{ name: "cli", folder: "elsewhere" }],
          features: [{ page: "verify-app/features/a.md", outcome: "clean" }],
        }),
      ),
    ).toEqual({
      ok: false,
      error: "the report's verifier cli sits outside verify-app, verifier: elsewhere",
    });
  });

  test("a page without an outcome, or an outcome for a page not held, fails", () => {
    expect(
      verdictUpkeep(
        pages,
        ["v"],
        report({ features: [{ page: "v/features/a.md", outcome: "clean" }] }),
      ),
    ).toEqual({ ok: false, error: "the report names no outcome for v/features/b.md" });
    expect(
      verdictUpkeep(
        pages,
        ["v"],
        report({
          features: [
            { page: "v/features/a.md", outcome: "clean" },
            { page: "v/features/b.md", outcome: "clean" },
            { page: "v/features/c.md", outcome: "clean" },
          ],
        }),
      ),
    ).toEqual({
      ok: false,
      error: "the report names a page the verifiers do not hold: v/features/c.md",
    });
  });

  test("a changed or blocked page without its claims fails", () => {
    expect(
      verdictUpkeep(
        pages,
        ["v"],
        report({
          features: [
            { page: "v/features/a.md", outcome: "changed" },
            { page: "v/features/b.md", outcome: "clean" },
          ],
        }),
      ),
    ).toEqual({
      ok: false,
      error: "the report names no stale claim for its changed page v/features/a.md",
    });
    expect(
      verdictUpkeep(
        pages,
        ["v"],
        report({
          features: [
            { page: "v/features/a.md", outcome: "blocked" },
            { page: "v/features/b.md", outcome: "clean" },
          ],
        }),
      ),
    ).toEqual({
      ok: false,
      error: "the report names no unchecked claim for its blocked page v/features/a.md",
    });
  });

  test("claims on a clean page, or on a page not held, fail", () => {
    const claim = {
      name: "a: one",
      page: "v/features/a.md",
      verdict: "stale" as const,
      stated: "s",
      found: "f",
      because: null,
    };
    expect(
      verdictUpkeep(
        pages,
        ["v"],
        report({
          features: pages.map((page) => ({ page, outcome: "clean" as const })),
          claims: [claim],
        }),
      ),
    ).toEqual({
      ok: false,
      error: "the report names claims for its clean page v/features/a.md",
    });
    expect(
      verdictUpkeep(
        pages,
        ["v"],
        report({
          features: pages.map((page) => ({ page, outcome: "clean" as const })),
          claims: [{ ...claim, page: "v/features/c.md" }],
        }),
      ),
    ).toEqual({
      ok: false,
      error: "the report's claim a: one sits on no page the verifiers hold: v/features/c.md",
    });
  });

  test("a mixed page is blocked and lists both claims", () => {
    const decided = verdictUpkeep(
      pages,
      ["v"],
      report({
        features: [
          { page: "v/features/a.md", outcome: "blocked" },
          { page: "v/features/b.md", outcome: "clean" },
        ],
        claims: [
          {
            name: "a: one",
            page: "v/features/a.md",
            verdict: "stale",
            stated: "s1",
            found: "f1",
            because: null,
          },
          {
            name: "a: two",
            page: "v/features/a.md",
            verdict: "unchecked",
            stated: "s2",
            found: null,
            because: "b2",
          },
        ],
      }),
    );
    expect(decided).toEqual({
      ok: true,
      verdict: {
        lines: [
          "stale: a: one (v/features/a.md)",
          "  stated: s1",
          "  found: f1",
          "unchecked: a: two (v/features/a.md)",
          "  because: b2",
          "features driven: 2, stale: 1, unchecked: 1",
        ],
        stale: 1,
        unchecked: 1,
      },
    });
  });

  test("a mixed page marked changed fails on the unchecked claim", () => {
    expect(
      verdictUpkeep(
        pages,
        ["v"],
        report({
          features: [
            { page: "v/features/a.md", outcome: "changed" },
            { page: "v/features/b.md", outcome: "clean" },
          ],
          claims: [
            {
              name: "a: one",
              page: "v/features/a.md",
              verdict: "stale",
              stated: "s",
              found: "f",
              because: null,
            },
            {
              name: "a: two",
              page: "v/features/a.md",
              verdict: "unchecked",
              stated: "s",
              found: null,
              because: "b",
            },
          ],
        }),
      ),
    ).toEqual({
      ok: false,
      error: "the report's changed page v/features/a.md carries an unchecked claim",
    });
  });

  test("a stale claim alone on a blocked page still fails", () => {
    expect(
      verdictUpkeep(
        pages,
        ["v"],
        report({
          features: [
            { page: "v/features/a.md", outcome: "blocked" },
            { page: "v/features/b.md", outcome: "clean" },
          ],
          claims: [
            {
              name: "a: one",
              page: "v/features/a.md",
              verdict: "stale",
              stated: "s",
              found: "f",
              because: null,
            },
          ],
        }),
      ),
    ).toEqual({
      ok: false,
      error: "the report names no unchecked claim for its blocked page v/features/a.md",
    });
  });

  test("an unchecked claim alone on a changed page fails", () => {
    expect(
      verdictUpkeep(
        pages,
        ["v"],
        report({
          features: [
            { page: "v/features/a.md", outcome: "changed" },
            { page: "v/features/b.md", outcome: "clean" },
          ],
          claims: [
            {
              name: "a: two",
              page: "v/features/a.md",
              verdict: "unchecked",
              stated: "s",
              found: null,
              because: "b",
            },
          ],
        }),
      ),
    ).toEqual({
      ok: false,
      error: "the report names no stale claim for its changed page v/features/a.md",
    });
  });
});
