// Tests beside scripts/project-settings.ts, moved from its --self-test on #109: 118 controls.
// CLI spawns go through a local spawnSync helper with a timeout option instead of the
// timeout command; env merges over process.env with undefined deleting, as lib/proc run().
// POSTMASTER_CONFIG points at the fixture machine config for the suite, restored after.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseTomlText } from "./lib/data";
import {
  asTable,
  effectiveConfig,
  ensureIgnore,
  inspect,
  isDie,
  loadMachine,
  pyTruthy,
  scanMachineData,
  validateCommon,
  writeProfile,
  type Rec,
} from "./project-settings";

const SELF = join(import.meta.dir, "project-settings.sh");
const VERIFY = join(import.meta.dir, "verify.sh");

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
  }, 30000);

  test("project modules cannot shadow the settings reader's standard library imports", () => {
    const shadow = at("shadow");
    write(join(shadow, "json", "__init__.py"), 'raise SystemExit("target module imported")\n');
    const isolated = runCli(SELF, ["inspect", shadow], { cwd: shadow });
    expect(isolated.code).toBe(0);
  }, 30000);

  test("ensure creates the folder ignore without prompting for settings", () => {
    ensureIgnore(repo);
    expect(readFileSync(join(repo, ".postmaster", ".gitignore"), "utf8").endsWith("*\n")).toBe(
      true,
    );
    expect(existsSync(join(repo, ".postmaster", "settings.toml"))).toBe(false);
  }, 30000);

  test("ensure completes an existing ignore file without discarding its rules", () => {
    write(join(repo, ".postmaster", ".gitignore"), "# existing local rules\n!keep-me\n");
    ensureIgnore(repo);
    const kept = readFileSync(join(repo, ".postmaster", ".gitignore"), "utf8");
    expect(kept.startsWith("# existing local rules\n")).toBe(true);
    expect(kept.endsWith("*\n")).toBe(true);
  }, 30000);

  test("ensure re-ignores a folder a negation had re-included, keeping its rules", () => {
    const negated = at("negated");
    mkdirSync(negated, { recursive: true });
    ensureIgnore(negated);
    write(join(negated, ".postmaster", ".gitignore"), "*\n!settings.toml\n");
    ensureIgnore(negated);
    const repaired = readFileSync(join(negated, ".postmaster", ".gitignore"), "utf8");
    expect(repaired.endsWith("*\n")).toBe(true);
    expect(repaired.includes("!settings.toml\n")).toBe(true);
    expect(git(["init", "-q", negated])).toBe(0);
    expect(git(["-C", negated, "check-ignore", "-q", ".postmaster/settings.toml"])).toBe(0);
    expect(git(["-C", negated, "check-ignore", "-q", ".postmaster/runs/T-1/card.md"])).toBe(0);
  }, 30000);

  test("ensure re-ignores run artifacts a negation had re-included", () => {
    const negated = at("negated");
    write(join(negated, ".postmaster", ".gitignore"), "*\n!runs/\n!runs/**\n");
    ensureIgnore(negated);
    expect(git(["-C", negated, "check-ignore", "-q", ".postmaster/runs/T-1/card.md"])).toBe(0);
  }, 30000);

  test("ensure is a no-op once the last rule is the star", () => {
    const negated = at("negated");
    const before = readFileSync(join(negated, ".postmaster", ".gitignore"), "utf8");
    ensureIgnore(negated);
    expect(readFileSync(join(negated, ".postmaster", ".gitignore"), "utf8")).toBe(before);
  }, 30000);
});

describe("shared and local profiles", () => {
  test("inspect stays bounded when POSTMASTER_PROJECT is inherited", () => {
    writeShared();
    const guarded = runCli(SELF, ["inspect", repo], { env: { POSTMASTER_PROJECT: repo } });
    expect(guarded.code).toBe(0);
  }, 30000);

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
    expect(readFileSync(join(postmaster, ".gitignore"), "utf8").endsWith("*\n")).toBe(true);
    expect(repoInit).toBe(0);
    expect(sharedIgnored).toBe(0);
    expect(localIgnored).toBe(0);
    expect(runIgnored).toBe(0);
  }, 30000);

  test("a project may define an empty default turnpike set", () => {
    const emptyRepo = at("empty-default");
    mkdirSync(emptyRepo, { recursive: true });
    const emptySettings = at("empty-default.toml");
    write(emptySettings, "[project]\ndefault_turnpikes = []\n");
    writeProfile(emptyRepo, "project", emptySettings);
    expect(JSON.stringify((inspect(emptyRepo).project as Rec).default_turnpikes)).toBe("[]");
  }, 30000);

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
  }, 30000);
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
    }, 30000);
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
    }, 30000);
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
      const checked = runCli(VERIFY, ["checks", shapeRepo]);
      expect(writeRefused).toBe(true);
      expect(checked.code).not.toBe(0);
    }, 30000);
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
      const checked = runCli(VERIFY, ["checks", shapeRepo]);
      expect(writeError).toBe(null);
      expect(checked.code).toBe(0);
    }, 30000);
  });
});

describe("repo profile", () => {
  test("this repo's own committed profile validates", () => {
    expect(() => {
      inspect(join(import.meta.dir, ".."));
    }).not.toThrow();
  }, 30000);
});
