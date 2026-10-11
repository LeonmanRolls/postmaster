// One command's reading of a library's facts, for the clerk, the ask and
// the landing alike: its name, version, publish date, source repository
// and Socket's verdict. Best-effort throughout: what cannot be read is
// unknown, and the entry still needs the user's yes either way.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ScanAdvisory, ScanPackage } from "./install-scanner.ts";

export const NPM_REGISTRY = "https://registry.npmjs.org";

export interface LibraryFacts {
  name: string;
  version: string;
  published: string | null;
  source: string | null;
  verdict: string;
  note: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** One version's publish time and source from a registry packument. */
export function packumentFacts(
  doc: unknown,
  version: string,
): { published: string | null; source: string | null } {
  if (!isRecord(doc)) return { published: null, source: null };
  const time = doc["time"];
  const published =
    isRecord(time) && typeof time[version] === "string" ? (time[version] as string) : null;
  const versions = doc["versions"];
  const entry = isRecord(versions) ? versions[version] : undefined;
  const repository = isRecord(entry) ? entry["repository"] : undefined;
  const source =
    typeof repository === "string"
      ? repository
      : isRecord(repository) && typeof repository["url"] === "string"
        ? (repository["url"] as string)
        : null;
  return { published, source };
}

/** Socket's verdict in one line: clean, the first flag, or unchecked with
 * the reason the scan did not answer. */
export function verdictText(advisories: ScanAdvisory[] | { unreachable: string }): string {
  if (!Array.isArray(advisories)) return `unchecked (${advisories.unreachable})`;
  if (advisories.length === 0) return "clean";
  const first = advisories[0]!;
  const what = first.description ?? first.package;
  return `flagged: ${what} (${first.url ?? "no advisory url"})`;
}

export type ScanFn = (packages: ScanPackage[]) => Promise<ScanAdvisory[]>;

export interface FactsOptions {
  registry?: string;
  fixtureDir?: string;
  scan: ScanFn;
}

/** The facts for one name@version. Under fixtureDir the packument comes
 * from <encodeURIComponent(name)>@<version>.json beside the verdict file,
 * and the scan answers from the caller's recorded verdict; otherwise both
 * go to the network. */
export async function readFacts(
  name: string,
  version: string,
  options: FactsOptions,
): Promise<LibraryFacts> {
  const registry = options.registry ?? NPM_REGISTRY;
  let doc: unknown = null;
  let note: string | null = null;
  if (options.fixtureDir !== undefined) {
    const path = join(options.fixtureDir, `${encodeURIComponent(name)}@${version}.json`);
    if (!existsSync(path)) {
      note = `no registry record for ${name}`;
    } else {
      try {
        doc = JSON.parse(readFileSync(path, "utf8")) as unknown;
      } catch {
        throw new Error(`library-facts: the recorded packument at ${path} does not parse`);
      }
    }
  } else {
    try {
      const response = await fetch(`${registry}/${name}`);
      if (response.status === 404) {
        note = `no registry record for ${name}`;
      } else if (!response.ok) {
        note = `cannot reach the registry: ${registry} answered ${response.status}`;
      } else {
        doc = (await response.json()) as unknown;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      note = `cannot reach the registry: ${message}`;
    }
  }
  const { published, source } = packumentFacts(doc, version);
  let verdict: string;
  try {
    verdict = verdictText(await options.scan([{ name, version }]));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    verdict = verdictText({ unreachable: message });
  }
  return { name, version, published, source, verdict, note };
}
