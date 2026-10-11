// The control: the page's own law for 202/bug-2, written with hindsight by the session that ran
// the trial, not by the blind writer, and counted toward nothing. The writes found in two
// commands joined by a newline are the union of the writes found in each. It must pass at
// b8056c9 and fail at b8056c9 with the newline taken out of splitShell's separators.
// run-laws.ts supplies ./classifier.ts, pointing at the version under test.
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as fc from "fast-check";
import { commandTouches, type RunInfo } from "./classifier.ts";

interface Layout {
  root: string;
  own: string;
  info: RunInfo;
}

function layout(): Layout {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "control-367-")));
  const repo = join(root, "repo");
  const own = join(repo, ".worktrees", "T-lane");
  const home = join(root, "home");
  const tool = join(root, "tool");
  const dispatch = join(repo, ".postmaster", "runs", "T");
  for (const dir of [own, home, tool, dispatch]) mkdirSync(dir, { recursive: true });
  const info: RunInfo = {
    dispatch,
    repo,
    ticket: "T",
    run: {},
    config: {},
    lanes: {},
    manifest: {},
    defaultBranch: "main",
    tool,
    home,
  };
  return { root, own, info };
}

// One simple command: no cd, quoting, substitution or variable, so its meaning cannot carry
// across the newline. Every path is in the main checkout, outside the lane's folder.
function command(repo: string): fc.Arbitrary<string> {
  const path = fc.constantFrom("f1", "f2", "d/f3").map((p) => join(repo, p));
  const read = fc.tuple(fc.constantFrom("cat", "ls", "head", "wc -l"), path).map(([v, p]) => `${v} ${p}`);
  const write = fc.tuple(fc.constantFrom("touch", "rm", "mkdir -p", "tee"), path).map(([v, p]) => `${v} ${p}`);
  const redirect = path.map((p) => `echo x > ${p}`);
  return fc.oneof(read, write, redirect);
}

function writes(cmd: string, l: Layout): string[] {
  const found = commandTouches(cmd, "", 0, l.info, "lane", l.own, "");
  return [...new Set(found.filter((t) => t.access === "write").map((t) => t.path))].sort();
}

export const laws = [
  {
    name: "newline union (control)",
    statement:
      "The writes found in two commands joined by a newline are the union of the writes found in each.",
    check: (): void => {
      const l = layout();
      try {
        const cmd = command(l.info.repo);
        fc.assert(
          fc.property(cmd, cmd, (a, b) => {
            const joined = writes(`${a}\n${b}`, l);
            const union = [...new Set([...writes(a, l), ...writes(b, l)])].sort();
            return JSON.stringify(joined) === JSON.stringify(union);
          }),
          { numRuns: 300 },
        );
      } finally {
        rmSync(l.root, { recursive: true, force: true });
      }
    },
  },
];
