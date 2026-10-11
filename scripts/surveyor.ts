// One independent judgement inside a run, from an agent that took no part in
// the work: the surveyor. A coachman starts it with one question and the
// materials for it; it answers in one form, and the answer stays in the run's
// record under the name its caller gives.
//
//   run surveyor lane <dispatch>
//   run surveyor call <dispatch> <repo> --name <name> --snapshot <commit> --question <file>
//                       [--material <file>...] --timeout <seconds>
//   run surveyor exec <exit-file> <role> <command> [args...]
//
// lane prints the surveyor's lane for the run and where it came from: the
// lane team.surveyor names in the run's run.json, or, where it names none,
// the first lane on the waybill's reviewers: line.
//
// call cuts a fresh scratch of <repo> at <snapshot>, copies the question and
// the listed materials into a folder of the call's own, launches the lane
// lane picks through run host as a lane starts, waits for the caller's
// deadline, and keeps the surveyor's last message, or the reason there is
// none, in surveys/<name>.md. It prints the record's path.
//
// From the dispatch it accepts only the ticket (ticket-body.md, or
// ticket-as-spec.md in older runs) and the reviewers' reports and findings
// under logs/ (review-r<N>-<lens>-<lane>-last.md, -findings.json, and
// -findings.md, the hand-written bug report where normalize failed); any
// other path inside the dispatch is refused, naming it. A caller that needs
// another fact from the run writes it to a file of its own first. The prompt
// names the skill's file in the run's pinned checkout and only the copied
// paths, so the surveyor reads nothing of the dispatch.
//
// The surveyor is launched, confined and recorded as a lane. Its answer is
// its last message, read per harness as harnesses.md records it; a harness
// with no recorded final-message shape is refused before anything launches.
// exec runs the launch under run host and records its exit, which the host's
// marker does not carry. Run host sets the launch role only on a direct run
// launch child, so exec carries the role its call gave run host and sets it
// for the launch it runs; the stream path already reaches every child.
//
//   exit 0  the lane printed; the answer kept, its path printed
//   exit 1  usage; the dispatch or repo cannot be read; the scratch, launch,
//           wait or record failed past refusing
//   exit 2  refused, nothing launched and nothing recorded: a name already
//           used, an unknown snapshot, a missing or forbidden path naming it,
//           a lane that does not resolve, or a harness with no recorded shape
//   exit 3  the lane gave no answer: a non-zero exit, a provider wall, the
//           deadline, or no final message in the stream; the reason kept,
//           a degrade line logged
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { tryJsonFile } from "./lib/data.ts";
import { scriptsDir } from "./lib/paths.ts";
import { run, signalExitCode } from "./lib/proc.ts";

const HERE = scriptsDir(import.meta);
const USAGE =
  "usage: run surveyor lane <dispatch> | call <dispatch> <repo> --name <name> --snapshot <commit> --question <file> [--material <file>...] --timeout <seconds> | exec <exit-file> <role> <command> [args...]";

// The harnesses whose final message harnesses.md records a shape for, and the
// surveyor reads. grok and agy have none recorded: a lane on one is refused
// before anything launches, so no call ever records a guessed answer. Setup
// reads the same set, so a surveyor it accepts is one a call can launch.
export const SURVEYOR_HARNESSES = new Set(["codex", "claude", "pi", "muse", "mimo"]);
export const SURVEYOR_HARNESS_HELP = "claude, codex, pi, muse or mimo";

const REPORT_RE = new RegExp(
  "^logs/review-r[0-9]+-(?:style|bug|security)-[A-Za-z0-9._-]+-(?:last\\.md|findings\\.json|findings\\.md)$",
  "u",
);
const NAME_RE = new RegExp("^[A-Za-z0-9._-]+$", "u");

export type GateVerdict = "ticket" | "report" | "outside" | "refused";

/** gateMaterial <dispatch> <listed>: what a listed path is, both canonical. */
export function gateMaterial(dispatchReal: string, listedReal: string): GateVerdict {
  if (listedReal === `${dispatchReal}/ticket-body.md`) return "ticket";
  if (listedReal === `${dispatchReal}/ticket-as-spec.md`) return "ticket";
  if (listedReal === dispatchReal) return "refused";
  if (!listedReal.startsWith(`${dispatchReal}/`)) return "outside";
  return REPORT_RE.test(listedReal.slice(dispatchReal.length + 1)) ? "report" : "refused";
}

/** validName <name>: null when the survey name is usable, else the reason. */
export function validName(name: string): string | null {
  if (name === "") return "no survey name given";
  if (name === "." || name === "..") return `survey name ${name} names no record`;
  if (name.startsWith("-")) return `survey name ${name} starts with -`;
  if (!NAME_RE.test(name))
    return `survey name ${name} is not letters, digits, dot, underscore or dash`;
  return null;
}

/** validTimeout <raw>: the seconds, or null when out of shape. */
export function validTimeout(raw: string): number | null {
  if (!/^[1-9][0-9]{0,4}$/u.test(raw)) return null;
  const n = parseInt(raw, 10);
  return n >= 1 && n <= 86400 ? n : null;
}

type Configured = { lane: string } | { absent: true } | { refusal: string };

function isTable(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** configuredSurveyor <config>: the lane team.surveyor names, or why not. */
export function configuredSurveyor(config: unknown): Configured {
  if (!isTable(config)) return { refusal: "run.json records no config" };
  const team = config.team;
  const surveyor = isTable(team) ? team.surveyor : undefined;
  if (surveyor === undefined || surveyor === null || surveyor === "") return { absent: true };
  if (typeof surveyor !== "string") return { refusal: "team.surveyor is not a lane name" };
  const lanes = config.lanes;
  if (!isTable(lanes) || !isTable(lanes[surveyor])) {
    return { refusal: `team.surveyor names ${surveyor}, which is not a lane in [lanes]` };
  }
  return { lane: surveyor };
}

function parsedEvents(eventsText: string): unknown[] {
  const events: unknown[] = [];
  for (const line of eventsText.split("\n")) {
    if (line.trim() === "") continue;
    try {
      events.push(JSON.parse(line) as unknown);
    } catch {
      // A line that is not JSON is not an event: file output reaches the
      // stream beside the harness's own records.
    }
  }
  return events;
}

function field(e: unknown, k: string): unknown {
  return isTable(e) ? e[k] : undefined;
}

/** finalMessage <harness> <events> <last>: the surveyor's last message, per harness. */
export function finalMessage(
  harness: string,
  eventsText: string,
  lastText: string | null,
): { message: string } | { error: string } {
  const events = parsedEvents(eventsText);
  if (harness === "codex") {
    // The -o file is trusted only when the turn completed: codex writes it
    // only on success, so a failed turn's file is an earlier attempt's.
    if (events.some((e) => field(e, "type") === "turn.failed")) {
      return { error: "codex turn failed" };
    }
    if (!events.some((e) => field(e, "type") === "turn.completed")) {
      return { error: "codex stream shows no completed turn" };
    }
    if (lastText === null) return { error: "codex wrote no -o output" };
    if (lastText.trim() === "") return { error: "codex -o output is empty" };
    return { message: lastText };
  }
  if (harness === "claude") {
    const results = events.filter((e) => field(e, "type") === "result");
    if (results.length === 0) return { error: "claude stream has no result" };
    const last = results[results.length - 1]!;
    if (field(last, "subtype") !== "success") {
      return {
        error: `claude run did not succeed (subtype: ${String(field(last, "subtype") ?? "missing")})`,
      };
    }
    // harnesses.md marks is_error on result records as the claude error
    // marker: a provider failure can arrive with a success subtype.
    if (field(last, "is_error")) {
      return { error: "claude run ended with is_error set" };
    }
    const result = field(last, "result");
    if (typeof result !== "string" || result.trim() === "") {
      return { error: "claude run ended with no result text" };
    }
    return { message: result };
  }
  if (harness === "pi") {
    const ends = events.filter(
      (e) =>
        field(e, "type") === "message_end" && field(field(e, "message"), "role") === "assistant",
    );
    if (ends.length === 0) return { error: "pi stream has no assistant message" };
    const content = field(field(ends[ends.length - 1], "message"), "content");
    const texts = Array.isArray(content)
      ? content
          .filter((b) => isTable(b) && b.type === "text" && typeof b.text === "string")
          .map((b) => (b as Record<string, unknown>).text as string)
      : [];
    const said = texts.join("\n");
    if (said.trim() === "") return { error: "pi run ended with no text" };
    return { message: said };
  }
  if (harness === "muse") {
    const terms = events.filter(
      (e) =>
        typeof field(e, "payload_type") === "string" &&
        String(field(e, "payload_type")).startsWith("run.terminal."),
    );
    if (terms.length === 0) return { error: "muse stream has no terminal record" };
    const last = terms[terms.length - 1]!;
    const text = field(field(last, "payload"), "text");
    if (
      field(last, "payload_type") !== "run.terminal.completed" ||
      typeof text !== "string" ||
      text.trim() === ""
    ) {
      return { error: "muse run did not complete with text" };
    }
    return { message: text };
  }
  if (harness === "mimo") {
    // harnesses.md: a failed run exits 0 with an error event, so the text
    // is trusted only when the stream holds no error event. No step_finish
    // shape is required: the recorded close is informative, not a gate.
    if (events.some((e) => field(e, "type") === "error")) {
      return { error: "mimo run emitted an error event" };
    }
    const texts = events.filter(
      (e) => field(e, "type") === "text" && typeof field(field(e, "part"), "text") === "string",
    );
    if (texts.length === 0) return { error: "mimo stream has no text event" };
    const said = String(field(field(texts[texts.length - 1], "part"), "text"));
    if (said.trim() === "") return { error: "mimo run ended with no text" };
    return { message: said };
  }
  return { error: `${harness} has no recorded final-message shape` };
}

/** buildPrompt: the surveyor's prompt names the skill and only the copied paths. */
export function buildPrompt(
  skillFile: string,
  scratch: string,
  question: string,
  materials: string[],
): string {
  const files =
    materials.length === 0
      ? "Your materials: none. Answer from the question and the code."
      : `Your materials are these files, and nothing else:\n${materials.join("\n")}`;
  return `Read ${skillFile} and follow it. It is the whole of your instructions.

Your question is in this file:
${question}

${files}

The code you may read is the checkout at:
${scratch}

Read only the files above and the code. Change nothing. Answer as your final message.
`;
}

// --- edges -------------------------------------------------------------------------------

function refuse(msg: string): never {
  console.error(`surveyor: ${msg}`);
  process.exit(2);
}

function fail(msg: string): never {
  console.error(`surveyor: ${msg}`);
  process.exit(1);
}

function tool(
  args: string[],
  env?: Record<string, string | undefined>,
): {
  code: number;
  out: string;
  err: string;
} {
  return run(join(HERE, "run"), args, env === undefined ? {} : { env });
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function actionCount(dispatch: string): number {
  try {
    return readFileSync(join(dispatch, "actions.jsonl"), "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "").length;
  } catch {
    return 0;
  }
}

interface WallHit {
  message: string;
}

/** The latest wall line for the lane appended past the snapshot count, if any. */
function appendedWall(dispatch: string, lane: string, past: number): WallHit | null {
  let text = "";
  try {
    text = readFileSync(join(dispatch, "actions.jsonl"), "utf8");
  } catch {
    return null;
  }
  const rows = text.split("\n").filter((l) => l.trim() !== "");
  let hit: WallHit | null = null;
  for (const row of rows.slice(past)) {
    let e: unknown;
    try {
      e = JSON.parse(row) as unknown;
    } catch {
      continue;
    }
    if (!isTable(e) || e.action !== "wall" || e.target !== lane) continue;
    const detail = typeof e.detail === "string" ? e.detail : "";
    // The line is four space-separated tokens and the message; the tokens
    // hold no spaces, so the message is everything past the fourth.
    const parts = detail.split(" ");
    hit = { message: parts.length > 4 ? parts.slice(4).join(" ") : detail };
  }
  return hit;
}

function recordLine(
  dispatch: string,
  actor: string,
  verb: string,
  target: string,
  detail: string,
): boolean {
  return tool(["log-action", dispatch, actor, verb, target, detail]).code === 0;
}

function runLog(dispatch: string, text: string): void {
  const r = tool(["run-log", dispatch, text]);
  if (r.code !== 0) console.error(`surveyor: run-log.md did not take: ${text}`);
}

// --- lane --------------------------------------------------------------------------------

/** Read the run's config, failing closed when the dispatch is malformed. */
function runConfig(dispatch: string): Record<string, unknown> {
  const data = tryJsonFile<Record<string, unknown>>(join(dispatch, "run.json"));
  if (!data) fail(`cannot read ${join(dispatch, "run.json")}: it does not parse`);
  if (!isTable(data.config)) fail(`${join(dispatch, "run.json")} records no config`);
  return data.config as Record<string, unknown>;
}

function laneCmd(dispatch: string): never {
  if (!isDir(dispatch)) fail(`no such dispatch directory: ${dispatch}`);
  const config = runConfig(dispatch);
  const lanes = isTable(config.lanes) ? config.lanes : {};
  const picked = configuredSurveyor(config);
  if ("refusal" in picked) refuse(picked.refusal);
  if ("lane" in picked) {
    console.log(`${picked.lane}\nsource: team.surveyor`);
    process.exit(0);
  }
  const brief = join(dispatch, "brief.md");
  if (!isFile(brief)) fail(`no such waybill: ${brief}`);
  const r = tool(["reviewers", "first", brief]);
  if (r.code === 2) {
    refuse(r.err.trim().split("\n")[0] ?? "the waybill names no reviewers");
  }
  if (r.code !== 0) fail(`reviewers first ${brief} failed: ${(r.err || r.out).trim()}`);
  const lane =
    r.out
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "")[0] ?? "";
  if (lane === "") fail(`reviewers first ${brief} printed no lane`);
  if (!isTable(lanes[lane])) refuse(`reviewer ${lane} is not a lane in run.json`);
  console.log(`${lane}\nsource: waybill reviewers`);
  process.exit(0);
}

// --- call --------------------------------------------------------------------------------

interface CallArgs {
  dispatch: string;
  repo: string;
  name: string;
  snapshot: string;
  question: string;
  materials: string[];
  timeout: number;
}

function callArgs(argv: string[]): CallArgs {
  const usage = (): never => fail(USAGE);
  if (argv.length < 2) usage();
  const dispatch = argv[0] ?? "";
  const repo = argv[1] ?? "";
  let name = "";
  let snapshot = "";
  let question = "";
  const materials: string[] = [];
  let timeoutRaw = "";
  let i = 2;
  while (i < argv.length) {
    const a = argv[i] ?? "";
    if (a === "--name" || a === "--snapshot" || a === "--question" || a === "--timeout") {
      const v = argv[i + 1];
      if (v === undefined || v === "") usage();
      if (a === "--name") name = v;
      else if (a === "--snapshot") snapshot = v;
      else if (a === "--question") question = v;
      else timeoutRaw = v;
      i += 2;
    } else if (a === "--material") {
      const v = argv[i + 1];
      if (v === undefined || v === "") usage();
      materials.push(v);
      i += 2;
    } else {
      usage();
    }
  }
  if (name === "" || snapshot === "" || question === "" || timeoutRaw === "") usage();
  const badName = validName(name);
  if (badName !== null) refuse(badName);
  const timeout = validTimeout(timeoutRaw);
  if (timeout === null)
    refuse(`timeout ${timeoutRaw} is not a whole number of seconds from 1 to 86400`);
  return { dispatch, repo, name, snapshot, question, materials, timeout };
}

/** Keep the answer or the reason, with its one action line; rollback on a failed line. */
function keep(
  record: string,
  text: string,
  dispatch: string,
  verb: "harvest" | "degrade",
  target: string,
  detail: string,
  code: number,
): never {
  try {
    mkdirSync(dirname(record), { recursive: true });
    writeFileSync(record, text);
  } catch (e) {
    fail(`cannot write ${record}: ${String(e)}`);
  }
  if (!recordLine(dispatch, "coachman", verb, target, detail)) {
    rmSync(record, { force: true });
    fail(`actions.jsonl did not take the ${verb} line; removed ${record}`);
  }
  console.log(record);
  process.exit(code);
}

function callCmd(argv: string[]): never {
  const a = callArgs(argv);
  if (!isDir(a.dispatch)) fail(`no such dispatch directory: ${a.dispatch}`);
  if (!isDir(a.repo)) fail(`no such repo: ${a.repo}`);
  const record = join(a.dispatch, "surveys", `${a.name}.md`);
  if (existsSync(record)) refuse(`survey ${a.name} is already recorded`);
  const config = runConfig(a.dispatch);
  const lanes = isTable(config.lanes) ? config.lanes : {};
  const ticket = basename(a.dispatch);

  const snap = run("git", ["-C", a.repo, "rev-parse", "--verify", "-q", `${a.snapshot}^{commit}`]);
  if (snap.code !== 0 || snap.out.trim() === "") {
    refuse(`no such commit in ${a.repo}: ${a.snapshot}`);
  }
  const sha = snap.out.trim();

  const listed: Array<{ path: string; what: string }> = [{ path: a.question, what: "question" }];
  for (const m of a.materials) listed.push({ path: m, what: "material" });
  const copies: string[] = [];
  let dispatchReal = "";
  try {
    dispatchReal = realpathSync(a.dispatch);
  } catch {
    fail(`cannot resolve ${a.dispatch}`);
  }
  for (const { path, what } of listed) {
    if (!existsSync(path)) refuse(`no such ${what} file: ${path}`);
    if (!isFile(path)) refuse(`not a file: ${path}`);
    let real = "";
    try {
      real = realpathSync(path);
    } catch {
      refuse(`cannot resolve ${path}`);
    }
    if (gateMaterial(dispatchReal, real) === "refused") {
      refuse(`${path} is in the run's records but is not the ticket or a reviewer's report`);
    }
    copies.push(real);
  }

  let lane = "";
  let source = "";
  const picked = configuredSurveyor(config);
  if ("refusal" in picked) refuse(picked.refusal);
  if ("lane" in picked) {
    lane = picked.lane;
    source = "team.surveyor";
  } else {
    const brief = join(a.dispatch, "brief.md");
    if (!isFile(brief)) fail(`no such waybill: ${brief}`);
    const r = tool(["reviewers", "first", brief]);
    if (r.code === 2) refuse(r.err.trim().split("\n")[0] ?? "the waybill names no reviewers");
    if (r.code !== 0) fail(`reviewers first ${brief} failed: ${(r.err || r.out).trim()}`);
    lane =
      r.out
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l !== "")[0] ?? "";
    if (lane === "") fail(`reviewers first ${brief} printed no lane`);
    source = "waybill reviewers";
  }
  const spec = lanes[lane];
  if (!isTable(spec)) refuse(`reviewer ${lane} is not a lane in run.json`);
  const harness = typeof spec.harness === "string" ? spec.harness : "";
  if (harness === "") refuse(`lane ${lane} names no harness in run.json`);
  if (!SURVEYOR_HARNESSES.has(harness)) {
    refuse(
      `${harness} has no recorded final-message shape; name a lane on ${SURVEYOR_HARNESS_HELP}`,
    );
  }

  const logs = join(a.dispatch, "logs");
  try {
    mkdirSync(logs, { recursive: true });
  } catch {
    fail(`cannot write ${logs}`);
  }
  for (const f of [
    `survey-${a.name}.done`,
    `survey-${a.name}-events.jsonl`,
    `survey-${a.name}.err`,
    `survey-${a.name}-last.md`,
    `survey-${a.name}.exit`,
  ]) {
    rmSync(join(logs, f), { force: true });
  }
  const scratch = join(a.repo, ".worktrees", `${ticket}-survey-${a.name}`);
  if (existsSync(scratch)) {
    const removed = tool(["cut-scratch", "--remove", a.repo, scratch]);
    if (removed.code === 0) {
      recordLine(
        a.dispatch,
        "coachman",
        "teardown",
        scratch,
        "survey scratch left by an interrupted call",
      );
    }
  }
  const cut = run(join(HERE, "run"), ["cut-scratch", a.repo, a.repo, scratch, sha], {
    env: { DEPS_DIRS: "" },
  });
  if (cut.code !== 0) {
    fail(`could not cut ${scratch} at ${sha}: ${(cut.err || cut.out).trim()}`);
  }
  const uncut = (): void => {
    tool(["cut-scratch", "--remove", a.repo, scratch]);
  };
  const folder = join(scratch, ".survey");
  if (existsSync(folder)) {
    uncut();
    fail(`${folder} is in the checkout at ${sha}; the call needs that folder`);
  }
  const dests: string[] = [];
  try {
    mkdirSync(folder, { recursive: true });
    const questionDest = join(folder, "question.md");
    copyFileSync(copies[0] ?? "", questionDest);
    dests.push(questionDest);
    copies.slice(1).forEach((src, n) => {
      const dest = join(folder, `material-${n + 1}-${basename(src)}`);
      copyFileSync(src, dest);
      dests.push(dest);
    });
  } catch (e) {
    uncut();
    fail(`cannot stage the surveyor's folder: ${String(e)}`);
  }

  const pinned = tool(["run-meta", "path", a.dispatch]);
  if (pinned.code !== 0 || pinned.out.trim() === "") {
    uncut();
    fail(`run-meta path ${a.dispatch} failed: ${(pinned.err || pinned.out).trim()}`);
  }
  const promptFile = join(a.dispatch, `survey-${a.name}-prompt.txt`);
  try {
    writeFileSync(
      promptFile,
      `${buildPrompt(join(pinned.out.trim(), "skills", "surveyor", "SKILL.md"), scratch, dests[0] ?? "", dests.slice(1))}\n`,
    );
  } catch (e) {
    uncut();
    fail(`cannot write ${promptFile}: ${String(e)}`);
  }

  const events = join(logs, `survey-${a.name}-events.jsonl`);
  const err = join(logs, `survey-${a.name}.err`);
  const done = join(logs, `survey-${a.name}.done`);
  const last = join(logs, `survey-${a.name}-last.md`);
  const exitFile = join(logs, `survey-${a.name}.exit`);
  const past = actionCount(a.dispatch);
  const named = tool(["host", "name", a.dispatch, "role", "surveyor", a.name]);
  if (named.code !== 0 || named.out.trim() === "") {
    uncut();
    fail(`host name failed: ${(named.err || named.out).trim()}`);
  }
  const entry = join(HERE, "run");
  const started = tool([
    "host",
    "run",
    named.out.trim(),
    scratch,
    "--under",
    a.dispatch,
    "--role",
    "reviewer",
    "--run",
    a.dispatch,
    "--out",
    events,
    "--err",
    err,
    "--marker",
    done,
    "--",
    entry,
    "surveyor",
    "exec",
    exitFile,
    "reviewer",
    entry,
    "launch",
    "launch",
    lane,
    scratch,
    promptFile,
    "--last",
    last,
    "--run",
    a.dispatch,
  ]);
  if (started.code !== 0) {
    uncut();
    fail(`the surveyor did not start: ${(started.err || started.out).trim()}`);
  }
  runLog(a.dispatch, `survey ${a.name}: ${lane} launched at ${sha.slice(0, 12)} (${source})`);

  const wait = tool(["wait-for-markers", logs, `survey-${a.name}.done`, "1", String(a.timeout)]);
  if (wait.code !== 1 && wait.code !== 0 && wait.code !== 3) {
    tool(["host", "stop", scratch]);
    fail(`the wait ended with exit ${wait.code}, so nothing is recorded`);
  }
  if (wait.code === 1) {
    tool(["host", "stop", scratch]);
    fail(`the wait failed: ${(wait.err || wait.out).trim()}`);
  }
  if (wait.code === 3) {
    const stop = tool(["host", "stop", scratch]);
    const stopped = stop.code === 0;
    const reason = stopped
      ? `No answer: still running at the ${a.timeout}s deadline; stopped.\n`
      : `No answer: still running at the ${a.timeout}s deadline; the lane could not be stopped: ${(stop.out || stop.err).trim().split("\n")[0] ?? ""}.\n`;
    const cause = stopped
      ? `timeout after ${a.timeout}s`
      : `timeout after ${a.timeout}s, stop failed: ${(stop.out || stop.err).trim().split("\n")[0] ?? ""}`;
    runLog(a.dispatch, `survey ${a.name}: ${lane} gave no answer (${cause})`);
    keep(record, reason, a.dispatch, "degrade", lane, `survey ${a.name}: ${cause}`, 3);
  }

  let exitText = "";
  try {
    exitText = readFileSync(exitFile, "utf8").trim();
  } catch {
    exitText = "";
  }
  if (!/^[0-9]+$/u.test(exitText)) {
    let why = "no exit recorded";
    try {
      const first = readFileSync(err, "utf8")
        .split("\n")
        .filter((l) => l.trim() !== "")[0];
      if (first) why = first.trim();
    } catch {
      /* keep the default */
    }
    fail(`the launch did not start: ${why}`);
  }
  const code = parseInt(exitText, 10);
  const wall = appendedWall(a.dispatch, lane, past);
  if (wall !== null) {
    // A wall during the call fails the call, whatever else the stream
    // holds: a turn the provider cut short answers nothing. A wall line a
    // concurrent call on this lane wrote reads the same way; the call fails
    // closed instead of guessing whose it was.
    const reason = `No answer: provider wall: "${wall.message}".\n`;
    const cause = `provider wall: "${wall.message}"`;
    runLog(a.dispatch, `survey ${a.name}: ${lane} gave no answer (${cause})`);
    keep(record, reason, a.dispatch, "degrade", lane, `survey ${a.name}: ${cause}`, 3);
  }
  if (code !== 0) {
    const reason = `No answer: the surveyor lane exited ${code}.\n`;
    runLog(a.dispatch, `survey ${a.name}: ${lane} gave no answer (exit ${code})`);
    keep(record, reason, a.dispatch, "degrade", lane, `survey ${a.name}: exit ${code}`, 3);
  }
  let eventsText: string | null = null;
  try {
    eventsText = readFileSync(events, "utf8");
  } catch {
    eventsText = null;
  }
  if (eventsText === null) fail(`the launch exited 0 but wrote no stream at ${events}`);
  let lastText: string | null = null;
  if (harness === "codex") {
    try {
      lastText = readFileSync(last, "utf8");
    } catch {
      lastText = null;
    }
  }
  const answer = finalMessage(harness, eventsText, lastText);
  if ("error" in answer) {
    const reason = `No answer: ${answer.error}.\n`;
    runLog(a.dispatch, `survey ${a.name}: ${lane} gave no answer (${answer.error})`);
    keep(record, reason, a.dispatch, "degrade", lane, `survey ${a.name}: ${answer.error}`, 3);
  }
  const kept = answer.message.endsWith("\n") ? answer.message : `${answer.message}\n`;
  runLog(a.dispatch, `survey ${a.name}: ${lane} answered`);
  keep(record, kept, a.dispatch, "harvest", a.name, `surveyor ${lane} answered`, 0);
}

// --- exec --------------------------------------------------------------------------------

/** exec <exit-file> <role> <command>...: run it as the role, record its exit, exit with it. */
function execCmd(argv: string[]): never {
  if (argv.length < 3 || argv[0] === "") fail(USAGE);
  const exitFile = argv[0] ?? "";
  const role = argv[1] ?? "";
  if (role !== "lane" && role !== "coachman" && role !== "reviewer") fail(USAGE);
  const cmd = argv[2] ?? "";
  const args = argv.slice(3);
  let code: number;
  let signal: string | null = null;
  try {
    const r = spawnSync(cmd, args, {
      stdio: "inherit",
      env: { ...process.env, POSTMASTER_LAUNCH_ROLE: role },
    });
    const error = r.error as NodeJS.ErrnoException | undefined;
    if (error && (r.status === null || r.status === undefined) && !r.signal) {
      code = error.code === "ENOENT" ? 127 : 126;
    } else if (r.status !== null && r.status !== undefined) {
      code = r.status;
    } else if (r.signal) {
      signal = r.signal;
      code = signalExitCode(r.signal);
    } else {
      code = 1;
    }
  } catch {
    code = 1;
  }
  try {
    writeFileSync(exitFile, `${code}\n`);
  } catch (e) {
    fail(`cannot write ${exitFile}: ${String(e)}`);
  }
  if (signal) {
    // As the launch ends: a harness dead by a signal dies as one.
    try {
      process.kill(process.pid, signal);
    } catch {
      /* fall through to the coded exit */
    }
    process.exit(code);
  }
  process.exit(code);
}

// --- entry -----------------------------------------------------------------------------------

if (import.meta.main) {
  const argv = process.argv.slice(2);
  if (argv[0] === "lane" && argv.length === 2) laneCmd(argv[1] ?? "");
  else if (argv[0] === "call") callCmd(argv.slice(1));
  else if (argv[0] === "exec") execCmd(argv.slice(1));
  else fail(USAGE);
}
