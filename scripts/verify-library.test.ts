// Tests beside scripts/verify-library.ts, moved from its --self-test on #109: 16 controls.
// The self-test built its fixture projects in one shared temp dir between controls; they are
// built here in beforeAll instead, so each test passes alone as well as in file order.
// The spaced-path control re-runs this file with bun test instead of --self-test. It is
// gated by test.skipIf in the nested run.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tryJsonFile } from "./lib/data.ts";
import { run } from "./lib/proc.ts";
import { findOnPath, IMPORT, TEST_CALL } from "./verify-library.ts";

const SELF = join(import.meta.dir, "run");
const spacedDone = process.env.POSTMASTER_SPACED_DONE === "1";

let tmp = "";
let lib = "";

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "postmaster-"));
  lib = join(tmp, "lib");
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
export const digits = (s) => /^[0-9]+$/u.test(s);
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

  run("cp", ["-r", lib, join(tmp, "broken")]);
  writeFileSync(
    join(tmp, "broken", "src", "index.js"),
    "export const add = (a, b) => a - b;\n",
    "utf8",
  );

  run("cp", ["-r", lib, join(tmp, "badbuild")]);
  {
    const p = join(tmp, "badbuild", "package.json");
    const j = tryJsonFile<Record<string, unknown>>(p);
    if (j) {
      j.scripts = { build: "exit 5" };
      writeFileSync(p, JSON.stringify(j), "utf8");
    }
  }

  mkdirSync(join(tmp, "internal", "test"), { recursive: true });
  run("cp", [join(lib, "package.json"), join(tmp, "internal")]);
  run("cp", ["-r", join(lib, "src"), join(tmp, "internal")]);
  run("cp", [join(lib, "test", "internal.test.js"), join(tmp, "internal", "test")]);

  mkdirSync(join(tmp, "noname"), { recursive: true });
  writeFileSync(join(tmp, "noname", "package.json"), '{"version": "1.0.0"}\n', "utf8");

  mkdirSync(join(tmp, "nopkg"), { recursive: true });

  run("cp", ["-r", lib, join(tmp, "vitest")]);
  {
    const p = join(tmp, "vitest", "package.json");
    const j = tryJsonFile<Record<string, unknown>>(p);
    if (j) {
      j.devDependencies = { vitest: "1" };
      writeFileSync(p, JSON.stringify(j), "utf8");
    }
  }

  mkdirSync(join(tmp, "helperonly", "test", "helpers"), { recursive: true });
  mkdirSync(join(tmp, "helperonly", "src"), { recursive: true });
  run("cp", [join(lib, "package.json"), join(tmp, "helperonly")]);
  run("cp", [join(lib, "src", "index.js"), join(tmp, "helperonly", "src")]);
  run("cp", [join(lib, "test", "helpers", "api.js"), join(tmp, "helperonly", "test", "helpers")]);
  run("cp", [join(lib, "test", "internal.test.js"), join(tmp, "helperonly", "test")]);

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
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const runProject = (project: string): { code: number; out: string } => {
  const r = run(SELF, ["verify-library", join(tmp, project)]);
  return { code: r.code, out: r.out + r.err };
};

describe("unicode primitives", () => {
  test("an import needs a word boundary (éfrom is none)", () => {
    const im = [...'x = 1\néfrom "m"\n'.matchAll(IMPORT)].map((m) => m[0]);
    expect(im).toEqual([]);
  });

  test("test-names may hold non-ASCII word chars", () => {
    TEST_CALL.lastIndex = 0;
    expect(TEST_CALL.test('test.ſskip("a")')).toBe(true);
  });

  test("test-calls may indent with U+001F", () => {
    TEST_CALL.lastIndex = 0;
    expect(TEST_CALL.test('\x1f test("a")')).toBe(true);
  });
});

describe("positive controls", () => {
  test("only the tests that import it by name and open a line with a test are chosen, not helpers, fixtures, method calls or comments", () => {
    const r = run(SELF, ["verify-library", "--list", lib]);
    const list = r.out.trim().split("\n").filter(Boolean).join(" ");
    expect(list).toBe("test/helped.test.js test/public.test.js");
  });

  test("those tests pass through the package's exports", () => {
    const r = runProject("lib");
    expect(r.code).toBe(0);
    expect(r.out.includes("the tests through sample-lib's public interface passed")).toBe(true);
  });

  test("a build script runs first", () => {
    const r = runProject("built");
    expect(r.code).toBe(0);
    expect(r.out.includes("passed")).toBe(true);
  });

  test("and it did run", () => {
    expect(existsSync(join(tmp, "built", "built.flag"))).toBe(true);
  });
});

describe("negative controls", () => {
  test("a library that breaks its interface fails", () => {
    const r = runProject("broken");
    expect(r.code).toBe(1);
    expect(r.out.includes("failed")).toBe(true);
  });

  test("a failed build fails", () => {
    const r = runProject("badbuild");
    expect(r.code).toBe(1);
    expect(r.out.includes("the build failed")).toBe(true);
  });

  test("a library tested only by path is not run", () => {
    const r = runProject("internal");
    expect(r.code).toBe(3);
    expect(r.out.includes("no test imports sample-lib by its name")).toBe(true);
  });

  test("a package with no name is not run", () => {
    const r = runProject("noname");
    expect(r.code).toBe(3);
    expect(r.out.includes("has no name")).toBe(true);
  });

  test("a project with no package.json is not run", () => {
    const r = runProject("nopkg");
    expect(r.code).toBe(3);
    expect(r.out.includes("no package.json")).toBe(true);
  });

  test("a runner the project names but has not installed is not run", () => {
    const r = runProject("vitest");
    expect(r.code).toBe(3);
    expect(r.out.includes("which is not installed")).toBe(true);
  });

  test("a library whose only by-name import is in a helper is not run", () => {
    const r = runProject("helperonly");
    expect(r.code).toBe(3);
    expect(r.out.includes("no test imports sample-lib by its name")).toBe(true);
  });

  test("tests with no node to run them are not run", () => {
    const r = run(SELF, ["verify-library", lib], {
      env: { ...process.env, PATH: join(tmp, "fewtools") },
    });
    const out = r.out + r.err;
    expect(r.code).toBe(3);
    expect(out.includes("node is not on PATH")).toBe(true);
  });

  test.skipIf(spacedDone)(
    "the self-test passes from a path with a space",
    () => {
      const spaced = join(tmp, "my dir", "scripts");
      cpSync(import.meta.dir, spaced, { recursive: true });
      cpSync(join(import.meta.dir, "..", "bunfig.toml"), join(spaced, "..", "bunfig.toml"));
      const r = run("bun", ["test", join(spaced, "verify-library.test.ts")], {
        env: { ...process.env, POSTMASTER_SPACED_DONE: "1" },
      });
      expect(r.code).toBe(0);
    },
    180000,
  );
});
