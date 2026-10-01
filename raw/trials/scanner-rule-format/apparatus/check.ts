// List every rule of #135's scanner that the proposed rule format cannot express.
//
//   bun check.ts <source> <rules.toml> [--lines <n>] [--seed <n>] [--without <id>/<field>]...
//
// <source> is what load.py reads: git:<ref>:<path> or file:<path>. The rule table and the
// scanner's own positive and negative fixtures come from it; <rules.toml> is the same table
// written in the proposed format (format.ts). A rule is listed when the table names it and
// the format file has no entry for it; when an entry is not valid in the format; when, on
// any fixture line or generated line, the entries for that rule find other spans than the
// table's own `findings` does; or when Node finds other spans than Bun. Generated lines come
// from a seeded generator over fragments, so a run is repeatable and nothing written here
// holds a value the table would find. --without drops a field from every entry of a rule:
// the mutation control, which must make that rule listed.
//
// Output names rules, fixtures, generated-line numbers and counts, never a line's text.
//
//   exit 0  no rule listed
//   exit 1  rules listed
//   exit 2  usage, or a step that could not run
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { find, validate, type Finding, type Rule } from "./format.ts";

const HERE = dirname(new URL(import.meta.url).pathname);

function die(message: string): never {
  console.error("check: " + message);
  process.exit(2);
}

function run(command: string[], input?: string): string {
  const result = spawnSync(command[0], command.slice(1), { input, encoding: "utf-8", maxBuffer: 1 << 30 });
  if (result.status !== 0) die(`${command[0]} failed: ${(result.stderr || "").trim().slice(0, 200)}`);
  return result.stdout;
}

// --- arguments
const args = process.argv.slice(2);
const positional: string[] = [];
let lineCount = 20000;
let seed = 135;
const without: [string, string][] = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--lines") lineCount = Number(args[++i]);
  else if (args[i] === "--seed") seed = Number(args[++i]);
  else if (args[i] === "--without") {
    const [id, field] = (args[++i] ?? "").split("/");
    if (!id || !field) die("--without takes <id>/<field>");
    without.push([id, field]);
  } else positional.push(args[i]);
}
if (positional.length !== 2 || !Number.isInteger(lineCount) || !Number.isInteger(seed)) {
  die("usage: check.ts <source> <rules.toml> [--lines <n>] [--seed <n>] [--without <id>/<field>]");
}
const [source, rulesFile] = positional;

// --- the table, from the branch
interface Fixture { polarity: string; rule: string; name: string; text: string; findings: [number, number, number, string][] }
interface Table { source: Record<string, string>; rules: string[]; usage: string; sets: Record<string, string[]>; fixtures: Fixture[] }
const table: Table = JSON.parse(run(["python3", join(HERE, "load.py"), source, "table"]));

// --- the same table in the proposed format
const parsed = Bun.TOML.parse(readFileSync(rulesFile, "utf-8")) as { rules?: Rule[] };
const entries: Rule[] = (parsed.rules ?? []).map((rule) => {
  const copy: Record<string, unknown> = { ...rule };
  for (const [id, field] of without) if (rule.id === id) delete copy[field];
  return copy as unknown as Rule;
});

// --- generated lines: fragments joined at random, with a recipe naming the parts
function prng(state: number): () => number {
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = prng(seed);
const pick = <T,>(items: T[]): T => items[Math.floor(random() * items.length)];
const int = (low: number, high: number): number => low + Math.floor(random() * (high - low + 1));
const run_ = (alphabet: string, low: number, high: number): string =>
  Array.from({ length: int(low, high) }, () => alphabet[Math.floor(random() * alphabet.length)]).join("");
const LOWER = "abcdefghijklmnopqrstuvwxyz";
const ALNUM = LOWER + LOWER.toUpperCase() + "0123456789";
const HEX = "0123456789abcdefABCDEF";
const AT = "@";
const sets = table.sets;
const keyNames = [
  "user" + "Email", "user" + "_email", "session" + "_context", "session" + "Context", "credential" + "_org",
  "account" + "Id", "account" + "_id", "user" + "Id", "organization" + "Uuid", "org" + "_id", "org" + "Id",
  "api" + "_key", "access" + "Token", "client" + "_secret", "pass" + "word", "sec" + "ret", "tok" + "en",
  "credential", "name", "id", "commit",
];
const atoms: Record<string, () => string> = {
  space: () => " ",
  spaces: () => "   ",
  tab: () => "\t",
  nbsp: () => "\u00a0",
  bom: () => "\ufeff",
  zwsp: () => "\u200b",
  accent: () => "\u00e9",
  han: () => "\u4e2d",
  emoji: () => "\u{1F642}",
  punct: () => pick([":", "=", ": ", " = ", ",", ";", "(", ")", "[", "]", "{", "}", "<", ">", "/", "\\", "|", "&", "$", "`", "-", "_", ".", "..", "!", "?", "~", "%", "+", "*"]),
  quote: () => pick(["\"", "'"]),
  hash: () => pick(["#", " #", " # ", "#x"]),
  word: () => pick(["the", "see", "user", "username", "account", "org", "orgs", "session", "thread", "identity", "export", "null", "None", "N/A", "...", "<redacted>", "true", "home", "local", "corp", "$USER", "${USER}"]),
  alnum: () => run_(ALNUM, 1, 40),
  digits: () => run_("0123456789", 1, 14),
  hexrun: () => run_(HEX, 4, 44),
  key: () => pick(keyNames),
  keyvalue: () => pick(keyNames) + pick(["", " ", "\""]) + pick([":", "=", ": ", " = "]) + pick(["", " "]) + pick(["\"", "'", ""]) + run_(ALNUM + "./+=-_", 1, 32) + pick(["\"", "'", "", ","]),
  dotenv: () => pick(["", "  ", "\t", "export ", "export  ", "EXPORT ", "\ufeff"]) + pick(["MY", "DB", "", "X_Y", "SESSION", "my-app"]) + pick(["_", "-", "", "__"]) + pick([...(sets.DOTENV_KEYLIKE ?? []), "name", "keyring", "Key"]).toUpperCase() + pick(["", ...(sets.DOTENV_POINTER ?? []), "_X", "-path"]).toUpperCase() + pick(["=", " = ", "=  ", " ="]) + pick(["", "", "\"", "'", "#", "# "]) + pick([run_(ALNUM + " #$.-_/", 0, 24), "........", "null", "N/A", run_(ALNUM, 6, 9), run_(ALNUM, 8, 8) + pick(["$", "`", "(", ";", "\\", "#", " #", "\"", "'"]) + run_(ALNUM, 0, 6)]) + pick(["", "\"", "'", " # note", "  #x", "\" # c", "' x", "\"\"", "   "]),
  email: () => run_(ALNUM + "._%+-", 1, 12) + AT + pick(["relay-413", "sub.relay-413", "users.nore" + "ply.github", "example", "x.test", "mail.lo" + "calhost", "invalid"]) + "." + pick(["net", "com", "org", "io", "invalid", "test", "x"]),
  noreply: () => pick(sets.NOREPLY_LOCAL ?? ["noreply"]) + AT + "relay-413.net",
  uuid: () => run_(HEX, 8, 8) + "-" + run_(HEX, 4, 4) + "-" + run_(HEX, 4, 4) + "-" + run_(HEX, 4, 4) + "-" + run_(HEX, 12, 12),
  opaque: () => pick(["org", "acct", "account", "sess", "ses", "session", "orgs"]) + pick(["-", "_"]) + run_(ALNUM, 3, 20),
  home: () => pick(["/ho" + "me/", "/Us" + "ers/", "/HO" + "ME/", "C:\\Us" + "ers\\", "/ro" + "ot/"]) + pick(["fixture-413", "user", "username", "a.", "x..", "...", "User", "$USER", "<user>"]) + pick(["", "/notes.txt", ".", "!", "/", "\"", " "]),
  tilde: () => "~" + pick(["fixture-413", "user", ".ssh", "1.0", "x"]) + pick(["/", "/docs", "/a.b.", "/x!?", ""]),
  scratch: () => "/tm" + "p/" + pick([...(sets.HARNESS_NAMES ?? []), "pip"]) + pick(["-413", "-413.", "/scratch/notes.md", "/x.", "", "/"]),
  ipv4: () => Array.from({ length: pick([3, 4, 4, 4, 5]) }, () => String(pick([10, 100, 127, 169, 172, 192, 198, 203, 0, 8, 64, 99, 128, 254, 255, 256, 300, int(0, 255)])) + (random() < 0.05 ? "0" : "")).join("."),
  ipv6: () => pick(["fe80", "fd00", "fc12", "2001:db8", "::ffff", "ff02", "2002", "64:ff9b:1", ""]) + pick(["::", ":0:", ":"]) + Array.from({ length: int(0, 6) }, () => run_(HEX, 0, 4)).join(":"),
  host: () => Array.from({ length: int(1, 3) }, () => run_(LOWER + "0123456789-", 1, 8)).join(".") + "." + pick(["local", "internal", "lan", "home", "tailnet", "intranet", "private", "corp", "ts" + ".net", "com", "localdomain"]),
  token: () => pick(sets.TOKEN_PREFIXES ?? ["sk-"]) + run_(ALNUM + "_./+-", 5, 40),
  xox: () => "xo" + "x" + pick(["b", "p", "a", "r", "s", "z"]) + "-" + run_(ALNUM + "-", 5, 20),
  akid: () => "AK" + pick(["IA", "IB"]) + run_("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", 14, 18),
  pem: () => "-----BEG" + "IN " + pick(["", "RSA ", "EC ", "OPENSSH ", "rsa "]) + "PRIVATE" + " KEY-----",
  bearer: () => pick(["Bearer", "bearer", "BEARER"]) + pick([" ", "  ", "\t"]) + run_(ALNUM + "._~+/-", 5, 40) + pick(["", "=", "=="]),
  trailer: () => pick(["", "  "]) + pick(["Co-Auth" + "ored-By:", "co-auth" + "ored-by:", "Co-Auth" + "ored-By"]) + pick(["", " "]) + pick(["", "Imaginary Aide", " x"]),
  generated: () => pick(["", " "]) + pick(["Generated", "Created", "Written", "Drafted", "generated"]) + pick([" ", "  "]) + pick(["with", "by"]) + " " + pick([...(sets.ASSISTANT_VENDORS ?? []), "Makefile", "Claudette"]),
  generatedWith: () => pick(["generated-with", "Generated-With", "generated-with "]) + pick([":", " :"]) + pick(["", " "]) + pick(["", "ImaginaryAide"]),
};
const atomNames = Object.keys(atoms);
const generated: { text: string; recipe: string[] }[] = [];
// About a third of the lines open with a shape some rules anchor to the line's start.
const openers = ["dotenv", "trailer", "generated", "generatedWith", "keyvalue", "spaces", "tab", "bom"];
for (let i = 0; i < lineCount; i++) {
  const recipe = random() < 0.35
    ? [pick(openers), ...Array.from({ length: int(0, 4) }, () => pick(atomNames))]
    : Array.from({ length: int(1, 7) }, () => pick(atomNames));
  generated.push({ text: recipe.map((name) => atoms[name]()).join(""), recipe });
}

// --- the table's findings on the generated lines
const tableOnGenerated: Finding[][] = run(
  ["python3", join(HERE, "load.py"), source, "findings"],
  generated.map((line) => JSON.stringify(line.text)).join("\n") + "\n",
).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
if (tableOnGenerated.length !== generated.length) die("the table returned findings for a different number of lines");

// --- every line, with the table's findings
interface Case { label: string; text: string; expected: Finding[] }
const cases: Case[] = [];
for (const fixture of table.fixtures) {
  fixture.text.split("\n").forEach((text, index) => {
    if (!text && index > 0) return;
    const expected = fixture.findings.filter((f) => f[0] === index + 1).map((f) => [f[1], f[2], f[3]] as Finding);
    cases.push({ label: `fixture ${fixture.name} line ${index + 1}`, text, expected });
  });
}
generated.forEach((line, index) => cases.push({
  label: `generated #${index} (${line.recipe.join(" ")})`, text: line.text, expected: tableOnGenerated[index],
}));

// --- the format's findings, under Bun and under Node
const valid = entries.filter((rule) => validate(rule).length === 0);
const bunFound = cases.map((c) => find(valid, c.text));
const nodeOut = run(["node", join(HERE, "node-run.ts")], JSON.stringify({ rules: valid, lines: cases.map((c) => c.text) }));
const nodeFound: Finding[][] = JSON.parse(nodeOut);

// --- compare, rule by rule
const key = (f: Finding) => f.join(":");
const ruleIds = [...new Set([...table.rules, ...entries.map((rule) => rule.id)])].sort();
const listed: string[] = [];
console.log(`source: ${table.source.kind} ${table.source.ref ?? ""} ${table.source.commit ?? table.source.path}`.replace(/\s+/g, " "));
console.log(`rules in the table: ${table.rules.length}; entries in the format file: ${entries.length}`);
console.log(`lines compared: ${cases.length} (${table.fixtures.length} fixtures, ${generated.length} generated, seed ${seed})`);
for (const [id, field] of without) console.log(`mutation: ${field} dropped from every ${id} entry`);
for (const id of ruleIds) {
  const reasons: string[] = [];
  const mine = entries.filter((rule) => rule.id === id);
  if (!table.rules.includes(id)) reasons.push("not a rule of the table");
  if (mine.length === 0) reasons.push("no entry in the format file");
  mine.forEach((rule) => {
    for (const fault of validate(rule)) reasons.push(`entry ${rule.description ?? id}: ${fault}`);
  });
  for (const rule of mine) {
    if (validate(rule).length) continue;
    const fires = cases.filter((c) => find([rule], c.text).length > 0).length;
    console.log(`    entry ${rule.description ?? id} finds something on ${fires} line(s)`);
  }
  let disagree = 0, runtime = 0, tableCount = 0;
  let first = "", firstRuntime = "";
  cases.forEach((c, index) => {
    const want = c.expected.filter((f) => f[2] === id).map(key).sort().join(" ");
    const got = bunFound[index].filter((f) => f[2] === id).map(key).sort().join(" ");
    const node = nodeFound[index].filter((f) => f[2] === id).map(key).sort().join(" ");
    if (want) tableCount++;
    if (want !== got) {
      disagree++;
      if (!first) first = `${c.label}: table ${want ? want.split(" ").length : 0} span(s), format ${got ? got.split(" ").length : 0}`;
    }
    if (got !== node) {
      runtime++;
      if (!firstRuntime) firstRuntime = c.label;
    }
  });
  if (mine.length > 0 && disagree > 0) reasons.push(`disagrees with the table on ${disagree} line(s); first: ${first}`);
  if (runtime > 0) reasons.push(`Node and Bun disagree on ${runtime} line(s); first: ${firstRuntime}`);
  const status = reasons.length ? "NOT EXPRESSED" : "expressed";
  console.log(`${status}  ${id}  (${mine.length} entr${mine.length === 1 ? "y" : "ies"}; the table finds it on ${tableCount} line(s))`);
  for (const reason of reasons) console.log(`    ${reason}`);
  if (reasons.length) listed.push(id);
}
console.log(listed.length ? `listed: ${listed.join(", ")}` : "listed: none");
process.exit(listed.length ? 1 : 0);
