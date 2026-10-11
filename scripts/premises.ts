// Check the ticket's premises still hold at the run's base.
//
// Lists each place the agents' part cites, by a link at a commit or as a path
// in a code span, and compares the cited text between the ticket's Verified at
// commit and the run's base:
//
//   same     the cited text is unchanged
//   moved    the cited text is elsewhere in the file
//   changed  the cited text is different
//   missing  the cited file is gone
//   unknown  the cite cannot be anchored: the Verified at commit is unknown to
//            the repository, the path resolves nowhere, or the cited lines are
//            out of range. The coachman reads each of those and judges.
//
// A code span that resolves to no file at either commit is prose, not a cite,
// and is skipped silently; a link is an explicit cite and reports unknown.
// The overall result is the worst state found; the command exits 2 when any
// place changed or went missing, 1 on usage or an unreadable ticket, and 0
// otherwise. The PREMISES summary line carries what the coachman logs.
//
// Usage: run premises <repo> <ticket-file> <base>
import { readFileSync } from "node:fs";
import { run } from "./lib/proc.ts";
import {
  agentsEnd,
  agentsIndex,
  normalizeTicket,
  verifiedAtSha,
  verifiedSection,
} from "./lib/ticket-sections.ts";

export type Citation = {
  path: string;
  start?: number;
  end?: number;
  source: "link" | "span";
};

export type PremiseState = "same" | "moved" | "changed" | "missing" | "unknown";

export type PremiseEntry = {
  citation: Citation;
  state: PremiseState;
  note: string;
};

export type PremisesReport = {
  verified: string;
  base: string;
  result: PremiseState;
  entries: PremiseEntry[];
};

function die(message: string, code = 1): never {
  console.error(`premises: ${message}`);
  process.exit(code);
}

export function parseRange(spec: string): { start?: number; end?: number } {
  const text = spec.startsWith("#") ? spec.slice(1) : spec;
  const match =
    /^L([0-9]+)(?:-L?([0-9]+)?)?$/iu.exec(text) ?? /^([0-9]+)(?:-([0-9]+)?)?$/u.exec(text);
  if (!match) return {};
  const start = Math.max(Number(match[1]), 1);
  const end = match[2] === undefined || match[2] === "" ? undefined : Math.max(Number(match[2]), 1);
  if (end === undefined) return { start };
  return end < start ? { start, end: start } : { start, end };
}

function safePath(path: string): boolean {
  if (!path || path.startsWith("/") || path.startsWith("\\")) return false;
  return !path.split("/").some((part) => part === "" || part === "." || part === "..");
}

const LINK_RE =
  // ASCII: the URL ends at whitespace, a closer, or a prose separator; the sha and path it captures are ASCII-narrowed. No dot here: the path capture is non-greedy and would stop at the first one mid-path. Trailing dots strip after the match.
  /https?:\/\/[^\s)]+\/blob\/([0-9a-f]{7,40})\/([^)\s#]+?)(#L[0-9]+(?:-L?[0-9]+)?)?(?=[)\s,;:>\]]|$)/giu;
// Trailing punctuation a cite picked up from prose: stripped from the path,
// never from inside it.
const TRAILING_PUNCT_RE = /[.,;:!?'"\]]+$/u;
const PATH_RE =
  /((?:[\p{L}\p{N}_.-]+\/)*[\p{L}\p{N}_.-]+\.[\p{L}\p{N}_.-]+)(#L[0-9]+(?:-L?[0-9]+)?|(?<![A-Za-z0-9_])L[0-9]+(?:-L?[0-9]+)?)?/gu;

export function agentsPart(body: string): string {
  const lines = normalizeTicket(body).split("\n");
  const start = agentsIndex(lines);
  if (start < 0) return "";
  // The caller passes the waybill, whose project profile, team and dispatch
  // sections follow the ticket: the part ends where the shared reader says,
  // past fenced ## lines and the ticket's own User journey.
  return lines.slice(start + 1, agentsEnd(lines, start + 1)).join("\n");
}

export function citationsFromText(body: string): Citation[] {
  const text = agentsPart(body);
  const out: Citation[] = [];
  const seen = new Set<string>();
  const push = (citation: Citation) => {
    const key = `${citation.path}#${citation.start ?? ""}-${citation.end ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(citation);
  };
  LINK_RE.lastIndex = 0;
  for (;;) {
    const match = LINK_RE.exec(text);
    if (!match) break;
    let path = "";
    try {
      path = decodeURIComponent(match[2] ?? "").replace(TRAILING_PUNCT_RE, "");
    } catch {
      continue;
    }
    if (!safePath(path)) continue;
    push({ path, ...parseRange(match[3] ?? ""), source: "link" });
  }
  for (const line of text.split("\n")) {
    const spans = line.match(/`[^`\n]+`/gu) ?? [];
    for (const span of spans) {
      PATH_RE.lastIndex = 0;
      const match = PATH_RE.exec(span.slice(1, -1).trim());
      if (!match) continue;
      const path = (match[1] ?? "").replace(TRAILING_PUNCT_RE, "");
      if (!safePath(path)) continue;
      push({ path, ...parseRange(match[2] ?? ""), source: "span" });
    }
  }
  return out;
}

function gitText(repo: string, rev: string, path: string): string | null {
  const r = run("git", ["-C", repo, "show", `${rev}:${path}`]);
  return r.code === 0 ? (r.out ?? "") : null;
}

function excerptOf(text: string, start: number, end?: number): string {
  const lines = text.split("\n").map((line) => line.replace(/\r$/u, ""));
  const last = end ?? start;
  if (start > lines.length) return "";
  return lines.slice(start - 1, Math.min(last, lines.length)).join("\n");
}

function normalize(text: string): string {
  return text.replace(/\r\n/gu, "\n");
}

// Compare one cite. Returns null for a code span that resolves to no file at
// either commit: prose, not a cite.
export function compareCitation(
  citation: Citation,
  verifiedText: string | null,
  baseText: string | null,
): PremiseEntry | null {
  const span =
    citation.start === undefined
      ? citation.path
      : `${citation.path}#L${citation.start}-L${citation.end ?? citation.start}`;
  const entry = (state: PremiseState, note: string): PremiseEntry => ({ citation, state, note });
  if (verifiedText === null && baseText === null) {
    if (citation.source === "span") return null;
    return entry("unknown", `${span} resolves nowhere`);
  }
  if (verifiedText === null)
    return entry("unknown", `${span} is newer than the Verified at commit`);
  if (baseText === null) return entry("missing", `${span} is gone at the base`);
  if (citation.start === undefined) {
    return normalize(verifiedText) === normalize(baseText)
      ? entry("same", `${span} is unchanged`)
      : entry("changed", `${span} changed`);
  }
  const start = citation.start;
  const end = citation.end;
  // A finite end past the last verified line is an invalid cite, not a
  // short file: the excerpt would clamp and could report it as same.
  // Whole-file spans carry no finite end and are exempt.
  if (end !== undefined && Number.isFinite(end)) {
    const verifiedLines = verifiedText.split("\n").length;
    if (end > verifiedLines)
      return entry("unknown", `${span} is out of range at the Verified at commit`);
  }
  const expected = excerptOf(verifiedText, start, end);
  if (!expected) return entry("unknown", `${span} is out of range at the Verified at commit`);
  const actual = excerptOf(baseText, start, end);
  if (expected === actual) return entry("same", `${span} is at the cited lines`);
  const baseLines = baseText.split("\n").length;
  let found = 0;
  for (let line = 1; line <= baseLines; line++) {
    const length = end === undefined ? 1 : end - start + 1;
    if (excerptOf(baseText, line, line + length - 1) === expected) {
      found = line;
      break;
    }
  }
  if (found > 0) {
    return entry(
      "moved",
      `${span} is at L${found}-L${found + (end === undefined ? 0 : end - start)} at the base`,
    );
  }
  return entry("changed", `${span} changed`);
}

const RANK: Record<PremiseState, number> = {
  same: 0,
  moved: 1,
  unknown: 2,
  changed: 3,
  missing: 3,
};

export function checkPremises(repo: string, ticketFile: string, base: string): PremisesReport {
  if (!base.trim()) die("the base commit is empty");
  let body = "";
  try {
    body = readFileSync(ticketFile, "utf8");
  } catch {
    die(`cannot read the ticket file ${ticketFile}`);
  }
  const ticketLines = normalizeTicket(body).split("\n");
  const section = verifiedSection(ticketLines, agentsIndex(ticketLines));
  const sha = section ? verifiedAtSha(section.title) : "";
  const verified = sha === "" ? "unknown" : sha;
  const cites = citationsFromText(body);
  const known =
    verified !== "unknown" &&
    run("git", ["-C", repo, "rev-parse", "--verify", `${verified}^{commit}`]).code === 0;
  if (!known) {
    return {
      verified,
      base,
      result: cites.length > 0 ? "unknown" : "same",
      entries: cites.map((citation) => ({
        citation,
        state: "unknown" as PremiseState,
        note: "the Verified at commit is unknown to the repository",
      })),
    };
  }
  // An unresolvable base is unknown, never missing: git show fails the same
  // way for a bad revision as for a deleted file, and an empty base would
  // silently read the git index.
  const baseKnown =
    run("git", ["-C", repo, "rev-parse", "--verify", `${base}^{commit}`]).code === 0;
  if (!baseKnown) {
    return {
      verified,
      base,
      result: cites.length > 0 ? "unknown" : "same",
      entries: cites.map((citation) => ({
        citation,
        state: "unknown" as PremiseState,
        note: "the base commit is unknown to the repository",
      })),
    };
  }
  const entries: PremiseEntry[] = [];
  for (const citation of cites) {
    const compared = compareCitation(
      citation,
      gitText(repo, verified, citation.path),
      gitText(repo, base, citation.path),
    );
    if (compared) entries.push(compared);
  }
  let result: PremiseState = "same";
  for (const entry of entries) {
    if (RANK[entry.state] > RANK[result]) result = entry.state;
  }
  return { verified, base, result, entries };
}

export function formatReport(report: PremisesReport): string[] {
  const lines = report.entries.map((entry, i) => {
    const span =
      entry.citation.start === undefined
        ? entry.citation.path
        : `${entry.citation.path}#L${entry.citation.start}-L${entry.citation.end ?? entry.citation.start}`;
    return `premise ${i + 1}: ${span} ${entry.state} (${entry.note})`;
  });
  lines.push(
    `PREMISES verified=${report.verified} base=${report.base} result=${report.result} count=${report.entries.length}`,
  );
  return lines;
}

function main(argv: string[]): number {
  if (argv.length !== 3) {
    console.error("usage: run premises <repo> <ticket-file> <base>");
    return 1;
  }
  const [repo, ticketFile, base] = argv as [string, string, string];
  const report = checkPremises(repo, ticketFile, base);
  for (const line of formatReport(report)) console.log(line);
  return report.result === "changed" || report.result === "missing" ? 2 : 0;
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
