// A local that is another name for an argument, or for a part of one, or for an element of one.
export function viaProperty(opts: { items: number[] }): void {
  const items = opts.items;
  items.push(1);
}
export function viaLoop(list: { done: boolean }[]): void {
  for (const entry of list) entry.done = true;
}
export function viaGet(index: Map<string, number[]>): void {
  const row = index.get("k");
  row?.push(1);
}
