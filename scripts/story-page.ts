// Build a ticket's story page: one scroll from a drawn picture and a plain
// welcome through a section per acceptance criterion to the code the ticket
// cites. A story file names the sections, the scenes each step shows in the
// panel beside it (the picture, the ticket's words, drawings, code and
// Markdown files as they stand at the ticket's base, the closing list) and
// the steps. The page matches the trials' in structure, look and behaviour.
//
//   scripts/run story-page build <repo> <story-dir> <out-dir>
//     [--ticket-body <file>] [--picture-adapter <exe>] [--keep-picture]
//   scripts/run story-page pick-step --viewport <WxH> --boxes <json>
//   scripts/run story-page check <out-dir> --ticket-body <file>
//
// build reads <story-dir>/story.json and the files it names, draws the
// opening picture through the picture adapter with the postmaster poster as
// its style, and writes <out-dir>/index.html (the page),
// <out-dir>/sheet.html (every drawing in every state), the picture file and
// <out-dir>/build.json (the title, the draft's digest and the picture files).
// --ticket-body is a {title, body} JSON file; without it the ticket comes
// from gh. --picture-adapter replaces the default story-picture call.
// --keep-picture reuses the previous build's picture for a scene when its
// title still matches, and draws anew otherwise. Nothing is written unless
// every check passes. pick-step prints the active step for the boxes it is
// given, the same choice the page makes as it scrolls. check says whether
// the built story was made from the draft as it stands.
//
//   exit 0  written, current, or the step printed; one summary line is printed
//   exit 1  usage, or anything the story, the ticket or the code refuses
//   exit 2  check: the story is out of date
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { langOf, scrub } from "./lib/page-text.ts";
import { run } from "./lib/proc.ts";

export const USAGE = [
  "usage: story-page.ts build <repo> <story-dir> <out-dir> [--ticket-body <file>] [--picture-adapter <exe>] [--keep-picture]",
  "       story-page.ts pick-step --viewport <WxH> --boxes <json>",
  "       story-page.ts check <out-dir> --ticket-body <file> [--repo <repo>]",
].join("\n");

// ---------- pure core: the reading line ----------

/** Where the reading line sits: below the panel on a phone, above the middle beside it. */
export function readingLine(viewportH: number, narrow: boolean): number {
  return viewportH * (narrow ? 0.74 : 0.45);
}

export interface StepBox {
  top: number;
  bottom: number;
}

/**
 * The step the panel shows: the one on the reading line, else the nearest
 * one to it, else -1 when no step intersects the viewport. Self-contained on
 * purpose: the builder embeds this source in the page, so the page and the
 * command choose alike.
 */
export function pickStep(boxes: StepBox[], viewportH: number, narrow: boolean): number {
  const y = readingLine(viewportH, narrow);
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i] as StepBox;
    if (b.bottom < 0 || b.top > viewportH) continue;
    const d = y < b.top ? b.top - y : y > b.bottom ? y - b.bottom : 0;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** A WxH viewport: narrow below 900 pixels wide, like the page's own rule. */
export function parseViewport(viewport: string): { w: number; h: number; narrow: boolean } {
  // ASCII: viewports are ASCII digits by the WxH form, which \d matches exactly.
  const m = /^(\d+)x(\d+)$/u.exec(viewport);
  if (!m) throw new Error(`viewport ${viewport} is not WxH`);
  const w = Number(m[1]);
  return { w, h: Number(m[2]), narrow: w < 900 };
}

/** Boxes from their JSON: an array of [top, bottom] pairs. */
export function parseBoxes(json: string): StepBox[] {
  let value: unknown;
  try {
    value = JSON.parse(json) as unknown;
  } catch {
    throw new Error("boxes are not [[top, bottom], ...]");
  }
  if (!Array.isArray(value)) throw new Error("boxes are not [[top, bottom], ...]");
  return value.map((pair: unknown): StepBox => {
    if (!Array.isArray(pair) || pair.length !== 2)
      throw new Error("boxes are not [[top, bottom], ...]");
    const [top, bottom] = pair as [unknown, unknown];
    if (typeof top !== "number" || typeof bottom !== "number") {
      throw new Error("boxes are not [[top, bottom], ...]");
    }
    return { top, bottom };
  });
}

// ---------- pure core: the story ----------

export type Range = [number, number];

export interface RefScene {
  id: string;
  kind: "ref";
  file: string;
  from: number;
  to: number;
}

export interface DocScene {
  id: string;
  kind: "doc";
  from: "issue" | "pr";
  number: number;
  label: string;
  chip: string;
  cut?: string;
  start?: string;
}

export interface DiagramScene {
  id: string;
  kind: "diagram";
  label: string;
  chip: string;
  svg: string;
  states: string[];
  caption?: string;
}

export interface LeftScene {
  id: string;
  kind: "leftovers";
  label: string;
  chip: string;
}

export interface MdScene {
  id: string;
  kind: "md";
  file: string;
  from: number;
  to: number;
}

export interface HeadScene {
  id: string;
  kind: "head";
  file: string;
  from: number;
  to: number;
}

export interface BaseScene {
  id: string;
  kind: "base";
  file: string;
  from: number;
  to: number;
}

export interface ImageScene {
  id: string;
  kind: "image";
  label: string;
  chip: string;
  prompt: string;
  alt: string;
  overlay?: string;
  banner?: string;
  subtitle?: string;
}

export type Scene =
  | RefScene
  | DocScene
  | DiagramScene
  | LeftScene
  | MdScene
  | ImageScene
  | HeadScene
  | BaseScene;

export interface Step {
  id: string;
  section: string;
  scene: string;
  kind?: "title" | "criterion";
  focus?: Range[];
  marks?: { line: number; text: string[] }[];
  find?: string[];
  state?: string;
  excerpt?: boolean;
  title: string;
  text: string;
}

export interface Story {
  title?: string;
  mode?: string;
  repoUrl: string;
  ticket: number;
  /** A ticket story's commit; a change story names base and head instead. */
  at?: string;
  base?: string;
  head?: string;
  status?: string;
  sections: { id: string; label: string; title: string }[];
  scenes: Scene[];
  steps: Step[];
}

/** Whether the story tells a change (base and head) rather than a ticket (at). */
export function isChangeStory(story: Story): boolean {
  return story.at === undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(where: string, value: unknown, field: string): string {
  const v = (value as Record<string, unknown>)[field];
  if (typeof v !== "string" || v.length === 0) throw new Error(`${where}: no ${field}`);
  return v;
}

function optStr(value: unknown, field: string): string | undefined {
  const v = (value as Record<string, unknown>)[field];
  if (v === undefined) return undefined;
  if (typeof v !== "string") throw new Error(`no ${field}`);
  return v;
}

function num(where: string, value: unknown, field: string): number {
  const v = (value as Record<string, unknown>)[field];
  if (typeof v !== "number" || !Number.isInteger(v)) throw new Error(`${where}: no ${field}`);
  return v;
}

function arr(where: string, value: unknown, field: string): unknown[] {
  const v = (value as Record<string, unknown>)[field];
  if (!Array.isArray(v)) throw new Error(`${where}: no ${field}`);
  return v;
}

/** The story file read strictly: every refusal names what it refuses. */
export function parseStory(text: string): Story {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new Error("story.json is not JSON");
  }
  if (!isRecord(value)) throw new Error("story.json names no story");
  const mode = optStr(value, "mode");
  if (mode !== undefined && mode !== "ticket")
    throw new Error(`mode "${mode}" is not a ticket story`);
  const atRef = optStr(value, "at");
  const baseRef = optStr(value, "base");
  const headRef = optStr(value, "head");
  if (atRef === undefined && baseRef === undefined && headRef === undefined) {
    throw new Error("story: no at");
  }
  const change = atRef === undefined;
  if (!change && baseRef !== undefined) {
    throw new Error(
      `story: "base" is a change story's; ticket stories name their commit with "at"`,
    );
  }
  if (!change && headRef !== undefined) {
    throw new Error(
      `story: "head" is a change story's; ticket stories name their commit with "at"`,
    );
  }
  if (change && baseRef === undefined) throw new Error("story: no base");
  if (change && headRef === undefined) throw new Error("story: no head");
  const scenes = arr("story", value, "scenes").map((raw, i): Scene => {
    const where = `scene ${i}`;
    if (!isRecord(raw)) throw new Error(`${where} names no scene`);
    const id = str(where, raw, "id");
    const at = `scene ${id}`;
    const kind = str(where, raw, "kind");
    if (kind === "ref" || kind === "md") {
      if (change) {
        throw new Error(
          `${at}: kind "${kind}" is a ticket story's; change stories show code with kind "head"`,
        );
      }
      return {
        id,
        kind,
        file: str(at, raw, "file"),
        from: num(at, raw, "from"),
        to: num(at, raw, "to"),
      };
    }
    if (kind === "head" || kind === "base") {
      if (!change) {
        throw new Error(
          `${at}: kind "${kind}" is a change story's; ticket stories show code with kind "ref"`,
        );
      }
      return {
        id,
        kind,
        file: str(at, raw, "file"),
        from: num(at, raw, "from"),
        to: num(at, raw, "to"),
      };
    }
    if (kind === "doc") {
      const from = str(at, raw, "from");
      if (from !== "issue" && from !== "pr")
        throw new Error(`${at}: from "${from}" is neither issue nor pr`);
      const scene: DocScene = {
        id,
        kind,
        from,
        number: num(at, raw, "number"),
        label: str(at, raw, "label"),
        chip: str(at, raw, "chip"),
      };
      const cut = optStr(raw, "cut");
      if (cut !== undefined) scene.cut = cut;
      const start = optStr(raw, "start");
      if (start !== undefined) scene.start = start;
      return scene;
    }
    if (kind === "diagram") {
      const states = arr(at, raw, "states");
      for (const st of states) {
        if (typeof st !== "string" || st.length === 0) throw new Error(`${at} names no states`);
      }
      const scene: DiagramScene = {
        id,
        kind,
        label: str(at, raw, "label"),
        chip: str(at, raw, "chip"),
        svg: str(at, raw, "svg"),
        states: states as string[],
      };
      const caption = optStr(raw, "caption");
      if (caption !== undefined) scene.caption = caption;
      return scene;
    }
    if (kind === "leftovers") {
      return { id, kind, label: str(at, raw, "label"), chip: str(at, raw, "chip") };
    }
    if (kind === "image") {
      if ("src" in raw) throw new Error(`${at} names a file: ticket stories name a prompt`);
      const scene: ImageScene = {
        id,
        kind,
        label: str(at, raw, "label"),
        chip: str(at, raw, "chip"),
        prompt: str(at, raw, "prompt"),
        alt: str(at, raw, "alt"),
      };
      for (const field of ["overlay", "banner", "subtitle"] as const) {
        const v = optStr(raw, field);
        if (v !== undefined) scene[field] = v;
      }
      return scene;
    }
    throw new Error(`${at}: kind "${kind}" is no scene`);
  });
  const steps = arr("story", value, "steps").map((raw, i): Step => {
    const where = `step ${i}`;
    if (!isRecord(raw)) throw new Error(`${where} names no step`);
    const id = str(where, raw, "id");
    const at = `step ${id}`;
    const step: Step = {
      id,
      section: str(at, raw, "section"),
      scene: str(at, raw, "scene"),
      title: str(at, raw, "title"),
      text: str(at, raw, "text"),
    };
    const kind = optStr(raw, "kind");
    if (kind !== undefined) {
      if (kind !== "title" && kind !== "criterion")
        throw new Error(`${at}: kind "${kind}" is neither title nor criterion`);
      step.kind = kind;
    }
    const focus = (raw as Record<string, unknown>).focus;
    if (focus !== undefined) {
      if (!Array.isArray(focus)) throw new Error(`${at} names no focus`);
      step.focus = focus.map((pair: unknown): Range => {
        if (!Array.isArray(pair) || pair.length !== 2) throw new Error(`${at} names no focus`);
        const [a, b] = pair as [unknown, unknown];
        if (typeof a !== "number" || typeof b !== "number") throw new Error(`${at} names no focus`);
        return [a, b];
      });
    }
    const marks = (raw as Record<string, unknown>).marks;
    if (marks !== undefined) {
      if (!Array.isArray(marks)) throw new Error(`${at} names no marks`);
      step.marks = marks.map((mark: unknown) => {
        if (!isRecord(mark)) throw new Error(`${at} names no marks`);
        const line = mark.line;
        const text = mark.text;
        if (typeof line !== "number" || !Array.isArray(text))
          throw new Error(`${at} names no marks`);
        for (const t of text) {
          if (typeof t !== "string") throw new Error(`${at} names no marks`);
          // An empty mark would hang the page: its loop searches from the
          // same place forever.
          if (t.length === 0) throw new Error(`${at} names an empty mark`);
        }
        return { line, text: text as string[] };
      });
    }
    const find = (raw as Record<string, unknown>).find;
    if (find !== undefined) {
      if (!Array.isArray(find)) throw new Error(`${at} names no find`);
      for (const f of find) {
        if (typeof f !== "string") throw new Error(`${at} names no find`);
      }
      step.find = find as string[];
    }
    const state = optStr(raw, "state");
    if (state !== undefined) step.state = state;
    const excerpt = (raw as Record<string, unknown>).excerpt;
    if (excerpt !== undefined) {
      if (typeof excerpt !== "boolean") throw new Error(`${at} names no excerpt`);
      step.excerpt = excerpt;
    }
    return step;
  });
  const story: Story = {
    repoUrl: str("story", value, "repoUrl"),
    ticket: num("story", value, "ticket"),
    sections: arr("story", value, "sections").map((raw, i) => {
      const where = `section ${i}`;
      if (!isRecord(raw)) throw new Error(`${where} names no section`);
      return {
        id: str(where, raw, "id"),
        label: str(where, raw, "label"),
        title: str(where, raw, "title"),
      };
    }),
    scenes,
    steps,
  };
  if (atRef !== undefined) story.at = atRef;
  if (baseRef !== undefined) story.base = baseRef;
  if (headRef !== undefined) story.head = headRef;
  const title = optStr(value, "title");
  if (title !== undefined) story.title = title;
  if (mode !== undefined) story.mode = mode;
  const status = optStr(value, "status");
  if (status !== undefined) story.status = status;
  return story;
}

/**
 * The story's rendered prose with addresses removed: the title, sections,
 * steps and scene labels. Ids, states, paths, links and match keys (find,
 * marks, cut, start) stay exact, since the builder matches on them.
 */
export function scrubStory(story: Story): { story: Story; removed: number } {
  let removed = 0;
  const clean = (s: string): string => {
    const r = scrub(s);
    removed += r.removed;
    return r.text;
  };
  const opt = (s: string | undefined): string | undefined =>
    s === undefined ? undefined : clean(s);
  return {
    story: {
      ...story,
      title: opt(story.title),
      status: opt(story.status),
      sections: story.sections.map((s) => ({
        ...s,
        label: clean(s.label),
        title: clean(s.title),
      })),
      scenes: story.scenes.map((sc) => {
        if (sc.kind === "ref" || sc.kind === "md" || sc.kind === "head" || sc.kind === "base") {
          return sc;
        }
        if (sc.kind === "diagram") {
          return { ...sc, label: clean(sc.label), chip: clean(sc.chip), caption: opt(sc.caption) };
        }
        if (sc.kind === "image") {
          // The overlay and prompt stay exact: they are file paths, not prose.
          return {
            ...sc,
            label: clean(sc.label),
            chip: clean(sc.chip),
            alt: clean(sc.alt),
            banner: opt(sc.banner),
            subtitle: opt(sc.subtitle),
          };
        }
        return { ...sc, label: clean(sc.label), chip: clean(sc.chip) };
      }),
      steps: story.steps.map((s) => ({ ...s, title: clean(s.title), text: clean(s.text) })),
    },
    removed,
  };
}

/** Every section that shows code draws before its first code step, else refused. */
export function checkDrawings(story: Story): void {
  const kinds = new Map(story.scenes.map((s) => [s.id, s.kind]));
  const titles = new Map(story.sections.map((s) => [s.id, s.title]));
  const isCode = (id: string): boolean => {
    const kind = kinds.get(id);
    return kind === "ref" || kind === "md" || kind === "head" || kind === "base";
  };
  const isDraw = (id: string): boolean => kinds.get(id) === "diagram";
  for (const section of story.sections.map((s) => s.id)) {
    const steps = story.steps.filter((s) => s.section === section);
    const first = steps.find((s) => isCode(s.scene));
    if (!first) continue;
    const drew = steps.slice(0, steps.indexOf(first)).some((s) => isDraw(s.scene));
    if (!drew) {
      throw new Error(
        `section ${section} (${titles.get(section) ?? section}): step "${first.id}" shows code with no drawing before it in the section`,
      );
    }
  }
}

// ---------- pure core: the cited code ----------

export interface Cited {
  cited: string[];
  named: { path: string; url: string }[];
}

/** The most lines one cited range may name; whole files link without lines. */
const MAX_CITED_RANGE = 100_000;

// A cited link matches any owner, repo and ref but a template
// placeholder, so a branch link is refused naming the link instead of
// skipped; column anchors cite their whole lines; a second end without
// -L is matched so it can be refused, since the ticket's form needs -L
// on both ends.
const LINK =
  // ASCII: blob URLs and line numbers are ASCII by GitHub's form.
  /https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/blob\/([^<>/\s][^/\s]*)\/([^)\s#]+)(?:#L(\d+)(?:C\d+)?(?:-L(\d+)(?:C\d+)?|-(\d*))?)?/gu;

/** Owner and repo from a GitHub repository URL, else undefined. */
export function repoOf(url: string): { owner: string; repo: string } | undefined {
  // ASCII: repository URLs are ASCII by GitHub's form.
  const m = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/u.exec(url.trim());
  if (!m?.[1] || !m[2]) return undefined;
  return { owner: m[1], repo: m[2] };
}

/**
 * The code a ticket cites: every link into the target repository's files
 * at a commit. A link with lines names those lines; a link without names
 * the whole file, listed but not counted. A link at another commit is
 * refused. Links outside the target repository are context, not
 * citations, and are skipped.
 */
export function parseCited(
  body: string,
  atSha: string,
  target?: { owner: string; repo: string },
): Cited {
  const lines = new Set<string>();
  const named: { path: string; url: string }[] = [];
  const want =
    target === undefined ? undefined : `${target.owner.toLowerCase()}/${target.repo.toLowerCase()}`; // ASCII: owner and repo names compare ASCII-case-insensitively, as GitHub reads them.
  for (const m of body.matchAll(LINK)) {
    // ASCII: owner and repo names compare ASCII-case-insensitively, as GitHub reads them.
    if (want !== undefined && `${m[1]?.toLowerCase()}/${m[2]?.toLowerCase()}` !== want) continue;
    const ref = m[3] ?? "";
    // Only a SHA prefix counts as the story's commit; anything else,
    // a branch or a stub too short to be one, is refused naming the link.
    // ASCII: commit SHAs are hex by git's form.
    if (!atSha.startsWith(ref) || !/^[0-9a-f]{7,40}$/u.test(ref)) {
      throw new Error(
        `the ticket cites ${m[4]} at ${ref}, not at the story's commit ${atSha.slice(0, 7)}`,
      );
    }
    if (!m[5]) {
      if (!named.some((x) => x.path === m[4])) named.push({ path: m[4] ?? "", url: m[0] ?? "" });
      continue;
    }
    if (m[7] !== undefined)
      throw new Error(
        `the ticket cites ${m[4]}#L${m[5]}-${m[7]}, and the range's second end needs -L`,
      );
    const from = Number(m[5]);
    const to = Number(m[6] ?? m[5]);
    // Past the safe integers the counter rounds back and the loop below
    // never ends, so such ends are refused before anything counts them.
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to))
      throw new Error(
        `the ticket cites ${m[4]}#L${m[5]}${m[6] ? `-L${m[6]}` : ""}, past the last line a story counts`,
      );
    // A whole file is cited by a link without lines; a line range names
    // the lines the page shows or lists, so it must name some.
    if (from < 1) throw new Error(`the ticket cites line ${from} of ${m[4]}, and lines start at 1`);
    if (to < from)
      throw new Error(`the ticket cites ${m[4]}#L${from}-L${to}, and the range ends first`);
    if (to - from >= MAX_CITED_RANGE)
      throw new Error(`the ticket cites ${m[4]}#L${from}-L${to}, over ${MAX_CITED_RANGE} lines`);
    for (let n = from; n <= to; n++) lines.add(`${m[4]}@${n}`);
  }
  const cited = [...lines].sort((a, b) => {
    const [pa, na] = a.split("@") as [string, string];
    const [pb, nb] = b.split("@") as [string, string];
    return pa === pb ? Number(na) - Number(nb) : pa < pb ? -1 : 1;
  });
  return { cited, named };
}

export interface Gap {
  file: string;
  from: number;
  to: number;
}

/** Cited lines on no step, folded into ranges for the closing list. */
export function computeGaps(cited: string[], shown: Set<string>): Gap[] {
  const gaps: Gap[] = [];
  for (const k of cited) {
    if (shown.has(k)) continue;
    const at = k.lastIndexOf("@");
    const g: Gap = {
      file: k.slice(0, at),
      from: Number(k.slice(at + 1)),
      to: Number(k.slice(at + 1)),
    };
    const last = gaps.at(-1);
    if (last && last.file === g.file && last.to + 1 === g.from) last.to = g.from;
    else gaps.push(g);
  }
  return gaps;
}

// ---------- pure core: a change's criteria ----------

export interface Criterion {
  n: number;
  words: string;
}

/**
 * The ticket's criteria: every numbered item under its `## Acceptance
 * criteria` heading, up to the next `## ` heading, the fixture line among
 * them when there is one. A wrapped item's lines join with spaces.
 */
export function parseCriteria(body: string): Criterion[] {
  const out: Criterion[] = [];
  let current: { n: number; words: string[] } | null = null;
  let inCriteria = false;
  const flush = (): void => {
    if (current) out.push({ n: current.n, words: current.words.join(" ").trim() });
    current = null;
  };
  for (const raw of body.replace(/\r/gu, "").split("\n")) {
    const line = raw.trimEnd();
    if (line.startsWith("## ")) {
      flush();
      inCriteria = line.trim() === "## Acceptance criteria";
      continue;
    }
    if (!inCriteria) continue;
    // ASCII: criterion numbers are ASCII digits, which \d matches exactly.
    const item = /^(\d+)\. (.*)$/u.exec(line);
    if (item) {
      flush();
      current = { n: Number(item[1]), words: [item[2] ?? ""] };
    } else if (current && line.trim() !== "") {
      current.words.push(line.trim());
    }
  }
  flush();
  return out;
}

/**
 * Every criterion needs its own section: a step of kind `criterion` on the
 * ticket's own doc scene quoting the criterion's words, as in a ticket's
 * story. The first one without is refused, naming it, and so is a section
 * whose steps quote more than one criterion: one step's words can otherwise
 * cover criteria its section never tells.
 */
export function checkCriterionSections(story: Story, body: string): void {
  const criteria = parseCriteria(body);
  if (criteria.length === 0) return;
  const ticketScene = story.scenes.find(
    (s) => s.kind === "doc" && s.from === "issue" && s.number === story.ticket,
  )?.id;
  const quotes = (step: Step, words: string): boolean =>
    step.kind === "criterion" &&
    step.scene === ticketScene &&
    (step.find ?? []).some((f) => f !== "" && words.includes(f));
  for (const c of criteria) {
    const covered = story.steps.some((s) => quotes(s, c.words));
    if (!covered) throw new Error(`criterion ${c.n} has no section: "${c.words}"`);
  }
  const quotedBy = new Map<string, number[]>();
  for (const s of story.steps) {
    if (s.kind !== "criterion" || s.scene !== ticketScene) continue;
    for (const c of criteria) {
      if ((s.find ?? []).some((f) => f !== "" && c.words.includes(f))) {
        const list = quotedBy.get(s.section) ?? [];
        if (!list.includes(c.n)) list.push(c.n);
        quotedBy.set(s.section, list);
      }
    }
  }
  const sections = [...quotedBy].sort(([a], [b]) => (a < b ? -1 : 1));
  for (const [section, ns] of sections) {
    if (ns.length > 1) {
      throw new Error(
        `section "${section}" quotes criteria ${ns.join(" and ")}; one section tells one criterion`,
      );
    }
  }
}

// ---------- pure core: a change from its diff ----------

export interface RemovedLine {
  old: number;
  text: string;
}

export interface ChangeFile {
  /** The path after the change; a removed file's path. */
  path: string;
  /** The path before the change, when renamed. */
  oldPath: string | null;
  status: "added" | "removed" | "renamed" | "modified";
  binary: boolean;
  /** A submodule pointer, whose Subproject lines are commits, not content. */
  submodule: boolean;
  /** [oldMode, newMode] when the mode changed. */
  modeChange: [string, string] | null;
  /** Added head line numbers, and removed base line numbers. */
  added: Set<number>;
  removedOld: Set<number>;
  /** Removed lines by the head line they sit before. */
  dels: Map<number, RemovedLine[]>;
}

const C_QUOTE_SINGLE: Record<string, string> = {
  // git's single-letter C escapes, by code point.
  a: String.fromCharCode(7),
  b: String.fromCharCode(8),
  f: String.fromCharCode(12),
  n: String.fromCharCode(10),
  r: String.fromCharCode(13),
  t: String.fromCharCode(9),
  v: String.fromCharCode(11),
  "\\": "\\",
  '"': '"',
};

/**
 * A C-quoted path decoded, as git writes one: single-letter escapes and
 * octal bytes, the octal runs read as UTF-8. Only quoted text reaches here;
 * a backslash git did not write keeps its backslash.
 */
function decodeCQuotes(text: string): string {
  const out: string[] = [];
  const bytes: number[] = [];
  const flush = (): void => {
    if (bytes.length > 0) out.push(Buffer.from(new Uint8Array(bytes)).toString("utf8"));
    bytes.length = 0;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i] ?? "";
    if (c !== "\\") {
      flush();
      out.push(c);
      continue;
    }
    const single: string | undefined = C_QUOTE_SINGLE[text[i + 1] ?? ""];
    if (single !== undefined) {
      flush();
      out.push(single);
      i++;
      continue;
    }
    // ASCII: octal escapes are ASCII digits.
    const oct = /^[0-7]{3}/u.exec(text.slice(i + 1, i + 4))?.[0];
    if (oct !== undefined) {
      bytes.push(Number.parseInt(oct, 8));
      i += 3;
      continue;
    }
    flush();
    out.push("\\");
  }
  flush();
  return out.join("");
}

/** A quoted diff path unquoted and decoded, its a/ or b/ prefix off. */
function gitPath(text: string, prefix: string): string {
  let p = text;
  if (p.startsWith('"') && p.endsWith('"') && p.length >= 2) p = decodeCQuotes(p.slice(1, -1));
  if (prefix !== "" && p.startsWith(prefix)) p = p.slice(prefix.length);
  return p;
}

const TAB = String.fromCharCode(9);

/**
 * A `---`/`+++` line's path, cut where git's trailing tab starts: git tabs
 * such lines when the path holds a space, quoted or not, and a raw tab is
 * never part of a path since real tabs arrive C-escaped.
 */
function headerPath(line: string): string {
  return line.slice(4).split(TAB)[0] ?? "";
}

/**
 * The b-side of an unquoted `diff --git` pair. Git never quotes for spaces
 * alone, so both sides name the same path around the middle ` b/`, except
 * for a rename, whose rename lines below carry the exact paths; until they
 * do, the whole rest stands in as a provisional path.
 */
function unquotedBPath(rest: string): string {
  if (rest.startsWith("a/")) {
    const n = (rest.length - 5) / 2;
    if (Number.isInteger(n) && n >= 0) {
      const first = rest.slice(2, 2 + n);
      if (rest.slice(2 + n, 2 + n + 3) === " b/" && rest.slice(2 + n + 3) === first) {
        return first;
      }
    }
  }
  return rest.startsWith("a/") ? rest.slice(2) : rest;
}

/**
 * The change between the merge base and the head, from one
 * `git diff -U0 -M` with explicit prefixes: hunks for the changed lines,
 * and, where there are no lines to read, the rename, binary and mode-change
 * headers. A removed file's path comes from its `---` line, since its `+++`
 * is /dev/null; a pure rename or a mode-only change has neither and keeps
 * the `diff --git` paths.
 */
export function parseChangeDiff(text: string): Map<string, ChangeFile> {
  const files = new Map<string, ChangeFile>();
  let cur: ChangeFile | null = null;
  let minus = "";
  let oldMode = "";
  let newMode = "";
  let oldNo = 0;
  let newNo = 0;
  let anchor = 0;
  let inHunk = false;
  const finish = (): void => {
    if (cur && oldMode !== "" && newMode !== "" && oldMode !== newMode) {
      cur.modeChange = [oldMode, newMode];
    }
    cur = null;
    minus = "";
    oldMode = "";
    newMode = "";
  };
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) {
      finish();
      inHunk = false;
      const rest = line.slice("diff --git ".length);
      let b = "";
      if (rest.startsWith('"')) {
        // ASCII: quoted paths and their C escapes are ASCII. The b-side may
        // be plain: git quotes each side on its own, so a rename can mix them.
        const m = /^"((?:[^"\\]|\\.)*)" (.*)$/u.exec(rest);
        if (!m) throw new Error(`bad diff --git line: ${line}`);
        b = gitPath(m[2] ?? "", "b/");
      } else {
        b = unquotedBPath(rest);
      }
      cur = {
        path: b,
        oldPath: null,
        status: "modified",
        binary: false,
        submodule: false,
        modeChange: null,
        added: new Set(),
        removedOld: new Set(),
        dels: new Map(),
      };
      files.set(b, cur);
    } else if (line.startsWith("new file mode")) {
      if (cur) {
        cur.status = "added";
        if (line.endsWith("160000")) cur.submodule = true;
      }
    } else if (line.startsWith("deleted file mode")) {
      if (cur) {
        cur.status = "removed";
        if (line.endsWith("160000")) cur.submodule = true;
      }
    } else if (line.startsWith("index ") && line.endsWith(" 160000")) {
      if (cur) cur.submodule = true;
    } else if (line.startsWith("old mode ")) {
      oldMode = line.slice("old mode ".length).trim();
    } else if (line.startsWith("new mode ")) {
      newMode = line.slice("new mode ".length).trim();
    } else if (line.startsWith("rename from ")) {
      if (cur) {
        cur.oldPath = gitPath(line.slice("rename from ".length), "");
        cur.status = "renamed";
      }
    } else if (line.startsWith("rename to ")) {
      if (cur) {
        const to = gitPath(line.slice("rename to ".length), "");
        files.delete(cur.path);
        cur.path = to;
        cur.status = "renamed";
        files.set(to, cur);
      }
    } else if (line.startsWith("--- ") && !inHunk) {
      minus = headerPath(line);
    } else if (line.startsWith("+++ ") && !inHunk) {
      const p = headerPath(line);
      if (!cur) continue;
      if (p === "/dev/null") {
        if (minus !== "" && minus !== "/dev/null") {
          const path = gitPath(minus, "a/");
          files.delete(cur.path);
          cur.path = path;
          files.set(path, cur);
        }
        cur.status = "removed";
      } else {
        const path = gitPath(p, "b/");
        files.delete(cur.path);
        cur.path = path;
        files.set(path, cur);
      }
    } else if (line.startsWith("Binary files ")) {
      if (cur) cur.binary = true;
    } else if (line.startsWith("@@ ") && cur) {
      // ASCII: hunk headers are ASCII digits and markers, which \d matches exactly.
      const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u.exec(line);
      if (!m) throw new Error(`bad hunk header: ${line}`);
      oldNo = Number(m[1]);
      newNo = Number(m[3]);
      const newCount = m[4] === undefined ? 1 : Number(m[4]);
      // With no context, a hunk's removed lines sit before its first added line, or, when it
      // adds none, after new line c.
      anchor = newCount === 0 ? newNo + 1 : newNo;
      // From here a - line is a removal and a + line an addition, whatever
      // they start with: content starting with -- or ++ is content, never
      // a header, and the counters move for every line.
      inHunk = true;
    } else if (cur && inHunk && !cur.submodule && line.startsWith("-")) {
      const list = cur.dels.get(anchor) ?? [];
      list.push({ old: oldNo, text: line.slice(1) });
      cur.dels.set(anchor, list);
      cur.removedOld.add(oldNo);
      oldNo += 1;
    } else if (cur && inHunk && !cur.submodule && line.startsWith("+")) {
      cur.added.add(newNo);
      newNo += 1;
    }
  }
  finish();
  return files;
}

/**
 * Removed lines scrubbed as file text is: each deletion's text through the
 * scrubber, with the count, since the diff is the one shown text the file
 * reads never pass through. Header paths stay exact; keys and numbers are
 * untouched.
 */
export function scrubChangeDels(files: Map<string, ChangeFile>): {
  files: Map<string, ChangeFile>;
  removed: number;
} {
  let removed = 0;
  const out = new Map<string, ChangeFile>();
  for (const [path, f] of files) {
    const dels = new Map<number, RemovedLine[]>();
    for (const [at, list] of f.dels) {
      dels.set(
        at,
        list.map((d) => {
          const clean = scrub(d.text);
          removed += clean.removed;
          return { old: d.old, text: clean.text };
        }),
      );
    }
    out.set(path, { ...f, dels });
  }
  return { files: out, removed };
}

/** Every changed line's key: `path:+N` added, `path:-M` removed. */
export function changedKeys(files: Map<string, ChangeFile>): string[] {
  const keys: string[] = [];
  for (const fd of files.values()) {
    for (const n of [...fd.added].sort((a, b) => a - b)) keys.push(`${fd.path}:+${n}`);
    for (const n of [...fd.removedOld].sort((a, b) => a - b)) keys.push(`${fd.path}:-${n}`);
  }
  return keys;
}

export interface ChangeGap {
  file: string;
  side: "+" | "-";
  from: number;
  to: number;
}

/** Changed lines on no step, folded into per-file per-side ranges. */
export function computeChangeGaps(changed: string[], shown: Set<string>): ChangeGap[] {
  const gaps: ChangeGap[] = [];
  for (const k of changed) {
    if (shown.has(k)) continue;
    // ASCII: change keys are paths with a + or - side and ASCII digits.
    const m = /^(.*):([+-])(\d+)$/u.exec(k);
    if (!m) throw new Error(`bad change key: ${k}`);
    const g: ChangeGap = {
      file: m[1] ?? "",
      side: (m[2] ?? "+") as "+" | "-",
      from: Number(m[3]),
      to: Number(m[3]),
    };
    const last = gaps.at(-1);
    if (last && last.file === g.file && last.side === g.side && last.to + 1 === g.from) {
      last.to = g.from;
    } else gaps.push(g);
  }
  return gaps;
}

/**
 * Files the closing list must name: a rename, a binary, a mode change, or an
 * add or remove with no lines to show. A step whose head or base scene shows
 * the file names it instead.
 */
export function filesNeedingNames(files: Map<string, ChangeFile>): ChangeFile[] {
  return [...files.values()].filter(
    (f) =>
      f.oldPath !== null ||
      f.binary ||
      f.submodule ||
      f.modeChange !== null ||
      ((f.status === "added" || f.status === "removed") &&
        f.added.size === 0 &&
        f.removedOld.size === 0),
  );
}

/** Whether a head or base scene on a step shows the file. */
export function fileShownOnStep(
  file: ChangeFile,
  scenes: Map<string, Scene>,
  steps: Step[],
): boolean {
  const used = new Set(steps.map((s) => s.scene));
  for (const sc of scenes.values()) {
    if (!used.has(sc.id)) continue;
    if (sc.kind !== "head" && sc.kind !== "base") continue;
    if (sc.file === file.path) return true;
    if (file.oldPath !== null && sc.file === file.oldPath) return true;
  }
  return false;
}

// ---------- pure core: text ----------

export const esc = (s: string): string =>
  s.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;");

function inline(s: string): string {
  return esc(s)
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/gu, '<a href="$2">$1</a>') // ASCII: link destinations are ASCII URLs here.
    .replace(/`([^`]+)`/gu, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/gu, "<strong>$1</strong>");
}

const plainText = (s: string): string =>
  s
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/\*\*/gu, "")
    .replace(/`/gu, "");

export interface Doc {
  html: string;
  blocks: string[];
}

// The subset of Markdown a ticket uses: headings, paragraphs, numbered and
// bulleted lists, links, code and bold. Each heading, paragraph and list item
// is one block a step can light.
export function renderDoc(md: string, eyebrow: string, title: string): Doc {
  const blocks: string[] = [title];
  const raws: (string | null)[] = [null];
  const out: string[] = [
    `<p class="deye">${esc(eyebrow)}</p><h2 class="b dtitle" data-b="0">${inline(title)}</h2>`,
  ];
  let para: string[] = [];
  let list: "ol" | "ul" | null = null;
  const block = (tag: string, text: string, cls = ""): string => {
    blocks.push(plainText(text));
    raws.push(tag === "li" ? text : null);
    return `<${tag} class="b${cls}" data-b="${blocks.length - 1}">${inline(text)}</${tag}>`;
  };
  const flushPara = (): void => {
    if (para.length) out.push(block("p", para.join(" ")));
    para = [];
  };
  const closeList = (): void => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const raw of md.replace(/\r/gu, "").split("\n")) {
    const line = raw.trimEnd();
    let m: RegExpExecArray | null;
    if (!line.trim()) {
      flushPara();
      closeList();
    } else if ((m = /^(#{2,4}) (.*)$/u.exec(line))) {
      flushPara();
      closeList();
      out.push(block(m[1] === "##" ? "h3" : "h4", m[2] ?? ""));
      // ASCII: list numbers are ASCII digits, which \d matches exactly.
    } else if ((m = /^(\d+)\. (.*)$/u.exec(line)) || (m = /^- (.*)$/u.exec(line))) {
      flushPara();
      // ASCII: list numbers are ASCII digits, which \d matches exactly.
      const want = /^\d+\. /u.test(line) ? "ol" : "ul";
      if (list !== want) {
        closeList();
        out.push(`<${want}>`);
        list = want;
      }
      out.push(block("li", want === "ol" ? (m[2] ?? "") : (m[1] ?? "")));
      // ASCII: Markdown indentation is ASCII whitespace.
    } else if (list && /^\s+\S/u.test(raw)) {
      // A continuation line of a list item: fold it into the item's raw
      // words, so the item's links and formatting survive the rebuild.
      const last = out.pop();
      void last;
      const b = blocks.length - 1;
      const text = `${raws[b] ?? blocks[b]} ${line.trim()}`;
      blocks.pop();
      raws.pop();
      out.push(block("li", text));
    } else {
      closeList();
      para.push(line.trim());
    }
  }
  flushPara();
  closeList();
  return { html: out.join(""), blocks };
}

// A Markdown file of the repository, lines from..to, as formatted text. Each
// heading, paragraph, list item and code block is a block that knows the
// source lines it came from, so a step can light the blocks its cited lines
// fall in.
export function renderMd(lines: string[], from: number): { html: string; spans: Range[] } {
  const out: string[] = [];
  const spans: Range[] = [];
  let para: { text: string[]; from: number; to: number } | null = null;
  let fence: { text: string[]; from: number } | null = null;
  // Whether the last block emitted is a list item, which an indented line
  // continues; read from the builder's own state, never from the HTML.
  let lastIsItem = false;
  const block = (tag: string, html: string, a: number, b: number, cls = ""): void => {
    spans.push([a, b]);
    out.push(`<${tag} class="b${cls}" data-b="${spans.length - 1}">${html}</${tag}>`);
    lastIsItem = tag === "p" && cls !== "";
  };
  const flush = (): void => {
    if (para) block("p", inline(para.text.join(" ")), para.from, para.to);
    para = null;
  };
  const flushOpen = (): void => {
    // A range ending inside a fence still shows its lines: the builder
    // counts every line of the range as shown, so none may be dropped.
    if (fence)
      block("pre", esc(fence.text.join("\n")), fence.from, from + lines.length - 1, " mdcode");
  };
  lines.forEach((raw, i) => {
    const n = from + i;
    // ASCII: trailing runs trimmed are ASCII whitespace; Unicode spaces trim alike.
    const line = raw.replace(/\s+$/u, "");
    if (fence) {
      // ASCII: fence indentation is ASCII whitespace.
      if (/^\s*```/u.test(line)) {
        block("pre", esc(fence.text.join("\n")), fence.from, n, " mdcode");
        fence = null;
      } else fence.text.push(raw);
      return;
    }
    let m: RegExpExecArray | null;
    // ASCII: fence indentation is ASCII whitespace.
    if (/^\s*```/u.test(line)) {
      flush();
      fence = { text: [], from: n };
    } else if (!line.trim()) flush();
    else if ((m = /^(#{1,4}) (.*)$/u.exec(line))) {
      flush();
      block((m[1] ?? "").length <= 2 ? "h3" : "h4", inline(m[2] ?? ""), n, n);
      // ASCII: list indentation and numbers are ASCII.
    } else if ((m = /^(\s*)(?:[-*]|\d+\.) (.*)$/u.exec(line))) {
      flush();
      const depth = Math.min(3, Math.floor((m[1] ?? "").length / 2));
      block("p", inline(m[2] ?? ""), n, n, ` li d${depth}`);
      // ASCII: continuation indentation is ASCII whitespace.
    } else if (/^\s+\S/u.test(raw) && lastIsItem) {
      // A continuation of the list item above it.
      const last = out.pop() ?? "";
      void last;
      const span = spans.at(-1) ?? [n, n];
      span[1] = n;
      // A function, not a string: $ patterns in the repository's words
      // would expand in a replacement string.
      out.push(last.replace(/<\/p>$/u, () => ` ${inline(line.trim())}</p>`));
    } else {
      if (!para) para = { text: [], from: n, to: n };
      para.text.push(line.trim());
      para.to = n;
    }
  });
  flush();
  flushOpen();
  return { html: out.join(""), spans };
}

/** Whether line `from` (1-based) falls inside a fenced block of the whole file. */
export function startsInFence(all: string[], from: number): boolean {
  let open = false;
  for (const raw of all.slice(0, Math.max(0, from - 1))) {
    // ASCII: fence indentation is ASCII whitespace.
    if (/^\s*```/u.test(raw.replace(/\s+$/u, ""))) open = !open;
  }
  return open;
}

/** Cut a ticket's body to the part a doc scene shows. */
export function cutDoc(body: string, id: string, start?: string, cut?: string): string {
  if (start) {
    const at = body.indexOf(start);
    if (at < 0) throw new Error(`${id}: "${start}" is not in the text`);
    body = body.slice(at);
  }
  if (cut) {
    const at = body.indexOf(cut);
    if (at < 0) throw new Error(`${id}: "${cut}" is not in the text`);
    body = body.slice(0, at);
  }
  return body;
}

// ---------- pure core: diagrams ----------

export interface DiagramReady {
  id: string;
  /** Embedded form: its id, first state, role and label on the open tag. */
  svg: string;
  /** As drawn, for the sheet. */
  original: string;
  css: string[];
}

/**
 * A diagram is an SVG drawn for the story. It declares its states in the
 * story file, and its marks name them: on-<state> shows an element only in
 * that state, hl-<state> lights it, dim-<state> fades it, and
 * data-shift-<state>="dx dy" on an element with an id moves it there. The
 * page switches the SVG's data-state as the steps go; the CSS does the rest.
 * A state the story does not declare is refused.
 */
export function prepareDiagram(svgText: string, scene: DiagramScene, first: string): DiagramReady {
  const svg = svgText.trim();
  const faults: string[] = [];
  if (scene.states.length === 0) faults.push(`scene ${scene.id}: names no states`);
  const classes = new Set<string>();
  for (const m of svg.matchAll(/class="([^"]*)"/gu)) {
    // ASCII: class lists split on ASCII whitespace.
    for (const c of (m[1] ?? "").split(/\s+/u)) if (c) classes.add(c);
  }
  const named = (prefix: string): string[] =>
    [...classes].filter((c) => c.startsWith(prefix)).map((c) => c.slice(prefix.length));
  for (const prefix of ["on-", "hl-", "dim-"]) {
    for (const st of named(prefix)) {
      if (!scene.states.includes(st))
        faults.push(`scene ${scene.id}: ${prefix}${st} names no state of it`);
    }
  }
  const css: string[] = [];
  // The page holds the drawing once as #dg-<id>; the sheet holds one copy
  // per state, so every rule names the page id and each sheet id exactly.
  const sel = `:is(#dg-${scene.id}${scene.states.map((st) => `, #sheet-${scene.id}-${st}`).join("")})`;
  const on = named("on-");
  if (on.length) css.push(`${on.map((st) => `${sel} .on-${st}`).join(", ")} { opacity: 0; }`);
  for (const st of scene.states) {
    const at = `${sel}[data-state="${st}"]`;
    if (on.includes(st)) css.push(`${at} .on-${st} { opacity: 1; }`);
    if (named("hl-").includes(st)) {
      css.push(
        `${at} rect.hl-${st}, ${at} path.hl-${st}, ${at} circle.hl-${st} { stroke: var(--accent); stroke-width: 2.5px; fill: var(--accent-soft); }`,
        `${at} text.hl-${st} { fill: var(--accent); font-weight: 600; }`,
      );
    }
    if (named("dim-").includes(st)) css.push(`${at} .dim-${st} { opacity: .3; }`);
  }
  const shifts = [...svg.matchAll(/data-shift-/gu)].length;
  const moved = [
    // ASCII: attribute names, state names and shifts are ASCII.
    ...svg.matchAll(/<[^>]*\bid="([^"]+)"[^>]*\bdata-shift-([\w-]+)="(-?[\d.]+) (-?[\d.]+)"/gu),
  ];
  if (moved.length !== shifts) {
    faults.push(`scene ${scene.id}: a data-shift is on an element with no id before it`);
  }
  for (const m of moved) {
    if (!scene.states.includes(m[2] ?? "")) {
      faults.push(`scene ${scene.id}: data-shift-${m[2]} names no state of it`);
    }
    css.push(
      `${sel}[data-state="${m[2]}"] #${m[1]} { transform: translate(${m[3]}px, ${m[4]}px); }`,
    );
  }
  if (faults.length) throw new Error(`diagram faults:\n${faults.join("\n")}`);
  return {
    id: scene.id,
    svg: tagSvg(svg, `dg-${scene.id}`, first, scene.caption ?? scene.label, scene.id),
    original: svg,
    css,
  };
}

/** The svg open tag with its id, state, role and label, unless already there. */
export function tagSvg(
  svg: string,
  id: string,
  state: string,
  label: string,
  where: string,
): string {
  const open = /^<svg[^>]*>/u.exec(svg.trim());
  if (!open) throw new Error(`scene ${where}: its diagram is no SVG`);
  const rest = svg.trim().slice(open[0].length);
  let tag = open[0];
  // ASCII: tag attribute names are ASCII.
  if (/\bid="/u.test(tag)) tag = tag.replace(/\bid="[^"]*"/u, `id="${id}"`);
  else tag = tag.replace(/^<svg/u, `<svg id="${id}"`);
  // The page switches state through svg.dg, so a diagram without the
  // class would never change: add it where it is missing.
  // ASCII: tag attribute names are ASCII.
  const have = /\bclass="([^"]*)"/u.exec(tag);
  // ASCII: class lists split on ASCII whitespace.
  const names = have?.[1]?.split(/\s+/u).filter((c) => c.length > 0) ?? [];
  if (!have) tag = tag.replace(/^<svg/u, `<svg class="dg"`);
  else if (!names.includes("dg"))
    tag = tag.replace(/\bclass="[^"]*"/u, `class="${[...names, "dg"].join(" ")}"`); // ASCII: tag attribute names are ASCII.
  tag = tag.replace(/^<svg/u, `<svg data-state="${esc(state)}"`);
  // ASCII: tag attribute names are ASCII.
  if (!/\brole="/u.test(tag)) tag = tag.replace(/^<svg/u, `<svg role="img"`);
  // ASCII: tag attribute names are ASCII.
  if (!/\baria-label="/u.test(tag)) tag = tag.replace(/^<svg/u, `<svg aria-label="${esc(label)}"`);
  return tag + rest;
}

// ---------- pure core: rows and steps ----------

export interface Row {
  type: "ctx";
  n: number;
  text: string;
  key: string;
}

/** A code scene's rows: the file as it stands, every row keyed by file@line. */
export function refRows(file: string, from: number, to: number, lines: string[]): Row[] {
  const rows: Row[] = [];
  for (let n = from; n <= Math.min(to, lines.length); n++) {
    rows.push({ type: "ctx", n, text: lines[n - 1] ?? "", key: `${file}@${n}` });
  }
  return rows;
}

/** A closing-list range's rows, keyed the same way. */
export function gapRows(gap: Gap, lines: string[]): Row[] {
  const rows: Row[] = [];
  // Clamped like refRows: lines past the end fall through to the
  // coverage check, which refuses the broken citation, instead of
  // passing as blank rows.
  for (let n = gap.from; n <= Math.min(gap.to, lines.length); n++) {
    rows.push({ type: "ctx", n, text: lines[n - 1] ?? "", key: `${gap.file}@${n}` });
  }
  return rows;
}

export interface ChangeRow {
  type: "add" | "del" | "ctx" | "was";
  n: number | null;
  text: string;
  key: string | null;
}

/**
 * A head scene's rows: the file at the head with each removed line in place
 * before the line that took its place. Added and removed rows carry the
 * change's keys; context rows carry none.
 */
export function headRows(
  file: string,
  from: number,
  to: number,
  lines: string[],
  change: ChangeFile | undefined,
): ChangeRow[] {
  const rows: ChangeRow[] = [];
  const last = Math.min(to, lines.length);
  const pushDels = (at: number): void => {
    for (const d of change?.dels.get(at) ?? []) {
      rows.push({ type: "del", n: null, text: d.text, key: `${file}:-${d.old}` });
    }
  };
  for (let n = from; n <= last; n++) {
    pushDels(n);
    const add = change?.added.has(n) ?? false;
    rows.push({
      type: add ? "add" : "ctx",
      n,
      text: lines[n - 1] ?? "",
      key: add ? `${file}:+${n}` : null,
    });
  }
  pushDels(last + 1);
  return rows;
}

/**
 * A base scene's rows: the file at the merge base, removed lines marked as
 * what was there before. Removed lines key with the change's path, since a
 * base scene on a renamed file names the path before the rename and the
 * diff's keys use the path after it.
 */
export function baseRows(
  file: string,
  from: number,
  to: number,
  lines: string[],
  change: ChangeFile | undefined,
): ChangeRow[] {
  const rows: ChangeRow[] = [];
  for (let n = from; n <= Math.min(to, lines.length); n++) {
    const was = change?.removedOld.has(n) ?? false;
    rows.push({
      type: was ? "was" : "ctx",
      n,
      text: lines[n - 1] ?? "",
      key: was ? `${change?.path ?? file}:-${n}` : null,
    });
  }
  return rows;
}

/** A closing-list change range's rows: added from the head, removed as kept. */
export function changeGapRows(
  gap: ChangeGap,
  headLines: string[],
  change: ChangeFile | undefined,
): ChangeRow[] {
  const rows: ChangeRow[] = [];
  if (gap.side === "+") {
    for (let n = gap.from; n <= Math.min(gap.to, headLines.length); n++) {
      rows.push({ type: "add", n, text: headLines[n - 1] ?? "", key: `${gap.file}:+${n}` });
    }
    return rows;
  }
  for (const list of change?.dels.values() ?? []) {
    for (const d of list) {
      if (d.old >= gap.from && d.old <= gap.to) {
        rows.push({ type: "del", n: null, text: d.text, key: `${gap.file}:-${d.old}` });
      }
    }
  }
  return rows;
}

/** What happened to the file, for a head scene's chip. */
export function headChip(change: ChangeFile | undefined): string {
  if (!change) return "unchanged";
  const base =
    change.status === "added"
      ? "new file"
      : change.status === "removed"
        ? "removed"
        : change.status === "renamed"
          ? `renamed from ${change.oldPath ?? ""}`
          : change.status === "modified" && (change.added.size > 0 || change.removedOld.size > 0)
            ? "changed"
            : "unchanged";
  if (!change.modeChange) return base;
  const modes = `mode ${change.modeChange[0]} became ${change.modeChange[1]}`;
  return base === "unchanged" ? modes : `${base}, ${modes}`;
}

const inRanges = (n: number, ranges: Range[]): boolean => ranges.some(([a, b]) => n >= a && n <= b);

const inRangesOpt = (n: number | null, ranges: Range[]): boolean =>
  n !== null && ranges.some(([a, b]) => n >= a && n <= b);

export interface StepDatum {
  i: number;
  id: string;
  scene: string;
  section: string;
  kind: "code" | "doc" | "diagram" | "image" | "leftovers";
  lit: number[];
  marks: { row: number; text: string[] }[];
  excerpt?: boolean;
  state?: string;
  label: string;
  chip: string;
  lines: string;
}

/** Every step with what it lights, refused where it lights nothing. */
/** A change file by the path a scene names, old or new. */
export function changeForFile(
  files: Map<string, ChangeFile>,
  file: string,
): ChangeFile | undefined {
  return files.get(file) ?? [...files.values()].find((f) => f.oldPath === file);
}

export function buildSteps(
  story: Story,
  scenes: Map<string, Scene>,
  docs: Map<string, Doc>,
  mds: Map<string, { html: string; spans: Range[] }>,
  rowsOf: Map<string, Row[]>,
  atShort: string,
  changeRowsOf: Map<string, ChangeRow[]> = new Map(),
  changes: Map<string, ChangeFile> = new Map(),
): StepDatum[] {
  const sectionIds = story.sections.map((s) => s.id);
  return story.steps.map((s, i) => {
    const sc = scenes.get(s.scene);
    if (!sc) throw new Error(`step ${s.id}: no scene ${s.scene}`);
    if (!sectionIds.includes(s.section)) throw new Error(`step ${s.id}: no section ${s.section}`);
    const kind: StepDatum["kind"] =
      sc.kind === "ref" || sc.kind === "head" || sc.kind === "base"
        ? "code"
        : sc.kind === "md"
          ? "doc"
          : sc.kind;
    const base = { i, id: s.id, scene: sc.id, section: s.section, kind };
    if (sc.kind === "md") {
      const md = mds.get(sc.id);
      if (!md) throw new Error(`step ${s.id}: no scene ${s.scene}`);
      const focus = s.focus ?? [];
      const lit = md.spans.flatMap(([a, b], j) =>
        focus.some(([x, y]) => a <= y && x <= b) ? [j] : [],
      );
      if (focus.length && !lit.length)
        throw new Error(`step ${s.id}: its focus lights no block of ${sc.file}`);
      return {
        ...base,
        lit,
        marks: [],
        excerpt: false,
        label: sc.file,
        chip: `as it stands at ${atShort}`,
        lines: `lines ${sc.from}–${sc.to}`,
      };
    }
    if (sc.kind === "ref") {
      const rows = rowsOf.get(sc.id);
      if (!rows) throw new Error(`step ${s.id}: no scene ${s.scene}`);
      const focus = s.focus ?? [];
      const lit: number[] = [];
      rows.forEach((r, j) => {
        if (inRanges(r.n, focus)) lit.push(j);
      });
      if (!lit.length) throw new Error(`step ${s.id}: its focus lights no row`);
      const marks = (s.marks ?? []).map((m) => {
        const row = rows.findIndex((r) => r.n === m.line);
        if (row < 0) throw new Error(`step ${s.id}: mark line ${m.line} is not in ${sc.id}`);
        for (const t of m.text) {
          if (!(rows[row]?.text.includes(t) ?? false)) {
            throw new Error(`step ${s.id}: "${t}" is not on line ${m.line}`);
          }
        }
        return { row, text: m.text };
      });
      const nums = rows.map((r) => r.n);
      return {
        ...base,
        lit,
        marks,
        label: sc.file,
        chip: `as it stands at ${atShort}`,
        lines: `lines ${Math.min(...nums)}–${Math.max(...nums)}`,
      };
    }
    if (sc.kind === "head" || sc.kind === "base") {
      const rows = changeRowsOf.get(sc.id);
      if (!rows) throw new Error(`step ${s.id}: no scene ${s.scene}`);
      const focus = s.focus ?? [];
      const lit: number[] = [];
      rows.forEach((r, j) => {
        if (r.type === "del") {
          // A removed line is lit with the line that took its place, or else the line before it.
          const next = rows.slice(j + 1).find((x) => x.type !== "del");
          const prev = rows
            .slice(0, j)
            .reverse()
            .find((x) => x.type !== "del");
          if (inRangesOpt(next?.n ?? null, focus) || inRangesOpt(prev?.n ?? null, focus)) {
            lit.push(j);
          }
        } else if (inRangesOpt(r.n, focus)) lit.push(j);
      });
      if (!lit.length) throw new Error(`step ${s.id}: its focus lights no row`);
      const marks = (s.marks ?? []).map((m) => {
        const row = rows.findIndex((r) => r.n === m.line && r.type !== "del");
        if (row < 0) throw new Error(`step ${s.id}: mark line ${m.line} is not in ${sc.id}`);
        for (const t of m.text) {
          if (!(rows[row]?.text.includes(t) ?? false)) {
            throw new Error(`step ${s.id}: "${t}" is not on line ${m.line}`);
          }
        }
        return { row, text: m.text };
      });
      const nums = rows.flatMap((r) => (r.n === null ? [] : [r.n]));
      const lines =
        nums.length > 0
          ? `lines ${Math.min(...nums)}–${Math.max(...nums)}`
          : `lines ${sc.from}–${sc.to}`;
      return {
        ...base,
        lit,
        marks,
        label: sc.file,
        chip: sc.kind === "head" ? headChip(changeForFile(changes, sc.file)) : "before the change",
        lines,
      };
    }
    if (sc.kind === "doc") {
      const doc = docs.get(sc.id);
      if (!doc) throw new Error(`step ${s.id}: no scene ${s.scene}`);
      const lit = (s.find ?? []).map((f) => {
        const hits = doc.blocks.flatMap((b, j) => (b.includes(f) ? [j] : []));
        if (hits.length !== 1)
          throw new Error(`step ${s.id}: "${f}" is in ${hits.length} blocks of ${sc.id}`);
        return hits[0] ?? 0;
      });
      if (s.excerpt && lit.length === 0) {
        throw new Error(`step ${s.id}: an excerpt with no find shows an empty panel`);
      }
      return {
        ...base,
        lit,
        marks: [],
        excerpt: !!s.excerpt,
        label: sc.label,
        chip: sc.chip,
        lines: "",
      };
    }
    if (sc.kind === "diagram") {
      if (!s.state || !sc.states.includes(s.state)) {
        throw new Error(
          `step ${s.id}: state ${s.state ?? "(none)"} is not one of ${sc.id}'s: ${sc.states.join(", ")}`,
        );
      }
      return {
        ...base,
        lit: [],
        marks: [],
        state: s.state,
        label: sc.label,
        chip: sc.chip,
        lines: "",
      };
    }
    return { ...base, lit: [], marks: [], label: sc.label, chip: sc.chip, lines: "" };
  });
}

/** A step's text with the coverage counts filled in. */
export function fill(t: string, shown: number, changed: number, left: number): string {
  return t
    .replace(/\{shown\}/gu, String(shown))
    .replace(/\{changed\}/gu, String(changed))
    .replace(/\{left\}/gu, String(left));
}

// ---------- pure core: the page ----------

export interface Picture {
  mime: string;
  b64: string;
}

export interface FileNameEntry {
  file: string;
  what: "renamed" | "binary" | "submodule" | "mode" | "empty-added" | "empty-removed";
  gpath: string;
  gwhat: string;
  fnote: string;
}

export interface ChangeParts {
  branch: string;
  head: string;
  mb: string;
  rowsOf: Map<string, ChangeRow[]>;
  gaps: ChangeGap[];
  gapRows: ChangeRow[][];
  files: FileNameEntry[];
}

export interface PageParts {
  story: Story;
  atShort: string;
  ticketSource: string;
  steps: StepDatum[];
  usedScenes: Scene[];
  docs: Map<string, Doc>;
  mds: Map<string, { html: string; spans: Range[] }>;
  rowsOf: Map<string, Row[]>;
  gaps: Gap[];
  gapRows: Row[][];
  named: { path: string; url: string }[];
  changed: number;
  left: number;
  shown: number;
  diagrams: Map<string, DiagramReady>;
  pictures: Map<string, Picture>;
  overlays: Map<string, string>;
  change?: ChangeParts;
}

function rowHtml(r: Row, scene: string): string {
  return `<div class="r ctx" data-k="${esc(r.key)}" data-scene="${esc(scene)}"><span class="n">${r.n}</span><span class="sg"> </span><span class="c">${esc(r.text)}</span></div>`;
}

function changeRowHtml(r: ChangeRow, scene: string): string {
  const sign = r.type === "add" ? "+" : r.type === "del" ? "−" : " ";
  const key = r.key === null ? "" : ` data-k="${esc(r.key)}"`;
  const title = r.type === "was" ? ' title="Removed by this change"' : "";
  return `<div class="r ${r.type}"${key} data-scene="${esc(scene)}"${title}><span class="n">${r.n ?? ""}</span><span class="sg">${sign}</span><span class="c">${esc(r.text)}</span></div>`;
}

/**
 * A touched file with what happened to it, for the closing list. Sizes name
 * the base and head bytes of a binary; other files carry none.
 */
export function fileNameEntry(
  f: ChangeFile,
  baseBytes: number | null,
  headBytes: number | null,
): FileNameEntry {
  if (f.submodule) {
    const words =
      f.status === "added"
        ? "submodule added"
        : f.status === "removed"
          ? "submodule removed"
          : "submodule changed";
    // ASCII: the sentence starts from a constructed English word's first letter.
    const sentence = `${words[0]?.toUpperCase() ?? ""}${words.slice(1)}.`;
    return {
      file: f.path,
      what: "submodule",
      gpath: f.path,
      gwhat: words,
      fnote: sentence,
    };
  }
  if (f.binary) {
    const words =
      f.status === "added" && headBytes !== null
        ? `binary file added, ${headBytes} bytes`
        : f.status === "removed"
          ? "binary file removed"
          : baseBytes !== null && headBytes !== null
            ? `binary file changed, ${baseBytes} bytes became ${headBytes} bytes`
            : "binary file changed";
    const rename = f.oldPath === null ? "" : `, renamed from ${f.oldPath}`;
    // ASCII: the sentence starts from a constructed English word's first letter.
    const sentence = `${words[0]?.toUpperCase() ?? ""}${words.slice(1)}${rename}.`;
    return {
      file: f.path,
      what: "binary",
      gpath: f.path,
      gwhat: `${words}${rename}`,
      fnote: sentence,
    };
  }
  if (f.oldPath !== null) {
    return {
      file: f.path,
      what: "renamed",
      gpath: f.path,
      gwhat: `renamed from ${f.oldPath}`,
      fnote: `Renamed from ${f.oldPath} to ${f.path}.`,
    };
  }
  if (f.modeChange !== null) {
    const words = `mode ${f.modeChange[0]} became ${f.modeChange[1]}`;
    return {
      file: f.path,
      what: "mode",
      gpath: f.path,
      gwhat: words,
      fnote: `Mode ${f.modeChange[0]} became ${f.modeChange[1]}.`,
    };
  }
  if (f.status === "added") {
    return {
      file: f.path,
      what: "empty-added",
      gpath: f.path,
      gwhat: "empty file added",
      fnote: "Empty file added.",
    };
  }
  return {
    file: f.path,
    what: "empty-removed",
    gpath: f.path,
    gwhat: "empty file removed",
    fnote: "Empty file removed.",
  };
}

/** Every block a renderer wrote, tagged with its scene and md source lines. */
export function sceneBlocks(html: string, id: string, srcs?: (string | null)[]): string {
  let out = html;
  const count = (html.match(/ data-b="/gu) ?? []).length;
  for (let i = 0; i < count; i++) {
    const src = srcs?.[i] ? ` data-src="${srcs[i]}"` : "";
    out = out.replace(`data-b="${i}"`, `data-b="${i}" data-scene="${esc(id)}"${src}`);
  }
  return out;
}

/** The review page's colours and type, so the two pages differ only in telling. */
export function pageStyle(diagramCss: string[]): string {
  return `<style>
/* Layout: one scroll from title to end. Phone = the panel sticks to the top half and the story
   scrolls beneath it; 900px and up = the story in a column beside the panel, which stays in view.
   The panel shows the ticket, a diagram or the code, whichever the step tells.
   Colours and type are the review page's, so the two pages differ only in how they tell the change. */
:root {
  --bg: #f5f6f8; --panel: #ffffff; --ink: #1c2230; --muted: #5a6475; --rule: #dfe3ea;
  --accent: #1d5ca8; --accent-soft: #e5eefa; --on-accent: #ffffff;
  --add: #e6f4ea; --add-ink: #1f6f37; --del: #fbeaea; --del-ink: #a3261a;
  --mark: #fff1b5; --mark-edge: #d9a700; --gutter: #8b94a4;
  --ex: #fbeedf; --ex-ink: #8f4a00;
  --hl-keyword: #4338ca; --hl-string: #1f6f37; --hl-comment: #6b7380; --hl-number: #9c4a00;
  --hl-title: #0d6880; --hl-type: #8330b0; --hl-meta: #a3261a;
  --shadow: rgb(20 30 50 / .10);
  --plate-paper: #fcfaee; --plate-ink: #304862; --plate-coral: #f67355;
  --font-plate: "DM Serif Display", Georgia, "Times New Roman", serif;
  --font-ui: "Red Hat Text", system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-display: "Red Hat Display", "Red Hat Text", system-ui, sans-serif;
  --font-code: "Red Hat Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #12161d; --panel: #181d26; --ink: #e3e7ee; --muted: #9aa3b2; --rule: #2a313d;
    --accent: #8ab8f2; --accent-soft: #1d2b40; --on-accent: #10151c;
    --add: #15301f; --add-ink: #8fd69b; --del: #3a1a1a; --del-ink: #ff9c8f;
    --mark: #4a3d10; --mark-edge: #e0b32a; --gutter: #6c7686;
    --ex: #3a2a16; --ex-ink: #f0b46a;
    --hl-keyword: #a5b0ff; --hl-string: #8fd69b; --hl-comment: #8b95a5; --hl-number: #f2b66b;
    --hl-title: #6fd0e2; --hl-type: #d6a8ff; --hl-meta: #ff9c8f;
    --shadow: rgb(0 0 0 / .35);
    --plate-paper: #192630; --plate-ink: #e9e5d3; --plate-coral: #f68d73;
    color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --bg: #12161d; --panel: #181d26; --ink: #e3e7ee; --muted: #9aa3b2; --rule: #2a313d;
  --accent: #8ab8f2; --accent-soft: #1d2b40; --on-accent: #10151c;
  --add: #15301f; --add-ink: #8fd69b; --del: #3a1a1a; --del-ink: #ff9c8f;
  --mark: #4a3d10; --mark-edge: #e0b32a; --gutter: #6c7686;
  --ex: #3a2a16; --ex-ink: #f0b46a;
  --hl-keyword: #a5b0ff; --hl-string: #8fd69b; --hl-comment: #8b95a5; --hl-number: #f2b66b;
  --hl-title: #6fd0e2; --hl-type: #d6a8ff; --hl-meta: #ff9c8f;
  --shadow: rgb(0 0 0 / .35);
  --plate-paper: #192630; --plate-ink: #e9e5d3; --plate-coral: #f68d73;
  color-scheme: dark;
}
* { box-sizing: border-box; }
body { background: var(--bg); color: var(--ink); font-family: var(--font-ui); font-size: 15px; line-height: 1.5; }
.wrap { padding-inline: 16px; padding-block: 0 32px; max-width: 1500px; margin: 0 auto; }
a { color: var(--accent); }
p { margin: 0; }
code { font-family: var(--font-code); font-size: .88em; background: var(--accent-soft); padding: 0 4px; border-radius: 4px; overflow-wrap: anywhere; }
.eyebrow, .chap { font-size: 12px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--ex-ink); }
.meta { color: var(--muted); font-size: 13.5px; font-variant-numeric: tabular-nums; }
.meta b { color: var(--add-ink); font-weight: 600; } .meta i { color: var(--del-ink); font-style: normal; font-weight: 600; }

/* The panel */
.scrolly { position: relative; display: grid; grid-template-columns: minmax(0, 1fr); }
.stage { position: sticky; top: env(safe-area-inset-top, 0px); z-index: 2; height: 52vh; height: 52dvh; min-height: 250px; display: flex; flex-direction: column; gap: 6px; background: var(--bg); padding-block: 10px 8px; box-shadow: 0 10px 14px -12px var(--shadow); }
.secs { display: flex; gap: 4px; overflow-x: auto; scrollbar-width: none; }
.secs::-webkit-scrollbar { display: none; }
.secs a { flex: none; font-size: 12px; font-weight: 600; text-decoration: none; color: var(--muted); border: 1px solid var(--rule); border-radius: 999px; padding: 2px 10px; }
.secs a[aria-current] { color: var(--on-accent); background: var(--accent); border-color: var(--accent); }
.stagehead { display: flex; flex-wrap: wrap; gap: 2px 10px; align-items: baseline; padding: 0 2px; font-size: 12.5px; color: var(--muted); font-variant-numeric: tabular-nums; }
.slabel { font-family: var(--font-code); font-weight: 500; color: var(--ink); overflow-wrap: anywhere; min-width: 0; }
.schip { font-size: 11.5px; font-weight: 600; letter-spacing: .03em; color: var(--ex-ink); background: var(--ex); border-radius: 6px; padding: 0 6px; }
.scount { margin-left: auto; }
.scenes { position: relative; flex: 1; min-height: 0; background: var(--panel); border: 1px solid var(--rule); border-radius: 10px; overflow: hidden; }
.scene { position: absolute; inset: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: var(--rule) transparent; opacity: 0; visibility: hidden; transition: opacity .3s ease, visibility 0s linear .3s; }
.scene.on { opacity: 1; visibility: visible; transition: opacity .3s ease; }

/* Code */
.rows { font-family: var(--font-code); font-size: 12.5px; line-height: 1.55; padding-block: 6px; }
.scene.code .rows { padding-bottom: 45%; }
.r { display: grid; grid-template-columns: 4.2ch 2ch minmax(0, 1fr); transition: opacity .25s ease; }
.n { color: var(--gutter); text-align: right; padding-right: .9ch; user-select: none; -webkit-user-select: none; font-variant-numeric: tabular-nums; }
.sg { color: var(--gutter); text-align: center; user-select: none; -webkit-user-select: none; }
.c { white-space: pre-wrap; overflow-wrap: anywhere; padding-right: 12px; min-width: 0; }
.r.add { background: var(--add); } .r.add .sg { color: var(--add-ink); }
.r.del { background: var(--del); } .r.del .sg { color: var(--del-ink); }
.r.was .n { color: var(--del-ink); } .r.was { box-shadow: inset 3px 0 0 var(--del-ink); }
.scene.focus .r, .scene.focus .b { opacity: .38; }
.scene.focus .r.lit, .scene.focus .b.lit { opacity: 1; }
.r.lit { box-shadow: inset 3px 0 0 var(--mark-edge); } .r.lit .n { color: var(--ink); }
.r.was.lit { box-shadow: inset 3px 0 0 var(--del-ink); }
mark { background: var(--mark); color: inherit; border-radius: 3px; box-shadow: 0 0 0 1px var(--mark-edge); }

/* A picture in the postmaster poster's style: one visual world, the same in both themes */
.posterwrap { min-height: 100%; display: grid; place-items: center; padding: 12px; }
.poster { margin: 0; width: 100%; max-width: 640px; background: #f3e6c4; border: 2px solid #3a2f25; outline: 1px solid #3a2f25; outline-offset: -7px; padding: 14px 12px 12px; display: grid; gap: 10px; justify-items: center; box-shadow: 0 8px 24px -14px rgb(0 0 0 / .5); }
.poster .ribbon { font-family: "Alfa Slab One", Georgia, serif; font-size: 17px; letter-spacing: .06em; text-transform: uppercase; color: #f3e6c4; background: #8e1d1d; padding: 6px 30px; clip-path: polygon(0 0, 100% 0, calc(100% - 12px) 50%, 100% 100%, 0 100%, 12px 50%); text-align: center; }
.poster .ribbon.sub { font-family: "IM Fell English", Georgia, serif; text-transform: none; letter-spacing: 0; font-size: 17px; background: #2f4b2c; }
.poster .art { position: relative; width: 100%; border: 1.5px solid #3a2f25; }
.poster .art img { display: block; width: 100%; height: auto; }
.poster .over { position: absolute; inset: 0; width: 100%; height: 100%; }
.poster .over .bub, .poster .over .card { fill: #efe3c6; stroke: #3a2f25; stroke-width: 3.2px; }
.poster .over .inner { fill: none; stroke: #3a2f25; stroke-width: 1.2px; }
.poster .over .say { font: 25px "IM Fell English", Georgia, serif; fill: #2b2620; }
.poster .over .head { font: 27px "IM Fell English", Georgia, serif; fill: #2b2620; }
.poster .over .row { font: 21px "IM Fell English", Georgia, serif; fill: #2b2620; }
.poster .over .box { fill: none; stroke: #2b2620; stroke-width: 2.4px; }
.poster .over .tick { fill: none; stroke: #2b2620; stroke-width: 3px; stroke-linecap: round; stroke-linejoin: round; }
/* A Markdown file of the repository, as formatted text */
.mdin .li { padding-left: 1.1em; position: relative; } .mdin .li::before { content: "•"; position: absolute; left: .2em; color: var(--muted); }
.mdin .d1 { margin-left: 1.2em; } .mdin .d2 { margin-left: 2.4em; } .mdin .d3 { margin-left: 3.6em; }
.mdin .mdcode { font-family: var(--font-code); font-size: 12.5px; white-space: pre-wrap; overflow-wrap: anywhere; background: var(--bg); border: 1px solid var(--rule); padding: 8px 10px; margin: 0; }
/* The ticket and the pull request's text */
.docin { padding: 14px 16px 45%; font-size: 14px; display: grid; gap: 8px; max-width: 70ch; }
.docin .deye { font-size: 11.5px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.docin h2 { margin: 0; font-family: var(--font-display); font-size: 17px; line-height: 1.3; text-wrap: balance; }
.docin h3 { margin: 8px 0 0; font-family: var(--font-display); font-size: 14.5px; }
.docin h4 { margin: 4px 0 0; font-size: 13.5px; }
.docin ol, .docin ul { margin: 0; padding-left: 22px; display: grid; gap: 6px; }
.b { border-radius: 6px; transition: opacity .25s ease, background-color .25s ease, box-shadow .25s ease; }
.scene.focus .b.lit { background: var(--accent-soft); box-shadow: -8px 0 0 var(--accent-soft), 0 0 0 4px var(--accent-soft); }

/* Diagrams */
.diagin { min-height: 100%; display: grid; place-items: center; padding: 12px; }
.dgfig { margin: 0; width: 100%; display: grid; justify-items: center; gap: 10px; }
.dgfig figcaption { font-size: 12.5px; color: var(--muted); text-align: center; max-width: 44ch; }
.dg { width: 100%; max-width: 560px; height: auto; display: block; color: var(--ink); }
.dg .bx { fill: var(--panel); stroke: var(--rule); stroke-width: 1.5px; }
.dg .bx.hot { stroke: var(--accent); stroke-width: 2px; }
.dg .bx.bad { stroke: var(--del-ink); } .dg .bx.ok { stroke: var(--add-ink); }
.dg .row { fill: transparent; stroke: none; }
.dg .t1 { font: 600 13px var(--font-ui); fill: currentColor; }
.dg .t2 { font: 400 11.5px var(--font-ui); fill: var(--muted); }
.dg .t3 { font: 400 11px var(--font-ui); fill: var(--muted); }
.dg .big { font: 600 22px var(--font-code); fill: currentColor; }
.dg .mono { font-family: var(--font-code); }
.dg text.bad { fill: var(--del-ink); font-weight: 600; } .dg text.ok { fill: var(--add-ink); font-weight: 600; }
.dg .ln { stroke: var(--gutter); stroke-width: 1.5px; fill: none; } .dg .dash { stroke-dasharray: 4 3; }
.dg .ah { fill: var(--gutter); }
.dg .dash-b { stroke-dasharray: 4 3; }
.dg .dimbar { fill: var(--rule); }
/* The engraved plate that opens a ticket's story, in the postmaster's navy, coral and paper */
.dg.plate { color: var(--plate-ink); max-width: 500px; }
.plate .pp { fill: var(--plate-paper); } .plate .pn { fill: none; } .plate .pi { stroke: var(--plate-ink); }
.plate .ph { fill: url(#hero-hatch); } .plate .pf { fill: url(#hero-fine); }
.plate .pc { fill: var(--plate-coral); } .plate .pk { fill: var(--plate-ink); } .plate .ps { stroke: var(--plate-paper); }
.plate .disp { font-family: var(--font-plate); font-weight: 400; }
.plate .pt { font-size: 16px; fill: var(--plate-ink); }
.plate .pt2 { font-size: 11px; fill: var(--plate-ink); }
.plate .pt3 { font-size: 13px; font-style: italic; fill: var(--plate-ink); }
.plate .psx { font-size: 13px; fill: var(--plate-paper); }
.plate .pl { font: 500 7.5px var(--font-code); letter-spacing: .12em; fill: var(--plate-ink); }
/* A step can show only the words it is about from the ticket, large, instead of the whole text */
.scene.excerpt .b:not(.lit), .scene.excerpt .dtitle { display: none; }
.scene.excerpt .docin { min-height: 100%; align-content: center; padding-bottom: 20px; }
.scene.excerpt ol, .scene.excerpt ul { list-style: none; padding-left: 0; }
.scene.excerpt .b.lit { font-size: 18px; line-height: 1.5; background: none; box-shadow: none; }
.step.title h1.plate-h { font-family: var(--font-plate); font-weight: 400; font-size: 31px; line-height: 1.12; letter-spacing: -.01em; }
.dg * { transition: opacity .4s ease, transform .55s ease, fill .3s ease, stroke .3s ease; }
${diagramCss.join("\n")}

/* What the steps leave out */
.leftin { padding: 14px 14px 40%; display: grid; gap: 10px; }
.leftin h2 { margin: 0; font-family: var(--font-display); font-size: 16px; }
.lsum { color: var(--muted); font-size: 13.5px; font-variant-numeric: tabular-nums; }
.gap { border: 1px solid var(--rule); border-radius: 8px; overflow: hidden; background: var(--bg); }
.gap > summary { display: flex; flex-wrap: wrap; gap: 2px 12px; justify-content: space-between; padding: 8px 10px; cursor: pointer; font-size: 13px; }
.gap[open] > summary { border-bottom: 1px solid var(--rule); }
.gap .ex { background: var(--panel); }
.gpath { font-family: var(--font-code); font-size: 12px; overflow-wrap: anywhere; min-width: 0; }
.gwhat { color: var(--muted); font-variant-numeric: tabular-nums; }

/* The story */
.steps { display: grid; gap: 34vh; gap: 34dvh; padding-block: 5vh 48vh; position: relative; z-index: 1; }
.step { position: relative; background: transparent; border: 2px solid transparent; border-radius: 12px; padding: 14px 16px; display: grid; gap: 6px; max-width: 34rem; opacity: .45; transition: opacity .25s ease, border-color .25s ease, background-color .25s ease, box-shadow .25s ease; scroll-margin-top: 54dvh; cursor: pointer; }
.step.on { opacity: 1; background: var(--panel); border-color: var(--accent); box-shadow: 0 0 0 4px var(--accent-soft), 0 12px 26px -14px var(--shadow); }
/* The notch points from the active step to the panel it drives: up on a phone, right on a wide screen. */
.step.on::after { content: ""; position: absolute; left: 50%; top: -10px; width: 16px; height: 16px; background: var(--panel); border-left: 2px solid var(--accent); border-top: 2px solid var(--accent); transform: translateX(-50%) rotate(45deg); border-top-left-radius: 3px; }
.step h1 { margin: 2px 0; font-family: var(--font-display); font-size: 21px; line-height: 1.25; text-wrap: balance; }
.step h3 { margin: 0; font-family: var(--font-display); font-size: 17px; line-height: 1.3; text-wrap: balance; }
.step.title h3 { margin-top: 6px; }
.step.crit h3 { font-size: 19px; }
.snum { font-size: 12.5px; color: var(--muted); font-variant-numeric: tabular-nums; }
.txt { max-width: 62ch; }
.hint { color: var(--muted); font-size: 13px; }
.foot { color: var(--muted); font-size: 13px; max-width: 65ch; }
a:focus-visible, summary:focus-visible, .step:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.hljs-keyword, .hljs-built_in, .hljs-literal { color: var(--hl-keyword); }
.hljs-string, .hljs-regexp, .hljs-template-string { color: var(--hl-string); }
.hljs-comment, .hljs-quote { color: var(--hl-comment); font-style: italic; }
.hljs-number { color: var(--hl-number); }
.hljs-title, .hljs-attr, .hljs-property { color: var(--hl-title); }
.hljs-type, .hljs-params, .hljs-variable, .hljs-template-variable, .hljs-subst { color: var(--hl-type); }
.hljs-meta { color: var(--hl-meta); }

@media (min-width: 900px) {
  .wrap { padding-inline: 24px; }
  .scrolly { grid-template-columns: minmax(300px, 0.8fr) minmax(0, 1.45fr); grid-template-areas: "steps stage"; column-gap: 28px; }
  .stage { grid-area: stage; top: 16px; align-self: start; height: calc(100vh - 32px); height: calc(100dvh - 32px); box-shadow: none; padding-block: 0; margin-top: 16px; }
  .steps { grid-area: steps; gap: 42vh; padding-block: 16px 50vh; }
  .step { scroll-margin-top: 30vh; }
  .step.on::after { left: auto; right: -10px; top: 50%; border-left: 0; border-top: 2px solid var(--accent); border-right: 2px solid var(--accent); border-top-left-radius: 0; border-top-right-radius: 3px; transform: translateY(-50%) rotate(45deg); }
  .step h1 { font-size: 25px; }
  .rows { font-size: 13.5px; }
  .docin { font-size: 15px; padding: 20px 24px 45%; }
  .docin h2 { font-size: 20px; }
}
@media (prefers-reduced-motion: reduce) {
  .scene, .scene.on, .r, .b, .step, .dg * { transition: none; }
}
</style>`;
}

/** The closing list: cited lines on no step, and the whole files named. */
function leftHtml(p: PageParts, scene: string): string {
  const { gaps, gapRows, named, changed, left } = p;
  const head = `<h2>Code the ticket points to</h2><p class="lsum">${changed - left} of the ${changed} lines the ticket cites are on the steps. ${left ? `The other ${left} are here. Tap one to read it.` : "None is left out."}</p>${named.length ? `<p class="lsum">It also names ${named.length === 1 ? "a whole file" : "whole files"}: ${named.map((x) => `<a href="${esc(x.url)}">${esc(x.path)}</a>`).join(", ")}.</p>` : ""}`;
  const items = gaps
    .map((g, gi) => {
      const rows = gapRows[gi] ?? [];
      const what = `lines ${g.from}${g.to > g.from ? `–${g.to}` : ""}`;
      return `<details class="gap"><summary><span class="gpath">${esc(g.file)}</span><span class="gwhat">${what} · ${rows.length} ${rows.length === 1 ? "line" : "lines"}</span></summary><div class="ex" data-lang="${langOf(g.file)}"><div class="rows">${rows.map((r) => rowHtml(r, scene)).join("")}</div></div></details>`;
    })
    .join("");
  return `<div class="leftin">${head}${items}</div>`;
}

/** A change's closing list: changed lines on no step, and the files named. */
function changeLeftHtml(p: PageParts, scene: string, change: ChangeParts): string {
  const { gaps, gapRows, files } = change;
  const { changed, left, shown } = p;
  const head = `<h2>What the steps leave out</h2><p class="lsum">${shown} of the ${changed} changed lines are on the steps. ${left ? `The other ${left} are here, file by file. Tap one to read it.` : "None is left out."}</p>${files.length ? `<p class="lsum">It also names ${files.length === 1 ? "a file" : `${files.length} files`} no step shows, with what happened to each.</p>` : ""}`;
  const items = gaps
    .map((g, gi) => {
      const rows = gapRows[gi] ?? [];
      const range = `${g.from}${g.to > g.from ? `–${g.to}` : ""}`;
      const what =
        g.side === "+" ? `added lines ${range}` : `removed lines ${range} of the old file`;
      return `<details class="gap"><summary><span class="gpath">${esc(g.file)}</span><span class="gwhat">${what} · ${rows.length} ${rows.length === 1 ? "line" : "lines"}</span></summary><div class="ex" data-lang="${langOf(g.file)}"><div class="rows">${rows.map((r) => changeRowHtml(r, scene)).join("")}</div></div></details>`;
    })
    .join("");
  const names = files
    .map(
      (f) =>
        `<details class="gap file" data-file="${esc(f.file)}" data-what="${f.what}"><summary><span class="gpath">${esc(f.gpath)}</span><span class="gwhat">${esc(f.gwhat)}</span></summary><p class="fnote">${esc(f.fnote)}</p></details>`,
    )
    .join("");
  return `<div class="leftin">${head}${items}${names}</div>`;
}

/** A change page's extra style: the closing list's file notes. Nothing else. */
const CHANGE_STYLE =
  "<style>\n.fnote { margin: 0; padding: 2px 10px 10px; color: var(--muted); font-size: 13px; }\n</style>";

function scenesHtml(p: PageParts): string {
  const first = p.steps[0]?.scene;
  return p.usedScenes
    .map((sc) => {
      const on = first === sc.id;
      const code = sc.kind === "ref" || sc.kind === "head" || sc.kind === "base";
      const cls = code ? "code ex" : sc.kind;
      const lang =
        sc.kind === "ref" || sc.kind === "head" || sc.kind === "base"
          ? ` data-lang="${langOf(sc.file)}"`
          : "";
      const open = `<div class="scene ${cls}${on ? " on" : ""}" data-id="${esc(sc.id)}"${lang}${on ? "" : ' aria-hidden="true"'}>`;
      if (sc.kind === "ref") {
        const rows = p.rowsOf.get(sc.id) ?? [];
        return `${open}<div class="rows">${rows.map((r) => rowHtml(r, sc.id)).join("")}</div></div>`;
      }
      if (sc.kind === "head" || sc.kind === "base") {
        const rows = p.change?.rowsOf.get(sc.id) ?? [];
        return `${open}<div class="rows">${rows.map((r) => changeRowHtml(r, sc.id)).join("")}</div></div>`;
      }
      if (sc.kind === "doc") {
        const doc = p.docs.get(sc.id);
        if (!doc) throw new Error(`no scene ${sc.id}`);
        return `${open}<div class="docin">${sceneBlocks(doc.html, sc.id)}</div></div>`;
      }
      if (sc.kind === "md") {
        const md = p.mds.get(sc.id);
        if (!md) throw new Error(`no scene ${sc.id}`);
        const srcs = md.spans.map(([a, b]) =>
          a === b ? `${sc.file}@${a}` : `${sc.file}@${a}-${b}`,
        );
        const tagged = sceneBlocks(md.html, sc.id, srcs);
        return `${open.replace('class="scene md', 'class="scene doc md')}<div class="docin mdin">${tagged}</div></div>`;
      }
      if (sc.kind === "image") {
        const pic = p.pictures.get(sc.id);
        if (!pic) throw new Error(`no scene ${sc.id}`);
        const over = p.overlays.get(sc.id) ?? "";
        const banner = sc.banner ? `<p class="ribbon">${esc(sc.banner)}</p>` : "";
        const sub = sc.subtitle ? `<p class="ribbon sub">${esc(sc.subtitle)}</p>` : "";
        const art = `<div class="art"><img src="data:${pic.mime};base64,${pic.b64}" alt="${esc(sc.alt)}">${over}</div>`;
        return `${open}<div class="posterwrap"><figure class="poster">${banner}${art}${sub}</figure></div></div>`;
      }
      if (sc.kind === "diagram") {
        const dg = p.diagrams.get(sc.id);
        if (!dg) throw new Error(`no scene ${sc.id}`);
        return `${open}<div class="diagin"><figure class="dgfig">${dg.svg}${sc.caption ? `<figcaption>${inline(sc.caption)}</figcaption>` : ""}</figure></div></div>`;
      }
      const change = p.change;
      if (sc.kind === "leftovers" && change)
        return `${open}${changeLeftHtml(p, sc.id, change)}</div>`;
      return `${open}${leftHtml(p, sc.id)}</div>`;
    })
    .join("\n");
}

function secsHtml(p: PageParts): string {
  const firstOf = new Map<string, number>();
  p.story.steps.forEach((s, i) => {
    if (!firstOf.has(s.section)) firstOf.set(s.section, i);
  });
  const current = p.story.steps[0]?.section;
  return p.story.sections
    .filter((s) => firstOf.has(s.id))
    .map(
      (s) =>
        `<a href="#s${(firstOf.get(s.id) ?? 0) + 1}" data-sec="${esc(s.id)}"${s.id === current ? ' aria-current="step"' : ""}>${esc(s.label)}</a>`,
    )
    .join("");
}

/** The story's ticket document: the doc scene for this issue, whatever its id. */
export function ticketDocId(story: Story): string | undefined {
  return story.scenes.find(
    (s) => s.kind === "doc" && s.from === "issue" && s.number === story.ticket,
  )?.id;
}

export function stepsHtml(p: PageParts): string {
  const { story, steps } = p;
  const N = steps.length;
  const minutes = Math.max(3, Math.round(N * 0.33));
  const ticketScene = ticketDocId(story);
  const ticketTitle = (ticketScene ? p.docs.get(ticketScene) : undefined)?.blocks[0] ?? "";
  const firstOf = new Map<string, number>();
  story.steps.forEach((s, i) => {
    if (!firstOf.has(s.section)) firstOf.set(s.section, i);
  });
  return story.steps
    .map((s, i) => {
      const sec = story.sections.find((x) => x.id === s.section);
      if (!sec) throw new Error(`step ${s.id}: no section ${s.section}`);
      const chap = firstOf.get(s.section) === i ? `<p class="chap">${esc(sec.title)}</p>` : "";
      const num = `<p class="snum">Step ${i + 1} of ${N}</p>`;
      if (s.kind === "title") {
        const version = p.change
          ? `branch ${esc(p.change.branch)} · ${esc(p.change.head.slice(0, 7))} against ${esc(p.change.mb.slice(0, 7))} · `
          : "";
        return `<article class="step title${i === 0 ? " on" : ""}" id="s${i + 1}" data-i="${i}"><p class="eyebrow">Ticket #${story.ticket} · ${esc(story.status ?? "")}</p><h1 class="plate-h">${inline(s.title)}</h1><p class="txt">${inline(fill(s.text, p.shown, p.changed, p.left))}</p><p class="meta"><a href="${esc(story.repoUrl)}/issues/${story.ticket}">#${story.ticket}, ${inline(ticketTitle)}</a> · ${version}${N} steps, about ${minutes} minutes</p><p class="hint">Scroll to begin.</p></article>`;
      }
      return `<article class="step${s.kind === "criterion" ? " crit" : ""}${i === 0 ? " on" : ""}" id="s${i + 1}" data-i="${i}">${chap}${num}<h3>${inline(s.title)}</h3><p class="txt">${inline(fill(s.text, p.shown, p.changed, p.left))}</p></article>`;
    })
    .join("\n");
}

/** The story page: one HTML fragment with its data inline, for an artifact. */
export function pageHtml(p: PageParts, diagramCss: string[]): string {
  const { story, steps } = p;
  const N = steps.length;
  const first = steps[0];
  if (!first) throw new Error("the story names no steps");
  const scenes = p.usedScenes.map((s) => ({
    id: s.id,
    kind: s.kind,
    ...(s.kind === "diagram" ? { states: s.states } : {}),
  }));
  const head = `<div class="stagehead"><span class="slabel" id="slabel">${esc(first.label)}</span><span class="schip" id="schip">${esc(first.chip)}</span><span id="slines">${esc(first.lines)}</span><span class="scount" id="scount">Step 1 of ${N}</span></div>`;
  const foot = p.change
    ? `Built from ticket #${story.ticket} as it reads ${p.ticketSource}, and branch ${esc(p.change.branch)} at ${esc(p.change.head)} against ${esc(p.change.mb)}. This page is for reading. Comments and decisions go in your chat with the session.`
    : `Built from ticket #${story.ticket} as it reads ${p.ticketSource}, and the code as it stands at ${esc(p.atShort)}. This page is for reading. Comments and decisions go in your chat with the session.`;
  return `<title>${esc(story.title ?? `Story of #${story.ticket}`)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Alfa+Slab+One&family=IM+Fell+English:ital@0;1&family=DM+Serif+Display:ital@0;1&family=Red+Hat+Display:wght@600;700&family=Red+Hat+Mono:wght@400;500&family=Red+Hat+Text:wght@400;500;600&display=swap">
${pageStyle(diagramCss)}${p.change ? `\n${CHANGE_STYLE}` : ""}

<div class="wrap">
  <section class="scrolly" id="story" aria-label="The change, step by step">
    <div class="stage">
      <nav class="secs" aria-label="Sections">${secsHtml(p)}</nav>
      ${head}
      <div class="scenes">
${scenesHtml(p)}
      </div>
    </div>
    <div class="steps">
${stepsHtml(p)}
    </div>
  </section>
  <p class="foot">${foot}</p>
</div>

<script type="application/json" id="story-data">${JSON.stringify({ n: N, steps, scenes }).replace(/</gu, "\\u003c")}</script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/highlight.min.js"></script>
<script>
(() => {
  const pickStep = ${pickStep.toString()};
  const readingLine = ${readingLine.toString()};
  const S = JSON.parse(document.getElementById("story-data").textContent);
  const steps = [...document.querySelectorAll(".step")];
  const sceneEls = new Map([...document.querySelectorAll(".scene")].map((e) => [e.dataset.id, e]));
  const secLinks = [...document.querySelectorAll(".secs a")];
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const narrow = matchMedia("(max-width: 899.98px)");
  const $ = (id) => document.getElementById(id);
  const plain = new WeakMap();
  const colored = new WeakMap();
  const esc = (s) => s.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");

  // Highlight a block as one text, then split the result back into rows, closing and reopening
  // the spans that cross a line break, so a comment or string over several rows stays coloured.
  function splitLines(html) {
    const out = [];
    const open = [];
    let cur = "";
    const re = /(<span[^>]*>)|(<[/]span>)|(\\n)|([^<\\n]+)/gu;
    let m;
    while ((m = re.exec(html))) {
      if (m[1]) { open.push(m[1]); cur += m[1]; }
      else if (m[2]) { open.pop(); cur += m[2]; }
      else if (m[3]) { cur += "</span>".repeat(open.length); out.push(cur); cur = open.join(""); }
      else cur += m[4];
    }
    out.push(cur + "</span>".repeat(open.length));
    return out;
  }
  function highlight() {
    if (!window.hljs) return;
    for (const ex of document.querySelectorAll(".ex")) {
      const cells = [...ex.querySelectorAll(".c")];
      for (const c of cells) if (!plain.has(c)) plain.set(c, c.textContent);
      try {
        const html = hljs.highlight(cells.map((c) => plain.get(c)).join("\\n"), { language: ex.dataset.lang, ignoreIllegals: true }).value;
        const lines = splitLines(html);
        cells.forEach((c, i) => { colored.set(c, lines[i] ?? esc(plain.get(c))); if (!c.dataset.marked) c.innerHTML = colored.get(c); });
      } catch { /* the rows stay as plain text */ }
    }
  }

  let active = -1;
  let shownScene = null;
  let marked = [];
  function restoreMarks() {
    for (const c of marked) { delete c.dataset.marked; c.innerHTML = colored.get(c) ?? esc(plain.get(c) ?? c.textContent); }
    marked = [];
  }
  function markCell(c, texts) {
    const t = plain.get(c) ?? c.textContent;
    plain.set(c, t);
    const spots = [];
    for (const s of texts) { let at = t.indexOf(s); while (at >= 0) { spots.push([at, at + s.length]); at = t.indexOf(s, at + s.length); } }
    spots.sort((a, b) => a[0] - b[0]);
    let html = "", pos = 0;
    for (const [a, b] of spots) { if (a < pos) continue; html += esc(t.slice(pos, a)) + "<mark>" + esc(t.slice(a, b)) + "</mark>"; pos = b; }
    c.innerHTML = html + esc(t.slice(pos));
    c.dataset.marked = "1";
    marked.push(c);
  }
  function activate(i, jump) {
    if (i === active || !S.steps[i]) return;
    const st = S.steps[i];
    restoreMarks();
    // Clear every outline, not only the last one: the first step starts outlined in the HTML.
    for (const s of steps) s.classList.remove("on");
    steps[i].classList.add("on");
    const sc = sceneEls.get(st.scene);
    if (sc !== shownScene) {
      for (const e of sceneEls.values()) { const on = e === sc; e.classList.toggle("on", on); e.setAttribute("aria-hidden", on ? "false" : "true"); }
      shownScene = sc;
    }
    let target = null;
    if (st.kind === "code" || st.kind === "doc") {
      if (st.kind === "doc") sc.classList.toggle("excerpt", !!st.excerpt);
      const items = sc.querySelectorAll(st.kind === "code" ? ".r" : ".b");
      sc.classList.toggle("focus", st.lit.length > 0);
      items.forEach((r) => r.classList.remove("lit"));
      for (const j of st.lit) items[j]?.classList.add("lit");
      for (const m of st.marks) { const c = items[m.row]?.querySelector(".c"); if (c) markCell(c, m.text); }
      // Bring the marked words into view first: on a phone the lit rows can be taller than the panel.
      target = st.marks.length ? items[st.marks[0].row] : items[st.lit[0]];
    } else if (st.kind === "diagram") {
      sc.querySelector("svg.dg")?.setAttribute("data-state", st.state);
    }
    const y = target ? Math.max(0, target.offsetTop - sc.clientHeight * 0.16) : 0;
    sc.scrollTo({ top: y, behavior: reduce.matches || jump ? "auto" : "smooth" });
    $("slabel").textContent = st.label;
    $("schip").textContent = st.chip;
    $("slines").textContent = st.lines;
    $("scount").textContent = "Step " + (i + 1) + " of " + S.n;
    for (const a of secLinks) { if (a.dataset.sec === st.section) a.setAttribute("aria-current", "step"); else a.removeAttribute("aria-current"); }
    // Keep the current section's chip in view on a narrow panel, without scrolling the page.
    const cur = secLinks.find((a) => a.dataset.sec === st.section);
    const bar = cur?.parentElement;
    if (cur && bar && bar.scrollWidth > bar.clientWidth) bar.scrollLeft = Math.max(0, cur.offsetLeft - bar.offsetLeft - 24);
    active = i;
  }

  // The reading line: below the panel on a phone, a little above the middle on a wide screen.
  // The step on it, or else the nearest step to it, is the one the panel shows.
  function pick() {
    const boxes = steps.map((s) => { const r = s.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; });
    const i = pickStep(boxes, innerHeight, narrow.matches);
    if (i >= 0) activate(i);
  }
  let ticking = false;
  const onScroll = () => { if (ticking) return; ticking = true; requestAnimationFrame(() => { ticking = false; pick(); }); };
  // Tapping a step brings it to the reading line, so the panel and the box agree.
  function bring(s) {
    const r = s.getBoundingClientRect();
    scrollTo({ top: scrollY + r.top + Math.min(r.height / 2, innerHeight * 0.15) - readingLine(innerHeight, narrow.matches), behavior: reduce.matches ? "auto" : "smooth" });
    activate(Number(s.dataset.i));
  }
  for (const s of steps) {
    s.tabIndex = 0;
    s.addEventListener("click", (ev) => { if (!ev.target.closest("a")) bring(s); });
    s.addEventListener("focus", () => activate(Number(s.dataset.i)));
  }
  highlight();
  const hash = /^#s([0-9]+)$/u.exec(location.hash);
  if (hash) activate(Math.min(S.n, Number(hash[1])) - 1, true);
  else activate(0, true);
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", onScroll);
  addEventListener("load", () => { if (scrollY > 0) pick(); });
})();
</script>`;
}

// The sheet's two themes, scoped to its sections: the same tokens as the page.
function sheetThemeCss(): string {
  return `<style>
.sheetwrap { max-width: 430px; margin: 0 auto; padding: 16px; display: grid; gap: 24px; }
.sheetwrap section { display: grid; gap: 16px; border: 1px solid var(--rule); border-radius: 12px; padding: 16px; background: var(--bg); }
.sheetwrap h1 { font-family: var(--font-display); font-size: 19px; margin: 0; }
.sheetwrap h2 { font-family: var(--font-display); font-size: 15px; margin: 0; color: var(--muted); }
.sheetwrap figure { margin: 0; display: grid; gap: 8px; justify-items: center; }
.sheetwrap figcaption { font-size: 12.5px; color: var(--muted); text-align: center; }
.sheetwrap section[data-theme="light"] {
  --bg: #f5f6f8; --panel: #ffffff; --ink: #1c2230; --muted: #5a6475; --rule: #dfe3ea;
  --accent: #1d5ca8; --accent-soft: #e5eefa; color-scheme: light;
}
.sheetwrap section[data-theme="dark"] {
  --bg: #12161d; --panel: #181d26; --ink: #e3e7ee; --muted: #9aa3b2; --rule: #2a313d;
  --accent: #8ab8f2; --accent-soft: #1d2b40; color-scheme: dark;
}
</style>`;
}

/** Every drawing in every state, at phone width in both themes, for the look. */
export function sheetHtml(p: PageParts, diagramCss: string[]): string {
  const drawings = p.usedScenes.filter((s): s is DiagramScene => s.kind === "diagram");
  const figures = (): string =>
    drawings
      .map((sc) => {
        const dg = p.diagrams.get(sc.id);
        if (!dg) throw new Error(`no scene ${sc.id}`);
        return sc.states
          .map((st) => {
            const svg = tagSvg(
              dg.original,
              `sheet-${sc.id}-${st}`,
              st,
              sc.caption ?? sc.label,
              sc.id,
            );
            return `<figure><figcaption>${esc(sc.label)} · ${esc(st)}</figcaption>${svg}</figure>`;
          })
          .join("\n");
      })
      .join("\n");
  const light = `<section data-theme="light"><h2>Light</h2>${figures()}</section>`;
  const dark = `<section data-theme="dark"><h2>Dark</h2>${figures()}</section>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Drawings for #${p.story.ticket}</title>
${pageStyle(diagramCss)}
${sheetThemeCss()}
</head>
<body>
<div class="sheetwrap">
<h1>Drawings for #${p.story.ticket}</h1>
${light}
${dark}
</div>
</body>
</html>
`;
}

// ---------- edges ----------

function git(repo: string, args: string[]): string {
  const r = run("git", args, { cwd: repo });
  if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.err.trim() || `exit ${r.code}`}`);
  return r.out;
}

/** A blob's bytes, or null when the path is not there at the revision. */
function catSize(repo: string, rev: string, path: string): number | null {
  try {
    const n = Number(git(repo, ["cat-file", "-s", `${rev}:${path}`]).trim());
    return Number.isInteger(n) ? n : null;
  } catch {
    return null;
  }
}

function gh(repo: string, kind: string, number: number): { title: string; body: string } {
  const r = run("gh", [kind, "view", String(number), "--json", "title,body"], { cwd: repo });
  if (r.code !== 0)
    throw new Error(`gh ${kind} view ${number}: ${r.err.trim() || `exit ${r.code}`}`);
  const meta = JSON.parse(r.out) as { title?: unknown; body?: unknown };
  if (typeof meta.title !== "string" || typeof meta.body !== "string") {
    throw new Error(`gh ${kind} view ${number}: no title and body`);
  }
  return { title: meta.title, body: meta.body };
}

function ticketFileBody(file: string): { title: string; body: string } {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    throw new Error(`no ticket body file ${file}`);
  }
  let meta: unknown;
  try {
    meta = JSON.parse(text) as unknown;
  } catch {
    throw new Error(`ticket body ${file} is not {title, body} JSON`);
  }
  if (!isRecord(meta) || typeof meta.title !== "string" || typeof meta.body !== "string") {
    throw new Error(`ticket body ${file} is not {title, body} JSON`);
  }
  return { title: meta.title, body: meta.body };
}

/** The picture's kind from its magic bytes, refused when it is no image. */
export function mimeOf(bytes: Uint8Array): "image/png" | "image/jpeg" | "image/webp" {
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  throw new Error("the picture adapter wrote no PNG, JPEG or WebP image");
}

function drawPicture(
  adapter: string[],
  promptFile: string,
  styleFile: string,
  outFile: string,
): void {
  const r = run(adapter[0], [
    ...adapter.slice(1),
    "--prompt",
    promptFile,
    "--style",
    styleFile,
    "--out",
    outFile,
  ]);
  if (r.code === 127)
    throw new Error(`no picture adapter available: ${adapter[0]}: command not found`);
  if (r.code !== 0) throw new Error(`picture adapter failed: ${r.err.trim() || `exit ${r.code}`}`);
  if (!existsSync(outFile)) throw new Error("picture adapter failed: it wrote no picture");
}

// ---------- pure core: the build record ----------

/** The record of a build, beside the page it describes. */
export const BUILD_RECORD = "build.json";

export interface BuildRecord {
  version: 1;
  /** The title the story was built from; the picture was drawn for it. */
  title: string;
  /** The draft's digest, as draftDigest computed it at the build. */
  draft: string;
  /** The picture file each image scene wrote, by scene id. */
  pictures: Record<string, string>;
  /** A change story's branch, head and merge base, resolved at the build. */
  branch?: string;
  head?: string;
  base?: string;
}

/** The draft as one digest: the title and body in a fixed shape. */
export function draftDigest(title: string, body: string): string {
  return createHash("sha256").update(JSON.stringify({ title, body })).digest("hex");
}

/** Read a build record, or null when it is missing, broken or from another shape. */
export function parseBuildRecord(text: string): BuildRecord | null {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  if (value.version !== 1) return null;
  if (typeof value.title !== "string" || typeof value.draft !== "string") return null;
  if (!isRecord(value.pictures)) return null;
  for (const v of Object.values(value.pictures)) {
    if (typeof v !== "string" || v === "") return null;
  }
  const record: BuildRecord = {
    version: 1,
    title: value.title,
    draft: value.draft,
    pictures: { ...(value.pictures as Record<string, string>) },
  };
  const branch = value.branch;
  const head = value.head;
  const base = value.base;
  if (branch !== undefined || head !== undefined || base !== undefined) {
    if (typeof branch !== "string" || typeof head !== "string" || typeof base !== "string") {
      return null;
    }
    record.branch = branch;
    record.head = head;
    record.base = base;
  }
  return record;
}

/**
 * Why the built story is out of date, or null when it was made from the
 * draft as it stands: a missing or unreadable record, a missing page, a
 * changed title, or a changed draft, in that order.
 */
export function staleReason(args: {
  record: BuildRecord | null;
  recordPresent: boolean;
  pagePresent: boolean;
  title: string;
  digest: string;
  outDir: string;
}): string | null {
  if (!args.recordPresent) return `no build recorded in ${args.outDir}`;
  if (!args.record) return "the build record cannot be read";
  if (!args.pagePresent) return `no page built in ${args.outDir}`;
  if (args.title !== args.record.title) return "the title changed";
  if (args.digest !== args.record.draft) return "the draft changed";
  return null;
}

/**
 * The kept picture file to reuse for a scene, or null when there is none:
 * no record, another title, or no file for the scene. Reading the bytes
 * stays at the edge; a kept file that will not read is drawn anew.
 */
export function keptPicture(
  record: BuildRecord | null,
  title: string,
  sceneId: string,
): string | null {
  if (!record || record.title !== title) return null;
  const file = record.pictures[sceneId];
  if (file === undefined || file.includes("/") || file.includes("\\")) return null;
  return file;
}

export interface BuildOptions {
  repo: string;
  storyDir: string;
  outDir: string;
  ticketBodyFile?: string;
  pictureAdapter?: string;
  keepPicture?: boolean;
}

/**
 * Build the story: every refusal comes before any slow call, and nothing is
 * written unless the page, the sheet and the picture are all ready.
 */
export function build(o: BuildOptions): string {
  let storyText: string;
  try {
    storyText = readFileSync(join(o.storyDir, "story.json"), "utf8");
  } catch {
    throw new Error(`no story file ${join(o.storyDir, "story.json")}`);
  }
  const parsed = parseStory(storyText);
  const { story, removed: storyRemoved } = scrubStory(parsed);
  checkDrawings(story);
  const scenes = new Map(story.scenes.map((s) => [s.id, s]));
  const usedScenes = story.scenes.filter((s) => story.steps.some((st) => st.scene === s.id));
  const change = isChangeStory(story);

  let atSha = "";
  let headSha = "";
  let mbSha = "";
  let branch = "";
  if (change) {
    branch = story.head ?? "";
    headSha = git(o.repo, ["rev-parse", story.head ?? ""]).trim();
    mbSha = git(o.repo, ["merge-base", story.base ?? "", story.head ?? ""]).trim();
  } else {
    atSha = git(o.repo, ["rev-parse", story.at ?? ""]).trim();
  }
  const atShort = atSha.slice(0, 7);
  const headShort = headSha.slice(0, 7);

  const fileBody = o.ticketBodyFile ? ticketFileBody(o.ticketBodyFile) : null;
  const ghCache = new Map<string, { title: string; body: string }>();
  const metaOf = (kind: string, number: number): { title: string; body: string } => {
    if (fileBody && kind === "issue" && number === story.ticket) return fileBody;
    const key = `${kind}/${number}`;
    let meta = ghCache.get(key);
    if (!meta) {
      meta = gh(o.repo, kind, number);
      ghCache.set(key, meta);
    }
    return meta;
  };

  // Code at a revision, scrubbed before anything is shown.
  let removed = storyRemoved;
  const fileCache = new Map<string, string[]>();
  const fileLinesAt = (rev: string, short: string, path: string): string[] => {
    const k = `${rev}:${path}`;
    let lines = fileCache.get(k);
    if (!lines) {
      let text: string;
      try {
        text = git(o.repo, ["show", k]);
      } catch {
        throw new Error(`${path} is not in the repository at ${short}`);
      }
      const clean = scrub(text);
      removed += clean.removed;
      lines = clean.text.split("\n");
      if (lines.at(-1) === "") lines.pop();
      fileCache.set(k, lines);
    }
    return lines;
  };
  const fileLines = (path: string): string[] => fileLinesAt(atSha, atShort, path);

  const docs = new Map<string, Doc>();
  for (const sc of usedScenes) {
    if (sc.kind !== "doc") continue;
    const meta = metaOf(sc.from, sc.number);
    const title = scrub(meta.title);
    removed += title.removed;
    const body = scrub(meta.body);
    removed += body.removed;
    docs.set(sc.id, renderDoc(cutDoc(body.text, sc.id, sc.start, sc.cut), sc.label, title.text));
  }
  const mds = new Map<string, { html: string; spans: Range[] }>();
  for (const sc of usedScenes) {
    if (sc.kind !== "md") continue;
    const all = fileLines(sc.file);
    if (startsInFence(all, sc.from)) {
      throw new Error(`scene ${sc.id}: its range starts inside a fenced block of ${sc.file}`);
    }
    mds.set(sc.id, renderMd(all.slice(sc.from - 1, Math.min(sc.to, all.length)), sc.from));
  }

  const rowsOf = new Map<string, Row[]>();
  for (const sc of usedScenes) {
    if (sc.kind !== "ref") continue;
    rowsOf.set(sc.id, refRows(sc.file, sc.from, sc.to, fileLines(sc.file)));
  }
  const ownBody = metaOf("issue", story.ticket);
  // What the story must cover: the ticket's cited lines for a ticket story,
  // the diff's lines and files for a change.
  let cited: string[] = [];
  let named: { path: string; url: string }[] = [];
  let gaps: Gap[] = [];
  let gapRowsList: Row[][] = [];
  let left = 0;
  let changeParts: ChangeParts | undefined;
  const changeRowsOf = new Map<string, ChangeRow[]>();
  let changes = new Map<string, ChangeFile>();
  if (change) {
    checkCriterionSections(story, ownBody.body);
    const diffText = git(o.repo, [
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--no-textconv",
      "-U0",
      "-M",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      mbSha,
      headSha,
    ]);
    changes = parseChangeDiff(diffText);
    const scrubbed = scrubChangeDels(changes);
    changes = scrubbed.files;
    removed += scrubbed.removed;
    for (const sc of usedScenes) {
      if (sc.kind !== "head" && sc.kind !== "base") continue;
      const cf = changeForFile(changes, sc.file);
      if (cf?.binary) {
        throw new Error(
          `scene ${sc.id}: ${sc.file} is a binary file, and binary files are named in the closing list`,
        );
      }
      if (cf?.submodule) {
        throw new Error(
          `scene ${sc.id}: ${sc.file} is a submodule, and submodules are named in the closing list`,
        );
      }
      if (sc.kind === "head") {
        if (cf?.status === "removed") {
          throw new Error(
            `scene ${sc.id}: ${sc.file} was removed by this change; show it with kind "base"`,
          );
        }
        changeRowsOf.set(
          sc.id,
          headRows(sc.file, sc.from, sc.to, fileLinesAt(headSha, headShort, sc.file), cf),
        );
      } else {
        if (cf?.status === "added") {
          throw new Error(
            `scene ${sc.id}: ${sc.file} was added by this change; show it with kind "head"`,
          );
        }
        changeRowsOf.set(
          sc.id,
          baseRows(sc.file, sc.from, sc.to, fileLinesAt(mbSha, mbSha.slice(0, 7), sc.file), cf),
        );
      }
    }
    cited = changedKeys(changes);
    const shown = new Set<string>();
    for (const rows of changeRowsOf.values()) {
      for (const r of rows) if (r.key !== null) shown.add(r.key);
    }
    const changeGaps = computeChangeGaps(cited, shown);
    const changeGapRowsList = changeGaps.map((g) => {
      const cf = changes.get(g.file);
      const head = cf?.status === "removed" ? [] : fileLinesAt(headSha, headShort, g.file);
      return changeGapRows(g, head, cf);
    });
    // Every changed line must be on a step's rows or on the rows the last
    // scene lists: checked on the rows the page renders, not on the
    // arithmetic above.
    const listed = new Set<string>();
    for (const rows of changeGapRowsList) {
      for (const r of rows) if (r.key !== null) listed.add(r.key);
    }
    const missing = cited.filter((k) => !shown.has(k) && !listed.has(k));
    if (missing.length)
      throw new Error(`changed lines on no step and in no list: ${missing.join(", ")}`);
    left = cited.filter((k) => !shown.has(k)).length;
    const uncovered = filesNeedingNames(changes).filter(
      (f) => !fileShownOnStep(f, scenes, story.steps),
    );
    const entries: FileNameEntry[] = [];
    for (const f of uncovered) {
      const baseBytes =
        f.binary && f.status !== "added" ? catSize(o.repo, mbSha, f.oldPath ?? f.path) : null;
      const headBytes =
        f.binary && f.status !== "removed" ? catSize(o.repo, headSha, f.path) : null;
      entries.push(fileNameEntry(f, baseBytes, headBytes));
    }
    if (
      (left || uncovered.length) &&
      !story.steps.some((s) => scenes.get(s.scene)?.kind === "leftovers")
    ) {
      const what =
        left && uncovered.length
          ? `${left} changed lines and ${uncovered.length} files`
          : left
            ? `${left} changed lines`
            : `${uncovered.length} files`;
      throw new Error(`${what} are on no step, and no step shows the list of them`);
    }
    changeParts = {
      branch,
      head: headSha,
      mb: mbSha,
      rowsOf: changeRowsOf,
      gaps: changeGaps,
      gapRows: changeGapRowsList,
      files: entries,
    };
  } else {
    const parsed = parseCited(ownBody.body, atSha, repoOf(story.repoUrl));
    cited = parsed.cited;
    named = parsed.named;
    const shown = new Set<string>();
    for (const rows of rowsOf.values()) for (const r of rows) shown.add(r.key);
    for (const sc of usedScenes) {
      if (sc.kind !== "md") continue;
      const total = fileLines(sc.file).length;
      for (let n = sc.from; n <= Math.min(sc.to, total); n++) shown.add(`${sc.file}@${n}`);
    }
    gaps = computeGaps(cited, shown);
    gapRowsList = gaps.map((g) => gapRows(g, fileLines(g.file)));
    // Every cited line must be on a step's rows or on the rows the last scene
    // lists: checked on the rows the page renders, not on the arithmetic above.
    const listed = new Set<string>();
    for (const rows of gapRowsList) for (const r of rows) listed.add(r.key);
    const missing = cited.filter((k) => !shown.has(k) && !listed.has(k));
    if (missing.length)
      throw new Error(`cited lines on no step and in no list: ${missing.join(", ")}`);
    left = cited.filter((k) => !shown.has(k)).length;
    if (left && !story.steps.some((s) => scenes.get(s.scene)?.kind === "leftovers")) {
      throw new Error(`${left} cited lines are on no step, and no step shows the list of them`);
    }
  }

  const steps = change
    ? buildSteps(story, scenes, docs, mds, rowsOf, headShort, changeRowsOf, changes)
    : buildSteps(story, scenes, docs, mds, rowsOf, atShort);

  const diagrams = new Map<string, DiagramReady>();
  const diagramCss: string[] = [];
  for (const sc of usedScenes) {
    if (sc.kind !== "diagram") continue;
    let svgText: string;
    try {
      svgText = readFileSync(join(o.storyDir, sc.svg), "utf8");
    } catch {
      throw new Error(`scene ${sc.id}: no diagram file ${sc.svg}`);
    }
    const firstState = story.steps.find((st) => st.scene === sc.id)?.state ?? sc.states[0] ?? "";
    const ready = prepareDiagram(svgText, sc, firstState);
    diagrams.set(sc.id, ready);
    diagramCss.push(...ready.css);
  }

  const pictures = new Map<string, Picture>();
  const overlays = new Map<string, string>();
  const adapter = o.pictureAdapter
    ? [o.pictureAdapter]
    : [join(import.meta.dir, "run"), "story-picture"];
  const styleFile = join(dirname(import.meta.dir), "docs/poster.jpg");
  const imageScenes = usedScenes.filter((s): s is ImageScene => s.kind === "image");
  if (imageScenes.length > 0 && !existsSync(styleFile)) {
    throw new Error(`no style file ${styleFile}`);
  }
  let previous: BuildRecord | null = null;
  if (o.keepPicture === true) {
    try {
      previous = parseBuildRecord(readFileSync(join(o.outDir, BUILD_RECORD), "utf8"));
    } catch {
      previous = null;
    }
  }
  const scratch = mkdtempSync(join(tmpdir(), "story-page-"));
  try {
    for (const sc of imageScenes) {
      const promptFile = join(o.storyDir, sc.prompt);
      if (!existsSync(promptFile)) throw new Error(`scene ${sc.id}: no prompt file ${sc.prompt}`);
      const kept = o.keepPicture === true ? keptPicture(previous, ownBody.title, sc.id) : null;
      let reused = false;
      if (kept !== null) {
        try {
          const bytes = readFileSync(join(o.outDir, kept));
          pictures.set(sc.id, { mime: mimeOf(bytes), b64: bytes.toString("base64") });
          reused = true;
        } catch {
          reused = false;
        }
      }
      if (!reused) {
        const outFile = join(scratch, `${sc.id}.picture`);
        drawPicture(adapter, promptFile, resolve(styleFile), outFile);
        const bytes = readFileSync(outFile);
        const mime = mimeOf(bytes);
        pictures.set(sc.id, { mime, b64: bytes.toString("base64") });
      }
      if (sc.overlay) {
        try {
          overlays.set(sc.id, readFileSync(join(o.storyDir, sc.overlay), "utf8").trim());
        } catch {
          throw new Error(`scene ${sc.id}: no overlay file ${sc.overlay}`);
        }
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  const parts: PageParts = {
    story,
    atShort,
    ticketSource: o.ticketBodyFile ? "in the story's ticket file" : "on GitHub",
    steps,
    usedScenes,
    docs,
    mds,
    rowsOf,
    gaps,
    gapRows: gapRowsList,
    named,
    changed: cited.length,
    left,
    shown: cited.length - left,
    diagrams,
    pictures,
    overlays,
    change: changeParts,
  };
  const page = pageHtml(parts, diagramCss);
  const sheet = sheetHtml(parts, diagramCss);
  mkdirSync(o.outDir, { recursive: true });
  writeFileSync(join(o.outDir, "index.html"), page);
  writeFileSync(join(o.outDir, "sheet.html"), sheet);
  let pictureBytes = 0;
  const pictureFiles: Record<string, string> = {};
  for (const [id, pic] of pictures) {
    const ext = pic.mime === "image/png" ? "png" : pic.mime === "image/jpeg" ? "jpg" : "webp";
    const name = id === "hero" ? `picture.${ext}` : `picture-${id}.${ext}`;
    const bytes = Buffer.from(pic.b64, "base64");
    writeFileSync(join(o.outDir, name), bytes);
    pictureFiles[id] = name;
    pictureBytes += bytes.length;
  }
  const record: BuildRecord = {
    version: 1,
    title: ownBody.title,
    draft: draftDigest(ownBody.title, ownBody.body),
    pictures: pictureFiles,
  };
  if (change) {
    record.branch = branch;
    record.head = headSha;
    record.base = mbSha;
  }
  writeFileSync(join(o.outDir, BUILD_RECORD), `${JSON.stringify(record)}\n`);
  const bySection = story.sections
    .map((s) => `${s.label} ${story.steps.filter((x) => x.section === s.id).length}`)
    .join(", ");
  if (change) {
    const groups = changeParts?.gaps.length ?? 0;
    const files = changeParts?.files.length ?? 0;
    return `change story of #${story.ticket} on ${branch}: ${steps.length} steps (${bySection}), ${usedScenes.length} scenes, ${cited.length} changed lines, ${cited.length - left} on steps, ${left} listed (${groups} groups, ${files} files), page ${Buffer.byteLength(page)} bytes, sheet ${Buffer.byteLength(sheet)} bytes, picture ${pictureBytes} bytes, ${removed} address(es) removed`;
  }
  return `story of #${story.ticket}: ${steps.length} steps (${bySection}), ${usedScenes.length} scenes, ${cited.length} cited lines, ${cited.length - left} on steps, ${left} listed (${gaps.length} groups), page ${Buffer.byteLength(page)} bytes, sheet ${Buffer.byteLength(sheet)} bytes, picture ${pictureBytes} bytes, ${removed} address(es) removed`;
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

/**
 * Whether the built story was made from the draft as it stands: for a
 * change story, also whether the branch still stands at the recorded head.
 */
export function checkCommand(outDir: string, ticketBodyFile: string, repo?: string): number {
  const meta = ticketFileBody(ticketBodyFile);
  const recordFile = join(outDir, BUILD_RECORD);
  const recordPresent = existsSync(recordFile);
  let record: BuildRecord | null = null;
  if (recordPresent) {
    try {
      record = parseBuildRecord(readFileSync(recordFile, "utf8"));
    } catch {
      record = null;
    }
  }
  const reason = staleReason({
    record,
    recordPresent,
    pagePresent: existsSync(join(outDir, "index.html")),
    title: meta.title,
    digest: draftDigest(meta.title, meta.body),
    outDir,
  });
  if (reason !== null) {
    console.log(`out of date: ${reason}`);
    return 2;
  }
  if (record?.head !== undefined) {
    if (repo === undefined) {
      throw new Error(`a change story's check needs --repo <repo> to resolve ${record.branch}`);
    }
    const current = git(repo, ["rev-parse", record.branch ?? ""]).trim();
    if (current !== record.head) {
      console.log(`out of date: the branch ${record.branch} moved`);
      return 2;
    }
  }
  console.log("current: the story was built from this draft");
  return 0;
}

export function main(args: string[]): number {
  const [cmd, ...rest] = args;
  try {
    if (cmd === "build") {
      let ticketBodyFile: string | undefined;
      let pictureAdapter: string | undefined;
      let keepPicture = false;
      const positional: string[] = [];
      for (let i = 0; i < rest.length; i++) {
        const a = rest[i] ?? "";
        if (a === "--ticket-body" || a === "--picture-adapter") {
          const v = rest[i + 1];
          if (!v) throw new Error(USAGE);
          if (a === "--ticket-body") ticketBodyFile = v;
          else pictureAdapter = v;
          i++;
        } else if (a === "--keep-picture") {
          keepPicture = true;
        } else if (a.startsWith("--")) {
          throw new Error(USAGE);
        } else {
          positional.push(a);
        }
      }
      const [repo, storyDir, outDir] = positional;
      if (!repo || !storyDir || !outDir || positional.length !== 3) throw new Error(USAGE);
      console.log(build({ repo, storyDir, outDir, ticketBodyFile, pictureAdapter, keepPicture }));
      return 0;
    }
    if (cmd === "check") {
      let ticketBodyFile: string | undefined;
      let repo: string | undefined;
      const positional: string[] = [];
      for (let i = 0; i < rest.length; i++) {
        const a = rest[i] ?? "";
        if (a === "--ticket-body" || a === "--repo") {
          const v = rest[i + 1];
          if (!v) throw new Error(USAGE);
          if (a === "--ticket-body") ticketBodyFile = v;
          else repo = v;
          i++;
        } else if (a.startsWith("--")) {
          throw new Error(USAGE);
        } else {
          positional.push(a);
        }
      }
      const [outDir] = positional;
      if (!outDir || !ticketBodyFile || positional.length !== 1) throw new Error(USAGE);
      return checkCommand(outDir, ticketBodyFile, repo);
    }
    if (cmd === "pick-step") {
      const viewport = flag(rest, "--viewport");
      const boxes = flag(rest, "--boxes");
      if (!viewport || !boxes) throw new Error(USAGE);
      const v = parseViewport(viewport);
      console.log(String(pickStep(parseBoxes(boxes), v.h, v.narrow)));
      return 0;
    }
    console.error(USAGE);
    return 1;
  } catch (e) {
    console.error(`story-page: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
