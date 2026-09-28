import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
  symlinkSync,
} from "node:fs";
import { basename, dirname, join, normalize, resolve } from "node:path";
import { command, makeTemp, removeTree, scriptDir, writeError, writeOut } from "./lib/core.ts";

const here = scriptDir(import.meta.url);
const wrapper = join(here, "verify-library.sh");
const codeFile = /\.(?:c|m)?(?:j|t)sx?$/;
const testName = /\.(?:test|spec)\.(?:c|m)?(?:j|t)sx?$/;
const testDirs = new Set(["test", "tests", "__tests__"]);
const supportDirs = new Set(["fixtures", "__fixtures__", "helpers", "support", "__mocks__"]);
const importPattern = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(['"])([^'"\n]+)\1/g;
const testCall = /^\s*(?:await\s+)?(?:test|it|describe)(?:\.\w+)*\s*\(/m;
type Result = { code: number; output: string };

function isTest(path: string): boolean {
  const parts = path.split("/");
  if (
    !codeFile.test(path) ||
    parts.includes("node_modules") ||
    parts.slice(0, -1).some((part) => supportDirs.has(part))
  )
    return false;
  return testName.test(path) || parts.slice(0, -1).some((part) => testDirs.has(part));
}
function isHelper(path: string): boolean {
  const parts = path.split("/");
  return isTest(path) || parts.slice(0, -1).some((part) => testDirs.has(part) || supportDirs.has(part));
}
function allFiles(root: string): string[] {
  const output: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry.startsWith(".git")) continue;
      const path = join(dir, entry);
      const info = statSync(path);
      if (info.isDirectory()) walk(path);
      else if (info.isFile()) output.push(path.slice(root.length + 1));
    }
  };
  walk(root);
  return output.sort();
}
function notRun(message: string): Result {
  return { code: 3, output: "not run: " + message + "\n" };
}
function library(mode: "list" | "run", worktree: string): Result {
  const wt = resolve(worktree);
  const packageFile = join(wt, "package.json");
  if (!existsSync(packageFile))
    return notRun(
      "no package.json in " +
        wt +
        "; this default runs a package.json project's tests, so declare the check in .postmaster/project.toml",
    );
  let pkg: any;
  try {
    pkg = JSON.parse(readFileSync(packageFile, "utf8"));
  } catch (error) {
    return notRun("package.json does not parse: " + String(error));
  }
  const name = pkg.name;
  if (typeof name !== "string" || !name)
    return notRun("package.json has no name, so no test can import the library by it");
  const gitFiles = command("git", ["-C", wt, "ls-files", "-co", "--exclude-standard"]);
  const files = gitFiles.code === 0 ? [...new Set(gitFiles.stdout.split("\n").filter(Boolean))].sort() : allFiles(wt);
  const chosen: string[] = [];
  for (const path of files) {
    if (!isTest(path)) continue;
    let source = "";
    try {
      source = readFileSync(join(wt, path), "utf8");
    } catch {
      continue;
    }
    let byName = false;
    let inside = false;
    for (const match of source.matchAll(importPattern)) {
      const spec = match[2]!;
      if (spec === name || spec.startsWith(name + "/")) byName = true;
      else if (spec.startsWith(".")) {
        const target = normalize(join(dirname(path), spec)).replaceAll("\\", "/");
        if (target.startsWith("..") || !isHelper(target)) inside = true;
      }
    }
    if (byName && !inside && testCall.test(source)) chosen.push(path);
  }
  if (mode === "list") return { code: 0, output: chosen.join("\n") + (chosen.length ? "\n" : "") };
  if (!chosen.length) return notRun("no test imports " + name + " by its name and nothing else of its own by path");
  const deps: Record<string, unknown> = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const scripts = pkg.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {};
  const bunLock = existsSync(join(wt, "bun.lock")) || existsSync(join(wt, "bun.lockb"));
  const pm = existsSync(join(wt, "pnpm-lock.yaml"))
    ? "pnpm"
    : bunLock
      ? "bun"
      : existsSync(join(wt, "yarn.lock"))
        ? "yarn"
        : "npm";
  const local = (tool: string): string | null => {
    const path = join(wt, "node_modules/.bin", tool);
    if (!existsSync(path)) return null;
    return path;
  };
  let argv: string[];
  if ("vitest" in deps) {
    const tool = local("vitest");
    if (!tool) return notRun("package.json depends on vitest, which is not installed: run " + pm + " install first");
    argv = [tool, "run", ...chosen];
  } else if ("jest" in deps) {
    const tool = local("jest");
    if (!tool) return notRun("package.json depends on jest, which is not installed: run " + pm + " install first");
    argv = [tool, ...chosen];
  } else if ("mocha" in deps) {
    const tool = local("mocha");
    if (!tool) return notRun("package.json depends on mocha, which is not installed: run " + pm + " install first");
    argv = [tool, ...chosen];
  } else if (bunLock || String(scripts.test ?? "").startsWith("bun ") || "@types/bun" in deps || "bun-types" in deps) {
    if (!hasProgram("bun")) return notRun("the project runs its tests with bun, which is not on PATH");
    argv = ["bun", "test", ...chosen.map((path) => "./" + path)];
  } else {
    if (!hasProgram("node")) return notRun("the tests run with node --test, and node is not on PATH");
    argv = ["node", "--test", ...chosen];
  }
  const output: string[] = [];
  if (scripts.build) {
    if (!hasProgram(pm)) return notRun("package.json has a build script, run through " + pm + ", which is not on PATH");
    const build = command(pm, ["run", "build"], { cwd: wt, input: "" });
    if (build.code !== 0)
      return {
        code: 1,
        output: build.stdout + build.stderr + "the build failed: " + pm + " run build exited " + build.code + "\n",
      };
  }
  output.push("running " + chosen.length + " test file(s) that import " + name + " by name: " + chosen.join(" "));
  const result = command(argv[0]!, argv.slice(1), { cwd: wt, input: "" });
  output.push(result.stdout + result.stderr);
  output.push(
    "the tests through " +
      name +
      "'s public interface " +
      (result.code === 0 ? "passed" : "failed, exit " + result.code),
  );
  return { code: result.code === 0 ? 0 : 1, output: output.join("\n") + "\n" };
}
function hasProgram(name: string, path = process.env.PATH ?? ""): boolean {
  return path.split(":").some((dir) => existsSync(join(dir || ".", name)));
}
function run(args: string[]): number {
  if (args[0] === "--self-test") return args.length === 1 ? selfTest() : usage();
  if (args[0] === "--list") {
    if (args.length > 2) return usage();
    const target = args[1] ?? ".";
    if (!existsSync(target) || !statSync(target).isDirectory()) {
      writeError("verify-library: no such directory: " + target);
      return 1;
    }
    const result = library("list", target);
    process.stdout.write(result.output);
    return result.code;
  }
  if (args[0]?.startsWith("-") || args.length > 1) return usage();
  const target = args[0] ?? ".";
  if (!existsSync(target) || !statSync(target).isDirectory()) {
    writeError("verify-library: no such directory: " + target);
    return 1;
  }
  const result = library("run", target);
  process.stdout.write(result.output);
  return result.code;
}
function usage(): never {
  writeError("usage: verify-library.sh [--list] [<worktree>] | --self-test");
  process.exit(1);
}
function selfTest(): number {
  const tmp = makeTemp("postmaster-verify-library-");
  const lib = join(tmp, "lib");
  let fails = 0;
  const ok = (label: string) => writeOut("  ok   " + label);
  const fail = (label: string, details = "") => {
    writeOut("  FAIL " + label);
    if (details) for (const line of details.split("\n")) writeOut("         " + line);
    fails++;
  };
  const expect = (label: string, code: number, project: string, reason = "") => {
    const r = command(wrapper, [join(tmp, project)]);
    const output = r.stdout + r.stderr;
    if (r.code === code && (!reason || output.includes(reason))) ok(label);
    else fail(label + " (exit " + r.code + ")", output);
  };
  try {
    mkdirSync(join(lib, "test/helpers"), { recursive: true });
    mkdirSync(join(lib, "src"), { recursive: true });
    writeFileSync(
      join(lib, "package.json"),
      '{"name":"sample-lib","version":"1.0.0","type":"module","exports":"./src/index.js"}\n',
    );
    writeFileSync(join(lib, "src/index.js"), "export const add = (a, b) => a + b;\n");
    writeFileSync(
      join(lib, "test/public.test.js"),
      'import test from "node:test";\nimport assert from "node:assert";\nimport { add } from "sample-lib";\ntest("add", () => assert.equal(add(2, 3), 5));\n',
    );
    writeFileSync(join(lib, "test/helpers/two.js"), "export const two = 2;\n");
    writeFileSync(
      join(lib, "test/helped.test.js"),
      'import test from "node:test";\nimport assert from "node:assert";\nimport { add } from "sample-lib";\nimport { two } from "./helpers/two.js";\ntest("helper", () => assert.equal(add(two, two), 4));\n',
    );
    writeFileSync(
      join(lib, "test/internal.test.js"),
      'import test from "node:test";\nimport assert from "node:assert";\nimport { add } from "../src/index.js";\ntest("internal", () => assert.equal(add(1, 1), 2));\n',
    );
    writeFileSync(
      join(lib, "test/mixed.test.js"),
      'import { add } from "sample-lib";\nimport { add as inner } from "../src/index.js";\n',
    );
    writeFileSync(join(lib, "test/helpers/api.js"), 'import * as lib from "sample-lib";\nexport const api = lib;\n');
    mkdirSync(join(lib, "test/fixtures/app"), { recursive: true });
    writeFileSync(
      join(lib, "test/fixtures/app/server.js"),
      'import "sample-lib";\nimport http from "node:http";\nhttp.createServer().listen(0);\n',
    );
    writeFileSync(
      join(lib, "test/no-tests.js"),
      'import { add } from "sample-lib";\nexport const three = add(1, 2);\n',
    );
    mkdirSync(join(lib, "test/utils"), { recursive: true });
    mkdirSync(join(lib, "test/apps"), { recursive: true });
    writeFileSync(
      join(lib, "test/utils/api.js"),
      'import { add } from "sample-lib";\nexport const digits = (s) => /^[0-9]+$/.test(s);\n',
    );
    writeFileSync(join(lib, "test/apps/server.js"), '// child process fixture\nimport "sample-lib";\n');
    command("git", ["init", "-q", "-b", "main", lib]);
    writeOut("positive controls");
    const list = command(wrapper, ["--list", lib]);
    if (list.stdout.trim().replace(/\r?\n/g, " ") === "test/helped.test.js test/public.test.js")
      ok(
        "only the tests that import it by name and open a line with a test are chosen, not helpers, fixtures, method calls or comments",
      );
    else
      fail(
        "only the tests that import it by name and open a line with a test are chosen, not helpers, fixtures, method calls or comments",
        list.stdout,
      );
    expect("those tests pass through the package's exports", 0, "lib", "passed");
    cpSync(lib, join(tmp, "built"), { recursive: true });
    const builtPkg = JSON.parse(readFileSync(join(tmp, "built/package.json"), "utf8"));
    builtPkg.scripts = { build: "touch built.flag" };
    writeFileSync(join(tmp, "built/package.json"), JSON.stringify(builtPkg));
    expect("a build script runs first", 0, "built", "passed");
    if (existsSync(join(tmp, "built/built.flag"))) ok("and it did run");
    else fail("and it did run");
    writeOut("negative controls");
    cpSync(lib, join(tmp, "broken"), { recursive: true });
    writeFileSync(join(tmp, "broken/src/index.js"), "export const add = (a, b) => a - b;\n");
    expect("a library that breaks its interface fails", 1, "broken", "failed");
    cpSync(lib, join(tmp, "badbuild"), { recursive: true });
    const badPkg = JSON.parse(readFileSync(join(tmp, "badbuild/package.json"), "utf8"));
    badPkg.scripts = { build: "exit 5" };
    writeFileSync(join(tmp, "badbuild/package.json"), JSON.stringify(badPkg));
    expect("a failed build fails", 1, "badbuild", "the build failed");
    mkdirSync(join(tmp, "internal/test"), { recursive: true });
    cpSync(join(lib, "package.json"), join(tmp, "internal/package.json"));
    cpSync(join(lib, "src"), join(tmp, "internal/src"), { recursive: true });
    cpSync(join(lib, "test/internal.test.js"), join(tmp, "internal/test/internal.test.js"));
    expect("a library tested only by path is not run", 3, "internal", "no test imports sample-lib by its name");
    mkdirSync(join(tmp, "noname"));
    writeFileSync(join(tmp, "noname/package.json"), '{"version":"1.0.0"}\n');
    expect("a package with no name is not run", 3, "noname", "has no name");
    mkdirSync(join(tmp, "nopkg"));
    expect("a project with no package.json is not run", 3, "nopkg", "no package.json");
    cpSync(lib, join(tmp, "vitest"), { recursive: true });
    const vitestPkg = JSON.parse(readFileSync(join(tmp, "vitest/package.json"), "utf8"));
    vitestPkg.devDependencies = { vitest: "1" };
    writeFileSync(join(tmp, "vitest/package.json"), JSON.stringify(vitestPkg));
    expect("a runner the project names but has not installed is not run", 3, "vitest", "which is not installed");
    mkdirSync(join(tmp, "helperonly/test/helpers"), { recursive: true });
    mkdirSync(join(tmp, "helperonly/src"), { recursive: true });
    cpSync(join(lib, "package.json"), join(tmp, "helperonly/package.json"));
    cpSync(join(lib, "src/index.js"), join(tmp, "helperonly/src/index.js"));
    cpSync(join(lib, "test/helpers/api.js"), join(tmp, "helperonly/test/helpers/api.js"));
    cpSync(join(lib, "test/internal.test.js"), join(tmp, "helperonly/test/internal.test.js"));
    expect(
      "a library whose only by-name import is in a helper is not run",
      3,
      "helperonly",
      "no test imports sample-lib by its name",
    );
    const few = join(tmp, "fewtools");
    mkdirSync(few);
    for (const tool of ["bash", "env", "bun", "git", "dirname"]) {
      const where = command("which", [tool]).stdout.trim();
      if (where) symlinkSync(where, join(few, tool));
    }
    const noNode = command(wrapper, [lib], { env: { PATH: few } });
    if (noNode.code === 3 && (noNode.stdout + noNode.stderr).includes("node is not on PATH"))
      ok("tests with no node to run them are not run");
    else fail("tests with no node to run them are not run (exit " + noNode.code + ")", noNode.stdout + noNode.stderr);
  } finally {
    removeTree(tmp);
  }
  writeOut("");
  writeOut(fails === 0 ? "self-test: all controls behaved" : "self-test: " + fails + " control(s) misbehaved");
  return fails === 0 ? 0 : 1;
}
process.exit(run(process.argv.slice(2)));
