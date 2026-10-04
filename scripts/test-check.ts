import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export type SkipEntry = {
  file: string;
  name: string;
  reason: string;
  systems: string[];
};

type TestCase = {
  file: string;
  name: string;
  skipped: boolean;
  assertions: number | null;
};

export type TestInspection = {
  cases: number;
  skips: Array<{ entry: SkipEntry; system: string }>;
  errors: string[];
};

function xmlDecode(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/giu, (_whole, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&#([0-9]+);/gu, (_whole, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 10)),
    )
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&amp;/gu, "&");
}

function attributes(source: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const match of source.matchAll(/([A-Za-z_:][A-Za-z0-9_.:-]*)="([^"]*)"/gu)) {
    result.set(match[1]!, xmlDecode(match[2]!));
  }
  return result;
}

function testCases(report: string): TestCase[] {
  const cases: TestCase[] = [];
  const pattern = /<testcase(?=[ \t\r\n]|\/)([^>]*?)(?:\/>|>(.*?)<\/testcase>)/gsu;
  for (const match of report.matchAll(pattern)) {
    const attrs = attributes(match[1]!);
    const file = attrs.get("file") ?? "";
    const className = attrs.get("classname") ?? "";
    const testName = attrs.get("name") ?? "";
    const assertionsText = attrs.get("assertions");
    const assertions =
      assertionsText !== undefined && /^[0-9]+$/u.test(assertionsText)
        ? Number(assertionsText)
        : null;
    cases.push({
      file,
      name: className === "" ? testName : `${className} > ${testName}`,
      skipped: /<skipped(?:[ \t\r\n]|\/|>)/u.test(match[2] ?? ""),
      assertions,
    });
  }
  return cases;
}

export function inspectTests(report: string, entries: SkipEntry[], system: string): TestInspection {
  const errors: string[] = [];
  const skips: TestInspection["skips"] = [];
  const byTest = new Map<string, SkipEntry>();
  const key = (file: string, name: string): string => `${file}\0${name}`;

  for (const entry of entries) {
    const file = typeof entry.file === "string" ? entry.file : "";
    const name = typeof entry.name === "string" ? entry.name : "";
    const reason = typeof entry.reason === "string" ? entry.reason : "";
    const id = `${file || "<missing file>"} :: ${name || "<missing full test name>"}`;
    if (file.trim() === "" || name.trim() === "") {
      errors.push(`skip list entry has no file or full test name: ${id}`);
    }
    if (reason.trim() === "") errors.push(`skip list entry has no reason: ${id}`);
    if (!Array.isArray(entry.systems) || entry.systems.length === 0) {
      errors.push(`skip list entry has no systems: ${id}`);
    } else {
      const unknown = entry.systems.filter((value) => value !== "linux" && value !== "darwin");
      if (unknown.length > 0)
        errors.push(`skip list entry has unknown systems (${unknown.join(", ")}): ${id}`);
      if (new Set(entry.systems).size !== entry.systems.length) {
        errors.push(`skip list entry repeats a system: ${id}`);
      }
    }
    if (file.trim() !== "" && name.trim() !== "") {
      const testKey = key(file, name);
      if (byTest.has(testKey)) errors.push(`duplicate skip list entry: ${id}`);
      else byTest.set(testKey, { ...entry, file, name, reason });
    }
  }

  const cases = testCases(report);
  for (const test of cases) {
    const label = `${test.file || "<unknown file>"} :: ${test.name || "<unnamed test>"}`;
    if (test.file === "" || test.name === "") {
      errors.push(`JUnit testcase is missing its file or full test name: ${label}`);
      continue;
    }
    if (test.assertions === 0 && !test.skipped) {
      errors.push(`hidden skip: ${label} passed with zero assertions`);
    }
    if (!test.skipped) continue;
    const entry = byTest.get(key(test.file, test.name));
    if (entry === undefined) {
      errors.push(`unlisted skip on ${system}: ${label}`);
      continue;
    }
    if (!Array.isArray(entry.systems) || !entry.systems.includes(system)) {
      errors.push(`skip list does not allow ${system}: ${label}`);
      continue;
    }
    skips.push({ entry, system });
  }
  return { cases: cases.length, skips, errors };
}

function main(): number {
  const root = dirname(import.meta.dir);
  const skipPath = join(root, "scripts", "test-skips.json");
  const temp = mkdtempSync(join(tmpdir(), "postmaster-junit-"));
  const reportPath = join(temp, "tests.xml");
  try {
    let skipList: { skips?: SkipEntry[] };
    try {
      skipList = JSON.parse(readFileSync(skipPath, "utf8")) as { skips?: SkipEntry[] };
    } catch (error) {
      throw new Error(`cannot read ${skipPath}: ${String(error)}`);
    }
    if (!Array.isArray(skipList.skips)) throw new Error(`${skipPath}: skips must be an array`);
    const result = spawnSync(
      process.execPath,
      ["test", "--reporter=junit", `--reporter-outfile=${reportPath}`, "scripts/", "lint/"],
      { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) throw new Error(`could not start Bun tests: ${result.error.message}`);
    const testExit = result.status ?? 1;
    if (!existsSync(reportPath)) {
      if (testExit !== 0) return testExit;
      throw new Error("Bun tests passed without writing their JUnit report");
    }

    const inspection = inspectTests(
      readFileSync(reportPath, "utf8"),
      skipList.skips,
      process.platform,
    );
    console.log(
      `test skips: ${inspection.cases} cases; ${inspection.skips.length} listed skip(s) on ${process.platform}`,
    );
    for (const { entry, system: skippedOn } of inspection.skips) {
      console.log(`skip ${skippedOn}: ${entry.file} :: ${entry.name} — ${entry.reason}`);
    }
    for (const error of inspection.errors) console.error(`FAIL test skips: ${error}`);
    if (testExit !== 0) return testExit;
    return inspection.errors.length === 0 ? 0 : 1;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

if (import.meta.main) process.exit(main());
