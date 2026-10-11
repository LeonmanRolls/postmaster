import { describe, expect, test } from "bun:test";
import { check, normalize, notInCorpus, pageQuotes, parse, pathsOf, quotesOf, report } from "./quotes.ts";

const page = `
Container cold starts can often be in the 1-3 second range, but this is dependent on [image size](/x/) and code execution time.

| Maximum Memory | 12 GiB |
`;

const notes = `
### A1.12 Cold start
- finding: fast
- quote: "Container cold starts can often be in the 1-3 second range" (verbatim) ; "dependent on image size and code execution time" (verbatim, partial)
- source: https://developers.cloudflare.com/containers/faq/ ; docs/containers/faq.mdx@6e1b964 lines 111-122 ; read 2026-10-08
- strength: stated

### X1 A made-up claim
- quote: "Containers sleep after exactly seven minutes of silence" (verbatim)
- source: docs/containers/faq.mdx@6e1b964 line 1
- strength: stated

### X2 Nothing in the repository
- quote: "A quotation from a vendor page that is not in the repository" (verbatim)
- source: https://example.com/page ; read 2026-10-08
`;

const read = (p: string): string | null => (p === "docs/containers/faq.mdx" ? page : null);

describe("normalize", () => {
  test("drops links, ticks and emphasis, and makes white space and quotes alike", () => {
    expect(normalize("A [link](/a/b) and `code`  with\n\n**bold** “quotes”")).toBe(
      'a link and code with bold "quotes"',
    );
  });
});

describe("normalize and angle brackets", () => {
  test("an unmatched less-than sign does not swallow the text after it", () => {
    expect(normalize("Wait <= 3 steps -> then go; Code runs here")).toBe("wait <= 3 steps -> then go; code runs here");
  });

  test("a real tag is still removed", () => {
    expect(normalize("a <Render product=\"x\" /> b <br> c")).toBe("a b c");
  });
});

describe("parse", () => {
  const entries = parse(notes);

  test("reads each entry's quotations and cited repository paths", () => {
    expect(entries.map((e) => e.id)).toEqual(["A1.12", "X1", "X2"]);
    expect(entries[0]?.quotes.length).toBe(2);
    expect(entries[0]?.paths).toEqual(["docs/containers/faq.mdx"]);
    expect(entries[2]?.paths).toEqual([]);
  });

  test("short quoted words and an ellipsis are handled", () => {
    expect(quotesOf(['- quote: "ok" and "Each pending operation ... for up to 15 minutes each"'])).toEqual([
      "Each pending operation",
      "for up to 15 minutes each",
    ]);
    expect(pathsOf(["- source: docs/a/b.mdx@6e1b964 lines 1-2 ; partials/c/d.mdx@6e1b964"])).toEqual([
      "docs/a/b.mdx",
      "partials/c/d.mdx",
    ]);
  });
});

describe("check", () => {
  const results = check(parse(notes), read);

  test("positive control: words that are on the page are found, markup or not", () => {
    expect(results.filter((r) => r.id === "A1.12").every((r) => r.found)).toBe(true);
  });

  test("negative control: a made-up sentence is checked and not found", () => {
    const x = results.find((r) => r.id === "X1");
    expect(x?.checked).toBe(true);
    expect(x?.found).toBe(false);
  });

  test("a quotation whose source is not in the repository is left unchecked, not failed", () => {
    const x = results.find((r) => r.id === "X2");
    expect(x?.checked).toBe(false);
  });

  test("the report counts them and lists what was missed", () => {
    const text = report(results);
    expect(text).toContain("4 quotations, 3 in an entry that cites a file of the repository text, 2 of those found");
    expect(text).toContain("X1");
  });
});

describe("pageQuotes and notInCorpus", () => {
  const pageText = `---
title: "A front matter title that is long enough to look like a quotation"
---
The docs say "Container cold starts can often be in the 1-3 second range" and "short".

- A bullet with "words that wrap onto
  the next line and are read whole" and then "A made-up sentence that no capture holds at all".
`;

  test("takes long quoted strings, reads a wrapped quotation whole and skips front matter and short quotes", () => {
    expect(pageQuotes(pageText)).toEqual([
      "Container cold starts can often be in the 1-3 second range",
      "words that wrap onto the next line and are read whole",
      "A made-up sentence that no capture holds at all",
    ]);
  });

  test("a short quotation does not throw off the pairing of the long one after it", () => {
    expect(pageQuotes('He wrote "no" and then "a sentence that is long enough to count".')).toEqual([
      "a sentence that is long enough to count",
    ]);
  });

  test("positive and negative: quotations in a capture are found, a made-up one is not", () => {
    const missing = notInCorpus(pageQuotes(pageText), [page, "words that wrap onto the next line and are read whole"]);
    expect(missing).toEqual(["A made-up sentence that no capture holds at all"]);
  });
});
