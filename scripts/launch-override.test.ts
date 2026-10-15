// Tests beside the takeover's agent flags in scripts/launch.ts: inside a run, coachman_fallback may be
// started on a model and an effort named on the command, laid over the run's recorded fallback.
// `launch form` prints the command a launch would run and starts nothing, so each case reads the
// printed command. The run is invented: a recorded config with a lane, a primary and a fallback.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SELF = join(import.meta.dir, "run");

let tmp = "";
let dispatch = "";

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "launch-override-"));
  dispatch = join(tmp, "run");
  mkdirSync(dispatch);
  const env = join(tmp, "fallback.env");
  writeFileSync(env, "DUMMY=1\n");
  writeFileSync(
    join(dispatch, "run.json"),
    JSON.stringify({
      config: {
        lanes: { luna: { harness: "codex", model: "gpt-lane" } },
        team: {
          coachman: { harness: "muse", model: "muse-primary", effort: "max" },
          coachman_fallback: { harness: "claude", model: "sonnet", effort: "max", env_file: env },
        },
      },
    }),
  );
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function form(name: string, ...flags: string[]): { code: number; out: string; err: string } {
  const r = spawnSync(SELF, ["launch", "form", name, "--leg", "review", ...flags], {
    encoding: "utf8",
    timeout: 60000,
  });
  return { code: r.status ?? 1, out: String(r.stdout ?? ""), err: String(r.stderr ?? "") };
}

describe("a takeover's agent", () => {
  test("with no flags the fallback runs as the run recorded it", () => {
    const r = form("coachman_fallback", "--run", dispatch);
    expect(r.code).toBe(0);
    expect(r.out).toContain("--model sonnet --effort max");
    expect(r.err).not.toContain("as the takeover command named it");
  });

  test("a model and an effort named on the command replace the recorded ones", () => {
    const r = form(
      "coachman_fallback",
      "--run",
      dispatch,
      "--model",
      "claude-opus-5-5",
      "--effort",
      "high",
    );
    expect(r.code).toBe(0);
    expect(r.out).toContain("--model claude-opus-5-5 --effort high");
    expect(r.out).not.toContain("--model sonnet");
  });

  test("the launch says what it did and what the run recorded", () => {
    const r = form(
      "coachman_fallback",
      "--run",
      dispatch,
      "--model",
      "claude-opus-5-5",
      "--effort",
      "high",
    );
    expect(r.err).toContain(
      "coachman_fallback runs on claude-opus-5-5 at high, as the takeover command named it",
    );
    expect(r.err).toContain("recorded sonnet at max");
  });

  test("a model alone keeps the recorded effort", () => {
    const r = form("coachman_fallback", "--run", dispatch, "--model", "opus");
    expect(r.out).toContain("--model opus --effort max");
  });

  test("the flags go only with the fallback, inside a run", () => {
    const primary = form("coachman", "--run", dispatch, "--model", "x", "--effort", "y");
    expect(primary.code).toBe(1);
    expect(primary.err).toContain("they go with coachman_fallback, inside a run (--run)");
    const live = form("coachman_fallback", "--model", "x", "--effort", "y");
    expect(live.code).toBe(1);
    expect(live.err).toContain("inside a run (--run)");
  });

  test("a coachman never runs on a lane's model, named or recorded", () => {
    const r = form(
      "coachman_fallback",
      "--run",
      dispatch,
      "--model",
      "gpt-lane",
      "--effort",
      "max",
    );
    expect(r.code).toBe(1);
    expect(r.err).toContain("runs on gpt-lane, a lane's model, and a coachman never does");
  });

  test("a flag with no value is refused", () => {
    const r = form("coachman_fallback", "--run", dispatch, "--model");
    expect(r.code).toBe(1);
    expect(r.err).toContain("--model needs a value");
  });
});

describe("the takeover command", () => {
  const takeover = (...flags: string[]): { code: number; err: string } => {
    const r = spawnSync(
      SELF,
      [
        "host",
        "leg",
        "takeover",
        dispatch,
        join(tmp, "wt"),
        "review",
        "1",
        join(tmp, "p.txt"),
        ...flags,
      ],
      { encoding: "utf8", timeout: 60000 },
    );
    return { code: r.status ?? 1, err: String(r.stderr ?? "") };
  };

  test("refuses to start with no agent named, and says how to name one", () => {
    const r = takeover();
    expect(r.code).toBe(1);
    expect(r.err).toContain("a takeover names its agent");
    expect(r.err).toContain("--recorded");
    expect(r.err).toContain("confirmed with the user");
  });

  test("refuses a model without an effort", () => {
    const r = takeover("--model", "opus");
    expect(r.code).toBe(1);
    expect(r.err).toContain("needs both --model and --effort");
  });

  test("refuses --recorded beside a model", () => {
    const r = takeover("--recorded", "--model", "opus", "--effort", "max");
    expect(r.code).toBe(1);
    expect(r.err).toContain("takes no --model");
  });
});
