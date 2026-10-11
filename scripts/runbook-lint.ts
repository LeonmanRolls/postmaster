// The gate's check that the runbooks hold no code. A runbook is a document agents follow:
// AGENTS.md at the repository root (CLAUDE.md is a link to it) and every .md under skills/,
// and nothing else. Each step an agent runs from a runbook is one call to a postmaster script,
// one to a line, and a command in the text holds no shell syntax, so the linter can read every
// line and an agent copies nothing untested.
//
//   scripts/run runbook-lint [--root <dir>] [<file>...]
//                                     default: AGENTS.md and every .md under <dir>'s skills/,
//                                     the root being the checkout this script lives in
//
// A block fenced sh, bash, zsh, shell or console holds steps. Its lines, continuations
// joined, are blank, a # comment, or one call whose program is scripts/run: bare in
// AGENTS.md, else under a checkout placeholder such as <tool>/. A block in another language
// or none is a template or a format, and its lines are read like the text.
//
// A text command is an inline code span that starts with a script path, a placeholder for a
// command followed by an argument, or a program name followed by an argument; a value, path,
// format or entity is not one. Where a span cannot be told from a command, the runbook
// rewords it. Shell syntax is refused everywhere: variables, substitutions, pipes,
// redirections, chains of commands, backgrounding, loops and conditions. Placeholders in
// angle brackets (<yes|no>), quotes, optional arguments in square brackets, a trailing #
// comment, and a -- followed by a script call or a placeholder are part of a call,
// not shell syntax.
//
//   exit 0  no faults
//   exit 1  faults, one per line on stdout: <file>:<line>: <what was found>: <the command>
//   exit 2  usage, or a file that cannot be read
import { readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { toolRoot } from "./lib/paths.ts";

const STEP_LANGS = new Set(["sh", "bash", "zsh", "shell", "console"]);
const KEYWORDS = ["for", "while", "until", "if", "case"];

export interface Fault {
  file: string;
  line: number;
  what: string;
  ref: string;
}

/** runbookFiles <root> — the documents agents follow, as paths relative to the root. */
export function runbookFiles(root: string): string[] {
  const files: string[] = [];
  const agents = join(root, "AGENTS.md");
  try {
    if (statSync(agents).isFile()) files.push("AGENTS.md");
  } catch {
    // no AGENTS.md: the skills still stand alone
  }
  const skills: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries.sort()) {
      const path = join(dir, name);
      const rel = prefix === "" ? name : `${prefix}/${name}`;
      let isDir = false;
      try {
        isDir = statSync(path).isDirectory();
      } catch {
        continue;
      }
      if (isDir) walk(path, rel);
      else if (name.endsWith(".md")) skills.push(rel);
    }
  };
  walk(join(root, "skills"), "skills");
  return [...files, ...skills];
}

interface Finding {
  kind: string;
  pos: number;
}

/**
 * shellSyntax <line> — the shell syntax a line holds, by its leftmost occurrence, or null.
 * Quoted regions, angle-bracket placeholders and # comments hold no syntax, except that $
 * and backticks inside double quotes are substitutions and variables, as the shell reads them.
 */
export function shellSyntax(raw: string): Finding | null {
  const finds: Finding[] = [];
  const add = (kind: string, pos: number): void => {
    finds.push({ kind, pos });
  };
  // An angle-bracket placeholder is one token, however it is punctuated inside: it holds no
  // shell syntax, and it is blanked at its own length so every later position still lines up.
  const src = raw.replace(/<[A-Za-z0-9][^<>]*>/gu, (m) => " ".repeat(m.length));
  const prevToken = (pos: number): string =>
    /([^ \t\n\r\f\v]+)[ \t\n\r\f\v]*$/u.exec(src.slice(0, pos))?.[1] ?? "";
  let i = 0;
  let state: "code" | "single" | "double" = "code";
  while (i < src.length) {
    const c = src[i] ?? "";
    if (state === "single") {
      if (c === "'") state = "code";
      i += 1;
      continue;
    }
    if (state === "double") {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === '"') {
        state = "code";
        i += 1;
        continue;
      }
      if (c === "`") {
        add("command substitution", i);
        i += 1;
        continue;
      }
      if (c === "$") {
        add(src[i + 1] === "(" ? "command substitution" : "variable", i);
        i += 1;
        continue;
      }
      i += 1;
      continue;
    }
    if (c === "'") {
      state = "single";
      i += 1;
      continue;
    }
    if (c === '"') {
      state = "double";
      i += 1;
      continue;
    }
    if (c === "<") {
      add("redirection", i);
      i += 1;
      continue;
    }
    if (c === ">") {
      add("redirection", i);
      i += 1;
      continue;
    }
    if (c === "&") {
      add(src[i + 1] === "&" ? "chain" : "background", i);
      i += 1;
      continue;
    }
    if (c === "|") {
      add(src[i + 1] === "|" ? "chain" : "pipe", i);
      i += 1;
      continue;
    }
    if (c === ";") {
      add("chain", i);
      i += 1;
      continue;
    }
    if (c === "`") {
      add("command substitution", i);
      i += 1;
      continue;
    }
    if (c === "$") {
      add(src[i + 1] === "(" ? "command substitution" : "variable", i);
      i += 1;
      continue;
    }
    if (c === "#" && (i === 0 || /[ \t\n\r\f\v]/u.test(src[i - 1] ?? ""))) break;
    if (/[A-Za-z_]/u.test(c) && (i === 0 || /[ \t\n\r\f\v;&|()<>]/u.test(src[i - 1] ?? ""))) {
      const word = /^[A-Za-z_][A-Za-z0-9_-]*/u.exec(src.slice(i))?.[0] ?? "";
      if (KEYWORDS.includes(word)) add("loop or condition", i);
      if (src[i + word.length] === "=") {
        const prev = prevToken(i);
        const flag = /^--?[A-Za-z0-9]/u.test(prev);
        if (!flag) add("variable", i);
      }
    }
    i += 1;
  }
  if (finds.length === 0) return null;
  finds.sort((a, b) => a.pos - b.pos);
  return finds[0] ?? null;
}

interface Segment {
  kind: "text" | "step" | "format";
  start: number; // 1-based line of the segment's first line
  lines: string[];
}

/** Split a document into text, step blocks (fenced sh-family) and other fenced blocks. */
function segments(text: string): Segment[] {
  const lines = text.split("\n");
  const out: Segment[] = [];
  let mode: "text" | "step" | "format" = "text";
  let buf: string[] = [];
  let start = 1;
  let fence = "";
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n] ?? "";
    const close = /^[ \t]*(`{3,}|~{3,})[ \t]*$/u.exec(line);
    if (mode === "text") {
      const open = /^([ \t]*)(`{3,}|~{3,})(.*)$/u.exec(line);
      if (open) {
        if (buf.length > 0) out.push({ kind: "text", start, lines: buf });
        buf = [];
        fence = open[2] ?? "";
        const info = (open[3] ?? "").trim().split(/[ \t\n\r\f\v]+/u)[0] ?? "";
        mode = STEP_LANGS.has(info) ? "step" : "format";
        start = n + 2;
        continue;
      }
      buf.push(line);
      continue;
    }
    if (
      close &&
      (close[1] ?? "").startsWith(fence[0] ?? "`") &&
      (close[1] ?? "").length >= fence.length
    ) {
      out.push({ kind: mode, start, lines: buf });
      buf = [];
      mode = "text";
      start = n + 2;
      continue;
    }
    buf.push(line);
  }
  if (buf.length > 0) out.push({ kind: mode, start, lines: buf });
  return out;
}

/** A step line: continuations joined, reported at its first physical line. */
function stepLines(lines: string[], start: number): Array<{ line: number; text: string }> {
  const out: Array<{ line: number; text: string }> = [];
  let i = 0;
  while (i < lines.length) {
    const first = start + i;
    let text = lines[i] ?? "";
    while (text.endsWith("\\") && i + 1 < lines.length) {
      i += 1;
      text = `${text.slice(0, -1)}${lines[i] ?? ""}`;
    }
    out.push({ line: first, text });
    i += 1;
  }
  return out;
}

/** One scripts/run call: bare in AGENTS.md, else under a checkout placeholder. */
function callProgram(text: string, agents: boolean): "ok" | "bare" | "no" {
  const line = text.trim();
  if (/^scripts\/run(?=$|[ \t])/u.test(line)) return agents ? "ok" : "bare";
  if (/^<[^<>]+>\/scripts\/run(?=$|[ \t])/u.test(line)) return "ok";
  return "no";
}

/** A command in the text: a script path, a command placeholder with an argument, or a program with an argument. */
function isCommand(content: string): boolean {
  const c = content.trim();
  if (c === "") return false;
  if (/^(?:<[^<>]+>\/)?scripts\//u.test(c)) return true;
  if (/^<[A-Za-z][^<>]*>[ \t\n\r\f\v]+[^ \t\n\r\f\v]/u.test(c)) return true;
  if (/^[A-Za-z][A-Za-z0-9._-]*[ \t\n\r\f\v]+[^ \t\n\r\f\v]/u.test(c)) return true;
  // an assignment carries a command only when one follows it; alone it is a value
  if (/^[A-Za-z_][A-Za-z0-9_]*=[^ \t\n\r\f\v]*[ \t\n\r\f\v]+[^ \t\n\r\f\v]/u.test(c)) return true;
  return false;
}

function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === "\n") line += 1;
  return line;
}

function collapse(s: string): string {
  return s.trim().replace(/[ \t\n\r\f\v]+/gu, " ");
}

/** The command after " -- ", outside quotes and placeholders; "" when "--" dangles. */
function doubleDashTail(line: string): string | null {
  let quote: string | null = null;
  let i = 0;
  while (i < line.length) {
    const c = line[i] ?? "";
    if (quote !== null) {
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      i += 1;
      continue;
    }
    if (c === "<") {
      const close = line.indexOf(">", i + 1);
      i = close > i ? close + 1 : i + 1;
      continue;
    }
    if (c === "#" && (i === 0 || line[i - 1] === " " || line[i - 1] === "\t")) return null;
    if (line.startsWith(" -- ", i) || (line.startsWith(" --", i) && i + 3 === line.length)) {
      return line.slice(i + 4).trim();
    }
    i += 1;
  }
  return null;
}

/** codeFaults <file> <text> — every fault the check finds in one document. */
export function codeFaults(file: string, text: string): Fault[] {
  const faults: Fault[] = [];
  // The bare-call exception is the root file only: a nested AGENTS.md is a
  // skill document, and skill paths go through <tool>/.
  const agents = file === "AGENTS.md";
  const ref = (s: string): string => collapse(s);
  for (const seg of segments(text)) {
    if (seg.kind === "step") {
      for (const step of stepLines(seg.lines, seg.start)) {
        const body = step.text.trim();
        if (body === "" || body.startsWith("#")) continue;
        const syntax = shellSyntax(step.text);
        if (syntax) {
          faults.push({ file, line: step.line, what: syntax.kind, ref: ref(step.text) });
          continue;
        }
        const program = callProgram(step.text, agents);
        if (program === "no") {
          faults.push({
            file,
            line: step.line,
            what: "not a scripts/run call",
            ref: ref(step.text),
          });
        } else if (program === "bare") {
          faults.push({ file, line: step.line, what: "bare scripts/run", ref: ref(step.text) });
        } else {
          const tail = doubleDashTail(step.text);
          // A quoted program quotes a path holding spaces; the call is the same.
          const unquoted = tail === null ? null : tail.replace(/^"([^"]+)"(?=$|[ \t])/u, "$1");
          const tailProgram = unquoted === null ? "ok" : callProgram(unquoted, agents);
          const tailOk = unquoted === null || tailProgram === "ok" || /^<[^<>]+>$/u.test(unquoted);
          if (!tailOk) {
            let what = "not a scripts/run call after --";
            if (unquoted === "") what = "double dash without a command";
            else if (tailProgram === "bare") what = "bare scripts/run after --";
            faults.push({ file, line: step.line, what, ref: ref(step.text) });
          }
        }
      }
      continue;
    }
    const body = seg.lines.join("\n");
    for (const m of body.matchAll(/(`+)(.+?)\1(?!`)/gsu)) {
      const content = (m[2] ?? "").trim();
      if (!isCommand(content)) continue;
      const syntax = shellSyntax(content);
      if (!syntax) continue;
      faults.push({
        file,
        line: seg.start + lineAt(body, m.index ?? 0) - 1,
        what: syntax.kind,
        ref: ref(content),
      });
    }
  }
  return faults;
}

/** runbookLint <root> [<file>...] — faults over the runbooks, or the files given. */
export function runbookLint(root: string, files?: string[]): { faults: Fault[]; code: number } {
  const explicit = files && files.length > 0;
  const names = explicit ? files : runbookFiles(root);
  const faults: Fault[] = [];
  for (const name of names) {
    const path = explicit ? name : join(root, name);
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`runbook-lint: cannot read ${path}: ${msg}\n`);
      return { faults, code: 2 };
    }
    const logic = explicit && isAbsolute(path) ? relative(root, resolve(path)) : name;
    faults.push(...codeFaults(logic, text).map((f) => ({ ...f, file: name })));
  }
  return { faults, code: faults.length > 0 ? 1 : 0 };
}

// --- entry -----------------------------------------------------------------------------------
if (import.meta.main) {
  let argv = process.argv.slice(2);
  let root = toolRoot(import.meta);
  if (argv[0] === "--root") {
    if (argv[1] === undefined) {
      process.stderr.write("usage: scripts/run runbook-lint [--root <dir>] [<file>...]\n");
      process.exit(2);
    }
    root = argv[1];
    argv = argv.slice(2);
  }
  if (argv[0]?.startsWith("-")) {
    process.stderr.write("usage: scripts/run runbook-lint [--root <dir>] [<file>...]\n");
    process.exit(2);
  }
  const { faults, code } = runbookLint(root, argv.length > 0 ? argv : undefined);
  for (const f of faults) console.log(`${f.file}:${f.line}: ${f.what}: ${f.ref}`);
  process.exit(code);
}
