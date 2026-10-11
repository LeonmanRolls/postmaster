// The tracker kind a repository uses: local when its local ticket store exists
// (scripts/run local), whatever the config names; otherwise the repo's effective
// [tracker] kind, github when it names none (skills/postmaster/trackers.md, local).
// This is the one place the rule lives: scripts/run discover-project reports it and
// scripts/run ticket-check reads through it.
//
//   run tracker-kind <repo>
//
// POSTMASTER_CONFIG overrides the config path (~/.postmaster/config.toml), and a relative one is
// read from the directory this is run in. Only run local's exit 3 means there is no store: any
// other failure to look is a failure here, never a fall back to the config.
//
//   exit 0  the kind, on stdout
//   exit 1  it cannot be told: run local could not look for a store, there is no config, or it
//           does not parse; the reason on stderr
import { beside } from "./lib/paths.ts";
import { effectiveConfigForProject, globalConfigPath } from "./lib/effective-config.ts";
import { run } from "./lib/proc.ts";

const args = process.argv.slice(2);
if (args.length !== 1) {
  console.error("usage: run tracker-kind <repo>");
  process.exit(1);
}
const repo = args[0];
if (repo === undefined) process.exit(1);
const config = globalConfigPath();

// why=$(run local store 2>&1 >/dev/null): stderr is the reason, stdout is the store path.
const looked = run(beside(import.meta, "run"), ["local", repo, "store"]);
const why = looked.err.replace(/\n+$/u, "");
if (looked.code === 0) {
  console.log("local");
  process.exit(0);
}
if (looked.code !== 3) {
  console.error(
    `tracker-kind: cannot look for a local store in ${repo} (run local exit ${looked.code}): ${
      why === "" ? "no message" : why
    }`,
  );
  process.exit(1);
}

const resolved = effectiveConfigForProject(repo, config);
if (resolved.notice !== null) console.error(resolved.notice);
if (resolved.config === null || resolved.error !== null) {
  console.error(`tracker-kind: ${resolved.error ?? "cannot resolve project settings"}`);
  process.exit(1);
}
const tracker = resolved.config.tracker;
let kind: unknown = "github";
if (tracker !== undefined) {
  if (tracker === null || typeof tracker !== "object" || Array.isArray(tracker)) {
    console.error(`tracker-kind: ${config} does not parse`);
    process.exit(1);
  }
  const named = (tracker as Record<string, unknown>).kind;
  if (named !== undefined) kind = named;
}
console.log(String(kind));
process.exit(0);
