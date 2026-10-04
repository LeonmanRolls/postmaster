import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  checkBunVersion,
  minimumBunVersion,
  toolPackageJson,
  versionAtLeast,
} from "./bun-version.ts";

const scriptsDir = join(import.meta.dir, "..");

describe("Bun minimum", () => {
  test("compares numeric major, minor and patch components", () => {
    for (const found of ["1.4.2", "1.4.10", "1.10.0"]) {
      expect(versionAtLeast(found, "1.4.2")).toBe(true);
    }
    for (const found of ["1.3.14", "1.4.1"]) {
      expect(versionAtLeast(found, "1.4.2")).toBe(false);
    }
  });

  test("reads the minimum from the tool package manifest", () => {
    const manifest = readFileSync(toolPackageJson(), "utf8");
    expect(minimumBunVersion(manifest)).toBe("1.4.2");
    expect(checkBunVersion("1.3.14", manifest)).toBe(
      "postmaster requires Bun 1.4.2 or newer; found 1.3.14",
    );
  });

  test("the start command reports its version error before loading the target", () => {
    const root = mkdtempSync(join(tmpdir(), "postmaster-bun-version-"));
    const scripts = join(root, "scripts");
    const lib = join(scripts, "lib");
    try {
      mkdirSync(lib, { recursive: true });
      writeFileSync(join(scripts, "run"), readFileSync(join(scriptsDir, "run"), "utf8"));
      chmodSync(join(scripts, "run"), 0o755);
      writeFileSync(
        join(scripts, "check-bun-version.ts"),
        readFileSync(join(scriptsDir, "check-bun-version.ts"), "utf8"),
      );
      writeFileSync(
        join(lib, "bun-version.ts"),
        readFileSync(join(import.meta.dir, "bun-version.ts"), "utf8"),
      );
      writeFileSync(
        join(scripts, "not-supported.ts"),
        'import { missingExport } from "node:fs";\n',
      );
      writeFileSync(join(root, "package.json"), '{"engines":{"bun":">=999.0.0"}}\n');
      writeFileSync(join(root, "bunfig.toml"), "");

      const run = spawnSync(join(scripts, "run"), ["not-supported"], {
        cwd: root,
        encoding: "utf8",
      });
      expect(run.status).not.toBe(0);
      expect(run.stdout).toBe("");
      expect(run.stderr).toBe(`postmaster requires Bun 999.0.0 or newer; found ${Bun.version}\n`);
      expect(run.stderr).not.toContain("missingExport");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
