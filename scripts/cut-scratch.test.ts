// Tests beside scripts/cut-scratch.ts, moved from its --self-test on #109: 34 controls.
// Order-dependent: later tests reuse the repo and scratches earlier tests cut, as the self-test did.
// Victim labels interpolate fixed short names: the tmp dir exists only at run time, after collection.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cli = join(import.meta.dir, "cut-scratch.sh");

interface Run {
  code: number;
  out: string;
  err: string;
}

function sh(...args: string[]): Run {
  const r = spawnSync(cli, args, { encoding: "utf8" });
  return { code: r.status ?? -1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

function git(...args: string[]): Run {
  const r = spawnSync("git", args, { encoding: "utf8" });
  return { code: r.status ?? -1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

function both(r: Run): string {
  return `${r.out}${r.err}`;
}

let tmp = "";
let repo = "";
let synth = "";
let base = "";
let snap = "";
let savedGitEnv: Record<string, string | undefined> = {};

function need(r: Run, what: string): void {
  if (r.code !== 0) throw new Error(`${what} failed: ${both(r)}`);
}

function commit(repoDir: string, file: string, content: string): Run {
  writeFileSync(join(repoDir, file), `${content}\n`);
  const a = git("-C", repoDir, "add", file);
  if (a.code !== 0) return a;
  return git("-C", repoDir, "commit", "-qm", content);
}

function headOf(dir: string): string {
  return git("-C", dir, "rev-parse", "HEAD").out.trim();
}

const victimNames = ["taken", "repo", "synthesis", "plain", "borrowed", "nowhere"];

function victimPath(name: string): string {
  if (name === "repo") return repo;
  if (name === "synthesis") return synth;
  if (name === "nowhere") return join(repo, "nowhere");
  return join(tmp, name);
}

beforeAll(() => {
  savedGitEnv = {
    GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME,
    GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL,
    GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME,
    GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL,
  };
  process.env.GIT_AUTHOR_NAME = "t";
  process.env.GIT_AUTHOR_EMAIL = "t@example.com";
  process.env.GIT_COMMITTER_NAME = "t";
  process.env.GIT_COMMITTER_EMAIL = "t@example.com";
  const tmpRaw = mkdtempSync(join(tmpdir(), "cut-scratch-"));
  let phys = "";
  try {
    phys = realpathSync(tmpRaw);
  } catch {
    phys = "";
  }
  tmp = phys || tmpRaw;
  repo = join(tmp, "repo");
  need(git("init", "-q", "-b", "main", repo), "init");
  need(commit(repo, "a.txt", "base"), "base commit");
  base = git("-C", repo, "rev-parse", "HEAD").out.trim();
  synth = join(tmp, "synthesis");
  need(git("-C", repo, "worktree", "add", "-q", "-b", "synth", synth), "synthesis worktree");
  writeFileSync(join(synth, "b.txt"), "change\n");
  need(git("-C", synth, "add", "b.txt"), "add b");
  need(git("-C", synth, "commit", "-qm", "change"), "commit change");
  snap = git("-C", synth, "rev-parse", "HEAD").out.trim();
  mkdirSync(join(synth, "node_modules/dep"), { recursive: true });
  writeFileSync(join(synth, "node_modules/dep/index.js"), "x\n");
});

afterAll(() => {
  for (const [k, v] of Object.entries(savedGitEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(tmp, { recursive: true, force: true });
});

describe("positive controls", () => {
  test("a worktree scratch is cut at the snapshot, with its dependencies cloned", () => {
    const r = sh(repo, synth, join(tmp, "wt"), snap);
    expect(r.code).toBe(0);
    expect(headOf(join(tmp, "wt"))).toBe(snap);
    expect(existsSync(join(tmp, "wt", "node_modules/dep/index.js"))).toBe(true);
  }, 10000);

  test("a clone scratch is cut at the snapshot, with its dependencies cloned", () => {
    const r = sh(repo, synth, join(tmp, "clone"), snap, "--clone", base);
    expect(r.code).toBe(0);
    expect(headOf(join(tmp, "clone"))).toBe(snap);
    expect(existsSync(join(tmp, "clone", "node_modules/dep/index.js"))).toBe(true);
  }, 10000);

  test("DEPS_DIRS with an NBSP clones one directory, not two", () => {
    // BASE `for d in $DEPS` splits on IFS space/tab/LF only: an NBSP never splits (bash-verified).
    const nbspDir = "a\u00a0b";
    mkdirSync(join(synth, nbspDir, "dep"), { recursive: true });
    writeFileSync(join(synth, nbspDir, "dep/index.js"), "x\n");
    const r = spawnSync(cli, [repo, synth, join(tmp, "nbsp"), snap], {
      encoding: "utf8",
      env: { ...process.env, DEPS_DIRS: nbspDir },
    });
    expect(r.status).toBe(0);
    expect(existsSync(join(tmp, "nbsp", nbspDir, "dep/index.js"))).toBe(true);
  }, 10000);

  test("in it, the diff against origin/HEAD is exactly the change from the base", () => {
    const diff = git("-C", join(tmp, "clone"), "diff", "--name-only", "origin/HEAD...");
    expect(diff.out.trim()).toBe("b.txt");
  }, 10000);

  test("and it copied no objects", () => {
    let altSize = 0;
    try {
      altSize = statSync(join(tmp, "clone/.git/objects/info/alternates")).size;
    } catch {
      altSize = 0;
    }
    let loose: string[] = [];
    try {
      const objs = join(tmp, "clone/.git/objects");
      loose = readdirSync(objs).flatMap((d) => {
        if (d.length !== 2 || d === "info" || d === "pack") return [];
        try {
          return readdirSync(join(objs, d)).map((f) => join(d, f));
        } catch {
          return [];
        }
      });
    } catch {
      loose = ["?"];
    }
    expect(altSize > 0).toBe(true);
    expect(loose).toEqual([]);
  }, 10000);

  test("--kind names each scratch and the repository it was cut from", () => {
    const kwt = sh("--kind", join(tmp, "wt"));
    const kcl = sh("--kind", join(tmp, "clone"));
    expect(kwt.out.trim()).toBe(`worktree ${repo}`);
    expect(kcl.out.trim()).toBe(`clone ${repo}`);
  }, 10000);

  test("--check passes a clone at the snapshot whose origin/HEAD leads back to the base", () => {
    const r = sh("--check", join(tmp, "clone"), snap, "--clone", base);
    expect(r.code).toBe(0);
  }, 10000);

  test("and a worktree at the snapshot", () => {
    expect(sh("--check", join(tmp, "wt"), snap).code).toBe(0);
  }, 10000);

  test("with main moved on by another run's merge, a clone still reviews from the base", () => {
    commit(repo, "c.txt", "another run merged");
    const r = sh(repo, synth, join(tmp, "moved"), snap, "--clone", base);
    const movedDiff = git("-C", join(tmp, "moved"), "diff", "--name-only", "origin/HEAD...");
    expect(r.code).toBe(0);
    expect(movedDiff.out.trim()).toBe("b.txt");
  }, 10000);

  test("--remove takes a worktree scratch away through git", () => {
    const r = sh("--remove", repo, join(tmp, "wt"));
    const wtList = git("-C", repo, "worktree", "list", "--porcelain");
    expect(r.code).toBe(0);
    expect(existsSync(join(tmp, "wt"))).toBe(false);
    expect(wtList.out.includes(`worktree ${join(tmp, "wt")}`)).toBe(false);
  }, 10000);

  test("--remove takes a clone scratch away", () => {
    const r = sh("--remove", repo, join(tmp, "clone"));
    expect(r.code).toBe(0);
    expect(existsSync(join(tmp, "clone"))).toBe(false);
  }, 10000);
});

describe("negative controls", () => {
  test("--check refuses a scratch that is not at the snapshot", () => {
    const r = sh("--check", join(tmp, "moved"), base, "--clone", base);
    expect(r.code).toBe(1);
    expect(both(r)).toContain("is not at");
  }, 10000);

  test("and a worktree where a clone is needed", () => {
    sh(repo, synth, join(tmp, "wt2"), snap);
    const r = sh("--check", join(tmp, "wt2"), snap, "--clone", base);
    expect(r.code).toBe(1);
    expect(both(r)).toContain("needs a clone");
  }, 10000);

  test("and a clone whose origin/HEAD does not lead back to the base", () => {
    const r = sh("--check", join(tmp, "moved"), snap, "--clone", snap);
    expect(r.code).toBe(1);
    expect(both(r)).toContain("does not lead back");
  }, 10000);

  test("a clone whose origin/HEAD does not lead back to the base is refused, and removed", () => {
    const r = sh(repo, synth, join(tmp, "wrong"), snap, "--clone", snap);
    expect(r.code).toBe(1);
    expect(existsSync(join(tmp, "wrong"))).toBe(false);
    expect(both(r)).toContain("does not lead back");
  }, 10000);

  test("so is one cut while the repository has an unrelated branch checked out", () => {
    git("-C", repo, "switch", "-q", "--orphan", "elsewhere");
    commit(repo, "d.txt", "unrelated");
    const r = sh(repo, synth, join(tmp, "unrelated"), snap, "--clone", base);
    expect(r.code).toBe(1);
    expect(existsSync(join(tmp, "unrelated"))).toBe(false);
    expect(both(r)).toContain("merge base none");
    git("-C", repo, "switch", "-q", "main");
  }, 10000);

  test("a base the repository does not have is refused, and nothing is cut", () => {
    const r = sh(repo, synth, join(tmp, "nobase"), snap, "--clone", "no-such-ref");
    expect(r.code).toBe(1);
    expect(existsSync(join(tmp, "nobase"))).toBe(false);
  }, 10000);

  test("a dest that already exists is refused, and left alone", () => {
    mkdirSync(join(tmp, "taken"));
    writeFileSync(join(tmp, "taken/mine.txt"), "keep\n");
    const r = sh(repo, synth, join(tmp, "taken"), snap, "--clone", base);
    expect(r.code).toBe(1);
    expect(readdirSync(join(tmp, "taken"))).toEqual(["mine.txt"]);
  }, 10000);

  test("for a worktree scratch too", () => {
    const r = sh(repo, synth, join(tmp, "taken"), snap);
    expect(r.code).toBe(1);
    expect(readdirSync(join(tmp, "taken"))).toEqual(["mine.txt"]);
    // Stage the next phase's fixtures, as the self-test did before the victim loop.
    git("clone", "-q", repo, join(tmp, "plain"));
    const repo2 = join(tmp, "repo2");
    git("init", "-q", "-b", "main", repo2);
    writeFileSync(join(repo2, "x"), "x\n");
    git("-C", repo2, "add", "x");
    git("-C", repo2, "commit", "-qm", "x");
    git("clone", "-q", "--shared", repo2, join(tmp, "borrowed"));
    git("-C", join(tmp, "borrowed"), "remote", "set-url", "origin", repo);
    sh(repo, synth, join(tmp, "other"), snap, "--clone", base);
  }, 10000);

  for (const name of victimNames) {
    test(`--kind: ${name} is no scratch`, () => {
      const r = sh("--kind", victimPath(name));
      expect(r.code).toBe(1);
      expect(both(r)).toBe("");
    }, 10000);

    test("--remove refuses it, and leaves it", () => {
      const victim = victimPath(name);
      const r = sh("--remove", repo, victim);
      let leftAlone = !existsSync(victim);
      if (!leftAlone) {
        try {
          leftAlone = readdirSync(victim).length > 0;
        } catch {
          leftAlone = true;
        }
      }
      expect(r.code).toBe(1);
      expect(leftAlone).toBe(true);
    }, 10000);
  }

  test("the synthesis worktree is untouched", () => {
    const list = git("-C", repo, "worktree", "list", "--porcelain");
    expect(existsSync(join(synth, "b.txt"))).toBe(true);
    expect(list.out.includes(`worktree ${synth}`)).toBe(true);
  }, 10000);

  test("--remove refuses a scratch of another repository", () => {
    const r = sh("--remove", join(tmp, "repo2"), join(tmp, "other"));
    expect(r.code).toBe(1);
    expect(existsSync(join(tmp, "other/.git"))).toBe(true);
    expect(both(r)).toContain("not of");
  }, 10000);

  test("--clone with no base is a usage error", () => {
    const r = sh(repo, synth, join(tmp, "x"), snap, "--clone");
    expect(r.code).toBe(1);
    expect(existsSync(join(tmp, "x"))).toBe(false);
  }, 10000);
});
