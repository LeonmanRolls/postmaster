// Launch workhorses and postmaster sessions from the runbooks without shell composition.
import { join } from "node:path";
import { scriptsDir } from "./lib/paths.ts";
import { run } from "./lib/proc.ts";

type Result = Readonly<{ code: number; out: string; err: string }>;
type Runner = (program: string, args: readonly string[]) => Result;

const HERE = scriptsDir(import.meta);
const TOOL_RUN = join(HERE, "run");
const runScript: Runner = (program, args) => run(program, [...args]);

const append = (first: Result, second: Result): Result => ({
  code: second.code,
  out: first.out + second.out,
  err: first.err + second.err,
});

export function launchWorkhorse(
  dispatch: string,
  lane: string,
  worktree: string,
  runner: Runner = runScript,
): Result {
  const named = runner(TOOL_RUN, ["host", "name", dispatch, "workhorse", lane]);
  if (named.code !== 0) return named;
  const prompt = join(dispatch, `${lane}-prompt.txt`);
  const last = join(dispatch, "logs", `${lane}-last.md`);
  const launch = runner(TOOL_RUN, [
    "host",
    "run",
    named.out.trim(),
    worktree,
    "--under",
    dispatch,
    "--role",
    "lane",
    "--run",
    dispatch,
    "--out",
    join(dispatch, "logs", `${lane}-events.jsonl`),
    "--err",
    join(dispatch, "logs", `${lane}.err`),
    "--marker",
    join(dispatch, "logs", `${lane}.done`),
    "--",
    TOOL_RUN,
    "launch",
    "launch",
    lane,
    worktree,
    prompt,
    "--last",
    last,
    "--run",
    dispatch,
  ]);
  return { ...launch, err: named.err + launch.err };
}

export function launchPostmaster(
  targetRoot: string,
  runsRoot: string,
  runner: Runner = runScript,
): Result {
  return runner(TOOL_RUN, [
    "host",
    "run",
    "postmaster",
    targetRoot,
    "--out",
    join(runsRoot, "postmaster", "events.jsonl"),
    "--err",
    join(runsRoot, "postmaster", "postmaster.err"),
    "--marker",
    join(runsRoot, "postmaster", ".exited"),
    "--",
    TOOL_RUN,
    "launch",
    "launch",
    "postmaster",
    targetRoot,
    join(runsRoot, "postmaster", "brief.md"),
  ]);
}

export function launchSpecSession(
  dispatch: string,
  repo: string,
  commit: string,
  interactiveForm: readonly string[],
  runner: Runner = runScript,
): Result {
  if (interactiveForm.length === 0)
    return { code: 1, out: "", err: "runbook-host: spec session needs an interactive form\n" };
  const named = runner(TOOL_RUN, ["host", "name", dispatch]);
  if (named.code !== 0) return named;
  const short = runner("git", ["-C", repo, "rev-parse", "--short", commit]);
  if (short.code !== 0) return append(named, short);
  const ticket = named.out.trim();
  const handle = `spec-${ticket}-${short.out.trim()}`;
  const label = `${ticket} · spec`;
  const spawned = runner(TOOL_RUN, [
    "host",
    "spawn",
    handle,
    repo,
    "--label",
    label,
    "--",
    ...interactiveForm,
  ]);
  return { ...spawned, err: named.err + short.err + spawned.err };
}

function usage(): never {
  console.error(
    "usage: run runbook-host workhorse <dispatch> <lane> <worktree> | postmaster <target-root> <runs-root> | spec <dispatch> <repo> <commit> -- <interactive-form...>",
  );
  process.exit(1);
}

function main(args: string[]): Result {
  const [operation, ...rest] = args;
  if (operation === "workhorse" && rest.length === 3)
    return launchWorkhorse(rest[0]!, rest[1]!, rest[2]!);
  if (operation === "postmaster" && rest.length === 2) return launchPostmaster(rest[0]!, rest[1]!);
  if (operation === "spec") {
    const delimiter = rest.indexOf("--");
    if (delimiter !== 3 || rest.length <= delimiter + 1) usage();
    return launchSpecSession(rest[0]!, rest[1]!, rest[2]!, rest.slice(delimiter + 1));
  }
  usage();
}

if (import.meta.main) {
  const result = main(process.argv.slice(2));
  process.stdout.write(result.out);
  process.stderr.write(result.err);
  process.exit(result.code);
}
