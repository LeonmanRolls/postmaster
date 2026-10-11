// Unit tests for the surveyor's pure core: names, timeouts, the materials
// gate, the config pick, the final-message adapter and the prompt. The call
// flow itself is pinned blind by acceptance-429.test.ts.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { toolRoot } from "./lib/paths.ts";
import {
  buildPrompt,
  configuredSurveyor,
  finalMessage,
  gateMaterial,
  validName,
  validTimeout,
} from "./surveyor.ts";

describe("validName", () => {
  test("usable names pass", () => {
    for (const n of ["a", "stop-1", "lib.req_2", "X9"]) expect(validName(n)).toBeNull();
  });

  test("empty, dot, dotdot, leading dash and slashes fail", () => {
    for (const n of ["", ".", "..", "-x", "a/b", "a b", "a:b"]) {
      expect(validName(n)).not.toBeNull();
    }
  });
});

describe("validTimeout", () => {
  test("whole seconds from 1 to 86400 pass", () => {
    expect(validTimeout("1")).toBe(1);
    expect(validTimeout("600")).toBe(600);
    expect(validTimeout("86400")).toBe(86400);
  });

  test("zero, leading zero, over the top and not numbers fail", () => {
    for (const t of ["0", "00", "0600", "86401", "abc", "", "-5", "1.5", "12x"]) {
      expect(validTimeout(t)).toBeNull();
    }
  });
});

describe("gateMaterial", () => {
  const D = "/d";
  test("the ticket passes in either name", () => {
    expect(gateMaterial(D, "/d/ticket-body.md")).toBe("ticket");
    expect(gateMaterial(D, "/d/ticket-as-spec.md")).toBe("ticket");
  });

  test("reviewers' reports and findings pass", () => {
    expect(gateMaterial(D, "/d/logs/review-r1-bug-luna-last.md")).toBe("report");
    expect(gateMaterial(D, "/d/logs/review-r12-security-opus-findings.json")).toBe("report");
    expect(gateMaterial(D, "/d/logs/review-r3-style-haiku-last.md")).toBe("report");
    expect(gateMaterial(D, "/d/logs/review-r2-bug-mimo-findings.md")).toBe("report");
  });

  test("anything else inside is refused", () => {
    for (const p of [
      "/d",
      "/d/ESCALATION.md",
      "/d/handoff-1.md",
      "/d/run-log.md",
      "/d/logs/other.md",
      "/d/ticket-body.md.evil",
      "/d/logs/review-r1-evil-x-last.md",
      "/d/logs/review-rX-bug-x-last.md",
      "/d/logs/review-r1-bug-x.md",
      "/d/logs/nested/review-r1-bug-x-last.md",
      "/d/surveys/stop.md",
    ]) {
      expect(gateMaterial(D, p)).toBe("refused");
    }
  });

  test("outside paths pass, and prefix tricks with them", () => {
    for (const p of ["/tmp/x.md", "/d2/x.md", "/d-evil/x.md", "/d2"]) {
      expect(gateMaterial(D, p)).toBe("outside");
    }
  });
});

describe("configuredSurveyor", () => {
  const lanes = { opus: { harness: "claude" }, luna: { harness: "codex" } };
  test("a named lane is picked", () => {
    expect(configuredSurveyor({ team: { surveyor: "opus" }, lanes })).toEqual({ lane: "opus" });
  });

  test("no key is absent", () => {
    expect(configuredSurveyor({ team: {}, lanes })).toEqual({ absent: true });
    expect(configuredSurveyor({ team: { surveyor: "" }, lanes })).toEqual({ absent: true });
    expect(configuredSurveyor({ lanes })).toEqual({ absent: true });
  });

  test("a lane that is not defined, and a value that is not a name, are refused", () => {
    const missing = configuredSurveyor({ team: { surveyor: "sting" }, lanes });
    expect("refusal" in missing && missing.refusal).toContain("sting");
    const shaped = configuredSurveyor({ team: { surveyor: 5 }, lanes });
    expect("refusal" in shaped).toBe(true);
    const noLanes = configuredSurveyor({ team: { surveyor: "opus" } });
    expect("refusal" in noLanes).toBe(true);
  });
});

describe("finalMessage", () => {
  test("claude reads its last success result and skips foreign lines", () => {
    const init = JSON.stringify({ type: "system", subtype: "init", session_id: "t" });
    const first = JSON.stringify({ type: "result", subtype: "success", result: "early" });
    const last = JSON.stringify({ type: "result", subtype: "success", result: "late" });
    expect(finalMessage("claude", `${init}\nnot json\n${first}\n${last}\n`, null)).toEqual({
      message: "late",
    });
  });

  test("claude refuses no result, an error subtype and empty text", () => {
    expect("error" in finalMessage("claude", '{"type":"system"}\n', null)).toBe(true);
    const err = JSON.stringify({ type: "result", subtype: "error", result: "x" });
    expect("error" in finalMessage("claude", `${err}\n`, null)).toBe(true);
    const empty = JSON.stringify({ type: "result", subtype: "success", result: "  " });
    expect("error" in finalMessage("claude", `${empty}\n`, null)).toBe(true);
  });

  test("claude refuses a success result with is_error set, and keeps one without it", () => {
    const failed = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: true,
      result: "API Error: overloaded",
    });
    expect("error" in finalMessage("claude", `${failed}\n`, null)).toBe(true);
    const ok = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "said",
    });
    expect(finalMessage("claude", `${ok}\n`, null)).toEqual({ message: "said" });
  });

  test("codex trusts -o only with a completed turn and no failed one", () => {
    const thread = JSON.stringify({ type: "thread.started", thread_id: "t" });
    const done = JSON.stringify({ type: "turn.completed" });
    const failed = JSON.stringify({ type: "turn.failed", error: { message: "wall" } });
    expect(finalMessage("codex", `${thread}\n${done}\n`, "said\n")).toEqual({ message: "said\n" });
    expect("error" in finalMessage("codex", `${thread}\n${done}\n${failed}\n`, "said\n")).toBe(
      true,
    );
    expect("error" in finalMessage("codex", `${thread}\n`, "said\n")).toBe(true);
    expect("error" in finalMessage("codex", `${thread}\n${done}\n`, null)).toBe(true);
    expect("error" in finalMessage("codex", `${thread}\n${done}\n`, " \n")).toBe(true);
  });

  test("pi reads the last assistant message_end", () => {
    const sys = JSON.stringify({
      type: "message_end",
      message: { role: "system", content: [{ type: "text", text: "sys" }] },
    });
    const first = JSON.stringify({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "early" }] },
    });
    const last = JSON.stringify({
      type: "message_end",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "late" },
          { type: "tool", text: "skipped" },
          { type: "text", text: "tail" },
        ],
      },
    });
    expect(finalMessage("pi", `${sys}\n${first}\n${last}\n`, null)).toEqual({
      message: "late\ntail",
    });
    expect("error" in finalMessage("pi", `${sys}\n`, null)).toBe(true);
  });

  test("muse reads the last completed terminal record", () => {
    const done = JSON.stringify({
      payload_type: "run.terminal.completed",
      payload: { text: "said" },
    });
    const failed = JSON.stringify({ payload_type: "run.terminal.failed", payload: {} });
    expect(finalMessage("muse", `${done}\n`, null)).toEqual({ message: "said" });
    expect("error" in finalMessage("muse", `${done}\n${failed}\n`, null)).toBe(true);
    expect("error" in finalMessage("muse", '{"payload_type":"run.model.configured"}\n', null)).toBe(
      true,
    );
  });

  test("mimo reads the last text event", () => {
    const first = JSON.stringify({ type: "text", sessionID: "s", part: { text: "early" } });
    const last = JSON.stringify({ type: "text", sessionID: "s", part: { text: "late" } });
    expect(finalMessage("mimo", `${first}\n${last}\n`, null)).toEqual({ message: "late" });
    const finish = JSON.stringify({ type: "step_finish", sessionID: "s", part: {} });
    expect("error" in finalMessage("mimo", `${finish}\n`, null)).toBe(true);
  });

  test("mimo refuses text beside an error event", () => {
    const said = JSON.stringify({ type: "text", sessionID: "s", part: { text: "partial" } });
    const failed = JSON.stringify({ type: "error", sessionID: "s", part: {} });
    expect("error" in finalMessage("mimo", `${said}\n${failed}\n`, null)).toBe(true);
  });

  test("a harness with no recorded shape errors", () => {
    for (const h of ["grok", "agy", "nope"]) {
      const r = finalMessage(h, "{}\n", null);
      expect("error" in r && r.error).toContain(h);
    }
  });
});

describe("config example placement", () => {
  test("the surveyor key stays in [team] when the lens table is uncommented too", () => {
    const example = readFileSync(join(toolRoot(import.meta), "config.example.toml"), "utf8");
    const uncommented = example
      .split("\n")
      .map((l) =>
        l === '# surveyor = "luna"' ||
        l === "# [team.lens_reviewers]" ||
        l.startsWith("# security = ")
          ? l.slice("# ".length)
          : l,
      )
      .join("\n");
    const data = Bun.TOML.parse(uncommented) as unknown as Record<string, Record<string, unknown>>;
    const team = data.team ?? {};
    expect(team.surveyor).toBe("luna");
    const lenses = (team.lens_reviewers ?? {}) as Record<string, unknown>;
    expect(Object.hasOwn(lenses, "surveyor")).toBe(false);
  });
});

describe("buildPrompt", () => {
  test("it names the skill, the copies and the checkout", () => {
    const p = buildPrompt("/tool/skills/surveyor/SKILL.md", "/wt", "/wt/.survey/question.md", [
      "/wt/.survey/material-1-ticket-body.md",
    ]);
    expect(p).toContain("/tool/skills/surveyor/SKILL.md");
    expect(p).toContain("/wt/.survey/question.md");
    expect(p).toContain("/wt/.survey/material-1-ticket-body.md");
    expect(p).toContain("/wt");
  });

  test("no materials reads as none", () => {
    expect(
      buildPrompt("/tool/skills/surveyor/SKILL.md", "/wt", "/wt/.survey/question.md", []),
    ).toContain("none");
  });
});
