// The ticket's library list and the run's recorded words on libraries, read one
// way by every slice that enforces them (#424 on this repository, #426 on lane
// installs elsewhere). The list is the ticket's ## Libraries section: one line
// per library with its name, its exact version and the clerk's vetting. The
// words are the postmaster-only log-action verbs library-yes, age-waiver,
// script-allow and pm-word in the run's actions.jsonl.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface ListedLibrary {
  name: string;
  version: string;
}

export interface PmWord {
  managers: string[];
  detail: string;
}

export interface Approvals {
  yes: Set<string>;
  waivers: Set<string>;
  allowances: Set<string>;
  pmWords: PmWord[];
}

const AT_FORM = /^[ \t]*(?:[-*+][ \t]+)?(@[^/ \t]+\/[^@ \t]+|[^@ \t/]+)@([^@ \t]+)/u;
const SPACE_FORM =
  /^[ \t]*(?:[-*+][ \t]+)?(@[^/ \t]+\/[^@ \t]+|[^@ \t/]+)[ \t]+v?([0-9]+\.[0-9]+\.[0-9]+[^ \t]*)/u;

/** The exact name@version a ## Libraries line lists, or null for prose and
 * for versions that are not exact: only an exact version can meet a resolved
 * one, so ranges never match. */
export function parseLibraryLine(line: string): ListedLibrary | null {
  const clean = (version: string): string | null => {
    const stripped = version.replace(/^[v= \t]+/u, "").replace(/[.,;:!?]+$/u, "");
    if (!/^[0-9]+\.[0-9]+\.[0-9]+/u.test(stripped)) return null;
    if (/[~^*|<>= ]/u.test(stripped)) return null;
    return stripped;
  };
  const at = AT_FORM.exec(line);
  if (at?.[1] !== undefined && at[2] !== undefined) {
    const version = clean(at[2]);
    if (version === null) return null;
    return { name: at[1], version };
  }
  const space = SPACE_FORM.exec(line);
  if (space?.[1] !== undefined && space[2] !== undefined) {
    const version = clean(space[2]);
    if (version === null) return null;
    return { name: space[1], version };
  }
  return null;
}

/** Every library the waybill's ticket lists. The brief carries ## sections
 * flat, so the ticket is the region between ## Ticket and ## Project profile
 * and the list is the ## Libraries section inside it. */
export function parseLibraries(briefText: string): ListedLibrary[] {
  const lines = briefText.split("\n");
  const ticketAt = lines.findIndex((l) => /^## Ticket[ \t]*$/u.test(l));
  if (ticketAt < 0) return [];
  let profileAt = lines.findIndex((l, i) => i > ticketAt && /^## Project profile[ \t]*$/u.test(l));
  if (profileAt < 0) profileAt = lines.length;
  const region = lines.slice(ticketAt + 1, profileAt);
  const listAt = region.findIndex((l) => /^## Libraries[ \t]*$/u.test(l));
  if (listAt < 0) return [];
  const rest = region.slice(listAt + 1);
  const endAt = rest.findIndex((l) => /^##[ \t]/u.test(l));
  const body = endAt < 0 ? rest : rest.slice(0, endAt);
  const found: ListedLibrary[] = [];
  for (const line of body) {
    const parsed = parseLibraryLine(line);
    if (parsed !== null) found.push(parsed);
  }
  return found;
}

function emptyApprovals(): Approvals {
  return { yes: new Set(), waivers: new Set(), allowances: new Set(), pmWords: [] };
}

/** The run's recorded words. Only the postmaster's lines count; a malformed
 * line is skipped, which fails closed (a skipped yes refuses the install). */
export function readApprovals(dispatch: string): Approvals {
  const out = emptyApprovals();
  const file = join(dispatch, "actions.jsonl");
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) continue;
    const row = parsed as Record<string, unknown>;
    if (row.actor !== "postmaster") continue;
    if (typeof row.target !== "string" || typeof row.detail !== "string") continue;
    if (row.action === "library-yes") out.yes.add(row.target);
    else if (row.action === "age-waiver") out.waivers.add(row.target);
    else if (row.action === "script-allow") out.allowances.add(row.target);
    else if (row.action === "pm-word") {
      out.pmWords.push({
        managers: row.target.split(",").filter((m) => m !== ""),
        detail: row.detail,
      });
    }
  }
  return out;
}

/** Whether the ticket lists this exact resolved version. */
export function listsVersion(libs: ListedLibrary[], name: string, version: string): boolean {
  return libs.some((l) => l.name === name && l.version === version);
}

/** Whether one of the run's words covers every manager in the set. */
export function wordCovers(words: PmWord[], managers: string[]): boolean {
  return words.some((w) => managers.every((m) => w.managers.includes(m)));
}
