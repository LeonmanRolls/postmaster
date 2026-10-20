// The whole API of a library: every exported function, class, type and setting of a package, read
// from the package's own declaration files, so that a ticket's clerk knows everything the library
// already offers while it plans, and not only what it happened to read.
//
//   run api-index <repo> <package> [--dir <folder>] [--from <folder>] [--version <v>]
//                 [--match <draft>] [--max <n>] [--out <file>]
//   run api-index <repo> --all [--dev] [--from <folder>] --match <draft> [--max <n>] --out <file>
//
// The package is looked for in the project's installed packages, from `--from` (a folder of the
// project, the app that uses it) up to the root and through its apps and packages. A project
// with no install has none, so the exact version its pnpm lockfile pins is downloaded with
// `npm pack` into <repo>/.postmaster/clerk/packages (a folder git ignores) and unpacked there; a
// lockfile that pins two versions, or none, needs `--version`. `--dir` names an unpacked package.
//
// Packages of the same family that the declaration files import (`posthog-js` imports
// `@posthog/types`, which holds its settings) are indexed with it, because the API is in both. A
// family package takes the version its dependent's range allows, when the lockfile pins several.
// A package's own folders of test helpers (testing, tests, mocks, fixtures) are left out.
//
// Without `--match` every entry is printed. With `--match <draft>` the output is a menu: the
// entries ranked against the words of the draft, the best `--max` (60) and then every name that
// holds a word the draft keeps repeating, each with the words it matched, and after them a map of
// every name in the index, by file and owner. The menu carries the draft's vocabulary key;
// ticket-capabilities refuses a menu made from an older draft. The clerk reads the menu whole while
// it plans and lists nothing from it in the ticket. See skills/clerk/clerk.md.
//
// Lines are tab separated: symbol, kind, signature, doc, where, matched. `--out` writes them to a
// file and prints one summary line; without it they are printed.
//
// With `--all` the command reads every library the project uses, so that the clerk need not guess
// which ones matter: the dependencies, peer and optional dependencies of the root and of every
// workspace folder (`--dev` adds the devDependencies), at the version the lockfile resolved for the
// project (see scripts/lib/stack.ts). A library with no declaration files of its own is read
// through the `@types` package the project declares for it. The file `--out` names holds the
// stack menu (see scripts/lib/stack-menu.ts): a directory of every library, every function and
// method of every library, and the names nearest the draft across them all; the own menu of each
// library, with its map of every name, is a file in the folder beside it. The first run downloads
// the libraries the project has not installed and can take minutes; a second run uses what the
// first one fetched.
//
//   exit 0  printed or written
//   exit 1  the package could not be found or downloaded, or has no declaration files; with
//           `--all`, no library was found
//   exit 2  usage
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { extractEntries } from "./lib/api-extract.ts";
import {
  type IndexEntry,
  draftText,
  formatList,
  rank,
  vocabulary,
  vocabularyKey,
} from "./lib/index-match.ts";
import {
  type Pkg,
  familyOf,
  fetchPackage,
  findInstalled,
  lockedVersions,
  readPackage,
  typeEntries,
  typeGraph,
} from "./lib/package-types.ts";
import { type Library, formatStack, rankAcross } from "./lib/stack-menu.ts";
import { declaredDependencies } from "./lib/stack.ts";

const USAGE =
  "usage: run api-index <repo> <package> [--dir <folder>] [--from <folder>] [--version <v>] [--match <draft>] [--max <n>] [--out <file>]\n       run api-index <repo> --all [--dev] [--from <folder>] --match <draft> [--max <n>] --out <file>";

interface Options {
  readonly repo: string;
  /** The package to read; empty with `--all`. */
  readonly name: string;
  readonly all: boolean;
  readonly dev: boolean;
  readonly dir?: string;
  readonly from?: string;
  readonly version?: string;
  readonly match?: string;
  readonly max: number;
  readonly out?: string;
}

export function parseArgs(argv: readonly string[]): Options | string {
  const pos: string[] = [];
  const flags = new Map<string, string>();
  let all = false;
  let dev = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === "--all") {
      all = true;
    } else if (a === "--dev") {
      dev = true;
    } else if (["--dir", "--from", "--version", "--match", "--max", "--out"].includes(a)) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) return `${a} needs a value`;
      flags.set(a, v);
      i += 1;
    } else if (a.startsWith("--")) {
      return `unknown option ${a}`;
    } else {
      pos.push(a);
    }
  }
  if (pos.length !== (all ? 1 : 2)) return USAGE;
  if (dev && !all) return "--dev goes with --all";
  if (all && (flags.has("--dir") || flags.has("--version"))) {
    return "--all reads every library: --dir and --version name one";
  }
  if (all && (!flags.has("--match") || !flags.has("--out"))) {
    return "--all needs --match <draft> and --out <file>";
  }
  const max = Number(flags.get("--max") ?? "60");
  if (!Number.isInteger(max) || max < 1) return "--max is a whole number of at least 1";
  return {
    repo: resolve(pos[0] as string),
    name: all ? "" : (pos[1] as string),
    all,
    dev,
    dir: flags.get("--dir"),
    from: flags.get("--from"),
    version: flags.get("--version"),
    match: flags.get("--match"),
    max,
    out: flags.get("--out"),
  };
}

function lockText(repo: string): string {
  try {
    return readFileSync(join(repo, "pnpm-lock.yaml"), "utf8");
  } catch {
    return "";
  }
}

type Triple = readonly [number, number, number];

function triple(text: string): Triple | null {
  const m = /^([0-9]+)\.([0-9]+)\.([0-9]+)$/u.exec(text.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

const compareTriples = (a: Triple, b: Triple): number => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** Whether a version x.y.z is within a range: an exact version, `^x.y.z`, `~x.y.z` or `>=x.y.z`. */
export function satisfies(version: string, range: string): boolean {
  const v = triple(version);
  const parts = /^(\^|~|>=)?[ \t]*(.+)$/u.exec(range.trim());
  const low = parts ? triple(parts[2] as string) : null;
  if (v === null || low === null) return false;
  const inside = (high: Triple): boolean =>
    compareTriples(v, low) >= 0 && compareTriples(v, high) < 0;
  switch (parts?.[1]) {
    case "^":
      return inside(
        low[0] > 0 ? [low[0] + 1, 0, 0] : low[1] > 0 ? [0, low[1] + 1, 0] : [0, 0, low[2] + 1],
      );
    case "~":
      return inside([low[0], low[1] + 1, 0]);
    case ">=":
      return compareTriples(v, low) >= 0;
    default:
      return compareTriples(v, low) === 0;
  }
}

/**
 * The version to download: the one asked for, the only one the lockfile pins, or, among several,
 * what the first hint allows (the version or range a dependent package names, then the dependent's
 * own version): the hint itself when the lockfile holds it, else the highest version it allows.
 * Undefined when it cannot be told.
 */
export function chooseVersion(
  locked: readonly string[],
  asked: string | undefined,
  hints: ReadonlyArray<string | undefined>,
): string | undefined {
  if (asked !== undefined) return asked;
  if (locked.length === 1) return locked[0];
  for (const hint of hints) {
    if (hint === undefined) continue;
    if (locked.includes(hint)) return hint;
    const fits = locked
      .filter((v) => satisfies(v, hint))
      .sort((a, b) => compareTriples(triple(a) as Triple, triple(b) as Triple));
    if (fits.length > 0) return fits[fits.length - 1];
  }
  return undefined;
}

/** The folder of a package: given, installed, or downloaded at the version the lockfile pins. */
export function locate(
  o: Pick<Options, "repo" | "from" | "dir" | "version">,
  name: string,
  spec?: string,
  parentVersion?: string,
): { pkg: Pkg; note: string } | string {
  const dir = o.dir ?? findInstalled(o.repo, name, o.from);
  if (dir) {
    const pkg = readPackage(resolve(dir));
    return pkg
      ? { pkg, note: o.dir ? "given folder" : "installed" }
      : `${dir} holds no package.json`;
  }
  const locked = lockedVersions(lockText(o.repo), name);
  const version = chooseVersion(locked, o.version, [spec, parentVersion]);
  if (version === undefined && locked.length > 1) {
    return `${name} is pinned at ${locked.join(", ")}: pass --version`;
  }
  const want = version ?? spec ?? "latest";
  const cache = join(o.repo, ".postmaster", "clerk", "packages");
  const fetched = fetchPackage(`${name}@${want}`, cache);
  if (!fetched)
    return `cannot find ${name}: not installed under ${o.repo} and npm pack ${name}@${want} failed`;
  const pkg = readPackage(fetched);
  return pkg ? { pkg, note: `downloaded ${name}@${want}` } : `${fetched} holds no package.json`;
}

/** A package installed beside this one: in the same `node_modules` folder, as a package manager links a dependency. */
export function siblingOf(pkgDir: string, name: string): string | null {
  let dir = dirname(pkgDir);
  while (dir !== dirname(dir)) {
    if (basename(dir) === "node_modules") {
      const candidate = join(dir, name);
      return readPackage(candidate) ? candidate : null;
    }
    dir = dirname(dir);
  }
  return null;
}

// A folder of a package that holds its own test helpers: not part of what the package offers,
// unless the package names a file there as an entry point.
const TEST_DIR_RE = /(?:^|\/)(?:testing|tests?|__tests__|mocks?|__mocks__|fixtures?)\//u;

function entriesOf(pkg: Pkg): { entries: IndexEntry[]; bare: string[]; files: number } {
  const roots = typeEntries(pkg.dir);
  const graph = typeGraph(roots, pkg.dir);
  const entries: IndexEntry[] = [];
  let files = 0;
  for (const file of graph.files) {
    const rel = relative(pkg.dir, file);
    if (!roots.includes(file) && TEST_DIR_RE.test(rel)) continue;
    files += 1;
    entries.push(...extractEntries(readFileSync(file, "utf8"), `${pkg.name}/${rel}`));
  }
  return { entries, bare: graph.bare, files };
}

/** One entry for each symbol and kind: the first one that has a doc, else the first. */
export function dedupe(entries: readonly IndexEntry[]): IndexEntry[] {
  const kept = new Map<string, IndexEntry>();
  for (const e of entries) {
    const key = `${e.symbol}\u0000${e.kind}`;
    const old = kept.get(key);
    if (old === undefined || (old.doc === "" && e.doc !== "")) kept.set(key, e);
  }
  return [...kept.values()];
}

export interface PackageIndex {
  /** One entry for each symbol and kind. */
  readonly entries: IndexEntry[];
  /** The package and the packages of its family that were read with it. */
  readonly packages: Pkg[];
  readonly files: number;
  readonly problems: string[];
}

/**
 * Read a package and the packages of its family that its declarations import. The string is why a
 * package could not be found. A package with no declaration files is returned with no entries.
 * `skip` names packages to leave out of the family because they are read on their own.
 */
export function indexPackage(
  o: Pick<Options, "repo" | "from" | "dir" | "version">,
  name: string,
  spec?: string,
  skip: ReadonlySet<string> = new Set(),
): PackageIndex | string {
  const first = locate(o, name, spec);
  if (typeof first === "string") return first;
  const family = familyOf(first.pkg.name);
  const done = new Map<string, Pkg>([[first.pkg.name, first.pkg]]);
  const queue: Pkg[] = [first.pkg];
  let all: IndexEntry[] = [];
  let files = 0;
  const problems: string[] = [];
  while (queue.length > 0) {
    const pkg = queue.shift() as Pkg;
    const got = entriesOf(pkg);
    if (got.files === 0) {
      problems.push(`${pkg.name} has no declaration files`);
      continue;
    }
    files += got.files;
    all = all.concat(got.entries);
    let deps: Record<string, string> = {};
    try {
      const json = JSON.parse(readFileSync(join(pkg.dir, "package.json"), "utf8")) as {
        dependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
      };
      deps = { ...json.peerDependencies, ...json.dependencies };
    } catch {
      deps = {};
    }
    for (const bare of got.bare) {
      if (done.has(bare) || skip.has(bare) || familyOf(bare) !== family) continue;
      const sibling = siblingOf(pkg.dir, bare) ?? findInstalled(o.repo, bare, o.from);
      const next = locate(
        { ...o, version: undefined, dir: sibling ?? undefined, from: undefined },
        bare,
        deps[bare],
        pkg.version,
      );
      if (typeof next === "string") {
        problems.push(next);
        continue;
      }
      done.set(bare, next.pkg);
      queue.push(next.pkg);
    }
  }
  return { entries: dedupe(all), packages: [...done.values()], files, problems };
}

const describePackages = (packages: readonly Pkg[]): string =>
  packages.map((p) => `${p.name}@${p.version}`).join(", ");

function readDraft(path: string, who: string): string | number {
  try {
    return readFileSync(path, "utf8");
  } catch (e) {
    console.error(`${who}: cannot read ${path}: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
}

function mainOne(o: Options): number {
  const got = indexPackage(o, o.name);
  if (typeof got === "string") {
    console.error(`api-index: ${got}`);
    return 1;
  }
  if (got.entries.length === 0) {
    console.error(`api-index: ${got.problems.join("; ") || `no declarations found for ${o.name}`}`);
    return 1;
  }
  const { entries, packages, files, problems } = got;
  const title = `api-index ${describePackages(packages)} (${files} declaration files)`;
  let rows: Array<{ entry: IndexEntry; matched?: readonly string[] }> = entries.map((entry) => ({
    entry,
  }));
  let key: string | undefined;
  if (o.match !== undefined) {
    const draft = readDraft(o.match, "api-index");
    if (typeof draft === "number") return draft;
    const vocab = vocabulary(draftText(draft));
    key = vocabularyKey(vocab);
    rows = rank(entries, vocab, o.max).map((c) => ({ entry: c.entry, matched: c.matched }));
  }
  const text = formatList(
    { title, vocabularyKey: key, total: entries.length },
    rows,
    o.match !== undefined ? entries : undefined,
  );
  for (const p of problems) console.error(`api-index: note: ${p}`);
  if (o.out === undefined) {
    process.stdout.write(text);
    return 0;
  }
  mkdirSync(dirname(resolve(o.out)), { recursive: true });
  writeFileSync(o.out, text);
  console.log(
    `api-index: ${describePackages(packages)}: ${entries.length} entries${o.match !== undefined ? `, ${rows.length} candidates` : ""}, written to ${o.out}`,
  );
  return 0;
}

/** The folder beside a menu file that holds the own menu of each library: `menu.tsv` has `menu.libs`. */
export function libsFolderOf(out: string): string {
  return `${out.replace(/\.[^./]+$/u, "")}.libs`;
}

/** A library's name as a file name: `@tanstack/react-query` is `@tanstack__react-query`. */
export const fileNameOf = (name: string): string => `${name.replace(/\//gu, "__")}.tsv`;

function mainAll(o: Options): number {
  const draft = readDraft(o.match as string, "api-index");
  if (typeof draft === "number") return draft;
  const vocab = vocabulary(draftText(draft));
  const key = vocabularyKey(vocab);
  const stack = declaredDependencies(o.repo, o.dev);
  if (stack.libraries.length === 0) {
    console.error(`api-index: no libraries declared in the manifests under ${o.repo}`);
    return 1;
  }
  const names = new Set(stack.libraries.map((l) => l.name));
  const out = resolve(o.out as string);
  const folder = libsFolderOf(out);
  mkdirSync(folder, { recursive: true });
  const libs: Library[] = [];
  stack.libraries.forEach((d, i) => {
    console.error(`api-index: [${i + 1}/${stack.libraries.length}] ${d.name}`);
    const where = { repo: o.repo, from: o.from, version: d.version };
    let got = indexPackage(where, d.name, d.spec, names);
    if (typeof got !== "string" && got.entries.length === 0) {
      const types = stack.typesFor.get(d.name);
      const typed =
        types === undefined
          ? undefined
          : indexPackage({ ...where, version: types.version }, types.name, types.spec, names);
      if (typed !== undefined && typeof typed !== "string" && typed.entries.length > 0) {
        got = { ...typed, packages: [...got.packages, ...typed.packages] };
      }
    }
    if (typeof got === "string") {
      libs.push({ name: d.name, packages: [], entries: [], note: got });
    } else if (got.entries.length === 0) {
      libs.push({
        name: d.name,
        packages: got.packages,
        entries: [],
        note: "no declaration files",
      });
    } else {
      const menuFile = relative(dirname(out), join(folder, fileNameOf(d.name)));
      const rows = rank(got.entries, vocab, o.max).map((c) => ({
        entry: c.entry,
        matched: c.matched,
      }));
      const title = `api-index ${describePackages(got.packages)} (${got.files} declaration files)`;
      writeFileSync(
        join(folder, fileNameOf(d.name)),
        formatList({ title, vocabularyKey: key, total: got.entries.length }, rows, got.entries),
      );
      libs.push({ name: d.name, packages: got.packages, entries: got.entries, menuFile });
    }
  });
  const { rows, hits } = rankAcross(libs, vocab);
  const title = `api-index --all ${o.repo}`;
  writeFileSync(out, formatStack({ title, vocabularyKey: key }, libs, hits, rows));
  const read = libs.filter((l) => l.entries.length > 0);
  if (read.length === 0) {
    console.error("api-index: no library had declaration files");
    return 1;
  }
  const missing = libs.filter((l) => l.entries.length === 0).map((l) => l.name);
  console.log(
    `api-index: ${libs.length} libraries, ${read.length} read (${read.reduce((n, l) => n + l.entries.length, 0)} names)${missing.length > 0 ? `, ${missing.length} without declarations: ${missing.join(", ")}` : ""}; menu written to ${out}, own menus in ${folder}`,
  );
  return 0;
}

function main(argv: string[]): number {
  const o = parseArgs(argv);
  if (typeof o === "string") {
    console.error(o === USAGE ? o : `api-index: ${o}\n${USAGE}`);
    return 2;
  }
  return o.all ? mainAll(o) : mainOne(o);
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
