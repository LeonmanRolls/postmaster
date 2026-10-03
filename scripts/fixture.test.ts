// Tests beside scripts/fixture.ts, moved from its --self-test on #109: 70 controls,
// plus two lane-score controls for the #159 merge.
// The run records, scores and hidden suites are built once in beforeAll; each test asserts.
// CLI-refusal controls spawn the wrapper; internal controls import from "./fixture".
// HOME-altering controls save and restore it (the self-test left it deleted on exit).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
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
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  appFiles,
  checkWaybillEfforts,
  FIXTURE_MARKER,
  HIDDEN_RE,
  hidden,
  laneScores,
  legsOf,
  makeAndFile,
  makeBodyFile,
  makeRepo,
  makeScoreDir,
  onPath,
  score,
  sectionOf,
  sh,
  squash,
  TIMEOUT,
  tail,
  ticketBody,
  tickets,
  ticketTitle,
} from "./fixture";
import { scriptsDir, toolRoot } from "./lib/paths.ts";
import { run } from "./lib/proc.ts";
import { pyWords } from "./lib/text.ts";

const TOOL = toolRoot(import.meta);
const HERE = scriptsDir(import.meta);
const APP = join(TOOL, "fixtures", "app");
const TICKETS = join(TOOL, "fixtures", "tickets");
const wrapper = join(import.meta.dir, "fixture.sh");
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
  run("bash", [join(HERE, "run-meta.sh"), d, repo]);
  const recordedConfig = JSON.parse(readFileSync(join(d, "run.json"), "utf8")).config;
  const workhorses = (recordedConfig.team.workhorses ?? [])
    .map((name: string) => {
      const lane = recordedConfig.lanes[name];
      return `${name}=${lane.harness}/${lane.model}/${lane.effort ?? ""}`;
    })
    .join(", ");
  const coachman = recordedConfig.team.coachman;
  const efforts = run("bash", [join(HERE, "run-meta.sh"), "efforts", d]).out.trim();
  writeFileSync(
    join(d, "brief.md"),
    `${readFileSync(join(d, "brief.md"), "utf8")}\n## Team\nworkhorses: ${workhorses}\ncoachman: ${coachman.harness}/${coachman.model}/${coachman.effort ?? ""}\n${efforts}\n`,
  );
  if (legs === 3) {
    const runJson = JSON.parse(readFileSync(join(d, "run.json"), "utf-8"));
    delete runJson.coachman_contract;
    writeFileSync(join(d, "run.json"), JSON.stringify(runJson, null, 2));
  }

  const stageList = stages.split("\n").filter(Boolean);
  // Leg 1 enters every stage through checkpoint-1; each later leg its own slice of the rest;
  // the postmaster closes. A current run's shipped is the postmaster's; a pre-change ship leg
  // sets its own, as the runbooks have it.
  const walked = legs === 1 ? stageList.filter((s) => s !== "review") : stageList;
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
    run("bash", [join(HERE, "log-action.sh"), d, "postmaster", "dispatch", "7", `leg ${n}`]);
    run("bash", [join(HERE, "log-action.sh"), d, "coachman", "handoff-accept", `leg-${n}`]);
    for (const s of slices[n - 1] ?? []) {
      run("bash", [join(HERE, "stage.sh"), d, s]);
    }
    const handoffSections = sections.split("\n").filter(Boolean);
    writeFileSync(
      join(d, `handoff-${n}.md`),
      handoffSections.map((sec) => `## ${sec}\nLeg ${n}, recorded.\n\n`).join(""),
    );
    run("bash", [join(HERE, "log-action.sh"), d, "coachman", "handoff", `leg-${n}`]);
    writeFileSync(join(d, `.leg-${n}-done`), "");
    writeFileSync(join(d, `.leg-${n}-exited`), "");
  }
  for (const s of postStages) {
    run("bash", [join(HERE, "stage.sh"), d, s, "postmaster"]);
  }
  writeFileSync(join(d, "card.md"), "# Ship card: 7\n\nBranch 7 is merged into main.\n");
  const manifest = JSON.parse(readFileSync(join(d, "manifest.json"), "utf-8"));
  manifest.leg = legs;
  manifest.coachman.legs = {};
  for (let n = 1; n <= legs; n++) {
    manifest.coachman.legs[String(n)] = { thread_id: `thread-${n}` };
  }
  writeFileSync(join(d, "manifest.json"), JSON.stringify(manifest, null, 2));
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

  for (const b of [
    "stages",
    "markers",
    "handoffs",
    "runjson",
    "card",
    "waybill",
    "legs",
    "efforts",
  ]) {
    background(`break-${b}`, () =>
      score(join(tmp, `break-${b}`, "repo", ".postmaster", "runs", "7"), repo),
    );
  }
}

function recorded(
  name: string,
  t: string,
  shipped: "reference" | "app" | "broken",
  legs = 2,
): number | { code: number; out: string } {
  const rc = record(name, t, shipped, legs);
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
  const lines = out.split("\n").filter((l) => l.trim()).length;
  expect(rc).toBe(failing === "none" ? 0 : 2);
  expect(failingChecks).toBe(failing);
  expect(lines).toBe(8);
  if (failText !== undefined) {
    expect(
      out
        .split("\n")
        .filter((l) => l.startsWith("FAIL"))
        .some((l) => l.includes(failText)),
    ).toBe(true);
  }
}

function runScore(dispatch: string, repo: string): { code: number; out: string } {
  const r = spawnSync(wrapper, ["score", dispatch, repo], { encoding: "utf8" });
  return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

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

  uni = mkdtempSync(join(tmpdir(), "fixture-uni-"));
  uni2 = mkdtempSync(join(tmpdir(), "fixture-uni2-"));
  uni3 = mkdtempSync(join(tmpdir(), "fixture-uni3-"));
  writeFileSync(join(uni, ".leg-١-done"), "");
  writeFileSync(join(uni2, "x.leg-1-done"), "");

  const emptyMd = join(tmp, "empty.md");
  writeFileSync(emptyMd, "");
  const sectionsR = run("bash", [join(HERE, "handoff-check.sh"), emptyMd]);
  sections = sectionsR.err
    .split("\n")
    .filter((l) => l.startsWith("handoff-check: missing or empty section: "))
    .map((l) => l.replace("handoff-check: missing or empty section: ", ""))
    .join("\n");
  const listedR = run("bash", [join(HERE, "stage.sh"), "--list"]);
  listed = listedR.out.trim();
  const stageLines = listed.split("\n");
  const doneIdx = stageLines.indexOf("done");
  stages = doneIdx > 0 ? stageLines.slice(1, doneIdx).join("\n") : "";

  for (const t of tickets()) {
    background(`clean-${t}`, () => recorded(`clean-${t}`, t, "reference"));
  }
  background("clean-one", () => recorded("clean-one", first, "reference", 1));
  background("clean-three", () => recorded("clean-three", first, "reference", 3));
  background("break-hidden", () => recorded("break-hidden", first, "app"));
  background("break-gate", () => recorded("break-gate", first, "broken"));

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
}, 900000);

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
    test(`${t}: in the ticket shape, by scripts/ticket-check.sh`, () => {
      const body = ticketBody(t);
      writeFileSync(join(tmp, `body-${t}.md`), body);
      const checkR = run("bash", [
        join(HERE, "ticket-check.sh"),
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
    const listed2 = run("bash", [
      "-c",
      `git -C "${APP}" ls-files --cached --others --exclude-standard`,
    ])
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
    const heldFiles = run("bash", [
      "-c",
      `cd "${dest}" && find . -path ./.git -prune -o \\( -type f -o -type l \\) -print | ` +
        `sed 's|^\\./||' | sort`,
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
    const localSh = join(HERE, "local.sh");
    const listR = run("bash", [localSh, dest, "list"]);
    const readR = run("bash", [localSh, dest, "read", "1", "--body"]);
    expect(listR.out.trim()).toBe(`#1\ttodo\t${ticketTitle(first)}`);
    expect(readR.out).toBe(ticketBody(first));
  }, 30000);
  test("a run against it reads the local tracker, though the config names github", () => {
    const trackerKind = run("bash", [join(HERE, "tracker-kind.sh"), dest]);
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
    const aRc = run("bash", [
      join(HERE, "log-action.sh"),
      join(sameA, ".postmaster", "runs", "T-1"),
      "postmaster",
      "note",
      "same-a",
      "one",
    ]).code;
    const bRc = run("bash", [
      join(HERE, "log-action.sh"),
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
        `case $2 in store) exec "${join(HERE, "local.sh")}" "$@" ;; *) exit 1 ;; esac\n`,
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
    expectScore("break-legs", "stages", "turnpikes.sh legs");
  }, 30000);
  test("a waybill with mismatched efforts: efforts alone fails", () => {
    expectScore("break-efforts", "efforts", "efforts:");
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
      "user.email=t@t",
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
      "user.email=t@t",
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

const SCRIPT = join(import.meta.dir, "fixture.ts");
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
  const config = join(import.meta.dir, "..", "bunfig.toml");
  return run("bun", ["--no-env-file", `--config=${config}`, SCRIPT, "new", dest, FIXTURE_TICKET], {
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
