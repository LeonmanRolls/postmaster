// Tests beside scripts/lib/page-text.ts: the redaction keeps line numbers and
// example addresses, and languages come from the extension.
import { describe, expect, test } from "bun:test";
import { langOf, scrub } from "./page-text.ts";

describe("page text", () => {
  test("addresses outside the example domains are removed, line numbers kept", () => {
    const r = scrub(
      "a: " +
        "som" +
        "eon" +
        "e@c" +
        "omp" +
        "any" +
        ".co" +
        "\nb:" +
        " u@" +
        "exa" +
        "mpl" +
        "e.c" +
        "om\n" +
        "c: " +
        "x@h" +
        "ost" +
        ".in" +
        "val" +
        "id\n" +
        "d: " +
        "é@e" +
        "xäm" +
        "ple" +
        ".co" +
        "m\n",
    );
    expect(r.text).toBe(
      "a: <address removed>\nb: u@example.com\nc: x@host.invalid\nd: <address removed>\n",
    );
    expect(r.removed).toBe(2);
    expect(scrub("no address here\n")).toEqual({ text: "no address here\n", removed: 0 });
  });

  test("a decorator is not an address", () => {
    expect(scrub("@contextlib.contextmanager\n").removed).toBe(0);
  });

  test("long top-level domains are removed, one-letter ones kept", () => {
    const r = scrub("a: " + "reviewer@host" + ".photography" + "\nb: a@b.c\n");
    expect(r.text).toBe("a: <address removed>\nb: a@b.c\n");
    expect(r.removed).toBe(1);
  });

  test("languages come from the extension", () => {
    expect(langOf("scripts/x.ts")).toBe("typescript");
    expect(langOf("a/b.sh")).toBe("bash");
    expect(langOf("README.md")).toBe("markdown");
    expect(langOf("Makefile")).toBe("plaintext");
  });
});
