#!/usr/bin/env bun
import {
  accessSync,
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { command, writeError } from "./lib/core.ts";

const self = fileURLToPath(import.meta.url);
const LEGS = ["synthesis", "review", "ship"];
type Spec = { harness?: unknown; model?: unknown; effort?: unknown; env_file?: unknown; [key: string]: unknown };
class LaunchError extends Error {
  constructor(
    message: string,
    readonly code = 1,
  ) {
    super(message);
  }
}
function die(message: string, code = 1): never {
  throw new LaunchError(message, code);
}
function humanError(error: unknown): string {
  return String((error as { message?: string }).message ?? error).replace(/^Error: /, "");
}
function table(value: unknown, what: string, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) die(`${what} in ${path} is not a table`);
  return value as Record<string, unknown>;
}
function parseConfig(
  source: string,
  recorded: boolean,
  name: string,
  leg: string,
): { config: Record<string, unknown>; spec: Spec } {
  let cfg: any;
  try {
    const text = readFileSync(source, "utf8");
    cfg = recorded ? JSON.parse(text) : Bun.TOML.parse(text);
  } catch (error) {
    die(`cannot read ${source}: ${humanError(error)}`);
  }
  if (recorded) {
    cfg = cfg && typeof cfg === "object" ? cfg.config : null;
    if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) die(`cannot read ${source}: it records no config`);
  }
  if (leg && !LEGS.includes(leg)) die(`no such leg: --leg ${leg}; the legs are synthesis, review and ship`);
  const config = cfg as Record<string, unknown>,
    lanes = table(config.lanes ?? {}, "[lanes]", source);
  const baseModel = (model: unknown) => String(model).replace(/(\[[^\]]*\])+$/, "");
  const laneModels = new Set<string>();
  for (const value of Object.values(lanes)) {
    if (value && typeof value === "object" && !Array.isArray(value) && (value as Spec).model)
      laneModels.add(baseModel((value as Spec).model));
  }
  const rejectLaneModel = (spec: unknown, label: string) => {
    if (spec && typeof spec === "object" && !Array.isArray(spec)) {
      const model = (spec as Spec).model;
      if (model && laneModels.has(baseModel(model)))
        die(`${label} in ${source} runs on ${String(model)}, a lane's model, and a coachman never does`);
    }
  };
  let selected: unknown;
  if (name === "coachman") {
    const team = table(config.team ?? {}, "[team]", source),
      legs = table(team.coachman_legs ?? {}, "[team.coachman_legs]", source);
    const merged = Object.keys(legs).filter((key) => ["style", "bug", "security"].includes(key));
    if (merged.length)
      die(
        `[team.coachman_legs] in ${source} names ${merged.join(", ")}: style, bug and security are one leg now, review; give review one entry instead`,
      );
    const unknown = Object.keys(legs).filter((key) => !LEGS.includes(key));
    if (unknown.length)
      die(
        `[team.coachman_legs] in ${source} names no such leg: ${unknown.join(", ")}; the legs are synthesis, review and ship`,
      );
    for (const [key, value] of Object.entries(legs)) {
      const legSpec = table(value, `[team.coachman_legs] ${key}`, source) as Spec;
      if (!legSpec.harness || !legSpec.model)
        die(`[team.coachman_legs] ${key} in ${source} needs a harness and a model`);
      rejectLaneModel(legSpec, `[team.coachman_legs] ${key}`);
    }
    rejectLaneModel(team.coachman, "team.coachman");
    selected = (leg ? legs[leg] : undefined) || team.coachman;
  } else if (name === "coachman_fallback") {
    const team = table(config.team ?? {}, "[team]", source);
    selected = team.coachman_fallback;
    rejectLaneModel(selected, "team.coachman_fallback");
  } else if (name === "postmaster") selected = table(config.team ?? {}, "[team]", source).postmaster;
  else selected = lanes[name];
  if (!selected) die(`no such lane or role in ${source}: ${name}`);
  return { config, spec: table(selected, name, source) as Spec };
}
function bashQuote(value: string): string {
  const result = command("bash", ["-c", "printf '%q' \"$1\"", "launch", value]);
  return result.code === 0 ? result.stdout : value;
}
function show(value: string): string {
  if ((value.startsWith("<") && value.endsWith(">")) || /=<.*>/.test(value) || value === "$(cat <prompt-file>)")
    return value;
  return bashQuote(value);
}
type Invocation = { args: string[]; data: string; stdinFile: string };
function buildInvocation(
  harness: string,
  mode: string,
  name: string,
  leg: string,
  cwd: string,
  prompt: string,
  promptText: string,
  thread: string,
  last: string,
  effort: string,
  run: string,
  home: string,
  formOutput = false,
): Invocation {
  let data = "",
    stdinFile = "";
  const args: string[] = [];
  const harnessData = (kind: string) => {
    if (mode === "form" || formOutput) return `<harness-data>/${kind}/<key>`;
    const directory = existsSync(cwd) ? command("pwd", [], { cwd }).stdout.trim() : resolve(cwd);
    const keyInput = `${run}|${directory}|${name}|${leg}`;
    const checksum = command("cksum", [], { input: keyInput }).stdout.trim().split(/\s+/)[0] ?? "";
    return join(
      process.env.POSTMASTER_HARNESS_DATA ?? join(home, ".postmaster", "harness-data"),
      kind,
      `${checksum}-${new TextEncoder().encode(keyInput).length}`,
    );
  };
  switch (harness) {
    case "codex":
      if (mode === "resume") args.push("codex", "exec", "resume", thread, "--json");
      else args.push("codex", "exec", "-C", cwd, "--json");
      if (last) args.push("-o", last);
      args.push(
        "-m",
        String(modelArg()),
        ...(effort ? ["-c", `model_reasoning_effort="${effort}"`] : []),
        "--dangerously-bypass-approvals-and-sandbox",
      );
      if (mode === "launch" && command("git", ["-C", cwd, "symbolic-ref", "-q", "HEAD"]).code !== 0)
        args.push("--skip-git-repo-check");
      if (mode === "resume") args.push("--");
      args.push(promptText);
      break;
    case "grok":
      args.push(
        ...(mode === "resume" ? ["grok", "--resume", thread, "-p", promptText] : ["grok", "--prompt-file", prompt]),
      );
      args.push(
        "-m",
        String(modelArg()),
        ...(effort ? ["--reasoning-effort", effort] : []),
        "--max-turns",
        "1000",
        "--always-approve",
        "--output-format",
        "streaming-json",
      );
      break;
    case "agy":
      if (mode === "resume")
        die("agy resume form is not recorded; relaunch against its conversationId by hand (harnesses.md)");
      args.push(
        "agy",
        "-p",
        promptText,
        "--model",
        String(modelArg()),
        "--output-format",
        "stream-json",
        "--dangerously-skip-permissions",
        "--add-dir",
        cwd,
      );
      break;
    case "claude":
      args.push(
        ...(mode === "resume" ? ["claude", "-p", "--resume", thread, promptText] : ["claude", "-p", promptText]),
      );
      args.push("--model", String(modelArg()), ...(effort ? ["--effort", effort] : []));
      if (process.env.POSTMASTER_LAUNCH_NAME) args.push("--name", process.env.POSTMASTER_LAUNCH_NAME);
      args.push("--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions");
      break;
    case "pi":
      args.push(
        "pi",
        "--mode",
        "json",
        "--approve",
        ...(mode === "resume" ? ["--session", thread] : []),
        "--model",
        String(modelArg()),
      );
      if (effort) args.push("--thinking", effort);
      if (process.env.POSTMASTER_LAUNCH_NAME) args.push("--name", process.env.POSTMASTER_LAUNCH_NAME);
      stdinFile = prompt;
      break;
    case "muse":
      data = harnessData("muse");
      args.push("env", `XDG_DATA_HOME=${data}`, "muse", "exec", "--json", "--prompt-file", prompt);
      if (mode === "resume") args.push("--session-id", thread);
      args.push("--model", String(modelArg()));
      if (effort) args.push("--reasoning-effort", effort);
      args.push("--yolo");
      stdinFile = "/dev/null";
      break;
    case "mimo":
      data = harnessData("mimo");
      args.push(
        "env",
        `XDG_DATA_HOME=${data}`,
        "MIMOCODE_DISABLE_CLAUDE_IMPORT=1",
        "mimo",
        "run",
        "--format",
        "json",
        "-m",
        String(modelArg()),
      );
      if (mode === "resume") args.push("-s", thread);
      if (effort) args.push("--variant", effort);
      if (mode === "launch" && process.env.POSTMASTER_LAUNCH_NAME)
        args.push("--title", process.env.POSTMASTER_LAUNCH_NAME);
      args.push("--dangerously-skip-permissions");
      stdinFile = prompt;
      break;
    default:
      die(`no form for harness '${harness}'`);
  }
  return { args, data, stdinFile };
  function modelArg(): unknown {
    return configuredModel;
  }
}
let configuredModel: unknown;
function formText(cwd: string, invocation: Invocation): string {
  return `cd ${show(cwd)} && ${invocation.args.map(show).join(" ")}${invocation.stdinFile ? ` < ${show(invocation.stdinFile)}` : ""}`;
}
function parseArgs(args: string[]): {
  command: string;
  name: string;
  leg: string;
  last: string;
  run: string;
  rest: string[];
} {
  if (args.length < 2) die("usage: launch.sh form|launch|resume|skill <name> ... | --self-test");
  const [mode, name, ...tail] = args;
  let leg = "",
    last = "",
    run = "";
  const rest: string[] = [];
  for (let i = 0; i < tail.length; i++) {
    const arg = tail[i]!;
    if (arg === "--leg") {
      if (i + 1 >= tail.length) die("--leg needs a value");
      leg = tail[++i]!;
    } else if (arg === "--last") {
      if (i + 1 >= tail.length) die("--last needs a file");
      last = tail[++i]!;
    } else if (arg === "--run") {
      if (i + 1 >= tail.length || !tail[i + 1]) die("--run needs a dispatch directory");
      run = tail[++i]!;
    } else rest.push(arg);
  }
  if (name === "coachman" && mode !== "form" && !leg) die(`coachman needs --leg synthesis, review or ship to ${mode}`);
  return { command: mode!, name: name!, leg, last, run, rest };
}
function readableFile(path: string): boolean {
  try {
    accessSync(path);
    return true;
  } catch {
    return false;
  }
}
function promptText(path: string): string {
  if (!existsSync(path) || !readableFile(path)) die(`prompt file missing, unreadable or empty: ${path}`);
  let text: string;
  try {
    text = readFileSync(path, "utf8").replace(/\n+$/, "");
  } catch {
    die(`cannot read the prompt file: ${path}`);
  }
  if (!text) die(`prompt file missing, unreadable or empty: ${path}`);
  return text;
}
function launch(args: string[]): number {
  const parsed = parseArgs(args),
    { command: mode, name, leg, last, run, rest } = parsed;
  const configPath = process.env.POSTMASTER_CONFIG ?? join(process.env.HOME ?? "", ".postmaster", "config.toml");
  let source: string,
    recorded = false;
  if (run) {
    source = join(run.replace(/\/$/, ""), "run.json");
    recorded = true;
    if (!existsSync(source))
      die(
        `no run.json in ${run}; inside a run, a launch or resume runs only on the config the run recorded at dispatch`,
      );
  } else {
    source = configPath;
    if (!existsSync(source)) die(`no config at ${configPath} (POSTMASTER_CONFIG overrides the path)`);
  }
  const { spec } = parseConfig(source, recorded, name, leg);
  const harness = String(spec.harness ?? ""),
    model = spec.model == null ? "" : String(spec.model);
  configuredModel = model;
  const effort = spec.effort == null ? "" : String(spec.effort);
  let envFile = spec.env_file == null ? "" : String(spec.env_file);
  if (!harness) die(`${name} has no harness in ${source}`);
  if (!model) die(`${name} has no model in ${source}`);
  if (command("sh", ["-c", 'command -v "$1" >/dev/null 2>&1', "launch", harness]).code !== 0)
    die(`harness '${harness}' is not on PATH`);
  if (envFile) {
    if (envFile.startsWith("~/")) envFile = join(process.env.HOME ?? homedir(), envFile.slice(2));
    if (!envFile.startsWith("/")) envFile = resolve(dirname(resolve(configPath)), envFile);
    if (!existsSync(envFile) || !readableFile(envFile))
      die(`env_file for ${name} not found or not readable: ${envFile}`);
  }
  if (mode === "skill") {
    if (rest.length !== 1) die("skill needs <skill>");
    if (rest[0] === "security-review") {
      if (harness === "claude") {
        process.stdout.write("/security-review\n");
        return 0;
      }
      writeError(`launch: ${name} runs on ${harness}, which has no security review skill recorded in harnesses.md`);
      return 3;
    }
    die(`no such skill: ${rest[0]}; the one skill is security-review`);
  }
  let cwd = "",
    prompt = "",
    thread = "",
    text = "";
  if (mode === "form") {
    if (rest.length) die("form takes no argument but --leg and --run");
    cwd = "<cwd>";
    prompt = "<prompt-file>";
    thread = "<thread-id>";
    text = "$(cat <prompt-file>)";
  } else if (mode === "launch") {
    if (rest.length !== 2) die("launch needs <cwd> <prompt-file>");
    cwd = rest[0]!;
    prompt = rest[1]!;
    text = promptText(prompt);
  } else if (mode === "resume") {
    if (rest.length !== 3) die("resume needs <cwd> <thread-id> <prompt-file>");
    cwd = rest[0]!;
    thread = rest[1]!;
    prompt = rest[2]!;
    if (!thread) die("resume needs a thread id, and none was given");
    text = promptText(prompt);
  } else die(`unknown command: ${mode}`);
  if (mode !== "form" && (!existsSync(cwd) || command("test", ["-d", cwd]).code !== 0))
    die(`no such directory: ${cwd}`);
  if (["pi", "muse", "mimo"].includes(harness) && mode !== "form") prompt = resolve(prompt);
  const launchInvocation = buildInvocation(
    harness,
    mode,
    name,
    leg,
    cwd,
    prompt,
    text,
    thread,
    last,
    effort,
    run,
    process.env.HOME ?? homedir(),
  );
  if (launchInvocation.data && mode !== "form") mkdirSync(launchInvocation.data, { recursive: true });
  if (mode === "form") {
    process.stdout.write(`launch: ${formText(cwd, launchInvocation)}\n`);
    try {
      const resume = buildInvocation(
        harness,
        "resume",
        name,
        leg,
        cwd,
        prompt,
        "$(cat <prompt-file>)",
        thread,
        last,
        effort,
        run,
        process.env.HOME ?? homedir(),
        true,
      );
      process.stdout.write(`resume: ${formText(cwd, resume)}\n`);
    } catch (error) {
      process.stdout.write(`resume: none: ${humanError(error).replace(/^launch: /, "")}\n`);
    }
    return 0;
  }
  if (launchInvocation.data && mode === "resume") {
    const held = mkdtempSync(join(tmpdir(), "launch-export-")),
      errFile = join(held, "err"),
      outFile = join(held, "thread.json");
    const exportArgs =
      harness === "muse" ? ["muse", "export", "--session", thread, "--out", outFile] : ["mimo", "export", thread];
    const exported = runHarness(
      exportArgs,
      cwd,
      envFile,
      "",
      { XDG_DATA_HOME: launchInvocation.data, MIMOCODE_DISABLE_CLAUDE_IMPORT: "1" },
      harness === "muse" ? "/dev/null" : "",
      errFile,
    );
    const why = readFileSync(errFile, "utf8")
      .replace(new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m", "g"), "")
      .replace(/\n/g, " ")
      .slice(0, 300);
    rmSync(held, { recursive: true, force: true });
    if (exported !== 0)
      die(
        `no ${harness} thread ${thread} in this launch's data directory, so nothing was resumed; resume from the directory, --leg and --run it was launched with (its export: ${why || "no message"})`,
      );
  }
  if (harness === "codex" && mode === "launch") {
    const home = process.env.HOME ?? homedir(),
      file = join(home, ".codex", "config.toml");
    mkdirSync(dirname(file), { recursive: true });
    if (!existsSync(file)) writeFileSync(file, "");
    const old = readFileSync(file, "utf8"),
      header = `[projects."${cwd}"]`;
    if (!old.includes(header)) appendFileSync(file, `\n${header}\ntrust_level = "trusted"\n`);
  }
  const childEnv: Record<string, string | undefined> = { ...process.env };
  delete childEnv.POSTMASTER_LAUNCH_NAME;
  return runHarness(launchInvocation.args, cwd, envFile, launchInvocation.stdinFile, {}, undefined, childEnv);
}
function runHarness(
  args: string[],
  cwd: string,
  envFile: string,
  stdinFile: string,
  extra: Record<string, string>,
  stderrPath?: string,
  inheritedEnv = process.env,
): number {
  let fd: number | undefined;
  if (stderrPath) fd = openSync(stderrPath, "w");
  const stdio: any[] = ["inherit", "inherit", fd ?? "inherit"];
  if (stdinFile) stdio[0] = openSync(stdinFile, "r");
  const shell = `if [ -n "$1" ]; then set -a; . "$1"; set +a; fi; shift; unset POSTMASTER_LAUNCH_NAME; exec "$@"`;
  const procArgs = ["-c", shell, "launch-env", envFile, ...args];
  const result = spawnSync("bash", procArgs, {
    cwd: cwd === "<cwd>" ? process.cwd() : cwd,
    env: { ...inheritedEnv, ...extra },
    stdio,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (typeof stdio[0] === "number") closeIfNumber(stdio[0]);
  if (fd !== undefined) closeIfNumber(fd);
  return typeof result.status === "number" ? result.status : result.error ? 127 : 1;
}
function closeIfNumber(fd: number): void {
  try {
    closeSync(fd);
  } catch {
    /* The child may have closed it. */
  }
}
function selfTest(): number {
  const tmp = mkdtempSync(join(tmpdir(), "launch-test-")),
    bin = join(tmp, "bin");
  mkdirSync(bin);
  let fails = 0;
  const ok = (label: string, passed: boolean, detail = "") => {
    process.stdout.write(`  ${passed ? "ok   " : "FAIL "}${label}\n`);
    if (!passed) {
      process.stdout.write(`         ${detail}\n`);
      fails++;
    }
  };
  const write = (name: string, text: string) => writeFileSync(join(tmp, name), text);
  const invoke = (fixture: string, args: string[], extra: Record<string, string> = {}) =>
    command("bun", [self, ...args], {
      env: {
        ...process.env,
        POSTMASTER_CONFIG: join(tmp, fixture + ".toml"),
        PATH: bin + ":" + process.env.PATH,
        ...extra,
      },
      timeout: 15000,
    });
  for (const harness of ["claude", "pi", "codex", "muse", "mimo", "grok", "agy"])
    writeFileSync(join(bin, harness), `#!/bin/sh\nprintf '%s\\n' "$@"\n`, { mode: 0o755 });
  write("prompt.txt", "Keep going, then stop.\n");
  write(
    "basic.toml",
    '[lanes.one]\nharness="claude"\nmodel="lane-model"\n[team]\ncoachman={harness="claude",model="coach-model"}\n[team.coachman_legs]\nsynthesis={harness="claude",model="synthesis-model"}\nreview={harness="claude",model="review-model"}\nship={harness="claude",model="ship-model"}\n',
  );
  let r = invoke("basic", ["form", "coachman", "--leg", "review"]);
  ok(
    "form prints launch and resume commands for the chosen leg",
    r.code === 0 && r.stdout.includes("--model review-model") && r.stdout.includes("resume: cd <cwd>"),
  );
  r = invoke("basic", ["form", "coachman"]);
  ok("form without a leg shows team.coachman", r.code === 0 && r.stdout.includes("--model coach-model"));
  r = invoke("basic", ["launch", "one", tmp, join(tmp, "prompt.txt")]);
  ok(
    "a harness launch receives the configured model and prompt",
    r.code === 0 && r.stdout.includes("lane-model") && r.stdout.includes("Keep going"),
    `exit ${r.code}: ${r.stdout}${r.stderr}`,
  );
  r = invoke("basic", ["form", "coachman", "--leg", "style"]);
  ok("an invalid coachman leg is refused", r.code === 1 && r.stderr.includes("no such leg"));
  r = invoke("basic", ["resume", "one", tmp, "", join(tmp, "prompt.txt")]);
  ok("a resume with no thread id is refused", r.code === 1 && r.stderr.includes("resume needs a thread id"));
  write(
    "same-model.toml",
    '[lanes.one]\nharness="claude"\nmodel="lane-model[1m]"\n[team]\ncoachman={harness="claude",model="lane-model[2m]"}\n',
  );
  r = invoke("same-model", ["form", "coachman"]);
  ok("a coachman on a lane's base model is refused", r.code === 1 && r.stderr.includes("a lane's model"));
  rmSync(tmp, { recursive: true, force: true });
  process.stdout.write(fails ? `self-test: ${fails} control(s) misbehaved\n` : "self-test: all controls behaved\n");
  return fails ? 1 : 0;
}
function main(args: string[]): number {
  try {
    if (args[0] === "--self-test" && args.length === 1) return selfTest();
    return launch(args);
  } catch (error) {
    const failure = error instanceof LaunchError ? error : new LaunchError(humanError(error));
    writeError(`launch: ${failure.message}`);
    return failure.code;
  }
}
process.exit(main(process.argv.slice(2)));
