// Tests beside scripts/refresh-parser.ts: the pure checks only. The network
// half (registry fetch, tarball download) never runs in a test.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { assertSelfContained, resolveVersion, verifyIntegrity } from "./refresh-parser.ts";

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
