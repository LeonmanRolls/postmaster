// Tests beside scripts/footprint.ts. The project is invented: a small "shop" repository whose head
// commit adds a store, its test, a new package with a new dependency, and a lock file.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { classify, newDependencies, newPackages, storageWrites, sumNumstat } from "./footprint.ts";

const SELF = join(import.meta.dir, "run");

describe("what a path is", () => {
  test("tests, in their folders and by their names", () => {
    for (const p of [
      "src/a.test.ts",
      "src/a.spec.tsx",
      "e2e/walk.ts",
      "pkg/tests/a.ts",
      "x/__tests__/a.js",
    ]) {
      expect(classify(p)).toBe("tests");
    }
  });

  test("generated files and lock files, ahead of everything else", () => {
    for (const p of [
      "src/routeTree.gen.ts",
      "pnpm-lock.yaml",
      "app/dist/a.js",
      "a/yarn.lock",
      "x/bun.lock",
    ]) {
      expect(classify(p)).toBe("generated");
    }
  });

  test("documents", () => {
    expect(classify("README.md")).toBe("docs");
    expect(classify("docs/a.html")).toBe("docs");
  });

  test("anything else is source", () => {
    expect(classify("src/app.ts")).toBe("source");
    expect(classify("package.json")).toBe("source");
  });
});

describe("the numstat sum", () => {
  const text = [
    "10\t2\tsrc/a.ts",
    "30\t0\tsrc/a.test.ts",
    "-\t-\tlogo.png",
    "5\t5\tpnpm-lock.yaml",
    "",
  ].join("\n");
  const sums = sumNumstat(text);

  test("counts every file and line", () => {
    expect(sums.all).toEqual({ files: 4, added: 45, removed: 7 });
  });

  test("splits by kind; a binary file is a file with no lines", () => {
    expect(sums.source).toEqual({ files: 2, added: 10, removed: 2 });
    expect(sums.tests).toEqual({ files: 1, added: 30, removed: 0 });
    expect(sums.generated).toEqual({ files: 1, added: 5, removed: 5 });
  });
});

describe("new packages and dependencies", () => {
  test("an added manifest below the top is a new package; the top one is not", () => {
    const status = [
      "A\tpackages/consent/package.json",
      "A\tpackage.json",
      "M\tapps/a/package.json",
      "A\tcrates/x/Cargo.toml",
    ].join("\n");
    expect(newPackages(status)).toEqual(["packages/consent", "crates/x"]);
  });

  test("a dependency in the after-manifest and not in the before is new", () => {
    const before = JSON.stringify({ dependencies: { a: "1" } });
    const after = JSON.stringify({ dependencies: { a: "2", b: "1" }, devDependencies: { c: "1" } });
    expect(newDependencies(before, after)).toEqual(["b", "c"]);
  });

  test("with no before-manifest every dependency is new", () => {
    expect(newDependencies(null, JSON.stringify({ dependencies: { z: "1" } }))).toEqual(["z"]);
  });

  test("a manifest that does not parse has none", () => {
    expect(newDependencies(null, "{")).toEqual([]);
  });
});

describe("storage and cookie writes", () => {
  test("the names the added lines write", () => {
    const added = [
      "localStorage.setItem('acme.consent', value)",
      'sessionStorage.setItem("tab", "1")',
      "document.cookie = `acme-consent=${v}; path=/`",
      "res.headers.append('Set-Cookie', 'session=abc')",
    ].join("\n");
    expect(storageWrites(added)).toEqual([
      "cookie acme-consent",
      "cookie session",
      "localStorage acme.consent",
      "sessionStorage tab",
    ]);
  });

  test("reading is not writing", () => {
    expect(storageWrites("const v = localStorage.getItem('x')")).toEqual([]);
  });
});

let tmp = "";
let repo = "";
let base = "";
let head = "";

function sh(args: string[]): string {
  const r = spawnSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    encoding: "utf8",
  });
  return String(r.stdout ?? "").trim();
}

function put(rel: string, text: string): void {
  mkdirSync(dirname(join(repo, rel)), { recursive: true });
  writeFileSync(join(repo, rel), text);
}

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "footprint-"));
  repo = join(tmp, "shop");
  mkdirSync(repo);
  sh(["init", "-q"]);
  put("package.json", JSON.stringify({ dependencies: { a: "1" } }));
  put("src/app.ts", "export const a = 1;\n");
  sh(["add", "."]);
  sh(["commit", "-qm", "base"]);
  base = sh(["rev-parse", "HEAD"]);
  put("package.json", JSON.stringify({ dependencies: { a: "1", b: "1" } }));
  put(
    "src/store.ts",
    "localStorage.setItem('acme.consent', 'yes');\ndocument.cookie = 'acme-consent=1';\n",
  );
  put("src/store.test.ts", "test('x', () => {});\n".repeat(5));
  put("packages/consent/package.json", JSON.stringify({ dependencies: { "posthog-js": "1" } }));
  put("packages/consent/src/index.ts", "export {};\n");
  put("pnpm-lock.yaml", "lock\n");
  sh(["add", "."]);
  sh(["commit", "-qm", "head"]);
  head = sh(["rev-parse", "HEAD"]);
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("the command", () => {
  const out = (): string[] => {
    const r = spawnSync(SELF, ["footprint", repo, base, head], {
      encoding: "utf8",
      timeout: 60000,
    });
    expect(r.status).toBe(0);
    return String(r.stdout)
      .split("\n")
      .filter((l) => l !== "");
  };

  test("prints the size, the split, the new packages and dependencies, and the storage writes", () => {
    expect(out()).toEqual([
      "files: 6",
      "lines: +11 -1",
      "source: 4 files, +5 -1",
      "tests: 1 files, +5 -0",
      "generated: 1 files, +1 -0",
      "new packages: packages/consent",
      "new dependencies: b, posthog-js",
      "storage and cookies written (a guess from the added lines): cookie acme-consent, localStorage acme.consent",
    ]);
  });

  test("a revision git cannot read exits 1, and the wrong number of arguments exits 2", () => {
    const bad = spawnSync(SELF, ["footprint", repo, "nope", head], {
      encoding: "utf8",
      timeout: 60000,
    });
    expect(bad.status).toBe(1);
    expect(String(bad.stderr)).toContain("git cannot read");
    expect(spawnSync(SELF, ["footprint", repo], { encoding: "utf8", timeout: 60000 }).status).toBe(
      2,
    );
  });
});
