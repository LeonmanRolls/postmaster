import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

type Version = readonly [number, number, number];

function parseVersion(value: string): Version | null {
  const match = /^([0-9]+)\.([0-9]+)\.([0-9]+)(?:[-+].*)?$/u.exec(value);
  if (match === null) return null;
  const version = [Number(match[1]), Number(match[2]), Number(match[3])] as const;
  return version.every(Number.isSafeInteger) ? version : null;
}

export function versionAtLeast(found: string, minimum: string): boolean {
  const have = parseVersion(found);
  const need = parseVersion(minimum);
  if (have === null || need === null) return false;
  for (let i = 0; i < 3; i++) {
    if (have[i]! > need[i]!) return true;
    if (have[i]! < need[i]!) return false;
  }
  return true;
}

export function minimumBunVersion(manifestText: string): string {
  const manifest = JSON.parse(manifestText) as { engines?: { bun?: unknown } };
  const engine = manifest.engines?.bun;
  const match = typeof engine === "string" ? /^>=([0-9]+[.][0-9]+[.][0-9]+)$/u.exec(engine) : null;
  if (match === null || parseVersion(match[1]!) === null) {
    throw new Error("package.json engines.bun must be a >=major.minor.patch range");
  }
  return match[1]!;
}

export function checkBunVersion(found: string, manifestText: string): string | null {
  const minimum = minimumBunVersion(manifestText);
  return versionAtLeast(found, minimum)
    ? null
    : `postmaster requires Bun ${minimum} or newer; found ${found}`;
}

export function toolPackageJson(): string {
  return fileURLToPath(new URL("../../package.json", import.meta.url));
}

export function readToolMinimum(): string {
  return minimumBunVersion(readFileSync(toolPackageJson(), "utf8"));
}
