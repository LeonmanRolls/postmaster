// Tests beside scripts/project-notes.ts. Every case builds an invented "shop" project with notes,
// a rule file and a registered "acme-wiki" source in its own scratch folder, and runs the command
// as a subprocess, so what is asserted is what the postmaster would see.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const SELF = join(import.meta.dir, "run");

interface Out {
  code: number;
  out: string;
  err: string;
}

let tmp = "";
let seq = 0;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "project-notes-"));
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function put(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

const RULES_JSON = JSON.stringify({
  rules: [
    { id: "no-any", rule: "Never use any.", severity: "high", scope: ["**/*.ts"] },
    { id: "type-attr", rule: "Buttons need a type.", severity: "medium", scope: ["apps/**/*.tsx"] },
    {
      id: "own-client",
      rule: "Use the wrapper client.",
      severity: "medium",
      scope: ["packages/client/**"],
    },
    { id: "short", rule: "Keep files short.", severity: "low" },
  ],
});

const WIKI_TS = [
  "# Acme TypeScript",
  "",
  "### Name booleans with a prefix (Default)",
  "",
  "A boolean is named isX, hasX or canX.",
  "",
  "### Never mutate arguments (Must)",
  "",
  "Copy before you change.",
  "",
  "### Prefer short files (Guideline)",
  "",
  "Under five hundred lines.",
].join("\n");

const NOTES = [
  "# Shop notes",
  "",
  "Background: who owns what.",
  "",
  "<!-- route: waybill -->",
  "Serve the run's own app on port 4300.",
  "",
  "<!-- route: waybill, implement; scope: apps/shop/** -->",
  "Text sizes are the design styles only.",
  "",
  "<!-- route: clerk -->",
  "Check the library docs before deciding.",
  "",
  "<!-- rules: .review/config.json; format: json-rules; gate: high, medium -->",
  "<!-- rules: source:acme-wiki/standards/ts.md; format: headings; gate: Must, Default; advisory: Guideline; parts: style, implement -->",
  "<!-- reads: source:acme-wiki/INDEX.md, STYLEGUIDE.md; parts: clerk, style -->",
].join("\n");

interface Scratch {
  repo: string;
  wiki: string;
  config: string;
  run1: string;
}

/** A shop project with notes, a rule file, a wiki that is a git repository, and an empty run folder. */
function scratch(notes: string | null = NOTES): Scratch {
  seq += 1;
  const dir = join(tmp, `case-${seq}`);
  const repo = join(dir, "shop");
  const wiki = join(dir, "wiki");
  const run1 = join(dir, "run-1");
  put(join(wiki, "INDEX.md"), "# Acme wiki index\n");
  put(join(wiki, "standards", "ts.md"), WIKI_TS);
  const git = (...args: string[]): void => {
    spawnSync("git", ["-C", wiki, "-c", "user.name=t", "-c", "user.email=t@t", ...args], {
      encoding: "utf8",
    });
  };
  git("init", "-q");
  git("add", ".");
  git("commit", "-qm", "wiki");
  put(join(repo, ".review", "config.json"), RULES_JSON);
  put(join(repo, "STYLEGUIDE.md"), "# Shop style guide\n");
  if (notes !== null) put(join(repo, ".postmaster", "notes.md"), notes);
  mkdirSync(run1, { recursive: true });
  const config = join(dir, "config.toml");
  put(
    config,
    `[sources.acme-wiki]\npath = "${wiki}"\nabout = "Acme standards"\napplies_to = ["${dir}/*"]\n`,
  );
  return { repo, wiki, config, run1 };
}

function pn(s: Scratch, ...args: string[]): Out {
  const r = spawnSync(SELF, ["project-notes", ...args], {
    encoding: "utf8",
    timeout: 60000,
    env: { ...process.env, POSTMASTER_CONFIG: s.config },
  });
  return { code: r.status ?? 1, out: String(r.stdout ?? ""), err: String(r.stderr ?? "") };
}

describe("check", () => {
  test("a project with no notes file is fine and prints nothing", () => {
    const s = scratch(null);
    expect(pn(s, "check", s.repo)).toEqual({ code: 0, out: "", err: "" });
  });

  test("the notes say in words what each part would receive", () => {
    const s = scratch();
    const r = pn(s, "check", s.repo);
    expect(r.code).toBe(0);
    expect(r.out).toContain("clerk: ");
    expect(r.out).toContain("waybill: 15 words");
    expect(r.out).toMatch(/implement: [0-9]+ words, 7 rules/u);
    expect(r.out).toContain("rules: 7, 5 gate");
  });

  test("text copied nowhere is listed, so nothing vanishes unseen", () => {
    const s = scratch();
    expect(pn(s, "check", s.repo).out).toContain(
      "background (line 1, copied nowhere): # Shop notes",
    );
  });

  test("a source the machine does not register is a problem", () => {
    const s = scratch("<!-- reads: source:nowhere/INDEX.md; parts: clerk -->");
    const r = pn(s, "check", s.repo);
    expect(r.code).toBe(1);
    expect(r.out).toContain(
      'problem: source:nowhere/INDEX.md: no source named "nowhere" is registered',
    );
  });

  test("a file the notes name but that does not exist is a problem", () => {
    const s = scratch("<!-- reads: MISSING.md; parts: clerk -->");
    const r = pn(s, "check", s.repo);
    expect(r.code).toBe(1);
    expect(r.out).toContain("problem: MISSING.md: no such file");
  });

  test("a path that leaves the project or the source is a problem", () => {
    const s = scratch("<!-- reads: ../outside.md, source:acme-wiki/../x.md; parts: clerk -->");
    const r = pn(s, "check", s.repo);
    expect(r.code).toBe(1);
    expect(r.out).toContain("../outside.md: the path leaves the project");
    expect(r.out).toContain("source:acme-wiki/../x.md: the path leaves the source's folder");
  });

  test("a link that leads out of the project or the source is refused, one that stays in is read", () => {
    const s = scratch(
      "<!-- reads: linked.md, source:acme-wiki/standards/leak.md, inside.md; parts: clerk -->",
    );
    const secret = join(dirname(s.repo), "secret.md");
    put(secret, "private\n");
    symlinkSync(secret, join(s.repo, "linked.md"));
    symlinkSync(secret, join(s.wiki, "standards", "leak.md"));
    symlinkSync("STYLEGUIDE.md", join(s.repo, "inside.md"));
    const r = pn(s, "check", s.repo);
    expect(r.code).toBe(1);
    expect(r.out).toContain("linked.md: the path leaves the project");
    expect(r.out).toContain(
      "source:acme-wiki/standards/leak.md: the path leaves the source's folder",
    );
    expect(r.out).not.toContain("inside.md");
  });

  test("a syntax problem in the notes is named with its line", () => {
    const s = scratch("<!-- route: cook -->\ntext");
    const r = pn(s, "check", s.repo);
    expect(r.code).toBe(1);
    expect(r.out).toContain('problem: line 1: "cook" is not a part of the flow');
  });

  test("a part over its budget is refused", () => {
    const long = Array(301).fill("word").join(" ");
    const s = scratch(`<!-- route: security -->\n${long}`);
    const r = pn(s, "check", s.repo);
    expect(r.code).toBe(1);
    expect(r.out).toContain("security: 301 words routed, over its budget of 300");
  });

  test("a rule file that does not read is a problem", () => {
    const s = scratch("<!-- rules: STYLEGUIDE.md; format: json-rules; gate: high -->");
    const r = pn(s, "check", s.repo);
    expect(r.code).toBe(1);
    expect(r.out).toContain("STYLEGUIDE.md: not JSON");
  });
});

describe("an area", () => {
  test("a note and a rule whose scope cannot reach the area are left out", () => {
    const s = scratch();
    const r = pn(s, "check", s.repo, "--area", "apps/docs/**");
    expect(r.out).toContain("waybill: 8 words");
    expect(r.out).toContain("rules: 6, 4 gate");
  });

  test("a rule scoped to another folder is dropped, and one that applies stays", () => {
    const s = scratch();
    const r = pn(s, "preview", s.repo, "--area", "packages/client/**");
    expect(r.out).toContain("own-client (medium)");
    expect(r.out).not.toContain("type-attr");
  });

  test("an area flag with no glob is a usage error", () => {
    const s = scratch();
    expect(pn(s, "check", s.repo, "--area").code).toBe(2);
  });
});

describe("preview and clerk", () => {
  test("preview prints each part's text after the summary", () => {
    const s = scratch();
    const r = pn(s, "preview", s.repo);
    expect(r.out).toContain("=== waybill ===");
    expect(r.out).toContain("Serve the run's own app on port 4300.");
    expect(r.out).toContain("=== style ===");
    expect(r.out).toContain(
      "- never-mutate-arguments (Must): Never mutate arguments. Copy before you change.",
    );
  });

  test("the clerk's part names the files as they are on this machine", () => {
    const s = scratch();
    const r = pn(s, "clerk", s.repo);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Check the library docs before deciding.");
    expect(r.out).toContain(join(s.wiki, "INDEX.md"));
    expect(r.out).toContain("on this machine");
  });

  test("a clerk with nothing routed to it prints nothing", () => {
    const s = scratch("<!-- route: waybill -->\nonly the waybill");
    expect(pn(s, "clerk", s.repo)).toEqual({ code: 0, out: "", err: "" });
  });

  test("the clerk refuses notes that have a problem", () => {
    const s = scratch("<!-- route: cook -->\ntext");
    expect(pn(s, "clerk", s.repo).code).toBe(1);
  });
});

describe("sources", () => {
  test("lists each registered source and whether it is proposed for the repo", () => {
    const s = scratch();
    const r = pn(s, "sources", s.repo);
    expect(r.code).toBe(0);
    expect(r.out).toBe(`acme-wiki\tapplies\t${s.wiki}\tAcme standards\n`);
  });
});

describe("bundle", () => {
  test("writes each part, the rules, the copies and their record into the run", () => {
    const s = scratch();
    const r = pn(s, "bundle", s.repo, s.run1, "--area", "apps/shop/**");
    expect(r.code).toBe(0);
    expect(r.out).toContain("bundled: 4 files, 6 rules");
    for (const f of ["clerk", "waybill", "implement", "style", "waybill-section"]) {
      expect(existsSync(join(s.run1, "notes", `${f}.md`))).toBe(true);
    }
    expect(existsSync(join(s.run1, "notes", "security.md"))).toBe(false);
    expect(readFileSync(join(s.run1, "sources", "acme-wiki", "standards", "ts.md"), "utf8")).toBe(
      WIKI_TS,
    );
    expect(existsSync(join(s.run1, "sources", "repo", ".review", "config.json"))).toBe(true);
  });

  test("the record names each file's hash and the commit of its source", () => {
    const s = scratch();
    pn(s, "bundle", s.repo, s.run1);
    const record = JSON.parse(readFileSync(join(s.run1, "sources.json"), "utf8")) as {
      files: Array<{ ref: string; sha256: string; bytes: number; commit: string }>;
    };
    const wiki = record.files.find((f) => f.ref === "source:acme-wiki/standards/ts.md");
    expect(wiki?.sha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(wiki?.bytes).toBe(WIKI_TS.length);
    expect(wiki?.commit).toMatch(/^[0-9a-f]{40}$/u);
  });

  test("the waybill section carries a note routed to two parts once", () => {
    const s = scratch();
    pn(s, "bundle", s.repo, s.run1, "--area", "apps/shop/**");
    const section = pn(s, "show", s.run1, "waybill-section");
    expect(section.out.startsWith("## Project notes\n")).toBe(true);
    expect(section.out.split("Text sizes are the design styles only.").length - 1).toBe(1);
    expect(section.out).toContain("### For the lane that writes the code");
    expect(section.out).toContain("Written rules to follow.");
    expect(section.out).toContain("break one only with a comment at the line that says why");
  });

  test("the style part says a violation of a rule that gates is fixed in round 1", () => {
    const s = scratch();
    pn(s, "bundle", s.repo, s.run1);
    const style = pn(s, "show", s.run1, "style").out;
    expect(style).toContain("Written rules to check.");
    expect(style).toContain(
      "Labels that gate: high, medium (.review/config.json); Must, Default (source:acme-wiki/standards/ts.md).",
    );
    expect(style).toContain("it is fixed in round 1, not deferred");
  });

  test("nothing is written when anything is wrong", () => {
    const s = scratch("<!-- reads: MISSING.md; parts: clerk -->");
    const r = pn(s, "bundle", s.repo, s.run1);
    expect(r.code).toBe(1);
    expect(r.err).toContain("nothing bundled");
    expect(existsSync(join(s.run1, "notes"))).toBe(false);
    expect(existsSync(join(s.run1, "sources.json"))).toBe(false);
  });

  test("a second bundle removes a part the notes no longer give", () => {
    const s = scratch();
    pn(s, "bundle", s.repo, s.run1);
    expect(existsSync(join(s.run1, "notes", "clerk.md"))).toBe(true);
    put(join(s.repo, ".postmaster", "notes.md"), "<!-- route: waybill -->\nonly this");
    expect(pn(s, "bundle", s.repo, s.run1).code).toBe(0);
    expect(existsSync(join(s.run1, "notes", "clerk.md"))).toBe(false);
    expect(existsSync(join(s.run1, "notes", "waybill-section.md"))).toBe(true);
  });

  test("a project with no notes bundles nothing and still succeeds", () => {
    const s = scratch(null);
    const r = pn(s, "bundle", s.repo, s.run1);
    expect(r.code).toBe(0);
    expect(existsSync(join(s.run1, "notes", "waybill-section.md"))).toBe(false);
  });
});

describe("show and rules", () => {
  test("a part with nothing prints nothing; an unknown part is a usage error", () => {
    const s = scratch();
    pn(s, "bundle", s.repo, s.run1);
    expect(pn(s, "show", s.run1, "security")).toEqual({ code: 0, out: "", err: "" });
    expect(pn(s, "show", s.run1, "cook").code).toBe(2);
  });

  test("rules lists each bundled rule with its label and whether it gates", () => {
    const s = scratch();
    pn(s, "bundle", s.repo, s.run1);
    const r = pn(s, "rules", s.run1);
    expect(r.out).toContain("- no-any (high) [gates]: Never use any.");
    expect(r.out).toContain("- short (low) [advisory]: Keep files short.");
    expect(r.out).toContain("- prefer-short-files (Guideline) [advisory]");
  });

  test("one rule is looked up by id, and an unknown id is refused", () => {
    const s = scratch();
    pn(s, "bundle", s.repo, s.run1);
    expect(pn(s, "rules", s.run1, "type-attr").out).toContain("type-attr (medium) [gates]");
    expect(pn(s, "rules", s.run1, "nope").code).toBe(1);
  });
});

describe("verify", () => {
  test("the waybill must carry the section word for word", () => {
    const s = scratch();
    pn(s, "bundle", s.repo, s.run1, "--area", "apps/shop/**");
    const section = pn(s, "show", s.run1, "waybill-section").out;
    expect(pn(s, "verify-waybill", s.run1).code).toBe(1);
    put(join(s.run1, "brief.md"), "# Waybill: 1\n\nsomething else\n");
    expect(pn(s, "verify-waybill", s.run1).code).toBe(1);
    put(join(s.run1, "brief.md"), `# Waybill: 1\n\n${section}\n## Team\n`);
    const ok = pn(s, "verify-waybill", s.run1);
    expect(ok.code).toBe(0);
    expect(ok.out).toContain("the waybill carries the project notes");
  });

  test("a waybill with an edited line fails", () => {
    const s = scratch();
    pn(s, "bundle", s.repo, s.run1);
    const section = pn(s, "show", s.run1, "waybill-section").out.replace("4300", "4301");
    put(join(s.run1, "brief.md"), section);
    expect(pn(s, "verify-waybill", s.run1).code).toBe(1);
  });

  test("a run with no project notes passes without a waybill check", () => {
    const s = scratch(null);
    pn(s, "bundle", s.repo, s.run1);
    expect(pn(s, "verify-waybill", s.run1).code).toBe(0);
  });

  test("a lens brief must carry its part", () => {
    const s = scratch();
    pn(s, "bundle", s.repo, s.run1);
    const style = pn(s, "show", s.run1, "style").out;
    expect(pn(s, "verify-brief", s.run1, "style").code).toBe(1);
    put(join(s.run1, "review-style-brief.md"), `# Style brief\n\n## Project notes\n\n${style}`);
    expect(pn(s, "verify-brief", s.run1, "style").code).toBe(0);
  });

  test("a lens with no part needs no brief text, and an unknown lens is a usage error", () => {
    const s = scratch();
    pn(s, "bundle", s.repo, s.run1);
    expect(pn(s, "verify-brief", s.run1, "security").code).toBe(0);
    expect(pn(s, "verify-brief", s.run1, "bug").code).toBe(2);
  });
});

describe("usage", () => {
  test("no command, an unknown command and missing arguments exit 2", () => {
    const s = scratch();
    expect(pn(s).code).toBe(2);
    expect(pn(s, "frobnicate", s.repo).code).toBe(2);
    expect(pn(s, "bundle", s.repo).code).toBe(2);
    expect(pn(s, "show", s.run1).code).toBe(2);
  });

  test("a project that is not a folder is refused", () => {
    const s = scratch();
    const r = pn(s, "check", join(tmp, "no-such-folder"));
    expect(r.code).toBe(1);
    expect(r.err).toContain("no such project directory");
  });
});
