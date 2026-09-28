// One line per run under a project's run root: the run, its stage and leg from the manifest,
// the markers present, minutes since anything in it changed, and what the postmaster does
// next. This is the postmaster's poll; it reads files and nothing else. A pending escalation
// from the postmaster to the user is printed first, since it is what everything else may
// be waiting on.
//
//   runs-status.sh <project-run-root>        e.g. ~/.postmaster/runs/<project>
//   runs-status.sh --self-test
//
//   next   USER      the postmaster has put this run's question to the user and waits for the
//                    answer (.waiting-on-user)
//          RULE      an escalation is waiting (.escalation-ready)
//          GATE      the ship card is complete (.card-ready)
//          DISPATCH  the current leg is done (.leg-<n>-done): the next leg, or after the last,
//                    the postmaster's close
//          REMOUNT   the current leg's process exited (.leg-<n>-exited) with no hand-off,
//                    escalation or card: resume it, or relaunch it on the fallback after a wall
//          READ      a checkpoint card is waiting to be read (.checkpoint-*-ready)
//          INSPECT   no marker, nothing changed for 30 minutes, run not done
//          WAIT      a leg is running and its files are moving
//          -         the manifest says done or abandoned
//
// Idle time ignores the marker files themselves, so touching a marker never hides a stall.
//
//   exit 0  listed (an empty root lists nothing)
//   exit 1  usage, or no such root
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { withTempDir } from "./lib/proc.ts";
import { SelfTest } from "./lib/selftest.ts";

interface RunRow {
  run: string;
  stage: string;
  leg: string;
  markers: string[];
  idleMin: number;
  next: string;
}

function status(root: string): number {
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
        const m = JSON.parse(readFileSync(mp, "utf8"));
        stage = String(m.stage ?? "?");
        leg = String(m.leg ?? "?");
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
    let next: string;
    if (stage === "done" || stage === "abandoned") next = "-";
    else if (markers.includes(".waiting-on-user")) next = "USER";
    else if (markers.includes(".escalation-ready")) next = "RULE";
    else if (markers.includes(".card-ready")) next = "GATE";
    else if (done) next = "DISPATCH";
    else if (exited) next = "REMOUNT";
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
      `${r.run.padEnd(14)} ${r.stage.padEnd(16)} ${r.leg.padEnd(4)} ${r.markers.join(",").padEnd(44) || "-"} ${String(r.idleMin).padStart(5)}m  ${r.next}`,
    );
  }
  return 0;
}

function matchMarker(name: string, pat: string): boolean {
  // Convert a simple glob like ".leg-*-done" to a regex
  const re = new RegExp(
    "^" +
      pat
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, "[^/]*")
        .replace(/\?/g, ".") +
      "$",
  );
  return re.test(name);
}

function walkFiles(dir: string, fn: (path: string) => void): void {
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
if (argv[0] !== "--self-test") {
  if (argv.length !== 1) {
    console.error("usage: runs-status.sh <project-run-root> | --self-test");
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

// --- self-test ----------------------------------------------------------------------------
withTempDir((tmp) => {
  const st = new SelfTest();
  const root = join(tmp, "root");

  const mkRun = (name: string, stage: string, leg: number, ...markers: string[]): void => {
    const d = join(root, name);
    mkdirSync(join(d, "logs"), { recursive: true });
    writeFileSync(join(d, "manifest.json"), `{"stage": "${stage}", "leg": ${leg}}\n`);
    writeFileSync(join(d, "run-log.md"), "");
    for (const m of markers) writeFileSync(join(d, m), "");
  };

  const age = (name: string): void => {
    const t = Date.now() / 1000 - 3600;
    const dir = join(root, name);
    walkFiles(dir, (f) => {
      try {
        utimesSync(f, t, t);
      } catch {
        /* ignore */
      }
    });
  };

  const nextOf = (name: string): string => {
    const origLog = console.log;
    let out = "";
    console.log = (s: string) => {
      out += `${s}\n`;
    };
    try {
      status(root);
    } finally {
      console.log = origLog;
    }
    for (const line of out.split("\n")) {
      const parts = line.split(/\s+/);
      if (parts[0] === name) return parts[parts.length - 1] ?? "";
    }
    return "";
  };

  const expect = (label: string, name: string, want: string): void => {
    const got = nextOf(name);
    if (got === want) st.ok(label);
    else st.fail(`${label} (got '${got}', wanted '${want}')`);
  };

  mkRun("rule", "review", 2, ".escalation-ready");
  mkRun("gate", "shipping", 3, ".card-ready");
  mkRun("dispatch", "review", 2, ".leg-2-done", ".leg-2-exited");
  mkRun("remount", "review", 2, ".leg-2-exited");
  mkRun("read", "review", 2, ".checkpoint-review-ready");
  mkRun("inspect", "review", 2);
  age("inspect");
  mkRun("wait", "review", 2);
  mkRun("user", "review", 2, ".waiting-on-user", ".leg-2-exited");
  mkRun("closed", "done", 3, ".leg-3-done", ".leg-3-exited");
  mkRun("earlier", "review", 2, ".leg-1-done");
  mkRun("usergate", "shipping", 3, ".card-ready", ".waiting-on-user");
  mkRun("userclosed", "done", 3, ".waiting-on-user");
  mkRun("stall", "review", 2);
  age("stall");
  writeFileSync(join(root, "stall", ".leg-1-done"), "");
  mkdirSync(join(root, "postmaster"), { recursive: true });

  console.log("positive controls");
  expect("an escalation waiting is RULE", "rule", "RULE");
  expect("a complete ship card is GATE", "gate", "GATE");
  expect("the current leg done is DISPATCH", "dispatch", "DISPATCH");
  expect("the current leg gone with nothing written is REMOUNT", "remount", "REMOUNT");
  expect("a checkpoint card waiting is READ", "read", "READ");
  expect("nothing changed for an hour is INSPECT", "inspect", "INSPECT");
  expect("a leg at work is WAIT", "wait", "WAIT");
  expect("a run waiting on the user is USER, whatever else it holds", "user", "USER");
  expect("a closed run is -", "closed", "-");

  console.log("negative controls");
  expect("an earlier leg's done marker dispatches nothing", "earlier", "WAIT");
  expect("a ship card put to the user waits on the user, not the gate", "usergate", "USER");
  expect("a closed run stays closed with a stale marker", "userclosed", "-");
  expect("touching a marker does not hide a stall", "stall", "INSPECT");
  if (nextOf("postmaster") === "") st.ok("the postmaster's own directory is not a run");
  else st.fail("the postmaster's own directory is not a run");

  st.finish();
});
