// Tests beside scripts/lib/library-landing.ts: the manifest reading, the
// direct and transitive diffs, and the entry rendering. The git plumbing
// and the facts wiring sit in the #424 oracle.
import { describe, expect, test } from "bun:test";
import {
  diffDirect,
  diffTransitives,
  manifestSpecs,
  reachable,
  renderLibraries,
  type LibraryEntry,
} from "./library-landing.ts";

function resolved(pairs: Array<[string, string[]]>): Map<string, Set<string>> {
  return new Map(pairs.map(([name, versions]) => [name, new Set(versions)]));
}

describe("manifestSpecs", () => {
  test("merges every dependency block and skips the rest", () => {
    const specs = manifestSpecs(
      JSON.stringify({
        dependencies: { "left-pad": "1.3.0" },
        devDependencies: { oxlint: "1.86.0" },
        scripts: { check: "true" },
        trustedDependencies: [],
      }),
    );
    expect(specs.get("left-pad")).toBe("1.3.0");
    expect(specs.get("oxlint")).toBe("1.86.0");
    expect(specs.has("check")).toBe(false);
    expect(manifestSpecs(null).size).toBe(0);
  });

  test("a manifest that does not parse fails loud", () => {
    expect(() => manifestSpecs("not json")).toThrow("does not parse");
  });
});

describe("diffDirect", () => {
  test("added, changed and resolved-drift list; removed and same do not", () => {
    const base = new Map([
      ["kept", "1.0.0"],
      ["raised", "1.0.0"],
      ["dropped", "1.0.0"],
      ["drifted", "^1.0.0"],
    ]);
    const head = new Map([
      ["kept", "1.0.0"],
      ["raised", "1.1.0"],
      ["drifted", "^1.0.0"],
      ["fresh", "2.0.0"],
    ]);
    const changes = diffDirect(
      base,
      head,
      resolved([
        ["kept", ["1.0.0"]],
        ["raised", ["1.0.0"]],
        ["dropped", ["1.0.0"]],
        ["drifted", ["1.0.0"]],
      ]),
      resolved([
        ["kept", ["1.0.0"]],
        ["raised", ["1.1.0"]],
        ["drifted", ["1.2.0"]],
        ["fresh", ["2.0.0"]],
      ]),
    );
    expect(changes.map((c) => [c.name, c.kind, c.old, c.next])).toEqual([
      ["drifted", "changed", "1.0.0", "1.2.0"],
      ["fresh", "added", null, "2.0.0"],
      ["raised", "changed", "1.0.0", "1.1.0"],
    ]);
  });
});

describe("reachable", () => {
  test("walks the lockfile's edges transitively", () => {
    const edges = new Map([
      ["a", new Set(["b"])],
      ["b", new Set(["c"])],
    ]);
    expect(reachable(edges, ["a"])).toEqual(new Set(["a", "b", "c"]));
    expect(reachable(edges, ["b"])).toEqual(new Set(["b", "c"]));
  });
});

describe("diffTransitives", () => {
  test("a brought package lands under its new parent, a drift on its own", () => {
    const takes = diffTransitives(
      resolved([["parent", ["1.0.0"]]]),
      resolved([
        ["parent", ["1.0.0"]],
        ["child", ["2.0.0"]],
        ["stray", ["3.0.0"]],
      ]),
      new Map([["parent", new Set(["child"])]]),
      new Set(["parent"]),
      ["parent"],
    );
    expect(takes.covered.get("parent")).toEqual(["child@2.0.0"]);
    expect(takes.own).toEqual([{ name: "stray", version: "3.0.0" }]);
  });
});

describe("renderLibraries", () => {
  function entry(over: Partial<LibraryEntry> = {}): LibraryEntry {
    return {
      name: "left-pad",
      kind: "added",
      old: null,
      next: "1.3.0",
      version: "1.3.0",
      brings: [],
      identity: "library:0123456789abcdef",
      facts: {
        name: "left-pad",
        version: "1.3.0",
        published: "2024-05-01T00:00:00.000Z",
        source: "https://example.invalid/pad.git",
        verdict: "clean",
        note: null,
      },
      approved: false,
      ...over,
    };
  }

  test("one line per entry carrying its facts, none when empty", () => {
    const out = renderLibraries([
      entry({ brings: ["is-number@7.0.0"], approved: true }),
      entry({ name: "is-odd", kind: "transitive", next: "3.0.1", version: "3.0.1" }),
    ]);
    expect(out.split("\n")[0]).toBe("## Libraries");
    expect(out).toContain(
      "- library left-pad added none -> 1.3.0 published 2024-05-01T00:00:00.000Z source https://example.invalid/pad.git verdict clean (id library:0123456789abcdef) (approved)",
    );
    expect(out).toContain("brings is-number@7.0.0");
    expect(out).toContain("- library is-odd transitive none -> 3.0.1");
    expect(renderLibraries([])).toBe("## Libraries\n\nnone\n");
  });
});
