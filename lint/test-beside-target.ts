import { statSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";

type ProgramNode = Readonly<{ type: "Program" }>;
type RuleContext = Readonly<{
  getFilename(): string;
  getCwd(): string;
  report(descriptor: Readonly<{ node: ProgramNode; message: string }>): void;
}>;
type Visitor = Readonly<{ Program?: (node: ProgramNode) => void }>;

const TEST_SUFFIX = ".test.ts";
const DISALLOWED_FOLDERS = ["test", "tests", "__tests__"] as const;

const testFolder = (filename: string, cwd: string): string | undefined =>
  relative(cwd, dirname(filename))
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

    const disallowedFolder = testFolder(filename, context.getCwd());
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
