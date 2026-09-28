// Acceptance oracle for the entry flow: nothing in AGENTS.md, SKILL.md, postmaster.md or
// README.md still says the front door never runs the stream. The session the user opened
// carries on as the postmaster when it can; a separate postmaster is spawned only when
// the harness or model differs, the target is another repo, or nobody is at the terminal.
// Seven checks name one stale sentence each from before that change, matched verbatim after
// newlines are folded (carriage returns stripped first, so CRLF never hides one), and
// twelve match the claim itself in every file in its plain verb forms (`never runs`,
// `does not run`, `do not run`): a new sentence in one of these phrasings trips the same
// guard. Further paraphrases are beyond a grep oracle. Any conditional rewrite breaks
// every match.
//
//   front-door-acceptance.sh [repo-root]   default: the repo this script lives in
//   front-door-acceptance.sh --self-test   prove each check fails on its own fault alone,
//                                          a clean tree passes, and the live tree passes
//
//   exit 0  no stale claim remains
//   exit 1  stale claims, one per line on stdout: <file>: <what is still claimed>
//   exit 2  usage, or a file that cannot be read
import { chmodSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scriptsDir, toolRoot } from "./lib/paths.ts";
import { run, withTempDir } from "./lib/proc.ts";
import { SelfTest } from "./lib/selftest.ts";

function usage(): never {
  console.error("usage: front-door-acceptance.sh [repo-root] | --self-test");
  process.exit(2);
}

/** flat <path>: fold newlines so a reflow alone never passes. */
function flat(path: string): string {
  const text = readFileSync(path, "utf8")
    .replace(/\r/g, "")
    .replace(/[\n\t]/g, "  ");
  return text.replace(/ {2,}/g, " ");
}

interface AcceptResult {
  code: number;
  out: string;
  err: string;
}

function accept(root: string): AcceptResult {
  const files = [
    "AGENTS.md",
    "skills/postmaster/SKILL.md",
    "skills/postmaster/postmaster.md",
    "README.md",
  ];
  const err: string[] = [];
  for (const f of files) {
    const p = join(root, f);
    let readable = false;
    try {
      readFileSync(p);
      readable = true;
    } catch {
      readable = false;
    }
    if (!readable) {
      err.push(`front-door-acceptance: cannot read ${p}`);
      return { code: 2, out: "", err: `${err.join("\n")}\n` };
    }
  }
  const texts: Record<string, string> = {};
  for (const f of files) {
    try {
      texts[f] = flat(join(root, f));
    } catch {
      err.push(`front-door-acceptance: cannot read ${join(root, f)}`);
      return { code: 2, out: "", err: `${err.join("\n")}\n` };
    }
  }
  const skill = texts["skills/postmaster/SKILL.md"] ?? "";
  const post = texts["skills/postmaster/postmaster.md"] ?? "";
  const agents = texts["AGENTS.md"] ?? "";
  const readme = texts["README.md"] ?? "";
  const out: string[] = [];
  let fails = 0;
  const stale = (text: string, file: string, label: string, sentence: string): void => {
    if (text.includes(sentence)) {
      out.push(`${file}: still says ${label}`);
      fails += 1;
    }
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
  // The claim itself, in every file, in its plain verb forms.
  for (const claim of [
    "never runs the stream",
    "does not run the stream",
    "do not run the stream",
  ]) {
    stale(skill, "skills/postmaster/SKILL.md", "the front door never runs the stream", claim);
    stale(post, "skills/postmaster/postmaster.md", "the front door never runs the stream", claim);
    stale(agents, "AGENTS.md", "the front door never runs the stream", claim);
    stale(readme, "README.md", "the front door never runs the stream", claim);
  }
  return { code: fails === 0 ? 0 : 1, out: out.map((l) => `${l}\n`).join(""), err: "" };
}

function printAccept(r: AcceptResult): never {
  if (r.out) process.stdout.write(r.out);
  if (r.err) process.stderr.write(r.err);
  process.exit(r.code);
}

// --- entry ------------------------------------------------------------------------------
const ROOT = toolRoot(import.meta);
const argv = process.argv.slice(2);

if (argv[0] === "--self-test") {
  if (argv.length !== 1) usage();
} else if (argv[0]?.startsWith("-")) {
  usage();
} else if (argv[0] === undefined) {
  if (argv.length !== 0) usage();
  printAccept(accept(ROOT));
} else {
  if (argv.length !== 1) usage();
  printAccept(accept(argv[0]));
}

// --- self-test ----------------------------------------------------------------------------
const self = join(scriptsDir(import.meta), "front-door-acceptance.sh");
withTempDir((tmp) => {
  const st = new SelfTest();
  const _failCount = { n: 0 };

  const has = (name: string, output: string, line: string): void => {
    if (output.split("\n").includes(line)) st.ok(name);
    else st.fail(`${name}: no line "${line}" in:`, output);
  };

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
    "The front door never runs the stream; it spawns.\nThe front door does not run the stream.\nFront doors do not run the stream.\n",
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

  const alone = (name: string, file: string, want: string, fault: string): void => {
    rmSync(join(tmp, "one"), { recursive: true, force: true });
    cpSync(join(tmp, "clean"), join(tmp, "one"), { recursive: true });
    writeFileSync(join(tmp, "one", file), `${fault}\n`, { flag: "a" });
    const r = accept(join(tmp, "one"));
    if (r.code === 1 && r.out.replace(/\n+$/, "") === want) st.ok(name);
    else st.fail(`${name}: exit ${r.code} with:`, r.out + r.err);
  };

  console.log("each check fires on its own fault alone");
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
  for (const f of [
    "skills/postmaster/SKILL.md",
    "skills/postmaster/postmaster.md",
    "AGENTS.md",
    "README.md",
  ]) {
    alone(
      `${f} never-runs claim`,
      f,
      `${f}: still says the front door never runs the stream`,
      "The front door never runs the stream.",
    );
    alone(
      `${f} does-not claim`,
      f,
      `${f}: still says the front door never runs the stream`,
      "The front door does not run the stream.",
    );
    alone(
      `${f} do-not claim`,
      f,
      `${f}: still says the front door never runs the stream`,
      "Front doors do not run the stream.",
    );
  }
  const pair = (name: string, want: string, fault: string): void => {
    rmSync(join(tmp, "one"), { recursive: true, force: true });
    cpSync(join(tmp, "clean"), join(tmp, "one"), { recursive: true });
    writeFileSync(join(tmp, "one/skills/postmaster/SKILL.md"), `${fault}\n`, { flag: "a" });
    const r = accept(join(tmp, "one"));
    const lines = r.out.replace(/\n+$/, "").split("\n");
    if (
      r.code === 1 &&
      lines.length === 2 &&
      lines.includes(want) &&
      lines.includes("skills/postmaster/SKILL.md: still says the front door never runs the stream")
    ) {
      st.ok(name);
    } else st.fail(`${name}: exit ${r.code} with:`, r.out + r.err);
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

  console.log("all faults together");
  const staleR = accept(join(tmp, "stale"));
  if (staleR.code === 1) st.ok("stale tree exits 1");
  else st.fail(`stale tree exits ${staleR.code}, want 1`, staleR.out + staleR.err);
  const staleLines = staleR.out
    .replace(/\n+$/, "")
    .split("\n")
    .filter((l) => l !== "");
  if (staleLines.length === 19) st.ok("stale tree lists 19 faults");
  else st.fail("stale tree lists:", staleR.out);
  const so = staleR.out;
  has(
    "stale SKILL itself",
    so,
    "skills/postmaster/SKILL.md: still says the front door never runs the stream itself",
  );
  has(
    "stale SKILL spawn-does-it",
    so,
    "skills/postmaster/SKILL.md: still says the spawned session does that instead",
  );
  has(
    "stale SKILL only-flow",
    so,
    "skills/postmaster/SKILL.md: still says spawn, hand over and stop is the only flow",
  );
  has(
    "stale SKILL bootstrap",
    so,
    "skills/postmaster/SKILL.md: still says bootstrap never runs the stream",
  );
  has(
    "stale postmaster spawned",
    so,
    "skills/postmaster/postmaster.md: still says the bootstrap always spawned it",
  );
  has("stale AGENTS table", so, "AGENTS.md: still says the postmaster is spawned by SKILL.md");
  has("stale AGENTS door", so, "AGENTS.md: still says the front door only spawns a postmaster");
  has(
    "stale SKILL general",
    so,
    "skills/postmaster/SKILL.md: still says the front door never runs the stream",
  );
  has(
    "stale postmaster general",
    so,
    "skills/postmaster/postmaster.md: still says the front door never runs the stream",
  );
  has("stale AGENTS general", so, "AGENTS.md: still says the front door never runs the stream");
  has("stale README", so, "README.md: still says the front door never runs the stream");

  const cleanR = accept(join(tmp, "clean"));
  if (cleanR.code === 0 && cleanR.out === "") st.ok("clean tree passes");
  else st.fail(`clean tree exits ${cleanR.code} with:`, cleanR.out + cleanR.err);

  const missingR = accept(join(tmp, "nowhere"));
  if (missingR.code === 2) st.ok("missing tree exits 2");
  else st.fail(`missing tree exits ${missingR.code}`, missingR.out + missingR.err);

  const extraR = run(self, [join(tmp, "clean"), "extra"]);
  if (extraR.code === 2) st.ok("an extra argument exits 2");
  else st.fail(`an extra argument exits ${extraR.code}`, extraR.out + extraR.err);
  const selfExtraR = run(self, ["--self-test", "extra"]);
  if (selfExtraR.code === 2) st.ok("--self-test with an extra argument exits 2");
  else
    st.fail(
      `--self-test with an extra argument exits ${selfExtraR.code}`,
      selfExtraR.out + selfExtraR.err,
    );

  rmSync(join(tmp, "crlf"), { recursive: true, force: true });
  cpSync(join(tmp, "clean"), join(tmp, "crlf"), { recursive: true });
  writeFileSync(
    join(tmp, "crlf/skills/postmaster/SKILL.md"),
    "you confirm a launch card, spawn a postmaster\r\nsession, hand over, report where to watch it, and stop.\r\n",
    { flag: "a" },
  );
  const crlfR = accept(join(tmp, "crlf"));
  if (
    crlfR.code === 1 &&
    crlfR.out.replace(/\n+$/, "") ===
      "skills/postmaster/SKILL.md: still says spawn, hand over and stop is the only flow"
  ) {
    st.ok("a CRLF stale sentence is still caught");
  } else st.fail("a CRLF stale sentence:", `exit ${crlfR.code} with:\n${crlfR.out}`);

  rmSync(join(tmp, "locked"), { recursive: true, force: true });
  cpSync(join(tmp, "clean"), join(tmp, "locked"), { recursive: true });
  chmodSync(join(tmp, "locked/skills/postmaster/SKILL.md"), 0o000);
  const lockedR = accept(join(tmp, "locked"));
  chmodSync(join(tmp, "locked/skills/postmaster/SKILL.md"), 0o644);
  if (lockedR.code === 2) st.ok("an unreadable file exits 2, not a clean result");
  else st.fail(`an unreadable file exits ${lockedR.code}`, lockedR.out + lockedR.err);

  const liveR = accept(ROOT);
  if (liveR.code === 0) st.ok("live tree passes");
  else
    st.fail(
      "live tree still carries stale claims (expected before the fix):",
      liveR.out + liveR.err,
    );

  st.finish();
});
