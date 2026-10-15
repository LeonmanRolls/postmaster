// Tests beside scripts/lib/takeover-agent.ts.
import { describe, expect, test } from "bun:test";
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
