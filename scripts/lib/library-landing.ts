// The landing's library check: every library a branch adds or changes,
// against the user's recorded word. Direct changes read from package.json's
// dependency blocks; resolved ones, transitives included, from bun.lock;
// the copied-in bundle from its VERSION. Each entry carries the library's
// facts and clears only with the user's approval of that name@version, so
// the landing checks again what the install already refused.
import { join } from "node:path";
import { libraryIdentity, parseLockfile, type ParsedLockfile } from "./library-approvals.ts";
import { readFacts, type LibraryFacts } from "./library-facts.ts";
import { recordedScan, socketScanOnly } from "./install-scanner.ts";
import { blobAt, commitOfRef, mergeBase, readApprovals } from "./switch-offs.ts";

export type LibraryKind = "added" | "changed" | "vendored" | "transitive";

export interface LibraryEntry {
  name: string;
  kind: LibraryKind;
  old: string | null;
  next: string;
  version: string;
  brings: string[];
  identity: string;
  facts: LibraryFacts;
  approved: boolean;
}

export type LibraryStatus = "clear" | "held" | "refused";

export interface LibraryReport {
  status: LibraryStatus;
  entries: LibraryEntry[];
  output: string;
}

const DEP_BLOCKS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
const VENDORED = [{ path: "scripts/lib/vendor/VERSION", name: "@babel/parser" }];

/** Every dependency block merged, name to spec. A file that does not parse
 * fails loud: the listing never reports clear over unreadable input. */
export function manifestSpecs(text: string | null): Map<string, string> {
  const out = new Map<string, string>();
  if (text === null) return out;
  let doc: unknown;
  try {
    doc = JSON.parse(text) as unknown;
  } catch {
    throw new Error("library-landing: package.json does not parse");
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    throw new Error("library-landing: package.json is not an object");
  }
  const manifest = doc as Record<string, unknown>;
  for (const block of DEP_BLOCKS) {
    const deps = manifest[block];
    if (typeof deps !== "object" || deps === null || Array.isArray(deps)) continue;
    for (const [name, spec] of Object.entries(deps as Record<string, unknown>)) {
      if (typeof spec === "string" && !out.has(name)) out.set(name, spec);
    }
  }
  return out;
}

function newVersions(base: Set<string> | undefined, head: Set<string> | undefined): string[] {
  const before = base ?? new Set<string>();
  return [...(head ?? new Set<string>())].filter((v) => !before.has(v)).sort();
}

function sameSet(a: Set<string> | undefined, b: Set<string> | undefined): boolean {
  const left = a ?? new Set<string>();
  const right = b ?? new Set<string>();
  if (left.size !== right.size) return false;
  for (const v of left) if (!right.has(v)) return false;
  return true;
}

export interface DirectChange {
  name: string;
  kind: "added" | "changed";
  old: string | null;
  next: string;
  version: string;
}

/** The direct changes between two manifests: added, changed, or resolved to
 * new versions under an unchanged spec. Only a pure removal lists nothing:
 * any spec change lists, even one that resolves identically, since the
 * lockfile may be stale. One entry per name, covering its first new resolved
 * version; the rest land through extraDirectVersions. The version is what
 * lands: the resolved one where the lockfile names it, else the spec
 * itself. */
export function diffDirect(
  baseSpecs: Map<string, string>,
  headSpecs: Map<string, string>,
  baseResolved: Map<string, Set<string>>,
  headResolved: Map<string, Set<string>>,
): DirectChange[] {
  const out: DirectChange[] = [];
  const names = [...new Set([...baseSpecs.keys(), ...headSpecs.keys()])].sort();
  for (const name of names) {
    const base = baseSpecs.get(name);
    const head = headSpecs.get(name);
    if (head === undefined) continue;
    if (base === head && sameSet(baseResolved.get(name), headResolved.get(name))) continue;
    const headVersions = headResolved.get(name) ?? new Set<string>();
    const fresh = newVersions(baseResolved.get(name), headResolved.get(name));
    if (base === head && headVersions.size > 0 && fresh.length === 0) continue;
    const version =
      fresh.length > 0 ? fresh[0]! : headVersions.size > 0 ? [...headVersions].sort()[0]! : head;
    if (base === undefined) {
      out.push({ name, kind: "added", old: null, next: version, version });
    } else if (base !== head) {
      out.push({ name, kind: "changed", old: base, next: version, version });
    } else {
      const oldResolved = [...(baseResolved.get(name) ?? new Set<string>())].sort().join(", ");
      const newResolved = [...headVersions].sort().join(", ");
      out.push({
        name,
        kind: "changed",
        old: oldResolved === "" ? base : oldResolved,
        next: newResolved === "" ? head : newResolved,
        version,
      });
    }
  }
  return out;
}

/** New versions under direct names the direct entries do not cover: each
 * lands on its own entry, so one approval never clears two versions. */
export function extraDirectVersions(
  baseResolved: Map<string, Set<string>>,
  headResolved: Map<string, Set<string>>,
  direct: DirectChange[],
): Array<{ name: string; version: string }> {
  const covered = new Map<string, string>();
  for (const change of direct) covered.set(change.name, change.version);
  const out: Array<{ name: string; version: string }> = [];
  for (const name of [...headResolved.keys()].sort()) {
    if (!covered.has(name)) continue;
    const base = baseResolved.get(name) ?? new Set<string>();
    for (const version of [...(headResolved.get(name) ?? new Set<string>())].sort()) {
      if (base.has(version) || covered.get(name) === version) continue;
      out.push({ name, version });
    }
  }
  return out;
}

/** The names reachable from roots through the lockfile's edges. */
export function reachable(edges: Map<string, Set<string>>, roots: string[]): Set<string> {
  const seen = new Set<string>(roots);
  const queue = [...roots];
  while (queue.length > 0) {
    const name = queue.pop()!;
    for (const dep of edges.get(name) ?? []) {
      if (!seen.has(dep)) {
        seen.add(dep);
        queue.push(dep);
      }
    }
  }
  return seen;
}

export interface TransitiveTake {
  covered: Map<string, string[]>;
  own: Array<{ name: string; version: string }>;
}

/** The resolved name@versions the head adds outside the direct names: each
 * lands either under the new direct entry that brings it, or on its own
 * entry when no new entry does. Approving a library approves the packages
 * it brings; a drift under unchanged parents needs its own word. */
export function diffTransitives(
  baseResolved: Map<string, Set<string>>,
  headResolved: Map<string, Set<string>>,
  headEdges: Map<string, Set<string>>,
  directNames: Set<string>,
  newDirect: string[],
): TransitiveTake {
  const covered = new Map<string, string[]>();
  const own: Array<{ name: string; version: string }> = [];
  const reach = reachable(headEdges, newDirect);
  const names = [...headResolved.keys()].sort();
  for (const name of names) {
    if (directNames.has(name)) continue;
    const base = baseResolved.get(name) ?? new Set<string>();
    const versions = [...(headResolved.get(name) ?? new Set<string>())].sort();
    for (const version of versions) {
      if (base.has(version)) continue;
      const key = `${name}@${version}`;
      if (reach.has(name)) {
        const parent = [...newDirect].sort().find((root) => reachable(headEdges, [root]).has(name));
        if (parent !== undefined) {
          const list = covered.get(parent) ?? [];
          list.push(key);
          covered.set(parent, [...list].sort());
          continue;
        }
      }
      own.push({ name, version });
    }
  }
  own.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { covered, own };
}

function versionLine(text: string | null): string | null {
  if (text === null) return null;
  const first = text.split("\n")[0] ?? "";
  return first === "" ? null : first;
}

/** One entry's line, carrying its facts. */
export function renderLibraries(entries: LibraryEntry[]): string {
  const lines: string[] = [];
  const ordered = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of ordered) {
    lines.push(
      `- library ${entry.name} ${entry.kind} ${entry.old ?? "none"} -> ${entry.next} ` +
        `published ${entry.facts.published ?? "unknown"} source ${entry.facts.source ?? "unknown"} ` +
        `verdict ${entry.facts.verdict} (id ${entry.identity})${entry.approved ? " (approved)" : ""}`,
    );
    if (entry.brings.length > 0) lines.push(`  brings ${entry.brings.join(", ")}`);
    if (entry.facts.note !== null) lines.push(`  note ${entry.facts.note}`);
  }
  return `## Libraries\n\n${lines.length > 0 ? lines.join("\n") : "none"}\n`.replace(
    /<!--/gu,
    "&lt;!--",
  );
}

export async function inspectLibraries(options: {
  repo: string;
  defaultRef: string;
  ticketRef: string;
  dispatch?: string;
}): Promise<LibraryReport> {
  const defaultHead = commitOfRef(options.repo, options.defaultRef);
  const ticketHead = commitOfRef(options.repo, options.ticketRef);
  const base = mergeBase(options.repo, defaultHead, ticketHead);
  const baseSpecs = manifestSpecs(blobAt(options.repo, base, "package.json"));
  const headSpecs = manifestSpecs(blobAt(options.repo, ticketHead, "package.json"));
  const baseLock = blobAt(options.repo, base, "bun.lock");
  const headLock = blobAt(options.repo, ticketHead, "bun.lock");
  const baseParsed: ParsedLockfile =
    baseLock === null
      ? { specs: new Map(), resolved: new Map(), edges: new Map() }
      : parseLockfile(baseLock);
  const headParsed: ParsedLockfile =
    headLock === null
      ? { specs: new Map(), resolved: new Map(), edges: new Map() }
      : parseLockfile(headLock);
  const direct = diffDirect(baseSpecs, headSpecs, baseParsed.resolved, headParsed.resolved);
  const directNames = new Set(headSpecs.keys());
  const takes = diffTransitives(
    baseParsed.resolved,
    headParsed.resolved,
    headParsed.edges,
    directNames,
    direct.map((change) => change.name),
  );
  const fixtureDir = process.env["POSTMASTER_FACTS_FIXTURE"];
  const scan =
    fixtureDir === undefined
      ? socketScanOnly
      : (packages: { name: string; version: string }[]) =>
          Promise.resolve(recordedScan(join(fixtureDir, "verdict.json"), packages));
  const pending: Array<Omit<LibraryEntry, "facts" | "approved">> = [];
  for (const change of direct) {
    pending.push({
      name: change.name,
      kind: change.kind,
      old: change.old,
      next: change.next,
      version: change.version,
      brings: takes.covered.get(change.name) ?? [],
      identity: libraryIdentity(change.name, change.version),
    });
  }
  for (const item of takes.own) {
    pending.push({
      name: item.name,
      kind: "transitive",
      old: null,
      next: item.version,
      version: item.version,
      brings: [],
      identity: libraryIdentity(item.name, item.version),
    });
  }
  for (const item of extraDirectVersions(baseParsed.resolved, headParsed.resolved, direct)) {
    pending.push({
      name: item.name,
      kind: "added",
      old: null,
      next: item.version,
      version: item.version,
      brings: [],
      identity: libraryIdentity(item.name, item.version),
    });
  }
  for (const vendor of VENDORED) {
    const old = versionLine(blobAt(options.repo, base, vendor.path));
    const next = versionLine(blobAt(options.repo, ticketHead, vendor.path));
    if (next === null || old === next) continue;
    pending.push({
      name: vendor.name,
      kind: "vendored",
      old,
      next,
      version: next,
      brings: [],
      identity: libraryIdentity(vendor.name, next),
    });
  }
  const warnings: string[] = [];
  const logged =
    options.dispatch === undefined
      ? new Map<string, "approved" | "refused">()
      : readApprovals(options.dispatch, "library", (message) => warnings.push(message));
  for (const message of warnings) console.error(`libraries: ${message}`);
  const entries: LibraryEntry[] = [];
  for (const item of pending) {
    const facts = await readFacts(item.name, item.version, { fixtureDir, scan });
    entries.push({ ...item, facts, approved: logged.get(item.identity) === "approved" });
  }
  const open = entries.filter((entry) => logged.get(entry.identity) !== "approved");
  const refused = open.some((entry) => logged.get(entry.identity) === "refused");
  const status: LibraryStatus = refused ? "refused" : open.length > 0 ? "held" : "clear";
  return { status, entries, output: renderLibraries(entries) };
}
