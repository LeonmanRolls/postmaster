#!/usr/bin/env bun
// Copies a run record into raw/ only after scrubbing and rescanning the copy.
import {
  copyFileSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import {
  activeMarkerSpans,
  git,
  keyBlockStep,
  RefusedError,
  StreamScanner,
  streamLines,
} from "./scrub-core.ts";
import {
  firstNonWsChar,
  maybeWholeJson,
  parseWholeJson,
  redactReasoning,
  transformReasoning,
  WHOLE_JSON_CAP,
} from "./scrub-reasoning.ts";
import { errorText, fail, findingRow, logFinding, safePath } from "./scrub-report.ts";

const USAGE = "usage: run raw-promote <src> <dest> | --help";

function repoRoot(): string {
  // Walk up to the worktree root without spawning: under the 512 MB virtual
  // limit (C27) a single spawnSync permanently reserves ~170 MB of vsize
  // (child reservation plus the 64 MB capture buffer), leaving no room to
  // stream. A .git dir is a normal repo, a .git file a worktree or submodule;
  // both answer the same root rev-parse would. Exotic setups (bare repos,
  // $GIT_DIR) fall back to one git spawn.
  let dir = process.cwd();
  for (;;) {
    try {
      const dotGit = lstatSync(join(dir, ".git"));
      if (dotGit.isDirectory() || dotGit.isFile()) return dir;
    } catch {
      /* keep walking */
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return git(["rev-parse", "--show-toplevel"]).toString("utf8").trim();
}

// Strip only the markers the scanner treats as directives. The old regex
// deleted from any marker-shaped text to the end of the line, so a quoted
// example ate its closing quote and the real trailing text with it.
function stripActiveMarkers(text: string): string {
  const spans = activeMarkerSpans(text);
  if (!spans.length) return text;
  let out = "";
  let cursor = 0;
  for (const [start, end] of spans) {
    if (start < cursor) continue;
    out += text.slice(cursor, start);
    cursor = end;
  }
  return out + text.slice(cursor);
}

function parsesAsJson(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return false;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

interface FileScan {
  changed: boolean;
  faults: string[];
  findings: string[];
}

// The whole-file gate both promoter passes share with the tree check: the
// first non-whitespace byte, the line count and whether any line failed to
// parse. Tracked while streaming so the common case never re-reads.
interface WholeGate {
  lines: number;
  firstNonWs: string;
  anyParseFail: boolean;
}

const trackGate = (gate: WholeGate, text: string): void => {
  gate.lines++;
  if (!gate.firstNonWs) {
    const found = firstNonWsChar(text);
    if (found) gate.firstNonWs = found;
  }
  if (!parsesAsJson(text)) gate.anyParseFail = true;
};

// Re-reads through the same streaming reader (flat, closed input) and joins
// up to the shared cap; null past it, and the per-line path stands.
async function readWholeCapped(path: string): Promise<{ text: string; newline: boolean } | null> {
  const parts: string[] = [];
  let size = 0;
  let newline = false;
  for await (const line of streamLines(path)) {
    size += line.text.length + 1;
    if (size > WHOLE_JSON_CAP) return null;
    parts.push(line.text);
    newline = line.newline;
  }
  return { text: parts.join("\n") + (newline ? "\n" : ""), newline };
}

async function inspectFile(path: string, report: boolean): Promise<FileScan> {
  const scanner = new StreamScanner();
  let inKeyBlock = false;
  let changed = false;
  const faults: string[] = [];
  const findings: string[] = [];
  const gate: WholeGate = { lines: 0, firstNonWs: "", anyParseFail: false };
  for await (const line of streamLines(path)) {
    trackGate(gate, line.text);
    const reasoned = redactReasoning(line.text);
    if (reasoned.count) {
      changed = true;
      findings.push(`${line.number}: encrypted-reasoning`);
    }
    const key = keyBlockStep(line.text, inKeyBlock);
    inKeyBlock = key.inBlock;
    const result = scanner.feed(line.number, line.text, { keyBlock: key.flagged });
    if (result.findings.length || result.suppressed.length || result.markers.length)
      changed = changed || result.findings.length > 0 || result.suppressed.length > 0;
    for (const _marker of result.markers) faults.push(`${line.number}: marker`);
    for (const finding of result.findings) findings.push(`${line.number}: ${finding.rule}`);
    // A valid marker is stripped on copy; when the strip would break a JSON
    // row's syntax the placement is refused instead of publishing a
    // malformed record.
    const stripped = stripActiveMarkers(line.text);
    if (stripped !== line.text && parsesAsJson(line.text) && !parsesAsJson(stripped))
      faults.push(`${line.number}: marker`);
    if (report) {
      if (reasoned.count) logFinding("encrypted-reasoning", path, line.number, "");
      for (const finding of result.findings) logFinding(finding.rule, path, line.number, "");
      for (const finding of result.suppressed)
        logFinding(finding.rule, path, line.number, "", "marker");
    }
  }
  if (maybeWholeJson(gate.lines, gate.firstNonWs, gate.anyParseFail)) {
    // Review round 9 (bug-36): a record pretty-printed across lines never
    // parsed per line. The whole value goes through the same transform the
    // detector walks, cited at line 1 where the value starts.
    const whole = await readWholeCapped(path);
    if (whole !== null) {
      const parsed = parseWholeJson(whole.text);
      if (parsed !== undefined) {
        let count = 0;
        try {
          count = transformReasoning(parsed).count;
        } catch {
          /* deep whole: per-line stands, as redactReasoning does */
        }
        if (count) {
          changed = true;
          findings.push("1: encrypted-reasoning");
          if (report) logFinding("encrypted-reasoning", path, 1, "");
        }
      }
    }
  }
  for (const marker of scanner.flush()) {
    faults.push(`${marker.line ?? 1}: marker`);
    findings.push(`${marker.line ?? 1}: marker`);
  }
  return { changed, faults, findings };
}

function entries(source: string): Array<{ source: string; relative: string }> {
  const result: Array<{ source: string; relative: string }> = [];
  const walk = (path: string, rel: string): void => {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()))
      throw new Error("unsupported entry");
    if (stat.isFile()) {
      result.push({ source: path, relative: rel });
      return;
    }
    for (const name of readdirSync(path)) walk(join(path, name), rel ? join(rel, name) : name);
  };
  walk(source, "");
  return result.sort((a, b) => a.relative.localeCompare(b.relative));
}

function replaceFindings(
  line: string,
  findings: Array<{ start: number; end: number; rule: string }>,
): { text: string; rules: string[] } {
  const spans = findings
    .filter((f) => f.end > f.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Array<{ start: number; end: number; rules: Set<string> }> = [];
  for (const finding of spans) {
    const last = merged.at(-1);
    if (last && finding.start <= last.end) {
      last.end = Math.max(last.end, finding.end);
      last.rules.add(finding.rule);
    } else merged.push({ start: finding.start, end: finding.end, rules: new Set([finding.rule]) });
  }
  let out = "";
  let cursor = 0;
  const rules: string[] = [];
  for (const span of merged) {
    const names = [...span.rules].sort();
    out += line.slice(cursor, span.start) + `<redacted:${names.join("+")}>`;
    rules.push(...names);
    cursor = span.end;
  }
  return { text: out + line.slice(cursor), rules };
}

async function writeScrubbed(source: string, target: string, destLabel: string): Promise<string[]> {
  let fd = openSync(target, "w", 0o600);
  let scanner = new StreamScanner();
  let reports: string[] = [];
  let inKeyBlock = false;
  const gate: WholeGate = { lines: 0, firstNonWs: "", anyParseFail: false };
  const processLine = (number: number, text: string, newline: boolean): void => {
    const reasoned = redactReasoning(text);
    let out = reasoned.text;
    if (reasoned.count)
      reports.push(`${findingRow(destLabel, number, "encrypted-reasoning")} scrubbed`);
    const key = keyBlockStep(out, inKeyBlock);
    inKeyBlock = key.inBlock;
    const result = scanner.feed(number, out, { keyBlock: key.flagged });
    const replaced = replaceFindings(out, [...result.findings, ...result.suppressed]);
    for (const rule of replaced.rules)
      reports.push(`${findingRow(destLabel, number, rule)} scrubbed`);
    out = stripActiveMarkers(replaced.text);
    writeFileSync(fd, out, "utf8");
    if (newline) writeFileSync(fd, "\n", "utf8");
  };
  try {
    for await (const line of streamLines(source)) {
      trackGate(gate, line.text);
      processLine(line.number, line.text, line.newline);
    }
    if (maybeWholeJson(gate.lines, gate.firstNonWs, gate.anyParseFail)) {
      // Review round 9 (bug-36): the whole value goes through the same
      // transform inspectFile counts, and when it scrubs anything the copy
      // is replayed from the scrubbed text, so the bytes and the reports
      // agree with the rescan.
      const whole = await readWholeCapped(source);
      if (whole !== null) {
        const parsed = parseWholeJson(whole.text);
        if (parsed !== undefined) {
          let count = 0;
          let scrubbed = "";
          try {
            const transformed = transformReasoning(parsed);
            count = transformed.count;
            scrubbed = JSON.stringify(transformed.value);
          } catch {
            /* deep whole: per-line stands, as redactReasoning does */
          }
          if (count) {
            closeSync(fd);
            fd = openSync(target, "w", 0o600);
            scanner = new StreamScanner();
            inKeyBlock = false;
            reports = [`${findingRow(destLabel, 1, "encrypted-reasoning")} scrubbed`];
            processLine(1, scrubbed, whole.newline);
          }
        }
      }
    }
    const faults = scanner.flush();
    if (faults.length) throw new Error("marker fault");
  } finally {
    // close is done by Node when the stream completes; writeFileSync uses the descriptor directly.
    try {
      closeSync(fd);
    } catch {
      /* already closed */
    }
  }
  return reports;
}

export async function verifyFiles(files: string[]): Promise<string[]> {
  // One pass: inspectFile already computes every finding the old second
  // loop recomputed, in the same order, so the rescan reads each file once.
  const found: string[] = [];
  for (const file of files) {
    const scan = await inspectFile(file, false);
    if (scan.faults.length) found.push(...scan.faults.map((fault) => `${safePath(file)}:${fault}`));
    else found.push(...scan.findings.map((finding) => `${safePath(file)}:${finding}`));
  }
  return found;
}

async function main(args: string[]): Promise<number> {
  // A production entrypoint: shed the test hook before the first scan.
  delete process.env.SCRUB_CHECK_DISABLE;
  if (args.length === 1 && args[0] === "--help") {
    console.error(USAGE);
    return 0;
  }
  if (args.length !== 2) fail("raw-promote", USAGE);
  const root = repoRoot();
  const source = resolve(args[0]!);
  const dest = resolve(root, args[1]!);
  const relDest = relative(root, dest).split(sep).join("/");
  if (
    isAbsolute(relDest) ||
    relDest === ".." ||
    relDest.startsWith("../") ||
    !relDest.startsWith("raw/") ||
    relDest === "raw/"
  )
    fail("raw-promote", "destination must be a new path under raw/");
  // A lexical check cannot see through symlinks: refuse ancestors that leave
  // the checkout before mkdir or rename follows them.
  const parts = relDest.split("/");
  for (let i = 1; i < parts.length; i++) {
    const ancestor = join(root, ...parts.slice(0, i));
    let linked = false;
    try {
      linked = lstatSync(ancestor).isSymbolicLink();
    } catch {
      continue; // not created yet; mkdir below makes a real directory
    }
    if (linked) fail("raw-promote", "destination must not pass through a symlink");
  }
  if (existsSync(dest)) fail("raw-promote", "destination already exists");
  let sourceFiles: Array<{ source: string; relative: string }>;
  try {
    sourceFiles = entries(source);
    if (!sourceFiles.length) fail("raw-promote", "source is empty");
  } catch {
    fail("raw-promote", `source is not a regular file or directory: ${safePath(args[0]!)}`);
  }
  const issues: string[] = [];
  const changed = new Set<string>();
  for (const file of sourceFiles!) {
    const scanned = await inspectFile(file.source, true);
    if (scanned.changed) changed.add(file.relative);
    issues.push(...scanned.faults.map((fault) => `${safePath(file.relative)}:${fault}`));
  }
  if (issues.length) {
    for (const issue of issues) console.log(issue);
    return 1;
  }
  const rawRoot = join(root, "raw");
  const staging = join(rawRoot, `.promote-${randomBytes(8).toString("hex")}`);
  try {
    mkdirSync(dirname(dest), { recursive: true });
    const reports: string[] = [];
    const destinations: string[] = [];
    const srcStat = lstatSync(source);
    if (srcStat.isFile()) {
      const label = relDest;
      const target = staging;
      destinations.push(target);
      if (changed.has("")) reports.push(...(await writeScrubbed(source, target, label)));
      else copyFileSync(source, target);
    } else {
      mkdirSync(staging, { recursive: false, mode: 0o700 });
      for (const entry of sourceFiles!) {
        const target = join(staging, entry.relative);
        mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
        destinations.push(target);
        if (changed.has(entry.relative))
          reports.push(
            ...(await writeScrubbed(entry.source, target, join(relDest, entry.relative))),
          );
        else copyFileSync(entry.source, target);
      }
    }
    const faults = await verifyFiles(destinations);
    if (faults.length) {
      rmSync(staging, { recursive: true, force: true });
      for (const fault of faults) console.log(fault);
      return 1;
    }
    if (existsSync(dest)) {
      rmSync(staging, { recursive: true, force: true });
      fail("raw-promote", "destination already exists");
    }
    renameSync(staging, dest);
    reports.sort();
    for (const line of reports) console.log(line);
    return 0;
  } catch (error) {
    if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
    if (error instanceof RefusedError) fail("raw-promote", error.message);
    fail("raw-promote", "copy could not be completed");
  }
}

if (import.meta.main) {
  try {
    process.exit(await main(process.argv.slice(2)));
  } catch (error) {
    if (error instanceof RefusedError) {
      console.error(errorText("raw-promote", error.message));
      process.exit(2);
    }
    console.error("raw-promote: copy could not be completed");
    process.exit(2);
  }
}
