// The spec session's two verbs: brief writes the interactive session's brief, and approve
// commits the text the user approved and records the approval.
//
//   run spec-session brief <dispatch>
//   run spec-session approve <dispatch>
//
// brief writes <dispatch>/spec-session-brief.md and prints its path. The brief holds the
// ticket as the waybill carries it; the editor link and the path of the copy under review
// (<dispatch>/spec-review/WORKHORSE-SPEC.md); the lanes' drafts by commit, with the draft
// text, where the run has any, or a line saying there are none; the user's standing
// preferences, copied word for
// word from an optional preferences.md beside the machine config, or a line saying none are
// set; and the path of the session's runbook. The brief is never committed.
//
// approve reads the copy and commits it as WORKHORSE-SPEC.md in the synthesis worktree when
// it differs from what is committed there, and commits nothing when it does not. It refuses
// when the synthesis worktree holds any change other than the spec itself, and when the
// spec it holds matches neither the committed spec nor the copy. It then records
// approved at the resulting commit through spec-decisions and prints that commit.
//
//   exit 0  done; brief and approve print a path or a commit
//   exit 1  usage, no such dispatch, a missing waybill or copy, or a commit that failed
//   exit 2  a refusal: the synthesis worktree holds another change or a stray spec edit,
//           or the copy is missing
import { spawnSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { scriptsDir, toolRoot } from "./lib/paths.ts";
import { die } from "./lib/proc.ts";
import { pyTrim } from "./lib/text.ts";

const HERE = scriptsDir(import.meta);
const TOOL = toolRoot(import.meta);

// --- helpers --------------------------------------------------------------------------------
function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function readStrict(path: string): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path));
}

function git(cwd: string, ...args: string[]): { code: number; out: string; err: string } {
  const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", timeout: 15_000 });
  return { code: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

interface Waybill {
  ticket: string;
  repo: string;
  name: string;
  synthesis: string;
}

function readWaybill(dispatch: string): Waybill {
  const path = join(dispatch, "brief.md");
  let text: string;
  try {
    text = readStrict(path);
  } catch (e: unknown) {
    die(`spec-session: cannot read ${path} (${errMsg(e)})`, 1);
  }
  const w: Waybill = { ticket: "", repo: "", name: "", synthesis: "" };
  const lines = text.split("\n");
  let section = "";
  let ticketLines: string[] = [];
  let inTicket = false;
  // The ticket body is verbatim and may hold `##` headers of its own, even a fenced
  // example of this very template; only these top-level sections end it. The real
  // Project profile is the last one in the file: nothing after the real sections is
  // verbatim, so no fake header can follow it. Keys stay last-wins below, so a fake
  // header inside the ticket never survives the real section.
  const after = new Set(["Project profile", "Team", "Dispatch"]);
  let ticketEnd = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    const probe = lines[i]!;
    if (probe.startsWith("## ") && probe.slice(3).trim() === "Project profile") {
      ticketEnd = i;
      break;
    }
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith("## ")) {
      const next = line.slice(3).trim();
      if (inTicket) {
        if (ticketEnd >= 0 ? i === ticketEnd : after.has(next)) {
          inTicket = false;
          section = next;
        } else {
          ticketLines.push(line);
        }
        continue;
      }
      section = next;
      inTicket = next === "Ticket";
      if (inTicket) ticketLines = [];
      continue;
    }
    if (inTicket) {
      ticketLines.push(line);
      continue;
    }
    if (section === "Project profile" && line.startsWith("repo:")) {
      // The path runs to the first run of two or more spaces, as run tool-faults
      // reads it, so a path holding single spaces survives.
      const rest = pyTrim(line.slice(5));
      const m = rest.match(/^([^ \t].*?)(?:[ \t]{2,}.*)?$/u);
      w.repo = m ? pyTrim(m[1]!) : "";
    } else if (section === "Dispatch") {
      if (line.startsWith("name:")) w.name = line.slice(5).trim();
      else if (line.startsWith("synthesis worktree:"))
        w.synthesis = pyTrim(line.slice(line.indexOf(":") + 1));
    }
  }
  w.ticket = ticketLines.join("\n").replace(/^\n+|\n+$/gu, "");
  return w;
}

function readLanes(dispatch: string): string[] {
  try {
    const manifest = JSON.parse(readStrict(join(dispatch, "manifest.json")));
    if (typeof manifest !== "object" || manifest === null) return [];
    const lanes = (manifest as { lanes?: unknown }).lanes;
    if (typeof lanes !== "object" || lanes === null) return [];
    return Object.keys(lanes as Record<string, unknown>);
  } catch {
    return [];
  }
}

function configDir(): string {
  const cfg =
    process.env.POSTMASTER_CONFIG ?? join(process.env.HOME ?? "", ".postmaster", "config.toml");
  return dirname(cfg);
}

function editorLink(dispatch: string, copyFolder: string): string {
  const r = spawnSync(join(HERE, "run"), ["spec-review-link", dispatch, copyFolder], {
    encoding: "utf8",
    timeout: 15_000,
  });
  if (r.status !== 0) {
    const why = ((r.stderr ?? "") as string).trim() || `exit ${r.status}`;
    die(`spec-session: cannot build the editor link (${why})`, 1);
  }
  return (r.stdout ?? "").trim();
}

// --- brief ------------------------------------------------------------------------------------
function brief(dispatch: string): void {
  if (!isDir(dispatch)) die(`spec-session: no such dir: ${dispatch}`, 1);
  const w = readWaybill(dispatch);
  const copyDir = join(dispatch, "spec-review");
  const copy = join(copyDir, "WORKHORSE-SPEC.md");
  if (!isFile(copy)) die(`spec-session: no spec copy at ${copy}`, 2);
  const link = editorLink(dispatch, copyDir);

  const drafts: string[] = [];
  const lanes = readLanes(dispatch);
  // Workhorse worktrees are <repo>/.worktrees/<TICKET>-<lane>; TICKET is the run's id.
  const ticket = dispatch.replace(/\/+$/u, "").split("/").pop() || "";
  for (const lane of lanes) {
    const wt = join(w.repo, ".worktrees", `${ticket}-${lane}`);
    if (!isDir(wt)) continue;
    const draft = join(wt, "WORKHORSE-SPEC.md");
    if (!isFile(draft)) continue;
    const log = git(wt, "log", "-1", "--format=%H", "--", "WORKHORSE-SPEC.md");
    if (log.code !== 0) continue;
    const commit = log.out.trim() || "uncommitted";
    let text: string;
    try {
      text = readStrict(draft).replace(/\n+$/gu, "");
    } catch {
      continue;
    }
    const indented = text
      .split("\n")
      .map((line) => `  ${line}`)
      .join("\n");
    drafts.push(
      `- ${lane}: commit \`${commit}\`; file \`${draft}\`\n\n  Draft text:\n\n${indented}`,
    );
  }
  const draftsBlock = drafts.length > 0 ? drafts.join("\n") : "There are no lane drafts.";

  let prefs: string;
  const prefsPath = join(configDir(), "preferences.md");
  if (isFile(prefsPath)) {
    try {
      prefs = readStrict(prefsPath).replace(/\n+$/gu, "");
    } catch (e: unknown) {
      die(`spec-session: cannot read ${prefsPath} (${errMsg(e)})`, 1);
    }
  } else {
    prefs = "None are set.";
  }

  const runbook = join(TOOL, "skills", "postmaster", "spec-session.md");
  const body = `# Spec session: ${w.name || ticket}

## Ticket

${w.ticket}

## Editor link

${link}

## Copy

${copy}

## Lane drafts

${draftsBlock}

## Standing preferences

${prefs}

## Runbook

${runbook}
`;
  const out = join(dispatch, "spec-session-brief.md");
  try {
    writeFileSync(out, body);
  } catch (e: unknown) {
    die(`spec-session: cannot write ${out} (${errMsg(e)})`, 1);
  }
  console.log(out);
}

// --- approve ----------------------------------------------------------------------------------
function approve(dispatch: string): void {
  if (!isDir(dispatch)) die(`spec-session: no such dir: ${dispatch}`, 1);
  const w = readWaybill(dispatch);
  const copy = join(dispatch, "spec-review", "WORKHORSE-SPEC.md");
  if (!isFile(copy)) die(`spec-session: no spec copy at ${copy}`, 2);
  const synth = w.synthesis;
  if (!isDir(synth)) die(`spec-session: no synthesis worktree at ${synth}`, 1);

  const status = git(synth, "status", "--porcelain");
  if (status.code !== 0) die(`spec-session: cannot read ${synth} status (${status.err.trim()})`, 1);
  for (const line of status.out.split("\n")) {
    if (line.trim() === "") continue;
    const path = line.slice(3).trim().replace(/^"|"$/gu, "");
    if (path !== "WORKHORSE-SPEC.md")
      die(`spec-session: the synthesis worktree holds another change: ${line.trim()}`, 2);
  }

  let copyText: string;
  try {
    copyText = readStrict(copy);
  } catch (e: unknown) {
    die(`spec-session: cannot read ${copy} (${errMsg(e)})`, 1);
  }
  const head = git(synth, "show", "HEAD:WORKHORSE-SPEC.md");
  if (head.code !== 0)
    die(`spec-session: no committed WORKHORSE-SPEC.md in ${synth} (${head.err.trim()})`, 1);
  const committed: string = head.out;

  // The runbook never leaves the tree dirty at the pause. A worktree spec that
  // matches neither the committed spec nor the copy is refused rather than
  // recorded past (when the copy matches) or overwritten blind (when it does
  // not); so is a worktree with no spec at all when the copy matches, since
  // there is nothing to place as approved. A missing spec with a changed copy
  // is restored by writing the copy below.
  let wtText: string | null = null;
  try {
    wtText = readStrict(join(synth, "WORKHORSE-SPEC.md"));
  } catch {
    wtText = null;
  }
  if (wtText === null && copyText === committed)
    die("spec-session: WORKHORSE-SPEC.md is missing from the synthesis worktree", 2);
  if (wtText !== null && wtText !== committed && wtText !== copyText)
    die(
      "spec-session: the synthesis worktree holds an uncommitted edit to WORKHORSE-SPEC.md that matches neither the committed spec nor the copy",
      2,
    );

  let commit: string;
  if (committed === copyText) {
    const rev = git(synth, "rev-parse", "HEAD");
    if (rev.code !== 0) die(`spec-session: cannot read HEAD in ${synth} (${rev.err.trim()})`, 1);
    commit = rev.out.trim();
  } else {
    try {
      writeFileSync(join(synth, "WORKHORSE-SPEC.md"), copyText);
    } catch (e: unknown) {
      die(`spec-session: cannot write WORKHORSE-SPEC.md (${errMsg(e)})`, 1);
    }
    const add = git(synth, "add", "WORKHORSE-SPEC.md");
    if (add.code !== 0) die(`spec-session: cannot add WORKHORSE-SPEC.md (${add.err.trim()})`, 1);
    const commitR = git(synth, "commit", "-m", "Approve shared workhorse spec");
    if (commitR.code !== 0)
      die(`spec-session: cannot commit WORKHORSE-SPEC.md (${commitR.err.trim()})`, 1);
    const rev = git(synth, "rev-parse", "HEAD");
    if (rev.code !== 0) die(`spec-session: cannot read HEAD in ${synth} (${rev.err.trim()})`, 1);
    commit = rev.out.trim();
  }

  const record = spawnSync(
    join(HERE, "run"),
    ["spec-decisions", dispatch, "record", "approved", commit],
    { encoding: "utf8", timeout: 15_000 },
  );
  if (record.status !== 0)
    die(
      `spec-session: the commit is ${commit} but recording the approval failed: ${(record.stderr || record.stdout || "").trim()}`,
      1,
    );
  console.log(commit);
}

// --- entry --------------------------------------------------------------------------------------
const argv = process.argv.slice(2);
if (argv[0] === "brief") {
  if (argv.length !== 2) {
    console.error("usage: run spec-session brief <dispatch>");
    process.exit(1);
  }
  brief(argv[1]!);
} else if (argv[0] === "approve") {
  if (argv.length !== 2) {
    console.error("usage: run spec-session approve <dispatch>");
    process.exit(1);
  }
  approve(argv[1]!);
} else {
  console.error("usage: run spec-session brief|approve <dispatch>");
  process.exit(1);
}
