// Tests beside scripts/view-stream.ts: the file argument the runbooks name, and the forms
// around it. A line that is not JSON is shown as it is, which is enough to tell the two
// input routes apart without a harness's events.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SELF = join(import.meta.dir, "run");

const view = (args: string[], stdin?: string): { code: number; out: string; err: string } => {
  const r = spawnSync(SELF, ["view-stream", ...args], {
    encoding: "utf8",
    input: stdin,
    timeout: 10000,
  });
  return { code: r.status ?? 1, out: String(r.stdout ?? ""), err: String(r.stderr ?? "") };
};

const withEvents = (
  body: string,
  run: (path: string) => ReturnType<typeof view>,
): ReturnType<typeof view> => {
  const dir = mkdtempSync(join(tmpdir(), "view-stream-test-"));
  const path = join(dir, "events.jsonl");
  writeFileSync(path, body);
  try {
    return run(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe("view-stream", () => {
  test("a file argument renders the stream without stdin", () => {
    const r = withEvents("not-json line one\nnot-json line two\n", (path) => view([path]));
    expect(r.code).toBe(0);
    expect(r.out).toContain("not-json line one");
    expect(r.out).toContain("not-json line two");
  });

  test("with no file argument the stream comes from stdin", () => {
    const r = view([], "from stdin\n");
    expect(r.code).toBe(0);
    expect(r.out).toContain("from stdin");
  });

  test("a file that cannot be read exits 1 and says so", () => {
    const r = view([join(tmpdir(), "view-stream-nowhere.jsonl")]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("cannot read");
  });

  test("two streams at once and an unknown flag each exit 1", () => {
    const two = withEvents("a\n", (path) => view([path, path]));
    expect(two.code).toBe(1);
    expect(two.err).toContain("one stream at a time");
    const flag = view(["--nope"]);
    expect(flag.code).toBe(1);
    expect(flag.err).toContain("unknown argument");
  });

  test("--follow takes its own file, not a second one", () => {
    const r = view(["--follow", "x.jsonl", "--pid", "1", "other.jsonl"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("--follow's file");
  });
});
