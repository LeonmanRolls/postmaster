// Decide whether the session that reached the launch card is the postmaster, or must spawn one.
// The session reports its own harness, model, working directory and whether a person is at the
// terminal; the target and the config are given. It is `self` when that session is already on
// team.postmaster's harness and model, in the target repo, with the user at the terminal. It is
// `spawn` with every condition that failed, in ticket order: the harness differs, the model
// differs, the target is another repo, or nobody is at the terminal.
//
//   front-door.sh <harness> <model> <cwd> <at-terminal> <target> [--config <path>]
//   front-door.sh --self-test
//
//   at-terminal  yes when a person is at the terminal, no otherwise
//
// POSTMASTER_CONFIG overrides the config path (~/.postmaster/config.toml).
//
// `--self-test` in argv position one is the flag, whatever follows; no harness is named that.
//
//   exit 0  printed `self` or `spawn` with its reasons
//   exit 1  no config or one that does not parse, team.postmaster missing, or a bad value
//   exit 2  usage
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readTomlFile } from "./lib/data.ts";
import { scriptsDir } from "./lib/paths.ts";
import { run, withTempDir } from "./lib/proc.ts";
import { SelfTest } from "./lib/selftest.ts";

// A GIT_DIR from the caller must not steer repo identity to another repository.
for (const k of [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_COMMON_DIR",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_NAMESPACE",
]) {
  delete process.env[k];
}

const CONFIG =
  process.env.POSTMASTER_CONFIG ?? join(process.env.HOME ?? "", ".postmaster/config.toml");

function usage(): never {
  console.error(
    "usage: front-door.sh <harness> <model> <cwd> <at-terminal> <target> [--config <path>] | --self-test",
  );
  process.exit(2);
}

/** The git repository a path is in, as its common .git directory, or empty. */
function repoOf(path: string): string {
  // An empty path is unresolvable: git -C "" would silently mean the process cwd.
  if (!path) return "";
  const r = run("git", ["-C", path, "rev-parse", "--path-format=absolute", "--git-common-dir"]);
  return r.code === 0 ? r.out.trim() : "";
}

interface DecideResult {
  code: number;
  out: string;
  err: string;
}

function decide(
  h: string,
  m: string,
  cwd: string,
  term: string,
  target: string,
  cfgPath: string,
): DecideResult {
  const err: string[] = [];
  const die1 = (msg: string): DecideResult => {
    err.push(msg);
    return { code: 1, out: "", err: `${err.join("\n")}\n` };
  };
  if (term !== "yes" && term !== "no") {
    return die1(`front-door: at-terminal is yes or no, not '${term}'`);
  }
  if (!existsSync(cfgPath)) {
    return die1(`front-door: no config at ${cfgPath} (POSTMASTER_CONFIG overrides the path)`);
  }
  let cfg: Record<string, unknown>;
  try {
    cfg = readTomlFile(cfgPath);
  } catch (e) {
    return die1(`front-door: ${cfgPath} does not parse: ${String(e)}`);
  }
  const team = cfg.team;
  const spec =
    team !== null && typeof team === "object" && !Array.isArray(team)
      ? (team as Record<string, unknown>).postmaster
      : undefined;
  if (spec === null || typeof spec !== "object" || Array.isArray(spec)) {
    return die1(`front-door: ${cfgPath} has no team.postmaster with a harness and a model`);
  }
  const s = spec as Record<string, unknown>;
  const harness = s.harness;
  const model = s.model;
  if (!harness || !model) {
    return die1(`front-door: ${cfgPath} has no team.postmaster with a harness and a model`);
  }
  if (typeof harness !== "string" || typeof model !== "string") {
    return die1(`front-door: ${cfgPath} team.postmaster harness and model must be strings`);
  }
  if (!harness.trim() || !model.trim()) {
    return die1(`front-door: ${cfgPath} team.postmaster harness and model must not be blank`);
  }
  if (
    [...(harness + model)].some((c) => {
      const o = c.codePointAt(0) ?? 0;
      return o < 0x20 || o === 0x7f;
    })
  ) {
    return die1(
      `front-door: ${cfgPath} team.postmaster harness and model must not contain control characters`,
    );
  }
  const th = harness;
  const tm = model;
  const reasons: string[] = [];
  const addReason = (text: string): void => {
    reasons.push(text);
  };
  if (h !== th) {
    addReason(`harness differs: this session runs on ${h}, team.postmaster names ${th}`);
  }
  if (m !== tm) {
    addReason(`model differs: this session runs on ${m}, team.postmaster names ${tm}`);
  }
  const tc = repoOf(cwd);
  const tt = repoOf(target);
  if (!tc || !tt) {
    addReason(`not in a git repository: the session runs in ${cwd}, the target is ${target}`);
  } else if (tc !== tt) {
    addReason(`target is another repo: the session runs in ${cwd}, the target is ${target}`);
  }
  if (term !== "yes") {
    addReason("nobody at the terminal");
  }
  const out =
    reasons.length > 0
      ? `spawn ${reasons.join("; ")}\n`
      : "self team.postmaster harness and model, the target is this repo, and the user is at the terminal\n";
  return { code: 0, out, err: "" };
}

function printResult(r: DecideResult): never {
  if (r.out) process.stdout.write(r.out);
  if (r.err) process.stderr.write(r.err);
  process.exit(r.code);
}

// --- entry ------------------------------------------------------------------------------
const argv = process.argv.slice(2);

if (argv[0] === "--self-test") {
  if (argv.length !== 1) usage();
} else {
  if (argv.length === 0) usage();
  let config = CONFIG;
  let rest = argv;
  if (argv.length === 7 && argv[5] === "--config") {
    config = argv[6] ?? "";
    rest = argv.slice(0, 5);
  } else if (argv.length !== 5) {
    usage();
  }
  printResult(
    decide(rest[0] ?? "", rest[1] ?? "", rest[2] ?? "", rest[3] ?? "", rest[4] ?? "", config),
  );
}

// --- self-test ----------------------------------------------------------------------------
const self = join(scriptsDir(import.meta), "front-door.sh");
withTempDir((tmp) => {
  const st = new SelfTest();

  // Two repositories, so the target reason has a difference to find.
  mkdirSync(join(tmp, "here"), { recursive: true });
  mkdirSync(join(tmp, "there"), { recursive: true });
  run("git", ["-C", join(tmp, "here"), "init", "-q"]);
  run("git", [
    "-C",
    join(tmp, "here"),
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
  run("git", ["-C", join(tmp, "there"), "init", "-q"]);
  run("git", [
    "-C",
    join(tmp, "there"),
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
  // A worktree of "here", so the same-repo case is not path equality.
  run("git", ["-C", join(tmp, "here"), "worktree", "add", "-q", join(tmp, "here-wt"), "-b", "wt"]);
  mkdirSync(join(tmp, "here/sub"), { recursive: true });

  const config = (name: string, harness: string, model: string): void => {
    writeFileSync(
      join(tmp, `${name}.toml`),
      `[team]\npostmaster = { harness = "${harness}", model = "${model}" }\n`,
    );
  };
  config("match", "claude", "pm-model");

  let lastErr = "";
  const doRun = (
    label: string,
    wantRc: number,
    wantWord: string,
    wantWhy: string,
    args: string[],
    opts: { cwd?: string; env?: Record<string, string | undefined> } = {},
  ): void => {
    const r = run(self, args, opts);
    lastErr = r.err;
    const out = r.out;
    const word = out.split(" ")[0] ?? "";
    if (r.code !== wantRc) {
      st.fail(`${label}: wanted exit ${wantRc}, got exit ${r.code}`, out + r.err);
      return;
    }
    if (word !== wantWord) {
      st.fail(`${label}: wanted '${wantWord}', got '${word}'`, out + r.err);
      return;
    }
    if (wantWhy !== "-" && !out.includes(wantWhy)) {
      st.fail(`${label}: wanted the reason to contain '${wantWhy}'`, out);
      return;
    }
    st.ok(label);
  };

  const absent = (
    label: string,
    no: string,
    yes: string,
    args: string[],
    opts: { cwd?: string; env?: Record<string, string | undefined> } = {},
  ): void => {
    const r = run(self, args, opts);
    lastErr = r.err;
    if (r.code !== 0) {
      st.fail(`${label}: exit ${r.code}, want 0`, r.out + r.err);
      return;
    }
    if (r.out.includes(no)) {
      st.fail(`${label}: '${no}' was printed`, r.out);
      return;
    }
    if (r.out.includes(yes)) st.ok(label);
    else st.fail(`${label}: '${yes}' was not printed`, r.out);
  };

  const closed = (label: string, args: string[]): void => {
    const r = run(self, args, { cwd: join(tmp, "here") });
    lastErr = r.err;
    if (r.code !== 0) {
      st.fail(`${label}: exit ${r.code}, want 0`, r.out + r.err);
      return;
    }
    if (r.out.startsWith("spawn not in a git repository")) st.ok(label);
    else st.fail(`${label}: wanted spawn naming both paths`, r.out);
  };

  const cfg = (name: string) => ["--config", join(tmp, `${name}.toml`)];
  const here = join(tmp, "here");
  const there = join(tmp, "there");

  console.log("positive controls");
  doRun("harness differs prints spawn naming harness", 0, "spawn", "harness differs", [
    "grok",
    "pm-model",
    here,
    "yes",
    here,
    ...cfg("match"),
  ]);
  doRun("model differs prints spawn naming model", 0, "spawn", "model differs", [
    "claude",
    "other-model",
    here,
    "yes",
    here,
    ...cfg("match"),
  ]);
  doRun("target is another repo prints spawn naming target", 0, "spawn", "target is another repo", [
    "claude",
    "pm-model",
    here,
    "yes",
    there,
    ...cfg("match"),
  ]);
  doRun(
    "nobody at the terminal prints spawn naming terminal",
    0,
    "spawn",
    "nobody at the terminal",
    ["claude", "pm-model", here, "no", here, ...cfg("match")],
  );
  doRun("all four match prints self", 0, "self", "-", [
    "claude",
    "pm-model",
    here,
    "yes",
    here,
    ...cfg("match"),
  ]);
  doRun("a worktree of the target is the target's repo, so it is self", 0, "self", "-", [
    "claude",
    "pm-model",
    join(tmp, "here-wt"),
    "yes",
    here,
    ...cfg("match"),
  ]);
  doRun("a subdirectory of the target is the target's repo, so it is self", 0, "self", "-", [
    "claude",
    "pm-model",
    join(tmp, "here/sub"),
    "yes",
    here,
    ...cfg("match"),
  ]);
  doRun("every failed condition is reported", 0, "spawn", "harness differs", [
    "grok",
    "other-model",
    there,
    "no",
    here,
    ...cfg("match"),
  ]);
  mkdirSync(join(tmp, "notrepo"), { recursive: true });
  doRun(
    "a directory outside any repo fails closed naming both paths",
    0,
    "spawn",
    "not in a git repository",
    ["claude", "pm-model", join(tmp, "notrepo"), "yes", here, ...cfg("match")],
  );
  doRun(
    "a target outside any repo fails closed naming both paths",
    0,
    "spawn",
    "not in a git repository",
    ["claude", "pm-model", here, "yes", join(tmp, "notrepo"), ...cfg("match")],
  );
  config("spaces", "claude code", "pm-model");
  doRun("a harness name with a space still matches itself", 0, "self", "-", [
    "claude code",
    "pm-model",
    here,
    "yes",
    here,
    ...cfg("spaces"),
  ]);
  doRun("an empty harness decides spawn, not usage", 0, "spawn", "harness differs", [
    "",
    "pm-model",
    here,
    "yes",
    here,
    ...cfg("match"),
  ]);
  doRun("a reported model with a newline decides spawn", 0, "spawn", "model differs", [
    "claude",
    "pm-model\nother",
    here,
    "yes",
    here,
    ...cfg("match"),
  ]);

  console.log("empty paths fail closed from inside a repo");
  closed("an empty cwd fails closed from inside a repo", [
    "claude",
    "pm-model",
    "",
    "yes",
    here,
    ...cfg("match"),
  ]);
  closed("an empty target fails closed from inside a repo", [
    "claude",
    "pm-model",
    here,
    "yes",
    "",
    ...cfg("match"),
  ]);
  closed("an empty cwd and target fail closed from inside a repo", [
    "claude",
    "pm-model",
    "",
    "yes",
    "",
    ...cfg("match"),
  ]);

  console.log("caller environment does not steer identity");
  doRun(
    "a GIT_DIR from the caller does not steer distinct repos to self",
    0,
    "spawn",
    "target is another repo",
    ["claude", "pm-model", here, "yes", there, ...cfg("match")],
    {
      env: {
        GIT_DIR: join(tmp, "there/.git"),
        GIT_COMMON_DIR: join(tmp, "there/.git"),
      },
    },
  );

  console.log("negative controls");
  absent(
    "the harness matching does not print the harness reason",
    "harness differs",
    "model differs",
    ["claude", "other-model", here, "yes", here, ...cfg("match")],
  );
  absent("the model matching does not print the model reason", "model differs", "harness differs", [
    "grok",
    "pm-model",
    here,
    "yes",
    here,
    ...cfg("match"),
  ]);
  absent(
    "the target matching does not print the target reason",
    "target is another repo",
    "nobody at the terminal",
    ["claude", "pm-model", here, "no", here, ...cfg("match")],
  );
  absent(
    "a person at the terminal does not print the terminal reason",
    "nobody at the terminal",
    "harness differs",
    ["grok", "pm-model", here, "yes", here, ...cfg("match")],
  );
  absent(
    "an unresolvable path does not print the another-repo label",
    "target is another repo",
    "not in a git repository",
    ["claude", "pm-model", join(tmp, "notrepo"), "yes", here, ...cfg("match")],
  );
  absent(
    "resolved paths do not print the unresolvable label",
    "not in a git repository",
    "harness differs",
    ["grok", "pm-model", here, "yes", here, ...cfg("match")],
  );
  const allFour = run(self, ["grok", "other-model", there, "no", here, ...cfg("match")]);
  for (const reason of [
    "harness differs",
    "model differs",
    "target is another repo",
    "nobody at the terminal",
  ]) {
    if (allFour.out.includes(reason)) st.ok(`all four failing names ${reason}`);
    else st.fail(`all four failing names ${reason}`, allFour.out);
  }
  const fourOut = allFour.out.trimEnd();
  if (
    fourOut.startsWith("spawn harness differs") &&
    fourOut.includes("; model differs") &&
    fourOut.includes("; target is another repo") &&
    fourOut.endsWith("nobody at the terminal")
  ) {
    st.ok("reasons print in ticket order");
  } else st.fail("reasons print in ticket order", fourOut);

  console.log("refusals");
  doRun("no config is refused", 1, "", "-", [
    "claude",
    "pm-model",
    here,
    "yes",
    here,
    ...cfg("none"),
  ]);
  writeFileSync(join(tmp, "no-pm.toml"), '[team]\nworkhorses = ["a"]\n');
  doRun("a config with no team.postmaster is refused", 1, "", "-", [
    "claude",
    "pm-model",
    here,
    "yes",
    here,
    ...cfg("no-pm"),
  ]);
  writeFileSync(join(tmp, "bad.toml"), "[team\nbroken\n");
  doRun("a config that does not parse is refused", 1, "", "-", [
    "claude",
    "pm-model",
    here,
    "yes",
    here,
    ...cfg("bad"),
  ]);
  writeFileSync(join(tmp, "strteam.toml"), 'team = "oops"\n');
  doRun("a config whose team is not a table is refused", 1, "", "-", [
    "claude",
    "pm-model",
    here,
    "yes",
    here,
    ...cfg("strteam"),
  ]);
  if (lastErr.includes("team.postmaster") && !lastErr.includes("Traceback")) {
    st.ok("and refuses in its own words, with no traceback");
  } else st.fail("and refuses in its own words, with no traceback", lastErr);
  writeFileSync(
    join(tmp, "nonstr.toml"),
    '[team]\npostmaster = { harness = 7, model = "pm-model" }\n',
  );
  doRun("a config with a non-string harness is refused", 1, "", "-", [
    "claude",
    "pm-model",
    here,
    "yes",
    here,
    ...cfg("nonstr"),
  ]);
  config("empty", "", "pm-model");
  doRun("a config with an empty harness is refused", 1, "", "-", [
    "claude",
    "pm-model",
    here,
    "yes",
    here,
    ...cfg("empty"),
  ]);
  config("blank", "   ", "pm-model");
  doRun("a config with a blank harness is refused", 1, "", "-", [
    "claude",
    "pm-model",
    here,
    "yes",
    here,
    ...cfg("blank"),
  ]);
  writeFileSync(
    join(tmp, "newline.toml"),
    '[team]\npostmaster = { harness = "claude", model = "pm-model\\nother" }\n',
  );
  doRun("a config with a newline in the model is refused", 1, "", "-", [
    "claude",
    "pm-model",
    here,
    "yes",
    here,
    ...cfg("newline"),
  ]);
  if (lastErr.includes("control characters")) st.ok("and says control characters");
  else st.fail("and says control characters", lastErr);
  writeFileSync(join(tmp, "tab.toml"), '[team]\npostmaster = { harness = "a\\tb", model = "m" }\n');
  doRun("a config with a tab in the harness is refused", 1, "", "-", [
    "a\tb",
    "m",
    here,
    "yes",
    here,
    ...cfg("tab"),
  ]);
  doRun("at-terminal is yes or no, not anything else", 1, "", "-", [
    "claude",
    "pm-model",
    here,
    "maybe",
    here,
    ...cfg("match"),
  ]);
  if (lastErr.includes("at-terminal is yes or no")) st.ok("and says so");
  else st.fail("and says so", lastErr);
  doRun(
    "POSTMASTER_CONFIG names the config",
    0,
    "self",
    "-",
    ["claude", "pm-model", here, "yes", here],
    { env: { POSTMASTER_CONFIG: join(tmp, "match.toml") } },
  );
  doRun(
    "--config overrides POSTMASTER_CONFIG",
    0,
    "self",
    "-",
    ["claude", "pm-model", here, "yes", here, ...cfg("match")],
    { env: { POSTMASTER_CONFIG: join(tmp, "no-pm.toml") } },
  );
  doRun("four arguments is a usage error", 2, "", "-", ["claude", "pm-model", here, "yes"]);
  doRun("--self-test takes no arguments", 2, "", "-", ["--self-test", "extra"]);

  st.finish();
});
