// Tests beside scripts/lib/stack-menu.ts. The libraries here are invented.

import { describe, expect, test } from "bun:test";
import { type IndexEntry, parseList, vocabulary } from "./index-match.ts";
import type { Pkg } from "./package-types.ts";
import { type Library, formatStack, functionsIndex, rankAcross } from "./stack-menu.ts";

const entry = (symbol: string, kind: string, file: string, line = 1, doc = ""): IndexEntry => ({
  symbol,
  kind,
  signature: symbol,
  doc,
  file,
  line,
});

const pkg = (name: string, version = "1.0.0", description?: string): Pkg => ({
  name,
  version,
  dir: `/cache/${name}`,
  ...(description !== undefined ? { description } : {}),
});

const CONSENT: Library = {
  name: "consent-lib",
  packages: [pkg("consent-lib", "2.1.0", "Keeps a visitor's consent choice.")],
  entries: [
    entry("ConsentConfig", "interface", "consent-lib/index.d.ts", 1),
    entry("ConsentConfig.cross_subdomain_cookie", "property", "consent-lib/index.d.ts", 2),
    entry("ConsentConfig.optOut", "method", "consent-lib/index.d.ts", 3),
    entry("init", "function", "consent-lib/index.d.ts", 5),
  ],
  menuFile: "menu.libs/consent-lib.tsv",
};

const STORAGE: Library = {
  name: "storage-lib",
  packages: [pkg("storage-lib")],
  entries: [
    entry("useStorageState", "hook", "storage-lib/index.d.ts", 1),
    entry("StorageOptions.persist_key", "property", "storage-lib/index.d.ts", 2),
  ],
  menuFile: "menu.libs/storage-lib.tsv",
};

const BIG: Library = {
  name: "big-lib",
  packages: [pkg("big-lib", "9.9.9")],
  entries: Array.from({ length: 30 }, (_, i) =>
    entry(`Big.thing_${i}`, "property", "big-lib/index.d.ts", i + 1),
  ),
  menuFile: "menu.libs/big-lib.tsv",
};

const EMPTY: Library = {
  name: "untyped-lib",
  packages: [pkg("untyped-lib", "0.1.0")],
  entries: [],
  note: "no declaration files",
};

const MISSING: Library = {
  name: "ghost-lib",
  packages: [],
  entries: [],
  note: "cannot find ghost-lib",
};

const VOCAB = vocabulary(
  "share the consent cookie across subdomains and persist the choice in storage",
);

describe("rankAcross", () => {
  test("ranks the names of every library on one scale, best first", () => {
    const { rows } = rankAcross([BIG, STORAGE, CONSENT], VOCAB);
    const symbols = rows.map((c) => c.entry.symbol);
    expect(symbols).toContain("ConsentConfig.cross_subdomain_cookie");
    expect(symbols).toContain("StorageOptions.persist_key");
    expect(symbols).toContain("useStorageState");
    expect(symbols.some((s) => s.startsWith("Big."))).toBe(false);
  });

  test("gives each library its share, its three nearest names and the score of the best", () => {
    const { hits } = rankAcross([BIG, STORAGE, CONSENT], VOCAB);
    const consent = hits.get("consent-lib");
    expect(consent?.count).toBeGreaterThan(0);
    expect(consent?.best[0]).toContain("cookie");
    expect((consent?.best.length ?? 0) <= 3).toBe(true);
    expect(consent?.score).toBeGreaterThan(0);
    expect(hits.get("big-lib")).toBeUndefined();
  });

  test("a library with a few names near the draft shows them when another has hundreds", () => {
    const heavy: Library = {
      name: "heavy-lib",
      packages: [pkg("heavy-lib")],
      entries: Array.from({ length: 400 }, (_, i) =>
        entry(`Heavy.cookie_choice_${i}`, "property", "heavy-lib/index.d.ts", i + 1),
      ),
    };
    const tiny: Library = {
      name: "tiny-lib",
      packages: [pkg("tiny-lib")],
      entries: [entry("Tiny.choice_unit", "property", "tiny-lib/index.d.ts")],
    };
    // enough other names that a word four hundred of them carry is not a word every name has
    const filler: Library = {
      name: "filler-lib",
      packages: [pkg("filler-lib")],
      entries: Array.from({ length: 4000 }, (_, i) =>
        entry(`Filler.unrelated_${i}`, "property", "filler-lib/index.d.ts", i + 1),
      ),
    };
    const { hits } = rankAcross([filler, heavy, tiny], VOCAB, 50, 10);
    expect(hits.get("heavy-lib")?.count).toBe(50);
    expect(hits.get("tiny-lib")?.count).toBe(0);
    expect(hits.get("tiny-lib")?.best).toEqual(["Tiny.choice_unit"]);
    expect(hits.get("tiny-lib")?.score).toBeGreaterThan(0);
  });

  test("a name two libraries both hold is credited to the first", () => {
    const twin: Library = { ...STORAGE, name: "twin-lib" };
    const { hits } = rankAcross([STORAGE, twin], VOCAB);
    expect(hits.get("storage-lib")?.best.length).toBeGreaterThan(0);
    expect(hits.get("twin-lib")).toBeUndefined();
  });

  test("limits the rows to the number asked for", () => {
    expect(rankAcross([CONSENT, STORAGE], VOCAB, 300, 2).rows).toHaveLength(2);
  });

  test("libraries with no names, and no libraries, give nothing", () => {
    expect(rankAcross([EMPTY, MISSING], VOCAB).rows).toEqual([]);
    expect(rankAcross([], VOCAB).rows).toEqual([]);
  });
});

describe("functionsIndex", () => {
  test("lists the functions, methods and hooks of each library, by library name", () => {
    expect(functionsIndex([STORAGE, CONSENT])).toEqual([
      "consent-lib",
      "  ConsentConfig{optOut()}, init()",
      "storage-lib",
      "  useStorageState()",
    ]);
  });

  test("a library with no functions has no line, and neither has one that was not read", () => {
    const lines = functionsIndex([BIG, EMPTY, MISSING]);
    expect(lines).toEqual([]);
  });

  test("wraps a long list", () => {
    const many: Library = {
      name: "many-lib",
      packages: [pkg("many-lib")],
      entries: Array.from({ length: 40 }, (_, i) =>
        entry(`function_number_${i}`, "function", "many-lib/index.d.ts", i + 1),
      ),
    };
    const lines = functionsIndex([many], 60);
    expect(lines[0]).toBe("many-lib");
    expect(lines.length).toBeGreaterThan(5);
    for (const l of lines.slice(1)) expect(l.length).toBeLessThanOrEqual(60);
  });
});

describe("formatStack", () => {
  const libs = [BIG, EMPTY, MISSING, STORAGE, CONSENT];
  const { rows, hits } = rankAcross(libs, VOCAB);
  const text = formatStack(
    { title: "api-index --all /repo", vocabularyKey: "abc123def456" },
    libs,
    hits,
    rows,
  );
  const lines = text.split("\n").filter((l) => l !== "");

  test("carries the draft's key, so the check can read it", () => {
    expect(parseList(text).vocabularyKey).toBe("abc123def456");
  });

  test("counts the libraries and the names in the heading", () => {
    expect(lines[1]).toBe("# 5 libraries, 3 with declarations, 36 names in all");
  });

  test("has the three parts, in order", () => {
    const at = (s: string): number => lines.findIndex((l) => l.startsWith(s));
    expect(at("# 1. EVERY LIBRARY")).toBeGreaterThan(0);
    expect(at("# 2. EVERY FUNCTION AND METHOD")).toBeGreaterThan(at("# 1. EVERY LIBRARY"));
    expect(at("# 3. THE NAMES NEAREST THE DRAFT")).toBeGreaterThan(
      at("# 2. EVERY FUNCTION AND METHOD"),
    );
  });

  test("lists the libraries with names near the draft first, the rest by score then name", () => {
    const rowsOf = lines.filter((l) => !l.startsWith("#")).map((l) => l.split("\t"));
    const directory = rowsOf.filter((r) => r.length === 7).map((r) => r[0]);
    expect(directory.slice(0, 2)).toEqual(["consent-lib", "storage-lib"]);
    expect(directory.slice(2)).toEqual(["big-lib", "ghost-lib", "untyped-lib"]);
  });

  test("a directory row gives version, names, matches, best names, menu file and description", () => {
    const row = lines.find((l) => l.startsWith("consent-lib\t")) ?? "";
    const cells = row.split("\t");
    expect(cells).toHaveLength(7);
    expect(cells[1]).toBe("2.1.0");
    expect(cells[2]).toBe("4");
    expect(Number(cells[3])).toBeGreaterThan(0);
    expect(cells[4]).toContain("cross_subdomain_cookie");
    expect(cells[5]).toBe("menu.libs/consent-lib.tsv");
    expect(cells[6]).toBe("Keeps a visitor's consent choice.");
  });

  test("a library with no declarations says why and where to read it; one not found says why", () => {
    const untyped = (lines.find((l) => l.startsWith("untyped-lib\t")) ?? "").split("\t");
    expect(untyped[1]).toBe("0.1.0");
    expect(untyped[2]).toBe("0");
    expect(untyped[4]).toBe("-");
    expect(untyped[5]).toBe("no declaration files (/cache/untyped-lib)");
    const ghost = (lines.find((l) => l.startsWith("ghost-lib\t")) ?? "").split("\t");
    expect(ghost[1]).toBe("-");
    expect(ghost[5]).toBe("cannot find ghost-lib");
  });

  test("every line is a comment, a directory row or a ranked row", () => {
    for (const l of lines.filter((x) => !x.startsWith("#"))) {
      expect([6, 7]).toContain(l.split("\t").length);
    }
  });

  test("the ranked part has the names nearest the draft across the libraries", () => {
    const part = text.slice(text.indexOf("# 3. THE NAMES NEAREST"));
    expect(part).toContain("ConsentConfig.cross_subdomain_cookie");
    expect(part).toContain("StorageOptions.persist_key");
  });
});
