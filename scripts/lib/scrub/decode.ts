// Transcript decoding: strip CSI and OSC escape sequences, decode JSON
// strings nested to a stated depth, decode a cut-off last record as far
// as it goes, and read UTF-16 by its byte-order mark. Every file is read
// this way; no other encoding is undone.

const ANSI_SEQUENCE = new RegExp(
  String.raw`(?:\x1b\[|\x9b)[0-9:;<=>?]*[ -/]*[@-~]` +
    String.raw`|(?:\x1b\]|\x9d)(?<params>[^\x07\x1b\x9c]*)(?:\x07|\x1b\\|\x9c)` +
    String.raw`|\x1b[()][0-9A-Za-z]|\x1b[0-~]|\x1b`,
  "gu",
);
const JSON_STRING = /"(?:[^"\\\n]|\\.)*"/gu;

export const NEST_MAX_DEPTH = 64;

export type Pair = [number, number];

export interface StrippedText {
  text: string;
  kept: number[];
  extras: Array<[string, number[]]>;
}

export function stripAnsi(text: string): StrippedText {
  const chars: string[] = [];
  const kept: number[] = [];
  const extras: Array<[string, number[]]> = [];
  let cursor = 0;
  ANSI_SEQUENCE.lastIndex = 0;
  for (const m of text.matchAll(ANSI_SEQUENCE)) {
    chars.push(text.slice(cursor, m.index!));
    for (let o = cursor; o < m.index!; o++) kept.push(o);
    const params = m.groups?.params;
    if (params !== undefined && params !== null) {
      const base = m.index! + m[0].indexOf(params);
      const offsets: number[] = [];
      for (let o = base; o < base + params.length; o++) offsets.push(o);
      extras.push([params, offsets]);
    }
    cursor = m.index! + m[0].length;
  }
  chars.push(text.slice(cursor));
  for (let o = cursor; o < text.length; o++) kept.push(o);
  return { text: chars.join(""), kept, extras };
}

const UNESCAPES: Record<string, string> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};
const HEX = /^[0-9a-fA-F]$/u;

export type UnquoteYield = [string, number, number];

export function* unquoteToken(
  inner: string,
  base: number,
): Generator<UnquoteYield> {
  let i = 0;
  const end = inner.length;
  while (i < end) {
    const ch = inner[i]!;
    if (ch !== "\\" || i + 1 >= end) {
      yield [ch, base + i, base + i + 1];
      i += 1;
      continue;
    }
    const esc = inner[i + 1]!;
    if (esc in UNESCAPES) {
      yield [UNESCAPES[esc]!, base + i, base + i + 2];
      i += 2;
    } else if (
      esc === "u" &&
      i + 6 <= end &&
      Array.from(inner.slice(i + 2, i + 6)).every((c) => HEX.test(c))
    ) {
      let code = parseInt(inner.slice(i + 2, i + 6), 16);
      let nxt = i + 6;
      if (
        code >= 0xd800 &&
        code <= 0xdbff &&
        nxt + 6 <= end &&
        inner.slice(nxt, nxt + 2) === "\\u" &&
        Array.from(inner.slice(nxt + 2, nxt + 6)).every((c) => HEX.test(c))
      ) {
        const low = parseInt(inner.slice(nxt + 2, nxt + 6), 16);
        if (low >= 0xdc00 && low <= 0xdfff) {
          code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
          nxt += 6;
        }
      }
      yield [String.fromCodePoint(code), base + i, base + nxt];
      i = nxt;
    } else {
      yield ["\\", base + i, base + i + 1];
      i += 1;
    }
  }
}

/** A unit is (text, home-map, prov). The home-map gives each char's
 * (start,end) offsets in the original line. prov is the top-level string
 * index, or null for the raw line and OSC leaves. */
export type Unit = [string, Pair[], number | null];

function mapHome(mapping: Pair[], s: number, e: number): Pair {
  const a = mapping[s];
  const b = mapping[e - 1];
  return [a?.[0] ?? s, b?.[1] ?? e];
}

function cleanLine(
  text: string,
  home: Pair[],
  prov: number | null,
  depth: number,
): Unit[] {
  const { text: stripped, kept, extras } = stripAnsi(text);
  const mapping: Pair[] = kept.map(
    (o, j) => home[o] ?? home[j] ?? ([o, o + 1] as Pair),
  );
  const units = nestedUnits(stripped, mapping, prov, depth);
  for (const [ptext, pmap] of extras) {
    units.push([
      ptext,
      pmap.map((o) => home[o] ?? ([o, o + 1] as Pair)),
      null,
    ]);
  }
  return units;
}

function nestedUnits(
  text: string,
  mapping: Pair[],
  prov: number | null,
  depth: number,
): Unit[] {
  const out: Unit[] = [[text, mapping, prov]];
  if (depth >= NEST_MAX_DEPTH) return out;
  JSON_STRING.lastIndex = 0;
  for (const m of text.matchAll(JSON_STRING)) {
    const start = m.index!;
    const end = start + m[0].length;
    if (end - start < 2) continue;
    let run = "";
    let spans: Array<[number, number]> = [];
    for (const [ch, pstart, pend] of unquoteToken(
      text.slice(start + 1, end - 1),
      start + 1,
    )) {
      if (ch === "\n" || ch === "\r") {
        if (run) {
          const home = spans.map(([s, e]) => mapHome(mapping, s, e));
          out.push(...cleanLine(run, home, prov, depth + 1));
          run = "";
          spans = [];
        }
      } else {
        run += ch;
        spans.push([pstart, pend]);
      }
    }
    if (run) {
      const home = spans.map(([s, e]) => mapHome(mapping, s, e));
      out.push(...cleanLine(run, home, prov, depth + 1));
    }
  }
  return out;
}

export interface ScanUnits {
  units: Unit[];
  /** Spans of top-level JSON strings in the stripped text. */
  strings: Array<[number, number]>;
}

/** The views of one physical line: the raw unit, then decoded units. */
export function scanUnits(text: string): ScanUnits {
  const { text: stripped, kept, extras } = stripAnsi(text);
  const rawMap: Pair[] = kept.map((o) => [o, o + 1]);
  const units: Unit[] = [[stripped, rawMap, null]];
  for (const [ptext, pmap] of extras) {
    units.push([ptext, pmap.map((o) => [o, o + 1] as Pair), null]);
  }
  const strings: Array<[number, number]> = [];
  let strIndex = 0;
  JSON_STRING.lastIndex = 0;
  for (const m of stripped.matchAll(JSON_STRING)) {
    const start = m.index!;
    const end = start + m[0].length;
    if (end - start < 2) continue;
    strings.push([start, end]);
    let run = "";
    let spans: Array<[number, number]> = [];
    for (const [ch, pstart, pend] of unquoteToken(
      stripped.slice(start + 1, end - 1),
      start + 1,
    )) {
      if (ch === "\n" || ch === "\r") {
        if (run) {
          const home = spans.map(([s, e]) => {
            const a = kept[s];
            const b = kept[e - 1];
            return [a ?? s, (b ?? e - 1) + 1] as Pair;
          });
          units.push(...cleanLine(run, home, strIndex, 0));
          run = "";
          spans = [];
        }
      } else {
        run += ch;
        spans.push([pstart, pend]);
      }
    }
    if (run) {
      const home = spans.map(([s, e]) => {
        const a = kept[s];
        const b = kept[e - 1];
        return [a ?? s, (b ?? e - 1) + 1] as Pair;
      });
      units.push(...cleanLine(run, home, strIndex, 0));
    }
    strIndex++;
  }
  return { units, strings };
}

export function homeSpanOf(
  mapping: Pair[],
  start: number,
  end: number,
): Pair {
  return mapHome(mapping, start, end);
}

// UTF-16 detection and decoding.
export function decodeBytes(buf: Uint8Array): string {
  if (buf.length >= 2) {
    if (buf[0] === 0xff && buf[1] === 0xfe) {
      return new TextDecoder("utf-16le").decode(buf.subarray(2));
    }
    if (buf[0] === 0xfe && buf[1] === 0xff) {
      return new TextDecoder("utf-16be").decode(buf.subarray(2));
    }
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(buf);
}
