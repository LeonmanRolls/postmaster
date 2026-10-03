// Verify a chosen target before dispatching anything at it.
//   exit 0  usable
//   exit 1  not a git repository: refuse
//   exit 2  git repository, but the tree is dirty: ask, do not proceed silently
import { run } from "./lib/proc.ts";

export interface TargetReach {
  code: number;
  out: string;
  root: string;
  branch: string;
  defaultBranch: string;
  head: string;
  changed: string[];
  offDefault: boolean;
}

function pathsFromStatus(output: string): string[] {
  const fields = output.split("\0").filter(Boolean);
  const paths: string[] = [];
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i] ?? "";
    const path = field.slice(3);
    if (path !== "") paths.push(path);
    if (/^(?:R|C)/u.test(field.slice(0, 2))) {
      const previous = fields[i + 1];
      if (previous) paths.push(previous);
      i++;
    }
  }
  return paths;
}

/** Read every changed path in a checkout without fetching or folding new directories. */
export function reachTarget(target: string, defaultBranch: string): TargetReach {
  const rootResult = run("git", ["-C", target, "rev-parse", "--show-toplevel"]);
  if (rootResult.code !== 0) {
    return {
      code: 1,
      out: `not a git repository: ${target}\n`,
      root: "",
      branch: "",
      defaultBranch,
      head: "",
      changed: [],
      offDefault: false,
    };
  }
  const root = rootResult.out.trimEnd();
  const headResult = run("git", ["-C", root, "rev-parse", "--verify", "--short", "HEAD"]);
  if (headResult.code !== 0) {
    return {
      code: 1,
      out: `cannot read HEAD in ${root}\n`,
      root,
      branch: "",
      defaultBranch,
      head: "",
      changed: [],
      offDefault: false,
    };
  }
  const branchResult = run("git", ["-C", root, "symbolic-ref", "--short", "-q", "HEAD"]);
  const branch = branchResult.code === 0 ? branchResult.out.trimEnd() : "(detached HEAD)";
  const status = run("git", [
    "-C",
    root,
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]);
  if (status.code !== 0) {
    return {
      code: 1,
      out: `cannot read status in ${root}: ${status.err.trim()}\n`,
      root,
      branch,
      defaultBranch,
      head: headResult.out.trimEnd(),
      changed: [],
      offDefault: false,
    };
  }
  const changed = pathsFromStatus(status.out);
  const offDefault = branch !== defaultBranch;
  const lines = [
    `root ${root}`,
    `head ${headResult.out.trimEnd()}`,
    `branch ${branch}`,
    `default ${defaultBranch}`,
  ];
  if (offDefault) lines.push(`off-default ${branch} (default is ${defaultBranch})`);
  for (const path of changed) lines.push(`changed ${path}`);
  if (changed.length === 0 && !offDefault) lines.push("clean");
  return {
    code: changed.length > 0 || offDefault ? 2 : 0,
    out: `${lines.join("\n")}\n`,
    root,
    branch,
    defaultBranch,
    head: headResult.out.trimEnd(),
    changed,
    offDefault,
  };
}

function standardCheck(target: string): number {
  const root = run("git", ["-C", target, "rev-parse", "--show-toplevel"]);
  if (root.code !== 0) {
    console.error(`not a git repository: ${target}`);
    return 1;
  }
  console.log(`root   ${root.out.trimEnd()}`);

  const head = run("git", ["-C", target, "rev-parse", "--short", "HEAD"]);
  console.log(`head   ${head.code === 0 ? head.out.trimEnd() : "(no commits)"}`);

  const branch = run("git", ["-C", target, "rev-parse", "--abbrev-ref", "HEAD"]);
  console.log(`branch ${branch.out.trimEnd()}`);

  run("git", ["-C", target, "fetch", "--quiet"]);

  const status = run("git", ["-C", target, "status", "--porcelain"]);
  const lines = status.out.split("\n").filter((l) => l !== "");
  const dirty = lines.length;
  if (dirty !== 0) {
    console.log(`dirty  ${dirty} uncommitted path(s):`);
    for (const line of lines.slice(0, 20)) console.log(`       ${line}`);
    console.log("");
    console.log(
      "A coachman branches from committed HEAD, so this work would be silently excluded.",
    );
    console.log("Ask before proceeding. Offer: commit it / stash it (shared stack, say where) /");
    console.log("commit to a base branch and dispatch from there / hand back. Never discard.");
    return 2;
  }
  console.log("dirty  0");
  return 0;
}

export function main(argv: string[]): number {
  if (argv[0] === "reach") {
    if (argv.length !== 3 || !argv[1] || !argv[2]) {
      console.error("usage: check-target.sh reach <path> <default-branch>");
      return 1;
    }
    const result = reachTarget(argv[1], argv[2]);
    process.stdout.write(result.out);
    return result.code;
  }
  if (argv.length !== 1 || !argv[0]) {
    console.error("usage: check-target.sh <path>");
    return 1;
  }
  return standardCheck(argv[0]);
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
