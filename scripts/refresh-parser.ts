// Refresh the vendored @babel/parser bundle from the npm registry.
//
//   run refresh-parser [<version>]
//
// With no version, takes the latest 7.x the registry names; with one, takes
// exactly it. Downloads the tarball, checks its registry integrity hash,
// and writes scripts/lib/vendor/babel-parser.js, LICENSE and VERSION. The
// bundle must stay self-contained (no require calls): a bundle that imports
// anything else fails the refresh instead of landing half-vendored.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toolRoot } from "./lib/paths.ts";

const REGISTRY = "https://registry.npmjs.org/@babel/parser";
const VERSION_RE = /^([0-9]+)\.([0-9]+)\.([0-9]+)$/u;

/** The version to vendor: the argument when given, else the registry's
 * latest. A major other than 7 refuses: a new Babel major needs a look
 * before it lands in every pinned checkout. */
export function resolveVersion(arg: string | undefined, latest: string): string {
  const version = arg ?? latest;
  const match = VERSION_RE.exec(version);
  if (match === null || match[1] !== "7") {
    throw new Error(`refresh-parser: refusing version ${JSON.stringify(version)}, want 7.x.y`);
  }
  return version;
}

/** Whether the bytes hash to the registry's integrity string. */
export function verifyIntegrity(bytes: Uint8Array, integrity: string): boolean {
  const dash = integrity.indexOf("-");
  if (dash < 0) return false;
  const algo = integrity.slice(0, dash);
  if (algo !== "sha512" && algo !== "sha384" && algo !== "sha256") return false;
  const want = integrity.slice(dash + 1);
  const got = createHash(algo).update(bytes).digest("base64");
  return got === want;
}

/** Refuse a bundle that is not self-contained: every require call is a file
 * the vendor step did not carry. */
export function assertSelfContained(source: string): void {
  if (source.includes("require(")) {
    throw new Error("refresh-parser: the bundle calls require, refusing to vendor it");
  }
}

interface Dist {
  tarball: string;
  integrity: string;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`refresh-parser: ${url} answered ${response.status}`);
  return (await response.json()) as unknown;
}

async function refresh(version: string, root: string): Promise<void> {
  const doc = (await fetchJson(`${REGISTRY}/${version}`)) as { dist?: Partial<Dist> };
  const tarball = doc.dist?.tarball;
  const integrity = doc.dist?.integrity;
  if (typeof tarball !== "string" || typeof integrity !== "string") {
    throw new Error(`refresh-parser: no tarball in the registry record for ${version}`);
  }
  // The ambient response type exposes text and json only; Bun's runtime
  // response carries the body as bytes too.
  const body = (await fetch(tarball)) as unknown as { arrayBuffer(): Promise<ArrayBuffer> };
  const bytes = new Uint8Array(await body.arrayBuffer());
  if (!verifyIntegrity(bytes, integrity)) {
    throw new Error(`refresh-parser: integrity mismatch for ${tarball}`);
  }
  const scratch = mkdtempSync(join(tmpdir(), "postmaster-parser-"));
  try {
    const tgz = join(scratch, "parser.tgz");
    writeFileSync(tgz, bytes);
    const untar = spawnSync("tar", ["xzf", tgz, "-C", scratch]);
    if (untar.status !== 0) throw new Error("refresh-parser: tar could not unpack the bundle");
    const bundle = readFileSync(join(scratch, "package", "lib", "index.js"), "utf8");
    assertSelfContained(bundle);
    const license = readFileSync(join(scratch, "package", "LICENSE"), "utf8");
    const vendor = join(root, "scripts", "lib", "vendor");
    writeFileSync(join(vendor, "babel-parser.js"), bundle);
    writeFileSync(join(vendor, "LICENSE"), license);
    writeFileSync(join(vendor, "VERSION"), `${version}\n${integrity}\n`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  console.log(`refresh-parser: vendored @babel/parser ${version}`);
}

async function main(argv: string[], root: string): Promise<number> {
  try {
    const arg = argv[0];
    if (arg !== undefined && VERSION_RE.exec(arg) === null) {
      console.error("usage: run refresh-parser [<version>]");
      return 1;
    }
    let version: string;
    if (arg === undefined) {
      const latest = (await fetchJson(`${REGISTRY}/latest`)) as { version?: unknown };
      if (typeof latest.version !== "string") throw new Error("no latest version in the record");
      version = resolveVersion(undefined, latest.version);
    } else {
      version = resolveVersion(arg, arg);
    }
    await refresh(version, root);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2), toolRoot(import.meta)));
}
