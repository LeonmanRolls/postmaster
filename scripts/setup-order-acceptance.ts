// Acceptance oracle for setup asking which project to work on before anything else:
// the project question comes first, offers postmaster itself or another project, and
// offers the session's own project first when it stands in one; the README names both
// ways to start. Nine stale sentences and phrases from the config-first order must be
// gone, matched verbatim after newlines are folded (carriage returns stripped first,
// so CRLF never hides one); five phrases the new order says must be present; and two
// section orders must hold. Further paraphrases are beyond a grep oracle. Any
// conditional rewrite breaks every match.
//
//   run setup-order-acceptance [repo-root]   default: the repo this script lives in
//
//   exit 0  the project question comes first, everywhere it is stated
//   exit 1  stale order remains, one fault per line on stdout: <file>: <what is wrong>
//   exit 2  usage, or a file that cannot be read
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { toolRoot } from "./lib/paths.ts";

function usage(): never {
  console.error("usage: run setup-order-acceptance [repo-root]");
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
  const files = ["AGENTS.md", "skills/postmaster/SKILL.md", "README.md"];
  for (const f of files) {
    try {
      readFileSync(join(root, f));
    } catch {
      return {
        code: 2,
        out: "",
        err: `setup-order-acceptance: cannot read ${join(root, f)}\n`,
      };
    }
  }
  const texts: Record<string, string> = {};
  for (const f of files) {
    try {
      texts[f] = flat(join(root, f));
    } catch {
      return {
        code: 2,
        out: "",
        err: `setup-order-acceptance: cannot read ${join(root, f)}\n`,
      };
    }
  }
  const agents = texts["AGENTS.md"] ?? "";
  const skill = texts["skills/postmaster/SKILL.md"] ?? "";
  const readme = texts["README.md"] ?? "";
  const out: string[] = [];
  let fails = 0;
  const stale = (text: string, file: string, label: string, sentence: string): void => {
    if (text.includes(sentence)) {
      out.push(`${file}: still says ${label}`);
      fails += 1;
    }
  };
  const missing = (text: string, file: string, label: string, phrase: string): void => {
    if (!text.includes(phrase)) {
      out.push(`${file}: has no ${label}`);
      fails += 1;
    }
  };
  const ordered = (
    text: string,
    file: string,
    label: string,
    first: string,
    second: string,
  ): void => {
    const a = text.indexOf(first);
    const b = text.indexOf(second);
    if (a === -1 || b === -1 || a > b) {
      out.push(`${file}: ${label}`);
      fails += 1;
    }
  };
  stale(agents, "AGENTS.md", "setup runs before anything else", "before anything else");
  stale(
    agents,
    "AGENTS.md",
    "the machine is set up before a target is chosen",
    "set the machine up if it is not, choose a target",
  );
  stale(
    skill,
    "skills/postmaster/SKILL.md",
    "the target is asked whatever the cwd",
    "whatever the cwd",
  );
  stale(
    skill,
    "skills/postmaster/SKILL.md",
    "target selection waits on the config",
    "Do not continue to target selection",
  );
  stale(skill, "skills/postmaster/SKILL.md", "setup runs first", "conducts setup first");
  stale(
    skill,
    "skills/postmaster/SKILL.md",
    "the machine is readied before a target is chosen",
    "You get the machine ready if it is not, choose a target",
  );
  stale(
    readme,
    "README.md",
    "the first start sets the machine up",
    "the first time that is setting the machine up with you",
  );
  stale(
    readme,
    "README.md",
    "the postmaster is launched somewhere unnamed",
    "or launches one when it cannot be",
  );
  stale(
    readme,
    "README.md",
    "starting from another project is a later aside",
    "so you can start from any project afterwards",
  );
  ordered(
    agents,
    "AGENTS.md",
    "the setup step still comes before the project question",
    "Which project",
    "Is this project set up?",
  );
  ordered(
    skill,
    "skills/postmaster/SKILL.md",
    "the preconditions still come before the target choice",
    "Choose the target project",
    "establish the preconditions",
  );
  missing(agents, "AGENTS.md", "postmaster itself as a choice", "work on postmaster itself");
  missing(
    skill,
    "skills/postmaster/SKILL.md",
    "postmaster itself as a choice",
    "work on postmaster itself",
  );
  missing(
    skill,
    "skills/postmaster/SKILL.md",
    "the session's own project offered first",
    "offer that project first",
  );
  missing(readme, "README.md", "the two ways to start", "two ways to start");
  missing(readme, "README.md", "the trust prompt on a first start", "whether to trust");
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
