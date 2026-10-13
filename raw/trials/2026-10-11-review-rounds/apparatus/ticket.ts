// What a ticket carried when its run was dispatched, read from the waybill's copy of it or from
// `ticket-body.md` (see ../method.md). Pure: it takes the text and returns numbers.

export type TicketFeatures = {
  /** length of the ticket text, in characters */
  chars: number;
  /** `two-part` when it has a `## For the agents` part: the plain part and the agents' part */
  shape: "one-part" | "two-part";
  criteria: number;
  decisions: number;
  outOfScope: boolean;
  checks: number;
  notes: number;
  verifiedAt: boolean;
  turnpikes: string;
};

/**
 * The ticket's own text in a waybill: everything under `## Ticket` up to the first of the waybill's
 * own later sections. A waybill holds more after the ticket (the project profile, the team, the
 * postmaster's notes), which is not the ticket.
 */
export function ticketOfWaybill(brief: string): string {
  const lines = brief.split("\n");
  const start = lines.findIndex((l) => /^## Ticket\s*$/u.test(l));
  if (start < 0) return "";
  const stop = lines.findIndex(
    (l, i) =>
      i > start && /^## (Project profile|Team|Dispatch|Postmaster notes|Standing words)\b/u.test(l),
  );
  return lines
    .slice(start + 1, stop < 0 ? lines.length : stop)
    .join("\n")
    .trim();
}

/** The lines under a `## <heading>` up to the next `## ` heading. */
function section(lines: readonly string[], heading: RegExp): string[] {
  const start = lines.findIndex((l) => l.startsWith("## ") && heading.test(l.slice(3)));
  if (start < 0) return [];
  const out: string[] = [];
  for (const l of lines.slice(start + 1)) {
    if (l.startsWith("## ")) break;
    out.push(l);
  }
  return out;
}

/** The lines under a `### <heading>` up to the next `##` or `###` heading. */
function subsection(lines: readonly string[], heading: RegExp): string[] {
  const start = lines.findIndex((l) => l.startsWith("### ") && heading.test(l.slice(4)));
  if (start < 0) return [];
  const out: string[] = [];
  for (const l of lines.slice(start + 1)) {
    if (/^#{2,3} /u.test(l)) break;
    out.push(l);
  }
  return out;
}

/** The features of a ticket's text. */
export function ticketFeatures(text: string): TicketFeatures {
  const lines = text.split("\n");
  const criteria = section(lines, /^Acceptance criteria\b/iu).filter((l) =>
    /^\s{0,3}[0-9]+[.)] +\S/u.test(l),
  ).length;
  const decisions = lines.filter((l) => /^\s*- \*\*D[0-9]+\b/u.test(l)).length;
  const checks = lines.filter((l) => /^\s*- \*\*C[0-9]+\b/u.test(l)).length;
  const notes = subsection(lines, /^Technical notes\b/iu).filter((l) =>
    /^\s{0,3}[-*] +\S/u.test(l),
  ).length;
  const turnpikes =
    section(lines, /^Turnpikes\b/iu)
      .map((l) => l.trim())
      .find((l) => l !== "") ?? "";
  return {
    chars: text.length,
    shape: lines.some((l) => /^## For the agents\b/u.test(l)) ? "two-part" : "one-part",
    criteria,
    decisions,
    outOfScope: lines.some((l) => /^## Out of scope\b/iu.test(l)),
    checks,
    notes,
    verifiedAt: lines.some((l) => /^### Verified at\b/u.test(l)),
    turnpikes,
  };
}
