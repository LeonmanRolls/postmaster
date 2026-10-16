// The menu of a whole project's libraries, for scripts/api-index.ts --all. A project uses a few
// dozen libraries, and the full map of every one is far more than a clerk can read (the maps of
// eighty-eight libraries came to about 390,000 tokens, most of it icon sets and one chain library).
// So the menu has three parts, small enough to read whole:
//
//   1. a directory of every library the project uses: its version, how many names it has, how many
//      of the names nearest the draft are its own, the best of them, and the file that holds its
//      own menu (its nearest entries, then a map of every name);
//   2. every function and method of every library, by library: the names, no signatures;
//   3. the names nearest the draft across all of the libraries, with signature and doc comment.
//
// The clerk reads the three parts, then the own menu of every library that shows names near the
// draft and of every library the change touches. It lists none of this in the ticket.
import {
  type Candidate,
  type IndexEntry,
  cell,
  ownerWords,
  rank,
  rowOf,
  wrapWords,
} from "./index-match.ts";
import type { Pkg } from "./package-types.ts";

export interface Library {
  /** The name the project's manifests give it. */
  readonly name: string;
  /** The package and the packages of its family that were read with it; empty when none was found. */
  readonly packages: readonly Pkg[];
  /** Every name in it, one entry for each symbol and kind. */
  readonly entries: readonly IndexEntry[];
  /** The file that holds its own menu, when it has entries. */
  readonly menuFile?: string;
  /** Why it has no entries: no declaration files, or it could not be found. */
  readonly note?: string;
}

export interface LibraryHits {
  /** How many of the names nearest the draft are the library's own. */
  readonly count: number;
  /** The library's three names nearest the draft, wherever they stand in the whole ranking. */
  readonly best: readonly string[];
  /** The score of the best of them: names of different libraries are scored on one scale. */
  readonly score: number;
}

const keyOf = (e: IndexEntry): string => `${e.file}\u0000${e.symbol}\u0000${e.kind}`;

/**
 * The names nearest the draft across every library, scored on one scale. `show` of them are
 * returned as the ranked rows. Each library gets its three best names wherever they stand, the
 * score of the best, and how many of its names are among the `top` nearest, so that a library that
 * has only a few names near the draft shows them even when another library has hundreds.
 */
export function rankAcross(
  libs: readonly Library[],
  vocab: ReadonlyMap<string, number>,
  top = 300,
  show = 60,
): { rows: Candidate[]; hits: Map<string, LibraryHits> } {
  const seen = new Set<string>();
  const union: IndexEntry[] = [];
  const libOf = new Map<IndexEntry, string>();
  for (const lib of libs) {
    for (const e of lib.entries) {
      const k = keyOf(e);
      if (seen.has(k)) continue;
      seen.add(k);
      union.push(e);
      libOf.set(e, lib.name);
    }
  }
  const ranked = rank(union, vocab, union.length, 0);
  const counts = new Map<string, { count: number; best: string[]; score: number }>();
  ranked.forEach((c, i) => {
    const name = libOf.get(c.entry);
    if (name === undefined) return;
    const got = counts.get(name) ?? { count: 0, best: [], score: c.score };
    if (i < top) got.count += 1;
    if (got.best.length < 3) got.best.push(c.entry.symbol);
    counts.set(name, got);
  });
  return { rows: ranked.slice(0, show), hits: counts };
}

const CALLABLE = new Set(["function", "method", "hook"]);

/**
 * Every function and method of every library, by library: `Owner{method(), other()}` for the
 * methods of an owner, `fn()` for a function that stands alone. Names only, so that all of them
 * can be read; a library with no functions has no line.
 */
export function functionsIndex(libs: readonly Library[], width = 150): string[] {
  const out: string[] = [];
  for (const lib of [...libs].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const calls = lib.entries
      .filter((e) => CALLABLE.has(e.kind))
      .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));
    if (calls.length === 0) continue;
    out.push(lib.name, ...wrapWords(ownerWords(calls), width));
  }
  return out;
}

export interface StackHeader {
  readonly title: string;
  readonly vocabularyKey: string;
}

function directoryRow(lib: Library, hits: ReadonlyMap<string, LibraryHits>): string {
  const main = lib.packages[0];
  const h = hits.get(lib.name);
  const description = main?.description ?? "";
  const where =
    lib.menuFile ?? (main ? `${lib.note ?? "no entries"} (${main.dir})` : (lib.note ?? ""));
  return [
    lib.name,
    main?.version ?? "-",
    String(lib.entries.length),
    String(h?.count ?? 0),
    h && h.best.length > 0 ? h.best.map((s) => cell(s).slice(0, 60)).join(", ") : "-",
    cell(where),
    cell(description).slice(0, 110),
  ].join("\t");
}

/** The stack menu as the text of a file. */
export function formatStack(
  header: StackHeader,
  libs: readonly Library[],
  hits: ReadonlyMap<string, LibraryHits>,
  rows: readonly Candidate[],
): string {
  const withEntries = libs.filter((l) => l.entries.length > 0);
  const total = libs.reduce((sum, l) => sum + l.entries.length, 0);
  const out: string[] = [
    `# ${header.title}`,
    `# ${libs.length} libraries, ${withEntries.length} with declarations, ${total} names in all`,
    `# draft-vocabulary ${header.vocabularyKey}`,
    "#",
    "# 1. EVERY LIBRARY THE PROJECT USES, the ones with names near the draft first.",
    "# matches = how many of the 300 names nearest the draft are the library's own; best matches = its three nearest names, whatever its matches;",
    "# menu = the file in the folder beside this one with its own menu (its nearest entries, then a map of every name): read it for every library",
    "# that shows names near the draft and for every library the change touches.",
    "# library\tversion\tnames\tmatches\tbest matches\tmenu\tdescription",
  ];
  const order = [...libs].sort((a, b) => {
    const x = hits.get(a.name);
    const y = hits.get(b.name);
    if ((y?.count ?? 0) !== (x?.count ?? 0)) return (y?.count ?? 0) - (x?.count ?? 0);
    if ((y?.score ?? 0) !== (x?.score ?? 0)) return (y?.score ?? 0) - (x?.score ?? 0);
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
  for (const lib of order) out.push(directoryRow(lib, hits));
  out.push(
    "#",
    "# 2. EVERY FUNCTION AND METHOD OF EVERY LIBRARY, by library: Owner{method()} lists the methods of an owner",
  );
  for (const line of functionsIndex(libs))
    out.push(line.startsWith(" ") ? `#${line}` : `# ${line}`);
  out.push("#", "# 3. THE NAMES NEAREST THE DRAFT ACROSS EVERY LIBRARY");
  out.push("# symbol\tkind\tsignature\tdoc\twhere\tmatched");
  for (const c of rows) out.push(rowOf(c.entry, c.matched));
  return `${out.join("\n")}\n`;
}
