// Path anchors shared by the scripts: where a script lives, and what the tool root is.

import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";

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
