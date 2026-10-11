// Oracle for #329, committed before the change: when a review loop stops
// converging, the surveyor reports why before the user decides. C1 pins the
// trigger (a rise, and only a rise) with the ticket's five rises and three
// controls; C2 the materials the survey is given; C3 the four-part question
// and the missing-part path to the escalation; C4 the plain words before the
// options; C5 the missing-survey path end to end. C6, the fixture run from
// the branch, is a flow step the postmaster runs after the ship card, not a
// test. The C3 hand-run (real surveys on the five rise copies, quoted on
// checkpoint-1 beside the causes found at the time) is done by the coachman
// during synthesis. Every case drives scripts/run as a subprocess, with the
// surveyor call stood in for behind POSTMASTER_SURVEYOR_RUN.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  answerMissing,
  both,
  coachmanFile,
  CONTROLS,
  copyActionLines,
  expectedCountsLine,
  expectedReports,
  expectedSnapshotsLine,
  FALLING_DECISION,
  FULL_ANSWER,
  makeCopy,
  makeFalling,
  PART_CAUSE,
  PARTS,
  PLAIN_WORDS,
  reportBasename,
  reviewDecide,
  reviewSurvey,
  RISES,
  ROOT,
  scratchDir,
  removeDir,
  setStandin,
  standinCalls,
  type CopyLayout,
  type CopyOpts,
} from "./acceptance-329.ts";

const QUESTION = join(ROOT, "skills", "postmaster", "review-rise-question.md");

function check(name: string, fn: () => void): void {
  test(name, fn, 60000);
}

function withCopy(
  run: string,
  stop: number,
  opts: CopyOpts,
  fn: (lay: CopyLayout) => void,
): void {
  const lay = makeCopy(run, stop, opts);
  try {
    fn(lay);
  } finally {
    lay.cleanup();
  }
}

function materialsOf(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--material" && argv[i + 1] !== undefined) out.push(argv[i + 1] as string);
  }
  return out;
}

function flagOf(argv: string[], flag: string): string | null {
  const i = argv.indexOf(flag);
  return i < 0 || argv[i + 1] === undefined ? null : (argv[i + 1] as string);
}

describe("C1: the step surveys a rise, and only a rise", () => {
  for (const rise of RISES) {
    check(`review-decide prints RULING on ${rise.run} after round ${rise.round}`, () => {
      withCopy(rise.run, rise.round, { reports: false, ticket: false, decoys: false }, (lay) => {
        const r = reviewDecide(lay.dispatch, rise.round);
        expect(r.code).toBe(0);
        expect(r.out.trim()).toBe(rise.decision);
      });
    });
  }

  for (const control of CONTROLS) {
    check(`review-decide prints its line on ${control.run} after round ${control.round}`, () => {
      withCopy(
        control.run,
        control.round,
        { reports: false, ticket: false, decoys: false },
        (lay) => {
          const r = reviewDecide(lay.dispatch, control.round);
          expect(r.code).toBe(0);
          expect(r.out.trim()).toBe(control.decision);
        },
      );
    });
  }

  check("review-decide prints RULING on the falling record", () => {
    const tmp = scratchDir("rise-oracle-");
    try {
      const { dispatch } = makeFalling(tmp);
      const r = reviewDecide(dispatch, 4);
      expect(r.code).toBe(0);
      expect(r.out.trim()).toBe(FALLING_DECISION);
    } finally {
      removeDir(tmp);
    }
  });

  for (const rise of RISES) {
    check(`${rise.run} after round ${rise.round} starts one survey call named for its round`, () => {
      withCopy(rise.run, rise.round, {}, (lay) => {
        setStandin(lay, "answer", { answer: FULL_ANSWER });
        const before = readFileSync(join(lay.dispatch, "actions.jsonl"), "utf8");
        const r = reviewSurvey(lay, [
          "survey",
          lay.dispatch,
          lay.repo,
          String(rise.round),
          "--snapshot",
          rise.sha,
        ]);
        expect(both(r)).toBe(r.out);
        expect(r.code).toBe(0);
        const record = join(lay.dispatch, "surveys", `rise-r${rise.round}.md`);
        expect(r.out.trim()).toBe(record);
        expect(readFileSync(record, "utf8")).toBe(FULL_ANSWER);

        const calls = standinCalls(lay.record);
        expect(calls.length).toBe(1);
        const argv = calls[0]?.argv ?? [];
        expect(argv.slice(0, 4)).toEqual(["surveyor", "call", lay.dispatch, lay.repo]);
        expect(flagOf(argv, "--name")).toBe(`rise-r${rise.round}`);
        expect(flagOf(argv, "--snapshot")).toBe(rise.sha);
        expect(flagOf(argv, "--question")).toBe(QUESTION);
        expect(flagOf(argv, "--timeout")).toBe("2400");
        const materials = materialsOf(argv);
        const reports = expectedReports(rise.run, rise.round).map((f) =>
          join(lay.dispatch, "logs", f),
        );
        expect(materials[0]).toBe(join(lay.dispatch, "ticket-body.md"));
        expect(materials.slice(1, -1)).toEqual(reports);
        expect(materials.length).toBe(reports.length + 2);
        const staged = materials[materials.length - 1] ?? "";
        expect(staged.startsWith(lay.dispatch)).toBe(false);

        // The call waits: the answer is recorded before the step returns,
        // and the escalation is not the step's to write: the decoy stands untouched.
        expect(readFileSync(join(lay.dispatch, "ESCALATION.md"), "utf8")).toContain("Decoy");
        expect(existsSync(join(lay.dispatch, ".escalation-ready"))).toBe(false);
        const after = readFileSync(join(lay.dispatch, "actions.jsonl"), "utf8");
        expect(after.startsWith(before)).toBe(true);
        expect(after.slice(before.length)).toContain(`rise-r${rise.round}`);
      });
    });
  }

  for (const control of CONTROLS) {
    check(`${control.run} after round ${control.round} starts no survey call`, () => {
      withCopy(control.run, control.round, {}, (lay) => {
        setStandin(lay, "answer", { answer: FULL_ANSWER });
        const before = readFileSync(join(lay.dispatch, "actions.jsonl"), "utf8");
        const r = reviewSurvey(lay, ["survey", lay.dispatch, lay.repo, String(control.round)]);
        expect(r.code).toBe(2);
        expect(both(r)).toContain(control.cause);
        expect(standinCalls(lay.record)).toEqual([]);
        expect(existsSync(join(lay.dispatch, "surveys"))).toBe(false);
        expect(readFileSync(join(lay.dispatch, "actions.jsonl"), "utf8")).toBe(before);
      });
    });
  }

  check("the falling record starts no survey call", () => {
    const tmp = scratchDir("rise-oracle-");
    try {
      const { dispatch, repo } = makeFalling(tmp);
      const lay = makeCopy("218", 3, { reports: false, ticket: false, decoys: false });
      try {
        const r = reviewSurvey(
          { ...lay, dispatch, repo },
          ["survey", dispatch, repo, "4"],
        );
        expect(r.code).toBe(2);
        expect(both(r)).toContain("RULING no-working-reviewer");
        expect(standinCalls(lay.record)).toEqual([]);
        expect(existsSync(join(dispatch, "surveys"))).toBe(false);
      } finally {
        lay.cleanup();
      }
    } finally {
      removeDir(tmp);
    }
  });
});

describe("C2: the survey is given the trial's materials", () => {
  const rise = RISES[0]!;

  check("202 after round 5 is given the question, ticket, reports and rounds", () => {
    withCopy(rise.run, rise.round, {}, (lay) => {
      setStandin(lay, "answer", { answer: FULL_ANSWER });
      const before = copyActionLines(lay.dispatch);
      const r = reviewSurvey(lay, [
        "survey",
        lay.dispatch,
        lay.repo,
        String(rise.round),
        "--snapshot",
        rise.sha,
      ]);
      expect(r.code).toBe(0);
      const argv = standinCalls(lay.record)[0]?.argv ?? [];
      expect(flagOf(argv, "--question")).toBe(QUESTION);
      expect(existsSync(QUESTION)).toBe(true);
      const materials = materialsOf(argv);
      expect(materials).toContain(join(lay.dispatch, "ticket-body.md"));
      for (const f of expectedReports(rise.run, rise.round)) {
        expect(materials).toContain(join(lay.dispatch, "logs", f));
      }
      const staged = materials[materials.length - 1] ?? "";
      const rounds = readFileSync(staged, "utf8");
      for (const line of before) {
        expect(rounds).toContain(line);
      }
      expect(rounds).toContain(expectedCountsLine(rise.counts));
      expect(rounds).toContain(expectedSnapshotsLine(rise.round, rise.sha));
      expect(rounds).toContain(`survey-snapshot: ${rise.sha}`);
      expect(rounds).not.toContain('"action":"note"');
      expect(rounds).not.toContain('"action":"escalate"');
      expect(rounds).not.toContain('"action":"review-harvest"');
      const kept = join(lay.dispatch, "surveys", `rise-r${rise.round}-rounds.md`);
      expect(readFileSync(kept, "utf8")).toBe(rounds);
    });
  });

  check("the call is given none of the run's other records", () => {
    withCopy(rise.run, rise.round, {}, (lay) => {
      const decoys = [
        "brief.md",
        "ESCALATION.md",
        "checkpoint-1.md",
        "checkpoint-review.md",
        "card.md",
        "run-log.md",
        "handoff-1.md",
        "handoff-2.md",
        "review-style-brief.md",
        "review-security-brief.md",
        "review-r1-security-opus-prompt.txt",
        "review-r2-bug-luna-prompt.txt",
      ];
      for (const d of decoys) {
        expect(existsSync(join(lay.dispatch, d))).toBe(true);
      }
      setStandin(lay, "answer", { answer: FULL_ANSWER });
      const r = reviewSurvey(lay, [
        "survey",
        lay.dispatch,
        lay.repo,
        String(rise.round),
        "--snapshot",
        rise.sha,
      ]);
      expect(r.code).toBe(0);
      const argv = standinCalls(lay.record)[0]?.argv ?? [];
      const basenames = [...materialsOf(argv), flagOf(argv, "--question") ?? ""].map(
        reportBasename,
      );
      for (const d of decoys) {
        expect(basenames).not.toContain(d);
      }
      for (const m of materialsOf(argv)) {
        expect(m).not.toBe(join(lay.dispatch, "brief.md"));
      }
    });
  });

  check("injected note, escalate and review-harvest lines stay out of the rounds", () => {
    withCopy(
      rise.run,
      rise.round,
      {
        inject: [
          JSON.stringify({
            actor: "coachman",
            action: "note",
            target: "r5",
            detail: "round 5 was cloudy",
          }),
          JSON.stringify({
            actor: "coachman",
            action: "escalate",
            target: "ESCALATION.md",
            detail: "round 5 residue",
          }),
          JSON.stringify({
            actor: "coachman",
            action: "review-harvest",
            target: "luna",
            detail: "bug round 5 thread-1",
          }),
        ],
      },
      (lay) => {
        setStandin(lay, "answer", { answer: FULL_ANSWER });
        const r = reviewSurvey(lay, [
          "survey",
          lay.dispatch,
          lay.repo,
          String(rise.round),
          "--snapshot",
          rise.sha,
        ]);
        expect(r.code).toBe(0);
        const argv = standinCalls(lay.record)[0]?.argv ?? [];
        const staged = materialsOf(argv).pop() ?? "";
        const rounds = readFileSync(staged, "utf8");
        expect(rounds).not.toContain("round 5 was cloudy");
        expect(rounds).not.toContain("round 5 residue");
        expect(rounds).not.toContain("thread-1");
      },
    );
  });

  check("268 after round 8 keeps its oddly spelled round-6 degrades", () => {
    const r268 = RISES[2]!;
    withCopy(r268.run, r268.round, {}, (lay) => {
      setStandin(lay, "answer", { answer: FULL_ANSWER });
      const r = reviewSurvey(lay, [
        "survey",
        lay.dispatch,
        lay.repo,
        String(r268.round),
        "--snapshot",
        r268.sha,
      ]);
      expect(r.code).toBe(0);
      const argv = standinCalls(lay.record)[0]?.argv ?? [];
      const staged = materialsOf(argv).pop() ?? "";
      const rounds = readFileSync(staged, "utf8");
      expect(rounds).toContain("security round 6 attempt 1:");
      expect(rounds).toContain("security round 6 attempt 2:");
    });
  });
});

describe("C3: the question asks the four parts", () => {
  check("the question file names the four parts, each under its own heading", () => {
    expect(existsSync(QUESTION)).toBe(true);
    const text = readFileSync(QUESTION, "utf8");
    for (const part of PARTS) {
      expect(text).toContain(`## ${part}\n`);
    }
    expect(text).toContain("history");
  });

  check("the question file stays off the coachman contract list", () => {
    const toml = readFileSync(join(ROOT, "docs", "coachman-contract.toml"), "utf8");
    expect(toml).not.toContain("review-rise-question");
  });

  check("a stand-in answer missing one part names it in the escalation", () => {
    const r342 = RISES[4]!;
    withCopy(r342.run, r342.round, {}, (lay) => {
      setStandin(lay, "answer", { answer: answerMissing(PART_CAUSE) });
      const s = reviewSurvey(lay, [
        "survey",
        lay.dispatch,
        lay.repo,
        String(r342.round),
        "--snapshot",
        r342.sha,
      ]);
      expect(s.code).toBe(0);
      const coachman = coachmanFile(lay.tmp);
      const e = reviewSurvey(lay, [
        "escalate",
        lay.dispatch,
        String(r342.round),
        "--decision",
        r342.decision,
        "--coachman",
        coachman,
      ]);
      expect(both(e)).toBe(e.out);
      expect(e.code).toBe(0);
      const escalation = readFileSync(join(lay.dispatch, "ESCALATION.md"), "utf8");
      expect(escalation).toContain("Survey: surveys/rise-r2.md");
      expect(escalation).toContain(`Missing parts: ${PART_CAUSE}`);
      expect(escalation).toContain(r342.decision);
      expect(existsSync(join(lay.dispatch, ".escalation-ready"))).toBe(true);
      const actions = readFileSync(join(lay.dispatch, "actions.jsonl"), "utf8");
      expect(actions).toContain('"action":"escalate"');
    });
  });

  check("a full answer leaves no missing-parts line", () => {
    const r342 = RISES[4]!;
    withCopy(r342.run, r342.round, {}, (lay) => {
      setStandin(lay, "answer", { answer: FULL_ANSWER });
      const s = reviewSurvey(lay, [
        "survey",
        lay.dispatch,
        lay.repo,
        String(r342.round),
        "--snapshot",
        r342.sha,
      ]);
      expect(s.code).toBe(0);
      const coachman = coachmanFile(lay.tmp);
      const e = reviewSurvey(lay, [
        "escalate",
        lay.dispatch,
        String(r342.round),
        "--decision",
        r342.decision,
        "--coachman",
        coachman,
      ]);
      expect(e.code).toBe(0);
      const escalation = readFileSync(join(lay.dispatch, "ESCALATION.md"), "utf8");
      expect(escalation).toContain("Survey: surveys/rise-r2.md");
      expect(escalation).not.toContain("Missing parts");
    });
  });

  check("the escalation renders exactly", () => {
    const r342 = RISES[4]!;
    withCopy(r342.run, r342.round, {}, (lay) => {
      setStandin(lay, "answer", { answer: FULL_ANSWER });
      const s = reviewSurvey(lay, [
        "survey",
        lay.dispatch,
        lay.repo,
        String(r342.round),
        "--snapshot",
        r342.sha,
      ]);
      expect(s.code).toBe(0);
      const coachman = coachmanFile(lay.tmp, "coachman.md", {
        residue: "The round-2 fix is not yet re-reviewed.",
        options: "1. Fix the finding.\n2. Accept it as a known limit.",
        advice: "Fix it: the change is small.",
      });
      const e = reviewSurvey(lay, [
        "escalate",
        lay.dispatch,
        String(r342.round),
        "--decision",
        r342.decision,
        "--coachman",
        coachman,
      ]);
      expect(e.code).toBe(0);
      expect(readFileSync(join(lay.dispatch, "ESCALATION.md"), "utf8")).toBe(
        `# Escalation: review loop stopped at round 2

Decision: ${r342.decision}
Survey: surveys/rise-r2.md

## Residue

The round-2 fix is not yet re-reviewed.

## Options

1. Fix the finding.
2. Accept it as a known limit.

## Advice

Fix it: the change is small.
`,
      );
    });
  });

  check("escalate refuses a decision that is not a ruling", () => {
    const r342 = RISES[4]!;
    withCopy(r342.run, r342.round, {}, (lay) => {
      const coachman = coachmanFile(lay.tmp);
      const e = reviewSurvey(lay, [
        "escalate",
        lay.dispatch,
        String(r342.round),
        "--decision",
        "RUN 3: round 2 logged no more P1 or P2 findings than round 1",
        "--coachman",
        coachman,
      ]);
      expect(e.code).toBe(1);
      expect(readFileSync(join(lay.dispatch, "ESCALATION.md"), "utf8")).toContain("Decoy");
    });
  });

  check("escalate refuses a coachman file with a section missing", () => {
    const r342 = RISES[4]!;
    withCopy(r342.run, r342.round, {}, (lay) => {
      const coachman = coachmanFile(lay.tmp, "thin.md", {
        residue: "Some residue.",
        options: "1. Go on.",
        advice: "",
      });
      const e = reviewSurvey(lay, [
        "escalate",
        lay.dispatch,
        String(r342.round),
        "--decision",
        r342.decision,
        "--coachman",
        coachman,
      ]);
      expect(e.code).toBe(1);
      expect(both(e)).toContain("Advice");
    });
  });
});

describe("C4: the user reads plain words before the options", () => {
  const BODIES = {
    residue: "The round-2 fix is not yet re-reviewed.",
    options: "1. Fix the finding.\n2. Accept it as a known limit.",
    advice: "Fix it: the change is small.",
  };

  check("the question shows the plain words before the options", () => {
    const r342 = RISES[4]!;
    withCopy(r342.run, r342.round, {}, (lay) => {
      setStandin(lay, "answer", { answer: FULL_ANSWER });
      const s = reviewSurvey(lay, [
        "survey",
        lay.dispatch,
        lay.repo,
        String(r342.round),
        "--snapshot",
        r342.sha,
      ]);
      expect(s.code).toBe(0);
      const coachman = coachmanFile(lay.tmp, "coachman.md", BODIES);
      const e = reviewSurvey(lay, [
        "escalate",
        lay.dispatch,
        String(r342.round),
        "--decision",
        r342.decision,
        "--coachman",
        coachman,
      ]);
      expect(e.code).toBe(0);
      const q = reviewSurvey(lay, ["question", lay.dispatch]);
      expect(both(q)).toBe(q.out);
      expect(q.code).toBe(0);
      const waiting = readFileSync(join(lay.dispatch, ".waiting-on-user"), "utf8");
      expect(waiting).toBe(`${PLAIN_WORDS}

## Options

${BODIES.options}

## Advice

${BODIES.advice}
`);
      expect(waiting.indexOf(PLAIN_WORDS)).toBeLessThan(waiting.indexOf("## Options"));
      expect(waiting).not.toContain(BODIES.residue);
    });
  });

  check("the question step leaves a non-rise escalation alone", () => {
    const r342 = RISES[4]!;
    withCopy(r342.run, r342.round, {}, (lay) => {
      const q = reviewSurvey(lay, ["question", lay.dispatch]);
      expect(q.code).toBe(2);
      expect(both(q)).toContain("no survey named");
      expect(existsSync(join(lay.dispatch, ".waiting-on-user"))).toBe(false);
    });
  });
});

describe("C5: a missing survey never holds up the question", () => {
  function surveyedMissing(
    lay: CopyLayout,
    reason: string,
  ): { escalation: string; waiting: string } {
    const r342 = RISES[4]!;
    const coachman = coachmanFile(lay.tmp);
    const e = reviewSurvey(lay, [
      "escalate",
      lay.dispatch,
      String(r342.round),
      "--decision",
      r342.decision,
      "--coachman",
      coachman,
    ]);
    expect(e.code).toBe(0);
    const escalation = readFileSync(join(lay.dispatch, "ESCALATION.md"), "utf8");
    expect(escalation).toContain(`Survey missing: ${reason}`);
    expect(escalation).not.toContain("Missing parts");
    expect(existsSync(join(lay.dispatch, ".escalation-ready"))).toBe(true);
    const q = reviewSurvey(lay, ["question", lay.dispatch]);
    expect(q.code).toBe(0);
    const waiting = readFileSync(join(lay.dispatch, ".waiting-on-user"), "utf8");
    expect(waiting).toContain(`Survey missing: ${reason}`);
    expect(waiting.indexOf(`Survey missing: ${reason}`)).toBeLessThan(
      waiting.indexOf("## Options"),
    );
    return { escalation, waiting };
  }

  check("a lane that exited non-zero still asks the question with its reason", () => {
    const r342 = RISES[4]!;
    withCopy(r342.run, r342.round, {}, (lay) => {
      setStandin(lay, "noanswer", { reason: "the surveyor lane exited 1." });
      const s = reviewSurvey(lay, [
        "survey",
        lay.dispatch,
        lay.repo,
        String(r342.round),
        "--snapshot",
        r342.sha,
      ]);
      expect(s.code).toBe(3);
      const record = join(lay.dispatch, "surveys", `rise-r${r342.round}.md`);
      expect(s.out.trim()).toBe(record);
      expect(readFileSync(record, "utf8")).toBe("No answer: the surveyor lane exited 1.\n");
      surveyedMissing(lay, "the surveyor lane exited 1.");
    });
  });

  check("a lane stopped at the deadline still asks the question with its reason", () => {
    const r342 = RISES[4]!;
    withCopy(r342.run, r342.round, {}, (lay) => {
      setStandin(lay, "noanswer", {
        reason: "still running at the 2400s deadline; stopped.",
      });
      const s = reviewSurvey(lay, [
        "survey",
        lay.dispatch,
        lay.repo,
        String(r342.round),
        "--snapshot",
        r342.sha,
      ]);
      expect(s.code).toBe(3);
      surveyedMissing(lay, "still running at the 2400s deadline; stopped.");
    });
  });

  check("a refused call is recorded from its reason", () => {
    const r342 = RISES[4]!;
    withCopy(r342.run, r342.round, {}, (lay) => {
      setStandin(lay, "refuse", { reason: "no such commit in the repo: deadbee" });
      const s = reviewSurvey(lay, [
        "survey",
        lay.dispatch,
        lay.repo,
        String(r342.round),
        "--snapshot",
        r342.sha,
      ]);
      expect(s.code).toBe(3);
      const record = join(lay.dispatch, "surveys", `rise-r${r342.round}.md`);
      expect(readFileSync(record, "utf8")).toBe(
        "No answer: no such commit in the repo: deadbee\n",
      );
      surveyedMissing(lay, "no such commit in the repo: deadbee");
    });
  });

  check("a failed call is recorded from its reason", () => {
    const r342 = RISES[4]!;
    withCopy(r342.run, r342.round, {}, (lay) => {
      setStandin(lay, "fault", { reason: "the surveyor did not start: no host" });
      const s = reviewSurvey(lay, [
        "survey",
        lay.dispatch,
        lay.repo,
        String(r342.round),
        "--snapshot",
        r342.sha,
      ]);
      expect(s.code).toBe(3);
      const record = join(lay.dispatch, "surveys", `rise-r${r342.round}.md`);
      expect(readFileSync(record, "utf8")).toBe(
        "No answer: the surveyor did not start: no host\n",
      );
      surveyedMissing(lay, "the surveyor did not start: no host");
    });
  });

  check("an answerless end without a record is recorded plainly", () => {
    const r342 = RISES[4]!;
    withCopy(r342.run, r342.round, {}, (lay) => {
      setStandin(lay, "norecord");
      const s = reviewSurvey(lay, [
        "survey",
        lay.dispatch,
        lay.repo,
        String(r342.round),
        "--snapshot",
        r342.sha,
      ]);
      expect(s.code).toBe(3);
      const record = join(lay.dispatch, "surveys", `rise-r${r342.round}.md`);
      expect(readFileSync(record, "utf8")).toBe(
        "No answer: the surveyor ended without an answer or a record\n",
      );
      surveyedMissing(lay, "the surveyor ended without an answer or a record");
    });
  });

  check("a rise with no ticket file still asks the question", () => {
    const r342 = RISES[4]!;
    withCopy(r342.run, r342.round, { ticket: false }, (lay) => {
      setStandin(lay, "answer", { answer: FULL_ANSWER });
      const s = reviewSurvey(lay, [
        "survey",
        lay.dispatch,
        lay.repo,
        String(r342.round),
        "--snapshot",
        r342.sha,
      ]);
      expect(s.code).toBe(3);
      expect(standinCalls(lay.record)).toEqual([]);
      const record = join(lay.dispatch, "surveys", `rise-r${r342.round}.md`);
      expect(readFileSync(record, "utf8")).toBe("No answer: no ticket file in the dispatch\n");
      surveyedMissing(lay, "no ticket file in the dispatch");
    });
  });

  check("a rise with no snapshot still asks the question", () => {
    const r342 = RISES[4]!;
    withCopy(r342.run, r342.round, {}, (lay) => {
      setStandin(lay, "answer", { answer: FULL_ANSWER });
      const s = reviewSurvey(lay, ["survey", lay.dispatch, lay.repo, String(r342.round)]);
      expect(s.code).toBe(3);
      expect(standinCalls(lay.record)).toEqual([]);
      const record = join(lay.dispatch, "surveys", `rise-r${r342.round}.md`);
      expect(readFileSync(record, "utf8")).toBe("No answer: no recorded snapshot for round 2\n");
      surveyedMissing(lay, "no recorded snapshot for round 2");
    });
  });

  check("an escalation without any survey still asks the question", () => {
    withCopy("342", 2, {}, (lay) => {
      surveyedMissing(lay, "no survey was recorded for round 2");
    });
  });

  check("a question whose survey record is gone names that", () => {
    const r342 = RISES[4]!;
    withCopy(r342.run, r342.round, {}, (lay) => {
      setStandin(lay, "answer", { answer: FULL_ANSWER });
      const s = reviewSurvey(lay, [
        "survey",
        lay.dispatch,
        lay.repo,
        String(r342.round),
        "--snapshot",
        r342.sha,
      ]);
      expect(s.code).toBe(0);
      const coachman = coachmanFile(lay.tmp);
      const e = reviewSurvey(lay, [
        "escalate",
        lay.dispatch,
        String(r342.round),
        "--decision",
        r342.decision,
        "--coachman",
        coachman,
      ]);
      expect(e.code).toBe(0);
      removeDir(join(lay.dispatch, "surveys"));
      const q = reviewSurvey(lay, ["question", lay.dispatch]);
      expect(q.code).toBe(0);
      const waiting = readFileSync(join(lay.dispatch, ".waiting-on-user"), "utf8");
      expect(waiting).toContain("Survey missing: the survey record surveys/rise-r2.md");
    });
  });
});

describe("snapshots: gate derivation and override", () => {
  const AAA = "a".repeat(40);
  const BBB = "b".repeat(40);
  const CCC = "c".repeat(40);
  const DDD = "d".repeat(40);
  const EEE = "e".repeat(40);
  const FFF = "f".repeat(40);

  function gateCopy(lay: CopyLayout): void {
    const lines = [
      JSON.stringify({
        actor: "coachman",
        action: "gate",
        target: AAA,
        detail: "review round 1, run verify exit 0",
      }),
      JSON.stringify({
        actor: "coachman",
        action: "finding",
        target: "src/a.ts:1",
        detail: "gating P2 r1 bug luna, verified by reading",
      }),
      JSON.stringify({ actor: "coachman", action: "review-launch", target: "luna", detail: "bug round 1" }),
      JSON.stringify({
        actor: "coachman",
        action: "gate",
        target: BBB,
        detail: "review round 2, run verify exit 2",
      }),
      JSON.stringify({
        actor: "coachman",
        action: "gate",
        target: EEE,
        detail: "round 2 fixes, bun run check exit 0",
      }),
      JSON.stringify({
        actor: "coachman",
        action: "gate",
        target: DDD,
        detail: "review round 20, run verify exit 0",
      }),
      JSON.stringify({
        actor: "coachman",
        action: "gate",
        target: CCC,
        detail: "review round 2 retry, run verify exit 0",
      }),
      JSON.stringify({
        actor: "coachman",
        action: "finding",
        target: "src/b.ts:1",
        detail: "gating P1 r2 bug luna, verified by reading",
      }),
      JSON.stringify({
        actor: "coachman",
        action: "finding",
        target: "src/c.ts:1",
        detail: "gating P2 r2 bug luna, verified by reading",
      }),
      JSON.stringify({ actor: "coachman", action: "review-launch", target: "luna", detail: "bug round 2" }),
    ];
    writeFileSync(join(lay.dispatch, "actions.jsonl"), `${lines.join("\n")}\n`, "utf8");
    writeFileSync(join(lay.dispatch, "ticket-body.md"), "# Ticket\n\nA ticket.\n", "utf8");
  }

  function gateLayout(): CopyLayout {
    const lay = makeCopy("342", 2, { reports: false, ticket: false, decoys: false });
    gateCopy(lay);
    return lay;
  }

  check("the stop snapshot derives from the last gate line of its round", () => {
    const lay = gateLayout();
    try {
      setStandin(lay, "answer", { answer: FULL_ANSWER });
      const r = reviewSurvey(lay, ["survey", lay.dispatch, lay.repo, "2"]);
      expect(r.code).toBe(0);
      const argv = standinCalls(lay.record)[0]?.argv ?? [];
      expect(flagOf(argv, "--snapshot")).toBe(CCC);
      const staged = materialsOf(argv).pop() ?? "";
      const rounds = readFileSync(staged, "utf8");
      expect(rounds).toContain(`survey-snapshot: ${CCC}`);
      expect(rounds).toContain(`round-snapshots: r1=${AAA} r2=${CCC}`);
      expect(rounds).toContain("counts: r1=1 r2=2");
    } finally {
      lay.cleanup();
    }
  });

  check("an explicit snapshot wins over the records", () => {
    const lay = gateLayout();
    try {
      setStandin(lay, "answer", { answer: FULL_ANSWER });
      const r = reviewSurvey(lay, ["survey", lay.dispatch, lay.repo, "2", "--snapshot", FFF]);
      expect(r.code).toBe(0);
      const argv = standinCalls(lay.record)[0]?.argv ?? [];
      expect(flagOf(argv, "--snapshot")).toBe(FFF);
      const staged = materialsOf(argv).pop() ?? "";
      const rounds = readFileSync(staged, "utf8");
      expect(rounds).toContain(`round-snapshots: r1=${AAA} r2=${FFF}`);
    } finally {
      lay.cleanup();
    }
  });

  check("a rise with no reports still surveys", () => {
    const lay = gateLayout();
    try {
      setStandin(lay, "answer", { answer: FULL_ANSWER });
      const r = reviewSurvey(lay, ["survey", lay.dispatch, lay.repo, "2"]);
      expect(r.code).toBe(0);
      const argv = standinCalls(lay.record)[0]?.argv ?? [];
      expect(materialsOf(argv).length).toBe(2);
    } finally {
      lay.cleanup();
    }
  });
});

describe("timeout", () => {
  check("run.json review.round_timeout_seconds reaches the call", () => {
    const r342 = RISES[4]!;
    withCopy(r342.run, r342.round, { runJson: { config: { review: { round_timeout_seconds: 1234 } } } }, (lay) => {
      setStandin(lay, "answer", { answer: FULL_ANSWER });
      const r = reviewSurvey(lay, [
        "survey",
        lay.dispatch,
        lay.repo,
        String(r342.round),
        "--snapshot",
        r342.sha,
      ]);
      expect(r.code).toBe(0);
      const argv = standinCalls(lay.record)[0]?.argv ?? [];
      expect(flagOf(argv, "--timeout")).toBe("1234");
    });
  });

  check("an invalid timeout falls back to the default", () => {
    const r342 = RISES[4]!;
    withCopy(r342.run, r342.round, { runJson: { config: { review: { round_timeout_seconds: "soon" } } } }, (lay) => {
      setStandin(lay, "answer", { answer: FULL_ANSWER });
      const r = reviewSurvey(lay, [
        "survey",
        lay.dispatch,
        lay.repo,
        String(r342.round),
        "--snapshot",
        r342.sha,
      ]);
      expect(r.code).toBe(0);
      const argv = standinCalls(lay.record)[0]?.argv ?? [];
      expect(flagOf(argv, "--timeout")).toBe("2400");
      expect(r.err).toContain("default");
    });
  });
});

describe("idempotency", () => {
  check("a second survey call reuses the recorded answer", () => {
    const r342 = RISES[4]!;
    withCopy(r342.run, r342.round, {}, (lay) => {
      setStandin(lay, "answer", { answer: FULL_ANSWER });
      const first = reviewSurvey(lay, [
        "survey",
        lay.dispatch,
        lay.repo,
        String(r342.round),
        "--snapshot",
        r342.sha,
      ]);
      expect(first.code).toBe(0);
      const second = reviewSurvey(lay, [
        "survey",
        lay.dispatch,
        lay.repo,
        String(r342.round),
        "--snapshot",
        r342.sha,
      ]);
      expect(second.code).toBe(0);
      expect(second.out.trim()).toBe(first.out.trim());
      expect(standinCalls(lay.record).length).toBe(1);
    });
  });

  check("a recorded no-answer is returned without another call", () => {
    const r342 = RISES[4]!;
    withCopy(r342.run, r342.round, {}, (lay) => {
      setStandin(lay, "noanswer", { reason: "the surveyor lane exited 1." });
      const first = reviewSurvey(lay, [
        "survey",
        lay.dispatch,
        lay.repo,
        String(r342.round),
        "--snapshot",
        r342.sha,
      ]);
      expect(first.code).toBe(3);
      setStandin(lay, "answer", { answer: FULL_ANSWER });
      const second = reviewSurvey(lay, [
        "survey",
        lay.dispatch,
        lay.repo,
        String(r342.round),
        "--snapshot",
        r342.sha,
      ]);
      expect(second.code).toBe(3);
      expect(second.out.trim()).toBe(first.out.trim());
      expect(standinCalls(lay.record).length).toBe(1);
    });
  });
});

describe("usage", () => {
  check("a bad round is refused", () => {
    const r342 = RISES[4]!;
    withCopy(r342.run, r342.round, {}, (lay) => {
      for (const round of ["0", "x", "2x"]) {
        const r = reviewSurvey(lay, ["survey", lay.dispatch, lay.repo, round]);
        expect(r.code).toBe(1);
      }
    });
  });

  check("a missing dispatch is refused", () => {
    const r = reviewSurvey({ env: process.env as Record<string, string> } as CopyLayout, [
      "survey",
      "/nonexistent/dispatch",
      "/nonexistent/repo",
      "2",
    ]);
    expect(r.code).toBe(1);
  });
});
