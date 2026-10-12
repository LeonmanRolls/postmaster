// The ticket-approval half of the joined install check (#424): the approval
// identity one user yes covers, the approved set an install scans against,
// and the ticket's ## Libraries list. The scanner, the refresh and the
// record command all read the same set: every name@version the worktree's
// bun.lock resolves, plus every name@version the run's user said yes to,
// cached at .postmaster/library-approvals.json. Anything else is refused.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { agentsIndex, fenceMap, normalizeTicket } from "./ticket-sections.ts";

/** Where a worktree keeps the name@versions its run's user said yes to.
 * Gitignored with the rest of .postmaster/: the run's authority is the
 * log-action record, and this file is the cache the install reads. */
export const APPROVALS_FILE = join(".postmaster", "library-approvals.json");

export const LIBRARY_IDENTITY_RE = /^library:[0-9a-f]{16}$/u;

/** The approval one user yes covers: the name and the new version only, so
 * the identity survives rebases that move what the version replaces. */
export function libraryIdentity(name: string, version: string): string {
  const hex = createHash("sha256").update(`${name}@${version}`).digest("hex").slice(0, 16);
  return `library:${hex}`;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export interface ParsedLockfile {
  /** Every workspace dependency block merged, name to spec. */
  specs: Map<string, string>;
  /** Every resolved package, name to its versions. */
  resolved: Map<string, Set<string>>;
  /** Every resolved package, name to the names it depends on. */
  edges: Map<string, Set<string>>;
}

const WORKSPACE_BLOCKS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];
const EDGE_BLOCKS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

/** Split a lockfile entry head, name@version, at its last @. */
export function splitNameVersion(head: string): [string, string] | null {
  const at = head.lastIndexOf("@");
  if (at <= 0 || at === head.length - 1) return null;
  return [head.slice(0, at), head.slice(at + 1)];
}

/** The lockfile as the approval check reads it: a JSONC document, so plain
 * JSON.parse cannot read it. Anything out of shape throws: an unreadable
 * lockfile refuses the install rather than waving it through. */
export function parseLockfile(text: string): ParsedLockfile {
  let doc: unknown;
  try {
    doc = Bun.JSONC.parse(text) as unknown;
  } catch {
    throw new Error("library-approvals: bun.lock does not parse");
  }
  if (!isRecord(doc)) throw new Error("library-approvals: bun.lock is not an object");
  const specs = new Map<string, string>();
  const workspaces = doc["workspaces"];
  if (isRecord(workspaces)) {
    for (const key of Object.keys(workspaces)) {
      const ws = workspaces[key];
      if (!isRecord(ws)) continue;
      for (const block of WORKSPACE_BLOCKS) {
        const deps = ws[block];
        if (!isRecord(deps)) continue;
        for (const [name, spec] of Object.entries(deps)) {
          if (typeof spec === "string" && !specs.has(name)) specs.set(name, spec);
        }
      }
    }
  }
  const resolved = new Map<string, Set<string>>();
  const edges = new Map<string, Set<string>>();
  const packages = doc["packages"];
  if (isRecord(packages)) {
    for (const [key, entry] of Object.entries(packages)) {
      if (!Array.isArray(entry) || typeof entry[0] !== "string") continue;
      const split = splitNameVersion(entry[0]);
      const name = split === null ? key : split[0];
      const version = split === null ? null : split[1];
      if (version !== null) {
        const versions = resolved.get(name) ?? new Set<string>();
        versions.add(version);
        resolved.set(name, versions);
      }
      const meta = entry[2];
      if (isRecord(meta)) {
        const deps = edges.get(name) ?? new Set<string>();
        for (const block of EDGE_BLOCKS) {
          const table = meta[block];
          if (isRecord(table)) {
            for (const dep of Object.keys(table)) deps.add(dep);
          }
        }
        if (deps.size > 0) edges.set(name, deps);
      }
    }
  }
  return { specs, resolved, edges };
}

/** The cached yeses: the file's keys. A missing file caches nothing; a file
 * that does not parse throws, so corruption refuses rather than empties. */
export function readApprovalCache(root: string): Set<string> {
  const path = join(root, APPROVALS_FILE);
  if (!existsSync(path)) return new Set();
  let doc: unknown;
  try {
    doc = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    throw new Error(`library-approvals: ${APPROVALS_FILE} does not parse`);
  }
  if (!isRecord(doc) || !isRecord(doc["approvals"])) {
    throw new Error(`library-approvals: ${APPROVALS_FILE} holds no approvals table`);
  }
  const out = new Set<string>();
  for (const key of Object.keys(doc["approvals"])) {
    if (key !== "" && splitNameVersion(key) !== null) out.add(key);
  }
  return out;
}

/** Every name@version the worktree's bun.lock resolves. A missing
 * lockfile resolves nothing; one that does not parse throws. */
export function lockfileSet(root: string): Set<string> {
  const out = new Set<string>();
  const lockPath = join(root, "bun.lock");
  if (!existsSync(lockPath)) return out;
  const parsed = parseLockfile(readFileSync(lockPath, "utf8"));
  for (const [name, versions] of parsed.resolved) {
    for (const version of versions) out.add(`${name}@${version}`);
  }
  return out;
}

/** Every name@version an install in root may take: the lockfile's resolved
 * set plus the run's cached yeses. */
export function approvedSet(root: string): Set<string> {
  const out = lockfileSet(root);
  for (const key of readApprovalCache(root)) out.add(key);
  return out;
}

export function isApproved(root: string, name: string, version: string): boolean {
  return approvedSet(root).has(`${name}@${version}`);
}

export interface ListedLibrary {
  name: string;
  version: string;
  vetting: string;
}

const LIBRARIES_RE = /^##[ \t]+libraries[ \t]*$/iu;
const HEADING2_RE = /^##[ \t]+(.*?)[ \t]*$/u;
const EXACT = /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$/u;

/** An approval covers one exact version, never a range. */
export function isExactVersion(version: string): boolean {
  return EXACT.test(version);
}
const BULLET_RE = /^[ \t]*[-*][ \t]+([^ \t]+)[ \t]+([^ \t]+)(?:[ \t]+(.*))?$/u;

/** The ticket's ## Libraries list: one line per library with its name, its
 * exact version and the clerk's vetting, in the plain part only. A line out
 * of shape is not a listing: the library stays unlisted and the ask, not a
 * guess, settles it. */
export function readTicketLibraries(ticketText: string): ListedLibrary[] {
  const lines = normalizeTicket(ticketText).split("\n");
  const agentsAt = agentsIndex(lines);
  const plain = agentsAt < 0 ? lines : lines.slice(0, agentsAt);
  const fenced = fenceMap(plain, 0, plain.length);
  let start = -1;
  for (let i = 0; i < plain.length; i++) {
    if (fenced[i]) continue;
    if (LIBRARIES_RE.test(plain[i]!)) {
      start = i + 1;
      break;
    }
  }
  if (start < 0) return [];
  let end = plain.length;
  for (let i = start; i < plain.length; i++) {
    if (fenced[i]) continue;
    if (HEADING2_RE.test(plain[i]!)) {
      end = i;
      break;
    }
  }
  const out: ListedLibrary[] = [];
  for (let i = start; i < end; i++) {
    if (fenced[i]) continue;
    const match = BULLET_RE.exec(plain[i]!);
    if (match === null || match[1] === undefined || match[2] === undefined) continue;
    const name = match[1];
    const version = match[2];
    const vetting = match[3] ?? "";
    if (!EXACT.test(version)) continue;
    out.push({ name, version, vetting: vetting.trim() });
  }
  return out;
}
