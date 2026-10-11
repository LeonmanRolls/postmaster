// Each of the thirteen in-place methods of the ticket's list, called on an argument, once each.
export function a(xs: number[]): void {
  xs.push(1);
}
export function b(xs: number[]): void {
  xs.pop();
}
export function c(xs: number[]): void {
  xs.shift();
}
export function d(xs: number[]): void {
  xs.unshift(1);
}
export function e(xs: number[]): void {
  xs.splice(0, 1);
}
export function f(xs: number[]): void {
  xs.sort();
}
export function g(xs: number[]): void {
  xs.reverse();
}
export function h(xs: number[]): void {
  xs.fill(0);
}
export function i(xs: number[]): void {
  xs.copyWithin(0, 1);
}
export function j(m: Map<string, number>): void {
  m.set("k", 1);
}
export function k(s: Set<number>): void {
  s.add(1);
}
export function l(m: Map<string, number>): void {
  m.delete("k");
}
export function m(s: Set<number>): void {
  s.clear();
}
