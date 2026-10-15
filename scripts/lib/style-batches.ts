// The style lens, one batch of the project's written rules at a time. A reviewer asked to hold
// fifty rules over fifty files misses some, so the run's rules (bundled by scripts/project-notes.ts
// into <dispatch>/rules/rules.json) are cut into batches of a dozen and dealt to the style lanes.
// Each lane gets a prompt file that points at the lens's brief and at its own batches, and must
// answer every rule in them with a finding or a line saying the rule is clean.
//
// The text-making functions are pure; writeStyleBatches is the one that touches files.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_BATCH_SIZE, type Rule, assign, batches } from "./rule-sources.ts";

export type RuleRow = Rule & { readonly parts: readonly string[] };

/** The run's rules that the style lens checks, in source order; none when nothing was bundled. */
export function readStyleRules(dispatch: string): RuleRow[] {
  const file = join(dispatch, "rules", "rules.json");
  if (!existsSync(file)) return [];
  const rows = JSON.parse(readFileSync(file, "utf8")) as RuleRow[];
  return rows.filter((r) => r.parts.includes("style"));
}

/** One batch as a file for a lane to read: what to do with each rule, then the rules. */
export function batchText(k: number, total: number, rules: readonly Rule[]): string {
  const lines = rules.map(
    (r) =>
      `- ${r.id}${r.label === "" ? "" : ` (${r.label})`} [${r.gate ? "gates" : "advisory"}]: ${r.text} (${r.at})`,
  );
  return [
    `# Style rules, batch ${k + 1} of ${total}`,
    "",
    "Check every rule below against the whole change. For each rule, report each violation as a finding (the rule's id and its label, file:line, quoted code, confidence, and whether you verified it by execution or by reading), or write `<rule id>: clean`. Skip no rule. A rule marked [gates] is a gating finding when broken with no comment at the line saying why.",
    "",
    ...lines,
    "",
  ].join("\n");
}

/** The prompt for one lane: the lens's brief first, then its batches rule by rule. */
export function lanePrompt(dispatch: string, batchFiles: readonly string[]): string {
  const list = batchFiles.join(" and ");
  return `Read ${dispatch}/review-style-brief.md and execute it. Then check, one rule at a time, every written rule in ${list}: for each rule report each violation as a finding, or write "<rule id>: clean". Report findings as your final message. Do not modify any file you are reviewing.\n`;
}

/** Write the batch files and one prompt file per lane that has a batch. Returns each such lane's
 * prompt path; a lane with no batch, or a run with no rules, is not in the map and reviews as
 * the lens always did. */
export function writeStyleBatches(
  dispatch: string,
  round: string,
  lanes: readonly string[],
  size = DEFAULT_BATCH_SIZE,
): Map<string, string> {
  const rules = readStyleRules(dispatch);
  const out = new Map<string, string>();
  if (rules.length === 0 || lanes.length === 0) return out;
  const cut = batches(rules, size);
  const dir = join(dispatch, "rules");
  mkdirSync(dir, { recursive: true });
  const files = cut.map((b, k) => {
    const file = join(dir, `style-batch-${k + 1}.md`);
    writeFileSync(file, batchText(k, cut.length, b));
    return file;
  });
  const dealt = assign(cut.length, lanes);
  for (const lane of lanes) {
    const mine = (dealt[lane] ?? []).map((b) => files[b] as string);
    if (mine.length === 0) continue;
    const prompt = join(dispatch, `review-r${round}-style-${lane}-prompt.txt`);
    writeFileSync(prompt, lanePrompt(dispatch, mine));
    out.set(lane, prompt);
  }
  return out;
}
