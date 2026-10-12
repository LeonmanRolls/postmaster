// Which of the flow's scripts lean on a machine's own files, processes and sockets (see ../method.md).
// A script is counted once per pattern, however often it uses it. The patterns are tested against the
// script's code, not its comments, and the names of a target project's package-manager lock files are
// blanked first, since they are not the flow's own lock files. The scripts that test the flow itself
// (self-tests, oracles, acceptance runs) are left out. Pure core; the edge at the bottom reads `scripts/`
// of a checkout and writes a table.
//
//   bun primitives.ts --repo <checkout> --out <file.md>
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type Primitive = { id: string; label: string; pattern: RegExp };

const WORKTREE_VERB = "(?:add|remove|list|prune|move|repair|lock|unlock)";

export const PRIMITIVES: Primitive[] = [
  {
    id: "spawn",
    label: "starts child processes",
    pattern: /Bun\.spawn|spawnSync|execFileSync|execSync|node:child_process/u,
  },
  {
    id: "signal",
    label: "signals processes or process groups",
    pattern: /process\.kill|SIGTERM|SIGKILL|setsid|killpg|kill -/u,
  },
  {
    id: "helpers",
    label: "imports the shared process helpers (lib/proc, lib/processes)",
    pattern: /lib\/proc(?:esses)?\.ts/u,
  },
  { id: "proc", label: "reads /proc", pattern: /\/proc\//u },
  {
    id: "cgroup",
    label: "uses systemd scopes or cgroup limits",
    pattern: /systemd-run|MemoryMax|TasksMax|cgroup/u,
  },
  {
    id: "sandbox",
    label: "uses bwrap or sandbox-exec, to wrap a harness or to probe for them",
    pattern: /bwrap|bubblewrap|sandbox-exec/u,
  },
  { id: "host", label: "drives herdr or tmux", pattern: /herdr|tmux/iu },
  { id: "symlink", label: "makes symbolic links", pattern: /symlinkSync|symlink\(/u },
  {
    id: "marker",
    label: "names a marker, pid or lock file, waits on markers or creates a file exclusively",
    pattern: /-done\b|\.done\b|\.marker\b|wait-for-markers|O_EXCL|flock|\.pid["'`]|\.lock["'`]/u,
  },
  {
    id: "worktree",
    label: "runs git worktree commands (not herdr's own worktree commands)",
    pattern: new RegExp(
      `(?:\\bgit\\w*\\(|["'\`]git["'\`]\\s*,)[^;]{0,160}?["'\`]worktree["'\`]\\s*,\\s*["'\`]${WORKTREE_VERB}["'\`]|\\bgit\\b[^\\n]{0,60}\\bworktree\\s+${WORKTREE_VERB}\\b`,
      "u",
    ),
  },
  {
    id: "home",
    label: "reads the home directory or ~/.postmaster",
    pattern: /homedir\(\)|~\/\.postmaster|process\.env\.HOME/u,
  },
];

const LOCKFILES =
  /\b(?:bun\.lockb?|yarn\.lock|Cargo\.lock|composer\.lock|Gemfile\.lock|poetry\.lock|uv\.lock|Pipfile\.lock|package-lock\.json|pnpm-lock\.yaml)\b/gu;

/** The text a pattern is tested against: comments removed and a target project's lock file names blanked. */
export function code(text: string): string {
  return text
    .replace(/^[ \t]*\/\*[\s\S]*?\*\//gmu, " ")
    .split("\n")
    .map((line) => line.replace(/(^|\s)\/\/.*$/u, "$1"))
    .join("\n")
    .replace(LOCKFILES, " ");
}

/** A script that is part of the flow, as against a test of it: not a `.test.ts`, self-test, oracle or acceptance run. */
export const isFlowScript = (name: string): boolean =>
  name.endsWith(".ts") && !/(?:\.test|-self-test|-oracle|-acceptance)\.ts$/u.test(name);

export type Hits = Record<string, string[]>;

/** For each primitive, the names of the files whose code matches it. */
export function scan(files: Record<string, string>, primitives: readonly Primitive[] = PRIMITIVES): Hits {
  const stripped = Object.entries(files).map(([name, text]) => [name, code(text)] as const);
  const hits: Hits = {};
  for (const p of primitives) {
    hits[p.id] = stripped
      .filter(([, text]) => p.pattern.test(text))
      .map(([name]) => name)
      .sort();
  }
  return hits;
}

/** A markdown table: primitive, scripts using it, out of how many. */
export function table(hits: Hits, total: number, primitives: readonly Primitive[] = PRIMITIVES): string {
  const lines = ["| What a script does | Scripts | Of |", "| --- | --- | --- |"];
  for (const p of primitives) lines.push(`| ${p.label} | ${hits[p.id]?.length ?? 0} | ${total} |`);
  return lines.join("\n");
}

/** The files behind each count, so a count can be checked by hand. */
export function listing(hits: Hits, primitives: readonly Primitive[] = PRIMITIVES): string {
  return primitives
    .map((p) => `- ${p.label}: ${(hits[p.id] ?? []).map((f) => f.replace(/^scripts\//u, "")).join(", ") || "none"}`)
    .join("\n");
}

function main(): void {
  const args = process.argv.slice(2);
  const value = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const repo = value("--repo");
  const out = value("--out");
  if (!repo || !out) {
    process.stderr.write("usage: bun primitives.ts --repo <checkout> --out <file.md>\n");
    process.exit(2);
  }
  const files: Record<string, string> = {};
  let left = 0;
  for (const dir of ["scripts", "scripts/lib"]) {
    for (const name of readdirSync(join(repo, dir))) {
      if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue;
      if (!isFlowScript(name)) {
        left += 1;
        continue;
      }
      files[`${dir}/${name}`] = readFileSync(join(repo, dir, name), "utf8");
    }
  }
  const total = Object.keys(files).length;
  const hits = scan(files);
  const text = [
    "# Scripts by what they lean on",
    "",
    `${total} scripts of the flow under scripts/ and scripts/lib/. ${left} more, which test the flow itself (self-tests, oracles and acceptance runs), and every \`.test.ts\`, are left out. Patterns are tested against code, not comments, and a target project's package-manager lock file names are blanked first.`,
    "",
    table(hits, total),
    "",
    "## The files behind each count",
    "",
    listing(hits),
    "",
  ].join("\n");
  writeFileSync(out, text);
}

if (import.meta.main) main();
