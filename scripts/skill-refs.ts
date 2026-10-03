// Find every script reference in the postmaster skill that would not resolve from an installed
// skill. An installed skill is a link from a harness's skills folder into the postmaster repo,
// and a session reaches the repo only as <tool>, the path SKILL.md finds from that link once.
// A reference resolves from any working directory only when it goes through <tool> and names
// a script the repo has. The run's pinned checkout goes through <rt> instead, resolved per run
// by run-meta.sh path; it is a checkout of the same repo, so the same existence check applies.
//
//   skill-refs.sh [<file>...]          default: skills/postmaster/*.md beside this script's repo
//   skill-refs.sh --fix [<file>...]    put <tool>/ before every bare scripts/ path, in place
//
// A reference is any scripts/ path. It is a fault when it is bare (scripts/x.sh, which resolves
// only from the repo's own root), when it reaches scripts/ some other way (../../scripts/x.sh),
// or when it goes through <tool> or <rt> to a script the repo does not have. A path under
// another placeholder or variable, such as <repo>/scripts/, is that directory's and not the tool's.
// --fix rewrites the bare form only, so it can be run again after a rebase and changes nothing
// the second time; the check that follows it names whatever it could not fix.
//
//   exit 0  every reference resolves
//   exit 1  faults, one per line on stdout: <file>:<line>: <reason>: <reference>
//   exit 2  usage, or a file that cannot be read
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { toolRoot } from "./lib/paths.ts";

const REF = /scripts\/[A-Za-z0-9._-]*/gu;
const BARE = /(?<![A-Za-z0-9_./-])scripts\//gu;
const OTHER = /(<[A-Za-z0-9_-]+>|\$\{?[A-Za-z_][A-Za-z0-9_]*\}?)\/$/u;

type Fault = { file: string; line: number; why: string; ref: string };

/** refs <root> check|fix <file>... — returns faults and the exit code the shell form took. */
export function refs(
  root: string,
  mode: "check" | "fix",
  files: string[],
): { faults: Fault[]; code: number; fixMessages: string[] } {
  const faults: Fault[] = [];
  const fixMessages: string[] = [];
  for (const f of files) {
    let text: string;
    try {
      text = readFileSync(f, "utf8");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(`skill-refs: cannot read ${f}: ${msg}\n`);
      return { faults, code: 2, fixMessages };
    }
    if (mode === "fix") {
      const new_ = text.replace(BARE, "<tool>/scripts/");
      const _n = text.split(BARE).length - 1;
      // count matches of BARE
      let count = 0;
      for (const _m of text.matchAll(BARE)) count += 1;
      if (count > 0) {
        writeFileSync(f, new_, "utf8");
        fixMessages.push(`${f}: ${count} reference(s) now go through <tool>`);
      }
      text = new_;
    }
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      REF.lastIndex = 0;
      for (const m of line.matchAll(REF)) {
        const before = line.slice(0, m.index ?? 0);
        const ref = (m[0] ?? "").replace(/\.+$/u, "");
        if (before.length > 0 && /[A-Za-z0-9_]/u.test(before[before.length - 1] ?? "")) {
          continue; // part of a longer name
        }
        const name = ref.slice("scripts/".length);
        if (before.endsWith("<tool>/") || before.endsWith("<rt>/")) {
          const which = before.endsWith("<tool>/") ? "<tool>/" : "<rt>/";
          if (name !== "" && !isFile(join(root, "scripts", name))) {
            faults.push({
              file: f,
              line: i + 1,
              why: "no such script in the postmaster repo",
              ref: `${which}${ref}`,
            });
          }
        } else if (OTHER.test(before)) {
        } else if (before.endsWith("/")) {
          faults.push({
            file: f,
            line: i + 1,
            why: "reaches scripts/ without going through <tool>",
            ref,
          });
        } else {
          faults.push({
            file: f,
            line: i + 1,
            why: "bare; it resolves only from the repo's own root",
            ref,
          });
        }
      }
    }
  }
  return { faults, code: faults.length > 0 ? 1 : 0, fixMessages };
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function printFaults(faults: Fault[]): void {
  for (const f of faults) {
    console.log(`${f.file}:${f.line}: ${f.why}: ${f.ref}`);
  }
}

// --- entry -----------------------------------------------------------------------------------
const argv = process.argv.slice(2);
if (import.meta.main) {
  let mode: "check" | "fix" = "check";
  if (argv[0] === "--fix") {
    mode = "fix";
    argv.shift();
  } else if (argv[0]?.startsWith("-")) {
    console.error("usage: skill-refs.sh [--fix] [<file>...]");
    process.exit(2);
  }

  const ROOT = toolRoot(import.meta);

  let files = argv;
  if (files.length === 0) {
    const dir = join(ROOT, "skills", "postmaster");
    try {
      const entries = readdirSync(dir).filter((n) => n.endsWith(".md"));
      files = entries.map((n) => join(dir, n));
      if (files.length === 0) {
        console.error(`skill-refs: no skills/postmaster/*.md in ${ROOT}`);
        process.exit(2);
      }
    } catch {
      console.error(`skill-refs: no skills/postmaster/*.md in ${ROOT}`);
      process.exit(2);
    }
  }
  const { faults, code, fixMessages } = refs(ROOT, mode, files);
  for (const m of fixMessages) process.stderr.write(`${m}\n`);
  printFaults(faults);
  process.exit(code);
}
