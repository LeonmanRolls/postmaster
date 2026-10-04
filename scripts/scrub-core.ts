import { closeSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { scan as scanPersonal } from "./scrub-patterns.ts";
import { BOUND_L, BOUND_R, PY_S_CLASS, pyLower, pyWords } from "./lib/text.ts";

export const RULES = new Set([
  "key",
  "account-id",
  "email",
  "private-path",
  "private-host",
  "token",
  "dotenv",
  "assistant-attribution",
  "marker",
  "encrypted-reasoning",
  "sign-off",
  "author-field",
  "copyright",
  "git-identity",
  "title",
  "self-introduction",
  "relative",
  "credit",
  "name-and-address",
  "phone",
  "card",
  "iban",
  "ssn",
  "id-number",
  "date-of-birth",
  "health",
  "income",
  "family",
  "residence",
  "employer",
  "street",
  "postcode",
  "po-box",
  "address-field",
]);

export interface Finding {
  start: number;
  end: number;
  rule: string;
  value: string;
}

export interface MarkerFault {
  start: number;
  end: number;
  line?: number;
}

export interface ScanResult {
  findings: Finding[];
  suppressed: Finding[];
  markers: MarkerFault[];
  nextLineMarkers: Array<{ start: number; end: number; rule: string | null; valid: boolean }>;
}

export interface Unit {
  text: string;
  map: Array<[number, number]> | null;
  source: number | null;
  physical: boolean;
}

const SPACE = `[${PY_S_CLASS}]`;
const FIELD_VALUE = new RegExp(
  `(?<![\\p{L}\\p{N}_])(?<name>[\\p{L}][\\p{L}\\p{N}_.-]*)${BOUND_R}${SPACE}*["']?${SPACE}*[:=]${SPACE}*(?:"(?<double>[^"\\n]+)"|'(?<single>[^'\\n]+)'|(?<bare>[^${PY_S_CLASS}"',;}\\]]+))`,
  "gu",
);
const ABSENT = /^(?:null|none|true|false|n\/?a|\.{2,}|<[^<>]*>)$/iu;
const MAIL =
  /(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]+@((?:[\p{L}\p{N}-]+\.)+[\p{L}]{2,})(?![\p{L}\p{N}-])/gu;
const SECRET_TOKEN_ENDINGS = new Set([
  "secret",
  "secrets",
  "password",
  "passwd",
  "pwd",
  "pass",
  "passcode",
  "passphrase",
  "token",
  "tokens",
  "key",
  "keys",
  "apikey",
  "privatekey",
  "secretkey",
  "accesstoken",
  "refreshtoken",
  "credential",
  "credentials",
  "auth",
]);
const SECRET_TOKEN_SUFFIXES = [
  "password",
  "passwd",
  "passcode",
  "passphrase",
  "secret",
  "secrets",
  "token",
  "tokens",
  "credential",
  "credentials",
  "auth",
];
const SECRET_KEY_ENDINGS = new Set(["email", "mail", "session"]);
const SECRET_KEY_SUFFIXES = ["email", "session"];
const SECRET_ID_ENDINGS = new Set(["id", "ids", "uuid", "guid"]);
const PLACEHOLDER =
  /^(?:user|username|host|hostname|example|test|fixture|placeholder|someone|remote|node|server|machine|myhost|yourhost|examplehost|\*|\$USER|\$\{USER\}|<[^<>]*>)$/iu;
// A line needs the full rules only when it shows a trigger: punctuation a
// rule needs, an ANSI opener, curly quotes, capitals beside a digit (AKIA,
// IBAN, postcodes), or a cue word. Every trigger below names a literal
// every match of its rule contains; a line with none of them cannot carry
// a finding. The gate (C4-C7, C23, C28), the held-out counts (C6) and a
// census diff prove no finding is lost. Key-block lines never skip: their
// caller passes keyBlock, and scanLine honors it before this check.
const PREFILTER_WORDS = [
  "account",
  "addr",
  "adhd",
  "according",
  "akia",
  "amex",
  "american express",
  "anxiety",
  "apartment",
  "asia",
  "ask",
  "assigned",
  "assignee",
  "aunt",
  "autism",
  "author",
  "baby",
  "based",
  "bearer",
  "behalf",
  "birth",
  "birthday",
  "born",
  "boss",
  "box",
  "boyfriend",
  "brother",
  "call",
  "cancer",
  "card",
  "cc",
  "cell",
  "cheers",
  "chemo",
  "children",
  "committer",
  "compensation",
  "contact",
  "contribut",
  "copyright",
  "courtesy",
  "cousin",
  "created",
  "credit",
  "customer",
  "dad",
  "dame",
  "daughter",
  "day job",
  "debit",
  "debt",
  "depression",
  "diabetes",
  "diagnosed",
  "diagnosis",
  "dialysis",
  "disability",
  "dob",
  "drafted",
  "dr",
  "driver",
  "earn",
  "emergency",
  "employer",
  "fax",
  "father",
  "fianc",
  "flat",
  "generated",
  "girlfriend",
  "grandfather",
  "grandma",
  "grandpa",
  "grew up",
  "hiv",
  "home",
  "hospital",
  "hometown",
  "house",
  "husband",
  "i am",
  "id number",
  "identity",
  "illness",
  "income",
  "kid",
  "kudos",
  "landline",
  "licen",
  "live",
  "living",
  "made",
  "maintain",
  "make",
  "manager",
  "mastercard",
  "medication",
  "meds",
  "membership",
  "miscarriage",
  "miss",
  "mobile",
  "mom",
  "mother",
  "mortgage",
  "mr",
  "ms",
  "mum",
  "mx",
  "name",
  "national",
  "national insurance",
  "nephew",
  "networth",
  "nhs",
  "ni number",
  "niece",
  "nino",
  "office",
  "oncologist",
  "owner",
  "parent",
  "partner",
  "passport",
  "patient",
  "pay",
  "pension",
  "phone",
  "pregnancy",
  "pregnant",
  "prescription",
  "prof",
  "psychiatrist",
  "rehab",
  "rent",
  "report",
  "reside",
  "review",
  "ring",
  "salary",
  "scp",
  "sibling",
  "signal",
  "signed",
  "signer",
  "sir",
  "sister",
  "son",
  "social security",
  "spouse",
  "ssh",
  "ssn",
  "suffer",
  "surgery",
  "tax",
  "tel",
  "text me",
  "thank",
  "therapist",
  "therapy",
  "toddler",
  "treated",
  "treatment",
  "uncle",
  "undergoing",
  "visa",
  "wage",
  "whatsapp",
  "whats",
  "wife",
  "work",
  "workplace",
  "written",
  "antidepressant",
];
// Substring search, not one big alternation: under a virtual-memory limit
// the engine's JIT stays off and a 150-branch match-all-positions scan
// costs milliseconds per line, while memmem stays microseconds (C27).
// A spaced card number is digits and spaces alone: no word or case signal
// opens it, so its digit groups trigger on their own.
const PREFILTER_PUNCT = [
  "@",
  "/",
  "~",
  "\\",
  '"',
  "'",
  ":",
  "=",
  "-",
  "_",
  ".",
  "+",
  "(",
  ")",
  "{",
  "}",
  "[",
  "]",
  "‘",
  "’",
  "“",
  "”",
  "\x1b",
  "\x9b",
  "\x9d",
];
const PREFILTER_SPACED_CARD = /[0-9]{4} [0-9]/u;
const PREFILTER_UPPER = /[A-Z]/u;
const PREFILTER_DIGIT = /[0-9]/u;
const PREFILTER_NON_ASCII = /[^\x00-\x7F]/u;
export function needsFullScan(line: string): boolean {
  for (const p of PREFILTER_PUNCT) if (line.includes(p)) return true;
  if (PREFILTER_SPACED_CARD.test(line)) return true;
  // Uppercase plus a digit together: an IBAN head, a street or postcode, a key.
  const upper = PREFILTER_UPPER.test(line);
  if (upper && PREFILTER_DIGIT.test(line)) return true;
  // Lowercasing is the identity on ASCII without capitals, so those lines
  // search raw and allocate nothing; the rest lowercase once and share it.
  if (!upper && !PREFILTER_NON_ASCII.test(line)) {
    for (const w of PREFILTER_WORDS) if (line.includes(w)) return true;
    return false;
  }
  const lower = pyLower(line);
  for (const w of PREFILTER_WORDS) if (lower.includes(w)) return true;
  return false;
}
const SSH_PRIVATE_HEADER = "---- BEGIN SSH2 ENCRYPTED PRIV" + "ATE KEY ----";
const KEY_HEADER = new RegExp(
  "-----BEGIN (?:[A-Z0-9 ]*PRIV" +
    "ATE KEY|PGP PRIVATE KEY BLOCK)-----|" +
    SSH_PRIVATE_HEADER +
    "|PuTTY-User-Key-File-[23]:",
  "iu",
);
const KEY_END = /-----END [^-]*-----|---- END SSH2 [^-]* ----|^Private-MAC:/iu;
const KEY_BODY = /^[A-Za-z0-9+/=]{20,}$/u;
const KEY_FIELD = new RegExp(`^[A-Za-z-]+:${SPACE}*[^${PY_S_CLASS}]`, "u");
const MARKER_HEAD = /(?<![A-Za-z0-9_.-])private-data:allow/gu;
const MARKER_BODY = new RegExp(
  `^private-data:allow(-next-line)?${SPACE}+([^${PY_S_CLASS}]+)${SPACE}+--${SPACE}+([^${PY_S_CLASS}].*)$`,
  "u",
);
const MARKER_BOUNDARY = /[A-Za-z0-9_-]/u;
const ANSI =
  /(?:\x1b\[[0-9:;<=>?]*[ -/]*[@-~]|\x9b[0-9:;<=>?]*[ -/]*[@-~]|\x1b\][^\x07\x1b\x9c]*(?:\x07|\x1b\\|\x9c)|\x9d[^\x07\x1b\x9c]*(?:\x07|\x1b\\|\x9c)|\x1b[()][0-9A-Za-z]|\x1b[0-~]|\x1b)/gu;
const ANSI_OSC_PARAMS = /(?:\x1b\]|\x9d)([^\x07\x1b\x9c]*)(?:\x07|\x1b\\|\x9c)/gu;
const MAX_JSON_DEPTH = 64;
const PATTERN_CODE = new RegExp(
  `${BOUND_L}new${SPACE}+RegExp${SPACE}*\\(${BOUND_L}P\\(${SPACE}*["'](?:email|ipv4|ipv6|phone|address)["']${SPACE}*,${SPACE}*["']search["']|^(?:export${SPACE}+)?const${SPACE}+[A-Z_]+${SPACE}*=${SPACE}*\\/`,
  "u",
);
// Flags a regex literal may carry; anything else after the closing slash
// means the line is not the declaration the exemption is for.
const REGEX_FLAGS = new Set(["d", "g", "i", "m", "s", "u", "v", "y"]);

// The span a pattern-code line exempts: the regex literal or RegExp call
// alone, never the whole line. Null when the construct does not validate,
// so an unrecognized shape scans in full rather than passing unseen.
function patternSpan(line: string): [number, number] | null {
  const m = PATTERN_CODE.exec(line);
  if (!m || m.index === undefined) return null;
  if (m[0].startsWith("new")) {
    const open = line.indexOf("(", m.index);
    if (open < 0) return null;
    let depth = 0;
    let quote = "";
    for (let i = open; i < line.length; i++) {
      const ch = line[i]!;
      if (quote) {
        if (ch === "\\") i++;
        else if (ch === quote) quote = "";
        continue;
      }
      if (ch === "'" || ch === '"' || ch === "`") {
        quote = ch;
        continue;
      }
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) return [m.index, i + 1];
      }
    }
    return null;
  }
  let i = m.index + m[0].length - 1;
  if (line[i] !== "/") return null;
  i++;
  let inClass = false;
  while (i < line.length) {
    const ch = line[i]!;
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "[") {
      inClass = true;
      i++;
      continue;
    }
    if (ch === "]") {
      inClass = false;
      i++;
      continue;
    }
    if (ch === "/" && !inClass) break;
    if (ch === "\n" || ch === "\r") return null;
    i++;
  }
  if (i >= line.length || line[i] !== "/") return null;
  i++;
  while (i < line.length && REGEX_FLAGS.has(line[i]!)) i++;
  const rest = line.slice(i, i + 1);
  if (
    rest !== "" &&
    rest !== ";" &&
    rest !== "," &&
    rest !== ")" &&
    rest !== " " &&
    rest !== "\t" &&
    rest !== "/"
  )
    return null;
  return [m.index + m[0].length - 1, i];
}

function blankSpan(line: string, span: [number, number] | null): string {
  if (!span) return line;
  return line.slice(0, span[0]) + " ".repeat(span[1] - span[0]) + line.slice(span[1]);
}
const TOKEN_SIGNAL =
  // ASCII: token prefixes are fixed ASCII spellings; the boundary is on ASCII keywords.
  /(?:gh[pours]_|github_pat_|sk[_-](?:live|test)|sk-|xox|ya29\.|\bbearer\b|AKIA|ASIA|PRIVATE KEY|SSH2 ENCRYPTED|PuTTY-User-Key|AGE-SECRET-KEY|[:=])|^[A-Za-z0-9+/=]{20,}$/iu;
// A dotenv value that opens one of these is composed in code, not assigned.
const DOTENV_SPLIT = new RegExp(`["'(){}\\[\\x60]|\\$[{A-Za-z_(]`, "u");
// A value that only names names holds no secret (oracle-102's PASS_NAMES).
const DOTENV_LIST = new RegExp(
  `^[A-Za-z_][A-Za-z0-9_-]*(?:[,${PY_S_CLASS}]+[A-Za-z_][A-Za-z0-9_-]*)+$`,
  "u",
);
const WS_CHAR = new RegExp(`^[${PY_S_CLASS}]$`, "u");
const WS_RUN = new RegExp(`[${PY_S_CLASS}]+`, "u");
// A field value that expands or substitutes is an expression, not a leak.
const FIELD_EXPANSION = new RegExp(`\\$[{A-Za-z_(]|\\x60`, "u");
const DOTENV_LINE = new RegExp(
  `^${SPACE}*(?:export${SPACE}+)?([A-Za-z_][A-Za-z0-9_-]*)${SPACE}*=${SPACE}*(.+?)${SPACE}*$`,
  "ud",
);
const DOTENV_COMMENT_ONLY = new RegExp(`^#(?:${SPACE}|$)`, "u");
const DOTENV_COMMENT_CUT = new RegExp(`${SPACE}+#`, "u");
const PRIVATE_SIGNAL =
  // ASCII: ssh/scp/bearer are ASCII keywords; hosts match explicit classes.
  /\/(?:home|Users)\/|~\/|~[A-Za-z0-9._-]+\/|[A-Za-z]:\\|\b(?:ssh|scp)\s|(?:account|org(?:anization)?|session|thread|credential|identity|user)[_-]?(?:id|uuid|guid)\b|co-authored-by|generated-with|(?:generated|created|written|drafted)\s+(?:with|by)|\.(?:internal|local|lan|home|tailnet|intranet|private|corp|ts\.net)\b|(?<![0-9.])(?:[0-9]{1,3}\.){3}[0-9]{1,3}(?![0-9.])|[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|(?:org|acct|account|sess|ses|session)[_-][A-Za-z0-9]{6,}/iu;
const PLAIN_LOWER_WORDS = /^[a-z ]+$/u;
const PLAIN_SHAPE_CUE = /\b(?:ssh|scp|bearer)\b/iu; // ASCII: cue words are ASCII.
const PLAIN_CUE_WORDS = new Set([
  "my",
  "our",
  "we",
  "he",
  "she",
  "they",
  "his",
  "her",
  "diagnosed",
  "suffers",
  "suffered",
  "thanks",
  "thank",
  "kudos",
  "cheers",
  "assigned",
  "reported",
  "written",
  "created",
  "maintained",
  "contributed",
  "reviewed",
  "signed",
  "courtesy",
  "according",
  "ask",
  "cc",
]);

function add(out: Finding[], start: number, end: number, rule: string, value: string): void {
  if (end > start && !disabled(rule)) out.push({ start, end, rule, value });
}

// Read lazily: production entrypoints shed SCRUB_CHECK_DISABLE on entry,
// before the first scan, so only scrub-check honors the test hook (C23).
let DISABLED: Set<string> | null = null;
function disabled(rule: string): boolean {
  DISABLED ??= new Set(pyWords((process.env.SCRUB_CHECK_DISABLE ?? "").replaceAll(",", " ")));
  return DISABLED.has(rule);
}

function squashed(s: string): string {
  return pyLower(s).replace(/[^a-z0-9]+/gu, "");
}

function kindForField(name: string): string | null {
  const lowered = pyLower(name.replace(/([a-z0-9])([A-Z])/gu, "$1_$2"));
  const parts = lowered.split(/[^a-z0-9]+/gu).filter(Boolean);
  const flat = squashed(name);
  if (["sessioncontext", "credentialorg", "credentialorgid"].includes(flat)) return "key";
  const last = parts.at(-1) ?? "";
  if (parts.length === 1 && ["session", "auth"].includes(last)) return null;
  if (
    SECRET_TOKEN_ENDINGS.has(last) ||
    SECRET_TOKEN_SUFFIXES.some((suffix) => flat.endsWith(suffix))
  )
    return "token";
  if (SECRET_KEY_ENDINGS.has(last) || SECRET_KEY_SUFFIXES.some((suffix) => flat.endsWith(suffix)))
    return "key";
  if (SECRET_ID_ENDINGS.has(last)) {
    // Thread ids are run records, not private context; session ids stay.
    if (parts.includes("thread")) return null;
    return "account-id";
  }
  return null;
}

function valueFromField(match: RegExpExecArray): { value: string; start: number } {
  for (const key of ["double", "single", "bare"]) {
    const value = match.groups?.[key];
    if (value !== undefined) return { value, start: match.index + match[0].lastIndexOf(value) };
  }
  return { value: "", start: match.index };
}

function isPublicAddress(value: string): boolean {
  const [local, domain = ""] = pyLower(value).split("@");
  const noReply = new Set([
    "noreply",
    "no-reply",
    "no_reply",
    "donotreply",
    "do-not-reply",
    "do_not_reply",
    "noresponse",
    "no-response",
    "no_response",
    "mailer-daemon",
    "mailer_daemon",
  ]);
  const reserved = [
    "example",
    "example.com",
    "example.net",
    "example.org",
    "test",
    "invalid",
    "localhost",
    "users.noreply.github.com",
  ];
  return (
    noReply.has(local ?? "") ||
    reserved.some((item) => domain === item || domain.endsWith(`.${item}`))
  );
}

function isPrivateName(name: string): boolean {
  return /\.(?:internal|local|lan|home|tailnet|intranet|private|corp|ts\.net)$/iu.test(name);
}

function ipv4Private(address: string): boolean {
  const [a, b, c] = address.split(".").map(Number);
  if (a === undefined || b === undefined || c === undefined) return false;
  return (
    a === 10 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b !== undefined && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b !== undefined && b >= 64 && b <= 127)
  );
}

function privateAddress(value: string): boolean {
  const ipv4 = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/u.test(value);
  if (ipv4) {
    const parts = value.split(".").map(Number);
    if (parts.some((part) => part > 255)) return false;
    if (parts[0] === 127 || value === "0.0.0.0") return false;
    return ipv4Private(value);
  }
  const normal = pyLower(value).split("%")[0] ?? "";
  const pieces = normal.split(":");
  const compressed = normal.includes("::");
  const validGroups = pieces.every((part) => part === "" || /^[0-9a-f]{1,4}$/u.test(part));
  const groupCount = pieces.filter(Boolean).length;
  if (normal.includes(":") && validGroups && (compressed ? groupCount < 8 : groupCount === 8)) {
    if (normal === "::1" || normal === "::") return false;
    return (
      normal.startsWith("fc") ||
      normal.startsWith("fd") ||
      normal.startsWith("fe8") ||
      normal.startsWith("fe9") ||
      normal.startsWith("fea") ||
      normal.startsWith("feb")
    );
  }
  return false;
}

function tokenFindings(line: string, out: Finding[]): void {
  if (!TOKEN_SIGNAL.test(line)) return;
  const tokenPrefixes = [
    "gh" + "p_",
    "gh" + "o_",
    "gh" + "u_",
    "gh" + "s_",
    "gh" + "r_",
    "github" + "_pat_",
    "sk" + "_live_",
    "sk" + "_test_",
    "sk" + "-",
    "xox" + "b-",
    "xox" + "p-",
    "xox" + "a-",
    "xox" + "r-",
    "xox" + "s-",
    "ya29" + ".",
  ];
  for (const prefix of tokenPrefixes) {
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const re = new RegExp(`(?<![A-Za-z0-9])(${escaped}[A-Za-z0-9_./+-]{20,})`, "gu");
    for (const m of line.matchAll(re))
      add(out, m.index ?? 0, (m.index ?? 0) + m[0].length, "token", m[0]);
  }
  const fixedPatterns = [
    /(?<![A-Za-z0-9])xox[baprs]-[A-Za-z0-9-]{10,}/gu,
    new RegExp("(?<![A-Za-z0-9])(?:AK" + "IA|AS" + "IA)[A-Z0-9]{16}(?![A-Za-z0-9])", "gu"),
    new RegExp(`${BOUND_L}Bearer${SPACE}+[A-Za-z0-9._~+/-]{20,}={0,2}`, "giu"),
    new RegExp("-----BEGIN [A-Z0-9 ]*PRIV" + "ATE KEY-----", "giu"),
    new RegExp("-----BEGIN PGP PRIVATE KEY " + "BLOCK-----", "giu"),
    new RegExp(SSH_PRIVATE_HEADER, "gu"),
    new RegExp(`PuTTY-User-Key-File-[23]:${SPACE}*[^${PY_S_CLASS}]+`, "gu"),
    new RegExp("(?<![A-Za-z0-9])AGE-SECRET-KEY-[A-Za-z0-9]{20,}(?![A-Za-z0-9])", "gu"),
  ];
  for (const re of fixedPatterns) {
    for (const m of line.matchAll(re))
      add(out, m.index ?? 0, (m.index ?? 0) + m[0].length, "token", m[0]);
  }

  FIELD_VALUE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FIELD_VALUE.exec(line)) !== null) {
    const kind = kindForField(match.groups?.name ?? "");
    if (!kind) continue;
    const { value, start } = valueFromField(match);
    if (!value || ABSENT.test(value)) continue;
    if (FIELD_EXPANSION.test(value)) continue;
    const quoted = match.groups?.double !== undefined || match.groups?.single !== undefined;
    // A bare value holding an escape is format debris, not data.
    if (!quoted && value.includes("\\")) continue;
    const compact = value.replaceAll(" ", "");
    const property =
      /^[A-Za-z_$][A-Za-z0-9_$]*(?:(?:\?\.)|\.)(?:[A-Za-z_$][A-Za-z0-9_$]*)(?:(?:\?\.|\.)[A-Za-z_$][A-Za-z0-9_$]*)*$/u.test(
        compact,
      );
    const callOrExpression = /[(){}]|(?:\?\.|\+\+|--|\+|\||&&?|\?|=>)/u.test(value);
    if (property || callOrExpression) continue;
    if (
      kind === "account-id" &&
      (!new RegExp(`^${SPACE}*(?:\\{|[\"'][A-Za-z][A-Za-z0-9_-]*[\"']?${SPACE}*:)`, "u").test(
        line,
      ) ||
        new RegExp(`^${SPACE}*(?:const|let|var|return|export)${BOUND_R}`, "u").test(line))
    )
      continue;
    if (kind === "key" && !quoted && !/[0-9]/u.test(value) && !MAIL.test(value)) continue;
    if (kind === "key" && !value.includes("@") && /[,;]/u.test(value)) continue;
    if (value.startsWith("/") || value.startsWith("[") || /[(){}]/u.test(value)) continue;
    MAIL.lastIndex = 0;
    if (kind === "key" && MAIL.test(value) && isPublicAddress(value)) continue;
    if (
      kind === "token" &&
      (!/^[A-Za-z0-9_./+=&;|$`()\]<>"'-]{20,}$/u.test(value) ||
        new RegExp(`[(){};]|${SPACE}`, "u").test(value))
    )
      continue;
    if (kind === "account-id" && (value.length < 6 || !/[0-9]/u.test(value))) continue;
    add(out, start, start + value.length, kind, value);
  }

  DOTENV_LINE.lastIndex = 0;
  const env = DOTENV_LINE.exec(line);
  if (env) {
    const name = pyLower(env[1]!);
    const words = name.split(/[_-]+/u);
    const keyLike =
      words.some((w) =>
        [
          "key",
          "keys",
          "secret",
          "secrets",
          "token",
          "tokens",
          "password",
          "passwd",
          "pwd",
          "pass",
          "credential",
          "credentials",
          "private",
          "auth",
          "passphrase",
          "cert",
        ].includes(w),
      ) || words.some((w) => SECRET_TOKEN_SUFFIXES.some((s) => w.endsWith(s)));
    const pointer = /_(?:path|file|dir|url|type|host|port)$/u.test(name);
    let value = env[2] ?? "";
    const valueStart = line.indexOf(value, env.index + env[0].indexOf(value));
    if (keyLike && !pointer) {
      let scan = value;
      let quoted: string | null = null;
      const quote = value[0];
      if ((quote === "'" || quote === '"') && value.length >= 2) {
        const end = value.indexOf(quote, 1);
        if (end > 0) {
          const rest = value.slice(end + 1).trim();
          if (!rest || rest.startsWith("#")) {
            quoted = quote;
            scan = value.slice(1, end);
            if (quote === '"' && /\$[({]|`/u.test(scan)) scan = "";
          }
        }
      }
      if (!quoted) {
        // The first version's unquoted path, which a quote-started value
        // that composes (text after its closing quote) falls through to:
        // spaced from its sign with a split character it is code, else
        // only its first token assigns.
        if (DOTENV_COMMENT_ONLY.test(scan)) scan = "";
        else scan = scan.split(DOTENV_COMMENT_CUT, 1)[0] ?? "";
        const indices = (env as unknown as { indices?: Array<[number, number]> }).indices;
        const gap = indices ? line.slice(indices[1]![1], indices[2]![0]) : "=";
        if (WS_CHAR.test(gap[0] ?? "") && WS_CHAR.test(gap.at(-1) ?? "")) {
          if (DOTENV_SPLIT.test(scan) || /[|&]/u.test(scan)) scan = "";
        } else {
          const token = scan.split(WS_RUN, 1)[0] ?? "";
          scan = token.split(DOTENV_SPLIT, 1)[0] ?? "";
        }
      }
      if (DOTENV_LIST.test(scan)) scan = "";
      if (scan.length >= 8 && !ABSENT.test(scan)) {
        const at = line.indexOf(scan, valueStart);
        add(out, at, at + scan.length, "dotenv", scan);
      }
    }
  }
}

function privateFindings(line: string, out: Finding[]): void {
  if (!PRIVATE_SIGNAL.test(line)) return;
  // A tilde user after a slash is a public URL segment, not a home folder.
  const path = new RegExp(
    `(?<![\\p{L}\\p{N}_.$}~.>/@])(?:/home/|/Users/)([A-Za-z0-9._-]+)(?:/[^${PY_S_CLASS}"'<>),;]*)?|(?<![\\p{L}\\p{N}_.$}~.>/@])/root/[A-Za-z0-9._-]+|(?<![\\p{L}\\p{N}_/])~([A-Za-z0-9._-]+)/[^${PY_S_CLASS}"'<>),;]*|(?<![\\p{L}\\p{N}_])[A-Za-z]:\\\\Users\\\\([A-Za-z0-9._-]+)(?:\\\\[^${PY_S_CLASS}"'<>),;]*)?`,
    "giu",
  );
  for (const m of line.matchAll(path)) {
    const before = line.slice(0, m.index ?? 0);
    if ((before.match(/`/gu)?.length ?? 0) % 2 === 1 && line.includes("${")) continue;
    // A path that continues into an expansion is composed in code.
    if (line[(m.index ?? 0) + m[0].length] === "$") continue;
    const user = m[1] ?? m[2] ?? m[3];
    if (user && PLACEHOLDER.test(user)) continue;
    const value = m[0].replace(/[.!?:\]}"`]+$/u, "");
    add(out, m.index ?? 0, (m.index ?? 0) + value.length, "private-path", value);
  }

  for (const m of line.matchAll(/(?<![0-9.])(?:[0-9]{1,3}\.){3}[0-9]{1,3}(?![0-9.])/gu)) {
    if (privateAddress(m[0]))
      add(out, m.index ?? 0, (m.index ?? 0) + m[0].length, "private-host", m[0]);
  }
  for (const m of line.matchAll(
    /(?<![0-9A-Fa-f:])(?:[0-9A-Fa-f]{0,4}:){2,7}[0-9A-Fa-f]{0,4}(?![0-9A-Fa-f:])/gu,
  )) {
    if (privateAddress(m[0]))
      add(out, m.index ?? 0, (m.index ?? 0) + m[0].length, "private-host", m[0]);
  }
  for (const m of line.matchAll(
    /(?<![A-Za-z0-9_.-])(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z0-9.-]+/gu,
  )) {
    const start = m.index ?? 0;
    const before = line.slice(0, start);
    const templateExpression = before.lastIndexOf("${") > before.lastIndexOf("`");
    const quoted =
      !templateExpression &&
      ['"', "'"].some((quote) => [...before].filter((ch) => ch === quote).length % 2 === 1);
    const hostValue = new RegExp(
      `(?:^|[${PY_S_CLASS},{])(?:host|hostname|address|remote|endpoint|server|machine)${SPACE}*[:=]${SPACE}*$`,
      "iu",
    ).test(before);
    const machineAddress =
      before.endsWith("@") ||
      new RegExp(
        `${BOUND_L}(?:ssh|scp)${SPACE}+(?:-[A-Za-z]+${SPACE}+)*(?:[A-Za-z0-9._-]+@)?$`,
        "iu",
      ).test(before);
    if (
      isPrivateName(m[0]) &&
      !/\.[A-Z]+$/u.test(m[0]) &&
      (quoted || (hostValue && !templateExpression) || machineAddress)
    )
      add(out, start, start + m[0].length, "private-host", m[0]);
  }
  const ssh = new RegExp(
    `${BOUND_L}(?:ssh|scp)${SPACE}+(?:-[A-Za-z]+${SPACE}+)*(?:[0-9]+${SPACE}+)*(?:[A-Za-z0-9._-]+@)?([A-Za-z0-9][A-Za-z0-9.-]*)(?=[${PY_S_CLASS}:/]|$)`,
    "giu",
  );
  for (const m of line.matchAll(ssh)) {
    const host = m[1] ?? "";
    if (!host || /^[0-9]+$/u.test(host)) continue;
    if (
      !PLACEHOLDER.test(host) &&
      (!host.includes(".") || isPrivateName(host)) &&
      !/[{}$]/u.test(host)
    ) {
      const start = (m.index ?? 0) + m[0].lastIndexOf(host);
      add(out, start, start + host.length, "private-host", host);
    }
  }
  const opaque = new RegExp(
    `(?<![A-Za-z0-9_-])(?:org|acct|account|sess|ses|session)[_-](?=[^${PY_S_CLASS}]*[0-9])[A-Za-z0-9]{6,}(?![A-Za-z0-9_-])`,
    "gu",
  );
  for (const m of line.matchAll(opaque)) {
    add(out, m.index ?? 0, (m.index ?? 0) + m[0].length, "account-id", m[0]);
  }

  const context = new RegExp(
    `${BOUND_L}(?:account|org(?:anization)?s?|user|identity|credential|session)s?${BOUND_R}`,
    "iu",
  ).test(line);
  if (context) {
    for (const m of line.matchAll(
      new RegExp(
        `${BOUND_L}[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}${BOUND_R}`,
        "giu",
      ),
    )) {
      add(out, m.index ?? 0, (m.index ?? 0) + m[0].length, "account-id", m[0]);
    }
  }
  FIELD_VALUE.lastIndex = 0;
  let field: RegExpExecArray | null;
  while ((field = FIELD_VALUE.exec(line)) !== null) {
    const name = pyLower(field.groups?.name ?? "").replace(/[-.]/gu, "_");
    if (
      !/(?:account|org|organization|session|credential|identity|user)_?(?:id|uuid|guid)$/u.test(
        name,
      )
    )
      continue;
    const dataLine =
      new RegExp(`^${SPACE}*(?:\\{|["']?[A-Za-z][A-Za-z0-9_-]*["']?${SPACE}*:)`, "u").test(line) &&
      !new RegExp(`^${SPACE}*(?:const|let|var|return|export)${BOUND_R}`, "u").test(line);
    if (!dataLine) continue;
    const { value, start } = valueFromField(field);
    if (value.length >= 6 && /[0-9]/u.test(value) && !ABSENT.test(value) && !/[(){}$]/u.test(value))
      add(out, start, start + value.length, "account-id", value);
  }
  for (const m of line.matchAll(
    // ASCII: attribution labels are fixed English names and ASCII punctuation.
    /^\s*(?:Co-Authored-By:\s*(?:(?:OpenAI|Anthropic|GitHub|Google)\s+)?(?:Codex|ChatGPT|Claude|Copilot|Cursor|Gemini|GPT|OpenAI|Anthropic)\b|(?:Generated|Created|Written|Drafted)\s+(?:with|by)\s+(?:Anthropic|ChatGPT|Claude|Codex|Copilot|Cursor|Gemini|GPT|OpenAI)\b|generated-with\s*:)\s*.*$/giu,
  )) {
    add(out, m.index ?? 0, (m.index ?? 0) + m[0].length, "assistant-attribution", m[0]);
  }
}

export function detectLine(line: string, context = ""): Finding[] {
  const found: Finding[] = [];
  const text = blankSpan(line, patternSpan(line));
  const plainLower = text.includes(" ") && PLAIN_LOWER_WORDS.test(text);
  const firstWord = plainLower ? (text.trimStart().split(" ", 1)[0] ?? "") : "";
  const plainPersonalCue = plainLower && PLAIN_CUE_WORDS.has(firstWord);
  if (!plainLower || plainPersonalCue) {
    for (const f of scanPersonal(text, context)) {
      const value = text.slice(f.start, f.end);
      const domain = value.split("@")[1] ?? "";
      if (f.rule === "email" && isPrivateName(domain)) continue;
      add(found, f.start, f.end, f.rule, value);
    }
  }
  if (plainLower && !plainPersonalCue && !PLAIN_SHAPE_CUE.test(text)) return found;
  privateFindings(text, found);
  tokenFindings(text, found);
  const unique = new Map<string, Finding>();
  for (const f of found) unique.set(`${f.start}\0${f.end}\0${f.rule}`, f);
  return [...unique.values()].sort(
    (a, b) => a.start - b.start || a.end - b.end || a.rule.localeCompare(b.rule),
  );
}

function stripAnsi(
  text: string,
  map: Array<[number, number]> | null,
): {
  text: string;
  map: Array<[number, number]> | null;
  extras: Array<{ text: string; map: Array<[number, number]> | null }>;
} {
  if (!text.includes("\x1b") && !text.includes("\x9b") && !text.includes("\x9d"))
    return { text, map, extras: [] };
  const chunks: string[] = [];
  const nextMap: Array<[number, number]> | null = map === null ? [] : [];
  const extras: Array<{ text: string; map: Array<[number, number]> | null }> = [];
  let cursor = 0;
  ANSI.lastIndex = 0;
  for (const match of text.matchAll(ANSI)) {
    const start = match.index ?? 0;
    chunks.push(text.slice(cursor, start));
    for (let i = cursor; i < start; i++) nextMap.push(map?.[i] ?? [i, i + 1]);
    const maybeOsc = match[0].startsWith("\x1b]") || match[0].startsWith("\x9d");
    ANSI_OSC_PARAMS.lastIndex = start;
    const osc = maybeOsc ? ANSI_OSC_PARAMS.exec(text) : null;
    if (osc && osc.index === start) {
      const at = osc.index + osc[0].indexOf(osc[1]!);
      extras.push({
        text: osc[1]!,
        map: map
          ? map.slice(at, at + osc[1]!.length)
          : Array.from({ length: osc[1]!.length }, (_, i) => [at + i, at + i + 1]),
      });
    }
    cursor = start + match[0].length;
  }
  chunks.push(text.slice(cursor));
  for (let i = cursor; i < text.length; i++) nextMap.push(map?.[i] ?? [i, i + 1]);
  return { text: chunks.join(""), map: nextMap, extras };
}

function decodeEscape(
  inner: string,
  base: number,
  mapping: Array<[number, number]> | null,
): { text: string; map: Array<[number, number]> } {
  let text = "";
  const map: Array<[number, number]> = [];
  for (let i = 0; i < inner.length; ) {
    const start = i;
    let value = inner[i]!;
    let end = i + 1;
    if (value === "\\" && i + 1 < inner.length) {
      const escaped = inner[i + 1]!;
      const simple: Record<string, string> = {
        '"': '"',
        "\\": "\\",
        "/": "/",
        b: "\b",
        f: "\f",
        n: "\n",
        r: "\r",
        t: "\t",
      };
      if (escaped in simple) {
        value = simple[escaped]!;
        end = i + 2;
      } else if (escaped === "u" && /^[0-9a-fA-F]{4}/u.test(inner.slice(i + 2, i + 6))) {
        const code = Number.parseInt(inner.slice(i + 2, i + 6), 16);
        end = i + 6;
        if (
          code >= 0xd800 &&
          code <= 0xdbff &&
          inner.slice(end, end + 2) === "\\u" &&
          /^[0-9a-fA-F]{4}/u.test(inner.slice(end + 2, end + 6))
        ) {
          const low = Number.parseInt(inner.slice(end + 2, end + 6), 16);
          if (low >= 0xdc00 && low <= 0xdfff) {
            value = String.fromCodePoint(0x10000 + ((code - 0xd800) << 10) + low - 0xdc00);
            end += 6;
          } else value = String.fromCharCode(code);
        } else value = String.fromCharCode(code);
      } else {
        value = "\\";
        end = i + 1;
      }
    }
    text += value;
    const homeStart = mapping?.[base + start]?.[0] ?? base + start;
    const homeEnd = mapping?.[base + end - 1]?.[1] ?? base + end;
    for (let j = 0; j < value.length; j++) map.push([homeStart, homeEnd]);
    i = end;
  }
  return { text, map };
}

function jsonStringTokens(text: string): Array<{ start: number; end: number; closed: boolean }> {
  const tokens: Array<{ start: number; end: number; closed: boolean }> = [];
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf('"', cursor);
    if (start < 0) break;
    let i = start + 1;
    let closed = false;
    while (i < text.length) {
      const ch = text[i]!;
      if (ch === "\\") {
        i = Math.min(text.length, i + 2);
        continue;
      }
      if (ch === '"') {
        i++;
        closed = true;
        break;
      }
      if (ch === "\n" || ch === "\r") break;
      i++;
    }
    tokens.push({ start, end: i, closed });
    cursor = Math.max(i, start + 1);
    if (!closed && (text[cursor] === "\n" || text[cursor] === "\r")) break;
  }
  return tokens;
}

function logicalUnits(
  text: string,
  map: Array<[number, number]> | null,
  source: number | null,
  depth: number,
): Unit[] {
  const cleaned = stripAnsi(text, map);
  const result: Unit[] = [{ text: cleaned.text, map: cleaned.map, source, physical: false }];
  for (const extra of cleaned.extras) result.push({ ...extra, source: null, physical: false });
  if (
    depth >= MAX_JSON_DEPTH ||
    !cleaned.text.includes('"') ||
    (!cleaned.text.includes("\\") && !cleaned.text.includes("private-data:allow"))
  )
    return result;
  for (const match of jsonStringTokens(cleaned.text)) {
    const start = match.start;
    const inner = cleaned.text.slice(start + 1, match.end - (match.closed ? 1 : 0));
    const decoded = decodeEscape(inner, start + 1, cleaned.map);
    let partText = "";
    let partMap: Array<[number, number]> = [];
    const emit = (): void => {
      if (!partText && partMap.length === 0) return;
      for (const unit of logicalUnits(partText, partMap, source, depth + 1)) result.push(unit);
      partText = "";
      partMap = [];
    };
    for (let i = 0; i < decoded.text.length; i++) {
      const ch = decoded.text[i]!;
      if (ch === "\n" || ch === "\r") emit();
      else {
        partText += ch;
        partMap.push(decoded.map[i]!);
      }
    }
    emit();
  }
  return result;
}

export function lineUnits(line: string): Unit[] {
  const cleaned = stripAnsi(line, null);
  const text = blankSpan(cleaned.text, patternSpan(cleaned.text));
  const units: Unit[] = [{ text, map: cleaned.map, source: null, physical: true }];
  for (const extra of cleaned.extras) units.push({ ...extra, source: null, physical: false });
  if (!text.includes('"') || (!text.includes("\\") && !text.includes("private-data:allow")))
    return units;
  let source = 0;
  for (const match of jsonStringTokens(text)) {
    const start = match.start;
    const inner = text.slice(start + 1, match.end - (match.closed ? 1 : 0));
    const decoded = decodeEscape(inner, start + 1, cleaned.map);
    for (const unit of logicalUnits(decoded.text, decoded.map, source++, 0)) units.push(unit);
  }
  return units;
}

function homeSpan(
  map: Array<[number, number]> | null,
  start: number,
  end: number,
): [number, number] {
  if (map === null) return [start, end];
  if (start >= end || !map.length) return [0, 0];
  const first = map[start] ?? [0, 0];
  const last = map[end - 1] ?? first;
  return [first[0], last[1]];
}

interface ParsedMarker {
  start: number;
  end: number;
  next: boolean;
  rule: string | null;
  valid: boolean;
}
function markersIn(text: string): ParsedMarker[] {
  if (!text.includes("private-data:allow")) return [];
  const starts = [...text.matchAll(MARKER_HEAD)].map((m) => m.index ?? 0);
  return starts.map((start, i) => {
    const end = starts[i + 1] ?? text.length;
    const body = MARKER_BODY.exec(text.slice(start, end));
    const rest = text.slice(start + "private-data:allow".length);
    const next =
      rest.startsWith("-next-line") && (rest.length === 10 || !MARKER_BOUNDARY.test(rest[10]!))
        ? true
        : Boolean(body?.[1]);
    const rule = body?.[2] ?? null;
    const valid = Boolean(body && rule && RULES.has(rule));
    return { start, end, next, rule: valid ? rule : null, valid };
  });
}

export function scanLine(
  line: string,
  opts: { markers?: boolean; context?: string; keyBlock?: boolean } = {},
): ScanResult {
  if (!opts.keyBlock && process.env.SCRUB_PREFILTER !== "0" && !needsFullScan(line))
    return { findings: [], suppressed: [], markers: [], nextLineMarkers: [] };
  const units = lineUnits(line);
  const all: Finding[][] = units.map((unit) =>
    detectLine(unit.text, opts.context ?? "").map((f) => ({
      ...f,
      ...(() => {
        const span = homeSpan(unit.map, f.start, f.end);
        return { start: span[0], end: span[1] };
      })(),
    })),
  );
  if (opts.keyBlock && !disabled("token") && units[0]?.text.trim()) {
    const span = homeSpan(units[0]!.map, 0, units[0]!.text.length);
    all[0]!.push({ start: span[0], end: span[1], rule: "token", value: units[0]!.text });
  }
  const seen = new Set<string>();
  for (let i = all.length - 1; i >= 0; i--) {
    all[i] = all[i]!.filter((f) => {
      const id = `${f.start}\0${f.end}\0${f.rule}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }
  if (opts.markers === false || disabled("marker") || disabled("markers"))
    return { findings: all.flat(), suppressed: [], markers: [], nextLineMarkers: [] };
  const stringRanges: Array<[number, number]> = [];
  if (line.includes("private-data:allow")) {
    for (const m of jsonStringTokens(line)) stringRanges.push([m.start, m.end]);
  }
  const aggregate: Finding[] = [];
  const suppressed: Finding[] = [];
  const faults: MarkerFault[] = [];
  const nextBySource = new Map<number, ParsedMarker[]>();
  const physicalNext: ParsedMarker[] = [];
  for (let i = 0; i < units.length; i++) {
    const unit = units[i]!;
    const found = all[i]!;
    const sourceMarkers = markersIn(unit.text)
      .filter((m) => {
        if (unit.map && unit.map.slice(m.start, m.end).some(([a, b]) => b - a > 1)) return false;
        if (i !== 0) return true;
        return !stringRanges.some(([a, b]) => a <= m.start && m.start < b);
      })
      .map((m) => {
        const [start, end] = homeSpan(unit.map, m.start, m.end);
        return { ...m, start, end };
      });
    const pending = unit.source === null ? [] : (nextBySource.get(unit.source) ?? []);
    if (unit.source !== null) nextBySource.delete(unit.source);
    const live = [...found];
    const hitsFor = (rule: string, before?: number): Finding[] =>
      live.filter((f) => f.rule === rule && (before === undefined || f.end <= before));
    for (const marker of sourceMarkers) {
      if (!marker.valid && !marker.next && found.length)
        faults.push({ start: marker.start, end: marker.end });
      if (marker.next) {
        const following = units.slice(i + 1).find((later) => later.source === unit.source);
        if (unit.source === null) physicalNext.push(marker);
        else if (following) {
          const list = nextBySource.get(unit.source) ?? [];
          list.push(marker);
          nextBySource.set(unit.source, list);
        } else if (marker.valid) faults.push({ start: marker.start, end: marker.end });
      } else if (marker.valid) {
        const hits = hitsFor(marker.rule!, marker.start);
        if (!hits.length) faults.push({ start: marker.start, end: marker.end });
        else {
          suppressed.push(...hits);
          for (const hit of hits) live.splice(live.indexOf(hit), 1);
        }
      }
    }
    for (const marker of pending) {
      if (marker.valid) {
        const hits = hitsFor(marker.rule!);
        if (!hits.length) faults.push({ start: marker.start, end: marker.end });
        else {
          suppressed.push(...hits);
          for (const hit of hits) live.splice(live.indexOf(hit), 1);
        }
      } else if (found.length) faults.push({ start: marker.start, end: marker.end });
    }
    for (const item of live) aggregate.push(item);
  }
  if (physicalNext.length) {
    // A physical next-line marker is resolved by the streaming caller when its next line arrives.
    for (const marker of physicalNext)
      nextBySource.set(-1, [...(nextBySource.get(-1) ?? []), marker]);
  }
  return {
    findings: aggregate.sort(
      (a, b) => a.start - b.start || a.end - b.end || a.rule.localeCompare(b.rule),
    ),
    suppressed,
    markers: faults,
    nextLineMarkers: physicalNext.map(({ start, end, rule, valid }) => ({
      start,
      end,
      rule,
      valid,
    })),
  };
}

export function safePath(path: string): string {
  const matches = detectLine(path).sort((a, b) => a.start - b.start || b.end - a.end);
  let out = "";
  let cursor = 0;
  for (const f of matches) {
    if (f.start < cursor) continue;
    out += path.slice(cursor, f.start) + "[redacted]";
    cursor = f.end;
  }
  return out + path.slice(cursor);
}

export function logFinding(rule: string, file: string, line: number, commit = "", via = ""): void {
  const log = process.env.POSTMASTER_DETECTIONS_LOG;
  if (!log) return;
  const record: Record<string, unknown> = {
    rule,
    file: safePath(file),
    line,
    commit,
    time: new Date().toISOString(),
  };
  if (via) record.via = via;
  try {
    mkdirSync(dirname(log), { recursive: true });
    const fd = openSync(log, "a", 0o600);
    try {
      writeFileSync(fd, `${JSON.stringify(record)}\n`, "utf8");
    } finally {
      closeSync(fd);
    }
  } catch {
    throw new Error("could not write detections log");
  }
}

export class StreamScanner {
  private previous: { number: number; marks: ScanResult["nextLineMarkers"] } | null = null;

  feed(
    number: number,
    text: string,
    opts: { markers?: boolean; keyBlock?: boolean; context?: string } = {},
  ): ScanResult {
    const current = scanLine(text, opts);
    const previous = this.previous;
    if (previous) {
      if (previous.number === number - 1) {
        for (const mark of previous.marks) {
          if (mark.valid) {
            const hits = current.findings.filter((finding) => finding.rule === mark.rule);
            if (hits.length) {
              current.findings = current.findings.filter((finding) => !hits.includes(finding));
              current.suppressed.push(...hits);
            } else
              current.markers.push({ start: mark.start, end: mark.end, line: previous.number });
          } else if (current.findings.length)
            current.markers.push({ start: mark.start, end: mark.end, line: previous.number });
        }
      } else {
        for (const mark of previous.marks)
          if (mark.valid)
            current.markers.push({ start: mark.start, end: mark.end, line: previous.number });
      }
    }
    this.previous = { number, marks: current.nextLineMarkers };
    return current;
  }

  flush(): MarkerFault[] {
    const faults = (this.previous?.marks ?? [])
      .filter((marker) => marker.valid)
      .map(({ start, end }) => ({ start, end, line: this.previous!.number }));
    this.previous = null;
    return faults;
  }
}

export function git(args: string[], cwd = process.cwd()): Buffer {
  const result = spawnSync("git", args, {
    cwd,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) throw new Error("git operation failed");
  return result.stdout as Buffer;
}

export function repositoryRoot(): string {
  const root = git(["rev-parse", "--show-toplevel"]).toString("utf8").trim();
  return root;
}

export function resolveCommit(ref: string, cwd = process.cwd()): string {
  if (!ref || ref.startsWith("-")) throw new Error("a commit ref is required");
  const commit = git(
    ["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`],
    cwd,
  )
    .toString("ascii")
    .trim();
  if (!/^[0-9a-f]{40}$/u.test(commit)) throw new Error("invalid commit id");
  return commit;
}

export function runGit(args: string[], cwd = process.cwd()) {
  const child = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "ignore"] });
  return child;
}

export interface TextLine {
  number: number;
  text: string;
  bytes: Buffer;
  newline: boolean;
}

function decodeUtf8(bytes: Buffer): string {
  // Fast path: valid UTF-8 round-trips byte-for-byte through the native
  // decoder, so only genuinely broken input pays for the byte loop below.
  // Besides speed, this keeps per-line allocation low enough that a second
  // streamed file fits under the 512 MB virtual limit (C27).
  const fast = bytes.toString("utf8");
  if (!fast.includes("\uFFFD") || Buffer.from(fast, "utf8").equals(bytes)) return fast;
  let out = "";
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i]!;
    if (b < 0x80) {
      out += String.fromCharCode(b);
      i++;
      continue;
    }
    let n =
      b >= 0xc2 && b <= 0xdf ? 2 : b >= 0xe0 && b <= 0xef ? 3 : b >= 0xf0 && b <= 0xf4 ? 4 : 0;
    if (!n || i + n > bytes.length) {
      out += String.fromCharCode(0xdc00 + b);
      i++;
      continue;
    }
    let valid = true;
    for (let j = 1; j < n; j++) if ((bytes[i + j]! & 0xc0) !== 0x80) valid = false;
    if (n === 3 && b === 0xe0 && bytes[i + 1]! < 0xa0) valid = false;
    if (n === 3 && b === 0xed && bytes[i + 1]! >= 0xa0) valid = false;
    if (n === 4 && b === 0xf0 && bytes[i + 1]! < 0x90) valid = false;
    if (n === 4 && b === 0xf4 && bytes[i + 1]! >= 0x90) valid = false;
    if (!valid) {
      out += String.fromCharCode(0xdc00 + b);
      i++;
      continue;
    }
    out += Buffer.from(bytes.slice(i, i + n)).toString("utf8");
    i += n;
  }
  return out;
}

function decodeLine(bytes: Buffer, encoding: "utf8" | "utf16le" | "utf16be"): string {
  if (encoding === "utf8") return decodeUtf8(bytes);
  const even = bytes.length - (bytes.length % 2);
  let out = "";
  for (let i = 0; i < even; i += 2) {
    const low = encoding === "utf16le" ? bytes[i]! : bytes[i + 1]!;
    const high = encoding === "utf16le" ? bytes[i + 1]! : bytes[i]!;
    out += String.fromCharCode(low | (high << 8));
  }
  return out;
}

export async function* streamLines(path: string): AsyncGenerator<TextLine> {
  // Bun.file's stream, not node:fs: Bun's node:fs read paths grow the
  // process past a 512 MB virtual limit on a 175 MB file (C27), while the
  // Bun-native stream holds flat. A missing path throws on first read, as
  // the callers' "could not read" catches expect.
  const stream = Bun.file(path).stream();
  let encoding: "utf8" | "utf16le" | "utf16be" = "utf8";
  let initialized = false;
  let parts: Uint8Array[] = [];
  let lineSize = 0;
  let number = 0;
  let utf16Carry: Buffer | null = null;
  const pushPart = (part: Uint8Array): void => {
    if (part.length) {
      parts.push(part);
      lineSize += part.length;
    }
  };
  const emit = (newline: boolean): TextLine => {
    let bytes = Buffer.concat(parts, lineSize);
    parts = [];
    lineSize = 0;
    if (encoding === "utf8" && bytes.at(-1) === 0x0d)
      bytes = Buffer.from(bytes.slice(0, bytes.length - 1));
    if (encoding !== "utf8" && bytes.length >= 2 && bytes.at(-2) === 0x0d && bytes.at(-1) === 0)
      bytes = Buffer.from(bytes.slice(0, bytes.length - 2));
    else if (
      encoding !== "utf8" &&
      bytes.length >= 2 &&
      bytes.at(-2) === 0 &&
      bytes.at(-1) === 0x0d
    )
      bytes = Buffer.from(bytes.slice(0, bytes.length - 2));
    return { number: ++number, text: decodeLine(bytes, encoding), bytes, newline };
  };
  for await (const raw of stream) {
    let chunk: Uint8Array = Buffer.from(raw);
    if (!initialized) {
      initialized = true;
      if (chunk.length >= 2 && chunk[0] === 0xff && chunk[1] === 0xfe) {
        encoding = "utf16le";
        chunk = Buffer.from(chunk.slice(2));
      } else if (chunk.length >= 2 && chunk[0] === 0xfe && chunk[1] === 0xff) {
        encoding = "utf16be";
        chunk = Buffer.from(chunk.slice(2));
      } else if (chunk.length >= 3 && chunk[0] === 0xef && chunk[1] === 0xbb && chunk[2] === 0xbf)
        chunk = Buffer.from(chunk.slice(3));
    }
    if (encoding === "utf8") {
      let start = 0;
      for (let at = chunk.indexOf(0x0a, start); at >= 0; at = chunk.indexOf(0x0a, start)) {
        pushPart(chunk.subarray(start, at));
        yield emit(true);
        start = at + 1;
      }
      pushPart(chunk.subarray(start));
      continue;
    }
    if (utf16Carry) {
      chunk = Buffer.concat([utf16Carry, chunk]);
      utf16Carry = null;
    }
    if (chunk.length % 2) {
      utf16Carry = Buffer.from(chunk.subarray(-1));
      chunk = chunk.subarray(0, -1);
    }
    const firstNewlineByte = encoding === "utf16le" ? 0x0a : 0x00;
    const secondNewlineByte = encoding === "utf16le" ? 0x00 : 0x0a;
    let start = 0;
    for (
      let at = chunk.indexOf(firstNewlineByte, start);
      at >= 0;
      at = chunk.indexOf(firstNewlineByte, start)
    ) {
      if (at % 2 !== 0 || chunk[at + 1] !== secondNewlineByte) {
        start = at + 1;
        continue;
      }
      pushPart(chunk.subarray(start, at));
      yield emit(true);
      start = at + 2;
    }
    pushPart(chunk.subarray(start));
  }
  if (utf16Carry) pushPart(utf16Carry);
  if (lineSize || parts.length || number === 0) yield emit(false);
}

export function decodeBytes(bytes: Buffer): string {
  return decodeUtf8(bytes);
}

// A diff or blob line from a UTF-16 file arrives NUL-interleaved; decode it
// so the scan reads the text, not the storage. Only strict shapes decode —
// anything else scans as it arrived, as before. A line number stays the
// diff's, so a finding in a UTF-16 file points at the file and the
// approximate line, never silently nowhere.
export function decodeChildText(text: string): string {
  if (!text.includes("\0")) return text;
  // Rebuild the byte view: surrogateescape chars map back to bytes exactly,
  // ASCII maps to itself, and anything else aborts the decode.
  const bytes: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code >= 0xdc80 && code <= 0xdcff) bytes.push(code - 0xdc00);
    else if (code < 0x80) bytes.push(code);
    else return text;
  }
  const decode = (le: boolean): string | null => {
    let rest = bytes;
    if (le && rest.length >= 2 && rest[0] === 0xff && rest[1] === 0xfe) rest = rest.slice(2);
    if (!le && rest.length >= 2 && rest[0] === 0xfe && rest[1] === 0xff) rest = rest.slice(2);
    if (rest.length % 2 === 1) {
      // A split fragment keeps half of a newline pair: LE continuations
      // open with NUL, BE fragments close with one.
      if (le && rest[0] === 0x00) rest = rest.slice(1);
      else if (rest[rest.length - 1] === 0x00 || rest[rest.length - 1] === 0x0a)
        rest = rest.slice(0, -1);
      else return null;
    }
    if (!rest.length) return "";
    for (let i = 0; i < rest.length; i++) {
      const half = le ? i % 2 === 1 : i % 2 === 0;
      if (half && rest[i] !== 0x00) return null;
    }
    let out = "";
    for (let i = 0; i < rest.length; i += 2) {
      const low = le ? rest[i]! : rest[i + 1]!;
      const high = le ? rest[i + 1]! : rest[i]!;
      out += String.fromCharCode(low | (high << 8));
    }
    return out.endsWith("\r") ? out.slice(0, -1) : out;
  };
  return decode(true) ?? decode(false) ?? text;
}

export async function* childLines(readable: NodeJS.ReadableStream): AsyncGenerator<string> {
  // A manual splitter, not readline: when the loop body awaits a slow git
  // child, the child feeding this stream can finish and close it first, and
  // Bun's readline answers the next read with ERR_USE_AFTER_CLOSE. A byte
  // split on 0x0A cannot strand a character, since no UTF-8 sequence holds one.
  let pending = Buffer.alloc(0);
  const emit = (bytes: Uint8Array): string => {
    const end =
      bytes.length > 0 && bytes[bytes.length - 1] === 0x0d ? bytes.length - 1 : bytes.length;
    return decodeBytes(Buffer.from(bytes.slice(0, end)));
  };
  for await (const raw of readable as unknown as AsyncIterable<Uint8Array>) {
    const chunk = Buffer.concat([pending, Buffer.from(raw)]);
    let start = 0;
    for (let at = chunk.indexOf(0x0a, start); at >= 0; at = chunk.indexOf(0x0a, start)) {
      yield emit(chunk.subarray(start, at));
      start = at + 1;
    }
    pending = Buffer.from(chunk.slice(start));
  }
  if (pending.length > 0) yield emit(pending);
}

export function codePointOffset(text: string, offset: number): number {
  return [...text.slice(0, offset)].length;
}

export function keyBlockStep(
  line: string,
  inBlock: boolean,
): { inBlock: boolean; flagged: boolean } {
  // Outside a block only a header, a PuTTY line or a bare body line flags,
  // so a line with whitespace strictly inside skips the trim and the tests.
  // ASCII: inner whitespace breaks the base64 shape; dashes/PuTTY excluded above.
  if (!inBlock && !line.includes("----") && !/putty/iu.test(line) && /\S\s\S/u.test(line))
    return { inBlock: false, flagged: false };
  const stripped = line.trim();
  if (KEY_HEADER.test(stripped)) return { inBlock: true, flagged: true };
  // A lone body line flags (C4), but a run of one character is a rule,
  // not key material.
  if (!inBlock)
    return {
      inBlock: false,
      flagged: KEY_BODY.test(stripped) && !/^(.)\1*$/u.test(stripped),
    };
  if (KEY_END.test(stripped)) return { inBlock: false, flagged: true };
  if (!stripped || KEY_FIELD.test(stripped)) return { inBlock: true, flagged: false };
  if (KEY_BODY.test(stripped)) return { inBlock: true, flagged: true };
  return { inBlock: false, flagged: false };
}
