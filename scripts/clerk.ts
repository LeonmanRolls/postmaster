// Prepare one ticket with the user. Both the user's /clerk entry and the postmaster's launch
// use `brief`, so they receive the same ticket, draft path and runbook instructions.
//
//   clerk.sh brief <repo> <ticket-id>
//   clerk.sh start <repo> <ticket-id>
//   clerk.sh reader <clerk-model> <plain-file> <worktree>

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { readTomlFile, tryTomlFile } from "./lib/data.ts";
import { scriptsDir, toolRoot } from "./lib/paths.ts";
import { run } from "./lib/proc.ts";

const HERE = scriptsDir(import.meta);
const TOOL = toolRoot(import.meta);
const args = process.argv.slice(2);
const CONFIG = process.env.POSTMASTER_CONFIG ?? join(process.env.HOME ?? "", ".postmaster", "config.toml");

function die(message: string, code = 1): never {
  console.error(`clerk: ${message}`);
  process.exit(code);
}

function script(name: string): string {
  return join(HERE, name);
}

function runScript(name: string, argv: string[], env: Record<string, string | undefined> = {}) {
  return run(script(name), argv, { env: { ...process.env, ...env } });
}

function projectEnv(repo: string): Record<string, string | undefined> {
  return { POSTMASTER_PROJECT: resolve(repo) };
}

function tracker(repo: string): string {
  const r = runScript("tracker-kind.sh", [repo]);
  if (r.code !== 0) die((r.err || r.out).trim() || `cannot determine the tracker for ${repo}`);
  return r.out.trim();
}

function trackerCommand(kind: string, repo: string, id: string, verb: "read" | "body") {
  if (kind === "local") return ["local.sh", verb === "body" ? [repo, "read", id, "--body"] : [repo, "read", id]] as const;
  if (kind === "github") return ["github.sh", verb === "body" ? [repo, "read", id, "--body"] : [repo, "read", id]] as const;
  if (kind === "plane") return ["plane.sh", verb === "body" ? ["read", id, "--body"] : ["read", id]] as const;
  return null;
}

interface Ticket {
  kind: string;
  title: string;
  body: string;
  labels: string[];
}

function readTicket(repo: string, id: string): Ticket {
  const kind = tracker(repo);
  const read = trackerCommand(kind, repo, id, "read");
  if (!read) die(`tracker kind '${kind}' needs its own ticket read; see skills/postmaster/trackers.md`);
  const summary = runScript(read[0], read[1], projectEnv(repo));
  if (summary.code !== 0) die(`${kind} adapter could not read ${id}: ${(summary.err || summary.out).trim()}`);
  const body = trackerCommand(kind, repo, id, "body");
  if (!body) die(`tracker kind '${kind}' cannot read the ticket body`);
  const content = runScript(body[0], body[1], projectEnv(repo));
  if (content.code !== 0) die(`${kind} adapter could not read the body of ${id}: ${(content.err || content.out).trim()}`);
  return {
    kind,
    title: summary.out.split(/\r?\n/u).find((line) => line.startsWith("title:"))?.slice(6).trim() ?? "",
    labels: (summary.out.split(/\r?\n/u).find((line) => line.startsWith("labels:"))?.slice(7) ?? "")
      .split(",").map((label) => label.trim()).filter(Boolean),
    body: content.out,
  };
}

function defaultBase(repo: string): string {
  const remoteHead = run("git", ["-C", repo, "symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]);
  if (remoteHead.code === 0) {
    const remote = run("git", ["-C", repo, "rev-parse", "--verify", `${remoteHead.out.trim()}^{commit}`]);
    if (remote.code === 0) return remote.out.trim();
  }
  const branch = run("git", ["-C", repo, "symbolic-ref", "--quiet", "HEAD"]);
  if (branch.code !== 0) die(`cannot determine the default branch tip for ${repo}`);
  const head = run("git", ["-C", repo, "rev-parse", "--verify", "HEAD^{commit}"]);
  if (head.code !== 0) die(`cannot read the default branch tip for ${repo}`);
  return head.out.trim();
}

function safeId(id: string): string {
  return encodeURIComponent(id);
}

function clerkDir(repo: string): string {
  return join(repo, ".postmaster", "clerk");
}

function activePath(repo: string, id: string): string {
  return join(repo, ".postmaster", "runs", "postmaster", "clerks", `${safeId(id)}.json`);
}

function linkForDraft(draft: string): string {
  const cfg = tryTomlFile(CONFIG);
  const planning = cfg?.planning;
  const template = planning && typeof planning === "object" ? (planning as Record<string, unknown>).review_link : "";
  if (typeof template === "string" && template.includes("{path}")) return template.split("{path}").join(draft);
  return draft;
}

function preferences(): string {
  const path = join(dirname(CONFIG), "preferences.md");
  if (!existsSync(path)) return "No standing preferences file is present.";
  try { return readFileSync(path, "utf8").trim() || "The preferences file is empty."; }
  catch { return `Could not read the preferences file at ${path}.`; }
}

function brief(repoArg: string, id: string): { repo: string; id: string; title: string; path: string; name: string; kind: string } {
  const repo = resolve(repoArg);
  const root = run("git", ["-C", repo, "rev-parse", "--show-toplevel"]);
  if (root.code !== 0) die(`not a git repository: ${repo}`);
  const project = root.out.trim();
  const ticket = readTicket(project, id);
  const readyLabel = ticket.labels.some((label) => label.toLocaleLowerCase() === "ready");
  if (readyLabel && ticket.kind !== "other") {
    const unmarked = runScript("ticket-ready.sh", ["unmark", project, id], projectEnv(project));
    if (unmarked.code !== 0) die(`could not take ready mark off ${id}: ${(unmarked.err || unmarked.out).trim()}`);
  }
  const ensure = runScript("project-settings.sh", ["ensure", project]);
  if (ensure.code !== 0) die((ensure.err || ensure.out).trim() || `cannot prepare ${project}/.postmaster`);
  const dir = clerkDir(project);
  mkdirSync(dir, { recursive: true });
  const draft = join(dir, `${safeId(id)}.md`);
  if (readyLabel) {
    writeFileSync(draft, `DRAFT: not approved, do not implement from this file\n\n${ticket.body.replace(/^DRAFT:[^\n]*\n+/u, "")}`, { mode: 0o600 });
  } else if (!existsSync(draft)) {
    writeFileSync(draft, `DRAFT: not approved, do not implement from this file\n\n${ticket.body}`, { flag: "wx", mode: 0o600 });
  } else {
    const existing = readFileSync(draft, "utf8");
    if (!/^DRAFT:/u.test(existing)) writeFileSync(draft, `DRAFT: not approved, do not implement from this file\n\n${existing}`, { mode: 0o600 });
  }
  const title = ticket.title || id;
  const name = `${id}, ${title}`;
  const base = defaultBase(project);
  const preferencesText = preferences();
  const content = `# Booking clerk brief: ${name}

Ticket id: ${id}
Tracker: ${ticket.kind}
Repository: ${project}
Tool: ${TOOL}
Base: ${base}
Base worktree: ${project}
Draft: ${draft}
Draft link: ${linkForDraft(draft)}
Runbook: ${TOOL}/skills/clerk/clerk.md
Skill: ${TOOL}/skills/clerk/SKILL.md
Preferences:

${preferencesText}

## Ticket as read

Title: ${title}

${ticket.body.replace(/\n+$/u, "")}
`;
  writeFileSync(join(dir, `${safeId(id)}.brief.md`), content, { mode: 0o600 });
  return { repo: project, id, title, path: join(dir, `${safeId(id)}.brief.md`), name, kind: ticket.kind };
}

function recordOpen(repo: string, id: string, handle: string): void {
  const path = activePath(repo, id);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ ticket: id, handle, opened_at: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
}

function openRecord(repo: string, id: string): { handle: string } | null {
  try {
    const raw = JSON.parse(readFileSync(activePath(repo, id), "utf8"));
    return raw && typeof raw.handle === "string" ? { handle: raw.handle } : { handle: "" };
  } catch { return null; }
}

function handleOf(repo: string, id: string): string {
  const safe = `${basename(repo)}-${id}`.replace(/[^A-Za-z0-9_-]/gu, "_");
  return `clerk-${safe}`;
}

function start(repoArg: string, id: string): number {
  const repo = resolve(repoArg);
  const old = openRecord(repo, id);
  if (old) {
    if (old.handle) {
      const alive = runScript("host.sh", ["read", old.handle]);
      if (alive.code === 0) die(`one booking clerk session is open for ${id} (${old.handle})`, 3);
    } else {
      die(`one booking clerk session is open for ${id}; continue it or finish its draft`, 3);
    }
  }
  const started = brief(repo, id);
  const host = runScript("host.sh", ["detect"]);
  if (host.code !== 0) die((host.err || host.out).trim() || "cannot determine the session host");
  if (host.out.trim() === "none") {
    console.error(`clerk: no session host can open ${started.name}; start /clerk ${id} in a session on ${repo}`);
    return 3;
  }
  const handle = handleOf(repo, id);
  const spawned = runScript("host.sh", [
    "spawn", handle, repo, "--label", started.name, "--",
    script("launch.sh"), "interactive", "clerk", "--project", repo, "--name", started.name,
  ]);
  if (spawned.code !== 0) {
    if ((spawned.err + spawned.out).includes("already")) die(`one booking clerk session is open for ${id} (${handle})`, 3);
    if (spawned.err) process.stderr.write(spawned.err);
    if (spawned.out) process.stdout.write(spawned.out);
    return spawned.code;
  }
  recordOpen(repo, id, handle);
  const prompt = join(clerkDir(repo), `${safeId(id)}.start.txt`);
  writeFileSync(prompt, `Read ${TOOL}/skills/clerk/SKILL.md and ${started.path}. Continue with ticket ${id}.\n`, { mode: 0o600 });
  const sent = runScript("host.sh", ["send", handle, prompt]);
  if (sent.code !== 0) die(`clerk session opened as ${handle}, but its brief could not be sent: ${(sent.err || sent.out).trim()}`);
  console.log(`clerk: opened ${started.name} in ${host.out.trim()}`);
  console.log(started.path);
  return 0;
}

function reader(clerkModel: string, plainPath: string, worktreeArg: string): number {
  let config: Record<string, any>;
  try { config = readTomlFile(CONFIG) as Record<string, any>; }
  catch { die(`cannot read config ${CONFIG}`); }
  const team = config!.team && typeof config!.team === "object" ? config!.team : {};
  const lanes = config!.lanes && typeof config!.lanes === "object" ? config!.lanes : {};
  const names = Array.isArray(team.workhorses) ? team.workhorses.map(String) : Object.keys(lanes);
  const baseModel = (model: unknown): string => String(model ?? "").split("/").at(-1) ?? "";
  let lane = "";
  let laneModel = "";
  for (const name of names) {
    const spec = (lanes as Record<string, any>)[name];
    const model = baseModel(spec?.model);
    if (model && model !== baseModel(clerkModel)) {
      lane = name;
      laneModel = model;
      break;
    }
  }
  if (!lane) die(`no configured lane uses a model other than the clerk's model ${clerkModel}`);
  const worktree = resolve(worktreeArg);
  const draft = readFileSync(plainPath, "utf8");
  const boundary = /^## For the agents\s*$/mu.exec(draft);
  if (!boundary || boundary.index === undefined) die(`draft ${plainPath} has no ## For the agents boundary`);
  const plain = draft.slice(0, boundary.index).replace(/^DRAFT:[^\n]*\n*/u, "").trim();
  if (!plain) die(`draft ${plainPath} has no plain part before ## For the agents`);
  const projectSettings = runScript("project-settings.sh", ["ensure", worktree]);
  if (projectSettings.code !== 0) die((projectSettings.err || projectSettings.out).trim());
  const readerDir = join(worktree, ".postmaster", "clerk", "reader");
  mkdirSync(readerDir, { recursive: true });
  const token = randomUUID();
  const prompt = join(readerDir, `${token}.prompt.md`);
  const last = join(readerDir, `${token}.last.md`);
  const out = join(readerDir, `${token}.out`);
  const err = join(readerDir, `${token}.err`);
  const marker = join(readerDir, `${token}.done`);
  const promptText = `${plain.replace(/\n+$/u, "")}

Code worktree: ${worktree}

Answer only these questions from the ticket and code:
1. Does the code meet the plain part's acceptance criteria?
2. What important behavior or risk does the plain part leave uncovered?
`;
  writeFileSync(prompt, promptText, { mode: 0o600 });
  const hostName = `clerk-reader-${token}`;
  const launched = runScript("host.sh", [
    "run", hostName, worktree, "--out", out, "--err", err, "--marker", marker, "--",
    script("launch.sh"), "launch", lane, worktree, prompt, "--last", last,
  ], { POSTMASTER_CONFIG: CONFIG });
  if (launched.code !== 0) die(`could not start fresh reader ${lane}: ${(launched.err || launched.out).trim()}`);
  const waited = runScript("wait-for-markers.sh", [join(readerDir), `${token}.done`, "1", "3600"]);
  if (waited.code !== 0) {
    const detail = (waited.out + waited.err).trim();
    die(`fresh reader ${lane} failed or did not finish (exit ${waited.code})${detail ? `: ${detail}` : ""}`);
  }
  if (!existsSync(last)) die(`fresh reader ${lane} exited without a final message`);
  const response = readFileSync(last, "utf8");
  process.stdout.write(response);
  console.log(`reader: ${lane} (${laneModel})`);
  return 0;
}

function main(): number {
  const [verb, ...rest] = args;
  if (verb === "brief") {
    if (rest.length !== 2) die("usage: clerk.sh brief <repo> <ticket-id>");
    const result = brief(rest[0]!, rest[1]!);
    recordOpen(result.repo, result.id, "");
    console.log(result.path);
    return 0;
  }
  if (verb === "start") {
    if (rest.length !== 2) die("usage: clerk.sh start <repo> <ticket-id>");
    return start(rest[0]!, rest[1]!);
  }
  if (verb === "reader") {
    if (rest.length !== 3) die("usage: clerk.sh reader <clerk-model> <plain-file> <worktree>");
    return reader(rest[0]!, rest[1]!, rest[2]!);
  }
  die("usage: clerk.sh brief|start|reader ...");
}

process.exit(main());
