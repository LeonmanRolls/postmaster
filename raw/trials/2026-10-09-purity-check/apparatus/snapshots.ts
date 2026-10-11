// Runs the purity check at each review snapshot of a findings table, and compares the token
// version with the syntax-tree version at each.
//
//   bun --no-env-file --config=/dev/null snapshots.ts --repo <git repo> --findings <findings.tsv>
//     --out <dir> [--places]
//
// Each snapshot's scripts/ folder is read out of the repository with `git archive` into
// <out>/<snapshot>/, which touches no worktree. The findings table is the trial data of
// 2026-10-04-review-findings-classified: the columns `run`, `round` and `snapshot` are used.
// The default output is one line per snapshot (run, round, snapshot, modules, flagged in scope,
// of them found by the page's own list, flagged over all of scripts/, and whether the token and
// syntax-tree versions agree). With --places, one line per flagged place instead.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { compare } from "./cross-check.ts";
import { modulesUnder, placesIn } from "./purity-check.ts";

type Row = Readonly<{ run: string; round: string; snapshot: string }>;

/** The distinct (run, round, snapshot) triples of a findings table, in file order. */
export function snapshotsOf(tsv: string): Row[] {
  const [head, ...lines] = tsv.trim().split("\n");
  const cols = (head ?? "").split("\t");
  const at = (name: string): number => cols.indexOf(name);
  const seen = new Set<string>();
  const out: Row[] = [];
  for (const line of lines) {
    const f = line.split("\t");
    const row = {
      run: f[at("run")] ?? "",
      round: f[at("round")] ?? "",
      snapshot: f[at("snapshot")] ?? "",
    };
    if (!seen.has(row.snapshot)) {
      seen.add(row.snapshot);
      out.push(row);
    }
  }
  return out;
}

function extract(repo: string, sha: string, dir: string): void {
  if (existsSync(join(dir, "scripts"))) return;
  mkdirSync(dir, { recursive: true });
  const archive = spawnSync("git", ["archive", "--format=tar", sha, "scripts"], {
    cwd: repo,
    maxBuffer: 512 * 1024 * 1024,
  });
  if (archive.status !== 0) throw new Error(`git archive ${sha} failed`);
  const untar = spawnSync("tar", ["-x", "-C", dir], { input: archive.stdout });
  if (untar.status !== 0) throw new Error(`tar failed for ${sha}`);
}

function main(argv: readonly string[]): number {
  const arg = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const repo = arg("--repo");
  const findings = arg("--findings");
  const out = arg("--out");
  if (repo === undefined || findings === undefined || out === undefined) {
    console.error(
      "usage: snapshots.ts --repo <git repo> --findings <findings.tsv> --out <dir> [--places]",
    );
    return 2;
  }
  const places = argv.includes("--places");
  console.log(
    places
      ? "snapshot\tpath\tline\tcol\trule\tkind\tpage\ttext"
      : "run\tround\tsnapshot\tmodules\tflagged\tpage\tflagged-all\tagree",
  );
  for (const { run, round, snapshot } of snapshotsOf(readFileSync(findings, "utf8"))) {
    const root = join(out, snapshot);
    extract(repo, snapshot, root);
    const read = (path: string): string => readFileSync(join(root, path), "utf8");
    const core = modulesUnder(root, "core");
    const flagged = core.flatMap((path) => placesIn(path, read(path)));
    if (places) {
      for (const p of flagged) {
        const rule = p.rule + (p.typeOnly ? " (type only)" : "");
        console.log(
          [snapshot, p.path, p.line, p.col, rule, p.kind, p.page ? "yes" : "no", p.text].join("\t"),
        );
      }
      continue;
    }
    const all = modulesUnder(root, "all").flatMap((path) => placesIn(path, read(path)));
    const same = compare(root, "core");
    const agree = same.onlyToken.length + same.onlyAst.length === 0 ? "yes" : "NO";
    const pageCount = flagged.filter((p) => p.page).length;
    console.log(
      [run, round, snapshot, core.length, flagged.length, pageCount, all.length, agree].join("\t"),
    );
  }
  return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
