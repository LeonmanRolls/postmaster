// Work out what a target project needs, rather than demanding it be configured.
// Prints key=value lines. Empty value means "could not determine, ask the user". Each check a
// change is verified by is a `check.<name>=<where it came from>: <what it shows>` line: declared in
// the project's .postmaster/project.toml, or a default and which one (scripts/run verify).
// surfaces= names the surface kinds to offer verifiers for, from discovery's own found
// defaults rather than the resolved checks, so a project that declares its checks still
// names them; a fixture copy names none, since it is never offered verifiers.
// verifiers= names the verifier folders already at the repo top, or nothing.
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { tryJsonFile } from "./lib/data.ts";
import { isFixtureCopy } from "./lib/fixture-mark.ts";
import { beside, toolRoot } from "./lib/paths.ts";
import { run } from "./lib/proc.ts";
import { orderKinds, presentVerifierFolders, surfaceKind, type Surface } from "./verifier.ts";
import { discover } from "./verify.ts";

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
  console.error("usage: run discover-project <path>");
  process.exit(1);
}

// The tracker kind, before the cd, so a relative path or config is read from the caller's directory.
const kindRun = run(beside(import.meta, "run"), ["tracker-kind", T]);
const kind = kindRun.code === 0 ? kindRun.out.replace(/\n+$/u, "") : "";

let ABS: string;
try {
  // cd -P: enter the physical path, so a symlinked target is discovered as itself.
  ABS = realpathSync(T);
  process.chdir(ABS);
} catch {
  console.error(`cannot enter ${T}`);
  process.exit(1);
}

// One package-manager choice feeds both the gate runner and install= below, in
// run verify's pm() order (pnpm, bun, yarn, npm), so the two can never disagree.
let pm = "npm";
if (existsSync("pnpm-lock.yaml")) pm = "pnpm";
else if (existsSync("bun.lock") || existsSync("bun.lockb")) pm = "bun";
else if (existsSync("yarn.lock")) pm = "yarn";

let gate = "";
if (existsSync("package.json")) {
  // BASE shells to jq here and reads nothing without it; the port parses natively, so the
  // jq-missing degraded mode is gone by design. With jq present the two agree: jq -e takes a
  // script whose value is neither null nor false.
  const pkg = tryJsonFile<{ scripts?: Record<string, unknown> }>("package.json");
  const scripts = pkg && typeof pkg === "object" ? pkg.scripts : undefined;
  if (scripts !== null && typeof scripts === "object") {
    for (const s of ["check", "ci", "verify", "test", "lint"]) {
      if (scripts[s] !== undefined && scripts[s] !== null && scripts[s] !== false) {
        gate = s;
        break;
      }
    }
  }
  if (gate !== "") {
    gate = `${pm} run ${gate}`;
  }
}
if (gate === "" && existsSync("Makefile")) {
  if (/^(check|test):/mu.test(readFileSync("Makefile", "utf8"))) gate = "make check";
}
if (gate === "" && existsSync("Cargo.toml")) gate = "cargo test";

// The dependency install a fresh checkout needs before the gate: the clean-checkout callers
// (the ship leg's post-merge verification, fixture scoring's gate) run it first. Empty where
// the project's runner fetches on its own (cargo, go) or nothing is known (make). Always
// lockfile-strict where a lockfile exists, so the gate runs the tree the project pins.
let install = "";
if (existsSync("package.json")) {
  if (pm === "pnpm") install = "pnpm install --frozen-lockfile";
  else if (pm === "bun") install = "bun install --frozen-lockfile";
  else if (pm === "yarn") {
    install = existsSync(".yarnrc.yml")
      ? "yarn install --immutable"
      : "yarn install --frozen-lockfile";
  } else if (existsSync("package-lock.json"))
    install = "npm ci --prefer-offline --no-audit --no-fund";
  else install = "npm install --prefer-offline --no-audit --no-fund";
}

// ls prints the names that exist, sorted; tr turns each newline into a space.
const lsNames = (argv: string[]): string => {
  const r = run("ls", argv);
  const names = r.out.split("\n").filter((l) => l !== "");
  return names.length === 0 ? "" : `${names.join(" ")} `;
};
const docs = lsNames(["AGENTS.md", "CLAUDE.md", "README.md", "CONTRIBUTING.md"]);
const dirs = lsNames(["-d", "wiki", "docs", ".github"]);
// sed 's/^<prefix> //' | paste -sd' ' -: every line, empty ones included, joined by one space.
const joinWarn = (text: string, prefix: string | RegExp): string =>
  text
    .replace(/\n+$/u, "")
    .split("\n")
    .map((l) => l.replace(prefix, ""))
    .join(" ");
// The verifiers' read-first entries join the docs, so a run's implementers
// read the index first. A listing that fails warns and leaves docs= as today:
// discovery never refuses a project over its verifiers.
let verifiers = "";
const listed = run(beside(import.meta, "run"), ["verifier", "list", ABS], {
  cwd: toolRoot(import.meta),
});
if (listed.code === 0) {
  verifiers = listed.out
    .split("\n")
    .filter((l) => l.startsWith("index: "))
    .map((l) => l.slice("index: ".length))
    .join(" ");
} else {
  console.error(`warn=verifiers: ${joinWarn(listed.out + listed.err, /^verifier: /u)}`);
}

// The tracker is visible in how the project already writes commits; nothing to configure.
const oneline = run("git", ["log", "--oneline", "-200"]).out;
const counts = new Map<string, number>();
// In-process, with GNU grep's word boundaries in a UTF-8 locale: a letter, digit or
// underscore on either side blocks a match, so the search never depends on the grep
// this machine happens to have.
const TICKET_RE = new RegExp(
  "(?<![\\p{L}\\p{N}_])[A-Z][A-Z0-9]{1,9}-[0-9]+(?![\\p{L}\\p{N}_])",
  "gu",
);
for (const match of oneline.matchAll(TICKET_RE)) {
  const prefix = match[0].replace(/-[0-9]*$/u, "");
  counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
}
// sort | uniq -c | sort -rn | head -1 | awk '{print $2}': ties break descending, as sort -rn does.
const ranked = [...counts.entries()].sort(
  (a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0),
);
const trackerPrefix = ranked[0]?.[0] ?? "";

// Optional project settings are validated and reported with their source. Missing files are not
// an error; their values remain discovery defaults for the session to settle in conversation.
const settings = run(beside(import.meta, "run"), ["project-settings", "report", ABS], {
  cwd: toolRoot(import.meta),
});
if (settings.code !== 0) {
  console.error(`discover-project: project settings could not be read for ${T}`);
  process.exit(1);
}

// The checks, declared or found as defaults; a declared gate is the gate.
// No bun ever runs with the target as its cwd: verify gets the absolute
// target and the tool root to stand on. (Wrapper --no-env-file/--config
// covers the rest; kindRun above keeps the caller's directory because a
// relative POSTMASTER_CONFIG reads from there, as BASE has it.)
const verified = run(
  beside(import.meta, "run"),
  ["verify", "checks", ABS, "--gate", gate, "--lines"],
  {
    cwd: toolRoot(import.meta),
  },
);
const fields = (line: string): number => (line === "" ? 0 : line.split("\t").length);
let checks: string[] = [];
if (verified.code === 0) {
  checks = (verified.out + verified.err).split("\n").filter((l) => fields(l) >= 4);
  const gateLine = checks.find((l) => l.split("\t")[0] === "gate");
  if (gateLine !== undefined) gate = gateLine.split("\t")[2] ?? "";
  for (const l of (verified.out + verified.err).split("\n")) {
    if (fields(l) >= 4) continue;
    const warn = l.replace(/^verify: warn: /u, "");
    if (warn !== l) console.error(`warn=checks: ${warn}`);
  }
} else {
  checks = [];
  console.error(`warn=checks: ${joinWarn(verified.out + verified.err, /^verify: /u)}`);
}

/** The kinds to offer verifiers for: discovery's found names as kinds, in cli, web, library order. */
const surfaceNames = (repo: string): string[] => {
  if (isFixtureCopy(repo)) return [];
  const kinds: Surface[] = [];
  const unknown: string[] = [];
  for (const name of discover(repo).found) {
    const kind = surfaceKind(name);
    if (kind === null) {
      if (!unknown.includes(name)) unknown.push(name);
    } else {
      kinds.push(kind);
    }
  }
  // A found name with no verifier mapping is passed through raw, never dropped:
  // setup-verifiers reports it instead of silently offering fewer surfaces.
  return [...orderKinds(kinds), ...unknown.sort()];
};

console.log(`gate=${gate}`);
console.log(`install=${install}`);
const extra = verifiers === "" ? "" : `${verifiers} `;
console.log(`docs=${(docs + dirs + extra).replace(/ *$/u, "")}`);
console.log(`surfaces=${surfaceNames(ABS).join(",")}`);
console.log(`verifiers=${presentVerifierFolders(ABS).join(",")}`);
console.log(`tracker=${kind}`);
console.log(`tracker_prefix=${trackerPrefix}`);
for (const l of settings.out.replace(/\n$/u, "").split("\n")) console.log(l);
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
    "warn=no origin remote, so no github board: with the user's word, scripts/run local <repo> store init gives it a local store",
  );
}
process.exit(0);
