// Unit tests for the experiments command's core: dates, the replay, the
// due rule and its order, the list shape, the page rows, and the three
// transitions with their refusals.
import { describe, expect, test } from "bun:test";
import {
  applyConclude,
  applyMove,
  applyStart,
  formatList,
  isDue,
  nextId,
  orderRows,
  parseDate,
  pushDocs,
  replay,
  type Experiment,
  type ExperimentEvent,
} from "./experiments.ts";

function running(id: string, look: string, started = "2026-10-01"): Experiment {
  return {
    id,
    question: `${id} asks`,
    levels: ["old", "new"],
    started,
    measure: "minutes",
    look,
    state: "running",
    result: null,
    evidence: null,
    ended: null,
  };
}

function concluded(id: string, look: string, ended: string): Experiment {
  return { ...running(id, look), state: "concluded", result: "won", evidence: null, ended };
}

describe("parseDate", () => {
  test("a real calendar date passes, the rest do not", () => {
    expect(parseDate("2026-10-09")).toBe("2026-10-09");
    expect(parseDate("2026-02-29")).toBe(null);
    expect(parseDate("2024-02-29")).toBe("2024-02-29");
    expect(parseDate("2026-13-01")).toBe(null);
    expect(parseDate("2026-10-32")).toBe(null);
    expect(parseDate("not-a-date")).toBe(null);
    expect(parseDate("2026-10-9")).toBe(null);
    expect(parseDate("")).toBe(null);
  });
});

describe("nextId", () => {
  test("the first id is e1, then one past the highest", () => {
    expect(nextId([])).toBe("e1");
    expect(nextId([running("e1", "2026-10-09")])).toBe("e2");
    expect(nextId([running("e2", "2026-10-09"), running("e9", "2026-10-09")])).toBe("e10");
  });
});

describe("replay", () => {
  test("start, move and conclude fold into one concluded row", () => {
    const events: ExperimentEvent[] = [
      {
        ev: "start",
        id: "e1",
        question: "q",
        levels: ["a", "b"],
        measure: "m",
        started: "2026-10-01",
        look: "2026-10-09",
      },
      { ev: "move", id: "e1", look: "2026-10-10" },
      {
        ev: "conclude",
        id: "e1",
        result: "r",
        evidence: "https://example.invalid/1",
        ended: "2026-10-10",
      },
    ];
    const { rows, error } = replay(events);
    expect(error).toBe(null);
    expect(rows).toEqual([
      {
        id: "e1",
        question: "q",
        levels: ["a", "b"],
        started: "2026-10-01",
        measure: "m",
        look: "2026-10-10",
        state: "concluded",
        result: "r",
        evidence: "https://example.invalid/1",
        ended: "2026-10-10",
      },
    ]);
  });

  test("a move or conclude before the start, or twice over, is corruption", () => {
    const start: ExperimentEvent = {
      ev: "start",
      id: "e1",
      question: "q",
      levels: ["a", "b"],
      measure: "m",
      started: "2026-10-01",
      look: "2026-10-09",
    };
    const conclude: ExperimentEvent = {
      ev: "conclude",
      id: "e1",
      result: "r",
      evidence: null,
      ended: "2026-10-10",
    };
    expect(replay([start, start]).error).toContain("corrupt");
    expect(replay([{ ev: "move", id: "e1", look: "2026-10-10" }]).error).toContain("corrupt");
    expect(replay([conclude]).error).toContain("corrupt");
    expect(replay([start, conclude, conclude]).error).toContain("corrupt");
    expect(replay([start, conclude, { ev: "move", id: "e1", look: "2026-10-11" }]).error).toContain(
      "corrupt",
    );
  });
});

describe("isDue and orderRows", () => {
  test("running on or past its date is due; concluded never is", () => {
    expect(isDue(running("e1", "2026-10-09"), "2026-10-10")).toBe(true);
    expect(isDue(running("e1", "2026-10-10"), "2026-10-10")).toBe(true);
    expect(isDue(running("e1", "2026-10-11"), "2026-10-10")).toBe(false);
    expect(isDue(concluded("e1", "2026-10-09", "2026-10-10"), "2026-10-10")).toBe(false);
  });

  test("due first, then running by date, then concluded newest first", () => {
    const rows = [
      concluded("e4", "2026-10-01", "2026-10-02"),
      running("e1", "2026-10-12"),
      running("e2", "2026-10-09"),
      concluded("e5", "2026-10-01", "2026-10-05"),
      running("e3", "2026-10-10"),
    ];
    expect(orderRows(rows, "2026-10-10").map((r) => r.id)).toEqual(["e2", "e3", "e1", "e5", "e4"]);
  });
});

describe("formatList", () => {
  test("an empty record lists nothing to show", () => {
    expect(formatList([], "2026-10-10")).toBe("no experiments\n");
  });

  test("a block names the id, state, due mark, dates and fields", () => {
    const out = formatList(
      [running("e1", "2026-10-12"), concluded("e2", "2026-10-01", "2026-10-05")],
      "2026-10-10",
    );
    const blocks = out.trimEnd().split("\n\n");
    expect(blocks.length).toBe(2);
    expect(blocks[0]).toContain("e1 running look=2026-10-12 started=2026-10-01");
    expect(blocks[0]).not.toContain("due");
    expect(blocks[0]).toContain("question: e1 asks");
    expect(blocks[0]).toContain("levels: old | new");
    expect(blocks[0]).toContain("measure: minutes");
    expect(blocks[1]).toContain("e2 concluded look=2026-10-01 started=2026-10-01 ended=2026-10-05");
    expect(blocks[1]).toContain("result: won");
  });
});

describe("pushDocs", () => {
  test("every row ships keyed by id, empty record ships empty", () => {
    expect(pushDocs([])).toBe("{}\n");
    const docs = JSON.parse(pushDocs([running("e2", "2026-10-12")])) as Record<
      string,
      Record<string, unknown>
    >;
    expect(Object.keys(docs)).toEqual(["e2"]);
    expect(docs["e2"]).toEqual({
      question: "e2 asks",
      levels: ["old", "new"],
      started: "2026-10-01",
      measure: "minutes",
      look: "2026-10-12",
      state: "running",
      result: null,
      evidence: null,
      ended: null,
    });
  });
});

describe("applyStart", () => {
  test("it starts with the next id and today's start", () => {
    const applied = applyStart(
      [running("e1", "2026-10-09")],
      { question: "q", levels: ["a", "b", "c"], measure: "m", look: "2026-10-11" },
      "2026-10-10",
    );
    expect(applied.error).toBe(null);
    if (applied.event === null) throw new Error("refused a sound start");
    expect(applied.event.ev).toBe("start");
    if (applied.event.ev !== "start") throw new Error("wrong event");
    expect(applied.event.id).toBe("e2");
    expect(applied.event.started).toBe("2026-10-10");
  });

  test("no question, one level, no measure or a bad date is refused", () => {
    const sound = { question: "q", levels: ["a", "b"], measure: "m", look: "2026-10-11" };
    expect(applyStart([], { ...sound, question: "  " }, "2026-10-10").error).toContain("question");
    expect(applyStart([], { ...sound, levels: ["a"] }, "2026-10-10").error).toContain("levels");
    expect(applyStart([], { ...sound, levels: ["a", " "] }, "2026-10-10").error).toContain(
      "levels",
    );
    expect(applyStart([], { ...sound, measure: "" }, "2026-10-10").error).toContain("measure");
    expect(applyStart([], { ...sound, look: "someday" }, "2026-10-10").error).toContain("bad date");
  });
});

describe("applyMove and applyConclude", () => {
  test("they move and conclude, once each", () => {
    const rows = [running("e1", "2026-10-09")];
    const moved = applyMove(rows, "e1", "2026-10-11");
    expect(moved.error).toBe(null);
    expect(moved.event).toEqual({ ev: "move", id: "e1", look: "2026-10-11" });
    const over = applyConclude(rows, "e1", "r", null, "2026-10-10");
    expect(over.error).toBe(null);
    expect(over.event).toEqual({
      ev: "conclude",
      id: "e1",
      result: "r",
      evidence: null,
      ended: "2026-10-10",
    });
  });

  test("an unknown id, a concluded one, no result or a bad date is refused", () => {
    const rows = [running("e1", "2026-10-09"), concluded("e2", "2026-10-01", "2026-10-05")];
    expect(applyMove(rows, "e9", "2026-10-11").error).toContain("no such experiment");
    expect(applyMove(rows, "e2", "2026-10-11").error).toContain("already concluded");
    expect(applyMove(rows, "e1", "someday").error).toContain("bad date");
    expect(applyConclude(rows, "e9", "r", null, "2026-10-10").error).toContain(
      "no such experiment",
    );
    expect(applyConclude(rows, "e2", "r", null, "2026-10-10").error).toContain("already concluded");
    expect(applyConclude(rows, "e1", " ", null, "2026-10-10").error).toContain("result");
  });
});
