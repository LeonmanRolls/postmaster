// Tests beside scripts/libraries.ts: the cache merge and the command's
// refusals. The list, facts and record flows sit in the #424 oracle.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./lib/proc.ts";
import { mergeCache } from "./libraries.ts";

const RUN = join(import.meta.dir, "run");

function tool(args: string[]): { code: number; out: string; err: string } {
  const r = run(RUN, args);
  return { code: r.code, out: r.out, err: r.err };
}

function libraries(args: string[]): { code: number; out: string; err: string } {
  return tool(["libraries", ...args]);
}

describe("mergeCache", () => {
  test("adds keys under the covering approval", () => {
    const merged = JSON.parse(
      mergeCache(null, ["is-odd@3.0.1", "is-number@7.0.0"], "library:abc", "424"),
    ) as { version: number; approvals: Record<string, { identity: string; run: string }> };
    expect(merged.version).toBe(1);
    expect(merged.approvals["is-odd@3.0.1"]).toEqual({ identity: "library:abc", run: "424" });
    expect(merged.approvals["is-number@7.0.0"]).toEqual({ identity: "library:abc", run: "424" });
  });

  test("keeps the keys already cached and rebuilds a corrupt cache", () => {
    const kept = JSON.parse(
      mergeCache(
        JSON.stringify({
          version: 1,
          approvals: { "left-pad@1.3.0": { identity: "x", run: "1" } },
        }),
        ["is-odd@3.0.1"],
        "library:abc",
        "424",
      ),
    ) as { approvals: Record<string, unknown> };
    expect(Object.keys(kept.approvals).sort()).toEqual(["is-odd@3.0.1", "left-pad@1.3.0"]);
    const rebuilt = JSON.parse(mergeCache("not json", ["is-odd@3.0.1"], "library:abc", "424")) as {
      approvals: Record<string, unknown>;
    };
    expect(Object.keys(rebuilt.approvals)).toEqual(["is-odd@3.0.1"]);
  });
});

describe("libraries usage", () => {
  test("an unknown subcommand is a usage error", () => {
    const r = libraries(["invent"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("usage:");
  });

  test("record without a dispatch is a usage error", () => {
    const r = libraries(["record", "is-odd", "3.0.1"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("usage:");
  });

  test("record refuses a version that is not exact", () => {
    const r = libraries(["record", "is-odd", "^3.0.1", "--dispatch", "nowhere"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("not an exact version");
  });

  test("list refuses a ticket file that does not exist", () => {
    const r = libraries(["list", "--ticket", "nowhere.md"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("no such ticket file");
  });

  test("record --vendored caches an approved copy without running an install", () => {
    const runs = mkdtempSync(join(tmpdir(), "postmaster-libraries-"));
    const dispatch = join(runs, "424");
    mkdirSync(dispatch, { recursive: true });
    const wt = mkdtempSync(join(tmpdir(), "postmaster-libraries-wt-"));
    try {
      const id = libraries(["identity", "@babel/parser", "7.10.0"]);
      expect(id.code).toBe(0);
      const approval = tool([
        "log-action",
        dispatch,
        "postmaster",
        "library",
        id.out.trim(),
        "approved",
        "library @babel/parser 7.10.0",
        "yes",
        "take",
        "it",
      ]);
      expect(approval.code).toBe(0);
      const r = libraries([
        "record",
        "@babel/parser",
        "7.10.0",
        "--dispatch",
        dispatch,
        "--wt",
        wt,
        "--vendored",
      ]);
      expect(r.code).toBe(0);
      expect(r.out).toContain("recorded: @babel/parser@7.10.0");
      const cache = join(wt, ".postmaster", "library-approvals.json");
      expect(existsSync(cache)).toBe(true);
      expect(readFileSync(cache, "utf8")).toContain("@babel/parser@7.10.0");
      expect(existsSync(join(wt, "package.json"))).toBe(false);
    } finally {
      rmSync(runs, { recursive: true, force: true });
      rmSync(wt, { recursive: true, force: true });
    }
  });
});
