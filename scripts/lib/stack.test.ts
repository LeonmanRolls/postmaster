// Tests beside scripts/lib/stack.ts. The workspace here is invented.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { declaredDependencies, workspaceManifests } from "./stack.ts";

let tmp = "";

function put(root: string, rel: string, text: string): void {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text);
}

const json = (value: unknown): string => JSON.stringify(value, null, 2);

const WORKSPACE = [
  "packages:",
  "  - apps/*",
  "  - 'packages/*'",
  '  - "!packages/ignored"',
  "",
  "autoInstallPeers: false",
  "",
  "catalog:",
  "  # a note about viem",
  "  viem: ^2.0.0",
  '  "@scope/lib": 1.2.3',
  "  jose: ^6.0.0 # pinned for a reason",
  "  quoted: '^3.1.0'",
  "",
  "overrides:",
  "  lodash: 4.17.21",
  "",
].join("\n");

const LOCK = [
  "lockfileVersion: '9.0'",
  "",
  "importers:",
  "",
  "  .:",
  "    devDependencies:",
  "      typescript:",
  "        specifier: 'catalog:'",
  "        version: 5.9.2",
  "",
  "  apps/web:",
  "    dependencies:",
  "      '@pkg/shared':",
  "        specifier: workspace:*",
  "        version: link:../../packages/shared",
  "      lodash:",
  "        specifier: ^4.17.0",
  "        version: 4.17.21",
  "      react:",
  "        specifier: ^19.0.0",
  "        version: 19.1.0",
  "      viem:",
  "        specifier: 'catalog:'",
  "        version: 2.52.2(typescript@5.9.2)(zod@4.0.0)",
  "    devDependencies:",
  "      vitest:",
  "        specifier: ^4",
  "        version: 4.1.11(@types/node@22.0.0)",
  "",
  "  packages/shared:",
  "    dependencies:",
  "      lodash:",
  "        specifier: ^4.17.5",
  "        version: 4.17.21",
  "      '@scope/lib':",
  "        specifier: 'catalog:'",
  "        version: 1.2.3",
  "",
  "packages:",
  "",
  "  lodash@4.17.21:",
  "    resolution: {integrity: sha512-x}",
  "",
].join("\n");

let repo = "";

beforeAll(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), "stack-")));
  repo = join(tmp, "repo");
  put(repo, "pnpm-workspace.yaml", WORKSPACE);
  put(repo, "pnpm-lock.yaml", LOCK);
  put(
    repo,
    "package.json",
    json({ name: "root", devDependencies: { typescript: "catalog:", lefthook: "^1.0.0" } }),
  );
  put(
    repo,
    "apps/web/package.json",
    json({
      name: "web",
      dependencies: {
        viem: "catalog:",
        react: "^19.0.0",
        "@pkg/shared": "workspace:*",
        lodash: "^4.17.0",
        aliased: "npm:other@^1.0.0",
        fromgit: "github:owner/repo",
        quoted: "catalog:",
        missing: "catalog:",
      },
      peerDependencies: { "react-dom": "^19.0.0" },
      devDependencies: { "@types/react": "^19.0.0", vitest: "^4", "@types/scope__lib": "^1" },
    }),
  );
  put(
    repo,
    "packages/shared/package.json",
    json({
      name: "@pkg/shared",
      dependencies: { lodash: "^4.17.5", "@scope/lib": "catalog:" },
      optionalDependencies: { fsevents: "^2.3.0" },
    }),
  );
  put(
    repo,
    "packages/ignored/package.json",
    json({ name: "ignored", dependencies: { never: "1" } }),
  );
  put(repo, "packages/not-a-package/README.md", "no manifest here\n");
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("workspaceManifests", () => {
  test("lists the root first, then the workspace folders that have a manifest", () => {
    expect(workspaceManifests(repo)).toEqual([
      join(repo, "package.json"),
      join(repo, "apps/web/package.json"),
      join(repo, "packages/shared/package.json"),
    ]);
  });

  test("reads the workspaces of package.json when there is no pnpm file", () => {
    const other = join(tmp, "npm-repo");
    put(other, "package.json", json({ name: "r", workspaces: ["libs/*"] }));
    put(other, "libs/a/package.json", json({ name: "a" }));
    put(other, "libs/b/package.json", json({ name: "b" }));
    expect(workspaceManifests(other)).toEqual([
      join(other, "package.json"),
      join(other, "libs/a/package.json"),
      join(other, "libs/b/package.json"),
    ]);
    const object = join(tmp, "yarn-repo");
    put(object, "package.json", json({ name: "r", workspaces: { packages: ["pkgs/*"] } }));
    put(object, "pkgs/c/package.json", json({ name: "c" }));
    expect(workspaceManifests(object)).toEqual([
      join(object, "package.json"),
      join(object, "pkgs/c/package.json"),
    ]);
  });

  test("a project with only a root manifest has one, and one with none has none", () => {
    const single = join(tmp, "single");
    put(single, "package.json", json({ name: "s" }));
    expect(workspaceManifests(single)).toEqual([join(single, "package.json")]);
    expect(workspaceManifests(join(tmp, "nothing"))).toEqual([]);
  });
});

describe("declaredDependencies", () => {
  const names = (dev: boolean): string[] =>
    declaredDependencies(repo, dev).libraries.map((l) => l.name);

  test("lists dependencies, peer and optional dependencies, not the dev ones", () => {
    expect(names(false)).toEqual([
      "@scope/lib",
      "aliased",
      "fromgit",
      "fsevents",
      "lodash",
      "missing",
      "quoted",
      "react",
      "react-dom",
      "viem",
    ]);
  });

  test("with dev, the devDependencies of every manifest too, but never an @types package", () => {
    const got = names(true);
    expect(got).toContain("vitest");
    expect(got).toContain("typescript");
    expect(got).toContain("lefthook");
    expect(got.some((n) => n.startsWith("@types/"))).toBe(false);
  });

  test("the workspace's own packages are project code, not libraries", () => {
    const stack = declaredDependencies(repo, true);
    expect(stack.libraries.map((l) => l.name)).not.toContain("@pkg/shared");
    expect(stack.libraries.map((l) => l.name)).not.toContain("never");
    expect(stack.internal.has("@pkg/shared")).toBe(true);
    expect(stack.internal.has("web")).toBe(true);
  });

  test("a range comes from the manifest, or from the catalog for catalog:", () => {
    const by = (name: string) =>
      declaredDependencies(repo, false).libraries.find((l) => l.name === name);
    expect(by("react")?.spec).toBe("^19.0.0");
    expect(by("viem")?.spec).toBe("^2.0.0");
    expect(by("@scope/lib")?.spec).toBe("1.2.3");
    expect(by("quoted")?.spec).toBe("^3.1.0");
    // the first manifest to give a range wins
    expect(by("lodash")?.spec).toBe("^4.17.0");
  });

  test("a spec that is not a range gives none; a catalog name that is missing gives none", () => {
    const by = (name: string) =>
      declaredDependencies(repo, false).libraries.find((l) => l.name === name);
    expect(by("aliased")?.spec).toBeUndefined();
    expect(by("fromgit")?.spec).toBeUndefined();
    expect(by("missing")?.spec).toBeUndefined();
  });

  test("the version is the one the lockfile resolved, without its peer suffix", () => {
    const by = (name: string) =>
      declaredDependencies(repo, true).libraries.find((l) => l.name === name);
    expect(by("viem")?.version).toBe("2.52.2");
    expect(by("lodash")?.version).toBe("4.17.21");
    expect(by("react")?.version).toBe("19.1.0");
    expect(by("vitest")?.version).toBe("4.1.11");
    expect(by("fsevents")?.version).toBeUndefined();
  });

  test("says which lists declare a library", () => {
    const by = (name: string) =>
      declaredDependencies(repo, false).libraries.find((l) => l.name === name);
    expect(by("react-dom")?.kinds).toEqual(["peerDependencies"]);
    expect(by("fsevents")?.kinds).toEqual(["optionalDependencies"]);
    expect(by("react")?.kinds).toEqual(["dependencies"]);
  });

  test("names the @types package declared for a library, whether or not dev is asked for", () => {
    for (const dev of [false, true]) {
      const stack = declaredDependencies(repo, dev);
      expect(stack.typesFor.get("react")).toEqual({
        name: "@types/react",
        kinds: ["devDependencies"],
        spec: "^19.0.0",
      });
      expect(stack.typesFor.get("@scope/lib")?.name).toBe("@types/scope__lib");
    }
  });

  test("a project with no lockfile and no workspace file still lists its libraries", () => {
    const bare = join(tmp, "bare");
    put(bare, "package.json", json({ name: "b", dependencies: { left: "^1.2.3" } }));
    const stack = declaredDependencies(bare, false);
    expect(stack.libraries).toEqual([{ name: "left", kinds: ["dependencies"], spec: "^1.2.3" }]);
  });
});
