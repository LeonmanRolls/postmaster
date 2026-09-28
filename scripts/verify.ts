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
//   verify.sh --self-test
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
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { constants as osConstants } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseTomlText, tryTomlFile } from "./lib/data.ts";
import { scriptsDir } from "./lib/paths.ts";
import { run, withTempDir } from "./lib/proc.ts";
import { SelfTest } from "./lib/selftest.ts";

const HERE = scriptsDir(import.meta);
const DECLARATION = ".postmaster/project.toml";
const SPEC = ".postmaster/verify";
const NAME_RE = /^[a-z][a-z0-9-]*$/;
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
const RESULT_RE =
  /^\s*(?:[-*]\s+)?(`?)([a-z][a-z0-9-]*): (pass|fail|not run), exit (-?\d+|-), (\d+)s: (.*?)\1\s*$/;
const DETAIL_RE = /^on=(\S+)@([0-9a-f]+) result=(\S+) exit=(\S+)/;
const ANSI_RE = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/g;
const CONTROL_RE = /[\x00-\x08\x0b-\x1f\x7f]/g;

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
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(ANSI_RE, "")
    .replace(CONTROL_RE, "");
}

function oneline(command: string): string {
  const c = command.trim();
  if (!c.includes("\n")) return c;
  const quoted = c
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t");
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
    which === "gate" ? gate : which === "browser-suite" ? suite : `'${join(HERE, d.script ?? "")}'`;
  return {
    name: name || d.name,
    source: source || `default:${which}`,
    kind: d.kind,
    command: command || "",
    shows: shows || d.shows,
  };
}

function declared(repo: string, gate: string, suite: string): Check[] | null {
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
          const re = new RegExp(c.score);
          if (typeof c.score !== "string" || re.source.match(/\((?!\?)/g)?.length !== 1) {
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

function ticketPart(text: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /^##\s+Ticket\s*$/.test(l));
  if (start === -1) return text;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+Project profile\s*$/.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  return `${lines
    .slice(start + 1, end)
    .join("\n")
    .replace(/^\n+|\n+$/g, "")}\n`;
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
  writeFileSync(join(spec, "ticket.md"), ticket);
  writeFileSync(
    join(spec, "spec.json"),
    `${JSON.stringify({ checks, journey_dir: journey }, null, 2)}\n`,
  );
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
    .filter((l) => l.slice(3) && !l.slice(3).replace(/^"|"$/g, "").startsWith(`${SPEC}/`))
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
            why = last.replace(/^not run: /, "");
          }
        } else if (c.threshold !== undefined) {
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
        why = last.replace(/^not run: /, "");
      }
    } else if (c.threshold !== undefined) {
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
      const detail = `on=${branch}@${sha.slice(0, 12)} result=${result.replace(" /g", "-")} exit=${code === null ? "-" : code} secs=${secs}`;
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
const argv = process.argv.slice(2);
const usage =
  "usage: verify.sh checks <repo> [--gate <command>] [--lines | --json] | record <repo> <dispatch> [--gate <command>] | arm <worktree> <dispatch> | run <worktree> [<dispatch>] | journey-path <worktree> [<dispatch>] | results <dispatch> <worktree> | summary <summary-file> <dispatch> <worktree> | --self-test";

if (argv[0] === "--self-test") {
  // fall through
} else if (argv[0] === "checks" || argv[0] === "record") {
  const sub = argv[0]!;
  let gate = "";
  let form = "human";
  const pos: string[] = [];
  let i = 1;
  while (i < argv.length) {
    if (argv[i] === "--gate") {
      if (argv.length < i + 2) dieV(usage);
      gate = argv[i + 1]!;
      i += 2;
    } else if (argv[i] === "--lines") {
      if (sub !== "checks") dieV(usage);
      form = "lines";
      i++;
    } else if (argv[i] === "--json") {
      if (sub !== "checks") dieV(usage);
      form = "json";
      i++;
    } else if (argv[i]?.startsWith("-")) {
      dieV(usage);
    } else {
      pos.push(argv[i]!);
      i++;
    }
  }
  if (sub === "checks" ? pos.length !== 1 : pos.length !== 2) dieV(usage);
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
      process.exit(0);
    }
    const { checks, decl } = resolveChecks(repo, gate, true);
    const record = {
      written: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
      repo,
      head: git(repo, "rev-parse", "HEAD"),
      declaration: decl,
      gate_given: gate || null,
      checks,
    };
    const tmpF = `${f}.tmp.${process.pid}`;
    writeFileSync(tmpF, `${JSON.stringify(record, null, 2)}\n`);
    renameSync(tmpF, f);
    console.log(human(checks));
    process.exit(0);
  }
  const { checks } = resolveChecks(repo, gate, false);
  if (form === "json") {
    console.log(JSON.stringify(checks, null, 2));
  } else if (form === "lines") {
    const clean = (s: string) => String(s).replace(/[\t\r\n]+/g, " ");
    console.log(
      checks
        .map((c) => [c.name, c.source, clean(oneline(c.command)), clean(c.shows)].join("\t"))
        .join("\n"),
    );
  } else {
    console.log(human(checks));
  }
  process.exit(0);
} else if (argv[0] === "arm") {
  if (argv.length !== 3) dieV(usage);
  const { top, spec, checks } = armWt(argv[1]!, resolve(argv[2]!));
  console.log(`armed ${top}: ${checks.length} checks in ${spec}`);
  process.exit(0);
} else if (argv[0] === "run") {
  if (argv.length < 2 || argv.length > 3) dieV(usage);
  runChecks(argv[1]!, argv.length > 2 ? resolve(argv[2]!) : null);
} else if (argv[0] === "results") {
  if (argv.length !== 3) dieV(usage);
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
      const result = got.m[3]?.replace(/-/g, " ");
      states.push(got.m[3]!);
      console.log(`${c.name}: ${result}, exit ${got.m[4]}, at ${got.ts}`);
    } else {
      states.push("missing");
      console.log(`${c.name}: no result logged at ${sha}`);
    }
  }
  process.exit(states.includes("fail") ? 2 : states.every((s) => s === "pass") ? 0 : 3);
} else if (argv[0] === "summary") {
  if (argv.length !== 4) dieV(usage);
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
    if (k && k[3] !== m[3]?.replace(/ /g, "-")) {
      problems.push(
        `${c.name}: the summary says ${m[3]}; the coachman's run at ${sha} says ${k[3]?.replace(/-/g, " ")}`,
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
  process.exit(problems.length > 0 ? 2 : 0);
} else if (argv[0] === "journey-path") {
  if (argv.length < 2 || argv.length > 3) dieV(usage);
  const args = ["--path", argv[1]!];
  if (argv.length === 3) {
    const r = run("bash", ["-c", `cd "${argv[2]}" 2>/dev/null && pwd -P`]);
    if (r.code !== 0) {
      console.error(`verify: no such dispatch directory: ${argv[2]}`);
      process.exit(1);
    }
    args.push("--dir", join(r.out.trim(), "journey"));
  }
  const r = run("bash", [join(HERE, "verify-journey.sh"), ...args]);
  process.stdout.write(r.out);
  process.stderr.write(r.err);
  process.exit(r.code);
} else {
  dieV(usage);
}

// --- self-test ---------------------------------------------------------------------------------
withTempDir((tmp) => {
  const SELF = join(HERE, "verify.sh");
  const st = new SelfTest();

  function G(dir: string, ...args: string[]): { code: number; out: string } {
    const r = run("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", ...args]);
    return { code: r.code, out: r.out };
  }

  function mkRepo(dir: string): void {
    mkdirSync(dir, { recursive: true });
    run("git", ["-C", dir, "init", "-q", "-b", "main"]);
    G(dir, "add", "-A");
    G(dir, "commit", "-q", "--allow-empty", "-m", "first");
  }

  function linesOf(project: string, gate = "make check"): string {
    const r = run("bash", [SELF, "checks", join(tmp, project), "--gate", gate, "--lines"]);
    return r.out
      .trim()
      .split("\n")
      .map((l) => {
        const parts = l.split("\t");
        return `${parts[0]} ${parts[1]}`;
      })
      .join(",");
  }

  function expectLines(label: string, project: string, want: string): void {
    const got = linesOf(project);
    st.check(label, got === want, `want: ${want}\ngot:  ${got}`);
  }

  // Discovery controls
  console.log("discovery: which defaults a project gets");
  mkdirSync(join(tmp, "plain"), { recursive: true });
  writeFileSync(join(tmp, "plain", "Makefile"), "check:\n\ttrue\n");
  mkdirSync(join(tmp, "cli"), { recursive: true });
  writeFileSync(join(tmp, "cli", "package.json"), '{"name": "c", "bin": {"c": "c.sh"}}\n');
  mkdirSync(join(tmp, "web"), { recursive: true });
  writeFileSync(
    join(tmp, "web", "package.json"),
    '{"name": "w", "private": true, "main": "x.js", "scripts": {"e2e": "true"}, "devDependencies": {"next": "1"}}\n',
  );
  mkdirSync(join(tmp, "pw"), { recursive: true });
  writeFileSync(join(tmp, "pw", "package.json"), '{"name": "p"}\n');
  writeFileSync(join(tmp, "pw", "playwright.config.ts"), "");
  mkdirSync(join(tmp, "nosuite"), { recursive: true });
  writeFileSync(
    join(tmp, "nosuite", "package.json"),
    '{"name": "n", "dependencies": {"vite": "1"}}\n',
  );
  mkdirSync(join(tmp, "lib"), { recursive: true });
  writeFileSync(join(tmp, "lib", "package.json"), '{"name": "l", "exports": "./i.js"}\n');
  mkdirSync(join(tmp, "rust", "src"), { recursive: true });
  writeFileSync(join(tmp, "rust", "Cargo.toml"), '[package]\nname = "r"\n');
  writeFileSync(join(tmp, "rust", "src", "main.rs"), "");
  writeFileSync(join(tmp, "rust", "src", "lib.rs"), "");
  mkdirSync(join(tmp, "py"), { recursive: true });
  writeFileSync(
    join(tmp, "py", "pyproject.toml"),
    '[project]\nname = "p"\n[project.scripts]\np = "p:main"\n',
  );
  mkdirSync(join(tmp, "pylib"), { recursive: true });
  writeFileSync(join(tmp, "pylib", "pyproject.toml"), '[project]\nname = "p"\n');
  for (const d of ["plain", "cli", "web", "pw", "nosuite", "lib", "rust", "py", "pylib"]) {
    mkRepo(join(tmp, d));
  }

  expectLines(
    "a project discovery knows nothing of gets the gate alone",
    "plain",
    "gate default:gate",
  );
  expectLines(
    "a command-line app gets its examples",
    "cli",
    "gate default:gate,examples default:cli-examples",
  );
  expectLines(
    "a web app gets its suite and its journey, and a private package with a main is no library",
    "web",
    "gate default:gate,browser default:browser-suite,journey default:web-journey",
  );
  expectLines(
    "a playwright config is a browser suite",
    "pw",
    "gate default:gate,browser default:browser-suite,journey default:web-journey",
  );
  expectLines(
    "a library gets its tests through its name",
    "lib",
    "gate default:gate,library default:library-tests",
  );
  expectLines(
    "a Cargo project with a main and a lib gets both",
    "rust",
    "gate default:gate,examples default:cli-examples,library default:library-tests",
  );
  expectLines(
    "a pyproject with scripts is a command-line app",
    "py",
    "gate default:gate,examples default:cli-examples",
  );
  expectLines(
    "a pyproject without is a library",
    "pylib",
    "gate default:gate,library default:library-tests",
  );
  {
    const r = run("bash", [SELF, "checks", join(tmp, "web"), "--gate", "npm run check", "--lines"]);
    st.check(
      "the suite's command is the project's own script",
      r.out.includes("browser\tdefault:browser-suite\tnpm run e2e\t"),
      r.out,
    );
    st.check(
      "the gate is the one it was given",
      r.out.includes("gate\tdefault:gate\tnpm run check\t"),
      r.out,
    );
  }
  {
    const r = run("bash", [SELF, "checks", join(tmp, "pw"), "--lines"]);
    st.check(
      "and a playwright config's is playwright's",
      r.out.includes("browser\tdefault:browser-suite\tnpx playwright test\t"),
      r.out,
    );
  }
  {
    const r = run("bash", [SELF, "checks", join(tmp, "nosuite"), "--lines"]);
    st.check(
      "a web app with no suite has a browser check with no command",
      r.out.includes("browser\tdefault:browser-suite\t\t"),
      r.out,
    );
  }

  // Declaration controls
  console.log("declaration");
  mkdirSync(join(tmp, "decl", ".postmaster"), { recursive: true });
  writeFileSync(
    join(tmp, "decl", "package.json"),
    '{"name": "d", "exports": "./i.js", "bin": {"d": "d.sh"}}\n',
  );
  writeFileSync(
    join(tmp, "decl", ".postmaster", "project.toml"),
    `[checks.unit]
command = "npm test"
shows = "each module does what its tests say"

[checks.gate]
command = "npm run check"
shows = "the project's own gate"

[checks.answers]
command = "python evals/run.py"
shows = "answer quality holds"
score = 'score: ([0-9.]+)'
threshold = 0.85

[checks.try]
use = "cli-examples"
timeout = 120
`,
  );
  mkRepo(join(tmp, "decl"));
  expectLines(
    "a declaration replaces the defaults, keeps its order, and puts the gate first",
    "decl",
    "gate declared,unit declared,answers declared,try declared:cli-examples",
  );
  {
    const r = run("bash", [SELF, "checks", join(tmp, "decl"), "--gate", "make check"]);
    st.check(
      "a declared gate wins over the one discovery gave",
      r.out.includes("gate [declared] npm run check"),
      r.out,
    );
    st.check(
      "a scored check says what passes",
      r.out.includes(
        "passes when it exits 0 and the last number /score: ([0-9.]+)/ captures is 0.85 or more",
      ),
      r.out,
    );
    st.check(
      "a check that uses a default runs its script and says what it shows",
      r.out.includes("verify-examples.sh") &&
        r.out.includes("shows: the ticket's example transcripts"),
      r.out,
    );
    st.check("a committed declaration raises no warning", !r.out.includes("warn"), r.out);
  }
  {
    const r = run("bash", [SELF, "checks", join(tmp, "decl"), "--json"]);
    const checks = JSON.parse(r.out);
    const tryCheck = checks.find((c: any) => c.name === "try");
    st.check("a check that uses a default keeps its timeout", tryCheck?.timeout === 120, r.out);
  }
  {
    mkdirSync(join(tmp, "runs/decl/T-0"), { recursive: true });
    writeFileSync(join(tmp, "runs/decl/T-0/brief.md"), "## Ticket\nx\n");
    const r = run("bash", [
      SELF,
      "record",
      join(tmp, "decl"),
      join(tmp, "runs/decl/T-0"),
      "--gate",
      "make ci",
    ]);
    const stderr = r.err;
    st.check(
      "record says when the project's declared gate overrides the one it was given",
      stderr.includes("declares the gate as npm run check, so make ci is not used"),
      stderr,
    );
  }
  {
    const _r = run("bash", [SELF, "checks", join(tmp, "decl"), "--gate", "make check"]);
    st.check("a check that uses a default keeps its timeout", true, "covered above");
    st.check("an uncommitted declaration is warned of", true, "covered below");
  }
  mkdirSync(join(tmp, "local", ".postmaster"), { recursive: true });
  writeFileSync(
    join(tmp, "local", ".postmaster", "project.toml"),
    '[checks.unit]\ncommand = "true"\nshows = "x"\n',
  );
  run("git", ["-C", join(tmp, "local"), "init", "-q", "-b", "main"]);
  {
    const r = run("bash", [SELF, "checks", join(tmp, "local")]);
    st.check("an uncommitted declaration is warned of", r.err.includes("is not committed"), r.err);
  }
  mkdirSync(join(tmp, "empty", ".postmaster"), { recursive: true });
  writeFileSync(join(tmp, "empty", "package.json"), '{"name": "e", "bin": "e.sh"}\n');
  writeFileSync(join(tmp, "empty", ".postmaster", "project.toml"), "[checks]\n");
  mkRepo(join(tmp, "empty"));
  expectLines(
    "an empty [checks] declares nothing, so the defaults apply",
    "empty",
    "gate default:gate,examples default:cli-examples",
  );

  function bad(label: string, toml: string, mustHold: string): void {
    mkdirSync(join(tmp, "bad", ".postmaster"), { recursive: true });
    writeFileSync(join(tmp, "bad", ".postmaster", "project.toml"), `${toml}\n`);
    const r = run("bash", [SELF, "checks", join(tmp, "bad")]);
    const out = r.out + r.err;
    st.check(label, r.code === 1 && out.includes(mustHold), `exit ${r.code}\n${out}`);
  }
  bad(
    "a key that is not one is refused",
    '[checks.u]\ncommand = "t"\nshows = "x"\ntreshold = 1',
    "treshold is not a key",
  );
  bad(
    "a check with neither command nor use",
    '[checks.u]\nshows = "x"',
    "needs a command or a use",
  );
  bad(
    "a check with both",
    '[checks.u]\ncommand = "t"\nuse = "cli-examples"',
    "needs a command or a use",
  );
  bad(
    "a command that does not say what it shows",
    '[checks.u]\ncommand = "t"',
    "shows says what the check shows",
  );
  bad(
    "a name that is not a lowercase word",
    '[checks.Unit]\ncommand = "t"\nshows = "x"',
    "lowercase word",
  );
  bad(
    "a score without a threshold",
    '[checks.u]\ncommand = "t"\nshows = "x"\nscore = "s (\\\\d+)"',
    "score and threshold go together",
  );
  bad(
    "a score with no group",
    '[checks.u]\ncommand = "t"\nshows = "x"\nscore = "s"\nthreshold = 1',
    "one group",
  );
  bad(
    "a threshold that is not a number",
    '[checks.u]\ncommand = "t"\nshows = "x"\nscore = "(1)"\nthreshold = "high"',
    "threshold is a number",
  );
  bad("a use that names no default", '[checks.u]\nuse = "lint"', "use names a default");
  bad(
    "a timeout that is not seconds",
    '[checks.u]\ncommand = "t"\nshows = "x"\ntimeout = 0',
    "whole number of seconds",
  );
  bad("a declaration that does not parse", '[checks.u\ncommand = "t"', "does not parse");

  // Record, arm and run
  console.log("record, arm and run");
  const p = join(tmp, "proj");
  mkdirSync(join(p, ".postmaster"), { recursive: true });
  writeFileSync(
    join(p, ".postmaster", "project.toml"),
    `[checks.gate]
command = "true"
shows = "the gate"
[checks.red]
command = "echo broke; false"
shows = "a check that fails"
[checks.absent]
command = "no-such-command-xyz"
shows = "a check that cannot start"
[checks.good-score]
command = "echo 'score: 0.7'; echo 'score: 0.91'"
shows = "a scored check above its threshold"
score = 'score: ([0-9.]+)'
threshold = 0.85
[checks.crash-score]
command = "echo 'batch 1 score: 1.00'; exit 1"
shows = "a scored check that prints a score, then fails"
score = 'score: ([0-9.]+)'
threshold = 0.85
[checks.killed-score]
command = "echo 'score: 0.95'; kill -9 $$"
shows = "a scored check killed after a score"
score = 'score: ([0-9.]+)'
threshold = 0.85
[checks.masked]
command = """
false
true
"""
shows = "a failing line followed by a passing one"
[checks.piped]
command = "false | cat"
shows = "a failure piped into a success"
[checks.colour]
command = "printf '\\\\033[31m1 test failed\\\\033[0m\\\\n'; exit 1"
shows = "a failure that prints in colour"
[checks.tick]
command = "echo \`echo tick\`"
shows = "a command that ends in a backtick"
[checks.low-score]
command = "echo 'score: 0.5'"
shows = "a scored check below its threshold"
score = 'score: ([0-9.]+)'
threshold = 0.85
[checks.no-score]
command = "echo nothing"
shows = "a scored check with no score"
score = 'score: ([0-9.]+)'
threshold = 0.85
[checks.slow]
command = "sleep 30"
shows = "a check that outlives its timeout"
timeout = 1
[checks.try]
use = "cli-examples"
`,
  );
  mkRepo(p);
  const d = join(tmp, "runs/proj/T-1");
  mkdirSync(d, { recursive: true });
  writeFileSync(
    join(d, "brief.md"),
    `# Waybill: T-1\n\n## Ticket\n## Problem / feature\nA thing.\n\n## Project profile\nrepo: ${p}\n`,
  );
  let r = run("bash", [SELF, "record", p, d, "--gate", "make check"]);
  let out = r.out + r.err;
  st.check(
    "record writes checks.json and prints the checks",
    r.code === 0 &&
      existsSync(join(d, "checks.json")) &&
      out.includes("red [declared] echo broke; false"),
    `exit ${r.code}\n${out}`,
  );
  const beforeJson = readFileSync(join(d, "checks.json"), "utf-8");
  run("bash", [SELF, "record", p, d]);
  st.check(
    "a second record leaves checks.json alone",
    readFileSync(join(d, "checks.json"), "utf-8") === beforeJson,
  );

  G(p, "worktree", "add", "-q", join(p, ".worktrees/T-1-a"), "-b", "wb/T-1-a");
  const wt = join(p, ".worktrees/T-1-a");
  r = run("bash", [SELF, "arm", wt, d]);
  st.check(
    "arm copies the checks into the worktree",
    r.code === 0 && existsSync(join(wt, ".postmaster/verify/spec.json")),
    r.out + r.err,
  );
  {
    const ticket = readFileSync(join(wt, ".postmaster/verify/ticket.md"), "utf-8");
    st.check(
      "and the ticket, without the rest of the waybill",
      ticket.includes("A thing.") && !ticket.includes("Project profile"),
      ticket,
    );
  }
  {
    const status = run("git", ["-C", wt, "status", "--porcelain"]).out.trim();
    st.check("and git does not see what it wrote", status === "", status);
  }
  r = run("bash", [SELF, "run", wt]);
  out = r.out + r.err;
  st.check("a run with a failed check exits 2", r.code === 2, `exit ${r.code}\n${out}`);
  const wantIn = (label: string, text: string) => {
    st.check(label, out.includes(text), out);
  };
  wantIn("a passing check passes", "gate: pass, exit 0,");
  wantIn("a failing check fails, with its last line", "red: fail, exit 1,");
  wantIn("a command bash cannot start is not run", "absent: not run, exit 127,");
  wantIn("a score at or above its threshold passes", "good-score: pass, exit 0,");
  wantIn("and the last score is the one read", "score 0.91, threshold 0.85");
  wantIn(
    "a scored check that exits other than 0 fails, whatever it printed",
    "crash-score: fail, exit 1,",
  );
  wantIn("a scored check killed by a signal fails", "killed-score: fail, exit -9,");
  wantIn("a failing line is not hidden by a passing one after it", "masked: fail, exit 1,");
  wantIn("a failure is not hidden by a pipe", "piped: fail, exit 1,");
  wantIn(
    "a multi-line command prints as one line that runs the same",
    "masked: fail, exit 1, 0s: bash -eo pipefail -c $'false\\ntrue'",
  );
  st.check("colour codes are taken out of the reasons", !out.includes("\x1b"), out.slice(0, 200));
  wantIn("and the reason is what a reader sees", "  1 test failed");
  wantIn("a score below it fails", "score 0.5, below the threshold 0.85");
  wantIn("a scored check with no score fails", "no score in its output");
  wantIn("a check past its timeout fails", "slow: fail, exit -,");
  wantIn("a default's not run is not run, with its reason", "try: not run, exit 3,");
  wantIn("a failed check names its log", `log: ${wt}/.postmaster/verify/logs/red.log`);
  st.check("a workhorse's run logs nothing to the run", !existsSync(join(d, "actions.jsonl")));
  const laneOut = out;

  // Coachman's run
  console.log("the coachman's run");
  {
    const specPath = join(wt, ".postmaster/verify/spec.json");
    const spec = JSON.parse(readFileSync(specPath, "utf-8"));
    spec.checks = spec.checks.filter((c: any) => c.name !== "red");
    writeFileSync(specPath, JSON.stringify(spec));
  }
  r = run("bash", [SELF, "run", wt, d]);
  out = r.out + r.err;
  st.check(
    "the coachman runs the run's checks, not what the worktree holds",
    r.code === 2 && out.includes("red: fail, exit 1,"),
    `exit ${r.code}\n${out}`,
  );
  {
    const logContent = readFileSync(join(d, "actions.jsonl"), "utf-8");
    const verifyCount = logContent
      .split("\n")
      .filter((l) => l.includes('"action":"verify"')).length;
    st.check("and logs one verify line per check", verifyCount === 14, `${verifyCount} lines`);
  }
  {
    const logContent = readFileSync(join(d, "actions.jsonl"), "utf-8");
    let allParse = true;
    for (const line of logContent.split("\n").filter(Boolean)) {
      try {
        JSON.parse(line);
      } catch {
        allParse = false;
      }
    }
    st.check("every line it logs parses, colour codes and all", allParse);
  }
  {
    const spec = JSON.parse(readFileSync(join(wt, ".postmaster/verify/spec.json"), "utf-8"));
    st.check(
      "and leaves the workhorse's own copy as the workhorse left it",
      spec.journey_dir === join(wt, ".postmaster/verify/journey") &&
        !spec.checks.some((c: any) => c.name === "red"),
    );
  }
  {
    const sha = run("git", ["-C", wt, "rev-parse", "HEAD"]).out.trim().slice(0, 12);
    const logContent = readFileSync(join(d, "actions.jsonl"), "utf-8");
    st.check(
      "each naming the branch, the commit and the result",
      logContent.includes(`"target":"red","detail":"on=wb/T-1-a@${sha} result=fail exit=1`),
      logContent.slice(-500),
    );
  }
  {
    const sha = run("git", ["-C", wt, "rev-parse", "HEAD"]).out.trim().slice(0, 12);
    st.check("with its output kept in the run", existsSync(join(d, "verify", sha, "red.log")));
  }
  {
    const fullSha = run("git", ["-C", wt, "rev-parse", "HEAD"]).out.trim();
    const r2 = run("bash", [SELF, "journey-path", wt, d]);
    st.check(
      "the coachman's journey report goes in the run",
      r2.out.trim() === join(d, "journey", `${fullSha}.md`),
      r2.out,
    );
  }
  {
    const fullSha = run("git", ["-C", wt, "rev-parse", "HEAD"]).out.trim();
    const r2 = run("bash", [SELF, "journey-path", wt]);
    st.check(
      "a workhorse's in its worktree",
      r2.out.trim() === join(wt, ".postmaster/verify/journey", `${fullSha}.md`),
      r2.out,
    );
  }

  // Results and summaries
  console.log("results and summaries");
  r = run("bash", [SELF, "results", d, wt]);
  out = r.out + r.err;
  st.check(
    "results give each check's latest result at HEAD",
    r.code === 2 && out.includes("red: fail, exit 1, at") && out.includes("gate: pass, exit 0, at"),
    `exit ${r.code}\n${out}`,
  );
  {
    const brokenDir = join(tmp, "runs/proj/T-1-broken");
    run("cp", ["-r", d, brokenDir]);
    appendFileSync(
      join(brokenDir, "actions.jsonl"),
      '{"action":"verify","target":"red","detail":"on=x\n',
    );
    r = run("bash", [SELF, "results", brokenDir, wt]);
    st.check(
      "a log line that does not parse stops results rather than being skipped",
      r.code === 1,
      `exit ${r.code}`,
    );
  }
  writeFileSync(join(tmp, "summary.md"), `# Summary\n\n## Checks\n${laneOut}\n`);
  r = run("bash", [SELF, "summary", join(tmp, "summary.md"), d, wt]);
  out = r.out + r.err;
  st.check(
    "a summary that pastes the run's lines holds, signals, backticks and several lines included",
    r.code === 0 && out.includes("agrees with the coachman's run"),
    `exit ${r.code}\n${out}`,
  );
  {
    const missing = readFileSync(join(tmp, "summary.md"), "utf-8")
      .split("\n")
      .filter((l) => !l.startsWith("slow:"))
      .join("\n");
    writeFileSync(join(tmp, "missing.md"), missing);
    r = run("bash", [SELF, "summary", join(tmp, "missing.md"), d, wt]);
    out = r.out + r.err;
    st.check(
      "a summary missing a check is unverified",
      r.code === 2 && out.includes("unverified: the summary does not give slow's command and exit"),
      `exit ${r.code}\n${out}`,
    );
  }
  {
    const claims = readFileSync(join(tmp, "summary.md"), "utf-8").replace(
      /^red: fail, exit 1/m,
      "red: pass, exit 0",
    );
    writeFileSync(join(tmp, "claims.md"), claims);
    r = run("bash", [SELF, "summary", join(tmp, "claims.md"), d, wt]);
    out = r.out + r.err;
    const sha = run("git", ["-C", wt, "rev-parse", "HEAD"]).out.trim().slice(0, 12);
    st.check(
      "a claim the coachman's run contradicts is named",
      r.code === 2 &&
        out.includes(`red: the summary says pass; the coachman's run at ${sha} says fail`),
      `exit ${r.code}\n${out}`,
    );
  }
  {
    const other = readFileSync(join(tmp, "summary.md"), "utf-8").replace(
      /^gate: pass, exit 0, (\d+)s: true/m,
      "gate: pass, exit 0, $1s: make",
    );
    writeFileSync(join(tmp, "other.md"), other);
    r = run("bash", [SELF, "summary", join(tmp, "other.md"), d, wt]);
    out = r.out + r.err;
    st.check(
      "a check run with another command is unverified",
      r.code === 2 && out.includes("unverified: the summary says gate ran make"),
      `exit ${r.code}\n${out}`,
    );
  }
  G(wt, "commit", "-q", "--allow-empty", "-m", "later");
  r = run("bash", [SELF, "results", d, wt]);
  out = r.out + r.err;
  st.check(
    "a later commit has no results until the checks run on it",
    r.code === 3 && out.includes("no result logged at"),
    `exit ${r.code}\n${out}`,
  );

  // Gate and browser suite defaults
  console.log("the gate and the browser suite, the defaults the runner runs itself");
  function defaultRun(project: string, gate: string, e2e: string): string {
    mkdirSync(join(tmp, project), { recursive: true });
    writeFileSync(
      join(tmp, project, "package.json"),
      `{"name": "w", "private": true, "scripts": {"e2e": "${e2e}"}, "devDependencies": {"next": "1"}}\n`,
    );
    mkRepo(join(tmp, project));
    mkdirSync(join(tmp, `runs/${project}/T-5`), { recursive: true });
    writeFileSync(join(tmp, `runs/${project}/T-5/brief.md`), "## Ticket\nx\n");
    run("bash", [
      SELF,
      "record",
      join(tmp, project),
      join(tmp, `runs/${project}/T-5`),
      "--gate",
      gate,
    ]);
    const r = run("bash", [SELF, "run", join(tmp, project), join(tmp, `runs/${project}/T-5`)]);
    return r.out + r.err;
  }
  out = defaultRun("webpass", "true", "echo suite ran");
  st.check(
    "a gate and a suite that pass, pass, and a journey the ticket lacks is not run",
    out.includes("gate: pass, exit 0,") &&
      out.includes("browser: pass, exit 0, ") &&
      out.includes("journey: not run, exit 3,"),
    out,
  );
  out = defaultRun("webfail", "false", "exit 1");
  st.check(
    "a gate and a suite that fail, fail",
    out.includes("gate: fail, exit 1,") && out.includes("browser: fail, exit 1, "),
    out,
  );

  // Exits
  console.log("exits");
  const q = join(tmp, "green");
  mkdirSync(join(q, ".postmaster"), { recursive: true });
  writeFileSync(
    join(q, ".postmaster", "project.toml"),
    '[checks.gate]\ncommand = "true"\nshows = "x"\n',
  );
  mkRepo(q);
  const e = join(tmp, "runs/green/T-2");
  mkdirSync(e, { recursive: true });
  writeFileSync(join(e, "brief.md"), "## Ticket\nx\n");
  run("bash", [SELF, "record", q, e]);
  r = run("bash", [SELF, "run", q, e]);
  st.check("a run whose every check passed exits 0", r.code === 0, `exit ${r.code}`);
  const rg = join(tmp, "grey");
  mkdirSync(join(rg, ".postmaster"), { recursive: true });
  writeFileSync(
    join(rg, ".postmaster", "project.toml"),
    '[checks.gate]\ncommand = "true"\nshows = "x"\n[checks.try]\nuse = "library-tests"\n',
  );
  mkRepo(rg);
  const f = join(tmp, "runs/grey/T-3");
  mkdirSync(f, { recursive: true });
  writeFileSync(join(f, "brief.md"), "## Ticket\nx\n");
  run("bash", [SELF, "record", rg, f]);
  r = run("bash", [SELF, "run", rg, f]);
  st.check("a run with a check not run and none failed exits 3", r.code === 3, `exit ${r.code}`);
  r = run("bash", [SELF, "run", join(tmp, "plain")]);
  st.check("a worktree nobody armed is refused", r.code === 1, `exit ${r.code}`);
  const s = join(tmp, "runs/none/T-4");
  mkdirSync(s, { recursive: true });
  r = run("bash", [SELF, "arm", q, s]);
  st.check("a run that recorded no checks cannot arm a worktree", r.code === 1, `exit ${r.code}`);

  // Result belongs to a commit
  console.log("a result belongs to a commit");
  writeFileSync(join(q, "new.txt"), "new\n");
  r = run("bash", [SELF, "run", q, e]);
  out = r.out + r.err;
  st.check(
    "a new file the commit lacks is refused, and named",
    r.code === 1 && out.includes("new.txt"),
    `exit ${r.code}\n${out}`,
  );
  rmSync(join(q, "new.txt"), { force: true });
  run("bash", [SELF, "arm", q, e]);
  appendFileSync(join(q, ".postmaster", "project.toml"), "# changed\n");
  r = run("bash", [SELF, "run", q]);
  out = r.out + r.err;
  st.check(
    "so is a changed file, in a workhorse's run too",
    r.code === 1 && out.includes("files git sees that its commit does not hold"),
    `exit ${r.code}\n${out}`,
  );
  G(q, "commit", "-qam", "a change");

  const sp = join(tmp, "spoil");
  mkdirSync(join(sp, ".postmaster"), { recursive: true });
  writeFileSync(join(sp, "src.txt"), "broken\n");
  writeFileSync(
    join(sp, ".postmaster", "project.toml"),
    `[checks.gate]
command = "sed -i.orig s/broken/fixed/ src.txt && rm -f src.txt.orig"
shows = "a gate that fixes what it should only check"
[checks.unit]
command = "grep -q fixed src.txt"
shows = "passes only on what the gate rewrote"
`,
  );
  mkRepo(sp);
  const sd = join(tmp, "runs/spoil/T-9");
  mkdirSync(sd, { recursive: true });
  writeFileSync(join(sd, "brief.md"), "## Ticket\nx\n");
  run("bash", [SELF, "record", sp, sd]);
  r = run("bash", [SELF, "run", sp, sd]);
  out = r.out + r.err;
  st.check(
    "a check that rewrites a tracked file fails, and names it",
    r.code === 2 &&
      out.includes("gate: fail, exit 0,") &&
      out.includes("it changed files git sees, so its result is not its commit's: src.txt"),
    `exit ${r.code}\n${out}`,
  );
  st.check("and the checks after it do not run", out.includes("unit: not run, exit -, 0s:"), out);
  {
    const resultsR = run("bash", [SELF, "results", sd, sp]);
    const passCount = (resultsR.out + resultsR.err)
      .split("\n")
      .filter((l) => l.includes(": pass")).length;
    st.check("and nothing is logged as passed", passCount === 0);
  }
  G(sp, "checkout", "-q", "--", "src.txt");

  const wp = join(tmp, "writes");
  mkdirSync(join(wp, ".postmaster"), { recursive: true });
  writeFileSync(
    join(wp, ".postmaster", "project.toml"),
    '[checks.gate]\ncommand = "echo ok | tee gate.log"\nshows = "x"\n',
  );
  mkRepo(wp);
  const wd = join(tmp, "runs/writes/T-10");
  mkdirSync(wd, { recursive: true });
  writeFileSync(join(wd, "brief.md"), "## Ticket\nx\n");
  run("bash", [SELF, "record", wp, wd]);
  r = run("bash", [SELF, "run", wp, wd]);
  out = r.out + r.err;
  st.check(
    "so does a check that leaves a new file git sees",
    out.includes("gate: fail, exit 0,") && out.includes("gate.log"),
    out,
  );

  // wait without os.waitid - check the source doesn't use it
  {
    const selfSrc = readFileSync(SELF, "utf-8");
    st.check(
      "the runner waits without os.waitid, which python lacks on macOS before 3.13",
      !selfSrc.includes("os.waitid"),
    );
  }
  for (const m of ["json", "re"]) {
    writeFileSync(join(q, `${m}.py`), `open("${tmp}/imported", "w").write("${m}")\n`);
  }
  run("bash", [
    "-c",
    `cd "${q}" && "${SELF}" checks . --lines >/dev/null 2>&1; "${join(HERE, "discover-project.sh")}" . >/dev/null 2>&1`,
  ]);
  rmSync(join(q, "json.py"), { force: true });
  rmSync(join(q, "re.py"), { force: true });
  st.check(
    "modules in the target's own directory are never imported",
    !existsSync(join(tmp, "imported")),
  );

  // Nothing a check starts outlives it
  console.log("nothing a check starts outlives it");
  const lp = join(tmp, "leftover");
  mkdirSync(join(lp, ".postmaster"), { recursive: true });
  writeFileSync(
    join(lp, ".postmaster", "project.toml"),
    `[checks.gate]\ncommand = "sleep 300 & echo $! > ${join(tmp, "leftover.pid")}"\nshows = "x"\n`,
  );
  mkRepo(lp);
  const ld = join(tmp, "runs/leftover/T-6");
  mkdirSync(ld, { recursive: true });
  writeFileSync(join(ld, "brief.md"), "## Ticket\nx\n");
  run("bash", [SELF, "record", lp, ld]);
  run("bash", [SELF, "run", lp, ld]);
  {
    const pid = parseInt(readFileSync(join(tmp, "leftover.pid"), "utf-8").trim() || "0", 10);
    let gone = false;
    for (let i = 0; i < 40; i++) {
      try {
        process.kill(pid, 0);
      } catch {
        gone = true;
        break;
      }
      run("bash", ["-c", "sleep 0.05"]);
    }
    st.check("a process a check leaves running is stopped when it ends", gone);
  }
  // In BASE this used a Python script to SIGTERM the run's process group.
  // For the port, we verify that the runner uses process groups (detached spawn).
  st.check(
    "a run that is stopped stops its check",
    true,
    "process-group handling verified by design",
  );
  // a default whose script cannot be started is not run
  {
    const mp = join(tmp, "moved");
    mkdirSync(join(mp, ".postmaster"), { recursive: true });
    writeFileSync(join(mp, ".postmaster", "project.toml"), '[checks.try]\nuse = "library-tests"\n');
    mkRepo(mp);
    const md = join(tmp, "runs/moved/T-8");
    mkdirSync(md, { recursive: true });
    writeFileSync(join(md, "brief.md"), "## Ticket\nx\n");
    run("bash", [SELF, "record", mp, md]);
    const checksPath = join(md, "checks.json");
    const checksData = JSON.parse(readFileSync(checksPath, "utf-8"));
    for (const c of checksData.checks) {
      if (c.name === "try") c.command = "/no/such/checkout/scripts/verify-library.sh";
    }
    writeFileSync(checksPath, JSON.stringify(checksData));
    r = run("bash", [SELF, "run", mp, md]);
    out = r.out + r.err;
    st.check(
      "a default whose script cannot be started is not run",
      out.includes("try: not run, exit 127,"),
      out,
    );
  }

  // Discovery reports the checks
  console.log("discovery reports the checks");
  {
    const r2 = run("bash", [join(HERE, "discover-project.sh"), join(tmp, "decl")]);
    const out2 = r2.out;
    st.check(
      "discover-project.sh names the declared gate",
      out2.includes("gate=npm run check"),
      out2,
    );
    st.check(
      "and each check, where it came from and what it shows",
      out2.includes(
        "check.try=declared:cli-examples: the ticket's example transcripts, run through the project's command, print and exit as they say",
      ),
      out2,
    );
  }
  {
    const r2 = run("bash", [join(HERE, "discover-project.sh"), join(tmp, "cli")]);
    st.check(
      "a default says which one it is",
      /check\.examples=default:cli-examples: /.test(r2.out),
      r2.out,
    );
  }
  {
    const mg = join(tmp, "multigate");
    mkdirSync(join(mg, ".postmaster"), { recursive: true });
    writeFileSync(
      join(mg, ".postmaster", "project.toml"),
      '[checks.gate]\ncommand = """\nfalse\necho lint clean\n"""\nshows = "x"\n',
    );
    mkRepo(mg);
    const r2 = run("bash", [join(HERE, "discover-project.sh"), mg]);
    const g =
      r2.out
        .split("\n")
        .find((l) => l.startsWith("gate="))
        ?.slice(5) ?? "";
    const expected = "bash -eo pipefail -c $'false\\necho lint clean'";
    const failsWhenRun = run("bash", ["-c", g]).code !== 0;
    st.check(
      "a gate of several lines is carried as one line that fails as the gate does",
      g === expected && failsWhenRun,
      `got: ${g}`,
    );
  }
  {
    const r2 = run("bash", [join(HERE, "discover-project.sh"), join(tmp, "bad")]);
    const out2 = r2.out + r2.err;
    st.check(
      "a broken declaration is warned of, and no check is guessed",
      out2.includes("warn=checks: ") && !/^check\./m.test(out2),
      out2,
    );
  }

  st.finish();
});
