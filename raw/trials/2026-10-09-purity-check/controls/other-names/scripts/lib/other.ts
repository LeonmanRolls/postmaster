// Control: names that read ambient state or act, and that the check does not flag. The check
// reads this file and flags nothing. A text search for each name finds it once; this comment
// holds none of them.
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const ambient = [
  process.cwd(),
  process.argv,
  process.platform,
  process.pid,
  Math.random(),
  randomBytes(4),
  Bun.which("git"),
  globalThis,
  import.meta.path,
  join,
  fileURLToPath,
];

export const effects = [
  process.kill(0, 0),
  process.exit,
  process.stdout,
  Bun.sleep(1),
  Atomics.wait,
  setTimeout,
  console.log,
];
