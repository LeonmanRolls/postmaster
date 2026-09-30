import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "synthesis-shares.ts");
const BUNFIG = join(import.meta.dir, "bunfig.empty.toml");

// n consecutive words make n-5 runs of six words, for n >= 6.
const words = (n: number, tag: string): string =>
  Array.from({ length: n }, (_, i) => `${tag}${i}`).join(" ");
const runs = (n: number): number => (n < 6 ? 0 : n - 5);

const sh = (cwd: string, ...args: string[]): string => {
  const p = Bun.spawnSync(args, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  });
  const out = new TextDecoder().decode(p.stdout);
  const err = new TextDecoder().decode(p.stderr);
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")} exited ${p.exitCode}\n${out}\n${err}`);
  return out;
};

const git = (repo: string, ...args: string[]): string => sh(repo, "git", ...args);

const writeFile = (repo: string, path: string, text: string): void => {
  const full = join(repo, path);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, text);
};

const commit = (repo: string, message: string): string => {
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", message);
  return git(repo, "rev-parse", "HEAD").trim();
};

const newRepo = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "shares-"));
  git(dir, "init", "-q", "-b", "main");
  writeFile(dir, "src/keep.ts", "placeholder\n");
  commit(dir, "root");
  return dir;
};

const runShares = (
  repo: string,
  opts: {
    base: string;
    lanes: Record<string, string>;
    synthesis: string;
    oracle?: string;
    record?: string;
    json?: boolean;
  },
): { code: number; stdout: string; stderr: string; record: unknown | null } => {
  const args = ["--no-env-file", `--config=${BUNFIG}`, SCRIPT, repo, "--base", opts.base];
  for (const [name, head] of Object.entries(opts.lanes)) {
    args.push("--lane", `${name}=${head}`);
  }
  args.push("--synthesis", opts.synthesis);
  if (opts.oracle) args.push("--oracle", opts.oracle);
  if (opts.record) args.push("--record", opts.record);
  if (opts.json) args.push("--json");
  const p = Bun.spawnSync(["bun", ...args], {
    stdout: "pipe",
    stderr: "pipe",
    cwd: repo,
  });
  const stdout = new TextDecoder().decode(p.stdout);
  const stderr = new TextDecoder().decode(p.stderr);
  let record: unknown | null = null;
  if (opts.record) {
    record = JSON.parse(readFileSync(join(opts.record, "shares.json"), "utf8"));
  } else if (opts.json) {
    const start = stdout.indexOf("{");
    record = start >= 0 ? JSON.parse(stdout.slice(start)) : null;
  }
  return { code: p.exitCode ?? -1, stdout, stderr, record };
};

type Counts = {
  total: number;
  shared: number;
  neither: number;
  lanes: Record<string, number>;
};

const counts = (record: unknown, kind: "all" | "code" | "docs"): Counts =>
  (record as { counts: Record<string, Counts> }).counts[kind] as Counts;

// Each control builds a small repository, runs the same command the coachman uses, and
// reads the counts back as exact integers.

describe("synthesis-shares", () => {
  test("one lane only: every run is that lane's; the other, shared and neither read 0", () => {
    const repo = newRepo();
    const base = git(repo, "rev-parse", "HEAD").trim();
    const text = words(12, "a");
    writeFile(repo, "src/a.ts", text);
    const luna = commit(repo, "luna");
    git(repo, "checkout", "-q", base);
    writeFile(repo, "src/b.ts", words(6, "b"));
    const mimo = commit(repo, "mimo");
    git(repo, "checkout", "-q", base);
    writeFile(repo, "src/a.ts", text);
    const synTo = commit(repo, "synthesis");

    const r = runShares(repo, {
      base,
      lanes: { luna, mimo },
      synthesis: `${base}..${synTo}`,
      json: true,
    });
    expect(r.code).toBe(0);
    const all = counts(r.record, "all");
    expect(all.lanes.luna).toBe(runs(12));
    expect(all.lanes.mimo).toBe(0);
    expect(all.shared).toBe(0);
    expect(all.neither).toBe(0);
    expect(all.total).toBe(runs(12));
  });

  test("split between both: each lane's count reads its part's exact size; shared and neither 0", () => {
    const repo = newRepo();
    const base = git(repo, "rev-parse", "HEAD").trim();
    const textA = words(12, "a");
    const textB = words(12, "b");
    writeFile(repo, "src/a.ts", textA);
    const luna = commit(repo, "luna");
    git(repo, "checkout", "-q", base);
    writeFile(repo, "src/b.ts", textB);
    const mimo = commit(repo, "mimo");
    git(repo, "checkout", "-q", base);
    writeFile(repo, "src/a.ts", textA);
    writeFile(repo, "src/b.ts", textB);
    const synTo = commit(repo, "synthesis");

    const r = runShares(repo, {
      base,
      lanes: { luna, mimo },
      synthesis: `${base}..${synTo}`,
      json: true,
    });
    expect(r.code).toBe(0);
    const all = counts(r.record, "all");
    expect(all.lanes.luna).toBe(runs(12));
    expect(all.lanes.mimo).toBe(runs(12));
    expect(all.shared).toBe(0);
    expect(all.neither).toBe(0);
    expect(all.total).toBe(runs(12) + runs(12));
  });

  test("identical in both lanes: every run is shared; the rest read 0", () => {
    const repo = newRepo();
    const base = git(repo, "rev-parse", "HEAD").trim();
    const text = words(12, "same");
    writeFile(repo, "src/a.ts", text);
    const luna = commit(repo, "luna");
    git(repo, "checkout", "-q", base);
    writeFile(repo, "src/a.ts", text);
    const mimo = commit(repo, "mimo");
    git(repo, "checkout", "-q", base);
    writeFile(repo, "src/a.ts", text);
    const synTo = commit(repo, "synthesis");

    const r = runShares(repo, {
      base,
      lanes: { luna, mimo },
      synthesis: `${base}..${synTo}`,
      json: true,
    });
    expect(r.code).toBe(0);
    const all = counts(r.record, "all");
    expect(all.shared).toBe(runs(12));
    expect(all.lanes.luna).toBe(0);
    expect(all.lanes.mimo).toBe(0);
    expect(all.neither).toBe(0);
    expect(all.total).toBe(runs(12));
  });

  test("the coachman alone: every run is neither; the rest read 0", () => {
    const repo = newRepo();
    const base = git(repo, "rev-parse", "HEAD").trim();
    writeFile(repo, "src/a.ts", words(12, "lunaonly"));
    const luna = commit(repo, "luna");
    git(repo, "checkout", "-q", base);
    writeFile(repo, "src/b.ts", words(12, "mimoonly"));
    const mimo = commit(repo, "mimo");
    git(repo, "checkout", "-q", base);
    writeFile(repo, "src/c.ts", words(12, "coach"));
    const synTo = commit(repo, "synthesis");

    const r = runShares(repo, {
      base,
      lanes: { luna, mimo },
      synthesis: `${base}..${synTo}`,
      json: true,
    });
    expect(r.code).toBe(0);
    const all = counts(r.record, "all");
    expect(all.neither).toBe(runs(12));
    expect(all.lanes.luna).toBe(0);
    expect(all.lanes.mimo).toBe(0);
    expect(all.shared).toBe(0);
    expect(all.total).toBe(runs(12));
  });

  test("exclusions: text in a left-out file counts nowhere; the same text in a kept file counts", () => {
    const repo = newRepo();
    const base = git(repo, "rev-parse", "HEAD").trim();
    const text = words(12, "x");
    writeFile(repo, "src/a.ts", text);
    writeFile(repo, "WORKHORSE-SPEC.md", text);
    writeFile(repo, "bun.lock", text);
    const luna = commit(repo, "luna");
    git(repo, "checkout", "-q", base);
    writeFile(repo, "src/a.ts", text);
    writeFile(repo, "WORKHORSE-SPEC.md", text);
    writeFile(repo, "bun.lock", text);
    const synTo = commit(repo, "synthesis");

    const r = runShares(repo, {
      base,
      lanes: { luna, mimo: luna },
      synthesis: `${base}..${synTo}`,
      json: true,
    });
    expect(r.code).toBe(0);
    const all = counts(r.record, "all");
    // only src/a.ts's runs are counted; WORKHORSE-SPEC.md and bun.lock are left out
    expect(all.total).toBe(runs(12));
    expect(all.shared).toBe(runs(12));
  });

  test("three lanes: per-lane by name, and shared when two hold the run", () => {
    const repo = newRepo();
    const base = git(repo, "rev-parse", "HEAD").trim();
    const textA = words(12, "aa");
    const textB = words(12, "bb");
    const textC = words(12, "cc");
    const textShared = words(12, "ss");
    // Separate files so runs never span two texts.
    writeFile(repo, "src/a.ts", textA);
    writeFile(repo, "src/shared.ts", textShared);
    const alpha = commit(repo, "alpha");
    git(repo, "checkout", "-q", base);
    writeFile(repo, "src/b.ts", textB);
    writeFile(repo, "src/shared.ts", textShared);
    const beta = commit(repo, "beta");
    git(repo, "checkout", "-q", base);
    writeFile(repo, "src/c.ts", textC);
    const gamma = commit(repo, "gamma");
    git(repo, "checkout", "-q", base);
    writeFile(repo, "src/a.ts", textA);
    writeFile(repo, "src/b.ts", textB);
    writeFile(repo, "src/c.ts", textC);
    writeFile(repo, "src/shared.ts", textShared);
    const synTo = commit(repo, "synthesis");

    const r = runShares(repo, {
      base,
      lanes: { alpha, beta, gamma },
      synthesis: `${base}..${synTo}`,
      json: true,
    });
    expect(r.code).toBe(0);
    const all = counts(r.record, "all");
    expect(all.lanes.alpha).toBe(runs(12));
    expect(all.lanes.beta).toBe(runs(12));
    expect(all.lanes.gamma).toBe(runs(12));
    expect(all.shared).toBe(runs(12));
    expect(all.neither).toBe(0);
    expect(all.total).toBe(runs(12) * 4);
  });

  test("SHARES line is greppable and names every lane", () => {
    const repo = newRepo();
    const base = git(repo, "rev-parse", "HEAD").trim();
    writeFile(repo, "src/a.ts", words(12, "a"));
    const luna = commit(repo, "luna");
    writeFile(repo, "src/b.ts", words(6, "b"));
    const mimo = commit(repo, "mimo");
    git(repo, "checkout", "-q", base);
    writeFile(repo, "src/a.ts", words(12, "a"));
    const synTo = commit(repo, "synthesis");

    const r = runShares(repo, {
      base,
      lanes: { luna, mimo },
      synthesis: `${base}..${synTo}`,
    });
    expect(r.code).toBe(0);
    expect(r.stdout).toStartWith("SHARES: ");
    expect(r.stdout).toContain("luna=");
    expect(r.stdout).toContain("mimo=");
    expect(r.stdout).toContain("shared=");
    expect(r.stdout).toContain("neither=");
    expect(r.stdout).toContain("all n=");
    expect(r.stdout).toContain("code n=");
    expect(r.stdout).toContain("docs n=");
  });

  test("a merge in the synthesis range is refused", () => {
    const repo = newRepo();
    const base = git(repo, "rev-parse", "HEAD").trim();
    writeFile(repo, "src/a.ts", words(12, "side"));
    const side = commit(repo, "side");
    git(repo, "checkout", "-q", base);
    writeFile(repo, "src/a.ts", words(12, "side"));
    commit(repo, "mainline");
    git(repo, "merge", "-q", "--no-ff", "-m", "merge", side);
    const synTo = git(repo, "rev-parse", "HEAD").trim();
    const r = runShares(repo, {
      base,
      lanes: { luna: side, mimo: side },
      synthesis: `${base}..${synTo}`,
      json: true,
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("merge");
  });

  test("--record writes shares.json a later audit can read without re-running the script", () => {
    const repo = newRepo();
    const base = git(repo, "rev-parse", "HEAD").trim();
    writeFile(repo, "src/a.ts", words(12, "a"));
    const luna = commit(repo, "luna");
    git(repo, "checkout", "-q", base);
    writeFile(repo, "src/b.ts", words(6, "b"));
    const mimo = commit(repo, "mimo");
    git(repo, "checkout", "-q", base);
    writeFile(repo, "src/a.ts", words(12, "a"));
    const synTo = commit(repo, "synthesis");
    const dispatch = join(repo, "RUN");
    mkdirSync(dispatch, { recursive: true });

    const r = runShares(repo, {
      base,
      lanes: { luna, mimo },
      synthesis: `${base}..${synTo}`,
      record: dispatch,
    });
    expect(r.code).toBe(0);
    expect(r.record).not.toBeNull();
    const rec = r.record as {
      base: string;
      lanes: { name: string; head: string }[];
      synthesis: { from: string; to: string };
      k: number;
      counts: { all: Counts };
    };
    expect(rec.base).toBe(base);
    expect(rec.synthesis).toEqual({ from: base, to: synTo });
    expect(rec.k).toBe(6);
    expect(rec.lanes.map((l) => l.name).sort()).toEqual(["luna", "mimo"]);
    expect(rec.counts.all.total).toBe(runs(12));
    expect(rec.counts.all.lanes.luna).toBe(runs(12));
    expect(rec.counts.all.lanes.mimo).toBe(0);
    expect(rec.counts.all.shared).toBe(0);
    expect(rec.counts.all.neither).toBe(0);
  });

  test("code and docs are counted separately", () => {
    const repo = newRepo();
    const base = git(repo, "rev-parse", "HEAD").trim();
    writeFile(repo, "src/a.ts", words(12, "code"));
    writeFile(repo, "README.md", words(12, "doc"));
    const luna = commit(repo, "luna");
    git(repo, "checkout", "-q", base);
    writeFile(repo, "src/a.ts", words(12, "code"));
    writeFile(repo, "README.md", words(12, "doc"));
    const synTo = commit(repo, "synthesis");

    const r = runShares(repo, {
      base,
      lanes: { luna, mimo: luna },
      synthesis: `${base}..${synTo}`,
      json: true,
    });
    expect(r.code).toBe(0);
    expect(counts(r.record, "code").total).toBe(runs(12));
    expect(counts(r.record, "docs").total).toBe(runs(12));
    expect(counts(r.record, "all").total).toBe(runs(12) + runs(12));
  });
});
