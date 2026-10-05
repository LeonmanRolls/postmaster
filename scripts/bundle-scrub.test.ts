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

test("bundle check fails when the header's second line is replaced", () => {
  // Review round 4: the body digest started below the second header line, so
  // code placed there passed --check. The tamper is a comment: inert if
  // another test executes the bundle inside the window, and always restored.
  const original = readFileSync(BUNDLE, "utf8");
  try {
    const lines = original.split("\n");
    const at = lines[0]?.startsWith("#!") ? 1 : 0;
    lines[at + 1] = "// tampered second header line";
    writeFileSync(BUNDLE, lines.join("\n"));
    const checked = runScript("bundle-scrub", ["--check"], import.meta.dir);
    expect(checked.status).toBe(1);
    expect(checked.stderr).toContain("is stale");
  } finally {
    writeFileSync(BUNDLE, original);
  }
  const fresh = runScript("bundle-scrub", ["--check"], import.meta.dir);
  expect(fresh.status).toBe(0);
});

test("bundle check fails when code trails the header's first line", () => {
  // Review round 4: the header pattern had no end anchor, so trailing code
  // on the GENERATED line passed --check. The tamper is a trailing comment:
  // inert if another test executes the bundle inside the window, and always
  // restored.
  const original = readFileSync(BUNDLE, "utf8");
  try {
    const lines = original.split("\n");
    const at = lines[0]?.startsWith("#!") ? 1 : 0;
    lines[at] = `${lines[at]} // tampered`;
    writeFileSync(BUNDLE, lines.join("\n"));
    const checked = runScript("bundle-scrub", ["--check"], import.meta.dir);
    expect(checked.status).toBe(1);
    expect(checked.stderr).toContain("is stale");
  } finally {
    writeFileSync(BUNDLE, original);
  }
  const fresh = runScript("bundle-scrub", ["--check"], import.meta.dir);
  expect(fresh.status).toBe(0);
});
