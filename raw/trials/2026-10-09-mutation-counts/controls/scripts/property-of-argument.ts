// An assignment to a property of an argument, and to an element of one.
export function setTimeoutOption(opts: { timeout: number }): void {
  opts.timeout = 5;
}
export function setFirst(xs: number[]): void {
  xs[0] = 1;
}
