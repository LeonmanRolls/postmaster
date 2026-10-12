#!/usr/bin/env bun
// Lists every tool call in a sub-agent's transcript, to check what the writer read and ran.
//
//   bun apparatus/reads.ts <transcript.jsonl> <writer-folder>
//
// One tab-separated line per call: its number, the tool, the place it touched, whether that is
// inside the writer's folder, and its target with the folder written as <writer>. For a shell
// command the target is the command's first line, and the place is outside when the command
// names any absolute path, ~, $HOME or .. that does not stay inside the folder. The last line
// counts the calls and those outside.
import { readFileSync } from "node:fs";

export interface Call {
  tool: string;
  target: string;
  inside: boolean;
}

const PATH_KEYS = ["file_path", "path", "notebook_path"];

/** Whether a shell command names only places inside the folder. */
export function commandStaysInside(command: string, folder: string): boolean {
  const rest = command.split(folder).join("");
  if (/(^|[\s"'=:(])(~|\$HOME|\$\{HOME\})/u.test(rest)) return false;
  if (/(^|[\s"'=:(])\.\.(\/|$|[\s"'])/u.test(rest)) return false;
  return !/(^|[\s"'=:(<>])\/[A-Za-z]/u.test(rest);
}

/** The calls in a transcript, from its JSON lines. */
export function callsOf(lines: string[], folder: string): Call[] {
  const calls: Call[] = [];
  for (const line of lines) {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const message = (event as { message?: { content?: unknown } }).message;
    const content = Array.isArray(message?.content) ? message.content : [];
    for (const block of content as Array<{ type?: string; name?: string; input?: Record<string, unknown> }>) {
      if (block.type !== "tool_use") continue;
      const tool = block.name ?? "";
      const input = block.input ?? {};
      const command = typeof input.command === "string" ? input.command : "";
      if (command) {
        calls.push({ tool, target: command.split("\n")[0] ?? "", inside: commandStaysInside(command, folder) });
        continue;
      }
      const key = PATH_KEYS.find((k) => typeof input[k] === "string");
      const target = key ? String(input[key]) : JSON.stringify(input).slice(0, 200);
      const inside = key ? target === folder || target.startsWith(`${folder}/`) : true;
      calls.push({ tool, target, inside });
    }
  }
  return calls;
}

function main(argv: string[]): void {
  const [transcript, folder] = argv;
  if (!transcript || !folder) {
    console.error("usage: reads.ts <transcript.jsonl> <writer-folder>");
    process.exit(1);
  }
  const calls = callsOf(readFileSync(transcript, "utf8").split("\n"), folder);
  calls.forEach((c, i) => {
    const target = c.target.split(folder).join("<writer>").replaceAll("\t", " ");
    console.log([i + 1, c.tool, c.inside ? "inside" : "OUTSIDE", target].join("\t"));
  });
  console.log(`calls\t${calls.length}\toutside\t${calls.filter((c) => !c.inside).length}`);
}

if (import.meta.main) main(process.argv.slice(2));
