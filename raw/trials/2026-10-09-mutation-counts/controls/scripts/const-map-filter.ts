// The page's negative control for the second count: only `const`, `map` and `filter`.
export function bigDoubles(xs: readonly number[]): number[] {
  const doubled = xs.map((x) => x * 2);
  const big = doubled.filter((x) => x > 10);
  return big;
}
