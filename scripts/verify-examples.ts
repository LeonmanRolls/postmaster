// The default check for a command-line app: run the ticket's examples through the project's own
// command. An example is a transcript in the ticket's `## User journey`: a fenced block whose first
// line starts with `$ `. A transcript anywhere else, such as one showing a bug as it is, is not an
// example. Each `$ ` line is a command, and the lines after it, up to the next `$ ` line, are what it
// prints, stdout and stderr together as a terminal shows them. A last line `[exit N]` says it
// exits N; without one it must exit 0. Each block runs in a fresh empty directory, which is also
// HOME, one command at a time through bash, so a later command sees what an earlier one wrote and
// no block sees another's.
//
//   verify-examples.sh [<worktree>] [--ticket <file>]
//
//   exit 0  every command printed what its example says and exited as it says
//   exit 1  one did not, or the build failed; each difference is shown
//   exit 3  not run: no ticket, no transcript in its User journey, no command to run it through, or
//           a tool the command or its build needs is not on PATH; the reason is the last line
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, join, resolve } from "node:path";
import { die, run } from "./lib/proc.ts";
import {
  digitValue,
  literalI,
  PY_DOT,
  PY_S_CLASS,
  pyRstrip,
  pySplitLines,
  pyTrim,
} from "./lib/text.ts";

export const FENCE = new RegExp(`^([${PY_S_CLASS}]*)(\`{3,}|~{3,})(${PY_DOT}*)$`, "u");
const EXIT_LINE_RE = /^\[exit (\p{Nd}+)\]$/u;
const TICKET_LINE_RE = new RegExp(`^##[${PY_S_CLASS}]+Ticket[${PY_S_CLASS}]*$`, "u");
const PROFILE_LINE_RE = new RegExp(`^##[${PY_S_CLASS}]+Project profile[${PY_S_CLASS}]*$`, "u");
const HEAD_BREAK_RE = new RegExp(`^#{1,2}[${PY_S_CLASS}]`, "u");
const CLOSE_FENCE_RE = new RegExp(`^[${PY_S_CLASS}]*(\`{3,}|~{3,})[${PY_S_CLASS}]*$`, "u");
const BIN_NAME = /^[A-Za-z0-9@._+-]+$/u;
export const TIMEOUT = 60;

function notRun(msg: string): never {
  console.log(`not run: ${msg}`);
  process.exit(3);
  throw new Error("unreachable");
}

export function ticketLines(text: string): string[] {
  const lines = pySplitLines(text);
  const start = lines.findIndex((l) => TICKET_LINE_RE.test(l));
  if (start === -1) return lines;
  const end = lines.findIndex((l, i) => i > start && PROFILE_LINE_RE.test(l));
  return lines.slice(start + 1, end === -1 ? lines.length : end);
}

export function section(lines: string[], title: string): string[] | null {
  const re = new RegExp(`^##[${PY_S_CLASS}]+${literalI(title)}[${PY_S_CLASS}]*$`, "iu");
  const start = lines.findIndex((l) => re.test(l));
  if (start === -1) return null;
  const out: string[] = [];
  let fence: string | null = null;
  for (const l of lines.slice(start + 1)) {
    const m = FENCE.exec(l);
    if (fence === null && HEAD_BREAK_RE.test(l)) break;
    if (m && fence === null && !(m[2]?.[0] === "`" && m[3]?.includes("`"))) {
      fence = m[2]!;
    } else if (
      m &&
      fence !== null &&
      m[2]?.[0] === fence[0] &&
      m[2]?.length >= fence.length &&
      !m[3]?.trim()
    ) {
      fence = null;
    }
    out.push(l);
  }
  return out;
}

export function blocks(lines: string[]): string[][] {
  const out: string[][] = [];
  let i = 0;
  while (i < lines.length) {
    const m = FENCE.exec(lines[i]!);
    if (m && !(m[2]?.[0] === "`" && m[3]?.includes("`"))) {
      const indent = m[1]?.length;
      const fence = m[2]!;
      const body: string[] = [];
      i += 1;
      while (i < lines.length) {
        const c = CLOSE_FENCE_RE.exec(lines[i]!);
        if (c && c[1]?.[0] === fence[0] && c[1]?.length >= fence.length) break;
        body.push(lines[i]?.replace(new RegExp(`^ {0,${indent}}`, "u"), ""));
        i += 1;
      }
      out.push(body);
    }
    i += 1;
  }
  return out;
}

export function trim(lines: string[]): string[] {
  const out = lines.map(pyRstrip);
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out;
}

/** shlex.split in POSIX mode, as BASE splits a #! line: whitespace splits,
 * single and double quotes group, and a backslash quotes any next character
 * outside quotes (even a newline, which stays literal content); inside double
 * quotes only " and \ unescape, every other backslash stays. Unbalanced
 * quotes and a trailing backslash throw, as BASE's shlex raises. */
export function shlexSplit(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let has = false;
  let quote: string | null = null;
  const flush = (): void => {
    if (has) out.push(cur);
    cur = "";
    has = false;
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quote === "'") {
      if (c === "'") quote = null;
      else cur += c;
      continue;
    }
    if (c === "\\" && quote !== "'") {
      const n = s[i + 1];
      if (n === undefined) throw new Error("No escaped character");
      i++;
      if (quote === '"' && n !== '"' && n !== "\\") cur += `\\${n}`;
      else cur += n;
      has = true;
      continue;
    }
    if (quote === '"') {
      if (c === '"') quote = null;
      else cur += c;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      has = true;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r" || c === "\n") {
      flush();
      continue;
    }
    cur += c;
    has = true;
  }
  if (quote !== null) throw new Error("No closing quotation");
  flush();
  return out;
}

interface Cmd {
  cmd: string;
  out: string[];
  exit: number;
}

export function transcript(body: string[]): Cmd[] | null {
  const first = body.find((l) => l.trim());
  if (!first?.startsWith("$ ")) return null;
  const cmds: Array<{ cmd: string; out: string[] }> = [];
  for (const l of body) {
    if (l.startsWith("$ ")) {
      cmds.push({ cmd: l.slice(2).trim(), out: [] });
    } else if (cmds.length > 0) {
      cmds[cmds.length - 1]?.out.push(l);
    }
  }
  const result: Cmd[] = [];
  for (const c of cmds) {
    let out = trim(c.out);
    let exit = 0;
    if (out.length > 0) {
      const stripped = pyTrim(out[out.length - 1] ?? "");
      const m = EXIT_LINE_RE.exec(stripped);
      if (m) {
        exit = parseInt(digitValue(m[1]!), 10);
        out = trim(out.slice(0, -1));
      }
    }
    result.push({ cmd: c.cmd, out, exit });
  }
  return result;
}

export function exampleEnv(
  home: string,
  shims: string,
  runpath: string,
): Record<string, string | undefined> {
  return {
    ...process.env,
    HOME: home,
    PWD: home,
    NO_COLOR: "1",
    PATH: shims + delimiter + runpath,
    // Truly unset, as BASE's `env.pop` unsets it: run() merges over
    // process.env, so only an explicit undefined deletes the key.
    BASH_ENV: undefined,
  };
}
export function examples(wtArg: string, ticketArg: string, timeout = TIMEOUT): number {
  const wt = resolve(wtArg);
  let ticket = ticketArg;
  if (!ticket) {
    const spec = process.env.POSTMASTER_VERIFY || join(wt, ".postmaster", "verify");
    ticket = join(spec, "ticket.md");
  }
  let text: string;
  try {
    text = readFileSync(ticket, "utf8");
  } catch {
    notRun(`no ticket at ${ticket}; scripts/verify.sh arm copies the run's there`);
  }
  const journey = section(ticketLines(text!), "User journey");
  if (journey === null) {
    notRun("the ticket has no User journey, where a command-line app's example transcripts go");
  }
  const scripts = blocks(journey!)
    .map((b) => transcript(b))
    .filter((t): t is Cmd[] => t !== null);
  if (scripts.length === 0) {
    notRun(
      "the ticket's User journey has no example transcript: a fenced block whose first line starts with `$ `",
    );
  }

  const pkgFile = join(wt, "package.json");
  if (!existsSync(pkgFile)) {
    notRun(
      `no package.json in ${wt}, so no command to run the examples through; this default runs a package.json project's bin, so declare the check in .postmaster/project.toml`,
    );
  }
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(readFileSync(pkgFile, "utf8"));
  } catch (e) {
    notRun(`package.json does not parse: ${e instanceof Error ? e.message : String(e)}`);
  }
  const raw = pkg?.bin;
  let bins: Record<string, string> = {};
  if (typeof raw === "string") {
    const name =
      String(pkg?.name || "")
        .split("/")
        .pop() || "";
    if (name) bins = { [name]: raw };
  } else if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof k === "string" && typeof v === "string") bins[k] = v;
    }
  }
  if (Object.keys(bins).length === 0) {
    notRun("package.json names no bin, so no command to run the examples through");
  }
  for (const name of Object.keys(bins)) {
    if (!BIN_NAME.test(name) || name === "." || name === "..") {
      notRun(`package.json names a bin '${name}', which is not a plain command name`);
    }
  }
  const runpath = join(wt, "node_modules", ".bin") + delimiter + (process.env.PATH || "");

  const scriptsRaw = pkg?.scripts;
  if (
    scriptsRaw &&
    typeof scriptsRaw === "object" &&
    (scriptsRaw as Record<string, unknown>).build
  ) {
    const bun = existsSync(join(wt, "bun.lock")) || existsSync(join(wt, "bun.lockb"));
    const pm = existsSync(join(wt, "pnpm-lock.yaml"))
      ? "pnpm"
      : bun
        ? "bun"
        : existsSync(join(wt, "yarn.lock"))
          ? "yarn"
          : "npm";
    if (!which(pm, process.env.PATH || "")) {
      notRun(`package.json has a build script, run through ${pm}, which is not on PATH`);
    }
    const r = run(pm, ["run", "build"], { cwd: wt, input: "" });
    if (r.code !== 0) {
      console.log(r.out.trimEnd());
      console.log(`FAIL  the build failed: ${pm} run build exited ${r.code}`);
      return 1;
    }
  }

  // make shims
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "verify-examples-")));
  process.on("exit", () => {
    try {
      rmSync(scratch, { recursive: true, force: true });
    } catch {
      // cleanup is best-effort
    }
  });
  const shims = join(scratch, "bin");
  mkdirSync(shims);
  for (const [name, rel] of Object.entries(bins)) {
    const f = resolve(join(wt, rel));
    if (!existsSync(f)) {
      console.log(`FAIL  bin ${name} names ${rel}, which is not a file`);
      return 1;
    }
    const first = readFileSync(f, "utf8").split("\n")[0] ?? "";
    let argv: string[];
    if (first.startsWith("#!")) {
      argv = shlexSplit(first.slice(2).trim());
    } else if (f.endsWith(".js") || f.endsWith(".mjs") || f.endsWith(".cjs")) {
      argv = ["node"];
    } else {
      notRun(`cannot tell how to run bin ${name}: ${rel} has no #! line`);
    }
    let prog = argv[0] || "";
    if (basename(prog) === "env") {
      prog = argv.slice(1).find((a) => !a.startsWith("-") && !a.includes("=")) || "";
    }
    if (!prog || (prog.includes("/") ? !canExecute(prog) : !which(prog, runpath))) {
      notRun(`bin ${name} runs through ${prog || "an empty #! line"}, which is not on PATH`);
    }
    const shim = join(shims, name);
    writeFileSync(
      shim,
      `#!/bin/sh\nexec ${argv.map((a) => shQuote(a)).join(" ")} ${shQuote(f)} "$@"\n`,
    );
    chmodSync(shim, 0o755);
  }

  let failed = 0;
  let ran = 0;
  for (let n = 0; n < scripts.length; n++) {
    const cmds = scripts[n]!;
    const home = join(scratch, `block-${n + 1}`);
    mkdirSync(home);
    const env = exampleEnv(home, shims, runpath);
    for (const c of cmds) {
      ran += 1;
      const r = run("bash", ["-c", c.cmd], { cwd: home, env, input: "", timeout: timeout * 1000 });
      const got = r.timedOut
        ? [`(timed out after ${timeout}s)`]
        : trim((r.out + r.err).replace(/\r\n/gu, "\n").split("\n"));
      const code: number | null = r.timedOut ? null : r.code;
      if (JSON.stringify(got) === JSON.stringify(c.out) && code === c.exit) {
        console.log(`ok    $ ${c.cmd}`);
        continue;
      }
      failed += 1;
      console.log(`FAIL  $ ${c.cmd}`);
      if (JSON.stringify(got) !== JSON.stringify(c.out)) {
        console.log("      expected:");
        console.log(
          c.out
            .slice(0, 20)
            .map((l) => `        ${l}`)
            .join("\n") || "        (nothing)",
        );
        console.log("      got:");
        console.log(
          got
            .slice(0, 20)
            .map((l) => `        ${l}`)
            .join("\n") || "        (nothing)",
        );
      }
      if (code !== c.exit) {
        console.log(
          `      exit: expected ${c.exit}, got ${code === null ? "none, it timed out" : code}`,
        );
      }
    }
  }
  console.log(`${ran - failed} of ${ran} example commands did what the ticket says`);
  return failed ? 1 : 0;
}

function canExecute(p: string): boolean {
  try {
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** shutil.which: a runnable file named prog in one of path's directories. */
export function findInPath(prog: string, path: string): string | null {
  for (const dir of path.split(delimiter)) {
    if (!dir) continue;
    const f = join(dir, prog);
    try {
      if (statSync(f).isFile() && canExecute(f)) return f;
    } catch {
      // not in this directory
    }
  }
  return null;
}

function which(prog: string, path: string): boolean {
  return findInPath(prog, path) !== null;
}

function shQuote(s: string): string {
  return `'${s.replace(/'/gu, `'\\''`)}'`;
}

// --- entry -----------------------------------------------------------------------------------
const USAGE = "usage: verify-examples.sh [<worktree>] [--ticket <file>]";

function main(argv: string[]): number {
  let WT = ".";
  let TICKET = "";
  let i = 0;
  while (i < argv.length) {
    if (argv[i] === "--ticket") {
      if (argv.length < i + 2) die(USAGE, 1);
      TICKET = argv[i + 1] ?? "";
      i += 2;
    } else if (argv[i]?.startsWith("-")) {
      die(USAGE, 1);
    } else {
      WT = argv[i] ?? ".";
      i += 1;
    }
  }
  if (!existsSync(WT)) {
    console.error(`verify-examples: no such directory: ${WT}`);
    return 1;
  }
  return examples(WT, TICKET);
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
