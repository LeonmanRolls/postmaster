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

  test("the linux wrap binds the root before mounting the fresh /proc", () => {
    if (process.platform !== "linux") return;
    const wrapped = wrapCommand(["true"]);
    expect(wrapped).not.toBeNull();
    // Bubblewrap applies mounts in order: a later --bind / / would cover an
    // earlier --proc with the host's /proc, and PIDs would mismatch inside.
    const bindAt = wrapped!.indexOf("--bind");
    const procAt = wrapped!.indexOf("--proc");
    expect(bindAt).toBeGreaterThanOrEqual(0);
    expect(procAt).toBeGreaterThan(bindAt);
  });

  test("the linux wrap keeps the host device tree", () => {
    if (process.platform !== "linux") return;
    const wrapped = wrapCommand(["true"]);
    expect(wrapped).not.toBeNull();
    // --dev would replace /dev with a minimal tree, hiding host shared-memory
    // objects and device nodes the lane had; the wrap binds the host's over.
    expect(wrapped!.includes("--dev-bind")).toBe(true);
    expect(wrapped!.includes("--dev")).toBe(false);
  });

  test("the linux wrap starts a new session", () => {
    if (process.platform !== "linux") return;
    const wrapped = wrapCommand(["true"]);
    expect(wrapped).not.toBeNull();
    // Without --new-session the lane shares the launcher's process group and
    // kill 0 from inside reaches the launcher, which it did not start.
    expect(wrapped!.includes("--new-session")).toBe(true);
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
