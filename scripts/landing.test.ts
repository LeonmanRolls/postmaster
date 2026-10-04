// Tests beside scripts/landing.ts, moved from its --self-test on #109: 119 controls.
// The base self-test is one sequential script that mutates shared fixtures between
// controls (branches grow, clones push, dispatches append), so unlike
// ticket-check.test.ts these tests run in file order and are not standalone: each test
// performs the base's fixture steps inline, in order, then pins the control through the
// wrapper. Labels are the base's exact strings. A final describe pins the pure
// functions directly.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { run } from "./lib/proc.ts";
import { findingState, isFindingShaped, pyRepr } from "./landing.ts";

const SELF = join(import.meta.dir, "run");
const HERE = import.meta.dir;

// APFS refuses a file name that is not valid UTF-8, so the raw-byte fixture
// cannot be made on a Mac; skips.toml carries the reason.
const skipRawName = process.platform === "darwin";

delete process.env.GIT_DIR;
delete process.env.GIT_WORK_TREE;
delete process.env.GIT_COMMON_DIR;
delete process.env.GIT_INDEX_FILE;
delete process.env.GIT_OBJECT_DIRECTORY;
delete process.env.GIT_ALTERNATE_OBJECT_DIRECTORIES;
delete process.env.GIT_NAMESPACE;

let tmp = "";
const S: Record<string, string> = {};

const strip = (s: string): string => s.replace(/\n+$/u, "");

function sh(args: string[]): { code: number; out: string } {
  const r = run(SELF, ["landing", ...args]);
  return { code: r.code, out: strip(`${r.out}${r.err}`) };
}

function check(args: string[], code: number, want: string): void {
  const r = sh(args);
  expect(r.code).toBe(code);
  expect(r.out).toBe(want);
}

function git(dir: string, ...args: string[]): string {
  const r = run("git", ["-C", dir, ...args]);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.err}${r.out}`);
  return strip(r.out);
}

function identify(dir: string): void {
  git(dir, "config", "user.email", "t@t");
  git(dir, "config", "user.name", "t");
  git(dir, "config", "commit.gpgsign", "false");
}

function mkrepo(dir: string): void {
  const r = run("git", ["init", "-q", "-b", "main", dir]);
  if (r.code !== 0) throw new Error(`git init failed for ${dir}: ${r.err}`);
  identify(dir);
}

function commitFile(repo: string, file: string, content: string, msg: string): void {
  writeFileSync(join(repo, file), `${content}\n`);
  git(repo, "add", file);
  git(repo, "commit", "-qm", msg);
}

function clone(src: string, dst: string): void {
  const r = run("git", ["clone", "-q", "-c", "protocol.file.allow=always", src, dst]);
  if (r.code !== 0) throw new Error(`git clone failed: ${r.err}`);
}

const sha = (repo: string, ref = "HEAD"): string => git(repo, "rev-parse", ref);
const short = (id: string): string => id.slice(0, 12);

const GATE_CHECKS =
  '{"checks": [{"name": "gate", "source": "default:gate", "command": "true", "shows": "x"}]}\n';
const GATE_UNIT_CHECKS =
  '{"checks": [{"name": "gate", "source": "default:gate", "command": "true", "shows": "x"}, ' +
  '{"name": "unit", "source": "declared:unit", "command": "true", "shows": "x"}]}\n';
const GATE_JOURNEY_CHECKS =
  '{"checks": [{"name": "gate", "source": "default:gate", "command": "true", "shows": "x"}, ' +
  '{"name": "journey", "source": "default:web-journey", "command": "true", "shows": "x"}]}\n';
const action = (
  target: string,
  on: string,
  result: string,
  exit: number,
  ts = "2026-01-01T00:00:00Z",
): string =>
  `{"action": "verify", "target": "${target}", "ts": "${ts}", ` +
  `"detail": "on=${on} result=${result} exit=${exit} secs=1"}\n`;
const checkpoint = (...lines: string[]): string => `${lines.join("\n")}\n`;

function extendCp(name: string, extra: string): string {
  const p = join(S.d!, name);
  copyFileSync(join(S.d!, "checkpoint.md"), p);
  writeFileSync(p, `${readFileSync(p, "utf8")}${extra}\n`);
  return p;
}

function blockRange(card: string): { start: number; end: number } {
  const lines = card.split("\n");
  const start = lines.findIndex((l) => l.startsWith("## Checks"));
  let end = start;
  for (let i = start; i < lines.length; i++) {
    if (lines[i]!.endsWith("sec-2")) {
      end = i;
      break;
    }
  }
  return { start, end };
}

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "postmaster-"));
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("already-landed", () => {
  test("an unmerged branch is not landed", () => {
    // A repo with every landing shape: main holds A-B, the ticket branch T1-T2 off B,
    // main advanced past B, a --no-ff merge of another branch, and a squash of a third.
    S.r = join(tmp, "r");
    mkrepo(S.r);
    commitFile(S.r, "f", "A", "A");
    commitFile(S.r, "f", "B", "B");
    S.base = sha(S.r);
    git(S.r, "checkout", "-qb", "ticket");
    commitFile(S.r, "f", "T1", "T1");
    commitFile(S.r, "g", "T2", "T2");
    S.tip = sha(S.r);
    git(S.r, "checkout", "-q", "main");
    commitFile(S.r, "f", "M1", "M1");
    git(S.r, "checkout", "-qb", "side");
    commitFile(S.r, "s", "S", "S");
    git(S.r, "checkout", "-q", "main");
    git(S.r, "merge", "-q", "--no-ff", "-m", "merge", "side");
    S.nomerge = sha(S.r);
    git(S.r, "checkout", "-qb", "sq");
    commitFile(S.r, "q", "Q", "Q");
    git(S.r, "checkout", "-q", "main");
    git(S.r, "merge", "-q", "--squash", "sq");
    git(S.r, "commit", "-qm", "squash");
    check(
      [
        "already-landed",
        "--repo",
        S.r,
        "--default",
        "main",
        "--ticket",
        S.tip,
        "--base",
        S.base,
        "--card-head",
        S.tip,
      ],
      0,
      "not-landed",
    );
  });

  test("an empty branch after the default branch moves is not landed", () => {
    git(S.r!, "checkout", "-q", "ticket");
    git(S.r!, "branch", "-qf", "empty", S.base!);
    check(
      [
        "already-landed",
        "--repo",
        S.r!,
        "--default",
        "main",
        "--ticket",
        "empty",
        "--base",
        S.base!,
        "--card-head",
        S.base!,
      ],
      0,
      "not-landed",
    );
  });

  test("a fast-forward merge is landed", () => {
    S.ff = join(tmp, "ff");
    mkrepo(S.ff);
    commitFile(S.ff, "f", "A", "A");
    S.b2 = sha(S.ff);
    git(S.ff, "checkout", "-qb", "ticket");
    commitFile(S.ff, "f", "T", "T");
    S.h2 = sha(S.ff);
    git(S.ff, "checkout", "-q", "main");
    git(S.ff, "merge", "-q", "--ff-only", "ticket");
    check(
      [
        "already-landed",
        "--repo",
        S.ff,
        "--default",
        "main",
        "--ticket",
        "ticket",
        "--base",
        S.b2,
        "--card-head",
        S.h2,
      ],
      0,
      "landed",
    );
  });

  test("a --no-ff merge is landed", () => {
    check(
      [
        "already-landed",
        "--repo",
        S.r!,
        "--default",
        "main",
        "--ticket",
        "side",
        "--base",
        S.base!,
        "--card-head",
        sha(S.r!, "side"),
      ],
      0,
      "landed",
    );
  });

  test("a squash merge the provider did not report is not landed", () => {
    check(
      [
        "already-landed",
        "--repo",
        S.r!,
        "--default",
        "main",
        "--ticket",
        "sq",
        "--base",
        S.base!,
        "--card-head",
        sha(S.r!, "sq"),
      ],
      0,
      "not-landed",
    );
  });

  test("a provider-reported squash merge at the card's HEAD is landed", () => {
    S.sqm = sha(S.r!, "main");
    check(
      [
        "already-landed",
        "--repo",
        S.r!,
        "--default",
        "main",
        "--ticket",
        "sq",
        "--base",
        S.base!,
        "--card-head",
        sha(S.r!, "sq"),
        "--pr-merge",
        S.sqm,
        "--pr-head",
        sha(S.r!, "sq"),
      ],
      0,
      "landed",
    );
  });

  test("a branch past the card's HEAD says re-verify, never landed", () => {
    git(S.r!, "checkout", "-qb", "moved", S.tip!);
    commitFile(S.r!, "f", "T3", "T3");
    check(
      [
        "already-landed",
        "--repo",
        S.r!,
        "--default",
        "main",
        "--ticket",
        "moved",
        "--base",
        S.base!,
        "--card-head",
        S.tip!,
      ],
      0,
      "re-verify",
    );
  });

  test("a moved branch says re-verify even where the merge is real", () => {
    check(
      [
        "already-landed",
        "--repo",
        S.r!,
        "--default",
        "main",
        "--ticket",
        "side",
        "--base",
        S.base!,
        "--card-head",
        S.nomerge!,
        "--pr-merge",
        S.nomerge!,
        "--pr-head",
        S.nomerge!,
      ],
      0,
      "re-verify",
    );
  });

  test("V1: a --pr-merge equal to the tip of an unmerged branch is not landed", () => {
    check(
      [
        "already-landed",
        "--repo",
        S.r!,
        "--default",
        "main",
        "--ticket",
        "ticket",
        "--base",
        S.base!,
        "--card-head",
        S.tip!,
        "--pr-merge",
        S.tip!,
        "--pr-head",
        S.tip!,
      ],
      0,
      "not-landed",
    );
  });

  test("V1: a merge off the default branch does not count", () => {
    check(
      [
        "already-landed",
        "--repo",
        S.r!,
        "--default",
        "main",
        "--ticket",
        "ticket",
        "--base",
        S.base!,
        "--card-head",
        S.tip!,
        "--pr-merge",
        sha(S.r!, "moved"),
        "--pr-head",
        S.tip!,
      ],
      0,
      "not-landed",
    );
  });

  test("AG1: a card at the local tip with the remote behind is unpushed", () => {
    S.up = join(tmp, "up");
    mkrepo(S.up);
    commitFile(S.up, "f", "A", "A");
    git(S.up, "checkout", "-qb", "ticket");
    commitFile(S.up, "f", "T", "T");
    S.upb = sha(S.up, "main");
    clone(S.up, join(tmp, "uc"));
    git(S.up, "checkout", "-q", "main");
    S.uc = join(tmp, "uc");
    identify(S.uc);
    git(S.uc, "checkout", "-q", "ticket");
    commitFile(S.uc, "f", "U", "U");
    S.uch = sha(S.uc);
    git(S.uc, "fetch", "-q", "origin");
    check(
      [
        "already-landed",
        "--repo",
        S.uc,
        "--default",
        "origin/main",
        "--ticket",
        "origin/ticket",
        "--base",
        S.upb,
        "--card-head",
        S.uch,
        "--local-ticket",
        "ticket",
      ],
      0,
      "unpushed",
    );
  });

  test("AH5: the remote behind without --local-ticket stays re-verify", () => {
    check(
      [
        "already-landed",
        "--repo",
        S.uc!,
        "--default",
        "origin/main",
        "--ticket",
        "origin/ticket",
        "--base",
        S.upb!,
        "--card-head",
        S.uch!,
      ],
      0,
      "re-verify",
    );
  });

  test("AG1: pushing clears unpushed", () => {
    git(S.uc!, "-c", "protocol.file.allow=always", "push", "-q", "origin", "ticket");
    git(S.uc!, "fetch", "-q", "origin");
    check(
      [
        "already-landed",
        "--repo",
        S.uc!,
        "--default",
        "origin/main",
        "--ticket",
        "origin/ticket",
        "--base",
        S.upb!,
        "--card-head",
        S.uch!,
        "--local-ticket",
        "ticket",
      ],
      0,
      "not-landed",
    );
  });

  test("AG1: a card at the remote's tip answers as before", () => {
    git(S.up!, "checkout", "-q", "main");
    git(S.up!, "merge", "-q", "--no-ff", "ticket", "-m", "merge");
    S.upm = sha(S.up!);
    git(S.uc!, "fetch", "-q", "origin");
    check(
      [
        "already-landed",
        "--repo",
        S.uc!,
        "--default",
        "origin/main",
        "--ticket",
        "origin/ticket",
        "--base",
        S.upb!,
        "--card-head",
        S.uch!,
        "--local-ticket",
        "ticket",
        "--pr-merge",
        S.upm,
        "--pr-head",
        S.uch!,
      ],
      0,
      "landed",
    );
  });

  test("AG1: upstream past the card is still re-verify", () => {
    git(S.up!, "checkout", "-q", "ticket");
    commitFile(S.up!, "f", "H2", "H2");
    git(S.uc!, "fetch", "-q", "origin");
    check(
      [
        "already-landed",
        "--repo",
        S.uc!,
        "--default",
        "origin/main",
        "--ticket",
        "origin/ticket",
        "--base",
        S.upb!,
        "--card-head",
        S.uch!,
        "--local-ticket",
        "ticket",
      ],
      0,
      "re-verify",
    );
  });

  test("a reported merge at another head answers re-verify", () => {
    S.h2 = sha(S.uc!, "origin/ticket");
    check(
      [
        "already-landed",
        "--repo",
        S.uc!,
        "--default",
        "origin/main",
        "--ticket",
        "origin/ticket",
        "--base",
        S.upb!,
        "--card-head",
        S.h2,
        "--local-ticket",
        "ticket",
        "--pr-merge",
        S.upm!,
        "--pr-head",
        S.uch!,
      ],
      0,
      "re-verify",
    );
  });

  test("AI1: an unknown reported head over a ticket at the card answers re-verify", () => {
    check(
      [
        "already-landed",
        "--repo",
        S.r!,
        "--default",
        "main",
        "--ticket",
        "ticket",
        "--base",
        S.base!,
        "--card-head",
        S.tip!,
        "--pr-merge",
        S.sqm!,
        "--pr-head",
        "1111111111111111111111111111111111111111",
      ],
      0,
      "re-verify",
    );
  });

  test("a pruned ticket ref with a reported merge answers from the report", () => {
    S.po = join(tmp, "po");
    mkrepo(S.po);
    commitFile(S.po, "f", "A", "A");
    git(S.po, "checkout", "-qb", "ticket");
    commitFile(S.po, "f", "T", "T");
    S.pob = sha(S.po, "main");
    S.poh = sha(S.po, "ticket");
    git(S.po, "checkout", "-q", "main");
    git(S.po, "merge", "-q", "--no-ff", "ticket", "-m", "merge");
    S.pom = sha(S.po);
    git(S.po, "branch", "-q", "-D", "ticket");
    clone(S.po, join(tmp, "pc"));
    S.pc = join(tmp, "pc");
    git(S.pc, "fetch", "-q", "--prune", "origin");
    check(
      [
        "already-landed",
        "--repo",
        S.pc,
        "--default",
        "origin/main",
        "--ticket",
        "origin/ticket",
        "--base",
        S.pob,
        "--card-head",
        S.poh,
        "--pr-merge",
        S.pom,
        "--pr-head",
        S.poh,
      ],
      0,
      "landed",
    );
  });

  test("AI1: a pruned ticket ref with an unknown reported head answers re-verify", () => {
    check(
      [
        "already-landed",
        "--repo",
        S.pc!,
        "--default",
        "origin/main",
        "--ticket",
        "origin/ticket",
        "--base",
        S.pob!,
        "--card-head",
        S.poh!,
        "--pr-merge",
        S.pom!,
        "--pr-head",
        "1111111111111111111111111111111111111111",
      ],
      0,
      "re-verify",
    );
  });

  test("a pruned ticket ref without a report is still usage", () => {
    const r = sh([
      "already-landed",
      "--repo",
      S.pc!,
      "--default",
      "origin/main",
      "--ticket",
      "origin/ticket",
      "--base",
      S.pob!,
      "--card-head",
      S.poh!,
    ]);
    expect(r.code).toBe(1);
  });

  test("an unresolvable ticket ref is usage, not an answer", () => {
    const r = sh([
      "already-landed",
      "--repo",
      S.r!,
      "--default",
      "main",
      "--ticket",
      "missing",
      "--base",
      S.base!,
      "--card-head",
      S.tip!,
    ]);
    expect(r.code).toBe(1);
  });

  test("missing flags are usage", () => {
    const r = sh(["already-landed", "--repo", S.r!, "--default", "main", "--ticket", "ticket"]);
    expect(r.code).toBe(1);
  });
});

describe("anything-to-land", () => {
  test("an unmerged branch with commits lands", () => {
    check(
      [
        "anything-to-land",
        "--repo",
        S.r!,
        "--default",
        "main",
        "--ticket",
        S.tip!,
        "--base",
        S.base!,
      ],
      0,
      "land",
    );
  });

  test("a fast-forwarded branch holds nothing to land", () => {
    check(
      [
        "anything-to-land",
        "--repo",
        S.ff!,
        "--default",
        "main",
        "--ticket",
        "ticket",
        "--base",
        S.b2!,
      ],
      0,
      "nothing-to-land",
    );
  });

  test("an empty branch holds nothing to land", () => {
    check(
      [
        "anything-to-land",
        "--repo",
        S.r!,
        "--default",
        "main",
        "--ticket",
        "empty",
        "--base",
        S.base!,
      ],
      0,
      "nothing-to-land",
    );
  });

  test("a branch reset to BASE lands nothing when the default branch is rewritten", () => {
    S.rw = join(tmp, "rw");
    mkrepo(S.rw);
    commitFile(S.rw, "f", "A", "A");
    commitFile(S.rw, "f", "B", "B");
    S.rwb = sha(S.rw);
    git(S.rw, "checkout", "-qb", "ticket", S.rwb);
    git(S.rw, "branch", "-qf", "main", sha(S.rw, "HEAD~1"));
    check(
      [
        "anything-to-land",
        "--repo",
        S.rw,
        "--default",
        "main",
        "--ticket",
        "ticket",
        "--base",
        S.rwb,
      ],
      0,
      "nothing-to-land",
    );
  });

  test("a partly landed branch still lands", () => {
    git(S.r!, "checkout", "-q", "main");
    git(S.r!, "checkout", "-q", "ticket", "--", "f");
    git(S.r!, "commit", "-qm", "partial");
    check(
      [
        "anything-to-land",
        "--repo",
        S.r!,
        "--default",
        "main",
        "--ticket",
        S.tip!,
        "--base",
        S.base!,
      ],
      0,
      "land",
    );
  });

  test("the rewritten shape still answers after later fixtures move", () => {
    git(S.r!, "checkout", "-qb", "zero", S.base!);
    git(S.r!, "commit", "-q", "--allow-empty", "-m", "zero");
    check(
      [
        "anything-to-land",
        "--repo",
        S.rw!,
        "--default",
        "main",
        "--ticket",
        "ticket",
        "--base",
        S.rwb!,
      ],
      0,
      "nothing-to-land",
    );
  });

  test("an empty commit on BASE lands nothing", () => {
    check(
      [
        "anything-to-land",
        "--repo",
        S.r!,
        "--default",
        "main",
        "--ticket",
        "zero",
        "--base",
        S.base!,
      ],
      0,
      "nothing-to-land",
    );
  });

  test("an unresolvable ticket ref is usage, not an answer", () => {
    const r = sh([
      "anything-to-land",
      "--repo",
      S.r!,
      "--default",
      "main",
      "--ticket",
      "missing",
      "--base",
      S.base!,
    ]);
    expect(r.code).toBe(1);
  });

  test("V6: a rename absent from the default branch lands", () => {
    S.rn = join(tmp, "rn");
    mkrepo(S.rn);
    commitFile(S.rn, "old", "X", "X");
    S.rnb = sha(S.rn);
    git(S.rn, "checkout", "-qb", "ticket");
    git(S.rn, "mv", "old", "new");
    git(S.rn, "commit", "-qm", "rename");
    git(S.rn, "checkout", "-q", "main");
    check(
      [
        "anything-to-land",
        "--repo",
        S.rn,
        "--default",
        "main",
        "--ticket",
        "ticket",
        "--base",
        S.rnb,
      ],
      0,
      "land",
    );
  });

  test("W2: a submodule bump lands with ignoreSubmodules set", () => {
    S.sm = join(tmp, "sm");
    const sub = join(S.sm, "sub");
    const outer = join(S.sm, "outer");
    mkrepo(sub);
    commitFile(sub, "f", "S", "S");
    mkrepo(outer);
    git(outer, "-c", "protocol.file.allow=always", "submodule", "-q", "add", "../sub", "sub");
    identify(join(outer, "sub"));
    git(outer, "commit", "-qm", "addsub");
    S.smb = sha(outer);
    git(outer, "checkout", "-qb", "ticket");
    writeFileSync(join(outer, "sub", "f"), "S2\n");
    git(join(outer, "sub"), "commit", "-qam", "s2");
    git(outer, "add", "sub");
    git(outer, "commit", "-qm", "bump");
    git(outer, "checkout", "-q", "main");
    git(outer, "config", "diff.ignoreSubmodules", "all");
    S.smouter = outer;
    check(
      [
        "anything-to-land",
        "--repo",
        outer,
        "--default",
        "main",
        "--ticket",
        "ticket",
        "--base",
        S.smb,
      ],
      0,
      "land",
    );
  });

  test("X1: a submodule bump lands with per-submodule ignore set", () => {
    const outer = join(tmp, "si", "outer");
    const sub = join(tmp, "si", "sub");
    mkrepo(sub);
    commitFile(sub, "f", "S", "S");
    mkrepo(outer);
    git(outer, "-c", "protocol.file.allow=always", "submodule", "-q", "add", "../sub", "sub");
    identify(join(outer, "sub"));
    git(outer, "commit", "-qm", "addsub");
    S.sib = sha(outer);
    git(outer, "checkout", "-qb", "ticket");
    writeFileSync(join(outer, "real.txt"), "T\n");
    writeFileSync(join(outer, "sub", "f"), "S2\n");
    git(join(outer, "sub"), "commit", "-qam", "s2");
    git(outer, "add", "sub", "real.txt");
    git(outer, "commit", "-qm", "both");
    git(outer, "checkout", "-q", "main");
    writeFileSync(join(outer, "real.txt"), "T\n");
    git(outer, "add", "real.txt");
    git(outer, "commit", "-qm", "squashlike");
    git(outer, "config", "submodule.sub.ignore", "all");
    S.siouter = outer;
    check(
      [
        "anything-to-land",
        "--repo",
        outer,
        "--default",
        "main",
        "--ticket",
        "ticket",
        "--base",
        S.sib,
      ],
      0,
      "land",
    );
  });

  test("Y8: a submodule bump lands with .gitmodules-shipped ignore", () => {
    const outer = join(tmp, "sg", "outer");
    const sub = join(tmp, "sg", "sub");
    mkrepo(sub);
    commitFile(sub, "f", "S", "S");
    mkrepo(outer);
    git(outer, "-c", "protocol.file.allow=always", "submodule", "-q", "add", "../sub", "sub");
    identify(join(outer, "sub"));
    git(outer, "config", "-f", ".gitmodules", "submodule.sub.ignore", "all");
    git(outer, "commit", "-qm", "addsub");
    S.sgb = sha(outer);
    git(outer, "checkout", "-qb", "ticket");
    writeFileSync(join(outer, "sub", "f"), "S2\n");
    git(join(outer, "sub"), "commit", "-qam", "s2");
    git(outer, "add", "sub");
    git(outer, "commit", "-qm", "bump");
    check(
      [
        "anything-to-land",
        "--repo",
        outer,
        "--default",
        "main",
        "--ticket",
        "ticket",
        "--base",
        S.sgb,
      ],
      0,
      "land",
    );
  });

  test("an unreported squash merge answers land", () => {
    S.sq = join(tmp, "sq");
    mkrepo(S.sq);
    writeFileSync(join(S.sq, "f"), "base\n");
    git(S.sq, "add", "f");
    git(S.sq, "commit", "-qm", "A");
    S.sqb = sha(S.sq);
    git(S.sq, "checkout", "-qb", "ticket");
    writeFileSync(join(S.sq, "f"), "base\nticket-line\n");
    git(S.sq, "commit", "-qam", "T");
    S.sqt = sha(S.sq);
    git(S.sq, "checkout", "-q", "main");
    git(S.sq, "merge", "-q", "--squash", "ticket");
    git(S.sq, "commit", "-qm", "squash");
    writeFileSync(join(S.sq, "f"), "base\nticket-line\nindependent\n");
    git(S.sq, "commit", "-qam", "IND");
    check(
      ["anything-to-land", "--repo", S.sq, "--default", "main", "--ticket", S.sqt, "--base", S.sqb],
      0,
      "land",
    );
  });

  test("AG3: genuinely new content still lands", () => {
    git(S.sq!, "checkout", "-q", "ticket");
    writeFileSync(join(S.sq!, "f"), "base\nticket-line\nfresh\n");
    git(S.sq!, "commit", "-qam", "F");
    S.sqt2 = sha(S.sq!);
    check(
      [
        "anything-to-land",
        "--repo",
        S.sq!,
        "--default",
        "main",
        "--ticket",
        S.sqt2,
        "--base",
        S.sqb!,
      ],
      0,
      "land",
    );
  });

  test.skipIf(skipRawName)("AH4: a raw-byte path answers without a traceback", () => {
    S.bp = join(tmp, "bp");
    mkrepo(S.bp);
    git(S.bp, "config", "core.quotePath", "false");
    writeFileSync(join(S.bp, "f"), "base\n");
    git(S.bp, "add", "f");
    git(S.bp, "commit", "-qm", "A");
    S.bpb = sha(S.bp);
    git(S.bp, "checkout", "-qb", "ticket");
    const raw = run(
      "python3",
      [
        "-c",
        "import os; open(os.path.join(os.environ['BP'].encode(), b'bad\\xffname'), 'w').write('x\\n')",
      ],
      { env: { ...(process.env as Record<string, string>), BP: S.bp } },
    );
    if (raw.code !== 0) throw new Error(`raw-byte fixture failed: ${raw.err}`);
    git(S.bp, "add", "-A");
    git(S.bp, "commit", "-qam", "T");
    S.bph = sha(S.bp);
    check(
      ["anything-to-land", "--repo", S.bp, "--default", "main", "--ticket", S.bph, "--base", S.bpb],
      0,
      "land",
    );
  });
});

describe("fresh", () => {
  test("W1: a ticket holding default with the gate passing is fresh", () => {
    S.f = join(tmp, "fr");
    mkrepo(S.f);
    commitFile(S.f, "f", "A", "A");
    git(S.f, "checkout", "-qb", "ticket");
    commitFile(S.f, "f", "T", "T");
    S.fh12 = short(sha(S.f));
    S.fd = join(tmp, "fd");
    mkdirSync(S.fd);
    writeFileSync(join(S.fd, "checks.json"), GATE_CHECKS);
    writeFileSync(join(S.fd, "actions.jsonl"), action("gate", `ticket@${S.fh12}`, "pass", 0));
    git(S.f, "checkout", "-q", "ticket");
    check(
      [
        "fresh",
        "--repo",
        S.f,
        "--default",
        "main",
        "--ticket",
        "ticket",
        "--dispatch",
        S.fd,
        "--wt",
        S.f,
      ],
      0,
      "fresh",
    );
  });

  test("W1: a head with no recorded gate is not fresh", () => {
    S.fu = join(tmp, "fu");
    mkdirSync(S.fu);
    copyFileSync(join(S.fd!, "checks.json"), join(S.fu, "checks.json"));
    writeFileSync(join(S.fu, "actions.jsonl"), "");
    check(
      [
        "fresh",
        "--repo",
        S.f!,
        "--default",
        "main",
        "--ticket",
        "ticket",
        "--dispatch",
        S.fu,
        "--wt",
        S.f!,
      ],
      2,
      `gate: not run at ${S.fh12!}`,
    );
  });

  test("W1: a head with a failing gate is not fresh", () => {
    S.fg = join(tmp, "fg");
    mkdirSync(S.fg);
    copyFileSync(join(S.fd!, "checks.json"), join(S.fg, "checks.json"));
    writeFileSync(join(S.fg, "actions.jsonl"), action("gate", `ticket@${S.fh12!}`, "fail", 2));
    check(
      [
        "fresh",
        "--repo",
        S.f!,
        "--default",
        "main",
        "--ticket",
        "ticket",
        "--dispatch",
        S.fg,
        "--wt",
        S.f!,
      ],
      2,
      `gate: fail at ${S.fh12!}`,
    );
  });

  test("W1: a ticket behind the default branch is not fresh", () => {
    git(S.f!, "checkout", "-q", "main");
    commitFile(S.f!, "f", "M2", "M2");
    git(S.f!, "checkout", "-q", "ticket");
    check(
      [
        "fresh",
        "--repo",
        S.f!,
        "--default",
        "main",
        "--ticket",
        "ticket",
        "--dispatch",
        S.fd!,
        "--wt",
        S.f!,
      ],
      2,
      "stale: the ticket branch does not contain the default branch",
    );
  });

  test("W1: a worktree off the ticket head is not fresh", () => {
    S.fm = join(tmp, "fm");
    mkrepo(S.fm);
    commitFile(S.fm, "f", "A", "A");
    S.ma12 = short(sha(S.fm));
    git(S.fm, "checkout", "-qb", "ticket");
    commitFile(S.fm, "f", "T", "T");
    git(S.fm, "checkout", "-q", "main");
    S.md = join(tmp, "md");
    mkdirSync(S.md);
    copyFileSync(join(S.fd!, "checks.json"), join(S.md, "checks.json"));
    writeFileSync(join(S.md, "actions.jsonl"), action("gate", `main@${S.ma12}`, "pass", 0));
    S.th12 = short(sha(S.fm, "ticket"));
    check(
      [
        "fresh",
        "--repo",
        S.fm,
        "--default",
        "main",
        "--ticket",
        "ticket",
        "--dispatch",
        S.md,
        "--wt",
        S.fm,
      ],
      2,
      `head: the worktree is at ${S.ma12}, the ticket at ${S.th12}`,
    );
  });

  test("Y1: the remote-tracking ref sees the advanced default as stale", () => {
    S.yo = join(tmp, "yo");
    mkrepo(S.yo);
    commitFile(S.yo, "f", "A", "A");
    clone(S.yo, join(tmp, "yc"));
    S.yc = join(tmp, "yc");
    identify(S.yc);
    git(S.yc, "checkout", "-qb", "ticket");
    commitFile(S.yc, "f", "T", "T");
    S.yh12 = short(sha(S.yc));
    S.yd = join(tmp, "yd");
    mkdirSync(S.yd);
    writeFileSync(join(S.yd, "checks.json"), GATE_CHECKS);
    writeFileSync(join(S.yd, "actions.jsonl"), action("gate", `ticket@${S.yh12}`, "pass", 0));
    commitFile(S.yo, "f", "M2", "M2");
    git(S.yc, "fetch", "-q", "origin");
    check(
      [
        "fresh",
        "--repo",
        S.yc,
        "--default",
        "origin/main",
        "--ticket",
        "ticket",
        "--dispatch",
        S.yd,
        "--wt",
        S.yc,
      ],
      2,
      "stale: the ticket branch does not contain the default branch",
    );
  });

  test("Z1: the default branch's upstream resolves", () => {
    const r = run("git", [
      "-C",
      S.yc!,
      "for-each-ref",
      "--format=%(upstream:short)",
      "refs/heads/main",
    ]);
    expect(r.code).toBe(0);
    expect(strip(r.out)).toBe("origin/main");
  });

  test("AA5: the default branch's upstream remote resolves", () => {
    const r = run("git", [
      "-C",
      S.yc!,
      "for-each-ref",
      "--format=%(upstream:remotename)",
      "refs/heads/main",
    ]);
    expect(r.code).toBe(0);
    expect(strip(r.out)).toBe("origin");
  });

  test("AB2: one format names the upstream ref and its remote", () => {
    const r = run("git", [
      "-C",
      S.yc!,
      "for-each-ref",
      "--format=%(upstream:short) %(upstream:remotename)",
      "refs/heads/main",
    ]);
    expect(r.code).toBe(0);
    expect(strip(r.out)).toBe("origin/main origin");
  });

  test("AC6: no upstream prints a blank answer", () => {
    S.gn = join(tmp, "gn");
    mkrepo(S.gn);
    commitFile(S.gn, "f", "A", "A");
    const r = run("git", [
      "-C",
      S.gn,
      "for-each-ref",
      "--format=%(upstream:short) %(upstream:remotename)",
      "refs/heads/main",
    ]);
    expect(r.code).toBe(0);
    expect(strip(r.out)).toBe(" ");
  });

  test("AC6: a local upstream prints a dot remote", () => {
    git(S.gn!, "checkout", "-qb", "local-base");
    git(S.gn!, "checkout", "-qb", "ticket");
    git(S.gn!, "branch", "--set-upstream-to=local-base");
    const r = run("git", [
      "-C",
      S.gn!,
      "for-each-ref",
      "--format=%(upstream:short) %(upstream:remotename)",
      "refs/heads/ticket",
    ]);
    expect(r.code).toBe(0);
    expect(strip(r.out)).toBe("local-base .");
  });

  test("Z1: a named-remote fetch with the upstream ref reads stale", () => {
    S.zo = join(tmp, "zo");
    mkrepo(S.zo);
    commitFile(S.zo, "f", "A", "A");
    clone(S.zo, join(tmp, "zc"));
    S.zc = join(tmp, "zc");
    identify(S.zc);
    git(S.zc, "remote", "rename", "origin", "upstream");
    S.zx = join(tmp, "zx");
    mkrepo(S.zx);
    commitFile(S.zx, "f", "A", "A");
    git(S.zc, "remote", "add", "origin", S.zx);
    git(S.zc, "checkout", "-qb", "ticket");
    commitFile(S.zc, "f", "T", "T");
    S.zh12 = short(sha(S.zc));
    git(S.zc, "push", "-q", "-u", "origin", "ticket");
    S.zd = join(tmp, "zd");
    mkdirSync(S.zd);
    writeFileSync(join(S.zd, "checks.json"), GATE_CHECKS);
    writeFileSync(join(S.zd, "actions.jsonl"), action("gate", `ticket@${S.zh12}`, "pass", 0));
    commitFile(S.zo, "f", "M2", "M2");
    git(S.zc, "fetch", "-q", "upstream");
    check(
      [
        "fresh",
        "--repo",
        S.zc,
        "--default",
        "upstream/main",
        "--ticket",
        "ticket",
        "--dispatch",
        S.zd,
        "--wt",
        S.zc,
      ],
      2,
      "stale: the ticket branch does not contain the default branch",
    );
  });
});

describe("results", () => {
  test("results prints each check with the mapping read", () => {
    S.d = join(tmp, "d");
    S.w = join(tmp, "wt");
    mkrepo(S.w);
    commitFile(S.w, "f", "X", "X");
    S.sha12 = short(sha(S.w));
    mkdirSync(S.d);
    writeFileSync(join(S.d, "checks.json"), GATE_UNIT_CHECKS);
    writeFileSync(join(S.d, "actions.jsonl"), action("gate", `main@${S.sha12}`, "pass", 0));
    writeFileSync(S.d + "/card.md", "# Card\n\n## Checks\n\n- gate: pass\n- unit: not run\n");
    check(["results", S.d, S.w], 0, "gate: pass\nunit: not run");
  });

  test("a dispatch with no record is usage, not results", () => {
    const r = sh(["results", tmp, S.w!]);
    expect(r.code).toBe(1);
  });
});

describe("card-block", () => {
  test("the block renders the checks and the checkpoint states exactly", () => {
    writeFileSync(
      join(S.d!, "checkpoint.md"),
      checkpoint(
        "## Findings (bug)",
        "",
        "- [P1] bug-1: open",
        "- [P2] bug-2: closed round 2",
        "## Findings (security)",
        "",
        "- [P2] sec-1: dismissed: not reachable",
        "- [P2] sec-2: applied on user word, not re-reviewed",
      ),
    );
    check(
      ["card-block", S.d!, S.w!, join(S.d!, "checkpoint.md")],
      0,
      "## Checks\n\n- gate: pass\n- unit: not run\n\n## Open findings\n\n- [P1] bug-1\n\n" +
        "## Not re-reviewed\n\n- [P2] sec-2",
    );
  });

  test("a duplicate id in the checkpoint faults the render", () => {
    writeFileSync(
      join(S.d!, "cp-dup.md"),
      checkpoint("## Findings (bug)", "", "- [P1] bug-1: open", "- [P2] bug-1: closed round 1"),
    );
    check(
      ["card-block", S.d!, S.w!, join(S.d!, "cp-dup.md")],
      1,
      "landing: checkpoint: bug-1: listed twice",
    );
  });

  test("AB5: a star bullet parses as a finding", () => {
    writeFileSync(
      join(S.d!, "cp-star.md"),
      checkpoint("## Findings (bug)", "", "* [P1] bug-9: open"),
    );
    check(
      ["card-block", S.d!, S.w!, join(S.d!, "cp-star.md")],
      0,
      "## Checks\n\n- gate: pass\n- unit: not run\n\n## Open findings\n\n- [P1] bug-9\n\n" +
        "## Not re-reviewed\n\nnone",
    );
  });
});

describe("card-results", () => {
  test("a faithful card holding the block once matches", () => {
    S.card =
      "# Ship card\n\nSome prose.\n\n## Checks\n\n- gate: pass\n- unit: not run\n\n" +
      "## Open findings\n\n- [P1] bug-1\n\n## Not re-reviewed\n\n- [P2] sec-2\n\nTrailing prose.\n";
    writeFileSync(join(S.d!, "card.md"), S.card);
    check(
      ["card-results", S.d!, S.w!, join(S.d!, "checkpoint.md"), join(S.d!, "card.md")],
      0,
      "match",
    );
  });

  test("card-findings agrees on the faithful card", () => {
    check(
      ["card-findings", S.d!, S.w!, join(S.d!, "checkpoint.md"), join(S.d!, "card.md")],
      0,
      "match",
    );
  });

  test("a block edited in one character is an input fault", () => {
    writeFileSync(join(S.d!, "card-edited.md"), S.card!.replace("- gate: pass", "- gate: pasz"));
    check(
      ["card-results", S.d!, S.w!, join(S.d!, "checkpoint.md"), join(S.d!, "card-edited.md")],
      1,
      "landing: card: does not hold the expected block",
    );
  });

  test("an indented block is an input fault", () => {
    const indented = S.card!.split("\n")
      .map((l) => (l.startsWith("-") ? `  ${l}` : l))
      .join("\n");
    writeFileSync(join(S.d!, "card-indented.md"), indented);
    check(
      ["card-results", S.d!, S.w!, join(S.d!, "checkpoint.md"), join(S.d!, "card-indented.md")],
      1,
      "landing: card: does not hold the expected block",
    );
  });

  test("a fenced block counts like any other copy", () => {
    const fenced = S.card!.replace("## Checks\n", "```\n## Checks\n").replace(
      "- [P2] sec-2\n",
      "- [P2] sec-2\n```\n",
    );
    writeFileSync(join(S.d!, "card-fenced.md"), fenced);
    check(
      ["card-results", S.d!, S.w!, join(S.d!, "checkpoint.md"), join(S.d!, "card-fenced.md")],
      0,
      "match",
    );
  });

  test("a second copy inside a fence is still a second copy", () => {
    const lines = S.card!.split("\n");
    const { start, end } = blockRange(S.card!);
    const copy = `${lines.slice(start, end + 1).join("\n")}\n`;
    writeFileSync(
      join(S.d!, "card-fencedtwice.md"),
      `${S.card!}\nMore prose.\n\n\`\`\`\n${copy}\`\`\`\n`,
    );
    check(
      ["card-results", S.d!, S.w!, join(S.d!, "checkpoint.md"), join(S.d!, "card-fencedtwice.md")],
      1,
      "landing: card: holds the expected block more than once",
    );
  });

  test("a commented-out block is an input fault", () => {
    const commented = S.card!.replace("## Checks\n", "<!--\n## Checks\n").replace(
      "- [P2] sec-2\n",
      "- [P2] sec-2\n-->\n",
    );
    writeFileSync(join(S.d!, "card-commented.md"), commented);
    check(
      ["card-results", S.d!, S.w!, join(S.d!, "checkpoint.md"), join(S.d!, "card-commented.md")],
      1,
      "landing: card: contains an HTML comment",
    );
  });

  test("a block inside an unclosed comment is an input fault", () => {
    writeFileSync(
      join(S.d!, "card-unclosed.md"),
      S.card!.replace("## Checks\n", "<!--\n## Checks\n"),
    );
    check(
      ["card-results", S.d!, S.w!, join(S.d!, "checkpoint.md"), join(S.d!, "card-unclosed.md")],
      1,
      "landing: card: contains an HTML comment",
    );
  });

  test("closing hashes on the block are an input fault", () => {
    writeFileSync(join(S.d!, "card-hashes.md"), S.card!.replace("## Checks\n", "## Checks ##\n"));
    check(
      ["card-results", S.d!, S.w!, join(S.d!, "checkpoint.md"), join(S.d!, "card-hashes.md")],
      1,
      "landing: card: does not hold the expected block",
    );
  });

  test("a repeated block is an input fault", () => {
    const lines = S.card!.split("\n");
    const { start, end } = blockRange(S.card!);
    const copy = `${lines.slice(start, end + 1).join("\n")}\n`;
    writeFileSync(join(S.d!, "card-repeated.md"), `${S.card!}\nMore prose.\n\n${copy}`);
    check(
      ["card-results", S.d!, S.w!, join(S.d!, "checkpoint.md"), join(S.d!, "card-repeated.md")],
      1,
      "landing: card: holds the expected block more than once",
    );
  });

  test("a card missing the block is an input fault", () => {
    const lines = S.card!.split("\n");
    const { start, end } = blockRange(S.card!);
    writeFileSync(
      join(S.d!, "card-noblock.md"),
      lines.filter((_, i) => i < start || i > end).join("\n"),
    );
    check(
      ["card-results", S.d!, S.w!, join(S.d!, "checkpoint.md"), join(S.d!, "card-noblock.md")],
      1,
      "landing: card: does not hold the expected block",
    );
  });

  test("a comment anywhere in the card is an input fault", () => {
    writeFileSync(
      join(S.d!, "card-note.md"),
      S.card!.replace("Some prose.", "Some prose <!-- a note -->."),
    );
    check(
      ["card-results", S.d!, S.w!, join(S.d!, "checkpoint.md"), join(S.d!, "card-note.md")],
      1,
      "landing: card: contains an HTML comment",
    );
  });
});

describe("card-findings", () => {
  const findings = (cp: string): string[] => [
    "card-findings",
    S.d!,
    S.w!,
    cp,
    join(S.d!, "card.md"),
  ];

  test("W9: a duplicate id in the checkpoint is an input fault", () => {
    check(findings(join(S.d!, "cp-dup.md")), 1, "landing: checkpoint: bug-1: listed twice");
  });

  test("a fence marker line in the checkpoint is an input fault", () => {
    writeFileSync(
      join(S.d!, "cp-fence.md"),
      checkpoint(
        "## Findings (bug)",
        "",
        "- [P2] bug-2: closed round 1",
        "",
        "```",
        "## Example",
        "",
        "- [P1] ex-1: open",
        "```",
      ),
    );
    check(findings(join(S.d!, "cp-fence.md")), 1, "landing: checkpoint: fence marker line: ```");
  });

  test("an example bullet inside a fence is refused with its markers", () => {
    writeFileSync(
      join(S.d!, "cp-fbullet.md"),
      checkpoint(
        "## Findings (bug)",
        "",
        "- [P2] bug-2: closed round 1",
        "",
        "```",
        "- [P1] ex-1: open",
        "```",
      ),
    );
    check(findings(join(S.d!, "cp-fbullet.md")), 1, "landing: checkpoint: fence marker line: ```");
  });

  test("an item fence marker line is an input fault", () => {
    writeFileSync(
      join(S.d!, "cp-itemfence.md"),
      checkpoint(
        "## Findings (bug)",
        "",
        "- [P2] bug-2: closed round 1",
        "",
        "1. ```",
        "- [P1] ex-9: open",
        "```",
        "```",
      ),
    );
    check(
      findings(join(S.d!, "cp-itemfence.md")),
      1,
      "landing: checkpoint: fence marker line: 1. ```",
    );
  });

  test("a list-column fence marker line is an input fault", () => {
    writeFileSync(
      join(S.d!, "cp-listfence.md"),
      checkpoint(
        "## Findings (bug)",
        "",
        "- [P2] bug-2: closed round 1",
        "",
        "    ```",
        "    - [P1] ex-9: open",
        "    ```",
      ),
    );
    check(
      findings(join(S.d!, "cp-listfence.md")),
      1,
      "landing: checkpoint: fence marker line: ```",
    );
  });

  test("a fence marker outside the findings list is still an input fault", () => {
    writeFileSync(
      join(S.d!, "cp-prosefence.md"),
      checkpoint(
        "# Notes",
        "",
        "Some prose.",
        "",
        "```",
        "quoted",
        "```",
        "",
        "## Findings (bug)",
        "",
        "- [P2] bug-2: closed round 1",
      ),
    );
    check(
      findings(join(S.d!, "cp-prosefence.md")),
      1,
      "landing: checkpoint: fence marker line: ```",
    );
  });

  test("a nested fence marker line is an input fault", () => {
    writeFileSync(
      join(S.d!, "cp-nest.md"),
      checkpoint(
        "## Findings (bug)",
        "",
        "- [P2] bug-2: closed round 1",
        "",
        "````",
        "- [P1] ghost: inside",
        "```",
        "- [P1] bug-1: open",
        "````",
      ),
    );
    check(findings(join(S.d!, "cp-nest.md")), 1, "landing: checkpoint: fence marker line: ````");
  });

  test("Y2: a comment anywhere in the checkpoint is an input fault", () => {
    const p = extendCp("cp-comment.md", "<!-- hidden -->");
    check(findings(p), 1, "landing: checkpoint: contains an HTML comment");
  });

  test("Y2: an unclosed comment in the checkpoint is an input fault", () => {
    const p = extendCp("cp-unclosed.md", "<!-- unclosed");
    check(findings(p), 1, "landing: checkpoint: contains an HTML comment");
  });

  test("Y4: a finding-shaped line with a bad severity is an input fault", () => {
    const p = extendCp("cp-p4.md", "- [P4] bug-9: open");
    check(findings(p), 1, "landing: checkpoint: not a finding: - [P4] bug-9: open");
  });

  test("Y4: a finding-shaped line with no state is an input fault", () => {
    const p = extendCp("cp-nostate.md", "- [P1] bug-9");
    check(findings(p), 1, "landing: checkpoint: not a finding: - [P1] bug-9");
  });

  test("Z5: a plus-bullet finding-shaped line is an input fault", () => {
    const p = extendCp("cp-plus.md", "+ [P1] bug-9: open");
    check(findings(p), 1, "landing: checkpoint: not a finding: + [P1] bug-9: open");
  });

  test("AA4: a numbered finding-shaped line is an input fault", () => {
    const p = extendCp("cp-numbered.md", "1. [P1] bug-9: open");
    check(findings(p), 1, "landing: checkpoint: not a finding: 1. [P1] bug-9: open");
  });

  test("AA4: a bare finding-shaped line is an input fault", () => {
    const p = extendCp("cp-bare.md", "[P2] bug-8: open");
    check(findings(p), 1, "landing: checkpoint: not a finding: [P2] bug-8: open");
  });

  test("AB3: a link reference is prose, not a finding", () => {
    const p = extendCp("cp-linkref.md", "[spec]: https://example.com/spec");
    check(findings(p), 0, "match");
  });

  test("AB3: a numbered link is prose, not a finding", () => {
    const p = extendCp("cp-numlink.md", "1. [roundup](https://example.com)");
    check(findings(p), 0, "match");
  });

  test("AC5: a severity link is prose, not a finding", () => {
    const p = extendCp("cp-sevlink.md", "[P1](https://example.com/p1) is the paper.");
    check(findings(p), 0, "match");
  });

  test("AC5: a numbered severity link is prose, not a finding", () => {
    const p = extendCp("cp-numsevlink.md", "1. [P1](https://example.com)");
    check(findings(p), 0, "match");
  });

  test("AC5: a severity link reference is prose, not a finding", () => {
    const p = extendCp("cp-sevref.md", "[P1]: https://example.com/p1");
    check(findings(p), 0, "match");
  });

  test("AC5: a severity sentence is prose, not a finding", () => {
    const p = extendCp("cp-sevsent.md", "[P1] and [P2] are discussed above.");
    check(findings(p), 0, "match");
  });

  test("AC5: a bare stateless finding shape still faults", () => {
    const p = extendCp("cp-barestate.md", "[P1] bug-9");
    check(findings(p), 1, "landing: checkpoint: not a finding: [P1] bug-9");
  });

  test("AC5: a numbered stateless finding shape still faults", () => {
    const p = extendCp("cp-numstate.md", "1. [P1] bug-9");
    check(findings(p), 1, "landing: checkpoint: not a finding: 1. [P1] bug-9");
  });

  test("an unreadable checkpoint state is an input fault", () => {
    const p = extendCp("cp-badstate.md", "- [P1] bug-9: someday");
    check(findings(p), 1, "landing: checkpoint: bug-9: unreadable state: someday");
  });
});

describe("card-open", () => {
  test("an open P1 is named", () => {
    check(["card-open", join(S.d!, "checkpoint.md")], 0, "- [P1] bug-1");
  });

  test("all closed prints none", () => {
    writeFileSync(
      join(S.d!, "cp-allclosed.md"),
      checkpoint("## Findings (bug)", "", "- [P2] bug-2: closed round 1"),
    );
    check(["card-open", join(S.d!, "cp-allclosed.md")], 0, "none");
  });

  test("open P3 residue prints none", () => {
    writeFileSync(
      join(S.d!, "cp-p3open.md"),
      checkpoint("## Findings (bug)", "", "- [P3] bug-9: open"),
    );
    check(["card-open", join(S.d!, "cp-p3open.md")], 0, "none");
  });

  test("a quoted finding is an input fault", () => {
    writeFileSync(
      join(S.d!, "cp-quoted.md"),
      checkpoint("## Findings (bug)", "", "> - [P1] bug-9: open"),
    );
    check(
      ["card-open", join(S.d!, "cp-quoted.md")],
      1,
      "landing: checkpoint: quoted line: > - [P1] bug-9: open",
    );
  });

  test("a nested quoted finding is an input fault", () => {
    writeFileSync(
      join(S.d!, "cp-nested.md"),
      checkpoint("## Findings (bug)", "", ">> - [P1] bug-9: open"),
    );
    check(
      ["card-open", join(S.d!, "cp-nested.md")],
      1,
      "landing: checkpoint: quoted line: >> - [P1] bug-9: open",
    );
  });

  test("a quoted fence is an input fault", () => {
    writeFileSync(
      join(S.d!, "cp-qfence.md"),
      checkpoint("## Findings (bug)", "", "> ```", "> - [P1] bug-9: open", "> ```"),
    );
    check(["card-open", join(S.d!, "cp-qfence.md")], 1, "landing: checkpoint: quoted line: > ```");
  });
});

describe("journey", () => {
  const journey = (waybill: string): string[] => ["journey", S.j!, S.jw!, waybill];

  test("no check using web-journey is clear", () => {
    writeFileSync(join(S.d!, "jchecks.json"), GATE_JOURNEY_CHECKS);
    S.j = join(tmp, "jd");
    mkdirSync(S.j);
    copyFileSync(join(S.d!, "jchecks.json"), join(S.j, "checks.json"));
    S.jw = join(tmp, "jwt");
    mkrepo(S.jw);
    commitFile(S.jw, "f", "X", "X");
    S.jsha12 = short(sha(S.jw));
    const jr = run(join(HERE, "run"), ["verify", "journey-path", S.jw, S.j]);
    if (jr.code !== 0) throw new Error(`journey-path failed: ${jr.err}`);
    S.jrep = strip(jr.out);
    writeFileSync(join(S.j, "plain.md"), "# T\n\n## Problem / feature\nA change.\n");
    writeFileSync(
      join(S.j, "journey.md"),
      "# T\n\n## Problem / feature\nA change.\n\n## User journey\n1. Open it.\n",
    );
    writeFileSync(join(S.j, "actions.jsonl"), action("gate", `main@${S.jsha12}`, "pass", 0));
    writeFileSync(join(tmp, "nj.json"), GATE_CHECKS);
    S.nj = join(tmp, "njd");
    mkdirSync(S.nj);
    copyFileSync(join(tmp, "nj.json"), join(S.nj, "checks.json"));
    copyFileSync(join(S.j, "actions.jsonl"), join(S.nj, "actions.jsonl"));
    check(["journey", S.nj, S.jw, join(S.j, "journey.md")], 0, "clear: no check uses web-journey");
  });

  test("AE5: no mentioned journey is judged, not blocked", () => {
    check(
      journey(join(S.j!, "plain.md")),
      0,
      "judge: no user journey mentioned; journey judged like any other non-pass",
    );
  });

  test("a missing report blocks", () => {
    check(
      journey(join(S.j!, "journey.md")),
      2,
      `blocked: journey: no journey report at ${S.jrep!}`,
    );
  });

  test("a journey that did not run blocks with its report written", () => {
    mkdirSync(dirname(S.jrep!), { recursive: true });
    writeFileSync(S.jrep!, "walked\n");
    check(
      journey(join(S.j!, "journey.md")),
      2,
      "blocked: journey: not run; the journey has no evidence",
    );
  });

  test("a logged not run blocks", () => {
    appendFileSync(
      join(S.j!, "actions.jsonl"),
      action("journey", `main@${S.jsha12!}`, "not-run", 3),
    );
    check(
      journey(join(S.j!, "journey.md")),
      2,
      "blocked: journey: not run; the journey has no evidence",
    );
  });

  test("V10: a trailing colon still names the section", () => {
    writeFileSync(
      join(S.j!, "colon.md"),
      "# T\n\n## Problem / feature\nA change.\n\n## User journey:\n1. Open it.\n",
    );
    check(
      journey(join(S.j!, "colon.md")),
      2,
      "blocked: journey: not run; the journey has no evidence",
    );
  });

  test("W10: a trailing full stop still names the section", () => {
    writeFileSync(
      join(S.j!, "dot.md"),
      "# T\n\n## Problem / feature\nA change.\n\n## User journey.\n1. Open it.\n",
    );
    check(
      journey(join(S.j!, "dot.md")),
      2,
      "blocked: journey: not run; the journey has no evidence",
    );
  });

  test("journey-phrase: extra heading words still hold the phrase", () => {
    writeFileSync(
      join(S.j!, "other.md"),
      "# T\n\n## Problem / feature\nA change.\n\n## User journey log\n1. Open it.\n",
    );
    check(
      journey(join(S.j!, "other.md")),
      2,
      "blocked: journey: not run; the journey has no evidence",
    );
  });

  test("fail-closed: a fenced User journey blocks", () => {
    writeFileSync(
      join(S.j!, "fenced.md"),
      "# T\n\n## Problem / feature\nA change.\n\n```\n## User journey\n1. Open it.\n```\n",
    );
    check(
      journey(join(S.j!, "fenced.md")),
      2,
      "blocked: journey: not run; the journey has no evidence",
    );
  });

  test("fail-closed: a commented-out User journey blocks", () => {
    writeFileSync(
      join(S.j!, "commented.md"),
      "# T\n\n## Problem / feature\nA change.\n\n<!--\n## User journey\n1. Open it.\n-->\n",
    );
    check(
      journey(join(S.j!, "commented.md")),
      2,
      "blocked: journey: not run; the journey has no evidence",
    );
  });

  test("Z4: a fence inside a comment does not hide the journey", () => {
    writeFileSync(
      join(S.j!, "fencecomment.md"),
      "# T\n\n## Problem / feature\nA change.\n\n<!--\n```\n-->\n\n## User journey\n1. Open it.\n",
    );
    check(
      journey(join(S.j!, "fencecomment.md")),
      2,
      "blocked: journey: not run; the journey has no evidence",
    );
  });

  test("fail-closed: a same-line remainder blocks", () => {
    writeFileSync(
      join(S.j!, "sameline.md"),
      "# T\n\n## Problem / feature\nA change.\n\n<!-- note --> ## User journey\n1. Open it.\n",
    );
    check(
      journey(join(S.j!, "sameline.md")),
      2,
      "blocked: journey: not run; the journey has no evidence",
    );
  });

  test("a comment inside the heading leaves it a heading", () => {
    writeFileSync(
      join(S.j!, "trailcomment.md"),
      "# T\n\n## Problem / feature\nA change.\n\n## User journey <!-- draft -->\n1. Open it.\n",
    );
    check(
      journey(join(S.j!, "trailcomment.md")),
      2,
      "blocked: journey: not run; the journey has no evidence",
    );
  });

  test("a comment between the hashes and the words leaves it a heading", () => {
    writeFileSync(
      join(S.j!, "midcomment.md"),
      "# T\n\n## Problem / feature\nA change.\n\n# <!-- -->User journey\n1. Open it.\n",
    );
    check(
      journey(join(S.j!, "midcomment.md")),
      2,
      "blocked: journey: not run; the journey has no evidence",
    );
  });

  test("a comment opener inside a fence does not eat the journey", () => {
    writeFileSync(
      join(S.j!, "fenceliteral.md"),
      "# T\n\n## Problem / feature\nA change.\n\n```\nWrite <!-- to open\n```\n\n" +
        "## User journey\n1. Open it.\n\n<!-- done -->\n",
    );
    check(
      journey(join(S.j!, "fenceliteral.md")),
      2,
      "blocked: journey: not run; the journey has no evidence",
    );
  });

  test("AB1: indented code does not hide the journey", () => {
    writeFileSync(
      join(S.j!, "indfence.md"),
      "# T\n\n## Problem / feature\nA change.\n\n    ```\n    literal indented text\n\n" +
        "## User journey\n1. Open it.\n",
    );
    check(
      journey(join(S.j!, "indfence.md")),
      2,
      "blocked: journey: not run; the journey has no evidence",
    );
  });

  test("AB7: an unreadable waybill fails the delegation without a verdict", () => {
    // The base wants `ticket-check: cannot read <path>`; the deployed ticket-check port
    // appends its strerror detail, which landing forwards byte-for-byte as the base does.
    const missing = join(tmp, "does-not-exist.md");
    const r = sh(journey(missing));
    expect(r.code).toBe(1);
    expect(r.out).toBe(
      "landing: ticket-check --has-journey gave no verdict: " +
        `ticket-check: cannot read ${missing}: ENOENT: no such file or directory, open '${missing}'`,
    );
  });

  test("Y6: an indented User journey still names the section", () => {
    writeFileSync(
      join(S.j!, "indented.md"),
      "# T\n\n## Problem / feature\nA change.\n\n   ## User journey\n1. Open it.\n",
    );
    check(
      journey(join(S.j!, "indented.md")),
      2,
      "blocked: journey: not run; the journey has no evidence",
    );
  });

  test("a failed journey with its report is judged", () => {
    appendFileSync(
      join(S.j!, "actions.jsonl"),
      action("journey", `main@${S.jsha12!}`, "fail", 1, "2026-01-01T00:00:01Z"),
    );
    check(
      journey(join(S.j!, "journey.md")),
      0,
      `judge: journey failed with its report at ${S.jrep!}; weigh it`,
    );
  });

  test("a walked journey is clear", () => {
    appendFileSync(
      join(S.j!, "actions.jsonl"),
      action("journey", `main@${S.jsha12!}`, "pass", 0, "2026-01-01T00:00:02Z"),
    );
    check(journey(join(S.j!, "journey.md")), 0, `clear: journey walked: report at ${S.jrep!}`);
  });
});

describe("pure pins", () => {
  test("findingState reads the four states", () => {
    expect(findingState("open")).toBe("open");
    expect(findingState("closed round 2")).toBe("closed");
    expect(findingState("closed round 007")).toBe("closed");
    expect(findingState("closed round \u0662")).toBe("closed");
    expect(findingState("dismissed: not reachable")).toBe("dismissed");
    expect(findingState("dismissed:  spaced  ")).toBe("dismissed");
    expect(findingState("applied on user word, not re-reviewed")).toBe("user-applied");
  });

  test("findingState rejects near-states", () => {
    expect(findingState("someday")).toBeNull();
    expect(findingState("Open")).toBeNull();
    expect(findingState("open ")).toBeNull();
    expect(findingState("closed round two")).toBeNull();
    expect(findingState("closed round 2 ")).toBeNull();
    expect(findingState("closed  round 2")).toBeNull();
    expect(findingState("dismissed:")).toBeNull();
    expect(findingState("dismissed : r")).toBeNull();
    expect(findingState("")).toBeNull();
  });

  test("isFindingShaped matches the base's numbered and bare shapes", () => {
    expect(isFindingShaped("1. [P1] bug-9: open")).toBe(true);
    expect(isFindingShaped("[P2] bug-8: open")).toBe(true);
    expect(isFindingShaped("[p1] bare-lower: open")).toBe(true);
    expect(isFindingShaped("1. [P1] bug-9")).toBe(true);
    expect(isFindingShaped("- [P1] bug-9: open")).toBe(false);
    expect(isFindingShaped("[spec]: https://example.com/spec")).toBe(false);
    expect(isFindingShaped("[P1](https://example.com/p1) is the paper.")).toBe(false);
    expect(isFindingShaped("[P1] and [P2] are discussed above.")).toBe(false);
    expect(isFindingShaped("[P1] \u212a: open")).toBe(false);
    expect(isFindingShaped("[P1] \u017f: open")).toBe(false);
  });

  test("pyRepr quotes like Python", () => {
    expect(pyRepr("foo")).toBe("'foo'");
    expect(pyRepr("a'b")).toBe('"a\'b"');
    expect(pyRepr('a"b')).toBe("'a\"b'");
    expect(pyRepr("a\nb")).toBe("'a\\nb'");
    expect(pyRepr("a\\b")).toBe("'a\\\\b'");
    expect(pyRepr("\x00")).toBe("'\\x00'");
    expect(pyRepr("\x7f")).toBe("'\\x7f'");
    expect(pyRepr("caf\u00e9")).toBe("'caf\u00e9'");
  });
});

describe("pr-checks at the card's head", () => {
  const restoreEnv = (key: string, value: string | undefined): void => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };

  // A stand-in gh, first on PATH: it answers what the scenario sets, so every
  // branch of the question is checked without a live pull request.
  const standInGh = (dir: string): void => {
    mkdirSync(dir, { recursive: true });
    const gh = join(dir, "gh");
    writeFileSync(
      gh,
      [
        "#!/bin/sh",
        'case "$1 $2" in',
        '  "pr view") printf \'{"headRefOid":"%s"}\\n\' "$FAKE_PR_HEAD" ;;',
        '  "pr checks") printf \'%s\\n\' "$FAKE_PR_CHECKS" ;;',
        '  *) echo "stand-in gh: unexpected: $*" >&2; exit 1 ;;',
        "esac",
        "",
      ].join("\n"),
    );
    chmodSync(gh, 0o755);
  };

  test("all passed is pass, one running is pending, one failed is fail with its name and link, no checks is none", () => {
    const repo = join(tmp, "prgh-repo");
    mkrepo(repo);
    commitFile(repo, "a", "one", "A");
    const head = sha(repo);
    const bin = join(tmp, "prgh-bin");
    standInGh(bin);
    const savedPath = process.env.PATH;
    const savedHead = process.env.FAKE_PR_HEAD;
    const savedChecks = process.env.FAKE_PR_CHECKS;
    process.env.PATH = `${bin}:${savedPath ?? ""}`;
    process.env.FAKE_PR_HEAD = head;
    try {
      const args = ["pr-checks", "--repo", repo, "--head", head, "--pr", "7"];
      process.env.FAKE_PR_CHECKS = JSON.stringify([
        { name: "linux", state: "SUCCESS", bucket: "pass", link: "https://ci/1" },
        { name: "macos", state: "SUCCESS", bucket: "pass", link: "https://ci/2" },
      ]);
      check(args, 0, "pass");

      process.env.FAKE_PR_CHECKS = JSON.stringify([
        { name: "linux", state: "SUCCESS", bucket: "pass", link: "https://ci/1" },
        { name: "macos", state: "IN_PROGRESS", bucket: "pending", link: "https://ci/2" },
      ]);
      check(args, 0, "pending");

      process.env.FAKE_PR_CHECKS = JSON.stringify([
        { name: "linux", state: "FAILURE", bucket: "fail", link: "https://ci/1" },
        { name: "macos", state: "SUCCESS", bucket: "pass", link: "https://ci/2" },
      ]);
      check(args, 2, "fail: linux https://ci/1");

      process.env.FAKE_PR_CHECKS = "[]";
      check(args, 0, "none");
    } finally {
      restoreEnv("PATH", savedPath);
      restoreEnv("FAKE_PR_HEAD", savedHead);
      restoreEnv("FAKE_PR_CHECKS", savedChecks);
    }
  }, 30000);

  test("checks reported for another head never say pass", () => {
    const repo = join(tmp, "prgh-other");
    mkrepo(repo);
    commitFile(repo, "a", "one", "A");
    const cardHead = sha(repo);
    commitFile(repo, "b", "two", "B");
    const movedHead = sha(repo);
    const bin = join(tmp, "prgh-bin2");
    standInGh(bin);
    const savedPath = process.env.PATH;
    const savedHead = process.env.FAKE_PR_HEAD;
    const savedChecks = process.env.FAKE_PR_CHECKS;
    process.env.PATH = `${bin}:${savedPath ?? ""}`;
    process.env.FAKE_PR_HEAD = movedHead;
    process.env.FAKE_PR_CHECKS = JSON.stringify([
      { name: "linux", state: "SUCCESS", bucket: "pass", link: "https://ci/1" },
    ]);
    try {
      check(["pr-checks", "--repo", repo, "--head", cardHead, "--pr", "7"], 0, "pending");
    } finally {
      restoreEnv("PATH", savedPath);
      restoreEnv("FAKE_PR_HEAD", savedHead);
      restoreEnv("FAKE_PR_CHECKS", savedChecks);
    }
  }, 30000);

  test("with no pull request to ask it says none, as the local route reads", () => {
    const repo = join(tmp, "prgh-none");
    mkrepo(repo);
    commitFile(repo, "a", "one", "A");
    check(["pr-checks", "--repo", repo, "--head", sha(repo)], 0, "none");
  }, 30000);
});
