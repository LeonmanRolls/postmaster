// Assigning to an argument itself.
export function orEmpty(xs: number[] | undefined): number[] {
  xs = xs ?? [];
  return xs;
}
