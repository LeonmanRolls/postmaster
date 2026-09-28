import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type CommandResult = { code: number; stdout: string; stderr: string };

export function command(
  program: string,
  args: string[] = [],
  options: {
    cwd?: string;
    env?: Record<string, string | undefined>;
    input?: string;
    inherit?: boolean;
    timeout?: number;
  } = {},
): CommandResult {
  const env = { ...process.env };
  for (const [key, value] of Object.entries(options.env ?? {})) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  const result = spawnSync(program, args, {
    cwd: options.cwd,
    env,
    input: options.input,
    encoding: "utf8",
    stdio: options.inherit ? "inherit" : "pipe",
    timeout: options.timeout,
  });
  return {
    code: typeof result.status === "number" ? result.status : result.error ? 127 : 1,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
  };
}

export function commandOutput(
  program: string,
  args: string[] = [],
  options: { cwd?: string; env?: Record<string, string | undefined>; input?: string; timeout?: number } = {},
): string | null {
  const result = command(program, args, options);
  return result.code === 0 ? result.stdout.replace(/\n$/, "") : null;
}

export function writeError(message: string): void {
  process.stderr.write(`${message}\n`);
}

export function writeOut(message: string): void {
  process.stdout.write(`${message}\n`);
}

export function fail(message: string, code = 1): never {
  writeError(message);
  process.exit(code);
}

export function scriptDir(metaUrl: string): string {
  return dirname(fileURLToPath(metaUrl));
}

export function readText(path: string): string {
  return readFileSync(path, "utf8");
}

export function readJson<T = any>(path: string): T {
  return JSON.parse(readText(path)) as T;
}

export function writeJson(path: string, value: unknown, indent = 2): void {
  writeFileSync(path, `${JSON.stringify(value, null, indent)}\n`);
}

export function atomicWrite(path: string, text: string): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const temp = mkdtempSync(join(dir, ".postmaster-"));
  try {
    const file = join(temp, "value");
    writeFileSync(file, text);
    renameSync(file, path);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

export function exists(path: string): boolean {
  return existsSync(path);
}

export function makeTemp(prefix = "postmaster-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function removeTree(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

export function dieUsage(message: string): never {
  fail(message, 1);
}
