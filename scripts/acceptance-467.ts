// Oracle helpers for #467: the flow's commands take over the steps a coachman
// missed at the lowest effort. The tests spawn git and scripts/run as
// subprocesses; nothing here imports the change.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beside, toolRoot } from "./lib/paths.ts";
import { run } from "./lib/proc.ts";

export const RUN = beside(import.meta, "run");
export const TOOL = toolRoot(import.meta);

export interface LaneSpec {
  harness: string;
  model: string;
}

export interface FixtureOptions {
  /** The waybill's turnpikes line, names or none. Default "style". */
  turnpikes?: string;
  /** The Team section's reviewers line. Default "ghost". */
  reviewers?: string;
  /** Extra Team section lines, such as a bug reviewers line. */
  teamExtra?: string[];
  /** run.json mode. Absent reads as synthesis. */
  mode?: string;
  /** run.json config lanes, for the launch skill queries. */
  lanes?: Record<string, LaneSpec>;
  /** The manifest's stage. Default "bootstrapped". */
  stage?: string;
  /** Stage targets seeded into actions.jsonl, oldest first. */
  stageHistory?: string[];
  /** The review round's time limit in seconds. Default 120. */
  timeoutSecs?: number;
  /** Lens briefs to write, such as ["style"]. Default none. */
  briefs?: string[];
}

export interface Machine {
  root: string;
  repo: string;
  ticket: string;
  dispatch: string;
  synthesis: string;
  base: string;
  snap: string;
  env: Record<string, string | undefined>;
}

export interface ToolResult {
  code: number;
  out: string;
  err: string;
}

export function gitOrThrow(repo: string, ...args: string[]): string {
  const r = run("git", ["-C", repo, ...args]);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${(r.err || r.out).trim()}`);
  return r.out;
}

/** One tool call against the fixture, on the none host so no session opens. */
export function tool(m: Machine, ...args: string[]): ToolResult {
  const r = run(RUN, args, { env: m.env });
  return { code: r.code, out: r.out, err: r.err };
}

export interface ActionLine {
  ts: string;
  actor: string;
  action: string;
  target: string;
  detail: string;
}

export function actions(m: Machine): ActionLine[] {
  const out: ActionLine[] = [];
  let text = "";
  try {
    text = readFileSync(join(m.dispatch, "actions.jsonl"), "utf8");
  } catch {
    return out;
  }
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    out.push(JSON.parse(line) as ActionLine);
  }
  return out;
}

/**
 * A target git repo with a ticket branch and a synthesis worktree on it, and a
 * dispatch with a manifest, run record, waybill, actions and run log. The ghost
 * reviewer lane is recorded with a harness that has no form, so a launch
 * collects it as soon as the harness form is refused.
 */
export function machine(root: string, opts: FixtureOptions = {}): Machine {
  const ticket = "T-1";
  const repo = join(root, "repo");
  mkdirSync(repo, { recursive: true });
  gitOrThrow(repo, "init", "-q", "-b", "main");
  gitOrThrow(repo, "config", "user.name", "acceptance-467-test");
  gitOrThrow(repo, "config", "user.email", "acceptance-467-test@example.invalid");
  gitOrThrow(repo, "config", "commit.gpgsign", "false");
  writeFileSync(join(repo, "file.txt"), "base\n");
  gitOrThrow(repo, "add", "file.txt");
  gitOrThrow(repo, "commit", "-q", "-m", "base");
  const base = gitOrThrow(repo, "rev-parse", "HEAD").trim();
  gitOrThrow(repo, "checkout", "-q", "-b", ticket);
  writeFileSync(join(repo, "file.txt"), "base\nchange\n");
  gitOrThrow(repo, "commit", "-q", "-am", "change");
  const snap = gitOrThrow(repo, "rev-parse", "HEAD").trim();
  gitOrThrow(repo, "checkout", "-q", "main");
  const synthesis = join(repo, ".worktrees", ticket);
  gitOrThrow(repo, "worktree", "add", "-q", synthesis, ticket);

  const dispatch = join(repo, ".postmaster", "runs", ticket);
  mkdirSync(join(dispatch, "logs"), { recursive: true });
  mkdirSync(join(dispatch, "reach"), { recursive: true });
  const stage = opts.stage ?? "bootstrapped";
  writeFileSync(
    join(dispatch, "manifest.json"),
    `${JSON.stringify({ stage, leg: 1, base, lanes: {}, coachman: { legs: {} } })}\n`,
  );
  const runRecord: Record<string, unknown> = {
    coachman_contract: 2,
    target: { branch: "main", head: base },
    postmaster: { commit: base, checkout: TOOL },
    config: {
      lanes: { ghost: { harness: "none-such", model: "m" }, ...(opts.lanes ?? {}) },
      review: { round_timeout_seconds: opts.timeoutSecs ?? 120 },
    },
  };
  if (opts.mode !== undefined) runRecord.mode = opts.mode;
  writeFileSync(join(dispatch, "run.json"), `${JSON.stringify(runRecord)}\n`);
  const team = [`reviewers: ${opts.reviewers ?? "ghost"}`, ...(opts.teamExtra ?? [])].join("\n");
  writeFileSync(
    join(dispatch, "brief.md"),
    `# Waybill: ${ticket}\nturnpikes: ${opts.turnpikes ?? "style"}\n\n## Ticket\n\nA test ticket.\n\n## Project profile\nrepo: ${repo}          default branch: main       BASE: ${base}\n\n## Team\n${team}\ncoachman: test/test/test\n\n## Dispatch\nname: ${ticket}, test\nsynthesis worktree: ${synthesis}\ntool: ${TOOL}\n`,
  );
  const now = new Date().toISOString();
  const seed: ActionLine[] = [
    {
      ts: now,
      actor: "postmaster",
      action: "dispatch",
      target: ticket,
      detail: "acceptance-467 fixture",
    },
  ];
  let from = "dispatched";
  for (const entered of opts.stageHistory ?? []) {
    seed.push({
      ts: now,
      actor: "coachman",
      action: "stage",
      target: entered,
      detail: `from ${from}`,
    });
    from = entered;
  }
  writeFileSync(
    join(dispatch, "actions.jsonl"),
    seed.map((line) => JSON.stringify(line)).join("\n") + "\n",
  );
  writeFileSync(join(dispatch, "run-log.md"), "");
  for (const lens of opts.briefs ?? []) {
    writeFileSync(join(dispatch, `review-${lens}-brief.md`), `# ${lens} brief\n\nReview the diff.\n`);
  }
  const host = join(root, "host");
  mkdirSync(host, { recursive: true });
  const env: Record<string, string | undefined> = {
    POSTMASTER_HOST: "none",
    POSTMASTER_HOST_STATE: host,
    POSTMASTER_HOST_STOP_WAIT: "2",
    POSTMASTER_HOST_CLOSE_WAIT: "2",
  };
  return { root, repo, ticket, dispatch, synthesis, base, snap, env };
}
