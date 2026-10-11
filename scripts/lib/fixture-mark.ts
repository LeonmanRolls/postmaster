// The fixture-copy marks run fixture new writes: postmaster.fixture in the copy's
// own git config, and .postmaster/fixture in its first commit. A clone keeps the
// committed file but loses the local config, so either mark counts.
import { statSync } from "node:fs";
import { join } from "node:path";
import { run } from "./proc.ts";

/** Whether the repository at path carries either of run fixture new's marks. */
export function isFixtureCopy(path: string): boolean {
  if (!path) return false;
  const r = run("git", ["-C", path, "config", "--local", "--get", "postmaster.fixture"]);
  if (r.code === 0 && r.out.trim().length > 0) return true;
  const top = run("git", ["-C", path, "rev-parse", "--show-toplevel"]);
  if (top.code !== 0) return false;
  try {
    return statSync(join(top.out.trim(), ".postmaster", "fixture")).isFile();
  } catch {
    return false;
  }
}
