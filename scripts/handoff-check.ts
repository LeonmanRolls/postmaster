// Check that a leg's hand-off document has every required section and that none is empty.
// A hand-off that passes is the whole of what the next leg's coachman knows, so a missing
// section here is a decision silently lost, not a formatting nit.
//
//   run handoff-check <handoff-file>
//
//   exit 0  every section present and non-empty
//   exit 1  usage or no such file
//   exit 2  sections missing or empty; each is named on stderr
import { readFileSync, statSync } from "node:fs";
import { PY_DOT, PY_S_CLASS, pySplitLines } from "./lib/text.ts";

const REQUIRED = [
  "Decisions",
  "Deferred findings",
  "Verified by execution",
  "Unverified",
  "Branches and lanes",
  "Open questions",
  "Next leg",
];

const args = process.argv.slice(2);
const f = args[0];
if (f === undefined || f === "") {
  console.error("usage: run handoff-check <handoff-file>");
  process.exit(1);
}
let isFile = false;
try {
  isFile = statSync(f).isFile();
} catch {
  isFile = false;
}
if (!isFile) {
  console.error(`handoff-check: no such file: ${f}`);
  process.exit(1);
}

const text = readFileSync(f, "utf8");
const sections = new Map<string, string[]>();
let current: string | null = null;
const heading = new RegExp(`^##[${PY_S_CLASS}]+(${PY_DOT}*?)[${PY_S_CLASS}]*$`, "u");
for (const line of pySplitLines(text)) {
  const m = heading.exec(line);
  if (m) {
    const title = m[1] ?? "";
    current = title;
    if (!sections.has(title)) sections.set(title, []);
    continue;
  }
  if (current !== null && line.trim() !== "") {
    sections.get(current)?.push(line);
  }
}

const bad = REQUIRED.filter((s) => {
  const body = sections.get(s);
  return body === undefined || body.length === 0;
});
if (bad.length > 0) {
  for (const s of bad) console.error(`handoff-check: missing or empty section: ${s}`);
  process.exit(2);
}
console.log(`hand-off complete: ${REQUIRED.length} sections`);
process.exit(0);
