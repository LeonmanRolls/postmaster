// Object.assign with an argument as the target changes it.
export function fill(opts: object, defaults: object): void {
  Object.assign(opts, defaults);
}
