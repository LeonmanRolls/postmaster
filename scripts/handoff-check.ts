import { readFileSync } from "node:fs";
import { writeError, writeOut } from "./lib/core.ts";

const [file] = process.argv.slice(2);
if (!file) {
  writeError("usage: handoff-check.sh <handoff-file>");
  process.exit(1);
}
try {
  const text = readFileSync(file, "utf8");
  const required = [
    "Decisions",
    "Deferred findings",
    "Verified by execution",
    "Unverified",
    "Branches and lanes",
    "Open questions",
    "Next leg",
  ];
  const sections = new Map<string, string[]>();
  let current: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    const match = /^##\s+(.*?)\s*$/.exec(line);
    if (match) {
      current = match[1];
      if (!sections.has(current)) sections.set(current, []);
      continue;
    }
    if (current && line.trim()) sections.get(current)?.push(line);
  }
  const bad = required.filter((section) => !sections.has(section) || sections.get(section)!.length === 0);
  if (bad.length) {
    for (const section of bad) writeError(`handoff-check: missing or empty section: ${section}`);
    process.exit(2);
  }
  writeOut(`hand-off complete: ${required.length} sections`);
} catch {
  writeError(`handoff-check: no such file: ${file}`);
  process.exit(1);
}
