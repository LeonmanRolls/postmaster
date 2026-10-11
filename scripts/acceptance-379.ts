// Oracle helpers for #379: the coachman merges main and runs the gate as the
// last step before it raises its card. The tests spawn git and scripts/run as
// subprocesses; nothing here imports the change.
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beside } from "./lib/paths.ts";
import { run } from "./lib/proc.ts";

export const RUN = beside(import.meta, "run");
export const TICKET = "t379";
export const DEFAULT = "main";

export function gitOrThrow(repo: string, ...args: string[]): string {
  const r = run("git", ["-C", repo, ...args]);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.err.trim() || r.out.trim()}`);
  return r.out.trim();
}

export function scratchDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function removeDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

export interface Layout {
  dir: string;
  repo: string;
  wt: string;
  dispatch: string;
  ticket: string;
}

/** A scratch run: a repo on main, a linked worktree on the ticket branch with
 * one ticket commit, and a dispatch with a waybill. The gate is recorded
 * separately per scenario with recordGate. */
export function scratchLayout(tmp: string, name: string): Layout {
  const dir = join(tmp, name);
  const repo = join(dir, "repo");
  const wt = join(dir, "wt");
  const dispatch = join(dir, "dispatch");
  mkdirSync(dispatch, { recursive: true });
  const ticket = TICKET;
  const init = run("git", ["init", "-q", "-b", DEFAULT, repo]);
  if (init.code !== 0) throw new Error(`git init: ${init.err.trim() || init.out.trim()}`);
  gitOrThrow(repo, "config", "user.name", "brindlewick");
  gitOrThrow(repo, "config", "user.email", "332054101+brindlewick@users.noreply.github.com");
  gitOrThrow(repo, "config", "commit.gpgsign", "false");
  writeFileSync(join(repo, "main.txt"), "main\n", "utf8");
  writeFileSync(join(repo, "clash.txt"), "shared\n", "utf8");
  gitOrThrow(repo, "add", "main.txt", "clash.txt");
  gitOrThrow(repo, "commit", "-q", "-m", "base");
  gitOrThrow(repo, "worktree", "add", "-q", wt, "-b", ticket);
  writeFileSync(join(wt, "ticket.txt"), "ticket\n", "utf8");
  gitOrThrow(wt, "add", "ticket.txt");
  gitOrThrow(wt, "commit", "-q", "-m", "the ticket change");
  writeFileSync(
    join(dispatch, "brief.md"),
    "# Waybill\n\n## Ticket\n\nscratch\n\n## Project profile\n\nscratch\n",
    "utf8",
  );
  return { dir, repo, wt, dispatch, ticket };
}

/** A commit on main touching only main.txt, which the ticket never touches. */
export function mainMove(repo: string, line: string, message: string): string {
  const file = join(repo, "main.txt");
  writeFileSync(file, `${readFileSync(file, "utf8")}${line}`);
  gitOrThrow(repo, "add", "main.txt");
  gitOrThrow(repo, "commit", "-q", "-m", message);
  return headOf(repo, DEFAULT);
}

function writeStub(layout: Layout, name: string, body: string): string {
  const path = join(layout.dir, `${name}.sh`);
  writeFileSync(path, body, "utf8");
  chmodSync(path, 0o755);
  return path;
}

/** The gate stub that always passes and moves nothing. */
export function passStub(layout: Layout): string {
  return writeStub(layout, "gate-pass", "#!/bin/sh\nexit 0\n");
}

/** The gate stub that always fails. */
export function failStub(layout: Layout): string {
  return writeStub(layout, "gate-fail", '#!/bin/sh\necho "stub gate fails"\nexit 1\n');
}

/** The gate stub that moves main on its first run only, then passes quietly. */
export function moveOnceStub(layout: Layout): string {
  const counter = join(layout.dir, "counter");
  writeFileSync(counter, "0\n", "utf8");
  return writeStub(
    layout,
    "gate-move-once",
    `#!/bin/sh
n="$(cat "${counter}")"
if [ "$n" = "0" ]; then
  echo "1" > "${counter}"
  echo "main moves during the first gate" >> "${layout.repo}/main.txt"
  git -C "${layout.repo}" add main.txt
  git -C "${layout.repo}" commit -q -m "main moves during the first gate"
fi
exit 0
`,
  );
}

/** The gate stub that moves main on every run. */
export function moveAlwaysStub(layout: Layout): string {
  const counter = join(layout.dir, "counter");
  writeFileSync(counter, "0\n", "utf8");
  return writeStub(
    layout,
    "gate-move-always",
    `#!/bin/sh
n="$(cat "${counter}")"
echo "$((n + 1))" > "${counter}"
echo "main moves during gate $n" >> "${layout.repo}/main.txt"
git -C "${layout.repo}" add main.txt
git -C "${layout.repo}" commit -q -m "main moves during a gate"
exit 0
`,
  );
}

export function recordGate(layout: Layout, stub: string): void {
  const r = run(RUN, ["verify", "record", layout.repo, layout.dispatch, "--gate", `"${stub}"`]);
  if (r.code !== 0) throw new Error(`verify record: ${r.err.trim() || r.out.trim()}`);
}

export interface Call {
  code: number;
  out: string;
  err: string;
}

export function mergeDefault(layout: Layout): Call {
  const r = run(RUN, [
    "merge-default",
    "--repo",
    layout.repo,
    "--default",
    DEFAULT,
    "--ticket",
    layout.ticket,
    "--dispatch",
    layout.dispatch,
    "--wt",
    layout.wt,
  ]);
  return { code: r.code, out: r.out, err: r.err };
}

export function landingFresh(layout: Layout): Call {
  const r = run(RUN, [
    "landing",
    "fresh",
    "--repo",
    layout.repo,
    "--default",
    DEFAULT,
    "--ticket",
    layout.ticket,
    "--dispatch",
    layout.dispatch,
    "--wt",
    layout.wt,
  ]);
  return { code: r.code, out: r.out, err: r.err };
}

export function verifyRun(layout: Layout): Call {
  const r = run(RUN, ["verify", "run", layout.wt, layout.dispatch]);
  return { code: r.code, out: r.out, err: r.err };
}

/** The first word of the step's verdict line. */
export function verdictOf(out: string): string {
  const first = out.split("\n")[0] ?? "";
  return first.split(/[: ]/u)[0] ?? "";
}

export interface Drive {
  verdicts: string[];
  gates: number;
  last: Call;
}

/** The runbook loop around the step: run the gate after MERGED and
 * GATE-NEEDED, and stop at CARD, CARD-ANYWAY, CONFLICT and GATE-FAILED. */
export function drive(layout: Layout): Drive {
  const verdicts: string[] = [];
  let gates = 0;
  let last: Call = { code: -1, out: "", err: "" };
  for (let round = 0; round < 6; round++) {
    last = mergeDefault(layout);
    const verdict = verdictOf(last.out);
    verdicts.push(verdict);
    if (verdict === "CARD" || verdict === "CARD-ANYWAY") return { verdicts, gates, last };
    if (verdict === "CONFLICT" || verdict === "GATE-FAILED") return { verdicts, gates, last };
    if (verdict === "MERGED" || verdict === "GATE-NEEDED") {
      gates += 1;
      verifyRun(layout);
      continue;
    }
    throw new Error(`unexpected verdict: ${JSON.stringify(last.out.split("\n")[0])}`);
  }
  throw new Error(`the step did not settle: ${verdicts.join(", ")}`);
}

export interface Action {
  actor: string;
  action: string;
  target: string;
  detail: string;
}

export function readActions(dispatch: string): Action[] {
  const lines = readFileSync(join(dispatch, "actions.jsonl"), "utf8").split("\n");
  const out: Action[] = [];
  lines.forEach((line, n) => {
    if (line === "") return;
    try {
      out.push(JSON.parse(line) as Action);
    } catch {
      throw new Error(`actions.jsonl line ${n + 1} does not parse`);
    }
  });
  return out;
}

export function headOf(dir: string, ref = "HEAD"): string {
  return gitOrThrow(dir, "rev-parse", ref);
}

export function isAncestor(repo: string, ancestor: string, ref: string): boolean {
  return run("git", ["-C", repo, "merge-base", "--is-ancestor", ancestor, ref]).code === 0;
}

export function countMerges(repo: string, ref: string): number {
  return Number(gitOrThrow(repo, "rev-list", "--count", "--merges", ref));
}

export function mergeHeadExists(wt: string): boolean {
  const r = run("git", ["-C", wt, "rev-parse", "--verify", "--quiet", "MERGE_HEAD"]);
  return r.code === 0 && r.out.trim() !== "";
}

export function unmergedPaths(wt: string): string[] {
  const r = run("git", ["-C", wt, "diff", "--name-only", "-z", "--diff-filter=U"]);
  if (r.code !== 0) throw new Error(`git diff --diff-filter=U: ${r.err.trim() || r.out.trim()}`);
  return r.out.split("\0").filter((p) => p !== "");
}
