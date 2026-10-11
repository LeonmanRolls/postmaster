// Fixtures and probes for the #332 blind acceptance tests: a scratch config
// with a stub harness, the interactive form it prints, and the pty, tmux and
// plain-shell probes that run the form the way the flow hands it over.
import { expect } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { splitCommand } from "./clerk.ts";

const SELF = join(import.meta.dir, "run");

// A bun stub, so no shell startup bump touches the SHLVL it reports. It runs
// from a project dir the layout owns, which holds no .env file, and measures
// itself through the shared process module, where every process probe lives.
const stubSource = (processesPath: string): string => `#!/usr/bin/env bun
import { appendFileSync } from "node:fs";
import { processInfo } from ${JSON.stringify(processesPath)};
const info = processInfo(process.pid);
const e = process.env;
const line = \`PROBE pid=\${process.pid} pgid=\${info?.group ?? "UNSET"} tpgid=\${info?.terminal ?? "UNSET"} shlvl=\${e.SHLVL ?? "UNSET"} foo=\${e.FOO ?? "UNSET"} parent=\${e.ORACLE_PARENT ?? "UNSET"} launch_name=\${e.POSTMASTER_LAUNCH_NAME ?? "UNSET"} launch_role=\${e.POSTMASTER_LAUNCH_ROLE ?? "UNSET"} stream=\${e.POSTMASTER_EVENT_STREAM ?? "UNSET"} argc=\${e.ORACLE_ARGC ?? "UNSET"} arg1=\${e.ORACLE_ARG1 ?? "UNSET"}\`;
console.log(line);
if (e.ORACLE_REPORT) appendFileSync(e.ORACLE_REPORT, line + "\\n");
`;

interface Layout {
  dir: string;
  bin: string;
  repo: string;
  fooEnv: string;
  shlvlEnv: string;
  exit3Env: string;
  stream: string;
  env: Record<string, string | undefined>;
  cleanup: () => void;
}

function makeLayout(): Layout {
  const dir = mkdtempSync(join(tmpdir(), "launch-interactive-"));
  const bin = join(dir, "bin");
  const repo = join(dir, "repo");
  mkdirSync(bin, { recursive: true });
  mkdirSync(repo, { recursive: true });
  const init = spawnSync("git", ["init", "-q", repo], { encoding: "utf8" });
  if (init.status !== 0) throw new Error(`git init -q failed: ${init.stderr}`);
  writeFileSync(join(bin, "claude"), stubSource(join(import.meta.dir, "lib", "processes.ts")));
  chmodSync(join(bin, "claude"), 0o755);
  const fooEnv = join(dir, "foo.env");
  const shlvlEnv = join(dir, "shlvl.env");
  const exit3Env = join(dir, "exit3.env");
  writeFileSync(fooEnv, 'export FOO=bar\nexport ORACLE_ARGC=$#\nexport ORACLE_ARG1="$1"\n');
  writeFileSync(shlvlEnv, "export SHLVL=9\n");
  writeFileSync(exit3Env, "exit 3\n");
  const stream = join(dir, "parent.stream");
  const env: Record<string, string | undefined> = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    POSTMASTER_HARNESS_DATA: join(dir, "harness-data"),
    POSTMASTER_ATTEMPT_PHASE: join(dir, "attempt.phase"),
    ORACLE_PARENT: "oracle-yes",
    POSTMASTER_LAUNCH_NAME: "oracle-name",
    POSTMASTER_LAUNCH_ROLE: "oracle-role",
    POSTMASTER_EVENT_STREAM: stream,
  };
  return {
    dir,
    bin,
    repo,
    fooEnv,
    shlvlEnv,
    exit3Env,
    stream,
    env,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function teamConfig(lay: Layout, name: string, teamBody: string): string {
  const path = join(lay.dir, `${name}.toml`);
  writeFileSync(path, `[team]\n${teamBody}\n`);
  return path;
}

function printForm(lay: Layout, configPath: string, role: string): string {
  const r = spawnSync(
    SELF,
    ["launch", "interactive", role, "--project", lay.repo, "--name", "probe"],
    {
      encoding: "utf8",
      env: { ...lay.env, POSTMASTER_CONFIG: configPath },
    },
  );
  if (r.status !== 0) {
    throw new Error(
      `run launch interactive ${role} exited ${r.status}\n--- out ---\n${r.stdout}\n--- err ---\n${r.stderr}`,
    );
  }
  const line = String(r.stdout ?? "")
    .split("\n")
    .find((l) => l.startsWith("launch: "));
  if (!line) throw new Error(`no launch line printed:\n${r.stdout}`);
  return line.replace(/^launch: /u, "").trimEnd();
}

interface Probe {
  pid: string;
  pgid: string;
  tpgid: string;
  shlvl: string;
  foo: string;
  parent: string;
  launchName: string;
  launchRole: string;
  stream: string;
  argc: string;
  arg1: string;
}

function parseProbe(text: string): Probe {
  const m =
    // ASCII: the stub reports one machine-made ASCII line.
    /PROBE pid=(\S+) pgid=(\S+) tpgid=(\S+) shlvl=(\S+) foo=(\S+) parent=(\S+) launch_name=(\S+) launch_role=(\S+) stream=(\S+) argc=(\S+) arg1=(\S+)/u.exec(
      text,
    );
  if (!m) throw new Error(`no PROBE line in:\n${text}`);
  return {
    pid: m[1] ?? "",
    pgid: m[2] ?? "",
    tpgid: m[3] ?? "",
    shlvl: m[4] ?? "",
    foo: m[5] ?? "",
    parent: m[6] ?? "",
    launchName: m[7] ?? "",
    launchRole: m[8] ?? "",
    stream: m[9] ?? "",
    argc: m[10] ?? "",
    arg1: m[11] ?? "",
  };
}

// The harness argv of a printed interactive form: the words after the env
// file, the words the sourced file sees as $@.
function formHarnessArgv(form: string, envFile: string): string[] {
  const argv = splitCommand(`launch: ${form}`);
  const at = argv.indexOf(envFile);
  if (at < 0) throw new Error(`env file not in form:\n${form}`);
  return argv.slice(at + 1);
}

/** argv and stdin for `script` to run a shell under a pty, per platform, as
 * runPty calls it. macOS takes the form as its command: fed through stdin it
 * dies in tcgetattr on that stdin (a socket under Bun's pipes), prints
 * nothing and exits 1. The shell stays interactive, as on Linux, so job
 * control puts the harness in its own foreground group; -c supplies the
 * form, so stdin stays a pipe nothing reads. Exported so the suite pins the
 * mac shape where no mac runs. */
function ptyInvocation(
  platform: string,
  form: string,
): {
  args: string[];
  input: string | null;
} {
  if (platform === "darwin") {
    return {
      args: ["-q", "/dev/null", "bash", "--norc", "--noprofile", "-i", "-c", form],
      input: null,
    };
  }
  return {
    args: ["-qec", "bash --norc --noprofile -i", "/dev/null"],
    input: `${form}\nexit\n`,
  };
}

function runPty(lay: Layout, form: string): string {
  const { args, input } = ptyInvocation(process.platform, form);
  const r = spawnSync("script", args, {
    ...(input === null ? {} : { input }),
    timeout: 60000,
    encoding: "utf8",
    env: lay.env,
  });
  if (r.error) throw new Error(`script failed to run: ${String(r.error)}`);
  return String(r.stdout ?? "");
}

function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function haveTmux(): boolean {
  const r = spawnSync("sh", ["-c", "command -v tmux"], { encoding: "utf8" });
  return r.status === 0;
}

// The form as a tmux window's own command, the way clerk start hands it
// over: split into argv and passed to new-window. The stub reports through a
// file, since a dead pane's capture is unreliable.
function runTmux(lay: Layout, form: string): string | null {
  if (!haveTmux()) return null;
  const argv = splitCommand(`launch: ${form}`);
  const sock = join(lay.dir, "tmux.sock");
  const report = join(lay.dir, "report.txt");
  const env = { ...lay.env, ORACLE_REPORT: report };
  const tmux = (args: string[]): { code: number; out: string } => {
    const r = spawnSync("tmux", ["-S", sock, "-f", "/dev/null", ...args], {
      encoding: "utf8",
      env,
    });
    return { code: r.status ?? 1, out: String(r.stdout ?? "") };
  };
  try {
    const session = tmux(["new-session", "-d", "-s", "oracle", "-x", "200", "-y", "50"]);
    if (session.code !== 0) throw new Error("tmux new-session failed");
    const win = tmux([
      "new-window",
      "-d",
      "-P",
      "-F",
      "#{window_id}",
      "-t",
      "oracle",
      "-n",
      "probe",
      "-c",
      lay.repo,
      ...argv,
    ]);
    if (win.code !== 0 || !win.out.trim()) throw new Error("tmux new-window failed");
    const deadline = Date.now() + 30000;
    while (!existsSync(report) && Date.now() < deadline) sleepMs(250);
    if (!existsSync(report)) {
      const list = tmux(["list-windows", "-a"]);
      throw new Error(`no report from the tmux window; windows:\n${list.out}`);
    }
    return readFileSync(report, "utf8");
  } finally {
    spawnSync("tmux", ["-S", sock, "kill-server"], { encoding: "utf8", env });
  }
}

function runPlain(
  lay: Layout,
  form: string,
  extra?: Record<string, string>,
): { code: number; out: string; err: string } {
  const r = spawnSync("bash", ["-c", form], {
    timeout: 30000,
    encoding: "utf8",
    env: { ...lay.env, ...extra },
  });
  if (r.error) throw new Error(`bash failed to run: ${String(r.error)}`);
  return { code: r.status ?? 1, out: String(r.stdout ?? ""), err: String(r.stderr ?? "") };
}

function runHeadless(
  lay: Layout,
  harness: string,
): { status: number | null; signal: string | null } {
  const cfg = teamConfig(
    lay,
    "coach",
    `coachman = { harness = "${harness}", model = "m", env_file = "${lay.fooEnv}" }`,
  );
  writeFileSync(join(lay.bin, harness), "#!/bin/sh\nkill -TERM $$\n");
  chmodSync(join(lay.bin, harness), 0o755);
  const wt = join(lay.dir, "wt");
  mkdirSync(wt, { recursive: true });
  const prompt = join(lay.dir, "prompt.txt");
  writeFileSync(prompt, "hi\n");
  const r = spawnSync(SELF, ["launch", "launch", "coachman", wt, prompt, "--leg", "review"], {
    encoding: "utf8",
    env: { ...lay.env, POSTMASTER_CONFIG: cfg },
  });
  return { status: r.status, signal: r.signal };
}

function expectLead(p: Probe, text: string): void {
  if (p.pid !== p.pgid || p.pgid !== p.tpgid) {
    throw new Error(
      `harness is not the foreground leader: pid=${p.pid} pgid=${p.pgid} tpgid=${p.tpgid}\n${text}`,
    );
  }
  // A counted assertion, not just a throw: a test whose only checks throw
  // reports zero assertions and reads as vacuous.
  expect(p.pid === p.pgid && p.pgid === p.tpgid).toBe(true);
}

function expectEnv(p: Probe, lay: Layout, wantShlvl: string, wantFoo: string): void {
  expect(p.shlvl).toBe(wantShlvl);
  expect(p.foo).toBe(wantFoo);
  expect(p.parent).toBe("oracle-yes");
  expect(p.launchName).toBe("UNSET");
  expect(p.launchRole).toBe("UNSET");
  expect(p.stream).toBe(lay.stream);
}

export type { Layout, Probe };
export {
  expectEnv,
  expectLead,
  formHarnessArgv,
  haveTmux,
  makeLayout,
  parseProbe,
  printForm,
  ptyInvocation,
  runHeadless,
  runPlain,
  runPty,
  runTmux,
  teamConfig,
};
