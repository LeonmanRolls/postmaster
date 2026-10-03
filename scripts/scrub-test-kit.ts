import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const ROOT = resolve(String(execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" })).trim());
export const SCRATCH = join(ROOT, ".postmaster", "verify");
const allocated: string[] = [];

export function scratchDir(): string {
  mkdirSync(SCRATCH, { recursive: true });
  const path = mkdtempSync(join(SCRATCH, "case-"));
  allocated.push(path);
  return path;
}

export function cleanupScratch(): void {
  for (const path of allocated.splice(0)) rmSync(path, { recursive: true, force: true });
}

export function gitAt(cwd: string, args: string[], env: Record<string, string> = {}): string {
  const result = spawnSync("git", args, { cwd, env: { ...process.env, ...env }, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  if (result.status !== 0) throw new Error("scratch git operation failed");
  return String(result.stdout ?? "").trim();
}

export function initRepo(): string {
  const root = scratchDir();
  gitAt(root, ["init", "-q", "-b", "main"]);
  gitAt(root, ["config", "user.name", "brindlewick"]);
  gitAt(root, ["config", "user.email", "332054101+brindlewick@users.noreply.github.com"]);
  writeFileSync(join(root, "base.txt"), "base\n");
  gitAt(root, ["add", "-A"]);
  gitAt(root, ["commit", "-q", "-m", "base"]);
  return root;
}

export function commit(root: string, message: string, env: Record<string, string> = {}): string {
  gitAt(root, ["add", "-A"]);
  gitAt(root, ["commit", "-q", "--allow-empty", "-m", message], env);
  return gitAt(root, ["rev-parse", "HEAD"]);
}

export function runScript(script: string, args: string[], cwd: string, env: Record<string, string> = {}) {
  return spawnSync(join(ROOT, "scripts", `${script}.sh`), args, { cwd, env: { ...process.env, ...env }, encoding: "utf8" });
}

export const email = (): string => ["mail", "box", "@", "north", "star", ".", "org"].join("");
export const phone = (): string => ["212", "-", "555", "-", "0198"].join("");
export const opaqueId = (): string => ["team", "-", "739", "184"].join("");
export const token = (): string => ["gh", "p_", "ab12", "cd34", "ef56", "gh78", "ij90", "kl12", "mn34"].join("");
export const privatePath = (): string => ["/", "home", "/", "bluejay", "/", "note.txt"].join("");
export const marker = (rule: string, reason = "synthetic trial input"): string => ["private-data", ":allow ", rule, " -- ", reason].join("");

export function scriptText(name: string): string {
  return String(execFileSync("git", ["show", `HEAD:scripts/${name}`], { cwd: ROOT, encoding: "utf8" }));
}
