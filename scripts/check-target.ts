// Verify a chosen target before dispatching anything at it.
//   exit 0  usable
//   exit 1  not a git repository: refuse
//   exit 2  git repository, but the tree is dirty: ask, do not proceed silently
import { run } from "./lib/proc.ts";

const T = process.argv[2];
if (T === undefined) {
  console.error("usage: check-target.sh <path>");
  process.exit(1);
}

const root = run("git", ["-C", T, "rev-parse", "--show-toplevel"]);
if (root.code !== 0) {
  console.error(`not a git repository: ${T}`);
  process.exit(1);
}
console.log(`root   ${root.out.trimEnd()}`);

const head = run("git", ["-C", T, "rev-parse", "--short", "HEAD"]);
console.log(`head   ${head.code === 0 ? head.out.trimEnd() : "(no commits)"}`);

const branch = run("git", ["-C", T, "rev-parse", "--abbrev-ref", "HEAD"]);
console.log(`branch ${branch.out.trimEnd()}`);

run("git", ["-C", T, "fetch", "--quiet"]);

const status = run("git", ["-C", T, "status", "--porcelain"]);
const lines = status.out.split("\n").filter((l) => l !== "");
const dirty = lines.length;
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
