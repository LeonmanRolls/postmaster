// Destructuring assignment writes to each target; a destructured parameter is an argument.
export function swap(o: { a: number; b: number }): void {
  [o.a, o.b] = [o.b, o.a];
}
export function viaPattern({ items }: { items: number[] }): void {
  items.push(1);
}
