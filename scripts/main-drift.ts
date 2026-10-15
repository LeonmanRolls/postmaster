// What the default branch changed since a branch was last checked, put in front of an independent
// reader. A merge that applies cleanly can still leave the branch wrong: main removed a style class
// the branch's new markup uses, redefined a helper the branch calls, or made a setting the default.
// A merge tool cannot see that and neither can the gate, so a lane that took no part in the work
// reads what main changed in the places the branch touches against the lines the branch added.
//
//   run main-drift <repo> <since> <main> <head> --name <name> [--out <dir>] [--max-bytes <n>]
//
//   <since>  the default-branch commit the branch was last checked against: its BASE, or the main
//            commit it last merged and was reviewed on
//   <main>   the default branch now
//   <head>   the branch's tip, or the tip of its open pull request
//
// It writes <out> (default <repo>/.postmaster/drift/<name>) with the question and three materials:
// main-files.txt, every file main changed; main-side.diff, what main changed under the folders the
// branch touches; branch.diff, the branch's own change. Then it prints the surveyor call that puts
// them to a lane, and exits. It runs no model. The folder is outside the run's dispatch because
// the surveyor takes the dispatch's files from a short list only.
//
//   exit 0  written and the call printed, or main has not moved and nothing was written
//   exit 1  a revision git cannot read, or the folder cannot be written
//   exit 2  usage
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { run } from "./lib/proc.ts";

const DEFAULT_MAX_BYTES = 400_000;

/** The folders a set of changed files sit in, two levels deep where there are two, so `apps/portal/a.ts`
 * is `apps/portal` and `README.md` is the top. */
export function areasOf(files: readonly string[]): string[] {
  const out = new Set<string>();
  for (const f of files) {
    const parts = f.split("/");
    out.add(
      parts.length >= 3
        ? `${parts[0]}/${parts[1]}`
        : parts.length === 2
          ? (parts[0] as string)
          : ".",
    );
  }
  return [...out].sort();
}

/** A text cut to a byte budget at a line end, with a note saying how much was left out. */
export function cap(text: string, maxBytes: number): string {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= maxBytes) return text;
  const head = new TextDecoder().decode(bytes.subarray(0, maxBytes));
  const cut = head.lastIndexOf("\n");
  const kept = cut > 0 ? head.slice(0, cut) : head;
  const left = bytes.length - new TextEncoder().encode(kept).length;
  return `${kept}\n... cut here: ${left} more bytes. main-files.txt lists every file main changed.\n`;
}

export function question(
  since: string,
  main: string,
  head: string,
  areas: readonly string[],
): string {
  return [
    "# Drift review",
    "",
    `A branch was written and checked against main at ${since}. Main has since moved to ${main}. The branch's tip is ${head}. The merge applies cleanly; the question is whether the branch is still right.`,
    "",
    `You have three files: main-files.txt (every file main changed), main-side.diff (what main changed under ${areas.join(", ")}, the folders the branch touches) and branch.diff (the branch's own change). The repository is at the branch's tip.`,
    "",
    "Find what is now wrong or dead although the merge is clean: a class, token, function, prop, option, route or file that the lines the branch added use and that main removed, renamed, redefined or stopped honoring (a style class that no longer renders, a helper whose meaning changed, a setting main made the default), and a convention main introduced that the branch's new code must follow.",
    "",
    "For each one give the branch line (file:line), the main change that breaks it (commit and file), the evidence by quoting both, and the fix in one sentence. Check each by reading the code at the branch's tip, not by guessing from the diffs. If there is none, answer `no drift found` and one line on what you read. Do not modify any file.",
    "",
  ].join("\n");
}

function git(repo: string, args: string[]): { code: number; out: string } {
  const r = run("git", ["-C", repo, ...args]);
  return { code: r.code, out: r.out };
}

export function main(argv: string[]): number {
  const usage =
    "usage: run main-drift <repo> <since> <main> <head> --name <name> [--out <dir>] [--max-bytes <n>]";
  const pos: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === "--name" || a === "--out" || a === "--max-bytes") {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) {
        console.error(usage);
        return 2;
      }
      flags.set(a, v);
      i += 1;
    } else if (a.startsWith("--")) {
      console.error(usage);
      return 2;
    } else {
      pos.push(a);
    }
  }
  const name = flags.get("--name");
  if (pos.length !== 4 || name === undefined || !/^[A-Za-z0-9._-]+$/u.test(name)) {
    console.error(usage);
    return 2;
  }
  const [repoArg, since, main, head] = pos as [string, string, string, string];
  const repo = resolve(repoArg);
  const maxBytes = Number(flags.get("--max-bytes") ?? DEFAULT_MAX_BYTES);
  if (!Number.isInteger(maxBytes) || maxBytes < 1000) {
    console.error("main-drift: --max-bytes is a whole number of at least 1000");
    return 2;
  }
  const count = git(repo, ["rev-list", "--count", `${since}..${main}`]);
  if (count.code !== 0) {
    console.error(`main-drift: git cannot read ${since}..${main} in ${repo}`);
    return 1;
  }
  if (Number(count.out.trim()) === 0) {
    console.log(`no drift check: main has not moved since ${since}`);
    return 0;
  }
  const mainFiles = git(repo, ["diff", "--name-only", `${since}..${main}`]);
  const branchFiles = git(repo, ["diff", "--name-only", `${since}...${head}`]);
  if (mainFiles.code !== 0 || branchFiles.code !== 0) {
    console.error(`main-drift: git cannot read the range ${since}, ${main}, ${head} in ${repo}`);
    return 1;
  }
  const areas = areasOf(branchFiles.out.split("\n").filter((f) => f !== ""));
  const pathspec = areas.map((a) => (a === "." ? ":(top,glob)*" : a));
  const mainSide = git(repo, ["diff", "-U3", `${since}..${main}`, "--", ...pathspec]);
  const branchDiff = git(repo, ["diff", "-U3", `${since}...${head}`]);
  if (mainSide.code !== 0 || branchDiff.code !== 0) {
    console.error("main-drift: git cannot produce the diffs");
    return 1;
  }
  const out = flags.get("--out") ?? join(repo, ".postmaster", "drift", name);
  try {
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "question.md"), question(since, main, head, areas));
    writeFileSync(join(out, "main-files.txt"), mainFiles.out);
    writeFileSync(join(out, "main-side.diff"), cap(mainSide.out, maxBytes));
    writeFileSync(join(out, "branch.diff"), cap(branchDiff.out, maxBytes));
  } catch (e) {
    console.error(
      `main-drift: cannot write ${out} (${e instanceof Error ? e.message : String(e)})`,
    );
    return 1;
  }
  console.log(
    `main moved by ${count.out.trim()} commits since ${since}; areas: ${areas.join(", ")}`,
  );
  console.log(`wrote ${out}`);
  console.log(
    `then: <tool>/scripts/run surveyor call <dispatch> ${repo} --name ${name} --snapshot ${head} --question ${join(out, "question.md")} --material ${join(out, "main-files.txt")} --material ${join(out, "main-side.diff")} --material ${join(out, "branch.diff")} --timeout 1800`,
  );
  return 0;
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
