// Tests beside scripts/lib/sources.ts. The sources are an invented company's.
import { describe, expect, test } from "bun:test";
import { appliesTo, readSources, sourceFile } from "./sources.ts";

const expand = (p: string): string => (p.startsWith("~/") ? `/home/user${p.slice(1)}` : p);
const glob = (pattern: string, path: string): boolean => new Bun.Glob(pattern).match(path);

const TABLE = {
  "acme-wiki": {
    path: "~/Code/acme/wiki",
    about: "Acme's standards",
    applies_to: ["~/Code/acme/*"],
  },
  handbook: { path: "/srv/handbook" },
};

describe("the sources table", () => {
  test("no table is no sources", () => {
    expect(readSources(undefined, expand)).toEqual({ sources: [], problems: [] });
  });

  test("each entry is read with its path expanded", () => {
    const read = readSources(TABLE, expand);
    expect(read.problems).toEqual([]);
    expect(read.sources).toEqual([
      {
        name: "acme-wiki",
        path: "/home/user/Code/acme/wiki",
        about: "Acme's standards",
        appliesTo: ["~/Code/acme/*"],
      },
      { name: "handbook", path: "/srv/handbook", about: "", appliesTo: [] },
    ]);
  });

  test("a source with no path is a problem and the rest still read", () => {
    const read = readSources({ a: {}, b: { path: "/b" } }, expand);
    expect(read.problems).toEqual(["sources.a.path must be a folder on this machine"]);
    expect(read.sources.map((s) => s.name)).toEqual(["b"]);
  });

  test("an entry that is not a table, and values of the wrong kind, are problems", () => {
    const read = readSources(
      { a: "x", b: { path: "/b", about: 3 }, c: { path: "/c", applies_to: "x" } },
      expand,
    );
    expect(read.problems).toEqual([
      "sources.a must be a table with a path",
      "sources.b.about must be text",
      "sources.c.applies_to must be a list of path patterns",
    ]);
    expect(read.sources).toEqual([]);
  });

  test("a table that is not a table is a problem", () => {
    expect(readSources(["x"], expand).problems).toEqual([
      "sources must be a table of named sources",
    ]);
  });
});

describe("a file in a source", () => {
  const [wiki] = readSources(TABLE, expand).sources;

  test("is the source's folder and the path", () => {
    expect(sourceFile(wiki, "standards/ts.md")).toBe("/home/user/Code/acme/wiki/standards/ts.md");
    expect(sourceFile(wiki, "./INDEX.md")).toBe("/home/user/Code/acme/wiki/INDEX.md");
  });

  test("never leaves the folder", () => {
    expect(sourceFile(wiki, "../secret.md")).toBeNull();
    expect(sourceFile(wiki, "a/../../secret.md")).toBeNull();
    expect(sourceFile(wiki, "..")).toBeNull();
    expect(sourceFile(wiki, "/etc/passwd")).toBeNull();
  });
});

describe("which repos a source is proposed for", () => {
  const [wiki, handbook] = readSources(TABLE, expand).sources;

  test("a repo under the pattern is matched", () => {
    expect(appliesTo(wiki, "/home/user/Code/acme/shop", expand, glob)).toBe(true);
  });

  test("a repo elsewhere is not", () => {
    expect(appliesTo(wiki, "/home/user/Code/other/shop", expand, glob)).toBe(false);
  });

  test("a source with no patterns is proposed for no repo", () => {
    expect(appliesTo(handbook, "/home/user/Code/acme/shop", expand, glob)).toBe(false);
  });
});
