// The default check for a library: run the tests that reach it the way its users do, by its
// package name, which resolves only to what the package exports.
//
//   verify-library.sh [<worktree>]
//   verify-library.sh --list [<worktree>]   the test files it would run, one per line
//
// A test file is a JavaScript or TypeScript file under a test, tests or __tests__ directory, or
// named *.test.* or *.spec.*, tracked or new, outside node_modules and outside the directories
// that hold what tests use (fixtures, __fixtures__, helpers, support, __mocks__). It counts when a
// line of it opens with a test (test, it or describe, awaited or not), it imports the package by
// the name package.json gives, and it imports nothing else of the package's own by path: a
// relative import may reach only test files and the directories tests keep their files in. Where
// package.json has a build script it runs first, through the package manager, since the name
// resolves to what a build makes. The tests run through the project's own runner: vitest, jest or
// mocha where package.json depends on one, bun test where the project uses bun, node --test
// otherwise. <worktree> defaults to the current directory.
//
//   exit 0  the build, where there is one, and every such test passed
//   exit 1  the build or a test failed
//   exit 3  not run: no package.json, no name in it, no test that imports it by name, or its
//           runner, node or its package manager is not installed; the reason is the last line
import { accessSync, constants, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { delimiter, join, posix, resolve } from "node:path";
import { readJsonFile } from "./lib/data.ts";
import { die, run } from "./lib/proc.ts";
import { BOUND_L, PY_M_START, PY_S_CLASS, W_CLASS } from "./lib/text.ts";

const CODE = /\.(?:c|m)?(?:j|t)sx?$/u;
const TEST_NAME = /\.(?:test|spec)\.(?:c|m)?(?:j|t)sx?$/u;
const TEST_DIRS = new Set(["test", "tests", "__tests__"]);
const SUPPORT_DIRS = new Set(["fixtures", "__fixtures__", "helpers", "support", "__mocks__"]);
export const IMPORT = new RegExp(
  `(?:${BOUND_L}from[${PY_S_CLASS}]*|${BOUND_L}import[${PY_S_CLASS}]*\\(?[${PY_S_CLASS}]*|${BOUND_L}require[${PY_S_CLASS}]*\\([${PY_S_CLASS}]*)(['"])([^'"\\n]+)\\1`,
  "gu",
);
export const TEST_CALL = new RegExp(
  `${PY_M_START}[${PY_S_CLASS}]*(?:await[${PY_S_CLASS}]+)?(?:test|it|describe)(?:\\.[${W_CLASS}]+)*[${PY_S_CLASS}]*\\(`,
  "gu",
);

function notRun(msg: string): never {
  console.log(`not run: ${msg}`);
  process.exit(3);
  throw new Error("unreachable");
}

function isTest(rel: string): boolean {
  const parts = rel.split("/");
  if (
    !CODE.test(rel) ||
    parts.includes("node_modules") ||
    parts.slice(0, -1).some((p) => SUPPORT_DIRS.has(p))
  ) {
    return false;
  }
  return TEST_NAME.test(rel) || parts.slice(0, -1).some((p) => TEST_DIRS.has(p));
}

function helper(rel: string): boolean {
  const parts = rel.split("/");
  return isTest(rel) || parts.slice(0, -1).some((p) => TEST_DIRS.has(p) || SUPPORT_DIRS.has(p));
}

function listOrRun(mode: "list" | "run", wtArg: string): number {
  const wt = resolve(wtArg);
  const pkgFile = join(wt, "package.json");
  if (!existsSync(pkgFile)) {
    notRun(
      `no package.json in ${wt}; this default runs a package.json project's tests, so declare the check in .postmaster/project.toml`,
    );
  }
  let pkg: Record<string, unknown>;
  try {
    pkg = readJsonFile<Record<string, unknown>>(pkgFile);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    notRun(`package.json does not parse: ${msg}`);
  }
  const name = pkg.name;
  if (typeof name !== "string" || !name) {
    notRun("package.json has no name, so no test can import the library by it");
  }

  // list files
  const git = run("git", ["-C", wt, "ls-files", "-co", "--exclude-standard"]);
  let files: string[];
  if (git.code === 0) {
    files = [...new Set(git.out.split("\n").filter((l) => l !== ""))].sort();
  } else {
    files = [];
    (function walk(dir: string): void {
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        return;
      }
      for (const n of entries) {
        const p = join(dir, n);
        try {
          if (statSync(p).isDirectory()) walk(p);
          else files.push(p);
        } catch {
          /* skip */
        }
      }
    })(wt);
    files = files.map((p) => p.split("/").slice(wt.split("/").length).join("/")).sort();
  }

  const chosen: string[] = [];
  for (const rel of files) {
    if (!isTest(rel)) continue;
    let src: string;
    try {
      src = readFileSync(join(wt, rel), "utf8");
    } catch {
      continue;
    }
    let byName = false;
    let inside = false;
    IMPORT.lastIndex = 0;
    for (const m of src.matchAll(IMPORT)) {
      const spec = m[2] ?? "";
      if (spec === name || spec.startsWith(`${name}/`)) {
        byName = true;
      } else if (spec.startsWith(".")) {
        const target = posix.normalize(posix.join(posix.dirname(rel), spec));
        if (target.startsWith("..") || !helper(target)) {
          inside = true;
        }
      }
    }
    TEST_CALL.lastIndex = 0;
    if (byName && !inside && TEST_CALL.test(src)) {
      chosen.push(rel);
    }
  }

  if (mode === "list") {
    console.log(chosen.join("\n"));
    return 0;
  }
  if (chosen.length === 0) {
    notRun(`no test imports ${name} by its name and nothing else of its own by path`);
  }

  const deps: Record<string, string> = {};
  for (const key of ["dependencies", "devDependencies"]) {
    const d = pkg[key];
    if (d && typeof d === "object") Object.assign(deps, d);
  }
  const scriptsRaw = pkg.scripts;
  const scripts: Record<string, string> =
    scriptsRaw && typeof scriptsRaw === "object" ? (scriptsRaw as Record<string, string>) : {};
  const bun = existsSync(join(wt, "bun.lock")) || existsSync(join(wt, "bun.lockb"));
  const pm = existsSync(join(wt, "pnpm-lock.yaml"))
    ? "pnpm"
    : bun
      ? "bun"
      : existsSync(join(wt, "yarn.lock"))
        ? "yarn"
        : "npm";

  function local(tool: string): string {
    const p = join(wt, "node_modules", ".bin", tool);
    if (!existsSync(p)) {
      notRun(`package.json depends on ${tool}, which is not installed: run ${pm} install first`);
    }
    return p;
  }

  let argv: string[];
  if ("vitest" in deps) {
    argv = [local("vitest"), "run", ...chosen];
  } else if ("jest" in deps) {
    argv = [local("jest"), ...chosen];
  } else if ("mocha" in deps) {
    argv = [local("mocha"), ...chosen];
  } else if (
    bun ||
    String(scripts.test ?? "").startsWith("bun ") ||
    "@types/bun" in deps ||
    "bun-types" in deps
  ) {
    if (!which("bun")) {
      notRun("the project runs its tests with bun, which is not on PATH");
    }
    argv = ["bun", "test", ...chosen.map((f) => `./${f}`)];
  } else {
    if (!which("node")) {
      notRun("the tests run with node --test, and node is not on PATH");
    }
    argv = ["node", "--test", ...chosen];
  }

  if (scripts.build) {
    if (!which(pm)) {
      notRun(`package.json has a build script, run through ${pm}, which is not on PATH`);
    }
    const b = run(pm, ["run", "build"], { cwd: wt, input: "" });
    if (b.code !== 0) {
      console.log(`the build failed: ${pm} run build exited ${b.code}`);
      return 1;
    }
  }
  console.log(
    `running ${chosen.length} test file(s) that import ${name} by name: ${chosen.join(" ")}`,
  );
  const t = run(argv[0] as string, argv.slice(1), { cwd: wt, input: "" });
  console.log(
    `the tests through ${name}'s public interface ${t.code === 0 ? "passed" : `failed, exit ${t.code}`}`,
  );
  return t.code === 0 ? 0 : 1;
}

/** shutil.which: the path of a runnable file named tool on PATH, or null. */
export function findOnPath(tool: string, path: string): string | null {
  for (const dir of path.split(delimiter)) {
    if (!dir) continue;
    const f = join(dir, tool);
    try {
      if (statSync(f).isFile()) {
        accessSync(f, constants.X_OK);
        return f;
      }
    } catch {
      // not in this directory
    }
  }
  return null;
}

function which(tool: string): boolean {
  return findOnPath(tool, process.env.PATH || "") !== null;
}

// --- entry -----------------------------------------------------------------------------------
function main(argv: string[]): number {
  if (argv[0] === "--list") {
    if (argv.length > 2) die("usage: verify-library.sh [--list] [<worktree>]", 1);
    const WT = argv[1] ?? ".";
    if (!existsSync(WT)) die(`verify-library: no such directory: ${WT}`, 1);
    return listOrRun("list", WT);
  }
  if (argv[0]?.startsWith("-")) {
    die("usage: verify-library.sh [--list] [<worktree>]", 1);
  }
  if (argv.length > 1) die("usage: verify-library.sh [--list] [<worktree>]", 1);
  const WT = argv[0] ?? ".";
  if (!existsSync(WT)) die(`verify-library: no such directory: ${WT}`, 1);
  return listOrRun("run", WT);
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
