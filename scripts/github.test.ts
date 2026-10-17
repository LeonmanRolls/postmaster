// Tests beside scripts/github.ts, moved from its --self-test on #109: 35 controls.
// Each CLI test rewrites the stub state it needs, so it passes alone as well as in file order.
// Failure-only byte dumps (catA) are dropped: expect() shows the mismatch itself.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pyLower } from "./lib/text.ts";
import { DATE_PREFIX_RE, NONWORD_RE, NUMBER_RE } from "./github";

const SELF = join(import.meta.dir, "run");
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
// The answer to the direct query for the board's Status field.
const FIELDS_JSON =
  '{"data": {"node": {"field": {"id": "F1", "options": [{"id": "o1", "name": "Todo"}, ' +
  '{"id": "o2", "name": "In Progress"}, {"id": "o3", "name": "Done"}]}}}}';
const NO_TODO_FIELDS =
  '{"data": {"node": {"field": {"id": "F1", "options": [{"id": "o1", "name": "Backlog"}, ' +
  '{"id": "o3", "name": "Done"}]}}}}';
const NO_STATUS_FIELD = '{"data": {"node": {"field": null}}}';
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
printf '%s\\n' "$1 $2" >> "$d/calls.log"
case "$1 $2" in
  "auth status") exit 0 ;;
  "api graphql")
    q="" n=""
    for a in "$@"; do case $a in query=*) q=$a ;; number=*) n=\${a#number=} ;; esac; done
    printf '%s\\n' "$q" >> "$d/queries.log"
    case $q in
      *projectsV2*) cat "$d/boards.json" ;;
      *viewerPermission*) cat "$d/access.json" ;;
      *ProjectV2SingleSelectField*) cat "$d/fields.json" ;;
      *"issue(number:"*) if [ -f "$d/issue-$n.json" ]; then cat "$d/issue-$n.json"
                         else echo '{"data": {"repository": {"issue": null}}}'; fi ;;
      *"issues(first:100"*) cat "$d/issues.json" ;;
      *) echo "stub gh: unexpected query" >&2; exit 1 ;;
    esac ;;
  "api "*)
    printf 'call:%s\\n' "$(printf ' [%s]' "$@")" >> "$d/rest.log"
    case "$*" in
      "api -X POST repos/o/r/labels "*) printf 'create:%s\\n' "$*" >> "$d/labels.log"; echo '{}' ;;
      "api -X POST repos/o/r/issues/"*)
        if [ -f "$d/rest-fails" ]; then echo 'HTTP 500: Server Error' >&2; exit 1; fi
        echo '[]' ;;
      "api -X DELETE repos/o/r/issues/"*)
        if [ -f "$d/not-on-issue" ]; then echo '{"message": "Label does not exist"}' >&2; exit 1; fi
        echo '[]' ;;
      "api repos/o/r/labels/"*)
        name=\${2##*/}
        if [ -f "$d/repo-labels.json" ] && grep -q "\\"$name\\"" "$d/repo-labels.json"; then echo '{}'
        else echo '{"message": "Not Found", "status": "404"}' >&2; exit 1; fi ;;
      *) echo "stub gh: unexpected REST call: $*" >&2; exit 1 ;;
    esac ;;
  "project item-list") echo "stub gh: the board must not be listed" >&2; exit 1 ;;
  "project field-list") echo "stub gh: the fields must be asked for directly" >&2; exit 1 ;;
  "project item-add") if [ -f "$d/no-item-add" ]; then \\
    echo "stub gh: item-add refused" >&2; exit 1; fi
                      echo '{"id": "PVTI_new"}' ;;
  "project item-edit") printf 'edit:%s\\n' "$(printf ' [%s]' "$@")" >> "$d/item-edits.log"; exit 0 ;;
  "issue create") printf 'create\\n' >> "$d/creates.log"; echo "https://github.com/o/r/issues/60";;
  "search issues") printf '%s\\n' "$*" >> "$d/searches.log"; cat "$d/search.json" ;;
  "issue edit")
    f="" prev="" body=0
    for a in "$@"; do [ "$prev" = --body-file ] && { f=$a; body=1; }; prev=$a; done
    printf 'call:%s\\n' "$(printf ' [%s]' "$@")" >> "$d/edits.log"
    if [ $body = 1 ]; then cp -- "$f" "$d/edited-body"; fi ;;
  "issue close"|"issue reopen") printf '%s\\n' "$*" >> "$d/closes.log" ;;
  *) echo "stub gh: unexpected: $*" >&2; exit 1 ;;
esac
`;

let tmp = "";
let S = "";
let bin = "";
let repo = "";

function ghSh(args: string[]): { code: number; out: string; err: string } {
  const r = spawnSync(SELF, ["github", repo, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      GITHUB_SH_STUB: S,
    },
  });
  return { code: r.status ?? -1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

function stored(
  n: number,
  file: string,
  labels: string[] = [],
  items: Array<{ id: string; project: string; status: string | null }> = [],
  closedAs: "COMPLETED" | "NOT_PLANNED" | null = null,
): void {
  const body = readFileSync(file, "utf8");
  const obj = {
    data: {
      repository: {
        issue: {
          number: n,
          title: "Check a ticket's shape",
          body,
          state: closedAs === null ? "OPEN" : "CLOSED",
          stateReason: closedAs,
          url: `https://github.com/o/r/issues/${n}`,
          createdAt: "2026-09-23T00:00:00Z",
          labels: { nodes: labels.map((name) => ({ name })) },
          comments: { nodes: [] },
          projectItems: {
            nodes: items.map((it) => ({
              id: it.id,
              project: { id: it.project },
              fieldValueByName: it.status === null ? null : { name: it.status },
            })),
          },
        },
      },
    },
  };
  writeFileSync(join(S, `issue-${n}.json`), `${JSON.stringify(obj)}\n`);
}

function callsLog(): string {
  try {
    return readFileSync(join(S, "calls.log"), "utf8");
  } catch {
    return "";
  }
}

function itemEdits(): string {
  try {
    return readFileSync(join(S, "item-edits.log"), "utf8");
  } catch {
    return "";
  }
}

function restLog(): string {
  try {
    return readFileSync(join(S, "rest.log"), "utf8");
  } catch {
    return "";
  }
}

function labelsLog(): string {
  try {
    return readFileSync(join(S, "labels.log"), "utf8");
  } catch {
    return "";
  }
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

function queriesLog(): string {
  try {
    return readFileSync(join(S, "queries.log"), "utf8");
  } catch {
    return "";
  }
}

function closesLog(): string {
  try {
    return readFileSync(join(S, "closes.log"), "utf8");
  } catch {
    return "";
  }
}

function plainBoards(): void {
  rmSync(join(repo, ".postmaster", "project.toml"), { force: true });
  rmSync(join(repo, ".postmaster", "settings.toml"), { force: true });
  writeFileSync(join(S, "boards.json"), `${BOARD}\n`);
}

// The person's settings file turns the board off, or sets it to the value given.
function boardSetting(value = "off"): void {
  mkdirSync(join(repo, ".postmaster"), { recursive: true });
  writeFileSync(join(repo, ".postmaster", "settings.toml"), `[tracker]\nboard = "${value}"\n`);
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
  });

  test("option keys keep decimal digits", () => {
    expect(pyLower("a٣b!".replace(NONWORD_RE, ""))).toBe("a٣b");
  });

  test("issue numbers may be Arabic-Indic", () => {
    expect(NUMBER_RE.test("١٢")).toBe(true);
  });

  test("issue numbers reject a trailing LF (fullmatch)", () => {
    expect(NUMBER_RE.test("12\n")).toBe(false);
  });

  test("comment dates may be Arabic-Indic", () => {
    expect(DATE_PREFIX_RE.test("٠٢٠٦-٠١-٠١ x")).toBe(true);
  });

  test("comment dates keep the ASCII shape", () => {
    expect(DATE_PREFIX_RE.test("2026-01-01 x")).toBe(true);
    expect(DATE_PREFIX_RE.test("2026-1-1 x")).toBe(false);
  });
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
  });

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
  });

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
  });

  test("read --body prints the stored body byte for byte, then one newline", () => {
    plainBoards();
    stored(7, join(tmp, "lf.md"));
    const r = ghSh(["read", "7", "--body"]);
    const want = Buffer.concat([readFileSync(join(tmp, "lf.md")), Buffer.from("\n")]);
    expect(r.code).toBe(0);
    expect(Buffer.compare(Buffer.from(r.out, "utf8"), want)).toBe(0);
  });

  test("read --body keeps a CRLF body's line endings", () => {
    plainBoards();
    stored(7, join(tmp, "crlf.md"));
    const r = ghSh(["read", "7", "--body"]);
    const want = Buffer.concat([readFileSync(join(tmp, "crlf.md")), Buffer.from("\n")]);
    expect(r.code).toBe(0);
    expect(Buffer.compare(Buffer.from(r.out, "utf8"), want)).toBe(0);
  });

  test("read without --body still prints the header before the body", () => {
    plainBoards();
    stored(7, join(tmp, "lf.md"));
    const r = ghSh(["read", "7"]);
    expect(r.code).toBe(0);
    expect(r.out.split("\n")[0]).toBe("id: #7");
    expect(r.out.split("\n").includes("title: Check a ticket's shape")).toBe(true);
  });

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
  });

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
  });
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
  });

  test("an empty body file exits 1", () => {
    negativeSetup();
    const r = refused(["7", join(tmp, "empty.md"), join(tmp, "base.md")]);
    expect(r.code).toBe(1);
    expect(r.ed).toBe(0);
    expect((r.out + r.err).includes("is empty")).toBe(true);
  });

  test("a missing base file exits 1", () => {
    negativeSetup();
    const r = refused(["7", join(tmp, "new.md"), join(tmp, "nowhere.md")]);
    expect(r.code).toBe(1);
    expect(r.ed).toBe(0);
    expect((r.out + r.err).includes("cannot read base file")).toBe(true);
  });

  test("a pull request number exits 1", () => {
    negativeSetup();
    const r = refused(["34", join(tmp, "new.md"), join(tmp, "base.md")]);
    expect(r.code).toBe(1);
    expect(r.ed).toBe(0);
    expect((r.out + r.err).includes("no issue #34")).toBe(true);
  });

  test("the old form, with a title, is a usage error", () => {
    negativeSetup();
    const r = refused(["7", "Check a ticket's shape", join(tmp, "new.md")]);
    expect(r.code).toBe(1);
    expect(r.ed).toBe(0);
    expect((r.out + r.err).includes("usage:")).toBe(true);
  });

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
  });

  test("read --body without a linked board exits 3", () => {
    negativeSetup();
    writeFileSync(join(S, "boards.json"), `${NO_BOARDS}\n`);
    try {
      const r = ghSh(["read", "7", "--body"]);
      expect(r.code).toBe(3);
    } finally {
      plainBoards();
    }
  });
});

describe("access", () => {
  test("access prints the user's permission", () => {
    writeFileSync(join(S, "access.json"), `${ACCESS_ADMIN}\n`);
    const r = ghSh(["access"]);
    expect(r.code).toBe(0);
    expect(r.out.trim()).toBe("ADMIN");
  });

  test("a repository the user only reads says READ", () => {
    writeFileSync(join(S, "access.json"), `${ACCESS_READ}\n`);
    const r = ghSh(["access"]);
    expect(r.code).toBe(0);
    expect(r.out.trim()).toBe("READ");
  });

  test("a repository gh cannot see exits 1", () => {
    writeFileSync(join(S, "access.json"), `${ACCESS_NONE}\n`);
    const r = ghSh(["access"]);
    expect(r.code).toBe(1);
    expect((r.out + r.err).includes("no permission on o/r")).toBe(true);
  });
});

describe("create and search", () => {
  test("create files the issue and prints its number", () => {
    plainBoards();
    writeFileSync(join(S, "creates.log"), "");
    const r = ghSh(["create", "A title", join(tmp, "new.md")]);
    expect(r.code).toBe(0);
    expect(r.out.trim()).toBe("60");
    expect(createsCount()).toBe(1);
  });

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
  });

  test("a board with no Status field is refused before anything is created", () => {
    plainBoards();
    writeFileSync(join(S, "creates.log"), "");
    const origFields = readFileSync(join(S, "fields.json"));
    writeFileSync(join(S, "fields.json"), `${NO_STATUS_FIELD}\n`);
    try {
      const r = ghSh(["create", "A title", join(tmp, "new.md")]);
      expect(r.code).toBe(1);
      expect(createsCount()).toBe(0);
      expect((r.out + r.err).includes("has no Status field")).toBe(true);
    } finally {
      writeFileSync(join(S, "fields.json"), origFields);
    }
  });

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
  });

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
  });

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
  });
});

describe("labels and titles", () => {
  test("label add creates the missing repo label, then adds it", () => {
    plainBoards();
    stored(7, join(tmp, "lf.md"));
    rmSync(join(S, "labels.log"), { force: true });
    rmSync(join(S, "repo-labels.json"), { force: true });
    rmSync(join(S, "rest.log"), { force: true });
    const r = ghSh(["label", "7", "add", "ready"]);
    expect(r.code).toBe(0);
    expect(r.out.trim()).toBe("#7: label added ready");
    const created = labelsLog();
    expect(created.includes("create:")).toBe(true);
    expect(created.includes("name=ready")).toBe(true);
    expect(restLog().includes("[repos/o/r/issues/7/labels] [-f] [labels[]=ready]")).toBe(true);
  });

  test("label add uses the repo label when it exists, creating nothing", () => {
    plainBoards();
    stored(7, join(tmp, "lf.md"));
    writeFileSync(join(S, "repo-labels.json"), '[{"name": "ready"}]\n');
    rmSync(join(S, "labels.log"), { force: true });
    rmSync(join(S, "rest.log"), { force: true });
    try {
      const r = ghSh(["label", "7", "add", "ready"]);
      expect(r.code).toBe(0);
      expect(labelsLog()).toBe("");
      expect(restLog().includes("[repos/o/r/issues/7/labels] [-f] [labels[]=ready]")).toBe(true);
    } finally {
      rmSync(join(S, "repo-labels.json"), { force: true });
    }
  });

  test("label remove drops the label without creating anything", () => {
    plainBoards();
    stored(7, join(tmp, "lf.md"), ["ready"]);
    rmSync(join(S, "labels.log"), { force: true });
    rmSync(join(S, "rest.log"), { force: true });
    const r = ghSh(["label", "7", "remove", "ready"]);
    expect(r.code).toBe(0);
    expect(r.out.trim()).toBe("#7: label removed ready");
    expect(labelsLog()).toBe("");
    expect(restLog().includes("[DELETE] [repos/o/r/issues/7/labels/ready]")).toBe(true);
  });

  test("read shows the issue's labels", () => {
    plainBoards();
    stored(7, join(tmp, "lf.md"), ["ready", "blocked"]);
    const r = ghSh(["read", "7"]);
    expect(r.code).toBe(0);
    expect(r.out.split("\n")).toContain("labels: ready, blocked");
  });

  test("has-label answers exact membership, and a comma in a name is one label", () => {
    plainBoards();
    stored(7, join(tmp, "lf.md"), ["blocked, ready"]);
    const absent = ghSh(["has-label", "7", "ready"]);
    expect(absent.code).toBe(0);
    expect(absent.out.trim()).toBe("absent");
    const folded = ghSh(["has-label", "7", "BLOCKED, READY"]);
    expect(folded.code).toBe(0);
    expect(folded.out.trim()).toBe("present");
    const present = ghSh(["has-label", "7", "blocked, ready"]);
    expect(present.code).toBe(0);
    expect(present.out.trim()).toBe("present");
  });

  test("title retitles the issue", () => {
    plainBoards();
    stored(7, join(tmp, "lf.md"));
    writeFileSync(join(S, "edits.log"), "");
    const r = ghSh(["title", "7", "A new title"]);
    expect(r.code).toBe(0);
    expect(r.out.trim()).toBe("#7: title changed");
    const log = readFileSync(join(S, "edits.log"), "utf8");
    expect(log.includes("[--title] [A new title]")).toBe(true);
    expect(log.includes("[--body-file]")).toBe(false);
  });

  test("a state change leaves the ready label alone", () => {
    plainBoards();
    stored(7, join(tmp, "lf.md"), ["ready"]);
    rmSync(join(S, "rest.log"), { force: true });
    const blocked = ghSh(["state", "7", "blocked"]);
    expect(blocked.code).toBe(0);
    let log = restLog();
    expect(log.includes("[labels[]=blocked]")).toBe(true);
    expect(log.includes("DELETE")).toBe(false);
    stored(7, join(tmp, "lf.md"), ["ready", "blocked"]);
    rmSync(join(S, "rest.log"), { force: true });
    const todo = ghSh(["state", "7", "todo"]);
    expect(todo.code).toBe(0);
    log = restLog();
    expect(log.includes("[DELETE] [repos/o/r/issues/7/labels/blocked]")).toBe(true);
    expect(log.includes("labels/ready")).toBe(false);
  });
});

describe("the board is never listed", () => {
  const ON_BOARD = (status: string | null) => [{ id: "PVTI_7", project: "PVT_1", status }];

  test("positive control: the stub refuses a board listing, so a regression would fail", () => {
    const r = spawnSync(join(bin, "gh"), ["project", "item-list", "1"], {
      encoding: "utf8",
      env: { ...process.env, GITHUB_SH_STUB: S },
    });
    expect(r.status).toBe(1);
  });

  test("read takes the column from the issue's own board item", () => {
    plainBoards();
    stored(7, join(tmp, "lf.md"), [], ON_BOARD("In Progress"));
    writeFileSync(join(S, "calls.log"), "");
    const r = ghSh(["read", "7"]);
    expect(r.code).toBe(0);
    expect(r.out.split("\n")).toContain("state: in-progress");
    expect(callsLog().includes("project item-list")).toBe(false);
  });

  test("negative control: an item on another board does not set the column", () => {
    plainBoards();
    stored(7, join(tmp, "lf.md"), [], [{ id: "PVTI_x", project: "PVT_other", status: "Done" }]);
    const r = ghSh(["read", "7"]);
    expect(r.code).toBe(0);
    expect(r.out.split("\n")).toContain("state: todo");
  });

  test("negative control: an item with no Status value reads as todo", () => {
    plainBoards();
    stored(7, join(tmp, "lf.md"), [], ON_BOARD(null));
    const r = ghSh(["read", "7"]);
    expect(r.code).toBe(0);
    expect(r.out.split("\n")).toContain("state: todo");
  });

  test("state moves the issue's own item without adding or listing anything", () => {
    plainBoards();
    stored(7, join(tmp, "lf.md"), [], ON_BOARD("Todo"));
    writeFileSync(join(S, "calls.log"), "");
    rmSync(join(S, "item-edits.log"), { force: true });
    const r = ghSh(["state", "7", "in-progress"]);
    expect(r.code).toBe(0);
    expect(itemEdits().includes("[--id] [PVTI_7]")).toBe(true);
    expect(itemEdits().includes("[--single-select-option-id] [o2]")).toBe(true);
    expect(callsLog().includes("project item-add")).toBe(false);
    expect(callsLog().includes("project item-list")).toBe(false);
  });

  test("state adds an issue that is not on the board, then moves its new item", () => {
    plainBoards();
    stored(7, join(tmp, "lf.md"), [], []);
    writeFileSync(join(S, "calls.log"), "");
    rmSync(join(S, "item-edits.log"), { force: true });
    const r = ghSh(["state", "7", "in-progress"]);
    expect(r.code).toBe(0);
    expect(
      callsLog()
        .split("\n")
        .filter((l) => l === "project item-add").length,
    ).toBe(1);
    expect(itemEdits().includes("[--id] [PVTI_new]")).toBe(true);
  });

  test("create adds the new issue to the board and moves its item, listing nothing", () => {
    plainBoards();
    writeFileSync(join(S, "creates.log"), "");
    writeFileSync(join(S, "calls.log"), "");
    rmSync(join(S, "item-edits.log"), { force: true });
    const r = ghSh(["create", "A title", join(tmp, "new.md")]);
    expect(r.code).toBe(0);
    expect(callsLog().includes("project item-list")).toBe(false);
    expect(itemEdits().includes("[--id] [PVTI_new]")).toBe(true);
    expect(itemEdits().includes("[--single-select-option-id] [o1]")).toBe(true);
  });

  test("list reads each column from the issue query and prints state and title", () => {
    plainBoards();
    const node = (number: number, title: string, state: string, status: string | null) => ({
      number,
      title,
      state,
      stateReason: state === "CLOSED" ? "COMPLETED" : null,
      labels: { nodes: [] },
      projectItems: {
        nodes:
          status === null
            ? []
            : [
                {
                  id: `PVTI_${number}`,
                  project: { id: "PVT_1" },
                  fieldValueByName: { name: status },
                },
              ],
      },
    });
    const page = {
      data: {
        repository: {
          issues: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              node(9, "Later", "OPEN", "In Progress"),
              node(4, "Earlier", "CLOSED", "Done"),
              node(6, "Not on the board", "OPEN", null),
            ],
          },
        },
      },
    };
    writeFileSync(join(S, "issues.json"), `${JSON.stringify(page)}\n`);
    writeFileSync(join(S, "calls.log"), "");
    const r = ghSh(["list"]);
    expect(r.code).toBe(0);
    expect(r.out.trim().split("\n")).toEqual([
      "#4\tdone\tEarlier",
      "#6\ttodo\tNot on the board",
      "#9\tin-progress\tLater",
    ]);
    expect(callsLog().includes("project item-list")).toBe(false);
    const only = ghSh(["list", "in-progress"]);
    expect(only.out.trim()).toBe("#9\tin-progress\tLater");
  });
});

describe("labels over REST", () => {
  test("removing a label the issue lacks succeeds", () => {
    plainBoards();
    stored(7, join(tmp, "lf.md"));
    writeFileSync(join(S, "not-on-issue"), "");
    try {
      const r = ghSh(["label", "7", "remove", "ready"]);
      expect(r.code).toBe(0);
    } finally {
      rmSync(join(S, "not-on-issue"), { force: true });
    }
  });

  test("negative control: a REST failure that is not a 404 stops the label change", () => {
    plainBoards();
    stored(7, join(tmp, "lf.md"));
    writeFileSync(join(S, "repo-labels.json"), '[{"name": "ready"}]\n');
    writeFileSync(join(S, "rest-fails"), "");
    try {
      const r = ghSh(["label", "7", "add", "ready"]);
      expect(r.code).toBe(1);
      expect(r.err.includes("HTTP 500")).toBe(true);
    } finally {
      rmSync(join(S, "rest-fails"), { force: true });
      rmSync(join(S, "repo-labels.json"), { force: true });
    }
  });
});

describe("the board turned off", () => {
  const ON_BOARD = (status: string | null) => [{ id: "PVTI_7", project: "PVT_1", status }];

  const fresh = (): void => {
    for (const f of [
      "calls.log",
      "queries.log",
      "rest.log",
      "closes.log",
      "item-edits.log",
      "creates.log",
      "labels.log",
    ]) {
      rmSync(join(S, f), { force: true });
    }
  };

  // Nothing asked GitHub about a board: no query names a project, and no gh project command ran.
  const askedNothingOfBoards = (): void => {
    expect(/project/iu.test(queriesLog())).toBe(false);
    expect(
      callsLog()
        .split("\n")
        .some((l) => l.startsWith("project ")),
    ).toBe(false);
    expect(itemEdits()).toBe("");
  };

  test("positive control: with the board on, reading an issue asks for its board items", () => {
    plainBoards();
    stored(7, join(tmp, "lf.md"));
    fresh();
    const r = ghSh(["read", "7"]);
    expect(r.code).toBe(0);
    expect(/project/iu.test(queriesLog())).toBe(true);
  });

  test("board says the project tracks its issues alone, and succeeds", () => {
    plainBoards();
    writeFileSync(join(S, "boards.json"), `${NO_BOARDS}\n`);
    boardSetting();
    try {
      fresh();
      const r = ghSh(["board"]);
      expect(r.code).toBe(0);
      expect(r.out.trim()).toBe("no board: this project tracks its issues alone");
      askedNothingOfBoards();
    } finally {
      plainBoards();
    }
  });

  test("board init is refused while the board is off, and makes nothing", () => {
    plainBoards();
    boardSetting();
    try {
      fresh();
      const r = ghSh(["board", "init"]);
      expect(r.code).toBe(1);
      expect(r.err.includes('board = "off"')).toBe(true);
      askedNothingOfBoards();
    } finally {
      plainBoards();
    }
  });

  test("read takes in progress from its label, whatever a board item says", () => {
    plainBoards();
    boardSetting();
    try {
      stored(7, join(tmp, "lf.md"), ["in-progress"], ON_BOARD("Done"));
      fresh();
      const r = ghSh(["read", "7"]);
      expect(r.code).toBe(0);
      expect(r.out.split("\n")).toContain("state: in-progress");
      askedNothingOfBoards();
      stored(7, join(tmp, "lf.md"), [], ON_BOARD("In Progress"));
      const plain = ghSh(["read", "7"]);
      expect(plain.code).toBe(0);
      expect(plain.out.split("\n")).toContain("state: todo");
    } finally {
      plainBoards();
    }
  });

  test("read --body and edit work with no linked board", () => {
    plainBoards();
    writeFileSync(join(S, "boards.json"), `${NO_BOARDS}\n`);
    boardSetting();
    try {
      stored(7, join(tmp, "lf.md"));
      fresh();
      const base = ghSh(["read", "7", "--body"]);
      expect(base.code).toBe(0);
      writeFileSync(join(tmp, "base-off.md"), base.out);
      writeFileSync(join(S, "edits.log"), "");
      const r = ghSh(["edit", "7", join(tmp, "new.md"), join(tmp, "base-off.md")]);
      expect(r.code).toBe(0);
      expect(r.out.trim()).toBe("#7: edited");
      expect(editsCount()).toBe(1);
      askedNothingOfBoards();
    } finally {
      plainBoards();
    }
  });

  test("labels and titles work with no linked board", () => {
    plainBoards();
    writeFileSync(join(S, "boards.json"), `${NO_BOARDS}\n`);
    boardSetting();
    writeFileSync(join(S, "repo-labels.json"), '[{"name": "ready"}]\n');
    try {
      stored(7, join(tmp, "lf.md"), ["ready"]);
      writeFileSync(join(S, "edits.log"), "");
      fresh();
      expect(ghSh(["label", "7", "add", "ready"]).code).toBe(0);
      expect(ghSh(["has-label", "7", "ready"]).out.trim()).toBe("present");
      expect(ghSh(["title", "7", "A new title"]).code).toBe(0);
      askedNothingOfBoards();
    } finally {
      rmSync(join(S, "repo-labels.json"), { force: true });
      plainBoards();
    }
  });

  test("create files the issue and prints its number, putting nothing on a board", () => {
    plainBoards();
    writeFileSync(join(S, "boards.json"), `${NO_BOARDS}\n`);
    boardSetting();
    try {
      fresh();
      const r = ghSh(["create", "A title", join(tmp, "new.md")]);
      expect(r.code).toBe(0);
      expect(r.out.trim()).toBe("60");
      expect(createsCount()).toBe(1);
      askedNothingOfBoards();
    } finally {
      plainBoards();
    }
  });

  test("in progress adds its label, and todo takes it away", () => {
    plainBoards();
    boardSetting();
    rmSync(join(S, "repo-labels.json"), { force: true });
    try {
      stored(7, join(tmp, "lf.md"));
      fresh();
      const started = ghSh(["state", "7", "in-progress"]);
      expect(started.code).toBe(0);
      expect(restLog().includes("[repos/o/r/issues/7/labels] [-f] [labels[]=in-progress]")).toBe(
        true,
      );
      expect(labelsLog().includes("name=in-progress")).toBe(true);
      askedNothingOfBoards();
      stored(7, join(tmp, "lf.md"), ["in-progress"]);
      fresh();
      const back = ghSh(["state", "7", "todo"]);
      expect(back.code).toBe(0);
      expect(restLog().includes("[DELETE] [repos/o/r/issues/7/labels/in-progress]")).toBe(true);
      expect(closesLog()).toBe("");
      askedNothingOfBoards();
    } finally {
      plainBoards();
    }
  });

  test("blocked adds its label and keeps in progress, and the next state takes blocked away", () => {
    plainBoards();
    boardSetting();
    try {
      stored(7, join(tmp, "lf.md"), ["in-progress"]);
      fresh();
      const blocked = ghSh(["state", "7", "blocked"]);
      expect(blocked.code).toBe(0);
      expect(restLog().includes("[labels[]=blocked]")).toBe(true);
      expect(restLog().includes("DELETE")).toBe(false);
      stored(7, join(tmp, "lf.md"), ["in-progress", "blocked"]);
      expect(ghSh(["read", "7"]).out.split("\n")).toContain("state: blocked");
      fresh();
      const resumed = ghSh(["state", "7", "in-progress"]);
      expect(resumed.code).toBe(0);
      expect(restLog().includes("[DELETE] [repos/o/r/issues/7/labels/blocked]")).toBe(true);
      expect(restLog().includes("[labels[]=in-progress]")).toBe(false);
      askedNothingOfBoards();
    } finally {
      plainBoards();
    }
  });

  test("done closes the issue as completed and takes in progress away", () => {
    plainBoards();
    boardSetting();
    try {
      stored(7, join(tmp, "lf.md"), ["in-progress"]);
      fresh();
      const r = ghSh(["state", "7", "done"]);
      expect(r.code).toBe(0);
      expect(closesLog().includes("issue close 7 -R o/r --reason completed")).toBe(true);
      expect(restLog().includes("[DELETE] [repos/o/r/issues/7/labels/in-progress]")).toBe(true);
      askedNothingOfBoards();
    } finally {
      plainBoards();
    }
  });

  test("cancelled closes the issue as not planned, and todo reopens it", () => {
    plainBoards();
    boardSetting();
    try {
      stored(7, join(tmp, "lf.md"));
      fresh();
      const cancelled = ghSh(["state", "7", "cancelled"]);
      expect(cancelled.code).toBe(0);
      expect(closesLog().includes("issue close 7 -R o/r --reason not planned")).toBe(true);
      stored(7, join(tmp, "lf.md"), [], [], "NOT_PLANNED");
      expect(ghSh(["read", "7"]).out.split("\n")).toContain("state: cancelled");
      fresh();
      const reopened = ghSh(["state", "7", "todo"]);
      expect(reopened.code).toBe(0);
      expect(closesLog().includes("issue reopen 7 -R o/r")).toBe(true);
      askedNothingOfBoards();
    } finally {
      plainBoards();
    }
  });

  test("list reads each state from the issue and its labels, asking nothing about boards", () => {
    plainBoards();
    writeFileSync(join(S, "boards.json"), `${NO_BOARDS}\n`);
    boardSetting();
    try {
      // Every issue has a board item in progress, which a board-off list never asks for.
      const node = (
        number: number,
        title: string,
        state: string,
        labels: string[],
        stateReason: string | null = null,
      ) => ({
        number,
        title,
        state,
        stateReason,
        labels: { nodes: labels.map((name) => ({ name })) },
        projectItems: {
          nodes: [
            {
              id: `PVTI_${number}`,
              project: { id: "PVT_1" },
              fieldValueByName: { name: "In Progress" },
            },
          ],
        },
      });
      const page = {
        data: {
          repository: {
            issues: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [
                node(9, "Started", "OPEN", ["in-progress"]),
                node(4, "Finished", "CLOSED", [], "COMPLETED"),
                node(6, "Waiting", "OPEN", ["in-progress", "blocked"]),
                node(5, "Dropped", "CLOSED", ["in-progress"], "NOT_PLANNED"),
                node(3, "Not started", "OPEN", []),
              ],
            },
          },
        },
      };
      writeFileSync(join(S, "issues.json"), `${JSON.stringify(page)}\n`);
      fresh();
      const r = ghSh(["list"]);
      expect(r.code).toBe(0);
      expect(r.out.trim().split("\n")).toEqual([
        "#3\ttodo\tNot started",
        "#4\tdone\tFinished",
        "#5\tcancelled\tDropped",
        "#6\tblocked\tWaiting",
        "#9\tin-progress\tStarted",
      ]);
      askedNothingOfBoards();
    } finally {
      plainBoards();
    }
  });

  test("a board setting other than on or off is refused before GitHub is asked anything", () => {
    plainBoards();
    boardSetting("maybe");
    try {
      stored(7, join(tmp, "lf.md"));
      fresh();
      const r = ghSh(["read", "7"]);
      expect(r.code).toBe(1);
      expect(r.err.includes("tracker.board")).toBe(true);
      expect(queriesLog()).toBe("");
    } finally {
      plainBoards();
    }
  });

  test("a board set on works as the default does, and needs a linked board", () => {
    plainBoards();
    boardSetting("on");
    try {
      stored(7, join(tmp, "lf.md"), [], ON_BOARD("In Progress"));
      const r = ghSh(["read", "7"]);
      expect(r.code).toBe(0);
      expect(r.out.split("\n")).toContain("state: in-progress");
      writeFileSync(join(S, "boards.json"), `${NO_BOARDS}\n`);
      expect(ghSh(["read", "7", "--body"]).code).toBe(3);
    } finally {
      plainBoards();
    }
  });
});
