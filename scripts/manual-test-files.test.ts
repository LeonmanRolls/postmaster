import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run, withTempDir } from "./lib/proc.ts";
import { main, splitFiles, validateFiles } from "./manual-test-files.ts";

const TRACKED = new Set(["ok.test.ts", "other.test.ts", "README.md", "scripts/run"]);

test("split breaks FILES on every whitespace run and drops empties", () => {
  expect(splitFiles("ok.test.ts  other.test.ts\nscripts/run\t")).toEqual([
    "ok.test.ts",
    "other.test.ts",
    "scripts/run",
  ]);
  expect(splitFiles("")).toEqual([]);
  expect(splitFiles("  \n\t ")).toEqual([]);
});

test("validate passes tracked test files through", () => {
  expect(validateFiles(["ok.test.ts", "other.test.ts"], TRACKED)).toEqual([
    "ok.test.ts",
    "other.test.ts",
  ]);
});

test("validate refuses a value with a semicolon", () => {
  expect(() => validateFiles(["ok.test.ts;touch /tmp/pwned"], TRACKED)).toThrow(
    'refusing "ok.test.ts;touch /tmp/pwned": not a tracked file',
  );
});

test("validate refuses a value with command substitution", () => {
  expect(() => validateFiles(["$(touch /tmp/pwned)"], TRACKED)).toThrow(
    'refusing "$(touch /tmp/pwned)": not a tracked file',
  );
});

test("validate refuses a value with backticks", () => {
  expect(() => validateFiles(["`touch /tmp/pwned`"], TRACKED)).toThrow(
    'refusing "`touch /tmp/pwned`": not a tracked file',
  );
});

test("validate refuses the second line a newline smuggles in", () => {
  const entries = splitFiles("ok.test.ts\ntouch /tmp/pwned");
  expect(entries).toEqual(["ok.test.ts", "touch", "/tmp/pwned"]);
  expect(() => validateFiles(entries, TRACKED)).toThrow('refusing "touch": not a tracked file');
});

test("validate refuses a second path that is tracked but not a test file", () => {
  expect(() => validateFiles(["ok.test.ts", "README.md"], TRACKED)).toThrow(
    'refusing "README.md": tracked but not a test file',
  );
});

test("validate refuses a path that climbs out of the repository", () => {
  expect(() => validateFiles(["../evil.test.ts"], TRACKED)).toThrow(
    'refusing "../evil.test.ts": not a tracked file',
  );
  expect(() => validateFiles(["scripts/../ok.test.ts"], TRACKED)).toThrow(
    'refusing "scripts/../ok.test.ts": not a tracked file',
  );
});

test("validate refuses an empty name list", () => {
  expect(() => validateFiles([], TRACKED)).toThrow("FILES names no files");
});

/** A committed repo with one passing test that marks its run, plus a tracked non-test. */
function fixtureRepo(dir: string): void {
  run("git", ["init", "-q", "-b", "main", dir]);
  run("git", ["-C", dir, "config", "user.email", "test@example.com"]);
  run("git", ["-C", dir, "config", "user.name", "test"]);
  writeFileSync(
    join(dir, "ok.test.ts"),
    'import { expect, test } from "bun:test";\n' +
      'import { writeFileSync } from "node:fs";\n' +
      'test("fixture marks its run", () => {\n' +
      '  writeFileSync("RAN", "ran\\n");\n' +
      "  expect(1).toBe(1);\n" +
      "});\n",
  );
  writeFileSync(join(dir, "README.md"), "fixture\n");
  run("git", ["-C", dir, "add", "ok.test.ts", "README.md"]);
  const committed = run("git", ["-C", dir, "commit", "-qm", "fixture"]);
  expect(committed.code).toBe(0);
}

/** Run main with stderr captured; returns the exit code and the captured text. */
function mainQuiet(
  env: Record<string, string | undefined>,
  cwd: string,
): { code: number; err: string } {
  const lines: string[] = [];
  const err = console.error;
  console.error = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    return { code: main(env, cwd), err: lines.join("\n") };
  } finally {
    console.error = err;
  }
}

test("main runs a real tracked test file and reports its result", () => {
  withTempDir((dir) => {
    fixtureRepo(dir);
    const { code, err } = mainQuiet({ FILES: "ok.test.ts" }, dir);
    expect(err).toBe("");
    expect(code).toBe(0);
    expect(existsSync(join(dir, "RAN"))).toBe(true);
  }, "manual-test-files-");
});

test("main refuses an injection and runs nothing", () => {
  withTempDir((dir) => {
    fixtureRepo(dir);
    const { code, err } = mainQuiet({ FILES: "ok.test.ts;`touch MARKER`" }, dir);
    expect(code).toBe(1);
    expect(err).toContain('refusing "ok.test.ts;`touch": not a tracked file');
    expect(existsSync(join(dir, "MARKER"))).toBe(false);
    expect(existsSync(join(dir, "RAN"))).toBe(false);
  }, "manual-test-files-");
});

test("main refuses a missing FILES and a missing repository", () => {
  withTempDir((dir) => {
    fixtureRepo(dir);
    expect(mainQuiet({}, dir).code).toBe(1);
    expect(mainQuiet({ FILES: "   " }, dir).code).toBe(1);
  }, "manual-test-files-");
  withTempDir((dir) => {
    const { code, err } = mainQuiet({ FILES: "ok.test.ts" }, dir);
    expect(code).toBe(1);
    expect(err).toContain("git ls-files failed");
  }, "manual-test-files-");
});

/** Lines of `run:` blocks (block and inline forms) that interpolate the given expressions. */
function findInterpolatedRuns(text: string, exprs: string[]): { line: number; text: string }[] {
  const hits: { line: number; text: string }[] = [];
  const lines = text.split("\n");
  let blockIndent: number | null = null;
  for (const [i, line] of lines.entries()) {
    if (blockIndent !== null) {
      const indent = /^( *)/u.exec(line)?.[1].length ?? 0;
      if (line.trim() === "" || indent > blockIndent) {
        if (exprs.some((e) => line.includes(e))) hits.push({ line: i + 1, text: line.trim() });
        continue;
      }
      blockIndent = null;
    }
    // ASCII: workflow indentation is spaces; GitHub rejects anything else before this runs.
    const m = /^(\s*)(?:-\s+)?run:(.*)$/u.exec(line);
    if (m) {
      const rest = m[2].trim();
      // ASCII: as above; the block header after `run:` is `|` or `>` plus spaces.
      if (/^[|>](\s|$)/u.test(rest)) blockIndent = m[1].length;
      else if (rest !== "" && exprs.some((e) => rest.includes(e)))
        hits.push({ line: i + 1, text: rest });
    }
  }
  return hits;
}

const INTERPOLATIONS = ["${{ inputs.", "${{ github.event."];

test("the guard flags interpolated run blocks and passes the env-bound form", () => {
  const dirty = [
    "      - name: tainted",
    "        run: |",
    '          if [ -n "${{ inputs.files }}" ]; then',
    "            bun test ${{ inputs.files }}",
    "          fi",
    "      - run: echo ${{ github.event.inputs.x }}",
    "      - name: bound",
    "        env:",
    "          FILES: ${{ inputs.files }}",
    '        run: echo "$FILES"',
    "",
  ].join("\n");
  const hits = findInterpolatedRuns(dirty, INTERPOLATIONS);
  expect(hits.map((h) => h.line)).toEqual([3, 4, 6]);
  expect(hits[0]?.text).toContain("${{ inputs.files }}");
});

test("no workflow interpolates dispatch input into a run block", () => {
  const dir = join(import.meta.dir, "..", ".github", "workflows");
  const files = readdirSync(dir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    const hits = findInterpolatedRuns(readFileSync(join(dir, file), "utf-8"), INTERPOLATIONS);
    expect(hits).toEqual([]);
  }
});
