// The model bill of the audited runs at pay-per-token prices (see ../method.md): the measured token
// kinds (results/tokens-by-kind.json) times the vendor rates in results/prices.json, by role and
// lane. Reads only derived data and writes results/model-bill.md.
//
//   bun model-bill.ts [--results <dir>] [--audit <runs.json>]
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { RunRecord } from "../../2026-10-03-lane-audit/apparatus/records.ts";
import { bracket, type Price } from "./bill.ts";
import type { Launch } from "./measure.ts";
import { add, type Tokens, totalInput, zero } from "./tokens.ts";

export type PriceEntry = Price & { source: string; tier: string; read: string };
export type Prices = { models: Record<string, PriceEntry>; notes?: string[] };

const here = dirname(new URL(import.meta.url).pathname);
const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback;
};

/** The model a lane ran on in a run, from the audit's team record; the coachman's by its role. */
export function modelOf(run: RunRecord | undefined, launch: Launch): string | null {
  if (launch.role === "coachman") return run?.team?.coachman?.model ?? null;
  return run?.team?.lanes[launch.lane]?.model ?? null;
}

export type Row = {
  key: string;
  launches: number;
  tokens: Tokens;
  model: string;
  /** dollars as measured; for Claude Code the harness's own cumulative figure, which is at list price */
  measured: number;
  /** dollars if every input token were charged the plain input rate */
  noCache: number;
  priced: boolean;
};

/** The dollars of one launch: the harness's reported figure where it is cumulative, else tokens times rates. */
export function launchDollars(l: Launch, price: Price | undefined): { measured: number; noCache: number } | null {
  if (!price) return null;
  if (l.harness === "claude" && l.tokens.reportedUsd !== null && l.modelUsage) {
    const all = Object.values(l.modelUsage).reduce(
      (a, u) => ({ input: a.input + u.input + u.cacheRead + u.cacheWrite, output: a.output + u.output }),
      { input: 0, output: 0 },
    );
    return {
      measured: l.tokens.reportedUsd,
      noCache: (all.input * price.input + all.output * price.output) / 1_000_000,
    };
  }
  return bracket(l.tokens, price);
}

/** Group launches by role, lane and model, and price each group. */
export function rows(
  launches: readonly Launch[],
  runs: ReadonlyMap<string, RunRecord>,
  prices: Prices,
): Row[] {
  const groups = new Map<
    string,
    { launches: number; tokens: Tokens; model: string; measured: number; noCache: number; priced: boolean }
  >();
  for (const l of launches) {
    const model = modelOf(runs.get(l.run), l) ?? "unknown";
    const key = `${l.role}|${l.lane}|${model}`;
    const g = groups.get(key) ?? { launches: 0, tokens: zero(), model, measured: 0, noCache: 0, priced: true };
    g.launches += 1;
    g.tokens = add(g.tokens, l.tokens);
    const d = launchDollars(l, prices.models[model]);
    if (d === null) g.priced = false;
    else {
      g.measured += d.measured;
      g.noCache += d.noCache;
    }
    groups.set(key, g);
  }
  return [...groups.entries()]
    .map(([key, g]) => ({ key, ...g }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

export type PerRun = { run: string; opus: number; other: number };

/** The prices with one model's tokens billed at another model's rates, to ask what a different tier would cost. */
export function withRatesOf(prices: Prices, swap: { from: string; to: string }): Prices {
  const to = prices.models[swap.to];
  if (!to) throw new Error(`no price for ${swap.to}`);
  return { ...prices, models: { ...prices.models, [swap.from]: to } };
}

/** Dollars as measured, summed over the launches of one role that have a price. */
export function roleDollars(
  launches: readonly Launch[],
  runs: ReadonlyMap<string, RunRecord>,
  prices: Prices,
  role: Launch["role"],
): number {
  let total = 0;
  for (const l of launches) {
    if (l.role !== role) continue;
    const d = launchDollars(l, prices.models[modelOf(runs.get(l.run), l) ?? "unknown"]);
    if (d !== null) total += d.measured;
  }
  return total;
}

/** Dollars as measured per run, split into the Opus security review and everything else. */
export function perRun(
  launches: readonly Launch[],
  runs: ReadonlyMap<string, RunRecord>,
  prices: Prices,
): PerRun[] {
  const out = new Map<string, { opus: number; other: number }>();
  for (const l of launches) {
    const model = modelOf(runs.get(l.run), l) ?? "unknown";
    const d = launchDollars(l, prices.models[model]);
    if (d === null) continue;
    const row = out.get(l.run) ?? { opus: 0, other: 0 };
    if (l.harness === "claude") row.opus += d.measured;
    else row.other += d.measured;
    out.set(l.run, row);
  }
  return [...out.entries()].map(([run, v]) => ({ run, ...v }));
}

const m = (n: number): string => (n / 1e6).toFixed(1);
const usd = (n: number): string => (n < 100 ? n.toFixed(2) : n.toFixed(0));
const rate = (p: Price): string => `$${p.input} / $${p.cachedInput} / $${p.output}`;

/** The two tiers of the coachman's model, which differ only in price and in what the vendor may train on. */
export const CONTRIBUTOR_TIER = "muse-spark-1.3-contributor";
export const STANDARD_TIER = "muse-spark-1.3";

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);
const median = (xs: readonly number[]): number => {
  const v = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 === 1 ? (v[mid] as number) : ((v[mid - 1] as number) + (v[mid] as number)) / 2;
};

/** The per-run dollars as a table: mean, median and most of the Opus security review, everything else and the total. */
export function perRunSection(per: readonly PerRun[], what: string): string {
  const totals = per.map((p) => p.opus + p.other);
  const others = per.map((p) => p.other);
  const opuses = per.map((p) => p.opus);
  return `Per run (${per.length} runs with priced launches), ${what}:

| | Opus security review | Everything else | Total |
| --- | --- | --- | --- |
| mean | ${usd(sum(opuses) / per.length)} | ${usd(sum(others) / per.length)} | ${usd(sum(totals) / per.length)} |
| median | ${usd(median(opuses))} | ${usd(median(others))} | ${usd(median(totals))} |
| most | ${usd(Math.max(...opuses))} | ${usd(Math.max(...others))} | ${usd(Math.max(...totals))} |
| share of all dollars | ${((100 * sum(opuses)) / sum(totals)).toFixed(0)}% | ${((100 * sum(others)) / sum(totals)).toFixed(0)}% | |
`;
}

export function table(rs: readonly Row[], runCount: number): string {
  const lines = [
    "| Role | Lane | Model | Launches | Uncached in, M | Cache reads, M | Cache writes, M | Out, M | $ as measured | $ if no cache hit | Reported $ |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  let measured = 0;
  let noCache = 0;
  for (const r of rs) {
    const [role, lane] = r.key.split("|");
    measured += r.measured;
    noCache += r.noCache;
    lines.push(
      `| ${role} | ${lane} | ${r.model} | ${r.launches} | ${m(r.tokens.uncached)} | ${m(r.tokens.cacheRead)} | ${m(r.tokens.cacheWrite)} | ${m(r.tokens.output)} | ${r.priced ? usd(r.measured) : "no price"} | ${r.priced ? usd(r.noCache) : "no price"} | ${r.tokens.reportedUsd === null ? "–" : usd(r.tokens.reportedUsd)} |`,
    );
  }
  lines.push(
    `| **all priced** | | | | | | | | **${usd(measured)}** | **${usd(noCache)}** | |`,
    `| **per run** (${runCount}) | | | | | | | | **${usd(measured / runCount)}** | **${usd(noCache / runCount)}** | |`,
  );
  return lines.join("\n");
}

function main(): void {
  const results = resolve(arg("--results", join(here, "../results")));
  const audit = resolve(arg("--audit", join(here, "../../2026-10-03-lane-audit/results/runs.json")));
  const launches = (JSON.parse(readFileSync(join(results, "tokens-by-kind.json"), "utf8")) as { launches: Launch[] }).launches;
  const prices = JSON.parse(readFileSync(join(results, "prices.json"), "utf8")) as Prices;
  const runs = new Map(
    (JSON.parse(readFileSync(audit, "utf8")) as { runs: RunRecord[] }).runs.map((r) => [r.id, r]),
  );
  const runIds = new Set(launches.map((l) => l.run));
  const rs = rows(launches, runs, prices);
  const input = launches.reduce((a, l) => a + totalInput(l.tokens), 0);
  const perRunText = perRunSection(perRun(launches, runs, prices), "dollars as measured");
  const standard = prices.models[STANDARD_TIER];
  const contributor = prices.models[CONTRIBUTOR_TIER];
  const tierText =
    standard && contributor
      ? `
## If the coachman ran on Meta's standard tier

The coachman ran on \`${CONTRIBUTOR_TIER}\` (${rate(contributor)} per million tokens: input, cached input, output),
the tier that lets Meta train on what is sent. The standard tier, \`${STANDARD_TIER}\`, is ${rate(standard)}.
The coachman's tokens come to $${usd(roleDollars(launches, runs, prices, "coachman"))} at the contributor tier and
$${usd(roleDollars(launches, runs, withRatesOf(prices, { from: CONTRIBUTOR_TIER, to: STANDARD_TIER }), "coachman"))} at the standard tier. Everything else as above.

${perRunSection(perRun(launches, runs, withRatesOf(prices, { from: CONTRIBUTOR_TIER, to: STANDARD_TIER })), "coachman at the standard tier, dollars as measured")}`
      : "";
  const text = `# The model bill at pay-per-token prices

${runIds.size} audited real runs, ${launches.length} launches (the coachman as one row per run, from its
session exports). Tokens by kind are read from each launch's own stream (tokens-by-kind.json); the
rates are in prices.json with where each was read. "As measured" prices each kind at its own rate;
"if no cache hit" prices every input token at the plain input rate, which brackets what the vendor's
cache does. "Reported" is the dollars the harness itself wrote, at list price where it says so.
Input in total: ${m(input)} M tokens.

${table(rs, runIds.size)}

${perRunText}${tierText}`;
  writeFileSync(join(results, "model-bill.md"), text);
  process.stdout.write("wrote model-bill.md\n");
}

if (import.meta.main) main();
