// Set this machine up: probe the agent CLIs, ask which harness and model fills each role, how
// tickets are tracked, where projects live and who says the merge word, then write
// ~/.postmaster/config.toml in the shape of config.example.toml.
//
//   setup.sh [--answers <file>] [--dry-run] [--config <path>]
//   setup.sh --keys
//   setup.sh --self-test
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
//           time limit was not a whole number of seconds from 1 to 86400, or an existing config
//           was not overwritten
//
// Control: the written file is parsed back as TOML where a parser is available, and its reviewer
// lanes are resolved through scripts/reviewers.sh, so a config that would fail to load is never
// left on disk as if it were fine.
import { existsSync, mkdirSync, readFileSync, readSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readTomlFile, tryTomlFile } from "./lib/data.ts";
import { scriptsDir } from "./lib/paths.ts";
import { die, run, withTempDir } from "./lib/proc.ts";
import { SelfTest } from "./lib/selftest.ts";

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
    // read one line from stdin synchronously
    const buf = Buffer.alloc(1024);
    let line = "";
    try {
      const n = readSync(0, buf, 0, 1024, null);
      line = buf.toString("utf8", 0, n).replace(/\n$/, "");
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
if (argv[0] === "--self-test") {
  // fall through to self-test below
} else {
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
reviewers.<lens>?          (reviewers)        reviewer lanes for one lens only (reviewers.sh lenses)
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
poll_seconds               120                postmaster poll interval
tracker                    github             github, plane, local or other
plane.url                  https://api.plane.so   plane only
plane.workspace                               plane only; the slug in the workspace's web URL
plane.env_file             ~/.postmaster/plane.env   plane only; holds PLANE_API_KEY=<key>
tracker.name                                  other only
postmaster_may_create      no                 yes lets the postmaster create tickets unasked
round_timeout_seconds      2400               seconds a review round may run, 1 to 86400
merge_authority            user               user or postmaster
checkpoint_mode            autonomous         autonomous or consult
review_link?               (none)             template with {path}
overwrite                  no                 yes replaces an existing config`);
      process.exit(0);
    } else {
      console.error("usage: setup.sh [--answers <file>] [--dry-run] [--config <path>] | --keys");
      process.exit(1);
    }
    i++;
  }

  const opts: AskOpts = { answers: ANSWERS };
  console.log("== Installed agent CLIs ==");
  const probe = run("bash", [join(HERE, "probe-harnesses.sh")]);
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
    if (!laneList.includes(rv))
      die(`setup: reviewer '${rv}' is not one of the lanes (${LANES})`, 1);
  }
  let LENS_TABLE = "";
  const lensesR = run("bash", [join(HERE, "reviewers.sh"), "lenses"]);
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
  console.log(
    "== Tickets: GitHub Issues on a Projects board by default; Plane; local, kept in each repo; or another tracker. ==",
  );
  const TK = ask(
    "How are tickets tracked (github, plane, local, other)",
    "github",
    "tracker",
    opts,
  );
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
  const rtNum = /^[1-9][0-9]{0,4}$/.test(RT) ? parseInt(RT, 10) : 0;
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

  let TRACKER_EXTRA = "";
  if (PWS) TRACKER_EXTRA = `url = "${PURL}"\nworkspace = "${PWS}"\nenv_file = "${PENV}"`;
  if (OTHER) TRACKER_EXTRA = `name = "${OTHER}"`;

  const dateStr = new Date().toISOString().slice(0, 10);
  const OUT = `# Written by scripts/setup.sh on ${dateStr}. Shape: config.example.toml.
projects_roots = ${tomlList(ROOTS)}
${LANE_BLOCKS}

[team]
workhorses = ${tomlList(WORKHORSES)}
reviewers = ${tomlList(REVIEWERS)}
coachman = { harness = "${CH}", model = "${CM}"${roleExtra(CE, CEF)} }
coachman_fallback = { harness = "${FH}", model = "${FM}"${roleExtra(FE, FEF)} }
postmaster = { harness = "${PH}", model = "${PM}"${roleExtra(PE, PEF)} }
max_runs = ${MR}
${LENS_TABLE}
[postmaster]
poll_seconds = ${PS}

[tracker]
kind = "${TK}"
${TRACKER_EXTRA}
postmaster_may_create = ${PMC === "yes" ? "true" : "false"}

[review]
round_timeout_seconds = ${RT}

[ship]
merge_authority = "${MA}"
checkpoint_mode = "${CPM}"
review_link = "${RL}"
`;

  if (DRY === 1) {
    console.log(OUT.replace(/\n+$/, ""));
    process.exit(0);
  }
  if (existsSync(CONFIG)) {
    const OW = ask(`${CONFIG} exists; overwrite (yes/no)`, "no", "overwrite", opts);
    if (OW !== "yes") die(`setup: left ${CONFIG} as it was`, 1);
  }
  mkdirSync(dirname(CONFIG), { recursive: true });
  // BASE's $(heredoc) stripped trailing newlines and printf '%s\n' added exactly one back.
  writeFileSync(CONFIG, `${OUT.replace(/\n+$/, "")}\n`, "utf8");
  // parse back as TOML
  try {
    readTomlFile(CONFIG);
  } catch {
    die(`setup: ${CONFIG} does not parse as TOML; fix it before running anything`, 1);
  }
  const rev = run("bash", [join(HERE, "reviewers.sh"), "lines", "--config", CONFIG]);
  if (rev.code !== 0) {
    die(
      `setup: the reviewer lanes in ${CONFIG} do not resolve; fix them before running anything`,
      1,
    );
  }
  console.log(`wrote ${CONFIG} (parsed back as TOML)`);
  process.exit(0);
}

// --- self-test ---------------------------------------------------------------------------------
withTempDir((tmp) => {
  const SELF = join(HERE, "setup.sh");
  const st = new SelfTest();

  function answers(name: string, extra?: string): void {
    const lines = [
      "lanes=alpha, beta, sentinel",
      "lane.alpha.harness=bash",
      "lane.alpha.model=m1",
      "lane.beta.harness=bash",
      "lane.beta.model=m2",
      "lane.sentinel.harness=bash",
      "lane.sentinel.model=m3",
      "workhorses=alpha, beta",
      "coachman.harness=bash",
      "coachman.model=judge",
      "fallback.harness=bash",
      "fallback.model=spare",
      "postmaster.harness=bash",
      "postmaster.model=pm",
    ];
    if (extra) lines.push(extra);
    writeFileSync(join(tmp, `${name}.answers`), `${lines.join("\n")}\n`, "utf8");
  }

  function runSetup(name: string): number {
    const r = run("bash", [
      SELF,
      "--answers",
      join(tmp, `${name}.answers`),
      "--config",
      join(tmp, `${name}.toml`),
    ]);
    writeFileSync(join(tmp, `${name}.out`), r.out + r.err, "utf8");
    return r.code;
  }

  function _team(name: string, key: string): string {
    const cfg = tryTomlFile(join(tmp, `${name}.toml`));
    if (!cfg) return "null";
    const t = cfg.team as Record<string, unknown> | undefined;
    const v = t?.[key];
    return JSON.stringify(v ?? null);
  }

  function limit(name: string): string {
    const cfg = tryTomlFile(join(tmp, `${name}.toml`));
    if (!cfg) return "error";
    const r = cfg.review as Record<string, unknown> | undefined;
    return String(r?.round_timeout_seconds ?? "error");
  }

  console.log("positive controls");
  answers("lens", "reviewers.security=alpha, beta, sentinel");
  const lensRc = runSetup("lens");
  {
    const cfg = tryTomlFile(join(tmp, "lens.toml"));
    st.check(
      "a lens given its own lanes is written to [team.lens_reviewers]",
      lensRc === 0 &&
        cfg !== null &&
        JSON.stringify((cfg.team as Record<string, unknown>)?.lens_reviewers) ===
          '{"security":["alpha","beta","sentinel"]}',
      `exit ${lensRc}`,
    );
  }
  {
    const r = run("bash", [
      join(HERE, "reviewers.sh"),
      "lines",
      "--config",
      join(tmp, "lens.toml"),
    ]);
    const expected = "reviewers: alpha, beta\nsecurity reviewers: alpha, beta, sentinel";
    st.check(
      "the written config resolves: the reviewers default to the workhorses, and security has its own",
      r.out.trim() === expected,
      r.out,
    );
  }
  answers("plain");
  const plainRc = runSetup("plain");
  {
    const cfg = tryTomlFile(join(tmp, "plain.toml"));
    st.check(
      "without lens answers there is no table, as before",
      plainRc === 0 &&
        cfg !== null &&
        (cfg.team as Record<string, unknown>)?.lens_reviewers === undefined &&
        JSON.stringify((cfg.team as Record<string, unknown>)?.reviewers) === '["alpha","beta"]',
      `exit ${plainRc}`,
    );
  }
  answers(
    "roles",
    "coachman.effort=max\ncoachman.env_file=~/.postmaster/lanes/judge.env\nfallback.env_file=spare.env\npostmaster.env_file=~/.postmaster/lanes/pm.env",
  );
  const rolesRc = runSetup("roles");
  {
    const cfg = tryTomlFile(join(tmp, "roles.toml"));
    const t = cfg?.team as Record<string, unknown> | undefined;
    st.check(
      "the coachman, the fallback and the postmaster each get their env file, with or without an effort",
      rolesRc === 0 &&
        cfg !== null &&
        JSON.stringify(t?.coachman) ===
          '{"harness":"bash","model":"judge","effort":"max","env_file":"~/.postmaster/lanes/judge.env"}' &&
        JSON.stringify(t?.coachman_fallback) ===
          '{"harness":"bash","model":"spare","env_file":"spare.env"}' &&
        JSON.stringify(t?.postmaster) ===
          '{"harness":"bash","model":"pm","env_file":"~/.postmaster/lanes/pm.env"}',
      `exit ${rolesRc}`,
    );
  }
  {
    const cfg = tryTomlFile(join(tmp, "plain.toml"));
    const t = cfg?.team as Record<string, unknown> | undefined;
    st.check(
      "a role with no env file answer gets no env_file key",
      JSON.stringify(t?.coachman) === '{"harness":"bash","model":"judge"}',
    );
  }

  st.check(
    "a review round's time limit defaults to 2400 seconds, under [review]",
    limit("plain") === "2400",
    limit("plain"),
  );
  answers("limit", "round_timeout_seconds=86400");
  const limitRc = runSetup("limit");
  st.check(
    "an answer sets it, up to 86400",
    limitRc === 0 && limit("limit") === "86400",
    `exit ${limitRc} limit=${limit("limit")}`,
  );

  console.log("negative controls");
  const badLimits = [
    "0",
    "-60",
    "abc",
    "1.5",
    "0600",
    "40 minutes",
    "86401",
    "9999999999999999999",
  ];
  for (let n = 0; n < badLimits.length; n++) {
    const v = badLimits[n] ?? "";
    const name = `limit${n + 1}`;
    answers(name, `round_timeout_seconds=${v}`);
    const rc = runSetup(name);
    const out = readFileSync(join(tmp, `${name}.out`), "utf8");
    st.check(
      `a round time limit of '${v}' is refused, and nothing is written`,
      rc === 1 &&
        !existsSync(join(tmp, `${name}.toml`)) &&
        out.includes("round_timeout_seconds must be"),
      out,
    );
  }
  answers("ghost", "reviewers.security=alpha, ghost");
  const ghostRc = runSetup("ghost");
  {
    const out = readFileSync(join(tmp, "ghost.out"), "utf8");
    st.check(
      "a lens reviewer that is not a lane is refused, and nothing is written",
      ghostRc === 1 &&
        !existsSync(join(tmp, "ghost.toml")) &&
        out.includes("security reviewer 'ghost' is not one of the lanes"),
      out,
    );
  }
  answers("shared", "coachman.model=m1");
  // remove the default coachman.model=judge line
  {
    const f = join(tmp, "shared.answers");
    const text = readFileSync(f, "utf8").replace(/^coachman\.model=judge$\n?/m, "");
    writeFileSync(f, text, "utf8");
  }
  const sharedRc = runSetup("shared");
  {
    const out = readFileSync(join(tmp, "shared.out"), "utf8");
    st.check(
      "a coachman on a lane's model is refused",
      sharedRc === 1 &&
        !existsSync(join(tmp, "shared.toml")) &&
        out.includes("cannot run on a lane's model"),
      out,
    );
  }
  answers("missing");
  // remove fallback.model= line
  {
    const f = join(tmp, "missing.answers");
    const text = readFileSync(f, "utf8").replace(/^fallback\.model=.*$\n?/m, "");
    writeFileSync(f, text, "utf8");
  }
  const missingRc = runSetup("missing");
  {
    const out = readFileSync(join(tmp, "missing.out"), "utf8");
    st.check(
      "a missing answer is refused, naming it",
      missingRc === 1 &&
        !existsSync(join(tmp, "missing.toml")) &&
        out.includes("no answer for fallback.model"),
      out,
    );
  }

  st.finish();
});
