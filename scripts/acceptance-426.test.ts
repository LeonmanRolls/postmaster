// Oracle for #426, committed before the change: runs on other projects
// install only approved libraries, and only packages a week old, scanned and
// with no install script. C1 pins the ticket list plus the recorded yes on
// each of npm, pnpm, Yarn Classic and Bun; C2 the seven-day wait and its
// waiver; C3 blocked install scripts and the per-package allowance; C4
// Socket's verdict and the fail-closed scanner; C5 the dispatch gate for
// managers the checks do not cover; C6 the fixture mechanics plus the
// dispatched run, which needs model lanes and stays hand-verified by the
// postmaster at landing. Bare syncs, one-shot runs, scoped names, global
// installs and the trust commands are pinned beside the criteria that imply
// them. Every install case drives the real manager through the guard's own
// shim against a loopback registry, and proves "before any download" from
// the registry's request log, never from the guard's word. Refusals exit 1,
// name the package and tell the agent to stop and report it; the dispatch
// hold exits 2. Berry's decisions run against a stub yarn here and for real
// in the hand-run transcript on the run's card: no deterministic Berry binary
// exists for CI, so the oracle never downloads one. One case pins that the
// shim never recurses: bun through the shim, under timeout, with the process
// group watched and a trip-wire that kills the tree within seconds.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEV_BIN,
  FIXTURES,
  PMS,
  ROOT,
  RUN,
  SHIM,
  buildTarball,
  expectRefused,
  guarded,
  installedVersion,
  mkDispatch,
  mkProject,
  packumentHits,
  pmBin,
  removeDir,
  runAsync,
  scratchDir,
  startRegistry,
  tarballHits,
  type Guarded,
  type Pm,
  type Registry,
  type RegistryVersion,
} from "./acceptance-426.ts";
import { run } from "./lib/proc.ts";
import { processTable } from "./lib/processes.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const isoAgo = (ms: number): string => new Date(Date.now() - ms).toISOString();

let tmp = "";
let registry: Registry;
let tarballs = "";
// Resolved at collection time, so skipIf reads the finished values: beforeAll
// runs after the tests are defined.
const avail: Record<Pm, boolean> = {
  npm: pmBin("npm") !== null,
  pnpm: pmBin("pnpm") !== null,
  yarn: pmBin("yarn") !== null,
  bun: pmBin("bun") !== null,
};
const snapshots: Partial<Record<Pm, { plain: string; scripts: string }>> = {};

function seed(): void {
  const old = isoAgo(8 * DAY_MS);
  const young = isoAgo(1 * DAY_MS);
  const over = isoAgo(7 * DAY_MS + 2 * 60 * 60 * 1000);
  const under = isoAgo(7 * DAY_MS - 2 * 60 * 60 * 1000);
  const v = (
    version: string,
    published: string,
    tb: { file: string; integrity: string },
    deps: Pick<
      RegistryVersion,
      "dependencies" | "optionalDependencies" | "peerDependencies" | "scripts" | "bin"
    > = {},
  ): RegistryVersion => ({
    version,
    published,
    tarball: tb.file,
    integrity: tb.integrity,
    ...deps,
  });
  const t = (dir: string, version: string) => buildTarball(join(FIXTURES, dir), tarballs, version);
  const add = (name: string, latest: string, versions: RegistryVersion[]): void => {
    registry.packages.set(name, { tags: { latest }, versions });
    for (const ver of versions) registry.verdicts.set(`${name}@${ver.version}`, []);
  };
  const clean10 = t("g-clean", "1.0.0");
  const clean11 = t("g-clean", "1.1.0");
  const clean12 = t("g-clean", "1.2.0");
  const clean13 = t("g-clean", "1.3.0");
  add("g-clean", "1.0.0", [
    v("1.0.0", old, clean10),
    v("1.1.0", young, clean11),
    v("1.2.0", over, clean12),
    v("1.3.0", under, clean13),
  ]);
  const trans = t("g-trans", "1.0.0");
  add("g-trans", "1.0.0", [v("1.0.0", old, trans)]);
  const dep = t("g-dep", "1.0.0");
  add("g-dep", "1.0.0", [v("1.0.0", old, dep, { dependencies: { "g-trans": "^1.0.0" } })]);
  const scripts = t("g-scripts", "1.0.0");
  add("g-scripts", "1.0.0", [
    v("1.0.0", old, scripts, { scripts: { postinstall: "node mark.js" } }),
  ]);
  const ds = t("g-depscripts", "1.0.0");
  add("g-depscripts", "1.0.0", [v("1.0.0", old, ds, { dependencies: { "g-scripts": "^1.0.0" } })]);
  const flag = t("g-flag", "1.0.0");
  add("g-flag", "1.0.0", [v("1.0.0", old, flag)]);
  const yc = t("g-youngchild", "2.0.0");
  add("g-youngchild", "2.0.0", [v("2.0.0", young, yc)]);
  const yd = t("g-youngdep", "1.0.0");
  add("g-youngdep", "1.0.0", [v("1.0.0", old, yd, { dependencies: { "g-youngchild": "^2.0.0" } })]);
  const peer = t("g-peer", "1.0.0");
  add("g-peer", "1.0.0", [v("1.0.0", old, peer, { peerDependencies: { "g-clean": "^1.0.0" } })]);
  const pf = t("g-peerfree", "1.0.0");
  add("g-peerfree", "1.0.0", [
    v("1.0.0", old, pf, { peerDependencies: { "g-missingpeer": "^1.0.0" } }),
  ]);
  const mp = t("g-missingpeer", "1.0.0");
  add("g-missingpeer", "1.0.0", [v("1.0.0", young, mp)]);
  const no = t("g-needsopt", "1.0.0");
  add("g-needsopt", "1.0.0", [
    v("1.0.0", old, no, { optionalDependencies: { "g-youngchild": "^2.0.0" } }),
  ]);
  const bin1 = t("g-binpkg", "1.0.0");
  const bin2 = t("g-binpkg", "2.0.0");
  add("g-binpkg", "1.0.0", [
    v("1.0.0", old, bin1, { bin: { "g-bin": "./cli.js" } }),
    v("2.0.0", young, bin2, { bin: { "g-bin": "./cli.js" } }),
  ]);
  const scoped = t("gscoped", "2.0.0");
  add("@gscope/g-scoped", "2.0.0", [v("2.0.0", old, scoped)]);
  const ghost = t("g-ghost", "9.9.9");
  registry.packages.set("g-ghost", {
    tags: { latest: "9.9.9" },
    versions: [v("9.9.9", old, ghost)],
  });
}

/** Generate committed-lockfile snapshots per manager with direct unguarded
 * installs, so the sync cases start from real lockfiles. */
async function snapshot(pm: Pm): Promise<void> {
  const bin = pmBin(pm);
  if (bin === null) return;
  const env = (process.env as Record<string, string>).PATH;
  const pathEnv = `${DEV_BIN}:${env}`;
  const add = async (dir: string, spec: string): Promise<void> => {
    // Snapshots need only the lockfile: install scriptless so pnpm's native
    // build gate does not fail the fixture setup.
    const r = await runAsync(
      bin,
      [
        "add",
        spec,
        "--registry",
        registry.url,
        "--ignore-scripts",
        ...(pm === "yarn" ? ["--non-interactive"] : []),
        ...(pm === "npm" ? ["--no-audit", "--no-fund"] : []),
      ],
      {
        cwd: dir,
        env: { ...(process.env as Record<string, string>), PATH: pathEnv },
      },
    );
    if (r.code !== 0)
      throw new Error(`snapshot ${pm} add ${spec}: ${(r.err + r.out).slice(0, 400)}`);
  };
  const plain = mkProject(tmp, `snap-${pm}-plain`);
  await add(plain, "g-clean@1.0.0");
  const scripts = mkProject(tmp, `snap-${pm}-scripts`);
  await add(scripts, "g-scripts@1.0.0");
  snapshots[pm] = { plain, scripts };
}

function fromSnapshot(pm: Pm, which: "plain" | "scripts", name: string): string {
  const snap = snapshots[pm]?.[which];
  if (snap === undefined) throw new Error(`no ${pm} ${which} snapshot`);
  const dir = join(tmp, name);
  mkdirSync(dir, { recursive: true });
  for (const file of [
    "package.json",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lock",
    "bun.lockb",
  ]) {
    const src = join(snap, file);
    if (existsSync(src)) cpSync(src, join(dir, file));
  }
  return dir;
}

function drain(): void {
  registry.log.splice(0);
}

beforeAll(async () => {
  tmp = scratchDir("acceptance-426-");
  tarballs = join(tmp, "tarballs");
  mkdirSync(tarballs, { recursive: true });
  registry = startRegistry(tarballs);
  seed();
  for (const pm of PMS) if (avail[pm]) await snapshot(pm);
}, 300000);

afterAll(() => {
  registry.stop();
  removeDir(tmp);
});

const yes = (target: string) => ({
  actor: "postmaster",
  action: "library-yes",
  target,
  detail: "user said yes",
});

describe("C1: the ticket list plus the recorded yes", () => {
  for (const pm of PMS) {
    const skip = () => !avail[pm];
    test.skipIf(skip())(`${pm}: an unlisted library is refused before any download`, async () => {
      const dispatch = mkDispatch(
        tmp,
        `c1-unlisted-${pm}`,
        ["- g-clean@1.0.0 vetted: tiny, no deps"],
        [],
      );
      const project = mkProject(tmp, `c1-unlisted-${pm}-p`);
      drain();
      const r = await guarded(registry, dispatch, project, pm, ["add", "g-flag@1.0.0"]);
      expectRefused(r, "g-flag");
      expect(tarballHits(registry.log)).toEqual([]);
      expect(packumentHits(registry.log)).toEqual([]);
      expect(installedVersion(project, "g-flag")).toBeNull();
    });
    test.skipIf(skip())(`${pm}: a listed library with no recorded yes is refused`, async () => {
      const dispatch = mkDispatch(
        tmp,
        `c1-noyes-${pm}`,
        ["- g-clean 1.0.0 vetted: tiny, no deps"],
        [],
      );
      const project = mkProject(tmp, `c1-noyes-${pm}-p`);
      drain();
      const r = await guarded(registry, dispatch, project, pm, ["add", "g-clean@1.0.0"]);
      expectRefused(r, "g-clean");
      expect(tarballHits(registry.log)).toEqual([]);
      expect(installedVersion(project, "g-clean")).toBeNull();
    });
    test.skipIf(skip())(
      `${pm}: with the yes recorded, the listed library installs with what it brings`,
      async () => {
        const dispatch = mkDispatch(
          tmp,
          `c1-yes-${pm}`,
          ["- g-dep@1.0.0 vetted: brings g-trans"],
          [yes("g-dep@1.0.0")],
        );
        const project = mkProject(tmp, `c1-yes-${pm}-p`);
        drain();
        const r = await guarded(registry, dispatch, project, pm, ["add", "g-dep@1.0.0"]);
        expect(r.code).toBe(0);
        expect(installedVersion(project, "g-dep")).toBe("1.0.0");
        expect(installedVersion(project, "g-trans")).toBe("1.0.0");
        expect(tarballHits(registry.log).length).toBeGreaterThan(0);
      },
    );
  }
  test.skipIf(!avail.npm)("npm: a bare spec resolves to the listed latest", async () => {
    const dispatch = mkDispatch(
      tmp,
      "c1-bare",
      ["- g-clean@1.0.0 vetted: tiny"],
      [yes("g-clean@1.0.0")],
    );
    const project = mkProject(tmp, "c1-bare-p");
    const r = await guarded(registry, dispatch, project, "npm", ["add", "g-clean"]);
    expect(r.code).toBe(0);
    expect(installedVersion(project, "g-clean")).toBe("1.0.0");
  });
  test.skipIf(!avail.npm)("npm: a scoped library installs once listed and approved", async () => {
    const dispatch = mkDispatch(
      tmp,
      "c1-scoped",
      ["- @gscope/g-scoped@2.0.0 vetted: scoped shape"],
      [yes("@gscope/g-scoped@2.0.0")],
    );
    const project = mkProject(tmp, "c1-scoped-p");
    const r = await guarded(registry, dispatch, project, "npm", ["add", "@gscope/g-scoped@2.0.0"]);
    expect(r.code).toBe(0);
    expect(installedVersion(project, "@gscope/g-scoped")).toBe("2.0.0");
  });
});

const waiver = (target: string) => ({
  actor: "postmaster",
  action: "age-waiver",
  target,
  detail: "user waived the wait",
});
const allowance = (target: string) => ({
  actor: "postmaster",
  action: "script-allow",
  target,
  detail: "user allowed the scripts",
});

describe("C2: the seven-day wait and its waiver", () => {
  for (const pm of PMS) {
    const skip = () => !avail[pm];
    test.skipIf(skip())(
      `${pm}: a version under seven days old is refused without a waiver`,
      async () => {
        const dispatch = mkDispatch(
          tmp,
          `c2-young-${pm}`,
          ["- g-clean@1.1.0 vetted: young revision"],
          [yes("g-clean@1.1.0")],
        );
        const project = mkProject(tmp, `c2-young-${pm}-p`);
        drain();
        const r = await guarded(registry, dispatch, project, pm, ["add", "g-clean@1.1.0"]);
        expectRefused(r, "g-clean");
        expect(`${r.out}\n${r.err}`).toMatch(/seven days|week/iu);
        expect(tarballHits(registry.log)).toEqual([]);
        expect(installedVersion(project, "g-clean")).toBeNull();
      },
    );
    test.skipIf(skip())(`${pm}: with the waiver recorded, the young version installs`, async () => {
      const dispatch = mkDispatch(
        tmp,
        `c2-waiver-${pm}`,
        ["- g-clean@1.1.0 vetted: young revision"],
        [yes("g-clean@1.1.0"), waiver("g-clean@1.1.0")],
      );
      const project = mkProject(tmp, `c2-waiver-${pm}-p`);
      const r = await guarded(registry, dispatch, project, pm, ["add", "g-clean@1.1.0"]);
      expect(r.code).toBe(0);
      expect(installedVersion(project, "g-clean")).toBe("1.1.0");
    });
    test.skipIf(skip())(
      `${pm}: a young package brought along is refused until waived`,
      async () => {
        const refused = mkDispatch(
          tmp,
          `c2-trans-${pm}`,
          ["- g-youngdep@1.0.0 vetted: brings a young child"],
          [yes("g-youngdep@1.0.0")],
        );
        const project = mkProject(tmp, `c2-trans-${pm}-p`);
        const r = await guarded(registry, refused, project, pm, ["add", "g-youngdep@1.0.0"]);
        expectRefused(r, "g-youngchild");
        expect(installedVersion(project, "g-youngdep")).toBeNull();
        const allowed = mkDispatch(
          tmp,
          `c2-trans-w-${pm}`,
          ["- g-youngdep@1.0.0 vetted: brings a young child"],
          [yes("g-youngdep@1.0.0"), waiver("g-youngchild@2.0.0")],
        );
        const project2 = mkProject(tmp, `c2-trans-w-${pm}-p`);
        const r2 = await guarded(registry, allowed, project2, pm, ["add", "g-youngdep@1.0.0"]);
        expect(r2.code).toBe(0);
        expect(installedVersion(project2, "g-youngchild")).toBe("2.0.0");
      },
    );
    test.skipIf(skip())(`${pm}: a young optional package is refused until waived`, async () => {
      const dispatch = mkDispatch(
        tmp,
        `c2-opt-${pm}`,
        ["- g-needsopt@1.0.0 vetted: young optional"],
        [yes("g-needsopt@1.0.0")],
      );
      const project = mkProject(tmp, `c2-opt-${pm}-p`);
      const r = await guarded(registry, dispatch, project, pm, ["add", "g-needsopt@1.0.0"]);
      expectRefused(r, "g-youngchild");
      expect(installedVersion(project, "g-needsopt")).toBeNull();
    });
    test.skipIf(skip())(
      `${pm}: a peer satisfied by the tree is allowed, a missing young peer refused`,
      async () => {
        const dispatch = mkDispatch(
          tmp,
          `c2-peer-${pm}`,
          ["- g-clean@1.0.0 vetted: tiny", "- g-peer@1.0.0 vetted: peers on g-clean"],
          [yes("g-clean@1.0.0"), yes("g-peer@1.0.0")],
        );
        const project = mkProject(tmp, `c2-peer-${pm}-p`);
        const first = await guarded(registry, dispatch, project, pm, ["add", "g-clean@1.0.0"]);
        expect(first.code).toBe(0);
        const second = await guarded(registry, dispatch, project, pm, ["add", "g-peer@1.0.0"]);
        expect(second.code).toBe(0);
        expect(installedVersion(project, "g-peer")).toBe("1.0.0");
        const missing = mkDispatch(
          tmp,
          `c2-peerfree-${pm}`,
          ["- g-peerfree@1.0.0 vetted: peers on a missing young package"],
          [yes("g-peerfree@1.0.0")],
        );
        const project2 = mkProject(tmp, `c2-peerfree-${pm}-p`);
        const r = await guarded(registry, missing, project2, pm, ["add", "g-peerfree@1.0.0"]);
        expectRefused(r, "g-missingpeer");
        expect(installedVersion(project2, "g-peerfree")).toBeNull();
      },
    );
    test.skipIf(skip())(`${pm}: the wait ends at seven days`, async () => {
      const oldEnough = mkDispatch(
        tmp,
        `c2-over-${pm}`,
        ["- g-clean@1.2.0 vetted: just over seven days"],
        [yes("g-clean@1.2.0")],
      );
      const p1 = mkProject(tmp, `c2-over-${pm}-p`);
      const r1 = await guarded(registry, oldEnough, p1, pm, ["add", "g-clean@1.2.0"]);
      expect(r1.code).toBe(0);
      const tooYoung = mkDispatch(
        tmp,
        `c2-under-${pm}`,
        ["- g-clean@1.3.0 vetted: just under seven days"],
        [yes("g-clean@1.3.0")],
      );
      const p2 = mkProject(tmp, `c2-under-${pm}-p`);
      const r2 = await guarded(registry, tooYoung, p2, pm, ["add", "g-clean@1.3.0"]);
      expectRefused(r2, "g-clean");
    });
  }
});

describe("C3: no install script runs without its allowance", () => {
  for (const pm of PMS) {
    const skip = () => !avail[pm];
    const markerDir = (tag: string): string => {
      const dir = join(tmp, `markers-${tag}-${pm}`);
      mkdirSync(dir, { recursive: true });
      return dir;
    };
    test.skipIf(skip())(`${pm}: a scriptful library installs without its marker`, async () => {
      const dispatch = mkDispatch(
        tmp,
        `c3-blocked-${pm}`,
        ["- g-scripts@1.0.0 vetted: postinstall writes a marker"],
        [yes("g-scripts@1.0.0")],
      );
      const project = mkProject(tmp, `c3-blocked-${pm}-p`);
      const markers = markerDir("blocked");
      const r = await guarded(registry, dispatch, project, pm, ["add", "g-scripts@1.0.0"], {
        markerDir: markers,
      });
      expectRefused(r, "g-scripts");
      expect(`${r.out}\n${r.err}`).toMatch(/install script/iu);
      expect(installedVersion(project, "g-scripts")).toBeNull();
      expect(existsSync(join(markers, "g-scripts"))).toBe(false);
    });
    test.skipIf(skip())(`${pm}: with the allowance recorded, the marker is written`, async () => {
      const dispatch = mkDispatch(
        tmp,
        `c3-allowed-${pm}`,
        ["- g-scripts@1.0.0 vetted: postinstall writes a marker"],
        [yes("g-scripts@1.0.0"), allowance("g-scripts")],
      );
      const project = mkProject(tmp, `c3-allowed-${pm}-p`);
      const markers = markerDir("allowed");
      const r = await guarded(registry, dispatch, project, pm, ["add", "g-scripts@1.0.0"], {
        markerDir: markers,
      });
      expect(r.code).toBe(0);
      expect(installedVersion(project, "g-scripts")).toBe("1.0.0");
      expect(existsSync(join(markers, "g-scripts"))).toBe(true);
    });
    test.skipIf(skip())(
      `${pm}: a scriptful package brought along needs its own allowance`,
      async () => {
        const dispatch = mkDispatch(
          tmp,
          `c3-trans-${pm}`,
          ["- g-depscripts@1.0.0 vetted: brings g-scripts"],
          [yes("g-depscripts@1.0.0")],
        );
        const project = mkProject(tmp, `c3-trans-${pm}-p`);
        const markers = markerDir("trans");
        const r = await guarded(registry, dispatch, project, pm, ["add", "g-depscripts@1.0.0"], {
          markerDir: markers,
        });
        expectRefused(r, "g-scripts");
        expect(existsSync(join(markers, "g-scripts"))).toBe(false);
        const allowed = mkDispatch(
          tmp,
          `c3-trans-a-${pm}`,
          ["- g-depscripts@1.0.0 vetted: brings g-scripts"],
          [yes("g-depscripts@1.0.0"), allowance("g-scripts")],
        );
        const project2 = mkProject(tmp, `c3-trans-a-${pm}-p`);
        const markers2 = markerDir("trans-a");
        const r2 = await guarded(registry, allowed, project2, pm, ["add", "g-depscripts@1.0.0"], {
          markerDir: markers2,
        });
        expect(r2.code).toBe(0);
        expect(existsSync(join(markers2, "g-scripts"))).toBe(true);
      },
    );
  }
});

describe("C4: Socket checks every installed package", () => {
  for (const pm of PMS) {
    const skip = () => !avail[pm];
    test.skipIf(skip())(`${pm}: a package Socket flags is not installed`, async () => {
      registry.verdicts.set("g-flag@1.0.0", [{ type: "malware", action: "error" }]);
      try {
        const dispatch = mkDispatch(
          tmp,
          `c4-flag-${pm}`,
          ["- g-flag@1.0.0 vetted: clean at vetting time"],
          [yes("g-flag@1.0.0")],
        );
        const project = mkProject(tmp, `c4-flag-${pm}-p`);
        drain();
        const r = await guarded(registry, dispatch, project, pm, ["add", "g-flag@1.0.0"]);
        expectRefused(r, "g-flag");
        expect(`${r.out}\n${r.err}`).toMatch(/Socket/iu);
        expect(tarballHits(registry.log)).toEqual([]);
        expect(installedVersion(project, "g-flag")).toBeNull();
      } finally {
        registry.verdicts.set("g-flag@1.0.0", []);
      }
    });
    test.skipIf(skip())(`${pm}: an install that cannot reach the scanner fails`, async () => {
      const dispatch = mkDispatch(
        tmp,
        `c4-down-${pm}`,
        ["- g-clean@1.0.0 vetted: tiny"],
        [yes("g-clean@1.0.0")],
      );
      const project = mkProject(tmp, `c4-down-${pm}-p`);
      const r = await guarded(registry, dispatch, project, pm, ["add", "g-clean@1.0.0"], {
        env: { POSTMASTER_GUARD_SOCKET_API: "http://127.0.0.1:9/socket" },
      });
      expectRefused(r, "g-clean");
      expect(`${r.out}\n${r.err}`).toMatch(/Socket|scanner/iu);
      expect(installedVersion(project, "g-clean")).toBeNull();
    });
    test.skipIf(skip())(`${pm}: a package the scanner cannot check is not installed`, async () => {
      const dispatch = mkDispatch(
        tmp,
        `c4-unknown-${pm}`,
        ["- g-ghost@9.9.9 vetted: not yet indexed"],
        [yes("g-ghost@9.9.9")],
      );
      const project = mkProject(tmp, `c4-unknown-${pm}-p`);
      const r = await guarded(registry, dispatch, project, pm, ["add", "g-ghost@9.9.9"]);
      expectRefused(r, "g-ghost");
      expect(installedVersion(project, "g-ghost")).toBeNull();
    });
  }
});

describe("bare syncs install the locked tree and nothing else", () => {
  for (const pm of PMS) {
    const skip = () => !avail[pm];
    test.skipIf(skip())(`${pm}: a consistent sync installs`, async () => {
      const dispatch = mkDispatch(tmp, `sync-ok-${pm}`, [], []);
      const project = fromSnapshot(pm, "plain", `sync-ok-${pm}-p`);
      const r = await guarded(registry, dispatch, project, pm, ["install"]);
      expect(r.code).toBe(0);
      expect(installedVersion(project, "g-clean")).toBe("1.0.0");
    });
    test.skipIf(skip())(`${pm}: a sync past a hand-edited package.json fails`, async () => {
      const dispatch = mkDispatch(tmp, `drift-${pm}`, [], []);
      const project = fromSnapshot(pm, "plain", `drift-${pm}-p`);
      const manifest = join(project, "package.json");
      const pkg = JSON.parse(readFileSync(manifest, "utf8")) as Record<string, unknown>;
      pkg.dependencies = { ...(pkg.dependencies as Record<string, string>), "g-trans": "^1.0.0" };
      writeFileSync(manifest, JSON.stringify(pkg));
      const r = await guarded(registry, dispatch, project, pm, ["install"]);
      expect(r.code).not.toBe(0);
      expect(installedVersion(project, "g-trans")).toBeNull();
      expect(`${r.out}\n${r.err}`).toMatch(
        pm === "npm" ? /g-trans/u : /frozen|immutable|lockfile|sync/iu,
      );
    });
    test.skipIf(skip())(`${pm}: a first sync with an unlisted dependency is refused`, async () => {
      const dispatch = mkDispatch(tmp, `sync-first-${pm}`, [], []);
      const project = mkProject(tmp, `sync-first-${pm}-p`);
      const manifest = join(project, "package.json");
      const pkg = JSON.parse(readFileSync(manifest, "utf8")) as Record<string, unknown>;
      pkg.dependencies = { "g-clean": "1.0.0" };
      writeFileSync(manifest, JSON.stringify(pkg));
      const r = await guarded(registry, dispatch, project, pm, ["install"]);
      expectRefused(r, "g-clean");
      expect(installedVersion(project, "g-clean")).toBeNull();
    });
    test.skipIf(skip())(
      `${pm}: a sync never runs install scripts without an allowance`,
      async () => {
        const dispatch = mkDispatch(tmp, `sync-scripts-${pm}`, [], []);
        const project = fromSnapshot(pm, "scripts", `sync-scripts-${pm}-p`);
        const markers = join(tmp, `markers-sync-${pm}`);
        mkdirSync(markers, { recursive: true });
        const r = await guarded(registry, dispatch, project, pm, ["install"], {
          markerDir: markers,
        });
        expect(r.code).toBe(0);
        expect(existsSync(join(markers, "g-scripts"))).toBe(false);
      },
    );
    test.skipIf(skip())(`${pm}: a sync builds what the user allowed`, async () => {
      const dispatch = mkDispatch(tmp, `sync-allowed-${pm}`, [], [allowance("g-scripts")]);
      const project = fromSnapshot(pm, "scripts", `sync-allowed-${pm}-p`);
      const markers = join(tmp, `markers-sync-a-${pm}`);
      mkdirSync(markers, { recursive: true });
      const r = await guarded(registry, dispatch, project, pm, ["install"], { markerDir: markers });
      expect(r.code).toBe(0);
      expect(existsSync(join(markers, "g-scripts"))).toBe(true);
    });
  }
});

describe("one-shot runs, globals and the trust commands", () => {
  test.skipIf(!avail.npm)("npx runs an installed binary without downloading", async () => {
    const dispatch = mkDispatch(
      tmp,
      "oneshot-npx",
      ["- g-binpkg@1.0.0 vetted: local binary"],
      [yes("g-binpkg@1.0.0")],
    );
    const project = mkProject(tmp, "oneshot-npx-p");
    const added = await guarded(registry, dispatch, project, "npm", ["add", "g-binpkg@1.0.0"]);
    expect(added.code).toBe(0);
    drain();
    const r = await guarded(registry, dispatch, project, "npx", ["g-bin"]);
    expect(r.code).toBe(0);
    expect(`${r.out}\n${r.err}`).toContain("LOCAL 1.0.0");
    expect(tarballHits(registry.log)).toEqual([]);
  });
  test.skipIf(!avail.npm)("npx of a missing unlisted package is refused like an add", async () => {
    const dispatch = mkDispatch(tmp, "oneshot-npx-miss", [], []);
    const project = mkProject(tmp, "oneshot-npx-miss-p");
    const r = await guarded(registry, dispatch, project, "npx", ["g-flag"]);
    expect(r.code).toBe(1);
    expectRefused(r, "g-flag");
  });
  test.skipIf(!avail.bun)("bunx --no-install runs an installed binary", async () => {
    const dispatch = mkDispatch(
      tmp,
      "oneshot-bunx",
      ["- g-binpkg@1.0.0 vetted: local binary"],
      [yes("g-binpkg@1.0.0")],
    );
    const project = mkProject(tmp, "oneshot-bunx-p");
    const added = await guarded(registry, dispatch, project, "bun", ["add", "g-binpkg@1.0.0"]);
    expect(added.code).toBe(0);
    const r = await guarded(registry, dispatch, project, "bun", ["x", "--no-install", "g-bin"]);
    expect(r.code).toBe(0);
    expect(`${r.out}\n${r.err}`).toContain("LOCAL 1.0.0");
  });
  test.skipIf(!avail.bun)("bunx of an unlisted package is refused", async () => {
    const dispatch = mkDispatch(tmp, "oneshot-bunx-miss", [], []);
    const project = mkProject(tmp, "oneshot-bunx-miss-p");
    const r = await guarded(registry, dispatch, project, "bun", ["x", "g-flag"]);
    expect(r.code).toBe(1);
    expectRefused(r, "g-flag");
  });
  test.skipIf(!avail.pnpm)("pnpm dlx of an unlisted package is refused", async () => {
    const dispatch = mkDispatch(tmp, "oneshot-dlx", [], []);
    const project = mkProject(tmp, "oneshot-dlx-p");
    const r = await guarded(registry, dispatch, project, "pnpm", ["dlx", "g-flag@1.0.0"]);
    expect(r.code).toBe(1);
    expectRefused(r, "g-flag");
  });
  for (const pm of PMS) {
    const skip = () => !avail[pm];
    const args: Record<Pm, string[]> = {
      npm: ["install", "-g", "g-clean@1.0.0"],
      pnpm: ["add", "--global", "g-clean@1.0.0"],
      yarn: ["global", "add", "g-clean@1.0.0"],
      bun: ["add", "-g", "g-clean@1.0.0"],
    };
    test.skipIf(skip())(`${pm}: a global install is refused`, async () => {
      const dispatch = mkDispatch(
        tmp,
        `gworld-${pm}`,
        ["- g-clean@1.0.0 vetted: tiny"],
        [yes("g-clean@1.0.0")],
      );
      const project = mkProject(tmp, `gworld-${pm}-p`);
      drain();
      const r = await guarded(registry, dispatch, project, pm, args[pm]);
      expect(r.code).not.toBe(0);
      expect(`${r.out}\n${r.err}`).toMatch(/global/iu);
      expect(tarballHits(registry.log)).toEqual([]);
    });
  }
  test.skipIf(!avail.npm)("npm install-scripts approve is refused", async () => {
    const dispatch = mkDispatch(tmp, "trust-npm", [], []);
    const project = mkProject(tmp, "trust-npm-p");
    const r = await guarded(registry, dispatch, project, "npm", [
      "install-scripts",
      "approve",
      "g-scripts",
    ]);
    expect(r.code).toBe(1);
    expectRefused(r, "g-scripts");
  });
  test.skipIf(!avail.pnpm)("pnpm approve-builds is refused", async () => {
    const dispatch = mkDispatch(tmp, "trust-pnpm", [], []);
    const project = mkProject(tmp, "trust-pnpm-p");
    const r = await guarded(registry, dispatch, project, "pnpm", ["approve-builds", "g-scripts"]);
    expect(r.code).toBe(1);
    expectRefused(r, "g-scripts");
  });
  test.skipIf(!avail.bun)("bun pm trust is refused", async () => {
    const dispatch = mkDispatch(tmp, "trust-bun", [], []);
    const project = mkProject(tmp, "trust-bun-p");
    const r = await guarded(registry, dispatch, project, "bun", ["pm", "trust", "g-scripts"]);
    expect(r.code).toBe(1);
    expectRefused(r, "g-scripts");
  });
});

describe("Berry decisions against a stub yarn", () => {
  const stubYarn = (dir: string): string => {
    const bin = join(dir, "stubbin");
    mkdirSync(bin, { recursive: true });
    const record = join(dir, "yarn-record.json");
    writeFileSync(
      join(bin, "yarn"),
      `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "\${STUB_YARN_VERSION:-1.22.22}"; exit 0; fi\nprintf '{"scripts":"%s","registry":"%s","args":"%s"}\\n' "$YARN_ENABLE_SCRIPTS" "$YARN_NPM_REGISTRY_SERVER" "$*" > ${record}\n`,
    );
    run("chmod", ["+x", join(bin, "yarn")]);
    return bin;
  };
  test("a Berry project installs with scripts off and the forced registry", async () => {
    const dir = join(tmp, "berry-stub");
    mkdirSync(dir, { recursive: true });
    const bin = stubYarn(dir);
    const dispatch = mkDispatch(
      tmp,
      "berry-add",
      ["- g-clean@1.0.0 vetted: tiny"],
      [yes("g-clean@1.0.0")],
    );
    const project = mkProject(tmp, "berry-add-p");
    writeFileSync(join(project, ".yarnrc.yml"), "nodeLinker: node-modules\n");
    const r = await guarded(registry, dispatch, project, "yarn", ["add", "g-clean@1.0.0"], {
      env: {
        PATH: `${join(dispatch, "guard", "bin")}:${bin}:${DEV_BIN}:${process.env.PATH ?? ""}`,
      },
    });
    expect(r.code).toBe(0);
    const record = JSON.parse(readFileSync(join(dir, "yarn-record.json"), "utf8")) as Record<
      string,
      string
    >;
    expect(record.scripts).toBe("0");
    expect(record.registry).toBe(registry.url);
    expect(record.args).toContain("g-clean@1.0.0");
  });
  test("a Berry sync is immutable", async () => {
    const dir = join(tmp, "berry-stub-sync");
    mkdirSync(dir, { recursive: true });
    const bin = stubYarn(dir);
    const dispatch = mkDispatch(tmp, "berry-sync", [], []);
    const project = mkProject(tmp, "berry-sync-p");
    writeFileSync(join(project, ".yarnrc.yml"), "nodeLinker: node-modules\n");
    writeFileSync(join(project, "yarn.lock"), "# stub lockfile\n");
    const r = await guarded(registry, dispatch, project, "yarn", ["install"], {
      env: {
        PATH: `${join(dispatch, "guard", "bin")}:${bin}:${DEV_BIN}:${process.env.PATH ?? ""}`,
      },
    });
    expect(r.code).toBe(0);
    const record = JSON.parse(readFileSync(join(dir, "yarn-record.json"), "utf8")) as Record<
      string,
      string
    >;
    expect(record.scripts).toBe("0");
    expect(record.args).toContain("--immutable");
  });
  test("a Classic project gets --ignore-scripts instead of Berry env", async () => {
    const dir = join(tmp, "berry-stub-classic");
    mkdirSync(dir, { recursive: true });
    const bin = stubYarn(dir);
    const dispatch = mkDispatch(
      tmp,
      "berry-classic",
      ["- g-clean@1.0.0 vetted: tiny"],
      [yes("g-clean@1.0.0")],
    );
    const project = mkProject(tmp, "berry-classic-p");
    const r = await guarded(registry, dispatch, project, "yarn", ["add", "g-clean@1.0.0"], {
      env: {
        PATH: `${join(dispatch, "guard", "bin")}:${bin}:${DEV_BIN}:${process.env.PATH ?? ""}`,
      },
    });
    expect(r.code).toBe(0);
    const record = JSON.parse(readFileSync(join(dir, "yarn-record.json"), "utf8")) as Record<
      string,
      string
    >;
    expect(record.args).toContain("--ignore-scripts");
  });
  test("a Berry add with a covered script rebuilds exactly it", async () => {
    const dir = join(tmp, "berry-stub-rebuild");
    mkdirSync(dir, { recursive: true });
    const bin = join(dir, "stubbin");
    mkdirSync(bin, { recursive: true });
    const record = join(dir, "yarn-record.jsonl");
    writeFileSync(
      join(bin, "yarn"),
      `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "\${STUB_YARN_VERSION:-1.22.22}"; exit 0; fi\nprintf '{"scripts":"%s","registry":"%s","args":"%s"}\\n' "$YARN_ENABLE_SCRIPTS" "$YARN_NPM_REGISTRY_SERVER" "$*" >> ${record}\n`,
    );
    run("chmod", ["+x", join(bin, "yarn")]);
    const dispatch = mkDispatch(
      tmp,
      "berry-rebuild",
      ["- g-scripts@1.0.0 vetted: tiny"],
      [yes("g-scripts@1.0.0"), allowance("g-scripts")],
    );
    const project = mkProject(tmp, "berry-rebuild-p");
    writeFileSync(join(project, ".yarnrc.yml"), "nodeLinker: node-modules\n");
    const r = await guarded(registry, dispatch, project, "yarn", ["add", "g-scripts@1.0.0"], {
      env: {
        PATH: `${join(dispatch, "guard", "bin")}:${bin}:${DEV_BIN}:${process.env.PATH ?? ""}`,
      },
    });
    expect(r.code).toBe(0);
    const calls = readFileSync(record, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, string>);
    expect(calls.length).toBe(2);
    expect(calls[0]?.scripts).toBe("0");
    expect(calls[0]?.args).toContain("g-scripts@1.0.0");
    expect(calls[1]?.scripts).toBe("1");
    expect(calls[1]?.args ?? "").toMatch(/^rebuild g-scripts /u);
    expect(calls[1]?.registry).toBe(registry.url);
  });
  test("an unlisted Berry add never reaches yarn", async () => {
    const dir = join(tmp, "berry-stub-refuse");
    mkdirSync(dir, { recursive: true });
    const bin = stubYarn(dir);
    const dispatch = mkDispatch(tmp, "berry-refuse", [], []);
    const project = mkProject(tmp, "berry-refuse-p");
    writeFileSync(join(project, ".yarnrc.yml"), "nodeLinker: node-modules\n");
    const r = await guarded(registry, dispatch, project, "yarn", ["add", "g-flag@1.0.0"], {
      env: {
        PATH: `${join(dispatch, "guard", "bin")}:${bin}:${DEV_BIN}:${process.env.PATH ?? ""}`,
      },
    });
    expectRefused(r, "g-flag");
    expect(existsSync(join(dir, "yarn-record.json"))).toBe(false);
  });
});

describe("the coachman's guarded exec", () => {
  test("exec arms the dispatch bin and refuses what the run never approved", async () => {
    const dispatch = mkDispatch(tmp, "exec", [], []);
    const project = mkProject(tmp, "exec-p");
    const runExec = (args: string[]) =>
      run(RUN, ["install-guard", "exec", dispatch, ...args], {
        cwd: project,
        env: {
          POSTMASTER_TOOL: ROOT,
          POSTMASTER_GUARD_REGISTRY: registry.url,
          POSTMASTER_GUARD_SOCKET_API: registry.url,
          PATH: `${DEV_BIN}:${process.env.PATH ?? ""}`,
        },
      });
    const version = runExec(["npm", "--version"]);
    expect(version.code).toBe(0);
    expect(version.out).toMatch(/[0-9]+\.[0-9]+\.[0-9]+/u);
    expect(existsSync(join(dispatch, "guard", "bin", "npm"))).toBe(true);
    const before = packumentHits(registry.log).filter((p) => p.includes("g-clean")).length;
    const add = runExec(["npm", "add", "g-clean@1.0.0"]);
    expect(add.code).toBe(1);
    expect(`${add.out}\n${add.err}`).toMatch(/refusing to install g-clean@1\.0\.0/u);
    expect(packumentHits(registry.log).filter((p) => p.includes("g-clean")).length).toBe(before);
  });
});

describe("non-install commands pass through", () => {
  for (const pm of PMS) {
    test.skipIf(!avail[pm])(`${pm}: --version answers untouched`, async () => {
      const dispatch = mkDispatch(tmp, `pass-${pm}`, [], []);
      const project = mkProject(tmp, `pass-${pm}-p`);
      const r = await guarded(registry, dispatch, project, pm, ["--version"]);
      expect(r.code).toBe(0);
      expect(`${r.out}\n${r.err}`.length).toBeGreaterThan(0);
    });
  }
});

describe("the shim never recurses", () => {
  /** Descendant pids of root (plus root itself) from the shared process table. */
  function treeOf(root: number): number[] {
    const children = new Map<number, number[]>();
    for (const [pid, info] of processTable()) {
      const list = children.get(info.parent) ?? [];
      list.push(pid);
      children.set(info.parent, list);
    }
    const out = [root];
    const queue = [root];
    while (queue.length > 0) {
      const pid = queue.pop() as number;
      for (const kid of children.get(pid) ?? []) {
        out.push(kid);
        queue.push(kid);
      }
    }
    return out;
  }

  function killTree(root: number): void {
    // Leaf-first, so a parent cannot fork replacements while we kill.
    for (const pid of treeOf(root).reverse()) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
  }

  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(() => resolve(), ms));

  test.skipIf(!avail.bun)(
    "bun through the shim answers with a small group",
    async () => {
      const dispatch = mkDispatch(tmp, "shim-bun", [], []);
      const project = mkProject(tmp, "shim-bun-p");
      const bin = join(dispatch, "guard", "bin");
      mkdirSync(bin, { recursive: true });
      for (const name of ["npm", "pnpm", "yarn", "bun", "npx"]) {
        const link = join(bin, name);
        if (!existsSync(link)) symlinkSync(SHIM, link);
      }
      const env = {
        ...(process.env as Record<string, string>),
        PATH: `${bin}:${DEV_BIN}:${process.env.PATH ?? ""}`,
        POSTMASTER_DISPATCH: dispatch,
        POSTMASTER_TOOL: ROOT,
        POSTMASTER_GUARD_LANE: "testlane",
        POSTMASTER_GUARD_REGISTRY: registry.url,
        POSTMASTER_GUARD_SOCKET_API: registry.socketUrl,
      };
      // A recursing shim forks without end, so this run carries two bounds:
      // `timeout 60`, and a group-size trip that kills the tree and fails the
      // test within seconds instead of filling the machine.
      const TRIP = 60;
      const started = Date.now();
      const child = Bun.spawn(["timeout", "60", join(bin, "bun"), "--version"], {
        cwd: project,
        env,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      let peak = 0;
      let code = -1;
      for (;;) {
        const tree = treeOf(child.pid);
        peak = Math.max(peak, tree.length);
        if (tree.length > TRIP) {
          killTree(child.pid);
          throw new Error(`the shimmed bun grew past ${TRIP} processes: the shim is recursing`);
        }
        const done = await Promise.race([
          child.exited.then((c) => ({ done: true, code: c })),
          sleep(25).then(() => ({ done: false, code: -1 })),
        ]);
        if (done.done) {
          code = done.code;
          break;
        }
      }
      const elapsed = Date.now() - started;
      const out = child.stdout === null ? "" : await new Response(child.stdout).text();
      const err = child.stderr === null ? "" : await new Response(child.stderr).text();
      killTree(child.pid); // No-op when healthy; reaps strays otherwise.
      expect(code).toBe(0);
      expect(`${out}\n${err}`).toMatch(/[0-9]+\.[0-9]+\.[0-9]+/u);
      expect(elapsed).toBeLessThan(30000);
      expect(peak).toBeGreaterThanOrEqual(2);
      expect(peak).toBeLessThanOrEqual(TRIP);
    },
    120000,
  );
});

describe("facts prints one package's ask facts", () => {
  test("name, version, publish date, source and verdict as key=value lines", async () => {
    const published = registry.packages.get("g-clean")?.versions[0]?.published ?? "";
    expect(published).not.toBe("");
    const r = await runAsync(RUN, ["install-guard", "facts", "g-clean@1.0.0"], {
      env: {
        ...(process.env as Record<string, string>),
        POSTMASTER_GUARD_REGISTRY: registry.url,
        POSTMASTER_GUARD_SOCKET_API: registry.socketUrl,
      },
    });
    expect(r.code).toBe(0);
    expect(r.out).toContain("name=g-clean");
    expect(r.out).toContain("version=1.0.0");
    expect(r.out).toContain(`published=${published}`);
    expect(r.out).toContain("source=");
    expect(r.out).toContain("verdict=clean");
  });
  test("a flagged package reports its verdict", async () => {
    registry.verdicts.set("g-flag@1.0.0", [{ type: "malware", action: "error" }]);
    try {
      const r = await runAsync(RUN, ["install-guard", "facts", "g-flag@1.0.0"], {
        env: {
          ...(process.env as Record<string, string>),
          POSTMASTER_GUARD_REGISTRY: registry.url,
          POSTMASTER_GUARD_SOCKET_API: registry.socketUrl,
        },
      });
      expect(r.code).toBe(0);
      expect(r.out).toContain("verdict=flagged");
    } finally {
      registry.verdicts.set("g-flag@1.0.0", []);
    }
  });
});

describe("the approval records", () => {
  const shapes: Array<{ action: string; good: string; badTarget: string }> = [
    { action: "library-yes", good: "g-clean@1.0.0", badTarget: "g-clean" },
    { action: "age-waiver", good: "g-clean@1.1.0", badTarget: "g-clean" },
    { action: "script-allow", good: "g-scripts", badTarget: "g-scripts@1.0.0" },
    { action: "pm-word", good: "cargo", badTarget: "/tmp/nowhere" },
  ];
  for (const shape of shapes) {
    test(`${shape.action} records a well-shaped word`, async () => {
      const dispatch = mkDispatch(tmp, `verb-${shape.action}`, [], []);
      const r = run(RUN, [
        "log-action",
        dispatch,
        "postmaster",
        shape.action,
        shape.good,
        "the user said yes",
      ]);
      expect(r.code).toBe(0);
    });
    test(`${shape.action} refuses any actor but the postmaster`, async () => {
      const dispatch = mkDispatch(tmp, `verb-actor-${shape.action}`, [], []);
      const r = run(RUN, [
        "log-action",
        dispatch,
        "coachman",
        shape.action,
        shape.good,
        "the user said yes",
      ]);
      expect(r.code).toBe(1);
      expect(r.err).toMatch(/actor/u);
    });
    test(`${shape.action} refuses a misshapen target`, async () => {
      const dispatch = mkDispatch(tmp, `verb-target-${shape.action}`, [], []);
      const r = run(RUN, [
        "log-action",
        dispatch,
        "postmaster",
        shape.action,
        shape.badTarget,
        "the user said yes",
      ]);
      expect(r.code).toBe(1);
      expect(r.err).toMatch(/target/u);
    });
  }
});

describe("C5: projects the checks do not cover wait for the user's word", () => {
  const check = (project: string, dispatch?: string): Guarded => {
    const r = run(RUN, [
      "install-guard",
      "dispatch-check",
      project,
      ...(dispatch === undefined ? [] : ["--dispatch", dispatch]),
    ]);
    return { code: r.code, out: r.out, err: r.err };
  };
  const jsProject = (name: string, files: string[]): string => {
    const dir = join(tmp, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", private: true }));
    for (const file of files) writeFileSync(join(dir, file), "");
    return dir;
  };
  test("each covered manager reports covered", async () => {
    for (const [tag, files] of [
      ["npm", ["package-lock.json"]],
      ["pnpm", ["pnpm-lock.yaml"]],
      ["yarn", ["yarn.lock"]],
      ["bun", ["bun.lock"]],
    ] as Array<[string, string[]]>) {
      const r = check(jsProject(`c5-${tag}`, files));
      expect(r.code).toBe(0);
      expect(`${r.out}\n${r.err}`).toMatch(/covered/iu);
    }
  });
  test("a Cargo-only project is held until the word is recorded", async () => {
    const dir = join(tmp, "c5-cargo");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "Cargo.toml"), '[package]\nname = "x"\n');
    const held = check(dir);
    expect(held.code).toBe(2);
    expect(`${held.out}\n${held.err}`).toMatch(/unsupported/iu);
    expect(`${held.out}\n${held.err}`).toContain("cargo");
    const dispatch = mkDispatch(
      tmp,
      "c5-cargo-word",
      [],
      [{ actor: "postmaster", action: "pm-word", target: "cargo", detail: "user said go on" }],
    );
    const cleared = check(dir, dispatch);
    expect(cleared.code).toBe(0);
  });
  test("a word for one manager does not clear another", async () => {
    const dir = join(tmp, "c5-two");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "Cargo.toml"), '[package]\nname = "x"\n');
    writeFileSync(join(dir, "pyproject.toml"), '[project]\nname = "x"\n');
    const dispatch = mkDispatch(
      tmp,
      "c5-two-word",
      [],
      [{ actor: "postmaster", action: "pm-word", target: "cargo", detail: "user said go on" }],
    );
    const r = check(dir, dispatch);
    expect(r.code).toBe(2);
    expect(`${r.out}\n${r.err}`).toContain("python");
  });
  test("a mixed project is covered with its unguarded managers named", async () => {
    const dir = jsProject("c5-mixed", []);
    writeFileSync(join(dir, "Cargo.toml"), '[package]\nname = "x"\n');
    const r = check(dir);
    expect(r.code).toBe(0);
    expect(`${r.out}\n${r.err}`).toMatch(/covered/iu);
    expect(`${r.out}\n${r.err}`).toContain("cargo");
  });
  test("an empty project is covered", async () => {
    const dir = join(tmp, "c5-empty");
    mkdirSync(dir, { recursive: true });
    const r = check(dir);
    expect(r.code).toBe(0);
  });
});

describe("C6: the fixture mechanics", () => {
  test("fixture new still makes a repository on this branch", async () => {
    const dest = join(tmp, "c6-fixture");
    const r = run(RUN, ["fixture", "new", dest, "remove"], {
      env: process.env as Record<string, string>,
    });
    expect(r.code).toBe(0);
    expect(existsSync(join(dest, "package.json"))).toBe(true);
  }, 120000);
  test("the fixture app reports covered", async () => {
    const app = join(ROOT, "fixtures/app");
    const r = run(RUN, ["install-guard", "dispatch-check", app]);
    expect(r.code).toBe(0);
    expect(`${r.out}\n${r.err}`).toMatch(/covered/iu);
  });
  test.skipIf(true)("a run dispatched from this branch against it scores clean", () => {
    // Needs model lanes: the postmaster dispatches the fixture run at landing
    // and scores it with scripts/run fixture score on this branch.
  });
});
