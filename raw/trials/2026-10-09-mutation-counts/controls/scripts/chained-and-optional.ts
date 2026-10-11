// A copy sorted in the same expression is new; an optional call on an argument is a change to it.
export function sortedKeys(o: Record<string, number>): string[] {
  return Object.keys(o).sort();
}
export function maybePush(xs?: number[]): void {
  xs?.push(1);
}
