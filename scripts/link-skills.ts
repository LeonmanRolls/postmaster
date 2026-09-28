// Install each skill as a link, never a copy: from the user-level skills folder of every
// installed harness that has one, to that skill in the postmaster checkout. The checkout stays
// the one source of truth, and a session finds the repo from the link (SKILL.md, first
// section). The links go to the main checkout even when this runs from a worktree, and to this
// script's own tree when that is not a git checkout at all, as with an installed package.
//
//   link-skills.sh [--dry-run]   link every skill for every installed harness with a skills folder
//   link-skills.sh --remove      remove the links to this checkout's skills, and nothing else
//   link-skills.sh --self-test
//
//   exit 0  every link is in place, or would be (--dry-run), or is removed (--remove)
//   exit 1  usage, no skills in the checkout, a bare main checkout, or something in the way

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { scriptsDir, toolRoot } from "./lib/paths.ts";
import { die, run, withTempDir } from "./lib/proc.ts";
import { SelfTest } from "./lib/selftest.ts";

const _HERE = scriptsDir(import.meta);
const HARNESSES = ["claude", "codex", "grok", "agy", "muse", "pi", "mimo"];

function skillsFolder(h: string): string | null {
  const home = process.env.HOME ?? "~";
  switch (h) {
    case "claude":
      return join(process.env.CLAUDE_CONFIG_DIR || join(home, ".claude"), "skills");
    case "codex":
    case "grok":
    case "mimo":
    case "muse":
    case "pi":
      return join(home, ".agents", "skills");
    default:
      return null;
  }
}

function checkoutRoot(tree: string): string | null {
  const top = run("git", ["-C", tree, "rev-parse", "--show-toplevel"]);
  if (top.code !== 0) return tree;
  const t = resolve(top.out.trim());
  if (t !== resolve(tree)) return tree;
  const list = run("git", ["-C", tree, "worktree", "list", "--porcelain"]);
  if (list.code !== 0) {
    console.error(`link-skills: git cannot list the worktrees of ${tree}`);
    return null;
  }
  const lines = list.out.trim().split("\n");
  if (lines[1] === "bare") {
    console.error(
      `link-skills: the main checkout of ${tree} is bare; run this from a checkout with files`,
    );
    return null;
  }
  const first = lines[0]?.replace(/^worktree /, "") ?? tree;
  return resolve(first);
}

function sameDir(a: string, b: string): boolean {
  try {
    return resolve(realpathSync(a)) === resolve(realpathSync(b));
  } catch {
    return false;
  }
}

function isLink(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

function plan(root: string): string[] | null {
  const skills = [];
  try {
    const entries = readdirSync(join(root, "skills"));
    for (const n of entries) {
      if (existsSync(join(root, "skills", n, "SKILL.md"))) {
        skills.push(join(root, "skills", n, "SKILL.md"));
      }
    }
  } catch {
    /* no skills */
  }
  if (skills.length === 0) {
    console.error(`link-skills: no skills/*/SKILL.md in ${root}`);
    return null;
  }
  const lines: string[] = [];
  let seen = "";
  for (const h of HARNESSES) {
    // `command -v` is a shell builtin, so ask a shell for it.
    if (run("sh", ["-c", `command -v ${h}`]).code !== 0) {
      lines.push(`absent\t${h}`);
      continue;
    }
    const folder = skillsFolder(h);
    if (!folder) {
      lines.push(`no-folder\t${h}\t${join(root, "skills", "postmaster", "SKILL.md")}`);
      continue;
    }
    if (isLink(folder) && !isDirectory(folder)) {
      lines.push(`in-the-way\t${folder}\ta link to ${readlinkSync(folder)}`);
      continue;
    }
    if (existsSync(folder) && !isDirectory(folder)) {
      lines.push(`in-the-way\t${folder}\ta file`);
      continue;
    }
    let key = folder;
    if (isDirectory(folder)) {
      try {
        key = resolve(realpathSync(folder));
      } catch {
        /* keep folder */
      }
    }
    if (seen.includes(`<${key}>`)) {
      lines.push(`shared\t${h}\t${folder}`);
      continue;
    }
    seen += `<${key}>`;
    for (const skill of skills) {
      const name = basename(dirname(skill));
      const path = join(folder, name);
      const target = join(root, "skills", name);
      if (isLink(path)) {
        if (readlinkSync(path) === target || sameDir(path, target)) {
          lines.push(`linked\t${path}\t${target}\t${h}`);
        } else {
          lines.push(`in-the-way\t${path}\ta link to ${readlinkSync(path)}`);
        }
      } else if (sameDir(path, target)) {
        lines.push(`linked\t${path}\t${target}\t${h}`);
      } else if (isDirectory(path)) {
        lines.push(`in-the-way\t${path}\ta folder`);
      } else if (existsSync(path)) {
        lines.push(`in-the-way\t${path}\ta file`);
      } else {
        lines.push(`link\t${path}\t${target}\t${h}`);
      }
    }
  }
  return lines;
}

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function report(line: string): string {
  const parts = line.split("\t");
  const verdict = parts[0] ?? "";
  const a = parts[1] ?? "";
  const b = parts[2] ?? "";
  const c = parts[3] ?? "";
  switch (verdict) {
    case "absent":
      return `not installed   ${a}`;
    case "no-folder":
      return `no skills folder ${a}: its brief names ${b} by absolute path`;
    case "shared":
      return `shared folder   ${a} reads ${b}, linked for another harness`;
    case "linked":
      return `already linked  ${a} -> ${b} (${c})`;
    case "link":
      return `to link         ${a} -> ${b} (${c})`;
    case "in-the-way":
      return `IN THE WAY      ${a} is ${b}`;
    default:
      return line;
  }
}

function makeLinks(root: string, dry: number): number {
  const p = plan(root);
  if (p === null) return 1;
  for (const line of p) console.log(report(line));
  if (p.some((l) => l.startsWith("in-the-way"))) {
    console.error(
      "link-skills: nothing was changed; move what is in the way, or ask the user to, then run this again",
    );
    return 1;
  }
  if (dry === 1) return 0;
  for (const line of p) {
    const parts = line.split("\t");
    if (parts[0] !== "link") continue;
    const path = parts[1] ?? "";
    const target = parts[2] ?? "";
    const h = parts[3] ?? "";
    try {
      mkdirSync(dirname(path), { recursive: true });
      symlinkSync(target, path);
      if (readlinkSync(path) !== target) throw new Error("link mismatch");
      console.log(`linked          ${path} -> ${target} (${h})`);
    } catch {
      console.error(`link-skills: could not link ${path}`);
      return 1;
    }
  }
  return 0;
}

function removeLinks(root: string): number {
  let seen = "";
  for (const h of HARNESSES) {
    const folder = skillsFolder(h);
    if (!folder) continue;
    if (seen.includes(`<${folder}>`)) continue;
    seen += `<${folder}>`;
    try {
      const entries = readdirSync(join(root, "skills"));
      for (const n of entries) {
        if (!existsSync(join(root, "skills", n, "SKILL.md"))) continue;
        const name = n;
        const path = join(folder, name);
        if (!isLink(path)) continue;
        const target = join(root, "skills", name);
        if (readlinkSync(path) === target || sameDir(path, target)) {
          rmSync(path, { force: true });
          console.log(`removed         ${path}`);
        } else {
          console.log(`left alone      ${path}, a link to ${readlinkSync(path)}`);
        }
      }
    } catch {
      /* no skills folder contents */
    }
  }
  return 0;
}

// --- entry -----------------------------------------------------------------------------------
const argv = process.argv.slice(2);
if (argv[0] === "--self-test") {
  // fall through
} else if (argv[0] === "--dry-run") {
  const ROOT = checkoutRoot(toolRoot(import.meta));
  if (ROOT === null) process.exit(1);
  process.exit(makeLinks(ROOT, 1));
} else if (argv[0] === "--remove") {
  const ROOT = checkoutRoot(toolRoot(import.meta));
  if (ROOT === null) process.exit(1);
  process.exit(removeLinks(ROOT));
} else if (argv[0] === undefined || argv[0] === "") {
  const ROOT = checkoutRoot(toolRoot(import.meta));
  if (ROOT === null) process.exit(1);
  process.exit(makeLinks(ROOT, 0));
} else {
  die("usage: link-skills.sh [--dry-run] | --remove | --self-test", 1);
}

// --- self-test ---------------------------------------------------------------------------------
withTempDir((tmp) => {
  const TOOL = toolRoot(import.meta);
  const st = new SelfTest();
  const bin = join(tmp, "bin");
  const home = join(tmp, "home");
  const elsewhere = join(tmp, "elsewhere");
  mkdirSync(bin, { recursive: true });
  mkdirSync(home, { recursive: true });
  mkdirSync(elsewhere, { recursive: true });

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
      console.error(`self-test: ${t} is not on PATH`);
      process.exit(1);
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

  const C = join(home, ".claude", "skills");
  const A = join(home, ".agents", "skills");

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

  console.log("installing: every skill, for every installed harness with a skills folder");
  // Capture stdout of makeLinks by swapping the console out for the duration of each call.
  const origLog = console.log;
  const origErr = console.error;
  let outBuf = "";
  console.log = (...args: unknown[]) => {
    outBuf += `${args.map(String).join(" ")}\n`;
  };
  console.error = (...args: unknown[]) => {
    outBuf += `${args.map(String).join(" ")}\n`;
  };
  const rc1 = makeLinks(TOOL, 0);
  console.log = origLog;
  console.error = origErr;

  st.check(
    "each skill is a link from claude's folder and from ~/.agents/skills to the checkout",
    rc1 === 0 &&
      linksTo(join(C, "postmaster"), join(TOOL, "skills", "postmaster")) &&
      linksTo(join(C, "wiki"), join(TOOL, "skills", "wiki")) &&
      linksTo(join(A, "postmaster"), join(TOOL, "skills", "postmaster")) &&
      linksTo(join(A, "wiki"), join(TOOL, "skills", "wiki")),
    outBuf,
  );
  {
    const homeEntries = readdirSync(home).sort().join(" ");
    st.check(
      "nothing else is made, for a harness not installed or with no skills folder",
      homeEntries === ".agents .claude",
      homeEntries,
    );
  }
  st.check(
    "harnesses that read one folder get one link there",
    outBuf.includes(`shared folder   pi reads ${A}, linked for another harness`),
    outBuf,
  );
  st.check(
    "a harness with no skills folder is named with the absolute path its brief gives",
    outBuf.includes(
      `no skills folder agy: its brief names ${join(TOOL, "skills", "postmaster", "SKILL.md")} by absolute path`,
    ),
    outBuf,
  );
  {
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
    st.check("nothing in a skills folder is a copy", copies === "", copies);
  }
  const before = state();
  outBuf = "";
  console.log = (...args: unknown[]) => {
    outBuf += `${args.map(String).join(" ")}\n`;
  };
  console.error = (...args: unknown[]) => {
    outBuf += `${args.map(String).join(" ")}\n`;
  };
  const rc2 = makeLinks(TOOL, 0);
  console.log = origLog;
  console.error = origErr;
  st.check(
    "running it again changes nothing",
    rc2 === 0 && state() === before && !outBuf.split("\n").some((l) => l.startsWith("linked ")),
    outBuf,
  );
  process.env.CLAUDE_CONFIG_DIR = join(tmp, "cfg");
  outBuf = "";
  console.log = (...args: unknown[]) => {
    outBuf += `${args.map(String).join(" ")}\n`;
  };
  console.error = (...args: unknown[]) => {
    outBuf += `${args.map(String).join(" ")}\n`;
  };
  makeLinks(TOOL, 0);
  console.log = origLog;
  console.error = origErr;
  delete process.env.CLAUDE_CONFIG_DIR;
  st.check(
    "claude's folder moves with CLAUDE_CONFIG_DIR",
    linksTo(join(tmp, "cfg", "skills", "postmaster"), join(TOOL, "skills", "postmaster")),
  );

  console.log(
    "positive control: from an unrelated directory, a documented command resolves through the link and runs",
  );
  const skillMd = join(TOOL, "skills", "postmaster", "SKILL.md");
  const trackersMd = join(TOOL, "skills", "postmaster", "trackers.md");
  let resolver = "";
  let documented = "";
  try {
    resolver =
      readFileSync(skillMd, "utf8")
        .split("\n")
        .find((l) => l.includes('test -f "$t/scripts/link-skills.sh"')) ?? "";
    documented =
      readFileSync(trackersMd, "utf8")
        .split("\n")
        .find((l) => /^<tool>\/scripts\/github\.sh <repo> board +#/.test(l))
        ?.replace(/ *#.*$/, "") ?? "";
  } catch {
    /* files not found */
  }
  st.check(
    "SKILL.md documents how <tool> is found, and trackers.md the board command",
    resolver !== "" && documented !== "",
    `found: [${resolver}] [${documented}]`,
  );
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
  run("git", ["-C", join(tmp, "target"), "remote", "add", "origin", "https://github.com/o/r.git"]);

  function through(skillDir: string): { code: number; out: string } {
    const findTool = resolver.replace(/<skill>/g, skillDir);
    const command = documented.replace(/<repo>/g, join(tmp, "target")).replace(/<tool>/g, "$tool");
    const r = run("bash", ["-c", `tool=$(${findTool}) && ${command}`], {
      cwd: elsewhere,
      env: { ...process.env, PATH: bin, HOME: home },
    });
    return { code: r.code, out: r.out + r.err };
  }

  {
    const r = run("bash", ["-c", resolver.replace(/<skill>/g, join(C, "postmaster"))], {
      cwd: elsewhere,
      env: { ...process.env, PATH: bin, HOME: home },
    });
    st.check(
      "<tool> is the checkout the link leads to",
      r.code === 0 && r.out.trim() === TOOL,
      `exit ${r.code}\n${r.out}`,
    );
  }
  {
    const r = through(join(C, "postmaster"));
    st.check(
      "the board command runs through the link",
      r.code === 0 && r.out.includes("https://github.com/users/o/projects/1"),
      `exit ${r.code}\n${r.out}`,
    );
  }
  {
    const r = run("bash", ["-c", resolver.replace(/<skill>/g, "skills/postmaster")], {
      cwd: TOOL,
      env: { ...process.env, PATH: bin, HOME: home },
    });
    st.check(
      "a session in the checkout itself, sent to skills/postmaster, finds that checkout",
      r.code === 0 && r.out.trim() === TOOL,
      `exit ${r.code}\n${r.out}`,
    );
  }

  console.log(
    "negative controls: the same command fails, naming the link, never a bare 'no such file'",
  );
  const link = join(C, "postmaster");
  function namedFailure(label: string): void {
    const r = through(link);
    const out = r.out;
    const ok1 =
      r.code !== 0 &&
      out.includes(link) &&
      !out.toLowerCase().includes("no such file") &&
      !out.includes("projects/1");
    st.check(label, ok1, `exit ${r.code}\n${out}`);
  }
  rmSync(link, { force: true });
  namedFailure("with the link missing");
  symlinkSync(elsewhere, link);
  namedFailure("with the link pointing elsewhere");
  rmSync(link, { force: true });
  mkdirSync(join(tmp, "copy"), { recursive: true });
  run("cp", ["-R", join(TOOL, "skills", "postmaster"), join(tmp, "copy", "postmaster")]);
  symlinkSync(join(tmp, "copy", "postmaster"), link);
  namedFailure("with the link pointing at a copy of the skill");
  rmSync(link, { force: true });
  symlinkSync(join(TOOL, "skills", "postmaster"), link);

  console.log("negative controls: nothing in the way is replaced, and nothing else changes");
  function inTheWay(label: string, path: string): void {
    const before = state();
    outBuf = "";
    console.log = (...args: unknown[]) => {
      outBuf += `${args.map(String).join(" ")}\n`;
    };
    console.error = (...args: unknown[]) => {
      outBuf += `${args.map(String).join(" ")}\n`;
    };
    const rc = makeLinks(TOOL, 0);
    console.log = origLog;
    console.error = origErr;
    st.check(
      label,
      rc === 1 && outBuf.includes(`IN THE WAY      ${path}`) && state() === before,
      `exit ${rc}\n${outBuf}`,
    );
  }
  rmSync(join(A, "wiki"), { force: true });
  rmSync(link, { force: true });
  mkdirSync(link, { recursive: true });
  inTheWay("a real folder where a link belongs is named", link);
  st.check("a refusal makes no other link either", !existsSync(join(A, "wiki")));
  rmSync(link, { recursive: true, force: true });
  writeFileSync(link, "x\n", "utf8");
  inTheWay("a real file where a link belongs is named", link);
  rmSync(link, { force: true });
  symlinkSync(elsewhere, link);
  inTheWay("a link that points elsewhere is named", link);
  rmSync(link, { force: true });
  symlinkSync(join(tmp, "nowhere"), link);
  inTheWay("a link that points nowhere is named", link);
  rmSync(link, { force: true });
  outBuf = "";
  console.log = (...args: unknown[]) => {
    outBuf += `${args.map(String).join(" ")}\n`;
  };
  console.error = (...args: unknown[]) => {
    outBuf += `${args.map(String).join(" ")}\n`;
  };
  const rcDry = makeLinks(TOOL, 1);
  console.log = origLog;
  console.error = origErr;
  st.check(
    "--dry-run names the links it would make, and makes none",
    rcDry === 0 &&
      !isLink(link) &&
      !isLink(join(A, "wiki")) &&
      outBuf.includes(`to link         ${link}`),
    `exit ${rcDry}\n${outBuf}`,
  );

  // restore links
  makeLinks(TOOL, 0);

  console.log("a skills folder that is itself a link into a checkout's skills");
  const fixture = join(tmp, "fixture");
  mkdirSync(join(fixture, "skills", "postmaster"), { recursive: true });
  mkdirSync(join(fixture, "skills", "wiki"), { recursive: true });
  writeFileSync(
    join(fixture, "skills", "postmaster", "SKILL.md"),
    "---\nname: postmaster\n---\n",
    "utf8",
  );
  writeFileSync(join(fixture, "skills", "wiki", "SKILL.md"), "---\nname: wiki\n---\n", "utf8");
  const _fixtureReal = resolve(fixture);
  const fHome = join(tmp, "fhome");
  mkdirSync(join(fHome, ".claude"), { recursive: true });
  mkdirSync(join(fHome, ".agents", "skills"), { recursive: true });
  symlinkSync(join(fixture, "skills"), join(fHome, ".claude", "skills"));
  {
    const origHome = process.env.HOME;
    process.env.HOME = fHome;
    outBuf = "";
    console.log = (...args: unknown[]) => {
      outBuf += `${args.map(String).join(" ")}\n`;
    };
    console.error = (...args: unknown[]) => {
      outBuf += `${args.map(String).join(" ")}\n`;
    };
    const rc = makeLinks(fixture, 0);
    console.log = origLog;
    console.error = origErr;
    process.env.HOME = origHome;
    st.check(
      "counts as linked, and nothing is written into the checkout",
      rc === 0 &&
        outBuf.includes(`already linked  ${join(fHome, ".claude", "skills", "postmaster")}`),
      `exit ${rc}\n${outBuf}`,
    );
    process.env.HOME = fHome;
    outBuf = "";
    console.log = (...args: unknown[]) => {
      outBuf += `${args.map(String).join(" ")}\n`;
    };
    console.error = (...args: unknown[]) => {
      outBuf += `${args.map(String).join(" ")}\n`;
    };
    removeLinks(fixture);
    console.log = origLog;
    console.error = origErr;
    process.env.HOME = origHome;
    st.check(
      "--remove leaves it, and the checkout, alone",
      existsSync(join(fixture, "skills", "postmaster")) && isLink(join(fHome, ".claude", "skills")),
    );
  }

  console.log("--remove: only the links to this checkout's skills");
  makeLinks(TOOL, 0);
  symlinkSync(elsewhere, join(C, "other"));
  rmSync(join(A, "wiki"), { force: true });
  mkdirSync(join(A, "wiki"), { recursive: true });
  outBuf = "";
  console.log = (...args: unknown[]) => {
    outBuf += `${args.map(String).join(" ")}\n`;
  };
  console.error = (...args: unknown[]) => {
    outBuf += `${args.map(String).join(" ")}\n`;
  };
  removeLinks(TOOL);
  console.log = origLog;
  console.error = origErr;
  st.check(
    "its own links go; a link elsewhere and a real folder stay",
    !isLink(join(C, "postmaster")) &&
      !isLink(join(C, "wiki")) &&
      !isLink(join(A, "postmaster")) &&
      isLink(join(C, "other")) &&
      isDirectory(join(A, "wiki")),
    outBuf,
  );

  console.log("which checkout is linked");
  const repo = join(tmp, "repo");
  run("git", ["init", "-q", "-b", "main", repo]);
  run("git", [
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
  run("git", ["-C", repo, "worktree", "add", "-q", join(repo, ".worktrees", "wt"), "-b", "wt"]);
  const repoReal = resolve(repo);
  {
    const cr = checkoutRoot(join(repo, ".worktrees", "wt"));
    st.check(
      "from a worktree: the main checkout, never the worktree",
      cr === repoReal,
      cr ?? "null",
    );
  }
  {
    const cr = checkoutRoot(repo);
    st.check("from the main checkout: itself", cr === repoReal);
  }
  const pkg = join(tmp, "pkg");
  mkdirSync(pkg, { recursive: true });
  mkdirSync(join(repo, "node_modules", "pkg"), { recursive: true });
  const pkgReal = resolve(pkg);
  const nestedReal = resolve(join(repo, "node_modules", "pkg"));
  {
    const cr = checkoutRoot(pkg);
    st.check(
      "from a tree outside git, such as an installed package: itself",
      cr === pkgReal,
      cr ?? "null",
    );
  }
  {
    const cr = checkoutRoot(nestedReal);
    st.check(
      "from a package inside another project's checkout: the package, not the project",
      cr === nestedReal,
      cr ?? "null",
    );
  }
  run("git", ["clone", "-q", "--bare", repo, join(tmp, "bare.git")]);
  run("git", ["-C", join(tmp, "bare.git"), "worktree", "add", "-q", join(tmp, "bare-wt"), "main"]);
  {
    const origErr2 = console.error;
    let errBuf = "";
    console.error = (...args: unknown[]) => {
      errBuf += `${args.map(String).join(" ")}\n`;
    };
    const cr = checkoutRoot(resolve(join(tmp, "bare-wt")));
    console.error = origErr2;
    st.check("a bare main checkout is refused", cr === null, errBuf);
  }

  console.log("this script and harnesses.md's Skills folders table agree");
  const harnessesMd = join(TOOL, "skills", "postmaster", "harnesses.md");
  let table = "";
  try {
    const text = readFileSync(harnessesMd, "utf8");
    const lines = text.split("\n");
    let on = false;
    for (const l of lines) {
      if (/^## Skills folders/.test(l)) {
        on = true;
        continue;
      }
      if (on && /^## /.test(l)) break;
      if (on && /^\| [a-z]+ \|/.test(l)) table += `${l}\n`;
    }
  } catch {
    /* no harnesses.md */
  }
  st.check("harnesses.md has a Skills folders table", table !== "", table);
  for (const h of HARNESSES) {
    const row = table.split("\n").find((l) => {
      const name = (l.split("|")[1] ?? "").trim();
      return name === h;
    });
    const cell = row ? (row.split("|")[2] ?? "") : "";
    const wantMatch = cell.match(/^\s*`([^`]*)`/);
    let want = wantMatch ? (wantMatch[1] ?? "") : "";
    if (want.startsWith("~")) want = (process.env.HOME ?? "~") + want.slice(1);
    const scriptSays = skillsFolder(h) ?? "";
    st.check(
      `${h}: ${want || "no skills folder"}`,
      cell !== "" && scriptSays === want,
      `script says '${scriptSays}', harnesses.md says '${cell || "no row"}'`,
    );
  }

  st.finish();
});
