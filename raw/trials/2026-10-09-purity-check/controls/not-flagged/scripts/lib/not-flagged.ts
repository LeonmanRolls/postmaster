// Control, negative for the scanner: the names the check looks for, where they are not code that
// reads or reaches anything. The file is only read by the check, never run. Nothing is flagged.
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// process.env Date.now() new Date() import fs from "node:fs" Bun.file performance.now import.meta.env
/* process.env Date.now() new Date() "node:fs" Bun.spawn(["true"]) Bun.$ performance.now
   Bun.write Bun.env require("child_process") */
export const inDouble = "process.env Date.now() new Date() import fs from 'node:fs' Bun.file";
export const inSingle = 'Bun.write performance.now() import.meta.env "node:os"';
export const inTemplateText = `process.env Date.now() new Date() node:fs Bun.spawn ${1 + 1} Bun.env`;
export const inRegex = /process\.env|Date\.now\(\)|["'`]node:fs["'`]|Bun\.file|\/\/ x/u;
export const regexWithQuotes = /["']/u;
export const afterDivision = (8 + 2) / 2 / 5;
export const notTheGlobals = { process: { env: 1 }, Date: { now: 2 }, Bun: { file: 3 } };
export const throughAnObject = [
  notTheGlobals.process.env,
  notTheGlobals.Date.now,
  notTheGlobals?.Bun.file,
];
export const withAnArgument = [new Date(0), new Date("2026-10-09"), new Date(2026, 9, 9)];
export const otherNames = [Bun.sleep(1), Bun.which("git"), Bun.version, Bun.argv];
export const unrelated = [join, fileURLToPath];
