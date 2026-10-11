// Cut a disposable reviewer scratch at a snapshot, with the installed dependency directories
// CLONED from a source worktree; tell a scratch from anything else; remove one. Nothing is ever
// installed into a scratch; a lane that opens on a broken scratch reports the breakage as a
// finding about the diff, or gives up on running the suite and reverts to reading.
// Cut a workhorse copy on its branch, and check one before its lane starts.
//
//   run cut-scratch <repo> <source-worktree> <dest-path> <commit> [--clone <base>]
//   run cut-scratch --check <dest-path> <commit> [--clone <base>]
//   run cut-scratch --kind <dir>
//   run cut-scratch --remove <repo> <dest-path>
//   run cut-scratch --cut-workhorse <repo> <dest-path> <commit> <branch>
//   run cut-scratch --check-workhorse <repo> <dest-path> <commit> <branch>
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
// branch is the synthesis, never a scratch. A workhorse copy is a shared clone on its branch,
// so --kind names it `clone <repo>` and --remove takes it away. --remove takes away a scratch
// of <repo> of either kind, a worktree through git and a clone with its directory, and refuses
// anything else, leaving it alone.
//
// A workhorse copy is a shared clone of <repo> (`git clone --shared`, which copies no objects)
// on <branch> at <commit>: its origin is <repo>, it borrows <repo>'s objects, and it carries
// only the commit identity (user.name, user.email) as resolved in <repo>, so the project's
// hooks, credentials and includes never run on a workhorse's commits. It holds no dependency
// clone; workhorses install their own. --check-workhorse is the same test, made before a lane
// is launched into a copy: it is a clone of <repo>, its HEAD is <commit>, and it is on <branch>.
//
// Clones each directory named in DEPS_DIRS (default: node_modules) at the root AND under every
// workspace member (packages/*, apps/*): in a workspace each member carries its own link farm,
// and cloning only the root leaves a checkout that cannot resolve its own packages. Workhorse
// copies clone none.
//
//   exit 0  scratch created, the dependency clone reported per directory; a scratch checked; a
//           scratch's kind printed; the scratch removed; or a workhorse copy cut or checked
//   exit 1  usage; a dest that exists; a repository that already holds <branch>;
//           git could not create the scratch or copy; a scratch or copy not at <commit>;
//           a worktree where a clone is needed, or a clone whose
//           origin/HEAD does not lead back to <base>; a copy on another branch or of another
//           repository; not a scratch, or not one of <repo>
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { run } from "./lib/proc.ts";

const DEPS = process.env.DEPS_DIRS ?? "node_modules";

interface CmdResult {
  code: number;
  out: string;
  err: string;
}

function usage(): never {
  console.error(
    "usage: run cut-scratch <repo> <source-worktree> <dest-path> <commit> [--clone <base>] | --check <dest-path> <commit> [--clone <base>] | --kind <dir> | --remove <repo> <dest-path> | --cut-workhorse <repo> <dest-path> <commit> <branch> | --check-workhorse <repo> <dest-path> <commit> <branch>",
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
  for (const d of DEPS.split(/[ \t\n]+/u).filter(Boolean)) {
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

function workhorseCheck(repoArg: string, dest: string, commit: string, branch: string): CmdResult {
  const err: string[] = [];
  const fail = (msg: string): CmdResult => {
    err.push(`cut-scratch: ${dest} ${msg}`);
    return { code: 1, out: "", err: `${err.join("\n")}\n` };
  };
  const repoCommon = commonOf(repoArg);
  if (!repoCommon) {
    err.push(`cut-scratch: not a repository: ${repoArg}`);
    return { code: 1, out: "", err: `${err.join("\n")}\n` };
  }
  const repo = mainOf(repoCommon);
  const d = phys(dest);
  if (!d) return fail("is no workhorse copy");
  const topR = run("git", ["-C", d, "rev-parse", "--show-toplevel"]);
  if (topR.code !== 0 || phys(topR.out.trim()) !== d) return fail("is no workhorse copy");
  const gdR = run("git", ["-C", d, "rev-parse", "--path-format=absolute", "--git-dir"]);
  if (gdR.code !== 0) return fail("is no workhorse copy");
  if (phys(gdR.out.trim()) !== commonOf(d)) return fail("is a worktree, not a workhorse copy");
  const urlR = run("git", ["-C", d, "config", "--get", "remote.origin.url"]);
  const url = urlR.code === 0 ? urlR.out.trim() : "";
  if (!url || phys(url) !== phys(repo)) {
    err.push(`cut-scratch: ${dest} is a clone of ${url || "nothing"}, not of ${repo}`);
    return { code: 1, out: "", err: `${err.join("\n")}\n` };
  }
  let alt = "";
  try {
    alt = readFileSync(join(commonOf(d), "objects/info/alternates"), "utf8").split("\n")[0] ?? "";
  } catch {
    alt = "";
  }
  if (!alt || phys(alt) !== join(repoCommon, "objects")) {
    return fail(`does not borrow ${repo}'s objects`);
  }
  const wantR = run("git", ["-C", repo, "rev-parse", "--verify", "-q", `${commit}^{commit}`]);
  if (wantR.code !== 0) {
    err.push(`cut-scratch: no such commit in ${repo}: ${commit}`);
    return { code: 1, out: "", err: `${err.join("\n")}\n` };
  }
  const want = wantR.out.trim();
  const headR = run("git", ["-C", d, "rev-parse", "HEAD"]);
  if (headR.code !== 0 || headR.out.trim() !== want) {
    const at = headR.code === 0 ? headR.out.trim().slice(0, 12) : "nothing";
    return fail(`is not at ${commit} (at ${at})`);
  }
  const brR = run("git", ["-C", d, "symbolic-ref", "--short", "-q", "HEAD"]);
  if (brR.code !== 0) return fail(`is detached, not on ${branch}`);
  const atBranch = brR.out.trim();
  if (atBranch !== branch) return fail(`is on ${atBranch}, not on ${branch}`);
  return { code: 0, out: "", err: "" };
}

function workhorseCut(repoArg: string, dest: string, commit: string, branch: string): CmdResult {
  const err: string[] = [];
  if (!branch) {
    err.push("cut-scratch: no branch named for the workhorse copy");
    return { code: 1, out: "", err: `${err.join("\n")}\n` };
  }
  if (existsSync(dest)) {
    err.push(`cut-scratch: ${dest} already exists; a workhorse copy is cut fresh`);
    return { code: 1, out: "", err: `${err.join("\n")}\n` };
  }
  const repoCommon = commonOf(repoArg);
  if (!repoCommon) {
    err.push(`cut-scratch: not a repository: ${repoArg}`);
    return { code: 1, out: "", err: `${err.join("\n")}\n` };
  }
  const repo = mainOf(repoCommon);
  const heldR = run("git", ["-C", repo, "rev-parse", "--verify", "-q", `${branch}^{commit}`]);
  if (heldR.code === 0) {
    err.push(`cut-scratch: ${repo} already holds ${branch} at ${heldR.out.trim()}`);
    return { code: 1, out: "", err: `${err.join("\n")}\n` };
  }
  const wantR = run("git", ["-C", repo, "rev-parse", "--verify", "-q", `${commit}^{commit}`]);
  if (wantR.code !== 0) {
    err.push(`cut-scratch: no such commit in ${repo}: ${commit}`);
    return { code: 1, out: "", err: `${err.join("\n")}\n` };
  }
  const want = wantR.out.trim();
  const cloneR = run("git", ["clone", "-q", "--shared", "--no-checkout", repo, dest]);
  const checkoutR =
    cloneR.code === 0
      ? run("git", ["-C", dest, "checkout", "-q", "-b", branch, want])
      : { code: 1, out: "", err: "" };
  if (cloneR.code !== 0 || checkoutR.code !== 0) {
    err.push(`cut-scratch: git could not clone ${repo} to ${dest} on ${branch} at ${commit}`);
    if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
    return { code: 1, out: "", err: `${err.join("\n")}\n` };
  }
  for (const key of ["user.name", "user.email"]) {
    const got = run("git", ["-C", repo, "config", "--get", key]);
    const value = got.code === 0 ? got.out.trim() : "";
    if (!value) continue;
    const set = run("git", ["-C", dest, "config", key, value]);
    if (set.code !== 0) {
      err.push(`cut-scratch: could not set ${key} in ${dest}`);
      rmSync(dest, { recursive: true, force: true });
      return { code: 1, out: "", err: `${err.join("\n")}\n` };
    }
  }
  const v = workhorseCheck(repo, dest, want, branch);
  if (v.code !== 0) {
    rmSync(dest, { recursive: true, force: true });
    return { code: 1, out: "", err: `${v.err}cut-scratch: removed ${dest}\n` };
  }
  const shortR = run("git", ["-C", dest, "rev-parse", "--short", "HEAD"]);
  return {
    code: 0,
    out: `workhorse ${dest} at ${shortR.out.trim()} on ${branch}, a clone of ${repo}\n`,
    err: "",
  };
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
} else if (argv[0] === "--cut-workhorse") {
  if (argv.length !== 5 || !argv[4]) usage();
  printResult(workhorseCut(argv[1] ?? "", argv[2] ?? "", argv[3] ?? "", argv[4]));
} else if (argv[0] === "--check-workhorse") {
  if (argv.length !== 5 || !argv[4]) usage();
  printResult(workhorseCheck(argv[1] ?? "", argv[2] ?? "", argv[3] ?? "", argv[4]));
} else if (argv[0] === undefined || argv[0].startsWith("-")) {
  usage();
} else {
  if (argv.length === 4)
    printResult(cut(argv[0] ?? "", argv[1] ?? "", argv[2] ?? "", argv[3] ?? ""));
  else if (argv.length === 6 && argv[4] === "--clone" && argv[5])
    printResult(cut(argv[0] ?? "", argv[1] ?? "", argv[2] ?? "", argv[3] ?? "", argv[5]));
  else usage();
}
