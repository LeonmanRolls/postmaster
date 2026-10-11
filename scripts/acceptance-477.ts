// Helpers for the #477 oracle: shell work a stub session plays to write local
// or repository verifiers, as the #344 oracle's stub does for #323's shape.
// The tests spawn git and scripts/run as subprocesses; nothing here imports
// the change. The upkeep sentence is copied, not imported, for the same reason.
// The stub writer is this file's own, with its own sandbox guard, so the
// oracle runs unmodified against the base commit: a shared writer that grew a
// parameter for this ticket would not exist there.
import { chmodSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitAll, initRepo, writeRepoFile } from "./acceptance-323.ts";

export const UPKEEP_SENTENCE =
  "A change which adds, changes or removes a feature updates that feature's page in the same change.";

export interface LocalSurface {
  /** The folder segment under the verifiers root: kind for unnamed, name for named. */
  seg: string;
  /** The surface in prose, as the README's H1 states it. */
  prose: string;
  /** The hand-over's Verifier: name. */
  name: string;
}

/** Shell lines writing one verifier's folder under a root, with three pages. */
export function verifierWork(root: string, surface: LocalSurface): string[] {
  const dir = `${root}/${surface.seg}`;
  return [
    `mkdir -p ${dir}/features`,
    `printf "# ${surface.seg} verifier\\n\\nFor the ${surface.prose}.\\n\\n${UPKEEP_SENTENCE}\\n" > ${dir}/README.md`,
    `printf 'Files: README.md\\nConfirmed: %s\\n' "$SHA" > ${dir}/features/README.md`,
    `printf '# f1\\n' > ${dir}/features/f1.md`,
    `printf '# f2\\n' > ${dir}/features/f2.md`,
    `printf '# f3\\n' > ${dir}/features/f3.md`,
  ];
}

/** Shell lines appending one bullet to the shared index. */
export function indexBullet(root: string, surface: LocalSurface): string {
  return `printf -- '- The ${surface.prose} verifier in ${root}/${surface.seg}/: drives it. Files: README.md, Confirmed: %s\\n' "$SHA" >> ${root}/README.md`;
}

/** Shell lines appending one proven hand-over section, its proof under ORACLE_ROOT. */
export function provenSection(root: string, surface: LocalSurface): string[] {
  return [
    `printf 'driven ok\\n' > "$ORACLE_ROOT/proof-${surface.seg}.log"`,
    `printf '## Verifier: ${surface.name}\\nFolder: ${root}/${surface.seg}\\nProof: %s\\n\\n' "$ORACLE_ROOT/proof-${surface.seg}.log" >> HANDOVER.md`,
  ];
}

/** Shell lines appending one unproven hand-over section. */
export function unprovenSection(root: string, surface: LocalSurface): string[] {
  return [
    `printf '## Verifier: ${surface.name}\\nFolder: ${root}/${surface.seg}\\nProof: none: the drive never finished\\n\\n' >> HANDOVER.md`,
  ];
}

/**
 * The work a stub session plays for a local make: SHA first, then each
 * proven verifier's folder, the removed folder of each unproven one, the
 * index naming the proven ones plus any dangling ones, and the hand-over.
 * Commits nothing.
 */
export function localWork(
  proven: LocalSurface[],
  unproven: LocalSurface[],
  dangling: LocalSurface[] = [],
): string[] {
  const root = ".postmaster/verifier";
  const lines = ["SHA=$(git rev-parse HEAD)"];
  for (const s of proven) lines.push(...verifierWork(root, s));
  for (const s of unproven) {
    lines.push(...verifierWork(root, s));
    lines.push(`rm -rf ${root}/${s.seg}`);
  }
  lines.push(`printf '# Verifiers\\n\\n' > ${root}/README.md`);
  for (const s of [...proven, ...dangling]) lines.push(indexBullet(root, s));
  lines.push(`printf '# Handover\\n\\n' > HANDOVER.md`);
  for (const s of proven) lines.push(...provenSection(root, s));
  for (const s of unproven) lines.push(...unprovenSection(root, s));
  return lines;
}

/**
 * The work a stub session plays for a repository make of one surface: the
 * verify-app/ folder, the commit, then the hand-over with its section, as a
 * real session orders them, so the landing's diff holds only the verifier.
 */
export function repoSingleWork(surface: LocalSurface): string[] {
  const root = "verify-app";
  return [
    "SHA=$(git rev-parse HEAD)",
    ...verifierWork(root, surface),
    "git add -A",
    "git commit -qm stub",
    `printf '# Handover\\n\\n' > HANDOVER.md`,
    ...provenSection(root, surface),
  ];
}

/**
 * The work a stub session plays for a repository make of several surfaces:
 * the shared verifier/ folder, the index, the hand-over, then the commit.
 */
export function repoMultiWork(surfaces: LocalSurface[]): string[] {
  const root = "verifier";
  const lines = ["SHA=$(git rev-parse HEAD)"];
  for (const s of surfaces) lines.push(...verifierWork(root, s));
  lines.push(`printf '# Verifiers\\n\\n' > ${root}/README.md`);
  for (const s of surfaces) lines.push(indexBullet(root, s));
  lines.push("git add -A", "git commit -qm stub");
  lines.push(`printf '# Handover\\n\\n' > HANDOVER.md`);
  for (const s of surfaces) lines.push(...provenSection(root, s));
  return lines;
}

/** A stub `claude` that plays the given work in its cwd, inside its sandbox only. */
export function writeLocalStub(bin: string, work: string): void {
  const path = join(bin, "claude");
  writeFileSync(
    path,
    [
      "#!/bin/sh",
      "set -eu",
      'if [ -z "${ORACLE_ROOT:-}" ]; then echo "stub refuses: ORACLE_ROOT is unset" >&2; exit 1; fi',
      'TARGET="$PWD"',
      'TARGET=$(CDPATH= cd "$TARGET" && pwd -P) || { echo "stub refuses: cannot resolve $TARGET" >&2; exit 1; }',
      'case "$TARGET" in',
      '  "${ORACLE_ROOT}"/*) ;;',
      '  *) echo "stub refuses: $TARGET is outside $ORACLE_ROOT" >&2; exit 1 ;;',
      "esac",
      work,
      "",
    ].join("\n"),
  );
  chmodSync(path, 0o755);
}

/** A temp repo named app with one commit, canonicalized like makeSandbox's. */
export function plainRepo(): { dir: string; repo: string } {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "acceptance-477-")));
  const repo = join(dir, "app");
  initRepo(repo);
  writeRepoFile(repo, "README.md", "# app\n");
  commitAll(repo, "first");
  return { dir, repo };
}

/** Plant local verifiers by hand: the index, and one folder per surface. */
export function plantLocal(repo: string, surfaces: LocalSurface[]): void {
  const root = ".postmaster/verifier";
  writeRepoFile(repo, `${root}/README.md`, "# Verifiers\n");
  for (const s of surfaces) {
    writeRepoFile(
      repo,
      `${root}/${s.seg}/README.md`,
      `# ${s.seg} verifier\n\nFor the ${s.prose}.\n\n${UPKEEP_SENTENCE}\n`,
    );
    writeRepoFile(repo, `${root}/${s.seg}/features/README.md`, "Files: README.md\n");
    for (const page of ["f1.md", "f2.md", "f3.md"]) {
      writeRepoFile(repo, `${root}/${s.seg}/features/${page}`, `# ${page}\n`);
    }
  }
}
