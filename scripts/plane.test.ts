// Tests beside scripts/plane.ts, moved from its --self-test on #109: 46 controls.
// criteria() is a local rework of the self-test's inline helper; failure detail comes from expect.
// The stalled-API control carries a 60000ms timeout: its cutoff fires at 30s.
// The no-arguments control expects the usage line without the removed " | --self-test" suffix.
// CLI controls share one temp root, cleaned up in afterAll, instead of one dir per control.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pyWords } from "./lib/text";
import {
  api,
  BOLD,
  codeLang,
  DieError,
  endTagOf,
  envOf,
  FENCE,
  firstDifference,
  htmlToText,
  LINK_RE,
  makeNode,
  mdCode,
  mdHeading,
  mdLink,
  mdToHtml,
  type Node,
  ORDERED,
  paraLines,
  parseAttrs,
  parseId,
  planEdit,
  readback,
  shape,
  Tree,
  textOf,
} from "./plane";

const wrapper = join(import.meta.dir, "run");

function cli(
  args: string[],
  env?: Record<string, string | undefined>,
  cwd?: string,
): { code: number; out: string; err: string } {
  const r = spawnSync(wrapper, ["plane", ...args], { encoding: "utf8", env, cwd });
  return { code: r.status ?? -1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

const body = `${[
  "## Problem / feature\nA ticket reaches a coachman with no criteria, so it has nothing to judge the lanes against.",
  "## Acceptance criteria\n1. The check exits 0 on a well-formed ticket and prints how many criteria it has.\n2. It exits 2 and names each missing part:\n   - the title\n   - the direction\n   1. a nested number is part of criterion 2, not a criterion\n\n   ```\n   ## Direction\n   ticket-check.sh --body draft.md   # which draft? TODO\n   ```\n3. A question or a marker in code, `a?` or `TODO`, is not read,\nand a line that runs straight on belongs to the criterion above it.\n\n   So does an indented paragraph after a blank line.",
  "## Direction\n<!-- a template comment is not read: TBD -->\nNone: any approach that meets the criteria.",
  "## Turnpikes\n<!-- default, none, or turnpike names -->\n`default`",
  "## Notes\nA heading inside a fenced block is not a section:\n\n```\n## Direction\n```",
].join("\n\n")}\n`;

const editor =
  '<h2 class="editor-heading-block">Acceptance criteria</h2>' +
  '<ol class="list-decimal pl-7 space-y-[--list-spacing-y] tight" data-tight="true">' +
  '<li class="not-prose space-y-2"><p class="editor-paragraph-block">The check runs.</p></li>' +
  '<li class="not-prose space-y-2"><p class="editor-paragraph-block">It names each part.</p></li>' +
  '</ol><p class="editor-paragraph-block"></p>';

function criteria(h: string): number {
  const kids = new Tree(h).root.children.filter((c): c is Node => typeof c !== "string");
  for (let k = 0; k < kids.length - 1; k++) {
    const c = kids[k]!;
    if (
      c.tag === "h2" &&
      pyWords(textOf(c)).join(" ") === "Acceptance criteria" &&
      kids[k + 1]?.tag === "ol"
    ) {
      return kids[k + 1]?.children.filter((x) => typeof x !== "string" && x.tag === "li").length;
    }
  }
  return 0;
}

const [outHtml, readbackDiff] = readback(body);
const once = htmlToText(outHtml);
const baseText = htmlToText(editor);
const nestedHtml =
  "<ul><li><p>a</p><ol><li><p>b</p></li><li><p>c</p></li></ol></li><li><p>d</p></li></ul>";
const nestedText = htmlToText(nestedHtml);

let root = "";

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "plane-"));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("positive controls", () => {
  test("the ticket-check fixture reads back with the same words and structure", () => {
    expect(readbackDiff).toBeNull();
  }, 30000);

  test("it keeps exactly 3 top-level criteria, and one Direction heading", () => {
    expect(criteria(mdToHtml(once))).toBe(3);
    expect(mdToHtml(once).split("<h2>Direction</h2>").length - 1).toBe(1);
  }, 30000);

  test("a line running straight on stays in its criterion, and a comment stays hidden", () => {
    const runsOn =
      "3. A question or a marker in code, `a?` or `TODO`, is not read, and a line that runs straight on";
    expect(once.includes(runsOn)).toBe(true);
    expect(outHtml.includes("template comment")).toBe(false);
  }, 30000);

  test("a code block in a criterion keeps its less indented lines", () => {
    const h = mdToHtml("1. Runs:\n   ```\n## not a heading\n\nnot indented\n   ```\n2. Names.");
    expect(h.split("<ol").length - 1).toBe(1);
    expect(h.split("<li>").length - 1).toBe(2);
    expect(
      h.includes("<li><p>Runs:</p><pre><code>## not a heading\n\nnot indented\n</code></pre></li>"),
    ).toBe(true);
  }, 30000);

  test("the writer drops a heading's closing #s and a code span's padding, and keeps a hard break", () => {
    const h = mdToHtml("## Direction ##\n\nuse ``a`b`` and `` `x `` here\\\nnext line");
    expect(h).toBe(
      "<h2>Direction</h2>\n<p>use <code>a`b</code> and <code>`x</code> here<br>next line</p>",
    );
  }, 30000);

  test("a second cycle gives the same text", () => {
    expect(htmlToText(mdToHtml(once))).toBe(once);
  }, 30000);

  test("Plane editor lists read as one line per item", () => {
    expect(htmlToText(editor).includes("1. The check runs.\n2. It names each part.")).toBe(true);
  }, 30000);

  test("blank lines between items leave one list of three", () => {
    const h = mdToHtml("1. A\n\n2. B\n\n3. C");
    expect(h.split("<ol").length - 1).toBe(1);
    expect(h.split("<li>").length - 1).toBe(3);
  }, 30000);

  test("nested lists read back indented", () => {
    expect(nestedText).toBe("- a\n  1. b\n  2. c\n- d");
  }, 30000);

  test("and render to the same structure", () => {
    expect(firstDifference(shape(nestedHtml), shape(mdToHtml(nestedText)))).toBeNull();
  }, 30000);

  test("a code block keeps its language", () => {
    const out = htmlToText('<pre><code class="language-python">print("x")\n</code></pre>');
    expect(out).toBe('```python\nprint("x")\n```');
    expect(mdToHtml(out).includes('class="language-python"')).toBe(true);
  }, 30000);

  test("links survive: an href with parentheses, mailto and a relative one", () => {
    const links =
      '<p>See <a href="https://en.wikipedia.org/wiki/Foo_(bar)">Foo</a>, ' +
      '<a href="mailto:a@example.org">mail</a> and <a href="/docs/x">docs</a>.</p>';
    const linksText = htmlToText(links);
    expect(firstDifference(shape(links), shape(mdToHtml(linksText)))).toBeNull();
    expect(linksText.includes("Foo_%28bar%29")).toBe(true);
  }, 30000);

  test("line breaks, rules, a list's start and two lists in a row survive", () => {
    const misc =
      '<p>one<br>two</p><hr><ol start="3"><li><p>c</p></li></ol>' +
      "<ul><li><p>x</p></li></ul><ul><li><p>y</p></li></ul>";
    const miscText = htmlToText(misc);
    expect(firstDifference(shape(misc), shape(mdToHtml(miscText)))).toBeNull();
    expect(miscText.includes("one\\\ntwo")).toBe(true);
    expect(miscText.includes("---")).toBe(true);
    expect(miscText.includes("3. c")).toBe(true);
    expect(miscText.includes("- x")).toBe(true);
    expect(miscText.includes("* y")).toBe(true);
  }, 30000);

  test("edit writes stored editor HTML back with the approved part added and the list kept", () => {
    const [editCode, editOut] = planEdit(
      editor,
      `${baseText}\n`,
      `${baseText}\n\n## Direction\n\nNone: any approach that meets the criteria.\n`,
    );
    expect(editCode).toBe(0);
    expect(editOut.includes("<h2>Direction</h2>")).toBe(true);
    expect(editOut.split("<li>").length - 1).toBe(2);
  }, 30000);
});

describe("negative controls", () => {
  test("edit refuses markup read does not render, and names it", () => {
    const bad = '<p>x <em>y</em></p><table><tr><td>z</td></tr></table><img src="a.png"><!-- c -->';
    const [code, why] = planEdit(bad, htmlToText(bad), "## Direction\n\nNone.");
    expect(code).toBe(1);
    for (const s of ["<em>", "<table>", "<img>", "an HTML comment"]) {
      expect(why.includes(s)).toBe(true);
    }
  }, 30000);

  test("edit refuses a description read does not show as stored", () => {
    const [code, why] = planEdit("<p>1. not a list</p>", "1. not a list", "x");
    expect(code).toBe(1);
    expect(why.includes("as Plane stores it")).toBe(true);
  }, 30000);

  test("edit refuses a work item that changed since the base was read", () => {
    const [code] = planEdit(editor, `${baseText}\n\nAn edit made in Plane since.`, "x");
    expect(code).toBe(4);
  }, 30000);

  test("edit refuses an empty body", () => {
    const [code, why] = planEdit(editor, baseText, " \n\n");
    expect(code).toBe(1);
    expect(why.includes("empty")).toBe(true);
  }, 30000);

  test("the read-back check reports a lost list item", () => {
    const lost = firstDifference(
      shape(mdToHtml("1. A\n2. B\n3. C")),
      shape(mdToHtml("1. A\n2. B")),
    );
    expect(lost?.includes("a list item")).toBe(true);
  }, 30000);

  test("the read-back check reports a flattened list", () => {
    const flat = firstDifference(
      shape(mdToHtml("1. A\n   - x\n   - y")),
      shape(mdToHtml("1. A\n- x\n- y")),
    );
    expect(flat?.includes("a bullet list")).toBe(true);
  }, 30000);

  test("a body a reader would flatten is refused", () => {
    const [, diff] = readback("1. A\n   - x\n   - y\n", (ht) =>
      htmlToText(ht).replace(/\n {3}- /gu, "\n- "),
    );
    expect(diff?.includes("a bullet list")).toBe(true);
  }, 30000);
});

describe("CLI and API behavior", () => {
  test("the old edit form, with a title, is a usage error before any request", () => {
    const dir = join(root, "old-edit");
    mkdirSync(dir, { recursive: true });
    const cfg = join(dir, "config.toml");
    const bf = join(dir, "body.md");
    writeFileSync(cfg, '[tracker]\nkind = "plane"\nurl = "http://127.0.0.1:9"\nworkspace = "ws"\n');
    writeFileSync(bf, body);
    const r = cli(["edit", "PM-1", "A title", bf], {
      ...process.env,
      POSTMASTER_CONFIG: cfg,
      PLANE_API_KEY: "self-test",
    });
    expect(r.code).toBe(1);
    expect(r.err.includes("usage:")).toBe(true);
    expect(r.err.includes("GET")).toBe(false);
  }, 30000);

  test("a project binding that does not match the machine workspace is refused", () => {
    const bd = join(root, "binding-bad");
    mkdirSync(join(bd, "proj", ".postmaster"), { recursive: true });
    const cfg = join(bd, "config.toml");
    writeFileSync(cfg, '[tracker]\nkind = "plane"\nurl = "http://127.0.0.1:9"\nworkspace = "ws"\n');
    writeFileSync(
      join(bd, "proj", ".postmaster", "project.toml"),
      '[tracker]\nbinding = "other-ws"\n',
    );
    const r = cli(
      ["read"],
      {
        ...process.env,
        POSTMASTER_CONFIG: cfg,
        PLANE_API_KEY: "self-test",
        POSTMASTER_PROJECT: join(bd, "proj"),
      },
      bd,
    );
    expect(r.code).toBe(1);
    expect(r.err.includes("does not match the machine workspace")).toBe(true);
  }, 30000);

  test("a matching binding reaches usage, with no request", () => {
    const bd = join(root, "binding-good");
    mkdirSync(join(bd, "proj", ".postmaster"), { recursive: true });
    const cfg = join(bd, "config.toml");
    writeFileSync(cfg, '[tracker]\nkind = "plane"\nurl = "http://127.0.0.1:9"\nworkspace = "ws"\n');
    writeFileSync(join(bd, "proj", ".postmaster", "project.toml"), '[tracker]\nbinding = "ws"\n');
    const r = cli(
      ["read"],
      {
        ...process.env,
        POSTMASTER_CONFIG: cfg,
        PLANE_API_KEY: "self-test",
        POSTMASTER_PROJECT: join(bd, "proj"),
      },
      bd,
    );
    expect(r.code).toBe(1);
    expect(r.err.includes("usage:")).toBe(true);
    expect(r.err.includes("does not match")).toBe(false);
  }, 30000);

  test("with no project in scope the check is skipped and usage follows", () => {
    const bd = join(root, "binding-none");
    mkdirSync(bd, { recursive: true });
    const cfg = join(bd, "config.toml");
    writeFileSync(cfg, '[tracker]\nkind = "plane"\nurl = "http://127.0.0.1:9"\nworkspace = "ws"\n');
    const scoped: Record<string, string | undefined> = {
      ...process.env,
      POSTMASTER_CONFIG: cfg,
      PLANE_API_KEY: "self-test",
    };
    delete scoped.POSTMASTER_PROJECT;
    scoped.GIT_CEILING_DIRECTORIES = bd;
    const r = cli(["read"], scoped, bd);
    expect(r.code).toBe(1);
    expect(r.err.includes("usage:")).toBe(true);
    expect(r.err.includes("does not match")).toBe(false);
  }, 30000);

  test("no arguments prints BASE's usage line without reading any config", () => {
    const env: Record<string, string | undefined> = {
      ...process.env,
      POSTMASTER_CONFIG: join(root, "no-config.toml"),
    };
    delete env.PLANE_API_KEY;
    const r = cli([], env);
    expect(r.code).toBe(1);
    expect(r.out).toBe("");
    expect(r.err).toBe(
      "plane: usage: run plane projects|create|edit|read|state|comment|list ...\n",
    );
  }, 30000);

  test("a stalled API is cut off after 30 seconds with BASE's words", async () => {
    const held: Array<{ destroy: () => void }> = [];
    const stall = createServer((sock) => {
      held.push(sock);
      sock.on("error", () => {});
    });
    await new Promise<void>((resolve) => stall.listen(0, "127.0.0.1", () => resolve()));
    const port = (stall.address() as { port: number }).port;
    const t0 = Date.now();
    let msg = "";
    try {
      await api(
        { BASE: `http://127.0.0.1:${port}`, WS: "ws", KEY: "self-test" },
        "GET",
        "workspaces/ws/projects",
      );
    } catch (e) {
      msg = e instanceof DieError ? e.msg : String(e);
    }
    const secs = (Date.now() - t0) / 1000;
    for (const sock of held) sock.destroy();
    await new Promise<void>((resolve) => stall.close(() => resolve()));
    expect(msg).toBe("GET workspaces/ws/projects: timed out");
    expect(secs >= 29 && secs < 45).toBe(true);
  }, 60000);
});

describe("BASE parity", () => {
  test("ORDERED takes an Arabic-Indic number like BASE", () => {
    expect(ORDERED.test("\u0661. x")).toBe(true);
  }, 30000);

  test("FENCE info crosses a CR like BASE", () => {
    expect(FENCE.test("```\rfoo")).toBe(true);
  }, 30000);

  test("LINK_RE refuses a U+001C url like BASE", () => {
    expect("[a](b\x1cc)".match(LINK_RE)).toBeNull();
  }, 30000);

  test("BOLD refuses a U+001C close like BASE", () => {
    expect("**a\x1c**".match(BOLD)).toBeNull();
  }, 30000);

  test("attrs read through U+001C like BASE", () => {
    expect(parseAttrs('b\x1c="c"').b).toBe("c");
  }, 30000);

  test("end tags split at U+001C like BASE", () => {
    expect(endTagOf("a\x1c")).toBe("a");
  }, 30000);

  test("end tags keep U+FEFF like BASE", () => {
    expect(endTagOf("\ufeffa")).toBe("\ufeffa");
  }, 30000);

  test("mdCode splits U+001C like BASE", () => {
    const codeNode = makeNode("code");
    codeNode.children.push("a\x1cb");
    expect(mdCode(codeNode)).toBe("`a b`");
  }, 30000);

  test("mdLink splits U+001C like BASE", () => {
    const linkNode = makeNode("a", { href: "u" });
    linkNode.children.push("a\x1cb");
    expect(mdLink(linkNode)).toBe("[a b](u)");
  }, 30000);

  test("paraLines splits U+001C like BASE", () => {
    expect(paraLines(["a\x1cb"]).join("|")).toBe("a b");
  }, 30000);

  test("mdHeading splits U+001C like BASE", () => {
    const headNode = makeNode("h2");
    headNode.children.push("a\x1cb");
    expect(mdHeading(headNode).join("|")).toBe("## a b");
  }, 30000);

  test("codeLang splits U+001C like BASE", () => {
    const preNode = makeNode("pre", { class: "" });
    preNode.children.push(makeNode("code", { class: "language-p\x1cq" }));
    expect(codeLang(preNode)).toBe("p");
  }, 30000);

  test("fence langs split U+001C like BASE", () => {
    expect(mdToHtml("```p\x1cq\nx\n```").includes('language-p"')).toBe(true);
  }, 30000);

  test("shape splits U+001C like BASE", () => {
    expect(shape("<code>a\x1cb</code>").join(" ").includes("<code a b>")).toBe(true);
  }, 30000);

  test("criteria read through U+001C like BASE", () => {
    expect(criteria("<h2>Acceptance\x1ccriteria</h2><ol><li>x</li></ol>")).toBe(1);
  }, 30000);

  test("parseId reads an Arabic-Indic tail like BASE", () => {
    const tid = parseId("A-\u0661\u0662");
    expect(tid[0]).toBe("A");
    expect(tid[1]).toBe(12);
  }, 30000);

  test("env lines refuse NBSP like bash", () => {
    expect(envOf("export\u00a0A=x")).toBeNull();
  }, 30000);

  test("env lines refuse a FEFF like bash", () => {
    expect(envOf("\ufeffexport A=x")).toBeNull();
  }, 30000);

  test("env lines keep matching plain exports", () => {
    expect(envOf("export A=x")).toEqual(["A", "x"]);
  }, 30000);
});
