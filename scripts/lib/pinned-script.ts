// A supervising checkout can serve runs pinned before or after scripts/run replaced wrappers.
import { accessSync, constants, statSync } from "node:fs";
import { join } from "node:path";
import { run, type RunResult } from "./proc.ts";

function executable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export function pinnedCommand(
  checkout: string,
  name: string,
  args: string[],
): { path: string; args: string[] } | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(name)) return null;
  const scripts = join(checkout, "scripts");
  const entry = join(scripts, "run");
  if (executable(entry)) {
    try {
      if (statSync(join(scripts, `${name}.ts`)).isFile())
        return { path: entry, args: [name, ...args] };
    } catch {
      return null;
    }
    return null;
  }
  const wrapper = join(scripts, `${name}.sh`);
  return executable(wrapper) ? { path: wrapper, args } : null;
}

export function runPinned(checkout: string, name: string, args: string[]): RunResult {
  const command = pinnedCommand(checkout, name, args);
  if (!command)
    return {
      code: 126,
      out: "",
      err: `pinned tool: ${checkout} cannot run ${name}\n`,
      timedOut: false,
    };
  return run(command.path, command.args);
}
