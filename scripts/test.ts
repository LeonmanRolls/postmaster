// Run Bun tests through scripts/run without a project shell command.
import { spawnSync } from "node:child_process";
import { scriptsDir } from "./lib/paths.ts";
import { join } from "node:path";

const HERE = scriptsDir(import.meta);
const CONFIG = join(HERE, "bunfig.toml");

type Runner = (program: string, args: string[]) => number;

export function runTests(files: readonly string[], runner: Runner): number {
  if (files.length === 0 || files.some((file) => file.trim() === "")) {
    process.stderr.write("usage: run test <test-file> [<test-file>...]\n");
    return 1;
  }
  return runner(process.execPath, ["--no-env-file", "--config", CONFIG, "test", ...files]);
}

const runBunTests: Runner = (program, args) => {
  const result = spawnSync(program, args, { stdio: "inherit" });
  if (result.error) {
    process.stderr.write(`test: ${result.error.message}\n`);
    return 1;
  }
  return result.status ?? 1;
};

if (import.meta.main) process.exit(runTests(process.argv.slice(2), runBunTests));
