import { describe, expect, test } from "bun:test";
import { constants as osConstants } from "node:os";
import { run, signalExitCode } from "./proc.ts";

const signals = osConstants.signals as Record<string, number>;

describe("platform signal exit codes", () => {
  test("every runtime signal uses this system's number", () => {
    for (const [name, number] of Object.entries(signals))
      expect(signalExitCode(name)).toBe(128 + number);
  });

  test("a child stopped by a terminating signal reports the shell exit code", () => {
    for (const name of ["SIGTERM", "SIGUSR1", "SIGBUS", "SIGSYS"]) {
      const number = signals[name];
      if (number === undefined) continue;
      const child = run(
        process.execPath,
        ["-e", `process.kill(process.pid, ${JSON.stringify(name)})`],
        {
          timeout: 5000,
        },
      );
      expect(child.timedOut).toBe(false);
      expect(child.code).toBe(128 + number);
    }
  });

  test("macOS signal numbers map to shell exit codes on Linux test hosts", () => {
    const macSignals = { SIGUSR1: 30, SIGBUS: 10, SIGSYS: 12 };
    expect(signalExitCode("SIGUSR1", macSignals)).toBe(158);
    expect(signalExitCode("SIGBUS", macSignals)).toBe(138);
    expect(signalExitCode("SIGSYS", macSignals)).toBe(140);
  });
});
