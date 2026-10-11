// Runs the readers of the trial: for one module in one arrangement, a number of independent reader
// sessions. Each is a headless model session with no tools and no repository, given the module's
// source, the glossary of its helpers and the questions, and asked for its answers as JSON.
//
//   bun --no-env-file --config=/dev/null run-readers.ts --module <name> --arrangement <name>
//     --source <file> --questions <questions.json> --glossary <glossary.md> --model <id>
//     --effort <low|medium|high|xhigh|max> --samples <n> --out <folder> --cwd <empty folder>
//     [--concurrency <k>] [--budget <usd per session>] [--mode careful|quick] [--thinking <tokens>]
//
// For sample i it writes <out>/<model>/<module>/<arrangement>/s<i>.json (the session's whole JSON
// result: reply, usage and cost) and s<i>.answers.json (the answers read out of the reply, or
// null). A sample that already has its file is skipped, so a run can be repeated or resumed and
// nothing recorded is overwritten. --mode says how the reader is asked to work (careful: trace
// step by step; quick: write nothing but the answers) and --thinking caps its thinking tokens. The prompt goes in on standard input, because a module is longer
// than an argument may be.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildPrompt, extractAnswers, type Mode, type Question } from "./reading.ts";

const SYSTEM = "You are a careful reader of source code. You cannot run code.";

const arg = (name: string, required = true): string => {
  const at = process.argv.indexOf(name);
  const value = at >= 0 ? process.argv[at + 1] : undefined;
  if (value === undefined && required) {
    console.error(`missing ${name}`);
    process.exit(2);
  }
  return value ?? "";
};

const READER_SCRIPT =
  'cd "$1" && exec env ${8:+MAX_THINKING_TOKENS="$8"} claude -p --model "$2" --tools "" --system-prompt "$3" --output-format json ' +
  '--no-session-persistence --effort "$4" --max-budget-usd "$5" < "$6" > "$7"';

async function runOne(
  job: Readonly<{ prompt: string; stem: string }>,
  config: Config,
): Promise<void> {
  const promptPath = `${job.stem}.prompt.txt`;
  writeFileSync(promptPath, job.prompt);
  const outPath = `${job.stem}.json`;
  const proc = Bun.spawn(
    [
      "bash",
      "-c",
      READER_SCRIPT,
      "_",
      config.cwd,
      config.model,
      SYSTEM,
      config.effort,
      config.budget,
      promptPath,
      outPath,
      config.thinking,
    ],
    { stdout: "ignore", stderr: "pipe" },
  );
  const code = await proc.exited;
  if (code !== 0) {
    console.error(`${job.stem}: reader exited ${code}`);
    return;
  }
  const raw: unknown = JSON.parse(readFileSync(outPath, "utf8"));
  const reply = typeof raw === "object" && raw !== null ? (raw as { result?: unknown }).result : "";
  const answers = extractAnswers(typeof reply === "string" ? reply : "");
  writeFileSync(`${job.stem}.answers.json`, `${JSON.stringify(answers)}\n`);
}

type Config = Readonly<{
  cwd: string;
  model: string;
  effort: string;
  budget: string;
  thinking: string;
}>;

async function main(): Promise<void> {
  const module = arg("--module");
  const arrangement = arg("--arrangement");
  const config: Config = {
    cwd: arg("--cwd"),
    model: arg("--model"),
    effort: arg("--effort"),
    budget: arg("--budget", false) || "2",
    thinking: arg("--thinking", false),
  };
  const mode = (arg("--mode", false) || "careful") as Mode;
  const samples = Number(arg("--samples"));
  const concurrency = Number(arg("--concurrency", false) || "4");
  const questions = JSON.parse(readFileSync(arg("--questions"), "utf8")) as Question[];
  const prompt = buildPrompt({
    file: `scripts/${module}.ts`,
    source: readFileSync(arg("--source"), "utf8"),
    glossary: readFileSync(arg("--glossary"), "utf8"),
    questions,
    mode,
  });
  const dir = join(arg("--out"), config.model, module, arrangement);
  mkdirSync(dir, { recursive: true });
  mkdirSync(config.cwd, { recursive: true });
  const jobs = Array.from({ length: samples }, (_, i) => join(dir, `s${i + 1}`))
    .filter((stem) => !existsSync(`${stem}.json`))
    .map((stem) => ({ prompt, stem }));
  console.log(
    `${module} ${arrangement} ${config.model}: ${jobs.length} of ${samples} samples to run`,
  );
  const queue = [...jobs];
  const worker = async (): Promise<void> => {
    for (let job = queue.shift(); job !== undefined; job = queue.shift()) await runOne(job, config);
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
}

if (import.meta.main) await main();
