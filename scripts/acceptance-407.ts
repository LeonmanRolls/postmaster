// Oracle helpers for #407: a run can work from a ticket without its technical notes.
// The tests spawn git and scripts/run as subprocesses; nothing here imports the change.
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beside, toolRoot } from "./lib/paths.ts";
import { run } from "./lib/proc.ts";

export const ROOT = toolRoot(import.meta);
export const RUN = beside(import.meta, "run");
export const FIXTURES = join(ROOT, "scripts/fixtures/acceptance-407");
export const TICKETS = join(ROOT, "fixtures/tickets");
export const APP = join(ROOT, "fixtures/app");

export function gitOrThrow(repo: string, ...args: string[]): string {
  const r = run("git", ["-C", repo, ...args]);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.err.trim() || r.out.trim()}`);
  return r.out;
}

export function initRepo(repo: string, branch = "main"): void {
  const r = run("git", ["init", "-q", "-b", branch, repo]);
  if (r.code !== 0) throw new Error(`git init: ${r.err.trim() || r.out.trim()}`);
  gitOrThrow(repo, "config", "user.name", "brindlewick");
  gitOrThrow(repo, "config", "user.email", "332054101+brindlewick@users.noreply.github.com");
  gitOrThrow(repo, "config", "commit.gpgsign", "false");
}

export function scratchDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function removeDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

/** Stub harness executables so setup's on-PATH check passes; bash covers the rest. */
export function setupBin(tmp: string): string {
  const bin = join(tmp, "bin");
  mkdirSync(bin, { recursive: true });
  for (const h of ["claude", "codex", "grok", "agy", "muse", "mimo", "pi"]) {
    const p = join(bin, h);
    if (!existsSync(p)) {
      writeFileSync(p, "#!/bin/sh\nexit 0\n", "utf8");
      chmodSync(p, 0o755);
    }
  }
  return bin;
}

const BASE_ANSWERS = [
  "lanes=alpha, beta",
  "lane.alpha.harness=bash",
  "lane.alpha.model=m1",
  "lane.beta.harness=bash",
  "lane.beta.model=m2",
  "workhorses=alpha, beta",
  "coachman.harness=bash",
  "coachman.model=judge",
  "fallback.harness=bash",
  "fallback.model=spare",
  "postmaster.harness=bash",
  "postmaster.model=pm",
  "clerk.harness=claude",
  "clerk.model=clerk-model",
];

export function writeAnswers(tmp: string, name: string, extra?: string): string {
  const lines = [...BASE_ANSWERS];
  if (extra) lines.push(extra);
  const path = join(tmp, `${name}.answers`);
  writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
  return path;
}

export function setupDryRun(tmp: string, answersPath: string): { code: number; out: string } {
  const bin = setupBin(tmp);
  const r = run(RUN, ["setup", "--answers", answersPath, "--dry-run"], {
    env: { ...(process.env as Record<string, string>), PATH: `${bin}:${process.env.PATH}` },
  });
  return { code: r.code, out: `${r.out}\n${r.err}` };
}

/** Cut a ticket file; throws nothing — the caller asserts on the exit. */
export function cutTicket(path: string): { code: number; out: string; err: string } {
  return run(RUN, ["ticket-cut", path]);
}

export function ticketCheckBody(
  ticketFile: string,
  project: string,
): { code: number; out: string } {
  const r = run(RUN, ["ticket-check", "--body", ticketFile, "--project", project]);
  return { code: r.code, out: `${r.out}\n${r.err}` };
}

export function summaryEvidence(
  summary: string,
  wt: string,
  ticket: string,
): { code: number; out: string } {
  const r = run(RUN, ["summary-evidence", summary, wt, "--ticket", ticket]);
  return { code: r.code, out: `${r.out}\n${r.err}` };
}

export function verifyExamples(wt: string, ticket: string): { code: number; out: string } {
  const r = run(RUN, ["verify-examples", wt, "--ticket", ticket]);
  return { code: r.code, out: `${r.out}\n${r.err}` };
}

export function verifyJourney(wt: string, ticket: string): { code: number; out: string } {
  const r = run(RUN, ["verify-journey", wt, "--ticket", ticket]);
  return { code: r.code, out: `${r.out}\n${r.err}` };
}

/** A scratch git copy of the fixture app, committed, for the example and journey checks. */
export function scratchApp(dir: string): string {
  const wt = join(dir, "app");
  cpSync(APP, wt, { recursive: true });
  initRepo(wt);
  gitOrThrow(wt, "add", ".");
  gitOrThrow(wt, "commit", "-q", "-m", "app");
  return wt;
}

/** The criterion count from ticket-check's machine line, or -1 when it refuses the ticket. */
export function criterionCount(ticketFile: string, project: string): number {
  const r = ticketCheckBody(ticketFile, project);
  const m = /^well-formed, ([0-9]+) acceptance criteria$/mu.exec(r.out);
  return m ? Number(m[1]) : -1;
}

/** A summary citing one evidence file per criterion, with the files created. */
export function summaryFor(ticketFile: string, wt: string, project: string): string {
  const n = criterionCount(ticketFile, project);
  if (n < 0) throw new Error(`ticket-check refuses ${ticketFile}`);
  const verify = join(wt, ".postmaster", "verify");
  mkdirSync(verify, { recursive: true });
  const entries: string[] = [];
  for (let c = 1; c <= n; c++) {
    const rel = `.postmaster/verify/evidence-${c}.md`;
    writeFileSync(join(wt, rel), `evidence for ${c}\n`, "utf8");
    entries.push(`${c}. \`${rel}\``);
  }
  const summary = join(wt, "WORKHORSE-SUMMARY.md");
  writeFileSync(summary, `# Summary\n\n## Evidence\n${entries.join("\n")}\n`, "utf8");
  return summary;
}

export function readFixtureTicket(name: string): string {
  return readFileSync(join(TICKETS, name, "ticket.md"), "utf8");
}

export function readTrackerBody(id: string): string {
  return readFileSync(join(FIXTURES, `ticket-${id}.md`), "utf8");
}
