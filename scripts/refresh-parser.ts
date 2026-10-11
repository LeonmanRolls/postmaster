// Refresh the vendored @babel/parser bundle from the npm registry.
//
//   run refresh-parser [<version>] [--waive-age <version>]
//
// With no version, takes the latest 7.x the registry names; with one, takes
// exactly it. A version published under seven days earlier is refused unless
// --waive-age names that same version, the user's waiver for one version.
// Socket's scanner checks the package before anything is downloaded, and a
// flagged or unchecked package is refused. Downloads the tarball, checks its
// registry integrity hash, and writes scripts/lib/vendor/babel-parser.js,
// LICENSE and VERSION. The bundle must stay self-contained (no require
// calls): a bundle that imports anything else fails the refresh instead of
// landing half-vendored.
//
// POSTMASTER_REFRESH_FIXTURE=<dir> reads the packument from
// <dir>/packument.json and the tarball from <dir>/<version>.tgz instead of
// the network, and POSTMASTER_REFRESH_ROOT=<dir> writes the vendor files
// under <dir>/scripts/lib/vendor instead of this checkout. Both are test
// seams; real refreshes leave them unset.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ScanAdvisory, scanner } from "./lib/install-scanner.ts";
import { toolRoot } from "./lib/paths.ts";

const REGISTRY = "https://registry.npmjs.org/@babel/parser";
const PACKAGE = "@babel/parser";
const VERSION_RE = /^([0-9]+)\.([0-9]+)\.([0-9]+)$/u;
const WEEK_MS = 604_800_000;

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

export interface RefreshOptions {
  version: string | undefined;
  waiver: string | undefined;
}

/** The command line: an optional version and an optional per-version age
 * waiver, in any order. Anything else is a usage error. */
export function parseArgs(argv: string[]): RefreshOptions | null {
  let version: string | undefined;
  let waiver: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--waive-age") {
      const next = argv[i + 1];
      if (next === undefined || VERSION_RE.exec(next) === null) return null;
      waiver = next;
      i++;
    } else if (arg.startsWith("--")) {
      return null;
    } else if (VERSION_RE.exec(arg) === null || version !== undefined) {
      return null;
    } else {
      version = arg;
    }
  }
  return { version, waiver };
}

/** Refuse a version published under seven days earlier, unless the waiver
 * names that same version. A version with no readable publish time refuses
 * the same way: what cannot be aged cannot be taken. */
export function assertOldEnough(
  version: string,
  publishedAt: unknown,
  nowMs: number,
  waiver: string | undefined,
): void {
  if (waiver === version) return;
  const publishedMs = typeof publishedAt === "string" ? Date.parse(publishedAt) : Number.NaN;
  if (Number.isNaN(publishedMs)) {
    throw new Error(
      `refresh-parser: no publish time for ${version}, refusing without --waive-age ${version}`,
    );
  }
  if (nowMs - publishedMs < WEEK_MS) {
    throw new Error(
      `refresh-parser: ${version} was published ${publishedAt}, under seven days ago; re-run with --waive-age ${version} to take it`,
    );
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The latest tag from a registry packument. */
export function packumentLatest(doc: unknown): string {
  if (!isRecord(doc)) throw new Error("refresh-parser: the registry document is not an object");
  const tags = doc["dist-tags"];
  if (!isRecord(tags) || typeof tags["latest"] !== "string") {
    throw new Error("refresh-parser: no latest version in the record");
  }
  return tags["latest"];
}

export interface PackumentTake {
  publishedAt: unknown;
  tarball: string;
  integrity: string;
}

/** One version's take from a registry packument: its publish time and where
 * its tarball lives with its hash. */
export function packumentTake(doc: unknown, version: string): PackumentTake {
  if (!isRecord(doc)) throw new Error("refresh-parser: the registry document is not an object");
  const versions = doc["versions"];
  if (!isRecord(versions) || !isRecord(versions[version])) {
    throw new Error(`refresh-parser: no registry record for ${version}`);
  }
  const dist = versions[version]["dist"];
  if (
    !isRecord(dist) ||
    typeof dist["tarball"] !== "string" ||
    typeof dist["integrity"] !== "string"
  ) {
    throw new Error(`refresh-parser: no tarball in the registry record for ${version}`);
  }
  const time = doc["time"];
  return {
    publishedAt: isRecord(time) ? time[version] : undefined,
    tarball: dist["tarball"],
    integrity: dist["integrity"],
  };
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

/** Refuse a package the scanner flags or cannot check, before anything is
 * downloaded. */
async function assertScanned(version: string): Promise<void> {
  let advisories: ScanAdvisory[];
  try {
    advisories = await scanner.scan({ packages: [{ name: PACKAGE, version }] });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`refresh-parser: cannot scan ${PACKAGE}@${version}: ${message}`);
  }
  if (advisories.length > 0) {
    const first = advisories[0]!;
    throw new Error(
      `refresh-parser: refusing ${PACKAGE}@${version}: ${first.description ?? first.package} (${first.url ?? "no advisory url"})`,
    );
  }
}

async function tarballBytes(
  take: Dist,
  version: string,
  fixture: string | undefined,
): Promise<Uint8Array> {
  if (fixture !== undefined) return readFileSync(join(fixture, `${version}.tgz`));
  // The ambient response type exposes text and json only; Bun's runtime
  // response carries the body as bytes too.
  const body = (await fetch(take.tarball)) as unknown as {
    arrayBuffer(): Promise<ArrayBuffer>;
  };
  return new Uint8Array(await body.arrayBuffer());
}

async function refresh(
  version: string,
  take: Dist,
  root: string,
  fixture: string | undefined,
): Promise<void> {
  const bytes = await tarballBytes(take, version, fixture);
  if (!verifyIntegrity(bytes, take.integrity)) {
    throw new Error(`refresh-parser: integrity mismatch for ${take.tarball}`);
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
    const out = process.env["POSTMASTER_REFRESH_ROOT"] ?? root;
    const vendor = join(out, "scripts", "lib", "vendor");
    mkdirSync(vendor, { recursive: true });
    writeFileSync(join(vendor, "babel-parser.js"), bundle);
    writeFileSync(join(vendor, "LICENSE"), license);
    writeFileSync(join(vendor, "VERSION"), `${version}\n${take.integrity}\n`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  console.log(`refresh-parser: vendored @babel/parser ${version}`);
}

async function main(argv: string[], root: string): Promise<number> {
  try {
    const options = parseArgs(argv);
    if (options === null) {
      console.error("usage: run refresh-parser [<version>] [--waive-age <version>]");
      return 1;
    }
    const fixture = process.env["POSTMASTER_REFRESH_FIXTURE"];
    const doc =
      fixture === undefined
        ? await fetchJson(REGISTRY)
        : (JSON.parse(readFileSync(join(fixture, "packument.json"), "utf8")) as unknown);
    const version = resolveVersion(options.version, options.version ?? packumentLatest(doc));
    const take = packumentTake(doc, version);
    assertOldEnough(version, take.publishedAt, Date.now(), options.waiver);
    await assertScanned(version);
    await refresh(version, take, root, fixture);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2), toolRoot(import.meta)));
}
