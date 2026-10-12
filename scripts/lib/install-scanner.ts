// The joined install check: Socket's install scan behind the shape Bun
// loads, with the ticket-approval scan concatenated after it. Installs run
// this module directly (bunfig.toml). A package outside the approved set —
// the worktree's bun.lock plus the run's cached yeses — is a fatal finding,
// refused before anything downloads. POSTMASTER_RECORD_FILE=<path> writes
// the refused set beside the verdict instead of only printing it, so the
// record command can cache an approved library with the packages it brings.
//
// POSTMASTER_SCAN_FIXTURE names the recorded verdict, JSON of the shape
// { error?: string, advisories?: { "<name>@<version>": Advisory[] } }: an
// error throws as if the scanner were unreachable, else the recorded
// advisories answer for each scanned package. Unset everywhere else, where
// the scan goes to Socket (free mode without SOCKET_API_TOKEN).
//
// A scan Socket cannot answer throws when the install brings anything outside
// the lockfile's resolved set, and warns past the pinned set when it brings
// nothing new: a fresh clone reproduces its lockfile with the scanner not
// installed yet, while a new package — cached yes or not — is never taken
// unscanned. Anything else the scan cannot check throws, and Bun cancels
// the install.
import { readFileSync, writeFileSync } from "node:fs";
import { approvedSet, lockfileSet } from "./library-approvals.ts";

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

async function liveScan(packages: ScanPackage[]): Promise<ScanAdvisory[]> {
  let mod: unknown;
  try {
    mod = await import("@socketsecurity/bun-security-scanner");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`install-scanner: cannot load the Socket scanner: ${message}`);
  }
  return (mod as { scanner: SocketScanner }).scanner.scan({ packages });
}

/** Socket's scan alone, without the approval check: the refresh and the
 * facts read the verdict for one package through this, keeping their own
 * approval step beside it. */
export async function socketScanOnly(packages: ScanPackage[]): Promise<ScanAdvisory[]> {
  const fixture = process.env["POSTMASTER_SCAN_FIXTURE"];
  if (fixture !== undefined) {
    console.error(`install-scanner: using the recorded verdict at ${fixture}`);
    return recordedScan(fixture, packages);
  }
  return liveScan(packages);
}

/** The approval refusals: one fatal finding per package outside the worktree's
 * approved set. */
export function approvalScan(root: string, packages: ScanPackage[]): ScanAdvisory[] {
  const approved = approvedSet(root);
  const found: ScanAdvisory[] = [];
  for (const pkg of packages) {
    if (approved.has(`${pkg.name}@${pkg.version}`)) continue;
    found.push({
      level: "fatal",
      package: pkg.name,
      url: null,
      description:
        `refusing ${pkg.name}@${pkg.version}: the ticket lists no approval for it; ` +
        `stop this line of work and report it to the coachman`,
    });
  }
  return found;
}

export interface RecordedRefusal {
  refused: string[];
  socketFlagged: boolean;
}

export const scanner: Scanner = {
  version: "1",
  async scan({ packages }) {
    const root = process.cwd();
    const refusals = approvalScan(root, packages);
    let advisories: ScanAdvisory[];
    try {
      advisories = await socketScanOnly(packages);
    } catch (error) {
      if (refusals.length > 0) throw error;
      const locked = lockfileSet(root);
      if (packages.some((pkg) => !locked.has(`${pkg.name}@${pkg.version}`))) throw error;
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `install-scanner: cannot scan, allowing the pinned set without a scan: ${message}`,
      );
      return refusals;
    }
    const record = process.env["POSTMASTER_RECORD_FILE"];
    if (record !== undefined) {
      const refused = refusals.map((advisory) => {
        const description = advisory.description ?? "";
        return description.slice("refusing ".length).split(":")[0]!;
      });
      const report: RecordedRefusal = {
        refused,
        socketFlagged: advisories.length > 0,
      };
      writeFileSync(record, JSON.stringify(report));
    }
    return [...advisories, ...refusals];
  },
};
