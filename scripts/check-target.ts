import { command, writeError, writeOut } from "./lib/core.ts";

const [target] = process.argv.slice(2);
if (!target) {
  writeError("usage: check-target.sh <path>");
  process.exit(1);
}

const git = (...args: string[]) => command("git", ["-C", target, ...args]);
const root = git("rev-parse", "--show-toplevel");
if (root.code !== 0) {
  writeError(`not a git repository: ${target}`);
  process.exit(1);
}
writeOut(`root   ${root.stdout.trim()}`);
const head = git("rev-parse", "--short", "HEAD");
writeOut(`head   ${head.code === 0 ? head.stdout.trim() : "(no commits)"}`);
writeOut(`branch ${git("rev-parse", "--abbrev-ref", "HEAD").stdout.trim()}`);
command("git", ["-C", target, "fetch", "--quiet"]);

const status = git("status", "--porcelain").stdout.split(/\r?\n/).filter(Boolean);
if (status.length > 0) {
  writeOut(`dirty  ${status.length} uncommitted path(s):`);
  for (const line of status.slice(0, 20)) writeOut(`       ${line}`);
  writeOut("");
  writeOut("A coachman branches from committed HEAD, so this work would be silently excluded.");
  writeOut("Ask before proceeding. Offer: commit it / stash it (shared stack, say where) /");
  writeOut("commit to a base branch and dispatch from there / hand back. Never discard.");
  process.exit(2);
}
writeOut("dirty  0");
