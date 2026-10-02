// Which agent CLIs are installed and answering on this machine.
// Presence on PATH is not enough: a walled account or a missing key looks identical to a
// working harness until a run has already been dispatched at it.

const row = (a: string, b: string, c: string, d: string): void => {
  console.log(`  ${a.padEnd(8)} ${b.padEnd(9)} ${c.padEnd(13)} ${d}`);
};

row("HARNESS", "INSTALLED", "HEADLESS", "NOTES");
row("-------", "---------", "--------", "-----");
for (const h of ["claude", "codex", "grok", "agy", "muse", "mimo", "pi"]) {
  if (Bun.which(h) === null) {
    row(h, "no", "-", "not on PATH");
    continue;
  }
  const hl: Record<string, string> = {
    claude: "-p",
    codex: "exec",
    grok: "-p",
    agy: "-p",
    muse: "exec",
    mimo: "run",
    pi: "--mode json",
  };
  let note = "";
  if (h === "muse") note = "--prompt-file; key from META_API_KEY";
  if (h === "grok") note = "--prompt-file";
  if (h === "agy") note = "reads NO ambient context file";
  if (h === "muse")
    note = `${note}; reads AGENTS.md in a trusted workspace, and Claude Code's user rules`;
  if (h === "mimo")
    note =
      "prompt on stdin; key from XIAOMI_API_KEY; reads AGENTS.md, a CLAUDE.md beside a short one, and Claude Code's user rules";
  if (h === "pi") note = "reads AGENTS.md or CLAUDE.md (AGENTS.md first); prompt on stdin";
  row(h, "yes", hl[h] ?? "-", note);
}
console.log("");
console.log("  A harness that reads no ambient context must be handed AGENTS.md explicitly in its");
console.log(
  "  prompt, or it starts blind while its siblings do not. That has silently handicapped",
);
console.log("  a lane before, and the run looked normal throughout.");
process.exit(0);
