// Oracle for #429, committed before the change: a surveyor skill gives a run
// an independent judgement from an agent that did not do the work. C1 pins the
// skill and its links; C2 the setup key and the lane pick, through the call,
// with stand-in harnesses; C3 the materials gate; C4 needs a model lane and
// stays hand-run by the coachman during synthesis; C5 the record and the lane
// failures. Every case drives scripts/run as a subprocess.
import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  both,
  callLines,
  claudeInit,
  claudeResult,
  codexDone,
  codexThread,
  git,
  makeSurveyLayout,
  need,
  patchRunJson,
  readActions,
  removeDir,
  ROOT,
  RUN,
  scratchDir,
  setStub,
  setupDryRun,
  sh,
  surveyor,
  writeAnswers,
  writeAnswersLeading,
  writeText,
  type SurveyLayout,
} from "./acceptance-429.ts";
import { claudeWall, CLAUDE_WALL_MESSAGE } from "./walls-oracle.ts";

function survey(name: string, fn: (lay: SurveyLayout) => void, timeout = 60000): void {
  test(
    name,
    () => {
      const lay = makeSurveyLayout();
      try {
        fn(lay);
      } finally {
        lay.cleanup();
      }
    },
    timeout,
  );
}

function writeQuestion(lay: SurveyLayout, name = "question.md"): string {
  const path = join(lay.tmp, name);
  writeFileSync(path, "# Question\n\nWhere do the round's serious findings cluster?\n", "utf8");
  return path;
}

describe("C1: the skill", () => {
  test("skills/surveyor/SKILL.md exists with front matter naming the surveyor", () => {
    const path = join(ROOT, "skills", "surveyor", "SKILL.md");
    expect(existsSync(path)).toBe(true);
    const text = readFileSync(path, "utf8");
    expect(text.startsWith("---\nname: surveyor\n")).toBe(true);
    expect(text).toContain("description:");
  });

  test("link-skills --dry-run lists surveyor for each harness with a skills folder", () => {
    // link-skills links the main checkout even from a worktree, so the
    // branch's own links are read from a checkout copy whose main it is.
    const dir = scratchDir("surveyor-links-");
    try {
      for (const n of ["scripts", "skills", "bunfig.toml", "package.json"]) {
        cpSync(join(ROOT, n), join(dir, n), { recursive: true });
      }
      chmodSync(join(dir, "scripts", "run"), 0o755);
      need(git("init", "-q", "-b", "main", dir), "init links repo");
      need(git("-C", dir, "add", "."), "add links tree");
      need(git("-C", dir, "commit", "-qm", "tree"), "commit links tree");
      // A clean home: the machine's own links point at its main checkout
      // and would read as in the way.
      const home = join(dir, "home");
      mkdirSync(home, { recursive: true });
      const env: Record<string, string | undefined> = { ...process.env, HOME: home };
      delete env.CLAUDE_CONFIG_DIR;
      const r = sh(join(dir, "scripts", "run"), ["link-skills", "--dry-run"], env);
      expect(r.code).toBe(0);
      const tags = new Set<string>();
      for (const line of r.out.split("\n")) {
        if (!line.includes("skills/clerk") && !line.includes("skills/postmaster")) continue;
        const m = /\(([a-z]+)\)[ \t]*$/u.exec(line);
        if (m?.[1]) tags.add(m[1]);
      }
      expect(tags.size).toBeGreaterThan(0);
      for (const tag of tags) {
        const found = r.out
          .split("\n")
          .some((l) => l.includes(join(dir, "skills", "surveyor")) && l.includes(`(${tag})`));
        expect(found).toBe(true);
      }
    } finally {
      removeDir(dir);
    }
  });

  test("skill-refs exits 0", () => {
    const r = sh(RUN, ["skill-refs"], process.env as Record<string, string>);
    expect(r.code).toBe(0);
  });
});

describe("C2: the setting and the lane", () => {
  test("setup --keys lists the optional surveyor key", () => {
    const r = sh(RUN, ["setup", "--keys"], process.env as Record<string, string>);
    expect(r.code).toBe(0);
    expect(r.out).toContain("surveyor?");
  });

  survey(
    "a dry run naming opus for the surveyor writes team.surveyor",
    (lay) => {
      const answers = writeAnswers(lay.tmp, "surveyor-opus", "surveyor=opus");
      const r = setupDryRun(lay.tmp, answers);
      expect(r.code).toBe(0);
      expect(r.out).toContain('surveyor = "opus"');
    },
    120000,
  );

  survey(
    "a dry run without it writes no surveyor",
    (lay) => {
      const answers = writeAnswers(lay.tmp, "surveyor-none");
      const r = setupDryRun(lay.tmp, answers);
      expect(r.code).toBe(0);
      expect(r.out).not.toContain("surveyor");
    },
    120000,
  );

  survey(
    "a surveyor that is not a lane is refused",
    (lay) => {
      const answers = writeAnswers(lay.tmp, "surveyor-sting", "surveyor=sting");
      const r = setupDryRun(lay.tmp, answers);
      expect(r.code).toBe(1);
      expect(r.out).toContain("sting");
    },
    120000,
  );

  survey(
    "a surveyor on a harness with no recorded shape is refused",
    (lay) => {
      const answers = writeAnswersLeading(
        lay.tmp,
        "surveyor-grok",
        ["lanes=opus, luna, grok", "lane.grok.harness=grok", "lane.grok.model=grok-model"],
        "surveyor=grok",
      );
      const r = setupDryRun(lay.tmp, answers);
      expect(r.code).toBe(1);
      expect(both(r)).toContain("grok");
    },
    120000,
  );

  survey("surveyor lane prints opus from run.json", (lay) => {
    patchRunJson(lay.dispatch, { config: { team: { surveyor: "opus" } } });
    const r = surveyor(lay, ["lane", lay.dispatch]);
    expect(r.code).toBe(0);
    expect(r.out.split("\n")[0]).toBe("opus");
    expect(r.out).toContain("team.surveyor");
  });

  survey("with none named it prints the first waybill reviewer", (lay) => {
    const r = surveyor(lay, ["lane", lay.dispatch]);
    expect(r.code).toBe(0);
    expect(r.out.split("\n")[0]).toBe("luna");
    expect(r.out).toContain("waybill");
  });

  survey(
    "the call launches lane opus when run.json names it",
    (lay) => {
      patchRunJson(lay.dispatch, { config: { team: { surveyor: "opus" } } });
      setStub(lay, "claude", {
        events: [claudeInit("t-opus"), claudeResult("## Conclusion\nOpus judged it.\n")],
        exit: 0,
      });
      const question = writeQuestion(lay);
      const r = surveyor(lay, [
        "call",
        lay.dispatch,
        lay.repo,
        "--name",
        "opus-call",
        "--snapshot",
        lay.sha,
        "--question",
        question,
        "--material",
        join(lay.dispatch, "ticket-body.md"),
        "--timeout",
        "600",
      ]);
      expect(both(r)).not.toContain("no such script");
      expect(r.code).toBe(0);
      const calls = callLines(lay);
      expect(calls.some((l) => l.startsWith("claude ") && l.includes("opus-model"))).toBe(true);
      expect(calls.some((l) => l.startsWith("codex "))).toBe(false);
      expect(readFileSync(join(lay.dispatch, "surveys", "opus-call.md"), "utf8")).toContain(
        "Opus judged it.",
      );
    },
    300000,
  );

  survey(
    "with none named the call launches luna",
    (lay) => {
      setStub(lay, "codex", {
        events: [codexThread("t-luna"), codexDone()],
        exit: 0,
        last: "## Conclusion\nLuna judged it.\n",
      });
      const question = writeQuestion(lay);
      const r = surveyor(lay, [
        "call",
        lay.dispatch,
        lay.repo,
        "--name",
        "luna-call",
        "--snapshot",
        lay.sha,
        "--question",
        question,
        "--material",
        join(lay.dispatch, "ticket-body.md"),
        "--timeout",
        "600",
      ]);
      expect(r.code).toBe(0);
      const calls = callLines(lay);
      expect(calls.some((l) => l.startsWith("codex ") && l.includes("luna-model"))).toBe(true);
      expect(calls.some((l) => l.startsWith("claude "))).toBe(false);
      expect(readFileSync(join(lay.dispatch, "surveys", "luna-call.md"), "utf8")).toContain(
        "Luna judged it.",
      );
    },
    300000,
  );
});

describe("C3: the materials gate", () => {
  const FORBIDDEN: Array<[string, string]> = [
    ["ESCALATION.md", "ESCALATION-MARKER-a1"],
    ["handoff-1.md", "HANDOFF-MARKER-b2"],
    ["checkpoint-review.md", "CHECKPOINT-MARKER-c3"],
    ["run-log.md", "RUNLOG-MARKER-d4"],
  ];

  function forbiddenDispatch(lay: SurveyLayout): void {
    for (const [file, marker] of FORBIDDEN) {
      writeFileSync(join(lay.dispatch, file), `# ${file}\n\n${marker}\n`, "utf8");
    }
    writeText(
      join(lay.dispatch, "logs", "review-r1-bug-luna-last.md"),
      "# Bug report\n\nNothing found.\n",
    );
  }

  survey(
    "allowed materials reach the prompt and folder, and nothing else does",
    (lay) => {
      forbiddenDispatch(lay);
      patchRunJson(lay.dispatch, { config: { team: { surveyor: "opus" } } });
      setStub(lay, "claude", {
        events: [claudeInit("t-c3"), claudeResult("## Conclusion\nJudged.\n")],
        exit: 0,
      });
      const question = writeQuestion(lay);
      const findings = join(lay.tmp, "caller-findings.md");
      writeFileSync(findings, "finding r1 one\nfinding r2 two\n", "utf8");
      const r = surveyor(lay, [
        "call",
        lay.dispatch,
        lay.repo,
        "--name",
        "gated",
        "--snapshot",
        lay.sha,
        "--question",
        question,
        "--material",
        join(lay.dispatch, "ticket-body.md"),
        "--material",
        join(lay.dispatch, "logs", "review-r1-bug-luna-last.md"),
        "--material",
        findings,
        "--timeout",
        "600",
      ]);
      expect(r.code).toBe(0);
      const folder = join(lay.repo, ".worktrees", "T-survey-gated", ".survey");
      const prompt = readFileSync(join(lay.dispatch, "survey-gated-prompt.txt"), "utf8");
      expect(prompt).toContain(join("skills", "surveyor", "SKILL.md"));
      expect(prompt).not.toContain(lay.dispatch);
      for (const [, marker] of FORBIDDEN) {
        expect(prompt).not.toContain(marker);
      }
      const held = readdirSync(folder).sort();
      expect(held.length).toBe(4);
      expect(held).toContain("question.md");
      const mats = held.filter((n: string) => n !== "question.md");
      expect(mats.length).toBe(3);
      expect(mats.every((n: string) => n.startsWith("material-"))).toBe(true);
      expect(readFileSync(join(folder, "question.md"), "utf8")).toBe(
        readFileSync(question, "utf8"),
      );
      const copies = mats.map((n: string) => readFileSync(join(folder, n), "utf8")).sort();
      const originals = [
        readFileSync(join(lay.dispatch, "ticket-body.md"), "utf8"),
        readFileSync(join(lay.dispatch, "logs", "review-r1-bug-luna-last.md"), "utf8"),
        readFileSync(findings, "utf8"),
      ].sort();
      expect(copies).toEqual(originals);
      for (const [, marker] of FORBIDDEN) {
        for (const text of copies) expect(text).not.toContain(marker);
      }
      for (const name of held) {
        expect(prompt).toContain(join(folder, name));
      }
      expect(callLines(lay).length).toBeGreaterThan(0);
    },
    300000,
  );

  survey(
    "a hand-written findings.md report passes the gate",
    (lay) => {
      forbiddenDispatch(lay);
      patchRunJson(lay.dispatch, { config: { team: { surveyor: "opus" } } });
      setStub(lay, "claude", {
        events: [claudeInit("t-md"), claudeResult("## Conclusion\nJudged.\n")],
        exit: 0,
      });
      writeText(
        join(lay.dispatch, "logs", "review-r1-bug-mimo-findings.md"),
        "# Bug findings, round 1, lane mimo (hand-read)\n",
      );
      const r = surveyor(lay, [
        "call",
        lay.dispatch,
        lay.repo,
        "--name",
        "handread",
        "--snapshot",
        lay.sha,
        "--question",
        writeQuestion(lay),
        "--material",
        join(lay.dispatch, "logs", "review-r1-bug-mimo-findings.md"),
        "--timeout",
        "600",
      ]);
      expect(r.code).toBe(0);
      expect(callLines(lay).length).toBeGreaterThan(0);
    },
    300000,
  );

  for (const [file] of FORBIDDEN) {
    survey(`listing ${file} is refused naming it, and nothing launches`, (lay) => {
      forbiddenDispatch(lay);
      const question = writeQuestion(lay);
      const before = callLines(lay).length;
      const r = surveyor(lay, [
        "call",
        lay.dispatch,
        lay.repo,
        "--name",
        "refused",
        "--snapshot",
        lay.sha,
        "--question",
        question,
        "--material",
        join(lay.dispatch, file),
        "--timeout",
        "600",
      ]);
      expect(r.code).toBe(2);
      expect(both(r)).toContain(file);
      expect(callLines(lay).length).toBe(before);
      expect(existsSync(join(lay.dispatch, "surveys", "refused.md"))).toBe(false);
    });
  }

  survey("a question inside the dispatch but outside the allowlist is refused", (lay) => {
    forbiddenDispatch(lay);
    const r = surveyor(lay, [
      "call",
      lay.dispatch,
      lay.repo,
      "--name",
      "refused-q",
      "--snapshot",
      lay.sha,
      "--question",
      join(lay.dispatch, "ESCALATION.md"),
      "--timeout",
      "600",
    ]);
    expect(r.code).toBe(2);
    expect(both(r)).toContain("ESCALATION.md");
    expect(callLines(lay).length).toBe(0);
  });

  survey("a missing material is refused naming it", (lay) => {
    const question = writeQuestion(lay);
    const r = surveyor(lay, [
      "call",
      lay.dispatch,
      lay.repo,
      "--name",
      "refused-missing",
      "--snapshot",
      lay.sha,
      "--question",
      question,
      "--material",
      join(lay.tmp, "no-such-file.md"),
      "--timeout",
      "600",
    ]);
    expect(r.code).toBe(2);
    expect(both(r)).toContain("no-such-file.md");
    expect(callLines(lay).length).toBe(0);
  });
});

describe("C4: the live survey", () => {
  test.skipIf(true)("the synthesis call answers in form and is kept and quoted", () => {
    // Needs a model lane on the run's surveyor pick, over a copy of run 202
    // at 665a99f: the coachman makes the call once during synthesis, keeps
    // the answer in the run's record and quotes it. Hand-run, not runnable here.
  });
});

describe("C5: the record and the failures", () => {
  const ANSWER = "## Conclusion\nThe cluster sits in auth.\n\n## Reasons\nTwo reports agree.\n";

  function opusCall(
    lay: SurveyLayout,
    name: string,
    answer: string,
    timeout = "600",
  ): { code: number; out: string; err: string } {
    patchRunJson(lay.dispatch, { config: { team: { surveyor: "opus" } } });
    setStub(lay, "claude", {
      events: [claudeInit(`t-${name}`), claudeResult(answer)],
      exit: 0,
    });
    return surveyor(lay, [
      "call",
      lay.dispatch,
      lay.repo,
      "--name",
      name,
      "--snapshot",
      lay.sha,
      "--question",
      writeQuestion(lay, `${name}-q.md`),
      "--timeout",
      timeout,
    ]);
  }

  survey(
    "a stand-in answer is written under the caller's name with one action line",
    (lay) => {
      const r = opusCall(lay, "first", ANSWER);
      expect(r.code).toBe(0);
      expect(r.out.trim()).toBe(join(lay.dispatch, "surveys", "first.md"));
      expect(readFileSync(join(lay.dispatch, "surveys", "first.md"), "utf8")).toBe(ANSWER);
      const harvests = readActions(lay.dispatch).filter((a) => a.action === "harvest");
      expect(harvests.length).toBe(1);
      expect(harvests[0]!.target).toBe("first");
      expect(harvests[0]!.detail).toContain("opus");
    },
    300000,
  );

  survey(
    "a second call under another name leaves the first in place",
    (lay) => {
      expect(opusCall(lay, "one", ANSWER).code).toBe(0);
      const second = "## Conclusion\nAnother answer.\n";
      expect(opusCall(lay, "two", second).code).toBe(0);
      expect(readFileSync(join(lay.dispatch, "surveys", "one.md"), "utf8")).toBe(ANSWER);
      expect(readFileSync(join(lay.dispatch, "surveys", "two.md"), "utf8")).toBe(second);
      expect(readActions(lay.dispatch).filter((a) => a.action === "harvest").length).toBe(2);
    },
    420000,
  );

  survey(
    "a name already used is refused",
    (lay) => {
      expect(opusCall(lay, "taken", ANSWER).code).toBe(0);
      const callsBefore = callLines(lay).length;
      const again = surveyor(lay, [
        "call",
        lay.dispatch,
        lay.repo,
        "--name",
        "taken",
        "--snapshot",
        lay.sha,
        "--question",
        writeQuestion(lay, "taken-q2.md"),
        "--timeout",
        "600",
      ]);
      expect(again.code).toBe(2);
      expect(both(again)).toContain("taken");
      expect(readFileSync(join(lay.dispatch, "surveys", "taken.md"), "utf8")).toBe(ANSWER);
      expect(callLines(lay).length).toBe(callsBefore);
    },
    300000,
  );

  survey(
    "a lane that exits non-zero records the reason with its own status",
    (lay) => {
      patchRunJson(lay.dispatch, { config: { team: { surveyor: "opus" } } });
      setStub(lay, "claude", { events: [], exit: 3 });
      const r = surveyor(lay, [
        "call",
        lay.dispatch,
        lay.repo,
        "--name",
        "crashed",
        "--snapshot",
        lay.sha,
        "--question",
        writeQuestion(lay),
        "--timeout",
        "600",
      ]);
      expect(r.code).toBe(3);
      expect(readFileSync(join(lay.dispatch, "surveys", "crashed.md"), "utf8")).toContain("3");
      const degrades = readActions(lay.dispatch).filter((a) => a.action === "degrade");
      expect(degrades.length).toBe(1);
      expect(degrades[0]!.target).toBe("opus");
      expect(degrades[0]!.detail).toContain("crashed");
      expect(degrades[0]!.detail).toContain("3");
      expect(readActions(lay.dispatch).some((a) => a.action === "harvest")).toBe(false);
    },
    300000,
  );

  survey(
    "a lane still running at the deadline is stopped and recorded",
    (lay) => {
      patchRunJson(lay.dispatch, { config: { team: { surveyor: "opus" } } });
      setStub(lay, "claude", { events: [claudeInit("t-slow")], exit: 0, setup: "sleep 60" });
      const r = surveyor(lay, [
        "call",
        lay.dispatch,
        lay.repo,
        "--name",
        "slow",
        "--snapshot",
        lay.sha,
        "--question",
        writeQuestion(lay),
        "--timeout",
        "25",
      ]);
      expect(r.code).toBe(3);
      expect(readFileSync(join(lay.dispatch, "surveys", "slow.md"), "utf8")).toContain("25");
      const degrades = readActions(lay.dispatch).filter((a) => a.action === "degrade");
      expect(degrades.length).toBe(1);
      expect(degrades[0]!.detail).toContain("slow");
      const scratch = join(lay.repo, ".worktrees", "T-survey-slow");
      const stop = sh(RUN, ["host", "stop", scratch], lay.env, lay.tmp);
      expect(stop.code).toBe(0);
      expect(stop.out).toContain("no launch is running");
    },
    420000,
  );

  survey(
    "a provider wall records the wall as the reason",
    (lay) => {
      patchRunJson(lay.dispatch, { config: { team: { surveyor: "opus" } } });
      setStub(lay, "claude", { events: [claudeInit("t-wall"), claudeWall()], exit: 1 });
      const r = surveyor(lay, [
        "call",
        lay.dispatch,
        lay.repo,
        "--name",
        "walled",
        "--snapshot",
        lay.sha,
        "--question",
        writeQuestion(lay),
        "--timeout",
        "600",
      ]);
      expect(r.code).toBe(3);
      const kept = readFileSync(join(lay.dispatch, "surveys", "walled.md"), "utf8");
      expect(kept).toContain("wall");
      expect(kept).toContain(CLAUDE_WALL_MESSAGE);
      const degrades = readActions(lay.dispatch).filter((a) => a.action === "degrade");
      expect(degrades.length).toBe(1);
      expect(degrades[0]!.detail).toContain("wall");
      expect(readActions(lay.dispatch).some((a) => a.action === "wall")).toBe(true);
      // The survey failed closed with its own degrade line: no ruling is
      // asked, so the wall waits on nothing.
      const open = sh(RUN, ["walls", "open", lay.dispatch], lay.env, lay.tmp);
      expect(open.code).toBe(0);
    },
    300000,
  );

  survey("a harness with no recorded final-message shape is refused", (lay) => {
    patchRunJson(lay.dispatch, {
      config: {
        team: { surveyor: "grokker" },
        lanes: { grokker: { harness: "grok", model: "grok-model" } },
      },
    });
    const r = surveyor(lay, [
      "call",
      lay.dispatch,
      lay.repo,
      "--name",
      "shapeless",
      "--snapshot",
      lay.sha,
      "--question",
      writeQuestion(lay),
      "--timeout",
      "600",
    ]);
    expect(r.code).toBe(2);
    expect(both(r)).toContain("grok");
    expect(callLines(lay).length).toBe(0);
  });

  test("usage: no subcommand exits 1", () => {
    const r = sh(RUN, ["surveyor"], process.env as Record<string, string>);
    expect(r.code).toBe(1);
  });
});
