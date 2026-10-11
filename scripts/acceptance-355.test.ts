// Oracle for #355, committed before the change: a verifier is marked as possibly
// stale once a file it depends on changes, however the change lands, until a pass
// confirms it; the postmaster offers the pass after landing such a change; the
// clerk's brief shows the mark; the clerk reports a verifier step that fails at
// the base though the ticket leaves it alone; and the README says setup makes the
// project's verifiers. Every case plants a scratch app (a copy of fixtures/app,
// installed never: no case runs its gate) and drives git or scripts/run as a
// subprocess. The offer itself and the clerk session need a user, so what runs
// here pins the runbook sentences they follow, and the stale query behind both.
// C6's fixture run is the postmaster's Stage F step on the final head, out of any
// unit test; what runs here pins the contract list naming the runbook the change
// touches, and the detector half is hand-verified on the branch.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { commitAll, gitOrThrow, writeRepoFile } from "./acceptance-323.ts";
import { headOf } from "./acceptance-325.ts";
import { cleanup, freshScratch } from "./acceptance-327.ts";
import {
  briefOrThrow,
  bullet,
  CLERK_BASE_FAILURE,
  changeFile,
  flat,
  ISSUE_273_URL,
  POSTMASTER_OFFER,
  PSTACK_URL,
  plantMulti,
  plantSingle,
  promptOrThrow,
  ROOT,
  RUN,
  runStale,
} from "./acceptance-355.ts";
import { run } from "./lib/proc.ts";

describe("C1: the stale mark", () => {
  test("without verifiers: stale: none", () => {
    const { dir, repo } = freshScratch();
    try {
      const r = runStale(repo);
      expect(r.code).toBe(0);
      expect(r.out.trim()).toBe("stale: none");
    } finally {
      cleanup(dir);
    }
  });

  test("confirmed at head with nothing since: stale: none", () => {
    const { dir, repo } = freshScratch();
    try {
      const first = headOf(repo, "HEAD");
      plantSingle(repo, { files: "src/cli.ts", confirmed: first });
      const r = runStale(repo);
      expect(r.code).toBe(0);
      expect(r.out.trim()).toBe("stale: none");
    } finally {
      cleanup(dir);
    }
  });

  test("a commit changing a depended file marks the verifier and names the file", () => {
    const { dir, repo } = freshScratch();
    try {
      const first = headOf(repo, "HEAD");
      plantSingle(repo, { files: "src/cli.ts", confirmed: first });
      changeFile(repo, "src/cli.ts", "change the cli");
      const r = runStale(repo);
      expect(r.code).toBe(0);
      expect(r.out.trim()).toBe("stale: verify-app: src/cli.ts");
    } finally {
      cleanup(dir);
    }
  });

  test("a change to a non-ASCII depended file marks the verifier", () => {
    const { dir, repo } = freshScratch();
    try {
      writeRepoFile(repo, "src/café.md", "# café\n");
      commitAll(repo, "add the cafe page");
      const first = headOf(repo, "HEAD");
      plantSingle(repo, { files: "src/café.md", confirmed: first });
      changeFile(repo, "src/café.md", "change the cafe page");
      const r = runStale(repo);
      expect(r.code).toBe(0);
      expect(r.out.trim()).toBe("stale: verify-app: src/café.md");
    } finally {
      cleanup(dir);
    }
  });

  test("a commit changing no depended file marks nothing", () => {
    const { dir, repo } = freshScratch();
    try {
      const first = headOf(repo, "HEAD");
      plantSingle(repo, { files: "src/cli.ts", confirmed: first });
      changeFile(repo, "README.md", "change the readme");
      const r = runStale(repo);
      expect(r.code).toBe(0);
      expect(r.out.trim()).toBe("stale: none");
    } finally {
      cleanup(dir);
    }
  });

  test("moving the confirmation to head clears the mark, as a pass does", () => {
    const { dir, repo } = freshScratch();
    try {
      const first = headOf(repo, "HEAD");
      plantSingle(repo, { files: "src/cli.ts", confirmed: first });
      changeFile(repo, "src/cli.ts", "change the cli");
      const changed = headOf(repo, "HEAD");
      const map = join(repo, "verify-app/features/README.md");
      writeRepoFile(
        repo,
        "verify-app/features/README.md",
        readFileSync(map, "utf8").replace(/Confirmed: [0-9a-f]+\n?/u, `Confirmed: ${changed}\n`),
      );
      commitAll(repo, "confirm");
      const r = runStale(repo);
      expect(r.code).toBe(0);
      expect(r.out.trim()).toBe("stale: none");
    } finally {
      cleanup(dir);
    }
  });

  test("a change under a listed folder marks and names the changed file", () => {
    const { dir, repo } = freshScratch();
    try {
      const first = headOf(repo, "HEAD");
      plantSingle(repo, { files: "src", confirmed: first });
      changeFile(repo, "src/store.ts", "change the store");
      const r = runStale(repo);
      expect(r.code).toBe(0);
      expect(r.out.trim()).toBe("stale: verify-app: src/store.ts");
    } finally {
      cleanup(dir);
    }
  });

  test("multi: a change to one verifier's file marks only it", () => {
    const { dir, repo } = freshScratch();
    try {
      const first = headOf(repo, "HEAD");
      plantMulti(
        repo,
        [
          bullet("cli", "command line", { files: "src/cli.ts", confirmed: first }),
          bullet("web", "web pages", { files: "src/store.ts", confirmed: first }),
        ],
        ["cli", "web"],
      );
      changeFile(repo, "src/cli.ts", "change the cli");
      const r = runStale(repo);
      expect(r.code).toBe(0);
      expect(r.out.trim()).toBe("stale: verifier/cli: src/cli.ts");
    } finally {
      cleanup(dir);
    }
  });

  test("an entry without Files counts as unconfirmed", () => {
    const { dir, repo } = freshScratch();
    try {
      const first = headOf(repo, "HEAD");
      plantSingle(repo, { files: null, confirmed: first });
      const r = runStale(repo);
      expect(r.code).toBe(0);
      expect(r.out.trim()).toBe("stale: verify-app: unconfirmed (no Files: list)");
    } finally {
      cleanup(dir);
    }
  });

  test("an entry with an empty Files list counts as unconfirmed", () => {
    const { dir, repo } = freshScratch();
    try {
      const first = headOf(repo, "HEAD");
      plantSingle(repo, { files: "src/cli.ts", confirmed: first });
      const map = join(repo, "verify-app/features/README.md");
      writeRepoFile(
        repo,
        "verify-app/features/README.md",
        readFileSync(map, "utf8").replace("Files: src/cli.ts", "Files:"),
      );
      commitAll(repo, "empty the files");
      changeFile(repo, "src/cli.ts", "change the cli");
      const r = runStale(repo);
      expect(r.code).toBe(0);
      expect(r.out.trim()).toBe("stale: verify-app: unconfirmed (no Files: list)");
    } finally {
      cleanup(dir);
    }
  });

  test("an entry without Confirmed counts as unconfirmed", () => {
    const { dir, repo } = freshScratch();
    try {
      plantSingle(repo, { files: "src/cli.ts", confirmed: null });
      const r = runStale(repo);
      expect(r.code).toBe(0);
      expect(r.out.trim()).toBe("stale: verify-app: unconfirmed (no Confirmed: commit)");
    } finally {
      cleanup(dir);
    }
  });

  test("an entry confirmed at an unknown commit counts as unconfirmed", () => {
    const { dir, repo } = freshScratch();
    try {
      const unknown = "0".repeat(40);
      plantSingle(repo, { files: "src/cli.ts", confirmed: unknown });
      const r = runStale(repo);
      expect(r.code).toBe(0);
      expect(r.out.trim()).toBe(`stale: verify-app: unconfirmed (unknown commit ${unknown})`);
    } finally {
      cleanup(dir);
    }
  });

  test("a rename of a depended file marks the verifier", () => {
    const { dir, repo } = freshScratch();
    try {
      const first = headOf(repo, "HEAD");
      plantSingle(repo, { files: "src/cli.ts", confirmed: first });
      gitOrThrow(repo, "mv", "src/cli.ts", "src/cli2.ts");
      commitAll(repo, "rename the cli");
      const r = runStale(repo);
      expect(r.code).toBe(0);
      expect(r.out.trim()).toBe("stale: verify-app: src/cli.ts");
    } finally {
      cleanup(dir);
    }
  });

  test("an entry confirmed at a non-commit object counts as unconfirmed", () => {
    const { dir, repo } = freshScratch();
    try {
      const blob = gitOrThrow(repo, "hash-object", "src/cli.ts").trim();
      plantSingle(repo, { files: "src/cli.ts", confirmed: blob });
      const r = runStale(repo);
      expect(r.code).toBe(0);
      expect(r.out.trim()).toBe(`stale: verify-app: unconfirmed (unknown commit ${blob})`);
    } finally {
      cleanup(dir);
    }
  });

  test("multi: a folder last in the bullet still marks", () => {
    const { dir, repo } = freshScratch();
    try {
      const first = headOf(repo, "HEAD");
      plantMulti(
        repo,
        [bullet("cli", "command line", { files: "src/cli.ts, src/", confirmed: first })],
        ["cli"],
      );
      changeFile(repo, "src/store.ts", "change the store");
      const r = runStale(repo);
      expect(r.code).toBe(0);
      expect(r.out.trim()).toBe("stale: verifier/cli: src/store.ts");
    } finally {
      cleanup(dir);
    }
  });

  test("multi: a verifier missing from the shared index counts as not in it", () => {
    const { dir, repo } = freshScratch();
    try {
      const first = headOf(repo, "HEAD");
      plantMulti(
        repo,
        [bullet("web", "web pages", { files: "src/store.ts", confirmed: first })],
        ["cli"],
      );
      const r = runStale(repo);
      expect(r.code).toBe(0);
      expect(r.out.trim()).toBe("stale: verifier/cli: unconfirmed (not in the shared index)");
    } finally {
      cleanup(dir);
    }
  });

  test("multi: a verifier named twice counts as ambiguous", () => {
    const { dir, repo } = freshScratch();
    try {
      const first = headOf(repo, "HEAD");
      plantMulti(
        repo,
        [
          bullet("cli", "command line", { files: "src/cli.ts", confirmed: first }),
          bullet("cli", "command line again", { files: "src/store.ts", confirmed: first }),
        ],
        ["cli"],
      );
      const r = runStale(repo);
      expect(r.code).toBe(0);
      expect(r.out.trim()).toBe("stale: verifier/cli: unconfirmed (ambiguous shared index entry)");
    } finally {
      cleanup(dir);
    }
  });

  test("--at pins the comparison commit", () => {
    const { dir, repo } = freshScratch();
    try {
      const first = headOf(repo, "HEAD");
      plantSingle(repo, { files: "src/cli.ts", confirmed: first });
      changeFile(repo, "src/cli.ts", "change the cli");
      const changed = headOf(repo, "HEAD");
      const before = runStale(repo, ["--at", first]);
      expect(before.code).toBe(0);
      expect(before.out.trim()).toBe("stale: none");
      const after = runStale(repo, ["--at", changed]);
      expect(after.code).toBe(0);
      expect(after.out.trim()).toBe("stale: verify-app: src/cli.ts");
    } finally {
      cleanup(dir);
    }
  });

  test("usage exits", () => {
    const { dir, repo } = freshScratch();
    try {
      const noRepo = run(RUN, ["verifier", "stale"]);
      expect(noRepo.code).toBe(2);
      expect(noRepo.err).toContain("stale takes a repo");
      const badFlag = runStale(repo, ["--bogus"]);
      expect(badFlag.code).toBe(2);
      expect(badFlag.err).toContain("unknown flag for stale: --bogus");
      const badRepo = runStale(join(dir, "missing"));
      expect(badRepo.code).toBe(2);
      expect(badRepo.err).toContain("not a git repository");
      const badAt = runStale(repo, ["--at", "0".repeat(40)]);
      expect(badAt.code).toBe(2);
      expect(badAt.err).toContain("unknown commit");
    } finally {
      cleanup(dir);
    }
  });
});

describe("C1: making confirms what it proved", () => {
  test("the single prompt carries the confirmation line", () => {
    const { dir, repo } = freshScratch();
    try {
      const head = headOf(repo, "HEAD");
      expect(promptOrThrow(repo, "cli")).toContain(`Confirmed: ${head}`);
    } finally {
      cleanup(dir);
    }
  });

  test("the multi prompt carries the confirmation line", () => {
    const { dir, repo } = freshScratch();
    try {
      const head = headOf(repo, "HEAD");
      expect(promptOrThrow(repo, "cli", "web")).toContain(`Confirmed: ${head}`);
    } finally {
      cleanup(dir);
    }
  });
});

describe("C2: the postmaster offers the pass", () => {
  test("postmaster.md carries the offer rule word for word", () => {
    const postmasterMd = readFileSync(join(ROOT, "skills/postmaster/postmaster.md"), "utf8");
    expect(flat(postmasterMd)).toContain(flat(POSTMASTER_OFFER));
  });

  test("a landed merge the offer call reads names the depended file it changed", () => {
    const { dir, repo } = freshScratch();
    try {
      const first = headOf(repo, "HEAD");
      plantSingle(repo, { files: "src/cli.ts", confirmed: first });
      gitOrThrow(repo, "checkout", "-qb", "side");
      changeFile(repo, "src/cli.ts", "change the cli on a branch");
      gitOrThrow(repo, "checkout", "-q", "main");
      gitOrThrow(repo, "merge", "--no-ff", "-qm", "merge the side", "side");
      const merge = headOf(repo, "HEAD");
      const r = runStale(repo, ["--at", merge]);
      expect(r.code).toBe(0);
      expect(r.out.trim()).toBe("stale: verify-app: src/cli.ts");
    } finally {
      cleanup(dir);
    }
  });

  test("a landed merge changing no depended file clears the offer call", () => {
    const { dir, repo } = freshScratch();
    try {
      const first = headOf(repo, "HEAD");
      plantSingle(repo, { files: "src/cli.ts", confirmed: first });
      gitOrThrow(repo, "checkout", "-qb", "side");
      changeFile(repo, "README.md", "change the readme on a branch");
      gitOrThrow(repo, "checkout", "-q", "main");
      gitOrThrow(repo, "merge", "--no-ff", "-qm", "merge the side", "side");
      const merge = headOf(repo, "HEAD");
      const r = runStale(repo, ["--at", merge]);
      expect(r.code).toBe(0);
      expect(r.out.trim()).toBe("stale: none");
    } finally {
      cleanup(dir);
    }
  });
});

describe("C3: the brief shows the mark", () => {
  test("marked: the brief says the verifier may be stale and names the files", () => {
    const { dir, repo } = freshScratch();
    try {
      const first = headOf(repo, "HEAD");
      plantSingle(repo, { files: "src/cli.ts", confirmed: first });
      changeFile(repo, "src/cli.ts", "change the cli");
      const brief = briefOrThrow(repo, "Use the verifier", dir);
      expect(brief).toContain("may be stale");
      expect(brief).toContain("stale: verify-app: src/cli.ts");
    } finally {
      cleanup(dir);
    }
  });

  test("unmarked: the brief says nothing of the kind", () => {
    const { dir, repo } = freshScratch();
    try {
      const first = headOf(repo, "HEAD");
      plantSingle(repo, { files: "src/cli.ts", confirmed: first });
      const brief = briefOrThrow(repo, "Use the verifier", dir);
      // LOWER: lowered for an ASCII word match
      expect(brief.toLowerCase()).not.toContain("stale");
    } finally {
      cleanup(dir);
    }
  });
});

describe("C4: the clerk reports a base failure", () => {
  test("clerk.md carries the base-failure rule word for word", () => {
    const clerkMd = readFileSync(join(ROOT, "skills/clerk/clerk.md"), "utf8");
    expect(flat(clerkMd)).toContain(flat(CLERK_BASE_FAILURE));
  });
});

describe("C5: the README says setup makes verifiers", () => {
  function readme(): string {
    return readFileSync(join(ROOT, "README.md"), "utf8");
  }

  test("the README counts pstack lines", () => {
    const count = readme()
      .split("\n")
      .filter((l) => /pstack/iu.test(l)).length;
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test("the README links pstack's folder and #273 and says setup makes verifiers", () => {
    const text = readme();
    expect(text).toContain(PSTACK_URL);
    expect(text).toContain(ISSUE_273_URL);
    expect(flat(text)).toContain(flat("Setting up a project makes its verifiers"));
  });

  test("the paragraph sits after the Wiki section", () => {
    const text = readme();
    const wiki = text.indexOf("## Wiki");
    const marker = text.indexOf("makes its verifiers");
    const getting = text.indexOf("## Getting started");
    expect(wiki).toBeGreaterThan(-1);
    expect(marker).toBeGreaterThan(wiki);
    expect(getting).toBeGreaterThan(marker);
  });
});

describe("C6: the contract covers the runbook", () => {
  test("the contract list names postmaster.md", () => {
    const toml = readFileSync(join(ROOT, "docs/coachman-contract.toml"), "utf8");
    expect(toml).toContain('path = "skills/postmaster/postmaster.md"');
  });
});
