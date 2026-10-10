// Oracle for #232, committed before the change: an Oxlint warning fails the
// gate (C1), the tree carries no warning (C2), and nothing is silenced to get
// there — no rule turned off, no path left out (C3). Each test drives the
// gate's own Oxlint step as a subprocess, never importing the change.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BASE_IGNORE_PATTERNS,
  BASE_OFF_RULES,
  CLEAN_SRC,
  ESCAPE_SRC,
  findingLines,
  printConfigRules,
  readOxConfig,
  runOxlintStep,
  STARTS_WITH_SRC,
  UNUSED_SRC,
} from "./acceptance-232.ts";

function writeScratch(dir: string, name: string, src: string): string {
  const path = join(dir, name);
  writeFileSync(path, src);
  return path;
}

function withScratch(body: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "acceptance-232-"));
  try {
    body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("C1: a warning fails the gate's Oxlint step", () => {
  test("an unused variable exits non-zero naming eslint(no-unused-vars)", () => {
    withScratch((dir) => {
      const file = writeScratch(dir, "unused-var.ts", UNUSED_SRC);
      const r = runOxlintStep([file]);
      expect(r.code).not.toBe(0);
      expect(`${r.out}\n${r.err}`).toContain("eslint(no-unused-vars)");
    });
  });

  test("a needless escape exits non-zero naming eslint(no-useless-escape)", () => {
    withScratch((dir) => {
      const file = writeScratch(dir, "needless-escape.ts", ESCAPE_SRC);
      const r = runOxlintStep([file]);
      expect(r.code).not.toBe(0);
      expect(`${r.out}\n${r.err}`).toContain("eslint(no-useless-escape)");
    });
  });

  test("a starts-with regex exits non-zero naming unicorn(prefer-string-starts-ends-with)", () => {
    withScratch((dir) => {
      const file = writeScratch(dir, "starts-with.ts", STARTS_WITH_SRC);
      const r = runOxlintStep([file]);
      expect(r.code).not.toBe(0);
      expect(`${r.out}\n${r.err}`).toContain("unicorn(prefer-string-starts-ends-with)");
    });
  });

  test("a clean file exits 0", () => {
    withScratch((dir) => {
      const file = writeScratch(dir, "clean.ts", CLEAN_SRC);
      const r = runOxlintStep([file]);
      expect(r.code).toBe(0);
      expect(findingLines(`${r.out}\n${r.err}`)).toEqual([]);
    });
  });
});

describe("C2: the tree carries no warning", () => {
  test("the step prints no finding and exits 0", () => {
    const r = runOxlintStep();
    expect(r.code).toBe(0);
    expect(findingLines(`${r.out}\n${r.err}`)).toEqual([]);
  });
});

describe("C3: nothing is silenced instead of fixed", () => {
  test("the config turns off no rule but the base two and leaves out no path", () => {
    const config = readOxConfig();
    expect(Object.keys(config).sort()).toEqual(["$schema", "ignorePatterns", "jsPlugins", "rules"]);
    expect(config.rules["postmaster/test-beside-target"]).toBe("error");
    for (const rule of BASE_OFF_RULES) expect(config.rules[rule]).toBe("off");
    for (const [rule, level] of Object.entries(config.rules)) {
      if (BASE_OFF_RULES.includes(rule)) continue;
      expect(typeof level).toBe("string");
      expect(level).not.toBe("off");
    }
    expect(config.ignorePatterns).toEqual(BASE_IGNORE_PATTERNS);
  });

  test("the pin lists exactly the base two plus the two generated entries", () => {
    const allowed = [
      "fixtures/**",
      "scripts/scrub-check.ts",
      "scripts/raw-promote.ts",
      "scripts/lib/vendor/**",
    ];
    expect(BASE_IGNORE_PATTERNS).toEqual(allowed);
    expect([...allowed, "scripts/extra.ts"]).not.toEqual(BASE_IGNORE_PATTERNS);
  });

  test("effective levels allow nothing but the base two", () => {
    const rules = printConfigRules();
    expect(rules["no-control-regex"]).toBe("allow");
    expect(rules["no-unused-expressions"]).toBe("allow");
    const allowed = Object.entries(rules)
      .filter(([, level]) => level === "allow")
      .map(([rule]) => rule)
      .sort();
    expect(allowed).toEqual([...BASE_OFF_RULES].sort());
  });
});
