// The booking clerk's launch: write the brief and start the session.
//
//   run clerk brief <repo> <id>                  write the draft and the brief
//   run clerk start <repo> <id>                  write the brief and open the clerk in a new tab
//
// brief unmarks a marked ticket first, so the postmaster cannot dispatch it
// while the clerk works; start refuses a ticket whose session the host still
// shows, and tells the user to open the clerk by hand when no host answers.
// The session is named for the ticket's number and title, as the adapter
// reads them. The postmaster logs the dispatch; this script records only the
// open session. Once the ticket is marked ready the session closes when the
// clerk's turn ends, and a later start opens a new session under a new handle.
//
// Exit 0 done; 3 no session host; 1 anything else.

import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { effectiveConfigForProject, globalConfigPath } from "./lib/effective-config.ts";
import { scriptsDir, toolRoot } from "./lib/paths.ts";
import { run } from "./lib/proc.ts";
import { shlexQuote } from "./verify.ts";

const HERE = scriptsDir(import.meta);
const TOOL = toolRoot(import.meta);

function die(message: string, code = 1): never {
  console.error(`clerk: ${message}`);
  process.exit(code);
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function readStrict(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (e: unknown) {
    die(`cannot read ${path} (${(e as Error)?.message ?? e})`);
  }
}

function findSection(doc: Record<string, unknown>, path: string[]): Record<string, unknown> | null {
  let node: unknown = doc;
  for (const key of path) {
    if (typeof node !== "object" || node === null || !(key in (node as Record<string, unknown>)))
      return null;
    node = (node as Record<string, unknown>)[key];
  }
  return typeof node === "object" && node !== null ? (node as Record<string, unknown>) : null;
}

function findString(doc: Record<string, unknown>, path: string[]): string {
  const parent = findSection(doc, path.slice(0, -1));
  const key = path[path.length - 1] ?? "";
  const value = parent?.[key];
  return typeof value === "string" ? value : "";
}

function readConfig(repo: string): { path: string; doc: Record<string, unknown> } {
  const path = globalConfigPath();
  const resolved = effectiveConfigForProject(repo, path);
  if (resolved.notice !== null) console.error(resolved.notice);
  if (resolved.config === null || resolved.error !== null) {
    die(resolved.error ?? "cannot resolve project settings");
  }
  return { path, doc: resolved.config };
}

function runScript(name: string, args: string[]): { code: number; out: string; err: string } {
  const r = run(join(HERE, "run"), [name, ...args]);
  return { code: r.code, out: r.out ?? "", err: r.err ?? "" };
}

function requireScript(name: string, args: string[], what: string): string {
  const r = runScript(name, args);
  if (r.code !== 0) die(`${what} (${(r.out + r.err).trim() || `exit ${r.code}`})`);
  return r.out;
}

// The listings describe the project, wherever under it the clerk was pointed:
// a brief for a subdir used to succeed, so it still does, with the project's
// checks and verifiers rather than the subdir's.
function repoTop(repo: string): string {
  const r = run("git", ["-C", repo, "rev-parse", "--show-toplevel"]);
  const top = (r.out ?? "").replace(/\n+$/u, "");
  return r.code === 0 && top !== "" ? top : repo;
}

// The gate discovery finds for the repo, as discover-project prints it: the
// brief's checks run with it, as every run's do.
function discoveredGate(top: string): string {
  const out = requireScript("discover-project", [top], `run discover-project ${top} failed`);
  for (const l of out.split("\n")) {
    if (l.startsWith("gate=")) return l.slice("gate=".length);
  }
  return "";
}

// A cited command, quoted per element so the clerk can re-run it as written:
// absolute, since the clerk runs in the target repo, where a bare scripts/run
// would miss or hit the target's own script of that name.
function cite(args: string[]): string {
  return [join(HERE, "run"), ...args].map((a) => shlexQuote(a)).join(" ");
}

function trackerKind(repo: string): string {
  return requireScript("tracker-kind", [repo], `run tracker-kind ${repo} failed`).trim();
}

function parseTicketRead(out: string): { title: string } {
  let title = "";
  for (const raw of out.split("\n")) {
    const line = raw.replace(/\r$/u, "");
    if (line === "") break;
    const m = /^([A-Za-z-]+):[ \t]*(.*)$/u.exec(line);
    if (!m) continue;
    // ASCII: adapter header names are machine-written; folded once against ASCII literals.
    if (m[1]!.toLowerCase() === "title") title = m[2]!;
  }
  return { title };
}

// The ready mark is asked of the adapter with has-label, never read off the
// comma-joined `labels:` line, where one name can hold a comma and read back
// as two. A read that worked but a membership that fails stops the clerk:
// the unmark guard below must not silently skip.
function readTicket(
  repo: string,
  id: string,
  kind: string,
): { title: string; ready: boolean } | null {
  const base = kind === "plane" ? [] : [repo];
  const r = runScript(`${kind}`, [...base, "read", id]);
  if (r.code !== 0) return null;
  const h = runScript(`${kind}`, [...base, "has-label", id, "ready"]);
  if (h.code !== 0)
    die(`the ${kind} adapter could not check the ready label on ${id} (${(h.out + h.err).trim()})`);
  return { title: parseTicketRead(r.out).title, ready: h.out.trim() === "present" };
}

function displayId(kind: string, id: string): string {
  if (kind === "plane") return id.includes("-") ? id : `PM-${id}`;
  if (kind === "other") return id;
  return id.startsWith("#") ? id : `#${id}`;
}

function defaultBase(repo: string): string {
  const head = run("git", ["-C", repo, "rev-parse", "origin/HEAD"]);
  if (head.code === 0) {
    const ref = (head.out ?? "").trim().split(" ").pop() ?? "";
    if (ref) {
      const tip = run("git", ["-C", repo, "rev-parse", ref]);
      if (tip.code === 0 && (tip.out ?? "").trim()) return (tip.out ?? "").trim();
    }
  }
  const local = run("git", ["-C", repo, "rev-parse", "HEAD"]);
  if (local.code === 0 && (local.out ?? "").trim()) return (local.out ?? "").trim();
  die(`cannot read a base commit from ${repo}`);
}

function editorLink(template: string, draft: string): string {
  // The review link template addresses {path} as a folder (code-server opens
  // folders): the folder holding the draft.
  if (!template) return draft;
  return template.split("{path}").join(dirname(draft));
}

function clerkDir(repo: string): string {
  return join(repo, ".postmaster", "clerk");
}

// A ticket id can hold slashes on some trackers; encode it so the clerk's
// files always stay inside the clerk directory.
function clerkFile(repo: string, id: string, suffix: string): string {
  return join(clerkDir(repo), `${encodeURIComponent(id)}${suffix}`);
}

// The spawn handle, qualified by the project so two projects' ticket 1 do
// not collide on a host. The host sanitizes it further; send, read and the
// session record all use this same form.
export function clerkHandle(repo: string, id: string): string {
  return `clerk-${basename(repo)}-${id}`;
}

function sessionDir(repo: string): string {
  return join(repo, ".postmaster", "runs", "postmaster", "clerks");
}

type Brief = {
  id: string;
  name: string;
  session: string;
  ticket: string;
  repo: string;
  tool: string;
  base: string;
  draft: string;
  link: string;
  preferences: string;
  skill: string;
  runbook: string;
  title: string;
};

// The ready queue ticket-ready keeps: brief refuses an unreadable ticket
// while one of these names it.
function readyMarker(repo: string, id: string): string {
  return join(
    repo,
    ".postmaster",
    "runs",
    "postmaster",
    "ready",
    `${encodeURIComponent(id)}.ready`,
  );
}

function writeBrief(repo: string, id: string): Brief {
  const kind = trackerKind(repo);
  const read = readTicket(repo, id, kind);
  if (read === null) {
    // A ticket the brief cannot read may still be queued from its sign-off;
    // opening the clerk then lets the queued stale version dispatch
    // mid-revision. Refuse while a ready marker names this id.
    if (isFile(readyMarker(repo, id))) {
      if (kind === "github" || kind === "local" || kind === "plane") {
        die(
          `could not read ${displayId(kind, id)} to check its ready mark, and a ready marker is queued for it; run brief again once the ticket reads, or clear a stale marker with: run ticket-ready consume ${repo} ${id}`,
        );
      }
      die(
        `tracker kind '${kind}' has no adapter script, and a ready marker is queued for ${id}; remove the ready label through the tracker's own tooling (trackers.md, other), clear the marker with: run ticket-ready consume ${repo} ${id}, then run brief again`,
      );
    }
    if (kind !== "github" && kind !== "local" && kind !== "plane") {
      console.error(
        `clerk: tracker kind '${kind}' has no adapter script; the brief cannot see the ticket's labels, so remove the ready label through the tracker's own tooling if the ticket carries one`,
      );
    }
  }
  const ticket = read ?? { title: "", ready: false };
  const name = displayId(kind, id);
  const session = ticket.title ? `${name}, ${ticket.title}` : name;
  if (ticket.ready) {
    requireScript(
      "ticket-ready",
      ["unmark", repo, id],
      `the ready mark on ${name} could not be removed; the clerk stops so the ticket is not dispatched mid-edit`,
    );
  }
  const { path: cfgPath, doc } = readConfig(repo);
  const template = findString(doc, ["planning", "review_link"]);
  const prefsPath = join(dirname(cfgPath), "preferences.md");
  const preferences = isFile(prefsPath)
    ? readStrict(prefsPath).replace(/\n+$/u, "")
    : "None are set.";
  const base = defaultBase(repo);
  const dir = clerkDir(repo);
  mkdirSync(dir, { recursive: true });
  const draft = clerkFile(repo, id, ".md");
  const link = editorLink(template, draft);
  const skill = join(TOOL, "skills", "clerk", "SKILL.md");
  const runbook = join(TOOL, "skills", "clerk", "clerk.md");
  const briefPath = clerkFile(repo, id, ".brief.md");
  // The checks every run is held to, and the project's verifiers beside them:
  // a check the clerk writes should fit the checks every run already runs, and
  // drive a surface with a verifier through it. Both print verbatim, so the
  // brief never paraphrases what the scripts say. Both run against the project
  // top with the gate discovery finds, as every run's do.
  const top = repoTop(repo);
  const gate = discoveredGate(top);
  const checksArgs =
    gate === "" ? ["checks", top, "--lines"] : ["checks", top, "--gate", gate, "--lines"];
  const checksOut = requireScript(
    "verify",
    checksArgs,
    `run verify ${checksArgs.join(" ")} failed`,
  ).replace(/\n+$/u, "");
  const checksBlock = checksOut === "" ? ["(no checks reported)"] : checksOut.split("\n");
  const verifiersOut = requireScript(
    "verifier",
    ["list", top],
    `run verifier list ${top} failed`,
  ).replace(/\n+$/u, "");
  const verifiersBlock =
    verifiersOut === "verifiers: none"
      ? ["Verifiers: none."]
      : [
          `The project's verifiers, as \`${cite(["verifier", "list", top])}\` prints them:`,
          "",
          "```text",
          ...verifiersOut.split("\n"),
          "```",
        ];
  // The verifiers that may have gone stale since they were confirmed, from one
  // stale call at the brief's base. Silent when nothing is marked, so the entry
  // says nothing of the kind; the clerk's runbook says what a marked verifier
  // means for the checks.
  const staleArgs = ["stale", top, "--at", base];
  const staleOut =
    verifiersOut === "verifiers: none"
      ? "stale: none"
      : requireScript("verifier", staleArgs, `run verifier ${staleArgs.join(" ")} failed`).replace(
          /\n+$/u,
          "",
        );
  const staleBlock =
    staleOut === "stale: none"
      ? []
      : [
          `The following verifiers may be stale, as \`${cite(["verifier", ...staleArgs])}\` prints them:`,
          "",
          "```text",
          ...staleOut.split("\n"),
          "```",
        ];
  const lines = [
    `# Brief: booking clerk for ${session}`,
    "",
    `Ticket: ${name} on ${kind}`,
    `Repository: ${repo}`,
    `Tool: ${TOOL}`,
    `Base: ${base} (the default branch's tip when this was written)`,
    `Base worktree: ${repo}`,
    `Draft: ${draft}`,
    `Editor link: ${link}`,
    "",
    "## Standing preferences",
    "",
    preferences,
    "",
    "## Read first",
    "",
    `Skill: ${skill}`,
    `Runbook: ${runbook}`,
    "",
    "## Checks and verifiers",
    "",
    `The checks every run is held to, as \`${cite(["verify", ...checksArgs])}\` prints them:`,
    "",
    "```text",
    ...checksBlock,
    "```",
    "",
    ...verifiersBlock,
    ...(staleBlock.length > 0 ? ["", ...staleBlock] : []),
    "",
  ];
  if (ticket.title) lines.push(`## The ticket as read`, "", `Title: ${ticket.title}`, "");
  writeFileSync(briefPath, lines.join("\n"));
  if (!isFile(draft)) {
    writeFileSync(
      draft,
      [
        `DRAFT: ${name} is being prepared and is not ready to run`,
        "",
        "## Problem / feature",
        "",
        "",
      ].join("\n"),
    );
  }
  return {
    id,
    name,
    session,
    ticket: name,
    repo,
    tool: TOOL,
    base,
    draft,
    link,
    preferences,
    skill,
    runbook,
    title: ticket.title,
  };
}

export function clerkSessionPath(repo: string, id: string): string {
  return join(sessionDir(repo), `${encodeURIComponent(id)}.json`);
}

function recordOpen(repo: string, id: string, name: string, brief: string, handle: string): void {
  mkdirSync(sessionDir(repo), { recursive: true });
  writeFileSync(
    clerkSessionPath(repo, id),
    `${JSON.stringify({ ticket: name, brief, handle, opened: new Date().toISOString() })}\n`,
  );
}

function readSession(repo: string, id: string): { handle: string } | null {
  try {
    const raw = JSON.parse(readFileSync(clerkSessionPath(repo, id), "utf8")) as {
      handle?: unknown;
    };
    if (typeof raw.handle !== "string") return null;
    return { handle: raw.handle };
  } catch {
    return null;
  }
}

function sessionAlive(handle: string): boolean {
  if (!handle) return false;
  const r = runScript("host", ["read", handle]);
  return r.code === 0;
}

// Split a printed `launch: ...` form into argv words: single and double quotes
// group, a backslash escapes the next character, whitespace separates. The
// `launch: ` prefix and a leading `cd <dir> &&` are dropped: the caller
// passes its own cwd to the host.
export function splitCommand(line: string): string[] {
  const rest = line.replace(/^launch:[ \t]*/u, "");
  const words: string[] = [];
  let word = "";
  let quote = "";
  let escaped = false;
  let open = false;
  for (const ch of rest) {
    if (escaped) {
      word += ch;
      escaped = false;
      open = true;
    } else if (ch === "\\" && quote !== "'") {
      escaped = true;
    } else if ((ch === "'" || ch === '"') && !quote) {
      quote = ch;
      open = true;
    } else if (ch === quote) {
      quote = "";
    } else if (!quote && (ch === " " || ch === "\t" || ch === "\n")) {
      if (open) {
        words.push(word);
        word = "";
        open = false;
      }
    } else {
      word += ch;
      open = true;
    }
  }
  if (escaped) word += "\\";
  if (open) words.push(word);
  if (words.length >= 3 && words[0] === "cd" && words[2] === "&&") return words.slice(3);
  return words;
}

function usage(): string {
  return ["run clerk brief <repo> <id>", "run clerk start <repo> <id>"].join(" | ");
}

function cmdBrief(repo: string, id: string): number {
  const brief = writeBrief(repo, id);
  console.log(`clerk: brief for ${brief.name} at ${clerkFile(repo, id, ".brief.md")}`);
  return 0;
}

function cmdStart(repo: string, id: string): number {
  const open = readSession(repo, id);
  if (open?.handle && sessionAlive(open.handle)) {
    die(`one booking clerk session is open for ${id} already; continue it or finish it first`);
  }
  const brief = writeBrief(repo, id);
  const briefPath = clerkFile(repo, id, ".brief.md");
  const startCmd = requireScript(
    "launch",
    ["interactive", "clerk", "--project", repo, "--name", brief.session],
    "run launch printed no interactive command for the clerk",
  ).trim();
  if (!startCmd) die("run launch printed no interactive command for the clerk");
  const form = splitCommand(startCmd);
  if (form.length === 0) die("run launch printed no interactive command for the clerk");
  // The handle names the project and the ticket's id, since both hosts check
  // session names globally; the tab carries the session's number and title.
  // One handle per session, never one per ticket: the closer a mark arms closes
  // this session only, and a later clerk for the same ticket starts untouched.
  const stem = clerkHandle(repo, id);
  const nonce = randomBytes(2).toString("hex");
  const handle = stem.length + 5 <= 32 ? `${stem}-${nonce}` : `${stem.slice(0, 27)}-${nonce}`;
  const started = runScript("host", [
    "spawn",
    handle,
    repo,
    "--label",
    brief.session,
    "--",
    ...form,
  ]);
  if (started.code === 3) {
    console.error(`clerk: no session host answers; open ${brief.session} by hand:`);
    console.error(startCmd.replace(/^launch:[ \t]*/u, ""));
    console.error(`then read the brief at ${briefPath}.`);
    return 3;
  }
  if (started.code !== 0)
    die(`the clerk session could not start (${(started.out + started.err).trim()})`);
  if (!started.out.includes("handle=")) {
    die(
      `the clerk session started but the host did not confirm its handle (${started.out.trim()})`,
    );
  }
  recordOpen(repo, id, brief.session, briefPath, handle);
  const promptFile = clerkFile(repo, id, ".prompt.md");
  writeFileSync(
    promptFile,
    `You are the booking clerk for ${brief.session}. Read the skill at ${brief.skill}, then the runbook, then the brief at ${briefPath}. The draft is at ${brief.draft}; greet the user from there.\n`,
  );
  const sent = runScript("host", ["send", handle, promptFile]);
  if (sent.code !== 0)
    die(
      `the clerk session started but the brief could not be sent (${(sent.out + sent.err).trim()})`,
    );
  console.log(`clerk: ${brief.session} opened (session ${handle})`);
  return 0;
}

function main(argv: string[]): number {
  const verb = argv[0] ?? "";
  if ((verb === "brief" || verb === "start") && argv.length === 3) {
    process.env.POSTMASTER_PROJECT = resolve(argv[1]!);
    return verb === "brief" ? cmdBrief(argv[1]!, argv[2]!) : cmdStart(argv[1]!, argv[2]!);
  }
  console.error(`usage: ${usage()}`);
  return 1;
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
