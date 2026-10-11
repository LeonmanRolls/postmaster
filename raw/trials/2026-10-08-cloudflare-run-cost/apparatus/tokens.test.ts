import { describe, expect, test } from "bun:test";
import { add, claudeModelUsage, claudeTokens, codexTokens, mimoTokens, museTokens, totalInput, zero } from "./tokens.ts";

const lines = (...rows: unknown[]): string => rows.map((r) => JSON.stringify(r)).join("\n");

describe("codexTokens", () => {
  // the last turn's usage is the session's so far, shaped as in a recorded stream
  const stream = lines(
    { type: "turn.completed", usage: { input_tokens: 1000, cached_input_tokens: 900, output_tokens: 50 } },
    { type: "item.completed", item: { type: "agent_message", text: "done" } },
    {
      type: "turn.completed",
      usage: {
        input_tokens: 48494593,
        cached_input_tokens: 47400192,
        cache_write_input_tokens: 0,
        output_tokens: 227131,
        reasoning_output_tokens: 156208,
      },
    },
  );

  test("takes the last turn, splits cached from uncached input, and counts output once", () => {
    const t = codexTokens(stream);
    expect(t.cacheRead).toBe(47400192);
    expect(t.uncached).toBe(48494593 - 47400192);
    expect(t.output).toBe(227131);
    expect(totalInput(t)).toBe(48494593);
  });

  test("negative control: a stream with no turn event reads zero, and a torn last line is ignored", () => {
    expect(codexTokens(lines({ type: "item.completed" }))).toEqual(zero());
    expect(codexTokens(`${stream}\n{"type":"turn.compl`).cacheRead).toBe(47400192);
  });
});

describe("mimoTokens", () => {
  // two steps as recorded: input leaves out the cache, and total = input + output + reasoning + cache
  const stream = lines(
    {
      type: "step_finish",
      part: {
        tokens: { total: 38505, input: 21885, output: 101, reasoning: 135, cache: { write: 0, read: 16384 } },
        cost: 0,
      },
    },
    {
      type: "step_finish",
      part: {
        tokens: { total: 46146, input: 7717, output: 116, reasoning: 105, cache: { write: 0, read: 38208 } },
        cost: 0,
      },
    },
    { type: "text", part: { text: "hello" } },
  );

  test("sums the steps; reasoning is billed as output; input stays apart from the cache", () => {
    const t = mimoTokens(stream);
    expect(t.uncached).toBe(21885 + 7717);
    expect(t.cacheRead).toBe(16384 + 38208);
    expect(t.output).toBe(101 + 135 + 116 + 105);
    expect(t.reportedUsd).toBe(0);
  });

  test("each step's total is its parts, which is the stream's own cross-check", () => {
    const a = mimoTokens(lines(JSON.parse(stream.split("\n")[0] as string)));
    expect(a.uncached + a.cacheRead + a.output).toBe(38505);
  });

  test("negative control: no step_finish reads zero with no reported money", () => {
    expect(mimoTokens(lines({ type: "text" }))).toEqual(zero());
  });
});

describe("claudeTokens", () => {
  const stream = lines(
    {
      type: "result",
      total_cost_usd: 7.125892199999997,
      usage: {
        input_tokens: 16,
        cache_creation_input_tokens: 124285,
        cache_read_input_tokens: 688025,
        output_tokens: 37028,
      },
    },
    {
      type: "result",
      total_cost_usd: 9.5,
      usage: { input_tokens: 4, cache_creation_input_tokens: 10, cache_read_input_tokens: 20, output_tokens: 6 },
    },
  );

  test("sums the invocations and takes the last total cost", () => {
    const t = claudeTokens(stream);
    expect(t.uncached).toBe(20);
    expect(t.cacheWrite).toBe(124295);
    expect(t.cacheRead).toBe(688045);
    expect(t.output).toBe(37034);
    expect(t.reportedUsd).toBe(9.5);
  });

  test("negative control: no result event reads zero", () => {
    expect(claudeTokens(lines({ type: "assistant" }))).toEqual(zero());
  });
});

describe("claudeModelUsage", () => {
  const stream = lines(
    { type: "result", modelUsage: { "claude-opus-5-5": { inputTokens: 1, outputTokens: 2 } } },
    {
      type: "result",
      total_cost_usd: 7.125892199999997,
      modelUsage: {
        "claude-opus-5-5": {
          inputTokens: 88,
          outputTokens: 160617,
          cacheReadInputTokens: 3564701,
          cacheCreationInputTokens: 565481,
          costUSD: 7.125892199999997,
        },
        "claude-haiku-4-5-20251001": { inputTokens: 5 },
      },
    },
  );

  test("takes the last result's per-model tokens, as recorded for one launch", () => {
    const u = claudeModelUsage(stream);
    expect(u["claude-opus-5-5"]).toEqual({ input: 88, output: 160617, cacheRead: 3564701, cacheWrite: 565481 });
    expect(Object.keys(u).sort()).toEqual(["claude-haiku-4-5-20251001", "claude-opus-5-5"]);
  });

  test("negative control: a stream with no modelUsage reads nothing", () => {
    expect(claudeModelUsage(lines({ type: "result", usage: {} }))).toEqual({});
  });
});

describe("museTokens", () => {
  const event = (usage: Record<string, number>, kind = "model_completed") => ({
    envelope: { payload: { event: { kind, usage } } },
  });
  const exported = {
    events: [
      event({ cache_read_tokens: 0, cache_write_tokens: 0, input_tokens: 27804, output_tokens: 97 }),
      event({ cache_read_tokens: 27761, cache_write_tokens: 0, input_tokens: 30196, output_tokens: 90 }),
      event({ input_tokens: 999999, output_tokens: 999999 }, "something_else"),
      { kind: "retained_frame" },
    ],
  };

  test("sums model_completed calls; input includes the cache reads", () => {
    const t = museTokens(exported);
    expect(t.cacheRead).toBe(27761);
    expect(t.uncached).toBe(27804 + (30196 - 27761));
    expect(t.output).toBe(97 + 90);
    expect(totalInput(t)).toBe(27804 + 30196);
  });

  test("negative control: an export with no events, or not an object, reads zero", () => {
    expect(museTokens({ events: [] })).toEqual(zero());
    expect(museTokens(null)).toEqual(zero());
  });
});

describe("add", () => {
  test("money stays null until one side reports it", () => {
    expect(add(zero(), zero()).reportedUsd).toBeNull();
    expect(add({ ...zero(), reportedUsd: 1 }, zero()).reportedUsd).toBe(1);
  });
});
