// Oracle helper for #514: stage a scratch change, run the story builder as a
// subprocess, and read the built pages back as bytes and geometry. It never
// imports the change: the builder is driven through scripts/run, the page's
// HTML is read as text, and the render check measures headless Firefox
// through WebDriver BiDi.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { DRAWING_SVG, KNOWN_PNG_B64, REPO, RUN, STUB_ADAPTER_SH } from "./acceptance-352.ts";
import { run } from "./lib/proc.ts";
import { processIsLive } from "./lib/processes.ts";

/** The checkout under test and its runner, shared with the #352 oracle. */
export const REPO_514 = REPO;
export const RUN_514 = RUN;

/** The scratch branch's first TypeScript file at the base: 11 lines. */
export const CALC_BASE = [
  "export function total(items: number[]): number {",
  "  let sum = 0;",
  "  for (const n of items) {",
  "    sum = sum + n;",
  "  }",
  "  return sum;",
  "}",
  "",
  "export function mean(items: number[]): number {",
  "  return total(items) / items.length;",
  "}",
];

/** The same file on the branch: three lines removed, four added. */
export const CALC_HEAD = [
  "export function total(items: number[]): number {",
  "  let sum = 0;",
  "  for (const n of items) {",
  "    sum += n;",
  "  } // totals accumulate here",
  "  return sum < 0 ? 0 : sum;",
  "}",
  "",
  "// totals never go below zero",
  "export function mean(items: number[]): number {",
  "  return total(items) / items.length;",
  "}",
];

/** The Markdown file the branch adds: 6 lines. */
export const ADDED_MD = [
  "# Added notes",
  "",
  "These notes arrived with the branch.",
  "",
  "- first",
  "- second",
];

/** The base's Markdown file, removed by the branch: 3 lines. */
export const NOTES_MD = [
  "Old notes, gone with the branch.",
  "Second line of the old notes.",
  "Third line of the old notes.",
];

/** The second TypeScript file, renamed unchanged. */
export const OLD_TS = ['export const oldName = "kept";', "export const oldOther = 3;"];

/** The shell script the branch makes executable. */
export const RUN_SH = ["#!/bin/sh", "echo branch-story-fixture"];

/** The small binary file at the base and on the branch. */
export const BLOB_BASE = Buffer.from([
  0x42, 0x4c, 0x4f, 0x42, 0x00, 0x42, 0x41, 0x53, 0x45, 0x00, 0x01, 0x02,
]);
export const BLOB_HEAD = Buffer.from([
  0x42, 0x4c, 0x4f, 0x42, 0x00, 0x48, 0x45, 0x41, 0x44, 0x00, 0xff, 0xfe, 0xfd, 0x2d, 0x74, 0x72,
  0x61, 0x69, 0x6c, 0x69, 0x6e, 0x67, 0x2d, 0x62, 0x79, 0x74, 0x65, 0x73,
]);

/** A string only the default branch's later commit holds. */
export const LATER_MARKER = "LATER-COMMIT-MARKER-story514x7q";

/** The scratch ticket: {title, body} with two acceptance criteria. */
export const TICKET_514 = {
  title: "A branch can be told as a story before it is pushed",
  body: [
    "## Problem / feature",
    "",
    "A story page tells a ticket on the phone: a picture and a plain welcome, a section",
    "for each acceptance criterion, a drawing of each part before any code, and the code",
    "the ticket points to. The flow makes one only for a ticket, from its text and the",
    "code before the work. It cannot tell a change, what a branch actually did.",
    "",
    "Done: a branch's change can be told as a story page before it is pushed, by the",
    "builder that tells tickets.",
    "",
    "## Acceptance criteria",
    "",
    "1. The edited calculation and the added notes read as steps with their drawings.",
    "2. Every touched file is on a step or in the closing list.",
    "",
    "## For the agents",
    "",
    "### Checks",
    "",
    "- C1 builds the scratch branch's story with the stub.",
  ].join("\n"),
};

/** The words the criterion steps quote: each inside one criterion alone. */
export const FIND_C1 = "edited calculation and the added notes";
export const FIND_C2 = "Every touched file is on a step";

/** The change story for the scratch branch: base and head, no at, no mode. */
export const STORY_514: unknown = {
  repoUrl: "https://github.com/brindlewick/postmaster",
  ticket: 514,
  base: "main",
  head: "feature",
  status: "unpushed",
  title: "Story of the branch before the push",
  sections: [
    { id: "open", label: "Start", title: "The branch" },
    { id: "c1", label: "C1", title: "First criterion" },
    { id: "c2", label: "C2", title: "Second criterion" },
    { id: "left", label: "End", title: "What the steps leave out" },
  ],
  scenes: [
    {
      id: "hero",
      kind: "image",
      label: "Branch feature",
      chip: "for your reading",
      prompt: "art/opening-prompt.txt",
      alt: "A branch told before it is pushed.",
    },
    {
      id: "ticket",
      kind: "doc",
      from: "issue",
      number: 514,
      label: "Ticket #514",
      chip: "what you sign",
      cut: "## For the agents",
    },
    {
      id: "d",
      kind: "diagram",
      label: "The change",
      chip: "diagram",
      svg: "diagrams/d.svg",
      states: ["before", "after"],
      caption: "What the branch touches.",
    },
    { id: "calc", kind: "head", file: "calc.ts", from: 1, to: 12 },
    { id: "addeddoc", kind: "head", file: "added.md", from: 1, to: 6 },
    { id: "oldbase", kind: "base", file: "calc.ts", from: 2, to: 8 },
    { id: "left", kind: "leftovers", label: "What the steps leave out", chip: "list" },
  ],
  steps: [
    {
      id: "title",
      kind: "title",
      scene: "hero",
      section: "open",
      title: "A branch, told before it is pushed",
      text: "This is the story of a branch before it is pushed: what it changed, drawn first and then shown in code, one part at a time. Scroll, and the panel follows the step in the box.",
    },
    {
      id: "criteria",
      scene: "ticket",
      section: "open",
      find: [FIND_C1, FIND_C2],
      excerpt: true,
      title: "Two things had to be true",
      text: "The ticket names two criteria. Each gets its own section below, in order: a drawing of the part first, then the code that makes it true.",
    },
    {
      id: "c1",
      kind: "criterion",
      scene: "ticket",
      section: "c1",
      find: [FIND_C1],
      excerpt: true,
      title: "Steps with their drawings",
      text: "The first criterion asks that the edited calculation and the added notes read as steps, each drawn before it is shown.",
    },
    {
      id: "c1d",
      scene: "d",
      section: "c1",
      state: "before",
      title: "What the branch touches",
      text: "The calculation changed in place: three lines out, four lines in. The next steps show what was there before, then what is there now.",
    },
    {
      id: "c1old",
      scene: "oldbase",
      section: "c1",
      focus: [[4, 6]],
      title: "The lines before",
      text: "Here is what the three removed lines added up to before the change.",
    },
    {
      id: "c1code",
      scene: "calc",
      section: "c1",
      focus: [[4, 6]],
      marks: [{ line: 6, text: ["sum < 0"] }],
      title: "The edited calculation",
      text: "The loop now adds with `+=`, and the total never goes below zero. The removed lines sit where they were, ahead of the lines that took their place.",
    },
    {
      id: "c2",
      kind: "criterion",
      scene: "ticket",
      section: "c2",
      find: [FIND_C2],
      excerpt: true,
      title: "Nothing left out",
      text: "The second criterion asks that every touched file is on a step or in the closing list at the end.",
    },
    {
      id: "c2d",
      scene: "d",
      section: "c2",
      state: "after",
      title: "The rest of the change",
      text: "Besides the calculation, the branch adds a notes file, removes the old notes, renames a file, changes a binary and makes a script executable.",
    },
    {
      id: "c2code",
      scene: "addeddoc",
      section: "c2",
      focus: [[1, 3]],
      title: "The added notes",
      text: "The new notes file, all six lines added by the branch.",
    },
    {
      id: "end",
      scene: "left",
      section: "left",
      title: "What the steps leave out",
      text: "{shown} of the {changed} changed lines are on the steps above. The other {left} are here, file by file, with the files no step shows.",
    },
  ],
};

/** Picture prompt for the change story (the stub ignores its words). */
export const PROMPT_514 = `Generate one image with your image generation tool and save it in the current directory as picture.png. Do not write any code to draw it; use the image generation tool.

Use the attached poster as the style reference: a Victorian hand-coloured engraved poster with fine cross-hatching, cream paper, oxblood-red and forest-green ribbon banners with cream lettering, brass posthorns, an ornate floral border and a warm muted palette. Wide landscape, 3:2.

Scene: a mail coach on a country road at dawn, its driver holding a sealed letter up to read. A red ribbon across the top reads "Before the push"; a green ribbon across the bottom reads "A branch told". No other text.

When the file is saved, reply with its path and its size in pixels, and nothing else.
`;

/** A gh stand-in: logs each call, then fails, so any read shows. */
export const GH_STUB_SH = `#!/bin/sh
echo "gh $*" >> "$GH_CALLS_LOG"
exit 1
`;

export interface Scratch {
  dir: string;
  repo: string;
  branch: string;
  /** The branch head and the merge base, resolved at staging. */
  head: string;
  mb: string;
  ticketFile: string;
  storyDir: string;
  adapter: string;
  image: string;
  ghDir: string;
  ghLog: string;
}

function git(repo: string, args: string[]): string {
  const r = run("git", ["-C", repo, ...args], { timeout: 30_000 });
  if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.err.trim() || `exit ${r.code}`}`);
  return r.out;
}

/**
 * The scratch repository: no remote, a base commit holding the five files,
 * a branch with the six-file change, and one more commit on the default
 * branch past the merge base. From the merge base the change is 6 files,
 * +10 −6.
 */
export function makeScratch(): Scratch {
  const dir = mkdtempSync(join(tmpdir(), "story-514-"));
  const repo = join(dir, "repo");
  mkdirSync(repo, { recursive: true });
  const branch = "feature";
  git(repo, ["init", "-b", "main", "."]);
  git(repo, ["config", "user.name", "story-fixture"]);
  git(repo, ["config", "user.email", "story-fixture@example.invalid"]);
  git(repo, ["config", "commit.gpgsign", "false"]);
  writeFileSync(join(repo, "calc.ts"), `${CALC_BASE.join("\n")}\n`);
  writeFileSync(join(repo, "notes.md"), `${NOTES_MD.join("\n")}\n`);
  writeFileSync(join(repo, "old-name.ts"), `${OLD_TS.join("\n")}\n`);
  writeFileSync(join(repo, "run.sh"), `${RUN_SH.join("\n")}\n`);
  chmodSync(join(repo, "run.sh"), 0o644);
  writeFileSync(join(repo, "blob.bin"), BLOB_BASE);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-m", "base"]);
  git(repo, ["checkout", "-b", branch]);
  writeFileSync(join(repo, "calc.ts"), `${CALC_HEAD.join("\n")}\n`);
  writeFileSync(join(repo, "added.md"), `${ADDED_MD.join("\n")}\n`);
  git(repo, ["rm", "-q", "notes.md"]);
  git(repo, ["mv", "old-name.ts", "new-name.ts"]);
  chmodSync(join(repo, "run.sh"), 0o755);
  writeFileSync(join(repo, "blob.bin"), BLOB_HEAD);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-m", "the change"]);
  const head = git(repo, ["rev-parse", branch]).trim();
  git(repo, ["checkout", "-q", "main"]);
  writeFileSync(join(repo, "later.txt"), `${LATER_MARKER}\n`);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-m", "later on the default branch"]);
  const mb = git(repo, ["merge-base", "main", branch]).trim();

  const ticketFile = join(dir, "ticket-514.json");
  writeFileSync(ticketFile, JSON.stringify(TICKET_514));
  const storyDir = join(dir, "story514");
  mkdirSync(join(storyDir, "diagrams"), { recursive: true });
  mkdirSync(join(storyDir, "art"), { recursive: true });
  writeFileSync(join(storyDir, "story.json"), `${JSON.stringify(STORY_514, null, 2)}\n`);
  writeFileSync(join(storyDir, "diagrams", "d.svg"), DRAWING_SVG);
  writeFileSync(join(storyDir, "art", "opening-prompt.txt"), PROMPT_514);
  const adapter = join(dir, "stub-adapter.sh");
  writeFileSync(adapter, STUB_ADAPTER_SH);
  chmodSync(adapter, 0o755);
  const image = join(dir, "known.png");
  writeFileSync(image, Buffer.from(KNOWN_PNG_B64, "base64"));
  const ghDir = join(dir, "gh-stub");
  mkdirSync(ghDir, { recursive: true });
  writeFileSync(join(ghDir, "gh"), GH_STUB_SH);
  chmodSync(join(ghDir, "gh"), 0o755);
  const ghLog = join(dir, "gh-calls.log");
  return { dir, repo, branch, head, mb, ticketFile, storyDir, adapter, image, ghDir, ghLog };
}

/** A removed address, split so no email literal sits in the source. */
export const SCRUB_ADDR = "jane@acme-corp" + ".example.dev";

/** One file, one removed line holding the address, one kept line. */
export const SCRUB_BASE = ["owner: " + SCRUB_ADDR, "keep"];
export const SCRUB_HEAD = ["keep"];

/** The change story for the scrub repo: the removed line read on a step. */
export const STORY_SCRUB: unknown = {
  repoUrl: "https://github.com/brindlewick/postmaster",
  ticket: 514,
  base: "main",
  head: "scrubfeat",
  status: "unpushed",
  title: "Story of a removed address",
  sections: [
    { id: "open", label: "Start", title: "The branch" },
    { id: "c1", label: "C1", title: "First criterion" },
    { id: "c2", label: "C2", title: "Second criterion" },
    { id: "left", label: "End", title: "What the steps leave out" },
  ],
  scenes: [
    {
      id: "hero",
      kind: "image",
      label: "Branch scrubfeat",
      chip: "for your reading",
      prompt: "art/opening-prompt.txt",
      alt: "A branch told before it is pushed.",
    },
    {
      id: "ticket",
      kind: "doc",
      from: "issue",
      number: 514,
      label: "Ticket #514",
      chip: "what you sign",
      cut: "## For the agents",
    },
    {
      id: "d",
      kind: "diagram",
      label: "The change",
      chip: "diagram",
      svg: "diagrams/d.svg",
      states: ["before", "after"],
      caption: "What the branch touches.",
    },
    { id: "cfg", kind: "head", file: "cfg.ts", from: 1, to: 1 },
    { id: "left", kind: "leftovers", label: "What the steps leave out", chip: "list" },
  ],
  steps: [
    {
      id: "title",
      kind: "title",
      scene: "hero",
      section: "open",
      title: "A branch, told before it is pushed",
      text: "This is the story of a branch before it is pushed: what it changed, drawn first and then shown in code, one part at a time. Scroll, and the panel follows the step in the box.",
    },
    {
      id: "criteria",
      scene: "ticket",
      section: "open",
      find: [FIND_C1, FIND_C2],
      excerpt: true,
      title: "Two things had to be true",
      text: "The ticket names two criteria. Each gets its own section below, in order: a drawing of the part first, then the code that makes it true.",
    },
    {
      id: "c1",
      kind: "criterion",
      scene: "ticket",
      section: "c1",
      find: [FIND_C1],
      excerpt: true,
      title: "Steps with their drawings",
      text: "The first criterion asks that the edited calculation and the added notes read as steps, each drawn before it is shown.",
    },
    {
      id: "c1d",
      scene: "d",
      section: "c1",
      state: "before",
      title: "What the branch touches",
      text: "One line out, nothing added. The next step shows the line that went.",
    },
    {
      id: "c1code",
      scene: "cfg",
      section: "c1",
      focus: [[1, 1]],
      title: "The removed line",
      text: "The owner line as it was before the change, sitting where it was.",
    },
    {
      id: "c2",
      kind: "criterion",
      scene: "ticket",
      section: "c2",
      find: [FIND_C2],
      excerpt: true,
      title: "Nothing left out",
      text: "The second criterion asks that every touched file is on a step or in the closing list at the end.",
    },
    {
      id: "c2d",
      scene: "d",
      section: "c2",
      state: "after",
      title: "The rest of the change",
      text: "There is nothing else: one file, one line gone.",
    },
    {
      id: "end",
      scene: "left",
      section: "left",
      title: "What the steps leave out",
      text: "{shown} of the {changed} changed lines are on the steps above. The other {left} are here, file by file, with the files no step shows.",
    },
  ],
};

/**
 * The scrub repository: no remote, a base commit holding one file with an
 * address line, a branch removing that line. The ticket, stubs and story
 * ride along as the scratch's do.
 */
export function makeEmailScratch(): Scratch {
  const dir = mkdtempSync(join(tmpdir(), "story-514-scrub-"));
  const repo = join(dir, "repo");
  mkdirSync(repo, { recursive: true });
  const branch = "scrubfeat";
  git(repo, ["init", "-b", "main", "."]);
  git(repo, ["config", "user.name", "story-fixture"]);
  git(repo, ["config", "user.email", "story-fixture@example.invalid"]);
  git(repo, ["config", "commit.gpgsign", "false"]);
  writeFileSync(join(repo, "cfg.ts"), `${SCRUB_BASE.join("\n")}\n`);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-m", "base"]);
  git(repo, ["checkout", "-b", branch]);
  writeFileSync(join(repo, "cfg.ts"), `${SCRUB_HEAD.join("\n")}\n`);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-m", "the change"]);
  const head = git(repo, ["rev-parse", branch]).trim();
  const mb = git(repo, ["merge-base", "main", branch]).trim();

  const ticketFile = join(dir, "ticket-514.json");
  writeFileSync(ticketFile, JSON.stringify(TICKET_514));
  const storyDir = join(dir, "story514");
  mkdirSync(join(storyDir, "diagrams"), { recursive: true });
  mkdirSync(join(storyDir, "art"), { recursive: true });
  writeFileSync(join(storyDir, "story.json"), `${JSON.stringify(STORY_SCRUB, null, 2)}\n`);
  writeFileSync(join(storyDir, "diagrams", "d.svg"), DRAWING_SVG);
  writeFileSync(join(storyDir, "art", "opening-prompt.txt"), PROMPT_514);
  const adapter = join(dir, "stub-adapter.sh");
  writeFileSync(adapter, STUB_ADAPTER_SH);
  chmodSync(adapter, 0o755);
  const image = join(dir, "known.png");
  writeFileSync(image, Buffer.from(KNOWN_PNG_B64, "base64"));
  const ghDir = join(dir, "gh-stub");
  mkdirSync(ghDir, { recursive: true });
  writeFileSync(join(ghDir, "gh"), GH_STUB_SH);
  chmodSync(join(ghDir, "gh"), 0o755);
  const ghLog = join(dir, "gh-calls.log");
  return { dir, repo, branch, head, mb, ticketFile, storyDir, adapter, image, ghDir, ghLog };
}

export function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

// ---------- running the builder (edges) ----------

export interface ChangeBuild {
  code: number;
  out: string;
  err: string;
  outDir: string;
  html: string | null;
  sheet: string | null;
  record: string | null;
}

/** Build a change story with the stub adapter and the gh stand-in first on PATH. */
export function runChangeBuild(
  s: Scratch,
  name: string,
  storyDir?: string,
  extra?: string[],
): ChangeBuild {
  const outDir = join(s.dir, `${name}-out`);
  const log = join(s.dir, `${name}-adapter.log`);
  const r = run(
    RUN_514,
    [
      "story-page",
      "build",
      s.repo,
      storyDir ?? s.storyDir,
      outDir,
      "--ticket-body",
      s.ticketFile,
      "--picture-adapter",
      s.adapter,
      ...(extra ?? []),
    ],
    {
      env: {
        STUB_ADAPTER_LOG: log,
        STUB_ADAPTER_IMAGE: s.image,
        GH_CALLS_LOG: s.ghLog,
        PATH: `${s.ghDir}:${process.env.PATH ?? ""}`,
      },
      timeout: 120_000,
    },
  );
  const page = join(outDir, "index.html");
  const sheet = join(outDir, "sheet.html");
  const record = join(outDir, "build.json");
  return {
    code: r.code,
    out: r.out,
    err: r.err,
    outDir,
    html: existsSync(page) ? readFileSync(page, "utf8") : null,
    sheet: existsSync(sheet) ? readFileSync(sheet, "utf8") : null,
    record: existsSync(record) ? readFileSync(record, "utf8") : null,
  };
}

/** The stub adapter's log lines for a build, or nothing when it never ran. */
export function adapterLog(s: Scratch, name: string): string[] {
  const log = join(s.dir, `${name}-adapter.log`);
  if (!existsSync(log)) return [];
  return readFileSync(log, "utf8")
    .split("\n")
    .filter((l) => l.length > 0);
}

/** The gh stand-in's log lines, or nothing when gh was never called. */
export function ghCalls(s: Scratch): string[] {
  if (!existsSync(s.ghLog)) return [];
  return readFileSync(s.ghLog, "utf8")
    .split("\n")
    .filter((l) => l.length > 0);
}

/** Check a built story against its ticket file and, for a change, its repo. */
export function runCheck(
  outDir: string,
  ticketFile: string,
  repo?: string,
): { code: number; out: string; err: string } {
  const r = run(
    RUN_514,
    [
      "story-page",
      "check",
      outDir,
      "--ticket-body",
      ticketFile,
      ...(repo === undefined ? [] : ["--repo", repo]),
    ],
    { timeout: 30_000 },
  );
  return { code: r.code, out: r.out, err: r.err };
}

// ---------- reading git (a second implementation, not the builder's) ----------

export interface NumstatRow {
  add: number | null;
  del: number | null;
  path: string;
}

/** The change's numstat rows: `- -` reads as binary (null counts). */
export function numstat(repo: string, mb: string, head: string): NumstatRow[] {
  const out: NumstatRow[] = [];
  for (const line of git(repo, ["diff", "--numstat", "-M", mb, head]).split("\n")) {
    if (!line) continue;
    // ASCII: git's numstat rows are machine-made ASCII digits and tabs.
    const m = /^(\d+|-)\t(\d+|-)\t(.*)$/u.exec(line);
    if (!m) throw new Error(`bad numstat row: ${line}`);
    out.push({
      add: m[1] === "-" ? null : Number(m[1]),
      del: m[2] === "-" ? null : Number(m[2]),
      path: m[3] ?? "",
    });
  }
  return out;
}

/** The change's name-status rows, renames as `R100 old new`. */
export function nameStatus(repo: string, mb: string, head: string): string[][] {
  const out: string[][] = [];
  for (const line of git(repo, ["diff", "--name-status", "-M", mb, head]).split("\n")) {
    if (!line) continue;
    out.push(line.split("\t"));
  }
  return out;
}

export interface ExpectedChange {
  added: Set<string>;
  removed: Set<string>;
}

/**
 * Every added head line (`path:+N`) and removed base line (`path:-M`), from a
 * minimal parse of the unified diff: files from the `+++` line (`---` for a
 * removed file), hunks from their headers. Only files with hunks have lines;
 * renames, binaries and mode changes without hunks contribute none.
 */
export function expectedChange(repo: string, mb: string, head: string): ExpectedChange {
  const added = new Set<string>();
  const removed = new Set<string>();
  const text = git(repo, ["diff", "--no-color", "--no-ext-diff", "-U0", "-M", mb, head]);
  let cur: string | null = null;
  let minus = "";
  let oldNo = 0;
  let newNo = 0;
  let inHunk = false;
  let submod = false;
  const tab = String.fromCharCode(9);
  const pathOf = (line: string): string => line.slice(4).split(tab)[0] ?? "";
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) {
      cur = null;
      minus = "";
      inHunk = false;
      submod = false;
    } else if (
      (line.startsWith("index ") && line.endsWith(" 160000")) ||
      line === "new file mode 160000" ||
      line === "deleted file mode 160000"
    ) {
      submod = true;
    } else if (line.startsWith("--- ") && !inHunk) {
      minus = pathOf(line);
    } else if (line.startsWith("+++ ") && !inHunk) {
      const p = pathOf(line);
      if (p === "/dev/null") cur = minus === "/dev/null" ? null : minus.replace(/^a\//u, "");
      else cur = p.replace(/^b\//u, "");
    } else if (line.startsWith("@@ ") && cur !== null) {
      // ASCII: hunk headers are ASCII digits and markers, which \d matches exactly.
      const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u.exec(line);
      if (!m) throw new Error(`bad hunk header: ${line}`);
      oldNo = Number(m[1]);
      newNo = Number(m[3]);
      inHunk = true;
    } else if (line.startsWith("+") && cur !== null && inHunk && !submod) {
      added.add(`${cur}:+${newNo}`);
      newNo += 1;
    } else if (line.startsWith("-") && cur !== null && inHunk && !submod) {
      removed.add(`${cur}:-${oldNo}`);
      oldNo += 1;
    }
  }
  return { added, removed };
}

// ---------- reading the page (pure core) ----------

export interface ChangeRow {
  type: string;
  key: string | null;
  scene: string;
  num: string;
  text: string;
}

/** Every code row in a change page: steps and the closing list alike. */
export function changeRows(html: string): ChangeRow[] {
  const out: ChangeRow[] = [];
  const re =
    /<div class="r ([a-z]+)"([^>]*)><span class="n">([^<]*)<\/span><span class="sg">[^<]*<\/span><span class="c">(.*?)<\/span><\/div>/gsu;
  for (const m of html.matchAll(re)) {
    const attrs = m[2] ?? "";
    const key = /data-k="([^"]+)"/u.exec(attrs);
    const scene = /data-scene="([^"]+)"/u.exec(attrs);
    if (!scene) throw new Error("a code row names no scene");
    out.push({
      type: m[1] ?? "",
      key: key ? (key[1] ?? "") : null,
      scene: scene[1] ?? "",
      num: m[3] ?? "",
      text: m[4] ?? "",
    });
  }
  return out;
}

export interface FileEntry {
  file: string;
  what: string;
  gpath: string;
  gwhat: string;
}

/** Every closing-list file entry: a touched file with what happened to it. */
export function fileEntries(html: string): FileEntry[] {
  const out: FileEntry[] = [];
  const re =
    /<details class="gap file" data-file="([^"]+)" data-what="([^"]+)">.*?<span class="gpath">([^<]*)<\/span><span class="gwhat">([^<]*)<\/span>/gsu;
  for (const m of html.matchAll(re)) {
    out.push({ file: m[1] ?? "", what: m[2] ?? "", gpath: m[3] ?? "", gwhat: m[4] ?? "" });
  }
  return out;
}

/** How many closing-list line groups the page holds. */
export function gapGroupCount(html: string): number {
  return [...html.matchAll(/<details class="gap">/gu)].length;
}

/** Tag-free text, whitespace collapsed, entities unescaped. */
export function plain514(html: string): string {
  return html
    .replace(/<[^>]*>/gu, "")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&amp;/gu, "&")
    .replace(/\s+/gu, " ") // ASCII: runs collapse for comparison on both sides alike.
    .trim();
}

/** A code row's text: entities unescaped, whitespace exactly as rendered. */
export function codeText(escaped: string): string {
  return escaped
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&amp;/gu, "&");
}

/** The page's visible text: style and script blocks out, tags stripped. */
export function visibleText(html: string): string {
  const bare = html
    .replace(/<style>[\s\S]*?<\/style>/gu, "") // ASCII: [\s\S] spans any block text, newlines in.
    .replace(/<script[\s\S]*?<\/script>/gu, ""); // ASCII: [\s\S] spans any block text, newlines in.
  return plain514(bare);
}

/**
 * Changed lines on no step and not in the closing list, from the page's
 * rendered rows: git's truth against the page's data keys.
 */
export function coverageMissingChange(
  repo: string,
  mb: string,
  head: string,
  html: string,
): string[] {
  const { added, removed } = expectedChange(repo, mb, head);
  const keys = new Set(changeRows(html).flatMap((r) => (r.key === null ? [] : [r.key])));
  return [...added, ...removed].filter((k) => !keys.has(k)).sort();
}

/** The sha256 hex of bytes or text. */
export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

// ---------- rendering in headless Firefox (edges) ----------

/**
 * A render copy: the page fragment as a document, off the network (the font
 * links and the highlight.js script taken out), its transitions off, and
 * every closing-list group open where asked.
 */
export function wrapFragment(html: string, opts: { dark: boolean; openDetails: boolean }): string {
  const kept = html
    .split("\n")
    .filter((l) => !/fonts\.googleapis\.com|highlight\.min\.js/u.test(l))
    .join("\n");
  const still = `<style>*,*::before,*::after{transition:none!important;animation:none!important}</style>\n${kept}`;
  const open = opts.openDetails
    ? still.replace(/<details class="gap/gu, '<details open class="gap')
    : still;
  return `<!doctype html>\n<html lang="en"${opts.dark ? ' data-theme="dark"' : ""}>\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n</head>\n<body>\n${open}\n</body>\n</html>\n`;
}

/** Where render copies go: where the installed Firefox can read them. */
export function renderStaging(): string {
  const common = join(homedir(), "snap", "firefox", "common");
  const base = existsSync(common) ? common : tmpdir();
  return mkdtempSync(join(base, "story514-render-"));
}

/** The Firefox binary, or null where none is installed. */
export function firefoxBinary(): string | null {
  const mac = "/Applications/Firefox.app/Contents/MacOS/firefox";
  if (existsSync(mac)) return mac;
  const r = run("sh", ["-c", "command -v firefox"], { timeout: 10_000 });
  if (r.code !== 0) return null;
  const p = (r.out.trim().split("\n")[0] ?? "").trim();
  return p === "" ? null : p;
}

/** True where the render check cannot run: no Firefox binary installed. */
export const NO_FIREFOX = firefoxBinary() === null;

export function sleep(ms: number): Promise<void> {
  return new Promise((res) => {
    setTimeout(() => res(), ms);
  });
}

/** A free loopback port, read off a momentary listener. */
export function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = createServer(() => {});
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      if (!addr) {
        rej(new Error("no address on the momentary listener"));
        return;
      }
      const port = addr.port;
      s.close(() => res(port));
    });
  });
}

/** The slice of a client WebSocket the BiDi driver uses. */
export interface BidiSocket {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
}

function openSocket(url: string): BidiSocket {
  const ctor = (globalThis as unknown as { WebSocket: new (url: string) => BidiSocket }).WebSocket;
  return new ctor(url);
}

export interface Bidi {
  cmd(method: string, params: Record<string, unknown>): Promise<unknown>;
  close(): void;
}

/** One BiDi session over a fresh socket: errors throw naming the command. */
export function connectBidi(port: number): Promise<Bidi> {
  return new Promise((res, rej) => {
    const ws = openSocket(`ws://127.0.0.1:${port}/session`);
    let nextId = 0;
    const waiters = new Map<number, (v: unknown) => void>();
    ws.onmessage = (ev: { data: unknown }) => {
      let msg: unknown;
      try {
        msg = JSON.parse(String(ev.data)) as unknown;
      } catch {
        return;
      }
      if (typeof msg !== "object" || msg === null || !("id" in msg)) return;
      const id = (msg as { id: unknown }).id;
      if (typeof id !== "number") return;
      const w = waiters.get(id);
      if (w) {
        waiters.delete(id);
        w(msg);
      }
    };
    ws.onerror = () => rej(new Error(`bidi: cannot reach ws://127.0.0.1:${port}/session`));
    ws.onopen = () => {
      ws.onerror = null;
      res({
        cmd: (method: string, params: Record<string, unknown>): Promise<unknown> => {
          const id = ++nextId;
          return new Promise((resolve, reject) => {
            waiters.set(id, (msg: unknown) => {
              if (typeof msg !== "object" || msg === null) {
                reject(new Error(`bidi ${method}: no response object`));
                return;
              }
              const r = msg as { type?: unknown; result?: unknown; error?: unknown };
              if (r.type === "error") {
                const m = msg as { message?: unknown };
                reject(
                  new Error(
                    `bidi ${method}: ${String(r.error ?? "error")}: ${String(m.message ?? "")}`.trim(),
                  ),
                );
                return;
              }
              resolve(r.result);
            });
            ws.send(JSON.stringify({ id, method, params }));
          });
        },
        close: () => ws.close(),
      });
    };
  });
}

export interface Firefox {
  pid: number;
  port: number;
  dir: string;
  session: string;
  ctx: string;
  bidi: Bidi;
}

function bidiStr(value: unknown, what: string): string {
  if (typeof value !== "string" || value === "") throw new Error(`bidi: no ${what}`);
  return value;
}

/**
 * Headless Firefox with its BiDi agent up, one session, its first context.
 * Waits up to three minutes for the agent: a cold start is slow.
 */
export async function launchFirefox(dir: string): Promise<Firefox> {
  const binary = firefoxBinary();
  if (!binary) throw new Error("no firefox binary installed");
  const port = await freePort();
  const prof = join(dir, "prof");
  mkdirSync(prof, { recursive: true });
  const child = spawn(
    binary,
    [
      "--headless",
      "--no-remote",
      "--profile",
      prof,
      "--remote-debugging-port",
      String(port),
      "about:blank",
    ],
    { stdio: "ignore", detached: true },
  );
  if (child.pid === undefined) throw new Error("firefox did not start");
  const pid = child.pid;
  let bidi: Bidi | null = null;
  let lastErr = "no attempt yet";
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try {
      bidi = await connectBidi(port);
      break;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      if (child.exitCode !== null) {
        throw new Error(`firefox exited during startup: ${lastErr}`);
      }
      await sleep(1000);
    }
  }
  if (!bidi) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already gone */
    }
    throw new Error(`firefox BiDi never came up on ${port}: ${lastErr}`);
  }
  const opened = (await bidi.cmd("session.new", { capabilities: {} })) as {
    sessionId?: unknown;
  };
  const session = bidiStr(opened.sessionId, "BiDi session");
  const tree = (await bidi.cmd("browsingContext.getTree", { root: null })) as {
    contexts?: unknown;
  };
  const contexts = Array.isArray(tree.contexts) ? tree.contexts : [];
  const first = contexts[0] as { context?: unknown } | undefined;
  const ctx = bidiStr(first?.context, "browsing context");
  return { pid, port, dir, session, ctx, bidi };
}

/** End the session, close the socket, and leave no Firefox behind. */
export async function quitFirefox(ff: Firefox): Promise<void> {
  try {
    await ff.bidi.cmd("session.end", {});
  } catch {
    /* already gone */
  }
  ff.bidi.close();
  for (let i = 0; i < 50; i++) {
    if (!processIsLive(ff.pid)) return;
    try {
      if (i === 0) process.kill(ff.pid, "SIGTERM");
      if (i === 20) process.kill(ff.pid, "SIGKILL");
    } catch {
      return;
    }
    await sleep(200);
  }
}

export interface Viewport {
  w: number;
  h: number;
}

export interface RenderReport {
  w: number;
  h: number;
  scrollW: number;
  over: string[];
  on: string[];
  scenesOn: string[];
  stageTop: number;
  stageLeft: number;
  delInScene: boolean;
  stepScene: string;
  settled: boolean;
}

const MEASURE_JS = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const narrow = window.innerWidth < 900;
  const line = window.innerHeight * (narrow ? 0.74 : 0.45);
  const step = document.getElementById("SID");
  if (DO_SCROLL) {
    const r = step.getBoundingClientRect();
    window.scrollTo({ top: window.scrollY + r.top + Math.min(r.height / 2, window.innerHeight * 0.15) - line, behavior: "auto" });
  }
  let settled = false;
  for (let i = 0; i < 10; i++) {
    await new Promise((r2) => requestAnimationFrame(() => requestAnimationFrame(r2)));
    const y1 = window.scrollY;
    await sleep(120);
    if (window.scrollY === y1) { settled = true; break; }
  }
  const W = window.innerWidth;
  const over = [];
  const q = ".r, .gpath, .gwhat, .slabel, .schip, #slines, #scount, svg.dg, .poster, figcaption, .step, .gap, .lsum";
  document.querySelectorAll(q).forEach((el) => {
    const b = el.getBoundingClientRect();
    if (b.right > W + 1 || b.left < -1) {
      const cls = el.getAttribute("class") || el.tagName;
      over.push(String(cls).split(" ")[0] + ":" + Math.round(b.left) + "-" + Math.round(b.right));
    }
  });
  const on = [];
  document.querySelectorAll(".step.on").forEach((s) => on.push(s.id));
  const scenesOn = [];
  document.querySelectorAll(".scene.on").forEach((s) => scenesOn.push(s.getAttribute("data-id")));
  const stage = document.querySelector(".stage").getBoundingClientRect();
  const sd = JSON.parse(document.getElementById("story-data").textContent);
  return JSON.stringify({
    w: W, h: window.innerHeight,
    scrollW: document.scrollingElement.scrollWidth,
    over: over, on: on, scenesOn: scenesOn,
    stageTop: stage.top, stageLeft: stage.left,
    delInScene: !!document.querySelector(".scene.on .r.del"),
    stepScene: sd.steps[NUM].scene,
    settled: settled
  });
})()`;

function asReport(value: unknown): RenderReport {
  if (typeof value !== "object" || value === null) throw new Error("render script gave no object");
  const v = value as Record<string, unknown>;
  const num = (k: string): number => {
    if (typeof v[k] !== "number") throw new Error(`render script gave no ${k}`);
    return v[k] as number;
  };
  const strs = (k: string): string[] => {
    if (!Array.isArray(v[k]) || !(v[k] as unknown[]).every((x) => typeof x === "string")) {
      throw new Error(`render script gave no ${k}`);
    }
    return v[k] as string[];
  };
  if (typeof v.stepScene !== "string") throw new Error("render script gave no stepScene");
  if (typeof v.delInScene !== "boolean") throw new Error("render script gave no delInScene");
  if (typeof v.settled !== "boolean") throw new Error("render script gave no settled");
  return {
    w: num("w"),
    h: num("h"),
    scrollW: num("scrollW"),
    over: strs("over"),
    on: strs("on"),
    scenesOn: strs("scenesOn"),
    stageTop: num("stageTop"),
    stageLeft: num("stageLeft"),
    delInScene: v.delInScene,
    stepScene: v.stepScene,
    settled: v.settled,
  };
}

/**
 * Render one copy at a viewport: set the viewport, open the copy on its
 * step, bring the step to the reading line, settle, and measure.
 */
export async function measureRender(
  ff: Firefox,
  fileUrl: string,
  vp: Viewport,
  stepIndex: number,
): Promise<RenderReport> {
  await ff.bidi.cmd("browsingContext.setViewport", {
    context: ff.ctx,
    viewport: { width: vp.w, height: vp.h },
  });
  await ff.bidi.cmd("browsingContext.navigate", {
    context: ff.ctx,
    url: `${fileUrl}#s${stepIndex + 1}`,
  });
  const expression = MEASURE_JS.split("SID")
    .join(`s${stepIndex + 1}`)
    .split("NUM")
    .join(String(stepIndex))
    .split("DO_SCROLL")
    .join(stepIndex === 0 ? "false" : "true");
  const out = (await ff.bidi.cmd("script.evaluate", {
    expression,
    target: { context: ff.ctx },
    awaitPromise: true,
  })) as { result?: { value?: unknown } };
  const json = out.result?.value;
  if (typeof json !== "string") throw new Error("render script returned no string");
  let parsed: unknown;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch {
    throw new Error("render script returned no JSON");
  }
  return asReport(parsed);
}
