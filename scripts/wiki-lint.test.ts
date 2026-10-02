// Tests beside scripts/wiki-lint.ts, moved from its --self-test on #109: 19 controls.
// expect() is renamed to expectLint(): bun:test owns expect. lint() output is captured by
// swapping console.log, as the self-test's lintCapture did.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toolRoot } from "./lib/paths";
import { CITE_RE, FM_RE, lint, SOURCES_RE } from "./wiki-lint";

const REPO_ROOT = toolRoot(import.meta);
const GOOD_SOURCE = "url: https://example.org/paper\nretrieved: 2026-01-01\ntitle: A paper\n";

let tmpRoot = "";

function lintCapture(): { code: number; out: string } {
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

function expectLint(passOrFail: "pass" | "fail", wantIn = ""): void {
  const { code, out } = lintCapture();
  expect(code === 0 ? "pass" : "fail").toBe(passOrFail);
  if (code !== 0 && wantIn !== "") expect(out).toContain(wantIn);
}

function fresh(): void {
  rmSync(join(tmpRoot, "wiki"), { recursive: true, force: true });
  rmSync(join(tmpRoot, "raw"), { recursive: true, force: true });
  cpSync(join(REPO_ROOT, "wiki"), join(tmpRoot, "wiki"), { recursive: true });
  if (existsSync(join(REPO_ROOT, "raw"))) {
    cpSync(join(REPO_ROOT, "raw"), join(tmpRoot, "raw"), { recursive: true });
  } else {
    mkdirSync(join(tmpRoot, "raw"));
  }
}

function page(name: string, fmLines: string): void {
  const p = join(tmpRoot, "wiki", "concepts", `${name}.md`);
  writeFileSync(p, `---\n${fmLines}---\n\nBody.\n`, "utf8");
  const idx = join(tmpRoot, "wiki", "index.md");
  const link = `${readFileSync(idx, "utf8")}\n- [${name}](concepts/${name}.md)\n`;
  writeFileSync(idx, link, "utf8");
}

function concept(name: string, standing: string, sources: string): void {
  const fmLines =
    `title: ${name}\ntype: concept\nstanding: ${standing}\n` +
    `sources: [${sources}]\nupdated: 2026-01-01\n`;
  page(name, fmLines);
}

function trial(slug: string): void {
  mkdirSync(join(tmpRoot, "raw", "trials", slug), { recursive: true });
  writeFileSync(join(tmpRoot, "raw", "trials", slug, "method.md"), "Method.\n", "utf8");
}

function capture(kind: string, slug: string, fmLines: string): void {
  mkdirSync(join(tmpRoot, "raw", kind, slug), { recursive: true });
  const src = join(tmpRoot, "raw", kind, slug, "source.md");
  writeFileSync(src, `---\n${fmLines}---\n`, "utf8");
}

beforeAll(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "wiki-lint-"));
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("pattern ports", () => {
  test("front matter keeps a CR in the value", () => {
    const fm = [..."title: A\rB\n".matchAll(FM_RE)].map((m) => [m[1], m[2]]);
    expect(fm).toEqual([["title", "A\rB"]]);
  }, 10000);

  test("sources stop an ident at U+001C", () => {
    const src = [..."papers/a\x1cb".matchAll(SOURCES_RE)].map((m) => [m[1], m[2]]);
    expect(src).toEqual([["papers", "a"]]);
  }, 10000);

  test("citations stop an ident at U+001C", () => {
    const cite = [..."see [@papers/a\x1cb] x".matchAll(CITE_RE)].map((m) => [m[1], m[2]]);
    expect(cite).toEqual([["papers", "a"]]);
  }, 10000);
});

describe("negative controls", () => {
  test("the unmodified wiki passes", () => {
    fresh();
    expectLint("pass");
  }, 10000);

  test("a settled concept on a trial, with a well-formed capture, passes", () => {
    fresh();
    trial("t1");
    capture("papers", "p1", GOOD_SOURCE);
    concept("ok", "settled", "trials/t1, papers/p1");
    expectLint("pass");
  }, 10000);
});

describe("positive controls: each check fails on its own fault", () => {
  test("a page without front matter", () => {
    fresh();
    const bare = join(tmpRoot, "wiki", "concepts", "bare.md");
    writeFileSync(bare, "# no front matter\n", "utf8");
    const idx = join(tmpRoot, "wiki", "index.md");
    const link = `${readFileSync(idx, "utf8")}\n- [bare](concepts/bare.md)\n`;
    writeFileSync(idx, link, "utf8");
    expectLint("fail", "no front matter");
  }, 10000);

  test("a concept with no standing", () => {
    fresh();
    page("nostanding", "title: x\ntype: concept\nupdated: 2026-01-01\n");
    expectLint("fail", "concept with no standing");
  }, 10000);

  test("a standing that is not one of the five", () => {
    fresh();
    concept("badstanding", "probable", "");
    expectLint("fail", "is not one of");
  }, 10000);

  test("a front-matter source that does not resolve", () => {
    fresh();
    concept("badsource", "claimed", "runs/no-such-run");
    expectLint("fail", "in front matter does not resolve");
  }, 10000);

  test("a standing moved by outside work alone", () => {
    fresh();
    capture("papers", "p1", GOOD_SOURCE);
    concept("paperonly", "settled", "papers/p1");
    expectLint("fail", "rests on no run or trial");
  }, 10000);

  test("supported on fewer than three runs or trials", () => {
    fresh();
    trial("t1");
    concept("thin", "supported", "trials/t1");
    expectLint("fail", "three are needed");
  }, 10000);

  test("a citation that does not resolve", () => {
    fresh();
    concept("cites", "claimed", "");
    const p = join(tmpRoot, "wiki", "concepts", "cites.md");
    writeFileSync(p, `${readFileSync(p, "utf8")}See [@runs/no-such-run].\n`, "utf8");
    expectLint("fail", "does not resolve under raw/");
  }, 10000);

  test("a wikilink with no page", () => {
    fresh();
    concept("wl", "claimed", "");
    const p = join(tmpRoot, "wiki", "concepts", "wl.md");
    writeFileSync(p, `${readFileSync(p, "utf8")}See [[no-such-page]].\n`, "utf8");
    expectLint("fail", "has no page");
  }, 10000);

  test("a relative link that does not resolve", () => {
    fresh();
    const idx = join(tmpRoot, "wiki", "index.md");
    const link = `${readFileSync(idx, "utf8")}\n[a dangling link](nowhere.md)\n`;
    writeFileSync(idx, link, "utf8");
    expectLint("fail", "link to nowhere.md");
  }, 10000);

  test("an orphan page", () => {
    fresh();
    const p = join(tmpRoot, "wiki", "concepts", "orphan.md");
    const fm = "---\ntitle: o\ntype: concept\nstanding: claimed\nupdated: 2026-01-01\n---\n";
    writeFileSync(p, fm, "utf8");
    expectLint("fail", "orphan");
  }, 10000);

  test("a trial with no method.md", () => {
    fresh();
    mkdirSync(join(tmpRoot, "raw", "trials", "t2"), { recursive: true });
    expectLint("fail", "no method.md");
  }, 10000);

  test("a capture with no source.md", () => {
    fresh();
    mkdirSync(join(tmpRoot, "raw", "articles", "a1"), { recursive: true });
    expectLint("fail", "has no source.md");
  }, 10000);

  test("a source.md with no url", () => {
    fresh();
    capture("papers", "p2", "retrieved: 2026-01-01\n");
    expectLint("fail", "has no url");
  }, 10000);

  test("a source.md with no retrieval date", () => {
    fresh();
    capture("papers", "p3", "url: https://example.org/x\n");
    expectLint("fail", "has no retrieved");
  }, 10000);
});
