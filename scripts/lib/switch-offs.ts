// Find check switch-offs added since the ticket branch's merge base with its default.
// This deliberately uses a small JavaScript lexer instead of a parser dependency: strings,
// regular expressions and template text are skipped, while comments inside template
// substitutions remain comments.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { run } from "./proc.ts";

const UNSET_GIT = {
  GIT_DIR: undefined,
  GIT_WORK_TREE: undefined,
  GIT_COMMON_DIR: undefined,
  GIT_INDEX_FILE: undefined,
  GIT_OBJECT_DIRECTORY: undefined,
  GIT_ALTERNATE_OBJECT_DIRECTORIES: undefined,
  GIT_NAMESPACE: undefined,
};

export interface SwitchOffComment {
  id: string;
  path: string;
  line: number;
  form: string;
  effect: string;
  reason: string | null;
}

export interface SwitchOffSetting {
  id: string;
  path: string;
  change: "added" | "changed" | "deleted";
  diff: string;
}

export type SwitchOffStatus = "clear" | "held" | "reason-required" | "refused";

export interface SwitchOffReport {
  status: SwitchOffStatus;
  comments: SwitchOffComment[];
  settings: SwitchOffSetting[];
  output: string;
}

interface LexComment {
  start: number;
  end: number;
  line: number;
  raw: string;
}

interface Directive {
  comment: LexComment;
  kind: "typescript" | "linter" | "biome";
  form: string;
  effect: string;
  reason: string | null;
  range: "line" | "next-line" | "block" | "file" | "biome-block";
  endLine?: number;
}

function git(repo: string, args: string[]): string {
  const r = run("git", ["-C", repo, ...args], { env: UNSET_GIT });
  if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.err.trim() || r.out.trim()}`);
  return r.out;
}

function commit(repo: string, ref: string): string {
  return git(repo, ["rev-parse", "--verify", `${ref}^{commit}`]).trim();
}

function sha(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function lineAt(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i++) if (source.charCodeAt(i) === 10) line++;
  return line;
}

/** Comments from executable JavaScript/TypeScript syntax, excluding string and regex text. */
export function scanComments(source: string): LexComment[] {
  const comments: LexComment[] = [];
  let i = 0;

  const quoted = (quote: string): void => {
    i++;
    while (i < source.length) {
      if (source[i] === "\\") i += Math.min(2, source.length - i);
      else if (source[i] === quote) {
        i++;
        return;
      } else i++;
    }
  };

  const regexLiteral = (): void => {
    i++;
    let inClass = false;
    while (i < source.length) {
      const ch = source[i]!;
      if (ch === "\\") i += Math.min(2, source.length - i);
      else if (ch === "[") {
        inClass = true;
        i++;
      } else if (ch === "]") {
        inClass = false;
        i++;
      } else if (ch === "/" && !inClass) {
        i++;
        while (/[A-Za-z]/u.test(source[i] ?? "")) i++;
        return;
      } else if (ch === "\n" || ch === "\r") return;
      else i++;
    }
  };

  const template = (): void => {
    i++; // opening backtick
    while (i < source.length) {
      const ch = source[i]!;
      if (ch === "\\") i += Math.min(2, source.length - i);
      else if (ch === "`") {
        i++;
        return;
      } else if (ch === "$" && source[i + 1] === "{") {
        i += 2;
        code(true);
      } else i++;
    }
  };

  const code = (templateExpression: boolean): void => {
    let canStartRegex = true;
    let braces = 0;
    while (i < source.length) {
      const ch = source[i]!;
      if (ch.trim() === "") {
        i++;
        continue;
      }
      if (templateExpression && ch === "}" && braces === 0) {
        i++;
        return;
      }
      if (ch === "/" && source[i + 1] === "/") {
        const start = i;
        i += 2;
        while (i < source.length && source[i] !== "\n" && source[i] !== "\r") i++;
        comments.push({ start, end: i, line: lineAt(source, start), raw: source.slice(start, i) });
        continue;
      }
      if (ch === "/" && source[i + 1] === "*") {
        const start = i;
        i += 2;
        while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i++;
        if (i < source.length) i += 2;
        comments.push({ start, end: i, line: lineAt(source, start), raw: source.slice(start, i) });
        continue;
      }
      if (ch === "'" || ch === '"') {
        quoted(ch);
        canStartRegex = false;
        continue;
      }
      if (ch === "`") {
        template();
        canStartRegex = false;
        continue;
      }
      if (ch === "/") {
        if (canStartRegex) {
          regexLiteral();
          canStartRegex = false;
        } else {
          i += source[i + 1] === "=" ? 2 : 1;
          canStartRegex = true;
        }
        continue;
      }
      if (/[A-Za-z_$]/u.test(ch)) {
        const start = i++;
        while (/[A-Za-z0-9_$]/u.test(source[i] ?? "")) i++;
        const word = source.slice(start, i);
        canStartRegex = new Set([
          "return",
          "throw",
          "case",
          "delete",
          "void",
          "typeof",
          "new",
          "in",
          "of",
          "yield",
          "await",
          "else",
          "do",
          "instanceof",
          "extends",
          "default",
        ]).has(word);
        continue;
      }
      if (/[0-9]/u.test(ch)) {
        i++;
        while (/[A-Za-z0-9_.]/u.test(source[i] ?? "")) i++;
        canStartRegex = false;
        continue;
      }
      if (ch === "{") {
        braces++;
        i++;
        canStartRegex = true;
        continue;
      }
      if (ch === "}") {
        braces = Math.max(0, braces - 1);
        i++;
        canStartRegex = false;
        continue;
      }
      if (ch === ")" || ch === "]") {
        i++;
        canStartRegex = false;
        continue;
      }
      if (ch === ".") {
        i += source.startsWith("...", i) ? 3 : 1;
        canStartRegex = false;
        continue;
      }
      if (ch === "+" || ch === "-") {
        const doubled = source[i + 1] === ch;
        i += doubled ? 2 : 1;
        canStartRegex = !doubled;
        continue;
      }
      i++;
      canStartRegex = true;
    }
  };

  code(false);
  return comments;
}

function sourceLines(text: string): string[] {
  return text.replace(/\r\n/gu, "\n").replace(/\r/gu, "\n").split("\n");
}

function codeLines(source: string, comments: LexComment[]): string[] {
  // Comment offsets are UTF-16 indices, so keep the same indexing as the source.
  const masked = source.split("");
  for (const c of comments) {
    for (let i = c.start; i < c.end; i++)
      if (masked[i] !== "\n" && masked[i] !== "\r") masked[i] = " ";
  }
  return sourceLines(masked.join("")).map((line) => line.trim());
}

function reasonAfter(text: string): string | null {
  const initial = text.trim();
  const cleaned =
    initial.startsWith("--") || initial.startsWith(":")
      ? initial.slice(initial.startsWith("--") ? 2 : 1).trim()
      : initial;
  return cleaned === "" ? null : cleaned;
}

function nonblank(text: string): string | null {
  const cleaned = text.trim();
  return cleaned === "" ? null : cleaned;
}

function commentContent(raw: string): string {
  if (raw.startsWith("//")) return raw.slice(2);
  return raw
    .replace(/^\/\*\*?/u, "")
    .replace(/\*\/$/u, "")
    .split(/\r?\n/u)
    .map((line) => {
      const trimmed = line.trimStart();
      return trimmed.startsWith("*") ? trimmed.slice(1).replace(/^ /u, "") : line;
    })
    .join("\n");
}

function directiveList(comment: LexComment): Directive[] {
  const raw = comment.raw;
  const content = commentContent(raw);
  const out: Directive[] = [];
  const ts = /@ts-(ignore|expect-error|nocheck)(?=[ \t,:]|$)([^\r\n]*)/gu;
  for (const m of content.matchAll(ts)) {
    const form = `@ts-${m[1]}`;
    const tail = m[2] ?? "";
    out.push({
      comment,
      kind: "typescript",
      form,
      effect: form,
      reason: reasonAfter(tail),
      range: form === "@ts-nocheck" ? "file" : "next-line",
    });
  }

  const linter = /(eslint|oxlint)-(disable|enable)(?:-(line|next-line))?(?=[ \t*,:]|$)([^\r\n]*)/gu;
  for (const m of content.matchAll(linter)) {
    const tool = m[1]!;
    const verb = m[2]!;
    if (verb === "enable") continue;
    const suffix = m[3] ?? "";
    const tail = (m[4] ?? "").trim();
    const split = tail.indexOf("--");
    const ruleText = (split < 0 ? tail : tail.slice(0, split))
      .trim()
      .replace(/^[,:]+|[:,]+$/gu, "");
    const reason = split < 0 ? null : nonblank(tail.slice(split + 2));
    const suffixText = suffix ? `-${suffix}` : "";
    const form = `${tool}-${verb}${suffixText}`;
    out.push({
      comment,
      kind: "linter",
      form,
      effect:
        ruleText === ""
          ? "every rule"
          : ruleText
              .split(/[, \t\r\n\v\f]+/u)
              .filter(Boolean)
              .join(", "),
      reason,
      range: suffix === "line" ? "line" : suffix === "next-line" ? "next-line" : "block",
    });
  }

  const biome = /biome-ignore(?:-(all|start|end))?[ \t]+([^:\r\n]+):([^\r\n]*)/gu;
  for (const m of content.matchAll(biome)) {
    const variant = m[1] ?? "";
    if (variant === "end") continue;
    const category = (m[2] ?? "").trim();
    const reason = nonblank(m[3] ?? "");
    if (!category || reason === null) continue; // Biome does not suppress without its reason.
    const form = `biome-ignore${variant ? `-${variant}` : ""}`;
    out.push({
      comment,
      kind: "biome",
      form,
      effect: category,
      reason,
      range: variant === "all" ? "file" : variant === "start" ? "biome-block" : "next-line",
    });
  }
  return out;
}

function isEnable(comment: LexComment, tool: string): boolean {
  return new RegExp(
    `(?:^|[^A-Za-z0-9_-])${tool}-enable(?:-(?:line|next-line))?(?=[ \\t*,:]|$)`,
    "u",
  ).test(commentContent(comment.raw));
}

function biomeEnd(comment: LexComment): boolean {
  return /(?:^|[^A-Za-z0-9_-])biome-ignore-end(?=[ \t*,:]|$)/u.test(commentContent(comment.raw));
}

function applyRanges(source: string, comments: LexComment[]): Directive[] {
  const lines = sourceLines(source);
  const code = codeLines(source, comments);
  const all = comments.flatMap(directiveList);
  return all.map((d) => {
    const start = d.comment.line - 1;
    let first = start;
    let last = start;
    if (d.range === "next-line") first = last = Math.min(lines.length - 1, start + 1);
    else if (d.range === "file") {
      first = 0;
      last = lines.length - 1;
    } else if (d.range === "block" || d.range === "biome-block") {
      first = start + 1;
      const end = comments.find(
        (c) =>
          c.start > d.comment.start &&
          (d.range === "block"
            ? isEnable(c, d.form.slice(0, d.form.indexOf("-disable")))
            : biomeEnd(c)),
      );
      last = end ? end.line - 2 : lines.length - 1;
      d.endLine = end?.line;
      (d as Directive & { scopeEnd?: string }).scopeEnd = end?.raw.trim() ?? "to end of file";
    }
    const covered = code
      .slice(Math.max(first, 0), Math.max(last + 1, 0))
      .filter((line) => line !== "");
    const anchor =
      d.range === "line"
        ? (lines[start] ?? "").trim()
        : d.range === "next-line"
          ? (lines[first] ?? "").trim()
          : "";
    const identityCoverage = d.range === "line" || d.range === "next-line" ? [anchor] : covered;
    (d as Directive & { identityCoverage?: string[] }).identityCoverage = identityCoverage;
    return d;
  });
}

function isSource(path: string): boolean {
  return /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/u.test(path);
}

function treePaths(repo: string, ref: string): string[] {
  return git(repo, ["ls-tree", "-rz", "--full-tree", "--name-only", ref])
    .split("\0")
    .filter((path) => path !== "");
}

function changedPaths(repo: string, base: string, head: string): string[] {
  return git(repo, ["diff", "--no-renames", "--name-only", "-z", base, head])
    .split("\0")
    .filter((path) => path !== "");
}

function blob(repo: string, ref: string, path: string): string {
  return git(repo, ["show", `${ref}:${path}`]);
}

function directiveIdentity(path: string, d: Directive): string {
  const coverage = (d as Directive & { identityCoverage?: string[] }).identityCoverage ?? [];
  const scopeEnd = (d as Directive & { scopeEnd?: string }).scopeEnd ?? "";
  return JSON.stringify([path, d.comment.raw, coverage, scopeEnd]);
}

function additions(repo: string, base: string, head: string): SwitchOffComment[] {
  const before = new Set(treePaths(repo, base));
  const after = new Set(treePaths(repo, head));
  const paths = changedPaths(repo, base, head).filter(isSource);
  const oldCounts = new Map<string, number>();
  for (const path of paths) {
    if (!before.has(path)) continue;
    const source = blob(repo, base, path);
    for (const d of applyRanges(source, scanComments(source))) {
      const key = directiveIdentity(path, d);
      oldCounts.set(key, (oldCounts.get(key) ?? 0) + 1);
    }
  }

  const found: SwitchOffComment[] = [];
  const seen = new Map<string, number>();
  for (const path of paths) {
    if (!after.has(path)) continue;
    const source = blob(repo, head, path);
    const comments = scanComments(source);
    for (const d of applyRanges(source, comments)) {
      const key = directiveIdentity(path, d);
      const index = seen.get(key) ?? 0;
      seen.set(key, index + 1);
      if (index < (oldCounts.get(key) ?? 0)) continue;
      const identity = `comment:${sha(key)}`;
      found.push({
        id: identity,
        path,
        line: d.comment.line,
        form: d.comment.raw.trim(),
        effect: `${d.form} switches off ${d.effect}`,
        reason: d.reason,
      });
    }
  }
  return found;
}

function settingsPath(path: string): boolean {
  const name = basename(path);
  return (
    /^tsconfig.*\.json$/u.test(name) ||
    /^jsconfig.*\.json$/u.test(name) ||
    name === ".oxlintrc.json" ||
    name.startsWith(".eslintrc") ||
    name.startsWith("eslint.config.") ||
    name === ".eslintignore" ||
    name === "biome.json" ||
    name === "biome.jsonc" ||
    name.startsWith(".prettierrc") ||
    name.startsWith("prettier.config.") ||
    name === ".prettierignore" ||
    name === "bunfig.toml" ||
    name === "package.json"
  );
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function packageSettings(text: string): string | null {
  try {
    const value = JSON.parse(text) as Record<string, unknown>;
    return stable({
      scripts: value.scripts,
      eslintConfig: value.eslintConfig,
      prettier: value.prettier,
    });
  } catch {
    return null;
  }
}

function changedPackageSettings(oldText: string | null, newText: string | null): boolean {
  const empty = stable({ scripts: undefined, eslintConfig: undefined, prettier: undefined });
  const oldSettings = oldText === null ? empty : packageSettings(oldText);
  const newSettings = newText === null ? empty : packageSettings(newText);
  return oldSettings === null || newSettings === null
    ? oldText !== newText
    : oldSettings !== newSettings;
}

function settingsChanges(repo: string, base: string, head: string): SwitchOffSetting[] {
  const before = new Set(treePaths(repo, base));
  const after = new Set(treePaths(repo, head));
  const candidates = changedPaths(repo, base, head).filter(settingsPath).sort();
  const result: SwitchOffSetting[] = [];
  for (const path of candidates) {
    const oldExists = before.has(path);
    const newExists = after.has(path);
    const oldText = oldExists ? blob(repo, base, path) : null;
    const newText = newExists ? blob(repo, head, path) : null;
    if (path === "package.json" && !changedPackageSettings(oldText, newText)) continue;
    if (path !== "package.json" && oldText === newText) continue;
    const change = !oldExists ? "added" : !newExists ? "deleted" : "changed";
    const diff = run(
      "git",
      ["-C", repo, "diff", "--no-ext-diff", "--no-color", "--unified=3", base, head, "--", path],
      { env: UNSET_GIT },
    );
    if (diff.code !== 0) throw new Error(`git diff ${path}: ${diff.err.trim()}`);
    const content = newText ?? "<deleted>";
    result.push({
      id: `setting:${sha(JSON.stringify([path, content]))}`,
      path,
      change,
      diff: diff.out.trimEnd(),
    });
  }
  return result;
}

interface LoggedApproval {
  action: string;
  actor: string;
  target: string;
  detail: string;
  run: string;
}

function readActions(path: string): LoggedApproval[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const parsed = JSON.parse(line) as Partial<LoggedApproval>;
      if (
        typeof parsed.action !== "string" ||
        typeof parsed.actor !== "string" ||
        typeof parsed.target !== "string" ||
        typeof parsed.detail !== "string" ||
        typeof parsed.run !== "string"
      )
        throw new Error(`malformed action line in ${path}`);
      return parsed as LoggedApproval;
    });
}

function approvals(dispatch: string): Map<string, "approved" | "refused"> {
  const root = resolve(dispatch);
  const runId = basename(root);
  const actionPath = join(root, "actions.jsonl");
  const ledgerPath = join(dirname(root), "ledger.jsonl");
  const actionLines = readActions(actionPath);
  const ledgerLines = readActions(ledgerPath);
  const ledgerKeys = new Set(ledgerLines.map((a) => JSON.stringify(a)));
  const result = new Map<string, "approved" | "refused">();
  for (const a of actionLines) {
    if (a.action !== "switch-off" || a.actor !== "postmaster" || a.run !== runId) continue;
    if (!ledgerKeys.has(JSON.stringify(a))) continue;
    const decision = a.detail.startsWith("approved ")
      ? "approved"
      : a.detail.startsWith("refused ")
        ? "refused"
        : "";
    if (decision === "" || a.detail.slice(decision.length + 1).trim() === "")
      throw new Error(`malformed switch-off action for ${a.target}`);
    result.set(a.target, decision);
  }
  return result;
}

function md(text: string): string {
  return text.replace(/\\/gu, "\\\\").replace(/`/gu, "\\`").replace(/\n/gu, "\\n");
}

export function renderSwitchOffs(
  comments: SwitchOffComment[],
  settings: SwitchOffSetting[],
): string {
  const commentLines =
    comments.length === 0
      ? ["none"]
      : comments.map((item) => {
          const reason = item.reason === null ? "missing" : JSON.stringify(item.reason);
          return `- \`${md(item.path)}:${item.line}\`; form: \`${md(item.form)}\`; ${md(item.effect)}; reason: ${md(reason)}; id: \`${item.id}\``;
        });
  const settingLines: string[] = [];
  if (settings.length === 0) settingLines.push("none");
  for (const item of settings) {
    settingLines.push(`- \`${md(item.path)}\` (${item.change}); id: \`${item.id}\``);
    settingLines.push("  diff:");
    const longestFence = Math.max(
      0,
      ...[...item.diff.matchAll(/`+/gu)].map((match) => match[0].length),
    );
    const fence = "`".repeat(Math.max(3, longestFence + 1));
    settingLines.push(`  ${fence}diff`);
    settingLines.push(...(item.diff || "(no textual diff)").split("\n").map((line) => `  ${line}`));
    settingLines.push(`  ${fence}`);
  }
  return `## Comments\n\n${commentLines.join("\n")}\n\n## Settings changes\n\n${settingLines.join("\n")}\n`.replace(
    /<!--/gu,
    "&lt;!--",
  );
}

export function inspectSwitchOffs(options: {
  repo: string;
  defaultRef: string;
  ticketRef: string;
  dispatch?: string;
}): SwitchOffReport {
  const repo = resolve(options.repo);
  const defaultHead = commit(repo, options.defaultRef);
  const ticketHead = commit(repo, options.ticketRef);
  const base = git(repo, ["merge-base", defaultHead, ticketHead]).trim();
  if (!base) throw new Error("git merge-base returned no commit");
  const comments = additions(repo, base, ticketHead);
  const settings = settingsChanges(repo, base, ticketHead);
  const logged = options.dispatch
    ? approvals(options.dispatch)
    : new Map<string, "approved" | "refused">();
  const entries = [
    ...comments.map((item) => ({ id: item.id, reason: item.reason })),
    ...settings.map((item) => ({ id: item.id, reason: "setting" as const })),
  ];
  const refused = entries.some((item) => logged.get(item.id) === "refused");
  const missingReason = comments.some((item) => item.reason === null);
  const pending = entries.some((item) => logged.get(item.id) !== "approved");
  const status: SwitchOffStatus = refused
    ? "refused"
    : missingReason
      ? "reason-required"
      : pending
        ? "held"
        : "clear";
  return { status, comments, settings, output: renderSwitchOffs(comments, settings) };
}
