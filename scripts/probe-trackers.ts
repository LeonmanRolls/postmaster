// Which ticket sources this machine can reach, detected without assuming any particular
// agent harness. The user chooses; this reports what is genuinely available so the
// choice is informed rather than aspirational.
//
//   exit 0 always; the table is the result
import { existsSync } from "node:fs";
import { tryTomlFile } from "./lib/data.ts";
import { globalConfigPath } from "./lib/effective-config.ts";
import { beside } from "./lib/paths.ts";
import { run } from "./lib/proc.ts";

const CONFIG = globalConfigPath();

const row = (a: string, b: string, c: string): void => {
  console.log(`  ${a.padEnd(12)} ${b.padEnd(12)} ${c}`);
};
row("TRACKER", "AVAILABLE", "HOW IT IS REACHED");
row("-------", "---------", "------------------");

// GitHub Issues on a Projects board: gh logged in, and the token carrying the project scope,
// which `gh auth login` does not grant by default.
if (Bun.which("gh") === null) {
  row("github", "no", "gh not installed");
} else {
  const authed = run("gh", ["auth", "status"]);
  if (authed.code !== 0) {
    row("github", "partial", "gh installed but not logged in; the user runs: gh auth login");
  } else {
    const joined = authed.out + authed.err;
    if (!/Token scopes:.*'project'/u.test(joined)) {
      row(
        "github",
        "partial",
        "gh logged in without the project scope; the user runs: gh auth refresh -s project",
      );
    } else {
      row("github", "yes", "gh CLI, logged in, project scope (the default)");
    }
  }
}

// Plane: an instance and workspace in the config and a key in the env file. The only proof
// is a listing, so the probe asks for one when all three are present.
const home = process.env.HOME ?? "";
let envFile = "~/.postmaster/plane.env";
let planeUrl = "";
let planeWs = "";
const parsed = existsSync(CONFIG) ? tryTomlFile(CONFIG) : null;
if (parsed !== null) {
  const t = parsed.tracker;
  const table =
    t !== null && typeof t === "object" && !Array.isArray(t) ? (t as Record<string, unknown>) : {};
  const ef = table.env_file;
  if (typeof ef === "string" && ef !== "") envFile = ef;
  const url = table.url;
  if (typeof url === "string") planeUrl = url;
  const ws = table.workspace;
  if (typeof ws === "string") planeWs = ws;
}
if (envFile.startsWith("~")) envFile = home + envFile.slice(1);

if (planeUrl === "" || planeWs === "") {
  row(
    "plane",
    "setup",
    "needs [tracker] url and workspace in the config and PLANE_API_KEY in ~/.postmaster/plane.env",
  );
} else if (!(process.env.PLANE_API_KEY ?? "") && !existsSync(envFile)) {
  row("plane", "partial", `url and workspace set; no key at ${envFile}`);
} else {
  const listed = run(beside(import.meta, "run"), ["plane", "projects"], {
    env: { POSTMASTER_CONFIG: CONFIG },
  });
  const out = (listed.out + listed.err).replace(/\n+$/u, "");
  if (listed.code === 0) {
    const projects = out.split("\n").filter((l) => l !== "").length;
    row("plane", "yes", `${planeUrl}, workspace ${planeWs}, ${projects} projects`);
  } else {
    row("plane", "no", out.split("\n")[0] ?? "");
  }
}

// Local: tickets in each repository's own git directory, through scripts/run local. There is
// nothing to reach and no login; it needs only git (the scripts themselves run on Bun).
if (Bun.which("git") !== null) {
  row(
    "local",
    "yes",
    "no service, no login; a repo's store is made with: scripts/run local <repo> store init",
  );
} else {
  row("local", "no", "needs git");
}

// Hosted and self-hosted trackers are reached through whatever tooling the user's agent
// provides (an MCP server, a CLI). That is a property of their agent setup, not of this
// machine, and this script deliberately does not read any one harness's config to guess at it.
row(
  "other",
  "ask",
  "any tracker reached through your agent's own tooling; needs the service reachable",
);
console.log("");
console.log("  GitHub Issues is the default: the tickets sit on a GitHub Projects board the user");
console.log('  can open. "partial" names the one command the user runs to finish it. "ask"');
console.log("  means this script cannot tell, so the user must say: an MCP being registered is");
console.log("  not the same as the service being up. A repo whose local store exists uses local,");
console.log("  whatever the config names.");
process.exit(0);
