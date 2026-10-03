// Verify a chosen target before dispatching anything at it.
//   check-target.sh <path>                      the default form, for its callers
//   check-target.sh --reach <path> [<default>]  the reach form, for scripts/reach.ts
//
// The default form fetches and folds a new folder into one line, and prints at most 20
// `git status --porcelain` lines. The reach form lists every path (`-uall`), every new file
// by its own name, says when the checkout is not on its default branch, treats the default
// branch moving forward as no change, and does not fetch.
//
//   exit 0  usable (the reach form: clean and on the default branch)
//   exit 1  not a git repository: refuse
//   exit 2  git repository, but the tree is dirty (default form: ask, do not proceed silently)
//           or the reach form: dirty or off the default branch
import { run } from "./lib/proc.ts";

const argv = process.argv.slice(2);
const reach = argv[0] === "--reach";
const T = reach ? argv[1] : argv[0];
const DEFAULT_BRANCH = reach ? (argv[2] ?? "main") : "";
if (T === undefined) {
  console.error("usage: check-target.sh <path> | --reach <path> [<default>]");
  process.exit(1);
}

const root = run("git", ["-C", T, "rev-parse", "--show-toplevel"]);
if (root.code !== 0) {
  console.error(`not a git repository: ${T}`);
  process.exit(1);
}
if (reach) {
  console.log(`root ${root.out.trimEnd()}`);
} else {
  console.log(`root   ${root.out.trimEnd()}`);
}

const head = reach
  ? run("git", ["-C", T, "rev-parse", "HEAD"])
  : run("git", ["-C", T, "rev-parse", "--short", "HEAD"]);
if (reach) {
  console.log(`head ${head.code === 0 ? head.out.trimEnd() : ""}`);
} else {
  console.log(`head   ${head.code === 0 ? head.out.trimEnd() : "(no commits)"}`);
}

const branch = run("git", ["-C", T, "rev-parse", "--abbrev-ref", "HEAD"]);
if (reach) {
  const b = branch.out.trimEnd();
  console.log(`branch ${b}`);
  if (DEFAULT_BRANCH !== "" && b !== DEFAULT_BRANCH) {
    console.log(`off the default branch, on ${b}, default ${DEFAULT_BRANCH}`);
    // Still list every path below; the caller reads both.
  }
} else {
  console.log(`branch ${branch.out.trimEnd()}`);
}

if (!reach) {
  run("git", ["-C", T, "fetch", "--quiet"]);
}

const status = run("git", ["-C", T, "status", "--porcelain", ...(reach ? ["-uall"] : [])]);
const lines = status.out.split("\n").filter((l) => l !== "");
const dirty = lines.length;
if (reach) {
  // Every path, every new file by its own name.
  for (const line of lines) {
    const path = line.slice(3).replace(/^"|"$/gu, "");
    console.log(`path ${path}`);
  }
  const off = DEFAULT_BRANCH !== "" && branch.out.trimEnd() !== DEFAULT_BRANCH;
  if (dirty !== 0 || off) process.exit(2);
  process.exit(0);
}
if (dirty !== 0) {
  console.log(`dirty  ${dirty} uncommitted path(s):`);
  for (const line of lines.slice(0, 20)) console.log(`       ${line}`);
  console.log("");
  console.log("A coachman branches from committed HEAD, so this work would be silently excluded.");
  console.log("Ask before proceeding. Offer: commit it / stash it (shared stack, say where) /");
  console.log("commit to a base branch and dispatch from there / hand back. Never discard.");
  process.exit(2);
}
console.log("dirty  0");
process.exit(0);
