// What an hour of two kinds of work costs on each on-demand provider, from the providers' published
// rates (see ../method.md). A rate says what the provider charges per vCPU-hour and per GiB-hour, and
// whether the CPU is charged for what is provisioned or for the busy part only. Pure functions; the rate
// table is `results/providers.json`, which names the page, the date and how well each rate was checked.

/** A kind of work whose resources and CPU use are fixed. */
export type Profile = {
  name: string;
  vcpu: number;
  memoryGib: number;
  diskGb: number;
  /** the fraction of the vCPUs that are busy, 0 to 1 */
  cpuBusy: number;
};

/** The project's gate: tests and lint with every vCPU busy. */
export const GATE: Profile = { name: "gate", vcpu: 4, memoryGib: 12, diskGb: 20, cpuBusy: 1 };

/** A coding agent waiting on model calls: a lane, a reviewer or a coachman. */
export const AGENT: Profile = { name: "waiting agent", vcpu: 1, memoryGib: 4, diskGb: 10, cpuBusy: 0.2 };

export type Checked = "two reads" | "one read" | "unchecked";

export type Rate = {
  id: string;
  name: string;
  /** dollars per vCPU-hour */
  vcpuHour: number;
  /** "busy": the vCPUs that are busy; "provisioned": every vCPU while the instance runs */
  cpuBilling: "busy" | "provisioned";
  /** dollars per GiB-hour of provisioned memory */
  gibHour: number;
  /** dollars per GB-hour of provisioned disk, 0 where disk is bundled or not charged by the hour */
  diskGbHour: number;
  /** the longest session in hours, null where none is stated */
  maxSessionHours: number | null;
  /** the largest vCPU count a sandbox may have, null where not read */
  maxVcpu: number | null;
  /** the largest memory in GiB a sandbox may have without asking the provider, null where not read */
  maxMemoryGib: number | null;
  source: string;
  read: string;
  checked: Checked;
  note: string;
};

/** Dollars for one hour of a profile at a rate. */
export function hourly(r: Rate, p: Profile): number {
  if (p.cpuBusy < 0 || p.cpuBusy > 1) throw new RangeError(`cpuBusy must be between 0 and 1: ${p.cpuBusy}`);
  const cpu = p.vcpu * r.vcpuHour * (r.cpuBilling === "busy" ? p.cpuBusy : 1);
  return cpu + p.memoryGib * r.gibHour + p.diskGb * r.diskGbHour;
}

/** Dollars for a run of `agentHours` of waiting agents and `gateHours` of gate. */
export function runCost(r: Rate, agentHours: number, gateHours: number): number {
  return agentHours * hourly(r, AGENT) + gateHours * hourly(r, GATE);
}

/** Whether a profile fits the largest sandbox the provider offers without a request, where its limits are known. */
export const fits = (r: Rate, p: Profile): boolean =>
  (r.maxVcpu === null || p.vcpu <= r.maxVcpu) && (r.maxMemoryGib === null || p.memoryGib <= r.maxMemoryGib);

/** Whether a provider can hold a session of the given length. */
export const holds = (r: Rate, hours: number): boolean => r.maxSessionHours === null || r.maxSessionHours >= hours;

/** Rates from cheapest to dearest for a run, leaving out a provider that cannot hold the longest session and putting last one whose largest sandbox is too small for the gate. */
export function rank(rates: readonly Rate[], agentHours: number, gateHours: number, longestHours: number) {
  return rates
    .filter((r) => holds(r, longestHours))
    .map((r) => ({
      rate: r,
      agent: hourly(r, AGENT),
      gate: hourly(r, GATE),
      gateFits: fits(r, GATE),
      run: runCost(r, agentHours, gateHours),
    }))
    .sort((a, b) => Number(b.gateFits) - Number(a.gateFits) || a.run - b.run);
}

const usd = (d: number): string => (d < 1 ? d.toFixed(3) : d < 10 ? d.toFixed(2) : d.toFixed(1));
const row = (cells: string[]): string => `| ${cells.join(" | ")} |`;

/** A markdown table of what each provider charges for an agent hour, a gate hour and a run's low and high ends. */
export function ratesTable(
  rates: readonly Rate[],
  hours: { agentLow: number; agentHigh: number; gate: number },
  longestHours: number,
): string {
  const lines = [
    row(["Provider", "Agent hour, $", "Gate hour, $", "One run, low to high, $", "Checked", "Longest session"]),
    row(["---", "---", "---", "---", "---", "---"]),
  ];
  const low = rank(rates, hours.agentLow, hours.gate, longestHours);
  const high = new Map(rank(rates, hours.agentHigh, hours.gate, longestHours).map((x) => [x.rate.id, x.run]));
  for (const x of low) {
    lines.push(
      row([
        x.rate.name,
        usd(x.agent),
        x.gateFits ? usd(x.gate) : "over the size limit",
        x.gateFits ? `${usd(x.run)} to ${usd(high.get(x.rate.id) as number)}` : "n/a",
        x.rate.checked,
        x.rate.maxSessionHours === null ? "none stated" : `${x.rate.maxSessionHours} h`,
      ]),
    );
  }
  return lines.join("\n");
}

/** A machine sold whole, by the hour, whose price does not depend on what runs on it. */
export type Machine = {
  id: string;
  name: string;
  /** dollars per hour for the shape named in `shape` */
  hourly: number;
  shape: string;
  /** "hour": a part hour is billed as a whole hour; "second": by the second */
  step: "hour" | "second";
  /** whether a powered-off machine is still billed until it is deleted */
  stoppedBilled: boolean;
  /** dollars a month for the same shape kept up all month, null where the provider lists none */
  monthly: number | null;
  source: string;
  read: string;
  checked: Checked;
  note: string;
};

/** Dollars for a machine kept up for `hours`, with a part hour rounded up where the provider bills by the hour. */
export function machineCost(m: Machine, hours: number): number {
  if (hours < 0) throw new RangeError(`hours must not be negative: ${hours}`);
  return (m.step === "hour" ? Math.ceil(hours) : hours) * m.hourly;
}

/** The hours of waiting agents and of gate in a set of runs: every launch hour, with the gate carved out of the coachman. */
export function profileHours(t: { lanesAndReviewers: number; coachman: number; gates: number }): { agent: number; gate: number } {
  return { agent: (t.lanesAndReviewers + t.coachman - t.gates) / 3600, gate: t.gates / 3600 };
}

/** The runs of the median life a month that cost what the same machine kept up all month costs, null where there is no monthly price. */
export function breakEvenRuns(m: Machine, medianHours: number): number | null {
  const run = machineCost(m, medianHours);
  return m.monthly === null || run === 0 ? null : m.monthly / run;
}

/** A markdown table of what a machine kept up for each run costs, for the median run's life and summed over each run's own life. */
export function machinesTable(
  machines: readonly Machine[],
  life: { medianHours: number; lives: readonly number[] },
): string {
  const lines = [
    row([
      "Machine",
      "$ an hour",
      "Median run",
      `All ${life.lives.length} runs`,
      "$ a month, kept up",
      "Median runs a month that cost that",
      "Stopped machine billed",
      "Checked",
    ]),
    row(["---", "---", "---", "---", "---", "---", "---", "---"]),
  ];
  const sorted = [...machines].sort((a, b) => a.hourly - b.hourly);
  for (const m of sorted) {
    const runs = breakEvenRuns(m, life.medianHours);
    lines.push(
      row([
        m.name,
        usd(m.hourly),
        usd(machineCost(m, life.medianHours)),
        usd(life.lives.reduce((sum, hours) => sum + machineCost(m, hours), 0)),
        m.monthly === null ? "not entered" : usd(m.monthly),
        runs === null ? "n/a" : String(Math.round(runs)),
        m.stoppedBilled ? "yes" : "no",
        m.checked,
      ]),
    );
  }
  return lines.join("\n");
}
