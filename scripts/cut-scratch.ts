import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { command, commandOutput, makeTemp, removeTree, scriptDir, writeError, writeOut } from "./lib/core.ts";

const here = scriptDir(import.meta.url);
const wrapper = join(here, "cut-scratch.sh");
const deps = (process.env.DEPS_DIRS ?? "node_modules").split(/\s+/).filter(Boolean);
const say = (s: string) => writeOut(s);
const err = (s: string) => writeError(s);
const git = (dir: string, args: string[]) => command("git", ["-C", dir, ...args]);
const gitOut = (dir: string, args: string[]) => commandOutput("git", ["-C", dir, ...args]);
function physical(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}
function commonOf(dir: string): string | null {
  const common = gitOut(dir, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  return common ? physical(common) : null;
}
function mainOf(common: string): string {
  return common.endsWith("/.git") ? dirname(common) : common;
}
function kind(dir: string): string | null {
  const actual = physical(dir);
  if (!actual) return null;
  const top0 = gitOut(actual, ["rev-parse", "--show-toplevel"]);
  const top = top0 ? physical(top0) : null;
  if (top !== actual) return null;
  const gitdir0 = gitOut(actual, ["rev-parse", "--path-format=absolute", "--git-dir"]);
  const gitdir = gitdir0 ? physical(gitdir0) : null;
  const common = commonOf(actual);
  if (!gitdir || !common) return null;
  if (gitdir !== common) {
    if (git(actual, ["symbolic-ref", "-q", "HEAD"]).code === 0) return null;
    return `worktree ${mainOf(common)}`;
  }
  let alternate = "";
  try {
    alternate = readFileSync(join(common, "objects/info/alternates"), "utf8").split(/\r?\n/)[0] ?? "";
  } catch {
    return null;
  }
  if (!alternate) return null;
  const url = gitOut(actual, ["config", "--get", "remote.origin.url"]);
  if (!url?.startsWith("/")) return null;
  const originalCommon = commonOf(url);
  if (!originalCommon || physical(alternate) !== join(originalCommon, "objects")) return null;
  return `clone ${mainOf(originalCommon)}`;
}
function verify(dest: string, snap: string, base?: string): number {
  const k = kind(dest);
  if (!k) {
    err(`cut-scratch: ${dest} is no scratch`);
    return 1;
  }
  const at = gitOut(dest, ["rev-parse", "--verify", "-q", `${snap}^{commit}`]);
  if (!at || gitOut(dest, ["rev-parse", "HEAD"]) !== at) {
    err(`cut-scratch: ${dest} is not at ${snap}`);
    return 1;
  }
  if (!base) return 0;
  if (!k.startsWith("clone ")) {
    err(`cut-scratch: ${dest} is a worktree, where a skill that diffs against origin/HEAD needs a clone`);
    return 1;
  }
  const want = gitOut(dest, ["rev-parse", "--verify", "-q", `${base}^{commit}`]);
  const mb = gitOut(dest, ["merge-base", "origin/HEAD", "HEAD"]);
  if (want && mb === want) return 0;
  err(
    `cut-scratch: in ${dest}, origin/HEAD does not lead back to ${base} (merge base ${mb || "none"}), so a skill that diffs against it would review the wrong change`,
  );
  return 1;
}
function cloneDir(source: string, destination: string): boolean {
  if (!existsSync(source)) return false;
  try {
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(source, destination, { recursive: true, dereference: false });
    return true;
  } catch {
    return false;
  }
}
function cut(repo: string, source: string, dest: string, snap: string, base?: string): number {
  if (existsSync(dest)) {
    err(`cut-scratch: ${dest} already exists; a scratch is cut fresh`);
    return 1;
  }
  let want = "";
  if (!base) {
    if (git(repo, ["worktree", "add", "--detach", dest, snap]).code !== 0) {
      err(`cut-scratch: git could not create ${dest} at ${snap}`);
      return 1;
    }
  } else {
    want = gitOut(repo, ["rev-parse", "--verify", "-q", `${base}^{commit}`]) ?? "";
    if (!want) {
      err(`cut-scratch: no such base in ${repo}: ${base}`);
      return 1;
    }
    const cloned = command("git", ["clone", "-q", "--shared", "--no-checkout", repo, dest]);
    const checked = cloned.code === 0 ? git(dest, ["checkout", "-q", "--detach", snap]) : cloned;
    if (cloned.code !== 0 || checked.code !== 0) {
      err(`cut-scratch: git could not clone ${repo} to ${dest} at ${snap}`);
      if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
      return 1;
    }
    if (verify(dest, snap, want) !== 0) {
      rmSync(dest, { recursive: true, force: true });
      err(`cut-scratch: removed ${dest}`);
      return 1;
    }
  }
  let cloned = 0;
  for (const dependency of deps) {
    if (cloneDir(join(source, dependency), join(dest, dependency))) {
      cloned++;
      say(`cloned ${dependency}`);
    }
    for (const group of ["packages", "apps"]) {
      const members = join(source, group);
      if (!existsSync(members)) continue;
      for (const name of readdirSync(members)) {
        const member = join(members, name);
        if (!statSync(member).isDirectory()) continue;
        const rel = `${group}/${name}/`;
        if (cloneDir(join(member, dependency), join(dest, rel, dependency))) {
          cloned++;
          say(`cloned ${rel}${dependency}`);
        }
      }
    }
  }
  const short = gitOut(dest, ["rev-parse", "--short", "HEAD"]) ?? "unknown";
  const baseSuffix = want
    ? `, a clone whose origin/HEAD leads back to ${gitOut(repo, ["rev-parse", "--short", want]) ?? want}`
    : "";
  say(`scratch ${dest} at ${short}${baseSuffix}, ${cloned} dependency dir(s) cloned`);
  if (cloned === 0)
    err(`cut-scratch: no dependency directory found under ${source}; if the project has one, install it there first`);
  return 0;
}
function removeScratch(repoArg: string, dest: string): number {
  const common = commonOf(repoArg);
  if (!common) {
    err(`cut-scratch: not a repository: ${repoArg}`);
    return 1;
  }
  const repo = mainOf(common);
  const k = kind(dest);
  if (!k) {
    err(`cut-scratch: ${dest} is neither a detached worktree nor a shared clone, so no scratch; left alone`);
    return 1;
  }
  const source = k.slice(k.indexOf(" ") + 1);
  if (source !== repo) {
    err(`cut-scratch: ${dest} is a scratch of ${source}, not of ${repo}; left alone`);
    return 1;
  }
  if (k.startsWith("worktree ")) return git(repo, ["worktree", "remove", "--force", dest]).code;
  const actual = physical(dest);
  if (!actual) return 1;
  try {
    rmSync(actual, { recursive: true, force: true });
    return 0;
  } catch (error) {
    err(String(error));
    return 1;
  }
}
function usage(): never {
  err(
    "usage: cut-scratch.sh <repo> <source-worktree> <dest-path> <commit> [--clone <base>] | --check <dest-path> <commit> [--clone <base>] | --kind <dir> | --remove <repo> <dest-path> | --self-test",
  );
  process.exit(1);
}
function run(args: string[]): number {
  const [first, ...rest] = args;
  if (first === "--check") {
    if (rest.length === 2) return verify(rest[0]!, rest[1]!);
    if (rest.length === 4 && rest[2] === "--clone" && rest[3]) return verify(rest[0]!, rest[1]!, rest[3]);
    return usage();
  }
  if (first === "--kind" && rest.length === 1) {
    const k = kind(rest[0]!);
    if (!k) return 1;
    say(k);
    return 0;
  }
  if (first === "--remove" && rest.length === 2) return removeScratch(rest[0]!, rest[1]!);
  if (first === "--self-test" && args.length === 1) return selfTest();
  if (!first || first.startsWith("-")) return usage();
  if (rest.length === 3) return cut(first, rest[0]!, rest[1]!, rest[2]!);
  if (rest.length === 5 && rest[3] === "--clone" && rest[4]) return cut(first, rest[0]!, rest[1]!, rest[2]!, rest[4]);
  return usage();
}
function selfTest(): number {
  const tmp = makeTemp("postmaster-cut-scratch-");
  let fails = 0;
  const sayOk = (label: string) => say(`  ok   ${label}`);
  const check = (label: string, condition: boolean, detail = "") => {
    if (condition) sayOk(label);
    else {
      say(`  FAIL ${label}`);
      if (detail) for (const line of detail.split("\n")) say(`         ${line}`);
      fails++;
    }
  };
  const attempt = (...args: string[]) => command(wrapper, args);
  const gitCheck = (dir: string, ...args: string[]) => gitOut(dir, args);
  const env = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  const commit = (repo: string, file: string, content: string) => {
    writeFileSync(join(repo, file), `${content}\n`);
    command("git", ["-C", repo, "add", file]);
    return command("git", ["-C", repo, "commit", "-qm", content], { env }).code === 0;
  };
  try {
    const repo = join(tmp, "repo");
    command("git", ["init", "-q", "-b", "main", repo]);
    if (!commit(repo, "a.txt", "base")) throw new Error("could not commit repository base");
    const base = gitCheck(repo, "rev-parse", "HEAD")!;
    const synthesis = join(tmp, "synthesis");
    command("git", ["-C", repo, "worktree", "add", "-q", "-b", "synth", synthesis], { env });
    commit(synthesis, "b.txt", "change");
    const snap = gitCheck(synthesis, "rev-parse", "HEAD")!;
    mkdirSync(join(synthesis, "node_modules/dep"), { recursive: true });
    writeFileSync(join(synthesis, "node_modules/dep/index.js"), "x\n");
    say("positive controls");
    let r = attempt(repo, synthesis, join(tmp, "wt"), snap);
    check(
      "a worktree scratch is cut at the snapshot, with its dependencies cloned",
      r.code === 0 &&
        gitCheck(join(tmp, "wt"), "rev-parse", "HEAD") === snap &&
        existsSync(join(tmp, "wt/node_modules/dep/index.js")),
      r.stdout + r.stderr,
    );
    r = attempt(repo, synthesis, join(tmp, "clone"), snap, "--clone", base);
    const clone = join(tmp, "clone");
    check(
      "a clone scratch is cut at the snapshot, with its dependencies cloned",
      r.code === 0 &&
        gitCheck(clone, "rev-parse", "HEAD") === snap &&
        existsSync(join(clone, "node_modules/dep/index.js")),
      r.stdout + r.stderr,
    );
    check(
      "in it, the diff against origin/HEAD is exactly the change from the base",
      gitCheck(clone, "diff", "--name-only", "origin/HEAD...") === "b.txt",
    );
    check(
      "and it copied no objects",
      existsSync(join(clone, ".git/objects/info/alternates")) &&
        command("find", [join(clone, ".git/objects"), "-type", "f", "-path", "*/objects/??/*"]).stdout.trim() === "",
    );
    const wt = join(tmp, "wt");
    check(
      "--kind names each scratch and the repository it was cut from",
      command(wrapper, ["--kind", wt]).stdout.trim() === `worktree ${repo}` &&
        command(wrapper, ["--kind", clone]).stdout.trim() === `clone ${repo}`,
    );
    r = attempt("--check", clone, snap, "--clone", base);
    check("--check passes a clone at the snapshot whose origin/HEAD leads back to the base", r.code === 0, r.stderr);
    r = attempt("--check", wt, snap);
    check("and a worktree at the snapshot", r.code === 0, r.stderr);
    commit(repo, "c.txt", "another run merged");
    r = attempt(repo, synthesis, join(tmp, "moved"), snap, "--clone", base);
    check(
      "with main moved on by another run's merge, a clone still reviews from the base",
      r.code === 0 && gitCheck(join(tmp, "moved"), "diff", "--name-only", "origin/HEAD...") === "b.txt",
      r.stdout + r.stderr,
    );
    r = attempt("--remove", repo, wt);
    check(
      "--remove takes a worktree scratch away through git",
      r.code === 0 && !existsSync(wt) && !gitCheck(repo, "worktree", "list", "--porcelain")?.includes(`worktree ${wt}`),
    );
    r = attempt("--remove", repo, clone);
    check("--remove takes a clone scratch away", r.code === 0 && !existsSync(clone), r.stdout + r.stderr);
    say("negative controls");
    r = attempt("--check", join(tmp, "moved"), base, "--clone", base);
    check(
      "--check refuses a scratch that is not at the snapshot",
      r.code === 1 && r.stderr.includes("is not at"),
      r.stderr,
    );
    attempt(repo, synthesis, join(tmp, "wt2"), snap);
    r = attempt("--check", join(tmp, "wt2"), snap, "--clone", base);
    check("and a worktree where a clone is needed", r.code === 1 && r.stderr.includes("needs a clone"), r.stderr);
    r = attempt("--check", join(tmp, "moved"), snap, "--clone", snap);
    check(
      "and a clone whose origin/HEAD does not lead back to the base",
      r.code === 1 && r.stderr.includes("does not lead back"),
      r.stderr,
    );
    r = attempt(repo, synthesis, join(tmp, "wrong"), snap, "--clone", snap);
    check(
      "a clone whose origin/HEAD does not lead back to the base is refused, and removed",
      r.code === 1 && !existsSync(join(tmp, "wrong")) && r.stderr.includes("does not lead back"),
      r.stderr,
    );
    command("git", ["-C", repo, "switch", "-q", "--orphan", "elsewhere"], { env });
    commit(repo, "d.txt", "unrelated");
    r = attempt(repo, synthesis, join(tmp, "unrelated"), snap, "--clone", base);
    check(
      "so is one cut while the repository has an unrelated branch checked out",
      r.code === 1 && !existsSync(join(tmp, "unrelated")) && r.stderr.includes("merge base none"),
      r.stderr,
    );
    command("git", ["-C", repo, "switch", "-q", "main"], { env });
    r = attempt(repo, synthesis, join(tmp, "nobase"), snap, "--clone", "no-such-ref");
    check(
      "a base the repository does not have is refused, and nothing is cut",
      r.code === 1 && !existsSync(join(tmp, "nobase")),
    );
    const taken = join(tmp, "taken");
    mkdirSync(taken);
    writeFileSync(join(taken, "mine.txt"), "keep\n");
    r = attempt(repo, synthesis, taken, snap, "--clone", base);
    check(
      "a dest that already exists is refused, and left alone",
      r.code === 1 && readdirSync(taken).join() === "mine.txt",
    );
    r = attempt(repo, synthesis, taken, snap);
    check("for a worktree scratch too", r.code === 1 && readdirSync(taken).join() === "mine.txt");
    const plain = join(tmp, "plain");
    command("git", ["clone", "-q", repo, plain], { env });
    const repo2 = join(tmp, "repo2");
    command("git", ["init", "-q", "-b", "main", repo2]);
    commit(repo2, "x", "x");
    const borrowed = join(tmp, "borrowed");
    command("git", ["clone", "-q", "--shared", repo2, borrowed], { env });
    command("git", ["-C", borrowed, "remote", "set-url", "origin", repo]);
    attempt(repo, synthesis, join(tmp, "other"), snap, "--clone", base);
    for (const victim of [taken, repo, synthesis, plain, borrowed, join(repo, "nowhere")]) {
      r = attempt("--kind", victim);
      check(`--kind: ${basename(victim)} is no scratch`, r.code === 1 && !r.stdout.trim());
      r = attempt("--remove", repo, victim);
      check(
        "--remove refuses it, and leaves it",
        r.code === 1 && (!existsSync(victim) || readdirSync(victim).length > 0),
        r.stderr,
      );
    }
    check(
      "the synthesis worktree is untouched",
      existsSync(join(synthesis, "b.txt")) &&
        gitCheck(repo, "worktree", "list", "--porcelain")?.includes(`worktree ${synthesis}`),
    );
    r = attempt("--remove", repo2, join(tmp, "other"));
    check(
      "--remove refuses a scratch of another repository",
      r.code === 1 && existsSync(join(tmp, "other/.git")) && r.stderr.includes("not of"),
      r.stderr,
    );
    r = attempt(repo, synthesis, join(tmp, "x"), snap, "--clone");
    check("--clone with no base is a usage error", r.code === 1 && !existsSync(join(tmp, "x")), r.stderr);
  } finally {
    removeTree(tmp);
  }
  say("");
  say(fails === 0 ? "self-test: all controls behaved" : `self-test: ${fails} control(s) misbehaved`);
  return fails === 0 ? 0 : 1;
}
process.exit(run(process.argv.slice(2)));
