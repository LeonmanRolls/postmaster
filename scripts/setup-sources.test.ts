// Tests beside the knowledge-sources step in scripts/setup.ts: the machine config registers a
// wiki or standards folder once by name, and a project's own settings may too. Every case is a
// dry run on the shared answers of acceptance-407, so nothing is written but what is printed.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { removeDir, RUN, scratchDir, setupDryRun, writeAnswers } from "./acceptance-407.ts";
import { run } from "./lib/proc.ts";

let tmp = "";

beforeAll(() => {
  tmp = scratchDir("setup-sources-");
});

afterAll(() => {
  removeDir(tmp);
});

describe("the keys", () => {
  test("setup --keys lists the sources and what is asked for each", () => {
    const r = run(RUN, ["setup", "--keys"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("sources?");
    expect(r.out).toContain("source.<name>.path");
    expect(r.out).toContain("source.<name>.about?");
    expect(r.out).toContain("source.<name>.applies_to?");
  });
});

describe("a dry run", () => {
  test("registers each named source with its folder, what is in it and the repos it is proposed for", () => {
    const answers = writeAnswers(
      tmp,
      "two",
      [
        "sources=acme-wiki, handbook",
        "source.acme-wiki.path=~/Code/acme/wiki",
        "source.acme-wiki.about=Acme's standards and review specs",
        "source.acme-wiki.applies_to=~/Code/acme/*, ~/Code/acme-labs/*",
        "source.handbook.path=/srv/handbook",
      ].join("\n"),
    );
    const r = setupDryRun(tmp, answers);
    expect(r.code).toBe(0);
    expect(r.out).toContain('[sources.acme-wiki]\npath = "~/Code/acme/wiki"');
    expect(r.out).toContain('about = "Acme\'s standards and review specs"');
    expect(r.out).toContain('applies_to = ["~/Code/acme/*", "~/Code/acme-labs/*"]');
    expect(r.out).toContain('[sources.handbook]\npath = "/srv/handbook"');
    expect(r.out.split("[sources.handbook]")[1]).not.toContain("about");
  }, 120000);

  test("with no sources named there is no sources table", () => {
    const r = setupDryRun(tmp, writeAnswers(tmp, "none"));
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("[sources.");
  }, 120000);

  test("a source whose folder is not answered is refused by setup's own rule", () => {
    const r = setupDryRun(tmp, writeAnswers(tmp, "nopath", "sources=acme-wiki"));
    expect(r.code).toBe(1);
    expect(r.out).toContain("no answer for source.acme-wiki.path");
  }, 120000);

  test("a source whose folder is answered with nothing is refused, naming the key", () => {
    const answers = writeAnswers(tmp, "emptypath", "sources=acme-wiki\nsource.acme-wiki.path=");
    const r = setupDryRun(tmp, answers);
    expect(r.code).toBe(1);
    expect(r.out).toContain("source 'acme-wiki' needs a folder: answer source.acme-wiki.path");
  }, 120000);

  test("a source name with a space or a slash is refused", () => {
    for (const bad of ["acme wiki", "acme/wiki"]) {
      const r = setupDryRun(tmp, writeAnswers(tmp, "badname", `sources=${bad}`));
      expect(r.code).toBe(1);
      expect(r.out).toContain("a source name is letters, digits, dot, underscore or dash");
    }
  }, 120000);

  test("text with a quote or a backslash is written as valid TOML", () => {
    const answers = writeAnswers(
      tmp,
      "quote",
      ["sources=w", 'source.w.path=/srv/a "b"', 'source.w.about=say "hi" \\ there'].join("\n"),
    );
    const r = setupDryRun(tmp, answers);
    expect(r.code).toBe(0);
    expect(r.out).toContain('path = "/srv/a \\"b\\""');
    expect(r.out).toContain('about = "say \\"hi\\" \\\\ there"');
  }, 120000);
});
