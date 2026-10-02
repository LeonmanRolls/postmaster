// Tests beside scripts/front-door-acceptance.ts, moved from its --self-test on #109: 41 controls.
// Each tree-mutating case rebuilds its own tree; the live-tree check reads the tool root.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accept } from "./front-door-acceptance";
import { toolRoot } from "./lib/paths";

const cli = join(import.meta.dir, "front-door-acceptance.sh");
const ROOT = toolRoot(import.meta);

let tmp: string;

function strip(out: string): string {
  return out.replace(/\n+$/u, "");
}

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "front-door-acceptance-"));
  mkdirSync(join(tmp, "stale/skills/postmaster"), { recursive: true });
  mkdirSync(join(tmp, "clean/skills/postmaster"), { recursive: true });
  writeFileSync(
    join(tmp, "stale/skills/postmaster/SKILL.md"),
    `You get the machine ready if it is not, choose a target, confirm a launch card, spawn a
postmaster session, hand over, report where to watch it, and stop. **You do not run the
stream yourself**; the session you spawn does that, from \`postmaster.md\` beside this file.
- Bootstrap never runs the stream. Spawn and stop. The postmaster runs the tickets.
The front door does not run the stream.
Front doors do not run the stream.
`,
  );
  writeFileSync(
    join(tmp, "stale/skills/postmaster/postmaster.md"),
    `**You are the POSTMASTER for one project.** The bootstrap (\`SKILL.md\`) spawned you with a
brief: the stream in one paragraph, the project profile, the absolute path of the postmaster
tool (\`<tool>\`), and the config. You turn the stream into tickets.
The front door never runs the stream.
The front door does not run the stream.
Front doors do not run the stream.
`,
  );
  writeFileSync(
    join(tmp, "stale/AGENTS.md"),
    `| **postmaster** | decomposes a stream into tickets | \`skills/postmaster/postmaster.md\` (spawned by \`SKILL.md\`) |
\`SKILL.md\` is the front door: it gets the machine ready if it is not and
spawns a postmaster; \`postmaster.md\` is what that postmaster then does.
The front door never runs the stream.
The front door does not run the stream.
Front doors do not run the stream.
`,
  );
  writeFileSync(
    join(tmp, "stale/README.md"),
    "The front door never runs the stream; it spawns.\n" +
      "The front door does not run the stream.\nFront doors do not run the stream.\n",
  );

  writeFileSync(
    join(tmp, "clean/skills/postmaster/SKILL.md"),
    `You get the machine ready if it is not, choose a target, and confirm a launch card. The
card says whether this session carries on as the postmaster or a new session is started,
and why. When this session is the postmaster it reads \`postmaster.md\` beside this file
and runs the stream; otherwise it starts that session, hands over, and stops.
- Bootstrap runs the stream itself when it can. Spawn and stop only when it must.
`,
  );
  writeFileSync(
    join(tmp, "clean/skills/postmaster/postmaster.md"),
    `**You are the POSTMASTER for one project.** Either the bootstrap (\`SKILL.md\`) started you
with a brief, or you are the front-door session carrying on with what you settled: the
stream in one paragraph, the project profile, the tool path, and the config.
`,
  );
  writeFileSync(
    join(tmp, "clean/AGENTS.md"),
    `| **postmaster** | decomposes a stream into tickets | \`skills/postmaster/postmaster.md\` (the front door, or started by it) |
\`SKILL.md\` is the front door: it gets the machine ready if it is not, then either runs
the stream itself or starts a postmaster; \`postmaster.md\` is what the postmaster then does.
`,
  );
  writeFileSync(
    join(tmp, "clean/README.md"),
    "The front door runs the stream when it can; else it starts a postmaster.\n",
  );
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function plantFault(dir: string, file: string, fault: string): string {
  const one = join(tmp, dir);
  rmSync(one, { recursive: true, force: true });
  cpSync(join(tmp, "clean"), one, { recursive: true });
  writeFileSync(join(one, file), `${fault}\n`, { flag: "a" });
  return one;
}

describe("each check fires on its own fault alone", () => {
  test("SKILL spawn-does-it", () => {
    const one = plantFault(
      "one",
      "skills/postmaster/SKILL.md",
      " carry on; the session you spawn does that.",
    );
    const r = accept(one);
    expect(r.code).toBe(1);
    expect(strip(r.out)).toBe(
      "skills/postmaster/SKILL.md: still says the spawned session does that instead",
    );
  }, 30000);

  test("SKILL only-flow", () => {
    const one = plantFault(
      "one",
      "skills/postmaster/SKILL.md",
      "you confirm a launch card, spawn a postmaster session, hand over, " +
        "report where to watch it, and stop.",
    );
    const r = accept(one);
    expect(r.code).toBe(1);
    expect(strip(r.out)).toBe(
      "skills/postmaster/SKILL.md: still says spawn, hand over and stop is the only flow",
    );
  }, 30000);

  test("postmaster spawned", () => {
    const one = plantFault(
      "one",
      "skills/postmaster/postmaster.md",
      "The bootstrap (`SKILL.md`) spawned you with a brief: the stream in one paragraph, " +
        "the project profile, the absolute path of the postmaster tool (`<tool>`), and the config.",
    );
    const r = accept(one);
    expect(r.code).toBe(1);
    expect(strip(r.out)).toBe(
      "skills/postmaster/postmaster.md: still says the bootstrap always spawned it",
    );
  }, 30000);

  test("AGENTS table", () => {
    const one = plantFault(
      "one",
      "AGENTS.md",
      "See `skills/postmaster/postmaster.md` (spawned by `SKILL.md`).",
    );
    const r = accept(one);
    expect(r.code).toBe(1);
    expect(strip(r.out)).toBe("AGENTS.md: still says the postmaster is spawned by SKILL.md");
  }, 30000);

  test("AGENTS door", () => {
    const one = plantFault(
      "one",
      "AGENTS.md",
      "It spawns a postmaster; `postmaster.md` is what that postmaster then does.",
    );
    const r = accept(one);
    expect(r.code).toBe(1);
    expect(strip(r.out)).toBe("AGENTS.md: still says the front door only spawns a postmaster");
  }, 30000);

  for (const f of [
    "skills/postmaster/SKILL.md",
    "skills/postmaster/postmaster.md",
    "AGENTS.md",
    "README.md",
  ]) {
    test(`${f} never-runs claim`, () => {
      const one = plantFault("one", f, "The front door never runs the stream.");
      const r = accept(one);
      expect(r.code).toBe(1);
      expect(strip(r.out)).toBe(`${f}: still says the front door never runs the stream`);
    }, 30000);
    test(`${f} does-not claim`, () => {
      const one = plantFault("one", f, "The front door does not run the stream.");
      const r = accept(one);
      expect(r.code).toBe(1);
      expect(strip(r.out)).toBe(`${f}: still says the front door never runs the stream`);
    }, 30000);
    test(`${f} do-not claim`, () => {
      const one = plantFault("one", f, "Front doors do not run the stream.");
      const r = accept(one);
      expect(r.code).toBe(1);
      expect(strip(r.out)).toBe(`${f}: still says the front door never runs the stream`);
    }, 30000);
  }

  test("SKILL itself fires its check and the general one", () => {
    const one = plantFault(
      "one",
      "skills/postmaster/SKILL.md",
      "You do not run the stream yourself.",
    );
    const r = accept(one);
    const lines = strip(r.out).split("\n");
    expect(r.code).toBe(1);
    expect(lines.length).toBe(2);
    expect(lines).toContain(
      "skills/postmaster/SKILL.md: still says the front door never runs the stream itself",
    );
    expect(lines).toContain(
      "skills/postmaster/SKILL.md: still says the front door never runs the stream",
    );
  }, 30000);

  test("SKILL bootstrap fires its check and the general one", () => {
    const one = plantFault(
      "one",
      "skills/postmaster/SKILL.md",
      "- Bootstrap never runs the stream. Spawn and stop.",
    );
    const r = accept(one);
    const lines = strip(r.out).split("\n");
    expect(r.code).toBe(1);
    expect(lines.length).toBe(2);
    expect(lines).toContain(
      "skills/postmaster/SKILL.md: still says bootstrap never runs the stream",
    );
    expect(lines).toContain(
      "skills/postmaster/SKILL.md: still says the front door never runs the stream",
    );
  }, 30000);
});

describe("all faults together", () => {
  test("stale tree exits 1", () => {
    expect(accept(join(tmp, "stale")).code).toBe(1);
  }, 30000);

  test("stale tree lists 19 faults", () => {
    const lines = strip(accept(join(tmp, "stale")).out)
      .split("\n")
      .filter((l) => l !== "");
    expect(lines.length).toBe(19);
  }, 30000);

  for (const [name, line] of [
    [
      "stale SKILL itself",
      "skills/postmaster/SKILL.md: still says the front door never runs the stream itself",
    ],
    [
      "stale SKILL spawn-does-it",
      "skills/postmaster/SKILL.md: still says the spawned session does that instead",
    ],
    [
      "stale SKILL only-flow",
      "skills/postmaster/SKILL.md: still says spawn, hand over and stop is the only flow",
    ],
    [
      "stale SKILL bootstrap",
      "skills/postmaster/SKILL.md: still says bootstrap never runs the stream",
    ],
    [
      "stale postmaster spawned",
      "skills/postmaster/postmaster.md: still says the bootstrap always spawned it",
    ],
    ["stale AGENTS table", "AGENTS.md: still says the postmaster is spawned by SKILL.md"],
    ["stale AGENTS door", "AGENTS.md: still says the front door only spawns a postmaster"],
    [
      "stale SKILL general",
      "skills/postmaster/SKILL.md: still says the front door never runs the stream",
    ],
    [
      "stale postmaster general",
      "skills/postmaster/postmaster.md: still says the front door never runs the stream",
    ],
    ["stale AGENTS general", "AGENTS.md: still says the front door never runs the stream"],
    ["stale README", "README.md: still says the front door never runs the stream"],
  ]) {
    test(`${name}`, () => {
      expect(accept(join(tmp, "stale")).out.split("\n")).toContain(line);
    }, 30000);
  }

  test("clean tree passes", () => {
    const r = accept(join(tmp, "clean"));
    expect(r.code).toBe(0);
    expect(r.out).toBe("");
  }, 30000);

  test("missing tree exits 2", () => {
    expect(accept(join(tmp, "nowhere")).code).toBe(2);
  }, 30000);

  test("an extra argument exits 2", () => {
    const r = spawnSync(cli, [join(tmp, "clean"), "extra"], { encoding: "utf8" });
    expect(r.status).toBe(2);
  }, 30000);

  test("an unknown flag exits 2", () => {
    const r = spawnSync(cli, ["--no-such-flag", "extra"], { encoding: "utf8" });
    expect(r.status).toBe(2);
  }, 30000);

  test("a CRLF stale sentence is still caught", () => {
    const dir = join(tmp, "crlf");
    rmSync(dir, { recursive: true, force: true });
    cpSync(join(tmp, "clean"), dir, { recursive: true });
    writeFileSync(
      join(dir, "skills/postmaster/SKILL.md"),
      "you confirm a launch card, spawn a postmaster\r\n" +
        "session, hand over, report where to watch it, and stop.\r\n",
      { flag: "a" },
    );
    const r = accept(dir);
    expect(r.code).toBe(1);
    expect(strip(r.out)).toBe(
      "skills/postmaster/SKILL.md: still says spawn, hand over and stop is the only flow",
    );
  }, 30000);

  test("an unreadable file exits 2, not a clean result", () => {
    const dir = join(tmp, "locked");
    rmSync(dir, { recursive: true, force: true });
    cpSync(join(tmp, "clean"), dir, { recursive: true });
    chmodSync(join(dir, "skills/postmaster/SKILL.md"), 0o000);
    try {
      expect(accept(dir).code).toBe(2);
    } finally {
      chmodSync(join(dir, "skills/postmaster/SKILL.md"), 0o644);
    }
  }, 30000);

  test("a stale sentence ahead of 16 MB is still caught", () => {
    const dir = join(tmp, "big");
    rmSync(dir, { recursive: true, force: true });
    cpSync(join(tmp, "clean"), dir, { recursive: true });
    writeFileSync(
      join(dir, "skills/postmaster/SKILL.md"),
      `You do not run the stream yourself.\n${"x".repeat(16777216)}\n`,
    );
    const r = accept(dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain("still says the front door never runs the stream itself");
  }, 30000);

  test("a clean 16 MB file still passes", () => {
    const dir = join(tmp, "big-clean");
    rmSync(dir, { recursive: true, force: true });
    cpSync(join(tmp, "clean"), dir, { recursive: true });
    writeFileSync(join(dir, "skills/postmaster/SKILL.md"), `${"y".repeat(16777216)}\n`);
    expect(accept(dir).code).toBe(0);
  }, 30000);

  test("live tree passes", () => {
    expect(accept(ROOT).code).toBe(0);
  }, 30000);
});
