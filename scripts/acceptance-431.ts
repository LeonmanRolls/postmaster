// Oracle helpers for #431: project setup refuses a Plane tracker with no API
// origin known from the answers, the existing settings or the global config.
// The tests spawn scripts/run and git as subprocesses over scratch configs
// and scratch git repositories, and a stub Plane API answers over loopback;
// nothing here imports the change.
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { beside } from "./lib/paths.ts";
import { type RunResult, run } from "./lib/proc.ts";

export const RUN = beside(import.meta, "run");

export interface Staged {
  dir: string;
  repo: string;
  config: string;
  bin: string;
}

export function tempDir(): string {
  // Resolved: commands print git-resolved paths, and the tests compare them
  // with paths under this folder, which differ where tmp is a symlink.
  return realpathSync(mkdtempSync(join(tmpdir(), "acceptance-431-")));
}

export function initRepo(repo: string): void {
  mkdirSync(repo, { recursive: true });
  const r = run("git", ["init", "-q", "-b", "main", repo]);
  if (r.code !== 0) throw new Error(`git init: ${r.err.trim() || r.out.trim()}`);
}

export function writeRepoFile(repo: string, rel: string, text: string): void {
  const target = join(repo, rel);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
}

/** A bin dir of stub harnesses, prepended to PATH for one spawn. */
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

/** A scratch repo with a scratch global config holding the given text. */
export function stage(configText: string): Staged {
  const dir = tempDir();
  const repo = join(dir, "repo");
  initRepo(repo);
  const bin = stubBin(dir, ["claude", "codex"]);
  const config = join(dir, "config.toml");
  writeFileSync(config, configText);
  return { dir, repo, config, bin };
}

function projectEnv(s: Staged): Record<string, string> {
  return {
    POSTMASTER_CONFIG: s.config,
    PATH: `${s.bin}:${process.env.PATH ?? ""}`,
  };
}

export function setupProject(s: Staged, answersText: string, extra: string[] = []): RunResult {
  const answersPath = join(s.dir, "answers");
  writeFileSync(answersPath, `${answersText}\n`);
  return run(RUN, ["setup", "--project", s.repo, "--answers", answersPath, ...extra], {
    env: projectEnv(s),
  });
}

export function setupInteractive(s: Staged, input: string, extra: string[] = []): RunResult {
  return run(RUN, ["setup", "--project", s.repo, ...extra], {
    env: projectEnv(s),
    input,
  });
}

export interface Spawned {
  code: number;
  out: string;
  err: string;
}

export async function planeProjects(s: Staged, key: string): Promise<Spawned> {
  // Async spawn: the in-process stub API can only answer while this loop
  // runs, and a sync spawn would block it for the child's whole life.
  const p = Bun.spawn(["bash", RUN, "plane", "projects"], {
    env: {
      ...process.env,
      POSTMASTER_CONFIG: s.config,
      POSTMASTER_PROJECT: s.repo,
      PLANE_API_KEY: key,
      GIT_CEILING_DIRECTORIES: s.dir,
    } as Record<string, string>,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  return { code, out, err };
}

export interface StubProject {
  id: string;
  identifier: string;
  name: string;
}

/** A stub Plane API answering one workspace's project list over loopback. */
export function startStub(
  workspace: string,
  projects: StubProject[],
): { server: ReturnType<typeof Bun.serve>; url: string } {
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const u = new URL(req.url);
      if (req.method === "GET" && u.pathname === `/api/v1/workspaces/${workspace}/projects/`)
        return Response.json({ results: projects, next_page_results: false });
      return new Response(`stub plane: unexpected ${req.method} ${u.pathname}`, { status: 500 });
    },
  });
  return { server, url: `http://127.0.0.1:${server.port}` };
}
