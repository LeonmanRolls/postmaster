import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { command, writeError, writeOut } from "./lib/core.ts";

const home = homedir();
const config = process.env.POSTMASTER_CONFIG ?? join(home, ".postmaster", "config.toml");
let roots = process.argv.slice(2);
if (roots.length === 0 && (await Bun.file(config).exists())) {
  try {
    const parsed = Bun.TOML.parse(await Bun.file(config).text()) as { projects_roots?: string[] };
    roots = parsed.projects_roots ?? [];
  } catch {
    roots = [];
  }
}
if (roots.length === 0) roots = [join(home, "Code")];
roots = roots.map((root) => (root.startsWith("~/") ? join(home, root.slice(2)) : root));
const limit = Number.parseInt(process.env.LIMIT ?? "12", 10);
const depth = Number.parseInt(process.env.DEPTH ?? "3", 10);
const exclude = process.env.EXCLUDE ?? "external";
const rows: { timestamp: number; path: string; relative: string; remote: string }[] = [];

function scan(directory: string, remaining: number): void {
  if (remaining < 0) return;
  let entries: any[];
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const current = join(directory, entry.name);
    if (entry.name === ".git" && entry.isDirectory()) {
      const repo = directory;
      const relPath = repo.replace(new RegExp(`^${escapeRegex(home)}`), "~");
      if (repo.split("/").includes(exclude)) continue;
      const log = command("git", ["-C", repo, "log", "-1", "--format=%ct"]);
      if (log.code !== 0 || !log.stdout.trim()) continue;
      const rel = command("git", ["-C", repo, "log", "-1", "--format=%cr"]).stdout.trim();
      const remote = command("git", ["-C", repo, "remote", "get-url", "origin"]).code === 0 ? "remote" : "local-only";
      rows.push({ timestamp: Number(log.stdout.trim()), path: relPath, relative: rel, remote });
      continue;
    }
    if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== ".worktrees")
      scan(current, remaining - 1);
  }
}
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
for (const root of roots) {
  try {
    if (statSync(root).isDirectory()) scan(resolve(root), depth);
  } catch {
    /* Missing roots are reported below. */
  }
}
rows.sort((a, b) => b.timestamp - a.timestamp);
const selected = rows.slice(0, Math.max(0, limit));
if (selected.length === 0) {
  writeError(`find-projects: no git repositories under: ${roots.join(" ")}`);
  process.exit(0);
}
for (const row of selected) writeOut(`${row.path.padEnd(44)} ${row.relative.padEnd(18)} ${row.remote}`);
