// Tests beside scripts/refresh-parser.ts: the pure checks only. The network
// half (registry fetch, tarball download) never runs in a test.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  assertOldEnough,
  assertSelfContained,
  packumentLatest,
  packumentTake,
  parseArgs,
  resolveVersion,
  verifyIntegrity,
} from "./refresh-parser.ts";

describe("refresh-parser pure checks", () => {
  test("an explicit 7.x version resolves to itself", () => {
    expect(resolveVersion("7.29.9", "7.29.0")).toBe("7.29.9");
  });

  test("no argument resolves to the registry latest", () => {
    expect(resolveVersion(undefined, "7.29.9")).toBe("7.29.9");
  });

  test("a non-7 version refuses", () => {
    expect(() => resolveVersion("8.0.0", "7.29.9")).toThrow("refusing version");
    expect(() => resolveVersion(undefined, "8.0.0")).toThrow("refusing version");
    expect(() => resolveVersion("not-a-version", "7.29.9")).toThrow("refusing version");
  });

  test("bytes hashing to the integrity string verify", () => {
    const bytes = new TextEncoder().encode("bundle bytes");
    const digest = createHash("sha512").update(bytes).digest("base64");
    expect(verifyIntegrity(bytes, `sha512-${digest}`)).toBe(true);
  });

  test("bytes missing the integrity string do not verify", () => {
    const bytes = new TextEncoder().encode("bundle bytes");
    const other = new TextEncoder().encode("other bytes");
    const digest = createHash("sha512").update(other).digest("base64");
    expect(verifyIntegrity(bytes, `sha512-${digest}`)).toBe(false);
    expect(verifyIntegrity(bytes, "bogus")).toBe(false);
  });

  test("a bundle without require calls is self-contained", () => {
    expect(() => assertSelfContained("module.exports = { parse };")).not.toThrow();
  });

  test("a bundle with a require call is refused", () => {
    expect(() => assertSelfContained('const x = require("./chunk");')).toThrow("require");
  });
});

describe("refresh-parser arguments", () => {
  test("no argument takes the latest with no waiver", () => {
    expect(parseArgs([])).toEqual({ version: undefined, waiver: undefined });
  });

  test("a version and a waiver parse in any order", () => {
    expect(parseArgs(["7.10.0", "--waive-age", "7.10.0"])).toEqual({
      version: "7.10.0",
      waiver: "7.10.0",
    });
    expect(parseArgs(["--waive-age", "7.10.0", "7.10.0"])).toEqual({
      version: "7.10.0",
      waiver: "7.10.0",
    });
  });

  test("anything else is a usage error", () => {
    expect(parseArgs(["7.10.0", "7.11.0"])).toBeNull();
    expect(parseArgs(["not-a-version"])).toBeNull();
    expect(parseArgs(["--waive-age"])).toBeNull();
    expect(parseArgs(["--waive-age", "not-a-version"])).toBeNull();
    expect(parseArgs(["--unknown"])).toBeNull();
  });
});

describe("refresh-parser age wait", () => {
  const NOW = Date.parse("2026-10-10T12:00:00.000Z");
  const OLD = "2026-10-01T12:00:00.000Z";
  const YOUNG = "2026-10-10T11:00:00.000Z";

  test("a version a week old passes", () => {
    expect(() => assertOldEnough("7.10.0", OLD, NOW, undefined)).not.toThrow();
  });

  test("a version under seven days old refuses with the waiver", () => {
    expect(() => assertOldEnough("7.11.0", YOUNG, NOW, undefined)).toThrow("--waive-age 7.11.0");
  });

  test("the waiver for that version takes it", () => {
    expect(() => assertOldEnough("7.11.0", YOUNG, NOW, "7.11.0")).not.toThrow();
  });

  test("a waiver for another version does not waive", () => {
    expect(() => assertOldEnough("7.11.0", YOUNG, NOW, "7.10.0")).toThrow("--waive-age 7.11.0");
  });

  test("a version with no readable publish time refuses", () => {
    expect(() => assertOldEnough("7.11.0", undefined, NOW, undefined)).toThrow("--waive-age");
    expect(() => assertOldEnough("7.11.0", "not a time", NOW, undefined)).toThrow("--waive-age");
    expect(() => assertOldEnough("7.11.0", undefined, NOW, "7.11.0")).not.toThrow();
  });

  test("a version published in the future refuses", () => {
    expect(() => assertOldEnough("7.11.0", "2026-10-11T12:00:00.000Z", NOW, undefined)).toThrow(
      "--waive-age",
    );
  });
});

describe("refresh-parser packument reads", () => {
  const DOC = {
    "dist-tags": { latest: "7.11.0" },
    time: { "7.10.0": "2026-10-01T12:00:00.000Z", "7.11.0": "2026-10-10T11:00:00.000Z" },
    versions: {
      "7.10.0": {
        dist: { tarball: "https://example.invalid/7.10.0.tgz", integrity: "sha512-old" },
      },
      "7.11.0": {
        dist: { tarball: "https://example.invalid/7.11.0.tgz", integrity: "sha512-young" },
      },
    },
  };

  test("the latest tag and one version's take read", () => {
    expect(packumentLatest(DOC)).toBe("7.11.0");
    expect(packumentTake(DOC, "7.10.0")).toEqual({
      publishedAt: "2026-10-01T12:00:00.000Z",
      tarball: "https://example.invalid/7.10.0.tgz",
      integrity: "sha512-old",
    });
  });

  test("a document with no latest tag refuses", () => {
    expect(() => packumentLatest({})).toThrow("no latest version");
    expect(() => packumentLatest(null)).toThrow("not an object");
  });

  test("a version with no record or no tarball refuses", () => {
    expect(() => packumentTake(DOC, "7.12.0")).toThrow("no registry record");
    expect(() => packumentTake({ versions: { "7.10.0": {} } }, "7.10.0")).toThrow("no tarball");
  });
});
