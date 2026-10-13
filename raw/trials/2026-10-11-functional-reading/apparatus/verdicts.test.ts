import { describe, expect, test } from "bun:test";
import { verdict } from "./verdicts.ts";

const share = (mean: number, lo = mean - 0.01, hi = mean + 0.01) => ({ mean, lo, hi });

describe("careful mode", () => {
  test("less effort at no loss of accuracy reads easier", () => {
    expect(verdict("careful", share(0), { lo: 0.8, hi: 0.95 })).toBe("easier");
    expect(verdict("careful", share(-0.04), { lo: 0.8, hi: 0.95 })).toBe("easier");
  });

  test("more effort, or a loss of more than five points, reads harder", () => {
    expect(verdict("careful", share(0), { lo: 1.02, hi: 1.2 })).toBe("harder");
    expect(verdict("careful", share(-0.06), { lo: 0.8, hi: 0.95 })).toBe("harder");
  });

  test("an interval that holds 1 reads no difference, and so does a bound at 1", () => {
    expect(verdict("careful", share(0.1), { lo: 0.9, hi: 1.1 })).toBe("no difference");
    expect(verdict("careful", share(0), { lo: 1, hi: 1.1 })).toBe("no difference");
  });
});

describe("quick mode", () => {
  test("goes by the interval of the difference in the share right", () => {
    expect(verdict("quick", share(0.03, 0.008, 0.062), { lo: 0.9, hi: 1.1 })).toBe("easier");
    expect(verdict("quick", share(-0.03, -0.06, -0.01), { lo: 0.9, hi: 1.1 })).toBe("harder");
    expect(verdict("quick", share(0.02, 0, 0.06), { lo: 0.9, hi: 1.1 })).toBe("no difference");
  });
});
