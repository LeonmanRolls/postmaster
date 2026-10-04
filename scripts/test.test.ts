import { describe, expect, test } from "bun:test";
import { runTests } from "./test.ts";

describe("test", () => {
  test("runs Bun's test subcommand directly with the tool config and paths", () => {
    const calls: Array<[string, string[]]> = [];
    const result = runTests(["scripts/wiki-lint.test.ts"], (program, args) => {
      calls.push([program, args]);
      return 0;
    });
    expect(result).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[1]).toEqual([
      "--no-env-file",
      "--config",
      `${import.meta.dir}/bunfig.toml`,
      "test",
      "scripts/wiki-lint.test.ts",
    ]);
  });

  test("requires at least one non-empty test path", () => {
    const errors: string[] = [];
    const previous = process.stderr.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      errors.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      expect(runTests([], () => 0)).toBe(1);
      expect(runTests([""], () => 0)).toBe(1);
    } finally {
      process.stderr.write = previous;
    }
    expect(errors).toEqual([
      "usage: run test <test-file> [<test-file>...]\n",
      "usage: run test <test-file> [<test-file>...]\n",
    ]);
  });
});
