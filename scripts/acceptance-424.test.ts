// Oracle for #424, committed before the change: a run adds only a library
// its signed-off ticket lists, and only after its coachman has asked the
// postmaster and the user said yes. C1 reads the ticket's ## Libraries list
// and routes unlisted requests through the surveyor to an escalation. C2
// drives the install refusal and pins the runbook's ask. C3 refuses the
// install and the parser refresh before anything downloads, and takes them
// with the yes recorded. C4 holds landing on every added or changed library
// until the user approves each. C5 is the README passage. Covered: C1-C5.
// Not covered: C6, the fixture run from the branch, which the postmaster
// dispatches at the final card.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  baseOf,
  checkout,
  cleanup,
  commitBranch,
  makeClone,
  makeDispatch,
  makeInstallScratch,
  makeRefreshFixture,
  makeTempDir,
  repoRoot,
  runBun,
  runTool,
  runToolAsync,
  startStubRegistry,
  writeApprovals,
  writeFactsFixture,
  writeScanFixture,
  writeTicket,
} from "./acceptance-424.ts";

function coachman(): string {
  return readFileSync(join(repoRoot(), "skills", "postmaster", "coachman.md"), "utf8");
}

function postmaster(): string {
  return readFileSync(join(repoRoot(), "skills", "postmaster", "postmaster.md"), "utf8");
}

function libraryLines(out: string): string[] {
  return out.split("\n").filter((l) => l.startsWith("- library"));
}

describe("C1: a run adds only a library its signed-off ticket lists", () => {
  test("the list holds each library with its name, version and vetting", () => {
    const dir = makeTempDir("postmaster-424-ticket-");
    try {
      const ticket = writeTicket(dir);
      const r = runTool(["libraries", "list", "--ticket", ticket]);
      expect(r.code).toBe(0);
      expect(r.out).toContain("left-pad 1.3.0");
      expect(r.out).toContain("vetted by the clerk");
    } finally {
      cleanup(dir);
    }
  });

  test("a library past ## For the agents is not listed", () => {
    const dir = makeTempDir("postmaster-424-ticket-");
    try {
      const ticket = writeTicket(dir);
      const r = runTool(["libraries", "list", "--ticket", ticket]);
      expect(r.code).toBe(0);
      expect(r.out).not.toContain("is-odd");
    } finally {
      cleanup(dir);
    }
  });

  test("a ticket with no list names nothing", () => {
    const dir = makeTempDir("postmaster-424-ticket-");
    try {
      const ticket = join(dir, "plain.md");
      writeFileSync(ticket, "# Plain\n\n## Problem\n\nNothing to add.\n");
      const r = runTool(["libraries", "list", "--ticket", ticket]);
      expect(r.code).toBe(0);
      expect(r.out.trim()).toBe("");
    } finally {
      cleanup(dir);
    }
  });

  test("the coachman surveys an unlisted library before it escalates", () => {
    const text = coachman();
    expect(text).toContain("## Libraries");
    expect(text).toContain("surveyor call");
    expect(text).toContain("libraries list");
    expect(text).toContain("ESCALATION.md");
  });
});

describe("C2: the refusal and the ask", () => {
  test("an add of an unapproved library names it and says to stop and report it", async () => {
    const registry = startStubRegistry();
    try {
      const dir = makeInstallScratch(registry.url);
      try {
        const scan = writeScanFixture(dir, {});
        const before = readFileSync(join(dir, "package.json"), "utf8");
        const r = await runBun(["add", "is-odd@3.0.1"], dir, {
          POSTMASTER_SCAN_FIXTURE: scan,
        });
        expect(r.code).not.toBe(0);
        expect(`${r.out}\n${r.err}`).toContain("is-odd@3.0.1");
        expect(`${r.out}\n${r.err}`).toContain("stop");
        expect(`${r.out}\n${r.err}`).toContain("report");
        expect(readFileSync(join(dir, "package.json"), "utf8")).toBe(before);
        expect(existsSync(join(dir, "node_modules", "is-odd"))).toBe(false);
        expect(existsSync(join(dir, "node_modules", "is-number"))).toBe(false);
      } finally {
        cleanup(dir);
      }
    } finally {
      registry.stop();
    }
  });

  test("the coachman escalates with the library's facts", () => {
    const text = coachman();
    expect(text).toContain("libraries facts");
    expect(text).toContain("libraries record");
  });

  test("the postmaster puts the ask to the user whatever the merge authority says", () => {
    const text = postmaster();
    expect(text).toContain("MERGE_AUTHORITY");
    expect(text).toContain("log-action");
    expect(text).toContain("library");
  });
});

describe("C3: nothing installs or copies in without the recorded yes", () => {
  test("bun add left-pad@1.3.0 is refused with no approval and downloads nothing", async () => {
    const registry = startStubRegistry();
    try {
      const dir = makeInstallScratch(registry.url);
      try {
        const scan = writeScanFixture(dir, {});
        const before = readFileSync(join(dir, "package.json"), "utf8");
        const r = await runBun(["add", "left-pad@1.3.0"], dir, {
          POSTMASTER_SCAN_FIXTURE: scan,
        });
        expect(r.code).not.toBe(0);
        expect(`${r.out}\n${r.err}`).toContain("left-pad@1.3.0");
        expect(readFileSync(join(dir, "package.json"), "utf8")).toBe(before);
        expect(existsSync(join(dir, "node_modules", "left-pad"))).toBe(false);
      } finally {
        cleanup(dir);
      }
    } finally {
      registry.stop();
    }
  });

  test("bun add left-pad@1.3.0 installs it with the yes recorded", async () => {
    const registry = startStubRegistry();
    try {
      const dir = makeInstallScratch(registry.url);
      try {
        const scan = writeScanFixture(dir, {});
        writeApprovals(dir, ["left-pad@1.3.0"]);
        const r = await runBun(["add", "left-pad@1.3.0"], dir, {
          POSTMASTER_SCAN_FIXTURE: scan,
        });
        expect(r.code).toBe(0);
        expect(existsSync(join(dir, "node_modules", "left-pad"))).toBe(true);
      } finally {
        cleanup(dir);
      }
    } finally {
      registry.stop();
    }
  });

  test("bun add of a cached approval is refused while the scanner is down", async () => {
    const registry = startStubRegistry();
    try {
      const dir = makeInstallScratch(registry.url);
      try {
        const scan = writeScanFixture(dir, { error: "probe-424: socket unreachable" });
        writeApprovals(dir, ["left-pad@1.3.0"]);
        const r = await runBun(["add", "left-pad@1.3.0"], dir, {
          POSTMASTER_SCAN_FIXTURE: scan,
        });
        expect(r.code).not.toBe(0);
        expect(existsSync(join(dir, "node_modules", "left-pad"))).toBe(false);
      } finally {
        cleanup(dir);
      }
    } finally {
      registry.stop();
    }
  });

  test("record refuses a library the user did not approve", () => {
    const dispatch = makeDispatch();
    try {
      const scratch = makeTempDir("postmaster-424-record-");
      try {
        const r = runTool([
          "libraries",
          "record",
          "is-odd",
          "3.0.1",
          "--dispatch",
          dispatch,
          "--wt",
          scratch,
        ]);
        expect(r.code).toBe(2);
        expect(`${r.out}\n${r.err}`).toContain("no recorded approval");
        expect(existsSync(join(scratch, ".postmaster", "library-approvals.json"))).toBe(false);
      } finally {
        cleanup(scratch);
      }
    } finally {
      cleanup(dispatch, join(dispatch, ".."));
    }
  });

  test("record caches an approved library with the packages it brings", async () => {
    const registry = startStubRegistry();
    const dispatch = makeDispatch();
    try {
      const dir = makeInstallScratch(registry.url);
      try {
        const scan = writeScanFixture(dir, {});
        const id = runTool(["libraries", "identity", "is-odd", "3.0.1"]);
        expect(id.code).toBe(0);
        const target = id.out.trim();
        expect(target).toMatch(/^library:[0-9a-f]{16}$/u);
        const approval = runTool([
          "log-action",
          dispatch,
          "postmaster",
          "library",
          target,
          "approved",
          "library is-odd 3.0.1 added",
          "yes, take it",
        ]);
        expect(approval.code).toBe(0);
        const r = await runToolAsync(
          ["libraries", "record", "is-odd", "3.0.1", "--dispatch", dispatch, "--wt", dir],
          { POSTMASTER_SCAN_FIXTURE: scan },
        );
        expect(r.code).toBe(0);
        const cached = readFileSync(join(dir, ".postmaster", "library-approvals.json"), "utf8");
        expect(cached).toContain("is-odd@3.0.1");
        expect(cached).toContain("is-number@7.0.0");
        const add = await runBun(["add", "is-odd@3.0.1"], dir, {
          POSTMASTER_SCAN_FIXTURE: scan,
        });
        expect(add.code).toBe(0);
        expect(existsSync(join(dir, "node_modules", "is-odd"))).toBe(true);
        expect(existsSync(join(dir, "node_modules", "is-number"))).toBe(true);
      } finally {
        cleanup(dir);
      }
    } finally {
      registry.stop();
      cleanup(dispatch, join(dispatch, ".."));
    }
  }, 180000);

  test("record of a flagged library caches nothing", async () => {
    const registry = startStubRegistry();
    const dispatch = makeDispatch();
    try {
      const dir = makeInstallScratch(registry.url);
      try {
        const scan = writeScanFixture(dir, {
          advisories: {
            "left-pad@1.3.0": [
              {
                level: "fatal",
                package: "left-pad",
                url: null,
                description: "probe-424 flags this package",
              },
            ],
          },
        });
        const id = runTool(["libraries", "identity", "left-pad", "1.3.0"]);
        expect(id.code).toBe(0);
        const approval = runTool([
          "log-action",
          dispatch,
          "postmaster",
          "library",
          id.out.trim(),
          "approved",
          "library left-pad 1.3.0 added",
          "yes, take it",
        ]);
        expect(approval.code).toBe(0);
        const r = await runToolAsync(
          ["libraries", "record", "left-pad", "1.3.0", "--dispatch", dispatch, "--wt", dir],
          { POSTMASTER_SCAN_FIXTURE: scan },
        );
        expect(r.code).toBe(2);
        expect(`${r.out}\n${r.err}`).toContain("not recording it");
        expect(existsSync(join(dir, ".postmaster", "library-approvals.json"))).toBe(false);
      } finally {
        cleanup(dir);
      }
    } finally {
      registry.stop();
      cleanup(dispatch, join(dispatch, ".."));
    }
  }, 180000);

  test("refresh-parser refuses a version without approval before it downloads", () => {
    const fx = makeRefreshFixture(false);
    const root = makeTempDir("postmaster-424-root-");
    try {
      const scan = writeScanFixture(fx.dir, {});
      const r = runTool(["refresh-parser", fx.version], {
        POSTMASTER_REFRESH_FIXTURE: fx.dir,
        POSTMASTER_REFRESH_ROOT: root,
        POSTMASTER_SCAN_FIXTURE: scan,
      });
      expect(r.code).not.toBe(0);
      expect(r.err).toContain("approval");
      expect(existsSync(join(root, "scripts", "lib", "vendor", "babel-parser.js"))).toBe(false);
    } finally {
      cleanup(fx.dir, root);
    }
  });

  test("refresh-parser takes a version with the approval cached", () => {
    const fx = makeRefreshFixture(true);
    const root = makeTempDir("postmaster-424-root-");
    try {
      const scan = writeScanFixture(fx.dir, {});
      writeApprovals(root, [`@babel/parser@${fx.version}`]);
      const r = runTool(["refresh-parser", fx.version], {
        POSTMASTER_REFRESH_FIXTURE: fx.dir,
        POSTMASTER_REFRESH_ROOT: root,
        POSTMASTER_SCAN_FIXTURE: scan,
      });
      expect(r.code).toBe(0);
      expect(
        readFileSync(join(root, "scripts", "lib", "vendor", "babel-parser.js"), "utf8"),
      ).toContain("probe-424 parser bundle");
    } finally {
      cleanup(fx.dir, root);
    }
  });
});

describe("C4: landing holds every added or changed library for the user's word", () => {
  const PUBLISHED = "2024-05-01T00:00:00.000Z";
  const SOURCE = "https://github.com/probe-424/probe.git";

  function biomeBump(): { old: string; next: string } {
    const manifest = JSON.parse(readFileSync(join(repoRoot(), "package.json"), "utf8")) as {
      devDependencies: Record<string, string>;
    };
    const old = manifest.devDependencies["@biomejs/biome"]!;
    const parts = old.split(".");
    return { old, next: `${parts[0]}.${parts[1]}.${Number(parts[2]) + 1}` };
  }

  function parserBump(): { old: string; next: string } {
    const old = readFileSync(join(repoRoot(), "scripts", "lib", "vendor", "VERSION"), "utf8").split(
      "\n",
    )[0]!;
    const parts = old.split(".");
    return { old, next: `${parts[0]}.${parts[1]}.${Number(parts[2]) + 1}` };
  }

  function factsFor(next: { biome: string; parser: string }): {
    dir: string;
    env: Record<string, string>;
  } {
    const dir = makeTempDir("postmaster-424-facts-");
    const fx = writeFactsFixture(dir, [
      { name: "left-pad", version: "1.3.0", published: PUBLISHED, source: SOURCE },
      { name: "@biomejs/biome", version: next.biome, published: PUBLISHED, source: SOURCE },
      { name: "@babel/parser", version: next.parser, published: PUBLISHED, source: SOURCE },
    ]);
    return { dir, env: { POSTMASTER_FACTS_FIXTURE: fx } };
  }

  function branchAdd(clone: string, base: string): void {
    checkout(clone, base);
    const manifestPath = join(clone, "package.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    manifest["dependencies"] = { "left-pad": "1.3.0" };
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const lockPath = join(clone, "bun.lock");
    const lock = readFileSync(lockPath, "utf8");
    const withDeps = lock.replace(
      '"name": "postmaster",',
      '"name": "postmaster",\n      "dependencies": {\n        "left-pad": "1.3.0",\n      },',
    );
    if (withDeps === lock) throw new Error("probe-424: no workspace anchor in bun.lock");
    const withPackage = withDeps.replace(
      '"packages": {',
      '"packages": {\n    "left-pad": ["left-pad@1.3.0", "https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz", {}, "sha512-probe"],',
    );
    if (withPackage === withDeps) throw new Error("probe-424: no packages anchor in bun.lock");
    writeFileSync(lockPath, withPackage);
    commitBranch(clone, "probe-424-a", "probe-424: add left-pad", base);
  }

  function branchRaise(clone: string, base: string, old: string, next: string): void {
    checkout(clone, base);
    for (const [file, from, to] of [
      ["package.json", `"@biomejs/biome": "${old}"`, `"@biomejs/biome": "${next}"`],
      ["bun.lock", `"@biomejs/biome@${old}"`, `"@biomejs/biome@${next}"`],
    ]) {
      const path = join(clone, file);
      const text = readFileSync(path, "utf8");
      if (!text.includes(from)) throw new Error(`probe-424: no ${from} in ${file}`);
      writeFileSync(path, text.replace(from, to));
    }
    commitBranch(clone, "probe-424-b", "probe-424: raise biome", base);
  }

  function branchVendor(clone: string, base: string, old: string, next: string): void {
    checkout(clone, base);
    const path = join(clone, "scripts", "lib", "vendor", "VERSION");
    const text = readFileSync(path, "utf8");
    if (!text.startsWith(`${old}\n`)) throw new Error("probe-424: unexpected VERSION");
    writeFileSync(path, `${next}\n${text.split("\n").slice(1).join("\n")}`);
    commitBranch(clone, "probe-424-c", "probe-424: rewrite VERSION", base);
  }

  function landing(
    clone: string,
    branch: string,
    env: Record<string, string>,
    dispatch?: string,
  ): { code: number | null; out: string; err: string } {
    const args = ["landing", "libraries", "--repo", clone, "--default", "main", "--ticket", branch];
    if (dispatch !== undefined) args.push("--dispatch", dispatch);
    return runTool(args, env);
  }

  function approve(dispatch: string, name: string, version: string): void {
    const id = runTool(["libraries", "identity", name, version]);
    expect(id.code).toBe(0);
    const r = runTool([
      "log-action",
      dispatch,
      "postmaster",
      "library",
      id.out.trim(),
      "approved",
      `library ${name} ${version}`,
      "yes, take it",
    ]);
    expect(r.code).toBe(0);
  }

  function expectHeldWithFacts(r: { code: number | null; out: string }, name: string): void {
    expect(r.code).toBe(2);
    expect(r.out.split("\n")[0]).toBe("held");
    expect(libraryLines(r.out)).toHaveLength(1);
    expect(r.out).toContain(name);
    expect(r.out).toContain("published");
    expect(r.out).toContain(PUBLISHED);
    expect(r.out).toContain("source");
    expect(r.out).toContain(SOURCE);
    expect(r.out).toContain("verdict");
    expect(r.out).toMatch(/\(id library:[0-9a-f]{16}\)/u);
    expect(r.out).not.toContain("(approved)");
  }

  test("adding a library holds with one entry carrying its facts", () => {
    const clone = makeClone();
    const base = baseOf(clone);
    const fx = factsFor({ biome: biomeBump().next, parser: parserBump().next });
    try {
      branchAdd(clone, base);
      expectHeldWithFacts(landing(clone, "probe-424-a", fx.env), "left-pad");
    } finally {
      cleanup(clone, fx.dir);
    }
  });

  test("raising a library's version holds with one entry carrying its facts", () => {
    const clone = makeClone();
    const base = baseOf(clone);
    const { old, next } = biomeBump();
    const fx = factsFor({ biome: next, parser: parserBump().next });
    try {
      branchRaise(clone, base, old, next);
      const r = landing(clone, "probe-424-b", fx.env);
      expectHeldWithFacts(r, "@biomejs/biome");
      expect(r.out).toContain(old);
      expect(r.out).toContain(next);
    } finally {
      cleanup(clone, fx.dir);
    }
  });

  test("rewriting the copied-in VERSION holds with one entry carrying its facts", () => {
    const clone = makeClone();
    const base = baseOf(clone);
    const { old, next } = parserBump();
    const fx = factsFor({ biome: biomeBump().next, parser: next });
    try {
      branchVendor(clone, base, old, next);
      const r = landing(clone, "probe-424-c", fx.env);
      expectHeldWithFacts(r, "@babel/parser");
      expect(r.out).toContain(old);
      expect(r.out).toContain(next);
    } finally {
      cleanup(clone, fx.dir);
    }
  });

  test("each entry clears once the user's approval of it is recorded", () => {
    const clone = makeClone();
    const base = baseOf(clone);
    const biome = biomeBump();
    const parser = parserBump();
    const fx = factsFor({ biome: biome.next, parser: parser.next });
    const dispatch = makeDispatch();
    try {
      branchAdd(clone, base);
      approve(dispatch, "left-pad", "1.3.0");
      const a = landing(clone, "probe-424-a", fx.env, dispatch);
      expect(a.code).toBe(0);
      expect(a.out.split("\n")[0]).toBe("clear");
      expect(a.out).toContain("(approved)");
      branchRaise(clone, base, biome.old, biome.next);
      approve(dispatch, "@biomejs/biome", biome.next);
      const b = landing(clone, "probe-424-b", fx.env, dispatch);
      expect(b.code).toBe(0);
      expect(b.out.split("\n")[0]).toBe("clear");
      branchVendor(clone, base, parser.old, parser.next);
      approve(dispatch, "@babel/parser", parser.next);
      const c = landing(clone, "probe-424-c", fx.env, dispatch);
      expect(c.code).toBe(0);
      expect(c.out.split("\n")[0]).toBe("clear");
    } finally {
      cleanup(clone, fx.dir, dispatch, join(dispatch, ".."));
    }
  });

  test("a package.json change outside the dependency blocks stays clear", () => {
    const clone = makeClone();
    const base = baseOf(clone);
    const fx = factsFor({ biome: biomeBump().next, parser: parserBump().next });
    try {
      const manifestPath = join(clone, "package.json");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
      manifest["trustedDependencies"] = ["probe-424-x"];
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      commitBranch(clone, "probe-424-d", "probe-424: touch trustedDependencies", base);
      const r = landing(clone, "probe-424-d", fx.env);
      expect(r.code).toBe(0);
      expect(r.out.split("\n")[0]).toBe("clear");
    } finally {
      cleanup(clone, fx.dir);
    }
  });

  test("the install-settings control still holds under switch-offs", () => {
    const clone = makeClone();
    const base = baseOf(clone);
    try {
      const bunfig = join(clone, "bunfig.toml");
      const text = readFileSync(bunfig, "utf8");
      if (!text.includes("minimumReleaseAge = 604800")) {
        throw new Error("probe-424: no minimumReleaseAge anchor in bunfig.toml");
      }
      writeFileSync(
        bunfig,
        text.replace("minimumReleaseAge = 604800", "minimumReleaseAge = 604801"),
      );
      commitBranch(clone, "probe-424-e", "probe-424: touch install settings", base);
      const r = runTool([
        "landing",
        "switch-offs",
        "--repo",
        clone,
        "--default",
        "main",
        "--ticket",
        "probe-424-e",
      ]);
      expect(r.code).toBe(2);
      expect(r.out.split("\n")[0]).toBe("held");
    } finally {
      cleanup(clone);
    }
  });

  test("the Stage F step puts held libraries to the user on both routes", () => {
    const text = postmaster();
    expect(text).toContain("landing libraries");
    expect(text).toContain("library:");
  });
});

describe("C5: the README says agents do not add packages as they see fit", () => {
  test("the passage names both guards", () => {
    const readme = readFileSync(join(repoRoot(), "README.md"), "utf8");
    expect(readme).toContain("as they see fit");
    expect(readme).toContain("only a library its ticket lists");
    expect(readme).toContain("asks the postmaster");
  });
});
