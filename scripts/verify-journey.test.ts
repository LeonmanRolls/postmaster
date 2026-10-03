// Tests beside scripts/verify-journey.ts, moved from its --self-test on #109: 35 controls.
// The self-test staged shared state between controls (armed reports, a second commit); each
// test below stages its own directories so it passes alone as well as in file order.
// The spaced-path control re-runs this file with bun test instead of --self-test. Conditional
// controls are gated by test.skipIf with a top notice.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toolRoot } from "./lib/paths.ts";
import { run } from "./lib/proc.ts";
import {
  BREAK_HEAD,
  FENCE,
  HEADING,
  ITEM,
  JOURNEY_HEAD,
  norm,
  SENT_SPLIT,
  SHOT,
  SHOT_GUARD,
  TICKET_HEAD,
  VERDICT_GUARD,
} from "./verify-journey.ts";

const SELF = join(import.meta.dir, "run");
const BASE_BLOB = "bb782a973e69427c820ce16a676718e87f51995b:scripts/verify-journey.sh";

const hasPy = run("sh", ["-c", "command -v python3"]).code === 0;
const baseShown = run("git", ["-C", toolRoot(import.meta), "show", BASE_BLOB]);
const foldSkip = !hasPy || baseShown.code !== 0;
if (foldSkip) {
  console.log(
    `skip step matching folds as BASE's norm does: ${!hasPy ? "python3 not on PATH: the casefold step match was not compared" : "BASE could not be extracted here: the casefold step match was not compared"}`,
  );
}
const spacedDone = process.env.POSTMASTER_SPACED_DONE === "1";
if (spacedDone) {
  console.log(
    "skip the self-test passes from a path with a space: POSTMASTER_SPACED_DONE is set (nested run)",
  );
}

let tmp = "";
let wt = "";

const S1 = "On the board, the user taps `Add task` and types `buy milk.` into the box.";
const S2 = "They press Enter and see the task at the top of the list!";

const report = (f: string, ...groups: string[]): void => {
  writeFileSync(f, "", "utf8");
  for (let i = 0; i + 2 < groups.length + 1; i += 3) {
    const h = groups[i] ?? "";
    const v = groups[i + 1] ?? "";
    const s = groups[i + 2] ?? "";
    if (!h) break;
    writeFileSync(f, `## ${h}\n${v}\nscreenshot: ${s}\n\n`, { encoding: "utf8", flag: "a" });
  }
};

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "postmaster-"));
  wt = join(tmp, "app");
  mkdirSync(wt, { recursive: true });
  run("git", ["-C", wt, "init", "-q", "-b", "main"]);
  run("git", [
    "-C",
    wt,
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@t",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "first",
  ]);

  const shots = join(tmp, "shots");
  mkdirSync(shots, { recursive: true });
  writeFileSync(join(shots, "1.png"), "png", "utf8");
  writeFileSync(join(shots, "2.png"), "png", "utf8");
  writeFileSync(join(shots, "empty.png"), "", "utf8");

  const prose = `# Waybill: T-1

## Ticket
## User journey
On the board, the user taps \`Add task\` and types \`buy milk.\` into the box.
They press Enter and see the task at the top of the list!

\`\`\`
$ this fenced block is not a step.
\`\`\`

## Project profile
repo: /somewhere
`;
  const list = `## User journey
1. The user opens the board.
2. They tap \`Add task\`
   and type a title.
## Notes
Not a step.
`;
  writeFileSync(join(tmp, "prose.md"), prose, "utf8");
  writeFileSync(join(tmp, "list.md"), list, "utf8");

  report(join(tmp, "good.md"), S1, "did", "shots/1.png", S2, "did", "shots/2.png");
  report(
    join(tmp, "loose.md"),
    "on the board,  the user taps `Add task` and types `buy milk.` into the box",
    "did",
    "shots/1.png",
    S2,
    "did",
    "shots/2.png",
    "A check of my own",
    "did not: it is only mine",
    "shots/1.png",
  );
  report(
    join(tmp, "didnot.md"),
    S1,
    "did",
    "shots/1.png",
    S2,
    "did not: the list stayed empty",
    "shots/2.png",
  );
  report(join(tmp, "missing.md"), S1, "did", "shots/1.png");
  report(join(tmp, "order.md"), S2, "did", "shots/2.png", S1, "did", "shots/1.png");
  report(join(tmp, "noshot.md"), S1, "did", "shots/1.png", S2, "did", "shots/none.png");
  report(join(tmp, "emptyshot.md"), S1, "did", "shots/1.png", S2, "did", "shots/empty.png");
  report(join(tmp, "noverdict.md"), S1, "did", "shots/1.png", S2, "looked fine", "shots/2.png");
  report(
    join(tmp, "listgood.md"),
    "The user opens the board.",
    "did",
    "shots/1.png",
    "They tap `Add task` and type a title.",
    "did",
    "shots/2.png",
  );

  const crlf = (s: string): string => s.split("\n").join("\r\n");
  writeFileSync(join(tmp, "prose-crlf.md"), crlf(prose), "utf8");
  writeFileSync(
    join(tmp, "good-crlf.md"),
    crlf(readFileSync(join(tmp, "good.md"), "utf8")),
    "utf8",
  );
  writeFileSync(join(tmp, "list-crlf.md"), crlf(list), "utf8");
  writeFileSync(
    join(tmp, "listgood-crlf.md"),
    crlf(readFileSync(join(tmp, "listgood.md"), "utf8")),
    "utf8",
  );

  mkdirSync(join(tmp, "r"), { recursive: true });
  report(
    join(tmp, "r", "outside.md"),
    S1,
    "did",
    join(shots, "1.png"),
    S2,
    "did",
    "../shots/2.png",
  );
  writeFileSync(join(tmp, "nojourney.md"), "## Problem / feature\nNo journey here.\n", "utf8");
  writeFileSync(join(tmp, "emptyjourney.md"), "## User journey\n\n## Notes\nx\n", "utf8");
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const judge = (ticket: string, rep: string): { code: number; out: string } => {
  const args = ["verify-journey", wt, "--ticket", ticket];
  if (rep) args.push("--report", rep);
  const r = run(SELF, args);
  return { code: r.code, out: r.out + r.err };
};

const checkJudge = (
  ticket: string,
  rep: string,
  exit: number,
  wantIn?: string,
): { code: number; out: string } => {
  const r = judge(ticket, rep);
  expect(r.code).toBe(exit);
  if (wantIn !== undefined && wantIn !== "") expect(r.out.includes(wantIn)).toBe(true);
  return r;
};

const judgeArmed = (name: string, withShots: boolean): { code: number; out: string } => {
  const jDir = join(tmp, name);
  const specDir = join(tmp, `${name}-spec`);
  mkdirSync(jDir, { recursive: true });
  mkdirSync(specDir, { recursive: true });
  const p = run(SELF, ["verify-journey", "--path", wt, "--dir", jDir]).out.trim();
  cpSync(join(tmp, "good.md"), p);
  writeFileSync(join(specDir, "spec.json"), `${JSON.stringify({ journey_dir: jDir })}\n`, "utf8");
  if (withShots) {
    mkdirSync(join(jDir, "shots"), { recursive: true });
    cpSync(join(tmp, "shots", "1.png"), join(jDir, "shots", "1.png"));
    cpSync(join(tmp, "shots", "2.png"), join(jDir, "shots", "2.png"));
  }
  const r = run("bash", [
    "-c",
    `cd "${wt}" && POSTMASTER_VERIFY="${specDir}" "${SELF}" verify-journey --ticket "${join(tmp, "prose.md")}"`,
  ]);
  return { code: r.code, out: r.out + r.err };
};

describe("positive controls", () => {
  test("a complete report passes", () => {
    checkJudge(join(tmp, "prose.md"), join(tmp, "good.md"), 0, "all 2 steps walked");
  });

  test("case, spacing, a closing stop and steps of its own do not matter", () => {
    checkJudge(join(tmp, "prose.md"), join(tmp, "loose.md"), 0, "all 2 steps walked");
  });

  test("a list's items are its steps, continuation lines included", () => {
    checkJudge(join(tmp, "list.md"), join(tmp, "listgood.md"), 0, "all 2 steps walked");
  });

  test("windows endings pass, ticket and report alike", () => {
    checkJudge(join(tmp, "prose-crlf.md"), join(tmp, "good-crlf.md"), 0, "all 2 steps walked");
  });

  test("windows endings pass for a list's items too", () => {
    checkJudge(join(tmp, "list-crlf.md"), join(tmp, "listgood-crlf.md"), 0, "all 2 steps walked");
  });

  test("the report's path names the commit", () => {
    const r = run(SELF, ["verify-journey", "--path", wt, "--dir", join(tmp, "j")]);
    const head = run("git", ["-C", wt, "rev-parse", "HEAD"]);
    expect(r.out.trim()).toBe(join(tmp, "j", `${head.out.trim()}.md`));
  });

  test("the report for HEAD is found through the armed checks", () => {
    const r = judgeArmed("j-no-shots", false);
    expect(r.code).toBe(3);
    expect(r.out.includes("no screenshot beside the report")).toBe(true);
  });

  test("and passes once its screenshots are beside it", () => {
    expect(judgeArmed("j-shots", true).code).toBe(0);
  });

  test("the format says how a step is marked", () => {
    const r = run(SELF, ["verify-journey", "--format"]);
    expect(r.out.includes("did not: <what happened instead>")).toBe(true);
  });
});

describe("negative controls", () => {
  test("a step marked did not fails, and says what happened", () => {
    checkJudge(join(tmp, "prose.md"), join(tmp, "didnot.md"), 1, "the list stayed empty");
  });

  test("a step not in the report is not run", () => {
    checkJudge(join(tmp, "prose.md"), join(tmp, "missing.md"), 3, "step 2 not walked");
  });

  test("steps out of order are not run", () => {
    checkJudge(join(tmp, "prose.md"), join(tmp, "order.md"), 3, "not walked");
  });

  test("a missing screenshot is not run", () => {
    checkJudge(join(tmp, "prose.md"), join(tmp, "noshot.md"), 3, "no screenshot beside the report");
  });

  test("an empty screenshot is not run", () => {
    checkJudge(
      join(tmp, "prose.md"),
      join(tmp, "emptyshot.md"),
      3,
      "no screenshot beside the report",
    );
  });

  test("a screenshot outside the report's directory is not run", () => {
    checkJudge(
      join(tmp, "prose.md"),
      join(tmp, "r", "outside.md"),
      3,
      "step 1 has no screenshot beside the report",
    );
  });

  test("a step with no verdict is not run", () => {
    checkJudge(join(tmp, "prose.md"), join(tmp, "noverdict.md"), 3, "has no verdict");
  });

  test("no report is not run", () => {
    checkJudge(join(tmp, "prose.md"), join(tmp, "none.md"), 3, "no journey report at");
  });

  test("a ticket with no User journey is not run", () => {
    checkJudge(join(tmp, "nojourney.md"), join(tmp, "good.md"), 3, "has no User journey");
  });

  test("a User journey with no steps is not run", () => {
    checkJudge(join(tmp, "emptyjourney.md"), join(tmp, "good.md"), 3, "has no steps");
  });

  test("a walk of an earlier commit does not count for a later one", () => {
    const jDir = join(tmp, "j-older");
    const specDir = join(tmp, "j-older-spec");
    mkdirSync(jDir, { recursive: true });
    mkdirSync(specDir, { recursive: true });
    const p = run(SELF, ["verify-journey", "--path", wt, "--dir", jDir]).out.trim();
    cpSync(join(tmp, "good.md"), p);
    mkdirSync(join(jDir, "shots"), { recursive: true });
    cpSync(join(tmp, "shots", "1.png"), join(jDir, "shots", "1.png"));
    cpSync(join(tmp, "shots", "2.png"), join(jDir, "shots", "2.png"));
    writeFileSync(join(specDir, "spec.json"), `${JSON.stringify({ journey_dir: jDir })}\n`, "utf8");
    run("git", [
      "-C",
      wt,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "second",
    ]);
    const r = run("bash", [
      "-c",
      `cd "${wt}" && POSTMASTER_VERIFY="${specDir}" "${SELF}" verify-journey --ticket "${join(tmp, "prose.md")}"`,
    ]);
    const out = r.out + r.err;
    expect(r.code).toBe(3);
    expect(out.includes("no journey report at")).toBe(true);
  });

  test.skipIf(foldSkip)(
    "step matching folds as BASE's norm does, ß/İ/ς alike",
    () => {
      const baseVj = join(tmp, "base-verify-journey.sh");
      writeFileSync(baseVj, baseShown.out);
      writeFileSync(
        join(tmp, "fold-ticket.md"),
        "## User journey\n1. Visit the STRASSE kiosk.\n2. Read the ςummary on DBΣ.\n3. Tap İleri.\n",
        "utf8",
      );
      report(
        join(tmp, "fold-report.md"),
        "Visit the Straße kiosk",
        "did",
        "shots/1.png",
        "Read the σummary on DBσ",
        "did",
        "shots/1.png",
        "Tap İleri",
        "did",
        "shots/1.png",
      );
      const args = (bin: string): string[] => [
        bin,
        wt,
        "--ticket",
        join(tmp, "fold-ticket.md"),
        "--report",
        join(tmp, "fold-report.md"),
      ];
      const base = run("bash", args(baseVj));
      const port = run(SELF, ["verify-journey", ...args(SELF).slice(1)]);
      const walked = (r: { code: number; out: string; err: string }): boolean =>
        r.code === 0 && `${r.out}${r.err}`.includes("all 3 steps walked");
      expect(walked(base) && walked(port)).toBe(true);
    },
    60000,
  );

  test.skipIf(spacedDone)(
    "the self-test passes from a path with a space",
    () => {
      const spaced = join(tmp, "my dir", "scripts");
      cpSync(import.meta.dir, spaced, { recursive: true });
      cpSync(join(import.meta.dir, "..", "bunfig.toml"), join(spaced, "..", "bunfig.toml"));
      const r = run("bun", ["test", join(spaced, "verify-journey.test.ts")], {
        env: { ...process.env, POSTMASTER_SPACED_DONE: "1" },
      });
      expect(r.code).toBe(0);
    },
    180000,
  );
});

describe("unicode primitives", () => {
  test("ITEM takes a U+001C gap like BASE", () => {
    expect(ITEM.test("1.\x1citem")).toBe(true);
  });

  test("ITEM takes an Arabic-Indic number like BASE", () => {
    expect(ITEM.test("\u0661. item")).toBe(true);
  });

  test("HEADING takes a NEL gap like BASE", () => {
    expect(HEADING.test("##\u0085T")).toBe(true);
  });

  test("FENCE takes a U+001C indent like BASE", () => {
    expect(FENCE.test("\x1c```")).toBe(true);
  });

  test("norm splits U+001C like BASE", () => {
    expect(norm("a\x1cb")).toBe("a b");
  });

  test("TICKET_HEAD takes a NEL gap like BASE", () => {
    expect(TICKET_HEAD.test("##\u0085Ticket")).toBe(true);
  });

  test("JOURNEY_HEAD takes a trailing U+001C like BASE", () => {
    expect(JOURNEY_HEAD.test("## User journey\x1c")).toBe(true);
  });

  test("BREAK_HEAD takes a U+001C gap like BASE", () => {
    expect(BREAK_HEAD.test("##\x1cx")).toBe(true);
  });

  test("sentences split after U+001C like BASE", () => {
    expect("x.\x1cy".match(SENT_SPLIT)?.length).toBe(1);
  });

  test("the verdict guard takes a U+001C indent like BASE", () => {
    expect(VERDICT_GUARD.test("\x1cdid")).toBe(true);
  });

  test("the verdict guard refuses did+long-s like BASE", () => {
    expect(VERDICT_GUARD.test("did\u017fx")).toBe(false);
  });

  test("the shot takes a NEL gap like BASE", () => {
    expect(SHOT.exec("screenshot:\u0085p")?.[1]).toBe("p");
  });

  test("the shot guard refuses a lone U+001C like BASE", () => {
    expect(SHOT_GUARD.test("screenshot:\x1c")).toBe(false);
  });
});
