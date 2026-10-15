// Tests beside scripts/code-index.ts. The project here is invented.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { exportsOf, parseArgs, sourceFiles } from "./code-index.ts";

const SELF = join(import.meta.dir, "run");

let tmp = "";
let repo = "";

function put(root: string, rel: string, text = "export const x = 1;\n"): string {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text);
  return abs;
}

beforeAll(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), "code-index-")));
  repo = join(tmp, "repo");
  for (const f of [
    "apps/web/src/a.ts",
    "apps/web/src/a.test.ts",
    "apps/web/src/b.tsx",
    "apps/web/src/b.stories.tsx",
    "apps/web/src/__tests__/c.ts",
    "apps/web/src/__mocks__/m.ts",
    "apps/web/src/types.d.ts",
    "apps/web/src/README.md",
    "apps/web/node_modules/dep/index.ts",
    "apps/web/dist/out.js",
    "packages/one/src/p.ts",
    "packages/two/src/q.ts",
    "packages/three/README.md",
  ]) {
    put(repo, f);
  }
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

interface Out {
  code: number;
  stdout: string;
  err: string;
}

function cli(...args: string[]): Out {
  const r = spawnSync(SELF, ["code-index", ...args], { encoding: "utf8", timeout: 30000 });
  return { code: r.status ?? 1, stdout: String(r.stdout ?? ""), err: String(r.stderr ?? "") };
}

const rowsOf = (text: string): string[][] =>
  text
    .split("\n")
    .filter((l) => l !== "" && !l.startsWith("#"))
    .map((l) => l.split("\t"));

const parsed = (argv: string[]) => {
  const got = parseArgs(argv);
  if (typeof got === "string") throw new Error(got);
  return got;
};

describe("parseArgs", () => {
  test("reads the repo, the folders and the options", () => {
    expect(parsed(["r", "src", "lib", "--max", "5", "--tests", "--out", "o.tsv"])).toEqual({
      repo: resolve("r"),
      folders: ["src", "lib"],
      match: undefined,
      max: 5,
      out: "o.tsv",
      tests: true,
    });
  });

  test("the limit defaults to sixty and tests are left out", () => {
    const got = parsed(["r", "src"]);
    expect(got.max).toBe(60);
    expect(got.tests).toBe(false);
  });

  test("refuses a missing value, an unknown option and a bad limit", () => {
    expect(parseArgs(["r", "src", "--match"])).toBe("--match needs a value");
    expect(parseArgs(["r", "src", "--bogus"])).toBe("unknown option --bogus");
    expect(parseArgs(["r", "src", "--max", "0"])).toBe("--max is a whole number of at least 1");
  });

  test("needs a repo and at least one folder", () => {
    expect(String(parseArgs(["r"]))).toContain("usage: run code-index");
    expect(String(parseArgs([]))).toContain("usage: run code-index");
  });
});

describe("sourceFiles", () => {
  test("lists the source files, not the tests, declarations, dependencies or build output", () => {
    expect(sourceFiles(repo, ["apps/web"], false)).toEqual([
      "apps/web/src/a.ts",
      "apps/web/src/b.tsx",
    ]);
  });

  test("with tests, the test, mock and story files come in too", () => {
    expect(sourceFiles(repo, ["apps/web"], true)).toEqual([
      "apps/web/src/__mocks__/m.ts",
      "apps/web/src/__tests__/c.ts",
      "apps/web/src/a.test.ts",
      "apps/web/src/a.ts",
      "apps/web/src/b.stories.tsx",
      "apps/web/src/b.tsx",
    ]);
  });

  test("takes a glob, a file, and overlapping folders without repeating a file", () => {
    expect(sourceFiles(repo, ["packages/*/src"], false)).toEqual([
      "packages/one/src/p.ts",
      "packages/two/src/q.ts",
    ]);
    expect(sourceFiles(repo, ["apps/web/src/a.ts"], false)).toEqual(["apps/web/src/a.ts"]);
    expect(sourceFiles(repo, ["apps/web", "apps/web/src"], false)).toEqual([
      "apps/web/src/a.ts",
      "apps/web/src/b.tsx",
    ]);
  });

  test("a folder that does not exist has no files", () => {
    expect(sourceFiles(repo, ["nowhere"], false)).toEqual([]);
  });
});

describe("exportsOf", () => {
  const SOURCE = [
    "/** Reads the visitor's saved choice. */",
    "export function readConsent(): string | null { return null; }",
    "// Stores the choice.",
    "// It also tells the analytics service.",
    "export async function saveConsent(choice: string): Promise<void> {}",
    "export const useConsent = () => 1;",
    'export const COOKIE_NAME = "consent";',
    "export const ConsentBanner = () => null;",
    "export class ConsentStore {}",
    'export type ConsentChoice = "yes" | "no";',
    "export interface BannerProps { open: boolean }",
    "export enum Level { Low }",
    "export default function Page() {}",
    'export { a, b as c } from "./x";',
    'export type { T } from "./t";',
    "export {",
    "  d,",
    "  e,",
    '} from "./y";',
    "function notExported() {}",
    "const alsoNot = 1;",
    "",
  ].join("\n");

  const got = exportsOf(SOURCE, "src/consent.tsx");
  const find = (symbol: string) => got.find((e) => e.symbol === symbol);

  test("lists exported functions, constants, classes and types, with the kind", () => {
    expect(find("readConsent")?.kind).toBe("function");
    expect(find("saveConsent")?.kind).toBe("function");
    expect(find("COOKIE_NAME")?.kind).toBe("const");
    expect(find("ConsentStore")?.kind).toBe("class");
    expect(find("ConsentChoice")?.kind).toBe("type");
    expect(find("BannerProps")?.kind).toBe("interface");
    expect(find("Level")?.kind).toBe("enum");
  });

  test("calls a use-name a hook and a capitalised name in a tsx file a component", () => {
    expect(find("useConsent")?.kind).toBe("hook");
    expect(find("ConsentBanner")?.kind).toBe("component");
    expect(find("Page")?.kind).toBe("component");
  });

  test("in a ts file a capitalised function is still a function", () => {
    expect(exportsOf("export function Thing() {}\n", "src/thing.ts")[0]?.kind).toBe("function");
  });

  test("lists what a re-export brings under the name it is exported as", () => {
    for (const name of ["a", "c", "T", "d", "e"]) expect(find(name)?.kind).toBe("re-export");
    expect(find("b")).toBeUndefined();
  });

  test("leaves out what is not exported", () => {
    expect(find("notExported")).toBeUndefined();
    expect(find("alsoNot")).toBeUndefined();
  });

  test("takes the doc from a block comment or a run of // comments, the first sentence", () => {
    expect(find("readConsent")?.doc).toBe("Reads the visitor's saved choice.");
    expect(find("saveConsent")?.doc).toBe("Stores the choice.");
    expect(find("COOKIE_NAME")?.doc).toBe("");
  });

  test("gives the file and the line", () => {
    expect(find("readConsent")?.file).toBe("src/consent.tsx");
    expect(find("readConsent")?.line).toBe(2);
    expect(find("saveConsent")?.line).toBe(5);
  });

  test("a signature is one clipped line", () => {
    expect(find("readConsent")?.signature).toBe(
      "export function readConsent(): string | null { return null; }",
    );
    const long = exportsOf(`export function f(${"argument: string, ".repeat(20)}) {}\n`, "x.ts");
    expect(long[0]?.signature.length).toBeLessThanOrEqual(140);
  });

  test("a file with no exports has none", () => {
    expect(exportsOf("const a = 1;\nfunction b() {}\n", "x.ts")).toEqual([]);
  });
});

describe("the command", () => {
  let project = "";

  beforeAll(() => {
    project = join(tmp, "project");
    put(
      project,
      "src/consent.ts",
      [
        "// Stores the visitor's consent choice in a cookie shared across subdomains.",
        "export function saveConsent(choice: string): void {}",
        "export function readConsent(): string | null { return null; }",
        "",
      ].join("\n"),
    );
    put(
      project,
      "src/format.ts",
      "/** Formats a price in dollars. */\nexport const formatPrice = (n: number): string => `$${n}`;\n",
    );
    put(tmp, "draft.md", "Store the consent choice in a cookie shared across subdomains.\n");
  });

  test("without --match, prints every export", () => {
    const out = cli(project, "src");
    expect(out.code).toBe(0);
    expect(rowsOf(out.stdout).map((r) => r[0])).toEqual([
      "saveConsent",
      "readConsent",
      "formatPrice",
    ]);
    expect(out.stdout).toContain("code-index src (2 source files)");
    expect(out.stdout).not.toContain("draft-vocabulary");
  });

  test("with --match, lists the exports nearest the draft and saves the draft's key", () => {
    const list = join(tmp, "out/list.tsv");
    const out = cli(project, "src", "--match", join(tmp, "draft.md"), "--out", list);
    expect(out.code).toBe(0);
    expect(out.stdout).toContain("code-index: 2 files, 3 exports");
    expect(out.stdout).toContain(`written to ${list}`);
    const text = readFileSync(list, "utf8");
    expect(text).toMatch(/^# draft-vocabulary [0-9a-f]{12}$/mu);
    const symbols = rowsOf(text).map((r) => r[0]);
    expect(symbols).toContain("saveConsent");
    expect(symbols).toContain("readConsent");
    expect(symbols).not.toContain("formatPrice");
    // the map holds every export, whatever the ranking kept
    expect(text).toContain("# every name in the index");
    expect(text).toContain("# src/format.ts");
    expect(text).toContain("#   formatPrice");
    expect(text).toContain("#   saveConsent(), readConsent()");
  });

  test("a folder with no exports is exit 1", () => {
    put(project, "empty/none.ts", "const a = 1;\n");
    const out = cli(project, "empty");
    expect(out.code).toBe(1);
    expect(out.err).toContain("no exports found");
  });

  test("an unreadable draft is exit 2", () => {
    const out = cli(project, "src", "--match", join(tmp, "absent.md"));
    expect(out.code).toBe(2);
    expect(out.err).toContain("cannot read");
  });

  test("usage mistakes are exit 2", () => {
    expect(cli().code).toBe(2);
    expect(cli().err).toContain("usage: run code-index");
    expect(cli(project).code).toBe(2);
    expect(cli(project, "src", "--max", "x").code).toBe(2);
  });
});
