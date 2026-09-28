// Health-check the wiki, so its rules are run rather than remembered. Deterministic checks
// belong in a script; a check written as prose is re-derived, and mis-derived, on every pass.
//
//   wiki-lint.sh [<repo>]      default: the repo this script lives in
//   wiki-lint.sh --self-test   prove each check fails on its own fault, and a clean tree passes
//
// Reports every fault and fixes none: a standing contradicting its own records means either
// the standing or the reading is wrong, and which is a judgement for a person.
//
//   exit 0  clean
//   exit 1  faults found, one per line on stdout
//   exit 2  usage, or no wiki to check
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { toolRoot } from "./lib/paths.ts";
import { withTempDir } from "./lib/proc.ts";
import { SelfTest } from "./lib/selftest.ts";

const STANDINGS = new Set(["claimed", "supported", "mixed", "refuted", "settled"]);
const OWN_EVIDENCE = ["runs", "trials"]; // what this fleet did; papers and articles are not

function frontMatter(text: string): Record<string, string> | null {
  if (!text.startsWith("---")) return null;
  const end = text.indexOf("\n---", 3);
  if (end === -1) return null;
  const body = text.slice(3, end);
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/^([a-z_]+):\s*(.*)$/gm)) {
    out[m[1] ?? ""] = m[2] ?? "";
  }
  return out;
}

function prose(text: string): string {
  // Notation is documented in backticks: `[@papers/<slug>]` is an example of a citation,
  // not one. Fenced blocks and inline code spans are examples, so they are not scanned.
  return text.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "");
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
function lint(repo: string): number {
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
    byStem.set(stem.replace(/\.md$/, ""), p);
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
      for (const m of (fm.sources ?? "").matchAll(/([a-z]+)\/([^,\]\s]+)/g)) {
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
    for (const m of text.matchAll(/\[@([a-z]+)\/([^\]\s]+)/g)) {
      const kind = m[1] ?? "";
      const ident = (m[2] ?? "").replace(/[/.,;)]+$/, "");
      if (!existsSync(join(raw, kind, ident))) {
        fault(p, `citation [@${kind}/${ident}] does not resolve under raw/`);
      }
    }

    // wikilinks resolve to a page
    for (const m of text.matchAll(/\[\[([^\]]+)\]\]/g)) {
      if (!byStem.has(m[1] ?? "")) {
        fault(p, `wikilink [[${m[1] ?? ""}]] has no page`);
      }
    }

    // relative markdown links resolve
    for (const m of text.matchAll(/\]\(([^)#]+)\)/g)) {
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
      for (const m of prose(curText).matchAll(/\]\(([^)#]+)\)/g)) {
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
let SELFTEST = false;
let REPO: string;
if (argv[0] === "--self-test") {
  SELFTEST = true;
  REPO = toolRoot(import.meta);
} else if (argv[0] === undefined || argv[0] === "") {
  REPO = toolRoot(import.meta);
} else if (argv[0]?.startsWith("-")) {
  console.error("usage: wiki-lint.sh [<repo>] | --self-test");
  process.exit(2);
} else {
  REPO = argv[0] as string;
}

if (!SELFTEST) {
  process.exit(lint(REPO));
}

// --- self-test ---------------------------------------------------------------------------------
// One negative control (the real wiki passes), one control that well-formed additions pass,
// and one positive control per check, each asserting it failed for its own reason rather
// than for some other fault the fixture happened to introduce.

const st = new SelfTest();
const REPO_ROOT = REPO;

function expect(passOrFail: "pass" | "fail", label: string, wantIn?: string): void {
  // runs lint on $tmp and compares
  const { code, out } = lintCapture();
  const got = code === 0 ? "pass" : "fail";
  let why = "";
  if (got === "fail" && wantIn !== undefined && wantIn !== "" && !out.includes(wantIn)) {
    why = ", but not for the expected reason";
  }
  if (got === passOrFail && why === "") {
    st.ok(label);
  } else {
    st.fail(`${label}: wanted ${passOrFail}, got ${got}${why}`, out);
  }
}

const _currentLint: { code: number; out: string } = { code: 0, out: "" };
function lintCapture(): { code: number; out: string } {
  // capture console.log output of lint
  const logs: string[] = [];
  const origLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  try {
    const code = lint(tmpRoot);
    return { code, out: logs.join("\n") };
  } finally {
    console.log = origLog;
  }
}

let tmpRoot = "";
withTempDir((tmp) => {
  tmpRoot = tmp;

  const fresh = (): void => {
    try {
      rmrf(join(tmp, "wiki"));
      rmrf(join(tmp, "raw"));
    } catch {
      /* already gone */
    }
    cpSync(join(REPO_ROOT, "wiki"), join(tmp, "wiki"), { recursive: true });
    if (dirExists(join(REPO_ROOT, "raw"))) {
      cpSync(join(REPO_ROOT, "raw"), join(tmp, "raw"), { recursive: true });
    } else {
      mkdirSync(join(tmp, "raw"));
    }
  };

  const page = (name: string, fmLines: string): void => {
    writeFileSync(
      join(tmp, "wiki", "concepts", `${name}.md`),
      `---\n${fmLines}---\n\nBody.\n`,
      "utf8",
    );
    // link from the index
    const idx = join(tmp, "wiki", "index.md");
    writeFileSync(idx, `${readFileSync(idx, "utf8")}\n- [${name}](concepts/${name}.md)\n`, "utf8");
  };
  const concept = (name: string, standing: string, sources: string): void => {
    page(
      name,
      `title: ${name}\ntype: concept\nstanding: ${standing}\nsources: [${sources}]\nupdated: 2026-01-01\n`,
    );
  };
  const trial = (slug: string): void => {
    mkdirSync(join(tmp, "raw", "trials", slug), { recursive: true });
    writeFileSync(join(tmp, "raw", "trials", slug, "method.md"), "Method.\n", "utf8");
  };
  const capture = (kind: string, slug: string, fmLines: string): void => {
    mkdirSync(join(tmp, "raw", kind, slug), { recursive: true });
    writeFileSync(join(tmp, "raw", kind, slug, "source.md"), `---\n${fmLines}---\n`, "utf8");
  };
  const GOOD_SOURCE = "url: https://example.org/paper\nretrieved: 2026-01-01\ntitle: A paper\n";

  console.log("negative controls");
  fresh();
  expect("pass", "the unmodified wiki passes");
  fresh();
  trial("t1");
  capture("papers", "p1", GOOD_SOURCE);
  concept("ok", "settled", "trials/t1, papers/p1");
  expect("pass", "a settled concept on a trial, with a well-formed capture, passes");

  console.log("positive controls: each check fails on its own fault");
  fresh();
  writeFileSync(join(tmp, "wiki", "concepts", "bare.md"), "# no front matter\n", "utf8");
  {
    const idx = join(tmp, "wiki", "index.md");
    writeFileSync(idx, `${readFileSync(idx, "utf8")}\n- [bare](concepts/bare.md)\n`, "utf8");
  }
  expect("fail", "a page without front matter", "no front matter");

  fresh();
  page("nostanding", "title: x\ntype: concept\nupdated: 2026-01-01\n");
  expect("fail", "a concept with no standing", "concept with no standing");

  fresh();
  concept("badstanding", "probable", "");
  expect("fail", "a standing that is not one of the five", "is not one of");

  fresh();
  concept("badsource", "claimed", "runs/no-such-run");
  expect("fail", "a front-matter source that does not resolve", "in front matter does not resolve");

  fresh();
  capture("papers", "p1", GOOD_SOURCE);
  concept("paperonly", "settled", "papers/p1");
  expect("fail", "a standing moved by outside work alone", "rests on no run or trial");

  fresh();
  trial("t1");
  concept("thin", "supported", "trials/t1");
  expect("fail", "supported on fewer than three runs or trials", "three are needed");

  fresh();
  concept("cites", "claimed", "");
  writeFileSync(
    join(tmp, "wiki", "concepts", "cites.md"),
    `${readFileSync(join(tmp, "wiki", "concepts", "cites.md"), "utf8")}See [@runs/no-such-run].\n`,
    "utf8",
  );
  expect("fail", "a citation that does not resolve", "does not resolve under raw/");

  fresh();
  concept("wl", "claimed", "");
  writeFileSync(
    join(tmp, "wiki", "concepts", "wl.md"),
    `${readFileSync(join(tmp, "wiki", "concepts", "wl.md"), "utf8")}See [[no-such-page]].\n`,
    "utf8",
  );
  expect("fail", "a wikilink with no page", "has no page");

  fresh();
  {
    const idx = join(tmp, "wiki", "index.md");
    writeFileSync(idx, `${readFileSync(idx, "utf8")}\n[a dangling link](nowhere.md)\n`, "utf8");
  }
  expect("fail", "a relative link that does not resolve", "link to nowhere.md");

  fresh();
  writeFileSync(
    join(tmp, "wiki", "concepts", "orphan.md"),
    "---\ntitle: o\ntype: concept\nstanding: claimed\nupdated: 2026-01-01\n---\n",
    "utf8",
  );
  expect("fail", "an orphan page", "orphan");

  fresh();
  mkdirSync(join(tmp, "raw", "trials", "t2"), { recursive: true });
  expect("fail", "a trial with no method.md", "no method.md");

  fresh();
  mkdirSync(join(tmp, "raw", "articles", "a1"), { recursive: true });
  expect("fail", "a capture with no source.md", "has no source.md");

  fresh();
  capture("papers", "p2", "retrieved: 2026-01-01\n");
  expect("fail", "a source.md with no url", "has no url");

  fresh();
  capture("papers", "p3", "url: https://example.org/x\n");
  expect("fail", "a source.md with no retrieval date", "has no retrieved");

  st.finish();
});

function rmrf(p: string): void {
  rmSync(p, { recursive: true, force: true });
}
