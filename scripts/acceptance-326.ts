// Oracle helpers for #326: setup offers a new project verifiers and waits for them.
// The tests drive git and scripts/run as subprocesses; nothing here imports the change.
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitAll, gitOrThrow, initRepo, writeRepoFile } from "./acceptance-323.ts";

export type ScratchKind = "bin" | "vite" | "bin-vite" | "exports" | "makefile";

const PACKAGE: Record<Exclude<ScratchKind, "makefile">, string> = {
  bin: JSON.stringify({ name: "app", private: true, bin: { app: "./cli.js" } }, null, 2),
  vite: JSON.stringify({ name: "app", private: true, devDependencies: { vite: "1.0.0" } }, null, 2),
  "bin-vite": JSON.stringify(
    {
      name: "app",
      private: true,
      bin: { app: "./cli.js" },
      devDependencies: { vite: "1.0.0" },
    },
    null,
    2,
  ),
  exports: JSON.stringify({ name: "app", exports: { ".": "./index.js" } }, null, 2),
};

/** A scratch repository of one shape, committed, named app. A Makefile-only repo has no package.json. */
export function scratchRepo(kind: ScratchKind): { dir: string; repo: string } {
  const dir = mkdtempSync(join(tmpdir(), "acceptance-326-"));
  const repo = join(dir, "app");
  initRepo(repo);
  writeRepoFile(repo, "README.md", "# app\n");
  if (kind === "makefile") {
    writeRepoFile(repo, "Makefile", "build:\n\techo build\n");
  } else {
    writeRepoFile(repo, "package.json", `${PACKAGE[kind]}\n`);
  }
  commitAll(repo, "first");
  return { dir, repo };
}

/** A git repository with no commit, so verifier make fails before any session starts. */
export function noCommitRepo(): { dir: string; repo: string } {
  const dir = mkdtempSync(join(tmpdir(), "acceptance-326-"));
  const repo = join(dir, "app");
  initRepo(repo);
  writeRepoFile(repo, "README.md", "# app\n");
  return { dir, repo };
}

/** Mark a repo the way run fixture new marks its copy (fixture.ts). */
export function markFixture(repo: string, ticket = "326"): void {
  gitOrThrow(repo, "config", "--local", "postmaster.fixture", ticket);
}

/** A minimal machine config giving the coachman roles, for POSTMASTER_CONFIG. */
export function writeMinimalConfig(dir: string): string {
  const path = join(dir, "config.toml");
  writeFileSync(
    path,
    '[team.coachman]\nharness = "muse"\nmodel = "muse-spark-test"\n' +
      '[team.coachman_fallback]\nharness = "muse"\nmodel = "muse-spark-test"\n' +
      '[team.postmaster]\nharness = "claude"\nmodel = "claude-sonnet-test"\n' +
      '[ship]\nmerge_authority = "user"\n',
  );
  return path;
}

/** A directory holding an executable tmux stub, to prepend to PATH with POSTMASTER_HOST=tmux. */
export function fakeTmuxDir(dir: string): string {
  const bin = join(dir, "fakebin");
  const stub = join(bin, "tmux");
  writeRepoFile(dir, "fakebin/tmux", "#!/bin/sh\nexit 0\n");
  chmodSync(stub, 0o755);
  return bin;
}

/** The value of the first `key=` line in the output, or null. */
export function lineValue(out: string, key: string): string | null {
  for (const line of out.split("\n")) {
    if (line === `${key}=`) return "";
    if (line.startsWith(`${key}=`)) return line.slice(key.length + 1);
  }
  return null;
}
