// Oracle helpers for #408: the user can choose for one ticket whether its run
// gets the technical notes, and the run records which. The tests spawn git and
// scripts/run as subprocesses; nothing here imports the change. The small
// dispatch setup repeats run-meta.test.ts's machine() on purpose: that file
// imports the change, so the oracle cannot share it.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beside } from "./lib/paths.ts";
import { run } from "./lib/proc.ts";

export const RUN = beside(import.meta, "run");

export interface Machine {
  env: Record<string, string>;
  repo: string;
  dispatch: string;
}

export function gitOrThrow(repo: string, ...args: string[]): void {
  const r = run("git", ["-C", repo, ...args]);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.err.trim() || r.out.trim()}`);
}

export function initRepo(repo: string): void {
  mkdirSync(repo, { recursive: true });
  gitOrThrow(repo, "init", "-q", "-b", "main");
  gitOrThrow(repo, "config", "user.name", "acceptance-408-test");
  gitOrThrow(repo, "config", "user.email", "acceptance-408-test@example.invalid");
  gitOrThrow(repo, "config", "commit.gpgsign", "false");
  gitOrThrow(repo, "commit", "-q", "--allow-empty", "-m", "first");
}

/**
 * A machine config, a target git repo and an empty dispatch, with the env that
 * points run-meta at them. teamTail appends lines to the config's [team]
 * section, such as a ticket_notes key.
 */
export function machine(tmp: string, name: string, teamTail = ""): Machine {
  const config = join(tmp, `${name}.toml`);
  writeFileSync(
    config,
    '[lanes.one]\nharness = "bash"\nmodel = "m1"\n' +
      '[lanes.two]\nharness = "bash"\nmodel = "m2"\n' +
      '[team]\nworkhorses = ["one", "two"]\n' +
      'coachman = { harness = "bash", model = "judge" }\n' +
      'coachman_fallback = { harness = "bash", model = "spare" }\n' +
      'postmaster = { harness = "bash", model = "pm" }\n' +
      teamTail,
  );
  const repo = join(tmp, `${name}-repo`);
  initRepo(repo);
  const dispatch = join(tmp, `${name}-runs`, "T1");
  mkdirSync(dispatch, { recursive: true });
  const env = {
    ...(process.env as Record<string, string>),
    POSTMASTER_CONFIG: config,
    POSTMASTER_TOOL_PINS: join(tmp, `${name}-pins`),
  };
  return { env, repo, dispatch };
}
