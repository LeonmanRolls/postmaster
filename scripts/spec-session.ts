// Prepare the interactive spec session brief and commit only the user's approved spec text.
//
//   spec-session.sh brief <dispatch>
//   spec-session.sh approve <dispatch>
//
// The brief is private run state under .postmaster. Approval records the one run-level
// decision through spec-decisions.sh after committing changed text in the synthesis worktree.
import {
  lstatSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { scriptsDir } from "./lib/paths.ts";
import { die, run } from "./lib/proc.ts";

const HERE = scriptsDir(import.meta);
const DECISIONS = join(HERE, "spec-decisions.sh");
const REVIEW_LINK = join(HERE, "spec-review-link.sh");
const SPEC = "WORKHORSE-SPEC.md";

interface RunManifest {
  lanes?: Record<string, unknown>;
}

interface WaybillContext {
  ticket: string;
  synthesisWorktree: string;
  tool: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readUtf8(path: string): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path));
}

function readJson(path: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readUtf8(path));
  } catch (error) {
    die(`spec-session: cannot read ${label} at ${path} (${errorMessage(error)})`, 1);
  }
  if (!isRecord(parsed)) die(`spec-session: ${label} must be an object`, 1);
  return parsed;
}

function section(text: string, title: string): string {
  const start = text.indexOf(`## ${title}\n`);
  if (start < 0) return "";
  const bodyStart = start + title.length + 4;
  const next = text.indexOf("\n## ", bodyStart);
  return (next < 0 ? text.slice(bodyStart) : text.slice(bodyStart, next)).replace(/\s+$/u, "");
}

function ticketSection(text: string): string {
  const start = text.indexOf("## Ticket\n");
  if (start < 0) return "";
  const bodyStart = start + "## Ticket\n".length;
  const next = text.indexOf("\n## Project profile\n", bodyStart);
  return (next < 0 ? text.slice(bodyStart) : text.slice(bodyStart, next)).replace(/\s+$/u, "");
}

function field(text: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = text.match(new RegExp(`^${escaped}:[ \\t]*(.+?)[ \\t]*$`, "mu"));
  return match?.[1] ?? "";
}

function readWaybill(dispatch: string): WaybillContext {
  const waybillPath = join(dispatch, "brief.md");
  let text: string;
  try {
    text = readUtf8(waybillPath);
  } catch (error) {
    die(`spec-session: cannot read ${waybillPath} (${errorMessage(error)})`, 1);
  }
  const dispatchSection = section(text, "Dispatch");
  const synthesisWorktree = field(dispatchSection, "synthesis worktree");
  const tool = field(dispatchSection, "tool");
  const ticket = ticketSection(text);
  if (!ticket) die(`spec-session: ${waybillPath} has no ticket`, 1);
  if (!synthesisWorktree || !tool)
    die(`spec-session: ${waybillPath} must name the synthesis worktree and tool in Dispatch`, 1);
  return { ticket, synthesisWorktree: resolve(synthesisWorktree), tool: resolve(tool) };
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isRegularFile(path: string): boolean {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

function isDirectory(path: string): boolean {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

function repoFromDispatch(dispatch: string): string {
  const resolved = resolve(dispatch);
  if (basename(dirname(dirname(resolved))) !== ".postmaster" || basename(dirname(resolved)) !== "runs")
    die(`spec-session: dispatch must be under <repo>/.postmaster/runs/<ticket>: ${resolved}`, 1);
  return dirname(dirname(dirname(resolved)));
}

function validatedSynthesisWorktree(dispatch: string, waybill: WaybillContext): string {
  const repo = repoFromDispatch(dispatch);
  const expected = resolve(repo, ".worktrees", basename(dispatch));
  const actual = resolve(waybill.synthesisWorktree);
  if (actual !== expected)
    die(`spec-session: synthesis worktree must be ${expected}, got ${actual}`, 1);
  return actual;
}

function runCommand(command: string, args: string[], label: string, cwd?: string) {
  const result = run(command, args, cwd === undefined ? {} : { cwd });
  if (result.code !== 0) {
    const error = result.err ? `: ${result.err.trimEnd()}` : "";
    die(`spec-session: ${label} failed (exit ${result.code})${error}`, 1);
  }
  return result;
}

function laneDrafts(dispatch: string, synthesisWorktree: string): string[] {
  const manifest = readJson(join(dispatch, "manifest.json"), "manifest") as RunManifest;
  if (manifest.lanes !== undefined && !isRecord(manifest.lanes))
    die("spec-session: manifest lanes must be an object", 1);
  const ticket = basename(dispatch);
  const worktrees = dirname(synthesisWorktree);
  const lanes = Object.entries(manifest.lanes ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const drafts: string[] = [];
  for (const [lane, value] of lanes) {
    if (!/^[A-Za-z0-9._-]+$/u.test(lane)) die(`spec-session: invalid lane name in manifest: ${lane}`, 1);
    if (!isRecord(value)) die(`spec-session: manifest lane ${lane} must be an object`, 1);
    const worktree = resolve(worktrees, `${ticket}-${lane}`);
    if (dirname(worktree) !== resolve(worktrees)) die(`spec-session: invalid worktree for lane ${lane}`, 1);
    const draft = join(worktree, SPEC);
    if (!isRegularFile(draft)) continue;
    const logged = runCommand(
      "git",
      ["-C", worktree, "log", "-1", "--format=%H", "--", SPEC],
      `read ${lane}'s spec commit`,
    );
    const commit = logged.out.trim() || "uncommitted";
    const contents = readUtf8(draft).replace(/\s+$/u, "");
    const indented = contents.split("\n").map((line) => `  ${line}`).join("\n");
    drafts.push(
      `- ${lane}: commit \`${commit}\`; file \`${realpathSync(draft)}\`\n\n  Draft text:\n\n${indented}`,
    );
  }
  return drafts;
}

function preferencesText(): string {
  const config = process.env.POSTMASTER_CONFIG || join(homedir(), ".postmaster", "config.toml");
  const preferences = join(dirname(resolve(config)), "preferences.md");
  if (!isFile(preferences)) return "None are set.";
  try {
    return readUtf8(preferences);
  } catch (error) {
    die(`spec-session: cannot read standing preferences at ${preferences} (${errorMessage(error)})`, 1);
  }
}

function brief(dispatchArg: string): void {
  const dispatch = realpathSync(dispatchArg);
  const waybill = readWaybill(dispatch);
  const synthesisWorktree = validatedSynthesisWorktree(dispatch, waybill);
  const reviewDirectory = join(dispatch, "spec-review");
  if (!isDirectory(reviewDirectory) || realpathSync(reviewDirectory) !== reviewDirectory)
    die(`spec-session: review directory must be a regular directory at ${reviewDirectory}`, 1);
  const reviewCopy = join(reviewDirectory, SPEC);
  if (!isRegularFile(reviewCopy)) die(`spec-session: no regular reviewed spec at ${reviewCopy}`, 1);
  const copyPath = realpathSync(reviewCopy);
  const link = runCommand(REVIEW_LINK, [dispatch, reviewDirectory], "build spec link").out.trimEnd();
  const drafts = laneDrafts(dispatch, synthesisWorktree);
  const draftText = drafts.length > 0 ? drafts.join("\n") : "There are no lane drafts.";
  const prefs = preferencesText();
  const runbook = join(waybill.tool, "skills", "postmaster", "spec-session.md");
  const content = [
    `# Spec session: ${basename(dispatch)}`,
    "",
    "## Ticket",
    waybill.ticket,
    "",
    "## Spec under review",
    `Editor link: ${link}`,
    `Copy to edit: ${copyPath}`,
    "",
    "## Lane drafts",
    draftText,
    "",
    "## User's standing preferences",
    prefs,
    "",
    "## Session rules",
    [
      `Read the runbook at ${runbook}.`,
      "Edit only the spec copy above. Do not commit, resume, stop, or message the run or another session.",
      "Work with the user until they say the spec is ready, then tell them to tell the postmaster.",
    ].join(" "),
    "",
  ].join("\n");
  writeFileSync(join(dispatch, "spec-session-brief.md"), content, { encoding: "utf8" });
  console.log(join(dispatch, "spec-session-brief.md"));
}

function statusEntries(worktree: string): string[] {
  const result = runCommand(
    "git",
    ["-C", worktree, "status", "--porcelain", "--untracked-files=all"],
    "check synthesis worktree",
  );
  return result.out.split("\n").filter((line) => line !== "");
}

function commitForSpec(worktree: string): string {
  const result = runCommand(
    "git",
    ["-C", worktree, "log", "-1", "--format=%H", "--", SPEC],
    "read approved spec commit",
  );
  const commit = result.out.trim();
  if (!commit) die(`spec-session: no commit contains ${SPEC} in ${worktree}`, 1);
  return commit;
}

function approve(dispatchArg: string): void {
  const dispatch = realpathSync(dispatchArg);
  const waybill = readWaybill(dispatch);
  const synthesisWorktree = validatedSynthesisWorktree(dispatch, waybill);
  const entries = statusEntries(synthesisWorktree);
  if (entries.length > 0)
    die(`spec-session: synthesis worktree has changes; approval refused:\n${entries.join("\n")}`, 1);

  const rootSpec = join(synthesisWorktree, SPEC);
  const reviewCopy = join(dispatch, "spec-review", SPEC);
  if (!isRegularFile(rootSpec))
    die(`spec-session: no regular ${SPEC} in synthesis worktree`, 1);
  if (!isRegularFile(reviewCopy))
    die(`spec-session: no regular reviewed spec at ${reviewCopy}`, 1);
  const rootText = readFileSync(rootSpec);
  const reviewedText = readFileSync(reviewCopy);
  let commit = commitForSpec(synthesisWorktree);
  if (!rootText.equals(reviewedText)) {
    writeFileSync(rootSpec, reviewedText);
    runCommand("git", ["-C", synthesisWorktree, "add", "--", SPEC], "stage approved spec");
    runCommand(
      "git",
      ["-C", synthesisWorktree, "commit", "-m", "Approve shared workhorse spec"],
      "commit approved spec",
    );
    commit = commitForSpec(synthesisWorktree);
  }
  runCommand(DECISIONS, [dispatch, "record", "approved", commit], "record spec approval");
  console.log(commit);
}

function usage(): never {
  console.error("usage: spec-session.sh brief|approve <dispatch>");
  process.exit(1);
  throw new Error("unreachable");
}

const argv = process.argv.slice(2);
if (argv.length !== 2 || !argv[1]) usage();
if (argv[0] === "brief") brief(argv[1]!);
else if (argv[0] === "approve") approve(argv[1]!);
else usage();
