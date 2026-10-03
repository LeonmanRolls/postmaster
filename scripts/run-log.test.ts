// Tests beside scripts/run-log.ts, moved from its --self-test on #109: 7 controls.
// Order-dependent: the tests replay the self-test's write sequence in file order against
// one shared dispatch directory, with RUN_LOG_NOW pinned per write as the self-test did.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { write } from "./run-log";

let tmp: string;
let d: string;
let log: string;
let savedNow: string | undefined;

function lines(): string[] {
  return readFileSync(log, "utf8").split("\n");
}

function count(needle: string): number {
  try {
    return readFileSync(log, "utf8").split(needle).length - 1;
  } catch {
    return 0;
  }
}

beforeAll(() => {
  savedNow = process.env.RUN_LOG_NOW;
  tmp = mkdtempSync(join(tmpdir(), "run-log-"));
  d = join(tmp, "RUN");
  mkdirSync(d);
  log = join(d, "run-log.md");
  process.env.RUN_LOG_NOW = "2026-01-01 12:00:00";
  write(d, ["--section", "Harvest"]);
  process.env.RUN_LOG_NOW = "2026-01-01 12:03:07";
  write(d, ["luna harvested, 4 commits"]);
  process.env.RUN_LOG_NOW = "2026-01-01 12:30:00";
  write(d, ["--section", "Synthesis"]);
  process.env.RUN_LOG_NOW = "2026-01-01 12:45:30";
  write(d, ["--close"]);
  process.env.RUN_LOG_NOW = "2026-01-01 12:50:00";
  write(d, ["--close"]);
});

afterAll(() => {
  if (savedNow === undefined) delete process.env.RUN_LOG_NOW;
  else process.env.RUN_LOG_NOW = savedNow;
  rmSync(tmp, { recursive: true, force: true });
});

describe("positive controls", () => {
  test("a section heading carries its start time", () => {
    expect(lines()).toContain("## Harvest (2026-01-01 12:00:00 UTC)");
  }, 10000);

  test("an entry carries the time", () => {
    expect(lines()).toContain("- 12:03:07Z luna harvested, 4 commits");
  }, 10000);

  test("starting a section closes the last, with its time", () => {
    expect(lines()).toContain("- 12:30:00Z section Harvest took 30m 00s");
  }, 10000);

  test("--close closes the open section", () => {
    expect(lines()).toContain("- 12:45:30Z section Synthesis took 15m 30s");
  }, 10000);
});

describe("negative controls", () => {
  test("closing twice writes one line", () => {
    expect(count("section Synthesis took")).toBe(1);
  }, 10000);

  test("--close with no open section writes nothing", () => {
    try {
      rmSync(log);
    } catch {
      /* already gone */
    }
    process.env.RUN_LOG_NOW = "2026-01-01 13:00:00";
    write(d, ["--close"]);
    let empty = true;
    try {
      empty = !existsSync(log) || readFileSync(log, "utf8") === "";
    } catch {
      empty = true;
    }
    expect(empty).toBe(true);
  }, 10000);

  test("a missing dispatch directory is refused", () => {
    const orig = process.stderr.write.bind(process.stderr);
    process.stderr.write = (() => true) as typeof process.stderr.write;
    let rc: number;
    try {
      rc = write(join(tmp, "nowhere"), ["x"]);
    } finally {
      process.stderr.write = orig;
    }
    expect(rc).toBe(1);
  }, 10000);
});
