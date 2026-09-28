// Cut a disposable reviewer scratch at a snapshot, with the installed dependency directories
// CLONED from a source worktree; tell a scratch from anything else; remove one. Nothing is ever
// installed into a scratch; a lane that opens on a broken scratch reports the breakage as a
// finding about the diff, or gives up on running the suite and reverts to reading.
//
//   cut-scratch.sh <repo> <source-worktree> <dest-path> <commit> [--clone <base>]
//   cut-scratch.sh --check <dest-path> <commit> [--clone <base>]
//   cut-scratch.sh --kind <dir>
//   cut-scratch.sh --remove <repo> <dest-path>
//   cut-scratch.sh --self-test
//
// A scratch is a detached worktree of <repo> at <commit>. With --clone it is a shared clone of
// <repo> instead (`git clone --shared`, which copies no objects), detached at <commit>: its
// origin is <repo>, so its `origin/HEAD` is the branch <repo> has checked out, which a review
// skill that diffs against `origin/HEAD` needs (harnesses.md, Own review skills). The clone is
// refused, and removed again, unless the merge base of its origin/HEAD and <commit> is <base>,
// so such a skill reviews exactly the change from <base> to <commit>. It borrows <repo>'s
// objects, and <commit> stays reachable there on the synthesis branch. A <dest-path> that
// already exists is refused and left alone.
//
// --check is the same test, made just before a lane is launched into a scratch: it is a scratch,
// its HEAD is <commit>, and with --clone it is a clone whose origin/HEAD leads back to <base>.
//
// --kind prints `worktree <repo>` for a detached worktree and `clone <repo>` for a shared clone,
// <repo> being the main checkout it was cut from, and exits 1 for anything else: a worktree on a
// branch is a lane's or the synthesis, never a scratch. --remove takes away a scratch of <repo>
// of either kind, a worktree through git and a clone with its directory, and refuses anything
// else, leaving it alone.
//
// Clones each directory named in DEPS_DIRS (default: node_modules) at the root AND under every
// workspace member (packages/*, apps/*): in a workspace each member carries its own link farm,
// and cloning only the root leaves a checkout that cannot resolve its own packages.
//
//   exit 0  scratch created, the dependency clone reported per directory; a scratch checked; a
//           scratch's kind printed; or the scratch removed
//   exit 1  usage; a dest that exists; git could not create the scratch; a scratch not at
//           <commit>; a worktree where a clone is needed, or a clone whose origin/HEAD does not
//           lead back to <base>; not a scratch, or not one of <repo>
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { scriptsDir } from "./lib/paths.ts";
import { run, withTempDir } from "./lib/proc.ts";
import { SelfTest } from "./lib/selftest.ts";

const DEPS = process.env.DEPS_DIRS ?? "node_modules";

interface CmdResult {
  code: number;
  out: string;
  err: string;
}

function usage(): never {
  console.error(
    "usage: cut-scratch.sh <repo> <source-worktree> <dest-path> <commit> [--clone <base>] | --check <dest-path> <commit> [--clone <base>] | --kind <dir> | --remove <repo> <dest-path> | --self-test",
  );
  process.exit(1);
}

function phys(dir: string): string {
  try {
    return realpathSync(dir);
  } catch {
    return "";
  }
}

function commonOf(dir: string): string {
  const r = run("git", ["-C", dir, "rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (r.code !== 0) return "";
  return phys(r.out.trim());
}

function mainOf(common: string): string {
  return common.endsWith("/.git") ? dirname(common) : common;
}

function cloneDir(src: string, dest: string): boolean {
  try {
    if (!statSync(src).isDirectory()) return false;
  } catch {
    return false;
  }
  mkdirSync(dirname(dest), { recursive: true });
  try {
    cpSync(src, dest, {
      recursive: true,
      verbatimSymlinks: true,
      force: true,
      errorOnExist: false,
    });
    return true;
  } catch {
    return false;
  }
}

function kind(dir: string): string {
  const d = phys(dir);
  if (!d) return "";
  const topR = run("git", ["-C", d, "rev-parse", "--show-toplevel"]);
  if (topR.code !== 0) return "";
  const top = phys(topR.out.trim());
  if (top !== d) return "";
  const gdR = run("git", ["-C", d, "rev-parse", "--path-format=absolute", "--git-dir"]);
  if (gdR.code !== 0) return "";
  const gitdir = phys(gdR.out.trim());
  const common = commonOf(d);
  if (!common) return "";
  if (gitdir !== common) {
    const ref = run("git", ["-C", d, "symbolic-ref", "-q", "HEAD"]);
    if (ref.code === 0) return "";
    return `worktree ${mainOf(common)}`;
  }
  let alt = "";
  try {
    alt = readFileSync(join(common, "objects/info/alternates"), "utf8").split("\n")[0] ?? "";
  } catch {
    return "";
  }
  if (!alt) return "";
  const urlR = run("git", ["-C", d, "config", "--get", "remote.origin.url"]);
  if (urlR.code !== 0) return "";
  const url = urlR.out.trim();
  if (!url.startsWith("/")) return "";
  const ocommon = commonOf(url);
  if (!ocommon) return "";
  if (phys(alt) !== join(ocommon, "objects")) return "";
  return `clone ${mainOf(ocommon)}`;
}

function verify(dest: string, snap: string, base = ""): CmdResult {
  const err: string[] = [];
  const k = kind(dest);
  if (!k) {
    err.push(`cut-scratch: ${dest} is no scratch`);
    return { code: 1, out: "", err: `${err.join("\n")}\n` };
  }
  const atR = run("git", ["-C", dest, "rev-parse", "--verify", "-q", `${snap}^{commit}`]);
  const headR = run("git", ["-C", dest, "rev-parse", "HEAD"]);
  const at = atR.code === 0 ? atR.out.trim() : "";
  if (!at || headR.out.trim() !== at) {
    err.push(`cut-scratch: ${dest} is not at ${snap}`);
    return { code: 1, out: "", err: `${err.join("\n")}\n` };
  }
  if (!base) return { code: 0, out: "", err: "" };
  if (!k.startsWith("clone ")) {
    err.push(
      `cut-scratch: ${dest} is a worktree, where a skill that diffs against origin/HEAD needs a clone`,
    );
    return { code: 1, out: "", err: `${err.join("\n")}\n` };
  }
  const wantR = run("git", ["-C", dest, "rev-parse", "--verify", "-q", `${base}^{commit}`]);
  const want = wantR.code === 0 ? wantR.out.trim() : "";
  const mbR = run("git", ["-C", dest, "merge-base", "origin/HEAD", "HEAD"]);
  const mb = mbR.code === 0 ? mbR.out.trim() : "";
  if (want && mb === want) return { code: 0, out: "", err: "" };
  err.push(
    `cut-scratch: in ${dest}, origin/HEAD does not lead back to ${base} (merge base ${mb || "none"}), so a skill that diffs against it would review the wrong change`,
  );
  return { code: 1, out: "", err: `${err.join("\n")}\n` };
}

function cut(repo: string, src: string, dest: string, snap: string, base = ""): CmdResult {
  const out: string[] = [];
  const err: string[] = [];
  if (existsSync(dest)) {
    err.push(`cut-scratch: ${dest} already exists; a scratch is cut fresh`);
    return { code: 1, out: "", err: `${err.join("\n")}\n` };
  }
  let want = "";
  if (!base) {
    const r = run("git", ["-C", repo, "worktree", "add", "--detach", dest, snap]);
    if (r.code !== 0) {
      err.push(`cut-scratch: git could not create ${dest} at ${snap}`);
      return { code: 1, out: "", err: `${err.join("\n")}\n` };
    }
  } else {
    const wantR = run("git", ["-C", repo, "rev-parse", "--verify", "-q", `${base}^{commit}`]);
    if (wantR.code !== 0) {
      err.push(`cut-scratch: no such base in ${repo}: ${base}`);
      return { code: 1, out: "", err: `${err.join("\n")}\n` };
    }
    want = wantR.out.trim();
    const cloneR = run("git", ["clone", "-q", "--shared", "--no-checkout", repo, dest]);
    const checkoutR =
      cloneR.code === 0
        ? run("git", ["-C", dest, "checkout", "-q", "--detach", snap])
        : { code: 1, out: "", err: "" };
    if (cloneR.code !== 0 || checkoutR.code !== 0) {
      err.push(`cut-scratch: git could not clone ${repo} to ${dest} at ${snap}`);
      if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
      return { code: 1, out: "", err: `${err.join("\n")}\n` };
    }
    const v = verify(dest, snap, want);
    if (v.code !== 0) {
      rmSync(dest, { recursive: true, force: true });
      return { code: 1, out: "", err: `${v.err}cut-scratch: removed ${dest}\n` };
    }
  }
  let cloned = 0;
  for (const d of DEPS.split(/\s+/).filter(Boolean)) {
    if (cloneDir(join(src, d), join(dest, d))) {
      cloned += 1;
      out.push(`cloned ${d}`);
    }
    for (const memberParent of ["packages", "apps"]) {
      let members: string[] = [];
      try {
        members = readdirSync(join(src, memberParent)).map((m) => join(src, memberParent, m));
      } catch {
        members = [];
      }
      for (const member of members) {
        try {
          if (!statSync(member).isDirectory()) continue;
        } catch {
          continue;
        }
        const rel = member.slice(src.length + 1);
        if (cloneDir(join(member, d), join(dest, rel, d))) {
          cloned += 1;
          out.push(`cloned ${rel}${d}`);
        }
      }
    }
  }
  const headR = run("git", ["-C", dest, "rev-parse", "--short", "HEAD"]);
  let line = `scratch ${dest} at ${headR.out.trim()}`;
  if (want) {
    const shortWant = run("git", ["-C", repo, "rev-parse", "--short", want]);
    line += `, a clone whose origin/HEAD leads back to ${shortWant.out.trim()}`;
  }
  line += `, ${cloned} dependency dir(s) cloned`;
  out.push(line);
  if (cloned === 0) {
    err.push(
      `cut-scratch: no dependency directory found under ${src}; if the project has one, install it there first`,
    );
  }
  return { code: 0, out: `${out.join("\n")}\n`, err: `${err.join("\n")}\n` };
}

function remove(repoArg: string, dest: string): CmdResult {
  const err: string[] = [];
  const common = commonOf(repoArg);
  if (!common) {
    err.push(`cut-scratch: not a repository: ${repoArg}`);
    return { code: 1, out: "", err: `${err.join("\n")}\n` };
  }
  const repo = mainOf(common);
  const k = kind(dest);
  if (!k) {
    err.push(
      `cut-scratch: ${dest} is neither a detached worktree nor a shared clone, so no scratch; left alone`,
    );
    return { code: 1, out: "", err: `${err.join("\n")}\n` };
  }
  const kRepo = k.slice(k.indexOf(" ") + 1);
  if (kRepo !== repo) {
    err.push(`cut-scratch: ${dest} is a scratch of ${kRepo}, not of ${repo}; left alone`);
    return { code: 1, out: "", err: `${err.join("\n")}\n` };
  }
  if (k.startsWith("worktree ")) {
    const r = run("git", ["-C", repo, "worktree", "remove", "--force", dest]);
    return { code: r.code, out: r.out, err: r.err };
  }
  const p = phys(dest);
  if (p) rmSync(p, { recursive: true, force: true });
  return { code: 0, out: "", err: "" };
}

function printResult(r: CmdResult): never {
  if (r.out) process.stdout.write(r.out);
  if (r.err) process.stderr.write(r.err);
  process.exit(r.code);
}

// --- entry ------------------------------------------------------------------------------
const argv = process.argv.slice(2);

if (argv[0] === "--check") {
  if (argv.length === 3) printResult(verify(argv[1] ?? "", argv[2] ?? ""));
  else if (argv.length === 5 && argv[3] === "--clone" && argv[4])
    printResult(verify(argv[1] ?? "", argv[2] ?? "", argv[4]));
  else usage();
} else if (argv[0] === "--kind") {
  if (argv.length !== 2) usage();
  const k = kind(argv[1] ?? "");
  if (!k) process.exit(1);
  console.log(k);
  process.exit(0);
} else if (argv[0] === "--remove") {
  if (argv.length !== 3) usage();
  printResult(remove(argv[1] ?? "", argv[2] ?? ""));
} else if (argv[0] === "--self-test") {
  if (argv.length !== 1) usage();
} else if (argv[0] === undefined || argv[0].startsWith("-")) {
  usage();
} else {
  if (argv.length === 4)
    printResult(cut(argv[0] ?? "", argv[1] ?? "", argv[2] ?? "", argv[3] ?? ""));
  else if (argv.length === 6 && argv[4] === "--clone" && argv[5])
    printResult(cut(argv[0] ?? "", argv[1] ?? "", argv[2] ?? "", argv[3] ?? "", argv[5]));
  else usage();
}

// --- self-test ----------------------------------------------------------------------------
const self = join(scriptsDir(import.meta), "cut-scratch.sh");
withTempDir((tmpRaw) => {
  const tmp = phys(tmpRaw) || tmpRaw;
  process.env.GIT_AUTHOR_NAME = "t";
  process.env.GIT_AUTHOR_EMAIL = "t@t";
  process.env.GIT_COMMITTER_NAME = "t";
  process.env.GIT_COMMITTER_EMAIL = "t@t";
  const st = new SelfTest();

  const git = (...args: string[]): CmdResult => run("git", args);
  const commit = (repoDir: string, file: string, content: string): CmdResult => {
    writeFileSync(join(repoDir, file), `${content}\n`);
    const a = git("-C", repoDir, "add", file);
    if (a.code !== 0) return a;
    return git("-C", repoDir, "commit", "-qm", content);
  };

  const repo = join(tmp, "repo");
  const initR = git("init", "-q", "-b", "main", repo);
  const firstCommit = commit(repo, "a.txt", "base");
  if (initR.code !== 0 || firstCommit.code !== 0) process.exit(1);
  const base = git("-C", repo, "rev-parse", "HEAD").out.trim();
  const synth = join(tmp, "synthesis");
  const wtR = git("-C", repo, "worktree", "add", "-q", "-b", "synth", synth);
  writeFileSync(join(synth, "b.txt"), "change\n");
  const addR = git("-C", synth, "add", "b.txt");
  const cR = git("-C", synth, "commit", "-qm", "change");
  if (wtR.code !== 0 || addR.code !== 0 || cR.code !== 0) process.exit(1);
  const snap = git("-C", synth, "rev-parse", "HEAD").out.trim();
  mkdirSync(join(synth, "node_modules/dep"), { recursive: true });
  writeFileSync(join(synth, "node_modules/dep/index.js"), "x\n");

  let out = "";
  let rc = 0;
  const tryRun = (...args: string[]): void => {
    const r = run(self, args);
    out = r.out + r.err;
    rc = r.code;
  };
  const has = (s: string): boolean => out.includes(s);
  const check = (label: string, cond: boolean, detail?: string): void => {
    if (cond) st.ok(label);
    else st.fail(label, detail ?? out);
  };
  const headOf = (dir: string): string => git("-C", dir, "rev-parse", "HEAD").out.trim();
  const exists = (p: string): boolean => existsSync(p);

  console.log("positive controls");
  tryRun(repo, synth, join(tmp, "wt"), snap);
  check(
    "a worktree scratch is cut at the snapshot, with its dependencies cloned",
    rc === 0 &&
      headOf(join(tmp, "wt")) === snap &&
      exists(join(tmp, "wt", "node_modules/dep/index.js")),
    out,
  );
  tryRun(repo, synth, join(tmp, "clone"), snap, "--clone", base);
  check(
    "a clone scratch is cut at the snapshot, with its dependencies cloned",
    rc === 0 &&
      headOf(join(tmp, "clone")) === snap &&
      exists(join(tmp, "clone", "node_modules/dep/index.js")),
    out,
  );
  const diffR = git("-C", join(tmp, "clone"), "diff", "--name-only", "origin/HEAD...");
  check(
    "in it, the diff against origin/HEAD is exactly the change from the base",
    diffR.out.trim() === "b.txt",
    diffR.out,
  );
  const altSize = (() => {
    try {
      return statSync(join(tmp, "clone/.git/objects/info/alternates")).size;
    } catch {
      return 0;
    }
  })();
  const loose = (() => {
    try {
      const objs = join(tmp, "clone/.git/objects");
      return readdirSync(objs).flatMap((d) => {
        if (d.length !== 2 || d === "info" || d === "pack") return [];
        try {
          return readdirSync(join(objs, d)).map((f) => join(d, f));
        } catch {
          return [];
        }
      });
    } catch {
      return ["?"];
    }
  })();
  check(
    "and it copied no objects",
    altSize > 0 && loose.length === 0,
    `loose=${JSON.stringify(loose)}`,
  );
  const kwt = run(self, ["--kind", join(tmp, "wt")]);
  const kcl = run(self, ["--kind", join(tmp, "clone")]);
  check(
    "--kind names each scratch and the repository it was cut from",
    kwt.out.trim() === `worktree ${repo}` && kcl.out.trim() === `clone ${repo}`,
    kwt.out + kcl.out,
  );
  tryRun("--check", join(tmp, "clone"), snap, "--clone", base);
  check(
    "--check passes a clone at the snapshot whose origin/HEAD leads back to the base",
    rc === 0,
    out,
  );
  tryRun("--check", join(tmp, "wt"), snap);
  check("and a worktree at the snapshot", rc === 0, out);
  commit(repo, "c.txt", "another run merged");
  tryRun(repo, synth, join(tmp, "moved"), snap, "--clone", base);
  const movedDiff = git("-C", join(tmp, "moved"), "diff", "--name-only", "origin/HEAD...");
  check(
    "with main moved on by another run's merge, a clone still reviews from the base",
    rc === 0 && movedDiff.out.trim() === "b.txt",
    out,
  );
  tryRun("--remove", repo, join(tmp, "wt"));
  const wtList = git("-C", repo, "worktree", "list", "--porcelain");
  check(
    "--remove takes a worktree scratch away through git",
    rc === 0 && !exists(join(tmp, "wt")) && !wtList.out.includes(`worktree ${join(tmp, "wt")}`),
    out,
  );
  tryRun("--remove", repo, join(tmp, "clone"));
  check("--remove takes a clone scratch away", rc === 0 && !exists(join(tmp, "clone")), out);

  console.log("negative controls");
  tryRun("--check", join(tmp, "moved"), base, "--clone", base);
  check("--check refuses a scratch that is not at the snapshot", rc === 1 && has("is not at"), out);
  tryRun(repo, synth, join(tmp, "wt2"), snap);
  tryRun("--check", join(tmp, "wt2"), snap, "--clone", base);
  check("and a worktree where a clone is needed", rc === 1 && has("needs a clone"), out);
  tryRun("--check", join(tmp, "moved"), snap, "--clone", snap);
  check(
    "and a clone whose origin/HEAD does not lead back to the base",
    rc === 1 && has("does not lead back"),
    out,
  );
  tryRun(repo, synth, join(tmp, "wrong"), snap, "--clone", snap);
  check(
    "a clone whose origin/HEAD does not lead back to the base is refused, and removed",
    rc === 1 && !exists(join(tmp, "wrong")) && has("does not lead back"),
    out,
  );
  git("-C", repo, "switch", "-q", "--orphan", "elsewhere");
  commit(repo, "d.txt", "unrelated");
  tryRun(repo, synth, join(tmp, "unrelated"), snap, "--clone", base);
  check(
    "so is one cut while the repository has an unrelated branch checked out",
    rc === 1 && !exists(join(tmp, "unrelated")) && has("merge base none"),
    out,
  );
  git("-C", repo, "switch", "-q", "main");
  tryRun(repo, synth, join(tmp, "nobase"), snap, "--clone", "no-such-ref");
  check(
    "a base the repository does not have is refused, and nothing is cut",
    rc === 1 && !exists(join(tmp, "nobase")),
    out,
  );
  mkdirSync(join(tmp, "taken"));
  writeFileSync(join(tmp, "taken/mine.txt"), "keep\n");
  tryRun(repo, synth, join(tmp, "taken"), snap, "--clone", base);
  check(
    "a dest that already exists is refused, and left alone",
    rc === 1 && readdirSync(join(tmp, "taken")).join() === "mine.txt",
    out,
  );
  tryRun(repo, synth, join(tmp, "taken"), snap);
  check(
    "for a worktree scratch too",
    rc === 1 && readdirSync(join(tmp, "taken")).join() === "mine.txt",
    out,
  );
  run("git", ["clone", "-q", repo, join(tmp, "plain")]);
  git("init", "-q", "-b", "main", join(tmp, "repo2"));
  writeFileSync(join(tmp, "repo2/x"), "x\n");
  git("-C", join(tmp, "repo2"), "add", "x");
  git("-C", join(tmp, "repo2"), "commit", "-qm", "x");
  run("git", ["clone", "-q", "--shared", join(tmp, "repo2"), join(tmp, "borrowed")]);
  git("-C", join(tmp, "borrowed"), "remote", "set-url", "origin", repo);
  tryRun(repo, synth, join(tmp, "other"), snap, "--clone", base);
  const victims = [
    join(tmp, "taken"),
    repo,
    synth,
    join(tmp, "plain"),
    join(tmp, "borrowed"),
    join(repo, "nowhere"),
  ];
  for (const victim of victims) {
    tryRun("--kind", victim);
    check(`--kind: ${basename(victim)} is no scratch`, rc === 1 && out === "", out);
    tryRun("--remove", repo, victim);
    const leftAlone =
      !exists(victim) ||
      (() => {
        try {
          return readdirSync(victim).length > 0;
        } catch {
          return true;
        }
      })();
    check("--remove refuses it, and leaves it", rc === 1 && leftAlone, out);
  }
  check(
    "the synthesis worktree is untouched",
    exists(join(synth, "b.txt")) &&
      git("-C", repo, "worktree", "list", "--porcelain").out.includes(`worktree ${synth}`),
  );
  tryRun("--remove", join(tmp, "repo2"), join(tmp, "other"));
  check(
    "--remove refuses a scratch of another repository",
    rc === 1 && exists(join(tmp, "other/.git")) && has("not of"),
    out,
  );
  tryRun(repo, synth, join(tmp, "x"), snap, "--clone");
  check("--clone with no base is a usage error", rc === 1 && !exists(join(tmp, "x")), out);

  st.finish();
});
