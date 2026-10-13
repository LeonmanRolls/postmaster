import { describe, expect, test } from "bun:test";
import { changeSize } from "./analysis.ts";

const commit = (
  phase: string,
  onMain: boolean,
  added: number,
  deleted: number,
  paths: string[],
) => ({
  phase,
  onMain,
  added,
  deleted,
  paths,
});

describe("changeSize", () => {
  test("counts the lines and distinct files of the change commits off main", () => {
    const size = changeSize([
      commit("change", false, 100, 20, ["a.ts", "b.ts"]),
      commit("change", false, 10, 0, ["a.ts"]),
      commit("fix1", false, 5, 5, ["c.ts"]),
      commit("change", true, 900, 0, ["d.ts"]),
    ]);
    expect(size).toEqual({ lines: 130, files: 2 });
  });
  test("is unknown where no change commit could be traced, not zero", () => {
    expect(changeSize([])).toBeNull();
    expect(changeSize([commit("fix1", false, 5, 5, ["c.ts"])])).toBeNull();
    expect(changeSize([commit("change", true, 50, 0, ["a.ts"])])).toBeNull();
  });
});
