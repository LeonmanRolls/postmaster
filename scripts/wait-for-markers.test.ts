// Tests beside scripts/wait-for-markers.ts, moved from its --self-test on #109: 11 controls.
// The timeout-kept control re-invokes the wait instead of reusing the previous control's timing.
// The planted-marker control is gated on non-root, as the self-test skipped it for root.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { countdown } from "./wait-for-markers";

const isRoot = process.getuid?.() === 0;
if (isRoot) {
  console.log("skip a reader that cannot see its own planted marker: root writes anywhere");
}

const wrapper = join(import.meta.dir, "run");

function invoke(
  dir: string,
  glob: string,
  count: string,
  timeout: string,
): { out: string; rc: number; took: number } {
  const t0 = Date.now();
  const r = spawnSync(wrapper, ["wait-for-markers", dir, glob, count, timeout], {
    encoding: "utf8",
  });
  return {
    out: `${r.stdout ?? ""}${r.stderr ?? ""}`,
    rc: r.status ?? -1,
    took: Math.floor((Date.now() - t0) / 1000),
  };
}

let tmp = "";
let d = "";

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "wait-for-markers-"));
  d = join(tmp, "logs");
  mkdirSync(d);
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("positive controls", () => {
  test("markers already in are collected at once", () => {
    writeFileSync(join(d, "review-r1-bug-one.done"), "");
    writeFileSync(join(d, "review-r1-bug-two.done"), "");
    const { out, rc, took } = invoke(d, "review-r1-*.done", "2", "5");
    expect(rc).toBe(0);
    expect(out.trim()).toBe("all 2 markers present");
    expect(took).toBeLessThanOrEqual(1);
  }, 10000);

  test("a marker that lands during the wait is collected by the timeout", () => {
    // The writer is detached: a synchronous spawn waits for its background jobs,
    // and the marker would pre-exist instead of landing mid-wait.
    const landing = join(d, "review-r2-bug-one.done");
    const bg = spawn("bash", ["-c", `sleep 1; touch "${landing}"`], {
      detached: true,
      stdio: "ignore",
    });
    bg.unref();
    expect(existsSync(landing)).toBe(false);
    const { out, rc } = invoke(d, "review-r2-*.done", "1", "3");
    expect(rc).toBe(0);
    expect(out.trim()).toBe("all 1 markers present");
  }, 10000);

  test("a count with a leading zero is decimal: 010 is ten, which nine markers do not meet", () => {
    for (let i = 1; i <= 9; i++) writeFileSync(join(d, `review-r5-bug-${i}.done`), "");
    const { out, rc } = invoke(d, "review-r5-*.done", "010", "1");
    expect(rc).toBe(3);
    expect(out.includes("9 of 10 markers")).toBe(true);
  }, 10000);
});

describe("negative controls", () => {
  test("a missing marker times out, and another round's marker is not counted", () => {
    writeFileSync(join(d, "review-r3-bug-one.done"), "");
    writeFileSync(join(d, "review-r4-bug-two.done"), "");
    const { out, rc } = invoke(d, "review-r3-*.done", "2", "1");
    expect(rc).toBe(3);
    expect(out.includes("WAIT-TIMEOUT after 1s: 1 of 2 markers matching review-r3-*.done")).toBe(
      true,
    );
    expect(out.includes(`present: ${join(d, "review-r3-bug-one.done")}`)).toBe(true);
    expect(out.includes("review-r4")).toBe(false);
  }, 10000);

  test("the timeout is kept to the second, not the next 20-second look", () => {
    const { rc, took } = invoke(d, "review-r3-*.done", "2", "1");
    expect(rc).toBe(3);
    expect(took).toBeLessThanOrEqual(3);
  }, 10000);

  test("a clock that jumps ahead does not end the wait early", () => {
    // The timeout counts slept seconds through the countdown alone: run it with
    // a fake sleep while a fake wall clock jumps an hour per nap, and the
    // wait still consumes every second of its timeout in 20-second naps.
    let fakeNow = 0;
    const naps: number[] = [];
    const verdict = countdown(
      () => 0,
      1,
      35,
      (ms) => {
        naps.push(ms);
        fakeNow += 3600000;
      },
    );
    expect(verdict).toBe("timeout");
    expect(naps).toEqual([20000, 15000]);
    expect(fakeNow).toBe(7200000);
  }, 10000);

  test("a count that is not a number is refused, not read as every marker in", () => {
    const { out, rc } = invoke(d, "review-r1-*.done", "two", "5");
    expect(rc).toBe(1);
    expect(out.includes("markers present")).toBe(false);
  }, 10000);

  test("a timeout that is not a number is refused", () => {
    const { rc } = invoke(d, "review-r1-*.done", "2", "soon");
    expect(rc).toBe(1);
  }, 10000);

  test("a timeout past 9 digits is refused, never wrapped round to a past deadline", () => {
    const { out, rc } = invoke(d, "review-r1-*.done", "2", "9999999999999999999");
    expect(rc).toBe(1);
    expect(out.includes("more than 9 digits")).toBe(true);
  }, 10000);

  test("a directory that does not exist is refused", () => {
    const { out, rc } = invoke(join(tmp, "nowhere"), "review-r1-*.done", "2", "1");
    expect(rc).toBe(1);
    expect(out.includes("no such dir")).toBe(true);
  }, 10000);

  test.skipIf(isRoot)(
    "a reader that cannot see its own planted marker stops the wait",
    () => {
      chmodSync(d, 0o555);
      try {
        const { out, rc } = invoke(d, "review-r1-*.done", "2", "1");
        expect(rc).toBe(1);
        expect(out.includes("reader failed its control (positive=0")).toBe(true);
      } finally {
        chmodSync(d, 0o755);
      }
    },
    10000,
  );
});
