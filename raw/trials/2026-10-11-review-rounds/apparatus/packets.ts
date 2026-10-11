// Build the packets the readers mark (see ../rule.md, "The second reader"): for each run with a
// later finding that has text, the ticket as dispatched, the run's rulings, and each later finding
// with its facts. The group a finding fell in is not given. Run folders are only read.
//
//   bun --no-env-file --config=/dev/null packets.ts --project <repo> --legacy <dir> \
//       --runs results/runs.json --findings results/findings.json --out <dir> --items <file>
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseActions } from "../../2026-10-03-lane-audit/apparatus/parse.ts";
import { privacyFaults, scrub } from "../../2026-10-03-lane-audit/apparatus/records.ts";
import { ticketOfWaybill } from "./ticket.ts";
import type { TracedFinding } from "./trace.ts";

export type Item = TracedFinding & { id: string };

/** Ids of a run's later findings that have text: `<run>.<round>.<n>`, n counting within the round. */
export function itemsOf(findings: readonly TracedFinding[]): Item[] {
  const counts = new Map<string, number>();
  const out: Item[] = [];
  for (const f of findings) {
    if (f.round < 2) continue;
    const key = `${f.run}.${f.round}`;
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    out.push({ ...f, id: `${f.run}.${f.round}.${n}` });
  }
  return out;
}

/**
 * The ticket as a reader needs it to judge what it left open: the plain part the user signed off,
 * and the checks. The technical notes and the verified facts follow from the plain part and add
 * no behaviour, and are left out.
 */
export function ticketForReaders(text: string): string {
  const at = text.search(/^## For the agents\b/mu);
  if (at < 0) return text;
  const plain = text.slice(0, at).trimEnd();
  const rest = text.slice(at);
  const checks = /^### Checks\b[\s\S]*?(?=^### |\n## |$(?![\s\S]))/mu.exec(rest);
  return checks ? `${plain}\n\n## For the agents (checks only)\n\n${checks[0].trimEnd()}` : plain;
}

const plainFact = (f: TracedFinding): string => {
  const parts: string[] = [];
  const o = f.origin;
  if (o.kind === "fix") {
    parts.push(
      `these lines were written by a fix, a commit made after round ${o.round} was reviewed` +
        (f.fixOf.length > 0
          ? `, applied for ${f.fixOf.slice(0, 4).join(", ")}${f.fixOf.length > 4 ? ` and ${f.fixOf.length - 4} more` : ""}`
          : ", for findings the run's lines do not name"),
    );
  } else if (o.kind === "change") {
    parts.push("these lines were in the change as it stood when round 1 was reviewed");
  } else if (o.kind === "base") {
    parts.push("these lines are older than the run's change, or came in from main");
  } else {
    parts.push(`the lines could not be placed (${o.why ?? "unknown"})`);
  }
  if (f.placedBefore)
    parts.push(`an earlier serious finding already named these lines: ${f.placedBefore}`);
  if (f.relog) parts.push("this target text was already a serious finding in an earlier round");
  return parts.join("; ");
};

/** One run's packet, in markdown. `rulings` are the run's own lines about rulings, scrubbed. */
export function buildPacket(
  run: string,
  mode: string,
  rounds: number,
  byRound: readonly number[],
  ticket: string,
  rulings: readonly string[],
  all: readonly TracedFinding[],
  items: readonly Item[],
): string {
  const out: string[] = [];
  out.push(`# Run #${run}`);
  out.push("");
  out.push(
    `Mode: ${mode}. Review rounds: ${rounds}. Serious findings by round: ${byRound.join(", ")}.`,
  );
  out.push("");
  out.push("## The ticket as it was dispatched");
  out.push("");
  out.push(ticket === "" ? "(the run kept no copy of its ticket)" : ticket);
  out.push("");
  out.push("## The run's own lines about rulings and escalations, in time order");
  out.push("");
  if (rulings.length === 0) out.push("(none)");
  for (const r of rulings) out.push(`- ${r}`);
  out.push("");
  out.push("## Later findings (round 2 and after), each serious");
  for (const it of items) {
    out.push("");
    out.push(`### ${it.id}`);
    out.push(
      `Round ${it.round}, ${it.severity}, lens ${it.lenses.join("+") || "unknown"}, ` +
        `lanes ${it.lanes.join("+") || "unknown"}, target \`${it.target}\`.`,
    );
    out.push(`Text: ${it.text === "" ? "(none)" : it.text}`);
    if (it.code.length > 0)
      out.push(`Code at the cited lines: ${it.code.map((c) => `\`${c.trim()}\``).join(" ")}`);
    out.push(`Facts: ${plainFact(it)}.`);
    const same = all
      .filter(
        (f) => f.run === it.run && f.file !== null && f.file === it.file && f.round < it.round,
      )
      .slice(0, 6);
    if (same.length > 0) {
      out.push("Earlier serious findings in the same file:");
      for (const s of same) {
        out.push(
          `- round ${s.round}, \`${s.target}\`: ${s.text === "" ? "(no text)" : scrub(s.text, 150)}`,
        );
      }
    }
  }
  out.push("");
  return out.join("\n");
}

const readText = (path: string): string => (existsSync(path) ? readFileSync(path, "utf8") : "");

/** The run's lines about rulings, in order: escalations, and notes that name a ruling. */
export function rulingLines(
  actions: ReturnType<typeof parseActions>["actions"],
  max = 24,
): string[] {
  return actions
    .filter(
      (a) =>
        a.action === "escalate" ||
        (a.action === "note" && /\b(ruling|ruled|the user'?s? word|escalat)/iu.test(a.detail)),
    )
    .slice(0, max)
    .map((a) => `${a.ts.slice(5, 16)} ${a.action}: ${scrub(a.detail, 300)}`);
}

const arg = (args: string[], name: string): string | undefined => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};

type RunRowLite = {
  run: string;
  layout: "project" | "legacy";
  mode: string;
  rounds: number;
  seriousBest: number[];
};

const main = (args: string[]): void => {
  const project = arg(args, "--project");
  const legacy = arg(args, "--legacy");
  const runsFile = arg(args, "--runs");
  const findingsFile = arg(args, "--findings");
  const outDir = arg(args, "--out");
  const itemsFile = arg(args, "--items");
  if (!project || !runsFile || !findingsFile || !outDir || !itemsFile) {
    throw new Error(
      "usage: packets.ts --project <repo> [--legacy <dir>] --runs f --findings f --out dir --items f",
    );
  }
  const runs = (JSON.parse(readFileSync(runsFile, "utf8")) as { runs: RunRowLite[] }).runs;
  const findings = (JSON.parse(readFileSync(findingsFile, "utf8")) as { findings: TracedFinding[] })
    .findings;
  const items = itemsOf(findings);
  mkdirSync(outDir, { recursive: true });
  const withText = new Set(items.filter((i) => i.text !== "").map((i) => i.run));
  for (const r of runs) {
    if (!withText.has(r.run)) continue;
    const dir =
      r.layout === "project"
        ? join(project, ".postmaster", "runs", r.run)
        : join(legacy ?? "", r.run);
    const body = readText(join(dir, "ticket-body.md"));
    const ticket = body !== "" ? body : ticketOfWaybill(readText(join(dir, "brief.md")));
    const { actions } = parseActions(readText(join(dir, "actions.jsonl")));
    const mine = items.filter((i) => i.run === r.run && i.text !== "");
    const packet = buildPacket(
      r.run,
      r.mode,
      r.rounds,
      r.seriousBest,
      scrub(ticketForReaders(ticket), 200000),
      rulingLines(actions),
      findings,
      mine,
    );
    const faults = privacyFaults(packet);
    if (faults.length > 0) throw new Error(`packet ${r.run} holds ${faults.join(" and ")}`);
    writeFileSync(join(outDir, `run-${r.run}.md`), packet);
  }
  const header = [
    "id",
    "run",
    "round",
    "severity",
    "lenses",
    "lanes",
    "target",
    "textSource",
    "origin",
    "originRound",
    "placedBefore",
    "relog",
    "text",
  ].join("\t");
  const rows = items.map((i) =>
    [
      i.id,
      i.run,
      i.round,
      i.severity,
      i.lenses.join("+"),
      i.lanes.join("+"),
      i.target,
      i.textSource,
      i.origin.kind,
      i.origin.round ?? "",
      i.placedBefore ?? "",
      i.relog ? "yes" : "no",
      i.text.replace(/[\t\n]+/gu, " "),
    ].join("\t"),
  );
  const itemsText = `${header}\n${rows.join("\n")}\n`;
  const itemsFaults = privacyFaults(itemsText);
  if (itemsFaults.length > 0) throw new Error(`the items hold ${itemsFaults.join(" and ")}`);
  writeFileSync(resolve(itemsFile), itemsText);
  console.error(
    `${items.length} later findings, ${items.filter((i) => i.text !== "").length} with text`,
  );
};

if (import.meta.main) main(process.argv.slice(2));
