// Compare the places named in a ticket's agents' part between its verified commit and a run's base.
//
//   premises.sh <repo> <waybill> <base>
//
// Each source is reported as same, moved, changed, missing or unknown. A missing verified commit
// makes every source unknown so the coachman can inspect it. Changed or missing sources exit 2.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { run } from "./lib/proc.ts";

export type PremiseState = "same" | "moved" | "changed" | "missing" | "unknown";

export interface Citation {
  path: string;
  start?: number;
  end?: number;
  source: string;
}

export interface PremiseResult {
  citation: Citation;
  state: PremiseState;
}

const LINK_RE = /https?:\/\/[^\p{White_Space})\]>]+/gu;
const CODE_RE = /`([^`\n]+)`/gu;
const PATH_RE =
  /(?:^|[^\p{L}\p{N}_.-])((?:[\p{L}\p{N}_.-]+\/)*[\p{L}\p{N}_.-]+\.[\p{L}\p{N}_.-]+)(#L[0-9]+(?:-L[0-9]+)?)?(?=$|[^\p{L}\p{N}_-])/gu;

function splitRef(ref: string): { start?: number; end?: number } {
  const match = ref.match(/^#L([0-9]+)(?:-L([0-9]+))?$/u);
  if (!match) return {};
  const start = Number(match[1]);
  const end = Number(match[2] ?? match[1]);
  return start > 0 && end >= start ? { start, end } : {};
}

function safePath(value: string): boolean {
  return value !== "" && !value.startsWith("/") && !value.split("/").includes("..");
}

export function citationsFromText(text: string): Citation[] {
  const sectionMatch = text.match(/^##[ \t]+For the agents[ \t]*\n([\u0000-\u{10ffff}]*)$/mu);
  if (!sectionMatch) return [];
  const section = sectionMatch[1] ?? "";
  const citations = new Map<string, Citation>();
  for (const match of section.matchAll(LINK_RE)) {
    const raw = match[0];
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    const pathMatch = url.pathname.match(/\/blob\/[^/]+\/(.+)$/u);
    if (!pathMatch) continue;
    const path = decodeURIComponent(pathMatch[1] ?? "");
    if (!safePath(path)) continue;
    const range = splitRef(url.hash);
    const key = `${path}:${range.start ?? ""}:${range.end ?? ""}`;
    citations.set(key, { path, ...range, source: raw });
  }
  for (const match of section.matchAll(CODE_RE)) {
    const content = match[1] ?? "";
    for (const pathMatch of content.matchAll(PATH_RE)) {
      const path = pathMatch[1] ?? "";
      if (!safePath(path)) continue;
      const range = splitRef(pathMatch[2] ?? "");
      const key = `${path}:${range.start ?? ""}:${range.end ?? ""}`;
      citations.set(key, {
        path,
        ...range,
        source: `${path}${pathMatch[2] ?? ""}`,
      });
    }
  }
  return [...citations.values()];
}

function git(repo: string, args: string[]): { code: number; out: string; err: string } {
  return run("git", ["-C", repo, ...args]);
}

function gitText(repo: string, rev: string, path: string): string | null {
  const result = git(repo, ["show", `${rev}:${path}`]);
  return result.code === 0 ? result.out : null;
}

function containsLines(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0) return true;
  for (let start = 0; start + needle.length <= haystack.length; start++) {
    if (needle.every((line, offset) => haystack[start + offset] === line)) return true;
  }
  return false;
}

function compareCitation(
  repo: string,
  verified: string,
  base: string,
  citation: Citation,
): PremiseState {
  const previous = gitText(repo, verified, citation.path);
  if (previous === null) return "missing";
  const current = gitText(repo, base, citation.path);
  if (current === null) return "missing";
  if (citation.start === undefined) return previous === current ? "same" : "changed";

  const oldLines = previous.replace(/\r\n/gu, "\n").split("\n");
  const newLines = current.replace(/\r\n/gu, "\n").split("\n");
  const excerpt = oldLines.slice(citation.start - 1, citation.end ?? citation.start);
  if (excerpt.length === 0) return "missing";
  const atOriginalRange = newLines.slice(citation.start - 1, citation.end ?? citation.start);
  if (
    excerpt.length === atOriginalRange.length &&
    excerpt.every((line, i) => line === atOriginalRange[i])
  )
    return "same";
  return containsLines(newLines, excerpt) ? "moved" : "changed";
}

export function checkPremises(
  repo: string,
  waybill: string,
  base: string,
): {
  verified: string;
  base: string;
  result: "same" | "moved" | "unknown" | "changed" | "missing";
  entries: PremiseResult[];
} {
  const text = readFileSync(waybill, "utf8");
  const verifiedMatch = text.match(/^### Verified at ([0-9a-f]{7,40})[ \t]*$/imu);
  const verified = verifiedMatch?.[1] ?? "unknown";
  const citations = citationsFromText(text);
  if (git(repo, ["rev-parse", "--verify", `${base}^{commit}`]).code !== 0)
    throw new Error(`base is not a commit in ${repo}: ${base}`);
  const hasVerified =
    verified !== "unknown" && git(repo, ["cat-file", "-e", `${verified}^{commit}`]).code === 0;
  const entries: PremiseResult[] = citations.map((citation) => ({
    citation,
    state: hasVerified ? compareCitation(repo, verified, base, citation) : "unknown",
  }));
  let result: "same" | "moved" | "unknown" | "changed" | "missing" = "same";
  if (!hasVerified) result = "unknown";
  else if (entries.some((entry) => entry.state === "missing")) result = "missing";
  else if (entries.some((entry) => entry.state === "changed")) result = "changed";
  else if (entries.some((entry) => entry.state === "unknown")) result = "unknown";
  else if (entries.some((entry) => entry.state === "moved")) result = "moved";
  return { verified, base, result, entries };
}

function main(argv: string[]): number {
  if (argv.length !== 3) {
    console.error("usage: premises.sh <repo> <waybill> <base>");
    return 1;
  }
  const [repoArg, waybill, base] = argv as [string, string, string];
  const repo = resolve(repoArg);
  let checked: ReturnType<typeof checkPremises>;
  try {
    checked = checkPremises(repo, waybill, base);
  } catch (error) {
    console.error(`premises: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  checked.entries.forEach(({ citation, state }, index) => {
    const span = citation.start === undefined ? "" : `#L${citation.start}-L${citation.end}`;
    console.log(`premise ${index + 1}: ${citation.path}${span} ${state} (${citation.source})`);
  });
  console.log(
    `PREMISES: verified=${checked.verified} base=${checked.base} result=${checked.result} count=${checked.entries.length}`,
  );
  return checked.result === "changed" || checked.result === "missing" ? 2 : 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
