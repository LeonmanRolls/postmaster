// The trial's controls (see ../method.md): each count is run on a case whose answer is known, one that
// must read non-zero and one that must read zero, through the same code. `bun controls.ts` writes
// results/controls.md and exits 1 if any control fails; controls.test.ts runs the same checks.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Extract } from "../../2026-10-03-lane-audit/apparatus/extract.ts";
import { median } from "../../2026-10-03-lane-audit/apparatus/analyze.ts";
import {
  COACHMAN_STAGES,
  intervalsOfRuns,
  load as loadOf,
  longerThan,
  peakInOneRun,
  runHours,
} from "./concurrency.ts";
import { cost, INSTANCE_TYPES, type InstanceType, perHour } from "./cost.ts";
import { covered, runTime, seconds, summarizeRole } from "./instance-time.ts";
import type { Launch } from "./measure.ts";
import { CONTRIBUTOR_TIER, type Prices, roleDollars, STANDARD_TIER, withRatesOf } from "./model-bill.ts";
import { auditTotals, totalsCost } from "./tables.ts";
import { AGENT, breakEvenRuns, fits, GATE, hourly, type Machine, profileHours, type Rate } from "./providers.ts";
import { totalInput } from "./tokens.ts";
import type { RunUptime } from "./uptime.ts";

export type Control = {
  id: string;
  kind: "positive" | "negative";
  what: string;
  expected: string;
  got: string;
  pass: boolean;
};

export type Inputs = {
  audit: Extract;
  launches: Launch[];
  uptime: RunUptime[];
  prices: Prices;
  providers: Rate[];
  machines: Machine[];
};

const within = (got: number, want: number, tolerance: number): boolean => Math.abs(got - want) <= tolerance;
const fmt = (n: number, digits = 1): string => n.toFixed(digits);
const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

export function runControls(inp: Inputs): Control[] {
  const out: Control[] = [];
  const add = (c: Omit<Control, "pass"> & { pass: boolean }): void => {
    out.push(c);
  };
  const real = covered(inp.audit.runs, "real").map(runTime);

  // 1. the audit's own published gate figures
  const gl = summarizeRole(real, "gatesOnLanes");
  const gs = summarizeRole(real, "gatesOnSynthesis");
  add({
    id: "C1",
    kind: "positive",
    what: "gate runs on lane branches, counted through summarizeRole",
    expected: "36 runs and 6.5 hours, as the lane audit published",
    got: `${gl.launches} runs, ${fmt(gl.totalSeconds / 3600)} hours`,
    pass: gl.launches === 36 && within(gl.totalSeconds / 3600, 6.5, 0.05),
  });
  add({
    id: "C2",
    kind: "positive",
    what: "gate runs on the synthesis, through the same code",
    expected: "260 runs and 43.5 hours, as the lane audit published",
    got: `${gs.launches} runs, ${fmt(gs.totalSeconds / 3600)} hours`,
    pass: gs.launches === 260 && within(gs.totalSeconds / 3600, 43.5, 0.05),
  });

  // 2. a lane's seconds recomputed from its own timestamps
  const r201 = inp.audit.runs.find((r) => r.id === "201");
  const sol = r201?.lanes.find((l) => l.lane === "sol");
  const byHand =
    sol?.implementFrom && sol.finished
      ? Math.round((Date.parse(sol.finished) - Date.parse(sol.implementFrom)) / 1000)
      : null;
  add({
    id: "C3",
    kind: "positive",
    what: "one lane's implementSeconds against its start and finish timestamps (run 201, lane sol)",
    expected: "2001 seconds both ways",
    got: `field ${sol?.implementSeconds}, timestamps ${byHand}`,
    pass: sol?.implementSeconds === 2001 && byHand === 2001,
  });

  // 3. the same lane priced by hand
  const standard4 = INSTANCE_TYPES["standard-4"] as InstanceType;
  const priced = cost(2001, standard4, 0);
  add({
    id: "C4",
    kind: "positive",
    what: "that lane's container cost at standard-4, memory and disk only",
    expected: "2001 x (12 x 0.0000025 + 20 x 0.00000007) = $0.0628314",
    got: `$${priced.toFixed(7)}`,
    pass: within(priced, 0.0628314, 1e-9),
  });

  // 4. zero in, zero out
  const none = runTime({ id: "none", kind: "real", parked: false, synthesis: null, lanes: [], gates: [], stages: [], reviewLaunches: [], reviewDone: [] } as never);
  add({
    id: "C5",
    kind: "negative",
    what: "a run with no lanes, gates, stages or reviewers, through runTime and cost",
    expected: "0 seconds in every role and $0",
    got: `${seconds(none.lanes) + seconds(none.reviewers) + seconds(none.gatesOnLanes) + none.coachmanUpper} seconds, $${cost(0, standard4, 1)}`,
    pass:
      seconds(none.lanes) + seconds(none.reviewers) + seconds(none.gatesOnLanes) + none.coachmanUpper === 0 &&
      cost(0, standard4, 1) === 0,
  });

  // 5. the coachman's floor is below its ceiling in every run that has both
  const ceilings = new Map(real.map((t) => [t.run, t.coachmanUpper]));
  const pairs = inp.uptime.filter((u) => ceilings.has(u.run));
  const violations = pairs.filter((u) => u.seconds > (ceilings.get(u.run) as number));
  add({
    id: "C6",
    kind: "positive",
    what: "the coachman's floor (session uptime) against its ceiling (stage seconds), run by run",
    expected: "floor at most ceiling in all runs that have both",
    got: `${pairs.length - violations.length} of ${pairs.length} runs`,
    pass: pairs.length > 0 && violations.length === 0,
  });
  add({
    id: "C7",
    kind: "negative",
    what: "the same comparison with floor and ceiling swapped",
    expected: "it must fail in at least one run, or the comparison tells nothing",
    got: `${pairs.filter((u) => (ceilings.get(u.run) as number) > u.seconds).length} of ${pairs.length} runs fail when swapped`,
    pass: pairs.some((u) => (ceilings.get(u.run) as number) > u.seconds),
  });

  // 6. token totals against the lane audit's published role totals
  const sel = (role: Launch["role"], harness: string): Launch[] =>
    inp.launches.filter((l) => l.role === role && l.harness === harness);
  const totals = (ls: Launch[]) => ({
    launches: ls.length,
    input: sum(ls.map((l) => totalInput(l.tokens))) / 1e6,
    uncached: sum(ls.map((l) => l.tokens.uncached)) / 1e6,
    output: sum(ls.map((l) => l.tokens.output)) / 1e3,
    usd: sum(ls.map((l) => l.tokens.reportedUsd ?? 0)),
  });
  const co = totals(sel("coachman", "muse"));
  add({
    id: "C8",
    kind: "positive",
    what: "coachman tokens from the session exports (14 runs)",
    expected: "about 1478M in and 5253k out, as the lane audit published",
    got: `${fmt(co.input)}M in, ${fmt(co.output, 0)}k out`,
    pass: within(co.input, 1478, 1) && within(co.output, 5253, 5),
  });
  const rc = totals(sel("reviewer", "codex"));
  add({
    id: "C9",
    kind: "positive",
    what: "codex reviewer tokens, input counting cache reads as codex reports it",
    expected: "119 launches, about 240M in, 2934k out",
    got: `${rc.launches} launches, ${fmt(rc.input)}M in, ${fmt(rc.output, 0)}k out`,
    pass: rc.launches === 119 && within(rc.input, 240, 1) && within(rc.output, 2934, 5),
  });
  const wc = totals(sel("workhorse", "codex"));
  add({
    id: "C10",
    kind: "positive",
    what: "codex workhorse tokens",
    expected: "18 launches, about 438M in, 2583k out",
    got: `${wc.launches} launches, ${fmt(wc.input)}M in, ${fmt(wc.output, 0)}k out`,
    pass: wc.launches === 18 && within(wc.input, 438, 1) && within(wc.output, 2583, 5),
  });
  const rm = totals(sel("reviewer", "mimo"));
  const wm = totals(sel("workhorse", "mimo"));
  add({
    id: "C11",
    kind: "positive",
    what: "MiMo uncached input, which is what the audit counted as input (the audit left out cache reads)",
    expected: "reviewers 118 launches and 17M, workhorses 18 launches and 7.8M",
    got: `reviewers ${rm.launches} and ${fmt(rm.uncached)}M, workhorses ${wm.launches} and ${fmt(wm.uncached)}M`,
    pass: rm.launches === 118 && within(rm.uncached, 17, 0.5) && wm.launches === 18 && within(wm.uncached, 7.8, 0.1),
  });
  const ro = totals(sel("reviewer", "claude"));
  add({
    id: "C12",
    kind: "positive",
    what: "Opus reviewer launches and the dollars Claude Code reported",
    expected: "71 launches and $644.17, as the lane audit published",
    got: `${ro.launches} launches, $${fmt(ro.usd, 2)}`,
    pass: ro.launches === 71 && within(ro.usd, 644.17, 0.01),
  });
  add({
    id: "C13",
    kind: "negative",
    what: "a harness with no launches in the data (grok), through the same selection",
    expected: "0 launches and 0 tokens",
    got: `${totals(sel("workhorse", "grok")).launches} launches`,
    pass: totals(sel("workhorse", "grok")).launches === 0,
  });
  add({
    id: "C14",
    kind: "positive",
    what: "MiMo output differs from the audit's by its reasoning tokens, which the audit left out",
    expected: "more than the audit's 1019k reviewer output, since reasoning tokens are counted as output (how Xiaomi bills them is not stated, so this is an assumption)",
    got: `${fmt(rm.output, 0)}k`,
    pass: rm.output > 1019,
  });

  // 7. Claude Code's reported dollars are list price: recompute from per-model tokens
  const opus = inp.prices.models["claude-opus-5-5"];
  const claude = sel("reviewer", "claude");
  if (opus) {
    let inside = 0;
    let other = 0;
    let empty = 0;
    let considered = 0;
    for (const l of claude) {
      const mu = l.modelUsage ?? {};
      const names = Object.keys(mu);
      if (names.some((n) => n !== "claude-opus-5-5")) {
        other += 1;
        continue;
      }
      const u = mu["claude-opus-5-5"];
      if (!u || l.tokens.reportedUsd === null) {
        empty += 1;
        continue;
      }
      considered += 1;
      const base = (u.input * opus.input + u.cacheRead * opus.cachedInput + u.output * opus.output) / 1e6;
      const low = base + (u.cacheWrite * opus.cacheWrite) / 1e6;
      const high = base + (u.cacheWrite * 8) / 1e6;
      if (l.tokens.reportedUsd >= low - 0.01 && l.tokens.reportedUsd <= high + 0.01) inside += 1;
    }
    add({
      id: "C15",
      kind: "positive",
      what: "each Opus launch's reported dollars against its own tokens at the published Opus 5.5 prices, between all cache writes at 5 minutes and all at 1 hour",
      expected: "inside the bracket for every launch that used no other model",
      got: `${inside} of ${considered} launches (${other} used another Claude model besides, ${empty} recorded no usage)`,
      pass: considered > 0 && inside === considered,
    });
    // the same check with the wrong price must fail
    let insideWrong = 0;
    for (const l of claude) {
      const u = (l.modelUsage ?? {})["claude-opus-5-5"];
      if (!u || l.tokens.reportedUsd === null || Object.keys(l.modelUsage ?? {}).length !== 1) continue;
      const base = (u.input * 15 + u.cacheRead * 1.5 + u.output * 75) / 1e6;
      const high = base + (u.cacheWrite * 30) / 1e6;
      if (l.tokens.reportedUsd <= high + 0.01 && l.tokens.reportedUsd >= base) insideWrong += 1;
    }
    add({
      id: "C16",
      kind: "negative",
      what: "the same bracket with Opus 4.1's prices ($15 in, $75 out), which are not Opus 5.5's",
      expected: "the reported dollars fall inside for almost no launch",
      got: `${insideWrong} launches`,
      pass: insideWrong < considered / 4,
    });
  }

  // 8. every price has a source and a date
  const missing = Object.entries(inp.prices.models).filter(([, p]) => !p.source || !p.read);
  add({
    id: "C17",
    kind: "positive",
    what: "every price in prices.json names its page and the day it was read",
    expected: "none missing",
    got: `${missing.length} missing of ${Object.keys(inp.prices.models).length}`,
    pass: missing.length === 0,
  });

  // 8b. the coachman re-priced at Meta's standard tier: summed launch by launch, and from the summed tokens
  const runsById = new Map(inp.audit.runs.map((r) => [r.id, r]));
  const standardPrices = inp.prices.models[STANDARD_TIER];
  if (standardPrices) {
    const coach = inp.launches.filter((l) => l.role === "coachman");
    const sumKind = (k: "uncached" | "cacheRead" | "cacheWrite" | "output"): number =>
      sum(coach.map((l) => l.tokens[k]));
    const byHand =
      (sumKind("uncached") * standardPrices.input +
        sumKind("cacheRead") * standardPrices.cachedInput +
        sumKind("cacheWrite") * standardPrices.cacheWrite +
        sumKind("output") * standardPrices.output) /
      1e6;
    const swapped = withRatesOf(inp.prices, { from: CONTRIBUTOR_TIER, to: STANDARD_TIER });
    const launchByLaunch = roleDollars(inp.launches, runsById, swapped, "coachman");
    add({
      id: "C19",
      kind: "positive",
      what: "the coachman's dollars at Meta's standard tier, summed launch by launch and recomputed from the summed tokens",
      expected: "the two agree to a cent",
      got: `$${launchByLaunch.toFixed(2)} and $${byHand.toFixed(2)} (${coach.length} runs)`,
      pass: coach.length > 0 && within(launchByLaunch, byHand, 0.01),
    });
    const base = roleDollars(inp.launches, runsById, inp.prices, "coachman");
    const none = roleDollars(
      inp.launches,
      runsById,
      withRatesOf(inp.prices, { from: "no-launch-used-this", to: STANDARD_TIER }),
      "coachman",
    );
    add({
      id: "C20",
      kind: "negative",
      what: "the same re-pricing for a model no launch used",
      expected: "the coachman's dollars do not move",
      got: `$${base.toFixed(2)} before and $${none.toFixed(2)} after`,
      pass: base > 0 && base === none,
    });
  }

  // 9. the median helper agrees with a count by hand
  add({
    id: "C18",
    kind: "positive",
    what: "median of the audit helper on a case worked by hand",
    expected: "median of 1, 2, 9 is 2 and of 1, 2, 3, 10 is 2.5",
    got: `${median([9, 1, 2])} and ${median([10, 3, 2, 1])}`,
    pass: median([9, 1, 2]) === 2 && median([10, 3, 2, 1]) === 2.5,
  });

  // 10. the Cloudflare cost of all the runs together
  const uptimeSeconds = new Map(inp.uptime.map((u) => [u.run, u.seconds]));
  const allTotals = auditTotals(real, uptimeSeconds);
  const standard3 = INSTANCE_TYPES["standard-3"] as InstanceType;
  const viaCost = cost(allTotals.lanesAndReviewers, standard3, 0.25);
  const viaHours = (allTotals.lanesAndReviewers / 3600) * perHour(standard3, 0.25);
  add({
    id: "C21",
    kind: "positive",
    what: "the lanes' and reviewers' hours of all the runs at standard-3 with a quarter of the CPU busy, through cost() and as hours times the hourly rate",
    expected: "the two agree to a cent",
    got: `$${viaCost.toFixed(2)} and $${viaHours.toFixed(2)} (${fmt(allTotals.lanesAndReviewers / 3600)} hours)`,
    pass: viaCost > 0 && within(viaCost, viaHours, 0.01),
  });
  const runByRun = sum(real.map((t) => cost(seconds(t.lanes) + seconds(t.reviewers) + t.coachmanUpper, standard3, 0.25)));
  add({
    id: "C22",
    kind: "positive",
    what: "the high end of all the runs together, against the same cost summed run by run",
    expected: "the two agree to within a millionth of a dollar",
    got: `$${totalsCost(allTotals, "standard-3", 0.25).high.toFixed(4)} and $${runByRun.toFixed(4)}`,
    pass: within(totalsCost(allTotals, "standard-3", 0.25).high, runByRun, 1e-6),
  });
  const empty = totalsCost(auditTotals([], new Map()), "standard-3", 0.25);
  add({
    id: "C23",
    kind: "negative",
    what: "the totals over no runs, through the same code",
    expected: "$0 low, $0 high and an average of 0, not NaN",
    got: `$${empty.low} low, $${empty.high} high, average ${empty.average}`,
    pass: empty.low === 0 && empty.high === 0 && empty.average === 0,
  });

  // 11. how many launches ran at once
  const kinds = intervalsOfRuns(covered(inp.audit.runs, "real"));
  const secondsOf = (xs: ReadonlyArray<readonly [number, number]>): number => sum(xs.map(([a, b]) => b - a));
  const totalsLane = summarizeRole(real, "lanes").totalSeconds;
  const totalsReview = summarizeRole(real, "reviewers").totalSeconds;
  const totalsGate =
    summarizeRole(real, "gatesOnLanes").totalSeconds + summarizeRole(real, "gatesOnSynthesis").totalSeconds;
  const totalsCoach = sum(real.map((t) => t.coachmanUpper));
  const intervalsAgree =
    within(secondsOf(kinds.lanes), totalsLane, 1) &&
    within(secondsOf(kinds.reviewers), totalsReview, 1) &&
    within(secondsOf(kinds.gates), totalsGate, 1) &&
    within(secondsOf(kinds.coachman), totalsCoach, 1);
  add({
    id: "C24",
    kind: "positive",
    what: "the launches rebuilt as intervals from their timestamps, against the hours the instance-time tables summed from each launch's own seconds",
    expected: "the same total for lanes, reviewers, gate runs and the coachman's stages, to a second",
    got: `${fmt(secondsOf(kinds.lanes) / 3600)}, ${fmt(secondsOf(kinds.reviewers) / 3600)}, ${fmt(secondsOf(kinds.gates) / 3600)} and ${fmt(secondsOf(kinds.coachman) / 3600)} hours, against ${fmt(totalsLane / 3600)}, ${fmt(totalsReview / 3600)}, ${fmt(totalsGate / 3600)} and ${fmt(totalsCoach / 3600)}`,
    pass: intervalsAgree,
  });
  const everyLaunch = [...kinds.lanes, ...kinds.reviewers, ...kinds.gates, ...kinds.coachman];
  const everyLoad = loadOf(everyLaunch);
  add({
    id: "C25",
    kind: "positive",
    what: "the average load over the window, times the window's seconds, against the sum of every interval's length",
    expected: "equal: the area under the load curve is the sum of the intervals",
    got: `${fmt((everyLoad.average * everyLoad.seconds) / 3600, 2)} and ${fmt(secondsOf(everyLaunch) / 3600, 2)} hours`,
    pass: within(everyLoad.average * everyLoad.seconds, secondsOf(everyLaunch), 1),
  });
  const noLoad = loadOf([]);
  add({
    id: "C26",
    kind: "negative",
    what: "the load of no launches, through the same code",
    expected: "a peak of 0 and an average of 0",
    got: `peak ${noLoad.peak}, average ${noLoad.average}`,
    pass: noLoad.peak === 0 && noLoad.average === 0,
  });

  // 12. what other providers charge
  const cloudflareRow = inp.providers.find((r) => r.id === "cloudflare");
  const standard4Type = INSTANCE_TYPES["standard-4"] as InstanceType;
  if (cloudflareRow) {
    const agentByHand = 0.2 * 0.072 + 4 * 0.009 + 10 * 0.000252;
    add({
      id: "C27",
      kind: "positive",
      what: "Cloudflare's row in the provider table: a gate hour against the cost module's standard-4 hour, and a waiting-agent hour against its arithmetic by hand",
      expected: "$0.40104 and $0.05292, agreeing to a millionth of a dollar",
      got: `$${hourly(cloudflareRow, GATE).toFixed(5)} against $${perHour(standard4Type, 1).toFixed(5)}, and $${hourly(cloudflareRow, AGENT).toFixed(5)} against $${agentByHand.toFixed(5)}`,
      pass:
        within(hourly(cloudflareRow, GATE), perHour(standard4Type, 1), 1e-6) &&
        within(hourly(cloudflareRow, AGENT), agentByHand, 1e-6),
    });
  }
  const gatesSeconds = sum(real.map((t) => seconds(t.gatesOnLanes) + seconds(t.gatesOnSynthesis)));
  const lanesReviewersSeconds = sum(real.map((t) => seconds(t.lanes) + seconds(t.reviewers)));
  const coachmanSeconds = sum(real.map((t) => t.coachmanUpper));
  const split = profileHours({ lanesAndReviewers: lanesReviewersSeconds, coachman: coachmanSeconds, gates: gatesSeconds });
  add({
    id: "C28",
    kind: "positive",
    what: "the waiting-agent hours and the gate hours of all the runs, against every launch hour (lanes, reviewers and the coachman's ceiling)",
    expected: "the two add up to the same hours, since the gate is carved out of the coachman and counted once",
    got: `${fmt(split.agent + split.gate)} against ${fmt((lanesReviewersSeconds + coachmanSeconds) / 3600)} hours`,
    pass: within(split.agent + split.gate, (lanesReviewersSeconds + coachmanSeconds) / 3600, 1e-9),
  });
  const fly = inp.providers.find((r) => r.id === "fly-performance");
  if (fly) {
    const derived = 4 * fly.vcpuHour + 8 * fly.gibHour;
    const pagePerSecond = 0.000050928;
    const printedHourly = 0.1833;
    add({
      id: "C29",
      kind: "positive",
      what: "Fly's performance-4x with 8 GB from the provider table's per-vCPU and per-GiB rates, against the $0.1833 an hour that Fly's pricing page prints for it and the per-second figure from the documentation's constants times 3600",
      expected: "$0.1833 an hour all three ways, to a hundredth of a cent",
      got: `$${derived.toFixed(4)} against $${printedHourly.toFixed(4)} and $${(pagePerSecond * 3600).toFixed(4)}`,
      pass: within(derived, pagePerSecond * 3600, 1e-4) && within(derived, printedHourly, 1e-4),
    });
    add({
      id: "C30",
      kind: "negative",
      what: "the same Fly price against an unchecked figure of $0.0001386 a second that had been given for it",
      expected: "far apart: the unchecked figure is 2.7 times the derived price",
      got: `${(0.0001386 * 3600).toFixed(3)} against ${derived.toFixed(3)} an hour, a ratio of ${((0.0001386 * 3600) / derived).toFixed(2)}`,
      pass: (0.0001386 * 3600) / derived > 2,
    });
  }
  const daytona = inp.providers.find((r) => r.id === "daytona");
  if (daytona) {
    add({
      id: "C31",
      kind: "negative",
      what: "Daytona's default size limit of 4 vCPU and 8 GB against the 12 GiB gate profile, through the fit check",
      expected: "the gate does not fit and the waiting agent does",
      got: `gate fits: ${fits(daytona, GATE)}, agent fits: ${fits(daytona, AGENT)}`,
      pass: !fits(daytona, GATE) && fits(daytona, AGENT),
    });
  }
  const unnamed = [...inp.providers, ...inp.machines].filter((r) => !r.source || !r.read || !r.checked);
  add({
    id: "C32",
    kind: "positive",
    what: "every row of the provider and machine tables names its page, the day it was read and how well it was checked",
    expected: "none missing",
    got: `${unnamed.length} missing of ${inp.providers.length + inp.machines.length}`,
    pass: unnamed.length === 0,
  });
  const lives = runHours(covered(inp.audit.runs, "real"));
  const medianLife = median(lives) as number;
  const vultr = inp.machines.find((m) => m.id === "vultr-vc2-4c-8gb");
  if (vultr && vultr.monthly !== null) {
    const byHand = vultr.monthly / (Math.ceil(medianLife) * vultr.hourly);
    const fromCode = breakEvenRuns(vultr, medianLife) as number;
    add({
      id: "C33",
      kind: "positive",
      what: "the runs a month that cost what Vultr's 4 vCPU and 8 GiB machine costs kept up all month, from the table's code against $40 over the median life rounded up to a whole hour at $0.055",
      expected: "the same number, about 26",
      got: `${fromCode.toFixed(2)} against ${byHand.toFixed(2)} (median life ${medianLife.toFixed(1)} hours)`,
      pass: within(fromCode, byHand, 1e-9),
    });
  }
  const azure = inp.machines.find((m) => m.id === "azure-spot-f4s-v2");
  if (azure) {
    add({
      id: "C34",
      kind: "negative",
      what: "the same break-even for Azure Spot, which has no monthly price, through the same code",
      expected: "none, not zero and not NaN",
      got: String(breakEvenRuns(azure, medianLife)),
      pass: breakEvenRuns(azure, medianLife) === null,
    });
  }
  const realRuns = covered(inp.audit.runs, "real");
  const rawStages = realRuns.flatMap((r) =>
    r.stages
      .filter((st) => COACHMAN_STAGES.includes(st.stage) && st.seconds !== null && st.seconds > 0)
      .map((st) => (st.seconds as number) / 3600),
  );
  const fromIntervals = longerThan(kinds.coachman, 24);
  const rawLongest = Math.max(...rawStages);
  const rawOver = rawStages.filter((h) => h > 24).length;
  add({
    id: "C35",
    kind: "positive",
    what: "the longest coachman stage and the number of stages over 24 hours, from the rebuilt intervals against the audit's own stage seconds",
    expected: "the same longest stage and the same count",
    got: `${fromIntervals.longest.toFixed(2)} hours and ${fromIntervals.count} against ${rawLongest.toFixed(2)} hours and ${rawOver}`,
    pass: within(fromIntervals.longest, rawLongest, 1e-9) && fromIntervals.count === rawOver,
  });
  add({
    id: "C36",
    kind: "negative",
    what: "a stage of exactly 24 hours, and one of 24 hours and a second, through the same count of stages over 24 hours",
    expected: "the first is not counted and the second is",
    got: `${longerThan([[0, 86400]], 24).count} and ${longerThan([[0, 86401]], 24).count}`,
    pass: longerThan([[0, 86400]], 24).count === 0 && longerThan([[0, 86401]], 24).count === 1,
  });
  const onePeak = peakInOneRun(realRuns, false);
  const allPeak = loadOf([...kinds.lanes, ...kinds.reviewers, ...kinds.gates]).peak;
  add({
    id: "C37",
    kind: "positive",
    what: "the most lanes, reviewers and gate runs at once inside any one run, against the most at once across all the runs together",
    expected: "at least 1 and no more than the all-runs peak, since one run is part of the whole",
    got: `${onePeak} against ${allPeak}`,
    pass: onePeak >= 1 && onePeak <= allPeak,
  });
  return out;
}

export function render(controls: readonly Control[]): string {
  const lines = [
    "# Controls",
    "",
    "Each count in the trial has a control that reads non-zero or a known number and one that reads zero,",
    "through the same code. `bun controls.ts` writes this file; `controls.test.ts` runs the same checks.",
    "",
    "| | Kind | What | Expected | Got | Result |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  for (const c of controls) {
    lines.push(`| ${c.id} | ${c.kind} | ${c.what} | ${c.expected} | ${c.got} | ${c.pass ? "pass" : "FAIL"} |`);
  }
  return `${lines.join("\n")}\n`;
}

export function load(results: string, audit: string): Inputs {
  const read = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;
  return {
    audit: read<Extract>(audit),
    launches: read<{ launches: Launch[] }>(join(results, "tokens-by-kind.json")).launches,
    uptime: read<{ rows: RunUptime[] }>(join(results, "coachman-uptime.json")).rows,
    prices: read<Prices>(join(results, "prices.json")),
    providers: read<{ rates: Rate[] }>(join(results, "providers.json")).rates,
    machines: read<{ machines: Machine[] }>(join(results, "machines.json")).machines,
  };
}

if (import.meta.main) {
  const here = dirname(new URL(import.meta.url).pathname);
  const results = resolve(join(here, "../results"));
  const audit = resolve(join(here, "../../2026-10-03-lane-audit/results/runs.json"));
  const controls = runControls(load(results, audit));
  writeFileSync(join(results, "controls.md"), render(controls));
  const failed = controls.filter((c) => !c.pass);
  process.stdout.write(`${controls.length - failed.length} of ${controls.length} controls pass\n`);
  if (failed.length > 0) process.exit(1);
}
