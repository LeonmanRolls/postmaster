// Tests beside scripts/view-stream.ts, moved from its --self-test on #109: 58 controls.
// Follow tests share one tmp dir from beforeAll; every render spawns a fresh viewer process.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cellWidth } from "./view-stream";

const viewer = join(import.meta.dir, "run");
const long = "x".repeat(200);
const TRAIL_NL = /\n+$/u;
const STAMPED = /^[0-9]{2}:[0-9]{2}:[0-9]{2} /u;

const bufferedEvents = [
  '{"stream":{"kind":"session","id":"s2"},"payload_type":"run.output.delta","payload":{"text":"First half. "}}',
  '{"stream":{"kind":"session","id":"s2"},"payload_type":"task.lifecycle.status","payload":{"event":{"kind":"status"}}}',
  '{"stream":{"kind":"session","id":"s2"},"payload_type":"run.output.delta","payload":{"text":"second half."}}',
  '{"stream":{"kind":"session","id":"s2"},"payload_type":"tool.result","payload":{"correlation_facts":{"tool_name":"read_file","outcome":"success"},"text":"Read text file `proof.txt`.\\n1|PELICAN\\n"}}',
  '{"stream":{"kind":"session","id":"s2"},"payload_type":"tool.result","payload":{"correlation_facts":{"tool_name":"edit_file","outcome":"success"},"edit_facts":{"path":"notes.md"},"text":"edited\\n"}}',
];

function rendered(event: string): string {
  const r = spawnSync(viewer, ["view-stream"], { input: `${event}\n`, encoding: "utf8" });
  return (r.stdout ?? "").replace(TRAIL_NL, "");
}

function streamOut(events: string[]): string {
  const r = spawnSync(viewer, ["view-stream"], {
    input: `${events.join("\n")}\n`,
    encoding: "utf8",
  });
  return (r.stdout ?? "").replace(TRAIL_NL, "");
}

function exitedPid(): string {
  const r = spawnSync("bash", ["-c", ": & echo $!"], { encoding: "utf8" });
  return (r.stdout ?? "").trim();
}

let tmp = "";

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "view-stream-"));
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("positive controls: event text is readable and complete", () => {
  test("claude: a session starts, with its thread id and model", () => {
    const event =
      '{"type":"system","subtype":"init","session_id":"a99db1c7-9178","model":"claude-haiku-4-5","tools":["Bash"]}';
    expect(rendered(event)).toBe("session a99db1c7-9178 · claude-haiku-4-5");
  }, 30000);

  test("claude: a tool call, with what it ran", () => {
    const event =
      '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"ls -a","description":"List files"}}]}}';
    expect(rendered(event)).toBe("Bash: ls -a");
  }, 30000);

  test("claude: every line of what the model said", () => {
    const event =
      '{"type":"assistant","message":{"content":[{"type":"text","text":"The command printed 3 entries.\\nMore detail."}]}}';
    expect(rendered(event)).toBe("says: The command printed 3 entries.\nMore detail.");
  }, 30000);

  test("claude: each content block on its own lines, never glued with a separator", () => {
    const event =
      '{"type":"assistant","message":{"content":[{"type":"text","text":"line one\\nline two"},{"type":"tool_use","name":"Bash","input":{"command":"ls"}}]}}';
    expect(rendered(event)).toBe("says: line one\nline two\nBash: ls");
  }, 30000);

  test("claude: a failed tool call", () => {
    const event =
      '{"type":"user","message":{"content":[{"type":"tool_result","is_error":true,"content":"No such file"}]}}';
    expect(rendered(event)).toBe("tool error: No such file");
  }, 30000);

  test("claude: a failed tool call with no text renders without crashing the viewer", () => {
    const event =
      '{"type":"user","message":{"content":[{"type":"tool_result","is_error":true,"content":[{"type":"text","text":null}]}]}}';
    expect(rendered(event)).toBe("tool error: ");
  }, 30000);

  test("claude: the result, with turns and cost", () => {
    const event =
      '{"type":"result","subtype":"success","num_turns":2,"total_cost_usd":0.0060272,"result":"The command printed 3 entries."}';
    expect(rendered(event)).toBe(
      "result: success · 2 turns · $0.01 · The command printed 3 entries.",
    );
  }, 30000);

  test("claude: a result restating the message does not print it twice", () => {
    const events = [
      '{"type":"assistant","message":{"content":[{"type":"text","text":"The answer is seven."}]}}',
      '{"type":"result","subtype":"success","result":"The answer is seven."}',
    ];
    expect(streamOut(events)).toBe("says: The answer is seven.\nresult: success");
  }, 30000);

  test("claude: a result that says something new prints in full", () => {
    const events = [
      '{"type":"assistant","message":{"content":[{"type":"text","text":"Working on it."}]}}',
      '{"type":"result","subtype":"success","result":"All three hosts green."}',
    ];
    expect(streamOut(events)).toBe(
      "says: Working on it.\nresult: success · All three hosts green.",
    );
  }, 30000);

  test("codex: a session starts", () => {
    const event = '{"type":"thread.started","thread_id":"0199a213-81c0"}';
    expect(rendered(event)).toBe("session 0199a213-81c0");
  }, 30000);

  test("codex: a shell command", () => {
    const event =
      '{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"bash -lc ls","status":"in_progress"}}';
    expect(rendered(event)).toBe("shell: bash -lc ls");
  }, 30000);

  test("codex: a command longer than the display width wraps without losing text", () => {
    const event = `{"type":"item.started","item":{"type":"command_execution","command":"${long}"}}`;
    expect(rendered(event)).toBe(`shell: ${long.slice(0, 153)}\n  ${long.slice(153)}`);
  }, 30000);

  test("codex: a message line longer than the display width wraps without losing text", () => {
    const event = `{"type":"item.completed","item":{"type":"agent_message","text":"${long}"}}`;
    expect(rendered(event)).toBe(`says: ${long.slice(0, 154)}\n  ${long.slice(154)}`);
  }, 30000);

  test("codex: what the model said", () => {
    const event =
      '{"type":"item.completed","item":{"id":"item_3","type":"agent_message","text":"Done."}}';
    expect(rendered(event)).toBe("says: Done.");
  }, 30000);

  test("pi: a session starts", () => {
    const event = '{"type":"session","version":3,"id":"01a0c7e8-5863","cwd":"/w"}';
    expect(rendered(event)).toBe("session 01a0c7e8-5863");
  }, 30000);

  test("pi: a tool call", () => {
    const event =
      '{"type":"tool_execution_start","toolCallId":"t1","toolName":"bash","args":{"command":"ls"}}';
    expect(rendered(event)).toBe("bash: ls");
  }, 30000);

  test("pi: what the model said", () => {
    const event =
      '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"All done."}]}}';
    expect(rendered(event)).toBe("says: All done.");
  }, 30000);

  test("muse: a session starts, with its thread id and model", () => {
    const event =
      '{"stream":{"kind":"session","id":"01a0e16d-17e8"},"payload_type":"run.model.configured","payload":{"model_id":"muse-spark-1.3-contributor","source":"startup"}}';
    expect(rendered(event)).toBe("session 01a0e16d-17e8 · muse-spark-1.3-contributor");
  }, 30000);

  test("muse: a tool call, with what it changed", () => {
    const event =
      '{"stream":{"kind":"session","id":"s1"},"payload_type":"tool.result","payload":{"correlation_facts":{"tool_name":"write_file","outcome":"success"},"edit_facts":{"path":"proof.txt","added":1}}}';
    expect(rendered(event)).toBe("write_file: proof.txt");
  }, 30000);

  test("muse: a failed tool call", () => {
    const event =
      '{"stream":{"kind":"session","id":"s1"},"payload_type":"tool.result","payload":{"correlation_facts":{"tool_name":"shell","outcome":"error"}}}';
    expect(rendered(event)).toBe("tool error: shell");
  }, 30000);

  test("muse: the result, with what the model said", () => {
    const event =
      '{"stream":{"kind":"session","id":"s1"},"payload_type":"run.terminal.completed","payload":{"terminal":"completed","text":"DONE"}}';
    expect(rendered(event)).toBe("result: completed · DONE");
  }, 30000);

  test("muse: a failed run", () => {
    const event =
      '{"stream":{"kind":"session","id":"s1"},"payload_type":"run.terminal.failed","payload":{"terminal":"failed","text":""}}';
    expect(rendered(event)).toBe("result: failed");
  }, 30000);

  test("muse: a recorded stream shows its full command and message, not tool output", () => {
    const recorded = readFileSync(join(import.meta.dir, "fixtures/view-stream/muse.jsonl"), "utf8");
    const r = spawnSync(viewer, ["view-stream"], { input: recorded, encoding: "utf8" });
    const got = (r.stdout ?? "").replace(TRAIL_NL, "");
    const want =
      "bash: printf 'MUSE_COMMAND_SAMPLE'\nresult: completed · MUSE_MESSAGE_FIRST_LINE\nMUSE_MESSAGE_SECOND_LINE";
    expect(got).toBe(want);
  }, 30000);

  test("muse: buffered deltas flush as one message at the tool call, with read and edit paths", () => {
    const want = "says: First half. second half.\nread_file: proof.txt\nedit_file: notes.md";
    expect(streamOut(bufferedEvents)).toBe(want);
  }, 30000);

  test("muse: tool output stays out of the pane", () => {
    expect(streamOut(bufferedEvents)).not.toContain("PELICAN");
  }, 30000);

  test("muse: deltas with no terminal after them still print at the end of the stream", () => {
    const events = [
      '{"stream":{"kind":"session","id":"s3"},"payload_type":"run.output.delta","payload":{"text":"a message with no "}}',
      '{"stream":{"kind":"session","id":"s3"},"payload_type":"run.output.delta","payload":{"text":"terminal after it."}}',
    ];
    expect(streamOut(events)).toBe("says: a message with no terminal after it.");
  }, 30000);

  test("mimo: a session starts, with its thread id, and a first step says nothing more", () => {
    const event = '{"type":"step_start","sessionID":"ses_ffe5f1e2","part":{"type":"step-start"}}';
    expect(rendered(event)).toBe("session ses_ffe5f1e2");
  }, 30000);

  test("mimo: a tool call, with what it touched", () => {
    const event =
      '{"type":"tool_use","sessionID":"ses_ffe5f1e2","part":{"type":"tool","tool":"write","state":{"status":"completed","input":{"file_path":"proof.txt","content":"PELICAN"}}}}';
    expect(rendered(event)).toBe("session ses_ffe5f1e2\nwrite: proof.txt");
  }, 30000);

  test("mimo: what the model said", () => {
    const event = '{"type":"text","sessionID":"ses_1","part":{"type":"text","text":"DONE"}}';
    expect(rendered(event)).toBe("session ses_1\nsays: DONE");
  }, 30000);

  test("mimo: a failed tool call", () => {
    const event =
      '{"type":"tool_use","sessionID":"ses_1","part":{"tool":"bash","state":{"status":"error","input":{"command":"false"}}}}';
    expect(rendered(event)).toBe("session ses_1\ntool error: bash");
  }, 30000);

  test("mimo: a session is named once, and only its last step says done", () => {
    const events = [
      '{"type":"step_start","sessionID":"ses_2","part":{}}',
      '{"type":"text","sessionID":"ses_2","part":{"text":"DONE"}}',
      '{"type":"step_finish","sessionID":"ses_2","part":{"reason":"tool-calls"}}',
      '{"type":"step_finish","sessionID":"ses_2","part":{"reason":"stop"}}',
    ];
    expect(streamOut(events)).toBe("session ses_2\nsays: DONE\ndone");
  }, 30000);

  test("a line that is not JSON is shown as it is", () => {
    expect(rendered("plain text from a wrapper")).toBe("plain text from a wrapper");
  }, 30000);

  test("an unknown event shows its type", () => {
    const event = '{"type":"heartbeat","message":"still here"}';
    expect(rendered(event)).toBe("heartbeat: still here");
  }, 30000);

  test("escape sequences in what a model said never reach the terminal", () => {
    const event =
      '{"type":"assistant","message":{"content":[{"type":"text","text":"hi \\u001b]0;title\\u0007 there"}]}}';
    expect(rendered(event)).toBe("says: hi ]0;title there");
  }, 30000);

  test("nor in a line that is not JSON", () => {
    expect(rendered("plain \x1b[2Jtext\x07")).toBe("plain [2Jtext");
  }, 30000);
});

describe("negative controls: noise renders nothing", () => {
  test("claude: a hook event", () => {
    const event = '{"type":"system","subtype":"hook_started","hook_name":"SessionStart:startup"}';
    expect(rendered(event)).toBe("");
  }, 30000);

  test("claude: thinking", () => {
    const event = '{"type":"assistant","message":{"content":[{"type":"thinking","thinking":""}]}}';
    expect(rendered(event)).toBe("");
  }, 30000);

  test("claude: a tool result that succeeded", () => {
    const event =
      '{"type":"user","message":{"content":[{"type":"tool_result","content":"a\\nb"}]}}';
    expect(rendered(event)).toBe("");
  }, 30000);

  test("claude: a rate-limit event that allowed the call", () => {
    const event = '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed"}}';
    expect(rendered(event)).toBe("");
  }, 30000);

  test("codex: reasoning", () => {
    const event = '{"type":"item.completed","item":{"type":"reasoning","text":"hmm"}}';
    expect(rendered(event)).toBe("");
  }, 30000);

  test("codex: a null message renders nothing", () => {
    const event = '{"type":"item.completed","item":{"type":"agent_message","text":null}}';
    expect(rendered(event)).toBe("");
  }, 30000);

  test("codex: a blank command renders nothing", () => {
    const event = '{"type":"item.started","item":{"type":"command_execution","command":"   "}}';
    expect(rendered(event)).toBe("");
  }, 30000);

  test("codex: an edit with no paths renders nothing", () => {
    const event =
      '{"type":"item.completed","item":{"type":"file_change","changes":[{"path":null}]}}';
    expect(rendered(event)).toBe("");
  }, 30000);

  test("codex: an edit lists only its real paths", () => {
    const event =
      '{"type":"item.completed","item":{"type":"file_change","changes":[{"path":null},{"path":"a.ts"},{"path":""}]}}';
    expect(rendered(event)).toBe("edit: a.ts");
  }, 30000);

  test("claude: a null text block renders nothing, not says None", () => {
    const event = '{"type":"assistant","message":{"content":[{"type":"text","text":null}]}}';
    expect(rendered(event)).toBe("");
  }, 30000);

  test("mimo: a null text block renders nothing, not says None", () => {
    const events = [
      '{"type":"step_start","sessionID":"ses_null1","part":{"type":"step-start"}}',
      '{"type":"text","sessionID":"ses_null1","part":{"type":"text","text":null}}',
    ];
    expect(streamOut(events)).toBe("session ses_null1");
  }, 30000);

  test("pi: a streaming delta", () => {
    const event =
      '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"Al"}}';
    expect(rendered(event)).toBe("");
  }, 30000);

  test("muse: a task's lifecycle record", () => {
    const event =
      '{"stream":{"kind":"session","id":"s1"},"payload_type":"task.lifecycle.started","payload":{"kind":"task_lifecycle"}}';
    expect(rendered(event)).toBe("");
  }, 30000);

  test("muse: a streaming delta whose text the result carries adds no second line", () => {
    const events = [
      '{"stream":{"kind":"session","id":"s1"},"payload_type":"run.output.delta","payload":{"text":"DO"}}',
      '{"stream":{"kind":"session","id":"s1"},"payload_type":"run.terminal.completed","payload":{"terminal":"completed","text":"DO"}}',
    ];
    expect(streamOut(events)).toBe("result: completed · DO");
  }, 30000);

  test("pi: the user's own message ending", () => {
    const event =
      '{"type":"message_end","message":{"role":"user","content":[{"type":"text","text":"do it"}]}}';
    expect(rendered(event)).toBe("");
  }, 30000);

  test("fifty unknown events of one type show as one line", () => {
    const deltas = Array.from({ length: 50 }, (_, i) => `{"type":"delta","n":${i + 1}}`);
    const input = `${deltas.join("\n")}\n`;
    const r = spawnSync(viewer, ["view-stream"], { input, encoding: "utf8" });
    expect((r.stdout ?? "").replace(TRAIL_NL, "")).toBe("delta");
  }, 30000);

  test("a whole stream renders with no raw JSON in it", () => {
    const events = [
      '{"type":"system","subtype":"hook_started"}',
      '{"type":"system","subtype":"init","session_id":"s1","model":"m"}',
      '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"/w/a.ts"}}]}}',
      '{"type":"user","message":{"content":[{"type":"tool_result","content":"{\\"json\\": true}"}]}}',
      '{"type":"result","subtype":"success","num_turns":1}',
    ];
    const r = spawnSync(viewer, ["view-stream"], {
      input: `${events.join("\n")}\n`,
      encoding: "utf8",
    });
    const got = r.stdout ?? "";
    expect(got.includes("{")).toBe(false);
    expect(got.split("\n").filter((l) => l !== "").length).toBe(3);
  }, 30000);
});

describe("following a file that grows", () => {
  test("every line is shown, with its time, and the unterminated last line too", () => {
    const f = join(tmp, "events.jsonl");
    writeFileSync(f, "");
    // Orphan the writer so it is not our child: spawnSync would block reaping and leave a
    // zombie that follow would read as still running.
    const wscript = join(tmp, "writer.sh");
    writeFileSync(
      wscript,
      `#!/usr/bin/env bash
for i in 1 2 3; do
  printf '{"type":"assistant","message":{"content":[{"type":"text","text":"step %d"}]}}\\n' "$i" >> "$1"
  sleep 0.3
done
printf '{"type":"result","subtype":"success"}' >> "$1"
`,
    );
    chmodSync(wscript, 0o755);
    const wr = spawnSync("bash", ["-c", `"${wscript}" "${f}" & echo $!`], { encoding: "utf8" });
    const writerPid = parseInt((wr.stdout ?? "").trim(), 10);
    const r = spawnSync(viewer, ["view-stream", "--follow", f, "--pid", String(writerPid)], {
      encoding: "utf8",
      timeout: 30000,
    });
    const out = r.stdout ?? "";
    const lineRe = /^[0-9]{2}:[0-9]{2}:[0-9]{2} (says: step [123]|result: success)$/u;
    const n = out.split("\n").filter((l) => lineRe.test(l)).length;
    expect(n).toBe(4);
  }, 30000);

  test("--from skips what was there before", () => {
    const f = join(tmp, "append.jsonl");
    writeFileSync(f, "old line\n");
    const from = Buffer.byteLength("old line\n");
    const wscript2 = join(tmp, "writer2.sh");
    writeFileSync(wscript2, `#!/usr/bin/env bash\nprintf 'new line\\n' >> "$1"\n`);
    chmodSync(wscript2, 0o755);
    const wr = spawnSync("bash", ["-c", `"${wscript2}" "${f}" & echo $!`], { encoding: "utf8" });
    const writerPid = parseInt((wr.stdout ?? "").trim(), 10);
    const r = spawnSync(
      viewer,
      ["view-stream", "--follow", f, "--pid", String(writerPid), "--from", String(from)],
      {
        encoding: "utf8",
        timeout: 30000,
      },
    );
    const out = r.stdout ?? "";
    expect(out.includes("old line")).toBe(false);
    expect(out.includes("new line")).toBe(true);
  }, 30000);

  test("a command longer than a live pane wraps fully to its width", () => {
    const f = join(tmp, "long.jsonl");
    const event = `{"type":"item.started","item":{"type":"command_execution","command":"${long}"}}`;
    writeFileSync(f, `${event}\n`);
    const r = spawnSync(viewer, ["view-stream", "--follow", f, "--pid", exitedPid()], {
      encoding: "utf8",
      timeout: 30000,
      env: { ...process.env, COLUMNS: "60" },
    });
    const lines = (r.stdout ?? "").split("\n").filter((l) => l !== "");
    const plain = lines.map((l) => l.replace(STAMPED, "").replace(/^ {2}/u, "")).join("");
    const tooWide = (r.stdout ?? "").split("\n").some((l) => l.length > 60);
    expect(plain).toBe(`shell: ${long}`);
    expect(tooWide).toBe(false);
  }, 30000);

  test("a pane narrower than the width floor still fits every line", () => {
    const narrow = `word ${"x".repeat(80)} end`;
    const f = join(tmp, "narrow.jsonl");
    const event = `{"type":"item.completed","item":{"type":"agent_message","text":"${narrow}"}}`;
    writeFileSync(f, `${event}\n`);
    const r = spawnSync(viewer, ["view-stream", "--follow", f, "--pid", exitedPid()], {
      encoding: "utf8",
      timeout: 30000,
      env: { ...process.env, COLUMNS: "30" },
    });
    const tooWide = (r.stdout ?? "").split("\n").some((l) => l.length > 30);
    const wi = (r.stdout ?? "").indexOf("word ");
    const hasEnds = wi >= 0 && (r.stdout ?? "").indexOf("end", wi) >= 0;
    expect(hasEnds).toBe(true);
    expect(tooWide).toBe(false);
  }, 30000);

  test("wide characters wrap to display cells, losing none", () => {
    const f = join(tmp, "cjk.jsonl");
    const event = `{"type":"item.completed","item":{"type":"agent_message","text":"${"漢".repeat(70)}"}}`;
    writeFileSync(f, `${event}\n`);
    const r = spawnSync(viewer, ["view-stream", "--follow", f, "--pid", exitedPid()], {
      encoding: "utf8",
      timeout: 30000,
      env: { ...process.env, COLUMNS: "80" },
    });
    const shown = (r.stdout ?? "").split("\n").filter((l) => l !== "");
    const cells = Math.max(...shown.map(cellWidth));
    const count = ((r.stdout ?? "").match(/漢/gu) ?? []).length;
    expect(count).toBe(70);
    expect(cells <= 80).toBe(true);
  }, 30000);

  test("a ten-column pane prints bounded lines instead of hanging", () => {
    const f = join(tmp, "tiny.jsonl");
    writeFileSync(
      f,
      '{"type":"item.completed","item":{"type":"agent_message","text":"hi there"}}\n',
    );
    const r = spawnSync(viewer, ["view-stream", "--follow", f, "--pid", exitedPid()], {
      encoding: "utf8",
      timeout: 20000,
      env: { ...process.env, COLUMNS: "10" },
    });
    const tooWide = (r.stdout ?? "").split("\n").some((l) => l.length > 10);
    const actual = (r.stdout ?? "")
      .split("\n")
      .filter((l) => l !== "")
      .map((l) => l.replace(STAMPED, ""))
      .join("");
    expect(r.status).toBe(0);
    expect(actual).toBe("says: hi there");
    expect(tooWide).toBe(false);
  }, 30000);
});
