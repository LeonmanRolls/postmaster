// Launch or resume a lane or a role by name, from the config, in the exact form harnesses.md
// records for its harness. One command for every harness, so no form is ever copied by hand;
// this script and harnesses.md must agree, and a change to one is a change to both.
//
//   launch.sh form   <name> [--leg <leg>] [--run <dispatch>]
//   launch.sh launch <name> <cwd> <prompt-file> [--leg <leg>] [--last <file>] [--run <dispatch>]
//   launch.sh resume <name> <cwd> <thread-id> <prompt-file> [--leg <leg>] [--last <file>]
//                    [--run <dispatch>]
//   launch.sh skill  <name> <skill> [--run <dispatch>]
//   launch.sh --self-test
//
//   exit 0  the forms or the skill's prompt were printed, or the harness exited 0
//   exit 1  usage, config or run.json missing or unreadable, unknown name, a leg that is not
//           synthesis, review or ship, the coachman launched or resumed with no --leg, a
//           coachman or fallback on a lane's model, harness not on PATH, env_file missing, a
//           form this script does not have (agy resume), a skill that is not security-review,
//           or a muse or mimo resume of a thread the launch's data directory does not hold
//   exit 3  skill: the lane's harness has no such skill recorded
//   else    the harness's own exit code

import { spawnSync } from "node:child_process";
import {
  accessSync,
  chmodSync,
  existsSync,
  constants as fsConstants,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { readTomlFile, tryJsonFile } from "./lib/data.ts";
import { scriptsDir } from "./lib/paths.ts";
import { run, withTempDir } from "./lib/proc.ts";
import { SelfTest } from "./lib/selftest.ts";

const CONFIG =
  process.env.POSTMASTER_CONFIG ?? join(process.env.HOME ?? "", ".postmaster/config.toml");
const LEGS = ["synthesis", "review", "ship"] as const;

function die(msg: string): never {
  console.error(`launch: ${msg}`);
  process.exit(1);
}

interface Spec {
  harness: string;
  model: string;
  effort: string;
  envFile: string;
}

function baseModel(model: unknown): string {
  return String(model ?? "").replace(/(\[[^\]]*\])+$/, "");
}

function resolveSpec(sourcePath: string, name: string, leg: string, recorded: boolean): Spec {
  let cfg: Record<string, unknown>;
  if (recorded) {
    const data = tryJsonFile<Record<string, unknown>>(sourcePath);
    if (!data) die(`cannot read ${sourcePath}: it does not parse`);
    const c = data.config;
    if (c === null || typeof c !== "object" || Array.isArray(c)) {
      die(`cannot read ${sourcePath}: it records no config`);
    }
    cfg = c as Record<string, unknown>;
  } else {
    try {
      cfg = readTomlFile(sourcePath);
    } catch (e) {
      die(`cannot read ${sourcePath}: ${String(e)}`);
    }
  }
  if (leg && !(LEGS as readonly string[]).includes(leg)) {
    die(`no such leg: --leg ${leg}; the legs are synthesis, review and ship`);
  }
  const lanes = (cfg.lanes as Record<string, unknown>) ?? {};
  const laneModels = new Set(
    Object.values(lanes)
      .filter((v) => v !== null && typeof v === "object" && (v as Record<string, unknown>).model)
      .map((v) => baseModel((v as Record<string, unknown>).model)),
  );
  const notALane = (spec: unknown, what: string): void => {
    if (
      spec !== null &&
      typeof spec === "object" &&
      (spec as Record<string, unknown>).model &&
      laneModels.has(baseModel((spec as Record<string, unknown>).model))
    ) {
      die(
        `${what} in ${sourcePath} runs on ${(spec as Record<string, unknown>).model}, a lane's model, and a coachman never does`,
      );
    }
  };
  let spec: unknown;
  if (name === "coachman") {
    const team = (cfg.team as Record<string, unknown>) ?? {};
    const legs = (team.coachman_legs as Record<string, unknown>) ?? {};
    const merged = Object.keys(legs).filter((k) => ["style", "bug", "security"].includes(k));
    if (merged.length > 0) {
      die(
        `[team.coachman_legs] in ${sourcePath} names ${merged.join(", ")}: style, bug and security are one leg now, review; give review one entry instead`,
      );
    }
    const unknown = Object.keys(legs).filter((k) => !(LEGS as readonly string[]).includes(k));
    if (unknown.length > 0) {
      die(
        `[team.coachman_legs] in ${sourcePath} names no such leg: ${unknown.join(", ")}; the legs are synthesis, review and ship`,
      );
    }
    for (const [k, v] of Object.entries(legs)) {
      if (v === null || typeof v !== "object" || Array.isArray(v)) {
        die(`[team.coachman_legs] ${k} in ${sourcePath} is not a table`);
      }
      const vt = v as Record<string, unknown>;
      if (!vt.harness || !vt.model) {
        die(`[team.coachman_legs] ${k} in ${sourcePath} needs a harness and a model`);
      }
      notALane(v, `[team.coachman_legs] ${k}`);
    }
    notALane(team.coachman, "team.coachman");
    spec = (leg ? legs[leg] : undefined) ?? team.coachman;
  } else if (name === "coachman_fallback") {
    const team = (cfg.team as Record<string, unknown>) ?? {};
    if (team === null || typeof team !== "object") die(`[team] in ${sourcePath} is not a table`);
    spec = team.coachman_fallback;
    notALane(spec, "team.coachman_fallback");
  } else if (name === "postmaster") {
    const team = (cfg.team as Record<string, unknown>) ?? {};
    spec = team.postmaster;
  } else {
    spec = lanes[name];
  }
  if (!spec) die(`no such lane or role in ${sourcePath}: ${name}`);
  if (spec === null || typeof spec !== "object" || Array.isArray(spec)) {
    die(`${name} in ${sourcePath} is not a table`);
  }
  const s = spec as Record<string, unknown>;
  const str = (v: unknown): string => (v === undefined || v === null ? "" : String(v));
  return {
    harness: str(s.harness),
    model: str(s.model),
    effort: str(s.effort),
    envFile: str(s.env_file),
  };
}

interface FormsResult {
  cmd: string[];
  data: string;
  stdinFile: string;
}

function harnessData(
  harness: string,
  cmdMode: string,
  cwd: string,
  name: string,
  leg: string,
  runDir: string,
): string {
  if (cmdMode === "form" || cmdMode === "form-resume") return `<harness-data>/${harness}/<key>`;
  const root =
    process.env.POSTMASTER_HARNESS_DATA ?? join(process.env.HOME ?? "", ".postmaster/harness-data");
  const key = `${runDir}|${resolve(cwd)}|${name}|${leg}`;
  // cksum equivalent: use a simple hash
  let sum = 0;
  for (let i = 0; i < key.length; i++) {
    sum = (sum * 31 + key.charCodeAt(i)) >>> 0;
  }
  return `${root}/${harness}/${sum}`;
}

function buildForms(
  harness: string,
  cmdMode: string,
  cwd: string,
  prompt: string,
  promptText: string,
  thread: string,
  model: string,
  effort: string,
  last: string,
  name: string,
  leg: string,
  runDir: string,
): FormsResult {
  let data = "";
  let stdinFile = "";
  const cmd: string[] = [];
  const isResume = cmdMode === "resume" || cmdMode === "form-resume";
  switch (harness) {
    case "codex": {
      if (isResume) cmd.push("codex", "exec", "resume", thread, "--json");
      else cmd.push("codex", "exec", "-C", cwd, "--json");
      if (last) cmd.push("-o", last);
      cmd.push("-m", model);
      if (effort) cmd.push("-c", `model_reasoning_effort="${effort}"`);
      cmd.push("--dangerously-bypass-approvals-and-sandbox");
      if (cmdMode === "launch") {
        const ref = run("git", ["-C", cwd, "symbolic-ref", "-q", "HEAD"]);
        if (ref.code !== 0) cmd.push("--skip-git-repo-check");
      }
      if (isResume) cmd.push("--");
      cmd.push(promptText);
      break;
    }
    case "grok": {
      if (isResume) cmd.push("grok", "--resume", thread, "-p", promptText);
      else cmd.push("grok", "--prompt-file", prompt);
      cmd.push("-m", model);
      if (effort) cmd.push("--reasoning-effort", effort);
      cmd.push("--max-turns", "1000", "--always-approve", "--output-format", "stream-json");
      break;
    }
    case "agy": {
      if (isResume) {
        throw new Error(
          "agy resume form is not recorded; relaunch against its conversationId by hand (harnesses.md)",
        );
      }
      cmd.push(
        "agy",
        "-p",
        promptText,
        "--model",
        model,
        "--output-format",
        "stream-json",
        "--dangerously-skip-permissions",
        "--add-dir",
        cwd,
      );
      break;
    }
    case "claude": {
      if (isResume) cmd.push("claude", "-p", "--resume", thread, promptText);
      else cmd.push("claude", "-p", promptText);
      cmd.push("--model", model);
      if (effort) cmd.push("--effort", effort);
      const launchName = process.env.POSTMASTER_LAUNCH_NAME;
      if (launchName) cmd.push("--name", launchName);
      cmd.push("--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions");
      break;
    }
    case "pi": {
      cmd.push("pi", "--mode", "json", "--approve");
      if (isResume) cmd.push("--session", thread);
      cmd.push("--model", model);
      if (effort) cmd.push("--thinking", effort);
      const launchName = process.env.POSTMASTER_LAUNCH_NAME;
      if (launchName) cmd.push("--name", launchName);
      stdinFile = prompt;
      break;
    }
    case "muse": {
      data = harnessData("muse", cmdMode, cwd, name, leg, runDir);
      cmd.push("env", `XDG_DATA_HOME=${data}`, "muse", "exec", "--json", "--prompt-file", prompt);
      if (isResume) cmd.push("--session-id", thread);
      cmd.push("--model", model);
      if (effort) cmd.push("--reasoning-effort", effort);
      cmd.push("--yolo"); /*BYPASS*/
      stdinFile = "/dev/null";
      break;
    }
    case "mimo": {
      data = harnessData("mimo", cmdMode, cwd, name, leg, runDir);
      cmd.push(
        "env",
        `XDG_DATA_HOME=${data}`,
        "MIMOCODE_DISABLE_CLAUDE_IMPORT=1",
        "mimo",
        "run",
        "--format",
        "json",
        "-m",
        model,
      );
      if (isResume) cmd.push("-s", thread);
      if (effort) cmd.push("--variant", effort);
      if (cmdMode === "launch") {
        const launchName = process.env.POSTMASTER_LAUNCH_NAME;
        if (launchName) cmd.push("--title", launchName);
      }
      cmd.push("--dangerously-skip-permissions"); /*BYPASS*/
      stdinFile = prompt;
      break;
    }
    default:
      die(`no form for harness '${harness}'`);
  }
  return { cmd, data, stdinFile };
}

function shellQuote(s: string): string {
  // bash's printf %q: '' when empty, $'...' with escapes for control characters, and a
  // backslash before each character outside bash's unquoted-safe set otherwise.
  if (s === "") return "''";
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(s)) {
    const named: Record<string, string> = {
      "\\": "\\\\",
      "'": "\\'",
      "\n": "\\n",
      "\t": "\\t",
      "\r": "\\r",
      "\x00": "\\0",
      "\x07": "\\a",
      "\x08": "\\b",
      "\x0b": "\\v",
      "\x0c": "\\f",
      "\x1b": "\\e",
    };
    return (
      "$'" +
      // eslint-disable-next-line no-control-regex
      s.replace(
        /[\x00-\x1f\x7f\\']/g,
        (c) => named[c] ?? `\\${c.charCodeAt(0).toString(8).padStart(3, "0")}`,
      ) +
      "'"
    );
  }
  return s.replace(/[ !"#$&'()*,;:<>?[\\\]^`{|}~]/g, "\\$&");
}

function showArg(a: string): string {
  if (/^<.*>$/.test(a) || /=<.*>$/.test(a) || a === "$(cat <prompt-file>)") return `${a} `;
  return `${shellQuote(a)} `;
}

function _putForm(cwd: string, cmd: string[], stdinFile: string): string {
  let s = `cd ${showArg(cwd)}&& `;
  for (const a of cmd) s += showArg(a);
  if (stdinFile) s += `< ${showArg(stdinFile)}`;
  return s.trimEnd();
}

// --- entry ------------------------------------------------------------------------------
const argv = process.argv.slice(2);

if (argv[0] === "--self-test") {
  // self-test below
} else {
  if (argv.length < 2) die("usage: launch.sh form|launch|resume|skill <name> ... | --self-test");
  const CMD: string = argv[0] ?? "";
  const NAME = argv[1] ?? "";
  let LEG = "";
  let LAST = "";
  let RUN = "";
  const args: string[] = [];
  let i = 2;
  while (i < argv.length) {
    const a = argv[i];
    if (a === "--leg") {
      if (i + 1 >= argv.length) die("--leg needs a value");
      LEG = argv[i + 1] ?? "";
      i += 2;
    } else if (a === "--last") {
      if (i + 1 >= argv.length) die("--last needs a file");
      LAST = argv[i + 1] ?? "";
      i += 2;
    } else if (a === "--run") {
      if (i + 1 >= argv.length || !argv[i + 1]) die("--run needs a dispatch directory");
      RUN = argv[i + 1] ?? "";
      i += 2;
    } else {
      args.push(a ?? "");
      i += 1;
    }
  }
  if (NAME === "coachman" && CMD !== "form" && !LEG) {
    die(`coachman needs --leg synthesis, review or ship to ${CMD}`);
  }

  let source: string;
  let recorded = false;
  if (RUN) {
    source = join(RUN.replace(/\/$/, ""), "run.json");
    if (!existsSync(source)) {
      die(
        `no run.json in ${RUN}; inside a run, a launch or resume runs only on the config the run recorded at dispatch`,
      );
    }
    recorded = true;
  } else {
    source = CONFIG;
    if (!existsSync(source)) {
      die(`no config at ${CONFIG} (POSTMASTER_CONFIG overrides the path)`);
    }
  }
  const spec = resolveSpec(source, NAME, LEG, recorded);
  const HARNESS = spec.harness;
  const MODEL = spec.model;
  const EFFORT = spec.effort;
  let ENV_FILE = spec.envFile;
  if (!HARNESS) die(`${NAME} has no harness in ${source}`);
  if (!MODEL) die(`${NAME} has no model in ${source}`);
  const pathCheck = spawnSync("sh", ["-c", `command -v ${JSON.stringify(HARNESS)}`], {
    encoding: "utf8",
  });
  if (pathCheck.status !== 0) die(`harness '${HARNESS}' is not on PATH`);
  if (ENV_FILE) {
    if (ENV_FILE.startsWith("~")) {
      ENV_FILE = (process.env.HOME ?? "") + ENV_FILE.slice(1);
    }
    if (!ENV_FILE.startsWith("/")) {
      ENV_FILE = join(dirname(resolve(source)), ENV_FILE);
    }
    try {
      accessSync(ENV_FILE, fsConstants.R_OK);
    } catch {
      die(`env_file for ${NAME} not found or not readable: ${ENV_FILE}`);
    }
  }

  if (CMD === "skill") {
    if (args.length !== 1) die("skill needs <skill>");
    const skill = args[0] ?? "";
    if (HARNESS === "claude" && skill === "security-review") {
      console.log("/security-review");
      process.exit(0);
    } else if (skill === "security-review") {
      console.error(
        `launch: ${NAME} runs on ${HARNESS}, which has no security review skill recorded in harnesses.md`,
      );
      process.exit(3);
    } else {
      die(`no such skill: ${skill}; the one skill is security-review`);
    }
  }

  let CWD = "";
  let PROMPT = "";
  let THREAD = "";
  let PTEXT = "";
  const promptText = (): void => {
    try {
      accessSync(PROMPT, fsConstants.R_OK);
      const st = readFileSync(PROMPT);
      if (st.length === 0) throw new Error("empty");
      PTEXT = st.toString("utf8");
    } catch {
      die(`prompt file missing, unreadable or empty: ${PROMPT}`);
    }
  };

  if (CMD === "form") {
    if (args.length !== 0) die("form takes no argument but --leg and --run");
    CWD = "<cwd>";
    PROMPT = "<prompt-file>";
    THREAD = "<thread-id>";
    PTEXT = "$(cat <prompt-file>)";
  } else if (CMD === "launch") {
    if (args.length !== 2) die("launch needs <cwd> <prompt-file>");
    CWD = args[0] ?? "";
    PROMPT = args[1] ?? "";
    promptText();
  } else if (CMD === "resume") {
    if (args.length !== 3) die("resume needs <cwd> <thread-id> <prompt-file>");
    CWD = args[0] ?? "";
    THREAD = args[1] ?? "";
    PROMPT = args[2] ?? "";
    if (!THREAD) die("resume needs a thread id, and none was given");
    promptText();
  } else {
    die(`unknown command: ${CMD}`);
  }
  if (CMD !== "form") {
    try {
      accessSync(CWD, fsConstants.F_OK);
    } catch {
      die(`no such directory: ${CWD}`);
    }
  }
  // For pi/muse/mimo, the prompt file is resolved to an absolute path (read after the cd).
  if (["pi", "muse", "mimo"].includes(HARNESS) && CMD !== "form") {
    const promptDir = dirname(resolve(PROMPT));
    PROMPT = join(promptDir, basename(PROMPT));
  }

  const mkForms = (cmdMode: string): FormsResult =>
    buildForms(HARNESS, cmdMode, CWD, PROMPT, PTEXT, THREAD, MODEL, EFFORT, LAST, NAME, LEG, RUN);

  if (CMD === "form") {
    const show = (a: string): string => showArg(a);
    const put = (cwd: string, cmd: string[], stdinFile: string): string => {
      let s = `cd ${show(cwd)}&& `;
      for (const a of cmd) s += show(a);
      if (stdinFile) s += `< ${show(stdinFile)}`;
      return s;
    };
    const launchForms = mkForms("form");
    process.stdout.write(`launch: ${put(CWD, launchForms.cmd, launchForms.stdinFile)}\n`);
    try {
      const resumeForms = (() => {
        // Build the resume form: as the launch form's twin, with a placeholder data directory.
        return buildForms(
          HARNESS,
          "form-resume",
          CWD,
          PROMPT,
          PTEXT,
          THREAD,
          MODEL,
          EFFORT,
          LAST,
          NAME,
          LEG,
          RUN,
        );
      })();
      process.stdout.write(`resume: ${put(CWD, resumeForms.cmd, resumeForms.stdinFile)}\n`);
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e).replace(/^launch: /, "");
      process.stdout.write(`resume: none: ${msg}\n`);
    }
    process.exit(0);
  }

  const forms = mkForms(CMD);
  const DATA = forms.data;
  const STDIN_FILE = forms.stdinFile;

  if (DATA) {
    try {
      mkdirSync(DATA, { recursive: true });
    } catch {
      die(`cannot create ${DATA}`);
    }
  }

  // muse/mimo resume: verify the thread exists in this launch's data directory.
  if (CMD === "resume" && DATA) {
    const held = join(process.env.TMPDIR ?? "/tmp", `launch-held-${process.pid}-${Date.now()}`);
    mkdirSync(held, { recursive: true });
    const exportCmd =
      HARNESS === "muse"
        ? ["muse", "export", "--session", THREAD, "--out", join(held, "thread.json")]
        : ["mimo", "export", THREAD];
    const expResult = spawnSync(exportCmd[0] ?? "", exportCmd.slice(1), {
      cwd: CWD,
      encoding: "utf8",
      env: {
        ...process.env,
        XDG_DATA_HOME: DATA,
        MIMOCODE_DISABLE_CLAUDE_IMPORT: "1",
        ...(ENV_FILE
          ? Object.fromEntries(
              readFileSync(ENV_FILE, "utf8")
                .split("\n")
                .filter((l) => l.includes("="))
                .map((l) => {
                  const idx = l.indexOf("=");
                  return [l.slice(0, idx), l.slice(idx + 1)];
                }),
            )
          : {}),
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    const why = (expResult.stderr ?? "")
      .replace(/\x1b\[[0-9;]*m/g, "")
      .replace(/\n/g, " ")
      .slice(0, 300);
    rmSync(held, { recursive: true, force: true });
    if (expResult.status !== 0) {
      die(
        `no ${HARNESS} thread ${THREAD} in this launch's data directory, so nothing was resumed; resume from the directory, --leg and --run it was launched with (its export: ${why || "no message"})`,
      );
    }
  }

  // Codex: mark the worktree trusted first.
  if (HARNESS === "codex" && CMD === "launch") {
    const codexDir = join(process.env.HOME ?? "", ".codex");
    mkdirSync(codexDir, { recursive: true });
    const codexConfig = join(codexDir, "config.toml");
    if (!existsSync(codexConfig)) writeFileSync(codexConfig, "");
    const existing = readFileSync(codexConfig, "utf8");
    if (!existing.includes(`[projects."${CWD}"]`)) {
      writeFileSync(codexConfig, `${existing}\n[projects."${CWD}"]\ntrust_level = "trusted"\n`);
    }
  }

  // Enter the working directory and exec the harness.
  try {
    process.chdir(CWD);
  } catch {
    die(`cannot enter ${CWD}`);
  }
  // Load env_file into the environment (it reaches the harness only).
  if (ENV_FILE) {
    try {
      const envText = readFileSync(ENV_FILE, "utf8");
      for (const line of envText.split("\n")) {
        const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
        if (m) process.env[m[1] ?? ""] = m[2] ?? "";
      }
    } catch {
      /* already checked readable */
    }
  }
  delete process.env.POSTMASTER_LAUNCH_NAME;

  const child = spawnSync(forms.cmd[0] ?? "", forms.cmd.slice(1), {
    stdio: STDIN_FILE ? ["ignore", "inherit", "inherit"] : ["inherit", "inherit", "inherit"],
    ...(STDIN_FILE ? { input: readFileSync(STDIN_FILE, "utf8") } : {}),
  });
  process.exit(child.status ?? 1);
}

// --- self-test ----------------------------------------------------------------------------
const self = join(scriptsDir(import.meta), "launch.sh");
const here = scriptsDir(import.meta);

withTempDir((tmp) => {
  const st = new SelfTest();
  let out = "";
  let err = "";
  let rc = 0;
  let envx: Record<string, string> = {};

  // Stub harnesses first on PATH.
  mkdirSync(join(tmp, "bin"), { recursive: true });
  mkdirSync(join(tmp, "wt"), { recursive: true });
  for (const h of ["claude", "pi", "codex"]) {
    writeFileSync(join(tmp, "bin", h), '#!/bin/sh\necho "$@ probe=${PROBE:-}"\n');
    chmodSync(join(tmp, "bin", h), 0o755);
  }
  writeFileSync(
    join(tmp, "bin/mimo"),
    `#!/bin/sh\n[ "$1" = export ] && { [ -e "$XDG_DATA_HOME/$2" ] && exit 0; echo "Session not found: $2" >&2; exit 1; }\nprintf "%s probe=%s stdin=%s import-off=%s data=%s\\n" "$*" "\${PROBE:-}" "$(cat)" "\${MIMOCODE_DISABLE_CLAUDE_IMPORT:-}" "\${XDG_DATA_HOME:-}"\n`,
  );
  chmodSync(join(tmp, "bin/mimo"), 0o755);
  writeFileSync(
    join(tmp, "bin/muse"),
    `#!/bin/sh\n[ "$1" = export ] && { [ -e "$XDG_DATA_HOME/$3" ] && : > "$5" && exit 0; echo "no retained session log found for session $3" >&2; exit 1; }\nprintf "%s probe=%s stdin=%s data=%s\\n" "$*" "\${PROBE:-}" "$(cat)" "\${XDG_DATA_HOME:-}"\n`,
  );
  chmodSync(join(tmp, "bin/muse"), 0o755);
  writeFileSync(join(tmp, "prompt.txt"), "Continue.\n");

  const fixture = (name: string, ...keys: string[]): void => {
    let body = `[lanes.one]\nharness = "claude"\nmodel = "lane-model"\n\n[team]\n`;
    body += `coachman = { harness = "claude", model = "coach-model" }\n`;
    body += `coachman_fallback = { harness = "claude", model = "fallback-model" }\n\n[team.coachman_legs]\n`;
    for (const k of keys) body += `${k} = { harness = "claude", model = "${k}-model" }\n`;
    writeFileSync(join(tmp, `${name}.toml`), body);
  };
  const rawfix = (name: string, teamBody: string): void => {
    fixture(name);
    writeFileSync(join(tmp, `${name}.toml`), teamBody, { flag: "a" });
  };

  // Codex forms
  writeFileSync(join(tmp, "bin/codex"), '#!/bin/sh\nprintf "%s\\n" "$PWD" "$@"\n');
  chmodSync(join(tmp, "bin/codex"), 0o755);
  const codexfix = (name: string, laneKeys: string): void => {
    let body = `[lanes.one]\nharness = "codex"\n${laneKeys}\n\n[team]\n`;
    body += `coachman = { harness = "codex", model = "coach-model" }\n\n[team.coachman_legs]\n`;
    body += `review = { harness = "codex", model = "review-model", effort = "medium" }\n`;
    writeFileSync(join(tmp, `${name}.toml`), body);
  };
  codexfix("codex", 'model = "lane-model"\neffort = "high"');
  codexfix("codex-noeffort", 'model = "lane-model"');
  codexfix("codex-nomodel", 'effort = "high"');
  writeFileSync(join(tmp, "ruling.txt"), "- Keep going, then stop.\n");
  writeFileSync(join(tmp, "brief.txt"), "Keep going, then stop.\n");
  run("git", ["init", "-q", "-b", "main", join(tmp, "cx")]);
  run("git", [
    "-C",
    join(tmp, "cx"),
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@example.invalid",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "init",
  ]);
  run("git", [
    "-C",
    join(tmp, "cx"),
    "worktree",
    "add",
    "-q",
    "--detach",
    join(tmp, "cx-detached"),
  ]);

  const lines = (...args: string[]): string => args.join("\n");
  // bash's $(...) strips trailing newlines; comparisons are made on that form.
  const bashOut = (s: string): string => s.replace(/\n+$/, "");

  const doRun = (...args: string[]): void => {
    const f = args[0] ?? "";
    const rest = args.slice(1);
    const env: Record<string, string | undefined> = {
      ...process.env,
      ...envx,
      POSTMASTER_CONFIG: join(tmp, `${f}.toml`),
      PATH: `${join(tmp, "bin")}:${process.env.PATH ?? ""}`,
    };
    const r = spawnSync(self, rest, { encoding: "utf8", env });
    out = r.stdout ?? "";
    err = r.stderr ?? "";
    rc = r.status ?? 1;
  };

  const ok = (label: string): void => st.ok(label);
  const fail = (label: string): void => st.fail(`${label} (exit ${rc})`, out + err);

  const runsAs = (label: string, f: string, want: string, ...args: string[]): void => {
    doRun(f, ...args);
    if (rc === 0 && bashOut(out) === bashOut(want)) ok(label);
    else fail(label);
  };
  const runsOn = (label: string, f: string, m: string, ...args: string[]): void => {
    doRun(f, ...args);
    if (rc === 0 && out.includes(`--model ${m} `)) ok(label);
    else fail(label);
  };
  const refused = (label: string, f: string, want: string, ...args: string[]): void => {
    doRun(f, ...args);
    if (rc === 1 && out === "" && err.includes(want)) ok(label);
    else fail(label);
  };
  const carries = (label: string, f: string, want: string, ...args: string[]): void => {
    doRun(f, ...args);
    if (rc === 0 && out.includes(want)) ok(label);
    else fail(label);
  };
  const lacks = (label: string, f: string, bad: string, ...args: string[]): void => {
    doRun(f, ...args);
    if (rc === 0 && !out.includes(bad)) ok(label);
    else fail(label);
  };
  const printed = (label: string, ...texts: string[]): void => {
    for (const t of texts) {
      if (!out.includes(t)) {
        fail(label);
        return;
      }
    }
    if (rc === 0) ok(label);
    else fail(label);
  };

  const record = (runName: string, f: string): void => {
    mkdirSync(join(tmp, runName), { recursive: true });
    const r = spawnSync(join(here, "run-meta.sh"), [join(tmp, runName), join(tmp, "repo")], {
      encoding: "utf8",
      env: {
        ...process.env,
        POSTMASTER_CONFIG: join(tmp, `${f}.toml`),
        PATH: `${join(tmp, "bin")}:${process.env.PATH ?? ""}`,
      },
    });
    if (r.status !== 0) {
      st.fail(`run-meta.sh records ${f} as run ${runName}`);
    }
  };

  // calls(): scan runbooks for launch/resume invocations.
  const calls = (...paths: string[]): { code: number; out: string } => {
    const results: string[] = [];
    const CALL = /scripts\/launch\.sh\s+(?:launch|resume)\b/g;
    for (const path of paths) {
      const text = readFileSync(path, "utf8");
      // Split into fenced blocks and prose.
      const parts = text.split(/^([ \t]*```.*?^[ \t]*```)/ms);
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i] ?? "";
        if (i % 2) {
          // fenced block
          const joined = part.replace(/\\\n\s*/g, " ");
          for (const line of joined.split("\n")) {
            let m: RegExpExecArray | null;
            CALL.lastIndex = 0;
            while ((m = CALL.exec(line)) !== null) {
              const c = line.slice(m.index);
              results.push(
                `${c.includes("--run <dispatch>") ? "run" : "unrun"} ${path}: ${c.split(/\s+/).join(" ")}`,
              );
            }
          }
        } else {
          // prose: inline code spans
          for (const span of part.match(/`([^`]+)`/g) ?? []) {
            const inner = span.slice(1, -1);
            let m: RegExpExecArray | null;
            CALL.lastIndex = 0;
            while ((m = CALL.exec(inner)) !== null) {
              const c = inner.slice(m.index);
              results.push(
                `${c.includes("--run <dispatch>") ? "run" : "unrun"} ${path}: ${c.split(/\s+/).join(" ")}`,
              );
            }
          }
        }
      }
    }
    return { code: 0, out: results.join("\n") + (results.length ? "\n" : "") };
  };

  // Fixture configs
  fixture("legs", "synthesis", "review", "ship");
  fixture("none");
  for (const k of ["style", "bug", "security"]) fixture(`old-${k}`, "review", k);
  fixture("typo", "revue");
  rawfix("onlane", 'review = { harness = "claude", model = "lane-model" }\n');
  rawfix("notable", 'review = "claude"\n');
  rawfix(
    "dup",
    'review = { harness = "claude", model = "a" }\nreview = { harness = "claude", model = "b" }\n',
  );
  rawfix("suffix", 'review = { harness = "claude", model = "lane-model[1m]" }\n');
  rawfix("suffixes", 'review = { harness = "claude", model = "lane-model[1m][2m]" }\n');
  mkdirSync(join(tmp, "elsewhere"), { recursive: true });
  writeFileSync(join(tmp, "rel.env"), "PROBE=config-dir\n");
  writeFileSync(join(tmp, "wt/rel.env"), "PROBE=worktree\n");
  writeFileSync(join(tmp, "empty.txt"), "");
  writeFileSync(join(tmp, "unreadable.txt"), "x\n");
  try {
    chmodSync(join(tmp, "unreadable.txt"), 0o000);
  } catch {
    /* ignore */
  }
  rawfix("emptyleg", "synthesis = {}\n");
  const head = '[lanes.one]\nharness = "claude"\nmodel = "lane-model"\n\n[team]\n';
  writeFileSync(
    join(tmp, "coachlane.toml"),
    `${head}coachman = { harness = "claude", model = "lane-model" }\n`,
  );
  writeFileSync(
    join(tmp, "fblane.toml"),
    head +
      'coachman = { harness = "claude", model = "coach-model" }\ncoachman_fallback = { harness = "claude", model = "lane-model" }\n',
  );
  writeFileSync(
    join(tmp, "bare.toml"),
    '[lanes.one]\nharness = "claude"\n\n[team]\ncoachman = { harness = "claude" }\n',
  );
  writeFileSync(join(tmp, "over.env"), "MODEL=lane-model\nHARNESS=nope\nPROBE=reached\n");
  writeFileSync(
    join(tmp, "envfile.toml"),
    head +
      `coachman = { harness = "claude", model = "coach-model", env_file = "${join(tmp, "over.env")}" }\n`,
  );
  writeFileSync(
    join(tmp, "relenv.toml"),
    `${head}coachman = { harness = "claude", model = "coach-model", env_file = "rel.env" }\n`,
  );
  rawfix("edited", 'review = { harness = "claude", model = "edited-model" }\n');
  writeFileSync(join(tmp, "then.env"), "PROBE=then\n");
  writeFileSync(join(tmp, "now.env"), "PROBE=now\n");
  writeFileSync(
    join(tmp, "then.toml"),
    `[lanes.one]\nharness = "claude"\nmodel = "then-model"\neffort = "high"\nenv_file = "${join(tmp, "then.env")}"\n`,
  );
  writeFileSync(
    join(tmp, "now.toml"),
    `[lanes.one]\nharness = "pi"\nmodel = "now-model"\neffort = "low"\nenv_file = "${join(tmp, "now.env")}"\n`,
  );

  // The runbook fixture
  writeFileSync(
    join(tmp, "runbook.md"),
    [
      "Fenced, with no --run:",
      "",
      "```sh",
      "( scripts/launch.sh launch a <wt> <prompt-file> \\",
      "    > <dispatch>/logs/a-events.jsonl ) &",
      "```",
      "",
      "Fenced and indented, with it:",
      "",
      "   ```sh",
      "   ( scripts/launch.sh launch b <wt> <prompt-file> \\",
      "       --run <dispatch> > <dispatch>/logs/b-events.jsonl ) &",
      "   ```",
      "",
      "Inline, with no --run: `scripts/launch.sh resume c <wt> <thread-id> <prompt-file>`. Inline and",
      "across a line break, with it: `<tool>/scripts/launch.sh resume d <wt> <thread-id>",
      "<prompt-file> --run <dispatch>`.",
    ].join("\n"),
  );
  run("git", ["init", "-q", join(tmp, "repo")]);
  record("run", "legs");
  record("run-then", "then");
  record("run-old-bug", "old-bug");
  record("run-onlane", "onlane");
  mkdirSync(join(tmp, "no-record"), { recursive: true });
  mkdirSync(join(tmp, "garbled"), { recursive: true });
  mkdirSync(join(tmp, "unrecorded"), { recursive: true });
  writeFileSync(join(tmp, "garbled/run.json"), '{"config": \n');
  writeFileSync(join(tmp, "unrecorded/run.json"), '{"run": "T-1"}\n');

  const CODEX_BYPASS = "--dangerously-bypass-approvals-and-sandbox";
  const CODEX_HIGH = 'model_reasoning_effort="high"';

  console.log("positive controls");
  for (const k of ["synthesis", "review", "ship"]) {
    runsOn(
      `--leg ${k} runs on its own [team.coachman_legs] entry`,
      "legs",
      `${k}-model`,
      "form",
      "coachman",
      "--leg",
      k,
    );
  }
  runsOn(
    "a leg with no entry runs on team.coachman",
    "none",
    "coach-model",
    "form",
    "coachman",
    "--leg",
    "review",
  );
  runsOn("a lane runs on its own model", "legs", "lane-model", "form", "one");
  runsOn(
    "a lane launches on a config the coachman refuses",
    "old-bug",
    "lane-model",
    "form",
    "one",
  );
  runsOn(
    "a launch with --leg synthesis runs on the synthesis entry",
    "legs",
    "synthesis-model",
    "launch",
    "coachman",
    join(tmp, "wt"),
    join(tmp, "prompt.txt"),
    "--leg",
    "synthesis",
  );
  runsOn(
    "a resume with --leg review runs on the review entry",
    "legs",
    "review-model",
    "resume",
    "coachman",
    join(tmp, "wt"),
    "T-1",
    join(tmp, "prompt.txt"),
    "--leg",
    "review",
  );
  runsAs(
    "a codex resume runs in its worktree on its lane's model and effort, streams JSON, writes -o, and passes a prompt that starts with -",
    "codex",
    lines(
      join(tmp, "wt"),
      "exec",
      "resume",
      "T-1",
      "--json",
      "-o",
      join(tmp, "last.md"),
      "-m",
      "lane-model",
      `-c`,
      CODEX_HIGH,
      CODEX_BYPASS,
      "--",
      "- Keep going, then stop.",
    ),
    "resume",
    "one",
    join(tmp, "wt"),
    "T-1",
    join(tmp, "ruling.txt"),
    "--last",
    join(tmp, "last.md"),
  );
  runsAs(
    "a codex coachman resumes with --leg review on the review entry's model and effort",
    "codex",
    lines(
      join(tmp, "wt"),
      "exec",
      "resume",
      "T-1",
      "--json",
      "-m",
      "review-model",
      "-c",
      'model_reasoning_effort="medium"',
      CODEX_BYPASS,
      "--",
      "- Keep going, then stop.",
    ),
    "resume",
    "coachman",
    join(tmp, "wt"),
    "T-1",
    join(tmp, "ruling.txt"),
    "--leg",
    "review",
  );
  envx = { HOME: join(tmp, "home") };
  runsAs(
    "a codex launch on a branch runs with -C and --json, and no --skip-git-repo-check",
    "codex",
    lines(
      join(tmp, "cx"),
      "exec",
      "-C",
      join(tmp, "cx"),
      "--json",
      "-m",
      "lane-model",
      `-c`,
      CODEX_HIGH,
      CODEX_BYPASS,
      "Keep going, then stop.",
    ),
    "launch",
    "one",
    join(tmp, "cx"),
    join(tmp, "brief.txt"),
  );
  runsAs(
    "a codex launch in a detached worktree adds --skip-git-repo-check",
    "codex",
    lines(
      join(tmp, "cx-detached"),
      "exec",
      "-C",
      join(tmp, "cx-detached"),
      "--json",
      "-m",
      "lane-model",
      `-c`,
      CODEX_HIGH,
      CODEX_BYPASS,
      "--skip-git-repo-check",
      "Keep going, then stop.",
    ),
    "launch",
    "one",
    join(tmp, "cx-detached"),
    join(tmp, "brief.txt"),
  );
  envx = {};
  runsAs(
    "form shows the codex launch and resume",
    "codex",
    lines(
      `launch: cd <cwd> && codex exec -C <cwd> --json -m lane-model -c model_reasoning_effort=\\"high\\" ${CODEX_BYPASS} $(cat <prompt-file>) `,
      `resume: cd <cwd> && codex exec resume <thread-id> --json -m lane-model -c model_reasoning_effort=\\"high\\" ${CODEX_BYPASS} -- $(cat <prompt-file>) `,
    ),
    "form",
    "one",
  );
  runsOn(
    "the fallback resumes on its own model, with no --leg",
    "legs",
    "fallback-model",
    "resume",
    "coachman_fallback",
    join(tmp, "wt"),
    "T-1",
    join(tmp, "prompt.txt"),
  );
  runsOn("form with no --leg shows team.coachman", "legs", "coach-model", "form", "coachman");
  carries(
    "a lane's env file reaches the harness's environment",
    "envfile",
    "probe=reached",
    "launch",
    "coachman",
    join(tmp, "wt"),
    join(tmp, "prompt.txt"),
    "--leg",
    "review",
  );
  runsOn(
    "inside a run, a resume runs on the model the run recorded, not the live config's",
    "edited",
    "review-model",
    "resume",
    "coachman",
    join(tmp, "wt"),
    "T-1",
    join(tmp, "prompt.txt"),
    "--leg",
    "review",
    "--run",
    join(tmp, "run"),
  );
  runsOn(
    "outside a run, the same resume runs on the live config's model",
    "edited",
    "edited-model",
    "resume",
    "coachman",
    join(tmp, "wt"),
    "T-1",
    join(tmp, "prompt.txt"),
    "--leg",
    "review",
  );
  doRun(
    "now",
    "resume",
    "one",
    join(tmp, "wt"),
    "T-1",
    join(tmp, "prompt.txt"),
    "--run",
    join(tmp, "run-then"),
  );
  printed(
    "inside a run, a lane resumes on the harness, model, effort and env file the run recorded",
    "--resume T-1 ",
    "--model then-model ",
    "--effort high ",
    "probe=then",
  );
  doRun("now", "resume", "one", join(tmp, "wt"), "T-1", join(tmp, "prompt.txt"));
  printed(
    "outside a run, the same resume takes all four from the live config",
    "--mode json ",
    "--session T-1 ",
    "--model now-model ",
    "--thinking low ",
    "probe=now",
  );
  runsOn(
    "inside a run the live config is not read: with none at all, a launch runs on the recorded model",
    "nowhere",
    "synthesis-model",
    "launch",
    "coachman",
    join(tmp, "wt"),
    join(tmp, "prompt.txt"),
    "--leg",
    "synthesis",
    "--run",
    join(tmp, "run"),
  );
  {
    const c = calls(join(tmp, "runbook.md"));
    out = c.out;
    rc = c.code;
    err = "";
    const got = `${out
      .replace(/\n+$/, "")
      .split("\n")
      .map((l) => l.replace(/^([a-z]+) .*launch\.sh (launch|resume) ([a-z]) .*/, "$1 $3"))
      .join(",")},`;
    if (got === "unrun a,run b,unrun c,run d,") {
      ok("a runbook launch or resume with no --run is found, fenced or inline");
    } else {
      st.fail("a runbook launch or resume with no --run is found, fenced or inline", got);
    }
  }

  console.log("negative controls");
  for (const k of ["style", "bug", "security"]) {
    refused(
      `a config naming ${k} is refused, and the message names review`,
      `old-${k}`,
      "one leg now, review",
      "form",
      "coachman",
      "--leg",
      "review",
    );
  }
  refused(
    "a key that is no leg is refused",
    "typo",
    "no such leg: revue",
    "form",
    "coachman",
    "--leg",
    "review",
  );
  refused(
    "a leg entry on a lane's model is refused",
    "onlane",
    "a lane's model",
    "form",
    "coachman",
    "--leg",
    "synthesis",
  );
  refused(
    "a leg entry that is not a table is refused",
    "notable",
    "is not a table",
    "form",
    "coachman",
    "--leg",
    "synthesis",
  );
  envx = { HARNESS: "claude", MODEL: "env-model" };
  refused(
    "a config that does not parse is refused, and the environment's HARNESS and MODEL go unused",
    "dup",
    "cannot read",
    "launch",
    "one",
    join(tmp, "wt"),
    join(tmp, "prompt.txt"),
  );
  envx = {};
  refused(
    "a parse error names the file and where it breaks",
    "dup",
    `launch: cannot read ${join(tmp, "dup.toml")}: `,
    "form",
    "coachman",
    "--leg",
    "review",
  );
  refused(
    "a leg entry on a lane's model with a bracketed suffix is refused",
    "suffix",
    "a lane's model",
    "form",
    "coachman",
    "--leg",
    "synthesis",
  );
  refused(
    "team.coachman on a lane's model is refused",
    "coachlane",
    "a lane's model",
    "form",
    "coachman",
    "--leg",
    "synthesis",
  );
  refused(
    "the fallback on a lane's model is refused",
    "fblane",
    "a lane's model",
    "form",
    "coachman_fallback",
  );
  refused(
    "a leg entry with no harness or model is refused",
    "emptyleg",
    "needs a harness and a model",
    "form",
    "coachman",
    "--leg",
    "synthesis",
  );
  refused(
    "a coachman with no model is refused by name",
    "bare",
    "coachman has no model",
    "form",
    "coachman",
    "--leg",
    "review",
  );
  runsOn(
    "an env file cannot put the coachman on another model",
    "envfile",
    "coach-model",
    "launch",
    "coachman",
    join(tmp, "wt"),
    join(tmp, "prompt.txt"),
    "--leg",
    "review",
  );
  envx = { STDIN_FILE: join(tmp, "prompt.txt") };
  lacks("a STDIN_FILE from the environment is not used", "legs", "< ", "form", "one");
  refused(
    "a leg entry on a lane's model with stacked suffixes is refused",
    "suffixes",
    "a lane's model",
    "form",
    "coachman",
    "--leg",
    "synthesis",
  );
  envx = {};
  {
    const origCwd = process.cwd();
    process.chdir(join(tmp, "elsewhere"));
    carries(
      "a relative env file is read from the config's directory, never the worktree",
      "relenv",
      "probe=config-dir",
      "launch",
      "coachman",
      join(tmp, "wt"),
      join(tmp, "prompt.txt"),
      "--leg",
      "review",
    );
    process.chdir(origCwd);
  }
  refused(
    "an empty prompt file is refused, and nothing runs",
    "legs",
    "prompt file missing, unreadable or empty",
    "launch",
    "one",
    join(tmp, "wt"),
    join(tmp, "empty.txt"),
  );
  {
    let canReadUnreadable = false;
    try {
      accessSync(join(tmp, "unreadable.txt"), fsConstants.R_OK);
      canReadUnreadable = true;
    } catch {
      canReadUnreadable = false;
    }
    if (canReadUnreadable) {
      ok("an unreadable prompt file is refused (skipped: this user reads every file)");
    } else {
      refused(
        "an unreadable prompt file is refused, and nothing runs",
        "legs",
        "prompt file missing, unreadable or empty",
        "launch",
        "one",
        join(tmp, "wt"),
        join(tmp, "unreadable.txt"),
      );
    }
  }
  refused(
    "a resume with no thread id is refused, and nothing runs",
    "legs",
    "launch: resume needs a thread id",
    "resume",
    "one",
    join(tmp, "wt"),
    "",
    join(tmp, "prompt.txt"),
  );
  refused(
    "an argument launch.sh does not know is refused",
    "legs",
    "launch needs <cwd> <prompt-file>",
    "launch",
    "one",
    join(tmp, "wt"),
    join(tmp, "prompt.txt"),
    "--leg=review",
  );
  for (const k of ["style", "bug", "security"]) {
    refused(
      `--leg ${k} is refused`,
      "legs",
      `no such leg: --leg ${k}`,
      "form",
      "coachman",
      "--leg",
      k,
    );
  }
  refused(
    "a codex lane with no model is refused, and nothing resumes on codex's default",
    "codex-nomodel",
    "has no model",
    "resume",
    "one",
    join(tmp, "wt"),
    "T-1",
    join(tmp, "prompt.txt"),
  );
  runsAs(
    "a codex resume with no effort and no --last passes neither -c nor -o",
    "codex-noeffort",
    lines(
      join(tmp, "wt"),
      "exec",
      "resume",
      "T-1",
      "--json",
      "-m",
      "lane-model",
      CODEX_BYPASS,
      "--",
      "- Keep going, then stop.",
    ),
    "resume",
    "one",
    join(tmp, "wt"),
    "T-1",
    join(tmp, "ruling.txt"),
  );
  refused(
    "resuming the coachman with no --leg is refused, and nothing runs",
    "legs",
    "coachman needs --leg",
    "resume",
    "coachman",
    join(tmp, "wt"),
    "T-1",
    join(tmp, "prompt.txt"),
  );
  refused(
    "launching the coachman with no --leg is refused, and nothing runs",
    "legs",
    "coachman needs --leg",
    "launch",
    "coachman",
    join(tmp, "wt"),
    join(tmp, "prompt.txt"),
  );
  refused(
    "inside a run with no run.json, a resume is refused though the live config would serve, and nothing runs",
    "legs",
    `no run.json in ${join(tmp, "no-record")}`,
    "resume",
    "coachman",
    join(tmp, "wt"),
    "T-1",
    join(tmp, "prompt.txt"),
    "--leg",
    "review",
    "--run",
    join(tmp, "no-record"),
  );
  refused(
    "inside a run whose run.json does not parse, a launch is refused, and nothing runs",
    "legs",
    `cannot read ${join(tmp, "garbled/run.json")}`,
    "launch",
    "one",
    join(tmp, "wt"),
    join(tmp, "prompt.txt"),
    "--run",
    join(tmp, "garbled"),
  );
  refused(
    "a run.json that records no config is refused",
    "legs",
    "it records no config",
    "launch",
    "one",
    join(tmp, "wt"),
    join(tmp, "prompt.txt"),
    "--run",
    join(tmp, "unrecorded"),
  );
  refused(
    "an empty --run is refused, never read as outside a run",
    "legs",
    "--run needs a dispatch directory",
    "resume",
    "coachman",
    join(tmp, "wt"),
    "T-1",
    join(tmp, "prompt.txt"),
    "--leg",
    "review",
    "--run",
    "",
  );
  refused(
    "a recorded config naming bug is refused, though the live config passes",
    "legs",
    "one leg now, review",
    "resume",
    "coachman",
    join(tmp, "wt"),
    "T-1",
    join(tmp, "prompt.txt"),
    "--leg",
    "review",
    "--run",
    join(tmp, "run-old-bug"),
  );
  refused(
    "a recorded leg on a lane's model is refused, though the live config passes",
    "legs",
    "a lane's model",
    "resume",
    "coachman",
    join(tmp, "wt"),
    "T-1",
    join(tmp, "prompt.txt"),
    "--leg",
    "synthesis",
    "--run",
    join(tmp, "run-onlane"),
  );
  {
    const c = calls(
      join(here, "../skills/postmaster/coachman.md"),
      join(here, "../skills/postmaster/postmaster.md"),
    );
    const gotLines = c.out
      .trim()
      .split("\n")
      .filter((l) => l !== "");
    const unrun = gotLines.filter((l) => l.startsWith("unrun "));
    const hasCoachman = gotLines.some((l) => l.startsWith("run ") && l.includes("/coachman.md: "));
    const hasPostmaster = gotLines.some(
      (l) => l.startsWith("run ") && l.includes("/postmaster.md: "),
    );
    if (c.code === 0 && unrun.length === 0 && hasCoachman && hasPostmaster) {
      ok("no launch or resume in coachman.md or postmaster.md lacks --run <dispatch>");
    } else {
      fail("no launch or resume in coachman.md or postmaster.md lacks --run <dispatch>");
    }
  }

  console.log("muse");
  writeFileSync(
    join(tmp, "muse.toml"),
    `[lanes.m]\nharness = "muse"\nmodel = "muse-model"\neffort = "max"\nenv_file = "${join(tmp, "over.env")}"\n\n[lanes.n]\nharness = "muse"\nmodel = "muse-model"\n\n[team]\ncoachman = { harness = "muse", model = "coach-muse" }\ncoachman_fallback = { harness = "claude", model = "fallback-model" }\n`,
  );
  writeFileSync(join(tmp, "muse-bare.toml"), '[lanes.m]\nharness = "muse"\nmodel = "muse-model"\n');
  mkdirSync(join(tmp, "wt/sub"), { recursive: true });
  writeFileSync(join(tmp, "wt/sub/p.txt"), "Continue.\n");
  const hd = join(tmp, "harness-data");

  const mrun = (...args: string[]): void => {
    const f = args[0] ?? "";
    const rest = args.slice(1);
    const env: Record<string, string | undefined> = {
      ...process.env,
      ...envx,
      POSTMASTER_HARNESS_DATA: hd,
      POSTMASTER_CONFIG: join(tmp, `${f}.toml`),
      PATH: `${join(tmp, "bin")}:${process.env.PATH ?? ""}`,
    };
    const r = spawnSync(self, rest, { encoding: "utf8", env, input: "leak\n" });
    out = r.stdout ?? "";
    err = r.stderr ?? "";
    rc = r.status ?? 1;
  };
  const dataOf = (): string => {
    const m = out.match(/.* data=(.*)/);
    return m?.[1]?.trim() ?? "";
  };
  const mrefused = (label: string, f: string, want: string, ...args: string[]): void => {
    mrun(f, ...args);
    if (rc === 1 && out === "" && err.includes(want)) ok(label);
    else fail(label);
  };

  mrun("muse", "launch", "m", join(tmp, "wt"), join(tmp, "prompt.txt"));
  let a = dataOf();
  {
    const want = `exec --json --prompt-file ${join(tmp, "prompt.txt")} --model muse-model --reasoning-effort max --yolo probe=reached stdin= data=${a}`;
    if (
      rc === 0 &&
      bashOut(out) === want &&
      a.startsWith(`${hd}/muse/`) &&
      (() => {
        try {
          return statSync(a).isDirectory();
        } catch {
          return false;
        }
      })()
    ) {
      ok(
        "a muse launch: JSON events, the prompt file, model, effort, bypass form and env file, nothing on stdin, and its own data directory",
      );
    } else {
      fail(
        "a muse launch: JSON events, the prompt file, model, effort, bypass form and env file, nothing on stdin, and its own data directory",
      );
    }
  }
  writeFileSync(join(a, "01a0-sess"), "");
  mrun("muse", "resume", "m", join(tmp, "wt"), "01a0-sess", join(tmp, "prompt.txt"));
  const b = dataOf();
  {
    const wantPrefix = `exec --json --prompt-file ${join(tmp, "prompt.txt")} --session-id 01a0-sess --model muse-model --reasoning-effort max --yolo `;
    if (rc === 0 && out.startsWith(wantPrefix) && b === a) {
      ok(
        "a muse resume names the session, keeps the model and effort, and finds the launch's data directory",
      );
    } else {
      fail(
        "a muse resume names the session, keeps the model and effort, and finds the launch's data directory",
      );
    }
  }
  mrun("muse", "launch", "n", join(tmp, "wt"), join(tmp, "prompt.txt"));
  const c = dataOf();
  mrun(
    "muse",
    "launch",
    "coachman",
    join(tmp, "wt"),
    join(tmp, "prompt.txt"),
    "--leg",
    "synthesis",
  );
  const d = dataOf();
  mrun("muse", "launch", "coachman", join(tmp, "wt"), join(tmp, "prompt.txt"), "--leg", "review");
  const e = dataOf();
  mrun("muse", "launch", "m", join(tmp, "elsewhere"), join(tmp, "prompt.txt"));
  const f = dataOf();
  {
    const uniq = new Set([a, c, d, e, f]);
    if (c && d && e && f && uniq.size === 5) {
      ok(
        "another lane, each coachman leg, and the same lane elsewhere each get a data directory of their own",
      );
    } else {
      fail(
        "another lane, each coachman leg, and the same lane elsewhere each get a data directory of their own",
      );
    }
  }
  {
    const origCwd = process.cwd();
    process.chdir(join(tmp, "wt"));
    const env: Record<string, string | undefined> = {
      ...process.env,
      POSTMASTER_HARNESS_DATA: hd,
      POSTMASTER_CONFIG: join(tmp, "muse-bare.toml"),
      PATH: `${join(tmp, "bin")}:${process.env.PATH ?? ""}`,
    };
    const r = spawnSync(self, ["launch", "m", join(tmp, "elsewhere"), "sub/p.txt"], {
      encoding: "utf8",
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    out = r.stdout ?? "";
    err = r.stderr ?? "";
    rc = r.status ?? 1;
    process.chdir(origCwd);
    const wantPrefix = `exec --json --prompt-file ${join(tmp, "wt/sub/p.txt")} --model muse-model --yolo `;
    if (rc === 0 && out.startsWith(wantPrefix)) {
      ok(
        "a relative prompt file is made absolute before the cd, and no effort means no effort flag",
      );
    } else {
      fail(
        "a relative prompt file is made absolute before the cd, and no effort means no effort flag",
      );
    }
  }
  carries(
    "the muse form shows its data directory, the bypass form and an empty stdin",
    "muse",
    `env XDG_DATA_HOME=<harness-data>/muse/<key> muse exec --json --prompt-file <prompt-file> --model muse-model --reasoning-effort max --yolo < /dev/null`,
    "form",
    "m",
  );
  mrefused(
    "a muse resume of a thread its data directory does not hold is refused, and nothing runs",
    "muse",
    "no muse thread 01a0-none in this launch's data directory",
    "resume",
    "m",
    join(tmp, "wt"),
    "01a0-none",
    join(tmp, "prompt.txt"),
  );
  mrefused(
    "a muse resume from another directory is refused: the thread is in its launch's data directory",
    "muse",
    "no muse thread 01a0-sess in this launch's data directory",
    "resume",
    "m",
    join(tmp, "elsewhere"),
    "01a0-sess",
    join(tmp, "prompt.txt"),
  );
  writeFileSync(join(d, "01a0-coach"), "");
  mrun(
    "muse",
    "resume",
    "coachman",
    join(tmp, "wt"),
    "01a0-coach",
    join(tmp, "prompt.txt"),
    "--leg",
    "synthesis",
  );
  if (rc === 0 && dataOf() === d) {
    ok("a muse coachman resumes its thread on the leg it was launched on");
  } else {
    fail("a muse coachman resumes its thread on the leg it was launched on");
  }
  mrefused(
    "a muse coachman resumed on another leg is refused, and nothing runs",
    "muse",
    "no muse thread 01a0-coach in this launch's data directory",
    "resume",
    "coachman",
    join(tmp, "wt"),
    "01a0-coach",
    join(tmp, "prompt.txt"),
    "--leg",
    "review",
  );

  console.log("mimo");
  writeFileSync(
    join(tmp, "mimo.toml"),
    `[lanes.x]\nharness = "mimo"\nmodel = "prov/mimo-model"\neffort = "high"\nenv_file = "${join(tmp, "over.env")}"\n\n[lanes.y]\nharness = "mimo"\nmodel = "prov/mimo-model"\n`,
  );
  writeFileSync(
    join(tmp, "mimo-bare.toml"),
    '[lanes.x]\nharness = "mimo"\nmodel = "prov/mimo-model"\n',
  );

  mrun("mimo", "launch", "x", join(tmp, "wt"), join(tmp, "prompt.txt"));
  a = dataOf();
  {
    const want = `run --format json -m prov/mimo-model --variant high --dangerously-skip-permissions probe=reached stdin=Continue. import-off=1 data=${a}`;
    if (
      rc === 0 &&
      bashOut(out) === want &&
      a.startsWith(`${hd}/mimo/`) &&
      (() => {
        try {
          return statSync(a).isDirectory();
        } catch {
          return false;
        }
      })()
    ) {
      ok(
        "a mimo launch: JSON events, model, variant, bypass form, env file, the prompt on stdin, its own data directory, and no history import",
      );
    } else {
      fail(
        "a mimo launch: JSON events, model, variant, bypass form, env file, the prompt on stdin, its own data directory, and no history import",
      );
    }
  }
  writeFileSync(join(a, "ses_01a0"), "");
  mrun("mimo", "resume", "x", join(tmp, "wt"), "ses_01a0", join(tmp, "prompt.txt"));
  const mb = dataOf();
  {
    const wantPrefix = `run --format json -m prov/mimo-model -s ses_01a0 --variant high --dangerously-skip-permissions probe=reached stdin=Continue. `;
    if (rc === 0 && out.startsWith(wantPrefix) && mb === a) {
      ok(
        "a mimo resume names the session, keeps the model and the variant, and finds the launch's data directory",
      );
    } else {
      fail(
        "a mimo resume names the session, keeps the model and the variant, and finds the launch's data directory",
      );
    }
  }
  mrun("mimo", "launch", "y", join(tmp, "wt"), join(tmp, "prompt.txt"));
  const mc = dataOf();
  if (mc && mc !== a) {
    ok("another mimo lane in the same directory gets a data directory of its own");
  } else {
    fail("another mimo lane in the same directory gets a data directory of its own");
  }
  {
    const origCwd = process.cwd();
    process.chdir(join(tmp, "wt"));
    const env: Record<string, string | undefined> = {
      ...process.env,
      POSTMASTER_HARNESS_DATA: hd,
      POSTMASTER_LAUNCH_NAME: "#7, a run",
      POSTMASTER_CONFIG: join(tmp, "mimo-bare.toml"),
      PATH: `${join(tmp, "bin")}:${process.env.PATH ?? ""}`,
    };
    const r = spawnSync(self, ["launch", "x", join(tmp, "elsewhere"), "sub/p.txt"], {
      encoding: "utf8",
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    out = r.stdout ?? "";
    err = r.stderr ?? "";
    rc = r.status ?? 1;
    process.chdir(origCwd);
    const wantPrefix = `run --format json -m prov/mimo-model --title #7, a run --dangerously-skip-permissions probe= stdin=Continue. `;
    if (rc === 0 && out.startsWith(wantPrefix)) {
      ok(
        "a relative prompt file is read after the cd, no effort means no variant, and a launch is titled after its run",
      );
    } else {
      fail(
        "a relative prompt file is read after the cd, no effort means no variant, and a launch is titled after its run",
      );
    }
  }
  carries(
    "the mimo form shows its data directory, the import switch and the prompt file on stdin",
    "mimo",
    `env XDG_DATA_HOME=<harness-data>/mimo/<key> MIMOCODE_DISABLE_CLAUDE_IMPORT=1 mimo run --format json -m prov/mimo-model --variant high --dangerously-skip-permissions < <prompt-file>`,
    "form",
    "x",
  );
  doRun("mimo", "skill", "x", "security-review");
  if (rc === 3 && out === "") {
    ok("a mimo lane has no security review skill: exit 3");
  } else {
    fail("a mimo lane has no security review skill: exit 3");
  }
  mrefused(
    "a mimo resume of a thread its data directory does not hold is refused, and nothing runs",
    "mimo",
    "no mimo thread ses_none in this launch's data directory",
    "resume",
    "x",
    join(tmp, "wt"),
    "ses_none",
    join(tmp, "prompt.txt"),
  );
  mrefused(
    "a mimo resume from another directory is refused: the thread is in its launch's data directory",
    "mimo",
    "no mimo thread ses_01a0 in this launch's data directory",
    "resume",
    "x",
    join(tmp, "elsewhere"),
    "ses_01a0",
    join(tmp, "prompt.txt"),
  );

  console.log("the coachman on muse, a workhorse on mimo: both forms, each with its bypass flag");
  writeFileSync(
    join(tmp, "team.toml"),
    '[lanes.w]\nharness = "mimo"\nmodel = "prov/mimo-model"\neffort = "low"\n\n[lanes.v]\nharness = "claude"\nmodel = "lane-model"\n\n[team]\nworkhorses = ["w", "v"]\ncoachman = { harness = "muse", model = "coach-muse", effort = "max" }\n',
  );
  // Create modified copies of this script with bypass flags removed.
  const selfSrc = readFileSync(join(scriptsDir(import.meta), "launch.ts"), "utf8");
  const nobypassSrc = selfSrc
    .replaceAll('cmd.push("--yolo"); /*BYPASS*/', "/*BYPASS*/")
    .replaceAll('cmd.push("--dangerously-skip-permissions"); /*BYPASS*/', "/*BYPASS*/");
  writeFileSync(join(tmp, "nobypass.ts"), nobypassSrc);
  writeFileSync(
    join(tmp, "nobypass.sh"),
    `#!/usr/bin/env bash\nexec bun "${join(tmp, "nobypass.ts")}" "$@"\n`,
  );
  chmodSync(join(tmp, "nobypass.sh"), 0o755);
  const launchonlySrc = selfSrc
    .replaceAll(
      'cmd.push("--yolo"); /*BYPASS*/',
      'if (cmdMode !== "resume") cmd.push("--yolo"); /*BYPASS*/',
    )
    .replaceAll(
      'cmd.push("--dangerously-skip-permissions"); /*BYPASS*/',
      'if (cmdMode !== "resume") cmd.push("--dangerously-skip-permissions"); /*BYPASS*/',
    );
  writeFileSync(join(tmp, "launchonly.ts"), launchonlySrc);
  writeFileSync(
    join(tmp, "launchonly.sh"),
    `#!/usr/bin/env bash\nexec bun "${join(tmp, "launchonly.ts")}" "$@"\n`,
  );
  chmodSync(join(tmp, "launchonly.sh"), 0o755);

  const bypassed = (script: string, flag: string, ...formArgs: string[]): boolean => {
    const r = spawnSync(script, ["form", ...formArgs], {
      encoding: "utf8",
      env: {
        ...process.env,
        POSTMASTER_CONFIG: join(tmp, "team.toml"),
        PATH: `${join(tmp, "bin")}:${process.env.PATH ?? ""}`,
      },
    });
    out = r.stdout ?? "";
    rc = r.status ?? 1;
    let n = 0;
    for (const l of out.split("\n")) {
      if (l.startsWith("launch:") || l.startsWith("resume:")) {
        if (l.includes(` ${flag} `)) n += 1;
      }
    }
    return rc === 0 && n === 2;
  };

  for (const f of ["coachman --yolo --leg review", "w --dangerously-skip-permissions"]) {
    const parts = f.split(" ");
    const name = parts[0] ?? "";
    const flag = parts[1] ?? "";
    const rest = parts.slice(2);
    if (bypassed(self, flag, name, ...rest))
      ok(`${name}: the launch and resume forms both carry ${flag}`);
    else fail(`${name}: the launch and resume forms both carry ${flag}`);
    for (const line of out.split("\n")) {
      if (line) console.log(`         ${line}`);
    }
    if (bypassed(join(tmp, "nobypass.sh"), flag, name, ...rest)) {
      fail(`${name}: a form without ${flag} fails this check`);
    } else ok(`${name}: a form without ${flag} fails this check`);
    if (bypassed(join(tmp, "launchonly.sh"), flag, name, ...rest)) {
      fail(`${name}: a resume form without ${flag} fails this check`);
    } else ok(`${name}: a resume form without ${flag} fails this check`);
  }
  doRun("legs", "form", "one");
  printed(
    "a claude lane's form shows a resume form too",
    "launch: cd <cwd> && claude -p ",
    "resume: cd <cwd> && claude -p --resume <thread-id> ",
  );
  writeFileSync(join(tmp, "agy.toml"), '[lanes.g]\nharness = "agy"\nmodel = "agy-model"\n');
  writeFileSync(join(tmp, "bin/agy"), "#!/bin/sh\n");
  chmodSync(join(tmp, "bin/agy"), 0o755);
  doRun("agy", "form", "g");
  printed(
    "an agy lane's form says it has no resume form, and still exits 0",
    "launch: cd <cwd> && agy -p ",
    "resume: none: agy resume form is not recorded",
  );

  console.log("skills");
  writeFileSync(
    join(tmp, "skills.toml"),
    '[lanes.one]\nharness = "claude"\nmodel = "lane-model"\n\n[lanes.two]\nharness = "codex"\nmodel = "other-model"\n\n[lanes.three]\nharness = "muse"\nmodel = "muse-model"\n',
  );
  doRun("skills", "skill", "one", "security-review");
  if (rc === 0 && out.trim() === "/security-review")
    ok("a claude lane's security review skill is /security-review");
  else fail("a claude lane's security review skill is /security-review");
  doRun("skills", "skill", "two", "security-review");
  if (rc === 3 && out === "" && err.includes("no security review skill")) {
    ok("a harness with no security review skill is exit 3, never a prompt");
  } else {
    fail("a harness with no security review skill is exit 3, never a prompt");
  }
  refused(
    "a skill that is not recorded is refused",
    "skills",
    "no such skill: code-review",
    "skill",
    "one",
    "code-review",
  );
  doRun("skills", "skill", "three", "security-review");
  if (rc === 3 && out === "") ok("a muse lane has no security review skill: exit 3");
  else fail("a muse lane has no security review skill: exit 3");

  st.finish();
});
