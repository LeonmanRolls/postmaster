// Tokens by kind (uncached input, cache reads, cache writes, output) from a launch's own stream or
// session export, for four harnesses (see ../method.md). The lane audit's counts give input and output
// only, and they do not mean the same thing across harnesses: codex's and Muse Code's input includes
// cache reads, Claude Code's and MiMo Code's leaves them out. This file reads the split so a price can
// be put on each kind. Pure parsers; `measure.ts` reads the run folders.

export type Tokens = {
  /** input that was not read from or written to a cache */
  uncached: number;
  cacheRead: number;
  cacheWrite: number;
  /** output, with reasoning tokens counted as output */
  output: number;
  /** dollars the harness itself reported, at list price where it says so; null where it reports none */
  reportedUsd: number | null;
};

export const zero = (): Tokens => ({
  uncached: 0,
  cacheRead: 0,
  cacheWrite: 0,
  output: 0,
  reportedUsd: null,
});

export function add(a: Tokens, b: Tokens): Tokens {
  return {
    uncached: a.uncached + b.uncached,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    output: a.output + b.output,
    reportedUsd:
      a.reportedUsd === null && b.reportedUsd === null
        ? null
        : (a.reportedUsd ?? 0) + (b.reportedUsd ?? 0),
  };
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

function* jsonLines(text: string): Generator<Record<string, unknown>> {
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const row: unknown = JSON.parse(line);
      if (isRecord(row)) yield row;
    } catch {
      // a torn last line of a stream that was cut short
    }
  }
}

/**
 * codex: `turn.completed`, `turn.failed` and `turn.interrupted` carry the session's usage so far, so
 * the last one wins. `input_tokens` includes `cached_input_tokens`; `output_tokens` includes the
 * reasoning tokens.
 */
export function codexTokens(stream: string): Tokens {
  let last: Record<string, unknown> | null = null;
  for (const row of jsonLines(stream)) {
    if (
      (row.type === "turn.completed" || row.type === "turn.failed" || row.type === "turn.interrupted") &&
      isRecord(row.usage)
    ) {
      last = row.usage;
    }
  }
  if (last === null) return zero();
  const input = num(last.input_tokens);
  const cacheRead = num(last.cached_input_tokens);
  const cacheWrite = num(last.cache_write_input_tokens);
  return {
    uncached: Math.max(0, input - cacheRead - cacheWrite),
    cacheRead,
    cacheWrite,
    output: num(last.output_tokens),
    reportedUsd: null,
  };
}

/**
 * MiMo Code: each `step_finish` carries one step's tokens. `input` leaves out the cache; `reasoning`
 * is separate from `output` and is billed as output.
 */
export function mimoTokens(stream: string): Tokens {
  let t = zero();
  let usd: number | null = null;
  for (const row of jsonLines(stream)) {
    if (row.type !== "step_finish" || !isRecord(row.part)) continue;
    const tokens = row.part.tokens;
    if (isRecord(tokens)) {
      const cache = isRecord(tokens.cache) ? tokens.cache : {};
      t = add(t, {
        uncached: num(tokens.input),
        cacheRead: num(cache.read),
        cacheWrite: num(cache.write),
        output: num(tokens.output) + num(tokens.reasoning),
        reportedUsd: null,
      });
    }
    if (typeof row.part.cost === "number") usd = (usd ?? 0) + row.part.cost;
  }
  return { ...t, reportedUsd: usd };
}

/**
 * Claude Code: each `result` carries one invocation's usage, summed over an appended stream; its
 * `total_cost_usd` is the session's so far, so the last one is taken. `input_tokens` leaves out cache
 * reads and writes.
 */
export function claudeTokens(stream: string): Tokens {
  let t = zero();
  let usd: number | null = null;
  for (const row of jsonLines(stream)) {
    if (row.type !== "result" || !isRecord(row.usage)) continue;
    t = add(t, {
      uncached: num(row.usage.input_tokens),
      cacheRead: num(row.usage.cache_read_input_tokens),
      cacheWrite: num(row.usage.cache_creation_input_tokens),
      output: num(row.usage.output_tokens),
      reportedUsd: null,
    });
    if (typeof row.total_cost_usd === "number") usd = row.total_cost_usd;
  }
  return { ...t, reportedUsd: usd };
}

/** Cumulative tokens of one model, as Claude Code's `modelUsage` reports them for a session. */
export type ModelTokens = { input: number; output: number; cacheRead: number; cacheWrite: number };

/**
 * Claude Code: the last `result` carries `modelUsage`, the session's tokens per model, subagents
 * included, and `total_cost_usd` for the same span. The top-level `usage` that `claudeTokens` sums is
 * the last iteration's only, so it reads low where a session ran many; the dollars and this are the
 * cumulative figures.
 */
export function claudeModelUsage(stream: string): Record<string, ModelTokens> {
  let last: Record<string, unknown> | null = null;
  for (const row of jsonLines(stream)) {
    if (row.type === "result" && isRecord(row.modelUsage)) last = row.modelUsage;
  }
  const out: Record<string, ModelTokens> = {};
  for (const [model, u] of Object.entries(last ?? {})) {
    if (!isRecord(u)) continue;
    out[model] = {
      input: num(u.inputTokens),
      output: num(u.outputTokens),
      cacheRead: num(u.cacheReadInputTokens),
      cacheWrite: num(u.cacheCreationInputTokens),
    };
  }
  return out;
}

/**
 * Muse Code: the session export's `model_completed` events, each one call's usage. `input_tokens`
 * includes the cache reads.
 */
export function museTokens(exported: unknown): Tokens {
  let t = zero();
  const events = isRecord(exported) && Array.isArray(exported.events) ? exported.events : [];
  for (const ev of events) {
    if (!isRecord(ev) || !isRecord(ev.envelope) || !isRecord(ev.envelope.payload)) continue;
    const event = ev.envelope.payload.event;
    if (!isRecord(event) || event.kind !== "model_completed" || !isRecord(event.usage)) continue;
    const input = num(event.usage.input_tokens);
    const cacheRead = num(event.usage.cache_read_tokens);
    const cacheWrite = num(event.usage.cache_write_tokens);
    t = add(t, {
      uncached: Math.max(0, input - cacheRead - cacheWrite),
      cacheRead,
      cacheWrite,
      output: num(event.usage.output_tokens),
      reportedUsd: null,
    });
  }
  return t;
}

export type Harness = "codex" | "mimo" | "claude";

export function streamTokens(harness: Harness, stream: string): Tokens {
  if (harness === "codex") return codexTokens(stream);
  if (harness === "mimo") return mimoTokens(stream);
  return claudeTokens(stream);
}

/** Input as the audit counts it for a harness: with cache reads for codex and Muse, without for the rest. */
export const totalInput = (t: Tokens): number => t.uncached + t.cacheRead + t.cacheWrite;
