// Health-check the wiki, so its rules are run rather than remembered. Deterministic checks
// belong in a script; a check written as prose is re-derived, and mis-derived, on every pass.
//
//   wiki-lint.sh [<repo>]      default: the repo this script lives in
//
// Reports every fault and fixes none: a standing contradicting its own records means either
// the standing or the reading is wrong, and which is a judgement for a person.
//
// Besides front matter, standings, citations, links and orphans, it enforces
// the two page-content rules the schema states: no private-shaped filesystem
// path or host name, through the scrub, and no page line of forty characters
// or more repeating a line under raw/.
//
//   exit 0  clean
//   exit 1  faults found, one per line on stdout
//   exit 2  usage, no wiki to check, or a page scan that could not finish
import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { beside, toolRoot } from "./lib/paths.ts";
import { run } from "./lib/proc.ts";
import {
  DOT_ALL,
  PY_DOT,
  PY_M_END,
  PY_M_START,
  PY_S_CLASS,
  pySplitLines,
  pyTrim,
} from "./lib/text.ts";

const STANDINGS = new Set(["claimed", "supported", "mixed", "refuted", "settled"]);
const OWN_EVIDENCE = ["runs", "trials"]; // what this fleet did; papers and articles are not

export const FM_RE = new RegExp(
  `${PY_M_START}([a-z_]+):[${PY_S_CLASS}]*(${PY_DOT}*)${PY_M_END}`,
  "gu",
);
export const SOURCES_RE = new RegExp(`([a-z]+)/([^,\\]${PY_S_CLASS}]+)`, "gu");
export const CITE_RE = new RegExp(`\\[@([a-z]+)/([^\\]${PY_S_CLASS}]+)`, "gu");

function frontMatter(text: string): Record<string, string> | null {
  if (!text.startsWith("---")) return null;
  const end = text.indexOf("\n---", 3);
  if (end === -1) return null;
  const body = text.slice(3, end);
  const out: Record<string, string> = {};
  for (const m of body.matchAll(FM_RE)) {
    out[m[1] ?? ""] = m[2] ?? "";
  }
  return out;
}

function prose(text: string): string {
  // Notation is documented in backticks: `[@papers/<slug>]` is an example of a citation,
  // not one. Fenced blocks and inline code spans are examples, so they are not scanned.
  return text.replace(new RegExp(`\`\`\`${DOT_ALL}*?\`\`\``, "gu"), "").replace(/`[^`]*`/gu, "");
}

function dirExists(p: string): boolean {
  try {
    statSync(p).isDirectory();
    return true;
  } catch {
    return false;
  }
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function gitTop(cwd?: string): { ok: boolean; top: string } {
  const r = run("git", ["rev-parse", "--show-toplevel"], cwd === undefined ? {} : { cwd });
  if (r.code !== 0) return { ok: false, top: "" };
  return { ok: true, top: pyTrim(r.out) };
}

// text.ts: pySplitLines — the same boundaries, split incrementally so a raw
// file streams in chunks instead of loading.
const LINE_BOUNDARY = /\r\n|[\n\x0b\x0c\r\x1c\x1d\x1e\x85\u2028\u2029]/gu;

/** Split text into Python splitlines, holding a trailing \r for the next
 * chunk: it may yet join a \n. Complete lines plus the carry. */
export function splitChunk(text: string, eof: boolean): { lines: string[]; carry: string } {
  let body = text;
  let held = "";
  if (!eof && body.endsWith("\r")) {
    held = "\r";
    body = body.slice(0, -1);
  }
  const lines: string[] = [];
  let start = 0;
  for (const m of body.matchAll(LINE_BOUNDARY)) {
    lines.push(body.slice(start, m.index!));
    start = m.index! + m[0].length;
  }
  return { lines, carry: body.slice(start) + held };
}

/** Numbered lines of a file, streamed in 64 KiB chunks: memory is bounded by
 * the buffer plus the longest line, never the file. Numbers match whole-file
 * splitlines numbering. Strict decodes like a page read; tolerant like a raw
 * read. The open happens eagerly, so an unopenable file throws at the call. */
export function textLines(path: string, strict: boolean): Generator<[number, string], void, void> {
  const fd = openSync(path, "r");
  return (function* (): Generator<[number, string], void, void> {
    try {
      const decoder = new TextDecoder("utf-8", { fatal: strict, ignoreBOM: true });
      // The lib's TextDecoder typing lacks decode's documented second
      // argument; the runtime honors it, and the mid-character split test
      // fails loudly if it ever stops.
      const decodeChunk = decoder.decode.bind(decoder) as (
        input: Uint8Array,
        options: { stream: boolean },
      ) => string;
      const part = new Uint8Array(65536);
      let carry = "";
      let number = 0;
      for (;;) {
        const read = readSync(fd, part, 0, part.length, null);
        const eof = read < part.length;
        const text = carry + decodeChunk(part.subarray(0, read), { stream: !eof });
        const split = splitChunk(text, eof);
        carry = split.carry;
        for (const ln of split.lines) {
          number += 1;
          yield [number, ln] as [number, string];
        }
        if (eof) {
          if (carry !== "") {
            number += 1;
            yield [number, carry] as [number, string];
          }
          return;
        }
      }
    } finally {
      closeSync(fd);
    }
  })();
}

function rawFiles(raw: string): string[] {
  const out: string[] = [];
  (function walk(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const n of entries) {
      const p = join(dir, n);
      try {
        if (statSync(p).isDirectory()) walk(p);
        else if (statSync(p).isFile()) out.push(p);
      } catch {
        /* skip */
      }
    }
  })(raw);
  out.sort();
  return out;
}

// A scrub --files-inert finding: <path>:<line>: <kind>. ASCII digits: the
// scrub prints ASCII line numbers.
const SCAN_RE = new RegExp(`^(${PY_DOT}*):([0-9]+): ([^${PY_S_CLASS}]+)$`, "u");

function relPath(p: string, repo: string): string {
  return p === repo ? p : relative(repo, p);
}

/** lint <repo>; prints faults, returns 1 if any */
export function lint(repo: string): number {
  let repoR = repo;
  try {
    repoR = realpathSync(repo);
  } catch {
    repoR = resolve(repo);
  }
  const wiki = join(repoR, "wiki");
  const raw = join(repoR, "raw");
  if (!dirExists(wiki)) {
    console.log(`no wiki/ in ${repoR}`);
    return 2;
  }

  const faults: string[] = [];
  const fault = (p: string, msg: string): void => {
    faults.push(`${relPath(p, repoR)}: ${msg}`);
  };

  const pages: string[] = [];
  (function walk(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const n of entries) {
      const p = join(dir, n);
      try {
        if (statSync(p).isDirectory()) walk(p);
        else if (n.endsWith(".md")) pages.push(p);
      } catch {
        /* skip */
      }
    }
  })(wiki);
  pages.sort();

  const byStem = new Map<string, string>();
  for (const p of pages) {
    const stem = p.split("/").pop() ?? "";
    byStem.set(stem.replace(/\.md$/u, ""), p);
  }

  for (const p of pages) {
    const rawText = readFileSync(p, "utf8");
    const text = prose(rawText);
    const fm = frontMatter(rawText);
    if (fm === null) {
      fault(p, "no front matter");
      continue;
    }
    for (const key of ["title", "type", "updated"]) {
      if (!(key in fm)) fault(p, `front matter has no ${key}`);
    }

    if (fm.type === "concept") {
      const st = fm.standing;
      if (st === undefined) {
        fault(p, "concept with no standing");
      } else if (!STANDINGS.has(st)) {
        fault(p, `standing '${st}' is not one of ${[...STANDINGS].sort().join(", ")}`);
      }
      const sources: Array<[string, string]> = [];
      // parse sources like python's re.findall(r"([a-z]+)/([^,\]\s]+)", fm.get("sources",""))
      for (const m of (fm.sources ?? "").matchAll(SOURCES_RE)) {
        sources.push([m[1] ?? "", m[2] ?? ""]);
      }
      for (const [kind, ident] of sources) {
        if (!existsSync(join(raw, kind, ident))) {
          fault(p, `source ${kind}/${ident} in front matter does not resolve under raw/`);
        }
      }
      const own = sources.filter(([k]) => OWN_EVIDENCE.includes(k));
      const _stArr = st === undefined ? "" : st;
      if (st !== undefined && STANDINGS.has(st) && st !== "claimed" && own.length === 0) {
        fault(
          p,
          `standing ${st} rests on no run or trial; outside work alone cannot move a standing`,
        );
      } else if (st === "supported" && own.length < 3) {
        fault(p, `standing supported rests on ${own.length} run(s) or trial(s); three are needed`);
      }
    }

    // citations resolve to something under raw/
    for (const m of text.matchAll(CITE_RE)) {
      const kind = m[1] ?? "";
      const ident = (m[2] ?? "").replace(/[/.,;)]+$/u, "");
      if (!existsSync(join(raw, kind, ident))) {
        fault(p, `citation [@${kind}/${ident}] does not resolve under raw/`);
      }
    }

    // wikilinks resolve to a page
    for (const m of text.matchAll(/\[\[([^\]]+)\]\]/gu)) {
      if (!byStem.has(m[1] ?? "")) {
        fault(p, `wikilink [[${m[1] ?? ""}]] has no page`);
      }
    }

    // relative markdown links resolve
    for (const m of text.matchAll(/\]\(([^)#]+)\)/gu)) {
      const t = m[1] ?? "";
      if (t.startsWith("http://") || t.startsWith("https://") || t.startsWith("mailto:")) continue;
      if (!existsSync(join(p.split("/").slice(0, -1).join("/"), t))) {
        fault(p, `link to ${t} does not resolve`);
      }
    }
  }

  // schema.md's Writing rule, mechanically: no private-shaped path or host name.
  // The scrub is the shape authority, so only its private-path and private-host
  // kinds fault a page; documenting the rule's own examples stays possible. The
  // scrub needs a repository, so outside one this check degrades to nothing.
  // The checkout is the target's own, never the caller's: discovering it from
  // the caller's directory would skip the scan whenever the caller stands
  // outside a repository. A target that is not a checkout either keeps the
  // caller's discovery, for the fixtures the tests run from this repo.
  let top = gitTop(repoR);
  if (!top.ok) top = gitTop();
  if (pages.length > 0 && top.ok) {
    const scrub = process.env.WIKI_LINT_SCRUB ?? beside(import.meta, "scrub-check.sh");
    if (!scrub || !isFile(scrub)) {
      console.log("wiki-lint: no scrub to check pages with");
      return 2;
    }
    // Pages go to the scrub as repository-relative paths: absolute ones would
    // redact the checkout's own location out of every diagnostic.
    const relArgs: string[] = [];
    for (const page of pages) {
      const r = relative(top.top, page);
      relArgs.push(r === "" || r === ".." || r.startsWith("../") ? page : r);
    }
    // The lint logs only what it reports: the scan runs with the
    // detections log emptied, and each path or host fault is logged under
    // its page through --log-detection. Quoted raw/ lines are lint faults,
    // not detections, and are never logged.
    const child = run(scrub, ["--files-inert", ...relArgs], {
      cwd: top.top,
      env: { POSTMASTER_DETECTIONS_LOG: "" },
    });
    if (child.code !== 0 && child.code !== 1) {
      console.log("wiki-lint: the page scan could not finish");
      return 2;
    }
    for (const ln of pySplitLines(child.out)) {
      const m = SCAN_RE.exec(ln);
      if (m === null || (m[3] !== "private-path" && m[3] !== "private-host")) continue;
      const found = m[1] ?? "";
      const r = relative(repoR, resolve(top.top, found));
      const rel = r === "" || r === ".." || r.startsWith("../") ? found : r;
      faults.push(
        `${rel}: line ${m[2]}: ${m[3]} (schema.md: name a target by its repository name only)`,
      );
      const logged = run(scrub, ["--log-detection", m[3] ?? "", rel, m[2] ?? ""], {
        cwd: top.top,
      });
      if (logged.code !== 0) {
        console.log("wiki-lint: the detections log could not be written");
        return 2;
      }
    }
  }

  // Compile, do not transcribe: no page line of forty characters or more
  // repeats a line under raw/. Shorter spans are headings, citations and
  // front matter, not quotations. raw/ may hold binary evidence, so it is
  // decoded tolerantly; a wiki page that does not decode already fails above.
  //
  // Both sides stream. Page lines of forty characters or more are the only
  // ones that can quote, and pages are author-scale, so they are collected
  // first; then one batched pass over raw/ confirms them in file order,
  // stopping once every candidate has its first hit. Memory is bounded by
  // the pages plus the longest raw line, never the evidence.
  const wanted = new Map<string, Array<[string, number]>>();
  for (const p of pages) {
    for (const [number, ln] of textLines(p, true)) {
      if ([...ln].length >= 40) {
        const list = wanted.get(ln) ?? [];
        list.push([p, number]);
        wanted.set(ln, list);
      }
    }
  }
  const repeats: Array<[string, number, string, number]> = [];
  if (wanted.size > 0 && dirExists(raw)) {
    const pending = new Map(wanted);
    for (const f of rawFiles(raw)) {
      if (pending.size === 0) break;
      let lines: Generator<[number, string], void, void>;
      try {
        lines = textLines(f, false);
      } catch {
        continue;
      }
      for (const [number, ln] of lines) {
        if ([...ln].length >= 40 && !ln.includes("\0") && pending.has(ln)) {
          const hits = pending.get(ln)!;
          pending.delete(ln);
          for (const [p, pnumber] of hits) {
            repeats.push([p, pnumber, relative(repoR, f), number]);
          }
        }
        if (pending.size === 0) break;
      }
    }
  }
  repeats.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));
  if (repeats.length > 0) {
    // A raw filename or a page filename may itself carry a shaped value, so
    // both are redacted before they reach a diagnostic. Without a scrub
    // there is no safe way to name them, and the lint fails rather than
    // printing either raw.
    const scrub = process.env.WIKI_LINT_SCRUB ?? beside(import.meta, "scrub-check.sh");
    if (!scrub || !isFile(scrub)) {
      console.log("wiki-lint: no scrub to check pages with");
      return 2;
    }
    const distinct = [
      ...new Set([
        ...repeats.map((r) => r[2]),
        ...repeats.map((r) => relative(repoR, r[0])),
      ]),
    ];
    const red = run(scrub, ["--safe-path", ...distinct], top.ok ? { cwd: top.top } : {});
    if (red.code !== 0) {
      console.log("wiki-lint: the page scan could not finish");
      return 2;
    }
    const redLines = pySplitLines(red.out);
    if (redLines.length !== distinct.length) {
      console.log("wiki-lint: the page scan could not finish");
      return 2;
    }
    const redacted = new Map(distinct.map((d, i) => [d, redLines[i]!] as [string, string]));
    for (const [p, number, rawrel, rawline] of repeats) {
      faults.push(
        `${redacted.get(relative(repoR, p))}: line ${number} repeats ${redacted.get(rawrel)}:${rawline} (compile, do not transcribe)`,
      );
    }
  }

  // orphans: every page reachable from the index
  const index = join(wiki, "index.md");
  if (!existsSync(index)) {
    fault(wiki, "no index.md");
  } else {
    const seen = new Set<string>();
    const queue = [resolve(index)];
    while (queue.length > 0) {
      const cur = queue.pop() as string;
      if (seen.has(cur)) continue;
      seen.add(cur);
      let curText = "";
      try {
        curText = readFileSync(cur, "utf8");
      } catch {
        continue;
      }
      for (const m of prose(curText).matchAll(/\]\(([^)#]+)\)/gu)) {
        const t = m[1] ?? "";
        if (t.startsWith("http://") || t.startsWith("https://") || t.startsWith("mailto:"))
          continue;
        const nxt = resolve(cur.split("/").slice(0, -1).join("/"), t);
        if (nxt.endsWith(".md") && existsSync(nxt)) queue.push(nxt);
      }
    }
    for (const p of pages) {
      if (!seen.has(resolve(p))) {
        fault(p, "orphan: not reachable from index.md");
      }
    }
  }

  // a trial must be repeatable, a capture must say where it came from
  if (dirExists(raw)) {
    const trials = join(raw, "trials");
    const trialDirs = dirExists(trials)
      ? readdirSync(trials)
          .map((n) => join(trials, n))
          .sort()
      : [];
    for (const d of trialDirs) {
      try {
        if (statSync(d).isDirectory() && !existsSync(join(d, "method.md"))) {
          fault(d, "trial has no method.md, so it cannot be repeated");
        }
      } catch {
        /* skip */
      }
    }
    for (const kind of ["papers", "articles"]) {
      const base = join(raw, kind);
      const dirs = dirExists(base)
        ? readdirSync(base)
            .map((n) => join(base, n))
            .sort()
        : [];
      for (const d of dirs) {
        try {
          if (!statSync(d).isDirectory()) continue;
        } catch {
          continue;
        }
        const src = join(d, "source.md");
        if (!existsSync(src)) {
          fault(d, "capture has no source.md");
          continue;
        }
        const sfm = frontMatter(readFileSync(src, "utf8")) ?? {};
        for (const key of ["url", "retrieved"]) {
          if (!(sfm[key] ?? "").trim()) {
            fault(src, `source.md has no ${key}`);
          }
        }
      }
    }
  }

  for (const f of faults) console.log(f);
  return faults.length > 0 ? 1 : 0;
}

// --- entry -----------------------------------------------------------------------------------
const argv = process.argv.slice(2);
let REPO: string;
if (import.meta.main) {
  if (argv[0] === undefined || argv[0] === "") {
    REPO = toolRoot(import.meta);
  } else if (argv[0]?.startsWith("-")) {
    console.error("usage: wiki-lint.sh [<repo>]");
    process.exit(2);
  } else {
    REPO = argv[0] as string;
  }
  process.exit(lint(REPO));
}
