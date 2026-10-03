// Tests beside scripts/local.ts, moved from its --self-test on #109: 101 controls,
// plus one regression control for Bun's fetch-proxy snapshot (restoreEnv).
// Order-dependent: the tests replay the self-test's sequence in file order against shared
// fixtures (ticket numbers accumulate), except the final unicode vectors, which are pure.
// The BASE strict-read replay is gated on BASE extracting from history and python3 being
// on PATH; BASE extraction runs at file top so the gate is decided before collection,
// while the "extracts" control itself keeps its original place in the sequence.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { scriptsDir, toolRoot } from "./lib/paths";
import { run } from "./lib/proc";
import {
  NUMBER_RE,
  nextNumber,
  numberArg,
  oneLine,
  STORE_FILE_RE,
  STORE_TMP_RE,
  ticketPath,
} from "./local";

const self = join(scriptsDir(import.meta), "run");
const here = scriptsDir(import.meta);

// The proxy-snapshot regression below needs a proxy-free outer environment;
// under a real proxy it cannot tell direct from proxied, so it skips.
const outerProxy =
  process.env.HTTP_PROXY ??
  process.env.http_proxy ??
  process.env.HTTPS_PROXY ??
  process.env.https_proxy;
if (outerProxy !== undefined) {
  console.log(
    "skip restoreEnv leaves fetch direct: a proxy is set here, so directness was not compared",
  );
}

// BASE is the newest scripts/run local in history that is a real script rather than the
// port's one-line wrapper, and it must still carry the strict ticket read.
const baseTmp = mkdtempSync(join(tmpdir(), "local-base-"));
let baseLocal = "";
{
  const log = run("git", [
    "-C",
    toolRoot(import.meta),
    "log",
    "--format=%H",
    "--",
    "scripts/local.sh",
  ]);
  for (const c of log.out
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)) {
    const show = run("git", ["-C", toolRoot(import.meta), "show", `${c}:scripts/local.sh`]);
    if (
      show.code === 0 &&
      show.out.split("\n").length > 10 &&
      show.out.includes('json.loads(raw.decode("utf-8-sig"))')
    ) {
      baseLocal = join(baseTmp, "base-local.sh");
      writeFileSync(baseLocal, show.out);
      chmodSync(baseLocal, 0o755);
      break;
    }
  }
}
const hasPy3 = run("sh", ["-c", "command -v python3"]).code === 0;
const noBaseReplay = baseLocal === "" || !hasPy3;
if (noBaseReplay) {
  console.log(
    `skip BASE local.sh strict-read replay: ${
      baseLocal === ""
        ? "BASE local.sh not found in history"
        : "python3 not on PATH: the 0xff refusal was not compared against BASE"
    }`,
  );
}

let temp = "";
let bodyPath = "";
let crlfPath = "";
let newPath = "";
let emptyPath = "";
let bomPath = "";
let repo = "";
let worktree = "";
let unticketed = "";
let plain = "";
let store = "";
let trackerStore = "";
let ghLog = "";
let refs = "";
let commits = 0;
let dayBefore = "";
let dayAfter = "";
let bomNumber = "";

const envKeys = [
  "HOME",
  "XDG_CONFIG_HOME",
  "PATH",
  "POSTMASTER_CONFIG",
  "GIT_CONFIG_NOSYSTEM",
  "GIT_CONFIG_GLOBAL",
  "GIT_CEILING_DIRECTORIES",
  "GIT_AUTHOR_NAME",
  "GIT_AUTHOR_EMAIL",
  "GIT_COMMITTER_NAME",
  "GIT_COMMITTER_EMAIL",
  "http_proxy",
  "https_proxy",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "all_proxy",
  "ALL_PROXY",
];
const oldEnv = new Map<string, string | undefined>();

function BufferLike(value: string | Uint8Array): string {
  return typeof value === "string" ? value : new TextDecoder().decode(value);
}

function bodyline(value: string): string {
  return value.split(/\r?\n/u)[7] ?? "";
}

const invoke = (repoPath: string, ...commandArgs: string[]) =>
  run(self, ["local", repoPath, ...commandArgs]);

const output = (result: { out: string; err: string }) =>
  `${result.out.replace(/\n+$/u, "")}${
    result.err
      ? `${result.out && !result.out.endsWith("\n") ? "\n" : ""}${result.err.replace(/\n+$/u, "")}`
      : ""
  }`;

const lt = (repoPath: string, ...commandArgs: string[]) => {
  const result = invoke(repoPath, ...commandArgs);
  return { code: result.code, out: output(result) };
};

const newRepo = (repoPath: string): boolean => {
  mkdirSync(repoPath, { recursive: true });
  if (
    run("git", ["init", "-q", repoPath]).code !== 0 ||
    run("git", [
      "-C",
      repoPath,
      "-c",
      "user.name=local-self-test",
      "-c",
      "user.email=self-test@example.invalid",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "Initial commit",
    ]).code !== 0
  )
    return false;
  mkdirSync(join(repoPath, ".git", "info"), { recursive: true });
  appendFileSync(join(repoPath, ".git", "info", "exclude"), ".worktrees/\n");
  return true;
};

const snapshot = (storePath: string): string => {
  try {
    return (readdirSync(storePath) as string[])
      .sort()
      .map((name) => {
        const path = join(storePath, name);
        return statSync(path).isFile() ? `${name} ${readFileSync(path).toString("hex")}` : "";
      })
      .filter(Boolean)
      .join("\n");
  } catch {
    return "";
  }
};

const check = (result: { code: number; out: string }, wanted: number, text = "") => {
  expect(result.code).toBe(wanted);
  if (text) expect(result.out).toContain(text);
};

const refused = (wanted: number, text: string, repoPath: string, ...commandArgs: string[]) => {
  const before = snapshot(trackerStore);
  const result = lt(repoPath, ...commandArgs);
  expect(result.code).toBe(wanted);
  expect(result.out).toContain(text);
  expect(snapshot(trackerStore)).toBe(before);
};

const refusedRaw = (
  wanted: number,
  text: string,
  repoPath: string,
  octal: string,
  ...commandArgs: string[]
) => {
  // One argument carries bytes printf makes that are not UTF-8, in place of
  // the marker. spawnSync encodes every argument as UTF-8, so a shell builds
  // the bytes, as BASE's fixtures do.
  const before = snapshot(trackerStore);
  const line = [self, "local", repoPath, ...commandArgs]
    .map((a) => (a === "<RAW-BYTES>" ? `"$(printf '${octal}')"` : `'${a.replace(/'/gu, `'\\''`)}'`))
    .join(" ");
  const result = run("bash", ["-c", line]);
  const got = { code: result.code, out: output(result) };
  expect(got.code).toBe(wanted);
  expect(got.out).toContain(text);
  expect(snapshot(trackerStore)).toBe(before);
};

const tracker = (configPath: string, path: string) =>
  run(join(here, "run"), ["discover-project", path], {
    env: { POSTMASTER_CONFIG: configPath },
  }).out.match(/^tracker=(.*)$/mu)?.[1] ?? "";

const put = (path: string, text: string) => writeFileSync(path, text);

// Restore every key beforeAll touched. A key that was unset is assigned ""
// before it is deleted: Bun's fetch snapshots proxy variables on assignment
// and a bare delete never clears the snapshot, so a later file's fetch in
// this process would use this suite's dead proxy (proven: set, "", delete
// fetches direct; set, delete, "", delete still uses the proxy).
function restoreEnv(): void {
  for (const [key, value] of oldEnv) {
    if (value === undefined) {
      process.env[key] = "";
      delete process.env[key];
    } else process.env[key] = value;
  }
}

beforeAll(() => {
  try {
    temp = mkdtempSync(join(tmpdir(), "local-self-test-"));
    for (const key of envKeys) oldEnv.set(key, process.env[key]);
    mkdirSync(join(temp, "bin"), { recursive: true });
    mkdirSync(join(temp, "home", ".config"), { recursive: true });
    ghLog = join(temp, "gh.log");
    const gh = join(temp, "bin", "gh");
    writeFileSync(gh, `#!/bin/sh\nprintf 'gh %s\\n' "$*" >> '${ghLog}'\nexit 1\n`);
    chmodSync(gh, 0o755);
    process.env.HOME = join(temp, "home");
    process.env.XDG_CONFIG_HOME = join(temp, "home", ".config");
    process.env.PATH = `${join(temp, "bin")}:${oldEnv.get("PATH") ?? ""}`;
    process.env.POSTMASTER_CONFIG = join(temp, "home", "no-config.toml");
    process.env.GIT_CONFIG_NOSYSTEM = "1";
    process.env.GIT_CONFIG_GLOBAL = "/dev/null";
    process.env.GIT_CEILING_DIRECTORIES = temp;
    for (const key of [
      "http_proxy",
      "https_proxy",
      "HTTP_PROXY",
      "HTTPS_PROXY",
      "all_proxy",
      "ALL_PROXY",
    ])
      process.env[key] = "http://127.0.0.1:9";
    process.env.GIT_AUTHOR_NAME = "self-test";
    process.env.GIT_AUTHOR_EMAIL = "self-test@example.org";
    process.env.GIT_COMMITTER_NAME = "self-test";
    process.env.GIT_COMMITTER_EMAIL = "self-test@example.org";

    bodyPath = join(temp, "body.md");
    crlfPath = join(temp, "crlf.md");
    newPath = join(temp, "new.md");
    emptyPath = join(temp, "empty.md");
    bomPath = join(temp, "bom.md");
    put(
      bodyPath,
      '## Problem / feature\nA ticket with `code`, "quotes" and a trailing space. \n\n## Acceptance criteria\n1. It is read back as written.\n\n## Direction\nNone: any approach that meets the criteria.\n\n## Turnpikes\ndefault\n',
    );
    put(crlfPath, "## Problem / feature\r\nStored with CRLF line endings.\r\n");
    put(newPath, "## Problem / feature\nThe new body.\n");
    put(emptyPath, " \n\n");
    writeFileSync(bomPath, new Uint8Array([0xef, 0xbb, 0xbf, ...readFileSync(bodyPath)]));
    put(join(temp, "github.toml"), '[tracker]\nkind = "github"\n');
    put(join(temp, "plane.toml"), '[tracker]\nkind = "plane"\n');
    repo = join(temp, "repo");
    worktree = join(repo, ".worktrees", "7");
    unticketed = join(temp, "unticketed");
    if (!newRepo(repo) || !newRepo(unticketed)) throw new Error("could not make fixtures");
    mkdirSync(join(repo, "sub"), { recursive: true });
    if (run("git", ["-C", repo, "worktree", "add", "-q", worktree, "-b", "7"]).code !== 0)
      throw new Error("could not make linked worktree fixture");
    store = join(repo, ".git", "postmaster", "tickets");
    trackerStore = store;
    plain = join(temp, "plain");
    mkdirSync(plain);
  } catch (error) {
    if (temp) rmSync(temp, { recursive: true, force: true });
    restoreEnv();
    throw error;
  }
});

afterAll(() => {
  if (temp) rmSync(temp, { recursive: true, force: true });
  rmSync(baseTmp, { recursive: true, force: true });
  restoreEnv();
});

describe("negative controls: a repository with no store", () => {
  test("store says there is none, exit 3, and names store init", () => {
    check(lt(repo, "store"), 3, "store init");
  }, 30000);

  // Arguments build at run time: the fixture paths are set in beforeAll, after collection.
  for (const [label, build] of [
    ["create", () => ["create", "A title", bodyPath]],
    ["read", () => ["read", "1"]],
    ["read --body", () => ["read", "1", "--body"]],
    ["edit", () => ["edit", "1", newPath, bodyPath]],
    ["title", () => ["title", "1", "A title"]],
    ["state", () => ["state", "1", "done"]],
    ["comment", () => ["comment", "1", "postmaster", "hello"]],
    ["list", () => ["list"]],
    ["store remove", () => ["store", "remove"]],
  ] as [string, () => string[]][])
    test(`${label} exits 3`, () => {
      check(lt(repo, ...build()), 3, "no ticket store");
    }, 30000);

  test("store init from a linked worktree is refused, and names the main checkout", () => {
    check(lt(worktree, "store", "init"), 1, `main checkout, ${repo}`);
  }, 30000);

  test("and none of them made a store", () => {
    expect(existsSync(store)).toBe(false);
  }, 30000);

  test("a directory that is not a git repository exits 1", () => {
    check(lt(plain, "list"), 1, "not a git repository");
  }, 30000);
});

describe("positive controls", () => {
  test("store init from the main checkout makes the store in the repository's git directory", () => {
    refs = run("git", ["-C", repo, "for-each-ref"]).out;
    commits = run("git", ["-C", repo, "rev-list", "--all"]).out.trim().split(/\r?\n/u).length;
    check(lt(join(repo, "sub"), "store", "init"), 0, `store created: ${store}`);
  }, 30000);

  test("store init on an empty store leaves it as it was", () => {
    check(lt(repo, "store", "init"), 0, "store exists:");
  }, 30000);

  test("the main checkout, a directory in it and a linked worktree find the same store", () => {
    const same = [repo, join(repo, "sub"), worktree].every((path) => {
      const r = lt(path, "store");
      return r.code === 0 && r.out === store;
    });
    expect(same).toBe(true);
  }, 30000);

  test("create prints the new ticket's number, 1", () => {
    dayBefore = new Date().toISOString().slice(0, 10);
    const created = lt(repo, "create", "  A tracker that needs no service  ", bodyPath);
    dayAfter = new Date().toISOString().slice(0, 10);
    check(created, 0, "1");
  }, 30000);

  test("the next create prints 2", () => {
    check(lt(repo, "create", "Line endings", crlfPath), 0, "2");
  }, 30000);

  test("read --body prints the body byte for byte", () => {
    const result = invoke(repo, "read", "1", "--body");
    expect(result.code).toBe(0);
    expect(BufferLike(result.out)).toBe(BufferLike(readFileSync(bodyPath)));
  }, 30000);

  test("a CRLF body keeps its line endings", () => {
    const result = invoke(repo, "read", "2", "--body");
    expect(result.code).toBe(0);
    expect(BufferLike(result.out)).toBe(BufferLike(readFileSync(crlfPath)));
  }, 30000);

  test("read prints id, title, state, labels, created and path, a blank line, then the body", () => {
    const read1 = lt(repo, "read", "1");
    const head = read1.out.split("\n").slice(0, 7).join("|");
    expect(read1.code).toBe(0);
    expect([
      `id: #1|title: A tracker that needs no service|state: todo|labels: |created: ${dayBefore}|path: ${store}/1.md|`,
      `id: #1|title: A tracker that needs no service|state: todo|labels: |created: ${dayAfter}|path: ${store}/1.md|`,
    ]).toContain(head);
    expect(bodyline(read1.out)).toBe("## Problem / feature");
  }, 30000);

  test("a linked worktree and a subdirectory read the same ticket", () => {
    const fromWorktree = lt(worktree, "read", "1");
    const fromSubdir = lt(join(repo, "sub"), "read", "1");
    expect(fromWorktree.code).toBe(0);
    expect(fromSubdir.out).toBe(fromWorktree.out);
  }, 30000);

  test("a state set from a linked worktree is the state the main checkout reads", () => {
    lt(worktree, "state", "1", "in-progress");
    expect(lt(repo, "read", "1").out).toContain("state: in-progress");
  }, 30000);

  test("comment adds one dated line to the log, actor first, on one line", () => {
    const comment = lt(join(repo, "sub"), "comment", "1", "coachman", "Harvested both\nlanes.");
    const commentRead = lt(repo, "read", "1");
    const commentLine =
      /#1: [0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2} coachman: Harvested both lanes\./u;
    const loggedLine =
      /^- [0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2} coachman: Harvested both lanes\.$/u;
    expect(commentLine.test(comment.out)).toBe(true);
    expect(commentRead.out.split("\n").some((line) => loggedLine.test(line))).toBe(true);
  }, 30000);

  test("edit against the body as read replaces it", () => {
    const result = invoke(repo, "read", "1", "--body");
    put(join(temp, "base.md"), result.out);
    check(lt(repo, "edit", "1", newPath, join(temp, "base.md")), 0, "#1: edited");
  }, 30000);

  test("the body is the new one, and the title and state are as they were", () => {
    const updatedBody = invoke(repo, "read", "1", "--body").out;
    const updatedRead = lt(repo, "read", "1");
    expect(BufferLike(updatedBody)).toBe(BufferLike(readFileSync(newPath)));
    expect(updatedRead.out).toContain("title: A tracker that needs no service");
    expect(updatedRead.out).toContain("state: in-progress");
  }, 30000);

  test("a base that differs only in line endings and trailing spaces matches", () => {
    put(join(temp, "base-crlf.md"), "## Problem / feature  \r\nThe new body.  \r\n\r\n");
    check(lt(repo, "edit", "1", newPath, join(temp, "base-crlf.md")), 0, "#1: edited");
  }, 30000);

  test("title replaces the title", () => {
    check(lt(repo, "title", "1", "  Tickets with no service  "), 0, "#1: title changed");
  }, 30000);

  test("and leaves the body and state as they were", () => {
    const result = invoke(repo, "read", "1", "--body");
    const titled = lt(repo, "read", "1");
    expect(titled.out).toContain("title: Tickets with no service");
    expect(titled.out).toContain("state: in-progress");
    expect(BufferLike(result.out)).toBe(BufferLike(readFileSync(newPath)));
  }, 30000);

  test("list groups every ticket by state, in the flow's order, then by number", () => {
    lt(repo, "create", "Blocked one", bodyPath);
    lt(repo, "state", "3", "blocked");
    lt(repo, "create", "Done one", bodyPath);
    lt(repo, "state", "4", "done");
    lt(repo, "create", "Cancelled one", bodyPath);
    lt(repo, "state", "5", "cancelled");
    lt(repo, "create", "Another todo", bodyPath);
    lt(repo, "state", "2", "done");
    const wantList =
      "#6\ttodo\tAnother todo\n#1\tin-progress\tTickets with no service\n#3\tblocked\tBlocked one\n#2\tdone\tLine endings\n#4\tdone\tDone one\n#5\tcancelled\tCancelled one";
    const listAll = lt(repo, "list");
    expect(listAll.code).toBe(0);
    expect(listAll.out).toBe(wantList);
  }, 30000);

  test("list <state> lists only that state", () => {
    const listDone = lt(repo, "list", "done");
    expect(listDone.code).toBe(0);
    expect(listDone.out).toBe("#2\tdone\tLine endings\n#4\tdone\tDone one");
  }, 30000);

  test("store init on a store holding tickets changes none of them", () => {
    const beforeInit = snapshot(store);
    const initAgain = lt(repo, "store", "init");
    const listedAgain = lt(repo, "list");
    const wantList =
      "#6\ttodo\tAnother todo\n#1\tin-progress\tTickets with no service\n#3\tblocked\tBlocked one\n#2\tdone\tLine endings\n#4\tdone\tDone one\n#5\tcancelled\tCancelled one";
    expect(snapshot(store)).toBe(beforeInit);
    expect(listedAgain.out).toBe(wantList);
    expect(initAgain.out).toContain("store exists:");
  }, 30000);

  test("create drops a body's byte-order mark", () => {
    const made = lt(repo, "create", "With a byte-order mark", bomPath);
    bomNumber = made.out;
    const bomRead = invoke(repo, "read", bomNumber, "--body");
    const bomHeader = lt(repo, "read", bomNumber);
    expect(BufferLike(bomRead.out)).toBe(BufferLike(readFileSync(bodyPath)));
    expect(bodyline(bomHeader.out)).toBe("## Problem / feature");
  }, 30000);

  test("read shows the first heading of a body that gained a byte-order mark", () => {
    writeFileSync(
      ticketPath(store, BigInt(bomNumber), "md"),
      new Uint8Array([0xef, 0xbb, 0xbf, ...readFileSync(bodyPath)]),
    );
    expect(bodyline(lt(repo, "read", bomNumber).out)).toBe("## Problem / feature");
  }, 30000);

  test("BASE local.sh extracts with its strict ticket read", () => {
    expect(baseLocal !== "").toBe(true);
  }, 30000);

  test.skipIf(noBaseReplay)(
    "a 0xff byte in a title refuses the ticket on both sides, as BASE does",
    () => {
      const bad = lt(repo, "create", "healthy title", bodyPath);
      const badJson = ticketPath(store, BigInt(bad.out), "json");
      writeFileSync(
        badJson,
        Buffer.from(
          readFileSync(badJson, "utf8").replace("healthy title", "health\u00ff title"),
          "latin1",
        ),
      );
      const portList = lt(repo, "list");
      const baseRun = run("bash", [baseLocal, repo, "list"]);
      const baseList = output(baseRun);
      const baseCode = baseRun.code;
      expect(portList.code).toBe(1);
      expect(baseCode).toBe(1);
      expect(portList.out).toContain("not valid JSON");
      expect(baseList).toContain("not valid JSON");
      expect(portList.out).not.toContain("health");
      expect(baseList).not.toContain("health");
    },
    30000,
  );

  test("create takes its body from /dev/stdin", () => {
    const stdinCreate = run(self, ["local", repo, "create", "From a pipe", "/dev/stdin"], {
      input: readFileSync(bodyPath, "utf8"),
    });
    const stdinRead = invoke(repo, "read", stdinCreate.out.trim(), "--body");
    expect(stdinCreate.code).toBe(0);
    expect(BufferLike(stdinRead.out)).toBe(BufferLike(readFileSync(bodyPath)));
    put(join(temp, "stdin-number"), stdinCreate.out.trim());
  }, 30000);

  test("edit takes its body from /dev/stdin", () => {
    const created = readFileSync(join(temp, "stdin-number"), "utf8");
    const stdinBase = invoke(repo, "read", created, "--body");
    put(join(temp, "stdin-base.md"), stdinBase.out);
    const stdinEdit = run(
      self,
      ["local", repo, "edit", created, "/dev/stdin", join(temp, "stdin-base.md")],
      { input: readFileSync(newPath, "utf8") },
    );
    const afterStdin = invoke(repo, "read", created, "--body");
    expect(stdinEdit.code).toBe(0);
    expect(BufferLike(afterStdin.out)).toBe(BufferLike(readFileSync(newPath)));
  }, 30000);

  test("edit takes its base from /dev/stdin", () => {
    const created = readFileSync(join(temp, "stdin-number"), "utf8");
    const stdinReadForBase = invoke(repo, "read", created, "--body");
    const baseEdit = run(self, ["local", repo, "edit", created, bodyPath, "/dev/stdin"], {
      input: stdinReadForBase.out,
    });
    expect(baseEdit.code).toBe(0);
  }, 30000);

  test("no ticket is in a working tree, on a branch or in a commit", () => {
    const cleanTree =
      run("git", ["-C", repo, "status", "--porcelain", "--ignored=no"]).out.trim() === "";
    const refsAfter = run("git", ["-C", repo, "for-each-ref"]).out;
    const commitsAfter = run("git", ["-C", repo, "rev-list", "--all"])
      .out.trim()
      .split(/\r?\n/u).length;
    const wtClean = run("git", ["-C", worktree, "status", "--porcelain"]).out.trim() === "";
    expect(cleanTree).toBe(true);
    expect(refsAfter).toBe(refs);
    expect(commitsAfter).toBe(commits);
    expect(wtClean).toBe(true);
  }, 30000);

  test("ten creates at once get ten different numbers", async () => {
    const concurrent = join(temp, "concurrent");
    if (!newRepo(concurrent) || invoke(concurrent, "store", "init").code !== 0)
      throw new Error("could not make concurrency fixture");
    const children = Array.from({ length: 10 }, (_, index) =>
      Bun.spawn([self, "local", concurrent, "create", `Ticket ${index + 1}`, bodyPath], {
        stdout: "pipe",
        stderr: "pipe",
      }),
    );
    const childResults = await Promise.all(
      children.map(async (child: any) => ({
        code: await child.exited,
        out: await new Response(child.stdout).text(),
      })),
    );
    const ids = childResults.map((child) => Number(child.out.trim())).sort((a, b) => a - b);
    const concurrentList = run(self, ["local", concurrent, "list"]);
    expect(childResults.every((child) => child.code === 0)).toBe(true);
    expect(ids.join(" ")).toBe("1 2 3 4 5 6 7 8 9 10");
    expect(concurrentList.out.trim().split("\n").length).toBe(10);
  }, 30000);

  test("a title with a literal U+FFFD is valid UTF-8", () => {
    const ufd = join(temp, "ufd");
    if (!newRepo(ufd) || invoke(ufd, "store", "init").code !== 0)
      throw new Error("could not make U+FFFD fixture");
    check(lt(ufd, "create", "caf\ufffd", bodyPath), 0, "1");
  }, 30000);

  test("a lock whose owner is alive is never reaped, whatever its age", async () => {
    const livelock = join(temp, "livelock");
    if (!newRepo(livelock) || invoke(livelock, "store", "init").code !== 0)
      throw new Error("could not make live-lock fixture");
    const liveLock = join(livelock, ".git", "postmaster", "tickets", ".lock");
    writeFileSync(liveLock, `${process.pid}\n`);
    const aged = new Date(Date.now() - 61000);
    utimesSync(liveLock, aged, aged);
    const waiter = Bun.spawn([self, livelock, "create", "Live holder keeps its lock", bodyPath], {
      stdout: "ignore",
      stderr: "ignore",
    });
    await new Promise((resolve) => setTimeout(resolve, 3000));
    // Still waiting, not exited: a waiter that never ran would pass kept vacuously.
    const status = await Promise.race([
      waiter.exited.then((code) => code as number | "waiting"),
      Promise.resolve("waiting" as const),
    ]);
    let kept = false;
    try {
      kept = readFileSync(liveLock, "utf8").trim() === String(process.pid);
    } catch {
      kept = false;
    }
    waiter.kill(9);
    await waiter.exited;
    rmSync(liveLock, { force: true });
    expect(kept).toBe(true);
    expect(status).toBe("waiting");
  }, 30000);
});

describe("controls: what the caller's environment must not change", () => {
  test("a GIT_DIR from the caller does not steer it to another repository", () => {
    const mine = lt(repo, "store").out;
    const diverted = run(self, ["local", repo, "store"], {
      env: {
        GIT_DIR: join(unticketed, ".git"),
        GIT_WORK_TREE: unticketed,
        GIT_INDEX_FILE: join(unticketed, ".git", "index"),
      },
    });
    const other = join(temp, "other");
    newRepo(other);
    run(self, ["local", other, "store", "init"], {
      env: { GIT_DIR: join(unticketed, ".git"), GIT_WORK_TREE: unticketed },
    });
    expect(diverted.code).toBe(0);
    expect(output(diverted)).toBe(mine);
    expect(existsSync(join(other, ".git", "postmaster", "tickets"))).toBe(true);
    expect(existsSync(join(unticketed, ".git", "postmaster"))).toBe(false);
  }, 30000);

  test("an exported CDPATH does not move a relative <repo>", () => {
    const cdp = run(self, ["local", "repo", "store"], {
      cwd: temp,
      env: { CDPATH: ".:/nonexistent" },
    });
    expect(cdp.code).toBe(0);
    expect(cdp.out.trim()).toBe(store);
  }, 30000);

  test("a symlink to a directory in the repository finds its store, not the store of the repository holding the link", () => {
    const symlinkRepo = join(temp, "shadow-link");
    newRepo(symlinkRepo);
    symlinkSync(join(repo, "sub"), join(symlinkRepo, "link"));
    const throughLink = invoke(join(symlinkRepo, "link"), "store");
    invoke(join(symlinkRepo, "link"), "store", "init");
    expect(throughLink.code).toBe(0);
    expect(throughLink.out.trim()).toBe(store);
    expect(existsSync(join(symlinkRepo, ".git", "postmaster"))).toBe(false);
  }, 30000);

  test("modules in the target's own directory are never imported", () => {
    const shadow = join(temp, "shadowing");
    newRepo(shadow);
    run(self, ["local", shadow, "store", "init"]);
    run(self, ["local", shadow, "create", "Shadowed", bodyPath]);
    mkdirSync(join(shadow, "json"));
    for (const name of ["signal", "re", "contextlib", "datetime", "tomllib", "json/__init__"])
      put(
        join(shadow, `${name}.py`),
        `open('${join(temp, "imported")}', 'a').write('${name}\\n')\nraise SystemExit(9)\n`,
      );
    const shadowList = run(self, ["local", ".", "list"], { cwd: shadow });
    const discovered = run(join(here, "run"), ["discover-project", "."], {
      cwd: shadow,
      env: { POSTMASTER_CONFIG: join(temp, "github.toml") },
    });
    const shadowKind = discovered.out.match(/^tracker=(.*)$/mu)?.[1];
    const otherKind = run(join(here, "run"), ["tracker-kind", unticketed], {
      cwd: shadow,
      env: { POSTMASTER_CONFIG: join(temp, "github.toml") },
    });
    expect(shadowList.code).toBe(0);
    expect(shadowKind).toBe("local");
    expect(otherKind.out.trim()).toBe("github");
    expect(existsSync(join(temp, "imported"))).toBe(false);
    expect(existsSync(join(shadow, "__pycache__"))).toBe(false);
  }, 30000);
});

describe("negative controls: nothing is written", () => {
  beforeAll(() => {
    const currentBase = invoke(repo, "read", "1", "--body");
    put(join(temp, "base.md"), currentBase.out);
    put(join(temp, "stale.md"), "## Problem / feature\nChanged in the store since.\n");
  });

  test("a base the ticket no longer matches exits 4", () => {
    refused(4, "#1 changed since", repo, "edit", "1", bodyPath, join(temp, "stale.md"));
  }, 30000);

  test("an empty body file exits 1", () => {
    refused(1, "is empty", repo, "edit", "1", emptyPath, join(temp, "base.md"));
  }, 30000);

  test("a missing base file exits 1", () => {
    refused(1, "cannot read base file", repo, "edit", "1", bodyPath, join(temp, "nowhere.md"));
  }, 30000);

  test("the form with a title is a usage error", () => {
    refused(1, "usage:", repo, "edit", "1", "A title", bodyPath);
  }, 30000);

  test("edit on an unknown ticket exits 1", () => {
    refused(1, "no ticket #99", repo, "edit", "99", bodyPath, join(temp, "base.md"));
  }, 30000);

  test("an invalid state exits 2", () => {
    refused(2, "invalid state", repo, "state", "1", "finished");
  }, 30000);

  test("state on an unknown ticket exits 1", () => {
    refused(1, "no ticket #99", repo, "state", "99", "done");
  }, 30000);

  test("a comment on an unknown ticket exits 1", () => {
    refused(1, "no ticket #99", repo, "comment", "99", "coachman", "hello");
  }, 30000);

  test("a comment that is not UTF-8 exits 1", () => {
    refusedRaw(
      1,
      "comment is not UTF-8",
      repo,
      "na\\357ve",
      "comment",
      "1",
      "coachman",
      "<RAW-BYTES>",
    );
  }, 30000);

  test("an actor that is not UTF-8 exits 1", () => {
    refusedRaw(
      1,
      "actor is not UTF-8",
      repo,
      "r\\351viewer",
      "comment",
      "1",
      "<RAW-BYTES>",
      "hello",
    );
  }, 30000);

  test("create with an empty body exits 1", () => {
    refused(1, "is empty", repo, "create", "A title", emptyPath);
  }, 30000);

  test("create with an empty title exits 1", () => {
    refused(1, "title is empty", repo, "create", "  ", bodyPath);
  }, 30000);

  test("create with a title of two lines exits 1", () => {
    refused(1, "more than one line", repo, "create", "Two\nlines", bodyPath);
  }, 30000);

  test("create with a title that is not UTF-8 exits 1", () => {
    refusedRaw(1, "title is not UTF-8", repo, "caf\\351", "create", "<RAW-BYTES>", bodyPath);
  }, 30000);

  test("title with an empty title exits 1", () => {
    refused(1, "title is empty", repo, "title", "1", " ");
  }, 30000);

  test("title with two lines exits 1", () => {
    refused(1, "more than one line", repo, "title", "1", "Two\nlines");
  }, 30000);

  test("title that is not UTF-8 exits 1", () => {
    refusedRaw(1, "title is not UTF-8", repo, "\\377", "title", "1", "<RAW-BYTES>");
  }, 30000);

  test("title on an unknown ticket exits 1", () => {
    refused(1, "no ticket #99", repo, "title", "99", "A title");
  }, 30000);

  test("something that is not a number exits 1", () => {
    refused(1, "not a ticket number", repo, "read", "PM-1");
  }, 30000);

  test("an unknown ticket exits 1", () => {
    refused(1, "no ticket #99", repo, "read", "99");
  }, 30000);

  test("list with an invalid state exits 2", () => {
    refused(2, "invalid state", repo, "list", "finished");
  }, 30000);

  test("store init from a linked worktree is refused where a store exists too", () => {
    refused(1, "never from a linked worktree", worktree, "store", "init");
  }, 30000);

  test("store remove from a linked worktree exits 1", () => {
    refused(1, "never from a linked worktree", worktree, "store", "remove");
  }, 30000);

  test("store remove on a store holding tickets exits 1", () => {
    refused(1, "removed only when it holds none", repo, "store", "remove");
  }, 30000);

  test("no command called gh", () => {
    expect(existsSync(ghLog)).toBe(false);
  }, 30000);
});

describe("controls: a ticket file that is not as this script writes it", () => {
  const damaged = () => join(temp, "damaged");
  const damagedStore = () => join(damaged(), ".git", "postmaster", "tickets");

  test("list prints the tickets it can read, names the one it cannot, and exits 1", () => {
    newRepo(damaged());
    run(self, ["local", damaged(), "store", "init"]);
    for (const title of ["One", "Two", "Three"])
      run(self, ["local", damaged(), "create", title, bodyPath]);
    copyFileSync(join(damagedStore(), "2.json"), join(temp, "2.json"));
    put(join(damagedStore(), "2.json"), '{"title": "Two", "state": "todo",\n');
    const damagedList = run(self, ["local", damaged(), "list"]);
    expect(damagedList.code).toBe(1);
    expect(damagedList.out.trim()).toBe("#1\ttodo\tOne\n#3\ttodo\tThree");
    expect(damagedList.err).toContain("ticket #2");
  }, 30000);

  test("a log that is not a list is refused, not split into characters", () => {
    writeFileSync(
      join(damagedStore(), "2.json"),
      new Uint8Array([0xef, 0xbb, 0xbf, ...readFileSync(join(temp, "2.json"))]),
    );
    const threeMetaPath = join(damagedStore(), "3.json");
    const damagedMeta = JSON.parse(readFileSync(threeMetaPath, "utf8"));
    damagedMeta.log = "a line";
    put(threeMetaPath, JSON.stringify(damagedMeta));
    const beforeComment = snapshot(damagedStore());
    const badLog = lt(damaged(), "comment", "3", "coachman", "hello");
    expect(badLog.code).toBe(1);
    expect(badLog.out).toContain("log is not a list");
    expect(snapshot(damagedStore())).toBe(beforeComment);
  }, 30000);

  test("labels that are not a list are refused", () => {
    const threeMetaPath = join(damagedStore(), "3.json");
    const damagedMeta = JSON.parse(readFileSync(threeMetaPath, "utf8"));
    damagedMeta.log = [];
    damagedMeta.labels = "bug";
    put(threeMetaPath, JSON.stringify(damagedMeta));
    check(lt(damaged(), "read", "3"), 1, "labels is not a list");
  }, 30000);

  test("a ticket file saved with a byte-order mark still reads", () => {
    const threeMetaPath = join(damagedStore(), "3.json");
    const damagedMeta = JSON.parse(readFileSync(threeMetaPath, "utf8"));
    damagedMeta.labels = [];
    put(threeMetaPath, JSON.stringify(damagedMeta));
    const repairedList = lt(damaged(), "list");
    expect(repairedList.code).toBe(0);
    expect(repairedList.out).toBe("#1\ttodo\tOne\n#2\ttodo\tTwo\n#3\ttodo\tThree");
  }, 30000);
});

describe("controls: store init and store remove, from the main checkout only", () => {
  test("a lane's worktree cannot make its repository a store", () => {
    const guarded = join(temp, "guarded");
    newRepo(guarded);
    run("git", [
      "-C",
      guarded,
      "worktree",
      "add",
      "-q",
      join(guarded, ".worktrees/lane"),
      "-b",
      "lane",
    ]);
    const laneInit = invoke(join(guarded, ".worktrees/lane"), "store", "init");
    expect(laneInit.code).toBe(1);
    expect(existsSync(join(guarded, ".git", "postmaster"))).toBe(false);
    put(join(temp, "guarded-path"), guarded);
  }, 30000);

  test("store remove on a store that holds no ticket removes it", () => {
    const guarded = readFileSync(join(temp, "guarded-path"), "utf8");
    invoke(guarded, "store", "init");
    check(lt(guarded, "store", "remove"), 0, "store removed:");
  }, 30000);

  test("and the repository is back on the config's kind", () => {
    const guarded = readFileSync(join(temp, "guarded-path"), "utf8");
    const afterRemoval = run(join(here, "run"), ["tracker-kind", guarded], {
      env: { POSTMASTER_CONFIG: join(temp, "github.toml") },
    });
    expect(afterRemoval.code).toBe(0);
    expect(afterRemoval.out.trim()).toBe("github");
  }, 30000);
});

describe("controls: a repository whose store exists uses this tracker, whatever the config names", () => {
  test("discover-project.sh names local for it and its worktree, with a config naming github", () => {
    expect(tracker(join(temp, "github.toml"), repo)).toBe("local");
    expect(tracker(join(temp, "github.toml"), worktree)).toBe("local");
  }, 30000);

  test("a repository with no store gets the config's kind, and none without a config", () => {
    expect(tracker(join(temp, "github.toml"), unticketed)).toBe("github");
    expect(tracker(join(temp, "plane.toml"), unticketed)).toBe("plane");
    expect(tracker(join(temp, "home/no-config.toml"), unticketed)).toBe("");
  }, 30000);

  test("a store that cannot be looked for is not taken for no store", () => {
    const trackerPlain = run(join(here, "run"), ["tracker-kind", plain], {
      env: { POSTMASTER_CONFIG: join(temp, "github.toml") },
    });
    expect(trackerPlain.code).toBe(1);
    expect(trackerPlain.err).toContain("not a git repository");
    expect(tracker(join(temp, "github.toml"), plain)).toBe("");
  }, 30000);

  test("a relative POSTMASTER_CONFIG is read from the caller's directory", () => {
    const relativeConfig = run(join(here, "run"), ["discover-project", unticketed], {
      cwd: temp,
      env: { POSTMASTER_CONFIG: "plane.toml" },
    });
    expect(relativeConfig.out.match(/^tracker=(.*)$/mu)?.[1]).toBe("plane");
  }, 30000);

  test("with HOME unset, discover-project.sh still reports, with the kind left to ask", () => {
    const noHome = run(join(here, "run"), ["discover-project", unticketed], {
      env: { HOME: undefined, POSTMASTER_CONFIG: undefined },
    });
    expect(noHome.code).toBe(0);
    expect(/^tracker=$/mu.test(noHome.out)).toBe(true);
    expect(/^gate=/mu.test(noHome.out)).toBe(true);
  }, 30000);

  test("discover-project.sh run by a relative path with CDPATH exported still finds the rule", () => {
    const relativePath = run(join(import.meta.dir, "run"), ["discover-project", repo], {
      cwd: dirname(here),
      env: { CDPATH: ".:/nonexistent", POSTMASTER_CONFIG: join(temp, "github.toml") },
    });
    expect(relativePath.out.match(/^tracker=(.*)$/mu)?.[1]).toBe("local");
  }, 30000);

  test("a github target with no origin remote is pointed at store init, and one with a remote is not", () => {
    const noRemoteErr = join(temp, "err");
    const hostedErr = join(temp, "err-hosted");
    const noRemote = run(join(here, "run"), ["discover-project", unticketed], {
      env: { POSTMASTER_CONFIG: join(temp, "github.toml") },
    });
    writeFileSync(noRemoteErr, noRemote.err);
    const hosted = join(temp, "hosted");
    newRepo(hosted);
    run("git", ["-C", hosted, "remote", "add", "origin", "https://github.com/o/r.git"]);
    const hasRemote = run(join(here, "run"), ["discover-project", hosted], {
      env: { POSTMASTER_CONFIG: join(temp, "github.toml") },
    });
    writeFileSync(hostedErr, hasRemote.err);
    expect(readFileSync(noRemoteErr, "utf8")).toContain("store init");
    expect(readFileSync(hostedErr, "utf8")).not.toContain("store init");
  }, 30000);

  test("ticket-check.sh reads tickets through this store with a config naming github, a byte-order mark aside", () => {
    const ticketCheck = run(join(here, "run"), ["ticket-check", repo, "3"], {
      env: { POSTMASTER_CONFIG: join(temp, "github.toml") },
    });
    const ticketCheckSeven = run(join(here, "run"), ["ticket-check", repo, "7"], {
      env: { POSTMASTER_CONFIG: join(temp, "github.toml") },
    });
    expect(ticketCheck.code).toBe(0);
    expect(ticketCheck.out).toContain("well-formed");
    expect(ticketCheckSeven.code).toBe(0);
    expect(existsSync(ghLog)).toBe(false);
  }, 30000);

  test("without a store it goes to the github adapter, and the gh on PATH saw the call", () => {
    const githubCheck = run(join(here, "run"), ["ticket-check", unticketed, "3"], {
      env: { POSTMASTER_CONFIG: join(temp, "github.toml") },
    });
    expect(githubCheck.code).toBe(1);
    expect(output(githubCheck)).toContain("github adapter");
    expect(existsSync(ghLog)).toBe(true);
  }, 30000);
});

// Identifiers both sides compute and read: the next ticket number counts .json and .md
// but never .tmp, unfinished writes clean up by BASE's exact name, and the metadata
// round-trips byte for byte in both directions. Goldens captured once, on 2026-09-29;
// the BASE-side dump regenerates under python3 -c with:
//   "import json,sys; json.dump({'title':'BASE sides ☃','state':'todo','labels':[],'created':'2026-01-02T03:04:05Z','log':[]}, open(sys.argv[1],'w'), indent=2, ensure_ascii=False)"
describe("identifiers both sides compute and read", () => {
  test("the next number counts .json and .md past leading zeros, never .tmp", () => {
    const idStore = join(temp, "ids");
    mkdirSync(idStore, { recursive: true });
    for (const n of ["1.json", "007.json", "2.md", "3.json.99999.tmp", "README", ".lock"])
      writeFileSync(join(idStore, n), "{}\n");
    expect(String(nextNumber(idStore))).toBe("8");
  }, 30000);

  test("a ticket the port writes matches BASE's json byte for byte, non-ASCII whole", () => {
    const idRepo = join(temp, "idrepo");
    newRepo(idRepo);
    lt(idRepo, "store", "init");
    const idStoreReal = join(idRepo, ".git", "postmaster", "tickets");
    const created = lt(idRepo, "create", "snowman ☃ title", bodyPath);
    const createdN = created.code === 0 ? BigInt(created.out.trim()) : -1n;
    const wantMeta = `{
  "title": "snowman ☃ title",
  "state": "todo",
  "labels": [],
  "created": "CREATED",
  "log": []
}
`;
    const metaPath = ticketPath(idStoreReal, createdN, "json");
    const metaRaw =
      created.code === 0 && existsSync(metaPath) ? readFileSync(metaPath, "utf8") : "";
    const createdShape =
      /"created": "20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]Z"/u.test(
        metaRaw,
      );
    const metaNorm = metaRaw.replace(/"created": "[^"]*"/u, '"created": "CREATED"');
    expect(created.code).toBe(0);
    expect(createdShape).toBe(true);
    expect(metaNorm).toBe(wantMeta);
    put(join(temp, "idrepo-path"), idRepo);
  }, 30000);

  test("a ticket BASE's exact dump writes reads under the port", () => {
    const idRepo = readFileSync(join(temp, "idrepo-path"), "utf8");
    const idStoreReal = join(idRepo, ".git", "postmaster", "tickets");
    const baseDump = `{
  "title": "BASE sides ☃",
  "state": "todo",
  "labels": [],
  "created": "2026-01-02T03:04:05Z",
  "log": []
}`;
    writeFileSync(join(idStoreReal, "9.json"), baseDump);
    writeFileSync(join(idStoreReal, "9.md"), "BASE body\n");
    const readNine = lt(idRepo, "read", "9");
    expect(readNine.code).toBe(0);
    expect(readNine.out).toContain("BASE sides ☃");
  }, 30000);

  test("unfinished writes by BASE's exact tmp name clean up on store remove", () => {
    const emptyRepo = join(temp, "emptyrepo");
    newRepo(emptyRepo);
    lt(emptyRepo, "store", "init");
    const emptyStore = join(emptyRepo, ".git", "postmaster", "tickets");
    writeFileSync(join(emptyStore, "1.json.12345.tmp"), "leftover\n");
    writeFileSync(join(emptyStore, "2.md.678.tmp"), "leftover\n");
    const removed = lt(emptyRepo, "store", "remove");
    expect(removed.code).toBe(0);
    expect(removed.out).toContain("store removed");
  }, 30000);
});

// Unicode-primitive vectors: BASE's run local embeds Python (re.fullmatch \d, int(),
// " ".join(s.split())); the port must match on non-ASCII input.
describe("unicode-primitive vectors", () => {
  test("oneLine splits U+001C like Python split", () => {
    expect(oneLine("a\x1cb")).toBe("a b");
  }, 30000);

  test("oneLine splits U+0085 like Python split", () => {
    expect(oneLine("a\u0085b")).toBe("a b");
  }, 30000);

  test("oneLine keeps U+FEFF like Python split", () => {
    expect(oneLine("a\ufeffb")).toBe("a\ufeffb");
  }, 30000);

  test("NUMBER_RE takes an Arabic-Indic tail like BASE", () => {
    expect(NUMBER_RE.test("#1\u0662\u0663")).toBe(true);
  }, 30000);

  test("NUMBER_RE still wants an ASCII first digit", () => {
    expect(NUMBER_RE.test("#\u0661\u0662")).toBe(false);
  }, 30000);

  test("numberArg reads an Arabic-Indic tail like int()", () => {
    let ndNum: bigint | null = null;
    try {
      ndNum = numberArg("#1\u0662\u0663");
    } catch {
      ndNum = null;
    }
    expect(ndNum).toBe(123n);
  }, 30000);

  test("STORE_FILE_RE takes an Arabic-Indic name like BASE", () => {
    expect(STORE_FILE_RE.test("1\u0662\u0663.json")).toBe(true);
  }, 30000);

  test("STORE_TMP_RE takes an Arabic-Indic tmp like BASE", () => {
    expect(STORE_TMP_RE.test("1\u0662\u0663.json.4\u0665.tmp")).toBe(true);
  }, 30000);
});

describe("fetch-proxy snapshot regression", () => {
  // restoreEnv must clear Bun's fetch-proxy snapshot, not just process.env:
  // Bun 1.4.2 snapshots proxy variables on assignment and a bare delete
  // never clears the snapshot, so without the empty assignment a later
  // file's fetch in this process uses this suite's dead proxy (plane's
  // stalled-API control fails instant-refused instead of timing out).
  test.skipIf(outerProxy !== undefined)(
    "restoreEnv leaves fetch direct",
    async () => {
      const current = new Map<string, string | undefined>();
      for (const key of oldEnv.keys()) current.set(key, process.env[key]);
      process.env.HTTP_PROXY = "http://127.0.0.1:9";
      try {
        restoreEnv();
        const held: Array<{ destroy: () => void }> = [];
        const stall = createServer((sock) => {
          held.push(sock);
          sock.on("error", () => {});
        });
        await new Promise<void>((resolve) => stall.listen(0, "127.0.0.1", () => resolve()));
        const port = (stall.address() as { port: number }).port;
        let name = "";
        try {
          await fetch(`http://127.0.0.1:${port}/x`, { signal: AbortSignal.timeout(2000) });
        } catch (e) {
          name = (e as Error).name;
        } finally {
          for (const sock of held) sock.destroy();
          await new Promise<void>((resolve) => stall.close(() => resolve()));
        }
        // Connected, then cut off: Bun says TimeoutError, Node AbortError.
        // A TypeError here is the snapshot bug back again (refused via proxy).
        expect(name === "AbortError" || name === "TimeoutError").toBe(true);
      } finally {
        for (const [key, value] of current) {
          if (value === undefined) {
            process.env[key] = "";
            delete process.env[key];
          } else process.env[key] = value;
        }
      }
    },
    30000,
  );
});

describe("store lock beside the bash flow", () => {
  test("an empty .lock left by the bash flow does not stall a write", () => {
    // The bash flow's resting state: flock on the fd, never written, never removed.
    writeFileSync(join(store, ".lock"), "");
    const t0 = Date.now();
    const r = lt(repo, "comment", "1", "coachman", "lock probe");
    expect(Date.now() - t0).toBeLessThan(30000);
    check(r, 0, "#1:");
  }, 120000);
});
