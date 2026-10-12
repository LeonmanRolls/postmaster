// Control (D2), negative: the same helper with the environment, the clock and the file reader
// passed in. The check flags nothing.
export function stamp(
  env: Record<string, string | undefined>,
  now: number,
  read: (path: string) => string,
): string {
  const name = env.NAME ?? "none";
  return `${name} ${now} ${read("data.txt").length}`;
}
