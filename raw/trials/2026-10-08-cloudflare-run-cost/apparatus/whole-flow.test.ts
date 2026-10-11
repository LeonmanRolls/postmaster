import { describe, expect, test } from "bun:test";
import type { Rate } from "./providers.ts";
import {
  admitted,
  breakEvenTickets,
  controlPlane,
  DURABLE_OBJECT_PER_HOUR,
  flatTable,
  type Launch,
  monthCost,
  monthTable,
  monthlyPace,
  overflowSeconds,
  peaksTable,
  sessionRates,
  sessionsMonth,
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

  test("what stands in front of the container is added to both rates", () => {
    const r = sessionRates(cloudflare, DURABLE_OBJECT_PER_HOUR);
    expect(r.awake).toBeCloseTo(0.05292 + 0.005625, 9);
    expect(r.idle).toBeCloseTo(0.03852 + 0.005625, 9);
  });

  test("a rate that charges every vCPU charges an idle session the same as an awake one", () => {
    const r = sessionRates(flat);
    expect(r.idle).toBeCloseTo(r.awake, 12);
  });

  test("the Durable Object hour: 128 MB, $12.50 per million GB-seconds, 3600 seconds", () => {
    expect(DURABLE_OBJECT_PER_HOUR).toBeCloseTo(0.005625, 9);
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

  test("round trip: at the break-even the month costs the flat price, one ticket fewer less, one more more", () => {
    const n = breakEvenTickets(100, 2.97, 28.58, 5) as number;
    expect(monthCost(n, 2.97, 28.58, 5)).toBeCloseTo(100, 9);
    expect(monthCost(n - 1, 2.97, 28.58, 5)).toBeLessThan(100);
    expect(monthCost(n + 1, 2.97, 28.58, 5)).toBeGreaterThan(100);
  });

  test("negative control: sessions that already cost more than the flat price have no break-even", () => {
    expect(breakEvenTickets(100, 2.97, 257, 5)).toBeNull();
  });

  test("a ticket that costs nothing is cheaper at every pace, not never", () => {
    expect(breakEvenTickets(100, 0, 0, 5)).toBe(Number.POSITIVE_INFINITY);
  });

  test("the control plane: 10,000 requests, 1,000 steps and 10 Durable Object hours is $0.0095 + $0.05625", () => {
    expect(controlPlane({ requests: 10_000, workflowSteps: 1_000, doHours: 10 })).toBeCloseTo(0.0095 + 0.05625, 9);
    expect(controlPlane({ requests: 0, workflowSteps: 0, doHours: 0 })).toBe(0);
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

describe("admitted", () => {
  const launches: Launch[] = [
    { start: 0, end: 100, kind: "lanes" },
    { start: 10, end: 60, kind: "reviewers" },
    { start: 20, end: 40, kind: "gates" },
    { start: 70, end: 90, kind: "reviewers" },
  ];

  test("positive control, by hand: with room for 2, the gate that starts while two run goes to the cloud for its 20 seconds", () => {
    expect(admitted(launches, 2)).toEqual({ lanes: 0, reviewers: 0, gates: 20 });
  });

  test("with room for 1 the lane holds the place until 100, so both reviewers and the gate go: 50 + 20 and 20", () => {
    expect(admitted(launches, 1)).toEqual({ lanes: 0, reviewers: 70, gates: 20 });
  });

  test("a launch that starts after another ended finds room: with room for 2 the reviewer at 70 fits beside the lane", () => {
    expect(admitted(launches, 2).reviewers).toBe(0);
  });

  test("negative control: room for every launch sends none, and room for none sends all", () => {
    expect(admitted(launches, 3)).toEqual({ lanes: 0, reviewers: 0, gates: 0 });
    expect(admitted(launches, 0)).toEqual({ lanes: 100, reviewers: 70, gates: 20 });
  });

  test("launches that start in the same second: the order changes who goes, not how many places are taken", () => {
    const together: Launch[] = [
      { start: 0, end: 10, kind: "reviewers" },
      { start: 0, end: 30, kind: "gates" },
    ];
    expect(admitted(together, 1, "shorter-first")).toEqual({ lanes: 0, reviewers: 0, gates: 30 });
    expect(admitted(together, 1, "longer-first")).toEqual({ lanes: 0, reviewers: 10, gates: 0 });
  });

  test("a launch that ends exactly when another starts does not hold its place", () => {
    const touching: Launch[] = [
      { start: 0, end: 10, kind: "lanes" },
      { start: 10, end: 20, kind: "lanes" },
    ];
    expect(admitted(touching, 1)).toEqual({ lanes: 0, reviewers: 0, gates: 0 });
  });

  test("it never sends less than the least that could go (launches that stay where they started)", () => {
    const hist = { 0: 10, 1: 30, 2: 20, 3: 20, 4: 20 };
    const many: Launch[] = [
      { start: 0, end: 100, kind: "lanes" },
      { start: 10, end: 100, kind: "reviewers" },
      { start: 30, end: 100, kind: "reviewers" },
      { start: 50, end: 100, kind: "gates" },
    ];
    const secs = (k: number): number => Object.values(admitted(many, k)).reduce((a, b) => a + b, 0);
    expect(hist).toBeDefined();
    for (const k of [1, 2, 3]) expect(secs(k)).toBeGreaterThanOrEqual(overflowSeconds({ 0: 10, 1: 20, 2: 20, 3: 50 }, k));
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
  const sessions = { asleep: { low: 28.58, high: 28.58 }, keptUp: { low: 250, high: 257.4 } };
  const perTicket = { low: 1.5, high: 2.97 };

  test("the month table has a row for each pace, each cell from the low ends to the high ends", () => {
    const text = monthTable([20, 60], perTicket, sessions, 5);
    const rows = text.split("\n");
    expect(rows).toHaveLength(4);
    // 20 tickets: launches only 20 x 1.5 + 5 = 35 to 20 x 2.97 + 5 = 64.4
    expect(rows[2]).toBe("| 20 | 35.0 to 64.4 | 63.6 to 93.0 | 285 to 322 |");
  });

  test("a cell whose two ends print alike prints once", () => {
    const text = monthTable([10], { low: 2, high: 2 }, { asleep: { low: 1, high: 1 }, keptUp: { low: 1, high: 1 } }, 5);
    expect(text.split("\n")[2]).toBe("| 10 | 25.0 | 26.0 | 26.0 |");
  });

  test("the flat table gives the tickets from the high costs to the low ones, and never where the sessions alone cost more", () => {
    const text = flatTable([50, 100], perTicket, sessions, 5);
    const rows = text.split("\n");
    // $50, launches only: (50 - 5) / 2.97 = 15 to (50 - 5) / 1.5 = 30
    expect(rows[2]).toBe("| $50 | 15 to 30 | 5 to 10 | never |");
    expect(rows[3]).toBe("| $100 | 31 to 63 | 22 to 44 | never |");
  });

  test("a cell where only the low costs have a break-even says up to, and one where neither has says never", () => {
    const text = flatTable([50, 25], { low: 1.5, high: 2.97 }, { asleep: { low: 10, high: 50 }, keptUp: { low: 60, high: 60 } }, 5);
    const rows = text.split("\n");
    expect(rows[2]).toBe("| $50 | 15 to 30 | up to 23 | never |");
    expect(rows[3]).toBe("| $25 | 6 to 13 | up to 6 | never |");
  });

  test("the peaks table prices the launch-hours sent to the cloud by kind, and gives both orders of launches that start together", () => {
    const launches: Launch[] = [
      { start: 0, end: 3600, kind: "reviewers" },
      { start: 0, end: 7200, kind: "gates" },
    ];
    const text = peaksTable([1], { 0: 0, 1: 3600, 2: 3600 }, launches, { agentHour: 0.05, gateHour: 0.4 }, 1);
    const rows = text.split("\n");
    // room for 1, over 3 launch-hours. Shorter first: the reviewer takes the place and the gate goes, 2 launch-hours,
    // 67%, all gate, 2 x 0.4 = 0.8 over 1 day x 30 = 24.0. Longer first: the gate takes it and the reviewer goes, 1 launch-hour,
    // 33%, no gate, 0.05 x 30 = 1.50. The least that could go is 1 launch-hour above one at once (33.3%).
    expect(rows[2]).toBe("| 1 | 1.0 (33.3%) | 1.0 to 2.0 | 33% to 67% | 0% to 100% | 1.50 to 24.0 |");
  });

  test("a tie order is reported as the same cell when it changes nothing", () => {
    const launches: Launch[] = [{ start: 0, end: 3600, kind: "lanes" }];
    const rows = peaksTable([0], { 0: 0, 1: 3600 }, launches, { agentHour: 0.1, gateHour: 0.4 }, 1).split("\n");
    expect(rows[2]).toBe("| 0 | 1.0 (100.0%) | 1.0 | 100% | 0% | 3.00 |");
  });
});
