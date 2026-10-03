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
//
//   exit 0  no stale claim remains
//   exit 1  stale claims, one per line on stdout: <file>: <what is still claimed>
//   exit 2  usage, or a file that cannot be read
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { toolRoot } from "./lib/paths.ts";

function usage(): never {
  console.error("usage: front-door-acceptance.sh [repo-root]");
  process.exit(2);
}

/** flat <path>: fold newlines so a reflow alone never passes. */
function flat(path: string): string {
  const text = readFileSync(path, "utf8")
    .replace(/\r/gu, "")
    .replace(/[\n\t]/gu, "  ");
  return text.replace(/ {2,}/gu, " ");
}

interface AcceptResult {
  code: number;
  out: string;
  err: string;
}

export function accept(root: string): AcceptResult {
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

if (import.meta.main) {
  if (argv[0]?.startsWith("-")) {
    usage();
  } else if (argv[0] === undefined) {
    if (argv.length !== 0) usage();
    printAccept(accept(ROOT));
  } else {
    if (argv.length !== 1) usage();
    printAccept(accept(argv[0]));
  }
}
