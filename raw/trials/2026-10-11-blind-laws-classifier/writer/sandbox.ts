// Runs a real program where only one throwaway folder can be written and the network is off,
// so a generated command cannot change anything outside that folder. Linux uses Bubblewrap,
// macOS uses sandbox-exec. Where neither can start, it returns null and the caller skips.
import { spawnSync } from "node:child_process";

export interface Ran {
  code: number;
  stdout: string;
  stderr: string;
}

const PATH = "/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin";

function wrap(argv: string[], dir: string, env: Record<string, string>): string[] | null {
  if (process.platform === "linux") {
    const sets = Object.entries(env).flatMap(([k, v]) => ["--setenv", k, v]);
    return [
      "bwrap",
      "--ro-bind",
      "/",
      "/",
      "--dev",
      "/dev",
      "--proc",
      "/proc",
      "--bind",
      dir,
      dir,
      "--unshare-net",
      "--unshare-pid",
      "--die-with-parent",
      "--clearenv",
      ...sets,
      "--chdir",
      dir,
      "--",
      ...argv,
    ];
  }
  if (process.platform === "darwin") {
    const quoted = dir.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
    const profile = [
      "(version 1)",
      "(allow default)",
      "(deny network*)",
      "(deny file-write*)",
      `(allow file-write* (subpath "${quoted}"))`,
      '(allow file-write* (literal "/dev/null"))',
    ].join(" ");
    const envArgs = Object.entries(env).map(([k, v]) => `${k}=${v}`);
    return ["sandbox-exec", "-p", profile, "/usr/bin/env", "-i", ...envArgs, ...argv];
  }
  return null;
}

let usable: boolean | null = null;

/** True when a sandbox can start on this machine. */
export function sandboxUsable(): boolean {
  if (usable !== null) return usable;
  const probe = wrap(["true"], process.cwd(), { PATH });
  usable = probe !== null && spawnSync(probe[0] ?? "", probe.slice(1)).status === 0;
  return usable;
}

/**
 * Runs argv inside dir, where dir is the only writable place. HOME is dir, the system and
 * global git configs are not read, and the network is off. Returns null when no sandbox can
 * start here.
 */
export function sandboxed(argv: string[], dir: string, env: Record<string, string> = {}): Ran | null {
  if (!sandboxUsable()) return null;
  const full = {
    PATH,
    HOME: dir,
    LANG: "C",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: `${dir}/.gitconfig`,
    ...env,
  };
  const cmd = wrap(argv, dir, full);
  if (cmd === null) return null;
  const r = spawnSync(cmd[0] ?? "", cmd.slice(1), { cwd: dir, encoding: "utf8" });
  return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}
