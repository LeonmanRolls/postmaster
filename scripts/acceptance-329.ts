// Oracle helpers for #329: when a review loop stops converging, the surveyor
// reports why before the user decides. The tests spawn scripts/run as
// subprocesses; nothing here imports the change. Copies are built from the
// vendored real-record slices under scripts/fixtures/acceptance-329, and the
// surveyor call is stood in for by a recording stub behind
// POSTMASTER_SURVEYOR_RUN, which the step uses instead of scripts/run.
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { beside, toolRoot } from "./lib/paths.ts";
import { PY_S_CLASS, pyWords } from "./lib/text.ts";

export const ROOT = toolRoot(import.meta);
export const RUN = beside(import.meta, "run");
export const FIX = join(ROOT, "scripts", "fixtures", "acceptance-329");

export interface Run {
  code: number;
  out: string;
  err: string;
}

export function both(r: Run): string {
  return `${r.out}${r.err}`;
}

const GIT_ENV: Record<string, string | undefined> = {
  ...process.env,
  GIT_AUTHOR_NAME: "rise-oracle",
  GIT_AUTHOR_EMAIL: "oracle@example.invalid",
  GIT_COMMITTER_NAME: "rise-oracle",
  GIT_COMMITTER_EMAIL: "oracle@example.invalid",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};

export function git(...args: string[]): Run {
  const r = spawnSync("git", args, { encoding: "utf8", env: GIT_ENV });
  return { code: r.status ?? -1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

export function need(r: Run, what: string): void {
  if (r.code !== 0) throw new Error(`${what} failed with exit ${r.code}: ${both(r)}`);
}

export function sh(
  cmd: string,
  args: string[],
  env: Record<string, string | undefined>,
  cwd?: string,
): Run {
  const r = spawnSync(cmd, args, { encoding: "utf8", env, cwd });
  return { code: r.status ?? -1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

export function scratchDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function removeDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

export function writeText(path: string, text: string): void {
  writeFileSync(path, text, "utf8");
}

// --- the ticket's rises and controls -------------------------------------

export interface Rise {
  run: string;
  round: number;
  sha: string;
  decision: string;
  counts: number[];
}

export const RISES: Rise[] = [
  {
    run: "202",
    round: 5,
    sha: "665a99f9d9c08e69c101d7fbfa927afc79b4f231",
    decision: "RULING 5: round 5 logged more P1 or P2 findings than round 4; escalate with residue",
    counts: [12, 4, 3, 2, 4],
  },
  {
    run: "216",
    round: 3,
    sha: "26ba0d01b12af281b118322f42634d6b55b69d2c",
    decision: "RULING 3: round 3 logged more P1 or P2 findings than round 2; escalate with residue",
    counts: [5, 1, 4],
  },
  {
    run: "268",
    round: 8,
    sha: "a0a2e66cb0635443f20e51a145bf017b69c23fa6",
    decision: "RULING 8: round 8 logged more P1 or P2 findings than round 7; escalate with residue",
    counts: [4, 11, 4, 4, 0, 0, 0, 2],
  },
  {
    run: "335",
    round: 6,
    sha: "ad29bc3cb9765ed7dc1887cab67b5da4c5526bae",
    decision: "RULING 6: round 6 logged more P1 or P2 findings than round 5; escalate with residue",
    counts: [7, 3, 2, 1, 1, 2],
  },
  {
    run: "342",
    round: 2,
    sha: "f15ebea26c508ff3a601e8f7802c54404efc59dd",
    decision: "RULING 2: round 2 logged more P1 or P2 findings than round 1; escalate with residue",
    counts: [0, 1],
  },
];

export interface Control {
  run: string;
  round: number;
  decision: string;
  cause: string;
}

export const CONTROLS: Control[] = [
  {
    run: "202",
    round: 4,
    decision: "RUN 5: round 4 logged no more P1 or P2 findings than round 3",
    cause: "RUN converging",
  },
  {
    run: "218",
    round: 3,
    decision: "STOP 3: round 3 logged no P1 or P2 finding",
    cause: "STOP clean",
  },
];

export const FALLING_DECISION =
  "RULING 4: no working reviewer for security in rounds 3 and 4; escalate with residue";

// --- round attribution ----------------------------------------------------
// Findings attribute strictly, as review-decide reads them: a finding whose
// round does not parse is not of any round. Launches and degrades fall back
// to a lenient lens-and-round prefix read, so an oddly spelled but readable
// line (268's round-6 opus degrades) stays with its round; review-decide
// ignores those spellings, so the filter never changes a decision.

const FINDING_ROUND_RE = /^r([1-9][0-9]*)$/u;
const LAUNCH_ROUND_RE = /^[1-9][0-9]*$/u;
const DEGRADE_R_RE = /^r([1-9][0-9]*):$/u;
const DEGRADE_N_RE = /^([1-9][0-9]*):$/u;
const LENIENT_RE = new RegExp(
  `^[^${PY_S_CLASS}]+[${PY_S_CLASS}]+(?:round[${PY_S_CLASS}]+([1-9][0-9]*)|r([1-9][0-9]*))(?:[${PY_S_CLASS}]|$)`,
  "u",
);

export function roundOf(action: string, detail: string): number | null {
  const w = pyWords(detail);
  if (action === "finding") {
    const m = FINDING_ROUND_RE.exec(w[2] ?? "");
    return m?.[1] === undefined ? null : parseInt(m[1], 10);
  }
  if (action === "review-launch" || action === "degrade") {
    if (action === "review-launch") {
      if (w[1] === "round" && LAUNCH_ROUND_RE.test(w[2] ?? "")) return parseInt(w[2] ?? "0", 10);
    } else if (w[1] === "round") {
      const m = DEGRADE_N_RE.exec(w[2] ?? "");
      if (m?.[1] !== undefined) return parseInt(m[1], 10);
    } else {
      const m = DEGRADE_R_RE.exec(w[1] ?? "");
      if (m?.[1] !== undefined) return parseInt(m[1], 10);
    }
    const m = LENIENT_RE.exec(detail);
    const n = m?.[1] ?? m?.[2];
    return n === undefined ? null : parseInt(n, 10);
  }
  return null;
}

const REPORT_RE =
  /^review-r([0-9]+)-(style|bug|security)-[A-Za-z0-9._-]+-(last\.md|findings\.json|findings\.md)$/u;

export function reportRound(name: string): number | null {
  const m = REPORT_RE.exec(name);
  return m?.[1] === undefined ? null : parseInt(m[1], 10);
}

// --- copies ----------------------------------------------------------------

export interface CopyLayout {
  tmp: string;
  dispatch: string;
  repo: string;
  sha: string;
  record: string;
  answerPath: string;
  env: Record<string, string | undefined>;
  cleanup(): void;
}

export interface CopyOpts {
  reports?: boolean;
  ticket?: boolean;
  decoys?: boolean;
  runJson?: Record<string, unknown>;
  inject?: string[];
}

const DECOYS = [
  "brief.md",
  "ESCALATION.md",
  "checkpoint-1.md",
  "checkpoint-review.md",
  "card.md",
  "run-log.md",
  "handoff-1.md",
  "handoff-2.md",
  "review-style-brief.md",
  "review-security-brief.md",
  "review-r1-security-opus-prompt.txt",
  "review-r2-bug-luna-prompt.txt",
];

const STANDIN = `#!/bin/sh
# Stand-in for 'run surveyor call': records argv, then answers per STANDIN_MODE.
{
  echo "--- call ---"
  printf '%s\\n' "$@"
  echo "--- env ---"
  echo "mode=\${STANDIN_MODE:?}"
} >> "\${STANDIN_RECORD:?}"
dispatch="$3"
name=""
prev=""
for a in "$@"; do
  if [ "$prev" = "--name" ]; then name="$a"; fi
  prev="$a"
done
record="$dispatch/surveys/$name.md"
if [ -e "$record" ]; then
  echo "surveyor: survey $name is already recorded" >&2
  echo "exit=2" >> "$STANDIN_RECORD"
  exit 2
fi
case "$STANDIN_MODE" in
  answer)
    mkdir -p "$dispatch/surveys"
    cat "\${STANDIN_ANSWER:?}" > "$record"
    echo "$record"
    echo "exit=0" >> "$STANDIN_RECORD"
    exit 0
    ;;
  noanswer)
    mkdir -p "$dispatch/surveys"
    printf 'No answer: %s\\n' "\${STANDIN_REASON:?}" > "$record"
    echo "$record"
    echo "exit=3" >> "$STANDIN_RECORD"
    exit 3
    ;;
  refuse)
    echo "surveyor: \${STANDIN_REASON:?}" >&2
    echo "exit=2" >> "$STANDIN_RECORD"
    exit 2
    ;;
  fault)
    echo "surveyor: \${STANDIN_REASON:?}" >&2
    echo "exit=1" >> "$STANDIN_RECORD"
    exit 1
    ;;
  norecord)
    echo "exit=3" >> "$STANDIN_RECORD"
    exit 3
    ;;
  *)
    echo "stand-in: unknown STANDIN_MODE: $STANDIN_MODE" >&2
    exit 99
    ;;
esac
`;

function writeStandin(tmp: string): string {
  const bin = join(tmp, "bin");
  mkdirSync(bin, { recursive: true });
  const path = join(bin, "surveyor-run");
  writeFileSync(path, `${STANDIN}\n`, "utf8");
  chmodSync(path, 0o755);
  return path;
}

function initRepo(repo: string): string {
  need(git("init", "-q", "-b", "main", repo), "init repo");
  writeFileSync(join(repo, "README.md"), "rise-oracle fixture\n");
  need(git("-C", repo, "add", "README.md"), "add readme");
  need(git("-C", repo, "commit", "-qm", "init"), "commit init");
  const r = git("-C", repo, "rev-parse", "HEAD");
  need(r, "read sha");
  return r.out.trim();
}

/** A copy of run/stop from the vendored slices, with a stand-in surveyor. */
export function makeCopy(run: string, stop: number, opts: CopyOpts = {}): CopyLayout {
  const tmp = scratchDir("rise-oracle-");
  const dispatch = join(tmp, `copy-${run}-r${stop}`);
  const repo = join(tmp, "proj");
  const logs = join(dispatch, "logs");
  mkdirSync(logs, { recursive: true });
  const sha = initRepo(repo);

  const src = readFileSync(join(FIX, run, "actions.jsonl"), "utf8").split("\n");
  const kept: string[] = [];
  for (const line of src) {
    if (line.trim() === "") continue;
    const e = JSON.parse(line) as { action?: unknown; detail?: unknown };
    const rd =
      typeof e.action === "string" && typeof e.detail === "string"
        ? roundOf(e.action, e.detail)
        : null;
    if (rd !== null && rd <= stop) kept.push(line);
  }
  for (const line of opts.inject ?? []) kept.push(line);
  writeFileSync(join(dispatch, "actions.jsonl"), `${kept.join("\n")}\n`, "utf8");

  if (opts.reports !== false) {
    for (const f of readdirSync(join(FIX, run, "logs"))) {
      const rd = reportRound(f);
      if (rd === null || rd > stop) continue;
      copyFileSync(join(FIX, run, "logs", f), join(logs, f));
    }
  }
  if (opts.ticket !== false) {
    const ticket = join(FIX, run, "ticket-body.md");
    if (existsSync(ticket)) copyFileSync(ticket, join(dispatch, "ticket-body.md"));
  }
  if (opts.decoys !== false) {
    for (const d of DECOYS) {
      writeFileSync(join(dispatch, d), `# Decoy ${d}: must never reach the surveyor.\n`, "utf8");
    }
    // run-log.md doubles as the copy's narrative; actions.jsonl is the record.
    writeFileSync(join(dispatch, "run-log.md"), "# Decoy run log.\n", "utf8");
  }
  if (opts.runJson !== undefined) {
    writeFileSync(join(dispatch, "run.json"), `${JSON.stringify(opts.runJson, null, 2)}\n`, "utf8");
  }

  const record = join(tmp, "standin-calls.log");
  const answerPath = join(tmp, "answer.md");
  const env: Record<string, string | undefined> = {
    ...process.env,
    TZ: "UTC",
    POSTMASTER_SURVEYOR_RUN: writeStandin(tmp),
    STANDIN_RECORD: record,
    STANDIN_MODE: "answer",
    STANDIN_ANSWER: answerPath,
  };
  return {
    tmp,
    dispatch,
    repo,
    sha,
    record,
    answerPath,
    env,
    cleanup: () => {
      removeDir(tmp);
    },
  };
}

/** Retarget a layout's stand-in without rebuilding the copy. */
export function setStandin(
  lay: CopyLayout,
  mode: string,
  opts: { answer?: string; reason?: string } = {},
): void {
  lay.env.STANDIN_MODE = mode;
  if (opts.answer !== undefined) writeFileSync(lay.answerPath, opts.answer, "utf8");
  if (opts.reason !== undefined) lay.env.STANDIN_REASON = opts.reason;
  else delete lay.env.STANDIN_REASON;
}

export interface StandinCall {
  argv: string[];
  mode: string;
  exit: number;
}

export function standinCalls(record: string): StandinCall[] {
  let text = "";
  try {
    text = readFileSync(record, "utf8");
  } catch {
    return [];
  }
  const calls: StandinCall[] = [];
  for (const block of text.split("--- call ---\n")) {
    if (block.trim() === "") continue;
    const [argvPart = "", rest = ""] = block.split("--- env ---\n");
    const argv = argvPart.split("\n").filter((l) => l !== "");
    const mode = rstMode(rest);
    const exit = rstExit(rest);
    calls.push({ argv, mode, exit });
  }
  return calls;
}

function rstMode(rest: string): string {
  for (const line of rest.split("\n")) {
    if (line.startsWith("mode=")) return line.slice("mode=".length);
  }
  return "";
}

function rstExit(rest: string): number {
  for (const line of rest.split("\n")) {
    if (line.startsWith("exit=")) return parseInt(line.slice("exit=".length), 10);
  }
  return -1;
}

export function reviewSurvey(lay: CopyLayout, args: string[]): Run {
  return sh(RUN, ["review-survey", ...args], lay.env, lay.tmp);
}

export function reviewDecide(dispatch: string, round: number): Run {
  return sh(RUN, ["review-decide", dispatch, String(round)], process.env as Record<string, string>);
}

// --- canned survey answers --------------------------------------------------

export const PART_SHARE = "What the findings share";
export const PART_CAUSE = "Where the cause lies";
export const PART_OPEN = "What is still open";
export const PART_HELP = "Whether another round is likely to help";
export const PARTS = [PART_SHARE, PART_CAUSE, PART_OPEN, PART_HELP];

export const PLAIN_WORDS =
  "The ticket asks for a complete answer about an input with no end, so each round finds more sites. " +
  "Another round will not help; the ticket needs scoping.";

export const FULL_ANSWER = `## Conclusion

The loop is not converging because the ticket asks for a complete answer about an input with no end.

## Reasons

- Round 4 closed two sites; round 5 found four more of the same kind.
- The reports agree on the sites but not on a fix.

## ${PART_SHARE}

Every finding is a site where unbounded input reaches a total function.

## ${PART_CAUSE}

In the ticket: it asks for completeness over an input with no end.

## ${PART_OPEN}

Whether the ticket's scope can be bounded without changing its intent.

## ${PART_HELP}

No: another round finds more sites of the same kind.

## What I could not tell

Nothing material; the reports and the code settle every part.

${PLAIN_WORDS}
`;

/** The full answer with one part's section removed. */
export function answerMissing(part: string): string {
  const lines = FULL_ANSWER.split("\n");
  const start = lines.findIndex((l) => l === `## ${part}`);
  if (start < 0) throw new Error(`no such part: ${part}`);
  let end = start + 1;
  while (end < lines.length && !lines[end]?.startsWith("## ")) end++;
  return [...lines.slice(0, start), ...lines.slice(end)].join("\n").replace(/\n{3,}/gu, "\n\n");
}

// --- the falling control ------------------------------------------------------
// Serious counts fall 4, 3, 2, 1 while security's only lane fails in rounds
// 3 and 4: a ruling that is not a rise.

export function makeFalling(tmp: string): { dispatch: string; repo: string } {
  const dispatch = join(tmp, "copy-falling-r4");
  const repo = join(tmp, "proj");
  mkdirSync(join(dispatch, "logs"), { recursive: true });
  initRepo(repo);
  const lines: string[] = [];
  const row = (action: string, target: string, detail: string): void => {
    lines.push(JSON.stringify({ actor: "coachman", action, target, detail }));
  };
  const counts = [4, 3, 2, 1];
  counts.forEach((n, i) => {
    const r = i + 1;
    for (let k = 0; k < n; k++) {
      row("finding", `src/part-${r}-${k}.ts:1`, `gating P2 r${r} bug luna, verified by reading`);
    }
  });
  for (let r = 1; r <= 4; r++) {
    row("review-launch", "luna", `bug round ${r}`);
    row("review-launch", "haiku", `bug round ${r}`);
    row("review-launch", "opus", `security round ${r}`);
  }
  row("degrade", "opus", "security r3: the lane died mid-round");
  row("degrade", "opus", "security r4: the lane died mid-round");
  writeFileSync(join(dispatch, "actions.jsonl"), `${lines.join("\n")}\n`, "utf8");
  return { dispatch, repo };
}

// --- coachman sections --------------------------------------------------------

export function coachmanFile(
  dir: string,
  name = "coachman.md",
  body: { residue?: string; options?: string; advice?: string } = {},
): string {
  const path = join(dir, name);
  const residue = body.residue ?? "Two fixes from round 5 are not yet re-reviewed.";
  const options =
    body.options ??
    "1. Fix everything.\n2. Accept two findings as known limits.\n3. Run another round.";
  const advice = body.advice ?? "Fix everything: the sites are small and the fix is local.";
  writeFileSync(
    path,
    `## Residue\n\n${residue}\n\n## Options\n\n${options}\n\n## Advice\n\n${advice}\n`,
    "utf8",
  );
  return path;
}

export function expectedReports(run: string, stop: number): string[] {
  const out: string[] = [];
  for (const f of readdirSync(join(FIX, run, "logs"))) {
    const rd = reportRound(f);
    if (rd === null || rd > stop) continue;
    out.push(f);
  }
  return out.sort();
}

export function expectedCountsLine(counts: number[]): string {
  return `counts: ${counts.map((n, i) => `r${i + 1}=${n}`).join(" ")}`;
}

export function expectedSnapshotsLine(stop: number, sha: string): string {
  const parts: string[] = [];
  for (let r = 1; r <= stop; r++) {
    parts.push(r === stop ? `r${r}=${sha}` : `r${r}=not-recorded`);
  }
  return `round-snapshots: ${parts.join(" ")}`;
}

export function copyActionLines(dispatch: string): string[] {
  return readFileSync(join(dispatch, "actions.jsonl"), "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "");
}

export function reportBasename(path: string): string {
  return basename(path);
}
