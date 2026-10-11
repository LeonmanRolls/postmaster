// Oracle for #425, committed before the change: every package this repository
// installs or copies in is pinned, a week old, scanned by Socket and runs no
// install script. C1 pins every version in package.json, calls the installed
// check binaries instead of bunx, and disables auto-install. C2 sets the
// seven-day release age and teaches refresh-parser the age wait with a
// per-version waiver, against a recorded registry document. C3 opts out of
// Bun's trusted install-script list. C4 configures the install scanner that
// runs Socket's scan, and proves through real installs against a stub
// registry that a flagged package and an unreachable scanner both stop the
// install with nothing installed; the refresh scans its package the same way.
// Covered: C1-C4. Not covered: the fresh-clone frozen install (the gate runs
// it on every pull request).
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  PARSER_MARKER,
  cleanup,
  makeInstallScratch,
  makeRefreshFixture,
  makeTempDir,
  readBunfig,
  readManifest,
  repoRoot,
  runInstall,
  runRefresh,
  startStubRegistry,
  writeScanFixture,
} from "./acceptance-425.ts";

const EXACT = /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$/u;

function installTable(): Record<string, unknown> {
  return (readBunfig()["install"] as Record<string, unknown> | undefined) ?? {};
}

describe("C1: only the pinned version of each library ever runs", () => {
  test("every version in package.json is exact", () => {
    const manifest = readManifest();
    const deps = { ...manifest.dependencies, ...manifest.devDependencies };
    expect(Object.keys(deps).length).toBeGreaterThan(0);
    const loose = Object.entries(deps)
      .filter(([, spec]) => !EXACT.test(spec))
      .map(([name, spec]) => `${name}@${spec}`);
    expect(loose).toEqual([]);
  });

  test("the check script calls no bunx", () => {
    expect(readManifest().scripts.check).not.toContain("bunx");
  });

  test("the helper scripts call no bunx", () => {
    // An invocation passes "bunx" as a string; a comment may name it.
    for (const file of ["scripts/acceptance-232.ts", "scripts/no-explicit-any-acceptance.ts"]) {
      expect(readFileSync(join(repoRoot(), file), "utf8")).not.toContain('"bunx"');
    }
  });

  test("bunfig.toml disables auto-install", () => {
    expect(installTable()["auto"]).toBe("disable");
  });
});

describe("C2: no version younger than seven days is taken without a waiver", () => {
  test("bunfig.toml sets the seven-day minimum release age", () => {
    expect(installTable()["minimumReleaseAge"]).toBe(604800);
  });

  test("refresh-parser refuses a version published under seven days earlier", () => {
    const fx = makeRefreshFixture();
    const root = makeTempDir("postmaster-425-root-");
    try {
      const r = runRefresh([fx.youngVersion], {
        POSTMASTER_REFRESH_FIXTURE: fx.dir,
        POSTMASTER_REFRESH_ROOT: root,
      });
      expect(r.code).not.toBe(0);
      expect(r.err).toContain("--waive-age");
    } finally {
      cleanup(fx.dir, root);
    }
  });

  test("refresh-parser takes a young version with the waiver for that version", () => {
    const fx = makeRefreshFixture();
    const root = makeTempDir("postmaster-425-root-");
    try {
      const scan = writeScanFixture(fx.dir, {});
      const r = runRefresh([fx.youngVersion, "--waive-age", fx.youngVersion], {
        POSTMASTER_REFRESH_FIXTURE: fx.dir,
        POSTMASTER_REFRESH_ROOT: root,
        POSTMASTER_SCAN_FIXTURE: scan,
      });
      expect(r.code).toBe(0);
      const vendor = join(root, "scripts", "lib", "vendor");
      const bundle = join(vendor, "babel-parser.js");
      expect(existsSync(bundle)).toBe(true);
      expect(readFileSync(bundle, "utf8")).toContain(PARSER_MARKER);
      expect(readFileSync(join(vendor, "VERSION"), "utf8")).toContain(fx.youngVersion);
    } finally {
      cleanup(fx.dir, root);
    }
  });

  test("a waiver for another version does not waive", () => {
    const fx = makeRefreshFixture();
    const root = makeTempDir("postmaster-425-root-");
    try {
      const scan = writeScanFixture(fx.dir, {});
      const r = runRefresh([fx.youngVersion, "--waive-age", fx.oldVersion], {
        POSTMASTER_REFRESH_FIXTURE: fx.dir,
        POSTMASTER_REFRESH_ROOT: root,
        POSTMASTER_SCAN_FIXTURE: scan,
      });
      expect(r.code).not.toBe(0);
      expect(r.err).toContain("--waive-age");
    } finally {
      cleanup(fx.dir, root);
    }
  });

  test("refresh-parser takes a version older than seven days", () => {
    const fx = makeRefreshFixture();
    const root = makeTempDir("postmaster-425-root-");
    try {
      const scan = writeScanFixture(fx.dir, {});
      const r = runRefresh([fx.oldVersion], {
        POSTMASTER_REFRESH_FIXTURE: fx.dir,
        POSTMASTER_REFRESH_ROOT: root,
        POSTMASTER_SCAN_FIXTURE: scan,
      });
      expect(r.code).toBe(0);
      const vendor = join(root, "scripts", "lib", "vendor");
      const bundle = join(vendor, "babel-parser.js");
      expect(existsSync(bundle)).toBe(true);
      expect(readFileSync(bundle, "utf8")).toContain(PARSER_MARKER);
      expect(readFileSync(join(vendor, "VERSION"), "utf8")).toContain(fx.oldVersion);
    } finally {
      cleanup(fx.dir, root);
    }
  });

  test("refresh-parser takes an explicit version with no latest tag", () => {
    const fx = makeRefreshFixture();
    const root = makeTempDir("postmaster-425-root-");
    try {
      const packument = join(fx.dir, "packument.json");
      const doc = JSON.parse(readFileSync(packument, "utf8")) as Record<string, unknown>;
      delete doc["dist-tags"];
      writeFileSync(packument, JSON.stringify(doc));
      const scan = writeScanFixture(fx.dir, {});
      const r = runRefresh([fx.oldVersion], {
        POSTMASTER_REFRESH_FIXTURE: fx.dir,
        POSTMASTER_REFRESH_ROOT: root,
        POSTMASTER_SCAN_FIXTURE: scan,
      });
      expect(r.code).toBe(0);
      const vendor = join(root, "scripts", "lib", "vendor");
      expect(readFileSync(join(vendor, "babel-parser.js"), "utf8")).toContain(PARSER_MARKER);
    } finally {
      cleanup(fx.dir, root);
    }
  });
});

describe("C3: no dependency install script runs", () => {
  test("package.json opts out of trusted install scripts", () => {
    expect(readManifest().trustedDependencies).toEqual([]);
  });
});

describe("C4: Socket's scanner checks every package before it is taken", () => {
  test("bunfig.toml scans installs with the Socket scanner module, pinned", () => {
    const security = (installTable()["security"] as Record<string, unknown> | undefined) ?? {};
    expect(security["scanner"]).toBe("@socketsecurity/bun-security-scanner");
    const socket = readManifest().devDependencies?.["@socketsecurity/bun-security-scanner"];
    expect(socket).toMatch(EXACT);
  });

  test("an install of a package the scanner flags exits non-zero and installs nothing", async () => {
    const registry = startStubRegistry();
    try {
      const dir = makeInstallScratch(
        registry.url,
        join(repoRoot(), "scripts", "lib", "install-scanner.ts"),
      );
      try {
        const scan = writeScanFixture(dir, {
          advisories: {
            "probe-425-pkg@1.0.0": [
              {
                level: "fatal",
                package: "probe-425-pkg",
                url: "https://example.invalid/probe-425",
                description: "probe-425 flags this package",
              },
            ],
          },
        });
        const r = await runInstall(dir, { POSTMASTER_SCAN_FIXTURE: scan });
        expect(r.code).not.toBe(0);
        expect(`${r.out}\n${r.err}`).toContain("probe-425 flags this package");
        expect(`${r.out}\n${r.err}`).toContain(
          "Installation aborted due to fatal security advisories",
        );
        expect(existsSync(join(dir, "node_modules", "probe-425-pkg"))).toBe(false);
      } finally {
        cleanup(dir);
      }
    } finally {
      registry.stop();
    }
  });

  test("an install that cannot reach the scanner exits non-zero", async () => {
    const registry = startStubRegistry();
    try {
      const dir = makeInstallScratch(
        registry.url,
        join(repoRoot(), "scripts", "lib", "install-scanner.ts"),
      );
      try {
        const scan = writeScanFixture(dir, { error: "probe-425: socket unreachable" });
        const r = await runInstall(dir, { POSTMASTER_SCAN_FIXTURE: scan });
        expect(r.code).not.toBe(0);
        expect(`${r.out}\n${r.err}`).toContain("probe-425: socket unreachable");
        expect(existsSync(join(dir, "node_modules", "probe-425-pkg"))).toBe(false);
      } finally {
        cleanup(dir);
      }
    } finally {
      registry.stop();
    }
  });

  test("the refresh checks its package the same way before writing it", () => {
    const fx = makeRefreshFixture();
    const root = makeTempDir("postmaster-425-root-");
    try {
      const scan = writeScanFixture(fx.dir, {
        advisories: {
          [`@babel/parser@${fx.oldVersion}`]: [
            {
              level: "fatal",
              package: "@babel/parser",
              url: "https://example.invalid/probe-425",
              description: "probe-425 flags this parser",
            },
          ],
        },
      });
      const r = runRefresh([fx.oldVersion], {
        POSTMASTER_REFRESH_FIXTURE: fx.dir,
        POSTMASTER_REFRESH_ROOT: root,
        POSTMASTER_SCAN_FIXTURE: scan,
      });
      expect(r.code).not.toBe(0);
      expect(r.err).toContain("probe-425 flags this parser");
      expect(existsSync(join(root, "scripts", "lib", "vendor", "babel-parser.js"))).toBe(false);
    } finally {
      cleanup(fx.dir, root);
    }
  });

  test("the refresh refuses a package the scanner cannot check", () => {
    const fx = makeRefreshFixture();
    const root = makeTempDir("postmaster-425-root-");
    try {
      const scan = writeScanFixture(fx.dir, { error: "probe-425: socket unreachable" });
      const r = runRefresh([fx.oldVersion], {
        POSTMASTER_REFRESH_FIXTURE: fx.dir,
        POSTMASTER_REFRESH_ROOT: root,
        POSTMASTER_SCAN_FIXTURE: scan,
      });
      expect(r.code).not.toBe(0);
      expect(r.err).toContain("probe-425: socket unreachable");
      expect(existsSync(join(root, "scripts", "lib", "vendor", "babel-parser.js"))).toBe(false);
    } finally {
      cleanup(fx.dir, root);
    }
  });

  test("the refresh announces a recorded verdict", () => {
    const fx = makeRefreshFixture();
    const root = makeTempDir("postmaster-425-root-");
    try {
      const scan = writeScanFixture(fx.dir, {});
      const r = runRefresh([fx.oldVersion], {
        POSTMASTER_REFRESH_FIXTURE: fx.dir,
        POSTMASTER_REFRESH_ROOT: root,
        POSTMASTER_SCAN_FIXTURE: scan,
      });
      expect(r.code).toBe(0);
      expect(r.err).toContain("recorded verdict");
    } finally {
      cleanup(fx.dir, root);
    }
  });
});
