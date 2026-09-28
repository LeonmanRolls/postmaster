import { accessSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { command, scriptDir, writeError, writeOut } from "./lib/core.ts";

const usage = "usage: front-door.sh <harness> <model> <cwd> <at-terminal> <target> [--config <path>] | --self-test";
const unsetGit = {
  GIT_DIR: undefined,
  GIT_WORK_TREE: undefined,
  GIT_COMMON_DIR: undefined,
  GIT_INDEX_FILE: undefined,
  GIT_OBJECT_DIRECTORY: undefined,
  GIT_ALTERNATE_OBJECT_DIRECTORIES: undefined,
  GIT_NAMESPACE: undefined,
};
function repoOf(path: string): string {
  if (!path) return "";
  const result = command("git", ["-C", path, "rev-parse", "--path-format=absolute", "--git-common-dir"], {
    env: unsetGit,
  });
  return result.code === 0 ? result.stdout.trim() : "";
}
function decide(
  harness: string,
  model: string,
  cwd: string,
  terminal: string,
  target: string,
  config: string,
): { code: number; stdout: string; stderr: string } {
  if (terminal !== "yes" && terminal !== "no")
    return { code: 1, stdout: "", stderr: `front-door: at-terminal is yes or no, not '${terminal}'` };
  try {
    accessSync(config);
  } catch {
    return { code: 1, stdout: "", stderr: `front-door: no config at ${config} (POSTMASTER_CONFIG overrides the path)` };
  }
  let parsed: any;
  try {
    parsed = Bun.TOML.parse(readFileSync(config, "utf8"));
  } catch (error) {
    return {
      code: 1,
      stdout: "",
      stderr: `front-door: ${config} does not parse: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const spec = parsed?.team?.postmaster;
  if (!spec || typeof spec !== "object" || Array.isArray(spec) || !spec.harness || !spec.model)
    return { code: 1, stdout: "", stderr: `front-door: ${config} has no team.postmaster with a harness and a model` };
  if (typeof spec.harness !== "string" || typeof spec.model !== "string")
    return { code: 1, stdout: "", stderr: `front-door: ${config} team.postmaster harness and model must be strings` };
  if (!spec.harness.trim() || !spec.model.trim())
    return { code: 1, stdout: "", stderr: `front-door: ${config} team.postmaster harness and model must not be blank` };
  if (
    [spec.harness, spec.model].some((value: string) =>
      [...value].some((char) => {
        const code = char.codePointAt(0)!;
        return code < 32 || code === 127;
      }),
    )
  ) {
    return {
      code: 1,
      stdout: "",
      stderr: `front-door: ${config} team.postmaster harness and model must not contain control characters`,
    };
  }
  const reasons: string[] = [];
  if (harness !== spec.harness)
    reasons.push(`harness differs: this session runs on ${harness}, team.postmaster names ${spec.harness}`);
  if (model !== spec.model)
    reasons.push(`model differs: this session runs on ${model}, team.postmaster names ${spec.model}`);
  const cwdRepo = repoOf(cwd);
  const targetRepo = repoOf(target);
  if (!cwdRepo || !targetRepo)
    reasons.push(`not in a git repository: the session runs in ${cwd}, the target is ${target}`);
  else if (cwdRepo !== targetRepo)
    reasons.push(`target is another repo: the session runs in ${cwd}, the target is ${target}`);
  if (terminal !== "yes") reasons.push("nobody at the terminal");
  return reasons.length
    ? { code: 0, stdout: `spawn ${reasons.join("; ")}\n`, stderr: "" }
    : {
        code: 0,
        stdout: "self team.postmaster harness and model, the target is this repo, and the user is at the terminal\n",
        stderr: "",
      };
}
function selfTest(): number {
  const temp = mkdtempSync(join(tmpdir(), "front-door-"));
  const here = join(temp, "here");
  const there = join(temp, "there");
  mkdirSync(here);
  mkdirSync(there);
  let fails = 0;
  const self = join(scriptDir(import.meta.url), "front-door.sh");
  const ok = (label: string) => writeOut(`  ok   ${label}`);
  const fail = (label: string, details = "") => {
    writeOut(`  FAIL ${label}${details ? `\n         ${details.replace(/\n/g, "\n         ")}` : ""}`);
    fails++;
  };
  const config = (name: string, h: string, m: string) =>
    writeFileSync(
      join(temp, `${name}.toml`),
      `[team]\npostmaster = { harness = ${JSON.stringify(h)}, model = ${JSON.stringify(m)} }\n`,
    );
  const run = (
    label: string,
    expectedCode: number,
    word: string,
    why: string,
    args: string[],
    env: Record<string, string | undefined> = {},
    cwd?: string,
  ) => {
    const result = command(self, args, { env, cwd });
    const out = result.stdout.trim();
    if (result.code !== expectedCode)
      return fail(`${label}: wanted exit ${expectedCode}, got exit ${result.code}`, out + result.stderr);
    if ((out.split(" ")[0] ?? "") !== word)
      return fail(`${label}: wanted '${word}', got '${out.split(" ")[0] ?? ""}'`, out + result.stderr);
    if (why !== "-" && !out.includes(why)) return fail(`${label}: wanted the reason to contain '${why}'`, out);
    ok(label);
  };
  const absent = (label: string, not: string, yes: string, args: string[]) => {
    const result = command(self, args);
    const out = result.stdout;
    if (result.code === 0 && !out.includes(not) && out.includes(yes)) ok(label);
    else fail(label, out + result.stderr);
  };
  try {
    command("git", ["-C", here, "init", "-q"]);
    command("git", [
      "-C",
      here,
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
    command("git", ["-C", there, "init", "-q"]);
    command("git", [
      "-C",
      there,
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
    command("git", ["-C", here, "worktree", "add", "-q", join(temp, "here-wt"), "-b", "wt"]);
    mkdirSync(join(here, "sub"));
    config("match", "claude", "pm-model");
    writeOut("positive controls");
    const base = ["--config", join(temp, "match.toml")];
    const invoke = (
      label: string,
      h: string,
      m: string,
      cwd: string,
      term: string,
      target: string,
      why: string,
      extra: string[] = [],
      env: Record<string, string | undefined> = {},
    ) => run(label, 0, why === "-" ? "self" : "spawn", why, [h, m, cwd, term, target, ...base, ...extra], env);
    invoke("harness differs prints spawn naming harness", "grok", "pm-model", here, "yes", here, "harness differs");
    invoke("model differs prints spawn naming model", "claude", "other-model", here, "yes", here, "model differs");
    invoke(
      "target is another repo prints spawn naming target",
      "claude",
      "pm-model",
      here,
      "yes",
      there,
      "target is another repo",
    );
    invoke(
      "nobody at the terminal prints spawn naming terminal",
      "claude",
      "pm-model",
      here,
      "no",
      here,
      "nobody at the terminal",
    );
    invoke("all four match prints self", "claude", "pm-model", here, "yes", here, "-");
    invoke(
      "a worktree of the target is the target's repo, so it is self",
      "claude",
      "pm-model",
      join(temp, "here-wt"),
      "yes",
      here,
      "-",
    );
    invoke(
      "a subdirectory of the target is the target's repo, so it is self",
      "claude",
      "pm-model",
      join(here, "sub"),
      "yes",
      here,
      "-",
    );
    invoke("every failed condition is reported", "grok", "other-model", there, "no", here, "harness differs");
    const notRepo = join(temp, "notrepo");
    mkdirSync(notRepo);
    invoke(
      "a directory outside any repo fails closed naming both paths",
      "claude",
      "pm-model",
      notRepo,
      "yes",
      here,
      "not in a git repository",
    );
    invoke(
      "a target outside any repo fails closed naming both paths",
      "claude",
      "pm-model",
      here,
      "yes",
      notRepo,
      "not in a git repository",
    );
    config("spaces", "claude code", "pm-model");
    run("a harness name with a space still matches itself", 0, "self", "-", [
      "claude code",
      "pm-model",
      here,
      "yes",
      here,
      "--config",
      join(temp, "spaces.toml"),
    ]);
    invoke("an empty harness decides spawn, not usage", "", "pm-model", here, "yes", here, "harness differs");
    invoke(
      "a reported model with a newline decides spawn",
      "claude",
      "pm-model\nother",
      here,
      "yes",
      here,
      "model differs",
    );
    writeOut("empty paths fail closed from inside a repo");
    for (const [label, cwd, target] of [
      ["an empty cwd fails closed from inside a repo", "", here],
      ["an empty target fails closed from inside a repo", here, ""],
      ["an empty cwd and target fail closed from inside a repo", "", ""],
    ]) {
      const result = command(self, ["claude", "pm-model", cwd, "yes", target, ...base], { cwd: here });
      result.code === 0 && result.stdout.startsWith("spawn not in a git repository")
        ? ok(label)
        : fail(label, result.stdout + result.stderr);
    }
    writeOut("caller environment does not steer identity");
    invoke(
      "a GIT_DIR from the caller does not steer distinct repos to self",
      "claude",
      "pm-model",
      here,
      "yes",
      there,
      "target is another repo",
      [],
      { GIT_DIR: join(there, ".git"), GIT_COMMON_DIR: join(there, ".git") },
    );
    writeOut("negative controls");
    absent("the harness matching does not print the harness reason", "harness differs", "model differs", [
      "claude",
      "other-model",
      here,
      "yes",
      here,
      ...base,
    ]);
    absent("the model matching does not print the model reason", "model differs", "harness differs", [
      "grok",
      "pm-model",
      here,
      "yes",
      here,
      ...base,
    ]);
    absent("the target matching does not print the target reason", "target is another repo", "nobody at the terminal", [
      "claude",
      "pm-model",
      here,
      "no",
      here,
      ...base,
    ]);
    absent("a person at the terminal does not print the terminal reason", "nobody at the terminal", "harness differs", [
      "grok",
      "pm-model",
      here,
      "yes",
      here,
      ...base,
    ]);
    absent(
      "an unresolvable path does not print the another-repo label",
      "target is another repo",
      "not in a git repository",
      ["claude", "pm-model", notRepo, "yes", here, ...base],
    );
    absent("resolved paths do not print the unresolvable label", "not in a git repository", "harness differs", [
      "grok",
      "pm-model",
      here,
      "yes",
      here,
      ...base,
    ]);
    const allReasons = command(self, ["grok", "other-model", there, "no", here, ...base]).stdout;
    for (const reason of ["harness differs", "model differs", "target is another repo", "nobody at the terminal"])
      allReasons.includes(reason)
        ? ok(`all four failing names ${reason}`)
        : fail(`all four failing names ${reason}`, allReasons);
    allReasons.indexOf("harness differs") < allReasons.indexOf("model differs") &&
    allReasons.indexOf("model differs") < allReasons.indexOf("target is another repo") &&
    allReasons.indexOf("target is another repo") < allReasons.indexOf("nobody at the terminal")
      ? ok("reasons print in ticket order")
      : fail("reasons print in ticket order", allReasons);
    writeOut("refusals");
    run("no config is refused", 1, "", "-", [
      "claude",
      "pm-model",
      here,
      "yes",
      here,
      "--config",
      join(temp, "none.toml"),
    ]);
    writeFileSync(join(temp, "no-pm.toml"), '[team]\nworkhorses = ["a"]\n');
    run("a config with no team.postmaster is refused", 1, "", "-", [
      "claude",
      "pm-model",
      here,
      "yes",
      here,
      "--config",
      join(temp, "no-pm.toml"),
    ]);
    writeFileSync(join(temp, "bad.toml"), "[team\nbroken\n");
    run("a config that does not parse is refused", 1, "", "-", [
      "claude",
      "pm-model",
      here,
      "yes",
      here,
      "--config",
      join(temp, "bad.toml"),
    ]);
    writeFileSync(join(temp, "strteam.toml"), 'team = "oops"\n');
    run("a config whose team is not a table is refused", 1, "", "-", [
      "claude",
      "pm-model",
      here,
      "yes",
      here,
      "--config",
      join(temp, "strteam.toml"),
    ]);
    const nonTable = command(self, ["claude", "pm-model", here, "yes", here, "--config", join(temp, "strteam.toml")]);
    nonTable.stderr.includes("team.postmaster") && !nonTable.stderr.includes("Traceback")
      ? ok("and refuses in its own words, with no traceback")
      : fail("and refuses in its own words, with no traceback", nonTable.stderr);
    writeFileSync(join(temp, "nonstr.toml"), '[team]\npostmaster = { harness = 7, model = "pm-model" }\n');
    run("a config with a non-string harness is refused", 1, "", "-", [
      "claude",
      "pm-model",
      here,
      "yes",
      here,
      "--config",
      join(temp, "nonstr.toml"),
    ]);
    config("empty", "", "pm-model");
    run("a config with an empty harness is refused", 1, "", "-", [
      "claude",
      "pm-model",
      here,
      "yes",
      here,
      "--config",
      join(temp, "empty.toml"),
    ]);
    config("blank", "   ", "pm-model");
    run("a config with a blank harness is refused", 1, "", "-", [
      "claude",
      "pm-model",
      here,
      "yes",
      here,
      "--config",
      join(temp, "blank.toml"),
    ]);
    writeFileSync(
      join(temp, "newline.toml"),
      '[team]\npostmaster = { harness = "claude", model = "pm-model\\nother" }\n',
    );
    run("a config with a newline in the model is refused", 1, "", "-", [
      "claude",
      "pm-model",
      here,
      "yes",
      here,
      "--config",
      join(temp, "newline.toml"),
    ]);
    const newlineResult = command(self, [
      "claude",
      "pm-model",
      here,
      "yes",
      here,
      "--config",
      join(temp, "newline.toml"),
    ]);
    newlineResult.stderr.includes("control characters")
      ? ok("and says control characters")
      : fail("and says control characters", newlineResult.stderr);
    writeFileSync(join(temp, "tab.toml"), '[team]\npostmaster = { harness = "a\\tb", model = "m" }\n');
    run("a config with a tab in the harness is refused", 1, "", "-", [
      "a\tb",
      "m",
      here,
      "yes",
      here,
      "--config",
      join(temp, "tab.toml"),
    ]);
    run("at-terminal is yes or no, not anything else", 1, "", "-", [
      "claude",
      "pm-model",
      here,
      "maybe",
      here,
      ...base,
    ]);
    const badTerm = command(self, ["claude", "pm-model", here, "maybe", here, ...base]);
    badTerm.stderr.includes("at-terminal is yes or no") ? ok("and says so") : fail("and says so", badTerm.stderr);
    run("POSTMASTER_CONFIG names the config", 0, "self", "-", ["claude", "pm-model", here, "yes", here], {
      POSTMASTER_CONFIG: join(temp, "match.toml"),
    });
    run(
      "--config overrides POSTMASTER_CONFIG",
      0,
      "self",
      "-",
      ["claude", "pm-model", here, "yes", here, "--config", join(temp, "match.toml")],
      { POSTMASTER_CONFIG: join(temp, "no-pm.toml") },
    );
    run("four arguments is a usage error", 2, "", "-", ["claude", "pm-model", here, "yes"]);
    run("--self-test takes no arguments", 2, "", "-", ["--self-test", "extra"]);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
  writeOut("");
  writeOut(fails === 0 ? "self-test: all controls behaved" : `self-test: ${fails} control(s) misbehaved`);
  return fails === 0 ? 0 : 1;
}

const args = process.argv.slice(2);
if (args[0] === "--self-test") {
  if (args.length !== 1) {
    writeError(usage);
    process.exit(2);
  }
  process.exit(selfTest());
}
let harness: string;
let model: string;
let cwd: string;
let terminal: string;
let target: string;
let config = process.env.POSTMASTER_CONFIG ?? join(process.env.HOME ?? "/", ".postmaster/config.toml");
if (args.length === 7 && args[5] === "--config") {
  [harness, model, cwd, terminal, target] = args;
  config = args[6];
} else if (args.length === 5) [harness, model, cwd, terminal, target] = args;
else {
  writeError(usage);
  process.exit(2);
}
const result = decide(harness!, model!, cwd!, terminal!, target!, config);
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) writeError(result.stderr);
process.exit(result.code);
