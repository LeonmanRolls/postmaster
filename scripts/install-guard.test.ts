// Tests beside scripts/install-guard.ts: the review-loop regression cases for
// the guard's pure decisions. End-to-end behavior stays in the oracle.
import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { toolRoot } from "./lib/paths.ts";
import { withTempDir } from "./lib/proc.ts";
import {
  classify,
  createSpecKind,
  createTarget,
  derefNpm,
  fetchVerdict,
  findLockfile,
  parseAddSpecs,
  resolveClosure,
  workspaceSelector,
  type GuardContext,
} from "./install-guard.ts";

function packument(
  name: string,
  versions: Record<string, { dependencies?: Record<string, string> }>,
): string {
  const out: Record<string, unknown> = {
    name,
    "dist-tags": { latest: Object.keys(versions).sort().at(-1) },
    versions: Object.fromEntries(
      Object.entries(versions).map(([v, e]) => [
        v,
        { version: v, dependencies: e.dependencies ?? {} },
      ]),
    ),
    time: Object.fromEntries(Object.keys(versions).map((v) => [v, "2020-01-01T00:00:00.000Z"])),
  };
  return JSON.stringify(out);
}

test("a transitive resolution never clears a direct spec's flag", async () => {
  await withTempDir(async (tmp) => {
    const cache = join(tmp, "cache", "packuments");
    mkdirSync(cache, { recursive: true });
    writeFileSync(
      join(cache, "foo.json"),
      packument("foo", { "1.0.0": { dependencies: { bar: "^1.0.0" } } }),
    );
    writeFileSync(join(cache, "bar.json"), packument("bar", { "1.0.0": {} }));
    const ctx: GuardContext = {
      dispatch: tmp,
      lane: "test",
      cacheDir: join(tmp, "cache"),
      registry: "http://127.0.0.1:1",
      socketApi: "http://127.0.0.1:1",
    };
    const closure = await resolveClosure(ctx, tmp, parseAddSpecs(["foo", "bar@1.0.0"]));
    expect(closure.get("bar@1.0.0")?.direct).toBe(true);
    expect(closure.get("foo@1.0.0")?.direct).toBe(true);
  });
});

test("an unknown scanner answer is never cached", async () => {
  await withTempDir(async (tmp) => {
    let mode = "garbage";
    const server = Bun.serve({
      port: 0,
      fetch() {
        if (mode === "garbage") return new Response("not json{{{\n");
        return new Response(
          `${JSON.stringify({ inputPurl: "pkg:npm/a@1.0.0", alerts: [] })}\n`,
          { headers: { "content-type": "application/x-ndjson" } },
        );
      },
    });
    try {
      const ctx: GuardContext = {
        dispatch: tmp,
        lane: "test",
        cacheDir: join(tmp, "cache"),
        registry: "http://127.0.0.1:1",
        socketApi: `http://127.0.0.1:${server.port}`,
      };
      const first = await fetchVerdict(ctx, "a", "1.0.0");
      expect(first.status).toBe("unknown");
      expect(existsSync(join(tmp, "cache", "verdicts", "a%401.0.0.json"))).toBe(false);
      mode = "clean";
      const second = await fetchVerdict(ctx, "a", "1.0.0");
      expect(second).toEqual({ status: "clean" });
    } finally {
      server.stop();
    }
  });
});

test("the npm sync reads the shrinkwrap npm prefers", () => {
  withTempDir((tmp) => {
    writeFileSync(join(tmp, "package-lock.json"), JSON.stringify({ packages: {} }));
    writeFileSync(join(tmp, "npm-shrinkwrap.json"), JSON.stringify({ packages: {} }));
    expect(findLockfile("npm", tmp)).toBe(join(tmp, "npm-shrinkwrap.json"));
    expect(findLockfile("pnpm", tmp)).toBeNull();
  });
});

test("npm names resolve exactly as npm resolves them", () => {
  const require = createRequire(import.meta.path);
  const cmdList = require(join(toolRoot(import.meta), "node_modules/npm/lib/utils/cmd-list.js")) as {
    commands: string[];
    aliases: Record<string, string>;
    deref: (word: string) => string | undefined;
  };
  const corpus = new Set<string>([
    ...cmdList.commands,
    ...Object.keys(cmdList.aliases),
    "installTest",
    "installCiTest",
    "i",
    "u",
    "c",
    "x",
    "t",
    "v",
    "r",
    "s",
    "is",
    "upg",
    "inst",
    "cle",
    "ver",
    "ls",
    "tea",
    "to",
    "star",
    "set",
    "frobnicate",
    "xyzzy",
    "",
  ]);
  for (const word of cmdList.commands) {
    for (let n = 1; n < word.length; n += 1) corpus.add(word.slice(0, n));
  }
  for (const word of corpus) {
    expect(derefNpm(word) ?? undefined).toBe(cmdList.deref(word));
  }
});

test("install aliases classify as their install form", () => {
  for (const word of ["install", "i", "add", "in", "isntall"]) {
    expect(classify("npm", [word, "foo"], "classic").kind).toBe("add");
  }
  for (const word of ["ci", "ic", "clean-install", "install-clean"]) {
    expect(classify("npm", [word], "classic").kind).toBe("sync");
  }
  for (const word of ["update", "u", "up", "udpate", "upgrade"]) {
    expect(classify("npm", [word, "foo"], "classic").kind).toBe("update");
  }
  for (const word of ["rebuild", "rb"]) {
    expect(classify("npm", [word, "foo"], "classic").kind).toBe("rebuild");
  }
  expect(classify("pnpm", ["i", "foo"], "classic").kind).toBe("add");
  expect(classify("pnpm", ["ci"], "classic").kind).toBe("sync");
  expect(classify("pnpm", ["rb", "foo"], "classic").kind).toBe("rebuild");
  expect(classify("bun", ["a", "foo"], "classic").kind).toBe("add");
  expect(classify("bun", ["i", "foo"], "classic").kind).toBe("add");
});

test("one-shot aliases and scaffolds route to their checks", () => {
  expect(classify("npm", ["x", "foo"], "classic").kind).toBe("oneshot");
  expect(classify("npm", ["exec", "foo"], "classic").kind).toBe("oneshot");
  const created = classify("npm", ["create", "vite"], "classic");
  expect(created.kind).toBe("create");
  if (created.kind === "create") expect(created.specs).toEqual(["create-vite"]);
  const inited = classify("npm", ["init", "@scope/pkg@2.0.0", "dir"], "classic");
  expect(inited.kind).toBe("create");
  if (inited.kind === "create") expect(inited.specs).toEqual(["@scope/create-pkg@2.0.0"]);
  expect(classify("npm", ["init"], "classic").kind).toBe("passthrough");
  expect(classify("pnpm", ["create", "vite"], "classic").kind).toBe("create");
});

test("ranged scaffolds and foreign shorthands refuse", () => {
  expect(classify("npm", ["init", "vite@^4"], "classic").kind).toBe("refuse");
  expect(classify("npm", ["init", "user/proj"], "classic").kind).toBe("refuse");
  expect(classify("npm", ["init", "vite@1.2.3"], "classic").kind).toBe("create");
});

test("link, dedupe and test combos refuse on every manager", () => {
  expect(classify("npm", ["link", "foo"], "classic").kind).toBe("refuse");
  expect(classify("npm", ["ln", "foo"], "classic").kind).toBe("refuse");
  expect(classify("npm", ["dedupe"], "classic").kind).toBe("refuse");
  expect(classify("npm", ["ddp"], "classic").kind).toBe("refuse");
  expect(classify("npm", ["it", "foo"], "classic").kind).toBe("refuse");
  expect(classify("npm", ["install-test"], "classic").kind).toBe("refuse");
  expect(classify("npm", ["cit"], "classic").kind).toBe("refuse");
  expect(classify("pnpm", ["dedupe"], "classic").kind).toBe("refuse");
  expect(classify("pnpm", ["it"], "classic").kind).toBe("refuse");
  expect(classify("bun", ["dedupe"], "classic").kind).toBe("refuse");
  expect(classify("yarn", ["dedupe"], "berry").kind).toBe("refuse");
  expect(classify("yarn", ["up", "foo"], "berry").kind).toBe("refuse");
});

test("workspace selectors refuse on install forms", () => {
  expect(classify("npm", ["install", "-w", "web", "foo"], "classic").kind).toBe("refuse");
  expect(classify("pnpm", ["-r", "add", "foo"], "classic").kind).toBe("refuse");
  expect(classify("pnpm", ["--filter", "web", "add", "foo"], "classic").kind).toBe("refuse");
  expect(classify("pnpm", ["recursive", "add", "foo"], "classic").kind).toBe("refuse");
  expect(classify("pnpm", ["recursive", "run", "build"], "classic").kind).toBe("passthrough");
  expect(classify("yarn", ["workspace", "web", "add", "foo"], "classic").kind).toBe("refuse");
  expect(classify("yarn", ["workspace", "web", "add", "foo"], "berry").kind).toBe("refuse");
  expect(classify("bun", ["--filter", "web", "add", "foo"], "classic").kind).toBe("refuse");
  expect(workspaceSelector("npm", ["install", "-w", "x"])).toBe("-w");
  expect(workspaceSelector("npm", ["install", "foo"])).toBeNull();
});

test("latest flags refuse on updates", () => {
  expect(classify("pnpm", ["up", "-L", "foo"], "classic").kind).toBe("refuse");
  expect(classify("pnpm", ["up", "--latest", "foo"], "classic").kind).toBe("refuse");
  expect(classify("bun", ["update", "--latest", "foo"], "classic").kind).toBe("refuse");
  expect(classify("yarn", ["upgrade", "--latest", "foo"], "classic").kind).toBe("refuse");
  expect(classify("pnpm", ["up", "foo"], "classic").kind).toBe("update");
});

test("global reaches refuse in every form", () => {
  expect(classify("npm", ["install", "-g", "foo"], "classic").kind).toBe("refuse");
  expect(classify("npm", ["install", "--location=global", "foo"], "classic").kind).toBe("refuse");
  expect(classify("npm", ["install", "--location", "global", "foo"], "classic").kind).toBe("refuse");
  expect(classify("pnpm", ["add", "--global-dir", "/tmp/g", "foo"], "classic").kind).toBe("refuse");
});

test("config writes, toolchain and audit fixes refuse", () => {
  expect(classify("npm", ["config", "set", "a", "b"], "classic").kind).toBe("refuse");
  expect(classify("npm", ["c", "set", "a", "b"], "classic").kind).toBe("refuse");
  expect(classify("npm", ["set", "a", "b"], "classic").kind).toBe("refuse");
  expect(classify("npm", ["config", "get", "a"], "classic").kind).toBe("passthrough");
  expect(classify("pnpm", ["config", "set", "a", "b"], "classic").kind).toBe("refuse");
  expect(classify("yarn", ["config", "set", "a", "b"], "berry").kind).toBe("refuse");
  expect(classify("yarn", ["plugin", "import", "x"], "berry").kind).toBe("refuse");
  expect(classify("yarn", ["plugin", "list"], "berry").kind).toBe("passthrough");
  expect(classify("yarn", ["set", "version", "stable"], "berry").kind).toBe("refuse");
  expect(classify("bun", ["upgrade"], "classic").kind).toBe("refuse");
  expect(classify("bun", ["pm", "ls"], "classic").kind).toBe("refuse");
  expect(classify("bun", ["audit", "fix"], "classic").kind).toBe("refuse");
  expect(classify("bun", ["audit"], "classic").kind).toBe("passthrough");
  expect(classify("npm", ["audit", "fix"], "classic").kind).toBe("refuse");
  expect(classify("npm", ["audit"], "classic").kind).toBe("passthrough");
  expect(classify("pnpm", ["fetch", "foo"], "classic").kind).toBe("refuse");
  expect(classify("pnpm", ["env", "use", "20"], "classic").kind).toBe("refuse");
  expect(classify("yarn", ["create", "x"], "classic").kind).toBe("refuse");
  expect(classify("bun", ["create", "x"], "classic").kind).toBe("refuse");
  expect(classify("bun", ["c", "x"], "classic").kind).toBe("refuse");
});

test("read-only commands and script runners pass", () => {
  expect(classify("npm", ["run", "build"], "classic").kind).toBe("passthrough");
  expect(classify("npm", ["test"], "classic").kind).toBe("passthrough");
  expect(classify("npm", ["view", "foo"], "classic").kind).toBe("passthrough");
  expect(classify("npm", ["ls"], "classic").kind).toBe("passthrough");
  expect(classify("npm", ["--version"], "classic").kind).toBe("passthrough");
  expect(classify("pnpm", ["run", "build"], "classic").kind).toBe("passthrough");
  expect(classify("pnpm", ["store", "path"], "classic").kind).toBe("passthrough");
  expect(classify("bun", ["run", "test.ts"], "classic").kind).toBe("passthrough");
  expect(classify("bun", ["server.ts"], "classic").kind).toBe("passthrough");
  expect(classify("yarn", ["run", "build"], "classic").kind).toBe("passthrough");
  expect(classify("yarn", ["workspaces", "info"], "classic").kind).toBe("passthrough");
});

test("yarn runs only the scripts the manifest names", () => {
  withTempDir((tmp) => {
    writeFileSync(
      join(tmp, "package.json"),
      JSON.stringify({ scripts: { build: "tsc", test: "bun test" } }),
    );
    expect(classify("yarn", ["build"], "classic", tmp).kind).toBe("passthrough");
    expect(classify("yarn", ["frobnicate"], "classic", tmp).kind).toBe("refuse");
    expect(classify("yarn", ["build"], "berry", tmp).kind).toBe("passthrough");
    expect(classify("yarn", ["frobnicate"], "berry", tmp).kind).toBe("refuse");
  });
  withTempDir((tmp) => {
    writeFileSync(join(tmp, "package.json"), "not json");
    expect(classify("yarn", ["build"], "classic", tmp).kind).toBe("refuse");
  });
});

test("unknown commands refuse on every manager", () => {
  expect(classify("npm", ["frobnicate"], "classic").kind).toBe("refuse");
  expect(classify("pnpm", ["frobnicate"], "classic").kind).toBe("refuse");
  expect(classify("bun", ["frobnicate"], "classic").kind).toBe("refuse");
  expect(classify("yarn", ["frobnicate"], "berry").kind).toBe("refuse");
  expect(classify("npm", ["star", "foo"], "classic").kind).toBe("refuse");
  expect(classify("npm", ["add-user"], "classic").kind).toBe("refuse");
});

test("scaffolder names map to their template package", () => {
  expect(createTarget("vite")).toBe("create-vite");
  expect(createTarget("vite@1.2.3")).toBe("create-vite@1.2.3");
  expect(createTarget("@scope/pkg")).toBe("@scope/create-pkg");
  expect(createTarget("@scope")).toBe("@scope/create");
  expect(createTarget("@scope@2")).toBe("@scope/create@2");
  expect(createTarget("user/proj")).toBeNull();
  expect(createTarget("")).toBeNull();
  expect(createSpecKind("1.2.3")).toBe("exact");
  expect(createSpecKind("*")).toBe("tag");
  expect(createSpecKind("latest")).toBe("tag");
  expect(createSpecKind("^1.0.0")).toBe("range");
});
