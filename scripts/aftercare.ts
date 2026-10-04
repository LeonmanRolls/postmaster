// Close a landed coachman-contract-2 run. All project writes happen through the
// existing action, tracker, stage and run-meta scripts; this file orders them.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { inspectLaunches, inspectPreviewLaunch, runWorktreePaths, stopPreviewLaunch } from "./host.ts";
import { run } from "./lib/proc.ts";
import { scriptsDir } from "./lib/paths.ts";

type StepStatus = "planned" | "done" | "already done" | "waiting" | "blocked" | "skipped";
type Step = { name: string; status: StepStatus; detail: string };
type Folder = {
  path: string;
  saves: string[];
  result: string;
  flagged: boolean;
  why: string[];
  snapshot?: string;
  kind?: "worktree" | "clone" | "other";
  locked?: boolean;
  closable?: boolean;
};
type Summary = {
  run: string;
  dry_run: boolean;
  outcome: string;
  steps: Step[];
  folders: Folder[];
  next: string;
};

type Args = { dispatch: string; dryRun: boolean; json: boolean; comment?: string; runLog?: string };
type RawResult = { code: number; out: Buffer; err: string };
type Part = { suffix: string; bytes: Buffer };
type Snapshot = { hash: string; parts: Part[]; flagged: string[]; status: string };
type WorktreeRecord = { path: string; locked: boolean };

class AftercareStop extends Error {
  constructor(
    readonly exitCode: 1 | 2 | 3,
    readonly step: string,
    readonly detail: string,
    readonly nextStep: string,
  ) {
    super(detail);
  }
}

function fail(step: string, detail: string, nextStep: string, exitCode: 1 | 2 | 3 = 1): never {
  throw new AftercareStop(exitCode, step, detail, nextStep);
}

function usage(): string {
  return "usage: bun <tool>/scripts/aftercare.ts <dispatch> [--dry-run] [--json] --comment <text> --run-log <text>";
}

function parseArgs(argv: string[]): Args {
  let dispatch = "";
  let dryRun = false;
  let json = false;
  let comment: string | undefined;
  let runLog: string | undefined;
  for (let at = 0; at < argv.length; at++) {
    const arg = argv[at]!;
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--json") json = true;
    else if (arg === "--comment" || arg === "--run-log") {
      const value = argv[++at];
      if (value === undefined || value.trim() === "")
        fail("arguments", `${arg} needs non-empty text`, usage());
      if (arg === "--comment") {
        if (comment !== undefined) fail("arguments", "--comment was given twice", usage());
        comment = value;
      } else {
        if (runLog !== undefined) fail("arguments", "--run-log was given twice", usage());
        runLog = value;
      }
    } else if (arg.startsWith("--")) fail("arguments", `unknown option ${arg}`, usage());
    else if (dispatch === "") dispatch = arg;
    else fail("arguments", `unexpected argument ${arg}`, usage());
  }
  if (!dispatch) fail("arguments", "dispatch is required", usage());
  return { dispatch, dryRun, json, ...(comment !== undefined ? { comment } : {}), ...(runLog !== undefined ? { runLog } : {}) };
}

function addStep(summary: Summary, name: string, status: StepStatus, detail: string): void {
  summary.steps.push({ name, status, detail });
}

function outputText(result: { out: string; err: string }): string {
  return `${result.out}${result.err}`.trim();
}

function lastLine(text: string): string {
  return text.trim().split(/\r?\n/u).at(-1) ?? "";
}

function canonical(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function readObject(path: string, step: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(step, `cannot read ${path}: ${String(error)}`, `Repair the run record, then rerun aftercare.`);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value))
    fail(step, `${path} is not a JSON object`, `Repair the run record, then rerun aftercare.`);
  return value as Record<string, unknown>;
}

function readActions(dispatch: string): Record<string, unknown>[] {
  const path = join(dispatch, "actions.jsonl");
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    fail("read action log", `cannot read ${path}: ${String(error)}`, "Repair the action log, then rerun aftercare.");
  }
  const actions: Record<string, unknown>[] = [];
  for (const [index, line] of text.split(/\r?\n/u).entries()) {
    if (!line) continue;
    let item: unknown;
    try {
      item = JSON.parse(line);
    } catch {
      fail("read action log", `${path} line ${index + 1} does not parse`, "Repair the action log, then rerun aftercare.");
    }
    if (item === null || typeof item !== "object" || Array.isArray(item))
      fail("read action log", `${path} line ${index + 1} is not an object`, "Repair the action log, then rerun aftercare.");
    actions.push(item as Record<string, unknown>);
  }
  return actions;
}

function hasAction(
  actions: Record<string, unknown>[],
  action: string,
  target: string,
  detailStarts: string,
): Record<string, unknown> | undefined {
  return actions.find(
    (item) =>
      item.actor === "postmaster" &&
      item.action === action &&
      item.target === target &&
      typeof item.detail === "string" &&
      item.detail.startsWith(detailStarts),
  );
}

function runScript(name: string, args: string[]) {
  return run("bash", [join(scriptsDir(import.meta), `${name}.sh`), ...args]);
}

function runBunScript(name: string, args: string[]) {
  return run("bun", ["--no-env-file", "--config=/dev/null", join(scriptsDir(import.meta), `${name}.ts`), ...args]);
}

function logAction(dispatch: string, action: string, target: string, detail: string): void {
  const result = runScript("log-action", [dispatch, "postmaster", action, target, detail]);
  if (result.code !== 0)
    fail("action log", `log-action.sh failed (${result.code}): ${outputText(result) || "no message"}`, "Stop and report the action-log fault to the user.");
}

function raw(cmd: string, args: string[], cwd: string, input?: Buffer): RawResult {
  const result = spawnSync(cmd, args, {
    cwd,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    input,
    maxBuffer: 128 * 1024 * 1024,
  });
  const error = result.error as NodeJS.ErrnoException | undefined;
  return {
    code: result.status ?? (error?.code === "ENOENT" ? 127 : 1),
    out: Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout ?? ""),
    err: Buffer.isBuffer(result.stderr)
      ? result.stderr.toString("utf8")
      : String(result.stderr ?? error?.message ?? ""),
  };
}

function gitText(cwd: string, args: string[], step: string): string {
  const result = raw("git", args, cwd);
  if (result.code !== 0)
    fail(step, `git ${args.join(" ")} failed in ${cwd} (${result.code}): ${result.err.trim() || "no message"}`, "Repair the repository or its records, then rerun aftercare.");
  return result.out.toString("utf8");
}

function gitBytes(cwd: string, args: string[], step: string): Buffer {
  const result = raw("git", args, cwd);
  if (result.code !== 0)
    fail(step, `git ${args.join(" ")} failed in ${cwd} (${result.code}): ${result.err.trim() || "no message"}`, "Repair the repository or its records, then rerun aftercare.");
  return result.out;
}

function parseWorktrees(repo: string): WorktreeRecord[] {
  const result = raw("git", ["-C", repo, "worktree", "list", "--porcelain", "-z"], repo);
  if (result.code !== 0)
    fail("discover run folders", `git worktree list failed in ${repo}: ${result.err.trim() || "no message"}`, "Repair the repository worktree records, then rerun aftercare.");
  const records: WorktreeRecord[] = [];
  let current: WorktreeRecord | undefined;
  for (const part of result.out.toString("utf8").split("\0")) {
    if (part === "") {
      if (current) records.push(current);
      current = undefined;
    } else if (part.startsWith("worktree ")) current = { path: canonical(part.slice(9)), locked: false };
    else if (part === "locked" && current) current.locked = true;
  }
  if (current) records.push(current);
  return records;
}

function repoFor(paths: string[], dispatch: string): string {
  const ticket = basename(dispatch);
  const synthesis = paths.find((path) => basename(path) === ticket);
  const candidate = synthesis ?? paths.at(-1);
  if (!candidate || basename(dirname(candidate)) !== ".worktrees")
    fail("discover run folders", "the synthesis folder does not resolve under a project .worktrees directory", "Repair the waybill's synthesis worktree, then rerun aftercare.");
  return dirname(dirname(candidate));
}

function addTicketFolders(repo: string, ticket: string, paths: string[]): string[] {
  const worktrees = join(repo, ".worktrees");
  let entries: string[];
  try {
    entries = readdirSync(worktrees);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [...new Set(paths)].sort();
    fail("discover run folders", `cannot list ${worktrees}: ${String(error)}`, "Repair the project's .worktrees directory, then rerun aftercare.");
  }
  const result = new Set(paths.map(canonical).filter((path) => {
    try {
      return lstatSync(path).isDirectory() && canonical(dirname(path)) === canonical(worktrees);
    } catch {
      return false;
    }
  }));
  for (const entry of entries) {
    if (!(entry === ticket || entry.startsWith(`${ticket}-`))) continue;
    const path = join(worktrees, entry);
    try {
      if (!lstatSync(path).isDirectory()) continue;
      if (canonical(dirname(path)) !== canonical(worktrees) || canonical(path) !== resolve(path)) continue;
    } catch {
      continue;
    }
    result.add(canonical(path));
  }
  return [...result].sort((a, b) => a.localeCompare(b));
}

function previouslyRemovedFolders(
  repo: string,
  ticket: string,
  actions: Record<string, unknown>[],
): string[] {
  const worktrees = canonical(join(repo, ".worktrees"));
  const result = new Set<string>();
  for (const item of actions) {
    if (item.action !== "teardown" || typeof item.target !== "string") continue;
    const path = resolve(item.target);
    if (canonical(dirname(path)) !== worktrees) continue;
    const name = basename(path);
    if (name === ticket || name.startsWith(`${ticket}-`)) result.add(path);
  }
  return [...result];
}

function projectBranchHeads(repo: string): string[] {
  const text = gitText(repo, ["-C", repo, "for-each-ref", "--format=%(objectname)", "refs/heads"], "read project branches");
  return text.split(/\r?\n/u).filter((line) => /^[0-9a-f]{40,64}$/iu.test(line));
}

function branchObjects(repo: string): Set<string> {
  const text = gitText(repo, ["-C", repo, "rev-list", "--branches", "--objects"], "read project branches");
  return new Set(text.split(/\r?\n/u).flatMap((line) => {
    const oid = line.split(" ", 1)[0];
    return oid && /^[0-9a-f]{40,64}$/iu.test(oid) ? [oid] : [];
  }));
}

function changedObjects(rawDiff: Buffer): Array<{ oid: string; path: string }> {
  const fields = rawDiff.toString("utf8").split("\0");
  const changes: Array<{ oid: string; path: string }> = [];
  for (let at = 0; at < fields.length; ) {
    const header = fields[at++] ?? "";
    if (!header) continue;
    const parsed = /^:(\d{6}) (\d{6}) ([0-9a-f]+) ([0-9a-f]+) ([A-Z][0-9]*)$/u.exec(header);
    if (!parsed) continue;
    const oldMode = parsed[1]!;
    const newMode = parsed[2]!;
    const oid = parsed[4]!;
    const status = parsed[5]!;
    const firstPath = fields[at++] ?? "";
    const newPath = status.startsWith("R") || status.startsWith("C") ? fields[at++] ?? "" : firstPath;
    if (newMode !== "000000" && /^(100|120)/u.test(newMode)) changes.push({ oid, path: newPath });
  }
  return changes;
}

function unmergedPaths(repo: string, path: string): string[] {
  const result = raw("git", ["-C", path, "ls-files", "-u", "-z"], repo);
  if (result.code !== 0)
    fail("inspect folder", `git ls-files -u failed in ${path}: ${result.err.trim() || "no message"}`, "Repair the worktree, then rerun aftercare.");
  return result.out.toString("utf8").split("\0").filter(Boolean).flatMap((entry) => {
    const tab = entry.indexOf("\t");
    return tab >= 0 ? [entry.slice(tab + 1)] : [];
  });
}

function unbranchedCommits(path: string, heads: string[]): string[] {
  const args = ["-C", path, "rev-list", "--reverse", "HEAD"];
  if (heads.length) args.push("--not", ...heads);
  const result = raw("git", args, path);
  if (result.code !== 0)
    fail("save folder", `cannot list unbranched commits in ${path}: ${result.err.trim() || "no message"}`, "Repair the worktree history, then rerun aftercare.");
  return result.out.toString("utf8").split(/\r?\n/u).filter((line) => /^[0-9a-f]{40,64}$/iu.test(line));
}

function archiveUntracked(path: string, names: Buffer): Buffer | null {
  if (names.length === 0) return null;
  const result = spawnSync("tar", ["-cf", "-", "--null", "-T", "-"], {
    cwd: path,
    input: names,
    maxBuffer: 128 * 1024 * 1024,
  });
  if (result.status !== 0)
    fail("save untracked files", `tar failed in ${path} (${result.status ?? 1}): ${String(result.stderr ?? "").trim() || "no message"}`, "Repair the untracked files or tar support, then rerun aftercare.");
  const archive = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout ?? "");
  return archive.length ? archive : null;
}

function snapshotFolder(path: string, repo: string, heads: string[], branchBlobIds: Set<string>): Snapshot {
  const status = gitBytes(path, ["-C", path, "status", "--short", "--untracked-files=all"], "inspect folder");
  const worktreeDiff = gitBytes(path, ["-C", path, "diff", "--binary", "--no-ext-diff"], "save folder");
  const indexDiff = gitBytes(path, ["-C", path, "diff", "--cached", "--binary", "--no-ext-diff"], "save folder");
  const untrackedNames = gitBytes(path, ["-C", path, "ls-files", "--others", "--exclude-standard", "-z"], "save untracked files");
  const untrackedArchive = archiveUntracked(path, untrackedNames);
  const commits = unbranchedCommits(path, heads);
  const parts: Part[] = [];
  if (status.length) parts.push({ suffix: "status", bytes: status });
  if (worktreeDiff.length) parts.push({ suffix: "worktree.diff", bytes: worktreeDiff });
  if (indexDiff.length) parts.push({ suffix: "index.diff", bytes: indexDiff });
  if (untrackedArchive?.length) parts.push({ suffix: "untracked.tar", bytes: untrackedArchive });
  const unbranchedDiffs: Buffer[] = [];
  for (const commit of commits) {
    const patch = raw("git", ["-C", path, "format-patch", "-1", "--stdout", "--binary", "--full-index", commit], path);
    if (patch.code !== 0)
      fail("save unbranched commits", `git format-patch failed for ${commit} in ${path}: ${patch.err.trim() || "no message"}`, "Repair the worktree history, then rerun aftercare.");
    if (patch.out.length) {
      unbranchedDiffs.push(patch.out);
      parts.push({ suffix: `commit-${commit.slice(0, 12)}.patch`, bytes: patch.out });
    }
  }

  const flagged = new Set<string>();
  for (const diff of [
    gitBytes(path, ["-C", path, "diff", "--cached", "--raw", "--no-abbrev", "-z"], "inspect folder"),
    gitBytes(path, ["-C", path, "diff", "--raw", "--no-abbrev", "-z"], "inspect folder"),
  ]) {
    for (const change of changedObjects(diff)) {
      let oid = change.oid;
      if (/^0+$/u.test(oid)) {
        oid = gitText(path, ["-C", path, "hash-object", `--path=${change.path}`, change.path], "inspect tracked content").trim();
      }
      if (!branchBlobIds.has(oid)) flagged.add(change.path);
    }
  }
  for (const commit of commits) {
    const diff = gitBytes(path, ["-C", path, "diff-tree", "--root", "-r", "--raw", "--no-abbrev", "-z", "--no-commit-id", commit], "inspect unbranched commits");
    for (const change of changedObjects(diff)) if (!branchBlobIds.has(change.oid)) flagged.add(change.path);
  }
  for (const unmerged of unmergedPaths(repo, path)) flagged.add(unmerged);

  const digest = createHash("sha256");
  for (const part of parts) {
    digest.update(part.suffix);
    digest.update("\0");
    digest.update(part.bytes);
    digest.update("\0");
  }
  return { hash: digest.digest("hex"), parts, flagged: [...flagged].sort(), status: status.toString("utf8") };
}

function slug(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "");
  return cleaned || "folder";
}

function saveSnapshot(dispatch: string, path: string, snapshot: Snapshot): string[] {
  if (snapshot.parts.length === 0) return [];
  const root = join(dispatch, "stray");
  mkdirSync(root, { recursive: true });
  const prefix = `${slug(basename(path))}-${snapshot.hash.slice(0, 16)}`;
  const saved: string[] = [];
  for (const part of snapshot.parts) {
    const target = join(root, `${prefix}.${part.suffix}`);
    if (existsSync(target)) {
      let previous: Buffer;
      try {
        previous = readFileSync(target);
      } catch (error) {
        fail("save folder", `cannot verify prior save ${target}: ${String(error)}`, "Keep the folder and report the save fault to the user.");
      }
      if (!previous.equals(part.bytes))
        fail("save folder", `prior save ${target} differs from the current snapshot`, "Keep the folder and report the save fault to the user.");
    } else {
      try {
        writeFileSync(target, part.bytes, { flag: "wx", mode: 0o600 });
      } catch (error) {
        fail("save folder", `cannot write ${target}: ${String(error)}`, "Keep the folder and report the save fault to the user.");
      }
    }
    saved.push(relativeToDispatch(dispatch, target));
  }
  return saved;
}

function relativeToDispatch(dispatch: string, path: string): string {
  return path.slice(dispatch.length + 1);
}

function findPriorSave(actions: Record<string, unknown>[], path: string, hash: string): Record<string, unknown> | undefined {
  return actions.find(
    (item) =>
      item.actor === "postmaster" &&
      item.action === "note" &&
      item.target === path &&
      typeof item.detail === "string" &&
      item.detail.startsWith(`aftercare save ${hash}`),
  );
}

function folderKind(path: string, repo: string, records: WorktreeRecord[]): { kind: "worktree" | "clone" | "other"; locked: boolean } {
  const found = records.find((record) => record.path === canonical(path));
  if (found) return { kind: "worktree", locked: found.locked };
  const result = runScript("cut-scratch", ["--kind", path]);
  if (result.code === 0 && result.out.startsWith("clone ") && canonical(result.out.trim().slice(6)) === canonical(repo))
    return { kind: "clone", locked: false };
  return { kind: "other", locked: false };
}

function isCallerFolder(path: string): boolean {
  const here = canonical(process.cwd());
  return here === path || here.startsWith(`${path}${sep}`);
}

function matchingPlacements(stateRoot: string, dispatch: string, paths: string[]): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const root = join(stateRoot, "placements");
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return found;
  }
  for (const entry of entries) {
    const file = join(root, entry);
    try {
      if (!statSync(file).isFile()) continue;
      const item = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
      if (!item || typeof item !== "object" || item.run !== dispatch || typeof item.cwd !== "string") continue;
      const cwd = canonical(item.cwd);
      const owner = paths.find((path) => cwd === path || cwd.startsWith(`${path}${sep}`));
      if (owner) found.set(owner, [...(found.get(owner) ?? []), `Herdr pane ${String(item.pane ?? "?")} in ${String(item.workspace ?? "?")}`]);
    } catch {
      continue;
    }
  }
  return found;
}

function activeTmuxPaths(dispatch: string, paths: string[]): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const result = run("tmux", ["list-windows", "-a", "-F", "#{window_id}\t#{@postmaster_cwd}\t#{@postmaster_run}"]);
  if (result.code !== 0) return found;
  for (const line of result.out.split(/\r?\n/u)) {
    const [window, cwd, runTag] = line.split("\t");
    if (!window || !cwd || runTag !== dispatch) continue;
    const owner = paths.find((path) => canonical(cwd) === path || canonical(cwd).startsWith(`${path}${sep}`));
    if (owner) found.set(owner, [...(found.get(owner) ?? []), `tmux window ${window}`]);
  }
  return found;
}

function combineOwners(...maps: Map<string, string[]>[]): Map<string, string[]> {
  const combined = new Map<string, string[]>();
  for (const map of maps)
    for (const [path, reasons] of map) combined.set(path, [...(combined.get(path) ?? []), ...reasons]);
  return combined;
}

function trackerKind(repo: string): string {
  const result = runScript("tracker-kind", [repo]);
  if (result.code !== 0)
    fail("identify ticket tracker", `tracker-kind.sh failed (${result.code}): ${outputText(result) || "no message"}`, "Repair the project's tracker configuration, then rerun aftercare.");
  return result.out.trim();
}

function ticketCommand(kind: string, repo: string, operation: string, ticket: string, tail: string[] = []) {
  if (kind === "local") return runScript("local", [repo, operation, ticket, ...tail]);
  if (kind === "github") return runScript("github", [repo, operation, ticket, ...tail]);
  if (kind === "plane") return runScript("plane", [operation, ticket, ...tail]);
  return { code: 0, out: "", err: "" };
}

function ticketState(kind: string, repo: string, ticket: string): { state: string; text: string } {
  const read = ticketCommand(kind, repo, "read", ticket);
  if (read.code !== 0)
    fail("ticket state", `could not read ticket #${ticket} (${read.code}): ${outputText(read) || "no message"}`, "Repair the ticket or tracker access, then rerun aftercare.", 3);
  const match = /^state: ([^\r\n]+)$/mu.exec(read.out);
  if (!match)
    fail("ticket state", `ticket #${ticket} read did not report a state`, "Repair the tracker adapter, then rerun aftercare.", 3);
  return { state: match[1]!.trim(), text: read.out };
}

function hasClosingComment(text: string, words: string): boolean {
  return text.split(/\r?\n/u).some((line) => line.includes(`postmaster: ${words}`));
}

function hasRunLogLine(dispatch: string, words: string): boolean {
  let text = "";
  try {
    text = readFileSync(join(dispatch, "run-log.md"), "utf8");
  } catch {
    return false;
  }
  return text.split(/\r?\n/u).some((line) => line.endsWith(`Z ${words}`) || line === words);
}

function pinState(run: Record<string, unknown>, dispatch: string): { path: string; exists: boolean; heldByOther: boolean } {
  const postmaster = run.postmaster;
  const checkout = postmaster && typeof postmaster === "object" ? (postmaster as Record<string, unknown>).checkout : undefined;
  if (typeof checkout !== "string" || !checkout) return { path: "", exists: false, heldByOther: false };
  const path = canonical(checkout);
  if (!existsSync(path)) return { path, exists: false, heldByOther: false };
  const claims = `${path}.claims`;
  let claimants: string[] = [];
  try {
    claimants = readFileSync(claims, "utf8").split(/\r?\n/u).filter(Boolean);
  } catch {
    return { path, exists: true, heldByOther: false };
  }
  for (const claimant of claimants) {
    if (canonical(claimant) === canonical(dispatch)) continue;
    try {
      const manifest = JSON.parse(readFileSync(join(claimant, "manifest.json"), "utf8")) as Record<string, unknown>;
      if (typeof manifest.stage === "string" && manifest.stage !== "done" && manifest.stage !== "abandoned")
        return { path, exists: true, heldByOther: true };
    } catch {
      return { path, exists: true, heldByOther: true };
    }
  }
  return { path, exists: true, heldByOther: false };
}

function lockPath(dispatch: string): string {
  return join(dispatch, ".aftercare.lock");
}

function checkLiveLock(dispatch: string): void {
  const path = lockPath(dispatch);
  if (!existsSync(path)) return;
  let owner: string;
  try {
    owner = readFileSync(path, "utf8").trim();
  } catch (error) {
    fail("serialize cleanup", `cannot inspect ${path}: ${String(error)}`, "Ask the user to inspect the cleanup lock before retrying.");
  }
  const pid = Number(owner);
  if (!Number.isSafeInteger(pid) || pid < 1) return;
  try {
    process.kill(pid, 0);
    fail("serialize cleanup", `another aftercare process is running as pid ${pid}`, `Wait for pid ${pid} to finish, then rerun aftercare.`);
  } catch (error) {
    if (error instanceof AftercareStop) throw error;
    if ((error as NodeJS.ErrnoException).code === "EPERM")
      fail("serialize cleanup", `another aftercare process is running as pid ${pid}`, `Wait for pid ${pid} to finish, then rerun aftercare.`);
  }
}

function acquireLock(dispatch: string): string {
  const path = lockPath(dispatch);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(path, "wx", 0o600);
      const value = `${process.pid}\n`;
      writeFileSync(fd, value);
      closeSync(fd);
      return path;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST")
        fail("serialize cleanup", `cannot create ${path}: ${String(error)}`, "Repair dispatch permissions, then rerun aftercare.");
      let owner = "unknown process";
      try {
        const pid = Number(readFileSync(path, "utf8").trim());
        if (Number.isSafeInteger(pid) && pid > 0) {
          process.kill(pid, 0);
          fail("serialize cleanup", `another aftercare process is running as pid ${pid}`, `Wait for pid ${pid} to finish, then rerun aftercare.`);
        }
      } catch (check) {
        if (check instanceof AftercareStop) throw check;
        owner = "a stale or unreadable lock";
      }
      try {
        unlinkSync(path);
      } catch {
        fail("serialize cleanup", `${owner} at ${path} cannot be cleared`, "Ask the user to inspect the lock, then rerun aftercare.");
      }
    }
  }
  fail("serialize cleanup", `could not acquire ${path}`, "Wait for the other aftercare process, then rerun.");
}

function releaseLock(path: string): void {
  try {
    unlinkSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      fail("release cleanup lock", `cannot remove ${path}: ${String(error)}`, "Ask the user to remove the stale lock after checking no aftercare process is running.");
  }
}

function addStopLine(summary: Summary, stop: AftercareStop): void {
  summary.outcome = stop.exitCode === 2 ? `not ready: ${stop.detail}` : stop.exitCode === 3 ? `stopped: ${stop.detail}` : `fault: ${stop.detail}`;
  summary.next = stop.nextStep;
  addStep(summary, stop.step, stop.exitCode === 2 ? "waiting" : "blocked", stop.detail);
}

function checkReady(dispatch: string, runRecord: Record<string, unknown>, manifest: Record<string, unknown>): { stage: string; leg: number; styleText: string } {
  if (runRecord.coachman_contract !== 2)
    fail("run contract", "run.json does not record coachman_contract: 2", "Use the legacy Stage G cleanup instructions for this run.");
  const stage = typeof manifest.stage === "string" ? manifest.stage : "";
  if (stage === "abandoned")
    fail("abandoning", "an abandoned run is outside aftercare", "Continue the user's abandoning steps in postmaster.md.");
  if (stage !== "shipped" && stage !== "done")
    fail("shipped stage", `manifest stage is '${stage || "missing"}', not shipped or done`, "Finish the landing check and set shipped with stage.sh, then rerun aftercare.", 2);
  const leg = manifest.leg;
  if (typeof leg !== "number" || !Number.isInteger(leg) || leg < 1 || leg > 2)
    fail("last leg", "manifest does not name a contract-2 leg", "Repair the manifest or use the legacy Stage G instructions.");
  if (!existsSync(join(dispatch, `.leg-${leg}-exited`)))
    fail("last leg exit", `the last leg ${leg} has no .leg-${leg}-exited marker`, `Wait for the coachman process to exit; if it is gone, return to Stage D and remount it.`, 2);
  const style = runBunScript("style-findings", ["check", dispatch]);
  if (style.code === 2)
    fail("style-sort check", outputText(style) || "style findings are not sorted", "Write or correct style-sort.md, make the check exit 0, then rerun aftercare.", 2);
  if (style.code !== 0)
    fail("style-sort check", `style-findings.sh check failed (${style.code}): ${outputText(style) || "no message"}`, "Repair the style-findings check or its records, then rerun aftercare.");
  return { stage, leg, styleText: lastLine(style.out) };
}

function classifyFolder(
  path: string,
  repo: string,
  records: WorktreeRecord[],
  heads: string[],
  branchBlobIds: Set<string>,
  dispatch: string,
  actions: Record<string, unknown>[],
  folder: Folder,
): Snapshot | undefined {
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    folder.result = "already gone";
    return undefined;
  }
  const classification = folderKind(path, repo, records);
  folder.kind = classification.kind;
  folder.locked = classification.locked;
  if (classification.kind === "other") {
    folder.result = "left in place";
    folder.why.push("not a worktree or repository clone");
    return undefined;
  }
  if (isCallerFolder(path)) {
    folder.result = "left in place";
    folder.why.push("the aftercare caller is working inside this folder");
    return undefined;
  }
  folder.closable = true;
  if (classification.locked) folder.why.push("git worktree is locked");
  const snapshot = snapshotFolder(path, repo, heads, branchBlobIds);
  folder.snapshot = snapshot.hash;
  folder.flagged = snapshot.flagged.length > 0;
  if (folder.flagged) folder.why.push(`tracked content not held by any branch: ${snapshot.flagged.join(", ")}`);
  const prior = findPriorSave(actions, path, snapshot.hash);
  if (prior) {
    const text = String(prior.detail ?? "");
    const marker = " paths=";
    const at = text.indexOf(marker);
    if (at >= 0) folder.saves = text.slice(at + marker.length).split(",").filter(Boolean);
  } else if (snapshot.parts.length) {
    folder.saves = snapshot.parts.map((part) => `stray/${slug(basename(path))}-${snapshot.hash.slice(0, 16)}.${part.suffix}`);
  }
  if (classification.locked) folder.result = "left in place";
  else folder.result = "pending";
  return snapshot;
}

function parseTicketAndWords(args: Args, actions: Record<string, unknown>[], dispatch: string, ticket: string): { commentDone: boolean; runLogDone: boolean } {
  const commentAction = hasAction(actions, "ticket-comment", ticket, "aftercare closing comment:");
  const runLogAction = hasAction(actions, "note", "run-log", "aftercare closing run-log:");
  const commentDone = !!commentAction;
  const runLogDone = !!runLogAction || (args.runLog !== undefined && hasRunLogLine(dispatch, args.runLog));
  if (!commentDone && args.comment === undefined)
    fail("closing words", "--comment text is required while the ticket comment is still outstanding", "Supply --comment <text> from the postmaster's approved closing words.");
  if (!runLogDone && args.runLog === undefined)
    fail("closing words", "--run-log text is required while the run-log line is still outstanding", "Supply --run-log <text> from the postmaster's approved closing line.");
  return { commentDone, runLogDone };
}

function describeSave(snapshot: Snapshot | undefined, folder: Folder): string {
  if (!snapshot || snapshot.parts.length === 0) return "no uncommitted, untracked or unbranched changes to save";
  if (folder.saves.length) return `save ${folder.saves.join(", ")}${folder.flagged ? `; flagged ${snapshot.flagged.join(", ")}` : ""}`;
  return `save ${snapshot.parts.map((part) => part.suffix).join(", ")}${folder.flagged ? `; flagged ${snapshot.flagged.join(", ")}` : ""}`;
}

async function execute(args: Args, summary: Summary): Promise<number> {
  let dispatch: string;
  try {
    dispatch = realpathSync(args.dispatch);
    if (!statSync(dispatch).isDirectory()) throw new Error("not a directory");
  } catch (error) {
    fail("dispatch", `cannot open ${args.dispatch}: ${String(error)}`, usage());
  }
  summary.run = basename(dispatch);
  const runRecord = readObject(join(dispatch, "run.json"), "read run contract");
  const manifest = readObject(join(dispatch, "manifest.json"), "read stage");
  const actions = readActions(dispatch);
  checkLiveLock(dispatch);
  const ticket = basename(dispatch);
  const words = parseTicketAndWords(args, actions, dispatch, ticket);
  const ready = checkReady(dispatch, runRecord, manifest);

  let runWorktrees: string[];
  try {
    runWorktrees = runWorktreePaths(dispatch);
  } catch (error) {
    fail("discover run folders", `host worktree records could not be read: ${String(error)}`, "Repair the waybill and run records, then rerun aftercare.");
  }
  const repo = repoFor(runWorktrees, dispatch);
  const allPaths = [...new Set([
    ...addTicketFolders(repo, ticket, runWorktrees),
    ...previouslyRemovedFolders(repo, ticket, actions),
  ])].sort((a, b) => a.localeCompare(b));
  const worktreeRecords = parseWorktrees(repo);
  const heads = projectBranchHeads(repo);
  const branchBlobIds = branchObjects(repo);
  const tracker = trackerKind(repo);
  const stateRoot = process.env.POSTMASTER_HOST_STATE ?? join(process.env.HOME ?? "", ".postmaster/host");
  const hostPaths = [...new Set([...allPaths, ...runWorktrees])];
  const placementOwners = combineOwners(matchingPlacements(stateRoot, dispatch, hostPaths), activeTmuxPaths(dispatch, hostPaths));
  const synthesis = runWorktrees.find((path) => basename(path) === ticket) ?? runWorktrees.at(-1)!;
  const previewFile = join(dispatch, "render", "preview.pid");
  const preview = inspectPreviewLaunch(previewFile, synthesis);
  const pin = pinState(runRecord, dispatch);
  const ticketPlan = tracker === "other" ? { state: "other", text: "" } : args.dryRun ? ticketState(tracker, repo, ticket) : { state: "pending", text: "" };

  const folders: Folder[] = allPaths.map((path) => ({ path, saves: [], result: "pending", flagged: false, why: [] }));
  summary.folders = folders;
  const snapshots = new Map<string, Snapshot>();
  for (const folder of folders) {
    const snapshot = classifyFolder(folder.path, repo, worktreeRecords, heads, branchBlobIds, dispatch, actions, folder);
    if (snapshot) snapshots.set(folder.path, snapshot);
  }
  const hasAnyExistingFolder = folders.some((folder) => folder.result !== "already gone");
  const runWindowsAlreadyClosed = !!hasAction(actions, "note", dispatch, "aftercare run windows closed");

  if (args.dryRun) {
    addStep(summary, "style-sort check", hasAction(actions, "note", "style-sort check", "aftercare style-sort check passed") ? "already done" : "planned", ready.styleText);
    if (preview.status !== "missing")
      addStep(summary, "preview server", preview.status === "running" ? "planned" : "skipped", preview.detail);
    for (const folder of folders) {
      const snapshot = snapshots.get(folder.path);
      const savedAlready = !!findPriorSave(actions, folder.path, snapshot?.hash ?? "");
      const gone = folder.result === "already gone";
      addStep(summary, `save ${basename(folder.path)}`, gone || savedAlready ? "already done" : "planned", gone ? "folder is already gone" : describeSave(snapshot, folder));
      if (gone) {
        addStep(summary, `close ${basename(folder.path)}`, "already done", "folder is already gone");
        continue;
      }
      const launches = inspectLaunches(folder.path);
      const placements = placementOwners.get(folder.path) ?? [];
      const blocked = folder.result === "left in place" || launches.length > 0;
      if (launches.length) folder.why.push(`running launch: ${launches.join(", ")}`);
      addStep(summary, `close ${basename(folder.path)}`, blocked ? "waiting" : "planned", launches.length ? `running launch: ${launches.join(", ")}` : placements.length ? `close recorded host windows: ${placements.join(", ")}` : "close this folder's host windows");
      if (blocked) folder.result = "would remain";
      else folder.result = "would remove";
    }
    const windowsStatus = runWindowsAlreadyClosed && !hasAnyExistingFolder ? "already done" : "planned";
    addStep(summary, "close run windows", windowsStatus, windowsStatus === "already done" ? "run windows were closed on an earlier aftercare pass" : "close remaining spaces and windows tagged for this run");
    for (const folder of folders) {
      if (folder.result === "already gone") addStep(summary, `remove ${basename(folder.path)}`, "already done", "folder is already gone");
      else {
        const blocked = folder.result === "would remain";
        addStep(summary, `remove ${basename(folder.path)}`, blocked ? "waiting" : "planned", blocked ? folder.why.join("; ") || "a launch or host window is still active" : "remove after its windows are closed");
      }
    }
    const waiting = folders.some((folder) => folder.result === "would remain");
    addStep(summary, "run-log line", words.runLogDone ? "already done" : waiting ? "waiting" : "planned", words.runLogDone ? "the closing line is already present" : String(args.runLog ?? ""));
    const state = tracker === "other" ? "other" : ticketPlan.state;
    addStep(summary, "ticket state", tracker === "other" ? "skipped" : state === "cancelled" ? "skipped" : state === "done" ? "already done" : waiting ? "waiting" : "planned", tracker === "other" ? "tracker has no adapter; postmaster handles it" : state === "cancelled" ? "cancelled; left so" : state === "done" ? "already done" : `set ${state} to done`);
    addStep(summary, "ticket comment", words.commentDone ? "already done" : waiting ? "waiting" : "planned", words.commentDone ? "the closing comment is already recorded" : String(args.comment ?? ""));
    addStep(summary, "stage done", ready.stage === "done" ? "already done" : waiting ? "waiting" : "planned", ready.stage === "done" ? "manifest already says done" : "set done after the closing steps");
    addStep(summary, "release pinned tool", !pin.exists ? "already done" : pin.heldByOther ? "skipped" : waiting ? "waiting" : "planned", !pin.exists ? "pin is already absent" : pin.heldByOther ? `another run uses ${pin.path}; run-meta.sh keeps it` : `release ${pin.path}`);
    const waitDetail = folders.filter((folder) => folder.result === "would remain").map((folder) => `${folder.path}: ${folder.why.join("; ") || "folder needs attention"}`).join("; ");
    summary.outcome = waiting ? `stopped: ${waitDetail}` : "dry run complete";
    summary.next = waiting ? "Resolve each listed folder or launch issue, then rerun aftercare with the same closing words." : "Run aftercare without --dry-run to perform the listed steps.";
    return waiting ? 3 : 0;
  }

  const lock = acquireLock(dispatch);
  try {
    // Recheck readiness under the lock so a concurrent state change cannot start a second cleanup.
    const lockedActions = readActions(dispatch);
    const latestManifest = readObject(join(dispatch, "manifest.json"), "read stage");
    const latestRun = readObject(join(dispatch, "run.json"), "read run contract");
    const latestReady = checkReady(dispatch, latestRun, latestManifest);
    const currentWords = parseTicketAndWords(args, lockedActions, dispatch, ticket);
    if (!hasAction(lockedActions, "note", "style-sort check", "aftercare style-sort check passed")) {
      logAction(dispatch, "note", "style-sort check", `aftercare style-sort check passed: ${latestReady.styleText}`);
      addStep(summary, "style-sort check", "done", latestReady.styleText);
    } else addStep(summary, "style-sort check", "already done", latestReady.styleText);
    if (preview.status === "running") {
      const stopped = await stopPreviewLaunch(previewFile, synthesis);
      if (stopped.code !== 0)
        fail("stop preview server", stopped.detail, "Stop or repair the recorded preview launch, then rerun aftercare.", 3);
      if (!hasAction(lockedActions, "note", "preview server", "aftercare preview"))
        logAction(dispatch, "note", "preview server", `aftercare preview: ${stopped.detail}`);
      addStep(summary, "preview server", "done", stopped.detail);
    } else if (preview.status === "unregistered") addStep(summary, "preview server", "skipped", preview.detail);
    else if (preview.status === "stopped") addStep(summary, "preview server", "already done", preview.detail);

    const closeStatus = new Map<string, boolean>();
    const blockedPaths = new Set<string>();
    for (const folder of folders) {
      if (folder.result === "already gone") {
        addStep(summary, `save ${basename(folder.path)}`, "already done", "folder is already gone");
        addStep(summary, `close ${basename(folder.path)}`, "already done", "folder is already gone");
        addStep(summary, `remove ${basename(folder.path)}`, "already done", "folder is already gone");
        closeStatus.set(folder.path, true);
        continue;
      }
      const snapshot = snapshots.get(folder.path);
      if (folder.kind === "other" || isCallerFolder(folder.path)) {
        const why = folder.why.join("; ") || "not a removable run folder";
        logAction(dispatch, "note", folder.path, `aftercare left: ${why}`);
        addStep(summary, `save ${basename(folder.path)}`, "skipped", why);
        addStep(summary, `close ${basename(folder.path)}`, "skipped", "folder is left in place");
        addStep(summary, `remove ${basename(folder.path)}`, "blocked", why);
        blockedPaths.add(folder.path);
        closeStatus.set(folder.path, false);
        continue;
      }
      if (folder.locked) {
        const why = "git worktree is locked";
        if (snapshot?.parts.length) {
          const prior = findPriorSave(lockedActions, folder.path, snapshot.hash);
          if (!prior) {
            const saved = saveSnapshot(dispatch, folder.path, snapshot);
            folder.saves = saved;
            logAction(dispatch, "note", folder.path, `aftercare save ${snapshot.hash} paths=${saved.join(",")}`);
          }
        }
        logAction(dispatch, "note", folder.path, `aftercare left: ${why}`);
        addStep(summary, `save ${basename(folder.path)}`, snapshot?.parts.length ? "done" : "already done", describeSave(snapshot, folder));
        addStep(summary, `close ${basename(folder.path)}`, "skipped", why);
        addStep(summary, `remove ${basename(folder.path)}`, "blocked", why);
        blockedPaths.add(folder.path);
        closeStatus.set(folder.path, false);
        continue;
      }
      if (snapshot?.parts.length) {
        const prior = findPriorSave(lockedActions, folder.path, snapshot.hash);
        if (!prior) {
          const saved = saveSnapshot(dispatch, folder.path, snapshot);
          folder.saves = saved;
          logAction(dispatch, "note", folder.path, `aftercare save ${snapshot.hash} paths=${saved.join(",")} ${folder.flagged ? `flagged=${snapshot.flagged.join(",")}` : ""}`.trim());
          addStep(summary, `save ${basename(folder.path)}`, "done", describeSave(snapshot, folder));
        } else addStep(summary, `save ${basename(folder.path)}`, "already done", describeSave(snapshot, folder));
      } else addStep(summary, `save ${basename(folder.path)}`, "already done", "no uncommitted, untracked or unbranched changes to save");

      const close = runScript("host", ["close", folder.path]);
      if (close.code !== 0) {
        const detail = outputText(close) || `host.sh close ${folder.path} exited ${close.code} without a message`;
        folder.result = "left in place";
        folder.why.push(detail);
        blockedPaths.add(folder.path);
        closeStatus.set(folder.path, false);
        logAction(dispatch, "note", folder.path, `aftercare left: close folder: ${detail}`);
        addStep(summary, `close ${basename(folder.path)}`, "blocked", detail);
      } else {
        closeStatus.set(folder.path, true);
        if (!hasAction(lockedActions, "note", folder.path, "aftercare windows closed"))
          logAction(dispatch, "note", folder.path, "aftercare windows closed");
        addStep(summary, `close ${basename(folder.path)}`, "done", lastLine(close.out) || "host windows closed");
      }
    }

    const closeRunAlready = runWindowsAlreadyClosed && !hasAnyExistingFolder;
    if (closeRunAlready) {
      addStep(summary, "close run windows", "already done", "run windows were closed on an earlier aftercare pass");
    } else {
      const closeRun = runScript("host", ["close-run", dispatch]);
      if (closeRun.code !== 0) {
      const detail = outputText(closeRun) || `host.sh close-run ${dispatch} exited ${closeRun.code} without a message`;
      const owners = [...placementOwners.keys()].filter((path) => folders.some((folder) => folder.path === path && folder.result !== "already gone"));
      const failureText = closeRun.err.trim() || detail;
      const namedPaths = folders.filter((folder) => {
        if (folder.result === "already gone") return false;
        const escaped = folder.path.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
        return new RegExp(`(?:^|[\\s:])${escaped}(?=$|[\\s:;,])`, "u").test(failureText);
      }).map((folder) => folder.path);
      const knownBlocked = [...new Set([...owners, ...namedPaths, ...blockedPaths])];
      if (knownBlocked.length) for (const path of knownBlocked) blockedPaths.add(path);
      else {
        for (const folder of folders) {
          if (folder.result === "already gone") continue;
          folder.result = "left in place";
          folder.why.push("run windows could not be confirmed closed");
        }
      }
      logAction(dispatch, "note", dispatch, `aftercare left: close run windows: ${detail}`);
      addStep(summary, "close run windows", "blocked", detail);
      if (knownBlocked.length === 0)
        fail("close run windows", detail, "Repair or close the run's host spaces and windows, then rerun aftercare.", 3);
      } else {
        if (!hasAction(lockedActions, "note", dispatch, "aftercare run windows closed"))
          logAction(dispatch, "note", dispatch, "aftercare run windows closed");
        addStep(summary, "close run windows", "done", lastLine(closeRun.out) || "run windows closed");
      }
    }

    for (const folder of folders) {
      if (folder.result === "already gone") continue;
      if (blockedPaths.has(folder.path) || closeStatus.get(folder.path) !== true) {
        if (folder.result !== "left in place") folder.result = "left in place";
        if (!folder.why.length) folder.why.push("run window could not be confirmed closed");
        addStep(summary, `remove ${basename(folder.path)}`, "blocked", folder.why.join("; "));
        continue;
      }
      const remove = folder.kind === "clone"
        ? runScript("cut-scratch", ["--remove", repo, folder.path])
        : run("git", ["-C", repo, "worktree", "remove", "--force", folder.path]);
      if (remove.code !== 0 || existsSync(folder.path)) {
        const detail = outputText(remove) || `removal exited ${remove.code} and ${folder.path} remains`;
        folder.result = "left in place";
        folder.why.push(detail);
        logAction(dispatch, "note", folder.path, `aftercare left: remove folder: ${detail}`);
        addStep(summary, `remove ${basename(folder.path)}`, "blocked", detail);
        continue;
      }
      folder.result = "removed";
      const detail = folder.flagged ? `saved and removed; flagged tracked work: ${folder.why.join("; ")}` : `saved and removed; saves=${folder.saves.join(",") || "none"}`;
      logAction(dispatch, "teardown", folder.path, `aftercare ${detail}`);
      addStep(summary, `remove ${basename(folder.path)}`, "done", detail);
    }

    const remaining = folders.filter((folder) => folder.result === "left in place" || folder.result === "would remain");
    if (remaining.length) {
      const detail = remaining.map((folder) => `${folder.path}: ${folder.why.join("; ") || "could not be removed"}`).join("; ");
      fail("folder teardown", `run folders remain: ${detail}`, "Resolve each named folder or window issue, then rerun aftercare with the same closing words.", 3);
    }

    const refreshedActions = readActions(dispatch);
    const runLogAlready = currentWords.runLogDone || hasAction(refreshedActions, "note", "run-log", "aftercare closing run-log:") || (args.runLog !== undefined && hasRunLogLine(dispatch, args.runLog));
    if (!runLogAlready && args.runLog !== undefined) {
      const wrote = runScript("run-log", [dispatch, args.runLog]);
      if (wrote.code !== 0)
        fail("run-log line", `run-log.sh failed (${wrote.code}): ${outputText(wrote) || "no message"}`, "Repair run-log.md permissions or records, then rerun aftercare.", 3);
      logAction(dispatch, "note", "run-log", `aftercare closing run-log: ${args.runLog}`);
      addStep(summary, "run-log line", "done", args.runLog);
    } else {
      if (!hasAction(refreshedActions, "note", "run-log", "aftercare closing run-log:") && args.runLog !== undefined && hasRunLogLine(dispatch, args.runLog))
        logAction(dispatch, "note", "run-log", `aftercare closing run-log: ${args.runLog}`);
      addStep(summary, "run-log line", "already done", "the closing line is already present");
    }

    let trackerState = "other";
    let trackerText = "";
    if (tracker !== "other") {
      const state = ticketState(tracker, repo, ticket);
      trackerState = state.state;
      trackerText = state.text;
      if (trackerState === "cancelled") addStep(summary, "ticket state", "skipped", "ticket is cancelled; left so");
      else if (trackerState === "done") {
        const stateActions = readActions(dispatch);
        if (!hasAction(stateActions, "ticket-state", ticket, "done"))
          logAction(dispatch, "ticket-state", ticket, "done (already done)");
        addStep(summary, "ticket state", "already done", "ticket already says done");
      }
      else if (["todo", "in-progress", "blocked"].includes(trackerState)) {
        const set = ticketCommand(tracker, repo, "state", ticket, ["done"]);
        if (set.code !== 0)
          fail("ticket state", `could not set ticket #${ticket} to done (${set.code}): ${outputText(set) || "no message"}`, "Repair the ticket or tracker access, then rerun aftercare.", 3);
        logAction(dispatch, "ticket-state", ticket, "done");
        addStep(summary, "ticket state", "done", `changed ${trackerState} to done`);
      } else fail("ticket state", `ticket #${ticket} has unknown state '${trackerState}'`, "Ask the user to resolve the ticket state, then rerun aftercare.", 3);
    } else addStep(summary, "ticket state", "skipped", "tracker has no adapter; postmaster handles it");

    if (tracker === "other") addStep(summary, "ticket comment", "skipped", "tracker has no adapter; postmaster handles it");
    else if (currentWords.commentDone) addStep(summary, "ticket comment", "already done", "the closing comment is already recorded");
    else if (args.comment !== undefined) {
      if (!hasClosingComment(trackerText, args.comment)) {
        const posted = ticketCommand(tracker, repo, "comment", ticket, ["postmaster", args.comment]);
        if (posted.code !== 0)
          fail("ticket comment", `could not post closing comment to #${ticket} (${posted.code}): ${outputText(posted) || "no message"}`, "Repair the ticket or tracker access, then rerun aftercare.", 3);
      }
      logAction(dispatch, "ticket-comment", ticket, `aftercare closing comment: ${args.comment}`);
      addStep(summary, "ticket comment", "done", hasClosingComment(trackerText, args.comment) ? "the closing comment was already present" : args.comment);
    }

    const stageNow = String(readObject(join(dispatch, "manifest.json"), "read stage").stage ?? "");
    if (stageNow === "done") addStep(summary, "stage done", "already done", "manifest already says done");
    else {
      const done = runScript("stage", [dispatch, "done", "postmaster"]);
      if (done.code !== 0)
        fail("stage done", `stage.sh failed (${done.code}): ${outputText(done) || "no message"}`, "Repair the stage transition, then rerun aftercare.", 3);
      addStep(summary, "stage done", "done", "run marked done; stage.sh recorded the transition");
    }

    const pinNow = pinState(readObject(join(dispatch, "run.json"), "read run contract"), dispatch);
    if (!pinNow.exists) addStep(summary, "release pinned tool", "already done", pinNow.path ? `pin already absent at ${pinNow.path}` : "run has no pinned tool");
    else {
      const release = runScript("run-meta", ["release", dispatch]);
      if (release.code !== 0)
        fail("release pinned tool", `run-meta.sh release failed (${release.code}): ${outputText(release) || "no message"}`, "Repair the pin claim or worktree, then rerun aftercare.", 3);
      const detail = outputText(release) || `run-meta.sh release completed for ${pinNow.path}`;
      const previously = hasAction(refreshedActions, "teardown", pinNow.path, "aftercare pin ");
      if (detail.includes("removed") && !previously)
        logAction(dispatch, "teardown", pinNow.path, `aftercare pin ${detail}`);
      else if (detail.includes("kept") && !hasAction(refreshedActions, "note", pinNow.path, "aftercare pin retained:"))
        logAction(dispatch, "note", pinNow.path, `aftercare pin retained: ${detail}`);
      addStep(summary, "release pinned tool", detail.includes("kept") ? "skipped" : "done", detail);
    }

    summary.outcome = "done";
    const unregistered = preview.status === "unregistered"
      ? " Inspect the unregistered preview PID named above and stop it only after confirming it belongs to this run."
      : "";
    summary.next = `Put flagged folders, style proposals and tool faults to the user, then archive finished threads.${unregistered}`;
    return 0;
  } finally {
    releaseLock(lock);
  }
}

function printSummary(summary: Summary, json: boolean, diagnostic?: AftercareStop): void {
  if (json) {
    if (diagnostic) {
      process.stderr.write(`aftercare: step ${diagnostic.step}: ${diagnostic.detail}\n`);
      process.stderr.write(`aftercare: next: ${diagnostic.nextStep}\n`);
    }
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    return;
  }
  process.stdout.write(`aftercare: run ${summary.run || "unknown"}: ${summary.outcome}\n`);
  for (const step of summary.steps)
    process.stdout.write(`- ${step.name}: ${step.status} — ${step.detail}\n`);
  for (const folder of summary.folders) {
    process.stdout.write(`- folder ${folder.path}: ${folder.result}; saves=${folder.saves.join(",") || "none"}${folder.flagged ? `; flagged ${folder.why.join("; ")}` : ""}\n`);
  }
  if (diagnostic) {
    process.stderr.write(`aftercare: step ${diagnostic.step}: ${diagnostic.detail}\n`);
    process.stderr.write(`aftercare: next: ${diagnostic.nextStep}\n`);
  }
  process.stdout.write(`next: ${summary.next}\n`);
}

async function main(): Promise<void> {
  let args: Args | undefined;
  let json = process.argv.includes("--json");
  let dryRun = process.argv.includes("--dry-run");
  const summary: Summary = { run: "", dry_run: dryRun, outcome: "fault", steps: [], folders: [], next: "" };
  let diagnostic: AftercareStop | undefined;
  let exitCode = 0;
  try {
    args = parseArgs(process.argv.slice(2));
    json = args.json;
    dryRun = args.dryRun;
    summary.dry_run = dryRun;
    exitCode = await execute(args, summary);
  } catch (error) {
    if (error instanceof AftercareStop) {
      diagnostic = error;
      addStopLine(summary, error);
      exitCode = error.exitCode;
    } else {
      const detail = String((error as Error)?.message ?? error);
      diagnostic = new AftercareStop(1, "aftercare command", detail, "Stop and report this command fault to the user.");
      addStopLine(summary, diagnostic);
      exitCode = 1;
    }
  }
  printSummary(summary, json, diagnostic);
  process.exitCode = exitCode;
}

if (import.meta.main) await main();
