// Tests beside scripts/verify-examples.ts, moved from its --self-test on #109: 35 controls.
// The self-test built later fixtures between controls; they are built here in beforeAll
// instead, so each test passes alone as well as in file order. The spaced-path control
// re-runs this file with bun test instead of --self-test. Conditional controls are gated
// by test.skipIf; skips.toml carries the reasons.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { run } from "./lib/proc.ts";
import {
  blocks,
  exampleEnv,
  examples,
  FENCE,
  findInPath,
  section,
  shlexSplit,
  ticketLines,
  TIMEOUT,
  transcript,
  trim,
} from "./verify-examples.ts";

const SELF = join(import.meta.dir, "run");

const spacedDone = process.env.POSTMASTER_SPACED_DONE === "1";
const hasEcho = existsSync("/bin/echo");

let tmp = "";

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "postmaster-"));

  mkdirSync(join(tmp, "app", "bin"), { recursive: true });
  writeFileSync(
    join(tmp, "app", "package.json"),
    '{"name": "greeter", "bin": {"greet": "bin/greet"}}\n',
    "utf8",
  );
  writeFileSync(
    join(tmp, "app", "bin", "greet"),
    `#!/usr/bin/env bash
case "\${1:-}" in
  "") echo "usage: greet <name> | greet save <name> | greet saved" >&2; exit 2 ;;
  save) echo "$2" > saved.txt; echo "saved $2" ;;
  saved) cat saved.txt 2>/dev/null || { echo "nothing saved" >&2; exit 1; } ;;
  *) echo "hello $1" ;;
esac
`,
    "utf8",
  );
  chmodSync(join(tmp, "app", "bin", "greet"), 0o644);
  mkdirSync(join(tmp, "nobin"), { recursive: true });
  mkdirSync(join(tmp, "noshebang", "bin"), { recursive: true });
  mkdirSync(join(tmp, "built", "bin"), { recursive: true });
  mkdirSync(join(tmp, "broken"), { recursive: true });
  writeFileSync(join(tmp, "nobin", "package.json"), '{"name": "plain"}\n', "utf8");
  writeFileSync(
    join(tmp, "noshebang", "package.json"),
    '{"name": "x", "bin": {"x": "bin/x.sh"}}\n',
    "utf8",
  );
  writeFileSync(join(tmp, "noshebang", "bin", "x.sh"), "echo hi\n", "utf8");
  writeFileSync(
    join(tmp, "built", "package.json"),
    '{"name": "built", "bin": "dist/built.js", "scripts": {"build": "mkdir -p dist && cp bin/src.js dist/built.js"}}\n',
    "utf8",
  );
  writeFileSync(
    join(tmp, "built", "bin", "src.js"),
    "console.log('built ' + process.argv[2]);\n",
    "utf8",
  );
  writeFileSync(
    join(tmp, "broken", "package.json"),
    '{"name": "broken", "bin": "dist/broken.js", "scripts": {"build": "exit 4"}}\n',
    "utf8",
  );

  writeFileSync(
    join(tmp, "pass.md"),
    `## User journey
The user greets someone, saves a name and reads it back; a new directory has nothing saved.

\`\`\`
$ greet world
hello world
$ greet
usage: greet <name> | greet save <name> | greet saved
[exit 2]
$ greet save ann
saved ann
$ greet saved
ann
$ test "$HOME" = "$PWD" && echo home is the block
home is the block
\`\`\`

~~~sh
$ greet saved
nothing saved
[exit 1]
~~~
`,
    "utf8",
  );
  writeFileSync(
    join(tmp, "output.md"),
    `## User journey
\`\`\`
$ greet world
hello there
\`\`\`
`,
    "utf8",
  );
  writeFileSync(
    join(tmp, "exit.md"),
    `## User journey
\`\`\`
$ greet
usage: greet <name> | greet save <name> | greet saved
\`\`\`
`,
    "utf8",
  );
  writeFileSync(
    join(tmp, "none.md"),
    `## Problem / feature
Today \`greet\` with no name greets nobody:

\`\`\`
$ greet
hello
\`\`\`

## User journey
The user types \`greet world\` and sees \`hello world\`.

\`\`\`json
{"not": "a transcript"}
\`\`\`
`,
    "utf8",
  );
  writeFileSync(join(tmp, "nojourney.md"), "## Problem / feature\nGreet people.\n", "utf8");
  writeFileSync(
    join(tmp, "waybill.md"),
    `# Waybill: T-1

## Ticket
## Problem / feature
Greet people.

## User journey
\`\`\`
$ greet ann
hello ann
\`\`\`

## Project profile
repo: /somewhere

\`\`\`
$ greet ann
this block is not the ticket's, and would fail
\`\`\`
`,
    "utf8",
  );
  writeFileSync(
    join(tmp, "built.md"),
    `## User journey
\`\`\`
$ built ok
built ok
\`\`\`
`,
    "utf8",
  );

  mkdirSync(join(tmp, "pathbin", "bin"), { recursive: true });
  writeFileSync(
    join(tmp, "pathbin", "package.json"),
    `{"name": "p", "bin": {"${join(tmp, "victim")}": "bin/greet"}}\n`,
    "utf8",
  );
  run("cp", [join(tmp, "app", "bin", "greet"), join(tmp, "pathbin", "bin")]);

  mkdirSync(join(tmp, "nointerp", "bin"), { recursive: true });
  writeFileSync(
    join(tmp, "nointerp", "package.json"),
    '{"name": "n", "bin": {"greet": "bin/greet"}}\n',
    "utf8",
  );
  writeFileSync(
    join(tmp, "nointerp", "bin", "greet"),
    "#!/usr/bin/env no-such-interpreter-xyz\necho hi\n",
    "utf8",
  );

  mkdirSync(join(tmp, "fewtools"), { recursive: true });
  for (const t of ["bash", "bun", "dirname"]) {
    const found = findInPath(t, process.env.PATH || "");
    if (found) {
      try {
        symlinkSync(found, join(tmp, "fewtools", t));
      } catch {
        /* exists */
      }
    }
  }

  mkdirSync(join(tmp, "empty"), { recursive: true });

  writeFileSync(
    join(tmp, "stall.md"),
    "## User journey\nA stuck shell.\n\n```\n$ sleep 30\nnothing comes\n```\n",
    "utf8",
  );

  mkdirSync(join(tmp, "quoted", "bin"), { recursive: true });
  writeFileSync(
    join(tmp, "quoted", "package.json"),
    '{"name": "quoted", "bin": {"q": "bin/q"}}\n',
    "utf8",
  );
  writeFileSync(join(tmp, "quoted", "bin", "q"), '#!"/bin/echo" tagged\necho never\n', "utf8");
  const qf = resolve(join(tmp, "quoted", "bin", "q"));
  writeFileSync(
    join(tmp, "quoted.md"),
    `## User journey\nA quoted interpreter.\n\n\`\`\`\n$ q hello\ntagged ${qf} hello\n\`\`\`\n`,
    "utf8",
  );

  mkdirSync(join(tmp, "unbalanced", "bin"), { recursive: true });
  writeFileSync(
    join(tmp, "unbalanced", "package.json"),
    '{"name": "unbalanced", "bin": {"u": "bin/u"}}\n',
    "utf8",
  );
  writeFileSync(join(tmp, "unbalanced", "bin", "u"), '#!/bin/echo "oops\necho never\n', "utf8");
  writeFileSync(
    join(tmp, "unbalanced.md"),
    "## User journey\nAn unbalanced quote.\n\n```\n$ u hello\nwhatever\n```\n",
    "utf8",
  );
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const runExample = (project: string, ticket: string): { code: number; out: string } => {
  const r = run(SELF, ["verify-examples", join(tmp, project), "--ticket", ticket]);
  return { code: r.code, out: r.out + r.err };
};

const checkExample = (
  project: string,
  ticket: string,
  exit: number,
  wantIn?: string,
): { code: number; out: string } => {
  const r = runExample(project, ticket);
  expect(r.code).toBe(exit);
  if (wantIn !== undefined && wantIn !== "") expect(r.out.includes(wantIn)).toBe(true);
  return r;
};

describe("unicode primitives", () => {
  test("a fence may open after U+001C", () => {
    expect(FENCE.exec("\x1c```") !== null).toBe(true);
  });

  test("an exit marker may be Arabic-Indic", () => {
    expect(transcript(["$ x", "[exit ٣]"])).toEqual([{ cmd: "x", out: [], exit: 3 }]);
  });

  test("a Ticket heading with U+001F opens the ticket", () => {
    expect(ticketLines("x\n##\x1fTicket\nbody\n")).toEqual(["body"]);
  });

  test("a U+001C opens a new line (splitlines)", () => {
    expect(ticketLines("x\x1c## Ticket\ny")).toEqual(["y"]);
  });

  test("a Project profile heading with U+001F ends the ticket", () => {
    expect(ticketLines("## Ticket\na\n##\x1fProject profile\nb\n")).toEqual(["a"]);
  });

  test("section titles fold dotted-I", () => {
    expect(section(["## ticket", "x"], "TİCKET")).toEqual(["x"]);
  });

  test("a fence may close after U+001F", () => {
    expect(blocks(["```", "x", "\x1f```", "y"])).toEqual([["x"]]);
  });

  test("a heading with U+001F ends the section", () => {
    expect(section(["## T", "a", "#\x1fb", "c"], "T")).toEqual(["a"]);
  });

  test("trim keeps a trailing FEFF (not Python space)", () => {
    expect(trim(["x\uFEFF"])).toEqual(["x\uFEFF"]);
  });
});

describe("fence runs longer than three", () => {
  test("a four-backtick fence opens and closes, as BASE opens `{3,}`", () => {
    expect(blocks(["````", "$ hi", "````", "after"])).toEqual([["$ hi"]]);
  });
  test("four backticks close a three-backtick block, as BASE closes longer runs", () => {
    expect(blocks(["```", "$ hi", "````", "after"])).toEqual([["$ hi"]]);
  });
  test("a heading inside a four-backtick fence does not end the section", () => {
    expect(section(["## T", "````", "## U", "````", "b"], "T")).toEqual([
      "````",
      "## U",
      "````",
      "b",
    ]);
  });
});

describe("example shell environment", () => {
  test("example shells run with BASH_ENV truly unset, as BASE unsets it", () => {
    const probeEnv = join(tmp, "bash-env-probe.sh");
    writeFileSync(probeEnv, "echo BASH-ENV-LEAKED\n");
    const bashAbs = run("bash", ["-c", "command -v bash"]).out.trim() || "/bin/bash";
    const saved = process.env.BASH_ENV;
    process.env.BASH_ENV = probeEnv;
    const r = run(bashAbs, ["-c", 'echo "BASH_ENV=${BASH_ENV-unset}"'], {
      env: exampleEnv(join(tmp, "envhome"), "/nonexistent-shims", "/nonexistent-run"),
    });
    if (saved === undefined) delete process.env.BASH_ENV;
    else process.env.BASH_ENV = saved;
    expect(r.out.includes("BASH_ENV=unset") && !r.out.includes("LEAKED")).toBe(true);
  });
});

describe("positive controls", () => {
  test("matching transcripts pass, exits and state within a block included", () => {
    checkExample("app", join(tmp, "pass.md"), 0, "6 of 6 example commands");
  });

  test("only a waybill's ticket part is read", () => {
    checkExample("app", join(tmp, "waybill.md"), 0, "1 of 1");
  });

  test("a build script runs before the bin is looked for", () => {
    checkExample("built", join(tmp, "built.md"), 0, "1 of 1");
  });
});

describe("negative controls", () => {
  test("a different output fails and shows both", () => {
    checkExample("app", join(tmp, "output.md"), 1, "hello there");
  });

  test("a different exit fails and names both", () => {
    checkExample("app", join(tmp, "exit.md"), 1, "exit: expected 0, got 2");
  });

  test("a failed build fails", () => {
    checkExample("broken", join(tmp, "built.md"), 1, "the build failed");
  });

  test("a transcript outside the User journey is no example", () => {
    checkExample("app", join(tmp, "none.md"), 3, "User journey has no example transcript");
  });

  test("a ticket with no User journey is not run", () => {
    checkExample("app", join(tmp, "nojourney.md"), 3, "has no User journey");
  });

  test("a bin named with a path is not run", () => {
    checkExample("pathbin", join(tmp, "pass.md"), 3, "not a plain command name");
  });

  test("and nothing is written where it points", () => {
    checkExample("pathbin", join(tmp, "pass.md"), 3, "not a plain command name");
    expect(existsSync(join(tmp, "victim"))).toBe(false);
  });

  test("a bin whose interpreter is not installed is not run", () => {
    checkExample("nointerp", join(tmp, "pass.md"), 3, "runs through no-such-interpreter-xyz");
  });

  test("a build whose package manager is not installed is not run", () => {
    const r = run(
      SELF,
      ["verify-examples", join(tmp, "built"), "--ticket", join(tmp, "built.md")],
      {
        env: { ...process.env, PATH: join(tmp, "fewtools") },
      },
    );
    const out = r.out + r.err;
    expect(r.code).toBe(3);
    expect(out.includes("run through npm, which is not on PATH")).toBe(true);
  });

  test("a project with no bin is not run", () => {
    checkExample("nobin", join(tmp, "pass.md"), 3, "names no bin");
  });

  test("a bin with no #! line is not run", () => {
    checkExample("noshebang", join(tmp, "pass.md"), 3, "has no #! line");
  });

  test("a missing ticket is not run", () => {
    checkExample("app", join(tmp, "no-such-ticket.md"), 3, "no ticket at");
  });

  test("a project with no package.json is not run", () => {
    checkExample("empty", join(tmp, "pass.md"), 3, "no package.json");
  });

  test.skipIf(spacedDone)(
    "the self-test passes from a path with a space",
    () => {
      const spaced = join(tmp, "my dir", "scripts");
      cpSync(import.meta.dir, spaced, { recursive: true });
      cpSync(join(import.meta.dir, "..", "bunfig.toml"), join(spaced, "..", "bunfig.toml"));
      const r = run("bun", ["test", join(spaced, "verify-examples.test.ts")], {
        env: { ...process.env, POSTMASTER_SPACED_DONE: "1" },
      });
      expect(r.code).toBe(0);
    },
    180000,
  );
});

describe("timeouts", () => {
  test("examples allow 60 seconds a shell, as BASE does", () => {
    expect(TIMEOUT).toBe(60);
  });

  test("a stalled example is cut off with BASE's message and no exit", () => {
    const lines: string[] = [];
    const origLog = console.log;
    console.log = (...a: unknown[]) => {
      lines.push(a.map(String).join(" "));
    };
    let rc = 0;
    try {
      rc = examples(join(tmp, "app"), join(tmp, "stall.md"), 1);
    } finally {
      console.log = origLog;
    }
    expect(rc).toBe(1);
    expect(lines.some((l) => l.includes("(timed out after 1s)"))).toBe(true);
    expect(lines.some((l) => l.includes("got none, it timed out"))).toBe(true);
  }, 30000);
});

describe("#! line splitting", () => {
  test("a #! line splits as shlex.split does, quotes and errors alike", () => {
    const vectors = [
      "",
      "a b",
      '"a b" c',
      "'a b'",
      'a"b c"d',
      "x\\ y",
      '"unclosed',
      "'unclosed",
      "trailing\\",
      "/usr/bin/env python3 -u",
      '"a""b"',
      "a#b",
      '"a\\$b"',
      '"a\\"b"',
    ];
    const wants: Array<string[] | string> = [
      [],
      ["a", "b"],
      ["a b", "c"],
      ["a b"],
      ["ab cd"],
      ["x y"],
      "RAISES",
      "RAISES",
      "RAISES",
      ["/usr/bin/env", "python3", "-u"],
      ["ab"],
      ["a#b"],
      ["a\\$b"],
      ['a"b'],
    ];
    expect(wants.length).toBe(vectors.length);
    const mismatches: string[] = [];
    wants.forEach((want, i) => {
      let got: string[] | string;
      try {
        got = shlexSplit(vectors[i] ?? "");
      } catch {
        got = "RAISES";
      }
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        mismatches.push(
          `${JSON.stringify(vectors[i])}: port=${JSON.stringify(got)} base=${JSON.stringify(want)}`,
        );
      }
    });
    expect(mismatches).toEqual([]);
  });

  test.skipIf(!hasEcho)(
    "a quoted #! program splits as shlex splits, and runs",
    () => {
      checkExample("quoted", join(tmp, "quoted.md"), 0, "1 of 1");
    },
    30000,
  );

  test.skipIf(!hasEcho)(
    "an unbalanced #! quote fails as BASE's shlex raises",
    () => {
      checkExample("unbalanced", join(tmp, "unbalanced.md"), 1);
    },
    30000,
  );
});
