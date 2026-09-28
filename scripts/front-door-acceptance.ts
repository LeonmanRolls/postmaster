import {
  accessSync,
  appendFileSync,
  chmodSync,
  constants,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { command, scriptDir, writeError, writeOut } from "./lib/core.ts";

const rootHere = dirname(scriptDir(import.meta.url));
const files = ["AGENTS.md", "skills/postmaster/SKILL.md", "skills/postmaster/postmaster.md", "README.md"];
const usage = "usage: front-door-acceptance.sh [repo-root] | --self-test";
type Result = { code: number; stdout: string; stderr: string };
function flatten(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\r/g, "")
    .replace(/[\n\t]/g, " ")
    .replace(/ {2,}/g, " ");
}
function accept(root: string): Result {
  for (const file of files) {
    try {
      accessSync(join(root, file), constants.R_OK);
    } catch {
      return { code: 2, stdout: "", stderr: `front-door-acceptance: cannot read ${join(root, file)}` };
    }
  }
  let skill: string;
  let post: string;
  let agents: string;
  let readme: string;
  try {
    skill = flatten(join(root, "skills/postmaster/SKILL.md"));
    post = flatten(join(root, "skills/postmaster/postmaster.md"));
    agents = flatten(join(root, "AGENTS.md"));
    readme = flatten(join(root, "README.md"));
  } catch {
    return { code: 2, stdout: "", stderr: "front-door-acceptance: a file could not be read" };
  }
  const errors: string[] = [];
  const stale = (text: string, file: string, label: string, sentence: string) => {
    if (text.includes(sentence)) errors.push(`${file}: still says ${label}`);
  };
  stale(
    skill,
    "skills/postmaster/SKILL.md",
    "the front door never runs the stream itself",
    "You do not run the stream yourself",
  );
  stale(
    skill,
    "skills/postmaster/SKILL.md",
    "the spawned session does that instead",
    "the session you spawn does that",
  );
  stale(
    skill,
    "skills/postmaster/SKILL.md",
    "spawn, hand over and stop is the only flow",
    "confirm a launch card, spawn a postmaster session, hand over, report where to watch it, and stop",
  );
  stale(
    skill,
    "skills/postmaster/SKILL.md",
    "bootstrap never runs the stream",
    "Bootstrap never runs the stream. Spawn and stop.",
  );
  stale(
    post,
    "skills/postmaster/postmaster.md",
    "the bootstrap always spawned it",
    "The bootstrap (`SKILL.md`) spawned you with a brief: the stream in one paragraph, the project profile, the absolute path of the postmaster tool (`<tool>`), and the config.",
  );
  stale(agents, "AGENTS.md", "the postmaster is spawned by SKILL.md", "(spawned by `SKILL.md`)");
  stale(
    agents,
    "AGENTS.md",
    "the front door only spawns a postmaster",
    "spawns a postmaster; `postmaster.md` is what that postmaster then does",
  );
  for (const claim of ["never runs the stream", "does not run the stream", "do not run the stream"]) {
    stale(skill, "skills/postmaster/SKILL.md", "the front door never runs the stream", claim);
    stale(post, "skills/postmaster/postmaster.md", "the front door never runs the stream", claim);
    stale(agents, "AGENTS.md", "the front door never runs the stream", claim);
    stale(readme, "README.md", "the front door never runs the stream", claim);
  }
  return { code: errors.length ? 1 : 0, stdout: errors.length ? `${errors.join("\n")}\n` : "", stderr: "" };
}
function selfTest(): number {
  const temp = mkdtempSync(join(tmpdir(), "front-door-acceptance-"));
  let fails = 0;
  const check = (name: string, result: boolean, detail = "") => {
    if (result) writeOut(`  ok   ${name}`);
    else {
      writeOut(`  FAIL ${name}${detail ? `: ${detail}` : ""}`);
      fails++;
    }
  };
  const copyTree = (source: string, target: string) => cpSync(source, target, { recursive: true });
  const stale = join(temp, "stale");
  const clean = join(temp, "clean");
  mkdirSync(join(stale, "skills/postmaster"), { recursive: true });
  mkdirSync(join(clean, "skills/postmaster"), { recursive: true });
  const write = (base: string, file: string, content: string) => writeFileSync(join(base, file), content);
  try {
    write(
      stale,
      "skills/postmaster/SKILL.md",
      "You get the machine ready if it is not, choose a target, confirm a launch card, spawn a\npostmaster session, hand over, report where to watch it, and stop. **You do not run the\nstream yourself**; the session you spawn does that, from `postmaster.md` beside this file.\n- Bootstrap never runs the stream. Spawn and stop. The postmaster runs the tickets.\n",
    );
    write(
      stale,
      "skills/postmaster/postmaster.md",
      "**You are the POSTMASTER for one project.** The bootstrap (`SKILL.md`) spawned you with a\nbrief: the stream in one paragraph, the project profile, the absolute path of the postmaster\ntool (`<tool>`), and the config. You turn the stream into tickets.\nThe front door never runs the stream.\n",
    );
    write(
      stale,
      "AGENTS.md",
      "| **postmaster** | decomposes a stream into tickets | `skills/postmaster/postmaster.md` (spawned by `SKILL.md`) |\n`SKILL.md` is the front door: it gets the machine ready if it is not and\nspawns a postmaster; `postmaster.md` is what that postmaster then does.\nThe front door never runs the stream.\n",
    );
    write(stale, "README.md", "The front door never runs the stream; it spawns.\n");
    for (const file of files)
      appendFileSync(
        join(stale, file),
        "The front door does not run the stream.\nFront doors do not run the stream.\n",
      );

    write(
      clean,
      "skills/postmaster/SKILL.md",
      "You get the machine ready if it is not, choose a target, and confirm a launch card. The\ncard says whether this session carries on as the postmaster or a new session is started,\nand why. When this session is the postmaster it reads `postmaster.md` beside this file\nand runs the stream; otherwise it starts that session, hands over, and stops.\n- Bootstrap runs the stream itself when it can. Spawn and stop only when it must.\n",
    );
    write(
      clean,
      "skills/postmaster/postmaster.md",
      "**You are the POSTMASTER for one project.** Either the bootstrap (`SKILL.md`) started you\nwith a brief, or you are the front-door session carrying on with what you settled: the\nstream in one paragraph, the project profile, the tool path, and the config.\n",
    );
    write(
      clean,
      "AGENTS.md",
      "| **postmaster** | decomposes a stream into tickets | `skills/postmaster/postmaster.md` (the front door, or started by it) |\n`SKILL.md` is the front door: it gets the machine ready if it is not, then either runs\nthe stream itself or starts a postmaster; `postmaster.md` is what the postmaster then does.\n",
    );
    write(clean, "README.md", "The front door runs the stream when it can; else it starts a postmaster.\n");

    const alone = (name: string, file: string, want: string, fault: string) => {
      const one = join(temp, "one");
      rmSync(one, { recursive: true, force: true });
      copyTree(clean, one);
      appendFileSync(join(one, file), `${fault}\n`);
      const result = accept(one);
      check(
        name,
        result.code === 1 && result.stdout.trim() === want,
        `exit ${result.code} with ${result.stdout.trim()}`,
      );
    };
    writeOut("each check fires on its own fault alone");
    alone(
      "SKILL spawn-does-it",
      "skills/postmaster/SKILL.md",
      "skills/postmaster/SKILL.md: still says the spawned session does that instead",
      " carry on; the session you spawn does that.",
    );
    alone(
      "SKILL only-flow",
      "skills/postmaster/SKILL.md",
      "skills/postmaster/SKILL.md: still says spawn, hand over and stop is the only flow",
      "you confirm a launch card, spawn a postmaster session, hand over, report where to watch it, and stop.",
    );
    alone(
      "postmaster spawned",
      "skills/postmaster/postmaster.md",
      "skills/postmaster/postmaster.md: still says the bootstrap always spawned it",
      "The bootstrap (`SKILL.md`) spawned you with a brief: the stream in one paragraph, the project profile, the absolute path of the postmaster tool (`<tool>`), and the config.",
    );
    alone(
      "AGENTS table",
      "AGENTS.md",
      "AGENTS.md: still says the postmaster is spawned by SKILL.md",
      "See `skills/postmaster/postmaster.md` (spawned by `SKILL.md`).",
    );
    alone(
      "AGENTS door",
      "AGENTS.md",
      "AGENTS.md: still says the front door only spawns a postmaster",
      "It spawns a postmaster; `postmaster.md` is what that postmaster then does.",
    );
    for (const file of files) {
      alone(
        `${file} never-runs claim`,
        file,
        `${file}: still says the front door never runs the stream`,
        "The front door never runs the stream.",
      );
      alone(
        `${file} does-not claim`,
        file,
        `${file}: still says the front door never runs the stream`,
        "The front door does not run the stream.",
      );
      alone(
        `${file} do-not claim`,
        file,
        `${file}: still says the front door never runs the stream`,
        "Front doors do not run the stream.",
      );
    }
    const pair = (name: string, want: string, text: string) => {
      const one = join(temp, "one");
      rmSync(one, { recursive: true, force: true });
      copyTree(clean, one);
      appendFileSync(join(one, "skills/postmaster/SKILL.md"), `${text}\n`);
      const result = accept(one);
      const rows = result.stdout.trim().split("\n");
      check(
        name,
        result.code === 1 &&
          rows.length === 2 &&
          rows.includes(want) &&
          rows.includes("skills/postmaster/SKILL.md: still says the front door never runs the stream"),
        `exit ${result.code} with ${result.stdout}`,
      );
    };
    pair(
      "SKILL itself fires its check and the general one",
      "skills/postmaster/SKILL.md: still says the front door never runs the stream itself",
      "You do not run the stream yourself.",
    );
    pair(
      "SKILL bootstrap fires its check and the general one",
      "skills/postmaster/SKILL.md: still says bootstrap never runs the stream",
      "- Bootstrap never runs the stream. Spawn and stop.",
    );
    writeOut("all faults together");
    const all = accept(stale);
    check("stale tree exits 1", all.code === 1);
    check("stale tree lists 19 faults", all.stdout.trim().split("\n").length === 19, all.stdout);
    for (const [name, expected] of [
      ["stale SKILL itself", "skills/postmaster/SKILL.md: still says the front door never runs the stream itself"],
      ["stale SKILL spawn-does-it", "skills/postmaster/SKILL.md: still says the spawned session does that instead"],
      ["stale SKILL only-flow", "skills/postmaster/SKILL.md: still says spawn, hand over and stop is the only flow"],
      ["stale SKILL bootstrap", "skills/postmaster/SKILL.md: still says bootstrap never runs the stream"],
      ["stale postmaster spawned", "skills/postmaster/postmaster.md: still says the bootstrap always spawned it"],
      ["stale AGENTS table", "AGENTS.md: still says the postmaster is spawned by SKILL.md"],
      ["stale AGENTS door", "AGENTS.md: still says the front door only spawns a postmaster"],
      ["stale SKILL general", "skills/postmaster/SKILL.md: still says the front door never runs the stream"],
      ["stale postmaster general", "skills/postmaster/postmaster.md: still says the front door never runs the stream"],
      ["stale AGENTS general", "AGENTS.md: still says the front door never runs the stream"],
      ["stale README", "README.md: still says the front door never runs the stream"],
    ])
      check(name, all.stdout.split(/\r?\n/).includes(expected));
    const clear = accept(clean);
    check("clean tree passes", clear.code === 0 && !clear.stdout);
    check("missing tree exits 2", accept(join(temp, "nowhere")).code === 2);
    const selfPath = join(scriptDir(import.meta.url), "front-door-acceptance.sh");
    check("an extra argument exits 2", command(selfPath, [clean, "extra"]).code === 2);
    check("--self-test with an extra argument exits 2", command(selfPath, ["--self-test", "extra"]).code === 2);
    const crlf = join(temp, "crlf");
    copyTree(clean, crlf);
    appendFileSync(
      join(crlf, "skills/postmaster/SKILL.md"),
      "you confirm a launch card, spawn a postmaster\r\nsession, hand over, report where to watch it, and stop.\r\n",
    );
    const crlfResult = accept(crlf);
    check(
      "a CRLF stale sentence is still caught",
      crlfResult.code === 1 &&
        crlfResult.stdout.trim() ===
          "skills/postmaster/SKILL.md: still says spawn, hand over and stop is the only flow",
    );
    const locked = join(temp, "locked");
    copyTree(clean, locked);
    chmodSync(join(locked, "skills/postmaster/SKILL.md"), 0);
    const lockedResult = accept(locked);
    chmodSync(join(locked, "skills/postmaster/SKILL.md"), 0o644);
    check("an unreadable file exits 2, not a clean result", lockedResult.code === 2);
    const live = accept(rootHere);
    check("live tree passes", live.code === 0, live.stdout);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
  writeOut("");
  writeOut(fails === 0 ? "self-test: all controls behaved" : `self-test: ${fails} control(s) misbehaved`);
  return fails === 0 ? 0 : 1;
}

const args = process.argv.slice(2);
if (args[0] === "--self-test") {
  if (args.length !== 1) {
    writeError(usage);
    process.exit(2);
  }
  process.exit(selfTest());
}
if (args.some((arg) => arg.startsWith("-")) || args.length > 1) {
  writeError(usage);
  process.exit(2);
}
const result = accept(args[0] ?? rootHere);
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) writeError(result.stderr);
process.exit(result.code);
