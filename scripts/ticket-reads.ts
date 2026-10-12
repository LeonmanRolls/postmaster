// Look through every agent's record for a read of the run's ticket text,
// after a run without the notes merges.
//
//   run ticket-reads <dispatch> [--record]
//
// The agents are the manifest's coachman legs and workhorse lanes, and the
// reviewers its review-launch lines name. Each leg reads with its own harness
// where team.coachman_legs names one, and with the attempt role's harness
// where takeovers happened, and a walled leg's renamed streams read beside
// its fresh one. Each agent's record is its event stream in <dispatch>/logs/,
// read with the per-harness tool-call reader the reach control shares, plus
// a claude lane's fork transcripts beside it. A stream-shaped record the
// inventory never names reads as unknown. The check classifies executed tool
// calls, never prose: brief and prompt text sits in the same records and
// names the same read forms.
//
// What counts as a read of the text, by tracker kind. GitHub: gh issue view
// printing the body or comments; gh api on repos/<owner>/<repo>/issues/<n>
// or its comments with a reading method; a PATCH on the issue resource,
// which returns the issue with its body; gh api graphql naming the issue in
// the run's repository; scripts/run github <repo> read <n>; a fetch of the
// issue's web address or its API address; and a fetch POSTing a query for
// the issue to the graphql endpoint. Local: scripts/run local <repo> read
// <n>, and a read of the ticket's file in the store under
// <git-common-dir>/postmaster/tickets/. Any kind: a read of
// .postmaster/clerk/<n>.md in the project. A read of the title or state
// alone is named and is not a read of the text.
//
// What counts as unknown, never clean. A record that is missing or cannot be
// read, a run whose run.json cannot be read, a harness with no reader, a
// tracker of a kind beyond github and local, attempts that cannot be read or
// span roles, and a command that names the ticket in a form the check does
// not know: another gh issue verb beyond comment, close and reopen, a
// listing or search that can print bodies without naming the ticket, an
// adapter search or a verb the adapters do not have, another issues subpath,
// a --json field beyond title and state, a listing of the ticket file, a
// search across the ticket store, a graphql query whose repository cannot be
// told, a ticket position holding a variable, a ticket path joined to a live
// substitution, a query POSTed from a data file, a relative path after a
// cd the check cannot follow, a structured tool input naming the ticket, a
// codex command that started without completing, a codex web search naming
// the ticket, and a bare shell reading stdin. Known writes and mutating api
// calls show no ticket text and count for nothing, except a PATCH on the
// issue resource, which returns it. A failed single-segment command shows
// no text and counts for nothing when it read atomically: one file operand
// at most, and never a scan; diff prints the differing lines while exiting
// 1, while any other diff exit, like cmp and comm failing, shows nothing,
// and a failure proves nothing about one segment of several, so those
// classify by invocation. Where the record carries no exit, the invocation
// counts. Only the run's own ticket in its own tracker
// counts: another number, another repo and the wrong tracker are ignored,
// and so is a number in a command that reads nothing. The thread exports in
// <dispatch>/sessions/ are the same threads in harness-native form and are
// not read. Segments split on newlines as well as shell separators; (...)
// groups, cd and command substitutions are followed, and find and xargs
// scans of the ticket directories read as unknown, since their -exec is not
// followed. A heredoc body fed to a shell on stdin runs as shell and is
// classified as commands; any other heredoc body is data and is dropped.
// Above every named form sits the unplaced rule: a segment carrying
// any marker of this run's own ticket — its number, its clerk or store path,
// the tracker's host, or a read-capable gh or adapter call with a target —
// and placed as none of a text read, a title read, a known write, or another
// ticket, repo or tracker, reads unknown, never not read, so a spelling the
// check has never seen stops being taken for harmless. A substitution's text
// is its body's, not its outer segment's; the run's own record path, ticket
// worktree and file:line suffixes are not markers: they name the run and its
// lines, not the ticket's text.
//
//   exit 0  the check ran; stdout holds the outcome line first:
//           ticket-reads: not read | read by <agent> (<form>) | unknown (<reason>)
//           with title reads and unknown caveats appended. A given run prints
//           not checked and records nothing.
//   exit 1  usage, the dispatch is not a directory, or --record could not write
//
// With --record the outcome line goes to run-log.md and a note action, the
// way the run's log records whether the notes stayed away.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve, sep } from "node:path";
import { briefSection, profileRepo } from "./lib/brief.ts";
import { tryJsonFile } from "./lib/data.ts";
import { physical, toolRoot } from "./lib/paths.ts";
import { run } from "./lib/proc.ts";
import { ticketNotes } from "./lib/ticket-notes.ts";
import {
  WRITE_NAME_RE,
  claudeTaskPrefix,
  inputCommand,
  inputPath,
  parseEventFile,
  rec,
  text,
  toolCallsFromEvents,
  type Harness,
  type RecordOf,
  type ToolCall,
} from "./lib/tool-calls.ts";

const TOOL = toolRoot(import.meta);
const RUN = join(TOOL, "scripts", "run");

const KNOWN_HARNESSES = ["codex", "claude", "muse", "mimo", "pi"];
const TITLE_FIELDS = new Set(["title", "state", "number", "id", "url"]);
const TEXT_FIELD_RE = /body|comment/iu;
const READ_VERBS = new Set([
  "cat",
  "bat",
  "less",
  "more",
  "most",
  "head",
  "tail",
  "grep",
  "egrep",
  "fgrep",
  "rg",
  "ag",
  "ack",
  "sed",
  "awk",
  "gawk",
  "mawk",
  "strings",
  "xxd",
  "od",
  "hexdump",
  "jq",
  "yq",
  "cut",
  "sort",
  "uniq",
  "wc",
  "tac",
  "nl",
  "fold",
  "tr",
  "comm",
  "diff",
  "cmp",
  "view",
]);
const FETCH_VERBS = new Set([
  "curl",
  "wget",
  "http",
  "https",
  "fetch",
  "aria2c",
  "open",
  "xdg-open",
]);
const SHELL_WRAPPERS = new Set(["bash", "sh", "dash", "zsh", "eval"]);
/** Shells that read stdin when bare: a bare one executes what it is fed. */
const SHELLS = new Set(["bash", "sh", "dash", "zsh"]);
/** Verbs that can walk a directory and run a reader over it, unseen. */
const SCAN_VERBS = new Set(["find", "fd", "fdfind", "xargs"]);

type Kind = "github" | "local";

interface Ctx {
  ticket: string;
  kind: Kind;
  /** owner/repo lowercase, github only; null when the origin cannot be read. */
  nwo: string | null;
  repo: string;
  /** The run's worktree prefix, for adapter repo arguments. */
  ticketPrefix: string;
  /** The ticket store, local only; null when git cannot say. */
  storeDir: string | null;
  clerkDir: string;
}

interface Finding {
  agent: string;
  finding: "read" | "title" | "unknown";
  /** The named form, or the unknown reason. */
  form: string;
  detail: string;
}

/**
 * One classifier's answer: a finding, a positively placed non-read (a known
 * write, another ticket, repo or tracker), or nothing unrecognized.
 */
type Placed = Finding | "placed" | null;

/** What one segment or command yielded: findings, and whether it placed clean. */
interface Placement {
  findings: Finding[];
  placed: boolean;
}

interface Agent {
  name: string;
  file: string;
  harness: string;
  lane: string;
  own: string;
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function readJson(path: string): RecordOf | null {
  return tryJsonFile<RecordOf>(path);
}

/** A ticket number token: split on shell punctuation, never on dots, so 1.409 stays one token. */
function hasNumberToken(segment: string, ticket: string): boolean {
  return segment.split(/[\s;&|()<>=:,"'`#]+/u).some((token) => token === ticket); // ASCII: shell words split on ASCII whitespace and metacharacters
}

/** A shell word that is a bare variable: its value cannot be told. */
function isVar(word: string): boolean {
  return /^\$([{(]?[A-Za-z_]|[@*#?$!0-9])/u.test(stripQuotes(word));
}

function stripQuotes(value: string): string {
  return value.replace(/^['"]+/u, "").replace(/['"]+$/u, "");
}

/** Whether the char at i is backslash-escaped: an odd run of backslashes before it. */
function isEscaped(text: string, i: number): boolean {
  let slashes = 0;
  let j = i - 1;
  while (j >= 0 && text[j] === "\\") {
    slashes++;
    j--;
  }
  return slashes % 2 === 1;
}

/** Join shell words from i while an opening quote stays open. */
function quotedValue(words: string[], i: number): string {
  let value = words[i] ?? "";
  const quote = value[0];
  if ((quote === '"' || quote === "'") && !value.endsWith(quote)) {
    for (let j = i + 1; j < words.length; j++) {
      value += ` ${words[j]}`;
      if (words[j]!.endsWith(quote)) break;
    }
  }
  return stripQuotes(value);
}

function unwrapCodex(command: string): string {
  const wrapped = /^\/bin\/bash\s+-([A-Za-z]*c[A-Za-z]*)\s*(['"])/u.exec(command); // ASCII: the codex wrapper is machine-made
  if (!wrapped) return command;
  const quote = wrapped[2]!;
  const inner = command.slice(wrapped[0].length);
  return inner.endsWith(quote) ? inner.slice(0, -1) : inner;
}

/**
 * The command with heredoc bodies dropped: a <<EOF body is text being
 * written, not commands being run.
 */
function dropHeredocs(command: string): string {
  const lines = unwrapCodex(command).split("\n");
  const kept: string[] = [];
  let terminator: string | null = null;
  for (const line of lines) {
    if (terminator !== null) {
      if (line.trim() === terminator) terminator = null;
      continue;
    }
    const opener = heredocOpener(line);
    if (!opener) {
      kept.push(line);
      continue;
    }
    // A body fed to a shell on stdin runs as shell: keep its lines as
    // commands, with the fed shell neutralized — its stdin is the kept
    // body, already classified, not an unknown.
    const runs = heredocRunRest(line, opener);
    if (runs !== null) {
      if (runs.trim()) kept.push(runs);
      continue;
    }
    terminator = opener.word;
    // The operator goes, the rest of the line stays: redirection and later
    // commands on the same line still run.
    const rest = `${line.slice(0, opener.at)} ${line.slice(opener.end)}`;
    if (rest.trim()) kept.push(rest);
  }
  return kept.join("\n");
}

/** Split on single pipes; || stays whole, quoted pipes stay literal. */
function pipeCells(text: string): string[] {
  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "|" && text[i + 1] !== "|" && text[i - 1] !== "|" && !inQuotes(text, i)) {
      cells.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}

/** A shell invocation reading stdin: bare, -s, or flags alone, never -c or a script. */
function stdinShell(head: Head): boolean {
  if (!SHELLS.has(head.verb)) return false;
  let dashdash = false;
  let sawS = false;
  for (const raw of head.words.slice(head.at + 1)) {
    const word = stripQuotes(raw);
    if (!dashdash && word === "--") {
      dashdash = true;
      continue;
    }
    if (word === "-") continue;
    if (!dashdash && /^-[^-]/u.test(word)) {
      // A -c shell runs its string, never its stdin.
      if (word === "-c" || /^-[A-Za-z]*c($|['"])/u.test(word)) return false;
      if (word.includes("s")) sawS = true;
      continue;
    }
    // -s forces stdin; its positionals become $0, not a script.
    if (sawS) continue;
    return false;
  }
  return true;
}

/**
 * The opener line with its stdin shell neutralized, when the heredoc body
 * runs as shell: the line's own verb, or a shell later in its pipeline,
 * reads the body. Null when the body is data.
 */
function heredocRunRest(line: string, opener: { at: number; end: number }): string | null {
  const rest = `${line.slice(0, opener.at)} ${line.slice(opener.end)}`;
  const cells = pipeCells(rest);
  for (let i = 0; i < cells.length; i++) {
    if (stdinShell(segmentHead(cells[i]!))) {
      cells[i] = ":";
      return cells.join(" | ");
    }
  }
  return null;
}

/** Whether the offset sits inside single or double quotes. */
function inQuotes(line: string, at: number): boolean {
  let quote: string | null = null;
  for (let i = 0; i < at; i++) {
    const char = line[i]!;
    if (quote !== null) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    }
  }
  return quote !== null;
}

/** A heredoc operator outside quotes: its offset, end, and delimiter word. */
function heredocOpener(line: string): { at: number; end: number; word: string } | null {
  const pattern = /<<-?[ \t]*['"]?([A-Za-z0-9_]+)['"]?/gu; // ASCII: heredoc operators are ASCII
  for (const match of line.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > 0 && line[at - 1] === "<") continue; // a here-string, not a heredoc
    if (inQuotes(line, at)) continue;
    const before = line.slice(0, at);
    const opens = (before.match(/\$\(/gu) ?? []).length + (before.match(/\(\(/gu) ?? []).length;
    const closes = (before.match(/\)/gu) ?? []).length;
    if (opens > closes) continue; // inside $(( )) arithmetic or a substitution
    return { at, end: at + match[0].length, word: match[1]! };
  }
  return null;
}

/**
 * A command's pipeline segments, split outside quotes and backquotes, with
 * heredoc bodies dropped. Newlines split like any other separator: a read on
 * a later line of a multi-line command is still a read.
 */
function splitSegments(command: string): string[] {
  const segments: string[] = [];
  let current = "";
  let quote: string | null = null;
  const flat = dropHeredocs(command);
  for (const char of flat) {
    if (quote !== null) {
      current += char;
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'" || char === "`") {
      quote = char;
      current += char;
    } else if (
      char === ";" ||
      char === "|" ||
      char === "&" ||
      char === "(" ||
      char === ")" ||
      char === "\n"
    ) {
      if (current.trim()) segments.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) segments.push(current);
  return segments;
}

interface CommandPart {
  /** A plain segment, or the inner text of a top-level (...) group. */
  kind: "segment" | "subshell";
  text: string;
}

/**
 * A segment glued to a substitution's paren reads dynamic: its first word
 * continues the group's value, so a leading slash is not a filesystem root.
 * The $ marks it for touchPath, which cannot tell such a path.
 */
const GLUED_MARKER = "$DYNAMIC";

/** A ticket directory named anywhere in the word. */
const TICKET_DIR_RE = /postmaster\/tickets|\.postmaster\/clerk/u; // ASCII: ticket paths are ASCII

/** Shell words: split on whitespace outside quotes, backquotes and $( ). */
function splitWords(text: string): string[] {
  const words: string[] = [];
  let current = "";
  let quote: string | null = null;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quote !== null) {
      current += char;
      if (char === quote && !isEscaped(text, i)) quote = null;
    } else if (char === '"' || char === "'" || char === "`") {
      if (!isEscaped(text, i)) quote = char;
      current += char;
    } else if (
      char === "$" &&
      (text[i + 1] === "(" || text[i + 1] === "{") &&
      !isEscaped(text, i)
    ) {
      depth++;
      current += char;
    } else if ((char === ")" || char === "}") && depth > 0) {
      depth--;
      current += char;
    } else if (char === " " || char === "\t" || char === "\n" || char === "\r") {
      if (depth === 0) {
        if (current !== "") {
          words.push(current);
          current = "";
        }
      } else {
        current += char;
      }
    } else {
      current += char;
    }
  }
  if (current !== "") words.push(current);
  return words;
}

/** A ticket path joined to a live substitution: one word holds both. */
function dynamicPath(segment: string): boolean {
  return splitWords(segment).some((word) => hasDynamic(word) && TICKET_DIR_RE.test(word));
}

/** An unescaped substitution or expansion marker outside single quotes. */
function hasDynamic(segment: string): boolean {
  let single = false;
  for (let i = 0; i < segment.length; i++) {
    const char = segment[i]!;
    if (single) {
      if (char === "'") single = false;
      continue;
    }
    if (char === "'") {
      single = true;
      continue;
    }
    if (char === "`" && !isEscaped(segment, i)) return true;
    if (char === "$" && !isEscaped(segment, i)) {
      const next = segment[i + 1];
      if (next === "(" || next === "{") return true;
    }
  }
  return false;
}

/**
 * A command's parts in order: plain segments split as splitSegments splits
 * them, with each top-level (...) group as its own subshell part, so a cd
 * inside one never leaks out. A $( group is a substitution, not a subshell,
 * but its inner text is shell code either way and reads the same.
 */
function splitParts(command: string): CommandPart[] {
  const parts: CommandPart[] = [];
  let current = "";
  let quote: string | null = null;
  let depth = 0;
  let group = "";
  let groupQuote: string | null = null;
  const pushCurrent = (): void => {
    if (current.trim()) parts.push({ kind: "segment", text: current });
    current = "";
  };
  const flat = dropHeredocs(command);
  let glued = false;
  let groupSubst = false;
  for (let i = 0; i < flat.length; i++) {
    const char = flat[i]!;
    if (depth > 0) {
      if (groupQuote !== null) {
        group += char;
        if (char === groupQuote) groupQuote = null;
      } else if (char === '"' || char === "'" || char === "`") {
        groupQuote = char;
        group += char;
      } else if (char === "(") {
        depth++;
        group += char;
      } else if (char === ")") {
        depth--;
        if (depth === 0) {
          parts.push({ kind: "subshell", text: group });
          group = "";
          glued = groupSubst;
        } else {
          group += char;
        }
      } else {
        group += char;
      }
      continue;
    }
    if (quote !== null) {
      current += char;
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'" || char === "`") {
      quote = char;
      current += char;
      glued = false;
    } else if (char === "(") {
      // An escaped \$ is literal text, not a substitution.
      if (current.endsWith("$") && isEscaped(flat, i - 1)) {
        current += char;
      } else {
        groupSubst = current.endsWith("$");
        if (current.endsWith("$")) current = current.slice(0, -1);
        pushCurrent();
        depth = 1;
      }
      glued = false;
    } else if (char === ")") {
      pushCurrent();
      glued = false;
    } else if (char === ";" || char === "|" || char === "&" || char === "\n") {
      pushCurrent();
      glued = false;
    } else if (char === " " || char === "\t" || char === "\r") {
      current += char;
      glued = false;
    } else {
      if (glued && current === "") current = GLUED_MARKER;
      current += char;
      glued = false;
    }
  }
  if (depth > 0) {
    // Unbalanced: the group never closed, so read it as plain segments.
    pushCurrent();
    for (const segment of splitSegments(group)) parts.push({ kind: "segment", text: segment });
  } else {
    pushCurrent();
  }
  return parts;
}

/** The body of a $( group starting after its paren, and where it ends. */
function balancedBody(text: string, start: number): [string, number] {
  let quote: string | null = null;
  let depth = 1;
  let i = start;
  while (i < text.length && depth > 0) {
    const char = text[i]!;
    if (quote !== null) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "(") {
      depth++;
    } else if (char === ")") {
      depth--;
    }
    i++;
  }
  return [text.slice(start, depth === 0 ? i - 1 : i), i];
}

/**
 * The bodies of command substitutions the segment runs: $(...) outside single
 * quotes, and `...` spans. A quoted body still runs, so it is classified
 * beside the segment that carries it. An escaped \$ or backquote is literal
 * text and runs nothing.
 */
function substitutionBodies(segment: string): string[] {
  const bodies: string[] = [];
  let quote: string | null = null;
  let i = 0;
  while (i < segment.length) {
    const char = segment[i]!;
    if (quote === "'") {
      if (char === "'") quote = null;
      i++;
    } else if (quote === "`") {
      if (char === "`") quote = null;
      else if (char === "$" && segment[i + 1] === "(" && !isEscaped(segment, i)) {
        const [body, end] = balancedBody(segment, i + 2);
        bodies.push(body);
        i = end;
        continue;
      }
      i++;
    } else if (quote === '"') {
      if (char === '"') quote = null;
      else if (char === "$" && segment[i + 1] === "(" && !isEscaped(segment, i)) {
        const [body, end] = balancedBody(segment, i + 2);
        bodies.push(body);
        i = end;
        continue;
      } else if (char === "`" && !isEscaped(segment, i)) {
        const end = segment.indexOf("`", i + 1);
        bodies.push(end < 0 ? segment.slice(i + 1) : segment.slice(i + 1, end));
        i = end < 0 ? segment.length : end + 1;
        continue;
      }
      i++;
    } else if (char === "'" || char === '"' || char === "`") {
      quote = char;
      i++;
    } else if (char === "$" && segment[i + 1] === "(" && !isEscaped(segment, i)) {
      const [body, end] = balancedBody(segment, i + 2);
      bodies.push(body);
      i = end;
    } else {
      i++;
    }
  }
  // A backquote span outside single quotes runs its body.
  quote = null;
  i = 0;
  while (i < segment.length) {
    const char = segment[i]!;
    if (quote === "'") {
      if (char === "'") quote = null;
      i++;
    } else if (char === "'") {
      quote = char;
      i++;
    } else if (char === "`" && !isEscaped(segment, i)) {
      const end = segment.indexOf("`", i + 1);
      bodies.push(end < 0 ? segment.slice(i + 1) : segment.slice(i + 1, end));
      i = end < 0 ? segment.length : end + 1;
    } else {
      i++;
    }
  }
  return bodies;
}

/** The cwd after a segment runs: cd moves it, anything else leaves it. */
function cdAfter(cwd: string | null, segment: string): string | null {
  const head = segmentHead(segment);
  if (head.verb !== "cd") return cwd;
  let at = head.at + 1;
  while (at < head.words.length) {
    const flag = head.words[at]!;
    if (flag === "--" || /^-[A-Za-z]+$/u.test(flag)) at++;
    else break;
  }
  const arg = head.words[at] ?? "";
  if (arg === "" || arg === "~") return expandHome("~");
  if (arg === "-") return null;
  const clean = stripQuotes(arg);
  if (!clean || clean.includes("$") || /[*?[\]]/u.test(clean)) return null;
  if (isAbsolute(clean)) return physical(clean);
  return cwd === null ? null : physical(resolve(cwd, clean));
}

/**
 * Classify a shell command: its parts in order with cd tracked, each (...)
 * group and command substitution classified where it stands. cwd is null
 * once a cd the check cannot follow runs; relative paths then read as
 * unknown, never clean.
 */
/**
 * Blank substitutions: a live one's body is classified on its own, so its
 * text is not its outer segment's, and an escaped one never runs at all.
 * Paired backquotes go the same way; an unterminated one stays live.
 */
function blankSubst(segment: string): string {
  let out = "";
  let i = 0;
  while (i < segment.length) {
    const at = segment.indexOf("$(", i);
    const tick = segment.indexOf("`", i);
    if (at >= 0 && (tick < 0 || at < tick)) {
      const escaped = at > 0 && segment[at - 1] === "\\";
      let depth = 1;
      let j = at + 2;
      let quote = "";
      while (j < segment.length && depth > 0) {
        const ch = segment[j]!;
        if (ch === "\\") {
          j += 2;
          continue;
        }
        if (quote) {
          if (ch === quote) quote = "";
        } else if (ch === '"' || ch === "'") {
          quote = ch;
        } else if (ch === "(") {
          depth++;
        } else if (ch === ")") {
          depth--;
        }
        j++;
      }
      out += `${segment.slice(i, escaped ? at - 1 : at)} `;
      i = j;
      continue;
    }
    if (tick < 0) return out + segment.slice(i);
    const close = segment.indexOf("`", tick + 1);
    if (close < 0) return out + segment.slice(i);
    out += `${segment.slice(i, tick)} `;
    i = close + 1;
  }
  return out;
}

/**
 * The marker text: the segment without its substitutions and the run's own
 * machinery. A substitution's body is classified on its own; the run's
 * record path and ticket worktree name the run, not the ticket's text; a
 * file:line suffix names a line, not the ticket.
 */
function markerText(ctx: Ctx, segment: string): string {
  const literal = blankSubst(segment);
  const run = literal.split(`runs/${ctx.ticket}`).join(" ");
  const tree = run.split(`.worktrees/${ctx.ticket}`).join(" ");
  return tree.replace(/[A-Za-z0-9_./-]*\.[A-Za-z0-9_~+-]*:\d+/gu, " "); // ASCII: file names and line numbers in commands are ASCII
}

/** An adapter call naming a repo and a verb: it may read the ticket. */
function adapterWithTarget(head: Head): boolean {
  if (head.verb === "run") {
    const tool = head.words[head.at + 1] ?? "";
    if (tool !== "github" && tool !== "local") return false;
    return (head.words[head.at + 2] ?? "") !== "" && (head.words[head.at + 3] ?? "") !== "";
  }
  if (
    head.verb === "github.sh" ||
    head.verb === "local.sh" ||
    head.verb === "github.ts" ||
    head.verb === "local.ts"
  ) {
    return (head.words[head.at + 1] ?? "") !== "" && (head.words[head.at + 2] ?? "") !== "";
  }
  if (
    head.verb === "bun" ||
    head.verb === "node" ||
    head.verb === "deno" ||
    head.verb === "bash" ||
    head.verb === "sh"
  ) {
    const script = baseVerb(head.words[head.at + 1] ?? "");
    if (
      script !== "github.ts" &&
      script !== "local.ts" &&
      script !== "github.sh" &&
      script !== "local.sh"
    ) {
      return false;
    }
    return (head.words[head.at + 2] ?? "") !== "" && (head.words[head.at + 3] ?? "") !== "";
  }
  return false;
}

/**
 * Whether the segment carries a marker of this run's own ticket: its number,
 * its clerk or store path, the tracker's host, or a read-capable gh or
 * adapter call with a target. A bare repo name is not one: it collides with
 * paths, and every real repository address carries the host.
 */
function segmentHasMarkers(ctx: Ctx, segment: string): boolean {
  const live = markerText(ctx, segment);
  if (hasNumberToken(live, ctx.ticket)) return true;
  if (live.includes(".postmaster/clerk")) return true;
  if (live.includes("postmaster/tickets")) return true;
  if (ctx.kind === "github" && live.includes("github.com")) return true;
  const head = segmentHead(live);
  if (head.verb === "gh") {
    const sub = head.words[skipFlags(head.words, head.at + 1)] ?? "";
    if (sub !== "issue" && sub !== "api") return false;
    return (
      hasNumberToken(live, ctx.ticket) ||
      head.words.some((word) => isVar(word)) ||
      /https?:\/\//u.test(live)
    );
  }
  return adapterWithTarget(head);
}

/** The segment as an unknown detail: one line, truncated, naming the call. */
function shortSegment(segment: string): string {
  return segment.replace(/\s+/gu, " ").trim().slice(0, 100); // ASCII: outcome lines stay one ASCII line
}

function classifyCommand(ctx: Ctx, command: string, own: string | null, depth = 0): Placement {
  const findings: Finding[] = [];
  let placed = false;
  let cwd = own;
  for (const part of splitParts(command)) {
    if (part.kind === "subshell") {
      const inner = classifyCommand(ctx, part.text, cwd, depth);
      findings.push(...inner.findings);
      placed = placed || inner.placed;
      continue;
    }
    const seg = classifySegment(ctx, part.text, cwd, depth);
    findings.push(...seg.findings);
    placed = placed || seg.placed;
    // A marked segment no named form places reads unknown, never not read.
    if (seg.findings.length === 0 && !seg.placed && segmentHasMarkers(ctx, part.text)) {
      findings.push({
        agent: "",
        finding: "unknown",
        form: "unplaced",
        detail: shortSegment(part.text),
      });
    }
    for (const body of substitutionBodies(part.text)) {
      const inner = classifyCommand(ctx, body, cwd, depth);
      findings.push(...inner.findings);
      placed = placed || inner.placed;
    }
    cwd = cdAfter(cwd, part.text);
  }
  return { findings, placed };
}

function baseVerb(word: string): string {
  return word.split("/").pop() ?? word;
}

interface Head {
  verb: string;
  words: string[];
  at: number;
}

/** Command wrappers whose own words hide the real command word. */
const WRAPPERS = new Set(["sudo", "env", "time", "timeout", "command", "nohup", "nice", "exec"]);

/** Wrapper options that take a value in the next word. */
const WRAPPER_VALUE_OPTS = new Set([
  "-o",
  "--output",
  "-a",
  "-s",
  "--signal",
  "-k",
  "--kill-after",
  "-n",
  "--adjustment",
  "-u",
  "--user",
  "-g",
  "--group",
  "-U",
  "--other-user",
  "-C",
  "--close-from",
  "-D",
  "--chdir",
  "-R",
  "--chroot",
  "-h",
  "--host",
  "-p",
  "--prompt",
  "-r",
  "--role",
  "-t",
  "--type",
  "-T",
  "--command-timeout",
  "-S",
  "--split-string",
  "--unset",
]);

/** Signal names a timeout -s can carry, bare or SIG-prefixed. */
const SIGNAL_RE =
  /^(SIG)?(HUP|INT|QUIT|ILL|TRAP|ABRT|BUS|FPE|KILL|USR1|SEGV|USR2|PIPE|ALRM|TERM|STKFLT|CHLD|CONT|STOP|TSTP|TTIN|TTOU|URG|XCPU|XFSZ|VTALRM|PROF|WINCH|POLL|PWR|SYS)$/u; // ASCII: signal names are ASCII

/** Past a wrapper's own options: flags, durations, levels and signal names. */
function skipWrapperArgs(words: string[], at: number): number {
  while (at < words.length) {
    const word = stripQuotes(words[at]!);
    if (WRAPPER_VALUE_OPTS.has(word)) {
      at += 2;
    } else if (/^--[A-Za-z][A-Za-z0-9_-]*(=.*)?$/u.test(word)) {
      at++;
      // ASCII: wrapper flags are ASCII
    } else if (/^-[A-Za-z]+\d*$/u.test(word)) {
      at++;
      // ASCII: durations and levels are ASCII
    } else if (/^[+-]?\d+[smhd]?$/u.test(word)) {
      at++;
    } else if (SIGNAL_RE.test(word)) {
      at++;
    } else {
      break;
    }
  }
  return at;
}

/** The segment's command word, past wrappers and assignments. */
function segmentHead(segment: string): Head {
  const words = splitWords(segment.trim()); // ASCII: shell words split on ASCII whitespace
  let at = 0;
  while (at < words.length) {
    const word = stripQuotes(words[at]!);
    if (WRAPPERS.has(baseVerb(word))) {
      at = skipWrapperArgs(words, at + 1);
    } else if (/^[A-Za-z_][A-Za-z0-9_]*=/u.test(word)) {
      at++;
    } else {
      break;
    }
  }
  return { verb: baseVerb(stripQuotes(words[at] ?? "")), words, at };
}

/** Skip pflag-style flags from i, past their values. */
function skipFlags(words: string[], i: number): number {
  while (i < words.length) {
    const word = words[i]!;
    if (
      word === "--repo" ||
      word === "-R" ||
      word === "--json" ||
      word === "--jq" ||
      word === "--template"
    ) {
      i += 2;
    } else if (word.startsWith("-") && word !== "-") {
      i++;
    } else {
      break;
    }
  }
  return i;
}

interface GhFlags {
  repo: string | null;
  json: string | null;
  comments: boolean;
  select: boolean;
}

/** The last -R/--repo and --json values anywhere in the words, and selector presence. */
function scanFlags(words: string[]): GhFlags {
  let repo: string | null = null;
  let json: string | null = null;
  let comments = false;
  let select = false;
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    if (word === "--repo" || word === "-R") {
      repo = quotedValue(words, i + 1);
      i++;
    } else if (word.startsWith("--repo=")) {
      repo = stripQuotes(word.slice("--repo=".length));
      // ASCII: flag letters match ASCII
    } else if (/^-R[^-\s]/u.test(word)) {
      repo = stripQuotes(word.slice(2));
    } else if (word === "--json") {
      json = quotedValue(words, i + 1);
      i++;
    } else if (word.startsWith("--json=")) {
      json = stripQuotes(word.slice("--json=".length));
    } else if (word === "--comments") {
      comments = true;
    } else if (
      word === "--jq" ||
      word === "--template" ||
      word.startsWith("--jq=") ||
      word.startsWith("--template=")
    ) {
      select = true;
      if (!word.includes("=")) i++;
    }
  }
  return { repo, json, comments, select };
}

function sameNwo(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase(); // ASCII: GitHub owner and repo names are ASCII
}

/** An -R/--repo value as owner/repo, or "" when it names none. */
function repoValue(value: string): string {
  const clean = stripQuotes(value.trim())
    .replace(/\.git$/u, "")
    .replace(/\/+$/u, "");
  const parts = clean.split("/").filter(Boolean);
  if (parts.length < 2) return "";
  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

interface IssueUrl {
  nwo: string;
  number: string;
}

function issueUrls(segment: string): IssueUrl[] {
  const found: IssueUrl[] = [];
  const re =
    /https?:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/issues\/(\d+)(?=[/?#\s"'`;&|()]|$)/giu; // ASCII: issue addresses are machine-made ASCII
  for (const match of segment.matchAll(re)) {
    found.push({ nwo: `${match[1]}/${match[2]}`, number: match[3]! });
  }
  return found;
}

function ghRepoOverride(segment: string, flagRepo: string | null): string | null {
  if (flagRepo !== null) return flagRepo;
  const env = /(?:^|[\s;&|()])GH_REPO=([^\s;&|()"'`]+)/u.exec(segment); // ASCII: env assignments match ASCII
  return env ? stripQuotes(env[1]!) : null;
}

/**
 * The gh api HTTP method, uppercase, read outside quoted flag values so a
 * -f body naming a flag cannot spoof it; null when none is named, "?" when
 * the flag carries none.
 */
function ghApiMethod(segment: string): string | null {
  const bare = segment.replace(/"[^"]*"/gu, " ").replace(/'[^']*'/gu, " ");
  const words = bare.trim().split(/\s+/u).filter(Boolean); // ASCII: shell words split on ASCII whitespace
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    if (word === "-X" || word === "--method") {
      const value = words[i + 1] ?? "";
      return value ? value.toUpperCase() : "?"; // ASCII: HTTP methods are ASCII
    }
    const stuck = /^-X([A-Za-z]+)$/u.exec(word); // ASCII: HTTP methods are ASCII
    if (stuck) return stuck[1]!.toUpperCase(); // ASCII: HTTP methods are ASCII
    if (word.startsWith("--method=")) {
      const value = word.slice("--method=".length);
      return value ? value.toUpperCase() : "?"; // ASCII: HTTP methods are ASCII
    }
  }
  // Data flags imply POST unless an explicit method said otherwise.
  for (const word of words) {
    if (word.startsWith("-f") || word.startsWith("-F")) return "POST";
    if (word === "--field" || word === "--raw-field" || word === "--input") return "POST";
    if (
      word.startsWith("--field=") ||
      word.startsWith("--raw-field=") ||
      word.startsWith("--input=")
    ) {
      return "POST";
    }
    if (word === "-raw-field" || word === "-input") return "POST";
  }
  return null;
}

/**
 * Whether the segment runs a graphql mutation operation. A query whose
 * operation is NAMED mutation is still a query; only the mutation keyword
 * in operation position counts, so a preceding query or subscription name
 * disqualifies the match.
 */
function isGraphqlMutation(segment: string): boolean {
  const keyword = /\bmutation\b/giu; // ASCII: graphql keywords are ASCII
  for (const match of segment.matchAll(keyword)) {
    const before = segment.slice(0, match.index ?? 0);
    const prev = /([A-Za-z_][\w$]*)\s*$/u.exec(before)?.[1]?.toLowerCase(); // ASCII: graphql words are ASCII
    if (prev === "query" || prev === "subscription") continue;
    const after = segment.slice((match.index ?? 0) + match[0].length);
    if (/^\s*(\{|\(|[A-Za-z_][\w$]*\s*[{(])/u.test(after)) return true; // ASCII: graphql shapes are ASCII
  }
  return false;
}

/** A graphql issue read against the run's repository: read, placed, or unknown. */
function graphqlRepoFinding(ctx: Ctx, segment: string, form: string): Placed {
  const repos = new Set<string>();
  const ownerFirst = /owner\s*:\s*"([^"]+)"\s*,\s*name\s*:\s*"([^"]+)"/giu; // ASCII: graphql names are ASCII
  const nameFirst = /name\s*:\s*"([^"]+)"\s*,\s*owner\s*:\s*"([^"]+)"/giu; // ASCII: graphql names are ASCII
  for (const match of segment.matchAll(ownerFirst)) repos.add(`${match[1]}/${match[2]}`);
  for (const match of segment.matchAll(nameFirst)) repos.add(`${match[2]}/${match[1]}`);
  if (repos.size !== 1 || ctx.nwo === null) {
    return { agent: "", finding: "unknown", form, detail: "repo unknown" };
  }
  const [nwo] = [...repos];
  if (!sameNwo(nwo!, ctx.nwo)) return "placed";
  return { agent: "", finding: "read", form, detail: "" };
}

/** Classify one gh segment; placed when it is a known write or another object. */
function classifyGh(ctx: Ctx, segment: string, head: Head): Placed {
  if (ctx.kind !== "github") return "placed";
  const words = head.words;
  const i = skipFlags(words, head.at + 1);
  const sub = words[i] ?? "";
  const flags = scanFlags(words.slice(head.at));
  if (sub === "issue") {
    const verb = words[skipFlags(words, i + 1)] ?? "";
    // A known write shows no ticket text; any other verb may display it.
    if (verb === "comment" || verb === "close" || verb === "reopen") return "placed";
    if (verb !== "view") {
      if (hasNumberToken(segment, ctx.ticket)) {
        return { agent: "", finding: "unknown", form: `gh issue ${verb}`.trim(), detail: "" };
      }
      // A numberless listing that can print bodies may dump the ticket's
      // text without naming it; a title-only listing cannot show text.
      if (verb === "list" && outputShowsBodies(flags)) {
        const override = ghRepoOverride(segment, flags.repo);
        if (override !== null) {
          const want = repoValue(override);
          if (!want || ctx.nwo === null) {
            return { agent: "", finding: "unknown", form: "gh issue list", detail: "repo unknown" };
          }
          if (!sameNwo(want, ctx.nwo)) return "placed";
        }
        return { agent: "", finding: "unknown", form: "gh issue list", detail: "" };
      }
      return null;
    }
    // A number inside another repo's address is not a bare target.
    const deurl = segment.replace(/https?:\/\/github\.com\/\S+/gu, " "); // ASCII: issue addresses are machine-made ASCII
    const bare = hasNumberToken(deurl, ctx.ticket);
    let sameUrl = false;
    let otherUrl = false;
    for (const url of issueUrls(segment)) {
      if (url.number !== ctx.ticket) continue;
      if (ctx.nwo === null) {
        return { agent: "", finding: "unknown", form: "gh issue view", detail: "repo unknown" };
      }
      if (sameNwo(url.nwo, ctx.nwo)) sameUrl = true;
      else otherUrl = true;
    }
    if (!bare && !sameUrl) {
      // A ticket position holding a variable may hold this ticket's number.
      if (words.some((word) => isVar(word))) {
        return { agent: "", finding: "unknown", form: "gh issue view", detail: "variable" };
      }
      if (otherUrl) return "placed";
      return null;
    }
    const override = ghRepoOverride(segment, flags.repo);
    if (override !== null) {
      const want = repoValue(override);
      if (!want)
        return { agent: "", finding: "unknown", form: "gh issue view", detail: "repo unknown" };
      if (ctx.nwo === null)
        return { agent: "", finding: "unknown", form: "gh issue view", detail: "repo unknown" };
      if (!sameNwo(want, ctx.nwo)) return "placed";
    }
    if (flags.json !== null) {
      const fields = flags.json
        .split(",")
        .map((field) => field.trim())
        .filter(Boolean);
      if (fields.some((field) => TEXT_FIELD_RE.test(field))) {
        return {
          agent: "",
          finding: "read",
          form: "gh issue view",
          detail: `--json ${flags.json}`,
        };
      }
      if (fields.length > 0 && fields.every((field) => TITLE_FIELDS.has(field))) {
        return {
          agent: "",
          finding: "title",
          form: "gh issue view",
          detail: `--json ${flags.json}`,
        };
      }
      return {
        agent: "",
        finding: "unknown",
        form: "gh issue view",
        detail: `--json ${flags.json}`,
      };
    }
    if (flags.comments)
      return { agent: "", finding: "read", form: "gh issue view", detail: "--comments" };
    if (flags.select)
      return { agent: "", finding: "unknown", form: "gh issue view", detail: "select" };
    return { agent: "", finding: "read", form: "gh issue view", detail: "" };
  }
  if (sub === "pr") {
    // Issues and pull requests share one numbering: naming this ticket's
    // number names another object, never the ticket's text.
    return hasNumberToken(segment, ctx.ticket) ? "placed" : null;
  }
  if (sub === "api") {
    if (/graphql/u.test(segment)) {
      return classifyGraphqlSegment(ctx, segment, "gh api graphql");
    }
    const method = ghApiMethod(segment);
    // A PATCH returns its resource: an issue PATCH returns the issue with
    // its body, so it reads through the endpoint analysis below, never as
    // a write. Collection and search dumps do not apply to it.
    const patch = method === "PATCH";
    if (method !== null && method !== "GET" && !patch) {
      // A mutating call shows no ticket text; HEAD returns headers alone.
      // An unreadable method naming the ticket cannot be told.
      if (method === "POST" || method === "PUT" || method === "DELETE" || method === "HEAD") {
        return "placed";
      }
      if (hasNumberToken(segment, ctx.ticket)) {
        return { agent: "", finding: "unknown", form: "gh api", detail: method };
      }
      return null;
    }
    // A GET on the issues collection or the search API dumps bodies without
    // naming the ticket; another repository's collection is not this run's.
    const collectionRe =
      /repos\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/issues(\/comments)?(?![A-Za-z0-9_./-])/gu; // ASCII: API paths are machine-made ASCII
    let collectionOther = false;
    if (!patch) {
      for (const match of segment.matchAll(collectionRe)) {
        const nwo = `${match[1]}/${match[2]}`;
        if (ctx.nwo === null) {
          return { agent: "", finding: "unknown", form: "gh api", detail: "repo unknown" };
        }
        if (!sameNwo(nwo, ctx.nwo)) {
          collectionOther = true;
          continue;
        }
        return { agent: "", finding: "unknown", form: "gh api", detail: "collection" };
      }
      // ASCII: API paths are machine-made ASCII
      if (/\/search\/issues(?![A-Za-z0-9_./-])/u.test(segment)) {
        return { agent: "", finding: "unknown", form: "gh api", detail: "search" };
      }
      // An endpoint number holding a variable may hold this ticket's number.
      const varNumber =
        /repos\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/issues\/\$(?:[{(]?[A-Za-z_]|[@*#?$!0-9])/u; // ASCII: API paths are machine-made ASCII
      const varMatch = varNumber.exec(segment);
      if (varMatch) {
        const nwo = `${varMatch[1]}/${varMatch[2]}`;
        if (ctx.nwo === null) {
          return { agent: "", finding: "unknown", form: "gh api", detail: "repo unknown" };
        }
        if (sameNwo(nwo, ctx.nwo)) {
          return { agent: "", finding: "unknown", form: "gh api", detail: "variable" };
        }
        return "placed";
      }
    }
    const endpoints = [
      ...segment.matchAll(
        /repos\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/issues\/(\d+)((?:\/[A-Za-z0-9_.-]+)*)/gu, // ASCII: API paths are machine-made ASCII
      ),
    ];
    let otherRepo = false;
    for (const endpoint of endpoints) {
      const nwo = `${endpoint[1]}/${endpoint[2]}`;
      const number = endpoint[3]!;
      const rest = endpoint[4] ?? "";
      if (number !== ctx.ticket) continue;
      if (ctx.nwo === null) {
        return { agent: "", finding: "unknown", form: "gh api", detail: "repo unknown" };
      }
      if (!sameNwo(nwo, ctx.nwo)) {
        otherRepo = true;
        continue;
      }
      // A PATCH returns the issue itself; a PATCH anywhere else is invalid
      // or edits a comment the agent wrote, and shows no ticket text.
      if (patch) {
        if (rest === "") return { agent: "", finding: "read", form: "gh api", detail: "" };
        return "placed";
      }
      if (rest === "" || rest === "/comments") {
        return { agent: "", finding: "read", form: "gh api", detail: rest || "" };
      }
      return { agent: "", finding: "unknown", form: "gh api", detail: rest };
    }
    // Another repo's issue explains the number; anything else naming it is unknown.
    if (otherRepo || collectionOther) return "placed";
    if (hasNumberToken(segment, ctx.ticket)) {
      return { agent: "", finding: "unknown", form: "gh api", detail: patch ? "PATCH" : "" };
    }
    return null;
  }
  if (sub === "search" || sub === "browse") {
    if (hasNumberToken(segment, ctx.ticket)) {
      return { agent: "", finding: "unknown", form: `gh ${sub}`, detail: "" };
    }
    // An issue search printing bodies may dump the ticket without naming it.
    if (sub === "search" && /issues?/iu.test(segment) && outputShowsBodies(flags)) {
      return { agent: "", finding: "unknown", form: "gh search", detail: "" };
    }
    return null;
  }
  return null;
}

/** Whether gh flags can print bodies: --json naming body or comment, --comments, or a selector. */
function outputShowsBodies(flags: GhFlags): boolean {
  if (flags.comments || flags.select) return true;
  if (flags.json === null) return false;
  return flags.json
    .split(",")
    .map((field) => field.trim())
    .some((field) => TEXT_FIELD_RE.test(field));
}

function expandHome(value: string): string {
  const home = process.env.HOME || homedir();
  if (value === "~" || value.startsWith("~/")) return join(home, value.slice(2));
  return value.replace(/\$HOME(?=\/|$)/gu, home).replace(/\$\{HOME\}(?=\/|$)/gu, home);
}

/** A touched path, physical; null when it cannot be told (a variable, a pattern). */
function touchPath(token: string, own: string | null): string | null {
  if (!token || /[*?[\]]/u.test(token)) return null;
  let value = expandHome(token);
  if (value.includes("$")) return null;
  if (!isAbsolute(value)) {
    if (own === null) return null;
    value = resolve(own, value);
  }
  return physical(value);
}

/** An adapter repo argument in this run's project: the repo or its ticket worktrees. */
function sameProject(ctx: Ctx, repoArg: string, own: string | null): boolean | null {
  const expanded = expandHome(stripQuotes(repoArg.trim()));
  if (!expanded || expanded.includes("$")) return null;
  if (!isAbsolute(expanded) && own === null) return null;
  const absolute = isAbsolute(expanded) ? expanded : resolve(own ?? "", expanded);
  const norm = physical(absolute);
  return (
    norm === ctx.repo ||
    norm === ctx.ticketPrefix ||
    norm.startsWith(`${ctx.ticketPrefix}-`) ||
    norm.startsWith(`${ctx.repo}${sep}.worktrees${sep}`)
  );
}

/** Classify one adapter (run github/local, legacy .sh/.ts) segment; placed when it is a known write, titles alone, or another repo or tracker. */
function classifyAdapter(
  ctx: Ctx,
  tool: "github" | "local",
  words: string[],
  at: number,
  own: string | null,
  segment: string,
): Placed {
  if ((tool === "github") !== (ctx.kind === "github")) return "placed";
  const repoArg = words[at] ?? "";
  const verb = words[at + 1] ?? "";
  if (!repoArg || !verb) return null;
  const same = sameProject(ctx, repoArg, own);
  if (same === false) return "placed";
  if (same === null) {
    if (!hasNumberToken(segment, ctx.ticket)) return null;
    return { agent: "", finding: "unknown", form: `run ${tool} ${verb}`, detail: "repo unknown" };
  }
  const target = stripQuotes(words[at + 2] ?? "").replace(/^#+/u, "");
  if (verb === "read") {
    if (isVar(target)) {
      return { agent: "", finding: "unknown", form: `run ${tool} read`, detail: "variable" };
    }
    if (target !== ctx.ticket) return "placed";
    return { agent: "", finding: "read", form: `run ${tool} read`, detail: "" };
  }
  if (verb === "state") {
    if (target !== ctx.ticket) return "placed";
    return { agent: "", finding: "title", form: `run ${tool} state`, detail: "" };
  }
  // Known writes and metadata show no ticket text; verbs without a ticket
  // reference never name it. A search may surface its title; anything else
  // naming it is a form the check does not know.
  if (
    verb === "comment" ||
    verb === "edit" ||
    verb === "title" ||
    verb === "label" ||
    verb === "has-label" ||
    verb === "create" ||
    verb === "list" ||
    verb === "board" ||
    verb === "access" ||
    verb === "store"
  ) {
    return "placed";
  }
  if (!hasNumberToken(segment, ctx.ticket)) return null;
  return { agent: "", finding: "unknown", form: `run ${tool} ${verb}`, detail: "" };
}

/** Classify one fetch segment; placed when it fetches another ticket or repo. */
function classifyFetch(ctx: Ctx, segment: string): Placed {
  if (ctx.kind !== "github") return "placed";
  let other = false;
  for (const url of issueUrls(segment)) {
    if (url.number !== ctx.ticket) {
      other = true;
      continue;
    }
    if (ctx.nwo === null) {
      return { agent: "", finding: "unknown", form: "issue fetch", detail: "repo unknown" };
    }
    if (sameNwo(url.nwo, ctx.nwo)) {
      return { agent: "", finding: "read", form: "issue fetch", detail: "" };
    }
    other = true;
  }
  const api = classifyApiFetch(ctx, segment);
  if (api) return api;
  return other ? "placed" : null;
}

/**
 * The fetch HTTP method, uppercase, read outside quoted data so a payload
 * naming a flag cannot spoof it; null when the call reads as a GET. Data
 * flags imply POST unless -G sends them as a query string.
 */
function fetchMethod(segment: string): string | null {
  const bare = segment.replace(/"[^"]*"/gu, " ").replace(/'[^']*'/gu, " ");
  const words = bare.trim().split(/\s+/u).filter(Boolean); // ASCII: shell words split on ASCII whitespace
  let data = false;
  let get = false;
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    if (word === "-X" || word === "--request" || word === "--method") {
      const value = words[i + 1] ?? "";
      return value ? value.toUpperCase() : "?"; // ASCII: HTTP methods are ASCII
    }
    const stuck = /^-X([A-Za-z]+)$/u.exec(word); // ASCII: HTTP methods are ASCII
    if (stuck) return stuck[1]!.toUpperCase(); // ASCII: HTTP methods are ASCII
    if (word.startsWith("--request=") || word.startsWith("--method=")) {
      const value = word.slice(word.indexOf("=") + 1);
      return value ? value.toUpperCase() : "?"; // ASCII: HTTP methods are ASCII
    }
    if (word === "-I" || word === "--head") return "HEAD";
    if (word === "-d" || word === "--data" || word === "--post-data" || word === "--post-file") {
      data = true;
    } else if (word === "-G" || word === "--get") {
      get = true;
    }
  }
  if (get || !data) return null;
  return "POST";
}

/** A REST issue URL through the API host: read, placed, or unknown. */
function classifyApiRest(ctx: Ctx, text: string): Placed {
  const rest =
    /https?:\/\/api\.github\.com\/repos\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/issues\/(\d+)((?:\/[A-Za-z0-9_.-]+)*)/gu; // ASCII: API addresses are machine-made ASCII
  let otherRepo = false;
  let other = false;
  for (const match of text.matchAll(rest)) {
    const nwo = `${match[1]}/${match[2]}`;
    const number = match[3]!;
    const restPath = match[4] ?? "";
    if (number !== ctx.ticket) {
      other = true;
      continue;
    }
    if (ctx.nwo === null) {
      return { agent: "", finding: "unknown", form: "issue fetch", detail: "repo unknown" };
    }
    if (!sameNwo(nwo, ctx.nwo)) {
      otherRepo = true;
      continue;
    }
    if (restPath === "" || restPath === "/comments") {
      return { agent: "", finding: "read", form: "issue fetch", detail: "" };
    }
    return { agent: "", finding: "unknown", form: "issue fetch", detail: restPath };
  }
  return other || otherRepo ? "placed" : null;
}

/** A PATCH fetch of an issue URL: the issue itself reads, anything else is placed. */
function patchRestResource(ctx: Ctx, segment: string): Placed {
  const rest =
    /https?:\/\/api\.github\.com\/repos\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/issues\/(\d+)((?:\/[A-Za-z0-9_.-]+)*)/gu; // ASCII: API addresses are machine-made ASCII
  for (const match of segment.matchAll(rest)) {
    const nwo = `${match[1]}/${match[2]}`;
    const number = match[3]!;
    const restPath = match[4] ?? "";
    if (number !== ctx.ticket) continue;
    if (ctx.nwo === null) {
      return { agent: "", finding: "unknown", form: "issue fetch", detail: "repo unknown" };
    }
    if (!sameNwo(nwo, ctx.nwo)) continue;
    if (restPath === "") return { agent: "", finding: "read", form: "issue fetch", detail: "" };
  }
  // A PATCH of another endpoint shows that resource, never the ticket.
  return "placed";
}

/** A fetch of the API for this ticket: REST issue URLs and the graphql endpoint. */
function classifyApiFetch(ctx: Ctx, segment: string): Placed {
  if (!/api\.github\.com/u.test(segment)) return null;
  const method = fetchMethod(segment);
  // A PATCH returns its resource; graphql over PATCH is invalid.
  if (method === "PATCH") {
    if (/graphql/u.test(segment)) return "placed";
    return patchRestResource(ctx, segment);
  }
  if (method !== null && method !== "GET") {
    if (method === "HEAD") return "placed";
    if (method === "POST" || method === "PUT" || method === "DELETE") {
      // A mutating fetch shows no ticket text — except a graphql query POSTed as data.
      if (!/graphql/u.test(segment)) return "placed";
    } else if (hasNumberToken(segment, ctx.ticket)) {
      return { agent: "", finding: "unknown", form: "issue fetch", detail: method };
    } else {
      return null;
    }
  }
  const rest = classifyApiRest(ctx, segment);
  if (rest) return rest;
  // A POST to the graphql endpoint runs the query it carries as data.
  if (/api\.github\.com\/graphql/u.test(segment)) {
    // ASCII: curl data flags are ASCII
    if (/(?:^|\s)(?:-d|--data(?:=|\s+))@/u.test(segment)) {
      return { agent: "", finding: "unknown", form: "issue fetch", detail: "data file" };
    }
    return classifyGraphqlSegment(ctx, segment, "issue fetch");
  }
  return null;
}

/** A graphql call carrying its query as text: read, placed, or unknown. */
function classifyGraphqlSegment(ctx: Ctx, segment: string, form: string): Placed {
  if (!hasNumberToken(segment, ctx.ticket)) {
    // An issue number holding a variable may hold this ticket's number.
    if (
      /number\s*:\s*\$(?:[{(]?[A-Za-z_]|[@*#?$!0-9])/u.test(segment) && // ASCII: graphql shapes are ASCII
      /issues?/iu.test(segment)
    ) {
      return { agent: "", finding: "unknown", form, detail: "variable" };
    }
    return null;
  }
  if (isGraphqlMutation(segment)) return "placed";
  if (!/issues?/iu.test(segment)) {
    return { agent: "", finding: "unknown", form, detail: "" };
  }
  return graphqlRepoFinding(ctx, segment, form);
}

const STORE_FILE_RE =
  /(?:^|[ \t\r\n;&|()<>"'`])([~$A-Za-z0-9_@./-]*postmaster\/tickets\/\d+\.(?:md|json))/gu; // ASCII: store paths match ASCII
const CLERK_FILE_RE =
  /(?:^|[ \t\r\n;&|()<>"'`])([~$A-Za-z0-9_@./-]*\.postmaster\/clerk\/[^ \t\r\n;&|()<>"'`]+)/gu;
const STORE_DIR_RE = /[~$A-Za-z0-9_@./-]*postmaster\/tickets(?=[/\s"'`;&|()]|$)/u; // ASCII: store paths match ASCII
const CLERK_DIR_RE = /[~$A-Za-z0-9_@./-]*\.postmaster\/clerk(?=[/\s"'`;&|()]|$)/u; // ASCII: clerk paths match ASCII

/** Another ticket's file under a ticket directory: numbered, and not this run's. */
function isSiblingTicketFile(absolute: string, ticket: string): boolean {
  const sibling = /^(\d+)\.(md|json)$/u.exec(basename(absolute)); // ASCII: ticket numbers are ASCII digits
  return sibling !== null && sibling[1] !== ticket;
}

/** Where a store or clerk path points: the ticket's file, its meta, the dir, or elsewhere. */
function placePath(
  ctx: Ctx,
  candidate: string,
  own: string | null,
): "file" | "meta" | "dir" | "elsewhere" | "unknown" {
  const absolute = touchPath(candidate, own);
  if (absolute === null) return "unknown";
  if (absolute === join(ctx.clerkDir, `${ctx.ticket}.md`)) return "file";
  if (absolute === ctx.clerkDir) return "dir";
  if (absolute.startsWith(`${ctx.clerkDir}${sep}`)) {
    return isSiblingTicketFile(absolute, ctx.ticket) ? "elsewhere" : "dir";
  }
  if (ctx.kind !== "local") return "elsewhere";
  if (ctx.storeDir === null) {
    return /postmaster\/tickets/u.test(candidate) ? "unknown" : "elsewhere";
  }
  if (absolute === join(ctx.storeDir, `${ctx.ticket}.md`)) return "file";
  if (absolute === join(ctx.storeDir, `${ctx.ticket}.json`)) return "meta";
  if (absolute === ctx.storeDir) return "dir";
  if (absolute.startsWith(`${ctx.storeDir}${sep}`)) {
    return isSiblingTicketFile(absolute, ctx.ticket) ? "elsewhere" : "dir";
  }
  return "elsewhere";
}

/** Whether the segment writes its file operands: tee, or sed in place. */
function writesFile(segment: string, verb: string): boolean {
  if (verb === "tee") return true;
  if (verb !== "sed") return false;
  const bare = segment.replace(/"[^"]*"/gu, " ").replace(/'[^']*'/gu, " ");
  // ASCII: shell words split on ASCII whitespace
  for (const word of bare.trim().split(/\s+/u)) {
    if (word === "--in-place" || word.startsWith("--in-place=")) return true;
    if (/^-[A-Za-z]*i/u.test(word)) return true;
  }
  return false;
}

/** Classify the store and clerk paths one segment names. */
function classifyPaths(ctx: Ctx, segment: string, verb: string, own: string | null): Placement {
  const findings: Finding[] = [];
  let placed = false;
  const reading = READ_VERBS.has(verb);
  const writing = writesFile(segment, verb);
  // A scan can run a reader over the directory unseen; its -exec is not followed.
  const scanning = reading || SCAN_VERBS.has(verb);
  const seen = new Set<string>();
  // A ticket path joined to a live substitution cannot be resolved: its root
  // is the substitution's value, so it reads as unknown, never clean.
  if (dynamicPath(segment)) {
    if (writing) return { findings, placed: true };
    const files = [...segment.matchAll(STORE_FILE_RE), ...segment.matchAll(CLERK_FILE_RE)];
    if (files.length > 0) {
      const clerk = files.some((match) => match[1]!.includes(".postmaster/clerk/"));
      findings.push({
        agent: "",
        finding: "unknown",
        form: clerk ? "clerk draft" : "ticket file",
        detail: "dynamic path",
      });
      return { findings, placed };
    }
    for (const re of [STORE_DIR_RE, CLERK_DIR_RE]) {
      const dir = re.exec(segment)?.[0];
      if (!dir) continue;
      findings.push({
        agent: "",
        finding: "unknown",
        form: dir.includes("clerk") ? "clerk draft dir" : "ticket file dir",
        detail: "dynamic path",
      });
      return { findings, placed };
    }
    return { findings, placed };
  }
  const fileRes = [...segment.matchAll(STORE_FILE_RE), ...segment.matchAll(CLERK_FILE_RE)];
  for (const match of fileRes) {
    const candidate = match[1]!;
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    const place = placePath(ctx, candidate, own);
    const form = candidate.includes(".postmaster/clerk/") ? "clerk draft" : "ticket file";
    if (place === "file") {
      if (writing) {
        placed = true;
      } else {
        findings.push(
          reading
            ? { agent: "", finding: "read", form, detail: "" }
            : { agent: "", finding: "unknown", form, detail: verb || "bare" },
        );
      }
    } else if (place === "meta") {
      if (writing) {
        placed = true;
      } else {
        findings.push(
          reading
            ? { agent: "", finding: "title", form, detail: "" }
            : { agent: "", finding: "unknown", form, detail: verb || "bare" },
        );
      }
    } else if (place === "dir") {
      if (writing) {
        placed = true;
      } else if (scanning) {
        findings.push({ agent: "", finding: "unknown", form: `${form} dir`, detail: "" });
      }
    } else if (place === "unknown") {
      findings.push({ agent: "", finding: "unknown", form, detail: "path unknown" });
    } else {
      // A ticket-patterned path resolving elsewhere is placed: another
      // ticket's file, another tree, or another tracker's store.
      placed = true;
    }
  }
  if (findings.length === 0) {
    for (const re of [STORE_DIR_RE, CLERK_DIR_RE]) {
      const dir = re.exec(segment)?.[0];
      if (!dir) continue;
      // A directory already read as part of a file path is not read again.
      if ([...seen].some((file) => file.startsWith(dir))) continue;
      const place = placePath(ctx, dir, own);
      if (writing && (place === "dir" || place === "unknown")) {
        placed = true;
      } else if (place === "dir" && scanning) {
        findings.push({
          agent: "",
          finding: "unknown",
          form: dir.includes("clerk") ? "clerk draft dir" : "ticket file dir",
          detail: "",
        });
      } else if (place === "unknown" && scanning) {
        findings.push({
          agent: "",
          finding: "unknown",
          form: "ticket file dir",
          detail: "path unknown",
        });
      } else if (place === "elsewhere") {
        placed = true;
      }
    }
  }
  return { findings, placed };
}

/** Classify one shell segment against every form the check names. */
function classifySegment(ctx: Ctx, segment: string, own: string | null, depth = 0): Placement {
  const findings: Finding[] = [];
  let placed = false;
  const take = (result: Placed): void => {
    if (result === "placed") placed = true;
    else if (result) findings.push(result);
  };
  const head = segmentHead(segment);
  if (!head.verb) return { findings, placed };
  // A -c string runs its own command; classify what it runs instead. The c
  // must be last in its cluster: in -cl the c takes l, not the next word.
  if (SHELL_WRAPPERS.has(head.verb) && depth < 2) {
    const next = head.words[head.at + 1] ?? "";
    const cluster = /^-([A-Za-z]*c)$/u.exec(next); // ASCII: shell flags are ASCII
    const attached = /^-([A-Za-z]*c)(['"])(.*)$/u.exec(next); // ASCII: shell flags are ASCII
    if (head.verb === "eval" || next === "-c" || cluster) {
      const inner = head.words.slice(head.at + (head.verb === "eval" ? 1 : 2)).join(" ");
      const placement = classifyCommand(ctx, stripQuotes(inner.trim()), own, depth + 1);
      findings.push(...placement.findings);
      placed = placed || placement.placed;
      return { findings, placed };
    }
    if (attached) {
      const inner = [attached[3], ...head.words.slice(head.at + 2)].join(" ");
      const placement = classifyCommand(ctx, stripQuotes(inner.trim()), own, depth + 1);
      findings.push(...placement.findings);
      placed = placed || placement.placed;
      return { findings, placed };
    }
    // A bare shell reads its stdin: piped or redirected commands it executes
    // are not in its words, so what it ran cannot be told. A shell with a
    // script or other arguments runs that file, a repo artifact outside the
    // record, and reads nothing here.
    if (stdinShell(head)) {
      findings.push({ agent: "", finding: "unknown", form: "stdin shell", detail: head.verb });
      return { findings, placed };
    }
  }
  if (head.verb === "gh") {
    take(classifyGh(ctx, segment, head));
  } else if (head.verb === "run") {
    const tool = head.words[head.at + 1] ?? "";
    if (tool === "github" || tool === "local") {
      take(classifyAdapter(ctx, tool, head.words, head.at + 2, own, segment));
    }
  } else if (
    head.verb === "github.sh" ||
    head.verb === "local.sh" ||
    head.verb === "github.ts" ||
    head.verb === "local.ts"
  ) {
    const tool = head.verb.startsWith("github") ? "github" : "local";
    take(classifyAdapter(ctx, tool, head.words, head.at + 1, own, segment));
  } else if (["bun", "node", "deno", "bash", "sh"].includes(head.verb) && depth < 2) {
    const script = baseVerb(head.words[head.at + 1] ?? "");
    if (
      script === "github.ts" ||
      script === "local.ts" ||
      script === "github.sh" ||
      script === "local.sh"
    ) {
      const tool = script.startsWith("github") ? "github" : "local";
      take(classifyAdapter(ctx, tool, head.words, head.at + 2, own, segment));
    }
  } else if (FETCH_VERBS.has(head.verb)) {
    take(classifyFetch(ctx, segment));
  }
  const paths = classifyPaths(ctx, segment, head.verb, own);
  findings.push(...paths.findings);
  placed = placed || paths.placed;
  return { findings, placed };
}

/** A call whose record proves it failed read nothing. */
function failedExit(exitCode: unknown): boolean {
  if (typeof exitCode === "number") return exitCode !== 0;
  if (typeof exitCode === "string") {
    const clean = exitCode.trim().toLowerCase(); // ASCII: harness outcome words are ASCII
    if (clean === "" || clean === "0" || clean === "success" || clean === "ok") return false;
    return /^(fail|failure|failed|error|timeout|timed-?out|killed|aborted)$/u.test(clean);
  }
  return false;
}

function inputUrl(input: RecordOf): string | null {
  for (const key of ["url", "uri"]) {
    const value = text(input[key]);
    if (value) return value;
  }
  return null;
}

/**
 * Whether a failed call excuses its command: failure is recorded per call,
 * so it proves nothing about one segment of several or one substitution of
 * one, and diff prints the differing lines while exiting 1. A failed
 * single-segment atomic read shows no text and still counts for nothing.
 */
function excusesCall(command: string, exitCode: unknown): boolean {
  if (!failedExit(exitCode)) return false;
  const parts = splitParts(command);
  if (parts.length !== 1) return false;
  const only = parts[0]!;
  if (only.kind === "subshell") return excusesCall(only.text, exitCode);
  if (substitutionBodies(only.text).length > 0) return false;
  const head = segmentHead(only.text);
  // Only diff exiting 1 prints: any other diff exit, like cmp and comm
  // failing, shows nothing or metadata, never file content.
  if (head.verb === "diff") return exitCode !== 1;
  if (head.verb === "cmp" || head.verb === "comm") return true;
  // A failed read shows nothing only when it read atomically: a scan may
  // have printed matches before it failed, and a reader with several file
  // operands prints what it can before the one that fails.
  if (SCAN_VERBS.has(head.verb)) return false;
  if (READ_VERBS.has(head.verb)) return readOperands(head) <= 1;
  return true;
}

/** Verbs whose first operand is a pattern, program or filter, not a file. */
const FIRST_IS_PATTERN = new Set([
  "grep",
  "egrep",
  "fgrep",
  "rg",
  "ag",
  "ack",
  "sed",
  "awk",
  "gawk",
  "mawk",
  "jq",
  "yq",
]);

/**
 * File operands of a failed read: words past the verb, without flags, bare
 * numbers, or a leading pattern. Flag values the check cannot tell from
 * files (an awk -v value, a cut separator) count as files.
 */
function readOperands(head: Head): number {
  const operands: string[] = [];
  let dashdash = false;
  for (const raw of head.words.slice(head.at + 1)) {
    const word = stripQuotes(raw);
    if (!dashdash && word === "--") {
      dashdash = true;
      continue;
    }
    if (!dashdash && word.startsWith("-") && word.length > 1) continue;
    if (/^[+-]?[0-9]+$/u.test(word)) continue; // ASCII: counts and line offsets are ASCII digits
    operands.push(word);
  }
  if (FIRST_IS_PATTERN.has(head.verb) && operands.length > 0) operands.shift();
  return operands.length;
}

/** Classify one tool call's command, paths and fetches. */
function classifyCall(ctx: Ctx, call: ToolCall, own: string): Finding[] {
  const findings: Finding[] = [];
  const command = inputCommand(call.input);
  if (command) {
    if (excusesCall(command, call.exitCode)) return findings;
    findings.push(...classifyCommand(ctx, command, own).findings);
  } else if (failedExit(call.exitCode)) {
    return findings;
  }
  const url = inputUrl(call.input);
  if (url) {
    for (const hit of issueUrls(url)) {
      if (ctx.kind !== "github" || hit.number !== ctx.ticket) continue;
      if (ctx.nwo === null) {
        findings.push({
          agent: "",
          finding: "unknown",
          form: "issue fetch",
          detail: "repo unknown",
        });
      } else if (sameNwo(hit.nwo, ctx.nwo)) {
        findings.push({ agent: "", finding: "read", form: "issue fetch", detail: "" });
      }
    }
    // A fetch tool reads with a GET.
    if (ctx.kind === "github") {
      const api = classifyApiRest(ctx, url);
      if (api && api !== "placed") findings.push(api);
    }
  }
  const paths: Array<{ path: string; write: boolean }> = call.direct.map((item) => ({
    path: item.path,
    write: item.access === "write",
  }));
  const direct = inputPath(call.input);
  if (direct) paths.push({ path: direct, write: WRITE_NAME_RE.test(call.name) });
  for (const item of paths) {
    if (item.write) continue;
    // A file tool's path is read, never listed: the dir alone is unknown.
    const place = placePath(ctx, item.path, own);
    const form = item.path.includes(".postmaster/clerk/") ? "clerk draft" : "ticket file";
    if (place === "file") findings.push({ agent: "", finding: "read", form, detail: "" });
    else if (place === "meta") findings.push({ agent: "", finding: "title", form, detail: "" });
    else if (place === "dir" || place === "unknown") {
      findings.push({ agent: "", finding: "unknown", form: `${form} dir`, detail: "" });
    }
  }
  // A structured tool input naming the ticket: no command, URL or path, so
  // no named form sees it. An issue, ticket, search or MCP tool may have
  // shown its text; what the tool returned cannot be told.
  if (!command && !url && !direct && call.direct.length === 0) {
    if (/issue|ticket|search|mcp/iu.test(call.name) && hasJsonNumber(call.input, ctx.ticket)) {
      findings.push({ agent: "", finding: "unknown", form: "structured tool", detail: call.name });
    }
  }
  return findings;
}

/** The ticket's number as a JSON value: a number or string, never part of another. */
function hasJsonNumber(input: RecordOf, ticket: string): boolean {
  return JSON.stringify(input)
    .split(/[":,\s[\]{}]+/u) // ASCII: JSON punctuation is ASCII
    .some((token) => token === ticket);
}

function parseTracker(scope: string): { kind: string; ticket: string } {
  const line = scope.split("\n").find((row) => row.toLowerCase().startsWith("tracker:")) ?? ""; // ASCII: waybill headings are ASCII
  const kind = /^tracker:[ \t]*([A-Za-z]+)/u.exec(line)?.[1]?.toLowerCase() ?? ""; // ASCII: tracker kinds are ASCII
  const ticket = /issue[ \t]+#?(\d+)/iu.exec(line)?.[1] ?? ""; // ASCII: issue numbers are ASCII digits
  return { kind, ticket };
}

function originNwo(repo: string): string | null {
  const r = run("git", ["-C", repo, "remote", "get-url", "origin"]);
  if (r.code !== 0) return null;
  const url = r.out.trim();
  const match = /github\.com[/:]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/u.exec(url);
  if (!match) return null;
  return `${match[1]}/${match[2]}`;
}

function storeDirOf(repo: string): string | null {
  const r = run("git", ["-C", repo, "rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (r.code !== 0 || !r.out.trim()) return null;
  return join(r.out.trim(), "postmaster", "tickets");
}

/** A leg's attempt roles in order; [] when no attempts file, null when unreadable. */
function attemptRoles(dispatch: string, n: string): string[] | null {
  const file = join(dispatch, "logs", `coachman-leg-${n}-attempts.jsonl`);
  if (!existsSync(file)) return [];
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const roles: string[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as Record<string, unknown>;
      if (typeof row.role === "string" && row.role !== "") roles.push(row.role);
    } catch {
      continue;
    }
  }
  return roles;
}

function readAgents(
  dispatch: string,
  manifest: RecordOf,
  runJson: RecordOf,
): { agents: Agent[]; broken: string | null; extra: Finding[] } {
  const config = rec(runJson.config);
  const lanes = rec(config.lanes);
  const team = rec(config.team);
  const coachman = rec(team.coachman);
  const fallback = rec(team.coachman_fallback);
  const agents: Agent[] = [];
  const extra: Finding[] = [];
  const legs = rec(rec(manifest.coachman).legs);
  const legNumbers = Object.keys(legs)
    .filter((key) => /^\d+$/u.test(key)) // ASCII: manifest leg keys are ASCII digits
    .sort((a, b) => Number(a) - Number(b));
  const legNames = ["synthesis", "review", "ship"];
  const perLeg = rec(team.coachman_legs);
  let logNames: string[] = [];
  try {
    logNames = readdirSync(join(dispatch, "logs"));
  } catch {
    logNames = [];
  }
  const walledOrder = (file: string): number => {
    const attempt = /-walled-attempt-(\d+)-events\.jsonl$/u.exec(file)?.[1]; // ASCII: stream names are machine-made
    return attempt === undefined ? 0 : Number(attempt);
  };
  const walledName = (n: string, file: string): string => {
    const attempt = /-walled-attempt-(\d+)-events\.jsonl$/u.exec(file)?.[1]; // ASCII: stream names are machine-made
    return attempt ? `coachman leg ${n} walled attempt ${attempt}` : `coachman leg ${n} walled`;
  };
  for (const n of legNumbers) {
    // A leg on its own harness reads with it; the base is the fallback.
    const legName = legNames[Number(n) - 1] ?? "";
    const own = text(rec(perLeg[legName]).harness) || text(coachman.harness);
    const roleHarness = (role: string): string =>
      role === "coachman" ? own : role === "coachman_fallback" ? text(fallback.harness) : "";
    // A walled leg's renamed streams read beside its fresh one; their absence
    // is normal, so only present files join.
    const walled = logNames
      .filter(
        (name) => name.startsWith(`coachman-leg-${n}-walled`) && name.endsWith("-events.jsonl"),
      )
      .sort((a, b) => walledOrder(a) - walledOrder(b));
    // Takeovers rename the old stream, so a fresh stream with no walled
    // files beside it is the original attempt's. Where takeovers happened,
    // the attempts file attributes each stream to the role that wrote it.
    const roles = attemptRoles(dispatch, n);
    const spanning = roles !== null && new Set(roles).size > 1;
    // No attempt roles and no second harness: every attempt ran as the leg's
    // own, so the streams read with it. Unreadable attempts with a fallback
    // that differs cannot attribute the stream at all.
    const unambiguous = text(fallback.harness) === "" || text(fallback.harness) === own;
    if (walled.length === 0 && !spanning) {
      if (roles === null && !unambiguous) {
        extra.push({
          agent: `coachman leg ${n}`,
          finding: "unknown",
          form: "record",
          detail: "attempts cannot be read",
        });
        continue;
      }
      agents.push({
        name: `coachman leg ${n}`,
        file: `coachman-leg-${n}-events.jsonl`,
        harness: own,
        lane: "coachman",
        own: "",
      });
      continue;
    }
    if (spanning && walled.length === 0) {
      extra.push({
        agent: `coachman leg ${n}`,
        finding: "unknown",
        form: "record",
        detail: "attempts span roles",
      });
      continue;
    }
    if (roles === null || roles.length === 0) {
      if (unambiguous) {
        agents.push({
          name: `coachman leg ${n}`,
          file: `coachman-leg-${n}-events.jsonl`,
          harness: own,
          lane: "coachman",
          own: "",
        });
        for (const file of walled) {
          agents.push({ name: walledName(n, file), file, harness: own, lane: "coachman", own: "" });
        }
      } else {
        extra.push({
          agent: `coachman leg ${n}`,
          finding: "unknown",
          form: "record",
          detail: "attempts cannot be read",
        });
        for (const file of walled) {
          extra.push({
            agent: walledName(n, file),
            finding: "unknown",
            form: "record",
            detail: "attempts cannot be read",
          });
        }
      }
      continue;
    }
    const last = roles[roles.length - 1]!;
    const fresh = roleHarness(last);
    if (!fresh) {
      extra.push({
        agent: `coachman leg ${n}`,
        finding: "unknown",
        form: "record",
        detail: `role ${last} has no harness`,
      });
    } else {
      agents.push({
        name: `coachman leg ${n}`,
        file: `coachman-leg-${n}-events.jsonl`,
        harness: fresh,
        lane: "coachman",
        own: "",
      });
    }
    if (spanning) {
      for (const file of walled) {
        extra.push({
          agent: walledName(n, file),
          finding: "unknown",
          form: "record",
          detail: "attempts span roles",
        });
      }
    } else {
      const only = roleHarness(roles[0]!);
      for (const file of walled) {
        if (!only) {
          extra.push({
            agent: walledName(n, file),
            finding: "unknown",
            form: "record",
            detail: `role ${roles[0]} has no harness`,
          });
        } else {
          agents.push({
            name: walledName(n, file),
            file,
            harness: only,
            lane: "coachman",
            own: "",
          });
        }
      }
    }
  }
  const laneNames = Object.keys(rec(manifest.lanes)).sort();
  for (const lane of laneNames) {
    agents.push({
      name: lane,
      file: `${lane}-events.jsonl`,
      harness: text(rec(lanes[lane]).harness),
      lane,
      own: "",
    });
  }
  let actions = "";
  try {
    actions = readFileSync(join(dispatch, "actions.jsonl"), "utf8");
  } catch {
    return { agents, broken: "actions.jsonl cannot be read", extra };
  }
  const seen = new Set<string>();
  for (const line of actions.split("\n")) {
    if (!line.trim()) continue;
    let event: unknown;
    try {
      event = JSON.parse(line) as unknown;
    } catch {
      return { agents, broken: "actions.jsonl cannot be read", extra };
    }
    const record = rec(event);
    if (record.action !== "review-launch") continue;
    const detail = /^(\S+) round (\d+)\b/u.exec(text(record.detail)); // ASCII: review-launch details are machine-logged lines
    const lane = text(record.target);
    if (!detail || !lane) return { agents, broken: "a review launch cannot be read", extra };
    const key = `${detail[2]}:${detail[1]}:${lane}`;
    if (seen.has(key)) continue;
    seen.add(key);
    agents.push({
      name: `review r${detail[2]} ${detail[1]} ${lane}`,
      file: `review-r${detail[2]}-${detail[1]}-${lane}.jsonl`,
      harness: text(rec(lanes[lane]).harness),
      lane,
      own: "",
    });
  }
  // A stream-shaped record the inventory never names is still an agent's
  // record; it reads as unknown, never silently skipped. The inventory is
  // the manifest's files, not the attributed agents: a stream the check
  // cannot attribute is already reported once, under its own reason.
  const known = new Set(agents.map((agent) => agent.file));
  for (const n of legNumbers) {
    known.add(`coachman-leg-${n}-events.jsonl`);
    for (const name of logNames) {
      if (name.startsWith(`coachman-leg-${n}-walled`) && name.endsWith("-events.jsonl")) {
        known.add(name);
      }
    }
  }
  for (const name of logNames.sort()) {
    if (!name.endsWith(".jsonl")) continue;
    if (known.has(name)) continue;
    if (name.endsWith("-usage.json")) continue;
    if (/^review-r\d+\.jsonl$/u.test(name)) continue; // ASCII: round records are machine-made
    if (name.endsWith("-attempts.jsonl")) continue;
    if (name.includes("-claude-task-")) continue;
    if (!name.endsWith("-events.jsonl") && !/^review-r\d+-/u.test(name)) continue; // ASCII: stream names are machine-made
    extra.push({
      agent: "inventory",
      finding: "unknown",
      form: "record",
      detail: `unlisted ${name}`,
    });
  }
  return { agents, broken: null, extra };
}

/** An agent's events: its stream, and a claude lane's fork transcripts beside it. */
function readAgentEvents(
  dispatch: string,
  agent: Agent,
): { events: unknown[]; broken: string | null } {
  const path = join(dispatch, "logs", agent.file);
  if (!existsSync(path))
    return { events: [], broken: `${agent.name} record missing (${join("logs", agent.file)})` };
  const parsed = parseEventFile(path);
  if (parsed === null)
    return {
      events: [],
      broken: `${agent.name} record cannot be read (${join("logs", agent.file)})`,
    };
  const events = [...parsed];
  if (agent.harness === "claude") {
    const prefix = claudeTaskPrefix(agent.file, agent.lane);
    let names: string[] = [];
    try {
      names = readdirSync(join(dispatch, "logs"));
    } catch {
      return {
        events: [],
        broken: `${agent.name} record cannot be read (${join("logs", agent.file)})`,
      };
    }
    for (const name of names.sort()) {
      if (!name.startsWith(prefix)) continue;
      const task = parseEventFile(join(dispatch, "logs", name));
      if (task === null)
        return {
          events: [],
          broken: `${agent.name} task transcript cannot be read (${join("logs", name)})`,
        };
      events.push(...task);
    }
  }
  return { events, broken: null };
}

function ownFolder(
  ctx: Ctx,
  ticket: string,
  agent: Agent,
  review: { round: string; lens: string } | null,
): string {
  if (agent.name.startsWith("coachman leg ")) return join(ctx.repo, ".worktrees", ticket);
  if (review) return join(ctx.repo, ".worktrees", `${ticket}-rev-${review.lens}-${agent.lane}`);
  return join(ctx.repo, ".worktrees", `${ticket}-${agent.lane}`);
}

function reviewOf(agent: Agent): { round: string; lens: string } | null {
  const match = /^review r(\d+) (\S+) \S+$/u.exec(agent.name); // ASCII: reviewer names are machine-made
  return match ? { round: match[1]!, lens: match[2]! } : null;
}

function outcomeLine(reads: Finding[], unknowns: string[], titles: Finding[]): string {
  const parts: string[] = [];
  if (reads.length > 0) {
    const byAgent = new Map<string, string[]>();
    for (const finding of reads) {
      const forms = byAgent.get(finding.agent) ?? [];
      if (!forms.includes(finding.form)) forms.push(finding.form);
      byAgent.set(finding.agent, forms);
    }
    parts.push(
      `read by ${[...byAgent].map(([agent, forms]) => `${agent} (${forms.join("; ")})`).join(", ")}`,
    );
  }
  if (unknowns.length > 0) parts.push(`unknown (${[...new Set(unknowns)].join("; ")})`);
  if (titles.length > 0) {
    const byAgent = new Map<string, string[]>();
    for (const finding of titles) {
      const forms = byAgent.get(finding.agent) ?? [];
      if (!forms.includes(finding.form)) forms.push(finding.form);
      byAgent.set(finding.agent, forms);
    }
    parts.push(
      `title read by ${[...byAgent].map(([agent, forms]) => `${agent} (${forms.join("; ")})`).join(", ")}`,
    );
  }
  if (parts.length === 0) return "ticket-reads: not read";
  if (reads.length === 0 && unknowns.length === 0)
    return `ticket-reads: not read; ${parts.join("; ")}`;
  return `ticket-reads: ${parts.join("; ")}`;
}

function detailLine(finding: Finding): string {
  const what =
    finding.finding === "read" ? "read" : finding.finding === "title" ? "title" : "unknown";
  return `  ${finding.agent}: ${what} ${finding.form}${finding.detail ? ` ${finding.detail}` : ""}`;
}

function main(argv: string[]): number {
  const args = [...argv];
  let record = false;
  const rest: string[] = [];
  for (const arg of args) {
    if (arg === "--record") record = true;
    else rest.push(arg);
  }
  if (rest.length !== 1 || !rest[0]) {
    console.error("usage: run ticket-reads <dispatch> [--record]");
    return 1;
  }
  const dispatch = physical(rest[0]!);
  if (!isDir(dispatch)) {
    console.error(`ticket-reads: no such dir: ${rest[0]}`);
    return 1;
  }
  const failed = (reason: string): number => {
    const line = `ticket-reads: unknown (${reason})`;
    console.log(line);
    if (!record) return 0;
    return recordOutcome(dispatch, line);
  };
  // The record reads before the notes gate: without it the run cannot be told
  // held-back from given, so it reads as unknown, never as not checked.
  const runJson = readJson(join(dispatch, "run.json"));
  if (runJson === null) return failed("run.json cannot be read");
  if (ticketNotes(dispatch) !== "held-back") {
    console.log("ticket-reads: not checked (notes given)");
    return 0;
  }
  const manifest = readJson(join(dispatch, "manifest.json"));
  if (manifest === null) return failed("manifest.json cannot be read");
  let brief = "";
  try {
    brief = readFileSync(join(dispatch, "brief.md"), "utf8");
  } catch {
    return failed("brief.md cannot be read");
  }
  const scope = briefSection(brief, "## Project profile") || brief;
  const tracker = parseTracker(scope);
  const ticket = tracker.ticket || (/^\d+$/u.test(basename(dispatch)) ? basename(dispatch) : ""); // ASCII: ticket numbers are ASCII digits
  if (!ticket) return failed("the ticket cannot be told");
  if (tracker.kind !== "github" && tracker.kind !== "local") {
    return failed(tracker.kind ? `tracker kind ${tracker.kind}` : "the tracker cannot be told");
  }
  const profile = profileRepo(scope);
  const fallback = physical(join(dispatch, "..", "..", ".."));
  const repo = profile.repo ? physical(profile.repo) : fallback;
  if (!isDir(repo)) return failed("the repo cannot be read");
  const ctx: Ctx = {
    ticket,
    kind: tracker.kind,
    nwo: tracker.kind === "github" ? originNwo(repo) : null,
    repo,
    ticketPrefix: join(repo, ".worktrees", ticket),
    storeDir: tracker.kind === "local" ? storeDirOf(repo) : null,
    clerkDir: join(repo, ".postmaster", "clerk"),
  };
  const enumerated = readAgents(dispatch, manifest, runJson);
  const unknowns: string[] = [];
  if (enumerated.broken) unknowns.push(enumerated.broken);
  const reads: Finding[] = [];
  const titles: Finding[] = [];
  const seen = new Set<string>();
  for (const finding of enumerated.extra) {
    unknowns.push(`${finding.agent}: ${finding.form}${finding.detail ? ` ${finding.detail}` : ""}`);
  }
  for (const agent of enumerated.agents) {
    const own = ownFolder(ctx, ticket, agent, reviewOf(agent));
    if (!KNOWN_HARNESSES.includes(agent.harness)) {
      unknowns.push(`${agent.name}: harness ${agent.harness || "unknown"} has no reader`);
      continue;
    }
    const stream = readAgentEvents(dispatch, agent);
    if (stream.broken) {
      unknowns.push(stream.broken);
      continue;
    }
    const calls = toolCallsFromEvents(agent.harness as Harness, stream.events);
    for (const call of calls) {
      for (const finding of classifyCall(ctx, call, own)) {
        finding.agent = agent.name;
        const key = `${finding.agent}${finding.finding}${finding.form}${finding.detail}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (finding.finding === "read") reads.push(finding);
        else if (finding.finding === "title") titles.push(finding);
        else
          unknowns.push(
            `${finding.agent}: ${finding.form}${finding.detail ? ` ${finding.detail}` : ""}`,
          );
      }
    }
  }
  const line = outcomeLine(reads, unknowns, titles);
  console.log(line);
  for (const finding of [...reads, ...titles]) console.log(detailLine(finding));
  for (const reason of new Set(unknowns)) console.log(`  unknown ${reason}`);
  if (!record) return 0;
  return recordOutcome(dispatch, line);
}

function recordOutcome(dispatch: string, line: string): number {
  const logged = run(RUN, ["run-log", dispatch, line]);
  if (logged.code !== 0) {
    console.error(`ticket-reads: cannot write the run log: ${logged.err.trim() || line}`);
    return 1;
  }
  const noted = run(RUN, ["log-action", dispatch, "postmaster", "note", "ticket-reads", line]);
  if (noted.code !== 0) {
    console.error(`ticket-reads: cannot write the note: ${noted.err.trim() || line}`);
    return 1;
  }
  return 0;
}

if (import.meta.main) {
  process.exitCode = main(process.argv.slice(2));
}
