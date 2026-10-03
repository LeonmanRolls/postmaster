// Tests beside scripts/ticket-check.ts, moved from its --self-test on #109: 154 controls.
// The self-test built later fixtures between controls and re-read shared files; fixtures are
// built here in beforeAll and each test writes its own body first, so every test passes alone
// as well as in file order. The TICKET helper is named expectCheck: expect is bun:test's.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toolRoot } from "./lib/paths.ts";
import { run } from "./lib/proc.ts";
import { DOT_ALL } from "./lib/text.ts";
import {
  clip,
  FENCE,
  FENCED_ITEM,
  HEADING,
  ITEM,
  MARK1,
  MARK2,
  MARK3,
  norm,
  QUESTION,
  QSPLIT,
} from "./ticket-check.ts";

const SELF = join(import.meta.dir, "ticket-check.sh");
const HERE = import.meta.dir;
const NOPE = "zz-not-listed";

delete process.env.POSTMASTER_PROJECT;

let tmp = "";
let DEF = "";
let N1 = "";
let N2 = "";
let N2UP = "";

const P =
  "## Problem / feature\nA ticket reaches a coachman with no criteria, so it has nothing to judge the lanes against.";
const A =
  "## Acceptance criteria\n1. The check exits 0 on a well-formed ticket and prints how many criteria it has.\n2. It exits 2 and names each missing part:\n   - the title\n   - the direction\n   1. a nested number is part of criterion 2, not a criterion\n\n   ```\n   ## Direction\n   ticket-check.sh --body draft.md   # which draft? TODO\n   ```\n3. A question or a marker in code, `a?` or `TODO`, is not read,\nand a line that runs straight on belongs to the criterion above it.\n\n   So does an indented paragraph after a blank line.";
const D =
  "## Direction\n<!-- a template comment is not read: TBD -->\nNone: any approach that meets the criteria.";
const K = "## Turnpikes\n<!-- default, none, or turnpike names -->\n`default`";
const N = "## Notes\nA heading inside a fenced block is not a section:\n\n```\n## Direction\n```";
const T = "Check a ticket's shape";
const NT =
  "## Notes\nContext.\n\n### Turnpikes\nWhy the default was chosen.\n\n### Out of scope\nNothing else.";
const UJ = "## User journey\nThe user opens the board and reads the ticket.";
const NOSTORE = 'case $2 in store) exit 3 ;; *) echo "stand-in local.sh: $*" >&2; exit 1 ;; esac';

const printedOf = (): string =>
  `id: #7\ntitle: ${T}\nstate: todo\nlabels: \ncreated: 2026-09-23\n\n${[P, A, D, K].join("\n\n")}\n\n## Log\n- 2026-09-25 10:00 postmaster: does a question here count?\n`;

const body = (...parts: string[]): void => {
  writeFileSync(join(tmp, "body.md"), `${parts.join("\n\n")}\n\n`);
};

const runCheck = (title: string): { code: number; out: string } => {
  const r = run("bash", [SELF, "--body", join(tmp, "body.md"), "--title", title], {
    env: { ...(process.env as Record<string, string>), TURNPIKES: join(HERE, "turnpikes.sh") },
  });
  return { code: r.code, out: r.out + r.err };
};

const expectCheck = (
  rcWant: number,
  partsWant: string,
  why = "",
  not = "",
  title: string = T,
): void => {
  const r = runCheck(title);
  const out = r.out;
  const rc = r.code;
  // BASE: only a failing check (exit 2) names parts; a pass prints "well-formed, ...".
  const partNames =
    (rc === 2
      ? out
          .split("\n")
          .filter((l) =>
            /^(title|problem \/ feature|acceptance criteria|direction|turnpikes): /u.test(l),
          )
          .map((l) => l.split(":")[0])
          .filter((v, i, a) => a.indexOf(v) === i)
          .sort()
          .join(",")
      : "") || "none";
  expect(rc).toBe(rcWant);
  expect(partNames).toBe(partsWant);
  if (why) expect(out.includes(why)).toBe(true);
  if (not) expect(out.includes(not)).toBe(false);
};

const named = (want: string): void => {
  const r = runCheck(T);
  const secondLine = r.out.split("\n")[1] ?? "";
  expect(r.code).toBe(0);
  expect(secondLine).toBe(want);
};

const adapter = (script: string): void => {
  writeFileSync(join(tmp, "bin", "github.sh"), `#!/usr/bin/env bash\n${script}\n`);
  chmodSync(join(tmp, "bin", "github.sh"), 0o755);
};

const through = (): { code: number; out: string } => {
  const r = run("bash", [join(tmp, "bin", "ticket-check.sh"), tmp, "7"], {
    env: {
      ...(process.env as Record<string, string>),
      POSTMASTER_CONFIG: join(tmp, "github.toml"),
    },
  });
  return { code: r.code, out: r.out + r.err };
};

const localsh = (script: string): void => {
  writeFileSync(join(tmp, "bin", "local.sh"), `#!/usr/bin/env bash\n${script}\n`);
  chmodSync(join(tmp, "bin", "local.sh"), 0o755);
};

const spliceRun = (): { code: number; out: string } => {
  const r = run("bash", [SELF, "--splice", join(tmp, "base.md"), join(tmp, "sections.md")], {
    env: process.env as Record<string, string>,
  });
  return { code: r.code, out: r.out + r.err };
};

const sameSplice = (
  base: string,
  sections: string,
  want: string,
): { code: number; out: string } => {
  writeFileSync(join(tmp, "base.md"), base);
  writeFileSync(join(tmp, "sections.md"), sections);
  writeFileSync(join(tmp, "want.md"), want);
  const wantText = readFileSync(join(tmp, "want.md"), "utf8");
  const r = spliceRun();
  expect(r.code).toBe(0);
  expect(r.out).toBe(wantText);
  return r;
};

const addTurnpike = (row: string, dir: string): void => {
  copyFileSync(join(HERE, "turnpikes.sh"), join(dir, "turnpikes.sh"));
  chmodSync(join(dir, "turnpikes.sh"), 0o755);
  const src = readFileSync(join(HERE, "turnpikes.ts"), "utf8");
  const out = src.replace(
    new RegExp("(const TABLE = `" + DOT_ALL + "*?)(`;)", "u"),
    (_m, a: string, b: string) => `${a}\n${row}${b}`,
  );
  writeFileSync(join(dir, "turnpikes.ts"), out);
};

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "postmaster-"));
  if (run("git", ["init", "-q", tmp]).code !== 0) throw new Error("git init failed");

  copyFileSync(join(toolRoot(import.meta), "bunfig.toml"), join(tmp, "bunfig.toml"));

  const listR = run(join(HERE, "turnpikes.sh"), ["--list"]);
  if (listR.code !== 0) throw new Error("test setup: turnpikes.sh --list failed");
  const listLines = listR.out.trim().split("\n").filter(Boolean);
  DEF = listLines
    // ASCII: turnpikes.sh --list emits ASCII slug-names; fields split on its runs.
    .filter((l) => l.split(/\s+/u)[1] === "default")
    // ASCII: turnpike slugs from --list are ASCII by the TABLE.
    .map((l) => l.split(/\s+/u)[0])
    .join(", ");
  // ASCII: turnpike slugs from --list are ASCII by the TABLE.
  N1 = listLines[0]?.split(/\s+/u)[0] ?? "";
  // ASCII: turnpike slugs from --list are ASCII by the TABLE.
  N2 = listLines[1]?.split(/\s+/u)[0] ?? "";
  // LOWER: turnpike slugs from --list are ASCII by the TABLE.
  N2UP = N2.charAt(0).toUpperCase() + N2.slice(1);
  if (!DEF || !N2)
    throw new Error("test setup: turnpikes.sh needs a default set and two turnpikes");
  // ASCII: turnpike slugs from --list are ASCII by the TABLE.
  if (listLines.some((l) => l.split(/\s+/u)[0] === NOPE)) {
    throw new Error(`test setup: ${NOPE} is a turnpike; pick another unused name`);
  }

  mkdirSync(join(tmp, "bin"), { recursive: true });
  copyFileSync(SELF, join(tmp, "bin", "ticket-check.sh"));
  copyFileSync(join(HERE, "ticket-check.ts"), join(tmp, "bin", "ticket-check.ts"));
  copyFileSync(join(HERE, "turnpikes.sh"), join(tmp, "bin", "turnpikes.sh"));
  copyFileSync(join(HERE, "turnpikes.ts"), join(tmp, "bin", "turnpikes.ts"));
  copyFileSync(join(HERE, "project-settings.sh"), join(tmp, "bin", "project-settings.sh"));
  copyFileSync(join(HERE, "project-settings.ts"), join(tmp, "bin", "project-settings.ts"));
  copyFileSync(join(HERE, "tracker-kind.sh"), join(tmp, "bin", "tracker-kind.sh"));
  copyFileSync(join(HERE, "tracker-kind.ts"), join(tmp, "bin", "tracker-kind.ts"));
  mkdirSync(join(tmp, "bin", "lib"), { recursive: true });
  for (const f of ["paths.ts", "proc.ts", "data.ts", "text.ts"]) {
    copyFileSync(join(HERE, "lib", f), join(tmp, "bin", "lib", f));
  }
  writeFileSync(join(tmp, "github.toml"), '[tracker]\nkind = "github"\n');
  localsh(NOSTORE);

  const project = join(tmp, "project-profile");
  mkdirSync(join(project, ".postmaster"), { recursive: true });
  writeFileSync(
    join(project, ".postmaster", "project.toml"),
    '[project]\ndefault_turnpikes = ["bug"]\n',
  );
  const emptyProject = join(tmp, "empty-project");
  mkdirSync(join(emptyProject, ".postmaster"), { recursive: true });
  writeFileSync(
    join(emptyProject, ".postmaster", "project.toml"),
    "[project]\ndefault_turnpikes = []\n",
  );

  writeFileSync(join(tmp, "printed.txt"), printedOf());
  writeFileSync(join(tmp, "printed-untitled.txt"), printedOf().replace(/^title: .*/mu, "title: "));

  for (const d of ["added", "broken", "alone"]) {
    mkdirSync(join(tmp, d), { recursive: true });
    copyFileSync(SELF, join(tmp, d, "ticket-check.sh"));
    copyFileSync(join(HERE, "ticket-check.ts"), join(tmp, d, "ticket-check.ts"));
    mkdirSync(join(tmp, d, "lib"), { recursive: true });
    for (const f of ["paths.ts", "proc.ts", "data.ts", "text.ts"]) {
      copyFileSync(join(HERE, "lib", f), join(tmp, d, "lib", f));
    }
  }
  addTurnpike(`${NOPE}  -        ship    a check the table does not have yet`, join(tmp, "added"));
  addTurnpike("none       -        review  nothing", join(tmp, "broken"));

  mkdirSync(join(tmp, "silent"), { recursive: true });
  copyFileSync(SELF, join(tmp, "silent", "ticket-check.sh"));
  copyFileSync(join(HERE, "ticket-check.ts"), join(tmp, "silent", "ticket-check.ts"));
  mkdirSync(join(tmp, "silent", "lib"), { recursive: true });
  for (const f of ["paths.ts", "proc.ts", "data.ts", "text.ts"]) {
    copyFileSync(join(HERE, "lib", f), join(tmp, "silent", "lib", f));
  }
  writeFileSync(join(tmp, "silent", "turnpikes.sh"), "#!/bin/sh\nexit 2\n");
  chmodSync(join(tmp, "silent", "turnpikes.sh"), 0o755);

  writeFileSync(join(tmp, "other.toml"), '[tracker]\nkind = "other"\nname = "notes"\n');
  writeFileSync(join(tmp, "broken.toml"), "[tracker\nkind = github\n");
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("positive controls", () => {
  test("a well-formed ticket passes", () => {
    body(P, A, D, K, N);
    expectCheck(0, "none");
  });

  test("it counts three criteria, not the nested number or the lines under them, then prints the turnpikes", () => {
    body(P, A, D, K, N);
    const r = runCheck(T);
    expect(r.out.trim()).toBe(`well-formed, 3 acceptance criteria\nturnpikes: ${DEF}`);
  });

  test("Notes and User journey are optional", () => {
    body(P, A, D, K);
    expectCheck(0, "none");
  });

  test("without --title only the body is judged", () => {
    body(P, A, D, K);
    const r = run("bash", [SELF, "--body", join(tmp, "body.md")], {
      env: { ...(process.env as Record<string, string>), TURNPIKES: join(HERE, "turnpikes.sh") },
    });
    expect(r.code).toBe(0);
  });

  test("headings match ignoring case, a colon, the slash's spacing and a closing #", () => {
    body(
      "## Problem/Feature\nTickets arrive without criteria.",
      "## Acceptance Criteria:\n1) The check runs on every ticket.",
      "## Direction ##\nUse the tracker adapters.",
      "## turnpikes:\ndefault",
    );
    expectCheck(0, "none");
  });

  test("a criterion's text may start on the line below its number", () => {
    body(
      P,
      "## Acceptance criteria\n1.\nThe check runs, the criterion's text on the line below its number.",
      D,
      K,
    );
    expectCheck(0, "none");
  });

  test("a list indented three spaces, and a thematic break after it", () => {
    body(
      P,
      "## Acceptance criteria\n   1. The check runs.\n   2. It names each part.\n\n---",
      D,
      K,
    );
    expectCheck(0, "none");
  });

  test("a question mark in quotes or inside a word is not a question", () => {
    body(
      P,
      '## Acceptance criteria\n1. Setup asks "Overwrite the config?" before writing, and prints https://example.org/board?view=kanban.\n2. The CLI prompts "Continue? [y/N]" before it deletes an item.',
      D,
      K,
    );
    expectCheck(0, "none");
  });

  test("a code span that wraps onto the next line is still code", () => {
    body(
      P,
      "## Acceptance criteria\n1. Setup prints `Overwrite the config?\n   [y/N]` and waits for an answer.",
      D,
      K,
    );
    expectCheck(0, "none");
  });

  test("a comment marker inside code hides nothing", () => {
    body(
      "## Problem / feature\nThe template parser fails when a body holds `<!--` with no closer.",
      "## Acceptance criteria\n1. The check runs.\n2. The arrow in `a --> b` is kept.",
      D,
      K,
    );
    expectCheck(0, "none");
  });

  test("a <!-- inside a line that the line does not close is text", () => {
    body("## Problem / feature\nThe parser fails on <!-- when nothing closes it.", A, D, K);
    expectCheck(0, "none");
  });

  test("a <!-- at the start of a line that nothing closes is text", () => {
    body(
      P,
      "<!-- a comment that never closes",
      A,
      "## Direction\nNone: any approach that meets the criteria.",
      "## Turnpikes\ndefault",
    );
    expectCheck(0, "none");
  });

  test("a comment inside a line is not read", () => {
    body(
      P,
      "## Acceptance criteria\n1. The check runs. <!-- TBD: more --> It names each part.",
      D,
      K,
    );
    expectCheck(0, "none");
  });

  test("a criterion that opens with a fenced block", () => {
    body(P, "## Acceptance criteria\n1. ```\n   make check\n   ```\n2. The gate passes.", D, K);
    expectCheck(0, "none");
  });

  test("a line opening with a three-backtick code span is not a fence", () => {
    body("## Problem / feature\n```ls``` prints nothing in an empty directory.", A, D, K);
    expectCheck(0, "none");
  });

  test("TODO as a word is not a mark", () => {
    body(
      "## Problem / feature\nThe app has no TODO list.",
      "## Acceptance criteria\n1. A user can add an item to the TODO list.",
      "## Direction\nStore TODO items in the existing database.",
      K,
    );
    const r = run("bash", [SELF, "--body", join(tmp, "body.md"), "--title", "Add a TODO list"], {
      env: { ...(process.env as Record<string, string>), TURNPIKES: join(HERE, "turnpikes.sh") },
    });
    expect(r.code).toBe(0);
  });

  test("a body with CRLF line endings passes", () => {
    writeFileSync(
      join(tmp, "body.md"),
      "## Problem / feature\r\nTickets arrive without criteria.\r\n\r\n## Acceptance criteria\r\n1. The check runs.\r\n\r\n## Direction\r\nNone.\r\n\r\n## Turnpikes\r\ndefault\r\n",
    );
    expectCheck(0, "none");
  });

  test("a byte-order mark hides no heading", () => {
    writeFileSync(
      join(tmp, "body.md"),
      Buffer.concat([
        new Uint8Array([0xef, 0xbb, 0xbf]),
        Buffer.from(`${[P, A, D, K].join("\n\n")}\n\n`),
      ]),
    );
    expectCheck(0, "none");
  });

  test("a body read from standard input", () => {
    body(P, A, D, K);
    const r = run(
      "bash",
      ["-c", `bash "${SELF}" --body /dev/stdin --title "${T}" < "${join(tmp, "body.md")}"`],
      {
        env: {
          ...(process.env as Record<string, string>),
          TURNPIKES: join(HERE, "turnpikes.sh"),
        },
      },
    );
    expect(r.code).toBe(0);
  });

  test("a ticket read through the adapter passes, its log included", () => {
    adapter(`cat -- '${join(tmp, "printed.txt")}'`);
    const r = through();
    expect(r.code).toBe(0);
  });
});

describe("positive controls: the turnpikes, as scripts/turnpikes.sh reads them", () => {
  test("default is checked against the target project's declaration", () => {
    body(P, A, D, K);
    const r = run(
      "bash",
      [
        SELF,
        "--body",
        join(tmp, "body.md"),
        "--title",
        T,
        "--project",
        join(tmp, "project-profile"),
      ],
      {
        env: {
          ...(process.env as Record<string, string>),
          TURNPIKES: join(HERE, "turnpikes.sh"),
        },
      },
    );
    expect(r.code).toBe(0);
    expect(r.out.split("\n").includes("turnpikes: bug")).toBe(true);
  });

  test("an empty project default does not add a review floor", () => {
    body(P, A, D, K);
    const r = run(
      "bash",
      [SELF, "--body", join(tmp, "body.md"), "--title", T, "--project", join(tmp, "empty-project")],
      {
        env: {
          ...(process.env as Record<string, string>),
          TURNPIKES: join(HERE, "turnpikes.sh"),
        },
      },
    );
    expect(r.code).toBe(0);
    expect(r.out.split("\n").includes("turnpikes: none")).toBe(true);
  });

  test("an explicitly empty --project is refused, never checked as discovery", () => {
    body(P, A, D, K);
    const r = run("bash", [SELF, "--body", join(tmp, "body.md"), "--title", T, "--project", ""], {
      env: { ...(process.env as Record<string, string>), TURNPIKES: join(HERE, "turnpikes.sh") },
    });
    expect(r.code).toBe(1);
    expect((r.out + r.err).includes("no such project directory")).toBe(true);
  });

  test("default, in a code span under a template comment, stands for the default set", () => {
    body(P, A, D, K);
    named(`turnpikes: ${DEF}`);
  });

  test("none passes, and names no turnpike", () => {
    body(P, A, D, "## Turnpikes\nnone");
    named("turnpikes: none");
  });

  test("a list passes, as the turnpikes it names", () => {
    body(P, A, D, `## Turnpikes\n- ${N2UP}\n- \`${N1}\``);
    named(`turnpikes: ${N1}, ${N2}`);
  });

  test("a thematic break in the section is not a turnpike", () => {
    body(P, A, D, "## Turnpikes\ndefault\n\n---", N);
    named(`turnpikes: ${DEF}`);
  });
});

describe("negative controls: each part is named on its own", () => {
  test("no title", () => {
    body(P, A, D, K, N);
    const r = run("bash", [SELF, "--body", join(tmp, "body.md"), "--title", ""], {
      env: { ...(process.env as Record<string, string>), TURNPIKES: join(HERE, "turnpikes.sh") },
    });
    expect(r.code).toBe(2);
    expect(r.out.includes("title: missing")).toBe(true);
  });

  test("a title in another script has words", () => {
    body(P, A, D, K, N);
    const r = run("bash", [SELF, "--body", join(tmp, "body.md"), "--title", "日本語のタイトル"], {
      env: {
        ...(process.env as Record<string, string>),
        TURNPIKES: join(HERE, "turnpikes.sh"),
      },
    });
    expect(r.code).toBe(0);
    expect(r.out.includes("title: missing")).toBe(false);
  });

  test("no title in the adapter's read", () => {
    adapter(`cat -- '${join(tmp, "printed-untitled.txt")}'`);
    const r = through();
    expect(r.code).toBe(2);
    expect(r.out.includes("title: missing")).toBe(true);
  });

  test("no problem or feature", () => {
    body(A, D, K, N);
    expectCheck(2, "problem / feature", 'no "## Problem / feature" section');
  });

  test("an empty problem or feature", () => {
    body("## Problem / feature", A, D, K);
    expectCheck(2, "problem / feature", "is empty");
  });

  test("a section in another script has words", () => {
    body(P, A, "## Direction\n日本語の方向。", K, N);
    const r = runCheck(T);
    expect(r.code).toBe(0);
    expect(r.out.includes("direction:")).toBe(false);
  });

  test("no acceptance criteria", () => {
    body(P, D, K, N);
    expectCheck(2, "acceptance criteria", 'no "## Acceptance criteria" section');
  });

  test("criteria that are not numbered", () => {
    body(P, "## Acceptance criteria\n- The check runs.\n- It names each part.", D, K);
    expectCheck(2, "acceptance criteria", "not a numbered list");
  });

  test("criteria numbered out of order", () => {
    body(
      P,
      "## Acceptance criteria\n1. The check runs.\n1. It names each part.\n1. It exits 2.",
      D,
      K,
    );
    expectCheck(2, "acceptance criteria", "numbered 1, 1, 1; number them 1 to 3 in order");
  });

  test("a criterion that asks a question", () => {
    body(P, "## Acceptance criteria\n1. The check runs.\n2. Should it also run at dispatch?", D, K);
    expectCheck(2, "acceptance criteria", "criterion 2 asks a question");
  });

  test("a question closed by emphasis", () => {
    body(
      P,
      "## Acceptance criteria\n1. The check runs.\n2. **Should it also run at dispatch?**",
      D,
      K,
    );
    expectCheck(2, "acceptance criteria", "criterion 2 asks a question");
  });

  test("a question closed by a bracket", () => {
    body(
      P,
      "## Acceptance criteria\n1. The check runs.\n2. It retries a few times (how many?).",
      D,
      K,
    );
    expectCheck(2, "acceptance criteria", "criterion 2 asks a question");
  });

  test("a full-width question mark", () => {
    body(
      P,
      "## Acceptance criteria\n1. The check runs.\n2. Should it also run at dispatch？",
      D,
      K,
    );
    expectCheck(2, "acceptance criteria", "criterion 2 asks a question");
  });

  test("the fault quotes the sentence that asks", () => {
    body(
      P,
      "## Acceptance criteria\n1. The check runs on every ticket before it is accepted.\n   Should it also run again at dispatch?",
      D,
      K,
    );
    expectCheck(
      2,
      "acceptance criteria",
      'criterion 1 asks a question: "Should it also run again at dispatch?"',
    );
  });

  test("a criterion marked TBD", () => {
    body(P, "## Acceptance criteria\n1. The check runs.\n2. The retry limit is TBD.", D, K);
    expectCheck(2, "acceptance criteria", "criterion 2 is marked TBD");
  });

  test("a criterion marked TODO:", () => {
    body(P, "## Acceptance criteria\n1. The check runs.\n2. TODO: decide the retry limit.", D, K);
    expectCheck(2, "acceptance criteria", "criterion 2 is marked TODO");
  });

  test("comment markers in code hide no criterion", () => {
    body(
      P,
      "## Acceptance criteria\n1. `<!--` opens a comment.\n2. The retry limit is TBD.\n3. `-->` closes one.",
      D,
      K,
    );
    expectCheck(2, "acceptance criteria", "criterion 2 is marked TBD");
  });

  test("an empty criterion", () => {
    body(P, "## Acceptance criteria\n1. The check runs.\n2.", D, K);
    expectCheck(2, "acceptance criteria", "criterion 2 is empty");
  });

  test("a criterion outside the numbered list", () => {
    body(
      P,
      "## Acceptance criteria\n1. The check runs.\n2. It names each part.\n\nAlso, the README names it,\nand the runbook.",
      D,
      K,
    );
    expectCheck(
      2,
      "acceptance criteria",
      'not part of a numbered criterion: "Also, the README names it,"',
    );
  });

  test("a paragraph outside the list is named once, not per line", () => {
    body(
      P,
      "## Acceptance criteria\n1. The check runs.\n2. It names each part.\n\nAlso, the README names it,\nand the runbook.",
      D,
      K,
    );
    const r = runCheck(T);
    expect(r.out.split("\n").filter((l) => l.includes("not part of")).length).toBe(1);
  });

  test("an unnumbered criterion straight after a numbered one", () => {
    body(P, "## Acceptance criteria\n1. The check runs.\n- It names each part.", D, K);
    expectCheck(
      2,
      "acceptance criteria",
      'not part of a numbered criterion: "- It names each part."',
    );
  });

  test("a heading straight after a criterion", () => {
    body(P, "## Acceptance criteria\n1. The check runs.\n### Details", D, K);
    expectCheck(2, "acceptance criteria", 'not part of a numbered criterion: "### Details"');
  });

  test("text after a stray block is not credited to the criterion above", () => {
    body(
      P,
      "## Acceptance criteria\n1. The check runs.\n\n```\na stray block\n```\nThe retry limit is TBD.",
      D,
      K,
    );
    expectCheck(
      2,
      "acceptance criteria",
      'not part of a numbered criterion: "```"',
      "criterion 1 is marked",
    );
  });

  test("acceptance criteria twice", () => {
    body(P, A, A, D, K);
    expectCheck(2, "acceptance criteria", "appears 2 times");
  });

  test("no direction, even with one inside a fenced block", () => {
    body(P, A, K, N);
    expectCheck(2, "direction", 'no "## Direction" section; one is needed even if');
  });

  test("a direction marked TBD", () => {
    body(P, A, "## Direction\nTBD, once the spike is done.", K);
    expectCheck(2, "direction", '"## Direction" is marked TBD');
  });

  test("a direction that says only TODO", () => {
    body(P, A, "## Direction\nTODO", K);
    expectCheck(2, "direction", '"## Direction" is marked TODO');
  });

  test("a direction written only in a comment is empty", () => {
    body(P, A, "## Direction\n<!-- None: any approach that meets the criteria. -->", K);
    expectCheck(2, "direction", '"## Direction" is empty');
  });

  test("a comment that starts a line hides everything up to the next -->", () => {
    body(P, "<!-- a comment that starts a line", A, D, K);
    expectCheck(2, "acceptance criteria,direction");
  });

  test("a direction at the wrong level", () => {
    body(P, A, "### Direction\nNone: any approach that meets the criteria.", K);
    expectCheck(2, "direction", '"### Direction" is there, at the wrong level');
  });

  test("a direction before the criteria", () => {
    body(P, D, A, K);
    expectCheck(2, "direction", '"## Direction" comes before "## Acceptance criteria"');
  });

  test("no turnpikes", () => {
    body(P, A, D, N);
    expectCheck(
      2,
      "turnpikes",
      'no "## Turnpikes" section; one is needed, holding default, none, or turnpike names',
    );
  });

  test("a ### Turnpikes in the notes, with no ## Turnpikes, is named at the wrong level", () => {
    body(P, A, D, NT);
    expectCheck(2, "turnpikes", '"### Turnpikes" is there, at the wrong level');
  });

  test("a list item that opens a fence is code, and names no turnpike", () => {
    body(P, A, D, "## Turnpikes\n- ```none\n  style, bug, security\n  ```");
    expectCheck(2, "turnpikes", "names no turnpike");
  });

  test("a turnpike scripts/turnpikes.sh does not list is named", () => {
    body(P, A, D, `## Turnpikes\n${N1}, ${NOPE}`);
    expectCheck(2, "turnpikes", `"${NOPE}" is not a turnpike`);
  });

  test("none listed with another turnpike", () => {
    body(P, A, D, `## Turnpikes\nnone, ${N1}`);
    expectCheck(2, "turnpikes", "none stands alone");
  });

  test("an empty turnpikes section", () => {
    body(P, A, D, "## Turnpikes");
    expectCheck(2, "turnpikes", '"## Turnpikes" is empty');
  });

  test("turnpikes marked TBD", () => {
    body(P, A, D, "## Turnpikes\nTBD");
    expectCheck(2, "turnpikes", '"## Turnpikes" is marked TBD');
  });

  test("turnpikes at the wrong level", () => {
    body(P, A, D, "### Turnpikes\ndefault");
    expectCheck(2, "turnpikes", '"### Turnpikes" is there, at the wrong level');
  });

  test("turnpikes before the direction", () => {
    body(P, A, K, D);
    expectCheck(2, "turnpikes", '"## Turnpikes" comes before "## Direction"');
  });

  test("turnpikes twice", () => {
    body(P, A, D, K, K);
    expectCheck(2, "turnpikes", '"## Turnpikes" appears 2 times');
  });

  test("an empty ticket names all five parts", () => {
    writeFileSync(join(tmp, "body.md"), "");
    expectCheck(2, "acceptance criteria,direction,problem / feature,title,turnpikes", "", "", "");
  });
});

describe("a turnpike is added in scripts/turnpikes.sh alone", () => {
  test("this check names a turnpike that turnpikes.sh does not list", () => {
    body(P, A, D, `## Turnpikes\ndefault, ${NOPE}`);
    const r = run("bash", [SELF, "--body", join(tmp, "body.md"), "--title", T], {
      env: { ...(process.env as Record<string, string>), TURNPIKES: join(HERE, "turnpikes.sh") },
    });
    expect(r.code).toBe(2);
    expect(r.out.includes(`"${NOPE}" is not a turnpike`)).toBe(true);
  });

  test("the same check passes it once turnpikes.sh lists it", () => {
    body(P, A, D, `## Turnpikes\ndefault, ${NOPE}`);
    const r = run(
      "bash",
      [join(tmp, "added", "ticket-check.sh"), "--body", join(tmp, "body.md"), "--title", T],
      {
        env: { ...(process.env as Record<string, string>) },
      },
    );
    expect(r.code).toBe(0);
    expect(r.out.split("\n")[1] ?? "").toBe(`turnpikes: ${DEF}, ${NOPE}`);
  });
});

describe("negative controls: a ticket that cannot be read is not a verdict", () => {
  test("no arguments is a usage error", () => {
    const r = run("bash", [SELF], { env: process.env as Record<string, string> });
    expect(r.code).toBe(1);
  });

  test("a missing body file is refused", () => {
    const r = run("bash", [SELF, "--body", join(tmp, "nowhere.md")], {
      env: process.env as Record<string, string>,
    });
    expect(r.code).toBe(1);
  });

  test("a tracker kind with no adapter script is refused, not judged", () => {
    const r = run("bash", [SELF, tmp, "7"], {
      env: {
        ...(process.env as Record<string, string>),
        POSTMASTER_CONFIG: join(tmp, "other.toml"),
      },
    });
    expect(r.code).toBe(1);
    expect(r.out.trim()).toBe("");
  });

  test("a config that does not parse is named as one", () => {
    const r = run("bash", [SELF, tmp, "7"], {
      env: {
        ...(process.env as Record<string, string>),
        POSTMASTER_CONFIG: join(tmp, "broken.toml"),
      },
    });
    expect(r.code).toBe(1);
    expect(r.err.includes("does not parse")).toBe(true);
  });

  test("an adapter that cannot read the ticket is exit 1, not a shape fault", () => {
    adapter('echo "github: no board" >&2; exit 3');
    const r = through();
    expect(r.code).toBe(1);
    expect(
      /^(title|problem \/ feature|acceptance criteria|direction|turnpikes): /u.test(r.out),
    ).toBe(false);
  });

  test("with no turnpikes.sh beside it, the check gives no verdict", () => {
    body(P, A, D, K);
    const r = run(
      "bash",
      [join(tmp, "alone", "ticket-check.sh"), "--body", join(tmp, "body.md"), "--title", T],
      {
        env: process.env as Record<string, string>,
      },
    );
    expect(r.code).toBe(1);
    expect(r.out.trim()).toBe("");
  });

  test("a turnpikes.sh whose table breaks its rules gives no verdict", () => {
    body(P, A, D, K);
    const r = run(
      "bash",
      [join(tmp, "broken", "ticket-check.sh"), "--body", join(tmp, "body.md"), "--title", T],
      {
        env: process.env as Record<string, string>,
      },
    );
    expect(r.code).toBe(1);
    expect(r.out.trim()).toBe("");
  });

  test("a turnpikes.sh that fails with nothing to say gives no verdict, never a pass", () => {
    body(P, A, D, K);
    const r = run(
      "bash",
      [join(tmp, "silent", "ticket-check.sh"), "--body", join(tmp, "body.md"), "--title", T],
      {
        env: process.env as Record<string, string>,
      },
    );
    expect(r.code).toBe(1);
    expect(r.out.trim()).toBe("");
  });
});

describe("positive controls: --splice changes the sections given and nothing else", () => {
  test("a missing direction goes between the criteria and the turnpikes", () => {
    sameSplice(
      `${[P, A, K].join("\n\n")}\n\n${N}\n`,
      `${D}\n`,
      `${[P, A, D, K].join("\n\n")}\n\n${N}\n`,
    );
  });

  test("the spliced body passes the check", () => {
    writeFileSync(
      join(tmp, "body.md"),
      sameSplice(
        `${[P, A, K].join("\n\n")}\n\n${N}\n`,
        `${D}\n`,
        `${[P, A, D, K].join("\n\n")}\n\n${N}\n`,
      ).out,
    );
    expectCheck(0, "none");
  });

  test("a missing turnpikes section goes between the direction and the notes", () => {
    sameSplice(
      `${[P, A, D].join("\n\n")}\n\n${N}\n`,
      `${K}\n`,
      `${[P, A, D, K].join("\n\n")}\n\n${N}\n`,
    );
  });

  test("and the spliced body passes, with the default turnpikes", () => {
    writeFileSync(
      join(tmp, "body.md"),
      sameSplice(
        `${[P, A, D].join("\n\n")}\n\n${N}\n`,
        `${K}\n`,
        `${[P, A, D, K].join("\n\n")}\n\n${N}\n`,
      ).out,
    );
    named(`turnpikes: ${DEF}`);
  });

  test("turnpikes go after the direction, even when a user journey comes before it", () => {
    sameSplice(
      `${[P, A, UJ, D].join("\n\n")}\n\n${N}\n`,
      `${K}\n`,
      `${[P, A, UJ, D, K].join("\n\n")}\n\n${N}\n`,
    );
  });

  test("and that spliced body passes", () => {
    writeFileSync(
      join(tmp, "body.md"),
      sameSplice(
        `${[P, A, UJ, D].join("\n\n")}\n\n${N}\n`,
        `${K}\n`,
        `${[P, A, UJ, D, K].join("\n\n")}\n\n${N}\n`,
      ).out,
    );
    named(`turnpikes: ${DEF}`);
  });

  test("the criteria are replaced where they stand", () => {
    const C = "## Acceptance criteria\n1. Only this criterion.";
    sameSplice(
      `${[P, A, D].join("\n\n")}\n\n${N}\n`,
      `${C}\n`,
      `${[P, C, D].join("\n\n")}\n\n${N}\n`,
    );
  });

  test("a direction written before the criteria moves after them", () => {
    sameSplice(
      `${[P, D, A].join("\n\n")}\n\n${N}\n`,
      `${D}\n`,
      `${[P, A, D].join("\n\n")}\n\n${N}\n`,
    );
  });

  test("a direction at the wrong level is replaced", () => {
    sameSplice(
      `${[P, A, "### Direction\nAn old approach."].join("\n\n")}\n\n${N}\n`,
      `${D}\n`,
      `${[P, A, D].join("\n\n")}\n\n${N}\n`,
    );
  });

  test("text before the first heading and a section outside the shape are kept", () => {
    const X = "## Context\nSeen twice this week.";
    sameSplice(
      `${["Reported in the forum.", P, X, A].join("\n\n")}\n\n${N}\n`,
      `${D}\n`,
      `${["Reported in the forum.", P, X, A, D].join("\n\n")}\n\n${N}\n`,
    );
  });

  test("a missing part goes after the part before it and the sections outside the shape that follow it", () => {
    const X = "## Context\nSeen twice this week.";
    sameSplice(
      `${["Reported in the forum.", P, X, D, K].join("\n\n")}\n\n${N}\n`,
      `${A}\n`,
      `${["Reported in the forum.", P, X, A, D, K].join("\n\n")}\n\n${N}\n`,
    );
  });

  test("blank lines at the end of the body are kept, byte for byte", () => {
    writeFileSync(join(tmp, "base.md"), `${[P, A, N].join("\n\n")}\n\n\n`);
    writeFileSync(join(tmp, "sections.md"), `${D}\n`);
    writeFileSync(join(tmp, "want.md"), `${[P, A, D, N].join("\n\n")}\n\n\n`);
    const r = spliceRun();
    expect(r.code).toBe(0);
    expect(r.out).toBe(readFileSync(join(tmp, "want.md"), "utf8"));
  });
});

describe("negative controls: --splice refuses sections it cannot place", () => {
  const badBase = `${[P, A, N].join("\n\n")}\n\n\n`;

  test("text before the first heading of the sections", () => {
    writeFileSync(join(tmp, "base.md"), badBase);
    writeFileSync(join(tmp, "sections.md"), `Use the adapters.\n\n${D}\n`);
    expect(spliceRun().code).toBe(1);
  });

  test("a section that is not at level two", () => {
    writeFileSync(join(tmp, "base.md"), badBase);
    writeFileSync(join(tmp, "sections.md"), "### Direction\nUse the adapters.\n");
    expect(spliceRun().code).toBe(1);
  });

  test("the same section twice", () => {
    writeFileSync(join(tmp, "base.md"), badBase);
    writeFileSync(join(tmp, "sections.md"), `${D}\n\n${D}\n`);
    expect(spliceRun().code).toBe(1);
  });

  test("a ### Turnpikes in the notes is neither deleted nor left beside a new one", () => {
    writeFileSync(join(tmp, "base.md"), `${[P, A, D].join("\n\n")}\n\n${NT}\n`);
    writeFileSync(join(tmp, "sections.md"), `${K}\n`);
    const r = spliceRun();
    expect(r.code).toBe(1);
    expect(r.out.includes('"### Turnpikes" stands inside a later part')).toBe(true);
  });

  test("a stale ### Direction in the notes is not left beside the new one", () => {
    writeFileSync(
      join(tmp, "base.md"),
      `${[P, A, "## Notes\nContext.\n\n### Direction\nAn old approach."].join("\n\n")}\n`,
    );
    writeFileSync(join(tmp, "sections.md"), `${D}\n`);
    const r = spliceRun();
    expect(r.code).toBe(1);
    expect(r.out.includes('"### Direction" stands inside a later part')).toBe(true);
  });
});

describe("controls: a repo whose local ticket store exists is read through local.sh, whatever the config names", () => {
  test("a repo with a store is read through local.sh, though the config names github", () => {
    localsh(
      `case $2 in store) exit 0 ;; read) : > '${join(tmp, "local-read")}'; cat -- '${join(tmp, "printed.txt")}' ;; *) exit 1 ;; esac`,
    );
    adapter(`: > '${join(tmp, "github-read")}'; exit 1`);
    rmSync(join(tmp, "local-read"), { force: true });
    rmSync(join(tmp, "github-read"), { force: true });
    const r = through();
    expect(r.code).toBe(0);
    expect(existsSync(join(tmp, "local-read"))).toBe(true);
    expect(existsSync(join(tmp, "github-read"))).toBe(false);
  });

  test("a repo with no store is read through the kind the config names", () => {
    localsh(`case $2 in store) exit 3 ;; *) : > '${join(tmp, "local-read")}'; exit 1 ;; esac`);
    adapter(`: > '${join(tmp, "github-read")}'; cat -- '${join(tmp, "printed.txt")}'`);
    rmSync(join(tmp, "local-read"), { force: true });
    rmSync(join(tmp, "github-read"), { force: true });
    const r = through();
    expect(r.code).toBe(0);
    expect(existsSync(join(tmp, "github-read"))).toBe(true);
    expect(existsSync(join(tmp, "local-read"))).toBe(false);
  });

  test("a store that cannot be looked for stops the check, and no adapter is read", () => {
    localsh(
      `case $2 in store) echo 'local: not a git repository' >&2; exit 1 ;; *) : > '${join(tmp, "local-read")}'; exit 1 ;; esac`,
    );
    adapter(`: > '${join(tmp, "github-read")}'; cat -- '${join(tmp, "printed.txt")}'`);
    rmSync(join(tmp, "local-read"), { force: true });
    rmSync(join(tmp, "github-read"), { force: true });
    const r = through();
    expect(r.code).toBe(1);
    expect(existsSync(join(tmp, "github-read"))).toBe(false);
    expect(existsSync(join(tmp, "local-read"))).toBe(false);
    expect(r.out.includes("cannot look for a local store")).toBe(true);
  });
});

describe("unicode primitives", () => {
  test("FENCE refuses a U+001C indent like BASE", () => {
    // BASE's fence indent narrowed from \s* to three spaces on #124: only spaces count.
    expect(FENCE.test("\x1c```x")).toBe(false);
  });

  test("FENCED_ITEM takes an Arabic-Indic number like BASE", () => {
    expect(FENCED_ITEM.test("\u0661. ```x")).toBe(true);
  });

  test("QUESTION splits after U+001C like BASE", () => {
    expect(QUESTION.test("q?\x1c next")).toBe(true);
  });

  test("ITEM takes an Arabic-Indic number like BASE", () => {
    expect(ITEM.test("\u0661. x")).toBe(true);
  });

  test("HEADING crosses a CR like BASE", () => {
    expect(HEADING.test("## a\rb")).toBe(true);
  });

  test("MARK1 refuses TBD+long-s like BASE", () => {
    expect(MARK1.exec("x TBD\u017f") === null).toBe(true);
  });

  test("MARK2 refuses long-s+TODO like BASE", () => {
    expect(MARK2.exec("\u017fTODO:") === null).toBe(true);
  });

  test("MARK3 refuses long-s wrapping like BASE", () => {
    expect(MARK3.exec("\u017fTODO\u017f") === null).toBe(true);
  });

  test("QSPLIT splits at U+001C like BASE", () => {
    expect("a.\x1cb".split(QSPLIT).length).toBe(2);
  });

  test("norm eats U+001C around a slash like BASE", () => {
    expect(norm("Problem\x1c/\x1cfeature")).toBe("problem / feature");
  });

  test("clip splits U+001C like BASE", () => {
    expect(clip("a\x1cb", 70)).toBe("a b");
  });
});

describe("--has-journey answers whether the ticket has a User journey", () => {
  const jbody = (...parts: string[]): { code: number; out: string } => {
    writeFileSync(join(tmp, "j.md"), `${parts.join("\n\n")}\n\n`);
    const r = run("bash", [SELF, "--has-journey", join(tmp, "j.md")], {
      env: { ...(process.env as Record<string, string>) },
    });
    return { code: r.code, out: `${r.out}${r.err}`.replace(/\n+$/u, "") };
  };

  const jexpect = (label: string, parts: string[], want: string): void => {
    test(label, () => {
      const r = jbody(...parts);
      expect(r.code).toBe(0);
      expect(r.out).toBe(want);
    });
  };

  jexpect("a ticket with a User journey has one", [P, A, D, K, UJ], "journey");
  jexpect("a ticket without one has none", [P, A, D, K], "no journey");
  jexpect(
    "a comment inside the heading leaves it a heading",
    [P, A, D, K, "## User journey <!-- draft -->", "1. Open it."],
    "journey",
  );
  jexpect(
    "a comment between the hashes and the words leaves it a heading",
    [P, A, D, K, "# <!-- -->User journey", "1. Open it."],
    "journey",
  );
  jexpect(
    "a comment opener inside a fence does not eat the journey",
    [P, A, D, K, "```", "Write <!-- to open", "```", "## User journey", "1. x", "<!-- done -->"],
    "journey",
  );
  jexpect(
    "fail-closed: a same-line remainder still answers yes",
    [P, A, D, K, "<!-- note --> ## User journey", "1. x"],
    "journey",
  );
  jexpect(
    "fail-closed: a commented-out journey still answers yes",
    [P, A, D, K, "<!--", "## User journey", "1. Open it.", "-->"],
    "journey",
  );
  jexpect(
    "fail-closed: a fenced journey still answers yes",
    [P, A, D, K, "```", "## User journey", "1. Open it.", "```"],
    "journey",
  );
  jexpect(
    "a setext subject line reads as a journey line",
    [P, A, D, K, "User journey", "============", "1. Open it."],
    "journey",
  );
  jexpect(
    "a setext dashed subject line reads as a journey line",
    [P, A, D, K, "User journey", "------------", "1. Open it."],
    "journey",
  );
  jexpect(
    "an indented journey still names the section",
    [P, A, D, K, "   ## User journey", "1. Open it."],
    "journey",
  );
  jexpect(
    "closing hashes still name the section",
    [P, A, D, K, "## User journey ##", "1. Open it."],
    "journey",
  );
  jexpect(
    "a trailing colon still names the section",
    [P, A, D, K, "## User journey:", "1. Open it."],
    "journey",
  );
  jexpect(
    "a trailing full stop still names the section",
    [P, A, D, K, "## User journey.", "1. Open it."],
    "journey",
  );
  jexpect(
    "journey-phrase: extra heading words still hold the phrase",
    [P, A, D, K, "## User journey log", "1. Open it."],
    "journey",
  );
  jexpect(
    "a level-one journey still names the section",
    [P, A, D, K, "# User journey", "1. Open it."],
    "journey",
  );
  jexpect(
    "indented code does not open a fence around the journey",
    [P, A, D, K, "    ```", "    literal indented text", "## User journey", "1. Open it."],
    "journey",
  );
  jexpect(
    "a deeply indented item fence does not hide the journey",
    [P, A, D, K, "     1. ```", "     not code", "## User journey", "1. Open it."],
    "journey",
  );
  jexpect(
    "a trailing colon and full stop still name the section",
    [P, A, D, K, "## User journey:.", "1. Open it."],
    "journey",
  );
  jexpect(
    "a trailing colon and semicolon still name the section",
    [P, A, D, K, "## User journey:;", "1. Open it."],
    "journey",
  );
  jexpect(
    "journey-phrase: a doubled space still reads",
    [P, A, D, K, "## User  journey", "1. Open it."],
    "journey",
  );
  jexpect(
    "journey-phrase: a tab still reads",
    [P, A, D, K, "## User\tjourney", "1. Open it."],
    "journey",
  );
  jexpect(
    "journey-phrase: a closer on the heading line still reads",
    [P, A, D, K, "## User journey -->", "1. Open it."],
    "journey",
  );
  jexpect(
    "journey-phrase: a heading after a closer still reads",
    [P, A, D, K, "--> ## User journey", "1. Open it."],
    "journey",
  );
  jexpect(
    "journey-phrase: a trailing comma still reads",
    [P, A, D, K, "## User journey,", "1. Open it."],
    "journey",
  );
  jexpect(
    "journey-phrase: a mention in passing still blocks landing visibly",
    [P, A, D, K, "## Notes", "This changes the user journey for checkout."],
    "journey",
  );
  jexpect(
    "journey-phrase: emphasis still reads",
    [P, A, D, K, "## *User journey*", "1. Open it."],
    "journey",
  );
  jexpect(
    "journey-phrase: all caps still reads",
    [P, A, D, K, "## USER JOURNEY", "1. Open it."],
    "journey",
  );
  jexpect(
    "journey-phrase: a quoted heading still reads",
    [P, A, D, K, "> ## User journey", "1. Open it."],
    "journey",
  );
  jexpect(
    "journey-phrase: backticks still read",
    [P, A, D, K, "## `User journey`", "1. Open it."],
    "journey",
  );
  jexpect(
    "journey-phrase: the phrase as a substring still reads",
    [P, A, D, K, "## Notes", "The user journeys through checkout."],
    "journey",
  );
  jexpect(
    "journey-phrase: the word journey alone is not the phrase",
    [P, A, D, K, "## Notes", "The journey is long and winding."],
    "no journey",
  );
  jexpect(
    "AE4: the ASCII possessive still reads",
    [P, A, D, K, "## Notes", "Improve the user's journey at checkout."],
    "journey",
  );
  jexpect(
    "AE4: the curly possessive still reads",
    [P, A, D, K, "## Notes", "Improve the user\u2019s journey at checkout."],
    "journey",
  );
  jexpect(
    "AE4: a zero-width space still reads",
    [P, A, D, K, "## Notes", "Improve the user\u200bjourney."],
    "journey",
  );
  jexpect(
    "AE4: a word joiner still reads",
    [P, A, D, K, "## Notes", "Improve the user\u2060journey."],
    "journey",
  );
  jexpect(
    "AE4: a soft hyphen still reads",
    [P, A, D, K, "## Notes", "Improve the user\u00adjourney."],
    "journey",
  );
  jexpect(
    "AE4: an entity is not decoded",
    [P, A, D, K, "## Notes", "Improve the user&#32;journey."],
    "no journey",
  );
  jexpect(
    "AF3: a hyphen joins the phrase",
    [P, A, D, K, "## Notes", "Improve the user-journey at checkout."],
    "journey",
  );
  jexpect(
    "AF3: an en dash joins the phrase",
    [P, A, D, K, "## Notes", "Improve the user\u2013journey at checkout."],
    "journey",
  );
  jexpect(
    "AF3: an em dash joins the phrase",
    [P, A, D, K, "## Notes", "Improve the user\u2014journey at checkout."],
    "journey",
  );
  jexpect(
    "AG4: U+2010 joins the phrase",
    [P, A, D, K, "## Notes", "Improve the user\u2010journey at checkout."],
    "journey",
  );
  jexpect(
    "AG4: U+2011 joins the phrase",
    [P, A, D, K, "## Notes", "Improve the user\u2011journey at checkout."],
    "journey",
  );

  test("a same-line remainder does not satisfy a required part", () => {
    body(
      "<!-- x --> ## Problem / feature\nA ticket reaches a coachman with words under it.",
      A,
      D,
      K,
    );
    expectCheck(2, "problem / feature");
  });
});
