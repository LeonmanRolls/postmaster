// Health-check the wiki, so its rules are run rather than remembered. Deterministic checks
// belong in a script; a check written as prose is re-derived, and mis-derived, on every pass.
//
//   run wiki-lint [<repo>]      default: the repo this script lives in
//
// Reports every fault and fixes none: a standing contradicting its own records means either
// the standing or the reading is wrong, and which is a judgement for a person.
//
//   exit 0  clean
//   exit 1  faults found, one per line on stdout
//   exit 2  usage, or no wiki to check
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { toolRoot } from "./lib/paths.ts";
import { DOT_ALL, PY_DOT, PY_M_END, PY_M_START, PY_S_CLASS } from "./lib/text.ts";

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

function relPath(p: string, repo: string): string {
  return p === repo ? p : relative(repo, p);
}

/** lint <repo>; prints faults, returns 1 if any */
export function lint(repo: string): number {
  const wiki = join(repo, "wiki");
  const raw = join(repo, "raw");
  if (!dirExists(wiki)) {
    console.log(`no wiki/ in ${repo}`);
    return 2;
  }

  const faults: string[] = [];
  const fault = (p: string, msg: string): void => {
    faults.push(`${relPath(p, repo)}: ${msg}`);
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
    console.error("usage: run wiki-lint [<repo>]");
    process.exit(2);
  } else {
    REPO = argv[0] as string;
  }
  process.exit(lint(REPO));
}
