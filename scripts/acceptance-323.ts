// Oracle helpers for #323: one session makes and proves a verifier for a project.
// The tests spawn git and scripts/run as subprocesses; nothing here imports the change.
// sharedRuns is the C5 comparison: the normalized word runs of length n both texts hold.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { beside, toolRoot } from "./lib/paths.ts";
import { run } from "./lib/proc.ts";

export const ROOT = toolRoot(import.meta);
export const RUN = beside(import.meta, "run");
export const PSTACK_DIR = join(ROOT, "scripts/fixtures/pstack-create-verification-skill");
export const PSTACK_SKILL = join(PSTACK_DIR, "SKILL.md");
export const PSTACK_SHA256 = "644f2551403c1bca01a2855b34611b6e7be0ce0dc5b204514c376c0f6a6e6ac4";

export function gitOrThrow(repo: string, ...args: string[]): string {
  const r = run("git", ["-C", repo, ...args]);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.err.trim() || r.out.trim()}`);
  return r.out;
}

export function initRepo(repo: string): void {
  const r = run("git", ["init", "-q", "-b", "main", repo]);
  if (r.code !== 0) throw new Error(`git init: ${r.err.trim() || r.out.trim()}`);
  gitOrThrow(repo, "config", "user.name", "brindlewick");
  gitOrThrow(repo, "config", "user.email", "332054101+brindlewick@users.noreply.github.com");
}

export function writeRepoFile(repo: string, rel: string, text: string): void {
  const target = join(repo, rel);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
}

export function commitAll(repo: string, message: string): void {
  gitOrThrow(repo, "add", ".");
  gitOrThrow(repo, "commit", "-q", "-m", message);
}

/** Lowercase alphanumeric words; case and punctuation carry no copying signal. */
export function words(text: string): string[] {
  // LOWER: lowered for an ASCII word match
  return text.toLowerCase().match(/[a-z0-9]+/gu) ?? [];
}

/** Every run of n words, joined by one space. */
export function runs(text: string, n: number): string[] {
  const w = words(text);
  const out: string[] = [];
  for (let i = 0; i + n <= w.length; i++) out.push(w.slice(i, i + n).join(" "));
  return out;
}

/** The runs of n words both texts hold, sorted, each once. */
export function sharedRuns(a: string, b: string, n: number): string[] {
  const inA = new Set(runs(a, n));
  const shared = new Set<string>();
  for (const r of runs(b, n)) if (inA.has(r)) shared.add(r);
  return [...shared].sort();
}

/** The first piece holding at least minWords words; throws when none does. */
export function firstSentence(text: string, minWords: number): string {
  for (const piece of text.split(/[.?!\n]+/u)) {
    if (words(piece).length >= minWords) return piece.trim();
  }
  throw new Error(`no sentence holds ${minWords} words`);
}
