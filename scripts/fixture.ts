// Run the flow end to end against a small app whose tickets have a known outcome, and score a
// finished run from its own records.
//
//   fixture.sh new <name or dest> <ticket>
//   fixture.sh score <dispatch> <repo>
//   fixture.sh hidden <ticket> <app-dir>
//
// `new` marks its copy with `postmaster.fixture` in that repository's local git config.
// `score` reports the merged result's hidden-test counts, then the harvested lane branches'
// counts from `scripts/fixture-lanes.ts`; only the merged result decides the verdict.
// Its gate runs from a clean checkout of main, outside the project folder, through
// `scripts/clean-checkout.ts`, so a tool that walks the folder never reads the run's
// own working copies.
//   exit 0  new: made and filed; score, hidden: every check passed
//   exit 1  usage, a tool not on PATH, a refusal from new, or input that is not what it says
//   exit 2  score, hidden: a check failed

import { randomUUID } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { tryJsonFile } from "./lib/data.ts";
import { scriptsDir, toolRoot } from "./lib/paths.ts";
import { die, run } from "./lib/proc.ts";
import {
  DOT_ALL,
  digitValue,
  END_OF_STRING,
  isDigit,
  literalI,
  PY_M_END,
  PY_M_START,
  PY_S_CLASS,
  pyRstrip,
  pySplitLines,
  pyWords,
} from "./lib/text.ts";

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

const HERE = scriptsDir(import.meta);
const TOOL = toolRoot(import.meta);
const APP = join(TOOL, "fixtures", "app");
const TICKETS = join(TOOL, "fixtures", "tickets");
export const TIMEOUT = 1200;
const _CHECKS = ["hidden-tests", "gate", "stages", "markers", "handoffs", "run.json", "ship-card"];

function usage(): never {
  die(
    "usage: fixture.sh new <name or dest> <ticket> | score <dispatch> <repo> | hidden <ticket> <app-dir>",
    1,
  );
}

export function onPath(t: string): boolean {
  // `command -v` is a shell builtin, so ask a shell for it, with the name as
  // a positional parameter, never pasted into the command string.
  return run("bash", ["-c", 'command -v "$1"', "_", t]).code === 0;
}
function need(...tools: string[]): void {
  for (const t of tools) {
    if (!onPath(t)) {
      die(`fixture: ${t} is not on PATH`, 1);
    }
  }
}

export function tickets(): string[] {
  try {
    return readdirSync(TICKETS)
      .filter((d) => existsSync(join(TICKETS, d, "ticket.md")))
      .sort();
  } catch {
    return [];
  }
}

export function ticketTitle(t: string): string {
  const text = readFileSync(join(TICKETS, t, "ticket.md"), "utf8");
  return text.split("\n")[0]?.replace(/^# /u, "") ?? "";
}

export function ticketBody(t: string): string {
  const text = readFileSync(join(TICKETS, t, "ticket.md"), "utf8");
  return text.split("\n").slice(1).join("\n").replace(/^\n+/u, "");
}

function isTicket(t: string): boolean {
  if (t && existsSync(join(TICKETS, t, "ticket.md"))) return true;
  console.error(`fixture: no ticket '${t}'; the tickets are: ${tickets().join(" ")}`);
  return false;
}

function lexists(p: string): boolean {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}
export function appFiles(dir: string): string[] | null {
  const r = run("git", ["-C", dir, "ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
  // BASE's check=True: a listing that fails fails the copy, never an empty app.
  if (r.code !== 0) return null;
  return r.out.split("\0").filter((n) => n !== "");
}
export function makeRepo(dest: string, src = APP): boolean {
  try {
    mkdirSync(dest, { recursive: true });
  } catch {
    return false;
  }
  const listed = appFiles(src);
  if (!listed) {
    console.error(`fixture: could not copy the app to ${dest}`);
    return false;
  }
  // BASE's copy fails the repo on the first file it cannot copy; carrying on
  // would commit a partial app as whole. lexists, as BASE's does: a dangling
  // symlink is listed and copied, never skipped as missing.
  try {
    for (const rel of [...new Set(listed)].sort()) {
      const s = join(src, rel);
      const d = join(dest, rel);
      if (!lexists(s)) continue;
      mkdirSync(dirname(d), { recursive: true });
      if (lstatSync(s).isSymbolicLink()) {
        symlinkSync(readlinkSync(s), d);
      } else {
        try {
          cpSync(s, d, { preserveTimestamps: true });
        } catch {
          cpSync(s, d);
        }
      }
    }
  } catch {
    console.error(`fixture: could not copy the app to ${dest}`);
    return false;
  }
  if (run("git", ["-C", dest, "init", "-q", "-b", "main"]).code !== 0) return false;
  for (const key of ["user.name", "user.email"]) {
    const v = run("git", ["-C", TOOL, "config", key]);
    if (v.code === 0) run("git", ["-C", dest, "config", key, v.out.trim()]);
  }
  run("git", ["-C", dest, "add", "-A"]);
  const c = run("git", ["-C", dest, "commit", "-q", "-m", "Initial commit"]);
  if (c.code !== 0) {
    console.error(
      `fixture: could not commit the app in ${dest}; git needs user.name and user.email`,
    );
    return false;
  }
  return true;
}

// --- make_and_file -------------------------------------------------------------------------------

export function makeAndFile(dest: string, ticket: string): number {
  if (!isTicket(ticket)) return 1;
  const home = process.env.HOME || homedir();
  // bare name goes under ~/Code/fixtures or $POSTMASTER_FIXTURES
  if (!dest.includes("/")) {
    dest = join(process.env.POSTMASTER_FIXTURES || join(home, "Code", "fixtures"), dest);
  }
  dest = resolve(dest.replace(/^~(?=\/|$)/u, home));
  if (existsSync(dest)) {
    console.error(`fixture: ${dest} already exists; a run starts from a fresh repo`);
    return 1;
  }
  // refuse a dest inside a git repo
  let probe = dirname(dest);
  while (!existsSync(probe)) probe = dirname(probe);
  const gr = run("git", ["-C", probe, "rev-parse", "--git-dir"]);
  if (gr.code === 0) {
    const top = run("git", ["-C", probe, "rev-parse", "--show-toplevel"]);
    console.error(
      `fixture: ${dest} would be inside the git repository at ${top.code === 0 ? top.out.trim() : probe}; a run's repo stands alone`,
    );
    return 1;
  }
  const unmake = (): void => {
    if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
  };

  mkdirSync(dirname(dest), { recursive: true });
  if (!makeRepo(dest)) {
    unmake();
    return 1;
  }
  // make ticket store
  const localSh = process.env.LOCAL_SH || join(HERE, "local.sh");
  const storeR = run("bash", [localSh, dest, "store", "init"]);
  if (storeR.code !== 0) {
    unmake();
    console.error(`fixture: could not make the ticket store in ${dest}`);
    return 1;
  }
  // file the ticket: local.sh create takes a body file, not the body text
  const body = ticketBody(ticket);
  const title = ticketTitle(ticket);
  const bodyFile = makeBodyFile(body);
  const createR = run("bash", [localSh, dest, "create", title, bodyFile]);
  rmSync(bodyFile, { force: true });
  const number = createR.out.trim().split("\n").pop() ?? "";
  // ASCII: BASE matches ^[0-9]+$ for the filed number in bash; local create prints one line
  if (createR.code !== 0 || !/^\d+$/.test(number)) {
    unmake();
    console.error(
      `fixture: filing the ticket in ${dest}'s own store failed (exit ${createR.code})`,
    );
    return 1;
  }
  const mark = run("git", ["-C", dest, "config", "--local", "postmaster.fixture", ticket]);
  if (mark.code !== 0) {
    unmake();
    console.error(`fixture: could not mark ${dest} as a fixture copy`);
    return 1;
  }
  const headShort = run("git", ["-C", TOOL, "rev-parse", "--short", "HEAD"]).out.trim();
  const destHead = run("git", ["-C", dest, "rev-parse", "--short", "HEAD"]).out.trim();
  console.log(`fixture: made ${dest} from fixtures/app at ${headShort}; main is at ${destHead}`);
  console.log(
    `fixture: filed ticket ${ticket} in ${dest}'s own ticket store as #${number}: ${title}`,
  );
  console.log(
    `fixture: dispatch ticket #${number} against ${dest}, then: scripts/fixture.sh score <its dispatch directory> ${dest}`,
  );
  return 0;
}

function newRun(dest: string, ticket: string): number {
  const st = run("git", ["-C", TOOL, "status", "--porcelain", "--", "fixtures"]);
  if (st.out.trim()) {
    console.error(
      "fixture: fixtures/ has uncommitted changes; a run starts from a committed fixture",
    );
    return 1;
  }
  return makeAndFile(dest, ticket);
}

// --- score helpers ---------------------------------------------------------------------------

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
  out: string;
}

export function sh(
  cmd: string[],
  cwd?: string,
  env?: Record<string, string>,
  timeout = TIMEOUT,
): { code: number | null; out: string } {
  const r = run(cmd[0]!, cmd.slice(1), { cwd, env, input: "", timeout: timeout * 1000 });
  // BASE's TimeoutExpired discards whatever the command printed and says only
  // this; a child that exits 128 on its own is not a timeout.
  if (r.timedOut) return { code: null, out: `timed out after ${timeout}s` };
  return { code: r.code, out: r.out + r.err };
}

function exited(code: number | null): string {
  return code === null ? `timed out after ${TIMEOUT}s` : `exit ${code}`;
}

export function tail(text: string, n = 20): string {
  return pySplitLines(pyRstrip(text)).slice(-n).join("\n");
}

export function squash(text: string): string {
  return pyWords(text).join(" ");
}

export function sectionOf(text: string, heading: string): string {
  const re = new RegExp(
    `${PY_M_START}##[ \t]+${literalI(heading)}[ \t]*\n(${DOT_ALL}*?)(?=${PY_M_START}##[ \t]|${END_OF_STRING})`,
    "gisu",
  );
  const m = re.exec(text);
  return m ? m[1]! : "";
}

export const HIDDEN_RE = new RegExp(
  `${PY_M_START}[${PY_S_CLASS}]*(\\p{Nd}+) (pass|fail)[${PY_S_CLASS}]*${PY_M_END}`,
  "gu",
);

export function hidden(
  ticket: string,
  app: string,
): { passed: boolean; detail: string; out: string } {
  const r = sh(["bun", "test", "--timeout", "120000", "./"], join(TICKETS, ticket, "hidden"), {
    ...(process.env as Record<string, string>),
    FIXTURE_APP: app,
  });
  const counts: Record<string, number> = {};
  for (const m of (r.out ?? "").matchAll(HIDDEN_RE)) {
    counts[m[2]!] = parseInt(digitValue(m[1]!), 10);
  }
  const passed = counts.pass ?? 0;
  const failed = counts.fail ?? 0;
  const detail =
    Object.keys(counts).length > 0
      ? `${passed} pass, ${failed} fail`
      : `bun test ${exited(r.code)}`;
  return { passed: r.code === 0 && passed > 0 && failed === 0, detail, out: r.out ?? "" };
}

// BASE writes \d for the pass/fail counts; the counts are machine-printed ASCII
// (fixture-lanes.ts prints JS numbers), so [0-9] matches on every reachable line.
const LANE_LINE = /^(.*): ([0-9]+ pass, [0-9]+ fail|missing|failed to build)$/u;

// Each lane's hidden status from fixture-lanes.ts; "" when there are no lanes.
export function laneScores(dispatch: string, repo: string, ticket: string): string {
  const r = sh([
    "bun",
    "--no-env-file",
    `--config=${join(TOOL, "bunfig.toml")}`,
    join(HERE, "fixture-lanes.ts"),
    dispatch,
    repo,
    ticket,
  ]);
  if (r.code !== 0) return "lanes not scored";
  return r.out
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => LANE_LINE.test(line))
    .join("; ");
}

export function score(dispatch: string, repo: string): { code: number; out: string } {
  const mainR = sh(["git", "-C", repo, "rev-parse", "--verify", "-q", "refs/heads/main^{commit}"]);
  const main = (mainR.out ?? "").trim();
  if (mainR.code !== 0 || !main) {
    return { code: 1, out: `fixture: ${repo} has no main branch\n` };
  }
  const manifest = tryJsonFile<Record<string, unknown>>(join(dispatch, "manifest.json"));
  const base = manifest?.base;
  if (typeof base === "string" && base) {
    const anc = sh(["git", "-C", repo, "merge-base", "--is-ancestor", base, main]);
    if (anc.code !== 0) {
      return {
        code: 1,
        out: `fixture: the manifest's base ${base.slice(0, 12)} is not on main in ${repo}; is this the run's repo?\n`,
      };
    }
  }
  const meta = tryJsonFile<Record<string, unknown>>(join(dispatch, "run.json"));
  const ran = (meta?.postmaster as Record<string, unknown> | undefined)?.commit;
  const here = sh(["git", "-C", TOOL, "rev-parse", "HEAD"]).out?.trim() ?? "";
  if (typeof ran === "string" && ran && ran !== here) {
    console.error(
      `fixture: note: the run was dispatched from postmaster ${ran.slice(0, 12)}, and this checkout is at ${here.slice(0, 12)}; the stages and hand-off rules scored are this checkout's`,
    );
  }
  // export main to scratch
  const scratch = makeScoreDir();
  const app = join(scratch, "app");
  mkdirSync(app);
  const exp = sh([
    "bash",
    "-o",
    "pipefail",
    "-c",
    `git -C "$1" archive --format=tar "$2" | tar -x -C "$3"`,
    "export",
    repo,
    main,
    app,
  ]);
  if (exp.code !== 0) {
    rmSync(scratch, { recursive: true, force: true });
    return {
      code: 1,
      out: `fixture: could not export main from ${repo}: ${tail(exp.out ?? "", 3)}\n`,
    };
  }
  const legs = legsOf(dispatch, manifest);
  const results: CheckResult[] = [
    { name: "hidden-tests", ...checkHidden(dispatch, repo, app) },
    { name: "gate", ...checkGate(app, repo, main) },
    { name: "stages", ...checkStages(dispatch), out: "" },
    { name: "markers", ...checkMarkers(dispatch, legs), out: "" },
    { name: "handoffs", ...checkHandoffs(dispatch, legs), out: "" },
    { name: "run.json", ...checkRunJson(dispatch), out: "" },
    { name: "ship-card", ...checkCard(dispatch), out: "" },
  ];
  rmSync(scratch, { recursive: true, force: true });
  return report(results);
}

function makeTmpDir(): string {
  return tmpdir();
}
/** A body file as `mktemp` makes one: mode 0600, a random name, never
 * clobbering an existing path. */
export function makeBodyFile(body: string): string {
  for (let i = 0; i < 10; i++) {
    const p = join(makeTmpDir(), `fixture-body-${randomUUID()}.md`);
    try {
      writeFileSync(p, body, { mode: 0o600, flag: "wx" });
      return p;
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code !== "EEXIST") throw e;
    }
  }
  die("fixture: could not make a temporary body file");
}
/** A score directory as `tempfile.mkdtemp` makes one: mode 0700, a random
 * name that never reuses an existing path. */
export function makeScoreDir(): string {
  return mkdtempSync(join(makeTmpDir(), "fixture-score-"));
}

const LEG_FILE_RE = new RegExp(
  `^(?:\\.leg-(\\p{Nd}+)-(?:done|exited)|leg-(\\p{Nd}+)-(?:prompt|takeover)\\.txt|handoff-(\\p{Nd}+)\\.md)${END_OF_STRING}`,
  "u",
);

export function legsOf(dispatch: string, manifest: Record<string, unknown> | null): number[] {
  const seen = new Set<number>();
  try {
    for (const n of readdirSync(dispatch)) {
      const m = LEG_FILE_RE.exec(n);
      if (m) {
        const g = [m[1], m[2], m[3]].find((x) => x);
        if (g) seen.add(parseInt(digitValue(g), 10));
      }
    }
  } catch {
    /* empty */
  }
  if (manifest && typeof manifest === "object") {
    if (typeof manifest.leg === "number" && Number.isInteger(manifest.leg))
      seen.add(manifest.leg as number);
    const coachman = manifest.coachman as Record<string, unknown> | undefined;
    const legs = coachman?.legs as Record<string, unknown> | undefined;
    if (legs) {
      for (const k of Object.keys(legs)) {
        if (isDigit(k)) seen.add(parseInt(digitValue(k), 10));
      }
    }
  }
  if (seen.size === 0) return [];
  const max = Math.max(...seen);
  return Array.from({ length: max }, (_, i) => i + 1);
}

function checkHidden(
  dispatch: string,
  repo: string,
  app: string,
): { ok: boolean; detail: string; out: string } {
  const brief = join(dispatch, "brief.md");
  const text = existsSync(brief) ? squash(readFileSync(brief, "utf8")) : "";
  const found: string[] = [];
  for (const t of tickets()) {
    const criteria = squash(
      sectionOf(readFileSync(join(TICKETS, t, "ticket.md"), "utf8"), "Acceptance criteria"),
    );
    if (criteria && text.includes(criteria)) found.push(t);
  }
  if (found.length !== 1) {
    return {
      ok: false,
      detail:
        found.length === 0
          ? "brief.md carries no fixture ticket's criteria verbatim"
          : `brief.md carries more than one fixture ticket: ${found.join(", ")}`,
      out: "",
    };
  }
  const h = hidden(found[0]!, app);
  const mainDetail = `${found[0]}, from the waybill: ${h.detail} on main`;
  const lanes = laneScores(dispatch, repo, found[0]!);
  return {
    ok: h.passed,
    detail: lanes ? `${mainDetail}; ${lanes}` : mainDetail,
    out: h.out,
  };
}

function checkGate(
  app: string,
  repo: string,
  branch: string,
): { ok: boolean; detail: string; out: string } {
  const r = sh(["bash", join(HERE, "discover-project.sh"), app]);
  const gate = (r.out ?? "")
    .split("\n")
    .find((l) => l.startsWith("gate="))
    ?.slice(5);
  if (!gate)
    return { ok: false, detail: "scripts/discover-project.sh found no gate", out: r.out ?? "" };
  const install = (r.out ?? "")
    .split("\n")
    .find((l) => l.startsWith("install="))
    ?.slice(8);
  const argv = [
    "bun",
    "--no-env-file",
    `--config=${join(TOOL, "bunfig.toml")}`,
    join(HERE, "clean-checkout.ts"),
    repo,
    branch,
  ];
  if (install) argv.push(install);
  argv.push(gate);
  const g = sh(argv);
  return {
    ok: g.code === 0,
    detail: `${gate} on main from a clean checkout: ${exited(g.code)}`,
    out: g.out ?? "",
  };
}

function checkStages(dispatch: string): { ok: boolean; detail: string } {
  const r = sh(["bash", join(HERE, "stage.sh"), "--list"]);
  const listed = pyWords(r.out ?? "");
  if (r.code !== 0 || !listed.includes("done")) {
    return { ok: false, detail: "scripts/stage.sh --list names no done stage" };
  }
  let expected = listed.slice(0, listed.indexOf("done") + 1);
  const legsR = sh(["bash", join(HERE, "turnpikes.sh"), "legs", dispatch]);
  if (legsR.code !== 0)
    return { ok: false, detail: `scripts/turnpikes.sh legs: ${tail(legsR.out ?? "")}` };
  const hasReview = pySplitLines(legsR.out ?? "").some((line) => {
    const words = pyWords(line);
    return words.length > 1 && words[1] === "review";
  });
  expected = expected.filter((s) => s !== "review" || hasReview);
  const events = readActions(dispatch);
  if (events === null) return { ok: false, detail: "no actions.jsonl" };
  const entered = events.filter((e) => e.action === "stage").map((e) => e.target);
  const due = expected.slice(1);
  if (JSON.stringify(entered) === JSON.stringify(due)) {
    return {
      ok: true,
      detail: `${expected[0]} to done, ${expected.length} stages, each entered in order`,
    };
  }
  for (let i = 0; i < Math.min(due.length, entered.length); i++) {
    if (due[i] !== entered[i]) {
      return {
        ok: false,
        detail: `after ${[expected[0], ...entered][i]} entered ${entered[i]}, not ${due[i]}`,
      };
    }
  }
  if (entered.length < due.length) {
    return {
      ok: false,
      detail: `stopped at ${[expected[0], ...entered][entered.length]}; never entered ${due[entered.length]}`,
    };
  }
  return { ok: false, detail: `entered ${entered[due.length]} after done` };
}

function readActions(dispatch: string): Array<Record<string, unknown>> | null {
  const path = join(dispatch, "actions.jsonl");
  if (!existsSync(path)) return null;
  const events: Array<Record<string, unknown>> = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim()) {
      try {
        events.push(JSON.parse(line));
      } catch {
        return null;
      }
    }
  }
  return events;
}

function checkMarkers(dispatch: string, legs: number[]): { ok: boolean; detail: string } {
  if (legs.length === 0) return { ok: false, detail: "no leg recorded" };
  const missing: string[] = [];
  for (const n of legs) {
    for (const k of ["done", "exited"]) {
      if (!existsSync(join(dispatch, `.leg-${n}-${k}`))) missing.push(`.leg-${n}-${k}`);
    }
  }
  if (missing.length > 0) return { ok: false, detail: `missing ${missing.join(", ")}` };
  return { ok: true, detail: `${legs.length} legs, each with its done and exited marker` };
}

function checkHandoffs(dispatch: string, legs: number[]): { ok: boolean; detail: string } {
  if (legs.length === 0) return { ok: false, detail: "no leg recorded" };
  const bad: string[] = [];
  for (const n of legs) {
    const f = join(dispatch, `handoff-${n}.md`);
    if (!existsSync(f)) {
      bad.push(`handoff-${n}.md missing`);
      continue;
    }
    const r = sh(["bash", join(HERE, "handoff-check.sh"), f]);
    if (r.code !== 0) {
      const said = (r.out ?? "")
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => l.replace("handoff-check: ", ""));
      const more = said.length > 1 ? ` (and ${said.length - 1} more)` : "";
      bad.push(`handoff-${n}.md: ${said[0] || exited(r.code)}${more}`);
    }
  }
  if (bad.length > 0) return { ok: false, detail: bad.join("; ") };
  return { ok: true, detail: `${legs.length} hand-offs pass scripts/handoff-check.sh` };
}

function checkRunJson(dispatch: string): { ok: boolean; detail: string } {
  const path = join(dispatch, "run.json");
  if (!existsSync(path)) return { ok: false, detail: "no run.json" };
  const data = tryJsonFile<Record<string, unknown>>(path);
  if (!data || typeof data !== "object" || Object.keys(data).length === 0) {
    return { ok: false, detail: "run.json is not a JSON object" };
  }
  return { ok: true, detail: "written, and parses" };
}

function checkCard(dispatch: string): { ok: boolean; detail: string } {
  const path = join(dispatch, "card.md");
  if (!existsSync(path)) return { ok: false, detail: "no card.md" };
  const lines = readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim());
  if (lines.length === 0) return { ok: false, detail: "card.md is empty" };
  return { ok: true, detail: `card.md, ${lines.length} lines` };
}

function report(results: CheckResult[]): { code: number; out: string } {
  const lines: string[] = [];
  for (const r of results) {
    lines.push(`${r.ok ? "ok  " : "FAIL"} ${r.name.padEnd(12)} ${r.detail}`);
    if (!r.ok && r.out.trim()) {
      console.error(`--- ${r.name}\n${tail(r.out)}`);
    }
  }
  return { code: results.every((r) => r.ok) ? 0 : 2, out: `${lines.join("\n")}\n` };
}

// --- entry -----------------------------------------------------------------------------------
const argv = process.argv.slice(2);
if (import.meta.main) {
  if (argv[0] === "new") {
    if (argv.length !== 3) usage();
    if (argv[1]?.startsWith("-") || argv[2]?.startsWith("-")) usage();
    need("git");
    process.exit(newRun(argv[1]!, argv[2]!));
  } else if (argv[0] === "score") {
    if (argv.length !== 3) usage();
    need("git", "bun", "npm", "jq");
    const dispatch = argv[1]!;
    const repo = argv[2]!;
    if (!existsSync(dispatch) || !statSync(dispatch).isDirectory()) {
      die(`fixture: no such dispatch directory: ${dispatch}`, 1);
    }
    const gitCheck = run("git", ["-C", repo, "rev-parse", "--git-dir"]);
    if (gitCheck.code !== 0) {
      die(`fixture: not a git repo: ${repo}`, 1);
    }
    const sr = score(resolve(dispatch), resolve(repo));
    process.stdout.write(sr.out);
    process.exit(sr.code);
  } else if (argv[0] === "hidden") {
    if (argv.length !== 3) usage();
    need("bun");
    if (!isTicket(argv[1]!)) process.exit(1);
    const app = resolve(argv[2]!);
    if (!existsSync(join(app, "package.json"))) {
      die(`fixture: no package.json in ${app}`, 1);
    }
    const h = hidden(argv[1]!, app);
    const hr = report([
      { name: "hidden-tests", ok: h.passed, detail: `${argv[1]}: ${h.detail}`, out: h.out },
    ]);
    process.stdout.write(hr.out);
    process.exit(hr.code);
  } else {
    usage();
  }
}
