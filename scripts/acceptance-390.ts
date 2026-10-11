// Oracle helpers for #390: a command writes the ship card's printed parts
// into the card, so the coachman copies none of them by hand. The tests spawn
// git and scripts/run as subprocesses; nothing here imports the change.
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beside } from "./lib/paths.ts";
import { run } from "./lib/proc.ts";

export const RUN = beside(import.meta, "run");
export const TICKET = "t390";
export const DEFAULT = "main";
export const REPO_ROOT = join(import.meta.dir, "..");

export function gitOrThrow(repo: string, ...args: string[]): string {
  const r = run("git", ["-C", repo, ...args]);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.err.trim() || r.out.trim()}`);
  return r.out.trim();
}

export function scratchDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function removeDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

export interface Layout {
  dir: string;
  repo: string;
  wt: string;
  dispatch: string;
  ticket: string;
  checkpoint: string;
  card: string;
  head12: string;
  recordRoot: string;
}

const CHECKS =
  '{"checks": [{"name": "gate", "source": "default:gate", "command": "true", "shows": "x"}, ' +
  '{"name": "unit", "source": "declared:unit", "command": "true", "shows": "x"}]}\n';

const verifyLine = (target: string, on: string, result: string, exit: number): string =>
  `{"action": "verify", "target": "${target}", "ts": "2026-01-01T00:00:00Z", ` +
  `"detail": "on=${on} result=${result} exit=${exit} secs=1"}\n`;

const reachLine = (event: Record<string, unknown>): string =>
  `${JSON.stringify({
    ts: "2026-01-01T00:00:00Z",
    actor: "coachman",
    action: "reach",
    target: event.point,
    detail: JSON.stringify(event),
  })}\n`;

function coachmanCard(head12: string, main12: string, wt: string): string {
  return (
    "# Ship card\n\nMode: synthesis\n\n" +
    `Branch ${TICKET} at ${head12}: the ticket change.\n\n` +
    "## Merge\n\n" +
    `Main ${DEFAULT} at ${main12}, taken in cleanly. Resolved by hand: none.\n\n` +
    "## Turnpikes\n\nstyle, bug, security: no rounds yet in this fixture.\n\n" +
    "## Style residue\n\nnone\n\n" +
    "## Branches\n\nt390 carries the change.\n\n" +
    "## Lane outcomes\n\nnone: a fixture card.\n\n" +
    "## QA and browser suite\n\nnone\n\n" +
    "## Review link\n\n" +
    `${wt}\n`
  );
}

/** A scratch run shaped like the ticket's C1 dispatch: recorded checks, a
 * checkpoint holding one open and one user-applied finding, reach records
 * with notes (one naming the record root, which renders as an empty name),
 * a switch-off entry with its reason, and a private-data finding with its
 * resolution. The card holds only the coachman's sections. */
export function scratchLayout(tmp: string, name: string): Layout {
  const dir = join(tmp, name);
  const repo = join(dir, "repo");
  const wt = join(dir, "wt");
  const dispatch = join(dir, "dispatch");
  mkdirSync(dispatch, { recursive: true });
  const ticket = TICKET;
  const init = run("git", ["init", "-q", "-b", DEFAULT, repo]);
  if (init.code !== 0) throw new Error(`git init: ${init.err.trim() || init.out.trim()}`);
  gitOrThrow(repo, "config", "user.name", "brindlewick");
  gitOrThrow(repo, "config", "user.email", "332054101+brindlewick@users.noreply.github.com");
  gitOrThrow(repo, "config", "commit.gpgsign", "false");
  writeFileSync(join(repo, "main.txt"), "main\n", "utf8");
  gitOrThrow(repo, "add", "main.txt");
  gitOrThrow(repo, "commit", "-q", "-m", "base");
  const main12 = gitOrThrow(repo, "rev-parse", "HEAD").slice(0, 12);
  gitOrThrow(repo, "worktree", "add", "-q", wt, "-b", ticket);
  mkdirSync(join(wt, "scripts"), { recursive: true });
  writeFileSync(
    join(wt, "scripts", "switch.ts"),
    "// @ts-ignore -- fixture switch-off reason\nconst x: string = 1;\n",
    "utf8",
  );
  gitOrThrow(wt, "add", "scripts/switch.ts");
  gitOrThrow(wt, "commit", "-q", "-m", "the ticket change");
  const head12 = gitOrThrow(wt, "rev-parse", "HEAD").slice(0, 12);
  const recordRoot = realpathSync(resolve(dispatch, "..", "..", ".."));
  writeFileSync(join(dispatch, "checks.json"), CHECKS, "utf8");
  writeFileSync(
    join(dispatch, "actions.jsonl"),
    verifyLine("gate", `${ticket}@${head12}`, "pass", 0) +
      verifyLine("unit", `${ticket}@${head12}`, "pass", 0) +
      reachLine({ kind: "point", point: "workhorses", result: "clean", lanes: [] }) +
      reachLine({ kind: "point", point: "card", result: "note", lanes: ["haiku", "luna"] }) +
      reachLine({
        kind: "note",
        point: "card",
        lane: "haiku",
        access: "read",
        place: "main checkout",
        path: recordRoot,
        reason: "reads the project folder itself",
      }) +
      reachLine({
        kind: "note",
        point: "card",
        lane: "luna",
        access: "read",
        place: "worktree",
        path: join(wt, "scripts", "switch.ts"),
        reason: "reads the ticket file",
      }),
    "utf8",
  );
  writeFileSync(join(dispatch, "run.json"), `${JSON.stringify({ mode: "synthesis" })}\n`, "utf8");
  const finding = { rule: "email", file: "notes.txt", line: 1, commit: "a".repeat(40) };
  writeFileSync(join(dispatch, "detections.jsonl"), `${JSON.stringify(finding)}\n`, "utf8");
  writeFileSync(
    join(dispatch, "detections-resolved.jsonl"),
    `${JSON.stringify({ ...finding, resolution: "removed" })}\n`,
    "utf8",
  );
  const checkpoint = join(dispatch, "checkpoint.md");
  writeFileSync(
    checkpoint,
    "## Findings (bug)\n\n- [P1] bug-1: open\n- [P2] bug-2: applied on user word, not re-reviewed\n",
    "utf8",
  );
  const card = join(dispatch, "card.md");
  writeFileSync(card, coachmanCard(head12, main12, wt), "utf8");
  return { dir, repo, wt, dispatch, ticket, checkpoint, card, head12, recordRoot };
}

export interface Call {
  code: number;
  out: string;
  err: string;
}

export function landing(...args: string[]): Call {
  const r = run(RUN, ["landing", ...args]);
  return { code: r.code, out: r.out, err: r.err };
}

export function cardWrite(layout: Layout, ...extra: string[]): Call {
  return landing(
    "card-write",
    layout.dispatch,
    layout.wt,
    layout.checkpoint,
    layout.card,
    "--repo",
    layout.repo,
    "--default",
    DEFAULT,
    "--ticket",
    layout.ticket,
    ...extra,
  );
}

/** The exact bytes each printed part renders as, straight from the records. */
export function rendered(layout: Layout): { block: string; switchOffs: string; privateData: string } {
  const block = landing("card-block", layout.dispatch, layout.wt, layout.checkpoint);
  if (block.code !== 0) throw new Error(`card-block failed: ${block.err}${block.out}`);
  const switches = landing(
    "switch-offs",
    "--repo",
    layout.repo,
    "--default",
    DEFAULT,
    "--ticket",
    layout.ticket,
    "--dispatch",
    layout.dispatch,
  );
  if (switches.code !== 0 && switches.code !== 2) {
    throw new Error(`switch-offs failed: ${switches.err}${switches.out}`);
  }
  const privateData = landing("private-data-block", layout.dispatch);
  if (privateData.code !== 0) throw new Error(`private-data-block failed: ${privateData.err}`);
  return {
    block: block.out,
    switchOffs: switches.out.slice(switches.out.indexOf("\n") + 1),
    privateData: privateData.out,
  };
}

export function checkResults(layout: Layout): Call {
  return landing("card-results", layout.dispatch, layout.wt, layout.checkpoint, layout.card);
}

export function checkFindings(layout: Layout): Call {
  return landing("card-findings", layout.dispatch, layout.wt, layout.checkpoint, layout.card);
}

export function checkPrivateData(layout: Layout): Call {
  return landing("private-data-card", layout.dispatch, layout.card);
}

export function readCard(layout: Layout): string {
  return readFileSync(layout.card, "utf8");
}

export function writeCard(layout: Layout, text: string): void {
  writeFileSync(layout.card, text, "utf8");
}

export function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** The C1 record moves: the open finding closes, a reach note lands, and a
 * second private-data finding arrives with its resolution. */
export function moveRecords(layout: Layout): void {
  writeFileSync(
    layout.checkpoint,
    "## Findings (bug)\n\n- [P1] bug-1: closed round 2\n- [P2] bug-2: applied on user word, not re-reviewed\n",
    "utf8",
  );
  appendFileSync(
    join(layout.dispatch, "actions.jsonl"),
    reachLine({
      kind: "note",
      point: "card",
      lane: "luna",
      access: "read",
      place: "worktree",
      path: join(layout.wt, "scripts", "switch.ts"),
      reason: "a second look",
    }),
    "utf8",
  );
  const finding = { rule: "token", file: "settings.json", line: 2, commit: "b".repeat(40) };
  appendFileSync(join(layout.dispatch, "detections.jsonl"), `${JSON.stringify(finding)}\n`, "utf8");
  appendFileSync(
    join(layout.dispatch, "detections-resolved.jsonl"),
    `${JSON.stringify({ ...finding, resolution: "marked" })}\n`,
    "utf8",
  );
}

/** A second switch-off without a reason, committed on the ticket branch. */
export function addNoReasonSwitch(layout: Layout): void {
  writeFileSync(
    join(layout.wt, "scripts", "bare.ts"),
    "// @ts-ignore\nconst y: string = 2;\n",
    "utf8",
  );
  gitOrThrow(layout.wt, "add", "scripts/bare.ts");
  gitOrThrow(layout.wt, "commit", "-q", "-m", "a switch-off without a reason");
}

/** The user's refusal of the fixture switch-off, in the run's actions and
 * the project ledger alike, as approvals() requires. */
export function refuseSwitch(layout: Layout): string {
  const switches = landing(
    "switch-offs",
    "--repo",
    layout.repo,
    "--default",
    DEFAULT,
    "--ticket",
    layout.ticket,
    "--dispatch",
    layout.dispatch,
  );
  const id = /\(id (comment:[0-9a-f]{16})\)/u.exec(switches.out)?.[1];
  if (!id) throw new Error(`no switch-off id in: ${switches.out}`);
  const line =
    `${JSON.stringify({
      ts: "2026-01-01T00:00:00Z",
      project: "fixture",
      run: layout.dispatch.slice(layout.dispatch.lastIndexOf("/") + 1),
      actor: "postmaster",
      action: "switch-off",
      target: id,
      detail: "refused the fixture suppression because the type error needs a fix",
    })}\n`;
  appendFileSync(join(layout.dispatch, "actions.jsonl"), line, "utf8");
  appendFileSync(join(layout.dir, "ledger.jsonl"), line, "utf8");
  return id;
}

export function coachmanDoc(): string {
  return readFileSync(join(REPO_ROOT, "skills", "postmaster", "coachman.md"), "utf8");
}

export function postmasterDoc(): string {
  return readFileSync(join(REPO_ROOT, "skills", "postmaster", "postmaster.md"), "utf8");
}

/** Step 5 of the coachman's Stage 3, the card step. */
export function stepFive(doc: string): string {
  const start = doc.indexOf("5. **Write `card.md`");
  const end = doc.indexOf("6. **Write the final hand-off.**", start);
  if (start === -1 || end === -1) throw new Error("card step not found");
  return doc.slice(start, end);
}

/** The paragraph holding an anchor sentence. */
export function paragraph(doc: string, anchor: string): string {
  const at = doc.indexOf(anchor);
  if (at === -1) throw new Error(`anchor not found: ${anchor}`);
  const start = doc.lastIndexOf("\n\n", at) + 2;
  let end = doc.indexOf("\n\n", at);
  if (end === -1) end = doc.length;
  return doc.slice(start, end);
}

/** Whether the card's heading list orders the notes section after the
 * printed parts and before the coachman's own sections. */
export function headingOrderOk(sentence: string): boolean {
  const order = ["## Switch-offs", "## Private data findings", "## Notes", "## Merge"].map((h) =>
    sentence.indexOf(h),
  );
  return (
    order.every((i) => i !== -1) &&
    (order[0] ?? 0) < (order[1] ?? 0) &&
    (order[1] ?? 0) < (order[2] ?? 0) &&
    (order[2] ?? 0) < (order[3] ?? 0)
  );
}
