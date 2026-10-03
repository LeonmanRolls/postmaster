import { afterEach, expect, test } from "bun:test";
import { closeSync, mkdirSync, openSync, writeSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { cleanupScratch, initRepo, ROOT, scratchDir } from "./scrub-test-kit.ts";

afterEach(cleanupScratch);

test("C27 --files and raw promotion stream a 175 MB file below 512 MB", () => {
  const probe = spawnSync("bash", ["-c", "ulimit -v 524288"], { encoding: "utf8" });
  if (probe.status !== 0) {
    console.log("not shown: this host cannot set the required virtual-memory limit");
    return;
  }
  const source = join(scratchDir(), "large");
  const file = join(source, "records.jsonl");
  const repo = initRepo();
  mkdirSync(source);
  const fd = openSync(file, "w");
  const row = Buffer.from(`${"letter ".repeat(357)}\n`);
  try { for (let index = 0; index < 70_000; index++) writeSync(fd, row); }
  finally { closeSync(fd); }
  expect(Buffer.byteLength(row) * 70_000).toBeGreaterThan(170_000_000);
  writeFileSync(join(scratchDir(), "whole-read.ts"), [
    'import { readFileSync } from "node:fs";',
    'const body = readFileSync(process.argv[2]!, "utf8");',
    'const lines = body.split("\\n");',
    'console.log(lines.length);',
  ].join("\n"));

  const withinLimit = (script: string, args: string[]) => spawnSync("bash", [
    "-c", 'ulimit -v 524288 || exit 99; exec "$@"', "bash", script, ...args,
  ], { cwd: repo, encoding: "utf8", maxBuffer: 1024 * 1024 });
  const scan = withinLimit(join(ROOT, "scripts/scrub-check.sh"), ["--files", file]);
  expect(scan.status).toBe(0);
  expect(scan.stdout).toBe("");
  expect(scan.stderr).toBe("");

  const promoted = withinLimit(join(ROOT, "scripts/raw-promote.sh"), [source, "raw/large"]);
  expect(promoted.status).toBe(0);
  expect(promoted.stdout).toBe("");
  expect(promoted.stderr).toBe("");

  const wholeRead = withinLimit(process.execPath, [join(scratchDir(), "whole-read.ts"), file]);
  expect(wholeRead.status).not.toBe(0);
}, 600_000);
