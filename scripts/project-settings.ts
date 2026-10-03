// Read, validate and write a project's optional shared and local settings.
//
//   run project-settings inspect <repo>       resolved facts and their source as JSON
//   run project-settings report <repo>        compact key=value source report
//   run project-settings effective <repo> [<machine-config>]
//                                             machine config with local role choices applied
//   run project-settings ensure <repo>         create .postmaster/.gitignore, no settings
//   run project-settings write <repo> project|local [<toml-file>]
//                                             validate, then write the agreed settings
//
//   exit 0  printed, wrote, or ensured
//   exit 1  usage; anything invalid, missing, or unreadable
//
// Shared settings are .postmaster/project.toml. Local settings are the ignored
// .postmaster/settings.toml. Missing files are normal. Project files may not name machine paths
// or credentials. The only machine data accepted by a local role choice is a name already in the
// machine config; harnesses, models, env files and other machine details stay there.
// Risk surfaces are prose and check commands are shell the project runs, so those values may
// mention a path or a secret's name; a name field (tracker binding, lane, turnpike) may not.
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseTomlText } from "./lib/data.ts";
import { scriptsDir } from "./lib/paths.ts";
import { mkstempSync, run } from "./lib/proc.ts";
import {
  BOUND_L,
  BOUND_R,
  END_OR_BEFORE_NL,
  PY_S_CLASS,
  pySplitLines,
  pyTrim,
  pyWords,
} from "./lib/text.ts";

const HERE = scriptsDir(import.meta);
const USAGE =
  "usage: run project-settings inspect|report <repo> | effective <repo> [<machine-config>]" +
  " | ensure <repo> | write <repo> project|local [<toml-file>]";

// --- failure ----------------------------------------------------------------------------
// Internal failures throw a branded value the entry point catches; anything else
// propagates as an unexpected crash, the way BASE's uncaught tracebacks did.
interface Die {
  tag: "die";
  message: string;
}

export const isDie = (e: unknown): e is Die =>
  typeof e === "object" && e !== null && (e as { tag?: unknown }).tag === "die";

function fail(message: string): never {
  const d: Die = { tag: "die", message };
  throw d;
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// --- filesystem edges ---------------------------------------------------------------------
const isSymlink = (p: string): boolean => {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};

const isFile = (p: string): boolean => {
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

const strictRead = (p: string): string => strictDecode(readFileSync(p));

const strictStdin = (): string => strictDecode(readFileSync(0));

// pathlib's ~ expansion: a leading ~ or ~/ names this user's home, ~user names
// theirs from the passwd table, and an unknown user stays unexpanded.
const expandUser = (p: string): string => {
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
const sortedJson = (v: unknown): string => {
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
const projectRoot = (raw: string): string => {
  let resolved: string;
  try {
    resolved = realpathSync(expandUser(raw));
  } catch {
    return fail(`no such project directory: ${raw}`);
  }
  if (!isDir(resolved)) fail(`no such project directory: ${raw}`);
  return resolved;
};

const settingsDir = (repo: string): string => {
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
const parseTomlStrict = (raw: string, label: string): unknown => {
  // BASE's tomllib refuses a byte-order mark; Bun's parser swallows it.
  if (raw.startsWith("\uFEFF")) fail(`${label} does not parse: unexpected byte-order mark`);
  try {
    return parseTomlText(raw);
  } catch (e) {
    return fail(`${label} does not parse: ${errText(e)}`);
  }
};

const parseSettings = (raw: string, label: string): Rec => {
  const candidate = asTable(parseTomlStrict(raw, label), label);
  scanMachineData(candidate, label, []);
  return candidate;
};

const readToml = (path: string, label: string): { data: Rec; present: boolean } => {
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
  return { data: parseSettings(raw, label), present: true };
};

const knownTurnpikes = (): Set<string> => {
  const r = run(join(HERE, "run"), ["turnpikes", "--list"], {
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

export const validateCommon = (data: Rec, label: string, local: boolean): Rec => {
  const allowed = local
    ? new Set(["project", "tracker", "roles"])
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
  const unknownTracker = Object.keys(tracker)
    .filter((k) => k !== "binding")
    .sort(cmpPoints);
  if (unknownTracker.length > 0) fail(`${label}.tracker has unsupported key: ${unknownTracker[0]}`);
  if (Object.hasOwn(tracker, "binding")) {
    const binding = nonblankString(tracker.binding, `${label}.tracker.binding`);
    // A name admits board-title punctuation; a path or URL does not pass. The value
    // scan above already refuses absolute, home, parent, Windows, UNC, file: and
    // env-var paths, so this refuses only what it misses: separators anywhere, a
    // URL scheme, and a leading ~ or $ expansion.
    if (
      binding.includes("/") ||
      binding.includes("\\") ||
      binding.includes("://") ||
      RX_SCHEME.test(binding) ||
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
  return data;
};

// --- profiles -----------------------------------------------------------------------------------
const loadProfiles = (
  repo: string,
): { shared: Rec; local: Rec; hasShared: boolean; hasLocal: boolean } => {
  const d = settingsDir(repo);
  const shared = readToml(join(d, "project.toml"), "shared project settings");
  const local = readToml(join(d, "settings.toml"), "local project settings");
  validateCommon(shared.data, "shared project settings", false);
  validateCommon(local.data, "local project settings", true);
  return {
    shared: shared.data,
    local: local.data,
    hasShared: shared.present,
    hasLocal: local.present,
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

export const effectiveConfig = (
  repo: string,
  machine: Rec,
  pair?: { shared: Rec; local: Rec },
): Rec => {
  const cfg = asTable(deepCopy(machine), "machine config");
  let shared: Rec;
  let local: Rec;
  let hs: boolean;
  let hl: boolean;
  if (pair === undefined) {
    ({ shared, local, hasShared: hs, hasLocal: hl } = loadProfiles(repo));
  } else {
    ({ shared, local } = pair);
    hs = Object.keys(shared).length > 0;
    hl = Object.keys(local).length > 0;
  }
  const profile = mergedProfile(shared, local, hs, hl);
  const roles = asTable(profile.roles, "roles");
  if (Object.keys(roles).length === 0) return cfg;
  const lanes = asTable(Object.hasOwn(cfg, "lanes") ? cfg.lanes : {}, "machine config [lanes]");
  if (!Object.hasOwn(cfg, "team")) cfg.team = {};
  const team = asTable(cfg.team, "machine config [team]");
  for (const key of ["workhorses", "reviewers"]) {
    if (Object.hasOwn(roles, key)) {
      const names = roles[key] as string[];
      const unknown = names.filter((n) => !Object.hasOwn(lanes, n));
      if (unknown.length > 0)
        fail(`local roles.${key} names ${unknown[0]}, which is not a machine lane`);
      team[key] = names;
    }
  }
  if (Object.hasOwn(roles, "coachman")) {
    const source = roles.coachman as string;
    const coachman = Object.hasOwn(team, source) ? team[source] : undefined;
    if (!isRec(coachman) || !pyTruthy(coachman.harness) || !pyTruthy(coachman.model)) {
      fail(`local roles.coachman selects ${source}, but the machine config does not define it`);
    }
    team.coachman = coachman;
  }
  if (Object.hasOwn(roles, "lens_reviewers")) {
    const own = asTable(
      Object.hasOwn(team, "lens_reviewers") ? team.lens_reviewers : {},
      "machine config [team.lens_reviewers]",
    );
    for (const [lens, lensNames] of Object.entries(roles.lens_reviewers as Rec)) {
      const names = lensNames as string[];
      const unknown = names.filter((n) => !Object.hasOwn(lanes, n));
      if (unknown.length > 0) {
        fail(`local roles.lens_reviewers.${lens} names ${unknown[0]}, which is not a machine lane`);
      }
      own[lens] = names;
    }
    team.lens_reviewers = own;
  }
  return cfg;
};

// --- commands -------------------------------------------------------------------------------------
export const inspect = (repo: string): Rec => {
  const { shared, local, hasShared, hasLocal } = loadProfiles(repo);
  const profile = mergedProfile(shared, local, hasShared, hasLocal);
  profile.shared_file = hasShared ? ".postmaster/project.toml" : null;
  profile.local_file = hasLocal ? ".postmaster/settings.toml" : null;
  return profile;
};

const report = (repo: string): void => {
  const p = inspect(repo);
  console.log(`project_shared=${p.shared_present === true ? "yes" : "no"}`);
  console.log(`project_local=${p.local_present === true ? "yes" : "no"}`);
  const sources = p.sources as Rec;
  for (const key of [
    "project.default_turnpikes",
    "tracker.binding",
    "project.risk_surfaces",
    "roles",
  ]) {
    console.log(`project_source.${key}=${String(sources[key])}`);
  }
  const project = p.project as Rec;
  if (Object.hasOwn(project, "default_turnpikes")) {
    console.log(`project_default_turnpikes=${(project.default_turnpikes as string[]).join(", ")}`);
  }
  const tracker = p.tracker as Rec;
  if (Object.hasOwn(tracker, "binding")) console.log(`tracker_binding=${String(tracker.binding)}`);
};

export const ensureIgnore = (repo: string, quiet = false): void => {
  const d = settingsDir(repo);
  mkdirSync(d, { recursive: true });
  const ignore = join(d, ".gitignore");
  if (isSymlink(ignore)) fail(`${ignore} must not be a symlink`);
  if (existsSync(ignore) && !isFile(ignore)) fail(`${ignore} is not a regular file`);
  const existing = existsSync(ignore) ? strictRead(ignore) : "";
  // A bare star anywhere is not enough: a later negation (!settings.toml) re-includes
  // what it ignored. The last effective rule decides, so it must be the star.
  const effective = pySplitLines(existing)
    .map((line) => pyTrim(line))
    .filter((line) => line !== "" && !line.startsWith("#"));
  if (effective.length === 0 || effective[effective.length - 1] !== "*") {
    let prefix = existing;
    if (prefix !== "" && !prefix.endsWith("\n")) prefix += "\n";
    if (prefix === "") {
      prefix =
        "# .postmaster/ holds this instance's settings and every run's full record.\n" +
        "# Nothing in it is committed by default. To share what a run requires of\n" +
        "# everyone, commit project.toml alone with: git add -f .postmaster/project.toml\n";
    }
    writeFileSync(ignore, `${prefix}*\n`);
  }
  if (!quiet) console.log(`project-settings: ensured ${ignore}`);
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
  scanMachineData(candidate, "settings input", []);
  validateCommon(candidate, "settings input", layer === "local");
  // Validate the complete resulting pair before changing either file.
  const { shared: oldShared, local: oldLocal } = loadProfiles(repo);
  const nextShared = layer === "project" ? candidate : oldShared;
  const nextLocal = layer === "local" ? candidate : oldLocal;
  validateCommon(nextShared, "shared project settings", false);
  validateCommon(nextLocal, "local project settings", true);
  const nextRoles = Object.hasOwn(nextLocal, "roles") ? nextLocal.roles : {};
  if (isRec(nextRoles) && Object.keys(nextRoles).length > 0) {
    const configPath = expandUser(
      process.env.POSTMASTER_CONFIG ?? join(homedir(), ".postmaster/config.toml"),
    );
    if (!isFile(configPath))
      fail(`local role assignments need the machine config at ${configPath}`);
    effectiveConfig(repo, loadMachine(configPath), { shared: nextShared, local: nextLocal });
  }
  mkdirSync(d, { recursive: true });
  ensureIgnore(repo, true);
  if (existsSync(dest) && !isFile(dest)) fail(`${dest} is not a regular file`);
  const tmpName = mkstempSync(d, `.${name}.`);
  try {
    const text = raw.endsWith("\n") ? raw : `${raw}\n`;
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
      // The rename already failed; a leftover temp file is not the error to report.
    }
    throw e;
  }
  console.log(`project-settings: wrote ${dest}`);
};

// --- entry ----------------------------------------------------------------------------------------
const main = (): void => {
  const argv = process.argv.slice(2);
  if (argv.length === 0) fail(USAGE);
  const cmd = argv[0]!;
  const rest = argv.slice(1);
  if (cmd === "ensure" && rest.length === 1) {
    ensureIgnore(projectRoot(rest[0]!));
  } else if ((cmd === "inspect" || cmd === "report") && rest.length === 1) {
    const repo = projectRoot(rest[0]!);
    if (cmd === "report") report(repo);
    else console.log(sortedJson(inspect(repo)));
  } else if (cmd === "effective" && (rest.length === 1 || rest.length === 2)) {
    const repo = projectRoot(rest[0]!);
    const configPath =
      rest.length === 2
        ? rest[1]!
        : (process.env.POSTMASTER_CONFIG ?? join(homedir(), ".postmaster/config.toml"));
    console.log(sortedJson(effectiveConfig(repo, loadMachine(configPath))));
  } else if (cmd === "write" && (rest.length === 2 || rest.length === 3)) {
    writeProfile(projectRoot(rest[0]!), rest[1]!, rest.length === 3 ? rest[2]! : "-");
  } else {
    fail(USAGE);
  }
};

if (import.meta.main) {
  try {
    main();
  } catch (e) {
    if (isDie(e)) {
      console.error(`project-settings: ${e.message}`);
      process.exit(1);
    }
    throw e;
  }
}
