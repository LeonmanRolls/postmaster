#!/usr/bin/env bun
// Counts, in the calls the laws made to commandTouches, the inputs that could show each
// first-round finding: which of the eight the laws' generators ever produced.
//
//   bun apparatus/run-laws.ts b8056c9 laws --census 400 --record calls.jsonl > /dev/null
//   bun apparatus/shapes.ts calls.jsonl
//
// One line per shape: its count, its finding and what it matches, with the first match.
import { readFileSync } from "node:fs";

export interface Recorded {
  command: string;
  result: unknown;
  code: unknown;
}

const REFUSAL = /Permission denied|Operation not permitted|Read-only file system/iu;
const SEPARATOR = /;|&&|\|\||\|/u;
const refused = (c: Recorded): boolean => REFUSAL.test(String(c.result ?? ""));

export const SHAPES: ReadonlyArray<{ finding: string; what: string; test: (c: Recorded) => boolean }> = [
  { finding: "bug-2", what: "a newline inside a command", test: (c) => c.command.includes("\n") },
  { finding: "bug-3", what: "a bare cd", test: (c) => /(^|[;&|(]\s*)cd\s*($|[;&|)])/u.test(c.command) },
  { finding: "bug-3", what: "cd $HOME, ${HOME} or \"$HOME\"", test: (c) => /\bcd\s+"?\$\{?HOME/u.test(c.command) },
  { finding: "bug-4", what: "git branch or tag with a name", test: (c) => /\bgit\b[^;&|]*\s(branch|tag)\s+(?!-)[\w./-]+/u.test(c.command) },
  { finding: "sec-2", what: "git -c key=value", test: (c) => /\bgit\s+(\S+\s+)*-c\s+\S+=/u.test(c.command) },
  {
    finding: "sec-3",
    what: "a git read naming refs/heads/",
    test: (c) =>
      /\bgit\b[^;&|]*\s(log|show|diff|rev-parse|rev-list|merge-base|ls-tree|cat-file|show-ref|for-each-ref|describe|blame|grep|status)\b[^;&|]*refs\/heads\//u.test(
        c.command,
      ),
  },
  { finding: "bug-1", what: "refusal words in the result of several commands", test: (c) => refused(c) && SEPARATOR.test(c.command) },
  {
    finding: "bug-5",
    what: "refusal words and an exit status other than 0",
    test: (c) => refused(c) && c.code !== 0 && c.code !== "0" && c.code !== undefined && c.code !== null,
  },
  { finding: "style-1", what: "a > inside quotes", test: (c) => /"[^"]*>[^"]*"|'[^']*>[^']*'/u.test(c.command) },
];

/** The recorded calls, from JSON lines. */
export function recordedCalls(text: string): Recorded[] {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as Recorded);
}

function main(argv: string[]): void {
  const [file] = argv;
  if (!file) {
    console.error("usage: shapes.ts <calls.jsonl>");
    process.exit(1);
  }
  const calls = recordedCalls(readFileSync(file, "utf8"));
  console.log(`${calls.length} calls, ${new Set(calls.map((c) => c.command)).size} distinct commands`);
  for (const shape of SHAPES) {
    const hits = calls.filter(shape.test);
    const first = (hits[0]?.command ?? "").replace(/\/tmp\/\S*?\/proj/gu, "<P>").replace(/\n/gu, "⏎").slice(0, 120);
    console.log(`${String(hits.length).padStart(5)}  ${shape.finding}  ${shape.what}${first ? `  e.g. ${first}` : ""}`);
  }
}

if (import.meta.main) main(process.argv.slice(2));
