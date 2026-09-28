// Process and filesystem edges: temp directories the scripts clean up, and a
// spawn wrapper that returns exit code and output the way the bash versions read it.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface RunResult {
  code: number;
  out: string;
  err: string;
}

/** Run a command; never throws on a non-zero exit. */
export function run(
  cmd: string,
  args: string[],
  options: { cwd?: string; env?: Record<string, string | undefined>; input?: string } = {},
): RunResult {
  let env: Record<string, string | undefined> = process.env;
  if (options.env !== undefined) {
    env = { ...process.env };
    for (const [k, v] of Object.entries(options.env)) {
      if (v === undefined) delete env[k];
      else env[k] = v;
    }
  }
  const r = spawnSync(cmd, args, {
    cwd: options.cwd,
    env,
    encoding: "utf8",
    input: options.input,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    code: r.status ?? (r.signal ? 128 : 1),
    out: String(r.stdout ?? ""),
    err: String(r.stderr ?? ""),
  };
}

/** mkdir -d a temp dir and hand it to fn; remove it afterwards even if fn throws. */
export function withTempDir<T>(fn: (dir: string) => T, prefix = "postmaster-"): T {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const cleanup = (): void => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // cleanup is best-effort; a leftover temp dir is not a control failure
    }
  };
  try {
    const r = fn(dir);
    if (r instanceof Promise) {
      return r.finally(cleanup) as T;
    }
    cleanup();
    return r;
  } catch (e) {
    cleanup();
    throw e;
  }
}

/** Print to stderr and exit with the code, matching the bash `echo ... >&2; exit n` pattern. */
export function die(message: string, code = 1): never {
  process.stderr.write(`${message}\n`);
  process.exit(code);
  throw new Error("unreachable");
}

/** Print to stdout and exit 0. */
export function say(message: string): never {
  process.stdout.write(`${message}\n`);
  process.exit(0);
  throw new Error("unreachable");
}
