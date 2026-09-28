import { appendFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atomicWrite, command, scriptDir, writeError, writeOut } from "./lib/core.ts";

const stages =
  "dispatched bootstrapped workhorses-running synthesis checkpoint-1 review shipping shipped done abandoned".split(" ");
const here = scriptDir(import.meta.url);
function agoLabel(directory: string, old: string): string {
  const log = join(directory, "actions.jsonl");
  let since: string | undefined;
  if (existsSync(log))
    for (const line of readFileSync(log, "utf8").split(/\r?\n/)) {
      try {
        const event = JSON.parse(line) as { action?: string; target?: string; ts?: string };
        if ((event.action === "stage" && event.target === old) || (event.action === "dispatch" && since === undefined))
          since = event.ts;
      } catch {
        /* Invalid earlier lines are ignored just as the JSON reader did. */
      }
    }
  if (!since) return "";
  const seconds = Math.max(0, Math.trunc((Date.now() - Date.parse(since)) / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return ` after ${h ? `${h}h ${String(m).padStart(2, "0")}m` : m ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`}`;
}
function setStage(directory: string, next: string, actor: string, quiet = false): number {
  const error = (message: string, code: number) => {
    if (!quiet) writeError(message);
    return code;
  };
  if (!stages.includes(next)) return error(`stage: '${next}' is not a stage; one of: ${stages.join(" ")}`, 2);
  if ((next === "done" || next === "abandoned") && actor !== "postmaster")
    return error(`stage: only the postmaster sets ${next}`, 4);
  const manifestPath = join(directory, "manifest.json");
  if (!existsSync(manifestPath)) return error(`stage: no manifest at ${manifestPath}`, 1);
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    return error(`stage: ${manifestPath} does not parse`, 1);
  }
  const old = typeof manifest.stage === "string" ? manifest.stage : "none";
  if (manifest.stage === next) {
    if (!quiet) writeOut(`stage: already ${next}`);
    return 0;
  }
  if ((old === "done" || old === "abandoned") && actor !== "postmaster") {
    return error(`stage: the run is ${old}; only the postmaster moves it on`, 3);
  }
  const took = agoLabel(directory, old);
  const logged = command("bun", [join(here, "log-action.ts"), directory, actor, "stage", next, `from ${old}${took}`]);
  if (logged.code !== 0) return error("stage: could not log the change", 1);
  manifest.stage = next;
  try {
    atomicWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  } catch {
    return error("stage: logged, but could not write the manifest", 1);
  }
  command("bun", [join(here, "run-log.ts"), directory, `stage ${next}, from ${old}${took}`]);
  if (next === "done" || next === "abandoned") {
    const timings = command("bun", [join(here, "run-times.ts"), directory]);
    const fence = "`".repeat(3);
    appendFileSync(
      join(directory, "run-log.md"),
      `\nStage timings, from actions.jsonl:\n\n${fence}\n${timings.stdout}${fence}\n`,
    );
  }
  if (!quiet) writeOut(`stage: ${old} -> ${next}${took}`);
  return 0;
}

function selfTest(): number {
  const temp = mkdtempSync(join(tmpdir(), "stage-"));
  const directory = join(temp, "project", "RUN-1");
  mkdirSync(directory, { recursive: true });
  let fails = 0;
  const ok = (label: string) => writeOut(`  ok   ${label}`);
  const fail = (label: string, detail = "") => {
    writeOut(`  FAIL ${label}${detail ? ` (${detail})` : ""}`);
    fails++;
  };
  const fresh = () => {
    writeFileSync(
      join(directory, "manifest.json"),
      '{"stage": "dispatched", "leg": 1, "base": "abc123", "lanes": {"luna": {"outcome": "running"}}, "coachman": {"legs": {}}}\n',
    );
    writeFileSync(join(directory, "actions.jsonl"), "");
    writeFileSync(join(directory, "run-log.md"), "");
    command("bun", [join(here, "log-action.ts"), directory, "postmaster", "dispatch", "RUN-1", "test"]);
  };
  const stageCount = () =>
    readFileSync(join(directory, "actions.jsonl"), "utf8")
      .split(/\r?\n/)
      .filter((line: string) => {
        try {
          return JSON.parse(line).action === "stage";
        } catch {
          return false;
        }
      }).length;
  try {
    writeOut("positive controls");
    fresh();
    let rc = setStage(directory, "bootstrapped", "coachman", true);
    rc === 0 && stageCount() === 1
      ? ok("a change logs exactly one stage line")
      : fail("a change logs exactly one stage line", `exit ${rc}, lines ${stageCount()}`);
    const expected = {
      stage: "bootstrapped",
      leg: 1,
      base: "abc123",
      lanes: { luna: { outcome: "running" } },
      coachman: { legs: {} },
    };
    JSON.stringify(JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"))) === JSON.stringify(expected)
      ? ok("only the manifest's stage field changes")
      : fail("only the manifest's stage field changes");
    readFileSync(join(directory, "run-log.md"), "utf8").includes("stage bootstrapped, from dispatched after")
      ? ok("run-log.md records the change and how long the last stage took")
      : fail("run-log.md records the change and how long the last stage took");
    setStage(directory, "done", "postmaster", true);
    const terminalLog = readFileSync(join(directory, "run-log.md"), "utf8");
    terminalLog.includes("Stage timings, from actions.jsonl") && terminalLog.includes("^bootstrapped ")
      ? ok("the postmaster's terminal stage appends the run's timings")
      : terminalLog.includes("Stage timings, from actions.jsonl") && /^bootstrapped /m.test(terminalLog)
        ? ok("the postmaster's terminal stage appends the run's timings")
        : fail("the postmaster's terminal stage appends the run's timings");
    fresh();
    rc = setStage(directory, "abandoned", "postmaster", true);
    rc === 0 &&
    stageCount() === 1 &&
    readFileSync(join(directory, "manifest.json"), "utf8").includes('"stage": "abandoned"')
      ? ok("the postmaster abandons a run")
      : fail("the postmaster abandons a run", `exit ${rc}, lines ${stageCount()}`);
    fresh();
    rc = setStage(directory, "review", "coachman", true);
    rc === 0 &&
    stageCount() === 1 &&
    readFileSync(join(directory, "manifest.json"), "utf8").includes('"stage": "review"')
      ? ok("review is one stage")
      : fail("review is one stage", `exit ${rc}, lines ${stageCount()}`);
    writeOut("negative controls");
    fresh();
    setStage(directory, "bootstrapped", "coachman", true);
    rc = setStage(directory, "bootstrapped", "coachman", true);
    rc === 0 && stageCount() === 1
      ? ok("setting the same stage again logs nothing")
      : fail("setting the same stage again logs nothing", `lines ${stageCount()}`);
    fresh();
    let before = readFileSync(join(directory, "manifest.json"), "utf8");
    rc = setStage(directory, "reviewing", "coachman", true);
    rc === 2 && stageCount() === 0 && readFileSync(join(directory, "manifest.json"), "utf8") === before
      ? ok("an unknown stage is refused, and nothing changes")
      : fail("an unknown stage is refused, and nothing changes", `exit ${rc}`);
    for (const old of ["review-style", "review-bug", "review-security"]) {
      fresh();
      before = readFileSync(join(directory, "manifest.json"), "utf8");
      rc = setStage(directory, old, "coachman", true);
      rc === 2 && stageCount() === 0 && readFileSync(join(directory, "manifest.json"), "utf8") === before
        ? ok(`${old} is refused, and nothing changes`)
        : fail(`${old} is refused, and nothing changes`, `exit ${rc}`);
    }
    for (const terminal of ["done", "abandoned"]) {
      fresh();
      before = readFileSync(join(directory, "manifest.json"), "utf8");
      rc = setStage(directory, terminal, "coachman", true);
      rc === 4 && stageCount() === 0 && readFileSync(join(directory, "manifest.json"), "utf8") === before
        ? ok(`${terminal} from the coachman is refused, and nothing changes`)
        : fail(`${terminal} from the coachman is refused, and nothing changes`, `exit ${rc}`);
    }
    fresh();
    setStage(directory, "abandoned", "postmaster", true);
    before = readFileSync(join(directory, "manifest.json"), "utf8");
    rc = setStage(directory, "synthesis", "coachman", true);
    rc === 3 && stageCount() === 1 && readFileSync(join(directory, "manifest.json"), "utf8") === before
      ? ok("the coachman cannot move a run out of abandoned")
      : fail("the coachman cannot move a run out of abandoned", `exit ${rc}`);
    rmSync(join(directory, "manifest.json"));
    rc = setStage(directory, "bootstrapped", "coachman", true);
    rc === 1 ? ok("no manifest is refused") : fail("no manifest is refused", `exit ${rc}`);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
  writeOut("");
  writeOut(fails === 0 ? "self-test: all controls behaved" : `self-test: ${fails} control(s) misbehaved`);
  return fails === 0 ? 0 : 1;
}

const args = process.argv.slice(2);
if (args[0] === "--list") {
  for (const stage of stages) writeOut(stage);
  process.exit(0);
}
if (args[0] === "--self-test") process.exit(selfTest());
if (!args[0] || args[0].startsWith("-")) {
  writeError("usage: stage.sh <dispatch> <stage> [actor] | --list | --self-test");
  process.exit(1);
}
if (args.length < 2) {
  writeError("usage: stage.sh <dispatch> <stage> [actor]");
  process.exit(1);
}
process.exit(setStage(args[0], args[1], args[2] ?? "coachman"));
