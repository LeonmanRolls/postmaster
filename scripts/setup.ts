import { accessSync, constants, existsSync, mkdirSync, readFileSync, readSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { command, makeTemp, removeTree, scriptDir, writeError, writeOut } from "./lib/core.ts";

const here = scriptDir(import.meta.url);
const wrapper = join(here, "setup.sh");
const keys = [
  "key (? = may be left out)  default            asked as",
  "projects_roots             ~/Code             where projects live, comma separated",
  "lanes                      alpha, beta        lane names, comma separated; then per lane:",
  "lane.<name>.harness                           harness (codex, grok, agy, claude, muse, mimo, pi)",
  "lane.<name>.model                             model id",
  "lane.<name>.effort?        (none)             effort, blank if the harness has no effort flag",
  "lane.<name>.env_file?      (none)             env file for an alternate backend",
  "workhorses                 <lanes>            workhorse lanes, comma separated",
  "reviewers                  <workhorses>       reviewer lanes, comma separated",
  "reviewers.<lens>?          (reviewers)        reviewer lanes for one lens only (reviewers.sh lenses)",
  "coachman.harness                              never a lane's model",
  "coachman.model",
  "coachman.effort?           (none)",
  "coachman.env_file?         (none)             env file for its key or backend, as for a lane",
  "fallback.harness                              never a lane's model",
  "fallback.model",
  "fallback.effort?           (none)",
  "fallback.env_file?         (none)",
  "postmaster.harness",
  "postmaster.model",
  "postmaster.effort?         (none)",
  "postmaster.env_file?       (none)",
  "max_runs                   2                  concurrent runs per project",
  "poll_seconds               120                postmaster poll interval",
  "tracker                    github             github, plane, local or other",
  "plane.url                  https://api.plane.so   plane only",
  "plane.workspace                               plane only; the slug in the workspace's web URL",
  "plane.env_file             ~/.postmaster/plane.env   plane only; holds PLANE_API_KEY=<key>",
  "tracker.name                                  other only",
  "postmaster_may_create      no                 yes lets the postmaster create tickets unasked",
  "round_timeout_seconds      2400               seconds a review round may run, 1 to 86400",
  "merge_authority            user               user or postmaster",
  "checkpoint_mode            autonomous         autonomous or consult",
  "review_link?               (none)             template with {path}",
].join("\n");
class SetupFailure extends Error {}
function readLine(): string {
  const bytes: number[] = [];
  const b = new Uint8Array(1);
  for (;;) {
    let count = 0;
    try {
      count = readSync(0, b, 0, 1, null);
    } catch {
      break;
    }
    if (!count || b[0] === 10) break;
    if (b[0] !== 13) bytes.push(b[0]!);
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}
function installed(name: string): boolean {
  for (const dir of (process.env.PATH ?? "").split(":")) {
    try {
      accessSync(join(dir || ".", name), constants.X_OK);
      return true;
    } catch {}
  }
  return false;
}
function list(value: string): string[] {
  return value.split(/[\s,]+/).filter(Boolean);
}
function tomlList(value: string): string {
  return `[${list(value)
    .map((x) => `"${x}"`)
    .join(", ")}]`;
}
function runSetup(args: string[]): number {
  let answersPath = "";
  let configPath = join(process.env.HOME ?? "", ".postmaster/config.toml");
  let dry = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dry-run") dry = true;
    else if (args[i] === "--config" && args[i + 1]) configPath = args[++i]!;
    else if (args[i] === "--answers" && args[i + 1]) {
      answersPath = args[++i]!;
      if (!existsSync(answersPath)) {
        writeError(`setup: no such answers file: ${answersPath}`);
        return 1;
      }
    } else if (args[i] === "--keys" && args.length === 1) {
      writeOut(keys);
      return 0;
    } else {
      writeError("usage: setup.sh [--answers <file>] [--dry-run] [--config <path>] | --keys");
      return 1;
    }
  }
  const answerLines = answersPath ? readFileSync(answersPath, "utf8").split(/\r?\n/) : [];
  let _inputNo = 0;
  const values = new Map<string, string>();
  const ask = (key: string, prompt: string, fallback = "", optional = false): string => {
    let value: string;
    if (answersPath) {
      const prefix = `${key}=`;
      const row = answerLines.find((line: string) => line.startsWith(prefix));
      value = row === undefined ? "" : row.slice(key.length + 1);
      if (!value && !fallback && !optional && row === undefined) {
        writeError(`setup: no answer for ${key} in ${answersPath} (${prompt})`);
        throw new SetupFailure();
      }
      if (!value) value = fallback;
      writeOut(`${prompt}: ${value}`);
    } else {
      process.stdout.write(prompt + (fallback ? ` [${fallback}]: ` : ": "));
      value = readLine();
      if (!process.stdin.isTTY) writeOut("");
      if (!value) value = fallback;
    }
    values.set(key, value);
    _inputNo++;
    return value;
  };
  const require = (test: boolean, message: string) => {
    if (!test) {
      writeError(`setup: ${message}`);
      throw new SetupFailure();
    }
  };
  const need = (harness: string) => {
    if (!installed(harness)) {
      writeError(`setup: harness '${harness}' is not on PATH; install it or choose another`);
      throw new SetupFailure();
    }
  };
  try {
    writeOut("== Installed agent CLIs ==");
    const probe = command(join(here, "probe-harnesses.sh"));
    if (probe.stdout) process.stdout.write(probe.stdout);
    if (probe.stderr) process.stderr.write(probe.stderr);
    writeOut("");
    ask("projects_roots", "Where do projects live (comma separated)", "~/Code");
    writeOut("");
    writeOut("== The horses: lanes that implement a ticket. At least two, from different vendors. ==");
    const laneNames = list(ask("lanes", "Lane names, comma separated", "alpha, beta"));
    require(laneNames.length >= 2, "at least two lanes are needed");
    const models: string[] = [];
    for (const lane of laneNames) {
      const harness = ask(`lane.${lane}.harness`, `  ${lane}: harness (codex, grok, agy, claude, muse, mimo, pi)`);
      need(harness);
      models.push(ask(`lane.${lane}.model`, `  ${lane}: model id`));
      ask(`lane.${lane}.effort`, `  ${lane}: effort (blank if the harness has no effort flag)`, "", true);
      ask(`lane.${lane}.env_file`, `  ${lane}: env file for an alternate backend (blank if none)`, "", true);
    }
    writeOut("");
    const names = new Set(laneNames);
    const workhorses = list(ask("workhorses", "Workhorse lanes, comma separated", values.get("lanes")!));
    for (const name of workhorses)
      require(names.has(name), `workhorse '${name}' is not one of the lanes (${laneNames.join(", ")})`);
    require(workhorses.length >= 2, "at least two workhorses are needed");
    const reviewers = list(ask("reviewers", "Reviewer lanes, comma separated", workhorses.join(", ")));
    for (const name of reviewers)
      require(names.has(name), `reviewer '${name}' is not one of the lanes (${laneNames.join(", ")})`);
    let lensTable = "";
    const lenses = command(join(here, "reviewers.sh"), ["lenses"]).stdout.trim().split(/\s+/).filter(Boolean);
    for (const lens of lenses) {
      const selected = ask(
        `reviewers.${lens}`,
        `  reviewer lanes for the ${lens} lens alone, comma separated (blank: the reviewer lanes)`,
        "",
        true,
      );
      if (!selected) continue;
      for (const name of list(selected))
        require(names.has(name), `${lens} reviewer '${name}' is not one of the lanes (${laneNames.join(", ")})`);
      lensTable += `${lens} = ${tomlList(selected)}\n`;
    }
    if (lensTable) lensTable = `\n[team.lens_reviewers]\n${lensTable}`;
    writeOut("");
    writeOut("== The coachman: judges the lanes and runs the review rounds. Never a lane's model. ==");
    const coachH = ask("coachman.harness", "  coachman: harness");
    need(coachH);
    const coachM = ask("coachman.model", "  coachman: model id");
    require(!models.includes(coachM), `the coachman cannot run on a lane's model (${coachM})`);
    const coachE = ask("coachman.effort", "  coachman: effort (blank if none)", "", true);
    const coachEnv = ask("coachman.env_file", "  coachman: env file for its key or backend (blank if none)", "", true);
    writeOut("");
    writeOut("== The coachman's fallback: takes over a leg when the coachman hits a wall. Not a lane either. ==");
    const fallbackH = ask("fallback.harness", "  fallback: harness");
    need(fallbackH);
    const fallbackM = ask("fallback.model", "  fallback: model id");
    require(!models.includes(fallbackM), `the fallback coachman cannot run on a lane's model (${fallbackM})`);
    const fallbackE = ask("fallback.effort", "  fallback: effort (blank if none)", "", true);
    const fallbackEnv = ask(
      "fallback.env_file",
      "  fallback: env file for its key or backend (blank if none)",
      "",
      true,
    );
    writeOut("");
    writeOut("== The postmaster: decomposes the stream, dispatches coachmen, supervises. ==");
    const pmH = ask("postmaster.harness", "  postmaster: harness");
    need(pmH);
    const pmM = ask("postmaster.model", "  postmaster: model id");
    const pmE = ask("postmaster.effort", "  postmaster: effort (blank if none)", "", true);
    const pmEnv = ask("postmaster.env_file", "  postmaster: env file for its key or backend (blank if none)", "", true);
    const maxRuns = ask("max_runs", "  concurrent runs per project", "2");
    const pollSeconds = ask("poll_seconds", "  postmaster poll interval, seconds", "120");
    writeOut("");
    writeOut(
      "== Tickets: GitHub Issues on a Projects board by default; Plane; local, kept in each repo; or another tracker. ==",
    );
    const tracker = ask("tracker", "How are tickets tracked (github, plane, local, other)", "github");
    let trackerExtra = "";
    if (tracker === "plane") {
      const url = ask(
        "plane.url",
        "  Plane API origin (https://api.plane.so for cloud; a self-hosted instance is its own)",
        "https://api.plane.so",
      );
      const workspace = ask(
        "plane.workspace",
        "  workspace slug (the segment after the host in the workspace's web URL)",
      );
      require(Boolean(workspace), "a Plane workspace slug is needed");
      const envFile = ask(
        "plane.env_file",
        "  file holding PLANE_API_KEY=<key>, written by you, never pasted here",
        "~/.postmaster/plane.env",
      );
      trackerExtra = `url = "${url}"\nworkspace = "${workspace}"\nenv_file = "${envFile}"`;
    } else if (tracker === "other")
      trackerExtra = `name = "${ask("tracker.name", "  tracker name (then describe it in ~/.postmaster/trackers/<name>.md)")}"`;
    else require(tracker === "github" || tracker === "local", "tracker kind must be github, plane, local or other");
    writeOut("");
    const mayCreate = ask("postmaster_may_create", "May the postmaster create tickets without asking (yes/no)", "no");
    require(mayCreate === "yes" || mayCreate === "no", "answer yes or no");
    const timeout = ask(
      "round_timeout_seconds",
      "Seconds a review round may run before the reviewers still running are stopped",
      "2400",
    );
    require(/^[1-9][0-9]{0,4}$/.test(timeout) &&
      Number(timeout) <= 86400, "round_timeout_seconds must be a whole number of seconds from 1 to 86400");
    const merge = ask("merge_authority", "Who says the merge word (user, postmaster)", "user");
    require(merge === "user" || merge === "postmaster", "merge authority must be user or postmaster");
    const checkpoint = ask("checkpoint_mode", "Checkpoint mode (autonomous, consult)", "autonomous");
    require(checkpoint === "autonomous" || checkpoint === "consult", "checkpoint mode must be autonomous or consult");
    const reviewLink = ask(
      "review_link",
      "Review link template with {path} for the synthesis worktree (blank for none)",
      "",
      true,
    );
    const role = (h: string, m: string, e: string, f: string) =>
      `{ harness = "${h}", model = "${m}"${e ? `, effort = "${e}"` : ""}${f ? `, env_file = "${f}"` : ""} }`;
    const laneBlock = laneNames
      .map((lane) => {
        let block = `[lanes.${lane}]\nharness = "${values.get(`lane.${lane}.harness`)}"\nmodel = "${values.get(`lane.${lane}.model`)}"`;
        const e = values.get(`lane.${lane}.effort`) ?? "";
        const f = values.get(`lane.${lane}.env_file`) ?? "";
        if (e) block += `\neffort = "${e}"`;
        if (f) block += `\nenv_file = "${f}"`;
        return block;
      })
      .join("\n");
    const output = [
      `# Written by scripts/setup.sh on ${new Date().toISOString().slice(0, 10)}. Shape: config.example.toml.`,
      `projects_roots = ${tomlList(values.get("projects_roots")!)}`,
      laneBlock,
      "",
      "[team]",
      `workhorses = ${tomlList(workhorses.join(", "))}`,
      `reviewers = ${tomlList(reviewers.join(", "))}`,
      `coachman = ${role(coachH, coachM, coachE, coachEnv)}`,
      `coachman_fallback = ${role(fallbackH, fallbackM, fallbackE, fallbackEnv)}`,
      `postmaster = ${role(pmH, pmM, pmE, pmEnv)}`,
      `max_runs = ${maxRuns}`,
      lensTable,
      "[postmaster]",
      `poll_seconds = ${pollSeconds}`,
      "",
      "[tracker]",
      `kind = "${tracker}"`,
      trackerExtra,
      `postmaster_may_create = ${mayCreate === "yes" ? "true" : "false"}`,
      "",
      "[review]",
      `round_timeout_seconds = ${timeout}`,
      "",
      "[ship]",
      `merge_authority = "${merge}"`,
      `checkpoint_mode = "${checkpoint}"`,
      `review_link = "${reviewLink}"`,
    ].join("\n");
    if (dry) {
      writeOut(output);
      return 0;
    }
    if (existsSync(configPath)) {
      const overwrite = ask("overwrite", `${configPath} exists; overwrite (yes/no)`, "no");
      if (overwrite !== "yes") {
        writeError(`setup: left ${configPath} as it was`);
        return 1;
      }
    }
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, `${output}\n`);
    try {
      Bun.TOML.parse(readFileSync(configPath, "utf8"));
    } catch {
      writeError(`setup: ${configPath} does not parse as TOML; fix it before running anything`);
      return 1;
    }
    const check = command(join(here, "reviewers.sh"), ["lines", "--config", configPath]);
    if (check.code) {
      if (check.stderr) process.stderr.write(check.stderr);
      writeError(`setup: the reviewer lanes in ${configPath} do not resolve; fix them before running anything`);
      return 1;
    }
    writeOut(`wrote ${configPath} (parsed back as TOML)`);
    return 0;
  } catch (error) {
    if (!(error instanceof SetupFailure)) writeError(`setup: ${String(error)}`);
    return 1;
  }
}
function selfTest(): number {
  const tmp = makeTemp("postmaster-setup-");
  const ap = (name: string) => join(tmp, `${name}.answers`);
  const cp = (name: string) => join(tmp, `${name}.toml`);
  let failures = 0;
  const ok = (s: string) => writeOut(`  ok   ${s}`);
  const fail = (s: string, detail = "") => {
    writeOut(`  FAIL ${s}`);
    if (detail) for (const line of detail.split("\n")) writeOut(`         ${line}`);
    failures++;
  };
  const answers = (name: string, extra = "") => {
    const data = [
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
    writeFileSync(ap(name), `${data.join("\n")}\n${extra ? `${extra}\n` : ""}`);
  };
  const run = (name: string) => {
    const result = command(wrapper, ["--answers", ap(name), "--config", cp(name)]);
    return { ...result, stdout: result.stdout + result.stderr };
  };
  const get = (name: string) => Bun.TOML.parse(readFileSync(cp(name), "utf8")) as any;
  try {
    writeOut("positive controls");
    answers("lens", "reviewers.security=alpha, beta, sentinel");
    let result = run("lens");
    if (
      result.code === 0 &&
      JSON.stringify(get("lens").team.lens_reviewers) === '{"security":["alpha","beta","sentinel"]}'
    )
      ok("a lens given its own lanes is written to [team.lens_reviewers]");
    else
      fail(
        `a lens given its own lanes is written to [team.lens_reviewers] (exit ${result.code})`,
        result.stdout + result.stderr,
      );
    result = command(join(here, "reviewers.sh"), ["lines", "--config", cp("lens")]);
    if (result.stdout.trimEnd() === "reviewers: alpha, beta\nsecurity reviewers: alpha, beta, sentinel")
      ok("the written config resolves: the reviewers default to the workhorses, and security has its own");
    else fail("the written config resolves", result.stdout + result.stderr);
    answers("plain");
    result = run("plain");
    if (
      result.code === 0 &&
      get("plain").team.lens_reviewers === undefined &&
      JSON.stringify(get("plain").team.reviewers) === '["alpha","beta"]'
    )
      ok("without lens answers there is no table, as before");
    else fail(`without lens answers there is no table, as before (exit ${result.code})`, result.stdout + result.stderr);
    answers(
      "roles",
      "coachman.effort=max\ncoachman.env_file=~/.postmaster/lanes/judge.env\nfallback.env_file=spare.env\npostmaster.env_file=~/.postmaster/lanes/pm.env",
    );
    result = run("roles");
    const roleOk =
      result.code === 0 &&
      JSON.stringify(get("roles").team.coachman) ===
        '{"harness":"bash","model":"judge","effort":"max","env_file":"~/.postmaster/lanes/judge.env"}' &&
      JSON.stringify(get("roles").team.coachman_fallback) ===
        '{"harness":"bash","model":"spare","env_file":"spare.env"}' &&
      JSON.stringify(get("roles").team.postmaster) ===
        '{"harness":"bash","model":"pm","env_file":"~/.postmaster/lanes/pm.env"}';
    if (roleOk) ok("the coachman, the fallback and the postmaster each get their env file, with or without an effort");
    else
      fail(
        `the coachman, the fallback and the postmaster each get their env file (exit ${result.code})`,
        result.stdout + result.stderr,
      );
    if (JSON.stringify(get("plain").team.coachman) === '{"harness":"bash","model":"judge"}')
      ok("a role with no env file answer gets no env_file key");
    else fail("a role with no env file answer gets no env_file key");
    if (get("plain").review.round_timeout_seconds === 2400)
      ok("a review round's time limit defaults to 2400 seconds, under [review]");
    else fail("a review round's time limit defaults to 2400 seconds, under [review]");
    answers("limit", "round_timeout_seconds=86400");
    result = run("limit");
    if (result.code === 0 && get("limit").review.round_timeout_seconds === 86400) ok("an answer sets it, up to 86400");
    else fail(`an answer sets it, up to 86400 (exit ${result.code})`, result.stdout + result.stderr);
    writeOut("negative controls");
    let i = 0;
    for (const value of ["0", "-60", "abc", "1.5", "0600", "40 minutes", "86401", "9999999999999999999"]) {
      const name = `limit${++i}`;
      answers(name, `round_timeout_seconds=${value}`);
      result = run(name);
      if (result.code === 1 && !existsSync(cp(name)) && result.stdout.includes("round_timeout_seconds must be"))
        ok(`a round time limit of '${value}' is refused, and nothing is written`);
      else
        fail(
          `a round time limit of '${value}' is refused, and nothing is written (exit ${result.code})`,
          result.stdout + result.stderr,
        );
    }
    answers("ghost", "reviewers.security=alpha, ghost");
    result = run("ghost");
    if (
      result.code === 1 &&
      !existsSync(cp("ghost")) &&
      result.stdout.includes("security reviewer 'ghost' is not one of the lanes")
    )
      ok("a lens reviewer that is not a lane is refused, and nothing is written");
    else
      fail(
        `a lens reviewer that is not a lane is refused, and nothing is written (exit ${result.code})`,
        result.stdout + result.stderr,
      );
    answers("shared", "coachman.model=m1");
    writeFileSync(ap("shared"), readFileSync(ap("shared"), "utf8").replace("coachman.model=judge\n", ""));
    result = run("shared");
    if (result.code === 1 && !existsSync(cp("shared")) && result.stdout.includes("cannot run on a lane's model"))
      ok("a coachman on a lane's model is refused");
    else fail(`a coachman on a lane's model is refused (exit ${result.code})`, result.stdout + result.stderr);
    answers("missing");
    writeFileSync(ap("missing"), readFileSync(ap("missing"), "utf8").replace("fallback.model=spare\n", ""));
    result = run("missing");
    if (result.code === 1 && !existsSync(cp("missing")) && result.stdout.includes("no answer for fallback.model"))
      ok("a missing answer is refused, naming it");
    else fail(`a missing answer is refused, naming it (exit ${result.code})`, result.stdout + result.stderr);
  } finally {
    removeTree(tmp);
  }
  writeOut("");
  writeOut(failures === 0 ? "self-test: all controls behaved" : `self-test: ${failures} control(s) misbehaved`);
  return failures === 0 ? 0 : 1;
}
function run(args: string[]): number {
  if (args[0] === "--self-test") return args.length === 1 ? selfTest() : usage();
  return runSetup(args);
}
function usage(): never {
  writeError("usage: setup.sh [--answers <file>] [--dry-run] [--config <path>] | --keys");
  process.exit(1);
}
process.exit(run(process.argv.slice(2)));
