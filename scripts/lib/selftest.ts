// Self-test harness: the same ok/fail/expect lines every BASE self-test printed.
// A control that misbehaves is named exactly as its BASE version named it.

export class SelfTest {
  fails = 0;

  ok(label: string): void {
    console.log(`  ok   ${label}`);
  }

  fail(label: string, detail?: string): void {
    console.log(`  FAIL ${label}`);
    if (detail !== undefined && detail !== "") {
      for (const line of detail.split("\n")) console.log(`         ${line}`);
    }
    this.fails += 1;
  }

  /** Assert a condition; print ok or FAIL with the label. */
  check(label: string, cond: boolean, detail?: string): void {
    if (cond) this.ok(label);
    else this.fail(label, detail);
  }

  /**
   * Expect the call to pass or fail. When the call must fail for a reason,
   * pass `expectIn` so a fail for another reason is itself a failure.
   */
  expect(
    passOrFail: "pass" | "fail",
    label: string,
    call: () => { code: number; out: string },
    expectIn?: string,
  ): void {
    const { code, out } = call();
    const got = code === 0 ? "pass" : "fail";
    let why = "";
    if (got === "fail" && expectIn !== undefined && expectIn !== "" && !out.includes(expectIn)) {
      why = ", but not for the expected reason";
    }
    if (got === passOrFail && why === "") this.ok(label);
    else {
      this.fail(`${label}: wanted ${passOrFail}, got ${got}${why}`, out);
    }
  }

  /** Finish: exit 0 on a clean run, 1 with the misbehaviour count otherwise. */
  finish(): never {
    console.log("");
    if (this.fails === 0) {
      console.log("self-test: all controls behaved");
      process.exit(0);
      throw new Error("unreachable");
    }
    console.log(`self-test: ${this.fails} control(s) misbehaved`);
    process.exit(1);
    throw new Error("unreachable");
  }
}

/** Indent a multi-line detail the way the bash harness did (sed 's/^/         /'). */
export function indentDetail(text: string): string {
  return text
    .split("\n")
    .map((l) => `         ${l}`)
    .join("\n");
}
