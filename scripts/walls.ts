// A provider wall: the lane that stopped on its provider's usage limit, its record, and the
// one command surface the flow tells, rules and carries a wall through.
//
//   run walls show <dispatch>                  one line per wall: run, lane, role, message, reset
//   run walls open <dispatch>                  list the walls with no ruling; exit 1 while any
//   run walls told <dispatch> <lane>           mark every untold wall of that lane as told
//   run walls rule <dispatch> <lane> go-on     record the one ruling this ticket adds
//   run walls escalate <dispatch>              write ESCALATION.md and pause the leg on it
//   run walls carry <dispatch> <lane>          record the go-on the harvest carries out
//
//   exit 0  done (open: no wall is waiting on a ruling)
//   exit 1  usage, an unreadable dispatch, an unreadable action log, no wall where one
//           was named, or open: walls with no ruling, each listed on its own line
//   exit 2  a ruling refused, the reason on stderr: rest, reset-now and substitute are the
//           separate ticket's; go-on for a workhorse wall is refused for the last workhorse
//           that could still produce work, and every ruling once every wall of the lane
//           is carried out
//
// Walls live in the run's actions.jsonl as `wall` lines (log-action.ts), each with the lane
// as its target and `<role> <lens> <round> <reset> <the provider's first line>` as its
// detail; a `told` line marks the walls of its lane before it as told, a `rule` line whose
// detail opens `wall go-on` marks them ruled, and a `carry` line records the carry-out.
// Lines are read in file order, so a lane that walls again has a new wall that the earlier
// told and ruling never cover. A wall the launch detected but could not record leaves
// `logs/<lane>.wall-lost` instead: `open` refuses while one exists, `show` and
// `escalate` name it with its repair, and it is removed by hand once the wall is
// re-recorded. A missing log reads as no walls; an unreadable one refuses every
// command but open, which reads it as no walls so the watcher's pinned
// act-and-wake on unloggable actions still holds. A survey's wall is shown but
// never open: the surveyor launches as a reviewer, its stream never matches a
// review round, the call fails closed with its own degrade line, and the
// caller carries the no-answer path, so no ruling is ever asked for it.
//
// The reset arrives on the `wall` line: run launch parses it from the message the provider
// ended the turn with (lib/wall.ts, D4 and D5), and show prints it in the machine's zone.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { scriptsDir } from "./lib/paths.ts";
import { run } from "./lib/proc.ts";

const HERE = scriptsDir(import.meta);
const USAGE =
  "run walls show|open <dispatch> | told|carry <dispatch> <lane> | rule <dispatch> <lane> go-on | escalate <dispatch>";

export interface Wall {
  /** 0-based line number in actions.jsonl, the order the run did things in. */
  index: number;
  lane: string;
  role: string; // workhorse | reviewer
  lens: string; // "-" for a workhorse, else the reviewer's lens
  round: string; // "-" or the round number
  reset: string; // ISO time with offset, or "none"
  message: string; // the provider's message, first line, byte for byte
  ts: string; // the wall line's own timestamp
  told: boolean;
  ruled: boolean;
  carried: boolean;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The five words of a wall detail, or null when it is not five words. */
export interface WallDetail {
  role: string;
  lens: string;
  round: string;
  reset: string;
  message: string;
}

// The `s` flag: the message may hold U+2028 or U+2029, which `.` without it
// refuses, and a reviewer's wall would then read as a workhorse's.
export function parseWallDetail(detail: string): WallDetail | null {
  const m = /^([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) (.*)$/su.exec(detail);
  if (!m) return null;
  return { role: m[1]!, lens: m[2]!, round: m[3]!, reset: m[4]!, message: m[5]! };
}

/** Every wall in the run, with its told/ruling/carry state read from the lines after it. */
export function readWalls(dispatch: string): Wall[] {
  let text: string;
  try {
    text = readFileSync(join(dispatch, "actions.jsonl"), "utf8");
  } catch {
    return [];
  }
  const raw: Array<{ index: number; lane: string; detail: string; ts: string }> = [];
  const tolds: Array<{ index: number; lane: string }> = [];
  const rules: Array<{ index: number; lane: string }> = [];
  const carries: Array<{ index: number; lane: string }> = [];
  let index = 0;
  for (const line of text.split("\n")) {
    if (line.trim() !== "") {
      let e: unknown;
      try {
        e = JSON.parse(line);
      } catch {
        e = null;
      }
      if (isRecord(e)) {
        const action = typeof e.action === "string" ? e.action : "";
        const target = typeof e.target === "string" ? e.target : "";
        const detail = typeof e.detail === "string" ? e.detail : "";
        const ts = typeof e.ts === "string" ? e.ts : "";
        if (action === "wall") raw.push({ index, lane: target, detail, ts });
        else if (action === "told") tolds.push({ index, lane: target });
        else if (action === "rule" && detail.startsWith("wall go-on")) {
          rules.push({ index, lane: target });
        } else if (action === "carry") carries.push({ index, lane: target });
      }
    }
    index += 1;
  }
  return raw.map((w) => {
    const p = parseWallDetail(w.detail);
    const role = p ? p.role : "workhorse";
    const lens = p ? p.lens : "-";
    const round = p ? p.round : "-";
    const reset = p ? p.reset : "none";
    const message = p ? p.message : w.detail;
    const after = (rows: Array<{ index: number; lane: string }>): boolean =>
      rows.some((r) => r.lane === w.lane && r.index > w.index);
    return {
      index: w.index,
      lane: w.lane,
      role,
      lens,
      round,
      reset,
      message,
      ts: w.ts,
      told: after(tolds),
      ruled: after(rules),
      carried: after(carries),
    };
  });
}

/** actions.jsonl exists but cannot be read: a missing log reads as no walls, an unreadable one never does. */
export function logUnreadable(dispatch: string): boolean {
  const p = join(dispatch, "actions.jsonl");
  if (!existsSync(p)) return false;
  try {
    readFileSync(p, "utf8");
    return false;
  } catch {
    return true;
  }
}

/** Walls the launches detected but could not record, one entry per lane marker file. */
export function lostWalls(dispatch: string): Array<{ lane: string; details: string[] }> {
  let files: string[];
  try {
    files = readdirSync(join(dispatch, "logs"));
  } catch {
    return [];
  }
  const out: Array<{ lane: string; details: string[] }> = [];
  for (const f of files.sort()) {
    if (!f.endsWith(".wall-lost")) continue;
    let lines: string[];
    try {
      lines = readFileSync(join(dispatch, "logs", f), "utf8")
        .split("\n")
        .filter((l) => l !== "");
    } catch {
      continue;
    }
    if (lines.length === 0) continue;
    out.push({ lane: f.slice(0, -".wall-lost".length), details: lines });
  }
  return out;
}

/** A survey's wall: reviewer role with no lens or round, since the surveyor's stream
 * never matches a review round. Genuine review streams always parse, so no other
 * wall reads this way. Shown as telemetry, never waiting on a ruling. */
export function isSurveyWall(w: Wall): boolean {
  return w.role === "reviewer" && w.lens === "-" && w.round === "-";
}

/** The run's wall for a reviewer under a lens in a round, or null. */
export function wallFor(dispatch: string, lane: string, lens: string, round: string): Wall | null {
  for (const w of readWalls(dispatch)) {
    if (w.lane === lane && w.lens === lens && w.round === round) return w;
  }
  return null;
}

/**
 * The run's lost wall for a reviewer under a lens in a round, or null. The
 * file is lane-keyed but its content is round-keyed, so only content naming
 * this reviewer matches: a stale file from an earlier round never degrades a
 * later one. Content that does not parse is not attributable and never
 * matches; `open` still refuses on the file itself.
 */
export function lostWallFor(
  dispatch: string,
  lane: string,
  lens: string,
  round: string,
): WallDetail | null {
  for (const lost of lostWalls(dispatch)) {
    if (lost.lane !== lane) continue;
    for (const detail of lost.details) {
      const p = parseWallDetail(detail);
      if (p !== null && p.role === "reviewer" && p.lens === lens && p.round === round) return p;
    }
  }
  return null;
}

// --- the wall's lines ---------------------------------------------------------------------------
function pad(n: number, w: number): string {
  return String(n).padStart(w, "0");
}

function localISO(ms: number): string {
  const d = new Date(ms);
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}T${pad(d.getHours(), 2)}:${pad(d.getMinutes(), 2)}:${pad(d.getSeconds(), 2)}${sign}${pad(Math.floor(abs / 60), 2)}:${pad(abs % 60, 2)}`;
}

function rolePart(w: Wall): string {
  if (w.role === "reviewer") return w.round === "-" ? "reviewer" : `reviewer round ${w.round}`;
  return "workhorse";
}

function resetPart(w: Wall): string {
  if (w.reset === "none") return "no reset time";
  const ms = Date.parse(w.reset);
  if (Number.isNaN(ms)) return "no reset time";
  return `resets ${localISO(ms)}`;
}

/** `run lane: DEGRADED, provider wall: "<message>", role, reset` — one line, as the cards print it. */
export function showLine(runName: string, w: Wall): string {
  const lens = w.role === "reviewer" && w.lens !== "-" ? ` ${w.lens}` : "";
  return `${runName} ${w.lane}${lens}: DEGRADED, provider wall: "${w.message}", ${rolePart(w)}, ${resetPart(w)}`;
}

function logAction(
  dispatch: string,
  actor: string,
  action: string,
  target: string,
  detail: string,
): number {
  return run(join(HERE, "run"), ["log-action", dispatch, actor, action, target, detail]).code;
}

/** The run's workhorses, from the config it recorded at dispatch. */
function workhorses(dispatch: string): string[] {
  try {
    const j: unknown = JSON.parse(readFileSync(join(dispatch, "run.json"), "utf8"));
    if (!isRecord(j)) return [];
    const cfg = j.config;
    if (!isRecord(cfg)) return [];
    const team = cfg.team;
    if (!isRecord(team)) return [];
    const w = team.workhorses;
    if (!Array.isArray(w)) return [];
    return w.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

/** The repo the run works in, from the recorded checks or the waybill's profile. */
function runRepo(dispatch: string): string {
  try {
    const j: unknown = JSON.parse(readFileSync(join(dispatch, "checks.json"), "utf8"));
    if (isRecord(j) && typeof j.repo === "string" && j.repo.startsWith("/")) return j.repo;
  } catch {
    /* no checks */
  }
  try {
    const text = readFileSync(join(dispatch, "brief.md"), "utf8");
    const profile = text.split("## Project profile")[1] ?? "";
    const m = /^repo:[ \t]*([^\n]+)/mu.exec(profile);
    if (m && m[1]) {
      // The profile line carries more fields after the path (`default branch:`,
      // `BASE:`), so the path ends where they begin; fixtures name it alone.
      const v = m[1].split(/[ \t]+default branch:/u)[0]!.trim();
      if (v.startsWith("/")) return v;
    }
  } catch {
    /* no waybill */
  }
  return "";
}

/** Whether another workhorse could still produce work: running, a summary, or walled open. */
function couldProduce(dispatch: string, walls: Wall[], lane: string): boolean {
  const running =
    existsSync(join(dispatch, "logs", `${lane}-events.jsonl`)) &&
    !existsSync(join(dispatch, "logs", `${lane}.done`));
  if (running) return true;
  const repo = runRepo(dispatch);
  if (repo !== "") {
    const wt = join(repo, ".worktrees", `${basename(dispatch)}-${lane}`);
    if (
      existsSync(join(wt, "WORKHORSE-SUMMARY.md")) ||
      existsSync(join(wt, "WORKHORSE-BLOCKED.md"))
    ) {
      return true;
    }
  }
  return walls.some((w) => w.lane === lane && w.role === "workhorse" && !w.ruled);
}

// --- the commands --------------------------------------------------------------------------------
function resolveDispatch(raw: string): string {
  const r = run("bash", ["-c", `cd "$1" 2>/dev/null && pwd -P`, "_", raw]);
  if (r.code !== 0) {
    console.error(`walls: no such dispatch directory: ${raw}`);
    process.exit(1);
  }
  return r.out.trim();
}

export function wallsCommand(argv: string[]): number {
  const cmd = argv[0] ?? "";
  const two = cmd === "show" || cmd === "open" || cmd === "escalate";
  const three = cmd === "told" || cmd === "carry";
  const four = cmd === "rule";
  if ((!two && !three && !four) || argv[1] === undefined) {
    console.error(`usage: ${USAGE}`);
    return 1;
  }
  if ((two && argv.length !== 2) || (three && argv.length !== 3) || (four && argv.length !== 4)) {
    console.error(`usage: ${USAGE}`);
    return 1;
  }
  const dispatch = resolveDispatch(argv[1]);
  const runName = basename(dispatch);
  const walls = readWalls(dispatch);
  // Every command refuses an unreadable log — except open, whose callers proceed
  // and wake: the watcher dispatches past an unloggable action by pinned contract
  // (runs-watch.test.ts, "a dispatch whose action cannot be logged"), so open reads
  // an unreadable log as no walls and the failing writes downstream do the waking.
  if (cmd !== "open" && logUnreadable(dispatch)) {
    console.error(`walls: cannot read ${join(dispatch, "actions.jsonl")}`);
    return 1;
  }

  if (cmd === "show") {
    for (const w of walls) console.log(showLine(runName, w));
    for (const lost of lostWalls(dispatch)) {
      for (const detail of lost.details) {
        console.log(`${runName} ${lost.lane}: wall detected but not recorded: "${detail}"`);
      }
    }
    return 0;
  }

  if (cmd === "open") {
    const open = walls.filter((w) => !w.ruled && !isSurveyWall(w));
    for (const w of open) {
      const lens = w.role === "reviewer" && w.lens !== "-" ? ` ${w.lens}` : "";
      console.log(`${w.lane}${lens}: no ruling: "${w.message}"`);
    }
    const lost = lostWalls(dispatch);
    for (const l of lost) {
      console.log(`${l.lane}: wall detected but not recorded`);
    }
    return open.length > 0 || lost.length > 0 ? 1 : 0;
  }

  if (cmd === "escalate") {
    const open = walls.filter((w) => !w.ruled && !isSurveyWall(w));
    const lost = lostWalls(dispatch);
    if (open.length === 0 && lost.length === 0) {
      console.error("walls: no wall is waiting on a ruling");
      return 1;
    }
    const lines: string[] = [
      "# Escalation: provider walls",
      "",
      "A lane stopped because its provider's usage limit ran out. The run is paused until",
      "every wall below has a ruling from the user.",
      "",
    ];
    for (const w of open) {
      lines.push(`## ${w.lane} (${rolePart(w)})`);
      lines.push("");
      lines.push(`Provider message: ${w.message}`);
      lines.push(`Reset: ${w.reset === "none" ? "no reset time" : w.reset}`);
      lines.push("");
    }
    for (const l of lost) {
      lines.push(`## ${l.lane} (wall detected but not recorded)`);
      lines.push("");
      for (const detail of l.details) {
        lines.push(`Unrecorded wall: ${detail}`);
      }
      lines.push(
        `Repair: restore ${join(dispatch, "actions.jsonl")}, re-record each wall with \`<tool>/scripts/run log-action ${dispatch} lane:${l.lane} wall ${l.lane} "<detail>"\`, then remove \`logs/${l.lane}.wall-lost\`.`,
      );
      lines.push("");
    }
    lines.push("## The ruling");
    lines.push("");
    lines.push(
      "go on — the run continues without each lane above, recorded DEGRADED with the provider's message. Tell the postmaster the ruling in plain words.",
    );
    lines.push("");
    try {
      writeFileSync(join(dispatch, "ESCALATION.md"), `${lines.join("\n")}\n`);
      writeFileSync(join(dispatch, ".escalation-ready"), "");
      writeFileSync(join(dispatch, ".wall-pause"), "");
    } catch (e) {
      console.error(`walls: cannot write the escalation: ${String(e)}`);
      return 1;
    }
    const listed = [
      ...open.map((w) => `${w.lane} (${rolePart(w)})`),
      ...lost.map((l) => `${l.lane} (unrecorded)`),
    ].join(", ");
    if (
      logAction(dispatch, "coachman", "escalate", "ESCALATION.md", `provider walls: ${listed}`) !==
      0
    ) {
      console.error("walls: the escalation was not recorded");
      return 1;
    }
    return 0;
  }

  const lane = argv[2] ?? "";
  const laneWalls = walls.filter((w) => w.lane === lane);

  if (cmd === "told") {
    for (const w of laneWalls) {
      if (w.told) continue;
      if (logAction(dispatch, "postmaster", "told", lane, `${w.role} ${w.lens} ${w.round}`) !== 0) {
        console.error(`walls: the telling of ${lane}'s wall was not recorded`);
        return 1;
      }
    }
    return 0;
  }

  if (cmd === "carry") {
    if (laneWalls.length === 0) {
      console.error(`walls: no wall for ${lane}`);
      return 1;
    }
    if (laneWalls.some((w) => !w.ruled && !isSurveyWall(w))) {
      console.error(`walls: refused: ${lane} has a wall with no ruling to carry`);
      return 2;
    }
    // Each go-on is carried out once: a ruling recorded after an earlier carry-out
    // still gets its own carry line (C21).
    if (laneWalls.every((w) => w.carried)) return 0;
    if (logAction(dispatch, "coachman", "carry", lane, "wall go-on") !== 0) {
      console.error(`walls: the carry-out of ${lane}'s wall was not recorded`);
      return 1;
    }
    return 0;
  }

  // rule <dispatch> <lane> go-on
  const ruling = argv[3] ?? "";
  if (ruling !== "go-on") {
    if (["rest", "reset-now", "substitute"].includes(ruling)) {
      console.error(`walls: refused: '${ruling}' is a ruling the separate ticket adds (D6)`);
      return 2;
    }
    console.error(`walls: no such ruling: ${ruling}; the one ruling here is go-on`);
    return 1;
  }
  if (laneWalls.length === 0) {
    console.error(`walls: no wall for ${lane}`);
    return 1;
  }
  // A ruling answers the lane's walls that are not carried out yet: a wall from an
  // earlier pause never blocks the ruling a later wall needs (C21). Only when every
  // wall of the lane is carried out is there nothing left to rule.
  if (laneWalls.every((w) => w.carried)) {
    console.error(
      `walls: refused: ${lane}'s wall was already carried out; a ruling after it is refused`,
    );
    return 2;
  }
  const horses = workhorses(dispatch);
  // The safeguard is for workhorse walls (C19): a reviewer wall on a lane that also
  // works takes no work away, so it is never refused as a last workhorse.
  const answersWorkhorse = laneWalls.some((w) => !w.ruled && w.role === "workhorse");
  if (horses.includes(lane) && answersWorkhorse) {
    const others = horses.filter((x) => x !== lane);
    if (!others.some((x) => couldProduce(dispatch, walls, x))) {
      console.error(
        `walls: refused: go-on for ${lane} would leave the run with no workhorse that could still produce work: no other workhorse is running, has a summary, or is walled with no ruling`,
      );
      return 2;
    }
  }
  if (logAction(dispatch, "postmaster", "rule", lane, `wall ${ruling}`) !== 0) {
    console.error(`walls: the ruling for ${lane} was not recorded`);
    return 1;
  }
  return 0;
}

// --- entry ----------------------------------------------------------------------------------------
const argv = process.argv.slice(2);
if (import.meta.main) {
  process.exit(wallsCommand(argv));
}
