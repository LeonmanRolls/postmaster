// Tests beside scripts/lib/libraries.ts: the ## Libraries line shapes, the
// brief region the list is read from, and the approval records.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { withTempDir } from "./proc.ts";
import {
  listsVersion,
  parseLibraries,
  parseLibraryLine,
  readApprovals,
  wordCovers,
} from "./libraries.ts";

test("an @ line lists its exact version and ignores the vetting", () => {
  expect(parseLibraryLine("- left-pad@1.3.0 vetted: pads strings, no deps")).toEqual({
    name: "left-pad",
    version: "1.3.0",
  });
});

test("a space-separated line lists its exact version", () => {
  expect(parseLibraryLine("* left-pad 1.3.0 pads strings")).toEqual({
    name: "left-pad",
    version: "1.3.0",
  });
});

test("scoped names and prereleases parse", () => {
  expect(parseLibraryLine("@scope/name@2.0.0-beta.1 vetted")).toEqual({
    name: "@scope/name",
    version: "2.0.0-beta.1",
  });
});

test("ranges and prose never list", () => {
  expect(parseLibraryLine("- left-pad@^1.0.0 vetted")).toBeNull();
  expect(parseLibraryLine("- left-pad ~1.3.0")).toBeNull();
  expect(parseLibraryLine("The run needs no new libraries.")).toBeNull();
  expect(parseLibraryLine("")).toBeNull();
});

test("the list is the ticket's section, not a later one", () => {
  const brief = [
    "# Waybill",
    "## Ticket",
    "## Libraries",
    "- listed@1.0.0 vetted",
    "## Acceptance criteria",
    "done",
    "## Project profile",
    "## Libraries",
    "- smuggled@1.0.0 vetted",
    "",
  ].join("\n");
  expect(parseLibraries(brief)).toEqual([{ name: "listed", version: "1.0.0" }]);
});

test("a brief without the section lists nothing", () => {
  expect(parseLibraries("# Waybill\n## Ticket\n## Problem\nnone\n")).toEqual([]);
  expect(parseLibraries("no sections at all")).toEqual([]);
});

test("approvals read the postmaster's lines only", () => {
  withTempDir((dir) => {
    const dispatch = join(dir, "d");
    mkdirSync(dispatch, { recursive: true });
    const lines = [
      { actor: "postmaster", action: "library-yes", target: "a@1.0.0", detail: "yes" },
      { actor: "coachman", action: "library-yes", target: "evil@1.0.0", detail: "yes" },
      { actor: "postmaster", action: "age-waiver", target: "a@1.1.0", detail: "go" },
      { actor: "postmaster", action: "script-allow", target: "a", detail: "go" },
      { actor: "postmaster", action: "pm-word", target: "cargo,python", detail: "go" },
      { actor: "postmaster", action: "note", target: "x", detail: "unrelated" },
      "not json",
    ];
    writeFileSync(
      join(dispatch, "actions.jsonl"),
      `${lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n")}\n`,
    );
    const approvals = readApprovals(dispatch);
    expect([...approvals.yes]).toEqual(["a@1.0.0"]);
    expect([...approvals.waivers]).toEqual(["a@1.1.0"]);
    expect([...approvals.allowances]).toEqual(["a"]);
    expect(approvals.pmWords).toEqual([{ managers: ["cargo", "python"], detail: "go" }]);
  });
});

test("a missing log approves nothing", () => {
  withTempDir((dir) => {
    const approvals = readApprovals(join(dir, "absent"));
    expect(approvals.yes.size).toBe(0);
    expect(approvals.pmWords).toEqual([]);
  });
});

test("matching is exact on name and version", () => {
  const libs = [{ name: "a", version: "1.0.0" }];
  expect(listsVersion(libs, "a", "1.0.0")).toBe(true);
  expect(listsVersion(libs, "a", "1.0.1")).toBe(false);
  expect(listsVersion(libs, "b", "1.0.0")).toBe(false);
  expect(wordCovers([{ managers: ["cargo"], detail: "go" }], ["cargo"])).toBe(true);
  expect(wordCovers([{ managers: ["cargo"], detail: "go" }], ["cargo", "python"])).toBe(false);
  expect(wordCovers([], ["cargo"])).toBe(false);
});
