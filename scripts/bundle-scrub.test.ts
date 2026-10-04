import { expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runScript } from "./scrub-test-kit.ts";

const BUNDLE = join(import.meta.dir, "scrub-check.ts");

test("bundle check passes on fresh bundles", () => {
  const checked = runScript("bundle-scrub", ["--check"], import.meta.dir);
  expect(checked.status).toBe(0);
  expect(checked.stderr).toBe("");
});

test("bundle check fails when a bundle body is edited under a kept header", () => {
  // Review round 1: --check compared only the header's source hash, so an
  // edited body passed. The tamper is a trailing comment: inert if another
  // test executes the bundle inside the window, and always restored.
  const original = readFileSync(BUNDLE, "utf8");
  try {
    writeFileSync(BUNDLE, `${original}\n// tampered\n`);
    const checked = runScript("bundle-scrub", ["--check"], import.meta.dir);
    expect(checked.status).toBe(1);
    expect(checked.stderr).toContain("is stale");
  } finally {
    writeFileSync(BUNDLE, original);
  }
  const fresh = runScript("bundle-scrub", ["--check"], import.meta.dir);
  expect(fresh.status).toBe(0);
});
