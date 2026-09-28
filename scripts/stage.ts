// Move a run to a stage. This is the one way a run's stage changes, so every change is logged,
// and the run's timings (scripts/run-times.sh) are computed from those log lines rather than
// written by hand.
//
//   stage.sh <dispatch> <stage> [actor]   actor defaults to coachman
//   stage.sh --list                       the stages, in order
//   stage.sh --self-test
//
// It logs a `stage` action naming the stage left and how long it lasted, changes only the
// manifest's `stage` field, and appends the same line to run-log.md. Setting the stage a run is
// already in does nothing, so a resumed or remounted leg can set it again safely. Setting a
// terminal stage (done, abandoned) also appends the run's full stage timings to run-log.md.
// Only the postmaster sets a terminal stage, or moves a run out of one: it closes a run after
// the last leg, and abandons one on the user's word. The actor is the caller's own word, so this
// holds a coachman to its runbook; it cannot stop a process that names itself the postmaster.
//
//   exit 0  the stage was set, or already was
//   exit 1  usage, no manifest, an unreadable manifest, or the log could not be written
//   exit 2  not one of the stages
//   exit 3  the run is done or abandoned, and only the postmaster moves it on
//   exit 4  a terminal stage set by any actor but the postmaster
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { scriptsDir } from "./lib/paths.ts";
import { run, withTempDir } from "./lib/proc.ts";
import { SelfTest } from "./lib/selftest.ts";

const STAGES =
  "dispatched bootstrapped workhorses-running synthesis checkpoint-1 review shipping shipped done abandoned";
const STAGE_LIST = STAGES.split(" ");

function setStage(d: string, newStage: string, actor: string): number {
  const HERE = scriptsDir(import.meta);

  if (!STAGE_LIST.includes(newStage)) {
    console.error(`stage: '${newStage}' is not a stage; one of: ${STAGES}`);
    return 2;
  }
  if (newStage === "done" || newStage === "abandoned") {
    if (actor !== "postmaster") {
      console.error(`stage: only the postmaster sets ${newStage}`);
      return 4;
    }
  }
  const manifestPath = join(d, "manifest.json");
  if (!existsSync(manifestPath)) {
    console.error(`stage: no manifest at ${manifestPath}`);
    return 1;
  }

  // Compute the plan
  let old: string | null = null;
  try {
    const m = JSON.parse(readFileSync(manifestPath, "utf8"));
    old = m.stage ?? null;
  } catch {
    console.error(`stage: ${manifestPath} does not parse`);
    return 1;
  }

  if (old === newStage) {
    console.log(`stage: already ${newStage}`);
    return 0;
  }
  if ((old === "done" || old === "abandoned") && actor !== "postmaster") {
    console.error(`stage: the run is ${old}; only the postmaster moves it on`);
    return 3;
  }

  // Find when the stage being left was entered
  let since: string | null = null;
  const logPath = join(d, "actions.jsonl");
  if (existsSync(logPath)) {
    for (const line of readFileSync(logPath, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        if (
          (e.action === "stage" && e.target === old) ||
          (e.action === "dispatch" && since === null)
        ) {
          since = e.ts;
        }
      } catch {}
    }
  }

  let took = "";
  if (since) {
    const now = Math.floor(Date.now() / 1000);
    const sinceSec = Math.floor(new Date(`${since.replace(" ", "T")}Z`).getTime() / 1000);
    const sec = Math.max(0, now - sinceSec);
    const h = Math.floor(sec / 3600);
    const rem = sec % 3600;
    const m = Math.floor(rem / 60);
    const s = rem % 60;
    const dur = h
      ? `${h}h ${String(m).padStart(2, "0")}m`
      : m
        ? `${m}m ${String(s).padStart(2, "0")}s`
        : `${s}s`;
    took = ` after ${dur}`;
  }

  // Log the change first
  const logResult = run("bash", [
    join(HERE, "log-action.sh"),
    d,
    actor,
    "stage",
    newStage,
    `from ${old ?? "none"}${took}`,
  ]);
  if (logResult.code !== 0) {
    console.error("stage: could not log the change");
    return 1;
  }

  // Write the manifest
  try {
    const m = JSON.parse(readFileSync(manifestPath, "utf8"));
    m.stage = newStage;
    const tmp = join(d, `.manifest.json.tmp.${process.pid}`);
    writeFileSync(tmp, `${JSON.stringify(m, null, 2)}\n`);
    renameSync(tmp, manifestPath);
  } catch {
    console.error("stage: logged, but could not write the manifest");
    return 1;
  }

  // Append to run-log.md
  run("bash", [join(HERE, "run-log.sh"), d, `stage ${newStage}, from ${old ?? "none"}${took}`]);

  // Terminal stage: append timings
  if (newStage === "done" || newStage === "abandoned") {
    const timesResult = run("bash", [join(HERE, "run-times.sh"), d]);
    const timingBlock = `\nStage timings, from actions.jsonl:\n\n\`\`\`\n${timesResult.out}\`\`\`\n`;
    try {
      appendFileSync(join(d, "run-log.md"), timingBlock);
    } catch {
      /* ignore */
    }
  }

  console.log(`stage: ${old ?? "none"} -> ${newStage}${took}`);
  return 0;
}

// --- entry ------------------------------------------------------------------------------
const argv = process.argv.slice(2);
if (argv[0] === "--list") {
  for (const s of STAGE_LIST) console.log(s);
  process.exit(0);
}
if (argv[0] === "--self-test") {
  // fall through to self-test below
} else if (argv[0] === "" || argv[0] === undefined || argv[0].startsWith("-")) {
  console.error("usage: stage.sh <dispatch> <stage> [actor] | --list | --self-test");
  process.exit(1);
} else {
  if (argv.length < 2) {
    console.error("usage: stage.sh <dispatch> <stage> [actor]");
    process.exit(1);
  }
  process.exit(setStage(argv[0] as string, argv[1] as string, (argv[2] as string) ?? "coachman"));
}

// --- self-test ----------------------------------------------------------------------------
withTempDir((tmp) => {
  const HERE = scriptsDir(import.meta);
  const d = join(tmp, "project", "RUN-1");
  mkdirSync(d, { recursive: true });
  const st = new SelfTest();

  const fresh = (): void => {
    writeFileSync(
      join(d, "manifest.json"),
      '{"stage": "dispatched", "leg": 1, "base": "abc123", "lanes": {"luna": {"outcome": "running"}}, "coachman": {"legs": {}}}\n',
    );
    writeFileSync(join(d, "actions.jsonl"), "");
    writeFileSync(join(d, "run-log.md"), "");
    run("bash", [join(HERE, "log-action.sh"), d, "postmaster", "dispatch", "RUN-1", "test"]);
  };

  const count = (): number => {
    try {
      return readFileSync(join(d, "actions.jsonl"), "utf8")
        .split("\n")
        .filter((l) => l.includes('"action":"stage"')).length;
    } catch {
      return 0;
    }
  };

  const manifestStage = (): string => {
    try {
      return JSON.parse(readFileSync(join(d, "manifest.json"), "utf8")).stage;
    } catch {
      return "?";
    }
  };

  console.log("positive controls");
  fresh();
  let rc = setStage(d, "bootstrapped", "coachman");
  if (rc === 0 && count() === 1) st.ok("a change logs exactly one stage line");
  else st.fail(`a change logs exactly one stage line (exit ${rc}, lines ${count()})`);

  try {
    const m = JSON.parse(readFileSync(join(d, "manifest.json"), "utf8"));
    const expected = {
      stage: "bootstrapped",
      leg: 1,
      base: "abc123",
      lanes: { luna: { outcome: "running" } },
      coachman: { legs: {} },
    };
    if (JSON.stringify(m) === JSON.stringify(expected))
      st.ok("only the manifest's stage field changes");
    else st.fail("only the manifest's stage field changes");
  } catch {
    st.fail("only the manifest's stage field changes");
  }

  try {
    const log = readFileSync(join(d, "run-log.md"), "utf8");
    if (log.includes("stage bootstrapped, from dispatched after"))
      st.ok("run-log.md records the change and how long the last stage took");
    else st.fail("run-log.md records the change and how long the last stage took");
  } catch {
    st.fail("run-log.md records the change and how long the last stage took");
  }

  setStage(d, "done", "postmaster");
  try {
    const log = readFileSync(join(d, "run-log.md"), "utf8");
    if (log.includes("Stage timings, from actions.jsonl") && log.includes("bootstrapped "))
      st.ok("the postmaster's terminal stage appends the run's timings");
    else st.fail("the postmaster's terminal stage appends the run's timings");
  } catch {
    st.fail("the postmaster's terminal stage appends the run's timings");
  }

  fresh();
  rc = setStage(d, "abandoned", "postmaster");
  if (rc === 0 && count() === 1 && manifestStage() === "abandoned")
    st.ok("the postmaster abandons a run");
  else st.fail(`the postmaster abandons a run (exit ${rc}, lines ${count()})`);

  fresh();
  rc = setStage(d, "review", "coachman");
  if (rc === 0 && count() === 1 && manifestStage() === "review") st.ok("review is one stage");
  else st.fail(`review is one stage (exit ${rc}, lines ${count()})`);

  console.log("negative controls");
  fresh();
  setStage(d, "bootstrapped", "coachman");
  rc = setStage(d, "bootstrapped", "coachman");
  if (rc === 0 && count() === 1) st.ok("setting the same stage again logs nothing");
  else st.fail(`setting the same stage again logs nothing (lines ${count()})`);

  fresh();
  const beforeManifest = readFileSync(join(d, "manifest.json"), "utf8");
  rc = setStage(d, "reviewing", "coachman");
  if (
    rc === 2 &&
    count() === 0 &&
    readFileSync(join(d, "manifest.json"), "utf8") === beforeManifest
  )
    st.ok("an unknown stage is refused, and nothing changes");
  else st.fail(`an unknown stage is refused, and nothing changes (exit ${rc})`);

  for (const oldStage of ["review-style", "review-bug", "review-security"]) {
    fresh();
    const before = readFileSync(join(d, "manifest.json"), "utf8");
    rc = setStage(d, oldStage, "coachman");
    if (rc === 2 && count() === 0 && readFileSync(join(d, "manifest.json"), "utf8") === before)
      st.ok(`${oldStage} is refused, and nothing changes`);
    else st.fail(`${oldStage} is refused, and nothing changes (exit ${rc})`);
  }

  for (const t of ["done", "abandoned"]) {
    fresh();
    const before = readFileSync(join(d, "manifest.json"), "utf8");
    rc = setStage(d, t, "coachman");
    if (rc === 4 && count() === 0 && readFileSync(join(d, "manifest.json"), "utf8") === before)
      st.ok(`${t} from the coachman is refused, and nothing changes`);
    else st.fail(`${t} from the coachman is refused, and nothing changes (exit ${rc})`);
  }

  fresh();
  setStage(d, "abandoned", "postmaster");
  const before2 = readFileSync(join(d, "manifest.json"), "utf8");
  rc = setStage(d, "synthesis", "coachman");
  if (rc === 3 && count() === 1 && readFileSync(join(d, "manifest.json"), "utf8") === before2)
    st.ok("the coachman cannot move a run out of abandoned");
  else st.fail(`the coachman cannot move a run out of abandoned (exit ${rc})`);

  rmSync(join(d, "manifest.json"));
  rc = setStage(d, "bootstrapped", "coachman");
  if (rc === 1) st.ok("no manifest is refused");
  else st.fail(`no manifest is refused (exit ${rc})`);

  st.finish();
});
