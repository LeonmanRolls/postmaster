import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { run } from "./lib/proc.ts";

const SCRIPT = join(import.meta.dir, "spec-decisions.sh");
const SCRATCH = join(resolve(import.meta.dir, ".."), ".postmaster", "verify");

function withDispatch<T>(body: (dispatch: string) => T): T {
  mkdirSync(SCRATCH, { recursive: true });
  const root = mkdtempSync(join(SCRATCH, "spec-decisions-test-"));
  const dispatch = join(root, "project", ".postmaster", "runs", "RUN-1");
  mkdirSync(dispatch, { recursive: true });
  writeFileSync(
    join(dispatch, "manifest.json"),
    JSON.stringify({ lanes: { alpha: {}, beta: {} } }) + "\n",
  );
  try {
    return body(dispatch);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function cli(dispatch: string, ...args: string[]) {
  return run(SCRIPT, [dispatch, ...args]);
}

function output(result: ReturnType<typeof run>): string {
  return result.out.replace(/\n+$/u, "");
}

test("a run-level changes round and approval each count one spec", () =>
  withDispatch((dispatch) => {
    expect(cli(dispatch, "fresh").code).toBe(0);

    const changes = cli(dispatch, "record", "changes", "spec-1", "narrow", "the", "scope");
    expect(changes.code).toBe(0);
    expect(readFileSync(join(dispatch, "spec-decisions.md"), "utf8")).toContain(
      "## spec\ndecision: changes\ncommit: spec-1\nwords: narrow the scope",
    );
    expect(output(cli(dispatch, "count"))).toBe("approved 0\nchanges 1");

    expect(cli(dispatch, "fresh").code).toBe(0);
    const approval = cli(dispatch, "record", "approved", "spec-2");
    expect(approval.code).toBe(0);
    expect(output(cli(dispatch, "count"))).toBe("approved 1\nchanges 0");

    const events = readFileSync(join(dispatch, "actions.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events.map((event) => [event.action, event.target, event.detail])).toEqual([
      ["spec-review", "spec", "changes spec-1 narrow the scope"],
      ["spec-review", "spec", "approved spec-2"],
    ]);
  }));

test("a stop counts neither approval nor changes and only one decision fits a package", () =>
  withDispatch((dispatch) => {
    expect(cli(dispatch, "fresh").code).toBe(0);
    expect(cli(dispatch, "record", "dropped", "spec-1", "stop this run").code).toBe(0);
    expect(output(cli(dispatch, "count"))).toBe("approved 0\nchanges 0");
    const duplicate = cli(dispatch, "record", "approved", "spec-2");
    expect(duplicate.code).toBe(2);
    expect(duplicate.err).toContain("already recorded");
  }));

test("a decisions file from a pre-change run still counts one change per lane", () =>
  withDispatch((dispatch) => {
    writeFileSync(
      join(dispatch, "spec-decisions.md"),
      "## alpha\ndecision: changes\ncommit: old-a\nwords: change alpha\n\n" +
        "## beta\ndecision: changes\ncommit: old-b\nwords: change beta\n\n",
    );
    expect(output(cli(dispatch, "count"))).toBe("approved 0\nchanges 2");
  }));

test("legacy lane recording remains available to the pinned protocol", () =>
  withDispatch((dispatch) => {
    expect(cli(dispatch, "fresh").code).toBe(0);
    expect(cli(dispatch, "record", "alpha", "approved", "old-a").code).toBe(0);
    expect(output(cli(dispatch, "count"))).toBe("approved 1\nchanges 0");
  }));
