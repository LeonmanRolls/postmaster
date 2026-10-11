// Oracle for #338, committed before the change: one check says whether a
// project's settings, global and project together, are complete and valid.
// C1 drives `run check-setup` as a subprocess over scratch configs and
// scratch git repositories, never importing the change; C2 asserts it names
// what is missing; the runbook half asserts AGENTS.md and SKILL.md call that
// one command, and the pass goes on only after it says set up. C3, the
// fixture run from the final head, is not a unit test: landing this change
// dispatches and scores it.
import { describe, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ROOT,
  RUN,
  checkSetup,
  initRepo,
  stubBin,
  tempDir,
  writeRepoFile,
} from "./acceptance-338.ts";
import { run } from "./lib/proc.ts";

const LANES = `[lanes.alpha]
harness = "stub-harness-a"
model = "model-a"

[lanes.beta]
harness = "stub-harness-b"
model = "model-b"
`;

const TEAM_NO_PM = `[team]
reviewers = ["alpha", "beta"]
`;

const TEAM_FULL = `[team]
workhorses = ["alpha", "beta"]
reviewers = ["alpha", "beta"]
coachman = { harness = "stub-harness-c", model = "model-c" }
coachman_fallback = { harness = "stub-harness-c", model = "model-c" }
postmaster = { harness = "stub-harness-c", model = "model-c" }
clerk = { harness = "stub-harness-c", model = "model-c" }
max_runs = 2
mode = "synthesis"
`;

const PM_ONLY = `[team]
postmaster = { harness = "stub-harness-c", model = "model-c" }
`;

const TEAM_REVIEWERS_PM = `[team]
reviewers = ["alpha", "beta"]
postmaster = { harness = "stub-harness-c", model = "model-c" }
`;

interface Staged {
  dir: string;
  repo: string;
  configPath: string;
  bin: string;
}

function stage(options: { config?: string; settings?: string }): Staged {
  const dir = tempDir();
  const repo = join(dir, "proj");
  initRepo(repo);
  const bin = stubBin(dir, ["stub-harness-a", "stub-harness-b", "stub-harness-c"]);
  const configPath = join(dir, "config.toml");
  if (options.config !== undefined) writeFileSync(configPath, options.config);
  if (options.settings !== undefined) {
    writeRepoFile(repo, ".postmaster/settings.toml", options.settings);
  }
  return { dir, repo, configPath, bin };
}

function cleanup(s: Staged): void {
  rmSync(s.dir, { recursive: true, force: true });
}

describe("C1: one check says whether a project is set up", () => {
  test("no global config and no project settings is not set up", () => {
    const s = stage({});
    try {
      const r = checkSetup(s.repo, s.configPath, s.bin);
      expect(r.code).toBe(1);
      expect(r.out.startsWith("not set up: ")).toBe(true);
    } finally {
      cleanup(s);
    }
  });

  test("a global config that does not parse is not set up", () => {
    const s = stage({ config: "this is [not toml\n" });
    try {
      const r = checkSetup(s.repo, s.configPath, s.bin);
      expect(r.code).toBe(1);
      expect(r.out.startsWith("not set up: ")).toBe(true);
    } finally {
      cleanup(s);
    }
  });

  test("a global config with no team.postmaster is not set up", () => {
    const s = stage({ config: `${LANES}\n${TEAM_NO_PM}` });
    try {
      const r = checkSetup(s.repo, s.configPath, s.bin);
      expect(r.code).toBe(1);
      expect(r.out.startsWith("not set up: ")).toBe(true);
    } finally {
      cleanup(s);
    }
  });

  test("a partial global config the project settings complete is set up", () => {
    const s = stage({ config: `${LANES}\n${TEAM_NO_PM}`, settings: PM_ONLY });
    try {
      const r = checkSetup(s.repo, s.configPath, s.bin);
      expect(r.code).toBe(0);
      expect(r.out.startsWith("set up: ")).toBe(true);
    } finally {
      cleanup(s);
    }
  });

  test("a complete global config with no project settings is set up", () => {
    const s = stage({ config: `${LANES}\n${TEAM_FULL}` });
    try {
      const r = checkSetup(s.repo, s.configPath, s.bin);
      expect(r.code).toBe(0);
      expect(r.out.startsWith("set up: ")).toBe(true);
    } finally {
      cleanup(s);
    }
  });

  test("complete project settings alone, with no global config, are set up", () => {
    const s = stage({ settings: `${LANES}\n${TEAM_REVIEWERS_PM}` });
    try {
      const r = checkSetup(s.repo, s.configPath, s.bin);
      expect(r.code).toBe(0);
      expect(r.out.startsWith("set up: ")).toBe(true);
    } finally {
      cleanup(s);
    }
  });

  test("no project argument is usage, not a verdict", () => {
    const r = run(RUN, ["check-setup"]);
    expect(r.code).toBe(2);
    expect(r.out).toBe("");
  });
});

describe("C2: when a project is not set up, the check names what is missing", () => {
  test("no settings at all names the missing global config and project settings", () => {
    const s = stage({});
    try {
      const r = checkSetup(s.repo, s.configPath, s.bin);
      expect(r.code).toBe(1);
      expect(r.out).toContain("no config at");
      expect(r.out).toContain("config.toml");
      expect(r.out).toContain("no usable project settings");
      expect(r.out).toContain(join(".postmaster", "settings.toml"));
    } finally {
      cleanup(s);
    }
  });

  test("an unparseable file names the file", () => {
    const s = stage({ config: "this is [not toml\n" });
    try {
      const r = checkSetup(s.repo, s.configPath, s.bin);
      expect(r.code).toBe(1);
      expect(r.out).toContain("config.toml");
      expect(r.out).toContain("does not parse");
    } finally {
      cleanup(s);
    }
  });

  test("a missing postmaster role names it", () => {
    const s = stage({ config: `${LANES}\n${TEAM_NO_PM}` });
    try {
      const r = checkSetup(s.repo, s.configPath, s.bin);
      expect(r.code).toBe(1);
      expect(r.out).toContain("team.postmaster");
    } finally {
      cleanup(s);
    }
  });

  test("a harness not on PATH names it", () => {
    const lanes = LANES.replace("stub-harness-b", "no-such-harness-338");
    const s = stage({ config: `${lanes}\n${TEAM_FULL}` });
    try {
      const r = checkSetup(s.repo, s.configPath, s.bin);
      expect(r.code).toBe(1);
      expect(r.out).toContain("no-such-harness-338");
      expect(r.out).toContain("not on PATH");
    } finally {
      cleanup(s);
    }
  });

  test("fewer than two lanes names it", () => {
    const one = `[lanes.alpha]
harness = "stub-harness-a"
model = "model-a"
`;
    const s = stage({ config: `${one}\n${TEAM_FULL}` });
    try {
      const r = checkSetup(s.repo, s.configPath, s.bin);
      expect(r.code).toBe(1);
      expect(r.out).toContain("at least two lanes");
    } finally {
      cleanup(s);
    }
  });

  test("a reviewer that is not a lane names it", () => {
    const team = TEAM_FULL.replace(
      'reviewers = ["alpha", "beta"]',
      'reviewers = ["alpha", "gamma"]',
    );
    const s = stage({ config: `${LANES}\n${team}` });
    try {
      const r = checkSetup(s.repo, s.configPath, s.bin);
      expect(r.code).toBe(1);
      expect(r.out).toContain("reviewer 'gamma' is not one of the lanes");
    } finally {
      cleanup(s);
    }
  });

  test("a lens reviewer that is not a lane names it", () => {
    const team = `${TEAM_FULL}\n[team.lens_reviewers]\nbug = ["gamma"]\n`;
    const s = stage({ config: `${LANES}\n${team}` });
    try {
      const r = checkSetup(s.repo, s.configPath, s.bin);
      expect(r.code).toBe(1);
      expect(r.out).toContain("bug reviewer 'gamma' is not one of the lanes");
    } finally {
      cleanup(s);
    }
  });

  test("the coachman on a lane's model names it", () => {
    const team = TEAM_FULL.replace(
      'coachman = { harness = "stub-harness-c", model = "model-c" }',
      'coachman = { harness = "stub-harness-c", model = "model-a" }',
    );
    const s = stage({ config: `${LANES}\n${team}` });
    try {
      const r = checkSetup(s.repo, s.configPath, s.bin);
      expect(r.code).toBe(1);
      expect(r.out).toContain("the coachman cannot run on a lane's model");
    } finally {
      cleanup(s);
    }
  });

  test("the fallback coachman on a lane's model names it", () => {
    const team = TEAM_FULL.replace(
      'coachman_fallback = { harness = "stub-harness-c", model = "model-c" }',
      'coachman_fallback = { harness = "stub-harness-c", model = "model-b" }',
    );
    const s = stage({ config: `${LANES}\n${team}` });
    try {
      const r = checkSetup(s.repo, s.configPath, s.bin);
      expect(r.code).toBe(1);
      expect(r.out).toContain("the fallback coachman cannot run on a lane's model");
    } finally {
      cleanup(s);
    }
  });
});

describe("review round 1: malformed reviewers and postmaster attribution", () => {
  test("a reviewers list holding a non-string is not set up and names it", () => {
    const team = TEAM_FULL.replace('reviewers = ["alpha", "beta"]', 'reviewers = ["alpha", 7]');
    const s = stage({ config: `${LANES}\n${team}` });
    try {
      const r = checkSetup(s.repo, s.configPath, s.bin);
      expect(r.code).toBe(1);
      expect(r.out).toContain("[team] reviewers is not a list of lane names");
    } finally {
      cleanup(s);
    }
  });

  test("a lens reviewers list holding a non-string is not set up and names it", () => {
    const team = `${TEAM_FULL}\n[team.lens_reviewers]\nbug = ["alpha", 7]\n`;
    const s = stage({ config: `${LANES}\n${team}` });
    try {
      const r = checkSetup(s.repo, s.configPath, s.bin);
      expect(r.code).toBe(1);
      expect(r.out).toContain("[team.lens_reviewers] bug is not a list of lane names");
    } finally {
      cleanup(s);
    }
  });

  test("a bad postmaster the project settings set is blamed on the project file", () => {
    const s = stage({
      config: `${LANES}\n${TEAM_REVIEWERS_PM}`,
      settings: `[team]\npostmaster = { harness = "", model = "model-c" }\n`,
    });
    try {
      const r = checkSetup(s.repo, s.configPath, s.bin);
      expect(r.code).toBe(1);
      expect(r.out).toContain(join(".postmaster", "settings.toml"));
      expect(r.out).not.toContain(s.configPath);
    } finally {
      cleanup(s);
    }
  });

  test("a bad postmaster only the global config sets is blamed on the global file", () => {
    const team = TEAM_REVIEWERS_PM.replace(
      'postmaster = { harness = "stub-harness-c", model = "model-c" }',
      'postmaster = { harness = "", model = "model-c" }',
    );
    const s = stage({ config: `${LANES}\n${team}`, settings: TEAM_NO_PM });
    try {
      const r = checkSetup(s.repo, s.configPath, s.bin);
      expect(r.code).toBe(1);
      expect(r.out).toContain(s.configPath);
      expect(r.out).not.toContain(join(".postmaster", "settings.toml"));
    } finally {
      cleanup(s);
    }
  });

  test("a bad key the global config sets is blamed on it when the project sets the other", () => {
    const team = TEAM_REVIEWERS_PM.replace(
      'postmaster = { harness = "stub-harness-c", model = "model-c" }',
      'postmaster = { harness = "", model = "model-c" }',
    );
    const s = stage({
      config: `${LANES}\n${team}`,
      settings: `[team]\npostmaster = { model = "model-z" }\n`,
    });
    try {
      const r = checkSetup(s.repo, s.configPath, s.bin);
      expect(r.code).toBe(1);
      expect(r.out).toContain(s.configPath);
      expect(r.out).not.toContain(join(".postmaster", "settings.toml"));
    } finally {
      cleanup(s);
    }
  });
});

describe("runbooks: the front door calls the one check", () => {
  const agents = readFileSync(join(ROOT, "AGENTS.md"), "utf8");
  const skill = readFileSync(join(ROOT, "skills", "postmaster", "SKILL.md"), "utf8");

  test("AGENTS.md calls check-setup for the chosen project", () => {
    expect(agents).toContain("scripts/run check-setup");
  });

  test("SKILL.md calls check-setup for the chosen project", () => {
    expect(skill).toContain("<tool>/scripts/run check-setup");
  });

  test("the pass goes on only after the check says set up", () => {
    const sentence = "The pass goes on only after the check says the project is set up.";
    expect(agents).toContain(sentence);
    expect(skill).toContain(sentence);
  });

  test("neither still judges setup by printing the config file", () => {
    expect(agents).not.toContain('echo "NOT SET UP"');
    expect(skill).not.toContain('echo "NOT SET UP"');
  });
});
