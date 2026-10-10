// Oracle helpers for #232: an Oxlint warning fails the gate, and the tree
// carries no warnings. Each test drives the gate's own Oxlint step — the
// oxlint segment of the check script in package.json, run from the repo
// root — as a subprocess; nothing here imports the change.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { toolRoot } from "./lib/paths.ts";
import { run } from "./lib/proc.ts";

export const ROOT = toolRoot(import.meta);

/** The gate's Oxlint step as argv, read from the check script in package.json. */
export function oxlintStep(): string[] {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
    scripts: { check: string };
  };
  const segment = pkg.scripts.check
    .split("&&")
    .map((s) => s.trim())
    .find((s) => s.split(/\s+/u).includes("oxlint")); // ASCII: a shell splits words on ASCII whitespace
  if (segment === undefined) throw new Error("check script runs no oxlint step");
  if (/["'\\|<>;&$`]/u.test(segment)) throw new Error(`oxlint step is not plain argv: ${segment}`);
  return segment.split(/\s+/u); // ASCII: a shell splits words on ASCII whitespace
}

/** Run the gate's Oxlint step from the repo root with extra args appended. */
export function runOxlintStep(extra: string[] = []) {
  const [cmd, ...args] = oxlintStep();
  return run(cmd!, [...args, ...extra], { cwd: ROOT });
}

/** C1 scratch files: the first three fail the step, the last passes it. */
export const UNUSED_SRC = 'const unusedVar = 1;\nconsole.log("hi");\n';
export const ESCAPE_SRC = "const re = /^[a-z.\\/-]+$/u;\nconsole.log(re);\n";
export const STARTS_WITH_SRC = 'const l = "## hi";\nif (/^## /u.test(l)) console.log("yes");\n';
export const CLEAN_SRC = 'console.log("clean");\n';

/** A lint finding line: path:line:col: warning|error. */
const FINDING_RE = /:\d+:\d+: (?:warning|error) /u; // ASCII: oxlint prints line:col in ASCII digits

export function findingLines(output: string): string[] {
  return output.split("\n").filter((line) => FINDING_RE.test(line));
}

export interface OxConfig {
  rules: Record<string, unknown>;
  ignorePatterns: unknown;
  [key: string]: unknown;
}

export function readOxConfig(): OxConfig {
  return JSON.parse(readFileSync(join(ROOT, ".oxlintrc.json"), "utf8")) as OxConfig;
}

/** Effective rule levels as oxlint reports them: allow < warn < deny. */
export function printConfigRules(): Record<string, string> {
  const r = run("bunx", ["oxlint", "--print-config"], { cwd: ROOT });
  if (r.code !== 0) throw new Error(`oxlint --print-config: exit ${r.code}: ${r.err.trim()}`);
  const config = JSON.parse(r.out) as { rules: Record<string, string> };
  return config.rules;
}

/** Rules off at the base, the only two the config may leave off. */
export const BASE_OFF_RULES = ["no-control-regex", "no-unused-expressions"];

/** Paths out of the lint: the base two plus the two generated scrub entries. */
export const BASE_IGNORE_PATTERNS = [
  "fixtures/**",
  // Generated bundles, byte-pinned by `bundle-scrub --check`, the same reason as vendored code.
  "scripts/scrub-check.ts",
  "scripts/raw-promote.ts",
  "scripts/lib/vendor/**",
];
