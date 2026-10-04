// A provider wall: the lane that stopped on its provider's usage limit, its record, and the
// one command surface the flow tells, rules and carries a wall through.
//
//   walls.sh show <dispatch>                  one line per wall: run, lane, role, message, reset
//   walls.sh open <dispatch>                  list the walls with no ruling; exit 1 while any
//   walls.sh told <dispatch> <lane>           mark every untold wall of that lane as told
//   walls.sh rule <dispatch> <lane> go-on     record the one ruling this ticket adds
//   walls.sh escalate <dispatch>              write ESCALATION.md and pause the leg on it
//   walls.sh carry <dispatch> <lane>          record the go-on the harvest carries out
//
//   exit 0  done (open: no wall is waiting on a ruling)
//   exit 1  usage, an unreadable dispatch, no wall where one was named, or open: walls with
//           no ruling, each listed on its own line
//   exit 2  a ruling refused, the reason on stderr: rest, reset-now and substitute are the
//           separate ticket's; go-on is refused for the last workhorse that could still
//           produce work, and every ruling after the lane's carry-out
//
// Walls live in the run's actions.jsonl as `wall` lines (log-action.ts), each with the lane
// as its target and `<role> <lens> <round> <reset> <the provider's first line>` as its
// detail; a `told` line marks the walls of its lane before it as told, a `rule` line whose
// detail opens `wall go-on` marks them ruled, and a `carry` line records the carry-out.
// Lines are read in file order, so a lane that walls again has a new wall that the earlier
// told and ruling never cover.
//
// The reset arrives on the `wall` line: launch.sh parses it from the message the provider
// ended the turn with (lib/wall.ts, D4 and D5), and show prints it in the machine's zone.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { scriptsDir } from "./lib/paths.ts";
import { run } from "./lib/proc.ts";

const HERE = scriptsDir(import.meta);
const USAGE =
  "walls.sh show|open <dispatch> | told|carry <dispatch> <lane> | rule <dispatch> <lane> go-on | escalate <dispatch>";

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
    const m = /^([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) (.*)$/u.exec(w.detail);
    const role = m ? m[1]! : "workhorse";
    const lens = m ? m[2]! : "-";
    const round = m ? m[3]! : "-";
    const reset = m ? m[4]! : "none";
    const message = m ? m[5]! : w.detail;
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

/** The run's wall for a reviewer under a lens in a round, or null. */
export function wallFor(dispatch: string, lane: string, lens: string, round: string): Wall | null {
  for (const w of readWalls(dispatch)) {
    if (w.lane === lane && w.lens === lens && w.round === round) return w;
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
  return run(join(HERE, "log-action.sh"), [dispatch, actor, action, target, detail]).code;
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

/** The repo the run works in, from the waybill or the recorded checks. */
function runRepo(dispatch: string): string {
  try {
    const text = readFileSync(join(dispatch, "brief.md"), "utf8");
    const m = /^repo:[ \t]*(\/[^ \t\n]+)/mu.exec(text);
    if (m && m[1]) return m[1];
  } catch {
    /* no waybill */
  }
  try {
    const j: unknown = JSON.parse(readFileSync(join(dispatch, "checks.json"), "utf8"));
    if (isRecord(j) && typeof j.repo === "string" && j.repo.startsWith("/")) return j.repo;
  } catch {
    /* no checks */
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

  if (cmd === "show") {
    for (const w of walls) console.log(showLine(runName, w));
    return 0;
  }

  if (cmd === "open") {
    const open = walls.filter((w) => !w.ruled);
    for (const w of open) {
      const lens = w.role === "reviewer" && w.lens !== "-" ? ` ${w.lens}` : "";
      console.log(`${w.lane}${lens}: no ruling: "${w.message}"`);
    }
    return open.length > 0 ? 1 : 0;
  }

  if (cmd === "escalate") {
    const open = walls.filter((w) => !w.ruled);
    if (open.length === 0) {
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
    const listed = open.map((w) => `${w.lane} (${rolePart(w)})`).join(", ");
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
    if (laneWalls.some((w) => !w.ruled)) {
      console.error(`walls: refused: ${lane} has a wall with no ruling to carry`);
      return 2;
    }
    if (laneWalls.some((w) => w.carried)) return 0; // each go-on is carried out once
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
  if (laneWalls.some((w) => w.carried)) {
    console.error(
      `walls: refused: ${lane}'s wall was already carried out; a ruling after it is refused`,
    );
    return 2;
  }
  const horses = workhorses(dispatch);
  if (horses.includes(lane)) {
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
