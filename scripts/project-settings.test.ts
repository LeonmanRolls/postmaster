// Tests beside scripts/project-settings.ts, moved from its --self-test on #109: 123 controls.
// CLI spawns go through a local spawnSync helper with a timeout option instead of the
// timeout command; env merges over process.env with undefined deleting, as lib/proc run().
// POSTMASTER_CONFIG points at the fixture machine config for the suite, restored after.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseTomlText } from "./lib/data";
import {
  globalConfigPath,
  ignoreSettings,
  isTracked,
  recordAcceptance,
} from "./lib/effective-config";
import {
  asTable,
  effectiveConfig,
  ensureIgnore,
  inspect,
  isDie,
  loadMachine,
  pyTruthy,
  type Rec,
  scanMachineData,
  validateCommon,
  writeProfile,
} from "./project-settings";

const SELF = join(import.meta.dir, "run");
const VERIFY = join(import.meta.dir, "run");

interface Run {
  code: number;
  out: string;
  err: string;
}

function runCli(
  cmd: string,
  args: string[],
  opts?: { cwd?: string; env?: Record<string, string | undefined> },
): Run {
  const merged: Record<string, string | undefined> = { ...process.env };
  if (opts?.env !== undefined) {
    for (const [k, v] of Object.entries(opts.env)) {
      if (v === undefined) delete merged[k];
      else merged[k] = v;
    }
  }
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 10000, env: merged, cwd: opts?.cwd });
  return { code: r.status ?? 1, out: String(r.stdout ?? ""), err: String(r.stderr ?? "") };
}

function git(args: string[]): number {
  return spawnSync("git", args, { encoding: "utf8", timeout: 10000 }).status ?? 1;
}

let tmp = "";
let repo = "";
let machine = "";
let savedConfig: string | undefined;

function at(name: string): string {
  return join(tmp, name);
}

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "project-settings-test-"));
  repo = join(tmp, "repo");
  mkdirSync(repo, { recursive: true });
  machine = join(tmp, "config.toml");
  write(
    machine,
    '[lanes.alpha]\nharness="codex"\nmodel="a"\n[lanes.beta]\nharness="claude"\nmodel="b"\n[team]\nworkhorses=["alpha","beta"]\nreviewers=["alpha","beta"]\ncoachman={harness="grok",model="coach"}\ncoachman_fallback={harness="pi",model="backup"}\n',
  );
  savedConfig = process.env.POSTMASTER_CONFIG;
  process.env.POSTMASTER_CONFIG = machine;
});

afterAll(() => {
  if (savedConfig === undefined) delete process.env.POSTMASTER_CONFIG;
  else process.env.POSTMASTER_CONFIG = savedConfig;
  rmSync(tmp, { recursive: true, force: true });
});

const SHARED_TOML =
  '[project]\ndefault_turnpikes=["bug"]\nrisk_surfaces="the API and subprocess boundary"\n[tracker]\nbinding="Team board"\n';

function writeShared(): void {
  const candidate = at("shared.toml");
  write(candidate, SHARED_TOML);
  writeProfile(repo, "project", candidate);
}

describe("missing profiles and ensure", () => {
  test("missing profiles are normal and retain discovery defaults", () => {
    const missing = inspect(repo);
    expect(missing.shared_present).toBe(false);
    expect(missing.local_present).toBe(false);
    expect((missing.sources as Rec)["project.default_turnpikes"]).toBe("discovery");
  });

  test("project modules cannot shadow the settings reader's standard library imports", () => {
    const shadow = at("shadow");
    write(join(shadow, "json", "__init__.py"), 'raise SystemExit("target module imported")\n');
    const isolated = runCli(SELF, ["project-settings", "inspect", shadow], { cwd: shadow });
    expect(isolated.code).toBe(0);
  });

  test("ensure creates the folder ignore without prompting for settings", () => {
    ensureIgnore(repo);
    const created = readFileSync(join(repo, ".postmaster", ".gitignore"), "utf8");
    const rules = created
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#"));
    expect(rules).toContain("runs/");
    expect(rules).toContain("clerk/");
    expect(rules).toContain("project.toml");
    expect(rules).toContain(".gitignore");
    expect(rules).not.toContain("*");
    expect(rules).not.toContain("settings.toml");
    expect(existsSync(join(repo, ".postmaster", "settings.toml"))).toBe(false);
  });

  test("ensure completes an existing ignore file without discarding its rules", () => {
    write(join(repo, ".postmaster", ".gitignore"), "# existing local rules\n!keep-me\n");
    ensureIgnore(repo);
    const kept = readFileSync(join(repo, ".postmaster", ".gitignore"), "utf8");
    expect(kept.startsWith("# existing local rules\n")).toBe(true);
    expect(kept.includes("!keep-me\n")).toBe(true);
    expect(kept.includes("\nruns/\n")).toBe(true);
    expect(kept.endsWith(".gitignore\n")).toBe(true);
  });

  test("ensure leaves a negation that re-included the settings file alone", () => {
    const negated = at("negated");
    mkdirSync(negated, { recursive: true });
    ensureIgnore(negated);
    write(join(negated, ".postmaster", ".gitignore"), "*\n!settings.toml\n");
    ensureIgnore(negated);
    const kept = readFileSync(join(negated, ".postmaster", ".gitignore"), "utf8");
    expect(kept).toBe("*\n!settings.toml\n");
    expect(git(["init", "-q", negated])).toBe(0);
    expect(git(["-C", negated, "check-ignore", "-q", ".postmaster/settings.toml"])).toBe(1);
    expect(git(["-C", negated, "check-ignore", "-q", ".postmaster/runs/T-1/card.md"])).toBe(0);
  });

  test("ensure re-ignores run artifacts a negation had re-included", () => {
    const negated = at("negated");
    write(join(negated, ".postmaster", ".gitignore"), "*\n!runs/\n!runs/**\n");
    ensureIgnore(negated);
    expect(git(["-C", negated, "check-ignore", "-q", ".postmaster/runs/T-1/card.md"])).toBe(0);
  });

  test("ensure is a no-op once the last rule is the star", () => {
    const negated = at("negated");
    const before = readFileSync(join(negated, ".postmaster", ".gitignore"), "utf8");
    ensureIgnore(negated);
    expect(readFileSync(join(negated, ".postmaster", ".gitignore"), "utf8")).toBe(before);
  });

  test("ensure completes a narrow rule that covers only one records directory", () => {
    const narrow = at("narrow");
    mkdirSync(narrow, { recursive: true });
    write(join(narrow, ".postmaster", ".gitignore"), "runs/T-1/\n");
    ensureIgnore(narrow);
    const kept = readFileSync(join(narrow, ".postmaster", ".gitignore"), "utf8");
    expect(kept.includes("runs/T-1/\n")).toBe(true);
    expect(kept.includes("\nruns/\n")).toBe(true);
    expect(git(["init", "-q", narrow])).toBe(0);
    expect(git(["-C", narrow, "check-ignore", "-q", ".postmaster/runs/T-1/card.md"])).toBe(0);
    expect(git(["-C", narrow, "check-ignore", "-q", ".postmaster/runs/T-2/card.md"])).toBe(0);
  });

  test("ignoreSettings appends where the matcher misreads a wildcard negation", () => {
    const wild = at("wild");
    mkdirSync(wild, { recursive: true });
    expect(git(["init", "-q", wild])).toBe(0);
    write(join(wild, ".postmaster", ".gitignore"), "*\n!settings.*\n");
    write(join(wild, ".postmaster", "settings.toml"), '[tracker]\nkind = "local"\n');
    expect(git(["-C", wild, "check-ignore", "-q", ".postmaster/settings.toml"])).toBe(1);
    ignoreSettings(wild);
    expect(git(["-C", wild, "check-ignore", "-q", ".postmaster/settings.toml"])).toBe(0);
  });

  test("ignoreSettings stays idempotent where git already ignores the file", () => {
    const star = at("star");
    mkdirSync(star, { recursive: true });
    expect(git(["init", "-q", star])).toBe(0);
    write(join(star, ".postmaster", ".gitignore"), "*\n");
    write(join(star, ".postmaster", "settings.toml"), '[tracker]\nkind = "local"\n');
    ignoreSettings(star);
    ignoreSettings(star);
    const kept = readFileSync(join(star, ".postmaster", ".gitignore"), "utf8");
    expect(kept).toBe("*\n");
  });

  test("ensure restores a record git exposes through a glob negation, and stays stable", () => {
    const gr = at("gitignore-truth");
    mkdirSync(gr, { recursive: true });
    expect(git(["init", "-q", gr])).toBe(0);
    write(join(gr, ".postmaster", ".gitignore"), "*\n!*.toml\n");
    expect(git(["-C", gr, "check-ignore", "-q", ".postmaster/project.toml"])).toBe(1);
    ensureIgnore(gr);
    expect(git(["-C", gr, "check-ignore", "-q", ".postmaster/project.toml"])).toBe(0);
    const once = readFileSync(join(gr, ".postmaster", ".gitignore"), "utf8");
    expect(once).toBe("*\n!*.toml\nproject.toml\n");
    ensureIgnore(gr);
    expect(readFileSync(join(gr, ".postmaster", ".gitignore"), "utf8")).toBe(once);
  });

  test("ensure leaves a plain star cover byte-identical", () => {
    const gr = at("gitignore-star");
    mkdirSync(gr, { recursive: true });
    expect(git(["init", "-q", gr])).toBe(0);
    write(join(gr, ".postmaster", ".gitignore"), "*\n");
    ensureIgnore(gr);
    expect(readFileSync(join(gr, ".postmaster", ".gitignore"), "utf8")).toBe("*\n");
  });
});

describe("shared and local profiles", () => {
  test("inspect stays bounded when POSTMASTER_PROJECT is inherited", () => {
    writeShared();
    const guarded = runCli(SELF, ["project-settings", "inspect", repo], {
      env: { POSTMASTER_PROJECT: repo },
    });
    expect(guarded.code).toBe(0);
  });

  test("the shared file writes, and .postmaster ignores it by default", () => {
    writeShared();
    const shared = inspect(repo);
    const repoInit = git(["init", "-q", repo]);
    const sharedIgnored = git(["-C", repo, "check-ignore", ".postmaster/project.toml"]);
    const postmaster = join(repo, ".postmaster");
    write(join(postmaster, "settings.toml"), "[roles]\nworkhorses=['alpha']\n");
    mkdirSync(join(postmaster, "runs", "T-1"), { recursive: true });
    write(join(postmaster, "runs", "T-1", "card.md"), "private run text\n");
    const localIgnored = git(["-C", repo, "check-ignore", ".postmaster/settings.toml"]);
    const runIgnored = git(["-C", repo, "check-ignore", ".postmaster/runs/T-1/card.md"]);
    expect(shared.shared_present).toBe(true);
    expect(JSON.stringify((shared.project as Rec).default_turnpikes)).toBe('["bug"]');
    expect((shared.sources as Rec)["project.default_turnpikes"]).toBe("shared");
    const ignore = readFileSync(join(postmaster, ".gitignore"), "utf8");
    expect(ignore.includes("\nruns/\n")).toBe(true);
    expect(ignore.includes("settings.toml")).toBe(false);
    expect(repoInit).toBe(0);
    expect(sharedIgnored).toBe(0);
    expect(localIgnored).toBe(1);
    expect(runIgnored).toBe(0);
  });

  test("a project may define an empty default turnpike set", () => {
    const emptyRepo = at("empty-default");
    mkdirSync(emptyRepo, { recursive: true });
    const emptySettings = at("empty-default.toml");
    write(emptySettings, "[project]\ndefault_turnpikes = []\n");
    writeProfile(emptyRepo, "project", emptySettings);
    expect(JSON.stringify((inspect(emptyRepo).project as Rec).default_turnpikes)).toBe("[]");
  });

  test("local choices override shared defaults and select machine-defined roles", () => {
    const local = at("local.toml");
    write(
      local,
      '[project]\ndefault_turnpikes=["style"]\n[roles]\nworkhorses=["alpha","beta"]\ncoachman="coachman_fallback"\n',
    );
    writeProfile(repo, "local", local);
    const result = inspect(repo);
    const effective = effectiveConfig(repo, loadMachine(machine));
    const team = effective.team as Rec;
    expect((result.sources as Rec)["project.default_turnpikes"]).toBe("local");
    expect((result.sources as Rec).roles).toBe("local");
    expect((team.coachman as Rec).model as string).toBe("backup");
    expect(JSON.stringify(team.workhorses)).toBe('["alpha","beta"]');
    expect(!Object.hasOwn(team, "postmaster") || pyTruthy(team.postmaster)).toBe(true);
  });
});

describe("refusals", () => {
  const rejects: Array<[string, string]> = [
    ["shared roles", '[roles]\nworkhorses=["alpha"]\n'],
    ["home path in a binding", '[tracker]\nbinding="~/.config/key"\n'],
    ["absolute path in a binding", '[tracker]\nbinding="/srv/boards/main"\n'],
    ["credential field", '[tracker]\nenv_file="credential.env"\n'],
    ["key file field", '[tracker]\nkeyfile="my.key"\n'],
    ["unknown role", '[roles]\nworkhorses=["ghost"]\n'],
    ["slash in a binding", '[tracker]\nbinding="user/board"\n'],
    ["backslash in a binding", "[tracker]\nbinding='C:\\boards\\x'\n"],
    ["URL in a binding", '[tracker]\nbinding="https://example.com/b"\n'],
    ["scheme in a binding", '[tracker]\nbinding="file:boards"\n'],
    ["colon-no-space in a binding", '[tracker]\nbinding="Team:Board"\n'],
    ["leading tilde in a binding", '[tracker]\nbinding="~other"\n'],
    ["leading dollar in a binding", '[tracker]\nbinding="$FOO"\n'],
    ["parent traversal in a binding", '[tracker]\nbinding=".."\n'],
    ["lowercase credential name", '[tracker]\nbinding="github_token"\n'],
    ["credential word with a dash", '[tracker]\nbinding="my-secret"\n'],
    ["keyword-initial credential name", '[tracker]\nbinding="TOKEN"\n'],
    ["bare credential words", '[tracker]\nbinding="API_KEY"\n'],
    ["all-caps credential token", '[tracker]\nbinding="MY_TOKEN"\n'],
    ["lowercase snake key", '[tracker]\nbinding="api_key"\n'],
    ["lowercase kebab key", '[tracker]\nbinding="api-key"\n'],
    ["bare lowercase key", '[tracker]\nbinding="apikey"\n'],
    ["mixed-case snake key", '[tracker]\nbinding="Api_Key"\n'],
    ["bare auth token", '[tracker]\nbinding="authtoken"\n'],
    ["bare access token", '[tracker]\nbinding="accesstoken"\n'],
    ["key file as value", '[tracker]\nbinding="keyfile"\n'],
    ["snake key file as value", '[tracker]\nbinding="key_file"\n'],
    ["kebab key file as value", '[tracker]\nbinding="key-file"\n'],
    ["caps key file as value", '[tracker]\nbinding="KEYFILE"\n'],
    ["env file as value", '[tracker]\nbinding="env_file"\n'],
    ["bare env file as value", '[tracker]\nbinding="envfile"\n'],
    ["kebab env file as value", '[tracker]\nbinding="env-file"\n'],
    ["bare private key", '[tracker]\nbinding="privatekey"\n'],
    ["snake private key", '[tracker]\nbinding="private_key"\n'],
    ["kebab private key", '[tracker]\nbinding="private-key"\n'],
    ["kebab access key", '[tracker]\nbinding="access-key"\n'],
    ["snake access key", '[tracker]\nbinding="access_key"\n'],
    ["bare password", '[tracker]\nbinding="password"\n'],
    ["bare secret", '[tracker]\nbinding="secret"\n'],
    ["bare token", '[tracker]\nbinding="token"\n'],
    ["bare credentials", '[tracker]\nbinding="credentials"\n'],
    ["bare caps secret", '[tracker]\nbinding="SECRET"\n'],
    ["single titlecase secret", '[tracker]\nbinding="Secret"\n'],
    ["camelCase api key", '[tracker]\nbinding="githubApiKey"\n'],
    ["camelCase token", '[tracker]\nbinding="accessToken"\n'],
    ["camelCase continuation", '[tracker]\nbinding="secretKey"\n'],
    ["camelCase sandwich", '[tracker]\nbinding="mySecretKey"\n'],
    ["credential value word", '[tracker]\nbinding="secretValue"\n'],
    ["token value word", '[tracker]\nbinding="tokenValue"\n'],
    ["password hash word", '[tracker]\nbinding="passwordHash"\n'],
    ["credential name word", '[tracker]\nbinding="credentialName"\n'],
    ["token value sandwich", '[tracker]\nbinding="authTokenValue"\n'],
    ["identifier word in phrasing", '[tracker]\nbinding="Migrate api_key usage"\n'],
    ["caps word in phrasing", '[tracker]\nbinding="The TOKEN is here"\n'],
    ["padded credential name", '[tracker]\nbinding="  api_key  "\n'],
    ["credential word in a role name", '[roles]\nworkhorses=["API_KEY"]\n'],
    [
      "classic token value",
      "[tr" +
        "ack" +
        "er]" +
        "\nbi" +
        "ndi" +
        "ng=" +
        '"gh' +
        "p_1" +
        "234" +
        "567" +
        "890" +
        "123" +
        "456" +
        "789" +
        '0"\n',
    ],
    ["short classic token value", '[tracker]\nbinding="ghp_12345678"\n'],
    ["fine-grained token value", '[tracker]\nbinding="github_pat_ABCDEFGHIJKL"\n'],
    ["gitlab token value", '[tracker]\nbinding="glpat-ABCDEFGHIJKL"\n'],
    ["chat token value", '[tracker]\nbinding="xoxc-123456789012"\n'],
    ["key-like token value", '[tracker]\nbinding="sk-1234567890123456"\n'],
    ["credential assignment", '[tracker]\nbinding="X_API_KEY=abc123"\n'],
    ["lowercase credential assignment", '[tracker]\nbinding="password = hunter2"\n'],
    [
      "private key block",
      "[tr" +
        "ack" +
        "er]" +
        "\nbi" +
        "ndi" +
        "ng=" +
        '"--' +
        "---" +
        "BEG" +
        "IN " +
        "PRI" +
        "VAT" +
        "E K" +
        "EY-" +
        "---" +
        '-"\n',
    ],
  ];
  for (const [label, contents] of rejects) {
    test(`rejects ${label}`, () => {
      const bad = at("bad.toml");
      write(bad, contents);
      let refused = false;
      try {
        if (label === "shared roles") {
          validateCommon(
            asTable(parseTomlText(contents), "shared"),
            "shared project settings",
            false,
          );
        } else if (label !== "unknown role") {
          const parsed = asTable(parseTomlText(contents), "settings input");
          scanMachineData(parsed, "settings input", []);
          validateCommon(
            asTable(parseTomlText(contents), "settings input"),
            "settings input",
            true,
          );
        } else {
          writeProfile(repo, "local", bad);
          effectiveConfig(repo, loadMachine(machine));
        }
      } catch (e) {
        if (isDie(e)) refused = true;
        else throw e;
      }
      expect(refused).toBe(true);
    });
  }
});

describe("acceptances", () => {
  const accepts: Array<[string, string, boolean]> = [
    [
      "risk prose naming a path",
      "[pr" +
        "oje" +
        "ct]" +
        "\nri" +
        "sk_" +
        "sur" +
        "fac" +
        "es=" +
        '"re' +
        "ads" +
        " /h" +
        "ome" +
        "/al" +
        "ex/" +
        "sec" +
        "ret" +
        '"\n',
      true,
    ],
    [
      "risk prose naming a secret",
      '[project]\nrisk_surfaces="reads PLANE_API_KEY and lane env files"\n',
      true,
    ],
    [
      "risk prose naming a machine",
      '[project]\nrisk_surfaces="runs on build-01 beside //server/share"\n',
      true,
    ],
    [
      "a check command with paths",
      '[checks.x]\ncommand="cat /tmp/out $HOME/f"\nshows="y"\n',
      false,
    ],
    ["a check named secret-scan", '[checks.secret-scan]\ncommand="true"\nshows="s"\n', false],
    ["a plain board name", '[tracker]\nbinding="Team board"\n', true],
    ["an ampersand board name", '[tracker]\nbinding="Platform & DevEx"\n', true],
    ["a comma board name", '[tracker]\nbinding="Team, Platform"\n', true],
    [
      "the documented example binding",
      '[tracker]\nbinding="the board, workspace or team name"\n',
      true,
    ],
    [
      "the documented local binding",
      '[tracker]\nbinding="the board, workspace or team name for this checkout"\n',
      true,
    ],
    ["a dotted board name", '[tracker]\nbinding="Board_1.v2"\n', true],
    ["a colon-space board name", '[tracker]\nbinding="Team: Board"\n', true],
    ["a natural secret word", '[tracker]\nbinding="Secret Santa"\n', true],
    ["a natural token word", '[tracker]\nbinding="Password reset project"\n', true],
    ["a glued lowercase word", '[tracker]\nbinding="secretary"\n', true],
    ["a glued lowercase credential", '[tracker]\nbinding="mysecret"\n', true],
    ["a keyword-prefixed natural word", '[tracker]\nbinding="Tokenomics review"\n', true],
    ["a token prefix too short to be a token", '[tracker]\nbinding="ghp_abc"\n', true],
    ["an assignment without a credential word", '[tracker]\nbinding="a=b"\n', true],
  ];
  for (const [label, contents, localSettings] of accepts) {
    test(`accepts ${label}`, () => {
      expect(() => {
        const parsed = asTable(parseTomlText(contents), "settings input");
        scanMachineData(parsed, "settings input", []);
        validateCommon(
          asTable(parseTomlText(contents), "settings input"),
          "settings input",
          localSettings,
        );
      }).not.toThrow();
    });
  }
});

describe("check shapes agree with verify.sh", () => {
  const badShapes: Array<[string, string]> = [
    ["unknown key", '[checks.x]\ncommand = "true"\nshows = "s"\nunknown = 1\n'],
    ["command and use", '[checks.x]\ncommand = "true"\nuse = "cli-examples"\nshows = "s"\n'],
    ["neither command nor use", '[checks.x]\nshows = "s"\n'],
    ["command without shows", '[checks.x]\ncommand = "true"\n'],
    ["score without threshold", '[checks.x]\ncommand = "true"\nshows = "s"\nscore = "(x)"\n'],
    ["threshold without score", '[checks.x]\ncommand = "true"\nshows = "s"\nthreshold = 1\n'],
    [
      "score with two groups",
      '[checks.x]\ncommand = "true"\nshows = "s"\nscore = "(a)(b)"\nthreshold = 1\n',
    ],
    [
      "score that is not a regex",
      '[checks.x]\ncommand = "true"\nshows = "s"\nscore = "(a"\nthreshold = 1\n',
    ],
    [
      "string threshold",
      '[checks.x]\ncommand = "true"\nshows = "s"\nscore = "(x)"\nthreshold = "high"\n',
    ],
    ["zero timeout", '[checks.x]\ncommand = "true"\nshows = "s"\ntimeout = 0\n'],
    ["boolean timeout", '[checks.x]\ncommand = "true"\nshows = "s"\ntimeout = true\n'],
    ["unknown default", '[checks.x]\nuse = "nope"\n'],
    ["gate with use", '[checks.gate]\nuse = "cli-examples"\n'],
    ["score with use", '[checks.x]\nuse = "cli-examples"\nscore = "(x)"\nthreshold = 1\n'],
    ["blank shows", '[checks.x]\ncommand = "true"\nshows = ""\n'],
    ["blank command", '[checks.x]\ncommand = "  "\nshows = "s"\n'],
    ["non-lowercase name", '[checks.Bad]\ncommand = "true"\nshows = "s"\n'],
  ];
  badShapes.forEach(([label, contents], i) => {
    test(`write and verify.sh agree in refusing ${label}`, () => {
      const shapeRepo = at(`bad-shape-${i}`);
      mkdirSync(shapeRepo, { recursive: true });
      const shapeIn = at(`bad-shape-${i}.toml`);
      write(shapeIn, contents);
      let writeRefused = false;
      try {
        writeProfile(shapeRepo, "project", shapeIn);
      } catch (e) {
        if (isDie(e)) writeRefused = true;
        else throw e;
      }
      const planted = join(shapeRepo, ".postmaster", "project.toml");
      write(planted, contents);
      const checked = runCli(VERIFY, ["verify", "checks", shapeRepo]);
      expect(writeRefused).toBe(true);
      expect(checked.code).not.toBe(0);
    });
  });

  const goodShapes: Array<[string, string]> = [
    ["command with shows and timeout", '[checks.x]\ncommand = "true"\nshows = "s"\ntimeout = 60\n'],
    [
      "scored command",
      '[checks.x]\ncommand = "true"\nshows = "s"\nscore = "(x)"\nthreshold = 0.5\n',
    ],
    ["bare default", '[checks.x]\nuse = "cli-examples"\n'],
    [
      "default with shows and timeout",
      '[checks.x]\nuse = "library-tests"\nshows = "s"\ntimeout = 60\n',
    ],
    ["gate command", '[checks.gate]\ncommand = "true"\nshows = "s"\n'],
  ];
  goodShapes.forEach(([label, contents], i) => {
    test(`write and verify.sh agree in accepting ${label}`, () => {
      const shapeRepo = at(`good-shape-${i}`);
      mkdirSync(shapeRepo, { recursive: true });
      const shapeIn = at(`good-shape-${i}.toml`);
      write(shapeIn, contents);
      let writeError: string | null = null;
      try {
        writeProfile(shapeRepo, "project", shapeIn);
      } catch (e) {
        if (isDie(e)) writeError = e.message;
        else throw e;
      }
      const checked = runCli(VERIFY, ["verify", "checks", shapeRepo]);
      expect(writeError).toBe(null);
      expect(checked.code).toBe(0);
    });
  });
});

describe("repo profile", () => {
  test("this repo's own committed profile validates", () => {
    expect(() => {
      inspect(join(import.meta.dir, ".."));
    }).not.toThrow();
  });
});

describe("run-root and exclude-worktrees", () => {
  const gitIn = (dir: string, ...args: string[]): number =>
    spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", timeout: 10000 }).status ?? 1;

  test("run-root creates the runs folder and its ignore rule, and prints the run root", () => {
    const target = at("run-root-target");
    mkdirSync(target, { recursive: true });
    expect(gitIn(target, "init", "-q")).toBe(0);
    const r = runCli(SELF, ["project-settings", "run-root", target]);
    expect(r.code).toBe(0);
    expect(r.out.trim().endsWith(join(".postmaster", "runs"))).toBe(true);
    expect(existsSync(join(r.out.trim(), "postmaster"))).toBe(true);
    expect(existsSync(join(target, ".postmaster", ".gitignore"))).toBe(true);
    expect(gitIn(target, "check-ignore", "-q", ".postmaster/runs/T-1/card.md")).toBe(0);
  }, 30000);

  test("run-root refuses a directory that is not a repository", () => {
    const plain = at("run-root-plain");
    mkdirSync(plain, { recursive: true });
    const r = runCli(SELF, ["project-settings", "run-root", plain]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("not a git repository");
  }, 30000);

  test("exclude-worktrees keeps exactly one line in the repo's exclude, run twice", () => {
    const target = at("exclude-target");
    mkdirSync(target, { recursive: true });
    expect(gitIn(target, "init", "-q")).toBe(0);
    const first = runCli(SELF, ["project-settings", "exclude-worktrees", target]);
    expect(first.code).toBe(0);
    expect(first.out).toContain("excluded .worktrees/");
    const second = runCli(SELF, ["project-settings", "exclude-worktrees", target]);
    expect(second.code).toBe(0);
    const text = readFileSync(join(target, ".git", "info", "exclude"), "utf8");
    expect(text.split("\n").filter((line) => line === ".worktrees/").length).toBe(1);
    expect(gitIn(target, "status", "--porcelain")).toBe(0);
  }, 30000);

  test("exclude-worktrees refuses a directory that is not a repository", () => {
    const plain = at("exclude-plain");
    mkdirSync(plain, { recursive: true });
    const r = runCli(SELF, ["project-settings", "exclude-worktrees", plain]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("not a git repository");
  }, 30000);

  test("run-root refuses a symlinked .postmaster before creating anything outside", () => {
    const target = at("run-root-symlink");
    mkdirSync(target, { recursive: true });
    expect(gitIn(target, "init", "-q")).toBe(0);
    const outside = at("run-root-symlink-outside");
    mkdirSync(outside, { recursive: true });
    symlinkSync(outside, join(target, ".postmaster"));
    const r = runCli(SELF, ["project-settings", "run-root", target]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("not a symlink");
    expect(readdirSync(outside).length).toBe(0);
  }, 30000);

  test("run-root refuses a symlinked runs folder instead of printing a root through it", () => {
    const target = at("run-root-runs-symlink");
    mkdirSync(join(target, ".postmaster"), { recursive: true });
    expect(gitIn(target, "init", "-q")).toBe(0);
    const outside = at("run-root-runs-symlink-outside");
    mkdirSync(outside, { recursive: true });
    symlinkSync(outside, join(target, ".postmaster", "runs"));
    const r = runCli(SELF, ["project-settings", "run-root", target]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("not a symlink");
    expect(readdirSync(outside).length).toBe(0);
  }, 30000);

  test("exclude-worktrees lands where git reads it in a linked worktree", () => {
    const main = at("exclude-linked-main");
    mkdirSync(main, { recursive: true });
    expect(gitIn(main, "init", "-q")).toBe(0);
    expect(gitIn(main, "config", "user.name", "brindlewick")).toBe(0);
    expect(
      gitIn(main, "config", "user.email", "332054101+brindlewick@users.noreply.github.com"),
    ).toBe(0);
    expect(gitIn(main, "commit", "-q", "--allow-empty", "-m", "init")).toBe(0);
    const linked = at("exclude-linked-wt");
    expect(gitIn(main, "worktree", "add", "--detach", linked, "HEAD")).toBe(0);
    const r = runCli(SELF, ["project-settings", "exclude-worktrees", linked]);
    expect(r.code).toBe(0);
    mkdirSync(join(linked, ".worktrees", "x"), { recursive: true });
    expect(gitIn(linked, "check-ignore", "-q", ".worktrees/x")).toBe(0);
  }, 30000);

  test("exclude-worktrees ignores a GIT_DIR that points at another repository", () => {
    const target = at("exclude-gitdir-target");
    const decoy = at("exclude-gitdir-decoy");
    mkdirSync(target, { recursive: true });
    mkdirSync(decoy, { recursive: true });
    expect(gitIn(target, "init", "-q")).toBe(0);
    expect(gitIn(decoy, "init", "-q")).toBe(0);
    const r = runCli(SELF, ["project-settings", "exclude-worktrees", target], {
      env: { GIT_DIR: join(decoy, ".git") },
    });
    expect(r.code).toBe(0);
    expect(readFileSync(join(target, ".git", "info", "exclude"), "utf8")).toContain(".worktrees/");
    expect(readFileSync(join(decoy, ".git", "info", "exclude"), "utf8")).not.toContain(
      ".worktrees/",
    );
  }, 30000);

  test("run-root ignores a GIT_WORK_TREE that points at another repository", () => {
    const target = at("run-root-worktree-target");
    const decoy = at("run-root-worktree-decoy");
    mkdirSync(target, { recursive: true });
    mkdirSync(decoy, { recursive: true });
    expect(gitIn(target, "init", "-q")).toBe(0);
    expect(gitIn(decoy, "init", "-q")).toBe(0);
    const r = runCli(SELF, ["project-settings", "run-root", target], {
      env: { GIT_WORK_TREE: decoy },
    });
    expect(r.code).toBe(0);
    // The printed root is resolved; under a linked temporary folder (macOS /var)
    // the built path is not, so resolve the expected side first.
    expect(r.out.trim()).toBe(join(realpathSync(target), ".postmaster", "runs"));
    expect(existsSync(join(decoy, ".postmaster"))).toBe(false);
  }, 30000);
});

describe("project overrides", () => {
  test("tracker.binding stays a fact while kind merges into the config", () => {
    const r = at("override-binding");
    write(
      join(r, ".postmaster", "settings.toml"),
      '[tracker]\nbinding = "board"\nkind = "plane"\n',
    );
    const merged = effectiveConfig(r, loadMachine(machine));
    expect((merged.tracker as Rec).kind).toBe("plane");
    expect(Object.hasOwn(merged.tracker as Rec, "binding")).toBe(false);
    expect((inspect(r).tracker as Rec).binding).toBe("board");
  }, 30000);

  test("override tables must keep their shape", () => {
    const r = at("override-shape");
    write(join(r, ".postmaster", "settings.toml"), 'team = "x"\n');
    let message = "";
    try {
      effectiveConfig(r, loadMachine(machine));
    } catch (e) {
      if (isDie(e)) message = e.message;
      else throw e;
    }
    expect(message).toBe("local project settings.team must be a table");
  }, 30000);

  test("an unknown top-level key is still refused", () => {
    const r = at("override-unknown");
    write(join(r, ".postmaster", "settings.toml"), "[frobnicate]\nx = 1\n");
    let message = "";
    try {
      effectiveConfig(r, loadMachine(machine));
    } catch (e) {
      if (isDie(e)) message = e.message;
      else throw e;
    }
    expect(message).toBe("local project settings has unsupported table or key: frobnicate");
  }, 30000);

  test("acceptance gates a tracked file until the user accepts it", () => {
    const r = at("override-accept");
    write(join(r, ".postmaster", "settings.toml"), '[lanes.alpha]\nmodel = "x"\n');
    const id = ["-c", "user.name=t", "-c", "user.email=t@example.invalid"];
    expect(git(["init", "-q", "-b", "main", r])).toBe(0);
    expect(git(["-C", r, "add", "-f", ".postmaster/settings.toml"])).toBe(0);
    expect(git(["-C", r, ...id, "commit", "-qm", "settings"])).toBe(0);
    expect(inspect(r).local_acceptance).toBe("pending");
    const before = effectiveConfig(r, loadMachine(machine));
    expect(((before.lanes as Rec).alpha as Rec).model).toBe("a");
    expect(recordAcceptance(r, machine)).toContain("accepted");
    expect(inspect(r).local_acceptance).toBe("accepted");
    const after = effectiveConfig(r, loadMachine(machine));
    expect(((after.lanes as Rec).alpha as Rec).model).toBe("x");
  }, 30000);
});

describe("tracked files", () => {
  const id = ["-c", "user.name=t", "-c", "user.email=t@example.invalid"];

  test("a case-variant directory counts as tracked", () => {
    const dir = join(tmp, "case-dir");
    mkdirSync(dir, { recursive: true });
    expect(git(["init", "-q", dir])).toBe(0);
    mkdirSync(join(dir, ".POSTMASTER"), { recursive: true });
    writeFileSync(join(dir, ".POSTMASTER", "settings.toml"), '[lanes.a]\nmodel = "m"\n');
    expect(git(["-C", dir, "add", ".POSTMASTER/settings.toml"])).toBe(0);
    expect(git(["-C", dir, ...id, "commit", "-qm", "upper"])).toBe(0);
    // On a case-insensitive filesystem this file opens as
    // .postmaster/settings.toml; it must still count as tracked. Linux cannot
    // open it under the lower-case name, so this pins the outcome on the
    // macOS-observable bypass, with the control below proving the check runs.
    expect(isTracked(dir, join(dir, ".postmaster", "settings.toml"))).toBe(true);
  });

  test("a genuinely untracked file counts as untracked", () => {
    const dir = join(tmp, "plain-track");
    mkdirSync(join(dir, ".postmaster"), { recursive: true });
    expect(git(["init", "-q", dir])).toBe(0);
    writeFileSync(join(dir, ".postmaster", "settings.toml"), '[lanes.a]\nmodel = "m"\n');
    expect(isTracked(dir, join(dir, ".postmaster", "settings.toml"))).toBe(false);
  });
});

describe("global config path", () => {
  test("the default builds from $HOME exactly, and unset HOME reads as the root", () => {
    const saveConfig = process.env.POSTMASTER_CONFIG;
    const saveHome = process.env.HOME;
    try {
      delete process.env.POSTMASTER_CONFIG;
      process.env.HOME = join(tmp, "fake-home");
      expect(globalConfigPath()).toBe(join(tmp, "fake-home", ".postmaster", "config.toml"));
      delete process.env.HOME;
      expect(globalConfigPath()).toBe("/.postmaster/config.toml");
    } finally {
      if (saveConfig === undefined) delete process.env.POSTMASTER_CONFIG;
      else process.env.POSTMASTER_CONFIG = saveConfig;
      if (saveHome === undefined) delete process.env.HOME;
      else process.env.HOME = saveHome;
    }
  });
});
