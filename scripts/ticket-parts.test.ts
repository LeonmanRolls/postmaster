// Tests beside scripts/ticket-parts.ts. Every finding kind has a positive control (a fixture that
// must produce it) and a negative control (the same fixture corrected, which must not), both through
// the identical command: the wrapper, run on a file.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  analyze,
  countSentences,
  MAX_CRITERION_SENTENCES,
  MAX_CRITERION_WORDS,
  MAX_DECISION_WORDS,
} from "./ticket-parts.ts";

const SELF = join(import.meta.dir, "ticket-parts.sh");
const TEMPLATE = join(import.meta.dir, "..", "skills", "clerk", "ticket-template.md");
const TICK = "`";
const FENCE = "```";

let tmp = "";
let seq = 0;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "ticket-parts-"));
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

interface Out {
  code: number;
  findings: string[];
  notes: string[];
  err: string;
}

function cli(text: string, ...flags: string[]): Out {
  const file = join(tmp, `t${seq++}.md`);
  writeFileSync(file, text);
  const r = spawnSync(SELF, [file, ...flags], { encoding: "utf8", timeout: 20000 });
  const lines = String(r.stdout ?? "")
    .split("\n")
    .filter((l) => l !== "");
  return {
    code: r.status ?? 1,
    findings: lines.filter((l) => l.startsWith("line ")),
    notes: lines.filter((l) => !l.startsWith("line ")),
    err: String(r.stderr ?? ""),
  };
}

// The findings of one kind, as the lines the command printed.
function kind(out: Out, k: string): string[] {
  return out.findings.filter((l) => l.includes(`: ${k}: `));
}

function lineOf(text: string, needle: string): number {
  const at = text.split("\n").findIndex((l) => l.includes(needle));
  if (at < 0) throw new Error(`no line holds ${needle}`);
  return at + 1;
}

function edit(text: string, from: string, to: string): string {
  if (text.split(from).length !== 2) throw new Error(`${from} must occur exactly once`);
  return text.replace(from, () => to);
}

// A ticket in the two-part shape that is fit: no findings.
const FIT = [
  "## Problem / feature",
  "Something is wrong and the user wants it fixed.",
  "",
  "## Acceptance criteria",
  "1. The first thing is true when the work is done.",
  "2. The second thing is true when the work is done.",
  "",
  "## Decisions",
  "- **D1 (proposed)** The first choice. Why: the reason. Instead of: the other way.",
  "- **D2 (given by the user)** The second choice. Why: the reason. Instead of: the other way.",
  "",
  "## Out of scope",
  "- Nothing else.",
  "",
  "## Direction",
  "None: any approach that meets the criteria.",
  "",
  "## Turnpikes",
  "none",
  "",
  "## For the agents",
  "",
  "*Everything above is what the user signed off.*",
  "",
  "### Checks",
  "",
  "- **C1** Run it and see one. **At the base:** nothing.",
  "- **C2** Run it and see two. **At the base:** nothing.",
  "",
  "### Technical notes",
  "",
  "- The first note. (C1, D1)",
  "- The second note, over two lines",
  "  with the tag on the second. (C2, D2)",
  "",
  "### Verified at 0123abc",
  "",
  "- A premise, checked.",
  "",
].join("\n");

describe("the fit ticket", () => {
  test("exits 0 with no findings and prints the notes", () => {
    const out = cli(FIT);
    expect(out.findings).toEqual([]);
    expect(out.code).toBe(0);
    expect(out.notes).toContain("criteria 2, decisions 2, technical notes 2");
    expect(out.notes.some((n) => n.startsWith("plain part: ") && n.endsWith(" words"))).toBe(true);
  });

  test("counts the words of the plain part without its headings", () => {
    const plain = FIT.split("\n## For the agents")[0] ?? "";
    const words = plain
      .split("\n")
      .filter((l) => !l.startsWith("#"))
      .join(" ")
      .split(" ")
      .filter((w) => w !== "").length;
    expect(words).toBe(73);
    expect(analyze(FIT, false)?.notes[0]).toBe(`plain part: ${words} words`);
  });
});

describe("plain part: code", () => {
  test("a backtick is a finding, and the corrected line is not", () => {
    const span = `${TICK}x${TICK}`;
    const bad = edit(FIT, "Something is wrong", `Something is wrong with ${span}, and`);
    const out = cli(bad);
    expect(kind(out, "code")).toEqual([`line ${lineOf(bad, span)}: code: ${span}`]);
    expect(out.code).toBe(1);
    expect(kind(cli(FIT), "code")).toEqual([]);
  });

  test("a fenced block is one finding at its opening fence", () => {
    const bad = edit(
      FIT,
      "## Out of scope",
      [FENCE, "const x = 1;", FENCE, "## Out of scope"].join("\n"),
    );
    const out = cli(bad);
    expect(kind(out, "code")).toEqual([`line ${lineOf(bad, FENCE)}: code: fenced block`]);
    expect(kind(out, "file")).toEqual([]);
  });
});

describe("plain part: file", () => {
  const exts = [
    "ts",
    "tsx",
    "js",
    "mjs",
    "cjs",
    "json",
    "jsonl",
    "toml",
    "md",
    "sh",
    "py",
    "yml",
    "yaml",
    "lock",
    "txt",
  ];
  for (const ext of exts) {
    test(`a .${ext} file name is a finding`, () => {
      const bad = edit(FIT, "wants it fixed", `wants reach.${ext} fixed`);
      expect(kind(cli(bad), "file")).toEqual([`line ${lineOf(bad, "reach.")}: file: reach.${ext}`]);
    });
  }

  test("plain words, a version number and a site name are not files", () => {
    const ok = edit(FIT, "wants it fixed", "wants it fixed in version 1.5 by example.com");
    expect(kind(cli(ok), "file")).toEqual([]);
  });
});

describe("plain part: path", () => {
  const paths = [
    "scripts/launch",
    "skills/x",
    "docs/y",
    "src/z",
    "wiki/w",
    "lib/v",
    "tests/u",
    "~/notes",
    "/home/a/b",
    "/tmp/c",
    "/usr/d",
    "/etc/e",
    "/var/f",
    "/opt/g",
    ".postmaster/runs",
    ".worktrees/x",
    ".github/y",
  ];
  for (const p of paths) {
    test(`${p} is a finding`, () => {
      const bad = edit(FIT, "wants it fixed", `wants ${p} fixed`);
      expect(kind(cli(bad), "path")).toEqual([`line ${lineOf(bad, p)}: path: ${p}`]);
    });
  }

  test("and/or, yes/no and the home folder in words are not paths", () => {
    const ok = edit(
      FIT,
      "wants it fixed",
      "wants it fixed and/or checked, yes/no, in the home folder",
    );
    expect(kind(cli(ok), "path")).toEqual([]);
  });

  test("a path with a file name is one finding, not two", () => {
    const bad = edit(FIT, "wants it fixed", "wants scripts/reach.sh fixed");
    const out = cli(bad);
    expect(kind(out, "path").length).toBe(1);
    expect(kind(out, "file")).toEqual([]);
  });
});

describe("plain part: flag, line, call, identifier", () => {
  test("a double-dash word is a flag; a spaced double dash is not", () => {
    const bad = edit(FIT, "wants it fixed", "wants it fixed with --force");
    expect(kind(cli(bad), "flag")).toEqual([`line ${lineOf(bad, "--force")}: flag: --force`]);
    const ok = edit(FIT, "wants it fixed", "wants it fixed -- soon");
    expect(kind(cli(ok), "flag")).toEqual([]);
  });

  test("an anchor or the words line and a number are findings; online 2 is not", () => {
    const anchor = edit(FIT, "wants it fixed", "wants it fixed at #L12");
    expect(kind(cli(anchor), "line")).toEqual([`line ${lineOf(anchor, "#L12")}: line: #L12`]);
    const words = edit(FIT, "wants it fixed", "wants it fixed on line 198");
    expect(kind(cli(words), "line")).toEqual([`line ${lineOf(words, "line 198")}: line: line 198`]);
    const plural = edit(FIT, "wants it fixed", "wants it fixed on lines 3");
    expect(kind(cli(plural), "line").length).toBe(1);
    const ok = edit(
      FIT,
      "wants it fixed",
      "wants it fixed online 2 times, baseline 3, in line with it",
    );
    expect(kind(cli(ok), "line")).toEqual([]);
  });

  test("a name followed by () is a call; the bare name is not", () => {
    const bad = edit(FIT, "wants it fixed", "wants run() fixed");
    expect(kind(cli(bad), "call")).toEqual([`line ${lineOf(bad, "run()")}: call: run()`]);
    expect(kind(cli(edit(FIT, "wants it fixed", "wants run fixed")), "call")).toEqual([]);
  });

  test("a snake_case or constant identifier is a finding; kebab-case and plain words are not", () => {
    const bad = edit(FIT, "wants it fixed", "wants merge_authority fixed");
    expect(kind(cli(bad), "identifier")).toEqual([
      `line ${lineOf(bad, "merge_")}: identifier: merge_authority`,
    ]);
    const caps = edit(FIT, "wants it fixed", "wants MAX_SAFE_INTEGER fixed");
    expect(kind(cli(caps), "identifier").length).toBe(1);
    const ok = edit(FIT, "wants it fixed", "wants the kebab-case-name fixed");
    expect(kind(cli(ok), "identifier")).toEqual([]);
  });
});

describe("plain part: codelink", () => {
  const bad = ["blob/abc/x", "tree/abc/x", "commit/abc"];
  for (const tail of bad) {
    test(`a link with /${tail} is a code link`, () => {
      const text = edit(
        FIT,
        "wants it fixed",
        `wants it fixed, see https://github.com/o/r/${tail}`,
      );
      const out = cli(text);
      expect(kind(out, "codelink").length).toBe(1);
      expect(kind(out, "file")).toEqual([]);
      expect(kind(out, "path")).toEqual([]);
    });
  }

  test("raw.githubusercontent is a code link, and its anchor is a line", () => {
    const text = edit(
      FIT,
      "wants it fixed",
      "wants it fixed, see https://raw.githubusercontent.com/o/r/m/a_b.ts#L5",
    );
    const out = cli(text);
    expect(kind(out, "codelink").length).toBe(1);
    expect(kind(out, "line").length).toBe(1);
    expect(kind(out, "identifier")).toEqual([]);
  });

  test("a link to an issue or a pull request is fine", () => {
    const text = edit(
      FIT,
      "wants it fixed",
      "wants it fixed, see https://github.com/o/r/issues/245 and https://github.com/o/r/pull/246",
    );
    expect(cli(text).findings).toEqual([]);
  });
});

describe("plain part: mark", () => {
  test("a model name, or no mark, is a finding; the two marks are not", () => {
    const named = edit(FIT, "**D1 (proposed)**", "**D1 (SomeModel)**");
    expect(kind(cli(named), "mark")).toEqual([
      `line ${lineOf(named, "D1")}: mark: D1 has the mark (SomeModel); use (proposed) or (given by the user)`,
    ]);
    const none = edit(FIT, "**D1 (proposed)**", "**D1**");
    expect(kind(cli(none), "mark")[0]).toContain("D1 has the mark none");
    const both = edit(FIT, "**D1 (proposed)**", "**D1 (proposed | given by the user)**");
    expect(kind(cli(both), "mark").length).toBe(1);
    expect(kind(cli(FIT), "mark")).toEqual([]);
  });
});

describe("agents' part: part", () => {
  test("each missing section is a finding at the agents heading; the full ticket is not", () => {
    const at = lineOf(FIT, "## For the agents");
    const noChecks = edit(FIT, "### Checks", "### Checking");
    expect(kind(cli(noChecks), "part")).toEqual([
      `line ${at}: part: no "### Checks" section under "## For the agents"`,
    ]);
    const noNotes = edit(FIT, "### Technical notes", "### Notes");
    expect(kind(cli(noNotes), "part")).toEqual([
      `line ${at}: part: no "### Technical notes" section under "## For the agents"`,
    ]);
    const noVerified = edit(FIT, "### Verified at 0123abc", "### Premises");
    expect(kind(cli(noVerified), "part")).toEqual([
      `line ${at}: part: no "### Verified at <sha>" section under "## For the agents"`,
    ]);
    expect(kind(cli(FIT), "part")).toEqual([]);
  });

  test("Verified at needs 7 to 40 hex characters", () => {
    for (const sha of ["<base sha>", "later", "0123ab", "0123abcg", "0".repeat(41)]) {
      const bad = edit(FIT, "0123abc", sha);
      expect(kind(cli(bad), "part")[0]).toContain("needs a commit of 7 to 40 hex characters");
    }
    for (const sha of ["0123abc", "0123ABC", "0".repeat(40)]) {
      expect(kind(cli(edit(FIT, "0123abc", sha)), "part")).toEqual([]);
    }
  });

  test("a plain part with no numbered criteria is a finding", () => {
    const bad = edit(
      edit(FIT, "1. The first thing is true when the work is done.", "The first thing."),
      "2. The second thing is true when the work is done.",
      "The second thing.",
    );
    const out = cli(bad);
    expect(kind(out, "part")).toEqual([
      `line ${lineOf(bad, "## Acceptance criteria")}: part: the plain part has no numbered acceptance criteria`,
    ]);
  });
});

describe("agents' part: check", () => {
  test("bare numbers are unlabelled items", () => {
    const bad = edit(edit(FIT, "- **C1** Run it", "1. Run it"), "- **C2** Run it", "2. Run it");
    const out = cli(bad);
    const text = kind(out, "check").join("\n");
    expect(text).toContain(
      'item 1 has no criterion id; start it with its id in bold, such as "- **C1**"',
    );
    expect(text).toContain(
      'item 2 has no criterion id; start it with its id in bold, such as "- **C2**"',
    );
    expect(text).toContain("no check for C1");
    expect(text).toContain("no check for C2");
  });

  test("a missing, an extra, a repeated and an out-of-order check are named", () => {
    const missing = edit(FIT, "- **C2** Run it and see two. **At the base:** nothing.\n", "");
    expect(kind(cli(missing), "check")).toEqual([
      `line ${lineOf(missing, "### Checks")}: check: no check for C2`,
    ]);
    const extra = edit(
      FIT,
      "- **C2** Run it",
      "- **C2** Run it and see two. **At the base:** nothing.\n- **C3** Run it",
    );
    expect(kind(cli(extra), "check")).toEqual([
      `line ${lineOf(extra, "**C3**")}: check: C3 has no criterion: the plain part has 2`,
    ]);
    const twice = edit(FIT, "- **C2** Run it", "- **C1** Run it");
    const twiceOut = kind(cli(twice), "check").join("\n");
    expect(twiceOut).toContain("C1 appears twice");
    expect(twiceOut).toContain("no check for C2");
    const swapped = edit(
      edit(FIT, "- **C1** Run it and see one.", "- **C2** Run it and see one."),
      "- **C2** Run it and see two.",
      "- **C1** Run it and see two.",
    );
    const swappedOut = kind(cli(swapped), "check");
    expect(swappedOut[0]).toContain("C2 is out of order; expected C1 here");
    expect(kind(cli(FIT), "check")).toEqual([]);
  });

  test("the list marker and the bold are free, the label is not", () => {
    for (const [from, to] of [
      ["- **C1**", "- C1"],
      ["- **C1**", "* **C1**"],
      ["- **C1**", "1. **C1**"],
      ["- **C1**", "- **C1.**"],
      ["- **C1**", "- **C1:**"],
      ["- **C1**", "- C1)"],
    ]) {
      expect(kind(cli(edit(FIT, from, to)), "check")).toEqual([]);
    }
    for (const to of ["- **c1**", "- **Check 1**", "- **C**", "- **C-1**"]) {
      expect(kind(cli(edit(FIT, "- **C1**", to)), "check").length).toBeGreaterThan(0);
    }
  });

  test("a paragraph before the list and indented sub-items are not checks", () => {
    const intro = edit(
      FIT,
      "- **C1** Run it",
      "Every check runs the same layout.\n\n- **C1** Run it",
    );
    expect(kind(cli(intro), "check")).toEqual([]);
    const sub = edit(
      FIT,
      "- **C1** Run it and see one.",
      "- **C1** Run it and see one.\n  - a detail\n  1. another detail",
    );
    expect(kind(cli(sub), "check")).toEqual([]);
  });
});

describe("agents' part: note and decision", () => {
  test("a note with no tag group is a finding; with one it is not", () => {
    const bad = edit(FIT, "The first note. (C1, D1)", "The first note.");
    expect(kind(cli(bad), "note")).toEqual([
      `line ${lineOf(bad, "The first note.")}: note: technical note has no tag group such as (C9, D5): The first note.`,
    ]);
    expect(kind(cli(FIT), "note")).toEqual([]);
  });

  test("a tag group may sit anywhere in the note, on any of its lines", () => {
    const mid = edit(FIT, "The first note. (C1, D1)", "The first (C1, D1) note, then more.");
    expect(kind(cli(mid), "note")).toEqual([]);
  });

  test("a tag group citing an id that does not exist is a finding", () => {
    for (const bad of ["(C3, D1)", "(C1, D3)", "(C0)", "(D9)", "(C99)"]) {
      const text = edit(FIT, "The first note. (C1, D1)", `The first note. ${bad} (C1, D1)`);
      const out = kind(cli(text), "note");
      expect(out.length).toBe(1);
      expect(out[0]).toContain("which does not exist");
    }
    expect(
      kind(cli(edit(FIT, "The first note. (C1, D1)", "The first note. (C2, D2) (C1, D1)")), "note"),
    ).toEqual([]);
  });

  test("a bare D or C, a tag in an inline code span and a tag in a fenced block are not tags", () => {
    const bare = edit(
      FIT,
      "The first note. (C1, D1)",
      "The first note, where D = R and (C) is a name. (C1, D1)",
    );
    expect(kind(cli(bare), "note")).toEqual([]);
    const inline = edit(
      FIT,
      "The first note. (C1, D1)",
      `The first note, written like ${TICK}(C9, D9)${TICK}. (C1, D1)`,
    );
    expect(kind(cli(inline), "note")).toEqual([]);
    const fenced = edit(
      FIT,
      "The first note. (C1, D1)",
      ["The first note. (C1, D1)", "", FENCE, "f(C9, D9)", FENCE].join("\n"),
    );
    expect(kind(cli(fenced), "note")).toEqual([]);
    const onlyInCode = edit(
      FIT,
      "The first note. (C1, D1)",
      ["The first note.", "", FENCE, "(C1, D1)", FENCE].join("\n"),
    );
    expect(kind(cli(onlyInCode), "note").length).toBe(1);
  });

  test("a decision that no tag group cites is a finding at the decision", () => {
    const bad = edit(FIT, "(C2, D2)", "(C2)");
    expect(kind(cli(bad), "decision")).toEqual([
      `line ${lineOf(bad, "**D2")}: decision: D2 is not cited by any tag group in the agents' part`,
    ]);
    expect(kind(cli(FIT), "decision")).toEqual([]);
  });

  test("a tag in a check counts as a citation", () => {
    const text = edit(
      edit(FIT, "(C2, D2)", "(C2)"),
      "- **C2** Run it and see two.",
      "- **C2** Run it and see two (D2).",
    );
    expect(kind(cli(text), "decision")).toEqual([]);
  });

  test("a decision declared twice is a finding", () => {
    const bad = edit(FIT, "**D2 (given by the user)**", "**D1 (given by the user)**");
    const out = kind(cli(bad), "decision");
    expect(out.join("\n")).toContain("D1 is declared twice");
  });
});

describe("the draft marker", () => {
  const DRAFT = `DRAFT: not approved, do not implement from this file\n\n${FIT}`;

  test("without --final the marker line is ignored", () => {
    const out = cli(DRAFT);
    expect(out.findings).toEqual([]);
    expect(out.code).toBe(0);
  });

  test("with --final it is a finding on its own line; a ticket without it is fit", () => {
    const out = cli(DRAFT, "--final");
    expect(kind(out, "draft")).toEqual([
      "line 1: draft: DRAFT: not approved, do not implement from this file",
    ]);
    expect(out.code).toBe(1);
    const fit = cli(FIT, "--final");
    expect(fit.findings).toEqual([]);
    expect(fit.code).toBe(0);
  });

  test("only a first non-empty line counts", () => {
    const later = edit(FIT, "Something is wrong", "DRAFT: noted. Something is wrong");
    expect(kind(cli(later, "--final"), "draft")).toEqual([]);
    const afterBlank = `\n\n${DRAFT}`;
    expect(kind(cli(afterBlank, "--final"), "draft")[0]).toContain("line 3: draft");
  });
});

describe("the notes", () => {
  const words = (n: number): string => Array(n).fill("word").join(" ");

  test("a long criterion is advice and the exit stays 0", () => {
    const bad = edit(
      FIT,
      "The first thing is true when the work is done.",
      words(MAX_CRITERION_WORDS + 1),
    );
    const out = cli(bad);
    expect(out.code).toBe(0);
    expect(out.notes).toContain(
      `criterion 1 (line ${lineOf(bad, "word word")}): ${MAX_CRITERION_WORDS + 1} words, 1 sentences: may be more than one idea`,
    );
    const edge = edit(
      FIT,
      "The first thing is true when the work is done.",
      words(MAX_CRITERION_WORDS),
    );
    expect(cli(edge).notes.some((n) => n.includes("may be more than one idea"))).toBe(false);
  });

  test("a criterion of more than two sentences is advice", () => {
    const bad = edit(
      FIT,
      "The first thing is true when the work is done.",
      "One thing. Two things. Three things.",
    );
    expect(
      cli(bad).notes.some((n) => n.startsWith("criterion 1") && n.includes("3 sentences")),
    ).toBe(true);
    const edge = edit(
      FIT,
      "The first thing is true when the work is done.",
      "One thing. Two things.",
    );
    expect(cli(edge).notes.some((n) => n.includes("may be more than one idea"))).toBe(false);
  });

  test("a long decision is advice, counted without its mark", () => {
    const long = edit(
      FIT,
      "The first choice. Why: the reason. Instead of: the other way.",
      words(MAX_DECISION_WORDS + 1),
    );
    expect(
      cli(long).notes.some(
        (n) => n.startsWith("decision D1") && n.includes(`${MAX_DECISION_WORDS + 1} words`),
      ),
    ).toBe(true);
    const edge = edit(
      FIT,
      "The first choice. Why: the reason. Instead of: the other way.",
      words(MAX_DECISION_WORDS),
    );
    expect(cli(edge).notes.some((n) => n.includes("may be more than one idea"))).toBe(false);
  });

  test("the limits are the ones the ticket names", () => {
    expect([MAX_CRITERION_WORDS, MAX_CRITERION_SENTENCES, MAX_DECISION_WORDS]).toEqual([30, 2, 60]);
  });

  test("sentences: abbreviations, decimals, links and code are not ends", () => {
    expect(countSentences("One thing.")).toBe(1);
    expect(countSentences("One thing. Two things. Three.")).toBe(3);
    expect(countSentences("It does e.g. this, i.e. that, etc. and more.")).toBe(1);
    expect(countSentences("It takes 1.5 seconds on version 2.0.")).toBe(1);
    expect(countSentences("See https://example.com/a.b. Then stop.")).toBe(2);
    expect(countSentences("It runs `a. B` here. Then stops.")).toBe(2);
    expect(countSentences("No final stop")).toBe(1);
    expect(countSentences("Why not? Because. Stop!")).toBe(3);
    expect(countSentences("")).toBe(0);
  });
});

describe("exit codes and usage", () => {
  test("1 for findings, 0 for fit, findings printed before the notes", () => {
    const bad = edit(FIT, "wants it fixed", "wants reach.sh fixed");
    const r = spawnSync(SELF, [writeTmp(bad)], { encoding: "utf8" });
    expect(r.status).toBe(1);
    const lines = String(r.stdout)
      .split("\n")
      .filter((l) => l !== "");
    expect(lines[0]).toBe(`line ${lineOf(bad, "reach.sh")}: file: reach.sh`);
    expect(lines[1]).toMatch(/^plain part: [0-9]+ words$/u);
  });

  test("2 for an unreadable file, no agents heading, and usage", () => {
    const missing = spawnSync(SELF, [join(tmp, "nope.md")], { encoding: "utf8" });
    expect(missing.status).toBe(2);
    expect(String(missing.stderr)).toContain("cannot read");
    const noHeading = cli(edit(FIT, "## For the agents", "## Notes"));
    expect(noHeading.code).toBe(2);
    expect(noHeading.err).toContain('no "## For the agents" section');
    expect(noHeading.findings).toEqual([]);
    for (const args of [[], ["a", "b"], ["--nope"], ["--final"]]) {
      const r = spawnSync(SELF, args, { encoding: "utf8" });
      expect(r.status).toBe(2);
      expect(String(r.stderr)).toContain("usage: ticket-parts.sh <body-file> [--final]");
    }
  });

  test("a byte-order mark and Windows line ends are read as plain text", () => {
    const crlf = `﻿${FIT.split("\n").join("\r\n")}`;
    expect(cli(crlf).findings).toEqual([]);
    expect(cli(crlf).code).toBe(0);
  });
});

function writeTmp(text: string): string {
  const file = join(tmp, `t${seq++}.md`);
  writeFileSync(file, text);
  return file;
}

describe("the template's example", () => {
  const block = (): string => {
    const t = readFileSync(TEMPLATE, "utf8");
    const open = t.indexOf("```markdown\n");
    const close = t.indexOf("\n```\n", open + 1);
    if (open < 0 || close < 0) throw new Error("no markdown block in the template");
    return `${t.slice(open + "```markdown\n".length, close)}\n`;
  };

  test("with a hex sha filled in, it is fit under --final", () => {
    const out = cli(block().replace("<base sha>", "0123abc"), "--final");
    expect(out.findings).toEqual([]);
    expect(out.code).toBe(0);
  });

  test("with the sha left as the placeholder, or a model's name in a mark, it is not", () => {
    const placeholder = cli(block());
    expect(kind(placeholder, "part")[0]).toContain("needs a commit");
    const named = cli(
      block().replace("<base sha>", "0123abc").replace("(proposed)", "(SomeModel)"),
    );
    expect(kind(named, "mark").length).toBe(1);
  });
});
