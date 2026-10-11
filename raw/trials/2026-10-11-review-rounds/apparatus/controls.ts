// Controls for the counts and the tracing of the record (see ../method.md). Each control is a
// positive and a negative case through the same code, or a figure from a second record.
//
//   bun --no-env-file --config=/dev/null controls.ts --results <dir> --repo <checkout> --cut <iso>
//
// The comparison with the lane audit's table and the 21-run count reads their committed results.
// The check that the commit named as a line's origin added that line runs `git show`.

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RunRow } from "./inventory.ts";
import type { TracedFinding } from "./trace.ts";

export type Row = { ok: boolean; what: string; positive: string; negative: string };

/** The audit's table: `| [#57](…) | 6 | 11 | 24 | … |` is run, rounds, round 1, all. */
export function parseAuditTable(
  markdown: string,
): Map<string, { rounds: number; r1: number; all: number }> {
  const out = new Map<string, { rounds: number; r1: number; all: number }>();
  for (const m of markdown.matchAll(
    /^\| \[#([0-9]+)\]\([^)]*\) \| ([0-9]+) \| ([0-9]+) \| ([0-9]+) \|/gmu,
  )) {
    out.set(m[1] as string, { rounds: Number(m[2]), r1: Number(m[3]), all: Number(m[4]) });
  }
  return out;
}

/** The 21-run count's table: `| [#57](…) | title | 6 | 1: 11, 2: 6 | 24 | 11 | 5 | notes |`. */
export function parseCriteriaCount(
  markdown: string,
): Map<string, { rounds: number; total: number; r1: number }> {
  const out = new Map<string, { rounds: number; total: number; r1: number }>();
  for (const m of markdown.matchAll(
    /^\| \[#([0-9]+)\]\([^)]*\) \| [^|]* \| ([0-9]+)[^|]*\| [^|]* \| ([0-9]+) \| ([0-9]+) \|/gmu,
  )) {
    out.set(m[1] as string, { rounds: Number(m[2]), total: Number(m[3]), r1: Number(m[4]) });
  }
  return out;
}

/** What differs between a run's counts and another record's, by run. */
export function compareCounts(
  rows: readonly RunRow[],
  other: ReadonlyMap<string, { rounds: number; r1: number; all: number }>,
): {
  compared: number;
  differ: Array<{ run: string; mine: [number, number, number]; theirs: [number, number, number] }>;
} {
  let compared = 0;
  const differ: Array<{
    run: string;
    mine: [number, number, number];
    theirs: [number, number, number];
  }> = [];
  for (const r of rows) {
    const t = other.get(r.run);
    if (!t) continue;
    compared += 1;
    const mine: [number, number, number] = [r.rounds, r.seriousByRound[0] ?? 0, r.seriousTotal];
    const theirs: [number, number, number] = [t.rounds, t.r1, t.all];
    if (mine.some((v, i) => v !== theirs[i])) differ.push({ run: r.run, mine, theirs });
  }
  return { compared, differ };
}

/** Whether the line text appears among the added lines of a patch of one file. */
export function addedIn(patch: string, text: string): boolean {
  const want = text.trim();
  if (want === "") return false;
  return patch
    .split("\n")
    .some((l) => l.startsWith("+") && !l.startsWith("+++") && l.slice(1).trim() === want);
}

const git = (repo: string, args: string[]): string => {
  const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 64 << 20 });
  return r.status === 0 ? r.stdout : "";
};

const arg = (args: string[], name: string): string | undefined => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};

const main = (args: string[]): void => {
  const dir = arg(args, "--results");
  const repo = arg(args, "--repo");
  const cut = arg(args, "--cut");
  if (!dir || !repo || !cut)
    throw new Error("usage: controls.ts --results <dir> --repo <checkout> --cut <iso>");
  const here = join(dir, "..");
  const runs = (JSON.parse(readFileSync(join(dir, "runs.json"), "utf8")) as { runs: RunRow[] })
    .runs;
  const inSet = runs.filter(
    (r) => r.rounds > 0 && r.reviewEndedAt !== null && r.reviewEndedAt <= cut,
  );
  const traced = JSON.parse(readFileSync(join(dir, "findings.json"), "utf8")) as {
    findings: TracedFinding[];
  };
  const rows: Row[] = [];

  // 1. Positive and negative control for the count, through the same command.
  const r335 = inSet.find((r) => r.run === "335");
  const card335 = [7, 3, 2, 1, 1, 2, 2, 1, 0];
  rows.push({
    ok: JSON.stringify(r335?.seriousByRound) === JSON.stringify(card335),
    what: "serious findings by round from the finding lines equal the run's own card line",
    positive: `#335: lines read ${r335?.seriousByRound.join(",")}, its card's REVIEW line reads ${card335.join(",")}`,
    negative: "see the next row",
  });
  const quiet = inSet.filter((r) => r.seriousTotal === 0);
  const style265 = inSet.find((r) => r.run === "265");
  rows.push({
    ok: quiet.length > 0 && (style265?.findingLines ?? 0) > 0 && style265?.seriousTotal === 0,
    what: "a run with finding lines and no gating P1 or P2 reads zero through the same command",
    positive: "the count above reads 19 for #335",
    negative: `#265 has ${style265?.findingLines} finding lines, all style or P3, and reads 0; ${quiet.length} runs read 0`,
  });

  // 2. Agreement with the lane audit's table, for the runs it covered.
  const audit = parseAuditTable(
    readFileSync(
      join(here, "..", "2026-10-03-lane-audit", "results", "reviews-round-one.md"),
      "utf8",
    ),
  );
  const cmp = compareCounts(inSet, audit);
  rows.push({
    ok: cmp.differ.every((d) => ["135"].includes(d.run)),
    what: "rounds, round 1 and total agree with the lane audit's table",
    positive: `${cmp.compared - cmp.differ.length} of ${cmp.compared} runs agree on all three`,
    negative:
      cmp.differ.length === 0
        ? "none differ"
        : `${cmp.differ.map((d) => `#${d.run}: ${d.mine.join("/")} here, ${d.theirs.join("/")} in the audit`).join("; ")} (severity in the target field, see method.md)`,
  });

  // 3. Silent rounds.
  const silent = inSet.filter((r) => r.silentRounds.length > 0);
  rows.push({
    ok: silent.every((r) => ["38", "109", "124", "200", "202", "258", "268"].includes(r.run)),
    what: "a round after round 2 that follows a round with no serious finding line is silent",
    positive: `${silent.length} runs hold one: ${silent.map((r) => `#${r.run} (${r.silentRounds.join(",")})`).join(", ")}`,
    negative: `${inSet.length - silent.length} runs hold none`,
  });

  // 4. The commit named as a line's origin added that line.
  const later = traced.findings.filter(
    (f) =>
      f.round >= 2 &&
      (f.origin.kind === "fix" || f.origin.kind === "change") &&
      f.code.length > 0 &&
      f.file,
  );
  let agree = 0;
  let checked = 0;
  const miss: string[] = [];
  for (const f of later) {
    const sha = f.origin.sha;
    if (!sha || !f.file) continue;
    const patch = git(repo, ["show", "--format=", sha, "--", f.file]);
    if (patch === "") continue;
    checked += 1;
    if (addedIn(patch, f.code[0] as string)) agree += 1;
    else miss.push(`${f.run}:${f.target}`);
  }
  rows.push({
    ok: checked > 0 && agree / checked >= 0.85,
    what: "the commit named as the origin of a cited line adds that line, read with git show and not git blame",
    positive: `${agree} of ${checked} later findings placed in a fix or in the change`,
    negative: `${checked - agree} do not: the line was moved or reformatted after the commit, or the cited text is its own first line only`,
  });

  const md = [
    "# Controls",
    "",
    "Each row is a count run through the same code on a case that must read non-zero or agree, and on one that must read zero or differ, or a figure from a second record.",
    "",
    "| | What | Positive | Negative |",
    "| --- | --- | --- | --- |",
    ...rows.map((r) => `| ${r.ok ? "ok" : "FAILED"} | ${r.what} | ${r.positive} | ${r.negative} |`),
    "",
  ].join("\n");
  writeFileSync(join(dir, "controls.md"), md);
  console.error(rows.map((r) => `${r.ok ? "ok    " : "FAILED"} ${r.what}`).join("\n"));
  if (miss.length > 0) console.error(`origin check misses: ${miss.slice(0, 12).join(" ")}`);
};

if (import.meta.main) main(process.argv.slice(2));
