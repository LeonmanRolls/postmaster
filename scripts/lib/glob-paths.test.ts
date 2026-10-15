// Tests beside scripts/lib/glob-paths.ts.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expandPattern } from "./glob-paths.ts";

let repo = "";

function put(rel: string, text = "x\n"): void {
  const abs = join(repo, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text);
}

beforeAll(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), "glob-paths-")));
  for (const f of [
    "apps/web/src/a.ts",
    "packages/one/src/p.ts",
    "packages/two/src/q.ts",
    "packages/three/README.md",
  ]) {
    put(f);
  }
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("expandPattern", () => {
  test("a star stands for one folder name", () => {
    expect(expandPattern(repo, "packages/*/src")).toEqual([
      join(repo, "packages/one/src"),
      join(repo, "packages/three/src"),
      join(repo, "packages/two/src"),
    ]);
  });

  test("a pattern with no star is the path itself", () => {
    expect(expandPattern(repo, "apps/web")).toEqual([join(repo, "apps/web")]);
  });

  test("a star matches part of a name", () => {
    expect(expandPattern(repo, "packages/t*")).toEqual([
      join(repo, "packages/three"),
      join(repo, "packages/two"),
    ]);
  });

  test("a star in a folder that does not exist matches nothing", () => {
    expect(expandPattern(repo, "absent/*/src")).toEqual([]);
  });

  test("a star matches files too, and a dot in a pattern is a dot", () => {
    expect(expandPattern(repo, "packages/three/*.md")).toEqual([
      join(repo, "packages/three/README.md"),
    ]);
    // a ? is not a wildcard here: it is a character the name would have to hold
    expect(expandPattern(repo, "packages/three/R*.m?")).toEqual([]);
  });
});
