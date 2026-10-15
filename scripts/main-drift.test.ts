// Tests beside scripts/main-drift.ts. The project is invented: main removes a style class that the
// branch's new markup uses, in one folder, and changes another folder the branch never touches.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { areasOf, cap, question } from "./main-drift.ts";

const SELF = join(import.meta.dir, "run");

describe("areas", () => {
  test("two levels deep where there are two, the folder where there is one, the top otherwise", () => {
    expect(
      areasOf([
        "apps/portal/src/a.ts",
        "apps/portal/b.ts",
        "apps/manager/c.ts",
        "packages/x/y.ts",
        "docs/z.md",
        "README.md",
      ]),
    ).toEqual([".", "apps/manager", "apps/portal", "docs", "packages/x"]);
  });

  test("no files, no areas", () => {
    expect(areasOf([])).toEqual([]);
  });
});

describe("cap", () => {
  test("a text inside the budget is unchanged", () => {
    expect(cap("a\nb\n", 1000)).toBe("a\nb\n");
  });

  test("a longer text is cut at a line end and says how much was left out", () => {
    const text = `${"x".repeat(60)}\n`.repeat(40);
    const out = cap(text, 1000);
    expect(out.length).toBeLessThan(text.length);
    expect(out).toContain("... cut here:");
    expect(out).toContain("more bytes. main-files.txt lists every file main changed.");
    expect(out.startsWith(`${"x".repeat(60)}\n`)).toBe(true);
  });
});

describe("the question", () => {
  test("names the three revisions, the areas and the three files", () => {
    const q = question("aaa", "bbb", "ccc", ["apps/portal", "docs"]);
    expect(q).toContain("checked against main at aaa");
    expect(q).toContain("moved to bbb");
    expect(q).toContain("tip is ccc");
    expect(q).toContain("under apps/portal, docs");
    for (const f of ["main-files.txt", "main-side.diff", "branch.diff"]) expect(q).toContain(f);
    expect(q).toContain("no drift found");
    expect(q).toContain("Do not modify any file.");
  });
});

let tmp = "";
let repo = "";
let since = "";
let mainTip = "";
let head = "";

function sh(args: string[]): string {
  const r = spawnSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    encoding: "utf8",
  });
  return String(r.stdout ?? "").trim();
}

function put(rel: string, text: string): void {
  mkdirSync(dirname(join(repo, rel)), { recursive: true });
  writeFileSync(join(repo, rel), text);
}

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "main-drift-"));
  repo = join(tmp, "shop");
  mkdirSync(repo);
  sh(["init", "-q", "-b", "main"]);
  put("apps/portal/styles.css", ".text-sm { font-size: 14px; }\n.text-base { font-size: 15px; }\n");
  put("apps/manager/y.ts", "export const y = 1;\n");
  sh(["add", "."]);
  sh(["commit", "-qm", "base"]);
  since = sh(["rev-parse", "HEAD"]);
  sh(["checkout", "-qb", "feature"]);
  put("apps/portal/Banner.tsx", 'export const Banner = () => <p className="text-sm">Hello</p>;\n');
  sh(["add", "."]);
  sh(["commit", "-qm", "banner"]);
  head = sh(["rev-parse", "HEAD"]);
  sh(["checkout", "-q", "main"]);
  put("apps/portal/styles.css", ".text-base { font-size: 15px; }\n");
  put("apps/manager/y.ts", "export const y = 2;\n");
  sh(["add", "."]);
  sh(["commit", "-qm", "typography: only the design styles"]);
  mainTip = sh(["rev-parse", "HEAD"]);
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const drift = (...args: string[]): { code: number; out: string; err: string } => {
  const r = spawnSync(SELF, ["main-drift", ...args], { encoding: "utf8", timeout: 60000 });
  return { code: r.status ?? 1, out: String(r.stdout ?? ""), err: String(r.stderr ?? "") };
};

describe("the command", () => {
  test("writes the question and the three files, and prints the surveyor call", () => {
    const out = join(tmp, "out-1");
    const r = drift(repo, since, mainTip, head, "--name", "drift-1", "--out", out);
    expect(r.code).toBe(0);
    expect(r.out).toContain("main moved by 1 commits since");
    expect(r.out).toContain("areas: apps/portal");
    for (const f of ["question.md", "main-files.txt", "main-side.diff", "branch.diff"]) {
      expect(existsSync(join(out, f))).toBe(true);
    }
    expect(r.out).toContain("run surveyor call <dispatch>");
    expect(r.out).toContain(`--snapshot ${head}`);
    expect(r.out).toContain(`--material ${join(out, "branch.diff")}`);
  });

  test("main-files.txt lists every file main changed, and main-side.diff only the branch's folders", () => {
    const out = join(tmp, "out-2");
    drift(repo, since, mainTip, head, "--name", "drift-2", "--out", out);
    const files = readFileSync(join(out, "main-files.txt"), "utf8");
    expect(files).toContain("apps/portal/styles.css");
    expect(files).toContain("apps/manager/y.ts");
    const side = readFileSync(join(out, "main-side.diff"), "utf8");
    expect(side).toContain("-.text-sm { font-size: 14px; }");
    expect(side).not.toContain("y.ts");
  });

  test("branch.diff is the branch's own change", () => {
    const out = join(tmp, "out-3");
    drift(repo, since, mainTip, head, "--name", "drift-3", "--out", out);
    expect(readFileSync(join(out, "branch.diff"), "utf8")).toContain(
      '+export const Banner = () => <p className="text-sm">Hello</p>;',
    );
  });

  test("by default the folder is under the repository's .postmaster", () => {
    const r = drift(repo, since, mainTip, head, "--name", "drift-4");
    expect(r.code).toBe(0);
    expect(existsSync(join(repo, ".postmaster", "drift", "drift-4", "question.md"))).toBe(true);
  });

  test("when main has not moved since, nothing is written", () => {
    const out = join(tmp, "out-5");
    const r = drift(repo, mainTip, mainTip, head, "--name", "drift-5", "--out", out);
    expect(r.code).toBe(0);
    expect(r.out).toContain("no drift check: main has not moved since");
    expect(existsSync(out)).toBe(false);
  });

  test("a revision git cannot read exits 1", () => {
    const r = drift(repo, "nope", mainTip, head, "--name", "x", "--out", join(tmp, "out-6"));
    expect(r.code).toBe(1);
    expect(r.err).toContain("git cannot read");
  });

  test("a diff over the byte budget is cut", () => {
    put("apps/portal/big.css", `${".x { color: red; }\n".repeat(400)}`);
    sh(["checkout", "-q", "feature"]);
    put("apps/portal/big.css", `${".y { color: blue; }\n".repeat(400)}`);
    sh(["add", "."]);
    sh(["commit", "-qm", "big"]);
    const bigHead = sh(["rev-parse", "HEAD"]);
    sh(["checkout", "-q", "main"]);
    rmSync(join(repo, "apps/portal/big.css"), { force: true });
    const out = join(tmp, "out-7");
    expect(
      drift(repo, since, mainTip, bigHead, "--name", "d7", "--out", out, "--max-bytes", "1500")
        .code,
    ).toBe(0);
    expect(readFileSync(join(out, "branch.diff"), "utf8")).toContain("... cut here:");
  });

  test("usage: a missing name, a bad name, a missing argument and a bad budget exit 2", () => {
    expect(drift(repo, since, mainTip, head).code).toBe(2);
    expect(drift(repo, since, mainTip, head, "--name", "a/b").code).toBe(2);
    expect(drift(repo, since, mainTip, "--name", "x").code).toBe(2);
    expect(drift(repo, since, mainTip, head, "--name", "x", "--max-bytes", "5").code).toBe(2);
  });
});
