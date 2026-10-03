/**
 * Every unique added line of a revision's history, as the Jev trial reads it
 * (`history_lines` in `../../jev-pii/apparatus/pii_jev.py`), so that both trials judge the same
 * lines in the same order: outside `raw/runs` and JSONL files, oldest first, each line once with
 * the commit and path that first added it and up to three lines of its hunk on each side. A line
 * with no letter and fewer than seven digits is skipped. Python's line breaks and Python's
 * whitespace are spelled out, since ECMAScript's differ; `identity` in run.ts checks the result.
 */

export interface HistoryLine {
  commit: string;
  path: string;
  text: string;
  context: string;
}

/** The breaks Python's str.splitlines splits on; some are control characters, on purpose. */
// oxlint-disable-next-line no-control-regex
const PY_LINE_BREAK = /\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/;
/** A line Python's str.strip leaves empty. */
// oxlint-disable-next-line no-control-regex
const PY_BLANK = /^[\t-\r\x1c-\x20\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*$/;

export function historyLines(rev: string): HistoryLine[] {
  const git = Bun.spawnSync(
    ["git", "log", "--reverse", "--no-merges", "--no-renames", "-p", "--format=commit %H", rev, "--", ".", ":!raw/runs", ":!*.jsonl"],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (git.exitCode !== 0) throw new Error(`git log failed: ${git.stderr.toString()}`);
  const log = new TextDecoder("utf-8").decode(git.stdout);
  const seen = new Set<string>();
  const out: HistoryLine[] = [];
  const contexts = new Map<string, string>();
  let commit = "";
  let path = "";
  let hunk: string[] = [];
  let pending: [string, number][] = [];
  const flush = () => {
    for (const [text, at] of pending) {
      contexts.set(text, [...hunk.slice(Math.max(0, at - 3), at), ...hunk.slice(at + 1, at + 4)].join("\n"));
    }
    hunk = [];
    pending = [];
  };
  for (const raw of log.split(PY_LINE_BREAK)) {
    if (raw.startsWith("commit ") || raw.startsWith("diff --git ") || raw.startsWith("@@")) {
      flush();
      if (raw.startsWith("commit ")) commit = raw.slice(7);
    } else if (raw.startsWith("+++ ")) {
      path = raw.startsWith("+++ b/") ? raw.slice(6) : "";
    } else if (raw.startsWith(" ")) {
      hunk.push(raw.slice(1));
    } else if (raw.startsWith("+") && !raw.startsWith("+++") && path) {
      const text = raw.slice(1);
      hunk.push(text);
      if (!/[A-Za-z]/.test(text) && (text.match(/[0-9]/g) ?? []).length < 7) continue;
      if (!PY_BLANK.test(text) && !seen.has(text)) {
        seen.add(text);
        pending.push([text, hunk.length - 1]);
        out.push({ commit, path, text, context: "" });
      }
    }
  }
  flush();
  for (const line of out) line.context = contexts.get(line.text) ?? "";
  return out;
}
