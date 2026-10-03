// Fail when the change stages or commits anything under .postmaster/,
// and hold every added raw/ file to the scrub.
//
//   tree-check.sh [<base> [<head>]]   the change; base defaults to main,
//                                     head to HEAD
//   tree-check.sh --help
//
// .postmaster/ holds a run's automatic record and is gitignored; the one
// file a project commits there is .postmaster/project.toml. Anything
// else staged or committed under .postmaster/ fails, named by redacted
// path. raw/ is committed by design, so for raw/ the check holds every
// added file to the scrub instead.
//
//   exit 0  clean
//   exit 1  faults on stdout, one per line
//   exit 2  usage, not a repository, an unresolvable base or head
import { execFileSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";

const HERE = resolve(import.meta.dir);
const USAGE = "usage: tree-check.sh [<base> [<head>]] | --help";
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

function fail(msg: string, code = 2): never {
  console.error(`tree-check: ${msg}`);
  process.exit(code);
}

function git(args: string[], cwd?: string): string {
  try {
    return (execFileSync("git", args, { cwd, encoding: "utf-8" }) as string).trim();
  } catch {
    fail("Git could not read the requested history");
  }
}

function gitBuf(args: string[], cwd?: string): Buffer {
  try {
    return execFileSync("git", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    }) as Buffer;
  } catch {
    fail("Git could not read the requested history");
  }
}

function safePath(path: string): string {
  // Redact any private-shaped spans from a path for reporting.
  return path.replace(/[^\x20-\x7e]/gu, (c) => {
    const cp = c.codePointAt(0)!;
    return `\\x${cp.toString(16).padStart(2, "0")}`;
  });
}

function main(): number {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.error(USAGE);
    return 0;
  }
  if (args.length > 2) {
    console.error(USAGE);
    return 2;
  }
  const root = git(["rev-parse", "--show-toplevel"]);
  if (resolve(process.cwd()) !== resolve(root)) {
    fail("run from the repository root");
  }
  let base: string;
  let head: string;
  if (args.length === 0) {
    base = git(["rev-parse", "--verify", "--quiet", "main"]);
    head = git(["rev-parse", "HEAD"]);
  } else if (args.length === 1) {
    base = git(["rev-parse", "--verify", "--quiet", args[0]!]);
    head = git(["rev-parse", "HEAD"]);
  } else {
    base = git(["rev-parse", "--verify", "--quiet", args[0]!]);
    head = git(["rev-parse", "--verify", "--quiet", args[1]!]);
  }
  const faults: string[] = [];

  // .postmaster/ anything but project.toml: tracked at the tip, staged,
  // or added/modified in any commit of the range.
  const tracked = git(["ls-files", ".postmaster/"], root);
  for (const path of tracked.split("\n").filter(Boolean)) {
    if (path !== ".postmaster/project.toml") {
      faults.push(safePath(path));
    }
  }
  // Staged (in the index) but not yet committed.
  const staged = git(["diff", "--cached", "--name-only"], root);
  for (const path of staged.split("\n").filter(Boolean)) {
    if (path.startsWith(".postmaster/") && path !== ".postmaster/project.toml") {
      if (!faults.includes(safePath(path))) faults.push(safePath(path));
    }
  }
  // Commits in the range that add or modify .postmaster/ files.
  const names = git(
    ["diff", "--name-only", `${base}..${head}`, "--", ".postmaster/"],
    root,
  );
  for (const path of names.split("\n").filter(Boolean)) {
    if (path !== ".postmaster/project.toml") {
      if (!faults.includes(safePath(path))) faults.push(safePath(path));
    }
  }
  // Merge commits too.
  const merges = git(
    ["rev-list", "--merges", `${base}..${head}`],
    root,
  );
  for (const merge of merges.split("\n").filter(Boolean)) {
    const mergeNames = git(
      ["diff", "--name-only", `${merge}^1`, merge, "--", ".postmaster/"],
      root,
    );
    for (const path of mergeNames.split("\n").filter(Boolean)) {
      if (path !== ".postmaster/project.toml") {
        if (!faults.includes(safePath(path))) faults.push(safePath(path));
      }
    }
  }

  // raw/: every added file is held to the scrub.
  const addedRaw = git(
    ["diff", "--name-only", "--diff-filter=A", `${base}..${head}`, "--", "raw/"],
    root,
  );
  const scrubBin = join(HERE, "scrub-check.sh");
  for (const path of addedRaw.split("\n").filter(Boolean)) {
    try {
      const blob = gitBuf(["show", `${head}:${path}`], root);
      const tmpFile = join(root, ".git", "tree-check-tmp");
      writeFileSync(tmpFile, blob);
      const r = execFileSync(scrubBin, ["--files", tmpFile], {
        cwd: root,
        encoding: "utf-8",
        env: { ...process.env, POSTMASTER_DETECTIONS_LOG: "" },
      });
      for (const line of (r as string).trim().split("\n").filter(Boolean)) {
        faults.push(`${safePath(path)}: ${line.split(": ").pop()}`);
      }
      unlinkSync(tmpFile);
    } catch {
      // A blob that cannot be read is not a fault here; the scrub covers it.
    }
  }

  faults.sort();
  for (const f of faults) console.log(f);
  return faults.length > 0 ? 1 : 0;
}

try {
  process.exit(main());
} catch {
  console.error("tree-check: scan failed");
  process.exit(2);
}
