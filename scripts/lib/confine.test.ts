// Tests beside scripts/lib/confine.ts: the table of systems, the start check
// and the wrap. The full signal battery lives in launch.test.ts; these check
// the module's own API: the wrap preserves the command, the start check
// agrees with a real no-op, and a confined child can signal its own.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { startCheck, wrapCommand } from "./confine.ts";

const avail = startCheck();

describe("confinement table", () => {
  test("wrapCommand returns a wrap on a system with a row and null on one without", () => {
    const wrapped = wrapCommand(["true"]);
    const hasRow = process.platform === "linux" || process.platform === "darwin";
    expect(wrapped !== null).toBe(hasRow);
  });

  test("the wrap preserves the command byte-identically after the separator", () => {
    const wrapped = wrapCommand(["echo", "--dangerously-bypass", "hello"]);
    if (wrapped === null) return;
    const sep = wrapped.indexOf("--");
    expect(sep).toBeGreaterThanOrEqual(0);
    expect(wrapped.slice(sep + 1)).toEqual(["echo", "--dangerously-bypass", "hello"]);
  });

  test("the wrap places its own argv before the command", () => {
    const wrapped = wrapCommand(["true"]);
    if (wrapped === null) return;
    const sep = wrapped.indexOf("--");
    expect(sep).toBeGreaterThan(0); // at least one wrap argument before --
  });

  test("startCheck agrees with a real no-op through the wrap", () => {
    if (!avail.ok) return;
    const wrapped = wrapCommand(["true"]);
    expect(wrapped).not.toBeNull();
    const r = spawnSync(wrapped![0]!, wrapped!.slice(1), { encoding: "utf8", timeout: 10000 });
    expect(r.status).toBe(0);
  });

  test("startCheck names the cause when it fails and is empty when it succeeds", () => {
    if (avail.ok) {
      expect(avail.cause).toBe("");
    } else {
      expect(avail.cause.length).toBeGreaterThan(0);
    }
  });

  test("a confined child can signal a process it started itself", () => {
    if (!avail.ok) return;
    const wrapped = wrapCommand([
      "sh",
      "-c",
      "sleep 30 & CHILD=$!; kill -TERM $CHILD 2>/dev/null; wait $CHILD; echo rc=$?",
    ]);
    expect(wrapped).not.toBeNull();
    const r = spawnSync(wrapped![0]!, wrapped!.slice(1), {
      encoding: "utf8",
      timeout: 15000,
    });
    expect(r.stdout).toContain("rc=143");
  });
});
