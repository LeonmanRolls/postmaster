// Tests beside scripts/coachman-contract.ts, the #163 detector ported on #109:
// the CLI contract on a small fixture, plus the script's own self-test suite.
import { describe, expect, test } from "bun:test";
import { appendFileSync, copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { scriptsDir, toolRoot } from "./lib/paths.ts";
import { run, withTempDir } from "./lib/proc.ts";

const HERE = scriptsDir(import.meta);
const TOOL = toolRoot(import.meta);
const SELF = join(HERE, "run");

const INDEX = `version = 1
detector = "scripts/coachman-contract.ts"

[[files]]
path = "watched.txt"
holds = "the watched file"
`;

/** A git repo with the contract index and a watched and an unwatched file. */
function fixture(dir: string): { repo: string; base: string } {
  const repo = join(dir, "repo");
  mkdirSync(join(repo, "docs"), { recursive: true });
  writeFileSync(join(repo, "docs", "coachman-contract.toml"), INDEX);
  writeFileSync(join(repo, "watched.txt"), "watched\n");
  writeFileSync(join(repo, "other.txt"), "other\n");
  const g = (...args: string[]): string => {
    const r = run("git", ["-C", repo, ...args]);
    if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.err.trim()}`);
    return r.out;
  };
  expect(run("git", ["init", "-q", "-b", "main", repo]).code).toBe(0);
  g("config", "user.name", "brindlewick");
  g("config", "user.email", "332054101+brindlewick@users.noreply.github.com");
  g("add", ".");
  g("commit", "-q", "-m", "baseline");
  return { repo, base: g("rev-parse", "HEAD").trim() };
}

function commitAll(repo: string, message: string): string {
  const g = (...args: string[]): string => {
    const r = run("git", ["-C", repo, ...args]);
    if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.err.trim()}`);
    return r.out;
  };
  g("add", ".");
  g("commit", "-q", "-m", message);
  return g("rev-parse", "HEAD").trim();
}

describe("the detector's command line", () => {
  test("no arguments prints the usage line", () => {
    const r = run(SELF, ["coachman-contract"]);
    expect(r.code).toBe(2);
    expect(r.err).toBe(
      "usage: scripts/run coachman-contract [<repo>] <base> <head> | --self-test | --at-base <repo> <base> <head>\n",
    );
  });

  test("--self-test takes no further argument", () => {
    const r = run(SELF, ["coachman-contract", "--self-test", "extra"]);
    expect(r.code).toBe(2);
    expect(r.err).toBe("usage: scripts/run coachman-contract --self-test\n");
  });

  test("an unknown revision is an error naming the script", () => {
    const r = withTempDir((dir) => {
      const { repo, base } = fixture(dir);
      return run(SELF, ["coachman-contract", repo, base, "no-such-rev"], { cwd: repo });
    });
    expect(r.code).toBe(2);
    expect(r.err.startsWith("coachman-contract: ")).toBe(true);
  });

  test("two revisions outside a repository name --repo", () => {
    const r = withTempDir((dir) => run(SELF, ["coachman-contract", "a", "b"], { cwd: dir }));
    expect(r.code).toBe(2);
    expect(r.err).toBe("coachman-contract: run from a git repository or pass --repo\n");
  });
});

describe("classifying a change", () => {
  test("an unwatched change answers no", () => {
    const r = withTempDir((dir) => {
      const { repo, base } = fixture(dir);
      writeFileSync(join(repo, "other.txt"), "other\nmore\n");
      const head = commitAll(repo, "unwatched");
      return { r: run(SELF, ["coachman-contract", repo, base, head]), base, head };
    });
    expect(r.r.code).toBe(0);
    expect(r.r.out).toBe(`no coachman contract change (${r.base}..${r.head})\n`);
  });

  test("a watched change answers yes naming the file", () => {
    const r = withTempDir((dir) => {
      const { repo, base } = fixture(dir);
      writeFileSync(join(repo, "watched.txt"), "watched\nmore\n");
      const head = commitAll(repo, "watched");
      return run(SELF, ["coachman-contract", repo, base, head]);
    });
    expect(r.code).toBe(1);
    expect(r.out).toBe("yes watched.txt\n");
  });

  test("the [repo] form classifies from outside the repo", () => {
    const r = withTempDir((dir) => {
      const { repo, base } = fixture(dir);
      writeFileSync(join(repo, "watched.txt"), "watched\nmore\n");
      const head = commitAll(repo, "watched");
      return run(SELF, ["coachman-contract", repo, base, head], { cwd: dir });
    });
    expect(r.code).toBe(1);
    expect(r.out).toBe("yes watched.txt\n");
  });

  test("the --repo form classifies from outside the repo", () => {
    const r = withTempDir((dir) => {
      const { repo, base } = fixture(dir);
      writeFileSync(join(repo, "watched.txt"), "watched\nmore\n");
      const head = commitAll(repo, "watched");
      return run(SELF, ["coachman-contract", "--repo", repo, base, head], { cwd: dir });
    });
    expect(r.code).toBe(1);
    expect(r.out).toBe("yes watched.txt\n");
  });

  test("two revisions with no index answer no", () => {
    const r = withTempDir((dir) => {
      const { repo } = fixture(dir);
      const g = (...args: string[]): void => {
        const q = run("git", ["-C", repo, ...args]);
        if (q.code !== 0) throw new Error(`git ${args.join(" ")}: ${q.err.trim()}`);
      };
      g("rm", "-q", "docs/coachman-contract.toml");
      g("commit", "-q", "-m", "drop the index");
      const mid = run("git", ["-C", repo, "rev-parse", "HEAD"]).out.trim();
      writeFileSync(join(repo, "other.txt"), "other\nmore\n");
      const head = commitAll(repo, "unwatched");
      return run(SELF, ["coachman-contract", repo, mid, head]);
    });
    expect(r.code).toBe(0);
    expect(r.out.startsWith("no coachman contract change")).toBe(true);
  });
});

describe("a broken contract list is an error", () => {
  test("invalid TOML names the index and both revisions", () => {
    const r = withTempDir((dir) => {
      const { repo, base } = fixture(dir);
      writeFileSync(join(repo, "docs", "coachman-contract.toml"), "version = [\n");
      const head = commitAll(repo, "break toml");
      return run(SELF, ["coachman-contract", repo, base, head]);
    });
    expect(r.code).toBe(2);
    expect(r.err).toContain("docs/coachman-contract.toml");
    expect(r.err).toContain("invalid TOML");
  });

  test("a version that is not 1 names the version", () => {
    const r = withTempDir((dir) => {
      const { repo, base } = fixture(dir);
      writeFileSync(
        join(repo, "docs", "coachman-contract.toml"),
        INDEX.replace("version = 1", "version = 2"),
      );
      const head = commitAll(repo, "bump version");
      return run(SELF, ["coachman-contract", repo, base, head]);
    });
    expect(r.code).toBe(2);
    expect(r.err).toContain("version");
  });

  test("no detector names the detector", () => {
    const r = withTempDir((dir) => {
      const { repo, base } = fixture(dir);
      writeFileSync(
        join(repo, "docs", "coachman-contract.toml"),
        INDEX.replace('detector = "scripts/coachman-contract.ts"\n', ""),
      );
      const head = commitAll(repo, "drop detector");
      return run(SELF, ["coachman-contract", repo, base, head]);
    });
    expect(r.code).toBe(2);
    expect(r.err).toContain("detector");
  });

  test("no files list names the list", () => {
    const r = withTempDir((dir) => {
      const { repo, base } = fixture(dir);
      writeFileSync(
        join(repo, "docs", "coachman-contract.toml"),
        'version = 1\ndetector = "scripts/coachman-contract.ts"\n',
      );
      const head = commitAll(repo, "drop files");
      return run(SELF, ["coachman-contract", repo, base, head]);
    });
    expect(r.code).toBe(2);
    expect(r.err).toContain("must list its contract files");
  });
});

describe("the current index recognises its new files", () => {
  const NEW_FILES = ["skills/postmaster/workhorse-spec-template.md", "scripts/summary-evidence.ts"];

  /** A git repo carrying the real contract index and the two new files. */
  function realFixture(dir: string): { repo: string; base: string } {
    const repo = join(dir, "real");
    mkdirSync(join(repo, "docs"), { recursive: true });
    copyFileSync(
      join(TOOL, "docs", "coachman-contract.toml"),
      join(repo, "docs", "coachman-contract.toml"),
    );
    for (const f of NEW_FILES) {
      const target = join(repo, f);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(join(TOOL, f), target);
    }
    const g = (...args: string[]): string => {
      const r = run("git", ["-C", repo, ...args]);
      if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.err.trim()}`);
      return r.out;
    };
    expect(run("git", ["init", "-q", "-b", "main", repo]).code).toBe(0);
    g("config", "user.name", "brindlewick");
    g("config", "user.email", "332054101+brindlewick@users.noreply.github.com");
    g("add", ".");
    g("commit", "-q", "-m", "baseline");
    return { repo, base: g("rev-parse", "HEAD").trim() };
  }

  for (const f of NEW_FILES) {
    test(`a change in ${f} answers yes`, () => {
      const r = withTempDir((dir) => {
        const { repo, base } = realFixture(dir);
        appendFileSync(join(repo, f), "\n");
        const head = commitAll(repo, "touch");
        return run(SELF, ["coachman-contract", repo, base, head]);
      });
      expect(r.code).toBe(1);
      expect(r.out).toBe(`yes ${f}\n`);
    });
  }
});

describe("the detector's own suite", () => {
  test("--self-test passes", () => {
    const r = run(SELF, ["coachman-contract", "--self-test"]);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(r.out).toContain("0 failed");
  }, 120000);
});
