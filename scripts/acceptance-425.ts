// Support for the #425 oracle (scripts/acceptance-425.test.ts): reading this
// repository's own install config, building a recorded registry fixture for
// refresh-parser, and serving a stub registry so install tests never touch
// the network.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readJsonFile, readTomlFile } from "./lib/data.ts";

const DAY_MS = 86_400_000;

/** The repository root: this helper lives in scripts/. */
export function repoRoot(): string {
  return join(import.meta.dir, "..");
}

export interface Manifest {
  scripts: { check: string };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  trustedDependencies?: unknown;
}

export function readManifest(): Manifest {
  return readJsonFile<Manifest>(join(repoRoot(), "package.json"));
}

export function readBunfig(): Record<string, unknown> {
  return readTomlFile(join(repoRoot(), "bunfig.toml"));
}

export interface RefreshFixture {
  dir: string;
  oldVersion: string;
  youngVersion: string;
}

/** The marker the fixture parser bundle carries, so a test can tell a
 * fixture take from whatever the vendor directory held before. */
export const PARSER_MARKER = "probe-425 parser bundle";

/** Pack a parser tarball with the layout refresh-parser reads: the bundle
 * under package/lib/index.js and the license beside it. */
function writeParserTarball(tgz: string, version: string): void {
  const stage = mkdtempSync(join(tmpdir(), "postmaster-425-stage-"));
  try {
    const pkg = join(stage, "package");
    mkdirSync(join(pkg, "lib"), { recursive: true });
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "@babel/parser", version }));
    writeFileSync(
      join(pkg, "lib", "index.js"),
      `// ${PARSER_MARKER}\nmodule.exports = { parse() { return null; } };\n`,
    );
    writeFileSync(join(pkg, "LICENSE"), "probe-425 license\n");
    const tar = spawnSync("tar", ["czf", tgz, "-C", stage, "package"]);
    if (tar.status !== 0) throw new Error("probe-425: tar could not pack the bundle");
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

function tarballIntegrity(tgz: string): string {
  const digest = createHash("sha512").update(readFileSync(tgz)).digest("base64");
  return `sha512-${digest}`;
}

/** A recorded registry document for one refresh-parser run: a packument with
 * one version eight days old and one one hour old, each with its tarball.
 * Times stay relative to now so the fixture never ages out. */
export function makeRefreshFixture(): RefreshFixture {
  const dir = mkdtempSync(join(tmpdir(), "postmaster-425-refresh-"));
  const oldVersion = "7.10.0";
  const youngVersion = "7.11.0";
  const now = Date.now();
  const pairs: Array<[string, string]> = [
    [oldVersion, new Date(now - 8 * DAY_MS).toISOString()],
    [youngVersion, new Date(now - 3_600_000).toISOString()],
  ];
  const time: Record<string, string> = {
    created: pairs[0]![1],
    modified: pairs[1]![1],
  };
  const versions: Record<string, unknown> = {};
  for (const [version, published] of pairs) {
    const tgz = join(dir, `${version}.tgz`);
    writeParserTarball(tgz, version);
    time[version] = published;
    versions[version] = {
      name: "@babel/parser",
      version,
      dist: {
        tarball: `https://registry.npmjs.org/@babel/parser/-/parser-${version}.tgz`,
        integrity: tarballIntegrity(tgz),
      },
    };
  }
  writeFileSync(
    join(dir, "packument.json"),
    JSON.stringify({
      name: "@babel/parser",
      "dist-tags": { latest: youngVersion },
      time,
      versions,
    }),
  );
  return { dir, oldVersion, youngVersion };
}

export interface ScanAdvisory {
  level: string;
  package: string;
  url: string | null;
  description: string | null;
}

export interface ScanVerdict {
  error?: string;
  advisories?: Record<string, ScanAdvisory[]>;
}

/** A recorded scanner verdict: advisories keyed by name@version, or an error
 * the scan throws as if the scanner were unreachable. */
export function writeScanFixture(dir: string, verdict: ScanVerdict): string {
  const path = join(dir, "verdict.json");
  writeFileSync(path, JSON.stringify(verdict));
  return path;
}

export interface StubRegistry {
  url: string;
  stop(): void;
}

/** A stub npm registry serving one package, so install tests never touch the
 * network. The package is a month old, past any age gate. */
export function startStubRegistry(): StubRegistry {
  const dir = mkdtempSync(join(tmpdir(), "postmaster-425-registry-"));
  const stage = join(dir, "stage");
  const pkg = join(stage, "package");
  mkdirSync(pkg, { recursive: true });
  writeFileSync(
    join(pkg, "package.json"),
    JSON.stringify({ name: "probe-425-pkg", version: "1.0.0" }),
  );
  writeFileSync(join(pkg, "index.js"), "module.exports = 42;\n");
  const tgz = join(dir, "probe.tgz");
  const tar = spawnSync("tar", ["czf", tgz, "-C", stage, "package"]);
  if (tar.status !== 0) throw new Error("probe-425: tar could not pack the package");
  const bytes = readFileSync(tgz);
  const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  const published = new Date(Date.now() - 30 * DAY_MS).toISOString();
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const base = `http://127.0.0.1:${server.port}`;
      const u = new URL(req.url);
      if (req.method === "GET" && u.pathname === "/probe-425-pkg") {
        return Response.json({
          name: "probe-425-pkg",
          "dist-tags": { latest: "1.0.0" },
          time: { created: published, modified: published, "1.0.0": published },
          versions: {
            "1.0.0": {
              name: "probe-425-pkg",
              version: "1.0.0",
              dist: { tarball: `${base}/tarballs/probe.tgz`, integrity },
            },
          },
        });
      }
      if (req.method === "GET" && u.pathname === "/tarballs/probe.tgz") {
        return new Response(bytes, {
          headers: { "content-type": "application/octet-stream" },
        });
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

/** A scratch project installing the stub registry's package through the
 * repository's scanner module. */
export function makeInstallScratch(registryUrl: string, scannerPath: string): string {
  const dir = mkdtempSync(join(tmpdir(), "postmaster-425-install-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "probe-425-install",
      private: true,
      dependencies: { "probe-425-pkg": "1.0.0" },
    }),
  );
  writeFileSync(
    join(dir, "bunfig.toml"),
    `[install]\nregistry = "${registryUrl}"\n\n[install.security]\nscanner = "${scannerPath}"\n`,
  );
  return dir;
}

export interface RunResult {
  code: number | null;
  out: string;
  err: string;
}

export function runRefresh(args: string[], env: Record<string, string>): RunResult {
  const root = repoRoot();
  const r = spawnSync(join(root, "scripts", "run"), ["refresh-parser", ...args], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

/** Async, so the stub registry serving this install keeps answering while the
 * child runs; a synchronous spawn would deadlock the in-process server. */
export async function runInstall(dir: string, env: Record<string, string>): Promise<RunResult> {
  const child = Bun.spawn(["bun", "install"], {
    cwd: dir,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await child.exited;
  const out = await new Response(child.stdout).text();
  const err = await new Response(child.stderr).text();
  return { code, out, err };
}

export function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function cleanup(...dirs: string[]): void {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}
