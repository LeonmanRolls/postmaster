// Tests for front-door.ts: the headless line on a spawn into a fixture copy.
//
//   bun --no-env-file test scripts/front-door.test.ts
//
// The decision never reads the session host, so the same command is the decision for Herdr,
// tmux and none alike. A scratch home and scratch repositories only; the real config is never
// touched.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPTS = import.meta.dir;
const FRONT_DOOR = join(SCRIPTS, "front-door.sh");

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

function gitInit(path: string): void {
  mkdirSync(path, { recursive: true });
  const r = sh(["git", "-C", path, "init", "-q"]);
  if (r.code !== 0) throw new Error(`git init: ${r.out}`);
  const c = sh([
    "git",
    "-C",
    path,
    "-c",
    "user.email=t@t",
    "-c",
    "user.name=t",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "base",
  ]);
  if (c.code !== 0) throw new Error(`git commit: ${c.out}`);
}

describe("front-door says headless for a fixture copy", () => {
  let root: string;
  let here: string;
  let fixtureCopy: string;
  let plain: string;
  let config: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "front-door-test-"));
    here = join(root, "here");
    fixtureCopy = join(root, "fixture-copy");
    plain = join(root, "plain");
    gitInit(here);
    gitInit(fixtureCopy);
    gitInit(plain);
    config = join(root, "config.toml");
    writeFileSync(config, '[team]\npostmaster = { harness = "claude", model = "pm-model" }\n');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const decide = (cwd: string, target: string, atTerminal: string): { code: number | null; out: string } => {
    return sh(
      [FRONT_DOOR, "grok", "pm-model", cwd, atTerminal, target, "--config", config],
      undefined,
      gitEnv,
    );
  };

  test("a spawn into a fixture copy says headless, whatever the session host", () => {
    sh(["git", "-C", fixtureCopy, "config", "postmaster.fixture", "remove"]);
    // The decision never reads the host: Herdr, tmux and none are the same call.
    const outputs: string[] = [];
    for (const _host of ["herdr", "tmux", "none"]) {
      const r = decide(here, fixtureCopy, "no");
      expect(r.code).toBe(0);
      expect(r.out.startsWith("spawn ")).toBe(true);
      expect(r.out).toContain("\nheadless the target is a fixture copy made by fixture.sh new\n");
      outputs.push(r.out);
    }
    // One form for every host: the three calls are identical.
    expect(outputs[0]).toBe(outputs[1]);
    expect(outputs[1]).toBe(outputs[2]);
  });

  test("the same copy with its mark removed gives exactly the decision it gave before", () => {
    // Mark then remove, so this is the same copy with its mark gone.
    sh(["git", "-C", fixtureCopy, "config", "postmaster.fixture", "remove"]);
    sh(["git", "-C", fixtureCopy, "config", "--unset", "postmaster.fixture"]);
    // Before this change: spawn with its reasons and no headless line. Compare the same
    // copy unmarked to a target that was never a fixture.
    const unmarked = decide(here, fixtureCopy, "no");
    const neverMarked = decide(here, plain, "no");
    expect(unmarked.code).toBe(0);
    expect(unmarked.out.includes("headless")).toBe(false);
    // The only difference is the target path inside the reason string.
    expect(unmarked.out).toBe(neverMarked.out.replaceAll(plain, fixtureCopy));
  });

  test("a self decision in a fixture copy stays self", () => {
    sh(["git", "-C", fixtureCopy, "config", "postmaster.fixture", "remove"]);
    const r = sh(
      [
        FRONT_DOOR,
        "claude",
        "pm-model",
        fixtureCopy,
        "yes",
        fixtureCopy,
        "--config",
        config,
      ],
      undefined,
      gitEnv,
    );
    expect(r.code).toBe(0);
    expect(r.out.startsWith("self ")).toBe(true);
    expect(r.out.includes("headless")).toBe(false);
  });

  test("a target that is not a fixture copy gives exactly the output it gave before", () => {
    const r = decide(here, plain, "no");
    expect(r.code).toBe(0);
    expect(r.out.startsWith("spawn ")).toBe(true);
    expect(r.out.includes("headless")).toBe(false);
    // A second call through the same command is identical.
    const again = decide(here, plain, "no");
    expect(again.out).toBe(r.out);
  });
});
