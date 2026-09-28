// Find every script reference in the postmaster skill that would not resolve from an installed
// skill. An installed skill is a link from a harness's skills folder into the postmaster repo,
// and a session reaches the repo only as <tool>, the path SKILL.md finds from that link once.
// A reference resolves from any working directory only when it goes through <tool> and names
// a script the repo has.
//
//   skill-refs.sh [<file>...]          default: skills/postmaster/*.md beside this script's repo
//   skill-refs.sh --fix [<file>...]    put <tool>/ before every bare scripts/ path, in place
//   skill-refs.sh --self-test
//
// A reference is any scripts/ path. It is a fault when it is bare (scripts/x.sh, which resolves
// only from the repo's own root), when it reaches scripts/ some other way (../../scripts/x.sh),
// or when it goes through <tool> to a script the repo does not have. A path under another
// placeholder or variable, such as <repo>/scripts/, is that directory's and not the tool's.
// --fix rewrites the bare form only, so it can be run again after a rebase and changes nothing
// the second time; the check that follows it names whatever it could not fix.
//
//   exit 0  every reference resolves
//   exit 1  faults, one per line on stdout: <file>:<line>: <reason>: <reference>
//   exit 2  usage, or a file that cannot be read
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { toolRoot } from "./lib/paths.ts";
import { withTempDir } from "./lib/proc.ts";
import { SelfTest } from "./lib/selftest.ts";

const REF = /scripts\/[A-Za-z0-9._-]*/g;
const BARE = /(?<![A-Za-z0-9_./-])scripts\//g;
const OTHER = /(<[A-Za-z0-9_-]+>|\$\{?[A-Za-z_][A-Za-z0-9_]*\}?)\/$/;

type Fault = { file: string; line: number; why: string; ref: string };

/** refs <root> check|fix <file>... — returns faults and the exit code the shell form took. */
function refs(
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
        const ref = (m[0] ?? "").replace(/\.+$/, "");
        if (before.length > 0 && /[A-Za-z0-9_]/.test(before[before.length - 1] ?? "")) {
          continue; // part of a longer name
        }
        const name = ref.slice("scripts/".length);
        if (before.endsWith("<tool>/")) {
          if (name !== "" && !isFile(join(root, "scripts", name))) {
            faults.push({
              file: f,
              line: i + 1,
              why: "no such script in the postmaster repo",
              ref: `<tool>/${ref}`,
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
let mode: "check" | "fix" | "self-test" = "check";
if (argv[0] === "--self-test") {
  mode = "self-test";
} else if (argv[0] === "--fix") {
  mode = "fix";
  argv.shift();
} else if (argv[0]?.startsWith("-")) {
  console.error("usage: skill-refs.sh [--fix] [<file>...] | --self-test");
  process.exit(2);
}

const ROOT = toolRoot(import.meta);

if (mode !== "self-test") {
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

// --- self-test --------------------------------------------------------------------------------
withTempDir((tmp) => {
  const root = join(tmp, "root");
  const scriptsDir = join(root, "scripts");
  mkdirSync(scriptsDir, { recursive: true });
  writeFileSync(join(scriptsDir, "stage.sh"), "");
  writeFileSync(join(scriptsDir, "launch.sh"), "");

  const st = new SelfTest();
  const faults = (file: string): number => refs(root, "check", [file]).faults.length;

  const bare = join(tmp, "bare.md");
  const good = join(tmp, "good.md");
  const relative = join(tmp, "relative.md");
  const missing = join(tmp, "missing.md");

  writeFileSync(
    bare,
    [
      "Set the stage with `scripts/stage.sh <dispatch> synthesis`.",
      "( scripts/launch.sh launch <lane> <wt> <prompt> ) &",
      "Every leg ends with scripts/stage.sh.",
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    good,
    [
      "Set the stage with `<tool>/scripts/stage.sh <dispatch> synthesis`.",
      "( <tool>/scripts/launch.sh launch <lane> <wt> <prompt> ) &",
      "The project's own `<repo>/scripts/build.sh` and \"$HERE/scripts/x\" are not the tool's.",
      "Every `<tool>/scripts/` path is the repo's; postscripts/ and myscripts/x.sh are other words.",
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(relative, "Run `../../scripts/stage.sh` from the skill.\n", "utf8");
  writeFileSync(missing, "Run `<tool>/scripts/no-such.sh`.\n", "utf8");

  console.log("positive controls: each fault is found, on its own line");
  st.check("three bare references are three faults", faults(bare) === 3);
  {
    const r = refs(root, "check", [bare]);
    const out = r.faults.map((f) => `${f.file}:${f.line}: ${f.why}: ${f.ref}`).join("\n");
    st.check(
      "a fault names its file and line, and exits 1",
      r.code === 1 && out.includes(`${bare}:1: bare`),
      `exit ${r.code}`,
    );
  }
  st.check("a path that reaches scripts/ another way is a fault", faults(relative) === 1);
  st.check("a script the repo does not have is a fault", faults(missing) === 1);

  console.log("negative controls: nothing is found where nothing is wrong");
  {
    const r = refs(root, "check", [good]);
    st.check(
      "references through <tool>, and other directories' scripts/, read zero",
      r.code === 0 && r.faults.length === 0,
      `exit ${r.code}`,
    );
  }
  {
    // a file that cannot be read is exit 2
    const r = refs(root, "check", [join(tmp, "nowhere.md")]);
    st.check(
      "a file that cannot be read is exit 2, not a clean result",
      r.code === 2,
      `exit ${r.code}`,
    );
  }

  console.log("--fix: bare references go through <tool>, and a second run changes nothing");
  const fix = join(tmp, "fix.md");
  writeFileSync(
    fix,
    readFileSync(bare, "utf8") + readFileSync(good, "utf8") + readFileSync(relative, "utf8"),
    "utf8",
  );
  refs(root, "fix", [fix]);
  {
    const r = refs(root, "check", [fix]);
    const body = readFileSync(fix, "utf8");
    st.check(
      "every bare reference is fixed, none is doubled, and the one it cannot fix is still named",
      r.faults.length === 1 &&
        !body.includes("<tool>/<tool>/") &&
        body.includes("`<tool>/scripts/stage.sh <dispatch>"),
      body,
    );
  }
  const once = join(tmp, "once.md");
  writeFileSync(once, readFileSync(fix, "utf8"), "utf8");
  refs(root, "fix", [fix]);
  st.check(
    "a second --fix changes nothing",
    readFileSync(fix, "utf8") === readFileSync(once, "utf8"),
  );
  const goodCopy = join(tmp, "good-copy.md");
  writeFileSync(goodCopy, readFileSync(good, "utf8"), "utf8");
  refs(root, "fix", [goodCopy]);
  st.check(
    "--fix leaves a file with no bare reference alone",
    readFileSync(good, "utf8") === readFileSync(goodCopy, "utf8"),
  );

  st.finish();
});
