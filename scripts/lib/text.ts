// Unicode text edges where JavaScript and Python differ: full case folding
// (Python's str.casefold, which lowercases more than toLowerCase) and the
// Unicode word classes behind Python's \w (JavaScript's stays ASCII).
// One home for every ported Unicode primitive: consumers route through
// here and never hand-write \w \d \b \s, so this file is exempt from its
// own guard scan (its correctness is golden-guarded instead).
// Generated from python3 unicodedata 15.0.0: every code point where
// casefold(c) != lower(c), plus U+03A3 (context-free fold beats final sigma).
// Regen: the loop in the round-9 notes (python3 -c over 0..0x10FFFF).
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SelfTest } from "./selftest.ts";

const CASEFOLD_EXTRA: Record<string, string> = {
  "\u00b5": "\u03bc",
  "\u00df": "\u0073\u0073",
  "\u0149": "\u02bc\u006e",
  "\u017f": "\u0073",
  "\u01f0": "\u006a\u030c",
  "\u0345": "\u03b9",
  "\u0390": "\u03b9\u0308\u0301",
  "\u03a3": "\u03c3",
  "\u03b0": "\u03c5\u0308\u0301",
  "\u03c2": "\u03c3",
  "\u03d0": "\u03b2",
  "\u03d1": "\u03b8",
  "\u03d5": "\u03c6",
  "\u03d6": "\u03c0",
  "\u03f0": "\u03ba",
  "\u03f1": "\u03c1",
  "\u03f5": "\u03b5",
  "\u0587": "\u0565\u0582",
  "\u13a0": "\u13a0",
  "\u13a1": "\u13a1",
  "\u13a2": "\u13a2",
  "\u13a3": "\u13a3",
  "\u13a4": "\u13a4",
  "\u13a5": "\u13a5",
  "\u13a6": "\u13a6",
  "\u13a7": "\u13a7",
  "\u13a8": "\u13a8",
  "\u13a9": "\u13a9",
  "\u13aa": "\u13aa",
  "\u13ab": "\u13ab",
  "\u13ac": "\u13ac",
  "\u13ad": "\u13ad",
  "\u13ae": "\u13ae",
  "\u13af": "\u13af",
  "\u13b0": "\u13b0",
  "\u13b1": "\u13b1",
  "\u13b2": "\u13b2",
  "\u13b3": "\u13b3",
  "\u13b4": "\u13b4",
  "\u13b5": "\u13b5",
  "\u13b6": "\u13b6",
  "\u13b7": "\u13b7",
  "\u13b8": "\u13b8",
  "\u13b9": "\u13b9",
  "\u13ba": "\u13ba",
  "\u13bb": "\u13bb",
  "\u13bc": "\u13bc",
  "\u13bd": "\u13bd",
  "\u13be": "\u13be",
  "\u13bf": "\u13bf",
  "\u13c0": "\u13c0",
  "\u13c1": "\u13c1",
  "\u13c2": "\u13c2",
  "\u13c3": "\u13c3",
  "\u13c4": "\u13c4",
  "\u13c5": "\u13c5",
  "\u13c6": "\u13c6",
  "\u13c7": "\u13c7",
  "\u13c8": "\u13c8",
  "\u13c9": "\u13c9",
  "\u13ca": "\u13ca",
  "\u13cb": "\u13cb",
  "\u13cc": "\u13cc",
  "\u13cd": "\u13cd",
  "\u13ce": "\u13ce",
  "\u13cf": "\u13cf",
  "\u13d0": "\u13d0",
  "\u13d1": "\u13d1",
  "\u13d2": "\u13d2",
  "\u13d3": "\u13d3",
  "\u13d4": "\u13d4",
  "\u13d5": "\u13d5",
  "\u13d6": "\u13d6",
  "\u13d7": "\u13d7",
  "\u13d8": "\u13d8",
  "\u13d9": "\u13d9",
  "\u13da": "\u13da",
  "\u13db": "\u13db",
  "\u13dc": "\u13dc",
  "\u13dd": "\u13dd",
  "\u13de": "\u13de",
  "\u13df": "\u13df",
  "\u13e0": "\u13e0",
  "\u13e1": "\u13e1",
  "\u13e2": "\u13e2",
  "\u13e3": "\u13e3",
  "\u13e4": "\u13e4",
  "\u13e5": "\u13e5",
  "\u13e6": "\u13e6",
  "\u13e7": "\u13e7",
  "\u13e8": "\u13e8",
  "\u13e9": "\u13e9",
  "\u13ea": "\u13ea",
  "\u13eb": "\u13eb",
  "\u13ec": "\u13ec",
  "\u13ed": "\u13ed",
  "\u13ee": "\u13ee",
  "\u13ef": "\u13ef",
  "\u13f0": "\u13f0",
  "\u13f1": "\u13f1",
  "\u13f2": "\u13f2",
  "\u13f3": "\u13f3",
  "\u13f4": "\u13f4",
  "\u13f5": "\u13f5",
  "\u13f8": "\u13f0",
  "\u13f9": "\u13f1",
  "\u13fa": "\u13f2",
  "\u13fb": "\u13f3",
  "\u13fc": "\u13f4",
  "\u13fd": "\u13f5",
  "\u1c80": "\u0432",
  "\u1c81": "\u0434",
  "\u1c82": "\u043e",
  "\u1c83": "\u0441",
  "\u1c84": "\u0442",
  "\u1c85": "\u0442",
  "\u1c86": "\u044a",
  "\u1c87": "\u0463",
  "\u1c88": "\ua64b",
  "\u1e96": "\u0068\u0331",
  "\u1e97": "\u0074\u0308",
  "\u1e98": "\u0077\u030a",
  "\u1e99": "\u0079\u030a",
  "\u1e9a": "\u0061\u02be",
  "\u1e9b": "\u1e61",
  "\u1e9e": "\u0073\u0073",
  "\u1f50": "\u03c5\u0313",
  "\u1f52": "\u03c5\u0313\u0300",
  "\u1f54": "\u03c5\u0313\u0301",
  "\u1f56": "\u03c5\u0313\u0342",
  "\u1f80": "\u1f00\u03b9",
  "\u1f81": "\u1f01\u03b9",
  "\u1f82": "\u1f02\u03b9",
  "\u1f83": "\u1f03\u03b9",
  "\u1f84": "\u1f04\u03b9",
  "\u1f85": "\u1f05\u03b9",
  "\u1f86": "\u1f06\u03b9",
  "\u1f87": "\u1f07\u03b9",
  "\u1f88": "\u1f00\u03b9",
  "\u1f89": "\u1f01\u03b9",
  "\u1f8a": "\u1f02\u03b9",
  "\u1f8b": "\u1f03\u03b9",
  "\u1f8c": "\u1f04\u03b9",
  "\u1f8d": "\u1f05\u03b9",
  "\u1f8e": "\u1f06\u03b9",
  "\u1f8f": "\u1f07\u03b9",
  "\u1f90": "\u1f20\u03b9",
  "\u1f91": "\u1f21\u03b9",
  "\u1f92": "\u1f22\u03b9",
  "\u1f93": "\u1f23\u03b9",
  "\u1f94": "\u1f24\u03b9",
  "\u1f95": "\u1f25\u03b9",
  "\u1f96": "\u1f26\u03b9",
  "\u1f97": "\u1f27\u03b9",
  "\u1f98": "\u1f20\u03b9",
  "\u1f99": "\u1f21\u03b9",
  "\u1f9a": "\u1f22\u03b9",
  "\u1f9b": "\u1f23\u03b9",
  "\u1f9c": "\u1f24\u03b9",
  "\u1f9d": "\u1f25\u03b9",
  "\u1f9e": "\u1f26\u03b9",
  "\u1f9f": "\u1f27\u03b9",
  "\u1fa0": "\u1f60\u03b9",
  "\u1fa1": "\u1f61\u03b9",
  "\u1fa2": "\u1f62\u03b9",
  "\u1fa3": "\u1f63\u03b9",
  "\u1fa4": "\u1f64\u03b9",
  "\u1fa5": "\u1f65\u03b9",
  "\u1fa6": "\u1f66\u03b9",
  "\u1fa7": "\u1f67\u03b9",
  "\u1fa8": "\u1f60\u03b9",
  "\u1fa9": "\u1f61\u03b9",
  "\u1faa": "\u1f62\u03b9",
  "\u1fab": "\u1f63\u03b9",
  "\u1fac": "\u1f64\u03b9",
  "\u1fad": "\u1f65\u03b9",
  "\u1fae": "\u1f66\u03b9",
  "\u1faf": "\u1f67\u03b9",
  "\u1fb2": "\u1f70\u03b9",
  "\u1fb3": "\u03b1\u03b9",
  "\u1fb4": "\u03ac\u03b9",
  "\u1fb6": "\u03b1\u0342",
  "\u1fb7": "\u03b1\u0342\u03b9",
  "\u1fbc": "\u03b1\u03b9",
  "\u1fbe": "\u03b9",
  "\u1fc2": "\u1f74\u03b9",
  "\u1fc3": "\u03b7\u03b9",
  "\u1fc4": "\u03ae\u03b9",
  "\u1fc6": "\u03b7\u0342",
  "\u1fc7": "\u03b7\u0342\u03b9",
  "\u1fcc": "\u03b7\u03b9",
  "\u1fd2": "\u03b9\u0308\u0300",
  "\u1fd3": "\u03b9\u0308\u0301",
  "\u1fd6": "\u03b9\u0342",
  "\u1fd7": "\u03b9\u0308\u0342",
  "\u1fe2": "\u03c5\u0308\u0300",
  "\u1fe3": "\u03c5\u0308\u0301",
  "\u1fe4": "\u03c1\u0313",
  "\u1fe6": "\u03c5\u0342",
  "\u1fe7": "\u03c5\u0308\u0342",
  "\u1ff2": "\u1f7c\u03b9",
  "\u1ff3": "\u03c9\u03b9",
  "\u1ff4": "\u03ce\u03b9",
  "\u1ff6": "\u03c9\u0342",
  "\u1ff7": "\u03c9\u0342\u03b9",
  "\u1ffc": "\u03c9\u03b9",
  "\uab70": "\u13a0",
  "\uab71": "\u13a1",
  "\uab72": "\u13a2",
  "\uab73": "\u13a3",
  "\uab74": "\u13a4",
  "\uab75": "\u13a5",
  "\uab76": "\u13a6",
  "\uab77": "\u13a7",
  "\uab78": "\u13a8",
  "\uab79": "\u13a9",
  "\uab7a": "\u13aa",
  "\uab7b": "\u13ab",
  "\uab7c": "\u13ac",
  "\uab7d": "\u13ad",
  "\uab7e": "\u13ae",
  "\uab7f": "\u13af",
  "\uab80": "\u13b0",
  "\uab81": "\u13b1",
  "\uab82": "\u13b2",
  "\uab83": "\u13b3",
  "\uab84": "\u13b4",
  "\uab85": "\u13b5",
  "\uab86": "\u13b6",
  "\uab87": "\u13b7",
  "\uab88": "\u13b8",
  "\uab89": "\u13b9",
  "\uab8a": "\u13ba",
  "\uab8b": "\u13bb",
  "\uab8c": "\u13bc",
  "\uab8d": "\u13bd",
  "\uab8e": "\u13be",
  "\uab8f": "\u13bf",
  "\uab90": "\u13c0",
  "\uab91": "\u13c1",
  "\uab92": "\u13c2",
  "\uab93": "\u13c3",
  "\uab94": "\u13c4",
  "\uab95": "\u13c5",
  "\uab96": "\u13c6",
  "\uab97": "\u13c7",
  "\uab98": "\u13c8",
  "\uab99": "\u13c9",
  "\uab9a": "\u13ca",
  "\uab9b": "\u13cb",
  "\uab9c": "\u13cc",
  "\uab9d": "\u13cd",
  "\uab9e": "\u13ce",
  "\uab9f": "\u13cf",
  "\uaba0": "\u13d0",
  "\uaba1": "\u13d1",
  "\uaba2": "\u13d2",
  "\uaba3": "\u13d3",
  "\uaba4": "\u13d4",
  "\uaba5": "\u13d5",
  "\uaba6": "\u13d6",
  "\uaba7": "\u13d7",
  "\uaba8": "\u13d8",
  "\uaba9": "\u13d9",
  "\uabaa": "\u13da",
  "\uabab": "\u13db",
  "\uabac": "\u13dc",
  "\uabad": "\u13dd",
  "\uabae": "\u13de",
  "\uabaf": "\u13df",
  "\uabb0": "\u13e0",
  "\uabb1": "\u13e1",
  "\uabb2": "\u13e2",
  "\uabb3": "\u13e3",
  "\uabb4": "\u13e4",
  "\uabb5": "\u13e5",
  "\uabb6": "\u13e6",
  "\uabb7": "\u13e7",
  "\uabb8": "\u13e8",
  "\uabb9": "\u13e9",
  "\uabba": "\u13ea",
  "\uabbb": "\u13eb",
  "\uabbc": "\u13ec",
  "\uabbd": "\u13ed",
  "\uabbe": "\u13ee",
  "\uabbf": "\u13ef",
  "\ufb00": "\u0066\u0066",
  "\ufb01": "\u0066\u0069",
  "\ufb02": "\u0066\u006c",
  "\ufb03": "\u0066\u0066\u0069",
  "\ufb04": "\u0066\u0066\u006c",
  "\ufb05": "\u0073\u0074",
  "\ufb06": "\u0073\u0074",
  "\ufb13": "\u0574\u0576",
  "\ufb14": "\u0574\u0565",
  "\ufb15": "\u0574\u056b",
  "\ufb16": "\u057e\u0576",
  "\ufb17": "\u0574\u056d",
};

/** Python's `str.casefold`, per code point: the table folds every point
 * where folding differs from lowercasing, and the rest lowercase
 * one point at a time — folding is context-free, so \u03a3 always folds
 * to \u03c3 and never to a final sigma. Single-point lowering matches
 * whole-string lowering everywhere else. */
/** Python `str.lower`, exactly: `toLowerCase` is it on every adversarial
 * single (dotted-I, dotless-i, long-s, sharp-s, sigmas, Kelvin, Cherokee
 * small-letter — all differenced in the `lower` goldens below), so this
 * alias is the home every ported `.lower()` calls instead of the method. */
export function pyLower(s: string): string {
  return s.toLowerCase();
}

export function casefold(s: string): string {
  let out = "";
  for (const ch of s) out += CASEFOLD_EXTRA[ch] ?? ch.toLowerCase();
  return out;
}

/** The atom of WORD_RUN_RE, for patterns that wrap it (apostrophe
 * groups): Python's `[^\W\d_]` under a Unicode pattern — letters and
 * non-decimal numbers. Fuzzed against `re` over the BMP: the only
 * differences are 16 code points unassigned in Unicode 15 (the
 * table's version) and assigned since (bun's ICU carries 17), so
 * the formulation is exact and the skew is the versions'. */
export const WORD_CLASS = "\\p{L}\\p{Nl}\\p{No}";
export const WORD_RUN_RE = new RegExp(`[${WORD_CLASS}]+`, "gu");

/** Python's `\w` under a Unicode pattern: letters, numbers and `_`.
 * Same fuzzing and same 16-point version skew as WORD_RUN_RE. */
export const WORD_CHAR_RE = /[\p{L}\p{N}_]/u;

// --- Python regex primitives --------------------------------------------------
// One home for what BASE's patterns mean: every ported use of these goes
// through this module (atoms for `new RegExp` constructions, the same \p
// spellings in literals), so the next sweep has one place to check.
// Literals hand-writing a formulation below cite it (text.ts: <name>).

/** Python `\w` as a class atom: embed as `[${W_CLASS}...]` in a `u` pattern.
 * Fuzzed against `re` over the BMP: exact but for the 16 version-skew
 * points WORD_CHAR_RE carries (bun's ICU 17 vs the table's Unicode 15). */
export const W_CLASS = "\\p{L}\\p{N}_";

/** Python `\d` as a class atom: Unicode decimal digits (category Nd).
 * Enumerated against `re` (Unicode 15) over the full range: the only
 * mismatches are the 90 code points of the nine Unicode 16/17 runs,
 * which ICU 17 matches and CPython 15 leaves unassigned. INTENDED
 * DIVERGENCE, pinned by a divergent golden: the port follows ICU. */
export const D_CLASS = "\\p{Nd}";

/** The halves of Python `\b`: no word char (`W_CLASS`) on that side.
 * Differential over a word/non-word grid (astral, controls, format
 * chars included): 0/255 mismatches. */
export const BOUND_L = "(?<![\\p{L}\\p{N}_])";
export const BOUND_R = "(?![\\p{L}\\p{N}_])";

/** The halves of BASE's names-style lookarounds `(?<![^\W_])` /
 * `(?![^\W_])`: not adjacent to a Unicode letter or number. Note the
 * double negation: `[^\W_]` is `[\p{L}\p{N}]` (never `_`), so `_`
 * may abut the match where a letter may not. */
export const NAME_L = "(?<![\\p{L}\\p{N}])";
export const NAME_R = "(?![\\p{L}\\p{N}])";
/** Python \[^\W_] as a class atom: a word char that is not `_`
 * (letters and numbers, every \p{N} — ½ counts, `_` never does). Embed as
 * `[${NAME_CLASS}]` in a `u` pattern. */
export const NAME_CLASS = "\\p{L}\\p{N}";

/** Python `\Z`: the absolute end of the string, no trailing-newline
 * leniency. Use where BASE anchors `\Z` (multiline `$` is not it: with
 * `m`, `$` stops at every line end). */
export const END_OF_STRING = "(?![\\s\\S])";

/** Python `$` without MULTILINE: the end, or just before one trailing
 * newline. Use only in patterns WITHOUT the `m` flag (with `m` the
 * inner `$` goes multiline too). */
export const END_OR_BEFORE_NL = "(?=\\n?$)";

/** `re.IGNORECASE` for a literal: regex-escape, then expand every
 * `i`/`I` (and literal dotted/dotless `İ`/`ı`) to the class Python
 * treats as one letter. JS `iu` already matches Python's `re.I` on
 * everything else (`ſ`, `K`, `σ`/`ς`/`Σ` probed, plus Cherokee and
 * accents) — only the dotted-I class differs, and only there.
 * Fuzzed as `^(?:literalI(lit))$`/`iu` against
 * `re.fullmatch(re.escape(lit), inp, re.I)`: 0/6000. Compiled by the
 * caller with the `iu` flags; without `u`, `i` stays ASCII. */
const I_EQUIVS = "[iI\u0130\u0131]";
export function literalI(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&").replace(/[iI\u0130\u0131]/gu, I_EQUIVS);
}

/** `str.isdigit`, enumerated from CPython over the full range: nonempty,
 * and every char is Nd or an integer-valued No (superscripts, Kharosthi
 * digits; `½` and Aegean numerals are out). Regen: the loop in the
 * round-10 notes (`unicodedata.category`/`numeric` over 0..0x10FFFF). */
const INT_NO_CHARS =
  "\u00b2\u00b3\u00b9\u1369\u136a\u136b\u136c\u136d\u136e\u136f\u1370\u1371\u19da\u2070\u2074\u2075\u2076\u2077\u2078\u2079\u2080\u2081\u2082\u2083\u2084\u2085\u2086\u2087\u2088\u2089\u2460\u2461\u2462\u2463\u2464\u2465\u2466\u2467\u2468\u2474\u2475\u2476\u2477\u2478\u2479\u247a\u247b\u247c\u2488\u2489\u248a\u248b\u248c\u248d\u248e\u248f\u2490\u24ea\u24f5\u24f6\u24f7\u24f8\u24f9\u24fa\u24fb\u24fc\u24fd\u24ff\u2776\u2777\u2778\u2779\u277a\u277b\u277c\u277d\u277e\u2780\u2781\u2782\u2783\u2784\u2785\u2786\u2787\u2788\u278a\u278b\u278c\u278d\u278e\u278f\u2790\u2791\u2792\u{10a40}\u{10a41}\u{10a42}\u{10a43}\u{10e60}\u{10e61}\u{10e62}\u{10e63}\u{10e64}\u{10e65}\u{10e66}\u{10e67}\u{10e68}\u{11052}\u{11053}\u{11054}\u{11055}\u{11056}\u{11057}\u{11058}\u{11059}\u{1105a}\u{1f100}\u{1f101}\u{1f102}\u{1f103}\u{1f104}\u{1f105}\u{1f106}\u{1f107}\u{1f108}\u{1f109}\u{1f10a}";
const INT_NO = new Set<string>();
for (const ch of INT_NO_CHARS) INT_NO.add(ch);

/** Decimal-digit runs `[first, last]` (Unicode 17), for digitValue:
 * 73 runs: one of 50 code points (the five math styles, value mod 10),
 * the rest of 10. The nine past the Unicode 15 set are Garay, Myanmar
 * Pao, Myanmar Eastern Pwo Karen (adjacent to Pao, hence a second run),
 * Sunuwar, Tolong Siki, Gurung Khema, Kirat Rai, the legacy-computing
 * outlined digits, and Ol Onal. Verified against UCD 17.0.0: the table
 * holds exactly its 770 Nd, each with decimal value `(cp - first) % 10`.
 * INTENDED DIVERGENCE from Python: `unicodedata` (15.0) leaves these 90
 * unassigned, so `int()` rejects what digitValue now accepts. The port
 * follows its runtime (ICU 17, which `D_CLASS` matches with), not the
 * reference's older table. */
const ND_RUNS: Array<[number, number]> = [
  [0x30, 0x39],
  [0x660, 0x669],
  [0x6f0, 0x6f9],
  [0x7c0, 0x7c9],
  [0x966, 0x96f],
  [0x9e6, 0x9ef],
  [0xa66, 0xa6f],
  [0xae6, 0xaef],
  [0xb66, 0xb6f],
  [0xbe6, 0xbef],
  [0xc66, 0xc6f],
  [0xce6, 0xcef],
  [0xd66, 0xd6f],
  [0xde6, 0xdef],
  [0xe50, 0xe59],
  [0xed0, 0xed9],
  [0xf20, 0xf29],
  [0x1040, 0x1049],
  [0x1090, 0x1099],
  [0x17e0, 0x17e9],
  [0x1810, 0x1819],
  [0x1946, 0x194f],
  [0x19d0, 0x19d9],
  [0x1a80, 0x1a89],
  [0x1a90, 0x1a99],
  [0x1b50, 0x1b59],
  [0x1bb0, 0x1bb9],
  [0x1c40, 0x1c49],
  [0x1c50, 0x1c59],
  [0xa620, 0xa629],
  [0xa8d0, 0xa8d9],
  [0xa900, 0xa909],
  [0xa9d0, 0xa9d9],
  [0xa9f0, 0xa9f9],
  [0xaa50, 0xaa59],
  [0xabf0, 0xabf9],
  [0xff10, 0xff19],
  [0x104a0, 0x104a9],
  [0x10d30, 0x10d39],
  [0x10d40, 0x10d49],
  [0x11066, 0x1106f],
  [0x110f0, 0x110f9],
  [0x11136, 0x1113f],
  [0x111d0, 0x111d9],
  [0x112f0, 0x112f9],
  [0x11450, 0x11459],
  [0x114d0, 0x114d9],
  [0x11650, 0x11659],
  [0x116c0, 0x116c9],
  [0x116d0, 0x116d9],
  [0x116da, 0x116e3],
  [0x11730, 0x11739],
  [0x118e0, 0x118e9],
  [0x11950, 0x11959],
  [0x11bf0, 0x11bf9],
  [0x11c50, 0x11c59],
  [0x11d50, 0x11d59],
  [0x11da0, 0x11da9],
  [0x11de0, 0x11de9],
  [0x11f50, 0x11f59],
  [0x16130, 0x16139],
  [0x16a60, 0x16a69],
  [0x16ac0, 0x16ac9],
  [0x16b50, 0x16b59],
  [0x16d70, 0x16d79],
  [0x1ccf0, 0x1ccf9],
  [0x1d7ce, 0x1d7ff],
  [0x1e140, 0x1e149],
  [0x1e2f0, 0x1e2f9],
  [0x1e4f0, 0x1e4f9],
  [0x1e5f1, 0x1e5fa],
  [0x1e950, 0x1e959],
  [0x1fbf0, 0x1fbf9],
];

const ND_ONE = /^\p{Nd}$/u;

/** One char of `str.isdigit`: Nd, or an integer-valued No. */
export function isDigitChar(ch: string): boolean {
  ND_ONE.lastIndex = 0;
  return ND_ONE.test(ch) || INT_NO.has(ch);
}

/** Python `str.isdigit`: nonempty, every char `isDigitChar`. */
export function isDigit(s: string): boolean {
  if (s === "") return false;
  for (const ch of s) if (!isDigitChar(ch)) return false;
  return true;
}

/** `int(s)` for digit strings, as ASCII: each Nd to its 0-9 value.
 * Throws where `int()` raises ValueError (a non-decimal digit like
 * `²` under an `isdigit` guard); callers map that to their die. */
export function digitValue(s: string): string {
  if (s === "") throw new Error('not a decimal digit: ""');
  let out = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    let v = -1;
    for (const [first, last] of ND_RUNS) {
      if (cp >= first && cp <= last) {
        v = (cp - first) % 10;
        break;
      }
    }
    if (v < 0) throw new Error(`not a decimal digit: ${JSON.stringify(ch)}`);
    out += String(v);
  }
  return out;
}

// --- Python whitespace, lines and multiline -------------------------------------------------------
// Python's `\s` (under a Unicode pattern), `str.isspace`, `str.split`,
// `str.strip` and `str.splitlines` disagree with every JavaScript spelling:
// JS splits on FEFF and keeps \x1c-\x1f and \x85; `str.splitlines` also
// breaks on \x0b \x0c \x1c-\x1e \x85 U+2028/9 (but never on \x1f or FEFF);
// `re.MULTILINE` `^`/`$` split on `\n` only (JS `$`/`^` with `m` also split
// `\r`, LS, PS); and `.` bars only `\n` (JS also bars `\r`, LS, PS).

/** Python `\s` as a class atom: the 29 `str.isspace` chars (enumerated
 * from CPython; no astral space exists). Embed as `[${PY_S_CLASS}]`,
 * negate as `[^${PY_S_CLASS}...]`. */
export const PY_S_CLASS =
  "\\t\\n\\x0b\\x0c\\r\\x1c\\x1d\\x1e\\x1f\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";

/** Python `.` without DOTALL: anything but `\n`. */
export const PY_DOT = "[^\\n]";
/** Any char including LF, as a template atom (BASE re.S). A plain string, so the guard never sees its backslashes. */
export const DOT_ALL = "[\\s\\S]";

/** Python `re.MULTILINE` `^`: the start, or just after `\n` — only `\n`.
 * Safe under any flags; patterns using it carry no other `^`/`$`. */
export const PY_M_START = "(?:(?<![\\s\\S])|(?<=\\n))";

/** Python `re.MULTILINE` `$`: just before `\n`, or the end. Safe under
 * any flags; patterns using it carry no other `^`/`$`. */
export const PY_M_END = "(?=\\n|(?![\\s\\S]))";

const PY_WS_LEAD = new RegExp(`^[${PY_S_CLASS}]+`, "u");
const PY_WS_TRAIL = new RegExp(`[${PY_S_CLASS}]+$`, "u");
const PY_WS_RUN = new RegExp(`[${PY_S_CLASS}]+`, "gu");
const PY_LINE_SRC = "\\r\\n|[\\n\\x0b\\x0c\\r\\x1c\\x1d\\x1e\\x85\\u2028\\u2029]";
const PY_LINE_BOUNDARY = new RegExp(PY_LINE_SRC, "gu");
const PY_LINE_AT_END = new RegExp(`(?:${PY_LINE_SRC})$`, "u");

/** Python `str.strip()` with no args: both ends, Python whitespace. */
export function pyTrim(s: string): string {
  return s.replace(PY_WS_LEAD, "").replace(PY_WS_TRAIL, "");
}

/** Python `str.rstrip()` with no args: the trailing end, Python whitespace. */
export function pyRstrip(s: string): string {
  return s.replace(PY_WS_TRAIL, "");
}

/** Python `str.split()` with no args: runs of Python whitespace, ends
 * stripped, empty words never emitted. `" ".join(text.split())` is
 * `pyWords(text).join(" ")`. */
export function pyWords(s: string): string[] {
  const t = pyTrim(s);
  return t === "" ? [] : t.split(PY_WS_RUN);
}

/** Python `str.splitlines`: line boundaries split, `\r\n` counts once, a
 * boundary at the very end emits no trailing empty, and `""` gives `[]`. */
export function pySplitLines(s: string): string[] {
  if (s === "") return [];
  const parts = s.split(PY_LINE_BOUNDARY);
  if (PY_LINE_AT_END.test(s)) parts.pop();
  return parts;
}

// --- self-test: goldens, then the guard ------------------------------------------------------------------
// Every export above is differenced against the Python it ports, in one
// python3 call over a JSON case list. Cases carry both spellings (the
// Python pattern and the module's) because the spellings differ on
// purpose; the behavior must not.

interface GoldenCase {
  op: string;
  s: string;
  pyPat?: string;
  tsSrc?: string;
  flags?: string;
  lit?: string;
  // An intended divergence: both sides pinned exactly, never equal.
  diverge?: { ts: unknown; py: unknown };
}

interface GoldenOut {
  ok: boolean;
  r: unknown;
}

const PY_GOLDEN_PROG = [
  "import json, re, sys",
  "cases = json.load(sys.stdin)",
  "out = []",
  "for c in cases:",
  "    op = c['op']",
  "    try:",
  "        if op == 'casefold': r = c['s'].casefold()",
  "        elif op == 'lower': r = c['s'].lower()",
  "        elif op == 'isdigit': r = c['s'].isdigit()",
  "        elif op == 'digitvalue':",
  "            try: r = str(int(c['s']))",
  "            except ValueError: r = 'ValueError'",
  "        elif op == 'fullmatch': r = bool(re.fullmatch(c['pyPat'], c['s']))",
  "        elif op == 'fullmatchI': r = bool(re.fullmatch(re.escape(c['lit']), c['s'], re.I))",
  "        elif op == 'search':",
  "            fl = re.M if c.get('flags') == 'm' else 0",
  "            m = re.search(c['pyPat'], c['s'], fl)",
  "            r = [m.group(0)] if m else []",
  "        elif op == 'findall': r = re.findall(c['pyPat'], c['s'])",
  "        elif op == 'strip': r = c['s'].strip()",
  "        elif op == 'rstrip': r = c['s'].rstrip()",
  "        elif op == 'split': r = c['s'].split()",
  "        elif op == 'splitlines': r = c['s'].splitlines()",
  "        else: raise ValueError('unknown op ' + op)",
  "        out.append({'ok': True, 'r': r})",
  "    except Exception as e:",
  "        out.append({'ok': False, 'r': '%s: %s' % (type(e).__name__, e)})",
  "print(json.dumps(out))",
].join("\n");

function tsGolden(c: GoldenCase): GoldenOut {
  try {
    const s = c.s;
    switch (c.op) {
      case "casefold":
        return { ok: true, r: casefold(s) };
      case "lower":
        return { ok: true, r: pyLower(s) };
      case "isdigit":
        return { ok: true, r: isDigit(s) };
      case "digitvalue":
        try {
          return { ok: true, r: digitValue(s) };
        } catch {
          return { ok: true, r: "ValueError" };
        }
      case "fullmatch":
        return { ok: true, r: new RegExp(`^(?:${c.tsSrc})$`, "u").test(s) };
      case "fullmatchI":
        return { ok: true, r: new RegExp(`^(?:${literalI(c.lit!)})$`, "iu").test(s) };
      case "search": {
        const m = new RegExp(c.tsSrc!, c.flags === "m" ? "mu" : "u").exec(s);
        return { ok: true, r: m ? [m[0]] : [] };
      }
      case "findall":
        return { ok: true, r: [...s.matchAll(new RegExp(c.tsSrc!, "gu"))].map((m) => m[0]) };
      case "strip":
        return { ok: true, r: pyTrim(s) };
      case "rstrip":
        return { ok: true, r: pyRstrip(s) };
      case "split":
        return { ok: true, r: pyWords(s) };
      case "splitlines":
        return { ok: true, r: pySplitLines(s) };
      default:
        throw new Error(`unknown op ${c.op}`);
    }
  } catch (e) {
    return { ok: false, r: `Error: ${String((e as Error).message ?? e)}` };
  }
}

function goldenCases(): GoldenCase[] {
  const cases: GoldenCase[] = [];
  const wFull = { pyPat: "\\w+", tsSrc: `[${W_CLASS}]+` };
  const wWords = ["aZ09_", "ßſ", "٣١", "½Ⅷ²", "a-b", "\u0301", "Ω𝔘", "x_y2", "ﬁﬂ", ""];
  for (const s of wWords) cases.push({ op: "fullmatch", s, ...wFull });
  const wordFull = {
    pyPat: "[^\\W\\d_]+(?:'[^\\W\\d_]+)*",
    tsSrc: `[${WORD_CLASS}]+(?:'[${WORD_CLASS}]+)*`,
  };
  for (const s of ["l'homme", "½x", "1a", "a1", "_a", "a_", "É", "ﬁsh", "a'b'c", "x"])
    cases.push({ op: "fullmatch", s, ...wordFull });
  const nameFull = { pyPat: "[^\\W_]+", tsSrc: `[${NAME_CLASS}]+` };
  for (const s of ["a", "_", "٣", "½", "Ⅷ", "²", "a_b", "٣x", "ﬁ", "", "a-"])
    cases.push({ op: "fullmatch", s, ...nameFull });
  cases.push({
    op: "findall",
    s: "ab 12 c3 _x Aé㈠",
    pyPat: "[^\\W\\d_]+",
    tsSrc: `[${WORD_CLASS}]+`,
  });
  cases.push({ op: "findall", s: "a1b₂c3", pyPat: "[^\\W\\d_]+", tsSrc: `[${WORD_CLASS}]+` });
  const dFull = { pyPat: "\\d+", tsSrc: `[${D_CLASS}]+` };
  for (const s of ["123", "١٢" + "٣", "½", "²", "Ⅷ", "1a", "", "१२", "०", "５"])
    cases.push({ op: "fullmatch", s, ...dFull });
  cases.push({
    op: "fullmatch",
    s: "\u{10D40}\u{10D41}",
    ...dFull,
    diverge: { ts: true, py: false },
  });
  const sides = ["", " ", "_", "1", "é", "١", ".", "-", "\n", "ﬁ", "\u{1d518}"];
  for (const l of sides)
    for (const r of sides) {
      const s = `${l}ab${r}`;
      cases.push({ op: "search", s, pyPat: "\\bab", tsSrc: `${BOUND_L}ab` });
      cases.push({
        op: "search",
        s,
        pyPat: "(?<![^\\W_])ab(?![^\\W_])",
        tsSrc: `${NAME_L}ab${NAME_R}`,
      });
    }
  for (const s of ["a", "a\n", "xa", "", "a\n\n", "\n"])
    cases.push({ op: "search", s, pyPat: "a\\Z", tsSrc: `a${END_OF_STRING}` });
  for (const s of ["a", "a\n", "a\n\n", "xa", "a\rb", "ab\n", "a\u2028", "\n"])
    cases.push({ op: "search", s, pyPat: "a$", tsSrc: `a${END_OR_BEFORE_NL}` });
  for (const s of [
    "ab",
    "x\nab",
    "x\rab",
    "x\u2028ab",
    "x\u2029ab",
    "ab\ncd",
    "ab\rcd",
    "\nab",
    "ab\n",
  ])
    cases.push({ op: "search", s, flags: "m", pyPat: "^ab$", tsSrc: `${PY_M_START}ab${PY_M_END}` });
  for (const s of ["axb", "a\nb", "a\rb", "a\u2028b", "a\u2029b", "ab", "a\u0085b"])
    cases.push({ op: "search", s, pyPat: "a.b", tsSrc: `a${PY_DOT}b` });
  const wsChars: string[] = [];
  for (let cp = 0; cp <= 0x2100; cp++) wsChars.push(String.fromCodePoint(cp));
  wsChars.push(
    "\u2028",
    "\u2029",
    "\u202f",
    "\u205f",
    "\u3000",
    "\u3000a",
    "\ufeff",
    "\u200b",
    "a",
    "À",
    "ÿ",
    "ﬁ",
  );
  for (const ch of wsChars) {
    cases.push({ op: "fullmatch", s: ch, pyPat: "\\s+", tsSrc: `[${PY_S_CLASS}]+` });
    cases.push({ op: "strip", s: `${ch}x${ch}` });
    cases.push({ op: "split", s: `a${ch}b` });
    cases.push({ op: "splitlines", s: `a${ch}b` });
  }
  for (const s of [
    "a\rb",
    "a\x0bb",
    "a\x0cb",
    "a\x1cb",
    "a\x1db",
    "a\x1eb",
    "a\u0085b",
    "a\u2028b",
    "a\u2029b",
    "a\r\nb",
    "a\n",
    "a\r",
    "a\n\n",
    "",
    "\n",
    "a\r\r\nb",
    "\u202f",
    "a\u202f",
    "\u2028\u2029\u202f",
    " \t\nAB ",
    "a  b\t\tc",
    "",
    "   ",
    "\u001f",
    "\ufeffx\ufeff",
    "\u200b",
  ])
    cases.push({ op: "splitlines", s });
  for (const s of [
    "",
    "   ",
    " \ta\nb  c ",
    "a\u202fb\u2028c",
    "\ufeffx",
    "x\ufeff",
    "a\xa0b\xa0c",
  ])
    cases.push({ op: "split", s });
  for (const s of ["", "   ", "\u202fx\u202f", "\ufeffx\ufeff", "\ta\n", "\u202f\u202f", "x"]) {
    cases.push({ op: "strip", s });
    cases.push({ op: "rstrip", s });
  }
  for (const s of [
    "Straße",
    "STRASSE",
    "ſ",
    "S",
    "İ",
    "i̇",
    "ı",
    "Σ",
    "σ",
    "ς",
    "σς",
    "K",
    "ﬂ",
    "ẞ",
    "",
    "ﬁsh",
    "ᏸᏹ",
    "éÉ",
    "Ω𝔘",
    "𐐀𐐨",
    "a🙂b",
    "ﬁﬂ",
    "Hello WORLD",
  ])
    cases.push({ op: "casefold", s });
  for (const ch of [
    ...Object.keys(CASEFOLD_EXTRA),
    "İ",
    "ı",
    "ſ",
    "ß",
    "Σ",
    "σ",
    "ς",
    "K",
    "ᏸ",
    "𝔘",
  ])
    cases.push({ op: "lower", s: ch });
  // Firsts of the nine Unicode 16/17 runs: ICU 17 calls them Nd and
  // CPython 15 (unassigned) does not. Both sides pinned, never equal.
  const NEW_ND = new Set([
    0x10d40, 0x116d0, 0x116da, 0x11bf0, 0x11de0, 0x16130, 0x16d70, 0x1ccf0, 0x1e5f1,
  ]);
  const ndSamples: string[] = [];
  const ndDivergent = new Set<string>();
  for (const [first, last] of ND_RUNS) {
    const samples = [
      String.fromCodePoint(first),
      String.fromCodePoint(first + 5),
      String.fromCodePoint(last),
    ];
    ndSamples.push(...samples);
    if (NEW_ND.has(first)) for (const ch of samples) ndDivergent.add(ch);
  }
  for (const ch of [...INT_NO_CHARS]) cases.push({ op: "isdigit", s: ch });
  for (const s of [
    ...ndSamples,
    "",
    "½",
    "Ⅷ",
    "a",
    "1a",
    "a1",
    " ",
    "1 2",
    "١٢٣٤٥٦٧٨٩",
    "²٣",
    ".",
    "-1",
    "123",
    "١٢" + "٣",
    "²²",
  ]) {
    cases.push({
      op: "isdigit",
      s,
      ...(ndDivergent.has(s) ? { diverge: { ts: true, py: false } } : {}),
    });
  }
  for (const [first] of ND_RUNS) {
    const dv = NEW_ND.has(first);
    cases.push({
      op: "digitvalue",
      s: String.fromCodePoint(first),
      ...(dv ? { diverge: { ts: "0", py: "ValueError" } } : {}),
    });
    cases.push({
      op: "digitvalue",
      s: String.fromCodePoint(first + 5),
      ...(dv ? { diverge: { ts: "5", py: "ValueError" } } : {}),
    });
  }
  for (const s of ["123", "١٢" + "٣", "²", "a", "", "1a", "½", " ", "²²", "१२३"])
    cases.push({ op: "digitvalue", s });
  const lits = [
    "Pm",
    "i",
    "İ",
    "FILE",
    "a.c",
    "a+b",
    "x?y",
    "(z)",
    "[a]",
    "^s$",
    "back\\slash",
    "straße",
    "1I2",
    "",
  ];
  const iInputs: Record<string, string[]> = {
    Pm: ["Pm", "PM", "pm", "pM", "Px"],
    i: ["i", "I", "İ", "ı", "j"],
    İ: ["i", "I", "İ", "ı"],
    FILE: ["file", "FiLe", "FILE", "ﬁle"],
    "a.c": ["a.c", "A.C", "axc"],
    "a+b": ["a+b", "A+B", "aab"],
    "x?y": ["x?y", "X?Y"],
    "(z)": ["(z)", "(Z)"],
    "[a]": ["[a]", "[A]"],
    "^s$": ["^s$", "^S$"],
    "back\\slash": ["back\\slash", "BACK\\SLASH"],
    straße: ["straße", "STRASSE", "Straße"],
    "1I2": ["1i2", "1I2", "1İ2", "1ı2"],
    "": ["", "a"],
  };
  for (const lit of lits) for (const s of iInputs[lit]!) cases.push({ op: "fullmatchI", s, lit });
  return cases;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function runGoldens(st: SelfTest): void {
  // Invariants that hold without any interpreter: the tables' shapes.
  st.check("isdigit table holds its 128 integer-valued others", [...INT_NO_CHARS].length === 128);
  st.check("digit runs cover their 73 blocks", ND_RUNS.length === 73);
  st.check(
    "digitValue reads the finding's witness, Garay zero (U+10D40)",
    digitValue("\u{10D40}") === "0",
  );
  {
    // ND_RUNS covers the runtime's \p{Nd} exactly: no matcher can hand
    // digitValue a digit the table throws on. Full range, ~0.1 s.
    const one = /^\p{Nd}$/u;
    let missing = 0;
    let missingCp = 0;
    for (let cp = 0; cp <= 0x10ffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      one.lastIndex = 0;
      if (!one.test(String.fromCodePoint(cp))) continue;
      let v = -1;
      for (const [first, last] of ND_RUNS) {
        if (cp >= first && cp <= last) {
          v = (cp - first) % 10;
          break;
        }
      }
      if (v < 0) {
        missing += 1;
        missingCp = cp;
      }
    }
    st.check(
      "every Nd the runtime matches is a digit the table values",
      missing === 0,
      missing === 0 ? "" : `${missing} missing, first U+${missingCp.toString(16)}`,
    );
  }
  // The BASE side is committed, not run: the cases still build live, and
  // the truth comes from the fixture (regen per its _note). A case added
  // or edited without a regen fails the length check or its row.
  const cases = goldenCases();
  const fixture = JSON.parse(
    readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "text-goldens.json"),
      "utf-8",
    ),
  ) as { python: string; truth: GoldenOut[] };
  const truth = fixture.truth;
  if (truth.length !== cases.length) {
    st.fail(
      "module goldens vs python3",
      `fixture has ${truth.length} rows for ${cases.length} cases: regen per scripts/fixtures/text-goldens.json _note`,
    );
    return;
  }
  const bad: string[] = [];
  for (let i = 0; i < cases.length; i++) {
    const mine = tsGolden(cases[i]!);
    const want = truth[i]!;
    const c = cases[i]!;
    if (c.diverge !== undefined) {
      if (!sameValue(mine.r, c.diverge.ts) || !sameValue(want.r, c.diverge.py)) {
        bad.push(
          `${c.op} ${JSON.stringify(c.s.slice(0, 40))}: intended split drifted: port ${JSON.stringify(mine.r)} (want ${JSON.stringify(c.diverge.ts)}) vs py ${JSON.stringify(want.r)} (want ${JSON.stringify(c.diverge.py)})`,
        );
      }
    } else if (mine.ok !== want.ok || !sameValue(mine.r, want.r)) {
      bad.push(
        `${c.op} ${JSON.stringify(c.s.slice(0, 40))}: port ${JSON.stringify(mine.r)} vs py ${JSON.stringify(want.r)}`,
      );
    }
  }
  st.check(
    `module goldens vs python3 (${cases.length} cases, fixture ${fixture.python})`,
    bad.length === 0,
    bad.slice(0, 12).join("\n"),
  );
}

// --- the guard: no hand-written Unicode-meaning escape outside this module ---
// JavaScript's \w \W \d \D \b \B \s \S stay ASCII (the u flag only enables
// \p, it never widens them), and toLowerCase/toUpperCase are not casefold.
// Any of those in a ported pattern or fold is a BASE divergence unless the
// line carries its marker: `ASCII:` plus the true reason for an escape
// (the text is machine-made ASCII, or BASE itself is ASCII-explicit
// there), `ASCII:` or `LOWER:` for a case-op (`LOWER:` where the line
// ports BASE's own `.lower()` exactly — Unicode lowering, never a fold).
// Every regex also carries u, or the same `ASCII:` marker (#171): without
// u, `\p` throws and `/i` folds ASCII-only, both silent divergences.
// The lexer is small on purpose: strings and comments are skipped, template
// bodies are scanned (their ${} holds code), and a `//` inside a template
// or regex literal ends the scan for that line. Whatever it misses, the
// planted failure below would miss too — and fail the run if it did.
// The five forms in PLANTED_MISS are missed on purpose and pinned missed:
// the guard is a tripwire for the common shapes, not a parser. Review
// covers what it cannot see; quoted or commented `new RegExp(` text would
// false-positive, and none exists in the port. A literal inside template
// text or `${}` is missed for u the same single-line way (its escapes are
// still scanned); those few carry u by review.

export interface GuardHit {
  file: string;
  line: number;
  kind: string;
  text: string;
}

export function scanSource(name: string, src: string): GuardHit[] {
  const lines = src.split("\n");
  const hits: GuardHit[] = [];
  let inBlock = false;
  const marked = (n: number, kind: "esc" | "fold"): boolean => {
    const re = kind === "esc" ? /\/\/.*ASCII:/u : /\/\/.*(ASCII|LOWER):/u;
    if (re.test(lines[n]!)) return true;
    // A shielding comment on the line above must LEAD that line: a trailing
    // comment shields its own line only, never the line below it.
    const above = kind === "esc" ? /^\s*\/\/.*ASCII:/u : /^\s*\/\/.*(ASCII|LOWER):/u;
    return n > 0 && above.test(lines[n - 1]!);
  };
  for (let n = 0; n < lines.length; n++) {
    const raw = lines[n]!;
    let code = "";
    let i = 0;
    const litFlags: string[] = [];
    while (i < raw.length) {
      if (inBlock) {
        const end = raw.indexOf("*/", i);
        if (end < 0) {
          i = raw.length;
          break;
        }
        inBlock = false;
        i = end + 2;
        continue;
      }
      const two = raw.slice(i, i + 2);
      if (two === "//") break;
      if (two === "/*") {
        inBlock = true;
        i += 2;
        continue;
      }
      const ch = raw[i]!;
      if (ch === "/" && !inBlock) {
        // A /.../ literal is code even when it holds quotes: swallow it whole
        // so a quote inside cannot fake string-mode and blind the scan.
        const tail = code.replace(/\s+$/u, "");
        const prev = tail.length > 0 ? tail[tail.length - 1]! : ";";
        const kw = /(?:return|typeof|case|in|of|new|delete|void|yield|await|do|else)$/u.test(tail);
        // No `}` `.` `~` `)` `#!`: a slash there is a template path
        // (`${dir}/file`), member access, a home directory, division, or a
        // shebang — not a literal.
        if ((kw || "(. ,=:!&|?{;+-*%^<>".includes(prev)) && !tail.endsWith("#!")) {
          let j = i + 1;
          let inCls = false;
          while (j < raw.length) {
            const d = raw[j]!;
            if (d === "\\") {
              j += 2;
              continue;
            }
            if (d === "[") inCls = true;
            else if (d === "]") inCls = false;
            else if (d === "/" && !inCls) break;
            j++;
          }
          let k = j + 1;
          while (k < raw.length && /[a-z]/u.test(raw[k]!)) k++;
          if (j < raw.length && !inTemplateText(raw, i)) litFlags.push(raw.slice(j + 1, k));
          code += raw.slice(i, k);
          i = k;
          continue;
        }
      }
      if (ch === "'" || ch === '"') {
        // A RegExp("...") argument is pattern text: scan its inside.
        const isArg = /RegExp\($/u.test(code.replace(/\s+$/u, ""));
        i++;
        let inner = "";
        while (i < raw.length && raw[i] !== ch) {
          if (raw[i] === "\\" && i + 1 < raw.length) {
            inner += raw.slice(i, i + 2);
            i += 2;
          } else {
            inner += raw[i];
            i++;
          }
        }
        i++;
        if (isArg) code += inner;
        continue;
      }
      code += ch;
      i++;
    }
    const esc = code.match(/\\{1,2}[wWdDbBsS]/u);
    if (esc) {
      if (!marked(n, "esc"))
        hits.push({ file: name, line: n + 1, kind: esc[0], text: raw.trim().slice(0, 100) });
      continue;
    }
    const fold = code.match(/\.to(Lower|Upper)Case\(/u);
    if (fold && !marked(n, "fold"))
      hits.push({ file: name, line: n + 1, kind: fold[0], text: raw.trim().slice(0, 100) });
    for (const flags of litFlags) {
      if (!flags.includes("u") && !marked(n, "esc"))
        hits.push({ file: name, line: n + 1, kind: "no-u-flag", text: raw.trim().slice(0, 100) });
    }
    for (const flags of ctorFlags(raw)) {
      if (!flags.includes("u") && !marked(n, "esc"))
        hits.push({ file: name, line: n + 1, kind: "no-u-flag", text: raw.trim().slice(0, 100) });
    }
  }
  return hits;
}

// Whether position i on the line sits in template text: an odd count of
// unescaped backticks before it, outside '...'/"..." spans. Single-line
// and ${}-blind on purpose: a literal inside ${} is missed for u (its
// escapes are still scanned), and a backtick inside a regex literal on
// the same line can flip the count — both per-line-local, never carried.
function inTemplateText(raw: string, i: number): boolean {
  let backticks = 0;
  let quote = "";
  let j = 0;
  while (j < i) {
    const ch = raw[j]!;
    if (quote !== "") {
      if (ch === "\\") j += 1;
      else if (ch === quote) quote = "";
    } else if (ch === "'" || ch === '"') {
      quote = ch;
    } else if (ch === "`") {
      let bs = 0;
      let q = j - 1;
      while (q >= 0 && raw[q] === "\\") {
        bs += 1;
        q -= 1;
      }
      if (bs % 2 === 0) backticks += 1;
    }
    j += 1;
  }
  return backticks % 2 === 1;
}

// Flags of each single-line `new RegExp(` on the line: "" when the call
// carries none. Multi-line calls, spaced calls, aliased constructors,
// variable flags and indirect patterns are misses (see PLANTED_MISS);
// quoted or commented `new RegExp(` text would false-positive.
function ctorFlags(raw: string): string[] {
  const out: string[] = [];
  let at = 0;
  for (;;) {
    const idx = raw.indexOf("new RegExp(", at);
    if (idx < 0) return out;
    at = idx + "new RegExp(".length;
    let depth = 0;
    let quote = "";
    let comma = -1;
    let closed = -1;
    let j = at;
    while (j < raw.length) {
      const ch = raw[j]!;
      if (quote !== "") {
        if (ch === "\\") j += 1;
        else if (ch === quote) quote = "";
      } else if (ch === "'" || ch === '"' || ch === "`") {
        quote = ch;
      } else if (ch === "(" || ch === "[" || ch === "{") {
        depth += 1;
      } else if (ch === ")" || ch === "]" || ch === "}") {
        if (depth === 0 && ch === ")") {
          closed = j;
          break;
        }
        depth -= 1;
      } else if (ch === "," && depth === 0 && comma < 0) {
        comma = j;
      }
      j += 1;
    }
    if (closed < 0) continue;
    if (comma < 0) {
      const arg = raw.slice(at, closed).trim();
      const lit = arg.match(/^\/(?:\\.|[^/])+\/([a-z]*)$/u);
      out.push(lit ? lit[1]! : "");
    } else {
      const flagArg = raw.slice(comma + 1, closed).trim();
      const lit = flagArg.match(/^("([a-z]*)"|'([a-z]*)')$/u);
      if (lit) out.push(lit[2] ?? lit[3] ?? "");
    }
  }
}

const PLANTED = [
  "const a = /\\w+/;",
  "const b = /\\d+/g;",
  "const c = /\\d+/u;",
  'const d = new RegExp("\\\\w-\\\\d");',
  "const e = /\\bword\\b/;",
  "const f = x.toLowerCase();",
  "const g = /[\\p{L}]+/u;",
  "const h = /\\d+/; // ASCII: machine hex",
  'const q = /"v": \\d+/.test(s);',
];

// The five forms the guard misses on purpose (round-10 finding, upheld as
// documented misses, not fixed): each pins zero hits, so any future
// hardening — or any drift that starts catching one — fails loudly here
// instead of silently changing the tripwire.
const PLANTED_MISS = [
  // 1. A string holding `// ASCII:` shields real code: marked() reads the
  // raw line, strings included.
  'const re = /\\d+/; const note = "// ASCII: nothing";',
  // 2. `RegExp (` with a space: the arg test wants `RegExp(` exactly.
  'const re = new RegExp ("\\\\w+");',
  // 3. A multi-line constructor: the scan is line-based, so the pattern
  // line never sees the `RegExp(` that opens it.
  'const re = new RegExp(\n  "\\\\w+");',
  // 4. An aliased constructor: only the name `RegExp` is recognized.
  'const R = RegExp; const re = new R("\\\\w+");',
  // 5. An indirect pattern variable: the string is not a call argument.
  // The call carries u, so the miss is the pattern's, not the flags'.
  'const pat = "\\\\w+"; const re = new RegExp(pat, "u");',
];

function runGuard(st: SelfTest): void {
  const scriptsDir = join(dirname(fileURLToPath(import.meta.url)), "..");
  const files: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith(".ts")) files.push(p);
    }
  };
  walk(scriptsDir);
  const mine = fileURLToPath(import.meta.url);
  const targets = files.filter((f) => f !== mine);
  const hits: GuardHit[] = [];
  for (const f of targets) hits.push(...scanSource(f, readFileSync(f, "utf-8")));
  const rel = (f: string): string =>
    f.startsWith(scriptsDir) ? f.slice(scriptsDir.length + 1) : f;
  st.check(
    `guard: no hand-written \\w \\d \\b \\s or case-op without ASCII: (${targets.length} files)`,
    hits.length === 0,
    hits
      .slice(0, 30)
      .map((h) => `${rel(h.file)}:${h.line}: ${h.kind} ${h.text}`)
      .join("\n"),
  );
  const got = scanSource("planted.ts", PLANTED.join("\n")).map((h) => h.line);
  st.check(
    "guard catches its planted failure",
    JSON.stringify(got) === JSON.stringify([1, 2, 3, 4, 5, 6, 9]),
    `got lines ${JSON.stringify(got)}, want [1,2,3,4,5,6,9]`,
  );
  const missed = scanSource("planted-miss.ts", PLANTED_MISS.join("\n"));
  st.check(
    "guard documents its five known misses",
    missed.length === 0,
    missed.map((h) => `${h.line}: ${h.kind} ${h.text}`).join("\n"),
  );
  st.check(
    "guard scanned the port's scripts",
    targets.some((f) => f.endsWith("tool-faults.ts")) && targets.length > 5,
    `${targets.length} files`,
  );
}

// --- entry: this module's --self-test; silent on import ---
const entryArg = process.argv[1];
if (typeof entryArg === "string" && resolve(entryArg) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.length === 1 && argv[0] === "--self-test") {
    const st = new SelfTest();
    runGoldens(st);
    runGuard(st);
    st.finish();
  } else if (argv.length === 1 && argv[0] === "--dump-golden-cases") {
    // Hidden: fixture regen only, not flow. Prints {cases, prog} for
    // scripts/fixtures/text-goldens.json (see its _note to regen).
    console.log(JSON.stringify({ cases: goldenCases(), prog: PY_GOLDEN_PROG }));
    process.exit(0);
  } else {
    console.error("usage: text.sh --self-test");
    process.exit(2);
  }
}
