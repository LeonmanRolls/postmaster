// Tests beside scripts/lib/takeover-agent.ts.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AGENT_ENV,
  TAKEOVER_USAGE,
  launchFlags,
  overlay,
  parseTakeover,
  readAgentEnv,
} from "./takeover-agent.ts";

const FIVE = ["/run/T-1", "/wt", "review", "2", "/run/T-1/prompt.txt"];

describe("a takeover's arguments", () => {
  test("--recorded names the run's own fallback", () => {
    expect(parseTakeover([...FIVE, "--recorded"])).toEqual({
      positionals: FIVE,
      agent: "recorded",
    });
  });

  test("a model and an effort name another agent; the flags may come first", () => {
    expect(parseTakeover(["--model", "m1", "--effort", "max", ...FIVE])).toEqual({
      positionals: FIVE,
      agent: { model: "m1", effort: "max" },
    });
  });

  test("a harness and an env file may go with them", () => {
    const parsed = parseTakeover([
      ...FIVE,
      "--model",
      "m",
      "--effort",
      "high",
      "--harness",
      "claude",
      "--env-file",
      "~/e.env",
    ]);
    expect(parsed).toEqual({
      positionals: FIVE,
      agent: { model: "m", effort: "high", harness: "claude", env_file: "~/e.env" },
    });
  });

  test("neither --recorded nor an agent is refused, naming both ways", () => {
    const parsed = parseTakeover(FIVE);
    expect("error" in parsed && parsed.error).toContain("names its agent");
    expect("error" in parsed && parsed.error).toContain("--recorded");
    expect("error" in parsed && parsed.error).toContain("confirmed with the user");
  });

  test("a model without an effort, or an effort without a model, is refused", () => {
    for (const flags of [
      ["--model", "m"],
      ["--effort", "max"],
      ["--harness", "claude"],
    ]) {
      const parsed = parseTakeover([...FIVE, ...flags]);
      expect("error" in parsed && parsed.error).toBe(
        "a takeover on another agent needs both --model and --effort",
      );
    }
  });

  test("--recorded with an agent is refused", () => {
    const parsed = parseTakeover([...FIVE, "--recorded", "--model", "m", "--effort", "max"]);
    expect("error" in parsed && parsed.error).toContain("takes no --model");
  });

  test("a flag with no value, an unknown flag and the wrong number of positionals are refused", () => {
    expect(parseTakeover([...FIVE, "--model"])).toEqual({ error: "--model needs a value" });
    expect(parseTakeover([...FIVE, "--model", "--effort", "max"])).toEqual({
      error: "--model needs a value",
    });
    expect(parseTakeover([...FIVE, "--bogus"])).toEqual({ error: "unknown option --bogus" });
    expect(parseTakeover(["a", "b", "--recorded"])).toEqual({ error: TAKEOVER_USAGE });
    expect(parseTakeover([...FIVE, "extra", "--recorded"])).toEqual({ error: TAKEOVER_USAGE });
  });
});

describe("the agent laid over a recorded role", () => {
  const recorded = {
    harness: "claude",
    model: "sonnet",
    effort: "max",
    env_file: "~/e.env",
    note: "kept",
  };

  test("model and effort replace, everything else stays", () => {
    expect(overlay(recorded, { model: "opus", effort: "high" })).toEqual({
      harness: "claude",
      model: "opus",
      effort: "high",
      env_file: "~/e.env",
      note: "kept",
    });
  });

  test("a harness and an env file replace when given", () => {
    const out = overlay(recorded, {
      model: "x",
      effort: "low",
      harness: "codex",
      env_file: "~/o.env",
    });
    expect(out.harness).toBe("codex");
    expect(out.env_file).toBe("~/o.env");
  });

  test("the recorded table is not changed", () => {
    overlay(recorded, { model: "x", effort: "low" });
    expect(recorded.model).toBe("sonnet");
  });
});

describe("the agent between the command and the launch", () => {
  test("an agent survives a trip through the environment", () => {
    const agent = { model: "m", effort: "max", env_file: "~/e.env" };
    expect(readAgentEnv(JSON.stringify(agent))).toEqual(agent);
    expect(AGENT_ENV).toBe("POSTMASTER_TAKEOVER_AGENT");
  });

  test("nothing, or text that is not an agent, reads as no agent", () => {
    expect(readAgentEnv(undefined)).toBeNull();
    expect(readAgentEnv("")).toBeNull();
    expect(readAgentEnv("{")).toBeNull();
    expect(readAgentEnv(JSON.stringify({ model: "m" }))).toBeNull();
  });

  test("the launch flags name each field given", () => {
    expect(launchFlags({ model: "m", effort: "max" })).toEqual(["--model", "m", "--effort", "max"]);
    expect(launchFlags({ model: "m", effort: "max", harness: "claude", env_file: "~/e" })).toEqual([
      "--model",
      "m",
      "--effort",
      "max",
      "--harness",
      "claude",
      "--env-file",
      "~/e",
    ]);
  });
});

// The takeover end to end: `launch form` prints the command a launch would run and starts nothing, so
// each case reads the printed command. The run is invented: a recorded config with a lane, a primary
// and a fallback.
const SELF = join(import.meta.dir, "..", "run");

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
