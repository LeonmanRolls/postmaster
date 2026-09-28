import { accessSync } from "node:fs";
import { writeOut } from "./lib/core.ts";

function onPath(program: string): boolean {
  for (const directory of (process.env.PATH ?? "").split(":")) {
    try {
      accessSync(`${directory}/${program}`);
      return true;
    } catch {
      /* Search the next PATH entry. */
    }
  }
  return false;
}
function row(harness: string, installed: string, headless: string, note: string): void {
  writeOut(`  ${harness.padEnd(8)} ${installed.padEnd(9)} ${headless.padEnd(13)} ${note}`);
}
const forms: Record<string, string> = {
  claude: "-p",
  codex: "exec",
  grok: "-p",
  agy: "-p",
  muse: "exec",
  mimo: "run",
  pi: "--mode json",
};
row("HARNESS", "INSTALLED", "HEADLESS", "NOTES");
row("-------", "---------", "--------", "-----");
for (const harness of ["claude", "codex", "grok", "agy", "muse", "mimo", "pi"]) {
  if (!onPath(harness)) {
    row(harness, "no", "-", "not on PATH");
    continue;
  }
  let note = "";
  if (harness === "muse") note = "--prompt-file; key from META_API_KEY";
  if (harness === "grok") note = "--prompt-file";
  if (harness === "agy") note = "reads NO ambient context file";
  if (harness === "muse") note += "; reads AGENTS.md in a trusted workspace, and Claude Code's user rules";
  if (harness === "mimo")
    note =
      "prompt on stdin; key from XIAOMI_API_KEY; reads AGENTS.md, a CLAUDE.md beside a short one, and Claude Code's user rules";
  if (harness === "pi") note = "reads AGENTS.md or CLAUDE.md (AGENTS.md first); prompt on stdin";
  row(harness, "yes", forms[harness], note);
}
writeOut("");
writeOut("  A harness that reads no ambient context must be handed AGENTS.md explicitly in its");
writeOut("  prompt, or it starts blind while its siblings do not. That has silently handicapped");
writeOut("  a lane before, and the run looked normal throughout.");
