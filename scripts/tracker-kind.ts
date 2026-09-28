import { homedir } from "node:os";
import { resolve } from "node:path";
import { command, writeError, writeOut } from "./lib/core.ts";
import { scriptDir } from "./lib/core.ts";

const [repo] = process.argv.slice(2);
if (!repo || process.argv.length !== 3) {
  writeError("usage: tracker-kind.sh <repo>");
  process.exit(1);
}
const here = scriptDir(import.meta.url);
const store = command("bun", [resolve(here, "local.ts"), repo, "store"], {
  env: {
    GIT_DIR: undefined,
    GIT_WORK_TREE: undefined,
    GIT_COMMON_DIR: undefined,
    GIT_INDEX_FILE: undefined,
    GIT_OBJECT_DIRECTORY: undefined,
    GIT_ALTERNATE_OBJECT_DIRECTORIES: undefined,
    GIT_NAMESPACE: undefined,
  },
});
if (store.code === 0) {
  writeOut("local");
  process.exit(0);
}
if (store.code !== 3) {
  const why = store.stderr.trim() || store.stdout.trim() || "no message";
  writeError(`tracker-kind: cannot look for a local store in ${repo} (local.sh exit ${store.code}): ${why}`);
  process.exit(1);
}
const config = process.env.POSTMASTER_CONFIG ?? resolve(homedir(), ".postmaster/config.toml");
try {
  const parsed = Bun.TOML.parse(await Bun.file(config).text()) as { tracker?: { kind?: string } };
  writeOut(parsed.tracker?.kind ?? "github");
} catch {
  writeError(`tracker-kind: no config at ${config} (POSTMASTER_CONFIG overrides the path)`);
  process.exit(1);
}
