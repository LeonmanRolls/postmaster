// A callback changes a collection its enclosing function built; the loop form changes it directly.
export function viaCallback(xs: number[]): number[] {
  const out: number[] = [];
  xs.forEach((x) => {
    out.push(x);
  });
  return out;
}
export function viaLoop(xs: number[]): number[] {
  const out: number[] = [];
  for (const x of xs) out.push(x);
  return out;
}
