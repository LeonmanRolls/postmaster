// Decide whether a git change touches the coachman contract, defined as a list
// of files in docs/coachman-contract.toml. A change anywhere in a listed file
// is a contract change.
//
//   run coachman-contract <base> <head>
//   run coachman-contract [<repo>] <base> <head>   (or --repo <repo> <base> <head>)
//   run coachman-contract --self-test
//
//   exit 0  no contract change
//   exit 1  contract change; print each listed file the change touched
//   exit 2  usage, git or contract-list error
//
// Ported from #163's bash wrapper over embedded python on #109; the .sh stays
// a wrapper. The self-test keeps its check entry in .postmaster/project.toml,
// so it stays in the script instead of moving beside it. Fixtures replicate
// the wrapper layout: scripts/coachman-contract.{sh,ts} and scripts/lib under
// a bunfig.toml, with the contract files copied beside them.

import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseTomlText } from "./lib/data.ts";
import { toolRoot } from "./lib/paths.ts";
import { run } from "./lib/proc.ts";

const TOOL = toolRoot(import.meta);

const INDEX = "docs/coachman-contract.toml";

class ContractError extends Error {}

interface ManifestEntry {
  path: string;
  holds: string;
}

interface Manifest {
  detector: string;
  files: ManifestEntry[];
}

function gitOrDie(args: string[], repo: string): string {
  const argv = ["git", "-C", repo, ...args];
  const r = run(argv[0]!, argv.slice(1));
  if (r.code !== 0) {
    const detail = r.err.trim() || r.out.trim() || `exit ${r.code}`;
    throw new ContractError(`${argv.join(" ")}: ${detail}`);
  }
  return r.out;
}

function blob(repo: string, rev: string, path: string): string | null {
  const r = run("git", ["-C", repo, "show", `${rev}:${path}`]);
  if (r.code !== 0) return null;
  return r.out;
}

/** A repo-relative path is unusable when it is empty, absolute, or escapes. */
function badPath(value: unknown): boolean {
  return (
    typeof value !== "string" ||
    value === "" ||
    value.startsWith("/") ||
    value.split("/").includes("..")
  );
}

function readIndex(repo: string, rev: string): Manifest | null {
  const raw = blob(repo, rev, INDEX);
  if (raw === null) return null;
  let data: Record<string, unknown>;
  try {
    data = parseTomlText(raw);
  } catch (e) {
    throw new ContractError(`${INDEX} at ${rev} is invalid TOML: ${(e as Error).message}`);
  }
  if (data["version"] !== 1) throw new ContractError(`${INDEX} at ${rev} must set version = 1`);
  const detector = data["detector"];
  if (typeof detector !== "string" || badPath(detector))
    throw new ContractError(`${INDEX} at ${rev} must name its detector file`);
  const files = data["files"];
  if (!Array.isArray(files) || files.length === 0)
    throw new ContractError(`${INDEX} at ${rev} must list its contract files`);
  const seen = new Set<string>();
  const entries: ManifestEntry[] = [];
  for (const entry of files) {
    const rec = typeof entry === "object" && entry !== null ? entry : null;
    const path = rec !== null ? (rec as Record<string, unknown>)["path"] : undefined;
    const holds = rec !== null ? (rec as Record<string, unknown>)["holds"] : undefined;
    if (
      badPath(path) ||
      (typeof path === "string" && seen.has(path)) ||
      typeof holds !== "string" ||
      holds.trim() === ""
    )
      throw new ContractError(`${INDEX} at ${rev} has a bad contract file entry`);
    seen.add(path as string);
    entries.push({ path: path as string, holds: holds as string });
  }
  return { detector, files: entries };
}

function changedFiles(repo: string, base: string, head: string): string[] {
  const out = gitOrDie(
    ["diff", "--no-ext-diff", "--no-renames", "--name-only", "-z", base, head, "--"],
    repo,
  );
  return out.split("\0").filter((name) => name !== "");
}

function checkChange(repo: string, base: string, head: string): string[] {
  let abs: string;
  try {
    abs = realpathSync(resolve(repo));
  } catch {
    abs = resolve(repo);
  }
  for (const rev of [base, head]) gitOrDie(["rev-parse", "--verify", `${rev}^{commit}`], abs);
  const baseIndex = readIndex(abs, base);
  const headIndex = readIndex(abs, head);
  if (baseIndex === null && headIndex === null) return [];
  const listed = new Set<string>();
  for (const data of [baseIndex, headIndex]) {
    if (data) for (const entry of data.files) listed.add(entry.path);
  }
  return [...new Set(changedFiles(abs, base, head))].filter((f) => listed.has(f)).sort();
}

function printResult(touched: string[], base: string, head: string): number {
  if (touched.length === 0) {
    console.log(`no coachman contract change (${base}..${head})`);
    return 0;
  }
  for (const path of touched) console.log(`yes ${path}`);
  return 1;
}

function control(ok: boolean, name: string, detail = ""): boolean {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
  return ok;
}

function gitFixture(repo: string, sourceRoot: string, files: Array<{ path: string }>): string {
  mkdirSync(join(repo, "scripts"), { recursive: true });
  copyFileSync(join(sourceRoot, "scripts", "run"), join(repo, "scripts", "run"));
  copyFileSync(
    join(sourceRoot, "scripts", "coachman-contract.ts"),
    join(repo, "scripts", "coachman-contract.ts"),
  );
  cpSync(join(sourceRoot, "scripts", "lib"), join(repo, "scripts", "lib"), { recursive: true });
  copyFileSync(join(sourceRoot, "bunfig.toml"), join(repo, "bunfig.toml"));
  for (const entry of files) {
    const target = join(repo, entry.path);
    if (!existsSync(target)) {
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(join(sourceRoot, entry.path), target);
    }
  }
  mkdirSync(join(repo, "skills", "postmaster"), { recursive: true });
  writeFileSync(join(repo, "README.md"), "fixture\n", "utf8");
  const g = (...args: string[]): string => gitOrDie(args, repo);
  const init = run("git", ["init", "-q", "-b", "main", repo]);
  if (init.code !== 0) {
    const detail = init.err.trim() || init.out.trim() || `exit ${init.code}`;
    throw new ContractError(`git init -q -b main ${repo}: ${detail}`);
  }
  g("config", "user.name", "brindlewick");
  g("config", "user.email", "332054101+brindlewick@users.noreply.github.com");
  chmodSync(join(repo, "scripts", "run"), 0o755);
  g("add", ".");
  g("commit", "-q", "-m", "fixture baseline");
  return g("rev-parse", "HEAD").trim();
}

function commitFixture(repo: string, message: string): string {
  const g = (...args: string[]): string => gitOrDie(args, repo);
  g("add", ".");
  g("commit", "-q", "-m", message);
  return g("rev-parse", "HEAD").trim();
}

/** A listed .ts file's opening comment line: the wording a fix extends. */
const TS_HEAD = "// ";

function exerciseSelfTest(sourceRoot: string): number {
  let files: Array<{ path: string }>;
  try {
    const data = parseTomlText(readFileSync(join(sourceRoot, INDEX), "utf8"));
    if (!Array.isArray(data["files"])) throw new Error("no files list");
    files = data["files"] as Array<{ path: string }>;
  } catch (e) {
    throw new ContractError(`cannot read the current contract index: ${(e as Error).message}`);
  }
  let passed = 0;
  let failed = 0;
  console.log("coachman-contract self-test");

  const runCase = (label: string, edit: (repo: string) => void, expectedFile?: string): void => {
    const scratch = mkdtempSync(join(sourceRoot, "coachman-contract-"));
    try {
      const repo = join(scratch, "repo");
      const base = gitFixture(repo, sourceRoot, files);
      edit(repo);
      const head = commitFixture(repo, label);
      const result = run(join(repo, "scripts", "run"), ["coachman-contract", base, head], {
        cwd: repo,
      });
      const expectedCode = expectedFile ? 1 : 0;
      let ok = result.code === expectedCode;
      if (expectedFile) ok = ok && result.out.split("\n").includes(`yes ${expectedFile}`);
      else ok = ok && result.out.startsWith("no coachman contract change");
      if (control(ok, label, `exit ${result.code}`)) passed += 1;
      else {
        failed += 1;
        if (result.err) console.log(`       ${result.err.trim().replace(/\n/g, "\n       ")}`);
        if (result.out) console.log(`       ${result.out.trim().replace(/\n/g, "\n       ")}`);
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  };

  const replaceOnce = (repo: string, rel: string, before: string, after: string): void => {
    const target = join(repo, rel);
    const content = readFileSync(target, "utf8");
    if (!content.includes(before))
      throw new ContractError(`self-test fixture is missing ${JSON.stringify(before)} in ${rel}`);
    writeFileSync(target, content.replace(before, after));
  };

  const tsCase = (label: string, rel: string, comment: string): void =>
    runCase(label, (repo) => replaceOnce(repo, rel, TS_HEAD, `// ${comment}\n// `), rel);

  runCase(
    "editing the contract list itself answers yes",
    (repo) =>
      replaceOnce(
        repo,
        INDEX,
        'holds = "the required handoff sections"',
        'holds = "the required handoff sections, every one of them"',
      ),
    INDEX,
  );
  runCase(
    "a wording fix in coachman.md answers yes",
    (repo) =>
      replaceOnce(
        repo,
        "skills/postmaster/coachman.md",
        "will be killed and restarted.",
        "will be killed, then restarted.",
      ),
    "skills/postmaster/coachman.md",
  );
  runCase(
    "a wording fix in postmaster.md answers yes",
    (repo) =>
      replaceOnce(
        repo,
        "skills/postmaster/postmaster.md",
        "You run no model lane and edit no source.",
        "You run no model lane and edit no source at all.",
      ),
    "skills/postmaster/postmaster.md",
  );
  runCase(
    "a wording fix in the waybill template answers yes",
    (repo) =>
      replaceOnce(
        repo,
        "skills/postmaster/SKILL.md",
        "(the postmaster sets yes or no at the final card)",
        "(the postmaster sets yes or no there)",
      ),
    "skills/postmaster/SKILL.md",
  );
  tsCase("a wording fix in run host answers yes", "scripts/host.ts", "the exit watcher");
  tsCase(
    "a change in run runs-status answers yes",
    "scripts/runs-status.ts",
    "the completion poll",
  );
  tsCase(
    "a wording fix in run turnpikes answers yes",
    "scripts/turnpikes.ts",
    "the turnpike table",
  );
  tsCase("a wording fix in run stage answers yes", "scripts/stage.ts", "the stage list");
  tsCase(
    "a wording fix in run handoff-check answers yes",
    "scripts/handoff-check.ts",
    "the required sections",
  );
  tsCase(
    "a wording fix in the detector answers yes",
    "scripts/coachman-contract.ts",
    "the detector entrypoint",
  );
  tsCase("a wording fix in run landing answers yes", "scripts/landing.ts", "the landing");
  tsCase(
    "a wording fix in run runs-watch answers yes",
    "scripts/runs-watch.ts",
    "the mechanical steps",
  );
  tsCase("a wording fix in run run-meta answers yes", "scripts/run-meta.ts", "the run record");
  tsCase(
    "a wording fix in run ticket-check answers yes",
    "scripts/ticket-check.ts",
    "the journey reading",
  );
  runCase(
    "a wording fix in the spec session runbook answers yes",
    (repo) =>
      replaceOnce(
        repo,
        "skills/postmaster/spec-session.md",
        "**You edit only the copy** named in the brief,",
        "**You edit only that copy** named in the brief,",
      ),
    "skills/postmaster/spec-session.md",
  );
  tsCase(
    "a wording fix in run spec-session answers yes",
    "scripts/spec-session.ts",
    "the spec session's verbs",
  );
  runCase(
    "a wording fix in spec-session.ts answers yes",
    (repo) =>
      replaceOnce(
        repo,
        "scripts/spec-session.ts",
        "// The spec session's two verbs: brief writes the interactive session's brief, and approve",
        "// The spec session's two verbs: brief writes the session's brief, and approve",
      ),
    "scripts/spec-session.ts",
  );
  tsCase(
    "a wording fix in run spec-decisions answers yes",
    "scripts/spec-decisions.ts",
    "the approval record's verbs",
  );
  runCase(
    "a wording fix in spec-decisions.ts answers yes",
    (repo) =>
      replaceOnce(
        repo,
        "scripts/spec-decisions.ts",
        "// Own the planning stage's spec decisions: one file per package, one stanza for the run's",
        "// Own the planning stage's spec decisions: one file per package, and one stanza for the run's",
      ),
    "scripts/spec-decisions.ts",
  );
  tsCase("a wording fix in run launch answers yes", "scripts/launch.ts", "the attempt phase");
  tsCase(
    "a wording fix in run fixture answers yes",
    "scripts/fixture.ts",
    "fixture copies and scores",
  );
  runCase(
    "a wording fix in fixture.ts answers yes",
    (repo) =>
      replaceOnce(
        repo,
        "scripts/fixture.ts",
        "// `new` marks its copy with `postmaster.fixture` in that repository's local git config.",
        "// `new` marks its copy with `postmaster.fixture` in that copy's local git config.",
      ),
    "scripts/fixture.ts",
  );
  runCase(
    "a wording fix in the workhorse spec template answers yes",
    (repo) =>
      replaceOnce(
        repo,
        "skills/postmaster/workhorse-spec-template.md",
        "`## Showing each criterion` is how the lanes check their work: for each acceptance criterion,",
        "`## Showing each criterion` is how the lanes check their work: for every acceptance criterion,",
      ),
    "skills/postmaster/workhorse-spec-template.md",
  );
  runCase(
    "a wording fix in summary-evidence.ts answers yes",
    (repo) =>
      replaceOnce(
        repo,
        "scripts/summary-evidence.ts",
        "// this file's tests. Expected criteria come from the ticket, never inferred from the summary.",
        "// this file's tests. Expected criteria come from the ticket, never derived from the summary.",
      ),
    "scripts/summary-evidence.ts",
  );
  runCase("a wiki-only change is not a contract change", (repo) => {
    mkdirSync(join(repo, "wiki", "concepts"), { recursive: true });
    writeFileSync(join(repo, "wiki", "concepts", "probe-note.md"), "notes\n", "utf8");
  });
  runCase("a README-only change is not a contract change", (repo) =>
    writeFileSync(
      join(repo, "README.md"),
      `${readFileSync(join(repo, "README.md"), "utf8")}More fixture.\n`,
      "utf8",
    ),
  );
  runCase("adding a harness entry is not a contract change", (repo) =>
    writeFileSync(
      join(repo, "skills", "postmaster", "harnesses.md"),
      "\nNew harness entry.\n",
      "utf8",
    ),
  );
  runCase("ticket prose naming the contract is not a contract change", (repo) =>
    writeFileSync(
      join(repo, "TICKET.md"),
      "## Problem\n\nThis changes the coachman contract and the markers.\n",
      "utf8",
    ),
  );

  const neuteredControl = (): void => {
    const label = "neutering the detector entrypoint is a contract change";
    const scratch = mkdtempSync(join(sourceRoot, "coachman-contract-"));
    try {
      const repo = join(scratch, "repo");
      const base = gitFixture(repo, sourceRoot, files);
      const honestDir = join(scratch, "honest");
      mkdirSync(join(honestDir, "scripts"), { recursive: true });
      for (const name of ["run", "coachman-contract.ts"]) {
        const shown = run("git", ["-C", repo, "show", `${base}:scripts/${name}`]);
        if (shown.code !== 0) throw new ContractError(`cannot read scripts/${name} at ${base}`);
        writeFileSync(join(honestDir, "scripts", name), shown.out);
      }
      cpSync(join(sourceRoot, "scripts", "lib"), join(honestDir, "scripts", "lib"), {
        recursive: true,
      });
      copyFileSync(join(sourceRoot, "bunfig.toml"), join(honestDir, "bunfig.toml"));
      chmodSync(join(honestDir, "scripts", "run"), 0o755);
      replaceOnce(
        repo,
        "scripts/coachman-contract.ts",
        "function main(argv: string[]): number {\n  if (argv.length === 0) {",
        "function main(argv: string[]): number {\n  return 0; // neutered: always answers no\n  if (argv.length === 0) {",
      );
      const head = commitFixture(repo, label);
      const neutered = run(join(repo, "scripts", "run"), ["coachman-contract", base, head], {
        cwd: repo,
      });
      const honest = run(join(honestDir, "scripts", "run"), ["coachman-contract", base, head], {
        cwd: repo,
      });
      const ok =
        neutered.code === 0 &&
        honest.code === 1 &&
        honest.out.split("\n").includes("yes scripts/coachman-contract.ts");
      if (control(ok, label, `exits ${neutered.code}/${honest.code}`)) passed += 1;
      else {
        failed += 1;
        if (honest.err) console.log(`       ${honest.err.trim().replace(/\n/g, "\n       ")}`);
        if (honest.out) console.log(`       ${honest.out.trim().replace(/\n/g, "\n       ")}`);
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  };
  neuteredControl();

  const versionControl = (): void => {
    const label = "an index that does not set version 1 is an error";
    const scratch = mkdtempSync(join(sourceRoot, "coachman-contract-"));
    try {
      const repo = join(scratch, "repo");
      const base = gitFixture(repo, sourceRoot, files);
      replaceOnce(repo, INDEX, "version = 1", "version = 2");
      const head = commitFixture(repo, label);
      const result = run(join(repo, "scripts", "run"), ["coachman-contract", base, head], {
        cwd: repo,
      });
      const ok = result.code === 2 && result.err.includes("version");
      if (control(ok, label, `exit ${result.code}`)) passed += 1;
      else {
        failed += 1;
        if (result.err) console.log(`       ${result.err.trim().replace(/\n/g, "\n       ")}`);
        if (result.out) console.log(`       ${result.out.trim().replace(/\n/g, "\n       ")}`);
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  };
  versionControl();

  const detectorControl = (): void => {
    const label = "an index that names no detector file is an error";
    const scratch = mkdtempSync(join(sourceRoot, "coachman-contract-"));
    try {
      const repo = join(scratch, "repo");
      const base = gitFixture(repo, sourceRoot, files);
      replaceOnce(repo, INDEX, 'detector = "scripts/coachman-contract.ts"\n', "");
      const head = commitFixture(repo, label);
      const result = run(join(repo, "scripts", "run"), ["coachman-contract", base, head], {
        cwd: repo,
      });
      const ok = result.code === 2 && result.err.includes("detector");
      if (control(ok, label, `exit ${result.code}`)) passed += 1;
      else {
        failed += 1;
        if (result.err) console.log(`       ${result.err.trim().replace(/\n/g, "\n       ")}`);
        if (result.out) console.log(`       ${result.out.trim().replace(/\n/g, "\n       ")}`);
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  };
  detectorControl();

  const mergeControl = (contract: boolean): void => {
    const label = contract
      ? "main merge with a contract change repeats the fixture"
      : "main merge without a contract change keeps the fixture";
    const scratch = mkdtempSync(join(sourceRoot, "coachman-contract-"));
    try {
      const repo = join(scratch, "repo");
      const base = gitFixture(repo, sourceRoot, files);
      const g = (...args: string[]): string => gitOrDie(args, repo);
      g("switch", "-q", "-c", "feature");
      g("switch", "-q", "main");
      let part: string | null = null;
      if (contract) {
        replaceOnce(
          repo,
          "scripts/stage.ts",
          TS_HEAD,
          "#!/usr/bin/env bash\n# the stage list\n# except on a contract-2 run\nexec bun",
        );
        part = "scripts/stage.ts";
      } else {
        writeFileSync(join(repo, "skills", "postmaster", "harnesses.md"), "new harness\n", "utf8");
      }
      commitFixture(repo, "change on main");
      g("switch", "-q", "feature");
      g("merge", "-q", "--no-ff", "main", "-m", "merge main");
      const head = g("rev-parse", "HEAD").trim();
      const result = run(join(repo, "scripts", "run"), ["coachman-contract", base, head], {
        cwd: repo,
      });
      let ok = result.code === (contract ? 1 : 0);
      if (part) ok = ok && result.out.split("\n").includes(`yes ${part}`);
      else ok = ok && result.out.startsWith("no coachman contract change");
      if (control(ok, label, `exit ${result.code}`)) passed += 1;
      else {
        failed += 1;
        if (result.err) console.log(`       ${result.err.trim().replace(/\n/g, "\n       ")}`);
        if (result.out) console.log(`       ${result.out.trim().replace(/\n/g, "\n       ")}`);
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  };
  mergeControl(true);
  mergeControl(false);

  const repoFormControl = (): void => {
    const label = "the [repo] base head form classifies from outside the repo";
    const scratch = mkdtempSync(join(sourceRoot, "coachman-contract-"));
    try {
      const repo = join(scratch, "repo");
      const base = gitFixture(repo, sourceRoot, files);
      replaceOnce(
        repo,
        "scripts/stage.ts",
        TS_HEAD,
        "// the stage list\n// except on a contract-2 run\n// ",
      );
      const head = commitFixture(repo, label);
      const result = run(join(repo, "scripts", "run"), ["coachman-contract", repo, base, head], {
        cwd: sourceRoot,
      });
      const ok = result.code === 1 && result.out.split("\n").includes("yes scripts/stage.ts");
      if (control(ok, label, `exit ${result.code}`)) passed += 1;
      else {
        failed += 1;
        if (result.err) console.log(`       ${result.err.trim().replace(/\n/g, "\n       ")}`);
        if (result.out) console.log(`       ${result.out.trim().replace(/\n/g, "\n       ")}`);
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  };
  repoFormControl();

  console.log(`coachman-contract self-test: ${passed} passed, ${failed} failed`);
  return failed === 0 ? 0 : 1;
}

/** BASE mode: run BASE's own detector from a copy of BASE's tree. */
function atBase(repo: string, base: string, head: string): number {
  const scratch = mkdtempSync(join(repo, "..", "coachman-at-base-"));
  try {
    const scriptsList = run("git", ["-C", repo, "ls-tree", "--name-only", `${base}:scripts`]);
    if (scriptsList.code !== 0) {
      console.error(`coachman-contract: cannot list scripts/ at ${base}`);
      return 2;
    }
    mkdirSync(join(scratch, "scripts"), { recursive: true });
    for (const name of scriptsList.out.split("\n").filter(Boolean)) {
      if (name === "lib" || name.endsWith("/")) continue;
      const blob = run("git", ["-C", repo, "show", `${base}:scripts/${name}`]);
      if (blob.code !== 0) continue;
      const dest = join(scratch, "scripts", name);
      writeFileSync(dest, blob.out, {
        mode: name === "run" || name.endsWith(".sh") ? 0o755 : 0o644,
      });
    }
    const libList = run("git", ["-C", repo, "ls-tree", "--name-only", `${base}:scripts/lib`]);
    if (libList.code === 0) {
      mkdirSync(join(scratch, "scripts", "lib"), { recursive: true });
      for (const name of libList.out.split("\n").filter(Boolean)) {
        const blob = run("git", ["-C", repo, "show", `${base}:scripts/lib/${name}`]);
        if (blob.code === 0) writeFileSync(join(scratch, "scripts", "lib", name), blob.out);
      }
    }
    const bunfig = run("git", ["-C", repo, "show", `${base}:bunfig.toml`]);
    if (bunfig.code === 0) writeFileSync(join(scratch, "bunfig.toml"), bunfig.out);
    const indexBlob = run("git", ["-C", repo, "show", `${base}:docs/coachman-contract.toml`]);
    if (indexBlob.code !== 0) {
      console.error(`coachman-contract: no contract index at ${base}`);
      return 2;
    }
    let detector = "scripts/coachman-contract.sh";
    for (const line of indexBlob.out.split("\n")) {
      const m = line.match(/^detector[ 	]*=[ 	]*"([^"]+)"/u);
      if (m) detector = m[1]!;
    }
    const detectorName = detector.replace(/^scripts\//u, "");
    const isSh = detectorName.endsWith(".sh");
    const r = isSh
      ? run("bash", [join(scratch, "scripts", detectorName), repo, base, head], { cwd: repo })
      : run(join(scratch, "scripts", "run"), ["coachman-contract", repo, base, head], {
          cwd: repo,
        });
    process.stdout.write(r.out);
    process.stderr.write(r.err);
    return r.code;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function main(argv: string[]): number {
  if (argv.length === 0) {
    console.error("usage: run coachman-contract [<repo>] <base> <head> | --self-test");
    return 2;
  }
  if (argv[0] === "--self-test") {
    if (argv.length !== 1) {
      console.error("usage: run coachman-contract --self-test");
      return 2;
    }
    try {
      return exerciseSelfTest(TOOL);
    } catch (e) {
      if (!(e instanceof ContractError)) throw e;
      console.error(`coachman-contract: ${e.message}`);
      return 2;
    }
  }
  if (argv[0] === "--at-base") {
    // --at-base <repo> <base> <head>: extract BASE's scripts/ and bunfig.toml into a
    // temporary folder, run the detector file BASE's contract index names (a .sh with
    // bash, a .ts through that copy's scripts/run), pass its output and exit through,
    // and remove the folder itself.
    if (argv.length !== 4) {
      console.error("usage: run coachman-contract --at-base <repo> <base> <head>");
      return 2;
    }
    return atBase(argv[1]!, argv[2]!, argv[3]!);
  }
  let repo: string;
  let base: string;
  let head: string;
  if (argv[0] === "--repo" && argv.length === 4) {
    repo = argv[1]!;
    base = argv[2]!;
    head = argv[3]!;
  } else if (argv.length === 2) {
    const top = run("git", ["rev-parse", "--show-toplevel"]);
    if (top.code !== 0) {
      console.error("coachman-contract: run from a git repository or pass --repo");
      return 2;
    }
    repo = top.out.trim();
    base = argv[0]!;
    head = argv[1]!;
  } else if (argv.length === 3) {
    repo = argv[0]!;
    base = argv[1]!;
    head = argv[2]!;
  } else {
    console.error("usage: run coachman-contract [<repo>] <base> <head> | --self-test");
    return 2;
  }
  try {
    return printResult(checkChange(repo, base, head), base, head);
  } catch (e) {
    if (!(e instanceof ContractError)) throw e;
    console.error(`coachman-contract: ${e.message}`);
    return 2;
  }
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
