// Readiness is the combination of the user's ready label and both executable ticket checks.
// The `mark` verb applies the approved draft through the tracker, records its turnpikes in the
// project ledger, and queues the ticket for the postmaster's next free slot.
//
//   ticket-ready.sh <repo> <id>
//   ticket-ready.sh <repo> --body <file> --labels <file> --title <title>   (tracker kind other)
//   ticket-ready.sh mark <repo> <id> [--body <file>] [--title <title>]
//   ticket-ready.sh unmark|consume <repo> <id>
//   ticket-ready.sh pending <repo>
//
//   exit 0  ready (check), or marked/queued (mark), or queue operation succeeded
//   exit 1  ticket/config/tracker could not be read or updated
//   exit 2  not ready, with every reason on its own line

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { scriptsDir } from "./lib/paths.ts";
import { run } from "./lib/proc.ts";

const HERE = scriptsDir(import.meta);
const READY_LABEL = "ready";
const args = process.argv.slice(2);

function die(message: string, code = 1): never {
  console.error(`ticket-ready: ${message}`);
  process.exit(code);
}

function queueDir(repo: string): string {
  return join(repo, ".postmaster", "runs", "postmaster", "ready");
}

function markerPath(repo: string, id: string): string {
  return join(queueDir(repo), `${encodeURIComponent(id)}.ready`);
}

function queueId(path: string): string | null {
  const name = basename(path);
  if (!name.endsWith(".ready")) return null;
  try {
    return decodeURIComponent(name.slice(0, -6));
  } catch {
    return null;
  }
}

function runScript(script: string, argv: string[], env: Record<string, string | undefined> = {}) {
  return run(join(HERE, script), argv, { env: { ...process.env, ...env } });
}

function requireOk(script: string, argv: string[], env: Record<string, string | undefined> = {}) {
  const result = runScript(script, argv, env);
  if (result.code !== 0) {
    const reason = (result.out + result.err).trim();
    die(`${script.replace(/\.sh$/u, "")} failed (exit ${result.code})${reason ? `: ${reason}` : ""}`);
  }
  return result.out;
}

interface Adapter {
  kind: string;
  read: string[];
  body: string[];
  edit: (body: string, base: string) => string[];
  title: (value: string) => string[];
  label: (verb: "add" | "remove") => string[];
}

function adapter(repo: string, id: string): Adapter {
  const kind = requireOk("tracker-kind.sh", [repo]).trim();
  if (kind === "github") {
    return {
      kind,
      read: [repo, "read", id],
      body: [repo, "read", id, "--body"],
      edit: (body, base) => [repo, "edit", id, body, base],
      title: (value) => [repo, "title", id, value],
      label: (verb) => [repo, "label", id, verb, READY_LABEL],
    };
  }
  if (kind === "plane") {
    return {
      kind,
      read: ["read", id],
      body: ["read", id, "--body"],
      edit: (body, base) => ["edit", id, body, base],
      title: (value) => ["title", id, value],
      label: (verb) => ["label", id, verb, READY_LABEL],
    };
  }
  if (kind === "local") {
    return {
      kind,
      read: [repo, "read", id],
      body: [repo, "read", id, "--body"],
      edit: (body, base) => [repo, "edit", id, body, base],
      title: (value) => [repo, "title", id, value],
      label: (verb) => [repo, "label", id, verb, READY_LABEL],
    };
  }
  die(`tracker kind '${kind}' has no adapter; use --body and --labels to check it`);
}

function adapterScript(kind: string): string {
  return kind === "github" ? "github.sh" : kind === "plane" ? "plane.sh" : "local.sh";
}

function adapterEnv(repo: string): Record<string, string | undefined> {
  return { POSTMASTER_PROJECT: repo };
}

function withBodyFiles<T>(repo: string, body: string, base: string, action: (bodyPath: string, basePath: string) => T): T {
  const settings = runScript("project-settings.sh", ["ensure", repo]);
  if (settings.code !== 0) die((settings.out + settings.err).trim() || "cannot prepare ignored project records");
  const dir = join(repo, ".postmaster");
  mkdirSync(dir, { recursive: true });
  const bodyPath = join(dir, `.ticket-ready-${process.pid}-${randomUUID()}.md`);
  const basePath = join(dir, `.ticket-ready-base-${process.pid}-${randomUUID()}.md`);
  try {
    writeFileSync(bodyPath, body, { flag: "wx", mode: 0o600 });
    writeFileSync(basePath, base, { flag: "wx", mode: 0o600 });
    return action(bodyPath, basePath);
  } finally {
    try { unlinkSync(bodyPath); } catch { /* already gone */ }
    try { unlinkSync(basePath); } catch { /* already gone */ }
  }
}

function normalizeLabels(text: string): string[] {
  return text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
}

function reportCheck(repo: string, id: string, body: string, title: string, labels: string[]): { code: number; detail: string[]; turnpikes: string } {
  const reasons: string[] = [];
  if (!labels.some((label) => label.toLocaleLowerCase() === READY_LABEL)) reasons.push("ready label is missing");
  const checked = withBodyFiles(repo, body, "", (bodyPath) => runScript("ticket-check.sh", ["--body", bodyPath, "--title", title, "--project", repo], { POSTMASTER_PROJECT: repo }));
  const parts = withBodyFiles(repo, body, "", (bodyPath) => runScript("ticket-parts.sh", [bodyPath, "--final"], { POSTMASTER_PROJECT: repo }));
  if (checked.code !== 0) {
    for (const line of `${checked.out}${checked.err}`.split(/\r?\n/u).map((v) => v.trim()).filter(Boolean)) reasons.push(`ticket: ${line}`);
  }
  if (parts.code !== 0) {
    for (const line of `${parts.out}${parts.err}`.split(/\r?\n/u).map((v) => v.trim()).filter(Boolean)) reasons.push(`parts: ${line}`);
  }
  const turnpikes = `${checked.out}${checked.err}`.split(/\r?\n/u).map((line) => line.trim()).find((line) => line.startsWith("turnpikes:")) ?? "";
  if (!reasons.length) {
    console.log(`ready: ${id}`);
    if (turnpikes) console.log(turnpikes);
  }
  else for (const reason of reasons) console.log(reason);
  return { code: reasons.length ? 2 : 0, detail: reasons, turnpikes };
}

function readTicket(repo: string, id: string): { adapter: Adapter; body: string; title: string; labels: string[] } {
  const a = adapter(repo, id);
  const env = adapterEnv(repo);
  const read = runScript(adapterScript(a.kind), a.read, env);
  if (read.code !== 0) die(`${a.kind} adapter could not read ${id} (exit ${read.code}): ${(read.err || read.out).trim()}`);
  const title = read.out.split(/\r?\n/u).find((line) => line.startsWith("title:"))?.slice(6).trim() ?? "";
  const labelsLine = read.out.split(/\r?\n/u).find((line) => line.startsWith("labels:"))?.slice(7) ?? "";
  const bodyResult = runScript(adapterScript(a.kind), a.body, env);
  if (bodyResult.code !== 0) die(`${a.kind} adapter could not read the body of ${id} (exit ${bodyResult.code})`);
  return { adapter: a, body: bodyResult.out, title, labels: labelsLine.split(",").map((label) => label.trim()).filter(Boolean) };
}

function otherCheck(repo: string, bodyPath: string, labelPath: string, title: string): number {
  let body: string;
  let labels: string[];
  try {
    body = readFileSync(bodyPath, "utf8");
    labels = normalizeLabels(readFileSync(labelPath, "utf8"));
  } catch (e) {
    die(`cannot read --body or --labels file: ${e instanceof Error ? e.message : String(e)}`);
  }
  return reportCheck(repo, title, body!, title, labels!).code;
}

function check(repo: string, id: string): number {
  const ticket = readTicket(repo, id);
  return reportCheck(repo, id, ticket.body, ticket.title, ticket.labels).code;
}

function writeQueue(repo: string, id: string): void {
  const dir = queueDir(repo);
  mkdirSync(dir, { recursive: true });
  const marker = markerPath(repo, id);
  const temporary = `${marker}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${id}\n`, { flag: "wx", mode: 0o600 });
  try {
    if (!existsSync(marker)) renameSync(temporary, marker);
    else unlinkSync(temporary);
    const notified = `${marker}.notified`;
    try { unlinkSync(notified); } catch { /* absent */ }
  } catch (e) {
    try { unlinkSync(temporary); } catch { /* best effort */ }
    die(`cannot queue ${id}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function removeQueue(repo: string, id: string): void {
  const marker = markerPath(repo, id);
  for (const path of [marker, `${marker}.notified`]) {
    try { unlinkSync(path); } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") die(`cannot remove queue marker ${path}`);
    }
  }
}

function mark(repo: string, id: string, draftPath: string, titleArg: string): number {
  const ticket = readTicket(repo, id);
  let body = ticket.body;
  let title = titleArg || ticket.title;
  if (draftPath) {
    try { body = readFileSync(draftPath, "utf8"); } catch (e) { die(`cannot read draft ${draftPath}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  const result = withBodyFiles(repo, body!, ticket.body, (bodyFile, baseFile) => {
    const checkResult = runScript("ticket-check.sh", ["--body", bodyFile, "--title", title, "--project", repo], { POSTMASTER_PROJECT: repo });
    const partsResult = runScript("ticket-parts.sh", [bodyFile, "--final"]);
    const reasons: string[] = [];
    if (checkResult.code !== 0) reasons.push(...`${checkResult.out}${checkResult.err}`.split(/\r?\n/u).map((v) => v.trim()).filter(Boolean).map((v) => `ticket: ${v}`));
    if (partsResult.code !== 0) reasons.push(...`${partsResult.out}${partsResult.err}`.split(/\r?\n/u).map((v) => v.trim()).filter(Boolean).map((v) => `parts: ${v}`));
    if (reasons.length) {
      for (const reason of reasons) console.log(reason);
      return { code: 2, turnpikes: "" };
    }
    const turnpikes = `${checkResult.out}${checkResult.err}`.split(/\r?\n/u).map((v) => v.trim()).find((v) => v.startsWith("turnpikes:")) ?? "";
    if (!turnpikes) die("ticket check passed without its turnpikes line");
    if (body !== ticket!.body) {
      const edit = runScript(adapterScript(ticket!.adapter.kind), ticket!.adapter.edit(bodyFile, baseFile), adapterEnv(repo));
      if (edit.code !== 0) die(`could not update ${id} through ${ticket!.adapter.kind} (exit ${edit.code}): ${(edit.err || edit.out).trim()}`);
    }
    if (title !== ticket!.title) {
      const titleResult = runScript(adapterScript(ticket!.adapter.kind), ticket!.adapter.title(title), adapterEnv(repo));
      if (titleResult.code !== 0) die(`could not update title for ${id} through ${ticket!.adapter.kind} (exit ${titleResult.code}): ${(titleResult.err || titleResult.out).trim()}`);
    }
    const labelled = runScript(adapterScript(ticket!.adapter.kind), ticket!.adapter.label("add"), adapterEnv(repo));
    if (labelled.code !== 0) die(`could not add ready label to ${id} through ${ticket!.adapter.kind} (exit ${labelled.code}): ${(labelled.err || labelled.out).trim()}`);
    return { code: 0, turnpikes };
  });
  if (result.code !== 0) return result.code;
  const runsRoot = join(repo, ".postmaster", "runs");
  mkdirSync(runsRoot, { recursive: true });
  requireOk("log-action.sh", ["--project", repo, "clerk", "note", id, result.turnpikes]);
  const clerkMarker = join(runsRoot, "postmaster", "clerks", `${encodeURIComponent(id)}.json`);
  try { unlinkSync(clerkMarker); } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") die(`cannot close clerk marker for ${id}`);
  }
  writeQueue(repo, id);
  console.log(`ticket-ready: ${id} marked ready and queued`);
  return 0;
}

function pending(repo: string): number {
  const dir = queueDir(repo);
  if (!existsSync(dir)) return 0;
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith(".ready")) continue;
    const id = queueId(join(dir, name));
    if (!id) continue;
    let contents = "";
    try { contents = readFileSync(join(dir, name), "utf8").trim(); } catch { continue; }
    if (contents === id) console.log(id);
  }
  return 0;
}

function main(): number {
  if (args.length < 2) die("usage: ticket-ready.sh <repo> <id> | mark <repo> <id> [--body <file>] [--title <title>] | queue <repo> <id> | pending <repo> | unmark|consume <repo> <id>");
  const verb = args[0]!;
  if (verb === "--body") {
    const bodyPath = args[1]!;
    let labelsPath = "";
    let title = "";
    let project = "";
    for (let i = 2; i < args.length; i += 2) {
      const key = args[i];
      const value = args[i + 1];
      if (!value) die(`missing value for ${key}`);
      if (key === "--labels") labelsPath = value;
      else if (key === "--title") title = value;
      else if (key === "--project") project = value;
      else die(`unknown option ${key}`);
    }
    if (!labelsPath || !title || !project) die("--body requires --labels, --title and --project");
    return otherCheck(project, bodyPath, labelsPath, title);
  }
  if (verb === "pending") {
    if (args.length !== 2) die("pending needs <repo>");
    return pending(resolve(args[1]!));
  }
  const action = verb === "mark" || verb === "queue" || verb === "unmark" || verb === "consume" ? verb : "check";
  const offset = action === "check" ? 0 : 1;
  const repo = resolve(args[offset]!);
  if (action === "check") {
    if (args.length !== 2) die("check needs <repo> <id>");
    return check(repo, args[1]!);
  }
  if (args.length < offset + 2) die(`${action} needs <repo> <id>`);
  const id = args[offset + 1]!;
  if (action === "unmark" || action === "consume") {
    if (args.length !== offset + 2) die(`${action} takes <repo> <id>`);
    if (action === "unmark") {
      const ticket = readTicket(repo, id);
      const removed = runScript(adapterScript(ticket.adapter.kind), ticket.adapter.label("remove"), adapterEnv(repo));
      if (removed.code !== 0) die(`could not remove ready label from ${id}: ${(removed.err || removed.out).trim()}`);
    }
    removeQueue(repo, id);
    console.log(`ticket-ready: ${id} ${action === "unmark" ? "unmarked" : "consumed"}`);
    return 0;
  }
  if (action === "queue") {
    if (args.length !== offset + 2) die("queue takes <repo> <id>");
    const result = check(repo, id);
    if (result !== 0) return result;
    writeQueue(repo, id);
    console.log(`ticket-ready: ${id} queued`);
    return 0;
  }
  let bodyPath = "";
  let title = "";
  for (let i = offset + 2; i < args.length; ) {
    const key = args[i];
    const value = args[i + 1];
    if (!value) die(`missing value for ${key}`);
    if (key === "--body") bodyPath = value;
    else if (key === "--title") title = value;
    else die(`unknown option ${key}`);
    i += 2;
  }
  return mark(repo, id, bodyPath, title);
}

process.exit(main());
