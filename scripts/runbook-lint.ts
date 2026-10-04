// Keep executable runbook steps in the tested scripts. Only AGENTS.md and Markdown
// documents under skills/ are runbooks; README, wiki and fixture prose are not.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { toolRoot } from "./lib/paths.ts";

type Finding = Readonly<{ file: string; line: number; what: string; command: string }>;
type Fence = { marker: string; length: number; language: string; start: number; lines: string[] };

const SHELL_LANGUAGES = new Set(["sh", "bash", "zsh", "shell", "console"]);
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/u;
const SCRIPT_CALL = /^(?:<[^>]+>\/)*scripts\/run(?:[ \t]|$)/u;
const PLACEHOLDER = /<[^<>\n]+>/gu;

function asciiLower(value: string): string {
  return value.replace(/[A-Z]/gu, (letter) => String.fromCharCode(letter.charCodeAt(0) + 32));
}

function filesUnderSkills(root: string, dir = join(root, "skills")): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...filesUnderSkills(root, path));
    else if (entry.name.endsWith(".md")) {
      try {
        if (statSync(path).isFile()) files.push(path);
      } catch {
        // A broken link is not a Markdown document to scan.
      }
    }
  }
  return files;
}

function maskPlaceholders(value: string): string {
  return value.replace(PLACEHOLDER, (placeholder) => " ".repeat(placeholder.length));
}

function shellSyntax(value: string): string | null {
  const masked = maskPlaceholders(value);
  let quote: "'" | '"' | null = null;
  let escaped = false;
  let commandSubstitution = false;
  let variableExpansion = false;
  let controls = "";
  for (let i = 0; i < masked.length; i++) {
    const char = masked[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote === "'") {
      if (char === "'") quote = null;
      continue;
    }
    if (quote === '"') {
      if (char === '"') quote = null;
      else if (char === "`") commandSubstitution = true;
      else if (char === "$" && /[({A-Za-z0-9_@*#?$!-]/u.test(masked[i + 1] ?? "")) {
        if (masked[i + 1] === "(") commandSubstitution = true;
        else variableExpansion = true;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "`") commandSubstitution = true;
    else if (char === "$" && /[({A-Za-z0-9_@*#?$!-]/u.test(masked[i + 1] ?? "")) {
      if (masked[i + 1] === "(") commandSubstitution = true;
      else variableExpansion = true;
    }
    controls += char;
  }
  if (commandSubstitution) return "command substitution";
  if (variableExpansion) return "variable expansion";
  if (/^[ \t]*[A-Za-z_][A-Za-z0-9_]*=/u.test(masked)) return "variable assignment";
  if (/^[ \t]*(?:for|while|if|case|then|else|elif|fi|do|done|esac)(?![A-Za-z0-9_])/u.test(controls))
    return "loop or condition";
  if (/\|\||&&|;/u.test(controls)) return "command chain";
  if (/\|/u.test(controls)) return "pipe";
  if (/<<|2[ \t]*>&[ \t]*1|[<>]/u.test(controls)) return "redirection";
  if (controls.includes("&")) return "background command";
  return null;
}

function stripComment(line: string): string {
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if ((char === "'" || char === '"') && (quote === null || quote === char)) {
      quote = quote === null ? char : null;
      continue;
    }
    if (char === "#" && quote === null && (i === 0 || /[ \t]/u.test(line[i - 1]!)))
      return line.slice(0, i).trimEnd();
  }
  return line.trimEnd();
}

function commandAfterDoubleDash(command: string): string | null {
  // host run/spawn accept one command after --. A script call is allowed, as is
  // the documented placeholder for a harness's interactive form.
  const marker = command.indexOf(" -- ");
  if (marker < 0) return null;
  const tail = command.slice(marker + 4).trim();
  if (tail === "<interactive form>") return null;
  if (SCRIPT_CALL.test(tail)) return null;
  return "the command after -- is not a postmaster script call or <interactive form>";
}

function blockFinding(file: string, line: number, commandRaw: string): Finding | null {
  const command = stripComment(commandRaw).trim();
  if (command === "" || command.startsWith("#")) return null;
  const syntax = shellSyntax(command);
  if (syntax) return { file, line, what: syntax, command };
  if (!SCRIPT_CALL.test(command)) {
    return { file, line, what: "not a call to scripts/run", command };
  }
  const nested = commandAfterDoubleDash(command);
  return nested ? { file, line, what: nested, command } : null;
}

function logicalCommands(lines: readonly string[], firstLine: number): Array<[number, string]> {
  const commands: Array<[number, string]> = [];
  let pending = "";
  let start = firstLine;
  for (let i = 0; i < lines.length; i++) {
    const physical = lines[i] ?? "";
    if (pending === "" && (physical.trim() === "" || physical.trimStart().startsWith("#"))) {
      commands.push([firstLine + i, physical]);
      continue;
    }
    const trimmed = physical.trimEnd();
    const continues = trimmed.endsWith("\\");
    if (pending === "") start = firstLine + i;
    pending += `${pending === "" ? "" : " "}${continues ? trimmed.slice(0, -1).trim() : physical.trim()}`;
    if (!continues) {
      commands.push([start, pending]);
      pending = "";
    }
  }
  if (pending !== "") commands.push([start, pending]);
  return commands;
}

function isCommandSpan(span: string): boolean {
  const value = span.trim();
  if (value.startsWith("<gate>")) return true;
  if (SCRIPT_CALL.test(value)) return true;
  if (
    /^[A-Za-z_][A-Za-z0-9_]*=[^ \t]+[ \t]+[A-Za-z][A-Za-z0-9_.+-]*(?:[ \t]+[^ \t]+)*$/u.test(value)
  )
    return true;
  if (/^"\$[A-Za-z_][A-Za-z0-9_]*"[ \t]+[^ \t]/u.test(value)) return true;
  if (/^(?:<[^>]+>\/)+[A-Za-z][A-Za-z0-9_.-]*[ \t]+[^ \t]/u.test(value)) return true;
  // Inline command names are a single executable token followed by arguments.
  // Descriptive spans with syntax-like punctuation are rewritten at source when
  // ambiguous, as with the review decision counts.
  return /^[A-Za-z][A-Za-z0-9_.+-]*[ \t]+[^ \t]/u.test(value);
}

function inlineCodeSpans(line: string): string[] {
  const spans: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] !== "`") {
      i++;
      continue;
    }
    let length = 1;
    while (line[i + length] === "`") length++;
    let cursor = i + length;
    let found = false;
    while (cursor < line.length) {
      const next = line.indexOf("`", cursor);
      if (next < 0) break;
      let closeLength = 1;
      while (line[next + closeLength] === "`") closeLength++;
      if (closeLength === length) {
        spans.push(line.slice(i + length, next));
        i = next + closeLength;
        found = true;
        break;
      }
      cursor = next + closeLength;
    }
    if (!found) i += length;
  }
  return spans;
}

function scanInline(file: string, text: string, excludedLines: Set<number>): Finding[] {
  const findings: Finding[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (excludedLines.has(i + 1)) continue;
    const line = lines[i] ?? "";
    for (const content of inlineCodeSpans(line)) {
      if (!isCommandSpan(content)) continue;
      const syntax = shellSyntax(content);
      if (syntax) findings.push({ file, line: i + 1, what: syntax, command: content.trim() });
    }
  }
  return findings;
}

export function scanRunbook(file: string, text: string): Finding[] {
  const lines = text.split("\n");
  const findings: Finding[] = [];
  const fencedLines = new Set<number>();
  let fence: Fence | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const match = FENCE_OPEN.exec(line);
    if (match) {
      const token = match[1] ?? "";
      if (fence === null) {
        const language = asciiLower((match[2] ?? "").trim().split(/[ \t{]/u)[0] ?? "");
        fence = {
          marker: token[0] ?? "`",
          length: token.length,
          language,
          start: i + 2,
          lines: [],
        };
        if (SHELL_LANGUAGES.has(language)) fencedLines.add(i + 1);
      } else if (token[0] === fence.marker && token.length >= fence.length) {
        if (SHELL_LANGUAGES.has(fence.language)) {
          fencedLines.add(i + 1);
          for (const [lineNumber, command] of logicalCommands(fence.lines, fence.start)) {
            const finding = blockFinding(file, lineNumber, command);
            if (finding) findings.push(finding);
          }
        }
        fence = null;
      } else {
        if (SHELL_LANGUAGES.has(fence.language)) {
          fencedLines.add(i + 1);
          fence.lines.push(line);
        }
      }
      continue;
    }
    if (fence !== null) {
      if (SHELL_LANGUAGES.has(fence.language)) {
        fencedLines.add(i + 1);
        fence.lines.push(line);
      }
    }
  }
  if (fence !== null && SHELL_LANGUAGES.has(fence.language)) {
    for (const [lineNumber, command] of logicalCommands(fence.lines, fence.start)) {
      const finding = blockFinding(file, lineNumber, command);
      if (finding) findings.push(finding);
    }
  }
  findings.push(...scanInline(file, text, fencedLines));
  return findings;
}

export function runbookFiles(root: string): string[] {
  const agents = join(root, "AGENTS.md");
  const files = [agents, ...filesUnderSkills(root)].filter((path) => {
    try {
      return statSync(path).isFile();
    } catch {
      return false;
    }
  });
  return files.toSorted((left, right) => left.localeCompare(right));
}

export function lintRunbooks(root: string): Finding[] {
  return runbookFiles(root).flatMap((path) => {
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch (error) {
      return [
        {
          file: relative(root, path),
          line: 1,
          what: `cannot read runbook: ${String(error)}`,
          command: path,
        },
      ];
    }
    return scanRunbook(relative(root, path), text);
  });
}

export function formatFinding(finding: Finding): string {
  return `${finding.file}:${finding.line}: ${finding.what}: ${finding.command.replace(/\n/gu, " ")}`;
}

export function runCheck(root: string, print: (line: string) => void = console.log): number {
  const findings = lintRunbooks(root);
  for (const finding of findings) print(formatFinding(finding));
  return findings.length === 0 ? 0 : 1;
}

if (import.meta.main) {
  process.exit(runCheck(toolRoot(import.meta)));
}
