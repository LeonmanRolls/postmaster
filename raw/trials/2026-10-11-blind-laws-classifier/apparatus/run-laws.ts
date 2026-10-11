#!/usr/bin/env bun
// Runs a folder of laws against one version of #202's shell-command classifier.
//
//   bun apparatus/run-laws.ts <commit> <laws-folder> [--without-newline-split] [--seed N] [--census N] [--record FILE] [--only K]
//   bun apparatus/run-laws.ts <commit> --diff [--without-newline-split]
//
// The version is taken whole with `git archive <commit> scripts`, and `export` is added to the
// classifier's declarations and to nothing else. --without-newline-split also takes the newline
// out of splitShell's separators: the control's positive case. --diff prints those changes.
//
// The laws folder is copied whole, and its classifier.ts is replaced by one that exports the
// version's functions under the same names. Each law runs in its own process, so a law cannot
// change another's environment, and prints one JSON line: its number, name, result and message.
// The home folder is written as ~ in every message.
//
// --census N runs each law on N inputs from its own generator without stopping at the first
// failure, and prints every failure as a JSON line with the law's number and name, then a
// summary line per assert. fast-check stops at the first failing input and shrinks it, so one
// defect can hide every other defect a law would reach; the census shows them all.
//
// --record FILE appends every call the laws make to commandTouches to FILE, as JSON lines.
// --only K runs the K-th law alone.
//
//   exit 0  every law ran (passed or failed)
//   exit 1  the version or the laws could not be prepared
import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const FUNCTIONS = [
  "commandTouches",
  "splitShell",
  "shellWords",
  "unwrapShell",
  "expandPath",
  "isPathToken",
] as const;
export const TYPES = ["RecordOf", "Access", "Place"] as const;
export const INTERFACES = ["Touch", "RunInfo"] as const;
export const NEWLINE_SEPARATOR = 'ch === "\\n" || ';
const LAW_LIMIT_MS = 20 * 60 * 1000;

/** Adds `export` to each classifier declaration; refuses unless each occurs exactly once. */
export function addExports(source: string): string {
  let text = source;
  const forms: Array<[string, string]> = [
    ...FUNCTIONS.map((name): [string, string] => [`function ${name}(`, `export function ${name}(`]),
    ...TYPES.map((name): [string, string] => [`type ${name} `, `export type ${name} `]),
    ...TYPES.map((name): [string, string] => [`type ${name}<`, `export type ${name}<`]),
    ...INTERFACES.map((name): [string, string] => [`interface ${name} `, `export interface ${name} `]),
  ];
  const done = new Set<string>();
  for (const [from, to] of forms) {
    const lines = text.split("\n");
    const hits = lines.filter((line) => line.startsWith(from)).length;
    if (hits === 0) continue;
    const name = from.replace(/^(function|type|interface) /u, "").replace(/[ (<]$/u, "");
    if (hits > 1 || done.has(name)) throw new Error(`${name} is declared more than once`);
    done.add(name);
    text = lines.map((line) => (line.startsWith(from) ? to + line.slice(from.length) : line)).join("\n");
  }
  for (const name of [...FUNCTIONS, ...TYPES, ...INTERFACES])
    if (!done.has(name)) throw new Error(`${name} is not declared at the start of a line`);
  return text;
}

/** Takes the newline out of splitShell's separators; refuses unless it occurs exactly once. */
export function dropNewlineSplit(source: string): string {
  const parts = source.split(NEWLINE_SEPARATOR);
  if (parts.length !== 2) throw new Error(`the newline separator occurs ${parts.length - 1} times, not once`);
  return parts.join("");
}

/** The classifier.ts that stands in for the writer's, pointing at one version. */
export function adapterSource(reach: string): string {
  const at = JSON.stringify(reach);
  return [
    `export { ${FUNCTIONS.join(", ")} } from ${at};`,
    `export type { Access, Place, RecordOf, RunInfo, Touch } from ${at};`,
    "",
  ].join("\n");
}

/**
 * The same, except that commandTouches also appends each call it answers to the file named by
 * RECORD_CALLS, one JSON line with the command, the result text and the exit code. The answers
 * are the version's own; the record shows which inputs the laws' generators produced.
 */
export function recordingAdapterSource(reach: string): string {
  const at = JSON.stringify(reach);
  const rest = FUNCTIONS.filter((f) => f !== "commandTouches");
  return [
    'import { appendFileSync } from "node:fs";',
    `import { commandTouches as answer } from ${at};`,
    `export { ${rest.join(", ")} } from ${at};`,
    `export type { Access, Place, RecordOf, RunInfo, Touch } from ${at};`,
    "export function commandTouches(...args: Parameters<typeof answer>): ReturnType<typeof answer> {",
    "  const out = answer(...args);",
    '  const file = process.env.RECORD_CALLS ?? "";',
    "  if (file) appendFileSync(file, `${JSON.stringify({ command: args[0], result: args[1], code: args[2] })}\\n`);",
    "  return out;",
    "}",
    "",
  ].join("\n");
}

/** The child that runs one law with a fixed seed and prints its result as one JSON line. */
export const ONE_LAW = `import * as fc from "fast-check";
const [index, seed] = process.argv.slice(2).map(Number);
fc.configureGlobal({ seed });
const { laws } = await import("./laws.ts");
const law = laws[index];
const started = performance.now();
let result = "passed";
let message = "";
try {
  law.check();
} catch (error) {
  result = "failed";
  message = String((error as Error).message ?? error);
}
const ms = Math.round(performance.now() - started);
console.log(JSON.stringify({ law: index + 1, name: law.name, result, ms, message }));
`;

export const COUNT = `const { laws } = await import("./laws.ts");
console.log(laws.length);
`;

/**
 * The census: fast-check as the laws see it, except that assert never stops at a failure. It
 * draws the inputs from the law's own generator with the same seed and runs the law's own
 * predicate on every one, printing each failure as a JSON line, then a summary line. The laws
 * are unchanged; only the package they import is swapped, in the throwaway run folder: the real
 * one moves to node_modules/fast-check-real and node_modules/fast-check holds this file.
 */
export function censusSource(real: string): string {
  const at = JSON.stringify(real);
  return `import * as real from ${at};
export * from ${at};
type Pred = (...xs: unknown[]) => unknown;
interface Held { census: true; arbs: unknown[]; pred: Pred }
export function property(...args: unknown[]): Held {
  return { census: true, arbs: args.slice(0, -1), pred: args[args.length - 1] as Pred };
}
export function assert(p: Held, params?: { numRuns?: number }): void {
  const wanted = Number(process.env.CENSUS_RUNS ?? "0");
  const runs = wanted > 0 ? wanted : (params?.numRuns ?? 100);
  const seed = Number(process.env.CENSUS_SEED ?? "367");
  const one = p.arbs.length === 1;
  const arb = (one ? p.arbs[0] : real.tuple(...(p.arbs as never[]))) as never;
  const inputs = real.sample(arb, { seed, numRuns: runs }) as unknown[];
  let failed = 0;
  inputs.forEach((x, index) => {
    let message = "";
    try {
      const r = one ? p.pred(x) : p.pred(...(x as unknown[]));
      if (r === false) message = "the predicate returned false";
    } catch (error) {
      message = String((error as Error).message ?? error);
    }
    if (message) {
      failed += 1;
      console.log(JSON.stringify({ census: "failure", index, input: real.stringify(x).slice(0, 600), message: message.split("\\n").slice(0, 8).join("\\n") }));
    }
  });
  console.log(JSON.stringify({ census: "summary", runs, failed }));
}
`;
}

/** The package.json of the stand-in fast-check package that holds the census. */
export const CENSUS_PACKAGE = `${JSON.stringify({ name: "fast-check", type: "module", exports: { ".": "./index.ts" } }, null, 2)}\n`;

/** Writes the home folder as ~ so a message names no account. */
export function redactHome(text: string, home: string): string {
  return home.length > 1 ? text.split(home).join("~") : text;
}

function fail(message: string): never {
  console.error(`run-laws: ${message}`);
  process.exit(1);
}

function sh(cmd: string, args: string[], cwd?: string): string {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  if (r.status !== 0) fail(`${cmd} ${args.join(" ")} failed: ${(r.stderr ?? "").trim()}`);
  return r.stdout ?? "";
}

function prepareVersion(repo: string, commit: string, withoutNewline: boolean, root: string): { reach: string; before: string; after: string } {
  const tar = join(root, "version.tar");
  sh("git", ["-C", repo, "archive", "--format=tar", "-o", tar, commit, "scripts"]);
  const dir = join(root, "version");
  mkdirSync(dir);
  sh("tar", ["-xf", tar, "-C", dir]);
  const reach = join(dir, "scripts", "reach.ts");
  const before = readFileSync(reach, "utf8");
  let after: string;
  try {
    after = addExports(before);
    if (withoutNewline) after = dropNewlineSplit(after);
  } catch (error) {
    fail(`${commit}: ${(error as Error).message}`);
  }
  writeFileSync(reach, after);
  return { reach, before, after };
}

function main(argv: string[]): void {
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const seedAt = argv.indexOf("--seed");
  const seed = seedAt >= 0 ? Number(argv[seedAt + 1]) : 367;
  const onlyAt = argv.indexOf("--only");
  const only = onlyAt >= 0 ? Number(argv[onlyAt + 1]) : 0;
  const recordAt = argv.indexOf("--record");
  const record = recordAt >= 0 ? resolve(argv[recordAt + 1] ?? "") : "";
  const censusAt = argv.indexOf("--census");
  const census = censusAt >= 0 ? Number(argv[censusAt + 1]) : 0;
  const valued = new Set([seedAt + 1, censusAt + 1, recordAt + 1, onlyAt + 1].filter((i) => i > 0));
  const positional = argv.filter((a, i) => !a.startsWith("--") && !valued.has(i));
  if (!Number.isInteger(census) || census < 0) fail("--census takes a whole number of inputs");
  const [commit, lawsDir] = positional;
  if (!commit || (!flags.has("--diff") && !lawsDir) || !Number.isInteger(seed))
    fail("usage: run-laws.ts <commit> <laws-folder> [--without-newline-split] [--seed N] | <commit> --diff");
  const repo = sh("git", ["-C", import.meta.dir, "rev-parse", "--show-toplevel"]).trim();
  const root = realpathSync(mkdtempSync(join(tmpdir(), "laws-367-")));
  const version = prepareVersion(repo, commit, flags.has("--without-newline-split"), root);
  if (flags.has("--diff")) {
    const a = join(root, "reach.ts.orig");
    writeFileSync(a, version.before);
    const r = spawnSync("diff", ["-u", "--label", `a/scripts/reach.ts@${commit}`, "--label", "b/scripts/reach.ts", a, version.reach], { encoding: "utf8" });
    process.stdout.write(r.stdout ?? "");
    return;
  }
  const run = join(root, "run");
  cpSync(resolve(lawsDir ?? ""), run, { recursive: true, filter: (src) => !src.includes("node_modules") });
  const writer = join(dirname(import.meta.dir), "writer");
  for (const name of ["package.json", "bun.lock", "sandbox.ts", "signatures.ts"]) copyFileSync(join(writer, name), join(run, name));
  writeFileSync(join(run, "classifier.ts"), record ? recordingAdapterSource(version.reach) : adapterSource(version.reach));
  writeFileSync(join(run, "one-law.ts"), ONE_LAW);
  writeFileSync(join(run, "count.ts"), COUNT);
  sh("bun", ["install", "--frozen-lockfile", "--silent"], run);
  const count = Number(sh("bun", ["count.ts"], run).trim());
  if (!Number.isInteger(count) || count < 1) fail("the laws folder exports no laws");
  const home = homedir();
  if (census > 0) {
    const modules = join(run, "node_modules");
    renameSync(join(modules, "fast-check"), join(modules, "fast-check-real"));
    mkdirSync(join(modules, "fast-check"));
    writeFileSync(join(modules, "fast-check", "package.json"), CENSUS_PACKAGE);
    writeFileSync(join(modules, "fast-check", "index.ts"), censusSource("fast-check-real"));
  }
  const env = { ...process.env, CENSUS_RUNS: String(census), CENSUS_SEED: String(seed), RECORD_CALLS: record };
  for (let index = 0; index < count; index += 1) {
    if (only > 0 && index !== only - 1) continue;
    const r = spawnSync("bun", ["one-law.ts", String(index), String(seed)], { cwd: run, encoding: "utf8", timeout: LAW_LIMIT_MS, env, maxBuffer: 256 * 1024 * 1024 });
    const lines = (r.stdout ?? "").trim().split("\n").filter((line) => line.startsWith("{"));
    if (census > 0) {
      const name = (() => {
        try {
          return String((JSON.parse(lines[lines.length - 1] ?? "{}") as { name?: unknown }).name ?? "");
        } catch {
          return "";
        }
      })();
      for (const line of lines.slice(0, -1)) {
        const row = JSON.parse(line) as Record<string, unknown>;
        process.stdout.write(`${redactHome(JSON.stringify({ law: index + 1, name, ...row }), home)}\n`);
      }
      if (r.status !== 0 || r.error) process.stdout.write(`${JSON.stringify({ law: index + 1, name, census: "error", message: redactHome((r.stderr ?? "").trim().split("\n").slice(-5).join("\n"), home) })}\n`);
      continue;
    }
    const out = lines.pop();
    if (out) {
      process.stdout.write(`${redactHome(out, home)}\n`);
    } else {
      const result = r.error ? "timed out" : `exited ${r.status}`;
      const message = redactHome((r.stderr ?? "").trim().split("\n").slice(-5).join("\n"), home);
      process.stdout.write(`${JSON.stringify({ law: index + 1, result, message })}\n`);
    }
  }
}

if (import.meta.main) main(process.argv.slice(2));
