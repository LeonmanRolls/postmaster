import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { command, makeTemp, removeTree, scriptDir, writeError, writeOut } from "./lib/core.ts";

const here = scriptDir(import.meta.url);
const toolRoot = dirname(here);
const tick = String.fromCharCode(96);
const harnesses = ["claude", "codex", "grok", "agy", "muse", "pi", "mimo"];
type Env = Record<string, string | undefined>;
type PlanLine = { kind: string; fields: string[] };
type Outcome = { code: number; out: string; err: string };
function pathExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}
function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}
function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
function sameDir(a: string, b: string): boolean {
  if (!isDirectory(a) || !isDirectory(b)) return false;
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
}
function skillsFolder(harness: string, env: Env): string | null {
  const home = env.HOME ?? process.env.HOME ?? "";
  if (harness === "claude") return join(env.CLAUDE_CONFIG_DIR || join(home, ".claude"), "skills");
  if (["codex", "grok", "mimo", "muse", "pi"].includes(harness)) return join(home, ".agents", "skills");
  return null;
}
function findProgram(name: string, path: string): boolean {
  return path.split(":").some((dir) => pathExists(join(dir || ".", name)));
}
function checkoutRoot(tree: string): Outcome {
  const canonicalTree = resolve(tree);
  const top = command("git", ["-C", canonicalTree, "rev-parse", "--show-toplevel"]);
  if (top.code !== 0) return { code: 0, out: canonicalTree + "\n", err: "" };
  const canonicalTop = resolve(top.stdout.trim());
  if (canonicalTop !== canonicalTree) return { code: 0, out: canonicalTree + "\n", err: "" };
  const listed = command("git", ["-C", canonicalTree, "worktree", "list", "--porcelain"]);
  if (listed.code !== 0)
    return { code: 1, out: "", err: "link-skills: git cannot list the worktrees of " + canonicalTree + "\n" };
  const lines = listed.stdout.split("\n");
  if (lines[1] === "bare")
    return {
      code: 1,
      out: "",
      err: "link-skills: the main checkout of " + canonicalTree + " is bare; run this from a checkout with files\n",
    };
  const first = lines[0]?.replace(/^worktree /, "");
  return { code: 0, out: (first ? resolve(first) : canonicalTree) + "\n", err: "" };
}
function skillFiles(root: string): string[] {
  const dir = join(root, "skills");
  if (!existsSync(dir)) return [];
  const names = readdirSync(dir) as string[];
  return names
    .filter((name: string) => existsSync(join(dir, name, "SKILL.md")))
    .sort((a: string, b: string) => a.localeCompare(b))
    .map((name: string) => join(dir, name, "SKILL.md"));
}
function plan(root: string, env: Env): { lines: PlanLine[]; error: string } {
  const skills = skillFiles(root);
  if (!skills.length) return { lines: [], error: "link-skills: no skills/*/SKILL.md in " + root + "\n" };
  const lines: PlanLine[] = [],
    seen = new Set<string>(),
    path = env.PATH ?? "";
  for (const harness of harnesses) {
    if (!findProgram(harness, path)) {
      lines.push({ kind: "absent", fields: [harness] });
      continue;
    }
    const folder = skillsFolder(harness, env);
    if (!folder) {
      lines.push({ kind: "no-folder", fields: [harness, join(root, "skills", "postmaster", "SKILL.md")] });
      continue;
    }
    if (isLink(folder) && !isDirectory(folder)) {
      lines.push({ kind: "in-the-way", fields: [folder, "a link to " + readlinkSync(folder)] });
      continue;
    }
    if (pathExists(folder) && !isDirectory(folder)) {
      lines.push({ kind: "in-the-way", fields: [folder, "a file"] });
      continue;
    }
    const key = isDirectory(folder) ? realpathSync(folder) : folder;
    if (seen.has(key)) {
      lines.push({ kind: "shared", fields: [harness, folder] });
      continue;
    }
    seen.add(key);
    for (const skillFile of skills) {
      const name = basename(dirname(skillFile)),
        link = join(folder, name),
        target = join(root, "skills", name);
      if (isLink(link)) {
        const destination = readlinkSync(link);
        if (destination === target || sameDir(link, target))
          lines.push({ kind: "linked", fields: [link, target, harness] });
        else lines.push({ kind: "in-the-way", fields: [link, "a link to " + destination] });
      } else if (sameDir(link, target)) lines.push({ kind: "linked", fields: [link, target, harness] });
      else if (isDirectory(link)) lines.push({ kind: "in-the-way", fields: [link, "a folder"] });
      else if (pathExists(link)) lines.push({ kind: "in-the-way", fields: [link, "a file"] });
      else lines.push({ kind: "link", fields: [link, target, harness] });
    }
  }
  return { lines, error: "" };
}
function report(line: PlanLine): string {
  const [a = "", b = "", c = ""] = line.fields;
  if (line.kind === "absent") return "not installed   " + a + "\n";
  if (line.kind === "no-folder") return "no skills folder " + a + ": its brief names " + b + " by absolute path\n";
  if (line.kind === "shared") return "shared folder   " + a + " reads " + b + ", linked for another harness\n";
  if (line.kind === "linked") return "already linked  " + a + " -> " + b + " (" + c + ")\n";
  if (line.kind === "link") return "to link         " + a + " -> " + b + " (" + c + ")\n";
  if (line.kind === "in-the-way") return "IN THE WAY      " + a + " is " + b + "\n";
  return "";
}
function makeLinks(root: string, dryRun: boolean, env: Env): Outcome {
  const planned = plan(root, env);
  if (planned.error) return { code: 1, out: "", err: planned.error };
  let out = planned.lines.map(report).join("");
  if (planned.lines.some((line) => line.kind === "in-the-way"))
    return {
      code: 1,
      out,
      err: "link-skills: nothing was changed; move what is in the way, or ask the user to, then run this again\n",
    };
  if (dryRun) return { code: 0, out, err: "" };
  for (const line of planned.lines) {
    if (line.kind !== "link") continue;
    const [path, target, harness] = line.fields as [string, string, string];
    try {
      mkdirSync(dirname(path), { recursive: true });
      symlinkSync(target, path);
      if (readlinkSync(path) !== target) throw new Error("link target changed");
      out += "linked          " + path + " -> " + target + " (" + harness + ")\n";
    } catch {
      return { code: 1, out, err: "link-skills: could not link " + path + "\n" };
    }
  }
  return { code: 0, out, err: "" };
}
function removeLinks(root: string, env: Env): Outcome {
  let out = "";
  const seen = new Set<string>();
  for (const harness of harnesses) {
    const folder = skillsFolder(harness, env);
    if (!folder || seen.has(folder)) continue;
    seen.add(folder);
    for (const file of skillFiles(root)) {
      const name = basename(dirname(file)),
        path = join(folder, name),
        target = join(root, "skills", name);
      if (!isLink(path)) continue;
      if (readlinkSync(path) === target || sameDir(path, target)) {
        try {
          rmSync(path);
          out += "removed         " + path + "\n";
        } catch {
          return { code: 1, out, err: "link-skills: could not remove " + path + "\n" };
        }
      } else out += "left alone      " + path + ", a link to " + readlinkSync(path) + "\n";
    }
  }
  return { code: 0, out, err: "" };
}
function emit(result: Outcome): number {
  if (result.out) process.stdout.write(result.out);
  if (result.err) process.stderr.write(result.err);
  return result.code;
}
function usage(): never {
  writeError("usage: link-skills.sh [--dry-run] | --remove | --self-test");
  process.exit(1);
}
function run(args: string[]): number {
  if (args.length > 1 || (args.length === 1 && !["--dry-run", "--remove", "--self-test"].includes(args[0]!)))
    return usage();
  if (args[0] === "--self-test") return selfTest();
  const root = checkoutRoot(dirname(here));
  if (root.code) return emit(root);
  return emit(
    args[0] === "--remove"
      ? removeLinks(root.out.trim(), process.env)
      : makeLinks(root.out.trim(), args[0] === "--dry-run", process.env),
  );
}
function snapshot(home: string): string {
  if (!existsSync(home)) return "";
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      out.push(path + (isLink(path) ? " -> " + readlinkSync(path) : ""));
      if (isDirectory(path) && !isLink(path)) walk(path);
    }
  };
  walk(home);
  return out.join("\n");
}
function selfTest(): number {
  const tmp = makeTemp("link-skills-test-"),
    home = join(tmp, "home"),
    bin = join(tmp, "bin");
  const env: Env = { ...process.env, HOME: home, PATH: bin };
  let fails = 0;
  const ok = (label: string) => writeOut("  ok   " + label);
  const fail = (label: string, output = "") => {
    writeOut("  FAIL " + label);
    if (output) for (const line of output.split("\n")) writeOut("         " + line);
    fails++;
  };
  const check = (label: string, good: boolean, output = "") => (good ? ok(label) : fail(label, output));
  try {
    mkdirSync(bin, { recursive: true });
    mkdirSync(join(home, ".agents"), { recursive: true });
    for (const tool of [
      "bash",
      "sh",
      "env",
      "git",
      "readlink",
      "dirname",
      "basename",
      "mkdir",
      "ln",
      "rm",
      "sed",
      "grep",
      "cat",
      "mktemp",
      "cmp",
      "sort",
      "awk",
      "head",
      "tr",
      "ls",
      "cut",
      "chmod",
      "cp",
    ]) {
      const found = command("which", [tool]).stdout.trim();
      if (found) symlinkSync(found, join(bin, tool));
    }
    for (const harness of ["claude", "codex", "pi", "agy"]) {
      const stub = join(bin, harness);
      writeFileSync(stub, "#!/bin/sh\nexit 0\n");
      chmodSync(stub, 0o755);
    }
    const claude = join(home, ".claude", "skills"),
      agents = join(home, ".agents", "skills");
    const first = makeLinks(toolRoot, false, env);
    const linked = (folder: string, name: string) =>
      isLink(join(folder, name)) && readlinkSync(join(folder, name)) === join(toolRoot, "skills", name);
    check(
      "each skill is a link from claude's folder and from ~/.agents/skills to the checkout",
      first.code === 0 &&
        linked(claude, "postmaster") &&
        linked(claude, "wiki") &&
        linked(agents, "postmaster") &&
        linked(agents, "wiki"),
      first.out + first.err,
    );
    check(
      "nothing else is made, for a harness not installed or with no skills folder",
      (readdirSync(home) as string[]).sort().join(" ") === ".agents .claude",
      snapshot(home),
    );
    check(
      "harnesses that read one folder get one link there",
      first.out.includes("shared folder   pi reads " + agents + ", linked for another harness"),
    );
    check(
      "a harness with no skills folder is named with the absolute path its brief gives",
      first.out.includes(
        "no skills folder agy: its brief names " + join(toolRoot, "skills/postmaster/SKILL.md") + " by absolute path",
      ),
    );
    const claudeEntries = readdirSync(claude) as string[];
    const agentEntries = readdirSync(agents) as string[];
    check(
      "nothing in a skills folder is a copy",
      [...claudeEntries.map((x: string) => join(claude, x)), ...agentEntries.map((x: string) => join(agents, x))].every(
        isLink,
      ),
    );
    const before = snapshot(home),
      again = makeLinks(toolRoot, false, env);
    check(
      "running it again changes nothing",
      again.code === 0 && snapshot(home) === before && !again.out.includes("\nlinked "),
    );
    const custom = join(tmp, "cfg");
    const moved = makeLinks(toolRoot, false, { ...env, CLAUDE_CONFIG_DIR: custom });
    check(
      "claude's folder moves with CLAUDE_CONFIG_DIR",
      moved.code === 0 && linked(join(custom, "skills"), "postmaster"),
    );
    const skillDocs = readFileSync(join(toolRoot, "skills/postmaster/SKILL.md"), "utf8") as string;
    const trackerDocs = readFileSync(join(toolRoot, "skills/postmaster/trackers.md"), "utf8") as string;
    const resolver = skillDocs.split("\n").find((line) => line.includes('test -f "$t/scripts/link-skills.sh"')) ?? "";
    const documented =
      trackerDocs.split("\n").find((line) => /^<tool>\/scripts\/github\.sh <repo> board\s+#/.test(line)) ?? "";
    check(
      "SKILL.md documents how <tool> is found, and trackers.md the board command",
      Boolean(resolver && documented),
      resolver + "\n" + documented,
    );
    const find = (skill: string) => resolver.replaceAll("<skill>", skill);
    const resolved = command("bash", ["-c", find(join(claude, "postmaster"))], { env });
    check(
      "<tool> is the checkout the link leads to",
      resolved.code === 0 && resolved.stdout.trim() === toolRoot,
      resolved.stdout + resolved.stderr,
    );
    const remote = makeTemp("link-skills-git-");
    try {
      const repo = join(remote, "repo");
      mkdirSync(repo);
      command("git", ["init", "-q", repo]);
      command("git", ["-C", repo, "remote", "add", "origin", "https://github.com/o/r.git"]);
      const gh = join(bin, "gh");
      const ghData =
        '{"data":{"repository":{"projectsV2":{"nodes":[{"id":"PVT_1","number":1,"title":"r","closed":false,"url":"https://github.com/users/o/projects/1","owner":{"login":"o"}}]}}}}';
      writeFileSync(
        gh,
        '#!/bin/sh\nif [ "$1 $2" = "auth status" ]; then exit 0; fi\nif [ "$1 $2" = "api graphql" ]; then echo ' +
          "'" +
          ghData +
          "'" +
          "; exit 0; fi\nexit 1\n",
      );
      chmodSync(gh, 0o755);
      const board = command(join(resolved.stdout.trim(), "scripts/github.sh"), [repo, "board"], {
        env: { ...env, PATH: bin + ":" + (process.env.PATH ?? "") },
      });
      check(
        "the board command runs through the link",
        board.code === 0 && board.stdout.includes("https://github.com/users/o/projects/1"),
        "exit " + board.code + "\n" + board.stdout + board.stderr,
      );
    } finally {
      removeTree(remote);
    }
    const failResolve = (label: string, skill: string) => {
      const result = command("bash", ["-c", find(skill)], { env });
      const output = result.stdout + result.stderr;
      check(
        label,
        result.code !== 0 &&
          output.includes(skill) &&
          !output.toLowerCase().includes("no such file") &&
          !output.includes("https://github.com/users/o/projects/1"),
        output,
      );
    };
    rmSync(join(claude, "postmaster"));
    failResolve("with the link missing", join(claude, "postmaster"));
    symlinkSync(join(tmp, "elsewhere"), join(claude, "postmaster"));
    failResolve("with the link pointing elsewhere", join(claude, "postmaster"));
    rmSync(join(claude, "postmaster"));
    const copy = join(tmp, "copy", "postmaster");
    mkdirSync(dirname(copy), { recursive: true });
    command("cp", ["-R", join(toolRoot, "skills/postmaster"), copy]);
    symlinkSync(copy, join(claude, "postmaster"));
    failResolve("with the link pointing at a copy of the skill", join(claude, "postmaster"));
    rmSync(join(claude, "postmaster"));
    symlinkSync(join(toolRoot, "skills/postmaster"), join(claude, "postmaster"));
    const obstruction = join(claude, "postmaster");
    rmSync(obstruction);
    mkdirSync(obstruction);
    rmSync(join(agents, "wiki"), { force: true });
    const beforeBlock = snapshot(home),
      blocked = makeLinks(toolRoot, false, env);
    check(
      "a real folder where a link belongs is named",
      blocked.code === 1 && blocked.out.includes("IN THE WAY      " + obstruction) && snapshot(home) === beforeBlock,
      blocked.out + blocked.err,
    );
    check("a refusal makes no other link either", !pathExists(join(agents, "wiki")));
    rmSync(obstruction, { recursive: true });
    writeFileSync(obstruction, "x");
    check(
      "a real file where a link belongs is named",
      makeLinks(toolRoot, false, env).out.includes("IN THE WAY      " + obstruction),
    );
    rmSync(obstruction);
    symlinkSync(join(tmp, "elsewhere"), obstruction);
    check(
      "a link that points elsewhere is named",
      makeLinks(toolRoot, false, env).out.includes("IN THE WAY      " + obstruction),
    );
    rmSync(obstruction);
    symlinkSync(join(tmp, "nowhere"), obstruction);
    check(
      "a link that points nowhere is named",
      makeLinks(toolRoot, false, env).out.includes("IN THE WAY      " + obstruction),
    );
    rmSync(obstruction);
    rmSync(join(agents, "wiki"), { force: true });
    const dry = makeLinks(toolRoot, true, env);
    check(
      "--dry-run names the links it would make, and makes none",
      dry.code === 0 && !isLink(join(agents, "wiki")) && dry.out.includes("to link         " + join(agents, "wiki")),
    );
    const fixture = join(tmp, "fixture"),
      fixtureHome = join(tmp, "fhome");
    mkdirSync(join(fixture, "skills/postmaster"), { recursive: true });
    mkdirSync(join(fixture, "skills/wiki"), { recursive: true });
    mkdirSync(join(fixtureHome, ".claude"), { recursive: true });
    mkdirSync(join(fixtureHome, ".agents/skills"), { recursive: true });
    writeFileSync(join(fixture, "skills/postmaster/SKILL.md"), "skill");
    writeFileSync(join(fixture, "skills/wiki/SKILL.md"), "wiki");
    symlinkSync(join(fixture, "skills"), join(fixtureHome, ".claude/skills"));
    const fixtureEnv = { ...env, HOME: fixtureHome },
      fixtureBefore = snapshot(fixture);
    const folderLink = makeLinks(fixture, false, fixtureEnv);
    check(
      "counts as linked, and nothing is written into the checkout",
      folderLink.code === 0 &&
        folderLink.out.includes("already linked  " + join(fixtureHome, ".claude/skills/postmaster")) &&
        snapshot(fixture) === fixtureBefore,
    );
    removeLinks(fixture, fixtureEnv);
    check(
      "--remove leaves it, and the checkout, alone",
      isLink(join(fixtureHome, ".claude/skills")) && snapshot(fixture) === fixtureBefore,
    );
    makeLinks(toolRoot, false, env);
    symlinkSync(join(tmp, "elsewhere"), join(claude, "other"));
    rmSync(join(agents, "wiki"));
    mkdirSync(join(agents, "wiki"));
    removeLinks(toolRoot, env);
    check(
      "its own links go; a link elsewhere and a real folder stay",
      !isLink(join(claude, "postmaster")) &&
        !isLink(join(claude, "wiki")) &&
        !isLink(join(agents, "postmaster")) &&
        isLink(join(claude, "other")) &&
        isDirectory(join(agents, "wiki")),
    );
    const repo = join(tmp, "repo");
    mkdirSync(repo);
    command("git", ["init", "-q", "-b", "main", repo]);
    command("git", [
      "-C",
      repo,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "first",
    ]);
    command("git", ["-C", repo, "worktree", "add", "-q", join(repo, ".worktrees/wt"), "-b", "wt"]);
    check(
      "from a worktree: the main checkout, never the worktree",
      checkoutRoot(join(repo, ".worktrees/wt")).out.trim() === repo,
    );
    check("from the main checkout: itself", checkoutRoot(repo).out.trim() === repo);
    const outside = join(tmp, "pkg");
    mkdirSync(outside);
    check(
      "from a tree outside git, such as an installed package: itself",
      checkoutRoot(outside).out.trim() === outside,
    );
    const nested = join(repo, "node_modules/pkg");
    mkdirSync(nested, { recursive: true });
    check(
      "from a package inside another project's checkout: the package, not the project",
      checkoutRoot(nested).out.trim() === nested,
    );
    const bare = join(tmp, "bare.git");
    command("git", ["clone", "-q", "--bare", repo, bare]);
    const bareTree = join(tmp, "bare-wt");
    command("git", ["-C", bare, "worktree", "add", "-q", bareTree, "main"]);
    check("a bare main checkout is refused", checkoutRoot(bareTree).code === 1);
    const docs = readFileSync(join(toolRoot, "skills/postmaster/harnesses.md"), "utf8") as string;
    check("harnesses.md has a Skills folders table", docs.includes("## Skills folders"));
    const table = docs.split("## Skills folders")[1]?.split("\n## ")[0] ?? "";
    const backtick = String.fromCharCode(96);
    const codeCell = new RegExp(backtick + "([^" + backtick + "]+)" + backtick);
    for (const harness of harnesses) {
      const row = table.split("\n").find((line: string) => line.startsWith("| " + harness + " |")) ?? "";
      const cell = row.split("|")[2]?.trim() ?? "";
      const match = cell.startsWith("none:") ? null : cell.match(codeCell);
      const wanted = match?.[1]?.replace(/^~/, home) ?? "";
      check(harness + ": " + (wanted || "no skills folder"), (skillsFolder(harness, env) ?? "") === wanted, cell);
    }
  } finally {
    removeTree(tmp);
  }
  writeOut("");
  writeOut(fails ? "self-test: " + fails + " control(s) misbehaved" : "self-test: all controls behaved");
  return fails ? 1 : 0;
}
process.exit(run(process.argv.slice(2)));
