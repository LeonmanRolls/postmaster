// Oracle helpers for #327: clerks and runs use a project's verifiers.
// The tests plant scratch apps (copies of fixtures/app) and drive git or
// scripts/run as subprocesses; nothing here imports the change.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitAll, initRepo, writeRepoFile } from "./acceptance-323.ts";
import { FEATURES_README, featurePage } from "./acceptance-325.ts";
import { beside, toolRoot } from "./lib/paths.ts";
import { type RunResult, run } from "./lib/proc.ts";

export const ROOT = toolRoot(import.meta);
export const RUN = beside(import.meta, "run");
export const FIXTURE_APP = join(ROOT, "fixtures/app");

// The rule the clerk's runbook carries, word for word (line wrapping aside):
// a check driving a surface with a verifier is written and run through it.
// Deliberately not imported from the change: the tests fail when the runbook
// stops carrying it.
export const VERIFIER_RULE =
  "Where a criterion drives a surface that has a verifier, write its check through that verifier: " +
  "name the verifier and the feature page it uses. " +
  "The brief's Checks and verifiers section names the project's verifiers and their feature pages. " +
  "Run the check at the base through the verifier, and put what it showed after **At the base** with " +
  "the proof file named. " +
  "A feature with no page yet is driven through the verifier's start and drive steps all the same, " +
  "and the run adds its page.";

// A faithful command-line verifier README: the six sections the #323 prompt
// mandates, with the surface in prose where the H1 names it, as the live one reads.
export const CLI_README = `# todo on the command line

Drives the todo list on the command line, the way README documents it: \`bun src/cli.ts add\`, \`list\` and \`done\`, with the list in the file TODO_FILE names. Every drive uses its own TODO_FILE under the system temp folder, so no drive touches real data and two drives run side by side. Proof lands in the folder VERIFY_PROOF_DIR names, which also defaults under temp and outlives cleanup.

## Launch

Run \`bun src/cli.ts\` with a fresh \`TODO_FILE\`.

## Health check

List the tasks; an empty list answers.

## Drive

Add a task, list it, complete it.

## Evidence

Keep the terminal transcript.

## Cleanup

Remove the scratch list file.

## Helpers

\`helper.ts\` prints one.
`;

// The multi index with one command-line verifier, as the live #324 index reads.
export const CLI_INDEX = `# Verifiers

One folder per surface. Each verifier tells an agent arriving cold how to start that surface, check it is healthy, drive it the way a user does, keep proof, and clean up.

- [cli](cli/) verifies the command line.
`;

/** One command-line verifier's files under a folder. */
export function cliVerifierFiles(folder: string): Record<string, string> {
  return {
    [`${folder}/README.md`]: CLI_README,
    [`${folder}/features/README.md`]: FEATURES_README,
    [`${folder}/features/add.md`]: featurePage("add"),
    [`${folder}/features/done.md`]: featurePage("done"),
    [`${folder}/features/list.md`]: featurePage("list"),
  };
}

/** A scratch app: fixtures/app copied to dir/app and committed. No install: no case runs its gate. */
export function freshScratch(): { dir: string; repo: string } {
  const dir = mkdtempSync(join(tmpdir(), "acceptance-327-"));
  const repo = join(dir, "app");
  const cp = run("cp", ["-R", FIXTURE_APP, repo]);
  if (cp.code !== 0) throw new Error(`cp scratch: ${cp.err.trim() || cp.out.trim()}`);
  initRepo(repo);
  commitAll(repo, "first");
  return { dir, repo };
}

export function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

/** A bare scratch repo with no declared checks: gate discovery finds cargo test. */
export function freshBareScratch(): { dir: string; repo: string } {
  const dir = mkdtempSync(join(tmpdir(), "acceptance-327-"));
  const repo = join(dir, "app");
  mkdirSync(repo, { recursive: true });
  initRepo(repo);
  writeRepoFile(repo, "Cargo.toml", '[package]\nname = "app"\n');
  commitAll(repo, "first");
  return { dir, repo };
}

/** Commit files on the checkout's branch. */
export function plantFiles(repo: string, files: Record<string, string>, message: string): void {
  for (const [rel, text] of Object.entries(files)) writeRepoFile(repo, rel, text);
  commitAll(repo, message);
}

/** The multi shape: verifier/ with an index naming one command-line verifier. */
export function plantMultiVerifier(repo: string): void {
  plantFiles(
    repo,
    { "verifier/README.md": CLI_INDEX, ...cliVerifierFiles("verifier/cli") },
    "verifiers",
  );
}

/** The single shape: one verify-app/ verifier for the command line. */
export function plantSingleVerifier(repo: string): void {
  plantFiles(repo, cliVerifierFiles("verify-app"), "verifier");
}

/** A local ticket store with one ticket; returns the ticket's id. */
export function localTicket(repo: string, title: string): string {
  const init = run(RUN, ["local", repo, "store", "init"]);
  if (init.code !== 0) {
    throw new Error(`store init: ${init.err.trim() || init.out.trim()}`);
  }
  const body = join(repo, "ticket-body.md");
  writeFileSync(body, "A body.\n");
  const r = run(RUN, ["local", repo, "create", title, body]);
  if (r.code !== 0) throw new Error(`create: ${r.err.trim() || r.out.trim()}`);
  return r.out.trim();
}

/** A stub machine config; the brief reads nothing else from the machine. */
export function stubConfig(dir: string): Record<string, string | undefined> {
  const home = join(dir, "home");
  mkdirSync(home, { recursive: true });
  const cfg = join(home, "config.toml");
  writeFileSync(
    cfg,
    [
      `[lanes.one]`,
      `harness = "claude"`,
      `model = "lane-model"`,
      ``,
      `[team]`,
      `clerk = { harness = "claude", model = "clerk-model" }`,
      ``,
    ].join("\n"),
  );
  return { POSTMASTER_CONFIG: cfg };
}

export function runBrief(
  repo: string,
  id: string,
  env: Record<string, string | undefined>,
): RunResult {
  return run(RUN, ["clerk", "brief", repo, id], { env });
}

export function runList(repo: string): RunResult {
  return run(RUN, ["verifier", "list", repo]);
}

export function runChecksLines(repo: string): RunResult {
  return run(RUN, ["verify", "checks", repo, "--lines"]);
}

export function runDiscover(repo: string): RunResult {
  return run(RUN, ["discover-project", repo]);
}

/** The value of the docs= line discover-project prints. */
export function docsOf(out: string): string {
  const found = out.split("\n").filter((l) => l.startsWith("docs="));
  if (found.length !== 1) throw new Error(`expected one docs= line, found ${found.length}`);
  return (found[0] as string).slice("docs=".length);
}
