// Normalize native bug-review reports and harvest Claude's forked task transcripts.
//
//   run review-findings normalize <lane> <scratch> <events> --run <dispatch> [--last <file>]
//   run review-findings harvest <events> <logs-dir> --prefix <name>
//
//   exit 0  printed
//   exit 1  usage; a report that cannot be read; a harvest that cannot be completed
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import {
  BOUND_L,
  BOUND_R,
  D_CLASS,
  DOT_ALL,
  digitValue,
  literalI,
  PY_DOT,
  PY_S_CLASS,
  pyLower,
  pySplitLines,
  pyTrim,
  pyWords,
} from "./lib/text.ts";

const USAGE =
  "usage: run review-findings normalize <lane> <scratch> <events> --run <dispatch> [--last <file>] | harvest <events> <logs-dir> --prefix <name>";

// --- failures ---------------------------------------------------------------------------
// BASE raises ReportError; a ported method that returns it cannot also fail loudly, so the
// failure is a thrown tagged Error instead of a class. The entry point catches the tag and
// prints it the way BASE does; anything else propagates the way BASE's tracebacks do.
interface ReportFailure {
  readonly tag: "ReportError";
  readonly message: string;
}

export function isReportError(e: unknown): e is ReportFailure {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { tag?: unknown }).tag === "ReportError" &&
    typeof (e as { message?: unknown }).message === "string"
  );
}

function fail(message: string): never {
  const e = new Error(message);
  (e as unknown as { tag: string }).tag = "ReportError";
  throw e;
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// --- small mirrors ----------------------------------------------------------------------
export const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const uid = (): number => process.getuid?.() ?? 0;

/** Python str() for %s slots: None/True/False spellings, nan/inf lowercased. */
function pyStr(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  if (typeof value === "string") return value;
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "nan";
    if (value === Infinity) return "inf";
    if (value === -Infinity) return "-inf";
    return String(value);
  }
  return String(value);
}

/** Python int(): truncation for numbers, True/False as 1/0, sign and single underscores
 * between Unicode decimal digits for strings. Throws where int() raises. */
function pyInt(value: unknown): number {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("not an integer");
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    let t = pyTrim(value);
    let neg = false;
    if (t.startsWith("+") || t.startsWith("-")) {
      neg = t.startsWith("-");
      t = t.slice(1);
    }
    const parts = t.split("_");
    for (const part of parts) if (part === "") throw new Error("not an integer");
    const digits = digitValue(parts.join(""));
    const n = Number((neg ? "-" : "") + digits);
    if (!Number.isFinite(n)) throw new Error("not an integer");
    return n;
  }
  throw new Error("not an integer");
}

function stripChars(s: string, chars: string): string {
  let a = 0;
  let b = s.length;
  while (a < b && chars.includes(s[a]!)) a++;
  while (b > a && chars.includes(s[b - 1]!)) b--;
  return s.slice(a, b);
}

function lstripChars(s: string, chars: string): string {
  let a = 0;
  while (a < s.length && chars.includes(s[a]!)) a++;
  return s.slice(a);
}

function rstripChars(s: string, chars: string): string {
  let b = s.length;
  while (b > 0 && chars.includes(s[b - 1]!)) b--;
  return s.slice(0, b);
}

/** Path.resolve(strict=False): symlinks resolved through the longest existing prefix, the
 * missing tail joined lexically. Only a missing path falls back to a shorter prefix; any
 * other failure propagates, as BASE's OSError does. */
function pyResolve(p: string): string {
  const abs = resolve(p);
  const parts = abs.split("/");
  for (let i = parts.length; i >= 1; i--) {
    const prefix = parts.slice(0, i).join("/") || "/";
    try {
      const real = realpathSync(prefix);
      return i === parts.length ? real : join(real, ...parts.slice(i));
    } catch (e) {
      const code = (e as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT" || code === "ENOTDIR") continue;
      throw e;
    }
  }
  return abs;
}

const decodeUtf8 = (buf: Buffer): string => new TextDecoder("utf-8", { fatal: true }).decode(buf);

/** BASE's event.get(), which raises AttributeError on a non-dict event instead of skipping
 * it: a stray scalar line fails the run, never harvests clean. The throw is untagged, so it
 * escapes the entry point the way BASE's traceback does. */
function eventField(event: unknown, key: string): unknown {
  if (!isObj(event)) throw new Error(`review event has no ${key}`);
  return event[key];
}

const firstTruthy = (o: Record<string, unknown>, keys: string[]): unknown => {
  for (const k of keys) {
    const v = o[k];
    if (v) return v;
  }
  return null;
};

const firstPresent = (o: Record<string, unknown>, keys: string[]): unknown => {
  for (const k of keys) {
    const v = o[k];
    if (v !== undefined && v !== null) return v;
  }
  return null;
};

// --- patterns ---------------------------------------------------------------------------
const LOCATION_SRC =
  "(?<path>(?:[A-Za-z]:)?[^" +
  PY_S_CLASS +
  "`*<>]+):(?<line>[" +
  D_CLASS +
  "]+)(?:-(?<end>[" +
  D_CLASS +
  "]+))?";
const LOCATION = new RegExp(LOCATION_SRC, "u");
const LOCATION_G = new RegExp(LOCATION_SRC, "gu");
const HASHLOC_G = new RegExp(
  "(?<path>(?:[A-Za-z]:)?[^" + PY_S_CLASS + "`*<>]+?)#L(?<line>[" + D_CLASS + "]+)",
  "gu",
);
const ATLINE_G = new RegExp(
  "(?<path>[A-Za-z][^" +
    PY_S_CLASS +
    "`*<>:,;()]*?)[" +
    PY_S_CLASS +
    "]+" +
    BOUND_L +
    literalI("at line") +
    "[" +
    PY_S_CLASS +
    "]+(?<line>[" +
    D_CLASS +
    "]+)",
  "giu",
);
const PRIORITY_TAG = /\[P[123]\]/u;
const FINDING_WORDS = new RegExp(
  BOUND_L +
    "(?:" +
    literalI("bug") +
    "s?|" +
    literalI("buggy") +
    "|" +
    literalI("finding") +
    "s?|" +
    literalI("issue") +
    "s?|" +
    literalI("defect") +
    "s?)" +
    BOUND_R,
  "iu",
);
const HAS_LETTER = /[A-Za-z]/u;
const EMBEDDED = new RegExp(
  "^(" + PY_DOT + "*?):([" + D_CLASS + "]+)(?:-([" + D_CLASS + "]+))?$",
  "u",
);
const FENCE_OPEN = new RegExp("^```(?:json)?[" + PY_S_CLASS + "]*$", "iu");
const CODEX_LINE = new RegExp(
  "^[" +
    PY_S_CLASS +
    "]*[-*][" +
    PY_S_CLASS +
    "]*\\[(P[123])\\][" +
    PY_S_CLASS +
    "]*(" +
    PY_DOT +
    "+?)[" +
    PY_S_CLASS +
    "]+[—–][" +
    PY_S_CLASS +
    "]+(" +
    PY_DOT +
    "+):([" +
    D_CLASS +
    "]+)(?:-([" +
    D_CLASS +
    "]+))?[" +
    PY_S_CLASS +
    "]*$",
  "u",
);
const PREFIX_SANITIZE = /[^A-Za-z0-9_.-]+/gu;
const LEAD_HASH = /^#+/u;
const JSON_NUM = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/uy;
const HEX4 = /^[0-9a-fA-F]{4}$/u;

// --- JSON with an end index ---------------------------------------------------------------
// json.JSONDecoder.raw_decode, which the scans below need: the value starting exactly at
// the bracket, and the index just past it. NaN/Infinity are values, as BASE's decoder has
// them; a raw control character or a bad escape fails, as its strict mode does.
function rawDecodeJson(text: string, start: number): { value: unknown; end: number } {
  let i = start;
  const failJson = (): never => {
    throw new Error(`invalid JSON at offset ${i}`);
  };
  const skipWs = (): void => {
    while (i < text.length) {
      const c = text[i]!;
      if (c === " " || c === "\t" || c === "\n" || c === "\r") i++;
      else break;
    }
  };
  const parseString = (): string => {
    i++;
    let out = "";
    for (;;) {
      if (i >= text.length) failJson();
      const c = text[i]!;
      if (c === '"') {
        i++;
        return out;
      }
      if (c === "\\") {
        const e = text[i + 1];
        if (e === '"' || e === "\\" || e === "/") {
          out += e;
          i += 2;
        } else if (e === "b") {
          out += "\b";
          i += 2;
        } else if (e === "f") {
          out += "\f";
          i += 2;
        } else if (e === "n") {
          out += "\n";
          i += 2;
        } else if (e === "r") {
          out += "\r";
          i += 2;
        } else if (e === "t") {
          out += "\t";
          i += 2;
        } else if (e === "u") {
          const hex = text.slice(i + 2, i + 6);
          if (!HEX4.test(hex)) failJson();
          let cp = Number.parseInt(hex, 16);
          i += 6;
          if (cp >= 0xd800 && cp <= 0xdbff && text[i] === "\\" && text[i + 1] === "u") {
            const lo = text.slice(i + 2, i + 6);
            if (HEX4.test(lo)) {
              const locp = Number.parseInt(lo, 16);
              if (locp >= 0xdc00 && locp <= 0xdfff) {
                cp = 0x10000 + ((cp - 0xd800) << 10) + (locp - 0xdc00);
                i += 6;
              }
            }
          }
          out += String.fromCodePoint(cp);
        } else {
          failJson();
        }
      } else {
        if (c < " ") failJson();
        out += c;
        i++;
      }
    }
  };
  const parseValue = (): unknown => {
    if (i >= text.length) failJson();
    const c = text[i]!;
    if (c === '"') return parseString();
    if (c === "{") return parseObject();
    if (c === "[") return parseArray();
    if (c === "t" && text.startsWith("true", i)) {
      i += 4;
      return true;
    }
    if (c === "f" && text.startsWith("false", i)) {
      i += 5;
      return false;
    }
    if (c === "n" && text.startsWith("null", i)) {
      i += 4;
      return null;
    }
    if (c === "N" && text.startsWith("NaN", i)) {
      i += 3;
      return NaN;
    }
    if (c === "I" && text.startsWith("Infinity", i)) {
      i += 8;
      return Infinity;
    }
    if (c === "-" && text.startsWith("-Infinity", i)) {
      i += 9;
      return -Infinity;
    }
    JSON_NUM.lastIndex = i;
    const m = JSON_NUM.exec(text);
    if (m && m.index === i) {
      i += m[0].length;
      return Number(m[0]);
    }
    return failJson();
  };
  const parseArray = (): unknown[] => {
    i++;
    const out: unknown[] = [];
    skipWs();
    if (text[i] === "]") {
      i++;
      return out;
    }
    for (;;) {
      out.push(parseValue());
      skipWs();
      if (text[i] === ",") {
        i++;
        skipWs();
      } else if (text[i] === "]") {
        i++;
        return out;
      } else {
        return failJson();
      }
    }
  };
  const parseObject = (): Record<string, unknown> => {
    i++;
    const out: Record<string, unknown> = {};
    skipWs();
    if (text[i] === "}") {
      i++;
      return out;
    }
    for (;;) {
      if (text[i] !== '"') failJson();
      const key = parseString();
      skipWs();
      if (text[i] !== ":") failJson();
      i++;
      skipWs();
      const value = parseValue();
      // An own __proto__ key, as JSON.parse keeps one: a plain assignment would move the
      // prototype instead.
      if (key === "__proto__") {
        Object.defineProperty(out, key, {
          value,
          enumerable: true,
          writable: true,
          configurable: true,
        });
      } else {
        out[key] = value;
      }
      skipWs();
      if (text[i] === ",") {
        i++;
        skipWs();
      } else if (text[i] === "}") {
        i++;
        return out;
      } else {
        return failJson();
      }
    }
  };
  const value = parseValue();
  return { value, end: i };
}

/** Python == over decoded JSON: True is 1, dict order never matters, NaN is never equal. */
function pyDeepEqual(a: unknown, b: unknown): boolean {
  if (typeof a === "number" || typeof a === "boolean") {
    if (typeof b !== "number" && typeof b !== "boolean") return false;
    return Number(a) === Number(b);
  }
  if (typeof b === "number" || typeof b === "boolean") return false;
  if (typeof a === "string" || typeof b === "string") return a === b;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, n) => pyDeepEqual(v, b[n]));
  }
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => Object.hasOwn(b, k) && pyDeepEqual(a[k], b[k]));
  }
  return a === b;
}

interface JsonSpan {
  value: unknown;
  start: number;
  end: number;
}

/** Every JSON list in the text with its character span; undecodable brackets skipped. */
function scanSpans(ntext: string): JsonSpan[] {
  const found: JsonSpan[] = [];
  for (let i = 0; i < ntext.length; i++) {
    if (ntext[i] !== "[") continue;
    try {
      const { value, end } = rawDecodeJson(ntext, i);
      if (Array.isArray(value)) found.push({ value, start: i, end });
    } catch {
      // undecodable brackets skipped
    }
  }
  return found;
}

/** The text with the picked list's first literal removed. A twin literal stays outside,
// where the second-list check finds it. */
function exciseFirst(ntext: string, picked: unknown): string {
  for (const span of scanSpans(ntext)) {
    if (pyDeepEqual(span.value, picked)) return ntext.slice(0, span.start) + ntext.slice(span.end);
  }
  fail("cannot parse review output from claude"); // unreachable: the literal parsed from this text
}

/** The one normalization for clean-matching and JSON parsing: a fence wrapping the whole
 * report, meaning its first and last lines, comes off, and edges are stripped. */
function normalizeText(text: string): string {
  const lines = pySplitLines(pyTrim(text));
  if (
    lines.length >= 2 &&
    FENCE_OPEN.test(pyTrim(lines[0]!)) &&
    pyTrim(lines[lines.length - 1]!) === "```"
  ) {
    return pyTrim(lines.slice(1, -1).join("\n"));
  }
  return pyTrim(text);
}

// The exact clean forms: the whole report, normalized, is a bare verdict, an empty JSON
// list, or {"findings": []} with no other key.
const CLEAN_VERDICTS = new Set([
  "no findings",
  "no findings.",
  "no findings found",
  "no findings found.",
  "no bugs found",
  "no bugs found.",
  "no issues found",
  "no issues found.",
  "no actionable findings",
  "no actionable findings.",
  "none",
  "none.",
]);
const DECLARED_KEYS = ["findings", "review_findings", "issues"];
const FILE_KEYS = ["file", "path", "file_path", "filePath", "filename"];
const LINE_KEYS = ["line", "line_number", "lineNumber", "start", "start_line", "startLine"];
const NO_OTHER_PHRASES = new Set([
  "no other findings found",
  "no other bugs found",
  "no other issues found",
  "no additional findings found",
  "no additional bugs found",
  "no additional issues found",
]);
// Headings whose sections hold non-findings, exactly as the recorded reports use them:
// mimo's "Not issues". Anything unrecorded still parses, loudly, not guessed at.
const SKIP_SECTIONS = ["not issues"];

/** The one findings list among candidates: non-empty and holding an object. Scalar or
 * empty lists say nothing; two findings lists fail loudly rather than guessing. */
function pickFindings(found: unknown[][]): unknown[] | null {
  const candidates = found.filter((v) => v.length > 0 && v.some((item) => isObj(item)));
  if (candidates.length > 1) {
    fail(
      `review output holds ${candidates.length} JSON finding lists; refusing to guess which holds the findings`,
    );
  }
  return candidates.length > 0 ? candidates[0]! : null;
}

/** (items, outside) for a claude report: the one JSON findings list and the text around
 * it. None when the text holds no JSON findings structure at all, so the markdown
 * fallback tries; anything else parses or fails loudly here. */
function claudeJson(ntext: string): [unknown[], string] | null {
  let whole: unknown;
  try {
    whole = JSON.parse(ntext);
  } catch {
    whole = undefined;
  }
  if (Array.isArray(whole)) return [whole as unknown[], ""];
  if (isObj(whole)) {
    const keyed: unknown[][] = [];
    for (const key of DECLARED_KEYS) {
      const v = whole[key];
      if (Array.isArray(v)) keyed.push(v as unknown[]);
    }
    if (keyed.length > 0) {
      // Declared keys are held strictly before anything is picked: a non-empty list with
      // no objects is a malformed report even beside a valid list, which must not
      // silently win over the malformed one.
      for (const found of keyed) {
        if (found.length > 0 && !found.some((item) => isObj(item))) {
          fail("review output's findings lists hold no objects; refusing to read as clean");
        }
      }
      const picked = pickFindings(keyed);
      if (picked !== null) return [picked, exciseFirst(ntext, picked)];
    }
    const objectLists = scanSpans(ntext)
      .map((s) => s.value as unknown[])
      .filter((v) => Array.isArray(v) && v.length > 0 && v.some((item) => isObj(item)));
    const picked = pickFindings(objectLists);
    if (picked === null) fail("cannot parse review output from claude");
    return [picked, exciseFirst(ntext, picked)];
  }
  const objectLists = scanSpans(ntext)
    .map((s) => s.value as unknown[])
    .filter((v) => Array.isArray(v) && v.length > 0 && v.some((item) => isObj(item)));
  const picked = pickFindings(objectLists);
  if (picked === null) return null;
  return [picked, exciseFirst(ntext, picked)];
}

/** The report normalized is exactly a clean form and nothing else. */
function isCleanForm(ntext: string): boolean {
  if (CLEAN_VERDICTS.has(pyWords(pyLower(ntext)).join(" "))) return true;
  try {
    const parsed: unknown = JSON.parse(ntext);
    return pyDeepEqual(parsed, []) || pyDeepEqual(parsed, { findings: [] });
  } catch {
    return false;
  }
}

/** Every JSON value the report decodes to: the whole text, then each bracket-led
 * fragment. Undecodable brackets are skipped. */
function decodedJsonValues(text: string): unknown[] {
  const values: unknown[] = [];
  try {
    values.push(JSON.parse(pyTrim(text)) as unknown);
  } catch {
    // the whole text is not JSON; fragments still try
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c !== "[" && c !== "{") continue;
    try {
      values.push(rawDecodeJson(text, i).value);
    } catch {
      // undecodable brackets are skipped
    }
  }
  return values;
}

/** Decoded string values, and (file, line-or-None) for objects naming a file, under a
 * JSON value. Keys are not values: a citation smuggled into a key stays visible to the
 * raw-text scan instead. */
function walkJson(value: unknown, strings: string[], cited: Array<[unknown, unknown]>): void {
  if (typeof value === "string") {
    strings.push(value);
  } else if (isObj(value)) {
    const fileValue = firstTruthy(value, FILE_KEYS);
    if (fileValue !== null) cited.push([fileValue, firstPresent(value, LINE_KEYS)]);
    for (const v of Object.values(value)) walkJson(v, strings, cited);
  } else if (Array.isArray(value)) {
    for (const v of value) walkJson(v, strings, cited);
  }
}

interface Cite {
  path: string;
  line: number;
  shown: string;
}

/** (path, line, shown) for every location a string names: path:line with a letter in it,
 * path#L<n>, and at line <n> against a path-like name on the same line. */
function scanLocations(s: string): Cite[] {
  const out: Cite[] = [];
  for (const m of s.matchAll(LOCATION_G)) {
    const path = m.groups!.path!;
    if (HAS_LETTER.test(path)) {
      out.push({ path, line: pyInt(m.groups!.line!), shown: `${path}:${m.groups!.line!}` });
    }
  }
  for (const m of s.matchAll(HASHLOC_G)) {
    const path = m.groups!.path!;
    out.push({ path, line: pyInt(m.groups!.line!), shown: `${path}#L${m.groups!.line!}` });
  }
  for (const m of s.matchAll(ATLINE_G)) {
    const path = m.groups!.path!;
    if (path.includes("/") || path.includes(".")) {
      out.push({ path, line: pyInt(m.groups!.line!), shown: `${path} at line ${m.groups!.line!}` });
    }
  }
  return out;
}

/** A line the markdown parser would file: a heading, item or em-dash line citing a
 * path:line with a letter in it. */
function isFindingFormLine(line: string): boolean {
  if (
    !(
      line.startsWith("#") ||
      line.startsWith("-") ||
      line.startsWith("*") ||
      line.startsWith("`") ||
      line.includes(" — ") ||
      line.includes(" – ")
    )
  ) {
    return false;
  }
  const m = LOCATION.exec(line);
  return m !== null && HAS_LETTER.test(m.groups!.path!);
}

/** A line that is exactly a no-other-issues phrase, heading markers and end punctuation
 * aside. Anything longer — a citation beside the phrase — is not skipped. */
function isExactNoOther(line: string): boolean {
  return NO_OTHER_PHRASES.has(
    pyLower(pyTrim(rstripChars(pyTrim(lstripChars(pyTrim(line), "#")), ".:"))),
  );
}

function matchOrLoud(
  path: unknown,
  number: unknown,
  shown: string,
  targets: Set<string>,
  scratch: string,
): void {
  let file = "";
  let line = 0;
  try {
    const r = normalizeLocation(path, number, null, scratch);
    file = r[0];
    line = r[1];
  } catch (e) {
    if (isReportError(e)) fail(`review output cites ${shown} outside its filed findings`);
    throw e;
  }
  if (!targets.has(`${file}\0${line}`)) {
    fail(`review output cites ${shown} outside its filed findings`);
  }
}

/** Nothing outside the one recognised structure may look like a finding: no second list,
 * no finding-form line, no priority tag; a prose location must name a filed finding's
 * file and line, nothing more. */
function checkOutside(outside: string, filed: Finding[], scratch: string): void {
  const targets = new Set(filed.map((f) => `${f.file}\0${f.line}`));
  for (const span of scanSpans(outside)) {
    const v = span.value;
    if (Array.isArray(v) && v.length > 0 && v.some((item) => isObj(item))) {
      fail("review output holds a second findings list outside its filed findings");
    }
  }
  for (const line of pySplitLines(outside)) {
    if (isFindingFormLine(pyTrim(line))) {
      fail("review output holds a markdown finding outside its filed findings");
    }
  }
  if (PRIORITY_TAG.test(outside)) {
    fail("review output holds a priority tag outside its filed findings");
  }
  for (const c of scanLocations(outside)) matchOrLoud(c.path, c.line, c.shown, targets, scratch);
  const strings: string[] = [];
  const cited: Array<[unknown, unknown]> = [];
  for (const value of decodedJsonValues(outside)) walkJson(value, strings, cited);
  for (const item of strings) {
    for (const c of scanLocations(item)) matchOrLoud(c.path, c.line, c.shown, targets, scratch);
  }
  for (const [fileValue, lineValue] of cited) {
    if (lineValue === null || lineValue === undefined) {
      fail(`review output names file ${pyStr(fileValue)} outside its filed findings`);
    }
    matchOrLoud(fileValue, lineValue, `${pyStr(fileValue)}:${pyStr(lineValue)}`, targets, scratch);
  }
}

/** No finding words beside an empty declared list: a report claiming no findings in one
 * key while describing bugs in another fails loudly. */
function checkFindingWords(ntext: string): void {
  for (const value of decodedJsonValues(ntext)) {
    if (
      isObj(value) &&
      DECLARED_KEYS.some(
        (key) => Array.isArray(value[key]) && (value[key] as unknown[]).length === 0,
      )
    ) {
      for (const item of Object.values(value)) {
        if (typeof item === "string" && FINDING_WORDS.test(item)) {
          fail("review output describes findings beside its empty findings list");
        }
      }
    }
  }
}

// --- findings ---------------------------------------------------------------------------
interface Finding {
  file: string;
  line: number;
  line_end: number | string;
  target: string;
  severity: string;
  summary: string;
  body: string;
  evidence: string;
  confidence: string;
  category: string;
  source: string;
}

/** json.dumps with sort_keys and ensure_ascii=False: sorted keys, ", "/"": " separators,
 * NaN/Infinity spelled the way allow_nan does. */
function sortedJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (value === true) return "true";
  if (value === false) return "false";
  if (typeof value === "string") return JSON.stringify(value) as string;
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "NaN";
    if (value === Infinity) return "Infinity";
    if (value === -Infinity) return "-Infinity";
    return JSON.stringify(value) as string;
  }
  if (Array.isArray(value)) return `[${value.map((v) => sortedJson(v)).join(", ")}]`;
  if (isObj(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}: ${sortedJson(value[k])}`).join(", ")}}`;
  }
  return "null";
}

function valueOrMissing(value: unknown): string {
  if (value === null || value === undefined) return "not provided";
  if (Array.isArray(value) || isObj(value)) return sortedJson(value);
  const text = pyTrim(pyStr(value));
  return text === "" ? "not provided" : text;
}

function normalizeLocation(
  pathValue: unknown,
  lineValue: unknown,
  endValue: unknown,
  scratch: string,
): [string, number, number | string] {
  const trimmed = stripChars(pyTrim(pyStr(pathValue)), "`'\"()[]");
  let p = trimmed;
  let lv: unknown = lineValue;
  let ev: unknown = endValue;
  const m = EMBEDDED.exec(p);
  if (m) {
    p = m[1]!;
    if (lv === undefined || lv === null) lv = m[2]!;
    if (ev === undefined || ev === null) ev = m[3] ?? null;
  }
  let line: number;
  try {
    line = pyInt(lv);
  } catch {
    fail(`finding has no numeric line: ${p}`);
  }
  if (line < 1) fail(`finding has an invalid line: ${line}`);
  let rel: string;
  try {
    const root = pyResolve(scratch);
    const abs = isAbsolute(p) ? pyResolve(p) : pyResolve(join(root, p));
    rel = relative(root, abs);
    if (rel === "") rel = ".";
    if (rel === ".." || rel.startsWith("../") || isAbsolute(rel)) throw new Error("outside");
  } catch (e) {
    if (isReportError(e)) throw e;
    fail(`finding path is outside its review scratch: ${p}`);
  }
  if (rel === "" || rel === "." || rel.startsWith("../")) {
    fail(`finding path is not a file in its review scratch: ${p}`);
  }
  let lineEnd: number | string;
  if (ev === undefined || ev === null) {
    lineEnd = "not provided";
  } else {
    try {
      lineEnd = pyInt(ev);
    } catch {
      fail(`finding has an invalid end line: ${pyStr(ev)}`);
    }
  }
  if (typeof lineEnd === "number" && lineEnd < line) {
    fail("finding end line precedes its start line");
  }
  return [rel, line, lineEnd];
}

function normalizeItem(item: unknown, harness: string, scratch: string): Finding {
  if (!isObj(item)) fail("finding is not an object");
  const path = firstTruthy(item, ["file", "path", "file_path", "filePath", "filename"]);
  const line = firstPresent(item, [
    "line",
    "line_number",
    "lineNumber",
    "start",
    "start_line",
    "startLine",
  ]);
  const end = firstPresent(item, ["end", "end_line", "line_end", "endLine"]);
  if (path === null) fail("finding has no file");
  const [file, number, lineEnd] = normalizeLocation(path, line, end, scratch);
  let severity: unknown = "severity" in item ? item["severity"] : item["priority"];
  if (
    (typeof severity === "number" &&
      Number.isInteger(severity) &&
      (severity === 1 || severity === 2 || severity === 3)) ||
    severity === true
  ) {
    severity = `P${Number(severity)}`;
  }
  const summary = firstTruthy(item, [
    "summary",
    "short_summary",
    "title",
    "description",
    "message",
    "failure_scenario",
  ]);
  const evidence = firstTruthy(item, ["evidence", "quoted_code", "code", "snippet"]);
  const body = item["body"] || item["failure_scenario"];
  return {
    file,
    line: number,
    line_end: lineEnd,
    target: `${file}:${number}`,
    severity: valueOrMissing(severity),
    summary: valueOrMissing(summary),
    body: valueOrMissing(body),
    evidence: valueOrMissing(evidence),
    confidence: valueOrMissing(item["confidence"]),
    category: valueOrMissing(item["category"]),
    source: harness,
  };
}

/** The body and evidence after a finding's line: following prose until a blank line, the
 * next heading or item; a fenced block is the finding's evidence, not its end. Also the
 * first line past the block, so the outside check knows what the finding consumed. */
function findingBody(lines: string[], index: number): [string | null, string | null, number] {
  const body: string[] = [];
  let evidence: string | null = null;
  let following = index + 1;
  const total = lines.length;
  while (following < total) {
    const textLine = pyTrim(lines[following]!);
    if (textLine === "") {
      if (body.length > 0) break;
      following++;
      continue;
    }
    if (
      textLine.startsWith("#") ||
      textLine.startsWith("- ") ||
      textLine.startsWith("* ") ||
      textLine.startsWith("Review comment:")
    ) {
      break;
    }
    if (textLine.startsWith("```")) {
      following++;
      const fence: string[] = [];
      while (following < total && !pyTrim(lines[following]!).startsWith("```")) {
        fence.push(rstripChars(lines[following]!, "\n"));
        following++;
      }
      following++;
      if (evidence === null) {
        const joined = pyTrim(fence.join("\n"));
        evidence = joined === "" ? null : joined;
      }
      continue;
    }
    body.push(textLine);
    following++;
  }
  return [body.length > 0 ? body.join("\n") : null, evidence, following];
}

function checkFencesClosed(lines: string[]): void {
  const depth = lines.filter((raw) => pyTrim(raw).startsWith("```")).length;
  if (depth % 2 === 1) fail("review output has an unclosed code fence");
}

/** A path:line citation: the path must hold a letter, so Makefile:8 counts and 12:30
 * does not. */
function citesLocation(line: string): boolean {
  const m = LOCATION.exec(line);
  return m !== null && HAS_LETTER.test(m.groups!.path!);
}

/** Blank citations and fenced lines under recorded not-issues headings, keeping line
 * numbers and prose, so their citations neither parse as findings nor trip the outside
 * check. */
function descopeNotIssues(text: string): string {
  const out: string[] = [];
  let inFence = false;
  let skip = false;
  let skipLevel = 0;
  for (const raw of pySplitLines(text)) {
    const stripped = pyTrim(raw);
    if (stripped.startsWith("```")) {
      inFence = !inFence;
      out.push(skip ? "" : raw);
      continue;
    }
    if (!inFence && stripped.startsWith("#")) {
      const hashes = LEAD_HASH.exec(stripped)![0].length;
      if (SKIP_SECTIONS.includes(rstripChars(pyLower(pyTrim(lstripChars(stripped, "#"))), ":"))) {
        skip = true;
        skipLevel = hashes;
      } else if (skip && hashes <= skipLevel) {
        skip = false;
      }
    }
    if (skip && (inFence || citesLocation(stripped))) out.push("");
    else out.push(raw);
  }
  return out.join("\n");
}

/** Findings plus the text outside them: every line no finding block consumed and no fence
 * quotes, for the outside check. */
function markdownFindingsSpans(
  text: string,
  harness: string,
  scratch: string,
): [Finding[], string] {
  const findings: Finding[] = [];
  const consumed = new Set<number>();
  const fenced = new Set<number>();
  let inFence = false;
  const lines = pySplitLines(text);
  for (let index = 0; index < lines.length; index++) {
    const line = pyTrim(lines[index]!);
    if (line.startsWith("```")) {
      inFence = !inFence;
      fenced.add(index);
      continue;
    }
    if (inFence) {
      fenced.add(index);
      continue;
    }
    if (isExactNoOther(line)) continue;
    if (!isFindingFormLine(line)) continue;
    const m = LOCATION.exec(line)!;
    let prefix = stripChars(line.slice(0, m.index), "#*-` :—–");
    const suffix = stripChars(line.slice(m.index + m[0].length), "` :—–-");
    if (pyLower(prefix) === "bug") prefix = "";
    const title = pyTrim([prefix, suffix].filter((part) => part !== "").join(" "));
    const [body, evidence, end] = findingBody(lines, index);
    try {
      findings.push(
        normalizeItem(
          {
            file: m.groups!.path!,
            line: m.groups!.line!,
            end_line: m.groups!.end ?? null,
            summary: title,
            body,
            evidence,
          },
          harness,
          scratch,
        ),
      );
    } catch (e) {
      if (isReportError(e)) fail(`report line ${index + 1}: ${e.message}`);
      throw e;
    }
    for (let n = index; n < end; n++) consumed.add(n);
  }
  const rest: string[] = [];
  for (let n = 0; n < lines.length; n++) {
    if (!consumed.has(n) && !fenced.has(n)) rest.push(lines[n]!);
  }
  return [findings, rest.join("\n")];
}

/** Findings plus the text outside them, as markdownFindingsSpans. */
function codexFindingsSpans(text: string, scratch: string): [Finding[], string] {
  const findings: Finding[] = [];
  const consumed = new Set<number>();
  const fenced = new Set<number>();
  let inFence = false;
  const lines = pySplitLines(text);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const stripped = pyTrim(line);
    if (stripped.startsWith("```")) {
      inFence = !inFence;
      fenced.add(index);
      continue;
    }
    if (inFence) {
      fenced.add(index);
      continue;
    }
    const m = CODEX_LINE.exec(line);
    if (m) {
      const severity = m[1]!;
      const title = m[2]!;
      const path = m[3]!;
      const start = m[4]!;
      const end = m[5] ?? null;
      const [body, evidence, blockEnd] = findingBody(lines, index);
      try {
        findings.push(
          normalizeItem(
            {
              file: path,
              line: start,
              end_line: end,
              severity,
              title,
              body,
              evidence,
            },
            "codex",
            scratch,
          ),
        );
      } catch (e) {
        if (isReportError(e)) fail(`report line ${index + 1}: ${e.message}`);
        throw e;
      }
      for (let n = index; n < blockEnd; n++) consumed.add(n);
    }
  }
  const rest: string[] = [];
  for (let n = 0; n < lines.length; n++) {
    if (!consumed.has(n) && !fenced.has(n)) rest.push(lines[n]!);
  }
  return [findings, rest.join("\n")];
}

function parseReport(harness: string, text: string, scratch: string): Finding[] {
  if (pyTrim(text) === "") fail("review output is empty");
  const ntext = normalizeText(text);
  if (isCleanForm(ntext)) return [];
  if (harness === "claude") {
    const found = claudeJson(ntext);
    if (found !== null) {
      const [items, outside] = found;
      const normalized: Finding[] = [];
      items.forEach((item, position) => {
        try {
          normalized.push(normalizeItem(item, harness, scratch));
        } catch (e) {
          if (isReportError(e)) fail(`finding ${position}: ${e.message}`);
          throw e;
        }
      });
      checkFindingWords(ntext);
      checkOutside(outside, normalized, scratch);
      return uniqueFindings(normalized);
    }
  }
  checkFencesClosed(pySplitLines(text));
  const scoped = descopeNotIssues(text);
  if (harness === "codex") {
    const [findings, outside] = codexFindingsSpans(scoped, scratch);
    if (findings.length > 0) {
      checkOutside(outside, findings, scratch);
      return uniqueFindings(findings);
    }
  }
  const [findings, outside] = markdownFindingsSpans(scoped, harness, scratch);
  if (findings.length > 0) {
    checkOutside(outside, findings, scratch);
    return uniqueFindings(findings);
  }
  fail(`cannot parse review output from ${harness}`);
}

function uniqueFindings(findings: Finding[]): Finding[] {
  const unique: Finding[] = [];
  const seen = new Map<string, number>();
  for (const finding of findings) {
    const key = JSON.stringify([
      finding.file,
      finding.line,
      finding.line_end,
      finding.severity,
      finding.summary,
    ]);
    const at = seen.get(key);
    if (at === undefined) {
      seen.set(key, unique.length);
      unique.push(finding);
    } else {
      const prev = unique[at]!;
      for (const f of Object.keys(finding) as (keyof Finding)[]) {
        if (prev[f] === "not provided" && finding[f] !== "not provided") {
          (prev as unknown as Record<string, unknown>)[f] = finding[f];
        }
      }
    }
  }
  return unique;
}

// --- streams ----------------------------------------------------------------------------
function readEvents(path: string): unknown[] {
  let buf: Buffer;
  try {
    buf = readFileSync(path);
  } catch (e) {
    fail(`cannot read ${path}: ${errMsg(e)}`);
  }
  // A stream of JSON lines splits on the newline character alone. Splitting
  // lines also breaks inside JSON strings on U+2028, U+2029, CR, VT and FF,
  // which refuses a valid stream; the report-text readers below keep it.
  const lines = decodeUtf8(buf).split("\n");
  const events: unknown[] = [];
  lines.forEach((line, n) => {
    if (pyTrim(line) === "") return;
    try {
      events.push(JSON.parse(line) as unknown);
    } catch (e) {
      fail(`${path} line ${n + 1} is not JSON: ${errMsg(e)}`);
    }
  });
  return events;
}

function finalReport(harness: string, eventsPath: string, lastPath: string | null): string {
  const events = readEvents(eventsPath);
  if (harness === "claude") {
    const results: Record<string, unknown>[] = [];
    for (const event of events) {
      if (eventField(event, "type") === "result") results.push(event as Record<string, unknown>);
    }
    if (results.length === 0) fail("Claude stream has no final result text");
    // The last result rules, whatever shape it is: a run that ended in error, or ended
    // without text, is a failed reviewer, never a clean review.
    const last = results[results.length - 1]!;
    if (last["subtype"] !== "success") {
      fail(`claude review run did not succeed (subtype: ${last["subtype"] || "missing"})`);
    }
    if (typeof last["result"] !== "string") {
      fail("claude review run ended with no result text");
    }
    return last["result"];
  }
  if (harness === "mimo") {
    const reports: string[] = [];
    for (const event of events) {
      if (eventField(event, "type") !== "text") continue;
      const partRaw = eventField(event, "part");
      const part = partRaw ? partRaw : {};
      if (!isObj(part)) throw new Error("review event part is not an object");
      if (typeof part["text"] === "string") reports.push(part["text"]);
    }
    if (reports.length === 0) fail("MiMo Code stream has no final text event");
    return reports[reports.length - 1]!;
  }
  if (harness === "codex") {
    if (!lastPath) fail("Codex review normalization needs the --last output file");
    // The --last file is trusted only when the review's turn completed: codex writes -o
    // only on success, so a failed turn's file is an earlier attempt's.
    if (events.some((event) => eventField(event, "type") === "turn.failed")) {
      fail("codex review turn failed; refusing its --last output as stale");
    }
    if (!events.some((event) => eventField(event, "type") === "turn.completed")) {
      fail("codex stream shows no completed turn; refusing its --last output as stale");
    }
    let buf: Buffer;
    try {
      buf = readFileSync(lastPath);
    } catch (e) {
      fail(`cannot read Codex --last output ${lastPath}: ${errMsg(e)}`);
    }
    return decodeUtf8(buf);
  }
  fail(`${harness} has no code-review form`);
}

export const SUPPORTED = new Set(["claude", "codex", "mimo"]);

function normalizeCli(
  lane: string,
  scratch: string,
  eventsPath: string,
  runDir: string,
  lastPath: string | null,
): Finding[] {
  const at = (v: unknown): Record<string, unknown> => {
    if (!isObj(v)) throw new TypeError("not an object");
    return v;
  };
  let harness: unknown;
  try {
    const run = JSON.parse(decodeUtf8(readFileSync(join(runDir, "run.json")))) as unknown;
    harness = at(at(at(at(run)["config"])["lanes"])[lane])["harness"];
  } catch (e) {
    if (isReportError(e)) throw e;
    fail(`cannot read recorded harness for lane ${lane} from ${runDir}/run.json: ${errMsg(e)}`);
  }
  if (typeof harness !== "string" || !SUPPORTED.has(harness)) {
    fail(`${pyStr(harness)} has no code-review form`);
  }
  return parseReport(harness, finalReport(harness, eventsPath, lastPath), scratch);
}

function sameBytes(aPath: string, bPath: string): boolean {
  return readFileSync(aPath).equals(readFileSync(bPath));
}

export function harvest(
  eventsPath: string,
  logsDir: string,
  prefix: string,
  taskRoot: string | null = null,
): string[] {
  const wanted: string[] = [];
  for (const event of readEvents(eventsPath)) {
    if (
      eventField(event, "type") === "system" &&
      eventField(event, "subtype") === "task_notification"
    ) {
      const path = eventField(event, "output_file");
      if (!path) fail("task_notification names no output file");
      if (typeof path !== "string") fail("task_notification output_file is not text");
      if (!wanted.includes(path)) wanted.push(path);
    }
  }
  mkdirSync(logsDir, { recursive: true });
  const scrubbed = stripChars(prefix.replace(PREFIX_SANITIZE, "-"), ".-");
  const clean = scrubbed === "" ? "review" : scrubbed;
  // The root is resolved before comparing: the task path always is, so an unresolved root
  // under a symlinked /tmp would refuse its own files. The override exists for fixtures.
  const root = taskRoot !== null ? pyResolve(taskRoot) : pyResolve(`/tmp/claude-${uid()}`);
  const planned: Array<[string, string]> = [];
  wanted.forEach((path, n) => {
    const index = n + 1;
    let resolved: string;
    try {
      resolved = realpathSync(path);
    } catch {
      fail(`Claude task output named by task_notification is missing: ${path}`);
    }
    const rel = relative(root, resolved);
    if (rel === ".." || rel.startsWith("../") || isAbsolute(rel)) {
      fail(`Claude task output is outside ${root}: ${path}`);
    }
    let isFile = false;
    try {
      isFile = statSync(resolved).isFile();
    } catch {
      isFile = false;
    }
    if (!isFile) fail(`Claude task output named by task_notification is not a file: ${path}`);
    const destination = join(
      logsDir,
      `${clean}-claude-task-${String(index).padStart(2, "0")}-${basename(path)}`,
    );
    if (existsSync(destination) && !sameBytes(resolved, destination)) {
      fail(`refusing to overwrite harvested task output: ${destination}`);
    }
    planned.push([resolved, destination]);
  });
  const copied: string[] = [];
  for (const [resolved, destination] of planned) {
    // Every destination was vetted above: a refused harvest copies nothing.
    if (existsSync(destination)) {
      copied.push(destination);
      continue;
    }
    try {
      copyFileSync(resolved, destination);
    } catch (e) {
      fail(`cannot copy Claude task output ${resolved}: ${errMsg(e)}`);
    }
    copied.push(destination);
  }
  return copied;
}

// --- entry ------------------------------------------------------------------------------
function main(argv: string[]): number {
  if (argv.length > 0 && argv[0] === "normalize" && argv.length >= 6) {
    const lane = argv[1]!;
    const scratch = argv[2]!;
    const eventsPath = argv[3]!;
    let runDir: string | null = null;
    let lastPath: string | null = null;
    const rest = argv.slice(4);
    while (rest.length > 0) {
      const option = rest.shift()!;
      if ((option === "--run" || option === "--last") && rest.length > 0) {
        const value = rest.shift()!;
        if (option === "--run") runDir = value;
        else lastPath = value;
      } else {
        fail(`unknown or incomplete option: ${option}`);
      }
    }
    if (!runDir) fail("normalize needs --run <dispatch>");
    console.log(JSON.stringify(normalizeCli(lane, scratch, eventsPath, runDir, lastPath), null, 2));
    return 0;
  }
  if (argv.length > 0 && argv[0] === "harvest" && argv.length === 5 && argv[3] === "--prefix") {
    for (const p of harvest(argv[1]!, argv[2]!, argv[4]!)) console.log(p);
    return 0;
  }
  console.error(USAGE);
  return 1;
}

// --- run ----------------------------------------------------------------------------------
if (import.meta.main) {
  const argv = process.argv.slice(2);
  try {
    process.exit(main(argv));
  } catch (e) {
    if (isReportError(e)) {
      console.error(`review-findings: ${e.message}`);
      process.exit(1);
    }
    throw e;
  }
}
