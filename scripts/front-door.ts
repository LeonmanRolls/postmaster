// Decide whether the session that reached the launch card is the postmaster, or must spawn one.
// The session reports its own harness, model, working directory and whether a person is at the
// terminal; the target and the config are given. It is `self` when that session is already on
// team.postmaster's harness and model, in the target repo, with the user at the terminal. It is
// `spawn` with every condition that failed, in ticket order: the harness differs, the model
// differs, the target is another repo, or nobody is at the terminal. When the decision is
// `spawn` and the target is a fixture copy (postmaster.fixture in its own git config, set by
// run fixture new), it also prints a `headless` line: that postmaster starts headless on every
// host, in the form hosts.md gives under none, so it never meets a trust prompt.
//
//   run front-door <harness> <model> <cwd> <at-terminal> <target> [--config <path>]
//
//   at-terminal  yes when a person is at the terminal, no otherwise
//
// POSTMASTER_CONFIG overrides the config path (~/.postmaster/config.toml).
//
//   exit 0  printed `self` or `spawn` with its reasons, and `headless` for a fixture copy
//   exit 1  no config or one that does not parse, team.postmaster missing, or a bad value
//   exit 2  usage
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readTomlFile } from "./lib/data.ts";
import { run } from "./lib/proc.ts";

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
    "usage: run front-door <harness> <model> <cwd> <at-terminal> <target> [--config <path>]",
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

/** Whether run fixture marked the target repository in its own git config. */
function isFixtureCopy(path: string): boolean {
  if (!path) return false;
  const r = run("git", ["-C", path, "config", "--local", "--get", "postmaster.fixture"]);
  return r.code === 0 && r.out.trim().length > 0;
}

interface DecideResult {
  code: number;
  out: string;
  err: string;
}

/** Pure route decision from the session report, configured role, repository identities and mark. */
function route(
  h: string,
  m: string,
  cwd: string,
  term: string,
  target: string,
  teamHarness: string,
  teamModel: string,
  cwdRepo: string,
  targetRepo: string,
  fixtureCopy: boolean,
): string {
  const reasons: string[] = [];
  if (h !== teamHarness) {
    reasons.push(
      `harness differs: this session runs on ${h}, team.postmaster names ${teamHarness}`,
    );
  }
  if (m !== teamModel) {
    reasons.push(`model differs: this session runs on ${m}, team.postmaster names ${teamModel}`);
  }
  if (!cwdRepo || !targetRepo) {
    reasons.push(`not in a git repository: the session runs in ${cwd}, the target is ${target}`);
  } else if (cwdRepo !== targetRepo) {
    reasons.push(`target is another repo: the session runs in ${cwd}, the target is ${target}`);
  }
  if (term !== "yes") reasons.push("nobody at the terminal");

  const spawn =
    reasons.length > 0
      ? `spawn ${reasons.join("; ")}\n`
      : [
          "self team.postmaster harness and model, the target is this repo, ",
          "and the user is at the terminal\n",
        ].join("");
  return reasons.length > 0 && fixtureCopy
    ? `${spawn}headless the target is a fixture copy made by run fixture new\n`
    : spawn;
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
  const out = route(
    h,
    m,
    cwd,
    term,
    target,
    harness,
    model,
    repoOf(cwd),
    repoOf(target),
    isFixtureCopy(target),
  );
  return { code: 0, out, err: "" };
}

function printResult(r: DecideResult): never {
  if (r.out) process.stdout.write(r.out);
  if (r.err) process.stderr.write(r.err);
  process.exit(r.code);
}

// --- entry ------------------------------------------------------------------------------
const argv = process.argv.slice(2);

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
