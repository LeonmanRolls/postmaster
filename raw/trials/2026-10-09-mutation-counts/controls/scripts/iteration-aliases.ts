// A loop over a copy still hands out the original's elements; sorting the copy is the function's own.
export function overFilter(list: { done: boolean }[]): void {
  for (const x of list.filter((e) => !e.done)) x.done = true;
}
export function overEntries(opts: Record<string, { n: number }>): void {
  for (const [, v] of Object.entries(opts)) v.n = 1;
}
export function sortedEntries(env: Record<string, string>): [string, string][] {
  return Object.entries(env).sort();
}
