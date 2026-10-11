// Oracle helpers for #319: a ticket has at most five acceptance criteria not
// counting the fixture line. Each test drives the real ticket-parts script as
// a subprocess over a minimal two-part ticket, or reads the two clerk files;
// nothing here imports the change.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { beside, toolRoot } from "./lib/paths.ts";
import { run } from "./lib/proc.ts";

export const ROOT = toolRoot(import.meta);
export const RUN = beside(import.meta, "run");
export const TEMPLATE = join(ROOT, "skills", "clerk", "ticket-template.md");
export const CLERK = join(ROOT, "skills", "clerk", "clerk.md");

export const FIXTURE = "A fixture run dispatched from this change's branch scores clean.";
export const COPY_MADE = "A copy made for a fixture run is never offered verifiers.";
export const NAMES = ["Alpha", "Beta", "Gamma", "Delta", "Echo", "Foxtrot", "Golf"];
export const DECISION = "The work lands as one ticket. Why: the outcomes cannot be checked apart.";

export function outcome(n: number): string {
  return `${NAMES[n]} holds when the work lands.`;
}

// A minimal two-part ticket with the given criteria and one decision: fit,
// with no finding, so the only notes are the counts and the limit warning.
export function ticketBody(criteria: string[], mark: string, decision: string): string {
  const lines = [
    "## Problem / feature",
    "",
    "Something is wrong and the user wants it fixed.",
    "",
    "## Acceptance criteria",
    "",
    ...criteria.map((c, i) => `${i + 1}. ${c}`),
    "",
    "## Decisions",
    "",
    "### Not covered by the acceptance criteria",
    "",
    `- **D1 ${mark}** ${decision}`,
    "",
    "## Out of scope",
    "",
    "- Nothing else changes.",
    "",
    "## Direction",
    "",
    "None: any approach that meets the criteria.",
    "",
    "## Turnpikes",
    "",
    "default",
    "",
    "## For the agents",
    "",
    "*Everything above is what the user signed off. This part follows from it and adds nothing to it.*",
    "",
    "### Checks",
    "",
    ...criteria.map(
      (_, i) => `- **C${i + 1}** Show outcome ${i + 1} working the way it will be used.`,
    ),
    "",
    "### Technical notes",
    "",
    "- The checks above show each outcome on realistic input. (C1, D1)",
    "",
    "### Verified at 0123456789abcdef0123456789abcdef01234567",
    "",
    "- Every file the notes rely on exists at this commit.",
    "",
  ];
  return lines.join("\n");
}

export interface PartsOut {
  code: number;
  findings: string[];
  notes: string[];
}

export function runParts(dir: string, name: string, text: string, flags: string[]): PartsOut {
  const file = join(dir, name);
  writeFileSync(file, text);
  const r = run(RUN, ["ticket-parts", file, ...flags], { timeout: 20000 });
  const lines = r.out.split("\n").filter((l) => l !== "");
  return {
    code: r.code,
    findings: lines.filter((l) => l.startsWith("line ")),
    notes: lines.filter((l) => !l.startsWith("line ")),
  };
}

export function warned(notes: string[]): string[] {
  return notes.filter((n) => n.startsWith("more than five criteria:"));
}
