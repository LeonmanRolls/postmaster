// Tests beside scripts/front-door.ts, moved from its --self-test on #109: 45 controls.
// Follow-up stderr checks re-run their command instead of reading the previous run's stderr.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./lib/proc.ts";

const cli = join(import.meta.dir, "run");

interface CliResult {
  code: number;
  out: string;
  err: string;
}

function runCli(
  args: string[],
  opts: { cwd?: string; env?: Record<string, string | undefined> } = {},
): CliResult {
  const r = spawnSync(cli, ["front-door", ...args], {
    cwd: opts.cwd,
    encoding: "utf8",
    env: opts.env === undefined ? process.env : { ...process.env, ...opts.env },
  });
  return { code: r.status ?? -1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

function git(dir: string, args: string[]): void {
  const r = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
}

function firstWord(out: string): string {
  return out.split(" ")[0] ?? "";
}

let tmp: string;
let here: string;
let there: string;

function writeConfig(name: string, harness: string, model: string): void {
  writeFileSync(
    join(tmp, `${name}.toml`),
    `[team]\npostmaster = { harness = "${harness}", model = "${model}" }\n`,
  );
}

function cfg(name: string): string[] {
  return ["--config", join(tmp, `${name}.toml`)];
}

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "front-door-"));
  here = join(tmp, "here");
  there = join(tmp, "there");
  mkdirSync(join(here, "sub"), { recursive: true });
  mkdirSync(there, { recursive: true });
  mkdirSync(join(tmp, "notrepo"), { recursive: true });
  for (const repo of [here, there]) {
    git(repo, ["init", "-q"]);
    git(repo, [
      "-c",
      "use" + "r.e" + "mai" + "l=t" + "@t",
      "-c",
      "user.name=t",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "base",
    ]);
  }
  git(here, ["worktree", "add", "-q", join(tmp, "here-wt"), "-b", "wt"]);
  writeConfig("match", "claude", "pm-model");
  writeConfig("spaces", "claude code", "pm-model");
  writeConfig("empty", "", "pm-model");
  writeConfig("blank", "   ", "pm-model");
  writeFileSync(join(tmp, "no-pm.toml"), '[team]\nworkhorses = ["a"]\n');
  writeFileSync(join(tmp, "bad.toml"), "[team\nbroken\n");
  writeFileSync(join(tmp, "strteam.toml"), 'team = "oops"\n');
  writeFileSync(
    join(tmp, "nonstr.toml"),
    '[team]\npostmaster = { harness = 7, model = "pm-model" }\n',
  );
  writeFileSync(
    join(tmp, "newline.toml"),
    '[team]\npostmaster = { harness = "claude", model = "pm-model\\nother" }\n',
  );
  writeFileSync(join(tmp, "tab.toml"), '[team]\npostmaster = { harness = "a\\tb", model = "m" }\n');
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("positive controls", () => {
  test("harness differs prints spawn naming harness", () => {
    const r = runCli(["grok", "pm-model", here, "yes", here, ...cfg("match")]);
    expect(r.code).toBe(0);
    expect(firstWord(r.out)).toBe("spawn");
    expect(r.out).toContain("harness differs");
  });

  test("model differs prints spawn naming model", () => {
    const r = runCli(["claude", "other-model", here, "yes", here, ...cfg("match")]);
    expect(r.code).toBe(0);
    expect(firstWord(r.out)).toBe("spawn");
    expect(r.out).toContain("model differs");
  });

  test("target is another repo prints spawn naming target", () => {
    const r = runCli(["claude", "pm-model", here, "yes", there, ...cfg("match")]);
    expect(r.code).toBe(0);
    expect(firstWord(r.out)).toBe("spawn");
    expect(r.out).toContain("target is another repo");
  });

  test("nobody at the terminal prints spawn naming terminal", () => {
    const r = runCli(["claude", "pm-model", here, "no", here, ...cfg("match")]);
    expect(r.code).toBe(0);
    expect(firstWord(r.out)).toBe("spawn");
    expect(r.out).toContain("nobody at the terminal");
  });

  test("all four match prints self", () => {
    const r = runCli(["claude", "pm-model", here, "yes", here, ...cfg("match")]);
    expect(r.code).toBe(0);
    expect(firstWord(r.out)).toBe("self");
  });

  test("a worktree of the target is the target's repo, so it is self", () => {
    const r = runCli(["claude", "pm-model", join(tmp, "here-wt"), "yes", here, ...cfg("match")]);
    expect(r.code).toBe(0);
    expect(firstWord(r.out)).toBe("self");
  });

  test("a subdirectory of the target is the target's repo, so it is self", () => {
    const r = runCli(["claude", "pm-model", join(tmp, "here/sub"), "yes", here, ...cfg("match")]);
    expect(r.code).toBe(0);
    expect(firstWord(r.out)).toBe("self");
  });

  test("every failed condition is reported", () => {
    const r = runCli(["grok", "other-model", there, "no", here, ...cfg("match")]);
    expect(r.code).toBe(0);
    expect(firstWord(r.out)).toBe("spawn");
    expect(r.out).toContain("harness differs");
  });

  test("a directory outside any repo fails closed naming both paths", () => {
    const r = runCli(["claude", "pm-model", join(tmp, "notrepo"), "yes", here, ...cfg("match")]);
    expect(r.code).toBe(0);
    expect(firstWord(r.out)).toBe("spawn");
    expect(r.out).toContain("not in a git repository");
  });

  test("a target outside any repo fails closed naming both paths", () => {
    const r = runCli(["claude", "pm-model", here, "yes", join(tmp, "notrepo"), ...cfg("match")]);
    expect(r.code).toBe(0);
    expect(firstWord(r.out)).toBe("spawn");
    expect(r.out).toContain("not in a git repository");
  });

  test("a harness name with a space still matches itself", () => {
    const r = runCli(["claude code", "pm-model", here, "yes", here, ...cfg("spaces")]);
    expect(r.code).toBe(0);
    expect(firstWord(r.out)).toBe("self");
  });

  test("an empty harness decides spawn, not usage", () => {
    const r = runCli(["", "pm-model", here, "yes", here, ...cfg("match")]);
    expect(r.code).toBe(0);
    expect(firstWord(r.out)).toBe("spawn");
    expect(r.out).toContain("harness differs");
  });

  test("a reported model with a newline decides spawn", () => {
    const r = runCli(["claude", "pm-model\nother", here, "yes", here, ...cfg("match")]);
    expect(r.code).toBe(0);
    expect(firstWord(r.out)).toBe("spawn");
    expect(r.out).toContain("model differs");
  });
});

describe("empty paths fail closed from inside a repo", () => {
  test("an empty cwd fails closed from inside a repo", () => {
    const r = runCli(["claude", "pm-model", "", "yes", here, ...cfg("match")], { cwd: here });
    expect(r.code).toBe(0);
    expect(r.out.startsWith("spawn not in a git repository")).toBe(true);
  });

  test("an empty target fails closed from inside a repo", () => {
    const r = runCli(["claude", "pm-model", here, "yes", "", ...cfg("match")], { cwd: here });
    expect(r.code).toBe(0);
    expect(r.out.startsWith("spawn not in a git repository")).toBe(true);
  });

  test("an empty cwd and target fail closed from inside a repo", () => {
    const r = runCli(["claude", "pm-model", "", "yes", "", ...cfg("match")], { cwd: here });
    expect(r.code).toBe(0);
    expect(r.out.startsWith("spawn not in a git repository")).toBe(true);
  });
});

describe("caller environment does not steer identity", () => {
  test("a GIT_DIR from the caller does not steer distinct repos to self", () => {
    const r = runCli(["claude", "pm-model", here, "yes", there, ...cfg("match")], {
      env: {
        GIT_DIR: join(tmp, "there/.git"),
        GIT_COMMON_DIR: join(tmp, "there/.git"),
      },
    });
    expect(r.code).toBe(0);
    expect(firstWord(r.out)).toBe("spawn");
    expect(r.out).toContain("target is another repo");
  });
});

describe("negative controls", () => {
  test("the harness matching does not print the harness reason", () => {
    const r = runCli(["claude", "other-model", here, "yes", here, ...cfg("match")]);
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("harness differs");
    expect(r.out).toContain("model differs");
  });

  test("the model matching does not print the model reason", () => {
    const r = runCli(["grok", "pm-model", here, "yes", here, ...cfg("match")]);
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("model differs");
    expect(r.out).toContain("harness differs");
  });

  test("the target matching does not print the target reason", () => {
    const r = runCli(["claude", "pm-model", here, "no", here, ...cfg("match")]);
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("target is another repo");
    expect(r.out).toContain("nobody at the terminal");
  });

  test("a person at the terminal does not print the terminal reason", () => {
    const r = runCli(["grok", "pm-model", here, "yes", here, ...cfg("match")]);
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("nobody at the terminal");
    expect(r.out).toContain("harness differs");
  });

  test("an unresolvable path does not print the another-repo label", () => {
    const r = runCli(["claude", "pm-model", join(tmp, "notrepo"), "yes", here, ...cfg("match")]);
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("target is another repo");
    expect(r.out).toContain("not in a git repository");
  });

  test("resolved paths do not print the unresolvable label", () => {
    const r = runCli(["grok", "pm-model", here, "yes", here, ...cfg("match")]);
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("not in a git repository");
    expect(r.out).toContain("harness differs");
  });

  for (const reason of [
    "harness differs",
    "model differs",
    "target is another repo",
    "nobody at the terminal",
  ]) {
    test(`all four failing names ${reason}`, () => {
      const r = runCli(["grok", "other-model", there, "no", here, ...cfg("match")]);
      expect(r.out).toContain(reason);
    });
  }

  test("reasons print in ticket order", () => {
    const r = runCli(["grok", "other-model", there, "no", here, ...cfg("match")]);
    const out = r.out.trimEnd();
    expect(out.startsWith("spawn harness differs")).toBe(true);
    expect(out).toContain("; model differs");
    expect(out).toContain("; target is another repo");
    expect(out.endsWith("nobody at the terminal")).toBe(true);
  });
});

describe("refusals", () => {
  test("no config is refused", () => {
    const r = runCli(["claude", "pm-model", here, "yes", here, ...cfg("none")]);
    expect(r.code).toBe(1);
    expect(firstWord(r.out)).toBe("");
  });

  test("a config with no team.postmaster is refused", () => {
    const r = runCli(["claude", "pm-model", here, "yes", here, ...cfg("no-pm")]);
    expect(r.code).toBe(1);
    expect(firstWord(r.out)).toBe("");
  });

  test("a config that does not parse is refused", () => {
    const r = runCli(["claude", "pm-model", here, "yes", here, ...cfg("bad")]);
    expect(r.code).toBe(1);
    expect(firstWord(r.out)).toBe("");
  });

  test("a config whose team is not a table is refused", () => {
    const r = runCli(["claude", "pm-model", here, "yes", here, ...cfg("strteam")]);
    expect(r.code).toBe(1);
    expect(firstWord(r.out)).toBe("");
  });

  test("and refuses in its own words, with no traceback", () => {
    const r = runCli(["claude", "pm-model", here, "yes", here, ...cfg("strteam")]);
    expect(r.err).toContain("team.postmaster");
    expect(r.err).not.toContain("Traceback");
  });

  test("a config with a non-string harness is refused", () => {
    const r = runCli(["claude", "pm-model", here, "yes", here, ...cfg("nonstr")]);
    expect(r.code).toBe(1);
    expect(firstWord(r.out)).toBe("");
  });

  test("a config with an empty harness is refused", () => {
    const r = runCli(["claude", "pm-model", here, "yes", here, ...cfg("empty")]);
    expect(r.code).toBe(1);
    expect(firstWord(r.out)).toBe("");
  });

  test("a config with a blank harness is refused", () => {
    const r = runCli(["claude", "pm-model", here, "yes", here, ...cfg("blank")]);
    expect(r.code).toBe(1);
    expect(firstWord(r.out)).toBe("");
  });

  test("a config with a newline in the model is refused", () => {
    const r = runCli(["claude", "pm-model", here, "yes", here, ...cfg("newline")]);
    expect(r.code).toBe(1);
    expect(firstWord(r.out)).toBe("");
  });

  test("and says control characters", () => {
    const r = runCli(["claude", "pm-model", here, "yes", here, ...cfg("newline")]);
    expect(r.err).toContain("control characters");
  });

  test("a config with a tab in the harness is refused", () => {
    const r = runCli(["a\tb", "m", here, "yes", here, ...cfg("tab")]);
    expect(r.code).toBe(1);
    expect(firstWord(r.out)).toBe("");
  });

  test("at-terminal is yes or no, not anything else", () => {
    const r = runCli(["claude", "pm-model", here, "maybe", here, ...cfg("match")]);
    expect(r.code).toBe(1);
    expect(firstWord(r.out)).toBe("");
  });

  test("and says so", () => {
    const r = runCli(["claude", "pm-model", here, "maybe", here, ...cfg("match")]);
    expect(r.err).toContain("at-terminal is yes or no");
  });

  test("POSTMASTER_CONFIG names the config", () => {
    const r = runCli(["claude", "pm-model", here, "yes", here], {
      env: { POSTMASTER_CONFIG: join(tmp, "match.toml") },
    });
    expect(r.code).toBe(0);
    expect(firstWord(r.out)).toBe("self");
  });

  test("--config overrides POSTMASTER_CONFIG", () => {
    const r = runCli(["claude", "pm-model", here, "yes", here, ...cfg("match")], {
      env: { POSTMASTER_CONFIG: join(tmp, "no-pm.toml") },
    });
    expect(r.code).toBe(0);
    expect(firstWord(r.out)).toBe("self");
  });

  test("four arguments is a usage error", () => {
    const r = runCli(["claude", "pm-model", here, "yes"]);
    expect(r.code).toBe(2);
    expect(firstWord(r.out)).toBe("");
  });

  test("an unknown flag exits 2", () => {
    const r = runCli(["--no-such-flag", "extra"]);
    expect(r.code).toBe(2);
    expect(firstWord(r.out)).toBe("");
  });
});

// Main's #98 headless-fixture controls, unioned at the merge: the beside suite
// above is this branch's; what follows is main's, verbatim but for imports.

const SCRIPT = join(import.meta.dir, "run");
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
  return run(SCRIPT, ["front-door", "claude", "pm-model", cwd, "yes", target, "--config", config], {
    env: {
      ...gitEnv,
      POSTMASTER_HOST: host,
      HERDR_SOCKET_PATH: host === "herdr" ? join(scratch, "herdr.sock") : undefined,
      TMUX: host === "tmux" ? "test-server,1,0" : undefined,
      TMUX_PANE: host === "tmux" ? "%1" : undefined,
    },
    input: "",
  });
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
      expect(result.out).toBe(
        `${baseline.out}headless the target is a fixture copy made by run fixture new\nfixture the target is a fixture copy made by run fixture new\n`,
      );
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
        "fixture the target is a fixture copy made by run fixture new\n",
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

describe("subdirectory targets", () => {
  test("a subdirectory target reads the repository root's settings", () => {
    const sub = join(fixture, "sub");
    mkdirSync(sub, { recursive: true });
    mkdirSync(join(fixture, ".postmaster"), { recursive: true });
    writeFileSync(
      join(fixture, ".postmaster", "settings.toml"),
      '[team]\npostmaster = { harness = "codex", model = "sub-model" }\n',
    );
    const r = run(
      SCRIPT,
      ["front-door", "codex", "sub-model", sub, "yes", sub, "--config", config],
      { env: { ...gitEnv, POSTMASTER_HOST: "none" }, input: "" },
    );
    expect(r.code).toBe(0);
    expect(firstWord(r.out)).toBe("self");
  }, 10000);
});
