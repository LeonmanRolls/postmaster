// Control, positive for every rule: each rule of the check once, and the forms around it that a
// scanner can get wrong. The file is only read by the check, never run. It holds 30 places:
// 11 imports and 19 reads or calls, each of the 15 rules at least once.
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { statSync } from "fs";
import {
  existsSync,
  mkdirSync,
} from "node:fs";
import type { Stats } from "node:fs";
import "node:os";
export * from "node:os";
export const lazy = () => import("node:fs");
export const old = () => require("child_process");

const a = 8;
const b = 2;
export const reads = [
  process.env,
  import.meta.env,
  Bun.env,
  Date.now(),
  performance.now(),
  new Date(),
  Bun.file("x"),
  Bun.write("x", "y"),
  Bun.spawn(["true"]),
  Bun.spawnSync(["true"]),
  Bun.$`true`,
  `${process.env.HOME}`,
  `${`${Date.now()}`}`,
  process?.env,
  process["env"],
  new Date,
  { ...process.env },
  (a + b) / 2 + Date.now(),
  /["']/u.test(String(process.env.NAME)),
];

export const used = [readFileSync, readFile, spawnSync, tmpdir, statSync, existsSync, mkdirSync];
export type Used = Stats;
