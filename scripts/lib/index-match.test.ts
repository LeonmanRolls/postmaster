// Tests beside scripts/lib/index-match.ts. The library names here are invented.

import { describe, expect, test } from "bun:test";
import {
  type IndexEntry,
  draftText,
  formatList,
  leafOf,
  overview,
  parseList,
  rank,
  splitWords,
  stem,
  terms,
  vocabulary,
  vocabularyKey,
} from "./index-match.ts";

const entry = (
  symbol: string,
  doc = "",
  file = "lib/index.d.ts",
  kind = "property",
): IndexEntry => ({ symbol, kind, signature: `${symbol}: string`, doc, file, line: 1 });

describe("stem", () => {
  test("related forms of a word meet", () => {
    expect(stem("capturing")).toBe(stem("capture"));
    expect(stem("persistence")).toBe(stem("persisted"));
    expect(stem("persistence")).toBe(stem("persists"));
    expect(stem("cookies")).toBe(stem("cookie"));
  });

  test("a suffix comes off only when four letters are left", () => {
    expect(stem("users")).toBe("user");
    expect(stem("uses")).toBe("uses");
    expect(stem("api")).toBe("api");
  });

  test("different words stay apart", () => {
    expect(stem("cookie")).not.toBe(stem("consent"));
    expect(stem("domain")).not.toBe(stem("subdomain"));
  });
});

describe("splitWords", () => {
  test("splits at underscores, camel case and dots", () => {
    expect(splitWords("cross_subdomain_cookie")).toEqual(["cross", "subdomain", "cookie"]);
    expect(splitWords("PostHogConfig")).toEqual(["post", "hog", "config"]);
    expect(splitWords("XMLHttpRequest")).toEqual(["xml", "http", "request"]);
    expect(splitWords("Config.opt_out.v2")).toEqual(["config", "opt", "out", "v2"]);
  });

  test("an empty or symbol-only text has no words", () => {
    expect(splitWords("")).toEqual([]);
    expect(splitWords(" -- ")).toEqual([]);
  });
});

describe("terms and vocabulary", () => {
  test("common words, short words and numbers are left out", () => {
    expect(terms("the cookie is 123")).toEqual(["cook"]);
    expect(terms("is it up")).toEqual([]);
  });

  test("counts how often the draft says a stem", () => {
    const v = vocabulary("cookie cookies cookie banner");
    expect(v.get("cook")).toBe(3);
    expect(v.get(stem("banner"))).toBe(1);
    expect(v.size).toBe(2);
  });
});

describe("vocabularyKey", () => {
  const key = (text: string): string => vocabularyKey(vocabulary(text));

  test("is twelve hex characters", () => {
    expect(key("cookie banner")).toMatch(/^[0-9a-f]{12}$/u);
  });

  test("does not change when the draft repeats a word or reorders them", () => {
    expect(key("cookie banner")).toBe(key("banner banner cookie"));
  });

  test("changes when the draft gains or loses a word", () => {
    expect(key("cookie banner")).not.toBe(key("cookie banner consent"));
    expect(key("cookie banner")).not.toBe(key("cookie"));
  });
});

describe("rank", () => {
  test("puts the entry that shares the draft's words in its name first", () => {
    const entries = [
      entry("Config.api_host", "The host events are sent to."),
      entry("Config.cross_subdomain_cookie", "Share the cookie across subdomains."),
      entry("Config.session_recording", "Record sessions."),
    ];
    const got = rank(entries, vocabulary("share the cookie across subdomains"), 5);
    expect(got.map((c) => c.entry.symbol)).toEqual(["Config.cross_subdomain_cookie"]);
    expect(got[0]?.matched).toContain("cook");
    expect(got[0]?.matched).toContain("subdomain");
  });

  test("a word in the name counts more than the same word in a doc comment", () => {
    const entries = [
      entry("Config.other", "Mentions the cookie domain in passing."),
      entry("Config.cookie_domain", ""),
    ];
    const got = rank(entries, vocabulary("cookie domain"), 5);
    expect(got[0]?.entry.symbol).toBe("Config.cookie_domain");
    expect(got[1]?.entry.symbol).toBe("Config.other");
  });

  test("a word the file path carries still counts, a little", () => {
    const entries = [entry("Config.x", "", "consent/index.d.ts"), entry("Config.y", "")];
    const got = rank(entries, vocabulary("consent"), 5);
    expect(got.map((c) => c.entry.symbol)).toEqual(["Config.x"]);
  });

  test("a word nearly every entry carries tells nothing", () => {
    const filler = Array.from({ length: 30 }, (_, i) => entry(`Lib.widget_${i}`));
    const entries = [...filler, entry("Lib.cookie_jar")];
    const got = rank(entries, vocabulary("widget cookie"), 5);
    expect(got.map((c) => c.entry.symbol)).toEqual(["Lib.cookie_jar"]);
  });

  test("lists the whole family of a word the draft says again and again", () => {
    const cookies = Array.from({ length: 12 }, (_, i) => entry(`Config.cookie_option_${i}`));
    const others = Array.from({ length: 30 }, (_, i) => entry(`Config.unrelated_${i}`));
    const entries = [...cookies, ...others];
    expect(rank(entries, vocabulary("cookie cookie cookie"), 2, 5)).toHaveLength(7);
    expect(rank(entries, vocabulary("cookie cookie cookie"), 2, 0)).toHaveLength(2);
    // said once, it is not a family
    expect(rank(entries, vocabulary("cookie"), 2, 5)).toHaveLength(2);
  });

  test("the family limit holds", () => {
    const cookies = Array.from({ length: 25 }, (_, i) => entry(`Config.cookie_option_${i}`));
    const got = rank(cookies, vocabulary("cookie cookie"), 3, 10);
    expect(got).toHaveLength(13);
    expect(new Set(got.map((c) => c.entry.symbol)).size).toBe(13);
  });

  test("an empty vocabulary or no entries lists nothing", () => {
    expect(rank([entry("A.b")], new Map(), 5)).toEqual([]);
    expect(rank([], vocabulary("cookie"), 5)).toEqual([]);
  });
});

describe("draftText", () => {
  const DRAFT = [
    "## Problem / feature",
    "",
    "Visitors want a banner.",
    "",
    "## For the agents",
    "",
    "### Technical notes",
    "",
    "- Store the choice in a cookie.",
    "",
    "### Existing capabilities",
    "",
    "- **SDK** Offers: persistence settings. Uses: those. Custom: none. (C1)",
    "",
    "### Verified at 0123456789abcdef",
    "",
    "- A premise about sessions.",
    "",
  ].join("\n");

  test("leaves out the capabilities and the verified sections", () => {
    const text = draftText(DRAFT);
    expect(text).toContain("banner");
    expect(text).toContain("cookie");
    expect(text).not.toContain("persistence");
    expect(text).not.toContain("premise");
  });

  test("a first-line DRAFT: marker is not part of the draft", () => {
    const marked = `DRAFT: awaiting the user's review\n\n${DRAFT}`;
    expect(draftText(marked)).not.toContain("awaiting");
    expect(vocabularyKey(vocabulary(draftText(marked)))).toBe(
      vocabularyKey(vocabulary(draftText(DRAFT))),
    );
    expect(draftText("DRAFT: awaiting review\n\nPlain cookie text.\n")).not.toContain("awaiting");
  });

  test("DRAFT: later in the text is kept", () => {
    expect(draftText("Plain cookie text.\nDRAFT: later\n")).toContain("DRAFT: later");
  });

  test("a text with no agents part is kept whole", () => {
    expect(draftText("Just a cookie banner.\n")).toContain("Just a cookie banner.");
  });

  test("editing the left-out sections does not change the vocabulary key", () => {
    const edited = DRAFT.replace("persistence settings", "storage options and other things");
    expect(vocabularyKey(vocabulary(draftText(edited)))).toBe(
      vocabularyKey(vocabulary(draftText(DRAFT))),
    );
    const grown = DRAFT.replace("Visitors want a banner.", "Visitors want a banner and a toggle.");
    expect(vocabularyKey(vocabulary(draftText(grown)))).not.toBe(
      vocabularyKey(vocabulary(draftText(DRAFT))),
    );
  });
});

describe("leafOf", () => {
  test("is the last name of a symbol", () => {
    expect(leafOf("PostHogConfig.cross_subdomain_cookie")).toBe("cross_subdomain_cookie");
    expect(leafOf("Owner.member.nested")).toBe("nested");
    expect(leafOf("init")).toBe("init");
  });
});

describe("overview", () => {
  const at = (symbol: string, kind: string, file: string, line: number): IndexEntry => ({
    symbol,
    kind,
    signature: symbol,
    doc: "",
    file,
    line,
  });

  test("groups the names by file and owner, a function or method written with ()", () => {
    const lines = overview([
      at("Config", "interface", "lib/config.d.ts", 1),
      at("Config.api_host", "property", "lib/config.d.ts", 2),
      at("Config.onLoad", "method", "lib/config.d.ts", 3),
      at("Config.nested", "property", "lib/config.d.ts", 4),
      at("Config.nested.depth", "property", "lib/config.d.ts", 5),
      at("init", "function", "lib/index.d.ts", 1),
      at("VERSION", "const", "lib/index.d.ts", 2),
      at("useConsent", "hook", "lib/index.d.ts", 3),
    ]);
    expect(lines).toEqual([
      "lib/config.d.ts",
      "  Config{api_host, onLoad(), nested, nested.depth}",
      "lib/index.d.ts",
      "  init(), VERSION, useConsent()",
    ]);
  });

  test("lists files in order, and the names of a file in the order they are declared", () => {
    const lines = overview([
      at("Later", "type", "b.d.ts", 9),
      at("Early", "type", "b.d.ts", 2),
      at("Other", "type", "a.d.ts", 1),
    ]);
    expect(lines).toEqual(["a.d.ts", "  Other", "b.d.ts", "  Early, Later"]);
  });

  test("an owner whose declaration is in another file is still shown", () => {
    expect(overview([at("Ghost.thing", "property", "x.d.ts", 1)])).toEqual([
      "x.d.ts",
      "  Ghost{thing}",
    ]);
  });

  test("a name declared twice is listed once", () => {
    const lines = overview([
      at("Widget", "class", "x.d.ts", 1),
      at("Widget.open", "method", "x.d.ts", 2),
      at("Widget.open", "method", "x.d.ts", 3),
    ]);
    expect(lines).toEqual(["x.d.ts", "  Widget{open()}"]);
  });

  test("long lists wrap at the width without splitting a name, every line indented", () => {
    const entries = [
      at("Config", "interface", "x.d.ts", 1),
      ...Array.from({ length: 60 }, (_, i) =>
        at(`Config.setting_number_${i}`, "property", "x.d.ts", i + 2),
      ),
    ];
    const lines = overview(entries, 60);
    expect(lines[0]).toBe("x.d.ts");
    const body = lines.slice(1);
    expect(body.length).toBeGreaterThan(10);
    for (const l of body) {
      expect(l.startsWith("  ")).toBe(true);
      expect(l.length).toBeLessThanOrEqual(60);
    }
    const text = body.join(" ");
    expect(text).toContain("Config{setting_number_0,");
    expect(text.endsWith("setting_number_59}")).toBe(true);
    for (let i = 0; i < 60; i++) expect(text).toContain(`setting_number_${i}`);
  });

  test("a re-export is left out, and a file of only re-exports has no line", () => {
    const lines = overview([
      at("Widget", "class", "x.d.ts", 1),
      at("Widget", "re-export", "x.d.ts", 9),
      at("Barrel", "re-export", "index.ts", 1),
    ]);
    expect(lines).toEqual(["x.d.ts", "  Widget"]);
  });

  test("an index with nothing in it has no lines", () => {
    expect(overview([])).toEqual([]);
  });
});

describe("a saved list", () => {
  const rows = [
    { entry: entry("Config.cross_subdomain_cookie", "Share\tthe cookie."), matched: ["cook"] },
    { entry: entry("makeThing", "", "lib/x.d.ts", "function") },
  ];

  test("reads back the key and the symbols it was saved with", () => {
    const text = formatList(
      { title: "api-index lib@1", vocabularyKey: "abc123def456", total: 9 },
      rows,
    );
    expect(parseList(text)).toEqual({
      vocabularyKey: "abc123def456",
      symbols: ["Config.cross_subdomain_cookie", "makeThing"],
    });
  });

  test("a list made without a draft has no key", () => {
    const text = formatList({ title: "api-index lib@1", total: 2 }, rows);
    expect(parseList(text).vocabularyKey).toBeNull();
    expect(parseList(text).symbols).toHaveLength(2);
  });

  test("a row has six cells; a tab in a doc comment cannot add one", () => {
    const text = formatList({ title: "t", total: 2 }, rows);
    const first = text.split("\n").find((l) => l.startsWith("Config.")) ?? "";
    const cells = first.split("\t");
    expect(cells).toHaveLength(6);
    expect(cells[3]).toBe("Share the cookie.");
    expect(cells[4]).toBe("lib/index.d.ts:1");
    expect(cells[5]).toBe("cook");
  });

  test("the header says how many entries the index held", () => {
    const text = formatList({ title: "t", total: 9 }, rows);
    expect(text).toContain("# entries in the index: 9; listed: 2");
  });

  test("with names, the map of every name follows as # lines and the list still reads back", () => {
    const names = [
      entry("Config.cross_subdomain_cookie"),
      entry("Config.api_host"),
      entry("makeThing", "", "lib/x.d.ts", "function"),
    ];
    const text = formatList({ title: "t", vocabularyKey: "abc123def456", total: 3 }, rows, names);
    expect(parseList(text)).toEqual({
      vocabularyKey: "abc123def456",
      symbols: ["Config.cross_subdomain_cookie", "makeThing"],
    });
    const lines = text.split("\n").filter((l) => l !== "");
    const at = lines.findIndex((l) => l.startsWith("# every name in the index"));
    expect(at).toBeGreaterThan(0);
    expect(lines.slice(at).every((l) => l.startsWith("#"))).toBe(true);
    expect(lines.slice(at).join("\n")).toContain("Config{cross_subdomain_cookie, api_host}");
    expect(lines.slice(at).join("\n")).toContain("makeThing()");
  });

  test("without names there is no map", () => {
    expect(formatList({ title: "t", total: 2 }, rows)).not.toContain("every name");
  });

  test("an empty text has no symbols", () => {
    expect(parseList("")).toEqual({ vocabularyKey: null, symbols: [] });
  });
});
