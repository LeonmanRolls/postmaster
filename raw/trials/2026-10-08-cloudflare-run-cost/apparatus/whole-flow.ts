// What a whole flow costs to run in the cloud: every launch of a ticket's run, the interactive roles around it
// (the booking clerk and the postmaster) and the control plane, for one ticket and for a month (see ../method.md).
// Pure functions over rates and counts; `run.ts` writes the tables.
import { AGENT, hourly, type Rate } from "./providers.ts";

/** What an hour of an interactive session costs while it works, and while it is kept up waiting for a person. */
export type SessionRates = { awake: number; idle: number };

/**
 * An interactive session is a harness in a container with the waiting-agent profile. It works with a fifth of the
 * CPU busy; kept up and idle it holds only its memory and disk, and a provider that charges every vCPU charges
 * them idle as well.
 */
export function sessionRates(r: Rate): SessionRates {
  return { awake: hourly(r, AGENT), idle: hourly(r, { ...AGENT, cpuBusy: 0 }) };
}

/** `asleep`: the container stops when idle and costs nothing then. `kept-up`: it stays up between turns. */
export type Policy = "asleep" | "kept-up";

/** Dollars for a month of `count` sessions, each awake `awakeHoursPerDay` hours a day. */
export function sessionsMonth(
  rates: SessionRates,
  count: number,
  awakeHoursPerDay: number,
  policy: Policy,
  days = 30,
): number {
  if (count < 0) throw new RangeError(`count must not be negative: ${count}`);
  if (!(awakeHoursPerDay >= 0 && awakeHoursPerDay <= 24)) {
    throw new RangeError(`awake hours a day must be between 0 and 24: ${awakeHoursPerDay}`);
  }
  const awake = awakeHoursPerDay * rates.awake;
  const idle = policy === "kept-up" ? (24 - awakeHoursPerDay) * rates.idle : 0;
  return count * days * (awake + idle);
}

/** Dollars for the priced parts of the control plane, from list rates, for counts that were not measured. */
export function controlPlane(c: { requests: number; workflowSteps: number }): number {
  // $0.15 per million requests and alarms; $0.80 per 100,000 workflow steps (before the monthly allowances)
  return c.requests * 0.15e-6 + c.workflowSteps * 0.8e-5;
}

/** A ticket's own compute: its launches and its share of the control plane. */
export const ticketCost = (launches: number, plane: number): number => launches + plane;

/** Dollars for a month: tickets at their own compute, the sessions' month and the plan fee. */
export function monthCost(tickets: number, perTicket: number, sessions: number, plan: number): number {
  if (tickets < 0) throw new RangeError(`tickets must not be negative: ${tickets}`);
  return tickets * perTicket + sessions + plan;
}

/**
 * Tickets a month at which a flat price costs the same as the cloud month, or null when the sessions and the
 * plan fee alone already cost more than the flat price, or a ticket costs nothing.
 */
export function breakEvenTickets(flat: number, perTicket: number, sessions: number, plan: number): number | null {
  const room = flat - sessions - plan;
  if (room <= 0 || perTicket <= 0) return null;
  return room / perTicket;
}

/** Launch-seconds above `k` at once: for each count `c` above `k`, `(c - k)` times the seconds spent at `c`. */
export function overflowSeconds(hist: Readonly<Record<number, number>>, k: number): number {
  let total = 0;
  for (const [count, secs] of Object.entries(hist)) {
    const c = Number(count);
    if (c > k) total += (c - k) * secs;
  }
  return total;
}

/** Runs a month at the pace of `runs` runs over `spanDays` days of records; 0 for a span with no length. */
export const monthlyPace = (runs: number, spanDays: number, days = 30): number =>
  spanDays > 0 ? (runs / spanDays) * days : 0;

const usd = (d: number): string => (d < 10 ? d.toFixed(2) : d < 100 ? d.toFixed(1) : d.toFixed(0));
const row = (cells: string[]): string => `| ${cells.join(" | ")} |`;

/** The month's table: one row for each pace, with the three ways of treating the interactive sessions. */
export function monthTable(
  paces: readonly number[],
  perTicket: number,
  sessions: { asleep: number; keptUp: number },
  plan: number,
): string {
  const lines = [
    row(["Tickets a month", "Launches only", "With the sessions asleep when idle", "With the sessions kept up"]),
    row(["---", "---", "---", "---"]),
  ];
  for (const p of paces) {
    lines.push(
      row([
        String(Math.round(p)),
        usd(monthCost(p, perTicket, 0, plan)),
        usd(monthCost(p, perTicket, sessions.asleep, plan)),
        usd(monthCost(p, perTicket, sessions.keptUp, plan)),
      ]),
    );
  }
  return lines.join("\n");
}

/** The flat-price table: tickets a month at which each flat price costs the same, for the three treatments. */
export function flatTable(
  flats: readonly number[],
  perTicket: number,
  sessions: { asleep: number; keptUp: number },
  plan: number,
): string {
  const cell = (v: number | null): string => (v === null ? "never" : String(Math.floor(v)));
  const lines = [
    row(["Flat price a month", "Launches only", "Sessions asleep when idle", "Sessions kept up"]),
    row(["---", "---", "---", "---"]),
  ];
  for (const f of flats) {
    lines.push(
      row([
        `$${f}`,
        cell(breakEvenTickets(f, perTicket, 0, plan)),
        cell(breakEvenTickets(f, perTicket, sessions.asleep, plan)),
        cell(breakEvenTickets(f, perTicket, sessions.keptUp, plan)),
      ]),
    );
  }
  return lines.join("\n");
}

/** The peaks table: what the cloud would do if a machine holds `k` launches at once and the cloud takes the rest. */
export function peaksTable(
  ks: readonly number[],
  hist: Readonly<Record<number, number>>,
  totalLaunchSeconds: number,
  ratePerHour: number,
  spanDays: number,
): string {
  const lines = [
    row(["Launches the machine holds at once", "Launch-hours in the cloud", "Share of all launch-hours", "Dollars in the records' span", "Dollars a month at that pace"]),
    row(["---", "---", "---", "---", "---"]),
  ];
  for (const k of ks) {
    const secs = overflowSeconds(hist, k);
    const hours = secs / 3600;
    const share = totalLaunchSeconds > 0 ? secs / totalLaunchSeconds : 0;
    const dollars = hours * ratePerHour;
    lines.push(
      row([
        String(k),
        hours.toFixed(1),
        `${Math.round(100 * share)}%`,
        usd(dollars),
        usd(spanDays > 0 ? (dollars / spanDays) * 30 : 0),
      ]),
    );
  }
  return lines.join("\n");
}
