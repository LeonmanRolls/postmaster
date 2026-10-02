// Tests beside scripts/review-findings.ts, moved from its --self-test on #109: 94 controls.
// The self-test ran its controls in one shared temp tree; fixtures are built here in beforeAll
// and each test uses its own fixture names, so every test passes alone as well as in file
// order. Loop labels repeat across iterations, as the ok lines did.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { toolRoot } from "./lib/paths.ts";
import { run } from "./lib/proc.ts";
import { pyTrim } from "./lib/text.ts";
import {
  errMsg,
  FOR_LOOP,
  harvest,
  isObj,
  isReportError,
  SH_BLOCKS,
  SUPPORTED,
} from "./review-findings.ts";

const SELF = join(import.meta.dir, "review-findings.sh");
const TOOL = toolRoot(import.meta);

let root = "";
let scratch = "";
let logs = "";
let taskHome = "";
let external = "";

const claudeResult =
  '[{"file":"src/page.js","line":8,"summary":"Page includes one extra item","category":"correctness"}]\nA sentence that is not a finding.';

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "postmaster-"));
  scratch = join(root, "scratch");
  mkdirSync(join(scratch, "src"), { recursive: true });
  logs = join(root, "logs");
  taskHome = join(`/tmp/claude-${process.getuid?.() ?? 0}`, `postmaster-test-${process.pid}`);
  mkdirSync(taskHome, { recursive: true });
  external = join(taskHome, "claude-task-output.txt");
  writeFileSync(external, "review task tools\n");
});

afterAll(() => {
  try {
    rmSync(taskHome, { recursive: true, force: true });
  } catch {
    // cleanup is best-effort
  }
  rmSync(root, { recursive: true, force: true });
});

const runConfig = (name: string, harness: string): string => {
  const folder = join(root, name);
  mkdirSync(folder, { recursive: true });
  writeFileSync(`${folder}/run.json`, JSON.stringify({ config: { lanes: { one: { harness } } } }));
  return folder;
};

const cli = (...args: string[]): { code: number; out: string; err: string } => run(SELF, args);

const writeEvents = (name: string, events: unknown[]): string => {
  const eventFile = join(root, name);
  writeFileSync(eventFile, `${events.map((e) => JSON.stringify(e)).join("\n")}\n`);
  return eventFile;
};

const parsed = (r: { code: number; out: string }): Array<Record<string, unknown>> =>
  JSON.parse(r.out) as Array<Record<string, unknown>>;

describe("recorded reports", () => {
  const eventsFor = (harness: string): unknown[] => {
    if (harness === "claude") {
      return [
        { type: "system", subtype: "task_notification", output_file: external },
        { type: "result", subtype: "success", result: claudeResult },
      ];
    }
    if (harness === "codex") return [{ type: "turn.completed" }];
    return [
      {
        type: "text",
        sessionID: "ses_1",
        part: {
          type: "text",
          text: "### Bug — \\`src/page.js:8\\`: Page includes one extra item\n\nThe exclusive end repeats the boundary record.\n\n### No other issues found.",
        },
      },
    ];
  };

  for (const harness of ["claude", "codex", "mimo"]) {
    test(`${harness} recorded finding is normalized at its file and line`, () => {
      const events = eventsFor(harness);
      const folder = runConfig(harness, harness);
      const eventFile = writeEvents(`${harness}.events`, events);
      const args = ["normalize", "one", scratch, eventFile, "--run", folder];
      if (harness === "codex") {
        const last = join(root, "codex.last");
        writeFileSync(
          last,
          `- [P1] Page includes one extra item — ${scratch}/src/page.js:8-8\n\nReview comment:\n\n- [P1] Page includes one extra item — ${scratch}/src/page.js:8-8\n  \\\`slice\\\` uses an exclusive end index.\n`,
        );
        args.push("--last", last);
      }
      const r = cli(...args);
      const found = parsed(r);
      const finding = found[0]!;
      expect(r.code).toBe(0);
      expect(found.length).toBe(1);
      expect(finding["file"]).toBe("src/page.js");
      expect(finding["line"]).toBe(8);
      expect(finding["target"]).toBe("src/page.js:8");
      if (harness === "codex") {
        expect(finding["severity"]).toBe("P1");
        expect(String(finding["body"]).includes("exclusive end index")).toBe(true);
      }
      if (harness === "claude") {
        expect(finding["severity"]).toBe("not provided");
        expect(finding["category"]).toBe("correctness");
      }
      if (harness === "mimo") {
        expect(String(finding["body"]).includes("boundary record")).toBe(true);
      }
    });
  }

  const emptyText: Array<[string, unknown]> = [
    ["claude", { type: "result", subtype: "success", result: "[]" }],
    ["codex", null],
    ["mimo", { type: "text", part: { type: "text", text: "No findings." } }],
  ];

  for (const [harness, event] of emptyText) {
    test(`${harness} recorded empty report yields no findings`, () => {
      const folder = runConfig(`${harness}-empty`, harness);
      const eventFile = writeEvents(`${harness}-empty.events`, [
        event ?? { type: "turn.completed" },
      ]);
      const args = ["normalize", "one", scratch, eventFile, "--run", folder];
      if (harness === "codex") {
        const last = join(root, "codex-empty.last");
        writeFileSync(last, "No findings.\n");
        args.push("--last", last);
      }
      const r = cli(...args);
      expect(r.code).toBe(0);
      expect(pyTrim(r.out)).toBe("[]");
    });
  }
});

describe("separator characters inside JSON strings", () => {
  // A stream of JSON lines splits on the newline character alone: U+2028,
  // U+2029, CR, VT and FF inside a JSON string are content, not breaks.
  const lsep = String.fromCharCode(0x2028);
  const psep = String.fromCharCode(0x2029);
  const separatorsFile = (): string => {
    const noise = `noise${lsep}${psep}\r\v\fend`;
    const evt = {
      type: "text",
      sessionID: "ses_1",
      part: {
        type: "text",
        text: `${noise}\n### Bug — \`src/page.js:8\`: Page includes one extra item\n\nThe exclusive end repeats the boundary record.\n`,
      },
    };
    // JSON.stringify writes the two separators raw, as the reference file holds them.
    const line = JSON.stringify(evt);
    const separators = join(root, "mimo-separators.events");
    writeFileSync(separators, `${line}\n`);
    return separators;
  };

  test("a stream holding U+2028, U+2029, CR, VT and FF inside a JSON string harvests as valid", () => {
    const harvested = cli("harvest", separatorsFile(), logs, "--prefix", "separators");
    expect(harvested.code).toBe(0);
  });

  test("and it normalizes to its finding", () => {
    const r = cli(
      "normalize",
      "one",
      scratch,
      separatorsFile(),
      "--run",
      runConfig("separators", "mimo"),
    );
    const found = parsed(r);
    expect(r.code).toBe(0);
    expect(found.length).toBe(1);
    expect(found[0]!["file"]).toBe("src/page.js");
    expect(found[0]!["line"]).toBe(8);
  });

  test("a stream with a genuinely broken line is still refused", () => {
    const broken = join(root, "broken.events");
    writeFileSync(
      broken,
      `${JSON.stringify({ type: "text", part: { type: "text", text: "No findings." } })}\n{"type": "text", "part": "broken\n`,
    );
    const refused = cli("harvest", broken, logs, "--prefix", "broken");
    expect(refused.code).toBe(1);
    expect(refused.err).toContain("is not JSON");
  });
});

describe("fences", () => {
  test("claude fenced JSON array is read as findings", () => {
    const fenced = writeEvents("claude-fenced.events", [
      {
        type: "result",
        subtype: "success",
        result:
          'Nine findings remain.\n\n```json\n[{"file": "src/page.js", "line": 8, "summary": "Off-by-one in slice"}]\n```\n',
      },
    ]);
    const r = cli("normalize", "one", scratch, fenced, "--run", runConfig("fenced", "claude"));
    const found = parsed(r);
    expect(r.code).toBe(0);
    expect(found.length).toBe(1);
    expect(found[0]!["file"]).toBe("src/page.js");
    expect(found[0]!["line"]).toBe(8);
  });

  test("a fenced snippet inside evidence normalizes byte for byte", () => {
    const evidenceText = "```js\nx\n```";
    const innerFence = writeEvents("claude-inner-fence.events", [
      {
        type: "result",
        subtype: "success",
        result: JSON.stringify([
          { file: "src/a.js", line: 1, summary: "s", evidence: evidenceText },
        ]),
      },
    ]);
    const r = cli(
      "normalize",
      "one",
      scratch,
      innerFence,
      "--run",
      runConfig("inner-fence", "claude"),
    );
    const found = parsed(r);
    expect(r.code).toBe(0);
    expect(found.length).toBe(1);
    expect(found[0]!["evidence"]).toBe(evidenceText);
  });

  test("a report wrapped in one fence still parses", () => {
    const wrapped = writeEvents("claude-wrapped.events", [
      {
        type: "result",
        subtype: "success",
        result:
          "```json\n" + JSON.stringify([{ file: "src/a.js", line: 1, summary: "s" }]) + "\n```\n",
      },
    ]);
    const r = cli("normalize", "one", scratch, wrapped, "--run", runConfig("wrapped", "claude"));
    const found = parsed(r);
    expect(r.code).toBe(0);
    expect(found.length).toBe(1);
    expect(found[0]!["file"]).toBe("src/a.js");
  });
});

describe("failure scenarios", () => {
  test("an item with summary and failure_scenario normalizes with that scenario as its body", () => {
    const scenario = "Store holds r0..r9; page(1, 3) returns 4 items.";
    const scenarioEvents = writeEvents("claude-scenario.events", [
      {
        type: "result",
        subtype: "success",
        result: JSON.stringify([
          { file: "src/a.js", line: 1, summary: "Off by one", failure_scenario: scenario },
        ]),
      },
    ]);
    const r = cli(
      "normalize",
      "one",
      scratch,
      scenarioEvents,
      "--run",
      runConfig("scenario", "claude"),
    );
    const found = parsed(r);
    expect(r.code).toBe(0);
    expect(found.length).toBe(1);
    expect(found[0]!["body"]).toBe(scenario);
  });
});

describe("clean verdicts fail loudly", () => {
  test("a clean verdict in longer prose fails loudly", () => {
    const proseClean = writeEvents("mimo-prose.events", [
      {
        type: "text",
        part: {
          type: "text",
          text: "Nothing to review. The worktree has no uncommitted changes.\n",
        },
      },
    ]);
    const r = cli("normalize", "one", scratch, proseClean, "--run", runConfig("prose", "mimo"));
    expect(r.code).toBe(1);
    expect(r.err.includes("cannot parse review output")).toBe(true);
  });

  test("a clean phrase beside a finding marker still fails loudly", () => {
    const guarded = writeEvents("codex-guarded.events", [{ type: "turn.completed" }]);
    const guardedLast = join(root, "codex-guarded.last");
    writeFileSync(
      guardedLast,
      "No problems found in the files I read.\n- [P1] Something is wrong somewhere\n",
    );
    const r = cli(
      "normalize",
      "one",
      scratch,
      guarded,
      "--run",
      runConfig("guarded", "codex"),
      "--last",
      guardedLast,
    );
    expect(r.code).toBe(1);
    expect(r.err.includes("cannot parse review output")).toBe(true);
  });

  test("a stale clean --last beside a failed turn fails loudly, never clean", () => {
    const staleClean = join(root, "codex-stale.last");
    writeFileSync(staleClean, "No findings.\n");
    const failedTurn = writeEvents("codex-failed.events", [
      { type: "thread.started" },
      { type: "turn.started" },
      { type: "turn.failed", error: { message: "provider wall" } },
    ]);
    const r = cli(
      "normalize",
      "one",
      scratch,
      failedTurn,
      "--run",
      runConfig("failed-turn", "codex"),
      "--last",
      staleClean,
    );
    expect(r.code).toBe(1);
    expect(r.err.includes("turn failed")).toBe(true);
  });

  test("a clean --last with no completed turn fails loudly, never clean", () => {
    const staleClean = join(root, "codex-stale.last");
    writeFileSync(staleClean, "No findings.\n");
    const noTurn = writeEvents("codex-noturn.events", [
      { type: "thread.started" },
      { type: "turn.started" },
    ]);
    const r = cli(
      "normalize",
      "one",
      scratch,
      noTurn,
      "--run",
      runConfig("no-turn", "codex"),
      "--last",
      staleClean,
    );
    expect(r.code).toBe(1);
    expect(r.err.includes("no completed turn")).toBe(true);
  });

  for (const harness of SUPPORTED) {
    test(`${harness} unrecognized report fails instead of becoming clean`, () => {
      const folder = runConfig(`bad-${harness}`, harness);
      const report = "Maybe everything looks fine.";
      const event =
        harness === "claude"
          ? { type: "result", subtype: "success", result: report }
          : harness === "mimo"
            ? { type: "text", part: { type: "text", text: report } }
            : { type: "turn.completed" };
      const eventFile = writeEvents(`bad-${harness}.events`, [event]);
      const args = ["normalize", "one", scratch, eventFile, "--run", folder];
      if (harness === "codex") {
        const last = join(root, "bad-codex.last");
        writeFileSync(last, "Maybe everything looks fine.\n");
        args.push("--last", last);
      }
      const r = cli(...args);
      expect(r.code).toBe(1);
      expect(r.err.includes("cannot parse review output")).toBe(true);
    });
  }
});

describe("harvest", () => {
  test("Claude task_notification transcript is copied into run logs", () => {
    const harvestEvents = writeEvents("harvest.events", [
      { type: "system", subtype: "task_notification", output_file: external },
    ]);
    const r = cli("harvest", harvestEvents, logs, "--prefix", "r1-bug-one");
    const copied = join(logs, `r1-bug-one-claude-task-01-${basename(external)}`);
    expect(r.code).toBe(0);
    expect(existsSync(copied)).toBe(true);
    expect(readFileSync(copied, "utf8").includes("review task tools")).toBe(true);
  });

  test("a missing task file fails before anything is copied", () => {
    const partial = writeEvents("harvest-partial.events", [
      { type: "system", subtype: "task_notification", output_file: external },
      { type: "system", subtype: "task_notification", output_file: join(taskHome, "absent.txt") },
    ]);
    const partialLogs = join(root, "logs-partial");
    const r = cli("harvest", partial, partialLogs, "--prefix", "partial");
    expect(r.code).toBe(1);
    expect(r.err.includes("missing")).toBe(true);
    expect(readdirSync(partialLogs).length).toBe(0);
  });

  test("an identical re-harvest is a no-op", () => {
    const one = writeEvents("harvest-one.events", [
      { type: "system", subtype: "task_notification", output_file: external },
    ]);
    const retryLogs = join(root, "logs-retry");
    const first = cli("harvest", one, retryLogs, "--prefix", "retry");
    const again = cli("harvest", one, retryLogs, "--prefix", "retry");
    expect(first.code).toBe(0);
    expect(again.code).toBe(0);
    expect(again.out).toBe(first.out);
  });

  test("a re-harvest over different content still refuses", () => {
    const one = writeEvents("harvest-one.events", [
      { type: "system", subtype: "task_notification", output_file: external },
    ]);
    const retryLogs = join(root, "logs-retry");
    cli("harvest", one, retryLogs, "--prefix", "retry");
    writeFileSync(join(retryLogs, `retry-claude-task-01-${basename(external)}`), "changed\n");
    const clobber = cli("harvest", one, retryLogs, "--prefix", "retry");
    expect(clobber.code).toBe(1);
    expect(clobber.err.includes("refusing to overwrite")).toBe(true);
  });

  const negatives: Array<[string, unknown, string]> = [
    [
      "a task_notification without an output file fails",
      { type: "system", subtype: "task_notification" },
      "names no output file",
    ],
    [
      "a task_notification with an empty output file fails",
      { type: "system", subtype: "task_notification", output_file: "" },
      "names no output file",
    ],
    [
      "a task_notification with a non-text output file fails",
      { type: "system", subtype: "task_notification", output_file: 7 },
      "not text",
    ],
    [
      "a task_notification naming a missing file fails",
      { type: "system", subtype: "task_notification", output_file: join(taskHome, "absent.txt") },
      "missing",
    ],
  ];

  // The cases are fixed at file load, but taskHome is set in beforeAll: rebuild the one
  // notification that names it when its test runs.
  negatives.forEach(([label, notification, message], number) => {
    test(label, () => {
      const note =
        number === 3
          ? {
              type: "system",
              subtype: "task_notification",
              output_file: join(taskHome, "absent.txt"),
            }
          : notification;
      const events = writeEvents(`harvest-neg-${number}.events`, [note]);
      const r = cli("harvest", events, logs, "--prefix", "neg");
      expect(r.code).toBe(1);
      expect(r.err.includes(message)).toBe(true);
    });
  });

  test("a task_notification naming a file outside the task tree fails", () => {
    const outside = join(root, "outside-task-output.txt");
    writeFileSync(outside, "not a task file\n");
    const tree = join(root, "task-tree");
    mkdirSync(tree, { recursive: true });
    const outsideEvents = writeEvents("harvest-outside.events", [
      { type: "system", subtype: "task_notification", output_file: outside },
    ]);
    let threw: unknown = null;
    try {
      harvest(outsideEvents, join(root, "logs-outside"), "outside", tree);
    } catch (e) {
      threw = e;
    }
    expect(isReportError(threw)).toBe(true);
    expect(errMsg(threw).includes("outside")).toBe(true);
  });

  test("a file inside the default root but outside the named root still fails", () => {
    const inner = join(taskHome, "inner-task-output.txt");
    writeFileSync(inner, "inside the default root\n");
    const tree = join(root, "task-tree");
    mkdirSync(tree, { recursive: true });
    const innerEvents = writeEvents("harvest-inner.events", [
      { type: "system", subtype: "task_notification", output_file: inner },
    ]);
    let threw: unknown = null;
    try {
      harvest(innerEvents, join(root, "logs-inner"), "inner", tree);
    } catch (e) {
      threw = e;
    }
    expect(isReportError(threw)).toBe(true);
    expect(errMsg(threw).includes("outside")).toBe(true);
  });

  test("a stream with no task_notification harvests nothing and exits 0", () => {
    const quiet = writeEvents("harvest-quiet.events", [{ type: "turn.completed" }]);
    const r = cli("harvest", quiet, logs, "--prefix", "quiet");
    expect(r.code).toBe(0);
    expect(r.out).toBe("");
  });
});

describe("degrade", () => {
  test("a lane whose task file is missing ends DEGRADED with no findings JSON", () => {
    const degradeEvents = writeEvents("degrade.events", [
      { type: "system", subtype: "task_notification", output_file: join(taskHome, "absent.txt") },
      { type: "result", subtype: "success", result: "[]" },
    ]);
    const degradeHarvest = cli(
      "harvest",
      degradeEvents,
      join(root, "logs-degrade"),
      "--prefix",
      "degrade",
    );
    const degradeJson = join(root, "logs-degrade-findings.json");
    rmSync(degradeJson, { force: true });
    if (degradeHarvest.code === 0) {
      const passed = cli(
        "normalize",
        "one",
        scratch,
        degradeEvents,
        "--run",
        runConfig("degrade", "claude"),
      );
      if (passed.code === 0) writeFileSync(degradeJson, passed.out);
    }
    expect(degradeHarvest.code).toBe(1);
    expect(degradeHarvest.err.includes("missing")).toBe(true);
    expect(existsSync(degradeJson)).toBe(false);
  });

  test("the same stream still normalizes, so skipping it is what keeps the verdict uncounted", () => {
    const degradeEvents = writeEvents("degrade.events", [
      { type: "system", subtype: "task_notification", output_file: join(taskHome, "absent.txt") },
      { type: "result", subtype: "success", result: "[]" },
    ]);
    const skipped = cli(
      "normalize",
      "one",
      scratch,
      degradeEvents,
      "--run",
      runConfig("degrade-skip", "claude"),
    );
    expect(skipped.code).toBe(0);
    expect(pyTrim(skipped.out)).toBe("[]");
  });

  test("the same stream with the file present harvests and normalizes to its finding", () => {
    const presentEvents = writeEvents("degrade-present.events", [
      { type: "system", subtype: "task_notification", output_file: external },
      { type: "result", subtype: "success", result: claudeResult },
    ]);
    const presentHarvest = cli(
      "harvest",
      presentEvents,
      join(root, "logs-degrade-present"),
      "--prefix",
      "present",
    );
    const presentJson = join(root, "logs-degrade-present-findings.json");
    rmSync(presentJson, { force: true });
    if (presentHarvest.code === 0) {
      const present = cli(
        "normalize",
        "one",
        scratch,
        presentEvents,
        "--run",
        runConfig("degrade-present", "claude"),
      );
      if (present.code === 0) writeFileSync(presentJson, present.out);
    }
    const found = JSON.parse(readFileSync(presentJson, "utf8")) as Array<Record<string, unknown>>;
    expect(presentHarvest.code).toBe(0);
    expect(found.length).toBe(1);
    expect(found[0]!["file"]).toBe("src/page.js");
    expect(found[0]!["line"]).toBe(8);
  });

  test("executing the sample on the missing-file fixture writes both lines", () => {
    const coachman = readFileSync(join(TOOL, "skills", "postmaster", "coachman.md"), "utf8");
    const blocks = [...coachman.matchAll(SH_BLOCKS)].map((m) => m[1]!);
    const samples = blocks.filter(
      (block) => block.includes('NORMALIZE_FAILED=""') && block.includes("HARVEST_ERR"),
    );
    expect(samples.length).toBe(1);
    const sampleDispatch = join(root, "sample-dispatch");
    mkdirSync(join(sampleDispatch, "logs"), { recursive: true });
    writeFileSync(
      join(sampleDispatch, "logs", "review-r9-bug-one.jsonl"),
      JSON.stringify({
        type: "system",
        subtype: "task_notification",
        output_file: join(taskHome, "absent.txt"),
      }) +
        "\n" +
        JSON.stringify({ type: "result", subtype: "success", result: "[]" }) +
        "\n",
    );
    let sample = samples[0]!.split("<tool>").join(TOOL);
    sample = sample.split("<dispatch>").join(sampleDispatch).split("<repo>").join(root);
    sample = sample.split("<TICKET>").join("T").split("<round>").join("9");
    sample = sample.replace(FOR_LOOP, "for L in one; do");
    sample = sample.split(`DEST=${root}/.worktrees/T-rev-bug-$L`).join(`DEST=${scratch}`);
    writeFileSync(join(root, "sample.sh"), sample);
    const ran = run("bash", [join(root, "sample.sh")]);
    const logged: unknown[] = [];
    if (existsSync(join(sampleDispatch, "actions.jsonl"))) {
      for (const raw of readFileSync(join(sampleDispatch, "actions.jsonl"), "utf8").split("\n")) {
        try {
          logged.push(JSON.parse(raw) as unknown);
        } catch {
          // a non-JSON line is not a logged action
        }
      }
    }
    const degraded = logged.filter(
      (entry) => isObj(entry) && entry["action"] === "degrade" && entry["target"] === "one",
    );
    const narrative = existsSync(join(sampleDispatch, "run-log.md"))
      ? readFileSync(join(sampleDispatch, "run-log.md"), "utf8")
      : "";
    expect(ran.code).toBe(0);
    expect(degraded.length).toBe(1);
    expect(narrative.includes("one bug: DEGRADED,")).toBe(true);
  }, 60000);
});

describe("JSON lists", () => {
  test("an empty JSON list before findings does not read as clean", () => {
    const emptyFirst = writeEvents("claude-empty-first.events", [
      {
        type: "result",
        subtype: "success",
        result: '[]\n[{"file": "src/page.js", "line": 8, "summary": "bug"}]',
      },
    ]);
    const r = cli(
      "normalize",
      "one",
      scratch,
      emptyFirst,
      "--run",
      runConfig("empty-first", "claude"),
    );
    const found = parsed(r);
    expect(r.code).toBe(0);
    expect(found.length).toBe(1);
    expect(found[0]!["file"]).toBe("src/page.js");
    expect(found[0]!["line"]).toBe(8);
  });

  test("two non-empty JSON lists fail loudly", () => {
    const ambiguous = writeEvents("claude-ambiguous.events", [
      {
        type: "result",
        subtype: "success",
        result:
          '[{"file": "src/a.js", "line": 1, "summary": "one"}]\n[{"file": "src/b.js", "line": 2, "summary": "two"}]',
      },
    ]);
    const r = cli(
      "normalize",
      "one",
      scratch,
      ambiguous,
      "--run",
      runConfig("ambiguous", "claude"),
    );
    expect(r.code).toBe(1);
    expect(r.err.includes("JSON finding lists")).toBe(true);
  });

  test("an incidental scalar list does not hide the findings", () => {
    const scalarFirst = writeEvents("claude-scalar-first.events", [
      {
        type: "result",
        subtype: "success",
        result: 'Counts [1, 2, 3] aside.\n[{"file": "src/page.js", "line": 8, "summary": "bug"}]',
      },
    ]);
    const r = cli(
      "normalize",
      "one",
      scratch,
      scalarFirst,
      "--run",
      runConfig("scalar-first", "claude"),
    );
    const found = parsed(r);
    expect(r.code).toBe(0);
    expect(found.length).toBe(1);
    expect(found[0]!["file"]).toBe("src/page.js");
  });

  test("a bad item names its index when the batch fails", () => {
    const mixed = writeEvents("claude-mixed.events", [
      {
        type: "result",
        subtype: "success",
        result:
          '[{"file": "src/a.js", "line": 1, "summary": "good"}, {"summary": "no file"}, {"file": "src/b.js", "line": 2, "summary": "good"}]',
      },
    ]);
    const r = cli("normalize", "one", scratch, mixed, "--run", runConfig("mixed", "claude"));
    expect(r.code).toBe(1);
    expect(r.err.includes("finding 1")).toBe(true);
  });

  test("an empty findings list does not win over a real issues list", () => {
    const dictEmptyFirst = writeEvents("claude-dict-empty-first.events", [
      {
        type: "result",
        subtype: "success",
        result:
          '{"findings": [], "issues": [{"file": "src/page.js", "line": 8, "summary": "bug"}]}',
      },
    ]);
    const r = cli(
      "normalize",
      "one",
      scratch,
      dictEmptyFirst,
      "--run",
      runConfig("dict-empty-first", "claude"),
    );
    const found = parsed(r);
    expect(r.code).toBe(0);
    expect(found.length).toBe(1);
    expect(found[0]!["file"]).toBe("src/page.js");
  });

  test("two populated dict lists fail loudly", () => {
    const dictTwoFull = writeEvents("claude-dict-two-full.events", [
      {
        type: "result",
        subtype: "success",
        result:
          '{"findings": [{"file": "src/a.js", "line": 1, "summary": "one"}], "issues": [{"file": "src/b.js", "line": 2, "summary": "two"}]}',
      },
    ]);
    const r = cli(
      "normalize",
      "one",
      scratch,
      dictTwoFull,
      "--run",
      runConfig("dict-two-full", "claude"),
    );
    expect(r.code).toBe(1);
    expect(r.err.includes("JSON finding lists")).toBe(true);
  });

  test("a whole report of only empty lists stays clean", () => {
    const dictEmptyOnly = writeEvents("claude-dict-empty-only.events", [
      { type: "result", subtype: "success", result: '{"findings": []}' },
    ]);
    const r = cli(
      "normalize",
      "one",
      scratch,
      dictEmptyOnly,
      "--run",
      runConfig("dict-empty-only", "claude"),
    );
    expect(r.code).toBe(0);
    expect(pyTrim(r.out)).toBe("[]");
  });

  test("a findings list of strings fails closed", () => {
    const strList = writeEvents("claude-str-list.events", [
      { type: "result", subtype: "success", result: '{"findings": ["bug at src/a.js:1"]}' },
    ]);
    const r = cli("normalize", "one", scratch, strList, "--run", runConfig("str-list", "claude"));
    expect(r.code).toBe(1);
  });

  test("a findings list of nulls fails closed", () => {
    const nullList = writeEvents("claude-null-list.events", [
      { type: "result", subtype: "success", result: '{"findings": [null, null]}' },
    ]);
    const r = cli("normalize", "one", scratch, nullList, "--run", runConfig("null-list", "claude"));
    expect(r.code).toBe(1);
  });

  test("a findings list mixing an object with junk fails closed", () => {
    const mixedList = writeEvents("claude-mixed-list.events", [
      {
        type: "result",
        subtype: "success",
        result: '{"issues": [{"file": "src/a.js", "line": 1, "summary": "one"}, "junk"]}',
      },
    ]);
    const r = cli(
      "normalize",
      "one",
      scratch,
      mixedList,
      "--run",
      runConfig("mixed-list", "claude"),
    );
    expect(r.code).toBe(1);
  });

  test("an empty declared list does not block an undeclared findings list", () => {
    const undeclared = writeEvents("claude-undeclared.events", [
      {
        type: "result",
        subtype: "success",
        result:
          '{"findings": [], "bugs": [{"file": "src/a.js", "line": 1, "summary": "off by one"}]}',
      },
    ]);
    const r = cli(
      "normalize",
      "one",
      scratch,
      undeclared,
      "--run",
      runConfig("undeclared", "claude"),
    );
    const found = parsed(r);
    expect(r.code).toBe(0);
    expect(found.length).toBe(1);
    expect(found[0]!["target"]).toBe("src/a.js:1");
  });

  test("a malformed list beside a valid one fails loudly", () => {
    const malformedBeside = writeEvents("claude-malformed-beside.events", [
      {
        type: "result",
        subtype: "success",
        result:
          '{"findings": ["unparsed bug at src/page.js:8"], "issues": [{"file": "src/a.js", "line": 1, "summary": "other"}]}',
      },
    ]);
    const r = cli(
      "normalize",
      "one",
      scratch,
      malformedBeside,
      "--run",
      runConfig("malformed-beside", "claude"),
    );
    expect(r.code).toBe(1);
    expect(r.err.includes("hold no objects")).toBe(true);
  });

  test("a locationless malformed list beside a valid one fails loudly", () => {
    const locationless = writeEvents("claude-locationless.events", [
      {
        type: "result",
        subtype: "success",
        result:
          '{"findings": ["no locations here"], "issues": [{"file": "src/a.js", "line": 1, "summary": "s"}]}',
      },
    ]);
    const r = cli(
      "normalize",
      "one",
      scratch,
      locationless,
      "--run",
      runConfig("locationless", "claude"),
    );
    expect(r.code).toBe(1);
    expect(r.err.includes("hold no objects")).toBe(true);
  });
});

describe("mimo reports", () => {
  test("a clean verdict mentioning a time fails loudly", () => {
    const timed = writeEvents("mimo-timed.events", [
      { type: "text", part: { type: "text", text: "No findings. Checked at 12:30." } },
    ]);
    const r = cli("normalize", "one", scratch, timed, "--run", runConfig("timed", "mimo"));
    expect(r.code).toBe(1);
    expect(r.err.includes("cannot parse review output")).toBe(true);
  });

  test("a fenced block after a finding is kept as its evidence", () => {
    const fencedEvidence = writeEvents("mimo-fenced-evidence.events", [
      {
        type: "text",
        part: {
          type: "text",
          text: "### Bug — `src/page.js:8`: off by one\n\n```js\nreturn all().slice(start, start + size + 1);\n```\n\nThe exclusive end repeats the boundary record.\n",
        },
      },
    ]);
    const r = cli(
      "normalize",
      "one",
      scratch,
      fencedEvidence,
      "--run",
      runConfig("fenced-evidence", "mimo"),
    );
    const found = parsed(r);
    expect(r.code).toBe(0);
    expect(found.length).toBe(1);
    expect(String(found[0]!["evidence"]).includes("slice(start, start + size")).toBe(true);
    expect(String(found[0]!["body"]).includes("boundary record")).toBe(true);
  });

  test("an extensionless file with a line is a finding", () => {
    const makefile = writeEvents("mimo-makefile.events", [
      {
        type: "text",
        part: {
          type: "text",
          text: "### Build\n- Check `Makefile:8`: the clean target removes the wrong dir.\n",
        },
      },
    ]);
    const r = cli("normalize", "one", scratch, makefile, "--run", runConfig("makefile", "mimo"));
    const found = parsed(r);
    expect(r.code).toBe(0);
    expect(found.length).toBe(1);
    expect(found[0]!["file"]).toBe("Makefile");
    expect(found[0]!["line"]).toBe(8);
  });

  test("an unclosed fence fails loudly", () => {
    const unclosed = writeEvents("mimo-unclosed.events", [
      {
        type: "text",
        part: {
          type: "text",
          text: "### Bug one `src/page.js:8`\n```js\nreturn all().slice(start, start + size + 1);\n\n### Bug two `src/count.js:6`\nSomething else is wrong.\n",
        },
      },
    ]);
    const r = cli("normalize", "one", scratch, unclosed, "--run", runConfig("unclosed", "mimo"));
    expect(r.code).toBe(1);
    expect(r.err.includes("unclosed code fence")).toBe(true);
  });

  test("a location cited under Not issues is not a finding", () => {
    const notissues = writeEvents("mimo-notissues.events", [
      {
        type: "text",
        part: {
          type: "text",
          text: "### Not issues\n- Validation is fine — `src/count.js:6`: empty stores yield zero pages, which is correct.\n\nNo issues found.\n",
        },
      },
    ]);
    const r = cli("normalize", "one", scratch, notissues, "--run", runConfig("notissues", "mimo"));
    expect(r.code).toBe(1);
    expect(r.err.includes("cannot parse review output")).toBe(true);
  });

  test("findings outside Not issues still parse", () => {
    const notissuesResume = writeEvents("mimo-notissues-resume.events", [
      {
        type: "text",
        part: {
          type: "text",
          text: "### Bugs\n- Broken — `src/a.js:1`: wrong.\n### Not issues\n- Fine — `src/b.js:2`: not wrong.\n### More\n- Also broken — `src/c.js:3`: wrong.\n",
        },
      },
    ]);
    const r = cli(
      "normalize",
      "one",
      scratch,
      notissuesResume,
      "--run",
      runConfig("notissues-resume", "mimo"),
    );
    const found = parsed(r);
    expect(r.code).toBe(0);
    expect(JSON.stringify(found.map((f) => f["target"]).sort())).toBe(
      JSON.stringify(["src/a.js:1", "src/c.js:3"]),
    );
  });

  test("a subsection under Not issues stays skipped", () => {
    const nestedSkip = writeEvents("mimo-nested-skip.events", [
      {
        type: "text",
        part: {
          type: "text",
          text: "### Not issues\n#### Sub\n- Broken — `src/a.js:1`: wrong.\n\nNo issues found.\n",
        },
      },
    ]);
    const r = cli(
      "normalize",
      "one",
      scratch,
      nestedSkip,
      "--run",
      runConfig("nested-skip", "mimo"),
    );
    expect(r.code).toBe(1);
    expect(r.err.includes("cannot parse review output")).toBe(true);
  });

  test("a Findings/none verdict beside a cited line fails loudly", () => {
    const noneCited = writeEvents("mimo-none-cited.events", [
      {
        type: "text",
        part: {
          type: "text",
          text: "## Findings\nnone\n\nThe bug at src/page.js:8 is real and needs fixing.\n",
        },
      },
    ]);
    const r = cli("normalize", "one", scratch, noneCited, "--run", runConfig("none-cited", "mimo"));
    expect(r.code).toBe(1);
    expect(r.err.includes("cannot parse review output")).toBe(true);
  });
});

describe("codex reports", () => {
  test("an unclosed fence in a codex report fails loudly", () => {
    const codexUnclosed = writeEvents("codex-unclosed.events", [{ type: "turn.completed" }]);
    const codexUnclosedLast = join(root, "codex-unclosed.last");
    writeFileSync(
      codexUnclosedLast,
      "- [P1] First — src/a.js:1-1\n```\n- [P1] Second — src/b.js:2-2\n",
    );
    const r = cli(
      "normalize",
      "one",
      scratch,
      codexUnclosed,
      "--run",
      runConfig("codex-unclosed", "codex"),
      "--last",
      codexUnclosedLast,
    );
    expect(r.code).toBe(1);
    expect(r.err.includes("unclosed code fence")).toBe(true);
  });

  test("a codex finding inside a fence is not filed", () => {
    const codexFenced = writeEvents("codex-fenced.events", [{ type: "turn.completed" }]);
    const codexFencedLast = join(root, "codex-fenced.last");
    writeFileSync(
      codexFencedLast,
      "The fix is:\n```\n- [P1] Example bug — src/page.js:8-8\n```\n- [P1] Real bug — src/count.js:6-6\n  Real body.\n",
    );
    const r = cli(
      "normalize",
      "one",
      scratch,
      codexFenced,
      "--run",
      runConfig("codex-fenced", "codex"),
      "--last",
      codexFencedLast,
    );
    const found = parsed(r);
    expect(r.code).toBe(0);
    expect(found.length).toBe(1);
    expect(found[0]!["file"]).toBe("src/count.js");
  });

  test("a codex Findings/none verdict beside a cited line fails loudly", () => {
    const noneCitedCodex = writeEvents("codex-none-cited.events", [{ type: "turn.completed" }]);
    const noneCitedLast = join(root, "codex-none-cited.last");
    writeFileSync(noneCitedLast, "Findings\nnone\n\nPlease fix src/a.js:1 though.\n");
    const r = cli(
      "normalize",
      "one",
      scratch,
      noneCitedCodex,
      "--run",
      runConfig("none-cited-codex", "codex"),
      "--last",
      noneCitedLast,
    );
    expect(r.code).toBe(1);
    expect(r.err.includes("cannot parse review output")).toBe(true);
  });
});

describe("claude error results", () => {
  test("an error result is a failed reviewer, never clean", () => {
    const errSubtype = writeEvents("claude-err-subtype.events", [
      { type: "result", subtype: "error_during_execution", result: "No findings." },
    ]);
    const r = cli(
      "normalize",
      "one",
      scratch,
      errSubtype,
      "--run",
      runConfig("err-subtype", "claude"),
    );
    expect(r.code).toBe(1);
    expect(r.err.includes("did not succeed")).toBe(true);
  });

  test("a trailing error result without text fails loudly", () => {
    const errNoText = writeEvents("claude-err-no-text.events", [
      { type: "result", subtype: "success", result: "No findings." },
      { type: "result", subtype: "error_during_execution" },
    ]);
    const r = cli(
      "normalize",
      "one",
      scratch,
      errNoText,
      "--run",
      runConfig("err-no-text", "claude"),
    );
    expect(r.code).toBe(1);
    expect(r.err.includes("did not succeed")).toBe(true);
  });

  test("a success result without text fails loudly", () => {
    const okNoText = writeEvents("claude-ok-no-text.events", [
      { type: "result", subtype: "success" },
    ]);
    const r = cli(
      "normalize",
      "one",
      scratch,
      okNoText,
      "--run",
      runConfig("ok-no-text", "claude"),
    );
    expect(r.code).toBe(1);
    expect(r.err.includes("no result text")).toBe(true);
  });
});

describe("empty lists with other keys", () => {
  test("a citation in another key defeats an empty findings list", () => {
    const emptyNotes = writeEvents("claude-empty-notes.events", [
      {
        type: "result",
        subtype: "success",
        result: '{"findings": [], "notes": "Bug at src/page.js:8"}',
      },
    ]);
    const r = cli(
      "normalize",
      "one",
      scratch,
      emptyNotes,
      "--run",
      runConfig("empty-notes", "claude"),
    );
    expect(r.code).toBe(1);
    expect(r.err.includes("cannot parse review output")).toBe(true);
  });

  test("an empty findings list with other keys fails loudly", () => {
    const emptyPlainNotes = writeEvents("claude-empty-plain-notes.events", [
      { type: "result", subtype: "success", result: '{"findings": [], "notes": "all good"}' },
    ]);
    const r = cli(
      "normalize",
      "one",
      scratch,
      emptyPlainNotes,
      "--run",
      runConfig("empty-plain-notes", "claude"),
    );
    expect(r.code).toBe(1);
    expect(r.err.includes("cannot parse review output")).toBe(true);
  });

  test("an escaped citation in another key defeats an empty findings list", () => {
    const escapedCite = writeEvents("claude-escaped-cite.events", [
      {
        type: "result",
        subtype: "success",
        result: '{"findings": [], "notes": "see src/page.js\\u003a8"}',
      },
    ]);
    const r = cli(
      "normalize",
      "one",
      scratch,
      escapedCite,
      "--run",
      runConfig("escaped-cite", "claude"),
    );
    expect(r.code).toBe(1);
    expect(r.err.includes("cannot parse review output")).toBe(true);
  });

  test("a file-and-line pair outside any list defeats an empty findings list", () => {
    const pairObject = writeEvents("claude-pair-object.events", [
      {
        type: "result",
        subtype: "success",
        result: '{"findings": [], "bug": {"file": "src/a.js", "line": 1}}',
      },
    ]);
    const r = cli(
      "normalize",
      "one",
      scratch,
      pairObject,
      "--run",
      runConfig("pair-object", "claude"),
    );
    expect(r.code).toBe(1);
    expect(r.err.includes("cannot parse review output")).toBe(true);
  });

  test("a citation as a JSON key defeats an empty findings list", () => {
    const keyCite = writeEvents("claude-key-cite.events", [
      { type: "result", subtype: "success", result: '{"findings": [], "src/a.js:1": "seen"}' },
    ]);
    const r = cli("normalize", "one", scratch, keyCite, "--run", runConfig("key-cite", "claude"));
    expect(r.code).toBe(1);
    expect(r.err.includes("cannot parse review output")).toBe(true);
  });

  test("an unrecognized JSON shape fails loudly", () => {
    const unrecog = writeEvents("claude-unrecog.events", [
      {
        type: "result",
        subtype: "success",
        result: '{"status": "error", "message": "review timed out"}',
      },
    ]);
    const r = cli("normalize", "one", scratch, unrecog, "--run", runConfig("unrecog", "claude"));
    expect(r.code).toBe(1);
    expect(r.err.includes("cannot parse review output")).toBe(true);
  });

  for (const [name, report] of [
    ["noline", '{"findings": [], "bug": {"file": "src/a.js", "summary": "broken"}}'],
    [
      "nullline",
      '{"findings": [], "bug": {"file": "src/a.js", "line": null, "summary": "broken"}}',
    ],
    ["hashline", '{"findings": [], "notes": "src/a.js#L8 is wrong"}'],
    ["atline", '{"findings": [], "notes": "bug in src/a.js at line 3"}'],
    ["prose-notes", '{"findings": [], "notes": "There is a bug in the sorting logic somewhere."}'],
    ["issues-empty", '{"issues": []}'],
  ]) {
    test("a non-clean shape with no findings list fails loudly", () => {
      const events = writeEvents(`claude-${name}.events`, [
        { type: "result", subtype: "success", result: report },
      ]);
      const r = cli("normalize", "one", scratch, events, "--run", runConfig(name, "claude"));
      expect(r.code).toBe(1);
      expect(r.err.includes("cannot parse review output")).toBe(true);
    });
  }

  test("finding words beside an empty findings list fail loudly", () => {
    const words = writeEvents("claude-words.events", [
      {
        type: "result",
        subtype: "success",
        result:
          '{"findings": [], "bugs": [{"file": "src/a.js", "line": 1, "summary": "s"}], "notes": "There is a bug here too."}',
      },
    ]);
    const r = cli("normalize", "one", scratch, words, "--run", runConfig("words", "claude"));
    expect(r.code).toBe(1);
    expect(r.err.includes("beside its empty findings list")).toBe(true);
  });
});

describe("outside locations", () => {
  test("an unfiled location outside the findings list fails loudly", () => {
    const trailing = writeEvents("claude-trailing.events", [
      {
        type: "result",
        subtype: "success",
        result: '[{"file": "src/a.js", "line": 1, "summary": "s"}]\nAlso src/b.js:2 is wrong.',
      },
    ]);
    const r = cli("normalize", "one", scratch, trailing, "--run", runConfig("trailing", "claude"));
    expect(r.code).toBe(1);
    expect(r.err.includes("outside its filed findings")).toBe(true);
  });

  test("a finding outside the findings list fails loudly", () => {
    const example = writeEvents("claude-example.events", [
      {
        type: "result",
        subtype: "success",
        result:
          'Example:\n```json\n[{"file": "src/fake.js", "line": 1, "summary": "s"}]\n```\n- Bug at src/real.js:2: actual',
      },
    ]);
    const r = cli("normalize", "one", scratch, example, "--run", runConfig("example", "claude"));
    expect(r.code).toBe(1);
    expect(r.err.includes("outside its filed findings")).toBe(true);
  });

  test("a citation beside the no-other phrase is filed", () => {
    const nootherBoth = writeEvents("mimo-noother-both.events", [
      {
        type: "text",
        part: {
          type: "text",
          text: "### Bug — src/a.js:1: one\n\n### No other issues found — src/b.js:2: two\n",
        },
      },
    ]);
    const r = cli(
      "normalize",
      "one",
      scratch,
      nootherBoth,
      "--run",
      runConfig("noother-both", "mimo"),
    );
    const found = parsed(r);
    expect(r.code).toBe(0);
    expect(JSON.stringify(found.map((f) => f["target"]).sort())).toBe(
      JSON.stringify(["src/a.js:1", "src/b.js:2"]),
    );
  });

  for (const [name, report, targets] of [
    [
      "match-colon",
      '[{"file": "src/a.js", "line": 1, "summary": "s"}]\nThe bug at src/a.js:1 is the one.',
      ["src/a.js:1"],
    ],
    [
      "match-hash",
      '[{"file": "src/a.js", "line": 1, "summary": "s"}]\nSee src/a.js#L1.',
      ["src/a.js:1"],
    ],
    [
      "match-atline",
      '[{"file": "src/a.js", "line": 1, "summary": "s"}]\nBug in src/a.js at line 1.',
      ["src/a.js:1"],
    ],
  ]) {
    test("an outside location naming a filed finding parses", () => {
      const events = writeEvents(`claude-${name}.events`, [
        { type: "result", subtype: "success", result: report },
      ]);
      const r = cli(
        "normalize",
        "one",
        scratch,
        events,
        "--run",
        runConfig(name as string, "claude"),
      );
      const found = parsed(r);
      expect(r.code).toBe(0);
      expect(JSON.stringify(found.map((f) => f["target"]))).toBe(JSON.stringify(targets));
    });
  }

  for (const [name, report] of [
    ["novel-hash", '[{"file": "src/a.js", "line": 1, "summary": "s"}]\nSee src/b.js#L2.'],
    [
      "novel-atline",
      '[{"file": "src/a.js", "line": 1, "summary": "s"}]\nBug in src/b.js at line 2.',
    ],
  ]) {
    test("an unfiled outside location fails loudly", () => {
      const events = writeEvents(`claude-${name}.events`, [
        { type: "result", subtype: "success", result: report },
      ]);
      const r = cli("normalize", "one", scratch, events, "--run", runConfig(name, "claude"));
      expect(r.code).toBe(1);
      expect(r.err.includes("outside its filed findings")).toBe(true);
    });
  }

  test("a second findings list under another key fails loudly", () => {
    const second = writeEvents("claude-second.events", [
      {
        type: "result",
        subtype: "success",
        result:
          '{"issues": [{"file": "src/a.js", "line": 1, "summary": "s"}], "bugs": [{"file": "src/b.js", "line": 2, "summary": "s"}]}',
      },
    ]);
    const r = cli("normalize", "one", scratch, second, "--run", runConfig("second", "claude"));
    expect(r.code).toBe(1);
    expect(r.err.includes("outside its filed findings")).toBe(true);
  });

  for (const [name, report, message] of [
    [
      "matched-bullet",
      '[{"file": "src/a.js", "line": 1, "summary": "s"}]\n- See src/a.js:1 again.',
      "a markdown finding outside",
    ],
    [
      "twin-list",
      '{"issues": [{"file": "src/a.js", "line": 1, "summary": "s"}], "bugs": [{"file": "src/a.js", "line": 1, "summary": "s"}]}',
      "a second findings list",
    ],
    [
      "tag-only",
      '[{"file": "src/a.js", "line": 1, "summary": "s"}]\nDowngraded from [P1] after review.',
      "a priority tag",
    ],
  ]) {
    test("structure outside the filed findings fails loudly", () => {
      const events = writeEvents(`claude-${name}.events`, [
        { type: "result", subtype: "success", result: report },
      ]);
      const r = cli("normalize", "one", scratch, events, "--run", runConfig(name, "claude"));
      expect(r.code).toBe(1);
      expect(r.err.includes(message as string)).toBe(true);
    });
  }
});

describe("recorded re-derive", () => {
  test("the recorded claude report re-normalizes byte-identical", () => {
    const trial = join(TOOL, "raw", "trials", "code-review-launch");
    const recorded = readFileSync(join(trial, "opus-report.md"), "utf8");
    const rederive = writeEvents("claude-rederive.events", [
      { type: "result", subtype: "success", result: recorded },
    ]);
    const r = cli("normalize", "one", scratch, rederive, "--run", runConfig("rederive", "claude"));
    expect(r.code).toBe(0);
    expect(r.out).toBe(readFileSync(join(trial, "opus-findings.json"), "utf8"));
  });

  test("the recorded report with an unfiled outside location fails loudly", () => {
    const trial = join(TOOL, "raw", "trials", "code-review-launch");
    const recorded = readFileSync(join(trial, "opus-report.md"), "utf8");
    const unfiled = writeEvents("claude-unfiled.events", [
      {
        type: "result",
        subtype: "success",
        result: `${recorded}\nAlso src/unfiled.js:9 is wrong.\n`,
      },
    ]);
    const r = cli("normalize", "one", scratch, unfiled, "--run", runConfig("unfiled", "claude"));
    expect(r.code).toBe(1);
    expect(r.err.includes("outside its filed findings")).toBe(true);
  });
});

describe("fenced clean", () => {
  for (const [name, report] of [
    ["fenced-empty", "```json\n[]\n```"],
    ["fenced-empty-dict", '```json\n{"findings": []}\n```'],
  ]) {
    test("a fenced clean report stays clean", () => {
      const events = writeEvents(`claude-${name}.events`, [
        { type: "result", subtype: "success", result: report },
      ]);
      const r = cli("normalize", "one", scratch, events, "--run", runConfig(name, "claude"));
      expect(r.code).toBe(0);
      expect(pyTrim(r.out)).toBe("[]");
    });
  }
});

describe("harvest conflicts", () => {
  test("a refused harvest copies nothing", () => {
    const secondTask = join(taskHome, "second-task-output.txt");
    writeFileSync(secondTask, "second task tools\n");
    const clashLogs = join(root, "logs-clash");
    mkdirSync(clashLogs, { recursive: true });
    writeFileSync(join(clashLogs, `clash-claude-task-02-${basename(secondTask)}`), "changed\n");
    const clash = writeEvents("harvest-clash.events", [
      { type: "system", subtype: "task_notification", output_file: external },
      { type: "system", subtype: "task_notification", output_file: secondTask },
    ]);
    const r = cli("harvest", clash, clashLogs, "--prefix", "clash");
    expect(r.code).toBe(1);
    expect(r.err.includes("refusing to overwrite")).toBe(true);
    expect(existsSync(join(clashLogs, `clash-claude-task-01-${basename(external)}`))).toBe(false);
  });

  test("a symlinked task root still contains its files", () => {
    const linkRoot = join(root, "task-link");
    const realRoot = join(root, "task-real");
    mkdirSync(realRoot, { recursive: true });
    writeFileSync(join(realRoot, "linked-task-output.txt"), "linked task tools\n");
    try {
      rmSync(linkRoot, { force: true });
    } catch {
      // absent
    }
    symlinkSync(realRoot, linkRoot, "dir");
    const linkEvents = writeEvents("harvest-link.events", [
      {
        type: "system",
        subtype: "task_notification",
        output_file: join(realRoot, "linked-task-output.txt"),
      },
    ]);
    const got = harvest(linkEvents, join(root, "logs-link"), "link", linkRoot);
    expect(got.length).toBe(1);
    expect(existsSync(got[0]!)).toBe(true);
  });

  test("a task file outside the given root is still refused", () => {
    const realRoot = join(root, "task-real");
    mkdirSync(realRoot, { recursive: true });
    writeFileSync(join(realRoot, "linked-task-output.txt"), "linked task tools\n");
    const linkEvents = writeEvents("harvest-link.events", [
      {
        type: "system",
        subtype: "task_notification",
        output_file: join(realRoot, "linked-task-output.txt"),
      },
    ]);
    let threw: unknown = null;
    try {
      harvest(linkEvents, join(root, "logs-link2"), "link", join(root, "elsewhere"));
    } catch (e) {
      threw = e;
    }
    expect(isReportError(threw)).toBe(true);
    expect(errMsg(threw).includes("outside")).toBe(true);
  });
});
