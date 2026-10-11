// Draw the trial's tables from the lane audit's derived data (see ../method.md). It reads no run's
// records, so anyone with this repository can run it.
//
//   bun run.ts [--runs <runs.json>] [--out <results dir>]
//
// Reads the audit's runs.json and writes instance-time.json, instance-time.md, cost.md, concurrency.md and providers.md.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Extract } from "../../2026-10-03-lane-audit/apparatus/extract.ts";
import { median } from "../../2026-10-03-lane-audit/apparatus/analyze.ts";
import { intervalsOfRuns, loadTable, longerThan, peakInOneRun, runHours } from "./concurrency.ts";
import { covered, runTime, type RunTime, summarizeRole } from "./instance-time.ts";
import { PLAN_FEE_PER_MONTH } from "./cost.ts";
import { type Machine, machinesTable, profileHours, type Rate, ratesTable, runCost } from "./providers.ts";
import {
  auditTotals,
  breakEven,
  dollars,
  isoSpan,
  perRunTable,
  rateTable,
  type Scenario,
  scenarioCost,
  scenarioTable,
  timeTable,
  totalsCost,
  totalsTable,
} from "./tables.ts";
import type { RunUptime } from "./uptime.ts";

const here = dirname(new URL(import.meta.url).pathname);
const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback;
};

const runsFile = resolve(arg("--runs", join(here, "../../2026-10-03-lane-audit/results/runs.json")));
const outDir = resolve(arg("--out", join(here, "../results")));

const data = JSON.parse(readFileSync(runsFile, "utf8")) as Extract;
const real: RunTime[] = covered(data.runs, "real").map(runTime);
const fixture: RunTime[] = covered(data.runs, "fixture").map(runTime);

const uptimeFile = join(outDir, "coachman-uptime.json");
const uptime = (JSON.parse(readFileSync(uptimeFile, "utf8")) as { rows: RunUptime[] }).rows;
const ceilingOf = (ids: string[]): number[] =>
  real.filter((t) => ids.includes(t.run)).map((t) => t.coachmanUpper);
const measured = uptime.map((u) => u.run);
const hoursOf = (seconds: number): string => (seconds / 3600).toFixed(1);
const floor = median(uptime.map((u) => u.seconds)) as number;
// the ceiling over the same runs as the floor, so both ends describe the same group of runs
const ceilingSameRuns = median(ceilingOf(measured)) as number;
const ceilingAllRuns = median(real.map((t) => t.coachmanUpper)) as number;
const coachman = { floor, ceiling: ceilingSameRuns };
const biggest: Scenario = { name: "all standard-4", lanes: "standard-4", reviewers: "standard-4", coachman: "standard-4" };
const coachmanLine = `The coachman's process time is not recorded for every launch, so it is bracketed. The floor
is the sum, over a run's coachman threads, of the last process's uptime from each thread's session
export: the median of ${uptime.length} runs is ${hoursOf(floor)} hours. The ceiling is the seconds in the stages
a leg can run in (the wait for the user's spec review included) over the same ${uptime.length} runs: a median of
${hoursOf(ceilingSameRuns)} hours. The ${real.length - uptime.length} runs without session exports are the longest by stage seconds; over all
${real.length} runs the ceiling's median is ${hoursOf(ceilingAllRuns)} hours, which would raise the top of every cell
below (the largest cell, all standard-4 with every vCPU busy, from $${dollars(scenarioCost(real, biggest, 1, ceilingSameRuns).total)}
to $${dollars(scenarioCost(real, biggest, 1, ceilingAllRuns).total)}). The cost tables use the floor and the ceiling of the same ${uptime.length} runs.`;

const uptimeSeconds = new Map(uptime.map((u) => [u.run, u.seconds]));
const totals = auditTotals(real, uptimeSeconds);
const span = isoSpan(covered(data.runs, "real"));
const TOTAL_SIZES = ["standard-2", "standard-3", "standard-4"];
const FLAT_PRICES = [25, 50, 100, 200];
const averageAt = (size: string): number => totalsCost(totals, size, 0.25).average;
const evens = (size: string): number[] => breakEven(FLAT_PRICES, averageAt(size), PLAN_FEE_PER_MONTH);
const breakEvenRows = FLAT_PRICES.map(
  (price, i) => `| $${price} | ${(evens("standard-3")[i] as number).toFixed(0)} | ${(evens("standard-4")[i] as number).toFixed(0)} |`,
).join("\n");
const allRuns = `The ${totals.runs} runs' records run from ${span?.first.slice(0, 10) ?? "?"} to ${span?.last.slice(0, 10) ?? "?"}. Together they hold
${hoursOf(totals.lanesAndReviewers)} hours of lanes and reviewers, the coachman's floor of ${hoursOf(totals.coachmanFloor)} hours over the
${totals.coachmanFloorRuns} runs with session exports, and a coachman ceiling of ${hoursOf(totals.coachmanCeiling)} hours over all ${totals.runs}. "Low" is lanes
and reviewers plus the coachman's floor, which leaves out the coachman of the ${totals.runs - totals.coachmanFloorRuns} runs without exports; "high" is
lanes and reviewers plus every stage hour of the coachman in every run, the user's waits included. "Average run" is the
high figure divided by ${totals.runs}. List rates, with no monthly allowance taken off.`;

const SCENARIOS: Scenario[] = [
  { name: "all standard-2", lanes: "standard-2", reviewers: "standard-2", coachman: "standard-2" },
  { name: "all standard-3", lanes: "standard-3", reviewers: "standard-3", coachman: "standard-3" },
  { name: "all standard-4", lanes: "standard-4", reviewers: "standard-4", coachman: "standard-4" },
  { name: "lanes and reviewers standard-3, coachman standard-4", lanes: "standard-3", reviewers: "standard-3", coachman: "standard-4" },
];

const instanceTime = `# Container time per role

A launch is one lane, one reviewer, or one coachman leg. Each row is the time such a launch ran, from
the lane audit's derived data (\`2026-10-03-lane-audit/results/runs.json\`). [method.md](../method.md)
says what each column means and what it leaves out.

## Real runs (${real.length} that reached synthesis)

${timeTable(real)}

Lanes with no recorded time, left out above: ${real.reduce((a, t) => a + t.lanesUnmeasured, 0)}.

## Fixture runs (${fixture.length} that reached synthesis)

${timeTable(fixture)}

Lanes with no recorded time, left out above: ${fixture.reduce((a, t) => a + t.lanesUnmeasured, 0)}.

## Per run, real

${perRunTable(real)}
`;

const cost = `# What that time costs on Cloudflare Containers

Rates: [pricing.mdx at cloudflare-docs 6e1b964](https://github.com/cloudflare/cloudflare-docs/blob/6e1b96433cf016efd2c0c9057a7e27a8e112376f/src/content/docs/containers/platform/pricing.mdx),
read 2026-10-08. Memory and disk are charged for what the instance type provisions, for as long as
the instance runs; CPU for active use only. The tables bracket CPU use at none, a quarter and all
vCPUs busy, since the audit holds no CPU measurement.

## One running hour

${rateTable(["lite", "basic", "standard-1", "standard-2", "standard-3", "standard-4"])}

## The median real run's container time

Lanes and reviewers at the median run's seconds from the audit. ${coachmanLine}
The gates run inside these launches and add nothing of their own. List rates, with no monthly
allowance taken off. Each cell reads "coachman at its floor to coachman at its ceiling".

${scenarioTable(real, SCENARIOS, coachman)}

## All ${real.length} runs together

${allRuns}

${totalsTable(totals, TOTAL_SIZES)}

## Against a flat monthly price

A machine billed by the month costs the same however many runs it does. Cloudflare costs the $${PLAN_FEE_PER_MONTH} plan fee plus
the average run's cost for each run. The table gives the runs a month at which the two cost the same, for flat
prices that are only examples; a reader's own price replaces them. The average run is the high end of the table above
at a quarter of the CPU busy: $${dollars(averageAt("standard-3"))} on standard-3 and $${dollars(averageAt("standard-4"))} on standard-4. Neither side's model bill is in
it, and a machine of the right size for the work is assumed.

| Flat price a month | Runs a month, standard-3 | Runs a month, standard-4 |
| --- | --- | --- |
${breakEvenRows}

## The median fixture run

The audit holds no session uptime for fixture runs, so the coachman is bracketed by zero and the
median fixture run's stage seconds (${((median(fixture.map((t) => t.coachmanUpper)) as number) / 3600).toFixed(1)} hours).

${scenarioTable(fixture, SCENARIOS, { floor: 0, ceiling: median(fixture.map((t) => t.coachmanUpper)) as number })}
`;

mkdirSync(outDir, { recursive: true });
const summary = (times: RunTime[]) => ({
  runs: times.length,
  lanes: summarizeRole(times, "lanes"),
  reviewers: summarizeRole(times, "reviewers"),
  gatesOnLanes: summarizeRole(times, "gatesOnLanes"),
  gatesOnSynthesis: summarizeRole(times, "gatesOnSynthesis"),
  coachmanUpperTotalSeconds: times.reduce((a, t) => a + t.coachmanUpper, 0),
});
writeFileSync(
  join(outDir, "instance-time.json"),
  `${JSON.stringify({ real: summary(real), fixture: summary(fixture), perRun: real }, null, 2)}\n`,
);
const stageLengths = longerThan(intervalsOfRuns(covered(data.runs, "real")).coachman, 24);
const concurrencyText = `# How many launches ran at once

The ${real.length} real runs that reached synthesis, whose records span ${span?.first.slice(0, 10) ?? "?"} to ${span?.last.slice(0, 10) ?? "?"}. A launch is an
interval: a lane from the start of implementing to its exit; a reviewer from its round's first launch line to its own
exit; a gate run for its seconds, ending when it was logged; the coachman for each stage in which a leg can run, which
includes the wait for the user's spec review, so its row is an upper bound. The load of a set of launches is how many
cover each moment, over the one window that covers all of them. [method.md](../method.md) says what this leaves out:
fixture runs, other projects and the user's own sessions shared the machine.

${loadTable(intervalsOfRuns(covered(data.runs, "real")))}

Inside any one run, at most ${peakInOneRun(covered(data.runs, "real"), false)} lanes, reviewers and gate runs ran at once, and ${peakInOneRun(covered(data.runs, "real"), true)} with the
coachman's stages. The longest single coachman stage is ${stageLengths.longest.toFixed(1)} hours, waits included, and ${stageLengths.count} stages ran longer
than 24 hours.
`;
writeFileSync(join(outDir, "concurrency.md"), concurrencyText);

// what other on-demand providers charge, from the rate tables in results/
const readRows = <T>(name: string): T[] =>
  existsSync(join(outDir, name)) ? (JSON.parse(readFileSync(join(outDir, name), "utf8")) as { rates?: T[]; machines?: T[] })[name.startsWith("machines") ? "machines" : "rates"] ?? [] : [];
const providerRates = readRows<Rate>("providers.json");
const machineRows = readRows<Machine>("machines.json");
const medianOf = (role: "lanes" | "reviewers" | "gatesOnLanes" | "gatesOnSynthesis"): number =>
  (summarizeRole(real, role).medianPerRun ?? 0) / 3600;
const gateMedian = medianOf("gatesOnLanes") + medianOf("gatesOnSynthesis");
const agentBase = medianOf("lanes") + medianOf("reviewers");
const medianRunHours = {
  agentLow: agentBase + floor / 3600 - gateMedian,
  agentHigh: agentBase + ceilingSameRuns / 3600 - gateMedian,
  gate: gateMedian,
};
const lives = runHours(covered(data.runs, "real"));
const life = { medianHours: median(lives) as number, lives };
const lifeMean = lives.reduce((a, b) => a + b, 0) / lives.length;
const gatesTotal = real.reduce((a, t) => a + t.gatesOnLanes.each.concat(t.gatesOnSynthesis.each).reduce((x, y) => x + y, 0), 0);
const allHours = profileHours({ lanesAndReviewers: totals.lanesAndReviewers, coachman: totals.coachmanCeiling, gates: gatesTotal });
const cloudflareRate = providerRates.find((r) => r.id === "cloudflare");
const sizedAverage = cloudflareRate ? runCost(cloudflareRate, allHours.agent, allHours.gate) / totals.runs : 0;
const sizedEvens = breakEven(FLAT_PRICES, sizedAverage, PLAN_FEE_PER_MONTH);
const sizedRows = FLAT_PRICES.map((price, i) => `| $${price} | ${(sizedEvens[i] as number).toFixed(0)} |`).join("\n");
const providersText = `# What other on-demand providers charge

List prices read on 2026-10-08 and 2026-10-09; each row names its page, its date and how well the rate was checked, in
\`providers.json\` and \`machines.json\`. Two kinds of work are priced. A **gate hour** is 4 vCPU and 12 GiB with every
vCPU busy. A **waiting-agent hour** is 1 vCPU and 4 GiB with a fifth of the CPU busy, the rest spent waiting on model
calls. Neither profile was measured: [#363](https://github.com/brindlewick/postmaster/issues/363) is the ticket that
would. The disk is 20 GB and 10 GB where a provider charges for it by the hour, in the first table only; egress, plan fees and, for machines billed whole, the disk and the address are left out.

A typical run, built from the median hours of each role in the instance-time tables, is ${medianRunHours.agentLow.toFixed(1)} to ${medianRunHours.agentHigh.toFixed(1)} waiting-agent hours (lanes,
reviewers and the coachman at its floor and its ceiling, less the gate) and ${medianRunHours.gate.toFixed(1)} gate hours. A provider
whose longest session is shorter than 19 hours, about the coachman's median ceiling over a whole run (18.8 hours), is left out of the first table.

## Containers and sandboxes billed by the second

${ratesTable(providerRates, { agentLow: medianRunHours.agentLow, agentHigh: medianRunHours.agentHigh, gate: medianRunHours.gate }, 19)}

## Machines billed whole

A machine of 4 vCPU and 8 GiB kept up for a run's whole life: the median run's life is ${life.medianHours.toFixed(1)} hours, the
mean ${lifeMean.toFixed(1)}, taken from the first to the last timestamp in each run's record, waits included.

${machinesTable(machineRows, life)}

## All ${totals.runs} runs together on Cloudflare, with agents sized to what they use

${allHours.agent.toFixed(0)} waiting-agent hours and ${allHours.gate.toFixed(0)} gate hours: ${cloudflareRate ? `$${sizedAverage.toFixed(2)} an average run` : "no Cloudflare row"}, against
$${averageAt("standard-4").toFixed(2)} when every launch is a standard-4. The runs a month at which a flat monthly price costs the same as that
(plan fee $${PLAN_FEE_PER_MONTH} plus the average run for each run):

| Flat price a month | Runs a month |
| --- | --- |
${sizedRows}
`;
writeFileSync(join(outDir, "providers.md"), providersText);
writeFileSync(join(outDir, "instance-time.md"), instanceTime);
writeFileSync(join(outDir, "cost.md"), cost);
process.stdout.write(`wrote ${outDir}\n`);
