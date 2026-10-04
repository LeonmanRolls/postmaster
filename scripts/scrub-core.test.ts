import { afterEach, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { KINDS, scan as scanPersonal } from "../raw/trials/pii-patterns/apparatus/patterns.ts";
import { keyBlockStep, RULES, scanLine, StreamScanner } from "./scrub-core.ts";
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
  expect(rules("ssh bluejay")).toContain("private-host");
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
  expect(rules(joined("ops@relay", ".", "internal"))).not.toContain("email");

  expect(rules("process.env.HOME")).toEqual([]);
  expect(rules('join(home, "note.txt")')).toEqual([]);
  expect(rules("const session_id = process.env.SESSION_ID")).toEqual([]);
  expect(rules("/home/user/trial/home/note.txt")).toEqual([]);
  expect(rules("ssh host")).toEqual([]);
  expect(rules("a tailnet name may end in `.ts.net`.")).toEqual([]);
});

test("JSON transcript values decode through nested strings, ANSI controls, truncation and UTF-16", async () => {
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
  const { streamLines } = await import("./scrub-core.ts");
  const scanner = new StreamScanner();
  const rows: string[] = [];
  for await (const line of streamLines(path))
    rows.push(...scanner.feed(line.number, line.text).findings.map((finding) => finding.rule));
  expect(rows).toContain("email");
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
