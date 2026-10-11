// Run the flow end to end against a small app whose tickets have a known outcome, and score a
// finished run from its own records.
//
//   run fixture new <name or dest> <ticket>
//   run fixture score <dispatch> <repo>
//   run fixture hidden <ticket> <app-dir>
//
// `new` marks its copy with `.postmaster/fixture` in the first commit and
// `postmaster.fixture` in that repository's local git config.
// `score` reports the merged result's hidden-test counts, then the harvested lane branches'
// counts from `scripts/fixture-lanes.ts`; only the merged result decides the verdict.
// Its gate runs from a clean checkout of main, outside the project folder, through
// `scripts/clean-checkout.ts`, so a tool that walks the folder never reads the run's
// own working copies.
//   exit 0  new: made and filed; score, hidden: every check passed
//   exit 1  usage, a tool not on PATH, a refusal from new, or input that is not what it says
//   exit 2  score, hidden: a check failed

import { createHash, randomUUID } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, machine, release, tmpdir, type as osType } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { tryJsonFile } from "./lib/data.ts";
import { runMode } from "./lib/run-mode.ts";
import { ticketNotes } from "./lib/ticket-notes.ts";
import { effortsLine } from "./run-meta.ts";
import {
  laneNamesFromBranches,
  laneNamesFromWorkhorses,
  ticketIdFromWaybill,
} from "./fixture-lanes.ts";
import { scriptsDir, toolRoot } from "./lib/paths.ts";
import { die, run } from "./lib/proc.ts";
import { reachActions } from "./reach.ts";
import { computeTimes, fmt, parseTs } from "./run-times.ts";
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
export const FIXTURE_MARKER = "postmaster fixture v1\n";
export const TIMEOUT = 1200;
const _CHECKS = [
  "hidden-tests",
  "gate",
  "stages",
  "markers",
  "handoffs",
  "run.json",
  "efforts",
  "ship-card",
];
const REACH_READERS = new Set(["codex", "claude", "muse", "mimo", "pi"]);

function usage(): never {
  die(
    "usage: run fixture new <name or dest> <ticket> | score <dispatch> <repo> | hidden <ticket> <app-dir>",
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
export function makeRepo(dest: string, src = APP, fixture = false): boolean {
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
  if (fixture) {
    try {
      mkdirSync(join(dest, ".postmaster"), { recursive: true });
      writeFileSync(join(dest, ".postmaster", "fixture"), FIXTURE_MARKER);
    } catch {
      console.error(`fixture: could not write the fixture marker in ${dest}`);
      return false;
    }
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
  if (!makeRepo(dest, APP, true)) {
    unmake();
    return 1;
  }
  // make ticket store
  const localOverride = process.env.LOCAL_SH;
  const localCommand = localOverride || join(HERE, "run");
  const localArgs = localOverride ? [] : ["local"];
  const storeR = run(localCommand, [...localArgs, dest, "store", "init"]);
  if (storeR.code !== 0) {
    unmake();
    console.error(`fixture: could not make the ticket store in ${dest}`);
    return 1;
  }
  // file the ticket: run local create takes a body file, not the body text
  const ticketBase = run("git", ["-C", dest, "rev-parse", "HEAD"]).out.trim();
  const body = ticketBody(ticket).replaceAll("FIXTURE_BASE", ticketBase);
  if (!/^[0-9a-f]{40}$/u.test(ticketBase) || body.includes("FIXTURE_BASE")) {
    unmake();
    console.error(`fixture: could not write the verified base into ${ticket}'s ticket`);
    return 1;
  }
  const title = ticketTitle(ticket);
  const bodyFile = makeBodyFile(body);
  const createR = run(localCommand, [...localArgs, dest, "create", title, bodyFile]);
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
  const labelR = run(localCommand, [...localArgs, dest, "label", number, "add", "ready"]);
  if (labelR.code !== 0) {
    unmake();
    console.error(`fixture: could not mark ticket #${number} ready in ${dest}`);
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
    `fixture: dispatch ticket #${number} against ${dest}, then: scripts/run fixture score <its dispatch directory> ${dest}`,
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
  const r = sh(
    [process.execPath, "test", "--timeout", "120000", "./"],
    join(TICKETS, ticket, "hidden"),
    {
      ...(process.env as Record<string, string>),
      FIXTURE_APP: app,
    },
  );
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
    process.execPath,
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
    { name: "hidden-tests", ...checkHidden(dispatch, repo, app, main) },
    { name: "gate", ...checkGate(app, repo, main) },
    { name: "stages", ...checkStages(dispatch), out: "" },
    { name: "markers", ...checkMarkers(dispatch, legs), out: "" },
    { name: "handoffs", ...checkHandoffs(dispatch, legs), out: "" },
    { name: "run.json", ...checkRunJson(dispatch), out: "" },
    { name: "premises-order", ...checkPremisesOrder(dispatch), out: "" },
    { name: "mode", ...checkMode(dispatch, repo), out: "" },
    { name: "efforts", ...checkWaybillEfforts(dispatch), out: "" },
    { name: "ship-card", ...checkCard(dispatch), out: "" },
  ];
  // The reach item follows the run's recorded commit, not its pin directory:
  // aftercare may release the pin once the run is done, and the score must
  // not pass by leaving the item out. No recorded commit (a run from before
  // pins) scores no item, as before; an unreadable commit fails the score.
  const postmaster = meta?.postmaster;
  const recorded =
    typeof postmaster === "object" && postmaster !== null && !Array.isArray(postmaster)
      ? (postmaster as Record<string, unknown>).commit
      : undefined;
  if (typeof recorded === "string" && recorded) {
    const known = sh(["git", "-C", TOOL, "rev-parse", "--verify", "-q", `${recorded}^{commit}`]);
    if (known.code !== 0 || !(known.out ?? "").trim()) {
      rmSync(scratch, { recursive: true, force: true });
      return {
        code: 1,
        out: `fixture: cannot tell whether ${recorded.slice(0, 12)} holds the reach check: git cannot read that commit\n`,
      };
    }
    const blob = sh(["git", "-C", TOOL, "cat-file", "-e", `${recorded}:scripts/reach.ts`]);
    if (blob.code === 0) {
      results.push({ name: "reach", ...checkReach(dispatch), out: "" });
    }
  }
  rmSync(scratch, { recursive: true, force: true });
  const scored = report(results);
  return { code: scored.code, out: `${platformLine()}\n${scored.out}${timeReport(dispatch)}` };
}

export function gitVersionNumber(output: string): string {
  // ASCII: the version digits are tool-printed ASCII; a vendor suffix is not the number.
  return /\b([0-9]+(?:\.[0-9]+)+)/u.exec(output.trim())?.[1] ?? output.trim();
}

function platformLine(): string {
  const git = run("git", ["--version"]);
  return `platform: ${osType()} ${release()} ${machine()}, bun ${Bun.version}, git ${gitVersionNumber(git.out)}`;
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

/** Scoring runs the example app's own checks: its hidden tests on main, on each lane's branch, and
 * its gate from a clean checkout. That is about 17 seconds, and the same for every record of one
 * app. A caller that scores many records of one app (the tests) sets POSTMASTER_FIXTURE_APP_CACHE
 * to a directory it owns, and each result is kept there under a key made from everything it
 * depends on, so the next record of the same app reads it. Nothing else sets it; with it unset
 * every score runs everything. */
export function appCached<T>(key: string, compute: () => T): T {
  const dir = process.env.POSTMASTER_FIXTURE_APP_CACHE;
  if (!dir) return compute();
  const file = join(dir, `${createHash("sha256").update(key).digest("hex")}.json`);
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    // Not kept yet, or not readable: compute it.
  }
  const value = compute();
  try {
    mkdirSync(dir, { recursive: true });
    const part = `${file}.${process.pid}.part`;
    writeFileSync(part, JSON.stringify(value));
    renameSync(part, file);
  } catch {
    // A cache that cannot be written only costs time.
  }
  return value;
}

/** What the lanes' scores depend on: the ticket, main, every local branch, the run's manifest and
 * its waybill. */
function laneKey(dispatch: string, repo: string, ticket: string, main: string): string {
  const branches = sh([
    "git",
    "-C",
    repo,
    "for-each-ref",
    "--format=%(refname) %(objectname)",
    "refs/heads",
  ]);
  const read = (name: string): string => {
    try {
      return readFileSync(join(dispatch, name), "utf8");
    } catch {
      return "";
    }
  };
  return ["lanes", ticket, main, branches.out ?? "", read("manifest.json"), read("brief.md")].join(
    "\0",
  );
}

function checkHidden(
  dispatch: string,
  repo: string,
  app: string,
  main: string,
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
  const ticket = found[0]!;
  const h = appCached(`hidden\0${ticket}\0${main}`, () => hidden(ticket, app));
  const mainDetail = `${ticket}, from the waybill: ${h.detail} on main`;
  const lanes = appCached(laneKey(dispatch, repo, ticket, main), () =>
    laneScores(dispatch, repo, ticket),
  );
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
  return appCached(`gate\0${branch}`, () => runGate(app, repo, branch));
}

function runGate(
  app: string,
  repo: string,
  branch: string,
): { ok: boolean; detail: string; out: string } {
  const r = sh([join(HERE, "run"), "discover-project", app]);
  const gate = (r.out ?? "")
    .split("\n")
    .find((l) => l.startsWith("gate="))
    ?.slice(5);
  if (!gate)
    return { ok: false, detail: "scripts/run discover-project found no gate", out: r.out ?? "" };
  const install = (r.out ?? "")
    .split("\n")
    .find((l) => l.startsWith("install="))
    ?.slice(8);
  const argv = [
    process.execPath,
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
  const r = sh([join(HERE, "run"), "stage", "--list"]);
  const listed = pyWords(r.out ?? "");
  if (r.code !== 0 || !listed.includes("done")) {
    return { ok: false, detail: "scripts/run stage --list names no done stage" };
  }
  let expected = listed.slice(0, listed.indexOf("done") + 1);
  const legsR = sh([join(HERE, "run"), "turnpikes", "legs", dispatch]);
  if (legsR.code !== 0)
    return { ok: false, detail: `scripts/run turnpikes legs: ${tail(legsR.out ?? "")}` };
  const hasReview = pySplitLines(legsR.out ?? "").some((line) => {
    const words = pyWords(line);
    return words.length > 1 && words[1] === "review";
  });
  expected = expected.filter((s) => s !== "review" || hasReview);
  // A single-thread run never enters workhorses-running: the coachman writes the change
  // itself in the synthesis stage, so that stage is not part of its schedule (D5).
  if (runMode(dispatch) === "single-thread") {
    expected = expected.filter((s) => s !== "workhorses-running");
  }
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

/**
 * The base check must be recorded before the first workhorse dispatch: the
 * coachman's, or the postmaster's in a run without the notes, where the
 * coachman skips the step and records none. Without the notes the postmaster's
 * line must also precede the first leg dispatch, since the premises are
 * checked at dispatch before any leg starts.
 */
export function checkPremisesOrder(dispatch: string): { ok: boolean; detail: string } {
  const events = readActions(dispatch);
  if (events === null) return { ok: false, detail: "no readable actions.jsonl" };
  const heldBack = ticketNotes(dispatch) === "held-back";
  const meta = tryJsonFile<Record<string, unknown>>(join(dispatch, "run.json"));
  const config = meta?.config as Record<string, unknown> | undefined;
  const team = config?.team as Record<string, unknown> | undefined;
  let names = Array.isArray(team?.workhorses) ? team.workhorses.map(String) : [];
  if (names.length === 0) {
    try {
      const brief = readFileSync(join(dispatch, "brief.md"), "utf8");
      const line = brief.split(/\r?\n/u).find((row) => row.startsWith("workhorses:")) ?? "";
      names = line
        .slice("workhorses:".length)
        .split(",")
        .map((entry) => entry.trim().split("=")[0] ?? "")
        .filter(Boolean);
    } catch {
      names = [];
    }
  }
  const lanes = new Set(names);
  const coachmanPremises = events.findIndex(
    (event) => event.action === "premises" && event.actor === "coachman",
  );
  const postmasterPremises = events.findIndex(
    (event) => event.action === "premises" && event.actor === "postmaster",
  );
  const dispatchIndex = events.findIndex(
    (event) =>
      event.action === "dispatch" &&
      event.actor === "coachman" &&
      typeof event.target === "string" &&
      lanes.has(event.target),
  );
  if (heldBack) {
    if (postmasterPremises < 0) return { ok: false, detail: "no postmaster premises action" };
    if (coachmanPremises >= 0)
      return { ok: false, detail: "the coachman recorded premises the postmaster already checked" };
    const legIndex = events.findIndex(
      (event) => event.action === "dispatch" && event.actor === "postmaster",
    );
    if (legIndex >= 0 && postmasterPremises >= legIndex)
      return { ok: false, detail: "the first leg dispatch precedes the premises action" };
    if (dispatchIndex >= 0 && postmasterPremises >= dispatchIndex)
      return { ok: false, detail: "the first workhorse dispatch precedes the premises action" };
    if (dispatchIndex < 0)
      return { ok: true, detail: "premises action recorded and no workhorse dispatched" };
    return { ok: true, detail: "premises action precedes the first workhorse dispatch" };
  }
  if (coachmanPremises < 0) return { ok: false, detail: "no coachman premises action" };
  if (dispatchIndex >= 0 && coachmanPremises >= dispatchIndex)
    return { ok: false, detail: "the first workhorse dispatch precedes the premises action" };
  // A run that recorded its premises and stopped before any lane (a premise
  // escalation) holds the order: only dispatch-before-premises fails it.
  if (dispatchIndex < 0)
    return { ok: true, detail: "premises action recorded and no workhorse dispatched" };
  return { ok: true, detail: "premises action precedes the first workhorse dispatch" };
}

export { runMode };

/** The run's ticket id, from its waybill's first line, else the dispatch directory's name. */
function waybillTicket(dispatch: string): string {
  try {
    const id = ticketIdFromWaybill(readFileSync(join(dispatch, "brief.md"), "utf8"));
    if (id !== null) return id;
  } catch {
    /* fall through */
  }
  return basename(dispatch);
}

/** The run kept its mode: no workhorse dispatch and no wb/ branch in a single-thread run; one
 * coachman dispatch and one wb/<ticket>-<lane> branch per configured workhorse in a synthesis
 * run. A record with no mode reads as synthesis (D14). */
export function checkMode(dispatch: string, repo: string): { ok: boolean; detail: string } {
  const meta = tryJsonFile<Record<string, unknown>>(join(dispatch, "run.json"));
  if (!meta) return { ok: true, detail: "skipped: no run.json" };
  const raw = meta.mode;
  const mode = raw === undefined ? "synthesis" : raw;
  if (mode !== "synthesis" && mode !== "single-thread") {
    return {
      ok: false,
      detail: `run.json records mode ${String(mode)}, which is neither synthesis nor single-thread`,
    };
  }
  const events = readActions(dispatch);
  if (events === null) return { ok: false, detail: "no actions.jsonl" };
  const dispatched = events.filter(
    (e) => e.action === "dispatch" && e.actor === "coachman" && typeof e.target === "string",
  );
  const listed = sh(["git", "-C", repo, "for-each-ref", "--format=%(refname)", "refs/heads/wb/"]);
  const refs = listed.code === 0 ? listed.out.split(/\r?\n/u).filter((r) => r !== "") : [];
  const ticket = waybillTicket(dispatch);
  const branched = laneNamesFromBranches(refs, ticket);
  if (mode === "single-thread") {
    if (dispatched.length > 0) {
      return {
        ok: false,
        detail: `single-thread run logged a workhorse dispatch: ${dispatched
          .map((e) => String(e.target))
          .join(", ")}`,
      };
    }
    if (branched.length > 0) {
      return {
        ok: false,
        detail: `single-thread run has workhorse branches: ${branched.join(", ")}`,
      };
    }
    return { ok: true, detail: "single-thread: no workhorse dispatch, no workhorse branch" };
  }
  const config = meta.config as Record<string, unknown> | undefined;
  const team = config?.team as Record<string, unknown> | undefined;
  let lanes = Array.isArray(team?.workhorses) ? team.workhorses.map(String) : [];
  if (lanes.length === 0) {
    try {
      const brief = readFileSync(join(dispatch, "brief.md"), "utf8");
      lanes = laneNamesFromWorkhorses(brief);
    } catch {
      lanes = [];
    }
  }
  if (lanes.length === 0) return { ok: false, detail: "synthesis run names no workhorses" };
  const targets = new Set(dispatched.map((e) => String(e.target)));
  const undispatched = lanes.filter((lane) => !targets.has(lane));
  if (undispatched.length > 0) {
    return { ok: false, detail: `synthesis run never dispatched: ${undispatched.join(", ")}` };
  }
  const unbranched = lanes.filter((lane) => !branched.includes(lane));
  if (unbranched.length > 0) {
    return { ok: false, detail: `synthesis run has no branch for: ${unbranched.join(", ")}` };
  }
  return { ok: true, detail: `synthesis: dispatched and branched ${lanes.join(", ")}` };
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
    const r = sh([join(HERE, "run"), "handoff-check", f]);
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
  return { ok: true, detail: `${legs.length} hand-offs pass scripts/run handoff-check` };
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

export function checkWaybillEfforts(dispatch: string): { ok: boolean; detail: string } {
  const data = tryJsonFile<Record<string, unknown>>(join(dispatch, "run.json"));
  if (!existsSync(join(dispatch, "run.json"))) {
    return { ok: true, detail: "skipped: no run.json" };
  }
  if (!data || !data.config || typeof data.config !== "object") {
    return { ok: false, detail: "no run.json config" };
  }
  const brief = join(dispatch, "brief.md");
  if (!existsSync(brief)) return { ok: false, detail: "no brief.md" };
  const teamText = sectionOf(readFileSync(brief, "utf8"), "Team");
  const lines = teamText.split(/\r?\n/u).map((line) => line.trim());
  const effortLines = lines.filter((line) => line.startsWith("efforts:"));
  const config = data.config as Record<string, unknown>;
  const expected = effortsLine(config);
  if (effortLines.length !== 1 || effortLines[0] !== expected) {
    return {
      ok: false,
      detail: `waybill efforts differ from run.json: expected ${expected}, got ${effortLines.length === 1 ? effortLines[0] : "missing or repeated"}`,
    };
  }
  // Each Team entry's effort, the slot after the recorded `harness/model` because a
  // model may itself hold a slash, against the recorded effort. An entry ending at the
  // recorded prefix carries no effort, so both honest effortless renderings pass; an
  // omitted slot for a recorded effort fails, as does a carried effort for an
  // unrecorded name. A Team section with no workhorses or coachman line fails outright.
  const lanes = (config.lanes ?? {}) as Record<string, Record<string, unknown>>;
  const team = (config.team ?? {}) as Record<string, unknown>;
  const recordedSpec = (name: string): { effort: string; prefix: string } => {
    const spec =
      name === "coachman" ? (team.coachman as Record<string, unknown> | undefined) : lanes[name];
    const str = (v: unknown): string => (typeof v === "string" ? v : "");
    const harness = str(spec?.harness);
    const model = str(spec?.model);
    return { effort: str(spec?.effort), prefix: harness && model ? `${harness}/${model}` : "" };
  };
  let seen = false;
  for (const line of lines) {
    const m = /^(workhorses|coachman):[ \t]*(.+)$/u.exec(line);
    if (!m) continue;
    seen = true;
    for (const entry of m[2]!.split(",").map((s) => s.trim())) {
      const eq = entry.indexOf("=");
      if (m[1] === "workhorses" && eq < 0) continue; // a bare name carries nothing
      const name = eq < 0 ? "coachman" : entry.slice(0, eq).trim();
      const rest = eq < 0 ? entry : entry.slice(eq + 1);
      const want = recordedSpec(name);
      if (want.prefix) {
        if (rest !== want.prefix && !rest.startsWith(`${want.prefix}/`)) {
          return {
            ok: false,
            detail: `Team ${name} names ${rest}, recorded ${want.prefix}`,
          };
        }
        const effort = rest.slice(want.prefix.length).replace(/^\//u, "").trim();
        if (effort !== want.effort) {
          return {
            ok: false,
            detail: `Team ${name} effort ${effort || "missing"}, expected ${want.effort || "missing"}`,
          };
        }
        continue;
      }
      // No recorded harness and model to bound the effort slot: the entry's last `/`
      // field, as before. A carried effort for an unrecorded name fails here.
      const fields = rest.split("/");
      if (fields.length < 3) continue;
      const effort = fields[fields.length - 1]!.trim();
      if (effort !== want.effort) {
        return {
          ok: false,
          detail: `Team ${name} effort ${effort || "missing"}, expected ${want.effort || "missing"}`,
        };
      }
    }
  }
  if (!seen) return { ok: false, detail: "no Team workhorses or coachman entries" };
  return { ok: true, detail: "waybill Team efforts match run.json" };
}

function checkReach(dispatch: string): { ok: boolean; detail: string } {
  let actions: ReturnType<typeof reachActions>;
  try {
    actions = reachActions(dispatch);
  } catch (e) {
    return { ok: false, detail: `cannot read reach actions: ${String(e)}` };
  }
  const points = actions.filter(({ event }) => event.kind === "point");
  const pointNames = new Set(points.map(({ event }) => event.point));
  // A single-thread run never runs "Check lane reach before synthesis", so the
  // workhorses point is expected only of a synthesis run; a record with no mode
  // reads as synthesis, as the mode item does.
  const expected = new Set(["card"]);
  const single = runMode(dispatch) === "single-thread";
  if (!single) expected.add("workhorses");
  const logs = join(dispatch, "logs");
  try {
    for (const name of readdirSync(logs)) {
      const match = /^review-r([1-9][0-9]*)\.json$/u.exec(name);
      if (match) expected.add(`r${match[1]}`);
    }
  } catch (e) {
    return { ok: false, detail: `cannot list review records: ${String(e)}` };
  }
  const missing = [...expected].filter((point) => !pointNames.has(point));
  if (missing.length > 0) return { ok: false, detail: `not checked: ${missing.join(", ")}` };

  const findings = actions.filter(({ event }) => event.kind === "finding" || event.kind === "void");
  if (findings.length > 0) {
    const first = findings[0]!.event;
    return {
      ok: false,
      detail: `reach found at ${first.point}: ${first.path ?? first.reason ?? first.kind}`,
    };
  }
  for (const { event } of points) {
    if (event.result === "finding") return { ok: false, detail: `reach found at ${event.point}` };
    const lanes = Array.isArray(event.lanes) ? event.lanes : [];
    for (const laneValue of lanes) {
      const lane =
        typeof laneValue === "object" && laneValue !== null
          ? (laneValue as Record<string, unknown>)
          : {};
      if (lane.status === "not checked" && REACH_READERS.has(String(lane.harness ?? ""))) {
        return {
          ok: false,
          detail: `not checked: ${String(lane.lane ?? "lane")} at ${event.point}`,
        };
      }
    }
  }
  return {
    ok: true,
    detail: single
      ? "review rounds and card checked with no reach"
      : "workhorses, review rounds and card checked with no reach",
  };
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

// --- time lines (#265) -------------------------------------------------------------------
// The stage table and the lane times report where the run's time went; they print after the
// checks and never change the exit, which comes from the checks alone. A wait over 10 minutes
// and a run over an hour are named, not failed: the providers and the machine's load are not
// the change the run was proving.
const LONG_WAIT_SEC = 600;
const HOUR_SEC = 3600;

/** A lane or lens name safe to carry into a marker path: no traversal, no glob. */
function safeTimingName(value: unknown): value is string {
  return (
    typeof value === "string" && value !== "." && value !== ".." && /^[A-Za-z0-9._-]+$/u.test(value)
  );
}

function markerMtime(path: string): number | null {
  try {
    const file = lstatSync(path);
    if (!file.isFile()) return null;
    return file.mtimeMs;
  } catch {
    return null;
  }
}

interface TimedLine {
  line: string;
  secs: number | null;
}

/** The lines slowest first, ties by line so the order is stable on every machine; a lane
 * that could not be timed comes last, as named. */
function slowestFirst(entries: TimedLine[]): string[] {
  return [...entries]
    .sort((a, b) => (b.secs ?? -1) - (a.secs ?? -1) || (a.line < b.line ? -1 : 1))
    .map((e) => e.line);
}

/** `workhorses: …`, one entry per lane the coachman launched: its dispatch to its
 * `.done` marker, or the lane named as having no marker. */
function workhorseLine(dispatch: string, events: Array<Record<string, unknown>>): string | null {
  const launched = new Map<string, number>();
  for (const e of events) {
    if (e.action !== "dispatch" || e.actor !== "coachman") continue;
    if (!safeTimingName(e.target)) continue;
    const ts = typeof e.ts === "string" ? parseTs(e.ts) : null;
    if (ts === null) continue;
    const at = ts.getTime();
    if (!launched.has(e.target) || at < (launched.get(e.target) ?? Infinity)) {
      launched.set(e.target, at);
    }
  }
  if (launched.size === 0) return null;
  const entries: TimedLine[] = [];
  for (const [lane, launch] of launched) {
    const marker = markerMtime(join(dispatch, "logs", `${lane}.done`));
    if (marker === null) {
      entries.push({ line: `${lane} no marker`, secs: null });
      continue;
    }
    const secs = Math.max(0, (marker - launch) / 1000);
    entries.push({ line: `${lane} ${fmt(secs)}`, secs });
  }
  return `workhorses: ${slowestFirst(entries).join(", ")}`;
}

/** The `review-launch` that started this reviewer's attempt: its detail names the lens
 * and the round, as the coachman logs them. The earliest at or after the round's own
 * start wins; before it only if nothing else was logged. */
function reviewLaunch(
  events: Array<Record<string, unknown>>,
  lane: string,
  lens: string,
  round: number,
  since: Date | null,
): Date | null {
  // ASCII: launch details are machine-logged lines.
  const lensRe = new RegExp(`\\b${lens.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\b`, "u");
  // ASCII: launch details are machine-logged lines.
  const roundRe = new RegExp(`\\bround\\s*${round}\\b|\\br${round}\\b`, "u");
  let found: Date | null = null;
  let any = false;
  for (const e of events) {
    if (e.action !== "review-launch" || e.target !== lane || typeof e.detail !== "string") continue;
    if (!lensRe.test(e.detail) || !roundRe.test(e.detail)) continue;
    const ts = typeof e.ts === "string" ? parseTs(e.ts) : null;
    if (ts === null) continue;
    any = true;
    if (since !== null && ts < since) continue;
    if (found === null || ts < found) found = ts;
  }
  if (found === null && any) return reviewLaunch(events, lane, lens, round, null);
  return found;
}

/** One `review round N:` line per round file, each reviewer named with its lens and its
 * launch-to-marker time, slowest first; a lane with no marker is named, never timed. */
function reviewRoundLines(dispatch: string, events: Array<Record<string, unknown>>): string[] {
  const logs = join(dispatch, "logs");
  let files: string[];
  try {
    files = readdirSync(logs);
  } catch {
    return [];
  }
  const rounds = files
    // ASCII: round files are machine-named review-rN.json.
    .map((f) => /^review-r(\d+)\.json$/u.exec(f))
    .filter((m): m is RegExpExecArray => m !== null)
    .sort((a, b) => parseInt(a[1]!, 10) - parseInt(b[1]!, 10));
  const lines: string[] = [];
  for (const m of rounds) {
    const n = parseInt(m[1]!, 10);
    const data = tryJsonFile<Record<string, unknown>>(join(logs, `review-r${n}.json`));
    if (!data) continue;
    const since = typeof data.started === "string" ? parseTs(data.started) : null;
    const reviewers = Array.isArray(data.reviewers) ? data.reviewers : [];
    const entries: TimedLine[] = [];
    for (const r of reviewers) {
      if (!Array.isArray(r) || !safeTimingName(r[0]) || !safeTimingName(r[1])) continue;
      const [lens, lane] = [r[0], r[1]];
      const marker = markerMtime(join(logs, `review-r${n}-${lens}-${lane}.done`));
      if (marker === null) {
        entries.push({ line: `${lane} ${lens} no marker`, secs: null });
        continue;
      }
      const launch = reviewLaunch(events, lane, lens, n, since);
      if (launch === null) {
        entries.push({ line: `${lane} ${lens} no launch`, secs: null });
        continue;
      }
      const secs = Math.max(0, (marker - launch.getTime()) / 1000);
      entries.push({ line: `${lane} ${lens} ${fmt(secs)}`, secs });
    }
    if (entries.length > 0) lines.push(`review round ${n}: ${slowestFirst(entries).join(", ")}`);
  }
  return lines;
}

/** Everything the score prints after its checks: the run-times stage table (the same
 * figures `run run-times` prints), the lane lines, then the named waits and the total.
 * A log with no stage changes is said, and the verdict is the checks' own. */
export function timeReport(dispatch: string): string {
  const lines: string[] = [];
  const times = computeTimes(dispatch);
  if (times.ok) lines.push(...times.table.text.replace(/\n$/u, "").split("\n"));
  else lines.push(`the run could not be timed: ${times.message}`);
  const events = readActions(dispatch) ?? [];
  const workhorses = workhorseLine(dispatch, events);
  if (workhorses !== null) lines.push(workhorses);
  lines.push(...reviewRoundLines(dispatch, events));
  if (times.ok) {
    const longWaits = times.table.rows.filter(
      (r) => r.waitSec !== null && r.waitSec > LONG_WAIT_SEC,
    );
    if (longWaits.length > 0) {
      lines.push(`long wait: ${longWaits.map((r) => `${r.stage} ${fmt(r.waitSec!)}`).join(", ")}`);
    }
    if (times.table.totalSec > HOUR_SEC) {
      lines.push(`the run took longer than an hour: ${fmt(times.table.totalSec)}`);
    }
  }
  return lines.map((l) => `${l}\n`).join("");
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
    need("git", "bun", "node", "npm");
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
