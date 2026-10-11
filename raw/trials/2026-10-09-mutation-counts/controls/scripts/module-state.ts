// A module-level variable given a new value, and a module-level collection changed in place.
let counter = 0;
const cache = new Map<string, number>();
export function bump(): number {
  counter++;
  return counter;
}
export function remember(key: string, value: number): void {
  cache.set(key, value);
}
