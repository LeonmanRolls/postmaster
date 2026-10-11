// A local that holds what a call returned is not known to be another name for anything.
declare function makeList(): number[];
export function fromCall(): number[] {
  const out = makeList();
  out.push(1);
  return out;
}
