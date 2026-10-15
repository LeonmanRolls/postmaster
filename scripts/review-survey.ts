// The rise survey: when a review loop stops because a round found more
// serious defects than the round before, the surveyor reports why before the
// user decides (#329).
//
//   run review-survey survey <dispatch> <repo> <round> [--snapshot <sha>]
//   run review-survey escalate <dispatch> <round> --decision <line> --coachman <file>
//   run review-survey question <dispatch>
//
// survey asks review-decide for the stop's cause: anything but `RULING rise`
// ends with exit 2 and nothing launched. On a rise it writes the rounds file
// — the finding, review-launch and degrade lines to the stop, the serious
// count per round as the decision counts it, and each round's snapshot —
// calls the surveyor with the ticket, the reviewers' reports and the rounds
// file, waits, and prints the survey record. escalate renders ESCALATION.md
// from the survey and the coachman's Residue, Options and Advice sections.
// question renders .waiting-on-user from the escalation and the survey, with
// the survey's plain words before the options.
//
// The surveyor call goes through POSTMASTER_SURVEYOR_RUN when set, else
// scripts/run; tests stand a recording stub in for the call behind it. The
// snapshot is --snapshot when given, else the target of the round's last
// gate line opening `review round <k>`; the 268r8 and 335r6 stops have no
// such line, so old records pass it explicitly. The timeout is
// review.round_timeout_seconds from run.json, 2400 when absent, as
// review-round reads it.
//
//   exit 0  surveyed and answered; the escalation or question rendered, its path printed
//   exit 2  no survey (survey) or no rise escalation (question); the reason printed, nothing written
//   exit 3  a rise without an answer (survey); the record says why, its path printed,
//           the reason printed beside it. A no-answer record is retried, never
//           terminal: only an answered record is reused.
//   exit 1  usage, unreadable records, a malformed survey input, or an unwritten file
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { scriptsDir } from "./lib/paths.ts";
import { mkstempSync, run } from "./lib/proc.ts";
import { PY_S_CLASS, pyLower, pyTrim, pyWords } from "./lib/text.ts";
import { gateMaterial } from "./surveyor.ts";

const HERE = scriptsDir(import.meta);
const USAGE =
  "usage: run review-survey survey <dispatch> <repo> <round> [--snapshot <sha>] | escalate <dispatch> <round> --decision <line> --coachman <file> | question <dispatch>";
const QUESTION_FILE = join(HERE, "..", "skills", "postmaster", "review-rise-question.md");
const DEFAULT_TIMEOUT = 2400;

export const PARTS = [
  "What the findings share",
  "Where the cause lies",
  "What is still open",
  "Whether another round is likely to help",
];

const ROUND_RE = /^[1-9][0-9]*$/u;
const FINDING_ROUND_RE = /^r([1-9][0-9]*)$/u;
const LAUNCH_ROUND_RE = /^[1-9][0-9]*$/u;
const DEGRADE_R_RE = /^r([1-9][0-9]*):$/u;
const DEGRADE_N_RE = /^([1-9][0-9]*):$/u;
const LENIENT_RE = new RegExp(
  `^[^${PY_S_CLASS}]+[${PY_S_CLASS}]+(?:round[${PY_S_CLASS}]+([1-9][0-9]*)|r([1-9][0-9]*))(?:[${PY_S_CLASS}]|$)`,
  "u",
);
const REPORT_ROUND_RE = /^review-r([0-9]+)-/u;
const HEADING_RE = new RegExp(`^#{1,6}[${PY_S_CLASS}]+`, "u");
const SECTION_RE = new RegExp(`^##[${PY_S_CLASS}]+(.*)$`, "u");
const PARA_RE = new RegExp(`\\n[${PY_S_CLASS}]*\\n`, "u");
const CAUSE_RE = new RegExp(`^(RUN|STOP|RULING) [^${PY_S_CLASS}]+$`, "u");
const NO_ANSWER = "No answer:";

/** parseRound <raw>: the round, or null when out of shape. */
export function parseRound(raw: string): number | null {
  if (!ROUND_RE.test(raw)) return null;
  return parseInt(raw, 10);
}

/** findingRound <detail>: the round, strictly as review-decide reads it. */
export function findingRound(detail: string): number | null {
  const w = pyWords(detail);
  if (w[0] !== "gating" && w[0] !== "style") return null;
  if (w[1] !== "P1" && w[1] !== "P2" && w[1] !== "P3") return null;
  const m = FINDING_ROUND_RE.exec(w[2] ?? "");
  return m?.[1] === undefined ? null : parseInt(m[1], 10);
}

/** findingCounts <detail>: 1 when the line counts serious, else 0. Faults on a malformed line. */
export function findingCounts(detail: string): number {
  const w = pyWords(detail);
  if (w[0] !== "gating" && w[0] !== "style") {
    throw new Error(
      `a finding whose detail opens with ${w.length > 0 ? `"${w[0]}"` : "nothing"}, not gating or style`,
    );
  }
  if (w[1] !== "P1" && w[1] !== "P2" && w[1] !== "P3") {
    throw new Error(`a finding with severity ${w[1] ?? "none"}, not P1, P2 or P3`);
  }
  const m = FINDING_ROUND_RE.exec(w[2] ?? "");
  if (!m) throw new Error(`a finding with round ${w[2] ?? "none"}, not rN`);
  return w[0] === "gating" && (w[1] === "P1" || w[1] === "P2") ? 1 : 0;
}

function lenientRound(detail: string): number | null {
  const m = LENIENT_RE.exec(detail);
  const n = m?.[1] ?? m?.[2];
  return n === undefined ? null : parseInt(n, 10);
}

/** launchRound <detail>: the round, strictly, else a lenient lens-and-round read. */
export function launchRound(detail: string): number | null {
  const w = pyWords(detail);
  if (w[1] === "round" && LAUNCH_ROUND_RE.test(w[2] ?? "")) return parseInt(w[2] ?? "0", 10);
  return lenientRound(detail);
}

/** degradeRound <detail>: the round, strictly, else a lenient lens-and-round read. */
export function degradeRound(detail: string): number | null {
  const w = pyWords(detail);
  if (w[1] === "round" && w.length >= 3) {
    const m = DEGRADE_N_RE.exec(w[2] ?? "");
    if (m?.[1] !== undefined) return parseInt(m[1], 10);
  } else if (w.length >= 2) {
    const m = DEGRADE_R_RE.exec(w[1] ?? "");
    if (m?.[1] !== undefined) return parseInt(m[1], 10);
  }
  return lenientRound(detail);
}

/** gateRound <detail> <k>: whether the line opens `review round <k>`, on a word boundary. */
export function gateRound(detail: string, k: number): boolean {
  const prefix = `review round ${k}`;
  if (!detail.startsWith(prefix)) return false;
  return !/[0-9]/u.test(detail.charAt(prefix.length));
}

function normalize(text: string): string {
  return pyTrim(pyLower(text).replace(/[^a-z0-9]+/gu, " "));
}

/** missingParts <answer>: the four parts with no heading carrying their name, in order. */
export function missingParts(answer: string): string[] {
  const headings = answer
    .split("\n")
    .filter((l) => HEADING_RE.test(l))
    .map(normalize);
  return PARTS.filter((p) => {
    const key = normalize(p);
    return !headings.some((h) => h.includes(key));
  });
}

/** plainWords <answer>: the closing paragraph the user reads before the options. */
export function plainWords(answer: string): string {
  const paras = answer
    .split(PARA_RE)
    .map((p) => pyTrim(p))
    .filter((p) => p !== "");
  const words = paras.filter((p) => {
    const lines = p.split("\n").filter((l) => pyTrim(l) !== "");
    return !(lines.length === 1 && HEADING_RE.test(lines[0] ?? ""));
  });
  return words.length === 0 ? "" : (words[words.length - 1] ?? "");
}

/** readSections <text> <names>: the first ## section per name, or the names missing or empty. */
export function readSections(
  text: string,
  names: string[],
): { values: Map<string, string> } | { missing: string[] } {
  const values = new Map<string, string>();
  const wanted = new Map(names.map((n) => [normalize(n), n] as [string, string]));
  let current: string | null = null;
  const body: string[] = [];
  const close = (): void => {
    if (current !== null) {
      const name = wanted.get(current) ?? current;
      if (!values.has(name)) values.set(name, body.join("\n").trim());
    }
    current = null;
    body.length = 0;
  };
  for (const line of text.split("\n")) {
    const heading = SECTION_RE.exec(line);
    if (heading) {
      close();
      const key = normalize(heading[1] ?? "");
      if (wanted.has(key)) current = key;
    } else if (current !== null) {
      body.push(line);
    }
  }
  close();
  const missing = names.filter((n) => (values.get(n) ?? "") === "");
  return missing.length > 0 ? { missing } : { values };
}

/** renderEscalation: the rise escalation, byte for byte. */
export function renderEscalation(
  round: number,
  decision: string,
  survey: { record: string; missing: string[] } | { reason: string },
  sections: { residue: string; options: string; advice: string },
): string {
  const head = `# Escalation: review loop stopped at round ${round}\n\nDecision: ${decision}\n`;
  const surveyLine =
    "record" in survey
      ? `Survey: ${survey.record}\n${survey.missing.length > 0 ? `Missing parts: ${survey.missing.join("; ")}\n` : ""}`
      : `Survey missing: ${survey.reason}\n`;
  return (
    `${head}${surveyLine}\n## Residue\n\n${sections.residue}\n\n` +
    `## Options\n\n${sections.options}\n\n## Advice\n\n${sections.advice}\n`
  );
}

/** renderQuestion: the plain words (or the missing reason) before the options. */
export function renderQuestion(
  first: string,
  sections: { options: string; advice: string },
): string {
  return `${first}\n\n## Options\n\n${sections.options}\n\n## Advice\n\n${sections.advice}\n`;
}

// --- edges -------------------------------------------------------------------------------

function fail(msg: string): never {
  console.error(`review-survey: ${msg}`);
  process.exit(1);
}

function usage(): never {
  console.error(USAGE);
  process.exit(1);
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function tool(args: string[]): { code: number; out: string; err: string } {
  const r = run(join(HERE, "run"), args);
  return { code: r.code, out: r.out, err: r.err };
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
  if (tool(["run-log", dispatch, text]).code !== 0) {
    console.error(`review-survey: run-log.md did not take: ${text}`);
  }
}

function surveyName(round: number): string {
  return `rise-r${round}`;
}

function recordPath(dispatch: string, round: number): string {
  return join(dispatch, "surveys", `${surveyName(round)}.md`);
}

function writeRecord(dispatch: string, round: number, text: string): string {
  const record = recordPath(dispatch, round);
  try {
    mkdirSync(join(dispatch, "surveys"), { recursive: true });
    writeFileSync(record, text);
  } catch (e) {
    fail(`cannot write ${record}: ${String(e)}`);
  }
  return record;
}

function noAnswerReason(content: string): string | null {
  if (!content.startsWith(NO_ANSWER)) return null;
  const first = content.split("\n")[0] ?? "";
  const reason = first.slice(NO_ANSWER.length).trim();
  return reason === "" ? "(no reason recorded)" : reason;
}

/** resolveTimeout <dispatch>: the survey's seconds; the default when absent, warned when wrong. */
export function resolveTimeout(dispatch: string): number {
  const path = join(dispatch, "run.json");
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return DEFAULT_TIMEOUT;
    console.error(
      `review-survey: ${path} cannot be read; the survey timeout is the default, ${DEFAULT_TIMEOUT}s`,
    );
    return DEFAULT_TIMEOUT;
  }
  let value: unknown;
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    const config = data.config as Record<string, unknown> | undefined;
    const review = config?.review as Record<string, unknown> | undefined;
    value = review?.round_timeout_seconds;
  } catch {
    console.error(
      `review-survey: ${path} does not parse; the survey timeout is the default, ${DEFAULT_TIMEOUT}s`,
    );
    return DEFAULT_TIMEOUT;
  }
  if (value === undefined || value === null) return DEFAULT_TIMEOUT;
  if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 86400) {
    return value;
  }
  console.error(
    `review-survey: review.round_timeout_seconds in ${path} is ${JSON.stringify(value)}, not a whole number of seconds from 1 to 86400; the survey timeout is the default, ${DEFAULT_TIMEOUT}s`,
  );
  return DEFAULT_TIMEOUT;
}

interface ActionLine {
  action: string;
  target: string;
  detail: string;
  raw: string;
}

/** readActions <dispatch>: the run's lines, faulting where review-decide would. */
function readActions(dispatch: string): ActionLine[] {
  const path = join(dispatch, "actions.jsonl");
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    fail(`cannot read ${path}: ${(e as Error)?.message ?? String(e)}`);
  }
  const out: ActionLine[] = [];
  text.split("\n").forEach((line, idx) => {
    if (line.trim() === "") return;
    let e: unknown;
    try {
      e = JSON.parse(line) as unknown;
    } catch {
      fail(`actions.jsonl line ${idx + 1} is not JSON`);
    }
    if (typeof e !== "object" || e === null || Array.isArray(e)) {
      fail(`actions.jsonl line ${idx + 1} is not an action object`);
    }
    const rec = e as Record<string, unknown>;
    if (typeof rec.action !== "string" || rec.action === "") {
      fail(`actions.jsonl line ${idx + 1} has no action`);
    }
    out.push({
      action: rec.action,
      target: typeof rec.target === "string" ? rec.target : "",
      detail: typeof rec.detail === "string" ? rec.detail : "",
      raw: line,
    });
  });
  return out;
}

/** collectReports <dispatch> <stop>: the reviewers' reports to the stop, sorted. */
function collectReports(dispatch: string, stop: number): string[] {
  let dispatchReal: string;
  try {
    dispatchReal = realpathSync(dispatch);
  } catch {
    fail(`cannot resolve ${dispatch}`);
  }
  let names: string[];
  try {
    names = readdirSync(join(dispatch, "logs"));
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of names.sort()) {
    let real = "";
    try {
      real = realpathSync(join(dispatch, "logs", name));
    } catch {
      continue;
    }
    if (gateMaterial(dispatchReal, real) !== "report") continue;
    const m = REPORT_ROUND_RE.exec(name);
    if (m?.[1] === undefined || parseInt(m[1], 10) > stop) continue;
    out.push(join(dispatch, "logs", name));
  }
  return out;
}

/** buildRounds: the rounds file's text, with counts and per-round snapshots. */
export function buildRounds(lines: ActionLine[], stop: number, snapshot: string): string {
  const kept: string[] = [];
  const counts = Array.from({ length: stop }, () => 0);
  const snaps = Array.from({ length: stop }, (): string | null => null);
  lines.forEach((line) => {
    if (line.action === "finding") {
      const round = findingRound(line.detail);
      if (round === null || round > stop) {
        if (round === null) {
          try {
            findingCounts(line.detail);
          } catch (e) {
            throw new Error((e as Error).message);
          }
        }
        return;
      }
      kept.push(line.raw);
      counts[round - 1] = (counts[round - 1] ?? 0) + findingCounts(line.detail);
    } else if (line.action === "review-launch" || line.action === "degrade") {
      const round =
        line.action === "review-launch" ? launchRound(line.detail) : degradeRound(line.detail);
      if (round === null || round > stop) return;
      kept.push(line.raw);
    } else if (line.action === "gate") {
      for (let k = 1; k <= stop; k++) {
        if (gateRound(line.detail, k)) snaps[k - 1] = line.target;
      }
    }
  });
  snaps[stop - 1] = snapshot;
  const table = (prefix: string, values: (string | number)[]): string =>
    `${prefix}: ${values.map((v, i) => `r${i + 1}=${v}`).join(" ")}`;
  const header = [
    `# Rise survey input: rounds 1 to ${stop}`,
    `survey-snapshot: ${snapshot}`,
    table("counts", counts),
    table(
      "round-snapshots",
      snaps.map((s) => s ?? "not-recorded"),
    ),
  ].join("\n");
  return kept.length === 0 ? `${header}\n\n` : `${header}\n\n${kept.join("\n")}\n`;
}

// --- survey --------------------------------------------------------------------------------

function surveyNote(dispatch: string, name: string, detail: string): void {
  if (!recordLine(dispatch, "coachman", "note", name, detail)) {
    console.error("review-survey: actions.jsonl did not take the note line");
  }
}

/** noAnswer <dispatch> <name> <reason> <record>: every exit-3 end, in one place. */
function noAnswer(dispatch: string, name: string, reason: string, record: string): never {
  surveyNote(dispatch, name, `no answer (${reason})`);
  runLog(dispatch, `rise survey ${name}: no answer (${reason})`);
  console.error(`review-survey: ${reason}`);
  console.log(record);
  process.exit(3);
}

function surveyCmd(argv: string[]): never {
  if (argv.length !== 3 && argv.length !== 5) usage();
  const dispatch = argv[0] ?? "";
  const repo = argv[1] ?? "";
  const roundRaw = argv[2] ?? "";
  if (dispatch === "" || repo === "" || roundRaw === "") usage();
  let flagSnapshot = "";
  if (argv.length === 5) {
    if (argv[3] !== "--snapshot" || argv[4] === "" || argv[4] === undefined) usage();
    flagSnapshot = argv[4];
  }
  if (!isDir(dispatch)) fail(`no dispatch directory at ${dispatch}`);
  if (!isDir(repo)) fail(`no repo directory at ${repo}`);
  const round = parseRound(roundRaw);
  if (round === null) fail(`round is a whole number of 1 or more: ${roundRaw}`);
  const name = surveyName(round);

  const decided = tool(["review-decide", dispatch, String(round), "--cause"]);
  if (decided.code !== 0) {
    const first = decided.err
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "")[0];
    fail(
      `review-decide ${dispatch} ${round} failed with exit ${decided.code}${first ? `: ${first}` : ""}`,
    );
  }
  const cause = decided.out.trim();
  if (!CAUSE_RE.test(cause)) {
    fail(`review-decide printed no cause: ${cause === "" ? "(nothing)" : cause}`);
  }
  if (cause !== "RULING rise") {
    console.log(`no survey: ${cause}`);
    process.exit(2);
  }

  const record = recordPath(dispatch, round);
  let retry = false;
  if (existsSync(record)) {
    let content: string;
    try {
      content = readFileSync(record, "utf8");
    } catch (e) {
      fail(`cannot read ${record}: ${(e as Error)?.message ?? String(e)}`);
    }
    if (noAnswerReason(content) === null) {
      surveyNote(dispatch, name, "already recorded");
      runLog(dispatch, `rise survey ${name}: already recorded`);
      console.log(record);
      process.exit(0);
    }
    // A no-answer record is retried, never terminal: the record goes away
    // before the surveyor runs, since it refuses a name already recorded,
    // and the call below writes a fresh one.
    retry = true;
  }

  if (!existsSync(QUESTION_FILE)) fail(`no question file at ${QUESTION_FILE}`);
  let ticket = join(dispatch, "ticket-body.md");
  if (!existsSync(ticket)) ticket = join(dispatch, "ticket-as-spec.md");
  if (!existsSync(ticket)) {
    const kept = writeRecord(dispatch, round, "No answer: no ticket file in the dispatch\n");
    noAnswer(dispatch, name, "no ticket file in the dispatch", kept);
  }

  const lines = readActions(dispatch);
  let snapshot = flagSnapshot;
  if (snapshot === "") {
    for (const line of lines) {
      if (line.action === "gate" && gateRound(line.detail, round)) snapshot = line.target;
    }
  }
  if (snapshot === "") {
    const kept = writeRecord(
      dispatch,
      round,
      `No answer: no recorded snapshot for round ${round}\n`,
    );
    noAnswer(dispatch, name, `no recorded snapshot for round ${round}`, kept);
  }

  let rounds: string;
  try {
    rounds = buildRounds(lines, round, snapshot);
  } catch (e) {
    fail((e as Error).message);
  }
  const keptRounds = join(dispatch, "surveys", `${name}-rounds.md`);
  const safe = basename(dispatch).replace(/[^A-Za-z0-9._-]+/gu, "_");
  let staged: string;
  try {
    mkdirSync(join(dispatch, "surveys"), { recursive: true });
    writeFileSync(keptRounds, rounds);
    staged = mkstempSync(tmpdir(), `postmaster-rise-${safe}-r${round}-`);
    writeFileSync(staged, rounds);
  } catch (e) {
    fail(`cannot write the rounds file: ${String(e)}`);
  }
  const reports = collectReports(dispatch, round);
  const timeout = resolveTimeout(dispatch);

  if (retry) {
    try {
      rmSync(record, { force: true });
    } catch (e) {
      fail(`cannot remove ${record}: ${String(e)}`);
    }
  }
  const entry = process.env.POSTMASTER_SURVEYOR_RUN ?? join(HERE, "run");
  const call = run(entry, [
    "surveyor",
    "call",
    dispatch,
    repo,
    "--name",
    name,
    "--snapshot",
    snapshot,
    "--question",
    QUESTION_FILE,
    ...[ticket, ...reports, staged].flatMap((m) => ["--material", m]),
    "--timeout",
    String(timeout),
  ]);
  if (call.code === 0 || call.code === 3) {
    let content: string | null = null;
    try {
      content = readFileSync(record, "utf8");
    } catch {
      content = null;
    }
    const usable =
      content !== null &&
      content.trim() !== "" &&
      (call.code === 0 || content.startsWith(NO_ANSWER));
    if (!usable) {
      const kept = writeRecord(
        dispatch,
        round,
        "No answer: the surveyor ended without an answer or a record\n",
      );
      noAnswer(dispatch, name, "the surveyor ended without an answer or a record", kept);
    }
    if (call.code === 0) {
      const refused = noAnswerReason(content ?? "");
      if (refused !== null) noAnswer(dispatch, name, refused, record);
      surveyNote(dispatch, name, `surveyed at ${snapshot.slice(0, 12)}`);
      runLog(dispatch, `rise survey ${name}: answered`);
      console.log(record);
      process.exit(0);
    }
    const reason =
      noAnswerReason(content ?? "") ?? "the surveyor ended without an answer or a record";
    noAnswer(dispatch, name, reason, record);
  }
  const last = call.err
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "")
    .pop();
  let reason = last ?? "";
  if (reason.startsWith("surveyor: ")) reason = reason.slice("surveyor: ".length).trim();
  if (reason === "") reason = `the surveyor call failed with exit ${call.code}`;
  const kept = writeRecord(dispatch, round, `No answer: ${reason}\n`);
  noAnswer(dispatch, name, reason, kept);
}

// --- escalate -------------------------------------------------------------------------------

function sectionProblem(path: string, missing: string[]): string {
  return missing.length === 1
    ? `${path} has no ${missing[0]} section`
    : `${path} has no ${missing.join(", ")} sections`;
}

function escalateCmd(argv: string[]): never {
  if (argv.length !== 6) usage();
  const dispatch = argv[0] ?? "";
  const roundRaw = argv[1] ?? "";
  if (dispatch === "" || roundRaw === "") usage();
  let decision = "";
  let coachman = "";
  for (let i = 2; i < 6; i += 2) {
    const flag = argv[i] ?? "";
    const value = argv[i + 1] ?? "";
    if ((flag !== "--decision" && flag !== "--coachman") || value === "") usage();
    if (flag === "--decision") decision = value;
    else coachman = value;
  }
  if (decision === "" || coachman === "") usage();
  if (!isDir(dispatch)) fail(`no dispatch directory at ${dispatch}`);
  const round = parseRound(roundRaw);
  if (round === null) fail(`round is a whole number of 1 or more: ${roundRaw}`);
  if (!decision.startsWith("RULING ")) fail(`not a ruling: ${decision}`);
  if (!existsSync(coachman)) fail(`no coachman file at ${coachman}`);
  let sections: { residue: string; options: string; advice: string };
  try {
    const parsed = readSections(readFileSync(coachman, "utf8"), ["Residue", "Options", "Advice"]);
    if ("missing" in parsed) fail(sectionProblem(coachman, parsed.missing));
    sections = {
      residue: parsed.values.get("Residue") ?? "",
      options: parsed.values.get("Options") ?? "",
      advice: parsed.values.get("Advice") ?? "",
    };
  } catch (e) {
    fail(`cannot read ${coachman}: ${(e as Error)?.message ?? String(e)}`);
  }

  const name = surveyName(round);
  const rel = `surveys/${name}.md`;
  let survey: { record: string; missing: string[] } | { reason: string };
  let logged: string;
  try {
    const content = readFileSync(join(dispatch, rel), "utf8");
    const reason = noAnswerReason(content);
    if (reason === null) {
      survey = { record: rel, missing: missingParts(content) };
      logged = `review rise round ${round}: survey ${name}`;
    } else {
      survey = { reason };
      logged = `review rise round ${round}: no survey (${reason})`;
    }
  } catch {
    survey = { reason: `no survey was recorded for round ${round}` };
    logged = `review rise round ${round}: no survey (no survey was recorded for round ${round})`;
  }
  const path = join(dispatch, "ESCALATION.md");
  try {
    writeFileSync(path, renderEscalation(round, decision, survey, sections));
    writeFileSync(join(dispatch, ".escalation-ready"), "");
  } catch (e) {
    fail(`cannot write ${path}: ${String(e)}`);
  }
  if (!recordLine(dispatch, "coachman", "escalate", "ESCALATION.md", logged)) {
    fail("the escalation was not recorded");
  }
  console.log(path);
  process.exit(0);
}

// --- question -------------------------------------------------------------------------------

function questionCmd(argv: string[]): never {
  if (argv.length !== 1 || argv[0] === "") usage();
  const dispatch = argv[0] ?? "";
  if (!isDir(dispatch)) fail(`no dispatch directory at ${dispatch}`);
  let escalation: string;
  try {
    escalation = readFileSync(join(dispatch, "ESCALATION.md"), "utf8");
  } catch {
    console.log(`no question: no ESCALATION.md in ${dispatch}`);
    process.exit(2);
  }
  let pointer = "";
  let missing: string | null = null;
  for (const line of escalation.split("\n")) {
    if (line.startsWith("Survey: ")) {
      pointer = line.slice("Survey: ".length).trim();
      break;
    }
    if (line.startsWith("Survey missing: ")) {
      missing = line.slice("Survey missing: ".length).trim();
      if (missing === "") missing = "(no reason recorded)";
      break;
    }
  }
  if (pointer === "" && missing === null) {
    console.log("no question: no survey named in ESCALATION.md");
    process.exit(2);
  }
  let first: string;
  if (missing !== null) {
    first = `Survey missing: ${missing}`;
  } else if (pointer === "") {
    first = "Survey missing: the escalation names no survey record";
  } else {
    const record = pointer.startsWith("/") ? pointer : join(dispatch, pointer);
    let content: string | null = null;
    try {
      content = readFileSync(record, "utf8");
    } catch {
      content = null;
    }
    if (content === null) {
      first = `Survey missing: the survey record ${pointer} could not be read`;
    } else {
      const reason = noAnswerReason(content);
      if (reason !== null) {
        first = `Survey missing: ${reason}`;
      } else {
        const plain = plainWords(content);
        first =
          plain === "" ? `Survey missing: the survey record ${pointer} holds no words` : plain;
      }
    }
  }
  const parsed = readSections(escalation, ["Options", "Advice"]);
  if ("missing" in parsed) fail(sectionProblem(join(dispatch, "ESCALATION.md"), parsed.missing));
  const path = join(dispatch, ".waiting-on-user");
  try {
    writeFileSync(
      path,
      renderQuestion(first, {
        options: parsed.values.get("Options") ?? "",
        advice: parsed.values.get("Advice") ?? "",
      }),
    );
  } catch (e) {
    fail(`cannot write ${path}: ${String(e)}`);
  }
  console.log(path);
  process.exit(0);
}

// --- entry ----------------------------------------------------------------------------------

if (import.meta.main) {
  const argv = process.argv.slice(2);
  if (argv[0] === "survey") surveyCmd(argv.slice(1));
  else if (argv[0] === "escalate") escalateCmd(argv.slice(1));
  else if (argv[0] === "question") questionCmd(argv.slice(1));
  else usage();
}
