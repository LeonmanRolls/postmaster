import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { command, makeTemp, removeTree, scriptDir, writeError, writeOut } from "./lib/core.ts";

type Fault = { file: string; line: number; reason: string; reference: string };
const here = scriptDir(import.meta.url);
const root = resolve(here, "..");
const wrapper = join(here, "skill-refs.sh");
const refPattern = /scripts\/[A-Za-z0-9._-]*/g;
const barePattern = /(?<![A-Za-z0-9_./-])scripts\//g;
const otherPattern = /(<[A-Za-z0-9_-]+>|[$]\{?[A-Za-z_][A-Za-z0-9_]*\}?)\/$/;

function refs(repoRoot: string, mode: "check" | "fix", files: string[]): number {
  const faults: Fault[] = [];
  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch (error) {
      writeError(`skill-refs: cannot read ${file}: ${String(error).replace(/^Error: /, "")}`);
      return 2;
    }
    if (mode === "fix") {
      let count = 0;
      const updated = text.replace(barePattern, () => {
        count++;
        return "<tool>/scripts/";
      });
      if (count) {
        try {
          writeFileSync(file, updated);
        } catch (error) {
          writeError(`skill-refs: cannot write ${file}: ${String(error).replace(/^Error: /, "")}`);
          return 2;
        }
        writeError(`${file}: ${count} reference(s) now go through <tool>`);
      }
      text = updated;
    }
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index]!;
      for (const match of line.matchAll(refPattern)) {
        const offset = match.index!;
        const before = line.slice(0, offset);
        const reference = match[0]!.replace(/\.+$/, "");
        if (before && /[A-Za-z0-9_]/.test(before.at(-1)!)) continue;
        const name = reference.slice("scripts/".length);
        if (before.endsWith("<tool>/")) {
          if (name && !existsSync(join(repoRoot, "scripts", name))) {
            faults.push({
              file,
              line: index + 1,
              reason: "no such script in the postmaster repo",
              reference: `<tool>/${reference}`,
            });
          }
        } else if (otherPattern.test(before)) {
        } else if (before.endsWith("/")) {
          faults.push({ file, line: index + 1, reason: "reaches scripts/ without going through <tool>", reference });
        } else {
          faults.push({ file, line: index + 1, reason: "bare; it resolves only from the repo's own root", reference });
        }
      }
    }
  }
  for (const fault of faults) writeOut(`${fault.file}:${fault.line}: ${fault.reason}: ${fault.reference}`);
  return faults.length ? 1 : 0;
}

function usage(): never {
  writeError("usage: skill-refs.sh [--fix] [<file>...] | --self-test");
  process.exit(2);
}

function run(args: string[]): number {
  let mode: "check" | "fix" = "check";
  let files = args;
  if (args[0] === "--self-test") {
    if (args.length !== 1) return usage();
    return selfTest();
  }
  if (args[0] === "--fix") {
    mode = "fix";
    files = args.slice(1);
  } else if (args[0]?.startsWith("-")) return usage();
  if (files.length === 0) {
    const skillDir = join(root, "skills/postmaster");
    files = readdirSync(skillDir)
      .filter((name: string) => name.endsWith(".md"))
      .sort()
      .map((name: string) => join(skillDir, name));
    if (!files.length) {
      writeError(`skill-refs: no skills/postmaster/*.md in ${root}`);
      return 2;
    }
  }
  return refs(root, mode, files);
}

function selfTest(): number {
  const tmp = makeTemp("postmaster-skill-refs-");
  const scripts = join(tmp, "root/scripts");
  let failures = 0;
  const ok = (label: string) => writeOut(`  ok   ${label}`);
  const fail = (label: string, details = "") => {
    writeOut(`  FAIL ${label}`);
    if (details) for (const line of details.split("\n")) writeOut(`         ${line}`);
    failures++;
  };
  const check = (...files: string[]) => command(wrapper, files);
  const fix = (file: string) => command(wrapper, ["--fix", file]);
  try {
    command("mkdir", ["-p", scripts]);
    writeFileSync(join(scripts, "stage.sh"), "");
    writeFileSync(join(scripts, "launch.sh"), "");
    const bare = join(tmp, "bare.md");
    const good = join(tmp, "good.md");
    const relative = join(tmp, "relative.md");
    const missing = join(tmp, "missing.md");
    writeFileSync(
      bare,
      "Set the stage with scripts/stage.sh <dispatch> synthesis.\n( scripts/launch.sh launch <lane> <wt> <prompt> ) &\nEvery leg ends with scripts/stage.sh.\n",
    );
    writeFileSync(
      good,
      "Set the stage with <tool>/scripts/stage.sh <dispatch> synthesis.\n( <tool>/scripts/launch.sh launch <lane> <wt> <prompt> ) &\nThe project's own <repo>/scripts/build.sh and $HERE/scripts/x are not the tool's.\nEvery <tool>/scripts/ path is the repo's; postscripts/ and myscripts/x.sh are other words.\n",
    );
    writeFileSync(relative, "Run ../../scripts/stage.sh from the skill.\n");
    writeFileSync(missing, "Run <tool>/scripts/no-such.sh.\n");
    writeOut("positive controls: each fault is found, on its own line");
    const bareResult = check(bare);
    if (bareResult.code === 1 && bareResult.stdout.split("\n").filter(Boolean).length === 3)
      ok("three bare references are three faults");
    else fail("three bare references are three faults", bareResult.stdout);
    if (bareResult.code === 1 && bareResult.stdout.includes(`${bare}:1: bare`))
      ok("a fault names its file and line, and exits 1");
    else fail(`a fault names its file and line, and exits 1 (exit ${bareResult.code})`, bareResult.stdout);
    if (check(relative).code === 1) ok("a path that reaches scripts/ another way is a fault");
    else fail("a path that reaches scripts/ another way is a fault");
    if (check(missing).code === 1) ok("a script the repo does not have is a fault");
    else fail("a script the repo does not have is a fault");
    writeOut("negative controls: nothing is found where nothing is wrong");
    if (check(good).code === 0) ok("references through <tool>, and other directories' scripts/, read zero");
    else fail("references through <tool>, and other directories' scripts/, read zero");
    if (check(join(tmp, "nowhere.md")).code === 2) ok("a file that cannot be read is exit 2, not a clean result");
    else fail("a file that cannot be read is exit 2, not a clean result");
    writeOut("--fix: bare references go through <tool>, and a second run changes nothing");
    const fixFile = join(tmp, "fix.md");
    writeFileSync(fixFile, readFileSync(bare, "utf8") + readFileSync(good, "utf8") + readFileSync(relative, "utf8"));
    fix(fixFile);
    const fixed = readFileSync(fixFile, "utf8");
    if (
      check(fixFile).code === 1 &&
      !fixed.includes("<tool>/<tool>/") &&
      fixed.includes("<tool>/scripts/stage.sh <dispatch>")
    )
      ok("every bare reference is fixed, none is doubled, and the one it cannot fix is still named");
    else fail("every bare reference is fixed, none is doubled, and the one it cannot fix is still named", fixed);
    const once = join(tmp, "once.md");
    writeFileSync(once, fixed);
    fix(fixFile);
    if (readFileSync(fixFile, "utf8") === readFileSync(once, "utf8")) ok("a second --fix changes nothing");
    else fail("a second --fix changes nothing");
    const goodCopy = join(tmp, "good-copy.md");
    writeFileSync(goodCopy, readFileSync(good, "utf8"));
    fix(goodCopy);
    if (readFileSync(good, "utf8") === readFileSync(goodCopy, "utf8"))
      ok("--fix leaves a file with no bare reference alone");
    else fail("--fix leaves a file with no bare reference alone");
  } finally {
    removeTree(tmp);
  }
  writeOut("");
  writeOut(failures === 0 ? "self-test: all controls behaved" : `self-test: ${failures} control(s) misbehaved`);
  return failures === 0 ? 0 : 1;
}

process.exit(run(process.argv.slice(2)));
