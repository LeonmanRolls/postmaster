// Oracle for #504, committed before the change: a user can turn on a setting
// so that a project's runs open their pull requests as drafts. C1 drives the
// stand-in with the setting absent and off: the recorded pr create carries
// no --draft, no pr ready call is made, and the checks are asked and acted
// on as today. C2 writes the setting on through setup --project and records
// it with run-meta: the recorded pr create carries --draft and pr view
// --json isDraft reads true. C3 follows the draft's checks passing: the
// draft's link and the question wait for the user's word with no pr ready
// call, then the word brings one pr ready call after a log-action line
// carrying it, and isDraft reads false. C4 answers the checks skipping,
// then pending, then passing: no merge instructions until the pass after
// the mark. C5 refuses the draft create twice: nothing opens until the
// user's yes, which opens one ready pull request. Every run goes through
// the calls the runbook names, as subprocesses, never imported; the runbook
// sentences each flow rests on are read from postmaster.md. C6, the fixture
// run from the final head, is the landing check and no test here.
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PASS_CHECKS,
  PENDING_CHECKS,
  POSTMASTER_MD,
  SKIPPED_CHECKS,
  actionsText,
  askChecks,
  cleanup,
  creates,
  expectOk,
  ghCalls,
  globalConfig,
  isDraft,
  markReady,
  openPr,
  projectSetup,
  pushTicket,
  readWaiting,
  readies,
  recordRun,
  refuseCreates,
  seedDraft,
  sh,
  standin,
  writeChecks,
  writeList,
  writeRunJson,
  writeWaiting,
  type Standin,
} from "./acceptance-504.ts";

afterAll(() => {
  cleanup();
});

const RUNBOOK = readFileSync(POSTMASTER_MD, "utf8");

function openReady(s: Standin): void {
  writeChecks(s, PASS_CHECKS);
  const r = expectOk(openPr(s), "open-pr");
  expect(r.out.trim()).toBe(`opened ${s.url} ready`);
  expect(creates(s)).toHaveLength(1);
  expect(creates(s)[0]).not.toContain("--draft");
  expect(readies(s)).toHaveLength(0);
  const c = expectOk(askChecks(s), "pull-request-checks");
  expect(c.out.trim()).toBe("pass");
}

describe("C1: with the setting off the pull request opens ready, as today", () => {
  test("no setting in run.json", () => {
    const s = standin("c1-absent");
    writeRunJson(s, { merge_authority: "user" });
    pushTicket(s);
    openReady(s);
  });

  test("setting off", () => {
    const s = standin("c1-off");
    writeRunJson(s, { merge_authority: "user", draft_pull_requests: "off" });
    pushTicket(s);
    openReady(s);
  });

  test("the runbook still writes the merge instructions for a ready pass", () => {
    expect(RUNBOOK).toContain("merge instructions in `.waiting-on-user`");
  });
});

describe("C2: with the setting on the pull request opens as a draft", () => {
  test("setup lists the key", () => {
    const keys = expectOk(sh(["setup", "--keys"]), "setup --keys");
    expect(keys.out).toContain("draft_pull_requests");
  });

  test("project settings carry the key into run.json and the create drafts", () => {
    const s = standin("c2");
    const cfg = globalConfig();
    const setup = expectOk(projectSetup(s.repo, "draft_pull_requests=on", cfg), "setup --project");
    expect(setup.out).toContain("Draft pull requests (on, off): on");
    const settings = readFileSync(join(s.repo, ".postmaster", "settings.toml"), "utf8");
    expect(settings).toContain('draft_pull_requests = "on"');
    expectOk(recordRun(s.dispatch, s.repo, cfg), "run-meta");
    const recorded = JSON.parse(readFileSync(join(s.dispatch, "run.json"), "utf8")) as {
      config: { ship: { draft_pull_requests: unknown } };
    };
    expect(recorded.config.ship.draft_pull_requests).toBe("on");
    pushTicket(s);
    const r = expectOk(openPr(s), "open-pr");
    expect(r.out.trim()).toBe(`opened ${s.url} draft`);
    expect(creates(s)).toHaveLength(1);
    expect(creates(s)[0]).toContain("--draft");
    expect(isDraft(s)).toBe(true);
  });

  test("the runbook opens through its call", () => {
    expect(RUNBOOK).toContain("landing open-pr");
  });
});

describe("C3: the draft waits for the user's word, then is marked ready", () => {
  function askedDraft(label: string): Standin {
    const s = standin(label);
    writeRunJson(s, { draft_pull_requests: "on" });
    pushTicket(s);
    writeChecks(s, PASS_CHECKS);
    const r = expectOk(openPr(s), "open-pr");
    expect(r.out.trim()).toBe(`opened ${s.url} draft`);
    const c = expectOk(askChecks(s), "pull-request-checks");
    expect(c.out.trim()).toBe("pass");
    return s;
  }

  test("the draft's link and the question wait, with no pr ready call", () => {
    const s = askedDraft("c3-ask");
    writeWaiting(s, `${s.url}\nlook at the draft and say the word\n`);
    const waiting = readWaiting(s);
    expect(waiting).toContain(s.url);
    expect(waiting).toContain("say the word");
    expect(waiting).not.toContain("merge instructions");
    expect(readies(s)).toHaveLength(0);
  });

  test("the word brings the log line, one pr ready call and a ready pull request", () => {
    const s = askedDraft("c3-mark");
    writeWaiting(s, `${s.url}\nlook at the draft and say the word\n`);
    const word = "looks good, mark it ready";
    expectOk(
      sh(["log-action", s.dispatch, "postmaster", "note", s.url, "mark-ready", word]),
      "log-action",
    );
    expect(actionsText(s)).toContain(word);
    const m = expectOk(markReady(s), "mark-ready");
    expect(m.out.trim()).toBe("ready");
    expect(readies(s)).toHaveLength(1);
    expect(readies(s)[0]).toBe(`pr ready ${s.url}`);
    expect(isDraft(s)).toBe(false);
  });

  test("the runbook logs the word, then marks through its call", () => {
    expect(RUNBOOK).toContain("landing mark-ready");
    expect(RUNBOOK).toContain("mark-ready <the user's words>");
  });
});

describe("C4: the merge instructions wait for the checks after the mark", () => {
  test("skipped, then pending, then passing", () => {
    const s = standin("c4");
    writeRunJson(s, { draft_pull_requests: "on" });
    pushTicket(s);
    const opened = expectOk(openPr(s), "open-pr");
    expect(opened.out.trim()).toBe(`opened ${s.url} draft`);
    // A draft's skipped checks read as passed, so the draft is asked about.
    writeChecks(s, SKIPPED_CHECKS);
    const before = expectOk(askChecks(s), "checks while a draft");
    expect(before.out.trim()).toBe("pass");
    writeWaiting(s, `${s.url}\nlook at the draft and say the word\n`);
    expect(readWaiting(s)).not.toContain("merge instructions");
    expectOk(
      sh(["log-action", s.dispatch, "postmaster", "note", s.url, "mark-ready", "yes"]),
      "log-action",
    );
    expect(expectOk(markReady(s), "mark-ready").out.trim()).toBe("ready");
    // After the mark the checks are asked again: pending waits, and only the
    // pass after the mark writes the merge instructions.
    writeChecks(s, PENDING_CHECKS, 8);
    const waiting = expectOk(askChecks(s), "checks after the mark");
    expect(waiting.out.trim()).toBe("pending: macos");
    expect(readWaiting(s)).not.toContain("merge instructions");
    writeChecks(s, PASS_CHECKS);
    const after = expectOk(askChecks(s), "checks at a later ask");
    expect(after.out.trim()).toBe("pass");
    writeWaiting(s, `${s.url}\nmerge instructions\n`);
    expect(readWaiting(s)).toContain("merge instructions");
  });

  test("the runbook asks the checks again after the mark", () => {
    expect(RUNBOOK).toContain("ask `pull-request-checks` again");
  });
});

describe("C5: when the draft cannot open, the run asks instead of opening", () => {
  const refusals = [
    "Draft pull requests are not supported in this repository",
    "GraphQL: draft pull requests are disabled in this repository",
  ];

  for (const message of refusals) {
    test(`refused (${message.slice(0, 24)}...): nothing opens until the yes`, () => {
      const s = standin(`c5-${message.length}`);
      writeRunJson(s, { draft_pull_requests: "on" });
      pushTicket(s);
      refuseCreates(s, message);
      const r = expectOk(openPr(s), "open-pr");
      expect(r.out.trim()).toBe(`refused ${message}`);
      expect(creates(s)).toHaveLength(1);
      expect(creates(s)[0]).toContain("--draft");
      expect(creates(s).filter((l) => !l.includes("--draft"))).toHaveLength(0);
      writeWaiting(s, `open the pull request ready for review instead?\n${message}\n`);
      expect(readWaiting(s)).toContain(message);
      // The user's yes opens one ready pull request, and the route goes on.
      const yes = expectOk(openPr(s, true), "open-pr --ready");
      expect(yes.out.trim()).toBe(`opened ${s.url} ready`);
      expect(creates(s).filter((l) => !l.includes("--draft"))).toHaveLength(1);
      writeChecks(s, PASS_CHECKS);
      const c = expectOk(askChecks(s), "pull-request-checks");
      expect(c.out.trim()).toBe("pass");
    });
  }

  test("the runbook offers the ready pull request instead", () => {
    expect(RUNBOOK).toContain("open the pull request ready for review instead");
  });
});

describe("adopted pull requests keep their state", () => {
  test("an adopted draft waits like a new one", () => {
    const s = standin("adopt-draft");
    writeRunJson(s, { draft_pull_requests: "on" });
    pushTicket(s);
    writeList(s, [{ url: s.url, isDraft: true }]);
    seedDraft(s, true);
    const r = expectOk(openPr(s), "open-pr");
    expect(r.out.trim()).toBe(`adopted ${s.url} draft`);
    expect(creates(s)).toHaveLength(0);
    expect(ghCalls(s).filter((l) => l.startsWith("pr list "))).toHaveLength(1);
    expect(isDraft(s)).toBe(true);
  });

  test("an adopted ready pull request goes on as today", () => {
    const s = standin("adopt-ready");
    writeRunJson(s, {});
    pushTicket(s);
    writeList(s, [{ url: s.url, isDraft: false }]);
    seedDraft(s, false);
    const r = expectOk(openPr(s), "open-pr");
    expect(r.out.trim()).toBe(`adopted ${s.url} ready`);
    expect(creates(s)).toHaveLength(0);
    writeChecks(s, PASS_CHECKS);
    expect(expectOk(askChecks(s), "pull-request-checks").out.trim()).toBe("pass");
  });
});
