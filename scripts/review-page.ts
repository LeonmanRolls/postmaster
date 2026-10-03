// Build the data a review page or a code viewer page shows, for a session to publish as a
// private artifact. skills/review-pages/SKILL.md says how a page is published and how its
// comments are read and answered.
//
//   review-page.ts change <out-dir> --pr <number>
//   review-page.ts change <out-dir> --base <ref> --head <ref> [--ticket <number>] [--title <text>]
//                  [--summary <file>]
//   review-page.ts files <out-dir> <ref> <path>...
//
// change: diffs the head against its merge base with the base, as GitHub does, and writes
// <out-dir>/index.html (the review page, titled for its ticket), review.json and chunks/<k>.json.
// With --pr, the title, the summary (the pull request's text), the base and the head come from
// `gh api` on the repository's origin. With --ticket, or a pull request titled "#<n>, <title>",
// the ticket's text comes from that issue. --summary is a Markdown file containing the change's
// summary. Files are grouped by their first folder, top-level files first, and the
// page loads a file's diff and text only when it is opened.
//
// files: writes the code viewer, files.json and files/<k>.txt, one per path as it stands at <ref>.
//
// Either way, an email address outside the reserved example domains becomes <address removed>,
// with line numbers unchanged. Run it from the repository the change belongs to.
//
//   exit 0  written; one summary line is printed
//   exit 1  usage, or git or gh failed
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./lib/proc.ts";

export const USAGE = [
  "usage: review-page.ts change <out-dir> --pr <number>",
  "       review-page.ts change <out-dir> --base <ref> --head <ref> [--ticket <number>] [--title <text>] [--summary <file>]",
  "       review-page.ts files <out-dir> <ref> <path>...",
].join("\n");

const CHUNK_BYTES = 1_500_000;
const TEMPLATES = join(import.meta.dir, "..", "skills", "review-pages");

const LANG: Record<string, string> = {
  ".sh": "bash",
  ".ts": "typescript",
  ".js": "javascript",
  ".md": "markdown",
  ".json": "json",
  ".jsonl": "json",
  ".toml": "ini",
  ".py": "python",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".css": "css",
  ".html": "xml",
};

/** The highlight.js language for a path, or plaintext. */
export function langOf(path: string): string {
  const name = path.split("/").at(-1) ?? path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? (LANG[name.slice(dot)] ?? "plaintext") : "plaintext";
}

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[A-Za-z]{2,6}(?![A-Za-z])/gu;
const KEEP = /(^|\.)example\.(com|org|net)$|\.(invalid|test|example)$/iu;

/** Replace every email address outside the reserved example domains; line numbers stay. */
export function scrub(text: string): { text: string; removed: number } {
  let removed = 0;
  const out = text.replace(EMAIL, (m) => {
    if (KEEP.test(m.slice(m.indexOf("@") + 1))) return m;
    removed += 1;
    return "<address removed>";
  });
  return { text: out, removed };
}

/** Lines in a file's text: a final newline ends the last line rather than starting one. */
export function lineCount(text: string): number {
  if (text === "") return 0;
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}

export interface Change {
  path: string;
  old: string | null;
  status: string;
  add: number;
  del: number;
  binary: boolean;
}

/** git diff --numstat -M and --name-status -M, read together. */
export function parseChanges(numstat: string, nameStatus: string): Change[] {
  const status = new Map<string, { kind: string; old: string | null }>();
  for (const line of nameStatus.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const kind = (parts[0] ?? "M").charAt(0);
    status.set(parts.at(-1) ?? "", {
      kind,
      old: kind === "R" || kind === "C" ? (parts[1] ?? null) : null,
    });
  }
  const changes: Change[] = [];
  for (const line of numstat.split("\n")) {
    if (!line.trim()) continue;
    const [add = "0", del = "0", ...rest] = line.split("\t");
    const raw = rest.join("\t");
    const path = raw.includes(" => ")
      ? raw
          .replace(/\{([^{}]*) => ([^{}]*)\}/u, "$2")
          .replace(/\/\//gu, "/")
          .replace(/^.* => /u, "")
      : raw;
    const s = status.get(path) ?? { kind: "M", old: null };
    const binary = add === "-";
    changes.push({
      path,
      old: s.old,
      status: s.kind,
      add: binary ? 0 : Number(add),
      del: binary ? 0 : Number(del),
      binary,
    });
  }
  return changes;
}

/** Group by first folder, top-level files first, each group and its files in path order. */
export function groupChanges(changes: Change[]): {
  order: { title: string }[];
  files: (Change & { group: number })[];
} {
  const folder = (p: string): string => (p.includes("/") ? (p.split("/")[0] ?? "") : "");
  const names = [...new Set(changes.map((c) => folder(c.path)))].sort((a, b) =>
    a === "" ? -1 : b === "" ? 1 : a.localeCompare(b),
  );
  const order = names.map((n) => ({ title: n === "" ? "Top level" : `${n}/` }));
  const files = [...changes]
    .sort(
      (a, b) =>
        names.indexOf(folder(a.path)) - names.indexOf(folder(b.path)) ||
        a.path.localeCompare(b.path),
    )
    .map((c) => ({ ...c, group: names.indexOf(folder(c.path)) }));
  return { order, files };
}

/** The chunk each item goes in: a new chunk once the next item would pass the limit. */
export function packChunks(sizes: number[], limit: number): number[] {
  const out: number[] = [];
  let k = 0;
  let size = 0;
  for (const n of sizes) {
    if (size > 0 && size + n > limit) {
      k += 1;
      size = 0;
    }
    out.push(k);
    size += n;
  }
  return out;
}

/** The template with its title replaced. */
export function titled(template: string, title: string): string {
  const safe = title.replace(/[<>&]/gu, "");
  return template.replace(/<title>[^<]*<\/title>/u, `<title>${safe}</title>`);
}

// ---------- edges ----------

function git(args: string[]): string {
  const r = run("git", args);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.err.trim() || `exit ${r.code}`}`);
  return r.out;
}

function gh(path: string): Record<string, unknown> {
  const r = run("gh", ["api", path]);
  if (r.code !== 0) throw new Error(`gh api ${path}: ${r.err.trim() || `exit ${r.code}`}`);
  return JSON.parse(r.out) as Record<string, unknown>;
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function buildChange(out: string, args: string[]): string {
  const prArg = flag(args, "--pr");
  let base = flag(args, "--base");
  let head = flag(args, "--head");
  let ticket = flag(args, "--ticket");
  let title = flag(args, "--title") ?? "";
  let body = "";
  let mergedAt: string | null = null;
  let pr: number | null = null;
  if (prArg) {
    const p = gh(`repos/{owner}/{repo}/pulls/${prArg}`);
    pr = Number(prArg);
    base = String((p.base as Record<string, unknown>).sha);
    head = String((p.head as Record<string, unknown>).sha);
    body = String(p.body ?? "");
    mergedAt = (p.merged_at as string | null) ?? null;
    title = String(p.title ?? "");
    const m = /^#([0-9]+), (.*)$/u.exec(title);
    if (m && !ticket) {
      ticket = m[1];
      title = m[2] ?? title;
    }
  }
  if (!base || !head) throw new Error(USAGE);
  let ticketBody = "";
  if (ticket) {
    const issue = gh(`repos/{owner}/{repo}/issues/${ticket}`);
    ticketBody = String(issue.body ?? "");
    if (!title) title = String(issue.title ?? "");
  }
  const summaryFile = flag(args, "--summary");
  if (summaryFile) body = readFileSync(summaryFile, "utf8");
  const mb = git(["merge-base", base, head]).trim();
  const changes = parseChanges(
    git(["diff", "--numstat", "-M", mb, head]),
    git(["diff", "--name-status", "-M", mb, head]),
  );
  const { order, files } = groupChanges(changes);
  let removed = 0;
  const items = files.map((f, i) => {
    const paths = f.old ? [f.old, f.path] : [f.path];
    const diff = f.binary
      ? { text: "", removed: 0 }
      : scrub(git(["diff", "-U3", "-M", mb, head, "--", ...paths]));
    const text = f.status === "D" || f.binary ? null : scrub(git(["show", `${head}:${f.path}`]));
    removed += diff.removed + (text ? text.removed : 0);
    return { i, diff: diff.text, text: text ? text.text : null };
  });
  const chunkOf = packChunks(
    items.map((it) => JSON.stringify(it).length),
    CHUNK_BYTES,
  );
  mkdirSync(join(out, "chunks"), { recursive: true });
  const chunks = new Map<number, unknown[]>();
  items.forEach((it, i) => {
    const k = chunkOf[i] ?? 0;
    chunks.set(k, [...(chunks.get(k) ?? []), it]);
  });
  for (const [k, list] of chunks)
    writeFileSync(join(out, "chunks", `${k}.json`), JSON.stringify(list));
  const additions = files.reduce((n, f) => n + f.add, 0);
  const deletions = files.reduce((n, f) => n + f.del, 0);
  const review = {
    pr,
    ticket: ticket ? Number(ticket) : null,
    ticketTitle: title || `${head.slice(0, 7)} against ${mb.slice(0, 7)}`,
    ticketBody: scrub(ticketBody).text,
    body: scrub(body).text,
    mergedAt,
    base: mb,
    head,
    additions,
    deletions,
    changedFiles: files.length,
    order,
    redactions: removed,
    files: files.map((f, i) => ({
      ...f,
      lang: langOf(f.path),
      chunk: chunkOf[i] ?? 0,
      lines: items[i]?.text == null ? null : lineCount(items[i]?.text ?? ""),
    })),
  };
  writeFileSync(join(out, "review.json"), JSON.stringify(review));
  const name = ticket ? `#${ticket} review` : `${head.slice(0, 7)} review`;
  writeFileSync(
    join(out, "index.html"),
    titled(readFileSync(join(TEMPLATES, "review-page.html"), "utf8"), name),
  );
  return `review page for ${name.replace(/ review$/u, "")}: ${files.length} files, +${additions} -${deletions}, ${chunks.size} chunk(s), ${removed} address(es) removed, in ${out}`;
}

function buildFiles(out: string, ref: string, paths: string[]): string {
  if (paths.length === 0) throw new Error(USAGE);
  const sha = git(["rev-parse", "--verify", `${ref}^{commit}`]).trim();
  mkdirSync(join(out, "files"), { recursive: true });
  let removed = 0;
  const files = paths.map((p, k) => {
    const t = scrub(git(["show", `${sha}:${p}`]));
    removed += t.removed;
    const src = `files/${k}.txt`;
    writeFileSync(join(out, src), t.text);
    return { id: `f${k}`, path: p, lang: langOf(p), src, lines: lineCount(t.text) };
  });
  const title =
    paths.length === 1 ? (paths[0] ?? "Code") : `${paths.length} files at ${sha.slice(0, 7)}`;
  writeFileSync(join(out, "files.json"), JSON.stringify({ title, ref: sha, files }));
  writeFileSync(
    join(out, "index.html"),
    titled(readFileSync(join(TEMPLATES, "viewer.html"), "utf8"), "Code"),
  );
  return `code viewer: ${files.length} file(s) at ${sha.slice(0, 7)}, ${removed} address(es) removed, in ${out}`;
}

export function main(args: string[]): number {
  const [mode, out, ...rest] = args;
  try {
    if (mode === "change" && out) {
      console.log(buildChange(out, rest));
      return 0;
    }
    if (mode === "files" && out && rest[0]) {
      console.log(buildFiles(out, rest[0], rest.slice(1)));
      return 0;
    }
    console.error(USAGE);
    return 1;
  } catch (e) {
    console.error(`review-page: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
