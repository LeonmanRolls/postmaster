import { afterEach, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { KINDS, scan as scanPersonal } from "../raw/trials/pii-patterns/apparatus/patterns.ts";
import { scan as scanPort } from "./scrub-patterns.ts";
import {
  keyBlockStep,
  lineUnits,
  needsFullScan,
  RefusedError,
  refuseUnlessText,
  RULES,
  scanLine,
  StreamScanner,
} from "./scrub-core.ts";
import {
  cleanupScratch,
  email,
  initRepo,
  marker,
  opaqueId,
  phone,
  privatePath,
  runScript,
  token,
} from "./scrub-test-kit.ts";

afterEach(cleanupScratch);

const rules = (line: string, options: { markers?: boolean; keyBlock?: boolean } = {}) =>
  (() => {
    const result = scanLine(line, options);
    return [
      ...result.findings.map((finding) => finding.rule),
      ...result.markers.map(() => "marker"),
    ];
  })();

const joined = (...parts: string[]) => parts.join("");

test("the personal patterns cover each kind, accented names and basic clean controls", () => {
  const examples = [
    ["person", joined("my name is ", "Élodie", " ", "Martin")],
    ["email", email()],
    ["phone", joined("phone ", phone())],
    ["postal-address", joined("48 Orchard ", "Lane, Northport, MA ", "01980")],
    ["other-personal", joined("ssn: ", "392", "-", "84", "-", "6137")],
  ] as const;
  const found = new Set(
    examples.flatMap(([, line]) => scanPersonal(line).map((finding) => finding.kind)),
  );
  expect([...found].sort()).toEqual([...KINDS].sort());
  expect(scanPersonal("The project reads process.env.HOME and a test user field.")).toEqual([]);
  expect(scanPersonal("There is no address or person value in this sentence.")).toEqual([]);
});

test("secret shapes include access tokens, bearer credentials, fields, dotenv values and key lines", () => {
  const longSecret = joined("abcde", "fghij", "klmno", "pqrst", "uvwxy", "z1234");
  const bearer = joined("Bearer ", "abcde", "fghij", "klmno", "pqrst", "uvwxy", "z1234");
  const aws = joined("AS", "IA", "ABCDEFGHIJKLMN12");
  const keyHeader = joined("-----BEGIN RSA PRIV", "ATE KEY-----");
  const body = joined("abcde", "fghij", "klmno", "pqrst", "uvwxy", "z1234");
  const accessTokens = [
    joined("gh", "o_", longSecret),
    joined("gh", "u_", longSecret),
    joined("github", "_pat_", longSecret),
    joined("sk", "_live_", longSecret),
    joined("sk", "_test_", longSecret),
    joined("sk", "-", longSecret),
    joined("xox", "b-", longSecret),
    joined("ya29", ".", longSecret),
    joined("AK", "IA", "ABCDEFGHIJKLMNOP"),
  ];
  const keyHeaders = [
    joined("-----BEGIN PGP PRIVATE KEY ", "BLOCK-----"),
    joined("PuTTY-User-Key-File-", "2: " + longSecret),
    joined("AGE-SECRET-KEY-", longSecret),
  ];
  expect(rules(token())).toContain("token");
  expect(rules(bearer)).toContain("token");
  expect(rules(aws)).toContain("token");
  expect(rules(joined('api_key: "', longSecret, '"'))).toContain("token");
  expect(rules(joined("SERVICE_TOKEN=", longSecret))).toContain("dotenv");
  expect(rules(keyHeader)).toContain("token");
  for (const value of accessTokens) expect(rules(value)).toContain("token");
  for (const value of keyHeaders) expect(rules(value)).toContain("token");
  expect(rules(body, { keyBlock: true })).toContain("token");

  expect(rules("const tokenValue = process.env.ACCESS_TOKEN")).toEqual([]);
  expect(rules("token: null")).toEqual([]);
  expect(rules("SERVICE_TOKEN=${SERVICE_TOKEN}")).not.toContain("dotenv");
  expect(rules("const accessToken = client.tokenValue")).not.toContain("token");
  expect(rules("token = config.readToken() ")).not.toContain("token");
});

test("dotenv spans cover the value, never the name or an earlier copy", () => {
  // Review round 8: the span came from indexOf, landing on the name when
  // the value repeated it, so the scrub redacted the name and kept the
  // secret.
  const dotenvSpan = (line: string): [number, number] | null => {
    const found = scanLine(line, {}).findings.find((finding) => finding.rule === "dotenv");
    return found ? [found.start, found.end] : null;
  };
  const name = joined("pass", "word");
  const line = `${name}=${name}`;
  expect(dotenvSpan(line)).toEqual([name.length + 1, line.length]);
  const namey = `${joined("db_", "pass", "word")}=${name}`;
  expect(dotenvSpan(namey)).toEqual([namey.indexOf("=") + 1, namey.length]);
  const exported = `${joined("export ", "pass", "word")}=${name}`;
  expect(dotenvSpan(exported)).toEqual([exported.indexOf("=") + 1, exported.length]);
  const quoted = `${joined("to", "ken")}="${joined("abc", "12345")}"`;
  expect(dotenvSpan(quoted)).toEqual([quoted.indexOf("=") + 2, quoted.length - 1]);
  expect(dotenvSpan(joined("notes", "=", name))).toBeNull();
  expect(dotenvSpan(joined("pass", "word_path", "=/", "x"))).toBeNull();
});

test("a dotenv assignment inside a multiline JSON string flags like the plain line", () => {
  // Review round 6: the decoded string stayed one multi-line unit, so the
  // anchored dotenv rule never saw its logical lines.
  const assignment = joined("DB_PASSWORD=", "Summer2024!");
  const line = JSON.stringify({ type: "tool_result", content: `PORT=3000\n${assignment}\n` });
  expect(rules(line)).toContain("dotenv");
  expect(rules(assignment)).toContain("dotenv");
});

test("a dotenv assignment inside an escape-free JSON string flags like the plain line", () => {
  // Review round 8: the unit gate required a backslash before a JSON string
  // became a unit, so an escape-free string was never scanned as one and the
  // anchored dotenv rule never saw it. Sibling of the round-6 multiline case.
  const assignment = joined("DB_PASSWORD=", "Summer2024!");
  expect(rules(JSON.stringify({ content: assignment }))).toContain("dotenv");
  expect(rules(JSON.stringify([assignment, "other"]))).toContain("dotenv");
  const pair = JSON.stringify({ a: assignment, b: assignment });
  expect(scanLine(pair).findings.filter((f) => f.rule === "dotenv")).toHaveLength(2);
  expect(rules(JSON.stringify({ content: "nothing here" }))).toEqual([]);
  const marked = `{"contact": "${email()}"} ${marker("email")}`;
  expect(rules(marked)).toEqual([]);
  const markedDotenv = `{"content": "${assignment}"} ${marker("dotenv")}`;
  expect(rules(markedDotenv)).toEqual([]);
});

test("escape-free JSON units stay proportional to the longest line", () => {
  // Review round 8: dropping the backslash gate tokenizes every quoted line.
  // The units of a one-megabyte line must stay linear in time and in text.
  const piece = JSON.stringify({ key: "safe value here" });
  const line = `${piece} `.repeat(Math.ceil((1024 * 1024) / (piece.length + 1)));
  const started = Date.now();
  const units = lineUnits(line);
  const elapsed = Date.now() - started;
  const total = units.reduce((n, unit) => n + unit.text.length, 0);
  expect(rules(line)).toEqual([]);
  expect(elapsed).toBeLessThan(1000);
  expect(total).toBeLessThan(line.length * 3);
});

test("private context finds concrete paths, machine names, network addresses, ids and tool credits", () => {
  const networkName = joined("relay", ".", "internal");
  const tailnet = joined("node", ".", "ts", ".", "net");
  const ipv4 = joined("10", ".", "42", ".", "5", ".", "6");
  const ipv6 = joined("fd12", ":", "3456", ":", "789a", "::1");
  const idLine = joined('{"account_id":"', opaqueId(), '"}');
  const orgIdLine = joined('organization_id: "', opaqueId(), '"');
  const sessionIdLine = joined('session_guid: "', opaqueId(), '"');
  const credit = joined("Co-Authored-", "By: OpenAI ", "Codex");
  const footer = joined("Generated ", "with Claude");

  expect(rules(privatePath())).toContain("private-path");
  expect(rules(joined("ss", "h bluejay"))).toContain("private-host");
  expect(rules(joined("sc", "p bluejay:/tmp/report ."))).toContain("private-host");
  expect(rules(joined("scp ops@", networkName, ":/tmp"))).toContain("private-host");
  expect(rules(joined('host: "', tailnet, '"'))).toContain("private-host");
  expect(rules(ipv4)).toContain("private-host");
  expect(rules(ipv6)).toContain("private-host");
  expect(rules(idLine)).toContain("account-id");
  expect(rules(orgIdLine)).toContain("account-id");
  expect(rules(sessionIdLine)).toContain("account-id");
  expect(rules(credit)).toContain("assistant-attribution");
  expect(rules(footer)).toContain("assistant-attribution");
  expect(rules(joined("ops@relay", ".", "internal"))).toContain("private-host");
  // Review round 15 (bug-95): this used to assert no email finding, but
  // dropping the email span leaked the mailbox local part downstream, so
  // both rules fire now.
  expect(rules(joined("ops@relay", ".", "internal"))).toContain("email");

  expect(rules("process.env.HOME")).toEqual([]);
  expect(rules('join(home, "note.txt")')).toEqual([]);
  expect(rules("const session_id = process.env.SESSION_ID")).toEqual([]);
  expect(rules("/home/user/trial/home/note.txt")).toEqual([]);
  expect(rules(joined("/home/", "some", "one/notes.txt"))).toEqual([]);
  expect(rules(joined("url: https://paper", "s.example/edu/~", "blue", "jay/paper.pdf"))).toEqual(
    [],
  );
  expect(rules(joined('{"thread_id":"', "123e4567-e89b-", "12d3-a456-426614174000", '"}'))).toEqual(
    [],
  );
  expect(rules("ssh host")).toEqual([]);
  expect(rules("a tailnet name may end in `.ts.net`.")).toEqual([]);
});

test("JSON transcript values decode through nested strings, ANSI controls and truncation", async () => {
  const nested = (depth: number): string => {
    let value = JSON.stringify({ content: email() });
    for (let i = 0; i < depth; i++) value = JSON.stringify(value);
    return value;
  };
  for (let depth = 1; depth <= 4; depth++) expect(rules(nested(depth))).toContain("email");
  const truncated = JSON.stringify({ content: email() }).slice(0, -2);
  expect(rules(JSON.stringify({ payload: truncated }))).toContain("email");
  const ansiHidden = joined("mail", "\u001b[31m", "box", "\u001b[0m", "@", "northstar.org");
  expect(rules(ansiHidden)).toContain("email");

  const { writeFileSync } = await import("node:fs");
  const { scratchDir } = await import("./scrub-test-kit.ts");
  const path = `${scratchDir()}/session.txt`;
  const units = [...email()].flatMap((ch) => {
    const code = ch.charCodeAt(0);
    return [code & 255, code >> 8];
  });
  writeFileSync(path, Uint8Array.from([0xff, 0xfe, ...units]));
  const { RefusedError: Refused, streamLines } = await import("./scrub-core.ts");
  let error: unknown = null;
  try {
    for await (const line of streamLines(path)) line.number;
  } catch (e) {
    error = e;
  }
  expect(error instanceof Refused).toBe(true);
  expect((error as Error).message).toBe(`refused ${path}: not UTF-8 text`);
});

test("markers suppress only their named value and faults are local to findings", () => {
  const marked = joined(email(), " ", marker("email"));
  const sameLine = scanLine(marked);
  expect(sameLine.findings).toEqual([]);
  expect(sameLine.suppressed.map((finding) => finding.rule)).toContain("email");

  const next = new StreamScanner();
  const nextMarker = joined("private-data", ":allow-next-line email -- synthetic fixture");
  expect(next.feed(1, nextMarker).findings).toEqual([]);
  const following = next.feed(2, email());
  expect(following.findings).toEqual([]);
  expect(following.suppressed.map((finding) => finding.rule)).toContain("email");

  expect(rules(marker("email"))).toContain("marker");
  expect(rules(joined(email(), " ", "private-data", ":allow email"))).toContain("marker");
  expect(rules(joined(email(), " ", marker("unknown-rule")))).toContain("marker");
  expect(rules(joined(email(), " ", marker("phone")))).toContain("marker");
  expect(rules(joined("ordinary text ", "private-data", ":allow"))).toEqual([]);
  expect(rules(joined(email(), " ", marker("email")), { markers: false })).toContain("email");
});

test("markers inside JSON escapes are inert", () => {
  const markerText = marker("email").replace(":", "\\u003a");
  const line = JSON.stringify(joined(email(), "\n", markerText));
  expect(rules(line)).toContain("email");
  expect(rules(line)).not.toContain("marker");
});

test("a quoted marker faults beside a finding instead of suppressing", () => {
  // Review round 10 (bug-51): a marker inside a string is an example, not a
  // directive. The inner string units accepted it, so a real finding beside
  // an example passed the gate unseen; now the finding flags and the marker
  // faults, while a clean example still passes silently.
  const line = joined('"call ', email(), ": ", marker("email"), '" for details');
  expect(rules(line)).toContain("email");
  expect(rules(line)).toContain("marker");
  const clean = joined('"see ', marker("email"), '" for the syntax');
  expect(rules(clean)).toEqual([]);
});

test("markers and guards inside escape sequences are not seen at all", () => {
  // Review round 6, closed input: escape sequences strip first, by one
  // treatment for markers and guards alike.
  const tok = token();
  const osc = joined(
    "\x1b]0;",
    "private-data",
    ":allow-next-line token -- synthetic fixture",
    "\x07",
  );
  const hidden = new StreamScanner();
  hidden.feed(1, osc);
  const leaked = hidden.feed(2, `leaked ${tok} here`);
  expect(leaked.findings.map((finding) => finding.rule)).toContain("token");
  expect(leaked.suppressed).toEqual([]);

  const shown = new StreamScanner();
  shown.feed(1, joined("private-data", ":allow-next-line token -- synthetic fixture"));
  const covered = shown.feed(2, `leaked ${tok} here`);
  expect(covered.findings).toEqual([]);
  expect(covered.suppressed.map((finding) => finding.rule)).toContain("token");

  const prefix = "\x1b[0m".repeat(8);
  const quoted = `${tok} "${tok} ${marker("token")}"`;
  expect(rules(prefix + quoted)).toContain("token");
  expect(rules(prefix + quoted)).toEqual(rules(quoted));
});

test("private-key block classification is line-oriented", () => {
  const header = joined("-----BEGIN RSA PRIV", "ATE KEY-----");
  const start = keyBlockStep(header, false);
  expect(start).toEqual({ inBlock: true, flagged: true });
  expect(
    keyBlockStep(joined("abcde", "fghij", "klmno", "pqrst", "uvwxy"), start.inBlock).flagged,
  ).toBe(true);
  expect(keyBlockStep("-----END RSA PRIVATE KEY-----", true)).toEqual({
    inBlock: false,
    flagged: true,
  });
});

test("C23 every rule has three positive and negative fixtures and its disable control", () => {
  const longSecret = joined("abcde", "fghij", "klmno", "pqrst", "uvwxy", "z1234");
  const person = () => joined("Élo", "die ", "Mar", "tin");
  const nameAddress = () => joined(person(), " <", email(), ">");
  const by = (label: string) => joined(label, person());
  const cardNumber = (parts: string[]) => parts.join(" ");
  const iban = (bank: string, digits: string) => {
    let remainder = 0;
    for (const character of joined(bank, digits, "GB00")) {
      const value = /[0-9]/u.test(character) ? character : String(character.charCodeAt(0) - 55);
      for (const digit of value) remainder = (remainder * 10 + Number(digit)) % 97;
    }
    return joined("GB", String(98 - remainder).padStart(2, "0"), bank, digits);
  };
  const ssn = (suffix: string) => joined("392-84-61", suffix);
  // ASCII: opaque ids are [A-Za-z0-9], so uppercasing is locale-free.
  const account = () => opaqueId().toUpperCase();
  const fixtures: Record<string, string[]> = {
    key: [
      joined('user_session: "room-', "1234", '"'),
      joined('email: "', email(), '"'),
      joined('session_context: "', longSecret, '"'),
    ],
    "account-id": [
      joined('{"account_id":"', opaqueId(), '"}'),
      joined('organization_id: "', opaqueId(), '"'),
      joined('session_guid: "', opaqueId(), '"'),
    ],
    email: [email(), email(), email()],
    "private-path": [
      privatePath(),
      joined("/Users/", "bluejay", "/note.txt"),
      joined("~", "bluejay", "/note.txt"),
    ],
    "private-host": [
      joined("ss", "h bluejay"),
      joined('host: "relay', ".internal", '"'),
      joined("10", ".", "42", ".", "5", ".", "6"),
    ],
    token: [token(), joined("Bearer ", longSecret), joined("AS", "IA", "ABCDEFGHIJKLMN12")],
    dotenv: [
      joined("SERVICE_TOKEN=", longSecret),
      joined("API_KEY=", longSecret),
      joined("DB_PASSWORD=", longSecret),
    ],
    "assistant-attribution": [
      joined("Co-Authored-", "By: OpenAI ", "Codex"),
      joined("Generated ", "with Claude"),
      joined("Written ", "by Copilot"),
    ],
    marker: [
      marker("email"),
      joined(email(), " ", marker("phone")),
      joined(email(), " ", ["private-data", ":allow email"].join("")),
    ],
    "sign-off": [by("Signed-off-by: "), by("Reviewed-by: "), by("Tested-by: ")],
    "author-field": [
      joined("author: ", person()),
      joined("owner_name: ", person()),
      joined("maintainer: ", person()),
    ],
    copyright: [
      joined("Copyright 2026 ", person()),
      joined("Copyright (c) 2024 ", person()),
      joined("Copyright by ", person()),
    ],
    "git-identity": [
      joined("user.name = ", person()),
      joined("GIT_AUTHOR_NAME=", person()),
      joined("GIT_COMMITTER_NAME=", person()),
    ],
    title: [joined("Dr. ", person()), joined("Mrs ", person()), joined("Prof. ", person())],
    "self-introduction": [
      joined("My name is ", person()),
      joined("I'm ", person()),
      joined("I am ", person()),
    ],
    relative: [
      joined("mother: ", person()),
      joined("sister: ", person()),
      joined("father: ", person()),
    ],
    credit: [
      joined("Thanks to ", person()),
      joined("contributed by ", person()),
      joined("cc ", person()),
    ],
    "name-and-address": [nameAddress(), nameAddress(), nameAddress()],
    phone: [joined("phone ", phone()), joined("mobile ", phone()), joined("text me at ", phone())],
    card: [
      joined("visa ", cardNumber(["4111", "1111", "1111", "1111"])),
      joined("mastercard ", cardNumber(["5555", "5555", "5555", "4444"])),
      joined("amex ", ["3782", "822463", "10005"].join("")),
    ],
    iban: [
      iban("NORT", "12345678901234"),
      iban("WIND", "56789012345678"),
      iban("STAR", "90123456789012"),
    ].map((value) => joined("IBAN ", value)),
    ssn: [
      joined("ssn: ", ssn("71")),
      joined("social security ", ssn("82")),
      joined("ssn: ", ssn("93")),
    ],
    "id-number": [
      joined("passport: AB", account()),
      joined("tax id: CD", account()),
      joined("driver's license: EF", account()),
    ],
    "date-of-birth": [
      joined("date of bi", "rth: 12 M", "ay ", "1982"),
      joined("DO", "B: ", "1983-06-", "11"),
      joined("bo", "rn: ", "19", "67"),
    ],
    health: [
      joined("I have been diagnosed wi", "th ", "asthma"),
      joined("She suffers fr", "om ", "cancer"),
      joined("My medica", "tion is ", "private"),
    ],
    income: [
      joined("salary: $", "12345"),
      joined("My income ", "is $", "54321"),
      joined("I earned $", "76543"),
    ],
    family: [joined("My daugh", "ter"), joined("My spo", "use"), joined("My child", "ren")],
    residence: [
      joined("I live in ", "Northport"),
      joined("We grew up in ", "Lakeside"),
      joined("My home is at ", "48"),
    ],
    employer: [
      joined("I work at ", "Northstar Labs"),
      joined("We worked for ", "Harbor Systems"),
      joined("My emplo", "yer is recorded"),
    ],
    street: [
      joined("48 ", "Orchard ", "Lane"),
      joined("12 ", "Rue de ", "Rivoli"),
      joined("5 ", "Via ", "Roma"),
    ],
    postcode: [
      joined("Northport, MA ", "01980"),
      joined("Lakeside AB1 ", "2DE"),
      joined("1-chome ", "100-00", "01"),
    ],
    "po-box": [joined("PO Box ", "1234"), joined("P.O. Box ", "5678"), joined("P O Box ", "9012")],
    "address-field": [
      joined('{"address":"Plot ', "88, Sector 3", '"}'),
      joined('address: "Block ', "17, Unit 4", '"'),
      joined('postal_address: "Lot ', "12, Zone 2", '"'),
    ],
  };
  const negatives = [
    "ordinary implementation detail",
    "no populated value is set",
    "the placeholder remains empty",
  ];
  const expectedRules = [...RULES].filter((rule) => rule !== "encrypted-reasoning").sort();
  expect(Object.keys(fixtures).sort()).toEqual(expectedRules);
  const repo = initRepo();
  const path = join(repo, "rule-fixtures.txt");
  const ruleLines: string[] = [];
  const activeLines: string[] = [];
  for (const rule of expectedRules) {
    const positives = fixtures[rule]!;
    expect(positives).toHaveLength(3);
    for (const [index, sample] of positives.entries()) {
      const got = rules(sample);
      if (!got.includes(rule)) console.log("fixture-miss", rule, index, got);
      expect(got).toContain(rule);
    }
    for (const sample of negatives) expect(rules(sample)).not.toContain(rule);
    activeLines.push(positives[0]!);
    ruleLines.push(`${rule}:${positives.length}:${negatives.length}`);
  }
  // One subprocess per mode, not per rule: dozens of spawns time out under load.
  writeFileSync(path, `${activeLines.join("\n")}\n`);
  const active = runScript("scrub-check", ["--files", path], repo);
  expect(active.status).toBe(1);
  const disabled = runScript("scrub-check", ["--files", path], repo, {
    SCRUB_CHECK_DISABLE: expectedRules.join(" "),
  });
  for (const rule of expectedRules) {
    expect(active.stdout.split("\n").some((line) => line.endsWith(`: ${rule}`))).toBe(true);
    expect(disabled.stdout.split("\n").some((line) => line.endsWith(`: ${rule}`))).toBe(false);
  }
  writeFileSync(path, `${negatives.join("\n")}\n`);
  const clean = runScript("scrub-check", ["--files", path], repo);
  expect(clean.status).toBe(0);
  expect(clean.stdout).toBe("");
  expect(ruleLines).toHaveLength(expectedRules.length);
  console.log(
    `C23 fixtures: ${expectedRules.length} rules, three positive and three negative cases each`,
  );
});

test("opaque ids need a digit in the body; host lookup passes flags and ports", () => {
  expect(rules(joined("org", "_abc", "123"))).toContain("account-id");
  expect(rules(joined("ses", "s_abcdef", " no digit here"))).not.toContain("account-id");
  expect(rules(joined("ssh -p 22", "22 alice@we", "b01 uptime"))).toContain("private-host");
});

test("prefilter triggers on every rule signal the audit found, skips digit log lines", () => {
  // Each firing line is built from inert fragments, so this file scans clean.
  const firing: Array<[string, string]> = [
    [joined("assigned to Alice ", "Quinn"), "credit"],
    [joined("my part", "ner Alice Quinn"), "relative"],
    [joined("my par", "ents"), "family"],
    [joined("my grand", "father was here"), "family"],
    [joined("she is in ther", "apy"), "health"],
    [joined("she is on antidepre", "ssants"), "health"],
    [joined("he is undergoing ch", "emo"), "health"],
    [joined("he is undergoing trea", "tment"), "health"],
    [joined("he is undergoing sur", "gery"), "health"],
    [joined("he is undergoing dia", "lysis"), "health"],
    [joined("we are living in ", "Paris"), "residence"],
    [joined("text ", "me 415 555 2671"), joined("ph", "one")],
    [joined("whats ", "app 415 555 2671"), joined("ph", "one")],
    [joined("license number AB12", "345"), "id-number"],
    [joined("AKIAIOSFODNN7EXA", "MPLE"), "token"],
    [joined("ASIAIOSFODNN7EXA", "MPLE"), "token"],
    [joined("4111 1111 111", "1 1111"), "card"],
  ];
  for (const [line, rule] of firing) {
    expect(needsFullScan(line)).toBe(true);
    expect(rules(line)).toContain(rule);
  }
  const clean = [
    `n12345 clean log line number 12345 with words to fill bytes ${"x".repeat(2400)}`,
    "the quick brown fox jumps over the lazy dog",
    "plain words here about nothing at all",
    "version 2 release 14 build 99 shipped tuesday",
  ];
  for (const line of clean) {
    expect(needsFullScan(line)).toBe(false);
    expect(rules(line)).toEqual([]);
  }
});

test("port matches the first version line for line, including gate-edge signals", () => {
  // The port's scan gate once dropped these; each is built from inert
  // fragments, so this file scans clean.
  const edges = [
    joined("he is undergoing trea", "tment"),
    joined("he is undergoing sur", "gery"),
    joined("he is undergoing ch", "emo"),
    joined("she is in ther", "apy"),
    joined("we are living in ", "Paris"),
    joined("text ", "me 415 555 2671"),
    joined("license number AB12", "345"),
    joined("4111 1111 111", "1 1111"),
    joined("assigned to Alice ", "Quinn"),
    joined("my part", "ner Alice Quinn"),
    joined("my par", "ents"),
    joined("my grand", "father was here"),
  ];
  const firstshot = (line: string) =>
    JSON.stringify(scanPersonal(line).map((f) => [f.rule, f.start, f.end]));
  const portshot = (line: string) =>
    JSON.stringify(scanPort(line).map((f) => [f.rule, f.start, f.end]));
  for (const line of edges) expect(portshot(line)).toBe(firstshot(line));
  const self = readFileSync(new URL(import.meta.url).pathname, "utf8").split("\n");
  const port = readFileSync(join(import.meta.dir, "scrub-patterns.ts"), "utf8").split("\n");
  const first = readFileSync(
    join(import.meta.dir, "..", "raw", "trials", "pii-patterns", "apparatus", "patterns.ts"),
    "utf8",
  ).split("\n");
  for (const line of [...self, ...port, ...first]) expect(portshot(line)).toBe(firstshot(line));
});

test("prefilter is lossless: identical findings with it on and off over a dense corpus", () => {
  const self = readFileSync(new URL(import.meta.url).pathname, "utf8").split("\n");
  const patterns = readFileSync(join(import.meta.dir, "scrub-patterns.ts"), "utf8").split("\n");
  const core = readFileSync(join(import.meta.dir, "scrub-core.ts"), "utf8").split("\n");
  const corpus = [...self, ...patterns, ...core];
  const saved = process.env.SCRUB_PREFILTER;
  try {
    process.env.SCRUB_PREFILTER = "0";
    const off = corpus.map((line) => JSON.stringify(scanLine(line)));
    delete process.env.SCRUB_PREFILTER;
    const on = corpus.map((line) => JSON.stringify(scanLine(line)));
    expect(on).toEqual(off);
  } finally {
    if (saved === undefined) delete process.env.SCRUB_PREFILTER;
    else process.env.SCRUB_PREFILTER = saved;
  }
});

test("closed input refuses anything but UTF-8 text loudly by name", () => {
  // Review round 6: nothing is decoded; a NUL or a surrogateescape marker
  // refuses the line's file and the check fails closed.
  expect(() => refuseUnlessText("plain line", "a.txt")).not.toThrow();
  for (const text of ["a\0b", "\0\0", "a\udcffb", "\udc80"]) {
    let error: unknown = null;
    try {
      refuseUnlessText(text, "a.txt");
    } catch (e) {
      error = e;
    }
    expect(error instanceof RefusedError).toBe(true);
    expect((error as Error).message).toBe("refused a.txt: not UTF-8 text");
  }
});

test("a pattern-code line exempts only the pattern, never trailing values", () => {
  // Review round 1: a trailing address after a regex declaration passed the gate.
  // The constructor shape is fragmented below: the text guard would read
  // that literal as code missing its u flag.
  const call = joined("scan(new Reg", 'Exp(P("email", "search"))) // ', email());
  expect(rules(`const EMAIL = /.+/; // ${email()}`)).toContain("email");
  expect(rules(call)).toContain("email");
  expect(rules("const EMAIL = /.+/;")).toEqual([]);
  expect(rules(`const EMAIL = /.+${email()}/;`)).toEqual([]);
});

test("a pattern-code line with a literal value scans instead of exempting", () => {
  // Review round 10 (bug-52): the exemption is for patterns. A span with no
  // regex operators is a literal value and must flag wherever it sits; the
  // round-1 operator shape above stays exempt.
  expect(rules(`const EMAIL = /${email()}/;`)).toContain("email");
  const call = joined("scan(new Reg", 'Exp(P("email", "search", "x", "", "', email(), '")))');
  expect(rules(call)).toContain("email");
});

test("successive bare key fields each flag key: no lastIndex leaks between lines", () => {
  // Review round 4: MAIL.test on the shared global regex left lastIndex dirty,
  // so the second of two bare key-kind fields passed unseen.
  expect(rules(`email: ${email()}`)).toContain("key");
  expect(rules(`mail: ${email()}`)).toContain("key");
  expect(rules(`email: ${email()}`)).toContain("key");
});

test("a markdown code span flags beside a template marker anywhere else", () => {
  // Review round 11 (bug-61): odd backticks before the path plus ${ anywhere
  // on the line skipped it, so appending ${x} published a spanned path. Only
  // a marker inside the same span reads as a template literal now.
  const spanned = joined("see `", privatePath(), "` and ", "${x}");
  expect(rules(spanned)).toContain("private-path");
  const opposite = joined("export X=", "${Y}", " and see `", privatePath(), "`");
  expect(rules(opposite)).toContain("private-path");
  const plain = joined("see `", privatePath(), "` alone");
  expect(rules(plain)).toContain("private-path");
  const literal = joined("const p = `/home/", "bluejay", "/${dir}/x`;");
  expect(rules(literal)).not.toContain("private-path");
  const unclosed = joined("take `", privatePath(), " with ", "${y}");
  expect(rules(unclosed)).not.toContain("private-path");
  const composed = joined("open ", "/home/", "bluejay", "$suffix", " now");
  expect(rules(composed)).not.toContain("private-path");
});

test("a code span flags a path beside a non-adjacent expansion, either order", () => {
  // Review round 14 (bug-82): a ${ anywhere later in the span used to
  // exempt the path, so a real path plus an unrelated expansion escaped.
  // Only an adjacent expansion exempts now, in both orders.
  const shell = joined("run `cat ", "/home/", "alice", "/notes.txt ", "${FILE}", "` now");
  expect(rules(shell)).toContain("private-path");
  const gap3 = joined("run `cat ", "/home/", "alice", "/x with ", "${FILE}", "` now");
  expect(rules(gap3)).toContain("private-path");
  const beforeGap = joined("run `echo ", "${OUT}", " ", "/home/", "alice", "/x` now");
  expect(rules(beforeGap)).toContain("private-path");
  const beforeFar = joined("run `echo ", "${OUT}", " and ", "/home/", "alice", "/x` now");
  expect(rules(beforeFar)).toContain("private-path");
  const afterTouching = joined("run `cat ", "/home/", "alice", "/x", "${Y}", "` now");
  expect(rules(afterTouching)).not.toContain("private-path");
  const beforeTouching = joined("run `echo ", "${d}", "/home/", "alice", "/x` now");
  expect(rules(beforeTouching)).not.toContain("private-path");
});

test("a private-domain email reports the whole address, not just its host", () => {
  // Review round 15 (bug-95): dropping the email span left the mailbox
  // local part in promoted copies, rescanning clean. Both rules fire now.
  const corp = joined("contact ", "alice", "@corp.", "internal", " for x");
  expect(rules(corp)).toContain("email");
  expect(rules(corp)).toContain("private-host");
  const ip = joined("contact ", "alice", "@", "10", ".", "0", ".", "0", ".", "2", " for x");
  expect(rules(ip)).toContain("email");
  expect(rules(ip)).toContain("private-host");
  const bracketed = joined(
    "contact ",
    "alice",
    "@[",
    "10",
    ".",
    "0",
    ".",
    "0",
    ".",
    "2",
    "] for x",
  );
  expect(rules(bracketed)).toContain("email");
  expect(rules(bracketed)).toContain("private-host");
  const pub = joined("contact ", "alice", "@northstar.", "org", " for x");
  expect(rules(pub)).toContain("email");
  expect(rules(pub)).not.toContain("private-host");
});

test("a quoted token value with operator characters still flags", () => {
  // Review round 15 (bug-101): inside quotes + / | & are data, not
  // operators; half of base64 secrets carry one. Unquoted expressions
  // and short values stay exempt as the negative controls.
  const secret = joined("q8Z+Jw3kT9vLm2Xp", "/Rb7NcYd5Hs0Ae4Gf1Ui6", "Ko=");
  expect(rules(joined('"client_secret": "', secret, '"'))).toContain("token");
  expect(rules(joined("client_secret: ", secret))).toContain("token");
  expect(rules(joined("const client_secret = ", '"', secret, '";'))).toContain("token");
  expect(rules(joined("api_key: ", secret))).toContain("token");
  expect(rules(joined('"token": "', "a+b", '"'))).toEqual([]);
  expect(rules(joined("password: ", "a+b"))).toEqual([]);
  expect(rules(joined('"secret": "', "not a secret at all yes sir", '"'))).toEqual([]);
  expect(rules(joined("token: ", "f(x)+g(y)+h(z)+k(w)+m"))).toEqual([]);
  expect(rules(joined("key: ", "a.b.c.d.e.f.g.h.i.j.k.l"))).toEqual([]);
});
