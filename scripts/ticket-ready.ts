// Say whether a ticket is ready to run, and mark it when the user says it is.
//
// A ticket is ready when it passes ticket-check and ticket-parts --final and
// carries the ready mark. The clerk marks it once the user signs the draft
// off; the postmaster asks before it dispatches anything, and refuses what is
// not ready instead of dispatching it.
//
// Usage:
//   run ticket-ready <repo> <id>                       exit 0 when ready, 2 with one line per reason
//   run ticket-ready --body <file> --labels <list> --project <repo> --id <id> [--title <t>]
//   run ticket-ready mark <repo> <id> [--body <file>] [--title <title>]
//   run ticket-ready mark --body <file> --labels <list> --repo <repo> --id <id> [--title <t>]
//   run ticket-ready unmark <repo> <id>
//   run ticket-ready consume <repo> <id>
//   run ticket-ready pending <repo>
//   run ticket-ready queue <repo> <id>
//
// The --body forms check a tracker of kind other from a body file and a label
// list, as ticket-check --body does; the mark --body form records the marking
// after the label is applied through the tracker's own tooling. Pass --labels
// once per label, each flag one whole name; a lone flag with a comma is
// refused as ambiguous. mark writes the ledger note with the ticket's turnpikes
// line as the user's word, and every marking queues a ready marker under the
// project's run root; the marker binds the sign-off to the signed-off title
// and body, and a check against a changed ticket refuses until the user signs
// the new text off again. The check --body form takes the same --project,
// --id and --title the marking took, so it verifies that binding; a title
// passed differently reads as a changed ticket. consume drops the marker when
// the postmaster dispatches, and unmark drops the mark with it. A marking with
// a clerk session recorded arms that session's close: once the clerk's turn
// ends, the session's tab closes and its record drops.
//
// Exit 0 the ticket is ready, or the verb did its work; 2 the ticket is not
// ready, or the marking was refused; 1 anything else (an unreadable ticket,
// an unknown tracker, usage).
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { clerkSessionPath } from "./clerk.ts";
import { scriptsDir } from "./lib/paths.ts";
import { run } from "./lib/proc.ts";

const HERE = scriptsDir(import.meta);

function die(message: string, code = 1): never {
  console.error(`ticket-ready: ${message}`);
  process.exit(code);
}

function runScript(name: string, args: string[]): { code: number; out: string; err: string } {
  const r = run(join(HERE, "run"), [name, ...args]);
  return { code: r.code, out: r.out ?? "", err: r.err ?? "" };
}

function trackerKind(repo: string): string {
  const r = runScript("tracker-kind", [repo]);
  if (r.code !== 0) die(`run tracker-kind ${repo}: ${(r.out + r.err).trim() || `exit ${r.code}`}`);
  return r.out.trim();
}

function hasAdapter(kind: string): boolean {
  return kind === "github" || kind === "local" || kind === "plane";
}

// A tracker of kind other has no adapter script: refuse the adapter verbs
// with the body-and-labels form that serves them, as ticket-check does.
function needAdapter(kind: string, instead: string): void {
  if (hasAdapter(kind)) return;
  die(
    `tracker kind '${kind}' has no adapter script; read the ticket with its own tooling (trackers.md, other) and run: run ticket-ready ${instead}`,
  );
}

// The read every adapter prints: header fields, a blank line, then the body.
// ticket-parts tolerates the ## Log trailer the adapters append, so the body
// is checked as read, exactly as ticket-check reads it. The `labels:` line is
// display-only and never parsed back: a label name may itself hold commas, so
// membership is asked of the adapter with has-label instead.
function parseTicketRead(out: string): { title: string; body: string } {
  const lines = out.split("\n");
  let title = "";
  let i = 0;
  for (; i < lines.length; i++) {
    const line = (lines[i] ?? "").replace(/\r$/u, "");
    if (line === "") break;
    const m = /^([A-Za-z-]+):[ \t]*(.*)$/u.exec(line);
    if (!m) continue;
    // ASCII: adapter header names are machine-written; folded once against ASCII literals.
    if (m[1]!.toLowerCase() === "title") title = m[2]!;
  }
  return { title, body: lines.slice(i + 1).join("\n") };
}

function hasReadyMark(labels: string[]): boolean {
  // ASCII: folds label names for the ASCII literal "ready"; only ASCII-equal names match.
  return labels.some((l) => l.toLowerCase() === "ready");
}

type CheckInput = { body: string; title: string; project: string };

function runChecks(input: CheckInput): { reasons: string[]; turnpikes: string } {
  const work = mkdtempSync(join(tmpdir(), "ticket-ready-"));
  try {
    const bodyFile = join(work, "body.md");
    writeFileSync(bodyFile, input.body);
    const reasons: string[] = [];
    let turnpikes = "";
    const checkArgs = ["--body", bodyFile];
    if (input.title) checkArgs.push("--title", input.title);
    if (input.project) checkArgs.push("--project", input.project);
    const checkR = runScript("ticket-check", checkArgs);
    if (checkR.code !== 0) {
      for (const line of (checkR.out + checkR.err).split("\n")) {
        const t = line.trim();
        if (t) reasons.push(`ticket-check: ${t}`);
      }
    } else {
      for (const line of checkR.out.split("\n")) {
        if (line.startsWith("turnpikes:")) turnpikes = line.trim();
      }
    }
    const partsR = runScript("ticket-parts", [bodyFile, "--final"]);
    const partsText = partsR.out + partsR.err;
    if (partsR.code !== 0) {
      for (const line of partsText.split("\n")) {
        const t = line.trim();
        if (t) reasons.push(`ticket-parts: ${t}`);
      }
    }
    // ticket-parts stops at a structural failure, so on a ticket failing
    // several ways its draft finding never prints; name the draft line then.
    const first = input.body.split("\n").find((l) => l.trim() !== "") ?? "";
    if (first.startsWith("DRAFT:") && !/draft/iu.test(partsText)) {
      reasons.unshift("the first line is a DRAFT line");
    }
    return { reasons, turnpikes };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function reportCheck(
  repo: string,
  id: string,
  title: string,
  ready: boolean,
  body: string,
  stored: string,
): number {
  const reasons: string[] = [];
  if (!ready) reasons.push("ready label is missing");
  const queued = queuedMark(repo, id);
  if (!queued.bound && queued.malformed)
    reasons.push(
      `the ready marker for ${id} is malformed; run run ticket-ready unmark ${repo} ${id} and sign the ticket off again`,
    );
  else if (queued.bound && queued.digest !== digestOf(title, stored))
    reasons.push(
      "the ticket changed since it was signed off; open the clerk again to sign off the new text",
    );
  const { reasons: found, turnpikes } = runChecks({ body, title, project: repo });
  reasons.push(...found);
  if (reasons.length > 0) {
    for (const r of reasons) console.log(r);
    return 2;
  }
  console.log(`ready: ${id}`);
  if (!turnpikes) die(`checked ${id} but ticket-check printed no turnpikes line`);
  console.log(turnpikes);
  return 0;
}

// --- the ready queue: one marker per ticket under the project's run root ---

function readyDir(repo: string): string {
  return join(repo, ".postmaster", "runs", "postmaster", "ready");
}

function markerPath(repo: string, id: string): string {
  return join(readyDir(repo), `${encodeURIComponent(id)}.ready`);
}

// The marker binds the sign-off to the signed-off text: the ticket id, then
// the sha256 of the stored title and body. Adapter paths bind exactly what
// `read --body` prints, never the display read: the display appends the
// `## Log` comment trailer, which would false-refuse on any comment and
// would let a genuine Log-shaped tail hide from the digest. A post-sign-off
// tracker edit changes the digest, and the next check refuses until the user
// signs the new text off again; a comment does not.
// The --body forms take a caller-pasted file, which may be a display read
// with its trailer: only there does a `## Log` line whose following lines
// are all comments or blank cut.
function unsignedBody(body: string): string {
  const lines = body.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i] !== "## Log") continue;
    const tail = lines.slice(i + 1);
    if (tail.every((l) => l === "" || l.startsWith("- "))) return lines.slice(0, i).join("\n");
  }
  return body;
}

function digestOf(title: string, body: string): string {
  return createHash("sha256").update(`${title}\n${body}`).digest("hex");
}

// The body here is the stored text: adapter callers pass `read --body`,
// --body callers pass the file through unsignedBody.
function writeQueue(repo: string, id: string, title: string, body: string): void {
  mkdirSync(readyDir(repo), { recursive: true });
  writeFileSync(markerPath(repo, id), `${id}\n${digestOf(title, body)}\n`);
}

type QueuedMark = { bound: true; digest: string } | { bound: false; malformed: boolean };

// A missing marker means unbound; a present but malformed one fails closed,
// never silently unbound: the check refuses it until the ticket is signed
// off again.
function queuedMark(repo: string, id: string): QueuedMark {
  let text = "";
  try {
    text = readFileSync(markerPath(repo, id), "utf8");
  } catch {
    return { bound: false, malformed: false };
  }
  const [first, second] = text.split("\n");
  if (first !== id || !/^[0-9a-f]{64}$/u.test(second ?? ""))
    return { bound: false, malformed: true };
  return { bound: true, digest: second as string };
}

function removeQueue(repo: string, id: string): void {
  rmSync(markerPath(repo, id), { force: true });
}

function pendingQueue(repo: string): string[] {
  let names: string[] = [];
  try {
    names = readdirSync(readyDir(repo));
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of names.sort()) {
    if (!name.endsWith(".ready")) continue;
    try {
      const first = readFileSync(join(readyDir(repo), name), "utf8").split("\n")[0] ?? "";
      if (first === decodeURIComponent(name.slice(0, -".ready".length))) out.push(first);
    } catch {
      // A marker being written beside this listing is listed next time.
    }
  }
  return out;
}

function labelViaAdapter(
  repo: string,
  id: string,
  kind: string,
  verb: "add" | "remove",
  name = "ready",
): void {
  const base = kind === "plane" ? [] : [repo];
  const r = runScript(`${kind}`, [...base, "label", id, verb, name]);
  if (r.code !== 0)
    die(`the ${kind} adapter could not ${verb} the label (${(r.out + r.err).trim()})`);
}

function readViaAdapter(repo: string, id: string, kind: string): { title: string; body: string } {
  const base = kind === "plane" ? [] : [repo];
  const r = runScript(`${kind}`, [...base, "read", id]);
  if (r.code !== 0) die(`the ${kind} adapter could not read ${id} (${(r.out + r.err).trim()})`, 1);
  return parseTicketRead(r.out);
}

// The stored body, without the display read's comment trailer: what the
// edit base and the marker digest are taken from.
function bodyViaAdapter(repo: string, id: string, kind: string): string {
  const base = kind === "plane" ? [] : [repo];
  const r = runScript(`${kind}`, [...base, "read", id, "--body"]);
  if (r.code !== 0)
    die(`the ${kind} adapter could not read the body of ${id} (${(r.out + r.err).trim()})`, 1);
  return r.out;
}

// Exact membership, answered by the adapter against the tracker's own list:
// never by splitting the comma-joined `labels:` line, where one name can
// hold a comma and read back as two.
function readyViaAdapter(repo: string, id: string, kind: string): boolean {
  const base = kind === "plane" ? [] : [repo];
  const r = runScript(`${kind}`, [...base, "has-label", id, "ready"]);
  if (r.code !== 0)
    die(
      `the ${kind} adapter could not check the ready label on ${id} (${(r.out + r.err).trim()})`,
      1,
    );
  return r.out.trim() === "present";
}

function armClerkClose(repo: string, id: string): boolean {
  // The clerk marks its own ticket from inside its session, so the session
  // cannot close yet: keep its record, marked closing, and start the closer
  // detached. It waits for the turn to end, closes that one session, and drops
  // the record. A missing record, or none naming a session, arms nothing.
  let record: Record<string, unknown> = {};
  try {
    record = JSON.parse(readFileSync(clerkSessionPath(repo, id), "utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return false;
  }
  if (typeof record.handle !== "string" || !record.handle) return false;
  const handle = record.handle;
  let log = -1;
  try {
    log = openSync(
      join(dirname(clerkSessionPath(repo, id)), `${encodeURIComponent(id)}.close.log`),
      "a",
    );
  } catch {
    console.error("ticket-ready: could not open the clerk close log; close the session by hand");
    return false;
  }
  try {
    const child = spawn(join(HERE, "run"), ["host", "_clerk-close", repo, id, handle], {
      detached: true,
      stdio: ["ignore", log, log],
    });
    // A spawn failure arrives as async 'error', never as a throw: listen for
    // it, and read the pid while still synchronous. No pid means no closer.
    child.on("error", () => {});
    child.unref();
    if (child.pid === undefined) throw new Error("the clerk closer did not start");
  } catch {
    console.error("ticket-ready: could not start the clerk closer; close the session by hand");
    try {
      closeSync(log);
    } catch {}
    return false;
  }
  try {
    closeSync(log);
  } catch {}
  try {
    writeFileSync(
      clerkSessionPath(repo, id),
      `${JSON.stringify({ ...record, closing: new Date().toISOString() })}\n`,
    );
  } catch {}
  return true;
}

function logLedgerNote(repo: string, id: string, turnpikes: string): void {
  const r = runScript("log-action", ["--project", repo, "clerk", "note", id, turnpikes]);
  if (r.code !== 0) die(`the ledger note could not be written (${(r.out + r.err).trim()})`);
}

// Every tracker write the marking makes is also a ticket-edit line, as
// trackers.md demands of every adapter write.
function logTicketEdit(repo: string, id: string, what: string): void {
  const r = runScript("log-action", ["--project", repo, "clerk", "ticket-edit", id, what]);
  if (r.code !== 0) die(`the ticket-edit line could not be written (${(r.out + r.err).trim()})`);
}

function stripOneNewline(s: string): string {
  return s.endsWith("\n") ? s.slice(0, -1) : s;
}

function firstDifferingLine(
  a: string,
  b: string,
): { line: number; aLine: string | undefined; bLine: string | undefined } {
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  const max = Math.max(aLines.length, bLines.length);
  for (let i = 0; i < max; i++) {
    if (aLines[i] !== bLines[i]) return { line: i + 1, aLine: aLines[i], bLine: bLines[i] };
  }
  return { line: max, aLine: aLines[max - 1], bLine: bLines[max - 1] };
}

function markAdapterTicket(
  repo: string,
  id: string,
  kind: string,
  draftFile: string,
  draftTitle: string,
): number {
  const live = readViaAdapter(repo, id, kind);
  const stored = bodyViaAdapter(repo, id, kind);
  let body = live.body;
  let title = live.title;
  if (draftFile) body = readFileSync(draftFile, "utf8");
  if (draftTitle) title = draftTitle;
  const { reasons, turnpikes } = runChecks({ body, title, project: repo });
  if (reasons.length > 0) {
    for (const r of reasons) console.log(r);
    return 2;
  }
  if (!turnpikes) die(`checked ${id} but ticket-check printed no turnpikes line`);
  const base = kind === "plane" ? [] : [repo];
  // The edit decision and base use the stored body: the display read carries
  // the comment trailer, which the adapters do not compare against.
  let didWriteBody = false;
  if (draftFile && body !== stored) {
    const work = mkdtempSync(join(tmpdir(), "ticket-ready-"));
    try {
      const baseFile = join(work, "base.md");
      const newFile = join(work, "new.md");
      writeFileSync(baseFile, stored);
      writeFileSync(newFile, body);
      const r = runScript(`${kind}`, [...base, "edit", id, newFile, baseFile]);
      if (r.code !== 0)
        die(`the ${kind} adapter could not write the body (${(r.out + r.err).trim()})`);
      logTicketEdit(repo, id, "body updated");
      didWriteBody = true;
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }
  if (draftTitle && title !== live.title) {
    const r = runScript(`${kind}`, [...base, "title", id, title]);
    if (r.code !== 0)
      die(`the ${kind} adapter could not write the title (${(r.out + r.err).trim()})`);
    logTicketEdit(repo, id, "title updated");
  }
  let armed = false;
  if (kind === "github") {
    // Read back before the label goes on, and compare without writing
    // anything: a check that writes can change what it checks, and on GitHub
    // it does. A failed read or a mismatch leaves neither the label nor the
    // marker, so there is nothing to roll back.
    const freshBodyRaw = bodyViaAdapter(repo, id, kind);
    const freshLive = readViaAdapter(repo, id, kind);
    const signedBody = draftFile ? body : stored;
    const diffs: string[] = [];
    // On either path the stored bytes are the raw read with the one newline
    // read --body adds taken off: the draft when the mark wrote, else the
    // bytes the mark started from. A difference names its first line, so a
    // refusal on a mark that wrote nothing says as much as one that wrote.
    const freshStored = stripOneNewline(freshBodyRaw);
    const expectStored = didWriteBody ? signedBody : stripOneNewline(stored);
    if (freshStored !== expectStored) {
      const d = firstDifferingLine(expectStored, freshStored);
      const aDisp = d.aLine === undefined ? "(no line)" : JSON.stringify(d.aLine);
      const bDisp = d.bLine === undefined ? "(no line)" : JSON.stringify(d.bLine);
      diffs.push(`the body differs at line ${d.line} (signed ${aDisp} vs stored ${bDisp})`);
    }
    if (freshLive.title !== title) {
      diffs.push(
        `the title differs (signed ${JSON.stringify(title)} vs stored ${JSON.stringify(freshLive.title)})`,
      );
    }
    if (diffs.length > 0) {
      die(`the ticket changed while it was being marked: ${diffs.join("; ")}; run mark again`);
    }
    labelViaAdapter(repo, id, kind, "add");
    logTicketEdit(repo, id, "label add ready");
    logLedgerNote(repo, id, turnpikes);
    // Bind the marker to the bytes just verified, as the check will read
    // them, not to the draft bytes.
    writeQueue(repo, id, freshLive.title, freshBodyRaw);
    armed = armClerkClose(repo, id);
  } else {
    // Bind and confirm with the adapter's own comparison before the label
    // goes on, so a mismatch or read failure leaves nothing to undo. An edit
    // that landed between the write and the binding read fails the confirm,
    // and retrying converges.
    const boundBody = bodyViaAdapter(repo, id, kind);
    const signed = draftFile ? body : stored;
    const confirm = storedMatches(repo, id, kind, signed);
    if (confirm !== null) {
      die(`the ticket changed while it was being marked (${confirm}); run mark again`);
    }
    labelViaAdapter(repo, id, kind, "add");
    logTicketEdit(repo, id, "label add ready");
    logLedgerNote(repo, id, turnpikes);
    writeQueue(repo, id, title, boundBody);
    armed = armClerkClose(repo, id);
  }
  console.log(`ticket-ready: ${id} marked ready and queued`);
  if (armed) console.log(`ticket-ready: its clerk session closes when its turn ends`);
  return 0;
}

// Null when the tracker still holds the signed bytes, else the adapter's
// reason: a no-op edit, so the comparison is the adapter's own and no
// normalization is reimplemented here.
export function storedMatches(
  repo: string,
  id: string,
  kind: string,
  signed: string,
): string | null {
  const base = kind === "plane" ? [] : [repo];
  const work = mkdtempSync(join(tmpdir(), "ticket-ready-"));
  try {
    const baseFile = join(work, "base.md");
    const newFile = join(work, "new.md");
    writeFileSync(baseFile, signed);
    writeFileSync(newFile, signed);
    const r = runScript(`${kind}`, [...base, "edit", id, newFile, baseFile]);
    return r.code === 0 ? null : (r.out + r.err).trim();
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function takeFlag(argv: string[], name: string): string {
  const i = argv.indexOf(name);
  if (i < 0 || i + 1 >= argv.length) die(`usage: ${usage()}`);
  const value = argv[i + 1]!;
  if (value.startsWith("--")) die(`${name} needs a value; got ${value}`);
  return value;
}

function takeFlags(argv: string[], name: string): string[] {
  const values: string[] = [];
  for (let i = 0; i + 1 < argv.length; i++) {
    if (argv[i] === name) {
      const value = argv[i + 1]!;
      if (value.startsWith("--")) die(`${name} needs a value; got ${value}`);
      values.push(value);
    }
  }
  if (values.length === 0) die(`usage: ${usage()}`);
  return values;
}

// A caller naming the ticket's labels by hand (kind other) passes --labels
// once per label, each flag one whole name. A lone flag with a comma is
// ambiguous — one name or several — and guessing wrong reads ready, so it is
// refused instead of split.
function labelsFromFlags(argv: string[]): string[] {
  const values = takeFlags(argv, "--labels");
  if (values.length > 1) return values.map((v) => v.trim()).filter(Boolean);
  const single = values[0]!;
  if (single.includes(","))
    die("one --labels flag with a comma is ambiguous; pass --labels once per label");
  return [single.trim()].filter(Boolean);
}

function usage(): string {
  return [
    "run ticket-ready <repo> <id>",
    "run ticket-ready --body <file> --labels <list> --project <repo> --id <id> [--title <t>]",
    "run ticket-ready mark <repo> <id> [--body <file>] [--title <title>]",
    "run ticket-ready mark --body <file> --labels <list> --repo <repo> --id <id> [--title <t>]",
    "run ticket-ready unmark <repo> <id> | consume <repo> <id> | pending <repo> | queue <repo> <id>",
  ].join(" | ");
}

function main(argv: string[]): number {
  if (argv.length === 0) die(`usage: ${usage()}`);
  if (argv[0] === "--body") {
    if (argv[1] === "--labels" || argv[1] === undefined) die(`usage: ${usage()}`);
    const body = readFileSync(argv[1]!, "utf8");
    const labels = labelsFromFlags(argv);
    const title = argv.includes("--title") ? takeFlag(argv, "--title") : "";
    const project = takeFlag(argv, "--project");
    const id = takeFlag(argv, "--id");
    process.env.POSTMASTER_PROJECT = resolve(project);
    const reasons: string[] = [];
    if (!hasReadyMark(labels)) reasons.push("ready label is missing");
    const queued = queuedMark(project, id);
    if (!queued.bound && queued.malformed)
      reasons.push(
        `the ready marker for ${id} is malformed; remove the ready label through the tracker's own tooling, run run ticket-ready consume ${project} ${id}, and mark again`,
      );
    else if (queued.bound && queued.digest !== digestOf(title, unsignedBody(body)))
      reasons.push(
        "the ticket changed since it was signed off; open the clerk again to sign off the new text",
      );
    const { reasons: found, turnpikes } = runChecks({ body, title, project });
    reasons.push(...found);
    if (reasons.length > 0) {
      for (const r of reasons) console.log(r);
      return 2;
    }
    console.log("ready: --body");
    if (!turnpikes) die("checked --body but ticket-check printed no turnpikes line");
    console.log(turnpikes);
    return 0;
  }
  const verb = argv[0]!;
  if (verb === "mark" && argv[1] === "--body") {
    const body = readFileSync(takeFlag(argv, "--body"), "utf8");
    const labels = labelsFromFlags(argv);
    const repo = takeFlag(argv, "--repo");
    const id = takeFlag(argv, "--id");
    const title = argv.includes("--title") ? takeFlag(argv, "--title") : "";
    process.env.POSTMASTER_PROJECT = resolve(repo);
    if (!hasReadyMark(labels))
      die("apply the ready label through the tracker's own tooling first, then mark again", 2);
    const { reasons, turnpikes } = runChecks({ body, title, project: repo });
    if (reasons.length > 0) {
      for (const r of reasons) console.log(r);
      return 2;
    }
    if (!turnpikes) die(`checked ${id} but ticket-check printed no turnpikes line`);
    logLedgerNote(repo, id, turnpikes);
    writeQueue(repo, id, title, unsignedBody(body));
    const armed = armClerkClose(repo, id);
    console.log(`ticket-ready: ${id} marked ready and queued`);
    if (armed) console.log(`ticket-ready: its clerk session closes when its turn ends`);
    return 0;
  }
  if (
    verb === "mark" ||
    verb === "unmark" ||
    verb === "consume" ||
    verb === "pending" ||
    verb === "queue"
  ) {
    const repo = argv[1] ?? die(`usage: ${usage()}`);
    process.env.POSTMASTER_PROJECT = resolve(repo);
    if (verb === "pending") {
      if (argv.length !== 2) die(`usage: ${usage()}`);
      for (const id of pendingQueue(repo)) console.log(id);
      return 0;
    }
    const id = argv[2] ?? die(`usage: ${usage()}`);
    if (verb === "unmark") {
      if (argv.length !== 3) die(`usage: ${usage()}`);
      const kind = trackerKind(repo);
      if (!hasAdapter(kind)) {
        die(
          `tracker kind '${kind}' has no adapter script; remove the ready label through the tracker's own tooling (trackers.md, other), then run: run ticket-ready consume ${repo} ${id}`,
        );
      }
      labelViaAdapter(repo, id, kind, "remove");
      logTicketEdit(repo, id, "label remove ready");
      removeQueue(repo, id);
      console.log(`ticket-ready: ${id} ready mark removed`);
      return 0;
    }
    if (verb === "consume") {
      if (argv.length !== 3) die(`usage: ${usage()}`);
      removeQueue(repo, id);
      console.log(`ticket-ready: ${id} ready marker consumed`);
      return 0;
    }
    if (verb === "queue") {
      if (argv.length !== 3) die(`usage: ${usage()}`);
      const kind = trackerKind(repo);
      needAdapter(kind, "mark --body <file> --labels <list> --repo <repo> --id <id>");
      const ticket = readViaAdapter(repo, id, kind);
      const stored = bodyViaAdapter(repo, id, kind);
      const rc = reportCheck(
        repo,
        id,
        ticket.title,
        readyViaAdapter(repo, id, kind),
        ticket.body,
        stored,
      );
      // The check above refuses a changed ticket, so this never rebinds the
      // marker silently; it refreshes an unchanged binding, or binds a ticket
      // whose label was applied by hand.
      if (rc !== 0) return rc;
      // Bind the same bytes the check just verified, never a fresh read or
      // the display body: a mid-queue tracker edit must refuse next time,
      // not bind silently, and comments are not sign-off text.
      writeQueue(repo, id, ticket.title, stored);
      console.log(`ticket-ready: ${id} queued for dispatch`);
      return 0;
    }
    // mark <repo> <id> [--body <file>] [--title <title>]
    const rest = argv.slice(3);
    let draftFile = "";
    let draftTitle = "";
    for (let i = 0; i < rest.length; i++) {
      const flag = rest[i]!;
      if ((flag === "--body" || flag === "--title") && i + 1 < rest.length) {
        const value = rest[i + 1]!;
        if (value.startsWith("--")) die(`${flag} needs a value; got ${value}`);
        if (flag === "--body") draftFile = value;
        else draftTitle = value;
        i++;
      } else die(`usage: ${usage()}`);
    }
    const kind = trackerKind(repo);
    needAdapter(kind, "mark --body <file> --labels <list> --repo <repo> --id <id>");
    return markAdapterTicket(repo, id, kind, draftFile, draftTitle);
  }
  if (argv.length !== 2) die(`usage: ${usage()}`);
  const repo = argv[0]!;
  const id = argv[1]!;
  process.env.POSTMASTER_PROJECT = resolve(repo);
  const kind = trackerKind(repo);
  needAdapter(kind, "--body <file> --labels <list> --project <repo> --id <id> [--title <t>]");
  const ticket = readViaAdapter(repo, id, kind);
  return reportCheck(
    repo,
    id,
    ticket.title,
    readyViaAdapter(repo, id, kind),
    ticket.body,
    bodyViaAdapter(repo, id, kind),
  );
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
