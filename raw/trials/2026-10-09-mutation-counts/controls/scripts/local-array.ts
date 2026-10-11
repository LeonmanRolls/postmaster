// The page's negative control for the first count: builds a local array and returns it.
export function pair(n: number): number[] {
  const out: number[] = [];
  out.push(n);
  out.push(n + 1);
  return out;
}
