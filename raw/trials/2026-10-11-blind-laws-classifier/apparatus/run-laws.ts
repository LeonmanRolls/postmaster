#!/usr/bin/env bun
// Runs a folder of laws against one version of #202's shell-command classifier.
//
//   bun apparatus/run-laws.ts <commit> <laws-folder> [--without-newline-split] [--seed N]
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
//   exit 0  every law ran (passed or failed)
//   exit 1  the version or the laws could not be prepared
import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
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
  const positional = argv.filter((a, i) => !a.startsWith("--") && !(seedAt >= 0 && i === seedAt + 1));
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
  writeFileSync(join(run, "classifier.ts"), adapterSource(version.reach));
  writeFileSync(join(run, "one-law.ts"), ONE_LAW);
  writeFileSync(join(run, "count.ts"), COUNT);
  sh("bun", ["install", "--frozen-lockfile", "--silent"], run);
  const count = Number(sh("bun", ["count.ts"], run).trim());
  if (!Number.isInteger(count) || count < 1) fail("the laws folder exports no laws");
  const home = homedir();
  for (let index = 0; index < count; index += 1) {
    const r = spawnSync("bun", ["one-law.ts", String(index), String(seed)], { cwd: run, encoding: "utf8", timeout: LAW_LIMIT_MS });
    const out = (r.stdout ?? "").trim().split("\n").filter((line) => line.startsWith("{")).pop();
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
