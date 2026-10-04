import { readFileSync } from "node:fs";
import { checkBunVersion, toolPackageJson } from "./lib/bun-version.ts";

const failure = checkBunVersion(Bun.version, readFileSync(toolPackageJson(), "utf8"));
if (failure !== null) {
  console.error(failure);
  process.exit(1);
}
