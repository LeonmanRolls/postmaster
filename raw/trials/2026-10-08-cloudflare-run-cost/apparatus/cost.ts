// What a container costs per second on Cloudflare, and what a set of launches costs (see ../method.md).
// The rates and instance types are copied from the Containers documentation, read on 2026-10-08 at
// cloudflare-docs commit 6e1b96433cf016efd2c0c9057a7e27a8e112376f:
//   src/content/docs/containers/platform/pricing.mdx  (rates, and "Memory and disk usage are based on
//     the provisioned resources for the instance type you select, while CPU usage is based on active
//     usage only")
//   src/content/partials/containers/instance-types.mdx  (the six instance types)
// Pure functions: the rates are arguments with these as defaults.

export type InstanceType = { vcpu: number; memoryGib: number; diskGb: number };

export const INSTANCE_TYPES: Record<string, InstanceType> = {
  lite: { vcpu: 1 / 16, memoryGib: 0.25, diskGb: 2 },
  basic: { vcpu: 1 / 4, memoryGib: 1, diskGb: 4 },
  "standard-1": { vcpu: 1 / 2, memoryGib: 4, diskGb: 8 },
  "standard-2": { vcpu: 1, memoryGib: 6, diskGb: 12 },
  "standard-3": { vcpu: 2, memoryGib: 8, diskGb: 16 },
  "standard-4": { vcpu: 4, memoryGib: 12, diskGb: 20 },
};

export type Rates = {
  /** dollars per GiB-second of provisioned memory */
  memoryPerGibSecond: number;
  /** dollars per vCPU-second of active use */
  cpuPerVcpuSecond: number;
  /** dollars per GB-second of provisioned disk */
  diskPerGbSecond: number;
};

export const RATES: Rates = {
  memoryPerGibSecond: 0.0000025,
  cpuPerVcpuSecond: 0.00002,
  diskPerGbSecond: 0.00000007,
};

/** What the Workers Paid plan includes each month, in the units the rates use. */
export const INCLUDED_PER_MONTH = {
  memoryGibHours: 25,
  cpuVcpuMinutes: 375,
  diskGbHours: 200,
} as const;

/** The Workers Paid plan's monthly minimum, in dollars (docs/workers/platform/pricing.mdx, read 2026-10-08). */
export const PLAN_FEE_PER_MONTH = 5;

/**
 * Dollars per second of one running instance. Memory and disk are charged for what the type
 * provisions; CPU for `cpuUse`, the fraction (0 to 1) of the type's vCPUs that are busy.
 */
export function perSecond(type: InstanceType, cpuUse: number, rates: Rates = RATES): number {
  if (cpuUse < 0 || cpuUse > 1) throw new RangeError(`cpuUse must be between 0 and 1: ${cpuUse}`);
  return (
    type.memoryGib * rates.memoryPerGibSecond +
    type.diskGb * rates.diskPerGbSecond +
    type.vcpu * cpuUse * rates.cpuPerVcpuSecond
  );
}

/** Dollars for the given seconds of one instance type. */
export const cost = (
  secondsRun: number,
  type: InstanceType,
  cpuUse: number,
  rates: Rates = RATES,
): number => secondsRun * perSecond(type, cpuUse, rates);

/** Dollars per hour of one running instance. */
export const perHour = (type: InstanceType, cpuUse: number, rates: Rates = RATES): number =>
  3600 * perSecond(type, cpuUse, rates);

/** Instance-hours of memory that the monthly allowance covers, for one instance type. */
export const allowanceInstanceHours = (type: InstanceType): number =>
  INCLUDED_PER_MONTH.memoryGibHours / type.memoryGib;
