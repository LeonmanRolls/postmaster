// Knowledge sources a person keeps on this machine, such as a company wiki, a standards folder or
// a handbook, registered once by name in the machine config:
//
//   [sources.acme-wiki]
//   path = "~/Code/acme/wiki"                # where the clone is on this machine
//   about = "Acme's coding standards and review specs"
//   applies_to = ["~/Code/acme/*"]           # the repos it is proposed for
//
// A project's notes name a source and a path in it, `source:acme-wiki/standards/ts.md`, and never
// a machine path, so the notes can be shared. The functions here read the table and resolve a
// reference; they touch no file.
import { posix } from "node:path";

export interface Source {
  readonly name: string;
  readonly path: string;
  readonly about: string;
  readonly appliesTo: readonly string[];
}

export interface ReadSources {
  readonly sources: readonly Source[];
  readonly problems: readonly string[];
}

const isTable = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Read the [sources] table. `expand` turns a leading ~ into the home folder. */
export function readSources(raw: unknown, expand: (path: string) => string): ReadSources {
  if (raw === undefined) return { sources: [], problems: [] };
  if (!isTable(raw)) return { sources: [], problems: ["sources must be a table of named sources"] };
  const sources: Source[] = [];
  const problems: string[] = [];
  for (const [name, entry] of Object.entries(raw)) {
    if (!isTable(entry)) {
      problems.push(`sources.${name} must be a table with a path`);
      continue;
    }
    const { path, about, applies_to: appliesTo } = entry;
    if (typeof path !== "string" || path === "") {
      problems.push(`sources.${name}.path must be a folder on this machine`);
      continue;
    }
    if (about !== undefined && typeof about !== "string") {
      problems.push(`sources.${name}.about must be text`);
      continue;
    }
    if (
      appliesTo !== undefined &&
      !(Array.isArray(appliesTo) && appliesTo.every((p) => typeof p === "string"))
    ) {
      problems.push(`sources.${name}.applies_to must be a list of path patterns`);
      continue;
    }
    sources.push({
      name,
      path: expand(path),
      about: typeof about === "string" ? about : "",
      appliesTo: (appliesTo as string[] | undefined) ?? [],
    });
  }
  return { sources, problems };
}

/** The path of a file in a source, or null when the reference would leave the source's folder. */
export function sourceFile(source: Source, relative: string): string | null {
  const clean = posix.normalize(relative);
  if (clean.startsWith("../") || clean === ".." || posix.isAbsolute(clean)) return null;
  return posix.join(source.path, clean);
}

/** Whether a source is proposed for a repo: its applies_to patterns, with ~ expanded, match the
 * repo's folder. A source with no patterns is proposed for no repo, only named by one. */
export function appliesTo(
  source: Source,
  repo: string,
  expand: (path: string) => string,
  matches: (pattern: string, path: string) => boolean,
): boolean {
  return source.appliesTo.some((p) => matches(expand(p), repo));
}
