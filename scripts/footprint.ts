// The size of a change, in a few lines a design reviewer can read before it reads the diff: how
// many files and lines, how they split between source, tests and generated files, which packages
// are new, which dependencies are new, and where the change writes browser storage or cookies.
// It is context for the design lens, never a gate: a big change may be right and a small one wrong.
//
//   run footprint <repo> <base> <head>
//
// The change is `git diff <base>...<head>`, the range the review lenses read. The storage and
// cookie line is a guess from the lines the change adds, and says so.
//
//   exit 0  printed
//   exit 1  a revision git cannot read
//   exit 2  usage
import { run } from "./lib/proc.ts";

export type Kind = "source" | "tests" | "generated" | "docs";

export interface Counts {
  files: number;
  added: number;
  removed: number;
}

const TEST_RE = /(^|\/)(tests?|__tests__|e2e)\/|\.(test|spec)\.[A-Za-z0-9]+$/u;
const GENERATED_RE =
  /\.gen\.|(^|\/)(dist|build)\/|(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.lock)$/u;
const DOCS_RE = /\.(md|mdx|txt)$|(^|\/)docs\//u;
const MANIFESTS = /(^|\/)(package\.json|Cargo\.toml|go\.mod)$/u;
const DEPENDENCY_KEYS = ["dependencies", "devDependencies", "peerDependencies"] as const;
const STORAGE_RE = /(localStorage|sessionStorage)\.setItem\([ \t]*['"`]([^'"`]+)['"`]/gu;
const COOKIE_RE =
  /(?:document\.cookie[ \t]*=[ \t]*['"`]|cookies?\.set\([ \t]*['"`]|Set-Cookie[^A-Za-z0-9_.-]{1,12})([A-Za-z0-9_.-]+)(?:=|['"`])/gu;

/** What a path is: a test, a generated file, a document, or source. Generated outranks the rest. */
export function classify(path: string): Kind {
  if (GENERATED_RE.test(path)) return "generated";
  if (TEST_RE.test(path)) return "tests";
  if (DOCS_RE.test(path)) return "docs";
  return "source";
}

/** Sum `git diff --numstat` lines by kind. A binary file (shown as - -) counts as a file and no lines. */
export function sumNumstat(text: string): Record<Kind | "all", Counts> {
  const zero = (): Counts => ({ files: 0, added: 0, removed: 0 });
  const out: Record<Kind | "all", Counts> = {
    all: zero(),
    source: zero(),
    tests: zero(),
    generated: zero(),
    docs: zero(),
  };
  for (const line of text.split("\n")) {
    const f = line.split("\t");
    if (f.length < 3) continue;
    const added = f[0] === "-" ? 0 : Number(f[0]);
    const removed = f[1] === "-" ? 0 : Number(f[1]);
    for (const k of ["all", classify(f.slice(2).join("\t"))] as const) {
      out[k].files += 1;
      out[k].added += added;
      out[k].removed += removed;
    }
  }
  return out;
}

/** The added files that are a package's manifest, other than the project's own at the top. */
export function newPackages(nameStatus: string): string[] {
  return nameStatus
    .split("\n")
    .map((l) => l.split("\t"))
    .filter((f) => f[0] === "A" && f[1] !== undefined && MANIFESTS.test(f[1]) && f[1].includes("/"))
    .map((f) => (f[1] as string).replace(/\/[^/]+$/u, ""));
}

/** The dependency names an after-manifest holds that a before-manifest did not. */
export function newDependencies(before: string | null, after: string): string[] {
  const names = (text: string | null): Set<string> => {
    if (text === null) return new Set();
    try {
      const doc = JSON.parse(text) as Record<string, unknown>;
      return new Set(
        DEPENDENCY_KEYS.flatMap((k) => {
          const table = doc[k];
          return typeof table === "object" && table !== null ? Object.keys(table) : [];
        }),
      );
    } catch {
      return new Set();
    }
  };
  const had = names(before);
  return [...names(after)].filter((n) => !had.has(n)).sort();
}

/** Where the added lines write browser storage or set a cookie, by the name they write. A guess. */
export function storageWrites(addedLines: string): string[] {
  const found = new Set<string>();
  for (const m of addedLines.matchAll(STORAGE_RE)) found.add(`${m[1]} ${m[2]}`);
  for (const m of addedLines.matchAll(COOKIE_RE)) found.add(`cookie ${m[1]}`);
  return [...found].sort();
}

const fmt = (c: Counts): string => `${c.files} files, +${c.added} -${c.removed}`;

function git(repo: string, args: string[]): { code: number; out: string } {
  const r = run("git", ["-C", repo, ...args]);
  return { code: r.code, out: r.out };
}

export function main(argv: string[]): number {
  if (argv.length !== 3) {
    console.error("usage: run footprint <repo> <base> <head>");
    return 2;
  }
  const [repo, base, head] = argv as [string, string, string];
  const range = `${base}...${head}`;
  const numstat = git(repo, ["diff", "--numstat", "-M", range]);
  const status = git(repo, ["diff", "--name-status", "-M", range]);
  const patch = git(repo, ["diff", "-U0", range]);
  if (numstat.code !== 0 || status.code !== 0 || patch.code !== 0) {
    console.error(`footprint: git cannot read ${range} in ${repo}`);
    return 1;
  }
  const sums = sumNumstat(numstat.out);
  console.log(`files: ${sums.all.files}`);
  console.log(`lines: +${sums.all.added} -${sums.all.removed}`);
  for (const k of ["source", "tests", "generated", "docs"] as const) {
    if (sums[k].files > 0) console.log(`${k}: ${fmt(sums[k])}`);
  }
  const packages = newPackages(status.out);
  console.log(`new packages: ${packages.length === 0 ? "none" : packages.join(", ")}`);
  const manifests = status.out
    .split("\n")
    .map((l) => l.split("\t"))
    .filter(
      (f) =>
        (f[0] === "M" || f[0] === "A") && f[1] !== undefined && /(^|\/)package\.json$/u.test(f[1]),
    );
  const deps = new Set<string>();
  for (const f of manifests) {
    const path = f[1] as string;
    const before = f[0] === "A" ? null : git(repo, ["show", `${base}:${path}`]);
    const after = git(repo, ["show", `${head}:${path}`]);
    if (after.code !== 0) continue;
    for (const d of newDependencies(
      before !== null && before.code === 0 ? before.out : null,
      after.out,
    )) {
      deps.add(d);
    }
  }
  console.log(`new dependencies: ${deps.size === 0 ? "none" : [...deps].sort().join(", ")}`);
  const added = patch.out
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .join("\n");
  const writes = storageWrites(added);
  console.log(
    `storage and cookies written (a guess from the added lines): ${writes.length === 0 ? "none found" : writes.join(", ")}`,
  );
  return 0;
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
