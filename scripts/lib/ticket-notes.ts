// The run's ticket notes: what the coachman and the workhorses get from the
// ticket. The user's value for the ticket wins; otherwise team.ticket_notes,
// "given" (the default) or "held-back", with a config without the key reading
// as given. Every step reads the value from the run's record, never from the
// live config.
import { join } from "node:path";
import { tryJsonFile } from "./data.ts";

export const TICKET_NOTES_VALUES = ["given", "held-back"] as const;
export type TicketNotes = (typeof TICKET_NOTES_VALUES)[number];

/**
 * The run's value, its source and the setting: the user's value wins, else the
 * setting, with a missing key reading as given. The caller validates the
 * requested value; a setting outside the two is refused.
 */
export function resolveTicketNotes(
  config: Record<string, unknown>,
  requested?: string,
): { value: TicketNotes; source: "user" | "setting"; setting: TicketNotes } | { error: string } {
  const team = config.team;
  const configured =
    typeof team === "object" && team !== null && !Array.isArray(team)
      ? (team as Record<string, unknown>).ticket_notes
      : undefined;
  const setting = configured === undefined ? "given" : configured;
  if (
    typeof setting !== "string" ||
    !(TICKET_NOTES_VALUES as readonly string[]).includes(setting)
  ) {
    return { error: `team.ticket_notes must be given or held-back, not ${String(configured)}` };
  }
  if (requested !== undefined)
    return { value: requested as TicketNotes, source: "user", setting: setting as TicketNotes };
  return { value: setting as TicketNotes, source: "setting", setting: setting as TicketNotes };
}

/**
 * The run's ticket notes from run.json: the top-level value when the record
 * has one, else the config's team.ticket_notes for a record written before
 * the user could name a value. A record with neither is a given run, and any
 * other shape reads as given here (run-meta refuses a record it cannot write).
 */
export function ticketNotes(dispatch: string): TicketNotes {
  const meta = tryJsonFile<Record<string, unknown>>(join(dispatch, "run.json"));
  const top = meta?.ticket_notes;
  if (top !== undefined) return top === "held-back" ? "held-back" : "given";
  const config = meta?.config as Record<string, unknown> | undefined;
  const team = config?.team as Record<string, unknown> | undefined;
  return team?.ticket_notes === "held-back" ? "held-back" : "given";
}
