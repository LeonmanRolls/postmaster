// Set this machine up: probe the agent CLIs, ask which harness and model fills each role, how
// tickets are tracked, whether lanes run confined, where projects live and who says the merge word, then write
// ~/.postmaster/config.toml in the shape of config.example.toml.
//
//   run setup [--answers <file>] [--dry-run] [--config <path>]
//   run setup --keys
//
// An agent drives it: the user's answers go in a file, one key=value per line (--keys
// lists them with their prompts and defaults), and --answers reads them by name, so the order
// of the questions never matters. A missing key takes its default and a key with no default
// is an error naming it. Without --answers the questions are asked on stdin one at a time, so
// a person can drive it too. --dry-run prints the config instead of writing it.
//
//   exit 0  config written (or printed), or keys listed
//   exit 1  a harness was named that is not on PATH, the coachman shares a lane's model, fewer
//           than two lanes were given, a reviewer is not a lane, an answer was missing, a round
//           time limit was not a whole number of seconds from 1 to 86400, a planning review link
//           omitted {path}, or an existing config was not overwritten
//
// Control: the written file is parsed back as TOML where a parser is available, and its reviewer
// lanes are resolved through scripts/run reviewers, so a config that would fail to load is never
// left on disk as if it were fine.
import { existsSync, mkdirSync, readFileSync, readSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readTomlFile } from "./lib/data.ts";
import { scriptsDir } from "./lib/paths.ts";
import { die, run } from "./lib/proc.ts";

const HERE = scriptsDir(import.meta);

function tomlList(s: string): string {
  const items = s
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x !== "");
  return `[${items.map((x) => `"${x}"`).join(", ")}]`;
}

function roleExtra(effort: string, envFile: string): string {
  let s = "";
  if (effort) s += `, effort = "${effort}"`;
  if (envFile) s += `, env_file = "${envFile}"`;
  return s;
}

function installed(tool: string): boolean {
  // command -v is a shell builtin: BASE ran it in the shell, so the port must too.
  return run("bash", ["-c", 'command -v "$1" >/dev/null 2>&1', "_", tool]).code === 0;
}

function validTasks(v: string): boolean {
  if (!/^[1-9][0-9]*$/u.test(v)) return false;
  return v.length <= 10 && Number(v) <= 2147483647;
}

function needHarness(h: string): void {
  if (!installed(h)) {
    die(`setup: harness '${h}' is not on PATH; install it or choose another`, 1);
  }
}

interface AskOpts {
  answers: string;
}

function ask(prompt: string, def: string, key: string, opts: AskOpts): string {
  let k = key;
  let optional = false;
  if (k.endsWith("?")) {
    optional = true;
    k = k.slice(0, -1);
  }
  let answer = "";
  if (opts.answers !== "") {
    try {
      const text = readFileSync(opts.answers, "utf8");
      const lines = text.split("\n");
      for (const line of lines) {
        if (line.startsWith(`${k}=`)) {
          answer = line.slice(k.length + 1);
          break;
        }
      }
    } catch {
      /* fall through */
    }
    if (answer === "") {
      if (def === "" && !optional && !hasKey(opts.answers, k)) {
        die(`setup: no answer for ${k} in ${opts.answers} (${prompt})`, 1);
      }
      answer = def;
    }
    console.log(`${prompt}: ${answer}`);
  } else {
    // interactive: prompt on stderr, read stdin
    if (def !== "") {
      process.stderr.write(`${prompt} [${def}]: `);
    } else {
      process.stderr.write(`${prompt}: `);
    }
    // read one line from stdin synchronously, byte by byte like read -r: a
    // chunked read would swallow every line a pipe already holds
    let line = "";
    try {
      const bytes: number[] = [];
      const one = Buffer.alloc(1);
      for (;;) {
        const n = readSync(0, one, 0, 1, null);
        if (n === 0 || one[0] === 10) break;
        if (one[0] !== 13) bytes.push(one[0] as number);
      }
      line = new TextDecoder().decode(new Uint8Array(bytes));
    } catch {
      line = "";
    }
    if (def !== "") console.log("");
    if (line === "") answer = def;
    else answer = line;
  }
  return answer;
}

function hasKey(file: string, key: string): boolean {
  try {
    const text = readFileSync(file, "utf8");
    return text.split("\n").some((l) => l.startsWith(`${key}=`));
  } catch {
    return false;
  }
}

// --- entry -----------------------------------------------------------------------------------
const argv = process.argv.slice(2);
// Launch caps are applied only where postmaster can cap a launch: Linux, as
// systemdCapability() reads it (uname -s on PATH). Everywhere else setup neither
// asks about limits nor lists them, and says once that launches run without them.
const onLinux = run("uname", ["-s"]).out.replace(/\n+$/u, "") === "Linux";
let DRY = 0;
let ANSWERS = "";
let CONFIG = join(process.env.HOME ?? "~", ".postmaster", "config.toml");
let i = 0;
while (i < argv.length) {
  const a = argv[i];
  if (a === "--dry-run") {
    DRY = 1;
  } else if (a === "--config") {
    const v = argv[++i];
    if (!v) die("--config needs a path", 1);
    CONFIG = v;
  } else if (a === "--answers") {
    const v = argv[++i];
    if (!v) die("--answers needs a file", 1);
    if (!existsSync(v)) die(`setup: no such answers file: ${v}`, 1);
    ANSWERS = v;
  } else if (a === "--keys") {
    console.log(`key (? = may be left out)  default            asked as
projects_roots             ~/Code             where projects live, comma separated
lanes                      alpha, beta        lane names, comma separated; then per lane:
lane.<name>.harness                           harness (codex, grok, agy, claude, muse, mimo, pi)
lane.<name>.model                             model id
lane.<name>.effort?        (none)             effort, blank if the harness has no effort flag
lane.<name>.env_file?      (none)             env file for an alternate backend
workhorses                 <lanes>            workhorse lanes, comma separated
reviewers                  <workhorses>       reviewer lanes, comma separated
reviewers.<lens>?          (reviewers)        reviewer lanes for one lens only; bug reviewers need a code-review form
coachman.harness                              never a lane's model
coachman.model
coachman.effort?           (none)
coachman.env_file?         (none)             env file for its key or backend, as for a lane
fallback.harness                              never a lane's model
fallback.model
fallback.effort?           (none)
fallback.env_file?         (none)
postmaster.harness
postmaster.model
postmaster.effort?         (none)
postmaster.env_file?       (none)
max_runs                   2                  concurrent runs per project
poll_seconds               120                postmaster poll interval${
      onLinux
        ? `
limits.memory_max          8G                 default memory cap per launch (K, M, G or T)
limits.tasks_max           512                default process cap per launch
limits.lane.memory_max?    (default)          lane memory cap override
limits.lane.tasks_max?     (default)          lane process cap override
limits.coachman.memory_max? (default)         coachman memory cap override
limits.coachman.tasks_max? (default)         coachman process cap override
limits.reviewer.memory_max? (default)         reviewer memory cap override
limits.reviewer.tasks_max? (default)          reviewer process cap override`
        : ""
    }
tracker                    github             github, plane, local or other
confine                    off                lane confinement, on or off (see run probe-confine)
plane.url                  https://api.plane.so   plane only
plane.workspace                               plane only; the slug in the workspace's web URL
plane.env_file             ~/.postmaster/plane.env   plane only; holds PLANE_API_KEY=<key>
tracker.name                                  other only
postmaster_may_create      no                 yes lets the postmaster create tickets unasked
round_timeout_seconds      2400               seconds a review round may run, 1 to 86400
merge_authority            user               user or postmaster
checkpoint_mode            autonomous         autonomous or consult
review_link?               (none)             template with {path}
planning.review_link?      (none)             code-server template with {path} for workhorse specs
overwrite                  no                 yes replaces an existing config`);
    process.exit(0);
  } else {
    console.error("usage: run setup [--answers <file>] [--dry-run] [--config <path>] | --keys");
    process.exit(1);
  }
  i++;
}

const opts: AskOpts = { answers: ANSWERS };
console.log("== Installed agent CLIs ==");
const probe = run(join(HERE, "run"), ["probe-harnesses"]);
process.stdout.write(probe.out);
process.stderr.write(probe.err);
console.log("");

const ROOTS = ask("Where do projects live (comma separated)", "~/Code", "projects_roots", opts);

console.log("");
console.log(
  "== The horses: lanes that implement a ticket. At least two, from different vendors. ==",
);
const LANES = ask("Lane names, comma separated", "alpha, beta", "lanes", opts);
const laneList = LANES.split(",")
  .map((x) => x.trim())
  .filter((x) => x !== "");
if (laneList.length < 2) die("setup: at least two lanes are needed", 1);
let LANE_BLOCKS = "";
const LANE_MODELS: string[] = [];
const LANE_HARNESSES: string[] = [];
for (const lane of laneList) {
  const h = ask(
    `  ${lane}: harness (codex, grok, agy, claude, muse, mimo, pi)`,
    "",
    `lane.${lane}.harness`,
    opts,
  );
  needHarness(h);
  const m = ask(`  ${lane}: model id`, "", `lane.${lane}.model`, opts);
  const e = ask(
    `  ${lane}: effort (blank if the harness has no effort flag)`,
    "",
    `lane.${lane}.effort?`,
    opts,
  );
  const ef = ask(
    `  ${lane}: env file for an alternate backend (blank if none)`,
    "",
    `lane.${lane}.env_file?`,
    opts,
  );
  let block = `[lanes.${lane}]\nharness = "${h}"\nmodel = "${m}"`;
  if (e) block += `\neffort = "${e}"`;
  if (ef) block += `\nenv_file = "${ef}"`;
  LANE_BLOCKS += `\n${block}\n`;
  LANE_MODELS.push(m);
  LANE_HARNESSES.push(`${lane}=${h}`);
}

console.log("");
const WORKHORSES = ask("Workhorse lanes, comma separated", LANES, "workhorses", opts);
for (const a of WORKHORSES.split(",")
  .map((x) => x.trim())
  .filter((x) => x !== "")) {
  if (!laneList.includes(a)) die(`setup: workhorse '${a}' is not one of the lanes (${LANES})`, 1);
}
if (
  WORKHORSES.split(",")
    .map((x) => x.trim())
    .filter((x) => x !== "").length < 2
) {
  die("setup: at least two workhorses are needed", 1);
}
const REVIEWERS = ask("Reviewer lanes, comma separated", WORKHORSES, "reviewers", opts);
for (const rv of REVIEWERS.split(",")
  .map((x) => x.trim())
  .filter((x) => x !== "")) {
  if (!laneList.includes(rv)) die(`setup: reviewer '${rv}' is not one of the lanes (${LANES})`, 1);
}
let LENS_TABLE = "";
let BUG_REVIEWERS = REVIEWERS;
const lensesR = run(join(HERE, "run"), ["reviewers", "lenses"]);
const lenses = lensesR.out
  .trim()
  .split("\n")
  .filter((l) => l !== "");
for (const lens of lenses) {
  const LR = ask(
    `  reviewer lanes for the ${lens} lens alone, comma separated (blank: the reviewer lanes)`,
    "",
    `reviewers.${lens}?`,
    opts,
  );
  if (lens === "bug") BUG_REVIEWERS = LR || REVIEWERS;
  if (!LR) continue;
  for (const rv of LR.split(",")
    .map((x) => x.trim())
    .filter((x) => x !== "")) {
    if (!laneList.includes(rv))
      die(`setup: ${lens} reviewer '${rv}' is not one of the lanes (${LANES})`, 1);
  }
  LENS_TABLE += `${lens} = ${tomlList(LR)}\n`;
}
if (LENS_TABLE) LENS_TABLE = `\n[team.lens_reviewers]\n${LENS_TABLE}`;

console.log("");
console.log("== Bug review capability ==");
let BUG_REVIEWABLE = 0;
for (const reviewer of BUG_REVIEWERS.split(",")
  .map((x) => x.trim())
  .filter((x) => x !== "")) {
  let harness = "";
  for (const lh of LANE_HARNESSES) {
    if (lh.startsWith(`${reviewer}=`)) {
      harness = lh.slice(reviewer.length + 1);
      break;
    }
  }
  if (run(join(HERE, "run"), ["review-forms", "has", harness]).code === 0) {
    BUG_REVIEWABLE += 1;
  } else {
    console.log(`setup: bug reviewer '${reviewer}' uses ${harness}, which has no code-review form`);
  }
}
if (BUG_REVIEWABLE === 0) {
  console.log(
    "setup: warning: no configured bug reviewer has a code-review form; runs whose turnpikes include bug review will be refused at pre-flight",
  );
}

console.log("");
console.log(
  "== The coachman: judges the lanes and runs the review rounds. Never a lane's model. ==",
);
const CH = ask("  coachman: harness", "", "coachman.harness", opts);
needHarness(CH);
const CM = ask("  coachman: model id", "", "coachman.model", opts);
if (LANE_MODELS.includes(CM)) die(`setup: the coachman cannot run on a lane's model (${CM})`, 1);
const CE = ask("  coachman: effort (blank if none)", "", "coachman.effort?", opts);
const CEF = ask(
  "  coachman: env file for its key or backend (blank if none)",
  "",
  "coachman.env_file?",
  opts,
);
console.log("");
console.log(
  "== The coachman's fallback: takes over a leg when the coachman hits a wall. Not a lane either. ==",
);
const FH = ask("  fallback: harness", "", "fallback.harness", opts);
needHarness(FH);
const FM = ask("  fallback: model id", "", "fallback.model", opts);
if (LANE_MODELS.includes(FM))
  die(`setup: the fallback coachman cannot run on a lane's model (${FM})`, 1);
const FE = ask("  fallback: effort (blank if none)", "", "fallback.effort?", opts);
const FEF = ask(
  "  fallback: env file for its key or backend (blank if none)",
  "",
  "fallback.env_file?",
  opts,
);

console.log("");
console.log("== The postmaster: decomposes the stream, dispatches coachmen, supervises. ==");
const PH = ask("  postmaster: harness", "", "postmaster.harness", opts);
needHarness(PH);
const PM = ask("  postmaster: model id", "", "postmaster.model", opts);
const PE = ask("  postmaster: effort (blank if none)", "", "postmaster.effort?", opts);
const PEF = ask(
  "  postmaster: env file for its key or backend (blank if none)",
  "",
  "postmaster.env_file?",
  opts,
);
const MR = ask("  concurrent runs per project", "2", "max_runs", opts);
const PS = ask("  postmaster poll interval, seconds", "120", "poll_seconds", opts);

console.log("");
let LM = "8G";
let LT = "512";
let LIMIT_ROLE_TABLES = "";
if (onLinux) {
  console.log(
    "== Launch limits: per-launch memory and process caps when the host supports them. ==",
  );
  LM = ask("  default memory cap (number plus K, M, G or T)", "8G", "limits.memory_max", opts);
  if (!/^[1-9][0-9]*[KMGT]$/u.test(LM))
    die("setup: memory_max must be a positive whole number followed by K, M, G or T", 1);
  LT = ask("  default process cap (whole number)", "512", "limits.tasks_max", opts);
  if (!validTasks(LT)) die("setup: tasks_max must be a whole number from 1 to 2147483647", 1);
  for (const limitRole of ["lane", "coachman", "reviewer"]) {
    const LR_MEM = ask(
      `  ${limitRole} memory cap override (blank inherits the default)`,
      "",
      `limits.${limitRole}.memory_max?`,
      opts,
    );
    if (LR_MEM && !/^[1-9][0-9]*[KMGT]$/u.test(LR_MEM))
      die(
        `setup: limits.${limitRole}.memory_max must be a positive whole number followed by K, M, G or T`,
        1,
      );
    const LR_TASKS = ask(
      `  ${limitRole} process cap override (blank inherits the default)`,
      "",
      `limits.${limitRole}.tasks_max?`,
      opts,
    );
    if (LR_TASKS && !validTasks(LR_TASKS))
      die(`setup: limits.${limitRole}.tasks_max must be a whole number from 1 to 2147483647`, 1);
    if (LR_MEM || LR_TASKS) {
      LIMIT_ROLE_TABLES += `\n[limits.${limitRole}]\n`;
      if (LR_MEM) LIMIT_ROLE_TABLES += `memory_max = "${LR_MEM}"\n`;
      if (LR_TASKS) LIMIT_ROLE_TABLES += `tasks_max = ${LR_TASKS}\n`;
    }
  }
} else {
  // Nothing here can cap a launch, so setup asks no question about it, and its
  // list of settings leaves the limit settings out with the questions.
  console.log("launches on this system run without memory or process limits");
}

console.log("");
console.log(
  "== Tickets: GitHub Issues on a Projects board by default; Plane; local, kept in each repo; or another tracker. ==",
);
const TK = ask("How are tickets tracked (github, plane, local, other)", "github", "tracker", opts);
let PURL = "",
  PWS = "",
  PENV = "",
  OTHER = "";
if (TK === "plane") {
  PURL = ask(
    "  Plane API origin (https://api.plane.so for cloud; a self-hosted instance is its own)",
    "https://api.plane.so",
    "plane.url",
    opts,
  );
  PWS = ask(
    "  workspace slug (the segment after the host in the workspace's web URL)",
    "",
    "plane.workspace",
    opts,
  );
  if (!PWS) die("setup: a Plane workspace slug is needed", 1);
  PENV = ask(
    "  file holding PLANE_API_KEY=<key>, written by you, never pasted here",
    "~/.postmaster/plane.env",
    "plane.env_file",
    opts,
  );
} else if (TK === "other") {
  OTHER = ask(
    "  tracker name (then describe it in ~/.postmaster/trackers/<name>.md)",
    "",
    "tracker.name",
    opts,
  );
} else if (TK !== "github" && TK !== "local") {
  die("setup: tracker kind must be github, plane, local or other", 1);
}

console.log("");
console.log("== Lane confinement: sandbox-runtime wraps each lane's harness. ==");
const confineProbe = run(join(HERE, "run"), ["probe-confine"]);
if (confineProbe.code !== 0)
  die("setup: probe-confine failed; fix it before choosing confinement", 1);
process.stdout.write(confineProbe.out);
process.stderr.write(confineProbe.err);
const CONFINE = ask("Run lanes confined (on/off)", "off", "confine", opts);
if (CONFINE !== "on" && CONFINE !== "off") die("setup: confine must be on or off", 1);
if (CONFINE === "on") {
  const verdict = run(join(HERE, "run"), ["probe-confine", "--verdict"]);
  if (verdict.code !== 0) die("setup: probe-confine --verdict failed", 1);
  if (verdict.out.trim() === "unavailable")
    die("setup: confine=on is unavailable here; run probe-confine for the machine's result", 1);
  if (verdict.out.trim() !== "ready" && verdict.out.trim() !== "partial")
    die("setup: probe-confine returned no usable verdict", 1);
}

console.log("");
const PMC = ask(
  "May the postmaster create tickets without asking (yes/no)",
  "no",
  "postmaster_may_create",
  opts,
);
if (PMC !== "yes" && PMC !== "no") die("setup: answer yes or no", 1);
const RT = ask(
  "Seconds a review round may run before the reviewers still running are stopped",
  "2400",
  "round_timeout_seconds",
  opts,
);
// BASE matched 1 to 5 digits with no leading zero, else refused: '0600' is not a number it takes.
const rtNum = /^[1-9][0-9]{0,4}$/u.test(RT) ? parseInt(RT, 10) : 0;
if (rtNum < 1 || rtNum > 86400) {
  die("setup: round_timeout_seconds must be a whole number of seconds from 1 to 86400", 1);
}
const MA = ask("Who says the merge word (user, postmaster)", "user", "merge_authority", opts);
if (MA !== "user" && MA !== "postmaster")
  die("setup: merge authority must be user or postmaster", 1);
const CPM = ask("Checkpoint mode (autonomous, consult)", "autonomous", "checkpoint_mode", opts);
if (CPM !== "autonomous" && CPM !== "consult")
  die("setup: checkpoint mode must be autonomous or consult", 1);
const RL = ask(
  "Review link template with {path} for the synthesis worktree (blank for none)",
  "",
  "review_link?",
  opts,
);
const PRL = ask(
  "Code-server link template with {path} for a workhorse spec (blank for none)",
  "",
  "planning.review_link?",
  opts,
);
if (PRL && !PRL.includes("{path}")) die("setup: planning.review_link must contain {path}", 1);

let TRACKER_EXTRA = "";
if (PWS) TRACKER_EXTRA = `url = "${PURL}"\nworkspace = "${PWS}"\nenv_file = "${PENV}"`;
if (OTHER) TRACKER_EXTRA = `name = "${OTHER}"`;

const dateStr = new Date().toISOString().slice(0, 10);
// The list of settings matches the questions: the limit table appears only
// where setup asked for it.
const LIMITS_BLOCK = onLinux
  ? `[limits]\nmemory_max = "${LM}"\ntasks_max = ${LT}\n${LIMIT_ROLE_TABLES}\n`
  : "";
const OUT = `# Written by scripts/run setup on ${dateStr}. Shape: config.example.toml.
projects_roots = ${tomlList(ROOTS)}
confine = "${CONFINE}"
${LANE_BLOCKS}

[team]
workhorses = ${tomlList(WORKHORSES)}
reviewers = ${tomlList(REVIEWERS)}
coachman = { harness = "${CH}", model = "${CM}"${roleExtra(CE, CEF)} }
coachman_fallback = { harness = "${FH}", model = "${FM}"${roleExtra(FE, FEF)} }
postmaster = { harness = "${PH}", model = "${PM}"${roleExtra(PE, PEF)} }
max_runs = ${MR}
${LENS_TABLE}

${LIMITS_BLOCK}[postmaster]
poll_seconds = ${PS}

[tracker]
kind = "${TK}"
${TRACKER_EXTRA}
postmaster_may_create = ${PMC === "yes" ? "true" : "false"}

[review]
round_timeout_seconds = ${RT}

[planning]
review_link = "${PRL}"

[ship]
merge_authority = "${MA}"
checkpoint_mode = "${CPM}"
review_link = "${RL}"
`;

if (DRY === 1) {
  console.log(OUT.replace(/\n+$/u, ""));
  process.exit(0);
}
if (existsSync(CONFIG)) {
  const OW = ask(`${CONFIG} exists; overwrite (yes/no)`, "no", "overwrite", opts);
  if (OW !== "yes") die(`setup: left ${CONFIG} as it was`, 1);
}
mkdirSync(dirname(CONFIG), { recursive: true });
// BASE's $(heredoc) stripped trailing newlines and printf '%s\n' added exactly one back.
writeFileSync(CONFIG, `${OUT.replace(/\n+$/u, "")}\n`, "utf8");
// parse back as TOML
try {
  readTomlFile(CONFIG);
} catch {
  die(`setup: ${CONFIG} does not parse as TOML; fix it before running anything`, 1);
}
const rev = run(join(HERE, "run"), ["reviewers", "lines", "--config", CONFIG]);
if (rev.code !== 0) {
  die(`setup: the reviewer lanes in ${CONFIG} do not resolve; fix them before running anything`, 1);
}
console.log(`wrote ${CONFIG} (parsed back as TOML)`);
process.exit(0);
