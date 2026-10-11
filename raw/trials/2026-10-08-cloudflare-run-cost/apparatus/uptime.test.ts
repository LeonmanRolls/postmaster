import { describe, expect, test } from "bun:test";
import { looksLikePath, runUptime, uptimeSeconds } from "./uptime.ts";

const session = (uptimeMs: number | null | undefined) => ({
  session_end: uptimeMs === undefined ? undefined : uptimeMs === null ? null : { uptime_ms: uptimeMs },
});

describe("uptimeSeconds", () => {
  test("reads each session's uptime in seconds", () => {
    expect(uptimeSeconds({ sessions: [session(4_803_186), session(1_348_293)] })).toEqual([
      4803.186, 1348.293,
    ]);
  });

  test("negative control: a session with no end, a zero uptime or no sessions reads nothing", () => {
    expect(uptimeSeconds({ sessions: [session(null), session(undefined), session(0)] })).toEqual([]);
    expect(uptimeSeconds({})).toEqual([]);
  });
});

describe("runUptime", () => {
  test("sums the threads of one run and counts them", () => {
    const r = runUptime("201", [{ sessions: [session(4_803_186)] }, { sessions: [session(1_348_293)] }]);
    expect(r).toEqual({ run: "201", threads: 2, seconds: 6151 });
  });

  test("a run with no exports is zero, not an error", () => {
    expect(runUptime("none", [])).toEqual({ run: "none", threads: 0, seconds: 0 });
  });
});

describe("looksLikePath", () => {
  test("flags a place on a machine and passes a run row", () => {
    expect(looksLikePath('"folder": "/srv/example/runs/201/"')).toBe(true);
    expect(looksLikePath('{"run": "201", "threads": 2, "seconds": 6151}')).toBe(false);
  });
});
