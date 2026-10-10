// Text shown on published pages: the highlight.js language for a path, and the
// email redaction that runs before any text is shown, line numbers unchanged.
// Shared by the review page and the story page builders.
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

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[A-Za-z]{2,}(?![A-Za-z])/gu;
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
