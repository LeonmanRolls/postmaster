// Collect the non-blank lines of a text, trimmed.
export function collectLines(out: string[], text: string): void {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed !== "") out.push(trimmed);
  }
}
