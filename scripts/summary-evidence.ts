#!/usr/bin/env bun
// Hold a workhorse's WORKHORSE-SUMMARY.md to the evidence shape: under `## Evidence`, one entry
// per acceptance criterion the ticket numbers, each citing one or more worktree-relative paths
// under .postmaster/verify/ that exist once `..` and symlinks are resolved, or the line
// `not shown: <reason>`. A criterion missing from the section, citing evidence that does not
// exist or lies outside .postmaster/verify/, or claimed shown with no evidence and no not-shown
// line, is a problem the coachman counts against that lane. Criteria are read the way
// scripts/ticket-check.sh reads the list, and matched by number, so wording drift does not
// matter. Expected criteria come from the ticket, never inferred from the summary.
//
//   bun scripts/summary-evidence.ts <summary.md> <worktree> [--ticket <file>]
//
// The ticket defaults to the armed copy ($POSTMASTER_VERIFY/ticket.md, else
// <worktree>/.postmaster/verify/ticket.md). A ticket that is a waybill is read from its
// `## Ticket` heading to its `## Project profile` heading. Run it as the coachman does,
// `bun --no-env-file --config=/dev/null <tool>/scripts/summary-evidence.ts …`, so no .env or
// bunfig.toml from a worktree is read.
//
//   exit 0  the summary holds: every criterion has existing evidence under .postmaster/verify/,
//           or a not shown line with a reason
//   exit 1  usage, or a summary, worktree or ticket that cannot be read
//   exit 2  a criterion is missing, cites evidence that does not exist or lies outside
//           .postmaster/verify/, or is claimed shown with no evidence; each is named

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";

export const USAGE =
  "usage: bun scripts/summary-evidence.ts <summary.md> <worktree> [--ticket <file>]";

const ITEM = /^(\s*)(\d{1,9})[.)](?:[ \t]+(.*))?$/;
const BULLET = /^ {0,3}[-*+](?:[ \t]|$)/;
const HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/;
const FENCE = /^\s*(`{3,}|~{3,})/;
const NOT_SHOWN = /^not shown\b\s*:?\s*(.*)$/i;
const SECTION = /^##\s+(.*?)\s*#*\s*$/;

export type EvidenceEntry =
  | { kind: "not-shown"; reason: string }
  | { kind: "paths"; paths: string[] }
  | { kind: "bare" };

export type Problem = { criterion: number; problem: string };

export type CheckResult =
  | { ok: true }
  | { ok: false; reason: string };

export function extractTicketBody(text: string): string {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+Ticket\s*$/.test(l.trim()));
  if (start < 0) return text;
  const end = lines.findIndex((l, i) => i > start && /^##\s+Project profile\s*$/.test(l.trim()));
  return lines.slice(start + 1, end < 0 ? lines.length : end).join("\n");
}

function sectionLines(lines: string[], title: string): string[] | null {
  const want = title.toLowerCase();
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = SECTION.exec(lines[i] ?? "");
    if (m && (m[1] ?? "").toLowerCase() === want) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (SECTION.test(line) || /^#\s/.test(line)) break;
    out.push(line);
  }
  return out;
}

function parseNumberedList(body: string[]): Map<number, string[]> {
  const items = new Map<number, string[]>();
  let cur: number | null = null;
  let base: number | null = null;
  let fence: string | null = null;
  let blank = false;
  for (const raw of body) {
    const t = raw ?? "";
    if (fence) {
      if (cur !== null) items.get(cur)?.push(t);
      const s = t.trim();
      const mark = fence[0] ?? "`";
      if (s.length >= fence.length && s === mark.repeat(s.length)) fence = null;
      continue;
    }
    const f = FENCE.exec(t);
    if (f) {
      fence = f[1] ?? "```";
      if (cur !== null) items.get(cur)?.push(t);
      continue;
    }
    const m = ITEM.exec(t);
    if (m && (base === null || (m[1] ?? "").length <= base + 2)) {
      if (base === null) base = (m[1] ?? "").length;
      cur = Number(m[2]);
      items.set(cur, [m[3] ?? ""]);
      blank = false;
      continue;
    }
    const indented = t.startsWith(" ") || t.startsWith("\t");
    if (cur !== null && (indented || !(blank || BULLET.test(t) || HEADING.test(t)))) {
      items.get(cur)?.push(t);
      blank = false;
      continue;
    }
    if (!t.trim()) blank = true;
    else cur = null;
  }
  return items;
}

export function parseCriteria(text: string): number[] {
  const body = sectionLines(text.split(/\r?\n/), "acceptance criteria");
  if (!body) return [];
  const items = parseNumberedList(body);
  return [...items.keys()].sort((a, b) => a - b);
}

export function parseEvidence(text: string): Map<number, EvidenceEntry> {
  const body = sectionLines(text.split(/\r?\n/), "evidence");
  const out = new Map<number, EvidenceEntry>();
  if (!body) return out;
  for (const [n, lines] of parseNumberedList(body)) {
    out.set(n, parseEvidenceEntry(lines.join(" ").trim()));
  }
  return out;
}

const PATH_LIKE = /(?:^|\/)[\w.-]+\.[\w]+$/;

function looksLikePath(token: string): boolean {
  return token.includes("/") || PATH_LIKE.test(token) || token.startsWith(".");
}

export function parseEvidenceEntry(raw: string): EvidenceEntry {
  const text = raw.trim();
  const notShown = NOT_SHOWN.exec(text);
  if (notShown) {
    const reason = (notShown[1] ?? "").trim();
    return reason ? { kind: "not-shown", reason } : { kind: "bare" };
  }
  const spans = [...text.matchAll(/`([^`]+)`/g)]
    .map((m) => (m[1] ?? "").trim())
    .filter((s) => s.length > 0 && looksLikePath(s));
  if (spans.length > 0) return { kind: "paths", paths: spans };
  const paths = text
    .split(/[,\s]+/)
    .map((s) => s.replace(/^`+|`+$/g, "").trim())
    .filter((s) => s.length > 0 && looksLikePath(s));
  return paths.length > 0 ? { kind: "paths", paths } : { kind: "bare" };
}

export function checkPath(worktree: string, cited: string): CheckResult {
  const verifyRoot = resolve(worktree, ".postmaster", "verify");
  const joined = resolve(worktree, cited);
  if (joined !== verifyRoot && !joined.startsWith(verifyRoot + sep)) {
    return { ok: false, reason: "outside .postmaster/verify" };
  }
  let real: string;
  try {
    real = realpathSync(joined);
  } catch {
    return { ok: false, reason: "does not exist" };
  }
  let realRoot: string;
  try {
    realRoot = realpathSync(verifyRoot);
  } catch {
    return { ok: false, reason: "does not exist" };
  }
  if (real !== realRoot && !real.startsWith(realRoot + sep)) {
    return { ok: false, reason: "outside .postmaster/verify" };
  }
  return { ok: true };
}

export function checkEvidence(
  criteria: readonly number[],
  evidence: ReadonlyMap<number, EvidenceEntry>,
  worktree: string,
): Problem[] {
  const problems: Problem[] = [];
  for (const n of criteria) {
    const entry = evidence.get(n);
    if (!entry) {
      problems.push({ criterion: n, problem: "no evidence entry" });
      continue;
    }
    if (entry.kind === "not-shown") continue;
    if (entry.kind === "bare" || entry.paths.length === 0) {
      problems.push({
        criterion: n,
        problem: "claimed shown with no evidence and no not shown line",
      });
      continue;
    }
    for (const path of entry.paths) {
      const result = checkPath(worktree, path);
      if (!result.ok) {
        problems.push({ criterion: n, problem: `${path}: ${result.reason}` });
      }
    }
  }
  return problems;
}

export function formatProblem(p: Problem): string {
  return `criterion ${p.criterion}: ${p.problem}`;
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function defaultTicket(worktree: string): string | null {
  const fromEnv = process.env.POSTMASTER_VERIFY;
  if (fromEnv) {
    const p = resolve(fromEnv, "ticket.md");
    if (existsSync(p)) return p;
  }
  const local = resolve(worktree, ".postmaster", "verify", "ticket.md");
  return existsSync(local) ? local : null;
}

function main(argv: string[]): number {
  let ticket: string | null = null;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--ticket") {
      ticket = argv[i + 1] ?? null;
      if (!ticket) {
        console.error(`summary-evidence: ${USAGE}`);
        return 1;
      }
      i++;
      continue;
    }
    rest.push(a ?? "");
  }
  const [summaryPath, worktreeArg] = rest;
  if (rest.length !== 2 || !summaryPath || worktreeArg === undefined) {
    console.error(`summary-evidence: ${USAGE}`);
    return 1;
  }
  const worktree = resolve(worktreeArg);
  const summaryText = readText(summaryPath);
  if (summaryText === null) {
    console.error(`summary-evidence: cannot read ${summaryPath}`);
    return 1;
  }
  const ticketPath = ticket ?? defaultTicket(worktree);
  if (!ticketPath) {
    console.error(`summary-evidence: no ticket: pass --ticket or arm the worktree`);
    return 1;
  }
  const ticketText = readText(ticketPath);
  if (ticketText === null) {
    console.error(`summary-evidence: cannot read ${ticketPath}`);
    return 1;
  }
  const criteria = parseCriteria(extractTicketBody(ticketText));
  if (criteria.length === 0) {
    console.error(`summary-evidence: no acceptance criteria in ${ticketPath}`);
    return 1;
  }
  const problems = checkEvidence(criteria, parseEvidence(summaryText), worktree);
  for (const p of problems) {
    console.log(formatProblem(p));
  }
  if (problems.length > 0) {
    console.log(`the summary does not hold: ${problems.length} problem(s)`);
    return 2;
  }
  console.log(`the summary holds: evidence or a not shown line for each of ${criteria.length} criteria`);
  return 0;
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
