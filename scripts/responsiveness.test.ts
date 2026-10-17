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
        expect(r.out).toContain("message 1: seen: 10 s; answer: 60 s");
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
        expect(r.out).toContain("message 1: seen: 5 s; answer: 60 s");
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
        expect(r.out).toContain("message 1: seen: no wait; answer: 40 s");
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

  test("an unknown harness is unsupported in one line", () => {
    withRecord([], (path) => {
      const r = run(RUN, ["responsiveness", path, "--harness", "nope"]);
      expect(r.code).not.toBe(0);
      expect(`${r.out}\n${r.err}`.trim().split("\n")).toHaveLength(1);
      expect(`${r.out}\n${r.err}`).toContain("unsupported");
    });
  });
});
