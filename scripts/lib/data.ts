// JSON and TOML reads the scripts share. Errors are thrown; callers map them to exit codes.
import { readFileSync } from "node:fs";

export function readJsonFile<T = unknown>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function tryJsonFile<T = unknown>(path: string): T | null {
  try {
    return readJsonFile<T>(path);
  } catch {
    return null;
  }
}

export function parseTomlText(text: string): Record<string, unknown> {
  return Bun.TOML.parse(text);
}

export function readTomlFile(path: string): Record<string, unknown> {
  return parseTomlText(readFileSync(path, "utf8"));
}

export function tryTomlFile(path: string): Record<string, unknown> | null {
  try {
    return readTomlFile(path);
  } catch {
    return null;
  }
}

/** A JSONL file's parsed rows (a trailing newline is normal and is not a row). */
export function readJsonl(path: string): Array<Record<string, unknown>> {
  const text = readFileSync(path, "utf8");
  const rows = text.split("\n").filter((line) => line !== "");
  return rows.map((line) => JSON.parse(line) as Record<string, unknown>);
}
