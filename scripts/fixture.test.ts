// Tests for fixture.ts: the mark on a new copy, and that new writes no harness trust setting.
//
//   bun --no-env-file test scripts/fixture.test.ts
//
// Each control is a pair through the same call to `fixture.sh new`. A scratch home holds the
// harness configs, present or absent, and the real ones are never touched.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPTS = import.meta.dir;
const FIXTURE_SH = join(SCRIPTS, "fixture.sh");
const FIRST_TICKET = "remove";

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.invalid",
  GIT_COMMITTER_NAME: "fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.invalid",
};

function sh(
  cmd: string[],
  cwd?: string,
  env: Record<string, string> = gitEnv,
): { code: number | null; out: string } {
  const proc = Bun.spawnSync({ cmd, cwd, env, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const out =
    (proc.stdout ? new TextDecoder().decode(proc.stdout) : "") +
    (proc.stderr ? new TextDecoder().decode(proc.stderr) : "");
  return { code: proc.exitCode, out };
}

/** Snapshot of the harness configs a scratch home holds: each path's bytes, or absent. */
function harnessSnapshot(home: string): Record<string, string | null> {
  const paths = [".claude.json", ".codex/config.toml", ".claude/settings.json"];
  const snap: Record<string, string | null> = {};
  for (const rel of paths) {
    const p = join(home, rel);
    snap[rel] = existsSync(p) ? readFileSync(p, "utf8") : null;
  }
  return snap;
}

describe("new marks the copy and writes no harness trust setting", () => {
  let root: string;
  let home: string;
  let dest: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "fixture-test-"));
    home = join(root, "home");
    mkdirSync(home, { recursive: true });
    dest = join(root, "copy");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const runNew = (): { code: number | null; out: string } => {
    return sh([FIXTURE_SH, "new", dest, FIRST_TICKET], undefined, {
      ...gitEnv,
      HOME: home,
      POSTMASTER_FIXTURES: join(root, "fixtures"),
    });
  };

  test("new marks the copy, the mark reads back as the fixture ticket, and the tree stays clean", () => {
    // Positive side of the pair: the same call that makes the copy also marks it.
    const r = runNew();
    expect(r.code).toBe(0);
    const mark = sh(["git", "-C", dest, "config", "--get", "postmaster.fixture"]).out.trim();
    expect(mark).toBe(FIRST_TICKET);
    const count = sh(["git", "-C", dest, "rev-list", "--count", "main"]).out.trim();
    const status = sh(["git", "-C", dest, "status", "--porcelain"]).out.trim();
    expect(count).toBe("1");
    expect(status).toBe("");
    // Negative side: a repository new did not make carries no mark, through the same read.
    const other = join(root, "not-a-fixture");
    mkdirSync(other, { recursive: true });
    const init = sh(["git", "init", "-q", "-b", "main"], other, gitEnv);
    expect(init.code).toBe(0);
    const otherMark = sh(["git", "-C", other, "config", "--get", "postmaster.fixture"]).out.trim();
    expect(otherMark).toBe("");
  });

  test("new leaves a scratch home's harness configs as they were", () => {
    // Present before: one file carries bytes new must not change.
    mkdirSync(join(home, ".codex"), { recursive: true });
    const claudeBefore = '{"projects":{"/already/trusted":{"hasTrustDialogAccepted":true}}}\n';
    writeFileSync(join(home, ".claude.json"), claudeBefore);
    const codexBefore = '[projects."/already/trusted"]\ntrust_level = "trusted"\n';
    writeFileSync(join(home, ".codex/config.toml"), codexBefore);
    const before = harnessSnapshot(home);

    const r = runNew();
    expect(r.code).toBe(0);
    // Positive side: the same comparison shows nothing wrote a harness config.
    expect(harnessSnapshot(home)).toEqual(before);
    expect(readFileSync(join(home, ".claude.json"), "utf8")).toBe(claudeBefore);
    expect(readFileSync(join(home, ".codex/config.toml"), "utf8")).toBe(codexBefore);

    // Negative side: a control that writes one is caught by the same comparison.
    writeFileSync(join(home, ".claude.json"), claudeBefore + "x");
    expect(harnessSnapshot(home)).not.toEqual(before);
  });

  test("new leaves absent harness configs absent", () => {
    // Present before: none. The same call must not create any.
    expect(existsSync(join(home, ".claude.json"))).toBe(false);
    expect(existsSync(join(home, ".codex/config.toml"))).toBe(false);
    const before = harnessSnapshot(home);

    const r = runNew();
    expect(r.code).toBe(0);
    expect(harnessSnapshot(home)).toEqual(before);
    expect(existsSync(join(home, ".claude.json"))).toBe(false);
    expect(existsSync(join(home, ".codex/config.toml"))).toBe(false);

    // Negative side: creating one is caught by the same comparison.
    writeFileSync(join(home, ".claude.json"), "{}\n");
    expect(harnessSnapshot(home)).not.toEqual(before);
  });
});
