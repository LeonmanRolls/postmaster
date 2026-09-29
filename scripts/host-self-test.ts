#!/usr/bin/env bun
import {
  accessSync,
  closeSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { scriptDir, writeError, writeOut } from "./lib/core.ts";

const HERE = scriptDir(import.meta.url);
const SELF = join(HERE, "host.ts");
const SCRIPT = join(HERE, "host-self-test.ts");
type Result = { code: number; stdout: string; stderr: string };
const sleep = (ms: number) => Bun.sleep(ms);
function exec(
  program: string,
  args: string[] = [],
  options: { cwd?: string; env?: Record<string, string | undefined>; timeout?: number } = {},
): Result {
  const result = spawnSync(program, args, {
    cwd: options.cwd,
    env: options.env,
    timeout: options.timeout,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  return {
    code: typeof result.status === "number" ? result.status : 127,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
  };
}
function json(path: string, fallback: any): any {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}
function save(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value));
}
function opt(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}
function flag(path: string): boolean {
  return existsSync(path);
}
function next(st: any, prefix: string): string {
  st.n++;
  return prefix + st.n;
}
function out(value: unknown): void {
  writeOut(JSON.stringify({ id: "stub", result: value }));
}
function fail(code: string): never {
  writeError(JSON.stringify({ error: { code, message: code } }));
  process.exit(1);
}
function git(...args: string[]): string {
  return exec("git", args).stdout.trim();
}
function mainRepo(path: string): string {
  const common = git("-C", path, "rev-parse", "--path-format=absolute", "--git-common-dir");
  return common ? resolve(dirname(common)) : "";
}
function space(st: any, label: string): any {
  const ws = next(st, "w"),
    tab = next(st, "t"),
    pane = next(st, "p");
  st.spaces[ws] = { label, tokens: {}, panes: [pane] };
  st.panes[pane] = { ws, tokens: {} };
  return { workspace: { workspace_id: ws }, tab: { tab_id: tab }, root_pane: { pane_id: pane } };
}
function tokens(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i + 1 < args.length; i++)
    if (args[i] === "--token") {
      const [key, value] = args[i + 1]!.split("=", 2);
      result[key!] = value ?? "";
    }
  return result;
}
async function herdrStub(args: string[]): Promise<void> {
  const stateDir = process.env.STUB ?? ".";
  const callPath = join(stateDir, "herdr.calls");
  writeFileSync(callPath, `${args.join("\t")}\n`, { flag: "a" });
  if (flag(join(stateDir, "herdr.down"))) process.exit(1);
  if (args.length === 1 && args[0] === "agent") {
    writeError("herdr agent commands:\n  kinds: pi|claude|codex");
    process.exit(2);
  }
  const path = join(stateDir, "herdr.json");
  const st = json(path, { n: 0, spaces: {}, panes: {}, open: {}, agents: [], prompt: [] });
  const command = args.slice(0, 2).join(" ");
  if (command === "workspace list") {
    out({ workspaces: Object.keys(st.spaces).map((workspace_id) => ({ workspace_id })) });
    return;
  }
  if (command === "worktree list") {
    const cwd = opt(args, "--cwd") ?? "";
    const root = mainRepo(cwd);
    if (!root) process.exit(1);
    const output = git("-C", cwd, "worktree", "list", "--porcelain");
    const worktrees = output
      .split("\n\n")
      .filter(Boolean)
      .map((block) => {
        const worktreePath = resolve(block.split("\n", 1)[0]!.slice(9));
        const entry: any = { path: worktreePath, is_linked_worktree: worktreePath !== root };
        if (st.open[worktreePath]) entry.open_workspace_id = st.open[worktreePath];
        return entry;
      });
    const source: any = { repo_root: root, repo_name: basename(root) };
    if (st.open[root]) source.source_workspace_id = st.open[root];
    out({ source, worktrees });
    return;
  }
  if (command === "workspace create") {
    const result = space(st, opt(args, "--label") ?? "");
    const cwd = resolve(opt(args, "--cwd") ?? "");
    if (mainRepo(cwd) === cwd) st.open[cwd] = result.workspace.workspace_id;
    save(path, st);
    out(result);
    return;
  }
  if (command === "worktree open") {
    const result = space(st, opt(args, "--label") ?? "");
    st.open[resolve(opt(args, "--path") ?? "")] = result.workspace.workspace_id;
    save(path, st);
    out(result);
    return;
  }
  if (command === "tab create") {
    const ws = opt(args, "--workspace") ?? "";
    const tab = next(st, "t"),
      pane = next(st, "p");
    st.spaces[ws].panes.push(pane);
    st.panes[pane] = { ws, tokens: {} };
    save(path, st);
    out({ tab: { tab_id: tab }, root_pane: { pane_id: pane } });
    return;
  }
  if (command === "workspace report-metadata") {
    st.spaces[args[2]!].tokens = tokens(args);
    save(path, st);
    return;
  }
  if (command === "pane report-metadata") {
    st.panes[args[2]!].tokens = tokens(args);
    save(path, st);
    return;
  }
  if (command === "workspace get") {
    out({ workspace: { workspace_id: args[2], tokens: st.spaces[args[2]!]?.tokens ?? {} } });
    return;
  }
  if (command === "pane list") {
    const ws = opt(args, "--workspace") ?? "";
    out({
      panes: (st.spaces[ws]?.panes ?? []).map((pane_id: string) => ({ pane_id, tokens: st.panes[pane_id].tokens })),
    });
    return;
  }
  if (command === "pane get") {
    out({ pane: { pane_id: args[2], agent: null } });
    return;
  }
  if (command === "pane run") {
    const pane = args[2]!,
      text = args[3]!,
      ws = st.panes[pane].ws;
    save(path, st);
    if (flag(join(stateDir, "pane.dead"))) return;
    const prefix = flag(join(stateDir, "pane.late")) ? "sleep 5; " : "";
    const env = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      STUB: stateDir,
      HERDR_ENV: "1",
      HERDR_PANE_ID: pane,
      HERDR_TAB_ID: `tab-of-${pane}`,
      HERDR_WORKSPACE_ID: ws,
    };
    const paneOut = openSync(join(stateDir, `pane-${pane}.out`), "a");
    const child = spawn("/bin/bash", ["-c", prefix + text], {
      env,
      detached: true,
      stdio: ["ignore", paneOut, paneOut],
    });
    closeSync(paneOut);
    writeFileSync(join(stateDir, `pane-${pane}.pid`), String(child.pid));
    child.unref();
    return;
  }
  if (command === "agent get") {
    if (!st.agents.includes(args[2])) fail("agent_not_found");
    out({ agent: { name: args[2], agent_status: flag(join(stateDir, "agent.blocked")) ? "blocked" : "idle" } });
    return;
  }
  if (command === "agent start") {
    if (st.agents.includes(args[2])) fail("agent_name_taken");
    st.agents.push(args[2]);
    save(path, st);
    if (flag(join(stateDir, "agent.notready"))) fail("agent_not_ready");
    return;
  }
  if (command === "agent prompt") {
    st.prompt.push(args.slice(2));
    save(path, st);
    if (flag(join(stateDir, "agent.blocked"))) fail("agent_blocked");
    out({ accepted: true });
    return;
  }
  if (command === "agent wait") {
    if (flag(join(stateDir, "agent.blocked"))) fail("agent_blocked");
    out({ settled: true });
    return;
  }
  if (command === "agent read") {
    writeOut(`stub screen of ${args[2]}`);
    return;
  }
  return;
}
function tmuxStub(args: string[]): void {
  const stateDir = process.env.STUB ?? ".";
  writeFileSync(join(stateDir, "tmux.calls"), `${args.join("\t")}\n`, { flag: "a" });
  const path = join(stateDir, "tmux.json");
  const st = json(path, { n: 0, sessions: [], windows: {} });
  const fmt = opt(args, "-F") ?? "";
  const flag = (name: string) => args.includes(name);
  const launch = (session: string): void => {
    st.n++;
    const win = `@${st.n}`;
    st.windows[win] = { session, name: opt(args, "-n"), opts: {} };
    if (!st.sessions.includes(session)) st.sessions.push(session);
    save(path, st);
    const pane = `%${st.n}`;
    const env: Record<string, string> = {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "/",
      STUB: stateDir,
      TMUX: "/stub/tmux,1,0",
      TMUX_PANE: pane,
    };
    for (let i = 0; i + 1 < args.length; i++)
      if (args[i] === "-e") {
        const [key, ...value] = args[i + 1]!.split("=");
        env[key!] = value.join("=");
      }
    writeFileSync(
      join(stateDir, `win-${st.n}.env`),
      Object.entries(env)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join("\n"),
    );
    const cwdAt = args.indexOf("-c");
    const commandAt = cwdAt < 0 ? args.length : cwdAt + 2;
    const childArgs = args.slice(commandAt);
    if (childArgs.length) {
      const outputFd = openSync(join(stateDir, `win-${st.n}.out`), "a");
      const child = spawn(childArgs[0]!, childArgs.slice(1), {
        cwd: cwdAt < 0 ? undefined : args[cwdAt + 1],
        env,
        detached: true,
        stdio: ["ignore", outputFd, outputFd],
      });
      closeSync(outputFd);
      writeFileSync(join(stateDir, `win-${st.n}.pid`), String(child.pid));
      child.unref();
    }
    writeOut(win);
  };
  const command = args[0] ?? "";
  if (command === "has-session") {
    process.exit(st.sessions.includes((opt(args, "-t") ?? "").replace(/^=/, "")) ? 0 : 1);
  }
  if (command === "new-session") {
    launch(opt(args, "-s") ?? "");
    return;
  }
  if (command === "new-window") {
    launch((opt(args, "-t") ?? "").replace(/^=/, "").replace(/:$/, ""));
    return;
  }
  if (command === "set-option") {
    const target = opt(args, "-t") ?? "";
    const win = target in st.windows ? target : `@${target.replace(/^%/, "")}`;
    if (st.windows[win]) {
      st.windows[win].opts[args[args.length - 2]!] = args[args.length - 1];
      save(path, st);
    }
    return;
  }
  if (command === "kill-window") {
    delete st.windows[opt(args, "-t") ?? ""];
    save(path, st);
    return;
  }
  if (command === "list-windows") {
    for (const [win, value] of Object.entries(st.windows) as Array<[string, any]>) {
      if (flag("-a")) writeOut(fmt.includes("window_id") ? `${win}\t${value.name}` : value.name);
      else if (value.session === (opt(args, "-t") ?? "").replace(/^=/, ""))
        writeOut(`${win}\t${value.opts["@postmaster_cwd"] ?? ""}`);
    }
    return;
  }
  if (command === "capture-pane") {
    writeOut("stub screen");
    return;
  }
}

function symlinkCommand(name: string, bin: string): void {
  for (const root of (process.env.PATH ?? "").split(":")) {
    const path = join(root, name);
    if (existsSync(path)) {
      try {
        symlinkSync(path, join(bin, name));
      } catch {}
      return;
    }
  }
}
function host(
  args: string[],
  path: string,
  root: string,
  cwd = `${root}/caller`,
  env: Record<string, string> = {},
): Result {
  const environment: Record<string, string> = {
    HOME: process.env.HOME ?? "/",
    PATH: path,
    STUB: join(root, "stub"),
    TMPDIR: root,
    POSTMASTER_HOST_STATE: join(root, "state"),
    POSTMASTER_HOST_FIXTURE: root,
    POSTMASTER_HOST_CLAIM_WAIT: "3",
    POSTMASTER_HOST_CLOSE_WAIT: "1",
    ...env,
  };
  return exec("bun", [SELF, ...args], { cwd, env: environment });
}
function callText(args: string[], path: string, root: string, cwd?: string, env?: Record<string, string>): string {
  const result = host(args, path, root, cwd, env);
  return result.stdout.trim();
}
function calls(root: string, which: string): string[] {
  try {
    return readFileSync(join(root, "stub", `${which}.calls`), "utf8")
      .trimEnd()
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
}
function field(text: string, key: string): string {
  return new RegExp(`(?:^|\\n|\\|)${key}=([^|\\n]*)`).exec(text)?.[1] ?? "";
}
async function marker(path: string, seconds = 20): Promise<boolean> {
  for (let i = 0; i < seconds * 10; i++) {
    if (existsSync(path)) return true;
    await sleep(100);
  }
  return existsSync(path);
}
async function setup(
  root: string,
): Promise<{ repo: string; clone: string; name: string; caller: string; logs: string }> {
  const repo = join(root, "host-test");
  mkdirSync(join(repo, ".worktrees"), { recursive: true });
  let result = exec("git", ["init", "-q", "-b", "main", repo]);
  if (result.code) throw new Error(result.stderr);
  result = exec("git", [
    "-C",
    repo,
    "-c",
    "user.name=test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "first",
  ]);
  if (result.code) throw new Error(result.stderr);
  for (const name of ["T-1-luna", "T-1-sol"]) {
    result = exec("git", ["-C", repo, "worktree", "add", "-q", join(repo, ".worktrees", name), "-b", `wb/${name}`]);
    if (result.code) throw new Error(result.stderr);
  }
  result = exec("git", ["-C", repo, "worktree", "add", "-q", "--detach", join(repo, ".worktrees", "T-1-rev-luna")]);
  if (result.code) throw new Error(result.stderr);
  const clone = join(repo, ".worktrees", "T-1-rev-security-opus");
  result = exec(join(HERE, "cut-scratch.sh"), [
    repo,
    repo,
    clone,
    git("-C", repo, "rev-parse", "HEAD"),
    "--clone",
    "main",
  ]);
  if (result.code) throw new Error(result.stderr);
  const caller = join(root, "caller"),
    logs = join(root, "logs");
  mkdirSync(caller, { recursive: true });
  mkdirSync(logs, { recursive: true });
  writeFileSync(
    join(caller, "fixed.sh"),
    [
      "#!/usr/bin/env bash",
      'printf \'{"type":"system","subtype":"init","session_id":"fixed-1","model":"m"}\\n\'',
      'printf \'{"type":"assistant","message":{"content":[{"type":"text","text":"step one"}]}}\\n\'',
      "printf 'a line on stderr\\n' >&2",
      'sleep "$(printenv EMIT_SLEEP || printf 0)"',
      'printf \'{"type":"result","subtype":"success","num_turns":1}\\n\'',
      "exit 3",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(caller, "probe.sh"),
    [
      "#!/usr/bin/env bash",
      'printf \'{"type":"system","subtype":"init","session_id":"probe-1","model":"m"}\\n\'',
      "if (: < /dev/tty) 2>/dev/null; then tty=yes; else tty=no; fi",
      'printf \'from=%s|name=%s|pane=%s|tmuxpane=%s|var=%s|sid=%s|pid=%s|pgid=%s|tty=%s\\n\' "$PWD" "$POSTMASTER_LAUNCH_NAME" "$HERDR_PANE_ID" "$TMUX_PANE" "$CALLER_VAR" "$(ps -o sid= -p $$ | tr -d \' \')" "$$" "$(ps -o pgid= -p $$ | tr -d \' \')" "$tty"',
      'count_path=$(printenv COUNT); if [ -n "$count_path" ]; then echo x >> "$count_path"; fi',
      'sleep "$(printenv EMIT_SLEEP || printf 0)"',
      "",
    ].join("\n"),
  );
  for (const path of [join(caller, "fixed.sh"), join(caller, "probe.sh")]) exec("chmod", ["+x", path]);
  const run = join(root, "run-1");
  mkdirSync(run, { recursive: true });
  const hostile = `#1, Stop $(touch ${join(root, "canary")}) "breaking" a shell`;
  writeFileSync(
    join(run, "brief.md"),
    `# Waybill: 1\n\n## Ticket\nname: not this one\n\n## Dispatch\nname: ${hostile}\ndispatch: ${run}\n`,
  );
  return { repo: resolve(repo), clone: resolve(clone), name: hostile, caller, logs };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
async function makeHarness(root: string): Promise<{ sys: string; stubs: string }> {
  const bin = join(root, "bin"),
    sys = join(root, "sys");
  mkdirSync(bin);
  mkdirSync(sys);
  mkdirSync(join(root, "stub"));
  const tools = [
    "bun",
    "bash",
    "sh",
    "git",
    "env",
    "printenv",
    "cat",
    "mkdir",
    "rmdir",
    "rm",
    "mkfifo",
    "mktemp",
    "sleep",
    "date",
    "touch",
    "wc",
    "tr",
    "sed",
    "awk",
    "dirname",
    "basename",
    "grep",
    "head",
    "tail",
    "cut",
    "sort",
    "cmp",
    "ls",
    "seq",
    "timeout",
    "find",
    "cksum",
    "ps",
    "sysctl",
    "getconf",
    "chmod",
    "ln",
    "cp",
    "mv",
    "tee",
  ];
  for (const tool of tools) symlinkCommand(tool, sys);
  for (const tool of ["herdr", "tmux"]) {
    const script = `#!/bin/sh\nexec bun ${shellQuote(SCRIPT)} --stub ${tool} "$@"\n`;
    const path = join(bin, tool);
    writeFileSync(path, script, { mode: 0o755 });
  }
  return { sys, stubs: `${bin}:${sys}` };
}
function resetHarness(root: string): void {
  const dir = join(root, "stub");
  for (const name of readdirSync(dir)) rmSync(join(dir, name), { recursive: true, force: true });
}
function readdir(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

async function check(label: string, test: () => boolean | Promise<boolean>, detail = ""): Promise<boolean> {
  try {
    if (await test()) {
      writeOut(`  ok   ${label}`);
      return true;
    }
  } catch (error) {
    detail = detail || String((error as Error).message ?? error);
  }
  writeOut(`  FAIL ${label}`);
  if (detail) writeOut(`         ${detail.replace(/\n/g, "\n         ")}`);
  return false;
}
async function runControls(): Promise<void> {
  const root = mkdtempSync(join(HERE, ".host-self-test-"));
  let failures = 0;
  const pass = async (label: string, test: () => boolean | Promise<boolean>, detail = "") => {
    if (!(await check(label, test, detail))) failures++;
  };
  try {
    const paths = await makeHarness(root);
    const f = await setup(root);
    const noHost = paths.sys,
      stubs = paths.stubs;
    const stub = join(root, "stub"),
      logs = f.logs;
    const execHost = (args: string[], path = noHost, cwd = f.caller, env: Record<string, string> = {}) =>
      host(args, path, root, cwd, env);
    const markerPath = (name: string) => join(logs, `${name}.done`);
    const readCalls = (name: string) => calls(root, name).join("\n");
    writeOut("detect");
    await pass("a Herdr server that answers is the host", () => callText(["detect"], stubs, root) === "herdr");
    writeFileSync(join(stub, "herdr.down"), "");
    await pass("with no Herdr server answering, tmux is", () => callText(["detect"], stubs, root) === "tmux");
    resetHarness(root);
    await pass("with neither on PATH, none", () => callText(["detect"], noHost, root) === "none");
    await pass(
      "POSTMASTER_HOST=none wins over a live Herdr",
      () => callText(["detect"], stubs, root, undefined, { POSTMASTER_HOST: "none" }) === "none",
    );
    await pass(
      "POSTMASTER_HOST=tmux wins over a live Herdr",
      () => callText(["detect"], stubs, root, undefined, { POSTMASTER_HOST: "tmux" }) === "tmux",
    );
    writeOut("name: from the waybill");
    await pass(
      "it is the Dispatch section's name, then the role",
      () => callText(["name", join(root, "run-1"), "luna"], noHost, root) === `${f.name} · luna`,
    );
    await pass(
      "a waybill without one falls back to the run's directory",
      () => callText(["name", logs, "coachman"], noHost, root) === "logs · coachman",
    );
    writeFileSync(join(logs, "brief.md"), "## Dispatch\nname: #2, a bell\u0007 and an escape\u001b]0;x\u0007 · y\n");
    await pass(
      "control characters never reach a label",
      () => callText(["name", logs], noHost, root) === "#2, a bell and an escape]0;x · y",
    );
    rmSync(join(logs, "brief.md"), { force: true });

    writeOut("run, no host: headless launch");
    const direct = exec(join(f.caller, "fixed.sh"), [], { cwd: f.caller, env: { ...process.env } });
    const headless = execHost([
      "run",
      f.name,
      join(f.repo, ".worktrees/T-1-luna"),
      "--out",
      "../logs/n1.out",
      "--err",
      "../logs/n1.err",
      "--marker",
      "../logs/n1.done",
      "--",
      "./fixed.sh",
    ]);
    await pass(
      "it says it ran in the background",
      () => headless.code === 0 && headless.stdout.trim() === "host=none",
      headless.stderr,
    );
    await marker(markerPath("n1"));
    await pass(
      "stdout and stderr are byte for byte a direct run's",
      () =>
        readFileSync(join(logs, "n1.out"), "utf8") === direct.stdout &&
        readFileSync(join(logs, "n1.err"), "utf8") === direct.stderr,
    );
    await pass("and the title's shell syntax never ran", () => !existsSync(join(root, "canary")));
    writeFileSync(markerPath("n2"), "old marker");
    const pending = execHost(
      ["run", f.name, f.repo, "--marker", "../logs/n2.done", "--", "./fixed.sh"],
      noHost,
      f.caller,
      { EMIT_SLEEP: "1" },
    );
    await pass(
      "an earlier launch's marker is gone once run returns",
      () => pending.code === 0 && !existsSync(markerPath("n2")),
    );
    await pass("and it lands again when this one exits, whatever its exit", () => marker(markerPath("n2"), 15));
    const _probe = execHost(
      [
        "run",
        f.name,
        join(f.repo, ".worktrees/T-1-luna"),
        "--out",
        "../logs/n3.out",
        "--marker",
        "../logs/n3.done",
        "--pidfile",
        "../logs/n3.pid",
        "--",
        "./probe.sh",
      ],
      noHost,
      f.caller,
      { CALLER_VAR: "v", HERDR_PANE_ID: "caller-pane", TMUX_PANE: "%9" },
    );
    await marker(markerPath("n3"));
    const probeText = readFileSync(join(logs, "n3.out"), "utf8");
    await pass(
      "it runs from the caller's directory, with the caller's environment and its name",
      () =>
        field(probeText, "from") === f.caller && field(probeText, "var") === "v" && field(probeText, "name") === f.name,
      JSON.stringify({
        from: field(probeText, "from"),
        expected: f.caller,
        var: field(probeText, "var"),
        name: field(probeText, "name"),
        expectedName: f.name,
      }),
    );
    await pass(
      "but never with its caller's pane",
      () => field(probeText, "pane") === "" && field(probeText, "tmuxpane") === "",
      probeText,
    );
    await pass(
      "it is a session of its own: its group is its pid, not the caller's session",
      () => field(probeText, "pgid") === field(probeText, "pid") && field(probeText, "sid") === field(probeText, "pid"),
      probeText,
    );
    await pass(
      "--pidfile holds the launch's pid",
      () => readFileSync(join(logs, "n3.pid"), "utf8").trim() === field(probeText, "pid"),
    );
    const live = execHost(
      ["run", f.name, f.repo, "--pidfile", "../logs/n5.pid", "--marker", "../logs/n5.done", "--", "./fixed.sh"],
      noHost,
      f.caller,
      { EMIT_SLEEP: "2" },
    );
    await pass(
      "and it is there, for a live process, the moment run returns",
      () => live.code === 0 && existsSync(join(logs, "n5.pid")),
    );
    await marker(markerPath("n5"), 20);
    writeFileSync(join(logs, "n4.out"), "before\n");
    writeFileSync(join(logs, "n4.err"), "old error\n");
    execHost([
      "run",
      f.name,
      f.repo,
      "--out",
      "../logs/n4.out",
      "--err",
      "../logs/n4.err",
      "--append",
      "--marker",
      "../logs/n4.done",
      "--",
      "./fixed.sh",
    ]);
    await marker(markerPath("n4"));
    await pass(
      "--append keeps what the stream held, and --err holds only this launch's errors",
      () =>
        readFileSync(join(logs, "n4.out"), "utf8").split("\n")[0] === "before" &&
        readFileSync(join(logs, "n4.err"), "utf8").trim() === "a line on stderr",
    );
    const missingSeparator = execHost(["run", f.name, f.repo, "--marker", markerPath("n6"), "./fixed.sh"]);
    await pass(
      "a command without -- is refused, and its marker lands",
      () => missingSeparator.code === 1 && existsSync(markerPath("n6")),
    );
    const noDir = execHost([
      "run",
      f.name,
      join(root, "nowhere"),
      "--err",
      join(logs, "n7.err"),
      "--marker",
      markerPath("n7"),
      "--",
      "./fixed.sh",
    ]);
    await pass(
      "a directory that does not exist: refused, the marker lands and --err says why",
      () =>
        noDir.code === 1 &&
        existsSync(markerPath("n7")) &&
        readFileSync(join(logs, "n7.err"), "utf8").includes("no such directory"),
    );
    const invalid = execHost(
      ["run", f.name, f.repo, "--marker", markerPath("n8"), "--", "./fixed.sh"],
      noHost,
      f.caller,
      { POSTMASTER_HOST_CLAIM_WAIT: "2.5" },
    );
    await pass(
      "a count that is not a whole number is refused, and never reaches the tests",
      () => invalid.code === 1 && existsSync(markerPath("n8")) && !invalid.stdout.includes("controls"),
    );
    const invalidWait = execHost(["wait", "postmaster-x", "10m"], stubs);
    await pass("the same for wait", () => invalidWait.code === 1 && !invalidWait.stdout.includes("controls"));

    writeOut("stop: owned process trees and refusal controls");
    const sol = join(f.repo, ".worktrees/T-1-sol");
    const treeScript = join(f.caller, "tree.sh");
    mkdirSync(join(root, "tree"), { recursive: true });
    writeFileSync(treeScript, '#!/usr/bin/env bash\nsleep 60 & echo $! > "$TREE/child.pid"\nwait\n');
    exec("chmod", ["+x", treeScript]);
    const treeRun = execHost(
      ["run", f.name, sol, "--marker", "../logs/tree.done", "--pidfile", "../logs/tree.pid", "--", "./tree.sh"],
      noHost,
      f.caller,
      { TREE: join(root, "tree") },
    );
    for (let i = 0; i < 30 && !existsSync(join(root, "tree/child.pid")); i++) await sleep(100);
    const stop = execHost(["stop", sol], noHost, root, { POSTMASTER_HOST_STOP_WAIT: "1" });
    await pass(
      "stop reaches a child the launch runs in a session of its own",
      () => treeRun.code === 0 && stop.code === 0,
    );
    await pass("its marker lands", () => marker(markerPath("tree"), 10));

    const termScript = join(f.caller, "term-tree.sh");
    writeFileSync(
      termScript,
      [
        "#!/usr/bin/env bash",
        "trap 'echo term >> \"$TREE/term\"; exit 0' TERM",
        'setsid sleep 120 & echo $! > "$TREE/escapee.pid"',
        'sh -c \'trap "" TERM; while :; do sleep 1; done\' & echo $! > "$TREE/deaf.pid"',
        "sleep 120 & wait",
        "",
      ].join("\n"),
    );
    exec("chmod", ["+x", termScript]);
    const termRun = execHost(
      [
        "run",
        f.name,
        join(f.repo, ".worktrees/T-1-luna"),
        "--marker",
        "../logs/k1.done",
        "--pidfile",
        "../logs/k1.pid",
        "--",
        "./term-tree.sh",
      ],
      noHost,
      f.caller,
      { TREE: join(root, "tree") },
    );
    for (
      let i = 0;
      i < 50 && (!existsSync(join(root, "tree/escapee.pid")) || !existsSync(join(root, "tree/deaf.pid")));
      i++
    )
      await sleep(100);
    const outsider = spawn("sleep", ["60"], { cwd: sol, detached: true, stdio: "ignore" });
    outsider.unref();
    const termStop = execHost(["stop", join(f.repo, ".worktrees/T-1-luna")], noHost, root, {
      POSTMASTER_HOST_STOP_WAIT: "2",
    });
    const alive = (pid: string) => {
      try {
        return !readFileSync(`/proc/${pid}/stat`, "utf8")
          .slice(readFileSync(`/proc/${pid}/stat`, "utf8").lastIndexOf(")") + 1)
          .trim()
          .startsWith("Z");
      } catch {
        return false;
      }
    };
    const escapee = readFileSync(join(root, "tree/escapee.pid"), "utf8").trim();
    const deaf = readFileSync(join(root, "tree/deaf.pid"), "utf8").trim();
    await pass(
      "the launch got TERM first, and a child deaf to it is killed after the wait",
      () => termRun.code === 0 && termStop.code === 0 && existsSync(join(root, "tree/term")) && !alive(deaf),
    );
    await pass(
      "a process that works in the worktree but that no launch started is left alone",
      () => !!outsider.pid && alive(String(outsider.pid)) && !alive(escapee),
    );
    try {
      if (outsider.pid) process.kill(outsider.pid, "SIGKILL");
    } catch {}
    await pass("its marker lands", () => marker(markerPath("k1"), 10));

    writeOut("stop: registry identity and process membership");
    const launchDir = join(root, "state", "launches");
    mkdirSync(launchDir, { recursive: true });
    const boot = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
    const bootLine =
      readFileSync("/proc/stat", "utf8")
        .split("\n")
        .find((line: string) => line.startsWith("btime ")) ?? "btime 0";
    const bootSeconds = Number(bootLine.split(/\s+/)[1]);
    const ticks = Number(exec("getconf", ["CLK_TCK"]).stdout.trim()) || 100;
    const procStart = (pid: string): string => {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      return (
        stat
          .slice(stat.lastIndexOf(")") + 1)
          .trim()
          .split(/\s+/)[19] ?? ""
      );
    };
    const startedSeconds = (pid: string) => bootSeconds + Number(procStart(pid)) / ticks;
    const record = (pid: string) => join(launchDir, pid);
    const stale = spawn("sleep", ["60"], { detached: true, stdio: "ignore" });
    stale.unref();
    const stalePid = String(stale.pid);
    const stopSol = () => execHost(["stop", sol], noHost, root, { POSTMASTER_HOST_STOP_WAIT: "1" });
    writeFileSync(record(stalePid), `${sol}\nnot this\nstart 1\nboot ${boot}\n`);
    let staleStop = stopSol();
    await pass(
      "a record whose leader has another start time is removed, and stop signals nothing",
      () =>
        staleStop.code === 0 &&
        staleStop.stdout.trim() === `no launch is running in ${sol}` &&
        alive(stalePid) &&
        !existsSync(record(stalePid)),
    );
    writeFileSync(record(stalePid), `${sol}\nnot this\nstart ${procStart(stalePid)}\nboot another-boot\n`);
    staleStop = stopSol();
    await pass(
      "a record from another boot is removed, and stop signals nothing",
      () => staleStop.code === 0 && alive(stalePid) && !existsSync(record(stalePid)),
    );
    writeFileSync(record(stalePid), `${sol}\nnot this\n`);
    utimesSync(record(stalePid), new Date((bootSeconds - 60) * 1000), new Date((bootSeconds - 60) * 1000));
    staleStop = stopSol();
    await pass(
      "a record from before this change, written before this boot, is removed",
      () => staleStop.code === 0 && alive(stalePid) && !existsSync(record(stalePid)),
    );
    writeFileSync(record(stalePid), `${sol}\nnot this\n`);
    const began = startedSeconds(stalePid) - 30;
    utimesSync(record(stalePid), new Date(began * 1000), new Date(began * 1000));
    staleStop = stopSol();
    await pass(
      "a record from before this change, naming a pid that started after it was written, is removed",
      () => staleStop.code === 0 && alive(stalePid) && !existsSync(record(stalePid)),
    );
    writeFileSync(record(stalePid), `${sol}\nlegacy\n`);
    const legacyClose = execHost(["close", sol], noHost, root);
    const upgraded = readFileSync(record(stalePid), "utf8");
    await pass(
      "a record from before this change, written by a leader already running, is kept and rewritten",
      () =>
        legacyClose.code === 2 &&
        upgraded.includes(`start ${procStart(stalePid)}\n`) &&
        upgraded.includes(`boot ${boot}\n`),
    );
    try {
      if (stale.pid) process.kill(stale.pid, "SIGKILL");
    } catch {}
    rmSync(record(stalePid), { force: true });

    const leaves = join(f.caller, "leaves.sh");
    writeFileSync(leaves, '#!/usr/bin/env bash\nsleep 60 & echo $! > "$TREE/left.pid"\n');
    exec("chmod", ["+x", leaves]);
    execHost(
      ["run", f.name, sol, "--marker", "../logs/k2.done", "--pidfile", "../logs/k2.pid", "--", "./leaves.sh"],
      noHost,
      f.caller,
      { TREE: join(root, "tree") },
    );
    await marker(markerPath("k2"));
    const leader = readFileSync(join(logs, "k2.pid"), "utf8").trim();
    const leftPid = readFileSync(join(root, "tree/left.pid"), "utf8").trim();
    let memberText = "";
    for (let i = 0; i < 30; i++) {
      memberText = readFileSync(record(leader), "utf8");
      if (memberText.includes(`member ${leftPid}`)) break;
      await sleep(100);
    }
    await pass(
      "a leader that exits leaving a process behind: its record names that process",
      () => memberText.split("\n").some((line) => line === `member ${leftPid} ${procStart(leftPid)}`),
      memberText,
    );
    const stopMember = stopSol();
    await pass("and stop ends that process", () => stopMember.code === 0 && !alive(leftPid));

    for (const [args, label] of [
      [["bash", "-c", "exec -a systemd sleep 60"], "a systemd manager"],
      [["bash", "-c", "exec -a moshi-hook bash -c 'while :; do sleep 1; done' serve"], "the moshi-hook daemon"],
    ] as Array<[string[], string]>) {
      const guarded = execHost(
        ["run", f.name, sol, "--marker", "../logs/guard.done", "--pidfile", "../logs/guard.pid", "--", ...args],
        noHost,
        f.caller,
      );
      for (let i = 0; i < 30 && !existsSync(join(logs, "guard.pid")); i++) await sleep(100);
      await sleep(300);
      const refused = stopSol();
      const guardedPid = readFileSync(join(logs, "guard.pid"), "utf8").trim();
      await pass(
        `stop refuses a tree holding ${label}, and leaves it all running`,
        () =>
          guarded.code === 0 &&
          refused.code === 2 &&
          refused.stderr.includes(label) &&
          alive(guardedPid) &&
          !existsSync(markerPath("guard")),
        refused.stderr,
      );
      try {
        process.kill(-Number(guardedPid), "SIGKILL");
      } catch {
        try {
          process.kill(Number(guardedPid), "SIGKILL");
        } catch {}
      }
      await marker(markerPath("guard"), 10);
      rmSync(join(logs, "guard.pid"), { force: true });
    }

    const wide = execHost(
      [
        "run",
        f.name,
        sol,
        "--marker",
        "../logs/wide.done",
        "--pidfile",
        "../logs/wide.pid",
        "--",
        "bash",
        "-c",
        "sleep 60 & sleep 60 & sleep 60 & sleep 60 & wait",
      ],
      noHost,
      f.caller,
    );
    await sleep(300);
    const overMax = execHost(["stop", sol], noHost, root, {
      POSTMASTER_HOST_STOP_MAX: "3",
      POSTMASTER_HOST_STOP_WAIT: "0",
    });
    await pass(
      "stop refuses a tree larger than POSTMASTER_HOST_STOP_MAX, and leaves it running",
      () =>
        wide.code === 0 &&
        overMax.code === 2 &&
        overMax.stderr.includes("more than POSTMASTER_HOST_STOP_MAX (3)") &&
        existsSync(join(logs, "wide.pid")) &&
        !existsSync(markerPath("wide")),
      overMax.stderr,
    );
    const withinBound = stopSol();
    await pass(
      "within the bound, the same tree is stopped",
      () => withinBound.code === 0 && marker(markerPath("wide"), 10),
    );

    const unrelated = spawn("sleep", ["60"], { cwd: sol, detached: true, stdio: "ignore" });
    unrelated.unref();
    const unrelatedRun = execHost(
      [
        "run",
        f.name,
        sol,
        "--marker",
        "../logs/unrelated.done",
        "--pidfile",
        "../logs/unrelated.pid",
        "--",
        "sleep",
        "60",
      ],
      noHost,
      f.caller,
    );
    const unrelatedStop = execHost(["stop", sol], noHost, root, { POSTMASTER_HOST_STOP_WAIT: "0" });
    await pass("a process that works in the worktree but that no launch started is left alone", () => {
      if (unrelatedRun.code !== 0 || unrelatedStop.code !== 0 || !unrelated.pid) return false;
      try {
        process.kill(unrelated.pid, 0);
        return true;
      } catch {
        return false;
      }
    });
    try {
      if (unrelated.pid) process.kill(unrelated.pid, "SIGKILL");
    } catch {}
    await marker(markerPath("unrelated"), 10);
    const inside = execHost(["stop", sol], noHost, sol);
    await pass(
      "stop refuses to run from inside the worktree it would stop",
      () => inside.code === 1 && inside.stderr.includes("from inside it"),
    );
    const badMaxRun = execHost(
      [
        "run",
        f.name,
        sol,
        "--marker",
        "../logs/wide.done",
        "--pidfile",
        "../logs/wide.pid",
        "--",
        "bash",
        "-c",
        "sleep 60 & sleep 60 & wait",
      ],
      noHost,
      f.caller,
    );
    const badMax = execHost(["stop", sol], noHost, root, {
      POSTMASTER_HOST_STOP_MAX: "1",
      POSTMASTER_HOST_STOP_WAIT: "0",
    });
    await pass(
      "stop refuses a tree larger than POSTMASTER_HOST_STOP_MAX, and leaves it running",
      () => badMaxRun.code === 0 && badMax.code === 2 && badMax.stderr.includes("more than POSTMASTER_HOST_STOP_MAX"),
    );
    const withinMax = execHost(["stop", sol], noHost, root, { POSTMASTER_HOST_STOP_WAIT: "0" });
    await pass(
      "within the bound, the same tree is stopped",
      () => withinMax.code === 0 && marker(markerPath("wide"), 10),
    );
    const outsideFixture = execHost(["stop", sol], noHost, root, { POSTMASTER_HOST_STATE: `${root}.elsewhere` });
    await pass(
      "while a self-test runs, a registry outside its fixture is refused",
      () =>
        outsideFixture.code === 1 &&
        outsideFixture.stderr.includes("refusing the registry") &&
        !existsSync(`${root}.elsewhere`),
    );

    writeOut("run, Herdr (stub): pane placement and environment handover");
    resetHarness(root);
    const herdrRun = execHost(
      [
        "run",
        f.name,
        join(f.repo, ".worktrees/T-1-luna"),
        "--out",
        "../logs/h1.out",
        "--err",
        "../logs/h1.err",
        "--marker",
        "../logs/h1.done",
        "--",
        "./probe.sh",
      ],
      stubs,
      f.caller,
      { CALLER_VAR: "v", HERDR_PANE_ID: "caller-pane" },
    );
    const place = /space=(\S+) tab=(\S+) pane=(\S+)/.exec(herdrRun.stdout);
    await pass("it says where it ran", () => herdrRun.code === 0 && !!place, herdrRun.stdout + herdrRun.stderr);
    const pane = place?.[3] ?? "";
    const state = json(join(stub, "herdr.json"), { spaces: {}, panes: {}, open: {} });
    const spaceId = place?.[1] ?? "";
    const worktree = join(f.repo, ".worktrees/T-1-luna");
    const listedCalls = readCalls("herdr");
    await pass(
      "a repository with no space gets one first, labelled with its name",
      () => listedCalls.includes(`workspace\tcreate\t--cwd\t${f.repo}\t--label\t${basename(f.repo)}\t--no-focus`),
      listedCalls,
    );
    await pass(
      "the worktree opens as a space under it, labelled with the launch's name",
      () =>
        listedCalls.includes(`worktree\topen\t--workspace\tw1\t--path\t${worktree}\t--label\t${f.name}\t--no-focus`),
      listedCalls,
    );
    await pass(
      "host.sh marks the space it opened as its own",
      () => state.spaces[spaceId]?.tokens?.postmaster === "opened",
    );
    await marker(markerPath("h1"));
    await sleep(300);
    const herdrOut = readFileSync(join(logs, "h1.out"), "utf8");
    await pass(
      "the launch ran in that pane, with that pane's identity",
      () => field(herdrOut, "pane") === pane,
      herdrOut,
    );
    await pass(
      "and with its caller's environment, handed over by host.sh",
      () => field(herdrOut, "var") === "v" && field(herdrOut, "from") === f.caller,
      JSON.stringify({ from: field(herdrOut, "from"), expected: f.caller, var: field(herdrOut, "var") }),
    );
    await pass(
      "the pane shows the name and the rendered stream, not raw JSON",
      () =>
        existsSync(join(stub, `pane-${pane}.out`)) &&
        !readFileSync(join(stub, `pane-${pane}.out`), "utf8").includes('{"type"'),
    );
    const reportCalls = readCalls("herdr");
    await pass(
      "and reports the launch working, then releases it",
      () => reportCalls.includes(`pane\treport-agent\t${pane}`) && reportCalls.includes(`pane\trelease-agent\t${pane}`),
      reportCalls,
    );
    const secondHerdr = execHost(
      ["run", f.name, worktree, "--marker", "../logs/h2.done", "--", "./fixed.sh"],
      stubs,
      f.caller,
    );
    await pass(
      "a second launch in the same worktree is a new tab in the same space",
      () =>
        secondHerdr.code === 0 &&
        calls(root, "herdr").filter((line) => line.startsWith("worktree\topen")).length === 1 &&
        calls(root, "herdr").some((line) => line.startsWith(`tab\tcreate\t--workspace\t${spaceId}`)),
    );
    await marker(markerPath("h2"));
    const directOut = exec(join(f.caller, "fixed.sh"), [], { cwd: f.caller, env: process.env });
    const sameStreams = execHost(
      [
        "run",
        f.name,
        worktree,
        "--out",
        "../logs/h3.out",
        "--err",
        "../logs/h3.err",
        "--marker",
        "../logs/h3.done",
        "--",
        "./fixed.sh",
      ],
      stubs,
      f.caller,
    );
    await marker(markerPath("h3"));
    await pass(
      "the stream and the marker are what a background run writes",
      () =>
        sameStreams.code === 0 &&
        readFileSync(join(logs, "h3.out"), "utf8") === directOut.stdout &&
        readFileSync(join(logs, "h3.err"), "utf8") === directOut.stderr,
    );

    writeFileSync(join(stub, "pane.dead"), "");
    const deadFallback = execHost(
      [
        "run",
        f.name,
        join(f.repo, ".worktrees/T-1-sol"),
        "--out",
        "../logs/h4.out",
        "--marker",
        "../logs/h4.done",
        "--",
        "./probe.sh",
      ],
      stubs,
      f.caller,
      { COUNT: join(logs, "h4.count") },
    );
    await marker(markerPath("h4"));
    await pass(
      "a pane that never starts the launch: it runs in the background instead",
      () =>
        deadFallback.code === 0 &&
        deadFallback.stdout.trim() === "host=none" &&
        readFileSync(join(logs, "h4.count"), "utf8").trim().split("\n").length === 1,
      deadFallback.stderr,
    );
    rmSync(join(stub, "pane.dead"), { force: true });
    writeFileSync(join(stub, "pane.late"), "");
    const late = execHost(
      ["run", f.name, join(f.repo, ".worktrees/T-1-sol"), "--marker", "../logs/h5.done", "--", "./probe.sh"],
      stubs,
      f.caller,
      { POSTMASTER_HOST_CLAIM_WAIT: "1", COUNT: join(logs, "h5.count") },
    );
    await marker(markerPath("h5"));
    await sleep(5200);
    await pass(
      "a pane that starts it late: it still runs exactly once",
      () =>
        late.stdout.trim() === "host=none" &&
        readFileSync(join(logs, "h5.count"), "utf8").trim().split("\n").length === 1,
    );
    rmSync(join(stub, "pane.late"), { force: true });
    await pass("no launch leaves its hand-over directory behind", () =>
      readdir(root).every((name) => !name.startsWith("postmaster-host.")),
    );

    writeOut("stop and close, Herdr (stub)");
    const openedSpace = json(join(stub, "herdr.json"), { open: {} }).open[worktree] ?? spaceId;
    const closedHerdr = execHost(["close", worktree], stubs, root);
    await pass(
      "a space host.sh opened, its launches done, is closed",
      () => closedHerdr.code === 0 && calls(root, "herdr").some((line) => line === `workspace\tclose\t${openedSpace}`),
    );
    const ownClose = execHost(["close", f.repo], stubs, root);
    await pass(
      "the repository's own checkout is refused",
      () => ownClose.code === 2 && ownClose.stderr.includes("own checkout"),
    );
    const herdrStatePath = join(stub, "herdr.json");
    const currentState = json(herdrStatePath, { n: 0, spaces: {}, panes: {}, open: {} });
    currentState.n++;
    const userSpace = `w${currentState.n}`;
    currentState.n++;
    const userPane = `p${currentState.n}`;
    currentState.spaces[userSpace] = { label: "the user's", tokens: {}, panes: [userPane] };
    currentState.panes[userPane] = { ws: userSpace, tokens: { postmaster: "launch", state: "done" } };
    currentState.open[join(f.repo, ".worktrees/T-1-rev-luna")] = userSpace;
    save(herdrStatePath, currentState);
    const userSpaceClose = execHost(["close", join(f.repo, ".worktrees/T-1-rev-luna")], stubs, root);
    await pass(
      "a space host.sh did not open is refused, and left open",
      () =>
        userSpaceClose.code === 2 &&
        userSpaceClose.stderr.includes("was not opened by host.sh") &&
        !calls(root, "herdr").includes(`workspace\tclose\t${userSpace}`),
    );
    writeFileSync(join(stub, "pane.dead"), "");
    const liveFallback = execHost(
      ["run", f.name, join(f.repo, ".worktrees/T-1-sol"), "--marker", "../logs/s1.done", "--", "sleep", "60"],
      stubs,
      f.caller,
    );
    rmSync(join(stub, "pane.dead"), { force: true });
    const refusedClose = execHost(["close", join(f.repo, ".worktrees/T-1-sol")], stubs, root);
    await pass(
      "a launch that fell back to the background still holds its worktree: close refuses",
      () => liveFallback.stdout.trim() === "host=none" && refusedClose.code === 2,
    );
    const stopFallback = execHost(["stop", join(f.repo, ".worktrees/T-1-sol")], stubs, root, {
      POSTMASTER_HOST_STOP_WAIT: "0",
    });
    await pass("stop ends it, and its marker lands", () => stopFallback.code === 0 && marker(markerPath("s1"), 10));
    const closeAfterStop = execHost(["close", join(f.repo, ".worktrees/T-1-sol")], stubs, root);
    await pass("then close closes the space", () => closeAfterStop.code === 0);

    writeOut("a reviewer's scratch clone, Herdr (stub)");
    resetHarness(root);
    const cloneRun = execHost(
      ["run", f.name, f.clone, "--marker", "../logs/c1.done", "--", "./fixed.sh"],
      stubs,
      f.caller,
    );
    const cloneSpace = /space=(\S+)/.exec(cloneRun.stdout)?.[1] ?? "";
    const cloneCalls = calls(root, "herdr");
    await pass(
      "it opens as a space of the launch's own, labelled with its name, and no other",
      () =>
        cloneCalls.filter((line) => line.startsWith("workspace\tcreate")).length === 1 &&
        cloneCalls.some((line) => line.includes(`--cwd\t${f.clone}\t--label\t${f.name}`)),
    );
    await pass(
      "host.sh marks that space as its own",
      () => json(join(stub, "herdr.json"), { spaces: {} }).spaces[cloneSpace]?.tokens?.postmaster === "opened",
    );
    await marker(markerPath("c1"));
    const cloneAgain = execHost(
      ["run", f.name, f.clone, "--marker", "../logs/c2.done", "--", "./fixed.sh"],
      stubs,
      f.caller,
    );
    await pass(
      "a second launch there is a new tab in the same space",
      () =>
        cloneAgain.code === 0 &&
        calls(root, "herdr").filter((line) => line.startsWith("workspace\tcreate")).length === 1 &&
        calls(root, "herdr").some((line) => line.startsWith(`tab\tcreate\t--workspace\t${cloneSpace}`)),
    );
    await marker(markerPath("c2"));
    const cloneClose = execHost(["close", f.clone], stubs, root);
    await pass(
      "close shuts it",
      () => cloneClose.code === 0 && calls(root, "herdr").includes(`workspace\tclose\t${cloneSpace}`),
    );
    const plain = join(root, "plain");
    exec("git", ["clone", "-q", f.repo, plain]);
    const plainRun = execHost(
      ["run", f.name, plain, "--marker", "../logs/c3.done", "--", "./fixed.sh"],
      stubs,
      f.caller,
    );
    await marker(markerPath("c3"));
    const plainSpace = /space=(\S+)/.exec(plainRun.stdout)?.[1] ?? "";
    const plainClose = execHost(["close", plain], stubs, root);
    await pass(
      "a plain clone is no scratch: it opens as a repository, and close refuses its space",
      () =>
        calls(root, "herdr").some((line) => line.includes(`--cwd\t${plain}\t--label\tplain`)) &&
        plainClose.code === 2 &&
        !calls(root, "herdr").includes(`workspace\tclose\t${plainSpace}`),
    );

    writeOut("run, stop and close, tmux (stub)");
    resetHarness(root);
    const tmuxEnvRun = execHost(
      ["run", f.name, worktree, "--out", "../logs/t1.out", "--marker", "../logs/t1.done", "--", "./probe.sh"],
      stubs,
      f.caller,
      { POSTMASTER_HOST: "tmux", CALLER_VAR: "v" },
    );
    await marker(markerPath("t1"));
    await pass(
      "a first launch opens session postmaster-<repo>, a window named for it",
      () =>
        tmuxEnvRun.stdout.trim() === `host=tmux session=postmaster-${basename(f.repo)} window=@1` &&
        calls(root, "tmux").some((line) =>
          line.startsWith(`new-session\t-d\t-P\t-F\t#{window_id}\t-s\tpostmaster-${basename(f.repo)}\t-n\t${f.name}`),
        ),
      `${tmuxEnvRun.stdout}\n${readFileSync(join(stub, "win-1.out"), "utf8")}`,
    );
    const tmuxProbe = readFileSync(join(logs, "t1.out"), "utf8");
    await pass(
      "the launch ran with that window's pane and its caller's environment",
      () => field(tmuxProbe, "tmuxpane") === "%1" && field(tmuxProbe, "var") === "v",
      tmuxProbe +
        "\nwindow:\n" +
        readFileSync(join(stub, "win-1.env"), "utf8") +
        "\npane out:\n" +
        readFileSync(join(stub, "win-1.out"), "utf8"),
    );
    const nextTmux = execHost(
      ["run", f.name, worktree, "--marker", "../logs/t2.done", "--", "sleep", "60"],
      stubs,
      f.caller,
      { POSTMASTER_HOST: "tmux" },
    );
    await pass(
      "the next is a window in the same session",
      () =>
        nextTmux.code === 0 &&
        calls(root, "tmux").some((line) =>
          line.startsWith(`new-window\t-d\t-P\t-F\t#{window_id}\t-t\t=postmaster-${basename(f.repo)}:`),
        ),
    );
    const closeWhileRunning = execHost(["close", worktree], stubs, root, { POSTMASTER_HOST: "tmux" });
    await pass(
      "close refuses while a launch still runs in the worktree",
      () => closeWhileRunning.code === 2 && !calls(root, "tmux").some((line) => line.startsWith("kill-window")),
    );
    const stopTmux = execHost(["stop", worktree], stubs, root, {
      POSTMASTER_HOST: "tmux",
      POSTMASTER_HOST_STOP_WAIT: "0",
    });
    await marker(markerPath("t2"));
    const closeTmux = execHost(["close", worktree], stubs, root, { POSTMASTER_HOST: "tmux" });
    await pass(
      "once it is stopped, close kills that worktree's windows",
      () =>
        stopTmux.code === 0 &&
        closeTmux.code === 0 &&
        calls(root, "tmux").filter((line) => line.startsWith("kill-window")).length === 2,
    );
    const cloneTmux = execHost(
      ["run", f.name, f.clone, "--marker", "../logs/t3.done", "--", "./fixed.sh"],
      stubs,
      f.caller,
      { POSTMASTER_HOST: "tmux" },
    );
    await marker(markerPath("t3"));
    const tmuxState = json(join(stub, "tmux.json"), { sessions: [], windows: {} });
    const cloneWindow = Object.values(tmuxState.windows).some(
      (window: any) =>
        window.session === `postmaster-${basename(f.repo)}` && window.opts["@postmaster_cwd"] === f.clone,
    );
    await pass(
      "a reviewer's scratch clone gets a window in the session of the repository it was cut from",
      () => cloneTmux.code === 0 && cloneWindow && tmuxState.sessions.length === 1,
    );
    const cloneTmuxClose = execHost(["close", f.clone], stubs, root, { POSTMASTER_HOST: "tmux" });
    await pass(
      "and close kills it",
      () =>
        cloneTmuxClose.code === 0 && calls(root, "tmux").filter((line) => line.startsWith("kill-window")).length === 3,
    );

    writeOut("interactive sessions");
    const noSpawn = execHost(["spawn", "postmaster-repo", f.repo, "--", "claude"]);
    const noSend = execHost(["send", "postmaster-repo", join(f.caller, "fixed.sh")]);
    const noRead = execHost(["read", "postmaster-repo"]);
    await pass(
      "with no host, spawn, send and read say so, exit 3",
      () => noSpawn.code === 3 && noSend.code === 3 && noRead.code === 3,
    );
    resetHarness(root);
    const spawnHerdr = execHost(
      [
        "spawn",
        "postmaster-repo",
        join(f.repo, ".worktrees/T-1-luna"),
        "--label",
        "repo · postmaster",
        "--",
        "claude",
        "--model",
        "m",
      ],
      stubs,
      root,
      { POSTMASTER_CONFIG: "/elsewhere/config.toml" },
    );
    const herdrCalls = calls(root, "herdr");
    await pass(
      "Herdr: spawn starts the agent in a tab of the repository's own space",
      () =>
        spawnHerdr.code === 0 &&
        herdrCalls.some((line) =>
          line.includes(`tab\tcreate\t--workspace\tw1\t--cwd\t${f.repo}/.worktrees/T-1-luna`),
        ) &&
        herdrCalls.some(
          (line) =>
            line.startsWith("agent\tstart\tpostmaster-repo\t--kind\tclaude\t--pane\tp") &&
            line.endsWith("\t--\t--model\tm"),
        ),
      herdrCalls.join("\n"),
    );
    await pass("with the caller's POSTMASTER_ settings in its pane", () =>
      herdrCalls.some((line) => line.includes("--env\tPOSTMASTER_CONFIG=/elsewhere/config.toml")),
    );
    const duplicate = execHost(["spawn", "postmaster-repo", f.repo, "--", "claude"], stubs, root);
    await pass(
      "a handle a live agent already has is refused",
      () =>
        duplicate.code === 1 &&
        calls(root, "herdr").filter((line) => line.startsWith("agent\tstart\tpostmaster-repo")).length === 1,
    );
    writeFileSync(join(stub, "agent.notready"), "");
    const notReady = execHost(["spawn", "postmaster-other", f.repo, "--", "claude"], stubs, root);
    rmSync(join(stub, "agent.notready"), { force: true });
    await pass(
      "a harness asking something on first start: spawn says so, and does not fail",
      () => notReady.code === 0 && notReady.stderr.includes("asking something"),
    );
    const normalized = execHost(["spawn", "My.Project postmaster", f.repo, "--", "claude"], stubs, root);
    await pass(
      "a handle becomes a Herdr agent name: lowercase, no dots or spaces",
      () =>
        normalized.code === 0 &&
        calls(root, "herdr").some((line) => line.startsWith("agent\tstart\tmy-project-postmaster\t")),
    );
    const long1 = callText(["_handle", "postmaster-acme-platform-service-billing"], noHost, root);
    const long2 = callText(["_handle", "postmaster-acme-platform-service-payments"], noHost, root);
    await pass(
      "two long names that share a start get two handles, each always the same, none over 32",
      () =>
        long1 !== long2 &&
        long1 === callText(["_handle", "postmaster-acme-platform-service-billing"], noHost, root) &&
        long1.length <= 32 &&
        long2.length <= 32,
    );
    const message = join(root, "message.txt");
    writeFileSync(message, "Read the brief.");
    const sent = execHost(["send", "postmaster-repo", message], stubs, root);
    await pass(
      "Herdr: send submits the file's text as the agent's prompt",
      () =>
        sent.code === 0 &&
        calls(root, "herdr").some((line) => line === "agent\tprompt\tpostmaster-repo\tRead the brief."),
    );
    const sentWait = execHost(["send", "postmaster-repo", message, "--wait", "30"], stubs, root);
    await pass(
      "Herdr: send --wait sends and waits in one call, never a prompt then a wait",
      () =>
        sentWait.code === 0 &&
        calls(root, "herdr").some(
          (line) => line === "agent\tprompt\tpostmaster-repo\tRead the brief.\t--wait\t--timeout\t30000",
        ) &&
        !calls(root, "herdr").some((line) => line.startsWith("agent\twait")),
    );
    writeFileSync(join(stub, "agent.blocked"), "");
    const blockedSend = execHost(["send", "postmaster-repo", message, "--wait", "30"], stubs, root);
    const blockedWait = execHost(["wait", "postmaster-repo", "5"], stubs, root);
    rmSync(join(stub, "agent.blocked"), { force: true });
    await pass(
      "a turn that stops at an approval or a question is not settled: exit 3",
      () => blockedSend.code === 3 && blockedWait.code === 3,
    );
    const waited = execHost(["wait", "postmaster-repo", "5"], stubs, root);
    const read = execHost(["read", "postmaster-repo", "7"], stubs, root);
    await pass(
      "Herdr: wait and read go to the agent by its handle",
      () =>
        waited.code === 0 &&
        calls(root, "herdr").includes("agent\twait\tpostmaster-repo\t--timeout\t5000") &&
        read.code === 0 &&
        calls(root, "herdr").includes("agent\tread\tpostmaster-repo\t--source\trecent-unwrapped\t--lines\t7"),
    );
    resetHarness(root);
    const tmuxSpawn = execHost(["spawn", "postmaster-repo", f.repo, "--", "claude"], stubs, root, {
      POSTMASTER_HOST: "tmux",
      POSTMASTER_CONFIG: "/elsewhere/config.toml",
    });
    await pass(
      "tmux: spawn passes the caller's POSTMASTER_ settings to the window",
      () =>
        tmuxSpawn.code === 0 &&
        readFileSync(join(stub, "win-1.env"), "utf8").includes("POSTMASTER_CONFIG=/elsewhere/config.toml"),
    );
    const tmuxSend = execHost(["send", "postmaster-repo", message], stubs, root, { POSTMASTER_HOST: "tmux" });
    const tmuxCalls = calls(root, "tmux").map(
      (line) => line.split("\t")[0] + (line.startsWith("paste-buffer\t-p") ? "(-p)" : ""),
    );
    await pass(
      "tmux: send pastes bracketed, then presses Enter as its own key",
      () => tmuxSend.code === 0 && tmuxCalls.slice(-3).join(" ") === "load-buffer paste-buffer(-p) send-keys",
    );
    const tmuxWait = execHost(["wait", "postmaster-repo", "20"], stubs, root, {
      POSTMASTER_HOST: "tmux",
      POSTMASTER_HOST_QUIET: "2",
    });
    const tmuxRead = execHost(["read", "postmaster-repo", "7"], stubs, root, { POSTMASTER_HOST: "tmux" });
    await pass(
      "tmux: wait settles on a quiet screen, and read takes the lines asked for",
      () =>
        tmuxWait.code === 0 &&
        calls(root, "tmux").some((line) => line === "capture-pane\t-p\t-J\t-S\t-7\t-t\t@1") &&
        tmuxRead.code === 0,
    );
  } catch (error) {
    failures++;
    writeError(`host self-test setup failed: ${String((error as Error).message ?? error)}`);
  } finally {
    for (const directory of [join(root, "logs"), join(root, "tree"), join(root, "stub")]) {
      for (const name of readdir(directory)) {
        if (!name.endsWith(".pid")) continue;
        try {
          const pid = Number(readFileSync(join(directory, name), "utf8").trim());
          if (!pid) continue;
          try {
            process.kill(-pid, "SIGKILL");
          } catch {
            try {
              process.kill(pid, "SIGKILL");
            } catch {}
          }
        } catch {}
      }
    }
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {}
  }
  if (failures) {
    writeOut("");
    writeOut(`self-test: ${failures} control(s) misbehaved`);
    process.exit(1);
  }
  writeOut("");
  writeOut("self-test: all controls behaved");
}

export async function run(): Promise<void> {
  await runControls();
}

function available(program: string): boolean {
  return (process.env.PATH ?? "").split(":").some((path) => {
    try {
      accessSync(join(path || ".", program), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

function parseJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function at(value: any, path: string[]): any {
  return path.reduce((current, key) => current?.[key], value);
}

function liveHerdr(...args: string[]): Result {
  return exec("herdr", args, { timeout: 5000 });
}

function liveHost(args: string[], cwd: string, root: string, env: Record<string, string> = {}): Result {
  return exec("bun", [SELF, ...args], {
    cwd,
    env: {
      ...process.env,
      POSTMASTER_HOST_STATE: join(root, "state"),
      POSTMASTER_HOST_FIXTURE: root,
      ...env,
    },
  });
}

function value(text: string, path: string[]): string {
  const result = at(parseJson(text), path);
  return result === undefined || result === null ? "" : String(result);
}

function worktreeSpace(text: string, path: string): string {
  const worktrees = at(parseJson(text), ["result", "worktrees"]);
  if (!Array.isArray(worktrees)) return "";
  const worktree = worktrees.find((entry: any) => entry.path === path);
  return worktree?.open_workspace_id ?? "";
}

export async function live(): Promise<void> {
  const root = mkdtempSync(join(HERE, ".host-live-test-"));
  mkdirSync(join(root, "state"), { recursive: true });
  const opened: string[] = [];
  let tmuxSession = "";
  let failures = 0;
  const pass = async (label: string, test: () => boolean | Promise<boolean>, detail = "") => {
    if (!(await check(label, test, detail))) failures++;
  };
  const openspace = (path: string): string => {
    const result = liveHerdr("worktree", "list", "--cwd", path);
    return worktreeSpace(result.stdout, path);
  };
  try {
    const f = await setup(root);
    const direct = exec(join(f.caller, "fixed.sh"), [], { cwd: f.caller });
    writeFileSync(join(f.logs, "direct.out"), direct.stdout);
    writeFileSync(join(f.logs, "direct.err"), direct.stderr);
    const detected = liveHost(["detect"], f.caller, root);
    writeOut(`detected here: ${detected.stdout.trim()}`);

    const herdrReady = available("herdr") && liveHerdr("workspace", "list").code === 0;
    if (herdrReady) {
      writeOut("Herdr, the positive control");
      const repoSpace = liveHerdr("workspace", "create", "--cwd", f.repo, "--label", basename(f.repo), "--no-focus");
      const rs = value(repoSpace.stdout, ["result", "workspace", "workspace_id"]);
      if (rs) opened.push(rs);
      const wt = join(f.repo, ".worktrees", "T-1-luna");
      const got = liveHost(
        [
          "run",
          f.name,
          wt,
          "--out",
          "../logs/l1.out",
          "--err",
          "../logs/l1.err",
          "--marker",
          "../logs/l1.done",
          "--",
          "./fixed.sh",
        ],
        f.caller,
        root,
        { EMIT_SLEEP: "8" },
      );
      const launch = got.stdout.trim();
      const space = /(?:^|\s)space=([^\s]+)/.exec(launch)?.[1] ?? "";
      const pane = /(?:^|\s)pane=([^\s]+)/.exec(launch)?.[1] ?? "";
      const tab = /(?:^|\s)tab=([^\s]+)/.exec(launch)?.[1] ?? "";
      if (space) opened.push(space);
      await pass("the launch runs in Herdr", () => got.code === 0 && launch.startsWith("host=herdr"), launch);
      await pass("in a pane of its own worktree's space", () => Boolean(space) && openspace(wt) === space);

      const infoResult = liveHerdr("workspace", "get", space);
      const info = parseJson(infoResult.stdout);
      const source = liveHerdr("worktree", "list", "--cwd", wt);
      await pass(
        "that space is a linked worktree of the repository, whose own space is its parent",
        () =>
          at(info, ["result", "workspace", "worktree", "is_linked_worktree"]) === true &&
          at(info, ["result", "workspace", "worktree", "repo_root"]) === f.repo &&
          value(source.stdout, ["result", "source", "source_workspace_id"]) === rs,
        `${infoResult.stdout}\n${source.stdout}`,
      );
      const tabResult = liveHerdr("tab", "get", tab);
      await pass(
        "the space and the tab carry the launch's name, shell syntax and all, as written",
        () =>
          at(info, ["result", "workspace", "label"]) === f.name &&
          value(tabResult.stdout, ["result", "tab", "label"]) === f.name &&
          !existsSync(join(root, "canary")),
        `${infoResult.stdout}\n${tabResult.stdout}`,
      );

      let seen = "";
      for (let i = 0; i < 30; i++) {
        const paneInfo = parseJson(liveHerdr("pane", "get", pane).stdout);
        seen = `${at(paneInfo, ["result", "pane", "agent_status"]) ?? ""}|${at(paneInfo, ["result", "pane", "terminal_title_stripped"]) ?? ""}`;
        if (seen === `working|${f.name}`) break;
        await sleep(250);
      }
      await pass(
        "while it runs, the pane is working and its terminal title is the name",
        () => seen === `working|${f.name}`,
        seen,
      );
      await pass("its marker lands", () => marker(join(f.logs, "l1.done"), 60));
      await pass(
        "its stream and errors are what a direct run writes",
        () =>
          existsSync(join(f.logs, "l1.out")) &&
          existsSync(join(f.logs, "l1.err")) &&
          readFileSync(join(f.logs, "direct.out")).equals(readFileSync(join(f.logs, "l1.out"))) &&
          readFileSync(join(f.logs, "direct.err")).equals(readFileSync(join(f.logs, "l1.err"))),
      );
      await sleep(1000);
      const screen = liveHerdr("pane", "read", pane, "--source", "recent-unwrapped", "--lines", "40").stdout;
      await pass(
        "the pane shows one line per event, not raw JSON",
        () => screen.includes("says: step one") && screen.includes("result: success") && !screen.includes('{"type"'),
        screen,
      );
      await pass(
        "and the launch is released when it ends",
        () => value(liveHerdr("pane", "get", pane).stdout, ["result", "pane", "agent_status"]) !== "working",
      );

      const noTty = liveHost(
        ["run", f.name, wt, "--out", "../logs/l6.out", "--marker", "../logs/l6.done", "--", "./probe.sh"],
        f.caller,
        root,
      );
      await marker(join(f.logs, "l6.done"), 30);
      const probe = readFileSync(join(f.logs, "l6.out"), "utf8");
      await pass(
        "the launch has no terminal, and a group of its own",
        () => field(probe, "tty") === "no" && field(probe, "pgid") === field(probe, "pid"),
        `${noTty.stdout}\n${probe}`,
      );

      const stopped = liveHost(
        ["run", f.name, wt, "--marker", "../logs/l5.done", "--pidfile", "../logs/l5.pid", "--", "sleep", "120"],
        f.caller,
        root,
      );
      await sleep(2000);
      const stoppedTab = /(?:^|\s)tab=([^\s]+)/.exec(stopped.stdout)?.[1] ?? "";
      liveHerdr("tab", "close", stoppedTab);
      const childPid = Number(readFileSync(join(f.logs, "l5.pid"), "utf8").trim());
      await pass(
        "closing a launch's pane mid-run stops it, and its marker still lands",
        async () => (await marker(join(f.logs, "l5.done"), 10)) && !processExists(childPid),
        stopped.stdout,
      );

      const rev = join(f.repo, ".worktrees", "T-1-rev-luna");
      const reviewer = liveHost(
        ["run", `${f.name} review`, rev, "--marker", "../logs/l2.done", "--", "./fixed.sh"],
        f.caller,
        root,
      );
      const reviewSpace = /(?:^|\s)space=([^\s]+)/.exec(reviewer.stdout)?.[1] ?? "";
      if (reviewSpace) opened.push(reviewSpace);
      await pass(
        "a detached reviewer scratch opens as a space too",
        async () =>
          Boolean(reviewSpace) && openspace(rev) === reviewSpace && (await marker(join(f.logs, "l2.done"), 60)),
        reviewer.stdout,
      );
      const clone = liveHost(
        ["run", `${f.name} security review`, f.clone, "--marker", "../logs/l7.done", "--", "./fixed.sh"],
        f.caller,
        root,
      );
      const cloneSpace = /(?:^|\s)space=([^\s]+)/.exec(clone.stdout)?.[1] ?? "";
      if (cloneSpace) opened.push(cloneSpace);
      await pass(
        "a reviewer's scratch clone opens as a space of its own",
        async () =>
          Boolean(cloneSpace) &&
          openspace(f.clone) === cloneSpace &&
          value(liveHerdr("workspace", "get", cloneSpace).stdout, ["result", "workspace", "label"]) ===
            `${f.name} security review` &&
          (await marker(join(f.logs, "l7.done"), 60)),
        clone.stdout,
      );
      const closeClone = liveHost(["close", f.clone], f.caller, root);
      await pass("and close shuts it", () => closeClone.code === 0 && !openspace(f.clone));
      const closeRepo = liveHost(["close", f.repo], f.caller, root);
      await pass("close refuses the repository's own space", () => closeRepo.code === 2, closeRepo.stderr);
      const closeWt = liveHost(["close", wt], f.caller, root);
      await pass(
        "close shuts the worktree's space, and only that",
        () => closeWt.code === 0 && !openspace(wt) && openspace(rev) === reviewSpace,
      );
      const closeReview = liveHost(["close", rev], f.caller, root);
      await pass("and the reviewer's", () => closeReview.code === 0 && !openspace(rev));

      writeOut("no host, the negative control");
      const plain = join(f.repo, ".worktrees", "T-1-sol");
      const countBefore = Array.isArray(at(parseJson(liveHerdr("workspace", "list").stdout), ["result", "workspaces"]))
        ? at(parseJson(liveHerdr("workspace", "list").stdout), ["result", "workspaces"]).length
        : -1;
      const background = liveHost(
        [
          "run",
          f.name,
          plain,
          "--out",
          "../logs/l3.out",
          "--err",
          "../logs/l3.err",
          "--marker",
          "../logs/l3.done",
          "--",
          "./fixed.sh",
        ],
        f.caller,
        root,
        { POSTMASTER_HOST: "none" },
      );
      await pass(
        "the same launch runs in the background",
        () => background.code === 0 && background.stdout.trim() === "host=none",
        background.stdout,
      );
      const noHostSpaces = liveHerdr("workspace", "list");
      const countAfter = Array.isArray(at(parseJson(noHostSpaces.stdout), ["result", "workspaces"]))
        ? at(parseJson(noHostSpaces.stdout), ["result", "workspaces"]).length
        : -1;
      await pass("no space opens for it", () => !openspace(plain) && countAfter === countBefore, noHostSpaces.stdout);
      await pass("its marker lands", () => marker(join(f.logs, "l3.done"), 60));
      await pass(
        "its stream and errors are the same",
        () =>
          existsSync(join(f.logs, "l3.out")) &&
          existsSync(join(f.logs, "l3.err")) &&
          readFileSync(join(f.logs, "direct.out")).equals(readFileSync(join(f.logs, "l3.out"))) &&
          readFileSync(join(f.logs, "direct.err")).equals(readFileSync(join(f.logs, "l3.err"))),
      );
    } else {
      writeOut("Herdr: no server answers here; its controls are skipped");
    }

    if (available("tmux")) {
      writeOut("tmux");
      const wt = join(f.repo, ".worktrees", "T-1-sol");
      const got = liveHost(
        [
          "run",
          f.name,
          wt,
          "--out",
          "../logs/l4.out",
          "--err",
          "../logs/l4.err",
          "--marker",
          "../logs/l4.done",
          "--",
          "./fixed.sh",
        ],
        f.caller,
        root,
        { POSTMASTER_HOST: "tmux" },
      );
      const launch = got.stdout.trim();
      tmuxSession = /(?:^|\s)session=([^\s]+)/.exec(launch)?.[1] ?? "";
      await pass(
        "the launch runs in a window of session postmaster-<repo>, named for it",
        () =>
          got.code === 0 &&
          tmuxSession === `postmaster-${basename(f.repo)}` &&
          exec("tmux", ["list-windows", "-t", `=${tmuxSession}`, "-F", "#{window_name}"]).stdout.trim() === f.name,
        launch,
      );
      await pass("its marker lands", () => marker(join(f.logs, "l4.done"), 60));
      await pass(
        "its stream and errors are the same",
        () =>
          existsSync(join(f.logs, "l4.out")) &&
          existsSync(join(f.logs, "l4.err")) &&
          readFileSync(join(f.logs, "direct.out")).equals(readFileSync(join(f.logs, "l4.out"))) &&
          readFileSync(join(f.logs, "direct.err")).equals(readFileSync(join(f.logs, "l4.err"))),
      );
      const closeTmux = liveHost(["close", wt], f.caller, root, { POSTMASTER_HOST: "tmux" });
      const windows = exec("tmux", ["list-windows", "-t", `=${tmuxSession}`, "-F", "#{window_name}"]);
      await pass(
        "close kills the worktree's window",
        () => closeTmux.code === 0 && !windows.stdout.split("\n").includes(f.name),
      );
    } else {
      writeOut("tmux: not on PATH; its controls are skipped");
    }
  } catch (error) {
    failures++;
    writeError(`host live-test setup failed: ${String((error as Error).message ?? error)}`);
  } finally {
    for (const workspace of opened.reverse()) liveHerdr("workspace", "close", workspace);
    if (tmuxSession) exec("tmux", ["kill-session", "-t", `=${tmuxSession}`]);
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {}
  }
  if (failures) {
    writeOut("");
    writeOut(`live test: ${failures} control(s) misbehaved`);
    process.exit(1);
  }
  writeOut("");
  writeOut("live test: all controls behaved");
}

function processExists(pid: number): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as { code?: string }).code !== "ESRCH";
  }
}

if (resolve(process.argv[1] ?? "") === resolve(SCRIPT)) {
  const args = process.argv.slice(2);
  if (args[0] === "--stub" && args[1] === "herdr") void herdrStub(args.slice(2));
  else if (args[0] === "--stub" && args[1] === "tmux") tmuxStub(args.slice(2));
  else
    runControls().catch((error: unknown) => {
      writeError(`host self-test failed: ${String((error as Error).message ?? error)}`);
      process.exit(1);
    });
}
