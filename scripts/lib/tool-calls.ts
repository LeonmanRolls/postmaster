// One reading of every harness's event stream, shared by the reach control
// and the ticket-reads check: each stream becomes the tool calls its thread
// ran, whatever harness wrote it. A call carries its tool name, its input,
// its output and its exit, so a check classifies what the thread did, never
// prose that mentions doing it.
import { readFileSync } from "node:fs";

export type RecordOf<T = unknown> = Record<string, T>;
export type Harness = "codex" | "claude" | "muse" | "mimo" | "pi" | string;
/** Observed changes read "read" or "write"; a named path reads "names", never either. */
export type Access = "read" | "write" | "names";

export interface ToolCall {
  name: string;
  input: RecordOf;
  output: string;
  exitCode: unknown;
  direct: Array<{ path: string; access: Access }>;
}

const DATA_RE = /^[ \t\r\n]*\{[^]*\}[ \t\r\n]*$/u;

export function rec(value: unknown): RecordOf {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordOf)
    : {};
}

export function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function toolCallsFromEvents(harness: Harness, events: unknown[]): ToolCall[] {
  const calls: ToolCall[] = [];
  const add = (
    name: unknown,
    input: unknown,
    output = "",
    exitCode: unknown = undefined,
    direct: ToolCall["direct"] = [],
  ): number => {
    calls.push({ name: text(name) || "tool", input: rec(input), output, exitCode, direct });
    return calls.length - 1;
  };
  const linked = new Map<string, number>();
  const pending = new Map<string, number>();
  for (const raw of events) {
    const event = rec(raw);
    if (harness === "codex") {
      if (event.type !== "item.completed") continue;
      const item = rec(event.item);
      if (item.type === "command_execution") {
        add(
          "shell",
          { command: text(item.command) },
          `${text(item.aggregated_output)}\n${text(item.output)}`,
          item.exit_code,
        );
      } else if (item.type === "file_change") {
        const direct = array(item.changes).flatMap((entry) => {
          const path = text(rec(entry).path);
          return path ? [{ path, access: "write" as const }] : [];
        });
        add("file_change", {}, "", undefined, direct);
      } else if (item.type === "mcp_tool_call") {
        add("mcp", item);
      }
    } else if (harness === "claude") {
      const msg = rec(event.message);
      for (const blockValue of array(msg.content)) {
        const block = rec(blockValue);
        if (event.type === "assistant" && block.type === "tool_use") {
          const index = add(block.name, block.input);
          if (typeof block.id === "string") linked.set(block.id, index);
        } else if (event.type === "user" && block.type === "tool_result") {
          const id = text(block.tool_use_id);
          const index = linked.get(id);
          if (index !== undefined) {
            const body =
              typeof block.content === "string"
                ? block.content
                : JSON.stringify(block.content ?? "");
            calls[index]!.output += `\n${body}`;
          }
        }
      }
    } else if (harness === "mimo") {
      if (event.type !== "tool_use") continue;
      const part = rec(event.part);
      const state = rec(part.state);
      add(part.tool, state.input, text(state.output), rec(state.metadata).exit);
    } else if (harness === "pi") {
      if (event.type === "tool_execution_start") {
        const index = add(event.toolName, event.args);
        const id = text(event.toolCallId || event.callId || event.id);
        if (id) linked.set(id, index);
        else pending.set(text(event.toolName), index);
      } else if (event.type === "tool_execution_end") {
        const id = text(event.toolCallId || event.callId || event.id);
        const index = linked.get(id) ?? pending.get(text(event.toolName));
        if (index !== undefined) calls[index]!.output = text(event.result ?? event.output);
      }
    } else if (harness === "muse") {
      if (event.payload_type !== "tool.result") continue;
      const payload = rec(event.payload);
      const facts = rec(payload.correlation_facts);
      const editFacts = rec(payload.edit_facts);
      let input: RecordOf = { ...editFacts };
      const resultText = text(payload.text);
      const head = resultText.trimStart();
      if (head.startsWith("{")) {
        const first = head.split("\n", 1)[0] ?? "";
        // A shell report prints its JSON pretty across lines; a single-line
        // report parses on its first line. Either way the parsed report sits
        // under the edit facts.
        const candidates =
          DATA_RE.test(first) && first !== resultText ? [first, resultText] : [resultText];
        for (const candidate of candidates) {
          try {
            const parsed = JSON.parse(candidate) as unknown;
            if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
              input = { ...(parsed as RecordOf), ...input };
              break;
            }
          } catch {
            // Non-JSON result text can still carry the edit_facts record.
          }
        }
      } else {
        const readFile = /^Read text file `([^`]+)`/u.exec(head);
        if (readFile?.[1] && !input.path && !input.file_path) input.path = readFile[1];
      }
      const direct: ToolCall["direct"] = [];
      const toolName = text(facts.tool_name);
      const access: Access = WRITE_NAME_RE.test(toolName) ? "write" : "read";
      for (const field of ["path", "file_path"]) {
        const p = text(input[field]);
        if (p) direct.push({ path: p, access });
      }
      add(toolName, input, resultText, facts.outcome, direct);
    }
  }
  return calls;
}

export function parseEventFile(path: string): unknown[] | null {
  let contents: string;
  try {
    contents = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  const events: unknown[] = [];
  for (const line of contents.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as unknown);
    } catch {
      return null;
    }
  }
  return events;
}

export function inputPath(input: RecordOf): string | null {
  for (const key of ["file_path", "path", "filePath", "filename", "target"]) {
    const value = text(input[key]);
    if (value) return value;
  }
  return null;
}

export function inputCommand(input: RecordOf): string {
  return text(input.command ?? input.cmd);
}

/** A tool name that writes rather than reads, by the verb it carries. */
export const WRITE_NAME_RE = /write|edit|create|patch|apply|delete|remove|move|copy|install|save/iu;

/**
 * The forked-task transcript prefix for a claude stream: the review harvester
 * prefixes copied fork records with the bug lane's stream name, so a review
 * stream keeps its own name and every other stream reads under its lane.
 */
export function claudeTaskPrefix(streamFile: string, lane: string): string {
  const base = streamFile.replace(/\.jsonl$/u, "");
  const prefix = base.startsWith("review-r") ? base : lane;
  return `${prefix}-claude-task-`;
}
