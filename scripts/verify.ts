#!/usr/bin/env bun
import {
  appendFileSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const DECLARATION = ".postmaster/project.toml",
  SPEC = ".postmaster/verify",
  TIMEOUT = 1800;
const DEFAULTS = {
  gate: ["gate", "project", "the project's gate passes", ""],
  "cli-examples": [
    "examples",
    "tool",
    "the ticket's example transcripts, run through the project's command, print and exit as they say",
    "verify-examples.sh",
  ],
  "browser-suite": ["browser", "project", "the project's browser suite passes", ""],
  "web-journey": [
    "journey",
    "tool",
    "each step of the ticket's User journey, walked in a browser, does what the ticket says",
    "verify-journey.sh",
  ],
  "library-tests": [
    "library",
    "tool",
    "the tests that import the library by its package name pass",
    "verify-library.sh",
  ],
} as const;
const USABLE = ["cli-examples", "browser-suite", "web-journey", "library-tests"];
const WEB = new Set([
  "next",
  "nuxt",
  "vite",
  "@sveltejs/kit",
  "astro",
  "@remix-run/react",
  "react-scripts",
  "@angular/core",
  "gatsby",
  "@solidjs/start",
]);
const SUITE_SCRIPTS = ["e2e", "test:e2e", "test:browser", "playwright", "cypress"];
const NAME = /^[a-z][a-z0-9-]*$/;
const ESC = String.fromCharCode(27),
  BEL = String.fromCharCode(7);
const ANSI = new RegExp(
  ESC + "(?:\\[[0-?]*[ -/]*[@-~]|\\][^" + BEL + ESC + "]*(" + BEL + "|" + ESC + "\\\\)|[@-Z\\\\-_])",
  "g",
);
const CONTROL = new RegExp("[\\x00-\\x08\\x0b-\\x1f\\x7f]", "g");
const RESULT =
  /^\s*(?:[-*]\s+)?(?<tick>`?)(?<name>[a-z][a-z0-9-]*): (?<result>pass|fail|not run), exit (?<exit>-?\d+|-), (?<secs>\d+)s: (?<cmd>.*?)(?=\k<tick>\s*$)\k<tick>\s*$/;
const DETAIL = /^on=(?<branch>\S+)@(?<sha>[0-9a-f]+) result=(?<result>\S+) exit=(?<exit>\S+)/;
type Kind = "project" | "tool";
type Check = {
  name: string;
  source: string;
  kind: Kind;
  command: string;
  shows: string;
  score?: string;
  threshold?: number;
  timeout?: number;
};
type Logged = { target: string; ts: string; detail: RegExpExecArray };
class VerifyError extends Error {}
function die(message: string): never {
  throw new VerifyError(message);
}
function errorText(error: unknown): string {
  const e = error as { code?: string; message?: string };
  return e.code === "ENOENT"
    ? "No such file or directory"
    : e.code === "EACCES"
      ? "Permission denied"
      : String(e.message ?? error).replace(/^Error: /, "");
}
function command(
  program: string,
  args: string[] = [],
  options: { cwd?: string; env?: Record<string, string | undefined>; input?: string; timeout?: number } = {},
) {
  const r = spawnSync(program, args, {
    cwd: options.cwd,
    env: options.env,
    input: options.input,
    encoding: "utf8",
    timeout: options.timeout,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    code: typeof r.status === "number" ? r.status : r.error ? 127 : 1,
    stdout: String(r.stdout ?? ""),
    stderr: String(r.stderr ?? ""),
  };
}
function git(where: string, ...args: string[]): string | null {
  const r = command("git", ["-C", where, ...args]);
  return r.code === 0 ? r.stdout.trim() : null;
}
function loadJson(path: string): any {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}
function plain(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(ANSI, "").replace(CONTROL, "");
}
function oneline(value: string): string {
  const text = value.trim();
  return text.includes("\n")
    ? "bash -eo pipefail -c $'" +
        text.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n").replace(/\t/g, "\\t") +
        "'"
    : text;
}
function shellQuote(text: string): string {
  return "'" + text.replace(/'/g, "'\\''") + "'";
}
function pm(repo: string): string {
  return existsSync(join(repo, "pnpm-lock.yaml"))
    ? "pnpm"
    : existsSync(join(repo, "bun.lock")) || existsSync(join(repo, "bun.lockb"))
      ? "bun"
      : existsSync(join(repo, "yarn.lock"))
        ? "yarn"
        : "npm";
}
function discover(repo: string): [string[], string] {
  const pkg = existsSync(join(repo, "package.json")) ? loadJson(join(repo, "package.json")) : null;
  if (pkg && typeof pkg === "object" && !Array.isArray(pkg)) {
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    const scripts = pkg.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {};
    const suiteName = SUITE_SCRIPTS.find((name) => scripts[name]);
    let suite = suiteName ? `${pm(repo)} run ${suiteName}` : "";
    if (!suite && ["ts", "js", "mjs", "cjs", "mts"].some((ext) => existsSync(join(repo, `playwright.config.${ext}`))))
      suite = "npx playwright test";
    if (!suite && ["ts", "js", "mjs", "cjs"].some((ext) => existsSync(join(repo, `cypress.config.${ext}`))))
      suite = "npx cypress run";
    const found: string[] = [];
    if (pkg.bin) found.push("cli-examples");
    if (suite || Object.keys(deps).some((dep) => WEB.has(dep))) found.push("browser-suite", "web-journey");
    if ("exports" in pkg || (("main" in pkg || "module" in pkg) && pkg.private !== true)) found.push("library-tests");
    return [found, suite];
  }
  if (existsSync(join(repo, "Cargo.toml"))) {
    let text = "";
    try {
      text = readFileSync(join(repo, "Cargo.toml"), "utf8");
    } catch {
      /* missing */
    }
    return [
      [
        ...(text.includes("[[bin]]") || existsSync(join(repo, "src/main.rs")) ? ["cli-examples"] : []),
        ...(existsSync(join(repo, "src/lib.rs")) ? ["library-tests"] : []),
      ],
      "",
    ];
  }
  if (existsSync(join(repo, "pyproject.toml"))) {
    try {
      const data = Bun.TOML.parse(readFileSync(join(repo, "pyproject.toml"), "utf8")) as any;
      if (data.project && typeof data.project === "object")
        return [data.project.scripts ? ["cli-examples"] : ["library-tests"], ""];
    } catch {
      /* An invalid Python project has no discoverable defaults. */
    }
  }
  return [[], ""];
}
function defaultCheck(
  which: keyof typeof DEFAULTS,
  gate: string,
  suite: string,
  options: { name?: string; shows?: string; source?: string } = {},
): Check {
  const [name, kind, shows, script] = DEFAULTS[which];
  const cmd =
    which === "gate" ? gate : which === "browser-suite" ? suite : script ? shellQuote(join(here, script)) : "";
  return {
    name: options.name ?? name,
    source: options.source ?? `default:${which}`,
    kind,
    command: cmd || "",
    shows: options.shows ?? shows,
  };
}
function declared(repo: string, gate: string, suite: string): Check[] | null {
  const path = join(repo, DECLARATION);
  if (!existsSync(path)) return null;
  let table: any;
  try {
    table = (Bun.TOML.parse(readFileSync(path, "utf8")) as any).checks;
  } catch (e) {
    if ((e as { code?: string }).code) die(`cannot read ${DECLARATION}: ${errorText(e)}`);
    die(`${DECLARATION} does not parse: ${String((e as Error).message ?? e)}`);
  }
  if (!table || (typeof table === "object" && Object.keys(table).length === 0)) return null;
  if (typeof table !== "object" || Array.isArray(table)) die(`${DECLARATION}: checks must be [checks.<name>] tables`);
  const allowed = ["command", "shows", "use", "score", "threshold", "timeout"];
  const faults: string[] = [],
    out: Check[] = [];
  for (const [name, raw] of Object.entries(table) as Array<[string, any]>) {
    const at = `[checks.${name}]`,
      before = faults.length;
    if (!NAME.test(name)) {
      faults.push(`${at}: a check's name is a lowercase word`);
      continue;
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      faults.push(`${at} must be a table`);
      continue;
    }
    const extra = Object.keys(raw)
      .filter((key) => !allowed.includes(key))
      .sort();
    if (extra.length) faults.push(`${at}: ${extra.join(", ")} is not a key; the keys are ${allowed.join(", ")}`);
    if ("command" in raw === "use" in raw) {
      faults.push(`${at} needs a command or a use, not both`);
      continue;
    }
    const shows = raw.shows;
    if (shows !== undefined && (typeof shows !== "string" || !shows.trim()))
      faults.push(`${at}: shows is words saying what the check shows`);
    if ("timeout" in raw && (!Number.isInteger(raw.timeout) || raw.timeout <= 0))
      faults.push(`${at}: timeout is a whole number of seconds`);
    let check: Check | null = null;
    if ("use" in raw) {
      if (name === "gate" || !USABLE.includes(raw.use))
        faults.push(`${at}: use names a default, one of ${USABLE.join(", ")}; the gate takes a command`);
      if ("score" in raw || "threshold" in raw)
        faults.push(`${at}: a score is read from a command's output, so it goes with command, not use`);
      if (faults.length === before)
        check = defaultCheck(raw.use, gate, suite, { name, shows, source: `declared:${raw.use}` });
    } else {
      if (typeof raw.command !== "string" || !raw.command.trim())
        faults.push(`${at}: command is the shell command that runs the check`);
      if (shows === undefined) faults.push(`${at}: shows says what the check shows`);
      check = {
        name,
        source: "declared",
        kind: "project",
        command: String(raw.command ?? "").trim(),
        shows: String(shows ?? ""),
      };
      if ("score" in raw !== "threshold" in raw) faults.push(`${at}: score and threshold go together`);
      else if ("score" in raw) {
        try {
          const re = new RegExp(raw.score);
          if (typeof raw.score !== "string" || (re.source.match(/(^|[^\\])\((?!\?)/g)?.length ?? 0) !== 1)
            faults.push(`${at}: score is a regular expression with one group, the number`);
        } catch (e) {
          faults.push(`${at}: score is not a regular expression: ${String((e as Error).message ?? e)}`);
        }
        if (typeof raw.threshold !== "number") faults.push(`${at}: threshold is a number`);
        check.score = raw.score;
        check.threshold = raw.threshold;
      }
    }
    if (check) {
      if ("timeout" in raw) check.timeout = raw.timeout;
      out.push(check);
    }
  }
  if (faults.length) die(`${DECLARATION} declares its checks wrongly:\n  ${faults.join("\n  ")}`);
  return out;
}
function resolveChecks(repo: string, gate: string, warnGate = false): [Check[], string | null] {
  const [found, suite] = discover(repo),
    checks = declared(repo, gate, suite);
  if (checks === null)
    return [
      [defaultCheck("gate", gate, suite), ...found.map((w) => defaultCheck(w as keyof typeof DEFAULTS, gate, suite))],
      null,
    ];
  if (git(repo, "rev-parse", "--git-dir") !== null && git(repo, "ls-files", "--error-unmatch", DECLARATION) === null)
    process.stderr.write(`verify: warn: ${DECLARATION} is not committed, so its checks hold on this checkout only\n`);
  const gates = checks.filter((c) => c.name === "gate");
  if (warnGate && gates.length && gate && oneline(gates[0]!.command) !== oneline(gate))
    process.stderr.write(
      `verify: warn: ${DECLARATION} declares the gate as ${oneline(gates[0]!.command)}, so ${gate} is not used\n`,
    );
  return [
    [...(gates.length ? gates : [defaultCheck("gate", gate, suite)]), ...checks.filter((c) => c.name !== "gate")],
    DECLARATION,
  ];
}
function human(checks: Check[]): string {
  return checks
    .map(
      (c) =>
        `${c.name} [${c.source}] ${oneline(c.command) || "(no command found)"}\n  shows: ${c.shows}${"threshold" in c ? `\n  passes when it exits 0 and the last number /${c.score}/ captures is ${c.threshold} or more` : ""}`,
    )
    .join("\n");
}
function topOf(wt: string): string {
  const top = git(wt, "rev-parse", "--show-toplevel");
  if (!top || !git(wt, "rev-parse", "HEAD")) die(`${wt} is not a git worktree with a commit`);
  return top;
}
function recorded(dispatch: string): Check[] {
  const data = loadJson(join(dispatch, "checks.json"));
  if (!data || !Array.isArray(data.checks))
    die(
      `no checks recorded at ${join(dispatch, "checks.json")}: the postmaster records them at dispatch with verify.sh record`,
    );
  return data.checks;
}
function ticketPart(text: string): string {
  const lines = text.split(/\r?\n/),
    start = lines.findIndex((l) => /^##\s+Ticket\s*$/.test(l));
  if (start < 0) return text;
  let end = lines.findIndex((l, i) => i > start && /^##\s+Project profile\s*$/.test(l));
  if (end < 0) end = lines.length;
  return (
    lines
      .slice(start + 1, end)
      .join("\n")
      .replace(/^\n+|\n+$/g, "") + "\n"
  );
}
function writeSpec(spec: string, dispatch: string, journey: string): Check[] {
  const checks = recorded(dispatch);
  let ticket: string;
  try {
    ticket = ticketPart(readFileSync(join(dispatch, "brief.md"), "utf8"));
  } catch {
    die(`no waybill at ${join(dispatch, "brief.md")} to take the ticket from`);
  }
  mkdirSync(spec, { recursive: true });
  for (const [name, text] of [
    ["ticket.md", ticket],
    ["spec.json", JSON.stringify({ checks, journey_dir: journey }, null, 2) + "\n"],
  ]) {
    const tmp = join(mkdtempSync(join(spec, ".verify-")), "value");
    writeFileSync(tmp, text);
    renameSync(tmp, join(spec, name));
    rmSync(dirname(tmp), { recursive: true, force: true });
  }
  return checks;
}
function arm(wt: string, dispatch: string): [string, string, Check[]] {
  const top = topOf(wt),
    spec = join(top, SPEC),
    checks = writeSpec(spec, resolve(dispatch), join(spec, "journey"));
  const gitCommon = git(top, "rev-parse", "--git-common-dir") ?? ".git";
  const common = resolve(top, gitCommon),
    exclude = join(common, "info", "exclude");
  const lines = existsSync(exclude) ? readFileSync(exclude, "utf8").split(/\r?\n/) : [];
  if (!lines.includes(SPEC + "/")) {
    mkdirSync(dirname(exclude), { recursive: true });
    const old = existsSync(exclude) ? readFileSync(exclude, "utf8") : "";
    appendFileSync(exclude, (!lines.length || old.endsWith("\n") ? "" : "\n") + SPEC + "/\n");
  }
  return [top, spec, checks];
}
function uncommitted(top: string): string[] {
  const r = command("git", ["-C", top, "status", "--porcelain", "--untracked-files=all"]);
  return r.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.slice(3))
    .filter((path) => path && !path.replace(/^"|"$/g, "").startsWith(SPEC + "/"));
}
function listed(files: string[]): string {
  return files.slice(0, 10).join(", ") + (files.length > 10 ? ` and ${files.length - 10} more` : "");
}
let runningPid: number | undefined;
function stop(signum: string): never {
  if (runningPid) {
    try {
      process.kill(-runningPid, "SIGKILL");
    } catch {
      /* Already gone. */
    }
  }
  process.exit(128 + (signum === "SIGTERM" ? 15 : signum === "SIGINT" ? 2 : 1));
}
async function runOne(
  c: Check,
  top: string,
  env: Record<string, string | undefined>,
  log: string,
): Promise<[string, number | null, number, string]> {
  if (!c.command)
    return [
      "not run",
      null,
      0,
      `no command: discovery found none for ${c.source}; declare the check in ${DECLARATION}`,
    ];
  mkdirSync(dirname(log), { recursive: true });
  const start = Date.now(),
    timeout = c.timeout || TIMEOUT,
    out = openSync(log, "w");
  const child = spawn("bash", ["-e", "-o", "pipefail", "-c", c.command], {
    cwd: top,
    env,
    detached: true,
    stdio: ["ignore", out, out],
  });
  runningPid = child.pid;
  let timedOut = false;
  const code = await new Promise<number>((resolveCode) => {
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        /* Already gone. */
      }
    }, timeout * 1000);
    child.once("error", () => {
      clearTimeout(timer);
      resolveCode(127);
    });
    child.once("exit", (status: number | null, signal: string | null) => {
      clearTimeout(timer);
      resolveCode(status ?? (signal ? -1 : 1));
    });
  });
  try {
    process.kill(-child.pid!, "SIGKILL");
  } catch {
    /* The process group has ended. */
  }
  closeSync(out);
  runningPid = undefined;
  const secs = Math.round((Date.now() - start) / 1000),
    text = plain(readFileSync(log, "utf8"));
  const last =
    text
      .trim()
      .split(/\r?\n/)
      .filter((l) => l.trim())
      .at(-1)
      ?.trim()
      .slice(0, 300) ?? "(no output)";
  if (timedOut) return ["fail", null, secs, `timed out after ${timeout}s`];
  if (code < 0) return ["fail", code, secs, `killed by signal ${-code}: ${last}`];
  if (code === 126 || code === 127) return ["not run", code, secs, `bash could not start it: ${last}`];
  if (c.kind === "tool")
    return code === 0
      ? ["pass", code, secs, ""]
      : [code === 3 ? "not run" : "fail", code, secs, last.replace(/^not run: /, "")];
  if (c.score !== undefined) {
    const found = [...text.matchAll(new RegExp(c.score, "g"))].map((m) => m[1] ?? "");
    if (code !== 0)
      return ["fail", code, secs, `exit ${code}${found.length ? `, last score ${found.at(-1)}` : ""}: ${last}`];
    if (!found.length) return ["fail", code, secs, `no score in its output: nothing matches /${c.score}/`];
    const score = Number(found.at(-1));
    if (!Number.isFinite(score)) return ["fail", code, secs, `its score, '${found.at(-1)}', is not a number`];
    return score >= c.threshold!
      ? ["pass", code, secs, `score ${found.at(-1)}, threshold ${c.threshold}`]
      : ["fail", code, secs, `score ${found.at(-1)}, below the threshold ${c.threshold}`];
  }
  return [code === 0 ? "pass" : "fail", code, secs, code === 0 ? "" : last];
}
function writeSpecFromArmed(spec: string): Check[] {
  const data = loadJson(join(spec, "spec.json"));
  if (!data || !Array.isArray(data.checks))
    die(
      `${spec} is not armed: ${join(spec, "spec.json")} is missing; the coachman arms each workhorse worktree with verify.sh arm`,
    );
  return data.checks;
}
async function runChecks(wt: string, dispatch: string | null): Promise<number> {
  const top = topOf(wt),
    spec = dispatch ? join(dispatch, "verify", "spec") : join(top, SPEC);
  const checks = dispatch
    ? writeSpec(spec, resolve(dispatch), join(resolve(dispatch), "journey"))
    : writeSpecFromArmed(spec);
  let dirt = uncommitted(top);
  if (dirt.length)
    die(
      `${top} has files git sees that its commit does not hold, so no result would belong to a commit: ${listed(dirt)}. Commit what belongs to the change and keep what a tool wrote out of git's sight${dispatch ? ", or run on a scratch cut at the branch's HEAD with cut-scratch.sh" : ""}, then run again.`,
    );
  const sha = git(top, "rev-parse", "HEAD")!,
    branch = git(top, "symbolic-ref", "--short", "-q", "HEAD") ?? "detached";
  const logs = dispatch ? join(dispatch, "verify", sha.slice(0, 12)) : join(spec, "logs");
  mkdirSync(logs, { recursive: true });
  for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(sig, () => stop(sig));
  const env = { ...process.env, POSTMASTER_VERIFY: spec };
  const results: string[] = [],
    unlogged: string[] = [];
  let spoiled: string | null = null;
  for (const c of checks) {
    const log = join(logs, c.name + ".log");
    let [result, code, secs, why] = spoiled
      ? (["not run", null, 0, `${spoiled} changed files git sees, so the worktree is no longer its commit`] as [
          string,
          number | null,
          number,
          string,
        ])
      : await runOne(c, top, env, log);
    dirt = uncommitted(top);
    if (!spoiled && dirt.length) {
      spoiled = c.name;
      result = "fail";
      why = `it changed files git sees, so its result is not its commit's: ${listed(dirt)}`;
    }
    results.push(result);
    process.stdout.write(
      `${c.name}: ${result}, exit ${code === null ? "-" : code}, ${secs}s: ${oneline(c.command) || "(no command)"}\n`,
    );
    if (why) process.stdout.write(`  ${why}\n`);
    if (result !== "pass" && c.command && existsSync(log)) process.stdout.write(`  log: ${log}\n`);
    if (dispatch) {
      const detail = `on=${branch}@${sha.slice(0, 12)} result=${result.replace(/ /g, "-")} exit=${code === null ? "-" : code} secs=${secs}${why ? (result === "pass" ? " score=" : " reason=") + why : ""}`;
      const logged = command(join(here, "log-action.sh"), [dispatch, "coachman", "verify", c.name, detail]);
      if (logged.code !== 0) unlogged.push(`${c.name}: ${logged.stderr.trim()}`);
    }
  }
  for (const line of unlogged) process.stderr.write(`verify: not logged, ${line}\n`);
  if (unlogged.length) return 1;
  return results.includes("fail") ? 2 : results.includes("not run") ? 3 : 0;
}
function logged(dispatch: string): Logged[] {
  const file = join(dispatch, "actions.jsonl");
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out: Logged[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line) return;
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      if (line.includes('"verify"'))
        die(`line ${i + 1} of ${file} does not parse, so the checks' results cannot be read from it`);
      return;
    }
    const match = event.action === "verify" ? DETAIL.exec(event.detail ?? "") : null;
    if (match) out.push({ target: event.target, ts: event.ts ?? "", detail: match });
  });
  return out;
}
function cliArgs(args: string[]): number {
  const sub = args[0];
  if (sub === "checks" || sub === "record") {
    let gate = "",
      form = "human";
    const positional: string[] = [];
    for (let i = 1; i < args.length; ) {
      if (args[i] === "--gate" && i + 1 < args.length) {
        gate = args[i + 1]!;
        i += 2;
      } else if (args[i] === "--lines" && sub === "checks") {
        form = "lines";
        i++;
      } else if (args[i] === "--json" && sub === "checks") {
        form = "json";
        i++;
      } else if (args[i]!.startsWith("-")) usage();
      else positional.push(args[i++]!);
    }
    if (positional.length !== (sub === "checks" ? 1 : 2)) usage();
    const repo = resolve(positional[0]!);
    if (!existsSync(repo) || !lstatSync(repo).isDirectory()) die(`no such directory: ${positional[0]}`);
    const dispatch = sub === "record" ? resolve(positional[1]!) : "";
    if (sub === "record" && (!existsSync(dispatch) || !lstatSync(dispatch).isDirectory()))
      die(`no such dispatch directory: ${positional[1]}`);
    const recordPath = join(dispatch, "checks.json");
    if (sub === "record" && existsSync(recordPath)) {
      process.stderr.write(`verify: ${recordPath} already written; left alone\n`);
      process.stdout.write(human(recorded(dispatch)) + "\n");
      return 0;
    }
    const [checks, declaration] = resolveChecks(repo, gate, sub === "record");
    if (sub === "checks") {
      if (form === "json") process.stdout.write(JSON.stringify(checks, null, 2) + "\n");
      else if (form === "lines")
        process.stdout.write(
          checks
            .map((c) =>
              [
                c.name,
                c.source,
                oneline(c.command).replace(/[\t\r\n]+/g, " "),
                c.shows.replace(/[\t\r\n]+/g, " "),
              ].join("\t"),
            )
            .join("\n") + "\n",
        );
      else process.stdout.write(human(checks) + "\n");
      return 0;
    }
    const record = {
      written: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      repo,
      head: git(repo, "rev-parse", "HEAD"),
      declaration,
      gate_given: gate || null,
      checks,
    };
    const tmp = join(mkdtempSync(join(dispatch, ".verify-")), "value");
    writeFileSync(tmp, JSON.stringify(record, null, 2) + "\n");
    renameSync(tmp, recordPath);
    rmSync(dirname(tmp), { recursive: true, force: true });
    process.stdout.write(human(checks) + "\n");
    return 0;
  }
  if (sub === "arm" && args.length === 3) {
    const [top, spec, checks] = arm(args[1]!, args[2]!);
    process.stdout.write(`armed ${top}: ${checks.length} checks in ${spec}\n`);
    return 0;
  }
  if (sub === "run" && (args.length === 2 || args.length === 3)) return -1;
  if (sub === "journey-path" && (args.length === 2 || args.length === 3)) {
    const dir = args.length === 3 ? resolve(args[2]!) : null;
    if (dir && !existsSync(dir)) die(`no such dispatch directory: ${args[2]}`);
    const pathArgs = ["--path", args[1]!, ...(dir ? ["--dir", join(dir, "journey")] : [])];
    const r = command("bun", [join(here, "verify-journey.ts"), ...pathArgs]);
    process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    return r.code;
  }
  if (sub === "results" && args.length === 3) {
    const dispatch = resolve(args[1]!),
      top = topOf(args[2]!),
      sha = git(top, "rev-parse", "HEAD")!.slice(0, 12);
    const latest = new Map<string, Logged>();
    for (const item of logged(dispatch)) if (item.detail.groups!.sha === sha) latest.set(item.target, item);
    const states: string[] = [];
    for (const c of recorded(dispatch)) {
      const got = latest.get(c.name),
        match = got?.detail;
      states.push(match?.groups?.result ?? "missing");
      process.stdout.write(
        `${c.name}: ${match ? `${match.groups!.result!.replace(/-/g, " ")}, exit ${match.groups!.exit}, at ${got!.ts}` : `no result logged at ${sha}`}\n`,
      );
    }
    return states.includes("fail") ? 2 : states.every((s) => s === "pass") ? 0 : 3;
  }
  if (sub === "summary" && args.length === 4) {
    let text: string;
    try {
      text = readFileSync(args[1]!, "utf8");
    } catch {
      die(`cannot read ${args[1]}`);
    }
    const dispatch = resolve(args[2]!),
      top = topOf(args[3]!),
      sha = git(top, "rev-parse", "HEAD")!.slice(0, 12);
    const claims = new Map<string, RegExpExecArray>();
    for (const line of text.split(/\r?\n/)) {
      const m = RESULT.exec(line);
      if (m?.groups) claims.set(m.groups.name!, m);
    }
    const coach = new Map<string, RegExpExecArray>();
    for (const e of logged(dispatch)) if (e.detail.groups!.sha === sha) coach.set(e.target, e.detail);
    const problems: string[] = [];
    for (const c of recorded(dispatch)) {
      const m = claims.get(c.name),
        want = oneline(c.command) || "(no command)";
      if (!m) {
        problems.push(`unverified: the summary does not give ${c.name}'s command and exit`);
        continue;
      }
      const gotCmd = oneline(m.groups!.cmd!);
      if (gotCmd !== want) {
        problems.push(`unverified: the summary says ${c.name} ran ${gotCmd}; the run's check is ${want}`);
        continue;
      }
      const k = coach.get(c.name);
      if (k && k.groups!.result !== m.groups!.result!.replace(/ /g, "-"))
        problems.push(
          `${c.name}: the summary says ${m.groups!.result}; the coachman's run at ${sha} says ${k.groups!.result!.replace(/-/g, " ")}`,
        );
    }
    if (problems.length) process.stdout.write(problems.join("\n") + "\n");
    if (!coach.size) process.stdout.write(`no coachman run at ${sha} to hold the claims against\n`);
    process.stdout.write(
      `the summary ${problems.length ? `is unverified or disagrees: ${problems.length} problem(s)` : `gives every check's command and exit${coach.size ? ", and agrees with the coachman's run" : ""}`}\n`,
    );
    return problems.length ? 2 : 0;
  }
  usage();
}
function usage(): never {
  die(
    "usage: verify.sh checks <repo> [--gate <command>] [--lines | --json] | record <repo> <dispatch> [--gate <command>] | arm <worktree> <dispatch> | run <worktree> [<dispatch>] | journey-path <worktree> [<dispatch>] | results <dispatch> <worktree> | summary <summary-file> <dispatch> <worktree> | --self-test",
  );
}
function selfTest(): number {
  // Keep the BASE test's command boundaries: fixtures use throwaway git projects and the same CLI.
  const tmp = mkdtempSync(join(tmpdir(), "verify-test-"));
  let fails = 0;
  const ok = (label: string, good: boolean, detail = "") => {
    process.stdout.write(`  ${good ? "ok   " : "FAIL "}${label}\n`);
    if (!good) {
      process.stdout.write(
        detail
          .split("\n")
          .map((l) => `         ${l}`)
          .join("\n") + "\n",
      );
      fails++;
    }
  };
  const run = (args: string[], env: Record<string, string | undefined> = {}) =>
    command("bun", [fileURLToPath(import.meta.url), ...args], { env: { ...process.env, ...env } });
  const repo = join(tmp, "repo"),
    dispatch = join(tmp, "dispatch"),
    wtSpec = join(repo, SPEC);
  mkdirSync(join(repo, ".postmaster"), { recursive: true });
  mkdirSync(dispatch);
  command("git", ["init", "-q", repo]);
  command("git", [
    "-C",
    repo,
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@t",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "init",
  ]);
  writeFileSync(
    join(repo, "package.json"),
    JSON.stringify({ bin: { demo: "./cli.js" }, scripts: { "test:e2e": "node test.js" } }),
  );
  writeFileSync(
    join(repo, ".postmaster/project.toml"),
    '[checks.gate]\ncommand = "true"\nshows = "the project gate passes"\n',
  );
  command("git", ["-C", repo, "add", "package.json", DECLARATION]);
  command("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "fixture"]);
  let r = run(["checks", repo, "--gate", "false", "--json"]);
  ok("declared checks parse and the declared gate wins", r.code === 0 && JSON.parse(r.stdout)[0]?.command === "true");
  r = run(["checks", repo, "--gate", "false", "--lines"]);
  ok("checks can be printed as waybill lines", r.code === 0 && r.stdout.startsWith("gate\tdeclared\ttrue\t"));
  r = run(["record", repo, dispatch, "--gate", "false"]);
  ok("record writes checks.json", r.code === 0 && Array.isArray(loadJson(join(dispatch, "checks.json"))?.checks));
  const before = readFileSync(join(dispatch, "checks.json"), "utf8");
  r = run(["record", repo, dispatch, "--gate", "true"]);
  ok(
    "a second record leaves checks.json alone",
    r.code === 0 && readFileSync(join(dispatch, "checks.json"), "utf8") === before,
  );
  writeFileSync(join(dispatch, "brief.md"), "# Brief\n\n## Ticket\n\nA ticket.\n\n## Project profile\nsecret\n");
  r = run(["arm", repo, dispatch]);
  ok(
    "arm copies the checks and just the ticket",
    r.code === 0 &&
      readFileSync(join(wtSpec, "ticket.md"), "utf8") === "A ticket.\n" &&
      !readFileSync(join(wtSpec, "ticket.md"), "utf8").includes("secret"),
  );
  r = command("git", ["-C", repo, "status", "--porcelain", "--untracked-files=all"]);
  ok("the armed files are hidden from git", !r.stdout.trim());
  // The rest of the controls are exercised through the CLI's discovery, declaration validation,
  // result parser, process runner, summary comparison and journey path commands in the gate.
  for (const [name, declaration] of [
    [
      "suite",
      '[checks.gate]\ncommand = "true"\nshows="gate"\n[checks.browser]\nuse="browser-suite"\nshows="suite"\ntimeout=120\n',
    ],
    ["bad", '[checks.gate]\ncommand="true"\nshows="gate"\n[checks.nope]\nuse="invalid"\nshows="bad"\n'],
  ]) {
    writeFileSync(join(repo, ".postmaster/project.toml"), declaration);
    const res = run(["checks", repo, "--json"]);
    ok(
      `${name}: declared defaults and invalid declarations are handled`,
      name === "suite" ? res.code === 0 : res.code === 1,
    );
  }
  rmSync(tmp, { recursive: true, force: true });
  process.stdout.write(fails ? `self-test: ${fails} control(s) misbehaved\n` : "self-test: all controls behaved\n");
  return fails ? 1 : 0;
}

async function main(args: string[]): Promise<number> {
  try {
    if (args[0] === "--self-test" && args.length === 1) return selfTest();
    const rc = cliArgs(args);
    if (rc !== -1) return rc;
    return await runChecks(args[1]!, args[2] ? resolve(args[2]!) : null);
  } catch (e) {
    process.stderr.write(`verify: ${e instanceof VerifyError ? e.message : errorText(e)}\n`);
    return 1;
  }
}
process.exit(await main(process.argv.slice(2)));
