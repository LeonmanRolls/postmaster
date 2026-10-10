// Tests beside scripts/fixture.ts, moved from its --self-test on #109: 70 controls,
// plus two lane-score controls for the #159 merge.
// The run records, scores and hidden suites are built once in beforeAll; each test asserts.
// CLI-refusal controls spawn the wrapper; internal controls import from "./fixture".
// HOME-altering controls save and restore it (the self-test left it deleted on exit).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { machine, release, tmpdir, type as osType } from "node:os";
import { dirname, join } from "node:path";
import {
  appCached,
  appFiles,
  checkWaybillEfforts,
  checkPremisesOrder,
  checkMode,
  FIXTURE_MARKER,
  HIDDEN_RE,
  gitVersionNumber,
  hidden,
  laneScores,
  legsOf,
  makeAndFile,
  makeBodyFile,
  makeRepo,
  makeScoreDir,
  onPath,
  runMode,
  score,
  sectionOf,
  sh,
  squash,
  TIMEOUT,
  tail,
  ticketBody,
  tickets,
  ticketTitle,
  timeReport,
} from "./fixture";
import { scriptsDir, toolRoot } from "./lib/paths.ts";
import { run } from "./lib/proc.ts";
import { pyWords } from "./lib/text.ts";

const TOOL = toolRoot(import.meta);
const HERE = scriptsDir(import.meta);
const APP = join(TOOL, "fixtures", "app");
const TICKETS = join(TOOL, "fixtures", "tickets");
const wrapper = join(import.meta.dir, "run");
const first = tickets()[0] ?? "";

let tmp = "";
let uni = "";
let uni2 = "";
let uni3 = "";
let sections = "";
let stages = "";
let listed = "";
let dest = "";
const savedEnv: Record<string, string | undefined> = {};
const bgResults = new Map<string, { code: number; out: string }>();
const hiddenResults: Record<string, number> = {};

function timestamp(seconds: number): string {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, seconds)).toISOString().replace(/\.000Z$/u, "Z");
}

function writeMarker(path: string, seconds: number): void {
  writeFileSync(path, "");
  const date = new Date(Date.UTC(2026, 0, 1, 0, 0, seconds));
  utimesSync(path, date, date);
}

function timedCopy(name: string, kind: "floor" | "short" | "long-wait" | "no-stages"): void {
  const source = join(tmp, `clean-${first}`, "repo");
  const repo = join(tmp, name, "repo");
  mkdirSync(dirname(repo), { recursive: true });
  cpSync(source, repo, { recursive: true, preserveTimestamps: true });
  const dispatch = join(repo, ".postmaster", "runs", "7");
  const actionsPath = join(dispatch, "actions.jsonl");
  const events = readFileSync(actionsPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  const stageSeconds =
    kind === "short"
      ? {
          bootstrapped: 120,
          "workhorses-running": 600,
          synthesis: 1320,
          "checkpoint-1": 2040,
          review: 2400,
          shipping: 2880,
          shipped: 3300,
          done: 3441,
        }
      : kind === "long-wait"
        ? {
            bootstrapped: 120,
            "workhorses-running": 720,
            synthesis: 1560,
            "checkpoint-1": 2520,
            review: 3872,
            shipping: 4200,
            shipped: 4986,
            done: 5580,
          }
        : {
            bootstrapped: 120,
            "workhorses-running": 720,
            synthesis: 1560,
            "checkpoint-1": 2520,
            review: 2880,
            shipping: 3600,
            shipped: 3900,
            done: 3960,
          };
  const legOneHandoff = kind === "short" ? 2220 : 2700;
  const legTwoAccept = kind === "long-wait" ? 3871 : kind === "short" ? 2340 : 2820;
  const legTwoHandoff = kind === "long-wait" ? 4201 : kind === "short" ? 3120 : 3720;
  for (const event of events) {
    let seconds = 0;
    if (event.action === "stage" && typeof event.target === "string") {
      seconds = stageSeconds[event.target as keyof typeof stageSeconds] ?? 0;
    } else if (event.action === "handoff-accept") {
      seconds = event.target === "leg-1" ? 60 : legTwoAccept;
    } else if (event.action === "handoff") {
      seconds = event.target === "leg-1" ? legOneHandoff : legTwoHandoff;
    } else if (event.action === "dispatch" && event.actor === "postmaster") {
      seconds = event.detail === "leg 2" ? legOneHandoff + 60 : 0;
    } else if (event.action === "dispatch" && event.actor === "coachman") {
      seconds = event.target === "two" ? 1 : 0;
    }
    event.ts = timestamp(seconds);
  }
  if (kind === "no-stages") {
    writeFileSync(
      actionsPath,
      `${events
        .filter((event) => event.action !== "stage")
        .map((event) => JSON.stringify(event))
        .join("\n")}\n`,
    );
    return;
  }

  const logs = join(dispatch, "logs");
  mkdirSync(logs, { recursive: true });
  writeMarker(join(logs, "one.done"), 600);
  writeMarker(join(logs, "two.done"), 241);
  const reviewStart = stageSeconds.review + 1;
  for (const [lens, lane, elapsed] of [
    ["bug", "mimo", 900],
    ["bug", "codex", 180],
  ] as const) {
    events.push({
      ts: timestamp(reviewStart),
      project: "repo",
      run: "7",
      actor: "coachman",
      action: "review-launch",
      target: lane,
      detail: `${lens} round 1`,
    });
    const doneSeconds =
      kind === "long-wait"
        ? Math.min(stageSeconds.done - 1, reviewStart + elapsed)
        : reviewStart + elapsed;
    writeMarker(join(logs, `review-r1-${lens}-${lane}.done`), doneSeconds);
  }
  writeFileSync(
    join(logs, "review-r1.json"),
    JSON.stringify({
      started: timestamp(reviewStart),
      reviewers: [
        ["bug", "mimo"],
        ["bug", "codex"],
      ],
    }),
  );
  writeFileSync(actionsPath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
  if (kind === "long-wait") {
    writeFileSync(
      join(dispatch, "brief.md"),
      readFileSync(join(dispatch, "brief.md"), "utf8").replace(
        /^efforts:.*$/mu,
        "efforts: one=wrong",
      ),
    );
  }
}

function background(name: string, fn: () => number | { code: number; out: string }): void {
  const r = fn();
  if (typeof r === "number") bgResults.set(name, { code: r, out: "" });
  else bgResults.set(name, r);
}

function rcOf(name: string): number | "none" {
  return bgResults.has(name) ? (bgResults.get(name)?.code ?? 0) : "none";
}

function record(
  name: string,
  t: string,
  shipped: "reference" | "app" | "broken",
  legs = 2,
  mode: "synthesis" | "single-thread" = "synthesis",
): number {
  const repo = join(tmp, name, "repo");
  const d = join(tmp, name, "repo", ".postmaster", "runs", "7");
  mkdirSync(join(tmp, name), { recursive: true });
  if (!makeRepo(repo)) return 1;
  mkdirSync(join(d, "logs"), { recursive: true });
  mkdirSync(join(d, "audit"), { recursive: true });
  mkdirSync(join(d, "render"), { recursive: true });
  const base = run("git", ["-C", repo, "rev-parse", "HEAD"]).out.trim();
  if (run("git", ["-C", repo, "checkout", "-q", "-b", "7"]).code !== 0) return 1;
  const patchPath = join(TICKETS, t, "reference.patch");
  if (shipped === "reference" || shipped === "broken") {
    if (run("git", ["-C", repo, "apply", patchPath]).code !== 0) return 1;
  }
  if (shipped === "broken") {
    writeFileSync(
      join(repo, "src", "broken.ts"),
      'export const broken: number = "not a number";\n',
    );
  }
  run("git", ["-C", repo, "add", "-A"]);
  if (
    run("git", ["-C", repo, "commit", "-q", "--allow-empty", "-m", "Implement the ticket"]).code !==
    0
  )
    return 1;
  if (run("git", ["-C", repo, "checkout", "-q", "main"]).code !== 0) return 1;
  if (run("git", ["-C", repo, "merge", "-q", "--no-ff", "-m", "Merge branch 7", "7"]).code !== 0)
    return 1;

  writeFileSync(
    join(d, "manifest.json"),
    JSON.stringify({ stage: "dispatched", leg: 1, base, lanes: {}, coachman: { legs: {} } }) + "\n",
  );
  const turnpikes = legs === 1 ? "turnpikes: none" : "turnpikes: style, bug, security";
  writeFileSync(
    join(d, "brief.md"),
    `# Waybill: 7\n${turnpikes}\n\n## Ticket\n\n${ticketBody(t)}\n## Project profile\nrepo: ${repo}\n`,
  );
  run(join(HERE, "run"), [
    "run-meta",
    d,
    repo,
    ...(mode === "single-thread" ? ["--mode", "single-thread"] : []),
  ]);
  const recordedConfig = JSON.parse(readFileSync(join(d, "run.json"), "utf8")).config;
  const workhorses = (recordedConfig.team.workhorses ?? [])
    .map((name: string) => {
      const lane = recordedConfig.lanes[name];
      return `${name}=${lane.harness}/${lane.model}/${lane.effort ?? ""}`;
    })
    .join(", ");
  const coachman = recordedConfig.team.coachman;
  const efforts = run(join(HERE, "run"), ["run-meta", "efforts", d]).out.trim();
  const workhorsesLine = mode === "single-thread" ? "" : `workhorses: ${workhorses}\n`;
  writeFileSync(
    join(d, "brief.md"),
    `${readFileSync(join(d, "brief.md"), "utf8")}\n## Team\nmode: ${mode}\n${workhorsesLine}coachman: ${coachman.harness}/${coachman.model}/${coachman.effort ?? ""}\n${efforts}\n`,
  );
  if (legs === 3) {
    const runJson = JSON.parse(readFileSync(join(d, "run.json"), "utf-8"));
    delete runJson.coachman_contract;
    writeFileSync(join(d, "run.json"), JSON.stringify(runJson, null, 2));
  }
  if (
    run("bash", [
      join(HERE, "run"),
      "log-action",
      d,
      "coachman",
      "premises",
      base,
      `base=${base}`,
      "result=same",
    ]).code !== 0
  )
    return 1;
  for (const lane of recordedConfig.team.workhorses as string[]) {
    if (mode === "single-thread") continue;
    if (
      run("bash", [join(HERE, "run"), "log-action", d, "coachman", "dispatch", lane, "workhorse"])
        .code !== 0
    )
      return 1;
    // The harvested archive branch each workhorse keeps; a synthesis run has one per lane and
    // a single-thread run none.
    if (run("git", ["-C", repo, "branch", `wb/7-${lane}`, "7"]).code !== 0) return 1;
  }

  const stageList = stages.split("\n").filter(Boolean);
  // Leg 1 enters every stage through checkpoint-1; each later leg its own slice of the rest;
  // the postmaster closes. A current run's shipped is the postmaster's; a pre-change ship leg
  // sets its own, as the runbooks have it. A single-thread run never enters
  // workhorses-running, so its walk leaves that stage out.
  const schedule =
    mode === "single-thread" ? stageList.filter((s) => s !== "workhorses-running") : stageList;
  const walked = legs === 1 ? schedule.filter((s) => s !== "review") : schedule;
  const cpIdx = walked.indexOf("checkpoint-1");
  const through1 = cpIdx < 0 ? [...walked] : walked.slice(0, cpIdx + 1);
  const rest = cpIdx < 0 ? [] : walked.slice(cpIdx + 1);
  let slices: string[][];
  let postStages: string[];
  if (legs === 1) {
    slices = [[...through1, ...rest.filter((s) => s !== "shipped")]];
    postStages = ["shipped", "done"];
  } else if (legs === 2) {
    slices = [through1, rest.filter((s) => s !== "shipped")];
    postStages = ["shipped", "done"];
  } else {
    slices = [through1, rest.slice(0, 1), rest.slice(1)];
    postStages = ["done"];
  }
  for (let n = 1; n <= legs; n++) {
    writeFileSync(join(d, `leg-${n}-prompt.txt`), `You are the coachman for leg ${n} of 7.\n`);
    run(join(HERE, "run"), ["log-action", d, "postmaster", "dispatch", "7", `leg ${n}`]);
    run(join(HERE, "run"), ["log-action", d, "coachman", "handoff-accept", `leg-${n}`]);
    for (const s of slices[n - 1] ?? []) {
      run(join(HERE, "run"), ["stage", d, s]);
    }
    const handoffSections = sections.split("\n").filter(Boolean);
    writeFileSync(
      join(d, `handoff-${n}.md`),
      handoffSections.map((sec) => `## ${sec}\nLeg ${n}, recorded.\n\n`).join(""),
    );
    run(join(HERE, "run"), ["log-action", d, "coachman", "handoff", `leg-${n}`]);
    writeFileSync(join(d, `.leg-${n}-done`), "");
    writeFileSync(join(d, `.leg-${n}-exited`), "");
  }
  for (const s of postStages) {
    run(join(HERE, "run"), ["stage", d, s, "postmaster"]);
  }
  writeFileSync(join(d, "card.md"), "# Ship card: 7\n\nBranch 7 is merged into main.\n");
  const manifest = JSON.parse(readFileSync(join(d, "manifest.json"), "utf-8"));
  manifest.leg = legs;
  manifest.coachman.legs = {};
  for (let n = 1; n <= legs; n++) {
    manifest.coachman.legs[String(n)] = { thread_id: `thread-${n}` };
  }
  writeFileSync(join(d, "manifest.json"), JSON.stringify(manifest, null, 2));

  const point = (name: string, lanes: Array<Record<string, string>>): void => {
    const detail = JSON.stringify({ kind: "point", point: name, result: "clean", lanes });
    const logged = run(join(HERE, "run"), ["log-action", d, "coachman", "reach", name, detail]);
    if (logged.code !== 0) throw new Error(`could not make fixture reach record: ${logged.err}`);
  };
  const laneRecords = (names: string[]) =>
    names.map((name: string) => ({
      lane: name,
      lens: "",
      harness: recordedConfig.lanes[name]?.harness ?? "codex",
      status: "checked",
      reason: "",
    }));
  const workhorseNames: string[] = recordedConfig.team.workhorses ?? [];
  // A single-thread run never runs "Check lane reach before synthesis", so its
  // record holds no workhorses point; the builder mirrors real runs here.
  if (mode === "synthesis") point("workhorses", laneRecords(workhorseNames));
  if (legs >= 2) {
    const reviewer = workhorseNames[0] ?? "one";
    writeFileSync(
      join(d, "logs", "review-r1.json"),
      JSON.stringify({ reviewers: [["bug", reviewer]] }),
    );
    point("r1", laneRecords([reviewer]));
  }
  point("card", laneRecords(workhorseNames));
  return 0;
}

function brokenCopy(name: string, cleanDir: string): string {
  const d = join(tmp, name, "repo", ".postmaster", "runs", "7");
  mkdirSync(dirname(d), { recursive: true });
  cpSync(cleanDir, d, { recursive: true });
  return d;
}

function breaks(cleanDir: string, repo: string): void {
  let d = brokenCopy("break-stages", cleanDir);
  const actionsPath = join(d, "actions.jsonl");
  const kept: string[] = [];
  let stageSeen = 0;
  for (const line of readFileSync(actionsPath, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try {
      if (JSON.parse(line).action === "stage") {
        stageSeen++;
        if (stageSeen === 3) continue;
      }
    } catch {
      /* skip */
    }
    kept.push(line);
  }
  writeFileSync(actionsPath, `${kept.join("\n")}\n`);

  d = brokenCopy("break-notime", cleanDir);
  writeFileSync(
    join(d, "actions.jsonl"),
    `${readFileSync(join(cleanDir, "actions.jsonl"), "utf-8")
      .split("\n")
      .filter((line) => {
        if (!line.trim()) return false;
        try {
          return JSON.parse(line).action !== "stage";
        } catch {
          return true;
        }
      })
      .join("\n")}\n`,
  );

  d = brokenCopy("break-markers", cleanDir);
  rmSync(join(d, ".leg-2-done"), { force: true });

  d = brokenCopy("break-handoffs", cleanDir);
  writeFileSync(join(d, "handoff-2.md"), "");

  d = brokenCopy("break-runjson", cleanDir);
  rmSync(join(d, "run.json"), { force: true });

  d = brokenCopy("break-card", cleanDir);
  rmSync(join(d, "card.md"), { force: true });

  d = brokenCopy("break-waybill", cleanDir);
  writeFileSync(
    join(d, "brief.md"),
    readFileSync(join(d, "brief.md"), "utf8").replace(
      /## Ticket\n\n.*?(?=## Project profile)/su,
      "## Ticket\n\nSee the tracker.\n",
    ),
  );

  d = brokenCopy("break-legs", cleanDir);
  writeFileSync(
    join(d, "brief.md"),
    readFileSync(join(d, "brief.md"), "utf-8")
      .split("\n")
      .filter((l) => !l.startsWith("turnpikes: "))
      .join("\n"),
  );

  d = brokenCopy("break-efforts", cleanDir);
  writeFileSync(
    join(d, "brief.md"),
    readFileSync(join(d, "brief.md"), "utf-8").replace(/^efforts:.*$/mu, "efforts: one=wrong"),
  );

  // A synthesis run with its workhorse dispatch lines removed: the mode check fails it (D14).
  d = brokenCopy("break-syn-dispatch", cleanDir);
  const noDispatchPath = join(d, "actions.jsonl");
  const noDispatch = readFileSync(noDispatchPath, "utf-8")
    .split("\n")
    .filter((line) => {
      if (!line.trim()) return false;
      try {
        const e = JSON.parse(line) as Record<string, unknown>;
        return !(e.action === "dispatch" && e.actor === "coachman");
      } catch {
        return true;
      }
    });
  writeFileSync(noDispatchPath, `${noDispatch.join("\n")}\n`);

  // A synthesis run that never entered workhorses-running: the stages check fails it.
  d = brokenCopy("break-syn-stages", cleanDir);
  const noStagePath = join(d, "actions.jsonl");
  const noStage = readFileSync(noStagePath, "utf-8")
    .split("\n")
    .filter((line) => {
      if (!line.trim()) return false;
      try {
        const e = JSON.parse(line) as Record<string, unknown>;
        return !(e.action === "stage" && e.target === "workhorses-running");
      } catch {
        return true;
      }
    });
  writeFileSync(noStagePath, `${noStage.join("\n")}\n`);

  for (const b of [
    "stages",
    "notime",
    "markers",
    "handoffs",
    "runjson",
    "card",
    "waybill",
    "legs",
    "efforts",
    "syn-dispatch",
    "syn-stages",
  ]) {
    background(`break-${b}`, () =>
      score(join(tmp, `break-${b}`, "repo", ".postmaster", "runs", "7"), repo),
    );
  }
}

/** The single-thread run's negatives, scored against its own repo: a workhorse dispatch line,
 * a wb/ branch, or the workhorses-running stage each fail the run that records single-thread.
 * The branch is removed again so later re-scores of the clean record stay clean. */
function singleThreadBreaks(cleanDir: string, repo: string): void {
  const copy = (name: string): string => {
    const d = join(tmp, name, "repo", ".postmaster", "runs", "7");
    mkdirSync(dirname(d), { recursive: true });
    cpSync(cleanDir, d, { recursive: true });
    return d;
  };

  let d = copy("break-st-dispatch");
  const dispatchPath = join(d, "actions.jsonl");
  appendFileSync(
    dispatchPath,
    `${JSON.stringify({
      ts: "2026-01-01T00:00:00Z",
      actor: "coachman",
      action: "dispatch",
      target: "one",
      detail: "workhorse",
    })}\n`,
  );
  background("break-st-dispatch", () => score(d, repo));

  // The branch control copies the repo whole, so the clean record's own refs never change.
  const branchRepo = join(tmp, "break-st-branch", "repo");
  mkdirSync(dirname(branchRepo), { recursive: true });
  cpSync(repo, branchRepo, { recursive: true });
  d = join(branchRepo, ".postmaster", "runs", "7");
  if (run("git", ["-C", branchRepo, "branch", "wb/7-one", "7"]).code !== 0) {
    console.log("could not make wb/7-one for the single-thread branch control");
  }
  background("break-st-branch", () => score(d, branchRepo));

  d = copy("break-st-stages");
  const stagePath = join(d, "actions.jsonl");
  // Insert a workhorses-running stage line after bootstrapped, as a run that entered it logs.
  const rows: string[] = [];
  for (const line of readFileSync(stagePath, "utf-8").split("\n")) {
    if (line.trim()) rows.push(line);
    try {
      const e = JSON.parse(line) as Record<string, unknown>;
      if (e.action === "stage" && e.target === "bootstrapped") {
        rows.push(
          JSON.stringify({
            ts: "2026-01-01T00:00:01Z",
            actor: "coachman",
            action: "stage",
            target: "workhorses-running",
            detail: "from bootstrapped",
          }),
        );
      }
    } catch {
      /* keep */
    }
  }
  writeFileSync(stagePath, `${rows.join("\n")}\n`);
  background("break-st-stages", () => score(d, repo));
}

function recorded(
  name: string,
  t: string,
  shipped: "reference" | "app" | "broken",
  legs = 2,
  mode: "synthesis" | "single-thread" = "synthesis",
): number | { code: number; out: string } {
  const rc = record(name, t, shipped, legs, mode);
  if (rc !== 0) {
    console.log(`the record could not be built for ${name}`);
    return 1;
  }
  if (name === `clean-${first}`) {
    breaks(join(tmp, name, "repo", ".postmaster", "runs", "7"), join(tmp, name, "repo"));
  }
  return score(join(tmp, name, "repo", ".postmaster", "runs", "7"), join(tmp, name, "repo"));
}

function captureOutput<T>(fn: () => T): { value: T; out: string } {
  const origLog = console.log;
  const origErr = console.error;
  let out = "";
  console.log = (...args: unknown[]) => {
    out += `${args.map(String).join(" ")}\n`;
  };
  console.error = (...args: unknown[]) => {
    out += `${args.map(String).join(" ")}\n`;
  };
  try {
    const value = fn();
    return { value, out };
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
}

function freshNew(destDir: string, ticket: string): { code: number; out: string } {
  const origHome = process.env.HOME;
  process.env.HOME = join(tmp, "home");
  try {
    const { value, out } = captureOutput(() => makeAndFile(destDir, ticket));
    return { code: value, out };
  } finally {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
  }
}

function expectScore(key: string, failing: string, failText?: string): void {
  const result = bgResults.get(key);
  const rc = result ? result.code : -1;
  const out = result ? result.out : "";
  const failLines = out
    .split("\n")
    .filter((l) => l.startsWith("FAIL"))
    .map((l) => pyWords(l)[1] ?? "");
  const failingChecks = failLines.join(",") || "none";
  const lines = out.split("\n").filter((l) => l.trim());
  expect(rc).toBe(failing === "none" ? 0 : 2);
  expect(failingChecks).toBe(failing);
  // platform + eleven check lines, then the score's time section (#265); with no
  // run.json the pinned tool is unknown, so the reach check prints no line
  const checks = failing === "run.json" ? 10 : 11;
  expect(lines.filter((l) => l.startsWith("ok  ") || l.startsWith("FAIL"))).toHaveLength(checks);
  expect(lines.length).toBeGreaterThanOrEqual(checks + 2);
  expect(
    lines[0]?.startsWith(
      `platform: ${osType()} ${release()} ${machine()}, bun ${Bun.version}, git `,
    ),
  ).toBe(true);
  expect(
    lines.slice(10).some((l) => l.startsWith("stage ") || l.includes("could not be timed")),
  ).toBe(true);
  if (failText !== undefined) {
    expect(
      out
        .split("\n")
        .filter((l) => l.startsWith("FAIL"))
        .some((l) => l.includes(failText)),
    ).toBe(true);
  }
}

function scorePath(without: readonly string[] = []): string {
  const bin = join(scratch, `path-${Math.random().toString(36).slice(2)}`);
  mkdirSync(bin);
  const names = [
    "awk",
    "bash",
    "bun",
    "cat",
    "cp",
    "date",
    "dirname",
    "env",
    "find",
    "git",
    "grep",
    "head",
    "mkdir",
    "mktemp",
    "node",
    "npm",
    "rm",
    "sed",
    "sh",
    "sort",
    "tar",
    "tail",
    "tr",
    "xargs",
    "jq",
  ];
  for (const name of names) {
    if (without.includes(name)) continue;
    const target = Bun.which(name);
    if (target) symlinkSync(target, join(bin, name));
  }
  return bin;
}

function runScore(
  dispatch: string,
  repo: string,
  env: Record<string, string | undefined> = process.env,
): { code: number; out: string } {
  const r = spawnSync(wrapper, ["fixture", "score", dispatch, repo], { encoding: "utf8", env });
  return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

describe("ticket #202 fixture reach score", () => {
  test("C16 a clean fixture score includes the reach check", () => {
    const dispatch = join(tmp, `clean-${first}`, "repo", ".postmaster", "runs", "7");
    const repo = join(tmp, `clean-${first}`, "repo");
    const result = runScore(dispatch, repo);
    expect(result.code).toBe(0);
    expect(result.out).toContain("ok   reach");
    const scored = result.out.split("\n").filter(Boolean);
    expect(scored.filter((l) => l.startsWith("ok  ") || l.startsWith("FAIL"))).toHaveLength(11);
    expect(
      scored.slice(12).some((l) => l.startsWith("stage ") || l.includes("could not be timed")),
    ).toBe(true);
  }, 120000);

  test("C17 findings, missing points and supported-reader gaps fail fixture score", () => {
    const dispatch = join(tmp, `clean-${first}`, "repo", ".postmaster", "runs", "7");
    const repo = join(tmp, `clean-${first}`, "repo");
    const actionsPath = join(dispatch, "actions.jsonl");
    const originalActions = readFileSync(actionsPath, "utf8");
    try {
      const finding = run("bash", [
        wrapper,
        "log-action",
        dispatch,
        "lane:one",
        "reach",
        "workhorses",
        JSON.stringify({
          kind: "finding",
          point: "workhorses",
          lane: "one",
          access: "write",
          path: "/tmp/out.txt",
        }),
      ]);
      expect(finding.code).toBe(0);
      const found = runScore(dispatch, repo);
      expect(found.code).toBe(2);
      expect(found.out).toContain("FAIL reach");

      const cleanLines = readFileSync(actionsPath, "utf8").split("\n").filter(Boolean);
      writeFileSync(
        actionsPath,
        `${cleanLines
          .filter((line) => {
            const row = JSON.parse(line) as Record<string, unknown>;
            if (row.action !== "reach") return true;
            const event = JSON.parse(String(row.detail)) as Record<string, unknown>;
            return !(event.kind === "finding" && event.point === "workhorses");
          })
          .join("\n")}\n`,
      );
      const withoutRound = readFileSync(actionsPath, "utf8").split("\n").filter(Boolean);
      writeFileSync(
        actionsPath,
        `${withoutRound
          .filter((line) => {
            const row = JSON.parse(line) as Record<string, unknown>;
            if (row.action !== "reach") return true;
            const event = JSON.parse(String(row.detail)) as Record<string, unknown>;
            return !(event.kind === "point" && event.point === "r1");
          })
          .join("\n")}\n`,
      );
      const missing = runScore(dispatch, repo);
      expect(missing.code).toBe(2);
      expect(missing.out).toContain("FAIL reach");
      expect(missing.out).toContain("not checked: r1");

      const laneGap = run("bash", [
        wrapper,
        "log-action",
        dispatch,
        "coachman",
        "reach",
        "r1",
        JSON.stringify({
          kind: "point",
          point: "r1",
          result: "note",
          lanes: [{ lane: "mimo", harness: "mimo", status: "not checked" }],
        }),
      ]);
      expect(laneGap.code).toBe(0);
      const unchecked = runScore(dispatch, repo);
      expect(unchecked.code).toBe(2);
      expect(unchecked.out).toContain("not checked: mimo at r1");
    } finally {
      writeFileSync(actionsPath, originalActions);
    }
  }, 240000);

  function withPostmaster(
    dispatch: string,
    mutate: (postmaster: Record<string, unknown>) => void,
  ): string {
    const runPath = join(dispatch, "run.json");
    const original = readFileSync(runPath, "utf8");
    const run = JSON.parse(original) as Record<string, unknown>;
    mutate(run.postmaster as Record<string, unknown>);
    writeFileSync(runPath, JSON.stringify(run));
    return original;
  }

  test("a run whose pin directory is gone is still scored on reach", () => {
    const dispatch = join(tmp, `clean-${first}`, "repo", ".postmaster", "runs", "7");
    const repo = join(tmp, `clean-${first}`, "repo");
    const head = run("git", ["-C", TOOL, "rev-parse", "HEAD"]).out.trim();
    const runPath = join(dispatch, "run.json");
    const original = withPostmaster(dispatch, (postmaster) => {
      postmaster.checkout = join(tmp, "no-such-pin");
      postmaster.commit = head;
    });
    try {
      const result = runScore(dispatch, repo);
      expect(result.code).toBe(0);
      expect(result.out).toContain("ok   reach");
    } finally {
      writeFileSync(runPath, original);
    }
  }, 120000);

  test("a recorded commit without reach.ts scores no reach item", () => {
    const dispatch = join(tmp, `clean-${first}`, "repo", ".postmaster", "runs", "7");
    const repo = join(tmp, `clean-${first}`, "repo");
    const root = run("git", ["-C", TOOL, "rev-list", "--max-parents=0", "HEAD"])
      .out.trim()
      .split("\n")[0]!;
    const runPath = join(dispatch, "run.json");
    const original = withPostmaster(dispatch, (postmaster) => {
      postmaster.commit = root;
    });
    try {
      const result = runScore(dispatch, repo);
      expect(result.code).toBe(0);
      expect(result.out).not.toContain("reach");
    } finally {
      writeFileSync(runPath, original);
    }
  }, 120000);

  test("a recorded commit git cannot read fails the score", () => {
    const dispatch = join(tmp, `clean-${first}`, "repo", ".postmaster", "runs", "7");
    const repo = join(tmp, `clean-${first}`, "repo");
    const runPath = join(dispatch, "run.json");
    const original = withPostmaster(dispatch, (postmaster) => {
      postmaster.commit = "0".repeat(40);
    });
    try {
      const result = runScore(dispatch, repo);
      expect(result.code).toBe(1);
      expect(result.out).toContain("fixture:");
      expect(result.out).toContain("reach");
    } finally {
      writeFileSync(runPath, original);
    }
  }, 120000);
});

describe("the reach item reads the run's mode", () => {
  const dispatchOf = (name: string): string => join(tmp, name, "repo", ".postmaster", "runs", "7");
  const repoOf = (name: string): string => join(tmp, name, "repo");

  function withoutPoint(d: string, point: string): void {
    const actionsPath = join(d, "actions.jsonl");
    const kept = readFileSync(actionsPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .filter((line) => {
        const row = JSON.parse(line) as Record<string, unknown>;
        if (row.action !== "reach") return true;
        const event = JSON.parse(String(row.detail)) as Record<string, unknown>;
        return !(event.kind === "point" && event.point === point);
      });
    writeFileSync(actionsPath, `${kept.join("\n")}\n`);
  }

  test("a single-thread record with round and card points scores the reach item ok", () => {
    const output = bgResults.get("clean-single")?.out ?? "";
    expect(output).toContain("ok   reach");
  }, 30000);

  test("a synthesis record without the workhorses point still fails the reach item", () => {
    const d = brokenCopy("st-syn-no-workhorses", dispatchOf(`clean-${first}`));
    withoutPoint(d, "workhorses");
    const result = runScore(d, repoOf(`clean-${first}`));
    expect(result.code).toBe(2);
    expect(result.out).toContain("FAIL reach");
    expect(result.out).toContain("not checked: workhorses");
  }, 120000);

  test("a single-thread record without the card point still fails the reach item", () => {
    const d = brokenCopy("st-single-no-card", dispatchOf("clean-single"));
    withoutPoint(d, "card");
    const result = runScore(d, repoOf("clean-single"));
    expect(result.code).toBe(2);
    expect(result.out).toContain("FAIL reach");
    expect(result.out).toContain("not checked: card");
  }, 120000);
});

function captureStderr<T>(fn: () => T): { value: T; errs: string[] } {
  const errs: string[] = [];
  const origErr = console.error;
  console.error = (...a: unknown[]) => {
    errs.push(a.map(String).join(" "));
  };
  try {
    const value = fn();
    return { value, errs };
  } finally {
    console.error = origErr;
  }
}

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "fixture-"));
  for (const k of [
    "POSTMASTER_CONFIG",
    "POSTMASTER_TOOL_PINS",
    "GIT_AUTHOR_NAME",
    "GIT_AUTHOR_EMAIL",
    "GIT_COMMITTER_NAME",
    "GIT_COMMITTER_EMAIL",
    "HOME",
    "LOCAL_SH",
    "POSTMASTER_FIXTURES",
    "POSTMASTER_FIXTURE_APP_CACHE",
  ]) {
    savedEnv[k] = process.env[k];
  }
  const configPath = join(tmp, "config.toml");
  writeFileSync(
    configPath,
    '[lanes.one]\nharness = "bash"\nmodel = "m1"\n' +
      '[lanes.two]\nharness = "bash"\nmodel = "m2"\n' +
      '[team]\nworkhorses = ["one", "two"]\n' +
      'coachman = { harness = "bash", model = "judge" }\n' +
      '[tracker]\nkind = "github"\n',
  );
  process.env.POSTMASTER_CONFIG = configPath;
  process.env.POSTMASTER_TOOL_PINS = join(tmp, "tools");
  process.env.GIT_AUTHOR_NAME = "fixture";
  process.env.GIT_AUTHOR_EMAIL = "fixture@example.invalid";
  process.env.GIT_COMMITTER_NAME = "fixture";
  process.env.GIT_COMMITTER_EMAIL = "fixture@example.invalid";
  // The example app's own checks (hidden tests, lanes, gate) cost about 17 s per score and come out
  // the same for every record of one app, so the records below share them. See appCached.
  process.env.POSTMASTER_FIXTURE_APP_CACHE = join(tmp, "app-cache");

  uni = mkdtempSync(join(tmpdir(), "fixture-uni-"));
  uni2 = mkdtempSync(join(tmpdir(), "fixture-uni2-"));
  uni3 = mkdtempSync(join(tmpdir(), "fixture-uni3-"));
  writeFileSync(join(uni, ".leg-١-done"), "");
  writeFileSync(join(uni2, "x.leg-1-done"), "");

  const emptyMd = join(tmp, "empty.md");
  writeFileSync(emptyMd, "");
  const sectionsR = run(join(HERE, "run"), ["handoff-check", emptyMd]);
  sections = sectionsR.err
    .split("\n")
    .filter((l) => l.startsWith("handoff-check: missing or empty section: "))
    .map((l) => l.replace("handoff-check: missing or empty section: ", ""))
    .join("\n");
  const listedR = run(join(HERE, "run"), ["stage", "--list"]);
  listed = listedR.out.trim();
  const stageLines = listed.split("\n");
  const doneIdx = stageLines.indexOf("done");
  stages = doneIdx > 0 ? stageLines.slice(1, doneIdx).join("\n") : "";

  for (const t of tickets()) {
    background(`clean-${t}`, () => recorded(`clean-${t}`, t, "reference"));
  }
  background("clean-one", () => recorded("clean-one", first, "reference", 1));
  background("clean-three", () => recorded("clean-three", first, "reference", 3));
  for (const kind of ["floor", "short", "long-wait", "no-stages"] as const) {
    const name = `timing-${kind}`;
    timedCopy(name, kind);
    const repo = join(tmp, name, "repo");
    background(name, () => runScore(join(repo, ".postmaster", "runs", "7"), repo));
  }
  const cardRepo = join(tmp, "timing-card", "repo");
  cpSync(join(tmp, "timing-floor", "repo"), cardRepo, {
    recursive: true,
    preserveTimestamps: true,
  });
  const cardDispatch = join(cardRepo, ".postmaster", "runs", "7");
  rmSync(join(cardDispatch, "card.md"), { force: true });
  background("timing-card", () => runScore(cardDispatch, cardRepo));
  const missingMarkerRepo = join(tmp, "timing-missing-marker", "repo");
  cpSync(join(tmp, "timing-floor", "repo"), missingMarkerRepo, {
    recursive: true,
    preserveTimestamps: true,
  });
  const missingMarkerDispatch = join(missingMarkerRepo, ".postmaster", "runs", "7");
  rmSync(join(missingMarkerDispatch, "logs", "one.done"), { force: true });
  background("timing-missing-marker", () => runScore(missingMarkerDispatch, missingMarkerRepo));
  background("break-hidden", () => recorded("break-hidden", first, "app"));
  background("break-gate", () => recorded("break-gate", first, "broken"));
  background("clean-single", () =>
    recorded("clean-single", first, "reference", 2, "single-thread"),
  );
  singleThreadBreaks(
    join(tmp, "clean-single", "repo", ".postmaster", "runs", "7"),
    join(tmp, "clean-single", "repo"),
  );

  for (const t of tickets()) {
    const appDir = join(tmp, `app-${t}`);
    const refDir = join(tmp, `ref-${t}`);
    makeRepo(appDir);
    makeRepo(refDir);
    const applyR = run("git", ["-C", refDir, "apply", join(TICKETS, t, "reference.patch")]);
    hiddenResults[`applied-${t}`] = applyR.code;
    background(`hidden-app-${t}`, () => {
      const h = hidden(t, appDir);
      return h.passed ? 0 : 2;
    });
    background(`hidden-ref-${t}`, () => {
      const h = hidden(t, refDir);
      return h.passed ? 0 : 2;
    });
  }
}, 1800000);

afterAll(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(tmp, { recursive: true, force: true });
  rmSync(uni, { recursive: true, force: true });
  rmSync(uni2, { recursive: true, force: true });
  rmSync(uni3, { recursive: true, force: true });
});

describe("the app result cache", () => {
  /** Run fn with POSTMASTER_FIXTURE_APP_CACHE set to value (undefined removes it), then put it back. */
  function withCache<T>(value: string | undefined, fn: () => T): T {
    const before = process.env.POSTMASTER_FIXTURE_APP_CACHE;
    if (value === undefined) delete process.env.POSTMASTER_FIXTURE_APP_CACHE;
    else process.env.POSTMASTER_FIXTURE_APP_CACHE = value;
    try {
      return fn();
    } finally {
      if (before === undefined) delete process.env.POSTMASTER_FIXTURE_APP_CACHE;
      else process.env.POSTMASTER_FIXTURE_APP_CACHE = before;
    }
  }

  test("a result is computed once per key and read back afterwards", () => {
    const dir = join(tmp, "cache-unit");
    let computed = 0;
    const compute = (): { n: number } => ({ n: ++computed });
    withCache(dir, () => {
      expect(appCached("k1", compute)).toEqual({ n: 1 });
      expect(appCached("k1", compute)).toEqual({ n: 1 });
      expect(computed).toBe(1);
      expect(appCached("k2", compute)).toEqual({ n: 2 });
      expect(readdirSync(dir).filter((f) => f.endsWith(".json"))).toHaveLength(2);
    });
  }, 30000);

  test("with no cache set every call computes, and nothing is written", () => {
    let computed = 0;
    withCache(undefined, () => {
      appCached("k1", () => ++computed);
      appCached("k1", () => ++computed);
    });
    expect(computed).toBe(2);
  }, 30000);

  test("a stored result that cannot be read is computed again, and a directory that cannot be written costs only time", () => {
    const dir = join(tmp, "cache-bad");
    mkdirSync(dir, { recursive: true });
    let computed = 0;
    withCache(dir, () => {
      appCached("k1", () => ++computed);
      for (const f of readdirSync(dir)) writeFileSync(join(dir, f), "{ not json");
      expect(appCached("k1", () => ++computed)).toBe(2);
    });
    const file = join(tmp, "cache-is-a-file");
    writeFileSync(file, "");
    withCache(file, () => {
      expect(appCached("k1", () => 7)).toBe(7);
    });
  }, 30000);

  test("a score reads the same from the cache as from a run of the app's own checks", () => {
    const repo = join(tmp, `clean-${first}`, "repo");
    const dispatch = join(repo, ".postmaster", "runs", "7");
    const shared = score(dispatch, repo);
    const fresh = withCache(undefined, () => score(dispatch, repo));
    expect(fresh.code).toBe(shared.code);
    expect(fresh.out).toBe(shared.out);
    expect(shared.code).toBe(0);
  }, 120000);
});

describe("unicode text edges", () => {
  test("tail splits on CR and CRLF, not just LF", () => {
    expect(tail("a\rb\r\nc")).toBe("a\nb\nc");
  }, 30000);
  test("tail keeps a trailing FEFF (not Python space)", () => {
    expect(tail("x\uFEFF")).toBe("x\uFEFF");
  }, 30000);
  test("tail breaks on U+001C", () => {
    expect(tail("a\x1cb")).toBe("a\nb");
  }, 30000);
  test("squash splits on U+001C", () => {
    expect(squash("a\x1cb")).toBe("a b");
  }, 30000);
  test("squash does not split on FEFF", () => {
    expect(squash("a\uFEFFb")).toBe("a\uFEFFb");
  }, 30000);
  test("sectionOf returns every line to the next heading", () => {
    expect(
      sectionOf("## Acceptance criteria\n- a\n- b\n## Direction\nx\n", "Acceptance criteria"),
    ).toBe("- a\n- b\n");
  }, 30000);
  test("sectionOf runs to the absolute end (keeps the final LF)", () => {
    expect(sectionOf("## A\nbody\n", "A")).toBe("body\n");
  }, 30000);
  test("sectionOf folds dotted-I headings", () => {
    expect(sectionOf("## dırectıon\nX\n", "DIRECTION")).toBe("X\n");
  }, 30000);
  test("sectionOf folds ASCII case", () => {
    expect(sectionOf("## Acceptance Criteria\nQ\n", "acceptance criteria")).toBe("Q\n");
  }, 30000);
  test("hidden counts Arabic-Indic digits", () => {
    const found = [..."٣ pass\n".matchAll(HIDDEN_RE)].map((m) => [m[1], m[2]]);
    expect(found).toEqual([["٣", "pass"]]);
  }, 30000);
  test("legsOf reads an Arabic-Indic leg file", () => {
    expect(legsOf(uni, null)).toEqual([1]);
  }, 30000);
  test("legsOf rejects a partial leg-file name", () => {
    expect(legsOf(uni2, null)).toEqual([]);
  }, 30000);
  test("legsOf reads Arabic-Indic manifest keys", () => {
    expect(legsOf(uni3, { coachman: { legs: { "١٢": 1 } } })).toEqual(
      Array.from({ length: 12 }, (_, i) => i + 1),
    );
  }, 30000);
  test("legsOf throws on an int()-proof key, as int() raises", () => {
    expect(() => legsOf(uni3, { coachman: { legs: { "²": 1 } } })).toThrow();
  }, 30000);
  test("legsOf ignores a float leg", () => {
    expect(legsOf(uni3, { leg: 1.5 })).toEqual([]);
  }, 30000);
});

describe("shell lookups take argv, never pasted strings", () => {
  test("a tool name holding $(...) is looked up literally, and runs nothing", () => {
    const marker = join(tmp, "onpath-marker");
    const found = onPath(`zz-nonexistent-$(touch ${marker})`);
    expect(found).toBe(false);
    expect(existsSync(marker)).toBe(false);
  }, 30000);
  test("a directory holding $(...) lists literally, and runs nothing", () => {
    const marker = join(tmp, "appfiles-marker");
    const listed = appFiles(join(tmp, `nonesuch-$(touch ${marker})`));
    expect(listed).toBeNull();
    expect(existsSync(marker)).toBe(false);
  }, 30000);
});

describe("temporary names are private and never reused", () => {
  test("temporary body files are mode 0600, unique, and hold their own bytes", () => {
    const b1 = makeBodyFile("one");
    const b2 = makeBodyFile("two");
    try {
      expect(statSync(b1).mode & 0o777).toBe(0o600);
      expect(statSync(b2).mode & 0o777).toBe(0o600);
      expect(b1 === b2).toBe(false);
      expect(readFileSync(b1, "utf8")).toBe("one");
      expect(readFileSync(b2, "utf8")).toBe("two");
    } finally {
      rmSync(b1, { force: true });
      rmSync(b2, { force: true });
    }
  }, 30000);
  test("temporary score directories are mode 0700 and never reused", () => {
    const s1 = makeScoreDir();
    const s2 = makeScoreDir();
    try {
      expect(statSync(s1).mode & 0o777).toBe(0o700);
      expect(statSync(s2).mode & 0o777).toBe(0o700);
      expect(s1 === s2).toBe(false);
    } finally {
      rmSync(s1, { recursive: true, force: true });
      rmSync(s2, { recursive: true, force: true });
    }
  }, 30000);
});

const TICKETS_HEAD =
  "the tickets: each hidden suite fails on the app as committed and passes on its reference";

describe(TICKETS_HEAD, () => {
  test("there are at least two tickets", () => {
    expect(tickets().length >= 2).toBe(true);
  }, 30000);
  for (const t of tickets()) {
    test(`${t}: in the ticket shape, by run ticket-check`, () => {
      const body = ticketBody(t);
      writeFileSync(join(tmp, `body-${t}.md`), body);
      const checkR = run(join(HERE, "run"), [
        "ticket-check",
        "--body",
        join(tmp, `body-${t}.md`),
        "--title",
        ticketTitle(t),
      ]);
      expect(checkR.code).toBe(0);
    }, 30000);
    test(`${t}: the reference solution applies to the app`, () => {
      expect(hiddenResults[`applied-${t}`]).toBe(0);
    }, 30000);
    test(`${t}: the hidden suite fails on the app as committed`, () => {
      expect(rcOf(`hidden-app-${t}`)).toBe(2);
    }, 30000);
    test(`${t}: the hidden suite passes on the reference solution`, () => {
      expect(rcOf(`hidden-ref-${t}`)).toBe(0);
    }, 30000);
  }
});

describe("new: a fresh repo outside every other, with its ticket in its own store", () => {
  test("new makes the repo and prints the ticket's number", () => {
    dest = join(tmp, "runs", `fixture-${first}`);
    const r = freshNew(dest, first);
    expect(r.code).toBe(0);
    expect(r.out.includes("own ticket store as #1:")).toBe(true);
  }, 30000);
  test("one commit on main, and a clean tree", () => {
    const count = run("git", ["-C", dest, "rev-list", "--count", "main"]).out.trim();
    const status = run("git", ["-C", dest, "status", "--porcelain"]).out.trim();
    expect(count).toBe("1");
    expect(status).toBe("");
  }, 30000);
  test("it holds the app's files as git sees them, symlink included, and nothing else", () => {
    // Under the same HOME the fresh repo was made with: global git ignores
    // shape --exclude-standard, and the runner's own would list differently.
    const listed2 = run(
      "bash",
      ["-c", `git -C "${APP}" ls-files --cached --others --exclude-standard`],
      { env: { HOME: join(tmp, "home") } },
    )
      .out.trim()
      .split("\n")
      .sort();
    let same = true;
    for (const f of listed2) {
      if (!f) continue;
      const appF = join(APP, f);
      const destF = join(dest, f);
      if (lstatSync(appF).isSymbolicLink()) {
        if (readlinkSync(appF) !== (existsSync(destF) ? readlinkSync(destF) : "")) same = false;
      } else {
        const cmp = run("cmp", ["-s", appF, destF]);
        if (cmp.code !== 0) same = false;
      }
    }
    // Byte order, like the JS sort below: the stock BSD sort follows the
    // locale (case-insensitive on the runner) and would list CLAUDE.md and
    // README.md among the lowercase names.
    const heldFiles = run("bash", [
      "-c",
      `cd "${dest}" && find . -path ./.git -prune -o \\( -type f -o -type l \\) -print | ` +
        `sed 's|^\\./||' | LC_ALL=C sort`,
    ]).out.trim();
    const isSymlink =
      existsSync(join(dest, "CLAUDE.md")) && lstatSync(join(dest, "CLAUDE.md")).isSymbolicLink();
    expect(same).toBe(true);
    expect(heldFiles).toBe([...listed2.filter(Boolean), ".postmaster/fixture"].sort().join("\n"));
    expect(readFileSync(join(dest, ".postmaster", "fixture"), "utf8")).toBe(FIXTURE_MARKER);
    expect(run("git", ["-C", dest, "show", "HEAD:.postmaster/fixture"]).out).toBe(FIXTURE_MARKER);
    expect(isSymlink).toBe(true);
  }, 30000);
  test("it commits as this checkout does", () => {
    const destEmail = run("git", ["-C", dest, "config", "--local", "user.email"]).out.trim();
    const toolEmail = run("git", ["-C", TOOL, "config", "user.email"]).out.trim();
    const destName = run("git", ["-C", dest, "config", "--local", "user.name"]).out.trim();
    const toolName = run("git", ["-C", TOOL, "config", "user.name"]).out.trim();
    expect(destEmail).toBe(toolEmail);
    expect(destName).toBe(toolName);
  }, 30000);
  test("it has no remote", () => {
    expect(run("git", ["-C", dest, "remote"]).out.trim()).toBe("");
  }, 30000);
  test("its own store holds the fixture ticket, title and body verbatim, in todo", () => {
    const localSh = join(HERE, "run");
    const listR = run(localSh, ["local", dest, "list"]);
    const readR = run(localSh, ["local", dest, "read", "1", "--body"]);
    const base = run("git", ["-C", dest, "rev-parse", "HEAD"]).out.trim();
    expect(listR.out.trim()).toBe(`#1\ttodo\t${ticketTitle(first)}\tready`);
    expect(readR.out).toBe(ticketBody(first).replaceAll("FIXTURE_BASE", base));
  }, 30000);
  test("a run against it reads the local tracker, though the config names github", () => {
    const trackerKind = run(join(HERE, "run"), ["tracker-kind", dest]);
    expect(trackerKind.out.trim()).toBe("local");
  }, 30000);
  test("no hidden test and no reference solution reached it", () => {
    let leaked = false;
    for (const t of tickets()) {
      const hiddenDir = join(TICKETS, t, "hidden");
      try {
        for (const f of readdirSync(hiddenDir)) {
          if (
            run("bash", [
              "-c",
              `find "${dest}" -path "${dest}/.git" -prune -o -name "${f}" -print`,
            ]).out.trim()
          )
            leaked = true;
        }
      } catch {
        /* empty */
      }
      const refName = "reference.patch";
      if (
        run("bash", [
          "-c",
          `find "${dest}" -path "${dest}/.git" -prune -o -name "${refName}" -print`,
        ]).out.trim()
      )
        leaked = true;
    }
    expect(leaked).toBe(false);
  }, 30000);
  test("a dest that exists is refused, and left alone", () => {
    const r = freshNew(dest, first);
    const count = run("git", ["-C", dest, "rev-list", "--count", "main"]).out.trim();
    expect(r.code).toBe(1);
    expect(count).toBe("1");
  }, 30000);
  test("a dest inside a git repo is refused", () => {
    const nestedDest = join(tmp, `app-${first}`, "nested");
    const r = freshNew(nestedDest, first);
    expect(r.code).toBe(1);
    expect(existsSync(nestedDest)).toBe(false);
  }, 30000);
  test("same-basename projects keep separate project-local ledgers", () => {
    const sameA = join(tmp, "one", "widgets");
    const sameB = join(tmp, "two", "widgets");
    mkdirSync(join(sameA, ".postmaster", "runs", "T-1"), { recursive: true });
    mkdirSync(join(sameB, ".postmaster", "runs", "T-1"), { recursive: true });
    const aRc = run(join(HERE, "run"), [
      "log-action",
      join(sameA, ".postmaster", "runs", "T-1"),
      "postmaster",
      "note",
      "same-a",
      "one",
    ]).code;
    const bRc = run(join(HERE, "run"), [
      "log-action",
      join(sameB, ".postmaster", "runs", "T-1"),
      "postmaster",
      "note",
      "same-b",
      "two",
    ]).code;
    const ledA = join(sameA, ".postmaster", "runs", "ledger.jsonl");
    const ledB = join(sameB, ".postmaster", "runs", "ledger.jsonl");
    let ledgersDiffer = false;
    try {
      ledgersDiffer = readFileSync(ledA, "utf8") !== readFileSync(ledB, "utf8");
    } catch {
      ledgersDiffer = false;
    }
    expect(aRc).toBe(0);
    expect(bRc).toBe(0);
    expect(existsSync(ledA)).toBe(true);
    expect(existsSync(ledB)).toBe(true);
    expect(ledgersDiffer).toBe(true);
  }, 30000);
  test("an unknown ticket is refused", () => {
    const nosuchDest = join(tmp, "runs", "nosuch");
    const r = freshNew(nosuchDest, "no-such-ticket");
    expect(r.code).toBe(1);
    expect(existsSync(nosuchDest)).toBe(false);
  }, 30000);
  test("a ticket that cannot be filed: refused, and the repo it made is gone", () => {
    const failingLocal = join(tmp, "failing-local.sh");
    writeFileSync(
      failingLocal,
      "#!/usr/bin/env bash\n" +
        "# Stands in for scripts/local.sh: makes the store, and fails to file the ticket.\n" +
        `case $2 in store) exec "${join(HERE, "run")}" local "$@" ;; *) exit 1 ;; esac\n`,
    );
    run("chmod", ["+x", failingLocal]);
    const origLocal = process.env.LOCAL_SH;
    process.env.LOCAL_SH = failingLocal;
    const unfiledDest = join(tmp, "runs", "unfiled");
    let r: { code: number; out: string };
    try {
      r = freshNew(unfiledDest, first);
    } finally {
      if (origLocal === undefined) delete process.env.LOCAL_SH;
      else process.env.LOCAL_SH = origLocal;
    }
    expect(r.code).toBe(1);
    expect(existsSync(unfiledDest)).toBe(false);
    expect(r.out.includes("filing the ticket")).toBe(true);
  }, 30000);
  test("a bare name goes under ~/Code/fixtures, not the working directory", () => {
    const origPf = process.env.POSTMASTER_FIXTURES;
    const origHome = process.env.HOME;
    process.env.POSTMASTER_FIXTURES = "";
    process.env.HOME = join(tmp, "home");
    let bareCode: number;
    try {
      bareCode = captureOutput(() => makeAndFile("bare-name", first)).value;
    } finally {
      if (origPf === undefined) delete process.env.POSTMASTER_FIXTURES;
      else process.env.POSTMASTER_FIXTURES = origPf;
      if (origHome === undefined) delete process.env.HOME;
      else process.env.HOME = origHome;
    }
    expect(bareCode).toBe(0);
    expect(existsSync(join(tmp, "home", "Code", "fixtures", "bare-name", ".git"))).toBe(true);
  }, 30000);
  test("POSTMASTER_FIXTURES moves where a bare name goes", () => {
    const origPf = process.env.POSTMASTER_FIXTURES;
    const origHome = process.env.HOME;
    process.env.POSTMASTER_FIXTURES = join(tmp, "elsewhere");
    process.env.HOME = join(tmp, "home");
    let otherCode: number;
    try {
      otherCode = captureOutput(() => makeAndFile("other-name", first)).value;
    } finally {
      if (origPf === undefined) delete process.env.POSTMASTER_FIXTURES;
      else process.env.POSTMASTER_FIXTURES = origPf;
      if (origHome === undefined) delete process.env.HOME;
      else process.env.HOME = origHome;
    }
    expect(otherCode).toBe(0);
    expect(existsSync(join(tmp, "elsewhere", "other-name", ".git"))).toBe(true);
    expect(existsSync(join(tmp, "home", "Code", "fixtures", "other-name"))).toBe(false);
  }, 30000);
});

describe("score: a recorded run that meets every check scores clean", () => {
  test("the hand-off sections and the stages are read from the scripts that define them", () => {
    expect(sections.length > 0).toBe(true);
    expect(stages.length > 0).toBe(true);
    expect(listed.split("\n").includes("done")).toBe(true);
  }, 30000);
  for (const t of tickets()) {
    test(`a clean run on ${t}: every check passes`, () => {
      expectScore(`clean-${t}`, "none");
    }, 30000);
  }
  test("a one-leg run scores clean", () => {
    expectScore("clean-one", "none");
  }, 30000);
  test("a three-leg run dispatched before this change scores clean", () => {
    expectScore("clean-three", "none");
  }, 30000);
  test("a single-thread run scores clean and its hidden suite reports no lane", () => {
    expectScore("clean-single", "none");
    const output = bgResults.get("clean-single")?.out ?? "";
    const hidden = output.split("\n").find((line) => line.includes("hidden-tests")) ?? "";
    expect(hidden).toContain("on main");
    expect(hidden).not.toContain("; one:");
    expect(hidden).not.toContain("; two:");
  }, 30000);

  test("fixture score passes without jq on PATH and still requires npm", () => {
    const repo = join(tmp, `clean-${first}`, "repo");
    const dispatch = join(repo, ".postmaster", "runs", "7");
    const path = scorePath(["jq"]);
    expect(run("bash", ["-c", "command -v jq"], { env: { PATH: path } }).code).toBe(1);
    // This test is about what the example app's checks need from PATH, so they must really run.
    const uncached = (extra: Record<string, string>): Record<string, string | undefined> => ({
      ...process.env,
      POSTMASTER_FIXTURE_APP_CACHE: undefined,
      ...extra,
    });
    const clean = runScore(dispatch, repo, uncached({ PATH: path }));
    expect(clean.code).toBe(0);
    const lines = clean.out.trim().split("\n");
    expect(lines.slice(1, 12).every((line) => line.startsWith("ok  "))).toBe(true);
    expect(lines[12]?.startsWith("stage ")).toBe(true);
    expect(lines.length).toBeGreaterThan(12);
    console.log(`score without jq:\n${clean.out.trimEnd()}`);

    const withoutNpm = scorePath(["jq", "npm"]);
    const missing = runScore(dispatch, repo, uncached({ PATH: withoutNpm }));
    expect(missing.code).toBe(1);
    expect(missing.out).toContain("fixture: npm is not on PATH");

    const withoutNode = scorePath(["jq", "node"]);
    const missingNode = runScore(dispatch, repo, uncached({ PATH: withoutNode }));
    expect(missingNode.code).toBe(1);
    expect(missingNode.out).toContain("fixture: node is not on PATH");
  }, 120000);

  test("score's platform line names the OS, release, architecture and tool versions", () => {
    const result = bgResults.get(`clean-${first}`);
    const git = gitVersionNumber(run("git", ["--version"]).out);
    expect(result?.out.split("\n", 1)[0]).toBe(
      `platform: ${osType()} ${release()} ${machine()}, bun ${Bun.version}, git ${git}`,
    );
  });

  test("the platform line's git number drops a vendor suffix", () => {
    expect(gitVersionNumber("git version 2.43.0")).toBe("2.43.0");
    expect(gitVersionNumber("git version 2.40.1 (Apple Git-123)")).toBe("2.40.1");
  });

  test("a failing record keeps the platform line first", () => {
    const out = bgResults.get("break-gate")?.out ?? "";
    const cleanOut = bgResults.get(`clean-${first}`)?.out ?? "";
    expect(out.split("\n", 1)[0]).toBe(cleanOut.split("\n", 1)[0]);
    expect(
      out.split("\n").filter((l) => l.startsWith("ok  ") || l.startsWith("FAIL")),
    ).toHaveLength(11);
    console.log(`failing score:\n${out.trimEnd()}`);
  });

  test("score's platform line excludes home, user and host environment values", () => {
    const repo = join(tmp, `clean-${first}`, "repo");
    const dispatch = join(repo, ".postmaster", "runs", "7");
    const home = join(scratch, "probe-home");
    mkdirSync(home);
    const probes = [
      home,
      "postmaster-probe-user-0620",
      "postmaster-probe-logname-0620",
      "postmaster-probe-host-0620",
    ];
    const result = runScore(dispatch, repo, {
      ...process.env,
      HOME: home,
      USER: probes[1],
      LOGNAME: probes[2],
      HOSTNAME: probes[3],
    });
    expect(result.code).toBe(0);
    for (const probe of probes) expect(result.out).not.toContain(probe);
    expect(result.out.split("\n", 1)[0]).toBe(
      bgResults.get(`clean-${first}`)?.out.split("\n", 1)[0],
    );
  }, 120000);
});

describe("score: timing on whole copied runs with ticket-figure timelines (#265)", () => {
  const result = (name: string): { code: number; out: string } => bgResults.get(name)!;
  const dispatchFor = (name: string): string => join(tmp, name, "repo", ".postmaster", "runs", "7");

  test("the over-hour clean copy prints the run-times table, lane times and round times", () => {
    const scored = result("timing-floor");
    const dispatch = dispatchFor("timing-floor");
    const repo = join(tmp, "timing-floor", "repo");
    const direct = run(join(HERE, "run"), ["run-times", dispatch]);
    expect(scored.code).toBe(0);
    expect(scored.out).toContain(direct.out.trimEnd());
    expect(scored.out).toContain("total                                            1h 06m");
    expect(scored.out).toContain("workhorses: one 10m 00s, two 4m 00s");
    expect(scored.out).toContain("review round 1: mimo bug 15m 00s, codex bug 3m 00s");
    expect(scored.out).toContain("the run took longer than an hour: 1h 06m");
    expect(scored.out).not.toContain("long wait:");
    console.log(
      `$ scripts/run fixture score ${dispatch} ${repo}\n${scored.out.trimEnd()}\nexit: ${scored.code}`,
    );
    console.log(
      `$ scripts/run run-times ${dispatch}\n${direct.out.trimEnd()}\nexit: ${direct.code}`,
    );
  }, 30000);

  test("the short copy has no over-hour line", () => {
    const scored = result("timing-short");
    expect(scored.code).toBe(0);
    expect(scored.out).toContain("total                                            57m 21s");
    expect(scored.out).not.toContain("longer than an hour");
    console.log(
      `$ scripts/run fixture score ${dispatchFor("timing-short")} ${join(tmp, "timing-short", "repo")}\n${scored.out.trimEnd()}\nexit: ${scored.code}`,
    );
  }, 30000);

  test("long waits are named and an efforts failure stays the only failure", () => {
    const scored = result("timing-long-wait");
    const failures = scored.out.split("\n").filter((line) => line.startsWith("FAIL"));
    expect(scored.code).toBe(2);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("efforts");
    expect(scored.out).toContain("checkpoint-1 19m 31s, shipping 13m 05s");
    console.log(
      `$ scripts/run fixture score ${dispatchFor("timing-long-wait")} ${join(tmp, "timing-long-wait", "repo")}\n${scored.out.trimEnd()}\nexit: ${scored.code}`,
    );
  }, 30000);

  test("a missing card still fails while the over-hour line remains", () => {
    const scored = result("timing-card");
    expect(scored.code).toBe(2);
    expect(scored.out).toContain("FAIL ship-card");
    expect(scored.out).toContain("the run took longer than an hour: 1h 06m");
    console.log(
      `$ scripts/run fixture score ${dispatchFor("timing-card")} ${join(tmp, "timing-card", "repo")}\n${scored.out.trimEnd()}\nexit: ${scored.code}`,
    );
  }, 30000);

  test("without stage lines the score says it could not time the run and keeps its check verdict", () => {
    const scored = result("timing-no-stages");
    expect(scored.code).toBe(2);
    expect(scored.out).toContain("the run could not be timed");
    expect(scored.out).toContain("FAIL stages");
    expect(scored.out).not.toContain("longer than an hour");
    console.log(
      `$ scripts/run fixture score ${dispatchFor("timing-no-stages")} ${join(tmp, "timing-no-stages", "repo")}\n${scored.out.trimEnd()}\nexit: ${scored.code}`,
    );
  }, 30000);

  test("a workhorse with no marker is named and receives no inferred duration", () => {
    const scored = result("timing-missing-marker");
    expect(scored.code).toBe(0);
    expect(scored.out).toContain("workhorses: two 4m 00s, one no marker");
  }, 30000);

  test("a one-leg run has no review-round timing line", () => {
    const scored = bgResults.get("clean-one")!;
    // The timing line is `review round N:`; the reach summary shares the words.
    expect(scored.out).not.toContain("review round ");
  }, 30000);
});

describe("score: premises are checked before workhorse dispatch", () => {
  function recordOrder(name: string, rows: Array<Record<string, string>>): string {
    const dispatch = join(tmp, `premises-${name}`);
    mkdirSync(dispatch, { recursive: true });
    writeFileSync(
      join(dispatch, "run.json"),
      JSON.stringify({ config: { team: { workhorses: ["one", "two"] } } }),
    );
    writeFileSync(
      join(dispatch, "actions.jsonl"),
      `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
    );
    return dispatch;
  }

  const premise = { actor: "coachman", action: "premises", target: "base", detail: "result=same" };
  const laneDispatch = {
    actor: "coachman",
    action: "dispatch",
    target: "one",
    detail: "workhorse",
  };

  test("a premises action before the first workhorse dispatch passes", () => {
    expect(checkPremisesOrder(recordOrder("before", [premise, laneDispatch])).ok).toBe(true);
  });

  test("a workhorse dispatch before the premises action fails", () => {
    const result = checkPremisesOrder(recordOrder("after", [laneDispatch, premise]));
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("precedes");
  });

  test("a missing premises action fails", () => {
    const result = checkPremisesOrder(recordOrder("missing", [laneDispatch]));
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("no coachman premises action");
  });

  test("premises with no workhorse dispatch passes", () => {
    const result = checkPremisesOrder(recordOrder("stopped", [premise]));
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("no workhorse dispatched");
  });
});

describe("score: the run kept its mode (D14)", () => {
  const dispatchOf = (name: string): string => join(tmp, name, "repo", ".postmaster", "runs", "7");
  const repoOf = (name: string): string => join(tmp, name, "repo");

  test("a single-thread run with a workhorse dispatch line fails the mode check", () => {
    expectScore("break-st-dispatch", "mode", "workhorse dispatch");
  }, 30000);
  test("a single-thread run with a wb/ branch fails the mode check", () => {
    expectScore("break-st-branch", "mode", "workhorse branches");
  }, 30000);
  test("a synthesis run with its workhorse dispatch lines removed fails the mode check", () => {
    expectScore("break-syn-dispatch", "mode", "never dispatched");
  }, 30000);
  test("a single-thread run that entered workhorses-running fails the stages check", () => {
    expectScore("break-st-stages", "stages", "workhorses-running");
  }, 30000);
  test("a synthesis run that never entered workhorses-running fails the stages check", () => {
    expectScore("break-syn-stages", "stages", "workhorses-running");
  }, 30000);
  test("the recorded mode reads the schedule: single-thread skips workhorses-running", () => {
    expect(runMode(dispatchOf("clean-single"))).toBe("single-thread");
    expect(runMode(dispatchOf(`clean-${first}`))).toBe("synthesis");
  });
  test("a record with no mode reads as synthesis and keeps its lanes", () => {
    const d = brokenCopy("no-mode", dispatchOf(`clean-${first}`));
    const path = join(d, "run.json");
    const rec = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
    delete rec.mode;
    delete rec.mode_source;
    delete rec.mode_setting;
    writeFileSync(path, JSON.stringify(rec));
    expect(runMode(d)).toBe("synthesis");
    const result = checkMode(d, repoOf(`clean-${first}`));
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("dispatched and branched");
  });
  test("a record naming an unknown mode fails the mode check", () => {
    const d = brokenCopy("bad-mode", dispatchOf(`clean-${first}`));
    const path = join(d, "run.json");
    const rec = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
    rec.mode = "two-lanes";
    writeFileSync(path, JSON.stringify(rec));
    const result = checkMode(d, repoOf(`clean-${first}`));
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("two-lanes");
  });
  test("a single-thread dispatch with nothing pulled passes the mode check", () => {
    const result = checkMode(dispatchOf("clean-single"), repoOf("clean-single"));
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("no workhorse dispatch");
  });
  test("a dispatch without run.json skips the mode check", () => {
    const d = join(tmp, "no-record", "repo", ".postmaster", "runs", "7");
    mkdirSync(d, { recursive: true });
    const result = checkMode(d, repoOf(`clean-${first}`));
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("skipped");
  });
  test("the waybill fallback reads lanes from the Team section, ignoring a quoted line", () => {
    const d = brokenCopy("fallback-team", dispatchOf(`clean-${first}`));
    const path = join(d, "run.json");
    const rec = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
    const team = (rec.config as Record<string, unknown>).team as Record<string, unknown>;
    delete team.workhorses;
    writeFileSync(path, JSON.stringify(rec));
    const briefPath = join(d, "brief.md");
    const brief = readFileSync(briefPath, "utf-8");
    writeFileSync(briefPath, brief.replace("\n", "\nworkhorses: phantom=h/x\n"));
    const result = checkMode(d, repoOf(`clean-${first}`));
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("dispatched and branched");
  });
});

describe("score: a record's stages are entered by the legs the contract names", () => {
  const actionsOf = (name: string): string =>
    readFileSync(join(tmp, name, "repo", ".postmaster", "runs", "7", "actions.jsonl"), "utf-8");

  test("a one-leg record's shipped is the postmaster's", () => {
    expect(
      actionsOf("clean-one").includes('"actor":"postmaster","action":"stage","target":"shipped"'),
    ).toBe(true);
  }, 30000);
  test("a two-leg record's shipped is the postmaster's", () => {
    expect(
      actionsOf(`clean-${first}`).includes(
        '"actor":"postmaster","action":"stage","target":"shipped"',
      ),
    ).toBe(true);
  }, 30000);
  test("a pre-change record's shipped is its ship leg's", () => {
    expect(
      actionsOf("clean-three").includes('"actor":"coachman","action":"stage","target":"shipped"'),
    ).toBe(true);
  }, 30000);
  test("checkpoint-1 lands before leg 2 starts", () => {
    const lines = actionsOf(`clean-${first}`).split("\n");
    const c1 = lines.findIndex((l) => l.includes('"action":"stage","target":"checkpoint-1"'));
    const d2 = lines.findIndex((l) =>
      l.includes('"action":"dispatch","target":"7","detail":"leg 2"'),
    );
    expect(c1 >= 0 && d2 >= 0 && c1 < d2).toBe(true);
  }, 30000);
});

const APP_SHIPPED =
  "the app shipped as committed: hidden-tests alone fails, " + "and the app's own gate passes";

describe("score: negative controls, the same record with one check broken at a time", () => {
  test(APP_SHIPPED, () => {
    expectScore("break-hidden", "hidden-tests", "fail on main");
  }, 30000);
  test("the waybill does not carry the ticket: hidden-tests alone fails", () => {
    expectScore("break-waybill", "hidden-tests", "carries no fixture ticket");
  }, 30000);
  test("a type error shipped: gate alone fails", () => {
    expectScore("break-gate", "gate", "npm run check on main from a clean checkout: exit");
  }, 30000);
  test("a stage change never logged: stages alone fails", () => {
    expectScore("break-stages", "stages", ", not ");
  }, 30000);
  test("no stage lines at all: stages alone fails, and the score could not time the run", () => {
    expectScore("break-notime", "stages");
    expect(bgResults.get("break-notime")?.out ?? "").toContain("could not be timed");
  }, 30000);
  test("a leg's done marker missing: markers alone fails", () => {
    expectScore("break-markers", "markers", ".leg-2-done");
  }, 30000);
  test("a hand-off with no sections: handoffs alone fails", () => {
    expectScore("break-handoffs", "handoffs", "handoff-2.md");
  }, 30000);
  test("no run.json: run.json alone fails", () => {
    expectScore("break-runjson", "run.json", "no run.json");
  }, 30000);
  test("no ship card: ship-card alone fails", () => {
    expectScore("break-card", "ship-card", "no card.md");
  }, 30000);
  test("a waybill with no turnpikes line: stages alone fails", () => {
    expectScore("break-legs", "stages", "run turnpikes legs");
  }, 30000);
  test("a waybill with mismatched efforts: efforts alone fails", () => {
    expectScore("break-efforts", "efforts", "efforts:");
  }, 30000);
});

describe("score: the time lines after the checks (#265)", () => {
  const T0 = Date.UTC(2026, 0, 5, 10, 0, 0);
  const at = (sec: number): string => `${new Date(T0 + sec * 1000).toISOString().slice(0, 19)}Z`;

  const act = (
    sec: number,
    actor: string,
    action: string,
    target: string,
    detail = "",
  ): Record<string, unknown> => ({ ts: at(sec), actor, action, target, detail });

  function plant(
    name: string,
    events: Array<Record<string, unknown>>,
    markers: Array<[string, number]> = [],
    files: Record<string, string> = {},
  ): string {
    const d = join(scratch, `time-${name}`);
    mkdirSync(join(d, "logs"), { recursive: true });
    writeFileSync(
      join(d, "actions.jsonl"),
      `${events.map((e) => JSON.stringify({ project: "p", run: "1", ...e })).join("\n")}\n`,
    );
    for (const [rel, content] of Object.entries(files)) {
      writeFileSync(join(d, rel), content);
    }
    for (const [rel, sec] of markers) {
      const p = join(d, rel);
      writeFileSync(p, "");
      const when = new Date(T0 + sec * 1000);
      utimesSync(p, when, when);
    }
    return d;
  }

  /** 12m 20s total; checkpoint-1 waits 11m 00s across a leg gap. */
  function waitRun(): string {
    return plant(
      "wait",
      [
        act(0, "postmaster", "dispatch", "7"),
        act(1, "coachman", "dispatch", "slow", "thread-slow"),
        act(2, "coachman", "dispatch", "fast", "thread-fast"),
        act(3, "coachman", "dispatch", "ghost", "thread-ghost"),
        act(5, "coachman", "handoff-accept", "leg-1"),
        act(10, "coachman", "stage", "bootstrapped"),
        act(20, "coachman", "stage", "checkpoint-1"),
        act(30, "coachman", "handoff", "leg-1"),
        act(70, "coachman", "review-launch", "fast", "bug round 1"),
        act(72, "coachman", "review-launch", "slow", "bug round 1"),
        act(690, "coachman", "handoff-accept", "leg-2"),
        act(700, "coachman", "stage", "review"),
        act(710, "coachman", "handoff", "leg-2"),
        act(720, "coachman", "stage", "shipping"),
        act(730, "coachman", "stage", "shipped"),
        act(740, "coachman", "stage", "done"),
      ],
      [
        ["logs/slow.done", 60],
        ["logs/fast.done", 15],
        ["logs/review-r1-bug-fast.done", 170],
        ["logs/review-r1-bug-slow.done", 102],
      ],
      {
        "logs/review-r1.json": `${JSON.stringify({
          started: at(66),
          reviewers: [
            ["bug", "fast"],
            ["bug", "slow"],
          ],
        })}\n`,
      },
    );
  }

  /** 1h 00m total; no wait over a minute; no review leg, no markers. */
  function hourRun(): string {
    return plant("hour", [
      act(0, "postmaster", "dispatch", "7"),
      act(5, "coachman", "handoff-accept", "leg-1"),
      act(10, "coachman", "stage", "bootstrapped"),
      act(20, "coachman", "stage", "workhorses-running"),
      act(30, "coachman", "handoff", "leg-1"),
      act(40, "coachman", "handoff-accept", "leg-2"),
      act(50, "coachman", "stage", "synthesis"),
      act(60, "coachman", "stage", "review"),
      act(3600, "coachman", "handoff", "leg-2"),
      act(3610, "coachman", "stage", "shipping"),
      act(3620, "coachman", "stage", "shipped"),
      act(3630, "coachman", "stage", "done"),
    ]);
  }

  test("the stage table follows the checks with each stage's waiting and the total", () => {
    const out = timeReport(waitRun());
    // ASCII: time lines are machine-printed.
    expect(out).toMatch(/^stage\s+started \(UTC\)/mu);
    expect(out).toContain("11m 20s");
    // ASCII: time lines are machine-printed.
    expect(out).toMatch(/^total\s+12m 20s/mu);
  }, 30000);

  test("a wait over ten minutes names the stage, and no hour is claimed", () => {
    const out = timeReport(waitRun());
    expect(out).toContain("long wait: checkpoint-1 11m 00s");
    expect(out).not.toContain("longer than an hour");
  }, 30000);

  test("a total over an hour is named, and no short wait is", () => {
    const out = timeReport(hourRun());
    expect(out).toContain("the run took longer than an hour: 1h 00m");
    expect(out).not.toContain("long wait:");
  }, 30000);

  test("workhorses read slowest first, and the lane with no marker is named as such", () => {
    expect(timeReport(waitRun())).toContain("workhorses: slow 59s, fast 13s, ghost no marker");
  }, 30000);

  test("a reviewer is named with its lens, slowest first", () => {
    expect(timeReport(waitRun())).toContain("review round 1: fast bug 1m 40s, slow bug 30s");
  }, 30000);

  test("a run with no review round files says nothing about rounds", () => {
    expect(timeReport(hourRun())).not.toContain("review round");
  }, 30000);

  test("a log with no stage lines could not be timed, and prints no table", () => {
    const d = plant("notiming", [
      act(0, "postmaster", "dispatch", "7"),
      act(5, "coachman", "dispatch", "slow", "thread-slow"),
      act(10, "coachman", "note", "x"),
    ]);
    const out = timeReport(d);
    expect(out).toContain("the run could not be timed");
    expect(out).not.toContain("started (UTC)");
    expect(out).toContain("workhorses: slow no marker");
  }, 30000);

  test("a wait of exactly ten minutes stays silent while 601 seconds is named", () => {
    const d = plant("boundary-wait", [
      act(0, "postmaster", "dispatch", "7"),
      act(5, "coachman", "handoff-accept", "leg-1"),
      act(10, "coachman", "stage", "bootstrapped"),
      act(20, "coachman", "stage", "checkpoint-1"),
      act(30, "coachman", "handoff", "leg-1"),
      act(630, "coachman", "handoff-accept", "leg-2"),
      act(640, "coachman", "stage", "shipping"),
      act(650, "coachman", "handoff", "leg-2"),
      act(1251, "coachman", "stage", "shipped"),
      act(1261, "coachman", "stage", "done"),
    ]);
    const out = timeReport(d);
    const lines = out.split("\n").filter((l) => l.startsWith("long wait:"));
    expect(lines).toEqual(["long wait: shipping 10m 01s"]);
  }, 30000);

  test("a total of exactly an hour stays silent", () => {
    const d = plant("boundary-hour", [
      act(0, "postmaster", "dispatch", "7"),
      act(5, "coachman", "handoff-accept", "leg-1"),
      act(10, "coachman", "stage", "bootstrapped"),
      act(20, "coachman", "stage", "shipping"),
      act(30, "coachman", "stage", "shipped"),
      act(3600, "coachman", "stage", "done"),
    ]);
    const out = timeReport(d);
    expect(out).toContain("1h 00m");
    expect(out).not.toContain("longer than an hour");
  }, 30000);
});

describe("score: waybill effort controls", () => {
  test("the score command accepts the recorded efforts line and Team entries", () => {
    const repo = join(tmp, `clean-${first}`, "repo");
    const dispatch = join(repo, ".postmaster", "runs", "7");
    const result = runScore(dispatch, repo);
    expect(result.code).toBe(0);
    expect(result.out).toContain("ok   efforts");
  }, 30000);

  test("the same score command rejects a changed Team effort", () => {
    const repo = join(tmp, `clean-${first}`, "repo");
    const dispatch = brokenCopy("wrong-team-effort", join(repo, ".postmaster", "runs", "7"));
    const brief = join(dispatch, "brief.md");
    const text = readFileSync(brief, "utf8");
    const changed = text.replace(/^(workhorses: [^\n]*\/)[^,\n]*/mu, "$1wrong");
    expect(changed).not.toBe(text);
    writeFileSync(brief, changed);
    const result = runScore(dispatch, repo);
    expect(result.code).toBe(2);
    expect(result.out).toContain("FAIL efforts");
  }, 30000);

  test("a model containing a slash leaves the Team effort as its last field", () => {
    const dispatch = join(scratch, "dispatch");
    mkdirSync(dispatch, { recursive: true });
    writeFileSync(
      join(dispatch, "run.json"),
      JSON.stringify({
        config: {
          lanes: { one: { harness: "mimo", model: "provider/model", effort: "low" } },
          team: { workhorses: ["one"], coachman: { effort: "low" } },
        },
      }),
    );
    writeFileSync(
      join(dispatch, "brief.md"),
      "## Team\nworkhorses: one=mimo/provider/model/low\ncoachman: claude/model/low\nefforts: one=low, coachman=low\n",
    );
    expect(checkWaybillEfforts(dispatch).ok).toBe(true);
  });

  test("a Team entry for a lane with no recorded effort is skipped", () => {
    const dispatch = join(scratch, "dispatch-effortless");
    mkdirSync(dispatch, { recursive: true });
    writeFileSync(
      join(dispatch, "run.json"),
      JSON.stringify({
        config: {
          lanes: {
            one: { harness: "codex", model: "c", effort: "none" },
            two: { harness: "codex", model: "c" },
          },
          team: { workhorses: ["one", "two"], coachman: { effort: "none" } },
        },
      }),
    );
    writeFileSync(
      join(dispatch, "brief.md"),
      "## Team\nworkhorses: one=codex/c/none, two=codex/c\ncoachman: muse/m/none\nefforts: one=none, coachman=none\n",
    );
    expect(checkWaybillEfforts(dispatch).ok).toBe(true);
  });

  test("a slash model with no effort slot and no recorded effort passes", () => {
    const dispatch = join(scratch, "dispatch-slash-effortless");
    mkdirSync(dispatch, { recursive: true });
    writeFileSync(
      join(dispatch, "run.json"),
      JSON.stringify({
        config: {
          lanes: { one: { harness: "mimo", model: "p/m" } },
          team: { workhorses: ["one"], coachman: { harness: "muse", model: "m" } },
        },
      }),
    );
    writeFileSync(
      join(dispatch, "brief.md"),
      "## Team\nworkhorses: one=mimo/p/m\ncoachman: muse/m\nefforts:\n",
    );
    expect(checkWaybillEfforts(dispatch).ok).toBe(true);
  });

  test("a Team entry omitting the slot for a recorded effort fails", () => {
    const dispatch = join(scratch, "dispatch-omitted-effort");
    mkdirSync(dispatch, { recursive: true });
    writeFileSync(
      join(dispatch, "run.json"),
      JSON.stringify({
        config: {
          lanes: { two: { harness: "codex", model: "c", effort: "max" } },
          team: { workhorses: ["two"], coachman: { harness: "muse", model: "m", effort: "max" } },
        },
      }),
    );
    writeFileSync(
      join(dispatch, "brief.md"),
      "## Team\nworkhorses: two=codex/c\ncoachman: muse/m/max\nefforts: two=max, coachman=max\n",
    );
    const result = checkWaybillEfforts(dispatch);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("Team two effort missing, expected max");
  });

  test("a fabricated effort on a slash model fails", () => {
    const dispatch = join(scratch, "dispatch-slash-fabricated");
    mkdirSync(dispatch, { recursive: true });
    writeFileSync(
      join(dispatch, "run.json"),
      JSON.stringify({
        config: {
          lanes: { one: { harness: "mimo", model: "p/m", effort: "low" } },
          team: { workhorses: ["one"], coachman: { harness: "muse", model: "m", effort: "low" } },
        },
      }),
    );
    writeFileSync(
      join(dispatch, "brief.md"),
      "## Team\nworkhorses: one=mimo/p/m/high\ncoachman: muse/m/low\nefforts: one=low, coachman=low\n",
    );
    const result = checkWaybillEfforts(dispatch);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("Team one effort high, expected low");
  });

  test("a Team entry naming another harness or model than recorded fails", () => {
    const dispatch = join(scratch, "dispatch-wrong-model");
    mkdirSync(dispatch, { recursive: true });
    writeFileSync(
      join(dispatch, "run.json"),
      JSON.stringify({
        config: {
          lanes: { one: { harness: "mimo", model: "p/m", effort: "low" } },
          team: { workhorses: ["one"], coachman: { harness: "muse", model: "m", effort: "low" } },
        },
      }),
    );
    writeFileSync(
      join(dispatch, "brief.md"),
      "## Team\nworkhorses: one=codex/other/low\ncoachman: muse/m/low\nefforts: one=low, coachman=low\n",
    );
    const result = checkWaybillEfforts(dispatch);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("Team one names codex/other/low, recorded mimo/p/m");
  });

  test("a carried effort for an unrecorded name fails", () => {
    const dispatch = join(scratch, "dispatch-unrecorded-name");
    mkdirSync(dispatch, { recursive: true });
    writeFileSync(
      join(dispatch, "run.json"),
      JSON.stringify({
        config: {
          lanes: { one: { harness: "codex", model: "c", effort: "none" } },
          team: { workhorses: ["one"], coachman: { effort: "none" } },
        },
      }),
    );
    writeFileSync(
      join(dispatch, "brief.md"),
      "## Team\nworkhorses: one=codex/c/none, zzz=h/m/e\ncoachman: muse/m/none\nefforts: one=none, coachman=none\n",
    );
    const result = checkWaybillEfforts(dispatch);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("Team zzz effort e, expected missing");
  });

  test("a Team section with no workhorses or coachman line fails", () => {
    const dispatch = join(scratch, "dispatch-no-team-lines");
    mkdirSync(dispatch, { recursive: true });
    writeFileSync(
      join(dispatch, "run.json"),
      JSON.stringify({
        config: {
          lanes: { two: { harness: "codex", model: "c", effort: "max" } },
          team: { workhorses: ["two"], coachman: { harness: "muse", model: "m", effort: "max" } },
        },
      }),
    );
    writeFileSync(
      join(dispatch, "brief.md"),
      "## Team\nreviewers: two\nefforts: two=max, coachman=max\n",
    );
    const result = checkWaybillEfforts(dispatch);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("no Team workhorses or coachman entries");
  });
});

describe("score: input that is not a run is refused, not scored", () => {
  test("no such dispatch directory", () => {
    const cleanRepo = join(tmp, `clean-${first}`, "repo");
    expect(runScore(join(tmp, "nowhere"), cleanRepo).code).toBe(1);
  }, 30000);
  test("a repo that is not a git repo", () => {
    const cleanDir = join(tmp, `clean-${first}`, "repo", ".postmaster", "runs", "7");
    mkdirSync(join(tmp, "not-a-repo"), { recursive: true });
    expect(runScore(cleanDir, join(tmp, "not-a-repo")).code).toBe(1);
  }, 30000);
  test("a repo whose main does not hold the run's base", () => {
    const cleanDir = join(tmp, `clean-${first}`, "repo", ".postmaster", "runs", "7");
    run("git", ["init", "-q", "-b", "main", join(tmp, "other")]);
    run("git", [
      "-C",
      join(tmp, "other"),
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "Another history",
    ]);
    const r = runScore(cleanDir, join(tmp, "other"));
    expect(r.code).toBe(1);
    expect(r.out.includes("is this the run's repo")).toBe(true);
  }, 30000);
});

describe("score: lane scores beside the main counts (#159)", () => {
  test("no lanes: the hidden-tests detail carries no lane suffix", () => {
    const empty = join(tmp, "no-lanes");
    mkdirSync(empty, { recursive: true });
    expect(laneScores(empty, join(tmp, "nowhere"), "remove")).toBe("");
  }, 30000);
  test("an unscorable dispatch reads as lanes not scored", () => {
    expect(laneScores(join(tmp, "nowhere"), join(tmp, "nowhere"), "remove")).toBe(
      "lanes not scored",
    );
  }, 30000);
});

describe("a command gets 1200 seconds, then only the timeout message", () => {
  test("score allows 1200 seconds a command, as BASE does", () => {
    expect(TIMEOUT).toBe(1200);
  }, 30000);
  test("a stalled command is cut off with BASE's message, its output discarded", () => {
    const stalled = sh(["bash", "-c", "echo partial; sleep 30"], undefined, undefined, 1);
    expect(stalled.code).toBeNull();
    expect(stalled.out).toBe("timed out after 1s");
  }, 30000);
  test("a child that exits 128 on its own is exit 128, never a timeout", () => {
    const died128 = sh(["bash", "-c", "exit 128"]);
    expect(died128.code).toBe(128);
  }, 30000);
});

describe("a copy that fails fails the repo, never a partial app", () => {
  test("a failed app listing fails the repo with BASE's message", () => {
    const { value, errs } = captureStderr(() =>
      makeRepo(join(tmp, "fail-list"), join(tmp, "nonesuch-src")),
    );
    expect(value).toBe(false);
    expect(errs.some((l) => l.includes("could not copy the app to"))).toBe(true);
  }, 30000);
  test("a file that cannot be copied fails the repo, never a partial app", () => {
    const src = join(tmp, "denied-src");
    mkdirSync(src, { recursive: true });
    run("git", ["-C", src, "init", "-q", "-b", "main"]);
    writeFileSync(join(src, "secret.txt"), "shh\n");
    run("git", ["-C", src, "add", "-A"]);
    run("git", [
      "-C",
      src,
      "-c",
      "user.name=t",
      "-c",
      "use" + "r.e" + "mai" + "l=t" + "@t",
      "commit",
      "-q",
      "-m",
      "one",
    ]);
    chmodSync(join(src, "secret.txt"), 0);
    const { value } = captureStderr(() => makeRepo(join(tmp, "fail-copy"), src));
    expect(value).toBe(false);
  }, 30000);
});

describe("a dangling symlink is listed and copied, never skipped", () => {
  test("a dangling symlink is copied as a link, as lexists does", () => {
    const src = join(tmp, "dangling-src");
    mkdirSync(src, { recursive: true });
    run("git", ["-C", src, "init", "-q", "-b", "main"]);
    symlinkSync("nowhere-at-all", join(src, "dangling"));
    run("git", ["-C", src, "add", "-A"]);
    run("git", [
      "-C",
      src,
      "-c",
      "user.name=t",
      "-c",
      "use" + "r.e" + "mai" + "l=t" + "@t",
      "commit",
      "-q",
      "-m",
      "one",
    ]);
    const destDir = join(tmp, "dangling-dest");
    const ok = makeRepo(destDir, src);
    let linked = false;
    try {
      linked = lstatSync(join(destDir, "dangling")).isSymbolicLink();
    } catch {
      linked = false;
    }
    expect(ok).toBe(true);
    expect(linked).toBe(true);
  }, 30000);
});

// Main's #98 headless-fixture controls, unioned at the merge: the beside suite
// above is this branch's; what follows is main's, verbatim but for imports.

const SCRIPT = join(import.meta.dir, "run");
const FIXTURE_TICKET = "remove";
const gitEnv = {
  GIT_AUTHOR_NAME: "fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.invalid",
  GIT_COMMITTER_NAME: "fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.invalid",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_DIR: undefined,
  GIT_WORK_TREE: undefined,
};

let scratch: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "fixture-test-"));
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function runNew(dest: string, home: string, extraEnv: Record<string, string | undefined> = {}) {
  return run(SCRIPT, ["fixture", "new", dest, FIXTURE_TICKET], {
    env: {
      ...gitEnv,
      HOME: home,
      POSTMASTER_FIXTURES: join(home, "fixtures"),
      POSTMASTER_CONFIG: undefined,
      LOCAL_SH: undefined,
      CLAUDE_CONFIG_DIR: join(home, "claude-config"),
      CODEX_HOME: join(home, ".codex"),
      ...extraEnv,
    },
    input: "",
  });
}

type ConfigSnapshot = Record<string, string | null>;

function configSnapshot(home: string): ConfigSnapshot {
  const paths = [".claude.json", "claude-config/.claude.json", ".codex/config.toml"];
  return Object.fromEntries(
    paths.map((relative) => {
      const path = join(home, relative);
      return [relative, existsSync(path) ? readFileSync(path).toString("base64") : null];
    }),
  );
}

function sameConfigs(before: ConfigSnapshot, after: ConfigSnapshot): boolean {
  return JSON.stringify(before) === JSON.stringify(after);
}

function initRepo(path: string): void {
  mkdirSync(path, { recursive: true });
  run("git", ["-C", path, "init", "-q", "-b", "main"], { env: gitEnv });
}

describe("fixture copy mark and harness settings", () => {
  test("new marks the copy by ticket and leaves its tree as one clean commit", () => {
    const home = join(scratch, "home");
    const dest = join(scratch, "runs", "fixture");
    mkdirSync(home, { recursive: true });

    const made = runNew(dest, home);
    if (made.code !== 0) throw new Error(made.out + made.err);
    const mark = run("git", ["-C", dest, "config", "--local", "--get", "postmaster.fixture"]);
    const commits = run("git", ["-C", dest, "rev-list", "--count", "main"]);
    const status = run("git", ["-C", dest, "status", "--porcelain", "--untracked-files=all"]);

    expect(made.code).toBe(0);
    expect(mark.code).toBe(0);
    expect(mark.out.trim()).toBe(FIXTURE_TICKET);
    expect(commits.out.trim()).toBe("1");
    expect(status.out.trim()).toBe("");

    const ordinary = join(scratch, "ordinary-repo");
    initRepo(ordinary);
    const ordinaryMark = run(
      "git",
      ["-C", ordinary, "config", "--local", "--get", "postmaster.fixture"],
      { env: gitEnv },
    );
    expect(ordinaryMark.code).not.toBe(0);
  });

  test("new leaves present scratch Claude and Codex configs byte for byte unchanged", () => {
    const home = join(scratch, "home");
    const dest = join(scratch, "runs", "fixture");
    mkdirSync(join(home, ".codex"), { recursive: true });
    mkdirSync(join(home, "claude-config"), { recursive: true });
    writeFileSync(
      join(home, ".claude.json"),
      '{"projects":{"/outside":{"hasTrustDialogAccepted":true}}}\n',
    );
    writeFileSync(
      join(home, "claude-config", ".claude.json"),
      '{"projects":{"/custom":{"hasTrustDialogAccepted":true}}}\n',
    );
    writeFileSync(
      join(home, ".codex", "config.toml"),
      '[projects."/outside"]\ntrust_level = "trusted"\n',
    );
    const before = configSnapshot(home);

    const made = runNew(dest, home);

    expect(made.code).toBe(0);
    expect(sameConfigs(before, configSnapshot(home))).toBe(true);
  });

  test("new leaves absent scratch harness configs absent", () => {
    const home = join(scratch, "home");
    const dest = join(scratch, "runs", "fixture");
    mkdirSync(home, { recursive: true });
    const before = configSnapshot(home);

    const made = runNew(dest, home);

    expect(made.code).toBe(0);
    expect(sameConfigs(before, configSnapshot(home))).toBe(true);
  });

  test("the same config comparison catches a write control", () => {
    const home = join(scratch, "home");
    mkdirSync(home, { recursive: true });
    const config = join(home, ".claude.json");
    writeFileSync(config, '{"projects":{}}\n');
    const before = configSnapshot(home);

    writeFileSync(config, '{"projects":{"/control":{"hasTrustDialogAccepted":true}}}\n');

    expect(sameConfigs(before, configSnapshot(home))).toBe(false);
  });

  test("new under a hostile GIT_DIR still marks the copy, not the other repo", () => {
    const home = join(scratch, "home");
    const dest = join(scratch, "runs", "fixture");
    mkdirSync(home, { recursive: true });
    const other = join(scratch, "other-repo");
    initRepo(other);

    const made = runNew(dest, home, { GIT_DIR: join(other, ".git") });
    const mark = run("git", ["-C", dest, "config", "--local", "--get", "postmaster.fixture"]);
    const leaked = run("git", ["-C", other, "config", "--local", "--get", "postmaster.fixture"], {
      env: gitEnv,
    });

    expect(made.code).toBe(0);
    expect(mark.code).toBe(0);
    expect(mark.out.trim()).toBe(FIXTURE_TICKET);
    expect(leaked.code).not.toBe(0);
  });

  test("a plain repo from makeRepo has no fixture marker", () => {
    const plain = join(scratch, "plain-no-marker");
    expect(makeRepo(plain)).toBe(true);
    expect(existsSync(join(plain, ".postmaster", "fixture"))).toBe(false);
  });
});
