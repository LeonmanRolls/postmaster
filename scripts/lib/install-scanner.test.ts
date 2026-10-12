// Tests beside scripts/lib/install-scanner.ts: the recorded verdict the
// scanner answers from under POSTMASTER_SCAN_FIXTURE, and the approval
// half of the joined scan. The live Socket path and the install behavior
// sit in the #425 and #424 oracles.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { approvalScan, recordedScan, scanner } from "./install-scanner.ts";

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

const LOCK = `{
  "lockfileVersion": 2,
  "workspaces": {
    "": {
      "name": "probe",
      "dependencies": {
        "left-pad": "1.3.0",
      },
    },
  },
  "packages": {
    "left-pad": ["left-pad@1.3.0", "", {}, "sha512-x"],
  },
}
`;

function scanRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "postmaster-install-scan-"));
  writeFileSync(join(dir, "bun.lock"), LOCK);
  return dir;
}

describe("approvalScan", () => {
  test("a package outside the approved set is a fatal refusal", () => {
    const dir = scanRoot();
    try {
      const found = approvalScan(dir, [
        { name: "left-pad", version: "1.3.0" },
        { name: "is-odd", version: "3.0.1" },
      ]);
      expect(found).toHaveLength(1);
      expect(found[0]!.level).toBe("fatal");
      expect(found[0]!.package).toBe("is-odd");
      expect(found[0]!.description).toContain("is-odd@3.0.1");
      expect(found[0]!.description).toContain("stop");
      expect(found[0]!.description).toContain("report");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a cached yes approves", () => {
    const dir = scanRoot();
    try {
      mkdirSync(join(dir, ".postmaster"), { recursive: true });
      writeFileSync(
        join(dir, ".postmaster", "library-approvals.json"),
        JSON.stringify({ version: 1, approvals: { "is-odd@3.0.1": {} } }),
      );
      expect(approvalScan(dir, [{ name: "is-odd", version: "3.0.1" }])).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("scanner.scan", () => {
  test("concatenates Socket's advisories with the approval refusals", async () => {
    const dir = scanRoot();
    const verdict = join(dir, "verdict.json");
    writeFileSync(
      verdict,
      JSON.stringify({
        advisories: {
          "left-pad@1.3.0": [
            {
              level: "warn",
              package: "left-pad",
              url: null,
              description: "left-pad is noted",
            },
          ],
        },
      }),
    );
    const cwd = process.cwd();
    process.chdir(dir);
    process.env["POSTMASTER_SCAN_FIXTURE"] = verdict;
    delete process.env["POSTMASTER_RECORD_FILE"];
    try {
      const found = await scanner.scan({
        packages: [
          { name: "left-pad", version: "1.3.0" },
          { name: "is-odd", version: "3.0.1" },
        ],
      });
      expect(found).toHaveLength(2);
      expect(found[0]!.description).toContain("noted");
      expect(found[1]!.level).toBe("fatal");
    } finally {
      delete process.env["POSTMASTER_SCAN_FIXTURE"];
      process.chdir(cwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an unreachable scan throws with anything new and warns past the pinned set", async () => {
    const dir = scanRoot();
    const verdict = join(dir, "verdict.json");
    writeFileSync(verdict, JSON.stringify({ error: "socket unreachable" }));
    const cwd = process.cwd();
    process.chdir(dir);
    process.env["POSTMASTER_SCAN_FIXTURE"] = verdict;
    delete process.env["POSTMASTER_RECORD_FILE"];
    try {
      let thrown = "";
      try {
        await scanner.scan({ packages: [{ name: "is-odd", version: "3.0.1" }] });
      } catch (error) {
        thrown = error instanceof Error ? error.message : String(error);
      }
      expect(thrown).toContain("socket unreachable");
      const pinned = await scanner.scan({ packages: [{ name: "left-pad", version: "1.3.0" }] });
      expect(pinned).toEqual([]);
    } finally {
      delete process.env["POSTMASTER_SCAN_FIXTURE"];
      process.chdir(cwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an unreachable scan throws for a cached approval new to the lockfile", async () => {
    const dir = scanRoot();
    mkdirSync(join(dir, ".postmaster"), { recursive: true });
    writeFileSync(
      join(dir, ".postmaster", "library-approvals.json"),
      JSON.stringify({ version: 1, approvals: { "is-odd@3.0.1": {} } }),
    );
    const verdict = join(dir, "verdict.json");
    writeFileSync(verdict, JSON.stringify({ error: "socket unreachable" }));
    const cwd = process.cwd();
    process.chdir(dir);
    process.env["POSTMASTER_SCAN_FIXTURE"] = verdict;
    delete process.env["POSTMASTER_RECORD_FILE"];
    try {
      let thrown = "";
      try {
        await scanner.scan({ packages: [{ name: "is-odd", version: "3.0.1" }] });
      } catch (error) {
        thrown = error instanceof Error ? error.message : String(error);
      }
      expect(thrown).toContain("socket unreachable");
      const pinned = await scanner.scan({ packages: [{ name: "left-pad", version: "1.3.0" }] });
      expect(pinned).toEqual([]);
    } finally {
      delete process.env["POSTMASTER_SCAN_FIXTURE"];
      process.chdir(cwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("record mode writes the refused set beside the verdict", async () => {
    const dir = scanRoot();
    const verdict = join(dir, "verdict.json");
    writeFileSync(verdict, JSON.stringify({ advisories: {} }));
    const record = join(dir, "record.json");
    const cwd = process.cwd();
    process.chdir(dir);
    process.env["POSTMASTER_SCAN_FIXTURE"] = verdict;
    process.env["POSTMASTER_RECORD_FILE"] = record;
    try {
      const found = await scanner.scan({ packages: [{ name: "is-odd", version: "3.0.1" }] });
      expect(found).toHaveLength(1);
      expect(JSON.parse(readFileSync(record, "utf8"))).toEqual({
        refused: ["is-odd@3.0.1"],
        socketFlagged: false,
      });
    } finally {
      delete process.env["POSTMASTER_SCAN_FIXTURE"];
      delete process.env["POSTMASTER_RECORD_FILE"];
      process.chdir(cwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
