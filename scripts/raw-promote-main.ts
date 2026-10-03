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
import { git, keyBlockStep, logFinding, safePath, StreamScanner, streamLines } from "./scrub-core.ts";
import { pyLower } from "./lib/text.ts";

const USAGE = "usage: raw-promote.sh <src> <dest> | --help";
const PLACEHOLDER = "<redacted:encrypted-reasoning>";
const ALLOW_MARKER = /(?:<!--|#|\/\/)?[ \t]*private-data:allow(?:-next-line)?[ \t]+[^ \t]+[ \t]+--[ \t]+[^\r\n]*(?:-->)?$/gu;

function fail(message: string, code = 2): never { console.error(`raw-promote: ${message}`); process.exit(code); }

interface FileScan { changed: boolean; faults: string[] }

function transformReasoning(value: unknown): { value: unknown; count: number } {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const nested = JSON.parse(value) as unknown;
        const transformed = transformReasoning(nested);
        if (transformed.count) return { value: JSON.stringify(transformed.value), count: transformed.count };
      } catch { /* ordinary text */ }
    }
    return { value, count: 0 };
  }
  if (Array.isArray(value)) {
    let count = 0;
    const result = value.map((item) => { const next = transformReasoning(item); count += next.count; return next.value; });
    return { value: result, count };
  }
  if (typeof value !== "object" || value === null) return { value, count: 0 };
  const object = value as Record<string, unknown>;
  const type = typeof object.type === "string" ? pyLower(object.type) : "";
  let count = 0;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(object)) {
    if (key === "encrypted_content" || (type === "thinking" && key === "signature") || (type === "redacted_thinking" && key === "data")) {
      result[key] = item === PLACEHOLDER ? item : PLACEHOLDER;
      if (item !== PLACEHOLDER) count++;
    } else {
      const next = transformReasoning(item);
      result[key] = next.value;
      count += next.count;
    }
  }
  return { value: result, count };
}

function redactReasoning(line: string): { text: string; count: number } {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return { text: line, count: 0 };
  try {
    const parsed = JSON.parse(line) as unknown;
    const transformed = transformReasoning(parsed);
    return transformed.count ? { text: JSON.stringify(transformed.value), count: transformed.count } : { text: line, count: 0 };
  } catch { return { text: line, count: 0 }; }
}

async function inspectFile(path: string, report: boolean): Promise<FileScan> {
  const scanner = new StreamScanner();
  let inKeyBlock = false;
  let changed = false;
  const faults: string[] = [];
  for await (const line of streamLines(path)) {
    if (redactReasoning(line.text).count) changed = true;
    const key = keyBlockStep(line.text, inKeyBlock);
    inKeyBlock = key.inBlock;
    const result = scanner.feed(line.number, line.text, { keyBlock: key.flagged });
    if (result.findings.length || result.suppressed.length || result.markers.length) changed = changed || result.findings.length > 0 || result.suppressed.length > 0;
    for (const marker of result.markers) faults.push(`${line.number}: marker`);
    if (report) {
      for (const finding of result.findings) logFinding(finding.rule, path, line.number, "");
      for (const finding of result.suppressed) logFinding(finding.rule, path, line.number, "", "marker");
    }
  }
  for (const marker of scanner.flush()) faults.push(`${marker.line ?? 1}: marker`);
  return { changed, faults };
}

function entries(source: string): Array<{ source: string; relative: string }> {
  const result: Array<{ source: string; relative: string }> = [];
  const walk = (path: string, rel: string): void => {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw new Error("unsupported entry");
    if (stat.isFile()) { result.push({ source: path, relative: rel }); return; }
    for (const name of readdirSync(path)) walk(join(path, name), rel ? join(rel, name) : name);
  };
  walk(source, "");
  return result.sort((a, b) => a.relative.localeCompare(b.relative));
}

function replaceFindings(line: string, findings: Array<{ start: number; end: number; rule: string }>): { text: string; rules: string[] } {
  const spans = findings.filter((f) => f.end > f.start).sort((a, b) => a.start - b.start || a.end - b.end);
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
  const fd = openSync(target, "w", 0o600);
  const scanner = new StreamScanner();
  const reports: string[] = [];
  let inKeyBlock = false;
  try {
    for await (const line of streamLines(source)) {
      const reasoned = redactReasoning(line.text);
      let text = reasoned.text;
      if (reasoned.count) reports.push(`${safePath(destLabel)}:${line.number}: encrypted-reasoning scrubbed`);
      const key = keyBlockStep(text, inKeyBlock);
      inKeyBlock = key.inBlock;
      const result = scanner.feed(line.number, text, { keyBlock: key.flagged });
      const replaced = replaceFindings(text, [...result.findings, ...result.suppressed]);
      for (const rule of replaced.rules) reports.push(`${safePath(destLabel)}:${line.number}: ${rule} scrubbed`);
      ALLOW_MARKER.lastIndex = 0;
      text = replaced.text.replace(ALLOW_MARKER, "");
      writeFileSync(fd, text, "utf8");
      if (line.newline) writeFileSync(fd, "\n", "utf8");
    }
    const faults = scanner.flush();
    if (faults.length) throw new Error("marker fault");
  } finally {
    // close is done by Node when the stream completes; writeFileSync uses the descriptor directly.
    try { closeSync(fd); } catch { /* already closed */ }
  }
  return reports;
}

async function verifyFiles(files: string[]): Promise<string[]> {
  const found: string[] = [];
  for (const file of files) {
    const scan = await inspectFile(file, false);
    if (scan.faults.length) found.push(...scan.faults.map((fault) => `${safePath(file)}:${fault}`));
    else {
      const scanner = new StreamScanner();
      let keyState = false;
      for await (const line of streamLines(file)) {
        if (redactReasoning(line.text).count) found.push(`${safePath(file)}:${line.number}: encrypted-reasoning`);
        const key = keyBlockStep(line.text, keyState); keyState = key.inBlock;
        const result = scanner.feed(line.number, line.text, { keyBlock: key.flagged });
        for (const finding of result.findings) found.push(`${safePath(file)}:${line.number}: ${finding.rule}`);
      }
      for (const marker of scanner.flush()) found.push(`${safePath(file)}:${marker.line ?? 1}: marker`);
    }
  }
  return found;
}

async function main(args: string[]): Promise<number> {
  if (args.length === 1 && args[0] === "--help") { console.error(USAGE); return 0; }
  if (args.length !== 2) fail(USAGE);
  const root = git(["rev-parse", "--show-toplevel"]).toString("utf8").trim();
  const source = resolve(args[0]!);
  const dest = resolve(root, args[1]!);
  const relDest = relative(root, dest).split(sep).join("/");
  if (isAbsolute(relDest) || relDest === ".." || relDest.startsWith("../") || !relDest.startsWith("raw/") || relDest === "raw/") fail("destination must be a new path under raw/");
  if (existsSync(dest)) fail("destination already exists");
  let sourceFiles: Array<{ source: string; relative: string }>;
  try {
    sourceFiles = entries(source);
    if (!sourceFiles.length) fail("source is empty");
  } catch { fail(`source is not a regular file or directory: ${safePath(args[0]!)}`); }
  const issues: string[] = [];
  const changed = new Set<string>();
  for (const file of sourceFiles!) {
    const scanned = await inspectFile(file.source, true);
    if (scanned.changed) changed.add(file.relative);
    issues.push(...scanned.faults.map((fault) => `${safePath(file.relative)}:${fault}`));
  }
  if (issues.length) { for (const issue of issues) console.log(issue); return 1; }
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
      if (changed.has("")) reports.push(...await writeScrubbed(source, target, label));
      else copyFileSync(source, target);
    } else {
      mkdirSync(staging, { recursive: false, mode: 0o700 });
      for (const entry of sourceFiles!) {
        const target = join(staging, entry.relative);
        mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
        destinations.push(target);
        if (changed.has(entry.relative)) reports.push(...await writeScrubbed(entry.source, target, join(relDest, entry.relative)));
        else copyFileSync(entry.source, target);
      }
    }
    const faults = await verifyFiles(destinations);
    if (faults.length) { rmSync(staging, { recursive: true, force: true }); for (const fault of faults) console.log(fault); return 1; }
    if (existsSync(dest)) { rmSync(staging, { recursive: true, force: true }); fail("destination already exists"); }
    renameSync(staging, dest);
    reports.sort();
    for (const line of reports) console.log(line);
    return 0;
  } catch {
    if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
    fail("copy could not be completed");
  }
}

if (import.meta.main) {
  try { process.exit(await main(process.argv.slice(2))); }
  catch { console.error("raw-promote: copy could not be completed"); process.exit(2); }
}
