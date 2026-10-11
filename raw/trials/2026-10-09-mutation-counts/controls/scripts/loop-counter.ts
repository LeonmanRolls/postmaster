// A loop counter is a local that is given a new value.
export function sum(xs: number[]): number {
  let total = 0;
  for (let i = 0; i < xs.length; i++) {
    total += xs[i] as number;
  }
  return total;
}
