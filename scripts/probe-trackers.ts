import { accessSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { command, scriptDir, writeOut } from "./lib/core.ts";

const here = scriptDir(import.meta.url);
const config = process.env.POSTMASTER_CONFIG ?? join(homedir(), ".postmaster", "config.toml");
function row(name: string, available: string, how: string): void {
  writeOut(`  ${name.padEnd(12)} ${available.padEnd(12)} ${how}`);
}
function onPath(program: string): boolean {
  for (const directory of (process.env.PATH ?? "").split(":")) {
    try {
      accessSync(join(directory, program));
      return true;
    } catch {
      /* Continue. */
    }
  }
  return false;
}
row("TRACKER", "AVAILABLE", "HOW IT IS REACHED");
row("-------", "---------", "------------------");
if (!onPath("gh")) row("github", "no", "gh not installed");
else if (command("gh", ["auth", "status"]).code !== 0)
  row("github", "partial", "gh installed but not logged in; the user runs: gh auth login");
else if (
  !/Token scopes:.*'project'/.test(command("gh", ["auth", "status"]).stderr + command("gh", ["auth", "status"]).stdout)
)
  row("github", "partial", "gh logged in without the project scope; the user runs: gh auth refresh -s project");
else row("github", "yes", "gh CLI, logged in, project scope (the default)");

let plane: { env_file?: string; url?: string; workspace?: string } = {};
try {
  plane = (Bun.TOML.parse(await Bun.file(config).text()) as any).tracker ?? {};
} catch {
  /* Use the setup defaults. */
}
let envFile = plane.env_file ?? "~/.postmaster/plane.env";
envFile = envFile.startsWith("~/") ? join(homedir(), envFile.slice(2)) : envFile;
if (!plane.url || !plane.workspace)
  row("plane", "setup", "needs [tracker] url and workspace in the config and PLANE_API_KEY in ~/.postmaster/plane.env");
else if (!process.env.PLANE_API_KEY && !existsSync(envFile))
  row("plane", "partial", `url and workspace set; no key at ${envFile}`);
else {
  const result = command("bun", [join(here, "plane.ts"), "projects"], { env: { POSTMASTER_CONFIG: config } });
  if (result.code === 0)
    row(
      "plane",
      "yes",
      `${plane.url}, workspace ${plane.workspace}, ${result.stdout.split(/\r?\n/).filter(Boolean).length} projects`,
    );
  else row("plane", "no", (result.stdout + result.stderr).split(/\r?\n/)[0]);
}
if (onPath("git") && Bun.version.localeCompare("1.4.2", undefined, { numeric: true }) >= 0)
  row("local", "yes", "no service, no login; a repo's store is made with: scripts/local.sh <repo> store init");
else row("local", "no", "needs git and Bun 1.4.2 or newer");
row("other", "ask", "any tracker reached through your agent's own tooling; needs the service reachable");
writeOut("");
writeOut("  GitHub Issues is the default: the tickets sit on a GitHub Projects board the user");
writeOut('  can open. "partial" names the one command the user runs to finish it. "ask"');
writeOut("  means this script cannot tell, so the user must say: an MCP being registered is");
writeOut("  not the same as the service being up. A repo whose local store exists uses local,");
writeOut("  whatever the config names.");
