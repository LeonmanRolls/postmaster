// Oracle for #454, committed before the change: once set up, the user gets one
// Telegram message about what needs them or a landed run, and none for anything
// else. Every case drives scripts/run as a subprocess against a scratch run
// root, with a stand-in for Telegram's API on a loopback port. Commands that
// reach the stand-in are awaited through an async spawn, since it can only
// answer while this loop runs. C6, a fixture run from this branch scoring
// clean, needs a dispatched run and stays out.
import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, RUN } from "./acceptance-323.ts";
import {
  addWall,
  childCmdlines,
  expectCode,
  expectNoSecrets,
  hasProc,
  look,
  makeDispatchRun,
  makeNotifySandbox,
  makeRun,
  makeTicket,
  notifyClerk,
  notifyTest,
  PLAIN_TITLE,
  procEnviron,
  removeSandbox,
  sendBodies,
  shipRun,
  sweepSandbox,
  tellWalls,
  TRICKY_TITLE,
  withRunningWatcher,
  type NotifySandbox,
} from "./acceptance-454.ts";
import { run } from "./lib/proc.ts";

function failedLedgerLines(sb: NotifySandbox): string[] {
  const ledger = join(sb.runs, "ledger.jsonl");
  if (!existsSync(ledger)) return [];
  return readFileSync(ledger, "utf8")
    .split("\n")
    .filter((l) => l.includes('"action":"notify"') && l.includes("failed"));
}

describe("C1: one message per thing that came up", () => {
  test("a waiting run sends one message, once per appearance", async () => {
    const sb = makeNotifySandbox();
    try {
      makeRun(sb, "1", { waiting: "QUESTION-SEALED-1" });
      const r1 = await look(sb);
      expectCode(r1, 3);
      const bodies = sendBodies(sb);
      expect(bodies.length).toBe(1);
      expect(bodies[0]!.text).toContain("acme");
      expect(bodies[0]!.text).toContain("#1");
      expect(bodies[0]!.text).toContain(PLAIN_TITLE);
      expect(bodies[0]!.text).toContain("a question waits for you");
      expect(bodies[0]!.text).toContain("Answer in the postmaster session");
      expect(bodies[0]!.text.split("\n").length).toBe(1);
      expect(bodies[0]!.chat_id).toBe(sb.chat);
      const r2 = await look(sb);
      expectCode(r2, 3);
      expect(sendBodies(sb).length).toBe(1);
      rmSync(join(sb.runs, "1", ".waiting-on-user"));
      writeFileSync(join(sb.runs, "1", ".waiting-on-user"), "QUESTION-SEALED-2");
      const r3 = await look(sb);
      expectCode(r3, 3);
      expect(sendBodies(sb).length).toBe(2);
      expect(readFileSync(join(sb.runs, "ledger.jsonl"), "utf8")).toContain('"action":"notify"');
    } finally {
      removeSandbox(sb);
    }
  });

  test("a wall is messaged before the wake; the later marker append sends nothing", async () => {
    const sb = makeNotifySandbox();
    try {
      const d = makeRun(sb, "1");
      addWall(sb, d, "luna", "2026-06-15T12:00:00+00:00", "PROVIDER-UTTERANCE-1");
      const r1 = await look(sb);
      expectCode(r1, 0);
      expect(r1.out).toContain("needs 1 WALL");
      const bodies = sendBodies(sb);
      expect(bodies.length).toBe(1);
      expect(bodies[0]!.text).toContain("lane luna hit its provider's usage limit");
      expect(bodies[0]!.text).toContain("2026-06-15");
      expect(bodies[0]!.text).not.toContain("PROVIDER-UTTERANCE-1");
      writeFileSync(join(d, ".waiting-on-user"), "the wall's question");
      const r2 = await look(sb);
      expectCode(r2, 3);
      expect(r2.out).toContain("USER");
      expect(sendBodies(sb).length).toBe(1);
    } finally {
      removeSandbox(sb);
    }
  });

  test("a waiting run beside its ship card names the card", async () => {
    const sb = makeNotifySandbox();
    try {
      makeRun(sb, "1", { waiting: "QUESTION-SEALED-1", card: true });
      const r = await look(sb);
      expectCode(r, 0);
      expect(r.out).toContain("needs 1 GATE");
      const bodies = sendBodies(sb);
      expect(bodies.length).toBe(1);
      expect(bodies[0]!.text).toContain("the ship card awaits your word");
      expect(bodies[0]!.text).toContain("Answer in the postmaster session");
    } finally {
      removeSandbox(sb);
    }
  });

  test("one look sends one request with a line per event", async () => {
    const sb = makeNotifySandbox();
    try {
      makeTicket(sb, "third title");
      const w = makeRun(sb, "1");
      addWall(sb, w, "luna", "2026-06-15T12:00:00+00:00", "PROVIDER-UTTERANCE-1");
      addWall(sb, w, "haiku", "none", "PROVIDER-UTTERANCE-2");
      makeRun(sb, "2", { waiting: "QUESTION-SEALED-2" });
      const landed = makeRun(sb, "3", { stage: "shipping" });
      shipRun(sb, landed);
      const r = await look(sb);
      expectCode(r, 0);
      const bodies = sendBodies(sb);
      expect(bodies.length).toBe(1);
      const lines = bodies[0]!.text.split("\n");
      expect(lines.length).toBe(4);
      expect(bodies[0]!.text).toContain("lane luna hit its provider's usage limit");
      expect(bodies[0]!.text).toContain("lane haiku hit its provider's usage limit");
      expect(bodies[0]!.text).toContain("a question waits for you");
      expect(bodies[0]!.text).toContain("the run landed");
    } finally {
      removeSandbox(sb);
    }
  });

  test("the clerk command sends one message naming the clerk session", async () => {
    const sb = makeNotifySandbox();
    try {
      const r = await notifyClerk(sb, "1");
      expectCode(r, 0);
      const bodies = sendBodies(sb);
      expect(bodies.length).toBe(1);
      expect(bodies[0]!.text).toContain("#1");
      expect(bodies[0]!.text).toContain(PLAIN_TITLE);
      expect(bodies[0]!.text).toContain("the clerk's draft is ready");
      expect(bodies[0]!.text).toContain("Answer in the clerk session");
      expect(bodies[0]!.text).not.toContain("postmaster session");
    } finally {
      removeSandbox(sb);
    }
  });

  test("the clerk command is silent when messages are off", async () => {
    const sb = makeNotifySandbox({ messages: false });
    try {
      const r = await notifyClerk(sb, "1");
      expectCode(r, 0);
      expect(sendBodies(sb).length).toBe(0);
    } finally {
      removeSandbox(sb);
    }
  });

  test("without a notify table the watcher acts as at the base", async () => {
    const sb = makeNotifySandbox({ messages: false });
    try {
      makeRun(sb, "1", { waiting: "QUESTION-SEALED-1" });
      const w = makeRun(sb, "2");
      addWall(sb, w, "luna", "none", "PROVIDER-UTTERANCE-1");
      const r = await look(sb);
      expectCode(r, 0);
      expect(r.out).toContain("needs 2 WALL");
      expect(sendBodies(sb).length).toBe(0);
      expect(r.err.toLowerCase()).not.toContain("notify");
      rmSync(join(sb.runs, "2"), { recursive: true, force: true });
      const r2 = await look(sb);
      expectCode(r2, 3);
      expect(r2.out).toContain("USER");
      expect(sendBodies(sb).length).toBe(0);
      expect(r2.err.toLowerCase()).not.toContain("notify");
      const actions = join(sb.runs, "1", "actions.jsonl");
      if (existsSync(actions)) {
        expect(readFileSync(actions, "utf8")).not.toContain('"action":"notify"');
      }
      expect(existsSync(join(sb.runs, "postmaster", ".notify-failed"))).toBe(false);
    } finally {
      removeSandbox(sb);
    }
  });

  test("a landed run sends once and names no place to answer", async () => {
    const sb = makeNotifySandbox();
    try {
      const d = makeRun(sb, "1", { stage: "shipping" });
      shipRun(sb, d);
      const r = await look(sb);
      expectCode(r, 3);
      const bodies = sendBodies(sb);
      expect(bodies.length).toBe(1);
      expect(bodies[0]!.text).toContain("the run landed");
      expect(bodies[0]!.text).not.toContain("Answer in");
      const r2 = await look(sb);
      expectCode(r2, 3);
      expect(sendBodies(sb).length).toBe(1);
    } finally {
      removeSandbox(sb);
    }
  });

  test("the first look with messages on sends no backlog", async () => {
    const sb = makeNotifySandbox();
    try {
      const landed = makeRun(sb, "1", { stage: "shipping" });
      shipRun(sb, landed);
      const walled = makeRun(sb, "2");
      addWall(sb, walled, "luna", "none", "PROVIDER-UTTERANCE-1");
      tellWalls(sb, walled, "luna");
      makeTicket(sb, "third title");
      makeRun(sb, "3", { waiting: "QUESTION-SEALED-3" });
      const r = await look(sb);
      expectCode(r, 3);
      const bodies = sendBodies(sb);
      expect(bodies.length).toBe(1);
      expect(bodies[0]!.text.split("\n").length).toBe(1);
      expect(bodies[0]!.text).toContain("#3");
      expect(bodies[0]!.text).not.toContain("#1");
      expect(bodies[0]!.text).not.toContain("#2");
    } finally {
      removeSandbox(sb);
    }
  });
});

describe("C2: a message holds only what came up", () => {
  test("fixed words, the ticket's own title verbatim, and no record text", async () => {
    const sb = makeNotifySandbox();
    try {
      makeRun(sb, "2", { waiting: "QUESTION-SEALED-2" });
      const w = makeRun(sb, "1");
      addWall(sb, w, "luna", "none", "PROVIDER-UTTERANCE-1");
      const r = await look(sb);
      expectCode(r, 0);
      const bodies = sendBodies(sb);
      expect(bodies.length).toBe(1);
      const text = bodies[0]!.text;
      expect(text).toContain("acme");
      expect(text).toContain("#2");
      expect(text).toContain(TRICKY_TITLE);
      expect(text).toContain("no reset time was given");
      expect(text).not.toContain(sb.repo);
      expect(text).not.toContain(sb.runs);
      expect(text).not.toContain("QUESTION-SEALED-2");
      expect(text).not.toContain("PROVIDER-UTTERANCE-1");
      expect(text).not.toContain("http");
      expect(Object.keys(bodies[0]!.raw).sort()).toEqual(["chat_id", "text"]);
      expect(bodies[0]!.chat_id).toBe(sb.chat);
    } finally {
      removeSandbox(sb);
    }
  });
});

describe("C3: the token and the chat never appear", () => {
  test("a success leaks nothing to outputs or files", async () => {
    const sb = makeNotifySandbox();
    try {
      makeRun(sb, "1", { waiting: "QUESTION-SEALED-1" });
      const r = await look(sb);
      expectCode(r, 3);
      expect(sendBodies(sb).length).toBe(1);
      writeFileSync(join(sb.runs, "postmaster", "watch.out"), r.out);
      writeFileSync(join(sb.runs, "postmaster", "watch.err"), r.err);
      expectNoSecrets(
        sweepSandbox(sb, [
          { where: "watcher stdout", text: r.out },
          { where: "watcher stderr", text: r.err },
        ]),
        sb.token,
        sb.chat,
      );
    } finally {
      removeSandbox(sb);
    }
  });

  for (const code of [400, 401, 429]) {
    test(`an HTTP ${code} leaks nothing`, async () => {
      const sb = makeNotifySandbox();
      try {
        sb.standin.setMode({ kind: "status", code });
        makeRun(sb, "1", { waiting: "QUESTION-SEALED-1" });
        const r = await look(sb);
        expectCode(r, 3);
        expect(sb.standin.sends().length).toBe(1);
        expect(sendBodies(sb).length).toBe(1);
        expectNoSecrets(
          sweepSandbox(sb, [
            { where: "watcher stdout", text: r.out },
            { where: "watcher stderr", text: r.err },
          ]),
          sb.token,
          sb.chat,
        );
      } finally {
        removeSandbox(sb);
      }
    });
  }

  test("a refused connection leaks nothing", async () => {
    const sb = makeNotifySandbox();
    try {
      sb.standin.stop();
      makeRun(sb, "1", { waiting: "QUESTION-SEALED-1" });
      const r = await look(sb);
      expectCode(r, 3);
      expectNoSecrets(
        sweepSandbox(sb, [
          { where: "watcher stdout", text: r.out },
          { where: "watcher stderr", text: r.err },
        ]),
        sb.token,
        sb.chat,
      );
    } finally {
      removeSandbox(sb);
    }
  });

  test("a hanging service leaks nothing", async () => {
    const sb = makeNotifySandbox();
    try {
      sb.standin.setMode({ kind: "hang" });
      makeRun(sb, "1", { waiting: "QUESTION-SEALED-1" });
      const started = Date.now();
      const r = await look(sb);
      expect(Date.now() - started).toBeLessThan(45000);
      expectCode(r, 3);
      expectNoSecrets(
        sweepSandbox(sb, [
          { where: "watcher stdout", text: r.out },
          { where: "watcher stderr", text: r.err },
        ]),
        sb.token,
        sb.chat,
      );
    } finally {
      removeSandbox(sb);
    }
  });

  test("a token file inside a git checkout leaks nothing", async () => {
    const sb = makeNotifySandbox();
    try {
      const inside = join(sb.repo, "telegram.env");
      writeFileSync(
        inside,
        `TELEGRAM_BOT_TOKEN=${sb.token}\nTELEGRAM_CHAT_ID=${sb.chat}\nTELEGRAM_API_ORIGIN=${sb.standin.origin}\n`,
      );
      chmodSync(inside, 0o600);
      writeFileSync(
        sb.config,
        `[postmaster]\npoll_seconds = 1\n\n[notify]\nchannel = "telegram"\nenv_file = "${inside}"\n`,
      );
      const r = await notifyTest(sb);
      expect(r.code).not.toBe(0);
      expect(sendBodies(sb).length).toBe(0);
      expectNoSecrets(
        sweepSandbox(
          sb,
          [
            { where: "test stdout", text: r.out },
            { where: "test stderr", text: r.err },
          ],
          [inside],
        ),
        sb.token,
        sb.chat,
      );
    } finally {
      removeSandbox(sb);
    }
  });

  test("a token file others can read leaks nothing", async () => {
    const sb = makeNotifySandbox();
    try {
      chmodSync(sb.tokenFile, 0o644);
      const r = await notifyTest(sb);
      expect(r.code).not.toBe(0);
      expect(sendBodies(sb).length).toBe(0);
      expectNoSecrets(
        sweepSandbox(sb, [
          { where: "test stdout", text: r.out },
          { where: "test stderr", text: r.err },
        ]),
        sb.token,
        sb.chat,
      );
    } finally {
      removeSandbox(sb);
    }
  });

  test("the test message leaks nothing", async () => {
    const sb = makeNotifySandbox();
    try {
      const r = await notifyTest(sb);
      expectCode(r, 0);
      expect(sendBodies(sb).length).toBe(1);
      expectNoSecrets(
        sweepSandbox(sb, [
          { where: "test stdout", text: r.out },
          { where: "test stderr", text: r.err },
        ]),
        sb.token,
        sb.chat,
      );
    } finally {
      removeSandbox(sb);
    }
  });

  test("the secrets are in neither the watcher environment nor a child argv", async () => {
    if (!hasProc()) return;
    const sb = makeNotifySandbox();
    try {
      makeRun(sb, "1", { waiting: "QUESTION-SEALED-1" });
      await withRunningWatcher(sb, (pid) => {
        const env = procEnviron(pid);
        expect(env).not.toContain(sb.token);
        expect(env).not.toContain(sb.chat);
        for (const cmd of childCmdlines(pid)) {
          expect(cmd).not.toContain(sb.token);
          expect(cmd).not.toContain(sb.chat);
        }
      });
    } finally {
      removeSandbox(sb);
    }
  });
});

describe("C4: a failed send never stops the work", () => {
  test("dispatch still goes; the failure is recorded once and the message goes on recovery", async () => {
    const sb = makeNotifySandbox();
    try {
      sb.standin.setMode({ kind: "status", code: 500 });
      makeDispatchRun(sb, "1");
      makeRun(sb, "2", { waiting: "QUESTION-SEALED-2" });
      const r1 = await look(sb);
      expectCode(r1, 3);
      expect(existsSync(join(sb.dir, "calls", "dispatch-1-2"))).toBe(true);
      expect(r1.err).toContain("notify");
      expect(failedLedgerLines(sb).length).toBe(1);
      const r2 = await look(sb);
      expectCode(r2, 3);
      const r3 = await look(sb);
      expectCode(r3, 3);
      expect(r2.err).not.toContain("notify");
      expect(r3.err).not.toContain("notify");
      expect(failedLedgerLines(sb).length).toBe(1);
      sb.standin.setMode({ kind: "ok" });
      const r4 = await look(sb);
      expectCode(r4, 3);
      expect(sendBodies(sb).length).toBe(1);
      expect(sendBodies(sb)[0]!.text).toContain("#2");
      sb.standin.setMode({ kind: "status", code: 500 });
      rmSync(join(sb.runs, "2", ".waiting-on-user"));
      writeFileSync(join(sb.runs, "2", ".waiting-on-user"), "QUESTION-SEALED-3");
      const r5 = await look(sb);
      expectCode(r5, 3);
      expect(r5.err).toContain("notify");
      expect(sendBodies(sb).length).toBe(1);
      expect(failedLedgerLines(sb).length).toBe(2);
    } finally {
      removeSandbox(sb);
    }
  });

  test("a hanging service still lets a WALL wake in time", async () => {
    const sb = makeNotifySandbox();
    try {
      sb.standin.setMode({ kind: "hang" });
      const d = makeRun(sb, "1");
      addWall(sb, d, "luna", "none", "PROVIDER-UTTERANCE-1");
      const started = Date.now();
      const r = await look(sb);
      expect(Date.now() - started).toBeLessThan(45000);
      expectCode(r, 0);
      expect(r.out).toContain("needs 1 WALL");
    } finally {
      removeSandbox(sb);
    }
  });

  test("the clerk command fails fast and says why", async () => {
    const sb = makeNotifySandbox();
    try {
      sb.standin.stop();
      const started = Date.now();
      const r = await notifyClerk(sb, "1");
      expect(Date.now() - started).toBeLessThan(30000);
      expect(r.code).not.toBe(0);
      expect(r.err).toMatch(/fail|refus|connect|timed out/iu);
      expect(r.err).not.toContain(sb.token);
      expect(r.err).not.toContain(sb.chat);
    } finally {
      removeSandbox(sb);
    }
  });

  test("the postmaster runbook tells the user once about a failing channel", () => {
    const text = readFileSync(join(ROOT, "skills", "postmaster", "postmaster.md"), "utf8");
    expect(text).toContain("notify");
    expect(text).toContain("tell the user once");
  });
});

describe("C5: setup asks and the test message confirms", () => {
  test("setup lists the messages answer and its file", () => {
    const r = run(RUN, ["setup", "--keys"]);
    expectCode(r, 0);
    expect(r.out).toContain("messages");
    expect(r.out).toContain("none");
    expect(r.out).toContain("messages.env_file");
  });

  test("setup with messages on prints a notify table", () => {
    const sb = makeNotifySandbox();
    try {
      const answers = join(sb.dir, "answers.txt");
      writeFileSync(
        answers,
        [
          "lanes=alpha, beta",
          "lane.alpha.harness=bash",
          "lane.alpha.model=m1",
          "lane.beta.harness=bash",
          "lane.beta.model=m2",
          "workhorses=alpha, beta",
          "coachman.harness=bash",
          "coachman.model=judge",
          "fallback.harness=bash",
          "fallback.model=spare",
          "postmaster.harness=bash",
          "postmaster.model=pm",
          "clerk.harness=bash",
          "clerk.model=ck",
          "messages=telegram",
          `messages.env_file=${sb.tokenFile}`,
          "",
        ].join("\n"),
      );
      const r = run(RUN, ["setup", "--answers", answers, "--dry-run"], { env: sb.env });
      expectCode(r, 0);
      expect(r.out).toContain("[notify]");
      expect(r.out).toContain('channel = "telegram"');
      expect(r.out).toContain(sb.tokenFile);
    } finally {
      removeSandbox(sb);
    }
  });

  test("project setup can switch messages off", () => {
    const sb = makeNotifySandbox();
    try {
      // Project setup resolves against the merged lanes, so the scratch
      // global config carries two.
      writeFileSync(
        sb.config,
        `${readFileSync(sb.config, "utf8")}\n[lanes.alpha]\nharness = "bash"\nmodel = "m1"\n[lanes.beta]\nharness = "bash"\nmodel = "m2"\n`,
      );
      const answers = join(sb.dir, "answers.txt");
      writeFileSync(answers, "messages=none\n");
      const r = run(RUN, ["setup", "--project", sb.repo, "--answers", answers, "--dry-run"], {
        env: sb.env,
      });
      expectCode(r, 0);
      expect(r.out).toContain("[notify]");
      expect(r.out).toContain('channel = "none"');
    } finally {
      removeSandbox(sb);
    }
  });

  test("the test-message command confirms setup with fixed words", async () => {
    const sb = makeNotifySandbox();
    try {
      const r = await notifyTest(sb);
      expectCode(r, 0);
      const bodies = sendBodies(sb);
      expect(bodies.length).toBe(1);
      expect(bodies[0]!.text).toContain("test message");
    } finally {
      removeSandbox(sb);
    }
  });

  test("the test-message command refuses a missing file with the fix", async () => {
    const sb = makeNotifySandbox();
    try {
      rmSync(sb.tokenFile);
      const r = await notifyTest(sb);
      expect(r.code).not.toBe(0);
      expect(sendBodies(sb).length).toBe(0);
      expect(r.err).toContain("TELEGRAM_BOT_TOKEN");
      expect(r.err).toContain("0600");
    } finally {
      removeSandbox(sb);
    }
  });

  test("the test-message command refuses a file inside a git checkout", async () => {
    const sb = makeNotifySandbox();
    try {
      const inside = join(sb.repo, "telegram.env");
      writeFileSync(
        inside,
        `TELEGRAM_BOT_TOKEN=${sb.token}\nTELEGRAM_CHAT_ID=${sb.chat}\nTELEGRAM_API_ORIGIN=${sb.standin.origin}\n`,
      );
      chmodSync(inside, 0o600);
      writeFileSync(
        sb.config,
        `[postmaster]\npoll_seconds = 1\n\n[notify]\nchannel = "telegram"\nenv_file = "${inside}"\n`,
      );
      const r = await notifyTest(sb);
      expect(r.code).not.toBe(0);
      expect(sendBodies(sb).length).toBe(0);
      expect(r.err).toContain("git");
    } finally {
      removeSandbox(sb);
    }
  });

  test("the test-message command refuses a file others can read", async () => {
    const sb = makeNotifySandbox();
    try {
      chmodSync(sb.tokenFile, 0o644);
      const r = await notifyTest(sb);
      expect(r.code).not.toBe(0);
      expect(sendBodies(sb).length).toBe(0);
      expect(r.err).toContain("0600");
    } finally {
      removeSandbox(sb);
    }
  });

  test("AGENTS.md names the messages question and the test", () => {
    const text = readFileSync(join(ROOT, "AGENTS.md"), "utf8");
    expect(text).toContain("Telegram");
    expect(text).toContain("api.telegram.org");
    expect(text).toContain("notify test");
  });

  test("check-setup does not fail on a missing token file", () => {
    const sb = makeNotifySandbox();
    try {
      writeFileSync(
        sb.config,
        [
          'projects_roots = ["~/Code"]',
          'confine = "off"',
          "[lanes.alpha]",
          'harness = "bash"',
          'model = "m1"',
          "[lanes.beta]",
          'harness = "bash"',
          'model = "m2"',
          "[team]",
          'workhorses = ["alpha", "beta"]',
          'reviewers = ["alpha", "beta"]',
          'coachman = { harness = "bash", model = "judge" }',
          'coachman_fallback = { harness = "bash", model = "spare" }',
          'postmaster = { harness = "bash", model = "pm" }',
          "[notify]",
          'channel = "telegram"',
          'env_file = "/nonexistent-454/telegram.env"',
          "",
        ].join("\n"),
      );
      const r = run(RUN, ["check-setup", sb.repo], { env: sb.env });
      expectCode(r, 0);
    } finally {
      removeSandbox(sb);
    }
  });
});
