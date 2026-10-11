// Tests beside scripts/story-page.ts: the pure core is called directly. The
// commands themselves run end to end in the #352 oracle, as subprocesses.
import { describe, expect, test } from "bun:test";
import {
  buildSteps,
  checkDrawings,
  computeGaps,
  cutDoc,
  fill,
  gapRows,
  mimeOf,
  parseBoxes,
  parseCited,
  parseStory,
  parseViewport,
  pickStep,
  prepareDiagram,
  readingLine,
  refRows,
  renderDoc,
  renderMd,
  repoOf,
  sceneBlocks,
  scrubStory,
  startsInFence,
  stepsHtml,
  tagSvg,
  ticketDocId,
} from "./story-page.ts";
import type { DiagramScene, Doc, PageParts, Row, Scene, Story } from "./story-page.ts";

describe("the reading line", () => {
  test("below the panel on a phone, above the middle beside it", () => {
    expect(readingLine(844, true)).toBeCloseTo(624.56, 2);
    expect(readingLine(820, false)).toBe(369);
  });

  test("the step on the line, else the nearest, else none", () => {
    const boxes = [
      { top: 0, bottom: 100 },
      { top: 600, bottom: 700 },
      { top: 800, bottom: 900 },
    ];
    expect(pickStep(boxes, 844, true)).toBe(1);
    expect(
      pickStep(
        [
          { top: 0, bottom: 100 },
          { top: 700, bottom: 800 },
        ],
        844,
        true,
      ),
    ).toBe(1);
    expect(
      pickStep(
        [
          { top: 700, bottom: 800 },
          { top: 900, bottom: 1000 },
        ],
        844,
        true,
      ),
    ).toBe(0);
    expect(
      pickStep(
        [
          { top: 0, bottom: 100 },
          { top: 200, bottom: 300 },
        ],
        844,
        true,
      ),
    ).toBe(1);
  });

  test("ties go to the first step, offscreen steps are skipped", () => {
    expect(
      pickStep(
        [
          { top: 0, bottom: 700 },
          { top: 600, bottom: 900 },
        ],
        844,
        true,
      ),
    ).toBe(0);
    expect(
      pickStep(
        [
          { top: -200, bottom: -100 },
          { top: 700, bottom: 800 },
        ],
        844,
        true,
      ),
    ).toBe(1);
    expect(
      pickStep(
        [
          { top: -200, bottom: -100 },
          { top: 900, bottom: 1000 },
        ],
        844,
        true,
      ),
    ).toBe(-1);
  });

  test("the embedded source is plain script with the same rule", () => {
    const src = pickStep.toString();
    expect(src).toContain("readingLine(");
    expect(src).not.toContain("StepBox");
    expect(src).not.toContain(": number");
    const line = readingLine.toString();
    expect(line).toContain("0.74");
    expect(line).toContain("0.45");
    const factory = new Function(
      `${src};${line};return function (boxes, h, n) { return pickStep(boxes, h, n); };`,
    ) as () => (boxes: { top: number; bottom: number }[], h: number, n: boolean) => number;
    const embedded = factory();
    expect(
      embedded(
        [
          { top: 0, bottom: 100 },
          { top: 600, bottom: 700 },
        ],
        844,
        true,
      ),
    ).toBe(1);
  });

  test("viewports and boxes parse, garbage does not", () => {
    expect(parseViewport("390x844")).toEqual({ w: 390, h: 844, narrow: true });
    expect(parseViewport("900x800").narrow).toBe(false);
    expect(() => parseViewport("390")).toThrow("WxH");
    expect(parseBoxes("[[0,100],[600,700]]")).toEqual([
      { top: 0, bottom: 100 },
      { top: 600, bottom: 700 },
    ]);
    expect(() => parseBoxes("[[0]]")).toThrow("boxes");
    expect(() => parseBoxes("nope")).toThrow("boxes");
  });
});

describe("parseStory", () => {
  const minimal = {
    repoUrl: "https://github.com/o/r",
    ticket: 1,
    at: "abc",
    sections: [{ id: "open", label: "Start", title: "The ticket" }],
    scenes: [{ id: "hero", kind: "image", label: "T", chip: "c", prompt: "art/p.txt", alt: "a" }],
    steps: [{ id: "t", section: "open", scene: "hero", kind: "title", title: "T", text: "x" }],
  };

  test("a minimal ticket story reads", () => {
    const story = parseStory(JSON.stringify(minimal));
    expect(story.ticket).toBe(1);
    expect(story.scenes[0].kind).toBe("image");
  });

  test("a change story, a file picture and change scenes are refused", () => {
    expect(() => parseStory(JSON.stringify({ ...minimal, mode: "change" }))).toThrow(
      'mode "change"',
    );
    const clone = (): typeof minimal => JSON.parse(JSON.stringify(minimal)) as typeof minimal;
    const src = clone();
    const hero = src.scenes[0] as unknown as Record<string, unknown>;
    delete hero.prompt;
    hero.src = "art/opening.jpg";
    expect(() => parseStory(JSON.stringify(src))).toThrow("name a prompt");
    const base = clone();
    (base.scenes[0] as unknown as Record<string, unknown>).kind = "base";
    expect(() => parseStory(JSON.stringify(base))).toThrow('kind "base"');
    const bogus = clone();
    (bogus.scenes[0] as unknown as Record<string, unknown>).kind = "bogus";
    expect(() => parseStory(JSON.stringify(bogus))).toThrow('kind "bogus"');
  });

  test("missing pieces name themselves", () => {
    expect(() => parseStory("nope")).toThrow("not JSON");
    expect(() => parseStory(JSON.stringify({ ...minimal, at: undefined }))).toThrow("no at");
  });

  test("an empty mark is refused", () => {
    const clone = JSON.parse(JSON.stringify(minimal)) as typeof minimal;
    const step = clone.steps[0] as unknown as Record<string, unknown>;
    step.marks = [{ line: 1, text: [""] }];
    expect(() => parseStory(JSON.stringify(clone))).toThrow("names an empty mark");
    step.marks = [{ line: 1, text: ["word"] }];
    expect(() => parseStory(JSON.stringify(clone))).not.toThrow();
  });
});

describe("checkDrawings", () => {
  const story = (steps: { id: string; section: string; scene: string }[]): Story =>
    ({
      repoUrl: "u",
      ticket: 1,
      at: "a",
      sections: [
        { id: "open", label: "S", title: "Start" },
        { id: "c1", label: "C1", title: "Criterion 1" },
      ],
      scenes: [
        { id: "d", kind: "diagram", label: "D", chip: "c", svg: "d.svg", states: ["all"] },
        { id: "code", kind: "ref", file: "f.ts", from: 1, to: 3 },
        { id: "doc", kind: "md", file: "f.md", from: 1, to: 3 },
      ],
      steps: steps.map((s) => ({ ...s, title: "t", text: "x" })),
    }) as Story;

  test("a drawing before the first code step passes, md counts as code", () => {
    expect(() =>
      checkDrawings(
        story([
          { id: "a", section: "c1", scene: "d" },
          { id: "b", section: "c1", scene: "code" },
        ]),
      ),
    ).not.toThrow();
    expect(() =>
      checkDrawings(
        story([
          { id: "a", section: "c1", scene: "d" },
          { id: "b", section: "c1", scene: "doc" },
        ]),
      ),
    ).not.toThrow();
  });

  test("code with no drawing before it names the section", () => {
    expect(() => checkDrawings(story([{ id: "skill", section: "c1", scene: "doc" }]))).toThrow(
      'section c1 (Criterion 1): step "skill" shows code with no drawing',
    );
  });
});

describe("scrubStory", () => {
  test("rendered prose is scrubbed, keys and paths stay exact", () => {
    const { story, removed } = scrubStory({
      repoUrl: "https://host/u/r",
      ticket: 1,
      at: "a",
      title: "Ask " + "a@b" + ".co anything",
      sections: [{ id: "open", label: "Start", title: "Mail " + "c@d" + ".co here" }],
      scenes: [
        {
          id: "d",
          kind: "diagram",
          label: "D",
          chip: "e@f" + ".co",
          svg: "d.svg",
          states: ["all"],
        },
        { id: "r", kind: "ref", file: "f.ts", from: 1, to: 2 },
      ],
      steps: [
        {
          id: "w",
          section: "open",
          scene: "r",
          title: "Write " + "g@h" + ".co",
          text: "words",
          find: ["g@h" + ".co"],
        },
      ],
    } as Story);
    expect(removed).toBe(4);
    expect(story.title).toBe("Ask <address removed> anything");
    expect(story.sections[0]?.title).toBe("Mail <address removed> here");
    expect(story.steps[0]?.title).toBe("Write <address removed>");
    expect(story.steps[0]?.find).toEqual(["g@h" + ".co"]);
    const diagram = story.scenes[0];
    expect(diagram?.kind).toBe("diagram");
    if (diagram?.kind === "diagram") {
      expect(diagram.chip).toBe("<address removed>");
      expect(diagram.svg).toBe("d.svg");
    }
  });
});

describe("parseCited", () => {
  const body = [
    "a [`f.ts` L1-L2](https://github.com/o/r/blob/abc1234/f.ts#L1-L2) cite",
    "and [`g.md`](https://github.com/o/r/blob/abc1234/g.md) whole,",
    "plus `https://github.com/<owner>/<repo>/blob/<sha>/<path>#L<a>-L<b>` stepping past.",
  ].join("\n");

  test("lines are cited, whole files named, templates ignored", () => {
    const { cited, named } = parseCited(body, "abc1234def");
    expect(cited).toEqual(["f.ts@1", "f.ts@2"]);
    expect(named).toEqual([{ path: "g.md", url: "https://github.com/o/r/blob/abc1234/g.md" }]);
  });

  test("another commit is refused naming the link", () => {
    expect(() => parseCited(body, "deadbee")).toThrow(
      "the ticket cites f.ts at abc1234, not at the story's commit deadbee",
    );
  });

  test("a branch link is refused, column anchors cite whole lines", () => {
    const cite = (ref: string, lines: string): string =>
      `a [cite](https://github.com/o/r/blob/${ref}/f.ts${lines}) here`;
    expect(() => parseCited(cite("main", "#L10-L12"), "abc1234")).toThrow(
      "the ticket cites f.ts at main, not at the story's commit abc1234",
    );
    expect(() => parseCited(cite("abc", "#L1"), "abc1234")).toThrow(
      "the ticket cites f.ts at abc, not at the story's commit abc1234",
    );
    expect(parseCited(cite("abc1234", "#L10C5-L12C3"), "abc1234").cited).toEqual([
      "f.ts@10",
      "f.ts@11",
      "f.ts@12",
    ]);
    expect(() => parseCited(cite("abc1234", "#L10-20"), "abc1234")).toThrow(
      "the range's second end needs -L",
    );
    expect(() => parseCited(cite("abc1234", "#L10-"), "abc1234")).toThrow(
      "the range's second end needs -L",
    );
  });

  test("a line 0, a reversed range and a huge range are refused", () => {
    const cite = (lines: string): string =>
      `a [cite](https://github.com/o/r/blob/abc1234/f.ts${lines}) here`;
    expect(() => parseCited(cite("#L0"), "abc1234")).toThrow("line 0 of f.ts");
    expect(() => parseCited(cite("#L5-L2"), "abc1234")).toThrow("the range ends first");
    expect(() => parseCited(cite("#L1-L999999999"), "abc1234")).toThrow("over 100000 lines");
    expect(parseCited(cite("#L2-L3"), "abc1234").cited).toEqual(["f.ts@2", "f.ts@3"]);
  });

  test("an end past the safe integers is refused, not looped on", () => {
    expect(() =>
      parseCited(
        "a [cite](https://github.com/o/r/blob/abc1234/f.ts#L9007199254740992) here",
        "abc1234",
      ),
    ).toThrow("past the last line a story counts");
  });

  test("links outside the target repository are skipped, not refused", () => {
    const target = { owner: "o", repo: "r" };
    const body = [
      "a [foreign](https://github.com/other/dep/blob/fffffffffffff/x.ts#L1) cite",
      "and [local](https://github.com/o/r/blob/abc1234/f.ts#L2-L3) cite",
      "plus [cased](https://github.com/O/R/blob/abc1234/g.ts#L4) cite",
    ].join("\n");
    expect(parseCited(body, "abc1234", target).cited).toEqual(["f.ts@2", "f.ts@3", "g.ts@4"]);
    const same = "a [x](https://github.com/other/dep/blob/abc1234/x.ts#L1) cite";
    expect(parseCited(same, "abc1234", target).cited).toEqual([]);
    expect(parseCited(same, "abc1234", undefined).cited).toEqual(["x.ts@1"]);
  });

  test("owner and repo read from a repository URL", () => {
    expect(repoOf("https://github.com/o/r")).toEqual({ owner: "o", repo: "r" });
    expect(repoOf("https://github.com/o/r.git/")).toEqual({ owner: "o", repo: "r" });
    expect(repoOf("not a url")).toBeUndefined();
    expect(repoOf("https://github.com/o")).toBeUndefined();
  });

  test("gaps fold runs and skip shown lines", () => {
    const gaps = computeGaps(["a@1", "a@2", "a@4", "b@9"], new Set(["a@2"]));
    expect(gaps).toEqual([
      { file: "a", from: 1, to: 1 },
      { file: "a", from: 4, to: 4 },
      { file: "b", from: 9, to: 9 },
    ]);
  });
});

describe("renderDoc", () => {
  test("blocks light by their words, continuations fold in", () => {
    const doc = renderDoc("## Criteria\n\n1. First words\n2. Second words\n", "Ticket", "Title");
    expect(doc.blocks[0]).toBe("Title");
    expect(doc.blocks).toContain("First words");
    expect(doc.html).toContain('data-b="2"');
    const folded = renderDoc("- one\n  continued\n", "T", "Title");
    expect(folded.blocks).toContain("one continued");
  });

  test("a continued list item keeps its link and bold", () => {
    const doc = renderDoc(
      "- [#434, x](https://example.org/y) makes **a story**\n  continued here\n",
      "T",
      "Title",
    );
    expect(doc.html).toContain('<a href="https://example.org/y">#434, x</a>');
    expect(doc.html).toContain("<strong>a story</strong>");
    expect(doc.html).toContain("continued here");
    expect(doc.blocks).toContain("#434, x makes a story continued here");
  });

  test("cutDoc keeps the part the scene shows", () => {
    expect(cutDoc("a\n## For the agents\nb", "s", undefined, "## For the agents")).toBe("a\n");
    expect(cutDoc("a\n## For the agents\nb", "s", "## For the agents", undefined)).toBe(
      "## For the agents\nb",
    );
    expect(() => cutDoc("a", "s", "## Else", undefined)).toThrow('"## Else" is not in the text');
  });
});

describe("renderMd", () => {
  test("each block knows its source lines", () => {
    const { spans } = renderMd(["# H", "", "- item", "  more", "", "```", "code", "```"], 10);
    expect(spans).toEqual([
      [10, 10],
      [12, 13],
      [15, 17],
    ]);
  });

  test("an unclosed fence at the range end still shows its lines", () => {
    const { html, spans } = renderMd(["# t", "```", "code-x", "code-y"], 10);
    expect(html).toContain("code-x");
    expect(html).toContain("code-y");
    expect(spans).toEqual([
      [10, 10],
      [11, 13],
    ]);
  });

  test("a range starting inside a fence is detected", () => {
    const all = ["# t", "```", "code-x", "```", "after"];
    expect(startsInFence(all, 3)).toBe(true);
    expect(startsInFence(all, 5)).toBe(false);
    expect(startsInFence(all, 1)).toBe(false);
  });

  test("a continuation keeps dollar patterns literal", () => {
    const { html } = renderMd(["- item one", "  costs $& dollars"], 1);
    expect(html).toContain("costs $&amp; dollars");
  });

  test("an indented line after a fence starts a new block", () => {
    const { html, spans } = renderMd(["```", "  li d", "```", "  continued text"], 1);
    expect(html).toContain("continued text");
    expect(spans).toEqual([
      [1, 3],
      [4, 4],
    ]);
  });
});

describe("rows and steps", () => {
  test("ref rows key every line, gap rows key their range", () => {
    expect(refRows("f.ts", 2, 5, ["a", "b", "c"])).toEqual([
      { type: "ctx", n: 2, text: "b", key: "f.ts@2" },
      { type: "ctx", n: 3, text: "c", key: "f.ts@3" },
    ]);
    expect(gapRows({ file: "f.ts", from: 2, to: 2 }, ["a", "b"])).toEqual([
      { type: "ctx", n: 2, text: "b", key: "f.ts@2" },
    ]);
    expect(gapRows({ file: "f.ts", from: 2, to: 5 }, ["a", "b"])).toEqual([
      { type: "ctx", n: 2, text: "b", key: "f.ts@2" },
    ]);
  });

  test("steps light rows, blocks and states, and refuse the rest", () => {
    const story = {
      sections: [{ id: "c1", label: "C1", title: "C1" }],
      steps: [
        { id: "r", section: "c1", scene: "code", focus: [[2, 2]], title: "t", text: "x" },
        {
          id: "m",
          section: "c1",
          scene: "md",
          focus: [[1, 1]],
          title: "t",
          text: "x",
          marks: undefined,
        },
        { id: "d", section: "c1", scene: "ticket", find: ["needle"], title: "t", text: "x" },
        { id: "g", section: "c1", scene: "dg", state: "all", title: "t", text: "x" },
      ],
    } as unknown as Story;
    const all: [string, Scene][] = [
      ["code", { id: "code", kind: "ref", file: "f.ts", from: 1, to: 3 }],
      ["md", { id: "md", kind: "md", file: "f.md", from: 1, to: 2 }],
      ["ticket", { id: "ticket", kind: "doc", from: "issue", number: 1, label: "T", chip: "c" }],
      ["dg", { id: "dg", kind: "diagram", label: "D", chip: "c", svg: "d.svg", states: ["all"] }],
    ];
    const docs = new Map<string, Doc>([["ticket", renderDoc("a needle here\n", "T", "Title")]]);
    const mds = new Map([["md", renderMd(["# H", "words"], 1)]]);
    const rows = new Map<string, Row[]>([["code", refRows("f.ts", 1, 3, ["a", "b", "c"])]]);
    const data = buildSteps(story, new Map(all), docs, mds, rows, "abc1234");
    expect(data.map((s) => [s.id, s.lit])).toEqual([
      ["r", [1]],
      ["m", [0]],
      ["d", [1]],
      ["g", []],
    ]);
    expect(data[0].chip).toBe("as it stands at abc1234");
    expect(data[3].state).toBe("all");
  });

  test("a focus, find or state that lights nothing is refused", () => {
    const base = {
      sections: [{ id: "c1", label: "C1", title: "C1" }],
      scenes: [],
      steps: [],
    };
    const one = (step: unknown): Story => ({ ...base, steps: [step] }) as unknown as Story;
    const all = new Map<string, Scene>([
      ["code", { id: "code", kind: "ref", file: "f.ts", from: 1, to: 3 }],
      ["dg", { id: "dg", kind: "diagram", label: "D", chip: "c", svg: "d.svg", states: ["all"] }],
      ["ticket", { id: "ticket", kind: "doc", from: "issue", number: 1, label: "T", chip: "c" }],
    ]);
    const docs = new Map<string, Doc>([["ticket", renderDoc("words\n", "T", "Title")]]);
    const rows = new Map<string, Row[]>([["code", refRows("f.ts", 1, 3, ["a", "b", "c"])]]);
    const mds = new Map();
    expect(() =>
      buildSteps(
        one({ id: "r", section: "c1", scene: "code", focus: [[9, 9]], title: "t", text: "x" }),
        all,
        docs,
        mds,
        rows,
        "a",
      ),
    ).toThrow("its focus lights no row");
    expect(() =>
      buildSteps(
        one({ id: "d", section: "c1", scene: "ticket", find: ["absent"], title: "t", text: "x" }),
        all,
        docs,
        mds,
        rows,
        "a",
      ),
    ).toThrow('"absent" is in 0 blocks');
    expect(() =>
      buildSteps(
        one({ id: "g", section: "c1", scene: "dg", state: "bogus", title: "t", text: "x" }),
        all,
        docs,
        mds,
        rows,
        "a",
      ),
    ).toThrow("state bogus is not one of dg's: all");
    expect(() =>
      buildSteps(
        one({ id: "g", section: "c1", scene: "dg", title: "t", text: "x" }),
        all,
        docs,
        mds,
        rows,
        "a",
      ),
    ).toThrow("state (none) is not one of dg's");
    expect(() =>
      buildSteps(
        one({ id: "e", section: "c1", scene: "ticket", excerpt: true, title: "t", text: "x" }),
        all,
        docs,
        mds,
        rows,
        "a",
      ),
    ).toThrow("an excerpt with no find shows an empty panel");
  });

  test("marks name rows and words that are there", () => {
    const story = {
      sections: [{ id: "c1", label: "C1", title: "C1" }],
      steps: [
        {
          id: "r",
          section: "c1",
          scene: "code",
          focus: [[1, 1]],
          marks: [{ line: 1, text: ["a"] }],
          title: "t",
          text: "x",
        },
      ],
    } as unknown as Story;
    const all = new Map<string, Scene>([
      ["code", { id: "code", kind: "ref", file: "f.ts", from: 1, to: 2 }],
    ]);
    const rows = new Map<string, Row[]>([["code", refRows("f.ts", 1, 2, ["a", "b"])]]);
    const data = buildSteps(story, all, new Map(), new Map(), rows, "a");
    expect(data[0].marks).toEqual([{ row: 0, text: ["a"] }]);
    const bad = {
      sections: [{ id: "c1", label: "C1", title: "C1" }],
      steps: [
        {
          id: "r",
          section: "c1",
          scene: "code",
          focus: [[1, 1]],
          marks: [{ line: 2, text: ["absent"] }],
          title: "t",
          text: "x",
        },
      ],
    } as unknown as Story;
    expect(() => buildSteps(bad, all, new Map(), new Map(), rows, "a")).toThrow(
      '"absent" is not on line 2',
    );
  });

  test("coverage counts fill the text", () => {
    expect(fill("{shown} of {changed}, {left} out", 3, 5, 2)).toBe("3 of 5, 2 out");
  });
});

describe("diagrams", () => {
  const scene: DiagramScene = {
    id: "d",
    kind: "diagram",
    label: "D",
    chip: "c",
    svg: "d.svg",
    states: ["a", "b"],
    caption: "Cap",
  };

  test("marks become CSS per state", () => {
    const svg = `<svg class="dg" viewBox="0 0 10 10"><rect id="r" class="on-a hl-b" data-shift-b="1 2"/><text class="dim-a">t</text></svg>`;
    const ready = prepareDiagram(svg, { ...scene }, "a");
    const sel = ":is(#dg-d, #sheet-d-a, #sheet-d-b)";
    expect(ready.css.join("\n")).toContain(`${sel} .on-a { opacity: 0; }`);
    expect(ready.css.join("\n")).toContain(
      `${sel}[data-state="b"] #r { transform: translate(1px, 2px); }`,
    );
    expect(ready.svg).toContain('id="dg-d"');
    expect(ready.svg).toContain('data-state="a"');
    expect(ready.svg).toContain('aria-label="Cap"');
    expect(ready.svg).toContain('role="img"');
  });

  test("undeclared states, lost shifts and missing states are refused", () => {
    const svg = `<svg class="dg"><rect class="on-bogus"/></svg>`;
    expect(() => prepareDiagram(svg, { ...scene }, "a")).toThrow("on-bogus names no state");
    const shift = `<svg class="dg"><rect data-shift-a="1 2"/></svg>`;
    expect(() => prepareDiagram(shift, { ...scene }, "a")).toThrow("no id before it");
    const nostates = `<svg class="dg"><rect/></svg>`;
    expect(() => prepareDiagram(nostates, { ...scene, states: [] }, "")).toThrow("names no states");
  });

  test("an existing label is kept, a missing svg refused", () => {
    const tagged = tagSvg(
      '<svg class="dg" aria-label="Kept"><rect/></svg>',
      "dg-d",
      "a",
      "Cap",
      "d",
    );
    expect(tagged).toContain('aria-label="Kept"');
    expect(tagged).toContain('id="dg-d"');
    expect(() => tagSvg("nope", "dg-d", "a", "Cap", "d")).toThrow("scene d: its diagram is no SVG");
  });

  test("a diagram without the dg class gains it, once", () => {
    expect(tagSvg('<svg viewBox="0 0 1 1"><rect/></svg>', "dg-d", "a", "Cap", "d")).toContain(
      'class="dg"',
    );
    expect(tagSvg('<svg class="plate"><rect/></svg>', "dg-d", "a", "Cap", "d")).toContain(
      'class="plate dg"',
    );
    const kept = tagSvg('<svg class="dg"><rect/></svg>', "dg-d", "a", "Cap", "d");
    expect(kept).toContain('class="dg"');
    expect(kept).not.toContain("dg dg");
  });
});

describe("page pieces", () => {
  test("the ticket document is found by issue and number, not by id", () => {
    const story = {
      ticket: 352,
      scenes: [
        { id: "brief", kind: "doc", from: "issue", number: 352, label: "T", chip: "c" },
        { id: "other", kind: "doc", from: "issue", number: 271, label: "T", chip: "c" },
      ],
    } as Story;
    expect(ticketDocId(story)).toBe("brief");
    expect(ticketDocId({ ticket: 1, scenes: [] } as unknown as Story)).toBeUndefined();
  });

  test("the title step escapes the repo link", () => {
    const story = {
      repoUrl: "https://host/u/r?a=b&c=d",
      ticket: 1,
      at: "a",
      status: "open",
      sections: [{ id: "open", label: "S", title: "Start" }],
      scenes: [{ id: "t", kind: "doc", from: "issue", number: 1, label: "T", chip: "c" }],
      steps: [{ id: "w", section: "open", scene: "t", kind: "title", title: "T", text: "x" }],
    } as unknown as Story;
    const docs = new Map<string, Doc>([["t", renderDoc("words\n", "T", "Title")]]);
    const html = stepsHtml({ story, steps: [{}], docs } as unknown as PageParts);
    expect(html).toContain('href="https://host/u/r?a=b&amp;c=d/issues/1"');
  });

  test("blocks take their scene and source lines", () => {
    const html = '<h2 class="b dtitle" data-b="0">T</h2><p class="b" data-b="1">x</p>';
    expect(sceneBlocks(html, "ticket")).toContain('data-b="0" data-scene="ticket"');
    expect(sceneBlocks(html, "md", [null, "f.md@3-4"])).toContain('data-src="f.md@3-4"');
  });

  test("pictures sniff PNG, JPEG, WebP and refuse the rest", () => {
    expect(mimeOf(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0]))).toBe("image/png");
    expect(mimeOf(Uint8Array.from([0xff, 0xd8, 0xff, 0]))).toBe("image/jpeg");
    expect(
      mimeOf(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])),
    ).toBe("image/webp");
    expect(() => mimeOf(Uint8Array.from([1, 2, 3]))).toThrow("no PNG, JPEG or WebP");
  });
});
