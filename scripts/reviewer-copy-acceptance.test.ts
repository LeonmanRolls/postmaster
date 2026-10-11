// Tests beside scripts/reviewer-copy-acceptance.ts: the oracle's stale and presence
// checks over planted trees, plus the C1 mechanism checks from #342's acceptance:
// the runbook's cut shape on a scratch repository and teardown's removal.
// Each fault control builds its own copy of the clean tree, so tests pass alone and
// in order; the live-tree check reads the tool root. The C1 checks are
// order-dependent: cut, then properties, then teardown.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accept } from "./reviewer-copy-acceptance";
import { toolRoot } from "./lib/paths";

const cli = join(import.meta.dir, "run");
const ROOT = toolRoot(import.meta);
const COACH = "skills/postmaster/coachman.md";
const HARNESS = "skills/postmaster/harnesses.md";
const HOSTS = "skills/postmaster/hosts.md";
const WIKI = "wiki/concepts/own-review-skills.md";

const PIN_CUT =
  "the scratch is cut at the snapshot, from a clone with `--clone <BASE>` under every lens";
const PIN_CHECK = "checks every scratch with `cut-scratch --check`";
const PIN_TABLE = "a clone of the repository under every lens";
const PIN_BRIEF = "its own disposable copy of the repository";
const PIN_EVERY = "Every lens reviews from clones";
const PIN_PROSE = "and a clone whose `origin/HEAD` leads back to BASE";
const PIN_SCRATCH_CLONE = "which is a clone detached at the snapshot";
const PIN_HOSTS = "That includes reviewer scratches: a clone is never opened as a separate";
const PIN_WIKI_BUG = "its own scratch clone";

let otmp = "";
let oclean = "";
let ostale = "";

function strip(out: string): string {
  return out.replace(/\n+$/u, "");
}

function plantClean(dir: string): void {
  mkdirSync(join(dir, "skills/postmaster"), { recursive: true });
  mkdirSync(join(dir, "wiki/concepts"), { recursive: true });
  writeFileSync(
    join(dir, COACH),
    "| <repo>/.worktrees/<TICKET>-rev-<lens>-<lane> | reviewer scratch, " +
      `${PIN_TABLE} |\n` +
      "State in every brief that the lane is working in " +
      `${PIN_BRIEF} with dependencies installed.\n` +
      `${PIN_EVERY}, each a repository of its own.\n` +
      `The command first checks every scratch: at the snapshot, ${PIN_PROSE}.\n` +
      `The cut: ${PIN_CUT}.\n` +
      `The launch ${PIN_CHECK}.\n`,
  );
  writeFileSync(
    join(dir, HARNESS),
    "A skill left to choose its own diff cannot be trusted in a review scratch, " +
      `${PIN_SCRATCH_CLONE} with no upstream.\n`,
  );
  writeFileSync(join(dir, HOSTS), `${PIN_HOSTS} workspace.\n`);
  writeFileSync(
    join(dir, WIKI),
    "A skill left to choose its own diff cannot be trusted in a review scratch, " +
      `${PIN_SCRATCH_CLONE} with no upstream. ` +
      `Each is launched in ${PIN_WIKI_BUG}.\n`,
  );
}

function plantStale(dir: string): void {
  cpSync(oclean, dir, { recursive: true });
  writeFileSync(
    join(dir, COACH),
    'CLONE=(); [ "$LENS" = security ] && CLONE=(--clone <BASE>)\n' +
      'cut "$DEST" "$SNAP" "${CLONE[@]}"\n' +
      "a clone under the security lens, a worktree under the others\n" +
      "working in its own disposable worktree with dependencies\n" +
      "The security lens reviews from clones, whose origin/HEAD leads back\n" +
      "at the snapshot, and under the security lens a clone whose origin/HEAD leads back\n",
    { flag: "a" },
  );
  writeFileSync(
    join(dir, HARNESS),
    "cannot be trusted in a review scratch, which is a worktree detached at the snapshot.\n",
    { flag: "a" },
  );
  writeFileSync(
    join(dir, HOSTS),
    "That includes reviewer worktrees and security-review clones: never a workspace.\n",
    { flag: "a" },
  );
  writeFileSync(
    join(dir, WIKI),
    "cannot be trusted in a review scratch, which is a worktree detached at the snapshot.\n" +
      "Each is launched in its own worktree scratch, at the top level.\n",
    { flag: "a" },
  );
}

function plantFault(dir: string, file: string, fault: string): string {
  const one = join(otmp, dir);
  rmSync(one, { recursive: true, force: true });
  cpSync(oclean, one, { recursive: true });
  writeFileSync(join(one, file), `${fault}\n`, { flag: "a" });
  return one;
}

function dropPin(dir: string, file: string, pin: string): string {
  const one = join(otmp, dir);
  rmSync(one, { recursive: true, force: true });
  cpSync(oclean, one, { recursive: true });
  const p = join(one, file);
  writeFileSync(p, readFileSync(p, "utf8").replaceAll(pin, "REWORDED"));
  return one;
}

beforeAll(() => {
  otmp = mkdtempSync(join(tmpdir(), "reviewer-copy-acceptance-"));
  oclean = join(otmp, "clean");
  plantClean(oclean);
  ostale = join(otmp, "stale");
  plantStale(ostale);
});

afterAll(() => {
  rmSync(otmp, { recursive: true, force: true });
});

describe("each stale check fires on its own fault alone", () => {
  test("coach conditional", () => {
    const one = plantFault(
      "one",
      COACH,
      'CLONE=(); [ "$LENS" = security ] && CLONE=(--clone <BASE>)',
    );
    const r = accept(one);
    expect(r.code).toBe(1);
    expect(strip(r.out)).toBe(
      `${COACH}: still says the clone flag is conditional on the security lens`,
    );
  });

  test("coach clone array", () => {
    const one = plantFault("one", COACH, 'cut "$DEST" "$SNAP" "${CLONE[@]}"');
    const r = accept(one);
    expect(r.code).toBe(1);
    expect(strip(r.out)).toBe(
      `${COACH}: still says the scratch is cut through a conditional clone flag`,
    );
  });

  test("coach table", () => {
    const one = plantFault(
      "one",
      COACH,
      "a clone under the security lens, a worktree under the others",
    );
    const r = accept(one);
    expect(r.code).toBe(1);
    expect(strip(r.out)).toBe(
      `${COACH}: still says reviewer folders are worktrees outside security`,
    );
  });

  test("coach brief", () => {
    const one = plantFault(
      "one",
      COACH,
      "working in its own disposable worktree with dependencies",
    );
    const r = accept(one);
    expect(r.code).toBe(1);
    expect(strip(r.out)).toBe(`${COACH}: still says the lane works in a disposable worktree`);
  });

  test("coach comment", () => {
    const one = plantFault(
      "one",
      COACH,
      "The security lens reviews from clones, whose origin/HEAD leads back",
    );
    const r = accept(one);
    expect(r.code).toBe(1);
    expect(strip(r.out)).toBe(`${COACH}: still says the security lens alone reviews from clones`);
  });

  test("coach check prose", () => {
    const one = plantFault(
      "one",
      COACH,
      "at the snapshot, and under the security lens a clone whose origin/HEAD leads back",
    );
    const r = accept(one);
    expect(r.code).toBe(1);
    expect(strip(r.out)).toBe(`${COACH}: still says only the security check requires a clone`);
  });

  test("harness scratch fires its check and the general one", () => {
    const one = plantFault(
      "one",
      HARNESS,
      "cannot be trusted in a review scratch, which is a worktree detached at the snapshot.",
    );
    const r = accept(one);
    const lines = strip(r.out).split("\n");
    expect(r.code).toBe(1);
    expect(lines.length).toBe(2);
    expect(lines).toContain(`${HARNESS}: still says a review scratch is a worktree`);
    expect(lines).toContain(`${HARNESS}: still says a review scratch remains a worktree`);
  });

  test("hosts launches fires its check and the general one", () => {
    const one = plantFault(
      "one",
      HOSTS,
      "That includes reviewer worktrees and security-review clones: never a workspace.",
    );
    const r = accept(one);
    const lines = strip(r.out).split("\n");
    expect(r.code).toBe(1);
    expect(lines.length).toBe(2);
    expect(lines).toContain(`${HOSTS}: still says reviewer launches run in worktrees`);
    expect(lines).toContain(`${HOSTS}: still says a reviewer works in a worktree`);
  });

  test("wiki scratch fires its check and the general one", () => {
    const one = plantFault(
      "one",
      WIKI,
      "cannot be trusted in a review scratch, which is a worktree detached at the snapshot.",
    );
    const r = accept(one);
    const lines = strip(r.out).split("\n");
    expect(r.code).toBe(1);
    expect(lines.length).toBe(2);
    expect(lines).toContain(`${WIKI}: still says a review scratch is a worktree`);
    expect(lines).toContain(`${WIKI}: still says a review scratch remains a worktree`);
  });

  test("wiki bug scratch", () => {
    const one = plantFault(
      "one",
      WIKI,
      "Each is launched in its own worktree scratch, at the top level.",
    );
    const r = accept(one);
    expect(r.code).toBe(1);
    expect(strip(r.out)).toBe(`${WIKI}: still says the bug reviewer runs in a worktree scratch`);
  });
});

describe("each presence pin fires when dropped", () => {
  for (const [name, file, pin, label] of [
    ["cut", COACH, PIN_CUT, "passes --clone for every lens in the review cut"],
    ["check", COACH, PIN_CHECK, "requires a clone for every lens in the pre-launch check"],
    ["table", COACH, PIN_TABLE, "calls the reviewer folders clones in the paths table"],
    ["brief", COACH, PIN_BRIEF, "briefs the lane on its own copy of the repository"],
    ["every", COACH, PIN_EVERY, "says every lens reviews from clones"],
    ["prose", COACH, PIN_PROSE, "checks every scratch is a clone"],
    ["harness scratch", HARNESS, PIN_SCRATCH_CLONE, "calls a review scratch a clone"],
    ["hosts", HOSTS, PIN_HOSTS, "places reviewer scratches, never reviewer worktrees"],
    ["wiki scratch", WIKI, PIN_SCRATCH_CLONE, "calls a review scratch a clone"],
    ["wiki bug", WIKI, PIN_WIKI_BUG, "runs the bug reviewer in a scratch clone"],
  ]) {
    test(`${file} ${name}`, () => {
      const one = dropPin("one", file, pin);
      const r = accept(one);
      expect(r.code).toBe(1);
      expect(strip(r.out)).toBe(`${file}: no longer ${label}`);
    });
  }
});

describe("the general claims fire in every file", () => {
  for (const f of [COACH, HARNESS, HOSTS, WIKI]) {
    test(`${f} reviewer-worktree claim`, () => {
      const one = plantFault("one", f, "the reviewer worktree holds the round");
      const r = accept(one);
      expect(r.code).toBe(1);
      expect(strip(r.out)).toBe(`${f}: still says a reviewer works in a worktree`);
    });
    test(`${f} worktree-scratch claim`, () => {
      const one = plantFault("one", f, "a worktree detached at the snapshot holds the round");
      const r = accept(one);
      expect(r.code).toBe(1);
      expect(strip(r.out)).toBe(`${f}: still says a review scratch remains a worktree`);
    });
  }
});

describe("all faults together", () => {
  test("stale tree exits 1", () => {
    expect(accept(ostale).code).toBe(1);
  });

  test("stale tree lists 13 faults", () => {
    const lines = strip(accept(ostale).out)
      .split("\n")
      .filter((l) => l !== "");
    expect(lines.length).toBe(13);
  });

  for (const [name, line] of [
    [
      "stale coach conditional",
      `${COACH}: still says the clone flag is conditional on the security lens`,
    ],
    [
      "stale coach array",
      `${COACH}: still says the scratch is cut through a conditional clone flag`,
    ],
    ["stale coach table", `${COACH}: still says reviewer folders are worktrees outside security`],
    ["stale coach brief", `${COACH}: still says the lane works in a disposable worktree`],
    ["stale coach comment", `${COACH}: still says the security lens alone reviews from clones`],
    ["stale coach check", `${COACH}: still says only the security check requires a clone`],
    ["stale harness scratch", `${HARNESS}: still says a review scratch is a worktree`],
    ["stale harness general", `${HARNESS}: still says a review scratch remains a worktree`],
    ["stale hosts launches", `${HOSTS}: still says reviewer launches run in worktrees`],
    ["stale hosts general", `${HOSTS}: still says a reviewer works in a worktree`],
    ["stale wiki scratch", `${WIKI}: still says a review scratch is a worktree`],
    ["stale wiki bug", `${WIKI}: still says the bug reviewer runs in a worktree scratch`],
    ["stale wiki general", `${WIKI}: still says a review scratch remains a worktree`],
  ]) {
    test(`${name}`, () => {
      expect(accept(ostale).out.split("\n")).toContain(line);
    });
  }

  test("clean tree passes", () => {
    const r = accept(oclean);
    expect(r.code).toBe(0);
    expect(r.out).toBe("");
  });

  test("missing tree exits 2", () => {
    expect(accept(join(otmp, "nowhere")).code).toBe(2);
  });

  test("an extra argument exits 2", () => {
    const r = spawnSync(cli, ["reviewer-copy-acceptance", oclean, "extra"], {
      encoding: "utf8",
    });
    expect(r.status).toBe(2);
  });

  test("an unknown flag exits 2", () => {
    const r = spawnSync(cli, ["reviewer-copy-acceptance", "--no-such-flag", "extra"], {
      encoding: "utf8",
    });
    expect(r.status).toBe(2);
  });

  test("a CRLF stale sentence is still caught", () => {
    const dir = join(otmp, "crlf");
    rmSync(dir, { recursive: true, force: true });
    cpSync(oclean, dir, { recursive: true });
    writeFileSync(
      join(dir, COACH),
      "a clone under the security lens,\r\na worktree under the others.\r\n",
      { flag: "a" },
    );
    const r = accept(dir);
    expect(r.code).toBe(1);
    expect(strip(r.out)).toBe(
      `${COACH}: still says reviewer folders are worktrees outside security`,
    );
  });

  test("an unreadable file exits 2, not a clean result", () => {
    const dir = join(otmp, "locked");
    rmSync(dir, { recursive: true, force: true });
    cpSync(oclean, dir, { recursive: true });
    chmodSync(join(dir, COACH), 0o000);
    try {
      expect(accept(dir).code).toBe(2);
    } finally {
      chmodSync(join(dir, COACH), 0o644);
    }
  });

  test("the live tree passes", () => {
    const r = accept(ROOT);
    expect(r.code).toBe(0);
    expect(r.out).toBe("");
  });
});

interface Run {
  code: number;
  out: string;
  err: string;
}

function cliRun(...args: string[]): Run {
  const r = spawnSync(cli, args, { encoding: "utf8" });
  return { code: r.status ?? -1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

function git(...args: string[]): Run {
  const r = spawnSync("git", args, { encoding: "utf8" });
  return { code: r.status ?? -1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

function need(r: Run, what: string): void {
  if (r.code !== 0) throw new Error(`${what} failed: ${r.out}${r.err}`);
}

describe("C1: reviewer folders cut as clones", () => {
  const lenses = ["style", "bug", "security"];
  const lane = "lane";
  let tmp = "";
  let repo = "";
  let synth = "";
  let dispatch = "";
  let base = "";
  let snap = "";
  let savedEnv: Record<string, string | undefined> = {};

  function dest(lens: string): string {
    return join(repo, ".worktrees", `T-rev-${lens}-${lane}`);
  }

  beforeAll(() => {
    savedEnv = {
      GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME,
      GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL,
      GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME,
      GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL,
      PATH: process.env.PATH,
      POSTMASTER_HOST: process.env.POSTMASTER_HOST,
      POSTMASTER_HOST_STATE: process.env.POSTMASTER_HOST_STATE,
      POSTMASTER_HOST_STOP_WAIT: process.env.POSTMASTER_HOST_STOP_WAIT,
      POSTMASTER_HOST_CLOSE_WAIT: process.env.POSTMASTER_HOST_CLOSE_WAIT,
    };
    process.env.GIT_AUTHOR_NAME = "t";
    process.env.GIT_AUTHOR_EMAIL = "t@t";
    process.env.GIT_COMMITTER_NAME = "t";
    process.env.GIT_COMMITTER_EMAIL = "t@t";
    const tmpRaw = mkdtempSync(join(tmpdir(), "reviewer-copy-"));
    let phys = "";
    try {
      phys = realpathSync(tmpRaw);
    } catch {
      phys = "";
    }
    tmp = phys || tmpRaw;
    repo = join(tmp, "repo");
    need(git("init", "-q", "-b", "main", repo), "init");
    writeFileSync(join(repo, "a.txt"), "base\n");
    need(git("-C", repo, "add", "a.txt"), "add base");
    need(git("-C", repo, "commit", "-qm", "base"), "base commit");
    base = git("-C", repo, "rev-parse", "HEAD").out.trim();
    need(git("-C", repo, "worktree", "add", "-q", "-b", "T", ".worktrees/T"), "synthesis worktree");
    synth = join(repo, ".worktrees", "T");
    const branch = git("-C", synth, "rev-parse", "--abbrev-ref", "HEAD").out.trim();
    if (branch !== "T") throw new Error(`synthesis worktree is on ${branch}, not T`);
    writeFileSync(join(synth, "b.txt"), "change\n");
    need(git("-C", synth, "add", "b.txt"), "add change");
    need(git("-C", synth, "commit", "-qm", "change"), "change commit");
    snap = git("-C", synth, "rev-parse", "HEAD").out.trim();
    dispatch = join(tmp, "T");
    mkdirSync(join(dispatch, "logs"), { recursive: true });
    mkdirSync(join(tmp, "bin"), { recursive: true });
    mkdirSync(join(tmp, "host"), { recursive: true });
    for (const h of ["herdr", "tmux"]) {
      writeFileSync(join(tmp, "bin", h), "#!/bin/sh\nexit 1\n");
      chmodSync(join(tmp, "bin", h), 0o755);
    }
    process.env.PATH = `${join(tmp, "bin")}:${process.env.PATH}`;
    process.env.POSTMASTER_HOST = "none";
    process.env.POSTMASTER_HOST_STATE = join(tmp, "host");
    process.env.POSTMASTER_HOST_STOP_WAIT = "2";
    process.env.POSTMASTER_HOST_CLOSE_WAIT = "1";
  });

  afterAll(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(tmp, { recursive: true, force: true });
  });

  test("the runbook's cut makes a clone for a style, a bug and a security reviewer", () => {
    for (const lens of lenses) {
      const r = cliRun("cut-scratch", repo, synth, dest(lens), snap, "--clone", base);
      if (r.code !== 0) throw new Error(`${lens} cut failed: ${r.out}${r.err}`);
      expect(r.code).toBe(0);
    }
  });

  test("each folder is a repository of its own at the snapshot, detached", () => {
    for (const lens of lenses) {
      const f = dest(lens);
      const gitDir = git("-C", f, "rev-parse", "--absolute-git-dir").out.trim();
      const commonDir = git(
        "-C",
        f,
        "rev-parse",
        "--path-format=absolute",
        "--git-common-dir",
      ).out.trim();
      expect(gitDir).not.toBe("");
      expect(gitDir).toBe(commonDir);
      const alt =
        readFileSync(join(gitDir, "objects/info/alternates"), "utf8").split("\n")[0]?.trim() ?? "";
      expect(realpathSync(alt)).toBe(join(repo, ".git/objects"));
      expect(git("-C", f, "config", "remote.origin.url").out.trim()).toBe(repo);
      expect(git("-C", f, "rev-parse", "HEAD").out.trim()).toBe(snap);
      expect(git("-C", f, "symbolic-ref", "-q", "HEAD").code).not.toBe(0);
      expect(cliRun("cut-scratch", "--kind", f).out.trim()).toBe(`clone ${repo}`);
    }
  });

  test("negative control: without --clone the same cut is a worktree", () => {
    const plain = join(tmp, "wt-control");
    const r = cliRun("cut-scratch", repo, synth, plain, snap);
    if (r.code !== 0) throw new Error(`control cut failed: ${r.out}${r.err}`);
    expect(cliRun("cut-scratch", "--kind", plain).out.trim()).toBe(`worktree ${repo}`);
    const rm = cliRun("cut-scratch", "--remove", repo, plain);
    expect(rm.code).toBe(0);
    expect(existsSync(plain)).toBe(false);
  });

  test("review-round teardown removes each reviewer folder", () => {
    const pairs = lenses.map((lens) => `${lens}:${lane}`);
    const r = cliRun("review-round", "teardown", dispatch, "1", repo, ...pairs);
    if (r.code !== 0) throw new Error(`teardown failed: ${r.out}${r.err}`);
    expect(r.code).toBe(0);
    expect(readFileSync(join(dispatch, "run-log.md"), "utf8")).toContain(
      "round 1: removed 3 of 3 scratches",
    );
    for (const lens of lenses) expect(existsSync(dest(lens))).toBe(false);
  });
});
