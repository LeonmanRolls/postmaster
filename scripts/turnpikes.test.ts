// Tests beside scripts/turnpikes.ts, moved from its --self-test on #109: 90 controls.
// The self-test staged shared waybills and run state between controls; each test below builds
// its own fixtures so it passes alone as well as in file order. The root-conditional control
// is gated by test.skipIf with a top notice.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./lib/proc.ts";
import { pyWords } from "./lib/text.ts";
import {
  computeLegs,
  legacyDispatch,
  MARKER,
  named,
  NAME_CHAR_RE,
  parseTable,
  resolve,
  TABLE,
  WORD_SPLIT_RE,
} from "./turnpikes.ts";

const SELF = join(import.meta.dir, "turnpikes.sh");
const HERE = import.meta.dir;
const NOPE = "zz-not-listed";
const PLUS = `${TABLE}\n${NOPE}  -        ship    a check the table does not have yet`;

delete process.env.POSTMASTER_PROJECT;

let canRestrict = true;
{
  const probe = mkdtempSync(join(tmpdir(), "postmaster-"));
  try {
    const f = join(probe, "f");
    writeFileSync(f, "x");
    chmodSync(f, 0o000);
    try {
      readFileSync(f);
      canRestrict = false;
    } catch {
      canRestrict = true;
    }
    chmodSync(f, 0o644);
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
}
if (!canRestrict) {
  console.log(
    "skip an unreadable brief.md names the read error: this user reads every file, so no denial was compared",
  );
}

let tmp = "";

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "postmaster-"));
  {
    const r = run("bash", [SELF, "--list"]);
    if (r.out.split("\n").some((l) => pyWords(l)[0] === NOPE)) {
      throw new Error(`test setup: ${NOPE} is in the table; pick another unused name`);
    }
  }
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
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const runSelf = (...args: string[]): { code: number; out: string } => {
  const r = run("bash", [SELF, ...args]);
  return { code: r.code, out: (r.out + r.err).replace(/\n+$/u, "") };
};

const checkIs = (r: { code: number; out: string }, exit: number, expected: string): void => {
  expect(r.code).toBe(exit);
  expect(r.out).toBe(expected);
};

const checkHas = (
  r: { code: number; out: string },
  exit: number,
  want: string,
  notWant?: string,
): void => {
  expect(r.code).toBe(exit);
  expect(r.out.includes(want)).toBe(true);
  if (notWant !== undefined && notWant !== "") expect(r.out.includes(notWant)).toBe(false);
};

const waybill = (dir: string, line: string, notes = ""): void => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "run.json"), '{"coachman_contract": 2}\n');
  const content = `# Waybill: T-1\n${line}\n\n## Ticket\n## Problem / feature\nA change.\n\n## Turnpikes\ndefault\n\n## Notes\n${notes}\n\n## Project profile\nrepo: /r\n\n## Dispatch\nname: #1, A change\ndispatch: ${dir}\ntool: /t\n`;
  writeFileSync(join(dir, "brief.md"), content, "utf8");
};

const lines = (...args: string[]): string => args.join("\n");

const wantDescs = [
  "idiom, naming, abstraction and consistency with the project's own conventions",
  "correctness, logic, and whether the tests are adequate",
  "exploit paths through the project's risk surfaces",
];
const descsFull = (ds: string[]): boolean =>
  ds.length === 3 && ds.every((d, i) => d === wantDescs[i]);

const bad = (extra: string, want: string): void => {
  const { faults } = parseTable(`${TABLE}\n${extra}`);
  const r = {
    code: faults.length > 0 ? 1 : 0,
    out: faults.map((f) => `turnpikes: the table's ${f}`).join("\n"),
  };
  checkHas(r, 1, want, "style");
};

const poll = (runsDir: string, name: string): string => {
  const r = run("bash", [join(HERE, "runs-status.sh"), runsDir]);
  const row = r.out.split("\n").find((l) => l.startsWith(name));
  return row ? (pyWords(row).pop() ?? "") : "";
};

const HANDOFF_SECTIONS =
  "## Decisions\nx\n\n## Deferred findings\nx\n\n## Verified by execution\nx\n\n## Unverified\nx\n\n## Branches and lanes\nx\n\n## Open questions\nx\n\n## Next leg\nx\n";

const setupWalk = (
  tag: string,
  name: string,
  turnpikes: string,
  stage: string,
  leg: number,
  markers: string[],
  handoffs: number[],
): { repo: string; d: string } => {
  const repo = join(tmp, `repo-${tag}`);
  const d = join(repo, ".postmaster", "runs", name);
  waybill(d, turnpikes);
  writeFileSync(join(d, "run-log.md"), "", "utf8");
  writeFileSync(
    join(d, "manifest.json"),
    `{"stage": "${stage}", "leg": ${leg}, "base": "abc123", "lanes": {}, "coachman": {"legs": {}}}\n`,
    "utf8",
  );
  run("bash", [join(HERE, "log-action.sh"), d, "postmaster", "dispatch", name, `leg ${leg}`]);
  for (const n of handoffs) writeFileSync(join(d, `handoff-${n}.md`), HANDOFF_SECTIONS, "utf8");
  for (const m of markers) writeFileSync(join(d, m), "", "utf8");
  return { repo, d };
};

const setupOne = (tag: string): { repo: string; d: string } =>
  setupWalk(
    tag,
    "one",
    "turnpikes: none",
    "shipping",
    1,
    [".leg-1-done", ".leg-1-exited", ".card-ready"],
    [1],
  );

const setupTwo = (tag: string): { repo: string; d: string } =>
  setupWalk(
    tag,
    "two",
    "turnpikes: style, bug, security",
    "checkpoint-1",
    1,
    [".leg-1-done", ".leg-1-exited"],
    [1],
  );

const setupOld = (tag: string): { repo: string; d: string } => {
  const { repo, d } = setupWalk(
    tag,
    "old",
    "turnpikes: style",
    "review",
    2,
    [".leg-2-done", ".leg-2-exited"],
    [2],
  );
  rmSync(join(d, "run.json"));
  return { repo, d };
};

const stageTargetsOf = (d: string): string => {
  try {
    return readFileSync(join(d, "actions.jsonl"), "utf8")
      .split("\n")
      .filter((l) => l !== "")
      .map((l) => JSON.parse(l) as { action?: string; target?: string })
      .filter((e) => e.action === "stage")
      .map((e) => e.target ?? "")
      .join(" ");
  } catch {
    return "";
  }
};

const advanceWalk = (d: string, leg: number): void => {
  const p = join(d, "manifest.json");
  const m = JSON.parse(readFileSync(p, "utf8"));
  m.leg = leg;
  writeFileSync(p, JSON.stringify(m), "utf8");
};

describe("unicode primitives", () => {
  test("a list marker may be Arabic-Indic digits", () => {
    expect(MARKER.exec("١. x") !== null).toBe(true);
  });

  test("name-char test matches [^W_]", () => {
    const nameWant = ["a", "_", "٣", "½", "-"].map((s) => NAME_CHAR_RE.test(s));
    expect(nameWant).toEqual([true, false, true, true, false]);
  });

  test("table fields split on U+001C", () => {
    const p1 = parseTable("style\x1c-\x1creview\x1cwhat here");
    expect(p1.faults).toEqual([]);
    expect(p1.rows[0]?.what).toBe("what here");
  });

  test("what keeps FEFF edges (Python strip)", () => {
    const p2 = parseTable("style - review \uFEFFwhat\uFEFF");
    expect(p2.rows[0]?.what).toBe("\uFEFFwhat\uFEFF");
  });

  test("waybill words split on U+001C", () => {
    expect("a\x1cb,c".split(WORD_SPLIT_RE)).toEqual(["a", "b", "c"]);
  });
});

describe("positive controls: the list", () => {
  test("--list names style, bug and security, once each", () => {
    const r = runSelf("--list");
    expect(r.code).toBe(0);
    expect(
      ["style", "bug", "security"].every(
        (n) => r.out.split("\n").filter((l) => pyWords(l)[0] === n).length === 1,
      ),
    ).toBe(true);
  });

  test("the default set is style, bug and security", () => {
    const r = runSelf("--list");
    const defaults = r.out
      .split("\n")
      .filter((l) => pyWords(l)[1] === "default")
      .map((l) => pyWords(l)[0])
      .join(" ");
    expect(defaults).toBe("style bug security");
  });

  test("the three run in the review leg", () => {
    const r = runSelf("--list");
    const legs = [
      ...new Set(
        r.out
          .split("\n")
          .filter((l) => /^(style|bug|security)$/u.test(pyWords(l)[0] ?? ""))
          .map((l) => pyWords(l)[2]),
      ),
    ];
    expect(legs).toEqual(["review"]);
  });

  test("each line carries its full description, not its first word", () => {
    const r = runSelf("--list");
    const descs = r.out
      .split("\n")
      .filter((l) => /^(style|bug|security)$/u.test(pyWords(l)[0] ?? ""))
      .map((l) => pyWords(l).slice(3).join(" "));
    expect(descsFull(descs)).toBe(true);
  });

  test("a truncated description fails the full-description control", () => {
    const short = TABLE.replace(
      "idiom, naming, abstraction and consistency with the project's own conventions",
      "idiom, naming, abstraction",
    );
    const { rows } = parseTable(short);
    const got = rows
      .filter((r) => ["style", "bug", "security"].includes(r.name))
      .map((r) => r.what);
    expect(descsFull(got)).toBe(false);
  });
});

describe("positive controls: a ticket's section", () => {
  test("--list does not read project settings", () => {
    const plain = runSelf("--list");
    expect(plain.code).toBe(0);
    const r = run("bash", [SELF, "--list"], {
      env: {
        ...(process.env as Record<string, string>),
        POSTMASTER_PROJECT: join(tmp, "no-such-project"),
      },
    });
    const out = (r.out + r.err).replace(/\n+$/u, "");
    expect(r.code).toBe(0);
    expect(out).toBe(plain.out);
  });

  test("default resolves to the target project's declared turnpikes", () => {
    checkIs(
      runSelf("resolve", "--project", join(tmp, "project-profile"), "default"),
      0,
      "turnpikes: bug",
    );
  });

  test("a project may define default as no turnpikes", () => {
    checkIs(
      runSelf("resolve", "--project", join(tmp, "empty-project"), "default"),
      0,
      "turnpikes: none",
    );
  });

  test("short names the project's defaults omitted by a ticket", () => {
    checkIs(
      runSelf("short", "--project", join(tmp, "project-profile"), "turnpikes: none"),
      0,
      "bug",
    );
  });

  test("an explicitly empty --project is refused, never resolved as discovery", () => {
    checkHas(runSelf("resolve", "--project", "", "default"), 1, "no such project directory");
  });

  test("short refuses an explicitly empty --project too", () => {
    checkHas(runSelf("short", "--project", "", "turnpikes: none"), 1, "no such project directory");
  });

  test("default stands for the default set", () => {
    checkIs(runSelf("resolve", "default"), 0, "turnpikes: style, bug, security");
  });

  test("none stands for no turnpike", () => {
    checkIs(runSelf("resolve", "none"), 0, "turnpikes: none");
  });

  test("a list names its turnpikes, in the table's order", () => {
    checkIs(runSelf("resolve", "security, bug"), 0, "turnpikes: bug, security");
  });

  test("in a list, default still stands for the three", () => {
    checkIs(runSelf("resolve", "default, bug"), 0, "turnpikes: style, bug, security");
  });

  test("case, backticks, list markers and a closing full stop are ignored", () => {
    checkIs(runSelf("resolve", lines("- Bug", "- `security`.")), 0, "turnpikes: bug, security");
  });

  test("a thematic break is not a name", () => {
    checkIs(
      runSelf("resolve", lines("default", "", "---", "", "***")),
      0,
      "turnpikes: style, bug, security",
    );
  });

  test("a tab-indented rule is a name, not a break, as BASE has it", () => {
    checkIs(
      runSelf("resolve", lines("default", "", "\t---")),
      2,
      '"---" is not a turnpike; the section holds only default, none, or names from: style, bug, security',
    );
  });

  test("a three-space-indented rule is still a break", () => {
    checkIs(
      runSelf("resolve", lines("default", "", "   ---")),
      0,
      "turnpikes: style, bug, security",
    );
  });

  test("a hard line break is not part of a name", () => {
    checkIs(runSelf("resolve", "bug\\\nsecurity"), 0, "turnpikes: bug, security");
  });

  test("an invisible character is not part of a name", () => {
    checkIs(runSelf("resolve", "default\u200B"), 0, "turnpikes: style, bug, security");
  });

  test("an isolate or soft hyphen is not part of a name either", () => {
    checkIs(runSelf("resolve", "defau\u2066lt\u00AD"), 0, "turnpikes: style, bug, security");
  });

  test("with no text given, the section is read from stdin", () => {
    const r = run("bash", ["-c", `printf '1. bug\\n2. security\\n' | "${SELF}" resolve`]);
    checkIs(
      { code: r.code, out: (r.out + r.err).replace(/\n+$/u, "") },
      0,
      "turnpikes: bug, security",
    );
  });

  test("the waybill's line resolves to itself", () => {
    const first = runSelf("resolve", "bug, security");
    const second = runSelf("resolve", first.out.replace(/^turnpikes: /u, ""));
    checkIs(second, 0, first.out);
  });

  test("a turnpike added to the table resolves with nothing else changed", () => {
    const { names } = resolve(PLUS, `default, ${NOPE}`);
    checkIs(
      { code: 0, out: `turnpikes: ${(names ?? []).join(", ")}` },
      0,
      `turnpikes: style, bug, security, ${NOPE}`,
    );
  });
});

describe("positive controls: a run's legs", () => {
  test("a new run with no review turnpike has one synthesis leg", () => {
    waybill(join(tmp, "none"), "turnpikes: none");
    checkIs(runSelf("legs", join(tmp, "none")), 0, lines("1 synthesis"));
  });

  test("a new run with default turnpikes has two legs and review runs all three", () => {
    waybill(join(tmp, "default"), "turnpikes: style, bug, security");
    checkIs(
      runSelf("legs", join(tmp, "default")),
      0,
      lines("1 synthesis", "2 review style bug security"),
    );
  });

  test("one review turnpike is enough for a two-leg run", () => {
    waybill(join(tmp, "style"), "turnpikes: style");
    checkIs(runSelf("legs", join(tmp, "style")), 0, lines("1 synthesis", "2 review style"));
  });

  test("a turnpikes line inside the ticket is never read", () => {
    waybill(join(tmp, "notes"), "turnpikes: none", "turnpikes: style, bug, security");
    checkIs(runSelf("legs", join(tmp, "notes")), 0, lines("1 synthesis"));
  });

  test("a fence the ticket leaves open changes nothing", () => {
    waybill(
      join(tmp, "fence"),
      "turnpikes: style, bug, security",
      lines("```", "## Dispatch", "turnpikes: none"),
    );
    checkIs(
      runSelf("legs", join(tmp, "fence")),
      0,
      lines("1 synthesis", "2 review style bug security"),
    );
  });

  test("--expect passes a waybill whose line is the check's", () => {
    waybill(join(tmp, "default"), "turnpikes: style, bug, security");
    checkIs(
      runSelf("legs", join(tmp, "default"), "--expect", "turnpikes:  style, bug,  security"),
      0,
      lines("1 synthesis", "2 review style bug security"),
    );
  });

  test("a legacy turnpike that runs in another leg is kept after synthesis", () => {
    waybill(join(tmp, "extra"), `turnpikes: ${NOPE}`);
    rmSync(join(tmp, "extra", "run.json"));
    expect(legacyDispatch(join(tmp, "extra"))).toBe(true);
    const got = named(PLUS, `turnpikes: ${NOPE}`) ?? [];
    const r = computeLegs(PLUS, got, true);
    checkIs({ code: r.code, out: r.out.join("\n") }, 0, lines("1 synthesis", `3 ship ${NOPE}`));
  });

  test("a current run naming a ship-homed turnpike is refused, never silently dropped", () => {
    waybill(join(tmp, "shiphome"), `turnpikes: ${NOPE}`);
    expect(legacyDispatch(join(tmp, "shiphome"))).toBe(false);
    const got = named(PLUS, `turnpikes: ${NOPE}`) ?? [];
    const r = computeLegs(PLUS, got, false);
    checkHas(
      { code: r.code, out: r.out.join("\n") },
      2,
      "runs in ship, and a current run has no ship leg",
      "synthesis",
    );
  });

  test("legs --line gives the one-leg current schedule", () => {
    checkIs(runSelf("legs", "--line", "turnpikes: none"), 0, lines("1 synthesis"));
  });

  test("legs --line gives a two-leg current schedule", () => {
    checkIs(
      runSelf("legs", "--line", "turnpikes: security"),
      0,
      lines("1 synthesis", "2 review security"),
    );
  });

  test("short names the default turnpikes a line leaves out", () => {
    checkIs(runSelf("short", "turnpikes: bug"), 0, lines("style", "security"));
  });

  test("short names nothing for a line that leaves none out", () => {
    checkIs(runSelf("short", "turnpikes: style, bug, security"), 0, "");
  });
});

describe("negative controls: a ticket's section", () => {
  test("a turnpike the table does not list is named", () => {
    checkHas(runSelf("resolve", NOPE), 2, `"${NOPE}" is not a turnpike`);
  });

  test("none listed with another turnpike is refused", () => {
    checkHas(runSelf("resolve", "none, bug"), 2, "none stands alone");
  });

  test("a reason is not a turnpike", () => {
    checkHas(
      runSelf("resolve", "none. A research ticket"),
      2,
      '"a", "research" and "ticket" are not turnpikes; the section holds only',
    );
  });

  test("a dash between names is not a list marker, and is named", () => {
    checkHas(runSelf("resolve", "default - security"), 2, '"-" is not a turnpike');
  });

  test("a word of dots is still a word, and is named", () => {
    checkHas(runSelf("resolve", "style, ..."), 2, '"..." is not a turnpike');
  });

  test("an empty section names no turnpike", () => {
    checkHas(runSelf("resolve", ""), 2, "names no turnpike");
  });
});

describe("negative controls: a run's legs", () => {
  test("with no line under the title, one in the ticket is not taken instead", () => {
    waybill(join(tmp, "missing"), "", "turnpikes: style, bug, security");
    checkHas(runSelf("legs", join(tmp, "missing")), 2, "has no turnpikes: line", "ship");
  });

  test("a waybill naming an unknown turnpike is refused, and no leg is printed", () => {
    waybill(join(tmp, "unknown"), `turnpikes: bug, ${NOPE}`);
    checkHas(runSelf("legs", join(tmp, "unknown")), 2, `"${NOPE}" is not a turnpike`, "synthesis");
  });

  test("two turnpikes lines are refused", () => {
    waybill(join(tmp, "twice"), lines("turnpikes: none", "turnpikes: style, bug, security"));
    checkHas(runSelf("legs", join(tmp, "twice")), 2, "has 2 turnpikes: lines", "synthesis");
  });

  test("a waybill that says default is refused: it carries names", () => {
    waybill(join(tmp, "word"), "turnpikes: default");
    checkHas(runSelf("legs", join(tmp, "word")), 2, "says default", "synthesis");
  });

  test("--expect refuses a waybill that dropped a name the check printed", () => {
    waybill(join(tmp, "default"), "turnpikes: style, bug, security");
    checkHas(
      runSelf("legs", join(tmp, "default"), "--expect", "turnpikes: bug, security"),
      2,
      `and the ticket's check printed "turnpikes: bug, security"`,
      "synthesis",
    );
  });

  test("legs --line refuses a line that is not a turnpikes: line", () => {
    checkHas(runSelf("legs", "--line", "style, bug"), 2, "is not a turnpikes: line", "synthesis");
  });

  test("legs --line refuses a line with a newline in it", () => {
    checkHas(
      runSelf("legs", "--line", lines("turnpikes: none", "style")),
      2,
      "is not a turnpikes: line",
      "synthesis",
    );
  });

  test("short refuses default: a line carries names", () => {
    checkHas(runSelf("short", "turnpikes: default"), 2, "says default");
  });

  test("no waybill is a usage error", () => {
    checkHas(runSelf("legs", join(tmp, "nowhere")), 1, "no waybill at");
  });

  test("a run dispatched before the contract marker keeps synthesis and ship", () => {
    waybill(join(tmp, "old-three"), "turnpikes: none");
    rmSync(join(tmp, "old-three", "run.json"));
    checkIs(runSelf("legs", join(tmp, "old-three")), 0, lines("1 synthesis", "3 ship"));
  });

  test("a pre-change run with review keeps all three legs", () => {
    waybill(join(tmp, "old-review"), "turnpikes: style");
    rmSync(join(tmp, "old-review", "run.json"));
    checkIs(
      runSelf("legs", join(tmp, "old-review")),
      0,
      lines("1 synthesis", "2 review style", "3 ship"),
    );
  });

  test("an explicit contract 1 keeps all three legs", () => {
    waybill(join(tmp, "contract-one"), "turnpikes: style, bug, security");
    writeFileSync(join(tmp, "contract-one", "run.json"), '{"coachman_contract": 1}\n');
    checkIs(
      runSelf("legs", join(tmp, "contract-one")),
      0,
      lines("1 synthesis", "2 review style bug security", "3 ship"),
    );
  });

  for (const bad of ["null", "true", "false", "2.0", "1.0", '"2"']) {
    test(`a marker of ${bad} is refused, never read as a schedule`, () => {
      waybill(join(tmp, "contract-bad"), "turnpikes: style, bug, security");
      writeFileSync(join(tmp, "contract-bad", "run.json"), `{"coachman_contract": ${bad}}\n`);
      checkHas(
        runSelf("legs", join(tmp, "contract-bad")),
        1,
        "unsupported coachman contract",
        "synthesis",
      );
    });
  }

  test("a brief.md that is a directory is no waybill", () => {
    const d = join(tmp, "briefdir");
    mkdirSync(join(d, "brief.md"), { recursive: true });
    checkHas(runSelf("legs", d), 1, "no waybill at");
  });

  test.skipIf(!canRestrict)("an unreadable brief.md names the read error", () => {
    const d = join(tmp, "noperm");
    waybill(d, "turnpikes: none");
    chmodSync(join(d, "brief.md"), 0o000);
    try {
      checkHas(runSelf("legs", d), 1, "cannot read", "Bun v");
    } finally {
      chmodSync(join(d, "brief.md"), 0o644);
    }
  });
});

describe("negative controls: the table", () => {
  test("a turnpike named none is refused", () => {
    bad("none       -        review  nothing", '"none" already means something in a ticket');
  });

  test("a turnpike named default is refused", () => {
    bad("default    -        review  everything", '"default" already means something in a ticket');
  });

  test("a turnpike listed twice is refused", () => {
    bad("bug        -        review  bugs again", '"bug" is listed twice');
  });

  test("a leg that does not exist is refused", () => {
    bad(`${NOPE}      -        deploy  a check`, '"deploy" is not a leg');
  });

  test("a set other than default or - is refused", () => {
    bad(`${NOPE}    yes      ship    a check`, '"yes" is neither default nor -');
  });

  test("a name that is not a lowercase word is refused", () => {
    bad("Zz-Not  -       ship    a check", '"Zz-Not" is not a lowercase word');
  });

  test("a line with no description is refused", () => {
    bad(`${NOPE}      -        ship`, "needs a name, default or -, a leg, and what it checks");
  });
});

describe("controls: a one-leg run, walked from synthesis to the card through the poll, the hand-off check and the stages", () => {
  test("the final synthesis hand-off passes its check", () => {
    const { d } = setupOne("one-handoff");
    const hc = run("bash", [join(HERE, "handoff-check.sh"), join(d, "handoff-1.md")]);
    expect(hc.code).toBe(0);
  }, 30000);

  test("a one-leg run's card is GATE", () => {
    const { repo } = setupOne("one-gate");
    expect(poll(join(repo, ".postmaster", "runs"), "one")).toBe("GATE");
  }, 30000);

  test("a one-leg run has no second leg", () => {
    const { d } = setupOne("one-legs");
    const r = run("bash", [SELF, "legs", d]);
    expect(r.out.replace(/\n+$/u, "")).toBe("1 synthesis");
  }, 30000);

  test("a one-leg run closes at done", () => {
    const { repo, d } = setupOne("one-close");
    run("bash", [join(HERE, "stage.sh"), d, "shipped", "postmaster"]);
    run("bash", [join(HERE, "stage.sh"), d, "done", "postmaster"]);
    expect(poll(join(repo, ".postmaster", "runs"), "one")).toBe("-");
  }, 30000);

  test("a one-leg run's stages after the card are the postmaster's", () => {
    const { d } = setupOne("one-stages");
    run("bash", [join(HERE, "stage.sh"), d, "shipped", "postmaster"]);
    run("bash", [join(HERE, "stage.sh"), d, "done", "postmaster"]);
    expect(stageTargetsOf(d)).toBe("shipped done");
  }, 30000);
});

describe("controls: a two-leg run, walked from synthesis through review to the card", () => {
  test("after synthesis the poll says DISPATCH", () => {
    const { repo } = setupTwo("two-poll");
    expect(poll(join(repo, ".postmaster", "runs"), "two")).toBe("DISPATCH");
  }, 30000);

  test("the leg after synthesis is review", () => {
    const { d } = setupTwo("two-next");
    const r = run("bash", [SELF, "legs", d]);
    const next = r.out.split("\n").find((l) => {
      const n = parseInt(pyWords(l)[0] ?? "", 10);
      return n > 1;
    });
    const nextVal = next ? `${pyWords(next)[0]} ${pyWords(next)[1]}` : "";
    expect(nextVal).toBe("2 review");
  }, 30000);

  test("the review leg starts from synthesis's hand-off, which passes its check", () => {
    const { d } = setupTwo("two-handoff");
    const r = run("bash", [SELF, "legs", d]);
    const prevs = r.out
      .split("\n")
      .map((l) => parseInt(pyWords(l)[0] ?? "", 10))
      .filter((n) => n < 2);
    const prev = prevs[prevs.length - 1] ?? 0;
    const hc = run("bash", [join(HERE, "handoff-check.sh"), join(d, `handoff-${prev}.md`)]);
    expect(hc.code).toBe(0);
    expect(prev).toBe(1);
  }, 30000);

  test("the review leg ends with the card, and no leg follows", () => {
    const { repo, d } = setupTwo("two-card");
    advanceWalk(d, 2);
    run("bash", [join(HERE, "stage.sh"), d, "review"]);
    run("bash", [join(HERE, "stage.sh"), d, "shipping"]);
    writeFileSync(join(d, "handoff-2.md"), HANDOFF_SECTIONS, "utf8");
    writeFileSync(join(d, ".leg-2-done"), "", "utf8");
    writeFileSync(join(d, ".leg-2-exited"), "", "utf8");
    writeFileSync(join(d, ".card-ready"), "", "utf8");
    const r = run("bash", [SELF, "legs", d]);
    const after = r.out.split("\n").filter((l) => parseInt(pyWords(l)[0] ?? "", 10) > 2);
    expect(poll(join(repo, ".postmaster", "runs"), "two")).toBe("GATE");
    expect(after).toEqual([]);
  }, 30000);

  test("it closes through the postmaster's stages", () => {
    const { repo, d } = setupTwo("two-close");
    advanceWalk(d, 2);
    run("bash", [join(HERE, "stage.sh"), d, "review"]);
    run("bash", [join(HERE, "stage.sh"), d, "shipping"]);
    writeFileSync(join(d, "handoff-2.md"), HANDOFF_SECTIONS, "utf8");
    writeFileSync(join(d, ".leg-2-done"), "", "utf8");
    writeFileSync(join(d, ".leg-2-exited"), "", "utf8");
    writeFileSync(join(d, ".card-ready"), "", "utf8");
    run("bash", [join(HERE, "stage.sh"), d, "shipped", "postmaster"]);
    run("bash", [join(HERE, "stage.sh"), d, "done", "postmaster"]);
    expect(stageTargetsOf(d)).toBe("review shipping shipped done");
    expect(poll(join(repo, ".postmaster", "runs"), "two")).toBe("-");
  }, 30000);
});

describe("controls: a three-leg run dispatched before this change, walked from review to ship", () => {
  test("a pre-change review leg still dispatches ship", () => {
    const { repo, d } = setupOld("old-poll");
    const r = run("bash", [SELF, "legs", d]);
    const last = r.out.replace(/\n+$/u, "").split("\n").pop() ?? "";
    expect(poll(join(repo, ".postmaster", "runs"), "old")).toBe("DISPATCH");
    expect(last).toBe("3 ship");
  }, 30000);

  test("the leg after review is ship", () => {
    const { d } = setupOld("old-next");
    const r = run("bash", [SELF, "legs", d]);
    const next = r.out.split("\n").find((l) => {
      const n = parseInt(pyWords(l)[0] ?? "", 10);
      return n > 2;
    });
    const nextVal = next ? `${pyWords(next)[0]} ${pyWords(next)[1]}` : "";
    expect(nextVal).toBe("3 ship");
  }, 30000);

  test("the legacy ship hand-off still passes its check", () => {
    const { d } = setupOld("old-handoff");
    const hc = run("bash", [join(HERE, "handoff-check.sh"), join(d, "handoff-2.md")]);
    expect(hc.code).toBe(0);
  }, 30000);

  test("after ship the card is GATE, and no leg follows", () => {
    const { repo, d } = setupOld("old-card");
    advanceWalk(d, 3);
    run("bash", [join(HERE, "stage.sh"), d, "shipping"]);
    writeFileSync(join(d, "handoff-3.md"), HANDOFF_SECTIONS, "utf8");
    writeFileSync(join(d, ".leg-3-done"), "", "utf8");
    writeFileSync(join(d, ".leg-3-exited"), "", "utf8");
    writeFileSync(join(d, ".card-ready"), "", "utf8");
    const r = run("bash", [SELF, "legs", d]);
    const after = r.out.split("\n").filter((l) => parseInt(pyWords(l)[0] ?? "", 10) > 3);
    expect(poll(join(repo, ".postmaster", "runs"), "old")).toBe("GATE");
    expect(after).toEqual([]);
  }, 30000);

  test("a three-leg run keeps its stages", () => {
    const { repo, d } = setupOld("old-close");
    advanceWalk(d, 3);
    run("bash", [join(HERE, "stage.sh"), d, "shipping"]);
    writeFileSync(join(d, "handoff-3.md"), HANDOFF_SECTIONS, "utf8");
    writeFileSync(join(d, ".leg-3-done"), "", "utf8");
    writeFileSync(join(d, ".leg-3-exited"), "", "utf8");
    writeFileSync(join(d, ".card-ready"), "", "utf8");
    run("bash", [join(HERE, "stage.sh"), d, "shipped"]);
    run("bash", [join(HERE, "stage.sh"), d, "done", "postmaster"]);
    expect(stageTargetsOf(d)).toBe("shipping shipped done");
    expect(poll(join(repo, ".postmaster", "runs"), "old")).toBe("-");
  }, 30000);
});
