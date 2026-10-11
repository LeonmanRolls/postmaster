import { describe, expect, test } from "bun:test";
import {
  allowanceInstanceHours,
  cost,
  INSTANCE_TYPES,
  perHour,
  perSecond,
  RATES,
} from "./cost.ts";

const standard4 = INSTANCE_TYPES["standard-4"] as (typeof INSTANCE_TYPES)[string];
const standard2 = INSTANCE_TYPES["standard-2"] as (typeof INSTANCE_TYPES)[string];

describe("perSecond", () => {
  test("memory and disk alone, worked by hand: 12 GiB and 20 GB at standard-4", () => {
    // 12 x 0.0000025 + 20 x 0.00000007 = 0.00003 + 0.0000014
    expect(perSecond(standard4, 0)).toBeCloseTo(0.0000314, 12);
  });

  test("with all four vCPUs busy it is the first look's 0.0001114 a second", () => {
    expect(perSecond(standard4, 1)).toBeCloseTo(0.0001114, 12);
    expect(perHour(standard4, 1)).toBeCloseTo(0.40104, 9);
  });

  test("CPU is charged for use: a quarter busy adds a quarter of the CPU term", () => {
    expect(perSecond(standard4, 0.25)).toBeCloseTo(0.0000314 + 0.25 * 4 * 0.00002, 12);
  });

  test("a smaller type costs less: standard-2, 6 GiB and 12 GB, one vCPU", () => {
    // 6 x 0.0000025 + 12 x 0.00000007 = 0.000015 + 0.00000084
    expect(perSecond(standard2, 0)).toBeCloseTo(0.00001584, 12);
    expect(perSecond(standard2, 0)).toBeLessThan(perSecond(standard4, 0));
  });

  test("rejects a CPU use outside 0 to 1", () => {
    expect(() => perSecond(standard4, 1.5)).toThrow(RangeError);
    expect(() => perSecond(standard4, -0.1)).toThrow(RangeError);
  });
});

describe("cost", () => {
  test("a lane that ran 2001 seconds on standard-4, memory and disk only", () => {
    expect(cost(2001, standard4, 0)).toBeCloseTo(2001 * 0.0000314, 9);
    expect(cost(2001, standard4, 0)).toBeCloseTo(0.0628314, 9);
  });

  test("negative control: zero seconds cost nothing, and so do zero rates", () => {
    expect(cost(0, standard4, 1)).toBe(0);
    const free = { memoryPerGibSecond: 0, cpuPerVcpuSecond: 0, diskPerGbSecond: 0 };
    expect(cost(10_000, standard4, 1, free)).toBe(0);
  });

  test("the default rates are the documented ones", () => {
    expect(RATES).toEqual({
      memoryPerGibSecond: 0.0000025,
      cpuPerVcpuSecond: 0.00002,
      diskPerGbSecond: 0.00000007,
    });
  });
});

describe("allowance", () => {
  test("25 GiB-hours of memory is a little over two hours of a 12 GiB instance", () => {
    expect(allowanceInstanceHours(standard4)).toBeCloseTo(25 / 12, 9);
  });
});
