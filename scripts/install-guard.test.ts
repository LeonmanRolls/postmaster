// Tests beside scripts/install-guard.ts: the review-loop regression cases for
// the guard's pure decisions. End-to-end behavior stays in the oracle.
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { withTempDir } from "./lib/proc.ts";
import {
  fetchVerdict,
  findLockfile,
  parseAddSpecs,
  resolveClosure,
  type GuardContext,
} from "./install-guard.ts";

function packument(
  name: string,
  versions: Record<string, { dependencies?: Record<string, string> }>,
): string {
  const out: Record<string, unknown> = {
    name,
    "dist-tags": { latest: Object.keys(versions).sort().at(-1) },
    versions: Object.fromEntries(
      Object.entries(versions).map(([v, e]) => [
        v,
        { version: v, dependencies: e.dependencies ?? {} },
      ]),
    ),
    time: Object.fromEntries(Object.keys(versions).map((v) => [v, "2020-01-01T00:00:00.000Z"])),
  };
  return JSON.stringify(out);
}

test("a transitive resolution never clears a direct spec's flag", async () => {
  await withTempDir(async (tmp) => {
    const cache = join(tmp, "cache", "packuments");
    mkdirSync(cache, { recursive: true });
    writeFileSync(
      join(cache, "foo.json"),
      packument("foo", { "1.0.0": { dependencies: { bar: "^1.0.0" } } }),
    );
    writeFileSync(join(cache, "bar.json"), packument("bar", { "1.0.0": {} }));
    const ctx: GuardContext = {
      dispatch: tmp,
      lane: "test",
      cacheDir: join(tmp, "cache"),
      registry: "http://127.0.0.1:1",
      socketApi: "http://127.0.0.1:1",
    };
    const closure = await resolveClosure(ctx, tmp, parseAddSpecs(["foo", "bar@1.0.0"]));
    expect(closure.get("bar@1.0.0")?.direct).toBe(true);
    expect(closure.get("foo@1.0.0")?.direct).toBe(true);
  });
});

test("an unknown scanner answer is never cached", async () => {
  await withTempDir(async (tmp) => {
    let mode = "garbage";
    const server = Bun.serve({
      port: 0,
      fetch() {
        if (mode === "garbage") return new Response("not json{{{\n");
        return new Response(
          `${JSON.stringify({ inputPurl: "pkg:npm/a@1.0.0", alerts: [] })}\n`,
          { headers: { "content-type": "application/x-ndjson" } },
        );
      },
    });
    try {
      const ctx: GuardContext = {
        dispatch: tmp,
        lane: "test",
        cacheDir: join(tmp, "cache"),
        registry: "http://127.0.0.1:1",
        socketApi: `http://127.0.0.1:${server.port}`,
      };
      const first = await fetchVerdict(ctx, "a", "1.0.0");
      expect(first.status).toBe("unknown");
      expect(existsSync(join(tmp, "cache", "verdicts", "a%401.0.0.json"))).toBe(false);
      mode = "clean";
      const second = await fetchVerdict(ctx, "a", "1.0.0");
      expect(second).toEqual({ status: "clean" });
    } finally {
      server.stop();
    }
  });
});

test("the npm sync reads the shrinkwrap npm prefers", () => {
  withTempDir((tmp) => {
    writeFileSync(join(tmp, "package-lock.json"), JSON.stringify({ packages: {} }));
    writeFileSync(join(tmp, "npm-shrinkwrap.json"), JSON.stringify({ packages: {} }));
    expect(findLockfile("npm", tmp)).toBe(join(tmp, "npm-shrinkwrap.json"));
    expect(findLockfile("pnpm", tmp)).toBeNull();
  });
});
