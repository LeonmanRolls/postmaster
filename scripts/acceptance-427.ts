// Helpers for the #427 oracle: read the standing instructions and the
// clerk's docs from this checkout, and run the ticket checks the way the
// ticket's C3 runs them.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function repoRoot(): string {
  return join(import.meta.dir, "..");
}

export function readRepo(...parts: string[]): string {
  return readFileSync(join(repoRoot(), ...parts), "utf8");
}

export interface RunResult {
  code: number | null;
  out: string;
  err: string;
}

export function runTool(args: string[]): RunResult {
  const root = repoRoot();
  const r = spawnSync(join(root, "scripts", "run"), args, {
    cwd: root,
    env: { ...process.env },
    encoding: "utf8",
  });
  return { code: r.status, out: String(r.stdout), err: String(r.stderr) };
}

/** The AGENTS.md paragraph starting "The scripts run on Bun". */
export function scriptsParagraph(): string {
  const text = readRepo("AGENTS.md");
  const start = text.indexOf("The scripts run on Bun");
  if (start < 0) throw new Error("no scripts paragraph in AGENTS.md");
  const end = text.indexOf("\n\n", start);
  return text.slice(start, end < 0 ? undefined : end);
}

/** The clerk.md section starting "## Prepare the ticket". */
export function prepareSection(): string {
  const text = readRepo("skills", "clerk", "clerk.md");
  const start = text.indexOf("## Prepare the ticket");
  if (start < 0) throw new Error("no Prepare section in clerk.md");
  const end = text.indexOf("\n## ", start + 1);
  return text.slice(start, end < 0 ? undefined : end);
}

/** The markdown example fence of the ticket template. */
export function templateExample(): string {
  const text = readRepo("skills", "clerk", "ticket-template.md");
  const open = text.indexOf("```markdown\n");
  const close = text.indexOf("\n```\n", open + 1);
  if (open < 0 || close < 0) throw new Error("no markdown block in the template");
  return text.slice(open + "```markdown\n".length, close);
}

/** The template's prose after the example fence. */
export function templateGuide(): string {
  const text = readRepo("skills", "clerk", "ticket-template.md");
  const close = text.indexOf("\n```\n");
  if (close < 0) throw new Error("no markdown block in the template");
  return text.slice(close + "\n```\n".length);
}

export function writeTempTicket(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "postmaster-427-ticket-"));
  const file = join(dir, "ticket.md");
  writeFileSync(file, body);
  return file;
}
