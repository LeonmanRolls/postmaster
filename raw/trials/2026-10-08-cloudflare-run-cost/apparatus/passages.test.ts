import { describe, expect, test } from "bun:test";
import { blocks, kept, render } from "./passages.ts";

const notes = `# Notes

preamble that is dropped

## A1 Lifecycle

### A1.2 Idle timeout
- finding: set it per object
- quote: "Without a timeout, Cloudflare stops the container shortly after." (verbatim)
  and a continuation line
- source: https://example.com/a ; docs/a.mdx@6e1b964 lines 1-2 ; read 2026-10-08
- strength: stated

### A1.9 A mere comment
- finding: nothing quoted here
- strength: argued

### A3.8 Not found: a rate limit
- finding: absent
- quote: n/a
- strength: not found

### A4.0 Code quoted without marks
- finding: a settings key
- quote: { endpoint_transport: { base_url: x } } (verbatim, repository text)
- source: https://example.com/c
- strength: shown

### A4.1 Another
- finding: kept
- quote: "A second sentence that is long enough to count." (verbatim)
- internal: not kept
- source: https://example.com/b
- strength: stated
`;

describe("blocks", () => {
  test("splits on ### headings and drops the preamble", () => {
    expect(blocks(notes).map((b) => b.id)).toEqual(["A1.2", "A1.9", "A3.8", "A4.0", "A4.1"]);
  });
});

describe("kept", () => {
  test("keeps finding, quote, source and strength lines with their continuations, and no other bullet", () => {
    const b = blocks(notes)[3];
    expect(kept(b as never).some((l) => l.includes("internal"))).toBe(false);
    const first = kept(blocks(notes)[0] as never);
    expect(first.some((l) => l.includes("a continuation line"))).toBe(true);
  });
});

describe("render", () => {
  const text = render(blocks(notes), "# Passages relied on");

  test("positive control: entries with a quotation and entries of absence are written", () => {
    expect(text).toContain("### A1.2 Idle timeout");
    expect(text).toContain("### A3.8 Not found: a rate limit");
    expect(text).toContain("### A4.1 Another");
  });

  test("code quoted without quotation marks counts as a quotation, and n/a does not", () => {
    expect(text).toContain("### A4.0 Code quoted without marks");
    expect(text).not.toContain("- quote: n/a\n- strength: argued");
  });

  test("negative control: an entry with no quotation and no absence is left out", () => {
    expect(text).not.toContain("A1.9");
  });

  test("a prefix numbers the entries that are written, in order, keeping the reader's own heading", () => {
    const numbered = render(blocks(notes), "# P", { prefix: "P" });
    expect(numbered).toContain("### P1 A1.2 Idle timeout");
    expect(numbered).toContain("### P2 A3.8 Not found: a rate limit");
    expect(numbered).toContain("### P3 A4.0 Code quoted without marks");
    expect(numbered).toContain("### P4 A4.1 Another");
  });

  test("an always pattern keeps a named entry that holds no quotation", () => {
    const kept = render(blocks(notes), "# P", { always: /^A1\.9 /u });
    expect(kept).toContain("### A1.9 A mere comment");
    expect(kept).toContain("- finding: nothing quoted here");
    expect(render(blocks(notes), "# P")).not.toContain("### A1.9");
  });

  test("an always pattern also matches the title, for entries whose ids repeat", () => {
    const kept = render(blocks(notes), "# P", { always: /mere comment/u });
    expect(kept).toContain("### A1.9 A mere comment");
    expect(render(blocks(notes), "# P", { always: /no such title/u })).not.toContain("### A1.9");
  });

  test("a checked line and an arithmetic line are kept, and a line about someone else's draft is not", () => {
    const text = render(
      blocks(
        [
          "### X1 A rate",
          "- finding: a rate",
          "- checked: yes (two reads agree)",
          '- quote: "an exact sentence on the page" (verbatim)',
          "- draft says: a private figure",
          "- arithmetic (not on the page): 4 x 3600 = 14400",
          "- source: https://example.com/p ; read 2026-10-09",
        ].join("\n"),
      ),
      "# P",
    );
    expect(text).toContain("- checked: yes (two reads agree)");
    expect(text).toContain("- arithmetic (not on the page): 4 x 3600 = 14400");
    expect(text).not.toContain("draft says");
  });

  test("an ids filter and a drop pattern narrow the output", () => {
    const only = render(blocks(notes), "# P", { ids: /^A4/u, drop: /^- source:/u });
    expect(only).toContain("A4.1");
    expect(only).not.toContain("A1.2");
    expect(only).not.toContain("- source:");
  });
});
