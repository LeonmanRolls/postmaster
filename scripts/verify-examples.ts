// The default check for a command-line app: run the ticket's examples through the project's own
// command. An example is a transcript in the ticket's `## User journey`: a fenced block whose first
// line starts with `$ `. A transcript anywhere else, such as one showing a bug as it is, is not an
// example. Each `$ ` line is a command, and the lines after it, up to the next `$ ` line, are what it
// prints, stdout and stderr together as a terminal shows them. A last line `[exit N]` says it
// exits N; without one it must exit 0. Each block runs in a fresh empty directory, which is also
// HOME, one command at a time through bash, so a later command sees what an earlier one wrote and
// no block sees another's.
//
//   verify-examples.sh [<worktree>] [--ticket <file>]
//   verify-examples.sh --self-test
//
//   exit 0  every command printed what its example says and exited as it says
//   exit 1  one did not, or the build failed; each difference is shown
//   exit 3  not run: no ticket, no transcript in its User journey, no command to run it through, or
//           a tool the command or its build needs is not on PATH; the reason is the last line
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { die, run, withTempDir } from "./lib/proc.ts";
import { SelfTest } from "./lib/selftest.ts";

const FENCE = /^(\s*)(`{3,}|~{3,})(.*)$/;
const EXIT_RE = /\[exit (\d+)\]/;
const BIN_NAME = /^[A-Za-z0-9@._+-]+$/;
const _TIMEOUT = 60;

function notRun(msg: string): never {
  console.log(`not run: ${msg}`);
  process.exit(3);
  throw new Error("unreachable");
}

function ticketLines(text: string): string[] {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /^##\s+Ticket\s*$/.test(l));
  if (start === -1) return lines;
  const end = lines.findIndex((l, i) => i > start && /^##\s+Project profile\s*$/.test(l));
  return lines.slice(start + 1, end === -1 ? lines.length : end);
}

function section(lines: string[], title: string): string[] | null {
  const re = new RegExp(`^##\\s+${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i");
  const start = lines.findIndex((l) => re.test(l));
  if (start === -1) return null;
  const out: string[] = [];
  let fence: string | null = null;
  for (const l of lines.slice(start + 1)) {
    const m = FENCE.exec(l);
    if (fence === null && /^#{1,2}\s/.test(l)) break;
    if (m && fence === null && !(m[2]?.[0] === "`" && m[3]?.includes("`"))) {
      fence = m[2]!;
    } else if (
      m &&
      fence !== null &&
      m[2]?.[0] === fence[0] &&
      m[2]?.length >= fence.length &&
      !m[3]?.trim()
    ) {
      fence = null;
    }
    out.push(l);
  }
  return out;
}

function blocks(lines: string[]): string[][] {
  const out: string[][] = [];
  let i = 0;
  while (i < lines.length) {
    const m = FENCE.exec(lines[i]!);
    if (m && !(m[2]?.[0] === "`" && m[3]?.includes("`"))) {
      const indent = m[1]?.length;
      const fence = m[2]!;
      const body: string[] = [];
      i += 1;
      while (i < lines.length) {
        const c = /^\s*(`{3,}|~{3,})\s*$/.exec(lines[i]!);
        if (c && c[1]?.[0] === fence[0] && c[1]?.length >= fence.length) break;
        body.push(lines[i]?.replace(new RegExp(`^ {0,${indent}}`), ""));
        i += 1;
      }
      out.push(body);
    }
    i += 1;
  }
  return out;
}

function trim(lines: string[]): string[] {
  const out = lines.map((l) => l.replace(/\s+$/, ""));
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out;
}

interface Cmd {
  cmd: string;
  out: string[];
  exit: number;
}

function transcript(body: string[]): Cmd[] | null {
  const first = body.find((l) => l.trim());
  if (!first?.startsWith("$ ")) return null;
  const cmds: Array<{ cmd: string; out: string[] }> = [];
  for (const l of body) {
    if (l.startsWith("$ ")) {
      cmds.push({ cmd: l.slice(2).trim(), out: [] });
    } else if (cmds.length > 0) {
      cmds[cmds.length - 1]?.out.push(l);
    }
  }
  const result: Cmd[] = [];
  for (const c of cmds) {
    let out = trim(c.out);
    let exit = 0;
    if (out.length > 0) {
      const m = EXIT_RE.exec(out[out.length - 1]?.trim());
      if (m && out[out.length - 1]?.trim().match(/^\[exit \d+\]$/)) {
        exit = parseInt(m[1]!, 10);
        out = trim(out.slice(0, -1));
      }
    }
    result.push({ cmd: c.cmd, out, exit });
  }
  return result;
}

function examples(wtArg: string, ticketArg: string): number {
  const wt = resolve(wtArg);
  let ticket = ticketArg;
  if (!ticket) {
    const spec = process.env.POSTMASTER_VERIFY || join(wt, ".postmaster", "verify");
    ticket = join(spec, "ticket.md");
  }
  let text: string;
  try {
    text = readFileSync(ticket, "utf8");
  } catch {
    notRun(`no ticket at ${ticket}; scripts/verify.sh arm copies the run's there`);
  }
  const journey = section(ticketLines(text!), "User journey");
  if (journey === null) {
    notRun("the ticket has no User journey, where a command-line app's example transcripts go");
  }
  const scripts = blocks(journey!)
    .map((b) => transcript(b))
    .filter((t): t is Cmd[] => t !== null);
  if (scripts.length === 0) {
    notRun(
      "the ticket's User journey has no example transcript: a fenced block whose first line starts with `$ `",
    );
  }

  const pkgFile = join(wt, "package.json");
  if (!existsSync(pkgFile)) {
    notRun(
      `no package.json in ${wt}, so no command to run the examples through; this default runs a package.json project's bin, so declare the check in .postmaster/project.toml`,
    );
  }
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(readFileSync(pkgFile, "utf8"));
  } catch (e) {
    notRun(`package.json does not parse: ${e instanceof Error ? e.message : String(e)}`);
  }
  const raw = pkg?.bin;
  let bins: Record<string, string> = {};
  if (typeof raw === "string") {
    const name =
      String(pkg?.name || "")
        .split("/")
        .pop() || "";
    if (name) bins = { [name]: raw };
  } else if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof k === "string" && typeof v === "string") bins[k] = v;
    }
  }
  if (Object.keys(bins).length === 0) {
    notRun("package.json names no bin, so no command to run the examples through");
  }
  for (const name of Object.keys(bins)) {
    if (!BIN_NAME.test(name) || name === "." || name === "..") {
      notRun(`package.json names a bin '${name}', which is not a plain command name`);
    }
  }
  const runpath = join(wt, "node_modules", ".bin") + delimiter + (process.env.PATH || "");

  const scriptsRaw = pkg?.scripts;
  if (
    scriptsRaw &&
    typeof scriptsRaw === "object" &&
    (scriptsRaw as Record<string, unknown>).build
  ) {
    const bun = existsSync(join(wt, "bun.lock")) || existsSync(join(wt, "bun.lockb"));
    const pm = existsSync(join(wt, "pnpm-lock.yaml"))
      ? "pnpm"
      : bun
        ? "bun"
        : existsSync(join(wt, "yarn.lock"))
          ? "yarn"
          : "npm";
    if (!which(pm, process.env.PATH || "")) {
      notRun(`package.json has a build script, run through ${pm}, which is not on PATH`);
    }
    const r = run(pm, ["run", "build"], { cwd: wt, input: "" });
    if (r.code !== 0) {
      console.log(r.out.trimEnd());
      console.log(`FAIL  the build failed: ${pm} run build exited ${r.code}`);
      return 1;
    }
  }

  // make shims
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "verify-examples-")));
  process.on("exit", () => {
    try {
      rmSync(scratch, { recursive: true, force: true });
    } catch {
      // cleanup is best-effort
    }
  });
  const shims = join(scratch, "bin");
  mkdirSync(shims);
  for (const [name, rel] of Object.entries(bins)) {
    const f = resolve(join(wt, rel));
    if (!existsSync(f)) {
      console.log(`FAIL  bin ${name} names ${rel}, which is not a file`);
      return 1;
    }
    const first = readFileSync(f, "utf8").split("\n")[0] ?? "";
    let argv: string[];
    if (first.startsWith("#!")) {
      argv = first.slice(2).trim().split(/\s+/);
    } else if (f.endsWith(".js") || f.endsWith(".mjs") || f.endsWith(".cjs")) {
      argv = ["node"];
    } else {
      notRun(`cannot tell how to run bin ${name}: ${rel} has no #! line`);
    }
    let prog = argv[0] || "";
    if (basename(prog) === "env") {
      prog = argv.slice(1).find((a) => !a.startsWith("-") && !a.includes("=")) || "";
    }
    if (!prog || (prog.includes("/") ? !canExecute(prog) : !which(prog, runpath))) {
      notRun(`bin ${name} runs through ${prog || "an empty #! line"}, which is not on PATH`);
    }
    const shim = join(shims, name);
    writeFileSync(
      shim,
      `#!/bin/sh\nexec ${argv.map((a) => shQuote(a)).join(" ")} ${shQuote(f)} "$@"\n`,
    );
    chmodSync(shim, 0o755);
  }

  let failed = 0;
  let ran = 0;
  for (let n = 0; n < scripts.length; n++) {
    const cmds = scripts[n]!;
    const home = join(scratch, `block-${n + 1}`);
    mkdirSync(home);
    const env = {
      ...process.env,
      HOME: home,
      PWD: home,
      NO_COLOR: "1",
      PATH: shims + delimiter + runpath,
    };
    delete (env as Record<string, unknown>).BASH_ENV;
    for (const c of cmds) {
      ran += 1;
      const r = run("bash", ["-c", c.cmd], { cwd: home, env, input: "" });
      const got = trim((r.out + r.err).replace(/\r\n/g, "\n").split("\n"));
      const code = r.code;
      if (JSON.stringify(got) === JSON.stringify(c.out) && code === c.exit) {
        console.log(`ok    $ ${c.cmd}`);
        continue;
      }
      failed += 1;
      console.log(`FAIL  $ ${c.cmd}`);
      if (JSON.stringify(got) !== JSON.stringify(c.out)) {
        console.log("      expected:");
        console.log(
          c.out
            .slice(0, 20)
            .map((l) => `        ${l}`)
            .join("\n") || "        (nothing)",
        );
        console.log("      got:");
        console.log(
          got
            .slice(0, 20)
            .map((l) => `        ${l}`)
            .join("\n") || "        (nothing)",
        );
      }
      if (code !== c.exit) {
        console.log(`      exit: expected ${c.exit}, got ${code}`);
      }
    }
  }
  console.log(`${ran - failed} of ${ran} example commands did what the ticket says`);
  return failed ? 1 : 0;
}

function canExecute(p: string): boolean {
  try {
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** shutil.which: a runnable file named prog in one of path's directories. */
function findInPath(prog: string, path: string): string | null {
  for (const dir of path.split(delimiter)) {
    if (!dir) continue;
    const f = join(dir, prog);
    try {
      if (statSync(f).isFile() && canExecute(f)) return f;
    } catch {
      // not in this directory
    }
  }
  return null;
}

function which(prog: string, path: string): boolean {
  return findInPath(prog, path) !== null;
}

function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

// --- entry -----------------------------------------------------------------------------------
const argv = process.argv.slice(2);
if (argv[0] === "--self-test") {
  // fall through
} else {
  let WT = ".";
  let TICKET = "";
  let i = 0;
  while (i < argv.length) {
    if (argv[i] === "--ticket") {
      if (argv.length < i + 2)
        die("usage: verify-examples.sh [<worktree>] [--ticket <file>] | --self-test", 1);
      TICKET = argv[i + 1] ?? "";
      i += 2;
    } else if (argv[i]?.startsWith("-")) {
      die("usage: verify-examples.sh [<worktree>] [--ticket <file>] | --self-test", 1);
    } else {
      WT = argv[i] ?? ".";
      i += 1;
    }
  }
  if (!existsSync(WT)) {
    console.error(`verify-examples: no such directory: ${WT}`);
    process.exit(1);
  }
  process.exit(examples(WT, TICKET));
}

// --- self-test ---------------------------------------------------------------------------------
withTempDir((tmp) => {
  const SELF = join(dirname(new URL(import.meta.url).pathname), "verify-examples.sh");
  const st = new SelfTest();

  function expect(
    label: string,
    exit: number,
    project: string,
    ticket: string,
    wantIn?: string,
  ): void {
    const r = run("bash", [SELF, join(tmp, project), "--ticket", ticket]);
    const out = r.out + r.err;
    if (r.code === exit && (wantIn === undefined || wantIn === "" || out.includes(wantIn))) {
      st.ok(label);
    } else {
      st.fail(`${label} (exit ${r.code})`, out);
    }
  }

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

  console.log("positive controls");
  expect(
    "matching transcripts pass, exits and state within a block included",
    0,
    "app",
    join(tmp, "pass.md"),
    "6 of 6 example commands",
  );
  expect("only a waybill's ticket part is read", 0, "app", join(tmp, "waybill.md"), "1 of 1");
  expect(
    "a build script runs before the bin is looked for",
    0,
    "built",
    join(tmp, "built.md"),
    "1 of 1",
  );

  console.log("negative controls");
  expect(
    "a different output fails and shows both",
    1,
    "app",
    join(tmp, "output.md"),
    "hello there",
  );
  expect(
    "a different exit fails and names both",
    1,
    "app",
    join(tmp, "exit.md"),
    "exit: expected 0, got 2",
  );
  expect("a failed build fails", 1, "broken", join(tmp, "built.md"), "the build failed");
  expect(
    "a transcript outside the User journey is no example",
    3,
    "app",
    join(tmp, "none.md"),
    "User journey has no example transcript",
  );
  expect(
    "a ticket with no User journey is not run",
    3,
    "app",
    join(tmp, "nojourney.md"),
    "has no User journey",
  );
  mkdirSync(join(tmp, "pathbin", "bin"), { recursive: true });
  writeFileSync(
    join(tmp, "pathbin", "package.json"),
    `{"name": "p", "bin": {"${join(tmp, "victim")}": "bin/greet"}}\n`,
    "utf8",
  );
  run("cp", [join(tmp, "app", "bin", "greet"), join(tmp, "pathbin", "bin")]);
  expect(
    "a bin named with a path is not run",
    3,
    "pathbin",
    join(tmp, "pass.md"),
    "not a plain command name",
  );
  st.check("and nothing is written where it points", !existsSync(join(tmp, "victim")));
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
  expect(
    "a bin whose interpreter is not installed is not run",
    3,
    "nointerp",
    join(tmp, "pass.md"),
    "runs through no-such-interpreter-xyz",
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
  {
    const r = run("bash", [SELF, join(tmp, "built"), "--ticket", join(tmp, "built.md")], {
      env: { ...process.env, PATH: join(tmp, "fewtools") },
    });
    const out = r.out + r.err;
    st.check(
      "a build whose package manager is not installed is not run",
      r.code === 3 && out.includes("run through npm, which is not on PATH"),
      `exit ${r.code}\n${out}`,
    );
  }
  expect("a project with no bin is not run", 3, "nobin", join(tmp, "pass.md"), "names no bin");
  expect(
    "a bin with no #! line is not run",
    3,
    "noshebang",
    join(tmp, "pass.md"),
    "has no #! line",
  );
  expect("a missing ticket is not run", 3, "app", join(tmp, "no-such-ticket.md"), "no ticket at");
  mkdirSync(join(tmp, "empty"), { recursive: true });
  expect(
    "a project with no package.json is not run",
    3,
    "empty",
    join(tmp, "pass.md"),
    "no package.json",
  );

  st.finish();
});
