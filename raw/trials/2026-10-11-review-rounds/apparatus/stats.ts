// The few statistics the record uses, with no dependency (see ../method.md). Pure.

export const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

export const mean = (xs: readonly number[]): number =>
  xs.length === 0 ? Number.NaN : sum(xs) / xs.length;

/** The median of a list, the mean of the two middle values where the count is even. */
export function median(xs: readonly number[]): number {
  if (xs.length === 0) return Number.NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1
    ? (s[mid] as number)
    : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

/** The value at the given share of the sorted list, by the nearest rank. */
export function quantile(xs: readonly number[], q: number): number {
  if (xs.length === 0) return Number.NaN;
  const s = [...xs].sort((a, b) => a - b);
  const at = Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1));
  return s[at] as number;
}

/** Ranks from 1, tied values sharing their mean rank. */
export function ranks(xs: readonly number[]): number[] {
  const order = xs.map((_, i) => i).sort((a, b) => (xs[a] as number) - (xs[b] as number));
  const out = Array.from({ length: xs.length }, () => 0);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && xs[order[j + 1] as number] === xs[order[i] as number]) j += 1;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) out[order[k] as number] = r;
    i = j + 1;
  }
  return out;
}

/** Spearman's rank correlation, with ties; NaN where either list is constant. */
export function spearman(xs: readonly number[], ys: readonly number[]): number {
  if (xs.length !== ys.length || xs.length < 3) return Number.NaN;
  const rx = ranks(xs);
  const ry = ranks(ys);
  const mx = mean(rx);
  const my = mean(ry);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < rx.length; i += 1) {
    const a = (rx[i] as number) - mx;
    const b = (ry[i] as number) - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? Number.NaN : num / den;
}

/** A small seeded generator, so a permutation test gives the same answer each time. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * A one-sided permutation p-value that the mean of `a` is greater than the mean of `b`, from
 * `draws` shuffles of the pooled values under a fixed seed.
 */
export function permutationP(
  a: readonly number[],
  b: readonly number[],
  draws = 20000,
  seed = 400,
): number {
  if (a.length === 0 || b.length === 0) return Number.NaN;
  const pooled = [...a, ...b];
  const observed = mean(a) - mean(b);
  const next = rng(seed);
  let atLeast = 0;
  const work = [...pooled];
  for (let d = 0; d < draws; d += 1) {
    for (let i = work.length - 1; i > 0; i -= 1) {
      const j = Math.floor(next() * (i + 1));
      const t = work[i] as number;
      work[i] = work[j] as number;
      work[j] = t;
    }
    const diff = mean(work.slice(0, a.length)) - mean(work.slice(a.length));
    if (diff >= observed - 1e-12) atLeast += 1;
  }
  return (atLeast + 1) / (draws + 1);
}

/** The Wilson 95% interval of a share. */
export function wilson(successes: number, n: number): [number, number] {
  if (n === 0) return [Number.NaN, Number.NaN];
  const z = 1.96;
  const p = successes / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const w = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(c - w) / d, (c + w) / d];
}

/** Cohen's kappa for two readers' labels of the same items. */
export function kappa(a: readonly string[], b: readonly string[]): number {
  const n = a.length;
  if (n === 0 || n !== b.length) return Number.NaN;
  let agree = 0;
  const ca = new Map<string, number>();
  const cb = new Map<string, number>();
  for (let i = 0; i < n; i += 1) {
    const x = a[i] as string;
    const y = b[i] as string;
    if (x === y) agree += 1;
    ca.set(x, (ca.get(x) ?? 0) + 1);
    cb.set(y, (cb.get(y) ?? 0) + 1);
  }
  const po = agree / n;
  let pe = 0;
  for (const [label, count] of ca) pe += (count / n) * ((cb.get(label) ?? 0) / n);
  return pe === 1 ? 1 : (po - pe) / (1 - pe);
}

/** A share as a whole percent, or an en dash where there is nothing to divide. */
export const pct = (part: number, whole: number): string =>
  whole === 0 ? "–" : `${Math.round((100 * part) / whole)}%`;
