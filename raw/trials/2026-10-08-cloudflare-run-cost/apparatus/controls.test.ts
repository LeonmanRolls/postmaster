import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { load, render, runControls } from "./controls.ts";

const here = new URL(".", import.meta.url).pathname;
const results = join(here, "../results");
const audit = join(here, "../../2026-10-03-lane-audit/results/runs.json");

describe("controls on the committed data", () => {
  const controls = runControls(load(results, audit));

  test("every control passes", () => {
    const failed = controls.filter((c) => !c.pass).map((c) => `${c.id}: ${c.what} (got ${c.got})`);
    expect(failed).toEqual([]);
  });

  test("there are positive and negative controls", () => {
    expect(controls.some((c) => c.kind === "positive")).toBe(true);
    expect(controls.some((c) => c.kind === "negative")).toBe(true);
  });

  test("the rendered table has a row per control", () => {
    const rows = render(controls).split("\n").filter((l) => /^\| C[0-9]+ /u.test(l));
    expect(rows.length).toBe(controls.length);
  });
});
