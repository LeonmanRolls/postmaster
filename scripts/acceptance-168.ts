// Helpers for the #168 oracle beside it: scratch run roots, a stub `gh`
// whose pull-request checks answer is read from a mode file, and the
// watcher and status commands spawned as subprocesses. Nothing here
// imports the change under test.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run, type RunResult } from "./lib/proc.ts";

export const SELF = join(import.meta.dir, "run");
export const PR_URL = "https://example.invalid/pr/1";

export function scratch(label: string): string {
  return mkdtempSync(join(tmpdir(), `acceptance-168-${label}-`));
}

export function configFor(dir: string): string {
  const p = join(dir, "config.toml");
  writeFileSync(p, "[postmaster]\npoll_seconds = 1\n");
  return p;
}

export function envFor(cfg: string, extra: Record<string, string> = {}): Record<string, string> {
  return { POSTMASTER_CONFIG: cfg, POSTMASTER_HOST: "none", ...extra };
}

export function watch(
  root: string,
  cfg: string,
  timeout: string,
  extra: Record<string, string> = {},
): RunResult {
  return run(SELF, ["runs-watch", root, "--timeout", timeout], {
    env: envFor(cfg, extra),
    timeout: 60_000,
  });
}

export function statusNext(root: string, cfg: string, name: string): string {
  const r = run(SELF, ["runs-status", root], { env: envFor(cfg) });
  for (const line of r.out.split("\n")) {
    const f = line.trim().split(/[ \t]+/u);
    if (f[0] === name) return f[f.length - 1] ?? "";
  }
  return "";
}

export function mkRun(root: string, name: string, wait: unknown | string): void {
  const d = join(root, name);
  mkdirSync(join(d, "logs"), { recursive: true });
  writeFileSync(join(d, "manifest.json"), '{"stage": "shipping", "leg": 1}\n');
  writeFileSync(join(d, ".card-ready"), "");
  if (typeof wait === "string") writeFileSync(join(d, "wait.json"), wait);
  else if (wait !== null) writeFileSync(join(d, "wait.json"), `${JSON.stringify(wait)}\n`);
}

export function gitRepo(dir: string): string {
  mkdirSync(dir, { recursive: true });
  const g = (args: string[]): RunResult =>
    run("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args]);
  if (run("git", ["init", "-q", "-b", "main", dir]).code !== 0)
    throw new Error("cannot init PR repo");
  writeFileSync(join(dir, "app.txt"), "app\n");
  if (g(["add", "."]).code !== 0 || g(["commit", "-qm", "base"]).code !== 0)
    throw new Error("cannot commit PR repo");
  const head = run("git", ["-C", dir, "rev-parse", "HEAD"]);
  if (head.code !== 0) throw new Error("cannot read PR head");
  return head.out.trim();
}

export function ghStub(dir: string, head: string): { bin: string; mode: string } {
  const bin = join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "head"), `${head}\n`);
  const mode = join(bin, "mode");
  writeFileSync(mode, "pending\n");
  const script = [
    "#!/bin/sh",
    'dir=$(dirname "$0")',
    'mode=$(cat "$dir/mode")',
    'if [ "$1" = "pr" ] && [ "$2" = "view" ]; then',
    '  printf \'{"headRefOid":"%s"}\\n\' "$(cat "$dir/head")"',
    "  exit 0",
    "fi",
    'if [ "$1" = "pr" ] && [ "$2" = "checks" ]; then',
    '  case "$mode" in',
    '    pending) printf \'[{"name":"gate","state":"PENDING","bucket":"pending","link":"https://example.invalid/check"}]\\n\'; exit 8 ;;',
    '    pass) printf \'[{"name":"gate","state":"SUCCESS","bucket":"pass","link":"https://example.invalid/check"}]\\n\'; exit 0 ;;',
    '    fail) printf \'[{"name":"gate","state":"FAILURE","bucket":"fail","link":"https://example.invalid/check"}]\\n\'; exit 1 ;;',
    "    none) printf 'no checks reported on the main branch\\n' >&2; exit 1 ;;",
    "    *) printf 'gh: unknown error\\n' >&2; exit 1 ;;",
    "  esac",
    "fi",
    "exit 1",
    "",
  ].join("\n");
  writeFileSync(join(bin, "gh"), script);
  chmodSync(join(bin, "gh"), 0o755);
  return { bin, mode };
}

export function setMode(modeFile: string, mode: string): void {
  writeFileSync(modeFile, `${mode}\n`);
}

export function waitForFile(path: string, seconds: number): boolean {
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) {
    if (existsSync(path)) return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
  return existsSync(path);
}
