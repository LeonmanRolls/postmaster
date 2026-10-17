// Paths named by a pattern with a star in it, such as `packages/*/src` or a workspace's
// `apps/*`. Used by scripts/code-index.ts for the folders it walks and by scripts/lib/stack.ts for
// the folders of a workspace.
import { readdirSync } from "node:fs";
import { join } from "node:path";

/** The paths a pattern names, one `*` per path segment at most matching any run of characters but a slash. */
export function expandPattern(repo: string, pattern: string): string[] {
  let bases = [""];
  for (const segment of pattern.split("/").filter((s) => s !== "")) {
    const next: string[] = [];
    if (!segment.includes("*")) {
      for (const b of bases) next.push(join(b, segment));
    } else {
      const re = new RegExp(
        `^${segment.replace(/[.+?^${}()|[\]\\]/gu, "\\$&").replace(/\*/gu, "[^/]*")}$`,
        "u",
      );
      for (const b of bases) {
        let names: string[] = [];
        try {
          names = readdirSync(join(repo, b));
        } catch {
          continue;
        }
        for (const name of names.sort()) if (re.test(name)) next.push(join(b, name));
      }
    }
    bases = next;
  }
  return bases.map((b) => join(repo, b));
}
