// test-beside-target: a test file sits beside its target and is named <name>.test.ts.
//
// A file named <name>.test.ts passes only when <name>.ts sits in the same folder and no
// folder on its path is named test, tests or __tests__. It reads only the file's path and
// whether the sibling file exists. A target without a test is not this rule's concern.

import { existsSync } from "node:fs";
import { join, dirname, basename, sep } from "node:path";

export const RULE_NAME = "test-beside-target";

const SUFFIX = ".test.ts";
const TEST_FOLDERS = new Set(["test", "tests", "__tests__"]);

export type Report = (message: string) => void;

export type Placement = "ok" | "no-target" | "test-folder";

/** Pure classification of a test file's path. The exists check is injected. */
export const placement = (
  filename: string,
  siblingExists: (path: string) => boolean,
): { verdict: Placement; message: string | null } => {
  const base = basename(filename);
  if (!base.endsWith(SUFFIX)) {
    return { verdict: "ok", message: null };
  }
  const name = base.slice(0, -SUFFIX.length);
  const dir = dirname(filename);
  const folders = dir.split(sep).filter((p) => p.length > 0 && p !== ".");
  const inTestFolder = folders.some((p) => TEST_FOLDERS.has(p));
  if (inTestFolder) {
    return {
      verdict: "test-folder",
      message: `${base} sits in a test folder; a test file belongs beside its target, not in ${folders.find((p) => TEST_FOLDERS.has(p))}/`,
    };
  }
  const sibling = join(dir, `${name}.ts`);
  if (!siblingExists(sibling)) {
    return {
      verdict: "no-target",
      message: `${base} has no sibling target ${name}.ts`,
    };
  }
  return { verdict: "ok", message: null };
};

export const testBesideTarget = {
  meta: {
    type: "problem" as const,
    docs: {
      description: "a test file sits beside its target and is named <name>.test.ts",
    },
  },
  create: (context: { physicalFilename: string; report: (d: { message: string; loc: { start: { line: number; column: number } } }) => void }) => {
    const result = placement(context.physicalFilename, existsSync);
    if (result.message !== null) {
      context.report({
        message: result.message,
        loc: { start: { line: 1, column: 0 } },
      });
    }
    return {};
  },
};
