// Set this machine up: probe the agent CLIs, ask which harness and model fills each role, how
// tickets are tracked, whether lanes run confined, where projects live and who says the merge word, then write
// ~/.postmaster/config.toml in the shape of config.example.toml. With --project, write one
// project's own settings instead: only the answered keys land in
// <repo>/.postmaster/settings.toml, and an unanswered key keeps the global value.
//
//   run setup [--answers <file>] [--dry-run] [--config <path>]
//   run setup --project <repo> [--answers <file>] [--dry-run]
//   run setup --keys
//
// An agent drives it: the user's answers go in a file, one key=value per line (--keys
// lists them with their prompts and defaults), and --answers reads them by name, so the order
// of the questions never matters. A missing key takes its default and a key with no default
// is an error naming it. Without --answers the questions are asked on stdin one at a time, so
// a person can drive it too. --dry-run prints the config instead of writing it. In project
// mode a key the user did not answer is left unset, so the file holds only what the user
// changed; projects_roots is refused there, since it always comes from the global config,
// and ignore_settings=yes has git ignore the settings file, on the user's yes alone.
//
//   exit 0  config written (or printed), or keys listed
//   exit 1  a harness was named that is not on PATH, the coachman shares a lane's model, fewer
//           than two lanes were given, a reviewer is not a lane, an answer was missing, a round
//           time limit was not a whole number of seconds from 1 to 86400, a planning review link
//           omitted {path}, a mode other than synthesis, single-thread or alternate, or an
//           existing config was not overwritten
//
// Control: the written file is parsed back as TOML where a parser is available, and its reviewer
// lanes are resolved through scripts/run reviewers, so a config that would fail to load is never
// left on disk as if it were fine. Project mode resolves them through the project's
// effective config and restores the previous file when they do not resolve.
import { existsSync, mkdirSync, readFileSync, readSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  checkLaneEntry,
  coachmanModelProblem,
  harnessProblem,
  laneCountProblem,
  reviewerProblem,
  roleModel,
} from "./lib/config-check.ts";
import { readTomlFile } from "./lib/data.ts";
import {
  asTable,
  atomicWriteFileSync,
  effectiveConfig,
  ensureIgnore,
  globalConfigPath,
  ignoreSettings,
  isDie,
  isFile,
  isSymlink,
  loadMachine,
  parseTomlStrict,
  pendingNoticeFor,
  type Rec,
  repoTopLevel,
  settingsDir,
  settingsIgnored,
} from "./lib/effective-config.ts";
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

function validTasks(v: string): boolean {
  if (!/^[1-9][0-9]*$/u.test(v)) return false;
  return v.length <= 10 && Number(v) <= 2147483647;
}

function recOf(v: unknown): Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Rec) : {};
}

function splitList(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x !== "");
}

function roleLine(name: string, h: string, m: string, e: string, ef: string): string | null {
  const parts: string[] = [];
  if (h !== "") parts.push(`harness = "${h}"`);
  if (m !== "") parts.push(`model = "${m}"`);
  if (e !== "") parts.push(`effort = "${e}"`);
  if (ef !== "") parts.push(`env_file = "${ef}"`);
  return parts.length > 0 ? `${name} = { ${parts.join(", ")} }` : null;
}

function needHarness(h: string): void {
  const problem = harnessProblem(h);
  if (problem !== null) die(problem, 1);
}

interface AskOpts {
  answers: string;
}

// In project mode, the keys the user answered: only those land in the file.
const GIVEN = new Set<string>();

// Project mode's repo, from --project; empty means the global config.
let PROJECT = "";

// read one line from stdin synchronously, byte by byte like read -r: a
// chunked read would swallow every line a pipe already holds
function readStdinLine(): string {
  try {
    const bytes: number[] = [];
    const one = Buffer.alloc(1);
    for (;;) {
      const n = readSync(0, one, 0, 1, null);
      if (n === 0 || one[0] === 10) break;
      if (one[0] !== 13) bytes.push(one[0] as number);
    }
    return new TextDecoder().decode(new Uint8Array(bytes));
  } catch {
    return "";
  }
}

function ask(prompt: string, def: string, key: string, opts: AskOpts): string {
  let k = key;
  let optional = false;
  if (k.endsWith("?")) {
    optional = true;
    k = k.slice(0, -1);
  }
  if (PROJECT !== "") return askProject(prompt, def, k, optional, opts);
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
    const line = readStdinLine();
    if (def !== "") console.log("");
    if (line === "") answer = def;
    else answer = line;
  }
  return answer;
}

// Project mode: an unanswered key stays unset and keeps the global value, so
// nothing here falls back to a default. A blank answer is unset too, except
// the two link keys, where a present blank clears the global link.
function askProject(
  prompt: string,
  def: string,
  k: string,
  optional: boolean,
  opts: AskOpts,
): string {
  if (opts.answers !== "") {
    let found: string | undefined;
    try {
      const text = readFileSync(opts.answers, "utf8");
      for (const line of text.split("\n")) {
        if (line.startsWith(`${k}=`)) {
          found = line.slice(k.length + 1);
          break;
        }
      }
    } catch {
      /* fall through */
    }
    if (found === undefined) {
      console.log(`${prompt}: (not set)`);
      return "";
    }
    if (found === "") {
      if (blankLinkClear(k, optional)) {
        GIVEN.add(k);
        console.log(`${prompt}: (cleared)`);
        return "";
      }
      console.log(`${prompt}: (not set)`);
      return "";
    }
    GIVEN.add(k);
    console.log(`${prompt}: ${found}`);
    return found;
  }
  // interactive: a blank line leaves the setting unset; nothing is required,
  // and the setup default is only a hint, never taken silently.
  const hint =
    def !== "" ? ` (blank leaves it unset; setup default: ${def})` : " (blank leaves it unset)";
  process.stderr.write(`${prompt}${hint}: `);
  const line = readStdinLine();
  if (line === "") {
    if (blankLinkClear(k, optional)) GIVEN.add(k);
    return "";
  }
  GIVEN.add(k);
  return line;
}

// blankLinkClear <k> <optional>: a blank link answer clears the key it names,
// on either input path, so an explicit none wins over an inherited link.
function blankLinkClear(k: string, optional: boolean): boolean {
  return optional && (k === "review_link" || k === "planning.review_link");
}

// Lane names implied by lane.* answers, for the scaffolding when `lanes` is
// not answered: unioned with the named set, never replacing it.
function impliedLanes(answersFile: string): string[] {
  if (answersFile === "") return [];
  let text = "";
  try {
    text = readFileSync(answersFile, "utf8");
  } catch {
    return [];
  }
  const names: string[] = [];
  for (const line of text.split("\n")) {
    const m = /^lane\.([^.=]+)\./u.exec(line);
    if (m && m[1] !== undefined && !names.includes(m[1])) names.push(m[1]);
  }
  return names.sort();
}

function hasKey(file: string, key: string): boolean {
  try {
    const text = readFileSync(file, "utf8");
    return text.split("\n").some((l) => l.startsWith(`${key}=`));
  } catch {
    return false;
  }
}

// --- project merge -------------------------------------------------------------------------------
// A second setup run merges its answers into the existing file instead of
// replacing it, so the settings grow over several runs. Both sides parse to
// objects and merge by the precedence rule: a table merges setting by
// setting, a list or a single value is replaced whole. Comments do not
// survive a rewrite; the data does.
function isTomlTable(v: unknown): v is Rec {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

// mergeTables <base> <overlay>: the overlay's keys over the base's, tables
// merging recursively and every other value replaced whole. Fresh objects
// throughout, built without indexed assignment, so a `__proto__` key in a
// hand-edited file stays data.
function mergeTables(base: Rec, overlay: Rec): Rec {
  const over = Object.entries(overlay).map(([k, v]) => {
    const bv = Object.hasOwn(base, k) ? base[k] : undefined;
    return [k, isTomlTable(bv) && isTomlTable(v) ? mergeTables(bv, v) : v] as const;
  });
  return { ...base, ...Object.fromEntries(over) };
}

// Report whether git ignores the settings from git itself, not from the
// answer: an older rule can keep the file ignored after a no, and a tracked
// file stays shared after a yes. Either mismatch says so.
function reportIgnored(answer: string): void {
  const ignored = settingsIgnored(PROJECT_ROOT);
  console.log(`settings ignored: ${ignored ? "yes" : "no"}`);
  if (answer === "no" && ignored) {
    console.log(
      "setup: note: an existing ignore rule covers the settings file, although the answer was no; remove it from .postmaster/.gitignore to share them",
    );
  }
  if (answer === "yes" && !ignored) {
    console.log(
      "setup: note: git still does not ignore the settings file, although the answer was yes",
    );
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
let CONFIG = globalConfigPath();
let ADD_CLERK = false;
let i = 0;
while (i < argv.length) {
  const a = argv[i];
  if (a === "--add-clerk") {
    ADD_CLERK = true;
  } else if (a === "--dry-run") {
    DRY = 1;
  } else if (a === "--config") {
    const v = argv[++i];
    if (!v) die("--config needs a path", 1);
    CONFIG = v;
  } else if (a === "--project") {
    const v = argv[++i];
    if (!v) die("--project needs a repo", 1);
    PROJECT = v;
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
clerk.harness
clerk.model
clerk.effort?              (none)
clerk.env_file?            (none)             env file for its key or backend
max_runs                   2                  concurrent runs per project
mode                       synthesis          dispatch mode: synthesis, single-thread or alternate
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
planning.review_link?      (none)             code-server template with {path} for ticket drafts
overwrite                  no                 yes replaces an existing config
ignore_settings            no                 project only: yes has git ignore the settings file
project mode (--project <repo>): writes only answered keys; projects_roots is refused there`);
    process.exit(0);
  } else {
    console.error(
      "usage: run setup [--answers <file>] [--dry-run] [--config <path>] | --project <repo> [--answers <file>] [--dry-run] | --add-clerk [options] | --keys",
    );
    process.exit(1);
  }
  i++;
}

if (PROJECT !== "" && ADD_CLERK) die("setup: --project and --add-clerk do not combine", 1);
if (PROJECT !== "" && CONFIG !== globalConfigPath()) {
  die("setup: --config and --project do not combine", 1);
}

const opts: AskOpts = { answers: ANSWERS };

if (ADD_CLERK) {
  if (!existsSync(CONFIG)) die(`setup: no config at ${CONFIG}; run normal setup first`, 1);
  let original = "";
  let parsed: Record<string, unknown>;
  try {
    original = readFileSync(CONFIG, "utf8");
    parsed = readTomlFile(CONFIG);
  } catch {
    die(`setup: ${CONFIG} does not parse`, 1);
  }
  const team = parsed!.team;
  if (!team || typeof team !== "object" || Array.isArray(team))
    die(`setup: [team] is missing in ${CONFIG}`, 1);
  if ((team as Record<string, unknown>).clerk !== undefined)
    die(`setup: ${CONFIG} already has team.clerk`, 1);
  console.log("== The booking clerk: prepares a ticket with the user. ==");
  const harness = ask("  clerk: harness", "", "clerk.harness", opts);
  needHarness(harness);
  const model = ask("  clerk: model id", "", "clerk.model", opts);
  const effort = ask("  clerk: effort (blank if none)", "", "clerk.effort?", opts);
  const envFile = ask(
    "  clerk: env file for its key or backend (blank if none)",
    "",
    "clerk.env_file?",
    opts,
  );
  const entry = `clerk = { harness = "${harness}", model = "${model}"${roleExtra(effort, envFile)} }`;
  const header = /^\[team\][ \t]*(?:#.*)?(?:\r?\n|$)/mu.exec(original);
  if (!header) die(`setup: ${CONFIG} has no [team] table`, 1);
  const start = header.index + header[0].length;
  const next = /^\[[^\n]+\][^\n]*(?:\r?\n|$)/mu.exec(original.slice(start));
  const end = next ? start + next.index : original.length;
  let before = original.slice(0, end);
  if (before && !before.endsWith("\n")) before += "\n";
  const changed = `${before}${entry}\n${original.slice(end)}`;
  if (DRY) {
    console.log(changed.replace(/\n+$/u, ""));
    process.exit(0);
  }
  writeFileSync(CONFIG, changed, "utf8");
  try {
    const reread = readTomlFile(CONFIG) as {
      team?: { clerk?: { harness?: unknown; model?: unknown } };
    };
    if (reread.team?.clerk?.harness !== harness || reread.team?.clerk?.model !== model)
      throw new Error("mismatch");
  } catch {
    writeFileSync(CONFIG, original, "utf8");
    die(`setup: ${CONFIG} did not parse after adding team.clerk; restored the original`, 1);
  }
  console.log(`updated ${CONFIG}; every previous line is preserved`);
  process.exit(0);
}

// Project mode's repo, settings file and global base, read once up front.
const PROJECT_ROOT = PROJECT !== "" ? repoTopLevel(PROJECT) || PROJECT : "";
const PROJECT_SETTINGS = PROJECT !== "" ? join(PROJECT_ROOT, ".postmaster", "settings.toml") : "";
let MACHINE: Rec = {};
if (PROJECT !== "") {
  if (!existsSync(PROJECT)) die(`setup: no such project: ${PROJECT}`, 1);
  const globalPath = globalConfigPath();
  if (existsSync(globalPath)) {
    try {
      MACHINE = loadMachine(globalPath);
    } catch (e) {
      die(
        `setup: cannot read the global config at ${globalPath}${isDie(e) ? `: ${e.message}` : ""}`,
        1,
      );
    }
  }
}
const MACHINE_LANES = recOf(MACHINE.lanes);
const MACHINE_TRACKER = recOf(MACHINE.tracker);
const MACHINE_TRACKER_KIND = typeof MACHINE_TRACKER.kind === "string" ? MACHINE_TRACKER.kind : "";
const MACHINE_TRACKER_WS =
  typeof MACHINE_TRACKER.workspace === "string" ? MACHINE_TRACKER.workspace : "";

// The existing file, read before the questions: the guard fails fast on a
// path no write may touch, and its lanes and tracker join the prechecks, so
// a second run answers against what is already set.
let PROJECT_BACKUP: string | null = null;
let EXISTING: Rec = {};
if (PROJECT !== "") {
  settingsDir(PROJECT_ROOT);
  if (isSymlink(PROJECT_SETTINGS)) die(`setup: ${PROJECT_SETTINGS} must not be a symlink`, 1);
  if (existsSync(PROJECT_SETTINGS) && !isFile(PROJECT_SETTINGS))
    die(`setup: ${PROJECT_SETTINGS} is not a regular file`, 1);
  if (existsSync(PROJECT_SETTINGS)) {
    PROJECT_BACKUP = readFileSync(PROJECT_SETTINGS, "utf8");
    try {
      EXISTING = Bun.TOML.parse(PROJECT_BACKUP);
    } catch (e) {
      die(
        `setup: the existing ${PROJECT_SETTINGS} does not parse: ${String(e)}; fix or remove it before setting more`,
        1,
      );
    }
  }
}
const EXISTING_LANES = recOf(EXISTING.lanes);
const EXISTING_TRACKER = recOf(EXISTING.tracker);
const EXISTING_TRACKER_KIND =
  typeof EXISTING_TRACKER.kind === "string" ? EXISTING_TRACKER.kind : "";
const EXISTING_TRACKER_WS =
  typeof EXISTING_TRACKER.workspace === "string" ? EXISTING_TRACKER.workspace : "";

if (PROJECT === "") {
  console.log("== Installed agent CLIs ==");
  const probe = run(join(HERE, "run"), ["probe-harnesses"]);
  process.stdout.write(probe.out);
  process.stderr.write(probe.err);
  console.log("");
}

if (PROJECT !== "" && ANSWERS !== "" && hasKey(ANSWERS, "projects_roots")) {
  die(
    "setup: projects_roots always comes from the global config; it cannot be set for one project",
    1,
  );
}
const ROOTS =
  PROJECT !== ""
    ? ""
    : ask("Where do projects live (comma separated)", "~/Code", "projects_roots", opts);

console.log("");
console.log(
  "== The horses: lanes that implement a ticket. At least two, from different vendors. ==",
);
const LANES = ask(
  PROJECT !== ""
    ? "Lane names to set, comma separated (blank for none)"
    : "Lane names, comma separated",
  PROJECT !== "" ? "" : "alpha, beta",
  "lanes",
  opts,
);
const laneList = LANES.split(",")
  .map((x) => x.trim())
  .filter((x) => x !== "");
// Project mode asks about the named lanes plus any lane.* answers name; the
// merged set, global lanes and the existing file's lanes with these, is what
// every list below resolves to.
const laneSet =
  PROJECT !== ""
    ? [...laneList, ...impliedLanes(ANSWERS).filter((n) => !laneList.includes(n))]
    : laneList;
const MERGED_NAMES =
  PROJECT !== ""
    ? [
        ...Object.keys(MACHINE_LANES),
        ...Object.keys(EXISTING_LANES).filter((n) => !Object.hasOwn(MACHINE_LANES, n)),
        ...laneSet.filter(
          (n) => !Object.hasOwn(MACHINE_LANES, n) && !Object.hasOwn(EXISTING_LANES, n),
        ),
      ]
    : laneList;
const MERGED_TEXT = MERGED_NAMES.join(", ");
if (PROJECT === "") {
  const laneIssue = laneCountProblem(laneList);
  if (laneIssue !== null) die(laneIssue, 1);
}
// Project mode judges the lane count on the merged result in the tail: answers
// are partial by design, and only the merged set can be counted.
let LANE_BLOCKS = "";
const LANE_MODELS: string[] = [];
const LANE_HARNESSES: string[] = [];
const LANE_VALS: Record<string, { h: string; m: string; e: string; ef: string }> = {};
for (const lane of laneSet) {
  const h = ask(
    `  ${lane}: harness (codex, grok, agy, claude, muse, mimo, pi)`,
    "",
    `lane.${lane}.harness`,
    opts,
  );
  if (PROJECT === "" || h !== "") needHarness(h);
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
  LANE_VALS[lane] = { h, m, e, ef };
}

console.log("");
const WORKHORSES = ask(
  "Workhorse lanes, comma separated",
  PROJECT !== "" ? "" : LANES,
  "workhorses",
  opts,
);
if (PROJECT === "" || WORKHORSES !== "") {
  for (const a of WORKHORSES.split(",")
    .map((x) => x.trim())
    .filter((x) => x !== "")) {
    if (!MERGED_NAMES.includes(a))
      die(`setup: workhorse '${a}' is not one of the lanes (${MERGED_TEXT})`, 1);
  }
  if (
    WORKHORSES.split(",")
      .map((x) => x.trim())
      .filter((x) => x !== "").length < 2
  ) {
    die("setup: at least two workhorses are needed", 1);
  }
}
const REVIEWERS = ask(
  "Reviewer lanes, comma separated",
  PROJECT !== "" ? "" : WORKHORSES,
  "reviewers",
  opts,
);
for (const rv of REVIEWERS.split(",")
  .map((x) => x.trim())
  .filter((x) => x !== "")) {
  const reviewerIssue = reviewerProblem(rv, MERGED_NAMES, MERGED_TEXT);
  if (reviewerIssue !== null) die(reviewerIssue, 1);
}
let LENS_TABLE = "";
const LENS_VALS: Record<string, string> = {};
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
    const lensIssue = reviewerProblem(rv, MERGED_NAMES, MERGED_TEXT, lens);
    if (lensIssue !== null) die(lensIssue, 1);
  }
  LENS_TABLE += `${lens} = ${tomlList(LR)}\n`;
  LENS_VALS[lens] = LR;
}
if (LENS_TABLE) LENS_TABLE = `\n[team.lens_reviewers]\n${LENS_TABLE}`;

if (PROJECT === "") {
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
      console.log(
        `setup: bug reviewer '${reviewer}' uses ${harness}, which has no code-review form`,
      );
    }
  }
  if (BUG_REVIEWABLE === 0) {
    console.log(
      "setup: warning: no configured bug reviewer has a code-review form; runs whose turnpikes include bug review will be refused at pre-flight",
    );
  }
}

console.log("");
console.log(
  "== The coachman: judges the lanes and runs the review rounds. Never a lane's model. ==",
);
const CH = ask("  coachman: harness", "", "coachman.harness", opts);
if (PROJECT === "" || CH !== "") needHarness(CH);
const CM = ask("  coachman: model id", "", "coachman.model", opts);
if (PROJECT === "") {
  const coachmanIssue = coachmanModelProblem(CM, LANE_MODELS, "the coachman");
  if (coachmanIssue !== null) die(coachmanIssue, 1);
}
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
if (PROJECT === "" || FH !== "") needHarness(FH);
const FM = ask("  fallback: model id", "", "fallback.model", opts);
if (PROJECT === "") {
  const fallbackIssue = coachmanModelProblem(FM, LANE_MODELS, "the fallback coachman");
  if (fallbackIssue !== null) die(fallbackIssue, 1);
}
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
if (PROJECT === "" || PH !== "") needHarness(PH);
const PM = ask("  postmaster: model id", "", "postmaster.model", opts);
const PE = ask("  postmaster: effort (blank if none)", "", "postmaster.effort?", opts);
const PEF = ask(
  "  postmaster: env file for its key or backend (blank if none)",
  "",
  "postmaster.env_file?",
  opts,
);
console.log("");
console.log("== The booking clerk: prepares tickets with the user. ==");
const CLH = ask("  clerk: harness", "", "clerk.harness", opts);
if (PROJECT === "" || CLH !== "") needHarness(CLH);
const CLM = ask("  clerk: model id", "", "clerk.model", opts);
const CLE = ask("  clerk: effort (blank if none)", "", "clerk.effort?", opts);
const CLEF = ask(
  "  clerk: env file for its key or backend (blank if none)",
  "",
  "clerk.env_file?",
  opts,
);
const MR = ask("  concurrent runs per project", PROJECT !== "" ? "" : "2", "max_runs", opts);
const MODE = ask(
  "  dispatch mode (synthesis, single-thread or alternate)",
  PROJECT !== "" ? "" : "synthesis",
  "mode",
  opts,
);
if (MODE !== "" && MODE !== "synthesis" && MODE !== "single-thread" && MODE !== "alternate") {
  die(`setup: mode must be synthesis, single-thread or alternate, not ${MODE}`, 1);
}
const PS = ask(
  "  postmaster poll interval, seconds",
  PROJECT !== "" ? "" : "120",
  "poll_seconds",
  opts,
);

console.log("");
let LM = PROJECT !== "" ? "" : "8G";
let LT = PROJECT !== "" ? "" : "512";
let LIMIT_ROLE_TABLES = "";
if (onLinux) {
  console.log(
    "== Launch limits: per-launch memory and process caps when the host supports them. ==",
  );
  LM = ask(
    "  default memory cap (number plus K, M, G or T)",
    PROJECT !== "" ? "" : "8G",
    "limits.memory_max",
    opts,
  );
  if (LM !== "" && !/^[1-9][0-9]*[KMGT]$/u.test(LM))
    die("setup: memory_max must be a positive whole number followed by K, M, G or T", 1);
  LT = ask(
    "  default process cap (whole number)",
    PROJECT !== "" ? "" : "512",
    "limits.tasks_max",
    opts,
  );
  if (LT !== "" && !validTasks(LT))
    die("setup: tasks_max must be a whole number from 1 to 2147483647", 1);
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
const TK = ask(
  "How are tickets tracked (github, plane, local, other)",
  PROJECT !== "" ? "" : "github",
  "tracker",
  opts,
);
let PURL = "",
  PWS = "",
  PENV = "",
  OTHER = "";
const MERGED_KIND =
  TK !== "" ? TK : EXISTING_TRACKER_KIND !== "" ? EXISTING_TRACKER_KIND : MACHINE_TRACKER_KIND;
if (TK === "plane" || (PROJECT !== "" && (ANSWERS !== "" || MERGED_KIND === "plane"))) {
  PURL = ask(
    "  Plane API origin (https://api.plane.so for cloud; a self-hosted instance is its own)",
    PROJECT !== "" ? "" : "https://api.plane.so",
    "plane.url",
    opts,
  );
  PWS = ask(
    "  workspace slug (the segment after the host in the workspace's web URL)",
    "",
    "plane.workspace",
    opts,
  );
  if (PROJECT === "") {
    if (!PWS) die("setup: a Plane workspace slug is needed", 1);
  } else {
    const mergedWs =
      PWS !== "" ? PWS : MACHINE_TRACKER_WS !== "" ? MACHINE_TRACKER_WS : EXISTING_TRACKER_WS;
    if (MERGED_KIND === "plane" && mergedWs === "")
      die("setup: a Plane workspace slug is needed", 1);
  }
  PENV = ask(
    "  file holding PLANE_API_KEY=<key>, written by you, never pasted here",
    PROJECT !== "" ? "" : "~/.postmaster/plane.env",
    "plane.env_file",
    opts,
  );
}
if (TK === "other" || (PROJECT !== "" && (ANSWERS !== "" || MERGED_KIND === "other"))) {
  OTHER = ask(
    "  tracker name (then describe it in ~/.postmaster/trackers/<name>.md)",
    "",
    "tracker.name",
    opts,
  );
}
if (TK !== "" && TK !== "github" && TK !== "plane" && TK !== "local" && TK !== "other") {
  die("setup: tracker kind must be github, plane, local or other", 1);
}

console.log("");
console.log("== Lane confinement: sandbox-runtime wraps each lane's harness. ==");
if (PROJECT === "") {
  const confineProbe = run(join(HERE, "run"), ["probe-confine"]);
  if (confineProbe.code !== 0)
    die("setup: probe-confine failed; fix it before choosing confinement", 1);
  process.stdout.write(confineProbe.out);
  process.stderr.write(confineProbe.err);
}
const CONFINE = ask("Run lanes confined (on/off)", PROJECT !== "" ? "" : "off", "confine", opts);
if (CONFINE !== "" && CONFINE !== "on" && CONFINE !== "off")
  die("setup: confine must be on or off", 1);
if (PROJECT !== "" && CONFINE !== "") {
  const confineProbe = run(join(HERE, "run"), ["probe-confine"]);
  if (confineProbe.code !== 0)
    die("setup: probe-confine failed; fix it before choosing confinement", 1);
  process.stdout.write(confineProbe.out);
  process.stderr.write(confineProbe.err);
}
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
  PROJECT !== "" ? "" : "no",
  "postmaster_may_create",
  opts,
);
if (PMC !== "" && PMC !== "yes" && PMC !== "no") die("setup: answer yes or no", 1);
const RT = ask(
  "Seconds a review round may run before the reviewers still running are stopped",
  PROJECT !== "" ? "" : "2400",
  "round_timeout_seconds",
  opts,
);
if (RT !== "") {
  // BASE matched 1 to 5 digits with no leading zero, else refused: '0600' is not a number it takes.
  const rtNum = /^[1-9][0-9]{0,4}$/u.test(RT) ? parseInt(RT, 10) : 0;
  if (rtNum < 1 || rtNum > 86400) {
    die("setup: round_timeout_seconds must be a whole number of seconds from 1 to 86400", 1);
  }
}
const MA = ask(
  "Who says the merge word (user, postmaster)",
  PROJECT !== "" ? "" : "user",
  "merge_authority",
  opts,
);
if (MA !== "" && MA !== "user" && MA !== "postmaster")
  die("setup: merge authority must be user or postmaster", 1);
const CPM = ask(
  "Checkpoint mode (autonomous, consult)",
  PROJECT !== "" ? "" : "autonomous",
  "checkpoint_mode",
  opts,
);
if (CPM !== "" && CPM !== "autonomous" && CPM !== "consult")
  die("setup: checkpoint mode must be autonomous or consult", 1);
const RL = ask(
  "Review link template with {path} for the synthesis worktree (blank for none)",
  "",
  "review_link?",
  opts,
);
const PRL = ask(
  "Code-server link template with {path} for a ticket draft (blank for none)",
  "",
  "planning.review_link?",
  opts,
);
if (PRL && !PRL.includes("{path}")) die("setup: planning.review_link must contain {path}", 1);

let TRACKER_EXTRA = "";
if (PWS) TRACKER_EXTRA = `url = "${PURL}"\nworkspace = "${PWS}"\nenv_file = "${PENV}"`;
if (OTHER) TRACKER_EXTRA = `name = "${OTHER}"`;

if (PROJECT !== "") {
  const IGNORE_RAW = ask(
    "Have git ignore the project's settings (yes/no)",
    "no",
    "ignore_settings",
    opts,
  );
  const IGNORE = IGNORE_RAW === "" ? "no" : IGNORE_RAW;
  if (IGNORE !== "yes" && IGNORE !== "no") die("setup: answer yes or no", 1);

  // Emission: only the answered keys land in the file.
  const sections: string[] = [];
  if (CONFINE !== "") sections.push(`confine = "${CONFINE}"\n`);
  for (const lane of laneSet) {
    const v = LANE_VALS[lane];
    if (!v) continue;
    const parts: string[] = [];
    if (v.h !== "") parts.push(`harness = "${v.h}"`);
    if (v.m !== "") parts.push(`model = "${v.m}"`);
    if (v.e !== "") parts.push(`effort = "${v.e}"`);
    if (v.ef !== "") parts.push(`env_file = "${v.ef}"`);
    if (parts.length > 0) sections.push(`[lanes.${lane}]\n${parts.join("\n")}\n`);
  }
  const teamParts: string[] = [];
  if (WORKHORSES !== "") teamParts.push(`workhorses = ${tomlList(WORKHORSES)}`);
  if (REVIEWERS !== "") teamParts.push(`reviewers = ${tomlList(REVIEWERS)}`);
  for (const entry of [
    roleLine("coachman", CH, CM, CE, CEF),
    roleLine("coachman_fallback", FH, FM, FE, FEF),
    roleLine("postmaster", PH, PM, PE, PEF),
    roleLine("clerk", CLH, CLM, CLE, CLEF),
  ]) {
    if (entry !== null) teamParts.push(entry);
  }
  if (MR !== "") teamParts.push(`max_runs = ${MR}`);
  if (MODE !== "") teamParts.push(`mode = "${MODE}"`);
  if (teamParts.length > 0) sections.push(`[team]\n${teamParts.join("\n")}\n`);
  if (LENS_TABLE !== "") sections.push(`${LENS_TABLE.replace(/^\n/u, "")}\n`);
  let limitsSec = "";
  if (LM !== "" || LT !== "") {
    limitsSec = "[limits]\n";
    if (LM !== "") limitsSec += `memory_max = "${LM}"\n`;
    if (LT !== "") limitsSec += `tasks_max = ${LT}\n`;
  }
  limitsSec += LIMIT_ROLE_TABLES.replace(/^\n/u, "");
  if (limitsSec !== "") sections.push(limitsSec.endsWith("\n") ? limitsSec : `${limitsSec}\n`);
  const trackerParts: string[] = [];
  if (TK !== "") trackerParts.push(`kind = "${TK}"`);
  if (PURL !== "") trackerParts.push(`url = "${PURL}"`);
  if (PWS !== "") trackerParts.push(`workspace = "${PWS}"`);
  if (PENV !== "") trackerParts.push(`env_file = "${PENV}"`);
  if (OTHER !== "") trackerParts.push(`name = "${OTHER}"`);
  if (PMC !== "") trackerParts.push(`postmaster_may_create = ${PMC === "yes" ? "true" : "false"}`);
  if (trackerParts.length > 0) sections.push(`[tracker]\n${trackerParts.join("\n")}\n`);
  if (PS !== "") sections.push(`[postmaster]\npoll_seconds = ${PS}\n`);
  if (RT !== "") sections.push(`[review]\nround_timeout_seconds = ${RT}\n`);
  if (GIVEN.has("planning.review_link")) sections.push(`[planning]\nreview_link = "${PRL}"\n`);
  const shipParts: string[] = [];
  if (MA !== "") shipParts.push(`merge_authority = "${MA}"`);
  if (CPM !== "") shipParts.push(`checkpoint_mode = "${CPM}"`);
  if (GIVEN.has("review_link")) shipParts.push(`review_link = "${RL}"`);
  if (shipParts.length > 0) sections.push(`[ship]\n${shipParts.join("\n")}\n`);

  if (sections.length === 0) {
    if (IGNORE === "yes" && existsSync(PROJECT_SETTINGS)) {
      if (DRY === 1) {
        console.log("settings ignored: yes");
        process.exit(0);
      }
      try {
        ignoreSettings(PROJECT_ROOT);
      } catch (e) {
        die(`setup: cannot set the ignore rules${isDie(e) ? `: ${e.message}` : ""}`, 1);
      }
      reportIgnored(IGNORE);
      process.exit(0);
    }
    die("setup: no project settings given", 1);
  }
  const OUT = sections.join("\n");

  // This run's answers over the existing file, read up front, so the
  // settings grow over several runs; a first run writes its answers alone.
  // Both sides parse and merge as objects, and the file is rewritten whole,
  // so comments do not survive it.
  const backup = PROJECT_BACKUP;
  let answers: Rec = {};
  try {
    answers = Bun.TOML.parse(OUT);
  } catch (e) {
    die(`setup: this run's answers do not form valid TOML: ${String(e)}`, 1);
  }
  const fileText = Bun.TOML.stringify(backup === null ? answers : mergeTables(EXISTING, answers));

  // The merged view, global with the file as written: every list below
  // resolves against it, as the readers will read it. The shared file never
  // merges, so it is not loaded.
  let merged: Rec;
  try {
    const candidate = asTable(parseTomlStrict(fileText, "project settings"), "project settings");
    merged = effectiveConfig(PROJECT_ROOT, MACHINE, { shared: {}, local: candidate });
  } catch (e) {
    if (isDie(e)) die(`setup: ${e.message}`, 1);
    throw e;
  }
  const mergedLanes = recOf(merged.lanes);
  const mergedNames = Object.keys(mergedLanes);
  const mergedIssue = laneCountProblem(mergedNames);
  if (mergedIssue !== null) die(mergedIssue, 1);
  // Each lane this run touches must read complete once merged: a new lane
  // with a model but no harness, or the reverse, is refused here, not left
  // for check-setup to report after a file claimed success.
  for (const name of laneSet) {
    const touched = LANE_VALS[name];
    if (touched.h === "" && touched.m === "" && touched.e === "" && touched.ef === "") continue;
    for (const p of checkLaneEntry(name, mergedLanes[name]).problems) die(p, 1);
  }
  const mergedTeam = recOf(merged.team);
  // A postmaster this run touches must read complete once merged, as
  // check-setup requires a harness and a model; a half entry is refused here.
  const touchedPostmaster = ["harness", "model", "effort", "env_file"].some((part) =>
    GIVEN.has(`postmaster.${part}`),
  );
  if (touchedPostmaster) {
    const mergedPostmaster = recOf(mergedTeam.postmaster);
    const pmHarness = mergedPostmaster.harness;
    const pmModel = mergedPostmaster.model;
    if (
      typeof pmHarness !== "string" ||
      pmHarness.trim() === "" ||
      typeof pmModel !== "string" ||
      pmModel.trim() === ""
    ) {
      die("setup: team.postmaster needs a harness and a model; answer both or neither", 1);
    }
  }
  const laneModels: string[] = [];
  for (const name of mergedNames) {
    const model = recOf(mergedLanes[name]).model;
    if (typeof model === "string" && model !== "") laneModels.push(model);
  }
  const mergedCoachman = roleModel(mergedTeam.coachman);
  if (mergedCoachman !== null) {
    const p = coachmanModelProblem(mergedCoachman, laneModels, "the coachman");
    if (p !== null) die(p, 1);
  }
  const mergedFallback = roleModel(mergedTeam.coachman_fallback);
  if (mergedFallback !== null) {
    const p = coachmanModelProblem(mergedFallback, laneModels, "the fallback coachman");
    if (p !== null) die(p, 1);
  }
  for (const a of splitList(WORKHORSES)) {
    if (!mergedNames.includes(a))
      die(`setup: workhorse '${a}' is not one of the lanes (${mergedNames.join(", ")})`, 1);
  }
  for (const rv of splitList(REVIEWERS)) {
    const p = reviewerProblem(rv, mergedNames, mergedNames.join(", "));
    if (p !== null) die(p, 1);
  }
  for (const [lens, list] of Object.entries(LENS_VALS)) {
    for (const rv of splitList(list)) {
      const p = reviewerProblem(rv, mergedNames, mergedNames.join(", "), lens);
      if (p !== null) die(p, 1);
    }
  }

  console.log("");
  console.log("== Bug review capability ==");
  const mergedLensRv = recOf(mergedTeam.lens_reviewers);
  const pickList = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  let bugNames = pickList(mergedLensRv.bug);
  if (bugNames.length === 0) bugNames = pickList(mergedTeam.reviewers);
  if (bugNames.length === 0) bugNames = pickList(mergedTeam.workhorses);
  let bugOk = 0;
  for (const reviewer of bugNames) {
    const harness = recOf(mergedLanes[reviewer]).harness;
    const name = typeof harness === "string" ? harness : "";
    if (name !== "" && run(join(HERE, "run"), ["review-forms", "has", name]).code === 0) {
      bugOk += 1;
    } else {
      console.log(`setup: bug reviewer '${reviewer}' uses ${name}, which has no code-review form`);
    }
  }
  if (bugOk === 0) {
    console.log(
      "setup: warning: no configured bug reviewer has a code-review form; runs whose turnpikes include bug review will be refused at pre-flight",
    );
  }

  if (DRY === 1) {
    console.log(fileText.replace(/\n+$/u, ""));
    process.exit(0);
  }
  if (backup !== null) {
    const OW = ask(`${PROJECT_SETTINGS} exists; overwrite (yes/no)`, "no", "overwrite", opts);
    if (OW !== "yes") die(`setup: left ${PROJECT_SETTINGS} as it was`, 1);
  }
  // The ignore rules land before the settings: a failure here leaves no new
  // settings behind, and rules without settings are inert.
  try {
    ensureIgnore(PROJECT_ROOT, true);
    if (IGNORE === "yes") ignoreSettings(PROJECT_ROOT);
  } catch (e) {
    die(`setup: cannot set the ignore rules${isDie(e) ? `: ${e.message}` : ""}`, 1);
  }
  const restore = (): void => {
    if (backup === null) rmSync(PROJECT_SETTINGS, { force: true });
    else writeFileSync(PROJECT_SETTINGS, backup, "utf8");
  };
  const undone = backup === null ? "removed the file it wrote" : "restored the previous file";
  mkdirSync(dirname(PROJECT_SETTINGS), { recursive: true });
  atomicWriteFileSync(
    dirname(PROJECT_SETTINGS),
    PROJECT_SETTINGS,
    `${fileText.replace(/\n+$/u, "")}\n`,
  );
  try {
    readTomlFile(PROJECT_SETTINGS);
  } catch {
    restore();
    die(`setup: ${PROJECT_SETTINGS} does not parse as TOML; ${undone}`, 1);
  }
  // The file control runs only when the readers see the file as written: a
  // tracked file waits for acceptance, and the merged checks above already
  // passed. Without any team lists the reviewers cannot resolve yet, which is
  // a warning, not a refusal: the settings grow over several setup runs.
  let notice: string | null;
  try {
    notice = pendingNoticeFor(PROJECT_ROOT);
  } catch (e) {
    restore();
    die(
      `setup: ${PROJECT_SETTINGS} fails the readers' validation${isDie(e) ? `: ${e.message}` : ""}; ${undone}`,
      1,
    );
  }
  if (notice === null) {
    const rev = run(join(HERE, "run"), ["reviewers", "lines", "--project", PROJECT_ROOT]);
    if (rev.code !== 0) {
      const hasTeamLists =
        (Array.isArray(mergedTeam.reviewers) && mergedTeam.reviewers.length > 0) ||
        (Array.isArray(mergedTeam.workhorses) && mergedTeam.workhorses.length > 0) ||
        Object.keys(recOf(mergedTeam.lens_reviewers)).length > 0;
      if (hasTeamLists) {
        process.stderr.write(rev.out);
        process.stderr.write(rev.err);
        restore();
        die(`setup: the reviewer lanes for ${PROJECT_ROOT} do not resolve; ${undone}`, 1);
      }
      console.log(
        "setup: warning: no reviewers are configured yet; check-setup names what is still missing",
      );
    }
  } else {
    console.error(notice);
  }
  console.log(`wrote ${PROJECT_SETTINGS} (parsed back as TOML)`);
  reportIgnored(IGNORE);
  process.exit(0);
}

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
clerk = { harness = "${CLH}", model = "${CLM}"${roleExtra(CLE, CLEF)} }
max_runs = ${MR}
mode = "${MODE}"
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
