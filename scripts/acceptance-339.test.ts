// Oracle for #339, committed before the change: after the project is chosen,
// setup offers the global config, which the user can set up or skip, and then
// the project's own settings or the global config as it is. C1-C5 drive
// `run setup-next`, `run setup --project` and `run project-settings` as
// subprocesses over scratch configs and scratch git repositories, never
// importing the change; the runbook half asserts AGENTS.md, SKILL.md, the
// README and the settings example carry the new steps. C6, the fixture run
// from the final head, is not a unit test: landing this change dispatches
// and scores it.
import { describe, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkIgnore,
  checkSetup,
  initRepo,
  projectSettings,
  ROOT,
  setupNext,
  setupProject,
  stubBin,
  tempDir,
  writeRepoFile,
} from "./acceptance-339.ts";

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

const FULL_ANSWERS = [
  "lanes=alpha, beta",
  "lane.alpha.harness=stub-harness-a",
  "lane.alpha.model=model-a",
  "lane.beta.harness=stub-harness-b",
  "lane.beta.model=model-b",
  "workhorses=alpha, beta",
  "reviewers=alpha, beta",
  "coachman.harness=stub-harness-c",
  "coachman.model=model-c",
  "fallback.harness=stub-harness-c",
  "fallback.model=model-c",
  "postmaster.harness=stub-harness-c",
  "postmaster.model=model-c",
  "clerk.harness=stub-harness-c",
  "clerk.model=model-c",
  "max_runs=5",
  "mode=single-thread",
  "poll_seconds=60",
  "tracker=local",
  "confine=off",
  "postmaster_may_create=yes",
  "round_timeout_seconds=600",
  "merge_authority=postmaster",
  "checkpoint_mode=consult",
].join("\n");

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

function answers(dir: string, name: string, text: string): string {
  const path = join(dir, `${name}.answers`);
  writeFileSync(path, `${text}\n`);
  return path;
}

// Settings files are judged parsed: setup rewrites the file whole, so key
// order, table form and comments are the emitter's, not the oracle's.
function tableOf(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

describe("C1: no global config offers setup or skip, then the project step", () => {
  test("a missing global config routes to the global step", () => {
    const s = stage({});
    try {
      const r = setupNext(s.repo, s.configPath, s.bin);
      expect(r.code).toBe(0);
      expect(r.out).toContain(`global=missing:${s.configPath}`);
      expect(r.out).toContain("project_settings=missing:");
      expect(r.out).toContain("settings_ignored=no");
      expect(r.out).toContain("next=global");
      expect(r.out).toContain("setup=not set up");
    } finally {
      cleanup(s);
    }
  });

  test("skipping writes no global config and the project step stands next", () => {
    const s = stage({});
    try {
      // The skip is the runbook's transition, not a script call: nothing runs
      // here, and afterwards the project step is what setup-next would route
      // past the skipped global step. The scripts write no global config.
      const before = setupNext(s.repo, s.configPath, s.bin);
      expect(before.code).toBe(0);
      expect(before.out).toContain("next=global");
      let globalExists = false;
      try {
        readFileSync(s.configPath);
        globalExists = true;
      } catch {
        globalExists = false;
      }
      expect(globalExists).toBe(false);
    } finally {
      cleanup(s);
    }
  });
});

describe("C2: the project step offers settings or the global config as it is", () => {
  test("an incomplete global config routes to the project step", () => {
    const s = stage({ config: `${LANES}\n${TEAM_NO_PM}` });
    try {
      const r = setupNext(s.repo, s.configPath, s.bin);
      expect(r.code).toBe(0);
      expect(r.out).toContain(`global=present:${s.configPath}`);
      expect(r.out).toContain("project_settings=missing:");
      expect(r.out).toContain("next=project");
      expect(r.out).toContain("setup=not set up");
      expect(r.out).toContain("postmaster");
    } finally {
      cleanup(s);
    }
  });

  test("a complete global config with no project settings is done", () => {
    const s = stage({ config: `${LANES}\n${TEAM_FULL}` });
    try {
      const r = setupNext(s.repo, s.configPath, s.bin);
      expect(r.code).toBe(0);
      expect(r.out).toContain("next=done");
      expect(r.out).toContain("setup=set up");
    } finally {
      cleanup(s);
    }
  });

  test("project settings that leave the project short route back to the project step", () => {
    const s = stage({
      config: `${LANES}\n${TEAM_NO_PM}`,
      settings: `[team]\nmax_runs = 5\n`,
    });
    try {
      const r = setupNext(s.repo, s.configPath, s.bin);
      expect(r.code).toBe(0);
      expect(r.out).toContain("project_settings=present:");
      expect(r.out).toContain("next=project");
      expect(r.out).toContain("setup=not set up");
    } finally {
      cleanup(s);
    }
  });

  test("complete project settings with no global config are done", () => {
    const s = stage({ settings: `${LANES}\n${TEAM_FULL}` });
    try {
      const r = setupNext(s.repo, s.configPath, s.bin);
      expect(r.code).toBe(0);
      expect(r.out).toContain("global=missing:");
      expect(r.out).toContain("next=done");
      expect(r.out).toContain("setup=set up");
    } finally {
      cleanup(s);
    }
  });

  test("the project step's dry run prints only the answered change and writes nothing", () => {
    const s = stage({ config: `${LANES}\n${TEAM_FULL}` });
    try {
      const file = answers(s.dir, "one", "lane.alpha.model=model-x");
      const r = setupProject(s.repo, s.configPath, s.bin, ["--answers", file, "--dry-run"]);
      expect(r.code).toBe(0);
      expect(r.out).toContain("[lanes.alpha]");
      expect(r.out).toContain('model = "model-x"');
      expect(r.out).not.toContain("[lanes.beta]");
      expect(r.out).not.toContain("model-a");
      let settingsExists = false;
      try {
        readFileSync(join(s.repo, ".postmaster", "settings.toml"));
        settingsExists = true;
      } catch {
        settingsExists = false;
      }
      expect(settingsExists).toBe(false);
    } finally {
      cleanup(s);
    }
  });

  test("project setup with no answers refuses instead of writing nothing", () => {
    const s = stage({ config: `${LANES}\n${TEAM_FULL}` });
    try {
      const file = answers(s.dir, "empty", "");
      const r = setupProject(s.repo, s.configPath, s.bin, ["--answers", file]);
      expect(r.code).toBe(1);
      expect(`${r.out}${r.err}`).toContain("no project settings given");
      let settingsExists = false;
      try {
        readFileSync(join(s.repo, ".postmaster", "settings.toml"));
        settingsExists = true;
      } catch {
        settingsExists = false;
      }
      expect(settingsExists).toBe(false);
    } finally {
      cleanup(s);
    }
  });
});

describe("C3: project settings hold only what the user changed", () => {
  test("changing one lane's model writes that one change and leaves the global file alone", () => {
    const config = `${LANES}\n${TEAM_FULL}`;
    const s = stage({ config });
    try {
      const file = answers(s.dir, "one", "lane.alpha.model=model-x");
      const r = setupProject(s.repo, s.configPath, s.bin, ["--answers", file]);
      expect(r.code).toBe(0);
      const written = readFileSync(join(s.repo, ".postmaster", "settings.toml"), "utf8");
      const fileData = Bun.TOML.parse(written);
      expect(Object.keys(fileData)).toEqual(["lanes"]);
      const lanes = tableOf(fileData.lanes);
      expect(Object.keys(lanes)).toEqual(["alpha"]);
      expect(tableOf(lanes.alpha)).toEqual({ model: "model-x" });
      const merged = projectSettings(s.repo, s.configPath, s.bin, ["effective", s.repo]);
      expect(merged.code).toBe(0);
      const parsed = JSON.parse(merged.out) as Record<
        string,
        Record<string, Record<string, string>>
      >;
      expect(parsed.lanes?.alpha?.model).toBe("model-x");
      expect(parsed.lanes?.beta?.model).toBe("model-b");
      expect(readFileSync(s.configPath, "utf8")).toBe(config);
    } finally {
      cleanup(s);
    }
  });

  test("with no global config the file holds every setting the user gave", () => {
    const s = stage({});
    try {
      const file = answers(s.dir, "full", FULL_ANSWERS);
      const r = setupProject(s.repo, s.configPath, s.bin, ["--answers", file]);
      expect(r.code).toBe(0);
      const written = readFileSync(join(s.repo, ".postmaster", "settings.toml"), "utf8");
      const fileData = Bun.TOML.parse(written);
      const lanes = tableOf(fileData.lanes);
      expect(tableOf(lanes.alpha)).toEqual({ harness: "stub-harness-a", model: "model-a" });
      expect(tableOf(lanes.beta)).toEqual({ harness: "stub-harness-b", model: "model-b" });
      const team = tableOf(fileData.team);
      expect(team.workhorses).toEqual(["alpha", "beta"]);
      expect(team.reviewers).toEqual(["alpha", "beta"]);
      expect(tableOf(team.coachman)).toEqual({ harness: "stub-harness-c", model: "model-c" });
      expect(tableOf(team.coachman_fallback)).toEqual({
        harness: "stub-harness-c",
        model: "model-c",
      });
      expect(tableOf(team.postmaster)).toEqual({ harness: "stub-harness-c", model: "model-c" });
      expect(tableOf(team.clerk)).toEqual({ harness: "stub-harness-c", model: "model-c" });
      expect(team.max_runs).toBe(5);
      expect(team.mode).toBe("single-thread");
      expect(tableOf(fileData.postmaster).poll_seconds).toBe(60);
      expect(tableOf(fileData.tracker).kind).toBe("local");
      expect(tableOf(fileData.tracker).postmaster_may_create).toBe(true);
      expect(fileData.confine).toBe("off");
      expect(tableOf(fileData.review).round_timeout_seconds).toBe(600);
      expect(tableOf(fileData.ship).merge_authority).toBe("postmaster");
      expect(tableOf(fileData.ship).checkpoint_mode).toBe("consult");
      expect(Object.hasOwn(fileData, "projects_roots")).toBe(false);
      const check = checkSetup(s.repo, s.configPath, s.bin);
      expect(check.code).toBe(0);
      expect(check.out.startsWith("set up: ")).toBe(true);
      let globalExists = false;
      try {
        readFileSync(s.configPath);
        globalExists = true;
      } catch {
        globalExists = false;
      }
      expect(globalExists).toBe(false);
    } finally {
      cleanup(s);
    }
  });

  test("project setup refuses a harness that is not on PATH and writes nothing", () => {
    const s = stage({ config: `${LANES}\n${TEAM_FULL}` });
    try {
      const file = answers(
        s.dir,
        "bad-harness",
        "lane.alpha.harness=no-such-harness-xyz\nlane.alpha.model=model-x",
      );
      const r = setupProject(s.repo, s.configPath, s.bin, ["--answers", file]);
      expect(r.code).toBe(1);
      expect(`${r.out}${r.err}`).toContain("no-such-harness-xyz");
      let settingsExists = false;
      try {
        readFileSync(join(s.repo, ".postmaster", "settings.toml"));
        settingsExists = true;
      } catch {
        settingsExists = false;
      }
      expect(settingsExists).toBe(false);
    } finally {
      cleanup(s);
    }
  });

  test("project setup refuses projects_roots, which always comes from the global config", () => {
    const s = stage({ config: `${LANES}\n${TEAM_FULL}` });
    try {
      const file = answers(s.dir, "roots", "projects_roots=/elsewhere\nlane.alpha.model=model-x");
      const r = setupProject(s.repo, s.configPath, s.bin, ["--answers", file]);
      expect(r.code).toBe(1);
      expect(`${r.out}${r.err}`).toContain("projects_roots");
      let settingsExists = false;
      try {
        readFileSync(join(s.repo, ".postmaster", "settings.toml"));
        settingsExists = true;
      } catch {
        settingsExists = false;
      }
      expect(settingsExists).toBe(false);
    } finally {
      cleanup(s);
    }
  });

  test("project setup keeps an existing file unless overwrite=yes", () => {
    const s = stage({
      config: `${LANES}\n${TEAM_FULL}`,
      settings: "[team]\nmax_runs = 5\n",
    });
    try {
      const file = answers(s.dir, "one", "lane.alpha.model=model-x");
      const kept = setupProject(s.repo, s.configPath, s.bin, ["--answers", file]);
      expect(kept.code).toBe(1);
      expect(`${kept.out}${kept.err}`).toContain("settings.toml");
      expect(readFileSync(join(s.repo, ".postmaster", "settings.toml"), "utf8")).toBe(
        "[team]\nmax_runs = 5\n",
      );
      const fileYes = answers(s.dir, "yes", "lane.alpha.model=model-x\noverwrite=yes");
      const merged = setupProject(s.repo, s.configPath, s.bin, ["--answers", fileYes]);
      expect(merged.code).toBe(0);
      const written = readFileSync(join(s.repo, ".postmaster", "settings.toml"), "utf8");
      const fileData = Bun.TOML.parse(written);
      expect(tableOf(tableOf(fileData.lanes).alpha).model).toBe("model-x");
      expect(tableOf(fileData.team).max_runs).toBe(5);
    } finally {
      cleanup(s);
    }
  });
});

describe("C4: setup offers to have git ignore the project's settings", () => {
  test("unignored settings report settings_ignored=no", () => {
    const s = stage({
      config: `${LANES}\n${TEAM_NO_PM}`,
      settings: "[team]\nmax_runs = 5\n",
    });
    try {
      const r = setupNext(s.repo, s.configPath, s.bin);
      expect(r.code).toBe(0);
      expect(r.out).toContain("settings_ignored=no");
    } finally {
      cleanup(s);
    }
  });

  test("on yes the settings file is ignored", () => {
    const s = stage({ config: `${LANES}\n${TEAM_FULL}` });
    try {
      const file = answers(s.dir, "yes", "lane.alpha.model=model-x\nignore_settings=yes");
      const r = setupProject(s.repo, s.configPath, s.bin, ["--answers", file]);
      expect(r.code).toBe(0);
      expect(checkIgnore(s.repo, join(".postmaster", "settings.toml")).code).toBe(0);
      const ignore = readFileSync(join(s.repo, ".postmaster", ".gitignore"), "utf8");
      expect(ignore).toContain("settings.toml");
    } finally {
      cleanup(s);
    }
  });

  test("on no the settings file is not ignored", () => {
    const s = stage({ config: `${LANES}\n${TEAM_FULL}` });
    try {
      const file = answers(s.dir, "no", "lane.alpha.model=model-x\nignore_settings=no");
      const r = setupProject(s.repo, s.configPath, s.bin, ["--answers", file]);
      expect(r.code).toBe(0);
      expect(checkIgnore(s.repo, join(".postmaster", "settings.toml")).code).toBe(1);
    } finally {
      cleanup(s);
    }
  });

  test("already ignored settings report settings_ignored=yes", () => {
    const s = stage({
      config: `${LANES}\n${TEAM_NO_PM}`,
      settings: "[team]\nmax_runs = 5\n",
    });
    try {
      writeRepoFile(s.repo, ".postmaster/.gitignore", "runs/\nsettings.toml\n");
      const r = setupNext(s.repo, s.configPath, s.bin);
      expect(r.code).toBe(0);
      expect(r.out).toContain("settings_ignored=yes");
    } finally {
      cleanup(s);
    }
  });
});

describe("C5: nothing ignores the settings without the user's yes", () => {
  test("ensure and write leave unignored settings alone and keep runs ignored", () => {
    const s = stage({ config: `${LANES}\n${TEAM_FULL}` });
    try {
      const file = answers(s.dir, "no", "lane.alpha.model=model-x\nignore_settings=no");
      const written = setupProject(s.repo, s.configPath, s.bin, ["--answers", file]);
      expect(written.code).toBe(0);
      const ensured = projectSettings(s.repo, s.configPath, s.bin, ["ensure", s.repo]);
      expect(ensured.code).toBe(0);
      expect(checkIgnore(s.repo, join(".postmaster", "settings.toml")).code).toBe(1);
      const toml = join(s.dir, "local.toml");
      writeFileSync(toml, "[team]\nmax_runs = 3\n");
      const profile = projectSettings(s.repo, s.configPath, s.bin, [
        "write",
        s.repo,
        "local",
        toml,
      ]);
      expect(profile.code).toBe(0);
      expect(checkIgnore(s.repo, join(".postmaster", "settings.toml")).code).toBe(1);
      writeRepoFile(s.repo, ".postmaster/runs/1/brief.md", "x\n");
      expect(checkIgnore(s.repo, join(".postmaster", "runs", "1", "brief.md")).code).toBe(0);
    } finally {
      cleanup(s);
    }
  });

  test("a fresh ensure ignores records and drafts, the settings file, and itself precisely", () => {
    const s = stage({ config: `${LANES}\n${TEAM_FULL}` });
    try {
      const ensured = projectSettings(s.repo, s.configPath, s.bin, ["ensure", s.repo]);
      expect(ensured.code).toBe(0);
      const ignore = readFileSync(join(s.repo, ".postmaster", ".gitignore"), "utf8");
      const rules = ignore
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "" && !line.startsWith("#"));
      expect(rules).toContain("runs/");
      expect(rules).toContain("clerk/");
      expect(rules).not.toContain("*");
      expect(rules).not.toContain("settings.toml");
      expect(checkIgnore(s.repo, join(".postmaster", ".gitignore")).code).toBe(0);
      expect(checkIgnore(s.repo, join(".postmaster", "runs", "1", "brief.md")).code).toBe(0);
      expect(checkIgnore(s.repo, join(".postmaster", "clerk", "d", "brief.md")).code).toBe(0);
      expect(checkIgnore(s.repo, join(".postmaster", "project.toml")).code).toBe(0);
      writeRepoFile(s.repo, ".postmaster/settings.toml", "[team]\nmax_runs = 5\n");
      expect(checkIgnore(s.repo, join(".postmaster", "settings.toml")).code).toBe(1);
    } finally {
      cleanup(s);
    }
  });

  test("ensure never adds a rule that ignores the settings", () => {
    const s = stage({ config: `${LANES}\n${TEAM_FULL}` });
    try {
      writeRepoFile(s.repo, ".postmaster/settings.toml", "[team]\nmax_runs = 5\n");
      writeRepoFile(s.repo, ".postmaster/.gitignore", "*\n!settings.toml\n");
      const before = readFileSync(join(s.repo, ".postmaster", ".gitignore"), "utf8");
      const ensured = projectSettings(s.repo, s.configPath, s.bin, ["ensure", s.repo]);
      expect(ensured.code).toBe(0);
      expect(readFileSync(join(s.repo, ".postmaster", ".gitignore"), "utf8")).toBe(before);
      expect(checkIgnore(s.repo, join(".postmaster", "settings.toml")).code).toBe(1);
      expect(checkIgnore(s.repo, join(".postmaster", "runs", "1", "brief.md")).code).toBe(0);
    } finally {
      cleanup(s);
    }
  });
});

describe("runbooks: setup offers the global config, then the project's own settings", () => {
  // Folded: a reflow alone never passes an absence check and never fails a
  // presence check, as the earlier setup-order oracle does.
  const flat = (text: string): string =>
    text
      .replace(/\r/gu, "")
      .replace(/[\n\t]/gu, "  ")
      .replace(/ {2,}/gu, " ");
  const agents = flat(readFileSync(join(ROOT, "AGENTS.md"), "utf8"));
  const skill = flat(readFileSync(join(ROOT, "skills", "postmaster", "SKILL.md"), "utf8"));
  const readme = flat(readFileSync(join(ROOT, "README.md"), "utf8"));
  const example = flat(readFileSync(join(ROOT, "settings.example.toml"), "utf8"));

  test("both runbooks route the setup steps through setup-next", () => {
    expect(agents).toContain("scripts/run setup-next");
    expect(skill).toContain("<tool>/scripts/run setup-next");
  });

  test("both runbooks offer to set up the global config or skip it", () => {
    expect(agents).toContain("set up the global config or skip it");
    expect(skill).toContain("set up the global config or skip it");
  });

  test("both runbooks offer the project's own settings or the global config as it is", () => {
    expect(agents).toContain("the project's own settings or the global config as it is");
    expect(skill).toContain("the project's own settings or the global config as it is");
  });

  test("both runbooks go straight to the project's own settings with no global config", () => {
    expect(agents).toContain("goes straight to the project's own settings");
    expect(skill).toContain("goes straight to the project's own settings");
  });

  test("both runbooks write the project's settings through setup --project", () => {
    expect(agents).toContain("scripts/run setup --project");
    expect(skill).toContain("<tool>/scripts/run setup --project");
  });

  test("both runbooks hold only what the user changed in the project's settings", () => {
    expect(agents).toContain("holds only what the user changed");
    expect(skill).toContain("holds only what the user changed");
  });

  test("choosing the global config as it is writes nothing", () => {
    expect(agents).toContain("choosing the global config as it is writes nothing");
    expect(skill).toContain("choosing the global config as it is writes nothing");
  });

  test("both runbooks offer to have git ignore the project's settings", () => {
    expect(agents).toContain("offers to have git ignore the project's settings");
    expect(skill).toContain("offers to have git ignore the project's settings");
  });

  test("nothing ignores the settings without the user's yes", () => {
    expect(agents).toContain("without the user's yes");
    expect(skill).toContain("without the user's yes");
  });

  test("the local offer no longer waits on the machine config", () => {
    expect(agents).not.toContain("the write is refused without it");
    expect(agents).toContain("needs no global config");
  });

  test("the README lists setup-next and the skip", () => {
    expect(readme).toContain("scripts/run setup-next");
    expect(readme).toContain("skip");
  });

  test("the README no longer force-adds both settings files", () => {
    expect(readme).not.toContain("each may be committed on purpose with `git add -f`");
    expect(readme).toContain("git add -f");
  });

  test("the settings example ignores only on the user's yes", () => {
    expect(example).not.toContain(
      "so this file is never committed unless the project chooses to share it, with git add -f",
    );
    expect(example).toContain("only on the user's yes");
  });
});
