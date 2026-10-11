import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { flagSource, inScope, locate, modulesUnder, placesIn, tokenize } from "./purity-check.ts";
import { readFileSync } from "node:fs";

const rules = (src: string): string[] => flagSource(src).map((f) => f.rule);

describe("what is code and what is not", () => {
  test("a name in a comment, a string, a template's text or a regular expression is not read", () => {
    const src = [
      "// process.env Date.now() new Date()",
      "/* import fs from 'node:fs'; Bun.file */",
      'const a = "process.env";',
      "const b = 'Date.now()';",
      "const c = `process.env ${1 + 1} Bun.spawn`;",
      "const d = /process\\.env|[\"']node:fs[\"']/u;",
    ].join("\n");
    expect(rules(src)).toEqual([]);
  });

  test("code after a division, after a regular expression and inside a template is still read", () => {
    expect(rules("const x = (a + b) / 2 + Date.now();")).toEqual(["Date.now"]);
    expect(rules("const y = /[\"']/u.test(process.env.A);")).toEqual(["process.env"]);
    expect(rules("const z = `${`${Date.now()}`}`;")).toEqual(["Date.now"]);
  });

  test("a property of another object is not the global", () => {
    expect(
      rules("const a = config.process.env; const b = x?.Date.now; const c = { env: 1 };"),
    ).toEqual([]);
  });

  test("a spread of the environment is read", () => {
    expect(rules("const e = { ...process.env };")).toEqual(["process.env"]);
  });

  test("new Date is flagged only with no argument", () => {
    expect(rules("new Date(); new Date; new Date(0); new Date(ts); new Date(2026, 9, 9);")).toEqual(
      ["new Date()", "new Date()"],
    );
  });

  test("an import declaration is one place, whatever its length", () => {
    const flags = flagSource('import {\n  a,\n  b,\n} from "node:fs";\nimport "node:os";\n');
    expect(flags.map((f) => f.rule)).toEqual(["import:fs", "import:os"]);
  });

  test("a type-only import is flagged and marked", () => {
    const [flag] = flagSource('import type { Stats } from "node:fs";');
    expect(flag?.typeOnly).toBe(true);
  });

  test("tokens carry offsets that locate to a line and column", () => {
    const src = "a\nbb\nccc";
    const t = tokenize(src);
    const starts = [0, 2, 5];
    expect(t.map((x) => locate(starts, x.pos))).toEqual([
      { line: 1, col: 1 },
      { line: 2, col: 1 },
      { line: 3, col: 1 },
    ]);
  });
});

describe("the scope", () => {
  test("lib modules and *-core.ts modules are in; tests and other scripts are out", () => {
    const core = (p: string) => inScope(p, "core");
    expect(core("scripts/lib/proc.ts")).toBe(true);
    expect(core("scripts/scrub-core.ts")).toBe(true);
    expect(core("scripts/lib/proc.test.ts")).toBe(false);
    expect(core("scripts/scrub-core.test.ts")).toBe(false);
    expect(core("scripts/aftercare.ts")).toBe(false);
    expect(core("lint/plugin.ts")).toBe(false);
    expect(inScope("scripts/aftercare.ts", "all")).toBe(true);
    expect(inScope("scripts/aftercare.test.ts", "all")).toBe(false);
  });
});

const control = (name: string, scope: "core" | "all"): number => {
  const root = join(import.meta.dir, "..", "controls", name);
  return modulesUnder(root, scope).reduce(
    (sum, path) => sum + placesIn(path, readFileSync(join(root, path), "utf8")).length,
    0,
  );
};

describe("the controls of D2 and the scanner", () => {
  test("the helper with the three effects reads 3, with the three passed in 0", () => {
    expect(control("effectful", "core")).toBe(3);
    expect(control("injected", "core")).toBe(0);
  });

  test("a script outside the scope reads 0, and 1 once the scope is every script", () => {
    expect(control("outside", "core")).toBe(0);
    expect(control("outside", "all")).toBe(1);
  });

  test("the name part of the scope: a *-core.ts module is read, the same lines elsewhere are not", () => {
    expect(control("core-named", "core")).toBe(1);
    expect(control("core-named", "all")).toBe(2);
  });

  test("every rule once and the forms around it: 30 places", () => {
    expect(control("every-rule", "core")).toBe(30);
  });

  test("the names the rules look for, where they are not code that reaches anything: 0", () => {
    expect(control("not-flagged", "core")).toBe(0);
    expect(control("not-flagged", "all")).toBe(0);
  });

  test("other ambient and effect names are not in the check: 0", () => {
    expect(control("other-names", "all")).toBe(0);
  });
});
