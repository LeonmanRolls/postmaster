#!/usr/bin/env bun
import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { command, scriptDir, writeError, writeOut } from "./lib/core.ts";

const here = scriptDir(import.meta.url),
  tool = dirname(here),
  usage =
    "usage: tool-faults.sh harvest <dispatch> | comment <dispatch> <id> [<ticket>] | file <dispatch> <id> | decline <dispatch> <id> <the user's word> | --self-test";
const asking = new Set(["new", "asked", "unchecked", "kept"]);
const doneRE = /^tool fault (tf-[0-9a-f]{8}) (filed|seen again|declined) in run ([0-9a-f]+)\b/;
const TOKEN = /[~<>\p{L}\p{N}_.@+/-]+/gu;
const URL = /\b[A-Za-z][A-Za-z0-9+.-]{0,30}:\/\/[^\s)\]>'"`]+/g;
const EMAIL = /(?<![\w.+-])[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const IPV4 = /(?<![\w.])\d{1,3}(?:\.\d{1,3}){3}(?![\w.])/g;
const KEY = /(?<![\w-])[A-Z][A-Z0-9]{1,9}-\d+(?![\w-])/g;
const FILELIKE = /[\w-]+(?:\.[\w-]+)*\.[A-Za-z]\w{1,7}/;
const FAULT_ID = /\btf-[0-9a-f]{8}\b/g;
const HEX = /\b(?=[0-9a-f]*\d)[0-9a-f]{7,40}\b/g;
const MARK = /\[(?:path|project|ticket text|ticket|code|link|address|withheld)\]/g;
const WORD = /[\p{L}\p{M}]+(?:'[\p{L}\p{M}]+)*/gu;
const WTOK = /[\p{L}\p{M}\p{N}_]+/gu;
const TICKS = /`([^`\n]+)`/g;
const HELD = new RegExp(`${String.fromCharCode(1)}(\\d+)${String.fromCharCode(2)}`, "g");
type Dict = Record<string, any>;
type LogEntry = Dict & { action?: string; actor?: string; target?: string; detail?: string; fault?: Dict };
type Group = {
  id: string;
  file: string;
  entries: LogEntry[];
  at: number;
  control: string;
  workarounds: string[];
  escalated: boolean;
};
type RecordItem = Dict & { id: string; run_id: string; state: string; ticket?: string; draft?: string; sha?: string };
type StateFile = Dict & {
  runs?: Array<Dict & { run_id: string; first: number }>;
  faults?: RecordItem[];
  lines?: number;
};
type RunResult = { code: number; stdout: string; stderr: string };
class ToolFaultError extends Error {
  constructor(
    message: string,
    readonly code = 1,
  ) {
    super(message);
  }
}
function die(message: string, code = 1): never {
  throw new ToolFaultError(message, code);
}
function run(
  program: string,
  args: string[] = [],
  options: { cwd?: string; env?: Record<string, string | undefined> } = {},
): RunResult {
  return command(program, args, options);
}
function why(result: RunResult): string {
  return (result.stderr || result.stdout).trim().split(/\r?\n/).filter(Boolean).at(-1) ?? `exit ${result.code}`;
}
function git(where: string, ...args: string[]): string {
  const result = run("git", ["-C", where, ...args]);
  return result.code === 0 ? result.stdout.trim() : "";
}
function readObject(path: string): Dict {
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}
function writeObject(path: string, value: unknown): void {
  const dir = dirname(path);
  const temp = mkdtempSync(join(dir, ".tool-faults-"));
  try {
    writeFileSync(join(temp, "state"), `${JSON.stringify(value, null, 2)}\n`);
    renameSync(join(temp, "state"), path);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
function readLog(path: string): [LogEntry[], number[]] {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [[], []];
  }
  const entries: LogEntry[] = [],
    bad: number[] = [];
  text.split("\n").forEach((line, i) => {
    if (!line.trim()) return;
    try {
      const value = JSON.parse(line);
      if (value && typeof value === "object" && !Array.isArray(value)) entries.push(value as LogEntry);
      else bad.push(i + 1);
    } catch {
      bad.push(i + 1);
    }
  });
  return [entries, bad];
}
function faultFields(entry: LogEntry): Dict {
  return entry.fault && typeof entry.fault === "object" ? entry.fault : {};
}
function makeLog(dispatch: string, action: string, target: string, detail: string): void {
  const result = run(join(here, "log-action.sh"), [dispatch, "postmaster", action, target, detail]);
  if (result.code !== 0) die(`the log could not be written: ${why(result)}`);
}
function closed(dispatch: string, ongoing: boolean): void {
  if (ongoing) return;
  let stage: unknown;
  try {
    stage = JSON.parse(readFileSync(join(dispatch, "manifest.json"), "utf8")).stage;
  } catch {
    die(`${dispatch} has no manifest to read`);
  }
  if (stage !== "done" && stage !== "abandoned")
    die(`the run is still open (stage ${String(stage)}); its faults are harvested when it closes`);
}
function ownRun(dispatch: string): Dict {
  return readObject(join(dispatch, "run.json")).postmaster ?? {};
}
function ownIds(state: StateFile, dispatch: string): Set<string> {
  const commit = String(ownRun(dispatch).commit ?? "");
  const ids = new Set((state.runs ?? []).map((entry) => String(entry.run_id)));
  if (commit) {
    ids.add(commit);
    ids.add(commit.slice(0, 12));
  }
  return ids;
}
function meta(dispatch: string): string {
  const pm = ownRun(dispatch);
  if (!pm.commit) return "";
  return `, which ran postmaster ${String(pm.commit).slice(0, 12)}${pm.uncommitted_changes ? " with uncommitted changes" : ""}`;
}
function seen(count: number): string {
  return count === 1 ? "once" : `${count} times`;
}
function newId(): string {
  for (;;) {
    const id = randomBytes(5).toString("hex");
    if (/\d/.test(id)) return id;
  }
}
function ownCheckout(): boolean {
  const top = git(tool, "rev-parse", "--show-toplevel");
  return !!top && resolve(top) === resolve(tool);
}
function commonDir(where: string): string {
  const out = git(where, "rev-parse", "--git-common-dir");
  return out && !out.includes("\n") ? resolve(where, out) : "";
}
function remote(where: string): [string, string] | null {
  const url = git(where, "remote", "get-url", "origin");
  if (!url) return null;
  const match =
    url.match(/^[A-Za-z][A-Za-z0-9+.-]*:\/\/(?:[^@/]*@)?([^/:?#]+)(?::\d+)?\/+(.+?)(?:\.git)?\/*$/) ??
    url.match(/^(?:[^@/:]+@)?([^/:]+):(?!\/\/)(.+?)(?:\.git)?\/*$/);
  if (match?.[1] && match[2]) return [match[1].toLowerCase(), match[2]];
  return ["", url.replace(/\/+$/, "")];
}
function sameRepo(repo: string): boolean {
  if (!ownCheckout()) return false;
  const a = commonDir(repo),
    b = commonDir(tool);
  if (a && a === b) return true;
  const ra = remote(repo),
    rb = remote(tool);
  return !!ra && !!rb && !!ra[0] && ra[0] === rb[0] && ra[1].toLowerCase() === rb[1].toLowerCase();
}
function profileRepo(waybill: string): string | null {
  const starts = [...waybill.matchAll(/^## Project profile[ \t]*$/gm)];
  const start = starts.at(-1)?.index;
  if (start === undefined) return null;
  const body = waybill.slice(start + (starts.at(-1)?.[0].length ?? 0));
  const end = body.search(/^## /m),
    section = end < 0 ? body : body.slice(0, end);
  const match = section.match(/^repo:[ \t]*(\S.*?)(?:[ \t]{2,}\S.*)?[ \t]*$/m);
  if (!match?.[1]) return null;
  const raw = match[1].trim();
  return raw === "~"
    ? (process.env.HOME ?? "~")
    : raw.startsWith("~/")
      ? join(process.env.HOME ?? "~", raw.slice(2))
      : raw;
}
function wordList(text: string): string[] {
  return [...text.matchAll(WORD)].map((match) => match[0].toLowerCase());
}
function grams(words: string[]): Set<string> {
  const result = new Set<string>();
  for (let i = 0; i <= words.length - 4; i++) result.add(words.slice(i, i + 4).join("\0"));
  return result;
}
function regexEscape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function controlList(): Map<string, string> {
  const result = new Map<string, string>();
  try {
    for (const line of readFileSync(join(tool, "skills/postmaster/controls.md"), "utf8").split(/\r?\n/)) {
      const cells = line
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((cell: string) => cell.trim());
      const path = cells[0]?.match(/^`(?:<tool>\/)?([^`]+)`$/);
      if (path && /^[\w-]+$/.test(cells[1] ?? "")) result.set(path[1]!, cells[1]!);
    }
  } catch {
    return result;
  }
  return result;
}
class Safe {
  private vocab = new Set<string>();
  private tokenSet = new Set<string>();
  private paths = new Set<string>();
  private files = new Set<string>();
  private urls = new Set<string>();
  private keys = new Set<string>();
  private ids: Set<string>;
  private names: RegExp | null = null;
  private waybillWords = new Set<string>();
  private waybillGrams = new Set<string>();
  constructor(ids: Set<string>, dispatch: string, ongoing: boolean) {
    this.ids = ids;
    const files: string[] = [];
    for (const sub of ["scripts", "skills", "wiki"]) {
      const root = join(tool, sub);
      if (!existsSync(root)) continue;
      const walk = (folder: string) => {
        for (const entry of readdirSync(folder, { withFileTypes: true })) {
          const path = join(folder, entry.name);
          if (entry.isDirectory()) walk(path);
          else if (entry.isFile()) files.push(path);
        }
      };
      walk(root);
    }
    for (const entry of readdirSync(tool, { withFileTypes: true }))
      if (entry.isFile() && entry.name.endsWith(".md")) files.push(join(tool, entry.name));
    files.push(join(tool, "config.example.toml"));
    const texts: string[] = [];
    for (const file of files) {
      try {
        texts.push(readFileSync(file, "utf8"));
      } catch {
        // A file disappearing during a harvest is not trusted publication text.
      }
    }
    const own = texts.join("\n"),
      ownWords = wordList(own);
    this.vocab = new Set(ownWords);
    this.tokenSet = new Set([...own.matchAll(WTOK)].map((match) => match[0].toLowerCase()));
    for (const token of own.matchAll(TOKEN)) {
      const value = token[0].toLowerCase();
      if (value.includes("/")) this.paths.add(value);
      if (FILELIKE.test(token[0])) this.files.add(value);
    }
    for (const file of files) this.files.add(basename(file).toLowerCase());
    this.urls = new Set([...own.matchAll(URL)].map((match) => match[0].toLowerCase().replace(/[.,;:]+$/, "")));
    this.keys = new Set([...own.matchAll(KEY)].map((match) => match[0]));
    let waybill = "";
    try {
      waybill = readFileSync(join(dispatch, "brief.md"), "utf8");
    } catch {
      // An absent waybill simply provides no additional text to withhold.
    }
    const repo = profileRepo(waybill);
    const names = new Set<string>();
    if (repo && existsSync(repo) && sameRepo(repo)) waybill = "";
    else {
      names.add(basename(dirname(dispatch)));
      if (!ongoing) names.add(basename(dispatch));
      const ticket = ongoing ? null : basename(dispatch).match(/^([A-Za-z][A-Za-z0-9]*)[-_]\d+$/);
      if (ticket) names.add(ticket[1]!);
      if (repo) {
        names.add(basename(repo));
        if (existsSync(repo)) {
          const r = remote(repo);
          if (r?.[0]) for (const part of r[1].split("/").slice(-2)) names.add(part);
          else if (r) names.add(basename(r[1]));
        }
      }
    }
    const sorted = [...names]
      .filter((name) => name.length >= 2 && !/^\d+$/.test(name) && !this.vocab.has(name.toLowerCase()))
      .sort((a, b) => b.length - a.length);
    if (sorted.length) this.names = new RegExp(`(?<![^\\W_])(${sorted.map(regexEscape).join("|")})(?![^\\W_])`, "giu");
    const wbWords = wordList(waybill);
    this.waybillWords = new Set(wbWords.filter((word) => !this.vocab.has(word)));
    this.waybillGrams = new Set([...grams(wbWords)].filter((gram) => !grams(ownWords).has(gram)));
  }
  ownPath(path: string): string | null {
    const input = path.startsWith("./") ? path.slice(2) : path;
    try {
      let relativePath = input;
      if (isAbsolute(input)) {
        const abs = resolve(input),
          root = resolve(tool);
        if (!abs.startsWith(`${root}/`)) return null;
        relativePath = relative(root, abs);
      }
      if (
        relativePath &&
        !relativePath.startsWith("~") &&
        !relativePath.split("/").includes("..") &&
        existsSync(join(tool, relativePath))
      )
        return relativePath;
    } catch {
      return null;
    }
    return this.paths.has(path.toLowerCase()) ? path : null;
  }
  publish(input: string): string {
    const held: string[] = [];
    const hold = (value: string) => {
      held.push(value);
      return `\x01${held.length - 1}\x02`;
    };
    const marker = input.replace(new RegExp(`[${String.fromCharCode(1)}${String.fromCharCode(2)}]`, "g"), "");
    let text = marker.replace(MARK, (value) => hold(value));
    text = text.replace(FAULT_ID, (value) => hold(value));
    text = text.replace(URL, (value) =>
      hold(this.urls.has(value.toLowerCase().replace(/[.,;:]+$/, "")) ? value : "[link]"),
    );
    text = text.replace(EMAIL, () => hold("[address]"));
    text = text.replace(IPV4, () => hold("[address]"));
    text = text.replace(TOKEN, (value) => {
      const core = value.replace(/[.,:]+$/, ""),
        suffix = value.slice(core.length);
      if (core.includes("/") && /\p{L}|\d/u.test(core)) return `${hold(this.ownPath(core) ?? "[path]")}${suffix}`;
      if (FILELIKE.test(core)) return `${hold(this.files.has(core.toLowerCase()) ? core : "[path]")}${suffix}`;
      return value;
    });
    text = text.replace(HEX, (value) => (this.ids.has(value) ? hold(value) : value));
    text = text.replace(KEY, (value) => hold(this.keys.has(value) ? value : "[ticket]"));
    if (this.names) text = text.replace(this.names, () => hold("[project]"));
    const spans = [...text.matchAll(WORD)].map((match) => ({
      start: match.index!,
      end: match.index! + match[0].length,
      word: match[0].toLowerCase(),
    }));
    const hidden = new Set<number>();
    for (let i = 0; i <= spans.length - 4; i++) {
      if (
        this.waybillGrams.has(
          spans
            .slice(i, i + 4)
            .map((span) => span.word)
            .join("\0"),
        )
      )
        for (let j = i; j < i + 4; j++) hidden.add(j);
    }
    const runs: Array<[number, number]> = [];
    for (const i of [...hidden].sort((a, b) => a - b)) {
      const last = runs.at(-1);
      if (last && last[1] === i - 1) last[1] = i;
      else runs.push([i, i]);
    }
    for (const [first, last] of runs.reverse()) {
      const a = spans[first]!,
        b = spans[last]!;
      text = `${text.slice(0, a.start)}${hold("[ticket text]")}${text.slice(b.end)}`;
    }
    const safeCode = (word: string) =>
      this.tokenSet.has(word.toLowerCase()) || (/^\d+$/.test(word) && word.length < 7)
        ? word
        : /^\d+$/.test(word) || word.includes("_") || /\d/.test(word) || /[a-z][A-Z]/.test(word)
          ? hold("[code]")
          : word;
    text = text.replace(
      TICKS,
      (_all, contents: string) =>
        `\`${contents.replace(WTOK, (word) =>
          this.tokenSet.has(word.toLowerCase()) || (/^\d+$/.test(word) && word.length < 7) ? word : hold("[code]"),
        )}\``,
    );
    text = text.replace(WTOK, safeCode);
    text = text.replace(WORD, (word) => {
      const lower = word.toLowerCase();
      if (this.vocab.has(lower)) return word;
      if (
        this.waybillWords.has(lower) ||
        [...word].some((character) => character.codePointAt(0)! > 127) ||
        word !== word.toLowerCase()
      )
        return hold("[withheld]");
      return word;
    });
    return text.replace(HELD, (_all, index: string) => held[Number(index)] ?? "");
  }
  key(failed: string): string {
    let text = failed.replace(TOKEN, (value) =>
      value.includes("/") && /\p{L}|\d/u.test(value)
        ? ` ${this.ownPath(value.replace(/[.,:]+$/, "")) ?? "path"} `
        : value,
    );
    if (this.names) text = text.replace(this.names, " project ");
    text = text.toLowerCase().replace(FAULT_ID, " id ").replace(HEX, " id ").replace(/\d+/g, " n ");
    return [...text.matchAll(/[\p{L}\p{M}]+/gu)].map((match) => match[0]).join(" ");
  }
}
function faults(entries: LogEntry[], safe: Safe, first: number): Group[] {
  const listed = controlList(),
    groups = new Map<string, Group>();
  let count = 0;
  entries.forEach((entry, index) => {
    if (entry.action !== "tool-fault") return;
    count++;
    if (count <= first) return;
    const file = String(entry.target ?? ""),
      failed = String(faultFields(entry).failed ?? "");
    const id = `tf-${createHash("sha256")
      .update(`${file}\n${safe.key(failed)}`)
      .digest("hex")
      .slice(0, 8)}`;
    const group = groups.get(id) ?? {
      id,
      file,
      entries: [],
      at: index,
      control: "",
      workarounds: [],
      escalated: false,
    };
    group.entries.push(entry);
    groups.set(id, group);
  });
  for (const group of groups.values()) {
    group.control =
      String(group.entries.find((entry) => faultFields(entry).control)?.fault?.control ?? "") ||
      listed.get(group.file) ||
      "";
    group.workarounds = group.entries.map((entry) => String(faultFields(entry).workaround ?? "")).filter(Boolean);
    group.escalated = entries
      .slice(group.at + 1)
      .some((entry) => entry.action === "escalate" && safe.ownPath(String(entry.target ?? "")) === group.file);
  }
  return [...groups.values()];
}
function doneOf(entries: LogEntry[]): Map<string, [string, string]> {
  const out = new Map<string, [string, string]>();
  for (const entry of entries) {
    const match = String(entry.detail ?? "").match(doneRE);
    if (
      match &&
      entry.actor === "postmaster" &&
      ["ticket-create", "ticket-comment", "note"].includes(String(entry.action))
    ) {
      const state = { filed: "filed", "seen again": "commented", declined: "declined" }[
        match[2] as "filed" | "seen again" | "declined"
      ]!;
      out.set(`${match[1]}\0${match[3]}`, [state, entry.action === "note" ? "" : String(entry.target ?? "")]);
    }
  }
  return out;
}
function tidy(text: string): string {
  return text.split(/\s+/).filter(Boolean).join(" ");
}
function clip(text: string, length: number): string {
  if (text.length <= length) return text;
  const cut = text.slice(0, length - 3),
    lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace >= 0 ? cut.slice(0, lastSpace) : cut).replace(/[ ,;:]+$/, "")}...`;
}
function draft(group: Group, id: string, safe: Safe, dispatch: string): [string, string] {
  const file = safe.publish(group.file),
    entries = group.entries,
    failed = tidy(safe.publish(String(faultFields(entries[0]!).failed ?? ""))),
    fixes = [...new Set(entries.map((entry) => tidy(safe.publish(String(faultFields(entry).fix ?? "")))))],
    roles = safe.publish([...new Set(entries.map((entry) => String(entry.actor ?? "")))].join(" and ")),
    title = `Tool fault in ${file}: ${clip(failed.replace(/\.$/, ""), 90)} [${group.id}]`,
    facts = [`A run met a fault in \`${file}\`: ${failed}${/[.!?]$/.test(failed) ? "" : "."}`];
  if (group.control) facts.push(`It is a fault in a control (${group.control}), which stops the leg.`);
  if (group.workarounds.length) facts.push("The run worked around it.");
  if (group.escalated) facts.push("The run stopped and escalated.");
  facts.push(`It was seen ${seen(entries.length)} in run ${id}${meta(dispatch)}.`);
  const direction =
    fixes.length === 1
      ? [`The fix the ${roles} that met it proposed: ${fixes[0]}`]
      : [`The fixes proposed by the ${roles} that met it:`, "", ...fixes.map((fix) => `- ${fix}`)];
  const body = `${[
    "## Problem / feature",
    facts.join(" "),
    "",
    "## Acceptance criteria",
    "1. The fault above no longer happens.",
    "2. A control that fails on this fault, and passes with the fix, is part of the change.",
    "",
    "## Direction",
    ...direction,
    "",
    "## Turnpikes",
    "default",
    "",
    "## Notes",
    "Filed from run " +
      id +
      " by `scripts/tool-faults.sh`. The run's own records keep the full evidence: " +
      "what ran, the error and the diagnosis. This ticket carries only the file, the failure and the " +
      "proposed fix. If the fix changes the coachman contract (markers, the waybill shape, completion " +
      "detection), a fixture run confirms it before it merges.",
    "",
    `Tool fault id: \`${group.id}\`.`,
  ].join("\n")}\n`;
  return [title, body];
}
function digest(titlePath: string, bodyPath: string): string {
  return createHash("sha256").update(readFileSync(titlePath)).update("\0").update(readFileSync(bodyPath)).digest("hex");
}
function checked(titlePath: string, bodyPath: string, safe: Safe, sha: string): string {
  const title = readFileSync(titlePath, "utf8").trim(),
    body = readFileSync(bodyPath, "utf8");
  if (digest(titlePath, bodyPath) !== sha) {
    const bad: Array<[string, string]> = [];
    if (safe.publish(title) !== title) bad.push(["title", title]);
    for (const line of body.split(/\r?\n/)) if (safe.publish(line) !== line) bad.push(["body", line]);
    if (bad.length)
      return `not safe to publish:\n${bad.map(([where, text]) => `  ${where}: ${text}\n  made safe: ${safe.publish(text)}`).join("\n")}`;
  }
  const result = run(join(here, "ticket-check.sh"), ["--body", bodyPath, "--title", title]);
  return result.code === 0
    ? ""
    : `the draft fails scripts/ticket-check.sh:\n${(result.stdout + result.stderr).trimEnd()}`;
}
function reach(_dispatch: string): [boolean, string] {
  if (!ownCheckout()) return [false, "postmaster here is not a git checkout of its own"];
  const origin = remote(tool);
  if (origin?.[0] !== "github.com") return [false, "postmaster's checkout has no origin on GitHub"];
  const access = run(join(here, "github.sh"), [tool, "access"]);
  if (access.code !== 0) return [false, `github.sh access: ${why(access)}`];
  if (access.stdout.trim() !== "ADMIN")
    return [false, `the user does not own postmaster's repository (github.sh access: ${access.stdout.trim()})`];
  return [true, ""];
}
function gh(args: string[], env?: Record<string, string | undefined>): RunResult {
  return run(join(here, "github.sh"), [tool, ...args], { env });
}
function search(query: string): Array<[string, string, string]> {
  const result = gh(["search", query]);
  if (result.code !== 0) throw new ToolFaultError(`github.sh search: ${why(result)}`);
  return result.stdout
    .split(/\r?\n/)
    .filter((line) => (line.match(/\t/g) ?? []).length >= 2)
    .map((line) => {
      const [number, state, ...title] = line.split("\t");
      return [number!, state!, title.join("\t")];
    });
}
function readTicket(number: string): string {
  const result = gh(["read", number.replace(/^#/, "")]);
  if (result.code !== 0) throw new ToolFaultError(`github.sh read ${number}: ${why(result)}`);
  return result.stdout;
}
function lookup(id: string, file: string): [[string, string] | null, string[]] {
  for (const [number, state] of search(id)) {
    if (new RegExp(`(?<![\\w-])${regexEscape(id)}(?![\\w-])`).test(readTicket(number))) return [[number, state], []];
  }
  const prefix = `Tool fault in ${file}:`;
  return [
    null,
    search(prefix.slice(0, -1))
      .filter(([, , title]) => title.startsWith(prefix))
      .map(([number]) => number),
  ];
}
function harvest(dispatch: string, ongoing: boolean): void {
  closed(dispatch, ongoing);
  const [entries, bad] = readLog(join(dispatch, "actions.jsonl"));
  const lines = entries.filter((entry) => entry.action === "tool-fault").length,
    statePath = join(dispatch, "tool-faults.json"),
    state = readObject(statePath) as StateFile,
    runs = state.runs ?? [];
  if (!runs.length || (ongoing && lines > Number(state.lines ?? 0))) {
    runs.push({
      run_id: newId(),
      first: runs.length ? Number(state.lines ?? 0) : 0,
      harvested: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    });
    state.runs = runs;
    writeObject(statePath, state);
  }
  const current = runs.at(-1)!,
    id = String(current.run_id),
    first = Number(current.first ?? 0),
    safe = new Safe(ownIds(state, dispatch), dispatch, ongoing),
    groups = faults(entries, safe, first),
    done = doneOf(entries),
    previous = new Map<string, RecordItem>(
      (state.faults ?? []).filter((item) => item.run_id === id).map((item) => [item.id, item] as const),
    );
  const needsTracker = groups.some((group) => !done.has(`${group.id}\0${id}`));
  const [tracker, trackerReason] = needsTracker ? reach(dispatch) : [false, ""];
  const found: RecordItem[] = [],
    rows: string[] = [],
    notes = bad.map((line) => `  line ${line} of actions.jsonl is not a log line, and was left out`);
  for (const group of groups) {
    const item: RecordItem = {
      run_id: id,
      id: group.id,
      file: group.file,
      control: group.control,
      count: group.entries.length,
      state: "",
      ticket: "",
      like: [],
    };
    const recorded = done.get(`${group.id}\0${id}`),
      prior: Partial<RecordItem> = previous.get(group.id) ?? {};
    if (recorded) [item.state, item.ticket] = recorded;
    else if (!tracker) item.state = "kept";
    else {
      try {
        const [known, likes] = lookup(group.id, safe.publish(group.file));
        item.like = likes;
        if (known) {
          [item.ticket, item.ticket_state] = known;
          item.state = "known";
        } else item.state = prior.state === "new" || prior.state === "asked" ? "asked" : "new";
      } catch (error) {
        item.state = "unchecked";
        notes.push(
          `  ${group.id}: the tracker could not be read: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const folder = join(dispatch, "tool-faults", id),
      titlePath = join(folder, `${group.id}.title`),
      bodyPath = join(folder, `${group.id}.md`);
    if (existsSync(titlePath) && existsSync(bodyPath)) item.sha = String(prior.sha ?? "");
    else {
      mkdirSync(folder, { recursive: true });
      const [title, body] = draft(group, id, safe, dispatch);
      writeFileSync(titlePath, `${title}\n`);
      writeFileSync(bodyPath, body);
      item.sha = digest(titlePath, bodyPath);
    }
    item.draft = relative(dispatch, bodyPath);
    let status =
      item.state + (item.ticket ? ` ${item.ticket}` : "") + (item.ticket_state ? ` (${item.ticket_state})` : "");
    if (item.like?.length) status += `, like ${item.like.join(" ")}`;
    if (asking.has(item.state)) status += `  ${item.draft}`;
    rows.push(
      `${group.id}  ${group.file}  ${group.control ? `control (${group.control})  ` : ""}${seen(item.count)}  ${status}`,
    );
    if (!["commented", "filed", "declined"].includes(item.state)) {
      if (group.control && !group.escalated)
        notes.push(`  ${group.id}: a fault in a control, and the log has no escalate naming its file after it`);
      if (group.control)
        for (const workaround of group.workarounds)
          notes.push(`  ${group.id}: a fault in a control, worked around: ${workaround}`);
    }
    if (asking.has(item.state)) {
      const problem = checked(titlePath, bodyPath, safe, item.sha ?? "");
      if (problem) notes.push(`  ${group.id}: ${problem.replace(/\n/g, "\n    ")}`);
    }
    found.push(item);
  }
  state.faults = [...(state.faults ?? []).filter((item) => item.run_id !== id), ...found];
  state.runs = runs;
  state.lines = lines;
  writeObject(statePath, state);
  const tally = new Map<string, number>();
  for (const item of found) tally.set(item.state, (tally.get(item.state) ?? 0) + 1);
  if (!groups.length) writeOut(`run ${id}: no tool faults`);
  else {
    const where = tracker ? "postmaster's own tracker, on GitHub" : `no tracker of postmaster's own: ${trackerReason}`;
    writeOut(`run ${id}: ${groups.length} fault${groups.length === 1 ? "" : "s"}; ${where}`);
    writeOut(rows.join("\n"));
  }
  if (notes.length) writeOut(notes.join("\n"));
  makeLog(
    dispatch,
    "note",
    id,
    `tool faults harvested: ${groups.length}${[...tally]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, count]) => `, ${count} ${name}`)
      .join("")}`,
  );
}
function begin(dispatch: string, id: string, ongoing: boolean): [StateFile, RecordItem, LogEntry[]] {
  closed(dispatch, ongoing);
  const state = readObject(join(dispatch, "tool-faults.json")) as StateFile,
    matches = (state.faults ?? []).filter((item) => item.id === id);
  if (!matches.length) die(`no fault ${id} in ${join(dispatch, "tool-faults.json")}; harvest first`);
  const item = matches.at(-1)!,
    [entries] = readLog(join(dispatch, "actions.jsonl")),
    previous = doneOf(entries).get(`${id}\0${item.run_id}`);
  if (previous) {
    writeOut(`${id}: already ${[previous[0], previous[1]].filter(Boolean).join(" ")}`);
    process.exit(0);
  }
  return [state, item, entries];
}
function requireTracker(): void {
  const [canReach, reason] = reach("");
  if (!canReach) die(`no tracker of postmaster's own: ${reason}`);
}
function comment(dispatch: string, id: string, ticket: string, ongoing: boolean): void {
  const [state, item, entries] = begin(dispatch, id, ongoing);
  requireTracker();
  const safe = new Safe(ownIds(state, dispatch), dispatch, ongoing),
    first = Number(state.runs?.find((entry) => entry.run_id === item.run_id)?.first ?? 0),
    group = faults(entries, safe, first).find((entry) => entry.id === id);
  if (!group) die(`the run's log no longer gives ${id}; harvest it again`);
  let number = "",
    status = "";
  try {
    if (ticket) {
      if (!/^#?\d+$/.test(ticket)) die(`not a ticket number: ${ticket}`);
      number = `#${ticket.replace(/^#/, "")}`;
      status = readTicket(number).match(/^state: (\S+)/m)?.[1] ?? "";
    } else {
      const known = lookup(id, safe.publish(group.file))[0];
      if (!known) die(`${id} has no ticket on postmaster's tracker, so it is new: file it, or decline it`, 2);
      [number, status] = known;
    }
  } catch (error) {
    if (error instanceof ToolFaultError && error.code === 2) throw error;
    die(`the tracker could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  let text = `tool fault ${id} seen again: ${seen(group.entries.length)} in run ${item.run_id}${meta(dispatch)}.`;
  if (["closed", "done", "cancelled"].includes(status)) text += " This ticket is closed.";
  const result = gh(["comment", number.replace(/^#/, ""), "postmaster", text]);
  if (result.code !== 0) die(`the tracker refused the comment: ${why(result)}`);
  makeLog(
    dispatch,
    "ticket-comment",
    number,
    `tool fault ${id} seen again in run ${item.run_id}, on postmaster's own tracker`,
  );
  settle(dispatch, state, item, "commented", number);
  writeOut(`${id}: commented on ${number}`);
}
function settle(dispatch: string, state: StateFile, item: RecordItem, status: string, ticket: string): void {
  item.state = status;
  item.ticket = ticket;
  writeObject(join(dispatch, "tool-faults.json"), state);
}
function fileFault(dispatch: string, id: string, ongoing: boolean): void {
  const [state, item] = begin(dispatch, id, ongoing),
    folder = join(dispatch, "tool-faults", item.run_id),
    titlePath = join(folder, `${id}.title`),
    bodyPath = join(folder, `${id}.md`);
  if (!existsSync(titlePath) || !existsSync(bodyPath)) die(`no draft for ${id} in ${folder}`);
  requireTracker();
  const safe = new Safe(ownIds(state, dispatch), dispatch, ongoing);
  let known: [string, string] | null;
  try {
    known = lookup(id, safe.publish(String(item.file ?? "")))[0];
  } catch (error) {
    die(
      `the tracker could not be read, so nothing is filed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (known) die(`${id} is already ${known[0]} on postmaster's tracker: comment on it instead`, 2);
  const problem = checked(titlePath, bodyPath, safe, String(item.sha ?? ""));
  if (problem) die(`${id} is not filed: ${problem}`, 2);
  const title = readFileSync(titlePath, "utf8").trim(),
    result = gh(["create", title, bodyPath]);
  const number = result.stdout.trim().split(/\r?\n/).at(-1) ?? "";
  if (![0, 5].includes(result.code) || !/^\d+$/.test(number)) die(`the tracker refused the ticket: ${why(result)}`);
  makeLog(
    dispatch,
    "ticket-create",
    `#${number}`,
    `tool fault ${id} filed in run ${item.run_id}, on postmaster's own tracker`,
  );
  settle(dispatch, state, item, "filed", `#${number}`);
  writeOut(`${id}: filed as #${number}${result.code === 5 ? "; it is not on the board, so add it there" : ""}`);
}
function decline(dispatch: string, id: string, word: string, ongoing: boolean): void {
  const [state, item] = begin(dispatch, id, ongoing);
  makeLog(dispatch, "note", id, `tool fault ${id} declined in run ${item.run_id}, by the user: ${word}`);
  settle(dispatch, state, item, "declined", "");
  writeOut(`${id}: declined`);
}
function usageError(): never {
  writeError(usage);
  process.exit(1);
}
function main(args: string[]): number {
  if (args[0] === "--self-test") return selfTest();
  const action = args[0];
  if (action === "harvest") {
    if (args.length !== 2) return usageError();
  } else if (action === "comment") {
    if (args.length < 3 || args.length > 4) return usageError();
  } else if (action === "file") {
    if (args.length !== 3) return usageError();
  } else if (action === "decline") {
    if (args.length < 4) return usageError();
  } else return usageError();
  const dispatchInput = args[1]!;
  if (!existsSync(dispatchInput)) die(`no such dispatch directory: ${dispatchInput}`);
  const dispatch = resolve(dispatchInput);
  if (!readFileSafeIsDirectory(dispatch)) die(`no such dispatch directory: ${dispatchInput}`);
  const ongoing = basename(dispatch) === "postmaster";
  if (action === "harvest") harvest(dispatch, ongoing);
  else {
    const id = args[2]!;
    if (!/^tf-[0-9a-f]{8}$/.test(id)) die(`not a fault id: ${id}`);
    if (action === "comment") comment(dispatch, id, args[3] ?? "", ongoing);
    else if (action === "file") fileFault(dispatch, id, ongoing);
    else decline(dispatch, id, args.slice(3).join(" "), ongoing);
  }
  return 0;
}
function readFileSafeIsDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
function selfTest(): number {
  const randomLetters = (length: number) =>
    [...randomBytes(length)].map((byte) => String.fromCharCode(97 + (byte % 26))).join("");
  const projectName = `zq${randomLetters(6)}`;
  const ownerName = `yq${randomLetters(6)}`;
  const ticketSentence = Array.from({ length: 7 }, () => `xq${randomLetters(6)}`).join(" ");
  const privateCode = `vq${randomLetters(5)}Totals_19`;
  const privateCode2 = `wq${randomLetters(5)}Revenue_28`;
  const privateTicket = `${projectName.toUpperCase()}-12`;
  const privateEmail = `jq${randomLetters(5)}@kq${randomLetters(5)}.example`;
  const privateIp =
    "10." +
    (11 + (randomBytes(1)[0]! % 70)) +
    "." +
    (11 + (randomBytes(1)[0]! % 70)) +
    "." +
    (11 + (randomBytes(1)[0]! % 70));
  const privateKey = `QZ${randomLetters(3).toUpperCase()}-${11 + (randomBytes(1)[0]! % 70)}`;
  const scrambledAlphabet = (alphabet: string) =>
    [...alphabet]
      .sort(() => randomBytes(1)[0]! - 127)
      .slice(0, 7)
      .join("");
  const privateCyrillic = scrambledAlphabet("абвгдежзиклмнопрстуфхцчшщ");
  const privateGreek = scrambledAlphabet("αβγδεζηθικλμνξπρστυφχψω");
  const privateHex = randomBytes(16).toString("hex");
  const privateCommit = randomBytes(20).toString("hex");
  const privateProper = `Q${randomLetters(7)}`;
  const privateHost = `wq${randomLetters(5)}`;
  const privatePath = join(tmpdir(), `wq${randomLetters(5)}`, "code", projectName, privateCommit);
  const secretTicketText =
    "late " +
    randomLetters(7) +
    " " +
    randomLetters(7) +
    " " +
    randomLetters(7) +
    " " +
    randomLetters(7) +
    " " +
    randomLetters(7) +
    " " +
    randomLetters(7);
  const temp = mkdtempSync(join(tmpdir(), "tool-faults-test-")),
    testTool = join(temp, "tool"),
    stub = join(temp, "stub"),
    bin = join(temp, "bin"),
    runs = join(temp, "runs"),
    target = join(temp, "target", projectName);
  mkdirSync(testTool, { recursive: true });
  mkdirSync(stub);
  mkdirSync(bin);
  mkdirSync(runs);
  cpSync(join(tool, "scripts"), join(testTool, "scripts"), { recursive: true });
  cpSync(join(tool, "skills/postmaster"), join(testTool, "skills/postmaster"), { recursive: true });
  cpSync(join(tool, "config.example.toml"), join(testTool, "config.example.toml"));
  const ghSource = [
    "#!/usr/bin/env bun",
    'import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";',
    'import { join } from "node:path";',
    "const dir = process.env.TOOL_FAULTS_STUB!;",
    'const path = join(dir, "db.json");',
    'const db = JSON.parse(readFileSync(path, "utf8"));',
    "const args = process.argv.slice(2);",
    'const pair = (flag: string) => args.includes(flag) ? args[args.indexOf(flag) + 1]! : "";',
    "const save = () => writeFileSync(path, JSON.stringify(db));",
    'if (args[0] === "auth" && args[1] === "status") process.exit(0);',
    'if (args[0] === "api" && args[1] === "graphql") {',
    '  const q = args.find((arg) => arg.startsWith("query=")) ?? "";',
    '  if (q.includes("viewerPermission")) process.stdout.write(JSON.stringify({data:{repository:{viewerPermission:db.access}}}));',
    '  else if (q.includes("projectsV2")) process.stdout.write(JSON.stringify({data:{repository:{projectsV2:{nodes:[{id:"PVT_1",number:1,title:"postmaster",closed:false,url:"https://github.com/o/projects/1",owner:{login:"o"}}]}}}}));',
    '  else if (q.includes("issue(number:")) {',
    '    const n = args.find((arg) => arg.startsWith("number="))?.slice(7) ?? "", issue = db.issues[n];',
    '    if (!issue) { process.stderr.write("missing issue "+n+" keys "+Object.keys(db.issues).join(",")); process.exit(1); }',
    '    const record = {number:Number(n),title:issue.title,body:issue.body,state:issue.state,stateReason:null,url:"https://github.com/o/postmaster/issues/"+n,createdAt:"2026-01-01T00:00:00Z",labels:{nodes:[]},comments:{nodes:issue.comments.map((body:string)=>({body,createdAt:"2026-01-01T00:00:00Z",author:{login:"o"}}))}};',
    "    process.stdout.write(JSON.stringify({data:{repository:{issue:record}}}));",
    "  }",
    "  else process.exit(1);",
    '} else if (args[0] === "search" && args[1] === "issues") {',
    '  if (existsSync(join(dir, "no-search"))) process.exit(1);',
    '  const query = (args[2] ?? "").replace(/^"|"$/g, "").toLowerCase();',
    '  const hits = Object.entries(db.issues).flatMap(([number, issue]: [string, any]) => (issue.title+"\\n"+issue.body+"\\n"+issue.comments.join("\\n")).toLowerCase().includes(query) ? [{number:Number(number),title:issue.title,state:issue.state}] : []);',
    "  process.stdout.write(JSON.stringify(hits));",
    '} else if (args[0] === "project" && args[1] === "item-list") process.stdout.write("{\\"items\\":[]}");',
    'else if (args[0] === "project" && args[1] === "field-list") process.stdout.write("{\\"fields\\":[{\\"id\\":\\"F1\\",\\"name\\":\\"Status\\",\\"options\\":[{\\"id\\":\\"o1\\",\\"name\\":\\"Todo\\"},{\\"id\\":\\"o2\\",\\"name\\":\\"In Progress\\"}]}]}");',
    'else if (args[0] === "project" && args[1] === "item-add") { if (existsSync(join(dir,"no-item-add"))) process.exit(1); process.stdout.write("{\\"id\\":\\"PVTI_new\\"}"); }',
    'else if (args[0] === "project" && args[1] === "item-edit") process.exit(0);',
    'else if (args[0] === "issue" && args[1] === "create") { const number=String(db.next++); db.issues[number]={title:pair("--title"),body:readFileSync(pair("--body-file"),"utf8"),state:"OPEN",comments:[]}; save(); appendFileSync(join(dir,"writes.log"),"create #"+number+"\\n"); writeFileSync(join(dir,"created-"+number+".md"),db.issues[number].body); process.stdout.write("https://github.com/o/postmaster/issues/"+number+"\\n"); }',
    'else if (args[0] === "issue" && args[1] === "comment") { const number=args[2]!; db.issues[number].comments.push(pair("--body")); save(); appendFileSync(join(dir,"writes.log"),"comment #"+number+" "+pair("--body")+"\\n"); }',
    'else { process.stderr.write("stub gh: unexpected "+args.join(" ")); process.exit(1); }',
  ].join("\n");
  const ghPath = join(bin, "gh.ts"),
    ghLink = join(bin, "gh");
  writeFileSync(ghPath, ghSource);
  chmodSync(ghPath, 0o755);
  writeFileSync(ghLink, `#!/usr/bin/env bash\nexec bun "${ghPath}" "$@"\n`);
  chmodSync(ghLink, 0o755);
  const init = run("git", ["-C", testTool, "init", "-q"]);
  const origin = run("git", ["-C", testTool, "remote", "add", "origin", "https://github.com/o/postmaster.git"]);
  if (init.code !== 0 || origin.code !== 0) {
    rmSync(temp, { recursive: true, force: true });
    writeError("tool-faults: self-test could not initialize its private tracker fixture");
    return 1;
  }
  const dbPath = join(stub, "db.json"),
    writesPath = join(stub, "writes.log"),
    env = {
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      TOOL_FAULTS_STUB: stub,
    };
  const setDb = (access: string, issues: Dict = {}) =>
    writeFileSync(dbPath, JSON.stringify({ access, next: 60, issues }));
  const invoke = (args: string[]) => run(join(testTool, "scripts/tool-faults.sh"), args, { env });
  const log = (dispatch: string, actor: string, action: string, file: string, failed: string, extra: string[] = []) => {
    const result = run(join(testTool, "scripts/log-action.sh"), [
      dispatch,
      actor,
      action,
      file,
      "--ran",
      "the check",
      "--failed",
      failed,
      "--error",
      "exit 0",
      "--diagnosis",
      "the check found it",
      "--fix",
      "use the corrected behavior",
      ...extra,
    ]);
    return result.code;
  };
  const newDispatch = (name: string, stage = "done") => {
    const path = join(runs, name);
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, "manifest.json"), JSON.stringify({ stage }));
    writeFileSync(
      join(path, "run.json"),
      JSON.stringify({
        postmaster: { commit: "89abcdef0123456789abcdef0123456789abcdef", uncommitted_changes: false },
      }),
    );
    writeFileSync(
      join(path, "brief.md"),
      "# Ticket " +
        name +
        "\n\n## Ticket\n" +
        secretTicketText +
        " " +
        privateHost +
        "\n" +
        ticketSentence +
        "\n\n## Project profile\nrepo: " +
        target +
        "          default branch: main\n",
    );
    return path;
  };
  let failures = 0;
  const check = (label: string, good: boolean, output = "") => {
    if (good) writeOut(`  ok   ${label}`);
    else {
      writeOut(`  FAIL ${label}`);
      if (output) for (const line of output.split(/\r?\n/)) writeOut(`         ${line}`);
      failures++;
    }
  };
  const state = (dispatch: string): StateFile => readObject(join(dispatch, "tool-faults.json")) as StateFile;
  const itemFor = (dispatch: string, file: string): RecordItem | undefined =>
    state(dispatch).faults?.find((item) => item.file === file);
  try {
    writeOut("positive controls");
    setDb("ADMIN", {
      "12": { title: "An ordinary issue", body: "Nothing to do with faults.", state: "OPEN", comments: [] },
    });
    mkdirSync(target, { recursive: true });
    run("git", ["-C", target, "init", "-q"]);
    run("git", ["-C", target, "remote", "add", "origin", `https://github.com/${ownerName}/${projectName}.git`]);
    const dispatch = newDispatch(`${projectName}/${projectName}-12`);
    const marker = "scripts/wait-for-markers.sh",
      harness = "skills/postmaster/harnesses.md",
      coachman = "skills/postmaster/coachman.md";
    log(dispatch, "coachman", "tool-fault", marker, "returned before 1 marker was in /outside-a/logs", [
      "--control",
      "wait",
    ]);
    log(dispatch, "coachman", "escalate", marker, "the wait is a control");
    log(
      dispatch,
      "coachman",
      "tool-fault",
      join(testTool, "scripts/wait-for-markers.sh"),
      "Returned before 2 marker was in /outside-b/logs.",
      ["--control", "wait"],
    );
    log(dispatch, "coachman", "tool-fault", marker, "returned before 1 marker was in /outside-a/logs", [
      "--control",
      "wait",
    ]);
    log(
      dispatch,
      "coachman",
      "tool-fault",
      harness,
      "the resume form hung while " +
        ticketSentence +
        " in " +
        projectName +
        "; mailed to " +
        privateEmail +
        ", key " +
        privateKey +
        ", code " +
        privateCode +
        ", " +
        privateCyrillic +
        ", " +
        privateGreek +
        ", " +
        privateHex +
        ", " +
        privateIp +
        "; path " +
        privatePath +
        "; see https://github.com/" +
        ownerName +
        "/" +
        projectName +
        "; commit " +
        privateCommit +
        "; ticket " +
        privateTicket +
        "; " +
        privateProper +
        " from " +
        privateHost,
      ["--fix", `pass prompt on stdin and read ${privateCode2}`],
    );
    log(dispatch, "coachman", "tool-fault", marker, "counted a directory named like a marker", ["--control", "wait"]);
    log(dispatch, "coachman", "tool-fault", coachman, "the step runs scripts/stage.sh with a flag it does not take", [
      "--control",
      "action-log",
    ]);
    log(
      dispatch,
      "coachman",
      "tool-fault",
      coachman,
      "the step runs scripts/handoff-check.sh with a flag it does not take",
      ["--control", "check"],
    );
    writeFileSync(
      join(dispatch, "actions.jsonl"),
      readFileSync(join(dispatch, "actions.jsonl"), "utf8") +
        "not json\n" +
        '{"action":"note","detail":"a raw   separator"}\n',
    );
    const harvested = invoke(["harvest", dispatch]),
      current = state(dispatch),
      records = current.faults ?? [],
      markerItem = records[0],
      harnessItem = records[1],
      otherMarkerItem = records[2],
      actionLogItem = records[3],
      checkItem = records[4];
    check(
      "seven fault lines are five faults: one seen three ways, and two naming different scripts kept apart",
      harvested.code === 0 &&
        records.length === 5 &&
        markerItem?.count === 3 &&
        markerItem.id !== otherMarkerItem?.id &&
        actionLogItem?.id !== checkItem?.id,
      harvested.stdout + harvested.stderr,
    );
    check(
      "a line that is not JSON is left out, and said so; one with a raw line separator is read",
      harvested.stdout.includes("line ") &&
        harvested.stdout.includes("is not a log line") &&
        readLog(join(dispatch, "actions.jsonl"))[0].length > 0,
      harvested.stdout,
    );
    check(
      "the harvest logs what it found",
      readFileSync(join(dispatch, "actions.jsonl"), "utf8").includes("tool faults harvested: 5"),
    );
    check(
      "a fault no ticket holds is new, and its line names its draft",
      harnessItem?.state === "new" && harvested.stdout.includes(harnessItem.draft ?? "tool-faults/"),
    );
    const markerDraft = join(dispatch, markerItem?.draft ?? ""),
      harnessDraft = join(dispatch, harnessItem?.draft ?? ""),
      otherMarkerDraft = join(dispatch, otherMarkerItem?.draft ?? ""),
      actionLogDraft = join(dispatch, actionLogItem?.draft ?? ""),
      checkDraft = join(dispatch, checkItem?.draft ?? "");
    check(
      "only an escalate naming the fault's file counts as its escalation",
      readFileSync(markerDraft, "utf8").includes("The run stopped and escalated.") &&
        !readFileSync(otherMarkerDraft, "utf8").includes("The run stopped and escalated."),
    );
    const shape = [markerDraft, harnessDraft, otherMarkerDraft, actionLogDraft, checkDraft].every((path) => {
      const title = readFileSync(path.replace(/\.md$/, ".title"), "utf8").trim();
      return (
        run(join(testTool, "scripts/ticket-check.sh"), ["--body", path, "--title", title]).code === 0 &&
        readFileSync(path, "utf8").includes("## Turnpikes")
      );
    });
    check("each draft is in the ticket shape, with its turnpikes, and passes scripts/ticket-check.sh", shape);
    check(
      "a draft names the run by its public id, and the postmaster it ran",
      readFileSync(markerDraft, "utf8").includes(
        `It was seen 3 times in run ${current.runs?.at(-1)?.run_id}, which ran postmaster 89abcdef0123.`,
      ),
    );
    const safeBody = readFileSync(harnessDraft, "utf8");
    check(
      "postmaster's own files and words are kept, and what is withheld is marked",
      readFileSync(harnessDraft.replace(/\.md$/, ".title"), "utf8").includes(harness) &&
        safeBody.includes("[ticket text]") &&
        safeBody.includes("[project]") &&
        safeBody.includes("[ticket]") &&
        safeBody.includes("[address]") &&
        safeBody.includes("[code]") &&
        !safeBody.includes(projectName),
      safeBody,
    );
    setDb("ADMIN", {
      "12": { title: "An ordinary issue", body: "Nothing to do with faults.", state: "OPEN", comments: [] },
      "57": {
        title: `Tool fault in ${marker}: returned early [${markerItem?.id}]`,
        body: "A body.",
        state: "OPEN",
        comments: [],
      },
      "58": { title: "Retitled by hand", body: `Tool fault id: ${actionLogItem?.id}.`, state: "OPEN", comments: [] },
    });
    const found = invoke(["harvest", dispatch]);
    const afterLookup = state(dispatch),
      knownMarker = afterLookup.faults?.find((item) => item.id === markerItem?.id),
      knownSecondMarker = afterLookup.faults?.find((item) => item.id === otherMarkerItem?.id),
      knownActionLog = afterLookup.faults?.find((item) => item.id === actionLogItem?.id),
      knownHarness = afterLookup.faults?.find((item) => item.id === harnessItem?.id),
      knownCheck = afterLookup.faults?.find((item) => item.id === checkItem?.id);
    check(
      "a ticket holding the id in its title or its body is known; one only like it is not; a draft already shown is asked",
      knownMarker?.state === "known" &&
        knownMarker.ticket === "#57" &&
        knownActionLog?.state === "known" &&
        knownActionLog.ticket === "#58" &&
        knownSecondMarker?.state === "asked" &&
        knownSecondMarker.like?.includes("#57") &&
        knownHarness?.state === "asked",
      found.stdout,
    );
    const rid = String(current.runs?.at(-1)?.run_id);
    writeFileSync(writesPath, "");
    const commentResult = invoke(["comment", dispatch, String(knownMarker?.id)]),
      writesAfterComment = readFileSync(writesPath, "utf8");
    check(
      "comment says once, on the ticket that holds it, that it was seen again, and logs it",
      commentResult.code === 0 &&
        writesAfterComment.includes("comment #57") &&
        writesAfterComment.includes(`seen again: 3 times in run ${rid}`),
    );
    const explicitComment = invoke(["comment", dispatch, String(knownSecondMarker?.id), "12"]);
    check(
      "on the user's word that a ticket holds a new fault, comment names it there",
      explicitComment.code === 0 && readFileSync(writesPath, "utf8").includes("comment #12"),
    );
    const fileResult = invoke(["file", dispatch, String(knownHarness?.id)]),
      _filed = readObject(join(stub, "db.json"));
    check(
      "file files the draft as it is, once, and logs the new ticket",
      fileResult.code === 0 &&
        readFileSync(join(stub, "created-60.md"), "utf8") === safeBody &&
        readFileSync(join(dispatch, "actions.jsonl"), "utf8").includes("ticket-create"),
    );
    invoke(["comment", dispatch, String(knownActionLog?.id)]);
    const declined = invoke(["decline", dispatch, String(knownCheck?.id), "the user: not worth a ticket"]);
    check(
      "decline records the user's no, and files nothing",
      declined.code === 0 && readFileSync(join(dispatch, "actions.jsonl"), "utf8").includes("declined in run"),
    );
    const tamperState = state(dispatch);
    for (const item of tamperState.faults ?? []) item.state = "new";
    writeObject(join(dispatch, "tool-faults.json"), tamperState);
    const reconciled = invoke(["harvest", dispatch]);
    check(
      "a later harvest reads what was done from the run's log, not its state file",
      reconciled.stdout.includes("commented #57") &&
        reconciled.stdout.includes("filed #60") &&
        reconciled.stdout.includes("commented #12") &&
        reconciled.stdout.includes("commented #58") &&
        reconciled.stdout.includes("declined"),
    );
    const later = newDispatch(`${projectName}/${projectName}-16`);
    log(later, "coachman", "tool-fault", marker, "counted a directory named like a marker", ["--control", "wait"]);
    const closedTicket = readObject(join(stub, "db.json"));
    closedTicket.issues["12"].state = "CLOSED";
    writeObject(dbPath, closedTicket);
    const laterHarvest = invoke(["harvest", later]),
      laterId = itemFor(later, marker)?.id;
    const closedComment = invoke(["comment", later, String(laterId), "12"]);
    check(
      "in a later run, a fault a comment names on any ticket is known there",
      laterHarvest.stdout.includes("known #12 (closed)"),
    );
    check(
      "a comment on a closed ticket says it is closed",
      closedComment.code === 0 && readFileSync(writesPath, "utf8").includes("This ticket is closed."),
    );
    const ongoing = join(runs, "postmaster");
    mkdirSync(ongoing, { recursive: true });
    log(ongoing, "postmaster", "tool-fault", "scripts/runs-status.sh", "the poll listed a run twice");
    const ongoingHarvest = invoke(["harvest", ongoing]),
      ongoingId = itemFor(ongoing, "scripts/runs-status.sh")?.id;
    invoke(["file", ongoing, String(ongoingId)]);
    const closedDb = readObject(dbPath);
    closedDb.issues["61"] = {
      title: "Tool fault recurrence",
      body: `Tool fault id: ${ongoingId}`,
      state: "CLOSED",
      comments: [],
    };
    writeObject(dbPath, closedDb);
    log(ongoing, "postmaster", "tool-fault", "scripts/runs-status.sh", "the poll listed a run twice");
    const ongoingAgain = invoke(["harvest", ongoing]);
    check(
      "the postmaster's own faults: a recurrence after its ticket is filed is a new harvest, and known",
      ongoingHarvest.code === 0 &&
        ongoingAgain.code === 0 &&
        state(ongoing).runs?.length === 2 &&
        ongoingAgain.stdout.includes("known #61 (closed)"),
    );
    const clean = newDispatch(`${projectName}/${projectName}-13`);
    const cleanResult = invoke(["harvest", clean]);
    check(
      "a clean log yields no fault and no draft",
      cleanResult.code === 0 &&
        /^run [0-9a-f]+: no tool faults$/.test(cleanResult.stdout.trim()) &&
        !existsSync(join(clean, "tool-faults")),
    );
    const open = newDispatch(`${projectName}/${projectName}-14`, "review");
    log(open, "coachman", "tool-fault", marker, "the launch control was refused");
    const openResult = invoke(["harvest", open]);
    check(
      "a run still open is not harvested",
      openResult.code === 1 && openResult.stderr.includes("still open") && !existsSync(join(open, "tool-faults.json")),
    );
    setDb("READ", {});
    const privateRun = newDispatch(`${projectName}/${projectName}-15`, "abandoned");
    log(privateRun, "coachman", "tool-fault", harness, "the model flag was refused");
    const privateHarvest = invoke(["harvest", privateRun]),
      privateItem = itemFor(privateRun, harness);
    check(
      "a repository the user does not own is no tracker: the faults are kept",
      privateHarvest.code === 0 && privateItem?.state === "kept" && privateHarvest.stdout.includes("user does not own"),
    );
    const noTrackerFile = invoke(["file", privateRun, String(privateItem?.id)]);
    check(
      "and nothing is filed there",
      noTrackerFile.code === 1 && noTrackerFile.stderr.includes("no tracker of postmaster's own"),
    );
    setDb("ADMIN", {});
    writeFileSync(join(stub, "no-search"), "");
    const unreadable = invoke(["harvest", privateRun]),
      unreadableItem = itemFor(privateRun, harness),
      nothingFiled = invoke(["file", privateRun, String(privateItem?.id)]);
    rmSync(join(stub, "no-search"));
    check(
      "a tracker that cannot be searched leaves the fault unchecked, and nothing is filed",
      unreadableItem?.state === "unchecked" &&
        nothingFiled.code === 1 &&
        nothingFiled.stderr.includes("could not be read, so nothing is filed"),
      unreadable.stdout + nothingFiled.stderr,
    );
    const tampered = join(privateRun, privateItem?.draft ?? "");
    writeFileSync(tampered, `${readFileSync(tampered, "utf8")}\n${randomLetters(8)}_991122\n`);
    const unsafe = invoke(["file", privateRun, String(privateItem?.id)]);
    check(
      "file refuses a draft changed to carry the target's code",
      unsafe.code === 2 && unsafe.stderr.includes("not safe to publish"),
    );
    writeOut("negative controls");
    const duplicate = invoke(["comment", dispatch, String(knownMarker?.id)]);
    const beforeDuplicate = readFileSync(writesPath, "utf8");
    const duplicateFile = invoke(["file", dispatch, String(knownHarness?.id)]);
    check(
      "a second comment or file says it is done, and writes nothing",
      duplicate.code === 0 &&
        duplicate.stdout.includes("already commented #57") &&
        duplicateFile.code === 0 &&
        duplicateFile.stdout.includes("already filed #60") &&
        readFileSync(writesPath, "utf8") === beforeDuplicate,
    );
    const noRun = invoke(["harvest", join(temp, "missing")]);
    check(
      "a fault the log no longer gives is refused by name",
      noRun.code === 1 && noRun.stderr.includes("no such dispatch directory"),
    );
    const vendored = join(target, "tools/postmaster");
    mkdirSync(dirname(vendored), { recursive: true });
    cpSync(join(testTool, "scripts"), join(vendored, "scripts"), { recursive: true });
    cpSync(join(testTool, "skills"), join(vendored, "skills"), { recursive: true });
    const vendoredRun = newDispatch(`${projectName}/${projectName}-18`);
    log(vendoredRun, "coachman", "tool-fault", harness, `the effort flag was refused for ${projectName}`);
    const vendoredHarvest = run(join(vendored, "scripts/tool-faults.sh"), ["harvest", vendoredRun], { env });
    const vendoredItem = itemFor(vendoredRun, harness);
    check(
      "a copy of postmaster inside the target is no tracker, and withholds the target all the same",
      vendoredHarvest.code === 0 &&
        vendoredHarvest.stdout.includes("not a git checkout of its own") &&
        !readFileSync(join(vendoredRun, vendoredItem?.draft ?? ""), "utf8").includes(projectName),
    );
    check(
      "a draft as the harvest wrote it is filed as written, though a check of the whole would withhold a phrase",
      existsSync(join(stub, "created-60.md")),
    );
    const safeChangeRun = newDispatch(`${projectName}/${projectName}-21`);
    log(safeChangeRun, "coachman", "tool-fault", "scripts/cut-scratch.sh", "renamed the dependency option");
    invoke(["harvest", safeChangeRun]);
    const safeChange = itemFor(safeChangeRun, "scripts/cut-scratch.sh")!;
    const safeChangePath = join(safeChangeRun, safeChange.draft!);
    writeFileSync(safeChangePath, `${readFileSync(safeChangePath, "utf8")}\nThe fix uses the documented command.\n`);
    const safeChangeFile = invoke(["file", safeChangeRun, safeChange.id]);
    const safeChangeNumber = /#(\d+)/.exec(safeChangeFile.stdout)?.[1] ?? "0";
    check(
      "a changed draft is filed when it is still safe, in a project named with words postmaster uses",
      safeChangeFile.code === 0 &&
        readFileSync(join(stub, `created-${safeChangeNumber}.md`), "utf8").endsWith(
          "The fix uses the documented command.\n",
        ),
      safeChangeFile.stdout + safeChangeFile.stderr,
    );
    const clipRun = newDispatch(`${projectName}/${projectName}-22`);
    log(
      clipRun,
      "coachman",
      "tool-fault",
      coachman,
      `${"the step ran on ".repeat(10)}then scripts/wait-for-markers.sh waited forever`,
    );
    invoke(["harvest", clipRun]);
    const clipItem = itemFor(clipRun, coachman)!;
    const titleLine = readFileSync(join(clipRun, clipItem.draft!.replace(/\.md$/, ".title")), "utf8").trim();
    check(
      "a title is cut between words, so a changed draft keeps its paths whole",
      titleLine.endsWith(`[${clipItem.id}]`) && !titleLine.includes("scripts/wait-for-markers"),
    );
    const kindsRun = newDispatch(`${projectName}/${projectName}-19`);
    log(kindsRun, "coachman", "tool-fault", coachman, "waited on the wrong folder", ["--control", "gate"]);
    log(kindsRun, "coachman", "tool-fault", "scripts/log-action.sh", "wrote nothing");
    const kindsResult = invoke(["harvest", kindsRun]),
      kindsItems = state(kindsRun).faults ?? [];
    check(
      "a fault keeps the kind of control its line recorded; with none recorded, the list's",
      kindsResult.code === 0 &&
        kindsItems.some((item) => item.file === coachman && item.control === "gate") &&
        kindsItems.some((item) => item.file === "scripts/log-action.sh" && item.control === "action-log"),
      kindsResult.stdout + kindsResult.stderr + JSON.stringify(kindsItems),
    );
    const longRun = newDispatch(`${projectName}/${projectName}-20`);
    log(longRun, "coachman", "tool-fault", "scripts/launch.sh", `choked on ${randomLetters(100_000)}`);
    const longStart = Date.now(),
      longHarvest = invoke(["harvest", longRun]);
    check(
      "a fault with a 100,000-character token is harvested in seconds",
      longHarvest.code === 0 && Date.now() - longStart < 25_000,
      String(Date.now() - longStart),
    );
    const longState = state(longRun);
    const longFault = longState.faults?.[0];
    if (!longFault) throw new Error("long fault fixture did not produce a state entry");
    longState.faults = [...(longState.faults ?? []), { ...longFault, id: "tf-0badf00d", state: "new" }];
    writeObject(join(longRun, "tool-faults.json"), longState);
    const missingFault = invoke(["comment", longRun, "tf-0badf00d"]);
    check(
      "a fault the log no longer gives is refused by name",
      missingFault.code === 1 &&
        missingFault.stderr.includes("no longer gives tf-0badf00d") &&
        !missingFault.stderr.includes("Traceback"),
    );
    const boardRun = newDispatch(`${projectName}/${projectName}-17`);
    log(boardRun, "coachman", "tool-fault", "scripts/cut-scratch.sh", "cloned no dependency directory");
    invoke(["harvest", boardRun]);
    const boardItem = itemFor(boardRun, "scripts/cut-scratch.sh");
    writeFileSync(join(stub, "no-item-add"), "");
    const boardFile = invoke(["file", boardRun, String(boardItem?.id)]);
    rmSync(join(stub, "no-item-add"));
    const boardHarvest = invoke(["harvest", boardRun]);
    check(
      "a ticket created but not put on the board is still filed, and logged",
      boardFile.code === 0 &&
        boardFile.stdout.includes("not on the board") &&
        state(boardRun).faults?.[0]?.state === "filed" &&
        boardHarvest.stdout.includes(`filed #${state(boardRun).faults?.[0]?.ticket?.replace(/^#/, "")}`),
    );
    check(
      "the leak check finds a planted piece",
      safeBody.includes("[withheld]") || safeBody.includes("[ticket text]"),
    );
    const published = safeBody + readFileSync(join(stub, "created-60.md"), "utf8") + readFileSync(writesPath, "utf8");
    const planted = [
      projectName,
      ownerName,
      privateTicket,
      ticketSentence,
      privateEmail,
      privateIp,
      privateKey,
      privateCode,
      privateCode2,
      privateHex,
      privateCommit,
      privateCyrillic,
      privateGreek,
      privateProper,
      privateHost,
      privatePath,
      secretTicketText,
    ];
    check(
      "no planted name, path, id, word, key, address, code or ticket text reaches a draft, a ticket or a comment",
      planted.every((value) => !published.includes(value)),
      planted.filter((value) => published.includes(value)).join("\n"),
    );
  } catch (error) {
    failures++;
    writeError(
      `tool-faults: self-test error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
  writeOut("");
  writeOut(failures === 0 ? "self-test: all controls behaved" : `self-test: ${failures} control(s) misbehaved`);
  return failures === 0 ? 0 : 1;
}
try {
  process.exit(main(process.argv.slice(2)));
} catch (error) {
  if (error instanceof ToolFaultError) {
    writeError(`tool-faults: ${error.message}`);
    process.exit(error.code);
  }
  writeError(`tool-faults: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
