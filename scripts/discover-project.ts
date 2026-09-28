// Work out what a target project needs, rather than demanding it be configured.
// Prints key=value lines. Empty value means "could not determine, ask the user". Each check a
// change is verified by is a `check.<name>=<where it came from>: <what it shows>` line: declared in
// the project's .postmaster/project.toml, or a default and which one (scripts/verify.sh).
import { existsSync, readFileSync } from "node:fs";
import { tryJsonFile } from "./lib/data.ts";
import { beside } from "./lib/paths.ts";
import { run } from "./lib/proc.ts";

for (const name of [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_COMMON_DIR",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_NAMESPACE",
]) {
  delete process.env[name];
}

const args = process.argv.slice(2);
const T = args[0];
if (T === undefined || T === "") {
  console.error("usage: discover-project.sh <path>");
  process.exit(1);
}

// The tracker kind, before the cd, so a relative path or config is read from the caller's directory.
const kindRun = run(beside(import.meta, "tracker-kind.sh"), [T]);
const kind = kindRun.code === 0 ? kindRun.out.replace(/\n+$/, "") : "";

try {
  process.chdir(T);
} catch {
  console.error(`cannot enter ${T}`);
  process.exit(1);
}

let gate = "";
if (existsSync("package.json")) {
  const pkg = tryJsonFile<{ scripts?: Record<string, unknown> }>("package.json");
  const scripts = pkg && typeof pkg === "object" ? pkg.scripts : undefined;
  if (scripts !== null && typeof scripts === "object") {
    for (const s of ["check", "ci", "verify", "test", "lint"]) {
      if (scripts[s] !== undefined && scripts[s] !== null) {
        gate = s;
        break;
      }
    }
  }
  if (gate !== "") {
    let runner = "npm";
    if (existsSync("bun.lock") || existsSync("bun.lockb") || existsSync("bunfig.toml")) {
      runner = "bun";
    } else if (existsSync("pnpm-lock.yaml")) {
      runner = "pnpm";
    }
    gate = `${runner} run ${gate}`;
  }
}
if (gate === "" && existsSync("Makefile")) {
  if (/^(check|test):/m.test(readFileSync("Makefile", "utf8"))) gate = "make check";
}
if (gate === "" && existsSync("Cargo.toml")) gate = "cargo test";

// ls prints the names that exist, sorted; tr turns each newline into a space.
const lsNames = (argv: string[]): string => {
  const r = run("ls", argv);
  const names = r.out.split("\n").filter((l) => l !== "");
  return names.length === 0 ? "" : `${names.join(" ")} `;
};
const docs = lsNames(["AGENTS.md", "CLAUDE.md", "README.md", "CONTRIBUTING.md"]);
const dirs = lsNames(["-d", "wiki", "docs", ".github"]);

// The tracker is visible in how the project already writes commits; nothing to configure.
const oneline = run("git", ["log", "--oneline", "-200"]).out;
const counts = new Map<string, number>();
const ticket = /\b[A-Z][A-Z0-9]{1,9}-[0-9]+\b/g;
for (const line of oneline.split("\n")) {
  for (const m of line.match(ticket) ?? []) {
    const prefix = m.replace(/-[0-9]*$/, "");
    counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
  }
}
// sort | uniq -c | sort -rn | head -1 | awk '{print $2}'
const ranked = [...counts.entries()].sort(
  (a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0),
);
const trackerPrefix = ranked[0]?.[0] ?? "";

// The checks, declared or found as defaults; a declared gate is the gate.
const verified = run(beside(import.meta, "verify.sh"), ["checks", ".", "--gate", gate, "--lines"]);
const fields = (line: string): number => (line === "" ? 0 : line.split("\t").length);
let checks: string[] = [];
if (verified.code === 0) {
  checks = (verified.out + verified.err)
    .split("\n")
    .filter((l) => fields(l) >= 4);
  const gateLine = checks.find((l) => l.split("\t")[0] === "gate");
  if (gateLine !== undefined) gate = gateLine.split("\t")[2] ?? "";
  for (const l of (verified.out + verified.err).split("\n")) {
    if (fields(l) >= 4) continue;
    const warn = l.replace(/^verify: warn: /, "");
    if (warn !== l) console.error(`warn=checks: ${warn}`);
  }
} else {
  checks = [];
  // sed 's/^verify: //' | paste -sd' ' -: every line, empty ones included, joined by one space.
  const text = (verified.out + verified.err).replace(/\n+$/, "");
  const joined = text
    .split("\n")
    .map((l) => l.replace(/^verify: /, ""))
    .join(" ");
  console.error(`warn=checks: ${joined}`);
}

console.log(`gate=${gate}`);
console.log(`docs=${(docs + dirs).replace(/ *$/, "")}`);
console.log(`tracker=${kind}`);
console.log(`tracker_prefix=${trackerPrefix}`);
console.log(`ambient_context=${existsSync("AGENTS.md") ? "AGENTS.md" : "NONE"}`);
for (const l of checks) {
  const f = l.split("\t");
  if (f.length >= 4) console.log(`check.${f[0]}=${f[1]}: ${f[3]}`);
}
if (!existsSync("AGENTS.md")) {
  console.error("warn=no AGENTS.md: lanes that read no ambient file will start blind");
}
if (kind === "github" && run("git", ["remote", "get-url", "origin"]).code !== 0) {
  console.error(
    "warn=no origin remote, so no github board: with the user's word, scripts/local.sh <repo> store init gives it a local store",
  );
}
process.exit(0);
