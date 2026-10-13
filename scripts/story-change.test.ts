// Tests beside scripts/story-change.ts. The command is a script, so each test runs it as a
// subprocess against a small git repository built here: a base commit, a head commit that changes
// one file and adds another, and a story folder drawn over them.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run, withTempDir } from "./lib/proc.ts";

const self = join(import.meta.dir, "run");

// An address in the head commit, built here so this file holds no address of its own.
const ADDRESS = ["owner", "real-company.io"].join("@");

const GIT_ENV = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };

const git = (repo: string, args: string[]): string => {
  const r = run("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    env: GIT_ENV,
  });
  expect(r.code).toBe(0);
  return r.out.trim();
};

interface Fixture {
  repo: string;
  storyDir: string;
  out: string;
  base: string;
  head: string;
}

const DIAGRAM = [
  '<svg class="dg" viewBox="0 0 100 40" role="img" aria-label="Two boxes">',
  '  <rect class="bx hl-a" x="4" y="4" width="40" height="30"/>',
  '  <rect class="bx hl-b" x="56" y="4" width="40" height="30"/>',
  '  <text class="t1 on-a" x="10" y="24">first</text>',
  "</svg>",
].join("\n");

const baseStory = (f: Pick<Fixture, "base" | "head">) => ({
  title: "TEST-1 change story",
  ticketLabel: "TEST-1",
  ticketTitle: "Make two bigger",
  base: f.base,
  head: f.head,
  sections: [
    { id: "open", label: "Start", title: "The change" },
    { id: "code", label: "Code", title: "The code" },
  ],
  scenes: [
    {
      id: "ticket",
      kind: "doc",
      from: "file",
      file: "ticket.md",
      title: "Make two bigger",
      label: "Ticket TEST-1",
      chip: "the ticket",
    },
    {
      id: "flow",
      kind: "diagram",
      label: "Two boxes",
      chip: "diagram",
      svg: "flow.svg",
      states: ["a", "b"],
      caption: "Two boxes.",
    },
    { id: "a", kind: "head", file: "src/a.ts", from: 1, to: 6 },
    { id: "old", kind: "base", file: "src/a.ts", from: 1, to: 3 },
    { id: "left", kind: "leftovers", label: "What the steps leave out", chip: "list" },
  ],
  steps: [
    {
      id: "title",
      section: "open",
      scene: "ticket",
      kind: "title",
      title: "Two gets bigger",
      text: "The change in one sentence.",
    },
    {
      id: "boxes",
      section: "open",
      scene: "flow",
      state: "a",
      title: "Two boxes",
      text: "The first box is lit.",
    },
    {
      id: "code",
      section: "code",
      scene: "a",
      focus: [[2, 2]],
      marks: [{ line: 2, text: ["22"] }],
      title: "The new value",
      text: "`two` is now 22.",
    },
    {
      id: "was",
      section: "code",
      scene: "old",
      focus: [[2, 2]],
      marks: [{ line: 2, text: ["two = 2"] }],
      title: "The old value",
      text: "It was 2.",
    },
    {
      id: "rest",
      section: "code",
      scene: "left",
      title: "What the steps leave out",
      text: "{shown} of {changed} lines are shown; {left} are listed.",
    },
  ],
});

const withFixture = (fn: (f: Fixture) => void): void => {
  withTempDir((tmp) => {
    const repo = join(tmp, "repo");
    const storyDir = join(tmp, "story");
    mkdirSync(join(repo, "src"), { recursive: true });
    mkdirSync(storyDir);
    expect(run("git", ["init", "-q", "-b", "main", repo], { env: GIT_ENV }).code).toBe(0);
    writeFileSync(
      join(repo, "src/a.ts"),
      "export const one = 1;\nexport const two = 2;\nexport const three = 3;\n",
    );
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "base"]);
    const base = git(repo, ["rev-parse", "HEAD"]);
    writeFileSync(
      join(repo, "src/a.ts"),
      "export const one = 1;\nexport const two = 22;\nexport const three = 3;\nexport const four = 4;\nexport const five = 5;\nexport const six = 6;\n",
    );
    writeFileSync(
      join(repo, "src/b.ts"),
      `export const b1 = "${ADDRESS}";\nexport const b2 = 2;\nexport const b3 = 3;\n`,
    );
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "head"]);
    const head = git(repo, ["rev-parse", "HEAD"]);
    writeFileSync(
      join(storyDir, "ticket.md"),
      "## Problem\n\nTwo is too small.\n\n## Acceptance criteria\n\n1. Two is 22.\n",
    );
    writeFileSync(join(storyDir, "flow.svg"), DIAGRAM);
    const f: Fixture = { repo, storyDir, out: join(tmp, "out"), base, head };
    writeFileSync(join(storyDir, "story.json"), JSON.stringify(baseStory(f)));
    fn(f);
  });
};

const writeStory = (f: Fixture, edit: (story: ReturnType<typeof baseStory>) => void): void => {
  const story = baseStory(f);
  edit(story);
  writeFileSync(join(f.storyDir, "story.json"), JSON.stringify(story));
};

const build = (f: Fixture, extra: string[] = []) =>
  run(self, ["story-change", "build", f.repo, f.storyDir, f.out, ...extra]);

describe("story-change build", () => {
  test("writes the page and its two previews and prints the coverage", () => {
    withFixture((f) => {
      const r = build(f);
      expect(r.err).toBe("");
      expect(r.code).toBe(0);
      expect(r.out).toContain(
        "story of TEST-1: 5 steps (Start 2, Code 3), 5 scenes, 8 changed lines, 5 on steps, 3 listed (1 groups)",
      );
      for (const name of ["index.html", "preview-light.html", "preview-dark.html"])
        expect(existsSync(join(f.out, name))).toBe(true);
      const page = readFileSync(join(f.out, "index.html"), "utf8");
      expect(page).toContain("<title>TEST-1 change story</title>");
      expect(page).toContain("Two gets bigger");
      expect(page).toContain('data-state="a"');
      expect(page).toContain("5 of 8 lines are shown; 3 are listed.");
      expect(page).toContain("src/b.ts");
    });
  });

  test("the page's own script makes no network or storage calls", () => {
    withFixture((f) => {
      expect(build(f).code).toBe(0);
      const page = readFileSync(join(f.out, "index.html"), "utf8");
      const scripts = [
        // ASCII: the page's markup is ASCII, so \s and \b are exact here.
        ...page.matchAll(/<script(?![^>]*\b(?:src|type)=)[^>]*>([\s\S]*?)<\/script>/gu),
      ].map((m) => m[1] ?? "");
      expect(scripts.length).toBeGreaterThan(0);
      for (const script of scripts)
        for (const call of [
          "fetch(",
          "XMLHttpRequest",
          "localStorage",
          "sessionStorage",
          "WebSocket",
          "sendBeacon",
          "eval(",
        ])
          expect(script).not.toContain(call);
    });
  });

  test("a file as it stood at the base is shown with the line the change removed", () => {
    withFixture((f) => {
      expect(build(f).code).toBe(0);
      const page = readFileSync(join(f.out, "index.html"), "utf8");
      expect(page).toContain("before the change");
      expect(page).toContain('title="Removed by this change"');
    });
  });

  test("removes email addresses from every text it shows and says how many", () => {
    withFixture((f) => {
      const r = build(f);
      expect(r.out).toContain("1 email address removed");
      const page = readFileSync(join(f.out, "index.html"), "utf8");
      expect(page).not.toContain("real-company.io");
      expect(page).toContain("&lt;address removed&gt;");
    });
  });

  test("a footer in the story replaces the whole closing line, and the default points at the chat", () => {
    withFixture((f) => {
      expect(build(f).code).toBe(0);
      const page = readFileSync(join(f.out, "index.html"), "utf8");
      expect(page).toContain("Comments and decisions go in your chat with the session.");
      writeFileSync(
        join(f.storyDir, "story.json"),
        JSON.stringify({ ...baseStory(f), footer: "Built from the branch of this pull request." }),
      );
      expect(build(f).code).toBe(0);
      const shared = readFileSync(join(f.out, "index.html"), "utf8");
      expect(shared).toContain("Built from the branch of this pull request. The code is at");
      expect(shared).not.toContain("your chat with the session");
      expect(shared).not.toContain("Nothing is pushed");
    });
  });

  test("--drop leaves one step out", () => {
    withFixture((f) => {
      const r = build(f, ["--drop", "boxes"]);
      expect(r.code).toBe(0);
      expect(r.out).toContain("4 steps");
      expect(r.out).toContain("step boxes dropped");
    });
  });

  test("a changed line no step shows must be listed on a step", () => {
    withFixture((f) => {
      writeStory(f, (story) => {
        story.steps = story.steps.filter((s) => s.id !== "rest");
      });
      const r = build(f);
      expect(r.code).toBe(1);
      expect(r.err).toContain(
        "story-change: 3 changed lines are on no step, and no step shows the list of them",
      );
      expect(existsSync(f.out)).toBe(false);
    });
  });

  test("names every problem at once and writes nothing", () => {
    withFixture((f) => {
      writeStory(f, (story) => {
        story.steps.push({
          id: "ghost",
          section: "code",
          scene: "nowhere",
          title: "Ghost",
          text: "No such scene.",
        } as never);
        story.steps.push({
          id: "badmark",
          section: "code",
          scene: "a",
          focus: [[2, 2]],
          marks: [{ line: 2, text: ["not here"] }],
          title: "Bad mark",
          text: "x",
        } as never);
        story.steps.push({
          id: "badstate",
          section: "open",
          scene: "flow",
          state: "c",
          title: "Bad state",
          text: "x",
        } as never);
        story.steps.push({
          id: "nofocus",
          section: "code",
          scene: "a",
          focus: [[900, 901]],
          title: "No focus",
          text: "x",
        } as never);
      });
      const r = build(f);
      expect(r.code).toBe(1);
      expect(r.err).toContain("step ghost: no scene nowhere");
      expect(r.err).toContain('step badmark: "not here" is not on line 2');
      expect(r.err).toContain("step badstate: state c is not one of flow's: a, b");
      expect(r.err).toContain("step nofocus: its focus lights no row of a (lines 1 to 6)");
      expect(existsSync(f.out)).toBe(false);
    });
  });

  test("a diagram whose marks name a state it does not declare is refused", () => {
    withFixture((f) => {
      writeFileSync(join(f.storyDir, "flow.svg"), DIAGRAM.replace("on-a", "on-z"));
      const r = build(f);
      expect(r.code).toBe(1);
      expect(r.err).toContain("scene flow: on-z names no state of it");
    });
  });

  test("a ticket line a step searches for must be in exactly one block", () => {
    withFixture((f) => {
      writeStory(f, (story) => {
        const title = story.steps[0];
        if (title) (title as { find?: string[] }).find = ["Two is 22", "not in the ticket"];
      });
      const r = build(f);
      expect(r.code).toBe(1);
      expect(r.err).toContain('step title: "not in the ticket" is in 0 blocks of ticket');
    });
  });

  test("a repeated id and a missing field are refused", () => {
    withFixture((f) => {
      writeStory(f, (story) => {
        story.steps.push({ ...story.steps[1]! } as never);
      });
      const twice = build(f);
      expect(twice.code).toBe(1);
      expect(twice.err).toContain("step boxes is used twice");
      writeFileSync(
        join(f.storyDir, "story.json"),
        JSON.stringify({ ...baseStory(f), ticketLabel: "" }),
      );
      const missing = build(f);
      expect(missing.code).toBe(1);
      expect(missing.err).toContain('story.json: "ticketLabel" is missing');
    });
  });
});

describe("story-change check", () => {
  test("runs every test build runs, writes nothing and prints the same line", () => {
    withFixture((f) => {
      const checked = run(self, ["story-change", "check", f.repo, f.storyDir]);
      expect(checked.code).toBe(0);
      expect(checked.out).toContain("5 steps (Start 2, Code 3)");
      expect(existsSync(f.out)).toBe(false);
      writeStory(f, (story) => {
        story.steps = story.steps.filter((s) => s.id !== "rest");
      });
      const refused = run(self, ["story-change", "check", f.repo, f.storyDir]);
      expect(refused.code).toBe(1);
      expect(refused.err).toContain("no step shows the list of them");
    });
  });
});

describe("story-change usage", () => {
  test("names both commands when the arguments do not fit", () => {
    for (const args of [
      [],
      ["build"],
      ["build", "repo", "story"],
      ["check", "repo"],
      ["check", "repo", "story", "out"],
      ["publish", "a", "b", "c"],
      ["build", "a", "b", "c", "--drop"],
    ]) {
      const r = run(self, ["story-change", ...args]);
      expect(r.code).toBe(1);
      expect(r.err).toContain("usage: story-change.ts build <repo> <story-dir> <out-dir>");
      expect(r.err).toContain("story-change.ts check <repo> <story-dir>");
    }
  });
});
