import { describe, expect, test } from "bun:test";
import { addExports, adapterSource, dropNewlineSplit, redactHome } from "./run-laws.ts";

const DECLARED = [
  "type RecordOf<T = unknown> = Record<string, T>;",
  'type Access = "read" | "write" | "refused";',
  'type Place = "inside" | "elsewhere";',
  "interface Touch {",
  "}",
  "interface RunInfo {",
  "}",
  "function expandPath(token: string, cwd: string): string | null {",
  "function isPathToken(token: string, cwd: string): boolean {",
  "function splitShell(source: string): string[] {",
  '    if (quote === "" && (ch === ";" || ch === "\\n" || ch === "|")) {',
  "function shellWords(segment: string): string[] {",
  "function unwrapShell(command: string): string[] {",
  "function commandTouches(",
  "function placeOf(info: RunInfo): string {",
].join("\n");

describe("addExports", () => {
  test("exports the eleven declarations and nothing else", () => {
    const out = addExports(DECLARED);
    expect(out.split("\n").filter((line) => line.startsWith("export ")).length).toBe(11);
    expect(out).toContain("\nfunction placeOf(");
  });
  test("refuses a declaration that is missing", () => {
    expect(() => addExports(DECLARED.replace("function shellWords(", "const shellWords = ("))).toThrow(
      "shellWords",
    );
  });
  test("refuses a declaration that occurs twice", () => {
    expect(() => addExports(`${DECLARED}\nfunction splitShell(again: string) {`)).toThrow("splitShell");
  });
});

describe("dropNewlineSplit", () => {
  test("takes the newline out of the separators once", () => {
    const out = dropNewlineSplit(DECLARED);
    expect(out).toContain('(ch === ";" || ch === "|")');
    expect(out).not.toContain('ch === "\\n" || ');
  });
  test("refuses a source without the separator", () => {
    expect(() => dropNewlineSplit("function splitShell() {}")).toThrow("0 times");
  });
});

test("the adapter re-exports the version's functions and types", () => {
  const out = adapterSource("/v/scripts/reach.ts");
  expect(out).toContain('export { commandTouches, splitShell, shellWords, unwrapShell, expandPath, isPathToken } from "/v/scripts/reach.ts";');
  expect(out).toContain('export type { Access, Place, RecordOf, RunInfo, Touch } from "/v/scripts/reach.ts";');
});

test("the home folder is written as ~", () => {
  expect(redactHome("at /home/u/x and /home/u", "/home/u")).toBe("at ~/x and ~");
});
