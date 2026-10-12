// Path anchors shared by the scripts: where a script lives, and what the tool root is.

import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, join, normalize, resolve } from "node:path";

/** Directory of the calling script: <tool>/scripts. */
export function scriptsDir(meta: ImportMeta): string {
  return dirname(realpathSync(meta.path));
}

/** Tool root (the checkout) from the calling script's directory. */
export function toolRoot(meta: ImportMeta): string {
  return dirname(scriptsDir(meta));
}

/** Absolute path beside the calling script. */
export function beside(meta: ImportMeta, name: string): string {
  return join(scriptsDir(meta), name);
}

/**
 * The path with its existing prefix resolved: symlinks in what exists are
 * real, and what does not exist yet stays lexical, so a removed scratch and
 * a live checkout compare alike.
 */
export function physical(path: string): string {
  const absolute = resolve(path);
  const suffix: string[] = [];
  let probe = absolute;
  while (!existsSync(probe)) {
    const parent = dirname(probe);
    if (parent === probe) return normalize(absolute);
    suffix.unshift(basename(probe));
    probe = parent;
  }
  try {
    return normalize(join(realpathSync(probe), ...suffix));
  } catch {
    return normalize(absolute);
  }
}
