import { describe, expect, test } from "bun:test";
import { parseActions } from "../../2026-10-03-lane-audit/apparatus/parse.ts";
import { buildPacket, itemsOf, rulingLines, ticketForReaders } from "./packets.ts";
import type { TracedFinding } from "./trace.ts";

const finding = (over: Partial<TracedFinding>): TracedFinding => ({
  run: "7",
  round: 2,
  severity: "P2",
  target: "a.ts:1",
  lenses: ["bug"],
  lanes: ["luna"],
  text: "something",
  textSource: "line",
  file: "a.ts",
  first: 1,
  last: 1,
  snapshot: "abc",
  code: ["const a = 1;"],
  origin: { kind: "change", sha: "def" },
  placedBefore: null,
  fixOf: [],
  relog: false,
  group: "missed-lens-reviewed",
  ...over,
});

describe("packets", () => {
  test("only findings of round 2 and after get an id, counted in their round", () => {
    const items = itemsOf([
      finding({ round: 1 }),
      finding({}),
      finding({ target: "a.ts:2" }),
      finding({ round: 3 }),
    ]);
    expect(items.map((i) => i.id)).toEqual(["7.2.1", "7.2.2", "7.3.1"]);
  });
  test("the ticket for a reader is the plain part and the checks, without notes or premises", () => {
    const t = [
      "## Problem / feature",
      "x",
      "## For the agents",
      "### Checks",
      "- **C1** a",
      "### Technical notes",
      "- n",
      "### Verified at abc",
      "- p",
    ].join("\n");
    const r = ticketForReaders(t);
    expect(r).toContain("## Problem / feature");
    expect(r).toContain("**C1**");
    expect(r).not.toContain("Technical notes");
    expect(r).not.toContain("Verified at");
    expect(ticketForReaders("## Problem / feature\nx")).toBe("## Problem / feature\nx");
  });
  test("a packet does not carry the group a finding fell in", () => {
    const f = finding({});
    const packet = buildPacket("7", "synthesis", 3, [1, 1, 0], "ticket", [], [f], itemsOf([f]));
    expect(packet).toContain("### 7.2.1");
    expect(packet).not.toContain("missed-lens-reviewed");
    expect(packet).toContain("in the change as it stood when round 1 was reviewed");
  });
  test("rulings are the escalations and the notes that name one", () => {
    const line = (action: string, detail: string) =>
      JSON.stringify({
        ts: "2026-10-09T10:00:00Z",
        project: "p",
        run: "7",
        actor: "x",
        action,
        target: "t",
        detail,
      });
    const actions = parseActions(
      [
        line("escalate", "past the cap"),
        line("note", "the user ruled option B"),
        line("note", "nothing"),
      ].join("\n"),
    ).actions;
    expect(rulingLines(actions)).toHaveLength(2);
  });
});
