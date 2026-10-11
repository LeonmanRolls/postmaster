// Build a scrollytelling page for one merged change. The whole page is one scroll: a story file
// names the sections (an opening, one per acceptance criterion, and what is left out), the steps
// in each, and the scene each step puts in the panel beside it: the ticket or the pull request's
// text with the part it tells lit, a diagram in one of its states, or the code with the lines it
// talks about lit. The code comes from git, so every row is the change as it was; changed lines no
// step shows are listed in the last scene, so nothing is hidden.
//
//   bun --no-env-file --config=/dev/null build.ts <repo> <story-dir> <out-dir> [--drop <step-id>]
//
// Reads <story-dir>/story.json and the files it names. Writes <out-dir>/index.html (the artifact),
// <out-dir>/preview-light.html and <out-dir>/preview-dark.html (the page in a local skeleton) and
// prints the coverage. --drop leaves one step out: the control for the coverage check.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Range = [number, number];
type CodeScene = { id: string; kind: "head" | "base" | "ref"; file: string; from: number; to: number };
type DocScene = { id: string; kind: "doc"; from: "issue" | "pr"; number: number; label: string; chip: string; cut?: string; start?: string };
type DiagramScene = { id: string; kind: "diagram"; label: string; chip: string; svg: string; states: string[]; caption?: string };
type LeftScene = { id: string; kind: "leftovers"; label: string; chip: string };
type MdScene = { id: string; kind: "md"; file: string; from: number; to: number };
type ImageScene = {
  id: string;
  kind: "image";
  label: string;
  chip: string;
  src: string;
  alt: string;
  overlay?: string;
  banner?: string;
  subtitle?: string;
};
type Scene = CodeScene | DocScene | DiagramScene | LeftScene | MdScene | ImageScene;
type Step = {
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
};
type Story = {
  title?: string;
  repoUrl: string;
  mode?: "change" | "ticket";
  pr?: number;
  ticket: number;
  base?: string;
  head?: string;
  merged?: string;
  at?: string;
  status?: string;
  sections: { id: string; label: string; title: string }[];
  scenes: Scene[];
  steps: Step[];
};
type Row = { type: "add" | "del" | "ctx" | "was"; n: number | null; text: string; key: string | null };

const args = process.argv.slice(2);
const dropAt = args.indexOf("--drop");
const drop = dropAt >= 0 ? args[dropAt + 1] : undefined;
const [repo, storyDir, outDir] = args.filter((_, i) => dropAt < 0 || (i !== dropAt && i !== dropAt + 1));
if (!repo || !storyDir || !outDir) throw new Error("usage: build.ts <repo> <story-dir> <out-dir> [--drop <step-id>]");
const story: Story = JSON.parse(readFileSync(join(storyDir, "story.json"), "utf8"));
if (drop) story.steps = story.steps.filter((s) => s.id !== drop);

function run(cmd: string, argv: string[]): string {
  const r = spawnSync(cmd, argv, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, cwd: repo });
  if (r.status !== 0) throw new Error(`${cmd} ${argv.join(" ")}: ${r.stderr}`);
  return r.stdout;
}
const git = (argv: string[]): string => run("git", argv);

// ---------- the change, from git ----------

// A change's story tells a diff; a ticket's story tells the code as it stands at the ticket's
// base commit, the one its notes were verified at.
const ticketMode = story.mode === "ticket";
const mergeBase = ticketMode ? "" : git(["merge-base", story.base!, story.head!]).trim();
const headSha = ticketMode ? "" : git(["rev-parse", story.head!]).trim();
const atSha = ticketMode ? git(["rev-parse", story.at!]).trim() : "";
const ticketMeta = ticketMode
  ? (JSON.parse(run("gh", ["issue", "view", String(story.ticket), "--json", "title,body"])) as { title: string; body: string })
  : null;
type Del = { old: number; text: string };
type FileDiff = { path: string; status: string; added: Set<number>; removedOld: Set<number>; dels: Map<number, Del[]> };

function parseDiff(text: string): Map<string, FileDiff> {
  const files = new Map<string, FileDiff>();
  let cur: FileDiff | null = null;
  let oldNo = 0;
  let newNo = 0;
  let anchor = 0;
  let status = "changed";
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) {
      cur = null;
      status = "changed";
    } else if (line.startsWith("new file mode")) status = "new file";
    else if (line.startsWith("deleted file mode")) status = "removed";
    else if (line.startsWith("--- ")) continue;
    else if (line.startsWith("+++ ")) {
      const p = line.slice(4);
      const path = p === "/dev/null" ? "" : p.replace(/^b\//u, "");
      cur = { path, status, added: new Set(), removedOld: new Set(), dels: new Map() };
      if (path) files.set(path, cur);
    } else if (line.startsWith("@@ ") && cur) {
      const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u.exec(line);
      if (!m) throw new Error(`bad hunk header: ${line}`);
      oldNo = Number(m[1]);
      newNo = Number(m[3]);
      const newCount = m[4] === undefined ? 1 : Number(m[4]);
      // With no context, a hunk's removed lines sit before its first added line, or, when it
      // adds none, after new line c.
      anchor = newCount === 0 ? newNo + 1 : newNo;
    } else if (cur && line.startsWith("-")) {
      const list = cur.dels.get(anchor) ?? [];
      list.push({ old: oldNo, text: line.slice(1) });
      cur.dels.set(anchor, list);
      cur.removedOld.add(oldNo);
      oldNo += 1;
    } else if (cur && line.startsWith("+")) {
      cur.added.add(newNo);
      newNo += 1;
    }
  }
  return files;
}

const diff = ticketMode ? new Map<string, FileDiff>() : parseDiff(git(["diff", "--no-color", "--no-ext-diff", "-U0", mergeBase, headSha]));
const fileCache = new Map<string, string[]>();
function fileLines(rev: string, path: string): string[] {
  const k = `${rev}:${path}`;
  let lines = fileCache.get(k);
  if (!lines) {
    lines = git(["show", k]).split("\n");
    if (lines.at(-1) === "") lines.pop();
    fileCache.set(k, lines);
  }
  return lines;
}

function codeRows(sc: CodeScene): Row[] {
  const fd = diff.get(sc.file);
  const rows: Row[] = [];
  if (sc.kind === "ref") {
    const lines = fileLines(atSha, sc.file);
    for (let n = sc.from; n <= Math.min(sc.to, lines.length); n++)
      rows.push({ type: "ctx", n, text: lines[n - 1] ?? "", key: `${sc.file}@${n}` });
    return rows;
  }
  if (sc.kind === "base") {
    const lines = fileLines(mergeBase, sc.file);
    for (let n = sc.from; n <= Math.min(sc.to, lines.length); n++) {
      const was = fd?.removedOld.has(n) ?? false;
      rows.push({ type: was ? "was" : "ctx", n, text: lines[n - 1] ?? "", key: was ? `${sc.file}:-${n}` : null });
    }
    return rows;
  }
  const lines = fileLines(headSha, sc.file);
  const to = Math.min(sc.to, lines.length);
  const pushDels = (at: number): void => {
    for (const d of fd?.dels.get(at) ?? []) rows.push({ type: "del", n: null, text: d.text, key: `${sc.file}:-${d.old}` });
  };
  for (let n = sc.from; n <= to; n++) {
    pushDels(n);
    const add = fd?.added.has(n) ?? false;
    rows.push({ type: add ? "add" : "ctx", n, text: lines[n - 1] ?? "", key: add ? `${sc.file}:+${n}` : null });
  }
  pushDels(to + 1);
  return rows;
}

// ---------- coverage: what the steps show, and what they leave out ----------

const scenes = new Map(story.scenes.map((s) => [s.id, s]));
const isCode = (s: Scene): s is CodeScene => s.kind === "head" || s.kind === "base" || s.kind === "ref";
const usedScenes = story.scenes.filter((s) => story.steps.some((st) => st.scene === s.id));
const rowsOf = new Map(usedScenes.filter(isCode).map((s) => [s.id, codeRows(s)]));
const changed: string[] = [];
const named: { path: string; url: string }[] = [];
for (const fd of diff.values()) {
  for (const n of [...fd.added].sort((a, b) => a - b)) changed.push(`${fd.path}:+${n}`);
  for (const n of [...fd.removedOld].sort((a, b) => a - b)) changed.push(`${fd.path}:-${n}`);
}
if (ticketMeta) {
  // The code a ticket cites: every link into the repository's files at a commit. A link with
  // lines names those lines; a link without names the whole file, listed but not counted.
  const cited = new Set<string>();
  const re = /https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/blob\/([0-9a-f]{7,40})\/([^\s)#]+)(?:#L(\d+)(?:-L(\d+))?)?/gu;
  for (const m of ticketMeta.body.matchAll(re)) {
    if (!atSha.startsWith(m[1]!)) throw new Error(`the ticket cites ${m[2]} at ${m[1]}, not at the story's commit ${atSha.slice(0, 7)}`);
    if (!m[3]) {
      if (!named.some((x) => x.path === m[2])) named.push({ path: m[2]!, url: m[0] });
      continue;
    }
    for (let n = Number(m[3]); n <= Number(m[4] ?? m[3]); n++) cited.add(`${m[2]}@${n}`);
  }
  changed.push(...[...cited].sort((a, b) => {
    const [pa, na] = a.split("@");
    const [pb, nb] = b.split("@");
    return pa === pb ? Number(na) - Number(nb) : pa! < pb! ? -1 : 1;
  }));
}
const shown = new Set<string>();
for (const rows of rowsOf.values()) for (const r of rows) if (r.key) shown.add(r.key);
for (const sc of usedScenes)
  if (sc.kind === "md") {
    const total = fileLines(atSha || headSha, sc.file).length;
    for (let n = sc.from; n <= Math.min(sc.to, total); n++) shown.add(`${sc.file}@${n}`);
  }
type Gap = { file: string; side: "+" | "-" | "@"; from: number; to: number };
const gaps: Gap[] = [];
for (const k of changed) {
  if (shown.has(k)) continue;
  const m = /^(.*):([+-])(\d+)$/u.exec(k) ?? /^(.*)(@)(\d+)$/u.exec(k)!;
  const g: Gap = { file: m[1]!, side: m[2] as "+" | "-" | "@", from: Number(m[3]), to: Number(m[3]) };
  const last = gaps.at(-1);
  if (last && last.file === g.file && last.side === g.side && last.to + 1 === g.from) last.to = g.from;
  else gaps.push(g);
}
const left = changed.filter((k) => !shown.has(k)).length;
function gapRows(g: Gap): Row[] {
  const fd = diff.get(g.file);
  const rows: Row[] = [];
  if (g.side === "@") {
    const lines = fileLines(atSha, g.file);
    for (let n = g.from; n <= g.to; n++) rows.push({ type: "ctx", n, text: lines[n - 1] ?? "", key: `${g.file}@${n}` });
  } else if (g.side === "+") {
    const lines = fileLines(headSha, g.file);
    for (let n = g.from; n <= g.to; n++) rows.push({ type: "add", n, text: lines[n - 1] ?? "", key: `${g.file}:+${n}` });
  } else {
    for (const list of fd?.dels.values() ?? [])
      for (const d of list) if (d.old >= g.from && d.old <= g.to) rows.push({ type: "del", n: null, text: d.text, key: `${g.file}:-${d.old}` });
  }
  return rows;
}
// Every changed line must be on a step's rows or on the rows the last scene lists: checked on
// the rows the page renders, not on the arithmetic above.
const listed = new Set<string>();
for (const g of gaps) for (const r of gapRows(g)) if (r.key) listed.add(r.key);
const missing = changed.filter((k) => !shown.has(k) && !listed.has(k));
if (missing.length) throw new Error(`changed lines on no step and in no list: ${missing.join(", ")}`);
if (left && !story.steps.some((s) => scenes.get(s.scene)?.kind === "leftovers"))
  throw new Error(`${left} changed lines are on no step, and no step shows the list of them`);

// ---------- text ----------

const esc = (s: string): string =>
  s.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;");
function inline(s: string): string {
  return esc(s)
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/gu, '<a href="$2">$1</a>')
    .replace(/`([^`]+)`/gu, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/gu, "<strong>$1</strong>");
}
const plainText = (s: string): string =>
  s.replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1").replace(/\*\*/gu, "").replace(/`/gu, "");

type Doc = { html: string; blocks: string[] };
// The subset of Markdown a ticket and a pull request use: headings, paragraphs, numbered and
// bulleted lists, links, code and bold. Each heading, paragraph and list item is one block a step
// can light.
function renderDoc(md: string, eyebrow: string, title: string): Doc {
  const blocks: string[] = [title];
  const out: string[] = [`<p class="deye">${esc(eyebrow)}</p><h2 class="b dtitle" data-b="0">${inline(title)}</h2>`];
  let para: string[] = [];
  let list: "ol" | "ul" | null = null;
  const block = (tag: string, text: string, cls = ""): string => {
    blocks.push(plainText(text));
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
      out.push(block(m[1] === "##" ? "h3" : "h4", m[2]!));
    } else if ((m = /^(\d+)\. (.*)$/u.exec(line)) || (m = /^- (.*)$/u.exec(line))) {
      flushPara();
      const want = /^\d+\. /u.test(line) ? "ol" : "ul";
      if (list !== want) {
        closeList();
        out.push(`<${want}>`);
        list = want;
      }
      out.push(block("li", want === "ol" ? m[2]! : m[1]!));
    } else if (list && /^\s+\S/u.test(raw)) {
      // A continuation line of a list item: fold it into the item.
      const last = out.pop()!;
      const b = blocks.length - 1;
      const text = `${blocks[b]} ${line.trim()}`;
      blocks.pop();
      out.push(block("li", text));
      void last;
    } else {
      closeList();
      para.push(line.trim());
    }
  }
  flushPara();
  closeList();
  return { html: out.join(""), blocks };
}

// A Markdown file of the repository, lines from..to, as formatted text. Each heading, paragraph,
// list item and code block is a block that knows the source lines it came from, so a step can
// light the blocks its cited lines fall in.
function renderMd(lines: string[], from: number): { html: string; spans: Range[] } {
  const out: string[] = [];
  const spans: Range[] = [];
  let para: { text: string[]; from: number; to: number } | null = null;
  let fence: { text: string[]; from: number } | null = null;
  const block = (tag: string, html: string, a: number, b: number, cls = ""): void => {
    spans.push([a, b]);
    out.push(`<${tag} class="b${cls}" data-b="${spans.length - 1}">${html}</${tag}>`);
  };
  const flush = (): void => {
    if (para) block("p", inline(para.text.join(" ")), para.from, para.to);
    para = null;
  };
  lines.forEach((raw, i) => {
    const n = from + i;
    const line = raw.replace(/\s+$/u, "");
    if (fence) {
      if (/^\s*```/u.test(line)) {
        block("pre", esc(fence.text.join("\n")), fence.from, n, " mdcode");
        fence = null;
      } else fence.text.push(raw);
      return;
    }
    let m: RegExpExecArray | null;
    if (/^\s*```/u.test(line)) {
      flush();
      fence = { text: [], from: n };
    } else if (!line.trim()) flush();
    else if ((m = /^(#{1,4}) (.*)$/u.exec(line))) {
      flush();
      block(m[1]!.length <= 2 ? "h3" : "h4", inline(m[2]!), n, n);
    } else if ((m = /^(\s*)(?:[-*]|\d+\.) (.*)$/u.exec(line))) {
      flush();
      const depth = Math.min(3, Math.floor(m[1]!.length / 2));
      block("p", inline(m[2]!), n, n, ` li d${depth}`);
    } else if (/^\s+\S/u.test(raw) && spans.length && out.at(-1)!.includes(" li d")) {
      // A continuation of the list item above it.
      const last = out.pop()!;
      const span = spans.at(-1)!;
      span[1] = n;
      out.push(last.replace(/<\/p>$/u, ` ${inline(line.trim())}</p>`));
    } else {
      if (!para) para = { text: [], from: n, to: n };
      para.text.push(line.trim());
      para.to = n;
    }
  });
  flush();
  return { html: out.join(""), spans };
}

function fetchDoc(sc: DocScene): Doc {
  const kind = sc.from === "issue" ? "issue" : "pr";
  const meta = JSON.parse(run("gh", [kind, "view", String(sc.number), "--json", "title,body"])) as { title: string; body: string };
  let body = meta.body;
  if (sc.start) {
    const at = body.indexOf(sc.start);
    if (at < 0) throw new Error(`${sc.id}: "${sc.start}" is not in the text`);
    body = body.slice(at);
  }
  if (sc.cut) {
    const at = body.indexOf(sc.cut);
    if (at < 0) throw new Error(`${sc.id}: "${sc.cut}" is not in the text`);
    body = body.slice(0, at);
  }
  const title = sc.from === "issue" ? meta.title : meta.title.replace(/^#\d+, /u, "");
  return renderDoc(body, sc.label, title);
}

// ---------- diagrams ----------

// A diagram is an SVG drawn for the story. It declares its states in the story file, and its
// marks name them: on-<state> shows an element only in that state, hl-<state> lights it,
// dim-<state> fades it, and data-shift-<state>="dx dy" on an element with an id moves it there.
// The page switches the SVG's data-state as the steps go; the CSS below does the rest.
const diagramScenes = usedScenes.filter((s): s is DiagramScene => s.kind === "diagram");
const diagramSvg = new Map<string, string>();
const diagramCss: string[] = [];
const diagramFaults: string[] = [];
for (const sc of diagramScenes) {
  let svg: string;
  try {
    svg = readFileSync(join(storyDir, sc.svg), "utf8").trim();
  } catch {
    diagramFaults.push(`scene ${sc.id}: no diagram file ${sc.svg}`);
    continue;
  }
  if (!sc.states?.length) diagramFaults.push(`scene ${sc.id}: names no states`);
  const classes = new Set<string>();
  for (const m of svg.matchAll(/class="([^"]*)"/gu)) for (const c of m[1]!.split(/\s+/u)) if (c) classes.add(c);
  const named = (prefix: string): string[] => [...classes].filter((c) => c.startsWith(prefix)).map((c) => c.slice(prefix.length));
  for (const prefix of ["on-", "hl-", "dim-"])
    for (const st of named(prefix)) if (!sc.states.includes(st)) diagramFaults.push(`scene ${sc.id}: ${prefix}${st} names no state of it`);
  const sel = `#dg-${sc.id}`;
  const on = named("on-");
  if (on.length) diagramCss.push(`${on.map((st) => `${sel} .on-${st}`).join(", ")} { opacity: 0; }`);
  for (const st of sc.states) {
    const at = `${sel}[data-state="${st}"]`;
    if (on.includes(st)) diagramCss.push(`${at} .on-${st} { opacity: 1; }`);
    if (named("hl-").includes(st))
      diagramCss.push(
        `${at} rect.hl-${st}, ${at} path.hl-${st}, ${at} circle.hl-${st} { stroke: var(--accent); stroke-width: 2.5px; fill: var(--accent-soft); }`,
        `${at} text.hl-${st} { fill: var(--accent); font-weight: 600; }`,
      );
    if (named("dim-").includes(st)) diagramCss.push(`${at} .dim-${st} { opacity: .3; }`);
  }
  const shifts = [...svg.matchAll(/data-shift-/gu)].length;
  const moved = [...svg.matchAll(/<[^>]*\bid="([^"]+)"[^>]*\bdata-shift-([\w-]+)="(-?[\d.]+) (-?[\d.]+)"/gu)];
  if (moved.length !== shifts) diagramFaults.push(`scene ${sc.id}: a data-shift is on an element with no id before it`);
  for (const m of moved) {
    if (!sc.states.includes(m[2]!)) diagramFaults.push(`scene ${sc.id}: data-shift-${m[2]} names no state of it`);
    diagramCss.push(`${sel}[data-state="${m[2]}"] #${m[1]} { transform: translate(${m[3]}px, ${m[4]}px); }`);
  }
  const first = story.steps.find((st) => st.scene === sc.id)?.state ?? sc.states[0] ?? "";
  diagramSvg.set(sc.id, svg.replace(/^<svg /u, `<svg id="dg-${esc(sc.id)}" data-state="${esc(first)}" `));
}
if (diagramFaults.length) throw new Error(`diagram faults:\n${diagramFaults.join("\n")}`);

// ---------- steps ----------

const docs = new Map(usedScenes.filter((s): s is DocScene => s.kind === "doc").map((s) => [s.id, fetchDoc(s)]));
const mds = new Map(
  usedScenes
    .filter((s): s is MdScene => s.kind === "md")
    .map((s) => {
      const all = fileLines(atSha || headSha, s.file);
      return [s.id, renderMd(all.slice(s.from - 1, Math.min(s.to, all.length)), s.from)] as const;
    }),
);
const inRanges = (n: number | null, ranges: Range[]): boolean => n !== null && ranges.some(([a, b]) => n >= a && n <= b);
const sectionIds = story.sections.map((s) => s.id);
const N = story.steps.length;
const fill = (t: string): string =>
  t.replace(/\{shown\}/gu, String(changed.length - left)).replace(/\{changed\}/gu, String(changed.length)).replace(/\{left\}/gu, String(left));

const stepData = story.steps.map((s, i) => {
  const sc = scenes.get(s.scene);
  if (!sc) throw new Error(`step ${s.id}: no scene ${s.scene}`);
  if (!sectionIds.includes(s.section)) throw new Error(`step ${s.id}: no section ${s.section}`);
  const base = { i, id: s.id, scene: sc.id, section: s.section, kind: isCode(sc) ? "code" : sc.kind === "md" ? "doc" : sc.kind };
  if (sc.kind === "md") {
    const md = mds.get(sc.id)!;
    const focus = s.focus ?? [];
    const lit = md.spans.flatMap(([a, b], j) => (focus.some(([x, y]) => a <= y && x <= b) ? [j] : []));
    if (focus.length && !lit.length) throw new Error(`step ${s.id}: its focus lights no block of ${sc.file}`);
    return { ...base, lit, marks: [], excerpt: false, label: sc.file, chip: `as it stands at ${(atSha || headSha).slice(0, 7)}`, lines: `lines ${sc.from}–${sc.to}` };
  }
  if (isCode(sc)) {
    const rows = rowsOf.get(sc.id)!;
    const focus = s.focus ?? [];
    const lit: number[] = [];
    rows.forEach((r, j) => {
      if (r.type === "del") {
        // A removed line is lit with the line that took its place, or with the line before it.
        const next = rows.slice(j + 1).find((x) => x.type !== "del");
        const prev = rows.slice(0, j).reverse().find((x) => x.type !== "del");
        if (inRanges(next?.n ?? null, focus) || inRanges(prev?.n ?? null, focus)) lit.push(j);
      } else if (inRanges(r.n, focus)) lit.push(j);
    });
    if (!lit.length) throw new Error(`step ${s.id}: its focus lights no row`);
    const marks = (s.marks ?? []).map((m) => {
      const row = rows.findIndex((r) => r.n === m.line && r.type !== "del");
      if (row < 0) throw new Error(`step ${s.id}: mark line ${m.line} is not in ${sc.id}`);
      for (const t of m.text) if (!rows[row]!.text.includes(t)) throw new Error(`step ${s.id}: "${t}" is not on line ${m.line}`);
      return { row, text: m.text };
    });
    const nums = rows.filter((r) => r.n !== null).map((r) => r.n!);
    const status = sc.kind === "ref" ? `as it stands at ${atSha.slice(0, 7)}` : sc.kind === "base" ? "before the change" : (diff.get(sc.file)?.status ?? "unchanged");
    return { ...base, lit, marks, label: sc.file, chip: status, lines: `lines ${Math.min(...nums)}–${Math.max(...nums)}` };
  }
  if (sc.kind === "doc") {
    const doc = docs.get(sc.id)!;
    const lit = (s.find ?? []).map((f) => {
      const hits = doc.blocks.flatMap((b, j) => (b.includes(f) ? [j] : []));
      if (hits.length !== 1) throw new Error(`step ${s.id}: "${f}" is in ${hits.length} blocks of ${sc.id}`);
      return hits[0]!;
    });
    return { ...base, lit, marks: [], excerpt: !!s.excerpt, label: sc.label, chip: sc.chip, lines: "" };
  }
  if (sc.kind === "diagram") {
    if (!s.state || !sc.states.includes(s.state)) throw new Error(`step ${s.id}: state ${s.state ?? "(none)"} is not one of ${sc.id}'s: ${sc.states.join(", ")}`);
    return { ...base, lit: [], marks: [], state: s.state, label: sc.label, chip: sc.chip, lines: "" };
  }
  return { ...base, lit: [], marks: [], label: sc.label, chip: sc.chip, lines: "" };
});

// ---------- HTML ----------

const lang = (path: string): string =>
  path.endsWith(".ts") ? "typescript" : path.endsWith(".sh") ? "bash" : path.endsWith(".md") ? "markdown" : "plaintext";
const sign = { add: "+", del: "−", ctx: " ", was: " " } as const;
function rowHtml(r: Row): string {
  const k = r.key ? ` data-k="${esc(r.key)}"` : "";
  const t = r.type === "was" ? ' title="Removed by this change"' : "";
  return `<div class="r ${r.type}"${k}${t}><span class="n">${r.n ?? ""}</span><span class="sg">${sign[r.type]}</span><span class="c">${esc(r.text)}</span></div>`;
}
const totals = { add: 0, del: 0 };
for (const fd of diff.values()) {
  totals.add += fd.added.size;
  totals.del += fd.removedOld.size;
}
const minutes = Math.max(3, Math.round(N * 0.33));
const ticketTitle = docs.get("ticket")?.blocks[0] ?? "";

const leftHead = ticketMode
  ? `<h2>Code the ticket points to</h2><p class="lsum">${changed.length - left} of the ${changed.length} lines the ticket cites are on the steps. ${left ? `The other ${left} are here. Tap one to read it.` : "None is left out."}</p>${named.length ? `<p class="lsum">It also names ${named.length === 1 ? "a whole file" : "whole files"}: ${named.map((x) => `<a href="${esc(x.url)}">${esc(x.path)}</a>`).join(", ")}.</p>` : ""}`
  : `<h2>What the steps leave out</h2><p class="lsum">${shown.size} of the ${changed.length} changed lines are on the steps. ${left ? `The other ${left} are here, file by file. Tap one to read it.` : "None is left out."}</p>`;
const leftHtml = `<div class="leftin">${leftHead}${gaps
  .map((g) => {
    const rows = gapRows(g);
    const what = g.side === "@" ? `lines ${g.from}${g.to > g.from ? `–${g.to}` : ""}` : g.side === "+" ? `added lines ${g.from}${g.to > g.from ? `–${g.to}` : ""}` : `removed lines ${g.from}${g.to > g.from ? `–${g.to}` : ""} of the old file`;
    return `<details class="gap"><summary><span class="gpath">${esc(g.file)}</span><span class="gwhat">${what} · ${rows.length} ${rows.length === 1 ? "line" : "lines"}</span></summary><div class="ex" data-lang="${lang(g.file)}"><div class="rows">${rows.map(rowHtml).join("")}</div></div></details>`;
  })
  .join("")}</div>`;

const scenesHtml = usedScenes
  .map((sc) => {
    const on = stepData[0]!.scene === sc.id;
    const open = `<div class="scene ${isCode(sc) ? "code ex" : sc.kind}${on ? " on" : ""}" data-id="${esc(sc.id)}"${isCode(sc) ? ` data-lang="${lang(sc.file)}"` : ""}${on ? "" : ' aria-hidden="true"'}>`;
    if (isCode(sc)) return `${open}<div class="rows">${rowsOf.get(sc.id)!.map(rowHtml).join("")}</div></div>`;
    if (sc.kind === "doc") return `${open}<div class="docin">${docs.get(sc.id)!.html}</div></div>`;
    if (sc.kind === "md") return `${open.replace('class="scene md', 'class="scene doc md')}<div class="docin mdin">${mds.get(sc.id)!.html}</div></div>`;
    if (sc.kind === "image") {
      // A picture in the poster's style, embedded whole, with an optional drawing laid over it.
      const ext = sc.src.split(".").at(-1)!.toLowerCase();
      const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
      const data = readFileSync(join(storyDir, sc.src)).toString("base64");
      const over = sc.overlay ? readFileSync(join(storyDir, sc.overlay), "utf8").trim() : "";
      return `${open}<div class="posterwrap"><figure class="poster">${sc.banner ? `<p class="ribbon">${esc(sc.banner)}</p>` : ""}<div class="art"><img src="data:${mime};base64,${data}" alt="${esc(sc.alt)}">${over}</div>${sc.subtitle ? `<p class="ribbon sub">${esc(sc.subtitle)}</p>` : ""}</figure></div></div>`;
    }
    if (sc.kind === "diagram") return `${open}<div class="diagin"><figure class="dgfig">${diagramSvg.get(sc.id)}${sc.caption ? `<figcaption>${inline(sc.caption)}</figcaption>` : ""}</figure></div></div>`;
    return `${open}${leftHtml}</div>`;
  })
  .join("\n");

const firstOf = new Map<string, number>();
story.steps.forEach((s, i) => {
  if (!firstOf.has(s.section)) firstOf.set(s.section, i);
});
const secsHtml = story.sections
  .filter((s) => firstOf.has(s.id))
  .map((s) => `<a href="#s${firstOf.get(s.id)! + 1}" data-sec="${esc(s.id)}"${s.id === story.steps[0]!.section ? ' aria-current="step"' : ""}>${esc(s.label)}</a>`)
  .join("");

const stepsHtml = story.steps
  .map((s, i) => {
    const sec = story.sections.find((x) => x.id === s.section)!;
    const chap = firstOf.get(s.section) === i ? `<p class="chap">${esc(sec.title)}</p>` : "";
    const num = `<p class="snum">Step ${i + 1} of ${N}</p>`;
    if (s.kind === "title" && ticketMode)
      return `<article class="step title${i === 0 ? " on" : ""}" id="s${i + 1}" data-i="${i}"><p class="eyebrow">Ticket #${story.ticket} · ${esc(story.status ?? "")}</p><h1 class="plate-h">${inline(s.title)}</h1><p class="txt">${inline(fill(s.text))}</p><p class="meta"><a href="${story.repoUrl}/issues/${story.ticket}">#${story.ticket}, ${inline(ticketTitle)}</a> · ${N} steps, about ${minutes} minutes</p><p class="hint">Scroll to begin.</p></article>`;
    if (s.kind === "title")
      return `<article class="step title${i === 0 ? " on" : ""}" id="s${i + 1}" data-i="${i}"><p class="eyebrow">Pull request ${story.pr} · merged ${esc(story.merged ?? "")}</p><h1><a href="${story.repoUrl}/issues/${story.ticket}">#${story.ticket}</a>, ${inline(ticketTitle)}</h1><p class="meta">${diff.size} files · <b>+${totals.add}</b> <i>−${totals.del}</i> · ${N} steps, about ${minutes} minutes · <a href="${story.repoUrl}/pull/${story.pr}">the pull request</a></p><h3>${inline(s.title)}</h3><p class="txt">${inline(fill(s.text))}</p><p class="hint">Scroll to begin.</p></article>`;
    return `<article class="step${s.kind === "criterion" ? " crit" : ""}${i === 0 ? " on" : ""}" id="s${i + 1}" data-i="${i}">${chap}${num}<h3>${inline(s.title)}</h3><p class="txt">${inline(fill(s.text))}</p></article>`;
  })
  .join("\n");

const first = stepData[0]!;
const page = `<title>${esc(story.title ?? `Story of #${story.ticket}`)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Alfa+Slab+One&family=IM+Fell+English:ital@0;1&family=DM+Serif+Display:ital@0;1&family=Red+Hat+Display:wght@600;700&family=Red+Hat+Mono:wght@400;500&family=Red+Hat+Text:wght@400;500;600&display=swap">
<style>
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
</style>

<div class="wrap">
  <section class="scrolly" id="story" aria-label="The change, step by step">
    <div class="stage">
      <nav class="secs" aria-label="Sections">${secsHtml}</nav>
      <div class="stagehead"><span class="slabel" id="slabel">${esc(first.label)}</span><span class="schip" id="schip">${esc(first.chip)}</span><span id="slines">${esc(first.lines)}</span><span class="scount" id="scount">Step 1 of ${N}</span></div>
      <div class="scenes">
${scenesHtml}
      </div>
    </div>
    <div class="steps">
${stepsHtml}
    </div>
  </section>
  <p class="foot">${ticketMode ? `Built from ticket #${story.ticket} as it reads on GitHub, and the code as it stands at ${esc(atSha.slice(0, 7))}.` : `Built from pull request ${story.pr}: the code at ${esc(headSha.slice(0, 7))} against ${esc(mergeBase.slice(0, 7))}, and the ticket and the pull request as they read on GitHub.`} This page is for reading. Comments and decisions go in your chat with the session.</p>
</div>

<script type="application/json" id="story-data">${JSON.stringify({ n: N, steps: stepData }).replace(/</gu, "\\u003c")}</script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/highlight.min.js"></script>
<script>
(() => {
  const S = JSON.parse(document.getElementById("story-data").textContent);
  const steps = [...document.querySelectorAll(".step")];
  const sceneEls = new Map([...document.querySelectorAll(".scene")].map((e) => [e.dataset.id, e]));
  const secLinks = [...document.querySelectorAll(".secs a")];
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const narrow = matchMedia("(max-width: 899.98px)");
  const $ = (id) => document.getElementById(id);
  const plain = new WeakMap();
  const colored = new WeakMap();
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // Highlight a block as one text, then split the result back into rows, closing and reopening
  // the spans that cross a line break, so a comment or string over several rows stays coloured.
  function splitLines(html) {
    const out = [];
    const open = [];
    let cur = "";
    const re = /(<span[^>]*>)|(<\\/span>)|(\\n)|([^<\\n]+)/g;
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
  const line = () => innerHeight * (narrow.matches ? 0.74 : 0.45);
  function pick() {
    const y = line();
    let best = -1, bestD = Infinity;
    steps.forEach((s, i) => {
      const r = s.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) return;
      const d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best >= 0) activate(best);
  }
  let ticking = false;
  const onScroll = () => { if (ticking) return; ticking = true; requestAnimationFrame(() => { ticking = false; pick(); }); };
  // Tapping a step brings it to the reading line, so the panel and the box agree.
  function bring(s) {
    const r = s.getBoundingClientRect();
    scrollTo({ top: scrollY + r.top + Math.min(r.height / 2, innerHeight * 0.15) - line(), behavior: reduce.matches ? "auto" : "smooth" });
    activate(Number(s.dataset.i));
  }
  for (const s of steps) {
    s.tabIndex = 0;
    s.addEventListener("click", (ev) => { if (!ev.target.closest("a")) bring(s); });
    s.addEventListener("focus", () => activate(Number(s.dataset.i)));
  }
  highlight();
  const hash = /^#s(\\d+)$/.exec(location.hash);
  if (hash) activate(Math.min(S.n, Number(hash[1])) - 1, true);
  else activate(0, true);
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", onScroll);
  addEventListener("load", () => { if (scrollY > 0) pick(); });
})();
</script>
`;

writeFileSync(join(outDir, "index.html"), page);
const skeleton = (theme: string): string =>
  `<!doctype html><html lang="en"${theme ? ` data-theme="${theme}"` : ""}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>:root{color-scheme:light;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}body{margin:0;font:14px system-ui;background:#fafafa}img{max-width:100%}[hidden]{display:none!important}</style></head><body>\n${page}</body></html>\n`;
writeFileSync(join(outDir, "preview-light.html"), skeleton("light"));
writeFileSync(join(outDir, "preview-dark.html"), skeleton("dark"));
const bySection = story.sections.map((s) => `${s.label} ${story.steps.filter((x) => x.section === s.id).length}`).join(", ");
console.log(
  `story of #${story.ticket}: ${N} steps (${bySection}), ${usedScenes.length} scenes, ${changed.length} changed lines, ${shown.size} on steps, ${left} listed (${gaps.length} groups), page ${Buffer.byteLength(page)} bytes${drop ? `, step ${drop} dropped` : ""}`,
);
