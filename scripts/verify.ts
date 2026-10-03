// The checks a change to a project is verified by, and running them. A project may declare its
// checks in .postmaster/project.toml. A project that declares none gets defaults. Either way
// the gate is a check. A run is held to the checks it recorded at dispatch.
//
//   verify.sh checks <repo> [--gate <command>] [--lines | --json]
//   verify.sh record <repo> <dispatch> [--gate <command>]
//   verify.sh arm <worktree> <dispatch>
//   verify.sh run <worktree> [<dispatch>]
//   verify.sh journey-path <worktree> [<dispatch>]
//   verify.sh results <dispatch> <worktree>
//   verify.sh summary <summary-file> <dispatch> <worktree>
//
//   exit 0  printed; run, results, summary: every check passed, or the summary holds
//   exit 1  usage, or input that is not what it says, a declaration included
//   exit 2  run, results: a check failed; summary: a check is missing, or a claim disagrees
//   exit 3  run, results: none failed, but a check was not run or has no result

import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { constants as osConstants } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseTomlText, tryTomlFile } from "./lib/data.ts";
import { scriptsDir } from "./lib/paths.ts";
import { mkstempSync, run } from "./lib/proc.ts";
import { PY_DOT, PY_S_CLASS, pySplitLines } from "./lib/text.ts";

const HERE = scriptsDir(import.meta);
const DECLARATION = ".postmaster/project.toml";
const SPEC = ".postmaster/verify";
const NAME_RE = /^[a-z][a-z0-9-]*$/u;
const KEYS = ["command", "shows", "use", "score", "threshold", "timeout"];
const TIMEOUT = 1800;
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
export const RESULT_RE = new RegExp(
  `^[${PY_S_CLASS}]*(?:[-*][${PY_S_CLASS}]+)?(\`?)([a-z][a-z0-9-]*): (pass|fail|not run), exit (-?\\p{Nd}+|-), (\\p{Nd}+)s: (${PY_DOT}*?)\\1[${PY_S_CLASS}]*$`,
  "u",
);
export const DETAIL_RE = new RegExp(
  `^on=([^${PY_S_CLASS}]+)@([0-9a-f]+) result=([^${PY_S_CLASS}]+) exit=([^${PY_S_CLASS}]+)`,
  "u",
);
const ANSI_RE = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/gu;
const CONTROL_RE = /[\x00-\x08\x0b-\x1f\x7f]/gu;

interface Check {
  name: string;
  source: string;
  kind: string;
  command: string;
  shows: string;
  score?: string;
  threshold?: number;
  timeout?: number;
}

const DEFAULTS: Record<
  string,
  { name: string; kind: string; shows: string; script: string | null }
> = {
  gate: { name: "gate", kind: "project", shows: "the project's gate passes", script: null },
  "cli-examples": {
    name: "examples",
    kind: "tool",
    shows:
      "the ticket's example transcripts, run through the project's command, print and exit as they say",
    script: "verify-examples.sh",
  },
  "browser-suite": {
    name: "browser",
    kind: "project",
    shows: "the project's browser suite passes",
    script: null,
  },
  "web-journey": {
    name: "journey",
    kind: "tool",
    shows: "each step of the ticket's User journey, walked in a browser, does what the ticket says",
    script: "verify-journey.sh",
  },
  "library-tests": {
    name: "library",
    kind: "tool",
    shows: "the tests that import the library by its package name pass",
    script: "verify-library.sh",
  },
};

function dieV(msg: string): never {
  console.error(`verify: ${msg}`);
  process.exit(1);
  throw new Error("unreachable");
}

/** Python's subprocess convention: a process killed by signal N reports exit -N. */
function signalExit(signal: string): { code: number; num: number } {
  const num = (osConstants.signals as Record<string, number>)[signal] ?? 0;
  return { code: -num, num };
}

function plain(text: string): string {
  return text
    .replace(/\r\n/gu, "\n")
    .replace(/\r/gu, "\n")
    .replace(ANSI_RE, "")
    .replace(CONTROL_RE, "");
}

function oneline(command: string): string {
  const c = command.trim();
  if (!c.includes("\n")) return c;
  const quoted = c
    .replace(/\\/gu, "\\\\")
    .replace(/'/gu, "\\'")
    .replace(/\n/gu, "\\n")
    .replace(/\t/gu, "\\t");
  return `bash -eo pipefail -c $'${quoted}'`;
}

function git(where: string, ...args: string[]): string | null {
  const r = run("git", ["-C", where, ...args]);
  return r.code === 0 ? r.out.trim() : null;
}

function loadJson(p: string): unknown {
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
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

function discover(repo: string): { found: string[]; suite: string } {
  const pkgPath = join(repo, "package.json");
  const pkg = existsSync(pkgPath) ? loadJson(pkgPath) : null;
  if (pkg && typeof pkg === "object") {
    const p = pkg as Record<string, unknown>;
    const found: string[] = [];
    const deps: Record<string, string> = {};
    for (const k of ["dependencies", "devDependencies"]) {
      const d = p[k];
      if (d && typeof d === "object") Object.assign(deps, d);
    }
    const scriptsRaw = p.scripts;
    const scripts: Record<string, string> =
      scriptsRaw && typeof scriptsRaw === "object" ? (scriptsRaw as Record<string, string>) : {};
    let suite = "";
    for (const s of SUITE_SCRIPTS) {
      if (scripts[s]) {
        suite = `${pm(repo)} run ${s}`;
        break;
      }
    }
    if (
      !suite &&
      ["ts", "js", "mjs", "cjs", "mts"].some((e) =>
        existsSync(join(repo, `playwright.config.${e}`)),
      )
    ) {
      suite = "npx playwright test";
    }
    if (
      !suite &&
      ["ts", "js", "mjs", "cjs"].some((e) => existsSync(join(repo, `cypress.config.${e}`)))
    ) {
      suite = "npx cypress run";
    }
    if (p.bin) found.push("cli-examples");
    if (suite || [...WEB].some((w) => w in deps)) found.push("browser-suite", "web-journey");
    if ("exports" in p || (("main" in p || "module" in p) && p.private !== true))
      found.push("library-tests");
    return { found, suite };
  }
  if (existsSync(join(repo, "Cargo.toml"))) {
    const text = readFileSync(join(repo, "Cargo.toml"), "utf-8");
    return {
      found: [
        ...(text.includes("[[bin]]") || existsSync(join(repo, "src", "main.rs"))
          ? ["cli-examples"]
          : []),
        ...(existsSync(join(repo, "src", "lib.rs")) ? ["library-tests"] : []),
      ],
      suite: "",
    };
  }
  if (existsSync(join(repo, "pyproject.toml"))) {
    try {
      const project = tryTomlFile(join(repo, "pyproject.toml"))?.project;
      if (project && typeof project === "object") {
        return {
          found: (project as Record<string, unknown>).scripts
            ? ["cli-examples"]
            : ["library-tests"],
          suite: "",
        };
      }
    } catch {
      /* ignore */
    }
  }
  return { found: [], suite: "" };
}

/** Python's `shlex.quote`, byte for byte: safe strings pass through
 * bare, anything else is single-quoted with embedded quotes spliced
 * as `'"'"'`. */
export function shlexQuote(s: string): string {
  if (s === "") return "''";
  if (/^[a-zA-Z0-9_@%+=:,./-]+$/u.test(s)) return s;
  return `'${s.replace(/'/gu, `'"'"'`)}'`;
}

function mkDefault(
  which: string,
  gate: string,
  suite: string,
  name?: string,
  shows?: string,
  source?: string,
): Check {
  const d = DEFAULTS[which]!;
  const command =
    which === "gate"
      ? gate
      : which === "browser-suite"
        ? suite
        : shlexQuote(join(HERE, d.script ?? ""));
  return {
    name: name || d.name,
    source: source || `default:${which}`,
    kind: d.kind,
    command: command || "",
    shows: shows || d.shows,
  };
}

function declared(repo: string, gate: string, suite: string): Check[] | null {
  const settings = run(join(scriptsDir(import.meta), "project-settings.sh"), ["inspect", repo]);
  if (settings.code !== 0) dieV(settings.err.trim() || "project settings could not be read");
  const p = join(repo, DECLARATION);
  if (!existsSync(p)) return null;
  let table: Record<string, any>;
  try {
    const parsed = parseTomlText(readFileSync(p, "utf-8"));
    table = (parsed.checks as Record<string, any>) ?? null;
  } catch (e: any) {
    dieV(`${DECLARATION} does not parse: ${e.message || e}`);
  }
  if (!table || (typeof table === "object" && Object.keys(table).length === 0)) return null;
  if (typeof table !== "object" || Array.isArray(table)) {
    dieV(`${DECLARATION}: checks must be [checks.<name>] tables`);
  }
  const faults: string[] = [];
  const out: Check[] = [];
  for (const [name, c] of Object.entries(table)) {
    const at = `[checks.${name}]`;
    const before = faults.length;
    if (!NAME_RE.test(name)) {
      faults.push(`${at}: a check's name is a lowercase word`);
      continue;
    }
    if (!c || typeof c !== "object") {
      faults.push(`${at} must be a table`);
      continue;
    }
    const extra = Object.keys(c)
      .filter((k) => !KEYS.includes(k))
      .sort();
    if (extra.length > 0) {
      faults.push(`${at}: ${extra.join(", ")} is not a key; the keys are ${KEYS.join(", ")}`);
    }
    const hasCommand = "command" in c;
    const hasUse = "use" in c;
    if (hasCommand === hasUse) {
      faults.push(`${at} needs a command or a use, not both`);
      continue;
    }
    const shows = c.shows;
    if (shows !== undefined && (typeof shows !== "string" || !shows.trim())) {
      faults.push(`${at}: shows is words saying what the check shows`);
    }
    if (
      "timeout" in c &&
      (typeof c.timeout !== "number" || !Number.isInteger(c.timeout) || c.timeout <= 0)
    ) {
      faults.push(`${at}: timeout is a whole number of seconds`);
    }
    let check: Check | null = null;
    if (hasUse) {
      if (name === "gate" || !USABLE.includes(c.use)) {
        faults.push(
          `${at}: use names a default, one of ${USABLE.join(", ")}; the gate takes a command`,
        );
      }
      if ("score" in c || "threshold" in c) {
        faults.push(
          `${at}: a score is read from a command's output, so it goes with command, not use`,
        );
      }
      if (faults.length === before) {
        check = mkDefault(c.use, gate, suite, name, shows, `declared:${c.use}`);
      }
    } else {
      if (typeof c.command !== "string" || !c.command.trim()) {
        faults.push(`${at}: command is the shell command that runs the check`);
      }
      if (shows === undefined) {
        faults.push(`${at}: shows says what the check shows`);
      }
      check = {
        name,
        source: "declared",
        kind: "project",
        command: String(c.command).trim(),
        shows: shows as string,
      };
      const hasScore = "score" in c;
      const hasThreshold = "threshold" in c;
      if (hasScore !== hasThreshold) {
        faults.push(`${at}: score and threshold go together`);
      } else if (hasScore) {
        try {
          // ASCII: BASE compiles user score patterns with no flags.
          const re = new RegExp(c.score);
          if (typeof c.score !== "string" || re.source.match(/\((?!\?)/gu)?.length !== 1) {
            faults.push(`${at}: score is a regular expression with one group, the number`);
          }
        } catch (e: any) {
          faults.push(`${at}: score is not a regular expression: ${e.message || e}`);
        }
        if (typeof c.threshold !== "number" || typeof c.threshold === "boolean") {
          faults.push(`${at}: threshold is a number`);
        }
        check.score = c.score;
        check.threshold = c.threshold;
      }
    }
    if (check !== null) {
      if ("timeout" in c) check.timeout = c.timeout;
      out.push(check);
    }
  }
  if (faults.length > 0) {
    dieV(`${DECLARATION} declares its checks wrongly:\n  ${faults.join("\n  ")}`);
  }
  return out;
}

function resolveChecks(
  repo: string,
  gate: string,
  warnGate = false,
): { checks: Check[]; decl: string | null } {
  const { found, suite } = discover(repo);
  const checks = declared(repo, gate, suite);
  if (checks === null) {
    return {
      checks: [mkDefault("gate", gate, suite), ...found.map((w) => mkDefault(w, gate, suite))],
      decl: null,
    };
  }
  if (
    git(repo, "rev-parse", "--git-dir") !== null &&
    git(repo, "ls-files", "--error-unmatch", DECLARATION) === null
  ) {
    console.error(
      `verify: warn: ${DECLARATION} is not committed, so its checks hold on this checkout only`,
    );
  }
  const gates = checks.filter((c) => c.name === "gate");
  if (warnGate && gates.length > 0 && gate && oneline(gates[0]?.command) !== oneline(gate)) {
    console.error(
      `verify: warn: ${DECLARATION} declares the gate as ${oneline(gates[0]?.command)}, so ${gate} is not used`,
    );
  }
  return {
    checks: [
      ...(gates.length > 0 ? gates : [mkDefault("gate", gate, suite)]),
      ...checks.filter((c) => c.name !== "gate"),
    ],
    decl: DECLARATION,
  };
}

function human(checks: Check[]): string {
  const lines: string[] = [];
  for (const c of checks) {
    lines.push(`${c.name} [${c.source}] ${oneline(c.command) || "(no command found)"}`);
    lines.push(`  shows: ${c.shows}`);
    if (c.threshold !== undefined) {
      lines.push(
        `  passes when it exits 0 and the last number /${c.score}/ captures is ${c.threshold} or more`,
      );
    }
  }
  return lines.join("\n");
}

function topOf(wt: string): string {
  const top = git(wt, "rev-parse", "--show-toplevel");
  if (top === null || git(wt, "rev-parse", "HEAD") === null) {
    dieV(`${wt} is not a git worktree with a commit`);
  }
  return top;
}

function recordedChecks(dispatch: string): Check[] {
  const d = loadJson(join(dispatch, "checks.json"));
  if (!d || typeof d !== "object" || !Array.isArray((d as any).checks)) {
    dieV(
      `no checks recorded at ${join(dispatch, "checks.json")}: the postmaster records them at dispatch with verify.sh record`,
    );
  }
  return (d as any).checks;
}

const TICKET_LINE_RE = new RegExp(`^##[${PY_S_CLASS}]+Ticket[${PY_S_CLASS}]*$`, "u");
const PROFILE_LINE_RE = new RegExp(`^##[${PY_S_CLASS}]+Project profile[${PY_S_CLASS}]*$`, "u");

export function ticketPart(text: string): string {
  const lines = pySplitLines(text);
  const start = lines.findIndex((l) => TICKET_LINE_RE.test(l));
  if (start === -1) return text;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (PROFILE_LINE_RE.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  return `${lines
    .slice(start + 1, end)
    .join("\n")
    .replace(/^\n+|\n+$/gu, "")}\n`;
}

function writeSpec(spec: string, dispatch: string, journey: string): Check[] {
  const checks = recordedChecks(dispatch);
  let ticket: string;
  try {
    ticket = ticketPart(readFileSync(join(dispatch, "brief.md"), "utf-8"));
  } catch {
    dieV(`no waybill at ${join(dispatch, "brief.md")} to take the ticket from`);
  }
  mkdirSync(spec, { recursive: true });
  for (const [name, text] of [
    ["ticket.md", ticket],
    ["spec.json", `${JSON.stringify({ checks, journey_dir: journey }, null, 2)}\n`],
  ] as Array<[string, string]>) {
    const tmp = mkstempSync(spec, "tmp");
    writeFileSync(tmp, text);
    renameSync(tmp, join(spec, name));
  }
  return checks;
}

function armWt(wt: string, dispatch: string): { top: string; spec: string; checks: Check[] } {
  const top = topOf(wt);
  const spec = join(top, SPEC);
  const checks = writeSpec(spec, dispatch, join(spec, "journey"));
  const common = git(top, "rev-parse", "--git-common-dir") || ".git";
  const commonPath = common.startsWith("/") ? common : join(top, common);
  const exclude = join(commonPath, "info", "exclude");
  const lines = existsSync(exclude) ? readFileSync(exclude, "utf-8").split("\n") : [];
  if (!lines.includes(`${SPEC}/`)) {
    mkdirSync(dirname(exclude), { recursive: true });
    const existing = existsSync(exclude) ? readFileSync(exclude, "utf-8") : "";
    const prefix = existing && !existing.endsWith("\n") ? "\n" : "";
    appendFileSync(exclude, `${prefix + SPEC}/\n`);
  }
  return { top, spec, checks };
}

function uncommitted(top: string): string[] {
  const r = run("git", ["-C", top, "status", "--porcelain", "--untracked-files=all"]);
  return r.out
    .split("\n")
    .filter((l) => l.slice(3) && !l.slice(3).replace(/^"|"$/gu, "").startsWith(`${SPEC}/`))
    .map((l) => l.slice(3));
}

function listedFiles(files: string[]): string {
  return (
    files.slice(0, 10).join(", ") + (files.length > 10 ? ` and ${files.length - 10} more` : "")
  );
}

let _runningPgid: number | null = null;

function _runOne(
  c: Check,
  top: string,
  env: Record<string, string>,
  log: string,
): { result: string; code: number | null; secs: number; why: string } {
  if (!c.command) {
    return {
      result: "not run",
      code: null,
      secs: 0,
      why: `no command: discovery found none for ${c.source}; declare the check in ${DECLARATION}`,
    };
  }
  const timeout = c.timeout || TIMEOUT;
  const t0 = Date.now();
  const fd = openSync(log, "w");
  const child = spawn("bash", ["-e", "-o", "pipefail", "-c", c.command], {
    cwd: top,
    env,
    stdio: ["ignore", fd, fd],
    detached: true,
  });
  _runningPgid = child.pid!;
  let timedOut = false;
  const deadline = t0 + timeout * 1000;

  return new Promise((resolvePromise) => {
    const timer = setInterval(() => {
      if (Date.now() > deadline) {
        timedOut = true;
        try {
          process.kill(-child.pid!, "SIGKILL");
        } catch {
          /* empty */
        }
      }
    }, 100);

    child.on("exit", (code, signal) => {
      clearInterval(timer);
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        /* empty */
      }
      closeSync(fd);
      _runningPgid = null;
      const secs = Math.round((Date.now() - t0) / 1000);
      let out: string;
      try {
        out = plain(readFileSync(log, "utf-8"));
      } catch {
        out = "";
      }
      const outLines = out.split("\n").filter((l) => l.trim());
      const last = (outLines.length > 0 ? outLines[outLines.length - 1]! : "(no output)").slice(
        0,
        300,
      );

      let result: string;
      let why: string;
      let exitCode: number | null;

      if (timedOut) {
        result = "fail";
        exitCode = null;
        why = `timed out after ${timeout}s`;
      } else if (signal) {
        const k = signalExit(signal ?? "");
        result = "fail";
        exitCode = k.code;
        why = `killed by signal ${k.num}: ${last}`;
      } else {
        exitCode = code;
        if (code === 126 || code === 127) {
          result = "not run";
          why = `bash could not start it: ${last}`;
        } else if (c.kind === "tool") {
          if (code === 0) {
            result = "pass";
            why = "";
          } else {
            result = code === 3 ? "not run" : "fail";
            why = last.replace(/^not run: /u, "");
          }
          // ASCII: BASE compiles user score patterns with no flags.
        } else if (c.threshold !== undefined) {
          // ASCII: BASE compiles user score patterns with no flags.
          const scoreRe = new RegExp(c.score!, "g");
          const found = [...out.matchAll(scoreRe)].map((m) => m[1] ?? m[0]);
          if (code !== 0) {
            result = "fail";
            why = `exit ${code}${found.length > 0 ? `, last score ${found[found.length - 1]}` : ""}: ${last}`;
          } else if (found.length === 0) {
            result = "fail";
            why = `no score in its output: nothing matches /${c.score}/`;
          } else {
            const scoreVal = parseFloat(found[found.length - 1]!);
            if (Number.isNaN(scoreVal)) {
              result = "fail";
              why = `its score, '${found[found.length - 1]}', is not a number`;
            } else if (scoreVal >= c.threshold) {
              result = "pass";
              why = `score ${found[found.length - 1]}, threshold ${c.threshold}`;
            } else {
              result = "fail";
              why = `score ${found[found.length - 1]}, below the threshold ${c.threshold}`;
            }
          }
        } else {
          result = code === 0 ? "pass" : "fail";
          why = code === 0 ? "" : last;
        }
      }
      resolvePromise({ result, code: exitCode, secs, why });
    });
  }) as any; // sync wrapper not possible; handled below
}

// Synchronous version using spawnSync with a timeout
function runOneSync(
  c: Check,
  top: string,
  env: Record<string, string>,
  log: string,
): { result: string; code: number | null; secs: number; why: string } {
  if (!c.command) {
    return {
      result: "not run",
      code: null,
      secs: 0,
      why: `no command: discovery found none for ${c.source}; declare the check in ${DECLARATION}`,
    };
  }
  const timeout = c.timeout || TIMEOUT;
  const t0 = Date.now();
  let timedOut = false;

  // BASE runs the command with the log as its stdout and a new session, then kills the whole
  // group: the command itself if it timed out, and whatever it left running. A pipe would be
  // held open by anything the command backgrounds.
  const fd = openSync(log, "w");
  let r;
  try {
    r = spawnSync("bash", ["-e", "-o", "pipefail", "-c", c.command], {
      cwd: top,
      env,
      stdio: ["ignore", fd, fd],
      detached: true,
      timeout: timeout * 1000,
      killSignal: "SIGKILL",
    });
  } finally {
    closeSync(fd);
    try {
      if (r?.pid) process.kill(-r.pid, "SIGKILL");
    } catch {
      /* the group is already gone */
    }
  }
  const secs = Math.round((Date.now() - t0) / 1000);
  let rawOut = "";
  try {
    rawOut = readFileSync(log, "utf-8");
  } catch {
    rawOut = "";
  }
  const out = plain(rawOut);
  const outLines = out.split("\n").filter((l) => l.trim());
  const last = (outLines.length > 0 ? outLines[outLines.length - 1]! : "(no output)").slice(0, 300);

  // Detect timeout: spawnSync sets error ETIMEDOUT or signal SIGKILL after timeout
  if (r.error && (r.error as any).code === "ETIMEDOUT") {
    timedOut = true;
  }

  let result: string;
  let why: string;
  let exitCode: number | null;

  if (timedOut) {
    result = "fail";
    exitCode = null;
    why = `timed out after ${timeout}s`;
  } else if (r.signal) {
    const k = signalExit(r.signal ?? "");
    result = "fail";
    exitCode = k.code;
    why = `killed by signal ${k.num}: ${last}`;
  } else {
    exitCode = r.status;
    const code = r.status!;
    if (code === 126 || code === 127) {
      result = "not run";
      why = `bash could not start it: ${last}`;
    } else if (c.kind === "tool") {
      if (code === 0) {
        result = "pass";
        why = "";
      } else {
        result = code === 3 ? "not run" : "fail";
        why = last.replace(/^not run: /u, "");
        // ASCII: BASE compiles user score patterns with no flags.
      }
    } else if (c.threshold !== undefined) {
      // ASCII: BASE compiles user score patterns with no flags.
      const scoreRe = new RegExp(c.score!, "g");
      const found = [...out.matchAll(scoreRe)].map((m) => m[1] ?? m[0]);
      if (code !== 0) {
        result = "fail";
        why = `exit ${code}${found.length > 0 ? `, last score ${found[found.length - 1]}` : ""}: ${last}`;
      } else if (found.length === 0) {
        result = "fail";
        why = `no score in its output: nothing matches /${c.score}/`;
      } else {
        const scoreVal = parseFloat(found[found.length - 1]!);
        if (Number.isNaN(scoreVal)) {
          result = "fail";
          why = `its score, '${found[found.length - 1]}', is not a number`;
        } else if (scoreVal >= c.threshold) {
          result = "pass";
          why = `score ${found[found.length - 1]}, threshold ${c.threshold}`;
        } else {
          result = "fail";
          why = `score ${found[found.length - 1]}, below the threshold ${c.threshold}`;
        }
      }
    } else {
      result = code === 0 ? "pass" : "fail";
      why = code === 0 ? "" : last;
    }
  }
  return { result, code: exitCode, secs, why };
}

function runChecks(wt: string, dispatch: string | null): never {
  const top = topOf(wt);
  let spec: string;
  let checks: Check[];
  if (dispatch) {
    spec = join(dispatch, "verify", "spec");
    checks = writeSpec(spec, dispatch, join(dispatch, "journey"));
  } else {
    spec = join(top, SPEC);
    const d = loadJson(join(spec, "spec.json"));
    if (!d || typeof d !== "object" || !Array.isArray((d as any).checks)) {
      dieV(
        `${top} is not armed: ${join(spec, "spec.json")} is missing; the coachman arms each workhorse worktree with verify.sh arm`,
      );
    }
    checks = (d as any).checks;
  }
  const dirt = uncommitted(top);
  if (dirt.length > 0) {
    dieV(
      `${top} has files git sees that its commit does not hold, so no result would belong to a commit: ${listedFiles(dirt)}. ` +
        `Commit what belongs to the change and keep what a tool wrote out of git's sight` +
        (dispatch ? ", or run on a scratch cut at the branch's HEAD with cut-scratch.sh" : "") +
        ", then run again.",
    );
  }
  const sha = git(top, "rev-parse", "HEAD")!;
  const branch = git(top, "symbolic-ref", "--short", "-q", "HEAD") || "detached";
  const logs = dispatch ? join(dispatch, "verify", sha.slice(0, 12)) : join(spec, "logs");
  mkdirSync(logs, { recursive: true });
  const env = { ...process.env, POSTMASTER_VERIFY: spec } as Record<string, string>;
  if (dispatch) env.POSTMASTER_DETECTIONS_LOG = join(dispatch, "detections.jsonl");
  else delete env.POSTMASTER_DETECTIONS_LOG;
  delete env.SCRUB_CHECK_DISABLE;
  delete env.POSTMASTER_LAUNCH_NAME;
  const results: string[] = [];
  const unlogged: string[] = [];
  let spoiled: string | null = null;

  for (const c of checks) {
    const log = join(logs, `${c.name}.log`);
    let result: string;
    let code: number | null;
    let secs: number;
    let why: string;
    if (spoiled) {
      result = "not run";
      code = null;
      secs = 0;
      why = `${spoiled} changed files git sees, so the worktree is no longer its commit`;
    } else {
      const r = runOneSync(c, top, env, log);
      result = r.result;
      code = r.code;
      secs = r.secs;
      why = r.why;
      const dirt2 = uncommitted(top);
      if (dirt2.length > 0) {
        spoiled = c.name;
        result = "fail";
        why = `it changed files git sees, so its result is not its commit's: ${listedFiles(dirt2)}`;
      }
    }
    results.push(result);
    console.log(
      `${c.name}: ${result}, exit ${code === null ? "-" : code}, ${secs}s: ${oneline(c.command) || "(no command)"}`,
    );
    if (why) console.log(`  ${why}`);
    if (result !== "pass" && c.command && existsSync(log)) {
      console.log(`  log: ${log}`);
    }
    if (dispatch) {
      const detail = `on=${branch}@${sha.slice(0, 12)} result=${result.replace(/ /gu, "-")} exit=${code === null ? "-" : code} secs=${secs}`;
      let detailFull = detail;
      if (why) detailFull += (result === "pass" ? " score=" : " reason=") + why;
      const lr = run("bash", [
        join(HERE, "log-action.sh"),
        dispatch,
        "coachman",
        "verify",
        c.name,
        detailFull,
      ]);
      if (lr.code !== 0) {
        unlogged.push(`${c.name}: ${lr.err.trim()}`);
      }
    }
  }
  for (const u of unlogged) {
    console.error(`verify: not logged, ${u}`);
  }
  if (unlogged.length > 0) process.exit(1);
  process.exit(results.includes("fail") ? 2 : results.includes("not run") ? 3 : 0);
}

function logged(dispatch: string): Array<{ target: string; ts: string; m: RegExpExecArray }> {
  const out: Array<{ target: string; ts: string; m: RegExpExecArray }> = [];
  const f = join(dispatch, "actions.jsonl");
  let lines: string[];
  try {
    lines = readFileSync(f, "utf-8").split("\n");
  } catch {
    return out;
  }
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n]!;
    if (!line.trim()) continue;
    let e: any;
    try {
      e = JSON.parse(line);
    } catch {
      if (line.includes('"verify"')) {
        dieV(`line ${n + 1} of ${f} does not parse, so the checks' results cannot be read from it`);
      }
      continue;
    }
    if (e.action === "verify") {
      const m = DETAIL_RE.exec(String(e.detail || ""));
      if (m) {
        out.push({ target: String(e.target || ""), ts: String(e.ts || ""), m });
      }
    }
  }
  return out;
}

// --- entry -----------------------------------------------------------------------------------
function usageDieV(): never {
  console.error(usage);
  process.exit(1);
  throw new Error("unreachable");
}
const usage =
  "usage: verify.sh checks <repo> [--gate <command>] [--lines | --json] | record <repo> <dispatch> [--gate <command>] | arm <worktree> <dispatch> | run <worktree> [<dispatch>] | journey-path <worktree> [<dispatch>] | results <dispatch> <worktree> | summary <summary-file> <dispatch> <worktree>";

function main(argv: string[]): number {
  if (argv[0] === "checks" || argv[0] === "record") {
    const sub = argv[0]!;
    let gate = "";
    let form = "human";
    const pos: string[] = [];
    let i = 1;
    while (i < argv.length) {
      if (argv[i] === "--gate") {
        if (argv.length < i + 2) usageDieV();
        gate = argv[i + 1]!;
        i += 2;
      } else if (argv[i] === "--lines") {
        if (sub !== "checks") usageDieV();
        form = "lines";
        i++;
      } else if (argv[i] === "--json") {
        if (sub !== "checks") usageDieV();
        form = "json";
        i++;
      } else if (argv[i]?.startsWith("-")) {
        usageDieV();
      } else {
        pos.push(argv[i]!);
        i++;
      }
    }
    if (sub === "checks" ? pos.length !== 1 : pos.length !== 2) usageDieV();
    const repo = resolve(pos[0]!);
    if (!existsSync(repo) || !statSync(repo).isDirectory()) {
      dieV(`no such directory: ${pos[0]}`);
    }
    if (sub === "record") {
      const dispatch = resolve(pos[1]!);
      if (!existsSync(dispatch) || !statSync(dispatch).isDirectory()) {
        dieV(`no such dispatch directory: ${pos[1]}`);
      }
      const f = join(dispatch, "checks.json");
      if (existsSync(f)) {
        console.error(`verify: ${f} already written; left alone`);
        console.log(human(recordedChecks(dispatch)));
        return 0;
      }
      const { checks, decl } = resolveChecks(repo, gate, true);
      const record = {
        written: new Date().toISOString().replace(/\.[0-9]+Z$/u, "Z"),
        repo,
        head: git(repo, "rev-parse", "HEAD"),
        declaration: decl,
        gate_given: gate || null,
        checks,
      };
      const tmpF = mkstempSync(dispatch, "tmp");
      writeFileSync(tmpF, `${JSON.stringify(record, null, 2)}\n`);
      renameSync(tmpF, f);
      console.log(human(checks));
      return 0;
    }
    const { checks } = resolveChecks(repo, gate, false);
    if (form === "json") {
      console.log(JSON.stringify(checks, null, 2));
    } else if (form === "lines") {
      const clean = (s: string) => String(s).replace(/[\t\r\n]+/gu, " ");
      console.log(
        checks
          .map((c) => [c.name, c.source, clean(oneline(c.command)), clean(c.shows)].join("\t"))
          .join("\n"),
      );
    } else {
      console.log(human(checks));
    }
    return 0;
  }
  if (argv[0] === "arm") {
    if (argv.length !== 3) usageDieV();
    const { top, spec, checks } = armWt(argv[1]!, resolve(argv[2]!));
    console.log(`armed ${top}: ${checks.length} checks in ${spec}`);
    return 0;
  }
  if (argv[0] === "run") {
    if (argv.length < 2 || argv.length > 3) usageDieV();
    runChecks(argv[1]!, argv.length > 2 ? resolve(argv[2]!) : null);
  }
  if (argv[0] === "results") {
    if (argv.length !== 3) usageDieV();
    const dispatch = resolve(argv[1]!);
    const top = topOf(argv[2]!);
    const sha = git(top, "rev-parse", "HEAD")?.slice(0, 12);
    const allLogged = logged(dispatch);
    const latest = new Map<string, { ts: string; m: RegExpExecArray }>();
    for (const { target, ts, m } of allLogged) {
      if (m[2] === sha) latest.set(target, { ts, m });
    }
    const states: string[] = [];
    for (const c of recordedChecks(dispatch)) {
      const got = latest.get(c.name);
      if (got) {
        const result = got.m[3]?.replace(/-/gu, " ");
        states.push(got.m[3]!);
        console.log(`${c.name}: ${result}, exit ${got.m[4]}, at ${got.ts}`);
      } else {
        states.push("missing");
        console.log(`${c.name}: no result logged at ${sha}`);
      }
    }
    return states.includes("fail") ? 2 : states.every((s) => s === "pass") ? 0 : 3;
  }
  if (argv[0] === "summary") {
    if (argv.length !== 4) usageDieV();
    const summary = argv[1]!;
    const dispatch = resolve(argv[2]!);
    const top = topOf(argv[3]!);
    let text: string;
    try {
      text = readFileSync(summary, "utf-8");
    } catch {
      dieV(`cannot read ${summary}`);
    }
    const claims = new Map<string, RegExpExecArray>();
    for (const line of text.split("\n")) {
      const m = RESULT_RE.exec(line);
      if (m) claims.set(m[2]!, m);
    }
    const sha = git(top, "rev-parse", "HEAD")?.slice(0, 12);
    const coach = new Map<string, RegExpExecArray>();
    for (const { target, m } of logged(dispatch)) {
      if (m[2] === sha) coach.set(target, m);
    }
    const problems: string[] = [];
    for (const c of recordedChecks(dispatch)) {
      const m = claims.get(c.name);
      const want = oneline(c.command) || "(no command)";
      if (!m) {
        problems.push(`unverified: the summary does not give ${c.name}'s command and exit`);
        continue;
      }
      if (oneline(m[6]!) !== want) {
        problems.push(
          `unverified: the summary says ${c.name} ran ${oneline(m[6]!)}; the run's check is ${want}`,
        );
        continue;
      }
      const k = coach.get(c.name);
      if (k && k[3] !== m[3]?.replace(/ /gu, "-")) {
        problems.push(
          `${c.name}: the summary says ${m[3]}; the coachman's run at ${sha} says ${k[3]?.replace(/-/gu, " ")}`,
        );
      }
    }
    if (problems.length > 0) console.log(problems.join("\n"));
    if (coach.size === 0) console.log(`no coachman run at ${sha} to hold the claims against`);
    console.log(
      `the summary ${
        problems.length === 0
          ? `gives every check's command and exit${coach.size > 0 ? ", and agrees with the coachman's run" : ""}`
          : `is unverified or disagrees: ${problems.length} problem(s)`
      }`,
    );
    return problems.length > 0 ? 2 : 0;
  }
  if (argv[0] === "journey-path") {
    if (argv.length < 2 || argv.length > 3) usageDieV();
    const args = ["--path", argv[1]!];
    if (argv.length === 3) {
      const r = run("bash", ["-c", 'cd "$1" 2>/dev/null && pwd -P', "_", argv[2]]);
      if (r.code !== 0) {
        console.error(`verify: no such dispatch directory: ${argv[2]}`);
        return 1;
      }
      args.push("--dir", join(r.out.trim(), "journey"));
    }
    const r = run("bash", [join(HERE, "verify-journey.sh"), ...args]);
    process.stdout.write(r.out);
    process.stderr.write(r.err);
    return r.code;
  }
  usageDieV();
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
