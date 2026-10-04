import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { launchPostmaster, launchSpecSession, launchWorkhorse } from "./runbook-host.ts";

type Call = { program: string; args: string[] };
type Result = { code: number; out: string; err: string };
const result = (code = 0, out = "", err = ""): Result => ({ code, out, err });

describe("runbook-host", () => {
  test("workhorse launch keeps the name, marker files, role and launch arguments", () => {
    const calls: Call[] = [];
    const runner = (program: string, args: readonly string[]): Result => {
      calls.push({ program, args: [...args] });
      return args[1] === "name" ? result(0, "ticket · workhorse alpha\n") : result(0, "started\n");
    };
    const dispatched = launchWorkhorse("/runs/266", "alpha", "/repo/.worktrees/266-alpha", runner);
    expect(dispatched).toEqual(result(0, "started\n"));
    expect(calls[0]?.args).toEqual(["host", "name", "/runs/266", "workhorse", "alpha"]);
    expect(calls[1]?.args).toEqual([
      "host",
      "run",
      "ticket · workhorse alpha",
      "/repo/.worktrees/266-alpha",
      "--under",
      "/runs/266",
      "--role",
      "lane",
      "--run",
      "/runs/266",
      "--out",
      "/runs/266/logs/alpha-events.jsonl",
      "--err",
      "/runs/266/logs/alpha.err",
      "--marker",
      "/runs/266/logs/alpha.done",
      "--",
      join(import.meta.dir, "run"),
      "launch",
      "launch",
      "alpha",
      "/repo/.worktrees/266-alpha",
      "/runs/266/alpha-prompt.txt",
      "--last",
      "/runs/266/logs/alpha-last.md",
      "--run",
      "/runs/266",
    ]);
  });

  test("postmaster launch writes the same streams and marker under its run root", () => {
    let called: Call | undefined;
    const runner = (program: string, args: readonly string[]): Result => {
      called = { program, args: [...args] };
      return result(0, "started\n");
    };
    expect(launchPostmaster("/repo", "/repo/.postmaster/runs", runner)).toEqual(
      result(0, "started\n"),
    );
    expect(called?.args).toEqual([
      "host",
      "run",
      "postmaster",
      "/repo",
      "--out",
      "/repo/.postmaster/runs/postmaster/events.jsonl",
      "--err",
      "/repo/.postmaster/runs/postmaster/postmaster.err",
      "--marker",
      "/repo/.postmaster/runs/postmaster/.exited",
      "--",
      join(import.meta.dir, "run"),
      "launch",
      "launch",
      "postmaster",
      "/repo",
      "/repo/.postmaster/runs/postmaster/brief.md",
    ]);
  });

  test("spec session uses the ticket name and short commit in its handle and label", () => {
    const calls: Call[] = [];
    const runner = (program: string, args: readonly string[]): Result => {
      calls.push({ program, args: [...args] });
      if (args[1] === "name") return result(0, "#266, Ticket title\n");
      if (program === "git") return result(0, "abc1234\n");
      return result(0, "spawned\n");
    };
    const spawned = launchSpecSession(
      "/runs/266",
      "/repo",
      "0123456789abcdef",
      ["codex", "--interactive"],
      runner,
    );
    expect(spawned).toEqual(result(0, "spawned\n"));
    expect(calls[0]?.args).toEqual(["host", "name", "/runs/266"]);
    expect(calls[1]?.args).toEqual(["-C", "/repo", "rev-parse", "--short", "0123456789abcdef"]);
    expect(calls[2]?.args).toEqual([
      "host",
      "spawn",
      "spec-#266, Ticket title-abc1234",
      "/repo",
      "--label",
      "#266, Ticket title · spec",
      "--",
      "codex",
      "--interactive",
    ]);
  });

  test("a failed host-name lookup stops before launch", () => {
    let calls = 0;
    const launched = launchWorkhorse("/runs/266", "alpha", "/repo/wt", () => {
      calls += 1;
      return result(1, "", "missing dispatch\n");
    });
    expect(launched).toEqual(result(1, "", "missing dispatch\n"));
    expect(calls).toBe(1);
  });
});
