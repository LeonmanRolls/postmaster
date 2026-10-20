// Helpers for the #169 oracle beside it: the hold command spawned as a
// subprocess, and the reading of the steps the postmaster's instructions
// give itself. Nothing here imports the change under test.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run, type RunResult } from "./lib/proc.ts";

import {
  SELF,
  configFor,
  envFor,
  mkRun,
  scratch,
  statusNext,
  watch,
} from "./acceptance-168.ts";

export { SELF, configFor, envFor, mkRun, scratch, statusNext, watch };

/** The hold command the change adds, spawned as the ticket's checks run it. */
export function hold(root: string, cfg: string, ticket: string, helper: string): RunResult {
  return run(SELF, ["runs-hold", "hold", root, ticket, "--helper", helper], {
    env: envFor(cfg),
  });
}

export function release(root: string, cfg: string, ticket: string): RunResult {
  return run(SELF, ["runs-hold", "release", root, ticket], { env: envFor(cfg) });
}

export function releaseStale(root: string, cfg: string): RunResult {
  return run(SELF, ["runs-hold", "release-stale", root], { env: envFor(cfg) });
}

/** The held file's lines, untrimmed, for exact-format assertions. */
export function heldLines(root: string): string[] {
  const text = readFileSync(join(root, "postmaster", "held"), "utf8");
  return text.split("\n").filter((line) => line !== "");
}

/** The current postmaster session token the hold command keeps. */
export function sessionToken(root: string): string {
  return readFileSync(join(root, "postmaster", "session"), "utf8").trim();
}

/**
 * Strip the helper briefs: fenced blocks whose info string is `helper`. A
 * brief closes on a bare fence at least as long as its opener, as Markdown
 * closes it, so a brief nests other blocks only under a longer fence.
 */
export function stripHelperBriefs(markdown: string): string {
  const out: string[] = [];
  let openLen = 0;
  for (const line of markdown.split("\n")) {
    const fence = line.match(/^(`{3,})(\S*)\s*$/u);
    if (fence !== null) {
      const len = fence[1]?.length ?? 0;
      const info = fence[2] ?? "";
      if (openLen === 0 && info === "helper") {
        openLen = len;
        continue;
      }
      if (openLen > 0 && len >= openLen && info === "") {
        openLen = 0;
        continue;
      }
    }
    if (openLen === 0) out.push(line);
  }
  return out.join("\n");
}

/** The tool scripts the postmaster's own steps name, in first-seen order. */
export function selfScripts(postmasterMd: string): string[] {
  const seen = new Set<string>();
  const stripped = stripHelperBriefs(postmasterMd);
  for (const match of stripped.matchAll(/<tool>\/scripts\/run ([a-z-]+)/gu)) {
    const name = match[1];
    if (name !== undefined && !seen.has(name)) seen.add(name);
  }
  return [...seen];
}
