// Oracle helpers for #355: the user is told when a verifier may have gone stale.
// Scratch apps (copies of fixtures/app) with planted verifier indexes, the stale
// query, the make prompts, the clerk's brief, and the runbook sentences this
// ticket adds. The tests drive git or scripts/run as subprocesses; nothing here
// imports the change.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { commitAll, writeRepoFile } from "./acceptance-323.ts";
import { featurePage } from "./acceptance-325.ts";
import {
  CLI_README,
  cliVerifierFiles,
  localTicket,
  runBrief,
  stubConfig,
} from "./acceptance-327.ts";
import { beside, toolRoot } from "./lib/paths.ts";
import { type RunResult, run } from "./lib/proc.ts";

export const ROOT = toolRoot(import.meta);
export const RUN = beside(import.meta, "run");

export const PSTACK_URL =
  "https://github.com/cursor/plugins/tree/23e4138daa01c42d4969f7a5465f82704e64f798/pstack";
export const ISSUE_273_URL = "https://github.com/brindlewick/postmaster/issues/273";

// The rule Stage G step 3 of the postmaster's runbook carries, word for word
// (line wrapping aside): after a landing, the checkout advanced to the merge,
// one stale call at it, and an upkeep pass offered for each verifier it marks.
// Deliberately not imported from the change: the tests fail when the runbook
// stops carrying it.
export const POSTMASTER_OFFER =
  "Then check whether any verifier may have gone stale on the landing: advance " +
  "`<repo>`'s checkout of the default branch to the landed merge commit first, so the " +
  "stale query reads the landing's own index, then run `<tool>/scripts/run verifier " +
  "stale <repo> --at <merge>` once; for the verifiers it marks, offer one correcting " +
  "upkeep pass (`run verifier upkeep <repo> --run <dispatch> --correct`), naming the " +
  "changed files, and a yes starts it; when the pass completes, land its branch " +
  "(`run verifier land <repo> <branch> --run <dispatch> --report <report>`), so the " +
  "new confirmation reaches the default branch; a landing it clears offers nothing.";

// The rule the clerk's runbook carries, word for word (line wrapping aside): a
// verifier step the ticket leaves alone that fails at the base is reported,
// naming the verifier and the step, and the check is not bent around it.
// Deliberately not imported from the change, as above.
export const CLERK_BASE_FAILURE =
  "When you drive a verifier at the base and a step the ticket does not change fails, " +
  "tell the user which verifier and which step failed: the project may have changed under " +
  "the verifier from outside it, through a new tool, browser or service version, or a file " +
  "the verifier does not list. Do not rewrite the check around the failure.";

/** Flatten whitespace the way the runbook pins compare: wrapping never matters. */
export function flat(s: string): string {
  // ASCII: widening to Unicode whitespace only folds more runs, never splits a match
  return s.replace(/\s+/gu, " ");
}

/** The stale query's result, as scripts/run prints it. */
export function runStale(repo: string, args: string[] = []): RunResult {
  return run(RUN, ["verifier", "stale", repo, ...args]);
}

/** The make instructions for the surfaces, or a throw quoting the failure. */
export function promptOrThrow(repo: string, ...surfaces: string[]): string {
  const r = run(RUN, ["verifier", "prompt", repo, ...surfaces]);
  if (r.code !== 0) {
    throw new Error(`verifier prompt exited ${r.code}: ${r.err.trim() || r.out.trim()}`);
  }
  return r.out;
}

/** A single-shape verifier whose index carries the Files and Confirmed lines given. */
export function plantSingle(
  repo: string,
  opts: { files: string | null; confirmed: string | null },
): void {
  const lines = ["# map", "", "An index of the features.", ""];
  if (opts.files !== null) lines.push(`Files: ${opts.files}`);
  if (opts.confirmed !== null) lines.push(`Confirmed: ${opts.confirmed}`);
  const files: Record<string, string> = {
    "verify-app/README.md": CLI_README,
    "verify-app/features/README.md": `${lines.join("\n")}\n`,
    "verify-app/features/add.md": featurePage("add"),
    "verify-app/features/done.md": featurePage("done"),
    "verify-app/features/list.md": featurePage("list"),
  };
  for (const [rel, text] of Object.entries(files)) writeRepoFile(repo, rel, text);
  commitAll(repo, "verifier");
}

/** A shared-shape index with the bullets given, each kind's files beside it. */
export function plantMulti(repo: string, bullets: string[], kinds: string[]): void {
  writeRepoFile(
    repo,
    "verifier/README.md",
    `# Verifiers\n\nOne folder per surface.\n\n${bullets.join("\n")}\n`,
  );
  for (const kind of kinds) {
    for (const [rel, text] of Object.entries(cliVerifierFiles(`verifier/${kind}`))) {
      writeRepoFile(repo, rel, text);
    }
  }
  commitAll(repo, "verifiers");
}

/** One shared-index bullet naming the kind, its Files and its confirmation. */
export function bullet(
  kind: string,
  prose: string,
  opts: { files: string | null; confirmed: string | null },
): string {
  let line = `- [${kind}](${kind}/) verifies the ${prose}.`;
  if (opts.files !== null) line += ` Files: ${opts.files}.`;
  if (opts.confirmed !== null) line += ` Confirmed: ${opts.confirmed}`;
  return line;
}

/** Change a scratch-app file and commit, for the landing the mark reads. */
export function changeFile(repo: string, rel: string, message: string): void {
  const target = join(repo, rel);
  writeRepoFile(repo, rel, `${readFileSync(target, "utf8")}\n// a landed change\n`);
  commitAll(repo, message);
}

/** The clerk's brief for a local ticket, or a throw quoting the failure. */
export function briefOrThrow(repo: string, title: string, dir: string): string {
  const id = localTicket(repo, title);
  const r = runBrief(repo, id, stubConfig(dir));
  if (r.code !== 0) {
    throw new Error(`clerk brief exited ${r.code}: ${r.err.trim() || r.out.trim()}`);
  }
  return readFileSync(join(repo, ".postmaster", "clerk", `${id}.brief.md`), "utf8");
}
