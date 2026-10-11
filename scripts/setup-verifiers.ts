// Make a new project's verifiers during setup, on the launch card's yes.
// One call from the front door, once the run root exists and before the postmaster takes
// the stream: it runs verifier make for the surfaces named and, with --repository,
// lands the branch through verifier land, returning only when the verifiers have been
// kept or landed, or been given up, so no ticket is dispatched before them.
//
//   run setup-verifiers <repo> <surface>... --run <dispatch> [--repository]
//
//   surface    one or more of cli, web, library, backend, cli-examples,
//              browser-suite, web-journey, library-tests, as verifier make takes
//              them, each a kind or kind:name. A discovery surfaces= value may be
//              passed as one comma-joined argument and counts its surfaces.
//   --run      the postmaster's run dir (<runs>/postmaster): the session's launches log
//              there, and the setup records the run.json its roles run on there
//   --repository  commit the verifiers on a branch and land them, as before;
//              without it they are kept under .postmaster/verifier/ instead
//
// It refuses a fixture copy, which is never offered verifiers and never waits for one,
// a project that already holds verifiers, and anything but the top of a git repository,
// writing nothing. With --repository it also refuses a target off its default branch
// or with uncommitted changes, before any session starts, since the local landing
// needs both. It logs the session dispatch before make runs, so an interrupted setup
// still records what it started. With a session host the session waits in its tab
// without a limit, watched by the user; with none it gets an hour for each surface
// named, then setup goes on without verifiers. Landing is always local on the
// launch-card yes: the yes is the merge word, and scaffolding the user just approved
// merges directly, since a pull request would leave the first tickets blind to it.
// It prints the host, the timeout, the kinds, the surfaces, the branch or kept folder
// and the hand-over, then its verdict, and appends both calls' transcripts to
// <dispatch>/logs/setup-verifiers.log.
//
//   exit 0  kept or landed: the verifiers sit under .postmaster/verifier, or merged
//           into the default branch with --repository
//   exit 1  given up: make or land failed; setup goes on without verifiers
//   exit 2  usage: bad arguments, a fixture copy, verifiers already held, a path that is
//           not the top of a git repository, with --repository a target off its
//           default branch or with uncommitted changes, no dispatch, no effective
//           config, a host that cannot be detected, a make call that misused its own
//           command, or an audit line that could not be written
import { appendFileSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  absolutizeProjectEnvFiles,
  effectiveConfigForProject,
  globalConfigPath,
  type EffectiveResult,
  type Rec,
} from "./lib/effective-config.ts";
import { isFixtureCopy } from "./lib/fixture-mark.ts";
import { beside } from "./lib/paths.ts";
import { run } from "./lib/proc.ts";
import {
  isRepo,
  isRepoTop,
  landTarget,
  orderKinds,
  parseSurfaces,
  presentVerifierFolders,
  sessionFolder,
  surfaceLabel,
  type NamedSurface,
  type Surface,
} from "./verifier.ts";

// A GIT_DIR from the caller must not steer repo identity to another repository.
for (const k of [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_COMMON_DIR",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_NAMESPACE",
]) {
  delete process.env[k];
}

const USAGE = `usage: run setup-verifiers <repo> <surface>... --run <dispatch> [--repository]

       each surface is a kind or kind:name: cli, web, library, backend, cli-examples,
       browser-suite, web-journey or library-tests; backend takes a name, as backend:api`;

/** Seconds of headless session per surface offered. */
export const SECONDS_PER_SURFACE = 3600;

const RUN = beside(import.meta, "run");

export interface Parsed {
  repo: string;
  names: string[];
  surfaces: NamedSurface[];
  kinds: Surface[];
  dispatch: string;
  /** Set only with --repository: commit on a branch and land it, as before. */
  repository?: boolean;
}

export type ParseResult = { ok: true; req: Parsed } | { ok: false; error: string };

export function parseArgs(argv: string[]): ParseResult {
  const repo = argv[0];
  if (repo === undefined) return { ok: false, error: "setup-verifiers takes a repo and a surface" };
  const names: string[] = [];
  let i = 1;
  for (; i < argv.length; i++) {
    const token = argv[i] as string;
    if (token.startsWith("-")) break;
    names.push(token);
  }
  if (names.length === 0) return { ok: false, error: "setup-verifiers takes a repo and a surface" };
  // A surfaces= value may arrive as one comma-joined argument; split it so the
  // discovery line works verbatim. An empty segment fails loud, never silently.
  const split: string[] = [];
  for (const token of names) {
    split.push(...token.split(","));
  }
  const parsed = parseSurfaces(split);
  if (!parsed.ok) return parsed;
  let dispatch: string | null = null;
  let repository = false;
  const rest = argv.slice(i);
  for (let j = 0; j < rest.length; j++) {
    const flag = rest[j] as string;
    if (flag === "--run") {
      const value = rest[j + 1];
      if (value === undefined)
        return { ok: false, error: "setup-verifiers needs --run <dispatch>" };
      dispatch = value;
      j++;
    } else if (flag === "--repository") {
      repository = true;
    } else {
      return { ok: false, error: `unknown flag: ${flag}` };
    }
  }
  if (dispatch === null) return { ok: false, error: "setup-verifiers needs --run <dispatch>" };
  const req: Parsed = {
    repo,
    names: split,
    surfaces: parsed.surfaces,
    kinds: orderKinds(parsed.surfaces.map((s) => s.kind)),
    dispatch,
  };
  if (repository) req.repository = true;
  return { ok: true, req };
}

/** Seconds make waits: without a limit on a watched session, an hour a kind on its own. */
export function timeoutForHost(host: string, kindCount: number): number {
  return host !== "none" && host !== "" ? 0 : SECONDS_PER_SURFACE * kindCount;
}

/** The kept folder and hand-over a local make printed, or null when it printed no such lines. */
export function parseLocalMakeOutput(out: string): { kept: string; handover: string } | null {
  let kept: string | null = null;
  let handover: string | null = null;
  for (const line of out.split("\n")) {
    if (kept === null && line.startsWith("kept ")) {
      const name = line.slice("kept ".length).trim();
      // Whitespace in the field means the line carries no folder.
      // ASCII: make prints the folder it kept itself (.postmaster/verifier).
      if (name !== "" && !/\s/u.test(name)) kept = name;
    } else if (handover === null && line.startsWith("handover ")) {
      const path = line.slice("handover ".length).trim();
      if (path !== "") handover = path;
    }
  }
  if (kept === null || handover === null) return null;
  return { kept, handover };
}

/** The branch and hand-over make printed, or null when it printed no such lines. */
export function parseMakeOutput(out: string): { branch: string; handover: string } | null {
  let branch: string | null = null;
  let handover: string | null = null;
  for (const line of out.split("\n")) {
    if (branch === null && line.startsWith("branch ")) {
      const name = line.slice("branch ".length).trim();
      // Whitespace in the field means the line carries no branch name.
      // ASCII: make prints branch names it made itself (verify-...).
      if (name !== "" && !/\s/u.test(name)) branch = name;
    } else if (handover === null && line.startsWith("handover ")) {
      const path = line.slice("handover ".length).trim();
      if (path !== "") handover = path;
    }
  }
  if (branch === null || handover === null) return null;
  return { branch, handover };
}

/** The last non-empty line, or "" when the output holds none. */
export function lastLine(out: string): string {
  const lines = out.split("\n").filter((l) => l.trim() !== "");
  return lines.length === 0 ? "" : (lines[lines.length - 1] as string);
}

/** The first non-empty line, or "" when the output holds none: a usage error's reason. */
export function firstLine(out: string): string {
  return out.split("\n").filter((l) => l.trim() !== "")[0] ?? "";
}

/** The run.json the setup records: what it acted on, and the config it acted with. */
export function runJsonDoc(target: string, config: unknown): Record<string, unknown> {
  return {
    written: new Date().toISOString(),
    kind: "setup-verifiers",
    target,
    config,
  };
}

function usageError(message: string): never {
  console.error(`setup-verifiers: ${message}\n${USAGE}`);
  process.exit(2);
  throw new Error("unreachable");
}

/**
 * The reason the target cannot take the local landing, or null when it can.
 * Land needs the default branch checked out with a clean tree; setup checks
 * before any session starts rather than waste one. A null target with no
 * commit yet skips the check: make reports that itself. A null target with
 * commits (an exotic default branch land cannot name) refuses here, since
 * land would fail after the session. Land re-checks at landing time, so a
 * branch moved mid-session still fails.
 */
export function landingCheckout(repo: string): string | null {
  const current = run("git", ["-C", repo, "symbolic-ref", "--short", "-q", "HEAD"]).out.trim();
  const target = landTarget(repo);
  if (target === null) {
    const head = run("git", ["-C", repo, "rev-parse", "--verify", "--quiet", "HEAD"]);
    if (head.code !== 0) return null;
    if (current === "")
      return `${repo} is not on a branch and has no main or master branch to land onto`;
    return `${repo} is on ${current}, which has no main or master branch to land onto`;
  }
  if (current === "") return `${repo} is not on a branch; check out ${target} and run again`;
  if (current !== target)
    return `${repo} is on ${current}, not ${target}; check out ${target} and run again`;
  if (run("git", ["-C", repo, "status", "--porcelain"]).out !== "")
    return `${repo} has uncommitted changes; commit or stash them and run again`;
  return null;
}

/**
 * The config the setup record keeps: the effective config with project-set
 * relative env files resolved against the project root, as run-meta records
 * them, so a later --run launch finds the same files.
 */
export function setupConfig(resolved: EffectiveResult): Rec {
  const config = JSON.parse(JSON.stringify(resolved.config)) as Rec;
  if (resolved.projectFile !== null) {
    absolutizeProjectEnvFiles(config, resolved.local, dirname(dirname(resolved.projectFile)));
  }
  return config;
}

/**
 * Log a setup note to the run's actions and the project ledger. False when
 * the audit line could not be written: an unlogged note stops setup rather
 * than go on unrecorded.
 */
export function logVerdict(dispatch: string, note: string, what = "verdict"): boolean {
  const logged = run(RUN, ["log-action", dispatch, "postmaster", "note", "setup-verifiers", note]);
  if (logged.code !== 0) {
    console.error(`setup-verifiers: the ${what} was not logged: ${logged.err.trim() || "exit 1"}`);
    return false;
  }
  return true;
}

function withoutPrefix(line: string): string {
  return line.replace(/^verifier: /u, "");
}

function main(argv: string[]): number {
  const parsed = parseArgs(argv);
  if (!parsed.ok) usageError(parsed.error);
  const repo = resolve(parsed.req.repo);
  if (!isRepo(repo)) usageError(`not a git repository: ${parsed.req.repo}`);
  if (!isRepoTop(repo)) usageError(`not the top of its repository: ${parsed.req.repo}`);
  if (isFixtureCopy(repo)) {
    usageError(`${parsed.req.repo} is a fixture copy, which is never offered verifiers`);
  }
  const held = presentVerifierFolders(repo);
  if (held.length > 0) {
    usageError(`${parsed.req.repo} already holds verifiers: ${held.join(",")}`);
  }
  // The local keep writes ignored files into the working copy, on any branch,
  // dirty or not; only the repository landing needs the default checkout.
  if (parsed.req.repository === true) {
    const checkout = landingCheckout(repo);
    if (checkout !== null) usageError(checkout);
  }
  const dispatch = resolve(parsed.req.dispatch);
  try {
    if (!statSync(dispatch).isDirectory()) throw new Error("not dir");
  } catch {
    usageError(`no such dispatch: ${parsed.req.dispatch}`);
  }
  const resolved = effectiveConfigForProject(repo, globalConfigPath());
  if (resolved.notice !== null) console.error(resolved.notice);
  if (resolved.config === null || resolved.error !== null) {
    usageError(resolved.error ?? "no effective config");
  }
  writeFileSync(
    join(dispatch, "run.json"),
    `${JSON.stringify(runJsonDoc(repo, setupConfig(resolved)), null, 2)}\n`,
  );
  const detected = run(RUN, ["host", "detect"]);
  if (detected.code !== 0) {
    usageError(`the session host cannot be detected: ${detected.err.trim() || "exit 1"}`);
  }
  const host = detected.out.split("\n")[0]?.trim() ?? "";
  const timeout = timeoutForHost(host, parsed.req.surfaces.length);
  console.log(`host ${host}`);
  console.log(`timeout ${timeout}`);
  console.log(`kinds ${parsed.req.kinds.join(",")}`);
  const labels = parsed.req.surfaces.map(surfaceLabel);
  console.log(`surfaces ${labels.join(",")}`);
  try {
    mkdirSync(join(dispatch, "logs"), { recursive: true });
  } catch {
    console.error(`setup-verifiers: ${join(dispatch, "logs")} cannot be written`);
  }
  const log = join(dispatch, "logs", "setup-verifiers.log");
  const transcript = (
    title: string,
    args: string[],
    code: number,
    out: string,
    err: string,
  ): void => {
    try {
      appendFileSync(
        log,
        `=== ${new Date().toISOString()} ${title} (exit ${code})\n$ run ${args.join(" ")}\n--- out\n${out}--- err\n${err}`,
      );
    } catch {
      console.error(`setup-verifiers: the transcript was not written to ${log}`);
    }
  };
  const makeArgs = [
    "verifier",
    "make",
    repo,
    ...parsed.req.names,
    "--run",
    dispatch,
    "--timeout",
    String(timeout),
  ];
  if (parsed.req.repository === true) makeArgs.push("--repository");
  const kinds = parsed.req.kinds.join(",");
  const dispatchNote =
    labels.join(",") === kinds
      ? `dispatching verifier session for kinds ${kinds}`
      : `dispatching verifier session for kinds ${kinds} (${labels.join(",")})`;
  if (!logVerdict(dispatch, dispatchNote, "dispatch")) return 2;
  const make = run(RUN, makeArgs);
  transcript("make", makeArgs, make.code, make.out, make.err);
  if (make.code === 2) {
    console.error(`setup-verifiers: verifier make misused: ${withoutPrefix(firstLine(make.err))}`);
    return 2;
  }
  let verdict = "";
  let landed = "";
  let kept = "";
  if (make.code !== 0) {
    verdict = `verifier make exited ${make.code}: ${withoutPrefix(firstLine(make.err)) || "no reason given"}`;
  } else if (parsed.req.repository !== true) {
    const made = parseLocalMakeOutput(make.out);
    if (made === null) {
      console.error("setup-verifiers: verifier make printed no kept folder and hand-over");
      return 2;
    }
    kept = made.kept;
    console.log(`handover ${made.handover}`);
    console.log(`kept: ${made.kept}`);
  } else {
    const made = parseMakeOutput(make.out);
    if (made === null) {
      console.error("setup-verifiers: verifier make printed no branch and hand-over");
      return 2;
    }
    console.log(`branch ${made.branch}`);
    console.log(`handover ${made.handover}`);
    const landArgs = [
      "verifier",
      "land",
      repo,
      made.branch,
      "--run",
      dispatch,
      "--handover",
      made.handover,
      "--folder",
      sessionFolder(repo, parsed.req.surfaces),
      "--landing",
      "local",
      "--word",
    ];
    const land = run(RUN, landArgs);
    transcript("land", landArgs, land.code, land.out, land.err);
    const merge = land.out.split("\n").find((l) => l.startsWith("merge: "));
    if (land.code === 0 && merge !== undefined) {
      landed = made.branch;
      console.log(`landed: ${merge.slice("merge: ".length)}`);
    } else if (land.code === 0) {
      verdict = `verifier land waited: ${lastLine(land.out) || "no reason given"}`;
    } else {
      verdict = `verifier land exited ${land.code}: ${lastLine(land.out) || withoutPrefix(firstLine(land.err)) || "no reason given"}`;
    }
  }
  if (verdict === "") {
    if (!logVerdict(dispatch, kept === "" ? `landed ${landed}` : `kept ${kept}`)) return 2;
    return 0;
  }
  console.log(`given up: ${verdict}`);
  if (!logVerdict(dispatch, `given up: ${verdict}`)) return 2;
  return 1;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
