// The trial's tables as markdown, from the derived data alone (see ../method.md). Pure functions;
// `run.ts` reads the audit's data and writes these.
import { median } from "../../2026-10-03-lane-audit/apparatus/analyze.ts";
import { cost, INSTANCE_TYPES, type InstanceType, perHour } from "./cost.ts";
import { type Role, type RoleSummary, type RunTime, seconds, summarizeRole } from "./instance-time.ts";

export const hours = (s: number): string => (s / 3600).toFixed(1);
export const minutes = (s: number | null): string => (s === null ? "–" : String(Math.round(s / 60)));
export const dollars = (d: number): string => (d < 10 ? d.toFixed(2) : d.toFixed(0));

const ROLES: Array<{ role: Role; label: string }> = [
  { role: "lanes", label: "workhorse lanes" },
  { role: "reviewers", label: "reviewers" },
  { role: "gatesOnLanes", label: "gate runs on a lane's branch (inside the coachman)" },
  { role: "gatesOnSynthesis", label: "gate runs on the synthesis (inside the coachman)" },
];

const row = (cells: string[]): string => `| ${cells.join(" | ")} |`;

/** Container time by role: launches, total hours, the median run's hours, and a single launch's minutes. */
export function timeTable(times: readonly RunTime[]): string {
  const lines = [
    row(["Role", "Launches", "Total hours", "Median run, hours", "Median launch, min", "90th percentile, min", "Longest, min"]),
    row(["---", "---", "---", "---", "---", "---", "---"]),
  ];
  for (const { role, label } of ROLES) {
    const s: RoleSummary = summarizeRole(times, role);
    lines.push(
      row([
        label,
        String(s.launches),
        hours(s.totalSeconds),
        s.medianPerRun === null ? "–" : hours(s.medianPerRun),
        minutes(s.medianEach),
        minutes(s.p90Each),
        minutes(s.longestEach),
      ]),
    );
  }
  const upper = times.map((t) => t.coachmanUpper);
  lines.push(
    row([
      "coachman, upper bound (stages a leg can run in)",
      String(times.length),
      hours(upper.reduce((a, b) => a + b, 0)),
      upper.length === 0 ? "–" : hours(median(upper) as number),
      "–",
      "–",
      "–",
    ]),
  );
  return lines.join("\n");
}

/** One row per run: hours by role. */
export function perRunTable(times: readonly RunTime[]): string {
  const lines = [
    row(["Run", "Lanes, h", "Reviewers, h", "Gates on lanes, h", "Gates on synthesis, h", "Coachman upper bound, h"]),
    row(["---", "---", "---", "---", "---", "---"]),
  ];
  for (const t of times) {
    lines.push(
      row([
        t.run,
        hours(seconds(t.lanes)),
        hours(seconds(t.reviewers)),
        hours(seconds(t.gatesOnLanes)),
        hours(seconds(t.gatesOnSynthesis)),
        hours(t.coachmanUpper),
      ]),
    );
  }
  return lines.join("\n");
}

export const CPU_USES = [0, 0.25, 1] as const;

/** What one running hour costs, by instance type and by how busy its vCPUs are. */
export function rateTable(types: readonly string[]): string {
  const lines = [
    row(["Instance type", "vCPU", "Memory, GiB", "Disk, GB", ...CPU_USES.map((u) => `$ per hour, CPU ${u * 100}% busy`)]),
    row(["---", "---", "---", "---", "---", "---", "---"]),
  ];
  for (const name of types) {
    const t = INSTANCE_TYPES[name] as InstanceType;
    lines.push(
      row([name, String(t.vcpu), String(t.memoryGib), String(t.diskGb), ...CPU_USES.map((u) => perHour(t, u).toFixed(3))]),
    );
  }
  return lines.join("\n");
}

export type Scenario = { name: string; lanes: string; reviewers: string; coachman: string };

/** The coachman's seconds in a run: a floor and a ceiling (see uptime.ts and instance-time.ts). */
export type CoachmanSeconds = { floor: number; ceiling: number };

/**
 * Dollars for a median run's container time in a scenario: lanes and reviewers at the median run's
 * seconds, the coachman at the given seconds.
 */
export function scenarioCost(
  times: readonly RunTime[],
  s: Scenario,
  cpuUse: number,
  coachmanSeconds: number,
): { lanes: number; reviewers: number; coachman: number; total: number } {
  const med = (role: Role): number => summarizeRole(times, role).medianPerRun ?? 0;
  const lanes = cost(med("lanes"), INSTANCE_TYPES[s.lanes] as InstanceType, cpuUse);
  const reviewers = cost(med("reviewers"), INSTANCE_TYPES[s.reviewers] as InstanceType, cpuUse);
  const coachman = cost(coachmanSeconds, INSTANCE_TYPES[s.coachman] as InstanceType, cpuUse);
  return { lanes, reviewers, coachman, total: lanes + reviewers + coachman };
}

/** Each scenario's run total as "floor to ceiling", by how busy the vCPUs are. */
export function scenarioTable(
  times: readonly RunTime[],
  scenarios: readonly Scenario[],
  coachman: CoachmanSeconds,
): string {
  const lines = [
    row([
      "Scenario",
      "Lanes",
      "Reviewers",
      "Coachman",
      ...CPU_USES.map((u) => `Run total, $ (CPU ${u * 100}% busy)`),
    ]),
    row(["---", "---", "---", "---", "---", "---", "---"]),
  ];
  for (const s of scenarios) {
    lines.push(
      row([
        s.name,
        s.lanes,
        s.reviewers,
        s.coachman,
        ...CPU_USES.map((u) => {
          const low = scenarioCost(times, s, u, coachman.floor).total;
          const high = scenarioCost(times, s, u, coachman.ceiling).total;
          return `${dollars(low)} to ${dollars(high)}`;
        }),
      ]),
    );
  }
  return lines.join("\n");
}

/** Seconds across every audited run, by what a container would be running. */
export type AuditTotals = {
  runs: number;
  /** workhorse lanes and reviewers, which have a recorded time */
  lanesAndReviewers: number;
  /** the coachman's floor (its last process's uptime) over the runs that have a session export */
  coachmanFloor: number;
  /** how many runs the floor covers */
  coachmanFloorRuns: number;
  /** the coachman's ceiling (every stage a leg can run in) over all the runs */
  coachmanCeiling: number;
};

/** Sum the container seconds of all runs; `uptimeSeconds` maps a run to its coachman's floor, where it has one. */
export function auditTotals(times: readonly RunTime[], uptimeSeconds: ReadonlyMap<string, number>): AuditTotals {
  const totals: AuditTotals = {
    runs: times.length,
    lanesAndReviewers: 0,
    coachmanFloor: 0,
    coachmanFloorRuns: 0,
    coachmanCeiling: 0,
  };
  for (const t of times) {
    totals.lanesAndReviewers += seconds(t.lanes) + seconds(t.reviewers);
    totals.coachmanCeiling += t.coachmanUpper;
    const floor = uptimeSeconds.get(t.run);
    if (floor !== undefined) {
      totals.coachmanFloor += floor;
      totals.coachmanFloorRuns += 1;
    }
  }
  return totals;
}

/**
 * What all the runs together cost on one instance type at one CPU use. `low` counts the coachman at its
 * floor, for the runs that have one; `high` counts every stage hour of every run; `average` is `high` per run.
 */
export function totalsCost(
  totals: AuditTotals,
  size: string,
  cpuUse: number,
): { low: number; high: number; average: number } {
  const type = INSTANCE_TYPES[size] as InstanceType;
  const rest = cost(totals.lanesAndReviewers, type, cpuUse);
  const low = rest + cost(totals.coachmanFloor, type, cpuUse);
  const high = rest + cost(totals.coachmanCeiling, type, cpuUse);
  return { low, high, average: totals.runs === 0 ? 0 : high / totals.runs };
}

/** The totals by size and CPU use, as "low to high" for all the runs and the average run at the high end. */
export function totalsTable(totals: AuditTotals, sizes: readonly string[]): string {
  const lines = [
    row(["Size", "CPU busy", `All ${totals.runs} runs, $`, "Average run, $"]),
    row(["---", "---", "---", "---"]),
  ];
  for (const size of sizes) {
    const t = INSTANCE_TYPES[size] as InstanceType;
    for (const u of CPU_USES) {
      const c = totalsCost(totals, size, u);
      lines.push(
        row([`${size} (${t.vcpu} vCPU, ${t.memoryGib} GiB)`, `${u * 100}%`, `${dollars(c.low)} to ${dollars(c.high)}`, dollars(c.average)]),
      );
    }
  }
  return lines.join("\n");
}

/** Runs a month at which Cloudflare (the plan fee plus `perRun` for each run) costs the same as a flat monthly price. */
export function breakEven(prices: readonly number[], perRun: number, planFee: number): number[] {
  return prices.map((p) => (perRun <= 0 ? 0 : Math.max(0, (p - planFee) / perRun)));
}

/** The earliest and latest ISO timestamps found anywhere in a value, or null where there are none. */
export function isoSpan(value: unknown): { first: string; last: string } | null {
  let first: string | null = null;
  let last: string | null = null;
  const walk = (v: unknown): void => {
    if (typeof v === "string") {
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/u.test(v)) {
        if (first === null || v < first) first = v;
        if (last === null || v > last) last = v;
      }
    } else if (Array.isArray(v)) {
      for (const x of v) walk(x);
    } else if (v !== null && typeof v === "object") {
      for (const x of Object.values(v)) walk(x);
    }
  };
  walk(value);
  return first === null || last === null ? null : { first, last };
}
