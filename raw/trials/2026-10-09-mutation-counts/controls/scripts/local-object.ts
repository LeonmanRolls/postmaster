// An object built by property assignment; a copy changed in place; a new map filled.
export function build(): Record<string, number> {
  const o: Record<string, number> = {};
  o.a = 1;
  o.b = 2;
  return o;
}
export function sortedCopy(xs: number[]): number[] {
  const copy = [...xs];
  copy.sort();
  return copy;
}
export function reversedSlice(xs: number[]): number[] {
  const c = xs.slice();
  c.reverse();
  return c;
}
export function filled(): Map<string, number> {
  const m = new Map<string, number>();
  m.set("k", 1);
  return m;
}
