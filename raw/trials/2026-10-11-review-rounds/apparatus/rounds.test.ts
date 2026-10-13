import { describe, expect, test } from "bun:test";
import { parseActions } from "../../2026-10-03-lane-audit/apparatus/parse.ts";
import {
  findingsOf,
  findingText,
  redactSamples,
  reviewEndedAt,
  roundsInActions,
  roundsInFileNames,
  seriousByRound,
  silentRounds,
} from "./rounds.ts";

const line = (
  action: string,
  target: string,
  detail: string,
  ts = "2026-10-08T19:02:00Z",
): string =>
  JSON.stringify({ ts, project: "p", run: "1", actor: "coachman", action, target, detail });

const log = (...lines: string[]) => parseActions(lines.join("\n")).actions;

describe("serious findings by round", () => {
  const actions = log(
    line("finding", "a.ts:1", "gating P2 r1 bug luna, verified by execution: one"),
    line("finding", "a.ts:2", "gating P1 r1 security opus, verified by reading: two"),
    line("finding", "a.ts:3", "gating P3 r1 style mimo, verified by reading: three"),
    line("finding", "a.ts:4", "style P2 r1 style luna, verified by reading: four"),
    line("finding", "a.ts:5", "gating P2 r2 bug luna DISMISSED, verified by reading: five"),
    line("finding", "a.ts:6", "gating P2 r2 bug haiku, verified by reading: six"),
  );

  test("counts a gating P1 or P2 in the round its line names (positive control)", () => {
    const counts = seriousByRound(findingsOf(actions));
    expect(counts.byRound.get(1)).toBe(2);
    expect(counts.byRound.get(2)).toBe(1);
    expect(counts.total).toBe(3);
  });

  test("a run with only P3 and style lines reads zero through the same command (negative control)", () => {
    const quiet = log(
      line("finding", "a.ts:3", "gating P3 r1 style mimo, verified by reading: three"),
      line("finding", "a.ts:4", "style P2 r1 style luna, verified by reading: four"),
    );
    const counts = seriousByRound(findingsOf(quiet));
    expect(counts.total).toBe(0);
    expect(counts.byRound.size).toBe(0);
  });

  test("a line that names no round is in the total and in no round", () => {
    const counts = seriousByRound(
      findingsOf(log(line("finding", "a.ts:1", "gating P2 bug luna: x"))),
    );
    expect(counts.total).toBe(1);
    expect(counts.noRound).toBe(1);
    expect(counts.byRound.size).toBe(0);
  });

  test("a line from before the class word existed, which opens with its severity, is gating", () => {
    const old = findingsOf(log(line("finding", "a.sh:1", "P2 round1 bug+luna execution: x")));
    expect(old[0]?.class).toBe("gating");
    expect(old[0]?.serious).toBe(true);
  });

  test("a severity in the target stands where the line has none", () => {
    const f = findingsOf(
      log(line("finding", "O1 P1 PEM body survives scrub", "gating r4 opus execution: x")),
    );
    expect(f[0]?.severity).toBe("P1");
    expect(f[0]?.serious).toBe(true);
  });
});

describe("rounds", () => {
  test("the highest round any launch, harvest or finding line names", () => {
    const actions = log(
      line("review-launch", "luna", "bug round 1"),
      line("review-harvest", "luna", "bug round 2, thread x"),
      line("finding", "a.ts:1", "gating P2 r3 bug luna: x"),
    );
    expect(roundsInActions(actions)).toBe(3);
  });

  test("a run that names no round reads 0", () => {
    expect(roundsInActions(log(line("note", "x", "nothing")))).toBe(0);
  });

  test("the highest round a review file name carries", () => {
    expect(
      roundsInFileNames([
        "review-r2-bug-luna-prompt.txt",
        "review-r9.json",
        "luna.done",
        "review-style-brief.md",
      ]),
    ).toBe(9);
    expect(roundsInFileNames(["luna.done"])).toBe(0);
  });

  test("silent rounds are rounds 2 to the last but one with no serious finding", () => {
    expect(
      silentRounds(
        5,
        new Map([
          [1, 4],
          [2, 1],
          [4, 2],
        ]),
      ),
    ).toEqual([3]);
    expect(silentRounds(2, new Map())).toEqual([]);
    expect(silentRounds(3, new Map([[2, 1]]))).toEqual([]);
  });
});

describe("a finding's text and the review's end", () => {
  test("the text after the colon, else the slug", () => {
    expect(findingText("gating P2 r2 bug luna, verified by reading: the text here")).toBe(
      "the text here",
    );
    expect(findingText("gating P2 r2 bug mimo verified-by-execution failed-host-resume")).toBe(
      "failed host resume",
    );
    expect(findingText("gating P2 r1 bug luna, verified by execution")).toBe("");
  });

  test("the review ended at the first stage line that names shipping", () => {
    const actions = log(
      line("stage", "review", "", "2026-10-08T17:33:00Z"),
      line("stage", "shipping", "", "2026-10-09T10:49:00Z"),
      line("stage", "done", "", "2026-10-09T11:37:00Z"),
    );
    expect(reviewEndedAt(actions)).toBe("2026-10-09T10:49:00Z");
    expect(reviewEndedAt(log(line("stage", "review", "")))).toBeNull();
  });
});

describe("quoted example data", () => {
  // The samples are assembled here so that no line of this file is itself a sample of personal data.
  const address = ["john", "acme.com"].join("@");
  const sentence = ["her", "can" + "cer", "came back"].join(" ");
  test("an address and a sentence about someone's health are replaced (positive control)", () => {
    expect(redactSamples(`blanks real addresses; const E = /${address}/ passes`)).toContain(
      "<email>",
    );
    expect(redactSamples(`prefilter drops lines ('${sentence}' exits 0)`)).toContain("<sample>");
    expect(redactSamples(`'${sentence}' exits 0`)).not.toContain("came back");
  });
  test("ordinary text is left alone (negative control)", () => {
    const t = "the reader drops a line that holds 'two words' and a path scripts/a.ts:12";
    expect(redactSamples(t)).toBe(t);
  });
});
