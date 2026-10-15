// Helpers for the #478 oracle: a scratch app with local verifiers made by the
// real `verifier make` through a stub session, as #477's C4 makes one, and
// small readers over the run's verifier copies. The tests spawn git and
// scripts/run as subprocesses; nothing here imports the change.
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitAll, gitOrThrow, initRepo, writeRepoFile } from "./acceptance-323.ts";
import { makeEnv, makeSandbox, RUN, type Sandbox } from "./acceptance-344.ts";
import { localWork, writeLocalStub, type LocalSurface } from "./acceptance-477.ts";
import { run, type RunResult } from "./lib/proc.ts";

export { RUN };
export type { Sandbox };

export const CLI: LocalSurface = { seg: "cli", prose: "command line", name: "cli" };
export const API: LocalSurface = { seg: "api", prose: "backend service", name: "backend:api" };

/** Assert a driven command's exit code, quoting its stderr when it differs. */
export function expectCode(r: RunResult, code: number): void {
  if (r.code !== code) {
    throw new Error(`exited ${r.code}, expected ${code}: ${(r.err || r.out).trim()}`);
  }
}

/**
 * A scratch app whose local verifiers the real make kept: the index naming
 * verifier/cli, its README, features/README.md and three pages, with the
 * .gitignore make writes. The dispatch holds run.json and the waybill stub
 * the launcher reads; the caller removes the directory.
 */
export function scratchApp(): Sandbox & { sha: string } {
  const sandbox = makeSandbox();
  writeLocalStub(sandbox.bin, localWork([CLI], []).join("\n"));
  const r = run(RUN, ["verifier", "make", sandbox.repo, "cli", "--run", sandbox.dispatch], {
    env: makeEnv(sandbox, { POSTMASTER_HOST: "none" }),
  });
  expectCode(r, 0);
  const sha = gitOrThrow(sandbox.repo, "rev-parse", "HEAD").trim();
  return { ...sandbox, sha };
}

/** A second dispatch against the same app, with run.json and a waybill stub. */
export function extraDispatch(sandbox: Sandbox, name: string): string {
  const dispatch = join(sandbox.dir, name);
  mkdirSync(dispatch, { recursive: true });
  writeFileSync(
    join(dispatch, "run.json"),
    JSON.stringify({
      config: { team: { coachman: { harness: "claude", model: "stub-model" } } },
    }),
  );
  writeFileSync(
    join(dispatch, "brief.md"),
    ["# Waybill: oracle", "", "## Dispatch", `synthesis worktree: ${sandbox.repo}`, ""].join("\n"),
  );
  return dispatch;
}

/** A worktree of the app at its HEAD, on its own branch. */
export function cutWorktree(repo: string, dir: string, name: string, branch: string): string {
  const wt = join(dir, name);
  gitOrThrow(repo, "worktree", "add", wt, "-b", branch);
  return wt;
}

/** The shell lines a stub lane plays to read its copy's index relative to its cwd. */
export function laneReadWork(): string {
  return ["cat .postmaster/verifier/README.md"].join("\n");
}

/**
 * A stub `claude` that plays a lane reading its copy's index, inside its
 * sandbox only. The launch runs it in the lane's worktree.
 */
export function writeLaneStub(bin: string): void {
  const path = join(bin, "claude");
  writeFileSync(
    path,
    [
      "#!/bin/sh",
      "set -eu",
      'if [ -z "${ORACLE_ROOT:-}" ]; then echo "stub refuses: ORACLE_ROOT is unset" >&2; exit 1; fi',
      'TARGET="$PWD"',
      'TARGET=$(CDPATH= cd "$TARGET" && pwd -P) || { echo "stub refuses: cannot resolve $TARGET" >&2; exit 1; }',
      'case "$TARGET" in',
      '  "${ORACLE_ROOT}"/*) ;;',
      '  *) echo "stub refuses: $TARGET is outside $ORACLE_ROOT" >&2; exit 1 ;;',
      "esac",
      laneReadWork(),
      "",
    ].join("\n"),
  );
  chmodSync(path, 0o755);
}

/** A config naming one lane on the stub harness, with confine on or off. */
export function writeLaneConfig(dir: string, confine: "on" | "off"): string {
  const path = join(dir, "config.toml");
  writeFileSync(
    path,
    `confine = "${confine}"\n[lanes.stub]\nharness = "claude"\nmodel = "stub-model"\n`,
  );
  return path;
}

/** A fresh temp dir under the system temp, canonicalized like makeSandbox's. */
export function tempDir(stem: string): string {
  return realpathSync(mkdtempSync(join(tmpdir(), stem)));
}

/** Every regular file under a root, as paths relative to it, sorted. */
export function treeFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const rel = prefix === "" ? name : `${prefix}/${name}`;
      if (statSync(full).isDirectory()) walk(full, rel);
      else if (statSync(full).isFile()) out.push(rel);
    }
  };
  if (!existsSync(root)) return out;
  walk(root, "");
  return out;
}

/** Copy a tree aside for a later byte comparison. */
export function snapshotTree(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true });
}

/** Read every file of a tree into a map of relative path to bytes. */
export function readTree(root: string): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  for (const rel of treeFiles(root)) out.set(rel, readFileSync(join(root, rel)));
  return out;
}

export { commitAll, initRepo, writeRepoFile };
