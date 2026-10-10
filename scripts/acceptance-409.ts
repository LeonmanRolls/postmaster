// Oracle helpers for #409: the technical notes stay away from the coachman and
// the workhorses, and the run's log says whether they did. The tests drive
// scripts/run as a subprocess and read the runbooks as files; nothing here
// imports the change.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beside, toolRoot } from "./lib/paths.ts";
import { run } from "./lib/proc.ts";

export const ROOT = toolRoot(import.meta);
export const RUN = beside(import.meta, "run");

export const NOTICE =
  "The ticket's technical notes are held back on purpose and are not to be looked up, in the tracker or anywhere else.";
export const NO_QUOTE =
  "When the run's ticket notes are held back, nothing sent to the coachman quotes the technical notes: not a leg's prompt, a ruling, or a resume.";

export function readRunbook(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

export function scratchDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function removeDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

export type Harness = "codex" | "claude" | "muse" | "grok";

export interface FixtureAgent {
  /** workhorse lane, or reviewer lane. */
  lane: string;
  harness: Harness;
  /** event-stream lines for logs/<file>. */
  lines: string[];
  /** stream file name; defaults to <lane>-events.jsonl. */
  file?: string;
  /** review launches behind this stream: "r<round> <lens>". */
  reviews?: string[];
}

export interface FixtureOptions {
  ticket?: number;
  tracker?: string;
  notes?: string;
  repo?: string;
  legs?: Array<{ n: number; harness: Harness; lines: string[] }>;
  agents?: FixtureAgent[];
}

/** A codex command_execution item, completed, in the stream's own shape. */
export function codexExec(command: string, output = "", code = 0): string {
  return JSON.stringify({
    type: "item.completed",
    item: {
      type: "command_execution",
      command: `/bin/bash -lc '${command}'`,
      aggregated_output: output,
      exit_code: code,
      status: "completed",
    },
  });
}

/** A claude tool_use block inside an assistant message, in the stream's shape. */
export function claudeUse(
  name: string,
  input: Record<string, unknown>,
  id = "toolu_0001",
): string {
  return JSON.stringify({
    type: "assistant",
    message: {
      content: [{ type: "tool_use", id, name, input }],
    },
  });
}

/** A muse tool result whose text is the command's JSON report, pretty as the harness prints it. */
export function museExec(command: string, code = 0): string {
  const text = JSON.stringify(
    { chunk_id: "exec-1-1", command, exit_code: code, output: "" },
    null,
    2,
  );
  return JSON.stringify({
    payload_type: "tool.result",
    payload: {
      correlation_facts: { tool_name: "bash", outcome: "success" },
      text,
    },
  });
}

/** A muse file read, in the stream's own shape. */
export function museRead(path: string): string {
  return JSON.stringify({
    payload_type: "tool.result",
    payload: {
      correlation_facts: { tool_name: "read_file", outcome: "success" },
      text: `Read text file \`${path}\`.\n1|# T\n`,
    },
  });
}

function streamFor(harness: Harness, lines: string[]): string {
  if (harness === "codex")
    return `${JSON.stringify({ type: "thread.started", thread_id: "t" })}\n${lines.join("\n")}\n`;
  return `${lines.join("\n")}\n`;
}

/**
 * A minimal held-back dispatch folder: run.json, manifest.json, brief.md with
 * a project profile, actions.jsonl, and one stream per agent. The repo defaults
 * to a scratch git checkout whose origin is example/shop, so github forms have
 * an owner and repo to match.
 */
export function fixtureDispatch(tmp: string, name: string, opts: FixtureOptions = {}): string {
  const ticket = opts.ticket ?? 409;
  const tracker = opts.tracker ?? "github";
  const notes = opts.notes ?? "held-back";
  const dispatch = join(tmp, name);
  mkdirSync(join(dispatch, "logs"), { recursive: true });
  let repo = opts.repo ?? "";
  if (!repo) {
    repo = join(tmp, `${name}-repo`);
    mkdirSync(repo, { recursive: true });
    const g = (args: string[]): void => {
      const r = run("git", ["-C", repo, ...args]);
      if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.err}`);
    };
    g(["init", "-q", "-b", "main"]);
    g(["config", "user.name", "brindlewick"]);
    g(["config", "user.email", "332054101+brindlewick@users.noreply.github.com"]);
    g(["config", "commit.gpgsign", "false"]);
    writeFileSync(join(repo, "README.md"), "# shop\n", "utf8");
    g(["add", "."]);
    g(["commit", "-q", "-m", "first"]);
    g(["remote", "add", "origin", "https://github.com/example/shop.git"]);
  }
  const lanes: Record<string, unknown> = {};
  const manifestLanes: Record<string, unknown> = {};
  const actions: string[] = [];
  for (const agent of opts.agents ?? []) {
    lanes[agent.lane] = { harness: agent.harness, model: "m" };
    if ((agent.reviews ?? []).length === 0) manifestLanes[agent.lane] = { outcome: "harvested" };
    const file = agent.file ?? `${agent.lane}-events.jsonl`;
    writeFileSync(
      join(dispatch, "logs", file),
      streamFor(agent.harness, agent.lines),
      "utf8",
    );
    for (const review of agent.reviews ?? []) {
      const [round, lens] = review.split(" ");
      actions.push(
        JSON.stringify({
          ts: "2026-10-10T00:00:00Z",
          project: "p",
          run: String(ticket),
          actor: "coachman",
          action: "review-launch",
          target: agent.lane,
          detail: `${lens} round ${round?.slice(1)}`,
        }),
      );
    }
  }
  const legs: Record<string, unknown> = {};
  for (const leg of opts.legs ?? []) {
    legs[String(leg.n)] = { thread_id: `leg-${leg.n}` };
    writeFileSync(
      join(dispatch, "logs", `coachman-leg-${leg.n}-events.jsonl`),
      streamFor(leg.harness, leg.lines),
      "utf8",
    );
  }
  const coachmanHarness = opts.legs?.[0]?.harness ?? "muse";
  writeFileSync(
    join(dispatch, "run.json"),
    JSON.stringify({
      config: {
        lanes,
        team: {
          coachman: { harness: coachmanHarness, model: "m" },
          ticket_notes: notes,
          workhorses: Object.keys(lanes),
        },
      },
    }),
    "utf8",
  );
  writeFileSync(
    join(dispatch, "manifest.json"),
    JSON.stringify({
      stage: "shipped",
      leg: 1,
      base: "abc1234",
      lanes: manifestLanes,
      coachman: { legs },
    }),
    "utf8",
  );
  writeFileSync(
    join(dispatch, "brief.md"),
    `# Waybill: ${ticket}\nturnpikes: none\n\n## Ticket\n\n## Problem / feature\n\nP.\n\n## Project profile\nrepo: ${repo}          default branch: main       BASE: abc1234\ngate: true\ntracker: ${tracker}, issue ${ticket}\n`,
    "utf8",
  );
  writeFileSync(
    join(dispatch, "actions.jsonl"),
    actions.length > 0 ? `${actions.join("\n")}\n` : "",
    "utf8",
  );
  writeFileSync(join(dispatch, "run-log.md"), "# Run log\n", "utf8");
  return dispatch;
}

/** Run the check; the caller asserts on exit and output. */
export function ticketReads(
  dispatch: string,
  ...args: string[]
): { code: number; out: string; err: string } {
  return run(RUN, ["ticket-reads", dispatch, ...args]);
}

export function outcomeOf(out: string): string {
  return out.split("\n").find((l) => l.startsWith("ticket-reads:")) ?? "";
}
