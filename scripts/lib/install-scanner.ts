// Socket's install scan behind the shape Bun loads, composed with a recorded
// verdict for tests. Installs run Socket's module directly (bunfig.toml),
// which Bun bootstraps on a fresh clone where a wrapper importing a package
// that is not installed yet cannot load; refresh-parser scans through this
// module, so it can prove the scan against a fixture, and #424 extends this
// module into the joined install check.
//
// POSTMASTER_SCAN_FIXTURE names the recorded verdict, JSON of the shape
// { error?: string, advisories?: { "<name>@<version>": Advisory[] } }: an
// error throws as if the scanner were unreachable, else the recorded
// advisories answer for each scanned package. Unset everywhere else, where
// the scan goes to Socket (free mode without SOCKET_API_TOKEN). Anything
// the scan cannot check throws, and Bun cancels the install.
import { readFileSync } from "node:fs";

export interface ScanPackage {
  name: string;
  version: string;
}

export interface ScanAdvisory {
  level: "fatal" | "warn";
  package: string;
  url: string | null;
  description: string | null;
}

export interface Scanner {
  version: string;
  scan(input: { packages: ScanPackage[] }): Promise<ScanAdvisory[]>;
}

interface SocketScanner {
  scan(input: { packages: ScanPackage[] }): Promise<ScanAdvisory[]>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isAdvisory = (value: unknown): value is ScanAdvisory => {
  if (!isRecord(value)) return false;
  return (
    (value["level"] === "fatal" || value["level"] === "warn") &&
    typeof value["package"] === "string" &&
    (typeof value["url"] === "string" || value["url"] === null) &&
    (typeof value["description"] === "string" || value["description"] === null)
  );
};

/** Answer the scan from a recorded verdict. A verdict the scan cannot read
 * throws, as an unreachable scanner does: a package that cannot be checked
 * is not taken. */
export function recordedScan(path: string, packages: ScanPackage[]): ScanAdvisory[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    throw new Error(`install-scanner: cannot read the recorded verdict at ${path}`);
  }
  if (!isRecord(parsed)) {
    throw new Error(`install-scanner: the recorded verdict at ${path} is not an object`);
  }
  if (parsed["error"] !== undefined) {
    if (typeof parsed["error"] !== "string" || parsed["error"] === "") {
      throw new Error(`install-scanner: the recorded verdict at ${path} has no error text`);
    }
    throw new Error(`install-scanner: ${parsed["error"]}`);
  }
  const table = parsed["advisories"] ?? {};
  if (!isRecord(table)) {
    throw new Error(`install-scanner: the recorded verdict at ${path} has no advisory table`);
  }
  const found: ScanAdvisory[] = [];
  for (const pkg of packages) {
    const key = `${pkg.name}@${pkg.version}`;
    if (table[key] === undefined) continue;
    const list = table[key];
    if (!Array.isArray(list) || !list.every(isAdvisory)) {
      throw new Error(`install-scanner: the recorded verdict at ${path} is malformed for ${key}`);
    }
    found.push(...list);
  }
  return found;
}

async function socketScan(packages: ScanPackage[]): Promise<ScanAdvisory[]> {
  const mod = (await import("@socketsecurity/bun-security-scanner")) as unknown as {
    scanner: SocketScanner;
  };
  return mod.scanner.scan({ packages });
}

export const scanner: Scanner = {
  version: "1",
  async scan({ packages }) {
    const fixture = process.env["POSTMASTER_SCAN_FIXTURE"];
    if (fixture !== undefined) {
      console.error(`install-scanner: using the recorded verdict at ${fixture}`);
      return recordedScan(fixture, packages);
    }
    // #424 adds the ticket-approval scan here, concatenated after Socket's.
    return socketScan(packages);
  },
};
