// Unit tests for the held-list core beside it: parsing, matching and the
// read-modify-write computations the hold command runs under its lock.
import { describe, expect, test } from "bun:test";
import {
  addHandHold,
  addHold,
  dropStaleHolds,
  formatHelperHold,
  heldTicketOf,
  isHelperHold,
  parseHeldLine,
  removeHandHold,
  removeHelperHold,
} from "./held.ts";

describe("parseHeldLine", () => {
  test("a bare ticket is a hand-written hold", () => {
    expect(parseHeldLine("T-1")).toEqual({ ticket: "T-1", helper: null, session: null, extra: [] });
  });

  test("a helper line names its helper and session", () => {
    expect(parseHeldLine("T-1 helper=stage-f session=abc123")).toEqual({
      ticket: "T-1",
      helper: "stage-f",
      session: "abc123",
      extra: [],
    });
  });

  test("blank lines parse to null", () => {
    expect(parseHeldLine("")).toBeNull();
    expect(parseHeldLine("  \t ")).toBeNull();
  });

  test("edge spaces and tabs are stripped", () => {
    expect(parseHeldLine("  T-1\thelper=h  session=s  ")?.ticket).toBe("T-1");
  });

  test("unknown and empty fields read as extra, and the run stays held", () => {
    const line = parseHeldLine("T-1 helper=h note=do-not-touch bogus session=");
    expect(line?.ticket).toBe("T-1");
    expect(line?.helper).toBe("h");
    expect(line?.extra).toEqual(["note=do-not-touch", "bogus", "session="]);
  });

  test("a repeated field reads as extra", () => {
    const line = parseHeldLine("T-1 helper=a helper=b session=s");
    expect(line?.helper).toBe("a");
    expect(line?.extra).toEqual(["helper=b"]);
  });
});

describe("heldTicketOf and isHelperHold", () => {
  test("matching is on the first field", () => {
    expect(heldTicketOf("T-1 helper=h session=s")).toBe("T-1");
    expect(heldTicketOf("T-1")).toBe("T-1");
    expect(heldTicketOf("")).toBeNull();
  });

  test("only a line naming a helper is a helper hold", () => {
    expect(isHelperHold(parseHeldLine("T-1 helper=h session=s")!)).toBe(true);
    expect(isHelperHold(parseHeldLine("T-1")!)).toBe(false);
    expect(isHelperHold(parseHeldLine("T-1 session=s")!)).toBe(false);
  });

  test("formatHelperHold writes the line the parser reads", () => {
    const line = parseHeldLine(formatHelperHold("T-1", "h", "s"));
    expect(line).toEqual({ ticket: "T-1", helper: "h", session: "s", extra: [] });
  });
});

describe("addHold", () => {
  test("appends to an empty list and to a list ending in a newline", () => {
    expect(addHold("", "T-1", "h", "s")).toEqual({
      ok: true,
      text: "T-1 helper=h session=s\n",
    });
    expect(addHold("T-9\n", "T-1", "h", "s")).toEqual({
      ok: true,
      text: "T-9\nT-1 helper=h session=s\n",
    });
  });

  test("a list without a trailing newline keeps its bytes", () => {
    expect(addHold("T-9", "T-1", "h", "s")).toEqual({
      ok: true,
      text: "T-9\nT-1 helper=h session=s\n",
    });
  });

  test("any existing line for the run refuses, carrying that line", () => {
    expect(addHold("T-9\nT-1 helper=old session=s\n", "T-1", "h", "t")).toEqual({
      ok: false,
      held: "T-1 helper=old session=s",
    });
    expect(addHold("T-1\n", "T-1", "h", "t")).toEqual({ ok: false, held: "T-1" });
  });
});

describe("addHandHold", () => {
  test("appends the bare ticket", () => {
    expect(addHandHold("T-9\n", "T-1")).toEqual({ ok: true, text: "T-9\nT-1\n" });
  });

  test("any existing line for the run refuses, carrying that line", () => {
    expect(addHandHold("T-1 helper=h session=s\n", "T-1")).toEqual({
      ok: false,
      held: "T-1 helper=h session=s",
    });
    expect(addHandHold("T-1\n", "T-1")).toEqual({ ok: false, held: "T-1" });
  });
});

describe("removeHandHold", () => {
  test("removes the hand line and keeps the rest byte for byte", () => {
    expect(removeHandHold("T-1\nT-9 helper=h session=s\n", "T-1")).toEqual({
      ok: true,
      text: "T-9 helper=h session=s\n",
      removed: ["T-1"],
    });
  });

  test("an unheld run and a helper-held run refuse distinctly", () => {
    expect(removeHandHold("T-9\n", "T-1")).toEqual({ ok: false, reason: "not-held" });
    expect(removeHandHold("T-1 helper=h session=s\n", "T-1")).toEqual({
      ok: false,
      reason: "helper-held",
    });
  });
});

describe("removeHelperHold", () => {
  test("removes the helper hold and keeps the rest byte for byte", () => {
    expect(removeHelperHold("T-9\nT-1 helper=h session=s\n", "T-1")).toEqual({
      ok: true,
      text: "T-9\n",
      removed: ["T-1 helper=h session=s"],
    });
  });

  test("an unheld run and a hand-held run refuse distinctly", () => {
    expect(removeHelperHold("T-9\n", "T-1")).toEqual({ ok: false, reason: "not-held" });
    expect(removeHelperHold("T-1\n", "T-1")).toEqual({ ok: false, reason: "hand-held" });
  });

  test("a hand line beside a helper hold stays while the helper hold goes", () => {
    expect(removeHelperHold("T-1 helper=h session=s\nT-1\n", "T-1")).toEqual({
      ok: true,
      text: "T-1\n",
      removed: ["T-1 helper=h session=s"],
    });
  });
});

describe("dropStaleHolds", () => {
  test("drops helper holds from other sessions and keeps the rest", () => {
    const text = "T-9\nT-1 helper=a session=old\nT-2 helper=b session=new\n";
    expect(dropStaleHolds(text, "new")).toEqual({
      text: "T-9\nT-2 helper=b session=new\n",
      dropped: ["T-1 helper=a session=old"],
    });
  });

  test("a helper hold with no session counts as stale", () => {
    // No session field: parseHeldLine reads session null, never the current one.
    const line = parseHeldLine("T-1 helper=a");
    expect(line?.session).toBeNull();
    expect(dropStaleHolds("T-1 helper=a\n", "new")).toEqual({
      text: "",
      dropped: ["T-1 helper=a"],
    });
  });
});
