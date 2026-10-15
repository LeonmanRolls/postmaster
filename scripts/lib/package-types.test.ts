// Tests beside scripts/lib/package-types.ts. The packages here are invented, and the download is a
// fake runner: nothing contacts a registry.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  familyOf,
  fetchPackage,
  findInstalled,
  lockedVersions,
  packageNameOf,
  readPackage,
  typeEntries,
  typeGraph,
} from "./package-types.ts";
import type { RunResult } from "./proc.ts";

let tmp = "";

beforeAll(() => {
  // the real path: a temporary folder on macOS is reached through a link
  tmp = realpathSync(mkdtempSync(join(tmpdir(), "package-types-")));
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function put(root: string, rel: string, text = ""): string {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text);
  return abs;
}

const pkgJson = (name: string, version = "1.0.0", more: Record<string, unknown> = {}): string =>
  JSON.stringify({ name, version, ...more });

describe("readPackage", () => {
  test("reads the name, the version and the folder", () => {
    const dir = join(tmp, "read-a");
    put(dir, "package.json", pkgJson("lib-a", "1.2.3"));
    expect(readPackage(dir)).toEqual({ name: "lib-a", version: "1.2.3", dir });
  });

  test("a version that is missing reads as unknown", () => {
    const dir = join(tmp, "read-b");
    put(dir, "package.json", JSON.stringify({ name: "lib-b" }));
    expect(readPackage(dir)?.version).toBe("unknown");
  });

  test("a folder with no package, no name, or broken json is null", () => {
    put(join(tmp, "read-c"), "package.json", JSON.stringify({ version: "1.0.0" }));
    put(join(tmp, "read-d"), "package.json", "{not json");
    expect(readPackage(join(tmp, "read-c"))).toBeNull();
    expect(readPackage(join(tmp, "read-d"))).toBeNull();
    expect(readPackage(join(tmp, "read-absent"))).toBeNull();
  });
});

describe("typeEntries", () => {
  test("finds the declaration files a package names, once each, in the order it names them", () => {
    const root = join(tmp, "entries-a");
    put(
      root,
      "package.json",
      pkgJson("lib-t", "1.0.0", {
        types: "dist/main.d.ts",
        exports: {
          ".": { types: "./dist/main.d.ts", import: "./dist/main.js" },
          "./sub": { types: { import: "./dist/sub.d.mts" } },
        },
        main: "./dist/cjs/index.js",
      }),
    );
    for (const f of ["dist/main.d.ts", "dist/sub.d.mts", "dist/cjs/index.d.ts", "index.d.ts"]) {
      put(root, f);
    }
    expect(typeEntries(root)).toEqual([
      join(root, "dist/main.d.ts"),
      join(root, "dist/sub.d.mts"),
      join(root, "dist/cjs/index.d.ts"),
      join(root, "index.d.ts"),
    ]);
  });

  test("a file that does not exist is not listed", () => {
    const root = join(tmp, "entries-b");
    put(root, "package.json", pkgJson("lib-u", "1.0.0", { types: "dist/missing.d.ts" }));
    put(root, "lib/index.d.ts");
    expect(typeEntries(root)).toEqual([join(root, "lib/index.d.ts")]);
  });

  test("a path that leaves the package folder is ignored", () => {
    const root = join(tmp, "entries-c");
    put(root, "package.json", pkgJson("lib-v", "1.0.0", { types: "../escape.d.ts" }));
    put(tmp, "escape.d.ts");
    expect(typeEntries(root)).toEqual([]);
  });

  test("a package with no package.json has no entries", () => {
    expect(typeEntries(join(tmp, "entries-absent"))).toEqual([]);
  });
});

describe("typeGraph", () => {
  test("follows relative imports and references, and reports the packages it meets", () => {
    const root = join(tmp, "graph-a");
    const index = put(
      root,
      "index.d.ts",
      [
        'export * from "./more";',
        'export type { Deep } from "./sub/index.js";',
        'import type { Ext } from "@scope/other/deep";',
        'type Lazy = import("plain-pkg").Foo;',
        'import fs from "node:fs";',
        '/// <reference path="./ref.d.ts" />',
      ].join("\n"),
    );
    put(root, "more.d.ts", "export interface More { a: string }");
    put(root, "sub/index.d.ts", 'export type Deep = string; export * from "../more";');
    put(root, "ref.d.ts", "");
    const got = typeGraph([index], root);
    expect(got.files).toEqual([
      index,
      join(root, "more.d.ts"),
      join(root, "sub/index.d.ts"),
      join(root, "ref.d.ts"),
    ]);
    expect(got.bare).toEqual(["@scope/other", "plain-pkg"]);
  });

  test("a file that imports itself in a cycle is read once", () => {
    const root = join(tmp, "graph-b");
    const a = put(root, "a.d.ts", 'export * from "./b";');
    put(root, "b.d.ts", 'export * from "./a";');
    expect(typeGraph([a], root).files).toHaveLength(2);
  });

  test("a relative import that leaves the package folder is not followed", () => {
    const root = join(tmp, "graph-c");
    const a = put(root, "a.d.ts", 'export * from "../outside";');
    put(tmp, "outside.d.ts", "");
    expect(typeGraph([a], root).files).toEqual([a]);
  });
});

describe("package names", () => {
  test("packageNameOf takes the package out of an import specifier", () => {
    expect(packageNameOf("@scope/name/sub/path")).toBe("@scope/name");
    expect(packageNameOf("name/sub")).toBe("name");
    expect(packageNameOf("name")).toBe("name");
  });

  test("familyOf is the scope, or the first word of the name", () => {
    expect(familyOf("posthog-js")).toBe("posthog");
    expect(familyOf("@posthog/types")).toBe("posthog");
    expect(familyOf("react")).toBe("react");
  });
});

describe("lockedVersions", () => {
  const LOCK = [
    "packages:",
    "",
    "  posthog-js@1.200.0:",
    "    resolution: {integrity: sha512-aaa}",
    "",
    "  '@posthog/types@1.200.0':",
    "    resolution: {integrity: sha512-bbb}",
    "",
    "  posthog-js@1.100.0(react@18.3.1):",
    "    resolution: {integrity: sha512-ccc}",
    "  posthog-js@1.200.0(react@18.3.1):",
    "    resolution: {integrity: sha512-ddd}",
    "  posthog-js-lite@3.0.0:",
    "    resolution: {integrity: sha512-eee}",
  ].join("\n");

  test("lists each version once, in the order the lockfile has them", () => {
    expect(lockedVersions(LOCK, "posthog-js")).toEqual(["1.200.0", "1.100.0"]);
  });

  test("reads a scoped, quoted name", () => {
    expect(lockedVersions(LOCK, "@posthog/types")).toEqual(["1.200.0"]);
  });

  test("a longer name that starts the same is another package", () => {
    expect(lockedVersions(LOCK, "posthog-js-lite")).toEqual(["3.0.0"]);
  });

  test("a package the lockfile does not hold has no versions", () => {
    expect(lockedVersions(LOCK, "absent")).toEqual([]);
    expect(lockedVersions("", "posthog-js")).toEqual([]);
  });
});

describe("findInstalled", () => {
  beforeAll(() => {
    const root = join(tmp, "repo");
    put(root, "node_modules/lib-root/package.json", pkgJson("lib-root"));
    put(root, "apps/web/node_modules/lib-web/package.json", pkgJson("lib-web"));
    put(root, "packages/ui/node_modules/lib-ui/package.json", pkgJson("lib-ui"));
    put(root, "node_modules/.pnpm/node_modules/lib-store/package.json", pkgJson("lib-store"));
    put(root, "store/lib-link/package.json", pkgJson("lib-link"));
    symlinkSync(join(root, "store/lib-link"), join(root, "node_modules/lib-link"));
  });

  test("finds a package at the root", () => {
    expect(findInstalled(join(tmp, "repo"), "lib-root")).toBe(
      join(tmp, "repo/node_modules/lib-root"),
    );
  });

  test("looks from a folder of the project up to the root", () => {
    expect(findInstalled(join(tmp, "repo"), "lib-web", "apps/web")).toBe(
      join(tmp, "repo/apps/web/node_modules/lib-web"),
    );
    expect(findInstalled(join(tmp, "repo"), "lib-root", "apps/web")).toBe(
      join(tmp, "repo/node_modules/lib-root"),
    );
  });

  test("then looks through the apps and the packages", () => {
    expect(findInstalled(join(tmp, "repo"), "lib-web")).toBe(
      join(tmp, "repo/apps/web/node_modules/lib-web"),
    );
    expect(findInstalled(join(tmp, "repo"), "lib-ui")).toBe(
      join(tmp, "repo/packages/ui/node_modules/lib-ui"),
    );
  });

  test("looks in the package store", () => {
    expect(findInstalled(join(tmp, "repo"), "lib-store")).toBe(
      join(tmp, "repo/node_modules/.pnpm/node_modules/lib-store"),
    );
  });

  test("a linked package is returned by its real folder", () => {
    expect(findInstalled(join(tmp, "repo"), "lib-link")).toBe(join(tmp, "repo/store/lib-link"));
  });

  test("a package that is not installed is null", () => {
    expect(findInstalled(join(tmp, "repo"), "absent")).toBeNull();
    expect(findInstalled(join(tmp, "repo-absent"), "lib-root")).toBeNull();
  });
});

describe("fetchPackage", () => {
  const ok = (out = ""): RunResult => ({ code: 0, out, err: "", timedOut: false });

  test("downloads, unpacks and returns the package folder; a second call uses the cache", () => {
    const cache = join(tmp, "cache-a");
    const calls: string[][] = [];
    const fake = (cmd: string, args: string[]): RunResult => {
      calls.push([cmd, ...args]);
      if (cmd === "npm") return ok("lib-f-2.0.0.tgz\n");
      const dest = args[args.indexOf("-C") + 1] as string;
      put(dest, "package/package.json", pkgJson("lib-f", "2.0.0"));
      return ok();
    };
    const dest = join(cache, "lib-f_2.0.0");
    expect(fetchPackage("lib-f@2.0.0", cache, fake)).toBe(join(dest, "package"));
    expect(calls).toEqual([
      ["npm", "pack", "lib-f@2.0.0", "--pack-destination", dest, "--silent"],
      ["tar", "-xzf", join(dest, "lib-f-2.0.0.tgz"), "-C", dest],
    ]);
    expect(fetchPackage("lib-f@2.0.0", cache, fake)).toBe(join(dest, "package"));
    expect(calls).toHaveLength(2);
  });

  test("a scoped name is made safe for a folder", () => {
    const cache = join(tmp, "cache-b");
    const fake = (cmd: string, args: string[]): RunResult => {
      if (cmd === "npm") return ok("scope-pkg-1.0.0.tgz\n");
      put(args[args.indexOf("-C") + 1] as string, "package/package.json", pkgJson("@scope/pkg"));
      return ok();
    };
    expect(fetchPackage("@scope/pkg@1.0.0", cache, fake)).toBe(
      join(cache, "_scope_pkg_1.0.0", "package"),
    );
  });

  test("a failed download is null", () => {
    const fail = (): RunResult => ({ code: 1, out: "", err: "not found", timedOut: false });
    expect(fetchPackage("lib-g@1.0.0", join(tmp, "cache-c"), fail)).toBeNull();
  });

  test("an archive that unpacks to no package is null", () => {
    const empty = (cmd: string): RunResult => (cmd === "npm" ? ok("x.tgz\n") : ok());
    expect(fetchPackage("lib-h@1.0.0", join(tmp, "cache-d"), empty)).toBeNull();
  });

  test("a download that names no file is null", () => {
    expect(fetchPackage("lib-i@1.0.0", join(tmp, "cache-e"), () => ok(""))).toBeNull();
  });
});
