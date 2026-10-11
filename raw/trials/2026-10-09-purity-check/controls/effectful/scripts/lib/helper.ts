// Control (D2), positive: a helper under a lib/ folder that reads the environment and the clock
// and uses the file-system module. The check flags it three times: the import, process.env and
// Date.now.
import { readFileSync } from "node:fs";

export function stamp(): string {
  const name = process.env.NAME ?? "none";
  const when = Date.now();
  return `${name} ${when} ${readFileSync("data.txt", "utf8").length}`;
}
