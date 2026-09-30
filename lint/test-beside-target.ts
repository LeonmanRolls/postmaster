import { statSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

type ProgramNode = Readonly<{ type: "Program" }>;
type RuleContext = Readonly<{
  getFilename(): string;
  report(descriptor: Readonly<{ node: ProgramNode; message: string }>): void;
}>;
type Visitor = Readonly<{ Program?: (node: ProgramNode) => void }>;

const TEST_SUFFIX = ".test.ts";
const DISALLOWED_FOLDERS = ["test", "tests", "__tests__"] as const;

// The project root is the rule's own grandparent: this file lives in the project's
// lint folder, loaded from the project's config. The run directory never decides it,
// so the verdict is the same wherever lint starts, and a root named test counts as
// the project, not as a test folder.
const PROJECT_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const testFolder = (filename: string): string | undefined =>
  relative(PROJECT_ROOT, dirname(filename))
    .split(sep)
    .filter(Boolean)
    .find((folder) => DISALLOWED_FOLDERS.includes(folder as (typeof DISALLOWED_FOLDERS)[number]));

const targetPath = (filename: string): string =>
  join(dirname(filename), `${basename(filename).slice(0, -TEST_SUFFIX.length)}.ts`);

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

const testBesideTarget = {
  meta: {
    type: "problem",
    docs: { description: "keep each TypeScript test beside its target" },
    schema: [],
  },
  create(context: RuleContext): Visitor {
    const filename = context.getFilename();
    const testName = basename(filename);
    if (!testName.endsWith(TEST_SUFFIX)) return {};

    const disallowedFolder = testFolder(filename);
    const target = targetPath(filename);
    const problem = disallowedFolder
      ? `Test file ${testName} is inside the ${disallowedFolder} folder; keep it beside its target.`
      : !isFile(target)
        ? `Test file ${testName} has no sibling target ${basename(target)}.`
        : null;
    return problem === null
      ? {}
      : { Program: (node) => context.report({ node, message: problem }) };
  },
} as const;

export { testBesideTarget };
