// The delete operator on a property of an argument.
export function drop(o: Record<string, number>): void {
  delete o.key;
}
