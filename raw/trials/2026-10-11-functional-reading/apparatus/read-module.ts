// Runs every reading of one module: each of its arrangements, in careful mode and in quick mode,
// by starting run-readers.ts once for each of them, all at the same time.
//
//   bun --no-env-file --config=/dev/null read-module.ts --trial <trial folder> --module <name>
//     --cwd <empty folder> [--model <id>] [--samples <n>] [--concurrency <k>]
//     [--arrangements original,functional,tidy] [--modes careful,quick]
//
// Reads <trial>/arrangements/<module>/<arrangement>.ts and <trial>/questions/<module>/, and writes
// the sessions under <trial>/readers-<mode>/. The reasoning effort is medium in careful mode and
// low in quick mode, as method.md fixes. Sessions that already exist are not run again.
import { join } from "node:path";

const arg = (name: string, fallback?: string): string => {
  const at = process.argv.indexOf(name);
  const value = at >= 0 ? process.argv[at + 1] : fallback;
  if (value === undefined) {
    console.error(`missing ${name}`);
    process.exit(2);
  }
  return value;
};

const EFFORT: Readonly<Record<string, string>> = { careful: "medium", quick: "low" };

async function main(): Promise<number> {
  const trial = arg("--trial");
  const module = arg("--module");
  const here = import.meta.dir;
  const model = arg("--model", "claude-haiku-5-5");
  const arrangements = arg("--arrangements", "original,functional,tidy").split(",");
  const modes = arg("--modes", "careful,quick").split(",");
  const jobs = modes.flatMap((mode) =>
    arrangements.map((arrangement) => {
      const cmd = [
        "bun",
        "--no-env-file",
        "--config=/dev/null",
        join(here, "run-readers.ts"),
        "--module",
        module,
        "--arrangement",
        arrangement,
        "--source",
        join(trial, "arrangements", module, `${arrangement}.ts`),
        "--questions",
        join(trial, "questions", module, "questions.json"),
        "--glossary",
        join(trial, "questions", module, "glossary.md"),
        "--model",
        model,
        "--effort",
        EFFORT[mode] ?? "medium",
        "--mode",
        mode,
        "--samples",
        arg("--samples", "7"),
        "--concurrency",
        arg("--concurrency", "3"),
        "--out",
        join(trial, `readers-${mode}`),
        "--cwd",
        arg("--cwd"),
      ];
      return Bun.spawn(cmd, { stdout: "inherit", stderr: "inherit" });
    }),
  );
  const codes = await Promise.all(jobs.map((j) => j.exited));
  return codes.every((c) => c === 0) ? 0 : 1;
}

if (import.meta.main) process.exit(await main());
