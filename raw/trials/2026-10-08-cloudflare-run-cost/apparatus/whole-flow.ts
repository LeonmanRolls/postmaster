// What a whole flow costs to run in the cloud: every launch of a ticket's run, the interactive roles around it
// (the booking clerk and the postmaster) and the control plane, for one ticket and for a month (see ../method.md).
// Pure functions over rates and counts; `run.ts` writes the tables.
import { AGENT, hourly, type Rate } from "./providers.ts";

/** Dollars for one hour of a Durable Object in front of a container: 128 MB at $12.50 per million GB-seconds. */
export const DURABLE_OBJECT_PER_HOUR = 0.125 * 12.5e-6 * 3600;

/** A low and a high end of a figure that is bracketed, not known. */
export type Span = { low: number; high: number };

/** What an hour of an interactive session costs while it works, and while it is kept up waiting for a person. */
export type SessionRates = { awake: number; idle: number };

/**
 * An interactive session is a harness in a container with the waiting-agent profile. It works with a fifth of the
 * CPU busy; kept up and idle it holds only its memory and disk, and a provider that charges every vCPU charges
 * them idle as well. `overheadPerHour` is what stands in front of the container for as long as it is up (on
 * Cloudflare, the Durable Object that keeps it alive).
 */
export function sessionRates(r: Rate, overheadPerHour = 0): SessionRates {
  return {
    awake: hourly(r, AGENT) + overheadPerHour,
    idle: hourly(r, { ...AGENT, cpuBusy: 0 }) + overheadPerHour,
  };
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

/**
 * Dollars for the priced parts of the control plane of one ticket, from list rates, for counts that were not
 * measured: requests and alarms at $0.15 per million, workflow steps at $0.80 per 100,000 and the Durable
 * Objects in front of the containers for the hours the containers are up. The stores are not priced.
 */
export function controlPlane(c: { requests: number; workflowSteps: number; doHours: number }): number {
  return c.requests * 0.15e-6 + c.workflowSteps * 0.8e-5 + c.doHours * DURABLE_OBJECT_PER_HOUR;
}

/** Dollars for a month: tickets at their own compute, the sessions' month and the plan fee. */
export function monthCost(tickets: number, perTicket: number, sessions: number, plan: number): number {
  if (tickets < 0) throw new RangeError(`tickets must not be negative: ${tickets}`);
  return tickets * perTicket + sessions + plan;
}

/**
 * Tickets a month at which a flat price costs the same as the cloud month: null when the sessions and the plan fee
 * alone already cost more than the flat price, Infinity when a ticket costs nothing and so the cloud is always cheaper.
 */
export function breakEvenTickets(flat: number, perTicket: number, sessions: number, plan: number): number | null {
  const room = flat - sessions - plan;
  if (room <= 0) return null;
  return perTicket <= 0 ? Number.POSITIVE_INFINITY : room / perTicket;
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

export type Launch = { start: number; end: number; kind: "lanes" | "reviewers" | "gates" };

/**
 * The launch-seconds the cloud takes when the machine holds `k` launches at once and a launch that finds it full goes
 * to the cloud and stays there until it ends. Launches are taken in the order they start. No launch moves.
 */
export function admitted(launches: readonly Launch[], k: number): Record<"lanes" | "reviewers" | "gates", number> {
  const cloud = { lanes: 0, reviewers: 0, gates: 0 };
  let machine: number[] = [];
  for (const l of [...launches].sort((a, b) => a.start - b.start || a.end - b.end)) {
    machine = machine.filter((end) => end > l.start);
    if (machine.length < k) machine.push(l.end);
    else cloud[l.kind] += l.end - l.start;
  }
  return cloud;
}

/** Runs a month at the pace of `runs` runs over `spanDays` days of records; 0 for a span with no length. */
export const monthlyPace = (runs: number, spanDays: number, days = 30): number =>
  spanDays > 0 ? (runs / spanDays) * days : 0;

const usd = (d: number): string => (d < 10 ? d.toFixed(2) : d < 100 ? d.toFixed(1) : d.toFixed(0));
const range = (a: number, b: number): string => (usd(a) === usd(b) ? usd(a) : `${usd(a)} to ${usd(b)}`);
const row = (cells: string[]): string => `| ${cells.join(" | ")} |`;

/** The month's table: a row for each pace, each cell from the low ends of the brackets to the high ends. */
export function monthTable(
  paces: readonly number[],
  perTicket: Span,
  sessions: { asleep: Span; keptUp: Span },
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
        range(monthCost(p, perTicket.low, 0, plan), monthCost(p, perTicket.high, 0, plan)),
        range(
          monthCost(p, perTicket.low, sessions.asleep.low, plan),
          monthCost(p, perTicket.high, sessions.asleep.high, plan),
        ),
        range(
          monthCost(p, perTicket.low, sessions.keptUp.low, plan),
          monthCost(p, perTicket.high, sessions.keptUp.high, plan),
        ),
      ]),
    );
  }
  return lines.join("\n");
}

/** The flat-price table: tickets a month at which each flat price costs the same, from the high costs to the low ones. */
export function flatTable(
  flats: readonly number[],
  perTicket: Span,
  sessions: { asleep: Span; keptUp: Span },
  plan: number,
): string {
  const whole = (v: number | null): string => (v === null ? "never" : v === Number.POSITIVE_INFINITY ? "any" : String(Math.floor(v)));
  const cell = (flat: number, ses: Span): string => {
    const few = breakEvenTickets(flat, perTicket.high, ses.high, plan);
    const many = breakEvenTickets(flat, perTicket.low, ses.low, plan);
    if (whole(few) === whole(many)) return whole(few);
    return few === null ? `up to ${whole(many)}` : `${whole(few)} to ${whole(many)}`;
  };
  const none: Span = { low: 0, high: 0 };
  const lines = [
    row(["Flat price a month", "Launches only", "Sessions asleep when idle", "Sessions kept up"]),
    row(["---", "---", "---", "---"]),
  ];
  for (const f of flats) {
    lines.push(row([`$${f}`, cell(f, none), cell(f, sessions.asleep), cell(f, sessions.keptUp)]));
  }
  return lines.join("\n");
}

/**
 * The peaks table: what the cloud takes if a machine holds `k` launches at once. The first column of hours is the
 * least that could go (launches could move as the count rises and falls); the second is a launch that starts while the
 * machine is full going to the cloud and staying there.
 */
export function peaksTable(
  ks: readonly number[],
  hist: Readonly<Record<number, number>>,
  launches: readonly Launch[],
  rates: { agentHour: number; gateHour: number },
  spanDays: number,
): string {
  const totalSeconds = launches.reduce((a, l) => a + (l.end - l.start), 0);
  const lines = [
    row([
      "Launches the machine holds at once",
      "Launch-hours above that, at least",
      "Launch-hours sent to the cloud",
      "Share of all launch-hours",
      "Of them gate runs",
      "Dollars a month at that pace",
    ]),
    row(["---", "---", "---", "---", "---", "---"]),
  ];
  for (const k of ks) {
    const least = overflowSeconds(hist, k) / 3600;
    const cloud = admitted(launches, k);
    const secs = cloud.lanes + cloud.reviewers + cloud.gates;
    const dollars = ((cloud.lanes + cloud.reviewers) / 3600) * rates.agentHour + (cloud.gates / 3600) * rates.gateHour;
    lines.push(
      row([
        String(k),
        least.toFixed(1),
        (secs / 3600).toFixed(1),
        `${Math.round((100 * secs) / Math.max(totalSeconds, 1))}%`,
        `${(cloud.gates / 3600).toFixed(1)} h`,
        usd(spanDays > 0 ? (dollars / spanDays) * 30 : 0),
      ]),
    );
  }
  return lines.join("\n");
}
