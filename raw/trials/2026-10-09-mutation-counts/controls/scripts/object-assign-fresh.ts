// Object.assign into a new object changes nothing the function did not create.
export function merge(a: object, b: object): object {
  return Object.assign({}, a, b);
}
