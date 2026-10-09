import { afterEach, expect, test } from "bun:test";
import {
  accessSync,
  closeSync,
  constants,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { delimiter, join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  cleanupScratch,
  commit,
  email,
  initRepo,
  opaqueId,
  phone,
  privatePath,
  ROOT,
  runScript,
  scratchDir,
  token,
} from "./scrub-test-kit.ts";

afterEach(cleanupScratch);

function direct(script: string, args: string[], cwd: string, env: Record<string, string> = {}) {
  return spawnSync(
    process.execPath,
    [
      "--no-env-file",
      `--config=${join(ROOT, "bunfig.toml")}`,
      join(ROOT, "scripts", `${script}.ts`),
      ...args,
    ],
    {
      cwd,
      env: { ...process.env, ...env },
      encoding: "utf8",
    },
  );
}

function executable(name: string): string {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    const path = join(dir, name);
    try {
      accessSync(path, constants.X_OK);
      return path;
    } catch {
      /* keep looking */
    }
  }
  throw new Error("required executable was not found");
}

test("C1 wrappers match host.sh and a direct Bun range scan needs only Bun, git and a shell", () => {
  const scripts = ["scrub-check", "tree-check", "raw-promote", "scrub-rewrite", "verify-merge"];
  const host = readFileSync(join(ROOT, "scripts", "host.sh"), "utf8");
  for (const name of scripts) {
    expect(readFileSync(join(ROOT, "scripts", `${name}.sh`), "utf8")).toBe(
      host.replaceAll("host.ts", `${name}.ts`),
    );
  }
  const grep = spawnSync(
    "grep",
    [
      "-i",
      "-l",
      "python",
      ...scripts.flatMap((name) => [
        join(ROOT, "scripts", `${name}.ts`),
        join(ROOT, "scripts", `${name}.sh`),
      ]),
    ],
    { encoding: "utf8" },
  );
  expect(grep.status).toBe(1);
  expect(grep.stdout.trim()).toBe("");

  const repo = initRepo();
  const base = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: repo,
    encoding: "utf8",
  }).stdout.trim();
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
  const base = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: repo,
    encoding: "utf8",
  }).stdout.trim();
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
  const namedBase = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: namedRepo,
    encoding: "utf8",
  }).stdout.trim();
  const filename = `empty-${email()}`;
  writeFileSync(join(namedRepo, filename), "");
  commit(namedRepo, "add empty file");
  const named = runScript("scrub-check", [namedBase, "HEAD"], namedRepo);
  expect(named.status).toBe(1);
  expect(named.stdout.trim()).toMatch(/:0: email$/u);
  expect(!named.stdout.includes(email())).toBe(true);

  const messageRepo = initRepo();
  const messageBase = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: messageRepo,
    encoding: "utf8",
  }).stdout.trim();
  const message = `note ${email()}`;
  const messageCommit = commit(messageRepo, message);
  const messageScan = runScript("scrub-check", [messageBase, "HEAD"], messageRepo);
  expect(messageScan.status).toBe(1);
  expect(messageScan.stdout.trim()).toBe(`${messageCommit}:(message):1: email`);
  expect(!messageScan.stdout.includes(email())).toBe(true);

  for (const key of ["GIT_AUTHOR_EMAIL", "GIT_COMMITTER_EMAIL"]) {
    const identityRepo = initRepo();
    const identityBase = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: identityRepo,
      encoding: "utf8",
    }).stdout.trim();
    const identityCommit = commit(identityRepo, "identity fixture", { [key]: email() });
    const identityScan = runScript("scrub-check", [identityBase, "HEAD"], identityRepo);
    expect(identityScan.status).toBe(1);
    expect(identityScan.stdout.trim()).toBe(
      `${identityCommit}:(${key === "GIT_AUTHOR_EMAIL" ? "author" : "committer"}):1: email`,
    );
    expect(!identityScan.stdout.includes(email())).toBe(true);
  }

  const mergeRepo = initRepo();
  const mergeBase = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: mergeRepo,
    encoding: "utf8",
  }).stdout.trim();
  writeFileSync(join(mergeRepo, "merge.txt"), "side\n");
  commit(mergeRepo, "side change");
  const side = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: mergeRepo,
    encoding: "utf8",
  }).stdout.trim();
  spawnSync("git", ["switch", "-q", "main"], { cwd: mergeRepo });
  writeFileSync(join(mergeRepo, "merge.txt"), "main\n");
  commit(mergeRepo, "main change");
  spawnSync("git", ["merge", "--no-commit", side], {
    cwd: mergeRepo,
    encoding: "utf8",
    stdio: "ignore",
  });
  writeFileSync(join(mergeRepo, "merge.txt"), `phone ${phone()}\n`);
  const mergeCommit = commit(mergeRepo, "resolve merge");
  const mergeScan = runScript("scrub-check", [mergeBase, "HEAD"], mergeRepo);
  expect(mergeScan.status).toBe(1);
  expect(
    mergeScan.stdout
      .trim()
      .split("\n")
      .some((line) => line.startsWith(`${mergeCommit}:merge.txt:1: phone`)),
  ).toBe(true);
});

test("closed input refuses any other encoding loudly by name, exit 2", () => {
  // Review round 6: UTF-16, binary and invalid bytes are refused, never
  // decoded; the refusal names the file and fails closed.
  for (const encoding of ["utf16le", "utf16be"] as const) {
    const repo = initRepo();
    const body = `contact ${email()} here\n`;
    const little = Buffer.from(body, "utf16le");
    const big = Buffer.from(little);
    for (let i = 0; i + 1 < big.length; i += 2) {
      const lo = big[i]!;
      big[i] = big[i + 1]!;
      big[i + 1] = lo;
    }
    const bytes =
      encoding === "utf16le"
        ? Buffer.concat([Buffer.from([0xff, 0xfe]), little])
        : Buffer.concat([Buffer.from([0xfe, 0xff]), big]);
    const notePath = join(repo, "note.txt");
    writeFileSync(notePath, bytes);
    const files = runScript("scrub-check", ["--files", "note.txt"], repo);
    expect(files.status).toBe(2);
    expect(files.stderr).toContain("refused note.txt: not UTF-8 text");
    expect(files.stdout).not.toContain(email());
  }
  const repo = initRepo();
  const binaryPath = join(repo, "blob.bin");
  writeFileSync(binaryPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
  const binary = runScript("scrub-check", ["--files", "blob.bin"], repo);
  expect(binary.status).toBe(2);
  expect(binary.stderr).toContain("refused blob.bin: not UTF-8 text");
  const brokenPath = join(repo, "broken.txt");
  writeFileSync(brokenPath, Buffer.from([0x61, 0xff, 0x62, 0x0a]));
  const broken = runScript("scrub-check", ["--files", "broken.txt"], repo);
  expect(broken.status).toBe(2);
  expect(broken.stderr).toContain("refused broken.txt: not UTF-8 text");
  const rangeRepo = initRepo();
  const base = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: rangeRepo,
    encoding: "utf8",
  }).stdout.trim();
  writeFileSync(
    join(rangeRepo, "note.txt"),
    Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`contact ${email()} here\n`, "utf16le")]),
  );
  commit(rangeRepo, "add encoded note");
  const range = runScript("scrub-check", [base, "HEAD"], rangeRepo);
  expect(range.status).toBe(2);
  expect(range.stderr).toContain("refused note.txt: not UTF-8 text");
});

test("an invalid byte in commit metadata refuses by name like file content", () => {
  // Review round 8: metadata values passed through closed-input matching
  // without the refusal file content gets, so an invalid byte silently
  // broke the match instead of refusing. Crafted objects are the vector:
  // the git CLI transcodes -F input, but the walker delivers stored raw
  // bytes unchanged.
  const local = ["mail", "box"].join("");
  const head = ["north"].join("");
  const tail = ["star", ".org"].join("");
  const craft = (field: string): { repo: string; base: string; sha: string } => {
    const repo = initRepo();
    const rev = (args: string[]): string =>
      spawnSync("git", args, { cwd: repo, encoding: "utf8" }).stdout.trim();
    const base = rev(["rev-parse", "HEAD"]);
    const tree = rev(["rev-parse", "HEAD^{tree}"]);
    const who = `t <${local}@${head}${tail}> 1791530610 +0000`;
    const authorLine = `author ${who}`;
    const committerLine = `committer ${who}`;
    const parts: Buffer[] = [
      Buffer.from(`tree ${tree}\nparent ${base}\n`, "utf8"),
      field === "author"
        ? Buffer.concat([
            Buffer.from(`author t <${local}@${head}`, "utf8"),
            Buffer.from([0x80]),
            Buffer.from(`${tail}> 1791530610 +0000\n`, "utf8"),
          ])
        : Buffer.from(`${authorLine}\n`, "utf8"),
      field === "committer"
        ? Buffer.concat([
            Buffer.from(`committer t <${local}@${head}`, "utf8"),
            Buffer.from([0x80]),
            Buffer.from(`${tail}> 1791530610 +0000\n`, "utf8"),
          ])
        : Buffer.from(`${committerLine}\n`, "utf8"),
      Buffer.from("\n", "utf8"),
      field === "message"
        ? Buffer.concat([
            Buffer.from(`contact ${local}@${head}`, "utf8"),
            Buffer.from([0x80]),
            Buffer.from(`${tail} here\n`, "utf8"),
          ])
        : Buffer.from(`contact ${local}@${head}${tail} here\n`, "utf8"),
    ];
    const sha = spawnSync("git", ["hash-object", "-t", "commit", "--stdin", "-w"], {
      cwd: repo,
      input: Buffer.concat(parts),
      encoding: "utf8",
    }).stdout.trim();
    spawnSync("git", ["update-ref", "refs/heads/main", sha], { cwd: repo });
    return { repo, base, sha };
  };
  for (const field of ["message", "author", "committer"]) {
    const { repo, base, sha } = craft(field);
    const scan = runScript("scrub-check", [base, "HEAD"], repo);
    expect(scan.status).toBe(2);
    expect(scan.stderr).toContain(`refused ${sha}:(${field}): not UTF-8 text`);
    expect(scan.stderr).not.toContain(local);
    expect(scan.stdout).not.toContain(local);
  }
  const clean = craft("none");
  const pass = runScript("scrub-check", [clean.base, "HEAD"], clean.repo);
  expect(pass.status).toBe(1);
  expect(pass.stdout).toContain(clean.sha.slice(0, 7));
});

test("range scan strips git's trailing tab on spaced +++ paths", () => {
  // Review round 7: the slice kept the tab, so the key lookup died exit 2
  // and finding rows carried a path no later lookup could resolve.
  const repo = initRepo();
  const base = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: repo,
    encoding: "utf8",
  }).stdout.trim();
  const name = "Meeting notes.md";
  writeFileSync(
    join(repo, name),
    `contact ${email()} here\n0123456789abcdef0123456789abcdef01234567\n`,
  );
  commit(repo, "add spaced note");
  const scanned = runScript("scrub-check", [base, "HEAD"], repo);
  expect(scanned.status).toBe(1);
  expect(scanned.stdout).toContain(`${name}:1: email`);
  expect(scanned.stdout).not.toContain("\t");
});

test("range scan completes while per-file lookups await inside the diff read", () => {
  const repo = initRepo();
  const base = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: repo,
    encoding: "utf8",
  }).stdout.trim();
  for (let i = 0; i < 20; i++)
    writeFileSync(join(repo, `page-${i}.md`), `---\nname: t\n---\nnote ${email()}\n`);
  writeFileSync(join(repo, "key.txt"), "-----BEGIN PRIV" + "ATE KEY-----\n");
  commit(repo, "add pages and key");
  const scan = runScript("scrub-check", [base, "HEAD"], repo);
  expect(scan.status).toBe(1);
  expect(scan.stdout).toContain("page-0.md:4: email");
  expect(scan.stdout).toContain("key.txt:1: token");
});

test("child close listeners attach before the first read, so a fast exit cannot strand a scan", () => {
  const cases = [
    { file: "scrub-check-main.ts", fn: "async function commitHasExactLine" },
    { file: "tree-check.ts", fn: "async function scanBlob" },
  ];
  for (const { file, fn } of cases) {
    const source = readFileSync(join(ROOT, "scripts", file), "utf8");
    const start = source.indexOf(fn);
    expect(start).toBeGreaterThanOrEqual(0);
    const body = source.slice(start);
    const listen = body.indexOf('("close"');
    const drain = body.indexOf("for await");
    expect(listen).toBeGreaterThanOrEqual(0);
    expect(drain).toBeGreaterThanOrEqual(0);
    expect(listen).toBeLessThan(drain);
  }
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

test("C3 --files decodes ANSI, JSON depths one through four and the depth limit, and truncation", () => {
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
  writeFileSync(
    path,
    `${[1, 2, 3, 4].map(nested).join("\n")}\n${atLimit}\n${ansi}\n${truncated}\n`,
  );
  const result = runScript("scrub-check", ["--files", path], repo);
  expect(result.status).toBe(1);
  expect(result.stdout.trim().split("\n")).toHaveLength(7);
  expect(result.stdout.split("\n").filter((line) => line.endsWith(": email"))).toHaveLength(7);
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

  const base = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: repo,
    encoding: "utf8",
  }).stdout.trim();
  writeFileSync(
    path,
    "-----BEGIN RSA PRIV" + "ATE KEY-----\n\n-----END RSA PRIV" + "ATE KEY-----\n",
  );
  commit(repo, "add key header");
  const headerCommit = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: repo,
    encoding: "utf8",
  }).stdout.trim();
  writeFileSync(
    path,
    `-----BEGIN RSA PRIV${"ATE"} KEY-----\n${body}\n-----END RSA PRIV${"ATE"} KEY-----\n`,
  );
  const bodyCommit = commit(repo, "add key body");
  const range = runScript("scrub-check", [headerCommit, bodyCommit], repo);
  expect(range.status).toBe(1);
  expect(
    range.stdout
      .trim()
      .split("\n")
      .some((line) => line.endsWith(":2: token")),
  ).toBe(true);

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
  const lines = new Set(
    shapes.stdout.split("\n").flatMap((line) => {
      const match = /^\[redacted\]:([0-9]+): (?:token|dotenv)$/u.exec(line);
      return match ? [Number(match[1])] : [];
    }),
  );
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
  const markedMessage = commit(
    repo,
    `message ${email()} ${["private-data", ":allow email -- synthetic fixture"].join("")}`,
  );
  const messages = runScript("scrub-check", ["HEAD~1", markedMessage], repo);
  expect(messages.status).toBe(1);
  expect(messages.stdout).toContain("(message):1: email");
  expect(!messages.stdout.includes(email())).toBe(true);

  const prPath = join(repo, "pr.txt");
  writeFileSync(
    prPath,
    `comment ${email()} ${["private-data", ":allow email -- synthetic fixture"].join("")}`,
  );
  const pr = runScript("scrub-check", ["--pr-description", prPath], repo);
  expect(pr.status).toBe(1);
  expect(pr.stdout.trim()).toBe("(pr-description):1: email");
  expect(!pr.stdout.includes(email())).toBe(true);

  const commentPath = join(repo, "ticket-comment.txt");
  writeFileSync(
    commentPath,
    `ticket comment ${email()} ${["private-data", ":allow email -- synthetic fixture"].join("")}\n`,
  );
  const comment = runScript("scrub-check", ["--pr-description", commentPath], repo);
  expect(comment.status).toBe(1);
  expect(comment.stdout.trim()).toBe("(pr-description):1: email");
  expect(!comment.stdout.includes(email())).toBe(true);
});

test("a dirty draft scan reports its rows and logs one marked line per finding", () => {
  // Review round 6: dropping draft rows broke C29, so drafts log marked
  // via draft and the block and TELL skip them instead of resolving them.
  const repo = initRepo();
  const draftPath = join(repo, "draft.txt");
  writeFileSync(draftPath, `draft ${email()}\n`);
  const log = join(repo, "detections.jsonl");
  const draft = runScript("scrub-check", ["--pr-description", draftPath], repo, {
    POSTMASTER_DETECTIONS_LOG: log,
  });
  expect(draft.status).toBe(1);
  expect(draft.stdout.trim()).toBe("(pr-description):1: email");
  const rows = readFileSync(log, "utf8").trim().split("\n");
  expect(rows).toHaveLength(1);
  expect((JSON.parse(rows[0]!) as Record<string, unknown>).via).toBe("draft");
});

test("--pr-description threads key-block state like --files", () => {
  // Review round 6: --pr-description scanned each line stateless, so an END
  // line that --files flagged through keyBlock passed silently.
  const repo = initRepo();
  const head = ["-----BEGIN RSA PRIV", "ATE KEY-----"].join("");
  const end = ["-----END RSA PRIV", "ATE KEY-----"].join("");
  const keyPath = join(repo, "key.txt");
  writeFileSync(keyPath, `${head}\n${end}\n`);
  const files = runScript("scrub-check", ["--files", keyPath], repo);
  expect(files.status).toBe(1);
  expect(files.stdout.trim().split("\n")).toHaveLength(2);
  const pr = runScript("scrub-check", ["--pr-description", keyPath], repo);
  expect(pr.status).toBe(1);
  expect(pr.stdout.trim().split("\n")).toEqual([
    "(pr-description):1: token",
    "(pr-description):2: token",
  ]);
});

test("C15 stale and malformed markers fault only beside findings", () => {
  const repo = initRepo();
  const path = join(repo, "marker-cases.txt");
  const validUnused = ["private-data", ":allow email -- synthetic fixture"].join("");
  const reasonless = ["private-data", ":allow email -- "].join("");
  const malformed = ["private-data", ":allow"].join("");
  writeFileSync(path, `${validUnused}\n${reasonless} ${email()}\n${malformed}\n`);
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
  const disabled = runScript("scrub-check", ["--files", path], repo, {
    SCRUB_CHECK_DISABLE: "email",
  });
  expect(disabled.status).toBe(0);
  expect(disabled.stdout.trim()).toBe("");
  expect(token().length).toBeGreaterThan(20);
});

test("C5 patterns stay offline and find personal data from fragments", () => {
  const repo = initRepo();
  const path = join(repo, "personal.txt");
  const rows = [
    ["my name is ", "Élodie", " ", "Martin"].join(""),
    email(),
    ["phone ", phone()].join(""),
    "48 Orchard " + "Lane, Northport, MA " + "01980",
    ["ssn: ", "392", "-", "84", "-", "6137"].join(""),
  ];
  writeFileSync(path, `${rows.join("\n")}\n`);
  const bin = join(scratchDir(), "offline-bin");
  mkdirSync(bin);
  symlinkSync(process.execPath, join(bin, "bun"));
  symlinkSync(executable("sh"), join(bin, "sh"));
  const result = direct("scrub-check", ["--files", path], repo, {
    PATH: bin,
    HTTP_PROXY: "http://127.0.0.1:1",
    HTTPS_PROXY: "http://127.0.0.1:1",
  });
  expect(result.status).toBe(1);
  const found = new Set(
    result.stdout
      .split("\n")
      .map((line) => line.split(": ").at(-1))
      .filter(Boolean),
  );
  for (const rule of ["self-introduction", "email", "phone", "street", "ssn"])
    expect(found.has(rule)).toBe(true);
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
    "ss" + "h bluejay",
    "sc" + "p bluejay:/tmp/report .",
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
  for (const rule of ["private-path", "private-host", "account-id", "assistant-attribution"])
    expect(rules.has(rule)).toBe(true);
  expect(rows.every((row) => !row.endsWith(": email"))).toBe(true);
  expect(!found.stdout.includes(credit) && !found.stdout.includes(footer)).toBe(true);
  expect(!found.stderr.includes(credit) && !found.stderr.includes(footer)).toBe(true);

  const clean = join(repo, "code-only.txt");
  writeFileSync(
    clean,
    [
      "process.env.HOME",
      'join(home, "note.txt")',
      "const session_id = process.env.SESSION_ID",
      "/home/user/trial/home/note.txt",
      "ssh host",
      'const host = "<placeholder>"',
    ].join("\n") + "\n",
  );
  const passed = runScript("scrub-check", ["--files", clean], repo);
  expect(passed.status).toBe(0);
  expect(passed.stdout).toBe("");
  expect(passed.stderr).toBe("");
});

test("C6 held-out personal-data results meet both recorded thresholds", () => {
  const personalRules = new Set([
    "sign-off",
    "author-field",
    "copyright",
    "git-identity",
    "title",
    "self-introduction",
    "relative",
    "credit",
    "name-and-address",
    "email",
    "phone",
    "card",
    "iban",
    "ssn",
    "id-number",
    "date-of-birth",
    "health",
    "income",
    "family",
    "residence",
    "employer",
    "street",
    "postcode",
    "po-box",
    "address-field",
  ]);
  const sets = [
    {
      path: "raw/trials/pii-patterns/results/heldout/lines.json",
      foundFloor: 33,
      raisedCeiling: 3,
    },
    {
      path: "raw/trials/pii-patterns/results/heldout2/lines.json",
      foundFloor: 25,
      raisedCeiling: 4,
    },
  ];
  for (const set of sets) {
    const source = JSON.parse(readFileSync(join(ROOT, set.path), "utf8")) as Array<{
      parts: string[];
      label: string;
    }>;
    const input = join(scratchDir(), "heldout.txt");
    writeFileSync(input, `${source.map((row) => row.parts.join("")).join("\n")}\n`);
    const scanned = runScript("scrub-check", ["--files", input], ROOT);
    const lines = new Set(
      scanned.stdout.split("\n").flatMap((line) => {
        const match = /^\[redacted\]:([0-9]+): (.+)$/u.exec(line);
        return match && personalRules.has(match[2]!) ? [match[1]!] : [];
      }),
    );
    const positives = source
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => row.label !== "none");
    const negatives = source
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => row.label === "none");
    const found = positives.filter(({ index }) => lines.has(String(index + 1))).length;
    const raised = negatives.filter(({ index }) => lines.has(String(index + 1))).length;
    console.log(
      `${set.path}: found ${found}/${positives.length}, raised ${raised}/${negatives.length}`,
    );
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

test("C27 --files and raw promotion stream a 175 MB file below 512 MB", () => {
  const probe = spawnSync("bash", ["-c", "ulimit -v 524288"], { encoding: "utf8" });
  if (probe.status !== 0) {
    console.log("not shown: this host cannot set the required virtual-memory limit");
    return;
  }
  const source = join(scratchDir(), "large");
  const file = join(source, "records.jsonl");
  const repo = initRepo();
  mkdirSync(source);
  const fd = openSync(file, "w");
  const row = Buffer.from(`${"letter ".repeat(357)}\n`);
  try {
    for (let index = 0; index < 70_000; index++) writeSync(fd, row);
  } finally {
    closeSync(fd);
  }
  expect(Buffer.byteLength(row) * 70_000).toBeGreaterThan(170_000_000);
  writeFileSync(
    join(scratchDir(), "whole-read.ts"),
    [
      'import { readFileSync } from "node:fs";',
      'const body = readFileSync(process.argv[2]!, "utf8");',
      'const lines = body.split("\\n");',
      "console.log(lines.length);",
    ].join("\n"),
  );

  const withinLimit = (script: string, args: string[]) =>
    spawnSync("bash", ["-c", 'ulimit -v 524288 || exit 99; exec "$@"', "bash", script, ...args], {
      cwd: repo,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
  const scan = withinLimit(join(ROOT, "scripts/scrub-check.sh"), ["--files", file]);
  expect(scan.status).toBe(0);
  expect(scan.stdout).toBe("");
  expect(scan.stderr).toBe("");

  const promoted = withinLimit(join(ROOT, "scripts/raw-promote.sh"), [source, "raw/large"]);
  expect(promoted.status).toBe(0);
  expect(promoted.stdout).toBe("");
  expect(promoted.stderr).toBe("");

  const wholeRead = withinLimit(process.execPath, [join(scratchDir(), "whole-read.ts"), file]);
  expect(wholeRead.status).not.toBe(0);
}, 600_000);
