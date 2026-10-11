// Tests beside scripts/setup-order-acceptance.ts: 27 controls.
// Each tree-mutating case rebuilds its own tree; the live-tree check reads the tool root.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accept } from "./setup-order-acceptance";
import { toolRoot } from "./lib/paths";

const cli = join(import.meta.dir, "run");
const ROOT = toolRoot(import.meta);

let tmp: string;

function strip(out: string): string {
  return out.replace(/\n+$/u, "");
}

const AGENTS_CLEAN =
  "## When a session opens in this repo, do this\n" +
  "Any first message starts the flow: choose a target, set the machine up if it is not, launch the postmaster.\n" +
  "**1. Which project are we working on?**\n" +
  "First ask whether to work on postmaster itself or on another project.\n" +
  "**2. Is this project set up?**\n" +
  "If it is missing, set it up now, in conversation, for the chosen project.\n";

const SKILL_CLEAN =
  "description: 'Start work with postmaster on this machine. It asks which project to work on, postmaster itself or another, then establishes its own preconditions.'\n" +
  "# /postmaster: start work with postmaster\n" +
  "You choose a target, get the machine ready if it is not, and start the postmaster.\n" +
  "## First: find the postmaster repo\n" +
  "## Choose the target project\n" +
  "Ask whether to work on postmaster itself or on another project. When the session stands in another project's folder, offer that project first.\n" +
  "## Then: establish the preconditions yourself\n" +
  "No config: stop and set the machine up, in conversation, per the setup section.\n";

const README_CLEAN =
  "## Getting started\n" +
  "There are two ways to start. Open your agent in the postmaster project and say hi: the first question is which project to work on, and the session starts the postmaster in the chosen project's folder. Or type the postmaster command in a session in that project. The first start in a new folder may ask whether to trust it.\n";

const AGENTS_STALE =
  "Any first message starts the flow: set the machine up if it is not, choose a target, launch the postmaster.\n" +
  "**1. Is this project set up?**\n" +
  "If it is missing, set it up now, in conversation, before anything else.\n" +
  "**2. Which project are we dispatching against?**\n" +
  "Ask the user which project to dispatch against.\n";

const SKILL_STALE =
  "description: 'It finds the postmaster repo from its own link, if the machine has no config it conducts setup first rather than failing later.'\n" +
  "You get the machine ready if it is not, choose a target, confirm a launch card, and start the postmaster.\n" +
  "## Next: establish the preconditions yourself\n" +
  "No config: stop and set the machine up first. Do not continue to target selection.\n" +
  "## Choose the target project\n" +
  "Ask the user which project to dispatch against, whatever the cwd.\n";

const README_STALE =
  "## Getting started\n" +
  "Clone this repo, open your agent in it, and say hi. AGENTS.md tells the agent what to do, and the first time that is setting the machine up with you, one question at a time, and linking the skills into your agent CLIs so you can start from any project afterwards. After that it helps you choose a project and is the postmaster in the session you opened, or launches one when it cannot be.\n";

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "setup-order-acceptance-"));
  mkdirSync(join(tmp, "stale/skills/postmaster"), { recursive: true });
  mkdirSync(join(tmp, "clean/skills/postmaster"), { recursive: true });
  writeFileSync(join(tmp, "stale/AGENTS.md"), AGENTS_STALE);
  writeFileSync(join(tmp, "stale/skills/postmaster/SKILL.md"), SKILL_STALE);
  writeFileSync(join(tmp, "stale/README.md"), README_STALE);
  writeFileSync(join(tmp, "clean/AGENTS.md"), AGENTS_CLEAN);
  writeFileSync(join(tmp, "clean/skills/postmaster/SKILL.md"), SKILL_CLEAN);
  writeFileSync(join(tmp, "clean/README.md"), README_CLEAN);
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function withFile(dir: string, file: string, content: string): string {
  const one = join(tmp, dir);
  rmSync(one, { recursive: true, force: true });
  cpSync(join(tmp, "clean"), one, { recursive: true });
  writeFileSync(join(one, file), content);
  return one;
}

describe("each check fires on its own fault alone", () => {
  test("AGENTS setup-before-anything-else", () => {
    const one = withFile(
      "one",
      "AGENTS.md",
      `${AGENTS_CLEAN}Set it up now, before anything else.\n`,
    );
    const r = accept(one);
    expect(r.code).toBe(1);
    expect(strip(r.out)).toBe("AGENTS.md: still says setup runs before anything else");
  }, 30000);

  test("AGENTS machine-up-then-target", () => {
    const one = withFile(
      "one",
      "AGENTS.md",
      `${AGENTS_CLEAN}Any first message starts the flow: set the machine up if it is not, choose a target.\n`,
    );
    const r = accept(one);
    expect(r.code).toBe(1);
    expect(strip(r.out)).toBe(
      "AGENTS.md: still says the machine is set up before a target is chosen",
    );
  }, 30000);

  test("AGENTS setup-before-project order", () => {
    const one = withFile(
      "one",
      "AGENTS.md",
      "**1. Is this project set up?**\n**2. Which project are we working on?**\nFirst ask whether to work on postmaster itself or on another project.\n",
    );
    const r = accept(one);
    expect(r.code).toBe(1);
    expect(strip(r.out)).toBe("AGENTS.md: the setup step still comes before the project question");
  }, 30000);

  test("AGENTS postmaster-itself missing", () => {
    const one = withFile(
      "one",
      "AGENTS.md",
      "**1. Which project are we working on?**\n**2. Is this project set up?**\nAsk which project to work on.\n",
    );
    const r = accept(one);
    expect(r.code).toBe(1);
    expect(strip(r.out)).toBe("AGENTS.md: has no postmaster itself as a choice");
  }, 30000);

  test("SKILL whatever-the-cwd", () => {
    const one = withFile(
      "one",
      "skills/postmaster/SKILL.md",
      `${SKILL_CLEAN}Ask the user which project to dispatch against, whatever the cwd.\n`,
    );
    const r = accept(one);
    expect(r.code).toBe(1);
    expect(strip(r.out)).toBe(
      "skills/postmaster/SKILL.md: still says the target is asked whatever the cwd",
    );
  }, 30000);

  test("SKILL do-not-continue", () => {
    const one = withFile(
      "one",
      "skills/postmaster/SKILL.md",
      `${SKILL_CLEAN}No config: stop. Do not continue to target selection.\n`,
    );
    const r = accept(one);
    expect(r.code).toBe(1);
    expect(strip(r.out)).toBe(
      "skills/postmaster/SKILL.md: still says target selection waits on the config",
    );
  }, 30000);

  test("SKILL conducts-setup-first", () => {
    const one = withFile(
      "one",
      "skills/postmaster/SKILL.md",
      `${SKILL_CLEAN}It conducts setup first rather than failing later.\n`,
    );
    const r = accept(one);
    expect(r.code).toBe(1);
    expect(strip(r.out)).toBe("skills/postmaster/SKILL.md: still says setup runs first");
  }, 30000);

  test("SKILL ready-then-target", () => {
    const one = withFile(
      "one",
      "skills/postmaster/SKILL.md",
      `${SKILL_CLEAN}You get the machine ready if it is not, choose a target, and start.\n`,
    );
    const r = accept(one);
    expect(r.code).toBe(1);
    expect(strip(r.out)).toBe(
      "skills/postmaster/SKILL.md: still says the machine is readied before a target is chosen",
    );
  }, 30000);

  test("SKILL preconditions-before-choice order", () => {
    const one = withFile(
      "one",
      "skills/postmaster/SKILL.md",
      "## First: establish the preconditions yourself\n## Choose the target project\nAsk whether to work on postmaster itself or on another project; when the session stands in another project, offer that project first.\n",
    );
    const r = accept(one);
    expect(r.code).toBe(1);
    expect(strip(r.out)).toBe(
      "skills/postmaster/SKILL.md: the preconditions still come before the target choice",
    );
  }, 30000);

  test("SKILL postmaster-itself missing", () => {
    const one = withFile(
      "one",
      "skills/postmaster/SKILL.md",
      "## Choose the target project\nAsk which project to dispatch against. When the session stands in another project's folder, offer that project first.\n## Then: establish the preconditions yourself\n",
    );
    const r = accept(one);
    expect(r.code).toBe(1);
    expect(strip(r.out)).toBe("skills/postmaster/SKILL.md: has no postmaster itself as a choice");
  }, 30000);

  test("SKILL own-project-first missing", () => {
    const one = withFile(
      "one",
      "skills/postmaster/SKILL.md",
      "## Choose the target project\nAsk whether to work on postmaster itself or on another project.\n## Then: establish the preconditions yourself\n",
    );
    const r = accept(one);
    expect(r.code).toBe(1);
    expect(strip(r.out)).toBe(
      "skills/postmaster/SKILL.md: has no the session's own project offered first",
    );
  }, 30000);

  test("README first-time-setup", () => {
    const one = withFile(
      "one",
      "README.md",
      `${README_CLEAN}AGENTS.md tells the agent what to do, and the first time that is setting the machine up with you.\n`,
    );
    const r = accept(one);
    expect(r.code).toBe(1);
    expect(strip(r.out)).toBe("README.md: still says the first start sets the machine up");
  }, 30000);

  test("README launches-somewhere-unnamed", () => {
    const one = withFile(
      "one",
      "README.md",
      `${README_CLEAN}It is the postmaster in the session you opened, or launches one when it cannot be.\n`,
    );
    const r = accept(one);
    expect(r.code).toBe(1);
    expect(strip(r.out)).toBe("README.md: still says the postmaster is launched somewhere unnamed");
  }, 30000);

  test("README start-from-any-project-aside", () => {
    const one = withFile(
      "one",
      "README.md",
      `${README_CLEAN}It links the skills into your agent CLIs so you can start from any project afterwards.\n`,
    );
    const r = accept(one);
    expect(r.code).toBe(1);
    expect(strip(r.out)).toBe(
      "README.md: still says starting from another project is a later aside",
    );
  }, 30000);

  test("README two-ways missing", () => {
    const one = withFile(
      "one",
      "README.md",
      "## Getting started\nThe first start in a new folder may ask whether to trust it.\n",
    );
    const r = accept(one);
    expect(r.code).toBe(1);
    expect(strip(r.out)).toBe("README.md: has no the two ways to start");
  }, 30000);

  test("README trust-prompt missing", () => {
    const one = withFile("one", "README.md", "## Getting started\nThere are two ways to start.\n");
    const r = accept(one);
    expect(r.code).toBe(1);
    expect(strip(r.out)).toBe("README.md: has no the trust prompt on a first start");
  }, 30000);
});

describe("all faults together", () => {
  test("stale tree exits 1", () => {
    expect(accept(join(tmp, "stale")).code).toBe(1);
  }, 30000);

  test("stale tree lists 16 faults", () => {
    const lines = strip(accept(join(tmp, "stale")).out)
      .split("\n")
      .filter((l) => l !== "");
    expect(lines.length).toBe(16);
  }, 30000);

  test("stale tree names the AGENTS order", () => {
    expect(accept(join(tmp, "stale")).out.split("\n")).toContain(
      "AGENTS.md: the setup step still comes before the project question",
    );
  }, 30000);

  test("stale tree names the SKILL order", () => {
    expect(accept(join(tmp, "stale")).out.split("\n")).toContain(
      "skills/postmaster/SKILL.md: the preconditions still come before the target choice",
    );
  }, 30000);

  test("stale tree names the missing offers", () => {
    const lines = accept(join(tmp, "stale")).out.split("\n");
    expect(lines).toContain(
      "skills/postmaster/SKILL.md: has no the session's own project offered first",
    );
    expect(lines).toContain("README.md: has no the two ways to start");
  }, 30000);

  test("clean tree passes", () => {
    const r = accept(join(tmp, "clean"));
    expect(r.code).toBe(0);
    expect(r.out).toBe("");
  }, 30000);

  test("missing tree exits 2", () => {
    expect(accept(join(tmp, "nowhere")).code).toBe(2);
  }, 30000);

  test("an extra argument exits 2", () => {
    const r = spawnSync(cli, ["setup-order-acceptance", join(tmp, "clean"), "extra"], {
      encoding: "utf8",
    });
    expect(r.status).toBe(2);
  }, 30000);

  test("an unknown flag exits 2", () => {
    const r = spawnSync(cli, ["setup-order-acceptance", "--no-such-flag", "extra"], {
      encoding: "utf8",
    });
    expect(r.status).toBe(2);
  }, 30000);

  test("a CRLF stale sentence is still caught", () => {
    const dir = join(tmp, "crlf");
    rmSync(dir, { recursive: true, force: true });
    cpSync(join(tmp, "clean"), dir, { recursive: true });
    writeFileSync(
      join(dir, "skills/postmaster/SKILL.md"),
      "Ask the user which project to dispatch against,\r\nwhatever the cwd.\r\n",
      { flag: "a" },
    );
    const r = accept(dir);
    expect(r.code).toBe(1);
    expect(strip(r.out)).toBe(
      "skills/postmaster/SKILL.md: still says the target is asked whatever the cwd",
    );
  }, 30000);

  test("live tree passes", () => {
    expect(accept(ROOT).code).toBe(0);
  }, 30000);
});
