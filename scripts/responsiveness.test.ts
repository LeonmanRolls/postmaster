// Controls beside responsiveness.ts: the dequeue spelling a live record
// also uses, and a message whose turn has not ended. Driven through
// scripts/run responsiveness as a subprocess, like the acceptance oracle.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { iso } from "./acceptance-167.ts";
import { beside } from "./lib/paths.ts";
import { run } from "./lib/proc.ts";

const RUN = beside(import.meta, "run");

const withRecord = (rows: Record<string, unknown>[], body: (path: string) => void): void => {
  const dir = mkdtempSync(join(tmpdir(), "responsiveness-"));
  try {
    const path = join(dir, "session.jsonl");
    writeFileSync(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
    body(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe("responsiveness record spellings", () => {
  test("a dequeue delivers a queued message like a remove", () => {
    withRecord(
      [
        { operation: "enqueue", timestamp: iso(0), type: "queue-operation" },
        { operation: "dequeue", timestamp: iso(10), type: "queue-operation" },
        {
          attachment: { origin: { kind: "human" }, type: "queued_command" },
          timestamp: iso(0),
          type: "attachment",
        },
        { subtype: "turn_duration", timestamp: iso(70), type: "system" },
      ],
      (path) => {
        const r = run(RUN, ["responsiveness", path]);
        expect(r.code).toBe(0);
        expect(r.out).toContain("message 1: seen: 10 s; answer: 60 s");
      },
    );
  });

  test("a message with no following turn_duration is not finished", () => {
    withRecord(
      [
        {
          origin: { kind: "human" },
          promptSource: "typed",
          timestamp: iso(0),
          type: "user",
        },
      ],
      (path) => {
        const r = run(RUN, ["responsiveness", path]);
        expect(r.code).toBe(0);
        expect(r.out).toContain("message 1: seen: no wait; answer: not finished");
      },
    );
  });

  test("a task delivery beside an unnamed delivery is not a message", () => {
    withRecord(
      [
        { operation: "enqueue", timestamp: iso(40), type: "queue-operation" },
        { operation: "dequeue", timestamp: iso(41), type: "queue-operation" },
        { operation: "enqueue", timestamp: iso(45), type: "queue-operation" },
        { operation: "remove", timestamp: iso(46), type: "queue-operation" },
        {
          attachment: { origin: { kind: "task-notification" }, type: "queued_command" },
          timestamp: iso(45),
          type: "attachment",
        },
        { subtype: "turn_duration", timestamp: iso(60), type: "system" },
      ],
      (path) => {
        const r = run(RUN, ["responsiveness", path]);
        expect(r.code).toBe(0);
        expect(r.out).toContain("messages: 0");
      },
    );
  });

  test("a queued user row names its pending delivery", () => {
    withRecord(
      [
        { operation: "enqueue", timestamp: iso(0), type: "queue-operation" },
        { operation: "remove", timestamp: iso(10), type: "queue-operation" },
        {
          origin: { kind: "human" },
          promptSource: "queued",
          timestamp: iso(10),
          type: "user",
        },
        { subtype: "turn_duration", timestamp: iso(70), type: "system" },
      ],
      (path) => {
        const r = run(RUN, ["responsiveness", path]);
        expect(r.code).toBe(0);
        expect(r.out).toContain("message 1: seen: unknown; answer: 60 s");
      },
    );
  });

  test("a queued user row does not take a stale delivery from an earlier turn", () => {
    withRecord(
      [
        { operation: "enqueue", timestamp: iso(0), type: "queue-operation" },
        { operation: "remove", timestamp: iso(1), type: "queue-operation" },
        { subtype: "turn_duration", timestamp: iso(10), type: "system" },
        { operation: "enqueue", timestamp: iso(60), type: "queue-operation" },
        { operation: "dequeue", timestamp: iso(65), type: "queue-operation" },
        {
          origin: { kind: "human" },
          promptSource: "queued",
          timestamp: iso(65),
          type: "user",
        },
        { subtype: "turn_duration", timestamp: iso(125), type: "system" },
      ],
      (path) => {
        const r = run(RUN, ["responsiveness", path]);
        expect(r.code).toBe(0);
        expect(r.out).toContain("messages: 1");
        expect(r.out).toContain("message 1: seen: unknown; answer: 60 s");
      },
    );
  });

  test("a keyed delivery pairs with its own attachment, not the oldest enqueue", () => {
    withRecord(
      [
        { operation: "enqueue", timestamp: iso(0), type: "queue-operation" },
        { operation: "enqueue", timestamp: iso(10), type: "queue-operation" },
        {
          commandUuid: "cmd-b",
          operation: "remove",
          timestamp: iso(50),
          type: "queue-operation",
        },
        {
          commandUuid: "cmd-a",
          operation: "remove",
          timestamp: iso(60),
          type: "queue-operation",
        },
        {
          attachment: {
            origin: { kind: "task-notification" },
            source_uuid: "cmd-b",
            type: "queued_command",
          },
          timestamp: iso(10),
          type: "attachment",
        },
        {
          attachment: { origin: { kind: "human" }, source_uuid: "cmd-a", type: "queued_command" },
          timestamp: iso(0),
          type: "attachment",
        },
        { subtype: "turn_duration", timestamp: iso(120), type: "system" },
      ],
      (path) => {
        const r = run(RUN, ["responsiveness", path]);
        expect(r.code).toBe(0);
        expect(r.out).toContain("messages: 1");
        expect(r.out).toContain("message 1: seen: 60 s; answer: 60 s");
      },
    );
  });

  test("a keyed delivery does not spend its enqueue slot on a keyless delivery", () => {
    withRecord(
      [
        { operation: "enqueue", timestamp: iso(0), type: "queue-operation" },
        { operation: "enqueue", timestamp: iso(10), type: "queue-operation" },
        {
          commandUuid: "cmd-a",
          operation: "remove",
          timestamp: iso(20),
          type: "queue-operation",
        },
        { operation: "remove", timestamp: iso(30), type: "queue-operation" },
        {
          attachment: { origin: { kind: "human" }, source_uuid: "cmd-a", type: "queued_command" },
          timestamp: iso(0),
          type: "attachment",
        },
        {
          attachment: { origin: { kind: "human" }, type: "queued_command" },
          timestamp: iso(10),
          type: "attachment",
        },
        { subtype: "turn_duration", timestamp: iso(90), type: "system" },
      ],
      (path) => {
        const r = run(RUN, ["responsiveness", path]);
        expect(r.code).toBe(0);
        expect(r.out).toContain("messages: 2");
        expect(r.out).toContain("message 1: seen: 20 s; answer: 70 s");
        expect(r.out).toContain("message 2: seen: 20 s; answer: 60 s");
      },
    );
  });

  test("an orphan enqueue does not spend the next message's delivery", () => {
    withRecord(
      [
        { operation: "enqueue", timestamp: iso(0), type: "queue-operation" },
        { operation: "enqueue", timestamp: iso(10), type: "queue-operation" },
        { operation: "remove", timestamp: iso(20), type: "queue-operation" },
        {
          attachment: { origin: { kind: "human" }, type: "queued_command" },
          timestamp: iso(10),
          type: "attachment",
        },
        { subtype: "turn_duration", timestamp: iso(50), type: "system" },
      ],
      (path) => {
        const r = run(RUN, ["responsiveness", path]);
        expect(r.code).toBe(0);
        expect(r.out).toContain("messages: 1");
        expect(r.out).toContain("message 1: seen: 10 s; answer: 30 s");
      },
    );
  });

  test("a queued user row does not take a delivery from an earlier turn", () => {
    withRecord(
      [
        { operation: "enqueue", timestamp: iso(0), type: "queue-operation" },
        { operation: "dequeue", timestamp: iso(5), type: "queue-operation" },
        { subtype: "turn_duration", timestamp: iso(10), type: "system" },
        { operation: "enqueue", timestamp: iso(50), type: "queue-operation" },
        {
          origin: { kind: "human" },
          promptSource: "queued",
          timestamp: iso(60),
          type: "user",
        },
        { subtype: "turn_duration", timestamp: iso(100), type: "system" },
      ],
      (path) => {
        const r = run(RUN, ["responsiveness", path]);
        expect(r.code).toBe(0);
        expect(r.out).toContain("message 1: seen: unknown; answer: 40 s");
      },
    );
  });

  test("a human user row with no promptSource is a message", () => {
    withRecord(
      [
        { origin: { kind: "human" }, timestamp: iso(0), type: "user" },
        { subtype: "turn_duration", timestamp: iso(45), type: "system" },
      ],
      (path) => {
        const r = run(RUN, ["responsiveness", path]);
        expect(r.code).toBe(0);
        expect(r.out).toContain("message 1: seen: no wait; answer: 45 s");
      },
    );
  });

  test("a keyed delivery no attachment claims identifies nothing", () => {
    withRecord(
      [
        { operation: "enqueue", timestamp: iso(0), type: "queue-operation" },
        { operation: "enqueue", timestamp: iso(10), type: "queue-operation" },
        {
          commandUuid: "cmd-unclaimed",
          operation: "remove",
          timestamp: iso(20),
          type: "queue-operation",
        },
        { operation: "remove", timestamp: iso(30), type: "queue-operation" },
        {
          attachment: { origin: { kind: "human" }, type: "queued_command" },
          timestamp: iso(0),
          type: "attachment",
        },
        {
          attachment: { origin: { kind: "human" }, type: "queued_command" },
          timestamp: iso(10),
          type: "attachment",
        },
        { subtype: "turn_duration", timestamp: iso(100), type: "system" },
      ],
      (path) => {
        const r = run(RUN, ["responsiveness", path]);
        expect(r.code).toBe(0);
        expect(r.out).toContain("messages: 2");
        expect(r.out).toContain("message 1: seen: unknown; answer: unknown");
        expect(r.out).toContain("message 2: seen: unknown; answer: unknown");
      },
    );
  });

  test("a queued user row names its own enqueue beside an undelivered orphan", () => {
    withRecord(
      [
        { operation: "enqueue", timestamp: iso(0), type: "queue-operation" },
        { operation: "enqueue", timestamp: iso(10), type: "queue-operation" },
        { operation: "remove", timestamp: iso(20), type: "queue-operation" },
        {
          origin: { kind: "human" },
          promptSource: "queued",
          timestamp: iso(20),
          type: "user",
        },
        { subtype: "turn_duration", timestamp: iso(60), type: "system" },
      ],
      (path) => {
        const r = run(RUN, ["responsiveness", path]);
        expect(r.code).toBe(0);
        expect(r.out).toContain("messages: 1");
        expect(r.out).toContain("message 1: seen: unknown; answer: 40 s");
      },
    );
  });

  test("an attachment far from every enqueue stands alone", () => {
    withRecord(
      [
        { operation: "enqueue", timestamp: iso(0), type: "queue-operation" },
        {
          attachment: { origin: { kind: "human" }, type: "queued_command" },
          timestamp: iso(100),
          type: "attachment",
        },
        { subtype: "turn_duration", timestamp: iso(200), type: "system" },
      ],
      (path) => {
        const r = run(RUN, ["responsiveness", path]);
        expect(r.code).toBe(0);
        expect(r.out).toContain("messages: 1");
        expect(r.out).toContain("message 1: seen: unknown; answer: 100 s");
      },
    );
  });

  test("a queued user row beside its own attachment counts once", () => {
    withRecord(
      [
        { operation: "enqueue", timestamp: iso(0), type: "queue-operation" },
        { operation: "remove", timestamp: iso(10), type: "queue-operation" },
        {
          attachment: { origin: { kind: "human" }, type: "queued_command" },
          timestamp: iso(0),
          type: "attachment",
        },
        {
          origin: { kind: "human" },
          promptSource: "queued",
          timestamp: iso(10),
          type: "user",
        },
        { subtype: "turn_duration", timestamp: iso(70), type: "system" },
      ],
      (path) => {
        const r = run(RUN, ["responsiveness", path]);
        expect(r.code).toBe(0);
        expect(r.out).toContain("messages: 1");
        expect(r.out).toContain("message 1: seen: 10 s; answer: 60 s");
      },
    );
  });

  test("an earlier unnamed delivery is not given to a later named message", () => {
    withRecord(
      [
        { operation: "enqueue", timestamp: iso(0), type: "queue-operation" },
        { operation: "remove", timestamp: iso(1), type: "queue-operation" },
        { operation: "enqueue", timestamp: iso(10), type: "queue-operation" },
        { operation: "remove", timestamp: iso(20), type: "queue-operation" },
        {
          attachment: { origin: { kind: "human" }, type: "queued_command" },
          timestamp: iso(10),
          type: "attachment",
        },
        { subtype: "turn_duration", timestamp: iso(70), type: "system" },
      ],
      (path) => {
        const r = run(RUN, ["responsiveness", path]);
        expect(r.code).toBe(0);
        expect(r.out).toContain("messages: 1");
        expect(r.out).toContain("message 1: seen: unknown; answer: unknown");
      },
    );
  });

  test("a remove row for a cancelled message is not a delivery", () => {
    withRecord(
      [
        { operation: "enqueue", timestamp: iso(0), type: "queue-operation" },
        {
          operation: "remove",
          reason: "cleared_on_cancel",
          timestamp: iso(1),
          type: "queue-operation",
        },
        { operation: "enqueue", timestamp: iso(10), type: "queue-operation" },
        { operation: "remove", timestamp: iso(20), type: "queue-operation" },
        {
          attachment: { origin: { kind: "human" }, type: "queued_command" },
          timestamp: iso(10),
          type: "attachment",
        },
        { subtype: "turn_duration", timestamp: iso(70), type: "system" },
      ],
      (path) => {
        const r = run(RUN, ["responsiveness", path]);
        expect(r.code).toBe(0);
        expect(r.out).toContain("messages: 1");
        expect(r.out).toContain("message 1: seen: 10 s; answer: 50 s");
      },
    );
  });

  test("a queued user row beside a standalone attachment counts once", () => {
    withRecord(
      [
        {
          attachment: { origin: { kind: "human" }, type: "queued_command" },
          timestamp: iso(0),
          type: "attachment",
        },
        {
          origin: { kind: "human" },
          promptSource: "queued",
          timestamp: iso(10),
          type: "user",
        },
        { subtype: "turn_duration", timestamp: iso(70), type: "system" },
      ],
      (path) => {
        const r = run(RUN, ["responsiveness", path]);
        expect(r.code).toBe(0);
        expect(r.out).toContain("messages: 1");
        // The row adds nothing beside a standalone attachment, whose
        // answer runs from its own stamp; the row moves nothing.
        expect(r.out).toContain("message 1: seen: unknown; answer: 70 s");
      },
    );
  });

  test("an unknown harness is unsupported in one line", () => {
    withRecord([], (path) => {
      const r = run(RUN, ["responsiveness", path, "--harness", "nope"]);
      expect(r.code).not.toBe(0);
      expect(`${r.out}\n${r.err}`.trim().split("\n")).toHaveLength(1);
      expect(`${r.out}\n${r.err}`).toContain("unsupported");
    });
  });
});

describe("pairing specification corpus", () => {
  const humanAttach = (ts: number, extra: Record<string, unknown> = {}) => ({
    attachment: { origin: { kind: "human" }, type: "queued_command", ...extra },
    timestamp: iso(ts),
    type: "attachment",
  });
  test("an older attachment with no kind is not counted", () => {
    withRecord(
      [
        { operation: "enqueue", timestamp: iso(0), type: "queue-operation" },
        { operation: "remove", timestamp: iso(10), type: "queue-operation" },
        { attachment: { type: "queued_command" }, timestamp: iso(0), type: "attachment" },
        { subtype: "turn_duration", timestamp: iso(70), type: "system" },
      ],
      (path) => {
        expect(run(RUN, ["responsiveness", path]).out).toContain("messages: 0");
      },
    );
  });
  test("channel and peer attachments are not counted", () => {
    withRecord(
      [
        { operation: "enqueue", timestamp: iso(0), type: "queue-operation" },
        { operation: "remove", timestamp: iso(10), type: "queue-operation" },
        {
          attachment: { origin: { kind: "channel" }, type: "queued_command" },
          timestamp: iso(0),
          type: "attachment",
        },
        {
          attachment: { origin: { kind: "peer" }, type: "queued_command" },
          timestamp: iso(0),
          type: "attachment",
        },
        { subtype: "turn_duration", timestamp: iso(70), type: "system" },
      ],
      (path) => {
        expect(run(RUN, ["responsiveness", path]).out).toContain("messages: 0");
      },
    );
  });
  test("a keyless human alone in its turn takes the turn's delivery (E2)", () => {
    withRecord(
      [
        { operation: "enqueue", timestamp: iso(0), type: "queue-operation" },
        { operation: "remove", timestamp: iso(20), type: "queue-operation" },
        humanAttach(0),
        { subtype: "turn_duration", timestamp: iso(80), type: "system" },
      ],
      (path) => {
        expect(run(RUN, ["responsiveness", path]).out).toContain(
          "message 1: seen: 20 s; answer: 60 s",
        );
      },
    );
  });
  test("two keyless humans pending together stay unknown", () => {
    withRecord(
      [
        { operation: "enqueue", timestamp: iso(0), type: "queue-operation" },
        { operation: "enqueue", timestamp: iso(10), type: "queue-operation" },
        { operation: "remove", timestamp: iso(20), type: "queue-operation" },
        { operation: "remove", timestamp: iso(30), type: "queue-operation" },
        humanAttach(0),
        humanAttach(10),
        { subtype: "turn_duration", timestamp: iso(90), type: "system" },
      ],
      (path) => {
        const r = run(RUN, ["responsiveness", path]);
        expect(r.out).toContain("messages: 2");
        expect(r.out).toContain("message 1: seen: unknown; answer: unknown");
        expect(r.out).toContain("message 2: seen: unknown; answer: unknown");
      },
    );
  });
  test("a task candidate keeps a human message's delivery unidentified (E2)", () => {
    withRecord(
      [
        { operation: "enqueue", timestamp: iso(0), type: "queue-operation" },
        { operation: "enqueue", timestamp: iso(10), type: "queue-operation" },
        { operation: "remove", timestamp: iso(20), type: "queue-operation" },
        {
          attachment: { origin: { kind: "task-notification" }, type: "queued_command" },
          timestamp: iso(0),
          type: "attachment",
        },
        humanAttach(10),
        { subtype: "turn_duration", timestamp: iso(90), type: "system" },
      ],
      (path) => {
        const r = run(RUN, ["responsiveness", path]);
        expect(r.out).toContain("messages: 1");
        expect(r.out).toContain("message 1: seen: unknown; answer: unknown");
      },
    );
  });
  test("an unidentified delivery before the candidate is not paired (E2)", () => {
    withRecord(
      [
        { operation: "remove", timestamp: iso(0), type: "queue-operation" },
        { operation: "enqueue", timestamp: iso(10), type: "queue-operation" },
        humanAttach(10),
      ],
      (path) => {
        const r = run(RUN, ["responsiveness", path]);
        expect(r.out).toContain("message 1: seen: unknown; answer: unknown");
      },
    );
  });
  test("a queued row picks neither of two waiting candidates", () => {
    withRecord(
      [
        { operation: "enqueue", timestamp: iso(0), type: "queue-operation" },
        { operation: "enqueue", timestamp: iso(5), type: "queue-operation" },
        { operation: "remove", timestamp: iso(10), type: "queue-operation" },
        humanAttach(0),
        humanAttach(5),
        {
          origin: { kind: "human" },
          promptSource: "queued",
          timestamp: iso(10),
          type: "user",
        },
        { subtype: "turn_duration", timestamp: iso(70), type: "system" },
      ],
      (path) => {
        const r = run(RUN, ["responsiveness", path]);
        // Two candidates wait and one delivery stands: nothing says
        // which message the delivery or the row belongs to.
        expect(r.out).toContain("messages: 2");
        expect(r.out).toContain("message 1: seen: unknown; answer: unknown");
        expect(r.out).toContain("message 2: seen: unknown; answer: unknown");
      },
    );
  });
  test("a queued row does not join a candidate whose delivery is known", () => {
    withRecord(
      [
        { operation: "enqueue", timestamp: iso(0), type: "queue-operation" },
        { operation: "enqueue", timestamp: iso(10), type: "queue-operation" },
        {
          commandUuid: "cmd-a",
          operation: "remove",
          timestamp: iso(30),
          type: "queue-operation",
        },
        {
          attachment: {
            origin: { kind: "human" },
            source_uuid: "cmd-a",
            type: "queued_command",
          },
          timestamp: iso(0),
          type: "attachment",
        },
        humanAttach(10),
        { operation: "remove", timestamp: iso(50), type: "queue-operation" },
        {
          origin: { kind: "human" },
          promptSource: "queued",
          timestamp: iso(50),
          type: "user",
        },
        { subtype: "turn_duration", timestamp: iso(100), type: "system" },
      ],
      (path) => {
        const r = run(RUN, ["responsiveness", path]);
        expect(r.out).toContain("messages: 2");
        expect(r.out).toContain("message 2: seen: 40 s; answer: 50 s");
      },
    );
  });
  test("an attachment and a queued row in different turns are two messages", () => {
    withRecord(
      [
        { operation: "enqueue", timestamp: iso(0), type: "queue-operation" },
        humanAttach(0),
        { subtype: "turn_duration", timestamp: iso(10), type: "system" },
        {
          origin: { kind: "human" },
          promptSource: "queued",
          timestamp: iso(11),
          type: "user",
        },
        { subtype: "turn_duration", timestamp: iso(40), type: "system" },
      ],
      (path) => {
        const r = run(RUN, ["responsiveness", path]);
        // No fallback from one turn to another: the row is a message
        // delivered at its own time, the candidate stays unknown.
        expect(r.out).toContain("messages: 2");
        expect(r.out).toContain("message 1: seen: unknown; answer: 29 s");
        expect(r.out).toContain("message 2: seen: unknown; answer: unknown");
      },
    );
  });
  test("a message never delivered is counted with unknown waits", () => {
    withRecord(
      [{ operation: "enqueue", timestamp: iso(0), type: "queue-operation" }, humanAttach(0)],
      (path) => {
        const r = run(RUN, ["responsiveness", path]);
        expect(r.out).toContain("messages: 1");
        expect(r.out).toContain("message 1: seen: unknown; answer: unknown");
      },
    );
  });
});

describe("pairing properties", () => {
  test("waits are never negative and messages never exceed the counted shapes", async () => {
    const { readResponsiveness } = await import("./responsiveness.ts");
    let seed = 42;
    let queuedRowsTotal = 0;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let trial = 0; trial < 60; trial++) {
      const rows: Record<string, unknown>[] = [];
      let t = 0;
      let humans = 0;
      const steps = 3 + Math.floor(rnd() * 8);
      for (let i = 0; i < steps; i++) {
        t += Math.floor(rnd() * 20);
        const pick = rnd();
        if (pick < 0.3)
          rows.push({ operation: "enqueue", timestamp: iso(t), type: "queue-operation" });
        else if (pick < 0.55)
          rows.push({ operation: "remove", timestamp: iso(t), type: "queue-operation" });
        else if (pick < 0.8) {
          humans++;
          rows.push({
            attachment: { origin: { kind: "human" }, type: "queued_command" },
            timestamp: iso(t),
            type: "attachment",
          });
        } else if (pick < 0.9) {
          queuedRowsTotal++;
          rows.push({
            origin: { kind: "human" },
            promptSource: "queued",
            timestamp: iso(t),
            type: "user",
          });
        } else rows.push({ subtype: "turn_duration", timestamp: iso(t), type: "system" });
      }
      const content = rows.map((r) => JSON.stringify(r)).join("\n");
      const report = readResponsiveness("claude", content);
      for (const m of report.messages) {
        if (m.seenWaitMs !== null) expect(m.seenWaitMs).toBeGreaterThanOrEqual(0);
        if (m.answerWaitMs !== null) expect(m.answerWaitMs).toBeGreaterThanOrEqual(0);
      }
      expect(report.messages.length).toBeLessThanOrEqual(humans + queuedRowsTotal);
      queuedRowsTotal = 0;
    }
  });
});

describe("round 8 closure", () => {
  test("a queued row does not overwrite a keyed delivery", () => {
    withRecord(
      [
        {
          attachment: {
            origin: { kind: "human" },
            source_uuid: "cmd-x",
            type: "queued_command",
          },
          timestamp: iso(100),
          type: "attachment",
        },
        {
          commandUuid: "cmd-x",
          operation: "remove",
          timestamp: iso(110),
          type: "queue-operation",
        },
        {
          origin: { kind: "human" },
          promptSource: "queued",
          timestamp: iso(120),
          type: "user",
        },
        { subtype: "turn_duration", timestamp: iso(200), type: "system" },
      ],
      (path) => {
        const r = run(RUN, ["responsiveness", path]);
        expect(r.out).toContain("messages: 1");
        expect(r.out).toContain("message 1: seen: 10 s; answer: 90 s");
      },
    );
  });
});

describe("round 8 row matching", () => {
  const humanAttach = (ts: number) => ({
    attachment: { origin: { kind: "human" }, type: "queued_command" },
    timestamp: iso(ts),
    type: "attachment",
  });
  test("E2 pairs within a turn and never reaches into an earlier one", () => {
    withRecord(
      [
        { operation: "enqueue", timestamp: iso(0), type: "queue-operation" },
        humanAttach(0),
        { subtype: "turn_duration", timestamp: iso(30), type: "system" },
        { subtype: "turn_duration", timestamp: iso(40), type: "system" },
        { operation: "enqueue", timestamp: iso(50), type: "queue-operation" },
        humanAttach(50),
        { operation: "remove", timestamp: iso(55), type: "queue-operation" },
        {
          origin: { kind: "human" },
          promptSource: "queued",
          timestamp: iso(55),
          type: "user",
        },
        { subtype: "turn_duration", timestamp: iso(100), type: "system" },
      ],
      (path) => {
        const r = run(RUN, ["responsiveness", path]);
        expect(r.out).toContain("messages: 2");
        expect(r.out).toContain("message 1: seen: 5 s; answer: 45 s");
        expect(r.out).toContain("message 2: seen: unknown; answer: unknown");
      },
    );
  });
  test("two deliveries are not paired with two candidates by order", () => {
    withRecord(
      [
        { operation: "enqueue", timestamp: iso(0), type: "queue-operation" },
        humanAttach(0),
        { operation: "enqueue", timestamp: iso(50), type: "queue-operation" },
        humanAttach(50),
        { operation: "remove", timestamp: iso(60), type: "queue-operation" },
        { operation: "remove", timestamp: iso(200), type: "queue-operation" },
        {
          origin: { kind: "human" },
          promptSource: "queued",
          timestamp: iso(200),
          type: "user",
        },
        { subtype: "turn_duration", timestamp: iso(300), type: "system" },
      ],
      (path) => {
        const r = run(RUN, ["responsiveness", path]);
        // Two candidates wait and two deliveries stand: order in the
        // file is not evidence, so both stay unknown.
        expect(r.out).toContain("messages: 2");
        expect(r.out).toContain("message 1: seen: unknown; answer: unknown");
        expect(r.out).toContain("message 2: seen: unknown; answer: unknown");
      },
    );
  });
  test("a keyed pair at a shared stamp leaves the keyless candidate unknown", () => {
    withRecord(
      [
        { operation: "enqueue", timestamp: iso(0), type: "queue-operation" },
        humanAttach(0),
        {
          attachment: {
            origin: { kind: "human" },
            source_uuid: "cmd-u",
            type: "queued_command",
          },
          timestamp: iso(0),
          type: "attachment",
        },
        {
          commandUuid: "cmd-u",
          operation: "remove",
          timestamp: iso(30),
          type: "queue-operation",
        },
        { subtype: "turn_duration", timestamp: iso(100), type: "system" },
      ],
      (path) => {
        const r = run(RUN, ["responsiveness", path]);
        expect(r.out).toContain("messages: 2");
        expect(r.out).toContain("seen: 30 s; answer: 70 s");
        expect(r.out).toContain("seen: unknown; answer: unknown");
      },
    );
  });
});

describe("round 9 closure", () => {
  test("an unclaimed keyed delivery stays out of the E2 pool", () => {
    withRecord(
      [
        { operation: "enqueue", timestamp: iso(0), type: "queue-operation" },
        {
          attachment: { origin: { kind: "human" }, type: "queued_command" },
          timestamp: iso(0),
          type: "attachment",
        },
        {
          commandUuid: "cmd-orphan",
          operation: "remove",
          timestamp: iso(20),
          type: "queue-operation",
        },
        { subtype: "turn_duration", timestamp: iso(90), type: "system" },
      ],
      (path) => {
        const r = run(RUN, ["responsiveness", path]);
        expect(r.out).toContain("message 1: seen: unknown; answer: unknown");
      },
    );
  });
});

describe("round 9 row pairing", () => {
  const humanAttach = (ts: number) => ({
    attachment: { origin: { kind: "human" }, type: "queued_command" },
    timestamp: iso(ts),
    type: "attachment",
  });
  test("deliveries are not paired with candidates in queue order", () => {
    withRecord(
      [
        { operation: "enqueue", timestamp: iso(0), type: "queue-operation" },
        humanAttach(0),
        { operation: "enqueue", timestamp: iso(10), type: "queue-operation" },
        humanAttach(10),
        { operation: "remove", timestamp: iso(20), type: "queue-operation" },
        { operation: "remove", timestamp: iso(61), type: "queue-operation" },
        {
          origin: { kind: "human" },
          promptSource: "queued",
          timestamp: iso(61),
          type: "user",
        },
        { subtype: "turn_duration", timestamp: iso(100), type: "system" },
      ],
      (path) => {
        const r = run(RUN, ["responsiveness", path]);
        expect(r.out).toContain("messages: 2");
        expect(r.out).toContain("message 1: seen: unknown; answer: unknown");
        expect(r.out).toContain("message 2: seen: unknown; answer: unknown");
      },
    );
  });
  test("a queued row beside a candidate spends no delivery for it", () => {
    withRecord(
      [
        { operation: "remove", timestamp: iso(10), type: "queue-operation" },
        {
          origin: { kind: "human" },
          promptSource: "queued",
          timestamp: iso(10),
          type: "user",
        },
        { operation: "enqueue", timestamp: iso(20), type: "queue-operation" },
        humanAttach(20),
        { operation: "remove", timestamp: iso(50), type: "queue-operation" },
        { subtype: "turn_duration", timestamp: iso(100), type: "system" },
      ],
      (path) => {
        const r = run(RUN, ["responsiveness", path]);
        // Two deliveries stand in the turn, so E2 pairs neither; the
        // row is the counted candidate's other form and adds nothing.
        expect(r.out).toContain("messages: 1");
        expect(r.out).toContain("message 1: seen: unknown; answer: unknown");
      },
    );
  });
  test("a later queued row is not absorbed by an earlier delivered message", () => {
    withRecord(
      [
        {
          attachment: {
            origin: { kind: "human" },
            source_uuid: "k1",
            type: "queued_command",
          },
          timestamp: iso(0),
          type: "attachment",
        },
        {
          commandUuid: "k1",
          operation: "remove",
          timestamp: iso(10),
          type: "queue-operation",
        },
        { subtype: "turn_duration", timestamp: iso(20), type: "system" },
        { operation: "remove", timestamp: iso(100), type: "queue-operation" },
        {
          origin: { kind: "human" },
          promptSource: "queued",
          timestamp: iso(100),
          type: "user",
        },
        { subtype: "turn_duration", timestamp: iso(130), type: "system" },
      ],
      (path) => {
        const r = run(RUN, ["responsiveness", path]);
        expect(r.out).toContain("messages: 2");
      },
    );
  });
});

describe("pure per-turn pairing", () => {
  test("a queued row alone is a message delivered at its own time", () => {
    withRecord(
      [
        {
          origin: { kind: "human" },
          promptSource: "queued",
          timestamp: iso(15),
          type: "user",
        },
        { subtype: "turn_duration", timestamp: iso(75), type: "system" },
      ],
      (path) => {
        const r = run(RUN, ["responsiveness", path]);
        expect(r.out).toContain("messages: 1");
        expect(r.out).toContain("message 1: seen: unknown; answer: 60 s");
      },
    );
  });
  test("rows beyond a turn's human candidates are messages with unknown waits", () => {
    withRecord(
      [
        {
          attachment: {
            origin: { kind: "human" },
            source_uuid: "cmd-a",
            type: "queued_command",
          },
          timestamp: iso(0),
          type: "attachment",
        },
        {
          commandUuid: "cmd-a",
          operation: "remove",
          timestamp: iso(10),
          type: "queue-operation",
        },
        {
          origin: { kind: "human" },
          promptSource: "queued",
          timestamp: iso(10),
          type: "user",
        },
        {
          origin: { kind: "human" },
          promptSource: "queued",
          timestamp: iso(20),
          type: "user",
        },
        { subtype: "turn_duration", timestamp: iso(80), type: "system" },
      ],
      (path) => {
        const r = run(RUN, ["responsiveness", path]);
        expect(r.out).toContain("messages: 2");
        expect(r.out).toContain("message 1: seen: 10 s; answer: 70 s");
        expect(r.out).toContain("message 2: seen: unknown; answer: unknown");
      },
    );
  });
  test("turn ends listed out of order still end the turn at the earliest", () => {
    withRecord(
      [
        {
          origin: { kind: "human" },
          promptSource: "typed",
          timestamp: iso(0),
          type: "user",
        },
        { subtype: "turn_duration", timestamp: iso(200), type: "system" },
        { subtype: "turn_duration", timestamp: iso(70), type: "system" },
      ],
      (path) => {
        const r = run(RUN, ["responsiveness", path]);
        expect(r.out).toContain("message 1: seen: no wait; answer: 70 s");
      },
    );
  });
});

describe("round 10 closure", () => {
  test("a keyed message delivered at the next turn's start counts once", () => {
    withRecord(
      [
        {
          commandUuid: "cmd-x",
          operation: "enqueue",
          timestamp: iso(0),
          type: "queue-operation",
        },
        {
          attachment: {
            origin: { kind: "human" },
            source_uuid: "cmd-x",
            type: "queued_command",
          },
          timestamp: iso(0),
          type: "attachment",
        },
        { subtype: "turn_duration", timestamp: iso(30), type: "system" },
        {
          commandUuid: "cmd-x",
          operation: "remove",
          timestamp: iso(31),
          type: "queue-operation",
        },
        {
          origin: { kind: "human" },
          promptSource: "queued",
          timestamp: iso(31),
          type: "user",
        },
        { subtype: "turn_duration", timestamp: iso(60), type: "system" },
      ],
      (path) => {
        const r = run(RUN, ["responsiveness", path]);
        expect(r.out).toContain("messages: 1");
        expect(r.out).toContain("message 1: seen: 31 s; answer: 29 s");
      },
    );
  });
  test("a human row with an unlisted promptSource is not counted", () => {
    withRecord(
      [
        {
          origin: { kind: "human" },
          promptSource: "command",
          timestamp: iso(0),
          type: "user",
        },
        { subtype: "turn_duration", timestamp: iso(30), type: "system" },
      ],
      (path) => {
        expect(run(RUN, ["responsiveness", path]).out).toContain("messages: 0");
      },
    );
  });
});
