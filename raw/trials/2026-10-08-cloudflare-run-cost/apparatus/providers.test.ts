import { describe, expect, test } from "bun:test";
import { INSTANCE_TYPES, type InstanceType, perHour } from "./cost.ts";
import {
  AGENT,
  GATE,
  fits,
  holds,
  hourly,
  type Machine,
  breakEvenRuns,
  machineCost,
  machinesTable,
  profileHours,
  rank,
  type Rate,
  ratesTable,
  runCost,
} from "./providers.ts";

const base = {
  maxVcpu: null,
  maxMemoryGib: null,
  source: "a page",
  read: "a day",
  checked: "two reads" as const,
  note: "",
};

// Cloudflare's rates per hour: 0.00002 x 3600, 0.0000025 x 3600 and 0.00000007 x 3600
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
const flat: Rate = {
  ...base,
  id: "flat",
  name: "Flat",
  vcpuHour: 0.04,
  cpuBilling: "provisioned",
  gibHour: 0.005,
  diskGbHour: 0,
  maxSessionHours: 24,
};
const short: Rate = { ...flat, id: "short", name: "Short", maxSessionHours: 1 };

describe("hourly", () => {
  test("positive control: a gate hour on Cloudflare equals the standard-4 hour of the cost module", () => {
    const standard4 = INSTANCE_TYPES["standard-4"] as InstanceType;
    expect(hourly(cloudflare, GATE)).toBeCloseTo(perHour(standard4, 1), 9);
  });

  test("an agent hour on Cloudflare, worked by hand: 0.2 x 0.072 + 4 x 0.009 + 10 x 0.000252", () => {
    expect(hourly(cloudflare, AGENT)).toBeCloseTo(0.0144 + 0.036 + 0.00252, 9);
  });

  test("a rate that charges every vCPU does not fall with idle CPU, one that charges busy CPU does", () => {
    const idle = { ...AGENT, cpuBusy: 0 };
    expect(hourly(flat, idle)).toBe(hourly(flat, { ...AGENT, cpuBusy: 1 }));
    expect(hourly(cloudflare, idle)).toBeLessThan(hourly(cloudflare, { ...AGENT, cpuBusy: 1 }));
  });

  test("rejects a CPU use outside 0 to 1", () => {
    expect(() => hourly(cloudflare, { ...AGENT, cpuBusy: 1.2 })).toThrow(RangeError);
  });
});

describe("runCost", () => {
  test("12 agent hours and 3 gate hours is the sum of the two", () => {
    expect(runCost(flat, 12, 3)).toBeCloseTo(12 * hourly(flat, AGENT) + 3 * hourly(flat, GATE), 9);
  });

  test("negative control: no hours cost nothing", () => {
    expect(runCost(cloudflare, 0, 0)).toBe(0);
  });
});

describe("holds and rank", () => {
  test("a one-hour session cap cannot hold a 19-hour coachman, and no stated cap can", () => {
    expect(holds(short, 19)).toBe(false);
    expect(holds(flat, 19)).toBe(true);
    expect(holds(cloudflare, 19)).toBe(true);
  });

  test("rank leaves out what cannot hold the longest session and sorts by the cost of a run", () => {
    const ranked = rank([flat, short, cloudflare], 12, 3, 19);
    expect(ranked.map((x) => x.rate.id)).not.toContain("short");
    expect(ranked).toHaveLength(2);
    expect(ranked[0]?.run).toBeLessThanOrEqual(ranked[1]?.run as number);
  });
});

describe("rank order", () => {
  test("negative control: a provider over the size limit sorts after one that fits, even when its sum would be smaller", () => {
    const cheapButSmall: Rate = { ...flat, id: "cheap", name: "Cheap", vcpuHour: 0.001, gibHour: 0.001, maxVcpu: 2, maxMemoryGib: 4 };
    const ranked = rank([cheapButSmall, cloudflare], 12, 3, 19);
    expect(runCost(cheapButSmall, 12, 3)).toBeLessThan(runCost(cloudflare, 12, 3));
    expect(ranked.map((x) => x.rate.id)).toEqual(["cf", "cheap"]);
  });
});

describe("ratesTable", () => {
  test("has a row for each provider that can hold the session, with its checked mark and its cap", () => {
    const text = ratesTable([flat, short, cloudflare], { agentLow: 6, agentHigh: 20, gate: 2.5 }, 19);
    expect(text.split("\n")).toHaveLength(2 + 2);
    expect(text).toContain("| Cloudflare |");
    expect(text).toContain("| two reads | 24 h |");
    expect(text).not.toContain("| Short |");
  });
});

const machine: Machine = {
  id: "m",
  name: "Machine",
  hourly: 0.055,
  shape: "4 vCPU, 8 GiB",
  step: "hour",
  stoppedBilled: true,
  monthly: 40,
  source: "a page",
  read: "a day",
  checked: "two reads",
  note: "",
};

describe("machineCost", () => {
  test("a part hour is a whole hour where billing is by the hour: 27.7 hours is 28", () => {
    expect(machineCost(machine, 27.7)).toBeCloseTo(28 * 0.055, 12);
  });

  test("billing by the second charges the part hour as it is", () => {
    expect(machineCost({ ...machine, step: "second" }, 27.7)).toBeCloseTo(27.7 * 0.055, 12);
  });

  test("negative control: no hours cost nothing, and a negative number of hours is an error", () => {
    expect(machineCost(machine, 0)).toBe(0);
    expect(() => machineCost(machine, -1)).toThrow(RangeError);
  });
});

describe("profileHours", () => {
  test("agent hours are the lanes, reviewers and coachman less the gate, which is its own hours", () => {
    const h = profileHours({ lanesAndReviewers: 10 * 3600, coachman: 30 * 3600, gates: 6 * 3600 });
    expect(h).toEqual({ agent: 34, gate: 6 });
    expect(h.agent + h.gate).toBe(40);
  });
});

describe("breakEvenRuns", () => {
  test("positive control, worked by hand: $40 a month over a 27.7-hour run billed as 28 hours at $0.055 is 40 / 1.54 = 25.97", () => {
    expect(breakEvenRuns(machine, 27.7)).toBeCloseTo(40 / 1.54, 9);
  });

  test("negative control: a machine with no monthly price has no break-even, and neither does a run of no hours", () => {
    expect(breakEvenRuns({ ...machine, monthly: null }, 27.7)).toBeNull();
    expect(breakEvenRuns(machine, 0)).toBeNull();
  });
});

describe("machinesTable", () => {
  test("lists each machine from the cheapest, with the cost of a median run, of all the runs and the runs a month that cost a month", () => {
    const dear: Machine = { ...machine, id: "d", name: "Dear", hourly: 0.1, step: "second", monthly: null };
    const text = machinesTable([dear, machine], { medianHours: 10, lives: [10, 10, 10, 10, 10] });
    const rows = text.split("\n");
    expect(rows).toHaveLength(4);
    expect(rows[2]).toContain("| Machine | 0.055 | 0.550 | 2.75 | 40.0 | 73 | yes | two reads |");
    expect(rows[3]).toContain("| Dear | 0.100 | 1.00 | 5.00 | not entered | n/a | yes | two reads |");
    expect(text).toContain("All 5 runs");
  });

  test("a machine billed by the hour rounds each run up, so the sum of runs exceeds the rate times the total hours", () => {
    const text = machinesTable([machine], { medianHours: 1.5, lives: [1.5, 1.5] });
    // two runs of 1.5 hours are 2 hours each at $0.055, 0.22 in all, not 3 hours at $0.055 = 0.165
    expect(text.split("\n")[2]).toContain("| Machine | 0.055 | 0.110 | 0.220 |");
  });
});

describe("fits", () => {
  test("a profile fits where no limit is known, and where it is within the limits", () => {
    expect(fits(cloudflare, GATE)).toBe(true);
    expect(fits({ ...cloudflare, maxVcpu: 4, maxMemoryGib: 12 }, GATE)).toBe(true);
  });

  test("negative control: a cap of 8 GiB does not hold the 12 GiB gate, and the table says it is over the size limit instead of pricing it", () => {
    const small: Rate = { ...flat, id: "small", name: "Small", maxVcpu: 4, maxMemoryGib: 8 };
    expect(fits(small, GATE)).toBe(false);
    expect(fits(small, AGENT)).toBe(true);
    const text = ratesTable([small], { agentLow: 6, agentHigh: 20, gate: 2.5 }, 19);
    expect(text).toContain("| Small |");
    expect(text).toContain("over the size limit");
  });
});
