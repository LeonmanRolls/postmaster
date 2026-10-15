// Tests beside scripts/lib/sources.ts. The sources are an invented company's.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { RUN, removeDir, scratchDir, setupDryRun, writeAnswers } from "../acceptance-407.ts";
import { run } from "./proc.ts";
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

// Setup registers sources: every case is a dry run on the shared answers of acceptance-407.
let setupTmp = "";

beforeAll(() => {
  setupTmp = scratchDir("setup-sources-");
});

afterAll(() => {
  removeDir(setupTmp);
});

describe("the keys", () => {
  test("setup --keys lists the sources and what is asked for each", () => {
    const r = run(RUN, ["setup", "--keys"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("sources?");
    expect(r.out).toContain("source.<name>.path");
    expect(r.out).toContain("source.<name>.about?");
    expect(r.out).toContain("source.<name>.applies_to?");
  });
});

describe("a dry run", () => {
  test("registers each named source with its folder, what is in it and the repos it is proposed for", () => {
    const answers = writeAnswers(
      setupTmp,
      "two",
      [
        "sources=acme-wiki, handbook",
        "source.acme-wiki.path=~/Code/acme/wiki",
        "source.acme-wiki.about=Acme's standards and review specs",
        "source.acme-wiki.applies_to=~/Code/acme/*, ~/Code/acme-labs/*",
        "source.handbook.path=/srv/handbook",
      ].join("\n"),
    );
    const r = setupDryRun(setupTmp, answers);
    expect(r.code).toBe(0);
    expect(r.out).toContain('[sources.acme-wiki]\npath = "~/Code/acme/wiki"');
    expect(r.out).toContain('about = "Acme\'s standards and review specs"');
    expect(r.out).toContain('applies_to = ["~/Code/acme/*", "~/Code/acme-labs/*"]');
    expect(r.out).toContain('[sources.handbook]\npath = "/srv/handbook"');
    expect(r.out.split("[sources.handbook]")[1]).not.toContain("about");
  }, 120000);

  test("with no sources named there is no sources table", () => {
    const r = setupDryRun(setupTmp, writeAnswers(setupTmp, "none"));
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("[sources.");
  }, 120000);

  test("a source whose folder is not answered is refused by setup's own rule", () => {
    const r = setupDryRun(setupTmp, writeAnswers(setupTmp, "nopath", "sources=acme-wiki"));
    expect(r.code).toBe(1);
    expect(r.out).toContain("no answer for source.acme-wiki.path");
  }, 120000);

  test("a source whose folder is answered with nothing is refused, naming the key", () => {
    const answers = writeAnswers(
      setupTmp,
      "emptypath",
      "sources=acme-wiki\nsource.acme-wiki.path=",
    );
    const r = setupDryRun(setupTmp, answers);
    expect(r.code).toBe(1);
    expect(r.out).toContain("source 'acme-wiki' needs a folder: answer source.acme-wiki.path");
  }, 120000);

  test("a source name with a space or a slash is refused", () => {
    for (const bad of ["acme wiki", "acme/wiki"]) {
      const r = setupDryRun(setupTmp, writeAnswers(setupTmp, "badname", `sources=${bad}`));
      expect(r.code).toBe(1);
      expect(r.out).toContain("a source name is letters, digits, dot, underscore or dash");
    }
  }, 120000);

  test("text with a quote or a backslash is written as valid TOML", () => {
    const answers = writeAnswers(
      setupTmp,
      "quote",
      ["sources=w", 'source.w.path=/srv/a "b"', 'source.w.about=say "hi" \\ there'].join("\n"),
    );
    const r = setupDryRun(setupTmp, answers);
    expect(r.code).toBe(0);
    expect(r.out).toContain('path = "/srv/a \\"b\\""');
    expect(r.out).toContain('about = "say \\"hi\\" \\\\ there"');
  }, 120000);
});
