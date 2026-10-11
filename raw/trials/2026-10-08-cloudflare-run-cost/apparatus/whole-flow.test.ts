import { describe, expect, test } from "bun:test";
import type { Rate } from "./providers.ts";
import {
  breakEvenTickets,
  controlPlane,
  flatTable,
  monthCost,
  monthTable,
  monthlyPace,
  overflowSeconds,
  peaksTable,
  sessionRates,
  sessionsMonth,
  ticketCost,
} from "./whole-flow.ts";

const base = { maxVcpu: null, maxMemoryGib: null, source: "a page", read: "a day", checked: "two reads" as const, note: "" };
// Cloudflare per hour: 0.00002 x 3600 per busy vCPU, 0.0000025 x 3600 per GiB, 0.00000007 x 3600 per GB of disk
const cloudflare: Rate = {
  ...base,
  id: "cf",
  name: "Cloudflare",
  vcpuHour: 0.072,
  cpuBilling: "busy",
  gibHour: 0.009,
  diskGbHour: 0.000252,
  maxSessionHours: null,
};
const flat: Rate = { ...cloudflare, id: "flat", name: "Flat", vcpuHour: 0.04, cpuBilling: "provisioned", gibHour: 0.005, diskGbHour: 0 };

describe("sessionRates", () => {
  test("positive control, worked by hand: awake 0.2 x 0.072 + 4 x 0.009 + 10 x 0.000252, idle 4 x 0.009 + 10 x 0.000252", () => {
    const r = sessionRates(cloudflare);
    expect(r.awake).toBeCloseTo(0.0144 + 0.036 + 0.00252, 9);
    expect(r.idle).toBeCloseTo(0.036 + 0.00252, 9);
  });

  test("a rate that charges every vCPU charges an idle session the same as an awake one", () => {
    const r = sessionRates(flat);
    expect(r.idle).toBeCloseTo(r.awake, 12);
  });
});

describe("sessionsMonth", () => {
  const r = sessionRates(cloudflare);

  test("9 sessions awake 2 hours a day for 30 days, asleep when idle: 9 x 30 x 2 x 0.05292", () => {
    expect(sessionsMonth(r, 9, 2, "asleep")).toBeCloseTo(9 * 30 * 2 * 0.05292, 6);
  });

  test("kept up adds the other 22 hours at the idle rate: 9 x 30 x 22 x 0.03852", () => {
    const keptUp = sessionsMonth(r, 9, 2, "kept-up");
    expect(keptUp - sessionsMonth(r, 9, 2, "asleep")).toBeCloseTo(9 * 30 * 22 * 0.03852, 6);
  });

  test("negative control: no sessions cost nothing, and a day of more than 24 hours is an error", () => {
    expect(sessionsMonth(r, 0, 2, "kept-up")).toBe(0);
    expect(() => sessionsMonth(r, 9, 25, "asleep")).toThrow(RangeError);
    expect(() => sessionsMonth(r, -1, 2, "asleep")).toThrow(RangeError);
  });

  test("a session awake all day costs the same either way", () => {
    expect(sessionsMonth(r, 3, 24, "kept-up")).toBeCloseTo(sessionsMonth(r, 3, 24, "asleep"), 9);
  });
});

describe("the month and its break-even", () => {
  test("positive control: 100 tickets at $2.97, sessions $28.58 and the $5 plan: 297 + 28.58 + 5", () => {
    expect(monthCost(100, 2.97, 28.58, 5)).toBeCloseTo(330.58, 9);
  });

  test("negative control: no tickets cost the sessions and the plan only, and a negative count is an error", () => {
    expect(monthCost(0, 2.97, 28.58, 5)).toBeCloseTo(33.58, 9);
    expect(() => monthCost(-1, 2.97, 0, 5)).toThrow(RangeError);
  });

  test("with no sessions it is the old break-even: ($50 - $5) / $2.97", () => {
    expect(breakEvenTickets(50, 2.97, 0, 5)).toBeCloseTo(45 / 2.97, 9);
  });

  test("negative control: sessions that already cost more than the flat price have no break-even, and neither does a free ticket", () => {
    expect(breakEvenTickets(100, 2.97, 257, 5)).toBeNull();
    expect(breakEvenTickets(100, 0, 0, 5)).toBeNull();
  });

  test("ticketCost adds the plane to the launches", () => {
    expect(ticketCost(2.92, 0.05)).toBeCloseTo(2.97, 12);
  });

  test("the control plane: 10,000 requests at $0.15 a million and 1,000 steps at $0.80 per 100,000 is $0.0095", () => {
    expect(controlPlane({ requests: 10_000, workflowSteps: 1_000 })).toBeCloseTo(0.0095, 9);
    expect(controlPlane({ requests: 0, workflowSteps: 0 })).toBe(0);
  });
});

describe("overflowSeconds", () => {
  const hist = { 0: 10, 1: 20, 2: 5, 3: 2 };

  test("positive control, by hand: above 1 is 1 x 5 + 2 x 2 = 9, above 0 is 20 + 10 + 6 = 36", () => {
    expect(overflowSeconds(hist, 1)).toBe(9);
    expect(overflowSeconds(hist, 0)).toBe(36);
  });

  test("negative control: above the peak, or of nothing, is zero", () => {
    expect(overflowSeconds(hist, 3)).toBe(0);
    expect(overflowSeconds({}, 0)).toBe(0);
  });
});

describe("monthlyPace", () => {
  test("18 runs over 6 days is 90 a month", () => {
    expect(monthlyPace(18, 6)).toBe(90);
  });

  test("negative control: a span with no length has no pace", () => {
    expect(monthlyPace(18, 0)).toBe(0);
  });
});

describe("tables", () => {
  const sessions = { asleep: 28.58, keptUp: 257.4 };

  test("the month table has a row for each pace and three treatments", () => {
    const text = monthTable([20, 60], 2.97, sessions, 5);
    const rows = text.split("\n");
    expect(rows).toHaveLength(4);
    expect(rows[2]).toBe("| 20 | 64.4 | 93.0 | 322 |");
  });

  test("the flat table says never where the sessions alone cost more", () => {
    const text = flatTable([50, 100], 2.97, sessions, 5);
    const rows = text.split("\n");
    expect(rows[2]).toBe("| $50 | 15 | 5 | never |");
    expect(rows[3]).toBe("| $100 | 31 | 22 | never |");
  });

  test("the peaks table prices the launch-hours above each count", () => {
    const text = peaksTable([1], { 0: 10, 1: 20, 2: 3600, 3: 0 }, 7200, 0.1, 1);
    const rows = text.split("\n");
    // above 1: (2 - 1) x 3600 s = 1 launch-hour, half of the 7,200 launch-seconds, $0.10, $3.0 a month
    expect(rows[2]).toBe("| 1 | 1.0 | 50% | 0.10 | 3.00 |");
  });
});
