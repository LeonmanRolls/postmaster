// Ground truth for the view-stream reading questions: recomputes every answer by running the
// module, and prints one JSON object, question id to answer.
//
//   bun --no-env-file --config=/dev/null ground-truth.ts <path to a copy of scripts/view-stream.ts>
//
// The copy must sit in a folder where its relative imports (./lib/*.ts) resolve. For a `change`
// question the module text is copied to one temporary file in the same folder, the value of the
// named `const NAME = <literal>;` is replaced, the copy is run, and that one file is deleted.
// Nothing here depends on the clock: a followed run is reported without its time prefix.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

type RunSpec = {
  args: string[];
  stdin?: string;
  env?: Record<string, string>;
  files?: Record<string, string | { utf8: string; appendHex: string }>;
  extract:
    | "lines"
    | "lines-unstamped"
    | "line-lengths"
    | "exit-stderr"
    | "result-lines"
    | "lengths-and-ellipses"
    | "first-unstamped-or-undetermined";
};
type Spec = {
  type: string;
  run?: RunSpec;
  call?: { export: string; args: unknown[] };
  exports?: boolean;
  change?: { constant: string; value: string };
};

const SPEC: Record<string, Spec> = {
  "q01": {
    "type": "trace",
    "run": {
      "args": [],
      "stdin": "{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"c-17\"}\n{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"  plan:\\nstep one\"},{\"type\":\"thinking\",\"thinking\":\"hm\"},null,\"stray\",{\"type\":\"tool_use\",\"name\":\"Grep\",\"input\":{\"description\":\"find todos\",\"pattern\":\"TODO\"}},{\"type\":\"tool_use\",\"name\":\"Task\",\"input\":\"x\"}]}}\n{\"type\":\"user\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"ok\"},{\"type\":\"tool_result\",\"is_error\":true,\"content\":[{\"type\":\"text\",\"text\":\"\"},{\"type\":\"text\",\"text\":\"E1 failed\\nE2\"}]},{\"type\":\"tool_result\",\"content\":\"fine\"}]}}\n{\"type\":\"system\",\"subtype\":\"compact_boundary\"}\n",
      "extract": "lines"
    }
  },
  "q02": {
    "type": "state",
    "run": {
      "args": [],
      "stdin": "{\"type\":\"heartbeat\",\"message\":\"one\"}\n{\"type\":\"heartbeat\",\"message\":\"two\"}\n{\"type\":\"turn.started\"}\n{\"type\":\"heartbeat\",\"message\":\"three\"}\n{\"type\":\"tool_execution_end\",\"toolName\":\"bash\",\"isError\":false}\n{\"type\":\"ping\"}\n{\"type\":\"ping\",\"message\":\"again\"}\n{\"type\":\"heartbeat\",\"message\":\"four\"}\n{\"type\":\"ping\",\"message\":\"five\"}\n{\"type\":\"system\",\"subtype\":\"hook_started\"}\n{\"type\":\"ping\",\"message\":\"six\"}\n{\"type\":\"rate_limit_event\",\"rate_limit_info\":{\"status\":\"blocked\"}}\n{\"type\":\"ping\",\"message\":\"seven\"}\n{\"type\":\"tool_execution_end\",\"toolName\":\"read\",\"isError\":true}\n{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"thinking\",\"thinking\":\"hm\"}]}}\n{\"type\":\"ping\",\"message\":\"eight\"}\n{\"type\":\"agent_end\"}\n",
      "extract": "lines"
    }
  },
  "q03": {
    "type": "change",
    "change": {
      "constant": "READ_FILE_RE",
      "value": "/^Read text file `([^`]+)`$/u"
    },
    "run": {
      "args": [],
      "stdin": "{\"payload_type\":\"tool.result\",\"payload\":{\"correlation_facts\":{\"tool_name\":\"read_file\"},\"text\":\"Read text file `a.txt`.\\n1|x\"}}\n{\"payload_type\":\"tool.result\",\"payload\":{\"correlation_facts\":{\"tool_name\":\"read_file\"},\"text\":\"Read text file `b.txt`\"}}\n{\"payload_type\":\"tool.result\",\"payload\":{\"correlation_facts\":{\"tool_name\":\"read_file\"},\"text\":\"  Read text file `c d.txt`\"}}\n{\"payload_type\":\"tool.result\",\"payload\":{\"correlation_facts\":{\"tool_name\":\"read_file\"},\"text\":\"read text file `e.txt`\"}}\n",
      "extract": "lines"
    }
  },
  "q04": {
    "type": "trace",
    "call": {
      "export": "cellWidth",
      "args": [
        "á漢゙🌀ｱ͏Ａุ⌛❤"
      ]
    }
  },
  "q05": {
    "type": "state",
    "run": {
      "args": [],
      "stdin": "{\"payload_type\":\"run.output.delta\",\"payload\":{\"text\":\"Plan: \"}}\n{\"payload_type\":\"run.output.delta\",\"payload\":{\"text\":true}}\n{\"payload_type\":\"run.output.delta\",\"payload\":{\"text\":0}}\n{\"payload_type\":\"run.output.delta\",\"payload\":{\"text\":\" ok\"}}\n{\"payload_type\":\"tool.result\",\"payload\":{\"correlation_facts\":{\"tool_name\":\"bash\"},\"text\":\"{\\\"command\\\":\\\"ls\\\"}\"}}\n{\"payload_type\":\"run.output.delta\",\"payload\":{\"text\":\"Lost words\"}}\n{\"payload_type\":\"run.terminal.completed\",\"payload\":{\"text\":\"\",\"terminal\":\"\"}}\n{\"payload_type\":\"run.output.delta\",\"payload\":{\"text\":\" kept \"}}",
      "extract": "lines"
    }
  },
  "q06": {
    "type": "trace",
    "run": {
      "args": [],
      "stdin": "{\"type\":\"result\",\"subtype\":\"success\",\"num_turns\":2,\"total_cost_usd\":1.125}\n{\"type\":\"result\",\"is_error\":true,\"num_turns\":true,\"total_cost_usd\":false}\n{\"type\":\"result\",\"status\":\"cancelled\",\"num_turns\":1.5,\"total_cost_usd\":\"3\"}\n{\"type\":\"rate_limit_event\",\"rate_limit_info\":{\"status\":\"allowed\"}}\n{\"type\":\"result\",\"total_cost_usd\":0.375}\n{\"type\":\"result\",\"num_turns\":false,\"total_cost_usd\":-0.001}\n",
      "extract": "lines"
    }
  },
  "q07": {
    "type": "change",
    "change": {
      "constant": "WORDSEP_SIMPLE",
      "value": "/([ -]+)/u"
    },
    "run": {
      "args": [
        "--follow",
        "{dir}/events.jsonl",
        "--pid",
        "{deadpid}"
      ],
      "env": {
        "COLUMNS": "60"
      },
      "files": {
        "events.jsonl": "{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"run the pre-existing-condition-handling-routine then re-check the well-known-edge-cases today\"}}\n"
      },
      "extract": "lines-unstamped"
    }
  },
  "q08": {
    "type": "state",
    "run": {
      "args": [],
      "stdin": "{\"type\":\"result\",\"subtype\":\"success\",\"result\":\"Done.\"}\n{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"Done.\"}]}}\n{\"type\":\"result\",\"subtype\":\"success\",\"result\":\"  Done.  \"}\n{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"tool_use\",\"name\":\"Bash\",\"input\":{\"command\":\"ls\"}}]}}\n{\"type\":\"result\",\"subtype\":\"success\",\"result\":\"Done.\"}\n{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"Done\"}]}}\n{\"type\":\"result\",\"subtype\":\"success\",\"result\":\"Done.\"}\n{\"type\":\"result\",\"subtype\":\"success\",\"result\":\"Done\"}\n",
      "extract": "lines"
    }
  },
  "q09": {
    "type": "trace",
    "run": {
      "args": [
        "a.jsonl",
        "b.jsonl",
        "-x"
      ],
      "stdin": "",
      "extract": "exit-stderr"
    }
  },
  "q10": {
    "type": "control-trivial",
    "exports": true
  },
  "q11": {
    "type": "trace",
    "run": {
      "args": [
        "--follow",
        "{dir}/events.jsonl",
        "--pid",
        "{deadpid}"
      ],
      "env": {
        "COLUMNS": "32"
      },
      "files": {
        "events.jsonl": "{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"漢字 abc 漢字漢字漢字 def 漢字 漢字漢字漢字漢字\"}}\n"
      },
      "extract": "lines-unstamped"
    }
  },
  "q12": {
    "type": "state",
    "run": {
      "args": [],
      "stdin": "{\"type\":\"step_start\",\"sessionID\":\"ses_a\",\"part\":{}}\n{\"type\":\"text\",\"sessionID\":\"ses_b\",\"part\":{\"text\":\"from b\"}}\n{\"type\":\"error\",\"sessionID\":\"ses_a\",\"error\":{\"name\":\"Timeout\",\"data\":{\"message\":\"rate limited\"}}}\n{\"type\":\"step_start\",\"sessionID\":7,\"part\":{}}\n{\"type\":\"step_start\",\"sessionID\":\"7\",\"part\":{}}\n{\"type\":\"step_start\",\"sessionID\":\"\",\"part\":{}}\n{\"type\":\"step_start\",\"sessionID\":7.0,\"part\":{}}\n{\"type\":\"step_start\",\"sessionID\":true,\"part\":{}}\n{\"type\":\"step_start\",\"sessionID\":\"True\",\"part\":{}}\n{\"type\":\"step_start\",\"sessionID\":null,\"part\":{}}\n{\"type\":\"error\",\"sessionID\":7,\"error\":{\"name\":\"Boom\"}}\n{\"type\":\"error\",\"sessionID\":\"ses_b\",\"error\":{\"code\":5}}\n{\"type\":\"step_finish\",\"sessionID\":7,\"part\":{\"reason\":\"stop\"}}\n",
      "extract": "lines"
    }
  },
  "q13": {
    "type": "change",
    "change": {
      "constant": "MIMO_TYPES",
      "value": "[\"step_start\", \"text\"]"
    },
    "run": {
      "args": [],
      "stdin": "{\"type\":\"step_start\",\"sessionID\":\"m1\",\"part\":{}}\n{\"type\":\"text\",\"sessionID\":\"m1\",\"part\":{\"text\":\"hi\"}}\n{\"type\":\"tool_use\",\"sessionID\":\"m1\",\"part\":{\"tool\":\"bash\"}}\n{\"type\":\"error\",\"sessionID\":\"m1\",\"error\":{\"name\":\"\\\"\",\"n\":[1,true,null],\"t\":\"\\b\\f\"}}\n{\"type\":\"step_finish\",\"sessionID\":\"m1\",\"part\":{\"reason\":\"stop\"}}\n",
      "extract": "lines"
    }
  },
  "q14": {
    "type": "trace",
    "run": {
      "args": [],
      "stdin": "{\"type\":\"item.completed\",\"item\":{\"type\":\"command_execution\",\"command\":\"ls\",\"exit_code\":0}}\n{\"type\":\"item.completed\",\"item\":{\"type\":\"command_execution\",\"command\":\"ls\",\"exit_code\":\"0\"}}\n{\"type\":\"item.completed\",\"item\":{\"type\":\"file_change\",\"changes\":[{\"path\":\"a.ts\"},null,[\"x\"],\"b.ts\",{\"path\":\" \"},{\"path\":\"c/d.ts\"}]}}\n{\"type\":\"item.completed\",\"item\":{\"type\":\"mcp_tool_call\",\"server\":false}}\n{\"type\":\"item.completed\",\"item\":{\"type\":\"error\",\"message\":\"bad\\nthing\"}}\n{\"type\":\"turn.completed\",\"usage\":{\"input_tokens\":null,\"output_tokens\":12}}\n{\"type\":\"error\",\"s\":\"é\\n\\t\\r~\\u007f\"}\n",
      "extract": "lines"
    }
  },
  "q15": {
    "type": "state",
    "run": {
      "args": [],
      "stdin": "{\"type\":\"heartbeat\",\"message\":\"one\"}\n   plain text with padding\n[1, 2]\n{\"type\":\"heartbeat\",\"message\":\"two\"}\n\"quoted\"\n{\"event\":\"heartbeat\",\"text\":\"three\"}\n{\"type\":\"thread.started\",\"thread_id\":\"t-9\"}\n{\"type\":\"heartbeat\",\"message\":\"four\"}\n{\"type\":\"assistant\",\"message\":\"hi\"}\n{\"id\":9}\n",
      "extract": "lines"
    }
  },
  "q16": {
    "type": "trace",
    "run": {
      "args": [
        "--follow",
        "{dir}/events.jsonl",
        "--pid",
        "{deadpid}",
        "--from",
        "4"
      ],
      "files": {
        "events.jsonl": {
          "utf8": "café ok\n{\"type\":\"turn.failed\",\"error\":{\"message\":\"naïve\"}}\nlast one\n",
          "appendHex": "e2"
        }
      },
      "extract": "lines-unstamped"
    }
  },
  "q17": {
    "type": "change",
    "change": {
      "constant": "CONTROL",
      "value": "/[\\x00-\\x1f]/gu"
    },
    "run": {
      "args": [],
      "stdin": "{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"a\\tb\\r\\nc\\nd\"}]}}\n",
      "extract": "lines"
    }
  },
  "q18": {
    "type": "state",
    "run": {
      "args": [],
      "stdin": "{\"stream\":{\"id\":\"A\"},\"payload_type\":\"run.output.delta\",\"payload\":{\"text\":\"hello\"}}\n{\"stream\":{\"id\":\"A\"},\"payload_type\":\"task.lifecycle.status\",\"payload\":{\"x\":1}}\n{\"stream\":{\"id\":\"A\"},\"payload_type\":\"run.output.delta\",\"payload\":{\"text\":\" there\"}}\n{\"stream\":{\"id\":\"A\"},\"payload_type\":\"run.model.configured\",\"payload\":{\"model_id\":\"m-2\"}}\n{\"stream\":{\"id\":\"A\"},\"payload_type\":\"run.output.delta\",\"payload\":{\"text\":\"   \"}}\n{\"stream\":{\"id\":\"A\"},\"payload_type\":\"tool.result\",\"payload\":{\"correlation_facts\":{\"tool_name\":\"edit_file\",\"outcome\":\"failed\"},\"edit_facts\":{\"path\":\"a.md\"}}}\n{\"stream\":{\"id\":\"A\"},\"payload_type\":\"run.output.delta\",\"payload\":{\"text\":\"bye\"}}\n{\"stream\":{\"id\":\"A\"},\"payload_type\":\"run.terminal.cancelled\",\"payload\":{\"terminal\":\"\",\"text\":\"  done  \"}}\n{\"stream\":{\"id\":\"A\"},\"payload_type\":\"run.output.delta\",\"payload\":{\"text\":\"after\"}}\n{\"stream\":{\"id\":\"A\"},\"payload_type\":\"run.model.configured\",\"payload\":{\"model_id\":\"m-3\"}}\n",
      "extract": "lines"
    }
  },
  "q19": {
    "type": "trace",
    "run": {
      "args": [
        "{dir}/events.jsonl"
      ],
      "files": {
        "events.jsonl": "{\"type\":\"note\",\"message\":\"mmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmm\"}\n{\"type\":\"memo\",\"message\":\"mmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmm\"}\n"
      },
      "extract": "lengths-and-ellipses"
    }
  },
  "q20": {
    "type": "change",
    "change": {
      "constant": "TOOL_KEYS",
      "value": "[\"description\", \"path\", \"command\"]"
    },
    "run": {
      "args": [],
      "stdin": "{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"tool_use\",\"name\":\"Bash\",\"input\":{\"command\":\"ls\",\"description\":\"List files\"}}]}}\n{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"tool_use\",\"name\":\"Read\",\"input\":{\"file_path\":\"/a.ts\",\"path\":\"/b.ts\"}}]}}\n{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"tool_use\",\"name\":\"Grep\",\"input\":{\"pattern\":\"TODO\",\"query\":\"fixme\"}}]}}\n{\"payload_type\":\"tool.result\",\"payload\":{\"correlation_facts\":{\"tool_name\":\"write\"},\"edit_facts\":{\"file_path\":\"x.ts\",\"description\":\"d\"}}}\n",
      "extract": "lines"
    }
  },
  "q21": {
    "type": "state",
    "run": {
      "args": [],
      "stdin": "{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"Ok\"}}\n{\"type\":\"result\",\"subtype\":\"success\",\"result\":\"Ok\"}\n{\"type\":\"message_end\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"thinking\",\"thinking\":\"hm\"},{\"type\":\"text\",\"text\":\"Yes\"}]}}\n{\"type\":\"text\",\"sessionID\":\"z\",\"part\":{\"text\":\"Yes\"}}\n{\"type\":\"result\",\"subtype\":\"success\",\"result\":\"Yes\"}\n{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"Yes\"}]}}\n{\"type\":\"result\",\"subtype\":\"success\",\"result\":\"Yes\"}\n{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"No\"}}\n{\"type\":\"result\",\"subtype\":\"success\",\"result\":\"No\"}\n",
      "extract": "lines"
    }
  },
  "q22": {
    "type": "trace",
    "run": {
      "args": [],
      "stdin": "{\"payload_type\":\"tool.result\",\"payload\":{\"correlation_facts\":{\"tool_name\":\"read_file\"},\"text\":\"  Read text file `src/a.ts`.\\n1|x\"}}\n{\"payload_type\":\"tool.result\",\"payload\":{\"correlation_facts\":{\"tool_name\":\"write_file\",\"outcome\":\"success\"},\"edit_facts\":{\"path\":\"out.txt\",\"description\":\"d\"},\"text\":\"{\\\"command\\\":\\\"echo hi\\\"}\"}}\n{\"payload_type\":\"tool.result\",\"payload\":{\"correlation_facts\":{\"tool_name\":\"shell\",\"outcome\":\"error\"},\"text\":\"{\\\"cmd\\\":\\\"false\\\"}\"}}\n{\"payload_type\":\"tool.result\",\"payload\":{}}\n{\"payload_type\":\"tool.result\",\"payload\":{\"correlation_facts\":{\"tool_name\":\"edit\",\"outcome\":null},\"edit_facts\":{\"file_path\":\"ef.ts\"},\"text\":\"{\\\"path\\\":\\\"blob.ts\\\"}\"}}\n{\"payload_type\":\"tool.result\",\"payload\":{\"correlation_facts\":{\"tool_name\":\"t3\"},\"text\":\"[{\\\"command\\\":\\\"x\\\"}]\"}}\n",
      "extract": "lines"
    }
  },
  "q23": {
    "type": "control-undetermined",
    "run": {
      "args": [
        "--follow",
        "{dir}/events.jsonl",
        "--pid",
        "{deadpid}"
      ],
      "files": {
        "events.jsonl": "{\"type\":\"session\",\"id\":\"s1\"}\n"
      },
      "extract": "first-unstamped-or-undetermined"
    }
  },
  "q24": {
    "type": "state",
    "run": {
      "args": [
        "--follow",
        "{dir}/events.jsonl",
        "--pid",
        "{deadpid}"
      ],
      "files": {
        "events.jsonl": "{\"stream\":{\"id\":\"s1\"},\"payload_type\":\"run.output.delta\",\"payload\":{\"text\":\"Checking \"}}\n{\"stream\":{\"id\":\"s1\"},\"payload_type\":\"tool.result\",\"payload\":{\"correlation_facts\":{\"tool_name\":\"bash\"},\"text\":\"{\\\"command\\\":\\\"make\\\"}\"}}\n{\"stream\":{\"id\":\"s1\"},\"payload_type\":\"run.output.delta\",\"payload\":{\"text\":\"Build \"}}\n{\"stream\":{\"id\":\"s1\"},\"payload_type\":\"run.output.delta\",\"payload\":{\"text\":\"passed.\"}}"
      },
      "extract": "lines-unstamped"
    }
  },
  "q25": {
    "type": "trace",
    "run": {
      "args": [
        "--follow",
        "{dir}/events.jsonl",
        "--pid",
        "{deadpid}"
      ],
      "env": {
        "COLUMNS": " +5_0 "
      },
      "files": {
        "events.jsonl": "{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"ok  pneumonoultramicroscopicsilicovolcanoconiosis is cool\\n\\nbye\"}}\n"
      },
      "extract": "lines-unstamped"
    }
  },
  "q26": {
    "type": "change",
    "change": {
      "constant": "LINE_BOUNDARY",
      "value": "/\\n/u"
    },
    "run": {
      "args": [
        "--follow",
        "{dir}/events.jsonl",
        "--pid",
        "{deadpid}"
      ],
      "files": {
        "events.jsonl": "ab\rcd\n{\"type\":\"session\",\"id\":\"s1\"}\r"
      },
      "extract": "lines-unstamped"
    }
  }
};

// A pid that no process can have: the viewer sees "already exited" at once.
const DEAD_PID = "99999999";
const STAMP = /^\d{2}:\d{2}:\d{2}(?: |$)/u;

function childEnv(extra: Record<string, string> | undefined): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  delete env.COLUMNS;
  delete env.POSTMASTER_PROC_ROOT;
  return Object.assign(env, extra ?? {});
}

function toLines(s: string): string[] {
  if (s === "") return [];
  const parts = s.split("\n");
  if (parts[parts.length - 1] === "") parts.pop();
  return parts;
}

function replaceConst(src: string, name: string, value: string): string {
  // `const NAME = <literal>;` at the start of a line (an `export` prefix, indentation and a type
  // annotation are tolerated); the literal runs to the first `;`, so it may span several lines.
  const re = new RegExp(`^([ \\t]*(?:export[ \\t]+)?)const[ \\t]+${name}(?:[ \\t]*:[^=;]+)?[ \\t]*=[^;]*;`, "gmu");
  const hits = src.match(re) ?? [];
  if (hits.length !== 1) throw new Error(`constant ${name}: ${hits.length} declarations`);
  return src.replace(re, (_all, head: string) => `${head}const ${name} = ${value};`);
}

function runCli(mod: string, run: RunSpec): unknown {
  let dir: string | null = null;
  const made: string[] = [];
  try {
    const files = run.files ?? {};
    if (Object.keys(files).length > 0) {
      dir = mkdtempSync(join(tmpdir(), "view-stream-gt-"));
      for (const [name, content] of Object.entries(files)) {
        const p = join(dir, name);
        writeFileSync(p, typeof content === "string" ? content : Buffer.concat([Buffer.from(content.utf8, "utf8"), Buffer.from(content.appendHex, "hex")]));
        made.push(p);
      }
    }
    const args = run.args.map((a) => a.split("{dir}").join(dir ?? "").split("{deadpid}").join(DEAD_PID));
    const r = spawnSync(process.execPath, ["--no-env-file", "--config=/dev/null", mod, ...args], {
      input: run.stdin ?? "",
      env: childEnv(run.env),
      cwd: dir ?? tmpdir(),
      timeout: 20000,
    });
    if (r.error) throw r.error;
    if (r.status === null) throw new Error(`killed by ${r.signal}`);
    const out = r.stdout.toString("utf8");
    const err = r.stderr.toString("utf8");
    switch (run.extract) {
      case "lines":
        return toLines(out);
      case "lines-unstamped":
        // A followed line always opens with the time; one that does not is reported as it is, marked.
        return toLines(out).map((l) => (STAMP.test(l) ? l.replace(STAMP, "") : `NO-TIME:${l}`));
      case "line-lengths":
        return toLines(out).map((l) => [...l].length);
      case "result-lines":
        return toLines(out).filter((l) => l.startsWith("result:"));
      case "lengths-and-ellipses": {
        const ls = toLines(out);
        return { lengths: ls.map((l) => [...l].length), ellipses: ls.filter((l) => l.includes("\u2026")).length };
      }
      case "exit-stderr":
        return { exit: r.status, stderr: err.endsWith("\n") ? err.slice(0, -1) : err };
      case "first-unstamped-or-undetermined": {
        const ls = toLines(out);
        // A line that opens with the time of day is not fixed by the inputs.
        if (ls.length > 0 && STAMP.test(ls[0]!)) return "undetermined";
        return ls[0] ?? "";
      }
    }
  } finally {
    for (const p of made) {
      try {
        unlinkSync(p);
      } catch {}
    }
    if (dir !== null) {
      try {
        rmdirSync(dir);
      } catch {}
    }
  }
}

async function answer(id: string, spec: Spec, modPath: string): Promise<unknown> {
  let target = modPath;
  let tmpMod: string | null = null;
  try {
    if (spec.change) {
      tmpMod = join(dirname(modPath), `${basename(modPath, ".ts")}.gt-${process.pid}-${id}.ts`);
      writeFileSync(tmpMod, replaceConst(readFileSync(modPath, "utf8"), spec.change.constant, spec.change.value));
      target = tmpMod;
    }
    if (spec.call) {
      const ns = (await import(pathToFileURL(target).href)) as Record<string, (...a: unknown[]) => unknown>;
      return ns[spec.call.export]!(...spec.call.args);
    }
    if (spec.exports) {
      const ns = (await import(pathToFileURL(target).href)) as Record<string, unknown>;
      const names = Object.keys(ns).sort();
      return names.length === 1 ? names[0] : names;
    }
    return runCli(target, spec.run!);
  } catch (error) {
    return `ERROR: ${String(error).slice(0, 120)}`;
  } finally {
    if (tmpMod !== null) {
      try {
        unlinkSync(tmpMod);
      } catch {}
    }
  }
}

const modArg = process.argv[2];
if (!modArg) {
  console.error("usage: bun --no-env-file --config=/dev/null ground-truth.ts <path to a copy of view-stream.ts>");
  process.exit(2);
}
const modPath = resolve(modArg);
const result: Record<string, unknown> = {};
for (const [id, spec] of Object.entries(SPEC)) result[id] = await answer(id, spec, modPath);
console.log(JSON.stringify(result));
