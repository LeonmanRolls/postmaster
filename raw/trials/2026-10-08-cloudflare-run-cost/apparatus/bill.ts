// What the model side of a run would cost on pay-per-token API prices (see ../method.md): the tokens
// of each kind (tokens.ts) times a vendor's published rate for each kind. Pure functions; the rates
// are arguments, and `prices.json` in ../results records where each one was read.
import type { Tokens } from "./tokens.ts";

/** Dollars per million tokens, by kind. A kind a vendor does not price separately takes another's rate. */
export type Price = {
  input: number;
  cachedInput: number;
  /** writing to a cache; equal to `input` where the vendor charges nothing extra */
  cacheWrite: number;
  output: number;
};

export function dollars(t: Tokens, price: Price): number {
  return (
    (t.uncached * price.input +
      t.cacheRead * price.cachedInput +
      t.cacheWrite * price.cacheWrite +
      t.output * price.output) /
    1_000_000
  );
}

/**
 * The same tokens priced two ways, to bracket what a vendor's cache does: every input token at the
 * input rate (no cache hits at all) and the tokens as measured.
 */
export function bracket(t: Tokens, price: Price): { measured: number; noCache: number } {
  const noCache: Tokens = {
    ...t,
    uncached: t.uncached + t.cacheRead + t.cacheWrite,
    cacheRead: 0,
    cacheWrite: 0,
  };
  return { measured: dollars(t, price), noCache: dollars(noCache, price) };
}

export type PricedLaunch = { role: string; lane: string; harness: string; tokens: Tokens };

/** Sum of dollars over launches, by `key(launch)`, using `priceOf(launch)`; a launch with no price is counted apart. */
export function byKey<L extends PricedLaunch>(
  launches: readonly L[],
  key: (l: L) => string,
  priceOf: (l: L) => Price | null,
): { dollars: Record<string, number>; unpriced: Record<string, number> } {
  const out: Record<string, number> = {};
  const unpriced: Record<string, number> = {};
  for (const l of launches) {
    const k = key(l);
    const price = priceOf(l);
    if (price === null) {
      unpriced[k] = (unpriced[k] ?? 0) + 1;
      continue;
    }
    out[k] = (out[k] ?? 0) + dollars(l.tokens, price);
  }
  return { dollars: out, unpriced };
}
