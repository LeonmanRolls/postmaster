// Run the flow end to end against a small app whose tickets have a known outcome, and score a
// finished run from its own records.
//
//   fixture.sh new <name or dest> <ticket>
//   fixture.sh score <dispatch> <repo>
//   fixture.sh hidden <ticket> <app-dir>
//   fixture.sh --self-test
//
//   exit 0  new: made and filed; score, hidden: every check passed
//   exit 1  usage, a tool not on PATH, a refusal from new, or input that is not what it says
//   exit 2  score, hidden: a check failed

import { randomUUID } from "node:crypto";
import {
  chmodSync,
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
import { die, run, withTempDir } from "./lib/proc.ts";
import { SelfTest } from "./lib/selftest.ts";
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

const HERE = scriptsDir(import.meta);
const TOOL = toolRoot(import.meta);
const APP = join(TOOL, "fixtures", "app");
const TICKETS = join(TOOL, "fixtures", "tickets");
const TIMEOUT = 1200;
const _CHECKS = ["hidden-tests", "gate", "stages", "markers", "handoffs", "run.json", "ship-card"];

function usage(): never {
  die(
    "usage: fixture.sh new <name or dest> <ticket> | score <dispatch> <repo> | hidden <ticket> <app-dir> | --self-test",
    1,
  );
}

function onPath(t: string): boolean {
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

function tickets(): string[] {
  try {
    return readdirSync(TICKETS)
      .filter((d) => existsSync(join(TICKETS, d, "ticket.md")))
      .sort();
  } catch {
    return [];
  }
}

function ticketTitle(t: string): string {
  const text = readFileSync(join(TICKETS, t, "ticket.md"), "utf8");
  return text.split("\n")[0]?.replace(/^# /u, "") ?? "";
}

function ticketBody(t: string): string {
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
function appFiles(dir: string): string[] | null {
  const r = run("git", ["-C", dir, "ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
  // BASE's check=True: a listing that fails fails the copy, never an empty app.
  if (r.code !== 0) return null;
  return r.out.split("\0").filter((n) => n !== "");
}
function makeRepo(dest: string, src = APP): boolean {
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

function makeAndFile(dest: string, ticket: string): number {
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

function sh(
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

function tail(text: string, n = 20): string {
  return pySplitLines(pyRstrip(text)).slice(-n).join("\n");
}

function squash(text: string): string {
  return pyWords(text).join(" ");
}

function sectionOf(text: string, heading: string): string {
  const re = new RegExp(
    `${PY_M_START}##[ \t]+${literalI(heading)}[ \t]*\n(${DOT_ALL}*?)(?=${PY_M_START}##[ \t]|${END_OF_STRING})`,
    "gisu",
  );
  const m = re.exec(text);
  return m ? m[1]! : "";
}

const HIDDEN_RE = new RegExp(
  `${PY_M_START}[${PY_S_CLASS}]*(\\p{Nd}+) (pass|fail)[${PY_S_CLASS}]*${PY_M_END}`,
  "gu",
);

function hidden(ticket: string, app: string): { passed: boolean; detail: string; out: string } {
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

function score(dispatch: string, repo: string): { code: number; out: string } {
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
    { name: "hidden-tests", ...checkHidden(dispatch, app) },
    { name: "gate", ...checkGate(app) },
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
function makeBodyFile(body: string): string {
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
function makeScoreDir(): string {
  return mkdtempSync(join(makeTmpDir(), "fixture-score-"));
}

const LEG_FILE_RE = new RegExp(
  `^(?:\\.leg-(\\p{Nd}+)-(?:done|exited)|leg-(\\p{Nd}+)-(?:prompt|takeover)\\.txt|handoff-(\\p{Nd}+)\\.md)${END_OF_STRING}`,
  "u",
);

function legsOf(dispatch: string, manifest: Record<string, unknown> | null): number[] {
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

function checkHidden(dispatch: string, app: string): { ok: boolean; detail: string; out: string } {
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
  return { ok: h.passed, detail: `${found[0]}, from the waybill: ${h.detail} on main`, out: h.out };
}

function checkGate(app: string): { ok: boolean; detail: string; out: string } {
  const r = sh(["bash", join(HERE, "discover-project.sh"), app]);
  const gate = (r.out ?? "")
    .split("\n")
    .find((l) => l.startsWith("gate="))
    ?.slice(5);
  if (!gate)
    return { ok: false, detail: "scripts/discover-project.sh found no gate", out: r.out ?? "" };
  const install = existsSync(join(app, "package-lock.json")) ? ["npm", "ci"] : ["npm", "install"];
  const inst = sh([...install, "--prefer-offline", "--no-audit", "--no-fund"], app);
  if (inst.code !== 0)
    return {
      ok: false,
      detail: `${install.join(" ")} on main: ${exited(inst.code)}`,
      out: inst.out ?? "",
    };
  const g = sh(["bash", "-c", gate], app);
  return { ok: g.code === 0, detail: `${gate} on main: ${exited(g.code)}`, out: g.out ?? "" };
}

function checkStages(dispatch: string): { ok: boolean; detail: string } {
  const r = sh(["bash", join(HERE, "stage.sh"), "--list"]);
  const listed = pyWords(r.out ?? "");
  if (r.code !== 0 || !listed.includes("done")) {
    return { ok: false, detail: "scripts/stage.sh --list names no done stage" };
  }
  const expected = listed.slice(0, listed.indexOf("done") + 1);
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
if (argv[0] === "--self-test") {
  // fall through
} else if (argv[0] === "new") {
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

// --- self-test ---------------------------------------------------------------------------------
need("git", "bun", "npm", "jq");
withTempDir((tmp) => {
  // Set up test config
  const configPath = join(tmp, "config.toml");
  writeFileSync(
    configPath,
    `[lanes.one]
harness = "bash"
model = "m1"
[lanes.two]
harness = "bash"
model = "m2"
[team]
workhorses = ["one", "two"]
coachman = { harness = "bash", model = "judge" }
[tracker]
kind = "github"
`,
  );
  process.env.POSTMASTER_CONFIG = configPath;
  process.env.POSTMASTER_TOOL_PINS = join(tmp, "tools");
  process.env.GIT_AUTHOR_NAME = "fixture";
  process.env.GIT_AUTHOR_EMAIL = "fixture@example.invalid";
  process.env.GIT_COMMITTER_NAME = "fixture";
  process.env.GIT_COMMITTER_EMAIL = "fixture@example.invalid";

  const st = new SelfTest();
  // Unicode primitives: tail/squash/sectionOf/hidden/legsOf match the BASE
  // fixture.sh python (re.M|S|I, \s, \d, \Z, str.split/splitlines,
  // int/isdigit), not JS string semantics. Every expected value below was
  // verified against python3; each check fails on the pre-route spelling.
  {
    const u = mkdtempSync(join(tmpdir(), "fixture-uni-"));
    const u2 = mkdtempSync(join(tmpdir(), "fixture-uni2-"));
    const u3 = mkdtempSync(join(tmpdir(), "fixture-uni3-"));
    writeFileSync(join(u, ".leg-١-done"), "");
    writeFileSync(join(u2, "x.leg-1-done"), "");
    let supThrew = false;
    try {
      legsOf(u3, { coachman: { legs: { "²": 1 } } }); // U+00B2: isdigit true, int() raises
    } catch {
      supThrew = true;
    }
    const hidAR = [..."٣ pass\n".matchAll(HIDDEN_RE)].map((m) => [m[1], m[2]]);
    const cases: Array<[string, string, string]> = [
      ["tail splits on CR and CRLF, not just LF", tail("a\rb\r\nc"), "a\nb\nc"],
      ["tail keeps a trailing FEFF (not Python space)", tail("x\uFEFF"), "x\uFEFF"],
      ["tail breaks on U+001C", tail("a\x1cb"), "a\nb"],
      ["squash splits on U+001C", squash("a\x1cb"), "a b"],
      ["squash does not split on FEFF", squash("a\uFEFFb"), "a\uFEFFb"],
      [
        "sectionOf returns every line to the next heading",
        sectionOf("## Acceptance criteria\n- a\n- b\n## Direction\nx\n", "Acceptance criteria"),
        "- a\n- b\n",
      ],
      [
        "sectionOf runs to the absolute end (keeps the final LF)",
        sectionOf("## A\nbody\n", "A"),
        "body\n",
      ],
      ["sectionOf folds dotted-I headings", sectionOf("## dırectıon\nX\n", "DIRECTION"), "X\n"],
      [
        "sectionOf folds ASCII case",
        sectionOf("## Acceptance Criteria\nQ\n", "acceptance criteria"),
        "Q\n",
      ],
      ["hidden counts Arabic-Indic digits", JSON.stringify(hidAR), JSON.stringify([["٣", "pass"]])],
      ["legsOf reads an Arabic-Indic leg file", JSON.stringify(legsOf(u, null)), "[1]"],
      ["legsOf rejects a partial leg-file name", JSON.stringify(legsOf(u2, null)), "[]"],
      [
        "legsOf reads Arabic-Indic manifest keys",
        JSON.stringify(legsOf(u3, { coachman: { legs: { "١٢": 1 } } })),
        "[1,2,3,4,5,6,7,8,9,10,11,12]",
      ],
      ["legsOf throws on an int()-proof key, as int() raises", String(supThrew), "true"],
      ["legsOf ignores a float leg", JSON.stringify(legsOf(u3, { leg: 1.5 })), "[]"],
    ];
    for (const [name, got, want] of cases) st.check(name, got === want, `got=${got} want=${want}`);
  }
  // Shell lookups take their operand as argv, never pasted into a command
  // string: a name holding $(...) is looked up literally, and runs nothing.
  {
    const marker = join(tmp, "onpath-marker");
    const found = onPath(`zz-nonexistent-$(touch ${marker})`);
    st.check(
      "a tool name holding $(...) is looked up literally, and runs nothing",
      !found && !existsSync(marker),
      `found=${found} marker=${existsSync(marker)}`,
    );
    const marker2 = join(tmp, "appfiles-marker");
    const listed = appFiles(join(tmp, `nonesuch-$(touch ${marker2})`));
    st.check(
      "a directory holding $(...) lists literally, and runs nothing",
      listed === null && !existsSync(marker2),
      `listed=${listed} marker=${existsSync(marker2)}`,
    );
  }
  // Temporary names are private and never reused, as `mktemp` makes them.
  {
    const b1 = makeBodyFile("one");
    const b2 = makeBodyFile("two");
    const m1 = statSync(b1).mode & 0o777;
    const m2 = statSync(b2).mode & 0o777;
    st.check(
      "temporary body files are mode 0600, unique, and hold their own bytes",
      m1 === 0o600 &&
        m2 === 0o600 &&
        b1 !== b2 &&
        readFileSync(b1, "utf8") === "one" &&
        readFileSync(b2, "utf8") === "two",
      `${b1} ${m1.toString(8)} ${b2} ${m2.toString(8)}`,
    );
    rmSync(b1, { force: true });
    rmSync(b2, { force: true });
    const s1 = makeScoreDir();
    const s2 = makeScoreDir();
    const d1 = statSync(s1).mode & 0o777;
    const d2 = statSync(s2).mode & 0o777;
    st.check(
      "temporary score directories are mode 0700 and never reused",
      d1 === 0o700 && d2 === 0o700 && s1 !== s2,
      `${s1} ${d1.toString(8)} ${s2} ${d2.toString(8)}`,
    );
    rmSync(s1, { recursive: true, force: true });
    rmSync(s2, { recursive: true, force: true });
  }
  const first = tickets()[0] ?? "";

  // Background runner
  const bgResults = new Map<string, { code: number; out: string }>();
  const background = (name: string, fn: () => number | { code: number; out: string }): void => {
    const r = fn();
    if (typeof r === "number") bgResults.set(name, { code: r, out: "" });
    else bgResults.set(name, r);
  };
  const rcOf = (name: string): number | "none" => {
    return bgResults.has(name) ? (bgResults.get(name)?.code ?? 0) : "none";
  };

  // Build the records of finished runs
  const emptyMd = join(tmp, "empty.md");
  writeFileSync(emptyMd, "");
  const sectionsR = run("bash", [join(HERE, "handoff-check.sh"), emptyMd]);
  const sections = sectionsR.err
    .split("\n")
    .filter((l) => l.startsWith("handoff-check: missing or empty section: "))
    .map((l) => l.replace("handoff-check: missing or empty section: ", ""))
    .join("\n");
  const listedR = run("bash", [join(HERE, "stage.sh"), "--list"]);
  const listed = listedR.out.trim();
  const stageLines = listed.split("\n");
  const doneIdx = stageLines.indexOf("done");
  const stages = doneIdx > 0 ? stageLines.slice(1, doneIdx).join("\n") : "";

  const record = (name: string, t: string, shipped: "reference" | "app" | "broken"): number => {
    const legs = 3;
    const repo = join(tmp, name, "repo");
    const d = join(tmp, name, "repo", ".postmaster", "runs", "7");
    mkdirSync(join(tmp, name), { recursive: true });
    if (!makeRepo(repo)) return 1;
    mkdirSync(join(d, "logs"), { recursive: true });
    mkdirSync(join(d, "audit"), { recursive: true });
    mkdirSync(join(d, "render"), { recursive: true });
    const base = run("git", ["-C", repo, "rev-parse", "HEAD"]).out.trim();
    if (run("git", ["-C", repo, "checkout", "-q", "-b", "7"]).code !== 0) return 1;
    const patchPath = join(TICKETS, t, "reference.patch");
    if (shipped === "reference" || shipped === "broken") {
      if (run("git", ["-C", repo, "apply", patchPath]).code !== 0) return 1;
    }
    if (shipped === "broken") {
      writeFileSync(
        join(repo, "src", "broken.ts"),
        'export const broken: number = "not a number";\n',
      );
    }
    run("git", ["-C", repo, "add", "-A"]);
    if (
      run("git", ["-C", repo, "commit", "-q", "--allow-empty", "-m", "Implement the ticket"])
        .code !== 0
    )
      return 1;
    if (run("git", ["-C", repo, "checkout", "-q", "main"]).code !== 0) return 1;
    if (run("git", ["-C", repo, "merge", "-q", "--no-ff", "-m", "Merge branch 7", "7"]).code !== 0)
      return 1;

    writeFileSync(
      join(d, "manifest.json"),
      JSON.stringify({ stage: "dispatched", leg: 1, base, lanes: {}, coachman: { legs: {} } }) +
        "\n",
    );
    writeFileSync(
      join(d, "brief.md"),
      `# Waybill: 7\n\n## Ticket\n\n${ticketBody(t)}\n## Project profile\nrepo: ${repo}\n`,
    );
    run("bash", [join(HERE, "run-meta.sh"), d, repo]);

    const stageList = stages.split("\n").filter(Boolean);
    const count = stageList.length;
    let doneStages = 0;
    for (let n = 1; n <= legs; n++) {
      writeFileSync(join(d, `leg-${n}-prompt.txt`), `You are the coachman for leg ${n} of 7.\n`);
      run("bash", [join(HERE, "log-action.sh"), d, "postmaster", "dispatch", "7", `leg ${n}`]);
      run("bash", [join(HERE, "log-action.sh"), d, "coachman", "handoff-accept", `leg-${n}`]);
      const upto = Math.floor((count * n) / legs);
      for (let si = doneStages; si < upto; si++) {
        const s = stageList[si];
        if (s) run("bash", [join(HERE, "stage.sh"), d, s]);
      }
      doneStages = upto;
      const handoffSections = sections.split("\n").filter(Boolean);
      writeFileSync(
        join(d, `handoff-${n}.md`),
        handoffSections.map((sec) => `## ${sec}\nLeg ${n}, recorded.\n\n`).join(""),
      );
      run("bash", [join(HERE, "log-action.sh"), d, "coachman", "handoff", `leg-${n}`]);
      writeFileSync(join(d, `.leg-${n}-done`), "");
      writeFileSync(join(d, `.leg-${n}-exited`), "");
    }
    run("bash", [join(HERE, "stage.sh"), d, "done", "postmaster"]);
    writeFileSync(join(d, "card.md"), `# Ship card: 7\n\nBranch 7 is merged into main.\n`);
    // Update manifest with legs
    const manifest = JSON.parse(readFileSync(join(d, "manifest.json"), "utf-8"));
    manifest.leg = legs;
    manifest.coachman.legs = {};
    for (let n = 1; n <= legs; n++) {
      manifest.coachman.legs[String(n)] = { thread_id: `thread-${n}` };
    }
    writeFileSync(join(d, "manifest.json"), JSON.stringify(manifest, null, 2));
    return 0;
  };

  const brokenCopy = (name: string, clean: string): string => {
    const d = join(tmp, name, "repo", ".postmaster", "runs", "7");
    mkdirSync(dirname(d), { recursive: true });
    cpSync(clean, d, { recursive: true });
    return d;
  };

  const breaks = (clean: string, repo: string): void => {
    // break-stages: remove the 3rd stage change
    let d = brokenCopy("break-stages", clean);
    const actionsPath = join(d, "actions.jsonl");
    const kept: string[] = [];
    let stageSeen = 0;
    for (const line of readFileSync(actionsPath, "utf-8").split("\n")) {
      if (!line.trim()) continue;
      try {
        if (JSON.parse(line).action === "stage") {
          stageSeen++;
          if (stageSeen === 3) continue;
        }
      } catch {
        /* skip */
      }
      kept.push(line);
    }
    writeFileSync(actionsPath, `${kept.join("\n")}\n`);

    d = brokenCopy("break-markers", clean);
    rmSync(join(d, ".leg-2-done"), { force: true });

    d = brokenCopy("break-handoffs", clean);
    writeFileSync(join(d, "handoff-2.md"), "");

    d = brokenCopy("break-runjson", clean);
    rmSync(join(d, "run.json"), { force: true });

    d = brokenCopy("break-card", clean);
    rmSync(join(d, "card.md"), { force: true });

    d = brokenCopy("break-waybill", clean);
    writeFileSync(join(d, "brief.md"), "# Waybill: 7\n\n## Ticket\n\nSee the tracker.\n");

    for (const b of ["stages", "markers", "handoffs", "runjson", "card", "waybill"]) {
      background(`break-${b}`, () =>
        score(join(tmp, `break-${b}`, "repo", ".postmaster", "runs", "7"), repo),
      );
    }
  };

  const recorded = (
    name: string,
    t: string,
    shipped: "reference" | "app" | "broken",
  ): number | { code: number; out: string } => {
    const rc = record(name, t, shipped);
    if (rc !== 0) {
      console.log(`the record could not be built for ${name}`);
      return 1;
    }
    if (name === `clean-${first}`) {
      breaks(join(tmp, name, "repo", ".postmaster", "runs", "7"), join(tmp, name, "repo"));
    }
    return score(join(tmp, name, "repo", ".postmaster", "runs", "7"), join(tmp, name, "repo"));
  };

  // Build and score everything
  for (const t of tickets()) {
    background(`clean-${t}`, () => recorded(`clean-${t}`, t, "reference"));
  }
  background("break-hidden", () => recorded("break-hidden", first, "app"));
  background("break-gate", () => recorded("break-gate", first, "broken"));

  // Hidden suite tests
  const hiddenResults: Record<string, number> = {};
  for (const t of tickets()) {
    const appDir = join(tmp, `app-${t}`);
    const refDir = join(tmp, `ref-${t}`);
    makeRepo(appDir);
    makeRepo(refDir);
    const applyR = run("git", ["-C", refDir, "apply", join(TICKETS, t, "reference.patch")]);
    hiddenResults[`applied-${t}`] = applyR.code;
    background(`hidden-app-${t}`, () => {
      const h = hidden(t, appDir);
      return h.passed ? 0 : 2;
    });
    background(`hidden-ref-${t}`, () => {
      const h = hidden(t, refDir);
      return h.passed ? 0 : 2;
    });
  }

  // --- controls ---
  console.log(
    "the tickets: each hidden suite fails on the app as committed and passes on its reference",
  );
  st.check("there are at least two tickets", tickets().length >= 2, `${tickets().length} tickets`);
  for (const t of tickets()) {
    const body = ticketBody(t);
    writeFileSync(join(tmp, `body-${t}.md`), body);
    const checkR = run("bash", [
      join(HERE, "ticket-check.sh"),
      "--body",
      join(tmp, `body-${t}.md`),
      "--title",
      ticketTitle(t),
    ]);
    st.check(
      `${t}: in the ticket shape, by scripts/ticket-check.sh`,
      checkR.code === 0,
      checkR.out + checkR.err,
    );
    st.check(
      `${t}: the reference solution applies to the app`,
      hiddenResults[`applied-${t}`] === 0,
    );
    st.check(
      `${t}: the hidden suite fails on the app as committed`,
      rcOf(`hidden-app-${t}`) === 2,
      `exit ${rcOf(`hidden-app-${t}`)}`,
    );
    st.check(
      `${t}: the hidden suite passes on the reference solution`,
      rcOf(`hidden-ref-${t}`) === 0,
      `exit ${rcOf(`hidden-ref-${t}`)}`,
    );
  }

  // new: make the repo and file the ticket
  console.log("new: a fresh repo outside every other, with its ticket in its own store");
  // create a failing local.sh stub
  const failingLocal = join(tmp, "failing-local.sh");
  writeFileSync(
    failingLocal,
    `#!/usr/bin/env bash
# Stands in for scripts/local.sh: makes the store, and fails to file the ticket.
case $2 in store) exec "${join(HERE, "local.sh")}" "$@" ;; *) exit 1 ;; esac
`,
  );
  run("chmod", ["+x", failingLocal]);
  mkdirSync(join(tmp, "home"), { recursive: true });
  mkdirSync(join(tmp, "runs"), { recursive: true });

  const freshNew = (dest: string, ticket: string): { code: number; out: string } => {
    const origHome = process.env.HOME;
    process.env.HOME = join(tmp, "home");
    try {
      // capture stdout/stderr by running makeAndFile
      const origLog = console.log;
      const origErr = console.error;
      let captured = "";
      console.log = (...args: any[]) => {
        captured += `${args.join(" ")}\n`;
      };
      console.error = (...args: any[]) => {
        captured += `${args.join(" ")}\n`;
      };
      try {
        const code = makeAndFile(dest, ticket);
        return { code, out: captured };
      } finally {
        console.log = origLog;
        console.error = origErr;
      }
    } finally {
      if (origHome === undefined) delete process.env.HOME;
      else process.env.HOME = origHome;
    }
  };

  const dest = join(tmp, "runs", `fixture-${first}`);
  let r = freshNew(dest, first);
  st.check(
    "new makes the repo and prints the ticket's number",
    r.code === 0 && r.out.includes("own ticket store as #1:"),
    `exit ${r.code}\n${r.out}`,
  );
  {
    const count = run("git", ["-C", dest, "rev-list", "--count", "main"]).out.trim();
    const status = run("git", ["-C", dest, "status", "--porcelain"]).out.trim();
    st.check(
      "one commit on main, and a clean tree",
      count === "1" && status === "",
      `count=${count} status=${status}`,
    );
  }
  {
    // Compare files
    const listed2 = run("bash", [
      "-c",
      `git -C "${APP}" ls-files --cached --others --exclude-standard`,
    ])
      .out.trim()
      .split("\n")
      .sort();
    let same = true;
    for (const f of listed2) {
      if (!f) continue;
      const appF = join(APP, f);
      const destF = join(dest, f);
      if (lstatSync(appF).isSymbolicLink()) {
        if (readlinkSync(appF) !== (existsSync(destF) ? readlinkSync(destF) : "")) same = false;
      } else {
        const cmp = run("cmp", ["-s", appF, destF]);
        if (cmp.code !== 0) same = false;
      }
    }
    // Check dest holds exactly the listed files
    const heldFiles = run("bash", [
      "-c",
      `cd "${dest}" && find . -path ./.git -prune -o \\( -type f -o -type l \\) -print | sed 's|^\\./||' | sort`,
    ]).out.trim();
    const isSymlink =
      existsSync(join(dest, "CLAUDE.md")) && lstatSync(join(dest, "CLAUDE.md")).isSymbolicLink();
    st.check(
      "it holds the app's files as git sees them, symlink included, and nothing else",
      same && heldFiles === listed2.filter(Boolean).join("\n") && isSymlink,
      `same=${same} isSymlink=${isSymlink}`,
    );
  }
  {
    const destEmail = run("git", ["-C", dest, "config", "--local", "user.email"]).out.trim();
    const toolEmail = run("git", ["-C", TOOL, "config", "user.email"]).out.trim();
    const destName = run("git", ["-C", dest, "config", "--local", "user.name"]).out.trim();
    const toolName = run("git", ["-C", TOOL, "config", "user.name"]).out.trim();
    st.check("it commits as this checkout does", destEmail === toolEmail && destName === toolName);
  }
  {
    const remotes = run("git", ["-C", dest, "remote"]).out.trim();
    st.check("it has no remote", remotes === "", remotes);
  }
  {
    const localSh = join(HERE, "local.sh");
    const listR = run("bash", [localSh, dest, "list"]);
    const readR = run("bash", [localSh, dest, "read", "1", "--body"]);
    const wantList = `#1\ttodo\t${ticketTitle(first)}`;
    const wantBody = ticketBody(first);
    st.check(
      "its own store holds the fixture ticket, title and body verbatim, in todo",
      listR.out.trim() === wantList && readR.out === wantBody,
      `list=${listR.out.trim()} body=${readR.out.slice(0, 50)}`,
    );
  }
  {
    const trackerKind = run("bash", [join(HERE, "tracker-kind.sh"), dest]);
    st.check(
      "a run against it reads the local tracker, though the config names github",
      trackerKind.out.trim() === "local",
      trackerKind.out + trackerKind.err,
    );
  }
  {
    let leaked = false;
    for (const t of tickets()) {
      const hiddenDir = join(TICKETS, t, "hidden");
      try {
        for (const f of readdirSync(hiddenDir)) {
          if (
            run("bash", [
              "-c",
              `find "${dest}" -path "${dest}/.git" -prune -o -name "${f}" -print`,
            ]).out.trim()
          )
            leaked = true;
        }
      } catch {
        /* empty */
      }
      const refName = "reference.patch";
      if (
        run("bash", [
          "-c",
          `find "${dest}" -path "${dest}/.git" -prune -o -name "${refName}" -print`,
        ]).out.trim()
      )
        leaked = true;
    }
    st.check("no hidden test and no reference solution reached it", !leaked);
  }

  // Refusal tests
  r = freshNew(dest, first);
  st.check(
    "a dest that exists is refused, and left alone",
    r.code === 1 && run("git", ["-C", dest, "rev-list", "--count", "main"]).out.trim() === "1",
    `exit ${r.code}\n${r.out}`,
  );
  const nestedDest = join(tmp, `app-${first}`, "nested");
  r = freshNew(nestedDest, first);
  st.check(
    "a dest inside a git repo is refused",
    r.code === 1 && !existsSync(nestedDest),
    `exit ${r.code}\n${r.out}`,
  );
  const sameA = join(tmp, "one", "widgets");
  const sameB = join(tmp, "two", "widgets");
  mkdirSync(join(sameA, ".postmaster", "runs", "T-1"), { recursive: true });
  mkdirSync(join(sameB, ".postmaster", "runs", "T-1"), { recursive: true });
  const aRc = run("bash", [
    join(HERE, "log-action.sh"),
    join(sameA, ".postmaster", "runs", "T-1"),
    "postmaster",
    "note",
    "same-a",
    "one",
  ]).code;
  const bRc = run("bash", [
    join(HERE, "log-action.sh"),
    join(sameB, ".postmaster", "runs", "T-1"),
    "postmaster",
    "note",
    "same-b",
    "two",
  ]).code;
  const ledA = join(sameA, ".postmaster", "runs", "ledger.jsonl");
  const ledB = join(sameB, ".postmaster", "runs", "ledger.jsonl");
  let ledgersDiffer = false;
  try {
    ledgersDiffer = readFileSync(ledA, "utf8") !== readFileSync(ledB, "utf8");
  } catch {
    ledgersDiffer = false;
  }
  st.check(
    "same-basename projects keep separate project-local ledgers",
    aRc === 0 && bRc === 0 && existsSync(ledA) && existsSync(ledB) && ledgersDiffer,
    `a=${aRc} b=${bRc}`,
  );
  const nosuchDest = join(tmp, "runs", "nosuch");
  r = freshNew(nosuchDest, "no-such-ticket");
  st.check(
    "an unknown ticket is refused",
    r.code === 1 && !existsSync(nosuchDest),
    `exit ${r.code}\n${r.out}`,
  );
  // failing local.sh
  {
    const origLocal = process.env.LOCAL_SH;
    process.env.LOCAL_SH = failingLocal;
    const unfiledDest = join(tmp, "runs", "unfiled");
    r = freshNew(unfiledDest, first);
    if (origLocal === undefined) delete process.env.LOCAL_SH;
    else process.env.LOCAL_SH = origLocal;
    st.check(
      "a ticket that cannot be filed: refused, and the repo it made is gone",
      r.code === 1 && !existsSync(unfiledDest) && r.out.includes("filing the ticket"),
      `exit ${r.code}\n${r.out}`,
    );
  }
  // bare name under ~/Code/fixtures
  {
    const origPf = process.env.POSTMASTER_FIXTURES;
    process.env.POSTMASTER_FIXTURES = "";
    process.env.HOME = join(tmp, "home");
    const origLog = console.log;
    const origErr = console.error;
    let captured = "";
    console.log = (...args: any[]) => {
      captured += `${args.join(" ")}\n`;
    };
    console.error = (...args: any[]) => {
      captured += `${args.join(" ")}\n`;
    };
    let bareCode: number;
    try {
      bareCode = makeAndFile("bare-name", first);
    } finally {
      console.log = origLog;
      console.error = origErr;
      if (origPf === undefined) delete process.env.POSTMASTER_FIXTURES;
      else process.env.POSTMASTER_FIXTURES = origPf;
      delete process.env.HOME;
    }
    st.check(
      "a bare name goes under ~/Code/fixtures, not the working directory",
      bareCode === 0 && existsSync(join(tmp, "home", "Code", "fixtures", "bare-name", ".git")),
      `exit ${bareCode}\n${captured}`,
    );
  }
  // POSTMASTER_FIXTURES
  {
    process.env.POSTMASTER_FIXTURES = join(tmp, "elsewhere");
    process.env.HOME = join(tmp, "home");
    const origLog = console.log;
    const origErr = console.error;
    let captured = "";
    console.log = (...args: any[]) => {
      captured += `${args.join(" ")}\n`;
    };
    console.error = (...args: any[]) => {
      captured += `${args.join(" ")}\n`;
    };
    let otherCode: number;
    try {
      otherCode = makeAndFile("other-name", first);
    } finally {
      console.log = origLog;
      console.error = origErr;
      delete process.env.POSTMASTER_FIXTURES;
      delete process.env.HOME;
    }
    st.check(
      "POSTMASTER_FIXTURES moves where a bare name goes",
      otherCode === 0 &&
        existsSync(join(tmp, "elsewhere", "other-name", ".git")) &&
        !existsSync(join(tmp, "home", "Code", "fixtures", "other-name")),
      `exit ${otherCode}\n${captured}`,
    );
  }

  // Score controls
  console.log("score: a recorded run that meets every check scores clean");
  st.check(
    "the hand-off sections and the stages are read from the scripts that define them",
    sections.length > 0 && stages.length > 0 && listed.split("\n").includes("done"),
    `sections=${sections.length} stages=${stages.split("\n").length}`,
  );

  const expectScore = (label: string, name: string, failing: string, failText?: string): void => {
    const result = bgResults.get(name);
    const rc = result ? result.code : -1;
    const out = result ? result.out : "";
    const failLines = out
      .split("\n")
      .filter((l) => l.startsWith("FAIL"))
      .map((l) => pyWords(l)[1] ?? "");
    const failingChecks = failLines.join(",") || "none";
    const lines = out.split("\n").filter((l) => l.trim()).length;
    const wantExit = failing === "none" ? 0 : 2;
    const wantFailing = failing;
    const hasText =
      !failText ||
      out
        .split("\n")
        .filter((l) => l.startsWith("FAIL"))
        .some((l) => l.includes(failText));
    st.check(
      label,
      rc === wantExit && failingChecks === wantFailing && lines === 7 && hasText,
      `wanted exit ${wantExit} with ${wantFailing} failing${failText ? ` ("${failText}")` : ""}, got exit ${rc} with ${failingChecks} failing\n${out}`,
    );
  };

  for (const t of tickets()) {
    expectScore(`a clean run on ${t}: every check passes`, `clean-${t}`, "none");
  }

  console.log("score: negative controls, the same record with one check broken at a time");
  expectScore(
    "the app shipped as committed: hidden-tests alone fails, and the app's own gate passes",
    "break-hidden",
    "hidden-tests",
    "fail on main",
  );
  expectScore(
    "the waybill does not carry the ticket: hidden-tests alone fails",
    "break-waybill",
    "hidden-tests",
    "carries no fixture ticket",
  );
  expectScore(
    "a type error shipped: gate alone fails",
    "break-gate",
    "gate",
    "npm run check on main: exit",
  );
  expectScore(
    "a stage change never logged: stages alone fails",
    "break-stages",
    "stages",
    ", not ",
  );
  expectScore(
    "a leg's done marker missing: markers alone fails",
    "break-markers",
    "markers",
    ".leg-2-done",
  );
  expectScore(
    "a hand-off with no sections: handoffs alone fails",
    "break-handoffs",
    "handoffs",
    "handoff-2.md",
  );
  expectScore("no run.json: run.json alone fails", "break-runjson", "run.json", "no run.json");
  expectScore("no ship card: ship-card alone fails", "break-card", "ship-card", "no card.md");

  console.log("score: input that is not a run is refused, not scored");
  const cleanDir = join(tmp, `clean-${first}`, "repo", ".postmaster", "runs", "7");
  const cleanRepo = join(tmp, `clean-${first}`, "repo");
  {
    const r2 = run("bash", [join(HERE, "fixture.sh"), "score", join(tmp, "nowhere"), cleanRepo], {
      input: "",
    });
    st.check("no such dispatch directory", r2.code === 1, `exit ${r2.code}`);
  }
  {
    mkdirSync(join(tmp, "not-a-repo"), { recursive: true });
    const r2 = run("bash", [join(HERE, "fixture.sh"), "score", cleanDir, join(tmp, "not-a-repo")], {
      input: "",
    });
    st.check("a repo that is not a git repo", r2.code === 1, `exit ${r2.code}`);
  }
  {
    run("git", ["init", "-q", "-b", "main", join(tmp, "other")]);
    run("git", [
      "-C",
      join(tmp, "other"),
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "Another history",
    ]);
    const r2 = run("bash", [join(HERE, "fixture.sh"), "score", cleanDir, join(tmp, "other")], {
      input: "",
    });
    const out = r2.out + r2.err;
    st.check(
      "a repo whose main does not hold the run's base",
      r2.code === 1 && out.includes("is this the run's repo"),
      `exit ${r2.code}\n${out}`,
    );
  }

  // BASE's sh() gives an install, a gate or a hidden suite 1200 seconds, then
  // reports only "timed out after 1200s". A stalled stub proves the cutoff and
  // the message; a child that exits 128 on its own proves the cutoff is real,
  // not the code.
  {
    st.check(
      "score allows 1200 seconds a command, as BASE does",
      TIMEOUT === 1200,
      String(TIMEOUT),
    );
    const stalled = sh(["bash", "-c", "echo partial; sleep 30"], undefined, undefined, 1);
    st.check(
      "a stalled command is cut off with BASE's message, its output discarded",
      stalled.code === null && stalled.out === "timed out after 1s",
      `${stalled.code} ${stalled.out}`,
    );
    const died128 = sh(["bash", "-c", "exit 128"]);
    st.check(
      "a child that exits 128 on its own is exit 128, never a timeout",
      died128.code === 128,
      `${died128.code} ${died128.out}`,
    );
  }

  // BASE's check=True on the app listing: a listing that fails fails the repo
  // with "could not copy the app", never an empty app; a file that cannot be
  // copied fails it too, never a partial app committed as whole.
  {
    const errs: string[] = [];
    const origErr = console.error;
    console.error = (...a: unknown[]) => {
      errs.push(a.map(String).join(" "));
    };
    let listFail = true;
    let copyFail = true;
    try {
      listFail = makeRepo(join(tmp, "fail-list"), join(tmp, "nonesuch-src"));
      const src = join(tmp, "denied-src");
      mkdirSync(src, { recursive: true });
      run("git", ["-C", src, "init", "-q", "-b", "main"]);
      writeFileSync(join(src, "secret.txt"), "shh\n");
      run("git", ["-C", src, "add", "-A"]);
      run("git", [
        "-C",
        src,
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@t",
        "commit",
        "-q",
        "-m",
        "one",
      ]);
      chmodSync(join(src, "secret.txt"), 0);
      copyFail = makeRepo(join(tmp, "fail-copy"), src);
    } finally {
      console.error = origErr;
    }
    st.check(
      "a failed app listing fails the repo with BASE's message",
      listFail === false && errs.some((l) => l.includes("could not copy the app to")),
      `listed=${listFail}\n${errs.join("\n")}`,
    );
    st.check(
      "a file that cannot be copied fails the repo, never a partial app",
      copyFail === false,
      `copied=${copyFail}`,
    );
  }

  // lexists, as BASE's copy does: a dangling symlink is listed and copied,
  // never skipped as missing.
  {
    const src = join(tmp, "dangling-src");
    mkdirSync(src, { recursive: true });
    run("git", ["-C", src, "init", "-q", "-b", "main"]);
    symlinkSync("nowhere-at-all", join(src, "dangling"));
    run("git", ["-C", src, "add", "-A"]);
    run("git", [
      "-C",
      src,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit",
      "-q",
      "-m",
      "one",
    ]);
    const dest = join(tmp, "dangling-dest");
    const ok = makeRepo(dest, src);
    let linked = false;
    try {
      linked = lstatSync(join(dest, "dangling")).isSymbolicLink();
    } catch {
      linked = false;
    }
    st.check(
      "a dangling symlink is copied as a link, as lexists does",
      ok && linked,
      `made=${ok} linked=${linked}`,
    );
  }

  st.finish();
});
