// Helpers for the #454 oracle: a scratch project with a local ticket store, a
// scratch run root with synthetic runs, a scratch config with messages on, and
// a stand-in Telegram API recording every request. The tests spawn git and
// scripts/run as subprocesses; nothing here imports the change.
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitAll, gitOrThrow, initRepo, ROOT, RUN, writeRepoFile } from "./acceptance-323.ts";
import { expectCode } from "./acceptance-478.ts";
import { run, type RunResult } from "./lib/proc.ts";
import { processCommandLine, processIsLive, processTable } from "./lib/processes.ts";

export { RUN, ROOT };
export { expectCode };
export { processIsLive };
export type { RunResult };

// --- the stand-in ----------------------------------------------------------------
export interface StandinRequest {
  method: string;
  path: string;
  body: string;
}

export type StandinMode = { kind: "ok" } | { kind: "status"; code: number } | { kind: "hang" };

export interface Standin {
  origin: string;
  requests: StandinRequest[];
  setMode(mode: StandinMode): void;
  /** Requests to the send path only: other software may probe a new port. */
  sends(): StandinRequest[];
  stop(): void;
}

export function startStandin(): Standin {
  const requests: StandinRequest[] = [];
  let mode: StandinMode = { kind: "ok" };
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const u = new URL(req.url);
      const body = req.method === "GET" || req.method === "HEAD" ? "" : await req.text();
      requests.push({ method: req.method, path: u.pathname, body });
      if (mode.kind === "hang") return new Promise<Response>(() => {});
      if (mode.kind === "status") return new Response("stand-in refusal", { status: mode.code });
      return Response.json({ ok: true, result: { message_id: requests.length } });
    },
  });
  return {
    origin: `http://127.0.0.1:${server.port}`,
    requests,
    setMode(m) {
      mode = m;
    },
    sends() {
      return requests.filter(
        (r) => r.method === "POST" && /^\/bot[^/]*\/sendMessage$/u.test(r.path),
      );
    },
    stop() {
      server.stop();
    },
  };
}

// --- the sandbox -----------------------------------------------------------------
export interface NotifySandbox {
  dir: string;
  repo: string;
  runs: string;
  config: string;
  tokenFile: string;
  token: string;
  chat: string;
  standin: Standin;
  env: Record<string, string | undefined>;
}

const TICKET_BODY = [
  "# oracle ticket",
  "",
  "## Problem / feature",
  "a scratch ticket",
  "",
  "## Acceptance criteria",
  "1. scratch",
  "",
  "## Direction",
  "none",
  "",
  "## Turnpikes",
  "none",
  "",
].join("\n");

export const PLAIN_TITLE = "plain title";
export const TRICKY_TITLE = `routes/a/b shows <b>markup</b> & "quotes"`;

export function makeTicket(sb: NotifySandbox, title: string): string {
  const body = join(sb.dir, `body-${randomBytes(4).toString("hex")}.md`);
  writeFileSync(body, TICKET_BODY);
  const r = run(RUN, ["local", sb.repo, "create", title, body], { env: sb.env });
  expectCode(r, 0);
  return r.out.trim();
}

export function makeNotifySandbox(
  opts: { messages?: boolean; runsInRepo?: boolean } = {},
): NotifySandbox {
  const messages = opts.messages ?? true;
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "acceptance-454-")));
  const repo = join(dir, "acme");
  initRepo(repo);
  writeRepoFile(repo, "README.md", "# acme\n");
  commitAll(repo, "first");
  // Inside the repo, the scan resolves the repo's own settings; outside, the
  // global config alone.
  const runs = opts.runsInRepo === true ? join(repo, ".postmaster", "runs") : join(dir, "runs");
  mkdirSync(join(runs, "postmaster"), { recursive: true });
  const token = `454tok${randomBytes(16).toString("hex")}`;
  const chat = `454${[...randomBytes(5)].map((b) => String(b % 10)).join("")}`;
  const standin = startStandin();
  const tokenFile = join(dir, "telegram.env");
  writeFileSync(
    tokenFile,
    `TELEGRAM_BOT_TOKEN=${token}\nTELEGRAM_CHAT_ID=${chat}\nTELEGRAM_API_ORIGIN=${standin.origin}\n`,
  );
  chmodSync(tokenFile, 0o600);
  const config = join(dir, "config.toml");
  writeFileSync(
    config,
    messages
      ? `[postmaster]\npoll_seconds = 1\n\n[notify]\nchannel = "telegram"\nenv_file = "${tokenFile}"\n`
      : "[postmaster]\npoll_seconds = 1\n",
  );
  const env: Record<string, string | undefined> = {
    POSTMASTER_CONFIG: config,
    POSTMASTER_WATCH_TEST_MODE: "1",
    POSTMASTER_WATCH_TEST_CALLS: join(dir, "calls"),
  };
  const sb: NotifySandbox = { dir, repo, runs, config, tokenFile, token, chat, standin, env };
  const r = run(RUN, ["local", repo, "store", "init"], { env });
  expectCode(r, 0);
  makeTicket(sb, PLAIN_TITLE);
  makeTicket(sb, TRICKY_TITLE);
  return sb;
}

export function removeSandbox(sb: NotifySandbox): void {
  try {
    sb.standin.stop();
  } catch {
    /* already stopped for a refused-connection case */
  }
  rmSync(sb.dir, { recursive: true, force: true });
}

// --- synthetic runs ---------------------------------------------------------------
export interface RunOpts {
  stage?: string;
  waiting?: string;
  card?: boolean;
  brief?: boolean;
}

export function makeRun(sb: NotifySandbox, name: string, opts: RunOpts = {}): string {
  const d = join(sb.runs, name);
  mkdirSync(join(d, "logs"), { recursive: true });
  writeFileSync(
    join(d, "manifest.json"),
    `${JSON.stringify({ stage: opts.stage ?? "workhorses-running", leg: 1 })}\n`,
  );
  writeFileSync(join(d, "run-log.md"), "");
  if (opts.brief ?? true) {
    writeFileSync(
      join(d, "brief.md"),
      [
        "# Waybill: oracle",
        "turnpikes: style, bug, security",
        "",
        "## Project profile",
        `repo: ${sb.repo}`,
        "",
      ].join("\n"),
    );
  }
  if (opts.waiting !== undefined) writeFileSync(join(d, ".waiting-on-user"), opts.waiting);
  if (opts.card === true) writeFileSync(join(d, ".card-ready"), "");
  return d;
}

export function addWall(
  sb: NotifySandbox,
  dispatch: string,
  lane: string,
  reset: string,
  message: string,
): void {
  const r = run(
    RUN,
    ["log-action", dispatch, `lane:${lane}`, "wall", lane, `workhorse - - ${reset} ${message}`],
    { env: sb.env },
  );
  expectCode(r, 0);
}

export function tellWalls(sb: NotifySandbox, dispatch: string, lane: string): void {
  const r = run(RUN, ["walls", "told", dispatch, lane], { env: sb.env });
  expectCode(r, 0);
}

export function shipRun(sb: NotifySandbox, dispatch: string): void {
  const r = run(RUN, ["stage", dispatch, "shipped", "postmaster"], { env: sb.env });
  expectCode(r, 0);
  const done = run(RUN, ["stage", dispatch, "done", "postmaster"], { env: sb.env });
  expectCode(done, 0);
}

/** A run whose hand-off passes, ready for the watcher to dispatch its next leg. */
export function makeDispatchRun(sb: NotifySandbox, name: string): string {
  const d = makeRun(sb, name, { stage: "checkpoint-1" });
  const head = gitOrThrow(ROOT, "rev-parse", "HEAD").trim();
  writeFileSync(
    join(d, "run.json"),
    `${JSON.stringify({ coachman_contract: 2, postmaster: { commit: head, checkout: ROOT } })}\n`,
  );
  writeFileSync(
    join(d, "handoff-1.md"),
    [
      "## Decisions",
      "a",
      "## Deferred findings",
      "b",
      "## Verified by execution",
      "c",
      "## Unverified",
      "d",
      "## Branches and lanes",
      "e",
      "## Open questions",
      "f",
      "## Next leg",
      "g",
      "",
    ].join("\n"),
  );
  writeFileSync(join(d, ".leg-1-done"), "");
  mkdirSync(join(sb.repo, ".worktrees", name), { recursive: true });
  return d;
}

// --- driving ----------------------------------------------------------------------
/** Async spawn for commands that reach the stand-in: it can only answer while
 * this loop runs, and spawnSync would block it for the child's whole life. */
export async function runAsync(
  cmd: string,
  args: string[],
  env: Record<string, string | undefined>,
): Promise<RunResult> {
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...process.env, ...env })) {
    if (v !== undefined) clean[k] = v;
  }
  const p = Bun.spawn([cmd, ...args], { env: clean, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  return { code, out, err, timedOut: false };
}

/** One look of the watcher over the sandbox root. */
export function look(
  sb: NotifySandbox,
  extraEnv: Record<string, string | undefined> = {},
): Promise<RunResult> {
  return runAsync(RUN, ["runs-watch", "--timeout", "0", sb.runs], { ...sb.env, ...extraEnv });
}

/** The test-message command against the sandbox config. */
export function notifyTest(sb: NotifySandbox): Promise<RunResult> {
  return runAsync(RUN, ["notify", "test"], sb.env);
}

/** The clerk's message command for a ticket in the sandbox repo. */
export function notifyClerk(sb: NotifySandbox, ticket: string): Promise<RunResult> {
  return runAsync(RUN, ["notify", "clerk", sb.repo, ticket], sb.env);
}

export interface SendBody {
  chat_id: unknown;
  text: string;
  raw: Record<string, unknown>;
}

export function sendBodies(sb: NotifySandbox): SendBody[] {
  return sb.standin.sends().map((s) => {
    const raw = JSON.parse(s.body) as Record<string, unknown>;
    return { chat_id: raw.chat_id, text: typeof raw.text === "string" ? raw.text : "", raw };
  });
}

// --- secrecy ----------------------------------------------------------------------
export interface Haystack {
  where: string;
  text: string;
}

function textFiles(dir: string, skip: string[]): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d)) {
      if (e === ".git") continue;
      const p = join(d, e);
      if (skip.includes(p)) continue;
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(p);
      else out.push(p);
    }
  };
  walk(dir);
  return out;
}

export function sweepSandbox(
  sb: NotifySandbox,
  extra: Haystack[] = [],
  skip: string[] = [],
): Haystack[] {
  const hays = [...extra];
  for (const p of textFiles(sb.dir, [sb.tokenFile, ...skip])) {
    try {
      hays.push({ where: p, text: readFileSync(p, "utf8") });
    } catch {
      /* unreadable or gone mid-sweep */
    }
  }
  return hays;
}

export function expectNoSecrets(hays: Haystack[], token: string, chat: string): void {
  for (const h of hays) {
    if (h.text.includes(token)) throw new Error(`the token is in ${h.where}`);
    if (h.text.includes(chat)) throw new Error(`the chat id is in ${h.where}`);
  }
}

/** The direct children's command lines, through the shared module. */
export function childCmdlines(pid: number): string[] {
  const out: string[] = [];
  for (const [child, info] of processTable()) {
    if (info.parent !== pid) continue;
    out.push(processCommandLine(child));
  }
  return out;
}

export function procEnviron(pid: number): string {
  return readFileSync(`/proc/${pid}/environ`, "utf8").replace(/\0/gu, "\n");
}

export function hasProc(): boolean {
  return existsSync("/proc/self/environ");
}

/** A live watcher under the sandbox env, for environ and argv reads. */
export async function withRunningWatcher(
  sb: NotifySandbox,
  fn: (pid: number) => void,
): Promise<void> {
  const env: Record<string, string | undefined> = { ...process.env, ...sb.env };
  const child = Bun.spawn([RUN, "runs-watch", "--timeout", "25", sb.runs], {
    env,
    stdout: "ignore",
    stderr: "ignore",
  });
  try {
    await Bun.sleep(2500);
    fn(child.pid);
  } finally {
    try {
      child.kill();
    } catch {
      /* already gone */
    }
    await child.exited;
  }
}
