// Laws for the shell-command part of the reach check (ticket #202), written from the ticket alone.
//
// Every law builds the ticket's run layout in a fresh temporary folder: a repository `proj` on
// `main` with its dispatch folder, the synthesis worktree `.worktrees/<T>`, workhorse worktrees
// `.worktrees/<T>-<lane>`, review scratches `.worktrees/<T>-rev-<lens>-<lane>`, another run's
// worktree, and worktrees whose names begin like the synthesis worktree's and the lane's own; and
// beside the repository, the run's tool checkout and the lane's data folder. The lane's folder is
// one of the worktrees or scratches, and holds links to the synthesis worktree and the main
// checkout. `~` and `$HOME` are this process's home folder: nothing is created there, and every
// home path a law names is one nothing holds.
//
// A law generates many commands of one kind, asks commandTouches what they touch, and states what
// the ticket requires of the answer. The folder is removed when the law ends, pass or fail.

import {
  existsSync,
  lstatSync,
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
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as fc from "fast-check";
import { type Access, commandTouches, type Place, type RunInfo, type Touch } from "./classifier.ts";
import { sandboxed } from "./sandbox.ts";

// ---------------------------------------------------------------------------------------------
// Paths

/** The home folder this process sees: where `~` and `$HOME` lead. */
const HOME = resolve(homedir());
/** Makes the home paths the laws name ones that nothing holds. */
const TAG = `${process.pid.toString(36)}${Date.now().toString(36)}`;
const HERE = dirname(fileURLToPath(import.meta.url));

/** An absolute path with `.` and `..` resolved, read alike with or without macOS's /private. */
function norm(p: string): string {
  return resolve(p).replace(/^\/private(?=\/(?:etc|tmp|var)(?:\/|$))/, "");
}

function within(p: string, root: string): boolean {
  const a = norm(p);
  const b = norm(root);
  return a === b || a.startsWith(b === "/" ? b : `${b}/`);
}

/** The path with every link in the part of it that exists resolved. */
function canonical(p: string): string {
  let head = resolve(p);
  const tail: string[] = [];
  for (;;) {
    try {
      return join(realpathSync(head), ...tail);
    } catch {
      const up = dirname(head);
      if (up === head) return resolve(p);
      tail.unshift(basename(head));
      head = up;
    }
  }
}

/** The same path, written alike or reached through the same links. */
function samePath(a: string, b: string): boolean {
  return norm(a) === norm(b) || canonical(a) === canonical(b);
}

/** One of the two paths holds the other. */
function related(a: string, b: string): boolean {
  return within(a, b) || within(b, a);
}

function pick<T>(xs: readonly T[], i: number): T {
  const x = xs[Math.abs(i) % xs.length];
  if (x === undefined) throw new Error("nothing to pick from");
  return x;
}

// ---------------------------------------------------------------------------------------------
// Shell text

const PLAIN = /^[A-Za-z0-9._/+@%,:=-]+$/;

/** Text in single quotes, a single quote inside written '"'"' as Python's shlex.quote writes it. */
function sq(s: string): string {
  return `'${s.replaceAll("'", `'"'"'`)}'`;
}

/** Text in double quotes, or in single quotes when it holds something double quotes expand. */
function dq(s: string): string {
  return /["$`\\!]/.test(s) ? sq(s) : `"${s}"`;
}

/** Text as one shell word: bare when nothing in it needs quoting. */
function word(s: string): string {
  return PLAIN.test(s) ? s : sq(s);
}

/** codex's `/bin/bash -lc '…'` and a plain `bash -lc '…'`, an inner ' escaped '"'"' or '\''. */
const WRAPS: ReadonlyArray<(c: string) => string> = [
  (c) => `/bin/bash -lc ${sq(c)}`,
  (c) => `bash -lc ${sq(c)}`,
  (c) => `/bin/bash -lc '${c.replaceAll("'", `'\\''`)}'`,
  (c) => `bash -lc '${c.replaceAll("'", `'\\''`)}'`,
];

// ---------------------------------------------------------------------------------------------
// The run layout

interface Own {
  suffix: string;
  lane: string;
  lens?: string;
}

/** The lane's folder: a workhorse worktree, or a reviewer's scratch with the reviewer's lens. */
const OWNS: readonly Own[] = [
  { suffix: "-codex", lane: "codex" },
  { suffix: "-mimo", lane: "mimo" },
  { suffix: "-rev-bug-codex", lane: "codex", lens: "bug" },
  { suffix: "-rev-bug-mimo", lane: "mimo", lens: "bug" },
  { suffix: "-rev-style-claude", lane: "claude", lens: "style" },
  { suffix: "-rev-security-muse", lane: "muse", lens: "security" },
];

interface Layout {
  /** The run's own temporary folder, holding the repository. */
  root: string;
  /** The main checkout. */
  R: string;
  /** The ticket, which names the synthesis branch and worktree. */
  T: string;
  /** R/.worktrees */
  wt: string;
  /** The synthesis worktree. */
  S: string;
  /** The lane's own folder. */
  O: string;
  lane: string;
  lens: string | undefined;
  /** Every worktree but the synthesis worktree and the lane's own. */
  others: string[];
  /** The lane's own XDG_DATA_HOME, beside the repository. */
  data: string;
  /** What commandTouches is told of the run; its tool checkout is beside the repository. */
  info: RunInfo;
}

const WORKTREE_FILES = ["README.md", "src/a.ts", "src/b.ts", "a.ts", "in.txt", "my dir/notes.txt"];
const MAIN_FILES = ["README.md", "src/a.ts", "src/b.ts", "docs/guide.md", "my dir/notes.txt", ".worktrees-old/x.txt"];

function put(path: string, content = "a\nb\n"): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function makeLayout(base: string, t: number, own: number): Layout {
  const T = String(t);
  const choice = pick(OWNS, own);
  const root = realpathSync(mkdtempSync(join(base, "run-")));
  const R = join(root, "proj");
  const wt = join(R, ".worktrees");
  const S = join(wt, T);
  const N = `${T}${choice.suffix}`;
  const O = join(wt, N);
  const D = join(R, ".postmaster", "runs", T);
  for (const f of MAIN_FILES) put(join(R, f));
  put(join(R, ".gitignore"), ".postmaster/\n.worktrees/\n");
  put(join(R, ".git", "HEAD"), "ref: refs/heads/main\n");
  put(join(R, ".git", "config"), "[core]\n\trepositoryformatversion = 0\n");
  mkdirSync(join(R, ".git", "refs", "heads"), { recursive: true });
  const names = [
    T,
    `${T}-codex`,
    `${T}-mimo`,
    `${T}-rev-bug-codex`,
    `${T}-rev-bug-mimo`,
    `${T}-rev-style-claude`,
    `${T}-rev-security-muse`,
    `${T}0`,
    "42",
    `${N}2`,
  ];
  for (const name of names) {
    put(join(wt, name, ".git"), `gitdir: ${join(R, ".git", "worktrees", name)}\n`);
    for (const f of WORKTREE_FILES) put(join(wt, name, f));
  }
  for (let k = 0; k < 4; k += 1) put(join(O, `mv-${k}.txt`));
  symlinkSync(S, join(O, "syn"));
  symlinkSync(R, join(O, "up"));
  const tool = join(root, "tool");
  const data = join(root, "data", choice.lane);
  put(join(tool, "scripts", "reach.ts"), "export {};\n");
  mkdirSync(data, { recursive: true });
  const lanes = Object.fromEntries(
    ["codex", "claude", "muse", "mimo", "pi", "grok"].map((h) => [h, { harness: h, model: `${h}-model`, effort: "max" }]),
  );
  const config = { lanes, team: { workhorses: ["codex", "mimo"] } };
  const run = { ticket: T, repo: R, dispatch: D, branch: T, worktree: S, base: "main", tool, config };
  const manifest = { ticket: T, workhorses: ["codex", "mimo"] };
  put(join(D, "run.json"), `${JSON.stringify(run, null, 2)}\n`);
  put(join(D, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  put(join(D, "brief.md"), "# waybill\n");
  const info: RunInfo = {
    dispatch: D,
    repo: R,
    ticket: T,
    run,
    config,
    lanes,
    manifest,
    defaultBranch: "main",
    tool,
    home: HOME,
  };
  const others = names.filter((n) => n !== T && n !== N).map((n) => join(wt, n));
  return { root, R, T, wt, S, O, lane: choice.lane, lens: choice.lens, others, data, info };
}

/** Layouts that no command will change, made once per ticket and lane folder. */
function layouts(base: string): (t: number, own: number) => Layout {
  const made = new Map<string, Layout>();
  return (t, own) => {
    const key = `${t}/${Math.abs(own) % OWNS.length}`;
    const known = made.get(key);
    if (known !== undefined) return known;
    const fresh = makeLayout(base, t, own);
    made.set(key, fresh);
    return fresh;
  };
}

/** Runs a law in a fresh temporary folder, beside this file when it already sits in the system's. */
function inFreshFolder(body: (base: string) => void): void {
  const parent = within(HERE, tmpdir()) ? HERE : tmpdir();
  const base = realpathSync(mkdtempSync(join(parent, ".reach-laws-")));
  try {
    body(base);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

/** The places of the ticket's technical notes, for the path a link leads to. */
function placeOf(L: Layout, p: string): Place {
  if (!within(p, L.root)) return "elsewhere";
  const c = canonical(p);
  if (within(c, L.O)) return "inside";
  if (within(c, L.S)) return "synthesis worktree";
  if (within(c, L.wt) && norm(c) !== norm(L.wt)) return "another worktree";
  if (within(c, L.R)) return "main checkout";
  return "elsewhere";
}

// ---------------------------------------------------------------------------------------------
// Where generated paths point

type Region = "main" | "syn" | "other" | "inside" | "home" | "home read" | "system";

interface Target {
  region: Region;
  pick: number;
  pick2: number;
  /** A path the layout does not hold, as a write creates. */
  fresh: boolean;
}

const MAIN_OLD = ["README.md", "src/a.ts", "docs/guide.md", ".worktrees-old/x.txt", "my dir/notes.txt"];
const MAIN_NEW = ["out.txt", "src/new.ts", "docs/new.md", ".worktrees-old/new.txt", "my dir/new file.txt"];
const TREE_OLD = ["README.md", "src/a.ts", "a.ts", "my dir/notes.txt"];
const TREE_NEW = ["out.txt", "src/new.ts", "b.txt", "my dir/new file.txt"];
const OWN_OLD = ["in.txt", "src/a.ts", "a.ts", "my dir/notes.txt"];
const OWN_NEW = ["new.txt", "src/new.ts", "my dir/new file.txt"];
/** Home paths outside every folder the ticket calls normal, among them another project. */
const HOME_RELS = [
  `zz-law-${TAG}/n.txt`,
  `zz-law-${TAG}/notes/x.md`,
  `.config/zz-law-${TAG}/c.toml`,
  `.local/share/zz-law-other-${TAG}/d.txt`,
  `Code/zz-law-other-${TAG}/f.ts`,
];
/** The same for reads, leaving out a projects folder that may link outside the home folder. */
const HOME_READ_RELS = HOME_RELS.filter((r) => !r.startsWith("Code/"));
const SYSTEM_PATHS = [`/opt/zz-law-${TAG}/f`, `/usr/local/zz-law-${TAG}/f`, `/etc/zz-law-${TAG}.conf`, `/srv/zz-law-${TAG}/f`];

function targetPath(L: Layout, t: Target): string {
  const file = (old: readonly string[], fresh: readonly string[]): string => pick(t.fresh ? fresh : old, t.pick2);
  switch (t.region) {
    case "main":
      return join(L.R, file(MAIN_OLD, MAIN_NEW));
    case "syn":
      return join(L.S, file(TREE_OLD, TREE_NEW));
    case "other":
      return join(pick(L.others, t.pick), file(TREE_OLD, TREE_NEW));
    case "inside":
      return join(L.O, file(OWN_OLD, OWN_NEW));
    case "home":
      return join(HOME, pick(HOME_RELS, t.pick));
    case "home read":
      return join(HOME, pick(HOME_READ_RELS, t.pick));
    case "system":
      return pick(SYSTEM_PATHS, t.pick);
  }
}

function target(regions: readonly Region[], fresh: fc.Arbitrary<boolean>): fc.Arbitrary<Target> {
  return fc.record({ region: fc.constantFrom(...regions), pick: fc.nat(99), pick2: fc.nat(99), fresh });
}

/**
 * A path as a command could name it from `cwd`: absolute, relative, `./`-relative, by a detour
 * through the lane's folder and `..`, by `~` or `$HOME`, or quoted. A form that cannot name the
 * path falls back to the absolute path.
 */
function express(style: number, cwd: string, p: string, L: Layout): string {
  const rel = relative(cwd, p) || ".";
  const home = within(p, HOME) ? relative(HOME, p) : null;
  const homeOk = home !== null && (home === "" || PLAIN.test(home));
  switch (Math.abs(style) % 11) {
    case 0:
      return word(p);
    case 1:
      return word(rel);
    case 2:
      return word(rel === "." || rel === ".." || rel.startsWith("../") ? rel : `./${rel}`);
    case 3:
      return word(`${relative(cwd, L.O) || "."}/../${relative(dirname(L.O), p)}`);
    case 4:
      return word(`${L.O}/../${relative(dirname(L.O), p)}`);
    case 5:
      return homeOk ? (home === "" ? "~" : `~/${home}`) : word(p);
    case 6:
      return homeOk ? (home === "" ? "$HOME" : `$HOME/${home}`) : word(p);
    case 7:
      return homeOk ? (home === "" ? '"$HOME"' : `"$HOME/${home}"`) : word(p);
    case 8:
      return dq(p);
    case 9:
      return sq(p);
    default:
      return dq(rel);
  }
}

/** The forms of `express` that need no home folder. */
const LOCAL_STYLES = [0, 1, 2, 3, 4, 8, 9, 10];

// ---------------------------------------------------------------------------------------------
// What commandTouches says

function classify(L: Layout, command: string, result = "", code: unknown = 0): Touch[] {
  return commandTouches(command, result, code, L.info, L.lane, L.O, L.data, L.lens);
}

function reported(ts: readonly Touch[]): Touch[] {
  return ts.filter((t) => t.kind === "finding" || t.kind === "note");
}

function touchesAt(ts: readonly Touch[], p: string): Touch[] {
  return ts.filter((t) => samePath(t.path, p));
}

const RANK: Record<Access, number> = { refused: 0, read: 1, write: 2 };

interface Strongest {
  rank: number;
  as: string;
}

/** For every reported path, its strongest access and what it was reported as. */
function strongest(ts: readonly Touch[]): Map<string, Strongest> {
  const m = new Map<string, Strongest>();
  for (const t of reported(ts)) {
    const key = norm(t.path);
    const rank = RANK[t.access] ?? -1;
    const prev = m.get(key);
    if (prev === undefined || rank > prev.rank) m.set(key, { rank, as: `${t.access} ${t.kind}, ${t.place}, ${t.lane}` });
  }
  return m;
}

function merged(maps: ReadonlyArray<Map<string, Strongest>>): Map<string, Strongest> {
  const m = new Map<string, Strongest>();
  for (const one of maps) {
    for (const [k, v] of one) {
      const prev = m.get(k);
      if (prev === undefined || v.rank > prev.rank) m.set(k, v);
    }
  }
  return m;
}

function sameStrongest(a: Map<string, Strongest>, b: Map<string, Strongest>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k)?.as !== v.as) return false;
  return true;
}

function show(m: Map<string, Strongest>): string {
  return m.size === 0 ? "nothing" : [...m].map(([k, v]) => `${k}: ${v.as}`).join("; ");
}

function fail(what: string, command: string, touches: readonly Touch[]): never {
  throw new Error(`${what}\n  command: ${command}\n  touches: ${JSON.stringify(touches)}`);
}

function expectWriteFinding(L: Layout, command: string, ts: readonly Touch[], p: string): void {
  const place = placeOf(L, p);
  const found = touchesAt(ts, p).some(
    (t) => t.access === "write" && t.kind === "finding" && t.place === place && t.lane === L.lane,
  );
  if (!found) fail(`expected a write finding about ${L.lane} at ${p} (${place})`, command, ts);
}

function expectReadNote(L: Layout, command: string, ts: readonly Touch[], p: string): void {
  const place = placeOf(L, p);
  const found = touchesAt(ts, p).some(
    (t) => (t.access === "read" || t.access === "refused") && t.kind === "note" && t.place === place && t.lane === L.lane,
  );
  if (!found) fail(`expected a read note about ${L.lane} at ${p} (${place})`, command, ts);
}

const TICKET = fc.constantFrom(202, 360, 1234, 4507);
const OWN = fc.nat(OWNS.length - 1);

/** Runs `cases` through `body` on layouts that no command changes. */
function onLayouts<X extends { t: number; own: number }>(
  cases: fc.Arbitrary<X>,
  numRuns: number,
  body: (L: Layout, x: X) => void,
): () => void {
  return () =>
    inFreshFolder((base) => {
      const layout = layouts(base);
      fc.assert(
        fc.property(cases, (x) => body(layout(x.t, x.own), x)),
        { numRuns, includeErrorInReport: true },
      );
    });
}

// ---------------------------------------------------------------------------------------------
// Commands

/** Commands that read the paths they name. */
const READ_PARTS: ReadonlyArray<(a: string, b: string) => string> = [
  (a) => `cat ${a}`,
  (a) => `head -n 2 ${a}`,
  (a) => `wc -l ${a}`,
  (a) => `ls -la ${a}`,
  (a) => `grep -n 'foo bar' ${a}`,
  (a, b) => `diff ${a} ${b}`,
  (a) => `zzquery ${a}`,
  (a) => `sed -n '1,2p' ${a}`,
  (a) => `cat ${a} 2>&1 | head -5`,
];

/** Commands that write the path they name. */
const WRITE_PARTS: ReadonlyArray<(a: string) => string> = [
  (a) => `echo x > ${a}`,
  (a) => `echo x >>${a}`,
  (a) => `touch ${a}`,
  (a) => `rm -f ${a}`,
  (a) => `cp in.txt ${a}`,
  (a) => `sed -i 's/a/b/' ${a}`,
  (a) => `echo x | tee ${a}`,
  (a) => `mkdir -p ${a}`,
];

/** Git subcommands the ticket lists as reads, with arguments that keep them reads. */
const GIT_READS = [
  "status",
  "status --short",
  "status --porcelain",
  "diff",
  "diff --stat",
  "diff HEAD~1",
  "diff --cached",
  "log -1",
  "log --oneline -3",
  "log --format=%H -1",
  "show",
  "show --stat HEAD",
  "rev-parse HEAD",
  "rev-parse --abbrev-ref HEAD",
  "rev-parse --show-toplevel",
  "rev-list --count HEAD",
  "merge-base HEAD main",
  "ls-files",
  "ls-files -m",
  "ls-tree HEAD",
  "ls-tree -r --name-only HEAD",
  "cat-file -p HEAD",
  "cat-file -t HEAD",
  "show-ref",
  "show-ref --heads",
  "for-each-ref",
  "for-each-ref --format='%(refname)' refs/heads",
  "describe --always",
  "describe --tags",
  "blame README.md",
  "grep -n foo",
  "config --get user.name",
  "config --get remote.origin.url",
  "worktree list",
  "worktree list --porcelain",
  "stash list",
  "branch",
  "tag",
];

/** Git calls that write, among them listed subcommands used in a way the list does not name. */
const GIT_WRITES = [
  "merge --ff-only abc1234",
  "merge main",
  "commit -m wip",
  "commit -am 'wip: x'",
  "add -A",
  "add .",
  "checkout -b zz-x",
  "checkout main",
  "switch -c zz-x",
  "reset --hard HEAD~1",
  "reset --soft HEAD~1",
  "restore .",
  "clean -fd",
  "branch zz-x",
  "branch -D zz-x",
  "branch -f main abc1234",
  "branch -m zz-x zz-y",
  "tag zz-v1",
  "tag -a zz-v1 -m x",
  "tag -d zz-v1",
  "config user.name zz",
  "config --unset user.name",
  "worktree add zz-wt",
  "worktree remove zz-wt",
  "worktree prune",
  "stash",
  "stash push -m x",
  "stash pop",
  "stash drop",
  "stash apply",
  "fetch",
  "fetch origin",
  "pull",
  "pull --rebase",
  "push",
  "push origin HEAD",
  "rebase main",
  "cherry-pick abc1234",
  "revert --no-edit abc1234",
  "update-ref refs/heads/zz abc1234",
  "rm --cached README.md",
  "apply x.patch",
  "am x.patch",
  "init",
  "gc",
  "notes add -m x",
  "remote remove origin",
  "submodule update --init",
];

/** Git writes that change only the folder they are aimed at and its own branch. */
const GIT_OWN_WRITES = [
  "merge --ff-only abc1234",
  "merge main",
  "commit -m wip",
  "commit -am 'wip: x'",
  "add -A",
  "add .",
  "reset --hard HEAD~1",
  "reset --soft HEAD~1",
  "restore .",
  "clean -fd",
  "cherry-pick abc1234",
  "revert --no-edit abc1234",
  "rebase main",
  "checkout abc1234",
];

function gitRoots(L: Layout): string[] {
  return [L.S, L.R, join(L.R, "src"), join(L.S, "src"), ...L.others, L.O, join(L.O, "src")];
}

function gitSub(L: Layout, root: string, writes: boolean, form: number): string {
  if (!writes) return pick(GIT_READS, form);
  return pick(within(root, L.O) ? GIT_OWN_WRITES : GIT_WRITES, form);
}

const SEPS = [" ; ", "; ", ";", " && ", "&&", " || ", "||", " | ", "|"];

interface Part {
  kind: "read" | "write" | "git";
  form: number;
  a: Target;
  b: Target;
  root: number;
  writes: boolean;
  /** Placed inside `echo $(…)`. */
  subst: boolean;
}

function partArb(regions: readonly Region[]): fc.Arbitrary<Part> {
  return fc.record({
    kind: fc.constantFrom("read", "write", "git"),
    form: fc.nat(99),
    a: target(regions, fc.constant(false)),
    b: target(regions, fc.constant(false)),
    root: fc.nat(99),
    writes: fc.boolean(),
    subst: fc.boolean(),
  });
}

function renderPart(L: Layout, p: Part): string {
  if (p.kind === "read") return pick(READ_PARTS, p.form)(word(targetPath(L, p.a)), word(targetPath(L, p.b)));
  if (p.kind === "write") return pick(WRITE_PARTS, p.form)(word(targetPath(L, p.a)));
  const root = pick(gitRoots(L), p.root);
  return `git -C ${word(root)} ${gitSub(L, root, p.writes, p.form)}`;
}

/** The parts joined into one command, and each part as it would run on its own. */
function compound(L: Layout, parts: readonly Part[], seps: readonly number[]): { command: string; alone: string[] } {
  const alone = parts.map((p) => renderPart(L, p));
  let command = "";
  parts.forEach((p, i) => {
    const one = alone[i] ?? "";
    const piece = p.subst ? `echo $(${one})` : one;
    command = i === 0 ? piece : `${command}${pick(SEPS, seps[i - 1] ?? 0)}${piece}`;
  });
  return { command, alone };
}

/** Folders a `cd` can lead to, all of which the layout holds. */
function cdDirs(L: Layout): string[] {
  return [
    L.R,
    join(L.R, "src"),
    L.S,
    join(L.S, "src"),
    pick(L.others, 0),
    L.O,
    join(L.O, "src"),
    join(L.R, "my dir"),
    join(L.R, "docs"),
  ];
}

interface Writer {
  uses: "one" | "two" | "many";
  make: (targets: readonly string[], src: string) => string;
}

function one(f: (a: string, src: string) => string): Writer {
  return { uses: "one", make: (ts, src) => f(ts[0] ?? "", src) };
}

function two(f: (a: string, b: string) => string): Writer {
  return { uses: "two", make: (ts) => f(ts[0] ?? "", ts[1] ?? "") };
}

function many(f: (list: string) => string): Writer {
  return { uses: "many", make: (ts) => f(ts.join(" ")) };
}

/** Redirects, and the commands whose targets the ticket counts as written. */
const WRITERS: readonly Writer[] = [
  one((a) => `echo x > ${a}`),
  one((a) => `echo x >${a}`),
  one((a) => `printf '%s\\n' x >> ${a}`),
  one((a) => `echo x >>${a}`),
  one((a) => `ls 2> ${a}`),
  one((a) => `ls 2>${a}`),
  two((a, b) => `echo x > ${a} 2> ${b}`),
  many((l) => `echo x | tee ${l}`),
  many((l) => `echo x | tee -a ${l}`),
  one((a, src) => `cp ${src} ${a}`),
  one((a, src) => `cp -f ${src} ${a}`),
  one((a) => `cp -r src ${a}`),
  one((a, src) => `mv ${src} ${a}`),
  one((a, src) => `mv -f ${src} ${a}`),
  many((l) => `rm ${l}`),
  many((l) => `rm -f ${l}`),
  many((l) => `rm -rf ${l}`),
  many((l) => `mkdir ${l}`),
  many((l) => `mkdir -p ${l}`),
  many((l) => `touch ${l}`),
  many((l) => `sed -i 's/a/b/' ${l}`),
  many((l) => `sed -i -e 's/a/b/' ${l}`),
  one((a, src) => `ln -s ${src} ${a}`),
  one((a, src) => `ln -sf ${src} ${a}`),
  one((a, src) => `ln ${src} ${a}`),
  one((a, src) => `install ${src} ${a}`),
  one((a, src) => `install -m 644 ${src} ${a}`),
];

function used(w: Writer, n: number): number {
  if (w.uses === "one") return 1;
  if (w.uses === "two") return 2;
  return n;
}

/** A source inside the lane's folder, so that only the target can be outside it. */
function sources(L: Layout): string[] {
  return ["in.txt", "./in.txt", word(join(L.O, "in.txt"))];
}

// ---------------------------------------------------------------------------------------------
// Law 1: every part of a command is judged

const cases1 = fc.record({
  t: TICKET,
  own: OWN,
  parts: fc.array(partArb(["main", "syn", "other", "inside"]), { minLength: 2, maxLength: 4 }),
  seps: fc.array(fc.nat(SEPS.length - 1), { minLength: 3, maxLength: 3 }),
});

const law1 = {
  name: "every-part-is-judged",
  statement:
    "Commands joined by ;, &&, || or |, or placed inside $(…), report each path with the strongest access that any one of them reports for it on its own.",
  check: onLayouts(cases1, 200, (L, x) => {
    const { command, alone } = compound(L, x.parts, x.seps);
    const whole = strongest(classify(L, command));
    const parts = merged(alone.map((c) => strongest(classify(L, c))));
    if (!sameStrongest(whole, parts)) {
      throw new Error(
        `the command reports ${show(whole)}\n  its parts on their own report ${show(parts)}\n  command: ${command}\n  parts: ${alone.join("  ⏐  ")}`,
      );
    }
  }),
};

// ---------------------------------------------------------------------------------------------
// Law 2: bash -lc is unwrapped

const cases2 = fc.record({
  t: TICKET,
  own: OWN,
  cd: fc.option(fc.record({ dir: fc.nat(99), style: fc.nat(99) }), { nil: undefined, freq: 2 }),
  parts: fc.array(partArb(["main", "syn", "other", "inside", "home"]), { minLength: 1, maxLength: 3 }),
  seps: fc.array(fc.nat(SEPS.length - 1), { minLength: 3, maxLength: 3 }),
  wrap: fc.nat(WRAPS.length - 1),
});

function build2(L: Layout, x: typeof cases2 extends fc.Arbitrary<infer X> ? X : never): { inner: string; wrapped: string } {
  const cd = x.cd === undefined ? "" : `cd ${express(x.cd.style, L.O, pick(cdDirs(L), x.cd.dir), L)} && `;
  const inner = `${cd}${compound(L, x.parts, x.seps).command}`;
  return { inner, wrapped: pick(WRAPS, x.wrap)(inner) };
}

const law2 = {
  name: "bash-lc-is-unwrapped",
  statement:
    "Wrapping a command in /bin/bash -lc '…' or bash -lc '…', with its own single quotes escaped either usual way, changes nothing that is reported.",
  check: onLayouts(cases2, 200, (L, x) => {
    const { inner, wrapped } = build2(L, x);
    const bare = strongest(classify(L, inner));
    const inBash = strongest(classify(L, wrapped));
    if (!sameStrongest(bare, inBash)) {
      throw new Error(`wrapped, the command reports ${show(inBash)}\n  bare, it reports ${show(bare)}\n  command: ${wrapped}`);
    }
  }),
};

// ---------------------------------------------------------------------------------------------
// Laws 3 and 4: git

/** What the ticket requires of one git call aimed at `root`. */
function judgeGit(L: Layout, command: string, root: string, writes: boolean): void {
  const ts = classify(L, command);
  const shown = reported(ts);
  if (within(root, L.O)) {
    if (shown.length > 0) fail("a git call aimed at the lane's own folder was reported", command, ts);
    return;
  }
  const place = placeOf(L, root);
  if (writes) {
    const found = shown.some(
      (t) => t.access === "write" && t.kind === "finding" && t.place === place && t.lane === L.lane && related(t.path, root),
    );
    if (!found) fail(`expected a write finding about ${L.lane} at ${root} (${place})`, command, ts);
    return;
  }
  if (shown.some((t) => t.access === "write" || t.kind === "finding")) fail("a git read was reported as a write", command, ts);
  const noted = shown.some((t) => t.kind === "note" && t.place === place && t.lane === L.lane && related(t.path, root));
  if (!noted) fail(`expected a read note about ${L.lane} at ${root} (${place})`, command, ts);
}

const cases3 = fc.record({
  t: TICKET,
  own: OWN,
  root: fc.nat(99),
  writes: fc.boolean(),
  form: fc.nat(99),
  /** A subcommand git does not have, used for one write in four. */
  unknown: fc.oneof(
    { weight: 3, arbitrary: fc.constant(undefined) },
    { weight: 1, arbitrary: fc.stringMatching(/^[a-z]{2,8}$/) },
  ),
  extra: fc.constantFrom("", " --all", " -q", " abc1234"),
});

function build3(L: Layout, x: typeof cases3 extends fc.Arbitrary<infer X> ? X : never): { command: string; root: string } {
  const root = pick(gitRoots(L), x.root);
  const invented = x.writes && x.unknown !== undefined && !within(root, L.O);
  const sub = invented ? `zz${x.unknown}${x.extra}` : gitSub(L, root, x.writes, x.form);
  return { command: `git -C ${word(root)} ${sub}`, root };
}

const law3 = {
  name: "git-reads-only-by-the-list",
  statement:
    "A git call aimed outside the lane's folder is a read note when its subcommand is one the ticket lists as a read and a write finding otherwise, and one aimed at the lane's own folder reports nothing.",
  check: onLayouts(cases3, 400, (L, x) => {
    const { command, root } = build3(L, x);
    judgeGit(L, command, root, x.writes);
  }),
};

/** Each form aims git at the folder `r`, a shell word for it as the lane's folder names it. */
const AIMS: ReadonlyArray<(r: string, sub: string) => string> = [
  (r, s) => `git -C ${r} ${s}`,
  (r, s) => `git --git-dir=${r}/.git ${s}`,
  (r, s) => `git --work-tree=${r} ${s}`,
  (r, s) => `GIT_DIR=${r}/.git git ${s}`,
  (r, s) => `cd ${r} && git ${s}`,
  (r, s) => `cd ${r}; git ${s}`,
];
const AIM_READS = ["log -1", "status --short", "diff --stat", "show-ref", "worktree list"];
const AIM_WRITES = ["merge --ff-only abc1234", "commit -m wip", "reset --hard HEAD~1", "add -A", "cherry-pick abc1234"];

const cases4 = fc.record({
  t: TICKET,
  own: OWN,
  root: fc.nat(99),
  aim: fc.nat(AIMS.length - 1),
  style: fc.nat(99),
  writes: fc.boolean(),
  form: fc.nat(99),
});

function build4(L: Layout, x: typeof cases4 extends fc.Arbitrary<infer X> ? X : never): { command: string; root: string } {
  const root = pick([L.S, L.R, ...L.others, L.O], x.root);
  const named = express(pick(LOCAL_STYLES, x.style), L.O, root, L);
  const sub = pick(x.writes ? AIM_WRITES : AIM_READS, x.form);
  return { command: pick(AIMS, x.aim)(named, sub), root };
}

const law4 = {
  name: "git-is-aimed-by-every-form",
  statement:
    "git -C, --git-dir, --work-tree, GIT_DIR= and a cd before it each aim a git call at the folder they name, whether they name it absolutely or relative to the lane's folder.",
  check: onLayouts(cases4, 300, (L, x) => {
    const { command, root } = build4(L, x);
    judgeGit(L, command, root, x.writes);
  }),
};

// ---------------------------------------------------------------------------------------------
// Law 5: writes outside the lane's folder are findings

const cases5 = fc.record({
  t: TICKET,
  own: OWN,
  writer: fc.nat(99),
  targets: fc.array(target(["main", "syn", "other", "home", "system"], fc.boolean()), {
    minLength: 3,
    maxLength: 3,
  }),
  n: fc.integer({ min: 1, max: 3 }),
  src: fc.nat(99),
});

function build5(L: Layout, x: typeof cases5 extends fc.Arbitrary<infer X> ? X : never): { command: string; paths: string[] } {
  const w = pick(WRITERS, x.writer);
  const paths = x.targets.slice(0, used(w, x.n)).map((tg) => targetPath(L, tg));
  return { command: w.make(paths.map(word), pick(sources(L), x.src)), paths };
}

const law5 = {
  name: "outside-writes-are-findings",
  statement:
    "A path outside the lane's folder that a redirect writes, or that is a target of cp, mv, rm, mkdir, touch, tee, sed -i, ln or install, is a write finding about the lane at the place the ticket names, in the home folder and system folders too.",
  check: onLayouts(cases5, 400, (L, x) => {
    const { command, paths } = build5(L, x);
    const ts = classify(L, command);
    for (const p of paths) expectWriteFinding(L, command, ts, p);
  }),
};

// ---------------------------------------------------------------------------------------------
// Law 6: what is only read is a note, never a finding

interface Reader {
  n: 1 | 2;
  make: (a: string, b: string) => string;
}

/** Commands not known to change files, and the read-only uses of cp, install, sed and cat. */
const READERS: readonly Reader[] = [
  { n: 1, make: (a) => `cat ${a}` },
  { n: 2, make: (a, b) => `cat ${a} ${b}` },
  { n: 1, make: (a) => `head -n 3 ${a}` },
  { n: 1, make: (a) => `tail -5 ${a}` },
  { n: 2, make: (a, b) => `wc -l ${a} ${b}` },
  { n: 1, make: (a) => `ls -la ${a}` },
  { n: 1, make: (a) => `stat ${a}` },
  { n: 1, make: (a) => `grep -n foo ${a}` },
  { n: 1, make: (a) => `grep -rn 'a|b' ${a}` },
  { n: 1, make: (a) => `rg -n 'x;y && z' ${a}` },
  { n: 2, make: (a, b) => `diff ${a} ${b}` },
  { n: 1, make: (a) => `sort ${a}` },
  { n: 2, make: (a, b) => `md5sum ${a} ${b}` },
  { n: 1, make: (a) => `file ${a}` },
  { n: 1, make: (a) => `du -sh ${a}` },
  { n: 1, make: (a) => `bun test ${a}` },
  { n: 1, make: (a) => `node ${a}` },
  { n: 1, make: (a) => `python3 ${a}` },
  { n: 1, make: (a) => `some-tool ${a}` },
  { n: 1, make: (a) => `zzlint --check ${a}` },
  { n: 1, make: (a) => `sed -n '1,5p' ${a}` },
  { n: 1, make: (a) => `sed 's/a/b/' ${a}` },
  { n: 1, make: (a) => `cp ${a} ./copy-of.txt` },
  { n: 1, make: (a) => `install -m 644 ${a} ./installed.txt` },
  { n: 1, make: (a) => `cat ${a} > ./out.txt` },
  { n: 1, make: (a) => `cat ${a} 2>/dev/null` },
  { n: 1, make: (a) => `cat ${a} | head -5` },
  { n: 2, make: (a, b) => `head -n 1 ${a} && tail -n 1 ${b}` },
  { n: 1, make: (a) => `cat ${a} | grep -c x | tee ./count.txt` },
];

/** Text that would write outside the lane's folder if it were not inside quotes. */
const INERT: ReadonlyArray<(T: string) => string> = [
  () => "> ../../a.txt",
  (T) => `>> ../${T}/b.txt`,
  () => "; touch ../../c.txt",
  () => "&& rm -f ../../README.md",
  () => "| tee ../../e.txt",
  () => "|| mkdir ../../f",
  (T) => `2> ../${T}/h.txt`,
  () => "; cd ../.. && touch g.txt",
];

/** The same, for single quotes only, since double quotes would run them. */
const INERT_SINGLE: ReadonlyArray<(T: string) => string> = [
  () => "$(touch ../../i.txt)",
  () => "`touch ../../j.txt`",
  (T) => `$(echo x > ../${T}/k.txt)`,
];

const CARRIERS: ReadonlyArray<(q: string) => string> = [
  (q) => `echo ${q}`,
  (q) => `printf '%s\\n' ${q}`,
  (q) => `git commit -m ${q}`,
  (q) => `grep -e ${q} in.txt`,
  (q) => `echo done && echo ${q}`,
];

const cases6 = fc.oneof(
  fc.record({
    case: fc.constant("named" as const),
    t: TICKET,
    own: OWN,
    reader: fc.nat(99),
    a: target(["main", "syn", "other", "home read"], fc.constant(false)),
    b: target(["main", "syn", "other", "home read"], fc.constant(false)),
  }),
  fc.record({
    case: fc.constant("quoted" as const),
    t: TICKET,
    own: OWN,
    frag: fc.nat(99),
    carrier: fc.nat(99),
    single: fc.boolean(),
  }),
);

function build6(L: Layout, x: typeof cases6 extends fc.Arbitrary<infer X> ? X : never): { command: string; paths: string[] } {
  if (x.case === "named") {
    const r = pick(READERS, x.reader);
    const a = targetPath(L, x.a);
    const b = targetPath(L, x.b);
    return { command: r.make(word(a), word(b)), paths: r.n === 2 ? [a, b] : [a] };
  }
  const frags = x.single ? [...INERT, ...INERT_SINGLE] : INERT;
  const text = `fix: ${pick(frags, x.frag)(L.T)}`;
  return { command: pick(CARRIERS, x.carrier)(x.single ? sq(text) : `"${text}"`), paths: [] };
}

const law6 = {
  name: "reads-are-notes-not-findings",
  statement:
    "A command that writes nothing outside the lane's folder makes no finding and reports each outside path it names as a read note, and quoted text that looks like a redirect, a separator or $(…) changes neither.",
  check: onLayouts(cases6, 400, (L, x) => {
    const { command, paths } = build6(L, x);
    const ts = classify(L, command);
    if (reported(ts).some((t) => t.access === "write" || t.kind === "finding")) {
      fail("a command that writes nothing outside the lane's folder was reported as writing", command, ts);
    }
    for (const p of paths) expectReadNote(L, command, ts, p);
  }),
};

// ---------------------------------------------------------------------------------------------
// Law 7: paths resolve as the shell resolves them

/** Links in the lane's folder: `syn` to the synthesis worktree, `up` to the main checkout. */
const LINKED: ReadonlyArray<readonly ["syn" | "up", string]> = [
  ["syn", "README.md"],
  ["syn", "src/a.ts"],
  ["syn", "my dir/notes.txt"],
  ["up", "src/a.ts"],
  ["up", "docs/guide.md"],
  ["up", "README.md"],
];

const L7_WRITERS: ReadonlyArray<(e: string, L: Layout) => string> = [
  (e) => `echo x > ${e}`,
  (e) => `echo x >${e}`,
  (e) => `touch ${e}`,
  (e, L) => `cp ${word(join(L.O, "in.txt"))} ${e}`,
  (e) => `echo x | tee ${e}`,
  (e) => `printf x >> ${e}`,
];

const FILLERS = ["pwd", "ls -la", "git status --short", "true"];

const cases7 = fc.record({
  t: TICKET,
  own: OWN,
  cds: fc.array(fc.record({ dir: fc.nat(99), style: fc.nat(99), and: fc.boolean() }), { maxLength: 2 }),
  filler: fc.option(fc.nat(99), { nil: undefined, freq: 2 }),
  writer: fc.nat(99),
  target: fc.oneof(
    {
      weight: 3,
      arbitrary: fc.record({
        kind: fc.constant("plain" as const),
        at: target(["main", "syn", "other", "inside", "home"], fc.boolean()),
        style: fc.nat(99),
      }),
    },
    {
      weight: 1,
      arbitrary: fc.record({ kind: fc.constant("link" as const), which: fc.nat(99), style: fc.nat(99) }),
    },
  ),
});

function build7(L: Layout, x: typeof cases7 extends fc.Arbitrary<infer X> ? X : never): { command: string; p: string } {
  let cwd = L.O;
  let command = "";
  for (const cd of x.cds) {
    const dir = pick([...cdDirs(L), HOME], cd.dir);
    command += `cd ${express(cd.style, cwd, dir, L)}${cd.and ? " && " : "; "}`;
    cwd = dir;
  }
  if (x.filler !== undefined) command += `${pick(FILLERS, x.filler)} && `;
  let p: string;
  let e: string;
  if (x.target.kind === "plain") {
    p = targetPath(L, x.target.at);
    e = express(x.target.style, cwd, p, L);
  } else {
    const [link, rest] = pick(LINKED, x.target.which);
    p = join(link === "syn" ? L.S : L.R, rest);
    const viaAbs = `${L.O}/${link}/${rest}`;
    const viaRel = `${relative(cwd, L.O) || "."}/${link}/${rest}`;
    e = pick([word(viaAbs), word(viaRel), dq(viaAbs), sq(viaRel)], x.target.style);
  }
  return { command: command + pick(L7_WRITERS, x.writer)(e, L), p };
}

const law7 = {
  name: "paths-resolve-like-the-shell",
  statement:
    "A written path is reported where the shell would resolve it, from the lane's folder or the folder the cds before it lead to, with ~, $HOME, relative paths, .. and links resolved.",
  check: onLayouts(cases7, 400, (L, x) => {
    const { command, p } = build7(L, x);
    const ts = classify(L, command);
    if (placeOf(L, p) === "inside") {
      if (touchesAt(reported(ts), p).length > 0) fail(`a write inside the lane's folder, at ${p}, was reported`, command, ts);
      return;
    }
    expectWriteFinding(L, command, ts, p);
  }),
};

// ---------------------------------------------------------------------------------------------
// Law 8: refused needs the words

interface Attempt {
  make: (p: string) => string;
  says: (p: string, phrase: string) => string;
}

const WRITE_ATTEMPTS: readonly Attempt[] = [
  { make: (p) => `echo x > ${p}`, says: (p, w) => `bash: line 1: ${p}: ${w}` },
  { make: (p) => `echo x >>${p}`, says: (p, w) => `/bin/bash: ${p}: ${w}` },
  { make: (p) => `touch ${p}`, says: (p, w) => `touch: cannot touch '${p}': ${w}` },
  { make: (p) => `cp in.txt ${p}`, says: (p, w) => `cp: cannot create regular file '${p}': ${w}` },
  { make: (p) => `echo x | tee ${p}`, says: (p, w) => `tee: ${p}: ${w}` },
  { make: (p) => `rm -f ${p}`, says: (p, w) => `rm: cannot remove '${p}': ${w}` },
  { make: (p) => `install -m 644 in.txt ${p}`, says: (p, w) => `install: cannot create regular file '${p}': ${w}` },
  { make: (p) => `mkdir -p ${p}`, says: (p, w) => `mkdir: cannot create directory '${p}': ${w}` },
];

const READ_ATTEMPTS: readonly Attempt[] = [
  { make: (p) => `cat ${p}`, says: (p, w) => `cat: ${p}: ${w}` },
  { make: (p) => `head -n 5 ${p}`, says: (p, w) => `head: cannot open '${p}' for reading: ${w}` },
  { make: (p) => `wc -l ${p}`, says: (p, w) => `wc: ${p}: ${w}` },
  { make: (p) => `ls -la ${p}`, says: (p, w) => `ls: cannot access '${p}': ${w}` },
];

const WRITE_REFUSALS = ["Permission denied", "Operation not permitted", "Read-only file system"];
const READ_REFUSALS = ["Permission denied", "Operation not permitted"];
/** Failures that name the path and are not refusals. */
const WRITE_FAILURES = ["Is a directory", "File exists", "Input/output error", "No space left on device", "Text file busy"];
const READ_FAILURES = ["Is a directory", "Input/output error", "Too many open files"];

/** Output that carries no refusal, by the system or by any harness. */
const NOISE = [
  "",
  "done",
  "ok",
  "error: something went wrong",
  "fatal: not a git repository (or any of the parent directories): .git",
  "error: pathspec 'x' did not match any file(s) known to git",
  "bash: line 1: zzq: command not found",
  "Killed",
  "exit status 1",
  "1 file changed, 2 insertions(+)",
  "Segmentation fault (core dumped)",
  "test failed: expected 2, got 3",
];
const REFUSAL_LIKE =
  /deni|permi|read-only|readonly|refus|reject|block|forbid|allow|sandbox|approv|grant|polic|eacces|eperm|erofs|no such|user|abort|cancel/i;
const noiseLine = fc.oneof(
  fc.constantFrom(...NOISE),
  fc.stringMatching(/^[a-z0-9 .:_-]{1,30}$/).filter((s) => !REFUSAL_LIKE.test(s)),
);

const cases8 = fc.record({
  t: TICKET,
  own: OWN,
  writes: fc.boolean(),
  form: fc.nat(99),
  at: target(["main", "syn", "other", "home"], fc.boolean()),
  refusal: fc.option(fc.record({ phrase: fc.nat(99), code: fc.constantFrom(1, 2, 126) }), { nil: undefined, freq: 2 }),
  failure: fc.option(fc.nat(99), { nil: undefined, freq: 2 }),
  before: fc.array(noiseLine, { maxLength: 3 }),
  after: fc.array(noiseLine, { maxLength: 2 }),
  code: fc.constantFrom(0, 1, 2, 124, 126, 127, 128, 130, 137, 255, -1, null, undefined),
});

function build8(
  L: Layout,
  x: typeof cases8 extends fc.Arbitrary<infer X> ? X : never,
): { command: string; p: string; result: string; code: unknown } {
  // A read names a path the layout holds, so that only a refusal can make it refused.
  const at: Target = x.writes ? x.at : { ...x.at, region: x.at.region === "home" ? "main" : x.at.region, fresh: false };
  const p = targetPath(L, at);
  const attempt = pick(x.writes ? WRITE_ATTEMPTS : READ_ATTEMPTS, x.form);
  let said: string[] = [];
  if (x.refusal !== undefined) {
    said = [attempt.says(p, pick(x.writes ? WRITE_REFUSALS : READ_REFUSALS, x.refusal.phrase))];
  } else if (x.failure !== undefined) {
    said = [attempt.says(p, pick(x.writes ? WRITE_FAILURES : READ_FAILURES, x.failure))];
  }
  return {
    command: attempt.make(word(p)),
    p,
    result: [...x.before, ...said, ...x.after].join("\n"),
    code: x.refusal === undefined ? x.code : x.refusal.code,
  };
}

const law8 = {
  name: "refused-needs-the-words",
  statement:
    "An attempt is a refused note when its result says Permission denied, Operation not permitted or Read-only file system; without those words a write is a write finding and a read a read note, whatever the exit status and whatever other error the result reports.",
  check: onLayouts(cases8, 400, (L, x) => {
    const { command, p, result, code } = build8(L, x);
    const ts = classify(L, command, result, code);
    const here = touchesAt(ts, p);
    const shownCode = code === undefined ? "undefined" : JSON.stringify(code);
    const context = `${command}\n  result: ${JSON.stringify(result)}\n  code: ${shownCode}`;
    if (x.refusal !== undefined) {
      if (!here.some((t) => t.access === "refused" && t.kind === "note" && t.lane === L.lane)) {
        fail(`expected a refused note at ${p}`, context, ts);
      }
      if (here.some((t) => t.access === "write" || t.kind === "finding")) {
        fail(`a refused attempt at ${p} was reported as a write`, context, ts);
      }
      return;
    }
    if (here.some((t) => t.access === "refused")) fail(`${p} was reported refused with no refusal in the result`, context, ts);
    const wanted = x.writes
      ? here.some((t) => t.access === "write" && t.kind === "finding" && t.lane === L.lane)
      : here.some((t) => t.access === "read" && t.kind === "note" && t.lane === L.lane);
    if (!wanted) fail(`expected a ${x.writes ? "write finding" : "read note"} at ${p}`, context, ts);
  }),
};

// ---------------------------------------------------------------------------------------------
// Law 9: what is never reported

/** Places normal for writing: the temp folders, caches, and the lane's own data folder. */
function normalWrites(L: Layout): string[] {
  return [
    `/tmp/zz-law-${TAG}/f.txt`,
    `/private/tmp/zz-law-${TAG}/f.txt`,
    `/var/folders/zz/zz-law-${TAG}/T/f.txt`,
    join(HOME, ".npm", "_logs", `zz-law-${TAG}.log`),
    join(HOME, ".cache", `zz-law-${TAG}`, "f.json"),
    join(HOME, ".bun", "install", "cache", `zz-law-${TAG}`),
    join(L.data, `zz-law-${TAG}`, "f.txt"),
    L.data,
  ];
}

const DEV_NULL_WRITES = [
  "echo x > /dev/null",
  "ls 2>/dev/null",
  "echo x >>/dev/null",
  "echo x | tee /dev/null",
  "cat in.txt > /dev/null 2>&1",
];

/** System paths outside the home folder and the repository, which every machine holds. */
const NORMAL_READS = ["/etc/hosts", "/usr/bin/env", "/bin/sh", "/usr/lib", "/etc", "/dev/null", "/tmp"];
const NORMAL_READERS: ReadonlyArray<(p: string) => string> = [
  (p) => `cat ${p}`,
  (p) => `head -n 1 ${p}`,
  (p) => `ls ${p}`,
  (p) => `ls -la ${p}`,
  (p) => `wc -c ${p}`,
  (p) => `stat ${p}`,
  (p) => `file ${p}`,
];

const INSIDE_PATHS = ["in.txt", "src/a.ts", "a.ts", "new.txt", "src/new.ts", "my dir/notes.txt", "src", "docs/new.md"];
const INSIDE_READERS: ReadonlyArray<(e: string) => string> = [
  (e) => `cat ${e}`,
  (e) => `ls -la ${e}`,
  (e) => `grep -n foo ${e}`,
  (e) => `wc -l ${e}`,
  (e) => `head ${e}`,
];

/** Paths that need a variable other than HOME, some named to start like it, or a glob. */
function unresolvable(L: Layout): string[] {
  return [
    "$FOO/x.txt",
    ["$", "{BAR}/y.txt"].join(""),
    '"$OUT"',
    "$HOMEDIR/x.txt",
    "$HOME_OLD/z.txt",
    '"$HOMEBREW_PREFIX/bin/zz"',
    `${word(L.R)}/*.txt`,
    `${word(join(L.R, "src"))}/?.ts`,
    `${word(L.S)}/[ab]*.md`,
    "*.ts",
    "src/*.ts",
    "../*/a.ts",
  ];
}

const UNRESOLVABLE_USES: ReadonlyArray<(e: string, L: Layout) => string> = [
  (e) => `: > ${e}`,
  (e) => `touch ${e}`,
  (e) => `rm -f ${e}`,
  (e) => `cat ${e}`,
  (e) => `ls ${e}`,
  (e) => `mkdir -p ${e}`,
  (e, L) => `cp ${e} ${word(join(L.O, "copy.txt"))}`,
];

const cases9 = fc.oneof(
  fc.record({
    case: fc.constant("normal write" as const),
    t: TICKET,
    own: OWN,
    which: fc.nat(99),
    writer: fc.nat(99),
    style: fc.nat(3),
    src: fc.nat(99),
  }),
  fc.record({
    case: fc.constant("normal read" as const),
    t: TICKET,
    own: OWN,
    which: fc.nat(99),
    reader: fc.nat(99),
  }),
  fc.record({
    case: fc.constant("inside" as const),
    t: TICKET,
    own: OWN,
    which: fc.nat(99),
    style: fc.nat(99),
    act: fc.constantFrom("read", "write", "git"),
    form: fc.nat(99),
    writes: fc.boolean(),
    cdSrc: fc.boolean(),
  }),
  fc.record({
    case: fc.constant("unresolvable" as const),
    t: TICKET,
    own: OWN,
    which: fc.nat(99),
    use: fc.nat(99),
    cd: fc.nat(3),
  }),
);

function build9(
  L: Layout,
  x: typeof cases9 extends fc.Arbitrary<infer X> ? X : never,
): { command: string; cdDir: string | undefined } {
  if (x.case === "normal write") {
    const places = normalWrites(L);
    const p = places[Math.abs(x.which) % (places.length + 1)];
    if (p === undefined) return { command: pick(DEV_NULL_WRITES, x.writer), cdDir: undefined };
    const e = within(p, HOME) ? express([0, 5, 6, 7][x.style] ?? 0, L.O, p, L) : word(p);
    const w = pick(WRITERS, x.writer);
    return { command: w.make([e, e, e].slice(0, used(w, 1)), pick(sources(L), x.src)), cdDir: undefined };
  }
  if (x.case === "normal read") {
    return { command: pick(NORMAL_READERS, x.reader)(pick(NORMAL_READS, x.which)), cdDir: undefined };
  }
  if (x.case === "inside") {
    const cwd = x.cdSrc ? join(L.O, "src") : L.O;
    const prefix = x.cdSrc ? "cd src && " : "";
    if (x.act === "git") {
      const dir = pick([L.O, join(L.O, "src"), join(L.O, "my dir")], x.which);
      const sub = pick(x.writes ? GIT_OWN_WRITES : GIT_READS, x.form);
      const aim = x.style % 2 === 0 ? "" : `-C ${express(x.style, cwd, dir, L)} `;
      return { command: `${prefix}git ${aim}${sub}`, cdDir: undefined };
    }
    const e = express(x.style, cwd, join(L.O, pick(INSIDE_PATHS, x.which)), L);
    if (x.act === "read") return { command: `${prefix}${pick(INSIDE_READERS, x.form)(e)}`, cdDir: undefined };
    const w = pick(WRITERS, x.form);
    return { command: `${prefix}${w.make([e, e, e].slice(0, used(w, 1)), pick(sources(L), x.which))}`, cdDir: undefined };
  }
  const cdDir = [undefined, L.R, L.S, pick(L.others, 0)][x.cd];
  const cd = cdDir === undefined ? "" : `cd ${word(cdDir)} && `;
  return { command: `${cd}${pick(UNRESOLVABLE_USES, x.use)(pick(unresolvable(L), x.which), L)}`, cdDir };
}

const law9 = {
  name: "unreported-paths",
  statement:
    "Paths inside the lane's folder, paths in the places the ticket calls normal for that access, and paths that need another variable or a glob are never reported.",
  check: onLayouts(cases9, 400, (L, x) => {
    const { command, cdDir } = build9(L, x);
    const ts = classify(L, command);
    const extra = reported(ts).filter((t) => cdDir === undefined || !samePath(t.path, cdDir));
    if (extra.length > 0) fail(`nothing should be reported (case: ${x.case})`, command, ts);
  }),
};

// ---------------------------------------------------------------------------------------------
// Law 10: every real write is reported

/** Every file, folder and link under root, with what would show a change to it. */
function snapshot(root: string): Map<string, string> {
  const seen = new Map<string, string>();
  const walk = (p: string): void => {
    const st = lstatSync(p, { bigint: true });
    if (st.isSymbolicLink()) {
      seen.set(p, `link ${readlinkSync(p)}`);
    } else if (st.isDirectory()) {
      seen.set(p, "folder");
      for (const entry of readdirSync(p)) walk(join(p, entry));
    } else {
      seen.set(p, `file ${st.ino} ${st.mtimeNs} ${readFileSync(p).toString("base64")}`);
    }
  };
  walk(root);
  return seen;
}

function changed(before: Map<string, string>, after: Map<string, string>): string[] {
  const out: string[] = [];
  for (const [p, sig] of after) if (before.get(p) !== sig) out.push(p);
  for (const p of before.keys()) if (!after.has(p)) out.push(p);
  return out;
}

/**
 * Writes run for real. No `ln`: a link left behind changes where its path resolves, so after the
 * run the write would rightly be reported where the link leads; law 5 covers `ln`.
 */
const RUN_ACTIONS: ReadonlyArray<(a: string, b: string, L: Layout, k: number) => string> = [
  (a) => `echo x > ${a}`,
  (a) => `echo x >${a}`,
  (a) => `echo x >> ${a}`,
  (a) => `printf 'y\\n' >>${a}`,
  (a) => `ls 2> ${a}`,
  (a) => `ls 2>${a}`,
  (a) => `>${a} echo x`,
  (a, b) => `echo x >${a} 2>${b}`,
  (a) => `echo x | tee ${a}`,
  (a, b) => `echo x | tee -a ${a} ${b}`,
  (a, _b, L) => `cp ${word(join(L.O, "in.txt"))} ${a}`,
  (a, _b, L) => `cp -r ${word(join(L.O, "src"))} ${a}`,
  (a, _b, L, k) => `mv ${word(join(L.O, `mv-${k}.txt`))} ${a}`,
  (a, b) => `rm -f ${a} ${b}`,
  (a) => `rm -rf ${a}`,
  (a, b) => `mkdir -p ${a} ${b}`,
  (a, b) => `touch ${a} ${b}`,
  (a) => `sed -i 's/a/b/' ${a}`,
  (a, _b, L) => `install -m 644 ${word(join(L.O, "in.txt"))} ${a}`,
  (a) => `echo $(echo x > ${a})`,
];

const RUN_SEPS = [" && ", " ; ", "; ", " || ", " | "];
const REFUSED = /Permission denied|Operation not permitted|Read-only file system/;

const runTarget = fc.record({ at: target(["main", "syn", "other", "inside"], fc.boolean()), style: fc.nat(99) });

const cases10 = fc.record({
  t: TICKET,
  own: OWN,
  cds: fc.array(fc.record({ dir: fc.nat(99), style: fc.nat(99), and: fc.boolean() }), { maxLength: 2 }),
  actions: fc.array(fc.record({ form: fc.nat(99), a: runTarget, b: runTarget }), { minLength: 1, maxLength: 3 }),
  seps: fc.array(fc.nat(RUN_SEPS.length - 1), { minLength: 2, maxLength: 2 }),
  wrap: fc.nat(2),
});

function build10(L: Layout, x: typeof cases10 extends fc.Arbitrary<infer X> ? X : never): string {
  let cwd = L.O;
  let inner = "";
  for (const cd of x.cds) {
    const dir = pick(cdDirs(L), cd.dir);
    inner += `cd ${express(pick(LOCAL_STYLES, cd.style), cwd, dir, L)}${cd.and ? " && " : "; "}`;
    cwd = dir;
  }
  const at = (r: { at: Target; style: number }): string => express(pick(LOCAL_STYLES, r.style), cwd, targetPath(L, r.at), L);
  x.actions.forEach((act, k) => {
    const piece = pick(RUN_ACTIONS, act.form)(at(act.a), at(act.b), L, k);
    inner += k === 0 ? piece : `${pick(RUN_SEPS, x.seps[k - 1] ?? 0)}${piece}`;
  });
  return x.wrap === 0 ? inner : pick(WRAPS, x.wrap === 1 ? 0 : 3)(inner);
}

/** Runs a command as a lane would, in its own folder, where only the layout can be written. */
function runInSandbox(L: Layout, command: string): { code: number; output: string } | null {
  const ran = sandboxed(["bash", "-c", 'cd "$1" && eval "$2"', "bash", L.O, command], L.root);
  return ran === null ? null : { code: ran.code, output: `${ran.stdout}${ran.stderr}` };
}

/** The sandbox starts, a write in it shows as a change, and a command that writes nothing shows none. */
function sandboxWorks(base: string): boolean {
  const dir = join(base, "control");
  mkdirSync(dir);
  const before = snapshot(dir);
  if (sandboxed(["sh", "-c", "true"], dir) === null) return false;
  const quiet = changed(before, snapshot(dir)).length === 0;
  sandboxed(["sh", "-c", "echo x > made.txt"], dir);
  return quiet && existsSync(join(dir, "made.txt")) && changed(before, snapshot(dir)).length === 1;
}

const law10 = {
  name: "real-writes-are-reported",
  statement:
    "Every path outside the lane's folder that a command really changes when bash runs it in a sandbox is reported as a write finding about the lane at that path, a folder holding it, or a path inside it.",
  check: (): void =>
    inFreshFolder((base) => {
      if (!sandboxWorks(base)) return; // no sandbox can run here, so this law skips
      fc.assert(
        fc.property(cases10, (x) => {
          const L = makeLayout(base, x.t, x.own);
          try {
            const command = build10(L, x);
            const before = snapshot(L.root);
            const ran = runInSandbox(L, command);
            if (ran === null) return;
            if (REFUSED.test(ran.output)) return; // a refusal is law 8's to judge
            const outside = changed(before, snapshot(L.root)).filter((p) => !within(p, L.O));
            if (outside.length === 0) return;
            const ts = classify(L, command, ran.output, ran.code);
            for (const p of outside) {
              const explained = ts.some(
                (t) =>
                  t.access === "write" &&
                  t.kind === "finding" &&
                  t.lane === L.lane &&
                  t.place === placeOf(L, t.path) &&
                  related(t.path, p),
              );
              if (!explained) {
                fail(
                  `running the command changed ${p} (${placeOf(L, p)}), and no write finding names it`,
                  `${command}\n  exit: ${ran.code}\n  output: ${JSON.stringify(ran.output)}`,
                  ts,
                );
              }
            }
          } finally {
            rmSync(L.root, { recursive: true, force: true });
          }
        }),
        { numRuns: 120, includeErrorInReport: true },
      );
    }),
};

export const laws: Array<{ name: string; statement: string; check: () => void }> = [
  law1,
  law2,
  law3,
  law4,
  law5,
  law6,
  law7,
  law8,
  law9,
  law10,
];
