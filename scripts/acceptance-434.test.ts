// Oracle for #434, committed before the change: the booking clerk makes a
// story for every ticket it prepares. C1 checks the brief says the clerk
// makes a story with the draft and where its files go (the clerk session half
// runs by hand before the card); C2 drives build, check and rebuild through
// a stub adapter; C3 checks the stories setting on the machine and per
// project, through setup and through the brief. Everything runs as a
// subprocess, never imported.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  C1,
  C1B,
  C2,
  C3,
  LAMP_TITLE,
  LAMP_TITLE_2,
  REPO,
  adapterCalls,
  bareRepo,
  briefFor,
  buildStory,
  checkStory,
  cleanup,
  draftBody,
  fixtureRepo,
  localTicket,
  machineSetup,
  pictureBytes,
  projectSetup,
  sh,
  stageStory,
  stubConfig,
  ticketNum,
  writeStoryJson,
  writeTicketJson,
} from "./acceptance-434.ts";

afterAll(() => {
  cleanup();
});

describe("C1: the brief says the clerk makes a story with the draft", () => {
  test("a three-criterion ticket with no stories setting gets a story and its files", () => {
    const repo = fixtureRepo();
    const id = localTicket(
      repo,
      "The shelf lists every book",
      [
        "## Problem / feature",
        "",
        "The shelf shows a reader's books in the order they were shelved.",
        "",
        "## Acceptance criteria",
        "",
        "1. The shelf lists every book on it.",
        "2. A new book lands at the end of the shelf.",
        "3. A book taken off the shelf is gone from the list.",
        "",
      ].join("\n"),
    );
    const brief = briefFor(repo, id, stubConfig());
    expect(brief).toContain("Stories: on");
    expect(brief).toContain("Make a story with the draft");
    expect(brief).toContain(join(repo, ".postmaster", "clerk", `${id}.story`));
  });
});

describe("C2: the story is rebuilt to match, keeping its picture", () => {
  test("a reworded and an added criterion read out of date, then current after a rebuild that keeps the picture; a new title draws again", () => {
    const repo = fixtureRepo();
    const id = localTicket(repo, LAMP_TITLE, draftBody([C1, C2]));
    const ticket = ticketNum(id);
    const s = stageStory(ticket, LAMP_TITLE, draftBody([C1, C2]), [C1, C2]);

    const empty = checkStory(s);
    expect(empty.code).not.toBe(0);
    expect(empty.out).toContain("out of date");

    const b1 = buildStory(s, repo, ["--keep-picture"]);
    expect(b1.err).toBe("");
    expect(b1.code).toBe(0);
    expect(adapterCalls(s)).toBe(1);
    const pic1 = pictureBytes(s);
    const html1 = readFileSync(join(s.dir, "index.html"), "utf8");
    expect(html1).not.toContain(C3.title);

    writeTicketJson(s, LAMP_TITLE, draftBody([C1B, C2, C3]));
    const stale = checkStory(s);
    expect(stale.code).not.toBe(0);
    expect(stale.out).toContain("out of date");

    writeStoryJson(s, ticket, [C1B, C2, C3]);
    const b2 = buildStory(s, repo, ["--keep-picture"]);
    expect(b2.err).toBe("");
    expect(b2.code).toBe(0);
    expect(adapterCalls(s)).toBe(1);
    expect(pictureBytes(s).equals(pic1)).toBe(true);
    const html2 = readFileSync(join(s.dir, "index.html"), "utf8");
    expect(html2).toContain(C3.title);
    expect(html2).toContain(C3.find);

    const fresh = checkStory(s);
    expect(fresh.code).toBe(0);

    writeTicketJson(s, LAMP_TITLE_2, draftBody([C1B, C2, C3]));
    const retitled = checkStory(s);
    expect(retitled.code).not.toBe(0);
    expect(retitled.out).toContain("out of date");

    const b3 = buildStory(s, repo, ["--keep-picture"]);
    expect(b3.err).toBe("");
    expect(b3.code).toBe(0);
    expect(adapterCalls(s)).toBe(2);
    expect(checkStory(s).code).toBe(0);
  });
});

describe("C3: the stories setting turns the clerk's stories off", () => {
  test("stories off in the machine config means no story", () => {
    const repo = fixtureRepo();
    const id = localTicket(repo, "The shelf lists every book", "A body.\n");
    const brief = briefFor(repo, id, stubConfig(`[planning]\nstories = "off"`));
    expect(brief).toContain("Stories: off");
    expect(brief).toContain("Make no story");
    expect(brief).not.toContain("Make a story with the draft");
  });

  test("no stories key means a story", () => {
    const repo = fixtureRepo();
    const id = localTicket(repo, "The shelf lists every book", "A body.\n");
    const brief = briefFor(repo, id, stubConfig());
    expect(brief).toContain("Stories: on");
    expect(brief).toContain("Make a story with the draft");
  });

  test("one project's settings turn stories off for that project alone", () => {
    const cfg = stubConfig();
    const off = fixtureRepo();
    const offId = localTicket(off, "The shelf lists every book", "A body.\n");
    mkdirSync(join(off, ".postmaster"), { recursive: true });
    writeFileSync(join(off, ".postmaster", "settings.toml"), `[planning]\nstories = "off"\n`);
    const briefOff = briefFor(off, offId, cfg);
    expect(briefOff).toContain("Stories: off");
    expect(briefOff).toContain("Make no story");

    const on = fixtureRepo();
    const onId = localTicket(on, "The shelf lists every book", "A body.\n");
    const briefOn = briefFor(on, onId, cfg);
    expect(briefOn).toContain("Stories: on");
    expect(briefOn).toContain("Make a story with the draft");
  });

  test("setup --answers writes planning.stories=off into the machine config", () => {
    const r = machineSetup("planning.stories=off");
    expect(r.code).toBe(0);
    expect(readFileSync(r.toml, "utf8")).toContain('stories = "off"');
  });

  test("setup --answers refuses a stories value other than on or off", () => {
    for (const v of ["yes", "true", "2"]) {
      const r = machineSetup(`planning.stories=${v}`);
      expect(r.code).not.toBe(0);
      expect(r.out + r.err).toContain("planning.stories");
    }
  });

  test("setup --project --answers writes planning.stories into one project's settings", () => {
    const repo = bareRepo();
    const r = projectSetup(repo, "planning.stories=off");
    expect(r.code).toBe(0);
    expect(readFileSync(join(repo, ".postmaster", "settings.toml"), "utf8")).toContain(
      'stories = "off"',
    );
  });

  test("setup --keys names planning.stories", () => {
    const keys = sh(["setup", "--keys"]);
    expect(keys.code).toBe(0);
    expect(keys.out).toContain("planning.stories");
  });

  test("the runbook shows the draft alone when the brief says no story, and builds a story otherwise", () => {
    const md = readFileSync(join(REPO, "skills", "clerk", "clerk.md"), "utf8");
    expect(md).toContain("says no story");
    expect(md).toContain("story-page build");
  });
});
