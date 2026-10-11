// List candidate target projects, most recently worked first.
//
// Recency does the filtering that rules cannot: dormant repos and scratch work fall off
// the list without needing to be named. Third-party clones are excluded because nobody
// dispatches work into a vendored copy of someone else's project.
//
// Deliberately does NOT filter on having a remote. Plenty of real work is local-only, and
// filtering on a remote silently hides it. Remote status is shown as information; project
// instructions or the user establish whether landing uses a pull request or a local merge.
import { existsSync, realpathSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { tryTomlFile } from "./lib/data.ts";
import { globalConfigPath } from "./lib/effective-config.ts";
import { run } from "./lib/proc.ts";

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** ${var:-default}: unset or empty takes the default. */
function envOr(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

/** ${value/#\~/HOME} */
function expandTilde(value: string, home: string): string {
  if (value.startsWith("~")) return home + value.slice(1);
  return value;
}

function nat(v: string | undefined, fallback: number): number {
  if (v === undefined || v === "") return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? fallback : n;
}

const LIMIT = nat(process.env.LIMIT, 12);
const DEPTH = nat(process.env.DEPTH, 3);
const EXCLUDE = envOr("EXCLUDE", "external"); // directory name segment to skip
const HOME = process.env.HOME ?? "";
const CONFIG = globalConfigPath();

let roots = process.argv.slice(2);
if (roots.length === 0 && existsSync(CONFIG)) {
  const parsed = tryTomlFile(CONFIG);
  if (parsed !== null) {
    const list = parsed.projects_roots;
    if (Array.isArray(list)) roots = list.map((r) => String(r));
  }
}
if (roots.length === 0) roots = [`${HOME}/Code`];
roots = roots.map((r) => expandTilde(r, HOME));

interface Row {
  ts: number;
  key: string;
  path: string;
  rel: string;
  remote: string;
}

const rows: Row[] = [];
for (const root of roots) {
  if (!isDirectory(root)) continue;
  const found = run("find", [
    root,
    "-maxdepth",
    String(DEPTH),
    "-name",
    ".git",
    "-type",
    "d",
    "-not",
    "-path",
    "*/node_modules/*",
    "-not",
    "-path",
    "*/.worktrees/*",
  ]);
  for (const g of found.out.split("\n")) {
    if (g === "") continue;
    const d = dirname(g);
    // [[ ]] not case: a case pattern's ")" gets matched against the enclosing $( )
    if (EXCLUDE !== "" && d.includes(`/${EXCLUDE}/`)) continue;
    const stamp = run("git", ["-C", d, "log", "-1", "--format=%ct"]);
    if (stamp.code !== 0) continue;
    const tsText = stamp.out.replace(/\n+$/u, "");
    if (tsText === "") continue;
    const ts = Number.parseInt(tsText, 10);
    if (Number.isNaN(ts)) continue;
    const rel = run("git", ["-C", d, "log", "-1", "--format=%cr"]).out.replace(/\n+$/u, "");
    const isRemote = run("git", ["-C", d, "remote", "get-url", "origin"]).code === 0;
    // ${d/#$HOME/~} is a no-op under bash 5.2's patsub_replacement (the replacement's `~`
    // expands to HOME), so the original prints absolute paths and so does this.
    // Real ones: the root may arrive through a link (macOS TMPDIR, a linked Code
    // folder), and the list names each project once, canonically.
    const path = realpathSync(d);
    const remote = isRemote ? "remote" : "local-only";
    rows.push({ ts, key: `${tsText}\t${path}\t${rel}\t${remote}`, path, rel, remote });
  }
}

// sort -rn | head -"$LIMIT": newest first, the full line as last resort when a second ties.
rows.sort((a, b) => b.ts - a.ts || (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
const top = rows.slice(0, LIMIT);
if (top.length === 0) {
  // Zero means the roots were wrong, not that the user has no projects.
  console.error(`find-projects: no git repositories under: ${roots.join(" ")}`);
  process.exit(0);
}
for (const r of top) {
  console.log(`${r.path.padEnd(44)} ${r.rel.padEnd(18)} ${r.remote}`);
}
process.exit(0);
