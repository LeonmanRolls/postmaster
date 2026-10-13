// Oracle for #514: a branch's change told as a story page before it is
// pushed. Each describe is one of the ticket's checks C1-C5, plus the skill
// section Direction requires. The builder runs as a subprocess through
// scripts/run; every assertion reads files, bytes, exits and headless
// Firefox geometry, never the change's own modules.
import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  imgSrcs,
  KNOWN_PNG_B64,
  navLabels,
  runBuild,
  stage271,
  stage352,
  stageBase,
  storyData,
} from "./acceptance-352.ts";
import {
  ADDED_MD,
  adapterLog,
  BLOB_HEAD,
  CALC_BASE,
  CALC_HEAD,
  changeRows,
  FIND_C1,
  FIND_C2,
  cleanup,
  codeText,
  coverageMissingChange,
  expectedChange,
  fileEntries,
  gapGroupCount,
  ghCalls,
  LATER_MARKER,
  launchFirefox,
  makeEmailScratch,
  makeScratch,
  measureRender,
  nameStatus,
  NO_FIREFOX,
  NOTES_MD,
  numstat,
  quitFirefox,
  renderStaging,
  REPO_514,
  RUN_514,
  runChangeBuild,
  runCheck,
  sha256Hex,
  visibleText,
  wrapFragment,
} from "./acceptance-514.ts";
import type { Firefox, Viewport } from "./acceptance-514.ts";
import { run } from "./lib/proc.ts";

interface StoryJson {
  sections: { id: string }[];
  steps: {
    id: string;
    section: string;
    scene: string;
    title: string;
    text: string;
    focus?: number[][];
    find?: string[];
  }[];
  scenes: { id: string; kind: string; file?: string; from?: number; to?: number }[];
}

/** A copy of the scratch story with one edit, for the refusal controls. */
function variantStory(
  dir: string,
  storyDir: string,
  name: string,
  edit: (story: StoryJson) => void,
): string {
  const to = join(dir, name);
  cpSync(storyDir, to, { recursive: true });
  const file = join(to, "story.json");
  const story = JSON.parse(readFileSync(file, "utf8")) as StoryJson;
  edit(story);
  writeFileSync(file, `${JSON.stringify(story, null, 2)}\n`);
  return to;
}

describe("C1: a branch's change builds as a story before it is pushed", () => {
  test("the scratch branch's story builds with its picture", () => {
    const s = makeScratch();
    try {
      const b = runChangeBuild(s, "c1");
      expect(b.code).toBe(0);
      expect(b.out).toContain("change story of #514");
      if (!b.html || !b.sheet || !b.record) throw new Error("c1 build wrote no page");
      expect(b.sheet.length).toBeGreaterThan(1000);
      const pics = imgSrcs(b.html);
      expect(pics.some((p) => p.b64 === KNOWN_PNG_B64)).toBe(true);
      expect(adapterLog(s, "c1")).toHaveLength(1);
    } finally {
      cleanup(s.dir);
    }
  });

  test("the code rows show the branch's added and removed lines", () => {
    const s = makeScratch();
    try {
      const b = runChangeBuild(s, "c1rows");
      expect(b.code).toBe(0);
      if (!b.html) throw new Error("c1rows build wrote no page");
      const rows = changeRows(b.html);
      const texts = rows.map((r) => codeText(r.text));
      for (const line of [...CALC_HEAD, ...ADDED_MD, ...CALC_BASE, ...NOTES_MD]) {
        if (line === "") continue;
        expect(texts).toContain(line);
      }
      const typeOf = (line: string): string => {
        const row = rows.find((r) => codeText(r.text) === line);
        if (!row) throw new Error(`no row holds ${line}`);
        return row.type;
      };
      expect(typeOf("    sum += n;")).toBe("add");
      expect(typeOf("    sum = sum + n;")).toBe("del");
      expect(typeOf("Old notes, gone with the branch.")).toBe("del");
      expect(typeOf("# Added notes")).toBe("add");
      const del = rows.find((r) => codeText(r.text) === "    sum = sum + n;");
      expect(del?.num).toBe("");
    } finally {
      cleanup(s.dir);
    }
  });

  test("the page names the branch, its head and the base, and no pull request", () => {
    const s = makeScratch();
    try {
      const b = runChangeBuild(s, "c1names");
      expect(b.code).toBe(0);
      if (!b.html) throw new Error("c1names build wrote no page");
      expect(b.html).toContain(s.branch);
      expect(b.html).toContain(s.head);
      expect(b.html).toContain(s.mb);
      expect(visibleText(b.html)).not.toMatch(/pull request/iu);
    } finally {
      cleanup(s.dir);
    }
  });

  test("the build reads nothing from GitHub", () => {
    const s = makeScratch();
    try {
      const b = runChangeBuild(s, "c1gh");
      expect(b.code).toBe(0);
      expect(ghCalls(s)).toEqual([]);
    } finally {
      cleanup(s.dir);
    }
  });

  test("build.json records the head; check says current, then out of date", () => {
    const s = makeScratch();
    try {
      const b = runChangeBuild(s, "c1check");
      expect(b.code).toBe(0);
      if (!b.record) throw new Error("c1check build wrote no record");
      const record = JSON.parse(b.record) as { branch?: unknown; head?: unknown; base?: unknown };
      expect(record.branch).toBe(s.branch);
      expect(record.head).toBe(s.head);
      expect(record.base).toBe(s.mb);
      const current = runCheck(b.outDir, s.ticketFile, s.repo);
      expect(current.code).toBe(0);
      expect(current.out).toContain("current");
      const norepo = runCheck(b.outDir, s.ticketFile);
      expect(norepo.code).toBe(1);
      expect(norepo.err).toContain("--repo");
      const g = (args: string[]): string => {
        const r = run("git", ["-C", s.repo, ...args], { timeout: 30_000 });
        if (r.code !== 0) throw new Error(`git ${args.join(" ")} failed`);
        return r.out;
      };
      g(["checkout", "-q", s.branch]);
      g(["commit", "-q", "--allow-empty", "-m", "an empty new version"]);
      const moved = g(["rev-parse", s.branch]).trim();
      expect(moved).not.toBe(s.head);
      const stale = runCheck(b.outDir, s.ticketFile, s.repo);
      expect(stale.code).toBe(2);
      expect(stale.out).toContain("out of date");
      expect(stale.out).toContain(s.branch);
    } finally {
      cleanup(s.dir);
    }
  });

  test("a new version keeps its picture with --keep-picture", () => {
    const s = makeScratch();
    try {
      const first = runChangeBuild(s, "kp");
      expect(first.code).toBe(0);
      const pic = join(first.outDir, "picture.png");
      if (!existsSync(pic)) throw new Error("kp build wrote no picture file");
      const before = readFileSync(pic);
      const callsBefore = adapterLog(s, "kp").length;
      const g = (args: string[]): void => {
        const r = run("git", ["-C", s.repo, ...args], { timeout: 30_000 });
        if (r.code !== 0) throw new Error(`git ${args.join(" ")} failed`);
      };
      g(["checkout", "-q", s.branch]);
      g(["commit", "-q", "--allow-empty", "-m", "an empty new version"]);
      const r = run(
        RUN_514,
        [
          "story-page",
          "build",
          s.repo,
          s.storyDir,
          first.outDir,
          "--ticket-body",
          s.ticketFile,
          "--picture-adapter",
          s.adapter,
          "--keep-picture",
        ],
        {
          env: {
            STUB_ADAPTER_LOG: join(s.dir, "kp2-adapter.log"),
            STUB_ADAPTER_IMAGE: s.image,
            GH_CALLS_LOG: s.ghLog,
            PATH: `${s.ghDir}:${process.env.PATH ?? ""}`,
          },
          timeout: 120_000,
        },
      );
      expect(r.code).toBe(0);
      expect(readFileSync(pic).equals(before)).toBe(true);
      expect(adapterLog(s, "kp2")).toHaveLength(0);
      expect(callsBefore).toBe(1);
      expect(ghCalls(s)).toEqual([]);
    } finally {
      cleanup(s.dir);
    }
  });
});

describe("C2: a change's story has a section for each criterion", () => {
  test("a missing criterion section is refused naming it, writing nothing", () => {
    const s = makeScratch();
    try {
      const storyDir = variantStory(s.dir, s.storyDir, "story-noc2", (story) => {
        story.sections = story.sections.filter((x) => x.id !== "c2");
        story.steps = story.steps.filter((x) => x.section !== "c2");
      });
      const b = runChangeBuild(s, "c2missing", storyDir);
      expect(b.code).toBe(1);
      expect(b.err).toContain("criterion 2");
      expect(b.html).toBeNull();
      expect(b.sheet).toBeNull();
      expect(b.record).toBeNull();
      expect(existsSync(b.outDir)).toBe(false);
    } finally {
      cleanup(s.dir);
    }
  });

  test("with every section the page holds opening, one per criterion, and the end", () => {
    const s = makeScratch();
    try {
      const b = runChangeBuild(s, "c2full");
      expect(b.code).toBe(0);
      if (!b.html) throw new Error("c2full build wrote no page");
      expect(navLabels(b.html)).toEqual(["Start", "C1", "C2", "End"]);
    } finally {
      cleanup(s.dir);
    }
  });
});

describe("change-story refusals are pinned end to end", () => {
  test("a binary file as a code scene is refused, writing nothing", () => {
    const s = makeScratch();
    try {
      const storyDir = variantStory(s.dir, s.storyDir, "story-bin", (story) => {
        story.scenes.push({ id: "bin", kind: "head", file: "blob.bin", from: 1, to: 1 });
        story.steps.push({
          id: "binx",
          scene: "bin",
          section: "c2",
          title: "Binary",
          text: "A binary file shown as code.",
          focus: [[1, 1]],
        });
      });
      const b = runChangeBuild(s, "refbin", storyDir);
      expect(b.code).toBe(1);
      expect(b.err).toContain("is a binary file, and binary files are named in the closing list");
      expect(b.html).toBeNull();
      expect(b.sheet).toBeNull();
      expect(b.record).toBeNull();
      expect(existsSync(b.outDir)).toBe(false);
    } finally {
      cleanup(s.dir);
    }
  });

  test("a removed file as a head scene is refused, writing nothing", () => {
    const s = makeScratch();
    try {
      const storyDir = variantStory(s.dir, s.storyDir, "story-gone", (story) => {
        story.scenes.push({ id: "gone", kind: "head", file: "notes.md", from: 1, to: 2 });
        story.steps.push({
          id: "gonex",
          scene: "gone",
          section: "c2",
          title: "Gone",
          text: "A removed file shown at the head.",
          focus: [[1, 1]],
        });
      });
      const b = runChangeBuild(s, "refgone", storyDir);
      expect(b.code).toBe(1);
      expect(b.err).toContain("was removed by this change");
      expect(b.html).toBeNull();
      expect(b.sheet).toBeNull();
      expect(b.record).toBeNull();
      expect(existsSync(b.outDir)).toBe(false);
    } finally {
      cleanup(s.dir);
    }
  });

  test("an added file as a base scene is refused, writing nothing", () => {
    const s = makeScratch();
    try {
      const storyDir = variantStory(s.dir, s.storyDir, "story-new", (story) => {
        story.scenes.push({ id: "new", kind: "base", file: "added.md", from: 1, to: 2 });
        story.steps.push({
          id: "newx",
          scene: "new",
          section: "c2",
          title: "New",
          text: "An added file shown at the base.",
          focus: [[1, 1]],
        });
      });
      const b = runChangeBuild(s, "refnew", storyDir);
      expect(b.code).toBe(1);
      expect(b.err).toContain("was added by this change");
      expect(b.html).toBeNull();
      expect(b.sheet).toBeNull();
      expect(b.record).toBeNull();
      expect(existsSync(b.outDir)).toBe(false);
    } finally {
      cleanup(s.dir);
    }
  });

  test("uncovered lines with no closing list are refused, writing nothing", () => {
    const s = makeScratch();
    try {
      const storyDir = variantStory(s.dir, s.storyDir, "story-noleft", (story) => {
        story.scenes = story.scenes.filter((x) => x.id !== "left");
        story.steps = story.steps.filter((x) => x.id !== "end");
      });
      const b = runChangeBuild(s, "refleft", storyDir);
      expect(b.code).toBe(1);
      expect(b.err).toContain("are on no step, and no step shows the list of them");
      expect(b.html).toBeNull();
      expect(b.sheet).toBeNull();
      expect(b.record).toBeNull();
      expect(existsSync(b.outDir)).toBe(false);
    } finally {
      cleanup(s.dir);
    }
  });

  test("one section quoting two criteria is refused, writing nothing", () => {
    const s = makeScratch();
    try {
      const storyDir = variantStory(s.dir, s.storyDir, "story-shared", (story) => {
        const c1 = story.steps.find((x) => x.id === "c1");
        if (!c1) throw new Error("no c1 step");
        c1.find = [FIND_C1, FIND_C2];
      });
      const b = runChangeBuild(s, "refshared", storyDir);
      expect(b.code).toBe(1);
      expect(b.err).toContain("quotes criteria 1 and 2");
      expect(b.html).toBeNull();
      expect(b.sheet).toBeNull();
      expect(b.record).toBeNull();
      expect(existsSync(b.outDir)).toBe(false);
    } finally {
      cleanup(s.dir);
    }
  });

  test("a removed address is scrubbed on the step and counted", () => {
    const s = makeEmailScratch();
    try {
      const b = runChangeBuild(s, "scrub");
      expect(b.code).toBe(0);
      if (!b.html) throw new Error("scrub build wrote no page");
      if (!b.sheet) throw new Error("scrub build wrote no sheet");
      expect(b.out).toContain("1 address(es) removed");
      expect(b.html).not.toContain("jane@");
      expect(b.html).toContain("&lt;address removed&gt;");
      expect(b.sheet).not.toContain("jane@");
    } finally {
      cleanup(s.dir);
    }
  });
});

describe("C3: every line and every file is on a step or in the list", () => {
  test("the scratch change is 6 files, +10 −6", () => {
    const s = makeScratch();
    try {
      const rows = numstat(s.repo, s.mb, s.head);
      expect(rows).toHaveLength(6);
      const adds = rows.reduce((n, r) => n + (r.add ?? 0), 0);
      const dels = rows.reduce((n, r) => n + (r.del ?? 0), 0);
      expect(adds).toBe(10);
      expect(dels).toBe(6);
      const blob = rows.find((r) => r.path === "blob.bin");
      expect(blob?.add).toBeNull();
      expect(blob?.del).toBeNull();
      const status = nameStatus(s.repo, s.mb, s.head);
      expect(status).toHaveLength(6);
      expect(status.some((r) => r.join("\t") === "R100\told-name.ts\tnew-name.ts")).toBe(true);
      const summary = run("git", ["-C", s.repo, "diff", "--summary", "-M", s.mb, s.head], {
        timeout: 30_000,
      });
      expect(summary.out).toContain("mode change");
      expect(summary.out).toContain("run.sh");
      const { added, removed } = expectedChange(s.repo, s.mb, s.head);
      expect(added.size).toBe(10);
      expect(removed.size).toBe(6);
    } finally {
      cleanup(s.dir);
    }
  });

  test("every added and removed line is on a step's rows or the list's rows", () => {
    const s = makeScratch();
    try {
      const b = runChangeBuild(s, "c3");
      expect(b.code).toBe(0);
      if (!b.html) throw new Error("c3 build wrote no page");
      expect(coverageMissingChange(s.repo, s.mb, s.head, b.html)).toEqual([]);
      const data = storyData(b.html);
      const left = data.scenes.find((x) => x.kind === "leftovers");
      if (!left) throw new Error("c3 page names no leftovers scene");
      const rows = changeRows(b.html);
      const listed = rows.filter((r) => r.scene === left.id && r.key !== null);
      expect(listed).toHaveLength(3);
      expect(gapGroupCount(b.html)).toBe(1);
      const keys = new Set(rows.flatMap((r) => (r.key === null ? [] : [r.key])));
      expect(keys.size).toBe(16);
    } finally {
      cleanup(s.dir);
    }
  });

  test("the removed, renamed, binary and mode-only files are named with what happened", () => {
    const s = makeScratch();
    try {
      const b = runChangeBuild(s, "c3files");
      expect(b.code).toBe(0);
      if (!b.html) throw new Error("c3files build wrote no page");
      const rows = changeRows(b.html);
      const texts = rows.map((r) => codeText(r.text));
      for (const line of NOTES_MD) expect(texts).toContain(line);
      const entries = fileEntries(b.html);
      expect(entries).toHaveLength(3);
      const byFile = new Map(entries.map((e) => [e.file, e]));
      const renamed = byFile.get("new-name.ts");
      expect(renamed?.what).toBe("renamed");
      expect(renamed?.gwhat).toContain("old-name.ts");
      const binary = byFile.get("blob.bin");
      expect(binary?.what).toBe("binary");
      expect(binary?.gwhat).toContain(String(BLOB_HEAD.length));
      const mode = byFile.get("run.sh");
      expect(mode?.what).toBe("mode");
      expect(mode?.gwhat).toContain("100644");
      expect(mode?.gwhat).toContain("100755");
    } finally {
      cleanup(s.dir);
    }
  });

  test("the default branch's later commit appears nowhere", () => {
    const s = makeScratch();
    try {
      const b = runChangeBuild(s, "c3later");
      expect(b.code).toBe(0);
      if (!b.html || !b.sheet) throw new Error("c3later build wrote no page");
      expect(b.html).not.toContain(LATER_MARKER);
      expect(b.sheet).not.toContain(LATER_MARKER);
    } finally {
      cleanup(s.dir);
    }
  });

  test("control: without one code step its lines move into the list", () => {
    const s = makeScratch();
    try {
      const full = runChangeBuild(s, "c3ctl-full");
      expect(full.code).toBe(0);
      if (!full.html) throw new Error("c3ctl-full build wrote no page");
      const data = storyData(full.html);
      const left = data.scenes.find((x) => x.kind === "leftovers");
      if (!left) throw new Error("c3ctl-full page names no leftovers scene");
      const fullListed = new Set(
        changeRows(full.html)
          .filter((r) => r.scene === left.id && r.key !== null)
          .map((r) => r.key ?? ""),
      );
      const { added } = expectedChange(s.repo, s.mb, s.head);
      const addedMd = [...added].filter((k) => k.startsWith("added.md:"));
      expect(addedMd).toHaveLength(6);
      for (const k of addedMd) expect(fullListed.has(k)).toBe(false);
      const storyDir = variantStory(s.dir, s.storyDir, "story-nocode", (story) => {
        story.steps = story.steps.filter((x) => x.id !== "c2code");
      });
      const dropped = runChangeBuild(s, "c3ctl-drop", storyDir);
      expect(dropped.code).toBe(0);
      if (!dropped.html) throw new Error("c3ctl-drop build wrote no page");
      expect(coverageMissingChange(s.repo, s.mb, s.head, dropped.html)).toEqual([]);
      const dropData = storyData(dropped.html);
      const dropLeft = dropData.scenes.find((x) => x.kind === "leftovers");
      if (!dropLeft) throw new Error("c3ctl-drop page names no leftovers scene");
      const dropListed = new Set(
        changeRows(dropped.html)
          .filter((r) => r.scene === dropLeft.id && r.key !== null)
          .map((r) => r.key ?? ""),
      );
      for (const k of addedMd) expect(dropListed.has(k)).toBe(true);
    } finally {
      cleanup(s.dir);
    }
  });

  test("control: a listed row removed by hand is named", () => {
    const s = makeScratch();
    try {
      const b = runChangeBuild(s, "c3ctl-hand");
      expect(b.code).toBe(0);
      if (!b.html) throw new Error("c3ctl-hand build wrote no page");
      const data = storyData(b.html);
      const left = data.scenes.find((x) => x.kind === "leftovers");
      if (!left) throw new Error("c3ctl-hand page names no leftovers scene");
      const victim = changeRows(b.html).find((r) => r.scene === left.id && r.key !== null);
      if (!victim?.key) throw new Error("c3ctl-hand page lists no keyed row");
      const div = new RegExp(
        `<div class="r ${victim.type}"[^>]*data-k="${victim.key.replace(/[.+]/gu, (c) => `\\${c}`)}"[^>]*>.*?</div>`,
        "su",
      );
      const m = div.exec(b.html);
      if (!m) throw new Error("c3ctl-hand cannot find the victim row");
      const edited = b.html.replace(m[0], "");
      expect(coverageMissingChange(s.repo, s.mb, s.head, edited)).toEqual([victim.key]);
    } finally {
      cleanup(s.dir);
    }
  });
});

describe("C4: the change story reads on a phone, in light and dark, as a ticket's does", () => {
  interface Pages {
    changeHtml: string;
    refHtml: string;
    changeSteps: number[];
    refSteps: number[];
    renderDir: string;
  }
  let ff: Firefox | null = null;
  let pages: Pages | null = null;
  const tempDirs: string[] = [];

  async function ensure(): Promise<{ ff: Firefox; pages: Pages }> {
    if (ff && pages) return { ff, pages };
    const s = makeScratch();
    tempDirs.push(s.dir);
    const b = runChangeBuild(s, "c4");
    if (b.code !== 0 || !b.html) throw new Error(`c4 change build failed: ${b.err}`);
    const staged = stageBase();
    tempDirs.push(staged.dir);
    const s271 = stage271(staged.dir);
    const r271 = runBuild(s271, staged.ticket271, staged.adapter, staged.image, "c4ref");
    if (r271.code !== 0 || !r271.html) throw new Error(`c4 ticket build failed: ${r271.err}`);
    const refData = storyData(r271.html);
    const refCode = refData.steps.find((x) => x.kind === "code");
    const refLeft = refData.steps.find((x) => x.scene === "left");
    if (!refCode || !refLeft) throw new Error("c4 ticket story has no code or leftovers step");
    const renderDir = renderStaging();
    tempDirs.push(renderDir);
    pages = {
      changeHtml: b.html,
      refHtml: r271.html,
      changeSteps: [0, 5, 9],
      refSteps: [0, refCode.i, refLeft.i],
      renderDir,
    };
    ff = await launchFirefox(renderDir);
    return { ff, pages };
  }

  afterAll(async () => {
    if (ff) {
      await quitFirefox(ff);
      ff = null;
    }
    for (const dir of tempDirs.splice(0)) cleanup(dir);
    pages = null;
  });

  async function checkConfig(vp: Viewport, dark: boolean, label: string): Promise<string[]> {
    const ctx = await ensure();
    const faults: string[] = [];
    for (let k = 0; k < 3; k++) {
      const ci = ctx.pages.changeSteps[k] ?? 0;
      const ri = ctx.pages.refSteps[k] ?? 0;
      const cPath = join(ctx.pages.renderDir, `${label}-change-${k}.html`);
      const rPath = join(ctx.pages.renderDir, `${label}-ref-${k}.html`);
      writeFileSync(cPath, wrapFragment(ctx.pages.changeHtml, { dark, openDetails: k === 2 }));
      writeFileSync(rPath, wrapFragment(ctx.pages.refHtml, { dark, openDetails: k === 2 }));
      const c = await measureRender(ctx.ff, `file://${cPath}`, vp, ci);
      const r = await measureRender(ctx.ff, `file://${rPath}`, vp, ri);
      const where = `${label} part ${k + 1} (change s${ci + 1}, ticket s${ri + 1})`;
      if (!c.settled) faults.push(`${where}: the change render never settled`);
      if (c.w !== vp.w || c.h !== vp.h) {
        faults.push(`${where}: change viewport is ${c.w}x${c.h}, want ${vp.w}x${vp.h}`);
      }
      if (c.scrollW > vp.w + 1) {
        faults.push(`${where}: change scrolls sideways to ${c.scrollW}`);
      }
      for (const o of c.over) faults.push(`${where}: change past the right edge: ${o}`);
      if (c.on.join(",") !== `s${ci + 1}`) {
        faults.push(`${where}: change outlines ${c.on.join(",") || "nothing"}, want s${ci + 1}`);
      }
      if (c.scenesOn.join(",") !== c.stepScene) {
        faults.push(
          `${where}: change shows ${c.scenesOn.join(",")}, the step wants ${c.stepScene}`,
        );
      }
      const wantTop = vp.w < 900 ? 0 : 16;
      if (k > 0 && Math.abs(c.stageTop - wantTop) > 2) {
        faults.push(`${where}: change panel sits at ${c.stageTop}, want ${wantTop}`);
      }
      if (k === 1 && !c.delInScene) {
        faults.push(`${where}: the change code scene shows no removed line`);
      }
      if (r.on.length !== 1) faults.push(`${where}: the ticket outlines ${r.on.length} steps`);
      if (Math.abs(c.stageTop - r.stageTop) > 1) {
        faults.push(`${where}: panel at ${c.stageTop}, the ticket's at ${r.stageTop}`);
      }
    }
    return faults;
  }

  test.skipIf(NO_FIREFOX)(
    "at 390 by 844 in light",
    async () => {
      expect(await checkConfig({ w: 390, h: 844 }, false, "phone-light")).toEqual([]);
    },
    300000,
  );

  test.skipIf(NO_FIREFOX)(
    "at 390 by 844 in dark",
    async () => {
      expect(await checkConfig({ w: 390, h: 844 }, true, "phone-dark")).toEqual([]);
    },
    300000,
  );

  test.skipIf(NO_FIREFOX)(
    "at 1180 by 820 in light",
    async () => {
      expect(await checkConfig({ w: 1180, h: 820 }, false, "wide-light")).toEqual([]);
    },
    300000,
  );

  test.skipIf(NO_FIREFOX)(
    "at 1180 by 820 in dark",
    async () => {
      expect(await checkConfig({ w: 1180, h: 820 }, true, "wide-dark")).toEqual([]);
    },
    300000,
  );
});

describe("C5: a ticket's story is made and looks exactly as it does today", () => {
  test("ticket stories build byte-identical to the base", () => {
    const staged = stageBase();
    try {
      const s352 = stage352(staged.dir);
      const s271 = stage271(staged.dir);
      const first352 = runBuild(s352, staged.ticket352, staged.adapter, staged.image, "c5a352");
      const second352 = runBuild(s352, staged.ticket352, staged.adapter, staged.image, "c5b352");
      expect(first352.code).toBe(0);
      expect(second352.code).toBe(0);
      for (const name of ["index.html", "sheet.html", "build.json"] as const) {
        const a = readFileSync(join(first352.outDir, name));
        const b = readFileSync(join(second352.outDir, name));
        expect(a.equals(b)).toBe(true);
      }
      expect(
        sha256Hex(readFileSync(join(first352.outDir, "index.html"))).startsWith("f2bd552d274eff64"),
      ).toBe(true);
      expect(
        sha256Hex(readFileSync(join(first352.outDir, "sheet.html"))).startsWith("de281ffc27e89732"),
      ).toBe(true);
      expect(
        sha256Hex(readFileSync(join(first352.outDir, "build.json"))).startsWith("34d528af59f061eb"),
      ).toBe(true);
      const first271 = runBuild(s271, staged.ticket271, staged.adapter, staged.image, "c5a271");
      const second271 = runBuild(s271, staged.ticket271, staged.adapter, staged.image, "c5b271");
      expect(first271.code).toBe(0);
      expect(second271.code).toBe(0);
      for (const name of ["index.html", "sheet.html", "build.json"] as const) {
        const a = readFileSync(join(first271.outDir, name));
        const b = readFileSync(join(second271.outDir, name));
        expect(a.equals(b)).toBe(true);
      }
      expect(
        sha256Hex(readFileSync(join(first271.outDir, "index.html"))).startsWith("5d4fb99fb7ca7a7c"),
      ).toBe(true);
      expect(
        sha256Hex(readFileSync(join(first271.outDir, "sheet.html"))).startsWith("e7b1f0fd124495ba"),
      ).toBe(true);
      expect(
        sha256Hex(readFileSync(join(first271.outDir, "build.json"))).startsWith("0f3e6de239dea3cb"),
      ).toBe(true);
    } finally {
      cleanup(staged.dir);
    }
  });

  test("the #352 suite passes unchanged", () => {
    const r = run(process.execPath, ["test", "scripts/acceptance-352.test.ts"], {
      cwd: REPO_514,
      timeout: 590000,
    });
    expect(r.code).toBe(0);
    expect(r.err).toContain("61 pass");
    expect(r.err).toContain("0 fail");
  }, 600000);
});

describe("the skill tells how to write a change's story", () => {
  test("review-pages documents a change's story beside the ticket's", () => {
    const skill = readFileSync(join(REPO_514, "skills", "review-pages", "SKILL.md"), "utf8");
    expect(skill).toContain("## A story page for a change");
    expect(skill).toContain("story-page build");
    expect(skill).toContain("--ticket-body");
    expect(skill).toContain("--keep-picture");
    expect(skill).toContain("story-page check");
  });
});
