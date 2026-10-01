// Tests for fixture.ts: fixture marks stay in git config and new never writes harness settings.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./lib/proc.ts";

const SCRIPT = join(import.meta.dir, "fixture.ts");
const FIXTURE_TICKET = "remove";
const gitEnv = {
  GIT_AUTHOR_NAME: "fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.invalid",
  GIT_COMMITTER_NAME: "fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.invalid",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_DIR: undefined,
  GIT_WORK_TREE: undefined,
};

let scratch: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "fixture-test-"));
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function runNew(dest: string, home: string) {
  return run("bun", ["--no-env-file", SCRIPT, "new", dest, FIXTURE_TICKET], {
    env: {
      ...gitEnv,
      HOME: home,
      POSTMASTER_FIXTURES: join(home, "fixtures"),
      POSTMASTER_CONFIG: undefined,
      LOCAL_SH: undefined,
      CLAUDE_CONFIG_DIR: join(home, "claude-config"),
      CODEX_HOME: join(home, ".codex"),
    },
    input: "",
  });
}

type ConfigSnapshot = Record<string, string | null>;

function configSnapshot(home: string): ConfigSnapshot {
  const paths = [".claude.json", "claude-config/.claude.json", ".codex/config.toml"];
  return Object.fromEntries(
    paths.map((relative) => {
      const path = join(home, relative);
      return [relative, existsSync(path) ? readFileSync(path).toString("base64") : null];
    }),
  );
}

function sameConfigs(before: ConfigSnapshot, after: ConfigSnapshot): boolean {
  return JSON.stringify(before) === JSON.stringify(after);
}

function initRepo(path: string): void {
  mkdirSync(path, { recursive: true });
  run("git", ["-C", path, "init", "-q", "-b", "main"], { env: gitEnv });
}

describe("fixture copy mark and harness settings", () => {
  test("new marks the copy by ticket and leaves its tree as one clean commit", () => {
    const home = join(scratch, "home");
    const dest = join(scratch, "runs", "fixture");
    mkdirSync(home, { recursive: true });

    const made = runNew(dest, home);
    const mark = run("git", ["-C", dest, "config", "--local", "--get", "postmaster.fixture"]);
    const commits = run("git", ["-C", dest, "rev-list", "--count", "main"]);
    const status = run("git", ["-C", dest, "status", "--porcelain", "--untracked-files=all"]);

    expect(made.code).toBe(0);
    expect(mark.code).toBe(0);
    expect(mark.out.trim()).toBe(FIXTURE_TICKET);
    expect(commits.out.trim()).toBe("1");
    expect(status.out.trim()).toBe("");

    const ordinary = join(scratch, "ordinary-repo");
    initRepo(ordinary);
    const ordinaryMark = run(
      "git",
      ["-C", ordinary, "config", "--local", "--get", "postmaster.fixture"],
      { env: gitEnv },
    );
    expect(ordinaryMark.code).not.toBe(0);
  });

  test("new leaves present scratch Claude and Codex configs byte for byte unchanged", () => {
    const home = join(scratch, "home");
    const dest = join(scratch, "runs", "fixture");
    mkdirSync(join(home, ".codex"), { recursive: true });
    mkdirSync(join(home, "claude-config"), { recursive: true });
    writeFileSync(
      join(home, ".claude.json"),
      '{"projects":{"/outside":{"hasTrustDialogAccepted":true}}}\n',
    );
    writeFileSync(
      join(home, "claude-config", ".claude.json"),
      '{"projects":{"/custom":{"hasTrustDialogAccepted":true}}}\n',
    );
    writeFileSync(
      join(home, ".codex", "config.toml"),
      '[projects."/outside"]\ntrust_level = "trusted"\n',
    );
    const before = configSnapshot(home);

    const made = runNew(dest, home);

    expect(made.code).toBe(0);
    expect(sameConfigs(before, configSnapshot(home))).toBe(true);
  });

  test("new leaves absent scratch harness configs absent", () => {
    const home = join(scratch, "home");
    const dest = join(scratch, "runs", "fixture");
    mkdirSync(home, { recursive: true });
    const before = configSnapshot(home);

    const made = runNew(dest, home);

    expect(made.code).toBe(0);
    expect(sameConfigs(before, configSnapshot(home))).toBe(true);
  });

  test("the same config comparison catches a write control", () => {
    const home = join(scratch, "home");
    mkdirSync(home, { recursive: true });
    const config = join(home, ".claude.json");
    writeFileSync(config, '{"projects":{}}\n');
    const before = configSnapshot(home);

    writeFileSync(config, '{"projects":{"/control":{"hasTrustDialogAccepted":true}}}\n');

    expect(sameConfigs(before, configSnapshot(home))).toBe(false);
  });
});
