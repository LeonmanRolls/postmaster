#!/usr/bin/env bun
/**
 * #208's trial of patterns against Jev 1.13 for personal data (see ../method.md).
 *
 *   bun run.ts corpus   --out <dir>                 the Jev trial's 71 made-up lines and its control
 *   bun run.ts history  --out <dir> --rev <rev>     every unique added line of rev's history
 *   bun run.ts identity --out <dir> --rev <rev>     the corpus and the history hashed, to compare with Python's
 *   bun run.ts heldout  --out <dir> --in <file>     lines another model wrote, stored in fragments
 *
 * Each mode takes --patterns v1 to run the first version of the patterns, kept as it ran in
 * patterns-v1.ts; the default is the current version in patterns.ts.
 *
 * Patterns make no call and give the same answer every time, so each set is scanned once. The
 * history mode records, for each line flagged, its index, commit, path, kinds and rules, never
 * its text, and compares the flags with the Jev trial's full pass where it judged the same lines.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLEAN, corpus, corpusContext, type Item } from "./corpus";
import { historyLines } from "./history";
import type { Finding } from "./patterns";
import * as current from "./patterns";

/** The patterns in use, chosen by --patterns. */
let P: typeof current = current;

const JEV_FULL = "raw/trials/jev-pii/results/v6-full/history.json";

function sha256(text: string): string {
  return new Bun.CryptoHasher("sha256").update(text).digest("hex");
}

function rulesOf(findings: Finding[]): string[] {
  return [...new Set(findings.map((f) => f.rule))].sort();
}

/** Found, right kind and raised over a labelled set, with the line numbers behind each. */
function score(items: Item[], context: Map<string, string>): string[] {
  const positives = items.filter((i) => i.label).length;
  let found = 0;
  let right = 0;
  let raised = 0;
  const missed: string[] = [];
  const wrongKind: string[] = [];
  const falseAlarms: string[] = [];
  const byRule = new Map<string, number>();
  items.forEach((item, index) => {
    const findings = P.scan(item.text, context.get(item.text) ?? "");
    const got = P.kinds(findings);
    for (const rule of rulesOf(findings)) byRule.set(rule, (byRule.get(rule) ?? 0) + 1);
    const number = `${index + 1}`;
    if (item.label) {
      if (got.length) found++;
      else missed.push(`${number} (${item.label})`);
      if (got.includes(item.label as Finding["kind"])) right++;
      else if (got.length) wrongKind.push(`${number} (${item.label}, found ${got.join(",")})`);
    } else if (got.length) {
      raised++;
      falseAlarms.push(`${number} (${got.join(",")}: ${rulesOf(findings).join(",")})`);
    }
  });
  return [
    `personal-data lines found: ${found}/${positives}, with the right kind: ${right}/${positives}`,
    `negatives raised: ${raised}/${items.length - positives}`,
    `missed: ${missed.join(", ") || "none"}`,
    `found with another kind only: ${wrongKind.join(", ") || "none"}`,
    `negatives raised: ${falseAlarms.join(", ") || "none"}`,
    `lines each rule fired on: ${[...byRule].map(([r, c]) => `${r} ${c}`).join(", ")}`,
  ];
}

function corpusMode(out: string): void {
  const items = corpus();
  const control = CLEAN.filter((line) => P.scan(line).length > 0).length;
  const report = [
    "The Jev trial's 71 made-up lines (v6), scanned once; line numbers as in ../../jev-pii/results/v6/corpus.txt.",
    "",
    ...score(items, corpusContext()),
    `control, ten plain lines raised: ${control}`,
  ];
  writeFileSync(join(out, "corpus-scores.txt"), `${report.join("\n")}\n`);
  console.log(report.join("\n"));
}

interface Flag {
  index: number;
  commit: string;
  path: string;
  kinds: string[];
  rules: string[];
}

function historyMode(out: string, rev: string): void {
  const started = performance.now();
  const lines = historyLines(rev);
  const flagged: Flag[] = [];
  lines.forEach((line, index) => {
    const findings = P.scan(line.text, line.context);
    if (findings.length) {
      flagged.push({ index, commit: line.commit.slice(0, 12), path: line.path, kinds: P.kinds(findings), rules: rulesOf(findings) });
    }
  });
  const seconds = Math.round((performance.now() - started) / 100) / 10;
  const resolved = Bun.spawnSync(["git", "rev-parse", rev]).stdout.toString().trim();
  writeFileSync(join(out, "history.json"), `${JSON.stringify({ rev: resolved, lines: lines.length, seconds, flagged }, null, 1)}\n`);
  const byRule = new Map<string, number>();
  for (const flag of flagged) for (const rule of flag.rules) byRule.set(rule, (byRule.get(rule) ?? 0) + 1);
  const report = [
    `history at ${resolved.slice(0, 12)}: ${lines.length} lines in ${seconds} s, ${flagged.length} flagged`,
    `by kind: ${P.KINDS.map((k) => `${k} ${flagged.filter((f) => f.kinds.includes(k)).length}`).join(", ")}`,
    `by rule: ${[...byRule].map(([r, c]) => `${r} ${c}`).join(", ")}`,
  ];
  const jev = JSON.parse(readFileSync(JEV_FULL, "utf8"));
  if (jev.rev === resolved && jev.lines === lines.length) {
    const ours = new Set(flagged.map((f) => f.index));
    for (const threshold of ["0.5", "0.8", "0.9"]) {
      const theirs = new Set<number>(jev.flagged[threshold].map((f: { index: number }) => f.index));
      const both = [...ours].filter((i) => theirs.has(i)).length;
      report.push(
        `against Jev's full pass at ${threshold}: both ${both}, patterns only ${ours.size - both}, Jev only ${theirs.size - both}`,
      );
    }
  } else {
    report.push("Jev's full pass judged another revision; no comparison.");
  }
  writeFileSync(join(out, "history-summary.txt"), `${report.join("\n")}\n`);
  console.log(report.join("\n"));
}

function identityMode(out: string, rev: string): void {
  const items = corpus();
  const context = corpusContext();
  const lines = historyLines(rev);
  const report = [
    `corpus: ${items.length} lines, sha256 of the lines joined by newlines ${sha256(items.map((i) => i.text).join("\n"))}`,
    `corpus labels: sha256 ${sha256(items.map((i) => i.label).join("\n"))}`,
    `corpus contexts: sha256 ${sha256([...context].map(([k, v]) => `${k}\u0001${v}`).join("\u0000"))}`,
    `history at ${rev}: ${lines.length} lines, sha256 ${sha256(lines.map((l) => `${l.commit}\u0001${l.path}\u0001${l.text}\u0001${l.context}`).join("\u0000"))}`,
  ];
  writeFileSync(join(out, "identity-bun.txt"), `${report.join("\n")}\n`);
  console.log(report.join("\n"));
}

/** Lines another model wrote, each stored as fragments so that no committed file holds a whole value. */
function heldoutMode(out: string, file: string): void {
  const rows: { label: string; parts: string[] }[] = JSON.parse(readFileSync(file, "utf8"));
  const items = rows.map((row) => ({ label: row.label === "none" ? "" : row.label, text: row.parts.join("") }));
  const report = [`${items.length} lines another model wrote, scanned once.`, "", ...score(items, new Map())];
  writeFileSync(join(out, "heldout-scores.txt"), `${report.join("\n")}\n`);
  console.log(report.join("\n"));
}

async function main(args: string[]): Promise<void> {
  const [mode, ...rest] = args;
  const opts = new Map<string, string>();
  for (let i = 0; i + 1 < rest.length; i += 2) opts.set(rest[i], rest[i + 1]);
  const out = opts.get("--out");
  if (!out || !["corpus", "history", "identity", "heldout"].includes(mode ?? "")) {
    console.error("usage: bun run.ts corpus|history|identity|heldout --out <dir> [--rev <rev>] [--in <file>]");
    process.exit(2);
  }
  mkdirSync(out, { recursive: true });
  if (opts.get("--patterns") === "v1") P = await import("./patterns-v1");
  if (mode === "corpus") corpusMode(out);
  else if (mode === "history") historyMode(out, opts.get("--rev") ?? "origin/main");
  else if (mode === "identity") identityMode(out, opts.get("--rev") ?? "origin/main");
  else heldoutMode(out, opts.get("--in") ?? "");
}

await main(process.argv.slice(2));
