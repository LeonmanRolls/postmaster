// Oracle for #348, committed before the change: each workhorse works in its
// own checked copy (C1, C2), out of git's reach of the others (C3), with the
// repository's commit identity and nothing else (C4), brought in at take-in
// (C5). Each test builds a scratch run T and drives the real scripts as
// subprocesses, never importing the change.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./lib/proc.ts";
import {
  checkLane,
  checkWorkhorse,
  copyHead,
  cutWorkhorse,
  laneCommit,
  makeRun,
  readActions,
  repoBranchHead,
  ROOT,
  RUN,
  takeIn,
  touchDone,
  type RunFixture,
} from "./acceptance-348.ts";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "acceptance-348-"));
}

function withRun(body: (fx: RunFixture) => void): void {
  const dir = tempDir();
  try {
    body(makeRun(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function git(dir: string, ...args: string[]) {
  return run("git", ["-C", dir, ...args]);
}

function both(r: { out: string; err: string }): string {
  return `${r.out}\n${r.err}`;
}

describe("C1: each workhorse works in its own copy at BASE on its branch", () => {
  test("cut names a shared clone of the repo at BASE on wb/T-<lane>", () => {
    withRun((fx) => {
      for (const lane of ["luna", "mimo"] as const) {
        const cut = cutWorkhorse(fx, lane);
        expect(cut.code).toBe(0);
        const f = fx.worktree(lane);
        const gitDir = git(f, "rev-parse", "--absolute-git-dir").out.trim();
        const commonDir = git(
          f,
          "rev-parse",
          "--path-format=absolute",
          "--git-common-dir",
        ).out.trim();
        expect(gitDir).toBe(commonDir);
        const alt = readFileSync(join(f, ".git", "objects", "info", "alternates"), "utf8")
          .split("\n")[0]
          ?.trim();
        const repoObjects = join(realpathSync(fx.repo), ".git", "objects");
        expect(realpathSync(alt ?? "")).toBe(repoObjects);
        expect(git(f, "config", "remote.origin.url").out.trim()).toBe(fx.repo);
        expect(git(f, "symbolic-ref", "--short", "HEAD").out.trim()).toBe(fx.branch(lane));
        expect(git(f, "rev-parse", "HEAD").out.trim()).toBe(fx.base);
        const kind = run(RUN, ["cut-scratch", "--kind", f]);
        expect(kind.code).toBe(0);
        expect(kind.out.trim()).toBe(`clone ${fx.repo}`);
      }
    });
  });

  test("the bootstrap step names the cut and the paths table calls them copies", () => {
    const coach = readFileSync(join(ROOT, "skills/postmaster/coachman.md"), "utf8");
    expect(coach).toContain("--cut-workhorse");
    expect(coach).toContain("workhorse copy");
    expect(coach).not.toContain("workhorse worktree");
  });
});

describe("C2: each copy is checked before the workhorses start; one failure stops all", () => {
  test("the check passes a copy at BASE on its branch", () => {
    withRun((fx) => {
      expect(cutWorkhorse(fx, "luna").code).toBe(0);
      expect(checkWorkhorse(fx, "luna").code).toBe(0);
    });
  });

  test("a copy at another commit fails, naming it", () => {
    withRun((fx) => {
      expect(cutWorkhorse(fx, "luna").code).toBe(0);
      laneCommit(fx, "luna", "move.txt", "moved\n");
      expect(copyHead(fx, "luna")).not.toBe(fx.base);
      const r = checkWorkhorse(fx, "luna");
      expect(r.code).not.toBe(0);
      expect(both(r)).toContain("not at");
    });
  });

  test("a copy on another branch fails, naming it", () => {
    withRun((fx) => {
      expect(cutWorkhorse(fx, "luna").code).toBe(0);
      const f = fx.worktree("luna");
      expect(git(f, "checkout", "-q", "-b", "wb/T-elsewhere").code).toBe(0);
      const r = checkWorkhorse(fx, "luna");
      expect(r.code).not.toBe(0);
      expect(both(r)).toContain("not on");
    });
  });

  test("a worktree fails, naming it", () => {
    withRun((fx) => {
      const dest = join(fx.repo, ".worktrees", "T-wt");
      expect(git(fx.repo, "worktree", "add", dest, "-b", "wb/T-wt", fx.base).code).toBe(0);
      const r = run(RUN, ["cut-scratch", "--check-workhorse", fx.repo, dest, fx.base, "wb/T-wt"]);
      expect(r.code).not.toBe(0);
      expect(both(r)).toContain("is a worktree");
    });
  });

  test("a clone of another repository fails, naming it", () => {
    withRun((fx) => {
      const other = join(fx.dir, "other");
      expect(run("git", ["clone", "-q", "--shared", fx.repo, other]).code).toBe(0);
      const dest = join(fx.dir, "copy-of-other");
      const cut = run(RUN, [
        "cut-scratch",
        "--cut-workhorse",
        other,
        dest,
        fx.base,
        fx.branch("luna"),
      ]);
      expect(cut.code).toBe(0);
      const r = run(RUN, [
        "cut-scratch",
        "--check-workhorse",
        fx.repo,
        dest,
        fx.base,
        fx.branch("luna"),
      ]);
      expect(r.code).not.toBe(0);
      expect(both(r)).toContain("not of");
    });
  });

  test("the runbook checks before launch and starts none on failure", () => {
    const coach = readFileSync(join(ROOT, "skills/postmaster/coachman.md"), "utf8");
    expect(coach).toContain("--check-workhorse");
    expect(coach).toContain("If one fails, none starts");
  });
});

describe("C3: a copy cannot reach another workhorse's commits", () => {
  test("log, fetch, cat-file and the object listing miss the other commit; controls hit", () => {
    withRun((fx) => {
      expect(cutWorkhorse(fx, "luna").code).toBe(0);
      expect(cutWorkhorse(fx, "mimo").code).toBe(0);
      const other = laneCommit(fx, "mimo", "other.txt", "the other lane's committed work\n");
      const own = laneCommit(fx, "luna", "own.txt", "my own work\n");
      const a = fx.worktree("luna");
      const log = git(a, "log", "--all", "--oneline");
      expect(log.code).toBe(0);
      expect(log.out).not.toContain(other.slice(0, 7));
      expect(log.out).not.toContain("the other lane's committed work");
      expect(log.out).toContain(own.slice(0, 7));
      expect(git(a, "fetch", "-q", "origin").code).toBe(0);
      expect(git(a, "rev-parse", "-q", "--verify", `origin/${fx.branch("mimo")}`).code).not.toBe(0);
      expect(git(a, "rev-parse", "-q", "--verify", "origin/main").code).toBe(0);
      expect(git(a, "cat-file", "-e", other).code).not.toBe(0);
      expect(git(a, "cat-file", "-e", fx.base).code).toBe(0);
      const all = run("git", ["-C", a, "cat-file", "--batch-all-objects", "--batch-check"]);
      expect(all.code).toBe(0);
      expect(all.out).not.toContain(other);
      expect(all.out).toContain(own);
    });
  });

  test("the hard rule no longer claims safety from no commits and names the copy guard", () => {
    const coach = readFileSync(join(ROOT, "skills/postmaster/coachman.md"), "utf8");
    expect(coach).not.toContain("since no lane has commits until it finishes");
    expect(coach).toContain("cannot reach");
  });
});

describe("C4: a copy commits with the repository's identity and nothing else", () => {
  test("commit succeeds with the same identity; no hooks, credentials or includes ride along", () => {
    const dir = tempDir();
    try {
      const fx = makeRun(dir);
      const repo = fx.repo;
      expect(git(repo, "config", "user.name").out.trim()).not.toBe("");
      expect(git(repo, "config", "core.hooksPath", "/tmp/hooks-348").code).toBe(0);
      expect(git(repo, "config", "credential.helper", "store").code).toBe(0);
      expect(git(repo, "config", "http.proxy", "http://proxy.invalid").code).toBe(0);
      expect(git(repo, "config", "include.path", "/tmp/include-348").code).toBe(0);
      expect(git(repo, "config", "user.signingkey", "DEADBEEF").code).toBe(0);
      const home = join(fx.dir, "empty-home");
      const env = {
        ...process.env,
        HOME: home,
        XDG_CONFIG_HOME: home,
        GIT_CONFIG_NOSYSTEM: "1",
      } as Record<string, string>;
      delete env.GIT_AUTHOR_NAME;
      delete env.GIT_AUTHOR_EMAIL;
      delete env.GIT_COMMITTER_NAME;
      delete env.GIT_COMMITTER_EMAIL;
      const cut = run(
        RUN,
        ["cut-scratch", "--cut-workhorse", repo, fx.worktree("luna"), fx.base, fx.branch("luna")],
        { env },
      );
      expect(cut.code).toBe(0);
      const copy = fx.worktree("luna");
      const local = git(copy, "config", "--local", "--list").out;
      expect(local).not.toContain("core.hooksPath");
      expect(local).not.toContain("credential.");
      expect(local).not.toContain("http.");
      expect(local).not.toContain("include");
      expect(local).not.toContain("user.signingkey");
      const commit = run(
        "git",
        ["-C", copy, "commit", "-q", "--allow-empty", "-m", "copy commit"],
        { env },
      );
      expect(commit.code).toBe(0);
      const fmt = "%an <%ae>|%cn <%ce>";
      const inCopy = run("git", ["-C", copy, "log", "-1", `--format=${fmt}`], { env }).out.trim();
      const repoCommit = run("git", ["-C", repo, "commit", "-q", "--allow-empty", "-m", "repo"], {
        env,
      });
      expect(repoCommit.code).toBe(0);
      const inRepo = run("git", ["-C", repo, "log", "-1", `--format=${fmt}`], { env }).out.trim();
      expect(inCopy).toBe(inRepo);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("C5: take-in brings each checked commit into the repository", () => {
  test("after take-in the repo holds wb/T-<lane> at the logged commit", () => {
    withRun((fx) => {
      expect(cutWorkhorse(fx, "luna").code).toBe(0);
      expect(cutWorkhorse(fx, "mimo").code).toBe(0);
      expect(repoBranchHead(fx, "luna")).toBeNull();
      const head = laneCommit(fx, "luna", "work.txt", "work\n");
      checkLane(fx, "luna");
      checkLane(fx, "mimo");
      touchDone(fx, "luna");
      touchDone(fx, "mimo");
      const r = takeIn(fx);
      expect(r.code).toBe(0);
      expect(r.out).toContain(`luna=${head}`);
      expect(repoBranchHead(fx, "luna")).toBe(head);
      const lines = readActions(fx).filter((a) => a.action === "take-in" && a.target === "luna");
      expect(lines.length).toBe(1);
      expect(lines[0]?.detail).toContain(head);
    });
  });

  test("the runbook brings commits in with fetch and abandonment removes copies with --remove", () => {
    const coach = readFileSync(join(ROOT, "skills/postmaster/coachman.md"), "utf8");
    expect(coach).toContain("fetch");
    const post = readFileSync(join(ROOT, "skills/postmaster/postmaster.md"), "utf8");
    expect(post).toContain("cut-scratch --remove");
  });
});
