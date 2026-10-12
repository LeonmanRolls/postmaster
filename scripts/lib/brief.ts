// One reading of the waybill's project facts, shared by the reach control
// and the ticket-reads check. The ticket travels in the waybill verbatim and
// may quote a profile line, so only the Project profile section counts; a
// waybill without one reads whole.

/** A waybill section by heading; the last one wins, since the ticket may quote one. */
export function briefSection(brief: string, heading: string): string {
  const lines = brief.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]?.startsWith(heading)) start = i + 1;
  }
  if (start < 0) return "";
  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    if (lines[i]?.startsWith("## ")) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

export interface ProfileRepo {
  repo: string;
  branch: string;
}

/**
 * The repo: line's path and default branch. The path runs to the end of the
 * line: it may itself hold spaces, and only a "default branch:" marker ends
 * it early. Either field is "" when the scope names none.
 */
export function profileRepo(scope: string): ProfileRepo {
  const profile =
    /^repo:[ \t]*([^ \r\n]*(?:[ \t]+(?!default branch:)[^ \t\r\n]+)*)(?:[ \t]+default branch:[ \t]*([^ \t\r\n]+))?/mu.exec(
      scope,
    );
  return { repo: profile?.[1] ?? "", branch: profile?.[2] ?? "" };
}
