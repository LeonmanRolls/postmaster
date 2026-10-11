// Decide whether the session that reached the launch card is the postmaster, or must spawn one.
// The session reports its own harness, model, working directory and whether a person is at the
// terminal; the target and the config are given. It is `self` when that session is already on
// team.postmaster's harness and model, in the target repo, with the user at the terminal. It is
// `spawn` with every condition that failed, in ticket order: the harness differs, the model
// differs, the target is another repo, or nobody is at the terminal. When the target is a
// fixture copy (postmaster.fixture in its own git config, set by run fixture new), it also
// prints a `fixture` line, on both routes, so the launch card offers it no verifiers. On a
// `spawn` it prints a `headless` line too: that postmaster starts headless on every host,
// in the form hosts.md gives under none, so it never meets a trust prompt.
//
//   run front-door <harness> <model> <cwd> <at-terminal> <target> [--config <path>]
//
//   at-terminal  yes when a person is at the terminal, no otherwise
//
// POSTMASTER_CONFIG overrides the config path (~/.postmaster/config.toml).
// team.postmaster is read from the target's effective config: its own settings
// over the global config, or its own settings alone with no global config.
//
//   exit 0  printed `self` or `spawn` with its reasons, `headless` on a fixture
//           spawn, and `fixture` for a fixture copy
//   exit 1  no config or one that does not parse, team.postmaster missing, or a bad value
//   exit 2  usage
import { existsSync, statSync } from "node:fs";
import { postmasterProblems } from "./lib/config-check.ts";
import { isFixtureCopy } from "./lib/fixture-mark.ts";
import {
  effectiveConfigForProject,
  globalConfigPath,
  repoTopLevel,
} from "./lib/effective-config.ts";
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

const CONFIG = globalConfigPath();

const isDir = (p: string): boolean => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

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
  if (!fixtureCopy) return spawn;
  const fixture = "fixture the target is a fixture copy made by run fixture new\n";
  return reasons.length > 0
    ? `${spawn}headless the target is a fixture copy made by run fixture new\n${fixture}`
    : `${spawn}${fixture}`;
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
  // The target's own settings override the global config; a target that is no
  // directory reads the global config alone, and the route below fails it closed.
  let cfg: Record<string, unknown>;
  let source = cfgPath;
  let notice = "";
  if (target !== "" && isDir(target)) {
    // Settings live at the repository root, whatever subdirectory names the
    // target; a path git cannot place keeps its own .postmaster, as before.
    const resolved = effectiveConfigForProject(repoTopLevel(target) || target, cfgPath);
    if (resolved.notice !== null) notice = `${resolved.notice}\n`;
    if (resolved.config === null || resolved.error !== null) {
      return die1(`${notice}front-door: ${resolved.error ?? "no effective config"}`);
    }
    cfg = resolved.config;
    if (resolved.projectAlone && resolved.projectFile !== null) source = resolved.projectFile;
  } else {
    if (!existsSync(cfgPath)) {
      return die1(`front-door: no config at ${cfgPath} (POSTMASTER_CONFIG overrides the path)`);
    }
    try {
      cfg = readTomlFile(cfgPath);
    } catch (e) {
      return die1(`front-door: ${cfgPath} does not parse: ${String(e)}`);
    }
  }
  const team = cfg.team;
  const spec =
    team !== null && typeof team === "object" && !Array.isArray(team)
      ? (team as Record<string, unknown>).postmaster
      : undefined;
  const pmProblems = postmasterProblems(spec, source);
  if (pmProblems.length > 0) {
    return die1(`front-door: ${pmProblems[0]}`);
  }
  // No problem means both are non-blank strings without control characters.
  const s = spec as Record<string, unknown>;
  const harness = s.harness as string;
  const model = s.model as string;
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
  return { code: 0, out, err: notice };
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
