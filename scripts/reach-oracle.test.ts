// Blind acceptance tests for #202: one case per check the ticket's interface pins.
// Each case builds a fresh run layout, runs the ticket's commands, and matches only what
// the ticket pins: exits, named paths, the degrade line, the card section. Output wording
// beyond that is the lane's to choose and is never matched. See reach-oracle.ts for what
// a blind test cannot cover and why.
import { expect, test } from "bun:test";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  both,
  codexCmd,
  codexFileChange,
  flat,
  git,
  headOf,
  landing,
  makeLayout,
  mimoBash,
  need,
  reach,
  readActions,
  refOf,
} from "./reach-oracle";
import type { Layout, Run } from "./reach-oracle";

const REPO = realpathSync(join(import.meta.dir, ".."));

function oracle(name: string, fn: (lay: Layout) => void, timeout = 120000): void {
  test(
    name,
    () => {
      const lay = makeLayout(REPO);
      try {
        fn(lay);
      } finally {
        lay.cleanup();
      }
    },
    timeout,
  );
}

function expectExit(r: Run, want: number): void {
  if (r.code !== want) {
    throw new Error(
      `want exit ${want}, got ${r.code}\n--- out ---\n${r.out}\n--- err ---\n${r.err}`,
    );
  }
  // A counted assertion, not just a throw: a test whose only checks throw
  // reports zero assertions and reads as vacuous.
  expect(r.code).toBe(want);
}

// C10c/D4 pins the degrade lines, not the exit: an unexplained move voids every verdict
// without being any lane's finding, so 2 (a finding recorded) and 3 (notes only) are both
// ticket-consistent. The cases that hit it accept either and pin the degrades and naming.
function expectExitIn(r: Run, wants: number[]): void {
  if (!wants.includes(r.code)) {
    throw new Error(
      `want exit ${wants.join(" or ")}, got ${r.code}\n--- out ---\n${r.out}\n--- err ---\n${r.err}`,
    );
  }
  // Counted like expectExit above: the pin is an assertion either way.
  expect(wants.includes(r.code)).toBe(true);
}

function locateUnder(dir: string, base: string): string | null {
  if (!existsSync(dir)) return null;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (e === base) return p;
    if (statSync(p).isDirectory()) {
      const hit = locateUnder(p, base);
      if (hit !== null) return hit;
    }
  }
  return null;
}

function contentUnder(dir: string, text: string): boolean {
  if (!existsSync(dir)) return false;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (contentUnder(p, text)) return true;
    } else if (readFileSync(p, "utf8").includes(text)) {
      return true;
    }
  }
  return false;
}

function scratchCommit(scratch: string, message: string): string {
  writeFileSync(join(scratch, "fix.txt"), "fix\n");
  need(git("-C", scratch, "add", "fix.txt"), "add fix");
  need(git("-C", scratch, "commit", "-qm", message), "commit fix");
  return headOf(scratch);
}

oracle("C1: check workhorses exits 0 on a clean layout", (lay) => {
  expectExit(reach(REPO, lay.home, "check", lay.dispatch, "workhorses"), 0);
});

oracle("C1: before, check r1 and check card exit 0 on a clean layout", (lay) => {
  expectExit(reach(REPO, lay.home, "before", lay.dispatch, "1"), 0);
  expectExit(reach(REPO, lay.home, "check", lay.dispatch, "r1"), 0);
  expectExit(reach(REPO, lay.home, "check", lay.dispatch, "card"), 0);
});

oracle("C2: every point records one reach line reading clean", (lay) => {
  expectExit(reach(REPO, lay.home, "check", lay.dispatch, "workhorses"), 0);
  expectExit(reach(REPO, lay.home, "before", lay.dispatch, "1"), 0);
  expectExit(reach(REPO, lay.home, "check", lay.dispatch, "r1"), 0);
  expectExit(reach(REPO, lay.home, "check", lay.dispatch, "card"), 0);
  const lines = readActions(lay.dispatch)
    .filter((l) => l.action === "reach")
    .map(flat);
  for (const point of ["workhorses", "r1", "card"]) {
    const hit = lines.filter((l) => l.includes(point));
    expect(hit.length).toBeGreaterThanOrEqual(1);
    for (const l of hit) expect(l).toContain("clean");
  }
});

oracle("C3: main-checkout dirt names all 26 paths at every point, exit 2", (lay) => {
  const names: string[] = [];
  for (let i = 0; i < 24; i++) {
    const n = `u${String(i).padStart(2, "0")}.txt`;
    writeFileSync(join(lay.repo, n), "untracked\n");
    names.push(n);
  }
  mkdirSync(join(lay.repo, "probe"), { recursive: true });
  writeFileSync(join(lay.repo, "probe", "a.txt"), "untracked\n");
  appendFileSync(join(lay.repo, "README.md"), "tracked change\n");
  names.push("probe/a.txt", "README.md");
  const trackedBefore = refOf(lay.repo, "refs/remotes/origin/main");
  expectExit(reach(REPO, lay.home, "before", lay.dispatch, "1"), 0);
  let card = "";
  for (const point of ["workhorses", "r1", "card"]) {
    const r = reach(REPO, lay.home, "check", lay.dispatch, point);
    expectExit(r, 2);
    expect(both(r)).toContain("probe/a.txt");
    if (point === "card") card = both(r);
  }
  for (const n of names) expect(card).toContain(n);
  expect(refOf(lay.repo, "refs/remotes/origin/main")).toBe(trackedBefore);
});

oracle("C4: a checkout off its default branch is named, exit 2", (lay) => {
  need(git("-C", lay.repo, "checkout", "-qb", "x"), "switch branch");
  const r = reach(REPO, lay.home, "check", lay.dispatch, "card");
  expectExit(r, 2);
  expect(both(r)).toContain("x");
});

oracle("C4: the default branch moving forward reads clean, exit 0", (lay) => {
  writeFileSync(join(lay.repo, "forward.txt"), "forward\n");
  need(git("-C", lay.repo, "add", "forward.txt"), "add forward");
  need(git("-C", lay.repo, "commit", "-qm", "forward"), "commit forward");
  expectExit(reach(REPO, lay.home, "check", lay.dispatch, "card"), 0);
});

oracle("C5/D6: the #200 merge event is a note naming the synthesis worktree", (lay) => {
  const sha = headOf(lay.synth);
  const cmd =
    `git -C ${lay.synth} status --short && git -C ${lay.synth} merge --ff-only ${sha} && ` +
    `git -C ${lay.synth} log --oneline -3`;
  const stream = join(lay.logs, "oracle-merge.jsonl");
  writeFileSync(stream, `${mimoBash(cmd, `Updating ${sha}..${sha}\nFast-forward\n`, 0)}\n`);
  const r = reach(REPO, lay.home, "stream", lay.dispatch, "mimo", stream, lay.mimoScratch);
  expectExit(r, 3);
  expect(both(r)).toContain(".worktrees/T");
  expect(both(r)).toContain("synthesis");
  expect(both(r)).not.toContain("finding");
});

oracle("C7: reads, refused attempts and unknown tools are notes, exit 3", (lay) => {
  writeFileSync(join(lay.home, "n.txt"), "note\n");
  writeFileSync(join(lay.repo, "q.txt"), "note\n");
  const stream = join(lay.logs, "oracle-notes.jsonl");
  writeFileSync(
    stream,
    `${mimoBash("cat ~/n.txt", "note\n", 0)}\n` +
      `${mimoBash(`some-tool ${join(lay.repo, "q.txt")}`, "", 0)}\n` +
      `${mimoBash(`echo x > ${join(lay.repo, "o.txt")}`, "bash: o.txt: Permission denied", 1)}\n`,
  );
  const r = reach(REPO, lay.home, "stream", lay.dispatch, "mimo", stream, lay.mimoScratch);
  expectExit(r, 3);
  expect(both(r)).toContain("n.txt");
  expect(both(r)).toContain("q.txt");
  expect(both(r)).toContain("o.txt");
  expect(both(r)).not.toContain("finding");
});

oracle("C7: a named path with no observed change is a note, never a finding", (lay) => {
  writeFileSync(join(lay.repo, "p.txt"), "landed\n");
  const stream = join(lay.logs, "oracle-failed-write.jsonl");
  writeFileSync(stream, `${mimoBash(`echo x > ${join(lay.repo, "p.txt")}; false`, "", 1)}\n`);
  const r = reach(REPO, lay.home, "stream", lay.dispatch, "mimo", stream, lay.mimoScratch);
  expectExit(r, 3);
  expect(both(r)).toContain("p.txt");
});

oracle("C5: grok, unreadable and call-less streams read not checked, exit 3", (lay) => {
  const grokStream = join(lay.logs, "oracle-grok.jsonl");
  writeFileSync(grokStream, '{"type":"session_started","id":"g1"}\n');
  for (const [lane, stream] of [
    ["grok", grokStream],
    ["mimo", join(lay.logs, "oracle-missing.jsonl")],
  ]) {
    const r = reach(REPO, lay.home, "stream", lay.dispatch, lane, stream, lay.mimoScratch);
    expectExit(r, 3);
    expect(both(r)).toContain("not checked");
  }
  const quiet = join(lay.logs, "oracle-quiet.jsonl");
  writeFileSync(
    quiet,
    '{"type":"text","sessionID":"s9","part":{"type":"text","text":"just thinking"}}\n',
  );
  const r = reach(REPO, lay.home, "stream", lay.dispatch, "mimo", quiet, lay.mimoScratch);
  expectExit(r, 3);
  expect(both(r)).toContain("not checked");
});

oracle("C6/C10: a round-1 merge names the moved ref with both hashes, voids only mimo", (lay) => {
  expectExit(reach(REPO, lay.home, "before", lay.dispatch, "1"), 0);
  const tBefore = refOf(lay.repo, "refs/heads/T");
  const sBefore = headOf(lay.synth);
  const fix = scratchCommit(lay.mimoScratch, "reviewer fix");
  need(git("-C", lay.synth, "merge", "--ff-only", fix), "merge fix");
  const cmd =
    `git -C ${lay.synth} status --short && git -C ${lay.synth} merge --ff-only ${fix} && ` +
    `git -C ${lay.synth} log --oneline -3`;
  appendFileSync(
    join(lay.logs, "review-r1-bug-mimo.jsonl"),
    `${mimoBash(cmd, `Updating ${sBefore.slice(0, 7)}..${fix.slice(0, 7)}\nFast-forward\n`, 0)}\n`,
  );
  const r = reach(REPO, lay.home, "check", lay.dispatch, "r1");
  expectExit(r, 2);
  expect(both(r)).toContain("refs/heads/T");
  expect(both(r)).toContain(tBefore);
  expect(both(r)).toContain(fix);
  const degrades = readActions(lay.dispatch)
    .filter((l) => l.action === "degrade")
    .map(flat);
  expect(degrades.some((l) => l.includes("mimo") && l.includes("bug r1: reach"))).toBe(true);
  expect(degrades.some((l) => l.includes("codex"))).toBe(false);
});

oracle("C10: update-ref in a scratch voids only the lane that ran it", (lay) => {
  expectExit(reach(REPO, lay.home, "before", lay.dispatch, "1"), 0);
  const fix = scratchCommit(lay.mimoScratch, "reviewer fix");
  need(git("-C", lay.mimoScratch, "update-ref", "refs/heads/T", fix), "move T");
  appendFileSync(
    join(lay.logs, "review-r1-bug-mimo.jsonl"),
    `${mimoBash(`git update-ref refs/heads/T ${fix}`, "", 0)}\n`,
  );
  const r = reach(REPO, lay.home, "check", lay.dispatch, "r1");
  expectExit(r, 2);
  expect(both(r)).toContain("refs/heads/T");
  const degrades = readActions(lay.dispatch)
    .filter((l) => l.action === "degrade")
    .map(flat);
  expect(degrades.some((l) => l.includes("mimo") && l.includes("bug r1: reach"))).toBe(true);
  expect(degrades.some((l) => l.includes("codex"))).toBe(false);
});

oracle("C10/D4: an unexplained move voids every verdict of the round", (lay) => {
  expectExit(reach(REPO, lay.home, "before", lay.dispatch, "1"), 0);
  const fix = scratchCommit(lay.codexScratch, "unexplained fix");
  need(git("-C", lay.synth, "merge", "--ff-only", fix), "merge fix");
  const r = reach(REPO, lay.home, "check", lay.dispatch, "r1");
  expectExitIn(r, [2, 3]);
  const degrades = readActions(lay.dispatch)
    .filter((l) => l.action === "degrade")
    .map(flat);
  expect(degrades.some((l) => l.includes("mimo") && l.includes("bug r1: reach"))).toBe(true);
  expect(degrades.some((l) => l.includes("codex") && l.includes("bug r1: reach"))).toBe(true);
});

oracle("C6/C13: an unnamed untracked synth file is a note, and restore moves it out", (lay) => {
  expectExit(reach(REPO, lay.home, "before", lay.dispatch, "1"), 0);
  writeFileSync(join(lay.synth, "u.txt"), "stray\n");
  const r = reach(REPO, lay.home, "check", lay.dispatch, "r1");
  expectExit(r, 3);
  expect(both(r)).toContain("u.txt");
  expect(readActions(lay.dispatch).some((l) => l.action === "degrade")).toBe(false);
  expectExit(reach(REPO, lay.home, "restore", lay.dispatch, "r1"), 0);
  expect(existsSync(join(lay.synth, "u.txt"))).toBe(false);
  expect(locateUnder(join(lay.dispatch, "reach"), "u.txt")).not.toBeNull();
});

oracle("C11: restore puts the run's branches and synth back, and saves what it undid", (lay) => {
  expectExit(reach(REPO, lay.home, "before", lay.dispatch, "1"), 0);
  const tBefore = refOf(lay.repo, "refs/heads/T");
  const sBefore = headOf(lay.synth);
  const fix = scratchCommit(lay.mimoScratch, "reviewer fix");
  need(git("-C", lay.synth, "merge", "--ff-only", fix), "merge fix");
  writeFileSync(join(lay.synth, "u2.txt"), "stray\n");
  expectExitIn(reach(REPO, lay.home, "check", lay.dispatch, "r1"), [2, 3]);
  expectExit(reach(REPO, lay.home, "restore", lay.dispatch, "r1"), 0);
  expect(refOf(lay.repo, "refs/heads/T")).toBe(tBefore);
  expect(headOf(lay.synth)).toBe(sBefore);
  expect(existsSync(join(lay.synth, "u2.txt"))).toBe(false);
  const moved = locateUnder(join(lay.dispatch, "reach"), "u2.txt");
  expect(moved).not.toBeNull();
  expect(readFileSync(moved as string, "utf8")).toBe("stray\n");
  expect(contentUnder(join(lay.dispatch, "reach"), "fix.txt")).toBe(true);
});

oracle("C8: a workhorse finding fails check workhorses", (lay) => {
  writeFileSync(join(lay.repo, "out.txt"), "reached\n");
  appendFileSync(
    join(lay.logs, "codex-events.jsonl"),
    `${codexFileChange("item_9", join(lay.repo, "out.txt"))}\n`,
  );
  const r = reach(REPO, lay.home, "check", lay.dispatch, "workhorses");
  expectExit(r, 2);
  expect(both(r)).toContain("out.txt");
});

oracle("C8: a workhorse record with only a read is notes, exit 3", (lay) => {
  writeFileSync(
    join(lay.logs, "codex-events.jsonl"),
    `${codexCmd("item_1", `cat ${join(lay.repo, "README.md")}`, "oracle layout\n", 0)}\n`,
  );
  const r = reach(REPO, lay.home, "check", lay.dispatch, "workhorses");
  expectExit(r, 3);
});

oracle("C13: round/card-time main dirt degrades nothing", (lay) => {
  writeFileSync(join(lay.repo, "stray.txt"), "stray\n");
  appendFileSync(
    join(lay.logs, "review-r1-bug-mimo.jsonl"),
    `${mimoBash(`cat ${join(lay.repo, "README.md")}`, "oracle layout\n", 0)}\n`,
  );
  expectExit(reach(REPO, lay.home, "before", lay.dispatch, "1"), 0);
  expectExit(reach(REPO, lay.home, "check", lay.dispatch, "r1"), 2);
  expectExit(reach(REPO, lay.home, "check", lay.dispatch, "card"), 2);
  expect(readActions(lay.dispatch).some((l) => l.action === "degrade")).toBe(false);
});

oracle("C6: tags, remote refs and a moved-forward main are not named", (lay) => {
  expectExit(reach(REPO, lay.home, "before", lay.dispatch, "1"), 0);
  need(git("-C", lay.repo, "tag", "v1"), "tag");
  need(git("-C", lay.repo, "fetch", "-q", "origin"), "fetch");
  writeFileSync(join(lay.repo, "forward.txt"), "forward\n");
  need(git("-C", lay.repo, "add", "forward.txt"), "add forward");
  need(git("-C", lay.repo, "commit", "-qm", "forward"), "commit forward");
  expectExit(reach(REPO, lay.home, "check", lay.dispatch, "r1"), 0);
});

const GATE_CHECKS =
  '{"checks": [{"name": "gate", "source": "default:gate", "command": "true", "shows": "x"}]}\n';
const QUIET_CHECKPOINT = "## Findings (bug)\n\n- [P2] b1: closed round 1\n";

oracle("C14: card-block appends the ## Reach section from the run log", (lay) => {
  writeFileSync(join(lay.repo, "out.txt"), "reached\n");
  appendFileSync(
    join(lay.logs, "codex-events.jsonl"),
    `${codexFileChange("item_9", join(lay.repo, "out.txt"))}\n`,
  );
  mkdirSync(join(lay.home, "other"), { recursive: true });
  writeFileSync(join(lay.home, "other", "x"), "outside\n");
  appendFileSync(
    join(lay.logs, "codex-events.jsonl"),
    `${codexFileChange("item_10", join(lay.home, "other", "x"))}\n`,
  );
  expectExit(reach(REPO, lay.home, "check", lay.dispatch, "workhorses"), 2);
  expectExit(reach(REPO, lay.home, "before", lay.dispatch, "1"), 0);
  const fix = scratchCommit(lay.mimoScratch, "reviewer fix");
  need(git("-C", lay.synth, "merge", "--ff-only", fix), "merge fix");
  appendFileSync(
    join(lay.logs, "review-r1-bug-mimo.jsonl"),
    `${mimoBash(`git -C ${lay.synth} merge --ff-only ${fix}`, "Fast-forward\n", 0)}\n`,
  );
  expectExit(reach(REPO, lay.home, "check", lay.dispatch, "r1"), 2);
  expectExit(reach(REPO, lay.home, "check", lay.dispatch, "card"), 2);
  writeFileSync(join(lay.dispatch, "checks.json"), GATE_CHECKS);
  const cp = join(lay.dispatch, "cp.md");
  writeFileSync(cp, QUIET_CHECKPOINT);
  const card = landing(REPO, lay.home, "card-block", lay.dispatch, lay.synth, cp);
  expectExit(card, 0);
  expect(card.out).toContain("## Reach");
  expect(card.out).toContain("out.txt");
  expect(card.out).toContain("outside the project");
  expect(card.out).toContain("voided");
  expect(card.out).not.toContain(lay.home);
  expect(card.out).not.toContain(lay.repo);
  const kept = readFileSync(join(lay.dispatch, "actions.jsonl"), "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "" && !(l.includes('"reach"') && l.includes("card")));
  writeFileSync(join(lay.dispatch, "actions.jsonl"), `${kept.join("\n")}\n`);
  const card2 = landing(REPO, lay.home, "card-block", lay.dispatch, lay.synth, cp);
  expectExit(card2, 0);
  expect(card2.out).toContain("not checked");
});

oracle("C14: a dispatch with no reach line renders the block without ## Reach", (lay) => {
  writeFileSync(join(lay.dispatch, "checks.json"), GATE_CHECKS);
  const cp = join(lay.dispatch, "cp.md");
  writeFileSync(cp, QUIET_CHECKPOINT);
  const card = landing(REPO, lay.home, "card-block", lay.dispatch, lay.synth, cp);
  expectExit(card, 0);
  expect(card.out).not.toContain("## Reach");
});
