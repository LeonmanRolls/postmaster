// Tests beside scripts/lib/proc.ts: a child dead by a signal reports what a shell
// on this system reports — 128 plus the number from os.constants.signals — and a
// caller may put another system's numbers in place of this one's.
import { describe, expect, test } from "bun:test";
import { constants as osConstants } from "node:os";
import { run, signalExitCode } from "./proc.ts";

describe("signal exit codes", () => {
  test("every signal this system numbers reports 128 plus its number", () => {
    for (const [name, num] of Object.entries(osConstants.signals)) {
      expect(signalExitCode(name)).toBe(128 + num);
    }
    expect(signalExitCode("SIGNOTAREAL")).toBe(128);
  });

  test("a child stopped by a signal reports it through run(), 128 plus this system's number", () => {
    // Each signal whose default action ends the child: the code follows the
    // system. Signals the default ignores end the child normally (code 0) and
    // are skipped, as are the four that only stop it — a stopped child reports
    // no exit code at all, so a shell never adds 128 for one.
    const stopsOnly = new Set(["SIGSTOP", "SIGTSTP", "SIGTTIN", "SIGTTOU"]);
    let terminated = 0;
    for (const [name, num] of Object.entries(osConstants.signals)) {
      if (stopsOnly.has(name)) continue;
      // Python delivers every standard signal the system numbers; a runtime's
      // own kill does not know them all (Bun refuses SIGSTKFLT).
      const r = run("python3", ["-c", `import os,signal; os.kill(os.getpid(), signal.${name})`], {
        timeout: 2000,
      });
      if (r.timedOut || r.code === 0) continue;
      expect(`${name}:${r.code}`).toBe(`${name}:${128 + num}`);
      terminated++;
    }
    expect(terminated).toBeGreaterThan(0);
  }, 120000);

  test("with another system's numbers in place of this system's", () => {
    // The numbers macOS carries, applied here; this run is not on a Mac.
    const mac = { SIGUSR1: 30, SIGBUS: 10, SIGSYS: 12 };
    expect(signalExitCode("SIGUSR1", mac)).toBe(158);
    expect(signalExitCode("SIGBUS", mac)).toBe(138);
    expect(signalExitCode("SIGSYS", mac)).toBe(140);
  });
});
