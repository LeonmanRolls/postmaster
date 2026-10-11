// The agents part's sections, read one way for the readiness check, the cut and
// the premises check. ticket-parts, ticket-cut and premises all import this
// module: the cut and the premises check read the agents part exactly as the
// readiness check does, so a ticket the check accepted cannot keep its notes
// through a cut, or skip its premises check, that reads them another way.
const FENCE = "```";

/**
 * Ticket text as the readiness check reads it: without a byte-order mark and
 * with CRLF endings folded to LF, so headings match whatever produced them.
 */
export function normalizeTicket(text: string): string {
  return text.replace(/^\uFEFF/u, "").replace(/\r\n/gu, "\n");
}

export function isFence(line: string): boolean {
  return line.trimStart().startsWith(FENCE);
}

export function fenceMap(lines: string[], from: number, to: number): boolean[] {
  const map: boolean[] = [];
  let inside = false;
  for (let i = from; i < to; i++) {
    if (isFence(lines[i]!)) {
      map.push(true);
      inside = !inside;
    } else {
      map.push(inside);
    }
  }
  return map;
}

const AGENTS_RE = /^##[ \t]+for the agents[ \t]*$/iu;

/** Index of the `## For the agents` heading, or -1 when the text has none. */
export function agentsIndex(lines: string[]): number {
  return lines.findIndex((l) => AGENTS_RE.test(l));
}

const JOURNEY_RE = /^user journey$/iu;

/**
 * Where the agents part ends: the next unfenced `##` heading at or after
 * `from` that is not the ticket's own `## User journey`, or the end of the
 * lines. A fenced `##` line is never a heading, and the journey holds ticket
 * content, so neither ends the part.
 */
export function agentsEnd(lines: string[], from: number): number {
  const fenced = fenceMap(lines, from, lines.length);
  for (let i = from; i < lines.length; i++) {
    if (fenced[i - from]) continue;
    const m = /^##[ \t]+(.*?)[ \t]*$/u.exec(lines[i]!);
    if (m && !JOURNEY_RE.test(m[1]!)) return i;
  }
  return lines.length;
}

export type Level3Section = { title: string; at: number; end: number };

/**
 * The level-3 sections from line index `from` to the end: each runs to the
 * next heading of level 3 or above. Fenced lines are never headings.
 */
export function level3Sections(lines: string[], from: number): Level3Section[] {
  const fenced = fenceMap(lines, from, lines.length);
  const isFenced = (i: number): boolean => fenced[i - from]!;
  const heads: Array<{ level: number; title: string; at: number }> = [];
  for (let i = from; i < lines.length; i++) {
    if (isFenced(i)) continue;
    const m = /^(#{1,3})[ \t]+(.*?)[ \t]*$/u.exec(lines[i]!);
    if (m) heads.push({ level: m[1]!.length, title: m[2]!, at: i });
  }
  return heads
    .map((h, j) => ({
      level: h.level,
      title: h.title,
      at: h.at,
      end: heads[j + 1]?.at ?? lines.length,
    }))
    .filter((s) => s.level === 3);
}

export const TECH_NOTES_RE = /^technical notes$/iu;
export const VERIFIED_RE = /^verified at(?:[ \t]|$)/iu;

/**
 * The `### Verified at` section below the agents heading at `from`, or
 * undefined when the text has none. Fenced headings are never sections.
 */
export function verifiedSection(lines: string[], from: number): Level3Section | undefined {
  if (from < 0) return undefined;
  return level3Sections(lines, from + 1).find((s) => VERIFIED_RE.test(s.title));
}

/**
 * The commit a Verified-at section title carries, as the readiness check
 * reads it: the title past the words, a commit of 7 to 40 hex characters of
 * either case, or "" when it carries none.
 */
export function verifiedAtSha(title: string): string {
  const sha = title.replace(/^verified at/iu, "").trim();
  return /^[0-9a-f]{7,40}$/iu.test(sha) ? sha : "";
}
