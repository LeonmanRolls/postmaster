// Read the cache split of every launch in the audited runs (see ../method.md). Only reads: a run
// folder is never written, and nothing in the output names a path, a thread or a session.
//
//   bun measure.ts --audit <runs.json> --runs <id,id,...> --dir <runs folder> [--dir <another>] --out <file.json>
//
// Per run it reads each workhorse and reviewer events stream, found by file name as the lane audit
// finds them (the lane's harness comes from the audit's data), and for the coachman the session
// exports in `sessions/coachman/`.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RunRecord } from "../../2026-10-03-lane-audit/apparatus/records.ts";
import {
  add,
  claudeModelUsage,
  type Harness,
  type ModelTokens,
  museTokens,
  streamTokens,
  type Tokens,
  zero,
} from "./tokens.ts";
import { looksLikePath } from "./uptime.ts";

export type Launch = {
  run: string;
  role: "workhorse" | "reviewer" | "coachman";
  lane: string;
  harness: string;
  tokens: Tokens;
  /** Claude Code only: the session's tokens per model, subagents included */
  modelUsage?: Record<string, ModelTokens>;
};

const HARNESSES: readonly string[] = ["codex", "mimo", "claude"];

/** A workhorse's or reviewer's stream, by its file name, as the lane audit reads them. */
export function classify(
  file: string,
  harnessOf: Record<string, string>,
): { role: "workhorse" | "reviewer"; lane: string; harness: Harness } | null {
  const laneOf = (name: string): string | null => {
    const base = name.replace(/-retry$/u, "");
    return base in harnessOf ? base : null;
  };
  const review = /^review-r[0-9]+-(?:style|bug|security)-([A-Za-z0-9._-]+)\.jsonl$/u.exec(file);
  const work = /^([A-Za-z0-9]+)-events\.jsonl$/u.exec(file);
  const lane = review ? laneOf(review[1] as string) : work ? laneOf(work[1] as string) : null;
  if (!lane) return null;
  const harness = harnessOf[lane] as string;
  if (!HARNESSES.includes(harness)) return null;
  return { role: review ? "reviewer" : "workhorse", lane, harness: harness as Harness };
}

function launchesOf(run: string, folder: string, harnessOf: Record<string, string>): Launch[] {
  const launches: Launch[] = [];
  const logs = join(folder, "logs");
  if (existsSync(logs)) {
    for (const name of readdirSync(logs).sort()) {
      const c = classify(name, harnessOf);
      if (!c) continue;
      const stream = readFileSync(join(logs, name), "utf8");
      launches.push({
        run,
        role: c.role,
        lane: c.lane,
        harness: c.harness,
        tokens: streamTokens(c.harness, stream),
        ...(c.harness === "claude" ? { modelUsage: claudeModelUsage(stream) } : {}),
      });
    }
  }
  const sessions = join(folder, "sessions", "coachman");
  if (existsSync(sessions)) {
    let t = zero();
    for (const name of readdirSync(sessions).filter((f) => f.endsWith(".json"))) {
      t = add(t, museTokens(JSON.parse(readFileSync(join(sessions, name), "utf8"))));
    }
    launches.push({ run, role: "coachman", lane: "coachman", harness: "muse", tokens: t });
  }
  return launches;
}

function main(): void {
  const args = process.argv.slice(2);
  const values = (flag: string): string[] =>
    args.flatMap((a, i) => (a === flag && args[i + 1] ? [args[i + 1] as string] : []));
  const runs = (values("--runs")[0] ?? "").split(",").filter((r) => r !== "");
  const dirs = values("--dir");
  const out = values("--out")[0];
  const audit = values("--audit")[0];
  if (runs.length === 0 || dirs.length === 0 || !out || !audit) {
    process.stderr.write(
      "usage: bun measure.ts --audit <runs.json> --runs <ids> --dir <runs folder> [--dir ...] --out <file>\n",
    );
    process.exit(2);
  }
  const teams = new Map<string, Record<string, string>>();
  for (const r of (JSON.parse(readFileSync(audit, "utf8")) as { runs: RunRecord[] }).runs) {
    teams.set(
      r.id,
      Object.fromEntries(Object.entries(r.team?.lanes ?? {}).map(([lane, c]) => [lane, c.harness])),
    );
  }
  const all: Launch[] = [];
  const missing: string[] = [];
  for (const run of runs) {
    const folder = dirs.map((d) => join(d, run)).find((p) => existsSync(p));
    if (!folder) {
      missing.push(run);
      continue;
    }
    all.push(...launchesOf(run, folder, teams.get(run) ?? {}));
  }
  const text = `${JSON.stringify({ launches: all, missing }, null, 2)}\n`;
  if (looksLikePath(text)) throw new Error("the output names a path; nothing written");
  writeFileSync(out, text);
}

if (import.meta.main) main();
