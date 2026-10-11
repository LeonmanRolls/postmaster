// A local that has the name of an argument is not the argument.
export function shadow(list: number[]): number {
  {
    const list = [] as number[];
    list.push(1);
  }
  return list.length;
}
