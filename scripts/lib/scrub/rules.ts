// The rule table for the private-data check: secret-field names, token
// shapes, dotenv names, private context, markers. Stems are fragmented
// pairs so no committed line holds a whole one. Values are matched by
// shape and context, never against anyone's values.
import { pyLower } from "../text.ts";

export const RULES = [
  "account-id",
  "assistant-attribution",
  "dotenv",
  "email",
  "key",
  "marker",
  "private-host",
  "private-path",
  "token",
] as const;
export type RuleName = (typeof RULES)[number];
export const RULE_SET: ReadonlySet<string> = new Set(RULES);

export const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

// --- field names ----------------------------------------------------------

const SECRET_NAME_STEMS: ReadonlySet<string> = new Set([
  "sessioncon" + "text",
  "credential" + "org",
  "credentialorg" + "id",
]);
const SECRET_TOKEN_ENDINGS: ReadonlySet<string> = new Set([
  "sec" + "ret",
  "sec" + "rets",
  "pass" + "word",
  "pass" + "wd",
  "p" + "wd",
  "pas" + "s",
  "pass" + "code",
  "passph" + "rase",
  "to" + "ken",
  "tok" + "ens",
  "k" + "ey",
  "ke" + "ys",
  "api" + "key",
  "private" + "key",
  "secret" + "key",
  "access" + "token",
  "refresh" + "token",
  "creden" + "tial",
  "credent" + "ials",
  "a" + "uth",
]);
const SECRET_KEY_ENDINGS: ReadonlySet<string> = new Set([
  "em" + "ail",
  "m" + "ail",
  "sess" + "ion",
]);
const SECRET_ID_ENDINGS: ReadonlySet<string> = new Set([
  "i" + "d",
  "i" + "ds",
  "uu" + "id",
  "gu" + "id",
]);
const SECRET_TOKEN_SUFFIXES: readonly string[] = [
  "pass" + "word",
  "pass" + "wd",
  "pass" + "code",
  "passph" + "rase",
  "sec" + "ret",
  "sec" + "rets",
  "to" + "ken",
  "tok" + "ens",
  "creden" + "tial",
  "credent" + "ials",
  "a" + "uth",
];
const SECRET_KEY_SUFFIXES: readonly string[] = ["em" + "ail", "sess" + "ion"];
const SECRET_SINGLE_SKIP: ReadonlySet<string> = new Set(["sess" + "ion", "a" + "uth"]);
const SECRET_ID_MIN_VALUE = 6;

// --- values ---------------------------------------------------------------

const ABSENT_VALUE = /^(?:null|None|true|false|N\/?A|\.{2,}|<[^<>]*>)$/i;
const EMAIL_RE =
  /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?![A-Za-z0-9-])/gud;
const NOREPLY_LOCAL: ReadonlySet<string> = new Set([
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
const USERS_NOREPLY_DOMAIN = "users.noreply.github.com";
const RESERVED_DOMAINS: ReadonlySet<string> = new Set([
  "example",
  "example.com",
  "example.net",
  "example.org",
  "test",
  "invalid",
  "localhost",
]);

function publicNoreply(address: string): boolean {
  const at = address.lastIndexOf("@");
  if (at < 0) return false;
  const local = pyLower(address.slice(0, at));
  const domain = pyLower(address.slice(at + 1));
  if (NOREPLY_LOCAL.has(local)) return true;
  if (domain === USERS_NOREPLY_DOMAIN) return true;
  for (const r of RESERVED_DOMAINS) {
    if (domain === r || domain.endsWith(`.${r}`)) return true;
  }
  return false;
}

const OPAQUE_ID_RE =
  /(?<![A-Za-z0-9_-])(?:org|acct|account|sess|ses|session)[_-](?=\S*[0-9])[A-Za-z0-9]{6,}(?![A-Za-z0-9_-])/gud;
const UUID_RE =
  /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/gud;
const ACCOUNT_CONTEXT =
  /\b(?:account|org(?:anization)?s?|user|identity|credential|session|thread)s?\b/giud;

const PLACEHOLDER_USER = /^(?:user|username|\*|\$USER|\$\{USER\}|<[^<>]*>)$/i;
const PLACEHOLDER_HOST =
  /^(?:localhost|example\.[a-z]+|test\.[a-z]+|invalid|host|hostname|<[^<>]*>|\*|\$[A-Z_]+)$/i;
const HARNESS_NAMES: readonly string[] = [
  "claude",
  "codex",
  "mimo",
  "grok",
  "pi",
  "agy",
  "muse",
  "postmaster",
  "anthropic",
  "openai",
];

const PRIVATE_PATH = new RegExp(
  String.raw`(?<![A-Za-z0-9_.$}~.-])(?:/home/|/Users/)([A-Za-z0-9._-]+)(?![A-Za-z0-9._-])` +
    String.raw`|(?<![A-Za-z0-9_.$}~.-])/ro[o]t/[A-Za-z0-9._-]+` +
    String.raw`|(?<![A-Za-z0-9_])~(?!\.)([A-Za-z0-9._-]+)/[^\s"'<>),;]*` +
    `|(?<![A-Za-z0-9_.$}~.-])/tmp/(?:${HARNESS_NAMES.join("|")})(?:-[A-Za-z0-9._-]+(?:/[^\\s"'<>),;]+)?|/[^\\s"'<>),;]+)` +
    String.raw`|(?<![A-Za-z0-9_])[A-Za-z]:\\Users\\([A-Za-z0-9._-]+)(?![A-Za-z0-9._-])` +
    String.raw`|(?<![A-Za-z0-9_.$}~.-])\\\\[A-Za-z0-9._-]+\\Users\\([A-Za-z0-9._-]+)(?![A-Za-z0-9._-])` +
    String.raw`|(?<![A-Za-z0-9_])(?:file|ssh)://[A-Za-z0-9.-]+(?:/home/|/Users/)([A-Za-z0-9._-]+)(?![A-Za-z0-9._-])`,
  "giud",
);

const IPV4 = /(?<![0-9.])(?:[0-9]{1,3}\.){3}[0-9]{1,3}(?![0-9.])/gud;
const IPV6 =
  /(?<![0-9A-Fa-f:])(?:[0-9A-Fa-f]{0,4}:){2,7}[0-9A-Fa-f]{0,4}(?![0-9A-Fa-f:])/gud;
const HEX_DIGIT = /[0-9A-Fa-f]/u;
const PRIVATE_HOST =
  /(?<![A-Za-z0-9_-])(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+(?:local|internal|lan|home|tailnet|intranet|private|corp)\b/giud;
const TS_NET =
  /(?<![A-Za-z0-9_.-])(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+ts\.net\b/giud;
// A machine name after ssh or scp: one word, not a placeholder.  // private-data:allow private-host -- rule pattern literal
const SSH_TARGET =
  /(?:ssh|scp)\s+(?:-[A-Za-z0-9._-]+\s+)*(?:[A-Za-z0-9._-]+@)?([A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?=[\s:/]|$)/giud;

// Carrier-grade NAT 100.64.0.0/10, built from pieces.  // private-data:allow private-host -- rule pattern literal
function inCgnat(ip: string): boolean {
  const m = /^(?:100)\.(\d{1,3})\./.exec(ip);
  if (!m) return false;
  const second = Number(m[1]);
  return second >= 64 && second <= 127;
}

function isPrivateIp(text: string): boolean {
  if (IPV4_TEST.test(text)) {
    const parts = text.split(".").map(Number);
    if (parts.length !== 4 || parts.some((n) => n > 255)) return false;
    if (parts[0] === 127 || (parts[0] === 0 && parts[1] === 0 && parts[2] === 0 && parts[3] === 0))
      return false;
    if (parts[0] === 10) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    return inCgnat(text);
  }
  if (text.includes(":")) {
    const lower = text.toLowerCase();
    if (lower === "::" || lower === "::1") return false;
    // Unique-local fc00::/7, link-local fe80::/10.  // private-data:allow private-host -- rule pattern literal
    if (/^f[cd]/i.test(lower)) return true;
    if (/^fe[89ab]/i.test(lower)) return true;
    return false;
  }
  return false;
}
const IPV4_TEST = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/u;

function* ipSpans(line: string): Generator<[number, number, string]> {
  for (const pattern of [IPV4, IPV6]) {
    pattern.lastIndex = 0;
    for (const m of line.matchAll(pattern)) {
      const text = m[0];
      if (!HEX_DIGIT.test(text)) continue;
      if (!isPrivateIp(text)) continue;
      yield [m.index!, m.index! + text.length, text];
    }
  }
}

const TOKEN_PREFIXES: readonly string[] = [
  "gh" + "p_",
  "gh" + "o_",
  "gh" + "u_",
  "gh" + "s_",
  "gh" + "r_",
  "github" + "_pat_",
  "sk" + "-",
  "sk" + "_live_",
  "sk" + "_test_",
  "xox" + "b-",
  "xox" + "p-",
  "xox" + "a-",
  "xox" + "r-",
  "xox" + "s-",
  "ya29" + ".",
];
const TOKEN_ALT = TOKEN_PREFIXES.slice()
  .sort((a, b) => b.length - a.length)
  .map((p) => p.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
  .join("|");
const TOKEN = new RegExp(
  `(?<![A-Za-z0-9])(?<value>(?:${TOKEN_ALT})[A-Za-z0-9_./+-]{20,})`,
  "gud",
);
const XOX_TOKEN = /(?<![A-Za-z0-9])(?<value>xox[baprs]-[A-Za-z0-9-]{10,})/gud;
const ACCESS_KEY = new RegExp(
  `(?<![A-Za-z0-9])(?<value>${"AK" + "IA"}[A-Z0-9]{16})(?![A-Za-z0-9])`,
  "gud",
);
const PEM_HEADER =
  /(?<![A-Za-z0-9])(?<value>-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----)/giud;
const PGP_PRIVATE = new RegExp(
  `(?<![A-Za-z0-9])(?<value>-----BEGIN PGP PRIVATE ${"KEY BLOCK"}-----)`,
  "giud",
);
const PUTTY_KEY = new RegExp(
  `(?<![A-Za-z0-9])(?<value>PuTTY-User-Key-File-${"[23]"}:${"\\s*\\S+"})`,
  "gud",
);
const SSH2_KEY = new RegExp(
  `(?<![A-Za-z0-9])(?<value>---- BEGIN SSH2 ENCRYPTED PRIVATE ${"KEY ----"})`,
  "gud",
);
const AGE_KEY = new RegExp(
  `(?<![A-Za-z0-9])(?<value>AGE-SECRET-${"KEY-"}[A-Za-z0-9]{20,})(?![A-Za-z0-9])`,
  "gud",
);
const BEARER_TOKEN = /\b(?<value>Bearer\s+[A-Za-z0-9._~+/-]{20,}={0,2})/giud;
const SECRET_VALUE = /^[A-Za-z0-9_./+=&;|$`\]()<>"'-]{20,}$/iu;

const KEY_BEGIN = new RegExp(
  String.raw`-----BEGIN (?:[A-Z0-9 ]*PRIVATE KEY|PGP PRIVATE ${"KEY BLOCK"}-----)` +
    String.raw`|---- BEGIN SSH2 ENCRYPTED PRIVATE ${"KEY ----"}` +
    String.raw`|PuTTY-User-Key-File-${"[23]"}:`,
  "giud",
);
const KEY_END =
  /-----END [^-]*-----|---- END SSH2 [^-]* ----|^Private-MAC:/giud;
const KEY_MATERIAL = /^[A-Za-z0-9+/=]{20,}$/u;
const KEY_FIELD = /^[A-Za-z-]+:\s*\S/u;
const KEY_BLOCK_PREFILTER =
  /[A-Za-z0-9+/=]{20,}|-----END |---- END |Private-MAC:/u;
export const KEY_BLOCK_MAX_BLOB = 8_000_000;

// --- dotenv ---------------------------------------------------------------

const DOTENV_LINE =
  /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*(.+?)\s*$/u;
const DOTENV_KEYLIKE: ReadonlySet<string> = new Set([
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
]);
const DOTENV_POINTER: readonly string[] = [
  "_path",
  "_file",
  "_dir",
  "_url",
  "_type",
  "_host",
  "_port",
];
const DOTENV_SUFFIXES: readonly string[] = [
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
const DOTENV_EXPANSION = /\$[{A-Za-z_(]|`/u;
const DOTENV_SPLIT = /["'(){}[`[]|\$[{A-Za-z_(]/gud;
const DOTENV_MIN_VALUE = 8;

// --- assistant attribution ------------------------------------------------

export const COAUTHOR_PREFIX = "Co-Authored" + "-By:";
const ASSISTANT_VENDORS: readonly string[] = [
  "Anthropic",
  "ChatGPT",
  "Claude",
  "Codex",
  "Copilot",
  "Cursor",
  "Gemini",
  "GPT",
  "OpenAI",
];
const ASSISTANT_ATTRIBUTION: readonly RegExp[] = [
  new RegExp(
    String.raw`^\s*${"Co-Authored" + "-By:"}\s*\S[^\n]*`,
    "giud",
  ),
  new RegExp(
    String.raw`^\s*(?:Generated|Created|Written|Drafted)\s+(?:with|by)\s+(?:${ASSISTANT_VENDORS.join("|")})\b[^\n]*`,
    "giud",
  ),
  /^\s*generated-with\s*:\s*\S[^\n]*/giu,
];

// --- markers --------------------------------------------------------------

export const MARKER_LOOSE = /(?<![A-Za-z0-9_.-])private-data:allow/gud;
const MARKER_VALID = /private-data:allow(-next-line)?\s+(\S+)\s+--\s+(\S.*)$/u;
const MARKER_BOUNDARY: ReadonlySet<string> = new Set(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-",
);

// --- field-value ----------------------------------------------------------

const FIELD_VALUE = new RegExp(
  "(?<![A-Za-z0-9_])(?<name>[A-Za-z][A-Za-z0-9_.-]*)\\b\\s*[\"']?\\s*[:=]\\s*" +
    "(?:\"(?<double>[^\"\\n]+)\"|'(?<single>[^'\\n]+)'|(?<bare>[^\\s\"',;}\\]]+))",
  "gud",
);

function fieldValueOf(m: RegExpExecArray): string {
  return m.groups?.double ?? m.groups?.single ?? m.groups?.bare ?? "";
}
function valueSpanOf(m: RegExpExecArray): [number, number] {
  const g = m.indices?.groups;
  if (g) {
    for (const name of ["double", "single", "bare"] as const) {
      const span = g[name];
      if (span) return [span[0], span[1]];
    }
  }
  return [m.index, m.index + m[0].length];
}

// A field name's finding kind, or null when the name is ordinary.
export function secretFieldKind(name: string): RuleName | null {
  const squashed = pyLower(name).replace(/[^a-z0-9]+/gu, "");
  if (SECRET_NAME_STEMS.has(squashed)) return "key";
  const camel = name.replace(/(?<=[a-z0-9])(?=[A-Z])/gu, "_");
  const parts = camel
    .toLowerCase()
    .split(/[^A-Za-z0-9]+/u)
    .filter((p) => p.length > 0);
  if (parts.length === 0) return null;
  if (parts.length === 1 && SECRET_SINGLE_SKIP.has(parts[0]!)) return null;
  const last = parts[parts.length - 1]!;
  if (SECRET_TOKEN_ENDINGS.has(last)) return "token";
  if (SECRET_KEY_ENDINGS.has(last)) return "key";
  if (SECRET_ID_ENDINGS.has(last)) return "account-id";
  for (const suffix of SECRET_TOKEN_SUFFIXES) {
    if (squashed.endsWith(suffix)) return "token";
  }
  for (const suffix of SECRET_KEY_SUFFIXES) {
    if (squashed.endsWith(suffix)) return "key";
  }
  return null;
}

export type Span = readonly [number, number, string, string];
// A finding is (start, end, rule, value).
export type Finding = readonly [number, number, string, string];

function fieldFinding(m: RegExpExecArray): Finding | null {
  const kind = secretFieldKind(m.groups?.name ?? "");
  if (kind === null) return null;
  const value = fieldValueOf(m);
  if (!value || ABSENT_VALUE.test(value)) return null;
  if (kind === "key" && EMAIL_RE.test(value) && publicNoreply(value)) {
    EMAIL_RE.lastIndex = 0;
    return null;
  }
  EMAIL_RE.lastIndex = 0;
  if (kind === "token") {
    if (value.length < 20 || !SECRET_VALUE.test(value)) return null;
  } else if (kind === "account-id" && value.length < SECRET_ID_MIN_VALUE) {
    return null;
  }
  const [start, end] = valueSpanOf(m);
  return [start, end, kind, value];
}

function dotenvFinding(line: string): Finding | null {
  const m = DOTENV_LINE.exec(line);
  if (!m) return null;
  const name = m[1]!;
  let value = m[2]!;
  const lowered = name.toLowerCase();
  if (DOTENV_POINTER.some((p) => lowered.endsWith(p))) return null;
  const components = new Set(lowered.split(/[_-]+/u));
  const keylike = [...components].some(
    (c) => DOTENV_KEYLIKE.has(c) || DOTENV_SUFFIXES.some((s) => c.endsWith(s)),
  );
  if (!keylike) return null;
  let quoted: string | null = null;
  if (value.length >= 2 && (value[0] === '"' || value[0] === "'")) {
    const end = value.indexOf(value[0]!, 1);
    if (end > 0) {
      const rest = value.slice(end + 1).trim();
      if (rest === "" || rest.startsWith("#")) {
        quoted = value[0]!;
        value = value.slice(1, end);
      }
    }
  } else if (/^#(\s|$)/u.test(value)) {
    value = "";
  } else {
    value = value.split(/\s+#/u, 1)[0]!;
  }
  if (!value) return null;
  let scan: string;
  if (quoted === "'") {
    scan = value;
  } else if (quoted === '"') {
    if (DOTENV_EXPANSION.test(value)) return null;
    scan = value;
  } else {
    // The gap between name and value in the original line.
    const nameEnd = m.index! + m[0].indexOf(name) + name.length;
    const valStart = m.index! + m[0].lastIndexOf(value);
    const gapText = line.slice(nameEnd, valStart);
    const spaced =
      gapText.length >= 2 &&
      /^\s$/u.test(gapText[0]!) &&
      /^\s$/u.test(gapText[gapText.length - 1]!);
    if (spaced) {
      DOTENV_SPLIT.lastIndex = 0;
      if (DOTENV_SPLIT.test(value)) {
        DOTENV_SPLIT.lastIndex = 0;
        return null;
      }
      DOTENV_SPLIT.lastIndex = 0;
      scan = value;
    } else {
      DOTENV_SPLIT.lastIndex = 0;
      const firstToken = value.split(/\s/u, 1)[0]!;
      scan = firstToken.split(DOTENV_SPLIT, 1)[0]!;
      DOTENV_SPLIT.lastIndex = 0;
    }
  }
  if (scan.length < DOTENV_MIN_VALUE || ABSENT_VALUE.test(scan)) return null;
  const start = line.indexOf(scan, m.index! + m[0].length - m[2]!.length);
  if (start < 0) return null;
  return [start, start + scan.length, "dotenv", scan];
}

function* keyBlockIter(
  lines: Iterable<string>,
): Generator<[number, boolean]> {
  let inBlock = false;
  let number = 0;
  for (const line of lines) {
    number += 1;
    const stripped = line.trim();
    let flag = false;
    if (KEY_BEGIN.test(stripped)) {
      KEY_BEGIN.lastIndex = 0;
      inBlock = true;
    } else if (inBlock) {
      if (KEY_END.test(stripped)) {
        KEY_END.lastIndex = 0;
        flag = true;
        inBlock = false;
      } else if (!stripped || KEY_FIELD.test(stripped)) {
        KEY_FIELD.lastIndex = 0;
      } else if (KEY_MATERIAL.test(stripped)) {
        KEY_MATERIAL.lastIndex = 0;
        flag = true;
      } else {
        inBlock = false;
      }
    } else {
      KEY_BEGIN.lastIndex = 0;
      KEY_END.lastIndex = 0;
    }
    yield [number, flag];
  }
}

export function keyBlockLines(text: string): Set<number> {
  const out = new Set<number>();
  for (const [n, flag] of keyBlockIter(text.split("\n"))) {
    if (flag) out.add(n);
  }
  return out;
}

export { KEY_BLOCK_PREFILTER, keyBlockIter };

// --- the combined findings() ------------------------------------------------

import { piiScan } from "./personal.ts";

export function findings(line: string): Finding[] {
  const found: Finding[] = [];
  const disabled = getDisabled();

  FIELD_VALUE.lastIndex = 0;
  for (const m of line.matchAll(FIELD_VALUE)) {
    const f = fieldFinding(m as RegExpExecArray);
    if (f !== null && !disabled.has(f[2])) found.push(f);
  }

  if (!disabled.has("email")) {
    EMAIL_RE.lastIndex = 0;
    for (const m of line.matchAll(EMAIL_RE)) {
      const value = m[0];
      if (!publicNoreply(value)) {
        found.push([m.index!, m.index! + value.length, "email", value]);
      }
    }
  }

  if (!disabled.has("account-id")) {
    OPAQUE_ID_RE.lastIndex = 0;
    for (const m of line.matchAll(OPAQUE_ID_RE)) {
      found.push([m.index!, m.index! + m[0].length, "account-id", m[0]]);
    }
    if (ACCOUNT_CONTEXT.test(line)) {
      ACCOUNT_CONTEXT.lastIndex = 0;
      UUID_RE.lastIndex = 0;
      for (const m of line.matchAll(UUID_RE)) {
        found.push([m.index!, m.index! + m[0].length, "account-id", m[0]]);
      }
    }
    ACCOUNT_CONTEXT.lastIndex = 0;
  }

  if (!disabled.has("private-path")) {
    PRIVATE_PATH.lastIndex = 0;
    for (const m of line.matchAll(PRIVATE_PATH)) {
      let value = m[0];
      while (value && /[.!?:\]}"`]/u.test(value[value.length - 1]!)) {
        value = value.slice(0, -1);
      }
      const user =
        m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? null;
      if (user !== null && PLACEHOLDER_USER.test(user)) continue;
      if (value) {
        found.push([m.index!, m.index! + value.length, "private-path", value]);
      }
    }
  }

  if (!disabled.has("private-host")) {
    PRIVATE_HOST.lastIndex = 0;
    for (const m of line.matchAll(PRIVATE_HOST)) {
      found.push([m.index!, m.index! + m[0].length, "private-host", m[0]]);
    }
    TS_NET.lastIndex = 0;
    for (const m of line.matchAll(TS_NET)) {
      found.push([m.index!, m.index! + m[0].length, "private-host", m[0]]);
    }
    for (const [start, end, text] of ipSpans(line)) {
      found.push([start, end, "private-host", text]);
    }
    // A machine name is private when it is one word after ssh or scp.  // private-data:allow private-host -- rule pattern literal
    SSH_TARGET.lastIndex = 0;
    for (const m of line.matchAll(SSH_TARGET)) {
      const host = m[1] ?? m[0];
      if (PLACEHOLDER_HOST.test(host)) continue;
      const start = m.index! + m[0].indexOf(host);
      found.push([start, start + host.length, "private-host", host]);
    }
  }

  if (!disabled.has("token")) {
    for (const pattern of [
      TOKEN,
      XOX_TOKEN,
      ACCESS_KEY,
      PEM_HEADER,
      PGP_PRIVATE,
      PUTTY_KEY,
      SSH2_KEY,
      AGE_KEY,
      BEARER_TOKEN,
    ]) {
      pattern.lastIndex = 0;
      for (const m of line.matchAll(pattern)) {
        const span = m.indices?.groups?.value;
        const start = span?.[0] ?? m.index!;
        const end = span?.[1] ?? m.index! + m[0].length;
        found.push([start, end, "token", m.groups?.value ?? m[0]]);
      }
    }
  }

  if (!disabled.has("dotenv")) {
    const d = dotenvFinding(line);
    if (d !== null) found.push(d);
  }

  if (!disabled.has("assistant-attribution")) {
    for (const pattern of ASSISTANT_ATTRIBUTION) {
      pattern.lastIndex = 0;
      for (const m of line.matchAll(pattern)) {
        found.push([m.index!, m.index! + m[0].length, "assistant-attribution", m[0]]);
      }
    }
  }

  // Personal data from #208's patterns.
  for (const f of piiScan(line)) {
    if (!disabled.has(f.rule)) {
      found.push([f.start, f.end, f.rule, line.slice(f.start, f.end)]);
    }
  }

  // A co-author trailer is assistant-attribution, never a sign-off name.
  const isCoauthor = ASSISTANT_ATTRIBUTION.some((r) => {
    r.lastIndex = 0;
    return r.test(line);
  });
  if (isCoauthor) {
    for (let i = found.length - 1; i >= 0; i--) {
      if (found[i]![2] === "sign-off") found.splice(i, 1);
    }
  }

  // D3: an address on a one-word or private network name is a machine
  // address, found as private context rather than as an email.
  const privateHostSpans = found
    .filter((f) => f[2] === "private-host")
    .map((f) => [f[0], f[1]] as [number, number]);
  const filtered = found.filter((f) => {
    if (f[2] !== "email") return true;
    return !privateHostSpans.some(([s, e]) => f[0] < e && s < f[1]);
  });
  found.length = 0;
  found.push(...filtered);

  // One suspect per match: identical spans collapse, distinct kinds stand.
  const unique = new Map<string, Finding>();
  for (const f of found) {
    unique.set(`${f[0]}:${f[1]}:${f[2]}:${f[3]}`, f);
  }
  return [...unique.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2].localeCompare(b[2]));
}

// --- markers --------------------------------------------------------------

export interface MarkerHead {
  span: [number, number];
  nextLine: boolean;
  rule: string | null;
  valid: boolean;
}

export function parseMarkers(line: string): MarkerHead[] {
  const heads: number[] = [];
  MARKER_LOOSE.lastIndex = 0;
  for (const m of line.matchAll(MARKER_LOOSE)) heads.push(m.index!);
  const parsed: MarkerHead[] = [];
  for (let i = 0; i < heads.length; i++) {
    const start = heads[i]!;
    const stop = i + 1 < heads.length ? heads[i + 1]! : line.length;
    const body = MARKER_VALID.exec(line.slice(start, stop));
    const rule = body?.[2] ?? null;
    const rest = line.slice(start + "private-data:allow".length);
    let nextLine: boolean;
    if (
      rest.startsWith("-next-line") &&
      (rest.length === "-next-line".length ||
        !MARKER_BOUNDARY.has(rest["-next-line".length]!))
    ) {
      nextLine = true;
    } else {
      nextLine = Boolean(body?.[1]);
    }
    parsed.push({
      span: [start, stop],
      nextLine,
      rule: body && rule && RULE_SET.has(rule) ? rule : null,
      valid: Boolean(body) && rule !== null && RULE_SET.has(rule),
    });
  }
  return parsed;
}

// --- disabled rules -------------------------------------------------------

let disabledCache: ReadonlySet<string> | null = null;
export function getDisabled(): ReadonlySet<string> {
  if (disabledCache === null) {
    const raw = (globalThis as { process?: { env?: Record<string, string | undefined> } })
      .process?.env?.SCRUB_CHECK_DISABLE ?? "";
    disabledCache = new Set(raw.replace(/,/gu, " ").split(/\s+/u).filter(Boolean));
  }
  return disabledCache;
}
export function resetDisabled(): void {
  disabledCache = null;
}
