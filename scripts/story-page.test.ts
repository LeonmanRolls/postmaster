// Tests beside scripts/story-page.ts: the pure core is called directly. The
// commands themselves run end to end in the #352 oracle, as subprocesses.
import { describe, expect, test } from "bun:test";
import {
  baseRows,
  buildSteps,
  changeForFile,
  changeGapRows,
  changedKeys,
  checkCriterionSections,
  checkDrawings,
  computeChangeGaps,
  computeGaps,
  cutDoc,
  draftDigest,
  fileNameEntry,
  fileShownOnStep,
  filesNeedingNames,
  fill,
  gapRows,
  headChip,
  headRows,
  isChangeStory,
  keptPicture,
  mimeOf,
  parseBuildRecord,
  parseBoxes,
  parseChangeDiff,
  parseCited,
  parseCriteria,
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
  staleReason,
  startsInFence,
  stepsHtml,
  tagSvg,
  ticketDocId,
} from "./story-page.ts";
import type {
  ChangeFile,
  ChangeRow,
  DiagramScene,
  Doc,
  PageParts,
  Row,
  Scene,
  Story,
} from "./story-page.ts";

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

describe("the build record", () => {
  test("the draft digest is stable and moves with the title or the body", () => {
    const a = draftDigest("T", "B");
    expect(a).toBe(draftDigest("T", "B"));
    expect(a).toMatch(/^[0-9a-f]{64}$/u);
    expect(draftDigest("T2", "B")).not.toBe(a);
    expect(draftDigest("T", "B2")).not.toBe(a);
  });

  test("a record round-trips, and anything else reads as no record", () => {
    const record = {
      version: 1,
      title: "T",
      draft: draftDigest("T", "B"),
      pictures: { hero: "picture.png" },
    };
    expect(parseBuildRecord(JSON.stringify(record))).toEqual(record);
    for (const bad of [
      "not json",
      JSON.stringify({ ...record, version: 2 }),
      JSON.stringify({ ...record, title: 7 }),
      JSON.stringify({ ...record, draft: null }),
      JSON.stringify({ ...record, pictures: ["picture.png"] }),
      JSON.stringify({ ...record, pictures: { hero: "" } }),
      JSON.stringify({ ...record, pictures: { hero: 7 } }),
      JSON.stringify([1, 2]),
    ]) {
      expect(parseBuildRecord(bad)).toBeNull();
    }
  });

  test("the verdict names a missing record, page, title or draft, else current", () => {
    const record = {
      version: 1 as const,
      title: "T",
      draft: draftDigest("T", "B"),
      pictures: { hero: "picture.png" },
    };
    const fresh = {
      record,
      recordPresent: true,
      pagePresent: true,
      title: "T",
      digest: draftDigest("T", "B"),
      outDir: "/tmp/out",
    };
    expect(staleReason(fresh)).toBeNull();
    expect(staleReason({ ...fresh, recordPresent: false, record: null })).toContain(
      "no build recorded",
    );
    expect(staleReason({ ...fresh, record: null })).toBe("the build record cannot be read");
    expect(staleReason({ ...fresh, pagePresent: false })).toContain("no page built");
    expect(staleReason({ ...fresh, title: "T2" })).toBe("the title changed");
    expect(staleReason({ ...fresh, digest: draftDigest("T", "B2") })).toBe("the draft changed");
  });

  test("a kept picture needs the same title and a plain file for the scene", () => {
    const record = {
      version: 1 as const,
      title: "T",
      draft: "d",
      pictures: { hero: "picture.png", other: "picture-other.jpg" },
    };
    expect(keptPicture(record, "T", "hero")).toBe("picture.png");
    expect(keptPicture(record, "T", "other")).toBe("picture-other.jpg");
    expect(keptPicture(record, "T2", "hero")).toBeNull();
    expect(keptPicture(null, "T", "hero")).toBeNull();
    expect(keptPicture(record, "T", "missing")).toBeNull();
    expect(keptPicture({ ...record, pictures: { hero: "../x.png" } }, "T", "hero")).toBeNull();
    expect(keptPicture({ ...record, pictures: { hero: "d\\x.png" } }, "T", "hero")).toBeNull();
  });
});

describe("a change story parses", () => {
  const change = {
    repoUrl: "https://github.com/o/r",
    ticket: 7,
    base: "main",
    head: "feature",
    sections: [{ id: "c1", label: "C1", title: "C1" }],
    scenes: [
      { id: "calc", kind: "head", file: "calc.ts", from: 1, to: 4 },
      { id: "old", kind: "base", file: "calc.ts", from: 1, to: 3 },
    ],
    steps: [{ id: "c", section: "c1", scene: "calc", focus: [[1, 1]], title: "t", text: "x" }],
  };

  test("base and head name the change, and head and base scenes read", () => {
    const story = parseStory(JSON.stringify(change));
    expect(isChangeStory(story)).toBe(true);
    expect(story.at).toBeUndefined();
    expect(story.base).toBe("main");
    expect(story.head).toBe("feature");
    expect(story.scenes.map((s) => [s.id, s.kind])).toEqual([
      ["calc", "head"],
      ["old", "base"],
    ]);
  });

  test("ticket scenes are refused in a change story, and conversely", () => {
    const ref = JSON.parse(JSON.stringify(change)) as typeof change;
    (ref.scenes[0] as unknown as Record<string, unknown>).kind = "ref";
    expect(() => parseStory(JSON.stringify(ref))).toThrow(
      'scene calc: kind "ref" is a ticket story\'s; change stories show code with kind "head"',
    );
    const md = JSON.parse(JSON.stringify(change)) as typeof change;
    (md.scenes[0] as unknown as Record<string, unknown>).kind = "md";
    expect(() => parseStory(JSON.stringify(md))).toThrow('kind "md" is a ticket story\'s');
    const ticket = { ...change, at: "abc", base: undefined, head: undefined };
    expect(() => parseStory(JSON.stringify(ticket))).toThrow(
      'scene calc: kind "head" is a change story\'s; ticket stories show code with kind "ref"',
    );
  });

  test("the commit names refuse to mix or go missing", () => {
    const ticketBase = {
      repoUrl: change.repoUrl,
      ticket: 7,
      at: "abc",
      base: "main",
      sections: change.sections,
      scenes: change.scenes,
      steps: change.steps,
    };
    expect(() => parseStory(JSON.stringify(ticketBase))).toThrow(
      'story: "base" is a change story\'s; ticket stories name their commit with "at"',
    );
    const noBase = { ...change, base: undefined };
    expect(() => parseStory(JSON.stringify(noBase))).toThrow("story: no base");
    const noHead = { ...change, head: undefined };
    expect(() => parseStory(JSON.stringify(noHead))).toThrow("story: no head");
  });

  test("head and base scenes count as code for the drawing rule", () => {
    const story = parseStory(JSON.stringify(change));
    expect(() => checkDrawings(story)).toThrow("shows code with no drawing before it");
    const drawn = JSON.parse(JSON.stringify(change)) as typeof change;
    drawn.scenes.unshift({
      id: "d",
      kind: "diagram",
      label: "D",
      chip: "c",
      svg: "d.svg",
      states: ["all"],
    } as unknown as (typeof change.scenes)[number]);
    drawn.steps.unshift({
      id: "d",
      section: "c1",
      scene: "d",
      state: "all",
      title: "t",
      text: "x",
    } as unknown as (typeof change.steps)[number]);
    expect(() => checkDrawings(parseStory(JSON.stringify(drawn)))).not.toThrow();
  });
});

describe("a change from its diff", () => {
  const DIFF = [
    "diff --git a/calc.ts b/calc.ts",
    "index 1111111..2222222 100644",
    "--- a/calc.ts",
    "+++ b/calc.ts",
    "@@ -4,3 +4,3 @@",
    "-    sum = sum + n;",
    "-  }",
    "-  return sum;",
    "+    sum += n;",
    "+  } // totals accumulate here",
    "+  return sum < 0 ? 0 : sum;",
    "@@ -8,0 +9 @@",
    "+// totals never go below zero",
    "diff --git a/added.md b/added.md",
    "new file mode 100644",
    "index 0000000..3333333",
    "--- /dev/null",
    "+++ b/added.md",
    "@@ -0,0 +1,2 @@",
    "+# Added notes",
    "+",
    "diff --git a/notes.md b/notes.md",
    "deleted file mode 100644",
    "index 4444444..0000000",
    "--- a/notes.md",
    "+++ /dev/null",
    "@@ -1,2 +0,0 @@",
    "-Old notes.",
    "\\ No newline at end of file",
    "-Second.",
    "diff --git a/old-name.ts b/new-name.ts",
    "similarity index 100%",
    "rename from old-name.ts",
    "rename to new-name.ts",
    "diff --git a/blob.bin b/blob.bin",
    "index 5555555..6666666 100644",
    "Binary files a/blob.bin and b/blob.bin differ",
    "diff --git a/run.sh b/run.sh",
    "old mode 100644",
    "new mode 100755",
  ].join("\n");

  test("hunks, adds, removes, renames, binaries and modes each read", () => {
    const files = parseChangeDiff(DIFF);
    expect([...files.keys()].sort()).toEqual([
      "added.md",
      "blob.bin",
      "calc.ts",
      "new-name.ts",
      "notes.md",
      "run.sh",
    ]);
    const calc = files.get("calc.ts");
    expect(calc?.status).toBe("modified");
    expect([...(calc?.added ?? [])].sort((a, b) => a - b)).toEqual([4, 5, 6, 9]);
    expect([...(calc?.removedOld ?? [])].sort((a, b) => a - b)).toEqual([4, 5, 6]);
    expect(calc?.dels.get(4)?.map((d) => d.old)).toEqual([4, 5, 6]);
    expect(calc?.dels.get(4)?.[0]?.text).toBe("    sum = sum + n;");
    expect(files.get("added.md")?.status).toBe("added");
    expect([...(files.get("added.md")?.added ?? [])]).toEqual([1, 2]);
    const notes = files.get("notes.md");
    expect(notes?.status).toBe("removed");
    expect(notes?.path).toBe("notes.md");
    expect([...(notes?.removedOld ?? [])]).toEqual([1, 2]);
    const renamed = files.get("new-name.ts");
    expect(renamed?.status).toBe("renamed");
    expect(renamed?.oldPath).toBe("old-name.ts");
    expect(renamed?.added.size).toBe(0);
    expect(files.get("blob.bin")?.binary).toBe(true);
    expect(files.get("run.sh")?.modeChange).toEqual(["100644", "100755"]);
    expect(files.get("run.sh")?.status).toBe("modified");
  });

  test("a removed-only hunk anchors after its new line", () => {
    const files = parseChangeDiff(
      [
        "diff --git a/f.ts b/f.ts",
        "index 1111111..2222222 100644",
        "--- a/f.ts",
        "+++ b/f.ts",
        "@@ -2,2 +2,0 @@",
        "-gone one",
        "-gone two",
      ].join("\n"),
    );
    expect(
      files
        .get("f.ts")
        ?.dels.get(3)
        ?.map((d) => d.text),
    ).toEqual(["gone one", "gone two"]);
  });

  test("quoted paths with spaces read", () => {
    const files = parseChangeDiff(
      [
        'diff --git "a/with space.ts" "b/with space.ts"',
        "index 1111111..2222222 100644",
        '--- "a/with space.ts"',
        '+++ "b/with space.ts"',
        "@@ -1 +1 @@",
        "-old",
        "+new",
      ].join("\n"),
    );
    expect(files.get("with space.ts")?.added).toEqual(new Set([1]));
  });

  test("changed keys, gaps and files needing names follow", () => {
    const files = parseChangeDiff(DIFF);
    const keys = changedKeys(files);
    expect(keys).toHaveLength(11);
    expect(keys).toContain("calc.ts:+9");
    expect(keys).toContain("notes.md:-2");
    const gaps = computeChangeGaps(
      keys,
      new Set(["calc.ts:+4", "calc.ts:+5", "calc.ts:+6", "calc.ts:+9"]),
    );
    const has = (file: string, side: string, from: number, to: number): boolean =>
      gaps.some((g) => g.file === file && g.side === side && g.from === from && g.to === to);
    expect(has("added.md", "+", 1, 2)).toBe(true);
    expect(has("notes.md", "-", 1, 2)).toBe(true);
    expect(has("calc.ts", "-", 4, 6)).toBe(true);
    expect(() => computeChangeGaps(["bogus"], new Set())).toThrow("bad change key");
    expect(
      filesNeedingNames(files)
        .map((f) => f.path)
        .sort(),
    ).toEqual(["blob.bin", "new-name.ts", "run.sh"]);
    const empty: ChangeFile = {
      path: "e.txt",
      oldPath: null,
      status: "added",
      binary: false,
      modeChange: null,
      added: new Set(),
      removedOld: new Set(),
      dels: new Map(),
    };
    expect(filesNeedingNames(new Map([["e.txt", empty]]))).toHaveLength(1);
  });

  test("a head or base scene on a step names its file", () => {
    const files = parseChangeDiff(DIFF);
    const renamed = files.get("new-name.ts");
    if (!renamed) throw new Error("no renamed file");
    const scenes = new Map<string, Scene>([
      ["calc", { id: "calc", kind: "head", file: "calc.ts", from: 1, to: 4 }],
      ["old", { id: "old", kind: "base", file: "old-name.ts", from: 1, to: 2 }],
    ]);
    const story = {
      steps: [{ id: "a", section: "c1", scene: "calc", title: "t", text: "x" }],
    } as unknown as Story;
    expect(fileShownOnStep(renamed, scenes, story.steps)).toBe(false);
    const story2 = {
      steps: [
        { id: "a", section: "c1", scene: "calc", title: "t", text: "x" },
        { id: "b", section: "c1", scene: "old", title: "t", text: "x" },
      ],
    } as unknown as Story;
    expect(fileShownOnStep(renamed, scenes, story2.steps)).toBe(true);
  });

  test("file entries word what happened", () => {
    const files = parseChangeDiff(DIFF);
    const at = (path: string): ChangeFile => {
      const f = files.get(path);
      if (!f) throw new Error(`no ${path}`);
      return f;
    };
    expect(fileNameEntry(at("new-name.ts"), null, null)).toEqual({
      file: "new-name.ts",
      what: "renamed",
      gpath: "new-name.ts",
      gwhat: "renamed from old-name.ts",
      fnote: "Renamed from old-name.ts to new-name.ts.",
    });
    expect(fileNameEntry(at("blob.bin"), 12, 28)).toEqual({
      file: "blob.bin",
      what: "binary",
      gpath: "blob.bin",
      gwhat: "binary file changed, 12 bytes became 28 bytes",
      fnote: "Binary file changed, 12 bytes became 28 bytes.",
    });
    expect(fileNameEntry(at("run.sh"), null, null)).toEqual({
      file: "run.sh",
      what: "mode",
      gpath: "run.sh",
      gwhat: "mode 100644 became 100755",
      fnote: "Mode 100644 became 100755.",
    });
  });

  test("chips name what happened to the file", () => {
    const files = parseChangeDiff(DIFF);
    expect(headChip(undefined)).toBe("unchanged");
    expect(headChip(files.get("added.md"))).toBe("new file");
    expect(headChip(files.get("notes.md"))).toBe("removed");
    expect(headChip(files.get("new-name.ts"))).toBe("renamed from old-name.ts");
    expect(headChip(files.get("calc.ts"))).toBe("changed");
    expect(headChip(files.get("run.sh"))).toBe("mode 100644 became 100755");
    expect(changeForFile(files, "old-name.ts")?.path).toBe("new-name.ts");
    expect(changeForFile(files, "missing.ts")).toBeUndefined();
  });
});

describe("a change's rows", () => {
  const cf: ChangeFile = {
    path: "f",
    oldPath: null,
    status: "modified",
    binary: false,
    modeChange: null,
    added: new Set([2]),
    removedOld: new Set([2]),
    dels: new Map([[2, [{ old: 2, text: "old" }]]]),
  };

  test("head rows sit removed lines before the line that took their place", () => {
    expect(headRows("f", 1, 3, ["a", "b", "c"], cf)).toEqual([
      { type: "ctx", n: 1, text: "a", key: null },
      { type: "del", n: null, text: "old", key: "f:-2" },
      { type: "add", n: 2, text: "b", key: "f:+2" },
      { type: "ctx", n: 3, text: "c", key: null },
    ]);
    expect(headRows("f", 1, 3, ["a", "b", "c"], undefined)).toEqual([
      { type: "ctx", n: 1, text: "a", key: null },
      { type: "ctx", n: 2, text: "b", key: null },
      { type: "ctx", n: 3, text: "c", key: null },
    ]);
    expect(headRows("f", 1, 9, ["a"], cf)).toEqual([
      { type: "ctx", n: 1, text: "a", key: null },
      { type: "del", n: null, text: "old", key: "f:-2" },
    ]);
  });

  test("base rows mark what was there before, gaps read both sides", () => {
    expect(baseRows("f", 1, 3, ["a", "old", "c"], cf)).toEqual([
      { type: "ctx", n: 1, text: "a", key: null },
      { type: "was", n: 2, text: "old", key: "f:-2" },
      { type: "ctx", n: 3, text: "c", key: null },
    ]);
    expect(changeGapRows({ file: "f", side: "+", from: 2, to: 3 }, ["a", "b", "c"], cf)).toEqual([
      { type: "add", n: 2, text: "b", key: "f:+2" },
      { type: "add", n: 3, text: "c", key: "f:+3" },
    ]);
    expect(changeGapRows({ file: "f", side: "-", from: 1, to: 3 }, ["a"], cf)).toEqual([
      { type: "del", n: null, text: "old", key: "f:-2" },
    ]);
    const rows: ChangeRow[] = headRows("f", 1, 1, ["a"], cf);
    expect(rows).toEqual([
      { type: "ctx", n: 1, text: "a", key: null },
      { type: "del", n: null, text: "old", key: "f:-2" },
    ]);
  });

  test("head and base steps light the focus and its removed lines", () => {
    const story = {
      sections: [{ id: "c1", label: "C1", title: "C1" }],
      steps: [
        { id: "h", section: "c1", scene: "calc", focus: [[2, 2]], title: "t", text: "x" },
        {
          id: "b",
          section: "c1",
          scene: "old",
          focus: [[2, 2]],
          title: "t",
          text: "x",
          marks: [{ line: 2, text: ["old"] }],
        },
      ],
    } as unknown as Story;
    const all: [string, Scene][] = [
      ["calc", { id: "calc", kind: "head", file: "f", from: 1, to: 3 }],
      ["old", { id: "old", kind: "base", file: "f", from: 1, to: 3 }],
    ];
    const changeRowsOf = new Map<string, ChangeRow[]>([
      ["calc", headRows("f", 1, 3, ["a", "b", "c"], cf)],
      ["old", baseRows("f", 1, 3, ["a", "old", "c"], cf)],
    ]);
    const changes = new Map([["f", cf]]);
    const data = buildSteps(
      story,
      new Map(all),
      new Map(),
      new Map(),
      new Map(),
      "abc1234",
      changeRowsOf,
      changes,
    );
    expect(data.map((s) => [s.id, s.kind, s.lit])).toEqual([
      ["h", "code", [1, 2]],
      ["b", "code", [1]],
    ]);
    expect(data[0]?.chip).toBe("changed");
    expect(data[1]?.chip).toBe("before the change");
    expect(data[0]?.lines).toBe("lines 1–3");
    expect(data[1]?.marks).toEqual([{ row: 1, text: ["old"] }]);
    const dark = {
      ...story,
      steps: [{ id: "h", section: "c1", scene: "calc", focus: [[9, 9]], title: "t", text: "x" }],
    } as unknown as Story;
    expect(() =>
      buildSteps(dark, new Map(all), new Map(), new Map(), new Map(), "a", changeRowsOf, changes),
    ).toThrow("its focus lights no row");
  });
});

describe("a change's criteria", () => {
  const BODY = [
    "## Problem",
    "",
    "words",
    "",
    "## Acceptance criteria",
    "",
    "1. First words here.",
    "2. Second words here.",
    "   wrapped continuation.",
    "3. Fixture: the fixture pages cover the rest.",
    "",
    "## For the agents",
    "",
    "1. Not a criterion.",
  ].join("\n");

  test("numbered items under the heading, the fixture line among them", () => {
    expect(parseCriteria(BODY)).toEqual([
      { n: 1, words: "First words here." },
      { n: 2, words: "Second words here. wrapped continuation." },
      { n: 3, words: "Fixture: the fixture pages cover the rest." },
    ]);
    expect(parseCriteria("## Problem\n\nno criteria\n")).toEqual([]);
    expect(parseCriteria("## Acceptance criteria\n\nnothing numbered\n")).toEqual([]);
  });

  test("every criterion needs its section quoting its words", () => {
    const story = {
      ticket: 7,
      scenes: [{ id: "t", kind: "doc", from: "issue", number: 7, label: "T", chip: "c" }],
      steps: [
        { id: "c1", section: "c1", scene: "t", kind: "criterion", find: ["First words"] },
        { id: "c2", section: "c2", scene: "t", kind: "criterion", find: ["Second words"] },
        { id: "c3", section: "c3", scene: "t", kind: "criterion", find: ["the rest"] },
      ],
    } as unknown as Story;
    expect(() => checkCriterionSections(story, BODY)).not.toThrow();
    const missing = {
      ...story,
      steps: story.steps.filter((s) => s.id !== "c2"),
    } as unknown as Story;
    expect(() => checkCriterionSections(missing, BODY)).toThrow(
      'criterion 2 has no section: "Second words here. wrapped continuation."',
    );
    const other = {
      ...story,
      steps: story.steps.map((s) => (s.id === "c2" ? { ...s, scene: "elsewhere" } : s)),
    } as unknown as Story;
    expect(() => checkCriterionSections(other, BODY)).toThrow("criterion 2 has no section");
    const plain = {
      ...story,
      steps: story.steps.map((s) => (s.id === "c2" ? { ...s, kind: undefined } : s)),
    } as unknown as Story;
    expect(() => checkCriterionSections(plain, BODY)).toThrow("criterion 2 has no section");
    expect(() => checkCriterionSections(story, "## Problem\n\nno criteria\n")).not.toThrow();
  });
});

describe("a change's build record", () => {
  test("the branch, head and base ride along, or the record is broken", () => {
    const text = JSON.stringify({
      version: 1,
      title: "T",
      draft: "d",
      pictures: { hero: "picture.png" },
      branch: "feature",
      head: "h".repeat(40),
      base: "b".repeat(40),
    });
    const record = parseBuildRecord(text);
    expect(record?.branch).toBe("feature");
    expect(record?.head).toBe("h".repeat(40));
    expect(record?.base).toBe("b".repeat(40));
    const partial = JSON.stringify({
      version: 1,
      title: "T",
      draft: "d",
      pictures: {},
      branch: "feature",
    });
    expect(parseBuildRecord(partial)).toBeNull();
    const ticket = JSON.stringify({ version: 1, title: "T", draft: "d", pictures: {} });
    const ticketRecord = parseBuildRecord(ticket);
    expect(ticketRecord?.head).toBeUndefined();
  });
});
