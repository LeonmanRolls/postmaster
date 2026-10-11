// Oracle helpers for #426: runs on other projects install only approved
// libraries, and only packages a week old, scanned and with no install script.
// Every case drives scripts/run or a lane package manager as a subprocess
// through the guard's own shim; nothing here imports the change.
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beside, toolRoot } from "./lib/paths.ts";
import { run } from "./lib/proc.ts";

export const ROOT = toolRoot(import.meta);
export const RUN = beside(import.meta, "run");
export const FIXTURES = join(ROOT, "scripts/fixtures/acceptance-426");
export const SHIM = join(ROOT, "scripts/install-guard-shim.sh");
export const DEV_BIN = join(ROOT, "node_modules/.bin");

/** The managers the oracle drives for real. Berry is covered by stub-decision
 * tests in this file plus a hand-run transcript on the run's card: no
 * deterministic Berry binary exists for CI, so the oracle never downloads one. */
export type Pm = "npm" | "pnpm" | "yarn" | "bun";
export const PMS: Pm[] = ["npm", "pnpm", "yarn", "bun"];

/** Resolve a manager binary: the repo's pinned dev dependency first, the PATH
 * fallback second, null when neither exists and the test must skip. */
export function pmBin(pm: Pm): string | null {
  const dev = join(DEV_BIN, pm);
  if (existsSync(dev)) return dev;
  const found = run("sh", ["-c", `command -v ${pm}`]);
  if (found.code === 0 && found.out.trim() !== "") return pm;
  return null;
}

export function scratchDir(prefix: string): string {
  return realpathSync(mkdtempSync(join(realpathSync(tmpdir()), prefix)));
}

export function removeDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

export interface BuiltTarball {
  file: string;
  integrity: string;
}

/** Pack a fixture package dir into a registry-style tarball with a package/
 * root, rewriting its version. Returns the file name and its integrity. The
 * bytes are deterministic per machine (sorted entries, fixed mtimes, gzip
 * without name or mtime), so manager caches stay valid across runs. */
export function buildTarball(pkgDir: string, destDir: string, version: string): BuiltTarball {
  const stage = join(destDir, "stage");
  const root = join(stage, "package");
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  cpSync(pkgDir, root, { recursive: true });
  const manifestPath = join(root, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  manifest.version = version;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const name = String(manifest.name ?? "unknown");
  const short = name.includes("/") ? name.slice(name.indexOf("/") + 1) : name;
  const file = `${short}-${version}.tgz`;
  const out = join(destDir, file);
  const entries = readdirSync(root).sort();
  const touch = run("touch", ["-t", "202001010000", root, ...entries.map((e) => join(root, e))]);
  if (touch.code !== 0) throw new Error(`touch: ${touch.err.trim() || touch.out.trim()}`);
  const tar = run("tar", ["--no-recursion", "-cf", join(destDir, "stage.tar"), "-C", stage, "package", ...entries.map((e) => `package/${e}`)]);
  if (tar.code !== 0) throw new Error(`tar: ${tar.err.trim() || tar.out.trim()}`);
  const gzip = run("gzip", ["-n", join(destDir, "stage.tar")]);
  if (gzip.code !== 0) throw new Error(`gzip: ${gzip.err.trim() || gzip.out.trim()}`);
  cpSync(join(destDir, "stage.tar.gz"), out);
  rmSync(stage, { recursive: true, force: true });
  rmSync(join(destDir, "stage.tar.gz"), { force: true });
  const bytes = readFileSync(out);
  const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  return { file, integrity };
}

export interface RegistryVersion {
  version: string;
  published: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  bin?: Record<string, string>;
  tarball: string;
  integrity: string;
}

export interface RegistryPackage {
  tags: Record<string, string>;
  versions: RegistryVersion[];
}

export interface SocketAlert {
  type: string;
  action: string;
}

export interface LoggedRequest {
  method: string;
  path: string;
}

export interface Registry {
  url: string;
  socketUrl: string;
  packages: Map<string, RegistryPackage>;
  verdicts: Map<string, SocketAlert[]>;
  log: LoggedRequest[];
  stop: () => void;
}

/** A loopback npm registry plus a Socket firewall stub. Packuments and
 * tarballs are served from the test's own state; every request is logged, so
 * a test proves "before any download" from the log rather than trusting the
 * guard's word. Unknown packages answer the firewall's synthetic not-found
 * shape, as the live API does. */
export function startRegistry(tarballDir: string): Registry {
  const packages = new Map<string, RegistryPackage>();
  const verdicts = new Map<string, SocketAlert[]>();
  const log: LoggedRequest[] = [];
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const u = new URL(req.url);
      log.push({ method: req.method, path: u.pathname });
      if (req.method === "GET" && u.pathname.startsWith("/tarballs/")) {
        const file = join(tarballDir, u.pathname.slice("/tarballs/".length));
        if (!existsSync(file)) return new Response("no such tarball", { status: 404 });
        return new Response(readFileSync(file));
      }
      if (req.method === "GET" && u.pathname.startsWith("/socket/purl/")) {
        const purl = decodeURIComponent(u.pathname.slice("/socket/purl/".length));
        const at = purl.lastIndexOf("@");
        const key = at > "pkg:npm/".length ? purl.slice("pkg:npm/".length) : "";
        const alerts = key === "" ? undefined : verdicts.get(key);
        if (alerts === undefined) {
          return Response.json({
            id: `synthetic:notFound:${key}`,
            type: "npm",
            name: key.slice(0, key.lastIndexOf("@")),
            version: key.slice(key.lastIndexOf("@") + 1),
            alerts: [],
            inputPurl: purl,
          });
        }
        return new Response(`${JSON.stringify({ inputPurl: purl, alerts })}\n`, {
          headers: { "content-type": "application/x-ndjson" },
        });
      }
      if (req.method === "GET") {
        const name = decodeURIComponent(u.pathname.slice(1));
        const pkg = packages.get(name);
        if (pkg === undefined) {
          return new Response(JSON.stringify({ error: "not found" }), {
            status: 404,
            headers: { "content-type": "application/json" },
          });
        }
        const base = `http://127.0.0.1:${server.port}`;
        const versions: Record<string, unknown> = {};
        const time: Record<string, string> = {
          created: pkg.versions[0]?.published ?? "",
          modified: pkg.versions[pkg.versions.length - 1]?.published ?? "",
        };
        for (const v of pkg.versions) {
          time[v.version] = v.published;
          versions[v.version] = {
            name,
            version: v.version,
            ...(v.dependencies === undefined ? {} : { dependencies: v.dependencies }),
            ...(v.optionalDependencies === undefined
              ? {}
              : { optionalDependencies: v.optionalDependencies }),
            ...(v.peerDependencies === undefined ? {} : { peerDependencies: v.peerDependencies }),
            ...(v.scripts === undefined ? {} : { scripts: v.scripts }),
            ...(v.bin === undefined ? {} : { bin: v.bin }),
            dist: { tarball: `${base}/tarballs/${v.tarball}`, integrity: v.integrity },
          };
        }
        return Response.json({ name, "dist-tags": pkg.tags, versions, time });
      }
      return new Response("method not allowed", { status: 405 });
    },
  });
  const base = `http://127.0.0.1:${server.port}`;
  return {
    url: base,
    socketUrl: `${base}/socket`,
    packages,
    verdicts,
    log,
    stop: () => server.stop(),
  };
}

export function tarballHits(log: LoggedRequest[]): string[] {
  return log.filter((r) => r.path.startsWith("/tarballs/")).map((r) => r.path);
}

export function packumentHits(log: LoggedRequest[]): string[] {
  return log
    .filter(
      (r) =>
        r.method === "GET" && !r.path.startsWith("/tarballs/") && !r.path.startsWith("/socket/"),
    )
    .map((r) => r.path);
}

/** A minimal waybill carrying a ## Libraries section the way real waybills do:
 * flat ## sections with the ticket between ## Ticket and ## Project profile. */
export function writeBrief(dispatch: string, libraries: string[]): void {
  const lines = [
    "# Waybill: 426",
    "turnpikes: style, bug, security",
    "",
    "## Ticket",
    "## Problem / feature",
    "fabricated",
    "## Libraries",
    ...libraries,
    "## Acceptance criteria",
    "fabricated",
    "## Project profile",
    "repo: /tmp/fabricated",
    "",
  ];
  writeFileSync(join(dispatch, "brief.md"), `${lines.join("\n")}\n`);
}

export interface Approval {
  actor: string;
  action: string;
  target: string;
  detail: string;
}

/** Fabricate a dispatch dir and record approvals through the real log-action,
 * the path the postmaster records them on. Throws when a record is refused. */
export function mkDispatch(
  tmp: string,
  name: string,
  libraries: string[],
  approvals: Approval[],
): string {
  const dispatch = join(tmp, name);
  mkdirSync(join(dispatch, "logs"), { recursive: true });
  writeBrief(dispatch, libraries);
  for (const a of approvals) {
    const r = run(RUN, ["log-action", dispatch, a.actor, a.action, a.target, a.detail]);
    if (r.code !== 0)
      throw new Error(`log-action ${a.action} ${a.target}: ${r.err.trim() || r.out.trim()}`);
  }
  return dispatch;
}

/** A scratch project for one manager. */
export function mkProject(tmp: string, name: string): string {
  const dir = join(tmp, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "guard-probe", private: true }));
  return dir;
}

export interface Guarded {
  code: number;
  out: string;
  err: string;
}

/** Async spawn for commands that need the loopback registry: spawnSync would
 * block the server's event loop and deadlock. Mirrors run()'s 127 shape for
 * a missing command. */
export async function runAsync(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: Record<string, string | undefined> } = {},
): Promise<Guarded> {
  let child: {
    stdout: ReadableStream<Uint8Array> | null;
    stderr: ReadableStream<Uint8Array> | null;
    exited: Promise<number>;
  };
  try {
    child = Bun.spawn([cmd, ...args], {
      cwd: opts.cwd,
      env: opts.env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (e) {
    // Shebangless sh wrappers (the pinned pnpm's bin): the kernel answers
    // ENOEXEC and shells retry under sh, so the spawn does too. Anything
    // else, including a truly missing command, stays a 127.
    const code = (e as { code?: unknown }).code;
    const enoexec = code === "ENOEXEC" || String(e).includes("ENOEXEC");
    if (!enoexec || !existsSync(cmd))
      return { code: 127, out: "", err: `command not found: ${cmd}` };
    try {
      child = Bun.spawn(["sh", cmd, ...args], {
        cwd: opts.cwd,
        env: opts.env,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
    } catch {
      return { code: 127, out: "", err: `command not found: ${cmd}` };
    }
  }
  const [code, out, err] = await Promise.all([
    child.exited,
    child.stdout === null ? "" : new Response(child.stdout).text(),
    child.stderr === null ? "" : new Response(child.stderr).text(),
  ]);
  return { code, out, err };
}

/** Run a package-manager command the way a lane runs it: through the guard's
 * shim first on the PATH, with the run's dispatch, tool, lane, registry and
 * Socket seams in the environment. A missing shim (the base) fails like any
 * missing command, exit 127, which no oracle case accepts. */
export function guarded(
  registry: Registry,
  dispatch: string,
  project: string,
  prog: string,
  args: string[],
  opts: { env?: Record<string, string | undefined>; markerDir?: string } = {},
): Promise<Guarded> {
  const bin = join(dispatch, "guard", "bin");
  mkdirSync(bin, { recursive: true });
  for (const name of ["npm", "pnpm", "yarn", "bun", "npx"]) {
    const link = join(bin, name);
    if (!existsSync(link)) symlinkSync(SHIM, link);
  }
  const markerDir = opts.markerDir ?? join(dispatch, "markers");
  mkdirSync(markerDir, { recursive: true });
  return runAsync(join(bin, prog), args, {
    cwd: project,
    env: {
      ...(process.env as Record<string, string>),
      PATH: `${bin}:${DEV_BIN}:${process.env.PATH ?? ""}`,
      POSTMASTER_DISPATCH: dispatch,
      POSTMASTER_TOOL: ROOT,
      POSTMASTER_GUARD_LANE: "testlane",
      POSTMASTER_GUARD_REGISTRY: registry.url,
      POSTMASTER_GUARD_SOCKET_API: registry.socketUrl,
      GUARD_MARKER_DIR: markerDir,
      ...opts.env,
    },
  });
}

/** The installed version of a package, or null when it is not installed. */
export function installedVersion(project: string, name: string): string | null {
  const manifest = join(project, "node_modules", ...name.split("/"), "package.json");
  try {
    const parsed = JSON.parse(readFileSync(manifest, "utf8")) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : null;
  } catch {
    return null;
  }
}

/** Refusals name the package and tell the agent to stop and report it, so the
 * runbook's ask flow can route the report. */
export function expectRefused(r: Guarded, pkg: string): void {
  const text = `${r.out}\n${r.err}`;
  if (r.code !== 1) throw new Error(`expected exit 1, saw ${r.code}: ${text.slice(0, 500)}`);
  if (!text.includes(pkg)) throw new Error(`refusal names no ${pkg}: ${text.slice(0, 500)}`);
  if (!/stop and report/iu.test(text))
    throw new Error(`refusal tells nothing to stop and report: ${text.slice(0, 500)}`);
}
