import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type HiddenCounts = { pass: number; fail: number };
export type LaneResult =
  | { lane: string; kind: "counts"; pass: number; fail: number }
  | { lane: string; kind: "missing" | "failed to build" };

const LANE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function validLane(value: string): string | undefined {
  const lane = value.trim();
  return LANE_NAME.test(lane) ? lane : undefined;
}

function namesFromWaybill(brief: string): string[] {
  const team = /^##[ \t]+Team[ \t]*\n([\s\S]*?)(?=^##[ \t]|\s*$)/im.exec(brief)?.[1] ?? "";
  const line = /^workhorses:[ \t]*(.*)$/im.exec(team)?.[1] ?? "";
  return line.split(",").flatMap((entry) => {
    const lane = validLane(entry.split("=", 1)[0] ?? "");
    return lane ? [lane] : [];
  });
}

function namesFromBranches(branches: string[], ticket: string): string[] {
  const prefix = `wb/${ticket}-`;
  return branches.flatMap((branch) => {
    if (!branch.startsWith(prefix)) return [];
    const lane = validLane(branch.slice(prefix.length));
    return lane ? [lane] : [];
  });
}

/** Collect the run's named lanes and every kept workhorse branch for this ticket. */
export function laneNames(
  manifest: unknown,
  auditFiles: string[],
  brief: string,
  branchNames: string[],
  ticket: string,
): string[] {
  const lanes = new Set<string>();
  if (manifest && typeof manifest === "object" && "lanes" in manifest) {
    const recorded = (manifest as { lanes?: unknown }).lanes;
    if (recorded && typeof recorded === "object" && !Array.isArray(recorded)) {
      for (const key of Object.keys(recorded)) {
        const lane = validLane(key);
        if (lane) lanes.add(lane);
      }
    }
  }

  for (const file of auditFiles) {
    if (!file.endsWith(".md") || /-spec(?:-final)?\.md$/.test(file)) continue;
    const lane = validLane(file.slice(0, -3));
    if (lane) lanes.add(lane);
  }

  for (const lane of namesFromWaybill(brief)) lanes.add(lane);
  for (const lane of namesFromBranches(branchNames, ticket)) lanes.add(lane);
  return [...lanes].sort();
}

/** Read the count line emitted by `fixture.sh hidden`, if that command ran its suite. */
export function hiddenCounts(output: string): HiddenCounts | undefined {
  const rows = [...output.matchAll(/^\s*(?:ok|FAIL)\s+hidden-tests\s+[^:\r\n]+:\s*(\d+)\s+pass,\s*(\d+)\s+fail\s*$/gm)];
  const last = rows.at(-1);
  if (!last) return undefined;
  return { pass: Number(last[1]), fail: Number(last[2]) };
}

export function formatLaneResults(results: LaneResult[]): string {
  if (results.length === 0) return "no lanes found";
  return [...results]
    .sort((a, b) => (a.lane < b.lane ? -1 : a.lane > b.lane ? 1 : 0))
    .map((result) => {
      if (result.kind === "counts") return `${result.lane}: ${result.pass} pass, ${result.fail} fail`;
      return `${result.lane}: ${result.kind}`;
    })
    .join("; ");
}

type CommandResult = { code: number | null; stdout: Buffer; stderr: Buffer };

function run(command: string, args: string[], options: { cwd?: string; stdin?: Buffer } = {}): CommandResult {
  const result = Bun.spawnSync([command, ...args], {
    cwd: options.cwd,
    stdin: options.stdin,
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: result.exitCode, stdout: result.stdout, stderr: result.stderr };
}

function git(repo: string, ...args: string[]): CommandResult {
  return run("git", ["-C", repo, ...args]);
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

function branchNames(repo: string): string[] {
  const result = git(repo, "for-each-ref", "--format=%(refname:short)", "refs/heads/wb");
  if (result.code !== 0) return [];
  return result.stdout.toString().split(/\r?\n/).filter(Boolean);
}

function exportBranch(repo: string, ref: string, tree: string): boolean {
  const archive = git(repo, "archive", "--format=tar", ref);
  if (archive.code !== 0) return false;
  const tar = join(tree, "branch.tar");
  writeFileSync(tar, archive.stdout);
  const extracted = run("tar", ["-xf", tar, "-C", tree]);
  rmSync(tar, { force: true });
  return extracted.code === 0;
}

function fixtureScript(): string {
  return fileURLToPath(new URL("./fixture.sh", import.meta.url));
}

function hiddenResult(ticket: string, tree: string): { code: number | null; output: string } {
  const result = run(fixtureScript(), ["hidden", ticket, tree]);
  return { code: result.code, output: `${result.stdout.toString()}\n${result.stderr.toString()}` };
}

function scoreLane(repo: string, ticket: string, ref: string, lane: string): LaneResult {
  const scratch = mkdtempSync(join(tmpdir(), "fixture-lane-"));
  try {
    const tree = join(scratch, "app");
    mkdirSync(tree);
    if (!exportBranch(repo, ref, tree)) return { lane, kind: "failed to build" };

    const hidden = hiddenResult(ticket, tree);
    const counts = hiddenCounts(hidden.output);
    if (!counts) return { lane, kind: "failed to build" };
    return { lane, kind: "counts", ...counts };
  } catch {
    return { lane, kind: "failed to build" };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

export function scoreLanes(dispatch: string, repo: string, ticket: string): LaneResult[] {
  const manifest = readJson(join(dispatch, "manifest.json"));
  const auditDir = join(dispatch, "audit");
  let auditFiles: string[] = [];
  try {
    auditFiles = readdirSync(auditDir);
  } catch {
    // The manifest, waybill and retained branches still identify lanes without an audit folder.
  }
  let brief = "";
  try {
    brief = readFileSync(join(dispatch, "brief.md"), "utf8");
  } catch {
    // Other run records and retained branches still identify lanes without a waybill.
  }

  const runTicket = /^# Waybill:[ \t]*(\S+)/m.exec(brief)?.[1] ?? basename(dispatch);
  const refs = branchNames(repo);
  const lanes = laneNames(manifest, auditFiles, brief, refs, runTicket);
  const prefix = `wb/${runTicket}-`;
  return lanes.map((lane) => {
    const ref = `${prefix}${lane}`;
    if (!refs.includes(ref)) return { lane, kind: "missing" };
    return scoreLane(repo, ticket, ref, lane);
  });
}

function main(args: string[]): number {
  if (args.length !== 3) {
    console.error("usage: fixture-lanes.ts <dispatch> <repo> <ticket>");
    return 1;
  }
  const [dispatchArg, repoArg, ticket] = args;
  if (!dispatchArg || !repoArg || !ticket) return 1;
  const results = scoreLanes(resolve(dispatchArg), resolve(repoArg), ticket);
  console.log(formatLaneResults(results));
  return 0;
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
