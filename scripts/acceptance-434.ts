// Oracle helper for #434: the booking clerk makes a story for every ticket it
// prepares. Stages fixture repos with local tickets, minimal draft stories,
// stub picture adapters and scratch configs, and drives clerk brief,
// story-page build and check, and setup as subprocesses. It never imports the
// change: every assertion reads command output, the brief, the built page, or
// the staged files.
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { run } from "./lib/proc.ts";

/** The checkout under test: this file lives in its scripts folder. */
export const REPO = dirname(import.meta.dir);
export const RUN = join(REPO, "scripts", "run");

export interface Sh {
  code: number;
  out: string;
  err: string;
}

/** Run the checkout's scripts/run with the given argv and extra env. */
export function sh(args: string[], env?: Record<string, string | undefined>): Sh {
  const r = run(RUN, args, env === undefined ? {} : { env });
  return { code: r.code, out: r.out ?? "", err: r.err ?? "" };
}

/** Every staged directory, for one cleanup call. */
const DIRS: string[] = [];

export function cleanup(): void {
  for (const d of DIRS.splice(0)) rmSync(d, { recursive: true, force: true });
}

function stage(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  DIRS.push(d);
  return d;
}

/** A repository made by fixture new. */
export function fixtureRepo(ticket = "remove"): string {
  const dir = stage("accept-434-");
  const dest = join(dir, "app");
  // fixture new commits the fresh repo; the checkout it runs from may carry
  // no identity of its own, so the test provides it outright.
  const r = sh(["fixture", "new", dest, ticket], {
    GIT_AUTHOR_NAME: "fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.invalid",
  });
  if (r.code !== 0) throw new Error(`fixture new failed: ${r.err}`);
  return dest;
}

/** A bare git repository with one commit. */
export function bareRepo(): string {
  const dir = stage("accept-434-bare-");
  const repo = join(dir, "repo");
  mkdirSync(repo, { recursive: true });
  const init = run("git", ["init", "-q", repo]);
  if (init.code !== 0) throw new Error("git init failed");
  const commit = run("git", [
    "-C",
    repo,
    "-c",
    "user.email=t@t",
    "-c",
    "user.name=t",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "base",
  ]);
  if (commit.code !== 0) throw new Error("git commit failed");
  return repo;
}

/** File a ticket in the repo's own store; returns its id. */
export function localTicket(repo: string, title: string, body: string): string {
  const dir = stage("accept-434-ticket-");
  const file = join(dir, "body.md");
  writeFileSync(file, body);
  const r = sh(["local", repo, "create", title, file]);
  if (r.code !== 0) throw new Error(`local create failed: ${r.err}`);
  return r.out.trim();
}

/** The ticket id as the story file's ticket number. */
export function ticketNum(id: string): number {
  const n = Number(id.replace(/^#/u, ""));
  if (!Number.isInteger(n)) throw new Error(`ticket id ${id} is not a number`);
  return n;
}

/** A scratch machine config; extra lands after the clerk role. */
export function stubConfig(extra = ""): string {
  const dir = stage("accept-434-cfg-");
  const cfg = join(dir, "config.toml");
  writeFileSync(
    cfg,
    [
      `[lanes.one]`,
      `harness = "claude"`,
      `model = "lane-model"`,
      ``,
      `[team]`,
      `clerk = { harness = "claude", model = "clerk-model" }`,
      ...(extra ? [extra] : []),
      ``,
    ].join("\n"),
  );
  return cfg;
}

/** Write the brief for the ticket; returns the brief's text. */
export function briefFor(repo: string, id: string, cfg: string): string {
  const r = sh(["clerk", "brief", repo, id], { POSTMASTER_CONFIG: cfg });
  if (r.code !== 0) throw new Error(`clerk brief failed: ${r.out}${r.err}`);
  return readFileSync(join(repo, ".postmaster", "clerk", `${id}.brief.md`), "utf8");
}

/** A ticket of three criteria, as the raw request filed in the store. */
export const TICKET_3 = {
  title: "The shelf lists every book",
  body: [
    "## Problem / feature",
    "",
    "The shelf shows a reader's books in the order they were shelved.",
    "",
    "## Acceptance criteria",
    "",
    "1. The shelf lists every book on it.",
    "2. A new book lands at the end of the shelf.",
    "3. A book taken off the shelf is gone from the list.",
    "",
  ].join("\n"),
};

// ---------- the C2 draft story ----------

/** A 1x1 red PNG: the known image the stub adapter writes. */
export const KNOWN_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** Stub picture adapter: logs its arguments, copies the known image to --out. */
export const STUB_ADAPTER_SH = `#!/bin/sh
out=""
prev=""
for a in "$@"; do
  if [ "$prev" = "--out" ]; then out="$a"; fi
  prev="$a"
done
echo "$*" >> "$STUB_ADAPTER_LOG"
cp "$STUB_ADAPTER_IMAGE" "$out"
`;

/** The prompt file's words; the stub ignores them, the builder needs the file. */
export const PROMPT_TXT = `Draw one picture of a lamp lighting a desk and save it as picture.png.
`;

export interface DraftCriterion {
  line: string;
  find: string;
  section: string;
  label: string;
  title: string;
  text: string;
}

export const LAMP_TITLE = "The lamp lights the desk";
export const LAMP_TITLE_2 = "The lamp lights the whole desk";

export const C1: DraftCriterion = {
  line: "1. The lamp lights the desk with a warm pool of light.",
  find: "warm pool of light",
  section: "c1",
  label: "C1",
  title: "A warm pool of light",
  text: "The desk gets its light from the lamp standing on it.",
};

export const C1B: DraftCriterion = {
  line: "1. The lamp lights the desk with a warm ring of lamplight.",
  find: "warm ring of lamplight",
  section: "c1",
  label: "C1",
  title: "A warm ring of lamplight",
  text: "The desk gets its light from the lamp standing on it.",
};

export const C2: DraftCriterion = {
  line: "2. The lamp switch clicks the light on and off.",
  find: "clicks the light on and off",
  section: "c2",
  label: "C2",
  title: "A switch that clicks",
  text: "One click lights the desk, another darkens it.",
};

export const C3: DraftCriterion = {
  line: "3. The lamp shade tilts to aim the beam.",
  find: "tilts to aim",
  section: "c3",
  label: "C3",
  title: "A shade that aims",
  text: "The shade tilts so the beam lands where the reader looks.",
};

/** The draft file's body for the given criteria. */
export function draftBody(criteria: DraftCriterion[]): string {
  return [
    "## Problem / feature",
    "",
    "The lamp lights the desk it stands on.",
    "",
    "## Acceptance criteria",
    "",
    ...criteria.map((c) => c.line),
    "",
  ].join("\n");
}

/** A minimal story: the opening, one section per criterion, no code scenes. */
export function storyJson(ticket: number, at: string, criteria: DraftCriterion[]): unknown {
  return {
    title: `Ticket story of #${ticket}`,
    mode: "ticket",
    repoUrl: "https://github.com/brindlewick/postmaster",
    ticket,
    at,
    status: "draft for sign-off",
    sections: [
      { id: "open", label: "Start", title: "The ticket" },
      ...criteria.map((c) => ({ id: c.section, label: c.label, title: c.title })),
    ],
    scenes: [
      {
        id: "hero",
        kind: "image",
        label: `Ticket #${ticket}`,
        chip: "for your reading",
        prompt: "art/opening-prompt.txt",
        alt: "A placeholder picture standing in for the drawn opening.",
      },
      {
        id: "ticket",
        kind: "doc",
        from: "issue",
        number: ticket,
        label: `Ticket #${ticket}`,
        chip: "what you sign",
      },
    ],
    steps: [
      {
        id: "title",
        section: "open",
        scene: "hero",
        kind: "title",
        title: "The lamp lights the desk",
        text: "This ticket asks for a lamp that lights its desk. It takes a minute to scroll.",
      },
      ...criteria.map((c) => ({
        id: c.section,
        section: c.section,
        scene: "ticket",
        excerpt: true,
        find: [c.find],
        kind: "criterion",
        title: c.title,
        text: c.text,
      })),
    ],
  };
}

export interface StagedStory {
  dir: string;
  ticketJson: string;
  adapter: string;
  adapterLog: string;
  image: string;
}

/** Stage the story dir, the ticket file and the stub adapter. */
export function stageStory(
  ticket: number,
  title: string,
  body: string,
  criteria: DraftCriterion[],
): StagedStory {
  const dir = stage("accept-434-story-");
  mkdirSync(join(dir, "art"), { recursive: true });
  writeFileSync(join(dir, "art", "opening-prompt.txt"), PROMPT_TXT);
  writeFileSync(join(dir, "story.json"), JSON.stringify(storyJson(ticket, "HEAD", criteria)));
  const ticketJson = join(dir, "ticket.json");
  writeFileSync(ticketJson, JSON.stringify({ title, body }));
  const adapter = join(dir, "stub-adapter.sh");
  writeFileSync(adapter, STUB_ADAPTER_SH);
  chmodSync(adapter, 0o755);
  const image = join(dir, "known.png");
  writeFileSync(image, Buffer.from(KNOWN_PNG_B64, "base64"));
  const adapterLog = join(dir, "adapter.log");
  return { dir, ticketJson, adapter, adapterLog, image };
}

/** Rewrite the ticket file from the draft as it stands. */
export function writeTicketJson(s: StagedStory, title: string, body: string): void {
  writeFileSync(s.ticketJson, JSON.stringify({ title, body }));
}

/** Rewrite the story file for the criteria as they stand. */
export function writeStoryJson(s: StagedStory, ticket: number, criteria: DraftCriterion[]): void {
  writeFileSync(join(s.dir, "story.json"), JSON.stringify(storyJson(ticket, "HEAD", criteria)));
}

/** Build the story in place, through the stub adapter. */
export function buildStory(s: StagedStory, repo: string, extra: string[] = []): Sh {
  return sh(
    [
      "story-page",
      "build",
      repo,
      s.dir,
      s.dir,
      "--ticket-body",
      s.ticketJson,
      "--picture-adapter",
      s.adapter,
      ...extra,
    ],
    { STUB_ADAPTER_LOG: s.adapterLog, STUB_ADAPTER_IMAGE: s.image },
  );
}

/** Ask whether the built story was made from the draft as it stands. */
export function checkStory(s: StagedStory): Sh {
  return sh(["story-page", "check", s.dir, "--ticket-body", s.ticketJson]);
}

/** How many times the stub adapter was called. */
export function adapterCalls(s: StagedStory): number {
  let text: string;
  try {
    text = readFileSync(s.adapterLog, "utf8");
  } catch {
    return 0;
  }
  return text.split("\n").filter((l) => l !== "").length;
}

/** The hero picture file the build wrote. */
export function pictureBytes(s: StagedStory): Buffer {
  return readFileSync(join(s.dir, "picture.png"));
}

// ---------- the C3 setup runs ----------

/** A bin dir with stub harnesses, for setup's PATH check. */
export function setupBin(): string {
  const dir = stage("accept-434-bin-");
  for (const h of ["claude", "codex", "grok", "agy", "muse", "mimo", "pi"]) {
    const p = join(dir, h);
    writeFileSync(p, "#!/bin/sh\nexit 0\n", "utf8");
    chmodSync(p, 0o755);
  }
  return dir;
}

const SETUP_BASE = [
  "lanes=alpha, beta, sentinel",
  "lane.alpha.harness=bash",
  "lane.alpha.model=m1",
  "lane.beta.harness=bash",
  "lane.beta.model=m2",
  "lane.sentinel.harness=bash",
  "lane.sentinel.model=m3",
  "workhorses=alpha, beta",
  "coachman.harness=bash",
  "coachman.model=judge",
  "fallback.harness=bash",
  "fallback.model=spare",
  "postmaster.harness=bash",
  "postmaster.model=pm",
  "clerk.harness=claude",
  "clerk.model=clerk-model",
];

/** Run a machine setup with the base answers plus one extra line. */
export function machineSetup(extra: string): Sh & { toml: string } {
  const dir = stage("accept-434-setup-");
  const answersPath = join(dir, "answers.txt");
  writeFileSync(answersPath, `${[...SETUP_BASE, extra].join("\n")}\n`, "utf8");
  const toml = join(dir, "config.toml");
  const r = run(RUN, ["setup", "--answers", answersPath, "--config", toml], {
    env: { PATH: `${setupBin()}:${process.env.PATH ?? ""}` },
  });
  return { code: r.code, out: r.out ?? "", err: r.err ?? "", toml };
}

const PROJECT_GLOBAL = `projects_roots = ["~/Code"]
confine = "off"
[lanes.alpha]
harness = "claude"
model = "m-a"
[lanes.beta]
harness = "codex"
model = "m-b"
[team]
workhorses = ["alpha", "beta"]
reviewers = ["alpha", "beta"]
coachman = { harness = "muse", model = "m-c" }
coachman_fallback = { harness = "muse", model = "m-f" }
postmaster = { harness = "claude", model = "m-p" }
clerk = { harness = "claude", model = "m-k" }
max_runs = 2
mode = "synthesis"
[postmaster]
poll_seconds = 120
[tracker]
kind = "local"
postmaster_may_create = false
[review]
round_timeout_seconds = 2400
[ship]
merge_authority = "user"
checkpoint_mode = "autonomous"
review_link = ""
`;

/** Run a project setup with the given answers text. */
export function projectSetup(repo: string, answersText: string): Sh {
  const dir = stage("accept-434-projsetup-");
  const config = join(dir, "config.toml");
  writeFileSync(config, PROJECT_GLOBAL, "utf8");
  const answersPath = join(dir, "answers.txt");
  writeFileSync(answersPath, `${answersText}\n`, "utf8");
  return sh(["setup", "--project", repo, "--answers", answersPath], {
    PATH: `${setupBin()}:${process.env.PATH ?? ""}`,
    POSTMASTER_CONFIG: config,
  });
}
