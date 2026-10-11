// The array a rest parameter collects is new; an element it holds is the caller's.
export function own(...args: number[]): number[] {
  args.push(1);
  return args;
}
export function element(...args: { n: number }[]): void {
  args[0].n = 1;
}
