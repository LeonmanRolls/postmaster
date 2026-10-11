// Oracle for #409, committed before the change: the technical notes stay away
// from the coachman and the workhorses, and the run's log says whether they
// did. C1 pins the notice sentence in the three runbook spots that write a
// brief; C2 pins the no-quote rule where the postmaster writes a leg prompt
// and delivers a ruling; C3 pins the check on fixture dispatches, once for
// each form it names; C4 pins the recording and the closing step; C5 needs a
// model run and stays hand-verified by the postmaster at landing. Every case
// drives scripts/run as a subprocess or reads a runbook file.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  NOTICE,
  NO_QUOTE,
  claudeResult,
  claudeUse,
  codexExec,
  fixtureDispatch,
  museExec,
  museRead,
  outcomeOf,
  readRunbook,
  removeDir,
  scratchDir,
  ticketReads,
} from "./acceptance-409.ts";

let tmp = "";

beforeAll(() => {
  tmp = scratchDir("acceptance-409-");
});

afterAll(() => {
  removeDir(tmp);
});

/** The text around an anchor: 500 chars before it, 2000 after, the step it starts. */
function near(text: string, anchor: string): string {
  const at = text.indexOf(anchor);
  expect(at).toBeGreaterThanOrEqual(0);
  return text.slice(Math.max(0, at - 500), at + 2000);
}

function repoOf(dispatch: string): string {
  const brief = readFileSync(join(dispatch, "brief.md"), "utf8");
  const line = brief.split("\n").find((l) => l.startsWith("repo:")) ?? "";
  return line.slice("repo:".length).split("default branch:")[0]!.trim();
}

function storeOf(dispatch: string): string {
  return join(repoOf(dispatch), ".git", "postmaster", "tickets");
}

describe("C1: the held-back notice", () => {
  test("the waybill template carries the notice for a held-back run", () => {
    const skill = readRunbook("skills/postmaster/SKILL.md");
    expect(skill).toContain(NOTICE);
    const template = near(skill, "## The waybill");
    expect(template).toContain(NOTICE);
    expect(template).toContain("held back");
  });

  test("the workhorse-brief step carries the notice for a held-back run", () => {
    const coachman = readRunbook("skills/postmaster/coachman.md");
    expect(coachman).toContain(NOTICE);
    const step = near(coachman, "write each workhorse's brief");
    expect(step).toContain(NOTICE);
    expect(step).toContain("ticket-notes");
  });

  test("the leg-prompt step carries the notice for a held-back run", () => {
    const postmaster = readRunbook("skills/postmaster/postmaster.md");
    expect(postmaster).toContain(NOTICE);
    const step = near(postmaster, "Write the leg prompt");
    expect(step).toContain(NOTICE);
  });

  test.skipIf(true)("C5's briefs carry the notice and a given run's do not", () => {
    // Needs a dispatched held-back run: the waybill, the leg prompts and each
    // workhorse's brief. The postmaster reads C5's run at landing.
  });
});

describe("C2: nothing sent quotes the notes", () => {
  test("the leg-prompt step says nothing sent quotes the notes", () => {
    const postmaster = readRunbook("skills/postmaster/postmaster.md");
    expect(postmaster).toContain(NO_QUOTE);
    expect(near(postmaster, "Write the leg prompt")).toContain(NO_QUOTE);
  });

  test("the ruling step says nothing sent quotes the notes", () => {
    const postmaster = readRunbook("skills/postmaster/postmaster.md");
    expect(near(postmaster, "Deliver the ruling")).toContain(NO_QUOTE);
  });

  test.skipIf(true)("C5's prompt and ruling files hold no section line", () => {
    // Needs a dispatched held-back run: every leg prompt and resume file in
    // the dispatch folder holds no line of the cut sections. The postmaster
    // reads C5's run at landing.
  });
});

describe("C3: the check on a clean run", () => {
  function cleanDispatch(name: string): string {
    return fixtureDispatch(tmp, name, {
      legs: [
        {
          n: 1,
          harness: "muse",
          lines: [museExec("git status --porcelain"), museRead("/repo/brief.md")],
        },
      ],
      agents: [
        {
          lane: "luna",
          harness: "codex",
          lines: [
            codexExec("git status --porcelain"),
            codexExec("bun test scripts/store.test.ts"),
            codexExec("gh issue view 101 --repo example/shop --json title,body"),
            codexExec("gh pr view 409"),
            codexExec("cat /tmp/notes.txt", "try gh issue view 409 --json body"),
          ],
        },
        {
          lane: "opus",
          harness: "claude",
          lines: [
            claudeUse("Bash", { command: "git diff --stat" }),
            claudeUse("Read", { file_path: "/repo/src/a.ts" }),
          ],
        },
      ],
    });
  }

  test("a run with ordinary work, other tickets and prose mentions reads not read", () => {
    const dispatch = cleanDispatch("c3-clean");
    const r = ticketReads(dispatch);
    expect(r.code).toBe(0);
    expect(outcomeOf(r.out)).toBe("ticket-reads: not read");
  });

  test("a failed read is not a read", () => {
    const dispatch = fixtureDispatch(tmp, "c3-failed", {
      agents: [
        {
          lane: "luna",
          harness: "codex",
          lines: [codexExec("gh issue view 409", "gh: Not Found", 1)],
        },
      ],
    });
    const r = ticketReads(dispatch);
    expect(r.code).toBe(0);
    expect(outcomeOf(r.out)).toBe("ticket-reads: not read");
  });

  test("a stale adapter path that fails is not a read", () => {
    const dispatch = fixtureDispatch(tmp, "c3-stale", {
      agents: [
        {
          lane: "luna",
          harness: "codex",
          lines: [codexExec("scripts/github.sh /repo read 409", "no such file", 127)],
        },
      ],
    });
    const r = ticketReads(dispatch);
    expect(r.code).toBe(0);
    expect(outcomeOf(r.out)).toBe("ticket-reads: not read");
  });
});

describe("C3: every named form reads", () => {
  function planted(
    name: string,
    lane: string,
    harness: "codex" | "claude" | "muse",
    lines: string[],
    agent = lane,
  ): { agent: string; out: string; code: number } {
    const dispatch = fixtureDispatch(tmp, name, {
      agents: [{ lane, harness, lines }],
    });
    const r = ticketReads(dispatch);
    return { agent, out: r.out, code: r.code };
  }

  test("gh issue view reads, naming the lane and the form", () => {
    const r = planted("c3-view", "luna", "codex", [codexExec("gh issue view 409")]);
    expect(r.code).toBe(0);
    expect(outcomeOf(r.out)).toBe("ticket-reads: read by luna (gh issue view)");
  });

  test("gh issue view with a body field reads", () => {
    const r = planted("c3-viewbody", "opus", "claude", [
      claudeUse("Bash", { command: "gh issue view 409 --json title,body" }),
    ]);
    expect(r.code).toBe(0);
    expect(outcomeOf(r.out)).toBe("ticket-reads: read by opus (gh issue view)");
  });

  test("gh issue view of the issue address reads", () => {
    const r = planted("c3-viewurl", "luna", "codex", [
      codexExec("gh issue view https://github.com/example/shop/issues/409"),
    ]);
    expect(r.code).toBe(0);
    expect(outcomeOf(r.out)).toBe("ticket-reads: read by luna (gh issue view)");
  });

  test("gh api on the issue and its comments reads", () => {
    for (const [name, command] of [
      ["c3-api", "gh api repos/example/shop/issues/409"],
      ["c3-apicomments", "gh api repos/example/shop/issues/409/comments"],
    ] as Array<[string, string]>) {
      const r = planted(name, "luna", "codex", [codexExec(command)]);
      expect(r.code).toBe(0);
      expect(outcomeOf(r.out)).toBe("ticket-reads: read by luna (gh api)");
    }
  });

  test("gh api graphql naming the issue reads", () => {
    const r = planted("c3-graphql", "luna", "codex", [
      codexExec(
        'gh api graphql -f query=\'query { repository(owner: "example", name: "shop") { issue(number: 409) { bodyText } } }\'',
      ),
    ]);
    expect(r.code).toBe(0);
    expect(outcomeOf(r.out)).toBe("ticket-reads: read by luna (gh api graphql)");
  });

  test("run github read reads", () => {
    const dispatch = fixtureDispatch(tmp, "c3-ghread", {
      agents: [{ lane: "luna", harness: "codex", lines: [] }],
    });
    const repo = repoOf(dispatch);
    const stream = join(dispatch, "logs", "luna-events.jsonl");
    const before = readFileSync(stream, "utf8");
    const line = codexExec(`scripts/run github ${repo} read 409`);
    writeFileSyncFix(stream, before, line);
    const r = ticketReads(dispatch);
    expect(r.code).toBe(0);
    expect(outcomeOf(r.out)).toBe("ticket-reads: read by luna (run github read)");
  });

  test("a fetch of the issue address reads, by shell and by fetch tool", () => {
    const shell = planted("c3-curl", "luna", "codex", [
      codexExec("curl -s https://github.com/example/shop/issues/409"),
    ]);
    expect(shell.code).toBe(0);
    expect(outcomeOf(shell.out)).toBe("ticket-reads: read by luna (issue fetch)");
    const tool = planted("c3-webfetch", "opus", "claude", [
      claudeUse("WebFetch", {
        url: "https://github.com/example/shop/issues/409",
        prompt: "read it",
      }),
    ]);
    expect(tool.code).toBe(0);
    expect(outcomeOf(tool.out)).toBe("ticket-reads: read by opus (issue fetch)");
  });

  test("run local read reads on a local run", () => {
    const dispatch = fixtureDispatch(tmp, "c3-localread", {
      tracker: "local",
      ticket: 1,
      agents: [{ lane: "luna", harness: "codex", lines: [] }],
    });
    const repo = repoOf(dispatch);
    const stream = join(dispatch, "logs", "luna-events.jsonl");
    const before = readFileSync(stream, "utf8");
    const line = codexExec(`scripts/run local ${repo} read 1`);
    writeFileSyncFix(stream, before, line);
    const r = ticketReads(dispatch);
    expect(r.code).toBe(0);
    expect(outcomeOf(r.out)).toBe("ticket-reads: read by luna (run local read)");
  });

  test("a read of the ticket file reads, by shell and by read tool", () => {
    const dispatch = fixtureDispatch(tmp, "c3-ticketfile", {
      tracker: "local",
      ticket: 1,
      agents: [
        { lane: "luna", harness: "codex", lines: [] },
        { lane: "opus", harness: "claude", lines: [] },
      ],
    });
    const file = join(storeOf(dispatch), "1.md");
    appendLine(dispatch, "luna-events.jsonl", codexExec(`cat ${file}`));
    appendLine(dispatch, "opus-events.jsonl", claudeUse("Read", { file_path: file }));
    const r = ticketReads(dispatch);
    expect(r.code).toBe(0);
    expect(outcomeOf(r.out)).toContain("read by luna (ticket file)");
    expect(outcomeOf(r.out)).toContain("opus (ticket file)");
  });

  test("a read of the clerk draft reads", () => {
    const dispatch = fixtureDispatch(tmp, "c3-clerk", {
      legs: [{ n: 1, harness: "muse", lines: [] }],
    });
    const draft = join(repoOf(dispatch), ".postmaster", "clerk", "409.md");
    appendLine(dispatch, "coachman-leg-1-events.jsonl", museRead(draft));
    const r = ticketReads(dispatch);
    expect(r.code).toBe(0);
    expect(outcomeOf(r.out)).toBe("ticket-reads: read by coachman leg 1 (clerk draft)");
  });

  test("a reviewer's read names the round, lens and lane", () => {
    const dispatch = fixtureDispatch(tmp, "c3-review", {
      agents: [
        {
          lane: "opus",
          harness: "claude",
          file: "review-r1-bug-opus.jsonl",
          reviews: ["r1 bug"],
          lines: [claudeUse("Bash", { command: "gh issue view 409" })],
        },
      ],
    });
    const r = ticketReads(dispatch);
    expect(r.code).toBe(0);
    expect(outcomeOf(r.out)).toBe("ticket-reads: read by review r1 bug opus (gh issue view)");
  });
});

describe("C3: title and state alone are named, not read", () => {
  test("gh issue view of title or state alone is not a read of the text", () => {
    for (const [name, command] of [
      ["c3-title", "gh issue view 409 --json title"],
      ["c3-titlejq", "gh issue view 409 --json title --jq .title"],
      ["c3-state", "gh issue view 409 --json state"],
    ] as Array<[string, string]>) {
      const dispatch = fixtureDispatch(tmp, name, {
        agents: [{ lane: "luna", harness: "codex", lines: [codexExec(command)] }],
      });
      const r = ticketReads(dispatch);
      expect(r.code).toBe(0);
      expect(outcomeOf(r.out)).toContain("ticket-reads: not read");
      expect(outcomeOf(r.out)).toContain("title read by luna");
    }
  });

  test("an adapter state change names the state read", () => {
    const dispatch = fixtureDispatch(tmp, "c3-adapterstate", {
      agents: [{ lane: "luna", harness: "codex", lines: [] }],
    });
    const repo = repoOf(dispatch);
    appendLine(
      dispatch,
      "luna-events.jsonl",
      codexExec(`scripts/run github ${repo} state 409 done`),
    );
    const r = ticketReads(dispatch);
    expect(r.code).toBe(0);
    expect(outcomeOf(r.out)).toContain("ticket-reads: not read");
    expect(outcomeOf(r.out)).toContain("title read by luna");
  });

  test("a read of the ticket meta names it, not the text", () => {
    const dispatch = fixtureDispatch(tmp, "c3-meta", {
      tracker: "local",
      ticket: 1,
      agents: [{ lane: "opus", harness: "claude", lines: [] }],
    });
    const meta = join(storeOf(dispatch), "1.json");
    appendLine(dispatch, "opus-events.jsonl", claudeUse("Read", { file_path: meta }));
    const r = ticketReads(dispatch);
    expect(r.code).toBe(0);
    expect(outcomeOf(r.out)).toContain("ticket-reads: not read");
    expect(outcomeOf(r.out)).toContain("title read by opus");
  });
});

describe("C3: what the check cannot tell is unknown", () => {
  test("a missing agent record is unknown, naming the record", () => {
    const dispatch = fixtureDispatch(tmp, "c3-missing", {
      agents: [{ lane: "luna", harness: "codex", lines: [codexExec("true")] }],
    });
    rmSync(join(dispatch, "logs", "luna-events.jsonl"));
    const r = ticketReads(dispatch);
    expect(r.code).toBe(0);
    expect(outcomeOf(r.out)).toContain("ticket-reads: unknown");
    expect(outcomeOf(r.out)).toContain("luna");
  });

  test("an unreadable agent record is unknown", () => {
    const dispatch = fixtureDispatch(tmp, "c3-badjson", {
      agents: [{ lane: "luna", harness: "codex", lines: [codexExec("true")] }],
    });
    appendLine(dispatch, "luna-events.jsonl", "{not json");
    const r = ticketReads(dispatch);
    expect(r.code).toBe(0);
    expect(outcomeOf(r.out)).toContain("ticket-reads: unknown");
  });

  test("a harness with no reader is unknown", () => {
    const dispatch = fixtureDispatch(tmp, "c3-noharness", {
      agents: [{ lane: "grove", harness: "grok", lines: [codexExec("true")] }],
    });
    const r = ticketReads(dispatch);
    expect(r.code).toBe(0);
    expect(outcomeOf(r.out)).toContain("ticket-reads: unknown");
    expect(outcomeOf(r.out)).toContain("grove");
  });

  test("a tracker of kind other is unknown", () => {
    const dispatch = fixtureDispatch(tmp, "c3-other", {
      tracker: "other",
      agents: [{ lane: "luna", harness: "codex", lines: [codexExec("true")] }],
    });
    const r = ticketReads(dispatch);
    expect(r.code).toBe(0);
    expect(outcomeOf(r.out)).toContain("ticket-reads: unknown");
  });

  test("a ticket named in a form the check does not know is unknown", () => {
    for (const [name, command] of [
      ["c3-edit", "gh issue edit 409 --body x"],
      ["c3-subissues", "gh api repos/example/shop/issues/409/sub_issues"],
      ["c3-search", "gh search issues 409"],
      ["c3-jsonfield", "gh issue view 409 --json title,reactions"],
    ] as Array<[string, string]>) {
      const dispatch = fixtureDispatch(tmp, name, {
        agents: [{ lane: "luna", harness: "codex", lines: [codexExec(command)] }],
      });
      const r = ticketReads(dispatch);
      expect(r.code).toBe(0);
      expect(outcomeOf(r.out)).toContain("ticket-reads: unknown");
      expect(outcomeOf(r.out)).toContain("luna");
    }
  });

  test("an adapter search naming the ticket is unknown", () => {
    const dispatch = fixtureDispatch(tmp, "c3-searchverb", {
      agents: [{ lane: "luna", harness: "codex", lines: [] }],
    });
    const repo = repoOf(dispatch);
    appendLine(dispatch, "luna-events.jsonl", codexExec(`scripts/run github ${repo} search 409`));
    const r = ticketReads(dispatch);
    expect(r.code).toBe(0);
    expect(outcomeOf(r.out)).toContain("ticket-reads: unknown");
  });

  test("an adapter verb the adapters do not have is unknown", () => {
    const dispatch = fixtureDispatch(tmp, "c3-strangeverb", {
      agents: [{ lane: "opus", harness: "claude", lines: [] }],
    });
    const repo = repoOf(dispatch);
    appendLine(
      dispatch,
      "opus-events.jsonl",
      claudeUse("Bash", { command: `scripts/run github ${repo} frobnicate 409` }),
    );
    const r = ticketReads(dispatch);
    expect(r.code).toBe(0);
    expect(outcomeOf(r.out)).toContain("ticket-reads: unknown");
  });

  test("a search across the ticket store is unknown", () => {
    const dispatch = fixtureDispatch(tmp, "c3-grepstore", {
      tracker: "local",
      ticket: 1,
      agents: [{ lane: "luna", harness: "codex", lines: [] }],
    });
    appendLine(dispatch, "luna-events.jsonl", codexExec(`grep -ri notes ${storeOf(dispatch)}`));
    const r = ticketReads(dispatch);
    expect(r.code).toBe(0);
    expect(outcomeOf(r.out)).toContain("ticket-reads: unknown");
  });

  test("a read stands with an unknown caveat", () => {
    const dispatch = fixtureDispatch(tmp, "c3-both", {
      agents: [
        {
          lane: "luna",
          harness: "codex",
          lines: [codexExec("gh issue view 409")],
        },
        { lane: "opus", harness: "claude", lines: [claudeUse("Bash", { command: "true" })] },
      ],
    });
    rmSync(join(dispatch, "logs", "opus-events.jsonl"));
    const r = ticketReads(dispatch);
    expect(r.code).toBe(0);
    expect(outcomeOf(r.out)).toContain("read by luna (gh issue view)");
    expect(outcomeOf(r.out)).toContain("unknown");
    expect(outcomeOf(r.out)).toContain("opus");
  });
});

describe("C3: the check's edges", () => {
  test("another ticket or another repo is not this ticket", () => {
    const dispatch = fixtureDispatch(tmp, "c3-others", {
      agents: [
        {
          lane: "luna",
          harness: "codex",
          lines: [
            codexExec("gh issue view 101 --json title,body"),
            codexExec("gh issue view 409 --repo other/place"),
            codexExec("gh api repos/other/place/issues/409"),
            codexExec("gh issue view 410"),
          ],
        },
      ],
    });
    const r = ticketReads(dispatch);
    expect(r.code).toBe(0);
    expect(outcomeOf(r.out)).toBe("ticket-reads: not read");
  });

  test("known writes show no ticket text and count for nothing", () => {
    const dispatch = fixtureDispatch(tmp, "c3-writes", {
      agents: [{ lane: "luna", harness: "codex", lines: [] }],
    });
    const repo = repoOf(dispatch);
    appendLine(
      dispatch,
      "luna-events.jsonl",
      codexExec(`scripts/run github ${repo} comment 409 coachman "hi"`),
    );
    appendLine(dispatch, "luna-events.jsonl", codexExec("gh issue close 409"));
    appendLine(
      dispatch,
      "luna-events.jsonl",
      codexExec(`scripts/run github ${repo} edit 409 body.md base.md`),
    );
    const r = ticketReads(dispatch);
    expect(r.code).toBe(0);
    expect(outcomeOf(r.out)).toBe("ticket-reads: not read");
  });

  test("a relaunched review parses its round", () => {
    const dispatch = fixtureDispatch(tmp, "c3-relaunch", {
      agents: [
        {
          lane: "opus",
          harness: "claude",
          file: "review-r1-bug-opus.jsonl",
          reviews: ["r1 bug"],
          lines: [claudeUse("Bash", { command: "gh issue view 409" })],
        },
      ],
    });
    const actions = join(dispatch, "actions.jsonl");
    const relaunched = readFileSync(actions, "utf8").replace(
      "bug round 1",
      "bug round 1, relaunched after reset",
    );
    writeFileSync(actions, relaunched, "utf8");
    const r = ticketReads(dispatch);
    expect(r.code).toBe(0);
    expect(outcomeOf(r.out)).toBe("ticket-reads: read by review r1 bug opus (gh issue view)");
  });

  test("a read through the wrong tracker is not this ticket", () => {
    const local = fixtureDispatch(tmp, "c3-wrongtracker", {
      tracker: "local",
      ticket: 1,
      agents: [{ lane: "luna", harness: "codex", lines: [codexExec("gh issue view 1")] }],
    });
    const r = ticketReads(local);
    expect(r.code).toBe(0);
    expect(outcomeOf(r.out)).toBe("ticket-reads: not read");
  });

  test("a given run is not checked and records nothing", () => {
    const dispatch = fixtureDispatch(tmp, "c3-given", {
      notes: "given",
      agents: [
        {
          lane: "luna",
          harness: "codex",
          lines: [codexExec("gh issue view 409")],
        },
      ],
    });
    const r = ticketReads(dispatch, "--record");
    expect(r.code).toBe(0);
    expect(r.out).toContain("not checked");
    expect(readFileSync(join(dispatch, "run-log.md"), "utf8")).not.toContain("ticket-reads:");
    expect(readFileSync(join(dispatch, "actions.jsonl"), "utf8")).not.toContain("ticket-reads");
  });

  test("usage faults exit 1", () => {
    const noArgs = ticketReads("");
    expect(noArgs.code).toBe(1);
    const missing = ticketReads(join(tmp, "c3-no-such-dispatch"));
    expect(missing.code).toBe(1);
  });

  test.skipIf(true)("copies of C5's run folder read as the ticket says", () => {
    // Needs C5's dispatched run: the folder as it is reads not read, a read
    // planted in one agent's stream reads naming the agent and the form, and a
    // title read alone reads not read with the title named. The postmaster
    // runs the check on copies at landing.
  });
});

describe("C3: review round 1 fixes", () => {
  test("a read on a later line of a multi-line command reads", () => {
    const dispatch = fixtureDispatch(tmp, "c3-multiline", {
      legs: [
        {
          n: 1,
          harness: "codex",
          lines: [codexExec("set -e\ngh issue view 409 --json body", "B", 0)],
        },
      ],
    });
    const r = ticketReads(dispatch);
    expect(r.code).toBe(0);
    expect(outcomeOf(r.out)).toBe("ticket-reads: read by coachman leg 1 (gh issue view)");
  });

  test("a read inside a quoted command substitution reads", () => {
    const dispatch = fixtureDispatch(tmp, "c3-subst", {
      legs: [
        {
          n: 1,
          harness: "codex",
          lines: [codexExec('cat "$(gh issue view 409 --json body -q .body)"', "B", 0)],
        },
      ],
    });
    const r = ticketReads(dispatch);
    expect(r.code).toBe(0);
    expect(outcomeOf(r.out)).toBe("ticket-reads: read by coachman leg 1 (gh issue view)");
  });

  test("a relative read after cd to the repo reads", () => {
    const probe = fixtureDispatch(tmp, "c3-cd-probe", { legs: [] });
    const repo = repoOf(probe);
    const dispatch = fixtureDispatch(tmp, "c3-cd", {
      repo,
      legs: [
        {
          n: 1,
          harness: "codex",
          lines: [codexExec(`cd ${repo} && cat .postmaster/clerk/409.md`, "T", 0)],
        },
      ],
    });
    const r = ticketReads(dispatch);
    expect(r.code).toBe(0);
    expect(outcomeOf(r.out)).toBe("ticket-reads: read by coachman leg 1 (clerk draft)");
  });

  test("a walled leg's renamed stream reads beside its fresh one", () => {
    const dispatch = fixtureDispatch(tmp, "c3-walled", {
      legs: [{ n: 1, harness: "codex", lines: [codexExec("echo hi", "hi", 0)] }],
    });
    const stream =
      `${JSON.stringify({ type: "thread.started", thread_id: "t" })}\n` +
      `${codexExec("gh issue view 409 --json body", "B", 0)}\n`;
    writeFileSync(join(dispatch, "logs", "coachman-leg-1-walled-events.jsonl"), stream, "utf8");
    const r = ticketReads(dispatch);
    expect(r.code).toBe(0);
    expect(outcomeOf(r.out)).toBe("ticket-reads: read by coachman leg 1 walled (gh issue view)");
  });

  test("a leg on its own harness reads with it", () => {
    const dispatch = fixtureDispatch(tmp, "c3-perleg", {
      legs: [
        { n: 1, harness: "muse", lines: [] },
        {
          n: 2,
          harness: "codex",
          lines: [codexExec("gh issue view 409 --json body", "B", 0)],
        },
      ],
    });
    const runJson = JSON.parse(readFileSync(join(dispatch, "run.json"), "utf8")) as Record<
      string,
      unknown
    >;
    const team = (runJson.config as Record<string, unknown>).team as Record<string, unknown>;
    team.coachman = { harness: "muse", model: "m" };
    team.coachman_legs = { review: { harness: "codex", model: "m" } };
    writeFileSync(join(dispatch, "run.json"), JSON.stringify(runJson), "utf8");
    const r = ticketReads(dispatch);
    expect(r.code).toBe(0);
    expect(outcomeOf(r.out)).toBe("ticket-reads: read by coachman leg 2 (gh issue view)");
  });

  test("an unreadable run.json is unknown, never not checked", () => {
    const dispatch = fixtureDispatch(tmp, "c3-badrunjson", {
      legs: [{ n: 1, harness: "codex", lines: [codexExec("echo hi", "hi", 0)] }],
    });
    writeFileSync(join(dispatch, "run.json"), "{corrupt", "utf8");
    const r = ticketReads(dispatch);
    expect(r.code).toBe(0);
    expect(outcomeOf(r.out)).toBe("ticket-reads: unknown (run.json cannot be read)");
  });

  test("a mutating gh api call shows no ticket text", () => {
    const dispatch = fixtureDispatch(tmp, "c3-apipost", {
      legs: [
        {
          n: 1,
          harness: "codex",
          lines: [
            codexExec("gh api -X POST repos/example/shop/issues/409/comments -f body=hi", "", 0),
          ],
        },
      ],
    });
    const r = ticketReads(dispatch);
    expect(r.code).toBe(0);
    expect(outcomeOf(r.out)).toBe("ticket-reads: not read");
  });

  test("a graphql read matches the run's repository", () => {
    const other = 'query { repository(owner:"other",name:"box") { issue(number:409) { body } } }';
    const foreign = fixtureDispatch(tmp, "c3-gqlforeign", {
      legs: [
        {
          n: 1,
          harness: "codex",
          lines: [codexExec(`gh api graphql -f query='${other}'`, "{}", 0)],
        },
      ],
    });
    const r = ticketReads(foreign);
    expect(r.code).toBe(0);
    expect(outcomeOf(r.out)).toBe("ticket-reads: not read");
    const own = 'query { repository(owner:"example",name:"shop") { issue(number:409) { body } } }';
    const home = fixtureDispatch(tmp, "c3-gqlown", {
      legs: [
        {
          n: 1,
          harness: "codex",
          lines: [codexExec(`gh api graphql -f query='${own}'`, "{}", 0)],
        },
      ],
    });
    const r2 = ticketReads(home);
    expect(r2.code).toBe(0);
    expect(outcomeOf(r2.out)).toBe("ticket-reads: read by coachman leg 1 (gh api graphql)");
  });

  test("another local ticket's file is ignored, not unknown", () => {
    const probe = fixtureDispatch(tmp, "c3-sibling-probe", {
      ticket: 1,
      tracker: "local",
      legs: [],
    });
    const dispatch = fixtureDispatch(tmp, "c3-sibling", {
      ticket: 1,
      tracker: "local",
      repo: repoOf(probe),
      legs: [
        {
          n: 1,
          harness: "codex",
          lines: [codexExec(`cat ${storeOf(probe)}/2.md`, "T", 0)],
        },
      ],
    });
    const r = ticketReads(dispatch);
    expect(r.code).toBe(0);
    expect(outcomeOf(r.out)).toBe("ticket-reads: not read");
  });

  test("a find scan of the ticket store is unknown, never clean", () => {
    const probe = fixtureDispatch(tmp, "c3-find-probe", { tracker: "local", legs: [] });
    const dispatch = fixtureDispatch(tmp, "c3-find", {
      tracker: "local",
      repo: repoOf(probe),
      legs: [
        {
          n: 1,
          harness: "codex",
          lines: [codexExec(`find ${storeOf(probe)} -name 409.md -exec cat {} \\;`, "T", 0)],
        },
      ],
    });
    const r = ticketReads(dispatch);
    expect(r.code).toBe(0);
    expect(outcomeOf(r.out).startsWith("ticket-reads: unknown")).toBe(true);
  });

  test("an escaped substitution runs nothing", () => {
    const dispatch = fixtureDispatch(tmp, "c3-escaped", {
      legs: [
        {
          n: 1,
          harness: "codex",
          lines: [
            codexExec('echo "\\$(gh issue view 409 --json body)"', "", 0),
            codexExec("echo \\$(gh issue view 409 --json body)", "", 0),
          ],
        },
      ],
    });
    const r = ticketReads(dispatch);
    expect(r.code).toBe(0);
    expect(outcomeOf(r.out)).toBe("ticket-reads: not read");
  });

  test("a failed call counts for nothing", () => {
    const dispatch = fixtureDispatch(tmp, "c3-failedcall", {
      agents: [
        {
          lane: "w",
          harness: "claude",
          lines: [
            claudeUse("Bash", { command: "gh issue view 409 --json body" }, "toolu_9"),
            claudeResult("toolu_9", "failed", true),
          ],
        },
      ],
    });
    const r = ticketReads(dispatch);
    expect(r.code).toBe(0);
    expect(outcomeOf(r.out)).toBe("ticket-reads: not read");
  });
});

describe("C3: review round 2 fixes", () => {
  test("a quoted cd through spaces resolves", () => {
    const seed = fixtureDispatch(tmp, "c3b-cdseed", { legs: [] });
    const spaced = `${repoOf(seed)} with spaces`;
    renameSync(repoOf(seed), spaced);
    const dispatch = fixtureDispatch(tmp, "c3b-quotedcd", {
      repo: spaced,
      legs: [
        {
          n: 1,
          harness: "codex",
          lines: [codexExec(`cd "${spaced}" && cat .postmaster/clerk/409.md`, "T", 0)],
        },
      ],
    });
    const r = ticketReads(dispatch);
    expect(r.code).toBe(0);
    expect(outcomeOf(r.out)).toBe("ticket-reads: read by coachman leg 1 (clerk draft)");
  });

  test("a quoted adapter repo with spaces reads", () => {
    const seed = fixtureDispatch(tmp, "c3b-reposeed", { legs: [] });
    const spaced = `${repoOf(seed)} with spaces`;
    renameSync(repoOf(seed), spaced);
    const dispatch = fixtureDispatch(tmp, "c3b-quotedrepo", {
      repo: spaced,
      legs: [
        {
          n: 1,
          harness: "codex",
          lines: [codexExec(`scripts/run github "${spaced}" read 409`, "T", 0)],
        },
      ],
    });
    const r = ticketReads(dispatch);
    expect(r.code).toBe(0);
    expect(outcomeOf(r.out)).toBe("ticket-reads: read by coachman leg 1 (run github read)");
  });

  test("a query named for a mutation reads, a mutation does not", () => {
    const named =
      'query mutationReport { repository(owner:"example",name:"shop") { issue(number:409) { body } } }';
    const reading = fixtureDispatch(tmp, "c3b-mutationname", {
      legs: [
        {
          n: 1,
          harness: "codex",
          lines: [codexExec(`gh api graphql -f query='${named}'`, "{}", 0)],
        },
      ],
    });
    const r = ticketReads(reading);
    expect(r.code).toBe(0);
    expect(outcomeOf(r.out)).toBe("ticket-reads: read by coachman leg 1 (gh api graphql)");
    const writing = 'mutation AddNote { addComment(input:{subjectId:"x"}) { clientMutationId } }';
    const muted = fixtureDispatch(tmp, "c3b-mutationop", {
      legs: [
        {
          n: 1,
          harness: "codex",
          lines: [codexExec(`gh api graphql -f query='${writing} 409'`, "{}", 0)],
        },
      ],
    });
    const r2 = ticketReads(muted);
    expect(r2.code).toBe(0);
    expect(outcomeOf(r2.out)).toBe("ticket-reads: not read");
  });

  test("a stream the inventory never names is unknown", () => {
    const dispatch = fixtureDispatch(tmp, "c3b-unlisted", {
      legs: [{ n: 1, harness: "codex", lines: [codexExec("echo hi", "hi", 0)] }],
    });
    const manifest = JSON.parse(readFileSync(join(dispatch, "manifest.json"), "utf8")) as Record<
      string,
      unknown
    >;
    (manifest.coachman as Record<string, unknown>).legs = {};
    writeFileSync(join(dispatch, "manifest.json"), JSON.stringify(manifest), "utf8");
    const r = ticketReads(dispatch);
    expect(r.code).toBe(0);
    expect(outcomeOf(r.out).startsWith("ticket-reads: unknown")).toBe(true);
    expect(outcomeOf(r.out)).toContain("unlisted coachman-leg-1-events.jsonl");
  });

  test("a fallback takeover reads with the fallback harness", () => {
    const dispatch = fixtureDispatch(tmp, "c3b-fallback", {
      legs: [
        {
          n: 1,
          harness: "codex",
          lines: [codexExec("gh issue view 409 --json body", "B", 0)],
        },
      ],
    });
    const runJson = JSON.parse(readFileSync(join(dispatch, "run.json"), "utf8")) as Record<
      string,
      unknown
    >;
    const team = (runJson.config as Record<string, unknown>).team as Record<string, unknown>;
    team.coachman = { harness: "claude", model: "m" };
    team.coachman_fallback = { harness: "codex", model: "m" };
    writeFileSync(join(dispatch, "run.json"), JSON.stringify(runJson), "utf8");
    writeFileSync(
      join(dispatch, "logs", "coachman-leg-1-attempts.jsonl"),
      `${JSON.stringify({ attempt: "0", request: "launch", role: "coachman", thread_id: "t0", outcome: "walled" })}\n` +
        `${JSON.stringify({ attempt: "1", request: "takeover", role: "coachman_fallback", thread_id: "t1", outcome: "done" })}\n`,
      "utf8",
    );
    writeFileSync(
      join(dispatch, "logs", "coachman-leg-1-walled-events.jsonl"),
      `${JSON.stringify({ type: "user", message: { content: [{ type: "text", text: "go" }] } })}\n`,
      "utf8",
    );
    const r = ticketReads(dispatch);
    expect(r.code).toBe(0);
    expect(outcomeOf(r.out)).toContain("read by coachman leg 1 (gh issue view)");
    expect(outcomeOf(r.out)).toContain("attempts span roles");
  });

  test("a quoted << is not a heredoc, and same-line text still runs", () => {
    const quoted = fixtureDispatch(tmp, "c3b-quotedheredoc", {
      legs: [
        {
          n: 1,
          harness: "codex",
          lines: [codexExec('echo "a << b" && gh issue view 409 --json body', "B", 0)],
        },
      ],
    });
    const r = ticketReads(quoted);
    expect(r.code).toBe(0);
    expect(outcomeOf(r.out)).toBe("ticket-reads: read by coachman leg 1 (gh issue view)");
    const probe = fixtureDispatch(tmp, "c3b-samelineprobe", { legs: [] });
    const same = fixtureDispatch(tmp, "c3b-sameline", {
      repo: repoOf(probe),
      legs: [
        {
          n: 1,
          harness: "codex",
          lines: [
            codexExec(`cat <<EOF > out.md; cat ${repoOf(probe)}/.postmaster/clerk/409.md`, "T", 0),
          ],
        },
      ],
    });
    const r2 = ticketReads(same);
    expect(r2.code).toBe(0);
    expect(outcomeOf(r2.out)).toBe("ticket-reads: read by coachman leg 1 (clerk draft)");
  });

  test("a body-printing listing is unknown, a title listing is clean", () => {
    const bodies = fixtureDispatch(tmp, "c3b-listbodies", {
      legs: [
        { n: 1, harness: "codex", lines: [codexExec("gh issue list --json number,body", "[]", 0)] },
      ],
    });
    const r = ticketReads(bodies);
    expect(r.code).toBe(0);
    expect(outcomeOf(r.out).startsWith("ticket-reads: unknown")).toBe(true);
    const collection = fixtureDispatch(tmp, "c3b-collection", {
      legs: [
        { n: 1, harness: "codex", lines: [codexExec("gh api repos/example/shop/issues", "[]", 0)] },
      ],
    });
    const r2 = ticketReads(collection);
    expect(r2.code).toBe(0);
    expect(outcomeOf(r2.out).startsWith("ticket-reads: unknown")).toBe(true);
    const titles = fixtureDispatch(tmp, "c3b-listtitles", {
      legs: [{ n: 1, harness: "codex", lines: [codexExec("gh issue list", "[]", 0)] }],
    });
    const r3 = ticketReads(titles);
    expect(r3.code).toBe(0);
    expect(outcomeOf(r3.out)).toBe("ticket-reads: not read");
  });

  test("command wrappers and quoted paths reveal the verb", () => {
    const timed = fixtureDispatch(tmp, "c3b-time", {
      legs: [
        {
          n: 1,
          harness: "codex",
          lines: [codexExec("time gh issue view 409 --json body", "B", 0)],
        },
      ],
    });
    const r = ticketReads(timed);
    expect(r.code).toBe(0);
    expect(outcomeOf(r.out)).toBe("ticket-reads: read by coachman leg 1 (gh issue view)");
    const limited = fixtureDispatch(tmp, "c3b-timeout", {
      legs: [
        {
          n: 1,
          harness: "codex",
          lines: [codexExec("timeout -s KILL 30 gh api repos/example/shop/issues/409", "{}", 0)],
        },
      ],
    });
    const r2 = ticketReads(limited);
    expect(r2.code).toBe(0);
    expect(outcomeOf(r2.out)).toBe("ticket-reads: read by coachman leg 1 (gh api)");
    const probe = fixtureDispatch(tmp, "c3b-exeprobe", { legs: [] });
    const quoted = fixtureDispatch(tmp, "c3b-quotedexe", {
      repo: repoOf(probe),
      legs: [
        {
          n: 1,
          harness: "codex",
          lines: [
            codexExec(`"${repoOf(probe)}/scripts/run" github ${repoOf(probe)} read 409`, "T", 0),
          ],
        },
      ],
    });
    const r3 = ticketReads(quoted);
    expect(r3.code).toBe(0);
    expect(outcomeOf(r3.out)).toBe("ticket-reads: read by coachman leg 1 (run github read)");
  });

  test("api fetches classify with their method", () => {
    const fetched = fixtureDispatch(tmp, "c3b-curlget", {
      legs: [
        {
          n: 1,
          harness: "codex",
          lines: [codexExec("curl https://api.github.com/repos/example/shop/issues/409", "{}", 0)],
        },
      ],
    });
    const r = ticketReads(fetched);
    expect(r.code).toBe(0);
    expect(outcomeOf(r.out)).toBe("ticket-reads: read by coachman leg 1 (issue fetch)");
    const posted = fixtureDispatch(tmp, "c3b-curlpost", {
      legs: [
        {
          n: 1,
          harness: "codex",
          lines: [
            codexExec(
              "curl -X POST https://api.github.com/repos/example/shop/issues/409/comments -d hi",
              "",
              0,
            ),
          ],
        },
      ],
    });
    const r2 = ticketReads(posted);
    expect(r2.code).toBe(0);
    expect(outcomeOf(r2.out)).toBe("ticket-reads: not read");
    const query =
      'query { repository(owner:"example",name:"shop") { issue(number:409) { body } } }';
    const graphed = fixtureDispatch(tmp, "c3b-curlgraphql", {
      legs: [
        {
          n: 1,
          harness: "codex",
          lines: [codexExec(`curl -d '${query}' https://api.github.com/graphql`, "{}", 0)],
        },
      ],
    });
    const r3 = ticketReads(graphed);
    expect(r3.code).toBe(0);
    expect(outcomeOf(r3.out)).toBe("ticket-reads: read by coachman leg 1 (issue fetch)");
  });

  test("a failure excuses one atomic read, not a chain or a diff", () => {
    const probe = fixtureDispatch(tmp, "c3b-diffprobe", { legs: [] });
    const diffed = fixtureDispatch(tmp, "c3b-diff", {
      repo: repoOf(probe),
      legs: [
        {
          n: 1,
          harness: "codex",
          lines: [
            codexExec(`diff ${repoOf(probe)}/.postmaster/clerk/409.md /tmp/other.md`, "< T", 1),
          ],
        },
      ],
    });
    const r = ticketReads(diffed);
    expect(r.code).toBe(0);
    expect(outcomeOf(r.out)).toBe("ticket-reads: read by coachman leg 1 (clerk draft)");
    const chained = fixtureDispatch(tmp, "c3b-chain", {
      legs: [
        {
          n: 1,
          harness: "codex",
          lines: [codexExec("gh issue view 409 --json body > /tmp/b && jq .bad /tmp/b", "", 1)],
        },
      ],
    });
    const r2 = ticketReads(chained);
    expect(r2.code).toBe(0);
    expect(outcomeOf(r2.out)).toBe("ticket-reads: read by coachman leg 1 (gh issue view)");
    const failed = fixtureDispatch(tmp, "c3b-singlefail", {
      legs: [
        { n: 1, harness: "codex", lines: [codexExec("gh issue view 409 --json body", "", 1)] },
      ],
    });
    const r3 = ticketReads(failed);
    expect(r3.code).toBe(0);
    expect(outcomeOf(r3.out)).toBe("ticket-reads: not read");
  });

  test("combined -c flags and double-quoted wrappers unwrap", () => {
    const combined = fixtureDispatch(tmp, "c3b-combined", {
      legs: [
        {
          n: 1,
          harness: "codex",
          lines: [codexExec('bash -lc "gh issue view 409 --json body"', "B", 0)],
        },
      ],
    });
    const r = ticketReads(combined);
    expect(r.code).toBe(0);
    expect(outcomeOf(r.out)).toBe("ticket-reads: read by coachman leg 1 (gh issue view)");
    const dispatch = fixtureDispatch(tmp, "c3b-doublewrap", {
      legs: [
        {
          n: 1,
          harness: "codex",
          lines: [codexExec("gh issue view 409 --json body", "B", 0, '"')],
        },
      ],
    });
    const r2 = ticketReads(dispatch);
    expect(r2.code).toBe(0);
    expect(outcomeOf(r2.out)).toBe("ticket-reads: read by coachman leg 1 (gh issue view)");
  });

  test("a substitution-joined ticket path is unknown", () => {
    const bare = fixtureDispatch(tmp, "c3b-substpath", {
      legs: [
        {
          n: 1,
          harness: "codex",
          lines: [
            codexExec("cat $(git rev-parse --show-toplevel)/.postmaster/clerk/409.md", "T", 0),
          ],
        },
      ],
    });
    const r = ticketReads(bare);
    expect(r.code).toBe(0);
    expect(outcomeOf(r.out).startsWith("ticket-reads: unknown")).toBe(true);
    const quoted = fixtureDispatch(tmp, "c3b-quotedsubstpath", {
      legs: [
        {
          n: 1,
          harness: "codex",
          lines: [
            codexExec('cat "$(git rev-parse --show-toplevel)/.postmaster/clerk/409.md"', "T", 0),
          ],
        },
      ],
    });
    const r2 = ticketReads(quoted);
    expect(r2.code).toBe(0);
    expect(outcomeOf(r2.out).startsWith("ticket-reads: unknown")).toBe(true);
  });

  test("a variable ticket number is unknown", () => {
    const viewed = fixtureDispatch(tmp, "c3b-varview", {
      legs: [{ n: 1, harness: "codex", lines: [codexExec('N=409; gh issue view "$N"', "B", 0)] }],
    });
    const r = ticketReads(viewed);
    expect(r.code).toBe(0);
    expect(outcomeOf(r.out).startsWith("ticket-reads: unknown")).toBe(true);
    const probe = fixtureDispatch(tmp, "c3b-varprobe", { legs: [] });
    const read = fixtureDispatch(tmp, "c3b-varread", {
      repo: repoOf(probe),
      legs: [
        {
          n: 1,
          harness: "codex",
          lines: [codexExec(`N=409; scripts/run github ${repoOf(probe)} read $N`, "T", 0)],
        },
      ],
    });
    const r2 = ticketReads(read);
    expect(r2.code).toBe(0);
    expect(outcomeOf(r2.out).startsWith("ticket-reads: unknown")).toBe(true);
  });
});

describe("C4: the run's log records the outcome", () => {
  test("record writes the outcome line and a note with it", () => {
    const dispatch = fixtureDispatch(tmp, "c4-clean", {
      agents: [{ lane: "luna", harness: "codex", lines: [codexExec("true")] }],
    });
    const r = ticketReads(dispatch, "--record");
    expect(r.code).toBe(0);
    const log = readFileSync(join(dispatch, "run-log.md"), "utf8");
    expect(log).toContain("ticket-reads: not read");
    const actions = readFileSync(join(dispatch, "actions.jsonl"), "utf8");
    expect(actions).toContain('"action":"note"');
    expect(actions).toContain("ticket-reads: not read");
  });

  test("record carries a read with its agent and form", () => {
    const dispatch = fixtureDispatch(tmp, "c4-read", {
      agents: [
        {
          lane: "luna",
          harness: "codex",
          lines: [codexExec("gh issue view 409")],
        },
      ],
    });
    const r = ticketReads(dispatch, "--record");
    expect(r.code).toBe(0);
    const log = readFileSync(join(dispatch, "run-log.md"), "utf8");
    expect(log).toContain("read by luna (gh issue view)");
  });

  test("record carries unknown with its missing record", () => {
    const dispatch = fixtureDispatch(tmp, "c4-missing", {
      agents: [{ lane: "luna", harness: "codex", lines: [codexExec("true")] }],
    });
    rmSync(join(dispatch, "logs", "luna-events.jsonl"));
    const r = ticketReads(dispatch, "--record");
    expect(r.code).toBe(0);
    const log = readFileSync(join(dispatch, "run-log.md"), "utf8");
    expect(log).toContain("ticket-reads: unknown");
    expect(log).toContain("luna");
  });

  test("the closing steps run the check before the closing line", () => {
    const postmaster = readRunbook("skills/postmaster/postmaster.md");
    expect(postmaster).toContain("ticket-reads <dispatch> --record");
    const step = near(postmaster, "Run the cleanup command");
    expect(step).toContain("ticket-reads");
  });

  test.skipIf(true)("C5's run log holds the check's outcome", () => {
    // Needs C5's dispatched run: run-log.md holds the outcome line and
    // actions.jsonl a note with it. The postmaster reads C5's run at landing.
  });
});

describe("C5: fixture runs", () => {
  test.skipIf(true)("without the notes scores clean and the log holds the outcome", () => {
    // Needs a model run from this branch; the postmaster dispatches and
    // scores it at landing.
  });
});

/** Append one stream line to a fixture stream. */
function appendLine(dispatch: string, file: string, line: string): void {
  const path = join(dispatch, "logs", file);
  const before = readFileSync(path, "utf8");
  writeFileSyncFix(path, before, line);
}

function writeFileSyncFix(path: string, before: string, line: string): void {
  writeFileSync(path, before.endsWith("\n") ? `${before}${line}\n` : `${before}\n${line}\n`);
}
