import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Diagnostic = Readonly<{ ruleId: string | null; message: string; filePath: string }>;
type OxlintResult = Readonly<{ exitCode: number; diagnostics: readonly Diagnostic[] }>;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TEMP_ROOT = join(ROOT, "node_modules", ".cache");
const CONFIG = join(ROOT, ".oxlintrc.json");

const makeDirectory = (): string => {
  mkdirSync(TEMP_ROOT, { recursive: true });
  return mkdtempSync(join(TEMP_ROOT, "placement-control-"));
};

const write = (path: string, contents = "export {};\n"): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, "utf8");
};

const runOxlint = (path: string, cwd: string = ROOT, config: string = CONFIG): OxlintResult => {
  const result = Bun.spawnSync(
    [
      process.execPath,
      "x",
      "--bun",
      "oxlint",
      `--config=${config}`,
      "--no-ignore",
      "--format=json",
      path,
    ],
    { cwd, stdout: "pipe", stderr: "pipe" },
  );
  const stdout = new TextDecoder().decode(result.stdout);
  const stderr = new TextDecoder().decode(result.stderr);
  return result.exitCode === 0 || result.exitCode === 1
    ? { exitCode: result.exitCode, diagnostics: parseDiagnostics(stdout) }
    : (() => {
        throw new Error(stderr || stdout || `Oxlint exited ${result.exitCode}`);
      })();
};

const parseDiagnostics = (stdout: string): readonly Diagnostic[] => {
  const report = JSON.parse(stdout) as Readonly<{
    diagnostics: readonly Readonly<{ filename: string; code: string; message: string }>[];
  }>;
  return report.diagnostics.map(({ filename, code, message }) => {
    const [plugin, rule] = code.match(/^([^(]+)\(([^)]+)\)$/)?.slice(1) ?? [code, ""];
    return {
      filePath: filename,
      ruleId: rule ? `${plugin}/${rule}` : plugin,
      message,
    };
  });
};

const withDirectory = (run: (directory: string) => void): void => {
  const directory = makeDirectory();
  try {
    run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

const relativeDiagnostic = (diagnostic: Diagnostic, from: string = ROOT): Diagnostic => ({
  ...diagnostic,
  filePath: relative(
    from,
    isAbsolute(diagnostic.filePath) ? diagnostic.filePath : resolve(from, diagnostic.filePath),
  ),
});

test("a test file beside its target passes with no problem", () =>
  withDirectory((directory) => {
    const target = join(directory, "nearby.ts");
    const testFile = join(directory, "nearby.test.ts");
    write(target);
    write(testFile);

    expect(runOxlint(testFile)).toEqual({ exitCode: 0, diagnostics: [] });
  }));

test("a test file without a sibling target fails with one named problem", () =>
  withDirectory((directory) => {
    const testFile = join(directory, "missing.test.ts");
    write(testFile);

    expect(runOxlint(testFile)).toEqual({
      exitCode: 1,
      diagnostics: [
        relativeDiagnostic({
          filePath: testFile,
          ruleId: "postmaster/test-beside-target",
          message: "Test file missing.test.ts has no sibling target missing.ts.",
        }),
      ],
    });
  }));

test("a directory named like the target does not count as a sibling file", () =>
  withDirectory((directory) => {
    const testFile = join(directory, "folder.test.ts");
    mkdirSync(join(directory, "folder.ts"));
    write(testFile);

    expect(runOxlint(testFile)).toEqual({
      exitCode: 1,
      diagnostics: [
        relativeDiagnostic({
          filePath: testFile,
          ruleId: "postmaster/test-beside-target",
          message: "Test file folder.test.ts has no sibling target folder.ts.",
        }),
      ],
    });
  }));

test("a test file inside a test folder fails with one named problem", () =>
  withDirectory((directory) => {
    const testFile = join(directory, "test", "nested.test.ts");
    write(join(directory, "test", "nested.ts"));
    write(testFile);

    expect(runOxlint(testFile)).toEqual({
      exitCode: 1,
      diagnostics: [
        relativeDiagnostic({
          filePath: testFile,
          ruleId: "postmaster/test-beside-target",
          message: "Test file nested.test.ts is inside the test folder; keep it beside its target.",
        }),
      ],
    });
  }));

test("a test file still fails when the run starts inside its own test folder", () =>
  withDirectory((directory) => {
    const testDir = join(directory, "test");
    const testFile = join(testDir, "nested.test.ts");
    write(join(testDir, "nested.ts"));
    write(testFile);

    expect(runOxlint(testFile, testDir)).toEqual({
      exitCode: 1,
      diagnostics: [
        relativeDiagnostic(
          {
            filePath: testFile,
            ruleId: "postmaster/test-beside-target",
            message:
              "Test file nested.test.ts is inside the test folder; keep it beside its target.",
          },
          testDir,
        ),
      ],
    });
  }));

test("a test file still fails when the run starts two levels inside its test tree", () =>
  withDirectory((directory) => {
    const unitDir = join(directory, "test", "unit");
    const testFile = join(unitDir, "nested.test.ts");
    write(join(unitDir, "nested.ts"));
    write(testFile);

    expect(runOxlint(testFile, unitDir)).toEqual({
      exitCode: 1,
      diagnostics: [
        relativeDiagnostic(
          {
            filePath: testFile,
            ruleId: "postmaster/test-beside-target",
            message:
              "Test file nested.test.ts is inside the test folder; keep it beside its target.",
          },
          unitDir,
        ),
      ],
    });
  }));

test("a test beside its target passes in a project whose root is named test", () =>
  withDirectory((directory) => {
    const projectRoot = join(directory, "test");
    const lintDir = join(projectRoot, "lint");
    const testFile = join(projectRoot, "nearby.test.ts");
    write(join(lintDir, "plugin.ts"), readFileSync(join(ROOT, "lint", "plugin.ts"), "utf8"));
    write(
      join(lintDir, "test-beside-target.ts"),
      readFileSync(join(ROOT, "lint", "test-beside-target.ts"), "utf8"),
    );
    write(
      join(projectRoot, ".oxlintrc.json"),
      JSON.stringify({
        jsPlugins: ["./lint/plugin.ts"],
        rules: { "postmaster/test-beside-target": "error" },
      }),
    );
    write(join(projectRoot, "nearby.ts"));
    write(testFile);

    expect(runOxlint(testFile, projectRoot, join(projectRoot, ".oxlintrc.json"))).toEqual({
      exitCode: 0,
      diagnostics: [],
    });
  }));
