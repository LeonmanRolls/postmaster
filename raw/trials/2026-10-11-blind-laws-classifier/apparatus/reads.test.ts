import { expect, test } from "bun:test";
import { callsOf, commandStaysInside } from "./reads.ts";

const W = "/tmp/w";

test("a command that names only the folder stays inside", () => {
  expect(commandStaysInside(`cd ${W} && bun run-stub.ts`, W)).toBe(true);
  expect(commandStaysInside(`cd ${W} && ls node_modules/fast-check`, W)).toBe(true);
});

test("a command that names another place goes outside", () => {
  expect(commandStaysInside(`cd ${W} && cat /etc/passwd`, W)).toBe(false);
  expect(commandStaysInside(`cd ${W} && cat ~/notes`, W)).toBe(false);
  expect(commandStaysInside(`cd ${W} && ls ..`, W)).toBe(false);
  expect(commandStaysInside(`cd ${W} && git log $HOME`, W)).toBe(false);
});

test("calls are read from tool_use blocks, and a path outside the folder is marked", () => {
  const lines = [
    JSON.stringify({ message: { content: [{ type: "tool_use", name: "Read", input: { file_path: `${W}/BRIEF.md` } }] } }),
    JSON.stringify({ message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "/repo/scripts/reach.ts" } }] } }),
    JSON.stringify({ message: { content: [{ type: "text", text: "thinking aloud" }] } }),
    "not json",
  ];
  const calls = callsOf(lines, W);
  expect(calls.map((c) => c.inside)).toEqual([true, false]);
});
