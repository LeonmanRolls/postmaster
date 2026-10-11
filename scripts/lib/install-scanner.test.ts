// Tests beside scripts/lib/install-scanner.ts: the recorded verdict the
// scanner answers from under POSTMASTER_SCAN_FIXTURE. The live Socket path
// and the install behavior sit in the #425 oracle.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordedScan } from "./install-scanner.ts";

const PACKAGES = [{ name: "left-pad", version: "1.3.0" }];

function verdictDir(): string {
  return mkdtempSync(join(tmpdir(), "postmaster-install-scanner-"));
}

describe("recordedScan", () => {
  test("an error verdict throws as an unreachable scanner", () => {
    const dir = verdictDir();
    try {
      const path = join(dir, "verdict.json");
      writeFileSync(path, JSON.stringify({ error: "socket unreachable" }));
      expect(() => recordedScan(path, PACKAGES)).toThrow("socket unreachable");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a matching advisory is returned", () => {
    const dir = verdictDir();
    try {
      const path = join(dir, "verdict.json");
      writeFileSync(
        join(dir, "verdict.json"),
        JSON.stringify({
          advisories: {
            "left-pad@1.3.0": [
              {
                level: "fatal",
                package: "left-pad",
                url: "https://example.invalid/left-pad",
                description: "left-pad is flagged",
              },
            ],
          },
        }),
      );
      expect(recordedScan(path, PACKAGES)).toEqual([
        {
          level: "fatal",
          package: "left-pad",
          url: "https://example.invalid/left-pad",
          description: "left-pad is flagged",
        },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("packages with no recorded advisory scan clean", () => {
    const dir = verdictDir();
    try {
      const path = join(dir, "verdict.json");
      writeFileSync(path, JSON.stringify({ advisories: {} }));
      expect(recordedScan(path, PACKAGES)).toEqual([]);
      writeFileSync(path, JSON.stringify({}));
      expect(recordedScan(path, PACKAGES)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a verdict that cannot be read throws", () => {
    const dir = verdictDir();
    try {
      expect(() => recordedScan(join(dir, "missing.json"), PACKAGES)).toThrow("cannot read");
      const path = join(dir, "verdict.json");
      writeFileSync(path, "not json");
      expect(() => recordedScan(path, PACKAGES)).toThrow("cannot read");
      writeFileSync(path, JSON.stringify(["not", "an", "object"]));
      expect(() => recordedScan(path, PACKAGES)).toThrow("not an object");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a malformed advisory entry throws", () => {
    const dir = verdictDir();
    try {
      const path = join(dir, "verdict.json");
      writeFileSync(
        path,
        JSON.stringify({ advisories: { "left-pad@1.3.0": [{ level: "fatal" }] } }),
      );
      expect(() => recordedScan(path, PACKAGES)).toThrow("malformed");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
