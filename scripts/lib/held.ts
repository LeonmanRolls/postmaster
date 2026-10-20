// The watcher's held list, `<runs>/postmaster/held`, shared by the watcher
// that reads it and the hold command that writes it. One run per line: a
// bare ticket written by hand, or a helper's line naming its helper and the
// postmaster session that set it. Matching is on the line's first field,
// so a helper's line holds its run and a hand-written line keeps working.
export interface HeldLine {
  ticket: string;
  helper: string | null;
  session: string | null;
  /** Trailing fields that are neither helper= nor session=, or repeats. */
  extra: string[];
}

/** Parse one held line; null when the line is blank. */
export function parseHeldLine(raw: string): HeldLine | null {
  const fields = raw.split(/[ \t]+/u).filter((f) => f !== "");
  const ticket = fields[0];
  if (ticket === undefined) return null;
  let helper: string | null = null;
  let session: string | null = null;
  const extra: string[] = [];
  for (const field of fields.slice(1)) {
    const eq = field.indexOf("=");
    const key = eq === -1 ? "" : field.slice(0, eq);
    const value = eq === -1 ? "" : field.slice(eq + 1);
    if ((key !== "helper" && key !== "session") || value === "") {
      extra.push(field);
    } else if (key === "helper") {
      if (helper === null) helper = value;
      else extra.push(field);
    } else if (session === null) session = value;
    else extra.push(field);
  }
  return { ticket, helper, session, extra };
}

/** The run a held line holds: its first field, or null when blank. */
export function heldTicketOf(raw: string): string | null {
  return parseHeldLine(raw)?.ticket ?? null;
}

/** True when the line is a helper's hold rather than a hand-written one. */
export function isHelperHold(line: HeldLine): boolean {
  return line.helper !== null;
}

export function formatHelperHold(ticket: string, helper: string, session: string): string {
  return `${ticket} helper=${helper} session=${session}`;
}

export type AddHold = { ok: true; text: string } | { ok: false; held: string };

/**
 * Append a hand-written hold: the bare ticket. Refused when any line already
 * holds the run, carrying that line for the message.
 */
export function addHandHold(text: string, ticket: string): AddHold {
  for (const raw of text.split("\n")) {
    if (heldTicketOf(raw) === ticket) return { ok: false, held: raw.trim() };
  }
  const prefix = text === "" || text.endsWith("\n") ? text : `${text}\n`;
  return { ok: true, text: `${prefix}${ticket}\n` };
}

/**
 * Append a helper's hold. Refused when any line already holds the run, by
 * hand or by a helper, carrying that line for the message. The existing
 * text is kept byte for byte.
 */
export function addHold(text: string, ticket: string, helper: string, session: string): AddHold {
  for (const raw of text.split("\n")) {
    if (heldTicketOf(raw) === ticket) return { ok: false, held: raw.trim() };
  }
  const prefix = text === "" || text.endsWith("\n") ? text : `${text}\n`;
  return { ok: true, text: `${prefix}${formatHelperHold(ticket, helper, session)}\n` };
}

export type RemoveHold =
  | { ok: true; text: string; removed: string[] }
  | { ok: false; reason: "not-held" | "hand-held" };

/**
 * Remove a run's helper holds. A hand-written line is never touched: when
 * the run has one and no helper hold, the refusal says so.
 */
export function removeHelperHold(text: string, ticket: string): RemoveHold {
  const kept: string[] = [];
  const removed: string[] = [];
  let hand = false;
  for (const raw of text.split("\n")) {
    const line = parseHeldLine(raw);
    if (line === null || line.ticket !== ticket) {
      kept.push(raw);
      continue;
    }
    if (isHelperHold(line)) removed.push(raw.trim());
    else {
      hand = true;
      kept.push(raw);
    }
  }
  if (removed.length === 0) return { ok: false, reason: hand ? "hand-held" : "not-held" };
  return { ok: true, text: kept.join("\n"), removed };
}

export type RemoveHandHold =
  | { ok: true; text: string; removed: string[] }
  | { ok: false; reason: "not-held" | "helper-held" };

/**
 * Remove a run's hand-written holds. A helper's hold is never touched: when
 * the run has one and no hand-written line, the refusal says so.
 */
export function removeHandHold(text: string, ticket: string): RemoveHandHold {
  const kept: string[] = [];
  const removed: string[] = [];
  let helper = false;
  for (const raw of text.split("\n")) {
    const line = parseHeldLine(raw);
    if (line === null || line.ticket !== ticket) {
      kept.push(raw);
      continue;
    }
    if (isHelperHold(line)) {
      helper = true;
      kept.push(raw);
    } else removed.push(raw.trim());
  }
  if (removed.length === 0) return { ok: false, reason: helper ? "helper-held" : "not-held" };
  return { ok: true, text: kept.join("\n"), removed };
}

export interface DropStale {
  text: string;
  dropped: string[];
}

/** Drop every helper hold from another session; hand-written lines stay. */
export function dropStaleHolds(text: string, session: string): DropStale {
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const raw of text.split("\n")) {
    const line = parseHeldLine(raw);
    if (line !== null && isHelperHold(line) && line.session !== session) {
      dropped.push(raw.trim());
      continue;
    }
    kept.push(raw);
  }
  return { text: kept.join("\n"), dropped };
}
