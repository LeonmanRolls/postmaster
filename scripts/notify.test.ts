// The notify core beside the script: message words, caps, redaction and the
// origin rule. The acceptance oracle drives the commands; these pin the pure
// functions directly.
import { describe, expect, test } from "bun:test";
import {
  buildLine,
  capMessage,
  eventBody,
  formatReset,
  originError,
  parseNotifyDetail,
  redact,
  runTicket,
} from "./notify.ts";

describe("redact", () => {
  test("every secret out, longest first", () => {
    expect(redact("tok 12345 tok", ["12345", "tok"])).toBe("[redacted] [redacted] [redacted]");
  });
  test("an empty secret matches nothing", () => {
    expect(redact("abc", [""])).toBe("abc");
  });
});

describe("formatReset", () => {
  test("none reads as fixed words", () => {
    expect(formatReset("none")).toBe("no reset time was given");
  });
  test("an unparseable reset reads as fixed words", () => {
    expect(formatReset("soon")).toBe("no reset time was given");
  });
  test("a reset reads in the machine's zone", () => {
    const out = formatReset("2026-06-15T12:00:00+00:00");
    expect(out).toMatch(/^resets 2026-06-15T[0-9]{2}:[0-9]{2}:[0-9]{2}[+-][0-9]{2}:[0-9]{2}$/u);
  });
});

describe("eventBody", () => {
  test("each kind has its fixed words", () => {
    expect(eventBody("question", "", "")).toContain("a question waits for you");
    expect(eventBody("question", "", "")).toContain("Answer in the postmaster session");
    expect(eventBody("shipcard", "", "")).toContain("the ship card awaits your word");
    expect(eventBody("wall", "luna", "none")).toContain("lane luna hit its provider's usage limit");
    expect(eventBody("wall", "luna", "none")).toContain("no reset time was given");
    expect(eventBody("landed", "", "")).toBe("the run landed.");
  });
});

describe("buildLine", () => {
  test("project, ticket, title and body", () => {
    expect(buildLine("acme", "#1", "plain title", "the run landed.")).toBe(
      "acme #1 plain title: the run landed.",
    );
  });
  test("no title reads as the number alone", () => {
    expect(buildLine("acme", "#1", null, "the run landed.")).toBe("acme #1: the run landed.");
    expect(buildLine("acme", "#1", "", "the run landed.")).toBe("acme #1: the run landed.");
  });
});

describe("capMessage", () => {
  test("short messages go whole", () => {
    const lines = ["one", "two"];
    expect(capMessage(lines)).toEqual({ text: "one\ntwo", kept: 2 });
  });
  test("long messages drop lines and say how many more", () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i} ${"x".repeat(100)}`);
    const { text, kept } = capMessage(lines);
    expect(text.length).toBeLessThanOrEqual(4096);
    expect(kept).toBeLessThan(lines.length);
    expect(text.endsWith(`\n(+${lines.length - kept} more)`)).toBe(true);
  });
  test("one huge line is cut, never dropped", () => {
    const { text, kept } = capMessage([`x${"y".repeat(5000)}`]);
    expect(kept).toBe(1);
    expect(text.length).toBe(4096);
    expect(text.endsWith("...")).toBe(true);
  });
});

describe("parseNotifyDetail", () => {
  test("a sent line reads back into kind, reference and text", () => {
    expect(parseNotifyDetail("wall 5 acme #1 t: lane luna hit it.")).toEqual({
      kind: "wall",
      ref: "5",
      text: "acme #1 t: lane luna hit it.",
    });
  });
  test("anything else reads as nothing", () => {
    expect(parseNotifyDetail("bogus 5 some text")).toBeNull();
    expect(parseNotifyDetail("wall 5")).toBeNull();
    expect(parseNotifyDetail("")).toBeNull();
  });
});

describe("runTicket", () => {
  test("the leading number, or the name itself", () => {
    expect(runTicket("454")).toEqual({ display: "#454", number: "454" });
    expect(runTicket("454-b")).toEqual({ display: "#454", number: "454" });
    expect(runTicket("scratch")).toEqual({ display: "scratch", number: null });
  });
});

describe("originError", () => {
  test("loopback http origins pass", () => {
    expect(originError("http://127.0.0.1:8080")).toBeNull();
    expect(originError("http://127.1.2.3/x")).toBeNull();
    expect(originError("https://[::1]:8443/")).toBeNull();
  });
  test("anything else is refused", () => {
    expect(originError("https://api.telegram.org")).not.toBeNull();
    expect(originError("http://10.0.0.1/")).not.toBeNull();
    expect(originError("ftp://127.0.0.1/")).not.toBeNull();
    expect(originError("not a url")).not.toBeNull();
  });
});
