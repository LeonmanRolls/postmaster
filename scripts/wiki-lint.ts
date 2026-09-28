import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { makeTemp, removeTree, scriptDir, writeOut } from "./lib/core.ts";

type LintResult = { code: number; faults: string[] };
const here = scriptDir(import.meta.url);
const repoRoot = resolve(here, "..");
const standings = new Set(["claimed", "supported", "mixed", "refuted", "settled"]);
const ownEvidence = new Set(["runs", "trials"]);
function filesUnder(dir: string, suffix: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path, suffix));
    else if (path.endsWith(suffix)) out.push(path);
  }
  return out.sort();
}
function frontMatter(text: string): Record<string, string> | null {
  if (!text.startsWith("---")) return null;
  const end = text.indexOf("\n---", 3);
  if (end < 0) return null;
  const fields: Record<string, string> = {};
  for (const match of text.slice(3, end).matchAll(/^([a-z_]+):\s*(.*)$/gm)) fields[match[1]!] = match[2]!;
  return fields;
}
function prose(text: string): string {
  const tick = String.fromCharCode(96);
  text = text.replace(new RegExp(`${tick.repeat(3)}[\\\\s\\\\S]*?${tick.repeat(3)}`, "g"), "");
  return text.replace(new RegExp(`${tick}[^${tick}]*${tick}`, "g"), "");
}
function lint(repo: string): LintResult {
  const wiki = join(repo, "wiki");
  const raw = join(repo, "raw");
  if (!existsSync(wiki) || !statSync(wiki).isDirectory()) return { code: 2, faults: [`no wiki/ in ${repo}`] };
  const pages = filesUnder(wiki, ".md");
  const byStem = new Set(pages.map((path) => path.slice(path.lastIndexOf("/") + 1, -3)));
  const faults: string[] = [];
  const fault = (path: string, message: string) => faults.push(`${relative(repo, path)}: ${message}`);
  for (const path of pages) {
    let rawText: string;
    try {
      rawText = readFileSync(path, "utf8");
    } catch (error) {
      fault(path, `cannot read: ${String(error)}`);
      continue;
    }
    const text = prose(rawText);
    const fm = frontMatter(rawText);
    if (fm === null) {
      fault(path, "no front matter");
      continue;
    }
    for (const key of ["title", "type", "updated"]) if (!(key in fm)) fault(path, `front matter has no ${key}`);
    if (fm.type === "concept") {
      const standing = fm.standing;
      if (standing === undefined) fault(path, "concept with no standing");
      else if (!standings.has(standing))
        fault(path, `standing ${JSON.stringify(standing)} is not one of ${[...standings].sort().join(", ")}`);
      const sources = [...(fm.sources ?? "").matchAll(/([a-z]+)\/([^,\]\s]+)/g)].map(
        (match) => [match[1]!, match[2]!] as const,
      );
      for (const [kind, id] of sources)
        if (!existsSync(join(raw, kind, id)))
          fault(path, `source ${kind}/${id} in front matter does not resolve under raw/`);
      const own = sources.filter(([kind]) => ownEvidence.has(kind));
      if (standing && standing !== "claimed" && standings.has(standing) && own.length === 0)
        fault(path, `standing ${standing} rests on no run or trial; outside work alone cannot move a standing`);
      else if (standing === "supported" && own.length < 3)
        fault(path, `standing supported rests on ${own.length} run(s) or trial(s); three are needed`);
    }
    for (const match of text.matchAll(/\[@([a-z]+)\/([^\]\s]+)/g)) {
      const kind = match[1]!;
      const id = match[2]!.replace(/[/.,;)]+$/, "");
      if (!existsSync(join(raw, kind, id))) fault(path, `citation [@${kind}/${id}] does not resolve under raw/`);
    }
    for (const match of text.matchAll(/\[\[([^\]]+)\]\]/g))
      if (!byStem.has(match[1]!)) fault(path, `wikilink [[${match[1]}]] has no page`);
    for (const match of text.matchAll(/\]\(([^)#]+)\)/g)) {
      const target = match[1]!;
      if (target.startsWith("http://") || target.startsWith("https://") || target.startsWith("mailto:")) continue;
      if (!existsSync(join(path.slice(0, path.lastIndexOf("/")), target)))
        fault(path, `link to ${target} does not resolve`);
    }
  }
  const index = join(wiki, "index.md");
  if (!existsSync(index)) fault(wiki, "no index.md");
  else {
    const seen = new Set<string>();
    const queue = [index];
    while (queue.length) {
      const current = resolve(queue.pop()!);
      if (seen.has(current)) continue;
      seen.add(current);
      let content = "";
      try {
        content = prose(readFileSync(current, "utf8"));
      } catch {
        continue;
      }
      for (const match of content.matchAll(/\]\(([^)#]+)\)/g)) {
        const target = match[1]!;
        if (target.startsWith("http://") || target.startsWith("https://") || target.startsWith("mailto:")) continue;
        const next = resolve(current.slice(0, current.lastIndexOf("/")), target);
        if (next.endsWith(".md") && existsSync(next)) queue.push(next);
      }
    }
    for (const path of pages) if (!seen.has(resolve(path))) fault(path, "orphan: not reachable from index.md");
  }
  const trials = join(raw, "trials");
  if (existsSync(trials))
    for (const name of readdirSync(trials)) {
      const path = join(trials, name);
      if (statSync(path).isDirectory() && !existsSync(join(path, "method.md")))
        fault(path, "trial has no method.md, so it cannot be repeated");
    }
  for (const kind of ["papers", "articles"]) {
    const base = join(raw, kind);
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base)) {
      const dir = join(base, name);
      if (!statSync(dir).isDirectory()) continue;
      const source = join(dir, "source.md");
      if (!existsSync(source)) {
        fault(dir, "capture has no source.md");
        continue;
      }
      const fm = frontMatter(readFileSync(source, "utf8")) ?? {};
      for (const key of ["url", "retrieved"]) if (!(fm[key] ?? "").trim()) fault(source, `source.md has no ${key}`);
    }
  }
  return { code: faults.length ? 1 : 0, faults };
}
function run(args: string[]): number {
  if (args[0] === "--self-test") return args.length === 1 ? selfTest() : 2;
  if (args.length > 1 || args[0]?.startsWith("-")) {
    process.stderr.write("usage: wiki-lint.sh [<repo>] | --self-test\n");
    return 2;
  }
  const result = lint(args[0] ?? repoRoot);
  for (const fault of result.faults) writeOut(fault);
  return result.code;
}
function selfTest(): number {
  const tmp = makeTemp("postmaster-wiki-lint-");
  let failures = 0;
  const ok = (label: string) => writeOut(`  ok   ${label}`);
  const fail = (label: string, result: LintResult) => {
    writeOut(`  FAIL ${label}`);
    for (const line of result.faults) writeOut(`         ${line}`);
    failures++;
  };
  const expect = (want: "pass" | "fail", label: string, contains = "") => {
    const result = lint(tmp);
    const got = result.code === 0 ? "pass" : "fail";
    if (got === want && (!contains || result.faults.some((fault) => fault.includes(contains)))) ok(label);
    else fail(`${label}: wanted ${want}, got ${got}${contains ? `, missing reason ${contains}` : ""}`, result);
  };
  const fresh = () => {
    removeTree(join(tmp, "wiki"));
    removeTree(join(tmp, "raw"));
    cpSync(join(repoRoot, "wiki"), join(tmp, "wiki"), { recursive: true });
    if (existsSync(join(repoRoot, "raw"))) cpSync(join(repoRoot, "raw"), join(tmp, "raw"), { recursive: true });
    else mkdirSync(join(tmp, "raw"));
  };
  const page = (name: string, fm: string) => {
    writeFileSync(join(tmp, `wiki/concepts/${name}.md`), `---\n${fm}---\n\nBody.\n`);
    writeFileSync(
      join(tmp, "wiki/index.md"),
      `${readFileSync(join(tmp, "wiki/index.md"), "utf8")}\n- [${name}](concepts/${name}.md)\n`,
    );
  };
  const concept = (name: string, standing: string, sources: string) =>
    page(name, `title: ${name}\ntype: concept\nstanding: ${standing}\nsources: [${sources}]\nupdated: 2026-01-01\n`);
  const trial = (slug: string) => {
    mkdirSync(join(tmp, `raw/trials/${slug}`), { recursive: true });
    writeFileSync(join(tmp, `raw/trials/${slug}/method.md`), "Method.\n");
  };
  const capture = (kind: string, slug: string, fm: string) => {
    mkdirSync(join(tmp, `raw/${kind}/${slug}`), { recursive: true });
    writeFileSync(join(tmp, `raw/${kind}/${slug}/source.md`), `---\n${fm}---\n`);
  };
  const goodSource = "url: https://example.org/paper\nretrieved: 2026-01-01\ntitle: A paper\n";
  try {
    writeOut("negative controls");
    fresh();
    expect("pass", "the unmodified wiki passes");
    fresh();
    trial("t1");
    capture("papers", "p1", goodSource);
    concept("ok", "settled", "trials/t1, papers/p1");
    expect("pass", "a settled concept on a trial, with a well-formed capture, passes");
    writeOut("positive controls: each check fails on its own fault");
    fresh();
    writeFileSync(join(tmp, "wiki/concepts/bare.md"), "# no front matter\n");
    writeFileSync(
      join(tmp, "wiki/index.md"),
      `${readFileSync(join(tmp, "wiki/index.md"), "utf8")}\n- [bare](concepts/bare.md)\n`,
    );
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
    capture("papers", "p1", goodSource);
    concept("paperonly", "settled", "papers/p1");
    expect("fail", "a standing moved by outside work alone", "rests on no run or trial");
    fresh();
    trial("t1");
    concept("thin", "supported", "trials/t1");
    expect("fail", "supported on fewer than three runs or trials", "three are needed");
    fresh();
    concept("cites", "claimed", "");
    writeFileSync(
      join(tmp, "wiki/concepts/cites.md"),
      `${readFileSync(join(tmp, "wiki/concepts/cites.md"), "utf8")}See [@runs/no-such-run].\n`,
    );
    expect("fail", "a citation that does not resolve", "does not resolve under raw/");
    fresh();
    concept("wl", "claimed", "");
    writeFileSync(
      join(tmp, "wiki/concepts/wl.md"),
      `${readFileSync(join(tmp, "wiki/concepts/wl.md"), "utf8")}See [[no-such-page]].\n`,
    );
    expect("fail", "a wikilink with no page", "has no page");
    fresh();
    writeFileSync(
      join(tmp, "wiki/index.md"),
      `${readFileSync(join(tmp, "wiki/index.md"), "utf8")}\n[a dangling link](nowhere.md)\n`,
    );
    expect("fail", "a relative link that does not resolve", "link to nowhere.md");
    fresh();
    writeFileSync(
      join(tmp, "wiki/concepts/orphan.md"),
      "---\ntitle: o\ntype: concept\nstanding: claimed\nupdated: 2026-01-01\n---\n",
    );
    expect("fail", "an orphan page", "orphan");
    fresh();
    mkdirSync(join(tmp, "raw/trials/t2"), { recursive: true });
    expect("fail", "a trial with no method.md", "no method.md");
    fresh();
    mkdirSync(join(tmp, "raw/articles/a1"), { recursive: true });
    expect("fail", "a capture with no source.md", "has no source.md");
    fresh();
    capture("papers", "p2", "retrieved: 2026-01-01\n");
    expect("fail", "a source.md with no url", "has no url");
    fresh();
    capture("papers", "p3", "url: https://example.org/x\n");
    expect("fail", "a source.md with no retrieval date", "has no retrieved");
  } finally {
    removeTree(tmp);
  }
  writeOut("");
  writeOut(failures === 0 ? "self-test: all controls behaved" : `self-test: ${failures} control(s) misbehaved`);
  return failures === 0 ? 0 : 1;
}
process.exit(run(process.argv.slice(2)));
