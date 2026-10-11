import { expect, test } from "bun:test";
import { covering, unscopedBiome, unscopedOxlint } from "./lint-compare.ts";

const report = (path: string, line: number) => ({ tool: "t", path, line, rule: "r" });

test("a report covers a place when it is in the same file within the declaration's lines", () => {
  const place = { path: "a.ts", line: 9, endLine: 12 };
  expect(covering(place, [report("a.ts", 12), report("a.ts", 13), report("b.ts", 10)])).toEqual([
    report("a.ts", 12),
  ]);
});

test("the unscoped configurations carry the first override's rules at the top", () => {
  expect(
    unscopedOxlint({
      categories: {},
      overrides: [{ plugins: ["node"], rules: { x: "error" } }, {}],
    }),
  ).toEqual({ categories: {}, plugins: ["node"], rules: { x: "error" } });
  const biome = unscopedBiome({
    linter: { enabled: true, rules: { recommended: false } },
    overrides: [{ plugins: ["p"], linter: { rules: { style: { y: "error" } } } }],
  });
  expect(biome.overrides).toEqual([]);
  expect(biome.plugins).toEqual(["p"]);
  expect(biome.linter.rules).toEqual({ recommended: false, style: { y: "error" } });
});
