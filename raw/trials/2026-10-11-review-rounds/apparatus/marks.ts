// The two readers' marks of the later findings (see ../rule.md, "Marks" and "The second reader").
// Pure: it takes the readers' text and returns marks, agreement and the findings each reader or
// both gave a mark.
import { kappa } from "./stats.ts";

export const KINDS = ["input", "state", "contract", "site", "prose", "test", "other"] as const;
export type Kind = (typeof KINDS)[number];
export type TicketOpen = "yes" | "no" | "unclear";

export type Mark = {
  id: string;
  ticketOpen: TicketOpen;
  disagrees: "yes" | "no";
  kind: Kind;
  reason: string;
};

/** Lines `id<TAB>ticket_open<TAB>disagrees<TAB>kind<TAB>reason`; a line that is not one is returned. */
export function parseMarks(text: string): { marks: Mark[]; bad: string[] } {
  const marks: Mark[] = [];
  const bad: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    const cols = line.split("\t");
    const id = cols[0]?.trim() ?? "";
    const open = cols[1]?.trim().toLowerCase() ?? "";
    const dis = cols[2]?.trim().toLowerCase() ?? "";
    const kind = cols[3]?.trim().toLowerCase() ?? "";
    if (
      !/^[0-9]+\.[0-9]+\.[0-9]+$/u.test(id) ||
      !["yes", "no", "unclear"].includes(open) ||
      !["yes", "no"].includes(dis) ||
      !(KINDS as readonly string[]).includes(kind)
    ) {
      bad.push(line);
      continue;
    }
    marks.push({
      id,
      ticketOpen: open as TicketOpen,
      disagrees: dis as "yes" | "no",
      kind: kind as Kind,
      reason: (cols[4] ?? "").trim(),
    });
  }
  return { marks, bad };
}

export type MarkAgreement = {
  n: number;
  /** the same ticket_open, disagrees and kind, and the share of the items each is */
  ticketOpen: { same: number; kappa: number };
  disagrees: { same: number; kappa: number };
  kind: { same: number; kappa: number };
  onlyA: string[];
  onlyB: string[];
};

/** How far two readers agree on the items both marked. */
export function agreement(a: readonly Mark[], b: readonly Mark[]): MarkAgreement {
  const bById = new Map(b.map((m) => [m.id, m]));
  const both: Array<[Mark, Mark]> = [];
  for (const m of a) {
    const o = bById.get(m.id);
    if (o) both.push([m, o]);
  }
  const ids = new Set(both.map(([m]) => m.id));
  const part = (pick: (m: Mark) => string): { same: number; kappa: number } => ({
    same: both.filter(([x, y]) => pick(x) === pick(y)).length,
    kappa: kappa(
      both.map(([x]) => pick(x)),
      both.map(([, y]) => pick(y)),
    ),
  });
  return {
    n: both.length,
    ticketOpen: part((m) => m.ticketOpen),
    disagrees: part((m) => m.disagrees),
    kind: part((m) => m.kind),
    onlyA: a.filter((m) => !bById.has(m.id)).map((m) => m.id),
    onlyB: b.filter((m) => !ids.has(m.id)).map((m) => m.id),
  };
}

export type Combined = {
  id: string;
  /** both readers say yes: the lower bound */
  openBoth: boolean;
  /** at least one says yes: the upper bound */
  openEither: boolean;
  disagreesBoth: boolean;
  disagreesEither: boolean;
  /** the kind where both give the same, else null */
  kind: Kind | null;
  kindA: Kind;
  kindB: Kind;
};

/** One row per finding both readers marked. */
export function combine(a: readonly Mark[], b: readonly Mark[]): Combined[] {
  const bById = new Map(b.map((m) => [m.id, m]));
  const out: Combined[] = [];
  for (const m of a) {
    const o = bById.get(m.id);
    if (!o) continue;
    out.push({
      id: m.id,
      openBoth: m.ticketOpen === "yes" && o.ticketOpen === "yes",
      openEither: m.ticketOpen === "yes" || o.ticketOpen === "yes",
      disagreesBoth: m.disagrees === "yes" && o.disagrees === "yes",
      disagreesEither: m.disagrees === "yes" || o.disagrees === "yes",
      kind: m.kind === o.kind ? m.kind : null,
      kindA: m.kind,
      kindB: o.kind,
    });
  }
  return out;
}
