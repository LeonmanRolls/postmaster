// Tests beside scripts/github.ts, moved from its --self-test on #109: 29 controls.
// Each CLI test rewrites the stub state it needs, so it passes alone as well as in file order.
// Failure-only byte dumps (catA) are dropped: expect() shows the mismatch itself.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pyLower } from "./lib/text.ts";
import { DATE_PREFIX_RE, NONWORD_RE, NUMBER_RE } from "./github";

const SELF = join(import.meta.dir, "github.sh");
const BOARD =
  '{"data": {"repository": {"projectsV2": {"nodes": [{"id": "PVT_1", "number": 1, ' +
  '"title": "r", "closed": false, "url": "https://github.com/users/o/projects/1", ' +
  '"owner": {"login": "o"}}]}}}}';
const TWO_CHOSEN =
  '{"data":{"repository":{"projectsV2":{"nodes":[' +
  '{"id":"PVT_1","number":1,"title":"r","closed":false,' +
  '"url":"https://github.com/users/o/projects/1","owner":{"login":"o"}},' +
  '{"id":"PVT_2","number":2,"title":"chosen","closed":false,' +
  '"url":"https://github.com/users/o/projects/2","owner":{"login":"o"}}]}}}}';
const TWO_DUP =
  '{"data":{"repository":{"projectsV2":{"nodes":[' +
  '{"id":"PVT_1","number":1,"title":"dup","closed":false,' +
  '"url":"https://github.com/users/o/projects/1","owner":{"login":"o"}},' +
  '{"id":"PVT_2","number":2,"title":"dup","closed":false,' +
  '"url":"https://github.com/users/o/projects/2","owner":{"login":"o"}}]}}}}';
const NO_BOARDS = '{"data": {"repository": {"projectsV2": {"nodes": []}}}}';
const ITEMS =
  '{"items": [{"id": "PVTI_7", "status": "Todo", "content": {"type": "Issue", ' +
  '"number": 7, "repository": "o/r"}}]}';
const FIELDS_JSON =
  '{"fields": [{"id": "F1", "name": "Status", "options": [{"id": "o1", "name": "Todo"}, ' +
  '{"id": "o2", "name": "In Progress"}, {"id": "o3", "name": "Done"}]}]}';
const NO_TODO_FIELDS =
  '{"fields": [{"id": "F1", "name": "Status", "options": [{"id": "o1", "name": "Backlog"}, ' +
  '{"id": "o3", "name": "Done"}]}]}';
const ACCESS_ADMIN = '{"data": {"repository": {"viewerPermission": "ADMIN"}}}';
const ACCESS_READ = '{"data": {"repository": {"viewerPermission": "READ"}}}';
const ACCESS_NONE = '{"data": {"repository": null}}';
const SEARCH_JSON =
  '[{"number": 9, "title": "Later", "state": "CLOSED"}, ' +
  '{"number": 4, "title": "Earlier", "state": "OPEN"}]';
const LF_MD =
  "## Problem / feature\n" +
  'A body with `code`, "quotes" and a trailing space. \n' +
  "\n## Direction\nNone.";
const CRLF_MD =
  "## Problem / feature\r\nStored with CRLF line endings.\r\n" + "\r\n## Direction\r\nNone.\r\n";
const NEW_MD =
  "## Problem / feature\nThe new body.\n\n## Direction\n" +
  "None: any approach that meets the criteria.\n";
const STALE_MD = "## Problem / feature\nChanged in the tracker since.\n";

// A stub gh first on PATH: it answers the queries from canned files and records every issue
// edit, so nothing reaches GitHub.
const STUB_GH = `#!/usr/bin/env bash
d=$GITHUB_SH_STUB
case "$1 $2" in
  "auth status") exit 0 ;;
  "api graphql")
    q="" n=""
    for a in "$@"; do case $a in query=*) q=$a ;; number=*) n=\${a#number=} ;; esac; done
    case $q in
      *projectsV2*) cat "$d/boards.json" ;;
      *viewerPermission*) cat "$d/access.json" ;;
      *"issue(number:"*) if [ -f "$d/issue-$n.json" ]; then cat "$d/issue-$n.json"
                         else echo '{"data": {"repository": {"issue": null}}}'; fi ;;
      *) echo "stub gh: unexpected query" >&2; exit 1 ;;
    esac ;;
  "project item-list") cat "$d/items.json" ;;
  "project field-list") cat "$d/fields.json" ;;
  "project item-add") if [ -f "$d/no-item-add" ]; then \\
    echo "stub gh: item-add refused" >&2; exit 1; fi
                      echo '{"id": "PVTI_new"}' ;;
  "project item-edit") exit 0 ;;
  "issue create") printf 'create\\n' >> "$d/creates.log"; echo "https://github.com/o/r/issues/60";;
  "search issues") printf '%s\\n' "$*" >> "$d/searches.log"; cat "$d/search.json" ;;
  "issue edit")
    f="" prev=""
    for a in "$@"; do [ "$prev" = --body-file ] && f=$a; prev=$a; done
    printf 'call:%s\\n' "$(printf ' [%s]' "$@")" >> "$d/edits.log"
    cp -- "$f" "$d/edited-body" ;;
  *) echo "stub gh: unexpected: $*" >&2; exit 1 ;;
esac
`;

let tmp = "";
let S = "";
let bin = "";
let repo = "";

function ghSh(args: string[]): { code: number; out: string; err: string } {
  const r = spawnSync("bash", [SELF, repo, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      GITHUB_SH_STUB: S,
    },
  });
  return { code: r.status ?? -1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

function stored(n: number, file: string): void {
  const body = readFileSync(file, "utf8");
  const obj = {
    data: {
      repository: {
        issue: {
          number: n,
          title: "Check a ticket's shape",
          body,
          state: "OPEN",
          stateReason: null,
          url: `https://github.com/o/r/issues/${n}`,
          createdAt: "2026-09-23T00:00:00Z",
          labels: { nodes: [] },
          comments: { nodes: [] },
        },
      },
    },
  };
  writeFileSync(join(S, `issue-${n}.json`), `${JSON.stringify(obj)}\n`);
}

function editsCount(): number {
  try {
    return readFileSync(join(S, "edits.log"), "utf8")
      .split("\n")
      .filter((l) => l.startsWith("call:")).length;
  } catch {
    return 0;
  }
}

function createsCount(): number {
  try {
    return readFileSync(join(S, "creates.log"), "utf8")
      .split("\n")
      .filter((l) => l !== "").length;
  } catch {
    return 0;
  }
}

function plainBoards(): void {
  rmSync(join(repo, ".postmaster", "project.toml"), { force: true });
  writeFileSync(join(S, "boards.json"), `${BOARD}\n`);
}

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "postmaster-"));
  S = join(tmp, "stub");
  bin = join(tmp, "bin");
  repo = join(tmp, "repo");
  mkdirSync(bin, { recursive: true });
  mkdirSync(S, { recursive: true });
  writeFileSync(join(bin, "gh"), STUB_GH);
  chmodSync(join(bin, "gh"), 0o755);
  const init = spawnSync("git", ["init", "-q", repo], { encoding: "utf8" });
  if (init.status !== 0) throw new Error(`git init failed: ${init.stderr}`);
  const remote = spawnSync(
    "git",
    ["-C", repo, "remote", "add", "origin", "https://github.com/o/r.git"],
    { encoding: "utf8" },
  );
  if (remote.status !== 0) throw new Error(`git remote add failed: ${remote.stderr}`);
  writeFileSync(join(S, "boards.json"), `${BOARD}\n`);
  writeFileSync(join(S, "items.json"), `${ITEMS}\n`);
  writeFileSync(join(S, "fields.json"), `${FIELDS_JSON}\n`);
  writeFileSync(join(tmp, "lf.md"), LF_MD);
  writeFileSync(join(tmp, "crlf.md"), CRLF_MD);
  writeFileSync(join(tmp, "new.md"), NEW_MD);
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("unicode primitives", () => {
  test("option keys keep non-ASCII word chars", () => {
    expect(pyLower("café-2".replace(NONWORD_RE, ""))).toBe("café2");
  }, 30000);

  test("option keys keep decimal digits", () => {
    expect(pyLower("a٣b!".replace(NONWORD_RE, ""))).toBe("a٣b");
  }, 30000);

  test("issue numbers may be Arabic-Indic", () => {
    expect(NUMBER_RE.test("١٢")).toBe(true);
  }, 30000);

  test("issue numbers reject a trailing LF (fullmatch)", () => {
    expect(NUMBER_RE.test("12\n")).toBe(false);
  }, 30000);

  test("comment dates may be Arabic-Indic", () => {
    expect(DATE_PREFIX_RE.test("٠٢٠٦-٠١-٠١ x")).toBe(true);
  }, 30000);

  test("comment dates keep the ASCII shape", () => {
    expect(DATE_PREFIX_RE.test("2026-01-01 x")).toBe(true);
    expect(DATE_PREFIX_RE.test("2026-1-1 x")).toBe(false);
  }, 30000);
});

describe("positive controls", () => {
  test("the shared tracker binding selects its named linked board", () => {
    mkdirSync(join(repo, ".postmaster"), { recursive: true });
    writeFileSync(join(repo, ".postmaster", "project.toml"), '[tracker]\nbinding = "chosen"\n');
    writeFileSync(join(S, "boards.json"), `${TWO_CHOSEN}\n`);
    try {
      const rb = ghSh(["board"]);
      expect(rb.code).toBe(0);
      expect(rb.out).toBe("#2\tchosen\thttps://github.com/users/o/projects/2\n");
    } finally {
      plainBoards();
    }
  }, 30000);

  test("a binding naming no linked board is refused", () => {
    mkdirSync(join(repo, ".postmaster"), { recursive: true });
    writeFileSync(join(repo, ".postmaster", "project.toml"), '[tracker]\nbinding = "missing"\n');
    writeFileSync(join(S, "boards.json"), `${TWO_CHOSEN}\n`);
    try {
      const rb = ghSh(["board"]);
      expect(rb.code).toBe(1);
      expect(rb.err.includes("is not a linked GitHub Projects board")).toBe(true);
    } finally {
      plainBoards();
    }
  }, 30000);

  test("a binding matching two linked boards is refused", () => {
    mkdirSync(join(repo, ".postmaster"), { recursive: true });
    writeFileSync(join(repo, ".postmaster", "project.toml"), '[tracker]\nbinding = "dup"\n');
    writeFileSync(join(S, "boards.json"), `${TWO_DUP}\n`);
    try {
      const rb = ghSh(["board"]);
      expect(rb.code).toBe(1);
      expect(rb.err.includes("matches more than one linked board")).toBe(true);
    } finally {
      plainBoards();
    }
  }, 30000);

  test("read --body prints the stored body byte for byte, then one newline", () => {
    plainBoards();
    stored(7, join(tmp, "lf.md"));
    const r = ghSh(["read", "7", "--body"]);
    const want = Buffer.concat([readFileSync(join(tmp, "lf.md")), Buffer.from("\n")]);
    expect(r.code).toBe(0);
    expect(Buffer.compare(Buffer.from(r.out, "utf8"), want)).toBe(0);
  }, 30000);

  test("read --body keeps a CRLF body's line endings", () => {
    plainBoards();
    stored(7, join(tmp, "crlf.md"));
    const r = ghSh(["read", "7", "--body"]);
    const want = Buffer.concat([readFileSync(join(tmp, "crlf.md")), Buffer.from("\n")]);
    expect(r.code).toBe(0);
    expect(Buffer.compare(Buffer.from(r.out, "utf8"), want)).toBe(0);
  }, 30000);

  test("read without --body still prints the header before the body", () => {
    plainBoards();
    stored(7, join(tmp, "lf.md"));
    const r = ghSh(["read", "7"]);
    expect(r.code).toBe(0);
    expect(r.out.split("\n")[0]).toBe("id: #7");
    expect(r.out.split("\n").includes("title: Check a ticket's shape")).toBe(true);
  }, 30000);

  test("edit against the body as read calls gh issue edit once, with the body file and no title", () => {
    plainBoards();
    stored(7, join(tmp, "lf.md"));
    const baseRead = ghSh(["read", "7", "--body"]);
    expect(baseRead.code).toBe(0);
    writeFileSync(join(tmp, "base.md"), baseRead.out);
    writeFileSync(join(S, "edits.log"), "");
    const r = ghSh(["edit", "7", join(tmp, "new.md"), join(tmp, "base.md")]);
    let editsLog = "";
    try {
      editsLog = readFileSync(join(S, "edits.log"), "utf8");
    } catch {
      editsLog = "";
    }
    let editedBodyMatches = false;
    try {
      const edited = readFileSync(join(S, "edited-body"));
      const wanted = readFileSync(join(tmp, "new.md"));
      editedBodyMatches = Buffer.compare(edited, wanted) === 0;
    } catch {
      editedBodyMatches = false;
    }
    expect(r.code).toBe(0);
    expect(r.out.trim()).toBe("#7: edited");
    expect(editsCount()).toBe(1);
    expect(editsLog.includes("[--body-file]")).toBe(true);
    expect(editsLog.includes("[--title]")).toBe(false);
    expect(editedBodyMatches).toBe(true);
  }, 30000);

  test("a body stored with CRLF matches the same base with LF", () => {
    plainBoards();
    stored(7, join(tmp, "crlf.md"));
    const lfBase = readFileSync(join(tmp, "crlf.md"), "utf8").replace(/\r/gu, "");
    writeFileSync(join(tmp, "base-lf.md"), lfBase);
    writeFileSync(join(S, "edits.log"), "");
    const r = ghSh(["edit", "7", join(tmp, "new.md"), join(tmp, "base-lf.md")]);
    expect(r.code).toBe(0);
    expect(r.out.trim()).toBe("#7: edited");
    expect(editsCount()).toBe(1);
  }, 30000);
});

describe("negative controls: nothing is written", () => {
  const refused = (editArgs: string[]): { code: number; out: string; err: string; ed: number } => {
    writeFileSync(join(S, "edits.log"), "");
    const rr = ghSh(["edit", ...editArgs]);
    return { code: rr.code, out: rr.out, err: rr.err, ed: editsCount() };
  };

  const negativeSetup = (): void => {
    plainBoards();
    stored(7, join(tmp, "lf.md"));
    writeFileSync(join(tmp, "stale.md"), STALE_MD);
    writeFileSync(join(tmp, "empty.md"), " \n\n");
    const baseRead = ghSh(["read", "7", "--body"]);
    if (baseRead.code !== 0) throw new Error(`setup read failed: ${baseRead.err}`);
    writeFileSync(join(tmp, "base.md"), baseRead.out);
  };

  test("a base the issue no longer matches exits 4", () => {
    negativeSetup();
    const r = refused(["7", join(tmp, "new.md"), join(tmp, "stale.md")]);
    expect(r.code).toBe(4);
    expect(r.ed).toBe(0);
    expect((r.out + r.err).includes("#7 changed since")).toBe(true);
  }, 30000);

  test("an empty body file exits 1", () => {
    negativeSetup();
    const r = refused(["7", join(tmp, "empty.md"), join(tmp, "base.md")]);
    expect(r.code).toBe(1);
    expect(r.ed).toBe(0);
    expect((r.out + r.err).includes("is empty")).toBe(true);
  }, 30000);

  test("a missing base file exits 1", () => {
    negativeSetup();
    const r = refused(["7", join(tmp, "new.md"), join(tmp, "nowhere.md")]);
    expect(r.code).toBe(1);
    expect(r.ed).toBe(0);
    expect((r.out + r.err).includes("cannot read base file")).toBe(true);
  }, 30000);

  test("a pull request number exits 1", () => {
    negativeSetup();
    const r = refused(["34", join(tmp, "new.md"), join(tmp, "base.md")]);
    expect(r.code).toBe(1);
    expect(r.ed).toBe(0);
    expect((r.out + r.err).includes("no issue #34")).toBe(true);
  }, 30000);

  test("the old form, with a title, is a usage error", () => {
    negativeSetup();
    const r = refused(["7", "Check a ticket's shape", join(tmp, "new.md")]);
    expect(r.code).toBe(1);
    expect(r.ed).toBe(0);
    expect((r.out + r.err).includes("usage:")).toBe(true);
  }, 30000);

  test("no linked board exits 3", () => {
    negativeSetup();
    writeFileSync(join(S, "boards.json"), `${NO_BOARDS}\n`);
    try {
      const r = refused(["7", join(tmp, "new.md"), join(tmp, "base.md")]);
      expect(r.code).toBe(3);
      expect(r.ed).toBe(0);
      expect((r.out + r.err).includes("no linked board")).toBe(true);
    } finally {
      plainBoards();
    }
  }, 30000);

  test("read --body without a linked board exits 3", () => {
    negativeSetup();
    writeFileSync(join(S, "boards.json"), `${NO_BOARDS}\n`);
    try {
      const r = ghSh(["read", "7", "--body"]);
      expect(r.code).toBe(3);
    } finally {
      plainBoards();
    }
  }, 30000);
});

describe("access", () => {
  test("access prints the user's permission", () => {
    writeFileSync(join(S, "access.json"), `${ACCESS_ADMIN}\n`);
    const r = ghSh(["access"]);
    expect(r.code).toBe(0);
    expect(r.out.trim()).toBe("ADMIN");
  }, 30000);

  test("a repository the user only reads says READ", () => {
    writeFileSync(join(S, "access.json"), `${ACCESS_READ}\n`);
    const r = ghSh(["access"]);
    expect(r.code).toBe(0);
    expect(r.out.trim()).toBe("READ");
  }, 30000);

  test("a repository gh cannot see exits 1", () => {
    writeFileSync(join(S, "access.json"), `${ACCESS_NONE}\n`);
    const r = ghSh(["access"]);
    expect(r.code).toBe(1);
    expect((r.out + r.err).includes("no permission on o/r")).toBe(true);
  }, 30000);
});

describe("create and search", () => {
  test("create files the issue and prints its number", () => {
    plainBoards();
    writeFileSync(join(S, "creates.log"), "");
    const r = ghSh(["create", "A title", join(tmp, "new.md")]);
    expect(r.code).toBe(0);
    expect(r.out.trim()).toBe("60");
    expect(createsCount()).toBe(1);
  }, 30000);

  test("an issue that misses the board still prints its number, and exits 5", () => {
    plainBoards();
    writeFileSync(join(S, "creates.log"), "");
    writeFileSync(join(S, "no-item-add"), "");
    try {
      const r = ghSh(["create", "A title", join(tmp, "new.md")]);
      expect(r.code).toBe(5);
      expect(r.out.trim()).toBe("60");
      expect(createsCount()).toBe(1);
      expect(r.err.includes("#60 was created, but is not on the board")).toBe(true);
    } finally {
      rmSync(join(S, "no-item-add"), { force: true });
    }
  }, 30000);

  test("a board with no Todo column is refused before anything is created", () => {
    plainBoards();
    writeFileSync(join(S, "creates.log"), "");
    const origFields = readFileSync(join(S, "fields.json"));
    writeFileSync(join(S, "fields.json"), `${NO_TODO_FIELDS}\n`);
    try {
      const r = ghSh(["create", "A title", join(tmp, "new.md")]);
      expect(r.code).toBe(1);
      expect(createsCount()).toBe(0);
      expect((r.out + r.err).includes("nothing was created")).toBe(true);
    } finally {
      writeFileSync(join(S, "fields.json"), origFields);
    }
  }, 30000);

  test("search asks for the phrase in this repository, and prints number, state and title", () => {
    plainBoards();
    writeFileSync(join(S, "search.json"), `${SEARCH_JSON}\n`);
    const r = ghSh(["search", "tf-0a1b2c3d"]);
    let searchesLog = "";
    try {
      searchesLog = readFileSync(join(S, "searches.log"), "utf8");
    } catch {
      searchesLog = "";
    }
    expect(r.code).toBe(0);
    expect(r.out.trimEnd()).toBe("#4\topen\tEarlier\n#9\tclosed\tLater");
    expect(searchesLog.includes('"tf-0a1b2c3d" --repo o/r')).toBe(true);
  }, 30000);

  test("a colon in the text is searched as a space, which GitHub's query accepts", () => {
    plainBoards();
    writeFileSync(join(S, "search.json"), `${SEARCH_JSON}\n`);
    ghSh(["search", "Tool fault in scripts/x.sh:"]);
    let searchesLog = "";
    try {
      searchesLog = readFileSync(join(S, "searches.log"), "utf8");
    } catch {
      searchesLog = "";
    }
    const lastSearch = searchesLog.trimEnd().split("\n").pop() ?? "";
    expect(lastSearch.includes('"Tool fault in scripts/x.sh" --repo o/r')).toBe(true);
  }, 30000);
});
