// Oracle helper for #504: a project's runs open draft pull requests, marked
// ready only on the user's word. Stages a scratch repository with a bare
// origin, a dispatch with a run.json, and a stand-in gh first on PATH that
// records every call and answers pr create, pr ready, pr view and pr checks
// from files the test writes; the tests then follow Stage F step 2 of
// postmaster.md on the pull-request route through the calls the runbook
// names. It never imports the change: every assertion reads command output,
// the recorded gh calls, or the staged files.
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { run } from "./lib/proc.ts";

/** The checkout under test: this file lives in its scripts folder. */
export const REPO = dirname(import.meta.dir);
export const RUN = join(REPO, "scripts", "run");
export const POSTMASTER_MD = join(REPO, "skills", "postmaster", "postmaster.md");

export interface Sh {
  code: number;
  out: string;
  err: string;
}

/** Run the checkout's scripts/run with the given argv and extra env. */
export function sh(args: string[], env?: Record<string, string | undefined>): Sh {
  const r = run(RUN, args, env === undefined ? {} : { env });
  return { code: r.code, out: r.out ?? "", err: r.err ?? "" };
}

/** Run git in a scratch repo with a fixed identity. */
export function git(repo: string, args: string[]): Sh {
  const r = run("git", [
    "-C",
    repo,
    "-c",
    "user.email=oracle@example.invalid",
    "-c",
    "user.name=oracle",
    "-c",
    "commit.gpgsign=false",
    ...args,
  ]);
  return { code: r.code, out: r.out ?? "", err: r.err ?? "" };
}

/** Throw unless the command exited 0, showing both streams. */
export function expectOk(r: Sh, what: string): Sh {
  if (r.code !== 0) {
    throw new Error(`${what}: exit ${r.code}\n--- out ---\n${r.out}\n--- err ---\n${r.err}`);
  }
  return r;
}

/** Every staged directory, for one cleanup call. */
const DIRS: string[] = [];

export function cleanup(): void {
  for (const d of DIRS.splice(0)) rmSync(d, { recursive: true, force: true });
}

function stage(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  DIRS.push(d);
  return d;
}

/** The stand-in gh: records every call, answers from the dir's files. */
const STUB_GH = `#!/bin/sh
echo "$*" >> "$GH504_DIR/calls.log"
sub="$1"; shift
if [ "$sub" != "pr" ]; then echo "unexpected gh call: $sub" >&2; exit 2; fi
op="$1"; shift
case "$op" in
  list)
    cat "$GH504_DIR/list.json" 2>/dev/null || echo "[]"
    ;;
  create)
    if [ -f "$GH504_DIR/create.fail" ]; then
      cat "$GH504_DIR/create.fail" >&2
      exit 1
    fi
    draft="false"
    for a in "$@"; do
      if [ "$a" = "--draft" ]; then draft="true"; fi
    done
    echo "$draft" > "$GH504_DIR/isdraft"
    cat "$GH504_DIR/pr-url" 2>/dev/null || echo "https://github.com/example/repo/pull/1"
    ;;
  ready)
    echo "false" > "$GH504_DIR/isdraft"
    echo "marked ready for review"
    ;;
  view)
    fields=""
    prev=""
    for a in "$@"; do
      if [ "$prev" = "--json" ]; then fields="$a"; fi
      prev="$a"
    done
    case "$fields" in
      *isDraft*)
        d="false"
        [ -f "$GH504_DIR/isdraft" ] && d=$(cat "$GH504_DIR/isdraft")
        printf '{"isDraft":%s}\\n' "$d"
        ;;
      *headRefOid*)
        printf '{"headRefOid":"%s"}\\n' "$(cat "$GH504_DIR/head")"
        ;;
      *)
        echo "unexpected pr view fields: $fields" >&2
        exit 2
        ;;
    esac
    ;;
  checks)
    code=0
    [ -f "$GH504_DIR/checks.exit" ] && code=$(cat "$GH504_DIR/checks.exit")
    cat "$GH504_DIR/checks.json" 2>/dev/null || echo "[]"
    exit "$code"
    ;;
  *)
    echo "unexpected gh call: pr $op" >&2
    exit 2
    ;;
esac
`;

export interface Standin {
  dir: string;
  repo: string;
  origin: string;
  dispatch: string;
  url: string;
  head: string;
}

/** A scratch repo with a bare origin, a ticket branch, a dispatch and the stub. */
export function standin(label: string): Standin {
  const dir = stage(`accept-504-${label}-`);
  const origin = join(dir, "origin.git");
  mkdirSync(origin, { recursive: true });
  expectOk(git(origin, ["init", "-q", "--bare"]), "bare init");
  const repo = join(dir, "repo");
  mkdirSync(repo, { recursive: true });
  expectOk(git(repo, ["init", "-q", "-b", "main"]), "init");
  writeFileSync(join(repo, "note.txt"), "scratch\n");
  expectOk(git(repo, ["add", "note.txt"]), "add");
  expectOk(git(repo, ["commit", "-q", "-m", "base"]), "commit base");
  expectOk(git(repo, ["checkout", "-q", "-b", "ticket"]), "checkout ticket");
  writeFileSync(join(repo, "change.txt"), "change\n");
  expectOk(git(repo, ["add", "change.txt"]), "add change");
  expectOk(git(repo, ["commit", "-q", "-m", "change"]), "commit change");
  expectOk(git(repo, ["remote", "add", "origin", origin]), "remote add");
  const url = "https://github.com/example/repo/pull/1";
  const head = git(repo, ["rev-parse", "HEAD"]).out.trim();
  writeFileSync(join(dir, "head"), `${head}\n`);
  writeFileSync(join(dir, "pr-url"), `${url}\n`);
  writeFileSync(join(dir, "list.json"), "[]\n");
  writeFileSync(join(dir, "checks.json"), "[]\n");
  const bin = join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "gh"), STUB_GH);
  chmodSync(join(bin, "gh"), 0o755);
  const dispatch = join(repo, ".postmaster", "runs", "accept-504");
  mkdirSync(dispatch, { recursive: true });
  return { dir, repo, origin, dispatch, url, head };
}

/** Env with the stand-in gh first on PATH, answering from the stand-in dir. */
export function standinEnv(s: Standin): Record<string, string> {
  return {
    PATH: `${join(s.dir, "bin")}:${process.env.PATH ?? ""}`,
    GH504_DIR: s.dir,
  };
}

/** Run the checkout's scripts/run against the stand-in. */
export function gsh(s: Standin, args: string[]): Sh {
  return sh(args, standinEnv(s));
}

/** Write the dispatch's run.json with the given [ship] table, or none. */
export function writeRunJson(s: Standin, ship: Record<string, string> | null): void {
  const config: Record<string, unknown> = ship === null ? {} : { ship };
  writeFileSync(join(s.dispatch, "run.json"), JSON.stringify({ config }));
}

/** The gh calls the stand-in recorded, one argv line each. */
export function ghCalls(s: Standin): string[] {
  let text: string;
  try {
    text = readFileSync(join(s.dir, "calls.log"), "utf8");
  } catch {
    return [];
  }
  return text.split("\n").filter((l) => l !== "");
}

export function creates(s: Standin): string[] {
  return ghCalls(s).filter((l) => l.startsWith("pr create "));
}

export function readies(s: Standin): string[] {
  return ghCalls(s).filter((l) => l.startsWith("pr ready "));
}

/** Answer files the test rewrites between asks. */
export function writeChecks(s: Standin, checks: unknown[], exit = 0): void {
  writeFileSync(join(s.dir, "checks.json"), `${JSON.stringify(checks)}\n`);
  writeFileSync(join(s.dir, "checks.exit"), `${exit}\n`);
}

export function writeList(s: Standin, prs: unknown[]): void {
  writeFileSync(join(s.dir, "list.json"), `${JSON.stringify(prs)}\n`);
}

export function seedDraft(s: Standin, draft: boolean): void {
  writeFileSync(join(s.dir, "isdraft"), draft ? "true" : "false");
}

export function refuseCreates(s: Standin, message: string): void {
  writeFileSync(join(s.dir, "create.fail"), `${message}\n`);
}

export const PASS_CHECKS: unknown[] = [
  { name: "linux", state: "SUCCESS", bucket: "pass", link: "https://example.test/linux" },
];

export const SKIPPED_CHECKS: unknown[] = [
  { name: "docs", state: "SKIPPED", bucket: "skipping", link: "https://example.test/docs" },
];

export const PENDING_CHECKS: unknown[] = [
  { name: "macos", state: "IN_PROGRESS", bucket: "pending", link: "https://example.test/macos" },
];

/** Push the ticket branch, as the route does before opening. */
export function pushTicket(s: Standin): void {
  expectOk(git(s.repo, ["push", "-q", "origin", "ticket"]), "push ticket");
}

/** Open through the runbook's call, with a composed description. */
export function openPr(s: Standin, ready = false): Sh {
  const body = join(s.dir, "body.md");
  writeFileSync(body, "card, checks, diff stat and links\n");
  const args = [
    "landing",
    "open-pr",
    "--repo",
    s.repo,
    "--dispatch",
    s.dispatch,
    "--base",
    "main",
    "--head",
    "ticket",
    "--title",
    "504, drafts",
    "--body-file",
    body,
  ];
  if (ready) args.push("--ready");
  return gsh(s, args);
}

/** Ask the pull request's checks at the card's HEAD, as the route does. */
export function askChecks(s: Standin): Sh {
  return gsh(s, [
    "landing",
    "pull-request-checks",
    "--repo",
    s.repo,
    "--pr",
    s.url,
    "--card-head",
    s.head,
  ]);
}

/** Mark the pull request ready, as the route does on the user's word. */
export function markReady(s: Standin): Sh {
  return gsh(s, ["landing", "mark-ready", "--repo", s.repo, "--pr", s.url]);
}

/** Read the pull request's draft state the way the runbook takes it. */
export function isDraft(s: Standin): boolean {
  const r = run(join(s.dir, "bin", "gh"), ["pr", "view", s.url, "--json", "isDraft"], {
    env: { GH504_DIR: s.dir },
  });
  if (r.code !== 0) throw new Error(`pr view isDraft failed: ${r.err}`);
  return (JSON.parse(r.out) as { isDraft: unknown }).isDraft === true;
}

export function waitingPath(s: Standin): string {
  return join(s.dispatch, ".waiting-on-user");
}

export function writeWaiting(s: Standin, text: string): void {
  writeFileSync(waitingPath(s), text);
}

export function readWaiting(s: Standin): string {
  return readFileSync(waitingPath(s), "utf8");
}

export function actionsText(s: Standin): string {
  return readFileSync(join(s.dispatch, "actions.jsonl"), "utf8");
}

// ---------- the C2 setup and record runs ----------

/** A bin dir with stub harnesses, for setup's PATH check. */
export function setupBin(): string {
  const dir = stage("accept-504-bin-");
  for (const h of ["claude", "codex", "grok", "agy", "muse", "mimo", "pi"]) {
    const p = join(dir, h);
    writeFileSync(p, "#!/bin/sh\nexit 0\n", "utf8");
    chmodSync(p, 0o755);
  }
  return dir;
}

const PROJECT_GLOBAL = `projects_roots = ["~/Code"]
confine = "off"
[lanes.alpha]
harness = "claude"
model = "m-a"
[lanes.beta]
harness = "codex"
model = "m-b"
[team]
workhorses = ["alpha", "beta"]
reviewers = ["alpha", "beta"]
coachman = { harness = "muse", model = "m-c" }
coachman_fallback = { harness = "muse", model = "m-f" }
postmaster = { harness = "claude", model = "m-p" }
clerk = { harness = "claude", model = "m-k" }
max_runs = 2
mode = "synthesis"
[postmaster]
poll_seconds = 120
[tracker]
kind = "local"
postmaster_may_create = false
[review]
round_timeout_seconds = 2400
[ship]
merge_authority = "user"
checkpoint_mode = "autonomous"
review_link = ""
`;

/** A scratch machine config without the project under test. */
export function globalConfig(): string {
  const dir = stage("accept-504-cfg-");
  const cfg = join(dir, "config.toml");
  writeFileSync(cfg, PROJECT_GLOBAL, "utf8");
  return cfg;
}

/** Run a project setup on the repo with the given answers text. */
export function projectSetup(repo: string, answersText: string, config: string): Sh {
  const dir = stage("accept-504-projsetup-");
  const answersPath = join(dir, "answers.txt");
  writeFileSync(answersPath, `${answersText}\n`, "utf8");
  return sh(["setup", "--project", repo, "--answers", answersPath], {
    PATH: `${setupBin()}:${process.env.PATH ?? ""}`,
    POSTMASTER_CONFIG: config,
  });
}

/** Record the run's run.json from the repo's settings. */
export function recordRun(dispatch: string, repo: string, config: string): Sh {
  return sh(["run-meta", dispatch, repo], {
    POSTMASTER_CONFIG: config,
  });
}
