// Oracle helpers for #429: a surveyor skill gives a run an independent judgement.
// The tests spawn scripts/run as subprocesses; nothing here imports the change.
// The stand-in survey layout mirrors walls-oracle's: stub harness executables
// first on PATH that log their calls, print canned events and exit a canned
// code, under POSTMASTER_HOST=none, with HOME and the host state in tmp.
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { beside, toolRoot } from "./lib/paths.ts";

export const ROOT = toolRoot(import.meta);
export const RUN = beside(import.meta, "run");

export interface Run {
  code: number;
  out: string;
  err: string;
}

export function both(r: Run): string {
  return `${r.out}${r.err}`;
}

const GIT_ENV: Record<string, string | undefined> = {
  ...process.env,
  GIT_AUTHOR_NAME: "surveyor-oracle",
  GIT_AUTHOR_EMAIL: "oracle@example.invalid",
  GIT_COMMITTER_NAME: "surveyor-oracle",
  GIT_COMMITTER_EMAIL: "oracle@example.invalid",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};

export function git(...args: string[]): Run {
  const r = spawnSync("git", args, { encoding: "utf8", env: GIT_ENV });
  return { code: r.status ?? -1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

export function need(r: Run, what: string): void {
  if (r.code !== 0) throw new Error(`${what} failed with exit ${r.code}: ${both(r)}`);
}

export function sh(
  cmd: string,
  args: string[],
  env: Record<string, string | undefined>,
  cwd?: string,
): Run {
  const r = spawnSync(cmd, args, { encoding: "utf8", env, cwd });
  return { code: r.status ?? -1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

export function scratchDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function removeDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

// --- setup answers -----------------------------------------------------

const BASE_ANSWERS = [
  "lanes=opus, luna",
  "lane.opus.harness=bash",
  "lane.opus.model=opus-model",
  "lane.luna.harness=bash",
  "lane.luna.model=luna-model",
  "workhorses=opus, luna",
  "coachman.harness=bash",
  "coachman.model=judge",
  "fallback.harness=bash",
  "fallback.model=spare",
  "postmaster.harness=bash",
  "postmaster.model=pm",
  "clerk.harness=bash",
  "clerk.model=clerk-model",
];

/** Stub harness executables so setup's on-PATH check passes; bash covers the rest. */
export function setupBin(tmp: string): string {
  const bin = join(tmp, "bin");
  mkdirSync(bin, { recursive: true });
  for (const h of ["claude", "codex", "grok", "agy", "muse", "mimo", "pi"]) {
    const p = join(bin, h);
    if (!existsSync(p)) {
      writeFileSync(p, "#!/bin/sh\nexit 0\n", "utf8");
      chmodSync(p, 0o755);
    }
  }
  return bin;
}

export function writeAnswers(tmp: string, name: string, extra?: string): string {
  const lines = [...BASE_ANSWERS];
  if (extra) lines.push(extra);
  const path = join(tmp, `${name}.answers`);
  writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
  return path;
}

export function setupDryRun(tmp: string, answersPath: string): Run {
  const bin = setupBin(tmp);
  return sh(RUN, ["setup", "--answers", answersPath, "--dry-run"], {
    ...(process.env as Record<string, string>),
    PATH: `${bin}:${process.env.PATH}`,
  });
}

// --- canned harness streams --------------------------------------------

export function claudeInit(id: string): string {
  return JSON.stringify({ type: "system", subtype: "init", session_id: id, model: "test-model" });
}

export function claudeResult(text: string): string {
  return JSON.stringify({ type: "result", subtype: "success", is_error: false, result: text });
}

export function codexThread(id: string): string {
  return JSON.stringify({ type: "thread.started", thread_id: id });
}

export function codexDone(): string {
  return JSON.stringify({
    type: "turn.completed",
    usage: { input_tokens: 7, output_tokens: 3 },
  });
}

// --- stand-in survey layout --------------------------------------------

export interface SurveyLayout {
  tmp: string;
  home: string;
  stubDir: string;
  calls: string;
  repo: string;
  sha: string;
  dispatch: string;
  env: Record<string, string | undefined>;
  cleanup(): void;
}

function writeRecordingStub(bin: string, harness: string): void {
  // Log the call, print the case's events, honor codex -o with the case's
  // last-file content, run the case's setup, exit its code.
  const oHonor =
    harness === "codex"
      ? 'last=""; prev=""; for a in "$@"; do if [ "$prev" = "-o" ]; then last="$a"; fi; prev="$a"; done; if [ -n "$last" ] && [ -f "$SURVEY_STUB_DIR/codex.last" ]; then cat "$SURVEY_STUB_DIR/codex.last" > "$last"; fi\n'
      : "";
  writeFileSync(
    join(bin, harness),
    `#!/bin/sh\necho "${harness} $@" >> "$SURVEY_CALLS"\n${oHonor}cat "$SURVEY_STUB_DIR/${harness}.events" 2>/dev/null\nif [ -f "$SURVEY_STUB_DIR/${harness}.setup" ]; then . "$SURVEY_STUB_DIR/${harness}.setup"; fi\ncode=$(cat "$SURVEY_STUB_DIR/${harness}.exit" 2>/dev/null)\nexit "\${code:-0}"\n`,
  );
  chmodSync(join(bin, harness), 0o755);
}

function writeDead(bin: string, harness: string): void {
  writeFileSync(
    join(bin, harness),
    `#!/bin/sh\necho "oracle: ${harness} must not run" >&2\nexit 1\n`,
  );
  chmodSync(join(bin, harness), 0o755);
}

export function makeSurveyLayout(): SurveyLayout {
  const tmp = mkdtempSync(join(tmpdir(), "surveyor-oracle-"));
  const home = join(tmp, "home");
  const bin = join(tmp, "bin");
  const stubDir = join(tmp, "stub");
  const calls = join(tmp, "calls.log");
  const repo = join(tmp, "proj");
  const dispatch = join(tmp, "runs", "T");
  mkdirSync(home, { recursive: true });
  mkdirSync(bin, { recursive: true });
  mkdirSync(stubDir, { recursive: true });
  mkdirSync(join(dispatch, "logs"), { recursive: true });
  for (const h of ["claude", "codex"]) writeRecordingStub(bin, h);
  for (const h of ["grok", "agy", "muse", "pi", "mimo", "herdr", "tmux"]) writeDead(bin, h);

  need(git("init", "-q", "-b", "main", repo), "init repo");
  writeFileSync(join(repo, "README.md"), "oracle fixture\n");
  need(git("-C", repo, "add", "README.md"), "add readme");
  need(git("-C", repo, "commit", "-qm", "init"), "commit init");
  const shaR = git("-C", repo, "rev-parse", "HEAD");
  need(shaR, "read sha");
  const sha = shaR.out.trim();

  writeFileSync(
    join(dispatch, "run.json"),
    `${JSON.stringify(
      {
        config: {
          confine: "off",
          lanes: {
            opus: { harness: "claude", model: "opus-model", effort: "max" },
            luna: { harness: "codex", model: "luna-model", effort: "max" },
            haiku: { harness: "claude", model: "haiku-model", effort: "high" },
          },
          team: { workhorses: ["luna", "haiku"], reviewers: ["luna", "haiku"] },
          review: { round_timeout_seconds: 2400 },
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(dispatch, "manifest.json"),
    `${JSON.stringify({ stage: "synthesis", leg: 1, base: sha, lanes: {} }, null, 2)}\n`,
  );
  writeFileSync(
    join(dispatch, "brief.md"),
    `# Waybill: T\nturnpikes: style, bug, security\n\n## Team\nmode: single-thread\nreviewers: luna, haiku\nbug reviewers: luna, haiku\nsecurity reviewers: opus\n\n## Dispatch\nname: #1, Oracle fixture\n`,
  );
  writeFileSync(join(dispatch, "run-log.md"), "");
  writeFileSync(join(dispatch, "actions.jsonl"), "");
  writeFileSync(join(tmp, "runs", "ledger.jsonl"), "");
  writeFileSync(join(dispatch, "ticket-body.md"), "# Oracle ticket\n\nThe ticket.\n");

  const config = join(tmp, "config.toml");
  writeFileSync(config, "[postmaster]\npoll_seconds = 1\n");

  const env: Record<string, string | undefined> = { ...process.env };
  delete env.POSTMASTER_LAUNCH_NAME;
  delete env.POSTMASTER_LAUNCH_ROLE;
  env.PATH = `${bin}:${process.env.PATH ?? ""}`;
  env.HOME = home;
  env.SURVEY_CALLS = calls;
  env.SURVEY_STUB_DIR = stubDir;
  env.POSTMASTER_HOST = "none";
  env.POSTMASTER_HOST_STATE = join(tmp, "host");
  env.POSTMASTER_HOST_STOP_WAIT = "5";
  env.POSTMASTER_HOST_CLOSE_WAIT = "1";
  env.POSTMASTER_CONFIG = config;
  env.TZ = "UTC";

  return {
    tmp,
    home,
    stubDir,
    calls,
    repo,
    sha,
    dispatch,
    env,
    cleanup: () => {
      removeDir(tmp);
    },
  };
}

export interface StubCase {
  events?: string[];
  exit?: number;
  setup?: string;
  last?: string;
}

export function setStub(lay: SurveyLayout, harness: string, c: StubCase): void {
  writeFileSync(join(lay.stubDir, `${harness}.events`), `${(c.events ?? []).join("\n")}\n`);
  writeFileSync(join(lay.stubDir, `${harness}.exit`), `${c.exit ?? 0}\n`);
  rmSync(join(lay.stubDir, `${harness}.setup`), { force: true });
  if (c.setup !== undefined)
    writeFileSync(join(lay.stubDir, `${harness}.setup`), `${c.setup}\n`);
  rmSync(join(lay.stubDir, `${harness}.last`), { force: true });
  if (c.last !== undefined) writeFileSync(join(lay.stubDir, `${harness}.last`), c.last);
}

/** Every stub-harness call logged so far, one line per call. */
export function callLines(lay: SurveyLayout): string[] {
  try {
    return readFileSync(lay.calls, "utf8")
      .split("\n")
      .filter((l) => l !== "");
  } catch {
    return [];
  }
}

export interface ActionRow {
  action: string;
  actor: string;
  target: string;
  detail: string;
}

export function readActions(dispatch: string): ActionRow[] {
  const rows: ActionRow[] = [];
  let text = "";
  try {
    text = readFileSync(join(dispatch, "actions.jsonl"), "utf8");
  } catch {
    return rows;
  }
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const e = JSON.parse(line) as Record<string, unknown>;
      rows.push({
        action: typeof e.action === "string" ? e.action : "",
        actor: typeof e.actor === "string" ? e.actor : "",
        target: typeof e.target === "string" ? e.target : "",
        detail: typeof e.detail === "string" ? e.detail : "",
      });
    } catch {
      /* a half-written line is not a row */
    }
  }
  return rows;
}

/** Merge patch into the run.json config, tables merging and values replaced. */
export function patchRunJson(dispatch: string, patch: Record<string, unknown>): void {
  const path = join(dispatch, "run.json");
  const data = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  const merge = (base: Record<string, unknown>, over: Record<string, unknown>): void => {
    for (const [k, v] of Object.entries(over)) {
      const bv = base[k];
      if (
        typeof bv === "object" &&
        bv !== null &&
        !Array.isArray(bv) &&
        typeof v === "object" &&
        v !== null &&
        !Array.isArray(v)
      ) {
        merge(bv as Record<string, unknown>, v as Record<string, unknown>);
      } else {
        base[k] = v;
      }
    }
  };
  merge(data, patch);
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

export function surveyor(
  lay: SurveyLayout,
  args: string[],
  cwd?: string,
): Run {
  return sh(RUN, ["surveyor", ...args], lay.env, cwd ?? lay.tmp);
}

export function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, "utf8");
}
