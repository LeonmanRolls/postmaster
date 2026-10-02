// Tests beside scripts/parallel-runs-acceptance.ts, moved from its --self-test on #109: 55 controls.
// Each fault control builds its own copy of the clean tree, so tests pass alone and in order.
// The two usage controls spawn the wrapper; every other control calls accept() directly.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toolRoot } from "./lib/paths.ts";
import { accept } from "./parallel-runs-acceptance";

const wrapper = join(import.meta.dir, "parallel-runs-acceptance.sh");
const ROOT = toolRoot(import.meta);
const POST = "skills/postmaster/postmaster.md";
const COACH = "skills/postmaster/coachman.md";
const GENERAL = "still says two runs must not change the same files";
const TWO_TICKETS =
  "Two tickets touching the same route table, " +
  "transport interface or shared module do not run at the same time.";
const ORDER_LINE =
  "6. **Order them.** Dependencies first: a ticket that needs another's change waits " +
  "for it to land. Record the order and the reason in `<runs>/postmaster/plan.md`, " +
  "current state only.";
const ORDER_SHORT =
  "6. **Order them.** Dependencies first: a ticket that needs another's change waits " +
  "for it to land.";

let tmp = "";
let clean = "";
let stale = "";
let staleCode = 0;
let staleOut = "";

function plantClean(dir: string): void {
  mkdirSync(join(dir, "skills/postmaster"), { recursive: true });
  mkdirSync(join(dir, "wiki/concepts"), { recursive: true });
  writeFileSync(
    join(dir, POST),
    "## Stage A: the stream becomes tickets\n" +
      `${ORDER_LINE}\n` +
      "## Hard rules\n" +
      "- Never launch more runs than `team.max_runs`.\n",
  );
  writeFileSync(
    join(dir, COACH),
    "## Concurrency note (several runs on one project)\n" +
      "Runs go in parallel up to `team.max_runs`. When two runs change the same files, " +
      "the one that merges second resolves the conflicts at its merge; merge, never rebase.\n",
  );
  writeFileSync(
    join(dir, "skills/postmaster/SKILL.md"),
    "You get the machine ready, choose a target, and start the postmaster.\n",
  );
  writeFileSync(
    join(dir, "skills/postmaster/harnesses.md"),
    "The launch keeps them, as a claude lane reads the same files.\n",
  );
  writeFileSync(
    join(dir, "AGENTS.md"),
    "| **postmaster** | decomposes a stream into tickets | `skills/postmaster/postmaster.md` |\n" +
      "Several models implement the same ticket independently, in separate worktrees.\n",
  );
  writeFileSync(
    join(dir, "README.md"),
    "Get one ticket implemented by several models at once, then judged before it lands.\n",
  );
  writeFileSync(
    join(dir, "wiki/concepts/review-loop.md"),
    "When the passes ran in sequence, each lens saw only its own output.\n" +
      "The overlap between independent reviewers estimates what an inspection left.\n",
  );
}

function plantStale(dir: string): void {
  cpSync(clean, dir, { recursive: true });
  writeFileSync(
    join(dir, POST),
    "6. **Order them.** Dependencies first; then the file surfaces. " +
      `${TWO_TICKETS}\n` +
      "- Never launch more runs than `team.max_runs`, " +
      "and never two runs on overlapping file surfaces.\n",
    { flag: "a" },
  );
  writeFileSync(
    join(dir, COACH),
    "Parallel runs are safe when their tickets touch disjoint files.\n" +
      "Prefer sequencing those tickets, or accept conflict resolution at each gated merge;\n" +
      "check the file surfaces before mass-launching.\n",
    { flag: "a" },
  );
  writeFileSync(join(dir, "AGENTS.md"), "Two runs must not change the same files.\n", {
    flag: "a",
  });
  writeFileSync(join(dir, "README.md"), "Two runs do not touch the same files.\n", {
    flag: "a",
  });
  writeFileSync(
    join(dir, "wiki/concepts/review-loop.md"),
    "Two runs must not edit the same files.\n",
    { flag: "a" },
  );
}

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "pra-"));
  clean = join(tmp, "clean");
  plantClean(clean);
  stale = join(tmp, "stale");
  plantStale(stale);
  const r = accept(stale);
  staleCode = r.code;
  staleOut = r.out;
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function freshOne(): string {
  const one = join(tmp, "one");
  rmSync(one, { recursive: true, force: true });
  cpSync(clean, one, { recursive: true });
  return one;
}

/** The one fault appended to a clean copy must be the whole output. */
function checkAlone(file: string, want: string, fault: string): void {
  const one = freshOne();
  writeFileSync(join(one, file), `${fault}\n`, { flag: "a" });
  const r = accept(one);
  expect({ code: r.code, out: r.out.replace(/\n+$/u, "") }).toEqual({ code: 1, out: want });
}

/** The one deletion from a clean copy must be the whole output. */
function checkWithout(file: string, want: string, op: (s: string) => string): void {
  const one = freshOne();
  const p = join(one, file);
  writeFileSync(p, op(readFileSync(p, "utf8")));
  const r = accept(one);
  expect({ code: r.code, out: r.out.replace(/\n+$/u, "") }).toEqual({ code: 1, out: want });
}

function dropLines(substr: string): (s: string) => string {
  return (s) =>
    s
      .split("\n")
      .filter((l) => !l.includes(substr))
      .join("\n");
}

function sub(a: string, b: string): (s: string) => string {
  return (s) => s.replace(a, b);
}

function has(output: string, line: string): void {
  expect(output.split("\n")).toContain(line);
}

function runCli(...args: string[]): { code: number; out: string } {
  const r = spawnSync(wrapper, args, { encoding: "utf8" });
  return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function freshCopy(name: string): string {
  const dir = join(tmp, name);
  rmSync(dir, { recursive: true, force: true });
  cpSync(clean, dir, { recursive: true });
  return dir;
}

describe("each check fires on its own fault alone", () => {
  test("step 6 file surfaces", () => {
    checkAlone(
      POST,
      `${POST}: still says step 6 orders by file surfaces`,
      "6. **Order them.** Dependencies first; then the file surfaces.",
    );
  }, 30000);
  test("two tickets one module", () => {
    checkAlone(
      POST,
      `${POST}: still says two tickets on one module do not run together`,
      TWO_TICKETS,
    );
  }, 30000);
  test("disjoint files", () => {
    checkAlone(
      COACH,
      `${COACH}: still says parallel runs are safe only on disjoint files`,
      "Parallel runs are safe when their tickets touch disjoint files.",
    );
  }, 30000);
  test("prefer sequencing", () => {
    checkAlone(
      COACH,
      `${COACH}: still says prefer sequencing colliding tickets`,
      "Prefer sequencing those tickets, or accept conflict resolution at each gated merge;",
    );
  }, 30000);
  test("check surfaces", () => {
    checkAlone(
      COACH,
      `${COACH}: still says check file surfaces before mass-launching`,
      "check the file surfaces before mass-launching.",
    );
  }, 30000);
  test("AGENTS general claim", () => {
    checkAlone("AGENTS.md", `AGENTS.md: ${GENERAL}`, "Two runs must not change the same files.");
  }, 30000);
  test("README general claim", () => {
    checkAlone("README.md", `README.md: ${GENERAL}`, "Two runs do not touch the same files.");
  }, 30000);
  test("wiki general claim", () => {
    checkAlone(
      "wiki/concepts/review-loop.md",
      `wiki/concepts/review-loop.md: ${GENERAL}`,
      "Two runs must not edit the same files.",
    );
  }, 30000);
  test("SKILL general claim", () => {
    checkAlone(
      "skills/postmaster/SKILL.md",
      `skills/postmaster/SKILL.md: ${GENERAL}`,
      "The old overlapping file surfaces rule is gone.",
    );
  }, 30000);
  test("step 6 kept", () => {
    checkWithout(
      POST,
      `${POST}: no longer orders tickets in an Order-them step`,
      dropLines("Order them"),
    );
  }, 30000);
  test("max_runs kept", () => {
    checkWithout(
      POST,
      `${POST}: no longer limits runs with team.max_runs`,
      dropLines("team.max_runs"),
    );
  }, 30000);
  test("step 6 dependencies", () => {
    checkWithout(
      POST,
      `${POST}: no longer orders step 6 by dependencies`,
      sub("Dependencies first:", "Order kept:"),
    );
  }, 30000);
  test("note kept", () => {
    checkWithout(
      COACH,
      `${COACH}: no longer keeps a concurrency note`,
      dropLines("Concurrency note"),
    );
  }, 30000);
  test("step 6 independence", () => {
    checkWithout(
      POST,
      `${POST}: no longer orders step 6 by dependencies`,
      sub("Dependencies first:", "Order kept for independence of lanes:"),
    );
  }, 30000);
  test("step 6 unrelated text", () => {
    checkWithout(
      POST,
      `${POST}: no longer orders tickets in an Order-them step`,
      sub("6. **Order them.** Dependencies first:", "Order them whenever. Dependencies are fine:"),
    );
  }, 30000);
  test("max_runs relocated", () => {
    checkWithout(
      POST,
      `${POST}: no longer limits runs with team.max_runs`,
      (s) =>
        `${s.replace(
          "- Never launch more runs than `team.max_runs`.",
          "- Never launch runs without a ticket.",
        )}See also team.max_runs in the example config.\n`,
    );
  }, 30000);
  test("note body resolves", () => {
    checkWithout(
      COACH,
      `${COACH}: no longer says the second merger resolves the conflicts`,
      sub("merges second", "resolves things"),
    );
  }, 30000);
  test("note body rebase", () => {
    checkWithout(
      COACH,
      `${COACH}: no longer says merge, never rebase`,
      sub("never rebase", "always rebase"),
    );
  }, 30000);
  test("skills txt claim", () => {
    checkAlone(
      "skills/NOTES.txt",
      `skills/NOTES.txt: ${GENERAL}`,
      "Two runs must not change the same files.",
    );
  }, 30000);
  test("wiki yml claim", () => {
    checkAlone(
      "wiki/_config.yml",
      `wiki/_config.yml: ${GENERAL}`,
      "Two runs must not edit the same files.",
    );
  }, 30000);
  test("AGENTS known sentence", () => {
    checkAlone(
      "AGENTS.md",
      "AGENTS.md: still says prefer sequencing colliding tickets",
      "Prefer sequencing those tickets, or accept conflict resolution at each gated merge;",
    );
  }, 30000);
  test("README known sentence", () => {
    checkAlone(
      "README.md",
      "README.md: still says check file surfaces before mass-launching",
      "check the file surfaces before mass-launching.",
    );
  }, 30000);
  test("wiki known sentence", () => {
    checkAlone(
      "wiki/concepts/review-loop.md",
      "wiki/concepts/review-loop.md: still says parallel runs are safe only on disjoint files",
      "Parallel runs are safe when their tickets touch disjoint files.",
    );
  }, 30000);
  test("capitalised claim", () => {
    checkAlone(
      "skills/postmaster/SKILL.md",
      `skills/postmaster/SKILL.md: ${GENERAL}`,
      "Two Runs Must Not Change The Same Files.",
    );
  }, 30000);
  test("hard-rule clause fires its check and the general one twice", () => {
    const one = freshOne();
    writeFileSync(
      join(one, POST),
      "- Never launch more runs than `team.max_runs`, " +
        "and never two runs on overlapping file surfaces.\n",
      { flag: "a" },
    );
    const r = accept(one);
    const lines = r.out.replace(/\n+$/u, "").split("\n");
    expect(r.code).toBe(1);
    expect(lines.length).toBe(3);
    expect(lines).toContain(`${POST}: still says never two runs on overlapping file surfaces`);
    expect(lines.filter((l) => l === `${POST}: ${GENERAL}`).length).toBe(2);
  }, 30000);
  test("capitalised clause fires its check and the general one twice", () => {
    const one = freshOne();
    writeFileSync(
      join(one, "skills/postmaster/SKILL.md"),
      "Never Two Runs On Overlapping File Surfaces.\n",
      { flag: "a" },
    );
    const r = accept(one);
    const lines = r.out.replace(/\n+$/u, "").split("\n");
    expect(r.code).toBe(1);
    expect(lines.length).toBe(3);
    expect(lines).toContain(
      "skills/postmaster/SKILL.md: still says never two runs on overlapping file surfaces",
    );
    expect(lines.filter((l) => l === `skills/postmaster/SKILL.md: ${GENERAL}`).length).toBe(2);
  }, 30000);
});

describe("all faults together", () => {
  test("stale tree exits 1", () => {
    expect(staleCode).toBe(1);
  }, 30000);
  test("stale tree lists 11 faults", () => {
    expect(staleOut.replace(/\n+$/u, "").split("\n").length).toBe(11);
  }, 30000);
  test("stale step 6 surfaces", () => {
    has(staleOut, `${POST}: still says step 6 orders by file surfaces`);
  }, 30000);
  test("stale two tickets", () => {
    has(staleOut, `${POST}: still says two tickets on one module do not run together`);
  }, 30000);
  test("stale hard rule", () => {
    has(staleOut, `${POST}: still says never two runs on overlapping file surfaces`);
  }, 30000);
  test("stale disjoint", () => {
    has(staleOut, `${COACH}: still says parallel runs are safe only on disjoint files`);
  }, 30000);
  test("stale sequencing", () => {
    has(staleOut, `${COACH}: still says prefer sequencing colliding tickets`);
  }, 30000);
  test("stale check surfaces", () => {
    has(staleOut, `${COACH}: still says check file surfaces before mass-launching`);
  }, 30000);
  test("stale postmaster general", () => {
    has(staleOut, `${POST}: ${GENERAL}`);
  }, 30000);
  test("stale AGENTS general", () => {
    has(staleOut, `AGENTS.md: ${GENERAL}`);
  }, 30000);
  test("stale README general", () => {
    has(staleOut, `README.md: ${GENERAL}`);
  }, 30000);
  test("stale wiki general", () => {
    has(staleOut, `wiki/concepts/review-loop.md: ${GENERAL}`);
  }, 30000);
});

describe("a clean tree passes, a missing tree and bad usage exit 2", () => {
  test("clean tree passes", () => {
    const r = accept(clean);
    expect({ code: r.code, out: r.out }).toEqual({ code: 0, out: "" });
  }, 30000);
  test("missing tree exits 2", () => {
    expect(accept(join(tmp, "nowhere")).code).toBe(2);
  }, 30000);
  test("an extra argument exits 2", () => {
    expect(runCli(clean, "extra").code).toBe(2);
  }, 30000);
  test("an unknown flag exits 2", () => {
    expect(runCli("--no-such-flag", "extra").code).toBe(2);
  }, 30000);
});

describe("edges: encodings, permissions, reflows and links", () => {
  test("a CRLF stale sentence is still caught", () => {
    const dir = freshCopy("crlf");
    writeFileSync(
      join(dir, COACH),
      "Prefer sequencing those tickets, or accept\r\n" +
        "conflict resolution at each gated merge;\r\n",
      { flag: "a" },
    );
    const r = accept(dir);
    expect({ code: r.code, out: r.out.replace(/\n+$/u, "") }).toEqual({
      code: 1,
      out: `${COACH}: still says prefer sequencing colliding tickets`,
    });
  }, 30000);
  test("an unreadable file exits 2, not a clean result", () => {
    const dir = freshCopy("locked");
    const p = join(dir, POST);
    chmodSync(p, 0);
    try {
      expect(accept(dir).code).toBe(2);
    } finally {
      chmodSync(p, 0o644);
    }
  }, 30000);
  test("an unreadable subtree exits 2, not a clean result", () => {
    const dir = freshCopy("lockeddir");
    mkdirSync(join(dir, "skills/hidden"));
    writeFileSync(join(dir, "skills/hidden/evil.md"), "Two runs must not change the same files.\n");
    chmodSync(join(dir, "skills/hidden"), 0);
    try {
      expect(accept(dir).code).toBe(2);
    } finally {
      chmodSync(join(dir, "skills/hidden"), 0o755);
    }
  }, 30000);
  test("a reflowed step 6 still passes, silently", () => {
    const dir = freshCopy("reflow");
    writeFileSync(
      join(dir, POST),
      "## Stage A: the stream becomes tickets\n" +
        "6. **Order them.**\n" +
        "   Read the stream.\n" +
        "   Count the tickets.\n" +
        "   Name the owners.\n" +
        "   Check the board.\n" +
        "   Note the risks.\n" +
        "   Ask the room.\n" +
        "   Dependencies first: a ticket that needs another's change waits for it to land.\n" +
        "## Hard rules\n" +
        "- Never launch more runs than `team.max_runs`.\n",
    );
    const r = accept(dir);
    expect({ code: r.code, out: r.out, err: r.err }).toEqual({ code: 0, out: "", err: "" });
  }, 30000);
  test("a split Order-them still passes, silently", () => {
    const dir = freshCopy("split");
    writeFileSync(
      join(dir, POST),
      "## Stage A: the stream becomes tickets\n" +
        "6. **Order\n" +
        "them.** Dependencies first: a ticket that needs another's change waits " +
        "for it to land.\n" +
        "## Hard rules\n" +
        "- Never launch more runs than `team.max_runs`.\n",
    );
    const r = accept(dir);
    expect({ code: r.code, out: r.out, err: r.err }).toEqual({ code: 0, out: "", err: "" });
  }, 30000);
  test("a root path with a pipe still sweeps, silently", () => {
    rmSync(join(tmp, "piped"), { recursive: true, force: true });
    mkdirSync(join(tmp, "piped"), { recursive: true });
    const dir = join(tmp, "piped", "we|ird");
    cpSync(clean, dir, { recursive: true });
    writeFileSync(
      join(dir, "skills/postmaster/SKILL.md"),
      "Two runs must not change the same files.\n",
      { flag: "a" },
    );
    const r = accept(dir);
    expect({ code: r.code, out: r.out.replace(/\n+$/u, ""), err: r.err }).toEqual({
      code: 1,
      out: `skills/postmaster/SKILL.md: ${GENERAL}`,
      err: "",
    });
  }, 30000);
  test("a rewrapped hard rule still passes, silently", () => {
    const dir = freshCopy("reflowrule");
    const p = join(dir, POST);
    writeFileSync(
      p,
      readFileSync(p, "utf8").replace(
        "- Never launch more runs than `team.max_runs`.",
        "- Never launch more runs than\n  `team.max_runs`.",
      ),
    );
    const r = accept(dir);
    expect({ code: r.code, out: r.out, err: r.err }).toEqual({ code: 0, out: "", err: "" });
  }, 30000);
  test("a hard rule quoted outside its section still faults", () => {
    const dir = freshCopy("quoted");
    writeFileSync(
      join(dir, POST),
      "## Stage A: the stream becomes tickets\n" +
        `${ORDER_SHORT}\n` +
        "## Hard rules\n" +
        "- Never launch runs without a ticket.\n" +
        "## Notes\n" +
        "Quoting the old rule: - Never launch more runs than `team.max_runs`.\n",
    );
    const r = accept(dir);
    expect({ code: r.code, out: r.out.replace(/\n+$/u, ""), err: r.err }).toEqual({
      code: 1,
      out: `${POST}: no longer limits runs with team.max_runs`,
      err: "",
    });
  }, 30000);
  test("a hard rule moved within its section still passes, silently", () => {
    const dir = freshCopy("movedin");
    writeFileSync(
      join(dir, POST),
      "## Stage A: the stream becomes tickets\n" +
        `${ORDER_SHORT}\n` +
        "## Hard rules\n" +
        "- Never merge without a ticket.\n" +
        "- Never launch more runs than `team.max_runs`.\n",
    );
    const r = accept(dir);
    expect({ code: r.code, out: r.out, err: r.err }).toEqual({ code: 0, out: "", err: "" });
  }, 30000);
  test("a claim behind a file symlink faults", () => {
    const dir = freshCopy("flink");
    writeFileSync(join(dir, "claim.txt"), "Two runs must not change the same files.\n");
    symlinkSync("../claim.txt", join(dir, "skills/evil-link.md"));
    const r = accept(dir);
    expect({ code: r.code, out: r.out.replace(/\n+$/u, ""), err: r.err }).toEqual({
      code: 1,
      out: `skills/evil-link.md: ${GENERAL}`,
      err: "",
    });
  }, 30000);
  test("a claim behind a directory symlink faults", () => {
    const dir = freshCopy("dlink");
    mkdirSync(join(dir, "realdir"));
    writeFileSync(join(dir, "realdir/evil.md"), "Two runs must not change the same files.\n");
    symlinkSync("../realdir", join(dir, "wiki/sub"));
    const r = accept(dir);
    expect({ code: r.code, out: r.out.replace(/\n+$/u, ""), err: r.err }).toEqual({
      code: 1,
      out: `wiki/sub/evil.md: ${GENERAL}`,
      err: "",
    });
  }, 30000);
  test("a symlink loop exits 2, not a clean result", () => {
    const dir = freshCopy("eloop");
    symlinkSync("loop", join(dir, "skills/loop"));
    expect(accept(dir).code).toBe(2);
  }, 30000);
});

describe("the live tree", () => {
  test("live tree passes", () => {
    expect(accept(ROOT).code).toBe(0);
  }, 30000);
});
