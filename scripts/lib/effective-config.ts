// The shared loader: the global config path, a project's settings files, and the
// effective config for a project. Every reader imports this module; it is the only
// file that builds the global config path.
//
// The person's file, .postmaster/settings.toml, is written like the global config and
// overrides it setting by setting: a group merges, a list or single value replaces
// whole. A legacy [roles] table fills the team entries the file does not set
// explicitly. The shared file, .postmaster/project.toml, declares project facts and
// checks as before and never overrides the global config.
//
// A settings file git tracks is used only after the user accepts it, and again after
// it changes: until then every reader uses the global value and says the file waits
// for acceptance. An untracked file needs no acceptance. No run, lane or script
// accepts on its own; the user accepts with `run project-settings accept <repo>`.
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { parseTomlText } from "./data.ts";
import { scriptsDir } from "./paths.ts";
import { mkstempSync, run } from "./proc.ts";
import {
  BOUND_L,
  BOUND_R,
  END_OR_BEFORE_NL,
  PY_S_CLASS,
  pySplitLines,
  pyTrim,
  pyWords,
} from "./text.ts";

const HERE = scriptsDir(import.meta);

// --- failure ----------------------------------------------------------------------------
// Internal failures throw a branded value the entry point catches; anything else
// propagates as an unexpected crash, the way BASE's uncaught tracebacks did.
interface Die {
  tag: "die";
  message: string;
}

export const isDie = (e: unknown): e is Die =>
  typeof e === "object" && e !== null && (e as { tag?: unknown }).tag === "die";

export function fail(message: string): never {
  const d: Die = { tag: "die", message };
  throw d;
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// --- the global config path ----------------------------------------------------------------------
// The one place the path is built: every reader calls this instead of joining it.
// The default builds from $HOME exactly, as the base readers did — never the
// passwd home, so a stubbed or unset HOME reads the same here as everywhere.
// An empty override reads as unset, and a leading ~ expands.
export const globalConfigPath = (): string => {
  const override = process.env.POSTMASTER_CONFIG;
  if (override !== undefined && override !== "") return expandUser(override);
  return `${process.env.HOME ?? ""}/.postmaster/config.toml`;
};

/** The acceptance store beside a resolved global config path. */
export const acceptanceStorePath = (configPath: string): string =>
  join(dirname(configPath), "accepted-project-settings.json");

// --- filesystem edges ---------------------------------------------------------------------
export const isSymlink = (p: string): boolean => {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};

export const isFile = (p: string): boolean => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

const isDir = (p: string): boolean => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

// BASE reads text strict: undecodable bytes fail the read instead of becoming U+FFFD,
// and a byte-order mark stays in the text for the parser to refuse (the decoder would
// otherwise strip it silently).
const strictDecode = (bytes: Uint8Array): string =>
  new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);

export const strictRead = (p: string): string => strictDecode(readFileSync(p));

export const strictStdin = (): string => strictDecode(readFileSync(0));

// pathlib's ~ expansion: a leading ~ or ~/ names this user's home, ~user names
// theirs from the passwd table, and an unknown user stays unexpanded.
export const expandUser = (p: string): string => {
  if (p === "~" || p.startsWith("~/")) return homedir() + p.slice(1);
  if (p.startsWith("~")) {
    const slash = p.indexOf("/");
    const user = slash < 0 ? p.slice(1) : p.slice(1, slash);
    const rest = slash < 0 ? "" : p.slice(slash);
    if (user !== "") {
      try {
        for (const line of readFileSync("/etc/passwd", "utf8").split("\n")) {
          const fields = line.split(":");
          if (fields[0] === user && fields.length >= 6) return (fields[5] ?? "") + rest;
        }
      } catch {
        // Unknown user or no passwd table: fall through unexpanded, as BASE does.
      }
    }
  }
  return p;
};

// --- patterns -------------------------------------------------------------------------------
// BASE's (?i) groups cannot compile with an i flag here: NAMED_CREDENTIAL and ENV_PATH keep
// case-sensitive ASCII lookarounds beside them, and an i flag would widen those too
// ("mysecret" would suddenly refuse). Instead every letter expands to the exact class
// Python matches for it: only I takes U+0130/U+0131, only K takes U+212A and only S takes
// U+017F — every ASCII letter differenced over the full range against re.fullmatch.
const ci = (upper: string): string => {
  const lo = String.fromCharCode(upper.charCodeAt(0) + 32);
  if (upper === "I") return `[I${lo}\u0130\u0131]`;
  if (upper === "K") return `[K${lo}\u212A]`;
  if (upper === "S") return `[S${lo}\u017F]`;
  return `[${upper}${lo}]`;
};

const ciWord = (word: string): string => [...word].map(ci).join("");

// Python (?i) ranges, exactly: the ASCII letters in both cases plus U+0130, U+0131, U+017F
// and U+212A — each differenced over the full range against its re character set.
const AZ09 = String.raw`[A-Za-z0-9_\u017F\u212A\u0130\u0131]`; // (?i)[A-Z0-9_]
const AZ09B = String.raw`[A-Za-z0-9\u017F\u212A\u0130\u0131]`; // (?i)[A-Za-z0-9]
const AZ09D = String.raw`[A-Za-z0-9_\u017F\u212A\u0130\u0131-]`; // (?i)[A-Z0-9_-]
const AZ09H = String.raw`[A-Za-z0-9\u017F\u212A\u0130\u0131-]`; // (?i)[A-Za-z0-9-]
const AZL = String.raw`[A-Za-z\u017F\u212A\u0130\u0131]`; // (?i)[a-z]
const SEP = "[_-]?";

const RX_BAD_KEY = new RegExp(
  `(?:${ciWord("SECRET")}|${ciWord("CREDENTIAL")}|${ciWord("PASSWORD")}|${ciWord("TOKEN")}|${ciWord("KEY")}${SEP}${ciWord("FILE")}|${ciWord("ENV")}${SEP}${ciWord("FILE")}|${ciWord("API")}${SEP}${ciWord("KEY")}|${ciWord("PRIVATE")}${SEP}${ciWord("KEY")}|${ciWord("AUTH")}${SEP}${ciWord("TOKEN")})`,
  "u",
);
const RX_ABS = new RegExp(`(?:^|[${PY_S_CLASS}="'(])/(?!/)(?:[^${PY_S_CLASS}"']+)`, "u");
// BASE's HOME_PATH is case-sensitive ($HOME only); RX_ENV holds the (?i) spellings.
const RX_HOME = new RegExp(
  String.raw`(?:^|[${PY_S_CLASS}="'(])(?:~(?:/|${END_OR_BEFORE_NL})|\$HOME(?:/|${END_OR_BEFORE_NL})|\$USERPROFILE(?:\\|/|${END_OR_BEFORE_NL})|%USERPROFILE%(?:\\|/|${END_OR_BEFORE_NL}))`,
  "u",
);
const RX_PARENT = new RegExp(String.raw`(?:^|[/\\])\.\.(?:[/\\]|${END_OR_BEFORE_NL})`, "u");
const RX_WINDOWS = new RegExp(String.raw`(?:^|[${PY_S_CLASS}="'(])[A-Za-z]:[\\/]`, "u");
const RX_UNC = new RegExp(
  String.raw`(?:^|[${PY_S_CLASS}="'(])(?:\\\\[^\\${PY_S_CLASS}]+\\|//[^/${PY_S_CLASS}]+/)`,
  "u",
);
const RX_FILE_URL = new RegExp(
  String.raw`${BOUND_L}(?:${ciWord("FILE")}):(?:/|\\)+[^${PY_S_CLASS}"']*`,
  "u",
);
const RX_ENV = new RegExp(
  String.raw`(?<![A-Za-z0-9_])(?:\$(?:${ciWord("HOME")}|${ciWord("USERPROFILE")}|${ciWord("HOMEDRIVE")}|${ciWord("HOMEPATH")}|${ciWord("PWD")}|${ciWord("PATH")}|${ciWord("TMP")}|${ciWord("TEMP")}|${ciWord("TMPDIR")}|${AZ09}*(?:${ciWord("PATH")}|_${ciWord("DIR")}|_${ciWord("ROOT")}|_${ciWord("HOME")}))|%(?:${ciWord("USERPROFILE")}|${ciWord("HOMEDRIVE")}|${ciWord("HOMEPATH")}|${ciWord("APPDATA")}|${ciWord("LOCALAPPDATA")}|${ciWord("TMP")}|${ciWord("TEMP")})%)`,
  "u",
);
const RX_ASSIGN = new RegExp(
  `${BOUND_L}${AZ09}*(?:${ciWord("API")}${SEP}${ciWord("KEY")}|${ciWord("AUTH")}${SEP}${ciWord("TOKEN")}|${ciWord("ACCESS")}${SEP}${ciWord("TOKEN")}|${ciWord("PASSWORD")}|${ciWord("SECRET")}|${ciWord("CREDENTIAL")})[${PY_S_CLASS}]*=[${PY_S_CLASS}]*[^${PY_S_CLASS},;]+`,
  "u",
);
const RX_TOKEN = new RegExp(
  String.raw`${BOUND_L}(?:${ciWord("GH")}[PpOoUuRrSs\u017F]_${AZ09B}{8,}|${ciWord("GITHUB")}_${ciWord("PAT")}_${AZ09}{8,}|${ciWord("GLPAT")}-${AZ09D}{8,}|${ciWord("SK")}-${AZ09D}{8,}|${ciWord("XOX")}${AZL}-${AZ09H}{8,})${BOUND_R}`,
  "u",
);
// A credential word in identifier position: bounded by non-letters on each side, or
// split from a lowercase run by a camelCase step on either side (githubApiKey,
// secretKey). The boundary tests are case-sensitive while the word itself matches
// in any case. Glued lowercase ("secretary", "mysecret") is indistinguishable
// from a natural word and stays out.
const RX_NAMED_CRED = new RegExp(
  `(?:(?<![A-Za-z])|(?<=[a-z])(?=[A-Z]))(?:${ciWord("API")}${SEP}${ciWord("KEY")}|${ciWord("AUTH")}${SEP}${ciWord("TOKEN")}|${ciWord("ACCESS")}${SEP}${ciWord("TOKEN")}|${ciWord("TOKEN")}|${ciWord("PASSWORD")}|${ciWord("SECRET")}|${ciWord("CREDENTIAL")}${ci("S")}?|${ciWord("KEY")}${SEP}${ciWord("FILE")}|${ciWord("ENV")}${SEP}${ciWord("FILE")}|${ciWord("PRIVATE")}${SEP}${ciWord("KEY")}|${ciWord("ACCESS")}${SEP}${ciWord("KEY")})(?:(?![A-Za-z])|(?<=[a-z])(?=[A-Z]))`,
  "u",
);
// Identifier shape: a separator, a digit, a camelCase step, or all caps.
const RX_IDENT = /[_-]|[0-9]|[a-z][A-Z]|^[A-Z0-9_]+$/u;
const RX_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/u;
const RX_CHECK_NAME = /^[a-z][a-z0-9-]*$/u;
const RX_SCHEME = /^[A-Za-z\u017F\u212A\u0130\u0131][A-Za-z0-9+.\u017F\u212A\u0130\u0131-]*:[^ ]/u;
const RX_CONTROL = /[\x00-\x1f\x7f]/u;
// run verify counts a score's groups this way and stays authoritative: the count below
// matches it literally.
const RX_GROUP_OPEN = /\((?!\?)/gu;

// --- values ---------------------------------------------------------------------------------
export type Rec = Record<string, unknown>;

// A TOML/JSON table: isinstance dict. Arrays, dates and other exotica are not tables.
const isRec = (v: unknown): v is Rec => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

export const asTable = (value: unknown, where: string): Rec => {
  if (!isRec(value)) fail(`${where} must be a table`);
  return value;
};

// Python truthiness for JSON values: {} and [] are falsy, NaN stays truthy.
export const pyTruthy = (v: unknown): boolean => {
  if (v === null || v === undefined || v === false) return false;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v !== "";
  if (Array.isArray(v)) return v.length > 0;
  if (isRec(v)) return Object.keys(v).length > 0;
  return true;
};

// Python's sorted() on strings: code points, where UTF-16 order would put astral
// characters before U+E000.
const cmpPoints = (a: string, b: string): number => {
  const ax = [...a];
  const bx = [...b];
  const n = Math.min(ax.length, bx.length);
  for (let i = 0; i < n; i++) {
    const d = ax[i]!.codePointAt(0)! - bx[i]!.codePointAt(0)!;
    if (d !== 0) return d;
  }
  return ax.length - bx.length;
};

const typeName = (v: unknown): string =>
  typeof v === "object" && v !== null
    ? String((v as { constructor?: { name?: unknown } }).constructor?.name ?? typeof v)
    : typeof v;

// BASE's json.dumps: the control escapes JSON.stringify already emits, plus \u007f and
// every non-ASCII code point as lowercase \uXXXX, astral as a surrogate pair.
const jsonEscape = (s: string): string => {
  let out = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x7f) out += ch;
    else if (cp === 0x7f) out += "\\u007f";
    else if (cp <= 0xffff) out += `\\u${cp.toString(16).padStart(4, "0")}`;
    else {
      const v = cp - 0x10000;
      out += `\\u${(0xd800 + (v >> 10)).toString(16).padStart(4, "0")}`;
      out += `\\u${(0xdc00 + (v & 0x3ff)).toString(16).padStart(4, "0")}`;
    }
  }
  return out;
};

// json.dumps(sort_keys=True): keys sorted by code point, ", " and ": " separators,
// Infinity/-Infinity/NaN tokens. Anything else (a TOML date in a machine config)
// refuses the way BASE's TypeError did: exit 1.
export const sortedJson = (v: unknown): string => {
  if (v === null) return "null";
  if (v === true) return "true";
  if (v === false) return "false";
  if (typeof v === "string") return jsonEscape(JSON.stringify(v));
  if (typeof v === "number") {
    if (Number.isFinite(v)) return JSON.stringify(v) as string;
    return v > 0 ? "Infinity" : v < 0 ? "-Infinity" : "NaN";
  }
  if (Array.isArray(v)) return `[${v.map(sortedJson).join(", ")}]`;
  if (isRec(v)) {
    const keys = Object.keys(v).sort(cmpPoints);
    const parts = keys.map((k) => `${jsonEscape(JSON.stringify(k))}: ${sortedJson(v[k])}`);
    return `{${parts.join(", ")}}`;
  }
  return fail(`Object of type ${String(typeName(v))} is not JSON serializable`);
};

// BASE's json.loads(json.dumps(machine)): a deep copy that keeps inf/nan and refuses
// anything JSON cannot carry.
const deepCopy = (v: unknown): unknown => {
  if (v === null || typeof v === "string" || typeof v === "boolean" || typeof v === "number") {
    return v;
  }
  if (Array.isArray(v)) return v.map(deepCopy);
  if (isRec(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deepCopy(x)]));
  return fail(`Object of type ${String(typeName(v))} is not JSON serializable`);
};

// --- settings paths -----------------------------------------------------------------------------
export const projectRoot = (raw: string): string => {
  let resolved: string;
  try {
    resolved = realpathSync(expandUser(raw));
  } catch {
    return fail(`no such project directory: ${raw}`);
  }
  if (!isDir(resolved)) fail(`no such project directory: ${raw}`);
  return resolved;
};

export const settingsDir = (repo: string): string => {
  const p = join(repo, ".postmaster");
  if (isSymlink(p)) fail(`${p} must be a directory inside the project, not a symlink`);
  if (existsSync(p) && !isDir(p)) fail(`${p} is not a directory`);
  return p;
};

// --- machine-data scan ----------------------------------------------------------------------------
const credentialNameIn = (value: string): boolean => {
  const words = pyWords(value);
  if (words.length > 1) {
    // Phrasing: only identifier-shaped words can name a credential, so
    // "Secret Santa" passes while "Migrate api_key usage" does not.
    return words.some((word) => RX_IDENT.test(word) && RX_NAMED_CRED.test(word));
  }
  // One token: any credential word in identifier position names one.
  return RX_NAMED_CRED.test(pyTrim(value));
};

export const scanMachineData = (value: unknown, location: string, path: string[]): void => {
  if (Array.isArray(value)) {
    value.forEach((item, i) => {
      scanMachineData(item, `${location}[${i}]`, path);
    });
    return;
  }
  if (isRec(value)) {
    for (const [key, item] of Object.entries(value)) {
      // Check names are validated by shape below, not scanned: a check called
      // secret-scan names no credential field.
      if (path[0] !== "checks" && RX_BAD_KEY.test(key)) {
        fail(`${location} names a credential or machine file field: ${key}`);
      }
      scanMachineData(item, `${location}.${key}`, [...path, key]);
    }
    return;
  }
  if (typeof value !== "string") return;
  if (path[0] === "checks" || (path[0] === "project" && path[1] === "risk_surfaces")) {
    return; // prose about the project and shell it runs: shaped, not scanned
  }
  if (
    RX_ABS.test(value) ||
    RX_HOME.test(value) ||
    RX_PARENT.test(value) ||
    RX_WINDOWS.test(value) ||
    RX_UNC.test(value) ||
    RX_FILE_URL.test(value) ||
    RX_ENV.test(value)
  ) {
    fail(`${location} names a filesystem path on a machine`);
  }
  // ASCII: the needle is ASCII, and only ASCII letters plus U+0131 upper into it;
  // ASCII: differenced over the full range, so toUpperCase matches str.upper here exactly.
  const uppered = value.toUpperCase();
  if (
    RX_ASSIGN.test(value) ||
    RX_TOKEN.test(value) ||
    credentialNameIn(value) ||
    uppered.includes("-----BEGIN PRIVATE KEY-----")
  ) {
    fail(`${location} contains a credential value`);
  }
};

// --- settings reads -------------------------------------------------------------------------------
export const parseTomlStrict = (raw: string, label: string): unknown => {
  // BASE's tomllib refuses a byte-order mark; Bun's parser swallows it.
  if (raw.startsWith("\uFEFF")) fail(`${label} does not parse: unexpected byte-order mark`);
  try {
    return parseTomlText(raw);
  } catch (e) {
    return fail(`${label} does not parse: ${errText(e)}`);
  }
};

const parseSettings = (raw: string, label: string, scan: boolean): Rec => {
  const candidate = asTable(parseTomlStrict(raw, label), label);
  // The person's file holds models, env files and other machine settings, so it is
  // never scanned; the shared file keeps the path and credential refusal.
  if (scan) scanMachineData(candidate, label, []);
  return candidate;
};

const readToml = (path: string, label: string, scan: boolean): { data: Rec; present: boolean } => {
  if (isSymlink(path)) fail(`${path} must not be a symlink`);
  if (!existsSync(path)) return { data: {}, present: false };
  if (!isFile(path)) fail(`${path} is not a regular file`);
  let raw: string;
  try {
    raw = strictRead(path);
  } catch (e) {
    if (isDie(e)) throw e;
    return fail(`${label} does not parse: ${errText(e)}`);
  }
  return { data: parseSettings(raw, label, scan), present: true };
};

const knownTurnpikes = (): Set<string> => {
  const r = run(join(dirname(HERE), "run"), ["turnpikes", "--list"], {
    env: { POSTMASTER_PROJECT: undefined },
  });
  if (r.code !== 0) {
    fail(`cannot read the turnpike list: ${pyTrim(r.err) || pyTrim(r.out)}`);
  }
  const names = new Set<string>();
  for (const line of pySplitLines(r.out)) {
    const words = pyWords(line);
    if (words.length > 0) names.add(words[0]!);
  }
  return names;
};

// --- validation -------------------------------------------------------------------------------
const nonblankString = (value: unknown, where: string): string => {
  if (typeof value !== "string" || pyTrim(value) === "" || RX_CONTROL.test(value)) {
    fail(`${where} must be a non-empty string without control characters`);
  }
  return pyTrim(value);
};

const nameList = (value: unknown, where: string, allowEmpty = false): string[] => {
  const ok =
    Array.isArray(value) &&
    (value.length > 0 || allowEmpty) &&
    value.every((x) => typeof x === "string" && pyTrim(x) !== "");
  if (!ok) fail(`${where} must be a ${allowEmpty ? "" : "non-empty "}list of names`);
  const names = (value as string[]).map((x) => pyTrim(x));
  if (new Set(names).size !== names.length) fail(`${where} repeats a name`);
  for (const name of names) {
    if (!RX_NAME.test(name)) fail(`${where} has an invalid name: ${name}`);
  }
  return names;
};

const CHECK_KEYS = ["command", "shows", "use", "score", "threshold", "timeout"];
const CHECK_USES = ["cli-examples", "browser-suite", "web-journey", "library-tests"];

const validateCheck = (name: string, specValue: unknown, where: string): void => {
  // Mirrors the declared-check rules in scripts/run verify, which stays
  // authoritative: write must never persist a shape checks would reject.
  if (!RX_CHECK_NAME.test(name)) fail(`${where}: a check's name is a lowercase word`);
  const spec = asTable(specValue, where);
  const extra = Object.keys(spec)
    .filter((k) => !CHECK_KEYS.includes(k))
    .sort(cmpPoints);
  if (extra.length > 0) {
    fail(`${where}: ${extra.join(", ")} is not a key; the keys are ${CHECK_KEYS.join(", ")}`);
  }
  if (Object.hasOwn(spec, "command") === Object.hasOwn(spec, "use")) {
    fail(`${where} needs a command or a use, not both`);
  }
  const shows = spec.shows;
  if (shows !== undefined && (typeof shows !== "string" || pyTrim(shows) === "")) {
    fail(`${where}: shows is words saying what the check shows`);
  }
  const timeout = spec.timeout;
  if (
    timeout !== undefined &&
    (typeof timeout === "boolean" ||
      typeof timeout !== "number" ||
      !Number.isInteger(timeout) ||
      timeout <= 0)
  ) {
    fail(`${where}: timeout is a whole number of seconds`);
  }
  if (Object.hasOwn(spec, "use")) {
    if (name === "gate" || !CHECK_USES.includes(spec.use as string)) {
      fail(
        `${where}: use names a default, one of ${CHECK_USES.join(", ")}; the gate takes a command`,
      );
    }
    if (Object.hasOwn(spec, "score") || Object.hasOwn(spec, "threshold")) {
      fail(`${where}: a score is read from a command's output, so it goes with command, not use`);
    }
    return;
  }
  const command = spec.command;
  if (typeof command !== "string" || pyTrim(command) === "") {
    fail(`${where}: command is the shell command that runs the check`);
  }
  if (shows === undefined) fail(`${where}: shows says what the check shows`);
  const hasScore = Object.hasOwn(spec, "score");
  const hasThreshold = Object.hasOwn(spec, "threshold");
  if (hasScore !== hasThreshold) fail(`${where}: score and threshold go together`);
  if (hasScore) {
    const score = spec.score;
    if (typeof score !== "string") {
      fail(`${where}: score is a regular expression with one group, the number`);
    }
    // A user pattern, compiled the way run verify compiles it: no flags, so the two
    // validators agree on what counts as a regular expression.
    let groups = 0;
    try {
      // ASCII: BASE compiles user score patterns with no flags.
      groups = (new RegExp(score).source.match(RX_GROUP_OPEN) ?? []).length;
    } catch (e) {
      fail(`${where}: score is not a regular expression: ${errText(e)}`);
    }
    if (groups !== 1) fail(`${where}: score is a regular expression with one group, the number`);
    const threshold = spec.threshold;
    if (typeof threshold === "boolean" || typeof threshold !== "number") {
      fail(`${where}: threshold is a number`);
    }
  }
};

// The global config's top-level keys: what the person's file may override. `tracker`
// is both a global table and a legacy project fact; `project` and `roles` are local
// facts only, and `checks` stays with the shared file.
export const GLOBAL_KEYS = new Set([
  "projects_roots",
  "confine",
  "lanes",
  "team",
  "limits",
  "postmaster",
  "tracker",
  "review",
  "planning",
  "ship",
]);

const CONFIG_TABLE_KEYS = new Set([
  "lanes",
  "team",
  "limits",
  "postmaster",
  "tracker",
  "review",
  "planning",
  "ship",
]);

export const validateCommon = (data: Rec, label: string, local: boolean): Rec => {
  const allowed = local
    ? new Set(["project", "tracker", "roles", ...GLOBAL_KEYS])
    : new Set(["project", "tracker", "checks"]);
  const unknown = Object.keys(data)
    .filter((k) => !allowed.has(k))
    .sort(cmpPoints);
  if (unknown.length > 0) fail(`${label} has unsupported table or key: ${unknown[0]}`);
  const project = asTable(Object.hasOwn(data, "project") ? data.project : {}, `${label}.project`);
  const unknownProject = Object.keys(project)
    .filter((k) => k !== "default_turnpikes" && k !== "risk_surfaces")
    .sort(cmpPoints);
  if (unknownProject.length > 0) fail(`${label}.project has unsupported key: ${unknownProject[0]}`);
  if (Object.hasOwn(project, "default_turnpikes")) {
    const names = nameList(project.default_turnpikes, `${label}.project.default_turnpikes`, true);
    const known = knownTurnpikes();
    const bad = names.filter((n) => !known.has(n));
    if (bad.length > 0) {
      fail(`${label}.project.default_turnpikes names an unknown turnpike: ${bad[0]}`);
    }
    project.default_turnpikes = names;
  }
  if (Object.hasOwn(project, "risk_surfaces")) {
    const surfaces = project.risk_surfaces;
    if (typeof surfaces === "string") {
      project.risk_surfaces = nonblankString(surfaces, `${label}.project.risk_surfaces`);
    } else if (
      Array.isArray(surfaces) &&
      surfaces.length > 0 &&
      surfaces.every((x) => typeof x === "string" && pyTrim(x) !== "")
    ) {
      project.risk_surfaces = surfaces.map((x) => pyTrim(x as string));
    } else {
      fail(`${label}.project.risk_surfaces must be non-empty text or a list of non-empty strings`);
    }
  }
  const tracker = asTable(Object.hasOwn(data, "tracker") ? data.tracker : {}, `${label}.tracker`);
  if (!local) {
    const unknownTracker = Object.keys(tracker)
      .filter((k) => k !== "binding")
      .sort(cmpPoints);
    if (unknownTracker.length > 0) {
      fail(`${label}.tracker has unsupported key: ${unknownTracker[0]}`);
    }
  }
  if (Object.hasOwn(tracker, "binding")) {
    const binding = nonblankString(tracker.binding, `${label}.tracker.binding`);
    // A name admits board-title punctuation; a path or URL does not pass. The shared
    // file's value scan already refuses absolute, home, parent, Windows, UNC, file:
    // and env-var paths; the person's file is not scanned, so this refuses a parent
    // itself, and for both files only what the scan misses: separators anywhere, a
    // URL scheme, and a leading ~ or $ expansion.
    if (
      binding.includes("/") ||
      binding.includes("\\") ||
      binding.includes("://") ||
      RX_SCHEME.test(binding) ||
      RX_PARENT.test(binding) ||
      binding.startsWith("~") ||
      binding.startsWith("$")
    ) {
      fail(`${label}.tracker.binding must be a tracker name, not a path or URL`);
    }
    tracker.binding = binding;
  }
  if (!local && Object.hasOwn(data, "checks")) {
    const checks = asTable(data.checks, `${label}.checks`);
    for (const [checkName, checkSpec] of Object.entries(checks)) {
      validateCheck(checkName, checkSpec, `${label}.checks.${checkName}`);
    }
  }
  if (local) {
    const roles = asTable(Object.hasOwn(data, "roles") ? data.roles : {}, `${label}.roles`);
    const allowedRoles = new Set(["workhorses", "reviewers", "coachman", "lens_reviewers"]);
    const unknownRoles = Object.keys(roles)
      .filter((k) => !allowedRoles.has(k))
      .sort(cmpPoints);
    if (unknownRoles.length > 0) fail(`${label}.roles has unsupported key: ${unknownRoles[0]}`);
    for (const key of ["workhorses", "reviewers"]) {
      if (Object.hasOwn(roles, key)) roles[key] = nameList(roles[key], `${label}.roles.${key}`);
    }
    if (Object.hasOwn(roles, "coachman")) {
      const coachman = nonblankString(roles.coachman, `${label}.roles.coachman`);
      if (coachman !== "coachman" && coachman !== "coachman_fallback") {
        fail(`${label}.roles.coachman must name coachman or coachman_fallback`);
      }
      roles.coachman = coachman;
    }
    if (Object.hasOwn(roles, "lens_reviewers")) {
      const lenses = asTable(roles.lens_reviewers, `${label}.roles.lens_reviewers`);
      const allowedLenses = new Set(["style", "bug", "security"]);
      for (const [lens, lensNames] of Object.entries(lenses)) {
        if (!allowedLenses.has(lens)) {
          fail(`${label}.roles.lens_reviewers names an unknown lens: ${lens}`);
        }
        lenses[lens] = nameList(lensNames, `${label}.roles.lens_reviewers.${lens}`);
      }
    }
  }
  if (local) {
    // Overrides are shaped like the global config, which itself is unvalidated, so
    // only the top-level shape is checked: tables stay tables, roots stay a list.
    for (const key of [...CONFIG_TABLE_KEYS].sort(cmpPoints)) {
      if (Object.hasOwn(data, key)) asTable(data[key], `${label}.${key}`);
    }
    if (Object.hasOwn(data, "projects_roots")) {
      const roots = data.projects_roots;
      if (!Array.isArray(roots)) fail(`${label}.projects_roots must be a list of roots`);
    }
    if (Object.hasOwn(data, "confine")) {
      if (data.confine !== "on" && data.confine !== "off")
        fail(`${label}.confine must be "on" or "off"`);
    }
  }
  return data;
};

// --- tracked files and acceptance ---------------------------------------------------------------------------
// Tracked means git ls-files --error-unmatch finds the settings file in the project's
// own repository. The global config is never tested this way. GIT_* from the caller
// must not steer repo identity to another repository.
const GIT_ENV_KEYS = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_COMMON_DIR",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_NAMESPACE",
] as const;

// Whether a .git entry exists at the directory or any ancestor: git discovery
// would find a repository here, so a failed rev-parse is a refusal, not a
// missing repository. An unreadable directory fails closed.
const hasGitEntry = (dir: string): boolean => {
  let current = dir;
  for (;;) {
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return true;
    }
    if (entries.includes(".git")) return true;
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
};

export const isTracked = (repo: string, file: string): boolean => {
  const env: Record<string, string | undefined> = {};
  for (const k of GIT_ENV_KEYS) env[k] = undefined;
  // Both pathspecs match case-insensitively: on a case-insensitive
  // filesystem a committed variant at any level opens under this name — a
  // committed .POSTMASTER/settings.toml lands inside a pre-existing
  // .postmaster/ directory — while git matches case-sensitively.
  const r = run("git", ["-C", repo, "ls-files", "--error-unmatch", "--", `:(icase)${file}`], {
    env,
  });
  if (r.code === 0) return true;
  if (r.code !== 1) {
    // git could not answer: fail closed, unless the directory is cleanly not
    // a repository, where no file can be tracked. --show-toplevel needs no
    // index, so it still answers when the index is unreadable; when it fails
    // too, a .git entry anywhere up-tree means git refused (ownership,
    // permissions, a broken .git), which fails closed, and only its absence
    // reads as untracked. A missing git with a repository present fails
    // closed; with no repository there is nothing to be tracked in.
    const top = run("git", ["-C", repo, "rev-parse", "--show-toplevel"], { env });
    if (top.code === 0) return true;
    return hasGitEntry(repo);
  }
  // Exit 1 is "did not match": untracked only when the file is positively the
  // person's own. A file inside a submodule is absent from the superproject's
  // index and reads as tracked, and every component from the repository to
  // the file must match on disk exactly, so committed content cannot skip
  // acceptance either way.
  let current = file;
  for (;;) {
    const parent = dirname(current);
    let entries: string[];
    try {
      entries = readdirSync(parent);
    } catch {
      return true;
    }
    if (!entries.includes(basename(current))) return true;
    if (parent === repo) break;
    if (relative(repo, parent).startsWith("..")) return true;
    current = parent;
  }
  const rel = relative(repo, dirname(file));
  const sub = run(
    "git",
    ["-C", repo, "ls-files", "-s", "--", `:(icase)${rel === "" ? "." : rel}`],
    { env },
  );
  if (sub.code !== 0) return true;
  if (pySplitLines(sub.out).some((line) => line.startsWith("160000 "))) return true;
  return false;
};

/** The work-tree top level a path is in, or empty when git cannot say.
 * Settings live at the repository root, whatever subdirectory names the
 * target; front-door and check-setup resolve it through this. */
export const repoTopLevel = (path: string): string => {
  // An empty path is unresolvable: git -C "" would silently mean the process cwd.
  if (!path) return "";
  const env: Record<string, string | undefined> = {};
  for (const k of GIT_ENV_KEYS) env[k] = undefined;
  const r = run("git", ["-C", path, "rev-parse", "--show-toplevel"], { env });
  return r.code === 0 ? r.out.trim() : "";
};

const canonRepo = (repo: string): string => {
  try {
    return realpathSync(repo);
  } catch {
    return repo;
  }
};

const sha256Bytes = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

interface AcceptanceEntry {
  file: string;
  sha256: string;
  accepted_at: string;
}

type AcceptanceStore = Record<string, AcceptanceEntry>;

const readStore = (storePath: string): AcceptanceStore => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(storePath, "utf8"));
    if (!isRec(parsed)) return {};
    const out: AcceptanceStore = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (
        isRec(v) &&
        typeof v.file === "string" &&
        typeof v.sha256 === "string" &&
        typeof v.accepted_at === "string"
      ) {
        out[k] = { file: v.file, sha256: v.sha256, accepted_at: v.accepted_at };
      }
    }
    return out;
  } catch {
    return {};
  }
};

const SETTINGS_REL = join(".postmaster", "settings.toml");

/** Write text to dest through a temp file in dir, fsynced and renamed, so a
 * crash cannot leave a truncation behind. The caller creates dir first. */
export const atomicWriteFileSync = (dir: string, dest: string, text: string): void => {
  const tmpName = mkstempSync(dir, `.${basename(dest)}.`);
  try {
    const fd = openSync(tmpName, "w");
    try {
      writeSync(fd, text);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmpName, dest);
  } catch (e) {
    try {
      unlinkSync(tmpName);
    } catch {
      // The write already failed; a leftover temp file is not the error to report.
    }
    throw e;
  }
};

const isAccepted = (storePath: string, repo: string, settingsFile: string): boolean => {
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(settingsFile);
  } catch {
    return false;
  }
  const entry = readStore(storePath)[canonRepo(repo)];
  return entry !== undefined && entry.file === SETTINGS_REL && entry.sha256 === sha256Bytes(bytes);
};

/** Record the user's acceptance of the tracked settings file's current content. */
export const recordAcceptance = (repo: string, configPath: string): string => {
  const resolved = projectRoot(repo);
  const settingsFile = join(settingsDir(resolved), "settings.toml");
  if (isSymlink(settingsFile)) fail(`${settingsFile} must not be a symlink`);
  if (!isFile(settingsFile)) fail(`no project settings at ${settingsFile}`);
  if (!isTracked(resolved, settingsFile)) {
    return `${settingsFile} is not tracked; it is used without acceptance`;
  }
  const storePath = acceptanceStorePath(configPath);
  const bytes = readFileSync(settingsFile);
  const store = readStore(storePath);
  const key = canonRepo(resolved);
  if (store[key] !== undefined && store[key].sha256 === sha256Bytes(bytes)) {
    return `${settingsFile} is already accepted`;
  }
  // Accepted content must be usable: validate before recording.
  const local = readToml(settingsFile, "local project settings", false);
  validateCommon(local.data, "local project settings", true);
  const candidateRoles = Object.hasOwn(local.data, "roles") ? local.data.roles : {};
  if (isRec(candidateRoles) && Object.keys(candidateRoles).length > 0) {
    // A [roles] table naming a lane the resolved config does not define would
    // fail every later read: resolve it now, against the same config the
    // readers use, and refuse the acceptance instead.
    const machine = isFile(expandUser(configPath)) ? loadMachine(configPath) : {};
    effectiveConfig(resolved, machine, { shared: {}, local: local.data });
  }
  store[key] = {
    file: SETTINGS_REL,
    sha256: sha256Bytes(bytes),
    accepted_at: new Date().toISOString(),
  };
  mkdirSync(dirname(storePath), { recursive: true });
  atomicWriteFileSync(dirname(storePath), storePath, `${JSON.stringify(store, null, 2)}\n`);
  return `accepted ${settingsFile}`;
};

export const pendingNotice = (settingsFile: string): string =>
  `project-settings: ${settingsFile} is tracked and waits for acceptance; using the global config`;

/** The pending notice for a repo's settings file, or null when none waits. */
export const pendingNoticeFor = (repo: string, storePath?: string): string | null => {
  const profiles = loadProfiles(repo, storePath === undefined ? undefined : { storePath });
  return profiles.acceptance === "pending" ? pendingNotice(profiles.settingsFile) : null;
};

export type LocalAcceptance = "not-needed" | "pending" | "accepted";

// --- profiles -----------------------------------------------------------------------------------
export const loadProfiles = (
  repo: string,
  opts?: { storePath?: string },
): {
  shared: Rec;
  local: Rec;
  hasShared: boolean;
  hasLocal: boolean;
  acceptance: LocalAcceptance;
  settingsFile: string;
} => {
  const d = settingsDir(repo);
  const shared = readToml(join(d, "project.toml"), "shared project settings", true);
  validateCommon(shared.data, "shared project settings", false);
  const settingsFile = join(d, "settings.toml");
  if (isSymlink(settingsFile)) fail(`${settingsFile} must not be a symlink`);
  if (!isFile(settingsFile)) {
    if (existsSync(settingsFile)) fail(`${settingsFile} is not a regular file`);
    return {
      shared: shared.data,
      local: {},
      hasShared: shared.present,
      hasLocal: false,
      acceptance: "not-needed",
      settingsFile,
    };
  }
  // Gating preempts parsing: a tracked file the user has not accepted reads as
  // absent, whatever it holds; only its bytes are hashed, never parsed.
  const storePath = opts?.storePath ?? acceptanceStorePath(globalConfigPath());
  const tracked = isTracked(repo, settingsFile);
  if (tracked && !isAccepted(storePath, repo, settingsFile)) {
    return {
      shared: shared.data,
      local: {},
      hasShared: shared.present,
      hasLocal: true,
      acceptance: "pending",
      settingsFile,
    };
  }
  const local = readToml(settingsFile, "local project settings", false);
  validateCommon(local.data, "local project settings", true);
  return {
    shared: shared.data,
    local: local.data,
    hasShared: shared.present,
    hasLocal: local.present,
    acceptance: tracked ? "accepted" : "not-needed",
    settingsFile,
  };
};

const mergedProfile = (shared: Rec, local: Rec, hasShared: boolean, hasLocal: boolean): Rec => {
  const out: Rec = {
    shared_present: hasShared,
    local_present: hasLocal,
    project: {},
    tracker: {},
    roles: {},
    sources: {},
  };
  const project = out.project as Rec;
  const tracker = out.tracker as Rec;
  const sources = out.sources as Rec;
  const sharedProject = asTable(Object.hasOwn(shared, "project") ? shared.project : {}, "project");
  const localProject = asTable(Object.hasOwn(local, "project") ? local.project : {}, "project");
  for (const field of ["default_turnpikes", "risk_surfaces"]) {
    if (Object.hasOwn(sharedProject, field)) {
      project[field] = sharedProject[field];
      sources[`project.${field}`] = "shared";
    }
    if (Object.hasOwn(localProject, field)) {
      project[field] = localProject[field];
      sources[`project.${field}`] = "local";
    }
    if (!Object.hasOwn(project, field)) sources[`project.${field}`] = "discovery";
  }
  const sharedTracker = asTable(Object.hasOwn(shared, "tracker") ? shared.tracker : {}, "tracker");
  const localTracker = asTable(Object.hasOwn(local, "tracker") ? local.tracker : {}, "tracker");
  if (Object.hasOwn(sharedTracker, "binding")) {
    tracker.binding = sharedTracker.binding;
    sources["tracker.binding"] = "shared";
  }
  if (Object.hasOwn(localTracker, "binding")) {
    tracker.binding = localTracker.binding;
    sources["tracker.binding"] = "local";
  }
  if (!Object.hasOwn(tracker, "binding")) sources["tracker.binding"] = "discovery";
  const roles = asTable(Object.hasOwn(local, "roles") ? local.roles : {}, "roles");
  out.roles = roles;
  sources.roles = Object.keys(roles).length > 0 ? "local" : "machine";
  return out;
};

export const loadMachine = (path: string): Rec => {
  if (path === "-") {
    try {
      return asTable(JSON.parse(strictStdin()), "machine config");
    } catch (e) {
      if (isDie(e)) throw e;
      return fail(`machine config JSON does not parse: ${errText(e)}`);
    }
  }
  let raw: string;
  try {
    raw = strictRead(expandUser(path));
  } catch (e) {
    return fail(`machine config ${path} does not parse: ${errText(e)}`);
  }
  return asTable(parseTomlStrict(raw, `machine config ${path}`), "machine config");
};

// The merge is a pure function of two tables: a group merges, a list or single
// value replaces whole. Untouched subtrees are shared with the inputs, so the
// caller passes a base it owns.
export const mergeTables = (base: unknown, override: unknown): unknown => {
  if (isRec(base) && isRec(override)) {
    const out: Rec = { ...base };
    for (const [key, value] of Object.entries(override)) {
      out[key] = Object.hasOwn(base, key) ? mergeTables(base[key], value) : value;
    }
    return out;
  }
  return override;
};

// The person's file minus its legacy project facts: [project] and [roles] stay facts
// for inspect, and tracker.binding stays the project's binding, so none of them merge
// into the config. A tracker table left empty by the binding's removal goes too,
// so what remains is exactly the file's real machine settings.
const stripLegacy = (local: Rec): Rec => {
  const out: Rec = { ...local };
  delete out.project;
  delete out.roles;
  if (isRec(out.tracker)) {
    const tracker: Rec = { ...(out.tracker as Rec) };
    delete tracker.binding;
    if (Object.keys(tracker).length === 0) delete out.tracker;
    else out.tracker = tracker;
  }
  return out;
};

// A [roles] table in an existing file keeps working, read as the team entries it
// names. Entries the file sets explicitly under [team] win over the legacy ones.
const applyRoles = (merged: Rec, roles: Rec, explicitTeam: Rec): void => {
  if (Object.keys(roles).length === 0) return;
  const lanes = asTable(Object.hasOwn(merged, "lanes") ? merged.lanes : {}, "resolved [lanes]");
  if (!Object.hasOwn(merged, "team")) merged.team = {};
  const team = asTable(merged.team, "resolved [team]");
  const checkLanes = (names: string[], where: string): void => {
    const unknown = names.filter((n) => !Object.hasOwn(lanes, n));
    if (unknown.length > 0) {
      fail(`local roles.${where} names ${unknown[0]}, which is not a lane in [lanes]`);
    }
  };
  for (const key of ["workhorses", "reviewers"]) {
    if (Object.hasOwn(roles, key) && !Object.hasOwn(explicitTeam, key)) {
      const names = roles[key] as string[];
      checkLanes(names, key);
      team[key] = names;
    }
  }
  if (Object.hasOwn(roles, "coachman") && !Object.hasOwn(explicitTeam, "coachman")) {
    const source = roles.coachman as string;
    const coachman = Object.hasOwn(team, source) ? team[source] : undefined;
    if (!isRec(coachman) || !pyTruthy(coachman.harness) || !pyTruthy(coachman.model)) {
      fail(`local roles.coachman selects ${source}, but the resolved config does not define it`);
    }
    team.coachman = coachman;
  }
  if (Object.hasOwn(roles, "lens_reviewers")) {
    const explicitLenses = isRec(explicitTeam.lens_reviewers)
      ? (explicitTeam.lens_reviewers as Rec)
      : {};
    const own = asTable(
      Object.hasOwn(team, "lens_reviewers") ? team.lens_reviewers : {},
      "resolved [team.lens_reviewers]",
    );
    for (const [lens, lensNames] of Object.entries(roles.lens_reviewers as Rec)) {
      if (Object.hasOwn(explicitLenses, lens)) continue;
      const names = lensNames as string[];
      checkLanes(names, `lens_reviewers.${lens}`);
      own[lens] = names;
    }
    team.lens_reviewers = own;
  }
};

// One merged lane/role selection with its local-layer counterpart: which file
// set a value is decided here, once, for launch's env base and run-meta's
// recording. The legs rule matches resolveSpec: a won leg reads its leg
// table, anything else the role table. Pure lookup, never dies.
export const specPairFor = (
  merged: Rec,
  local: Rec,
  name: string,
  leg: string,
): { merged: Rec; local: Rec } => {
  const asTable = (v: unknown): Rec =>
    v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {};
  const mteam = asTable(merged.team);
  const lteam = asTable(local.team);
  if (name === "coachman") {
    const wonLeg = leg !== "" ? asTable(mteam.coachman_legs)[leg] : undefined;
    if (wonLeg !== undefined && wonLeg !== null) {
      return { merged: asTable(wonLeg), local: asTable(asTable(lteam.coachman_legs)[leg]) };
    }
    return { merged: asTable(mteam.coachman), local: asTable(lteam.coachman) };
  }
  if (name === "coachman_fallback") {
    return { merged: asTable(mteam.coachman_fallback), local: asTable(lteam.coachman_fallback) };
  }
  if (name === "postmaster") {
    return { merged: asTable(mteam.postmaster), local: asTable(lteam.postmaster) };
  }
  if (name === "clerk") {
    return { merged: asTable(mteam.clerk), local: asTable(lteam.clerk) };
  }
  const mlanes = asTable(merged.lanes);
  const llanes = asTable(local.lanes);
  return { merged: asTable(mlanes[name]), local: asTable(llanes[name]) };
};

// Record-time normalization: a relative env_file the project's settings set
// resolves against the project root, so --run launches agree with --project
// ones. Global-set relatives stay relative for the live config's directory;
// absolute and ~ values pass through. Mutates the merged record it owns.
export const absolutizeProjectEnvFiles = (merged: Rec, local: Rec, root: string): void => {
  const fixPair = (site: { merged: Rec; local: Rec }): void => {
    const value = site.merged.env_file;
    const localValue = site.local.env_file;
    if (
      typeof value === "string" &&
      value !== "" &&
      !value.startsWith("~") &&
      !value.startsWith("/") &&
      typeof localValue === "string" &&
      localValue !== ""
    ) {
      site.merged.env_file = join(root, value);
    }
  };
  const asTable = (v: unknown): Rec =>
    v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {};
  for (const key of Object.keys(asTable(merged.lanes))) {
    fixPair(specPairFor(merged, local, key, ""));
  }
  const legs = asTable(asTable(merged.team).coachman_legs);
  const roles: Array<[string, string]> = [
    ["coachman", ""],
    ["coachman_fallback", ""],
    ["postmaster", ""],
    ["clerk", ""],
    ...Object.keys(legs).map((leg): [string, string] => ["coachman", leg]),
  ];
  for (const [name, leg] of roles) fixPair(specPairFor(merged, local, name, leg));
};

export const effectiveConfig = (
  repo: string,
  machine: Rec,
  pair?: { shared: Rec; local: Rec },
): Rec => {
  const cfg = asTable(deepCopy(machine), "machine config");
  const local = pair === undefined ? loadProfiles(repo).local : pair.local;
  const stripped = stripLegacy(local);
  const merged = asTable(mergeTables(cfg, stripped), "machine config");
  const explicitTeam = isRec(stripped.team) ? (stripped.team as Rec) : {};
  const roles = asTable(Object.hasOwn(local, "roles") ? local.roles : {}, "roles");
  applyRoles(merged, roles, explicitTeam);
  return merged;
};

export interface EffectiveResult {
  config: Rec | null;
  notice: string | null;
  error: string | null;
  local: Rec;
  globalPath: string;
  projectFile: string | null;
  projectAlone: boolean;
}

const failed = (error: string, notice: string | null, globalPath: string): EffectiveResult => ({
  config: null,
  notice,
  error,
  local: {},
  globalPath,
  projectFile: null,
  projectAlone: false,
});

// The effective config for a project: the global config with the person's file
// merged over it, or the person's file alone when there is no global config. A
// tracked file waiting for acceptance reads as absent, and the notice says so.
// Readers print the notice to stderr and die on the error with their own prefix.
export const effectiveConfigForProject = (repo: string, configPath?: string): EffectiveResult => {
  // An explicitly passed path may carry a ~; expand once so the probe below and
  // the read agree. globalConfigPath already expands; expandUser is idempotent.
  const globalPath = expandUser(configPath ?? globalConfigPath());
  try {
    const resolved = projectRoot(repo);
    // A piped machine config ("-", as loadMachine reads it) names no file the
    // acceptance store can sit beside: it shares the default store.
    const storePath =
      globalPath === "-"
        ? acceptanceStorePath(globalConfigPath())
        : acceptanceStorePath(globalPath);
    const profiles = loadProfiles(resolved, { storePath });
    const notice = profiles.acceptance === "pending" ? pendingNotice(profiles.settingsFile) : null;
    let global: Rec | null = null;
    if (globalPath === "-") {
      global = loadMachine("-");
    } else if (existsSync(globalPath) || isSymlink(globalPath)) {
      if (!isFile(globalPath)) {
        return failed(`${globalPath} is not a regular file`, notice, globalPath);
      }
      let raw: string;
      try {
        raw = strictRead(expandUser(globalPath));
      } catch (e) {
        return failed(`${globalPath} does not parse: ${errText(e)}`, notice, globalPath);
      }
      try {
        global = asTable(parseTomlStrict(raw, globalPath), "machine config");
      } catch (e) {
        if (isDie(e)) return failed(e.message, notice, globalPath);
        throw e;
      }
    }
    const stripped = stripLegacy(profiles.local);
    const usable =
      profiles.hasLocal && profiles.acceptance !== "pending" && Object.keys(stripped).length > 0;
    if (global === null && !usable) {
      return failed(
        `no config at ${globalPath} (POSTMASTER_CONFIG overrides the path)`,
        notice,
        globalPath,
      );
    }
    const merged = asTable(mergeTables(deepCopy(global ?? {}), stripped), "machine config");
    const explicitTeam = isRec(stripped.team) ? (stripped.team as Rec) : {};
    const roles = asTable(
      Object.hasOwn(profiles.local, "roles") ? profiles.local.roles : {},
      "roles",
    );
    applyRoles(merged, roles, explicitTeam);
    return {
      config: merged,
      notice,
      error: null,
      local: profiles.local,
      globalPath,
      projectFile: profiles.hasLocal ? profiles.settingsFile : null,
      projectAlone: global === null,
    };
  } catch (e) {
    if (isDie(e)) return failed(e.message, null, globalPath);
    throw e;
  }
};

// --- commands -------------------------------------------------------------------------------------
export const inspect = (repo: string, opts?: { storePath?: string }): Rec => {
  const { shared, local, hasShared, hasLocal, acceptance } = loadProfiles(repo, opts);
  const profile = mergedProfile(shared, local, hasShared, hasLocal);
  profile.shared_file = hasShared ? ".postmaster/project.toml" : null;
  profile.local_file = hasLocal ? ".postmaster/settings.toml" : null;
  profile.local_acceptance = acceptance;
  return profile;
};

// --- writes ----------------------------------------------------------------------------------------
// The folder's own ignore rules: run records and drafts stay ignored whatever the
// user answers. The person's settings file is never ignored here: setup offers to
// have git ignore it, and only the user's yes adds that rule (ignoreSettings).
const IGNORE_RECORDS = ["runs/", "clerk/", "project.toml", ".gitignore"] as const;

const IGNORE_HEADER =
  "# .postmaster/ holds this instance's settings and every run's full record.\n" +
  "# Run records and drafts stay ignored. settings.toml is ignored only on the\n" +
  "# user's yes, during setup. To share what a run requires of everyone,\n" +
  "# commit project.toml with: git add -f .postmaster/project.toml\n";

/** ruleMatches <rule> <path>: whether one ignore rule matches a path under
 * .postmaster/. Enough of gitignore for the rules this file writes and the
 * negations around them: a star matches all, a trailing slash matches the
 * directory and all below it, `dir/**` matches all below it, and anything
 * else matches that path. */
const ruleMatches = (rule: string, path: string): boolean => {
  if (rule === "*") return true;
  if (rule.endsWith("/**")) {
    const dir = rule.slice(0, -3);
    return path === dir || path.startsWith(`${dir}/`);
  }
  if (rule.endsWith("/")) {
    const dir = rule.slice(0, -1);
    return path === dir || path.startsWith(`${dir}/`);
  }
  return path === rule || path.startsWith(`${rule}/`);
};

/** effectiveRules <text>: the ignore file's rules, blanks and comments out. */
const effectiveRules = (text: string): string[] =>
  pySplitLines(text)
    .map((line) => pyTrim(line))
    .filter((line) => line !== "" && !line.startsWith("#"));

/** coveringRule <rule> <target>: whether one positive rule covers a record
 * target wholesale: the whole directory for runs/ and clerk/, the file for
 * project.toml and .gitignore. A narrow rule such as runs/T-1/ covers only
 * part of a directory and never counts. */
const coveringRule = (rule: string, target: string): boolean => {
  const bare = rule.startsWith("/") ? rule.slice(1) : rule;
  if (bare === "*") return true;
  if (target.endsWith("/")) {
    const dir = target.slice(0, -1);
    return bare === dir || bare === target || bare === `${dir}/**`;
  }
  return bare === target;
};

/** negationHits <rule> <target>: whether one negation reaches a record
 * target: the file itself, the directory itself, or anything below it. */
const negationHits = (rule: string, target: string): boolean => {
  if (target.endsWith("/")) {
    const dir = target.slice(0, -1);
    return (
      rule === "*" ||
      rule === dir ||
      rule === target ||
      rule === `/${dir}` ||
      rule === `/${target}` ||
      rule.startsWith(target) ||
      rule.startsWith(`/${target}`)
    );
  }
  return ruleMatches(rule, target);
};

/** coveredBy <rules> <target>: the last word on a record target. A positive
 * rule covering it counts until a negation reaching it, and a later
 * covering rule counts again. */
const coveredBy = (rules: string[], target: string): boolean => {
  let covered = false;
  for (const line of rules) {
    if (line.startsWith("!")) {
      if (negationHits(line.slice(1), target)) covered = false;
    } else if (coveringRule(line, target)) {
      covered = true;
    }
  }
  return covered;
};

export const ensureIgnore = (repo: string, quiet = false): void => {
  const d = settingsDir(repo);
  mkdirSync(d, { recursive: true });
  const ignore = join(d, ".gitignore");
  if (isSymlink(ignore)) fail(`${ignore} must not be a symlink`);
  if (existsSync(ignore) && !isFile(ignore)) fail(`${ignore} is not a regular file`);
  const existing = existsSync(ignore) ? strictRead(ignore) : "";
  const effective = effectiveRules(existing);
  // Append each record rule no covering rule holds; a target already
  // ignored, by a star or by an earlier line, is left alone. No rule added
  // here ever ignores the person's settings file. Git is the truth where
  // the matcher cannot read a rule: a glob negation can expose a target
  // the matcher calls covered. A git that fails reads as covered, so a
  // directory git cannot see never grows duplicates.
  const missing = IGNORE_RECORDS.filter(
    (rule) =>
      !coveredBy(effective, rule) || gitIgnores(repo, join(settingsDir(repo), rule)) === false,
  );
  if (missing.length > 0) {
    let prefix = existing;
    if (prefix !== "" && !prefix.endsWith("\n")) prefix += "\n";
    if (prefix === "") prefix = IGNORE_HEADER;
    writeFileSync(ignore, `${prefix}${missing.join("\n")}\n`);
  }
  if (!quiet) console.log(`project-settings: ensured ${ignore}`);
};

/** gitIgnores <repo> <path>: whether git ignores a path: true, false, or null
 * when git itself fails. */
const gitIgnores = (repo: string, path: string): boolean | null => {
  const env: Record<string, string | undefined> = {};
  for (const k of GIT_ENV_KEYS) env[k] = undefined;
  const r = run("git", ["-C", repo, "check-ignore", "-q", path], { env });
  if (r.code === 0) return true;
  if (r.code === 1) return false;
  return null;
};

/** settingsIgnored <repo>: whether git ignores the person's settings file. A path
 * git cannot place, or a git that fails, reads as not ignored. */
export const settingsIgnored = (repo: string): boolean =>
  gitIgnores(repo, join(settingsDir(repo), "settings.toml")) ?? false;

/** ignoreSettings <repo>: ignore the person's settings file, on the user's yes.
 * Setup asks; this applies. Idempotent: a literal already last, or a file
 * git already ignores through another rule, stays as it is. Git is the
 * truth where this file's matcher cannot read a rule. */
export const ignoreSettings = (repo: string): void => {
  ensureIgnore(repo, true);
  const ignore = join(settingsDir(repo), ".gitignore");
  const effective = effectiveRules(strictRead(ignore));
  let last: string | null = null;
  for (const r of effective) {
    const body = r.startsWith("!") ? r.slice(1) : r;
    if (ruleMatches(body, "settings.toml")) last = r;
  }
  if (last === "settings.toml") return;
  if (settingsIgnored(repo)) return;
  let prefix = strictRead(ignore);
  if (prefix !== "" && !prefix.endsWith("\n")) prefix += "\n";
  writeFileSync(ignore, `${prefix}settings.toml\n`);
};

export const writeProfile = (repo: string, layer: string, source: string): void => {
  if (layer !== "project" && layer !== "local") fail("write layer must be project or local");
  const d = settingsDir(repo);
  const name = layer === "project" ? "project.toml" : "settings.toml";
  const dest = join(d, name);
  if (isSymlink(dest)) fail(`${dest} must not be a symlink`);
  let raw: string;
  try {
    raw = source === "-" ? strictStdin() : strictRead(expandUser(source));
  } catch (e) {
    if (isDie(e)) throw e;
    fail(`cannot read settings input: ${errText(e)}`);
  }
  const candidate = asTable(parseTomlStrict(raw, "settings input"), "settings input");
  if (layer === "project") scanMachineData(candidate, "settings input", []);
  validateCommon(candidate, "settings input", layer === "local");
  // Validate the complete resulting pair before changing either file.
  const { shared: oldShared, local: oldLocal } = loadProfiles(repo);
  const nextShared = layer === "project" ? candidate : oldShared;
  const nextLocal = layer === "local" ? candidate : oldLocal;
  validateCommon(nextShared, "shared project settings", false);
  validateCommon(nextLocal, "local project settings", true);
  const nextRoles = Object.hasOwn(nextLocal, "roles") ? nextLocal.roles : {};
  if (isRec(nextRoles) && Object.keys(nextRoles).length > 0) {
    // Roles resolve against the same config the readers use: the global file
    // where one exists, the local candidate alone where the project stands alone.
    const configPath = globalConfigPath();
    const machine = isFile(configPath) ? loadMachine(configPath) : {};
    effectiveConfig(repo, machine, { shared: nextShared, local: nextLocal });
  }
  mkdirSync(d, { recursive: true });
  ensureIgnore(repo, true);
  if (existsSync(dest) && !isFile(dest)) fail(`${dest} is not a regular file`);
  atomicWriteFileSync(d, dest, raw.endsWith("\n") ? raw : `${raw}\n`);
  console.log(`project-settings: wrote ${dest}`);
};
