// Blind acceptance tests for #237: one case per check the ticket's interface pins.
// Each case builds a fresh run layout, runs the ticket's commands, and matches only what
// the ticket pins: exits, the wall line's contents, the reset moment, the quoted wordings,
// the needs and NEXT names. Output wording beyond that is the lane's to choose and is
// never matched. See walls-oracle.ts for what a blind test cannot cover and why.
import { afterAll, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ageFiles,
  both,
  callCount,
  claudeInit,
  claudeWall,
  CLAUDE_WALL_MESSAGE,
  codexCmdFailed,
  codexDone,
  codexProse,
  codexThread,
  codexWall,
  CODEX_WALL_MESSAGE,
  expectedDaily,
  findIsos,
  git,
  launchStep,
  lineBody,
  liveLock,
  makeLayout,
  mimoError,
  mimoFinish,
  mimoStart,
  mimoText,
  mimoToolError,
  mkRun,
  mkScratch,
  mkWt,
  need,
  nextOf,
  patchManifestLanes,
  patchRunJson,
  readActions,
  setStub,
  sh,
  touchEpoch,
  validHandoff,
  waitMarker,
  wallLines,
  walls,
  wallsEnv,
  watch,
  watchTest,
} from "./walls-oracle";
import type { ActionLine, Layout, Run } from "./walls-oracle";

const REPO = realpathSync(join(import.meta.dir, ".."));
const SCRIPTS = join(REPO, "scripts");

function oracle(name: string, fn: (lay: Layout) => void, timeout = 120000): void {
  test(
    name,
    () => {
      const lay = makeLayout(REPO);
      try {
        fn(lay);
      } finally {
        lay.cleanup();
      }
    },
    timeout,
  );
}

function expectExit(r: Run, want: number): void {
  if (r.code !== want) {
    throw new Error(
      `want exit ${want}, got ${r.code}\n--- out ---\n${r.out}\n--- err ---\n${r.err}`,
    );
  }
  // Counted, so a test using only this helper still checks something.
  expect(r.code).toBe(want);
}

function onlyWall(dispatch: string): ActionLine {
  const lines = wallLines(dispatch);
  if (lines.length !== 1) {
    throw new Error(`want 1 wall line, got ${lines.length}: ${lines.map((l) => l.raw).join("\n")}`);
  }
  return lines[0]!;
}

function expectReset(body: string, expectedMs: number, tolMs: number): void {
  const isos = findIsos(body);
  const near = isos.filter((i) => Math.abs(i.epoch - expectedMs) <= tolMs);
  if (near.length === 0) {
    throw new Error(
      `no reset within ${tolMs}ms of ${new Date(expectedMs).toISOString()} in: ${body}`,
    );
  }
  const far = isos.filter((i) => Math.abs(i.epoch - expectedMs) > tolMs);
  if (far.length > 0) {
    throw new Error(`stray timestamp ${far.map((i) => i.raw).join(",")} in: ${body}`);
  }
  // Counted, so a test using only this helper still checks something.
  expect(near.length).toBeGreaterThan(0);
}

function expectNoReset(body: string): void {
  const isos = findIsos(body);
  if (isos.length > 0) {
    throw new Error(`want no reset time, found ${isos.map((i) => i.raw).join(",")} in: ${body}`);
  }
  if (!/(?:^|[^0-9A-Za-z_])none(?:$|[^0-9A-Za-z_])/u.test(body))
    throw new Error(`want "none" for the reset in: ${body}`);
}

function roundOk(body: string, n: string): boolean {
  // The ticket pins that the record holds the round, not how it is labelled:
  // accept rN, round N, a "round":N field, or the bare number directly after
  // the lens word in a positional detail.
  const edge = "(?:^|[^0-9A-Za-z_])";
  const end = "(?:$|[^0-9A-Za-z_])";
  return (
    new RegExp(`${edge}r${n}${end}`, "u").test(body) ||
    new RegExp(`round[^0-9a-z]{0,3}${n}${end}`, "iu").test(body) ||
    body.includes(`"round":${n}`) ||
    body.includes(`"round": ${n}`) ||
    new RegExp(`${edge}(?:style|bug|security)[ \t\n]+${n}${end}`, "u").test(body)
  );
}

function startRound(lay: Layout, dispatch: string, n: string): void {
  need(
    sh(join(SCRIPTS, "run"), ["review-round", "start", dispatch, n], lay.env, lay.tmp),
    `start ${n}`,
  );
}

// A run's tool checkout must be clean at its dispatch commit (run-meta check). REPO is the live
// working tree, which another test file running beside this one can dirty for a moment, so the
// pin is a private clone of HEAD, made once per file.
let toolClone: { dir: string; head: string } | null = null;

function pinnedTool(): { dir: string; head: string } {
  if (toolClone) return toolClone;
  const head = git("-C", REPO, "rev-parse", "HEAD");
  need(head, "head of the repo under test");
  const dir = mkdtempSync(join(tmpdir(), "walls-oracle-tool-"));
  need(git("clone", "-q", "--shared", "--no-checkout", REPO, dir), "clone of the repo under test");
  need(
    git("-C", dir, "checkout", "-q", "--detach", head.out.trim()),
    "HEAD checked out in the clone",
  );
  toolClone = { dir, head: head.out.trim() };
  return toolClone;
}

afterAll(() => {
  if (toolClone) rmSync(toolClone.dir, { recursive: true, force: true });
  toolClone = null;
});

function pinTool(lay: Layout, dispatch: string): void {
  const tool = pinnedTool();
  patchRunJson(dispatch, { postmaster: { commit: tool.head, checkout: tool.dir } });
}

function workhorseWall(lay: Layout, tag: string, message: string): ActionLine {
  setStub(lay, "codex", [codexThread(`t-${tag}`), codexWall(message)], 1);
  const wt = mkWt(lay, `wt-${tag}`);
  launchStep(REPO, lay, {
    lane: "stub",
    role: "lane",
    form: "launch",
    stream: `stub-${tag}-events.jsonl`,
    marker: `stub-${tag}.done`,
    cwd: wt,
  });
  return onlyWall(lay.dispatch);
}

function mimoWall(lay: Layout, tag: string, dispatch?: string): void {
  setStub(
    lay,
    "mimo",
    [
      mimoStart(`s-${tag}`),
      mimoError(`s-${tag}`, "ProviderError", "You’ve hit your usage limit for this key."),
    ],
    0,
  );
  const wt = mkWt(lay, `wt-${tag}`);
  launchStep(REPO, lay, {
    lane: "mimo",
    role: "lane",
    form: "launch",
    stream: `mimo-${tag}-events.jsonl`,
    marker: `mimo-${tag}.done`,
    cwd: wt,
    dispatch,
  });
}

// A healthy mimo beside a walled stub, so stub's go-on is accepted under C19:
// a summary in mimo's worktree and a harvested outcome, covering either lookup.
function mimoHealthy(lay: Layout, dispatch: string): void {
  const runName = dispatch.split("/").pop() ?? "T";
  const mimoWt = join(lay.repo, ".worktrees", `${runName}-mimo`);
  mkdirSync(mimoWt, { recursive: true });
  writeFileSync(join(mimoWt, "WORKHORSE-SUMMARY.md"), "# summary\n");
  patchManifestLanes(dispatch, { stub: { outcome: "approved" }, mimo: { outcome: "harvested" } });
}

oracle(
  "C1: a workhorse ending on the Codex wall records one wall line before its marker",
  (lay) => {
    setStub(lay, "codex", [codexThread("t-c1a"), codexWall(CODEX_WALL_MESSAGE)], 1);
    const wt = mkWt(lay, "wt-c1a");
    launchStep(REPO, lay, {
      lane: "stub",
      role: "lane",
      form: "launch",
      stream: "stub-events.jsonl",
      marker: "stub.done",
      cwd: wt,
    });
    expect(wallLines(lay.dispatch).length).toBe(1);
    const actionsMtime = statSync(join(lay.dispatch, "actions.jsonl")).mtimeMs;
    const markerMtime = statSync(join(lay.dispatch, "logs", "stub.done")).mtimeMs;
    expect(markerMtime >= actionsMtime).toBe(true);
  },
);

oracle("C1 control: a workhorse that ends clean records no wall", (lay) => {
  setStub(
    lay,
    "codex",
    [codexThread("t-c1ok"), codexProse("done, every check passes"), codexDone()],
    0,
  );
  const wt = mkWt(lay, "wt-c1ok");
  launchStep(REPO, lay, {
    lane: "stub",
    role: "lane",
    form: "launch",
    stream: "stub-events.jsonl",
    marker: "stub.done",
    cwd: wt,
  });
  expect(wallLines(lay.dispatch).length).toBe(0);
});

oracle("C1: a bug reviewer ending on a MiMo limit error records one wall line", (lay) => {
  startRound(lay, lay.dispatch, "1");
  setStub(
    lay,
    "mimo",
    [
      mimoStart("s-c1b"),
      mimoText("s-c1b", "reviewing the diff"),
      mimoError("s-c1b", "ProviderError", "You’ve hit your usage limit. Try again in 20 minutes."),
    ],
    0,
  );
  const { wt, base } = mkScratch(lay, "rev-c1b");
  launchStep(REPO, lay, {
    lane: "mimo",
    role: "reviewer",
    form: "review",
    stream: "review-r1-bug-mimo.jsonl",
    marker: "review-r1-bug-mimo.done",
    cwd: wt,
    base,
  });
  expect(wallLines(lay.dispatch).length).toBe(1);
});

oracle("C1: a security reviewer ending on the Claude limit records one wall line", (lay) => {
  startRound(lay, lay.dispatch, "1");
  setStub(lay, "claude", [claudeInit("s-c1c"), claudeWall()], 1);
  const { wt } = mkScratch(lay, "rev-c1c");
  launchStep(REPO, lay, {
    lane: "sec",
    role: "reviewer",
    form: "launch",
    stream: "review-r1-security-sec.jsonl",
    marker: "review-r1-security-sec.done",
    cwd: wt,
  });
  expect(wallLines(lay.dispatch).length).toBe(1);
});

oracle("C1/D3: a limit error about a too-long request still counts as a wall", (lay) => {
  const line = workhorseWall(
    lay,
    "c1d",
    "This request exceeds the 200k token limit; shorten it and retry.",
  );
  expect(lineBody(line)).toContain("exceeds the 200k token limit");
});

oracle("C2: a workhorse wall holds the lane, role, message and the 2:29 reset", (lay) => {
  const line = workhorseWall(lay, "c2", CODEX_WALL_MESSAGE);
  const body = lineBody(line);
  expect(/(?:^|[^0-9A-Za-z_])stub(?:$|[^0-9A-Za-z_])/u.test(body)).toBe(true);
  expect(body).toContain("workhorse");
  expect(body).toContain(CODEX_WALL_MESSAGE);
  expectReset(body, expectedDaily(2, 29, line.ts), 1000);
});

oracle("C2: a reviewer wall holds its lens and round, and the 3am UTC reset", (lay) => {
  startRound(lay, lay.dispatch, "1");
  setStub(lay, "claude", [claudeInit("s-c2r"), claudeWall()], 1);
  const { wt } = mkScratch(lay, "rev-c2r");
  launchStep(REPO, lay, {
    lane: "sec",
    role: "reviewer",
    form: "launch",
    stream: "review-r1-security-sec.jsonl",
    marker: "review-r1-security-sec.done",
    cwd: wt,
  });
  const body = lineBody(onlyWall(lay.dispatch));
  expect(/(?:^|[^0-9A-Za-z_])sec(?:$|[^0-9A-Za-z_])/u.test(body)).toBe(true);
  expect(body).toContain("security");
  expect(roundOk(body, "1")).toBe(true);
  expect(body).toContain(CLAUDE_WALL_MESSAGE);
  expectReset(body, expectedDaily(3, 0, onlyWall(lay.dispatch).ts), 1000);
});

oracle("C2: absolute reset dates read as written, with and without the suffix", (lay) => {
  const messages = [
    "You’ve hit your usage limit. Try again Oct 5th, 2026 2:29 AM.",
    "You’ve hit your usage limit. Try again Oct 5, 2026 2:29 AM.",
  ];
  messages.forEach((message, i) => {
    setStub(lay, "codex", [codexThread(`t-c2abs${i}`), codexWall(message)], 1);
    const wt = mkWt(lay, `wt-c2abs${i}`);
    launchStep(REPO, lay, {
      lane: "stub",
      role: "lane",
      form: "launch",
      stream: `stub-c2abs${i}-events.jsonl`,
      marker: `stub-c2abs${i}.done`,
      cwd: wt,
    });
  });
  const lines = wallLines(lay.dispatch);
  expect(lines.length).toBe(2);
  const want = Date.UTC(2026, 9, 5, 2, 29, 0, 0);
  for (const message of messages) {
    const hit = lines.filter((l) => lineBody(l).includes(message));
    expect(hit.length).toBe(1);
    expectReset(lineBody(hit[0]!), want, 1000);
  }
});

oracle("C2: a wait of 20 minutes counts from when the lane stopped", (lay) => {
  setStub(
    lay,
    "mimo",
    [
      mimoStart("s-c2wait"),
      mimoError(
        "s-c2wait",
        "ProviderError",
        "You’ve hit your usage limit. Try again in 20 minutes.",
      ),
    ],
    0,
  );
  const wt = mkWt(lay, "wt-c2wait");
  launchStep(REPO, lay, {
    lane: "mimo",
    role: "lane",
    form: "launch",
    stream: "mimo-events.jsonl",
    marker: "mimo.done",
    cwd: wt,
  });
  const line = onlyWall(lay.dispatch);
  expectReset(lineBody(line), Date.parse(line.ts) + 20 * 60 * 1000, 180 * 1000);
});

oracle("C2: of two reset times the later counts", (lay) => {
  const line = workhorseWall(
    lay,
    "c2two",
    "You’ve hit your usage limit. Weekly window resets Oct 5, 2026 2:29 AM; hourly window resets Oct 6, 2026 2:29 AM.",
  );
  expectReset(lineBody(line), Date.UTC(2026, 9, 6, 2, 29, 0, 0), 1000);
});

oracle("C2: no time, or an abbreviated zone, reads as no reset time", (lay) => {
  const messages = [
    "You’ve hit your usage limit for this key.",
    "Usage limit hit; resets 3am (PST).",
  ];
  messages.forEach((message, i) => {
    setStub(lay, "codex", [codexThread(`t-c2none${i}`), codexWall(message)], 1);
    const wt = mkWt(lay, `wt-c2none${i}`);
    launchStep(REPO, lay, {
      lane: "stub",
      role: "lane",
      form: "launch",
      stream: `stub-c2none${i}-events.jsonl`,
      marker: `stub-c2none${i}.done`,
      cwd: wt,
    });
  });
  const lines = wallLines(lay.dispatch);
  expect(lines.length).toBe(2);
  for (const message of messages) {
    const hit = lines.filter((l) => lineBody(l).includes(message));
    expect(hit.length).toBe(1);
    expectNoReset(lineBody(hit[0]!));
  }
});

oracle("C2: only the message's first line is recorded, byte for byte", (lay) => {
  const line = workhorseWall(
    lay,
    "c2first",
    "You have hit the weekly usage limit.\nSecond line marker ZZZNEVER\nThird.",
  );
  const body = lineBody(line);
  expect(body).toContain("You have hit the weekly usage limit.");
  expect(body.includes("ZZZNEVER")).toBe(false);
});

oracle("C3: a 504 and a 401 ending record no wall", (lay) => {
  const endings = ["request failed: 504 Gateway Timeout", "API Error: 401 Unauthorized"];
  endings.forEach((message, i) => {
    setStub(lay, "codex", [codexThread(`t-c3http${i}`), codexWall(message)], 1);
    const wt = mkWt(lay, `wt-c3http${i}`);
    launchStep(REPO, lay, {
      lane: "stub",
      role: "lane",
      form: "launch",
      stream: `stub-c3http${i}-events.jsonl`,
      marker: `stub-c3http${i}.done`,
      cwd: wt,
    });
  });
  expect(wallLines(lay.dispatch).length).toBe(0);
});

oracle(
  "C3: a failed command printing limit words records no wall, and transient still wakes on it",
  (lay) => {
    setStub(
      lay,
      "codex",
      [
        codexThread("t-c3cmd"),
        codexCmdFailed("/bin/bash -lc 'bun test'", "usage limit exceeded for this tool call"),
        codexDone(),
      ],
      0,
    );
    const wt = mkWt(lay, "wt-c3cmd");
    launchStep(REPO, lay, {
      lane: "stub",
      role: "lane",
      form: "launch",
      stream: "stub-events.jsonl",
      marker: "stub.done",
      cwd: wt,
    });
    setStub(
      lay,
      "mimo",
      [
        mimoStart("s-c3tool"),
        mimoToolError("s-c3tool", "bash", "bun test", "usage limit exceeded for this tool call"),
        mimoFinish("s-c3tool"),
      ],
      0,
    );
    const wt2 = mkWt(lay, "wt-c3tool");
    launchStep(REPO, lay, {
      lane: "mimo",
      role: "lane",
      form: "launch",
      stream: "mimo-events.jsonl",
      marker: "mimo.done",
      cwd: wt2,
    });
    expect(wallLines(lay.dispatch).length).toBe(0);
    // classifyTransient stays as the watcher uses it: the shared list still wakes.
    const errFile = join(lay.tmp, "transient.err");
    writeFileSync(errFile, "");
    for (const stream of ["stub-events.jsonl", "mimo-events.jsonl"]) {
      const r = sh(
        join(SCRIPTS, "run"),
        ["launch", "transient", errFile, join(lay.dispatch, "logs", stream)],
        lay.env,
        lay.tmp,
      );
      expect(r.out.trim()).toBe("provider-wall");
    }
  },
);

oracle("C3: a final message in prose mentioning a limit records no wall", (lay) => {
  setStub(
    lay,
    "codex",
    [
      codexThread("t-c3prose"),
      codexProse("I hit the usage limit for today, so I am stopping here."),
      codexDone(),
    ],
    0,
  );
  const wt = mkWt(lay, "wt-c3prose");
  launchStep(REPO, lay, {
    lane: "stub",
    role: "lane",
    form: "launch",
    stream: "stub-events.jsonl",
    marker: "stub.done",
    cwd: wt,
  });
  expect(wallLines(lay.dispatch).length).toBe(0);
});

oracle("C3: a lane stopped mid-run records no wall", (lay) => {
  setStub(lay, "codex", [codexThread("t-c3stop")], 0, "sleep 60");
  const wt = mkWt(lay, "wt-c3stop");
  const d = lay.dispatch;
  const streamPath = join(d, "logs", "stop-events.jsonl");
  const errPath = `${streamPath}.err`;
  need(
    sh(
      join(SCRIPTS, "run"),
      [
        "host",
        "run",
        "oracle-stop",
        wt,
        "--under",
        d,
        "--role",
        "lane",
        "--run",
        d,
        "--out",
        streamPath,
        "--err",
        errPath,
        "--marker",
        join(d, "logs", "stop.done"),
        "--",
        join(SCRIPTS, "run"),
        "launch",
        "launch",
        "stub",
        wt,
        lay.prompt,
        "--last",
        `${streamPath}.last.md`,
        "--run",
        d,
      ],
      lay.env,
      lay.tmp,
    ),
    "host run the stop lane",
  );
  let seen = false;
  for (let i = 0; i < 40; i++) {
    try {
      if (readFileSync(streamPath, "utf8").includes("thread.started")) {
        seen = true;
        break;
      }
    } catch {
      /* not yet */
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  if (!seen) throw new Error("the stop lane never started");
  need(sh(join(SCRIPTS, "run"), ["host", "stop", wt], lay.env, lay.tmp), "host stop");
  waitMarker(join(d, "logs", "stop.done"), `${streamPath}.err`, 30);
  expect(wallLines(d).length).toBe(0);
});

oracle("C3: a lane that delivered its summary or blocked file records no wall", (lay) => {
  for (const [tag, file] of [
    ["c3sum", "WORKHORSE-SUMMARY.md"],
    ["c3blk", "WORKHORSE-BLOCKED.md"],
  ]) {
    setStub(
      lay,
      "codex",
      [codexThread(`t-${tag}`), codexWall(CODEX_WALL_MESSAGE)],
      1,
      `printf '# done\\n' > ${file} && git add ${file} && git -c user.name=o -c user.email=o@example.invalid commit -qm done`,
    );
    const { wt } = mkScratch(lay, `wt-${tag}`);
    launchStep(REPO, lay, {
      lane: "stub",
      role: "lane",
      form: "launch",
      stream: `stub-${tag}-events.jsonl`,
      marker: `stub-${tag}.done`,
      cwd: wt,
    });
  }
  expect(wallLines(lay.dispatch).length).toBe(0);
});

oracle("C3 control: a summary older than the launch does not excuse a wall", (lay) => {
  const { wt } = mkScratch(lay, "wt-c3old");
  writeFileSync(join(wt, "WORKHORSE-SUMMARY.md"), "# old\n");
  need(git("-C", wt, "add", "WORKHORSE-SUMMARY.md"), "add old summary");
  need(git("-C", wt, "commit", "-qm", "old"), "commit old summary");
  touchEpoch(join(wt, "WORKHORSE-SUMMARY.md"), Date.now() / 1000 - 86400);
  setStub(lay, "codex", [codexThread("t-c3old"), codexWall(CODEX_WALL_MESSAGE)], 1);
  launchStep(REPO, lay, {
    lane: "stub",
    role: "lane",
    form: "launch",
    stream: "stub-events.jsonl",
    marker: "stub.done",
    cwd: wt,
  });
  expect(wallLines(lay.dispatch).length).toBe(1);
});

oracle("C4: a grok lane ending on a limit message records no wall", (lay) => {
  setStub(lay, "grok", [codexWall(CODEX_WALL_MESSAGE)], 1);
  const wt = mkWt(lay, "wt-c4");
  launchStep(REPO, lay, {
    lane: "grok",
    role: "lane",
    form: "launch",
    stream: "grok-events.jsonl",
    marker: "grok.done",
    cwd: wt,
  });
  expect(wallLines(lay.dispatch).length).toBe(0);
});

oracle("C5: the watcher names each new wall, and rests once each is told", (lay) => {
  const d2 = mkRun(lay, "T2");
  for (const [d, tag] of [
    [lay.dispatch, "c5a"],
    [d2, "c5b"],
  ]) {
    setStub(lay, "codex", [codexThread(`t-${tag}`), codexWall(CODEX_WALL_MESSAGE)], 1);
    const wt = mkWt(lay, `wt-${tag}`);
    launchStep(REPO, lay, {
      lane: "stub",
      role: "lane",
      form: "launch",
      stream: `stub-${tag}-events.jsonl`,
      marker: `stub-${tag}.done`,
      cwd: wt,
      dispatch: d,
    });
    expect(wallLines(d).length).toBe(1);
  }
  liveLock(lay.dispatch, "1");
  const w = watch(REPO, lay, "5");
  expectExit(w, 0);
  expect(both(w)).toContain("needs T WALL");
  expect(both(w)).toContain("needs T2 WALL");
  expectExit(walls(REPO, lay, "told", lay.dispatch, "stub"), 0);
  expectExit(walls(REPO, lay, "told", d2, "stub"), 0);
  expectExit(watch(REPO, lay, "5"), 3);
});

oracle("C6: show names the run, lane, role, message and reset with its date, per zone", (lay) => {
  const d = mkRun(lay, "W6");
  setStub(
    lay,
    "codex",
    [
      codexThread("t-c6"),
      codexWall("You’ve hit your usage limit. Try again Oct 5th, 2026 2:29 AM."),
    ],
    1,
  );
  const wt = mkWt(lay, "wt-c6");
  launchStep(REPO, lay, {
    lane: "stub",
    role: "lane",
    form: "launch",
    stream: "stub-events.jsonl",
    marker: "stub.done",
    cwd: wt,
    dispatch: d,
  });
  const s = walls(REPO, lay, "show", d);
  expectExit(s, 0);
  for (const pinned of ["W6", "stub", "workhorse", "Oct 5th, 2026 2:29 AM", "2026"]) {
    expect(s.out).toContain(pinned);
  }
  const midway = wallsEnv(REPO, lay, { TZ: "Pacific/Midway" }, "show", d);
  const kiritimati = wallsEnv(REPO, lay, { TZ: "Pacific/Kiritimati" }, "show", d);
  expectExit(midway, 0);
  expectExit(kiritimati, 0);
  expect(midway.out === kiritimati.out).toBe(false);
});

oracle("C7: a held run's wall waits until the hold ends", (lay) => {
  workhorseWall(lay, "c7", CODEX_WALL_MESSAGE);
  mkdirSync(join(lay.root, "postmaster"), { recursive: true });
  writeFileSync(join(lay.root, "postmaster", "held"), "T\n");
  const held = watch(REPO, lay, "2");
  expectExit(held, 3);
  expect(both(held).includes("needs ")).toBe(false);
  writeFileSync(join(lay.root, "postmaster", "held"), "");
  const freed = watch(REPO, lay, "2");
  expectExit(freed, 0);
  expect(both(freed)).toContain("needs T WALL");
});

oracle("C8: an untold wall reads WALL, even busy or beside an older question", (lay) => {
  const line = workhorseWall(lay, "c8", CODEX_WALL_MESSAGE);
  expect(nextOf(REPO, lay, "T")).toBe("WALL");
  liveLock(lay.dispatch, "1");
  expect(nextOf(REPO, lay, "T")).toBe("WALL");
  const waiting = join(lay.dispatch, ".waiting-on-user");
  writeFileSync(waiting, "an older question\n");
  touchEpoch(waiting, Date.parse(line.ts) / 1000 - 3600);
  expect(nextOf(REPO, lay, "T")).toBe("WALL");
  touchEpoch(waiting, Date.parse(line.ts) / 1000 + 5);
  expect(nextOf(REPO, lay, "T")).toBe("USER");
});

oracle("C9: a wall's question stands beside the earlier one in the waiting list", (lay) => {
  const qfile = join(lay.tmp, "questions.txt");
  writeFileSync(qfile, "pick a color\nwall: stub walled, rule go on\n");
  need(
    sh(
      join(SCRIPTS, "run"),
      ["host", "leg", "waiting", "add", lay.root, "T", qfile],
      lay.env,
      lay.tmp,
    ),
    "waiting add",
  );
  const list = sh(
    join(SCRIPTS, "run"),
    ["host", "leg", "waiting", "list", lay.root],
    lay.env,
    lay.tmp,
  );
  need(list, "waiting list");
  expect(list.out).toContain("pick a color");
  expect(list.out).toContain("wall: stub walled, rule go on");
});

oracle("C10: a run paused for walls, idle 31 minutes, is not INSPECT", (lay) => {
  workhorseWall(lay, "c10", CODEX_WALL_MESSAGE);
  ageFiles(lay.dispatch, 31 * 60);
  expect(nextOf(REPO, lay, "T")).toBe("WALL");
});

oracle("C11: the round closes with each walled reviewer DEGRADED, no escalation", (lay) => {
  startRound(lay, lay.dispatch, "1");
  setStub(lay, "codex", [codexThread("t-c11bug"), codexWall(CODEX_WALL_MESSAGE)], 1);
  const bug = mkScratch(lay, "rev-c11bug");
  launchStep(REPO, lay, {
    lane: "stub",
    role: "reviewer",
    form: "review",
    stream: "review-r1-bug-stub.jsonl",
    marker: "review-r1-bug-stub.done",
    cwd: bug.wt,
    base: bug.base,
  });
  setStub(lay, "claude", [claudeInit("s-c11sec"), claudeWall()], 1);
  const sec = mkScratch(lay, "rev-c11sec");
  launchStep(REPO, lay, {
    lane: "sec",
    role: "reviewer",
    form: "launch",
    stream: "review-r1-security-sec.jsonl",
    marker: "review-r1-security-sec.done",
    cwd: sec.wt,
  });
  const w = sh(
    join(SCRIPTS, "run"),
    ["review-round", "wait", lay.dispatch, "1", lay.repo, "bug:stub", "security:sec"],
    lay.env,
    lay.tmp,
  );
  expectExit(w, 0);
  const log = readFileSync(join(lay.dispatch, "run-log.md"), "utf8");
  expect(log).toContain(`stub bug: DEGRADED, provider wall: "${CODEX_WALL_MESSAGE}"`);
  expect(log).toContain(`sec security: DEGRADED, provider wall: "${CLAUDE_WALL_MESSAGE}"`);
  const degrades = readActions(lay.dispatch).filter((l) => l.action === "degrade");
  const forLane = (lane: string, lens: string): boolean =>
    degrades.some((l) => l.target === lane && `${l.target} ${l.detail}`.includes(lens));
  expect(forLane("stub", "bug")).toBe(true);
  expect(forLane("sec", "security")).toBe(true);
  expect(existsSync(join(lay.dispatch, ".escalation-ready"))).toBe(false);
});

oracle("C13: escalate names each walled workhorse, its reset and the ruling", (lay) => {
  workhorseWall(lay, "c13a", CODEX_WALL_MESSAGE);
  setStub(
    lay,
    "mimo",
    [
      mimoStart("s-c13b"),
      mimoError("s-c13b", "ProviderError", "You’ve hit your usage limit for this key."),
    ],
    0,
  );
  const wt = mkWt(lay, "wt-c13b");
  launchStep(REPO, lay, {
    lane: "mimo",
    role: "lane",
    form: "launch",
    stream: "mimo-events.jsonl",
    marker: "mimo.done",
    cwd: wt,
  });
  expect(wallLines(lay.dispatch).length).toBe(2);
  expectExit(walls(REPO, lay, "escalate", lay.dispatch), 0);
  const esc = readFileSync(join(lay.dispatch, "ESCALATION.md"), "utf8");
  for (const pinned of [
    "stub",
    "mimo",
    CODEX_WALL_MESSAGE,
    "You’ve hit your usage limit for this key.",
    "no reset time",
  ]) {
    expect(esc).toContain(pinned);
  }
  const resetShown = /Reset: [0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}/u.test(esc);
  expect(resetShown).toBe(true);
  expect(esc.includes("go-on") || esc.includes("go on")).toBe(true);
  expect(existsSync(join(lay.dispatch, ".escalation-ready"))).toBe(true);
});

oracle("C14: no next leg while a wall has no ruling; dispatch resumes once ruled", (lay) => {
  const d = lay.dispatch;
  workhorseWall(lay, "c14", CODEX_WALL_MESSAGE);
  mimoHealthy(lay, d);
  pinTool(lay, d);
  validHandoff(d, "1");
  writeFileSync(join(d, ".leg-1-done"), "");
  writeFileSync(join(d, ".leg-1-exited"), "");
  expectExit(walls(REPO, lay, "told", d, "stub"), 0);
  expectExit(walls(REPO, lay, "open", d), 1);
  const callsBefore = join(lay.tmp, "calls-before");
  const held = watchTest(REPO, lay, callsBefore);
  expectExit(held, 0);
  expect(both(held)).toContain("needs T");
  expect(existsSync(join(callsBefore, "dispatch-T-2"))).toBe(false);
  const legBefore = JSON.parse(readFileSync(join(d, "manifest.json"), "utf8")) as { leg: number };
  expect(legBefore.leg).toBe(1);
  expectExit(walls(REPO, lay, "rule", d, "stub", "go-on"), 0);
  expectExit(walls(REPO, lay, "open", d), 0);
  const callsAfter = join(lay.tmp, "calls-after");
  const freed = watchTest(REPO, lay, callsAfter);
  expectExit(freed, 3);
  expect(both(freed).includes("needs ")).toBe(false);
  const callFile = join(callsAfter, "dispatch-T-2");
  expect(existsSync(callFile)).toBe(true);
  const call = readFileSync(callFile, "utf8");
  expect(call).toContain("kind=dispatch");
  expect(call).toContain("leg=review");
  const legAfter = JSON.parse(readFileSync(join(d, "manifest.json"), "utf8")) as { leg: number };
  expect(legAfter.leg).toBe(2);
});

oracle("C15: a ruling records before the pause, during it, and for a reviewer", (lay) => {
  // Before any pause: stub ruled first, which stands, since mimo's go-on is then
  // refused as last under C19.
  const d = lay.dispatch;
  workhorseWall(lay, "c15a", CODEX_WALL_MESSAGE);
  mimoWall(lay, "c15a");
  expectExit(walls(REPO, lay, "open", d), 1);
  expectExit(walls(REPO, lay, "rule", d, "stub", "go-on"), 0);
  expectExit(walls(REPO, lay, "rule", d, "mimo", "go-on"), 2);
  // During the pause: the same, after escalating first.
  const d2 = mkRun(lay, "T15b");
  setStub(lay, "codex", [codexThread("t-c15b"), codexWall(CODEX_WALL_MESSAGE)], 1);
  const wt2 = mkWt(lay, "wt-c15b");
  launchStep(REPO, lay, {
    lane: "stub",
    role: "lane",
    form: "launch",
    stream: "stub-events.jsonl",
    marker: "stub.done",
    cwd: wt2,
    dispatch: d2,
  });
  mimoWall(lay, "c15b", d2);
  expectExit(walls(REPO, lay, "escalate", d2), 0);
  expectExit(walls(REPO, lay, "open", d2), 1);
  expectExit(walls(REPO, lay, "rule", d2, "stub", "go-on"), 0);
  expectExit(walls(REPO, lay, "rule", d2, "mimo", "go-on"), 2);
  // A reviewer wall rules on its own.
  const d3 = mkRun(lay, "T15c");
  startRound(lay, d3, "1");
  setStub(lay, "claude", [claudeInit("s-c15c"), claudeWall()], 1);
  const { wt: secWt } = mkScratch(lay, "rev-c15c");
  launchStep(REPO, lay, {
    lane: "sec",
    role: "reviewer",
    form: "launch",
    stream: "review-r1-security-sec.jsonl",
    marker: "review-r1-security-sec.done",
    cwd: secWt,
    dispatch: d3,
  });
  expectExit(walls(REPO, lay, "open", d3), 1);
  expectExit(walls(REPO, lay, "rule", d3, "sec", "go-on"), 0);
  expectExit(walls(REPO, lay, "open", d3), 0);
});

oracle("C16: carried go-on runs no harness and shows the DEGRADED wording", (lay) => {
  const d = lay.dispatch;
  workhorseWall(lay, "c16a", CODEX_WALL_MESSAGE);
  setStub(
    lay,
    "mimo",
    [
      mimoStart("s-c16b"),
      mimoError("s-c16b", "ProviderError", "You’ve hit your usage limit for this key."),
    ],
    0,
  );
  const wt = mkWt(lay, "wt-c16b");
  launchStep(REPO, lay, {
    lane: "mimo",
    role: "lane",
    form: "launch",
    stream: "mimo-events.jsonl",
    marker: "mimo.done",
    cwd: wt,
  });
  startRound(lay, d, "1");
  setStub(lay, "claude", [claudeInit("s-c16c"), claudeWall()], 1);
  const { wt: secWt } = mkScratch(lay, "rev-c16c");
  launchStep(REPO, lay, {
    lane: "sec",
    role: "reviewer",
    form: "launch",
    stream: "review-r1-security-sec.jsonl",
    marker: "review-r1-security-sec.done",
    cwd: secWt,
  });
  expectExit(walls(REPO, lay, "rule", d, "stub", "go-on"), 0);
  expectExit(walls(REPO, lay, "rule", d, "sec", "go-on"), 0);
  const before = callCount(lay);
  expectExit(walls(REPO, lay, "carry", d, "stub"), 0);
  expectExit(walls(REPO, lay, "carry", d, "sec"), 0);
  expect(callCount(lay)).toBe(before);
  const shown = walls(REPO, lay, "show", d);
  expectExit(shown, 0);
  expect(shown.out).toContain(`stub: DEGRADED, provider wall: "${CODEX_WALL_MESSAGE}"`);
  expect(shown.out).toContain(`sec security: DEGRADED, provider wall: "${CLAUDE_WALL_MESSAGE}"`);
});

oracle("C18: a refused ruling records nothing and the run stays paused", (lay) => {
  const d = lay.dispatch;
  workhorseWall(lay, "c18a", CODEX_WALL_MESSAGE);
  setStub(
    lay,
    "mimo",
    [
      mimoStart("s-c18b"),
      mimoError("s-c18b", "ProviderError", "You’ve hit your usage limit for this key."),
    ],
    0,
  );
  const wt = mkWt(lay, "wt-c18b");
  launchStep(REPO, lay, {
    lane: "mimo",
    role: "lane",
    form: "launch",
    stream: "mimo-events.jsonl",
    marker: "mimo.done",
    cwd: wt,
  });
  expectExit(walls(REPO, lay, "escalate", d), 0);
  for (const ruling of ["rest", "reset-now", "substitute"]) {
    const r = walls(REPO, lay, "rule", d, "stub", ruling);
    expectExit(r, 2);
    expect(both(r).trim() === "").toBe(false);
    expectExit(walls(REPO, lay, "open", d), 1);
    expect(existsSync(join(d, ".escalation-ready"))).toBe(true);
  }
});

oracle("C19: go on is refused for the last workhorse that could still produce work", (lay) => {
  const d = lay.dispatch;
  workhorseWall(lay, "c19a", CODEX_WALL_MESSAGE);
  setStub(
    lay,
    "mimo",
    [
      mimoStart("s-c19b"),
      mimoError("s-c19b", "ProviderError", "You’ve hit your usage limit for this key."),
    ],
    0,
  );
  const wt = mkWt(lay, "wt-c19b");
  launchStep(REPO, lay, {
    lane: "mimo",
    role: "lane",
    form: "launch",
    stream: "mimo-events.jsonl",
    marker: "mimo.done",
    cwd: wt,
  });
  expectExit(walls(REPO, lay, "rule", d, "stub", "go-on"), 0);
  expectExit(walls(REPO, lay, "rule", d, "mimo", "go-on"), 2);
});

oracle("C19: go on is refused for a lone walled workhorse", (lay) => {
  const d = lay.dispatch;
  const runPath = join(d, "run.json");
  const runData = JSON.parse(readFileSync(runPath, "utf8")) as {
    config: { team: { workhorses: string[] } };
  };
  runData.config.team.workhorses = ["stub"];
  writeFileSync(runPath, `${JSON.stringify(runData, null, 2)}\n`);
  patchManifestLanes(d, { stub: { outcome: "approved" } });
  workhorseWall(lay, "c19solo", CODEX_WALL_MESSAGE);
  expectExit(walls(REPO, lay, "rule", d, "stub", "go-on"), 2);
});

oracle("C19: go on is accepted while another workhorse holds a summary", (lay) => {
  const d = lay.dispatch;
  mimoHealthy(lay, d);
  workhorseWall(lay, "c19sum", CODEX_WALL_MESSAGE);
  expectExit(walls(REPO, lay, "rule", d, "stub", "go-on"), 0);
});

oracle("C20: the watcher delivers a pause whose walls are all ruled", (lay) => {
  const d = lay.dispatch;
  workhorseWall(lay, "c20", CODEX_WALL_MESSAGE);
  mimoHealthy(lay, d);
  pinTool(lay, d);
  expectExit(walls(REPO, lay, "told", d, "stub"), 0);
  expectExit(walls(REPO, lay, "escalate", d), 0);
  expectExit(walls(REPO, lay, "rule", d, "stub", "go-on"), 0);
  expectExit(walls(REPO, lay, "open", d), 0);
  expect(existsSync(join(d, ".waiting-on-user"))).toBe(false);
  writeFileSync(
    join(d, "logs", "coachman-leg-1-attempts.jsonl"),
    `{"attempt":1,"leg":"1","name":"synthesis","request":"launch","role":"coachman","prompt":"${join(d, "leg-1-prompt.txt")}","thread_id":"T-oracle-1","outcome":"incomplete","on_answer":"none","backfilled":false}\n`,
  );
  const callsDir = join(lay.tmp, "calls-deliver");
  watchTest(REPO, lay, callsDir);
  const files = readdirSync(callsDir);
  expect(files).toEqual(["resume-T-1"]);
  const call = readFileSync(join(callsDir, "resume-T-1"), "utf8");
  expect(call).toContain("kind=resume");
  expect(call).toContain("thread=T-oracle-1");
  const promptLine = call.split("\n").find((l) => l.startsWith("prompt="));
  if (!promptLine) throw new Error(`no prompt in the resume call:\n${call}`);
  const promptText = readFileSync(promptLine.slice("prompt=".length), "utf8");
  expect(promptText).toContain("stub");
  expect(promptText.includes("go-on") || promptText.includes("go on")).toBe(true);
  const actions = readFileSync(join(d, "actions.jsonl"), "utf8");
  expect(actions).toContain("the watcher took it");
});

oracle("C21: a second wall needs a new ruling before landing", (lay) => {
  const d = lay.dispatch;
  startRound(lay, d, "1");
  setStub(lay, "claude", [claudeInit("s-c21a"), claudeWall()], 1);
  const { wt: wt1 } = mkScratch(lay, "rev-c21a");
  launchStep(REPO, lay, {
    lane: "sec",
    role: "reviewer",
    form: "launch",
    stream: "review-r1-security-sec.jsonl",
    marker: "review-r1-security-sec.done",
    cwd: wt1,
  });
  expectExit(walls(REPO, lay, "told", d, "sec"), 0);
  expectExit(walls(REPO, lay, "rule", d, "sec", "go-on"), 0);
  expectExit(walls(REPO, lay, "open", d), 0);
  startRound(lay, d, "2");
  setStub(lay, "claude", [claudeInit("s-c21b"), claudeWall()], 1);
  const { wt: wt2 } = mkScratch(lay, "rev-c21b");
  launchStep(REPO, lay, {
    lane: "sec",
    role: "reviewer",
    form: "launch",
    stream: "review-r2-security-sec.jsonl",
    marker: "review-r2-security-sec.done",
    cwd: wt2,
  });
  const secWalls = wallLines(d).filter((l) => lineBody(l).includes("sec"));
  expect(secWalls.length).toBe(2);
  expect(secWalls.some((l) => roundOk(lineBody(l), "1"))).toBe(true);
  expect(secWalls.some((l) => roundOk(lineBody(l), "2"))).toBe(true);
  expect(nextOf(REPO, lay, "T")).toBe("WALL");
  expectExit(walls(REPO, lay, "open", d), 1);
});

oracle("C22 scripts: skill refs hold, the walls join the quote corpus and the contract", (lay) => {
  expectExit(sh(join(SCRIPTS, "run"), ["skill-refs"], lay.env, lay.tmp), 0);
  const quotes = sh(join(SCRIPTS, "run"), ["launch", "wall-quotes"], lay.env, lay.tmp);
  need(quotes, "wall-quotes");
  expect(quotes.out).toContain(CODEX_WALL_MESSAGE);
  expect(quotes.out).toContain(CLAUDE_WALL_MESSAGE);
  const contract = readFileSync(join(REPO, "docs", "coachman-contract.toml"), "utf8");
  expect(contract).toContain("walls");
});
