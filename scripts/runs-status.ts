// One line per run under a project's run root: the run, its stage and leg from the manifest,
// the markers present, minutes since anything in it changed, and what the postmaster does
// next. This is the postmaster's poll; it reads files and nothing else. A pending escalation
// from the postmaster to the user is printed first, since it is what everything else may
// be waiting on. The waiting list itself is kept by run host leg waiting, never by hand.
//
//   run runs-status <project-run-root>        e.g. <project>/.postmaster/runs
//
//   next   USER      the postmaster has put this run's question to the user and waits for the
//                    answer (.waiting-on-user)
//          RULE      an escalation is waiting (.escalation-ready)
//          GATE      the ship card is complete (.card-ready)
//          SPEC      a spec review package is waiting (.spec-review-ready): the postmaster puts
//                    each workhorse's spec to the user, one at a time
//          DISPATCH  the current leg is done (.leg-<n>-done): the next leg, or after the last,
//                    the postmaster's close
//          ASK       a recorded refusal, pre-thread exit, or wall on the fallback needs a user
//          TAKEOVER  a primary coachman hit a recorded wall: start the fallback
//          RESUME    a leg exited with a thread id and no hand-off: resume it
//          READ      a checkpoint card is waiting to be read (.checkpoint-*-ready)
//          INSPECT   an attempt died without its record, the last record is corrupt,
//                    or no marker and nothing changed for 30 minutes, run not done
//          WAIT      a leg is running and its files are moving
//          -         the manifest says done or abandoned
//
// Idle time ignores the marker files themselves, so touching a marker never hides a stall.
//
//   exit 0  listed (an empty root lists nothing)
//   exit 1  usage, or no such root
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { run } from "./lib/proc.ts";
import { pyWords } from "./lib/text.ts";

interface RunRow {
  run: string;
  stage: string;
  leg: string;
  markers: string[];
  idleMin: number;
  next: string;
}

// Python's str() for a manifest value, as the table prints it: True, None and
// [] in Python's spelling, and a float with its point (the raw token says
// whether the number parsed as one). Non-empty containers serialise as JSON,
// which differs from str() in quotes; manifests never hold them.
function pyStr(v: unknown, raw: string, key: string): string {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (typeof v === "number") {
    const tok = new RegExp(
      `"${key}"[ \\t\\n\\r]*:[ \\t\\n\\r]*(-?[0-9]+(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)`,
      "u",
    ).exec(raw)?.[1];
    if (tok !== undefined && (tok.includes(".") || /[eE]/u.test(tok))) {
      return Number.isInteger(v) ? `${String(v)}.0` : String(v);
    }
    return String(v);
  }
  if (typeof v === "bigint") return String(v);
  try {
    return JSON.stringify(v) ?? "";
  } catch {
    return "";
  }
}

// Main's int() on a JSON value: numbers truncate, booleans are 0 and 1,
// strings take a sign and underscores between digits, anything else fails.
function pyInt(v: unknown, dflt: number): number {
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return Number.isFinite(v) ? Math.trunc(v) : dflt;
  if (typeof v === "string") {
    const t = v.trim();
    if (/^[+-]?[0-9]([0-9_]*[0-9])?$/u.test(t)) return Number(t.replace(/_/gu, ""));
  }
  return dflt;
}

// The owner the active file names is still the process it named: same pid,
// same start, not a zombie. A directory lock is the shape from before the
// owner file and holds no owner: always stale.
function ownerAlive(d: string, leg: string): boolean {
  let p = join(d, `.leg-${leg}-active`);
  try {
    if (statSync(p).isDirectory()) p = join(p, "owner");
  } catch {
    return false;
  }
  let pidS: string;
  let start: string;
  try {
    const text = readFileSync(p, "utf8").trim();
    const sp = text.indexOf(" ");
    pidS = sp === -1 ? text : text.slice(0, sp);
    start = sp === -1 ? "" : text.slice(sp + 1);
    // Main's int() takes a sign and underscores between digits; a trailing
    // underscore or anything else is not a pid.
    if (!/^[+-]?[0-9]([0-9_]*[0-9])?$/u.test(pidS)) return false;
  } catch {
    return false;
  }
  const pid = Number(pidS.replace(/_/gu, ""));
  try {
    if (statSync("/proc/self").isDirectory()) {
      let rest: string[];
      try {
        const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
        rest = pyWords(stat.slice(stat.lastIndexOf(")") + 1));
      } catch {
        return false;
      }
      return rest.length > 0 && rest[0] !== "Z" && rest.length > 19 && rest[19] === start;
    }
  } catch {
    // No /proc/self: fall through to ps.
  }
  const r = run("ps", ["-o", "stat=,lstart=", "-p", String(pid)], { env: { LC_ALL: "C" } });
  const f = pyWords(r.out);
  return f.length >= 6 && !f[0]!.startsWith("Z") && f.slice(1, 6).join(" ") === start;
}

export function status(root: string): number {
  const now = Date.now() / 1000;
  const pmEsc = join(root, "postmaster", "ESCALATION.md");
  if (existsSync(pmEsc)) {
    console.log(`POSTMASTER     escalation to the user is pending: ${pmEsc}`);
  }
  const rows: RunRow[] = [];
  const entries = readdirSync(root).sort();
  for (const run of entries) {
    const d = join(root, run);
    let isDirectory = false;
    try {
      isDirectory = statSync(d).isDirectory();
    } catch {
      continue;
    }
    if (!isDirectory || run === "postmaster") continue;

    let stage = "no manifest";
    let leg = "?";
    const mp = join(d, "manifest.json");
    if (existsSync(mp)) {
      try {
        const raw = readFileSync(mp, "utf8");
        const m: unknown = JSON.parse(raw);
        if (typeof m !== "object" || m === null || Array.isArray(m)) {
          throw new Error("not a manifest object");
        }
        const rec = m as Record<string, unknown>;
        stage = "stage" in rec ? pyStr(rec.stage, raw, "stage") : "?";
        leg = "leg" in rec ? pyStr(rec.leg, raw, "leg") : "?";
      } catch {
        stage = "manifest unreadable";
      }
    }

    const markerPats = [".*-ready", ".leg-*-done", ".leg-*-exited", ".waiting-on-user"];
    const markers: string[] = [];
    for (const pat of markerPats) {
      for (const p of readdirSync(d)) {
        if (matchMarker(p, pat)) markers.push(p);
      }
    }
    markers.sort();

    let newest = 0;
    walkFiles(d, (f) => {
      if (basename(f).startsWith(".")) return;
      try {
        const st = statSync(f);
        newest = Math.max(newest, st.mtimeMs / 1000);
      } catch {
        /* ignore */
      }
    });
    const idleMin = newest ? Math.floor((now - newest) / 60) : -1;

    const done = markers.includes(`.leg-${leg}-done`);
    const exited = markers.includes(`.leg-${leg}-exited`);
    // A lock is active only while its owner lives: a lock whose owner is gone
    // is stale, with or without its exited marker, and a legacy directory lock
    // holds no owner and is stale too.
    const active = existsSync(join(d, `.leg-${leg}-active`)) && !exited && ownerAlive(d, leg);
    // Only the last record decides; a corrupt middle line is superseded
    // history. A last line that is not a record is fail-closed INSPECT.
    let outcome: unknown = "";
    let role: unknown = "";
    let lastAttempt = -1;
    let corrupt = false;
    try {
      const lines = readFileSync(join(d, "logs", `coachman-leg-${leg}-attempts.jsonl`), "utf8")
        .split("\n")
        .filter((l) => l.trim() !== "");
      if (lines.length > 0) {
        let last: unknown;
        try {
          last = JSON.parse(lines[lines.length - 1]!);
        } catch {
          corrupt = true;
        }
        if (!corrupt) {
          if (typeof last === "object" && last !== null && !Array.isArray(last)) {
            const rec = last as Record<string, unknown>;
            outcome = rec.outcome ?? "";
            role = rec.role ?? "";
            lastAttempt = pyInt(rec.attempt, -1);
          } else {
            corrupt = true;
          }
        }
      }
    } catch {
      // No attempt record yet.
    }
    // Currency: every started attempt ends in a record. A phase or intent file
    // beyond the last record means an attempt died unrecorded: INSPECT, never
    // the stale outcome. A running attempt holds the lock, so it reads WAIT.
    const tailMax = (prefix: string, suffix: string): number => {
      let found = -1;
      try {
        for (const f of readdirSync(join(d, "logs"))) {
          if (!f.startsWith(prefix) || !f.endsWith(suffix)) continue;
          let tail = f.slice(f.lastIndexOf("-") + 1);
          if (suffix !== "") tail = tail.split(".")[0]!;
          // Main's isdigit admits exotic numerals that its int then chokes on;
          // the port reads ASCII digits, the only shape the leg script writes.
          if (/^[0-9]+$/u.test(tail)) found = Math.max(found, Number(tail));
        }
      } catch {
        // No logs yet.
      }
      return found;
    };
    const phaseMax = tailMax(`coachman-leg-${leg}-phase-`, "");
    const intentMax = tailMax(`coachman-leg-${leg}-intent-`, ".json");
    const gap = phaseMax > lastAttempt || intentMax > lastAttempt;
    let next: string;
    if (stage === "done" || stage === "abandoned") next = "-";
    else if (markers.includes(".waiting-on-user")) next = "USER";
    else if (markers.includes(".escalation-ready")) next = "RULE";
    else if (markers.includes(".card-ready")) next = "GATE";
    else if (active) next = "WAIT";
    else if (gap || corrupt) next = "INSPECT";
    // A waiting spec package beats the whole outcome block: the pause writes an
    // incomplete record by design, and that record must never beat its marker.
    else if (markers.includes(".spec-review-ready")) next = "SPEC";
    else if (outcome === "finished") next = "DISPATCH";
    else if (outcome === "refused" || outcome === "pre-thread") next = "ASK";
    else if (outcome === "walled" && role === "coachman") next = "TAKEOVER";
    else if (outcome === "walled" && role === "coachman_fallback") next = "ASK";
    else if (outcome === "incomplete") next = "RESUME";
    else if (done) next = "DISPATCH";
    else if (exited) next = "INSPECT";
    else if (markers.some((mk) => mk.startsWith(".checkpoint-"))) next = "READ";
    else if (idleMin >= 30) next = "INSPECT";
    else next = "WAIT";

    rows.push({ run, stage, leg, markers, idleMin, next });
  }

  const hdr = (a: string, b: string, c: string, d: string, e: string, f: string) =>
    `${a.padEnd(14)} ${b.padEnd(16)} ${c.padEnd(4)} ${d.padEnd(44)} ${e.padStart(6)}  ${f}`;
  console.log(hdr("RUN", "STAGE", "LEG", "MARKERS", "IDLE", "NEXT"));
  for (const r of rows) {
    console.log(
      `${r.run.padEnd(14)} ${r.stage.padEnd(16)} ${r.leg.padEnd(4)} ${(r.markers.join(",") || "-").padEnd(44)} ${String(r.idleMin).padStart(5)}m  ${r.next}`,
    );
  }
  return 0;
}

function matchMarker(name: string, pat: string): boolean {
  // Convert a simple glob like ".leg-*-done" to a regex
  const re = new RegExp(
    "^" +
      pat
        .replace(/[.+^${}()|[\]\\]/gu, "\\$&")
        .replace(/\*/gu, "[^/]*")
        .replace(/\?/gu, ".") +
      "$",
    "u",
  );
  return re.test(name);
}

export function walkFiles(dir: string, fn: (path: string) => void): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walkFiles(p, fn);
    else fn(p);
  }
}

// --- entry ------------------------------------------------------------------------------
const argv = process.argv.slice(2);
if (import.meta.main) {
  if (argv.length !== 1) {
    console.error("usage: run runs-status <project-run-root>");
    process.exit(1);
  }
  const raw = argv[0] as string;
  let root: string;
  try {
    root = resolve(raw);
    if (!statSync(root).isDirectory()) throw new Error("not dir");
  } catch {
    console.error(`runs-status: no such root: ${raw}`);
    process.exit(1);
  }
  process.exit(status(root));
}
