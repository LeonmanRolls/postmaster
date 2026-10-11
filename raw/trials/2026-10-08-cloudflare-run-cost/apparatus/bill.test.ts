import { describe, expect, test } from "bun:test";
import { bracket, byKey, dollars, type Price } from "./bill.ts";
import { type Tokens, zero } from "./tokens.ts";

const price: Price = { input: 1.25, cachedInput: 0.15, cacheWrite: 1.5, output: 4.25 };
const tokens = (over: Partial<Tokens>): Tokens => ({ ...zero(), ...over });

describe("dollars", () => {
  test("one million of each kind is the sum of the four rates, worked by hand", () => {
    const t = tokens({ uncached: 1e6, cacheRead: 1e6, cacheWrite: 1e6, output: 1e6 });
    // 1.25 + 0.15 + 1.5 + 4.25
    expect(dollars(t, price)).toBeCloseTo(7.15, 9);
  });

  test("a launch of 48.5M input, 47.4M of it cached, and 0.227M output (a recorded codex lane)", () => {
    const t = tokens({ uncached: 48_494_593 - 47_400_192, cacheRead: 47_400_192, output: 227_131 });
    // 1.094401 M at 1.25, 47.400192 M at 0.15, 0.227131 M at 4.25
    expect(dollars(t, price)).toBeCloseTo(1.094401 * 1.25 + 47.400192 * 0.15 + 0.227131 * 4.25, 6);
  });

  test("negative control: no tokens cost nothing, and a free price costs nothing", () => {
    expect(dollars(zero(), price)).toBe(0);
    const free: Price = { input: 0, cachedInput: 0, cacheWrite: 0, output: 0 };
    expect(dollars(tokens({ uncached: 5e6, output: 5e6 }), free)).toBe(0);
  });
});

describe("bracket", () => {
  test("with no cache hits the two prices are equal; with hits the measured one is lower", () => {
    const cold = tokens({ uncached: 2e6, output: 1e5 });
    expect(bracket(cold, price).measured).toBeCloseTo(bracket(cold, price).noCache, 12);
    const warm = tokens({ uncached: 1e5, cacheRead: 1.9e6, output: 1e5 });
    expect(bracket(warm, price).measured).toBeLessThan(bracket(warm, price).noCache);
    expect(bracket(warm, price).noCache).toBeCloseTo(2e6 * 1.25e-6 + 1e5 * 4.25e-6, 9);
  });
});

describe("byKey", () => {
  const a = { role: "workhorse", lane: "luna", harness: "codex", tokens: tokens({ uncached: 1e6 }) };
  const b = { role: "reviewer", lane: "luna", harness: "codex", tokens: tokens({ uncached: 2e6 }) };
  const c = { role: "reviewer", lane: "mystery", harness: "x", tokens: tokens({ uncached: 9e6 }) };

  test("sums by key and counts a launch with no price apart, never as zero dollars", () => {
    const r = byKey([a, b, c], (l) => l.role, (l) => (l.lane === "mystery" ? null : price));
    expect(r.dollars.workhorse).toBeCloseTo(1.25, 9);
    expect(r.dollars.reviewer).toBeCloseTo(2.5, 9);
    expect(r.unpriced).toEqual({ reviewer: 1 });
  });
});
