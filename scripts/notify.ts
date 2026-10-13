// One Telegram message per thing that came up: the only script that sends the
// user a message (skills/postmaster/notifications.md). The watcher's scan owns
// every send: it reads one look's runs, builds fixed words from the flow's own
// records, and sends a single request with a line per event. No model writes a
// message, so no model's words and no record's text leave the machine.
//
//   run notify scan <runs-root>      one look's messages; silent unless a send newly fails
//   run notify test                  confirm setup with a test message to the user's chat
//   run notify clerk <repo> <ticket> the booking clerk's one message, when its draft is ready
//
// A scan messages a run's waiting marker on its appearance (the ship card when
// .card-ready sits beside it), each usage-limit wall once by its actions.jsonl
// index, and each shipped stage line once the same way. An appearance is the
// marker's file identity plus a hash of its words, so a remove-and-rewrite
// sends anew; only the hash is ever recorded, never the words. What was
// messaged is the run's own notify lines; what predates messages is the run's
// .notify-state.json, kept on every look, on or off, so switching messages on
// sends no backlog. A waiting appearance while every unruled wall stands
// messaged, or changed words in a messaged file with a wall still unruled, is
// the postmaster's wall step appending, and sends nothing more.
// A failed send leaves its events unsent for the next look; the first failure
// is written once to stderr (the watcher's watch.err) and once to the watched
// root's ledger, and nothing more until a send succeeds.
//
// The token file holds TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID and, for tests
// only, a loopback TELEGRAM_API_ORIGIN. A file that is missing, not a regular
// file, readable by others, or inside a git checkout is refused, and any other
// origin is refused, so a stray setting cannot send the token elsewhere. The
// token and the chat id never enter argv or the environment: this process reads
// the file itself, and every error is redacted before it is printed or logged.
//
//   exit 0  sent, nothing to send, messages off, or a recorded failure (scan);
//           the message went (test, clerk)
//   exit 1  usage, a refused token file, or a send that failed (test, clerk)
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { parseTicketRead } from "./clerk.ts";
import { tryTomlFile } from "./lib/data.ts";
import {
  effectiveConfigForProject,
  expandUser,
  globalConfigPath,
  repoTopLevel,
} from "./lib/effective-config.ts";
import { beside, physical, scriptsDir } from "./lib/paths.ts";
import { envOf } from "./plane.ts";
import { run } from "./lib/proc.ts";
import { pyWords } from "./lib/text.ts";
import { runRepo } from "./runs-watch.ts";
import { isSurveyWall, readWalls, type Wall } from "./walls.ts";

const SEND_TIMEOUT_MS = 10_000;
const MESSAGE_CAP = 4096;
const DEFAULT_ORIGIN = "https://api.telegram.org";
const DEFAULT_ENV_FILE = "~/.postmaster/telegram.env";
const STATE_FILE = ".notify-state.json";
const FAILED_MARKER = ".notify-failed";
const TEST_TEXT = "postmaster test message: notifications are on.";

type NotifyKind = "question" | "shipcard" | "wall" | "landed";

const KIND_RANK: Record<NotifyKind, number> = { shipcard: 0, question: 1, wall: 2, landed: 3 };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// --- the functional core ------------------------------------------------------------
/** Every secret out of an error text, longest first. */
export function redact(text: string, secrets: string[]): string {
  let out = text;
  for (const s of [...secrets].sort((a, b) => b.length - a.length)) {
    if (s !== "") out = out.split(s).join("[redacted]");
  }
  return out;
}

function pad(n: number, w: number): string {
  return String(n).padStart(w, "0");
}

/** Machine-zone ISO, as walls.ts localISO prints it, so a reset reads the same. */
function localISO(ms: number): string {
  const d = new Date(ms);
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}T${pad(d.getHours(), 2)}:${pad(d.getMinutes(), 2)}:${pad(d.getSeconds(), 2)}${sign}${pad(Math.floor(abs / 60), 2)}:${pad(abs % 60, 2)}`;
}

/** A wall's reset in the machine's zone, or fixed words when none was given. */
export function formatReset(reset: string): string {
  if (reset === "none") return "no reset time was given";
  const ms = Date.parse(reset);
  if (Number.isNaN(ms)) return "no reset time was given";
  return `resets ${localISO(ms)}`;
}

/** The kind's fixed words for one event. */
export function eventBody(kind: NotifyKind, lane: string, reset: string): string {
  switch (kind) {
    case "question":
      return "a question waits for you. Answer in the postmaster session.";
    case "shipcard":
      return "the ship card awaits your word. Answer in the postmaster session.";
    case "wall":
      return `lane ${lane} hit its provider's usage limit, ${formatReset(reset)}. Answer in the postmaster session.`;
    case "landed":
      return "the run landed.";
  }
}

/** One message line: the project, the ticket, the title where there is one. */
export function buildLine(
  project: string,
  ticket: string,
  title: string | null,
  body: string,
): string {
  const head =
    title === null || title === "" ? `${project} ${ticket}` : `${project} ${ticket} ${title}`;
  return `${head}: ${body}`;
}

/** The lines as one message, capped with how many more there are. Only the
 * kept lines went; the rest stay unsent for the next look. */
export function capMessage(lines: string[]): { text: string; kept: number } {
  let kept = lines.length;
  for (;;) {
    const more = lines.length - kept;
    const suffix = more > 0 ? `\n(+${more} more)` : "";
    const text = lines.slice(0, kept).join("\n") + suffix;
    if (text.length <= MESSAGE_CAP) return { text, kept };
    if (kept <= 1) return { text: `${lines[0]!.slice(0, MESSAGE_CAP - 3)}...`, kept: 1 };
    kept -= 1;
  }
}

/** A notify detail back into its kind, reference and sent line. */
export function parseNotifyDetail(detail: string): {
  kind: string;
  ref: string;
  text: string;
} | null {
  const words = pyWords(detail);
  if (words.length < 3) return null;
  const kind = words[0]!;
  if (kind !== "question" && kind !== "shipcard" && kind !== "wall" && kind !== "landed")
    return null;
  const ref = words[1]!;
  const kindAt = detail.indexOf(kind);
  const refAt = detail.indexOf(ref, kindAt + kind.length);
  const text = detail.slice(refAt + ref.length).trim();
  if (text === "") return null;
  return { kind, ref, text };
}

/** A run directory's ticket: the leading number, or the name itself. */
export function runTicket(runName: string): { display: string; number: string | null } {
  const m = /^([0-9]+)/u.exec(runName);
  if (!m) return { display: runName, number: null };
  return { display: `#${m[1]}`, number: m[1]! };
}

function isLoopbackHost(host: string): boolean {
  if (/^127\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/u.test(host)) {
    return host
      .split(".")
      .slice(1)
      .every((p) => Number(p) <= 255);
  }
  // URL keeps the brackets on an IPv6 hostname.
  return host === "::1" || host === "[::1]";
}

/** Why an API origin cannot be used, or null when it can: http(s) to loopback. */
export function originError(origin: string): string | null {
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return `not a URL: ${origin}`;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return `not http or https: ${origin}`;
  }
  if (!isLoopbackHost(u.hostname)) return `not a loopback address: ${origin}`;
  return null;
}

// --- the token file ------------------------------------------------------------------
export interface NotifySecrets {
  token: string;
  chat: string;
  origin: string;
}

export type EnvResult = { ok: true; secrets: NotifySecrets } | { ok: false; refusal: string };

/** The secrets from the env file, or the refusal with its fix. The file is
 * read by this process alone, never through argv or the environment. */
export function readEnvFile(rawPath: string): EnvResult {
  const path = expandUser(rawPath);
  let mode = 0;
  try {
    const st = statSync(path);
    if (!st.isFile()) {
      return {
        ok: false,
        refusal:
          `${path} is not a regular file; put TELEGRAM_BOT_TOKEN=<token> and ` +
          "TELEGRAM_CHAT_ID=<chat> in a regular file with mode 0600, outside any git checkout",
      };
    }
    mode = st.mode;
  } catch {
    return {
      ok: false,
      refusal:
        `no token file at ${path}; write TELEGRAM_BOT_TOKEN=<token> and ` +
        "TELEGRAM_CHAT_ID=<chat> there with mode 0600, outside any git checkout",
    };
  }
  if ((mode & 0o077) !== 0) {
    return {
      ok: false,
      refusal: `${path} is readable by others (mode ${(mode & 0o777).toString(8)}); run chmod 0600 ${path}`,
    };
  }
  const top = repoTopLevel(dirname(path));
  if (top !== "") {
    const real = physical(path);
    if (real === top || real.startsWith(`${top}/`)) {
      return {
        ok: false,
        refusal: `${path} is inside the git checkout at ${top}; move it outside any checkout`,
      };
    }
  }
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return { ok: false, refusal: `cannot read ${path}` };
  }
  let token = "";
  let chat = "";
  let origin = "";
  for (const line of text.split("\n")) {
    const kv = envOf(line);
    if (!kv) continue;
    if (kv[0] === "TELEGRAM_BOT_TOKEN") token = kv[1];
    else if (kv[0] === "TELEGRAM_CHAT_ID") chat = kv[1];
    else if (kv[0] === "TELEGRAM_API_ORIGIN") origin = kv[1];
  }
  if (token === "") {
    return {
      ok: false,
      refusal: `${path} names no TELEGRAM_BOT_TOKEN; write TELEGRAM_BOT_TOKEN=<token> and TELEGRAM_CHAT_ID=<chat> there`,
    };
  }
  if (chat === "") {
    return {
      ok: false,
      refusal: `${path} names no TELEGRAM_CHAT_ID; write TELEGRAM_BOT_TOKEN=<token> and TELEGRAM_CHAT_ID=<chat> there`,
    };
  }
  if (origin === "") return { ok: true, secrets: { token, chat, origin: DEFAULT_ORIGIN } };
  const bad = originError(origin);
  if (bad !== null) {
    return {
      ok: false,
      refusal: `TELEGRAM_API_ORIGIN in ${path} is ${bad}; only a loopback address may override the API origin`,
    };
  }
  return { ok: true, secrets: { token, chat, origin } };
}

// --- the send ------------------------------------------------------------------------
export type SendResult = { ok: true } | { ok: false; reason: string };

/** One request: plain text, no parse mode, a few seconds of patience. */
export async function sendMessage(secrets: NotifySecrets, text: string): Promise<SendResult> {
  const url = `${secrets.origin}/bot${secrets.token}/sendMessage`;
  let res: Awaited<ReturnType<typeof fetch>>;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: secrets.chat, text }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: redact(`send failed: ${msg}`, [secrets.token, secrets.chat]) };
  }
  if (!res.ok) return { ok: false, reason: `send failed: HTTP ${res.status}` };
  try {
    const body: unknown = await res.json();
    if (isRecord(body) && body.ok === false) {
      return { ok: false, reason: "send failed: the service refused the message" };
    }
  } catch {
    /* a 200 that is not JSON still counts as sent */
  }
  return { ok: true };
}

// --- the scan --------------------------------------------------------------------------
export interface NotifySettings {
  on: boolean;
  envFile: string;
}

function notifyTable(root: string, configPath: string): { channel: string; envFile: string } {
  let channel = "";
  let envFile = "";
  const global = tryTomlFile(expandUser(configPath));
  const g = global?.notify;
  if (isRecord(g)) {
    if (typeof g.channel === "string") channel = g.channel;
    if (typeof g.env_file === "string") envFile = g.env_file;
  }
  const repo = repoTopLevel(root);
  if (repo !== "") {
    // Silent here: the watcher already said the notice and the error, every look.
    const resolved = effectiveConfigForProject(repo, configPath);
    if (resolved.config !== null && resolved.error !== null) {
      const t = (resolved.config as Record<string, unknown>).notify;
      if (isRecord(t)) {
        if (typeof t.channel === "string") channel = t.channel;
        if (typeof t.env_file === "string") envFile = t.env_file;
      }
    }
  }
  return { channel, envFile };
}

function notifySettings(root: string, configPath: string): NotifySettings {
  const table = notifyTable(root, configPath);
  if (table.channel !== "telegram") return { on: false, envFile: "" };
  return { on: true, envFile: table.envFile === "" ? DEFAULT_ENV_FILE : table.envFile };
}

interface NotifyState {
  v: number;
  toldWalls: number[];
  shipped: number[];
}

interface ActionRow {
  index: number;
  action: string;
  target: string;
  detail: string;
}

/** Every action row with the walls.ts numbering: the 0-based line number over
 * all lines, so a wall's index and a shipped line's index read the same. */
function readActionRows(dispatch: string): ActionRow[] {
  let text: string;
  try {
    text = readFileSync(join(dispatch, "actions.jsonl"), "utf8");
  } catch {
    return [];
  }
  const rows: ActionRow[] = [];
  let index = 0;
  for (const line of text.split("\n")) {
    if (line.trim() !== "") {
      let e: unknown = null;
      try {
        e = JSON.parse(line);
      } catch {
        e = null;
      }
      if (isRecord(e)) {
        rows.push({
          index,
          action: typeof e.action === "string" ? e.action : "",
          target: typeof e.target === "string" ? e.target : "",
          detail: typeof e.detail === "string" ? e.detail : "",
        });
      }
    }
    index += 1;
  }
  return rows;
}

function readState(dispatch: string): NotifyState | null {
  let v: unknown;
  try {
    v = JSON.parse(readFileSync(join(dispatch, STATE_FILE), "utf8"));
  } catch {
    return null;
  }
  if (!isRecord(v) || !Array.isArray(v.toldWalls) || !Array.isArray(v.shipped)) return null;
  const nums = (a: unknown[]): number[] | null => {
    const out: number[] = [];
    for (const n of a) {
      if (typeof n !== "number" || !Number.isInteger(n)) return null;
      out.push(n);
    }
    return out;
  };
  const told = nums(v.toldWalls);
  const shipped = nums(v.shipped);
  if (told === null || shipped === null) return null;
  return { v: 1, toldWalls: told, shipped };
}

function currentBaseline(walls: Wall[], rows: ActionRow[]): NotifyState {
  return {
    v: 1,
    toldWalls: walls.filter((w) => w.told).map((w) => w.index),
    shipped: rows.filter((r) => r.action === "stage" && r.target === "shipped").map((r) => r.index),
  };
}

function writeState(dispatch: string, state: NotifyState): boolean {
  try {
    writeFileSync(join(dispatch, STATE_FILE), `${JSON.stringify(state)}\n`);
    return true;
  } catch {
    return false;
  }
}

interface NotifyEvent {
  run: string;
  dispatch: string;
  kind: NotifyKind;
  ref: string;
  target: string;
  number: string | null;
  lane: string;
  reset: string;
  line: string;
}

/** One waiting appearance: the marker's file identity and a hash of its words.
 * Inodes are reused and clocks are coarse, so a remove-and-rewrite in the
 * same millisecond reads identical by stat alone; the words tell it apart.
 * Only the hash is ever recorded, never the words. */
function waitingIdent(dispatch: string): string | null {
  try {
    const p = join(dispatch, ".waiting-on-user");
    const st = statSync(p);
    const sha = createHash("sha256").update(readFileSync(p, "utf8")).digest("hex").slice(0, 16);
    return `${st.dev}:${st.ino}:${st.birthtimeMs}:${sha}`;
  } catch {
    return null;
  }
}

/** This look's new events for one run: unmessaged walls and landings, and a
 * waiting appearance that is not the postmaster's wall step appending. */
function collectEvents(
  runName: string,
  dispatch: string,
  walls: Wall[],
  rows: ActionRow[],
  state: NotifyState,
): NotifyEvent[] {
  const ticket = runTicket(runName);
  const messaged = new Map<string, Set<string>>();
  for (const r of rows) {
    if (r.action !== "notify" || r.target !== ticket.display) continue;
    const p = parseNotifyDetail(r.detail);
    if (p === null) continue;
    let set = messaged.get(p.kind);
    if (!set) {
      set = new Set();
      messaged.set(p.kind, set);
    }
    set.add(p.ref);
  }
  const told = (kind: string, ref: string): boolean => messaged.get(kind)?.has(ref) ?? false;
  const events: NotifyEvent[] = [];
  const live = walls.filter((w) => !isSurveyWall(w));
  for (const w of live) {
    if (told("wall", String(w.index)) || state.toldWalls.includes(w.index)) continue;
    events.push({
      run: runName,
      dispatch,
      kind: "wall",
      ref: String(w.index),
      target: ticket.display,
      number: ticket.number,
      lane: w.lane,
      reset: w.reset,
      line: "",
    });
  }
  for (const r of rows) {
    if (r.action !== "stage" || r.target !== "shipped") continue;
    if (told("landed", String(r.index)) || state.shipped.includes(r.index)) continue;
    events.push({
      run: runName,
      dispatch,
      kind: "landed",
      ref: String(r.index),
      target: ticket.display,
      number: ticket.number,
      lane: "",
      reset: "",
      line: "",
    });
  }
  const ident = waitingIdent(dispatch);
  if (ident !== null) {
    const kind: NotifyKind = existsSync(join(dispatch, ".card-ready")) ? "shipcard" : "question";
    if (!told("question", ident) && !told("shipcard", ident)) {
      const unruled = live.filter((w) => !w.ruled);
      // The flow's only in-place change to the marker is the postmaster's
      // wall step appending beside the words already there, so changed words
      // in the same file with a wall still unruled are that append, messaged
      // or still waiting on a retry, and send nothing more.
      const filePart = ident.split(":").slice(0, 3).join(":");
      const sameFileMessaged = ["question", "shipcard"].some((k) =>
        [...(messaged.get(k) ?? [])].some(
          (ref) => ref.split(":").slice(0, 3).join(":") === filePart,
        ),
      );
      const suppress =
        unruled.length > 0 &&
        (unruled.every((w) => told("wall", String(w.index))) || sameFileMessaged);
      if (!suppress) {
        events.push({
          run: runName,
          dispatch,
          kind,
          ref: ident,
          target: ticket.display,
          number: ticket.number,
          lane: "",
          reset: "",
          line: "",
        });
      }
    }
  }
  return events;
}

function listRuns(root: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(root).sort();
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    if (e === "postmaster") continue;
    try {
      if (!statSync(join(root, e)).isDirectory()) continue;
    } catch {
      continue;
    }
    out.push(join(root, e));
  }
  return out;
}

function trackerKindOf(repo: string): string | null {
  // Capped: a hung tracker lookup degrades the message to the number alone,
  // never the look.
  const r = run(beside(import.meta, "run"), ["tracker-kind", repo], { timeout: 15_000 });
  if (r.code !== 0) return null;
  return r.out.trim();
}

/** The ticket's title through the tracker adapter, or null for kind other and
 * every failure: those messages carry the number alone. */
function ticketTitle(repo: string, kind: string, ticket: string): string | null {
  if (kind === "other") return null;
  const base = kind === "plane" ? [] : [repo];
  const r = run(beside(import.meta, "run"), [kind, ...base, "read", ticket], { timeout: 15_000 });
  if (r.code !== 0) return null;
  const title = parseTicketRead(r.out).title;
  return title === "" ? null : title;
}

function runProject(dispatch: string, root: string): string {
  const repo = runRepo(dispatch) ?? (repoTopLevel(root) || null);
  return basename((repo ?? root).replace(/\/+$/u, ""));
}

/** The first failure goes once to stderr and once to the root's ledger, and
 * nothing more until a send succeeds. */
function recordFailure(root: string, reason: string): void {
  const dir = join(root, "postmaster");
  const marker = join(dir, FAILED_MARKER);
  if (!existsSync(marker)) {
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(marker, `${reason}\n`);
    } catch {
      /* the report below still goes out for this look */
    }
    process.stderr.write(`notify: ${reason}\n`);
    run(beside(import.meta, "run"), [
      "log-action",
      "--root",
      root,
      "postmaster",
      "notify",
      "telegram",
      `failed ${reason}`,
    ]);
  }
}

function clearFailure(root: string): void {
  try {
    rmSync(join(root, "postmaster", FAILED_MARKER), { force: true });
  } catch {
    /* best effort */
  }
}

/** One look over a runs root: held runs included, a hold stops the watcher's
 * steps but not the user's messages. Never throws: a send that fails never
 * stops or holds up a run. */
export async function scanRoot(root: string): Promise<void> {
  const settings = notifySettings(root, globalConfigPath());
  const runs = listRuns(root);
  const states = new Map<string, NotifyState>();
  for (const d of runs) {
    const walls = readWalls(d);
    const rows = readActionRows(d);
    const current = currentBaseline(walls, rows);
    if (!settings.on) {
      writeState(d, current);
      states.set(d, current);
      continue;
    }
    const prev = readState(d);
    if (prev === null) {
      if (!writeState(d, current)) {
        recordFailure(root, `cannot keep the message record in ${d}`);
        return;
      }
      states.set(d, current);
    } else {
      states.set(d, prev);
    }
  }
  if (!settings.on) return;
  let events: NotifyEvent[] = [];
  for (const d of runs) {
    events = events.concat(
      collectEvents(basename(d), d, readWalls(d), readActionRows(d), states.get(d)!),
    );
  }
  if (events.length === 0) return;
  events.sort(
    (a, b) =>
      (a.run < b.run ? -1 : a.run > b.run ? 1 : KIND_RANK[a.kind] - KIND_RANK[b.kind]) ||
      (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0),
  );
  const titles = new Map<string, string | null>();
  for (const ev of events) {
    const repo = runRepo(ev.dispatch);
    let title: string | null = null;
    if (repo !== null && ev.number !== null) {
      const key = JSON.stringify([repo, ev.number]);
      if (!titles.has(key)) {
        const kind = trackerKindOf(repo);
        titles.set(key, kind === null ? null : ticketTitle(repo, kind, ev.number));
      }
      title = titles.get(key) ?? null;
    }
    ev.line = buildLine(
      runProject(ev.dispatch, root),
      ev.target,
      title,
      eventBody(ev.kind, ev.lane, ev.reset),
    );
  }
  const capped = capMessage(events.map((e) => e.line));
  const env = readEnvFile(settings.envFile);
  if (!env.ok) {
    recordFailure(root, env.refusal);
    return;
  }
  const sent = await sendMessage(env.secrets, capped.text);
  if (!sent.ok) {
    recordFailure(root, sent.reason);
    return;
  }
  let logged = true;
  for (const ev of events.slice(0, capped.kept)) {
    const r = run(beside(import.meta, "run"), [
      "log-action",
      ev.dispatch,
      "postmaster",
      "notify",
      ev.target,
      `${ev.kind} ${ev.ref} ${ev.line}`,
    ]);
    if (r.code !== 0) logged = false;
  }
  if (!logged) {
    recordFailure(root, "the message went but was not logged; it sends again next look");
    return;
  }
  clearFailure(root);
}

// --- the clerk and the test ------------------------------------------------------------
/** The ticket as the message names it, as clerk.ts displayId names it. */
function displayTicket(kind: string | null, id: string): string {
  if (kind === "plane") return id.includes("-") ? id : `PM-${id}`;
  if (kind === "other") return id;
  return `#${id}`;
}

async function clerkCmd(repo: string, ticketArg: string): Promise<number> {
  const resolved = effectiveConfigForProject(repo);
  if (resolved.notice !== null) console.error(resolved.notice);
  if (resolved.config === null || resolved.error !== null) return 0;
  const t = (resolved.config as Record<string, unknown>).notify;
  if (!isRecord(t) || t.channel !== "telegram") return 0;
  const envFile =
    typeof t.env_file === "string" && t.env_file !== "" ? t.env_file : DEFAULT_ENV_FILE;
  const env = readEnvFile(envFile);
  if (!env.ok) {
    console.error(`notify: ${env.refusal}`);
    return 1;
  }
  const id = ticketArg.startsWith("#") ? ticketArg.slice(1) : ticketArg;
  const kind = trackerKindOf(repo);
  const title = kind === null ? null : ticketTitle(repo, kind, id);
  const display = displayTicket(kind, id);
  const project = basename(repo.replace(/\/+$/u, ""));
  const line = buildLine(
    project,
    display,
    title,
    "the clerk's draft is ready. Answer in the clerk session.",
  );
  const sent = await sendMessage(env.secrets, line);
  if (!sent.ok) {
    console.error(`notify: ${sent.reason}`);
    return 1;
  }
  const logged = run(beside(import.meta, "run"), [
    "log-action",
    "--project",
    repo,
    "clerk",
    "notify",
    display,
    `clerk ${line}`,
  ]);
  if (logged.code !== 0) {
    console.error(
      `notify: the message went but was not logged: ${(logged.out + logged.err).trim()}`,
    );
    return 1;
  }
  return 0;
}

async function testCmd(): Promise<number> {
  const path = expandUser(globalConfigPath());
  const global = tryTomlFile(path);
  const raw = global?.notify;
  if (!isRecord(raw) || raw.channel !== "telegram") {
    console.error(
      `notify: messages are off (no [notify] table with channel = "telegram" in ${path})`,
    );
    return 1;
  }
  const envFile =
    typeof raw.env_file === "string" && raw.env_file !== "" ? raw.env_file : DEFAULT_ENV_FILE;
  const env = readEnvFile(envFile);
  if (!env.ok) {
    console.error(`notify: ${env.refusal}`);
    return 1;
  }
  const sent = await sendMessage(env.secrets, TEST_TEXT);
  if (!sent.ok) {
    console.error(`notify: ${sent.reason}`);
    return 1;
  }
  console.log("notify: test message sent");
  return 0;
}

async function scanCmd(root: string): Promise<number> {
  try {
    if (!statSync(root).isDirectory()) throw new Error("not dir");
  } catch {
    console.error(`notify: no such root: ${root}`);
    return 1;
  }
  try {
    await scanRoot(root);
  } catch (e) {
    console.error(`notify: scan failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  return 0;
}

// --- entry ------------------------------------------------------------------------------
function printHelp(): never {
  const src = readFileSync(join(scriptsDir(import.meta), "notify.ts"), "utf8");
  for (const l of src.split("\n")) {
    if (!l.startsWith("//")) break;
    console.log(l.replace(/^\/\/ ?/u, ""));
  }
  process.exit(0);
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (cmd === "scan" && rest.length === 1 && rest[0]) return scanCmd(rest[0]);
  if (cmd === "test" && rest.length === 0) return testCmd();
  if (cmd === "clerk" && rest.length === 2 && rest[0] && rest[1]) return clerkCmd(rest[0], rest[1]);
  if (cmd === "--help" || cmd === "-h") printHelp();
  console.error("usage: run notify scan <runs-root> | test | clerk <repo> <ticket>");
  return 1;
}

if (import.meta.main) {
  const code = await main(process.argv.slice(2));
  process.exit(code);
}
