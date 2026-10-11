// The parameter of a callback is an argument of the callback.
export function mark(xs: { done: boolean }[]): void {
  xs.map((x) => {
    x.done = true;
  });
}
