import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { command, scriptDir, writeError, writeOut } from "./lib/core.ts";

const [target] = process.argv.slice(2);
if (!target) {
  writeError("usage: discover-project.sh <path>");
  process.exit(1);
}
const here = scriptDir(import.meta.url);
const kindResult = command("bun", [join(here, "tracker-kind.ts"), target]);
const kind = kindResult.code === 0 ? kindResult.stdout.trim() : "";
try {
  process.chdir(target);
} catch {
  writeError(`cannot enter ${target}`);
  process.exit(1);
}

let gate = "";
if (existsSync("package.json")) {
  let packageScripts: Record<string, unknown> = {};
  try {
    packageScripts = JSON.parse(await Bun.file("package.json").text()).scripts ?? {};
  } catch {
    packageScripts = {};
  }
  for (const script of ["check", "ci", "verify", "test", "lint"]) {
    if (packageScripts[script]) {
      if (existsSync("bun.lock") || existsSync("bun.lockb")) gate = `bun run ${script}`;
      else if (existsSync("pnpm-lock.yaml")) gate = `pnpm run ${script}`;
      else gate = `npm run ${script}`;
      break;
    }
  }
  if (!gate && !command("jq", ["--version"]).code)
    writeError("warn=jq not installed: package.json scripts were not read");
}
if (!gate && existsSync("Makefile")) {
  const makefile = await Bun.file("Makefile").text();
  if (/^(?:check|test):/m.test(makefile)) gate = "make check";
}
if (!gate && existsSync("Cargo.toml")) gate = "cargo test";

const docCandidates = ["AGENTS.md", "CLAUDE.md", "README.md", "CONTRIBUTING.md"];
const docs = docCandidates.filter(existsSync);
const dirCandidates = ["wiki", "docs", ".github"];
const dirs = dirCandidates.filter((item) => existsSync(item) && readdirSync(item).length >= 0);

let trackerPrefix = "";
const log = command("git", ["log", "--oneline", "-200"]);
if (log.code === 0) {
  const counts = new Map<string, number>();
  for (const match of log.stdout.matchAll(/\b([A-Z][A-Z0-9]{1,9})-[0-9]+\b/g))
    counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
  trackerPrefix = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "";
}

const checksResult = command("bun", [join(here, "verify.ts"), "checks", ".", "--gate", gate, "--lines"]);
let checks = "";
if (checksResult.code === 0) {
  const lines = checksResult.stdout.split(/\r?\n/).filter((line) => line.split("\t").length >= 4);
  checks = lines.join("\n");
  gate = lines.map((line) => line.split("\t")).find((row) => row[0] === "gate")?.[2] ?? gate;
  for (const line of checksResult.stdout.split(/\r?\n/)) {
    const warning = /^verify: warn: (.*)$/.exec(line);
    if (warning) writeError(`warn=checks: ${warning[1]}`);
  }
} else {
  const reason = (checksResult.stdout + checksResult.stderr)
    .replace(/^verify: /gm, "")
    .trim()
    .replace(/\r?\n/g, " ");
  writeError(`warn=checks: ${reason}`);
}

writeOut(`gate=${gate}`);
writeOut(`docs=${[...docs, ...dirs].join(" ")}`);
writeOut(`tracker=${kind}`);
writeOut(`tracker_prefix=${trackerPrefix}`);
writeOut(`ambient_context=${existsSync("AGENTS.md") ? "AGENTS.md" : "NONE"}`);
for (const line of checks.split("\n")) {
  const fields = line.split("\t");
  if (fields.length >= 4) writeOut(`check.${fields[0]}=${fields[1]}: ${fields[3]}`);
}
if (!existsSync("AGENTS.md")) writeError("warn=no AGENTS.md: lanes that read no ambient file will start blind");
if (kind === "github" && command("git", ["remote", "get-url", "origin"]).code !== 0) {
  writeError(
    "warn=no origin remote, so no github board: with the user's word, scripts/local.sh <repo> store init gives it a local store",
  );
}
