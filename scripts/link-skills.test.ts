// Tests beside scripts/link-skills.ts, moved from its --self-test on #109: 41 controls.
// HOME/PATH are restricted for the run and restored in afterAll; per-call HOME swaps use
// try/finally. Harness-table labels compute at definition time, their assertions at run time.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { scriptsDir, toolRoot } from "./lib/paths.ts";
import { run } from "./lib/proc.ts";
import {
  checkLinks,
  checkoutRoot,
  HARNESSES,
  harnessInstalled,
  isDirectory,
  isLink,
  makeLinks,
  removeLinks,
  shellQuote,
  skillsFolder,
} from "./link-skills";

const TOOL = toolRoot(import.meta);
const savedPath = process.env.PATH;
const savedHome = process.env.HOME;
const savedClaudeDir = process.env.CLAUDE_CONFIG_DIR;

let tmp = "";
let bin = "";
let home = "";
let elsewhere = "";
let C = "";
let A = "";

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "postmaster-"));
  bin = join(tmp, "bin");
  home = join(tmp, "home");
  elsewhere = join(tmp, "elsewhere");
  mkdirSync(bin, { recursive: true });
  mkdirSync(home, { recursive: true });
  mkdirSync(elsewhere, { recursive: true });
  C = join(home, ".claude", "skills");
  A = join(home, ".agents", "skills");

  // stub harnesses
  for (const h of ["claude", "codex", "pi", "agy"]) {
    writeFileSync(join(bin, h), "#!/bin/sh\nexit 0\n", "utf8");
    chmodSync(join(bin, h), 0o755);
  }
  // The tools the controls shell out to, so the restricted PATH is self-sufficient and no
  // control can reach the machine's own harnesses or skills folders.
  for (const t of [
    "bash",
    "sh",
    "env",
    "git",
    "bun",
    "realpath",
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
    const r = spawnSync("sh", ["-c", `command -v ${t}`], { encoding: "utf8" });
    const p = r.stdout.trim().split("\n").pop() ?? "";
    if (!p?.startsWith("/")) {
      throw new Error(`link-skills test setup: ${t} is not on PATH`);
    }
    if (!existsSync(join(bin, t))) {
      try {
        symlinkSync(p, join(bin, t));
      } catch {
        /* ignore */
      }
    }
  }

  process.env.PATH = bin;
  process.env.HOME = home;
  delete process.env.CLAUDE_CONFIG_DIR;
});

afterAll(() => {
  if (savedPath === undefined) delete process.env.PATH;
  else process.env.PATH = savedPath;
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  if (savedClaudeDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = savedClaudeDir;
  rmSync(tmp, { recursive: true, force: true });
});

function capture<T>(fn: () => T): { ret: T; out: string } {
  const savedLog = console.log;
  const savedErr = console.error;
  let buf = "";
  console.log = (...a: unknown[]) => {
    buf += `${a.map(String).join(" ")}\n`;
  };
  console.error = (...a: unknown[]) => {
    buf += `${a.map(String).join(" ")}\n`;
  };
  try {
    return { ret: fn(), out: buf };
  } finally {
    console.log = savedLog;
    console.error = savedErr;
  }
}

function withHome<T>(h: string, fn: () => T): T {
  const saved = process.env.HOME;
  process.env.HOME = h;
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env.HOME;
    else process.env.HOME = saved;
  }
}

function linksTo(p: string, target: string): boolean {
  try {
    return isLink(p) && readlinkSync(p) === target;
  } catch {
    return false;
  }
}

function state(): string {
  const items: string[] = [];
  try {
    items.push(...readdirSync(home).sort().join(" ").split(" "));
  } catch {
    /* empty */
  }
  for (const dir of [C, A]) {
    try {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        items.push(`${p} ${isLink(p) ? readlinkSync(p) : ""}`);
      }
    } catch {
      /* empty */
    }
  }
  return items.join("\n");
}

let resolver = "";
let documented = "";

function through(skillDir: string): { code: number; out: string } {
  const findTool = resolver.replace(/<skill>/gu, skillDir);
  const command = documented.replace(/<repo>/gu, join(tmp, "target")).replace(/<tool>/gu, "$tool");
  const r = run("bash", ["-c", `tool=$(${findTool}) && ${command}`], {
    cwd: elsewhere,
    env: { ...process.env, PATH: bin, HOME: home },
  });
  return { code: r.code, out: r.out + r.err };
}

function expectNamedFailure(link: string, target: string): void {
  const r = through(link);
  expect(r.code).not.toBe(0);
  // The resolution follows the link; whatever then fails names where it led.
  expect(r.out).toContain(target);
  expect(r.out).not.toContain("projects/1");
}

describe("harness lookup", () => {
  test("a harness name holding $(...) is looked up literally, and runs nothing", () => {
    const marker = join(tmp, "harness-marker");
    const found = harnessInstalled(`zz-nonexistent-$(touch ${marker})`);
    expect(found).toBe(false);
    expect(existsSync(marker)).toBe(false);
  });
});

describe("--check: the same command reports missing links and passes when complete", () => {
  let checkTool = "";
  let checkHome = "";
  let checkRun = "";
  let blockedPath = "";

  function stateAt(h: string): string {
    const items: string[] = [];
    try {
      items.push(...readdirSync(h).sort());
    } catch {
      /* empty */
    }
    for (const dir of [join(h, ".claude", "skills"), join(h, ".agents", "skills")]) {
      try {
        for (const n of readdirSync(dir)) {
          const p = join(dir, n);
          items.push(`${p} ${isLink(p) ? readlinkSync(p) : ""}`);
        }
      } catch {
        /* empty */
      }
    }
    return items.join("\n");
  }

  function runCheck(root: string, h: string, path?: string): { rc: number; out: string } {
    const savedH = process.env.HOME;
    const savedP = process.env.PATH;
    process.env.HOME = h;
    if (path !== undefined) process.env.PATH = path;
    try {
      const c = capture(() => checkLinks(root));
      return { rc: c.ret, out: c.out };
    } finally {
      if (savedH === undefined) delete process.env.HOME;
      else process.env.HOME = savedH;
      if (path !== undefined) {
        if (savedP === undefined) delete process.env.PATH;
        else process.env.PATH = savedP;
      }
    }
  }

  beforeAll(() => {
    const checkToolBase = join(tmp, "check-tool");
    const checkHomeBase = join(tmp, "check-home");
    mkdirSync(join(checkToolBase, "scripts"), { recursive: true });
    mkdirSync(checkHomeBase, { recursive: true });
    checkTool = realpathSync(checkToolBase);
    checkHome = realpathSync(checkHomeBase);
    cpSync(join(TOOL, "skills"), join(checkTool, "skills"), { recursive: true });
    // The install command names the script being run: in-process, the real one.
    checkRun = `${shellQuote(join(scriptsDir(import.meta), "run"))} link-skills`;
    blockedPath = join(checkHome, ".claude", "skills", "postmaster");
  });

  test("a missing link is named, the install command is shown, and --check changes nothing", () => {
    const before = stateAt(checkHome);
    const r = runCheck(checkTool, checkHome);
    expect(r.rc).toBe(1);
    expect(r.out).toContain(
      `MISSING LINK    ${join(checkHome, ".claude", "skills", "postmaster")}`,
    );
    expect(r.out).toContain(`run: ${checkRun}`);
    expect(stateAt(checkHome)).toBe(before);
  });

  test("a blocked path is named, the install command is shown, and --check changes nothing", () => {
    mkdirSync(dirname(blockedPath), { recursive: true });
    writeFileSync(blockedPath, "keep this file\n", "utf8");
    const before = stateAt(checkHome);
    const r = runCheck(checkTool, checkHome);
    expect(r.rc).toBe(1);
    expect(r.out).toContain(`IN THE WAY      ${blockedPath} is a file`);
    expect(r.out).toContain(`run: ${checkRun}`);
    expect(stateAt(checkHome)).toBe(before);
  });

  test("a complete set passes through the same --check command without changes", () => {
    rmSync(blockedPath);
    // Install for real, through the same in-process call the command uses.
    const irc = withHome(checkHome, () => capture(() => makeLinks(checkTool, 0)).ret);
    expect(irc).toBe(0);
    const before = stateAt(checkHome);
    const r = runCheck(checkTool, checkHome);
    expect(r.rc).toBe(0);
    expect(r.out).toContain("all skills are linked");
    expect(stateAt(checkHome)).toBe(before);
  });

  test("with no harness installed, --check says so and changes nothing", () => {
    // No harness installed: a PATH holding only plumbing (plus sh, which the
    // port's harness lookup shells) and an empty HOME.
    const noneBin = join(tmp, "none-bin");
    const noneHome = join(tmp, "none-home");
    mkdirSync(noneBin, { recursive: true });
    mkdirSync(noneHome, { recursive: true });
    for (const t of ["sh", "bash", "env", "git", "readlink", "dirname", "basename", "sed"]) {
      const r = spawnSync("sh", ["-c", `command -v ${t}`], { encoding: "utf8" });
      const p = r.stdout.trim().split("\n").pop() ?? "";
      if (!p.startsWith("/")) {
        throw new Error(`link-skills test setup: ${t} is not on PATH`);
      }
      symlinkSync(p, join(noneBin, t));
    }
    const before = stateAt(noneHome);
    const r = runCheck(checkTool, noneHome, noneBin);
    expect(r.rc).toBe(0);
    expect(r.out).toContain("no harness skills folders found");
    expect(stateAt(noneHome)).toBe(before);
  });
});

describe("installing: every skill, for every installed harness with a skills folder", () => {
  let rc1 = -1;
  let installOut = "";

  beforeAll(() => {
    const c = capture(() => makeLinks(TOOL, 0));
    rc1 = c.ret;
    installOut = c.out;
  });

  test("each skill is a link from claude's folder and from ~/.agents/skills to the checkout", () => {
    expect(rc1).toBe(0);
    expect(linksTo(join(C, "postmaster"), join(TOOL, "skills", "postmaster"))).toBe(true);
    expect(linksTo(join(C, "wiki"), join(TOOL, "skills", "wiki"))).toBe(true);
    expect(linksTo(join(A, "postmaster"), join(TOOL, "skills", "postmaster"))).toBe(true);
    expect(linksTo(join(A, "wiki"), join(TOOL, "skills", "wiki"))).toBe(true);
  });

  test("nothing else is made, for a harness not installed or with no skills folder", () => {
    expect(readdirSync(home).sort().join(" ")).toBe(".agents .claude");
  });

  test("harnesses that read one folder get one link there", () => {
    expect(installOut).toContain(`shared folder   pi reads ${A}, linked for another harness`);
  });

  test("a harness with no skills folder is named with the absolute path its brief gives", () => {
    expect(installOut).toContain(
      `no skills folder agy: its brief names ${join(TOOL, "skills", "postmaster", "SKILL.md")} by absolute path`,
    );
  });

  test("nothing in a skills folder is a copy", () => {
    let copies = "";
    for (const dir of [C, A]) {
      try {
        for (const n of readdirSync(dir)) {
          const p = join(dir, n);
          if (!isLink(p)) copies += `${p}\n`;
        }
      } catch {
        /* empty */
      }
    }
    expect(copies).toBe("");
  });

  test("running it again changes nothing", () => {
    const before = state();
    const c = capture(() => makeLinks(TOOL, 0));
    expect(c.ret).toBe(0);
    expect(state()).toBe(before);
    expect(c.out.split("\n").some((l) => l.startsWith("linked "))).toBe(false);
  });

  test("claude's folder moves with CLAUDE_CONFIG_DIR", () => {
    process.env.CLAUDE_CONFIG_DIR = join(tmp, "cfg");
    try {
      capture(() => makeLinks(TOOL, 0));
    } finally {
      delete process.env.CLAUDE_CONFIG_DIR;
    }
    expect(
      linksTo(join(tmp, "cfg", "skills", "postmaster"), join(TOOL, "skills", "postmaster")),
    ).toBe(true);
  });
});

describe("positive control: from an unrelated directory, a documented command resolves through the link and runs", () => {
  beforeAll(() => {
    const skillMd = join(TOOL, "skills", "postmaster", "SKILL.md");
    const trackersMd = join(TOOL, "skills", "postmaster", "trackers.md");
    try {
      resolver =
        readFileSync(skillMd, "utf8")
          .split("\n")
          .find((l) => l.includes('realpath "<skill>/../.."'))
          ?.match(/`(realpath "<skill>\/\.\.\/\.\.")/u)?.[1] ?? "";
      documented =
        readFileSync(trackersMd, "utf8")
          .split("\n")
          .find((l) => /^<tool>\/scripts\/run github <repo> board +#/u.test(l))
          ?.replace(/ *#.*$/u, "") ?? "";
    } catch {
      /* files not found */
    }
    // stub gh
    writeFileSync(
      join(bin, "gh"),
      `#!/bin/sh
case "$1 $2" in
  "auth status") exit 0 ;;
  "api graphql") echo '{"data": {"repository": {"projectsV2": {"nodes": [{"id": "PVT_1", "number": 1, "title": "r", "closed": false, "url": "https://github.com/users/o/projects/1", "owner": {"login": "o"}}]}}}}' ;;
  *) echo "stub gh: unexpected: $*" >&2; exit 1 ;;
esac
`,
      "utf8",
    );
    chmodSync(join(bin, "gh"), 0o755);
    run("git", ["init", "-q", join(tmp, "target")]);
    run("git", [
      "-C",
      join(tmp, "target"),
      "remote",
      "add",
      "origin",
      "https://github.com/o/r.git",
    ]);
  });

  test("SKILL.md documents how <tool> is found, and trackers.md the board command", () => {
    expect(resolver).not.toBe("");
    expect(documented).not.toBe("");
    const skillMd = readFileSync(join(TOOL, "skills", "postmaster", "SKILL.md"), "utf8");
    // The command resolves the link; the prose tells the reader to stop when the checkout
    // it leads into holds no scripts/run.
    expect(skillMd).toContain("the skill was copied, or its link points somewhere else");
  });

  test("<tool> is the checkout the link leads to", () => {
    const r = run("bash", ["-c", resolver.replace(/<skill>/gu, join(C, "postmaster"))], {
      cwd: elsewhere,
      env: { ...process.env, PATH: bin, HOME: home },
    });
    expect(r.code).toBe(0);
    expect(r.out.trim()).toBe(TOOL);
  });

  test("the board command runs through the link", () => {
    const r = through(join(C, "postmaster"));
    expect(r.code).toBe(0);
    expect(r.out).toContain("https://github.com/users/o/projects/1");
  });

  test("a session in the checkout itself, sent to skills/postmaster, finds that checkout", () => {
    const r = run("bash", ["-c", resolver.replace(/<skill>/gu, "skills/postmaster")], {
      cwd: TOOL,
      env: { ...process.env, PATH: bin, HOME: home },
    });
    expect(r.code).toBe(0);
    expect(r.out.trim()).toBe(TOOL);
  });

  test("a skill path with spaces still resolves, through the documented quotes", () => {
    const spaced = join(tmp, "with space");
    mkdirSync(spaced, { recursive: true });
    symlinkSync(join(TOOL, "skills", "postmaster"), join(spaced, "postmaster"));
    const r = run("bash", ["-c", resolver.replace(/<skill>/gu, join(spaced, "postmaster"))], {
      cwd: elsewhere,
      env: { ...process.env, PATH: bin, HOME: home },
    });
    expect(r.code).toBe(0);
    expect(r.out.trim()).toBe(TOOL);
  }, 30000);
});

describe("negative controls: the same command fails, and what breaks names where the link led", () => {
  afterAll(() => {
    const link = join(C, "postmaster");
    rmSync(link, { force: true });
    symlinkSync(join(TOOL, "skills", "postmaster"), link);
  });

  test("with the link missing", () => {
    const link = join(C, "postmaster");
    rmSync(link, { force: true });
    expectNamedFailure(link, link);
  });

  test("with the link pointing elsewhere", () => {
    const link = join(C, "postmaster");
    symlinkSync(elsewhere, link);
    // realpath <link>/../.. is the target's parent's parent.
    expectNamedFailure(link, realpathSync(join(tmp, "..")));
  });

  test("with the link pointing at a copy of the skill", () => {
    const link = join(C, "postmaster");
    rmSync(link, { force: true });
    mkdirSync(join(tmp, "copy"), { recursive: true });
    run("cp", ["-R", join(TOOL, "skills", "postmaster"), join(tmp, "copy", "postmaster")]);
    symlinkSync(join(tmp, "copy", "postmaster"), link);
    // realpath <link>/../.. is the copy's parent's parent.
    expectNamedFailure(link, realpathSync(tmp));
  });
});

describe("negative controls: nothing in the way is replaced, and nothing else changes", () => {
  function attempt(): { rc: number; out: string; before: string } {
    const before = state();
    const c = capture(() => makeLinks(TOOL, 0));
    return { rc: c.ret, out: c.out, before };
  }

  afterAll(() => {
    capture(() => makeLinks(TOOL, 0));
  });

  test("a real folder where a link belongs is named", () => {
    const link = join(C, "postmaster");
    rmSync(join(A, "wiki"), { force: true });
    rmSync(link, { force: true });
    mkdirSync(link, { recursive: true });
    const r = attempt();
    expect(r.rc).toBe(1);
    expect(r.out).toContain(`IN THE WAY      ${link}`);
    expect(state()).toBe(r.before);
  });

  test("a refusal makes no other link either", () => {
    expect(existsSync(join(A, "wiki"))).toBe(false);
  });

  test("a real file where a link belongs is named", () => {
    const link = join(C, "postmaster");
    rmSync(link, { recursive: true, force: true });
    writeFileSync(link, "x\n", "utf8");
    const r = attempt();
    expect(r.rc).toBe(1);
    expect(r.out).toContain(`IN THE WAY      ${link}`);
    expect(state()).toBe(r.before);
  });

  test("a link that points elsewhere is named", () => {
    const link = join(C, "postmaster");
    rmSync(link, { force: true });
    symlinkSync(elsewhere, link);
    const r = attempt();
    expect(r.rc).toBe(1);
    expect(r.out).toContain(`IN THE WAY      ${link}`);
    expect(state()).toBe(r.before);
  });

  test("a link that points nowhere is named", () => {
    const link = join(C, "postmaster");
    rmSync(link, { force: true });
    symlinkSync(join(tmp, "nowhere"), link);
    const r = attempt();
    expect(r.rc).toBe(1);
    expect(r.out).toContain(`IN THE WAY      ${link}`);
    expect(state()).toBe(r.before);
  });

  test("--dry-run names the links it would make, and makes none", () => {
    const link = join(C, "postmaster");
    rmSync(link, { force: true });
    const c = capture(() => makeLinks(TOOL, 1));
    expect(c.ret).toBe(0);
    expect(isLink(link)).toBe(false);
    expect(isLink(join(A, "wiki"))).toBe(false);
    expect(c.out).toContain(`to link         ${link}`);
  });
});

describe("a skills folder that is itself a link into a checkout's skills", () => {
  let fixture = "";
  let fHome = "";

  beforeAll(() => {
    fixture = join(tmp, "fixture");
    mkdirSync(join(fixture, "skills", "postmaster"), { recursive: true });
    mkdirSync(join(fixture, "skills", "wiki"), { recursive: true });
    writeFileSync(
      join(fixture, "skills", "postmaster", "SKILL.md"),
      "---\nname: postmaster\n---\n",
      "utf8",
    );
    writeFileSync(join(fixture, "skills", "wiki", "SKILL.md"), "---\nname: wiki\n---\n", "utf8");
    fHome = join(tmp, "fhome");
    mkdirSync(join(fHome, ".claude"), { recursive: true });
    mkdirSync(join(fHome, ".agents", "skills"), { recursive: true });
    symlinkSync(join(fixture, "skills"), join(fHome, ".claude", "skills"));
  });

  test("counts as linked, and nothing is written into the checkout", () => {
    const c = withHome(fHome, () => capture(() => makeLinks(fixture, 0)));
    expect(c.ret).toBe(0);
    expect(c.out).toContain(`already linked  ${join(fHome, ".claude", "skills", "postmaster")}`);
  });

  test("--remove leaves it, and the checkout, alone", () => {
    withHome(fHome, () => capture(() => removeLinks(fixture)));
    expect(existsSync(join(fixture, "skills", "postmaster"))).toBe(true);
    expect(isLink(join(fHome, ".claude", "skills"))).toBe(true);
  });
});

describe("--remove: only the links to this checkout's skills", () => {
  test("its own links go; a link elsewhere and a real folder stay", () => {
    capture(() => makeLinks(TOOL, 0));
    symlinkSync(elsewhere, join(C, "other"));
    rmSync(join(A, "wiki"), { force: true });
    mkdirSync(join(A, "wiki"), { recursive: true });
    capture(() => removeLinks(TOOL));
    expect(isLink(join(C, "postmaster"))).toBe(false);
    expect(isLink(join(C, "wiki"))).toBe(false);
    expect(isLink(join(A, "postmaster"))).toBe(false);
    expect(isLink(join(C, "other"))).toBe(true);
    expect(isDirectory(join(A, "wiki"))).toBe(true);
  });
});

describe("which checkout is linked", () => {
  let repo = "";
  let repoReal = "";
  let pkgReal = "";
  let nestedReal = "";

  beforeAll(() => {
    repo = join(tmp, "repo");
    run("git", ["init", "-q", "-b", "main", repo]);
    run("git", [
      "-C",
      repo,
      "-c",
      "user.name=t",
      "-c",
      "use" + "r.e" + "mai" + "l=t" + "@t",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "first",
    ]);
    run("git", ["-C", repo, "worktree", "add", "-q", join(repo, ".worktrees", "wt"), "-b", "wt"]);
    // Physically, as git reports the main checkout; resolve() alone keeps a
    // linked parent (as /tmp is on macOS) spelled the caller's way.
    repoReal = realpathSync(repo);
    const pkg = join(tmp, "pkg");
    mkdirSync(pkg, { recursive: true });
    mkdirSync(join(repo, "node_modules", "pkg"), { recursive: true });
    pkgReal = resolve(pkg);
    nestedReal = resolve(join(repo, "node_modules", "pkg"));
  });

  test("from a worktree: the main checkout, never the worktree", () => {
    expect(checkoutRoot(join(repo, ".worktrees", "wt"))).toBe(repoReal);
  });

  test("from the main checkout: itself", () => {
    expect(checkoutRoot(repo)).toBe(repoReal);
  });

  test("from a tree outside git, such as an installed package: itself", () => {
    expect(checkoutRoot(pkgReal)).toBe(pkgReal);
  });

  test("from a package inside another project's checkout: the package, not the project", () => {
    expect(checkoutRoot(nestedReal)).toBe(nestedReal);
  });

  test("a bare main checkout is refused", () => {
    run("git", ["clone", "-q", "--bare", repo, join(tmp, "bare.git")]);
    run("git", [
      "-C",
      join(tmp, "bare.git"),
      "worktree",
      "add",
      "-q",
      join(tmp, "bare-wt"),
      "main",
    ]);
    const c = capture(() => checkoutRoot(resolve(join(tmp, "bare-wt"))));
    expect(c.ret).toBeNull();
  });
});

describe("this script and harnesses.md's Skills folders table agree", () => {
  function readSkillsTable(): string {
    const harnessesMd = join(TOOL, "skills", "postmaster", "harnesses.md");
    let table = "";
    try {
      const text = readFileSync(harnessesMd, "utf8");
      const lines = text.split("\n");
      let on = false;
      for (const l of lines) {
        if (l.startsWith("## Skills folders")) {
          on = true;
          continue;
        }
        if (on && l.startsWith("## ")) break;
        if (on && /^\| [a-z]+ \|/u.test(l)) table += `${l}\n`;
      }
    } catch {
      /* no harnesses.md */
    }
    return table;
  }

  function tableCell(h: string, table: string, homeDir: string): { cell: string; want: string } {
    const row = table.split("\n").find((l) => {
      const name = (l.split("|")[1] ?? "").replace(/ /gu, "");
      return name === h;
    });
    const cell = row ? (row.split("|")[2] ?? "") : "";
    const wantMatch = cell.match(/^ *`([^`]*)`/u);
    let want = wantMatch ? (wantMatch[1] ?? "") : "";
    if (want.startsWith("~")) want = homeDir + want.slice(1);
    return { cell, want };
  }

  test("harnesses.md has a Skills folders table", () => {
    expect(readSkillsTable()).not.toBe("");
  });

  const tableAtDef = readSkillsTable();
  for (const h of HARNESSES) {
    const { want: defWant } = tableCell(h, tableAtDef, process.env.HOME ?? "~");
    test(`${h}: ${defWant || "no skills folder"}`, () => {
      const { cell, want } = tableCell(h, readSkillsTable(), process.env.HOME ?? "~");
      const scriptSays = skillsFolder(h) ?? "";
      expect(cell).not.toBe("");
      expect(scriptSays).toBe(want);
    });
  }
});
