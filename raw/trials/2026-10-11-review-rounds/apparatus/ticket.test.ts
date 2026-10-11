import { describe, expect, test } from "bun:test";
import { ticketFeatures, ticketOfWaybill } from "./ticket.ts";

const twoPart = [
  "## Problem / feature",
  "Something is wrong.",
  "## Acceptance criteria",
  "1. First thing.",
  "2. Second thing.",
  "## Decisions",
  "- **D1 (proposed)** A choice. Why: x. Instead of: y.",
  "## Out of scope",
  "- nothing",
  "## Direction",
  "None.",
  "## Turnpikes",
  "default",
  "## For the agents",
  "### Checks",
  "- **C1** check one → ok",
  "- **C2** check two → ok",
  "### Technical notes",
  "- a note (C1, D1)",
  "- another note (C2)",
  "### Verified at abc1234",
  "- a premise",
].join("\n");

describe("ticket features", () => {
  test("a two-part ticket counts its criteria, decisions, checks and notes (positive control)", () => {
    const f = ticketFeatures(twoPart);
    expect(f.shape).toBe("two-part");
    expect(f.criteria).toBe(2);
    expect(f.decisions).toBe(1);
    expect(f.checks).toBe(2);
    expect(f.notes).toBe(2);
    expect(f.verifiedAt).toBe(true);
    expect(f.outOfScope).toBe(true);
    expect(f.turnpikes).toBe("default");
  });

  test("an old one-part ticket has no agents' part, checks or decisions (negative control)", () => {
    const f = ticketFeatures(
      ["## Problem / feature", "x", "## Acceptance criteria", "1. a", "2. b", "3. c", "## Direction", "d", "## Turnpikes", "default"].join("\n"),
    );
    expect(f.shape).toBe("one-part");
    expect(f.criteria).toBe(3);
    expect(f.decisions).toBe(0);
    expect(f.checks).toBe(0);
    expect(f.verifiedAt).toBe(false);
  });

  test("the ticket of a waybill stops before the project profile", () => {
    const brief = ["# Waybill: 1", "", "## Ticket", "## Problem / feature", "x", "## Project profile", "gate: y"].join("\n");
    expect(ticketOfWaybill(brief)).toBe("## Problem / feature\nx");
    expect(ticketOfWaybill("# Waybill: 1\n")).toBe("");
  });
});
