#!/usr/bin/env bun
// Score each lane's harvested branch against the ticket's hidden tests, for fixture.sh score.
//
//   fixture-lanes.ts <dispatch> <repo> <fixture-ticket>
//
// Finds the run's lanes from its records and its kept wb/<TICKET>-<lane> branches, exports each
// lane's branch the way score exports main, runs `fixture.sh hidden` on that tree, and prints one
// `<lane>: <status>` line per lane in name order:
//
//   <lane>: N pass, M fail     the hidden suite ran and reported counts
//   <lane>: missing            the harvested branch is gone
//   <lane>: failed to build    the branch will not export, or hidden refused it, or it printed
//                              no counts
//
// Missing and failed-to-build never print pass counts. The verdict is the merged result's alone;
// these lines are measurement beside it. Pure functions are exported for the tests; only the
// edges read files, run git or fixture.sh, or print. Run as `bun --no-env-file` so no .env in
// the working directory reaches it.
//
//   exit 0  printed one line per lane (zero lanes prints nothing)
//   exit 1  usage, or the inputs are not what they say
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

export type Counts = { passed: number; failed: number };
export type LaneStatus =
  | { kind: "counts"; passed: number; failed: number }
  | { kind: "missing" }
  | { kind: "failed-to-build" };

export function statusText(status: LaneStatus): string {
  if (status.kind === "counts") return `${status.passed} pass, ${status.failed} fail`;
  if (status.kind === "missing") return "missing";
  return "failed to build";
}

export function formatLane(lane: string, status: LaneStatus): string {
  return `${lane}: ${statusText(status)}`;
}

export function formatLanes(entries: Array<[string, LaneStatus]>): string {
  return entries.map(([lane, status]) => formatLane(lane, status)).join("; ");
}

/** The run's ticket id, from the waybill's first line: `# Waybill: <TICKET>`. */
export function ticketIdFromWaybill(text: string): string | null {
  const m = /^#\s*Waybill:\s*(\S+)\s*$/.exec(text.split(/\r?\n/, 1)[0] ?? "");
  return m ? m[1] : null;
}

/** Lane names from manifest.json's lanes object. */
export function laneNamesFromManifestLanes(lanes: unknown): string[] {
  if (lanes === null || typeof lanes !== "object" || Array.isArray(lanes)) return [];
  return Object.keys(lanes as Record<string, unknown>).filter((n) => n.length > 0).sort();
}

/** Lane names from audit file basenames, dropping the spec copies. */
export function laneNamesFromAuditFiles(names: string[]): string[] {
  return names
    .filter((n) => n.endsWith(".md"))
    .map((n) => n.slice(0, -".md".length))
    .filter((n) => n.length > 0 && !n.endsWith("-spec") && !n.endsWith("-spec-final"))
    .sort();
}

/** Lane names from the waybill's `workhorses: <lane>=…, <lane>=…` line, read only from its `## Team` section, so a quoted line elsewhere is not a lane. */
export function laneNamesFromWorkhorses(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##[ \t]+Team[ \t]*$/i.test(l));
  if (start < 0) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^##[ \t]+/i.test(l));
  const team = (end < 0 ? rest : rest.slice(0, end)).join("\n");
  const line = /^workhorses:[ \t]*(.*)$/im.exec(team)?.[1] ?? "";
  if (!line) return [];
  return line
    .split(",")
    .map((part) => part.split("=")[0].trim())
    .filter((n) => n.length > 0)
    .sort();
}

/** Lane names from wb/<ticket>-* refs (with or without the refs/heads/ prefix). */
export function laneNamesFromBranches(refs: string[], ticket: string): string[] {
  const prefix = `wb/${ticket}-`;
  return refs
    .map((r) => (r.startsWith("refs/heads/") ? r.slice("refs/heads/".length) : r))
    .filter((b) => b.startsWith(prefix))
    .map((b) => b.slice(prefix.length))
    .filter((n) => n.length > 0)
    .sort();
}

/** The union of every source, sorted and without duplicates. */
export function mergeLaneNames(...groups: string[][]): string[] {
  return [...new Set(groups.flat())].sort();
}

/** The harvested archive branch name coachman.md keeps for a lane. */
export function branchName(ticket: string, lane: string): string {
  return `wb/${ticket}-${lane}`;
}

/** Counts on a fixture.sh hidden report line, or null when it printed none. Only a full `hidden-tests` line counts: a counts-shaped fragment in noise is not a run, and reads as failed to build rather than as a pass. */
export function parseHiddenCounts(out: string): Counts | null {
  const rows = [...out.matchAll(/^\s*(?:ok|FAIL)\s+hidden-tests\s+[^:\r\n]+:\s*(\d+)\s+pass,\s*(\d+)\s+fail\s*$/gm)];
  const last = rows.at(-1);
  if (!last) return null;
  return { passed: Number(last[1]), failed: Number(last[2]) };
}

/** What fixture.sh hidden's output says about a lane's tree. */
export function hiddenStatusFromOutput(out: string): LaneStatus {
  const counts = parseHiddenCounts(out);
  if (counts) return { kind: "counts", passed: counts.passed, failed: counts.failed };
  return { kind: "failed-to-build" };
}

export function sortLaneEntries(entries: Array<[string, LaneStatus]>): Array<[string, LaneStatus]> {
  return [...entries].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

// --- edges ----------------------------------------------------------------------------

function die(message: string): never {
  console.error(`fixture-lanes: ${message}`);
  process.exit(1);
}

function sh(cmd: string[], cwd?: string): { code: number | null; out: string } {
  try {
    const proc = Bun.spawnSync({
      cmd,
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    const out = (proc.stdout ? new TextDecoder().decode(proc.stdout) : "") +
      (proc.stderr ? new TextDecoder().decode(proc.stderr) : "");
    return { code: proc.exitCode, out };
  } catch {
    return { code: null, out: "could not run" };
  }
}

function readText(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function ticketId(dispatch: string, waybill: string): string {
  return ticketIdFromWaybill(waybill) ?? basename(dispatch);
}

function discoverLanes(dispatch: string, repo: string, ticket: string, waybill: string, manifest: unknown): string[] {
  const fromManifest = laneNamesFromManifestLanes(
    manifest !== null && typeof manifest === "object" && !Array.isArray(manifest)
      ? (manifest as Record<string, unknown>).lanes
      : null,
  );
  const auditDir = join(dispatch, "audit");
  const fromAudit = isDir(auditDir)
    ? laneNamesFromAuditFiles(readdirSync(auditDir).sort())
    : [];
  const fromWaybill = laneNamesFromWorkhorses(waybill);
  const listed = sh(["git", "-C", repo, "for-each-ref", "--format=%(refname)", "refs/heads/wb/"]);
  const refs = listed.code === 0 ? listed.out.split(/\r?\n/).filter((r) => r.length > 0) : [];
  const fromBranches = laneNamesFromBranches(refs, ticket);
  return mergeLaneNames(fromManifest, fromAudit, fromWaybill, fromBranches);
}

function exportBranch(repo: string, ref: string, dest: string): boolean {
  const r = sh([
    "bash", "-o", "pipefail", "-c",
    'git -C "$1" archive --format=tar "$2" | tar -x -C "$3"',
    "export", repo, ref, dest,
  ]);
  return r.code === 0;
}

function branchExists(repo: string, ref: string): boolean {
  return sh(["git", "-C", repo, "rev-parse", "--verify", "-q", `refs/heads/${ref}^{commit}`]).code === 0;
}

function runHidden(fixtureSh: string, ticket: string, tree: string): LaneStatus {
  const r = sh([fixtureSh, "hidden", ticket, tree]);
  return hiddenStatusFromOutput(r.out);
}

function scoreLane(fixtureSh: string, repo: string, ticketId_: string, fixtureTicket: string, lane: string, scratch: string): LaneStatus {
  const ref = branchName(ticketId_, lane);
  if (!branchExists(repo, ref)) return { kind: "missing" };
  let dest: string;
  try {
    dest = mkdtempSync(join(scratch, "lane-"));
  } catch {
    return { kind: "failed-to-build" };
  }
  if (!exportBranch(repo, ref, dest)) return { kind: "failed-to-build" };
  return runHidden(fixtureSh, fixtureTicket, dest);
}

function main(argv: string[]): void {
  if (argv.length !== 3) die("usage: fixture-lanes.ts <dispatch> <repo> <fixture-ticket>");
  const [dispatch, repo, fixtureTicket] = argv;
  if (!isDir(dispatch)) die(`no such dispatch directory: ${dispatch}`);
  const waybill = readText(join(dispatch, "brief.md"));
  const manifest = readJson(join(dispatch, "manifest.json"));
  const ticket = ticketId(dispatch, waybill);
  const lanes = discoverLanes(dispatch, repo, ticket, waybill, manifest);
  const fixtureSh = join(import.meta.dir, "fixture.sh");
  const scratch = mkdtempSync(join(tmpdir(), "fixture-lanes-"));
  try {
    const entries: Array<[string, LaneStatus]> = lanes.map((lane) => [
      lane,
      scoreLane(fixtureSh, repo, ticket, fixtureTicket, lane, scratch),
    ]);
    const sorted = sortLaneEntries(entries);
    for (const [lane, status] of sorted) console.log(formatLane(lane, status));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  main(process.argv.slice(2));
}
