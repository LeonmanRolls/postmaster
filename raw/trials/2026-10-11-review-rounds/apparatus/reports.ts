// A reviewer's own report of a finding, where the coachman's finding line carries no text (see
// ../method.md). Pure: it takes the text of a report file and says what it says about a target.
import type { Place } from "./origin.ts";

export type ReportItem = {
  file: string | null;
  line: number | null;
  target: string | null;
  summary: string;
  body: string;
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** The items of a reviewer's `-findings.json`: an array, or an object with a `findings` array. */
export function parseReportJson(text: string): ReportItem[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return [];
  }
  const list = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.findings)
      ? value.findings
      : [];
  const out: ReportItem[] = [];
  for (const item of list) {
    if (!isRecord(item)) continue;
    out.push({
      file: str(item.file) || null,
      line: typeof item.line === "number" ? item.line : null,
      target: str(item.target) || null,
      summary: str(item.summary) || str(item.title),
      body: str(item.body) || str(item.description),
    });
  }
  return out;
}

/** The item that reports a target: the same target text, else the same file within 3 lines. */
export function matchReport(
  items: readonly ReportItem[],
  target: string,
  place: Place | null,
): ReportItem | null {
  const exact = items.find((i) => i.target === target);
  if (exact) return exact;
  if (!place) return null;
  const near = items
    .filter((i) => i.file === place.file && i.line !== null)
    .map((i) => ({ i, d: Math.abs((i.line as number) - place.first) }))
    .filter((x) => x.d <= 3)
    .sort((a, b) => a.d - b.d)[0];
  return near ? near.i : null;
}

/** The line of a hand-read report that holds the target, and the line after it. */
export function lineFor(markdown: string, target: string): string {
  const lines = markdown.split("\n");
  const at = lines.findIndex((l) => l.includes(target));
  if (at < 0) return "";
  return [lines[at], lines[at + 1] ?? ""].join(" ").replace(/\s+/gu, " ").trim();
}

/** What a report item says, summary first, without its links. */
export function reportText(item: ReportItem): string {
  const body = item.body.replace(/\[([^\]]*)\]\([^)]*\)/gu, "$1");
  return [item.summary, body].filter((s) => s !== "").join(": ");
}
