// Oracle helpers for #339: setup offers the global config, then the project's
// own settings. The tests spawn scripts/run and git as subprocesses over scratch
// configs and scratch git repositories; nothing here imports the change.
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { beside, toolRoot } from "./lib/paths.ts";
import { type RunResult, run } from "./lib/proc.ts";

export const ROOT = toolRoot(import.meta);
export const RUN = beside(import.meta, "run");

export function tempDir(): string {
  // Resolved: commands print git-resolved paths, and the tests compare them
  // with paths under this folder, which differ where tmp is a symlink.
  return realpathSync(mkdtempSync(join(tmpdir(), "acceptance-339-")));
}

export function gitOrThrow(repo: string, ...args: string[]): string {
  const r = run("git", ["-C", repo, ...args]);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.err.trim() || r.out.trim()}`);
  return r.out;
}

export function initRepo(repo: string): void {
  mkdirSync(repo, { recursive: true });
  const r = run("git", ["init", "-q", "-b", "main", repo]);
  if (r.code !== 0) throw new Error(`git init: ${r.err.trim() || r.out.trim()}`);
  gitOrThrow(repo, "config", "user.name", "brindlewick");
  gitOrThrow(repo, "config", "user.email", "332054101+brindlewick@users.noreply.github.com");
}

export function writeRepoFile(repo: string, rel: string, text: string): void {
  const target = join(repo, rel);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
}

/** A bin dir of stub harnesses, to prepend to PATH for one spawn. */
export function stubBin(dir: string, names: string[]): string {
  const bin = join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  for (const name of names) {
    const stub = join(bin, name);
    writeFileSync(stub, "#!/bin/sh\nexit 0\n");
    chmodSync(stub, 0o755);
  }
  return bin;
}

function frontDoorEnv(configPath: string, bin: string): Record<string, string> {
  return {
    POSTMASTER_CONFIG: configPath,
    PATH: `${bin}:${process.env.PATH ?? ""}`,
  };
}

export function setupNext(repo: string, configPath: string, bin: string): RunResult {
  return run(RUN, ["setup-next", repo], { env: frontDoorEnv(configPath, bin) });
}

export function setupProject(
  repo: string,
  configPath: string,
  bin: string,
  args: string[],
): RunResult {
  return run(RUN, ["setup", "--project", repo, ...args], {
    env: frontDoorEnv(configPath, bin),
  });
}

export function checkSetup(repo: string, configPath: string, bin: string): RunResult {
  return run(RUN, ["check-setup", repo], { env: frontDoorEnv(configPath, bin) });
}

export function projectSettings(
  repo: string,
  configPath: string,
  bin: string,
  args: string[],
): RunResult {
  return run(RUN, ["project-settings", ...args], { env: frontDoorEnv(configPath, bin) });
}

/** git check-ignore -q: exit 0 when git ignores the path, 1 when it does not. */
export function checkIgnore(repo: string, rel: string): RunResult {
  return run("git", ["-C", repo, "check-ignore", "-q", rel]);
}
