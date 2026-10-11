// How long each coachman thread's last process ran, from the thread's own session export (see
// ../method.md). A thread resumed after a stop has run in several processes and its export records
// the last one's uptime only, so the sum over a run's threads is a floor on the coachman's process
// time, and the stage seconds in instance-time.ts are its ceiling.
//
//   bun uptime.ts --runs <id,id,...> --dir <runs folder> [--dir <another>] --out <file>
//
// Reads only `sessions/coachman/*.json` under each run folder and writes run ids, thread counts and
// seconds. It refuses to write anything that looks like a path.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type SessionExport = { sessions?: Array<{ session_end?: { uptime_ms?: number } | null }> };

/** The uptime in seconds of each session in one export; a session with no recorded end is left out. */
export function uptimeSeconds(exported: SessionExport): number[] {
  return (exported.sessions ?? []).flatMap((s) => {
    const ms = s.session_end?.uptime_ms;
    return typeof ms === "number" && ms > 0 ? [ms / 1000] : [];
  });
}

export type RunUptime = { run: string; threads: number; seconds: number };

/** One run's row from the exports of its coachman threads. */
export function runUptime(run: string, exports: readonly SessionExport[]): RunUptime {
  const each = exports.flatMap(uptimeSeconds);
  return { run, threads: each.length, seconds: Math.round(each.reduce((a, b) => a + b, 0)) };
}

/** True when a string looks like it names a place on a machine. */
export const looksLikePath = (text: string): boolean => /(^|[\s"'])(\/|~\/)[A-Za-z0-9._-]+\//u.test(text);

function main(): void {
  const args = process.argv.slice(2);
  const values = (flag: string): string[] =>
    args.flatMap((a, i) => (a === flag && args[i + 1] ? [args[i + 1] as string] : []));
  const runs = (values("--runs")[0] ?? "").split(",").filter((r) => r !== "");
  const dirs = values("--dir");
  const out = values("--out")[0];
  if (runs.length === 0 || dirs.length === 0 || !out) {
    process.stderr.write("usage: bun uptime.ts --runs <ids> --dir <runs folder> [--dir ...] --out <file>\n");
    process.exit(2);
  }
  const rows: RunUptime[] = [];
  const missing: string[] = [];
  for (const run of runs) {
    const folder = dirs.map((d) => join(d, run, "sessions", "coachman")).find((p) => existsSync(p));
    if (!folder) {
      missing.push(run);
      continue;
    }
    const exports = readdirSync(folder)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(join(folder, f), "utf8")) as SessionExport);
    rows.push(runUptime(run, exports));
  }
  const text = `${JSON.stringify({ rows, missing }, null, 2)}\n`;
  if (looksLikePath(text)) throw new Error("the output names a path; nothing written");
  writeFileSync(out, text);
}

if (import.meta.main) main();
