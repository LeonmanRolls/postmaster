// Tests beside scripts/ticket-ready.ts: the readiness matrix on a local store,
// the marking and queue verbs, the kind=other forms, and the same matrix
// through the github and plane test doubles.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scriptsDir } from "./lib/paths.ts";
import { run } from "./lib/proc.ts";
import { mdToHtml } from "./plane.ts";
import { storedMatches } from "./ticket-ready.ts";

const self = join(scriptsDir(import.meta), "run");
const localSh = join(scriptsDir(import.meta), "run");

const TWO_PART = [
  "## Problem / feature",
  "",
  "The list view shows entries in whatever order they arrive. When this is done the list shows entries sorted by name.",
  "",
  "## Acceptance criteria",
  "",
  "1. The list shows its entries sorted by name.",
  "",
  "## Decisions",
  "",
  "- **D1 (proposed)** Sorting ignores letter case. Why: users expect mixed-case names together. Instead of: byte order, which splits them.",
  "",
  "## Out of scope",
  "",
  "- Grouping entries by kind.",
  "",
  "## Direction",
  "",
  "Linux and macOS. None: any approach that meets the criterion.",
  "",
  "## Turnpikes",
  "",
  "default",
  "",
  "## For the agents",
  "",
  "*Everything above is what the user signed off. This part follows from it and adds nothing to it.*",
  "",
  "### Checks",
  "",
  "- **C1** `list --sort name` on three entries out of order → names in case-blind order, exit 0. **At the base:** entries arrive unsorted.",
  "",
  "### Technical notes",
  "",
  "- The list renders in `list.ts`, sorted with a case-blind comparator. (C1, D1)",
  "",
  "### Verified at ede70e2",
  "",
  "- `list.ts` exists and renders entries unsorted.",
  "",
].join("\n");

const ONE_PART = [
  "## Problem / feature",
  "",
  "A task added by mistake stays on the list for good.",
  "",
  "## Acceptance criteria",
  "",
  "1. The remove command deletes a task by id.",
  "2. The remove command takes several ids.",
  "",
  "## Direction",
  "",
  "Follow the existing split. Add no dependency.",
  "",
  "## Turnpikes",
  "",
  "default",
  "",
].join("\n");

const DRAFT = "DRAFT: still being written\n\n";

let tmp = "";
let repo = "";

function ready(args: string[], env?: Record<string, string | undefined>) {
  const r = run(self, ["ticket-ready", ...args], env ? { env } : {});
  return { code: r.code, out: `${r.out ?? ""}${r.err ?? ""}` };
}

function local(args: string[]) {
  const r = run(localSh, ["local", repo, ...args]);
  if (r.code !== 0) throw new Error(`run local ${args.join(" ")} failed: ${r.out}${r.err}`);
  return (r.out ?? "").trim();
}

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "ticket-ready-"));
  repo = join(tmp, "repo");
  mkdirSync(repo, { recursive: true });
  if (run("git", ["init", "-q", repo]).code !== 0) throw new Error("git init failed");
  if (run(localSh, ["local", repo, "store", "init"]).code !== 0)
    throw new Error("store init failed");
  const a = join(tmp, "a.md");
  const c = join(tmp, "c.md");
  const d = join(tmp, "d.md");
  writeFileSync(a, TWO_PART);
  writeFileSync(c, ONE_PART);
  writeFileSync(d, `${DRAFT}${TWO_PART}`);
  local(["create", "Sorted list", a]);
  local(["create", "Fix the list", a]);
  local(["create", "Remove", c]);
  local(["create", "Draft list", d]);
  local(["label", "1", "add", "ready"]);
  local(["label", "3", "add", "ready"]);
  local(["label", "4", "add", "ready"]);
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("the readiness matrix on a local store", () => {
  test("a marked ticket passing both checks reads ready", () => {
    const r = ready([repo, "1"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("ready: 1");
    expect(r.out).toContain("turnpikes: style, bug, security");
  });

  test("an unmarked ticket names the missing mark", () => {
    const r = ready([repo, "2"]);
    expect(r.code).toBe(2);
    expect(r.out).toBe("ready label is missing\n");
  });

  test("a one-part ticket names the parts finding", () => {
    const r = ready([repo, "3"]);
    expect(r.code).toBe(2);
    expect(r.out).toContain("ticket-parts:");
    expect(r.out).toContain("For the agents");
    expect(r.out.includes("ready label is missing")).toBe(false);
  });

  test("a draft ticket names the draft line once", () => {
    const r = ready([repo, "4"]);
    expect(r.code).toBe(2);
    const drafts = r.out.split("\n").filter((l) => /draft/iu.test(l));
    expect(drafts.length).toBe(1);
  });

  test("a ticket failing several ways names every reason", () => {
    const e = join(tmp, "e.md");
    writeFileSync(e, `${DRAFT}${ONE_PART}`);
    const n = local(["create", "Bad all ways", e]);
    const r = ready([repo, n]);
    expect(r.code).toBe(2);
    expect(/draft/iu.test(r.out)).toBe(true);
    expect(/parts|for the agents/iu.test(r.out)).toBe(true);
    expect(/ready label is missing/iu.test(r.out)).toBe(true);
  });

  test("an unknown id exits 1", () => {
    const r = ready([repo, "9999"]);
    expect(r.code).toBe(1);
  });

  test("one label holding a comma is not the ready mark", () => {
    const n = local(["create", "Comma label", join(tmp, "a.md")]);
    local(["label", n, "add", "blocked, ready"]);
    const r = ready([repo, n]);
    expect(r.code).toBe(2);
    expect(r.out).toContain("ready label is missing");
    local(["label", n, "add", "ready"]);
    expect(ready([repo, n]).code).toBe(0);
  });
});

describe("the marking and queue verbs", () => {
  test("marking a failing ticket exits 2 and adds no label", () => {
    const before = run(localSh, ["local", repo, "read", "3"]);
    const r = ready(["mark", repo, "3"]);
    expect(r.code).toBe(2);
    const after = run(localSh, ["local", repo, "read", "3"]);
    expect(after.out).toContain("labels: ready");
    expect(before.out.split("\n").find((l) => l.startsWith("labels:"))).toBe(
      after.out.split("\n").find((l) => l.startsWith("labels:")),
    );
  });

  test("marking a passing ticket labels, notes and queues it", () => {
    const r = ready(["mark", repo, "2"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("marked ready and queued");
    expect(run(localSh, ["local", repo, "read", "2"]).out).toContain("labels: ready");
    const ledger = readFileSync(join(repo, ".postmaster", "runs", "ledger.jsonl"), "utf8");
    expect(ledger).toContain('"action":"note"');
    expect(ledger).toContain("turnpikes: style, bug, security");
    expect(ledger).toContain('"action":"ticket-edit"');
    expect(ledger).toContain("label add ready");
    expect(ready([repo, "2"]).code).toBe(0);
    expect(ready(["pending", repo]).out.split("\n")).toContain("2");
  });

  test("mark writes a draft body and title through the adapter", () => {
    const n = local(["create", "Old title", join(tmp, "c.md")]);
    const f = join(tmp, "final.md");
    writeFileSync(f, TWO_PART);
    const r = ready(["mark", repo, n, "--body", f, "--title", "New title"]);
    expect(r.code).toBe(0);
    const read = run(localSh, ["local", repo, "read", n]).out;
    expect(read).toContain("title: New title");
    expect(read).toContain("labels: ready");
    expect(read).toContain("## For the agents");
    const ledger = readFileSync(join(repo, ".postmaster", "runs", "ledger.jsonl"), "utf8");
    expect(ledger).toContain("body updated");
    expect(ledger).toContain("title updated");
    expect(ledger).toContain("label add ready");
  });

  test("marking a commented ticket writes the draft against the stored body", () => {
    const n = local(["create", "Old title", join(tmp, "c.md")]);
    expect(run(localSh, ["local", repo, "comment", n, "coachman", "prior discussion"]).code).toBe(
      0,
    );
    const f = join(tmp, "final-commented.md");
    writeFileSync(f, TWO_PART);
    const r = ready(["mark", repo, n, "--body", f, "--title", "New title"]);
    expect(r.code).toBe(0);
    const read = run(localSh, ["local", repo, "read", n]).out;
    expect(read).toContain("title: New title");
    expect(read).toContain("labels: ready");
    expect(read).toContain("## For the agents");
    expect(ready([repo, n]).code).toBe(0);
  });

  test("a genuine Log-shaped tail binds fully: editing it refuses", () => {
    const f = join(tmp, "tailed.md");
    writeFileSync(f, `${TWO_PART}\n## Log\n- signed note\n`);
    const n = local(["create", "Tailed text", f]);
    expect(ready(["mark", repo, n]).code).toBe(0);
    expect(ready([repo, n]).code).toBe(0);
    const live = run(localSh, ["local", repo, "read", n, "--body"]);
    const baseFile = join(tmp, "tail-base.md");
    const newFile = join(tmp, "tail-new.md");
    writeFileSync(baseFile, live.out ?? "");
    writeFileSync(newFile, (live.out ?? "").replace("- signed note", "- swapped note"));
    expect(run(localSh, ["local", repo, "edit", n, newFile, baseFile]).code).toBe(0);
    const changed = ready([repo, n]);
    expect(changed.code).toBe(2);
    expect(changed.out).toContain("changed since it was signed off");
  });

  test("a post-sign-off turnpikes edit refuses until the ticket is signed off again", () => {
    const n = local(["create", "Bound text", join(tmp, "a.md")]);
    expect(ready(["mark", repo, n]).code).toBe(0);
    expect(ready([repo, n]).code).toBe(0);
    expect(ready(["queue", repo, n]).code).toBe(0);
    expect(ready(["pending", repo]).out.split("\n")).toContain(n);
    const marker = readFileSync(
      join(repo, ".postmaster", "runs", "postmaster", "ready", `${n}.ready`),
      "utf8",
    ).split("\n");
    expect(marker[0]).toBe(n);
    expect(/^[0-9a-f]{64}$/u.test(marker[1] ?? "")).toBe(true);
    // The attack: drop the review leg after sign-off.
    const live = run(localSh, ["local", repo, "read", n, "--body"]);
    const baseFile = join(tmp, "bind-base.md");
    const newFile = join(tmp, "bind-new.md");
    writeFileSync(baseFile, live.out ?? "");
    writeFileSync(
      newFile,
      (live.out ?? "").replace("## Turnpikes\n\ndefault", "## Turnpikes\n\nnone"),
    );
    expect(run(localSh, ["local", repo, "edit", n, newFile, baseFile]).code).toBe(0);
    const changed = ready([repo, n]);
    expect(changed.code).toBe(2);
    expect(changed.out).toContain("changed since it was signed off");
    // Queue does not rebind a changed ticket.
    const q = ready(["queue", repo, n]);
    expect(q.code).toBe(2);
    expect(q.out).toContain("changed since it was signed off");
    // Re-signing binds the new text.
    expect(ready(["mark", repo, n]).code).toBe(0);
    const again = ready([repo, n]);
    expect(again.code).toBe(0);
    expect(again.out).toContain("turnpikes: none");
  });

  test("a malformed marker fails closed instead of reading unbound", () => {
    const n = local(["create", "Ragged marker", join(tmp, "a.md")]);
    expect(ready(["mark", repo, n]).code).toBe(0);
    const marker = join(repo, ".postmaster", "runs", "postmaster", "ready", `${n}.ready`);
    writeFileSync(marker, `${n}\nNOT-A-DIGEST\n`);
    const bad = ready([repo, n]);
    expect(bad.code).toBe(2);
    expect(bad.out).toContain("marker for");
    expect(bad.out).toContain("is malformed");
    expect(ready(["queue", repo, n]).code).toBe(2);
    writeFileSync(marker, `${n}\n`);
    const short = ready([repo, n]);
    expect(short.code).toBe(2);
    expect(short.out).toContain("is malformed");
    // The named recovery works: unmark, then sign off again.
    expect(ready(["unmark", repo, n]).code).toBe(0);
    expect(ready(["mark", repo, n]).code).toBe(0);
    expect(ready([repo, n]).code).toBe(0);
  });

  test("a comment after sign-off stays ready, and an edit under it still refuses", () => {
    const n = local(["create", "Commented text", join(tmp, "a.md")]);
    expect(ready(["mark", repo, n]).code).toBe(0);
    expect(run(localSh, ["local", repo, "comment", n, "coachman", "noting progress"]).code).toBe(0);
    expect(ready([repo, n]).code).toBe(0);
    expect(ready(["queue", repo, n]).code).toBe(0);
    // Queue binds the stored bytes it checked, not the display body: the
    // ticket stays ready with the comment present.
    expect(ready([repo, n]).code).toBe(0);
    const live = run(localSh, ["local", repo, "read", n, "--body"]);
    const baseFile = join(tmp, "comment-base.md");
    const newFile = join(tmp, "comment-new.md");
    writeFileSync(baseFile, live.out ?? "");
    writeFileSync(
      newFile,
      (live.out ?? "").replace("## Turnpikes\n\ndefault", "## Turnpikes\n\nnone"),
    );
    expect(run(localSh, ["local", repo, "edit", n, newFile, baseFile]).code).toBe(0);
    const changed = ready([repo, n]);
    expect(changed.code).toBe(2);
    expect(changed.out).toContain("changed since it was signed off");
  });

  test("storedMatches compares with the adapter's own base check", () => {
    const n = local(["create", "Match probe", join(tmp, "a.md")]);
    const first = run(localSh, ["local", repo, "read", n, "--body"]).out ?? "";
    expect(storedMatches(repo, n, "local", first)).toBeNull();
    const baseFile = join(tmp, "match-base.md");
    const newFile = join(tmp, "match-new.md");
    writeFileSync(baseFile, first);
    writeFileSync(newFile, first.replace("## Turnpikes\n\ndefault", "## Turnpikes\n\nnone"));
    expect(run(localSh, ["local", repo, "edit", n, newFile, baseFile]).code).toBe(0);
    const reason = storedMatches(repo, n, "local", first);
    expect(reason).toContain("changed since");
    // The mark-time rollback on a mismatch needs a concurrent edit mid-mark
    // and stays untested; every mark test exercises the match path.
  });

  test("a post-sign-off title edit refuses as well", () => {
    const n = local(["create", "Bound title", join(tmp, "a.md")]);
    expect(ready(["mark", repo, n]).code).toBe(0);
    expect(run(localSh, ["local", repo, "title", n, "Bound title, revised"]).code).toBe(0);
    const changed = ready([repo, n]);
    expect(changed.code).toBe(2);
    expect(changed.out).toContain("changed since it was signed off");
  });

  test("unmark drops the label and the marker, consume drops only the marker", () => {
    const r = ready(["unmark", repo, "2"]);
    expect(r.code).toBe(0);
    expect(run(localSh, ["local", repo, "read", "2"]).out).toContain("labels: \n");
    const ledger = readFileSync(join(repo, ".postmaster", "runs", "ledger.jsonl"), "utf8");
    expect(ledger).toContain("label remove ready");
    expect(ready(["pending", repo]).out.split("\n").includes("2")).toBe(false);
    expect(ready([repo, "2"]).code).toBe(2);
    expect(ready(["mark", repo, "2"]).code).toBe(0);
    expect(ready(["consume", repo, "2"]).code).toBe(0);
    expect(run(localSh, ["local", repo, "read", "2"]).out).toContain("labels: ready");
    expect(ready(["pending", repo]).out.split("\n").includes("2")).toBe(false);
  });

  test("queue checks before it queues", () => {
    expect(ready(["queue", repo, "3"]).code).toBe(2);
    expect(ready(["pending", repo]).out.split("\n").includes("3")).toBe(false);
    expect(ready(["queue", repo, "1"]).code).toBe(0);
    expect(ready(["pending", repo]).out.split("\n")).toContain("1");
  });
});

describe("a tracker of kind other", () => {
  test("a body file and label list read ready and unready", () => {
    const a = join(tmp, "a.md");
    const good = ready([
      "--body",
      a,
      "--labels",
      "ready",
      "--title",
      "Sorted list",
      "--project",
      repo,
      "--id",
      "EXT-9",
    ]);
    expect(good.code).toBe(0);
    const bad = ready([
      "--body",
      a,
      "--labels",
      "",
      "--title",
      "Sorted list",
      "--project",
      repo,
      "--id",
      "EXT-9",
    ]);
    expect(bad.code).toBe(2);
    expect(bad.out).toContain("ready label is missing");
  });

  test("each --labels flag names one label, and a lone comma flag is refused", () => {
    const a = join(tmp, "a.md");
    const base = ["--body", a, "--title", "Sorted list", "--project", repo, "--id", "EXT-8"];
    const lone = ready([...base, "--labels", "blocked, ready"]);
    expect(lone.code).toBe(1);
    expect(lone.out).toContain("is ambiguous; pass --labels once per label");
    const exact = ready([...base, "--labels", "blocked, ready", "--labels", "other"]);
    expect(exact.code).toBe(2);
    expect(exact.out).toContain("ready label is missing");
    const marked = ready([...base, "--labels", "blocked, ready", "--labels", "ready"]);
    expect(marked.code).toBe(0);
    const plain = ready([...base, "--labels", "ready"]);
    expect(plain.code).toBe(0);
  });

  test("mark records the marking once the label is applied outside", () => {
    const a = join(tmp, "a.md");
    const early = ready(["mark", "--body", a, "--labels", "", "--repo", repo, "--id", "EXT-1"]);
    expect(early.code).toBe(2);
    expect(early.out).toContain("through the tracker's own tooling");
    const r = ready(["mark", "--body", a, "--labels", "ready", "--repo", repo, "--id", "EXT-1"]);
    expect(r.code).toBe(0);
    expect(ready(["pending", repo]).out.split("\n")).toContain("EXT-1");
  });

  test("a queue write that fails arms no clerk close", () => {
    const a = join(tmp, "a.md");
    const clerks = join(repo, ".postmaster", "runs", "postmaster", "clerks");
    mkdirSync(clerks, { recursive: true });
    writeFileSync(
      join(clerks, "EXT-ARM.json"),
      `${JSON.stringify({ ticket: "#EXT-ARM, x", brief: join(repo, "b.md"), handle: "clerk-arm", opened: "2026-10-09T00:00:00.000Z" })}\n`,
    );
    const readyDir = join(repo, ".postmaster", "runs", "postmaster", "ready");
    mkdirSync(readyDir, { recursive: true });
    chmodSync(readyDir, 0o555);
    try {
      const r = ready([
        "mark",
        "--body",
        a,
        "--labels",
        "ready",
        "--repo",
        repo,
        "--id",
        "EXT-ARM",
      ]);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain(".ready");
      expect(r.out).not.toContain("closes when its turn ends");
      const record = JSON.parse(readFileSync(join(clerks, "EXT-ARM.json"), "utf8")) as Record<
        string,
        unknown
      >;
      expect("closing" in record).toBe(false);
    } finally {
      chmodSync(readyDir, 0o755);
    }
  });

  test("a body changed after marking refuses until marked again", () => {
    const f = join(tmp, "bind-other.md");
    writeFileSync(f, readFileSync(join(tmp, "a.md"), "utf8"));
    const markArgs = (file: string) => [
      "mark",
      "--body",
      file,
      "--labels",
      "ready",
      "--repo",
      repo,
      "--id",
      "EXT-7",
      "--title",
      "Sorted list",
    ];
    const checkArgs = (file: string) => [
      "--body",
      file,
      "--labels",
      "ready",
      "--title",
      "Sorted list",
      "--project",
      repo,
      "--id",
      "EXT-7",
    ];
    expect(ready(markArgs(f)).code).toBe(0);
    expect(ready(checkArgs(f)).code).toBe(0);
    writeFileSync(
      f,
      readFileSync(f, "utf8").replace("## Turnpikes\n\ndefault", "## Turnpikes\n\nnone"),
    );
    const changed = ready(checkArgs(f));
    expect(changed.code).toBe(2);
    expect(changed.out).toContain("changed since it was signed off");
    expect(ready(markArgs(f)).code).toBe(0);
    const again = ready(checkArgs(f));
    expect(again.code).toBe(0);
    expect(again.out).toContain("turnpikes: none");
  });

  test("a malformed marker on the body form names the external recovery", () => {
    const a = join(tmp, "a.md");
    const markArgs = [
      "mark",
      "--body",
      a,
      "--labels",
      "ready",
      "--repo",
      repo,
      "--id",
      "EXT-6",
      "--title",
      "Sorted list",
    ];
    expect(ready(markArgs).code).toBe(0);
    const marker = join(repo, ".postmaster", "runs", "postmaster", "ready", "EXT-6.ready");
    writeFileSync(marker, "EXT-6\nbogus\n");
    const checkArgs = [
      "--body",
      a,
      "--labels",
      "ready",
      "--title",
      "Sorted list",
      "--project",
      repo,
      "--id",
      "EXT-6",
    ];
    const bad = ready(checkArgs);
    expect(bad.code).toBe(2);
    expect(bad.out).toContain("is malformed");
    expect(bad.out).toContain("through the tracker's own tooling");
  });

  test("the check without a project or id is refused", () => {
    const a = join(tmp, "a.md");
    expect(ready(["--body", a, "--labels", "ready", "--project", repo]).code).toBe(1);
    expect(ready(["--body", a, "--labels", "ready", "--id", "EXT-9"]).code).toBe(1);
  });

  test("the adapter verbs refuse with the body-and-labels form", () => {
    const otherRepo = join(tmp, "other-repo");
    mkdirSync(otherRepo, { recursive: true });
    if (run("git", ["init", "-q", otherRepo]).code !== 0) throw new Error("git init failed");
    const cfg = join(tmp, "other-config.toml");
    writeFileSync(cfg, '[tracker]\nkind = "other"\n');
    const env = { ...process.env, POSTMASTER_CONFIG: cfg };
    for (const args of [
      [otherRepo, "EXT-1"],
      ["mark", otherRepo, "EXT-1"],
      ["queue", otherRepo, "EXT-1"],
      ["unmark", otherRepo, "EXT-1"],
    ]) {
      const r = ready(args, env);
      expect(r.code).toBe(1);
      expect(r.out).toContain("has no adapter script");
    }
    expect(ready([otherRepo, "EXT-1"], env).out).toContain("run ticket-ready --body <file>");
    expect(ready(["mark", otherRepo, "EXT-1"], env).out).toContain(
      "run ticket-ready mark --body <file>",
    );
    expect(ready(["unmark", otherRepo, "EXT-1"], env).out).toContain("run ticket-ready consume ");
  });
});

describe("usage", () => {
  test("no arguments and bad verbs exit 1", () => {
    expect(ready([]).code).toBe(1);
    expect(ready(["mark", repo]).code).toBe(1);
    expect(ready([repo]).code).toBe(1);
  });

  test("a flag in a value's place is refused", () => {
    const a = join(tmp, "a.md");
    const r = ready(["--body", a, "--labels", "ready", "--title", "--project", repo]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("--title needs a value; got --project");
    const m = ready(["mark", repo, "1", "--title", "--body", a]);
    expect(m.code).toBe(1);
    expect(m.out).toContain("--title needs a value; got --body");
  });
});

// --- the same matrix through the github and plane test doubles ---

const STUB_GH = `#!/usr/bin/env bash
d="$GITHUB_SH_STUB"
case "$1 $2" in
  "auth status") exit 0 ;;
  "api graphql")
    q="" n=""
    for a in "$@"; do case $a in query=*) q=$a ;; number=*) n=\${a#number=} ;; esac; done
    case $q in
      *projectsV2*) cat "$d/boards.json" ;;
      *"issue(number:"*) if [ -f "$d/issue-$n.json" ]; then cat "$d/issue-$n.json"
                         else echo '{"data": {"repository": {"issue": null}}}'; fi ;;
      *) echo "stub gh: unexpected query" >&2; exit 1 ;;
    esac ;;
  "project item-list") cat "$d/items.json" ;;
  "issue edit")
    f="" prev="" body=0
    for a in "$@"; do [ "$prev" = --body-file ] && { f=$a; body=1; }; prev=$a; done
    printf 'call:%s\\n' "$(printf ' [%s]' "$@")" >> "$d/edits.log"
    if [ $body = 1 ]; then cp -- "$f" "$d/edited-body"; fi ;;
  "api "*)
    case "$*" in
      "api repos/o/r/labels/"*) echo '{}' ;;
      "api -X POST repos/o/r/issues/"*) echo '[]' ;;
      *) echo "stub gh: unexpected REST call: $*" >&2; exit 1 ;;
    esac ;;
  *) echo "stub gh: unexpected: $*" >&2; exit 1 ;;
esac
`;

function storedIssue(dir: string, n: number, bodyFile: string, labels: string[]): void {
  const body = readFileSync(bodyFile, "utf8");
  const obj = {
    data: {
      repository: {
        issue: {
          number: n,
          title: n === 2 ? "Fix the list" : `Ticket ${n}`,
          body,
          state: "OPEN",
          stateReason: null,
          url: `https://github.com/o/r/issues/${n}`,
          createdAt: "2026-10-03T00:00:00Z",
          labels: { nodes: labels.map((name) => ({ name })) },
          comments: { nodes: [] },
        },
      },
    },
  };
  writeFileSync(join(dir, `issue-${n}.json`), `${JSON.stringify(obj)}\n`);
}

describe("the matrix through the github double", () => {
  test("ready, unready, one-part, draft and unknown read the same", () => {
    const dir = join(tmp, "gh-double");
    const bin = join(dir, "bin");
    const stub = join(dir, "stub");
    const repoGh = join(dir, "repo");
    mkdirSync(bin, { recursive: true });
    mkdirSync(stub, { recursive: true });
    mkdirSync(repoGh, { recursive: true });
    writeFileSync(join(bin, "gh"), STUB_GH);
    chmodSync(join(bin, "gh"), 0o755);
    if (run("git", ["init", "-q", repoGh]).code !== 0) throw new Error("git init failed");
    if (
      run("git", ["-C", repoGh, "remote", "add", "origin", "https://github.com/o/r.git"]).code !== 0
    )
      throw new Error("git remote add failed");
    const cfg = join(dir, "config.toml");
    writeFileSync(cfg, '[tracker]\nkind = "github"\n');
    writeFileSync(
      join(stub, "boards.json"),
      '{"data": {"repository": {"projectsV2": {"nodes": [{"id": "PVT_1", "number": 1, "title": "r", "closed": false, "url": "https://github.com/users/o/projects/1", "owner": {"login": "o"}}]}}}}\n',
    );
    writeFileSync(join(stub, "items.json"), '{"items": []}\n');
    storedIssue(stub, 1, join(tmp, "a.md"), ["ready"]);
    storedIssue(stub, 2, join(tmp, "a.md"), []);
    storedIssue(stub, 3, join(tmp, "c.md"), ["ready"]);
    storedIssue(stub, 4, join(tmp, "d.md"), ["ready"]);
    storedIssue(stub, 5, join(tmp, "a.md"), ["blocked, ready"]);
    const env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      POSTMASTER_CONFIG: cfg,
      GITHUB_SH_STUB: stub,
    };
    expect(ready([repoGh, "1"], env).code).toBe(0);
    const unmarked = ready([repoGh, "2"], env);
    expect(unmarked.code).toBe(2);
    expect(unmarked.out).toContain("ready label is missing");
    const onePart = ready([repoGh, "3"], env);
    expect(onePart.code).toBe(2);
    expect(onePart.out).toContain("ticket-parts:");
    const draft = ready([repoGh, "4"], env);
    expect(draft.code).toBe(2);
    expect(/draft/iu.test(draft.out)).toBe(true);
    expect(ready([repoGh, "9999"], env).code).toBe(1);
    const comma = ready([repoGh, "5"], env);
    expect(comma.code).toBe(2);
    expect(comma.out).toContain("ready label is missing");
    // Mark through the double exercises the post-write verify on github
    // semantics: the no-op edit must match.
    expect(ready(["mark", repoGh, "1"], env).code).toBe(0);
    expect(ready([repoGh, "1"], env).code).toBe(0);
  });
});

type StubItem = {
  id: string;
  sequence_id: number;
  name: string;
  description_html: string;
  project: string;
  state: string;
  labels: string[];
  created_at: string;
};

function startPlaneStub(items: Record<string, StubItem>) {
  const labels = [
    { id: "l-1", name: "ready" },
    { id: "l-2", name: "blocked, ready" },
  ];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const u = new URL(req.url);
      const p = u.pathname;
      const j = (v: unknown) => Response.json(v);
      if (req.method === "GET" && p === "/api/v1/workspaces/ws/projects/")
        return j({ results: [{ id: "p1", identifier: "PM" }], next_page_results: false });
      if (req.method === "GET" && p === "/api/v1/workspaces/ws/projects/p1/states/")
        return j({
          results: [
            { id: "s-todo", group: "unstarted", sequence: 1 },
            { id: "s-prog", group: "started", sequence: 1 },
            { id: "s-done", group: "completed", sequence: 1 },
            { id: "s-cancel", group: "cancelled", sequence: 1 },
          ],
          next_page_results: false,
        });
      if (req.method === "GET" && p === "/api/v1/workspaces/ws/projects/p1/labels/")
        return j({ results: labels, next_page_results: false });
      const mItem = /^\/api\/v1\/workspaces\/ws\/work-items\/([A-Z]+-[0-9]+)\/$/u.exec(p);
      if (req.method === "GET" && mItem) {
        const it = items[mItem[1]!];
        if (!it) return new Response("no such item", { status: 404 });
        return j(it);
      }
      const mComments =
        /^\/api\/v1\/workspaces\/ws\/projects\/p1\/work-items\/([^/]+)\/comments\/$/u.exec(p);
      if (req.method === "GET" && mComments) return j({ results: [], next_page_results: false });
      const mPatch = /^\/api\/v1\/workspaces\/ws\/projects\/p1\/work-items\/([^/]+)\/$/u.exec(p);
      if (req.method === "PATCH" && mPatch) {
        const it = Object.values(items).find((v) => v.id === mPatch[1]);
        if (!it) return new Response("no such item", { status: 404 });
        Object.assign(it, JSON.parse(await req.text()) as Record<string, unknown>);
        return j(it);
      }
      return new Response(`stub plane: unexpected ${req.method} ${p}`, { status: 500 });
    },
  });
  return { server, url: `http://127.0.0.1:${server.port}` };
}

function planeItem(n: number, bodyFile: string, labels: string[]): StubItem {
  return {
    id: `item-${n}`,
    sequence_id: n,
    name: n === 2 ? "Fix the list" : `Ticket ${n}`,
    description_html: mdToHtml(readFileSync(bodyFile, "utf8")),
    project: "p1",
    state: "s-todo",
    labels,
    created_at: "2026-10-03T00:00:00Z",
  };
}

describe("the matrix through the plane double", () => {
  test("ready, unready, one-part, draft and unknown read the same", async () => {
    const { server, url } = startPlaneStub({
      "PM-1": planeItem(1, join(tmp, "a.md"), ["l-1"]),
      "PM-2": planeItem(2, join(tmp, "a.md"), []),
      "PM-3": planeItem(3, join(tmp, "c.md"), ["l-1"]),
      "PM-4": planeItem(4, join(tmp, "d.md"), ["l-1"]),
      "PM-5": planeItem(5, join(tmp, "a.md"), ["l-2"]),
    });
    try {
      const dir = join(tmp, "plane-double");
      mkdirSync(dir, { recursive: true });
      const repoPl = join(dir, "repo");
      mkdirSync(repoPl, { recursive: true });
      if (run("git", ["init", "-q", repoPl]).code !== 0) throw new Error("git init failed");
      const cfg = join(dir, "config.toml");
      writeFileSync(cfg, `[tracker]\nkind = "plane"\nurl = "${url}"\nworkspace = "ws"\n`);
      const env: Record<string, string | undefined> = {
        ...process.env,
        POSTMASTER_CONFIG: cfg,
        PLANE_API_KEY: "self-test",
      };
      delete env.POSTMASTER_PROJECT;
      env.GIT_CEILING_DIRECTORIES = dir;
      const r1 = await readyAsync([repoPl, "PM-1"], env);
      expect(r1.code).toBe(0);
      const unmarked = await readyAsync([repoPl, "PM-2"], env);
      expect(unmarked.code).toBe(2);
      expect(unmarked.out).toContain("ready label is missing");
      const onePart = await readyAsync([repoPl, "PM-3"], env);
      expect(onePart.code).toBe(2);
      expect(onePart.out).toContain("ticket-parts:");
      const draft = await readyAsync([repoPl, "PM-4"], env);
      expect(draft.code).toBe(2);
      expect(/draft/iu.test(draft.out)).toBe(true);
      expect((await readyAsync([repoPl, "PM-9999"], env)).code).toBe(1);
      const comma = await readyAsync([repoPl, "PM-5"], env);
      expect(comma.code).toBe(2);
      expect(comma.out).toContain("ready label is missing");
      // Mark through the double exercises the post-write verify on plane
      // semantics: the no-op edit must match the rendered body.
      expect((await readyAsync(["mark", repoPl, "PM-1"], env)).code).toBe(0);
      expect((await readyAsync([repoPl, "PM-1"], env)).code).toBe(0);
    } finally {
      server.stop(true);
    }
  });
});

async function readyAsync(args: string[], env?: Record<string, string | undefined>) {
  // Async spawn: the in-process stub API can only answer while this loop runs.
  const p = Bun.spawn([self, "ticket-ready", ...args], {
    env: env as Record<string, string>,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  return { code, out: `${out}${err}` };
}

// --- the mark through a github double that keeps what is written to it ---
//
// STUB_GH above answers its REST label calls without changing anything and
// never updates issue-<n>.json, so a mark followed by a check passes on the
// newline bug. This double applies --body-file edits, --title edits and the
// label calls to issue-<n>.json with python3, so the bytes on disk are what the
// next read sees. GH_CORRUPT_BODY=1 stores each written body with one
// trailing space added to its first line, GH_CORRUPT_TITLE=1 stores each
// written title with one character added, a swap-once/swap-body pair
// replaces the stored body once right after the next body write,
// GH_SWAP_ON_READ=N replaces it once from swap-body before serving the
// Nth issue read, and GH_REFUSE_FROM=N refuses every issue read from
// the Nth one on.

const STUB_GH_KEEPING = `#!/usr/bin/env bash
d="$GITHUB_SH_STUB"
py_json() {
  python3 - "$@" <<'PYEOF' || return 1
import json
import sys


def load(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def save(path, doc):
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(json.dumps(doc, ensure_ascii=False) + "\\n")


def ascii_lower(s):
    return "".join(chr(ord(c) + 32) if "A" <= c <= "Z" else c for c in s)


op = sys.argv[1]
path = sys.argv[2]
doc = load(path)
issue = doc["data"]["repository"]["issue"]
if op == "body":
    with open(sys.argv[3], "rb") as fh:
        issue["body"] = fh.read().decode("utf-8")
elif op == "title":
    issue["title"] = sys.argv[3]
elif op == "label-add":
    name = sys.argv[3]
    nodes = issue["labels"]["nodes"]
    if not any(ascii_lower(n.get("name", "")) == ascii_lower(name) for n in nodes):
        nodes.append({"name": name})
elif op == "label-remove":
    name = sys.argv[3]
    issue["labels"]["nodes"] = [
        n for n in issue["labels"]["nodes"] if ascii_lower(n.get("name", "")) != ascii_lower(name)
    ]
save(path, doc)
PYEOF
}
case "$1 $2" in
  "auth status") exit 0 ;;
  "api graphql")
    q="" n=""
    for a in "$@"; do
      case "$a" in
        query=*) q="$a" ;;
        number=*) n=$(echo "$a" | cut -d= -f2-) ;;
      esac
    done
    case "$q" in
      *projectsV2*) cat "$d/boards.json" ;;
      *"issue(number:"*)
        count_file="$d/read-count"
        count=0
        if [ -f "$count_file" ]; then count=$(cat "$count_file"); fi
        count=$((count+1))
        echo "$count" > "$count_file"
        echo "read:$count:$n" >> "$d/reads.log"
        if [ -n "$GH_REFUSE_FROM" ]; then
          if [ "$count" -ge "$GH_REFUSE_FROM" ]; then
            echo "stub gh: rate limit, refusing issue read" >&2
            exit 1
          fi
        fi
        if [ -n "$GH_SWAP_ON_READ" ] && [ "$count" -eq "$GH_SWAP_ON_READ" ] && [ ! -f "$d/swapped" ]; then
          py_json body "$d/issue-$n.json" "$d/swap-body" || exit 1
          touch "$d/swapped"
        fi
        if [ -f "$d/issue-$n.json" ]; then cat "$d/issue-$n.json"
        else echo '{"data": {"repository": {"issue": null}}}'; fi ;;
      *) echo "stub gh: unexpected query" >&2; exit 1 ;;
    esac ;;
  "project item-list") cat "$d/items.json" ;;
  "issue edit")
    n="$3"
    bodyfile=""
    title=""
    prev=""
    for a in "$@"; do
      if [ "$prev" = "--body-file" ]; then bodyfile="$a"; fi
      if [ "$prev" = "--title" ]; then title="$a"; fi
      prev="$a"
    done
    printf 'call:%s\\n' "$(printf ' [%s]' "$@")" >> "$d/edits.log"
    if [ -n "$bodyfile" ]; then
      src="$bodyfile"
      if [ "$GH_CORRUPT_BODY" = "1" ]; then
        corrupted="$d/corrupted-body-$n"
        sed '1s/$/ /' "$bodyfile" > "$corrupted"
        src="$corrupted"
      fi
      py_json body "$d/issue-$n.json" "$src" || exit 1
      if [ -f "$d/swap-once" ]; then
        py_json body "$d/issue-$n.json" "$d/swap-body" || exit 1
        rm "$d/swap-once"
      fi
    fi
    if [ -n "$title" ]; then
      t="$title"
      if [ "$GH_CORRUPT_TITLE" = "1" ]; then t="$t"X; fi
      py_json title "$d/issue-$n.json" "$t" || exit 1
    fi
    ;;
  "api "*)
    case "$*" in
      "api repos/o/r/labels/"*) echo '{}' ;;
      "api -X POST repos/o/r/issues/"*)
        n=""
        name=""
        for a in "$@"; do
          case "$a" in
            repos/o/r/issues/*/labels) n=$(echo "$a" | cut -d/ -f5) ;;
            labels[]=*) name=$(echo "$a" | cut -d= -f2-) ;;
          esac
        done
        py_json label-add "$d/issue-$n.json" "$name" || exit 1
        echo '[]' ;;
      "api -X DELETE repos/o/r/issues/"*)
        n=""
        name=""
        for a in "$@"; do
          case "$a" in
            repos/o/r/issues/*/labels/*) n=$(echo "$a" | cut -d/ -f5); name=$(echo "$a" | cut -d/ -f7) ;;
          esac
        done
        py_json label-remove "$d/issue-$n.json" "$name" || exit 1
        echo '{}' ;;
      *) echo "stub gh: unexpected REST call: $*" >&2; exit 1 ;;
    esac ;;
  *) echo "stub gh: unexpected: $*" >&2; exit 1 ;;
esac
`;

function setupKeepingDouble(name: string): {
  dir: string;
  stub: string;
  repoGh: string;
  cfg: string;
  env: Record<string, string | undefined>;
} {
  const dir = join(tmp, name);
  const bin = join(dir, "bin");
  const stub = join(dir, "stub");
  const repoGh = join(dir, "repo");
  mkdirSync(bin, { recursive: true });
  mkdirSync(stub, { recursive: true });
  mkdirSync(repoGh, { recursive: true });
  writeFileSync(join(bin, "gh"), STUB_GH_KEEPING);
  chmodSync(join(bin, "gh"), 0o755);
  if (run("git", ["init", "-q", repoGh]).code !== 0) throw new Error("git init failed");
  if (
    run("git", ["-C", repoGh, "remote", "add", "origin", "https://github.com/o/r.git"]).code !== 0
  )
    throw new Error("git remote add failed");
  const cfg = join(dir, "config.toml");
  writeFileSync(cfg, '[tracker]\nkind = "github"\n');
  writeFileSync(
    join(stub, "boards.json"),
    '{"data": {"repository": {"projectsV2": {"nodes": [{"id": "PVT_1", "number": 1, "title": "r", "closed": false, "url": "https://github.com/users/o/projects/1", "owner": {"login": "o"}}]}}}}\n',
  );
  writeFileSync(join(stub, "items.json"), '{"items": []}\n');
  const env: Record<string, string | undefined> = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    POSTMASTER_CONFIG: cfg,
    GITHUB_SH_STUB: stub,
  };
  return { dir, stub, repoGh, cfg, env };
}

function keepingIssue(
  stub: string,
  n: number,
  body: string,
  title: string,
  labels: string[],
): void {
  const obj = {
    data: {
      repository: {
        issue: {
          number: n,
          title,
          body,
          state: "OPEN",
          stateReason: null,
          url: `https://github.com/o/r/issues/${n}`,
          createdAt: "2026-10-03T00:00:00Z",
          labels: { nodes: labels.map((name) => ({ name })) },
          comments: { nodes: [] },
        },
      },
    },
  };
  writeFileSync(join(stub, `issue-${n}.json`), `${JSON.stringify(obj)}\n`);
}

function storedBody(stub: string, n: number): string {
  const raw = readFileSync(join(stub, `issue-${n}.json`), "utf8");
  const obj = JSON.parse(raw) as { data: { repository: { issue: { body: string } } } };
  return obj.data.repository.issue.body;
}

function storedLabels(stub: string, n: number): string[] {
  const raw = readFileSync(join(stub, `issue-${n}.json`), "utf8");
  const obj = JSON.parse(raw) as {
    data: { repository: { issue: { labels: { nodes: Array<{ name: string }> } } } };
  };
  return obj.data.repository.issue.labels.nodes.map((x) => x.name);
}

function hasMarker(repoGh: string, n: number | string): boolean {
  try {
    readFileSync(join(repoGh, ".postmaster", "runs", "postmaster", "ready", `${n}.ready`), "utf8");
    return true;
  } catch {
    return false;
  }
}

function bodyWrites(stub: string, n: number): number {
  let log = "";
  try {
    log = readFileSync(join(stub, "edits.log"), "utf8");
  } catch {
    return 0;
  }
  const needle1 = `[${n}]`;
  const needle2 = "[--body-file]";
  return log.split("\n").filter((l) => l.includes(needle1) && l.includes(needle2)).length;
}

function readCount(stub: string): number {
  try {
    return Number(readFileSync(join(stub, "read-count"), "utf8").trim() || "0");
  } catch {
    return 0;
  }
}

describe("the mark through a github double that keeps writes (C1-C4, C7-C9)", () => {
  test("C1+C2: marking adds no newline, and the check and queue pass right after", () => {
    const { stub, repoGh, env } = setupKeepingDouble("gh-keeping-c1");
    const draftFile = join(tmp, "gh-keeping-c1-draft.md");
    writeFileSync(draftFile, TWO_PART);
    keepingIssue(stub, 10, TWO_PART, "Ticket 10", []);
    keepingIssue(stub, 11, TWO_PART.slice(0, -1), "Ticket 11", []);
    keepingIssue(stub, 12, ONE_PART, "Ticket 12", []);
    const beforeA = storedBody(stub, 10);
    const beforeB = storedBody(stub, 11);
    const ma = ready(["mark", repoGh, "10"], env);
    expect(ma.code).toBe(0);
    expect(storedBody(stub, 10)).toBe(beforeA);
    const mb = ready(["mark", repoGh, "11", "--body", draftFile, "--title", "Ticket 11"], env);
    expect(mb.code).toBe(0);
    expect(storedBody(stub, 11)).toBe(beforeB);
    const mc = ready(["mark", repoGh, "12", "--body", draftFile, "--title", "Ticket 12"], env);
    expect(mc.code).toBe(0);
    expect(storedBody(stub, 12)).toBe(TWO_PART);
    expect(bodyWrites(stub, 12)).toBe(1);
    expect(bodyWrites(stub, 10)).toBe(0);
    expect(bodyWrites(stub, 11)).toBe(0);
    const beforeA2 = storedBody(stub, 10);
    const ma2 = ready(["mark", repoGh, "10"], env);
    expect(ma2.code).toBe(0);
    expect(storedBody(stub, 10)).toBe(beforeA2);
    for (const n of ["10", "11", "12"]) {
      const chk = ready([repoGh, n], env);
      expect(chk.code).toBe(0);
      expect(chk.out).toContain(`ready: ${n}`);
      const q = ready(["queue", repoGh, n], env);
      expect(q.code).toBe(0);
    }
  }, 120000);

  test("C3: one added newline, or a changed title, still refuses", () => {
    const { stub, repoGh, env } = setupKeepingDouble("gh-keeping-c3");
    const draftFile = join(tmp, "gh-keeping-c3-draft.md");
    writeFileSync(draftFile, TWO_PART);
    keepingIssue(stub, 13, ONE_PART, "Ticket 13", []);
    keepingIssue(stub, 14, ONE_PART, "Ticket 14", []);
    expect(
      ready(["mark", repoGh, "13", "--body", draftFile, "--title", "Ticket 13"], env).code,
    ).toBe(0);
    expect(
      ready(["mark", repoGh, "14", "--body", draftFile, "--title", "Ticket 14"], env).code,
    ).toBe(0);
    expect(ready([repoGh, "13"], env).code).toBe(0);
    const raw13 = readFileSync(join(stub, "issue-13.json"), "utf8");
    const obj13 = JSON.parse(raw13) as { data: { repository: { issue: { body: string } } } };
    obj13.data.repository.issue.body = `${obj13.data.repository.issue.body}\n`;
    writeFileSync(join(stub, "issue-13.json"), `${JSON.stringify(obj13)}\n`);
    const changed = ready([repoGh, "13"], env);
    expect(changed.code).toBe(2);
    expect(changed.out).toContain("changed since it was signed off");
    const raw14 = readFileSync(join(stub, "issue-14.json"), "utf8");
    const obj14 = JSON.parse(raw14) as { data: { repository: { issue: { title: string } } } };
    obj14.data.repository.issue.title = `${obj14.data.repository.issue.title} revised`;
    writeFileSync(join(stub, "issue-14.json"), `${JSON.stringify(obj14)}\n`);
    const changedT = ready([repoGh, "14"], env);
    expect(changedT.code).toBe(2);
    expect(changedT.out).toContain("changed since it was signed off");
  }, 120000);

  test("C4: a concurrent edit during the mark undoes it", () => {
    const { stub, repoGh, env } = setupKeepingDouble("gh-keeping-c4");
    const draftFile = join(tmp, "gh-keeping-c4-draft.md");
    writeFileSync(draftFile, TWO_PART);
    keepingIssue(stub, 15, ONE_PART, "Ticket 15", []);
    writeFileSync(join(stub, "swap-once"), "");
    writeFileSync(
      join(stub, "swap-body"),
      TWO_PART.replace("## Turnpikes\n\ndefault", "## Turnpikes\n\nnone"),
    );
    const m = ready(["mark", repoGh, "15", "--body", draftFile, "--title", "Ticket 15"], env);
    expect(m.code).toBe(1);
    expect(m.out).toContain("changed while it was being marked");
    expect(storedLabels(stub, 15).some((l) => l.toLowerCase() === "ready")).toBe(false);
    expect(hasMarker(repoGh, 15)).toBe(false);
  }, 60000);

  test("C7+C9: a stored body or title differing by one character refuses with the place", () => {
    const { stub, repoGh, env } = setupKeepingDouble("gh-keeping-c7");
    const draftFile = join(tmp, "gh-keeping-c7-draft.md");
    writeFileSync(draftFile, TWO_PART);
    keepingIssue(stub, 16, ONE_PART, "Ticket 16", []);
    keepingIssue(stub, 17, ONE_PART, "Old title", []);
    const envBody = { ...env, GH_CORRUPT_BODY: "1" };
    const mb = ready(["mark", repoGh, "16", "--body", draftFile, "--title", "Ticket 16"], envBody);
    expect(mb.code).not.toBe(0);
    expect(storedLabels(stub, 16).some((l) => l.toLowerCase() === "ready")).toBe(false);
    expect(hasMarker(repoGh, 16)).toBe(false);
    expect(mb.out.toLowerCase()).toContain("body");
    expect(mb.out.toLowerCase()).toContain("line");
    const envTitle = { ...env, GH_CORRUPT_TITLE: "1" };
    const mt = ready(["mark", repoGh, "17", "--body", draftFile, "--title", "New title"], envTitle);
    expect(mt.code).not.toBe(0);
    expect(storedLabels(stub, 17).some((l) => l.toLowerCase() === "ready")).toBe(false);
    expect(hasMarker(repoGh, 17)).toBe(false);
    expect(mt.out.toLowerCase()).toContain("title");
  }, 120000);

  test("C8: a refused read leaves both the label and the marker, or neither", () => {
    const { stub, repoGh, env } = setupKeepingDouble("gh-keeping-c8");
    const draftFile = join(tmp, "gh-keeping-c8-draft.md");
    writeFileSync(draftFile, TWO_PART);
    for (let n = 20; n < 40; n++) keepingIssue(stub, n, ONE_PART, "Fresh title", []);
    try {
      rmSync(join(stub, "read-count"), { force: true });
    } catch {
      // Fresh double: nothing to reset.
    }
    try {
      rmSync(join(stub, "reads.log"), { force: true });
    } catch {
      // Fresh double: nothing to reset.
    }
    const ok = ready(["mark", repoGh, "20", "--body", draftFile, "--title", "Fresh title"], env);
    expect(ok.code).toBe(0);
    const reads = readCount(stub);
    expect(reads).toBeGreaterThan(0);
    for (let n = 1; n <= reads + 1; n++) {
      const ticket = 20 + n;
      try {
        rmSync(join(stub, "read-count"), { force: true });
      } catch {
        // Reset between marks.
      }
      const envN = { ...env, GH_REFUSE_FROM: String(n) };
      const m = ready(
        ["mark", repoGh, String(ticket), "--body", draftFile, "--title", "Fresh title"],
        envN,
      );
      const labelled = storedLabels(stub, ticket).some((l) => l.toLowerCase() === "ready");
      const marked = hasMarker(repoGh, ticket);
      expect(labelled).toBe(marked);
      if (m.code === 0) {
        expect(labelled).toBe(true);
        expect(storedBody(stub, ticket)).toBe(TWO_PART);
      } else {
        expect(labelled).toBe(false);
        expect(m.out.toLowerCase()).toContain("could not");
        expect(m.out.toLowerCase()).toContain("read");
      }
    }
  }, 180000);

  test("the keeping double marks with jq shadowed by a failing one", () => {
    const { stub, repoGh, env } = setupKeepingDouble("gh-keeping-nojq");
    const fakeBin = join(tmp, "gh-keeping-nojq-fakebin");
    mkdirSync(fakeBin, { recursive: true });
    const fakeJq = join(fakeBin, "jq");
    writeFileSync(fakeJq, '#!/usr/bin/env bash\necho "jq: command not found" >&2\nexit 127\n');
    chmodSync(fakeJq, 0o755);
    keepingIssue(stub, 50, TWO_PART, "Ticket 50", []);
    const envNoJq = { ...env, PATH: `${fakeBin}:${env.PATH ?? ""}` };
    const m = ready(["mark", repoGh, "50"], envNoJq);
    expect(m.code).toBe(0);
    const chk = ready([repoGh, "50"], envNoJq);
    expect(chk.code).toBe(0);
    expect(chk.out).toContain("ready: 50");
  }, 60000);

  test("a no-write concurrent edit refuses with the differing line", () => {
    const { stub, repoGh, env } = setupKeepingDouble("gh-keeping-nowrite");
    keepingIssue(stub, 51, TWO_PART, "Ticket 51", []);
    writeFileSync(
      join(stub, "swap-body"),
      TWO_PART.replace("## Problem / feature", "## Problem / FEATURE"),
    );
    const envSwap = { ...env, GH_SWAP_ON_READ: "3" };
    const m = ready(["mark", repoGh, "51"], envSwap);
    expect(m.code).toBe(1);
    expect(m.out).toContain("changed while it was being marked");
    expect(m.out).toContain("the body differs at line 1");
    expect(storedLabels(stub, 51).some((l) => l.toLowerCase() === "ready")).toBe(false);
    expect(hasMarker(repoGh, 51)).toBe(false);
  }, 60000);
});
