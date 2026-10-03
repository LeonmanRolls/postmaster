// Tests beside scripts/scrub-check.ts: every rule proven by positives
// that fire and negatives that pass, each control flipping with
// SCRUB_CHECK_DISABLE. Values are assembled from fragments at test
// time so no committed file holds a matchable form.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const HERE = resolve(import.meta.dir);
const SCRIPT = join(HERE, "scrub-check.sh");
const FIXTURE_MAILBOX = "fixture" + "@" + "example.invalid";

function git(args: string[], cwd: string): string {
  return spawnSync("git", args, { cwd, encoding: "utf-8" }).stdout.trim();
}

interface ShResult {
  code: number;
  out: string;
  err: string;
}

function runScrub(
  args: string[],
  cwd: string,
  env?: Record<string, string>,
): ShResult {
  const r = spawnSync(SCRIPT, args, {
    cwd,
    encoding: "utf-8",
    env: { ...process.env, POSTMASTER_DETECTIONS_LOG: "", ...env },
  });
  return { code: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

// Every fabricated secret, assembled from pieces.
const AT = "@";
const ALLOW = "private-data:allo" + "w";
const ALLOW_NEXT = "private-data:allow-next" + "-line";
const sampleAddr = "lane-413" + AT + "relay-413" + ".net";
const privateIp = ["10", "135", "4", "13"].join(".");
const privateHost = "metrics" + ".inter" + "nal";
const tailnetHost = "node-413" + ".ts" + ".net";
const privatePath = "/" + "home" + "/" + "fixture-user-413" + "/notes.txt";
const fakeToken = "s" + "k-" + "fictional413key" + "K7mQ2xZ9aVbN4qy7";
const fakeKeyId = "AK" + "IA" + "X" + "X".repeat(15);
const fakeBearer = "Bearer " + "fictional413relay" + "K7mQ2xZ9aVbN4qy7";
const fakeOrgId = "org-" + "fictional413relayK7mQ2xZ9";
const coauthored = "Co-Authored" + "-By: ";

const SECRETS = [
  sampleAddr,
  privateIp,
  privateHost,
  tailnetHost,
  privatePath,
  fakeToken,
  fakeKeyId,
  fakeBearer,
  fakeOrgId,
];

let scratch: string;
let repo: string;

function silent(result: ShResult): boolean {
  return SECRETS.every(
    (v) => !result.out.includes(v) && !result.err.includes(v),
  );
}

function commit(
  relative: string,
  contents: string,
  message: string,
): string {
  const target = join(repo, relative);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, contents);
  git(["add", "--", relative], repo);
  git(
    [
      "-c",
      "user.name=Fixture",
      "-c",
      "user." + "em" + "ail=" + FIXTURE_MAILBOX,
      "commit",
      "-m",
      message,
    ],
    repo,
  );
  return git(["rev-parse", "HEAD"], repo);
}

function base(): string {
  return git(["rev-parse", "HEAD"], repo);
}

function freshRepo(name: string): string {
  const r = join(scratch, name);
  mkdirSync(r, { recursive: true });
  git(["init", "-q", "--initial-branch=main"], r);
  git(["config", "user.name", "Fixture"], r);
  git(["config", "user.email", FIXTURE_MAILBOX], r);
  writeFileSync(join(r, "base.txt"), "base\n");
  git(["add", "base.txt"], r);
  git(["commit", "-qm", "base"], r);
  return r;
}

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), "scrub-check-"));
  repo = join(scratch, "main");
  mkdirSync(repo);
  git(["init", "-q", "--initial-branch=main"], repo);
  git(["config", "user.name", "Fixture"], repo);
  git(["config", "user.email", FIXTURE_MAILBOX], repo);
  writeFileSync(join(repo, "base.txt"), "base\n");
  git(["add", "base.txt"], repo);
  git(["commit", "-qm", "base"], repo);
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

// Each pos/neg takes a snapshot of HEAD as its base and commits one fixture.
function pos(rule: string, text: string, name: string): void {
  test(`pos ${rule}: ${name}`, () => {
    const b = base();
    const head = commit(`fixtures/${name}.txt`, text, "positive fixture");
    const result = runScrub([b, head], repo);
    const lines = result.out.trim().split("\n").filter(Boolean);
    const expected = `${head}:fixtures/${name}.txt:1: ${rule}`;
    expect(result.code).toBe(1);
    expect(lines).toEqual([expected]);
    expect(silent(result)).toBe(true);
    const off = runScrub([b, head], repo, { SCRUB_CHECK_DISABLE: rule });
    expect(off.code).toBe(0);
    expect(off.out).toBe("");
  });
}

function neg(rule: string, text: string, name: string, label: string): void {
  test(`neg ${rule}: ${label}`, () => {
    const b = base();
    const head = commit(`fixtures/${name}.txt`, text, "clean fixture");
    const result = runScrub([b, head], repo);
    expect(result.code).toBe(0);
    expect(result.out).toBe("");
  });
}

describe("positive controls", () => {
  pos("email", "contact: " + sampleAddr + "\n", "pos-email");
  pos("email", "write to " + sampleAddr + ".\n", "pos-email-final");
  pos("private-host", "endpoint " + privateIp + ":8080\n", "pos-private-ip");
  pos(
    "private-host",
    "status at https://" + privateHost + ":8443/up\n",
    "pos-private-host",
  );
  pos("private-host", "node at " + tailnetHost + ":8080\n", "pos-tailnet");
  pos("private-path", "source under " + privatePath + "\n", "pos-home-path");
  pos("token", "relay key " + fakeToken + "\n", "pos-token");
  pos("token", "relay id " + fakeKeyId + "\n", "pos-access-key");
  pos("token", "auth " + fakeBearer + "\n", "pos-bearer");
  pos("token", "-----BEGIN " + "PRIVATE KEY-----\n", "pos-pem-header");
  pos("account-id", "owner " + fakeOrgId + "\n", "pos-org-id");
  pos("dotenv", "SESSION_" + "SECRET=relay-" + "413-quiet\n", "pos-dotenv");
  pos(
    "assistant-attribution",
    coauthored + "Imaginary Aide\n",
    "pos-attribution",
  );
  pos("assistant-attribution", "Generated with " + "Claude\n", "pos-generated");
});

describe("negative controls", () => {
  neg(
    "email",
    "the ship card lists each check and its exit code\n",
    "neg-plain",
    "a plain sentence is clean",
  );
  neg(
    "email",
    "reach the relay at 99999999+fictional" +
      AT +
      "users.noreply.github.com for pings\n",
    "neg-noreply-domain",
    "a GitHub no-reply address is clean",
  );
  neg(
    "email",
    "write " + "noreply" + AT + "no-such-vendor-413.net instead\n",
    "neg-noreply-local",
    "a no-reply local part is clean",
  );
  neg(
    "email",
    "write " + "someone" + AT + "example.org for the demo\n",
    "neg-reserved",
    "a reserved example domain is clean",
  );
  neg(
    "private-path",
    "notes under ~/Code/notes.txt\n",
    "neg-tilde-bare",
    "a bare home reference names nobody",
  );
  neg(
    "private-path",
    "read /home/user/docs for the layout\n",
    "neg-user-placeholder",
    "a placeholder user is clean",
  );
  neg(
    "private-host",
    "proxy at 127.0.0.1:9\n",
    "neg-loopback",
    "loopback is universal, not private",
  );
  neg(
    "private-host",
    "the gateway moved to 8.8.8.8 last month\n",
    "neg-public-ip",
    "a public IP is clean",
  );
  neg(
    "private-host",
    "serve on localhost:3000\n",
    "neg-localhost",
    "the loopback name is clean",
  );
  neg(
    "token",
    "commit = 89abcdef0123456789abcdef0123456789abcdef\n",
    "neg-hex-sha",
    "a hex sha under a plain field is not a token",
  );
  neg("token", "token: short\n", "neg-token-short", "a short value is clean");
  neg(
    "key",
    '{"userEmail": null}\n',
    "neg-key-null",
    "a null key value is clean",
  );
  neg(
    "key",
    "the userEmail field is redacted before promotion\n",
    "neg-key-prose",
    "a bare key name in prose is clean",
  );
  neg(
    "dotenv",
    "TOKEN_TYPE=Bearer\n",
    "neg-dotenv-pointer",
    "a pointer name is clean",
  );
  neg(
    "dotenv",
    "SESSION_SECRET=${STAGING}_relay_secret_413\n",
    "neg-dotenv-composed",
    "a composed assignment is clean",
  );
  neg(
    "assistant-attribution",
    "the commit trailer policy forbids crediting an assistant\n",
    "neg-attribution-talk",
    "attribution discussion is clean",
  );
  neg(
    "assistant-attribution",
    "Generated by Makefile for this repo\n",
    "neg-generated-tool",
    "a tool credit is not an assistant",
  );
});

describe("key-block controls", () => {
  test("a key block flags its header, body and end", () => {
    const b = base();
    const keyBody = "QUJD".repeat(10);
    const keyText =
      "-----BEGIN " +
      "PRIVATE KEY-----\n" +
      keyBody +
      "\n-----END " +
      "PRIVATE KEY-----\n";
    const head = commit("fixtures/key-block.txt", keyText, "key block");
    const result = runScrub([b, head], repo);
    const lines = result.out.trim().split("\n").filter(Boolean);
    const expected = [1, 2, 3].map(
      (n) => `${head}:fixtures/key-block.txt:${n}: token`,
    );
    expect(result.code).toBe(1);
    expect(lines).toEqual(expected);
    expect(silent(result)).toBe(true);
    const off = runScrub([b, head], repo, {
      SCRUB_CHECK_DISABLE: "token",
    });
    expect(off.code).toBe(0);
  });
});

describe("history controls", () => {
  test("a line added and then deleted is still flagged", () => {
    const b = base();
    const added = commit(
      "leak.txt",
      "contact: " + sampleAddr + "\n",
      "add leak",
    );
    unlinkSync(join(repo, "leak.txt"));
    git(["add", "--", "leak.txt"], repo);
    git(
      [
        "-c",
        "user.name=Fixture",
        "-c",
        "user." + "em" + "ail=" + FIXTURE_MAILBOX,
        "commit",
        "-m",
        "delete the leak",
      ],
      repo,
    );
    const deleted = git(["rev-parse", "HEAD"], repo);
    const covered = runScrub([b, deleted], repo);
    expect(covered.code).toBe(1);
    expect(covered.out.trim().split("\n")).toEqual([
      `${added}:leak.txt:1: email`,
    ]);
    expect(covered.out).not.toContain(sampleAddr);
  });
});

describe("marker controls", () => {
  test("a marked line stays silent", () => {
    const b = base();
    const head = commit(
      "fixtures/marked.txt",
      "contact: " +
        sampleAddr +
        "  # " +
        ALLOW +
        " email -- fixture relay address\n",
      "marked fixture",
    );
    const result = runScrub([b, head], repo);
    expect(result.code).toBe(0);
    expect(result.out).toBe("");
  });

  test("a next-line marker stays silent", () => {
    const b = base();
    const head = commit(
      "fixtures/nextline.txt",
      ALLOW_NEXT +
        " email -- fixture relay address\ncontact: " +
        sampleAddr +
        "\n",
      "next-line fixture",
    );
    const result = runScrub([b, head], repo);
    expect(result.code).toBe(0);
    expect(result.out).toBe("");
  });

  test("a marker that suppresses nothing faults", () => {
    const b = base();
    const head = commit(
      "fixtures/unused.txt",
      "ordinary public sample  # " + ALLOW + " email -- nothing to suppress\n",
      "unused fixture",
    );
    const result = runScrub([b, head], repo);
    expect(result.code).toBe(1);
    expect(result.out.trim().split("\n")).toEqual([
      `${head}:fixtures/unused.txt:1: marker`,
    ]);
  });

  test("a marker without a reason faults beside its finding", () => {
    const b = base();
    const head = commit(
      "fixtures/reasonless.txt",
      "contact: " + sampleAddr + "  # " + ALLOW + " email\n",
      "reasonless fixture",
    );
    const result = runScrub([b, head], repo);
    expect(result.code).toBe(1);
    const lines = result.out.trim().split("\n").filter(Boolean);
    expect(lines).toContain(`${head}:fixtures/reasonless.txt:1: email`);
    expect(lines).toContain(`${head}:fixtures/reasonless.txt:1: marker`);
    expect(silent(result)).toBe(true);
  });

  test("marker text in a message suppresses nothing", () => {
    const b = base();
    writeFileSync(join(repo, "msg-clean.txt"), "ordinary public sample\n");
    git(["add", "msg-clean.txt"], repo);
    git(
      [
        "-c",
        "user.name=Fixture",
        "-c",
        "user." + "em" + "ail=" + FIXTURE_MAILBOX,
        "commit",
        "-m",
        "note",
        "-m",
        "write to " + sampleAddr + "  # " + ALLOW + " email -- fixture",
      ],
      repo,
    );
    const head = git(["rev-parse", "HEAD"], repo);
    const inert = runScrub([b, head], repo);
    expect(inert.code).toBe(1);
    expect(inert.out.trim().split("\n")).toEqual([
      `${head}:(message):3: email`,
    ]);
    expect(silent(inert)).toBe(true);
  });
});

describe("message controls", () => {
  test("a trailer in a commit message is reported", () => {
    const b = base();
    writeFileSync(join(repo, "msg-clean2.txt"), "ordinary public sample\n");
    git(["add", "msg-clean2.txt"], repo);
    git(
      [
        "-c",
        "user.name=Fixture",
        "-c",
        "user." + "em" + "ail=" + FIXTURE_MAILBOX,
        "commit",
        "-m",
        "add the notes",
        "-m",
        coauthored + "Imaginary Aide",
      ],
      repo,
    );
    const head = git(["rev-parse", "HEAD"], repo);
    const trailed = runScrub([b, head], repo);
    expect(trailed.code).toBe(1);
    expect(trailed.out.trim().split("\n")).toEqual([
      `${head}:(message):3: assistant-attribution`,
    ]);
    const off = runScrub([b, head], repo, {
      SCRUB_CHECK_DISABLE: "messages",
    });
    expect(off.code).toBe(0);
  });
});

describe("merge controls", () => {
  test("a merge resolution carrying a suspect is reported", () => {
    const r = freshRepo("merge-test");
    git(["checkout", "-qb", "side-413"], r);
    writeFileSync(join(r, "merge.txt"), "side line\n");
    git(["add", "merge.txt"], r);
    git(
      [
        "-c",
        "user.name=Fixture",
        "-c",
        "user." + "em" + "ail=" + FIXTURE_MAILBOX,
        "commit",
        "-m",
        "side work",
      ],
      r,
    );
    git(["checkout", "-q", "main"], r);
    writeFileSync(join(r, "merge.txt"), "main line\n");
    git(["add", "merge.txt"], r);
    git(
      [
        "-c",
        "user.name=Fixture",
        "-c",
        "user." + "em" + "ail=" + FIXTURE_MAILBOX,
        "commit",
        "-m",
        "main work",
      ],
      r,
    );
    const mergeBase = git(["rev-parse", "HEAD~2"], r);
    spawnSync("git", ["merge", "--no-commit", "side-413"], { cwd: r });
    writeFileSync(join(r, "merge.txt"), "contact: " + sampleAddr + "\n");
    git(["add", "--", "merge.txt"], r);
    git(
      [
        "-c",
        "user.name=Fixture",
        "-c",
        "user." + "em" + "ail=" + FIXTURE_MAILBOX,
        "commit",
        "-m",
        "merge the side",
      ],
      r,
    );
    const mergeSha = git(["rev-parse", "HEAD"], r);
    const resolved = runScrub([mergeBase, mergeSha], r);
    expect(resolved.code).toBe(1);
    expect(resolved.out.trim().split("\n")).toEqual([
      `${mergeSha}:merge.txt:1: email`,
    ]);
    expect(silent(resolved)).toBe(true);
    const off = runScrub([mergeBase, mergeSha], r, {
      SCRUB_CHECK_DISABLE: "merges",
    });
    expect(off.code).toBe(0);
  });
});

describe("diff controls", () => {
  test("an added file with a shaped name is reported at line 0, redacted", () => {
    const r = freshRepo("diff-test");
    const b = git(["rev-parse", "HEAD"], r);
    const namedName = sampleAddr + ".txt";
    const target = join(r, namedName);
    writeFileSync(target, "just public words here\n");
    git(["add", "--", namedName], r);
    git(
      [
        "-c",
        "user.name=Fixture",
        "-c",
        "user." + "em" + "ail=" + FIXTURE_MAILBOX,
        "commit",
        "-m",
        "shaped name",
      ],
      r,
    );
    const head = git(["rev-parse", "HEAD"], r);
    const result = runScrub([b, head], r);
    expect(result.code).toBe(1);
    expect(result.out.trim().split("\n")).toEqual([
      `${head}:[redacted]:0: email`,
    ]);
    expect(silent(result)).toBe(true);
  });
});

describe("detection controls", () => {
  test("a reported finding is logged by rule, file, line and commit", () => {
    const r = freshRepo("detect-test");
    const b = git(["rev-parse", "HEAD"], r);
    const logpath = join(scratch, "detections.jsonl");
    writeFileSync(join(r, "logged.txt"), "contact: " + sampleAddr + "\n");
    git(["add", "logged.txt"], r);
    git(
      [
        "-c",
        "user.name=Fixture",
        "-c",
        "user." + "em" + "ail=" + FIXTURE_MAILBOX,
        "commit",
        "-m",
        "logged fixture",
      ],
      r,
    );
    const head = git(["rev-parse", "HEAD"], r);
    const result = runScrub([b, head], r, {
      POSTMASTER_DETECTIONS_LOG: logpath,
    });
    expect(result.code).toBe(1);
    const lines = readFileSync(logpath, "utf-8").trim().split("\n");
    expect(lines.length).toBe(1);
    const entry = JSON.parse(lines[0]!);
    expect(entry.rule).toBe("email");
    expect(entry.file).toBe("logged.txt");
    expect(entry.line).toBe(1);
    expect(entry.commit).toBe(head);
    expect(lines[0]).not.toContain(sampleAddr);
    unlinkSync(logpath);
  });
});

describe("safe-path controls", () => {
  test("--safe-path redacts a shaped span", () => {
    const redactedPath = "contact-" + "lane-413" + AT + "relay-413" + ".net.txt";
    const result = runScrub(["--safe-path", redactedPath], repo);
    expect(result.code).toBe(0);
    expect(result.out.trim()).toBe("[redacted]");
    expect(result.out).not.toContain(sampleAddr);
  });

  test("--safe-path passes a clean path through", () => {
    const result = runScrub(["--safe-path", "wiki/concepts/p.md"], repo);
    expect(result.code).toBe(0);
    expect(result.out.trim()).toBe("wiki/concepts/p.md");
  });
});

describe("string controls", () => {
  test("a JSON-escaped path is found", () => {
    const r = freshRepo("string-test");
    writeFileSync(
      join(r, "j-path.jsonl"),
      '{"text": "first line\\n' + privatePath + '/x"}\n',
    );
    const result = runScrub(["--files", "j-path.jsonl"], r);
    expect(result.code).toBe(1);
    expect(result.out.trim().split("\n")).toEqual([
      "j-path.jsonl:1: private-path",
    ]);
    expect(silent(result)).toBe(true);
  });

  test("a color-wrapped path is found", () => {
    const r = freshRepo("ansi-test");
    writeFileSync(
      join(r, "ansi.log"),
      "prefix \x1b[32m" + privatePath + "\x1b[0m suffix\n",
    );
    const result = runScrub(["--files", "ansi.log"], r);
    expect(result.code).toBe(1);
    expect(result.out.trim().split("\n")).toEqual(["ansi.log:1: private-path"]);
    expect(silent(result)).toBe(true);
  });
});

describe("usage controls", () => {
  test("--help exits 0 on stderr with no stdout", () => {
    const result = runScrub(["--help"], repo);
    expect(result.code).toBe(0);
    expect(result.out).toBe("");
    expect(result.err).toContain("usage:");
  });

  for (const [args, label] of [
    [[], "no arguments"],
    [["main"], "one range argument"],
    [["--files"], "files without paths"],
  ] as Array<[string[], string]>) {
    test(`${label} is a usage error, exit 2`, () => {
      const result = runScrub(args, repo);
      expect(result.code).toBe(2);
      expect(result.out).toBe("");
    });
  }

  test("an empty commit range is clean", () => {
    const h = git(["rev-parse", "HEAD"], repo);
    const result = runScrub([h, h], repo);
    expect(result.code).toBe(0);
    expect(result.out).toBe("");
  });
});
