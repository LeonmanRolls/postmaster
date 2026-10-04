// The suite's skips and its hidden skips, checked over Bun's own JUnit report. This runs
// the suite where `bun run check` would, in a temporary folder (the report carries this
// machine's host name, so it never lands in the repository), then holds every skipped
// test against scripts/skips.toml: one entry per skip, with its reason and the systems it
// skips on. A test that passes with no assertions is a hidden skip and fails here too.
//
//   run skip-check
//
//   exit 0  the suite passed and every skip is listed for this system
//   exit 1  the suite failed, a skip is unlisted or wrongly listed, an entry is broken,
//           or a test passed without checking anything
//   exit 2  usage
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseTomlText } from "./lib/data.ts";
import { scriptsDir } from "./lib/paths.ts";

const HERE = scriptsDir(import.meta);
const TOOL = join(HERE, "..");
const LIST = join(HERE, "skips.toml");
const SYSTEMS = ["linux", "darwin"] as const;

export interface SkipEntry {
  file: string;
  name: string;
  reason: string;
  systems: string[];
}

/** One parsed `<testcase>`: its identity, how many expectations it ran, and what the
 * report says about it. */
export interface TestCase {
  file: string;
  name: string;
  classname: string;
  assertions: string | null;
  skipped: boolean;
  failed: boolean;
}

/** The full name as the skip list writes it: describes outermost first, then the test. */
export function fullName(tc: { name: string; classname: string }): string {
  const chain = tc.classname === "" ? [] : tc.classname.split(" > ").reverse();
  return [...chain, tc.name].join(" > ");
}

function entryKey(file: string, name: string): string {
  return JSON.stringify([file, name]);
}

/** The list's faults, one per broken entry: an entry that cannot match a skip honestly
 * fails whether or not its skip fires here. */
export function parseSkipList(text: string): { entries: SkipEntry[]; faults: string[] } {
  const faults: string[] = [];
  let table: Record<string, unknown>;
  try {
    table = parseTomlText(text) as Record<string, unknown>;
  } catch (e) {
    return { entries: [], faults: [`skips.toml does not parse: ${(e as Error).message}`] };
  }
  const rows = table["skip"];
  if (rows === undefined) return { entries: [], faults: [] };
  if (!Array.isArray(rows)) {
    return { entries: [], faults: ["skips.toml: skip must be [[skip]] tables"] };
  }
  const entries: SkipEntry[] = [];
  const seen = new Set<string>();
  for (const [i, row] of rows.entries()) {
    const at = `skips.toml [[skip #${i + 1}]]`;
    if (row === null || typeof row !== "object" || Array.isArray(row)) {
      faults.push(`${at}: each entry is a table`);
      continue;
    }
    const r = row as Record<string, unknown>;
    const file = typeof r["file"] === "string" ? r["file"].trim() : "";
    const name = typeof r["name"] === "string" ? r["name"].trim() : "";
    const reason = typeof r["reason"] === "string" ? r["reason"].trim() : "";
    const systemsRaw = r["systems"];
    if (file === "" || name === "") faults.push(`${at}: file and name are the test it lists`);
    if (reason === "") {
      const which = file !== "" && name !== "" ? ` (${file}: ${name})` : "";
      faults.push(`${at}${which}: reason is empty`);
    }
    if (!Array.isArray(systemsRaw) || systemsRaw.length === 0) {
      faults.push(`${at}: systems names linux, darwin or both`);
    } else {
      for (const s of systemsRaw) {
        if (typeof s !== "string" || !(SYSTEMS as readonly string[]).includes(s)) {
          faults.push(`${at}: unknown system ${JSON.stringify(s)}`);
          break;
        }
      }
    }
    const key = entryKey(file, name);
    if (seen.has(key)) faults.push(`${at}: listed twice: ${file}: ${name}`);
    seen.add(key);
    if (
      file !== "" &&
      name !== "" &&
      reason !== "" &&
      Array.isArray(systemsRaw) &&
      systemsRaw.length > 0
    ) {
      entries.push({
        file,
        name,
        reason,
        systems: systemsRaw.filter((s): s is string => typeof s === "string"),
      });
    }
  }
  return { entries, faults };
}

// ASCII: the JUnit shape is the reporter's own ASCII markup.
const TESTCASE_RE = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/gu;
const ATTR_RE = /([A-Za-z]+)="([^"]*)"/gu;

function decode(s: string): string {
  return (
    s
      .replace(/&lt;/gu, "<")
      .replace(/&gt;/gu, ">")
      .replace(/&quot;/gu, '"')
      .replace(/&apos;/gu, "'")
      .replace(/&#10;/gu, "\n")
      .replace(/&#13;/gu, "\r")
      .replace(/&#9;/gu, "\t")
      // ASCII: numeric character references name ASCII codes and code points.
      .replace(/&#(\d+);/gu, (_m, d: string) => String.fromCodePoint(Number(d)))
      .replace(/&amp;/gu, "&")
  );
}

/** Every `<testcase>` in the report, in file order. */
export function parseReport(xml: string): TestCase[] {
  const out: TestCase[] = [];
  for (const m of xml.matchAll(TESTCASE_RE)) {
    const attrs: Record<string, string> = {};
    for (const a of (m[1] ?? "").matchAll(ATTR_RE)) attrs[a[1]!] = decode(a[2] ?? "");
    const body = m[2] ?? "";
    out.push({
      file: attrs["file"] ?? "",
      name: attrs["name"] ?? "",
      classname: attrs["classname"] ?? "",
      assertions: attrs["assertions"] ?? null,
      skipped: body.includes("<skipped"),
      failed: body.includes("<failure") || body.includes("<error"),
    });
  }
  return out;
}

export interface ReportCheck {
  faults: string[];
  matched: Array<{ file: string; name: string; reason: string; system: string }>;
  tests: number;
  skipped: number;
  vacuous: number;
}

/** The report against the list: every observed skip listed for this system, every entry
 * intact and present in the report, every pass that checked something. */
export function checkReport(xml: string, entries: SkipEntry[], system: string): ReportCheck {
  const faults: string[] = [];
  const matched: ReportCheck["matched"] = [];
  const cases = parseReport(xml);
  const byKey = new Map(entries.map((e) => [entryKey(e.file, e.name), e]));
  let skipped = 0;
  let vacuous = 0;
  for (const tc of cases) {
    const name = fullName(tc);
    if (tc.skipped) {
      skipped++;
      const entry = byKey.get(entryKey(tc.file, name));
      if (entry === undefined) {
        faults.push(`unlisted skip: ${tc.file}: ${name}`);
        continue;
      }
      if (!entry.systems.includes(system)) {
        faults.push(
          `wrong system: ${tc.file}: ${name} is listed for ${entry.systems.join(" and ")}, not ${system}`,
        );
        continue;
      }
      matched.push({ file: tc.file, name, reason: entry.reason, system });
      continue;
    }
    if (!tc.failed && tc.assertions === "0") {
      vacuous++;
      faults.push(`passes without checking anything: ${tc.file}: ${name}`);
    }
  }
  const present = new Set(cases.map((tc) => entryKey(tc.file, fullName(tc))));
  for (const e of entries) {
    if (!present.has(entryKey(e.file, e.name))) {
      faults.push(`stale entry: ${e.file}: ${e.name} is not in the report`);
    }
  }
  return { faults, matched, tests: cases.length, skipped, vacuous };
}

function main(argv: string[]): number {
  if (argv.length !== 0) {
    console.error("usage: run skip-check");
    return 2;
  }
  const reportDir = mkdtempSync(join(tmpdir(), "postmaster-skip-"));
  const report = join(reportDir, "report.xml");
  // Inherited stdio: the suite's own output still streams while it runs.
  const suite = spawnSync(
    "bun",
    ["test", "scripts/", "lint/", "--reporter=junit", `--reporter-outfile=${report}`],
    { cwd: TOOL, stdio: "inherit" },
  );
  const suiteCode = suite.status;
  let xml: string;
  try {
    xml = readFileSync(report, "utf-8");
  } catch {
    console.error(`skip-check: no report at ${report}; the suite exited ${suiteCode}`);
    return 1;
  }
  const list = parseSkipList(readFileSync(LIST, "utf-8"));
  const system = process.platform;
  const res = checkReport(xml, list.entries, system);
  const faults = [...list.faults, ...res.faults];
  console.log(
    `skip-check: ${res.tests} tests, ${res.skipped} skipped, ${res.vacuous} passed without checking`,
  );
  for (const m of res.matched) {
    console.log(`skip: ${m.file}: ${m.name} (${m.reason}) [${m.system}]`);
  }
  if (res.skipped === 0) console.log("skip-check: no test skipped on this system");
  for (const f of faults) console.error(`skip-check: ${f}`);
  // The report carries this machine's host name: it stays in the temporary folder only.
  try {
    rmSync(reportDir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
  if (suiteCode !== 0) {
    console.error(`skip-check: the suite exited ${suiteCode}`);
    return 1;
  }
  return faults.length > 0 ? 1 : 0;
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
