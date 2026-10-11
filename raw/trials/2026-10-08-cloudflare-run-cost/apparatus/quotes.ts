// Check that every quotation in a reading's notes appears in the page text it cites (see ../method.md).
// The notes are entries of the shape
//
//   ### <id> <title>
//   - quote: "<words>" (verbatim) ; "<more words>" (verbatim, partial)
//   - source: <url> ; docs/<path>.mdx@<commit> lines a-b ; read <date>
//
// A quotation is found when its words, with markup and white space removed, are a substring of one of the
// cited files with the same removed. Pure core; the edge at the bottom reads a notes file and a folder of
// page text.
//
//   bun quotes.ts --notes <file> --root <src/content folder> [--out <file.md>]
//   bun quotes.ts --page <file.md> --capture <passages.md> [--capture <passages.md> ...]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Words only: markdown links, emphasis, code ticks, quotes, dashes and white space made alike. */
export function normalize(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/<\/?[A-Za-z][^<>\n]{0,200}>/gu, " ")
    .replace(/[`*_|\\]/gu, "")
    .replace(/[‘’]/gu, "'")
    .replace(/[“”]/gu, '"')
    .replace(/[–—]/gu, "-")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

export type Entry = { id: string; quotes: string[]; paths: string[] };

/** The quoted strings of 15 characters or more on an entry's quote lines, split at an ellipsis. */
export function quotesOf(lines: readonly string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    for (const m of line.matchAll(/"((?:[^"\\]|\\.){15,}?)"/gu)) {
      for (const part of (m[1] as string).split(/\.\.\.|…/u)) {
        if (part.trim().length >= 15) out.push(part.trim());
      }
    }
  }
  return out;
}

/** The repository paths on an entry's source lines, `docs/...@sha`, `partials/...@sha`, `changelog/...@sha`. */
export function pathsOf(lines: readonly string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    for (const m of line.matchAll(/((?:docs|partials|changelog)\/[A-Za-z0-9_./-]+\.mdx?)(?:@[0-9a-f]{7,}|:[0-9])/gu)) {
      out.push(m[1] as string);
    }
  }
  return [...new Set(out)];
}

/** Split a notes file into entries; the quote and source lines run on until the next bullet. */
export function parse(notes: string): Entry[] {
  const entries: Entry[] = [];
  let id = "";
  let quote: string[] = [];
  let source: string[] = [];
  let mode: "quote" | "source" | "" = "";
  const flush = (): void => {
    if (id) entries.push({ id, quotes: quotesOf(quote), paths: pathsOf(source) });
    quote = [];
    source = [];
    mode = "";
  };
  for (const line of notes.split("\n")) {
    const head = /^###\s+(\S+)/u.exec(line);
    if (head) {
      flush();
      id = head[1] as string;
      continue;
    }
    if (/^- quote[^:]*:/u.test(line)) {
      mode = "quote";
      quote.push(line);
    } else if (line.startsWith("- source:")) {
      mode = "source";
      source.push(line);
    } else if (line.startsWith("- ")) {
      mode = "";
    } else if (mode === "quote") quote.push(line);
    else if (mode === "source") source.push(line);
  }
  flush();
  return entries;
}

export type Result = { id: string; quote: string; found: boolean; checked: boolean };

/** Find each quotation in the files its entry cites. An entry citing no file of the folder is not checked. */
export function check(entries: readonly Entry[], read: (path: string) => string | null): Result[] {
  const out: Result[] = [];
  for (const e of entries) {
    const texts = e.paths.flatMap((p) => {
      const t = read(p);
      return t === null ? [] : [normalize(t)];
    });
    for (const q of e.quotes) {
      const n = normalize(q);
      out.push({ id: e.id, quote: q, checked: texts.length > 0, found: texts.some((t) => t.includes(n)) });
    }
  }
  return out;
}

/**
 * The double-quoted strings of 20 characters or more in a page, split at an ellipsis. A bullet, a numbered
 * item or a table row is one unit, so a quotation that wraps onto the next line is read whole; the page's
 * front matter is skipped. Quotation marks are paired from the left within a unit whatever their length,
 * so a short quotation cannot throw off the pairing of a long one.
 */
export function pageQuotes(page: string): string[] {
  const body = page.replace(/^---[\s\S]*?\n---/u, "");
  const units: string[] = [];
  for (const line of body.split("\n")) {
    const startsItem = /^\s*([-*]|[0-9]+\.)\s|^\s*\||^\s*#|^\s*$/u.test(line);
    if (startsItem || units.length === 0) units.push(line);
    else units[units.length - 1] += ` ${line.trim()}`;
  }
  const out: string[] = [];
  for (const unit of units) {
    for (const m of unit.matchAll(/"([^"]*)"/gu)) {
      for (const part of (m[1] as string).split(/\.\.\./u)) {
        if (normalize(part).length >= 20) out.push(part);
      }
    }
  }
  return out;
}

/** Which of a page's quotations are not words of any of the given texts. */
export function notInCorpus(quotes: readonly string[], texts: readonly string[]): string[] {
  const corpus = normalize(texts.join("\n"));
  return quotes.filter((q) => !corpus.includes(normalize(q)));
}

export function report(results: readonly Result[]): string {
  const checked = results.filter((r) => r.checked);
  const found = checked.filter((r) => r.found);
  const lines = [
    `${results.length} quotations, ${checked.length} in an entry that cites a file of the repository text, ${found.length} of those found in it.`,
    "",
  ];
  const missed = checked.filter((r) => !r.found);
  if (missed.length > 0) {
    lines.push("Not found in the cited file (to be read by hand):", "");
    for (const r of missed) lines.push(`- ${r.id}: "${r.quote.slice(0, 160)}"`);
  }
  return `${lines.join("\n")}\n`;
}

function main(): void {
  const args = process.argv.slice(2);
  const value = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const page = value("--page");
  if (page) {
    const captures = args.flatMap((a, i) => (a === "--capture" && args[i + 1] ? [args[i + 1] as string] : []));
    const texts = captures.map((c) => readFileSync(c, "utf8"));
    const quotes = pageQuotes(readFileSync(page, "utf8"));
    const missing = notInCorpus(quotes, texts);
    process.stdout.write(`${quotes.length} quotations in the page, ${quotes.length - missing.length} found in a capture.\n`);
    for (const m of missing) process.stdout.write(`- not found: "${m.slice(0, 160)}"\n`);
    return;
  }
  const notes = value("--notes");
  const root = value("--root");
  const out = value("--out");
  if (!notes || !root) {
    process.stderr.write("usage: bun quotes.ts --notes <file> --root <src/content folder> [--out <file.md>]\n");
    process.exit(2);
  }
  const read = (p: string): string | null => {
    const path = join(root, p);
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  };
  const text = report(check(parse(readFileSync(notes, "utf8")), read));
  if (out) writeFileSync(out, text);
  else process.stdout.write(text);
}

if (import.meta.main) main();
