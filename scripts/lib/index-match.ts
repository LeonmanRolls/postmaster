// The shared parts of the two index commands, scripts/api-index.ts and scripts/code-index.ts: the
// entry both print, the words of a ticket draft, the ranking of entries against those words, the
// map of every name, and the tab-separated file in which a menu is saved for the clerk to read and
// for scripts/ticket-capabilities.ts to check.
//
// An index holds every exported function and every setting of a library, or every exported helper
// of the project's own code. A menu is what the clerk reads while it plans: the entries that share
// words with the draft, one line each with the signature and the doc comment, and then a map of
// every name in the index, so that it knows all of what is available and not only what it happened
// to read. The words are stems of the identifiers (split at camel case and underscores) and of the
// doc comments, so a ticket that says "cookie" meets `cross_subdomain_cookie` and a ticket that says
// "persists" meets `persistence`. Matching on stems is a net, not a proof; the map is what covers
// the names it misses. The ticket does not list the names: the clerk needs to know them, not repeat
// them.
import { createHash } from "node:crypto";
import { VERIFIED_RE, agentsIndex, level3Sections, normalizeTicket } from "./ticket-sections.ts";

export interface IndexEntry {
  /** `Name`, or `Owner.member`, or `Owner.member.nested`. */
  readonly symbol: string;
  readonly kind: string;
  readonly signature: string;
  /** The first sentence of the doc comment, "(deprecated) " in front when it is. */
  readonly doc: string;
  readonly file: string;
  readonly line: number;
}

export interface Candidate {
  readonly entry: IndexEntry;
  readonly matched: readonly string[];
  readonly score: number;
}

// ASCII: identifiers and the plain words of a ticket are ASCII, so folding their case is the intent.
const fold = (s: string): string => s.toLowerCase();

const STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "into",
  "when",
  "then",
  "than",
  "them",
  "they",
  "their",
  "there",
  "these",
  "those",
  "have",
  "has",
  "had",
  "are",
  "was",
  "were",
  "been",
  "being",
  "not",
  "but",
  "can",
  "could",
  "will",
  "would",
  "should",
  "shall",
  "may",
  "might",
  "must",
  "all",
  "any",
  "each",
  "every",
  "some",
  "such",
  "only",
  "also",
  "which",
  "what",
  "where",
  "who",
  "whom",
  "whose",
  "how",
  "why",
  "its",
  "his",
  "her",
  "our",
  "your",
  "you",
  "one",
  "two",
  "get",
  "set",
  "use",
  "used",
  "using",
  "uses",
  "default",
  "defaults",
  "value",
  "values",
  "true",
  "false",
  "null",
  "undefined",
  "string",
  "number",
  "boolean",
  "object",
  "function",
  "type",
  "types",
  "option",
  "options",
  "config",
  "optional",
  "return",
  "returns",
  "returned",
  "whether",
  "instead",
  "after",
  "before",
  "until",
  "while",
  "does",
  "doing",
  "done",
  "just",
  "like",
  "make",
  "makes",
  "made",
  "new",
  "old",
  "via",
  "per",
  "see",
  "note",
  "example",
  "etc",
  "yes",
  "something",
  "anything",
  "nothing",
  "more",
  "most",
  "less",
  "other",
  "another",
  "same",
  "about",
  "over",
  "under",
  "again",
  "still",
  "even",
  "without",
  "within",
  "between",
  "both",
]);

// Longest first. A suffix comes off only when four letters or more are left.
const SUFFIXES = [
  "ations",
  "ation",
  "ments",
  "ment",
  "ences",
  "ence",
  "ances",
  "ance",
  "ating",
  "ated",
  "ates",
  "ate",
  "ings",
  "ing",
  "ies",
  "ers",
  "er",
  "es",
  "ed",
  "ly",
  "s",
];

/** A rough stem: "capturing" and "capture" meet, as do "persistence" and "persisted". */
export function stem(word: string): string {
  let w = word;
  for (const suffix of SUFFIXES) {
    if (w.length - suffix.length >= 4 && w.endsWith(suffix)) {
      w = suffix === "ies" ? `${w.slice(0, -2)}` : w.slice(0, -suffix.length);
      break;
    }
  }
  if (w.length > 4 && w.endsWith("e")) w = w.slice(0, -1);
  if (w.length > 4 && (w.endsWith("i") || w.endsWith("y"))) w = w.slice(0, -1);
  return w;
}

/** The lower-case words of a text, split at camel case, underscores, dots and anything not a letter or digit. */
export function splitWords(text: string): string[] {
  const spaced = text
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/gu, "$1 $2")
    .replace(/[^A-Za-z0-9]+/gu, " ");
  return fold(spaced)
    .split(" ")
    .filter((w) => w !== "");
}

/** The stems of the words a text means, without the common ones. */
export function terms(text: string): string[] {
  return splitWords(text)
    .filter((w) => w.length >= 3 && !STOP.has(w) && !/^[0-9]+$/u.test(w))
    .map(stem)
    .filter((w) => w.length >= 3);
}

/** Stem to the number of times the text says it. */
export function vocabulary(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of terms(text)) out.set(t, (out.get(t) ?? 0) + 1);
  return out;
}

/** A short key for the set of words: it changes when the draft gains or loses a word, not when it repeats one. */
export function vocabularyKey(vocab: ReadonlyMap<string, number>): string {
  const words = [...vocab.keys()].sort();
  return createHash("sha256").update(words.join("\n")).digest("hex").slice(0, 12);
}

/**
 * The entries nearest the vocabulary, best first. A word counts three times in the symbol and once
 * in the doc comment or the path, and counts more the fewer entries carry it, so "cookie" in
 * forty entries weighs less than "subdomain" in two. Only the five best words of an entry count, so
 * that a long doc comment does not win by size.
 */
export function rank(
  entries: readonly IndexEntry[],
  vocab: ReadonlyMap<string, number>,
  max: number,
  family = 80,
): Candidate[] {
  const bags = entries.map((e) => ({
    sym: new Set(terms(e.symbol)),
    doc: new Set(terms(e.doc)),
    file: new Set(terms(e.file)),
  }));
  const df = new Map<string, number>();
  for (const b of bags) {
    for (const t of new Set([...b.sym, ...b.doc, ...b.file])) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const n = entries.length;
  // A word that a large share of the entries carry, such as the library's own name, tells nothing.
  const common = (t: string): boolean => (df.get(t) ?? 0) > Math.max(25, n * 0.12);
  const out: Candidate[] = [];
  entries.forEach((entry, i) => {
    const b = bags[i];
    const parts: Array<[string, number]> = [];
    for (const [t, tf] of vocab) {
      if (common(t)) continue;
      const weight = b.sym.has(t) ? 3 : b.doc.has(t) ? 1 : b.file.has(t) ? 0.5 : 0;
      if (weight === 0) continue;
      const idf = Math.log(1 + n / (df.get(t) ?? 1));
      parts.push([t, weight * idf * (1 + Math.log(tf))]);
    }
    if (parts.length === 0) return;
    parts.sort((x, y) => y[1] - x[1]);
    const best = parts.slice(0, 5);
    // A name that shares two of the draft's words is a stronger sign than a doc comment that shares four.
    const inName = parts.filter((p) => bags[i].sym.has(p[0])).length;
    out.push({
      entry,
      matched: best.map((p) => p[0]),
      score: best.reduce((sum, p) => sum + p[1], 0) * (inName >= 2 ? 1.5 : 1),
    });
  });
  out.sort((x, y) => y.score - x.score);
  const top = out.slice(0, max);
  // The entries that share a name word with the draft are a family: if the draft talks of
  // cookies, every setting with "cookie" in its name is listed, so that the one the ranking put
  // low is not missed. A word counts when the draft says it twice or more and few names carry it.
  const symDf = new Map<string, number>();
  for (const b of bags) for (const t of b.sym) symDf.set(t, (symDf.get(t) ?? 0) + 1);
  const kin = (t: string): boolean =>
    (vocab.get(t) ?? 0) >= 2 && (symDf.get(t) ?? 0) <= 30 && !common(t);
  // The words the draft says most are taken first, each with its whole family, until the limit.
  const extra: Candidate[] = [];
  const rest = out.slice(max);
  const words = [...vocab].filter(([t]) => kin(t)).sort((x, y) => y[1] - x[1]);
  for (const [word] of words) {
    for (const c of rest) {
      if (extra.length >= family) break;
      if (extra.includes(c)) continue;
      if (bags[entries.indexOf(c.entry)].sym.has(word)) extra.push(c);
    }
  }
  return top.concat(extra);
}

/**
 * What a ticket draft says: all of it except the two sections the clerk writes about the
 * libraries themselves, `### Existing capabilities` and `### Verified at`. The plain part says what
 * is needed in plain words ("nothing is stored on their device"); the agents' part names the
 * mechanisms ("cookie", "persistence"), and it is the mechanisms that an index lists. The two left
 * out would only point back at what the clerk has already looked at. A first line that starts
 * `DRAFT:` is left out too: removing it at sign-off must not make a list old.
 */
export function draftText(ticket: string): string {
  const lines = normalizeTicket(ticket).split("\n");
  const drop = new Set<number>();
  // A first line that starts DRAFT: is a marker the clerk removes at sign-off, not part of the draft.
  const first = lines.findIndex((l) => l.trim() !== "");
  if (first >= 0 && (lines[first] as string).startsWith("DRAFT:")) drop.add(first);
  const at = agentsIndex(lines);
  if (at < 0) return lines.filter((_, i) => !drop.has(i)).join("\n");
  for (const s of level3Sections(lines, at + 1)) {
    if (/^existing capabilities$/iu.test(s.title) || VERIFIED_RE.test(s.title)) {
      for (let i = s.at; i < s.end; i++) drop.add(i);
    }
  }
  return lines.filter((_, i) => !drop.has(i)).join("\n");
}

/** The last name of a symbol: `PostHogConfig.cross_subdomain_cookie` is `cross_subdomain_cookie`. */
export function leafOf(symbol: string): string {
  const parts = symbol.split(".");
  return parts[parts.length - 1] ?? symbol;
}

const cell = (s: string): string => s.replace(/[\t\n\r]+/gu, " ").trim();

export interface Header {
  /** A line of text to print first, such as which package and version. */
  readonly title: string;
  /** The draft's vocabulary key, when the list was ranked against a draft. */
  readonly vocabularyKey?: string;
  /** How many entries the index held in all. */
  readonly total: number;
}

// A function, method or hook is written with a call mark; anything else by its bare name.
const CALLABLE = new Set(["function", "method", "hook"]);
const mark = (name: string, kind: string): string => (CALLABLE.has(kind) ? `${name}()` : name);

/**
 * Every name in the index, grouped by the file that declares it and, within a file, by owner:
 * `Owner{member, method(), nested.member}`. A function, method or hook ends in `()`. The lines
 * are wrapped at `width` characters, indented under the file's name, so that a long list of
 * settings is read in pages. It is the whole API in a few pages: no signature or doc for each
 * name, only which names there are and what each belongs to. A re-export is left out: its name is
 * listed where it is declared.
 */
export function overview(entries: readonly IndexEntry[], width = 150): string[] {
  const byFile = new Map<string, IndexEntry[]>();
  for (const e of entries) {
    if (e.kind === "re-export") continue;
    const list = byFile.get(e.file);
    if (list === undefined) byFile.set(e.file, [e]);
    else list.push(e);
  }
  const out: string[] = [];
  for (const file of [...byFile.keys()].sort()) {
    const inFile = [...(byFile.get(file) as IndexEntry[])].sort((a, b) => a.line - b.line);
    const owners: string[] = [];
    const heads = new Map<string, IndexEntry>();
    const members = new Map<string, string[]>();
    for (const e of inFile) {
      const dot = e.symbol.indexOf(".");
      const owner = dot < 0 ? e.symbol : e.symbol.slice(0, dot);
      if (!heads.has(owner) && !members.has(owner)) owners.push(owner);
      if (dot < 0) {
        if (!heads.has(owner)) heads.set(owner, e);
      } else {
        const list = members.get(owner) ?? [];
        const name = mark(e.symbol.slice(dot + 1), e.kind);
        if (!list.includes(name)) list.push(name);
        members.set(owner, list);
      }
    }
    // One word at a time, so that an owner with two hundred members wraps like everything else.
    const words: string[] = [];
    for (const owner of owners) {
      const head = heads.get(owner);
      const label = head === undefined ? owner : mark(owner, head.kind);
      const list = members.get(owner);
      if (list === undefined) {
        words.push(label);
      } else {
        words.push(`${label}{${list[0]}`, ...list.slice(1));
        words[words.length - 1] += "}";
      }
    }
    out.push(file);
    let line = " ";
    words.forEach((word, i) => {
      const piece = i < words.length - 1 ? `${word},` : word;
      if (line.length > 1 && line.length + 1 + piece.length > width) {
        out.push(line);
        line = " ";
      }
      line += ` ${piece}`;
    });
    out.push(line);
  }
  return out;
}

/**
 * The file a menu is saved in: `#` header lines, then one ranked entry per line, cells separated by
 * tabs, then, when `names` is given, the map of every name in the index as `#` lines. Every line
 * that is not a ranked entry starts with `#`, so a reader of the entries skips the rest.
 */
export function formatList(
  header: Header,
  rows: ReadonlyArray<{ entry: IndexEntry; matched?: readonly string[] }>,
  names?: readonly IndexEntry[],
): string {
  const out: string[] = [`# ${header.title}`];
  out.push(`# entries in the index: ${header.total}; listed: ${rows.length}`);
  if (header.vocabularyKey !== undefined) out.push(`# draft-vocabulary ${header.vocabularyKey}`);
  out.push("# symbol\tkind\tsignature\tdoc\twhere\tmatched");
  for (const { entry, matched } of rows) {
    out.push(
      [
        cell(entry.symbol),
        entry.kind,
        cell(entry.signature),
        cell(entry.doc),
        `${entry.file}:${entry.line}`,
        (matched ?? []).join(" "),
      ].join("\t"),
    );
  }
  if (names !== undefined) {
    out.push("#");
    out.push(
      "# every name in the index, by file: Owner{members} lists what an owner has, name() is a function or method",
    );
    for (const line of overview(names)) out.push(`# ${line}`);
  }
  return `${out.join("\n")}\n`;
}

export interface ParsedList {
  readonly vocabularyKey: string | null;
  readonly symbols: readonly string[];
}

/** Read a saved list back: the vocabulary key it was made against and the symbols it names. */
export function parseList(text: string): ParsedList {
  let key: string | null = null;
  const symbols: string[] = [];
  for (const line of text.split("\n")) {
    if (line === "") continue;
    if (line.startsWith("#")) {
      const m = /^#[ \t]*draft-vocabulary[ \t]+([0-9a-f]+)/u.exec(line);
      if (m) key = m[1];
      continue;
    }
    const symbol = line.split("\t")[0];
    if (symbol) symbols.push(symbol);
  }
  return { vocabularyKey: key, symbols };
}
