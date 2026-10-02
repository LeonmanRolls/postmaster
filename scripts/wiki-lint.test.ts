// Tests beside scripts/wiki-lint.ts, moved from its --self-test on #109: 39 controls.
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
import { run } from "./lib/proc";
import { CITE_RE, FM_RE, lint, SOURCES_RE, splitChunk, textLines } from "./wiki-lint";

const REPO_ROOT = toolRoot(import.meta);
const GOOD_SOURCE = "url: https://example.org/paper\nretrieved: 2026-01-01\ntitle: A paper\n";
const SELF = join(import.meta.dir, "wiki-lint.sh");

let tmpRoot = "";
let savedDetectionsLog: string | undefined;

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
  // Hermetic logging: the gate runs tests with a detections log set,
  // and fixture findings must never land in it.
  savedDetectionsLog = process.env.POSTMASTER_DETECTIONS_LOG;
  process.env.POSTMASTER_DETECTIONS_LOG = "";
});

afterAll(() => {
  if (savedDetectionsLog === undefined) delete process.env.POSTMASTER_DETECTIONS_LOG;
  else process.env.POSTMASTER_DETECTIONS_LOG = savedDetectionsLog;
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

describe("page content: paths, hosts and quotations", () => {
  test("a page line quoting raw/", () => {
    fresh();
    concept("quoted", "claimed", "");
    const quote = "The staging relay counted four hundred thirteen spans on the quiet Tuesday run.";
    writeFileSync(join(tmpRoot, "raw", "evidence.txt"), `${quote}\n`, "utf8");
    const p = join(tmpRoot, "wiki", "concepts", "quoted.md");
    writeFileSync(p, `${readFileSync(p, "utf8")}${quote}\n`, "utf8");
    expectLint("fail", "repeats raw/");
  }, 60000);

  test("a large raw file streams to its mid-file hit", () => {
    fresh();
    concept("bigquote", "claimed", "");
    const big = "The staging relay counted four hundred sixteen spans on the Friday run.";
    const lines: string[] = [];
    for (let i = 0; i < 250000; i++) {
      lines.push(i === 125000 ? big : `bulk evidence filler line ${i} for the streaming control`);
    }
    writeFileSync(join(tmpRoot, "raw", "big-evidence.txt"), `${lines.join("\n")}\n`, "utf8");
    const p = join(tmpRoot, "wiki", "concepts", "bigquote.md");
    writeFileSync(p, `${readFileSync(p, "utf8")}${big}\n`, "utf8");
    expectLint("fail", "repeats raw/big-evidence.txt:125001");
  }, 120000);

  test("a page carrying a private path", () => {
    fresh();
    concept("haspath", "claimed", "");
    const home = "/home";
    const who = "fixture-user";
    const p = join(tmpRoot, "wiki", "concepts", "haspath.md");
    writeFileSync(p, `${readFileSync(p, "utf8")}See ${home}/${who}-413/notes.txt for the log.\n`, "utf8");
    expectLint("fail", "private-path");
  }, 60000);

  test("a marked path still faults, markers inert on pages", () => {
    fresh();
    concept("markedpath", "claimed", "");
    const home = "/home";
    const who = "fixture-user";
    const allowP = "private-data:allo";
    const p = join(tmpRoot, "wiki", "concepts", "markedpath.md");
    writeFileSync(
      p,
      `${readFileSync(p, "utf8")}See ${home}/${who}-413/notes.txt for the log.  <!-- ${allowP}w private-path -- made-up -->\n`,
      "utf8",
    );
    expectLint("fail", "private-path");
  }, 60000);

  test("a page carrying a private hostname", () => {
    fresh();
    concept("hashhost", "claimed", "");
    const hn = "metrics.interna";
    const p = join(tmpRoot, "wiki", "concepts", "hashhost.md");
    writeFileSync(p, `${readFileSync(p, "utf8")}See https://${hn}l:8443/up for the dashboard.\n`, "utf8");
    expectLint("fail", "private-host");
  }, 60000);

  test("a raw filename carrying a value is redacted", () => {
    fresh();
    concept("quotefile", "claimed", "");
    const quote = "The quiet relay logged four hundred fourteen spans on the Wednesday run.";
    const qe = "contact-relay-413";
    const qh = "quiet-relay-413";
    const qt = "net";
    writeFileSync(join(tmpRoot, "raw", `${qe}@${qh}.${qt}.txt`), `${quote}\n`, "utf8");
    const p = join(tmpRoot, "wiki", "concepts", "quotefile.md");
    writeFileSync(p, `${readFileSync(p, "utf8")}${quote}\n`, "utf8");
    const { code, out } = lintCapture();
    expect(code === 0 ? "pass" : "fail").toBe("fail");
    expect(out).toContain("repeats raw/");
    expect(out).toContain("[redacted]");
    expect(out.includes(`${qe}@${qh}.${qt}`)).toBe(false);
  }, 60000);

  test("a shaped page filename is redacted in quote faults", () => {
    fresh();
    const quote = "The staging relay tallied four hundred fifteen spans on the Thursday run.";
    const qe = "contact-relay-414";
    const qh = "quiet-relay-414";
    const qt = "net";
    writeFileSync(join(tmpRoot, "raw", "evidence2.txt"), `${quote}\n`, "utf8");
    const p = join(tmpRoot, "wiki", "concepts", `${qe}@${qh}.${qt}.md`);
    writeFileSync(
      p,
      `---\ntitle: qp\ntype: concept\nstanding: claimed\nsources: []\nupdated: 2026-01-01\n---\n\nBody.\n${quote}\n`,
      "utf8",
    );
    const idx = join(tmpRoot, "wiki", "index.md");
    writeFileSync(idx, `${readFileSync(idx, "utf8")}\n- [qp](concepts/${qe}@${qh}.${qt}.md)\n`, "utf8");
    const { code, out } = lintCapture();
    expect(code === 0 ? "pass" : "fail").toBe("fail");
    expect(out).toContain("repeats raw/");
    expect(out).toContain("[redacted]");
    expect(out.includes(`${qe}@${qh}.${qt}`)).toBe(false);
  }, 60000);

  test("a page fault under a shaped checkout path names its repo-relative path", () => {
    // Assembled from pieces so this source carries no matchable form of its own fixture.
    const parent = `${join(tmpdir(), "clau")}de-413-wikilint`;
    rmSync(parent, { recursive: true, force: true });
    mkdirSync(join(parent, "repo", "raw"), { recursive: true });
    cpSync(join(REPO_ROOT, "wiki"), join(parent, "repo", "wiki"), { recursive: true });
    run("git", ["-C", join(parent, "repo"), "init", "-q", "-b", "main"]);
    writeFileSync(
      join(parent, "repo", "wiki", "concepts", "shaped.md"),
      "---\ntitle: shaped\ntype: concept\nstanding: claimed\nsources: []\nupdated: 2026-01-01\n---\n\nBody.\n",
      "utf8",
    );
    const idx = join(parent, "repo", "wiki", "index.md");
    writeFileSync(idx, `${readFileSync(idx, "utf8")}\n- [shaped](concepts/shaped.md)\n`, "utf8");
    const home = "/home";
    const who = "fixture-user";
    const p = join(parent, "repo", "wiki", "concepts", "shaped.md");
    writeFileSync(p, `${readFileSync(p, "utf8")}See ${home}/${who}-413/notes.txt for the log.\n`, "utf8");
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    let code = 0;
    try {
      code = lint(join(parent, "repo"));
    } finally {
      console.log = origLog;
    }
    rmSync(parent, { recursive: true, force: true });
    const out = logs.join("\n");
    expect(code === 0 ? "pass" : "fail").toBe("fail");
    expect(out).toContain("wiki/concepts/shaped.md: line");
    expect(out.includes("[redacted]")).toBe(false);
  }, 120000);

  test("a missing scanner fails the lint", () => {
    fresh();
    const stub = join(tmpRoot, "stubbin", "scrub-check.sh");
    mkdirSync(join(tmpRoot, "stubbin"), { recursive: true });
    writeFileSync(stub, "#!/usr/bin/env bash\nexit 127\n", { mode: 0o755 });
    const saved = process.env.WIKI_LINT_SCRUB;
    process.env.WIKI_LINT_SCRUB = stub;
    try {
      const { code } = lintCapture();
      expect(code).toBe(2);
    } finally {
      if (saved === undefined) delete process.env.WIKI_LINT_SCRUB;
      else process.env.WIKI_LINT_SCRUB = saved;
    }
  }, 60000);

  test("a target outside the caller checkout still scans", () => {
    const elsewhere = join(tmpRoot, "outside-fixture");
    rmSync(elsewhere, { recursive: true, force: true });
    mkdirSync(join(elsewhere, "raw"), { recursive: true });
    cpSync(join(REPO_ROOT, "wiki"), join(elsewhere, "wiki"), { recursive: true });
    run("git", ["-C", elsewhere, "init", "-q", "-b", "main"]);
    writeFileSync(
      join(elsewhere, "wiki", "concepts", "away.md"),
      "---\ntitle: away\ntype: concept\nstanding: claimed\nsources: []\nupdated: 2026-01-01\n---\n\nBody.\n",
      "utf8",
    );
    const idx = join(elsewhere, "wiki", "index.md");
    writeFileSync(idx, `${readFileSync(idx, "utf8")}\n- [away](concepts/away.md)\n`, "utf8");
    const home = "/home";
    const who = "fixture-user";
    const p = join(elsewhere, "wiki", "concepts", "away.md");
    writeFileSync(p, `${readFileSync(p, "utf8")}See ${home}/${who}-413/notes.txt for the log.\n`, "utf8");
    const r = run("bash", [SELF, elsewhere], { cwd: tmpdir() });
    const out = r.out + r.err;
    expect(r.code).toBe(1);
    expect(out).toContain("private-path");
  }, 120000);
});

describe("detection controls: the lint logs what it reports, nothing else", () => {
  test("a page fault is logged once, under its page", () => {
    fresh();
    concept("logpath", "claimed", "");
    const home = "/home";
    const who = "fixture-user";
    const p = join(tmpRoot, "wiki", "concepts", "logpath.md");
    writeFileSync(p, `${readFileSync(p, "utf8")}See ${home}/${who}-413/notes.txt for the log.\n`, "utf8");
    const log = join(tmpRoot, "wl.jsonl");
    rmSync(log, { force: true });
    process.env.POSTMASTER_DETECTIONS_LOG = log;
    try {
      const { code } = lintCapture();
      expect(code === 0 ? "pass" : "fail").toBe("fail");
    } finally {
      process.env.POSTMASTER_DETECTIONS_LOG = "";
    }
    const entries = readFileSync(log, "utf8")
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l));
    expect(entries.length).toBe(1);
    expect(entries[0].rule).toBe("private-path");
    expect(entries[0].file).toBe("wiki/concepts/logpath.md");
    expect(entries[0].line).toBe(10);
    expect(entries[0].commit).toBe("");
  }, 60000);

  test("a page carrying only an address passes, and an unreported finding is never logged", () => {
    fresh();
    concept("mailto", "claimed", "");
    const me = "contact-relay-413";
    const mh = "quiet-relay-413";
    const mt = "net";
    const p = join(tmpRoot, "wiki", "concepts", "mailto.md");
    writeFileSync(p, `${readFileSync(p, "utf8")}Reach the relay at ${me}@${mh}.${mt} for pings.\n`, "utf8");
    const log = join(tmpRoot, "wl2.jsonl");
    rmSync(log, { force: true });
    process.env.POSTMASTER_DETECTIONS_LOG = log;
    try {
      expectLint("pass");
    } finally {
      process.env.POSTMASTER_DETECTIONS_LOG = "";
    }
    expect(existsSync(log)).toBe(false);
  }, 60000);
});

describe("streaming line splitter", () => {
  function fold(chunks: string[]): string[] {
    const out: string[] = [];
    let carry = "";
    chunks.forEach((c, i) => {
      const split = splitChunk(carry + c, i === chunks.length - 1);
      carry = split.carry;
      out.push(...split.lines);
    });
    if (carry !== "") out.push(carry);
    return out;
  }

  test("a CRLF split across chunks is one boundary", () => {
    expect(fold(["a\r", "\nb"])).toEqual(["a", "b"]);
  });

  test("a lone CR splits", () => {
    expect(fold(["a\rb"])).toEqual(["a", "b"]);
  });

  test("a unicode boundary splits", () => {
    expect(fold(["a\u2028b"])).toEqual(["a", "b"]);
  });

  test("a trailing boundary emits no empty line", () => {
    expect(fold(["a\n"])).toEqual(["a"]);
    expect(fold([""])).toEqual([]);
  });

  test("a NUL byte stays in its line for the caller to skip", () => {
    expect(fold(["a\0b\n"])).toEqual(["a\0b"]);
  });

  test("file lines number as splitlines numbers them", () => {
    const f = join(tmpRoot, "numbered.txt");
    writeFileSync(f, "a\r\nb\rc\n", "utf8");
    expect([...textLines(f, true)]).toEqual([
      [1, "a"],
      [2, "b"],
      [3, "c"],
    ]);
  });

  test("strict decoding throws on invalid bytes", () => {
    const f = join(tmpRoot, "strict.bin");
    writeFileSync(f, new Uint8Array([0xff]));
    expect(() => [...textLines(f, true)]).toThrow();
  });

  test("tolerant decoding replaces invalid bytes", () => {
    const f = join(tmpRoot, "tolerant.bin");
    writeFileSync(f, new Uint8Array([0xff]));
    expect([...textLines(f, false)]).toEqual([[1, "\ufffd"]]);
  });
});
