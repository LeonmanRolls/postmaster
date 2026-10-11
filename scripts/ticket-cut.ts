// Cut a ticket's technical notes for a run that works without them: print the
// ticket without its `### Technical notes` and `### Verified at` sections.
//
//   run ticket-cut <ticket-file>
//
// Reads the two sections as the readiness check does (scripts/lib/ticket-sections.ts):
// the level-3 sections below `## For the agents`, case-insensitively, skipping
// fenced blocks, each running to the next heading of level 3 or above, over text
// normalized as the check normalizes it. Every other line prints in order. A ticket
// with no `## For the agents` prints unchanged.
//
//   exit 0  the cut ticket is on stdout
//   exit 1  usage or an unreadable file
import { readFileSync } from "node:fs";
import {
  TECH_NOTES_RE,
  VERIFIED_RE,
  agentsIndex,
  level3Sections,
  normalizeTicket,
} from "./lib/ticket-sections.ts";

export function cutTicketNotes(text: string): string {
  const clean = normalizeTicket(text);
  const lines = clean.split("\n");
  const ai = agentsIndex(lines);
  if (ai < 0) return clean;
  const drop = new Set<number>();
  for (const s of level3Sections(lines, ai + 1)) {
    if (TECH_NOTES_RE.test(s.title) || VERIFIED_RE.test(s.title)) {
      for (let i = s.at; i < s.end; i++) drop.add(i);
    }
  }
  if (drop.size === 0) return clean;
  return lines.filter((_, i) => !drop.has(i)).join("\n");
}

function main(argv: string[]): number {
  if (argv.length !== 1) {
    console.error("usage: run ticket-cut <ticket-file>");
    return 1;
  }
  let text: string;
  try {
    text = readFileSync(argv[0]!, "utf8");
  } catch {
    console.error(`ticket-cut: cannot read ${argv[0]}`);
    return 1;
  }
  process.stdout.write(cutTicketNotes(text));
  return 0;
}

if (import.meta.main) {
  // exitCode, not exit: exit would cut piped output short at the pipe buffer.
  process.exitCode = main(process.argv.slice(2));
}
