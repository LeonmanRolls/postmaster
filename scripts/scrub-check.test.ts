import { afterEach, expect, test } from "bun:test";
import { accessSync, constants, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { spawnSync } from "node:child_process";
import { cleanupScratch, commit, email, initRepo, opaqueId, phone, privatePath, ROOT, runScript, scratchDir, token } from "./scrub-test-kit.ts";

afterEach(cleanupScratch);

function direct(script: string, args: string[], cwd: string, env: Record<string, string> = {}) {
  return spawnSync(process.execPath, ["--no-env-file", `--config=${join(ROOT, "bunfig.toml")}`, join(ROOT, "scripts", `${script}.ts`), ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

function executable(name: string): string {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    const path = join(dir, name);
    try { accessSync(path, constants.X_OK); return path; }
    catch { /* keep looking */ }
  }
  throw new Error("required executable was not found");
}

test("C1 wrappers match host.sh and a direct Bun range scan needs only Bun, git and a shell", () => {
  const scripts = ["scrub-check", "tree-check", "raw-promote", "scrub-rewrite", "verify-merge"];
  const host = readFileSync(join(ROOT, "scripts", "host.sh"), "utf8");
  for (const name of scripts) {
    expect(readFileSync(join(ROOT, "scripts", `${name}.sh`), "utf8")).toBe(host.replaceAll("host.ts", `${name}.ts`));
  }
  const grep = spawnSync("grep", ["-i", "-l", "python", ...scripts.flatMap((name) => [join(ROOT, "scripts", `${name}.ts`), join(ROOT, "scripts", `${name}.sh`)])], { encoding: "utf8" });
  expect(grep.status).toBe(1);
  expect(grep.stdout.trim()).toBe("");

  const repo = initRepo();
  const base = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).stdout.trim();
  writeFileSync(join(repo, "notes.txt"), email());
  const head = commit(repo, "add note");
  const bin = join(scratchDir(), "bin");
  mkdirSync(bin);
  symlinkSync(process.execPath, join(bin, "bun"));
  symlinkSync(executable("git"), join(bin, "git"));
  symlinkSync(executable("sh"), join(bin, "sh"));
  const result = direct("scrub-check", [base, head], repo, { PATH: bin });
  expect(result.status).toBe(1);
  expect(result.stdout.trim().split("\n").at(-1)?.endsWith(":notes.txt:1: email")).toBe(true);
});

test("C2 range scan sees added then deleted lines, file names, messages, identities and merge resolutions", () => {
  const repo = initRepo();
  const base = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).stdout.trim();
  const added = email();
  writeFileSync(join(repo, "notes.txt"), added);
  const first = commit(repo, "add temporary note");
  writeFileSync(join(repo, "notes.txt"), "clean\n");
  commit(repo, "remove temporary note");
  const deleted = runScript("scrub-check", [base, "HEAD"], repo);
  expect(deleted.status).toBe(1);
  expect(deleted.stdout.trim()).toBe(`${first}:notes.txt:1: email`);
  expect(!deleted.stdout.includes(added)).toBe(true);

  const namedRepo = initRepo();
  const namedBase = spawnSync("git", ["rev-parse", "HEAD"], { cwd: namedRepo, encoding: "utf8" }).stdout.trim();
  const filename = `empty-${email()}`;
  writeFileSync(join(namedRepo, filename), "");
  commit(namedRepo, "add empty file");
  const named = runScript("scrub-check", [namedBase, "HEAD"], namedRepo);
  expect(named.status).toBe(1);
  expect(named.stdout.trim()).toMatch(/:0: email$/u);
  expect(!named.stdout.includes(email())).toBe(true);

  const messageRepo = initRepo();
  const messageBase = spawnSync("git", ["rev-parse", "HEAD"], { cwd: messageRepo, encoding: "utf8" }).stdout.trim();
  const message = `note ${email()}`;
  const messageCommit = commit(messageRepo, message);
  const messageScan = runScript("scrub-check", [messageBase, "HEAD"], messageRepo);
  expect(messageScan.status).toBe(1);
  expect(messageScan.stdout.trim()).toBe(`${messageCommit}:(message):1: email`);
  expect(!messageScan.stdout.includes(email())).toBe(true);

  for (const key of ["GIT_AUTHOR_EMAIL", "GIT_COMMITTER_EMAIL"]) {
    const identityRepo = initRepo();
    const identityBase = spawnSync("git", ["rev-parse", "HEAD"], { cwd: identityRepo, encoding: "utf8" }).stdout.trim();
    const identityCommit = commit(identityRepo, "identity fixture", { [key]: email() });
    const identityScan = runScript("scrub-check", [identityBase, "HEAD"], identityRepo);
    expect(identityScan.status).toBe(1);
    expect(identityScan.stdout.trim()).toBe(`${identityCommit}:(${key === "GIT_AUTHOR_EMAIL" ? "author" : "committer"}):1: email`);
    expect(!identityScan.stdout.includes(email())).toBe(true);
  }

  const mergeRepo = initRepo();
  const mergeBase = spawnSync("git", ["rev-parse", "HEAD"], { cwd: mergeRepo, encoding: "utf8" }).stdout.trim();
  spawnSync("git", ["switch", "-q", "-c", "side"], { cwd: mergeRepo });
  writeFileSync(join(mergeRepo, "merge.txt"), "side\n");
  commit(mergeRepo, "side change");
  const side = spawnSync("git", ["rev-parse", "HEAD"], { cwd: mergeRepo, encoding: "utf8" }).stdout.trim();
  spawnSync("git", ["switch", "-q", "main"], { cwd: mergeRepo });
  writeFileSync(join(mergeRepo, "merge.txt"), "main\n");
  commit(mergeRepo, "main change");
  spawnSync("git", ["merge", "--no-commit", side], { cwd: mergeRepo, encoding: "utf8", stdio: "ignore" });
  writeFileSync(join(mergeRepo, "merge.txt"), `phone ${phone()}\n`);
  const mergeCommit = commit(mergeRepo, "resolve merge");
  const mergeScan = runScript("scrub-check", [mergeBase, "HEAD"], mergeRepo);
  expect(mergeScan.status).toBe(1);
  expect(mergeScan.stdout.trim().split("\n").some((line) => line.startsWith(`${mergeCommit}:merge.txt:1: phone`))).toBe(true);
});

test("C3 --files decodes nested and cut-off JSON transcript values", () => {
  const repo = initRepo();
  const path = join(repo, "session.jsonl");
  const nested = JSON.stringify(JSON.stringify({ content: email() }));
  const truncated = JSON.stringify({ payload: JSON.stringify({ content: email() }) }).slice(0, -2);
  writeFileSync(path, `${nested}\n${truncated}\n`);
  const result = runScript("scrub-check", ["--files", path], repo);
  expect(result.status).toBe(1);
  expect(result.stdout.trim().split("\n")).toEqual(["[redacted]:1: email", "[redacted]:2: email"]);
  expect(!result.stdout.includes(email())).toBe(true);
});

test("C3 --files decodes ANSI, JSON depths one through four and the depth limit, truncation and UTF-16", () => {
  const repo = initRepo();
  const path = join(repo, "transcript.jsonl");
  const value = email();
  const nested = (depth: number): string => {
    let result = JSON.stringify({ content: value });
    for (let level = 1; level < depth; level++) result = JSON.stringify(result);
    return result;
  };
  let atLimit = JSON.stringify({ content: value }).replace(value, value.replace("@", "\\u0040"));
  for (let level = 0; level < 64; level++) atLimit = `{"node":${atLimit}}`;
  const ansi = JSON.stringify({ content: value.replace("@", `@\u001b[31m`) });
  const truncated = JSON.stringify({ content: value }).slice(0, -2);
  writeFileSync(path, `${[1, 2, 3, 4].map(nested).join("\n")}\n${atLimit}\n${ansi}\n${truncated}\n`);
  const utf16 = join(repo, "transcript-utf16.jsonl");
  writeFileSync(utf16, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(value, "utf16le")]));
  const result = runScript("scrub-check", ["--files", path, utf16], repo);
  expect(result.status).toBe(1);
  expect(result.stdout.trim().split("\n")).toHaveLength(8);
  expect(result.stdout.split("\n").filter((line) => line.endsWith(": email"))).toHaveLength(8);
  expect(result.stdout).not.toContain(value);
  expect(result.stderr).toBe("");
});

test("C4 --files and range scans find private-key body lines, even when changed alone", () => {
  const repo = initRepo();
  const path = join(repo, "key.txt");
  const body = ["abcde", "fghij", "klmno", "pqrst", "uvwxy", "z1234"].join("");
  writeFileSync(path, `${body}\n`);
  const fileScan = runScript("scrub-check", ["--files", path], repo);
  expect(fileScan.status).toBe(1);
  expect(fileScan.stdout.trim()).toBe("[redacted]:1: token");

  const base = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).stdout.trim();
  writeFileSync(path, ["---", "--B", "EGI", "N R", "SA ", "PRI", "VAT", "E K", "EY-", "---", "-\n\n", "---", "--E", "ND ", "RSA", " PR", "IVA", "TE ", "KEY", "---", "--\n"].join(""));
  commit(repo, "add key header");
  const headerCommit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).stdout.trim();
  writeFileSync(path, `-----BEGIN RSA ${["PRIVATE", " KEY"].join("")}-----\n${body}\n-----END RSA ${["PRIVATE", " KEY"].join("")}-----\n`);
  const bodyCommit = commit(repo, "add key body");
  const range = runScript("scrub-check", [headerCommit, bodyCommit], repo);
  expect(range.status).toBe(1);
  expect(range.stdout.trim().split("\n").some((line) => line.endsWith(":2: token"))).toBe(true);

  const values = [
    token(),
    ["Bearer ", body].join(""),
    ["gh", "o_", body].join(""),
    ["github", "_pat_", body].join(""),
    ["sk", "-", body].join(""),
    ["ya29", ".", body].join(""),
    ["AS", "IA", "ABCDEFGHIJKLMN12"].join(""),
    ["AK", "IA", "ABCDEFGHIJKLMNOP"].join(""),
    ["SERVICE_TOKEN=", body].join(""),
    ["-----BEGIN RSA PRIV", "ATE KEY-----"].join(""),
    body,
    ["PuTTY-User-Key-File-", "2: ", body].join(""),
  ];
  const allShapes = join(repo, "secret-shapes.txt");
  writeFileSync(allShapes, `${values.join("\n")}\n`);
  const shapes = runScript("scrub-check", ["--files", allShapes], repo);
  expect(shapes.status).toBe(1);
  const lines = new Set(shapes.stdout.split("\n").flatMap((line) => {
    const match = /^\[redacted\]:(\d+): (?:token|dotenv)$/u.exec(line);
    return match ? [Number(match[1])] : [];
  }));
  expect(lines.size).toBe(values.length);
  expect(!shapes.stdout.includes(body)).toBe(true);
  expect(!shapes.stderr.includes(body)).toBe(true);
});

test("C10 outputs redact values in names and never pass parser or file errors through", () => {
  const repo = initRepo();
  const path = join(repo, `bad-${email()}.jsonl`);
  writeFileSync(path, `{"content":"${email()}"\n`);
  const file = runScript("scrub-check", ["--files", path], repo);
  expect(file.status).toBe(1);
  expect(!file.stdout.includes(email())).toBe(true);
  expect(!file.stderr.includes(email())).toBe(true);
  expect(file.stdout.includes("[redacted]")).toBe(true);

  const missing = runScript("scrub-check", ["--files", `${path}.missing`], repo);
  expect(missing.status).toBe(2);
  expect(!missing.stdout.includes(email()) && !missing.stderr.includes(email())).toBe(true);
});

test("C14 and C16 marked file values pass, while marked messages and post text remain findings", () => {
  const repo = initRepo();
  const path = join(repo, "notes.txt");
  const same = `${email()} ${["private-data", ":allow email -- synthetic fixture"].join("")}\n`;
  const next = `${["private-data", ":allow-next-line email -- synthetic fixture"].join("")}\n${email()}\n`;
  writeFileSync(path, `${same}${next}`);
  const file = runScript("scrub-check", ["--files", path], repo);
  expect(file.status).toBe(0);
  const markedMessage = commit(repo, `message ${email()} ${["private-data", ":allow email -- synthetic fixture"].join("")}`);
  const messages = runScript("scrub-check", ["HEAD~1", markedMessage], repo);
  expect(messages.status).toBe(1);
  expect(messages.stdout).toContain("(message):1: email");
  expect(!messages.stdout.includes(email())).toBe(true);

  const prPath = join(repo, "pr.txt");
  writeFileSync(prPath, `comment ${email()} ${["private-data", ":allow email -- synthetic fixture"].join("")}`);
  const pr = runScript("scrub-check", ["--pr-description", prPath], repo);
  expect(pr.status).toBe(1);
  expect(pr.stdout.trim()).toBe("(pr-description):1: email");
  expect(!pr.stdout.includes(email())).toBe(true);

  const commentPath = join(repo, "ticket-comment.txt");
  writeFileSync(commentPath, `ticket comment ${email()} ${["private-data", ":allow email -- synthetic fixture"].join("")}\n`);
  const comment = runScript("scrub-check", ["--pr-description", commentPath], repo);
  expect(comment.status).toBe(1);
  expect(comment.stdout.trim()).toBe("(pr-description):1: email");
  expect(!comment.stdout.includes(email())).toBe(true);
});

test("C29 pull-request descriptions and ticket comments log each post-text finding", () => {
  const repo = initRepo();
  const log = join(repo, "detections.jsonl");
  const drafts = [join(repo, "pr-description.txt"), join(repo, "ticket-comment.txt")];
  for (const path of drafts) {
    writeFileSync(path, `draft ${email()}\n`);
    const result = runScript("scrub-check", ["--pr-description", path], repo, { POSTMASTER_DETECTIONS_LOG: log });
    expect(result.status).toBe(1);
    expect(result.stdout.trim()).toBe("(pr-description):1: email");
    expect(result.stdout + result.stderr).not.toContain(email());
  }
  const rows = readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
  expect(rows).toHaveLength(2);
  expect(rows.every((row) => row.rule === "email" && row.file === "(pr-description)" && row.line === 1)).toBe(true);
  expect(rows.every((row) => !JSON.stringify(row).includes(email()))).toBe(true);
});

test("C15 stale and malformed markers fault only beside findings", () => {
  const repo = initRepo();
  const path = join(repo, "marker-cases.txt");
  const validUnused = ["private-data", ":allow email -- synthetic fixture"].join("");
  const reasonless = ["private-data", ":allow email -- "].join("");
  const malformed = ["private-data", ":allow"].join("");
  writeFileSync(path, `${validUnused}\n${email()} ${reasonless}\n${malformed}\n`);
  const result = runScript("scrub-check", ["--files", path], repo);
  expect(result.status).toBe(1);
  const rows = result.stdout.trim().split("\n");
  expect(rows).toContain("[redacted]:1: marker");
  expect(rows).toContain("[redacted]:2: marker");
  expect(rows).not.toContain("[redacted]:3: marker");
  expect(!result.stdout.includes(email())).toBe(true);
});

test("C23 disabling a named rule flips its ordinary positive control", () => {
  const repo = initRepo();
  const path = join(repo, "notes.txt");
  writeFileSync(path, email());
  const active = runScript("scrub-check", ["--files", path], repo);
  expect(active.status).toBe(1);
  const disabled = runScript("scrub-check", ["--files", path], repo, { SCRUB_CHECK_DISABLE: "email" });
  expect(disabled.status).toBe(0);
  expect(disabled.stdout.trim()).toBe("");
  expect(token().length).toBeGreaterThan(20);
});

test("C23 rule, message, merge and marker disable controls flip their scratch histories", () => {
  const deletedRepo = initRepo();
  const deletedBase = spawnSync("git", ["rev-parse", "HEAD"], { cwd: deletedRepo, encoding: "utf8" }).stdout.trim();
  writeFileSync(join(deletedRepo, "notes.txt"), email());
  commit(deletedRepo, "add note");
  writeFileSync(join(deletedRepo, "notes.txt"), "clean\n");
  commit(deletedRepo, "remove note");
  expect(runScript("scrub-check", [deletedBase, "HEAD"], deletedRepo).status).toBe(1);
  expect(runScript("scrub-check", [deletedBase, "HEAD"], deletedRepo, { SCRUB_CHECK_DISABLE: "email" }).status).toBe(0);

  const messageRepo = initRepo();
  const messageBase = spawnSync("git", ["rev-parse", "HEAD"], { cwd: messageRepo, encoding: "utf8" }).stdout.trim();
  commit(messageRepo, `message ${email()}`);
  expect(runScript("scrub-check", [messageBase, "HEAD"], messageRepo).status).toBe(1);
  expect(runScript("scrub-check", [messageBase, "HEAD"], messageRepo, { SCRUB_CHECK_DISABLE: "messages" }).status).toBe(0);

  const mergeRepo = initRepo();
  const mergeBase = spawnSync("git", ["rev-parse", "HEAD"], { cwd: mergeRepo, encoding: "utf8" }).stdout.trim();
  spawnSync("git", ["switch", "-q", "-c", "side"], { cwd: mergeRepo });
  writeFileSync(join(mergeRepo, "merge.txt"), "side\n");
  commit(mergeRepo, "side change");
  const side = spawnSync("git", ["rev-parse", "HEAD"], { cwd: mergeRepo, encoding: "utf8" }).stdout.trim();
  spawnSync("git", ["switch", "-q", "main"], { cwd: mergeRepo });
  writeFileSync(join(mergeRepo, "merge.txt"), "main\n");
  commit(mergeRepo, "main change");
  spawnSync("git", ["merge", "--no-commit", side], { cwd: mergeRepo, stdio: "ignore" });
  writeFileSync(join(mergeRepo, "merge.txt"), `phone ${phone()}\n`);
  commit(mergeRepo, "resolve merge");
  expect(runScript("scrub-check", [mergeBase, "HEAD"], mergeRepo).status).toBe(1);
  expect(runScript("scrub-check", [mergeBase, "HEAD"], mergeRepo, { SCRUB_CHECK_DISABLE: "merges" }).status).toBe(0);

  const markerRepo = initRepo();
  const path = join(markerRepo, "marked.txt");
  writeFileSync(path, `${email()} ${["private-data", ":allow email -- synthetic fixture"].join("")}\n`);
  expect(runScript("scrub-check", ["--files", path], markerRepo).status).toBe(0);
  const markerDisabled = runScript("scrub-check", ["--files", path], markerRepo, { SCRUB_CHECK_DISABLE: "markers" });
  expect(markerDisabled.status).toBe(1);
  expect(markerDisabled.stdout.trim()).toBe("[redacted]:1: email");

  writeFileSync(path, `${email()} ${["private-data", ":allow email --"].join("")}\n`);
  expect(runScript("scrub-check", ["--files", path], markerRepo).status).toBe(1);
  expect(runScript("scrub-check", ["--files", path], markerRepo, { SCRUB_CHECK_DISABLE: "email" }).status).toBe(0);

  writeFileSync(path, `${["private-data", ":allow email -- synthetic fixture"].join("")}\n`);
  expect(runScript("scrub-check", ["--files", path], markerRepo).status).toBe(1);
  expect(runScript("scrub-check", ["--files", path], markerRepo, { SCRUB_CHECK_DISABLE: "marker" }).status).toBe(0);
});

test("C5 patterns stay offline and find personal data from fragments", () => {
  const repo = initRepo();
  const path = join(repo, "personal.txt");
  const rows = [
    ["my name is ", "Élodie", " ", "Martin"].join(""),
    email(),
    ["phone ", phone()].join(""),
    ["48 ", "Orchard", " Lane, ", "Northport", ", MA ", "01980"].join(""),
    ["ssn: ", "392", "-", "84", "-", "6137"].join(""),
  ];
  writeFileSync(path, `${rows.join("\n")}\n`);
  const bin = join(scratchDir(), "offline-bin");
  mkdirSync(bin);
  symlinkSync(process.execPath, join(bin, "bun"));
  symlinkSync(executable("sh"), join(bin, "sh"));
  const result = direct("scrub-check", ["--files", path], repo, { PATH: bin, HTTP_PROXY: "http://127.0.0.1:1", HTTPS_PROXY: "http://127.0.0.1:1" });
  expect(result.status).toBe(1);
  const found = new Set(result.stdout.split("\n").map((line) => line.split(": ").at(-1)).filter(Boolean));
  for (const rule of ["self-introduction", "email", "phone", "street", "ssn"]) expect(found.has(rule)).toBe(true);
  expect(!result.stdout.includes(email())).toBe(true);
  expect(!result.stderr.includes(email())).toBe(true);
});

test("C7 --files finds private context while code and placeholders pass", () => {
  const repo = initRepo();
  const path = join(repo, "private-context.txt");
  const networkName = ["relay", ".", "internal"].join("");
  const tailnet = ["node", ".ts", ".net"].join("");
  const ipv4 = ["10", ".", "42", ".", "5", ".", "6"].join("");
  const ipv6 = ["fd12", ":", "3456", ":", "789a", "::1"].join("");
  const credit = ["Co-Authored-", "By: OpenAI ", "Codex"].join("");
  const footer = ["Generated ", "with Claude"].join("");
  const positive = [
    privatePath(),
    "ssh bluejay",
    ["scp", " bl", "uej", "ay:", "/tm", "p/r", "epo", "rt ", "."].join(""),
    `ops@${networkName}:/tmp`,
    `host: "${tailnet}"`,
    ipv4,
    ipv6,
    `account_id: "${opaqueId()}"`,
    `organization_id: "${opaqueId()}"`,
    `session_guid: "${opaqueId()}"`,
    credit,
    footer,
  ];
  writeFileSync(path, `${positive.join("\n")}\n`);
  const found = runScript("scrub-check", ["--files", path], repo);
  expect(found.status).toBe(1);
  const rows = found.stdout.trim().split("\n");
  const rules = new Set(rows.map((row) => row.split(": ").at(-1)));
  for (const rule of ["private-path", "private-host", "account-id", "assistant-attribution"]) expect(rules.has(rule)).toBe(true);
  expect(rows.every((row) => !row.endsWith(": email"))).toBe(true);
  expect(!found.stdout.includes(credit) && !found.stdout.includes(footer)).toBe(true);
  expect(!found.stderr.includes(credit) && !found.stderr.includes(footer)).toBe(true);

  const clean = join(repo, "code-only.txt");
  writeFileSync(clean, [
    "process.env.HOME",
    'join(home, "note.txt")',
    "const session_id = process.env.SESSION_ID",
    "/home/user/trial/home/note.txt",
    "ssh host",
    'const host = "<placeholder>"',
  ].join("\n") + "\n");
  const passed = runScript("scrub-check", ["--files", clean], repo);
  expect(passed.status).toBe(0);
  expect(passed.stdout).toBe("");
  expect(passed.stderr).toBe("");
});

test("C6 held-out personal-data results meet both recorded thresholds", () => {
  const personalRules = new Set([
    "sign-off", "author-field", "copyright", "git-identity", "title", "self-introduction", "relative", "credit",
    "name-and-address", "email", "phone", "card", "iban", "ssn", "id-number", "date-of-birth", "health", "income", "family", "residence", "employer",
    "street", "postcode", "po-box", "address-field",
  ]);
  const sets = [
    { path: "raw/trials/pii-patterns/results/heldout/lines.json", foundFloor: 33, raisedCeiling: 3 },
    { path: "raw/trials/pii-patterns/results/heldout2/lines.json", foundFloor: 25, raisedCeiling: 4 },
  ];
  for (const set of sets) {
    const source = JSON.parse(readFileSync(join(ROOT, set.path), "utf8")) as Array<{ parts: string[]; label: string }>;
    const input = join(scratchDir(), "heldout.txt");
    writeFileSync(input, `${source.map((row) => row.parts.join("")).join("\n")}\n`);
    const scanned = runScript("scrub-check", ["--files", input], ROOT);
    const lines = new Set(scanned.stdout.split("\n").flatMap((line) => {
      const match = /^\[redacted\]:(\d+): (.+)$/u.exec(line);
      return match && personalRules.has(match[2]!) ? [match[1]!] : [];
    }));
    const positives = source.map((row, index) => ({ row, index })).filter(({ row }) => row.label !== "none");
    const negatives = source.map((row, index) => ({ row, index })).filter(({ row }) => row.label === "none");
    const found = positives.filter(({ index }) => lines.has(String(index + 1))).length;
    const raised = negatives.filter(({ index }) => lines.has(String(index + 1))).length;
    console.log(`${set.path}: found ${found}/${positives.length}, raised ${raised}/${negatives.length}`);
    expect(scanned.status).not.toBe(2);
    expect(found).toBeGreaterThanOrEqual(set.foundFloor);
    expect(raised).toBeLessThanOrEqual(set.raisedCeiling);
  }
});

test("C28 one-megabyte lines finish in under a second and retain their final address", () => {
  const address = email();
  const size = 1024 * 1024;
  const samples = [
    ["capitalized", "Alpha Beta "],
    ["hyphenated", "ALPHA-BETA- "],
    ["quoted", ['"', "safe", '" ', "'", "safe", "' "].join("")],
    ["escaped", "\\u0061\\u0062 "],
  ] as const;
  for (const [name, unit] of samples) {
    const prefix = unit.repeat(Math.ceil(size / unit.length)).slice(0, size - address.length);
    const line = `${prefix}${address}`;
    const started = Date.now();
    const result = runScript("scrub-check", ["--files", writeScratchLine(line)], ROOT);
    const elapsed = Date.now() - started;
    console.log(`${name}: ${elapsed}ms`);
    expect(result.status).toBe(1);
    expect(result.stdout.trim().endsWith(":1: email")).toBe(true);
    expect(elapsed).toBeLessThan(1000);
    expect(!result.stdout.includes(address)).toBe(true);
  }
});

function writeScratchLine(line: string): string {
  const path = join(scratchDir(), "long.txt");
  writeFileSync(path, line);
  return path;
}
