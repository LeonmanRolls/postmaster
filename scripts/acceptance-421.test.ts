// Oracle for #421, committed before the change: one command keeps a
// project's experiments, a private live page shows them with what is due
// first, the postmaster keeps both current, and the README states the design
// goal. C1, C3's command half and push-docs drive `run experiments` as a
// subprocess over scratch repositories, never importing the change; C2, C3's
// page half and C4 run the page's own script in a fresh process with a stub
// store; C5 and C6 read the runbook and the README. C7, the fixture run from
// the final head, is the landing check and no test here. Where a headless
// browser is on the machine the widths are screenshotted; there is none here,
// so the page tests pin the viewport and the grid rule and the widths stay
// for the postmaster before the first publish.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EXPERIMENTS,
  PAGE,
  POSTMASTER_MD,
  README,
  RUN,
  SKILL,
  TOOL,
  cleanup,
  experiments,
  ledgerLines,
  porcelain,
  recordLines,
  renderPage,
  stage,
  str,
  utcDate,
  type PageDoc,
  type Staged,
} from "./acceptance-421.ts";
import { type RunResult, run } from "./lib/proc.ts";

function expectOk(r: RunResult, what: string): void {
  if (r.code !== 0) {
    throw new Error(`${what}: exit ${r.code}\n--- out ---\n${r.out}\n--- err ---\n${r.err}`);
  }
}

function expectRefused(r: RunResult, what: string): void {
  if (r.code === 0) {
    throw new Error(`${what}: ran green, want a refusal\n--- out ---\n${r.out}`);
  }
}

function recordBytes(s: Staged): string {
  return readFileSync(join(s.repo, ".postmaster", "experiments.jsonl"), "utf8");
}

function ledgerBytes(s: Staged): string {
  return readFileSync(join(s.repo, ".postmaster", "runs", "ledger.jsonl"), "utf8");
}

/** The list form's one header line per experiment, in display order. */
function headers(out: string): string[] {
  return out.split("\n").filter((l) => /^e\d+ /.test(l));
}

/** Start one experiment; the id it prints is the handle every form takes. */
function startIt(
  s: Staged,
  question: string,
  look: string,
  levels: string[] = ["old flow", "new flow"],
): string {
  const r = experiments(s.repo, "start", [
    "--question",
    question,
    ...levels.flatMap((l) => ["--level", l]),
    "--measure",
    "minutes per ticket",
    "--look",
    look,
  ]);
  expectOk(r, "start");
  return r.out.trim();
}

describe("C1: one command starts, moves and concludes an experiment", () => {
  test("start prints the id and records the question, levels, measure and date", () => {
    const s = stage();
    const look = utcDate(7);
    const id = startIt(s, "does the new flow save time", look);
    expect(id).toBe("e1");
    const rows = recordLines(s.repo);
    expect(rows.length).toBe(1);
    expect(rows[0]["ev"]).toBe("start");
    expect(rows[0]["id"]).toBe("e1");
    expect(rows[0]["question"]).toBe("does the new flow save time");
    expect(rows[0]["levels"]).toEqual(["old flow", "new flow"]);
    expect(rows[0]["measure"]).toBe("minutes per ticket");
    expect(rows[0]["started"]).toBe(utcDate(0));
    expect(rows[0]["look"]).toBe(look);
    cleanup(s);
  });

  test("move, conclude and list: one concluded experiment with its result", () => {
    const s = stage();
    const id = startIt(s, "does the new flow save time", utcDate(7));
    const later = utcDate(14);
    const moved = experiments(s.repo, "move", [id, "--look", later]);
    expectOk(moved, "move");
    expect(moved.out.trim()).toBe(id);
    const done = experiments(s.repo, "conclude", [
      id,
      "--result",
      "it saved ten minutes a ticket",
      "--evidence",
      "https://example.invalid/pull/1",
    ]);
    expectOk(done, "conclude");
    expect(done.out.trim()).toBe(id);
    const list = experiments(s.repo, "list", []);
    expectOk(list, "list");
    expect(headers(list.out).length).toBe(1);
    expect(list.out).toContain("concluded");
    expect(list.out).toContain("it saved ten minutes a ticket");
    const rows = recordLines(s.repo);
    expect(rows.map((r) => r["ev"])).toEqual(["start", "move", "conclude"]);
    expect(rows[1]["look"]).toBe(later);
    expect(rows[2]["result"]).toBe("it saved ten minutes a ticket");
    expect(rows[2]["evidence"]).toBe("https://example.invalid/pull/1");
    expect(rows[2]["ended"]).toBe(utcDate(0));
    cleanup(s);
  });

  test("the project ledger holds one line for each of the three changes", () => {
    const s = stage();
    const id = startIt(s, "does the new flow save time", utcDate(7));
    expectOk(experiments(s.repo, "move", [id, "--look", utcDate(14)]), "move");
    expectOk(
      experiments(s.repo, "conclude", [id, "--result", "it saved ten minutes a ticket"]),
      "conclude",
    );
    const lines = ledgerLines(s.repo);
    expect(lines.length).toBe(3);
    for (const [i, change] of ["start", "move", "conclude"].entries()) {
      expect(lines[i]["actor"]).toBe("postmaster");
      expect(lines[i]["action"]).toBe("experiment");
      expect(lines[i]["target"]).toBe(id);
      expect(str(lines[i]["detail"]).split(" ")[0]).toBe(change);
    }
    cleanup(s);
  });

  test("the three changes leave the tree clean", () => {
    const s = stage();
    const id = startIt(s, "does the new flow save time", utcDate(7));
    expectOk(experiments(s.repo, "move", [id, "--look", utcDate(14)]), "move");
    expectOk(
      experiments(s.repo, "conclude", [id, "--result", "it saved ten minutes a ticket"]),
      "conclude",
    );
    expect(porcelain(s.repo)).toBe("");
    cleanup(s);
  });

  test("concluding an id that does not exist fails and changes nothing", () => {
    const s = stage();
    startIt(s, "does the new flow save time", utcDate(7));
    const beforeRecord = recordBytes(s);
    const beforeLedger = ledgerBytes(s);
    const r = experiments(s.repo, "conclude", ["e9", "--result", "nothing ran"]);
    expectRefused(r, "conclude e9");
    expect(recordBytes(s)).toBe(beforeRecord);
    expect(ledgerBytes(s)).toBe(beforeLedger);
    cleanup(s);
  });

  test("a start with no question is refused and writes nothing", () => {
    const s = stage();
    const r = experiments(s.repo, "start", [
      "--level",
      "old flow",
      "--level",
      "new flow",
      "--measure",
      "minutes per ticket",
      "--look",
      utcDate(7),
    ]);
    expectRefused(r, "start with no question");
    expect(existsSync(join(s.repo, ".postmaster", "experiments.jsonl"))).toBe(false);
    expect(existsSync(join(s.repo, ".postmaster", "runs", "ledger.jsonl"))).toBe(false);
    cleanup(s);
  });

  test("a start with one level, a bad date or no project is refused", () => {
    const s = stage();
    const one = experiments(s.repo, "start", [
      "--question",
      "q",
      "--level",
      "only",
      "--measure",
      "m",
      "--look",
      utcDate(7),
    ]);
    expectRefused(one, "start with one level");
    const bad = experiments(s.repo, "start", [
      "--question",
      "q",
      "--level",
      "a",
      "--level",
      "b",
      "--measure",
      "m",
      "--look",
      "not-a-date",
    ]);
    expectRefused(bad, "start with a bad date");
    const missing = run(RUN, [
      "experiments",
      "start",
      "--question",
      "q",
      "--level",
      "a",
      "--level",
      "b",
      "--measure",
      "m",
      "--look",
      utcDate(7),
    ]);
    expectRefused(missing, "start with no project");
    expect(existsSync(join(s.repo, ".postmaster", "experiments.jsonl"))).toBe(false);
    cleanup(s);
  });

  test("moving an unknown id, a concluded one or to a bad date is refused", () => {
    const s = stage();
    const id = startIt(s, "does the new flow save time", utcDate(7));
    expectRefused(experiments(s.repo, "move", ["e9", "--look", utcDate(8)]), "move e9");
    expectRefused(experiments(s.repo, "move", [id, "--look", "someday"]), "move to a bad date");
    expectOk(experiments(s.repo, "conclude", [id, "--result", "done"]), "conclude");
    expectRefused(experiments(s.repo, "move", [id, "--look", utcDate(8)]), "move concluded");
    expectRefused(experiments(s.repo, "conclude", [id, "--result", "again"]), "conclude twice");
    expect(recordLines(s.repo).length).toBe(2);
    cleanup(s);
  });

  test("an empty project lists nothing to show", () => {
    const s = stage();
    const r = experiments(s.repo, "list", []);
    expectOk(r, "list");
    expect(r.out.trim()).toBe("no experiments");
    cleanup(s);
  });
});

describe("push-docs: the rows reach the page only from the command", () => {
  test("it prints every row as one JSON object keyed by id", () => {
    const s = stage();
    const a = startIt(s, "alpha question", utcDate(7), ["alpha old", "alpha new"]);
    const b = startIt(s, "beta question", utcDate(-1), ["beta old", "beta new"]);
    expectOk(
      experiments(s.repo, "conclude", [
        b,
        "--result",
        "beta won",
        "--evidence",
        "https://example.invalid/pull/2",
      ]),
      "conclude",
    );
    const r = experiments(s.repo, "push-docs", []);
    expectOk(r, "push-docs");
    const docs = JSON.parse(r.out) as Record<string, Record<string, unknown>>;
    expect(Object.keys(docs).sort()).toEqual([a, b]);
    expect(Object.keys(docs[a]!).sort()).toEqual([
      "ended",
      "evidence",
      "levels",
      "look",
      "measure",
      "question",
      "result",
      "started",
      "state",
    ]);
    expect(docs[a]!["question"]).toBe("alpha question");
    expect(docs[a]!["levels"]).toEqual(["alpha old", "alpha new"]);
    expect(docs[a]!["started"]).toBe(utcDate(0));
    expect(docs[a]!["state"]).toBe("running");
    expect(docs[a]!["result"]).toBe(null);
    expect(docs[a]!["evidence"]).toBe(null);
    expect(docs[b]!["state"]).toBe("concluded");
    expect(docs[b]!["result"]).toBe("beta won");
    expect(docs[b]!["evidence"]).toBe("https://example.invalid/pull/2");
    expect(docs[b]!["ended"]).toBe(utcDate(0));
    cleanup(s);
  });
});

describe("C3 command: list puts what is due first", () => {
  test("a header names the id, state, due mark and dates", () => {
    const s = stage();
    startIt(s, "alpha question", utcDate(1));
    startIt(s, "beta question", utcDate(-1));
    const r = experiments(s.repo, "list", ["--today", utcDate(0)]);
    expectOk(r, "list");
    expect(headers(r.out)).toEqual([
      `e2 running due look=${utcDate(-1)} started=${utcDate(0)}`,
      `e1 running look=${utcDate(1)} started=${utcDate(0)}`,
    ]);
    cleanup(s);
  });

  test("a date equal to today is due; moving past today clears it", () => {
    const s = stage();
    const b = startIt(s, "beta question", utcDate(-1));
    startIt(s, "alpha question", utcDate(1));
    const c = startIt(s, "gamma question", utcDate(0));
    let r = experiments(s.repo, "list", ["--today", utcDate(0)]);
    expectOk(r, "list");
    expect(headers(r.out).map((h) => h.split(" ")[0])).toEqual([b, c, "e2"]);
    expect(headers(r.out)[1]).toContain(" due ");
    expectOk(experiments(s.repo, "move", [b, "--look", utcDate(9)]), "move");
    expectOk(experiments(s.repo, "conclude", [c, "--result", "gamma tied"]), "conclude");
    r = experiments(s.repo, "list", ["--today", utcDate(0)]);
    expectOk(r, "list");
    const heads = headers(r.out);
    expect(heads.map((h) => h.split(" ")[0])).toEqual(["e2", b, c]);
    expect(heads[0]).not.toContain("due");
    expect(heads[1]).not.toContain("due");
    expect(heads[2]).toContain("concluded");
    expect(heads[2]).not.toContain("due");
    cleanup(s);
  });
});

// --- the page -----------------------------------------------------------------
// Three samples as the ticket stages them: one running with its date ahead,
// one past its date, one concluded.

function sampleRow(
  question: string,
  levels: string[],
  started: string,
  measure: string,
  look: string,
  state: "running" | "concluded",
  result: string | null = null,
  evidence: string | null = null,
  ended: string | null = null,
): Record<string, unknown> {
  return { question, levels, started, measure, look, state, result, evidence, ended };
}

function samples(): PageDoc[] {
  return [
    {
      id: "e1",
      row: sampleRow(
        "alpha flow question",
        ["alpha old", "alpha new"],
        utcDate(-1),
        "alpha minutes",
        utcDate(1),
        "running",
      ),
    },
    {
      id: "e2",
      row: sampleRow(
        "beta flow question",
        ["beta old", "beta new"],
        utcDate(-2),
        "beta minutes",
        utcDate(-1),
        "running",
      ),
    },
    {
      id: "e3",
      row: sampleRow(
        "gamma flow question",
        ["gamma old", "gamma new"],
        utcDate(-3),
        "gamma minutes",
        utcDate(-1),
        "concluded",
        "gamma new won by a mile",
        "https://example.invalid/pull/377",
        utcDate(0),
      ),
    },
  ];
}

/** The mounted cards, one entry per card, in display order. */
function cards(html: string): string[] {
  const parts = html.split('class="card');
  expect(parts.length).toBeGreaterThan(1);
  return parts.slice(1);
}

function cardFor(html: string, question: string): string {
  const found = cards(html).find((c) => c.includes(question));
  if (found === undefined) throw new Error(`no card shows: ${question}`);
  return found;
}

describe("C2: the page shows each experiment as a card", () => {
  test("three cards, each with its question, levels, dates, measure and state", () => {
    const rendered = renderPage(samples());
    expect(rendered.collection).toBe("experiments");
    const html = str(rendered.first);
    expect(cards(html).length).toBe(3);
    for (const [question, old, fresh, started, measure, look, state] of [
      [
        "alpha flow question",
        "alpha old",
        "alpha new",
        utcDate(-1),
        "alpha minutes",
        utcDate(1),
        "Running",
      ],
      [
        "beta flow question",
        "beta old",
        "beta new",
        utcDate(-2),
        "beta minutes",
        utcDate(-1),
        "Running",
      ],
      [
        "gamma flow question",
        "gamma old",
        "gamma new",
        utcDate(-3),
        "gamma minutes",
        utcDate(-1),
        "Concluded",
      ],
    ]) {
      const card = cardFor(html, question!);
      for (const want of ["Levels", old!, fresh!, started!, measure!, look!, "State", state!]) {
        expect(card).toContain(want);
      }
    }
  });

  test("a fourth row written to the open page shows without a reload", () => {
    const fourth: PageDoc = {
      id: "e4",
      row: sampleRow(
        "delta flow question",
        ["delta old", "delta new"],
        utcDate(0),
        "delta minutes",
        utcDate(2),
        "running",
      ),
    };
    const rendered = renderPage(samples(), [...samples(), fourth]);
    expect(cards(str(rendered.first)).length).toBe(3);
    const html = str(rendered.second);
    expect(cards(html).length).toBe(4);
    expect(html).toContain("delta flow question");
  });

  test("no store and an empty store show one plain line, and no error", () => {
    const none = renderPage(null);
    expect(str(none.first)).toContain("No experiments to show.");
    expect(str(none.first).split('class="card').length).toBe(1);
    const empty = renderPage([]);
    expect(str(empty.first)).toContain("No experiments to show.");
    expect(str(empty.first).split('class="card').length).toBe(1);
  });

  test("the page is made for the phone: viewport and a grid that cannot push wide", () => {
    const html = readFileSync(PAGE, "utf8");
    expect(html).toContain('<meta name="viewport"');
    expect(html).toContain("min-width: 0");
  });

  test("markup the page never trusts is escaped", () => {
    const evil: PageDoc = {
      id: "e9",
      row: sampleRow(
        "<img src=x onerror=y>",
        ["a & b", "c"],
        utcDate(0),
        "m",
        utcDate(1),
        "running",
      ),
    };
    const html = str(renderPage([evil]).first);
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");
    expect(html).toContain("a &amp; b");
  });
});

describe("C3 page: what is due stands first and marked", () => {
  test("the card past its date is first and marked; the later one is not", () => {
    const html = str(renderPage(samples()).first);
    expect(html.indexOf("beta flow question")).toBeLessThan(html.indexOf("alpha flow question"));
    expect(html.indexOf("alpha flow question")).toBeLessThan(html.indexOf("gamma flow question"));
    expect(cardFor(html, "beta flow question")).toContain(">Due<");
    expect(cardFor(html, "alpha flow question")).not.toContain("Due");
    expect(html.split('class="card due"').length).toBe(2);
  });

  test("a date equal to today is due; moving it on and concluding clear it", () => {
    const [a, b, c] = samples();
    const dueish: PageDoc = {
      id: "e4",
      row: sampleRow("delta flow question", ["d1", "d2"], utcDate(0), "m", utcDate(0), "running"),
    };
    const html = str(renderPage([a!, b!, c!, dueish]).first);
    expect(cardFor(html, "delta flow question")).toContain(">Due<");
    const moved: PageDoc = {
      ...dueish,
      row: { ...dueish.row, look: utcDate(5) },
    };
    const htmlMoved = str(renderPage([a!, b!, c!, moved]).first);
    expect(cardFor(htmlMoved, "delta flow question")).not.toContain("Due");
    const over: PageDoc = {
      ...dueish,
      row: { ...dueish.row, state: "concluded", result: "delta tied", ended: utcDate(0) },
    };
    const htmlOver = str(renderPage([a!, b!, c!, over]).first);
    expect(cardFor(htmlOver, "delta flow question")).not.toContain("Due");
  });

  test("concluded cards stand last, newest first", () => {
    const [a, b, c] = samples();
    const older: PageDoc = {
      id: "e4",
      row: sampleRow(
        "delta flow question",
        ["d1", "d2"],
        utcDate(-4),
        "m",
        utcDate(-2),
        "concluded",
        "delta tied",
        null,
        utcDate(-1),
      ),
    };
    const html = str(renderPage([a!, b!, c!, older]).first);
    expect(html.indexOf("gamma new won by a mile")).toBeLessThan(html.indexOf("delta tied"));
  });
});

describe("C4: a concluded card shows its result and where its evidence is", () => {
  test("evidence with an address is linked; a path on the machine is plain text", () => {
    const [a, b, c] = samples();
    const pathed: PageDoc = {
      id: "e4",
      row: sampleRow(
        "delta flow question",
        ["d1", "d2"],
        utcDate(-4),
        "m",
        utcDate(-2),
        "concluded",
        "delta tied",
        "/home/user/records/delta",
        utcDate(-1),
      ),
    };
    const html = str(renderPage([a!, b!, c!, pathed]).first);
    const linked = cardFor(html, "gamma flow question");
    expect(linked).toContain("gamma new won by a mile");
    expect(linked).toContain('<a href="https://example.invalid/pull/377">');
    const plain = cardFor(html, "delta flow question");
    expect(plain).toContain("/home/user/records/delta");
    expect(plain).not.toContain("<a ");
  });
});

describe("levels are never arms or workhorses, on the page or in the code", () => {
  test("the new files name them levels", () => {
    for (const file of [EXPERIMENTS, PAGE, SKILL]) {
      const text = readFileSync(file, "utf8");
      expect(text).not.toMatch(/workhorse/i);
      expect(text).not.toMatch(/\barm\b/i);
      expect(text).not.toMatch(/condition/i);
    }
  });
});

describe("C5: the postmaster keeps the record and the page current", () => {
  test("the runbook names starting, due and concluding, the command and the page write", () => {
    const text = readFileSync(POSTMASTER_MD, "utf8");
    expect(text).toContain("<tool>/scripts/run experiments");
    expect(text).toContain("experiments start");
    expect(text).toContain("experiments move");
    expect(text).toContain("experiments conclude");
    expect(text).toContain("ArtifactData");
    const stageD = text.indexOf("## Stage D");
    const nextStage = text.indexOf("\n## ", stageD + 1);
    const supervise = text.slice(stageD, nextStage < 0 ? undefined : nextStage);
    expect(supervise).toContain("experiment");
    expect(supervise).toContain("user decides");
  });

  test("every script path the runbooks name still resolves", () => {
    const r = run(RUN, ["skill-refs"], { cwd: TOOL });
    expectOk(r, "skill-refs");
  });

  test("the experiments skill says how to publish once, write rows and keep the link", () => {
    const text = readFileSync(SKILL, "utf8");
    for (const want of [
      "Artifact",
      "stop the watch",
      "ArtifactData",
      ".postmaster/",
      "experiments",
    ]) {
      expect(text).toContain(want);
    }
  });
});

describe("C6: the README states the design goal", () => {
  test("the two sentences stand after the opening paragraph, before the roles", () => {
    const text = readFileSync(README, "utf8");
    const sentences =
      "A design goal of postmaster is not to give you a complete solution. " +
      "It is to let you run experiments on different flows, so that you can find what works for your project.";
    const at = text.indexOf(sentences);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(text.slice(0, at)).toContain("the merge authority in the config.");
    expect(at).toBeLessThan(text.indexOf("## The four roles"));
    expect(text.slice(0, at).endsWith("\n\n")).toBe(true);
    expect(text[at + sentences.length]).toBe("\n");
  });
});
