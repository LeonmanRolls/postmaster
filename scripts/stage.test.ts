// Tests beside scripts/stage.ts, moved from its --self-test on #109: 31 controls.
// The self-test ran its controls in one shared temp run with fresh() resets; each test below
// repeats its own setup so it passes alone as well as in file order.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkstempSync, run } from "./lib/proc.ts";
import { scriptsDir } from "./lib/paths.ts";
import { setStage, STAGES } from "./stage.ts";

const MANIFEST =
  '{"stage": "dispatched", "leg": 1, "base": "abc123", "lanes": {"luna": {"outcome": "running"}}, "coachman": {"legs": {}}}\n';
const USAGE_LINE =
  '{"schema_version":1,"name":"luna","role":"workhorse","lane":"luna","harness":"codex","stream":"logs/luna-events.jsonl","input_tokens":4,"output_tokens":2,"cost_usd":0.25}\n';

let tmp = "";
let d = "";
const HERE = scriptsDir(import.meta);

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "postmaster-"));
  d = join(tmp, "project", ".postmaster", "runs", "RUN-1");
  mkdirSync(d, { recursive: true });
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const fresh = (): void => {
  mkdirSync(join(d, "logs"), { recursive: true });
  writeFileSync(join(d, "manifest.json"), MANIFEST);
  writeFileSync(join(d, "actions.jsonl"), "");
  writeFileSync(join(d, "run-log.md"), "");
  rmSync(join(d, "card.md"), { force: true });
  rmSync(join(d, "logs", "luna-events-usage.json"), { force: true });
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

const stageTargets = (): string => {
  try {
    return readFileSync(join(d, "actions.jsonl"), "utf8")
      .split("\n")
      .filter((l) => l !== "")
      .map((l) => JSON.parse(l) as { action?: string; target?: string })
      .filter((e) => e.action === "stage")
      .map((e) => e.target ?? "")
      .join(" ");
  } catch {
    return "?";
  }
};

const manifestStage = (): string => {
  try {
    return JSON.parse(readFileSync(join(d, "manifest.json"), "utf8")).stage;
  } catch {
    return "?";
  }
};

const bootstrapped = (): void => {
  fresh();
  expect(setStage(d, "bootstrapped", "coachman")).toBe(0);
};

const closed = (): void => {
  bootstrapped();
  writeFileSync(join(d, "logs", "luna-events-usage.json"), USAGE_LINE);
  writeFileSync(
    join(d, "card.md"),
    "# Ship card\n\n## Cost\n\nold estimate\n\n## Checks\n\npassed\n",
  );
  setStage(d, "done", "postmaster");
};

describe("positive controls", () => {
  test("a change logs exactly one stage line", () => {
    fresh();
    const rc = setStage(d, "bootstrapped", "coachman");
    expect(rc).toBe(0);
    expect(count()).toBe(1);
  });

  test("only the manifest's stage field changes", () => {
    bootstrapped();
    const m = JSON.parse(readFileSync(join(d, "manifest.json"), "utf8"));
    expect(m).toEqual({
      stage: "bootstrapped",
      leg: 1,
      base: "abc123",
      lanes: { luna: { outcome: "running" } },
      coachman: { legs: {} },
    });
  });

  test("run-log.md records the change and how long the last stage took", () => {
    bootstrapped();
    const log = readFileSync(join(d, "run-log.md"), "utf8");
    const line = log
      .split("\n")
      .find((l) => l.includes("stage bootstrapped, from dispatched after"));
    expect(line).toBeDefined();
    expect(/after [0-9]/u.test(line ?? "")).toBe(true);
  });

  test("the postmaster's terminal stage appends the run's timings", () => {
    closed();
    const log = readFileSync(join(d, "run-log.md"), "utf8");
    expect(log.includes("Stage timings, from actions.jsonl") && log.includes("bootstrapped ")).toBe(
      true,
    );
  });

  test("terminal closure refreshes the final usage sum in the run log and ship card", () => {
    closed();
    const log = readFileSync(join(d, "run-log.md"), "utf8");
    const card = readFileSync(join(d, "card.md"), "utf8");
    expect(log.includes("4 in") && card.includes("4 in") && !card.includes("old estimate")).toBe(
      true,
    );
  });

  test("the postmaster abandons a run", () => {
    fresh();
    const rc = setStage(d, "abandoned", "postmaster");
    expect(rc).toBe(0);
    expect(count()).toBe(1);
    expect(manifestStage()).toBe("abandoned");
  });

  test("review is one stage", () => {
    fresh();
    const rc = setStage(d, "review", "coachman");
    expect(rc).toBe(0);
    expect(count()).toBe(1);
    expect(manifestStage()).toBe("review");
  });

  test("the planning stage is no longer in the current stage list", () => {
    expect(STAGES.includes("planning")).toBe(false);
    const r = run("bash", [join(HERE, "stage.sh"), "--list"]);
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("planning");
  });

  test("an older run can leave its historical planning stage", () => {
    fresh();
    writeFileSync(
      join(d, "manifest.json"),
      MANIFEST.replace('"stage": "dispatched"', '"stage": "planning"'),
    );
    const rc = setStage(d, "workhorses-running", "coachman");
    expect(rc).toBe(0);
    expect(count()).toBe(1);
    expect(manifestStage()).toBe("workhorses-running");
  });
});

describe("negative controls", () => {
  test("setting the same stage again logs nothing", () => {
    fresh();
    setStage(d, "bootstrapped", "coachman");
    const rc = setStage(d, "bootstrapped", "coachman");
    expect(rc).toBe(0);
    expect(count()).toBe(1);
  });

  test("an unknown stage is refused, and nothing changes", () => {
    fresh();
    const beforeManifest = readFileSync(join(d, "manifest.json"), "utf8");
    const rc = setStage(d, "reviewing", "coachman");
    expect(rc).toBe(2);
    expect(count()).toBe(0);
    expect(readFileSync(join(d, "manifest.json"), "utf8")).toBe(beforeManifest);
  });

  for (const oldStage of ["review-style", "review-bug", "review-security"]) {
    test(`${oldStage} is refused, and nothing changes`, () => {
      fresh();
      const before = readFileSync(join(d, "manifest.json"), "utf8");
      const rc = setStage(d, oldStage, "coachman");
      expect(rc).toBe(2);
      expect(count()).toBe(0);
      expect(readFileSync(join(d, "manifest.json"), "utf8")).toBe(before);
    });
  }

  test("an unknown planning stage is refused, and nothing changes", () => {
    fresh();
    const before = readFileSync(join(d, "manifest.json"), "utf8");
    const rc = setStage(d, "planning-review", "coachman");
    expect(rc).toBe(2);
    expect(count()).toBe(0);
    expect(readFileSync(join(d, "manifest.json"), "utf8")).toBe(before);
  });

  for (const t of ["done", "abandoned"]) {
    test(`${t} from the coachman is refused, and nothing changes`, () => {
      fresh();
      const before = readFileSync(join(d, "manifest.json"), "utf8");
      const rc = setStage(d, t, "coachman");
      expect(rc).toBe(4);
      expect(count()).toBe(0);
      expect(readFileSync(join(d, "manifest.json"), "utf8")).toBe(before);
    });
  }

  test("shipped from the coachman is refused on a contract 2 run, and nothing changes", () => {
    fresh();
    writeFileSync(join(d, "run.json"), '{"coachman_contract": 2}\n');
    const before = readFileSync(join(d, "manifest.json"), "utf8");
    const rc = setStage(d, "shipped", "coachman");
    expect(rc).toBe(4);
    expect(count()).toBe(0);
    expect(readFileSync(join(d, "manifest.json"), "utf8")).toBe(before);
    rmSync(join(d, "run.json"), { force: true });
  });

  test("shipped from the postmaster is allowed on a contract 2 run", () => {
    fresh();
    writeFileSync(join(d, "run.json"), '{"coachman_contract": 2}\n');
    const rc = setStage(d, "shipped", "postmaster");
    expect(rc).toBe(0);
    expect(count()).toBe(1);
    expect(readFileSync(join(d, "manifest.json"), "utf8")).toContain('"stage": "shipped"');
    rmSync(join(d, "run.json"), { force: true });
  });

  for (const contract of ["1", '"2"', "true", "null"]) {
    test(`shipped from the coachman is allowed with contract ${contract}`, () => {
      fresh();
      writeFileSync(join(d, "run.json"), `{"coachman_contract": ${contract}}\n`);
      const rc = setStage(d, "shipped", "coachman");
      expect(rc).toBe(0);
      rmSync(join(d, "run.json"), { force: true });
    });
  }

  test("shipped from the coachman is allowed with no run.json", () => {
    fresh();
    rmSync(join(d, "run.json"), { force: true });
    expect(setStage(d, "shipped", "coachman")).toBe(0);
  });

  test("shipped from the coachman is allowed with an unreadable run.json", () => {
    fresh();
    writeFileSync(join(d, "run.json"), "not json\n");
    expect(setStage(d, "shipped", "coachman")).toBe(0);
    rmSync(join(d, "run.json"), { force: true });
  });

  test("the coachman cannot move a run out of abandoned", () => {
    fresh();
    setStage(d, "abandoned", "postmaster");
    const before2 = readFileSync(join(d, "manifest.json"), "utf8");
    const rc = setStage(d, "synthesis", "coachman");
    expect(rc).toBe(3);
    expect(count()).toBe(1);
    expect(readFileSync(join(d, "manifest.json"), "utf8")).toBe(before2);
  });

  test("no manifest is refused", () => {
    fresh();
    rmSync(join(d, "manifest.json"));
    expect(setStage(d, "bootstrapped", "coachman")).toBe(1);
  });

  test("a two-leg run walks every stage to done", () => {
    fresh();
    const walked: Array<[string, string]> = [
      ["bootstrapped", "coachman"],
      ["workhorses-running", "coachman"],
      ["synthesis", "coachman"],
      ["checkpoint-1", "coachman"],
      ["review", "coachman"],
      ["shipping", "coachman"],
      ["shipped", "postmaster"],
      ["done", "postmaster"],
    ];
    for (const [s, actor] of walked) expect(setStage(d, s, actor)).toBe(0);
    expect(stageTargets()).toBe(
      "bootstrapped workhorses-running synthesis checkpoint-1 review shipping shipped done",
    );
  });

  test("a one-leg run skips review and still reaches done", () => {
    fresh();
    const walked: Array<[string, string]> = [
      ["bootstrapped", "coachman"],
      ["workhorses-running", "coachman"],
      ["synthesis", "coachman"],
      ["checkpoint-1", "coachman"],
      ["shipping", "coachman"],
      ["shipped", "postmaster"],
      ["done", "postmaster"],
    ];
    for (const [s, actor] of walked) expect(setStage(d, s, actor)).toBe(0);
    expect(stageTargets()).toBe(
      "bootstrapped workhorses-running synthesis checkpoint-1 shipping shipped done",
    );
  });

  test("a three-leg run keeps the stages it always walked", () => {
    fresh();
    rmSync(join(d, "run.json"), { force: true });
    const walked: Array<[string, string]> = [
      ["bootstrapped", "coachman"],
      ["workhorses-running", "coachman"],
      ["synthesis", "coachman"],
      ["checkpoint-1", "coachman"],
      ["review", "coachman"],
      ["shipping", "coachman"],
      ["shipped", "coachman"],
      ["done", "postmaster"],
    ];
    for (const [s, actor] of walked) expect(setStage(d, s, actor)).toBe(0);
    expect(stageTargets()).toBe(
      "bootstrapped workhorses-running synthesis checkpoint-1 review shipping shipped done",
    );
  });

  test("mkstemp names are unique, mode 0600, and hold their own bytes", () => {
    const a = mkstempSync(tmp, "tmp");
    const b = mkstempSync(tmp, "tmp");
    writeFileSync(a, "a");
    writeFileSync(b, "b");
    expect(a === b).toBe(false);
    expect(statSync(a).mode & 0o777).toBe(0o600);
    expect(statSync(b).mode & 0o777).toBe(0o600);
    expect(readFileSync(a, "utf8")).toBe("a");
    expect(readFileSync(b, "utf8")).toBe("b");
  });
});
