// Turn a reading's notes into the passages file of a capture (see ../method.md): for each entry the
// reading note, the quotations with the mark the reader gave them, where each was read, and how sure it
// is. Entries with no quotation are kept only when they are findings of absence, which carry their
// searches. Pure core; the edge at the bottom reads a notes file and writes the passages.
//
//   bun passages.ts --notes <file> --out <file.md> [--ids <regexp>] [--intro <text>] [--drop <regexp>] [--prefix <letters>] [--always <regexp>]
import { readFileSync, writeFileSync } from "node:fs";

export type Block = { id: string; title: string; lines: string[] };

/** Split notes into `### ` blocks; text before the first block is dropped. */
export function blocks(notes: string): Block[] {
  const out: Block[] = [];
  let cur: Block | null = null;
  for (const line of notes.split("\n")) {
    const head = /^###\s+(\S+)\s*(.*)$/u.exec(line);
    if (head) {
      if (cur) out.push(cur);
      cur = { id: head[1] as string, title: (head[2] as string).trim(), lines: [] };
    } else if (/^##?\s/u.test(line)) {
      if (cur) out.push(cur);
      cur = null;
    } else if (cur) {
      cur.lines.push(line);
    }
  }
  if (cur) out.push(cur);
  return out;
}

const KEEP = /^- (finding|quote[^:]*|source|strength|checked|arithmetic[^:]*):/u;

/** The lines of a block worth keeping: finding, quotes, source, strength, and their continuations. */
export function kept(b: Block): string[] {
  const out: string[] = [];
  let on = false;
  for (const line of b.lines) {
    if (line.startsWith("- ")) on = KEEP.test(line);
    if (on) out.push(line);
  }
  return out;
}

export type Options = {
  ids?: RegExp;
  drop?: RegExp;
  /** entries kept whole, every line, even when they hold no quotation, matched against the id and the title together: a reader's summary or a table */
  always?: RegExp;
  /** number the entries `<prefix>1`, `<prefix>2`... in front of the reader's own heading, for notes whose ids repeat */
  prefix?: string;
};

export function render(bs: readonly Block[], intro: string, opt: Options = {}): string {
  const parts = [intro.trim(), ""];
  let n = 0;
  for (const b of bs) {
    if (opt.ids && !opt.ids.test(b.id)) continue;
    const always = opt.always?.test(`${b.id} ${b.title}`) === true;
    const lines = always ? b.lines.filter((l) => l.trim() !== "") : kept(b);
    if (lines.length === 0) continue;
    // a quotation line is any `- quote...:` line that says something other than n/a, whether the words are in marks or are code
    const hasQuote = lines.some((l) => /^- quote[^:]*:\s*\S/u.test(l) && !/^- quote[^:]*:\s*n\/a/u.test(l));
    const absent = lines.some((l) => /strength:\s*not found/u.test(l));
    if (!hasQuote && !absent && !always) continue;
    n += 1;
    parts.push((opt.prefix ? `### ${opt.prefix}${n} ${b.id} ${b.title}` : `### ${b.id} ${b.title}`).trim());
    const text = lines.filter((l) => !(opt.drop && opt.drop.test(l)));
    parts.push(...text, "");
  }
  return `${parts.join("\n").replace(/\n{3,}/gu, "\n\n").trimEnd()}\n`;
}

function main(): void {
  const args = process.argv.slice(2);
  const value = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const notes = value("--notes");
  const out = value("--out");
  if (!notes || !out) {
    process.stderr.write("usage: bun passages.ts --notes <file> --out <file.md> [--ids <re>] [--intro <text>] [--drop <re>]\n");
    process.exit(2);
  }
  const ids = value("--ids");
  const drop = value("--drop");
  const prefix = value("--prefix");
  const always = value("--always");
  const text = render(blocks(readFileSync(notes, "utf8")), value("--intro") ?? "# Passages", {
    ids: ids ? new RegExp(ids, "u") : undefined,
    drop: drop ? new RegExp(drop, "u") : undefined,
    prefix,
    always: always ? new RegExp(always, "u") : undefined,
  });
  writeFileSync(out, text);
}

if (import.meta.main) main();
