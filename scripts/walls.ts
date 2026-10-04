// Read and rule on provider usage walls recorded in a run's actions.jsonl.
//
//   walls.sh show <dispatch> [--untold]
//   walls.sh open <dispatch>
//   walls.sh told <dispatch> <lane>
//   walls.sh rule <dispatch> <lane> go-on
//   walls.sh carry <dispatch> <lane>
//   walls.sh escalate <dispatch>
//
// Exit 0 means the operation completed (or no wall is open for `open` and
// `escalate`); `open` exits 1 with its unresolved walls; a refused ruling
// exits 2. All records are append-only actions written through log-action.sh.
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { mkstempSync, run } from "./lib/proc.ts";

const HERE = import.meta.dir;
const USAGE =
  "usage: walls.sh show <dispatch> [--untold] | open <dispatch> | told <dispatch> <lane> | rule <dispatch> <lane> [<lens>] go-on | carry <dispatch> <lane> | escalate <dispatch>";

export interface WallRecord {
  ts: string;
  lane: string;
  role: "workhorse" | "reviewer";
  message: string;
  reset: string;
  lens: string;
  round: number | null;
  sequence: number;
  told: boolean;
  ruling: string;
  carried: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function actions(dispatch: string): Record<string, unknown>[] {
  let text = "";
  try {
    text = readFileSync(join(dispatch, "actions.jsonl"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const rows: Record<string, unknown>[] = [];
  for (const [i, line] of text.split("\n").entries()) {
    if (!line.trim()) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (isRecord(parsed)) rows.push(parsed);
      else throw new Error("not an object");
    } catch {
      throw new Error(`actions.jsonl line ${i + 1} does not parse`);
    }
  }
  return rows;
}

function eventSequence(detail: unknown): number | null {
  if (typeof detail !== "string") return null;
  const match = /^wall ([1-9][0-9]*)(?: lens=(?:style|bug|security))?(?: go-on)?$/u.exec(detail);
  return match ? Number(match[1]) : null;
}

export function readWalls(dispatch: string): WallRecord[] {
  const rows = actions(dispatch);
  const walls: WallRecord[] = [];
  const byKey = new Map<string, WallRecord[]>();
  for (const row of rows) {
    if (row.action !== "wall" || !isRecord(row.wall)) continue;
    const data = row.wall;
    const lane = typeof data.lane === "string" ? data.lane : String(row.target ?? "");
    const role =
      data.role === "reviewer" ? "reviewer" : data.role === "workhorse" ? "workhorse" : null;
    const message = typeof data.message === "string" ? data.message : "";
    const reset = typeof data.reset === "string" ? data.reset : "none";
    const lens = typeof data.lens === "string" ? data.lens : "";
    const round = typeof data.round === "number" ? data.round : null;
    if (!lane || !role || !message) continue;
    const key = `${lane}\u0000${role === "reviewer" ? lens : ""}`;
    const values = byKey.get(key) ?? [];
    const sequence =
      typeof data.sequence === "number" && Number.isSafeInteger(data.sequence) && data.sequence > 0
        ? data.sequence
        : values.length + 1;
    const wall: WallRecord = {
      ts: typeof row.ts === "string" ? row.ts : "",
      lane,
      role,
      message,
      reset,
      lens,
      round,
      sequence,
      told: false,
      ruling: "",
      carried: false,
    };
    values.push(wall);
    byKey.set(key, values);
    walls.push(wall);
  }

  for (const row of rows) {
    if (row.action !== "told" && row.action !== "rule" && row.action !== "carry") continue;
    const lane = typeof row.target === "string" ? row.target : "";
    const sequence = eventSequence(row.detail);
    if (!lane || sequence === null) continue;
    const key = `${lane}\u0000${/(?:^| )lens=(style|bug|security)(?: |$)/u.exec(String(row.detail))?.[1] ?? ""}`;
    const wall = (byKey.get(key) ?? []).find((entry) => entry.sequence === sequence);
    if (!wall) continue;
    if (row.action === "told") wall.told = true;
    if (row.action === "rule") wall.ruling = "go-on";
    if (row.action === "carry") wall.carried = true;
  }
  return walls;
}

function machineZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || process.env.TZ || "UTC";
}

export function formatReset(reset: string, zone = machineZone()): string {
  if (reset === "none") return "no reset time";
  const date = new Date(reset);
  if (Number.isNaN(date.getTime())) return "no reset time";
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${formatter.format(date)} (${zone})`;
}

function describe(runName: string, wall: WallRecord): string {
  const role = wall.role === "reviewer" ? "reviewer" : "workhorse";
  const subject = wall.role === "reviewer" ? `${wall.lane} ${wall.lens}` : wall.lane;
  const result = `${runName} · wall ${wall.sequence} · ${subject}: DEGRADED, provider wall: "${wall.message}" · role ${role} · reset ${formatReset(wall.reset)}`;
  const status = wall.ruling
    ? `ruled ${wall.ruling}`
    : wall.told
      ? "told, awaiting ruling"
      : "untold";
  return `${result} · ${status}`;
}

function log(dispatch: string, actor: string, action: string, lane: string, detail: string): void {
  const r = run(join(HERE, "log-action.sh"), [dispatch, actor, action, lane, detail]);
  if (r.code !== 0) throw new Error((r.err || r.out).trim() || `log-action.sh exited ${r.code}`);
}

function findWall(
  dispatch: string,
  lane: string,
  predicate: (wall: WallRecord) => boolean,
): WallRecord | null {
  return readWalls(dispatch).find((wall) => wall.lane === lane && predicate(wall)) ?? null;
}

function sequenceDetail(wall: WallRecord): string {
  return `wall ${wall.sequence}${wall.role === "reviewer" ? ` lens=${wall.lens}` : ""}`;
}

function repoFromRun(dispatch: string): string {
  try {
    const brief = readFileSync(join(dispatch, "brief.md"), "utf8");
    const profile = brief.lastIndexOf("## Project profile");
    if (profile >= 0) {
      const body = brief.slice(profile).split("\n").slice(1).join("\n").split(/^## /mu)[0] ?? "";
      const repo = /^repo:[ \t]*(.*)$/mu.exec(body)?.[1]?.trim() ?? "";
      if (repo.startsWith("/")) return repo;
    }
  } catch {
    /* use checks.json below */
  }
  try {
    const checks = JSON.parse(readFileSync(join(dispatch, "checks.json"), "utf8")) as Record<
      string,
      unknown
    >;
    return typeof checks.repo === "string" ? checks.repo : "";
  } catch {
    return "";
  }
}

function workhorses(dispatch: string): string[] {
  try {
    const data = JSON.parse(readFileSync(join(dispatch, "run.json"), "utf8")) as Record<
      string,
      unknown
    >;
    const config = isRecord(data.config) ? data.config : {};
    const team = isRecord(config.team) ? config.team : {};
    return Array.isArray(team.workhorses)
      ? team.workhorses.filter((lane): lane is string => typeof lane === "string")
      : [];
  } catch {
    return [];
  }
}

function workhorseCanStillProduce(dispatch: string, lane: string): boolean {
  const repo = repoFromRun(dispatch);
  const worktree = join(repo, ".worktrees", `${basename(dispatch)}-${lane}`);
  if (existsSync(join(worktree, "WORKHORSE-SUMMARY.md"))) return true;
  if (existsSync(join(worktree, "WORKHORSE-BLOCKED.md"))) return false;
  const wall = findWall(dispatch, lane, (entry) => !entry.ruling);
  if (wall) return true;
  const marker = join(dispatch, "logs", `${lane}.done`);
  if (!existsSync(marker)) return true;
  return false;
}

function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = mkstempSync(dirname(path), ".walls.");
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}

function cli(args: string[]): number {
  const [cmd, ...rest] = args;
  const dispatchRaw = rest[0] ?? "";
  let dispatch = "";
  try {
    dispatch = resolve(dispatchRaw);
    if (!statSync(dispatch).isDirectory()) throw new Error("not a directory");
  } catch {
    console.error(`walls: no such dispatch directory: ${dispatchRaw}`);
    return 1;
  }
  const walls = readWalls(dispatch);
  const runName = basename(dispatch);

  if (cmd === "show" && (rest.length === 1 || (rest.length === 2 && rest[1] === "--untold"))) {
    const selected = rest[1] === "--untold" ? walls.filter((wall) => !wall.told) : walls;
    if (!selected.length) {
      console.log(`${runName}: no provider walls${rest[1] === "--untold" ? " to tell" : ""}`);
      return 0;
    }
    for (const wall of selected) console.log(describe(runName, wall));
    return 0;
  }

  if (cmd === "open" && rest.length === 1) {
    const selected = walls.filter((wall) => !wall.ruling);
    for (const wall of selected) console.log(describe(runName, wall));
    return selected.length ? 1 : 0;
  }

  if (cmd === "told" && rest.length === 2) {
    const lane = rest[1]!;
    const wall = findWall(dispatch, lane, (entry) => !entry.told);
    if (!wall) return 0;
    log(dispatch, "postmaster", "told", lane, sequenceDetail(wall));
    return 0;
  }

  if (cmd === "rule" && (rest.length === 3 || rest.length === 4)) {
    const lane = rest[1]!;
    const lens = rest.length === 4 ? rest[2]! : "";
    const ruling = rest[rest.length - 1]!;
    if (ruling !== "go-on") {
      console.error(`walls: refusing ${ruling}: this ticket allows only go-on`);
      return 2;
    }
    if (lens && !["style", "bug", "security"].includes(lens)) {
      console.error(`walls: unknown reviewer lens: ${lens}`);
      return 1;
    }
    const wall = findWall(
      dispatch,
      lane,
      (entry) => !entry.ruling && (!lens || (entry.role === "reviewer" && entry.lens === lens)),
    );
    if (!wall) {
      console.error(`walls: no unruly provider wall for ${lane}`);
      return 2;
    }
    if (!wall.told) {
      console.error(
        `walls: refusing go-on for ${lane}: the user has not been told about this wall`,
      );
      return 2;
    }
    if (wall.role === "workhorse") {
      const others = workhorses(dispatch).filter((name) => name !== lane);
      if (!others.some((other) => workhorseCanStillProduce(dispatch, other))) {
        console.error(
          `walls: refusing go-on for ${lane}: no other workhorse can still produce work`,
        );
        return 2;
      }
    }
    log(dispatch, "postmaster", "rule", lane, `${sequenceDetail(wall)} go-on`);
    return 0;
  }

  if (cmd === "carry" && rest.length === 2) {
    const lane = rest[1]!;
    const carryable = walls.filter(
      (wall) =>
        wall.lane === lane && wall.role === "workhorse" && wall.ruling === "go-on" && !wall.carried,
    );
    if (!carryable.length) return 0;
    for (const wall of carryable) {
      const degraded = `${lane}: DEGRADED, provider wall: "${wall.message}"`;
      const narrative = run(join(HERE, "run-log.sh"), [dispatch, degraded]);
      if (narrative.code !== 0)
        throw new Error(
          (narrative.err || narrative.out).trim() || "could not write the workhorse degradation",
        );
      log(
        dispatch,
        "coachman",
        "degrade",
        lane,
        `workhorse r${wall.sequence}: provider wall: "${wall.message}"`,
      );
      log(dispatch, "coachman", "carry", lane, `${sequenceDetail(wall)} go-on`);
    }
    return 0;
  }

  if (cmd === "escalate" && rest.length === 1) {
    const selected = walls.filter((wall) => !wall.ruling);
    if (!selected.length) return 0;
    const sections = selected.map((wall) => {
      const role =
        wall.role === "reviewer" ? `${wall.lens} reviewer, round ${wall.round}` : "workhorse";
      return `## ${wall.lane} (${role})\n\n- Provider message: "${wall.message}"\n- Reset: ${formatReset(wall.reset)}\n- Ruling: go-on\n`;
    });
    const content = `# Provider walls\n\nRun: ${runName}\n\n${sections.join("\n")}\n`;
    log(
      dispatch,
      "coachman",
      "escalate",
      "provider walls",
      `go-on requested for ${selected.length} wall(s)`,
    );
    atomicWrite(join(dispatch, "ESCALATION.md"), content);
    writeFileSync(join(dispatch, ".provider-walls-paused"), "");
    writeFileSync(join(dispatch, ".escalation-ready"), "");
    return 0;
  }

  console.error(USAGE);
  return 1;
}

if (import.meta.main) {
  try {
    process.exit(cli(process.argv.slice(2)));
  } catch (error) {
    console.error(`walls: ${(error as Error).message}`);
    process.exit(1);
  }
}
