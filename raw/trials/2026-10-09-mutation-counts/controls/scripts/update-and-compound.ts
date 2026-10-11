// ++ and compound assignment on properties of an argument.
export function count(state: { n: number; total: number }): void {
  state.n++;
  state.total += 2;
}
