// The pace of tickets, counted from the project's merged pull requests (see ../method.md): for each UTC merge day, how
// many were merged and how many carry a ticket number at the start of their title. The core is pure. The edge reads a
// tab-separated file of merge time and title, as `gh api` prints it, and writes the counts only, so no title is kept.
//
//   gh api --paginate "repos/<owner>/<repo>/pulls?state=closed&per_page=100" \
//     --jq '.[] | select(.merged_at != null) | "\(.merged_at)\t\(.title)"' > merged.tsv
//   bun pace.ts --in merged.tsv --read 2026-10-11 --out ../results/pace.json
import { readFileSync, writeFileSync } from "node:fs";

export type DayCounts = { merged: number; ticketTitled: number };
export type Merged = { mergedAt: string; title: string };

/** A title that starts with a ticket number and a comma, the form a run's pull request is given. */
export const isTicketTitled = (title: string): boolean => /^#\d+,/u.test(title);

/** Merged and ticket-titled counts for each UTC merge day, in day order. */
export function countByDay(rows: readonly Merged[]): Record<string, DayCounts> {
  const days = new Map<string, DayCounts>();
  for (const r of rows) {
    const day = r.mergedAt.slice(0, 10);
    const entry = days.get(day) ?? { merged: 0, ticketTitled: 0 };
    entry.merged += 1;
    if (isTicketTitled(r.title)) entry.ticketTitled += 1;
    days.set(day, entry);
  }
  return Object.fromEntries([...days.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Lines of `<merge time><TAB><title>`; a line without a tab or a time is left out. */
export function parseTsv(text: string): Merged[] {
  return text.split("\n").flatMap((line): Merged[] => {
    const tab = line.indexOf("\t");
    if (tab < 0) return [];
    const mergedAt = line.slice(0, tab);
    return /^\d{4}-\d{2}-\d{2}T/u.test(mergedAt) ? [{ mergedAt, title: line.slice(tab + 1) }] : [];
  });
}

/** The sum of one count over the days from `from` to `to`, both included. */
export function windowCount(days: Readonly<Record<string, DayCounts>>, from: string, to: string, key: keyof DayCounts): number {
  return Object.entries(days)
    .filter(([d]) => d >= from && d <= to)
    .reduce((a, [, c]) => a + c[key], 0);
}

/** Whether no day has more ticket-titled pull requests than pull requests. */
export const consistent = (days: Readonly<Record<string, DayCounts>>): boolean =>
  Object.values(days).every((c) => c.ticketTitled <= c.merged);

if (import.meta.main) {
  const arg = (name: string): string | undefined => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const input = arg("--in");
  const out = arg("--out");
  const read = arg("--read");
  if (!input || !out || !read) {
    process.stderr.write("usage: bun pace.ts --in <merged.tsv> --read <YYYY-MM-DD> --out <pace.json>\n");
    process.exit(2);
  }
  const days = countByDay(parseTsv(readFileSync(input, "utf8")));
  const file = {
    read,
    source:
      "the project's closed pull requests on GitHub, read through its REST API: those with a merge time, counted by UTC merge day",
    how: "a pull request is ticket-titled when its title starts with a ticket number and a comma; no title or number is kept here",
    note: "A count of merged pull requests is not a count of runs. It includes hand-made hotfixes, research and documentation pull requests, and it leaves out runs that were set aside or never merged. It is a second reading of the pace beside the audited runs, not a bound on it.",
    days,
  };
  writeFileSync(out, `${JSON.stringify(file, null, 2)}\n`);
  process.stdout.write(`wrote ${out}: ${Object.keys(days).length} days\n`);
}
