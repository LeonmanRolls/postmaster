// Tests beside scripts/review-page.ts. The pure helpers are called directly; the script runs
// against a throwaway repository with a base and a head commit, so its totals are held to git's
// own for the same range (positive control) and a file with no address keeps its text (negative).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./lib/proc.ts";
import {
  groupChanges,
  langOf,
  lineCount,
  packChunks,
  parseChanges,
  scrub,
  titled,
} from "./review-page.ts";

const script = join(import.meta.dir, "review-page.ts");

describe("pure core", () => {
  test("addresses outside the example domains are removed, line numbers kept", () => {
    const r = scrub(
      "a: " +
        "som" +
        "eon" +
        "e@c" +
        "omp" +
        "any" +
        ".co" +
        "\nb:" +
        " u@" +
        "exa" +
        "mpl" +
        "e.c" +
        "om\n" +
        "c: " +
        "x@h" +
        "ost" +
        ".in" +
        "val" +
        "id\n" +
        "d: " +
        "é@e" +
        "xäm" +
        "ple" +
        ".co" +
        "m\n",
    );
    expect(r.text).toBe(
      "a: <address removed>\nb: u@example.com\nc: x@host.invalid\nd: <address removed>\n",
    );
    expect(r.removed).toBe(2);
    expect(scrub("no address here\n")).toEqual({ text: "no address here\n", removed: 0 });
  });

  test("a decorator is not an address", () => {
    expect(scrub("@contextlib.contextmanager\n").removed).toBe(0);
  });

  test("languages come from the extension", () => {
    expect(langOf("scripts/x.ts")).toBe("typescript");
    expect(langOf("a/b.sh")).toBe("bash");
    expect(langOf("README.md")).toBe("markdown");
    expect(langOf("Makefile")).toBe("plaintext");
  });

  test("lines are counted as an editor numbers them", () => {
    expect(lineCount("")).toBe(0);
    expect(lineCount("a\nb\n")).toBe(2);
    expect(lineCount("a\nb")).toBe(2);
  });

  test("numstat and name-status read together, renames and binaries included", () => {
    const changes = parseChanges(
      "3\t1\tsrc/a.ts\n-\t-\timg.png\n2\t0\tsrc/{old.ts => new.ts}\n",
      "M\tsrc/a.ts\nA\timg.png\nR091\tsrc/old.ts\tsrc/new.ts\n",
    );
    expect(changes).toEqual([
      { path: "src/a.ts", old: null, status: "M", add: 3, del: 1, binary: false },
      { path: "img.png", old: null, status: "A", add: 0, del: 0, binary: true },
      { path: "src/new.ts", old: "src/old.ts", status: "R", add: 2, del: 0, binary: false },
    ]);
  });

  test("files group by first folder, top-level files first", () => {
    const c = (path: string) => ({ path, old: null, status: "M", add: 1, del: 0, binary: false });
    const { order, files } = groupChanges([
      c("scripts/b.ts"),
      c("README.md"),
      c("docs/x.md"),
      c("scripts/a.ts"),
    ]);
    expect(order.map((o) => o.title)).toEqual(["Top level", "docs/", "scripts/"]);
    expect(files.map((f) => [f.path, f.group])).toEqual([
      ["README.md", 0],
      ["docs/x.md", 1],
      ["scripts/a.ts", 2],
      ["scripts/b.ts", 2],
    ]);
  });

  test("a chunk closes before it would pass the limit", () => {
    expect(packChunks([4, 4, 4, 9, 1], 10)).toEqual([0, 0, 1, 2, 2]);
    expect(packChunks([], 10)).toEqual([]);
  });

  test("the title is replaced, and markup in it dropped", () => {
    expect(titled("<title>Review</title><p>x</p>", "#12 <review>")).toBe(
      "<title>#12 review</title><p>x</p>",
    );
  });
});

let repo: string;
let base: string;
let head: string;

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "review-page-"));
  const g = (...a: string[]) => {
    const r = run("git", ["-C", repo, ...a]);
    if (r.code !== 0) throw new Error(r.err);
    return r.out.trim();
  };
  g("init", "-q", "-b", "main");
  g("config", "user.name", "Test");
  g("config", "user.email", "test@example.invalid");
  writeFileSync(join(repo, "keep.txt"), "one\ntwo\nthree\n");
  writeFileSync(join(repo, "gone.txt"), "bye\n");
  g("add", "-A");
  g("commit", "-q", "-m", "base");
  base = g("rev-parse", "HEAD");
  writeFileSync(join(repo, "keep.txt"), "one\n2\nthree\nfour\n");
  rmSync(join(repo, "gone.txt"));
  run("mkdir", ["-p", join(repo, "src")]);
  writeFileSync(
    join(repo, "src", "new.ts"),
    "con" +
      "st " +
      "own" +
      "er " +
      '= "' +
      "som" +
      "eon" +
      "e@c" +
      "omp" +
      "any" +
      ".co" +
      '";\n' +
      "exp" +
      "ort" +
      " co" +
      "nst" +
      " n " +
      "= 1" +
      ";\n",
  );
  g("add", "-A");
  g("commit", "-q", "-m", "head");
  head = g("rev-parse", "HEAD");
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("the script", () => {
  test("change: totals match git's, the address is removed, the page is titled", () => {
    const out = join(repo, ".out-change");
    const r = run(
      "bun",
      [script, "change", out, "--base", base, "--head", head, "--title", "Two edits"],
      { cwd: repo },
    );
    expect(r.code).toBe(0);
    const review = JSON.parse(readFileSync(join(out, "review.json"), "utf8"));
    const short = run("git", ["-C", repo, "diff", "--shortstat", base, head]).out;
    expect(short).toContain(`${review.changedFiles} files changed`);
    expect(short).toContain(`${review.additions} insertions`);
    expect(short).toContain(`${review.deletions} deletion`);
    // once in the diff and once in the file as it stands
    expect(review.redactions).toBe(2);
    const chunk = readFileSync(join(out, "chunks", "0.json"), "utf8");
    expect(chunk).toContain("<address removed>");
    expect(chunk).not.toContain("som" + "eon" + "e@c" + "omp" + "any" + ".co");
    expect(chunk).toContain("one\\n2\\nthree\\nfour");
    expect(readFileSync(join(out, "index.html"), "utf8")).toContain("<title>");
    expect(review.files.find((f: { path: string }) => f.path === "gone.txt").lines).toBeNull();
  });

  test("the spec is the WORKHORSE-SPEC.md the head commits, and none without one", () => {
    const none = join(repo, ".out-nospec");
    expect(
      run("bun", [script, "change", none, "--base", base, "--head", head], { cwd: repo }).code,
    ).toBe(0);
    expect(JSON.parse(readFileSync(join(none, "review.json"), "utf8")).spec).toBeNull();
    const g = (...a: string[]) => run("git", ["-C", repo, ...a]).out.trim();
    writeFileSync(join(repo, "WORKHORSE-SPEC.md"), "# Workhorse spec: #1 Two edits\n");
    g("add", "WORKHORSE-SPEC.md");
    g("commit", "-q", "-m", "spec");
    const withSpec = join(repo, ".out-spec");
    expect(
      run("bun", [script, "change", withSpec, "--base", base, "--head", g("rev-parse", "HEAD")], {
        cwd: repo,
      }).code,
    ).toBe(0);
    expect(JSON.parse(readFileSync(join(withSpec, "review.json"), "utf8")).spec).toBe(
      "# Workhorse spec: #1 Two edits\n",
    );
  });

  test("files: each path as it stands at the ref, with its own file", () => {
    const out = join(repo, ".out-files");
    const r = run("bun", [script, "files", out, head, "keep.txt", "src/new.ts"], { cwd: repo });
    expect(r.code).toBe(0);
    const data = JSON.parse(readFileSync(join(out, "files.json"), "utf8"));
    expect(data.files.map((f: { path: string; lines: number }) => [f.path, f.lines])).toEqual([
      ["keep.txt", 4],
      ["src/new.ts", 2],
    ]);
    expect(readFileSync(join(out, "files", "0.txt"), "utf8")).toBe("one\n2\nthree\nfour\n");
    expect(readFileSync(join(out, "files", "1.txt"), "utf8")).toContain("<address removed>");
    expect(existsSync(join(out, "index.html"))).toBe(true);
  });

  test("usage and an unknown ref exit 1", () => {
    expect(run("bun", [script], { cwd: repo }).code).toBe(1);
    expect(
      run("bun", [script, "files", join(repo, ".x"), "no-such-ref", "keep.txt"], { cwd: repo })
        .code,
    ).toBe(1);
  });
});
