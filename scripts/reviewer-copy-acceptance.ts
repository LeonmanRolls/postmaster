// Acceptance oracle for #342: every reviewer works in its own copy of the repository.
// The review cut and its pre-launch check run through review-round, which passes
// --clone <BASE> under every lens; coachman.md says so in prose, and the paths
// table, the brief wording, the bug lens text, the host
// placement text and the review-skills wiki page call the reviewer folders clones.
// Stale checks name one pre-change sentence each, matched after newlines are folded
// (carriage returns stripped first, so CRLF never hides one), and two match the claim
// itself in every file in scope (`reviewer worktree`, `worktree detached at the
// snapshot`): a new sentence in one of these phrasings trips the same guard. Further
// paraphrases are beyond a grep oracle. Presence pins hold the cut and check shapes
// and the replacement wording; the wording beyond those pins is judged by reading,
// not by this script.
//
//   run reviewer-copy-acceptance [repo-root]   default: the repo this script lives in
//
//   exit 0  no stale claim remains and every pin holds
//   exit 1  stale claims or dropped pins, one per line on stdout: <file>: <what>
//   exit 2  usage, or a file that cannot be read
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { toolRoot } from "./lib/paths.ts";

const COACH = "skills/postmaster/coachman.md";
const HARNESS = "skills/postmaster/harnesses.md";
const HOSTS = "skills/postmaster/hosts.md";
const WIKI = "wiki/concepts/own-review-skills.md";

function usage(): never {
  console.error("usage: run reviewer-copy-acceptance [repo-root]");
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
  const files = [COACH, HARNESS, HOSTS, WIKI];
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
      err.push(`reviewer-copy-acceptance: cannot read ${p}`);
      return { code: 2, out: "", err: `${err.join("\n")}\n` };
    }
  }
  const texts: Record<string, string> = {};
  for (const f of files) {
    try {
      texts[f] = flat(join(root, f));
    } catch {
      err.push(`reviewer-copy-acceptance: cannot read ${join(root, f)}`);
      return { code: 2, out: "", err: `${err.join("\n")}\n` };
    }
  }
  const coach = texts[COACH] ?? "";
  const harness = texts[HARNESS] ?? "";
  const hosts = texts[HOSTS] ?? "";
  const wiki = texts[WIKI] ?? "";
  const out: string[] = [];
  let fails = 0;
  const stale = (text: string, file: string, label: string, sentence: string): void => {
    if (text.includes(sentence)) {
      out.push(`${file}: still says ${label}`);
      fails += 1;
    }
  };
  const present = (text: string, file: string, label: string, sentence: string): void => {
    if (!text.includes(sentence)) {
      out.push(`${file}: no longer ${label}`);
      fails += 1;
    }
  };
  stale(
    coach,
    COACH,
    "the clone flag is conditional on the security lens",
    '[ "$LENS" = security ] && CLONE=',
  );
  stale(coach, COACH, "the scratch is cut through a conditional clone flag", '"${CLONE[@]}"');
  stale(
    coach,
    COACH,
    "reviewer folders are worktrees outside security",
    "a worktree under the others",
  );
  stale(coach, COACH, "the lane works in a disposable worktree", "its own disposable worktree");
  stale(
    coach,
    COACH,
    "the security lens alone reviews from clones",
    "The security lens reviews from clones",
  );
  stale(
    coach,
    COACH,
    "only the security check requires a clone",
    "under the security lens a clone whose",
  );
  stale(
    harness,
    HARNESS,
    "a review scratch is a worktree",
    "which is a worktree detached at the snapshot",
  );
  stale(
    hosts,
    HOSTS,
    "reviewer launches run in worktrees",
    "reviewer worktrees and security-review clones",
  );
  stale(
    wiki,
    WIKI,
    "a review scratch is a worktree",
    "which is a worktree detached at the snapshot",
  );
  stale(wiki, WIKI, "the bug reviewer runs in a worktree scratch", "its own worktree scratch");
  // The claim itself, in every file.
  for (const claim of ["reviewer worktree", "worktree detached at the snapshot"]) {
    const label =
      claim === "reviewer worktree"
        ? "a reviewer works in a worktree"
        : "a review scratch remains a worktree";
    stale(coach, COACH, label, claim);
    stale(harness, HARNESS, label, claim);
    stale(hosts, HOSTS, label, claim);
    stale(wiki, WIKI, label, claim);
  }
  // The replacement wording that must survive.
  present(
    coach,
    COACH,
    "passes --clone for every lens in the review cut",
    "the scratch is cut at the snapshot, from a clone with `--clone <BASE>` under every lens",
  );
  present(
    coach,
    COACH,
    "requires a clone for every lens in the pre-launch check",
    "checks every scratch with `cut-scratch --check`",
  );
  present(
    coach,
    COACH,
    "calls the reviewer folders clones in the paths table",
    "a clone of the repository under every lens",
  );
  present(
    coach,
    COACH,
    "briefs the lane on its own copy of the repository",
    "its own disposable copy of the repository",
  );
  present(coach, COACH, "says every lens reviews from clones", "Every lens reviews from clones");
  present(
    coach,
    COACH,
    "checks every scratch is a clone",
    "and a clone whose `origin/HEAD` leads back to BASE",
  );
  present(
    harness,
    HARNESS,
    "calls a review scratch a clone",
    "which is a clone detached at the snapshot",
  );
  present(
    hosts,
    HOSTS,
    "places reviewer scratches, never reviewer worktrees",
    "That includes reviewer scratches: a clone is never opened as a separate",
  );
  present(
    wiki,
    WIKI,
    "calls a review scratch a clone",
    "which is a clone detached at the snapshot",
  );
  present(wiki, WIKI, "runs the bug reviewer in a scratch clone", "its own scratch clone");
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
