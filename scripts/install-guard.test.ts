// Tests beside scripts/install-guard.ts: the review-loop regression cases for
// the guard's pure decisions. End-to-end behavior stays in the oracle.
import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { toolRoot } from "./lib/paths.ts";
import { withTempDir } from "./lib/proc.ts";
import {
  applyPins,
  berryScopes,
  bunfigScopes,
  classify,
  createSpecKind,
  createTarget,
  derefNpm,
  fetchPackument,
  fetchVerdict,
  findLockfile,
  installArgs,
  lockResolved,
  npmDriftNames,
  npmrcScopes,
  parseAddSpecs,
  parseSpec,
  planPins,
  projectOf,
  refuseForeignResolved,
  refuseForeignScopes,
  registryEnvStrips,
  resolveClosure,
  sameOrigin,
  sanitize,
  scopeFlags,
  scopeOfName,
  scopePins,
  scopesOfWords,
  syncArgs,
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
    const docs: Record<string, string> = {
      foo: packument("foo", { "1.0.0": { dependencies: { bar: "^1.0.0" } } }),
      bar: packument("bar", { "1.0.0": {} }),
    };
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const name = new URL(req.url).pathname.slice(1);
        const doc = docs[name];
        return doc === undefined ? new Response("no", { status: 404 }) : new Response(doc);
      },
    });
    try {
      const ctx: GuardContext = {
        dispatch: tmp,
        lane: "test",
        cacheDir: join(tmp, "cache"),
        registry: `http://127.0.0.1:${server.port}`,
        socketApi: "http://127.0.0.1:1",
      };
      const closure = await resolveClosure(ctx, tmp, parseAddSpecs(["foo", "bar@1.0.0"]));
      expect(closure.get("bar@1.0.0")?.direct).toBe(true);
      expect(closure.get("foo@1.0.0")?.direct).toBe(true);
    } finally {
      server.stop();
    }
  });
});

test("a registry document is fetched fresh on every check", async () => {
  await withTempDir(async (tmp) => {
    let versions: Record<string, { dependencies?: Record<string, string> }> = { "1.0.0": {} };
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(packument("a", versions));
      },
    });
    try {
      const ctx: GuardContext = {
        dispatch: tmp,
        lane: "test",
        cacheDir: join(tmp, "cache"),
        registry: `http://127.0.0.1:${server.port}`,
        socketApi: "http://127.0.0.1:1",
      };
      const first = await fetchPackument(ctx, "a");
      expect(Object.keys(first.versions)).toEqual(["1.0.0"]);
      versions = { "1.0.0": {}, "1.0.1": {} };
      const second = await fetchPackument(ctx, "a");
      expect(Object.keys(second.versions).sort()).toEqual(["1.0.0", "1.0.1"]);
    } finally {
      server.stop();
    }
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
    writeFileSync(join(tmp, "package.json"), JSON.stringify({ name: "p" }));
    writeFileSync(join(tmp, "package-lock.json"), JSON.stringify({ packages: {} }));
    writeFileSync(join(tmp, "npm-shrinkwrap.json"), JSON.stringify({ packages: {} }));
    expect(findLockfile("npm", tmp)).toBe(join(tmp, "npm-shrinkwrap.json"));
    expect(findLockfile("pnpm", tmp)).toBeNull();
  });
});

test("the guard checks against the enclosing project, not the bare cwd", () => {
  withTempDir((tmp) => {
    const proj = join(tmp, "proj");
    const sub = join(proj, "packages", "sub");
    mkdirSync(sub, { recursive: true });
    writeFileSync(
      join(proj, "package.json"),
      JSON.stringify({ name: "p", dependencies: { a: "1.0.0" } }),
    );
    writeFileSync(
      join(proj, "package-lock.json"),
      JSON.stringify({ packages: { "": { dependencies: { a: "1.0.0" } } } }),
    );
    expect(projectOf("npm", [], sub)).toBe(proj);
    expect(findLockfile("npm", proj)).toBe(join(proj, "package-lock.json"));
    // A stray lockfile above the project never stands in for its own.
    writeFileSync(join(tmp, "package-lock.json"), JSON.stringify({ packages: {} }));
    expect(findLockfile("npm", proj)).toBe(join(proj, "package-lock.json"));
  });
});

test("drift compares sections, not unions of them", () => {
  withTempDir((tmp) => {
    // The same set of names in different sections is drift, not a match.
    writeFileSync(
      join(tmp, "package.json"),
      JSON.stringify({
        name: "p",
        dependencies: { a: "1.0.0" },
        devDependencies: { b: "1.0.0" },
      }),
    );
    const root: { dependencies: Record<string, string>; devDependencies: Record<string, string> } = {
      dependencies: { b: "1.0.0" },
      devDependencies: { a: "1.0.0" },
    };
    const lock = {
      packages: {
        "": root,
        "node_modules/a": { version: "1.0.0" },
        "node_modules/b": { version: "1.0.0" },
      },
    };
    writeFileSync(join(tmp, "package-lock.json"), JSON.stringify(lock));
    expect(npmDriftNames(tmp)).toEqual(["a", "b"]);
    // Matching sections read clean.
    root.dependencies = { a: "1.0.0" };
    root.devDependencies = { b: "1.0.0" };
    writeFileSync(join(tmp, "package-lock.json"), JSON.stringify(lock));
    expect(npmDriftNames(tmp)).toEqual([]);
    // A package absent from the lock still counts as drift.
    writeFileSync(
      join(tmp, "package.json"),
      JSON.stringify({ name: "p", dependencies: { a: "1.0.0", c: "1.0.0" } }),
    );
    expect(npmDriftNames(tmp)).toEqual(["c"]);
    // An unparseable file refuses to answer.
    writeFileSync(join(tmp, "package-lock.json"), "{oops");
    expect(npmDriftNames(tmp)).toBeNull();
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

test("each spec pins to the closure's direct version for its name", () => {
  const specs = parseAddSpecs(["foo@^1.0.0", "mybar@npm:bar@^2.0.0"]);
  const closure = new Map([
    ["foo@1.2.3", { name: "foo", version: "1.2.3", scripts: null, direct: true }],
    ["bar@2.0.0", { name: "bar", version: "2.0.0", scripts: null, direct: true }],
    ["dep@1.0.0", { name: "dep", version: "1.0.0", scripts: null, direct: false }],
  ]);
  const pins = planPins(specs, closure);
  expect(pins.map((p) => `${p.raw} -> ${p.version}`).sort()).toEqual([
    "foo@^1.0.0 -> 1.2.3",
    "mybar@npm:bar@^2.0.0 -> 2.0.0",
  ]);
  expect(applyPins(["add", "foo@^1.0.0", "mybar@npm:bar@^2.0.0"], "npm", pins)).toEqual([
    "add",
    "foo@1.2.3",
    "mybar@npm:bar@2.0.0",
  ]);
});

test("pins skip flag values, call strings and everything past --", () => {
  const specs = parseAddSpecs(["foo"]);
  const closure = new Map([
    ["foo@1.2.3", { name: "foo", version: "1.2.3", scripts: null, direct: true }],
  ]);
  const pins = planPins(specs, closure);
  expect(applyPins(["add", "foo", "--tag", "foo"], "npm", pins)).toEqual([
    "add",
    "foo@1.2.3",
    "--tag",
    "foo",
  ]);
  expect(applyPins(["-p", "foo", "-c", "foo"], "npm", pins)).toEqual([
    "-p",
    "foo@1.2.3",
    "-c",
    "foo",
  ]);
  expect(applyPins(["exec", "foo", "--", "foo"], "npm", pins)).toEqual([
    "exec",
    "foo@1.2.3",
    "--",
    "foo",
  ]);
});

test("ranged aliases parse as one spec", () => {
  expect(parseSpec("mybar@npm:bar@^2.0.0")).toEqual({
    kind: "alias",
    name: "mybar",
    target: "bar",
    range: "^2.0.0",
  });
  expect(parseSpec("mybar@npm:bar")).toEqual({
    kind: "alias",
    name: "mybar",
    target: "bar",
    range: "*",
  });
  expect(parseSpec("a@npm:@scope/b@1.0.0")).toEqual({
    kind: "alias",
    name: "a",
    target: "@scope/b",
    range: "1.0.0",
  });
  expect(parseSpec("a@npm:@scope/b")).toEqual({
    kind: "alias",
    name: "a",
    target: "@scope/b",
    range: "*",
  });
});

test("sanitize strips the new neuter flags and nothing past --", () => {
  expect(sanitize("bun", ["run", "-i", "test"]).stripped).toEqual(["-i"]);
  expect(sanitize("bun", ["run", "--install=force", "test"]).stripped).toEqual(["--install=force"]);
  expect(sanitize("bun", ["run", "test", "--", "-i"]).kept).toEqual(["run", "test", "--", "-i"]);
  expect(sanitize("pnpm", ["add", "--resolution-mode", "highest", "foo"]).stripped).toEqual([
    "--resolution-mode",
    "highest",
  ]);
  expect(sanitize("npm", ["run", "test", "--", "--ignore-scripts"]).kept).toEqual([
    "run",
    "test",
    "--",
    "--ignore-scripts",
  ]);
});

test("scope flags pin each scope to the guarded registry", () => {
  expect(scopeOfName("@s/p")).toBe("@s");
  expect(scopeOfName("p")).toBeNull();
  expect(scopeOfName("@lonely")).toBeNull();
  expect(scopePins(["a", "@s/p", "@s/q", "@t/r"], "https://r.example")).toEqual([
    "--@s:registry=https://r.example",
    "--@t:registry=https://r.example",
  ]);
  expect(scopeFlags(new Set(["@t", "@s"]), "https://r.example")).toEqual([
    "--@s:registry=https://r.example",
    "--@t:registry=https://r.example",
  ]);
  expect([
    ...scopesOfWords(["view", "@s/p", "@t/q@1.2.3", "npm:@u/r@^1", "plain", "@nope@1"]),
  ]).toEqual(["@s", "@t", "@u"]);
  expect([...scopesOfWords(["npm:plain@^1"])]).toEqual([]);
});

test("sanitize strips the agent's own scope registries", () => {
  expect(
    sanitize("npm", ["install", "--@s:registry=https://evil.example", "foo"]).stripped,
  ).toEqual(["--@s:registry=https://evil.example"]);
  expect(sanitize("pnpm", ["add", "--@s:registry", "https://evil.example", "foo"]).stripped).toEqual(
    ["--@s:registry", "https://evil.example"],
  );
  expect(sanitize("npm", ["view", "@s/p"]).kept).toEqual(["view", "@s/p"]);
});

test("the guard strips every registry the environment smuggles", () => {
  expect(
    registryEnvStrips({
      npm_config_registry: "x",
      NPM_CONFIG_REGISTRY: "x",
      "npm_config_@s:registry": "x",
      YARN_REGISTRY: "x",
      yarn_registry: "x",
      PATH: "x",
      npm_config_proxy: "x",
      YARN_ENABLE_SCRIPTS: "0",
    }),
  ).toEqual([
    "NPM_CONFIG_REGISTRY",
    "YARN_REGISTRY",
    "npm_config_@s:registry",
    "npm_config_registry",
    "yarn_registry",
  ]);
});

test("rc scope parsers read each manager's own file", () => {
  expect([
    ...npmrcScopes(
      'registry=https://r.example\n@s:registry=https://a.example\n@t:registry = "https://b.example" # c\n',
    ),
  ]).toEqual([
    ["@s", "https://a.example"],
    ["@t", "https://b.example"],
  ]);
  expect([
    ...npmrcScopes('"@u:registry" "https://c.example"\n@v:registry https://d.example\n'),
  ]).toEqual([
    ["@u", "https://c.example"],
    ["@v", "https://d.example"],
  ]);
  expect([
    ...berryScopes(
      'npmRegistryServer: "https://r.example"\nnpmScopes:\n  tscope:\n    npmRegistryServer: "https://a.example"\n  "@u":\n    npmRegistryServer: https://b.example # c\nnodeLinker: node-modules\n',
    ),
  ]).toEqual([
    ["@tscope", "https://a.example"],
    ["@u", "https://b.example"],
  ]);
  expect([
    ...bunfigScopes(
      '[install]\nregistry = "https://r.example"\n[install.scopes]\n"tscope" = { url = "https://a.example/" }\n@u = "https://b.example"\n[other]\nx = 1\n',
    ),
  ]).toEqual([
    ["@tscope", "https://a.example/"],
    ["@u", "https://b.example"],
  ]);
  expect(sameOrigin("https://r.example/a", "https://r.example:443/b")).toBe(true);
  expect(sameOrigin("https://r.example/", "http://r.example/")).toBe(false);
  expect(sameOrigin("::oops", "https://r.example/")).toBe(false);
});

test("foreign scopes and foreign tarballs refuse", () => {
  withTempDir((tmp) => {
    const home = process.env.HOME;
    process.env.HOME = join(tmp, "home");
    try {
      const proj = join(tmp, "proj");
      mkdirSync(join(proj, "sub"), { recursive: true });
      mkdirSync(join(tmp, "home"), { recursive: true });
      writeFileSync(join(proj, ".npmrc"), "@s:registry=https://evil.example\n");
      expect(() =>
        refuseForeignScopes("yarn", "classic", join(proj, "sub"), proj, "https://r.example"),
      ).toThrow(/points @s at https:\/\/evil\.example/);
      expect(() =>
        refuseForeignScopes("bun", "classic", join(proj, "sub"), proj, "https://r.example"),
      ).toThrow(/\.npmrc points @s/);
      // The same origin as the guard's passes.
      writeFileSync(join(proj, ".npmrc"), "@s:registry=https://r.example/other\n");
      refuseForeignScopes("yarn", "classic", join(proj, "sub"), proj, "https://r.example");
      // Berry reads only its own rc; Yarn Classic's does not touch Bun.
      writeFileSync(join(proj, ".yarnrc"), "@s:registry=https://evil.example\n");
      refuseForeignScopes("bun", "classic", join(proj, "sub"), proj, "https://r.example");
      expect(() =>
        refuseForeignScopes("yarn", "classic", join(proj, "sub"), proj, "https://r.example"),
      ).toThrow(/\.yarnrc points @s/);
      rmSync(join(proj, ".yarnrc"));
      writeFileSync(
        join(proj, ".yarnrc.yml"),
        'npmScopes:\n  s:\n    npmRegistryServer: "https://evil.example"\n',
      );
      expect(() =>
        refuseForeignScopes("yarn", "berry", proj, proj, "https://r.example"),
      ).toThrow(/points @s/);
      refuseForeignScopes("yarn", "classic", proj, proj, "https://r.example");
      // Lockfiles pinning foreign tarballs refuse on sync.
      const lock = join(proj, "package-lock.json");
      writeFileSync(
        lock,
        JSON.stringify({
          packages: {
            "node_modules/a": {
              version: "1.0.0",
              resolved: "https://evil.example/a.tgz",
            },
          },
        }),
      );
      expect(lockResolved(lock)).toEqual(["https://evil.example/a.tgz"]);
      expect(() => refuseForeignResolved(lock, "https://r.example")).toThrow(/outside the guarded/);
      const ylock = join(proj, "yarn.lock");
      writeFileSync(ylock, 'a@^1:\n  version "1.0.0"\n  resolved "https://r.example/a.tgz"\n');
      expect(lockResolved(ylock)).toEqual(["https://r.example/a.tgz"]);
      refuseForeignResolved(ylock, "https://r.example");
    } finally {
      if (home === undefined) delete process.env.HOME;
      else process.env.HOME = home;
    }
  });
});

test("install and sync plans pin the scopes they checked", () => {
  const reg = "https://r.example";
  const add = installArgs("npm", "classic", ["install", "@s/p"], [], reg, [], ["@s/p", "a"]);
  expect(add.args).toEqual([
    "install",
    "@s/p",
    "--registry",
    reg,
    "--@s:registry=https://r.example",
    "--no-audit",
    "--no-fund",
    "--ignore-scripts",
  ]);
  const sync = syncArgs("pnpm", "classic", [], reg, ["@s/p"]);
  expect(sync.args).toContain("--@s:registry=https://r.example");
  // Yarn and Bun pin no scopes: their scopes refuse instead.
  expect(installArgs("yarn", "classic", ["add", "@s/p"], [], reg, [], ["@s/p"]).args).not.toContain(
    "--@s:registry=https://r.example",
  );
  expect(syncArgs("yarn", "berry", [], reg, ["@s/p"]).args).toEqual([
    "install",
    "--immutable",
    "--non-interactive",
  ]);
});
