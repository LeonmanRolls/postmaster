// The default check for a library: run the tests that reach it the way its users do, by its
// package name, which resolves only to what the package exports.
//
//   verify-library.sh [<worktree>]
//   verify-library.sh --list [<worktree>]   the test files it would run, one per line
//   verify-library.sh --self-test
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
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { delimiter, dirname, join, posix, resolve } from "node:path";
import { readJsonFile, tryJsonFile } from "./lib/data.ts";
import { die, run, withTempDir } from "./lib/proc.ts";
import { SelfTest } from "./lib/selftest.ts";

const CODE = /\.(?:c|m)?(?:j|t)sx?$/;
const TEST_NAME = /\.(?:test|spec)\.(?:c|m)?(?:j|t)sx?$/;
const TEST_DIRS = new Set(["test", "tests", "__tests__"]);
const SUPPORT_DIRS = new Set(["fixtures", "__fixtures__", "helpers", "support", "__mocks__"]);
const IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(['"])([^'"\n]+)\1/g;
const TEST_CALL = /^\s*(?:await\s+)?(?:test|it|describe)(?:\.\w+)*\s*\(/gm;

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
function findOnPath(tool: string, path: string): string | null {
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
const argv = process.argv.slice(2);
if (argv[0] === "--self-test") {
  // fall through to self-test below
} else if (argv[0] === "--list") {
  if (argv.length > 2) die("usage: verify-library.sh [--list] [<worktree>] | --self-test", 1);
  const WT = argv[1] ?? ".";
  if (!existsSync(WT)) die(`verify-library: no such directory: ${WT}`, 1);
  process.exit(listOrRun("list", WT));
} else if (argv[0]?.startsWith("-")) {
  die("usage: verify-library.sh [--list] [<worktree>] | --self-test", 1);
} else {
  if (argv.length > 1) die("usage: verify-library.sh [--list] [<worktree>] | --self-test", 1);
  const WT = argv[0] ?? ".";
  if (!existsSync(WT)) die(`verify-library: no such directory: ${WT}`, 1);
  process.exit(listOrRun("run", WT));
}

// --- self-test ---------------------------------------------------------------------------------
withTempDir((tmp) => {
  const SELF = join(dirname(new URL(import.meta.url).pathname), "verify-library.sh");
  const st = new SelfTest();

  function expect(label: string, exit: number, project: string, wantIn?: string): void {
    const r = run("bash", [SELF, join(tmp, project)]);
    const out = r.out + r.err;
    if (r.code === exit && (wantIn === undefined || wantIn === "" || out.includes(wantIn))) {
      st.ok(label);
    } else {
      st.fail(`${label} (exit ${r.code})`, out);
    }
  }

  // A library whose package name resolves to its exports, with tests of every kind the selection
  // must tell apart.
  const lib = join(tmp, "lib");
  mkdirSync(join(lib, "test", "helpers"), { recursive: true });
  mkdirSync(join(lib, "src"), { recursive: true });
  writeFileSync(
    join(lib, "package.json"),
    '{"name": "sample-lib", "version": "1.0.0", "type": "module", "exports": "./src/index.js"}\n',
    "utf8",
  );
  writeFileSync(join(lib, "src", "index.js"), "export const add = (a, b) => a + b;\n", "utf8");
  writeFileSync(
    join(lib, "test", "public.test.js"),
    `import test from "node:test";
import assert from "node:assert";
import { add } from "sample-lib";
test("add, through the package name", () => assert.equal(add(2, 3), 5));
`,
    "utf8",
  );
  writeFileSync(join(lib, "test", "helpers", "two.js"), "export const two = 2;\n", "utf8");
  writeFileSync(
    join(lib, "test", "helped.test.js"),
    `import test from "node:test";
import assert from "node:assert";
import { add } from "sample-lib";
import { two } from "./helpers/two.js";
test("add, with a helper", () => assert.equal(add(two, two), 4));
`,
    "utf8",
  );
  writeFileSync(
    join(lib, "test", "internal.test.js"),
    `import test from "node:test";
import assert from "node:assert";
import { add } from "../src/index.js";
test("add, reached by path", () => assert.equal(add(1, 1), 2));
`,
    "utf8",
  );
  writeFileSync(
    join(lib, "test", "mixed.test.js"),
    `import { add } from "sample-lib";
import { add as inner } from "../src/index.js";
`,
    "utf8",
  );
  writeFileSync(
    join(lib, "test", "helpers", "api.js"),
    `import * as lib from "sample-lib";
export const api = lib;
`,
    "utf8",
  );
  mkdirSync(join(lib, "test", "fixtures", "app"), { recursive: true });
  writeFileSync(
    join(lib, "test", "fixtures", "app", "server.js"),
    `import "sample-lib";
import http from "node:http";
http.createServer().listen(0);
`,
    "utf8",
  );
  writeFileSync(
    join(lib, "test", "no-tests.js"),
    `import { add } from "sample-lib";
export const three = add(1, 2);
`,
    "utf8",
  );
  mkdirSync(join(lib, "test", "utils"), { recursive: true });
  mkdirSync(join(lib, "test", "apps"), { recursive: true });
  writeFileSync(
    join(lib, "test", "utils", "api.js"),
    `import { add } from "sample-lib";
export const digits = (s) => /^[0-9]+$/.test(s);
`,
    "utf8",
  );
  writeFileSync(
    join(lib, "test", "apps", "server.js"),
    `// run it (as a child) from the tests
import "sample-lib";
`,
    "utf8",
  );
  run("git", ["-C", lib, "init", "-q", "-b", "main"]);

  console.log("positive controls");
  {
    const r = run("bash", [SELF, "--list", lib]);
    const list = r.out.trim().split("\n").filter(Boolean).join(" ");
    st.check(
      "only the tests that import it by name and open a line with a test are chosen, not helpers, fixtures, method calls or comments",
      list === "test/helped.test.js test/public.test.js",
      list,
    );
  }
  expect(
    "those tests pass through the package's exports",
    0,
    "lib",
    "the tests through sample-lib's public interface passed",
  );
  // copy lib to built and add a build script
  run("cp", ["-r", lib, join(tmp, "built")]);
  {
    const p = join(tmp, "built", "package.json");
    const j = tryJsonFile<Record<string, unknown>>(p);
    if (j) {
      j.scripts = { build: "touch built.flag" };
      writeFileSync(p, JSON.stringify(j), "utf8");
    }
  }
  expect("a build script runs first", 0, "built", "passed");
  st.check("and it did run", existsSync(join(tmp, "built", "built.flag")));

  console.log("negative controls");
  run("cp", ["-r", lib, join(tmp, "broken")]);
  writeFileSync(
    join(tmp, "broken", "src", "index.js"),
    "export const add = (a, b) => a - b;\n",
    "utf8",
  );
  expect("a library that breaks its interface fails", 1, "broken", "failed");

  run("cp", ["-r", lib, join(tmp, "badbuild")]);
  {
    const p = join(tmp, "badbuild", "package.json");
    const j = tryJsonFile<Record<string, unknown>>(p);
    if (j) {
      j.scripts = { build: "exit 5" };
      writeFileSync(p, JSON.stringify(j), "utf8");
    }
  }
  expect("a failed build fails", 1, "badbuild", "the build failed");

  mkdirSync(join(tmp, "internal", "test"), { recursive: true });
  run("cp", [join(lib, "package.json"), join(tmp, "internal")]);
  run("cp", ["-r", join(lib, "src"), join(tmp, "internal")]);
  run("cp", [join(lib, "test", "internal.test.js"), join(tmp, "internal", "test")]);
  expect(
    "a library tested only by path is not run",
    3,
    "internal",
    "no test imports sample-lib by its name",
  );

  mkdirSync(join(tmp, "noname"), { recursive: true });
  writeFileSync(join(tmp, "noname", "package.json"), '{"version": "1.0.0"}\n', "utf8");
  expect("a package with no name is not run", 3, "noname", "has no name");

  mkdirSync(join(tmp, "nopkg"), { recursive: true });
  expect("a project with no package.json is not run", 3, "nopkg", "no package.json");

  run("cp", ["-r", lib, join(tmp, "vitest")]);
  {
    const p = join(tmp, "vitest", "package.json");
    const j = tryJsonFile<Record<string, unknown>>(p);
    if (j) {
      j.devDependencies = { vitest: "1" };
      writeFileSync(p, JSON.stringify(j), "utf8");
    }
  }
  expect(
    "a runner the project names but has not installed is not run",
    3,
    "vitest",
    "which is not installed",
  );

  mkdirSync(join(tmp, "helperonly", "test", "helpers"), { recursive: true });
  mkdirSync(join(tmp, "helperonly", "src"), { recursive: true });
  run("cp", [join(lib, "package.json"), join(tmp, "helperonly")]);
  run("cp", [join(lib, "src", "index.js"), join(tmp, "helperonly", "src")]);
  run("cp", [join(lib, "test", "helpers", "api.js"), join(tmp, "helperonly", "test", "helpers")]);
  run("cp", [join(lib, "test", "internal.test.js"), join(tmp, "helperonly", "test")]);
  expect(
    "a library whose only by-name import is in a helper is not run",
    3,
    "helperonly",
    "no test imports sample-lib by its name",
  );

  mkdirSync(join(tmp, "fewtools"), { recursive: true });
  for (const t of ["bash", "bun", "dirname", "git"]) {
    const found = findOnPath(t, process.env.PATH || "");
    if (found) {
      try {
        symlinkSync(found, join(tmp, "fewtools", t));
      } catch {
        /* already exists */
      }
    }
  }
  {
    const r = run("bash", [SELF, lib], {
      env: { ...process.env, PATH: join(tmp, "fewtools") },
    });
    const out = r.out + r.err;
    st.check(
      "tests with no node to run them are not run",
      r.code === 3 && out.includes("node is not on PATH"),
      `exit ${r.code}\n${out}`,
    );
  }

  st.finish();
});
