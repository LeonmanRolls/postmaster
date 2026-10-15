// The libraries a project uses, read from its manifests and its lockfile: the package.json of the
// root and of every workspace folder, the pnpm catalog their specs may point at, and the version
// the lockfile resolved for each. Used by scripts/api-index.ts --all, which indexes each of them, so
// that a ticket's clerk knows what the whole stack offers and not only the libraries it thinks of.
//
// A library is a dependency that is not one of the workspace's own packages (those are project
// code, which scripts/code-index.ts reads). An `@types` package is not a library of its own: it
// types the library it is named for.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expandPattern } from "./glob-paths.ts";
import { type LockedDependency, lockedDirect } from "./package-types.ts";

export interface Declared {
  readonly name: string;
  /** The dependency lists that declare it: dependencies, peerDependencies, and so on. */
  readonly kinds: readonly string[];
  /** A range for the library from a manifest or the pnpm catalog, when a usable one exists. */
  readonly spec?: string;
  /** The version the lockfile resolved for the project, when it has one. */
  readonly version?: string;
}

export interface Stack {
  readonly libraries: readonly Declared[];
  /** For a library, the `@types` package the project declares for it: `ws` to `@types/ws`. */
  readonly typesFor: ReadonlyMap<string, Declared>;
  /** The names of the workspace's own packages: project code, not libraries. */
  readonly internal: ReadonlySet<string>;
}

const unquote = (s: string): string => s.trim().replace(/^(['"])(.*)\1$/u, "$2");

function readJson(path: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return parsed !== null && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function readText(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

/** The indented lines under a top-level key of a YAML file, comments and blank lines left out. */
function yamlSection(text: string, key: string): string[] {
  const out: string[] = [];
  let inside = false;
  for (const line of text.split("\n")) {
    if (/^[^ #\t]/u.test(line)) {
      inside = line.replace(/[ \t]+#.*$/u, "").trimEnd() === `${key}:`;
      continue;
    }
    if (inside && line.trim() !== "" && !line.trim().startsWith("#")) out.push(line);
  }
  return out;
}

/**
 * The folders a workspace names: the `packages` list of pnpm-workspace.yaml and the `workspaces` of
 * package.json, the ones it takes in and the ones it leaves out (a pattern that starts with `!`).
 */
function workspaceGlobs(repo: string): { include: string[]; exclude: string[] } {
  const globs: string[] = [];
  for (const line of yamlSection(readText(join(repo, "pnpm-workspace.yaml")), "packages")) {
    const m = /^[ \t]*-[ \t]+(.+?)[ \t]*$/u.exec(line);
    if (m) globs.push(unquote(m[1] as string));
  }
  const ws = readJson(join(repo, "package.json"))?.workspaces;
  const listed = Array.isArray(ws)
    ? ws
    : ws !== null &&
        typeof ws === "object" &&
        Array.isArray((ws as { packages?: unknown }).packages)
      ? (ws as { packages: unknown[] }).packages
      : [];
  for (const g of listed) if (typeof g === "string") globs.push(g);
  return {
    include: globs.filter((g) => !g.startsWith("!")),
    exclude: globs.filter((g) => g.startsWith("!")).map((g) => g.slice(1)),
  };
}

/** The package.json of the root and of every workspace folder, root first, the rest in order. */
export function workspaceManifests(repo: string): string[] {
  const found: string[] = [];
  if (readJson(join(repo, "package.json")) !== null) found.push(join(repo, "package.json"));
  const rest = new Set<string>();
  const globs = workspaceGlobs(repo);
  const left = new Set(globs.exclude.flatMap((g) => expandPattern(repo, g)));
  for (const g of globs.include) {
    for (const dir of expandPattern(repo, g)) {
      const manifest = join(dir, "package.json");
      if (!left.has(dir) && readJson(manifest) !== null) rest.add(manifest);
    }
  }
  return [...found, ...[...rest].sort()].filter((m, i, all) => all.indexOf(m) === i);
}

/** The default catalog of pnpm-workspace.yaml: library name to range. */
function catalogOf(repo: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of yamlSection(readText(join(repo, "pnpm-workspace.yaml")), "catalog")) {
    const m = /^[ \t]+("[^"]+"|'[^']+'|[^: \t]+)[ \t]*:[ \t]*(.*)$/u.exec(line);
    if (!m) continue;
    const raw = (m[2] as string).trim();
    const value = /^["']/u.test(raw)
      ? unquote(raw.replace(/[ \t]+#.*$/u, ""))
      : raw.replace(/[ \t]+#.*$/u, "").trim();
    if (value !== "") out.set(unquote(m[1] as string), value);
  }
  return out;
}

/** `@types/ws` is for `ws`, and `@types/scope__name` for `@scope/name`. */
function typedLibrary(typesName: string): string {
  const rest = typesName.slice("@types/".length);
  return rest.includes("__") ? `@${rest.replace("__", "/")}` : rest;
}

// A spec that names the workspace, a path, a repository or another name for a package is not a range.
const NOT_A_RANGE = /^(?:workspace:|link:|file:|npm:|git|https?:|github:)/u;

const KINDS = ["dependencies", "peerDependencies", "optionalDependencies"] as const;

function mostUsed(versions: readonly string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const v of versions) if (v !== "") counts.set(v, (counts.get(v) ?? 0) + 1);
  const order = (v: string): number[] => v.split(/[.\-+]/u).map((x) => Number(x) || 0);
  return [...counts]
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      const x = order(a[0]);
      const y = order(b[0]);
      for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
      return 0;
    })
    .map(([v]) => v)[0];
}

/**
 * The libraries a project declares, in all of its manifests: dependencies, peer and optional
 * dependencies, and with `dev` the devDependencies too. Each with a range (a manifest's, or the
 * catalog's) and the version the lockfile resolved.
 */
export function declaredDependencies(repo: string, dev: boolean): Stack {
  const manifests = workspaceManifests(repo).map((m) => ({ path: m, json: readJson(m) ?? {} }));
  const internal = new Set<string>();
  for (const { json } of manifests) if (typeof json.name === "string") internal.add(json.name);
  const catalog = catalogOf(repo);
  const lock: LockedDependency[] = lockedDirect(readText(join(repo, "pnpm-lock.yaml")));
  const kinds: readonly string[] = dev ? [...KINDS, "devDependencies"] : KINDS;
  const found = new Map<string, { kinds: Set<string>; spec?: string }>();
  for (const { json } of manifests) {
    for (const kind of [
      "dependencies",
      "peerDependencies",
      "optionalDependencies",
      "devDependencies",
    ]) {
      const list = json[kind];
      if (list === null || typeof list !== "object") continue;
      for (const [name, rawSpec] of Object.entries(list as Record<string, unknown>)) {
        // the types of a library are wanted whether or not its dev dependencies are
        if (!name.startsWith("@types/") && (!kinds.includes(kind) || internal.has(name))) continue;
        const spec = typeof rawSpec === "string" ? rawSpec : "";
        if (/^(?:workspace:|link:|file:)/u.test(spec)) continue;
        const entry = found.get(name) ?? { kinds: new Set<string>() };
        entry.kinds.add(kind);
        const usable = spec.startsWith("catalog:")
          ? spec === "catalog:" || spec === "catalog:default"
            ? catalog.get(name)
            : undefined
          : NOT_A_RANGE.test(spec) || spec === ""
            ? undefined
            : spec;
        if (entry.spec === undefined && usable !== undefined) entry.spec = usable;
        found.set(name, entry);
      }
    }
  }
  const declared = (name: string, e: { kinds: Set<string>; spec?: string }): Declared => {
    const version = mostUsed(lock.filter((d) => d.name === name).map((d) => d.version));
    return {
      name,
      kinds: [...e.kinds],
      ...(e.spec !== undefined ? { spec: e.spec } : {}),
      ...(version !== undefined ? { version } : {}),
    };
  };
  const sorted = [...found].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const libraries: Declared[] = sorted
    .filter(([name]) => !name.startsWith("@types/"))
    .map(([name, e]) => declared(name, e));
  const typesFor = new Map<string, Declared>();
  for (const [name, e] of sorted) {
    if (name.startsWith("@types/")) typesFor.set(typedLibrary(name), declared(name, e));
  }
  return { libraries, typesFor, internal };
}
