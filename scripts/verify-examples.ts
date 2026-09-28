import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { command, makeTemp, removeTree, scriptDir, writeError, writeOut } from "./lib/core.ts";

const wrapper = join(scriptDir(import.meta.url), "verify-examples.sh");
const tick = String.fromCharCode(96);
const fence = new RegExp("^(\\s*)((" + tick + "{3,})|(~{3,}))(.*)$");
type Cmd = { cmd: string; out: string[]; exit: number };
type Result = { code: number; output: string };
function ticketLines(text: string): string[] {
  const lines = text.split(/\r?\n/),
    start = lines.findIndex((x) => /^##\s+Ticket\s*$/.test(x));
  if (start < 0) return lines;
  let end = lines.findIndex((x, i) => i > start && /^##\s+Project profile\s*$/.test(x));
  if (end < 0) end = lines.length;
  return lines.slice(start + 1, end);
}
function section(lines: string[], title: string): string[] | null {
  const escaped = title.replace(/[.*+?^\x24{}()|[\]\\]/g, "\\$&");
  const start = lines.findIndex((x) => new RegExp("^##\\s+" + escaped + "\\s*$", "i").test(x));
  if (start < 0) return null;
  const out: string[] = [];
  let open: string | null = null;
  for (const line of lines.slice(start + 1)) {
    const m = line.match(fence);
    if (!open && /^#{1,2}\s/.test(line)) break;
    const marker = m?.[3] || m?.[4];
    if (m && !open && !(marker?.[0] === tick && m[5]!.includes(tick))) open = marker!;
    else if (m && open && marker?.[0] === open[0] && marker.length >= open.length && !m[5]!.trim()) open = null;
    out.push(line);
  }
  return out;
}
function blocks(lines: string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(fence),
      marker = m?.[3] || m?.[4];
    if (!m || (!marker!.startsWith("~") && m[5]!.includes(tick))) continue;
    const body: string[] = [],
      indent = m[1]!.length;
    while (++i < lines.length) {
      const close = lines[i]!.match(/^\s*(\x60{3,}|~{3,})\s*$/);
      if (close && close[1]![0] === marker![0] && close[1]!.length >= marker!.length) break;
      body.push(lines[i]!.replace(new RegExp("^ {0," + indent + "}"), ""));
    }
    out.push(body);
  }
  return out;
}
function trim(lines: string[]): string[] {
  const out = lines.map((x) => x.replace(/\s+$/, ""));
  while (out.length && !out.at(-1)) out.pop();
  return out;
}
function parseTranscript(body: string[]): Cmd[] | null {
  const first = body.find((x) => x.trim());
  if (!first || !first.startsWith("$ ")) return null;
  const cmds: Cmd[] = [];
  for (const line of body) {
    if (line.startsWith("$ ")) cmds.push({ cmd: line.slice(2).trim(), out: [], exit: 0 });
    else if (cmds.length) cmds.at(-1)!.out.push(line);
  }
  for (const c of cmds) {
    c.out = trim(c.out);
    const m = c.out
      .at(-1)
      ?.trim()
      .match(/^\[exit (\d+)\]$/);
    if (m) {
      c.exit = Number(m[1]);
      c.out = trim(c.out.slice(0, -1));
    }
  }
  return cmds;
}
function which(name: string, path = process.env.PATH ?? ""): string | null {
  for (const dir of path.split(":")) {
    const p = join(dir || ".", name);
    if (existsSync(p)) return p;
  }
  return null;
}
function quote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}
function examples(worktree: string, explicit: string): Result {
  const wt = realpathSync(worktree),
    ticket = explicit || join(process.env.POSTMASTER_VERIFY || join(wt, ".postmaster", "verify"), "ticket.md");
  if (!existsSync(ticket))
    return { code: 3, output: "not run: no ticket at " + ticket + "; scripts/verify.sh arm copies the run's there\n" };
  const journey = section(ticketLines(readFileSync(ticket, "utf8")), "User journey");
  if (!journey)
    return {
      code: 3,
      output: "not run: the ticket has no User journey, where a command-line app's example transcripts go\n",
    };
  const transcripts = blocks(journey)
    .map(parseTranscript)
    .filter((x): x is Cmd[] => x !== null);
  if (!transcripts.length)
    return {
      code: 3,
      output:
        "not run: the ticket's User journey has no example transcript: a fenced block whose first line starts with a $ prompt\n",
    };
  const packageFile = join(wt, "package.json");
  if (!existsSync(packageFile))
    return {
      code: 3,
      output:
        "not run: no package.json in " +
        wt +
        ", so no command to run the examples through; this default runs a package.json project's bin, so declare the check in .postmaster/project.toml\n",
    };
  let pkg: any;
  try {
    pkg = JSON.parse(readFileSync(packageFile, "utf8"));
  } catch (e) {
    return { code: 3, output: "not run: package.json does not parse: " + String(e) + "\n" };
  }
  const raw = pkg.bin;
  const bins: [string, string][] =
    typeof raw === "string"
      ? pkg.name
        ? [[String(pkg.name).split("/").at(-1)!, raw]]
        : []
      : raw && typeof raw === "object"
        ? Object.entries(raw).filter((x): x is [string, string] => typeof x[0] === "string" && typeof x[1] === "string")
        : [];
  if (!bins.length)
    return { code: 3, output: "not run: package.json names no bin, so no command to run the examples through\n" };
  for (const [name] of bins)
    if (!/^[A-Za-z0-9@._+-]+$/.test(name) || name === "." || name === "..")
      return {
        code: 3,
        output: "not run: package.json names a bin " + JSON.stringify(name) + ", which is not a plain command name\n",
      };
  const runpath = join(wt, "node_modules", ".bin") + ":" + (process.env.PATH ?? "");
  const scripts = pkg.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {};
  if (scripts.build) {
    const pm = existsSync(join(wt, "pnpm-lock.yaml"))
      ? "pnpm"
      : existsSync(join(wt, "bun.lock")) || existsSync(join(wt, "bun.lockb"))
        ? "bun"
        : existsSync(join(wt, "yarn.lock"))
          ? "yarn"
          : "npm";
    if (!which(pm))
      return {
        code: 3,
        output: "not run: package.json has a build script, run through " + pm + ", which is not on PATH\n",
      };
    const b = command(pm, ["run", "build"], { cwd: wt, input: "" });
    if (b.code)
      return {
        code: 1,
        output: b.stdout + b.stderr + "FAIL  the build failed: " + pm + " run build exited " + b.code + "\n",
      };
  }
  const temp = makeTemp("verify-examples-");
  try {
    const shims = join(temp, "bin");
    mkdirSync(shims);
    for (const [name, rel] of bins) {
      const file = resolve(wt, rel);
      if (!existsSync(file))
        return { code: 1, output: "FAIL  bin " + name + " names " + rel + ", which is not a file\n" };
      const first = readFileSync(file).toString().split(/\r?\n/, 1)[0]!;
      const argv: string[] = first.startsWith("#!")
        ? first.slice(2).trim().split(/\s+/)
        : /\.(?:js|mjs|cjs)$/.test(file)
          ? ["node"]
          : [];
      if (!argv.length)
        return { code: 3, output: "not run: cannot tell how to run bin " + name + ": " + rel + " has no #! line\n" };
      let prog = argv[0]!;
      if (basename(prog) === "env") prog = argv.slice(1).find((x) => !x.startsWith("-") && !x.includes("=")) ?? "";
      if (!prog || (prog.includes("/") ? !existsSync(prog) : !which(prog, runpath)))
        return {
          code: 3,
          output: "not run: bin " + name + " runs through " + (prog || "an empty #! line") + ", which is not on PATH\n",
        };
      const shim = join(shims, name);
      writeFileSync(shim, "#!/bin/sh\nexec " + argv.map(quote).join(" ") + " " + quote(file) + ' "$@"\n');
      chmodSync(shim, 0o755);
    }
    let passed = 0,
      failed = 0;
    const lines: string[] = [];
    for (const [i, cmds] of transcripts.entries()) {
      const home = join(temp, "block-" + (i + 1));
      mkdirSync(home);
      const env: Record<string, string | undefined> = {
        ...process.env,
        HOME: home,
        PWD: home,
        NO_COLOR: "1",
        PATH: shims + ":" + runpath,
      };
      delete env.BASH_ENV;
      for (const c of cmds) {
        const r = spawnSync("bash", ["-c", "exec 2>&1; " + c.cmd], {
          cwd: home,
          env,
          input: "",
          encoding: "utf8",
          timeout: 60_000,
        });
        const got = trim(
          String(r.stdout ?? "")
            .replace(/\r\n/g, "\n")
            .split("\n"),
        );
        const code = r.error?.code === "ETIMEDOUT" ? null : typeof r.status === "number" ? r.status : 127;
        if (JSON.stringify(got) === JSON.stringify(c.out) && code === c.exit) {
          passed++;
          lines.push("ok    $ " + c.cmd);
          continue;
        }
        failed++;
        lines.push("FAIL  $ " + c.cmd);
        if (JSON.stringify(got) !== JSON.stringify(c.out)) {
          lines.push(
            "      expected:",
            ...(c.out.length ? c.out.slice(0, 20).map((x) => "        " + x) : ["        (nothing)"]),
          );
          lines.push(
            "      got:",
            ...(got.length ? got.slice(0, 20).map((x) => "        " + x) : ["        (nothing)"]),
          );
        }
        if (code !== c.exit)
          lines.push("      exit: expected " + c.exit + ", got " + (code === null ? "none, it timed out" : code));
      }
    }
    lines.push(passed + " of " + (passed + failed) + " example commands did what the ticket says");
    return { code: failed ? 1 : 0, output: lines.join("\n") + "\n" };
  } finally {
    removeTree(temp);
  }
}
function usage(): never {
  writeError("usage: verify-examples.sh [<worktree>] [--ticket <file>] | --self-test");
  process.exit(1);
}
function run(args: string[]): number {
  if (args[0] === "--self-test") return args.length === 1 ? selfTest() : usage();
  let wt = ".",
    ticket = "";
  for (let i = 0; i < args.length; ) {
    if (args[i] === "--ticket") {
      if (i + 1 >= args.length) return usage();
      ticket = args[i + 1]!;
      i += 2;
    } else if (args[i]!.startsWith("-")) return usage();
    else {
      wt = args[i]!;
      i++;
    }
  }
  if (!existsSync(wt)) {
    writeError("verify-examples: no such directory: " + wt);
    return 1;
  }
  const result = examples(wt, ticket);
  process.stdout.write(result.output);
  return result.code;
}
function selfTest(): number {
  const tmp = makeTemp("verify-examples-test-"),
    F = tick.repeat(3);
  let fails = 0;
  const ok = (s: string) => writeOut("  ok   " + s);
  const fail = (s: string, out = "") => {
    writeOut("  FAIL " + s);
    if (out) for (const l of out.split("\n")) writeOut("         " + l);
    fails++;
  };
  const p = (s: string) => join(tmp, s);
  const put = (s: string, data: string) => {
    mkdirSync(join(p(s), ".."), { recursive: true });
    writeFileSync(p(s), data);
  };
  const expect = (label: string, code: number, project: string, ticket: string, contains = "") => {
    const r = command(wrapper, [p(project), "--ticket", p(ticket)]),
      out = r.stdout + r.stderr;
    if (r.code === code && (!contains || out.includes(contains))) ok(label);
    else fail(label + " (exit " + r.code + ")", out);
  };
  try {
    mkdirSync(p("app/bin"), { recursive: true });
    put("app/package.json", '{"name":"greeter","bin":{"greet":"bin/greet"}}\n');
    put(
      "app/bin/greet",
      '#!/usr/bin/env bash\ncase "\x24{1:-}" in\n "") echo "usage: greet <name> | greet save <name> | greet saved" >&2; exit 2 ;;\n save) echo "\x24{2}" > saved.txt; echo "saved \x24{2}" ;;\n saved) cat saved.txt 2>/dev/null || { echo "nothing saved" >&2; exit 1; } ;;\n *) echo "hello \x24{1}" ;;\nesac\n',
    );
    mkdirSync(p("nobin"), { recursive: true });
    put("nobin/package.json", '{"name":"plain"}\n');
    mkdirSync(p("noshebang/bin"), { recursive: true });
    put("noshebang/package.json", '{"name":"x","bin":{"x":"bin/x.sh"}}\n');
    put("noshebang/bin/x.sh", "echo hi\n");
    mkdirSync(p("built/bin"), { recursive: true });
    put(
      "built/package.json",
      '{"name":"built","bin":"dist/built.js","scripts":{"build":"mkdir -p dist && cp bin/src.js dist/built.js"}}\n',
    );
    put("built/bin/src.js", "console.log('built ' + process.argv[2]);\n");
    mkdirSync(p("broken"), { recursive: true });
    put("broken/package.json", '{"name":"broken","bin":"dist/broken.js","scripts":{"build":"exit 4"}}\n');
    put(
      "pass.md",
      "## User journey\n" +
        F +
        '\n$ greet world\nhello world\n$ greet\nusage: greet <name> | greet save <name> | greet saved\n[exit 2]\n$ greet save ann\nsaved ann\n$ greet saved\nann\n$ test "$HOME" = "$PWD" && echo home is the block\nhome is the block\n' +
        F +
        "\n\n~~~sh\n$ greet saved\nnothing saved\n[exit 1]\n~~~\n",
    );
    put("output.md", "## User journey\n" + F + "\n$ greet world\nhello there\n" + F + "\n");
    put(
      "exit.md",
      "## User journey\n" + F + "\n$ greet\nusage: greet <name> | greet save <name> | greet saved\n" + F + "\n",
    );
    put(
      "none.md",
      "## Problem / feature\n" + F + "\n$ greet world\nhello world\n" + F + "\n## User journey\nNo command example.\n",
    );
    put("nojourney.md", "## Problem / feature\nGreet people.\n");
    put(
      "waybill.md",
      "# Waybill\n## Ticket\n## User journey\n" +
        F +
        "\n$ greet ann\nhello ann\n" +
        F +
        "\n## Project profile\nrepo: elsewhere\n" +
        F +
        "\n$ greet ann\nwrong\n" +
        F +
        "\n",
    );
    put("built.md", "## User journey\n" + F + "\n$ built ok\nbuilt ok\n" + F + "\n");
    writeOut("positive controls");
    expect(
      "matching transcripts pass, exits and state within a block included",
      0,
      "app",
      "pass.md",
      "6 of 6 example commands",
    );
    expect("only a waybill's ticket part is read", 0, "app", "waybill.md", "1 of 1");
    expect("a build script runs before the bin is looked for", 0, "built", "built.md", "1 of 1");
    writeOut("negative controls");
    expect("a different output fails and shows both", 1, "app", "output.md", "hello there");
    expect("a different exit fails and names both", 1, "app", "exit.md", "exit: expected 0, got 2");
    expect("a failed build fails", 1, "broken", "built.md", "the build failed");
    expect(
      "a transcript outside the User journey is no example",
      3,
      "app",
      "none.md",
      "User journey has no example transcript",
    );
    expect("a ticket with no User journey is not run", 3, "app", "nojourney.md", "has no User journey");
    mkdirSync(p("pathbin/bin"), { recursive: true });
    put("pathbin/package.json", '{"name":"p","bin":{' + JSON.stringify(p("victim")) + ':"bin/greet"}}\n');
    put("pathbin/bin/greet", readFileSync(p("app/bin/greet"), "utf8"));
    expect("a bin named with a path is not run", 3, "pathbin", "pass.md", "not a plain command name");
    if (!existsSync(p("victim"))) ok("and nothing is written where it points");
    else fail("and nothing is written where it points");
    mkdirSync(p("nointerp/bin"), { recursive: true });
    put("nointerp/package.json", '{"name":"n","bin":{"greet":"bin/greet"}}\n');
    put("nointerp/bin/greet", "#!/usr/bin/env no-such-interpreter-xyz\necho hi\n");
    expect(
      "a bin whose interpreter is not installed is not run",
      3,
      "nointerp",
      "pass.md",
      "runs through no-such-interpreter-xyz",
    );
    const few = p("fewtools");
    mkdirSync(few);
    for (const tool of ["bash", "env", "node", "dirname", "bun"]) {
      const found = which(tool);
      if (found) {
        try {
          symlinkSync(found, join(few, tool));
        } catch {}
      }
    }
    mkdirSync(p("built-missing"), { recursive: true });
    put("built-missing/package.json", '{"name":"built","bin":"dist/built.js","scripts":{"build":"true"}}\n');
    const noPm = command(wrapper, [p("built-missing"), "--ticket", p("built.md")], { env: { PATH: few } });
    if (noPm.code === 3 && (noPm.stdout + noPm.stderr).includes("run through npm, which is not on PATH"))
      ok("a build whose package manager is not installed is not run");
    else
      fail(
        "a build whose package manager is not installed is not run (exit " + noPm.code + ")",
        noPm.stdout + noPm.stderr,
      );
    expect("a project with no bin is not run", 3, "nobin", "pass.md", "names no bin");
    expect("a bin with no #! line is not run", 3, "noshebang", "pass.md", "has no #! line");
    expect("a missing ticket is not run", 3, "app", "missing.md", "no ticket at");
    mkdirSync(p("empty"), { recursive: true });
    expect("a project with no package.json is not run", 3, "empty", "pass.md", "no package.json");
  } finally {
    removeTree(tmp);
  }
  writeOut("");
  writeOut(fails ? "self-test: " + fails + " control(s) misbehaved" : "self-test: all controls behaved");
  return fails ? 1 : 0;
}
process.exit(run(process.argv.slice(2)));
