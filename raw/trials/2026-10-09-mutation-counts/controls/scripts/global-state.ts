// Changes to a global object: the process environment and exit code.
export function setHome(dir: string): void {
  process.env.HOME = dir;
}
export function fail(): void {
  process.exitCode = 1;
}
