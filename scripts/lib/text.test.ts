// Tests beside scripts/lib/text.ts, moved from its --self-test on #109: 9 controls.
// The golden cases, tsGolden and the fixture diff stay one control of 35099 cases, as before.
// The golden-case builders stay in the module: the regen note in scripts/fixtures/
// text-goldens.json runs them through run text --dump-golden-cases, so only the controls
// moved. The guard scan walks the same file set with the same exclusion (the module itself),
// plus the generated bundles and the #208 port, which are not hand-written text-port code.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
  digitValue,
  goldenCases,
  INT_NO_CHARS,
  ND_RUNS,
  PLANTED,
  PLANTED_MISS,
  sameValue,
  scanSource,
  tsGolden,
} from "./text.ts";

const scriptsDir = join(import.meta.dir, "..");
const modulePath = join(scriptsDir, "lib", "text.ts");

const collectTargets = (): string[] => {
  const files: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith(".ts")) files.push(p);
    }
  };
  walk(scriptsDir);
  // Generated bundles carry text.ts inside them, and the #208 port carries
  // #208's own classes; neither is hand-written text-port code.
  const excepted = new Set(["scrub-check.ts", "raw-promote.ts", "scrub-patterns.ts"]);
  return files.filter((f) => f !== modulePath && !excepted.has(basename(f)));
};

const goldenCasesBuilt = goldenCases();
const goldenFixture = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "fixtures", "text-goldens.json"), "utf-8"),
) as { python: string; truth: Array<{ ok: boolean; r: unknown }> };
const guardTargets = collectTargets();

describe("goldens", () => {
  test("isdigit table holds its 128 integer-valued others", () => {
    expect([...INT_NO_CHARS].length).toBe(128);
  });

  test("digit runs cover their 73 blocks", () => {
    expect(ND_RUNS.length).toBe(73);
  });

  test("digitValue reads the finding's witness, Garay zero (U+10D40)", () => {
    expect(digitValue("\u{10D40}")).toBe("0");
  });

  test("every Nd the runtime matches is a digit the table values", () => {
    const one = /^\p{Nd}$/u;
    let missing = 0;
    let missingCp = 0;
    for (let cp = 0; cp <= 0x10ffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      one.lastIndex = 0;
      if (!one.test(String.fromCodePoint(cp))) continue;
      let v = -1;
      for (const [first, last] of ND_RUNS) {
        if (cp >= first && cp <= last) {
          v = (cp - first) % 10;
          break;
        }
      }
      if (v < 0) {
        missing += 1;
        missingCp = cp;
      }
    }
    expect([missing, missingCp]).toEqual([0, 0]);
  });

  test(`module goldens vs python3 (${goldenCasesBuilt.length} cases, fixture ${goldenFixture.python})`, () => {
    const cases = goldenCasesBuilt;
    const truth = goldenFixture.truth;
    expect(truth.length).toBe(cases.length);
    const bad: string[] = [];
    for (let i = 0; i < cases.length; i++) {
      const mine = tsGolden(cases[i]!);
      const want = truth[i]!;
      const c = cases[i]!;
      if (c.diverge !== undefined) {
        if (!sameValue(mine.r, c.diverge.ts) || !sameValue(want.r, c.diverge.py)) {
          bad.push(
            `${c.op} ${JSON.stringify(c.s.slice(0, 40))}: intended split drifted: port ${JSON.stringify(mine.r)} (want ${JSON.stringify(c.diverge.ts)}) vs py ${JSON.stringify(want.r)} (want ${JSON.stringify(c.diverge.py)})`,
          );
        }
      } else if (mine.ok !== want.ok || !sameValue(mine.r, want.r)) {
        bad.push(
          `${c.op} ${JSON.stringify(c.s.slice(0, 40))}: port ${JSON.stringify(mine.r)} vs py ${JSON.stringify(want.r)}`,
        );
      }
    }
    expect(bad.slice(0, 12)).toEqual([]);
  });
});

describe("guard", () => {
  test(
    "guard: no hand-written \\w \\d \\b \\s or case-op without ASCII: (" +
      `${guardTargets.length} files)`,
    () => {
      const hits = guardTargets.flatMap((f) => scanSource(f, readFileSync(f, "utf-8")));
      expect(hits.slice(0, 30).map((h) => `${h.file}:${h.line}: ${h.kind} ${h.text}`)).toEqual([]);
    },
  );

  test("guard catches its planted failure", () => {
    const got = scanSource("planted.ts", PLANTED.join("\n")).map((h) => h.line);
    expect(got).toEqual([1, 2, 3, 4, 5, 6, 9]);
  });

  test("guard documents its five known misses", () => {
    const missed = scanSource("planted-miss.ts", PLANTED_MISS.join("\n"));
    expect(missed.map((h) => `${h.line}: ${h.kind} ${h.text}`)).toEqual([]);
  });

  test("guard scanned the port's scripts", () => {
    expect(guardTargets.some((f) => f.endsWith("tool-faults.ts"))).toBe(true);
    expect(guardTargets.length > 5).toBe(true);
  });
});
