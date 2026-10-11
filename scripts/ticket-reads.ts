// Look through every agent's record for a read of the run's ticket text,
// after a run without the notes merges.
//
//   run ticket-reads <dispatch> [--record]
//
// The agents are the manifest's coachman legs and workhorse lanes, and the
// reviewers its review-launch lines name. Each leg reads with its own harness
// where team.coachman_legs names one, and a walled leg's renamed streams read
// beside its fresh one. Each agent's record is its event stream in
// <dispatch>/logs/, read with the per-harness tool-call reader the reach
// control shares, plus a claude lane's fork transcripts beside it. The check
// classifies executed tool calls, never prose: brief and prompt text sits in
// the same records and names the same read forms.
//
// What counts as a read of the text, by tracker kind. GitHub: gh issue view
// printing the body or comments; gh api on repos/<owner>/<repo>/issues/<n>
// or its comments with a reading method; gh api graphql naming the issue in
// the run's repository; scripts/run github <repo> read <n>; and a fetch of
// the issue's web address. Local: scripts/run local <repo> read <n>, and a
// read of the ticket's file in the store under
// <git-common-dir>/postmaster/tickets/. Any kind: a read of
// .postmaster/clerk/<n>.md in the project. A read of the title or state
// alone is named and is not a read of the text.
//
// What counts as unknown, never clean. A record that is missing or cannot be
// read, a run whose run.json cannot be read, a harness with no reader, a
// tracker of a kind beyond github and local, and a command that names the
// ticket in a form the check does not know: another gh issue verb beyond
// comment, close and reopen, an adapter search or a verb the adapters do not
// have, another issues subpath, a --json field beyond title and state, a
// listing of the ticket file, a search across the ticket store, a graphql
// query whose repository cannot be told, and a relative path after a cd the
// check cannot follow. Known writes and mutating api calls show no ticket
// text and count for nothing. A failed command read nothing and counts
// for nothing; where the record carries no exit, the invocation counts.
// Only the run's own ticket in its own tracker counts: another number,
// another repo and the wrong tracker are ignored, and so is a number in a
// command that reads nothing. The thread exports in <dispatch>/sessions/
// are the same threads in harness-native form and are not read. Segments
// split on newlines as well as shell separators; (...) groups, cd and
// command substitutions are followed, and find and xargs scans of the ticket
// directories read as unknown, since their -exec is not followed.
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
  "tee",
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

function stripQuotes(value: string): string {
  return value.replace(/^['"]+/u, "").replace(/['"]+$/u, "");
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
  if (command.startsWith("/bin/bash -lc '")) {
    const inner = command.slice("/bin/bash -lc '".length);
    return inner.endsWith("'") ? inner.slice(0, -1) : inner;
  }
  return command;
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
    const heredoc = /<<-?[ \t]*['"]?([A-Za-z0-9_]+)['"]?/u.exec(line);
    if (heredoc) {
      terminator = heredoc[1]!;
      const head = line.slice(0, heredoc.index);
      if (head.trim()) kept.push(head);
      continue;
    }
    kept.push(line);
  }
  return kept.join("\n");
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
  for (const char of flat) {
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
    } else if (char === "(") {
      if (current.endsWith("$")) current = current.slice(0, -1);
      pushCurrent();
      depth = 1;
    } else if (char === ")") {
      pushCurrent();
    } else if (char === ";" || char === "|" || char === "&" || char === "\n") {
      pushCurrent();
    } else {
      current += char;
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
 * beside the segment that carries it.
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
      else if (char === "$" && segment[i + 1] === "(") {
        const [body, end] = balancedBody(segment, i + 2);
        bodies.push(body);
        i = end;
        continue;
      }
      i++;
    } else if (quote === '"') {
      if (char === '"') quote = null;
      else if (char === "$" && segment[i + 1] === "(") {
        const [body, end] = balancedBody(segment, i + 2);
        bodies.push(body);
        i = end;
        continue;
      } else if (char === "`") {
        const end = segment.indexOf("`", i + 1);
        bodies.push(end < 0 ? segment.slice(i + 1) : segment.slice(i + 1, end));
        i = end < 0 ? segment.length : end + 1;
        continue;
      }
      i++;
    } else if (char === "'" || char === '"' || char === "`") {
      quote = char;
      i++;
    } else if (char === "$" && segment[i + 1] === "(") {
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
    } else if (char === "`") {
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
function classifyCommand(ctx: Ctx, command: string, own: string | null, depth = 0): Finding[] {
  const findings: Finding[] = [];
  let cwd = own;
  for (const part of splitParts(command)) {
    if (part.kind === "subshell") {
      findings.push(...classifyCommand(ctx, part.text, cwd, depth));
      continue;
    }
    findings.push(...classifySegment(ctx, part.text, cwd, depth));
    for (const body of substitutionBodies(part.text)) {
      findings.push(...classifyCommand(ctx, body, cwd, depth));
    }
    cwd = cdAfter(cwd, part.text);
  }
  return findings;
}

function baseVerb(word: string): string {
  return word.split("/").pop() ?? word;
}

interface Head {
  verb: string;
  words: string[];
  at: number;
}

/** The segment's command word, past sudo, env and assignments. */
function segmentHead(segment: string): Head {
  const words = segment.trim().split(/\s+/u).filter(Boolean); // ASCII: shell words split on ASCII whitespace
  let at = 0;
  while (at < words.length) {
    const word = words[at]!;
    if (word === "sudo" || word === "env" || /^[A-Za-z_][A-Za-z0-9_]*=/u.test(word)) at++;
    else break;
  }
  return { verb: baseVerb(words[at] ?? ""), words, at };
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
      return value ? value.toUpperCase() : "?";
    }
    const stuck = /^-X([A-Za-z]+)$/u.exec(word); // ASCII: HTTP methods are ASCII
    if (stuck) return stuck[1]!.toUpperCase();
    if (word.startsWith("--method=")) {
      const value = word.slice("--method=".length);
      return value ? value.toUpperCase() : "?";
    }
  }
  return null;
}

/** A graphql issue read against the run's repository: read, ignored, or unknown. */
function graphqlRepoFinding(ctx: Ctx, segment: string): Finding | null {
  const repos = new Set<string>();
  const ownerFirst = /owner\s*:\s*"([^"]+)"\s*,\s*name\s*:\s*"([^"]+)"/giu; // ASCII: graphql names are ASCII
  const nameFirst = /name\s*:\s*"([^"]+)"\s*,\s*owner\s*:\s*"([^"]+)"/giu;
  for (const match of segment.matchAll(ownerFirst)) repos.add(`${match[1]}/${match[2]}`);
  for (const match of segment.matchAll(nameFirst)) repos.add(`${match[2]}/${match[1]}`);
  if (repos.size !== 1 || ctx.nwo === null) {
    return { agent: "", finding: "unknown", form: "gh api graphql", detail: "repo unknown" };
  }
  const [nwo] = [...repos];
  if (!sameNwo(nwo!, ctx.nwo)) return null;
  return { agent: "", finding: "read", form: "gh api graphql", detail: "" };
}

/** Classify one gh segment; null when it is not this ticket. */
function classifyGh(ctx: Ctx, segment: string, head: Head): Finding | null {
  if (ctx.kind !== "github") return null;
  const words = head.words;
  const i = skipFlags(words, head.at + 1);
  const sub = words[i] ?? "";
  const flags = scanFlags(words.slice(head.at));
  if (sub === "issue") {
    const verb = words[skipFlags(words, i + 1)] ?? "";
    // A known write shows no ticket text; any other verb may display it.
    if (verb === "comment" || verb === "close" || verb === "reopen") return null;
    if (verb !== "view") {
      if (!hasNumberToken(segment, ctx.ticket)) return null;
      return { agent: "", finding: "unknown", form: `gh issue ${verb}`.trim(), detail: "" };
    }
    // A number inside another repo's address is not a bare target.
    const deurl = segment.replace(/https?:\/\/github\.com\/\S+/gu, " "); // ASCII: issue addresses are machine-made ASCII
    const bare = hasNumberToken(deurl, ctx.ticket);
    let sameUrl = false;
    for (const url of issueUrls(segment)) {
      if (url.number !== ctx.ticket) continue;
      if (ctx.nwo === null) {
        return { agent: "", finding: "unknown", form: "gh issue view", detail: "repo unknown" };
      }
      if (sameNwo(url.nwo, ctx.nwo)) sameUrl = true;
    }
    if (!bare && !sameUrl) return null;
    const override = ghRepoOverride(segment, flags.repo);
    if (override !== null) {
      const want = repoValue(override);
      if (!want)
        return { agent: "", finding: "unknown", form: "gh issue view", detail: "repo unknown" };
      if (ctx.nwo === null)
        return { agent: "", finding: "unknown", form: "gh issue view", detail: "repo unknown" };
      if (!sameNwo(want, ctx.nwo)) return null;
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
  if (sub === "api") {
    if (/graphql/u.test(segment)) {
      if (!hasNumberToken(segment, ctx.ticket)) return null;
      // A mutation writes; its payload carries no issue text back.
      if (/\bmutation\s*(\{|\(|[A-Za-z_])/iu.test(segment)) return null;
      if (!/issues?/iu.test(segment)) {
        return { agent: "", finding: "unknown", form: "gh api graphql", detail: "" };
      }
      return graphqlRepoFinding(ctx, segment);
    }
    const method = ghApiMethod(segment);
    if (method !== null && method !== "GET") {
      // A mutating call shows no ticket text; HEAD returns headers alone.
      // An unreadable method naming the ticket cannot be told.
      if (
        method === "POST" ||
        method === "PUT" ||
        method === "PATCH" ||
        method === "DELETE" ||
        method === "HEAD"
      ) {
        return null;
      }
      if (hasNumberToken(segment, ctx.ticket)) {
        return { agent: "", finding: "unknown", form: "gh api", detail: method };
      }
      return null;
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
      if (rest === "" || rest === "/comments") {
        return { agent: "", finding: "read", form: "gh api", detail: rest || "" };
      }
      return { agent: "", finding: "unknown", form: "gh api", detail: rest };
    }
    // Another repo's issue explains the number; anything else naming it is unknown.
    if (otherRepo) return null;
    if (hasNumberToken(segment, ctx.ticket)) {
      return { agent: "", finding: "unknown", form: "gh api", detail: "" };
    }
    return null;
  }
  if (sub === "search" || sub === "browse") {
    if (!hasNumberToken(segment, ctx.ticket)) return null;
    return { agent: "", finding: "unknown", form: `gh ${sub}`, detail: "" };
  }
  return null;
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

/** Classify one adapter (run github/local, legacy .sh/.ts) segment; null when not this ticket. */
function classifyAdapter(
  ctx: Ctx,
  tool: "github" | "local",
  words: string[],
  at: number,
  own: string | null,
  segment: string,
): Finding | null {
  if ((tool === "github") !== (ctx.kind === "github")) return null;
  const repoArg = words[at] ?? "";
  const verb = words[at + 1] ?? "";
  if (!repoArg || !verb) return null;
  const same = sameProject(ctx, repoArg, own);
  if (same === false) return null;
  if (same === null) {
    if (!hasNumberToken(segment, ctx.ticket)) return null;
    return { agent: "", finding: "unknown", form: `run ${tool} ${verb}`, detail: "repo unknown" };
  }
  const target = stripQuotes(words[at + 2] ?? "").replace(/^#+/u, "");
  if (verb === "read") {
    if (target !== ctx.ticket) return null;
    return { agent: "", finding: "read", form: `run ${tool} read`, detail: "" };
  }
  if (verb === "state") {
    if (target !== ctx.ticket) return null;
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
    return null;
  }
  if (!hasNumberToken(segment, ctx.ticket)) return null;
  return { agent: "", finding: "unknown", form: `run ${tool} ${verb}`, detail: "" };
}

/** Classify one fetch segment; null when it fetches no issue of this ticket. */
function classifyFetch(ctx: Ctx, segment: string): Finding | null {
  if (ctx.kind !== "github") return null;
  for (const url of issueUrls(segment)) {
    if (url.number !== ctx.ticket) continue;
    if (ctx.nwo === null) {
      return { agent: "", finding: "unknown", form: "issue fetch", detail: "repo unknown" };
    }
    if (sameNwo(url.nwo, ctx.nwo)) {
      return { agent: "", finding: "read", form: "issue fetch", detail: "" };
    }
  }
  return null;
}

const STORE_FILE_RE =
  /(?:^|[ \t\r\n;&|()<>"'`])([~$A-Za-z0-9_@./-]*postmaster\/tickets\/\d+\.(?:md|json))/gu; // ASCII: store paths match ASCII
const CLERK_FILE_RE =
  /(?:^|[ \t\r\n;&|()<>"'`])([~$A-Za-z0-9_@./-]*\.postmaster\/clerk\/[^ \t\r\n;&|()<>"'`]+)/gu;
const STORE_DIR_RE = /[~$A-Za-z0-9_@./-]*postmaster\/tickets(?=[/\s"'`;&|()]|$)/u; // ASCII: store paths match ASCII
const CLERK_DIR_RE = /[~$A-Za-z0-9_@./-]*\.postmaster\/clerk(?=[/\s"'`;&|()]|$)/u; // ASCII: clerk paths match ASCII

/** Another ticket's file under a ticket directory: numbered, and not this run's. */
function isSiblingTicketFile(absolute: string, ticket: string): boolean {
  const sibling = /^(\d+)\.(md|json)$/u.exec(basename(absolute));
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

/** Classify the store and clerk paths one segment names. */
function classifyPaths(ctx: Ctx, segment: string, verb: string, own: string | null): Finding[] {
  const findings: Finding[] = [];
  const reading = READ_VERBS.has(verb);
  // A scan can run a reader over the directory unseen; its -exec is not followed.
  const scanning = reading || SCAN_VERBS.has(verb);
  const seen = new Set<string>();
  const fileRes = [...segment.matchAll(STORE_FILE_RE), ...segment.matchAll(CLERK_FILE_RE)];
  for (const match of fileRes) {
    const candidate = match[1]!;
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    const place = placePath(ctx, candidate, own);
    const form = candidate.includes(".postmaster/clerk/") ? "clerk draft" : "ticket file";
    if (place === "file") {
      findings.push(
        reading
          ? { agent: "", finding: "read", form, detail: "" }
          : { agent: "", finding: "unknown", form, detail: verb || "bare" },
      );
    } else if (place === "meta") {
      findings.push(
        reading
          ? { agent: "", finding: "title", form, detail: "" }
          : { agent: "", finding: "unknown", form, detail: verb || "bare" },
      );
    } else if (place === "dir") {
      if (scanning)
        findings.push({ agent: "", finding: "unknown", form: `${form} dir`, detail: "" });
    } else if (place === "unknown") {
      findings.push({ agent: "", finding: "unknown", form, detail: "path unknown" });
    }
  }
  if (findings.length === 0) {
    for (const re of [STORE_DIR_RE, CLERK_DIR_RE]) {
      const dir = re.exec(segment)?.[0];
      if (!dir) continue;
      // A directory already read as part of a file path is not read again.
      if ([...seen].some((file) => file.startsWith(dir))) continue;
      const place = placePath(ctx, dir, own);
      if (place === "dir" && scanning) {
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
      }
    }
  }
  return findings;
}

/** Classify one shell segment against every form the check names. */
function classifySegment(ctx: Ctx, segment: string, own: string | null, depth = 0): Finding[] {
  const findings: Finding[] = [];
  const head = segmentHead(segment);
  if (!head.verb) return findings;
  // A -c string runs its own command; classify what it runs instead.
  if (SHELL_WRAPPERS.has(head.verb) && depth < 2) {
    const next = head.words[head.at + 1] ?? "";
    if (head.verb === "eval" || next === "-c") {
      const inner = head.words.slice(head.at + (head.verb === "eval" ? 1 : 2)).join(" ");
      findings.push(...classifyCommand(ctx, stripQuotes(inner.trim()), own, depth + 1));
      return findings;
    }
  }
  if (head.verb === "gh") {
    const found = classifyGh(ctx, segment, head);
    if (found) findings.push(found);
  } else if (head.verb === "run") {
    const tool = head.words[head.at + 1] ?? "";
    if (tool === "github" || tool === "local") {
      const found = classifyAdapter(ctx, tool, head.words, head.at + 2, own, segment);
      if (found) findings.push(found);
    }
  } else if (
    head.verb === "github.sh" ||
    head.verb === "local.sh" ||
    head.verb === "github.ts" ||
    head.verb === "local.ts"
  ) {
    const tool = head.verb.startsWith("github") ? "github" : "local";
    const found = classifyAdapter(ctx, tool, head.words, head.at + 1, own, segment);
    if (found) findings.push(found);
  } else if (["bun", "node", "deno", "bash", "sh"].includes(head.verb) && depth < 2) {
    const script = baseVerb(head.words[head.at + 1] ?? "");
    if (
      script === "github.ts" ||
      script === "local.ts" ||
      script === "github.sh" ||
      script === "local.sh"
    ) {
      const tool = script.startsWith("github") ? "github" : "local";
      const found = classifyAdapter(ctx, tool, head.words, head.at + 2, own, segment);
      if (found) findings.push(found);
    }
  } else if (FETCH_VERBS.has(head.verb)) {
    const found = classifyFetch(ctx, segment);
    if (found) findings.push(found);
  }
  findings.push(...classifyPaths(ctx, segment, head.verb, own));
  return findings;
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

/** Classify one tool call's command, paths and fetches. */
function classifyCall(ctx: Ctx, call: ToolCall, own: string): Finding[] {
  if (failedExit(call.exitCode)) return [];
  const findings: Finding[] = [];
  const command = inputCommand(call.input);
  if (command) {
    findings.push(...classifyCommand(ctx, command, own));
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
  return findings;
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

function readAgents(
  dispatch: string,
  manifest: RecordOf,
  runJson: RecordOf,
): { agents: Agent[]; broken: string | null } {
  const config = rec(runJson.config);
  const lanes = rec(config.lanes);
  const team = rec(config.team);
  const coachman = rec(team.coachman);
  const agents: Agent[] = [];
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
    const attempt = /-walled-attempt-(\d+)-events\.jsonl$/u.exec(file)?.[1];
    return attempt === undefined ? 0 : Number(attempt);
  };
  for (const n of legNumbers) {
    // A leg on its own harness reads with it; the base is the fallback.
    const legName = legNames[Number(n) - 1] ?? "";
    const harness = text(rec(perLeg[legName]).harness) || text(coachman.harness);
    agents.push({
      name: `coachman leg ${n}`,
      file: `coachman-leg-${n}-events.jsonl`,
      harness,
      lane: "coachman",
      own: "",
    });
    // A walled leg's renamed streams read beside its fresh one; their absence
    // is normal, so only present files join.
    const walled = logNames
      .filter(
        (name) => name.startsWith(`coachman-leg-${n}-walled`) && name.endsWith("-events.jsonl"),
      )
      .sort((a, b) => walledOrder(a) - walledOrder(b));
    for (const file of walled) {
      const attempt = /-walled-attempt-(\d+)-events\.jsonl$/u.exec(file)?.[1];
      agents.push({
        name: attempt ? `coachman leg ${n} walled attempt ${attempt}` : `coachman leg ${n} walled`,
        file,
        harness,
        lane: "coachman",
        own: "",
      });
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
    return { agents, broken: "actions.jsonl cannot be read" };
  }
  const seen = new Set<string>();
  for (const line of actions.split("\n")) {
    if (!line.trim()) continue;
    let event: unknown;
    try {
      event = JSON.parse(line) as unknown;
    } catch {
      return { agents, broken: "actions.jsonl cannot be read" };
    }
    const record = rec(event);
    if (record.action !== "review-launch") continue;
    const detail = /^(\S+) round (\d+)\b/u.exec(text(record.detail)); // ASCII: review-launch details are machine-logged lines
    const lane = text(record.target);
    if (!detail || !lane) return { agents, broken: "a review launch cannot be read" };
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
  return { agents, broken: null };
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
