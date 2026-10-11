// Tests beside scripts/lib/ticket-sections.ts: the shared reading of the agents
// part's sections. ticket-parts and the cut both build on it.
import { describe, expect, test } from "bun:test";
import {
  agentsEnd,
  agentsIndex,
  level3Sections,
  normalizeTicket,
  verifiedAtSha,
  verifiedSection,
} from "./ticket-sections.ts";

describe("normalizeTicket", () => {
  test("strips a byte-order mark and folds CRLF to LF", () => {
    expect(normalizeTicket("\uFEFF# T\r\n\r\nBody\r\n")).toBe("# T\n\nBody\n");
    expect(normalizeTicket("# T\n\nBody\n")).toBe("# T\n\nBody\n");
  });
});

describe("agentsIndex", () => {
  test("finds the heading case-insensitively, or -1", () => {
    expect(agentsIndex(["# T", "", "## For the Agents", ""])).toBe(2);
    expect(agentsIndex(["# T", "", "no agents part"])).toBe(-1);
  });
});

describe("agentsEnd", () => {
  test("ends at the next unfenced ## that is not the journey", () => {
    const lines = [
      "## For the agents",
      "",
      "```",
      "## Example",
      "```",
      "",
      "## User journey",
      "",
      "Walk.",
      "",
      "## Project profile",
      "",
    ];
    expect(agentsEnd(lines, 1)).toBe(10);
    expect(agentsEnd(lines.slice(0, 10), 1)).toBe(10);
  });
});

describe("verifiedSection", () => {
  test("finds the section case-insensitively outside fences", () => {
    const lines = ["## For the agents", "", "```", "### Verified at deadbee", "```", ""];
    expect(verifiedSection(lines, 0)).toBeUndefined();
    lines.push("### VERIFIED AT abc1234", "");
    expect(verifiedSection(lines, 0)?.title).toBe("VERIFIED AT abc1234");
  });
});

describe("verifiedAtSha", () => {
  test("takes 7 to 40 hex of either case past the words", () => {
    expect(verifiedAtSha("Verified at abc1234")).toBe("abc1234");
    expect(verifiedAtSha("VERIFIED AT ABC1234")).toBe("ABC1234");
    expect(verifiedAtSha("Verified at   abc1234")).toBe("abc1234");
    expect(verifiedAtSha("Verified at")).toBe("");
    expect(verifiedAtSha("Verified at xyz")).toBe("");
  });
});

describe("level3Sections", () => {
  test("each section runs to the next heading of level 3 or above, skipping fences", () => {
    const lines = [
      "### Checks",
      "",
      "- **C1** One.",
      "",
      "### Technical notes",
      "",
      "```md",
      "### Not a section",
      "```",
      "",
      "## User journey",
      "",
      "Walk here.",
      "",
      "### Verified at abc1234",
      "",
      "Done.",
    ];
    const subs = level3Sections(lines, 0);
    expect(subs.map((s) => s.title)).toEqual(["Checks", "Technical notes", "Verified at abc1234"]);
    expect(subs.map((s) => [s.at, s.end])).toEqual([
      [0, 4],
      [4, 10],
      [14, 17],
    ]);
  });
});
