// Oracle for #352, committed before the change: a ticket can be published as a
// story page before it is built. C1 builds #352 from the trial's story and
// #271 from the fixture story at its base; C2 drives the picture adapter
// through a stub (the one real Codex call is made by hand, not here); C3
// picks the active step through the CLI and checks every step's scene and
// lights in both pages; C4 checks drawings-before-code with its control; C5
// checks cited-line coverage with its controls. The builder is driven as a
// subprocess throughout, never imported.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  REPO,
  TICKET_271,
  TICKET_352,
  adapterLog,
  articles,
  blocks,
  buildAll,
  cited,
  cleanup,
  codeRows,
  coverageMissing,
  figcaptions,
  firstLink,
  imgSrcs,
  litText,
  navLabels,
  plain,
  runPick,
  sceneDivs,
  scriptSwitches,
  storyData,
  svgAria,
} from "./acceptance-352.ts";
import type { AllBuilds, Build } from "./acceptance-352.ts";

let B: AllBuilds;

beforeAll(() => {
  B = buildAll();
}, 300_000);

afterAll(() => {
  cleanup(B.dir);
});

/** A page that built clean, failing with the builder's own error otherwise. */
function page(b: Build): string {
  expect(b.err).toBe("");
  expect(b.code).toBe(0);
  return b.html ?? "";
}

const PAGES: [string, () => Build][] = [
  ["352", () => B.b352],
  ["271", () => B.b271],
];

describe("C1: a story page per ticket, a section per criterion", () => {
  test("352 builds from the trial's story", () => {
    page(B.b352);
  });

  test("271 builds from the new story at its base", () => {
    page(B.b271);
  });

  test("352 nav holds five criterion sections in order", () => {
    expect(navLabels(page(B.b352))).toEqual([
      "Start",
      "C1",
      "C2",
      "C3",
      "C4",
      "C5",
      "Decisions",
      "The run",
      "Cited code",
    ]);
  });

  test("271 nav holds eight criterion sections in order", () => {
    expect(navLabels(page(B.b271))).toEqual([
      "Start",
      "C1",
      "C2",
      "C3",
      "C4",
      "C5",
      "C6",
      "C7",
      "C8",
      "Cited code",
    ]);
  });

  for (const [name, get] of PAGES) {
    test(`${name} opens with its picture and welcome`, () => {
      const html = page(get());
      const data = storyData(html);
      const first = data.steps[0];
      expect(first.kind).toBe("image");
      const hero = data.scenes.find((s) => s.id === first.scene);
      expect(hero?.kind).toBe("image");
      const div = sceneDivs(html).find((d) => d.id === first.scene);
      expect(div?.cls.includes("image")).toBe(true);
      expect(imgSrcs(html).length).toBe(1);
      const s1 = articles(html)[0];
      expect(s1.cls.includes("title")).toBe(true);
      expect(plain(s1.inner).length).toBeGreaterThan(20);
    });
  }

  const needles352 = [
    "published as a story page",
    "opens with a picture",
    "always shows what the outlined step",
    "draws what it describes before",
    "shown as it stands",
  ];
  for (const [i, needle] of needles352.entries()) {
    test(`352 section C${i + 1} tells criterion ${i + 1}`, () => {
      const html = page(B.b352);
      const data = storyData(html);
      const step = data.steps.find((s) => s.section === `c${i + 1}`);
      expect(step).toBeDefined();
      const art = articles(html).find((a) => a.num === (step?.i ?? -1));
      expect(art?.cls.includes("crit")).toBe(true);
      expect(litText(html, step?.scene ?? "", step?.lit ?? [])).toContain(needle);
    });
  }

  const needles271 = [
    "covers every run",
    "listed apart",
    "worst result",
    "review rounds",
    "first-round findings",
    "every count with a control",
    "can and cannot show",
    "wiki page",
  ];
  for (const [i, needle] of needles271.entries()) {
    test(`271 section C${i + 1} tells criterion ${i + 1}`, () => {
      const html = page(B.b271);
      const data = storyData(html);
      const step = data.steps.find((s) => s.section === `c${i + 1}`);
      expect(step).toBeDefined();
      const art = articles(html).find((a) => a.num === (step?.i ?? -1));
      expect(art?.cls.includes("crit")).toBe(true);
      expect(litText(html, step?.scene ?? "", step?.lit ?? [])).toContain(needle);
    });
  }
});

describe("C2: the opening picture comes from the adapter", () => {
  for (const [name, get] of PAGES) {
    test(`${name} calls the adapter once with the poster as its style`, () => {
      page(get());
      const lines = adapterLog(get());
      expect(lines.length).toBe(1);
      expect(lines[0]).toContain(`--style ${join(REPO, "docs/poster.jpg")}`);
      expect(lines[0]).toContain("opening-prompt.txt");
      expect(lines[0]).toContain("--out ");
    });

    test(`${name} page holds the image the stub wrote`, () => {
      const html = page(get());
      const imgs = imgSrcs(html);
      expect(imgs.length).toBe(1);
      expect(imgs[0].mime).toBe("image/png");
      expect(Buffer.from(imgs[0].b64, "base64").equals(readFileSync(B.image))).toBe(true);
    });
  }

  test("with no adapter the builder says so and writes no page", () => {
    const b = B.noadapter;
    expect(b.code).not.toBe(0);
    expect(b.err).toMatch(/adapter/iu);
    expect(existsSync(join(b.outDir, "index.html"))).toBe(false);
    expect(existsSync(join(b.outDir, "sheet.html"))).toBe(false);
    expect(b.html).toBeNull();
  });
});

describe("C3: the panel follows the outlined step", () => {
  const cases: [string, [number, number][], number][] = [
    [
      "390x844",
      [
        [0, 100],
        [600, 700],
        [800, 900],
      ],
      1,
    ],
    [
      "390x844",
      [
        [0, 100],
        [700, 800],
      ],
      1,
    ],
    [
      "390x844",
      [
        [700, 800],
        [900, 1000],
      ],
      0,
    ],
    [
      "390x844",
      [
        [0, 100],
        [200, 300],
      ],
      1,
    ],
    [
      "1180x820",
      [
        [0, 100],
        [300, 400],
        [500, 600],
      ],
      1,
    ],
    [
      "1180x820",
      [
        [0, 100],
        [400, 500],
      ],
      1,
    ],
    [
      "1180x820",
      [
        [400, 500],
        [600, 700],
      ],
      0,
    ],
    [
      "1180x820",
      [
        [0, 100],
        [200, 300],
      ],
      1,
    ],
    [
      "900x800",
      [
        [380, 420],
        [600, 650],
      ],
      0,
    ],
    [
      "899x800",
      [
        [380, 420],
        [600, 650],
      ],
      1,
    ],
    [
      "390x844",
      [
        [-200, -100],
        [700, 800],
      ],
      1,
    ],
    [
      "390x844",
      [
        [-200, -100],
        [900, 1000],
      ],
      -1,
    ],
  ];
  for (const [viewport, boxes, want] of cases) {
    test(`pick-step ${viewport} ${JSON.stringify(boxes)} -> ${want}`, () => {
      const r = runPick(viewport, boxes);
      expect(r.err).toBe("");
      expect(r.code).toBe(0);
      expect(r.out.trim()).toBe(String(want));
    });
  }

  for (const [name, get] of PAGES) {
    test(`${name}: every step's scene is in the page and what it lights is in it`, () => {
      const html = page(get());
      const data = storyData(html);
      const divs = sceneDivs(html);
      const rows = codeRows(html);
      const blks = blocks(html);
      const violations: string[] = [];
      for (const s of data.scenes) {
        if (!divs.some((d) => d.id === s.id)) violations.push(`scene ${s.id} has no div`);
      }
      for (const st of data.steps) {
        const scene = data.scenes.find((s) => s.id === st.scene);
        if (!scene) {
          violations.push(`step ${st.id} names no scene ${st.scene}`);
          continue;
        }
        if (!divs.some((d) => d.id === st.scene)) {
          violations.push(`step ${st.id} scene ${st.scene} has no div`);
        }
        if (st.kind === "code") {
          const rs = rows.filter((r) => r.scene === st.scene);
          for (const j of st.lit) {
            if (!(j >= 0 && j < rs.length)) violations.push(`step ${st.id} lights row ${j}`);
          }
          for (const mk of st.marks) {
            const row = rs[mk.row];
            if (!row) violations.push(`step ${st.id} marks row ${mk.row}`);
            else {
              for (const t of mk.text) {
                if (!plain(row.text).includes(t)) violations.push(`step ${st.id} marks ${t}`);
              }
            }
          }
        } else if (st.kind === "doc") {
          const bs = blks.filter((x) => x.scene === st.scene);
          for (const j of st.lit) {
            if (!(j >= 0 && j < bs.length)) violations.push(`step ${st.id} lights block ${j}`);
          }
        } else if (st.kind === "diagram") {
          if (!scene.states?.includes(st.state ?? "")) {
            violations.push(`step ${st.id} state ${st.state} is not one of ${scene.id}'s`);
          }
        } else if (st.lit.length > 0) {
          violations.push(`step ${st.id} (${st.kind}) lights ${st.lit.length}`);
        }
      }
      expect(violations).toEqual([]);
    });
  }
});

describe("C4: drawn before code", () => {
  for (const [name, get] of PAGES) {
    test(`${name}: every section showing code draws first`, () => {
      const html = page(get());
      const data = storyData(html);
      const kinds = new Map(data.scenes.map((s) => [s.id, s.kind]));
      const isCode = (id: string): boolean => kinds.get(id) === "ref" || kinds.get(id) === "md";
      const isDraw = (id: string): boolean => kinds.get(id) === "diagram";
      const violations: string[] = [];
      for (const section of new Set(data.steps.map((s) => s.section))) {
        const steps = data.steps.filter((s) => s.section === section);
        const firstCode = steps.findIndex((s) => isCode(s.scene));
        if (firstCode < 0) continue;
        if (!steps.slice(0, firstCode).some((s) => isDraw(s.scene))) {
          violations.push(`section ${section} shows code with no drawing before it`);
        }
      }
      expect(violations).toEqual([]);
    });
  }

  test("c1 with its drawings removed is refused, naming the section, with no page", () => {
    const b = B.nodraw;
    expect(b.code).not.toBe(0);
    expect(b.err).toContain("c1");
    expect(b.err).toMatch(/drawing/iu);
    expect(existsSync(join(b.outDir, "index.html"))).toBe(false);
    expect(b.html).toBeNull();
  });

  test("c1 with one of three drawings removed still builds", () => {
    page(B.onedraw);
  });

  const diagrams352 = [
    "today",
    "storypage",
    "contents",
    "structure",
    "pipeline",
    "picture",
    "readline",
    "coverage",
    "d1",
  ];
  test("352 holds each drawing once, captioned and labelled", () => {
    const html = page(B.b352);
    for (const id of diagrams352) {
      expect(html.split(`id="dg-${id}"`).length - 1).toBe(1);
    }
    const caps = figcaptions(html);
    expect(caps.length).toBe(diagrams352.length);
    expect(caps.every((c) => c.length > 0)).toBe(true);
    const aria = svgAria(html);
    expect(aria.length).toBe(diagrams352.length);
    expect(aria.every((a) => !!a && a.length > 0)).toBe(true);
  });

  test("271 holds its drawing once, captioned and labelled", () => {
    const html = page(B.b271);
    expect(html.split('id="dg-d"').length - 1).toBe(1);
    const caps = figcaptions(html);
    expect(caps).toEqual(["One coachman alone, or lanes judged into one."]);
    const aria = svgAria(html);
    expect(aria.length).toBe(1);
    expect(aria.every((a) => !!a && a.length > 0)).toBe(true);
  });

  test("352 switches the layout drawing between its states", () => {
    const html = page(B.b352);
    const data = storyData(html);
    const states = data.steps
      .filter((s) => s.scene === "structure")
      .map((s) => s.state ?? "")
      .filter((v, i, a) => a.indexOf(v) === i)
      .sort();
    expect(states).toEqual(["page", "section"]);
    expect(scriptSwitches(html)).toBe(true);
  });

  test("271 switches drawings as the steps go", () => {
    expect(scriptSwitches(page(B.b271))).toBe(true);
  });

  test("a step naming a state the story does not declare is refused", () => {
    const b = B.badstate;
    expect(b.code).not.toBe(0);
    expect(b.err).toContain("c1d");
    expect(b.err).toContain("bogus");
    expect(b.html).toBeNull();
  });
});

describe("C5: every cited line shown or listed", () => {
  test("the oracle reads 19 cited lines and one whole file in 352", () => {
    const c = cited(TICKET_352.body);
    expect(c.lines.size).toBe(19);
    expect(c.lines.has("scripts/review-page.ts@54")).toBe(true);
    expect(c.lines.has("scripts/review-page.ts@72")).toBe(true);
    expect(c.lines.has("AGENTS.md@321")).toBe(true);
    expect(c.lines.has("AGENTS.md@324")).toBe(true);
    expect(c.whole).toEqual(["skills/review-pages/SKILL.md"]);
  });

  test("the oracle reads 225 cited lines and one whole file in 271", () => {
    const c = cited(TICKET_271.body);
    expect(c.lines.size).toBe(225);
    expect(c.whole).toEqual(["raw/trials/2026-10-03-lane-audit/results/controls.md"]);
  });

  test("352 leaves no cited line uncovered", () => {
    expect(coverageMissing(TICKET_352.body, page(B.b352))).toEqual([]);
  });

  test("271 leaves no cited line uncovered", () => {
    expect(coverageMissing(TICKET_271.body, page(B.b271))).toEqual([]);
  });

  test("271 step text and closing list agree on the lines on steps", () => {
    const html = page(B.b271);
    // ASCII: the filled counts are ASCII digits.
    const step = /cite (\d+) lines[\s\S]*?and (\d+) of them are on the steps above/u.exec(html);
    expect(step).not.toBeNull();
    // ASCII: the closing counts are ASCII digits.
    const list = /(\d+) of the (\d+) lines the ticket cites are on the steps/u.exec(html);
    expect(list).not.toBeNull();
    expect(step?.[1]).toBe("225");
    expect(list?.[2]).toBe("225");
    expect(step?.[2]).toBe(list?.[1]);
  });

  test("352 names its whole file in the list", () => {
    expect(page(B.b352)).toContain("skills/review-pages/SKILL.md");
  });

  test("271 names its whole file in the list", () => {
    expect(page(B.b271)).toContain("raw/trials/2026-10-03-lane-audit/results/controls.md");
  });

  test("without its code step, the step's lines move into the list", () => {
    const html = page(B.dropscrub);
    expect(sceneDivs(html).some((d) => d.id === "rpScrub")).toBe(false);
    const keys = new Set(codeRows(html).map((r) => r.key));
    const want: string[] = [];
    for (let n = 54; n <= 58; n++) want.push(`scripts/review-page.ts@${n}`);
    for (let n = 63; n <= 72; n++) want.push(`scripts/review-page.ts@${n}`);
    expect(want.every((k) => keys.has(k))).toBe(true);
    expect(coverageMissing(TICKET_352.body, html)).toEqual([]);
  });

  test("a link at another commit is refused, naming the link", () => {
    const b = B.badlink;
    const link = firstLink(TICKET_352.body);
    expect(b.code).not.toBe(0);
    expect(b.err).toContain("deadbee");
    expect(b.err).toContain(link.path);
    expect(b.html).toBeNull();
    expect(existsSync(join(b.outDir, "index.html"))).toBe(false);
  });
});

describe("sheet: every drawing in every state", () => {
  test("352 sheet holds nine drawings in both themes", () => {
    page(B.b352);
    const sheet = B.b352.sheet ?? "";
    expect(sheet.length).toBeGreaterThan(0);
    for (const id of [
      "today",
      "storypage",
      "contents",
      "structure",
      "pipeline",
      "picture",
      "readline",
      "coverage",
      "d1",
    ]) {
      expect(sheet).toContain(`sheet-${id}-`);
    }
    expect(sheet).toContain('data-state="page"');
    expect(sheet).toContain('data-state="section"');
    expect(sheet).toContain('data-theme="light"');
    expect(sheet).toContain('data-theme="dark"');
  });

  test("271 sheet holds its drawing in both themes", () => {
    page(B.b271);
    const sheet = B.b271.sheet ?? "";
    expect(sheet.length).toBeGreaterThan(0);
    expect(sheet).toContain("sheet-d-all");
    expect(sheet).toContain('data-theme="light"');
    expect(sheet).toContain('data-theme="dark"');
  });
});

describe("scrub: no page holds an address", () => {
  test("the company address is removed and the example address stays", () => {
    const html = page(B.scrub);
    expect(html).toContain("&lt;address removed&gt;");
    expect(html).toContain("nobody@example.com");
    expect(html).not.toContain("reviewer@");
  });
});

describe("skill: sessions learn the story page", () => {
  test("the skill gains a story page section", () => {
    const text = readFileSync(join(REPO, "skills/review-pages/SKILL.md"), "utf8");
    for (const needle of [
      "## A story page for a ticket",
      "story-page",
      "story-picture",
      "lettering",
      "one file",
      "no capabilities",
      "watch",
    ]) {
      expect(text).toContain(needle);
    }
  });

  test("AGENTS.md names the story page for a ticket's story", () => {
    expect(readFileSync(join(REPO, "AGENTS.md"), "utf8")).toContain("story page");
  });
});
