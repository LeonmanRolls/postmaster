// Find an installed package, or the exact version a project's lockfile pins, and the declaration files
// that make up its API. Used by scripts/api-index.ts.
//
// A package is looked for in the project's installed packages first. A checkout with no install
// (a clone, a fresh worktree) has none, so the exact version the pnpm lockfile pins is downloaded
// into the project's ignored drafts folder with `npm pack` and unpacked there: the project is
// not changed, and the result is the same file set the install would have made.
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { run as runDefault } from "./proc.ts";

export interface Pkg {
  readonly name: string;
  readonly version: string;
  readonly dir: string;
  /** What the package says it is, when its package.json has a description. */
  readonly description?: string;
}

export function readPackage(dir: string): Pkg | null {
  try {
    const json = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
      name?: unknown;
      version?: unknown;
      description?: unknown;
    };
    if (typeof json.name !== "string") return null;
    return {
      name: json.name,
      version: typeof json.version === "string" ? json.version : "unknown",
      dir,
      ...(typeof json.description === "string" && json.description !== ""
        ? { description: json.description }
        : {}),
    };
  } catch {
    return null;
  }
}

const DECL_RE = /\.d\.[cm]?ts$/u;

function declarationStrings(value: unknown, out: string[]): void {
  if (typeof value === "string") {
    if (DECL_RE.test(value)) out.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) declarationStrings(v, out);
  } else if (value !== null && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) declarationStrings(v, out);
  }
}

/** The declaration files a package names as its entry points, absolute, those that exist. */
export function typeEntries(dir: string): string[] {
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Record<string, unknown>;
  } catch {
    return [];
  }
  const named: string[] = [];
  for (const key of ["types", "typings"]) {
    if (typeof json[key] === "string") named.push(json[key] as string);
  }
  declarationStrings(json.exports, named);
  for (const key of ["main", "module"]) {
    const v = json[key];
    if (typeof v === "string" && /\.[cm]?js$/u.test(v)) {
      named.push(v.replace(/\.[cm]?js$/u, ".d.ts"));
    }
  }
  named.push("index.d.ts", "dist/index.d.ts", "lib/index.d.ts", "types/index.d.ts");
  const found: string[] = [];
  for (const rel of named) {
    const abs = resolve(dir, rel);
    if (abs.startsWith(dir + sep) && existsSync(abs) && !found.includes(abs)) found.push(abs);
  }
  return found;
}

const SPEC_RE = /(?:from|import)[ \t]*\(?[ \t]*['"]([^'"]+)['"]/gu;
const REF_RE = /\/\/\/[ \t]*<reference[ \t]+path=["']([^"']+)["']/gu;

function resolveRelative(from: string, spec: string, root: string): string | null {
  const base = resolve(dirname(from), spec);
  const stripped = base.replace(/\.[cm]?js$/u, "");
  const options = [
    base,
    `${stripped}.d.ts`,
    `${stripped}.d.mts`,
    `${stripped}.d.cts`,
    `${base}.d.ts`,
    `${base}.ts`,
    join(base, "index.d.ts"),
    join(base, "index.ts"),
  ];
  for (const o of options) {
    if (o.startsWith(root + sep) && existsSync(o) && (DECL_RE.test(o) || o.endsWith(".ts"))) {
      return o;
    }
  }
  return null;
}

/** The module name a specifier names: `@scope/name/sub` is `@scope/name`, `name/sub` is `name`. */
export function packageNameOf(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier);
}

/** What a package belongs to: its scope, or the first word of its name. `posthog-js` and `@posthog/types` share `posthog`. */
export function familyOf(name: string): string {
  if (name.startsWith("@")) return name.slice(1).split("/")[0] ?? name;
  return name.split("-")[0] ?? name;
}

/** Every declaration file reachable from the entries by relative imports, and the packages those files import. */
export function typeGraph(
  entries: readonly string[],
  root: string,
): { files: string[]; bare: string[] } {
  const files: string[] = [];
  const bare = new Set<string>();
  const queue = [...entries];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    files.push(file);
    let text = "";
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const re of [SPEC_RE, REF_RE]) {
      re.lastIndex = 0;
      for (let m = re.exec(text); m !== null; m = re.exec(text)) {
        const spec = m[1];
        if (spec.startsWith(".")) {
          const next = resolveRelative(file, spec, root);
          if (next && !seen.has(next)) queue.push(next);
        } else if (re === SPEC_RE && !spec.startsWith("node:")) {
          bare.add(packageNameOf(spec));
        }
      }
    }
  }
  return { files, bare: [...bare].sort() };
}

/** The versions of a package a pnpm lockfile holds, in the order the lockfile lists them. */
export function lockedVersions(lockText: string, name: string): string[] {
  const escaped = name.replace(/[.*+?^${}()|[\]\\/]/gu, "\\$&");
  const re = new RegExp(`^ {2}'?${escaped}@([^':( \\t]+)`, "u");
  const out: string[] = [];
  for (const line of lockText.split("\n")) {
    const m = re.exec(line);
    if (m && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

export interface LockedDependency {
  /** The workspace folder, such as `apps/manager`, or `.` for the root. */
  readonly importer: string;
  readonly kind: string;
  readonly name: string;
  readonly specifier: string;
  /** The version the lockfile resolved, without the peer suffix; empty for a link to the workspace. */
  readonly version: string;
}

const unquote = (s: string): string => s.trim().replace(/^(['"])(.*)\1$/u, "$2");

/**
 * The direct dependencies a pnpm lockfile records for each workspace folder, from its `importers`
 * section: which version of each library the project really resolved.
 */
export function lockedDirect(lockText: string): LockedDependency[] {
  const out: LockedDependency[] = [];
  let inImporters = false;
  let importer = "";
  let kind = "";
  let name = "";
  let specifier = "";
  const flush = (version: string): void => {
    if (name !== "" && version !== "") {
      const v = version.startsWith("link:") ? "" : (version.split("(")[0] ?? "");
      out.push({ importer, kind, name, specifier, version: v });
    }
    name = "";
    specifier = "";
  };
  for (const line of lockText.split("\n")) {
    if (/^[^ #\t]/u.test(line)) {
      inImporters = line.startsWith("importers:");
      continue;
    }
    if (!inImporters) continue;
    const m = /^( *)([^ \t].*?):[ \t]*(.*)$/u.exec(line);
    if (!m || (m[2] as string).startsWith("#")) continue;
    const indent = (m[1] as string).length;
    const key = unquote(m[2] as string);
    const value = unquote(m[3] as string);
    if (indent === 2) {
      importer = key;
    } else if (indent === 4) {
      kind = key;
    } else if (indent === 6) {
      name = key;
      specifier = "";
    } else if (indent === 8 && key === "specifier") {
      specifier = value;
    } else if (indent === 8 && key === "version") {
      flush(value);
    }
  }
  return out;
}

function packageIn(dir: string, name: string): string | null {
  const candidate = join(dir, "node_modules", name);
  try {
    const real = realpathSync(candidate);
    return existsSync(join(real, "package.json")) ? real : null;
  } catch {
    return null;
  }
}

/** The installed copy of a package: from `from` (a folder of the project) up to the project root, then its apps and packages. */
export function findInstalled(repo: string, name: string, from?: string): string | null {
  const root = resolve(repo);
  let dir = resolve(root, from ?? ".");
  while (dir.startsWith(root)) {
    const hit = packageIn(dir, name);
    if (hit) return hit;
    if (dir === root) break;
    dir = dirname(dir);
  }
  const viaStore = packageIn(join(root, "node_modules", ".pnpm"), name);
  if (viaStore) return viaStore;
  for (const group of ["apps", "packages"]) {
    let kids: string[] = [];
    try {
      kids = readdirSync(join(root, group));
    } catch {
      continue;
    }
    for (const kid of kids.sort()) {
      const hit = packageIn(join(root, group, kid), name);
      if (hit) return hit;
    }
  }
  return null;
}

type Runner = typeof runDefault;

/**
 * The folder an archive unpacked to inside `dest`: `package`, as npm names it, or the one folder
 * with a package.json in it, as the packages of DefinitelyTyped name theirs (`react` for @types/react).
 */
function unpackedIn(dest: string): string | null {
  let names: string[] = [];
  try {
    names = readdirSync(dest).sort();
  } catch {
    return null;
  }
  for (const name of ["package", ...names]) {
    const dir = join(dest, name);
    if (existsSync(join(dir, "package.json"))) return dir;
  }
  return null;
}

/** Download `name@version` with `npm pack` into `cache` and unpack it; the unpacked package folder, or null. */
export function fetchPackage(
  spec: string,
  cache: string,
  runCmd: Runner = runDefault,
): string | null {
  const dest = join(cache, spec.replace(/[^A-Za-z0-9._-]+/gu, "_"));
  const already = unpackedIn(dest);
  if (already !== null) return already;
  mkdirSync(dest, { recursive: true });
  const packed = runCmd("npm", ["pack", spec, "--pack-destination", dest, "--silent"], {
    timeout: 120000,
  });
  if (packed.code !== 0) return null;
  const file = basename(packed.out.trim().split("\n").pop() ?? "");
  if (file === "") return null;
  const untar = runCmd("tar", ["-xzf", join(dest, file), "-C", dest]);
  return untar.code === 0 ? unpackedIn(dest) : null;
}
