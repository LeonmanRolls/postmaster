// Oracle helpers for #338: one check says whether a project is set up. The
// tests spawn scripts/run as a subprocess over scratch configs and scratch
// git repositories; nothing here imports the change.
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { beside, toolRoot } from "./lib/paths.ts";
import { type RunResult, run } from "./lib/proc.ts";

export const ROOT = toolRoot(import.meta);
export const RUN = beside(import.meta, "run");

export function tempDir(): string {
  // Resolved: the command prints git-resolved paths, and the tests compare
  // them with paths under this folder, which differ where tmp is a symlink.
  return realpathSync(mkdtempSync(join(tmpdir(), "acceptance-338-")));
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

export function checkSetup(repo: string, configPath: string, bin: string): RunResult {
  return run(RUN, ["check-setup", repo], {
    env: {
      POSTMASTER_CONFIG: configPath,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
    },
  });
}
