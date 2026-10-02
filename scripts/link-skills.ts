// Install each skill as a link, never a copy: from the user-level skills folder of every
// installed harness that has one, to that skill in the postmaster checkout. The checkout stays
// the one source of truth, and a session finds the repo from the link (SKILL.md, first
// section). The links go to the main checkout even when this runs from a worktree, and to this
// script's own tree when that is not a git checkout at all, as with an installed package.
//
//   link-skills.sh [--dry-run]   link every skill for every installed harness with a skills folder
//   link-skills.sh --check       report missing or blocked links without changing anything
//   link-skills.sh --remove      remove the links to this checkout's skills, and nothing else
//
//   exit 0  every link is in place, would be (--dry-run), or is removed (--remove); --check is complete
//   exit 1  usage, no skills in the checkout, a bare main checkout, or something in the way; --check is incomplete

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { scriptsDir, toolRoot } from "./lib/paths.ts";
import { die, run } from "./lib/proc.ts";

const _HERE = scriptsDir(import.meta);
export const HARNESSES = ["claude", "codex", "grok", "agy", "muse", "pi", "mimo"];

export function skillsFolder(h: string): string | null {
  const home = process.env.HOME ?? "~";
  switch (h) {
    case "claude":
      return join(process.env.CLAUDE_CONFIG_DIR || join(home, ".claude"), "skills");
    case "codex":
    case "grok":
    case "mimo":
    case "muse":
    case "pi":
      return join(home, ".agents", "skills");
    default:
      return null;
  }
}

export function checkoutRoot(tree: string): string | null {
  const top = run("git", ["-C", tree, "rev-parse", "--show-toplevel"]);
  if (top.code !== 0) return tree;
  const t = resolve(top.out.trim());
  if (t !== resolve(tree)) return tree;
  const list = run("git", ["-C", tree, "worktree", "list", "--porcelain"]);
  if (list.code !== 0) {
    console.error(`link-skills: git cannot list the worktrees of ${tree}`);
    return null;
  }
  const lines = list.out.trim().split("\n");
  if (lines[1] === "bare") {
    console.error(
      `link-skills: the main checkout of ${tree} is bare; run this from a checkout with files`,
    );
    return null;
  }
  const first = lines[0]?.replace(/^worktree /u, "") ?? tree;
  return resolve(first);
}

function sameDir(a: string, b: string): boolean {
  try {
    return resolve(realpathSync(a)) === resolve(realpathSync(b));
  } catch {
    return false;
  }
}

export function isLink(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

export function harnessInstalled(h: string): boolean {
  // `command -v` is a shell builtin, so ask a shell for it, with the name as
  // a positional parameter, never pasted into the command string.
  return run("sh", ["-c", 'command -v "$1"', "_", h]).code === 0;
}
function plan(root: string): string[] | null {
  const skills = [];
  try {
    const entries = readdirSync(join(root, "skills"));
    for (const n of entries) {
      if (existsSync(join(root, "skills", n, "SKILL.md"))) {
        skills.push(join(root, "skills", n, "SKILL.md"));
      }
    }
  } catch {
    /* no skills */
  }
  if (skills.length === 0) {
    console.error(`link-skills: no skills/*/SKILL.md in ${root}`);
    return null;
  }
  const lines: string[] = [];
  let seen = "";
  for (const h of HARNESSES) {
    if (!harnessInstalled(h)) {
      lines.push(`absent\t${h}`);
      continue;
    }
    const folder = skillsFolder(h);
    if (!folder) {
      lines.push(`no-folder\t${h}\t${join(root, "skills", "postmaster", "SKILL.md")}`);
      continue;
    }
    if (isLink(folder) && !isDirectory(folder)) {
      lines.push(`in-the-way\t${folder}\ta link to ${readlinkSync(folder)}`);
      continue;
    }
    if (existsSync(folder) && !isDirectory(folder)) {
      lines.push(`in-the-way\t${folder}\ta file`);
      continue;
    }
    let key = folder;
    if (isDirectory(folder)) {
      try {
        key = resolve(realpathSync(folder));
      } catch {
        /* keep folder */
      }
    }
    if (seen.includes(`<${key}>`)) {
      lines.push(`shared\t${h}\t${folder}`);
      continue;
    }
    seen += `<${key}>`;
    for (const skill of skills) {
      const name = basename(dirname(skill));
      const path = join(folder, name);
      const target = join(root, "skills", name);
      if (isLink(path)) {
        if (readlinkSync(path) === target || sameDir(path, target)) {
          lines.push(`linked\t${path}\t${target}\t${h}`);
        } else {
          lines.push(`in-the-way\t${path}\ta link to ${readlinkSync(path)}`);
        }
      } else if (sameDir(path, target)) {
        lines.push(`linked\t${path}\t${target}\t${h}`);
      } else if (isDirectory(path)) {
        lines.push(`in-the-way\t${path}\ta folder`);
      } else if (existsSync(path)) {
        lines.push(`in-the-way\t${path}\ta file`);
      } else {
        lines.push(`link\t${path}\t${target}\t${h}`);
      }
    }
  }
  return lines;
}

export function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function report(line: string): string {
  const parts = line.split("\t");
  const verdict = parts[0] ?? "";
  const a = parts[1] ?? "";
  const b = parts[2] ?? "";
  const c = parts[3] ?? "";
  switch (verdict) {
    case "absent":
      return `not installed   ${a}`;
    case "no-folder":
      return `no skills folder ${a}: its brief names ${b} by absolute path`;
    case "shared":
      return `shared folder   ${a} reads ${b}, linked for another harness`;
    case "linked":
      return `already linked  ${a} -> ${b} (${c})`;
    case "link":
      return `to link         ${a} -> ${b} (${c})`;
    case "in-the-way":
      return `IN THE WAY      ${a} is ${b}`;
    default:
      return line;
  }
}

// printf %q for a path: safe characters bare, anything else single-quoted.
export function shellQuote(s: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/u.test(s)) return s;
  return `'${s.replace(/'/gu, `'\\''`)}'`;
}

export function checkLinks(root: string): number {
  const p = plan(root);
  if (p === null) return 1;
  let problems = false;
  let planned = false;
  for (const line of p) {
    const parts = line.split("\t");
    const verdict = parts[0] ?? "";
    const a = parts[1] ?? "";
    const b = parts[2] ?? "";
    const c = parts[3] ?? "";
    if (verdict === "link") {
      console.log(`MISSING LINK    ${a} -> ${b} (${c})`);
      problems = true;
      planned = true;
    } else if (verdict === "in-the-way") {
      console.log(`IN THE WAY      ${a} is ${b}`);
      problems = true;
      planned = true;
    } else {
      console.log(report(line));
      if (verdict === "linked" || verdict === "shared") planned = true;
    }
  }
  if (problems) {
    console.log(
      `link-skills: to install missing links after resolving any blockers, run: ${shellQuote(join(scriptsDir(import.meta), "link-skills.sh"))}`,
    );
    return 1;
  }
  if (!planned) {
    console.log("link-skills: no harness skills folders found; nothing was changed");
    return 0;
  }
  console.log("link-skills: all skills are linked; nothing was changed");
  return 0;
}

export function makeLinks(root: string, dry: number): number {
  const p = plan(root);
  if (p === null) return 1;
  for (const line of p) console.log(report(line));
  if (p.some((l) => l.startsWith("in-the-way"))) {
    console.error(
      "link-skills: nothing was changed; move what is in the way, or ask the user to, then run this again",
    );
    return 1;
  }
  if (dry === 1) return 0;
  for (const line of p) {
    const parts = line.split("\t");
    if (parts[0] !== "link") continue;
    const path = parts[1] ?? "";
    const target = parts[2] ?? "";
    const h = parts[3] ?? "";
    try {
      mkdirSync(dirname(path), { recursive: true });
      symlinkSync(target, path);
      if (readlinkSync(path) !== target) throw new Error("link mismatch");
      console.log(`linked          ${path} -> ${target} (${h})`);
    } catch {
      console.error(`link-skills: could not link ${path}`);
      return 1;
    }
  }
  return 0;
}

export function removeLinks(root: string): number {
  let seen = "";
  for (const h of HARNESSES) {
    const folder = skillsFolder(h);
    if (!folder) continue;
    if (seen.includes(`<${folder}>`)) continue;
    seen += `<${folder}>`;
    try {
      const entries = readdirSync(join(root, "skills"));
      for (const n of entries) {
        if (!existsSync(join(root, "skills", n, "SKILL.md"))) continue;
        const name = n;
        const path = join(folder, name);
        if (!isLink(path)) continue;
        const target = join(root, "skills", name);
        if (readlinkSync(path) === target || sameDir(path, target)) {
          rmSync(path, { force: true });
          console.log(`removed         ${path}`);
        } else {
          console.log(`left alone      ${path}, a link to ${readlinkSync(path)}`);
        }
      }
    } catch {
      /* no skills folder contents */
    }
  }
  return 0;
}

// --- entry -----------------------------------------------------------------------------------
const argv = process.argv.slice(2);
if (import.meta.main) {
  if (argv[0] === "--dry-run") {
    const ROOT = checkoutRoot(toolRoot(import.meta));
    if (ROOT === null) process.exit(1);
    process.exit(makeLinks(ROOT, 1));
  } else if (argv[0] === "--check") {
    const ROOT = checkoutRoot(toolRoot(import.meta));
    if (ROOT === null) process.exit(1);
    process.exit(checkLinks(ROOT));
  } else if (argv[0] === "--remove") {
    const ROOT = checkoutRoot(toolRoot(import.meta));
    if (ROOT === null) process.exit(1);
    process.exit(removeLinks(ROOT));
  } else if (argv[0] === undefined || argv[0] === "") {
    const ROOT = checkoutRoot(toolRoot(import.meta));
    if (ROOT === null) process.exit(1);
    process.exit(makeLinks(ROOT, 0));
  } else {
    die("usage: link-skills.sh [--dry-run | --check] | --remove", 1);
  }
}
