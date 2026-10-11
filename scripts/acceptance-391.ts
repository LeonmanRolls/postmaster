// Oracle helpers for #391: a verified finding is fixed while the other
// reviewers of its round are still working. The tests spawn scripts/run as
// a subprocess over scratch run layouts; nothing here imports the change.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beside, toolRoot } from "./lib/paths.ts";
import { type RunResult, run } from "./lib/proc.ts";

export const ROOT = toolRoot(import.meta);
export const RUN = beside(import.meta, "run");

const CREATED: string[] = [];

export function cleanup(): void {
  for (const path of CREATED.splice(0)) rmSync(path, { recursive: true, force: true });
}

export interface LaneSpec {
  lens: string;
  lane: string;
  harness: string;
}

export interface Layout {
  root: string;
  repo: string;
  dispatch: string;
  home: string;
  base: string;
  synth: string;
  lanes: LaneSpec[];
}

export function sh(cmd: string, args: string[], cwd?: string): string {
  const r = run(cmd, args, cwd ? { cwd } : {});
  if (r.code !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (${r.code}): ${r.err}${r.out}`);
  return r.out.trim();
}

export function git(repo: string, ...args: string[]): string {
  return sh("git", ["-C", repo, ...args]);
}

/** A scratch run layout: repo, synthesis worktree, review scratches, run records. */
export function makeLayout(
  lanes: LaneSpec[],
  options: { timeoutSeconds?: number } = {},
): Layout {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "acceptance-391-")));
  CREATED.push(root);
  const repo = join(root, "repo");
  const home = join(root, "home");
  mkdirSync(home, { recursive: true });
  mkdirSync(join(home, "host-state"), { recursive: true });
  sh("git", ["init", "-q", "-b", "main", repo]);
  git(repo, "config", "user.name", "brindlewick");
  git(repo, "config", "user.email", "332054101+brindlewick@users.noreply.github.com");
  git(repo, "config", "commit.gpgsign", "false");
  mkdirSync(join(repo, ".git", "info"), { recursive: true });
  writeFileSync(join(repo, ".git", "info", "exclude"), ".postmaster/\n.worktrees/\n");
  writeFileSync(join(repo, "README.md"), "base text\n");
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src", "other.txt"), "other base\n");
  git(repo, "add", "README.md", "src/other.txt");
  git(repo, "commit", "-qm", "Base");
  const base = git(repo, "rev-parse", "HEAD");

  const ticket = "T";
  const worktrees = join(repo, ".worktrees");
  mkdirSync(worktrees, { recursive: true });
  const synth = join(worktrees, ticket);
  git(repo, "worktree", "add", "-q", "-b", ticket, synth, "main");
  // The synthesis under review sits past the base, as a real round finds it.
  writeFileSync(join(synth, "src", "work.txt"), "synthesis work\n");
  git(repo, "-C", synth, "add", "src/work.txt");
  git(repo, "-C", synth, "commit", "-qm", "Synthesis work");
  for (const { lens, lane } of lanes) {
    git(repo, "worktree", "add", "-q", "--detach", join(worktrees, `${ticket}-rev-${lens}-${lane}`), ticket);
  }

  const dispatch = join(repo, ".postmaster", "runs", ticket);
  mkdirSync(join(dispatch, "logs"), { recursive: true });
  const laneConfig: Record<string, { harness: string }> = {};
  for (const { lane, harness } of lanes) laneConfig[lane] = { harness };
  writeFileSync(
    join(dispatch, "run.json"),
    `${JSON.stringify(
      {
        coachman_contract: 2,
        target: { branch: "main", head: base },
        postmaster: { checkout: ROOT, commit: "fixture" },
        config: {
          lanes: laneConfig,
          ...(options.timeoutSeconds !== undefined
            ? { review: { round_timeout_seconds: options.timeoutSeconds } }
            : {}),
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(join(dispatch, "manifest.json"), `${JSON.stringify({ base, lanes: {} })}\n`);
  const bugs = lanes.filter((l) => l.lens === "bug").map((l) => l.lane);
  writeFileSync(
    join(dispatch, "brief.md"),
    `# Waybill: T\nturnpikes: bug\n\n## Ticket\n\nA review round with early fixes.\n\n## Project profile\nrepo: ${repo} default branch: main BASE: ${base}\n\n## Team\nmode: single-thread\nreviewers: ${bugs.join(", ")}\nbug reviewers: ${bugs.join(", ")}\n`,
  );
  writeFileSync(
    join(dispatch, "checks.json"),
    `${JSON.stringify(
      {
        checks: [
          { name: "gate", source: "declared", kind: "project", command: "true", shows: "x" },
          { name: "extra", source: "declared", kind: "project", command: "", shows: "y" },
        ],
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(dispatch, "logs", "review-r1.json"),
    `${JSON.stringify({ reviewers: lanes.map((l) => [l.lens, l.lane]) })}\n`,
  );
  const layout: Layout = { root, repo, dispatch, home, base, synth, lanes };
  for (const { lens, lane, harness } of lanes) {
    if (harness === "codex") writeReviewer(layout, lens, lane, [codex(`touch ${scratch(layout, lens, lane)}/probe.txt`)]);
    else if (harness === "mimo")
      writeReviewer(layout, lens, lane, [mimo("write_file", { path: join(scratch(layout, lens, lane), "probe.txt") })]);
    else throw new Error(`no clean record builder for harness ${harness}`);
  }
  return layout;
}

export function scratch(layout: Layout, lens: string, lane: string): string {
  return join(layout.repo, ".worktrees", `T-rev-${lens}-${lane}`);
}

export function codex(commandText: string, output = "", exit = 0): Record<string, unknown> {
  return {
    type: "item.completed",
    item: {
      type: "command_execution",
      command: `/bin/bash -lc '${commandText}'`,
      aggregated_output: output,
      exit_code: exit,
    },
  };
}

export function mimo(
  name: string,
  input: Record<string, unknown>,
  output = "",
  exit = 0,
): Record<string, unknown> {
  return {
    type: "tool_use",
    sessionID: "s1",
    part: {
      type: "tool",
      tool: name,
      state: { status: exit === 0 ? "completed" : "error", input, output, metadata: { exit } },
    },
  };
}

export function reviewerEvents(layout: Layout, lens: string, lane: string, round = 1): string {
  return join(layout.dispatch, "logs", `review-r${round}-${lens}-${lane}.jsonl`);
}

export function writeReviewer(
  layout: Layout,
  lens: string,
  lane: string,
  events: unknown[],
  round = 1,
): void {
  writeFileSync(
    reviewerEvents(layout, lens, lane, round),
    `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
  );
}

export function tool(layout: Layout, ...args: string[]): RunResult {
  // The timeout path stops stragglers through the host; the none host keeps
  // that hermetic, as in review-round.test.ts.
  return run(RUN, args, {
    env: {
      HOME: layout.home,
      POSTMASTER_HOST: "none",
      POSTMASTER_HOST_STATE: join(layout.home, "host-state"),
      POSTMASTER_HOST_STOP_WAIT: "2",
    },
  });
}

export function writeAction(
  layout: Layout,
  actor: string,
  action: string,
  target: string,
  detail: string,
): void {
  const r = tool(layout, "log-action", layout.dispatch, actor, action, target, detail);
  if (r.code !== 0) throw new Error(`log action failed: ${r.err}${r.out}`);
}

export function actionLines(layout: Layout): Array<Record<string, unknown>> {
  const path = join(layout.dispatch, "actions.jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

export function addCommit(
  repo: string,
  folder: string,
  file: string,
  content: string,
): string {
  const target = join(folder, file);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, content);
  git(repo, "-C", folder, "add", file);
  git(repo, "-C", folder, "commit", "-qm", "Change");
  return git(repo, "-C", folder, "rev-parse", "HEAD");
}

/** Land a marker file after ms, from a process of its own, and return at once. */
export function landMarkerAfter(marker: string, ms: number): void {
  const child = Bun.spawn(["bash", "-c", `sleep ${(ms / 1000).toFixed(1)}; touch '${marker}'`], {
    stdout: "ignore",
    stderr: "ignore",
  });
  child.unref();
}
