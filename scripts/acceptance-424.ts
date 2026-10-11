// Support for the #424 oracle (scripts/acceptance-424.test.ts): a stub npm
// registry serving the ticket's own libraries, scratch projects installing
// through this repository's scanner module, a recorded registry fixture for
// refresh-parser, library facts fixtures, worktree approval caches, and
// shared clones with library-change branches for the landing check. Install
// tests never touch the network; the Socket scan always answers from a
// recorded verdict.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DAY_MS = 86_400_000;

/** The repository root: this helper lives in scripts/. */
export function repoRoot(): string {
  return join(import.meta.dir, "..");
}

export interface RunResult {
  code: number | null;
  out: string;
  err: string;
}

function resultOf(r: {
  status: number | null;
  stdout: string | Buffer;
  stderr: string | Buffer;
}): RunResult {
  return { code: r.status, out: String(r.stdout), err: String(r.stderr) };
}

/** Run this repository's scripts/run as a subprocess. */
export function runTool(args: string[], env: Record<string, string> = {}): RunResult {
  const root = repoRoot();
  return resultOf(
    spawnSync(join(root, "scripts", "run"), args, {
      cwd: root,
      env: { ...process.env, ...env },
      encoding: "utf8",
    }),
  );
}

/** Async, for commands that transitively reach the in-process stub registry:
 * a synchronous spawn would deadlock the server. */
export async function runToolAsync(
  args: string[],
  env: Record<string, string> = {},
): Promise<RunResult> {
  const root = repoRoot();
  const child = Bun.spawn([join(root, "scripts", "run"), ...args], {
    cwd: root,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await child.exited;
  const out = await new Response(child.stdout).text();
  const err = await new Response(child.stderr).text();
  return { code, out, err };
}

/** Async, so the stub registry serving this bun call keeps answering while
 * the child runs; a synchronous spawn would deadlock the in-process server. */
export async function runBun(
  args: string[],
  cwd: string,
  env: Record<string, string> = {},
): Promise<RunResult> {
  const child = Bun.spawn(["bun", ...args], {
    cwd,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await child.exited;
  const out = await new Response(child.stdout).text();
  const err = await new Response(child.stderr).text();
  return { code, out, err };
}

export interface StubPackage {
  name: string;
  version: string;
  dependencies: Record<string, string>;
}

/** The stub registry's catalogue: the ticket's own libraries. left-pad has
 * no dependencies; is-odd brings is-number, the real edge, so approval
 * closure has something to carry. Every version is a month old, past any
 * age gate. */
export const STUB_PACKAGES: StubPackage[] = [
  { name: "left-pad", version: "1.3.0", dependencies: {} },
  { name: "is-odd", version: "3.0.1", dependencies: { "is-number": "^7.0.0" } },
  { name: "is-number", version: "7.0.0", dependencies: {} },
];

export interface StubRegistry {
  url: string;
  stop(): void;
}

export function startStubRegistry(): StubRegistry {
  const dir = mkdtempSync(join(tmpdir(), "postmaster-424-registry-"));
  const published = new Date(Date.now() - 30 * DAY_MS).toISOString();
  const tarballs = new Map<string, Buffer>();
  const integrities = new Map<string, string>();
  for (const pkg of STUB_PACKAGES) {
    const stage = join(dir, `stage-${pkg.name}`);
    const pkgDir = join(stage, "package");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({ name: pkg.name, version: pkg.version, dependencies: pkg.dependencies }),
    );
    writeFileSync(join(pkgDir, "index.js"), "module.exports = 42;\n");
    const tgz = join(dir, `${pkg.name}.tgz`);
    const tar = spawnSync("tar", ["czf", tgz, "-C", stage, "package"]);
    if (tar.status !== 0) throw new Error("probe-424: tar could not pack the package");
    const bytes = readFileSync(tgz);
    tarballs.set(pkg.name, bytes);
    integrities.set(pkg.name, `sha512-${createHash("sha512").update(bytes).digest("base64")}`);
  }
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const base = `http://127.0.0.1:${server.port}`;
      const u = new URL(req.url);
      for (const pkg of STUB_PACKAGES) {
        if (req.method === "GET" && u.pathname === `/${pkg.name}`) {
          return Response.json({
            name: pkg.name,
            "dist-tags": { latest: pkg.version },
            time: { created: published, modified: published, [pkg.version]: published },
            versions: {
              [pkg.version]: {
                name: pkg.name,
                version: pkg.version,
                dependencies: pkg.dependencies,
                dist: {
                  tarball: `${base}/tarballs/${pkg.name}.tgz`,
                  integrity: integrities.get(pkg.name),
                },
              },
            },
          });
        }
        if (req.method === "GET" && u.pathname === `/tarballs/${pkg.name}.tgz`) {
          return new Response(tarballs.get(pkg.name)!, {
            headers: { "content-type": "application/octet-stream" },
          });
        }
      }
      return new Response("not found", { status: 404 });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}/`,
    stop() {
      server.stop();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** A scratch project installing from the stub registry through the
 * repository's scanner module. */
export function makeInstallScratch(registryUrl: string): string {
  const dir = mkdtempSync(join(tmpdir(), "postmaster-424-install-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "probe-424-install", private: true }),
  );
  writeFileSync(
    join(dir, "bunfig.toml"),
    `[install]\nregistry = "${registryUrl}"\n\n[install.security]\nscanner = "${join(repoRoot(), "scripts", "lib", "install-scanner.ts")}"\n`,
  );
  return dir;
}

/** A recorded scanner verdict: advisories keyed by name@version, or an error
 * the scan throws as if the scanner were unreachable. */
export function writeScanFixture(
  dir: string,
  verdict: { error?: string; advisories?: Record<string, unknown[]> },
): string {
  const path = join(dir, "verdict.json");
  writeFileSync(path, JSON.stringify(verdict));
  return path;
}

/** The worktree approval cache: the name@versions one run's user said yes
 * to, as `run libraries record` writes it. */
export function writeApprovals(dir: string, names: string[]): string {
  const approvals: Record<string, { identity: string; run: string }> = {};
  for (const name of names) approvals[name] = { identity: "library:probe", run: "424" };
  const path = join(dir, ".postmaster", "library-approvals.json");
  mkdirSync(join(dir, ".postmaster"), { recursive: true });
  writeFileSync(path, JSON.stringify({ version: 1, approvals }));
  return path;
}

/** A ticket carrying the ticket's own library list: left-pad 1.3.0 in the
 * plain part, with a decoy list past `## For the agents` that the reading
 * must not take. */
export function writeTicket(dir: string): string {
  const path = join(dir, "ticket.md");
  writeFileSync(
    path,
    `# Probe ticket\n\n## Problem\n\nNeeds padding.\n\n## Libraries\n\n- left-pad 1.3.0 one function, no dependencies, vetted by the clerk\n\n## For the agents\n\n## Libraries\n\n- is-odd 3.0.1 a decoy past the agents line\n`,
  );
  return path;
}

export interface RefreshFixture {
  dir: string;
  version: string;
}

/** A recorded registry document for one refresh-parser run: a packument
 * with one version eight days old. With tarballs, the tarball is beside
 * it; without, a refresh that downloads before refusing fails on the
 * missing file instead of the missing approval. */
export function makeRefreshFixture(withTarball: boolean): RefreshFixture {
  const dir = mkdtempSync(join(tmpdir(), "postmaster-424-refresh-"));
  const version = "7.10.0";
  const published = new Date(Date.now() - 8 * DAY_MS).toISOString();
  let integrity = `sha512-${createHash("sha512").update("probe-424").digest("base64")}`;
  if (withTarball) {
    const stage = join(dir, "stage");
    const pkg = join(stage, "package");
    mkdirSync(join(pkg, "lib"), { recursive: true });
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "@babel/parser", version }));
    writeFileSync(
      join(pkg, "lib", "index.js"),
      "// probe-424 parser bundle\nmodule.exports = { parse() { return null; } };\n",
    );
    writeFileSync(join(pkg, "LICENSE"), "probe-424 license\n");
    const tgz = join(dir, `${version}.tgz`);
    const tar = spawnSync("tar", ["czf", tgz, "-C", stage, "package"]);
    if (tar.status !== 0) throw new Error("probe-424: tar could not pack the bundle");
    integrity = `sha512-${createHash("sha512").update(readFileSync(tgz)).digest("base64")}`;
  }
  writeFileSync(
    join(dir, "packument.json"),
    JSON.stringify({
      name: "@babel/parser",
      "dist-tags": { latest: version },
      time: { created: published, modified: published, [version]: published },
      versions: {
        [version]: {
          name: "@babel/parser",
          version,
          dist: {
            tarball: `https://registry.npmjs.org/@babel/parser/-/parser-${version}.tgz`,
            integrity,
          },
        },
      },
    }),
  );
  return { dir, version };
}

/** A recorded library-facts fixture: one packument per package with its
 * publish time and source repository, and the Socket verdict beside them.
 * Keys are encodeURIComponent(name)@version. */
export function writeFactsFixture(
  dir: string,
  entries: Array<{ name: string; version: string; published: string; source: string | null }>,
  advisories: Record<string, unknown[]> = {},
): string {
  const fx = join(dir, "facts");
  mkdirSync(fx, { recursive: true });
  for (const entry of entries) {
    writeFileSync(
      join(fx, `${encodeURIComponent(entry.name)}@${entry.version}.json`),
      JSON.stringify({
        name: entry.name,
        time: {
          created: entry.published,
          modified: entry.published,
          [entry.version]: entry.published,
        },
        versions: {
          [entry.version]: {
            name: entry.name,
            version: entry.version,
            repository: entry.source === null ? undefined : { type: "git", url: entry.source },
          },
        },
      }),
    );
  }
  writeFileSync(join(fx, "verdict.json"), JSON.stringify({ advisories }));
  return fx;
}

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "probe-424",
  GIT_AUTHOR_EMAIL: "probe-424@example.invalid",
  GIT_COMMITTER_NAME: "probe-424",
  GIT_COMMITTER_EMAIL: "probe-424@example.invalid",
};

/** A shared clone of this repository for landing tests: every object
 * shared, with a local main at the default branch, so branches from the
 * head land against it. */
export function makeClone(): string {
  const dir = mkdtempSync(join(tmpdir(), "postmaster-424-clone-"));
  const clone = spawnSync("git", ["clone", "--shared", "-q", repoRoot(), dir], {
    env: GIT_ENV,
    encoding: "utf8",
  });
  if (clone.status !== 0) throw new Error(`probe-424: git clone failed: ${clone.stderr}`);
  const main = spawnSync("git", ["-C", dir, "branch", "-q", "main", "origin/main"], {
    env: GIT_ENV,
    encoding: "utf8",
  });
  if (main.status !== 0) throw new Error(`probe-424: no origin/main to land on: ${main.stderr}`);
  return dir;
}

/** The clone's head: every probe branch starts from it. */
export function baseOf(clone: string): string {
  const r = spawnSync("git", ["-C", clone, "rev-parse", "HEAD"], {
    env: GIT_ENV,
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(`probe-424: git rev-parse failed: ${r.stderr}`);
  return r.stdout.trim();
}

/** Commit the clone's current changes on a new branch from base. */
export function commitBranch(clone: string, branch: string, message: string, base: string): void {
  const run = (args: string[]): void => {
    const r = spawnSync("git", ["-C", clone, ...args], { env: GIT_ENV, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`probe-424: git ${args.join(" ")} failed: ${r.stderr}`);
  };
  run(["checkout", "-qb", branch, base]);
  run(["add", "-A"]);
  run(["commit", "-qm", message]);
}

/** A scratch dispatch directory shaped like a run's: basename 424, with the
 * project's ledger beside it, so `run log-action` records approvals the
 * landing check reads back. */
export function makeDispatch(): string {
  const runs = mkdtempSync(join(tmpdir(), "postmaster-424-runs-"));
  const dispatch = join(runs, "424");
  mkdirSync(dispatch, { recursive: true });
  return dispatch;
}

export function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function cleanup(...dirs: string[]): void {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}
