// Tests for front-door.ts: fixture marks alter only spawn routes and never depend on the host.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./lib/proc.ts";

const SCRIPT = join(import.meta.dir, "front-door.sh");
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
let session: string;
let fixture: string;
let config: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "front-door-test-"));
  session = join(scratch, "session");
  fixture = join(scratch, "fixture");
  config = join(scratch, "config.toml");
  initRepo(session);
  initRepo(fixture);
  writeFileSync(config, '[team]\npostmaster = { harness = "claude", model = "pm-model" }\n');
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function initRepo(path: string): void {
  mkdirSync(path, { recursive: true });
  const init = run("git", ["-C", path, "init", "-q", "-b", "main"], { env: gitEnv });
  if (init.code !== 0) throw new Error(`git init failed: ${init.out}${init.err}`);
}

function frontDoor(cwd: string, target: string, host: "herdr" | "tmux" | "none") {
  return run(
    "bash",
    [SCRIPT, "claude", "pm-model", cwd, "yes", target, "--config", config],
    {
      env: {
        ...gitEnv,
        POSTMASTER_HOST: host,
        HERDR_SOCKET_PATH: host === "herdr" ? join(scratch, "herdr.sock") : undefined,
        TMUX: host === "tmux" ? "test-server,1,0" : undefined,
        TMUX_PANE: host === "tmux" ? "%1" : undefined,
      },
      input: "",
    },
  );
}

function markFixture(): void {
  const result = run("git", ["-C", fixture, "config", "--local", "postmaster.fixture", "remove"], {
    env: gitEnv,
  });
  if (result.code !== 0) throw new Error(`could not mark fixture: ${result.out}${result.err}`);
}

function removeFixtureMark(): void {
  const result = run(
    "git",
    ["-C", fixture, "config", "--local", "--unset-all", "postmaster.fixture"],
    { env: gitEnv },
  );
  if (result.code !== 0)
    throw new Error(`could not remove fixture mark: ${result.out}${result.err}`);
}

describe("front door fixture routing", () => {
  test("fixture spawns are headless on every host, and removing the mark restores the route", () => {
    const baseline = frontDoor(session, fixture, "none");
    expect(baseline.code).toBe(0);
    expect(baseline.err).toBe("");
    expect(baseline.out).toBe(
      `spawn target is another repo: the session runs in ${session}, the target is ${fixture}\n`,
    );

    markFixture();
    for (const host of ["herdr", "tmux", "none"] as const) {
      const result = frontDoor(session, fixture, host);
      expect(result.code).toBe(0);
      expect(result.err).toBe("");
      expect(result.out).toBe(`${baseline.out}headless fixture copy made by fixture.sh new\n`);
    }

    removeFixtureMark();
    const unmarked = frontDoor(session, fixture, "none");
    expect(unmarked.code).toBe(baseline.code);
    expect(unmarked.out).toBe(baseline.out);
  });

  test("a marked fixture remains self when this session already is the postmaster", () => {
    markFixture();

    const result = frontDoor(fixture, fixture, "herdr");

    expect(result.code).toBe(0);
    expect(result.out).toBe(
      [
        "self team.postmaster harness and model, ",
        "the target is this repo, and the user is at the terminal\n",
      ].join(""),
    );
  });

  test("an ordinary repository never gets the fixture headless route", () => {
    const ordinary = join(scratch, "ordinary");
    initRepo(ordinary);

    const result = frontDoor(session, ordinary, "tmux");

    expect(result.code).toBe(0);
    expect(result.out).toBe(
      `spawn target is another repo: the session runs in ${session}, the target is ${ordinary}\n`,
    );
  });
});
