// What a function touches, for the tags: each function changes its argument once, and reads or
// uses one thing that the page's exemption for edge code names.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { hostname } from "node:os";
export function readsEnv(xs: string[]): void {
  xs.push(process.env.HOME ?? "");
}
export function readsClock(xs: number[]): void {
  xs.push(Date.now());
}
export function readsFile(xs: string[]): void {
  xs.push(readFileSync("x", "utf8"));
}
export function startsProcess(xs: string[]): void {
  xs.push(String(spawnSync("true").status));
}
export function readsOs(xs: string[]): void {
  xs.push(hostname());
}
export function readsNothing(xs: number[]): void {
  xs.push(1);
}
export function bunFile(xs: unknown[]): void {
  xs.push(Bun.file("x"));
}
export function givenClock(xs: number[], at: number): void {
  xs.push(new Date(at).getTime());
}
export function newDate(xs: Date[]): void {
  xs.push(new Date());
}
