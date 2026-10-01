// The proposed rule format: a rule is data, shaped like a gitleaks rule, with ECMAScript
// regular expressions, a `requires` list beside the allowlists, and a closed list of named
// checks for what a regular expression cannot say. This file is the format's validator and a
// reference engine for it, nothing more: what a library would ship is not written here.

export type Target = "secret" | "match" | "line" | `group:${string}`;

export interface Filter {
  regexTarget?: Target;
  regexes: string[];
  flags?: string;
}

export interface Rule {
  id: string;
  description?: string;
  regex: string;
  flags?: string;
  secretGroup?: string | string[];
  keywords?: string[];
  minLength?: number;
  check?: string;
  allowlists?: Filter[];
  requires?: Filter[];
}

// [start, end, rule], offsets in code points.
export type Finding = [number, number, string];

const RULE_KEYS = new Set([
  "id", "description", "regex", "flags", "secretGroup", "keywords", "minLength", "check",
  "allowlists", "requires",
]);
const FILTER_KEYS = new Set(["regexTarget", "regexes", "flags"]);
const FLAGS = /^[imsuv]*$/;

// What a regular expression cannot say, by name. A rule names one; the list is closed.
export const CHECKS: Record<string, (secret: string) => boolean> = {
  "ip-private": ipPrivate,
};

// Every reason a rule is not in the format, or [] when it is.
export function validate(rule: Rule): string[] {
  const faults: string[] = [];
  for (const key of Object.keys(rule)) if (!RULE_KEYS.has(key)) faults.push(`unknown key ${key}`);
  if (typeof rule.id !== "string" || !rule.id) faults.push("no id");
  if (typeof rule.regex !== "string") faults.push("no regex");
  const flags = rule.flags ?? "";
  if (!FLAGS.test(flags)) faults.push(`flags ${flags} outside i, m, s, u, v`);
  let compiled: RegExp | undefined;
  try {
    compiled = new RegExp(rule.regex, flags + "gd");
  } catch (error) {
    faults.push(`regex does not compile: ${String(error).slice(0, 80)}`);
  }
  for (const name of [rule.secretGroup ?? []].flat()) {
    if (compiled && !groupNames(rule.regex).has(name)) faults.push(`secretGroup ${name} names no group`);
  }
  if (rule.check !== undefined && !(rule.check in CHECKS)) faults.push(`no check named ${rule.check}`);
  if (rule.minLength !== undefined && !(Number.isInteger(rule.minLength) && rule.minLength > 0)) {
    faults.push("minLength is not a positive integer");
  }
  for (const [name, list] of [["allowlists", rule.allowlists], ["requires", rule.requires]] as const) {
    for (const filter of list ?? []) {
      for (const key of Object.keys(filter)) if (!FILTER_KEYS.has(key)) faults.push(`${name}: unknown key ${key}`);
      const target = filter.regexTarget ?? "secret";
      if (!/^(secret|match|line|group:[A-Za-z_][A-Za-z0-9_]*)$/.test(target)) {
        faults.push(`${name}: target ${target}`);
      } else if (target.startsWith("group:") && !groupNames(rule.regex).has(target.slice(6))) {
        faults.push(`${name}: ${target} names no group`);
      }
      if (!FLAGS.test(filter.flags ?? "")) faults.push(`${name}: flags ${filter.flags}`);
      for (const source of filter.regexes ?? []) {
        try {
          new RegExp(source, filter.flags ?? "");
        } catch (error) {
          faults.push(`${name}: regex does not compile: ${String(error).slice(0, 80)}`);
        }
      }
      if (!filter.regexes?.length) faults.push(`${name}: no regexes`);
    }
  }
  return faults;
}

function groupNames(source: string): Set<string> {
  return new Set([...source.matchAll(/\(\?<([A-Za-z_][A-Za-z0-9_]*)>/g)].map((m) => m[1]));
}

// UTF-16 offset to code point offset, for one line.
function codePoints(line: string): (unit: number) => number {
  const map = new Int32Array(line.length + 1);
  let point = 0;
  for (let unit = 0; unit < line.length; unit++) {
    map[unit] = point;
    const code = line.charCodeAt(unit);
    if (code >= 0xd800 && code <= 0xdbff && unit + 1 < line.length) {
      const next = line.charCodeAt(unit + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        map[++unit] = point;
      }
    }
    point++;
  }
  map[line.length] = point;
  return (unit) => map[unit];
}

const compiled = new Map<string, RegExp>();
function re(source: string, flags: string): RegExp {
  const key = flags + "\u0000" + source;
  let found = compiled.get(key);
  if (!found) {
    found = new RegExp(source, flags);
    compiled.set(key, found);
  }
  found.lastIndex = 0;
  return found;
}

export function find(rules: Rule[], line: string): Finding[] {
  const point = codePoints(line);
  const lower = line.toLowerCase();
  const out = new Map<string, Finding>();
  for (const rule of rules) {
    if (rule.keywords?.length && !rule.keywords.some((word) => lower.includes(word.toLowerCase()))) continue;
    for (const match of line.matchAll(re(rule.regex, (rule.flags ?? "") + "gd"))) {
      const indices = match.indices!;
      // A list of groups means the first that took part in the match.
      const span = rule.secretGroup === undefined
        ? indices[0]
        : [rule.secretGroup].flat().map((name) => indices.groups?.[name]).find((found) => found !== undefined);
      if (!span) continue;
      const secret = line.slice(span[0], span[1]);
      if (rule.minLength !== undefined && [...secret].length < rule.minLength) continue;
      if (rule.check !== undefined && !CHECKS[rule.check](secret)) continue;
      const target = (filter: Filter): string | undefined => {
        const name = filter.regexTarget ?? "secret";
        if (name === "secret") return secret;
        if (name === "match") return match[0];
        if (name === "line") return line;
        return match.groups?.[name.slice(6)];
      };
      const hits = (filter: Filter): boolean => {
        const text = target(filter);
        return text !== undefined && filter.regexes.some((source) => re(source, filter.flags ?? "").test(text));
      };
      if (rule.allowlists?.some(hits)) continue;
      if (rule.requires && !rule.requires.every(hits)) continue;
      const finding: Finding = [point(span[0]), point(span[1]), rule.id];
      out.set(finding.join("\u0000"), finding);
    }
  }
  return [...out.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1] || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0));
}

// --- the named check: an address that is private, link-local or carrier-grade, never
// loopback or unspecified. The registry lists are IANA's special-purpose registries, as
// CPython 3.12's ipaddress module carries them; the parsers follow its strictness.

function octets(text: string): number | undefined {
  const parts = text.split(".");
  if (parts.length !== 4) return undefined;
  let value = 0;
  for (const part of parts) {
    if (!/^[0-9]{1,3}$/.test(part) || (part !== "0" && part[0] === "0")) return undefined;
    const octet = Number(part);
    if (octet > 255) return undefined;
    value = value * 256 + octet;
  }
  return value;
}

function hextets(text: string): bigint | undefined {
  if (!text) return undefined;
  const parts = text.split(":");
  if (parts.length < 3) return undefined;
  if (parts[parts.length - 1].includes(".")) {
    const v4 = octets(parts.pop()!);
    if (v4 === undefined) return undefined;
    parts.push(((v4 >>> 16) & 0xffff).toString(16), (v4 & 0xffff).toString(16));
  }
  if (parts.length > 9) return undefined;
  let skip: number | undefined;
  for (let i = 1; i < parts.length - 1; i++) {
    if (!parts[i]) {
      if (skip !== undefined) return undefined;
      skip = i;
    }
  }
  let hi: number, lo: number, skipped: number;
  if (skip !== undefined) {
    hi = skip;
    lo = parts.length - skip - 1;
    if (!parts[0] && --hi) return undefined;
    if (!parts[parts.length - 1] && --lo) return undefined;
    skipped = 8 - (hi + lo);
    if (skipped < 1) return undefined;
  } else {
    if (parts.length !== 8 || !parts[0] || !parts[parts.length - 1]) return undefined;
    hi = parts.length;
    lo = 0;
    skipped = 0;
  }
  const hextet = (part: string): bigint | undefined =>
    /^[0-9A-Fa-f]{1,4}$/.test(part) ? BigInt(parseInt(part, 16)) : undefined;
  let value = 0n;
  for (let i = 0; i < hi; i++) {
    const h = hextet(parts[i]);
    if (h === undefined) return undefined;
    value = (value << 16n) | h;
  }
  value <<= 16n * BigInt(skipped);
  for (let i = parts.length - lo; i < parts.length; i++) {
    const h = hextet(parts[i]);
    if (h === undefined) return undefined;
    value = (value << 16n) | h;
  }
  return value;
}

type Net = [bigint, number];
// Networks are written as numbers, not as address text, so this source holds no address the
// rules would find.
const v4net = (octets: number[], length: number): Net =>
  [octets.reduce((value, octet) => (value << 8n) | BigInt(octet), 0n), length];
const v6net = (head: number[], length: number): Net =>
  [[...head, ...Array(8 - head.length).fill(0)].reduce((value, h) => (value << 16n) | BigInt(h), 0n), length];
const within = (value: bigint, bits: number, [base, length]: Net): boolean =>
  value >> BigInt(bits - length) === base >> BigInt(bits - length);

const V4_PRIVATE: Net[] = [
  v4net([0, 0, 0, 0], 8), v4net([10, 0, 0, 0], 8), v4net([127, 0, 0, 0], 8), v4net([169, 254, 0, 0], 16),
  v4net([172, 16, 0, 0], 12), v4net([192, 0, 0, 0], 24), v4net([192, 0, 0, 170], 31), v4net([192, 0, 2, 0], 24),
  v4net([192, 168, 0, 0], 16), v4net([198, 18, 0, 0], 15), v4net([198, 51, 100, 0], 24), v4net([203, 0, 113, 0], 24),
  v4net([240, 0, 0, 0], 4), v4net([255, 255, 255, 255], 32),
];
const V4_EXCEPT: Net[] = [v4net([192, 0, 0, 9], 32), v4net([192, 0, 0, 10], 32)];
const V4_LOOP = v4net([127, 0, 0, 0], 8);
const V4_LINK = v4net([169, 254, 0, 0], 16);
const V4_CGNAT = v4net([100, 64, 0, 0], 10);
const V6_PRIVATE: Net[] = [
  v6net([0, 0, 0, 0, 0, 0, 0, 1], 128), v6net([], 128), v6net([0, 0, 0, 0, 0, 0xffff], 96),
  v6net([0x64, 0xff9b, 1], 48), v6net([0x100], 64), v6net([0x2001], 23), v6net([0x2001, 0xdb8], 32),
  v6net([0x2002], 16), v6net([0xfc00], 7), v6net([0xfe80], 10),
];
const V6_EXCEPT: Net[] = [
  v6net([0x2001, 1, 0, 0, 0, 0, 0, 1], 128), v6net([0x2001, 1, 0, 0, 0, 0, 0, 2], 128), v6net([0x2001, 3], 32),
  v6net([0x2001, 4, 0x112], 48), v6net([0x2001, 0x20], 28), v6net([0x2001, 0x30], 28),
];
const V6_LINK = v6net([0xfe80], 10);

function v4private(value: bigint): boolean {
  return V4_PRIVATE.some((net) => within(value, 32, net)) && !V4_EXCEPT.some((net) => within(value, 32, net));
}

export function ipPrivate(text: string): boolean {
  if (!/[0-9A-Fa-f]/.test(text)) return false;
  const v4 = octets(text);
  if (v4 !== undefined) {
    const value = BigInt(v4);
    if (within(value, 32, V4_LOOP) || value === 0n) return false;
    return v4private(value) || within(value, 32, V4_LINK) || within(value, 32, V4_CGNAT);
  }
  const v6 = hextets(text);
  if (v6 === undefined) return false;
  if (v6 === 1n || v6 === 0n) return false;
  const mapped = v6 >> 32n === 0xffffn ? v6 & 0xffffffffn : undefined;
  const isPrivate = mapped !== undefined
    ? v4private(mapped)
    : V6_PRIVATE.some((net) => within(v6, 128, net)) && !V6_EXCEPT.some((net) => within(v6, 128, net));
  return isPrivate || within(v6, 128, V6_LINK);
}
