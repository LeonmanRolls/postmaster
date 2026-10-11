import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { run } from "./proc.ts";
import { DEFAULT_TEST_TIMEOUT_MS } from "./test-defaults.ts";

const ROOT = resolve(import.meta.dir, "../..");

// A parallel worker marks its environment; a test run started from inside one must not inherit it.
const CLEAN_ENV = { BUN_TEST_WORKER_ID: undefined };

const SLOW_TEST = `import { test } from "bun:test";
test("takes 5.6 s and states no limit of its own", async () => {
  await new Promise((resolve) => setTimeout(resolve, 5600));
});
`;

function slowTestFile(): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "test-defaults-"));
  const file = join(dir, "slow.test.ts");
  writeFileSync(file, SLOW_TEST);
  return { dir, file };
}

describe("the default time limit of a test run", () => {
  // These two take 6 s, so they state a limit: a serial run keeps Bun's 5 s default for every file after the first.
  test("a test with no limit of its own may take longer than Bun's 5 s default", () => {
    const { file } = slowTestFile();
    const result = run("bun", ["test", file], { cwd: ROOT, env: CLEAN_ENV });
    expect(result.err + result.out).toContain("1 pass");
    expect(result.code).toBe(0);
  }, 30_000);

  test("control: the same test fails at 5 s where bunfig.toml is not read", () => {
    const { dir, file } = slowTestFile();
    const result = run("bun", ["test", file], { cwd: dir, env: CLEAN_ENV });
    expect(result.err + result.out).toContain("timed out after 5000ms");
    expect(result.code).not.toBe(0);
  }, 30_000);

  test("bunfig.toml preloads the file that sets the default", () => {
    const config = readFileSync(join(ROOT, "bunfig.toml"), "utf8");
    expect(config).toContain('preload = ["./scripts/lib/test-defaults.ts"]');
  });

  test("the gate's --timeout, when it states one, is the same limit", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const stated = /--timeout=([0-9]+)/u.exec(pkg.scripts.check ?? "");
    if (stated) {
      expect(Number(stated[1])).toBe(DEFAULT_TEST_TIMEOUT_MS);
      return;
    }
    // The check script runs the suite through skip-check, which states the
    // timeout in its own invocation instead of the package script.
    const skipCheck = readFileSync(join(ROOT, "scripts/skip-check.ts"), "utf8");
    const skipStated = /"--timeout=([0-9]+)"/u.exec(skipCheck);
    expect(skipStated?.[1]).toBe(String(DEFAULT_TEST_TIMEOUT_MS));
  });
});
