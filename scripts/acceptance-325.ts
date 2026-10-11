// Oracle helpers for #325: a project's verifiers land only when they pass its checks.
// The tests plant branches of the scratch app (a copy of fixtures/app) and drive git or
// scripts/run as subprocesses; nothing here imports the change.
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitAll, gitOrThrow, initRepo, writeRepoFile } from "./acceptance-323.ts";
import { beside, toolRoot } from "./lib/paths.ts";
import { type RunResult, run } from "./lib/proc.ts";

export const ROOT = toolRoot(import.meta);
export const RUN = beside(import.meta, "run");
export const FIXTURE_APP = join(ROOT, "fixtures/app");
export const PR_URL = "https://github.com/example/app/pull/1";

// The planted verifier files, byte-exact. The gate probe passed on these: Biome reads the
// helper alone, so the markdown stays however it reads, and the helper below is formatted.
export const VERIFIER_README = `# app verifier

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

export const FEATURES_README = `# features

## add

The add command.

## done

The done command.

## list

The list command.
`;

export function featurePage(name: string): string {
  return `# ${name}

One paragraph saying what a user sees.

## Sub-features

None.

## How a user reaches it

Run \`todo ${name}\`.

## Driving it

Drive ${name} once.

## Traps

Empty text is refused.
`;
}

export const HELPER_GOOD = "export function helper(): number {\n  return 1;\n}\n";
export const HELPER_BAD = "export   function   helper(  )  {  return  1  }\n";

/** One verifier's files under a folder, with the helper as given. */
export function verifierFiles(folder: string, helper: string): Record<string, string> {
  return {
    [`${folder}/README.md`]: VERIFIER_README,
    [`${folder}/features/README.md`]: FEATURES_README,
    [`${folder}/features/add.md`]: featurePage("add"),
    [`${folder}/features/done.md`]: featurePage("done"),
    [`${folder}/features/list.md`]: featurePage("list"),
    [`${folder}/helper.ts`]: helper,
  };
}

let template: string | null = null;

/** The installed scratch app every test copies: committed once, installed once. */
export function templateApp(): string {
  if (template !== null) return template;
  const dir = mkdtempSync(join(tmpdir(), "acceptance-325-template-"));
  const repo = join(dir, "app");
  const cp = run("cp", ["-R", FIXTURE_APP, repo]);
  if (cp.code !== 0) throw new Error(`cp template: ${cp.err.trim() || cp.out.trim()}`);
  initRepo(repo);
  commitAll(repo, "first");
  // npm ci, never npm install: install rewrites the tracked lockfile under some
  // npms, which dirtied the template on CI's Linux runner and refused every
  // planted branch naming package-lock.json.
  const install = run("npm", ["ci", "--no-audit", "--no-fund"], { cwd: repo });
  if (install.code !== 0) {
    throw new Error(`npm ci: ${install.err.trim() || install.out.trim()}`);
  }
  const dirty = gitOrThrow(repo, "status", "--porcelain").trim();
  if (dirty !== "") {
    throw new Error(`template dirty after install: ${dirty.split("\n")[0]}`);
  }
  template = repo;
  return repo;
}

/** Remove the template; the test file calls this once it is done with it. */
export function cleanupTemplate(): void {
  if (template === null) return;
  rmSync(join(template, ".."), { recursive: true, force: true });
  template = null;
}

/** A fresh scratch app named app, so its verifiers' folder is verify-app. */
export function freshApp(): { dir: string; repo: string } {
  const dir = mkdtempSync(join(tmpdir(), "acceptance-325-"));
  const repo = join(dir, "app");
  const cp = run("cp", ["-R", templateApp(), repo]);
  if (cp.code !== 0) throw new Error(`cp scratch: ${cp.err.trim() || cp.out.trim()}`);
  gitOrThrow(repo, "rev-parse", "HEAD");
  return { dir, repo };
}

export function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

/** Commit files on a new branch, leaving the checkout on back (main). */
export function plantBranch(
  repo: string,
  branch: string,
  files: Record<string, string>,
  message: string,
  back = "main",
): void {
  gitOrThrow(repo, "checkout", "-qb", branch);
  for (const [rel, text] of Object.entries(files)) writeRepoFile(repo, rel, text);
  commitAll(repo, message);
  gitOrThrow(repo, "checkout", "-q", back);
}

/** Point a repo's origin HEAD at a branch, with the remote ref to match. */
export function pointOriginHead(repo: string, branch: string): void {
  const sha = gitOrThrow(repo, "rev-parse", "HEAD").trim();
  gitOrThrow(repo, "update-ref", `refs/remotes/origin/${branch}`, sha);
  gitOrThrow(repo, "symbolic-ref", "refs/remotes/origin/HEAD", `refs/remotes/origin/${branch}`);
}

/** A dispatch holding only the merge authority the case needs. */
export function makeDispatch(dir: string, authority: string): string {
  const dispatch = mkdtempSync(join(dir, "dispatch-"));
  writeFileSync(
    join(dispatch, "run.json"),
    JSON.stringify({ config: { ship: { merge_authority: authority } } }),
  );
  return dispatch;
}

export function writeHandover(dir: string, name: string, text: string): string {
  const path = join(dir, name);
  writeFileSync(path, text);
  return path;
}

export function writeProof(dir: string, name: string): string {
  const path = join(dir, name);
  writeFileSync(path, "proof\n");
  return path;
}

export function handoverEntry(name: string, folder: string, proof: string): string {
  return `## Verifier: ${name}\nFolder: ${folder}\nProof: ${proof}\n`;
}

export function handoverDoc(...entries: string[]): string {
  return `# Handover\n\nProved below, one section per verifier.\n\n${entries.join("\n")}`;
}

export interface LoggedAction {
  action: string;
  target: string;
  detail: string;
}

export function readActions(dispatch: string): LoggedAction[] {
  return readFileSync(join(dispatch, "actions.jsonl"), "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as LoggedAction);
}

export function runCheck(
  repo: string,
  branch: string,
  dispatch: string,
  handover: string,
  extra: string[] = [],
): RunResult {
  return run(RUN, [
    "verifier",
    "check",
    repo,
    branch,
    "--run",
    dispatch,
    "--handover",
    handover,
    ...extra,
  ]);
}

export function runLand(
  repo: string,
  branch: string,
  dispatch: string,
  handover: string,
  extra: string[] = [],
  env?: Record<string, string | undefined>,
): RunResult {
  return run(
    RUN,
    ["verifier", "land", repo, branch, "--run", dispatch, "--handover", handover, ...extra],
    env === undefined ? {} : { env },
  );
}

export function headOf(repo: string, ref: string): string {
  return gitOrThrow(repo, "rev-parse", ref).trim();
}

export function parentsOf(repo: string, ref: string): string[] {
  return gitOrThrow(repo, "rev-list", "--parents", "-n", "1", ref).trim().split(" ").slice(1);
}

export function branchHasFile(repo: string, branch: string, path: string): boolean {
  const r = run("git", ["-C", repo, "ls-tree", "--name-only", branch, "--", path]);
  return r.code === 0 && r.out.trim() !== "";
}

/** The gate's log from the run's one checks dir; throws unless there is exactly one. */
export function gateLogOf(dispatch: string): string {
  const dirs = readdirSync(join(dispatch, "verifier-land"), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  if (dirs.length !== 1) throw new Error(`expected one checks dir, found ${dirs.length}`);
  const shas = readdirSync(join(dispatch, "verifier-land", dirs[0] as string, "verify")).filter(
    (s) => /^[0-9a-f]+$/u.test(s),
  );
  if (shas.length !== 1) throw new Error(`expected one verify run, found ${shas.length}`);
  return readFileSync(
    join(dispatch, "verifier-land", dirs[0] as string, "verify", shas[0] as string, "gate.log"),
    "utf8",
  );
}

const STUB_GH = `#!/bin/bash
here=$(dirname "$0")
state="$here/../gh-state"
mkdir -p "$state"
pwd > "$state/cwd"
printf '%s\\n' "$@" > "$state/args"
if [ "$1" = "pr" ] && [ "$2" = "create" ]; then
  echo "${PR_URL}"
  exit 0
fi
echo "stub gh: unexpected: $*" >&2
exit 1
`;

function writeStubGh(dir: string, script: string): { bin: string; state: string } {
  const bin = join(dir, "bin");
  const state = join(dir, "gh-state");
  mkdirSync(bin, { recursive: true });
  mkdirSync(state, { recursive: true });
  writeFileSync(join(bin, "gh"), script);
  chmodSync(join(bin, "gh"), 0o755);
  return { bin, state };
}

/** A stub gh first on PATH: it records pr create and prints a canned URL. */
export function stubGh(dir: string): { bin: string; state: string } {
  return writeStubGh(dir, STUB_GH);
}

const FAILING_GH = `#!/bin/bash
here=$(dirname "$0")
state="$here/../gh-state"
mkdir -p "$state"
pwd > "$state/cwd"
printf '%s\\n' "$@" > "$state/args"
if [ "$1" = "pr" ] && [ "$2" = "create" ]; then
  echo "stub gh: pr create refused" >&2
  exit 1
fi
echo "stub gh: unexpected: $*" >&2
exit 1
`;

/** A stub gh first on PATH: it records pr create, then refuses it. */
export function stubFailingGh(dir: string): { bin: string; state: string } {
  return writeStubGh(dir, FAILING_GH);
}

export function withBinOnPath(bin: string): Record<string, string | undefined> {
  return { PATH: `${bin}:${process.env.PATH ?? ""}` };
}

export function bareOrigin(dir: string): string {
  const bare = join(dir, "origin.git");
  const r = run("git", ["init", "-q", "--bare", bare]);
  if (r.code !== 0) throw new Error(`git init --bare: ${r.err.trim() || r.out.trim()}`);
  return bare;
}

/** A tiny repo whose gate sleeps five seconds: the past-its-limit case. */
export function sleepRepo(dir: string): string {
  const repo = join(dir, "sleepy");
  initRepo(repo);
  writeRepoFile(
    repo,
    ".postmaster/project.toml",
    '[checks.gate]\ncommand = "sleep 5"\nshows = "five seconds pass"\n',
  );
  writeRepoFile(repo, "README.md", "# sleepy\n");
  commitAll(repo, "first");
  return repo;
}

export function checksDirExists(dispatch: string): boolean {
  return existsSync(join(dispatch, "verifier-land"));
}

/** A repo whose gate passes and whose browser suite was never wired up. */
export function suitelessRepo(dir: string): string {
  const repo = join(dir, "suiteless");
  initRepo(repo);
  writeRepoFile(
    repo,
    ".postmaster/project.toml",
    '[checks.gate]\ncommand = "true"\nshows = "true passes"\n[checks.browser]\nuse = "browser-suite"\nshows = "the browser suite passes"\n',
  );
  writeRepoFile(repo, "README.md", "# suiteless\n");
  commitAll(repo, "first");
  return repo;
}
