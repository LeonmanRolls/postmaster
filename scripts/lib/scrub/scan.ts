// Streaming marker-aware line scanner: feed (number, text) in file order;
// a next-line marker outside strings applies only to the very next fed
// line. Each fed line scans as units: the raw line first, then each JSON
// string's decoded logical lines, all records mapped home to original
// offsets. Each valid marker must suppress at least one finding the
// others did not, same-line markers first: a redundant marker faults like
// an unused one. A marker never suppresses inside its own text.
import {
  type Finding,
  type MarkerHead,
  findings,
  getDisabled,
  parseMarkers,
} from "./rules.ts";
import { type Pair, type Unit, homeSpanOf, scanUnits } from "./decode.ts";

/** (start, end, kind, value) within one line. */
type SpanFinding = [number, number, string, string];
/** (line, start, end, kind, value) reported. */
export type KeptFinding = [number, number, number, string, string];
export type MarkerFault = [number, number, number];

export class LineScanner {
  private find: (line: string) => Finding[];
  private prev: [number, MarkerHead[]] | null = null;
  private off: boolean;
  kept: KeptFinding[] = [];
  faults: MarkerFault[] = [];
  suppressed: KeptFinding[] = [];

  constructor(
    find: (line: string) => Finding[] = findings,
    markers = true,
  ) {
    this.find = find;
    this.off = !markers || getDisabled().has("markers");
  }

  feed(number: number, text: string, inKeyBlock = false): void {
    const { units, strings } = scanUnits(text);
    const owned = (start: number): boolean =>
      strings.some(([s, e]) => s <= start && start < e);
    const homed: SpanFinding[][] = units.map(([unit, mapping]) =>
      this.find(unit).map(
        ([start, end, kind, value]) =>
          [...homeSpanOf(mapping as Pair[], start, end), kind, value] as SpanFinding,
      ),
    );
    if (inKeyBlock && !getDisabled().has("token") && units[0]![0].trim()) {
      const [rawText, rawMap] = units[0]!;
      homed[0]!.push([
        ...homeSpanOf(rawMap as Pair[], 0, rawText.length),
        "token",
        rawText,
      ] as SpanFinding);
    }
    // A finding exactly equal to one in a later unit is the same bytes
    // through a shallower view: the shallow copy drops.
    const seen = new Set<string>();
    for (let depth = homed.length - 1; depth >= 0; depth--) {
      const survivors: SpanFinding[] = [];
      for (const item of homed[depth]!) {
        const key = item.join("\u0000");
        if (!seen.has(key)) {
          survivors.push(item);
          seen.add(key);
        }
      }
      homed[depth] = survivors;
    }
    if (this.off) {
      const inert = homed.flat();
      inert.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2].localeCompare(b[2]));
      for (const [start, end, kind, value] of inert) {
        this.kept.push([number, start, end, kind, value]);
      }
      this.prev = [number, []];
      return;
    }
    // A string unit's logical successor is the next unit from its own
    // top-level string.
    const nextIndex = new Map<number, number | null>();
    for (let index = 0; index < units.length; index++) {
      const prov = units[index]![2];
      if (prov !== null) {
        let following: number | null = null;
        for (let later = index + 1; later < units.length; later++) {
          if (units[later]![2] === prov) {
            following = later;
            break;
          }
        }
        nextIndex.set(index, following);
      }
    }
    const physical = homed.some((h) => h.length > 0);
    const current: SpanFinding[] = [];
    const nextMarks: MarkerHead[] = [];
    const pending = new Map<number, MarkerHead[]>();
    for (let index = 0; index < units.length; index++) {
      const [unit, mapping, prov] = units[index]!;
      const items = homed[index]!;
      const due = prov !== null ? (pending.get(prov) ?? []) : [];
      if (prov !== null) pending.delete(prov);
      let marks: MarkerHead[];
      if (index === 0) {
        marks = parseMarkers(unit).filter((m) => !owned(m.span[0]));
      } else {
        marks = parseMarkers(unit);
      }
      marks = marks.map((m) => ({
        ...m,
        span: homeSpanOf(mapping as Pair[], m.span[0], m.span[1]) as [number, number],
      }));
      for (const mark of marks) {
        if (!mark.valid && !mark.nextLine && physical) {
          this.faults.push([number, mark.span[0], mark.span[1]]);
        }
        if (mark.nextLine) {
          if (prov === null) {
            nextMarks.push(mark);
          } else if (nextIndex.get(index) == null) {
            if (mark.valid) {
              this.faults.push([number, mark.span[0], mark.span[1]]);
            }
          } else {
            const list = pending.get(prov) ?? [];
            list.push(mark);
            pending.set(prov, list);
          }
        }
      }
      let live = [...items];
      for (const mark of marks.filter((m) => m.valid && !m.nextLine)) {
        const hits = live.filter(
          (item) => item[2] === mark.rule && item[1] <= mark.span[0],
        );
        if (hits.length === 0) {
          this.faults.push([number, mark.span[0], mark.span[1]]);
        } else {
          for (const [s, e, k, v] of hits) {
            this.suppressed.push([number, s, e, k, v]);
          }
          const hitSet = new Set(hits.map((h) => h.join("\u0000")));
          live = live.filter((item) => !hitSet.has(item.join("\u0000")));
        }
      }
      for (const mark of due) {
        if (mark.valid) {
          const hits = live.filter((item) => item[2] === mark.rule);
          if (hits.length === 0) {
            this.faults.push([number, mark.span[0], mark.span[1]]);
          } else {
            for (const [s, e, k, v] of hits) {
              this.suppressed.push([number, s, e, k, v]);
            }
            const hitSet = new Set(hits.map((h) => h.join("\u0000")));
            live = live.filter((item) => !hitSet.has(item.join("\u0000")));
          }
        } else if (items.length > 0) {
          this.faults.push([number, mark.span[0], mark.span[1]]);
        }
      }
      for (const item of live) {
        current.push([...item] as SpanFinding);
      }
    }
    // Units emit raw-first; restore (start, end, kind) order.
    current.sort(
      (a, b) => a[0] - b[0] || a[1] - b[1] || a[2].localeCompare(b[2]),
    );
    if (this.prev !== null) {
      const [prevNumber, prevMarks] = this.prev;
      if (prevNumber === number - 1) {
        for (const mark of prevMarks) {
          if (mark.valid) {
            const hits = current.filter((item) => item[2] === mark.rule);
            if (hits.length === 0) {
              this.faults.push([prevNumber, mark.span[0], mark.span[1]]);
            } else {
              for (const [s, e, k, v] of hits) {
                this.suppressed.push([number, s, e, k, v]);
              }
              const hitSet = new Set(hits.map((h) => h.join("\u0000")));
              for (let i = current.length - 1; i >= 0; i--) {
                if (hitSet.has(current[i]!.join("\u0000"))) current.splice(i, 1);
              }
            }
          } else if (physical) {
            this.faults.push([prevNumber, mark.span[0], mark.span[1]]);
          }
        }
      } else {
        for (const mark of prevMarks) {
          if (mark.valid) {
            this.faults.push([prevNumber, mark.span[0], mark.span[1]]);
          }
        }
      }
    }
    for (const [start, end, kind, value] of current) {
      this.kept.push([number, start, end, kind, value]);
    }
    this.prev = [number, nextMarks];
  }

  flush(): void {
    if (this.prev !== null) {
      const [prevNumber, prevMarks] = this.prev;
      for (const mark of prevMarks) {
        if (mark.valid) {
          this.faults.push([prevNumber, mark.span[0], mark.span[1]]);
        }
      }
      this.prev = null;
    }
  }
}

// --- safe path -----------------------------------------------------------

export function safePath(path: string): string {
  const spans = [
    ...new Set(findings(path).map(([s, e]) => `${s}:${e}`)),
  ]
    .map((k) => k.split(":").map(Number) as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [start, end] of spans) {
    if (merged.length > 0 && start <= merged[merged.length - 1]![1]) {
      merged[merged.length - 1] = [
        merged[merged.length - 1]![0],
        Math.max(merged[merged.length - 1]![1], end),
      ];
    } else {
      merged.push([start, end]);
    }
  }
  const pieces: string[] = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    pieces.push(path.slice(cursor, start));
    pieces.push("[redacted]");
    cursor = end;
  }
  pieces.push(path.slice(cursor));
  const safe = pieces.join("");
  let out = "";
  for (const ch of safe) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0xdc80 && cp <= 0xdcff) {
      out += `\\x${(cp - 0xdc00).toString(16).padStart(2, "0")}`;
    } else if (cp >= 0x20 && cp !== 0x7f) {
      out += ch;
    } else {
      out += `\\x${cp.toString(16).padStart(2, "0")}`;
    }
  }
  return out;
}

export type { Unit };
