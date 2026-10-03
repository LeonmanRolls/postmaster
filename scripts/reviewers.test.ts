// Tests beside scripts/reviewers.ts, moved from its --self-test on #109: 34 controls.
// The self-test read follow-up assertions from the previous control's stderr; each test below
// re-runs its own call so it passes alone as well as in file order. The err scratch file the
// helper kept for debugging is dropped: no control read it.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./lib/proc.ts";
import { eligible, lanes, lines } from "./reviewers.ts";

const SELF = join(import.meta.dir, "reviewers.sh");

let tmp = "";

const lanesBlock = `[lanes.luna]
harness = "codex"
model = "m1"
[lanes.mimo]
harness = "mimo"
model = "m2"
[lanes.sentinel]
harness = "claude"
model = "m3"
[lanes.pi]
harness = "pi"
model = "m4"`;

const config = (name: string, teamBody: string): void => {
  writeFileSync(join(tmp, `${name}.toml`), `${lanesBlock}\n\n[team]\n${teamBody}\n`);
};

const waybill = (name: string, reviewerLines: string): void => {
  writeFileSync(
    join(tmp, `${name}.md`),
    `# Waybill: 7\n\n## Ticket\n\nsecurity reviewers: luna\nreviewers: sentinel\n\n` +
      `## Team\nworkhorses: luna=codex/m1/, mimo=mimo/m2/\n${reviewerLines}\ncoachman: muse/m4/\n\n` +
      `## Dispatch\ndispatch: /tmp/x\n`,
  );
};

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "postmaster-"));
  writeFileSync(
    join(tmp, "uni1.md"),
    "# Waybill: 7\n\n## Ticket\nx\n\n##\x1fTeam\nsecurity reviewers: luna\n\n## Dispatch\ndispatch: /tmp/x\n",
  );
  waybill("uni2", "security reviewers\x1f:\x1fluna");
  writeFileSync(
    join(tmp, "uni3.md"),
    "# Waybill: 7\n\n## Ticket\nx\n\n## Team\x1csecurity reviewers: luna\n\n## Dispatch\ndispatch: /tmp/x\n",
  );
  config(
    "one",
    `workhorses = ["luna", "mimo"]
reviewers = ["luna", "mimo"]
[team.lens_reviewers]
security = ["luna", "mimo", "sentinel"]`,
  );
  waybill("one", lines(join(tmp, "one.toml")).out.trimEnd());
  config(
    "two",
    `workhorses = ["luna", "mimo"]
reviewers = ["sentinel"]`,
  );
  config("three", `workhorses = ["luna", "mimo"]`);
  writeFileSync(
    join(tmp, "no-review.toml"),
    '[lanes.pi]\nharness = "pi"\nmodel = "p"\n\n[team]\nworkhorses = ["pi"]\nreviewers = ["pi"]\n',
  );
  config(
    "mixed",
    `workhorses = ["luna", "pi"]
reviewers = ["luna", "pi"]`,
  );
  config(
    "bad-lens",
    `workhorses = ["luna", "mimo"]
[team.lens_reviewers]
secruity = ["sentinel"]`,
  );
  config(
    "bad-lane",
    `workhorses = ["luna", "mimo"]
[team.lens_reviewers]
security = ["luna", "nobody"]`,
  );
  config(
    "empty",
    `workhorses = ["luna", "mimo"]
[team.lens_reviewers]
security = []`,
  );
  config(
    "bad-default",
    `workhorses = ["luna", "mimo"]
reviewers = ["ghost"]`,
  );
  waybill("no-team", "");
  writeFileSync(
    join(tmp, "empty-bug.md"),
    "# Waybill: 7\n\n## Team\nreviewers: luna, mimo\nbug reviewers: \n",
  );
  waybill("no-bug-line", "reviewers: luna, pi");
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const check = (r: { code: number; out: string }, wantRc: number, want: string): void => {
  expect(r.code).toBe(wantRc);
  expect(r.out.replace(/\n+$/u, "")).toBe(want);
};

describe("unicode primitives", () => {
  test("a Team heading with U+001F opens the section", () => {
    check(lanes(join(tmp, "uni1.md"), "security"), 0, "luna");
  });

  test("a reviewers line with U+001F parses", () => {
    check(lanes(join(tmp, "uni2.md"), "security"), 0, "luna");
  });

  test("a U+001C opens a new line (splitlines)", () => {
    check(lanes(join(tmp, "uni3.md"), "security"), 0, "luna");
  });
});

describe("positive controls", () => {
  test("the waybill lines name the reviewers, then each lens with its own lanes", () => {
    check(
      lines(join(tmp, "one.toml")),
      0,
      "reviewers: luna, mimo\nbug reviewers: luna, mimo\nsecurity reviewers: luna, mimo, sentinel",
    );
  });

  test("a lens with its own line gets exactly those lanes", () => {
    check(lanes(join(tmp, "one.md"), "security"), 0, "luna\nmimo\nsentinel");
  });

  test("the bug lens gets only configured reviewers with a review form", () => {
    check(lanes(join(tmp, "one.md"), "bug"), 0, "luna\nmimo");
  });

  test("the configured bug reviewers resolve to eligible lanes", () => {
    check(eligible(join(tmp, "one.toml"), "bug"), 0, "luna\nmimo");
  });

  test("and so does style", () => {
    check(lanes(join(tmp, "one.md"), "style"), 0, "luna\nmimo");
  });

  test("a config without the table keeps the reviewer line and adds eligible bug reviewers", () => {
    check(lines(join(tmp, "two.toml")), 0, "reviewers: sentinel\nbug reviewers: sentinel");
  });

  test("reviewers default to the workhorses, and bug reviewers are filtered", () => {
    check(lines(join(tmp, "three.toml")), 0, "reviewers: luna, mimo\nbug reviewers: luna, mimo");
  });

  test("no eligible bug reviewer is a pre-flight refusal with its reason", () => {
    check(eligible(join(tmp, "no-review.toml"), "bug"), 2, "");
  });

  test("the refusal explains why the bug lens cannot run", () => {
    const r = eligible(join(tmp, "no-review.toml"), "bug");
    expect(r.err.includes("no configured bug reviewer has a code-review form")).toBe(true);
  });

  test("a bug reviewer whose harness has no review form is left off the bug line", () => {
    check(lines(join(tmp, "mixed.toml")), 0, "reviewers: luna, pi\nbug reviewers: luna");
  });

  test("eligible agrees with review-forms.sh on the same config", () => {
    check(eligible(join(tmp, "mixed.toml"), "bug"), 0, "luna");
  });

  test("the lenses are the review stage's, in order", () => {
    check(run(SELF, ["lenses"]), 0, "style\nbug\nsecurity");
  });
});

describe("negative controls", () => {
  test("a lens the review stage does not have is refused", () => {
    check(lines(join(tmp, "bad-lens.toml")), 2, "");
  });

  test("and named", () => {
    const r = lines(join(tmp, "bad-lens.toml"));
    expect(r.err.includes("secruity, which is not a lens")).toBe(true);
  });

  test("a lane the config does not define is refused", () => {
    check(lines(join(tmp, "bad-lane.toml")), 2, "");
  });

  test("and named", () => {
    const r = lines(join(tmp, "bad-lane.toml"));
    expect(r.err.includes("nobody, which is not a lane")).toBe(true);
  });

  test("a lens with no lanes is refused", () => {
    check(lines(join(tmp, "empty.toml")), 2, "");
  });

  test("a reviewer that is not a lane is refused", () => {
    check(lines(join(tmp, "bad-default.toml")), 2, "");
  });

  test("no config is refused", () => {
    check(lines(join(tmp, "missing.toml")), 1, "");
  });

  test("an explicitly empty --project is refused, never read as no project", () => {
    check(run(SELF, ["lines", "--config", join(tmp, "one.toml"), "--project", ""]), 1, "");
  });

  test("and the refusal names the project", () => {
    const r = run(SELF, ["lines", "--config", join(tmp, "one.toml"), "--project", ""]);
    expect(r.err.includes("no such project directory")).toBe(true);
  });

  test("an explicitly empty --project is refused for eligible too", () => {
    check(
      run(SELF, ["eligible", "bug", "--config", join(tmp, "one.toml"), "--project", ""]),
      1,
      "",
    );
  });

  test("and the eligible refusal names the project", () => {
    const r = run(SELF, ["eligible", "bug", "--config", join(tmp, "one.toml"), "--project", ""]);
    expect(r.err.includes("no such project directory")).toBe(true);
  });

  test("a waybill lens that is not a lens is refused", () => {
    check(lanes(join(tmp, "one.md"), "secruity"), 2, "");
  });

  test("a Team section with no reviewers line is refused, never read as no reviewers", () => {
    check(lanes(join(tmp, "no-team.md"), "bug"), 2, "");
  });

  test("reviewer lines in the ticket's text are not read", () => {
    check(lanes(join(tmp, "no-team.md"), "security"), 2, "");
  });

  test("an explicit empty bug reviewers line does not fall back to reviewers", () => {
    check(lanes(join(tmp, "empty-bug.md"), "bug"), 2, "");
  });

  test("the refusal names the empty bug reviewers line", () => {
    const r = lanes(join(tmp, "empty-bug.md"), "bug");
    expect(r.err.includes("empty bug reviewers line")).toBe(true);
  });

  test("a waybill with no bug reviewers line is refused, never fallen back", () => {
    check(lanes(join(tmp, "no-bug-line.md"), "bug"), 2, "");
  });

  test("the refusal names the missing bug reviewers line", () => {
    const r = lanes(join(tmp, "no-bug-line.md"), "bug");
    expect(r.err.includes("no bug reviewers line")).toBe(true);
  });

  test("no such waybill is refused", () => {
    check(lanes(join(tmp, "none.md"), "bug"), 1, "");
  });
});
