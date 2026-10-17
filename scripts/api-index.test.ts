// Tests beside scripts/api-index.ts. The library here is invented, with a sibling package of the
// same family (as posthog-js has @posthog/types); nothing contacts a registry.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  chooseVersion,
  dedupe,
  fileNameOf,
  libsFolderOf,
  locate,
  parseArgs,
  satisfies,
  siblingOf,
} from "./api-index.ts";
import type { IndexEntry } from "./lib/index-match.ts";

const SELF = join(import.meta.dir, "run");

let tmp = "";
let repo = "";

function put(root: string, rel: string, text = ""): string {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text);
  return abs;
}

beforeAll(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), "api-index-")));
  repo = join(tmp, "repo");
  put(
    repo,
    "node_modules/lib-cookie/package.json",
    JSON.stringify({
      name: "lib-cookie",
      version: "2.1.0",
      types: "index.d.ts",
      dependencies: { "@lib/types": "^2.0.0" },
    }),
  );
  put(
    repo,
    "node_modules/lib-cookie/index.d.ts",
    [
      'import type { ConsentSettings } from "@lib/types";',
      "export interface CookieConfig extends ConsentSettings {",
      "  /** Domain the cookie is shared with. */",
      "  cookie_domain?: string;",
      "  api_host?: string;",
      "}",
      "export declare function init(key: string, config?: CookieConfig): void;",
      "",
    ].join("\n"),
  );
  put(
    repo,
    "node_modules/@lib/types/package.json",
    JSON.stringify({ name: "@lib/types", version: "2.1.0", types: "index.d.ts" }),
  );
  put(
    repo,
    "node_modules/@lib/types/index.d.ts",
    [
      "export interface ConsentSettings {",
      "  /** Persist the visitor's consent choice in storage. */",
      "  consent_persistence_name?: string;",
      "  cross_subdomain_cookie?: boolean;",
      "}",
      "",
    ].join("\n"),
  );
  put(
    repo,
    "node_modules/lib-testy/package.json",
    JSON.stringify({ name: "lib-testy", version: "1.0.0", types: "index.d.ts" }),
  );
  put(
    repo,
    "node_modules/lib-testy/index.d.ts",
    'export * from "./testing/mock";\nexport declare function realThing(): void;\n',
  );
  put(
    repo,
    "node_modules/lib-testy/testing/mock.d.ts",
    "export declare function makeMockClient(): void;\n",
  );
  put(
    repo,
    "node_modules/lib-mocker/package.json",
    JSON.stringify({ name: "lib-mocker", version: "1.0.0", types: "testing/index.d.ts" }),
  );
  put(
    repo,
    "node_modules/lib-mocker/testing/index.d.ts",
    "export declare function mockIt(): void;\n",
  );
  put(tmp, "draft.md", "Share the consent cookie across subdomains and persist the choice.\n");
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

interface Out {
  code: number;
  stdout: string;
  err: string;
}

function cli(...args: string[]): Out {
  const r = spawnSync(SELF, ["api-index", ...args], { encoding: "utf8", timeout: 30000 });
  return { code: r.status ?? 1, stdout: String(r.stdout ?? ""), err: String(r.stderr ?? "") };
}

const rowsOf = (text: string): string[] =>
  text.split("\n").filter((l) => l !== "" && !l.startsWith("#"));

const parsed = (argv: string[]) => {
  const got = parseArgs(argv);
  if (typeof got === "string") throw new Error(got);
  return got;
};

describe("parseArgs", () => {
  test("reads the repo, the package and the options", () => {
    const got = parsed(["r", "lib", "--from", "apps/web", "--max", "10", "--out", "o.tsv"]);
    expect(got).toEqual({
      repo: resolve("r"),
      name: "lib",
      all: false,
      dev: false,
      dir: undefined,
      from: "apps/web",
      version: undefined,
      match: undefined,
      max: 10,
      out: "o.tsv",
    });
  });

  test("the limit defaults to sixty", () => {
    expect(parsed(["r", "lib"]).max).toBe(60);
  });

  test("refuses a missing value, an unknown option and a bad limit", () => {
    expect(parseArgs(["r", "lib", "--max"])).toBe("--max needs a value");
    expect(parseArgs(["r", "lib", "--match", "--out"])).toBe("--match needs a value");
    expect(parseArgs(["r", "lib", "--bogus"])).toBe("unknown option --bogus");
    expect(parseArgs(["r", "lib", "--max", "0"])).toBe("--max is a whole number of at least 1");
    expect(parseArgs(["r", "lib", "--max", "2.5"])).toBe("--max is a whole number of at least 1");
  });

  test("--all takes the repo alone, with a draft and a file to write", () => {
    const got = parsed([
      "r",
      "--all",
      "--dev",
      "--from",
      "apps/web",
      "--match",
      "d.md",
      "--out",
      "o.tsv",
    ]);
    expect(got.all).toBe(true);
    expect(got.dev).toBe(true);
    expect(got.name).toBe("");
    expect(got.repo).toBe(resolve("r"));
    expect(parsed(["r", "--all", "--match", "d.md", "--out", "o.tsv"]).dev).toBe(false);
  });

  test("--all refuses what does not fit it", () => {
    expect(parseArgs(["r", "--all", "--out", "o.tsv"])).toBe(
      "--all needs --match <draft> and --out <file>",
    );
    expect(parseArgs(["r", "--all", "--match", "d.md"])).toBe(
      "--all needs --match <draft> and --out <file>",
    );
    expect(String(parseArgs(["r", "lib", "--all", "--match", "d.md", "--out", "o"]))).toContain(
      "usage: run api-index",
    );
    expect(parseArgs(["r", "--all", "--dir", "x", "--match", "d.md", "--out", "o"])).toBe(
      "--all reads every library: --dir and --version name one",
    );
    expect(parseArgs(["r", "lib", "--dev"])).toBe("--dev goes with --all");
  });

  test("needs exactly a repo and a package", () => {
    expect(String(parseArgs(["r"]))).toContain("usage: run api-index");
    expect(String(parseArgs(["r", "a", "b"]))).toContain("usage: run api-index");
  });
});

describe("where the own menus go", () => {
  test("the folder sits beside the menu file and takes its name", () => {
    expect(libsFolderOf("out/menu.tsv")).toBe("out/menu.libs");
    expect(libsFolderOf("out/menu")).toBe("out/menu.libs");
    expect(libsFolderOf("out.v2/menu")).toBe("out.v2/menu.libs");
  });

  test("a library's file is named for it, a scope turned into a double underscore", () => {
    expect(fileNameOf("viem")).toBe("viem.tsv");
    expect(fileNameOf("@tanstack/react-query")).toBe("@tanstack__react-query.tsv");
  });
});

describe("dedupe", () => {
  const e = (symbol: string, doc: string, kind = "property"): IndexEntry => ({
    symbol,
    kind,
    signature: symbol,
    doc,
    file: "f.d.ts",
    line: 1,
  });

  test("keeps one entry for a symbol and kind, the one that has a doc", () => {
    expect(dedupe([e("A.x", ""), e("A.x", "Has a doc.")])).toEqual([e("A.x", "Has a doc.")]);
    expect(dedupe([e("A.x", "Has a doc."), e("A.x", "")])).toEqual([e("A.x", "Has a doc.")]);
  });

  test("a symbol of another kind is another entry", () => {
    expect(dedupe([e("A", "", "interface"), e("A", "", "const")])).toHaveLength(2);
  });
});

describe("siblingOf", () => {
  test("finds the package installed beside this one", () => {
    const store = join(tmp, "sib/node_modules/.pnpm/a@1.0.0/node_modules");
    put(store, "a/package.json", JSON.stringify({ name: "a", version: "1.0.0" }));
    put(store, "b/package.json", JSON.stringify({ name: "b", version: "1.0.0" }));
    put(store, "@scope/c/package.json", JSON.stringify({ name: "@scope/c", version: "1.0.0" }));
    expect(siblingOf(join(store, "a"), "b")).toBe(join(store, "b"));
    expect(siblingOf(join(store, "a"), "@scope/c")).toBe(join(store, "@scope/c"));
    expect(siblingOf(join(store, "a"), "absent")).toBeNull();
  });

  test("a package outside any node_modules has no sibling", () => {
    expect(siblingOf(join(tmp, "loose/a"), "b")).toBeNull();
  });
});

describe("satisfies", () => {
  test("an exact version", () => {
    expect(satisfies("1.2.3", "1.2.3")).toBe(true);
    expect(satisfies("1.2.4", "1.2.3")).toBe(false);
  });

  test("a caret range keeps the leftmost nonzero part", () => {
    expect(satisfies("1.43.1", "^1.43.1")).toBe(true);
    expect(satisfies("1.99.0", "^1.43.1")).toBe(true);
    expect(satisfies("1.9.1", "^1.43.1")).toBe(false);
    expect(satisfies("2.0.0", "^1.43.1")).toBe(false);
    expect(satisfies("0.2.9", "^0.2.3")).toBe(true);
    expect(satisfies("0.3.0", "^0.2.3")).toBe(false);
    expect(satisfies("0.0.3", "^0.0.3")).toBe(true);
    expect(satisfies("0.0.4", "^0.0.3")).toBe(false);
  });

  test("a tilde range keeps the minor", () => {
    expect(satisfies("1.2.9", "~1.2.3")).toBe(true);
    expect(satisfies("1.3.0", "~1.2.3")).toBe(false);
  });

  test("a lower bound", () => {
    expect(satisfies("3.0.0", ">=1.2.3")).toBe(true);
    expect(satisfies("1.2.2", ">=1.2.3")).toBe(false);
  });

  test("what it cannot read is not satisfied", () => {
    expect(satisfies("1.0.0-beta.1", "^1.0.0")).toBe(false);
    expect(satisfies("1.0.0", "latest")).toBe(false);
    expect(satisfies("1.0.0", "workspace:*")).toBe(false);
    expect(satisfies("1.0.0", "")).toBe(false);
  });
});

describe("chooseVersion", () => {
  test("the version asked for wins", () => {
    expect(chooseVersion(["1.0.0", "2.0.0"], "3.0.0", ["1.0.0"])).toBe("3.0.0");
  });

  test("the only version the lockfile pins is used", () => {
    expect(chooseVersion(["1.0.0"], undefined, [])).toBe("1.0.0");
  });

  test("among several, the version a dependent names comes first, then the dependent's own", () => {
    expect(chooseVersion(["1.0.0", "2.0.0"], undefined, ["1.0.0", "2.0.0"])).toBe("1.0.0");
    expect(chooseVersion(["1.0.0", "2.0.0"], undefined, ["latest", "2.0.0"])).toBe("2.0.0");
    expect(chooseVersion(["1.0.0", "2.0.0"], undefined, [undefined, "2.0.0"])).toBe("2.0.0");
  });

  test("a range the dependent names picks the highest locked version it allows", () => {
    expect(chooseVersion(["1.43.1", "1.9.1"], undefined, ["^1.43.1", "1.404.1"])).toBe("1.43.1");
    expect(chooseVersion(["1.1.0", "1.9.0", "2.0.0"], undefined, ["^1.0.0"])).toBe("1.9.0");
    expect(chooseVersion(["1.1.0", "2.0.0"], undefined, ["^3.0.0", "~2.0.0"])).toBe("2.0.0");
  });

  test("among several with no hint the lockfile holds, it cannot be told", () => {
    expect(chooseVersion(["1.0.0", "2.0.0"], undefined, ["3.0.0", undefined])).toBeUndefined();
    expect(chooseVersion(["1.0.0", "2.0.0"], undefined, [])).toBeUndefined();
  });

  test("a package the lockfile does not hold has no version to choose", () => {
    expect(chooseVersion([], undefined, ["1.0.0"])).toBeUndefined();
  });
});

describe("locate", () => {
  test("a folder given with --dir is used as given", () => {
    const got = locate({ repo, dir: join(repo, "node_modules/lib-cookie") }, "lib-cookie");
    expect(typeof got === "string" ? got : got.note).toBe("given folder");
  });

  test("a folder with no package.json is reported", () => {
    const got = locate({ repo, dir: join(tmp, "nodir") }, "lib-cookie");
    expect(got).toContain("holds no package.json");
  });

  test("an installed package is found from the repo", () => {
    const got = locate({ repo }, "lib-cookie");
    if (typeof got === "string") throw new Error(got);
    expect(got.note).toBe("installed");
    expect(got.pkg.version).toBe("2.1.0");
  });

  test("a package pinned at two versions needs --version", () => {
    const bare = join(tmp, "pinned");
    put(bare, "pnpm-lock.yaml", ["packages:", "  lib-p@1.0.0:", "  lib-p@2.0.0:"].join("\n"));
    expect(locate({ repo: bare }, "lib-p")).toBe("lib-p is pinned at 1.0.0, 2.0.0: pass --version");
  });
});

describe("the command", () => {
  test("indexes the package and the sibling of its family, one line per entry", () => {
    const out = cli(repo, "lib-cookie");
    expect(out.code).toBe(0);
    const symbols = rowsOf(out.stdout).map((l) => l.split("\t")[0]);
    expect(symbols.sort()).toEqual(
      [
        "ConsentSettings",
        "ConsentSettings.consent_persistence_name",
        "ConsentSettings.cross_subdomain_cookie",
        "CookieConfig",
        "CookieConfig.api_host",
        "CookieConfig.cookie_domain",
        "init",
      ].sort(),
    );
    expect(out.stdout).toContain("lib-cookie@2.1.0, @lib/types@2.1.0");
    expect(out.stdout).not.toContain("draft-vocabulary");
  });

  test("with --match, lists the entries nearest the draft and saves the draft's key", () => {
    const list = join(tmp, "out/list.tsv");
    const out = cli(repo, "lib-cookie", "--match", join(tmp, "draft.md"), "--out", list);
    expect(out.code).toBe(0);
    expect(out.stdout).toContain("api-index: lib-cookie@2.1.0, @lib/types@2.1.0: 7 entries");
    expect(out.stdout).toContain(`written to ${list}`);
    const text = readFileSync(list, "utf8");
    expect(text).toMatch(/^# draft-vocabulary [0-9a-f]{12}$/mu);
    const symbols = rowsOf(text).map((l) => l.split("\t")[0]);
    expect(symbols).toContain("ConsentSettings.consent_persistence_name");
    expect(symbols).toContain("ConsentSettings.cross_subdomain_cookie");
    expect(symbols).toContain("CookieConfig.cookie_domain");
    expect(text).toContain("# every name in the index");
    expect(text).toContain("#   CookieConfig{cookie_domain, api_host}, init()");
    expect(text).toContain("#   ConsentSettings{consent_persistence_name, cross_subdomain_cookie}");
    const row =
      rowsOf(text).find((l) => l.startsWith("ConsentSettings.cross_subdomain_cookie")) ?? "";
    expect(row.split("\t")[5]).toContain("subdomain");
  });

  test("a package's own test helpers are not listed", () => {
    const out = cli(repo, "lib-testy");
    expect(out.code).toBe(0);
    expect(rowsOf(out.stdout).map((l) => l.split("\t")[0])).toEqual(["realThing"]);
  });

  test("a package whose entry point is in a test folder is still listed", () => {
    const out = cli(repo, "lib-mocker");
    expect(out.code).toBe(0);
    expect(rowsOf(out.stdout).map((l) => l.split("\t")[0])).toEqual(["mockIt"]);
  });

  test("--max limits the ranked part", () => {
    const out = cli(repo, "lib-cookie", "--match", join(tmp, "draft.md"), "--max", "1");
    expect(out.code).toBe(0);
    expect(rowsOf(out.stdout).length).toBeLessThanOrEqual(1 + 80);
    expect(rowsOf(out.stdout).length).toBeGreaterThanOrEqual(1);
    // the map still holds every name, whatever the ranking kept
    for (const name of ["api_host", "cross_subdomain_cookie", "init()", "cookie_domain"]) {
      expect(out.stdout).toContain(name);
    }
  });

  test("a folder that holds no package is exit 1", () => {
    const out = cli(repo, "lib-cookie", "--dir", join(tmp, "nodir"));
    expect(out.code).toBe(1);
    expect(out.err).toContain("holds no package.json");
  });

  test("a package with no declaration files is exit 1", () => {
    put(tmp, "bare/package.json", JSON.stringify({ name: "bare", version: "1.0.0" }));
    const out = cli(repo, "bare", "--dir", join(tmp, "bare"));
    expect(out.code).toBe(1);
    expect(out.err).toContain("bare has no declaration files");
  });

  test("an unreadable draft is exit 2", () => {
    const out = cli(repo, "lib-cookie", "--match", join(tmp, "absent.md"));
    expect(out.code).toBe(2);
    expect(out.err).toContain("cannot read");
  });

  test("usage mistakes are exit 2", () => {
    expect(cli().code).toBe(2);
    expect(cli().err).toContain("usage: run api-index");
    const bad = cli(repo, "lib-cookie", "--max", "x");
    expect(bad.code).toBe(2);
    expect(bad.err).toContain("--max is a whole number");
  });
});

describe("--all", () => {
  let root = "";
  const menu = () => join(tmp, "all-out", "menu.tsv");
  const own = (file: string) => join(tmp, "all-out", "menu.libs", file);

  beforeAll(() => {
    root = join(tmp, "all-repo");
    put(
      root,
      "package.json",
      JSON.stringify({
        name: "root",
        dependencies: {
          "lib-cookie": "^2.0.0",
          "@lib/types": "^2.0.0",
          "lib-plain": "^1.0.0",
          "lib-untyped": "^1.0.0",
          "lib-typed-elsewhere": "^1.0.0",
        },
        devDependencies: { "lib-dev-tool": "^1.0.0", "@types/lib-typed-elsewhere": "^1.0.0" },
      }),
    );
    for (const [name, files] of Object.entries({
      "lib-cookie": {
        "package.json": JSON.stringify({
          name: "lib-cookie",
          version: "2.1.0",
          types: "index.d.ts",
          dependencies: { "@lib/types": "^2.0.0" },
        }),
        "index.d.ts": [
          'import type { ConsentSettings } from "@lib/types";',
          "export interface CookieConfig extends ConsentSettings {",
          "  /** Domain the cookie is shared with. */",
          "  cookie_domain?: string;",
          "}",
          "export declare function init(key: string, config?: CookieConfig): void;",
          "",
        ].join("\n"),
      },
      "@lib/types": {
        "package.json": JSON.stringify({
          name: "@lib/types",
          version: "2.1.0",
          types: "index.d.ts",
        }),
        "index.d.ts": [
          "export interface ConsentSettings {",
          "  /** Persist the visitor's consent choice in storage. */",
          "  consent_persistence_name?: string;",
          "  cross_subdomain_cookie?: boolean;",
          "}",
          "",
        ].join("\n"),
      },
      "lib-plain": {
        "package.json": JSON.stringify({
          name: "lib-plain",
          version: "1.0.0",
          description: "A plain library.",
          types: "index.d.ts",
        }),
        "index.d.ts": "export declare function plainThing(): void;\n",
      },
      "lib-untyped": {
        "package.json": JSON.stringify({ name: "lib-untyped", version: "1.0.0" }),
      },
      "lib-typed-elsewhere": {
        "package.json": JSON.stringify({ name: "lib-typed-elsewhere", version: "1.0.0" }),
      },
      "@types/lib-typed-elsewhere": {
        "package.json": JSON.stringify({
          name: "@types/lib-typed-elsewhere",
          version: "1.0.0",
          types: "index.d.ts",
        }),
        "index.d.ts": "export declare function typedElsewhere(): void;\n",
      },
      "lib-dev-tool": {
        "package.json": JSON.stringify({
          name: "lib-dev-tool",
          version: "1.0.0",
          types: "index.d.ts",
        }),
        "index.d.ts": "export declare function devTool(): void;\n",
      },
    })) {
      for (const [file, text] of Object.entries(files)) {
        put(root, `node_modules/${name}/${file}`, text);
      }
    }
  });

  const run = (...extra: string[]): Out =>
    cli(root, "--all", "--match", join(tmp, "draft.md"), "--out", menu(), ...extra);

  test("reads every library the project declares and writes a menu of the stack", () => {
    const out = run();
    expect(out.code).toBe(0);
    expect(out.stdout).toContain("5 libraries, 4 read");
    expect(out.stdout).toContain("1 without declarations: lib-untyped");
    const text = readFileSync(menu(), "utf8");
    const lines = text.split("\n");
    expect(text).toMatch(/^# draft-vocabulary [0-9a-f]{12}$/mu);
    const directory = lines.filter((l) => !l.startsWith("#") && l.split("\t").length === 7);
    expect(directory.map((l) => l.split("\t")[0]).sort()).toEqual([
      "@lib/types",
      "lib-cookie",
      "lib-plain",
      "lib-typed-elsewhere",
      "lib-untyped",
    ]);
  });

  test("the libraries that match the draft come first, each with its description and menu", () => {
    run();
    const rows = readFileSync(menu(), "utf8")
      .split("\n")
      .filter((l) => !l.startsWith("#") && l.split("\t").length === 7)
      .map((l) => l.split("\t"));
    expect(
      rows
        .slice(0, 2)
        .map((r) => r[0])
        .sort(),
    ).toEqual(["@lib/types", "lib-cookie"]);
    const plain = rows.find((r) => r[0] === "lib-plain") ?? [];
    expect(plain[1]).toBe("1.0.0");
    expect(plain[5]).toBe("menu.libs/lib-plain.tsv");
    expect(plain[6]).toBe("A plain library.");
    const types = rows.find((r) => r[0] === "@lib/types") ?? [];
    expect(types[5]).toBe("menu.libs/@lib__types.tsv");
    expect(types[4]).toContain("cross_subdomain_cookie");
  });

  test("a library with no declaration files says so and where to read it", () => {
    run();
    const text = readFileSync(menu(), "utf8");
    const row = text.split("\n").find((l) => l.startsWith("lib-untyped\t")) ?? "";
    expect(row.split("\t")[5]).toContain("no declaration files (");
    expect(row.split("\t")[5]).toContain("node_modules/lib-untyped");
  });

  test("a library typed by an @types package is read through it", () => {
    run();
    expect(readFileSync(own("lib-typed-elsewhere.tsv"), "utf8")).toContain("typedElsewhere()");
    expect(readFileSync(menu(), "utf8")).toContain("typedElsewhere()");
  });

  test("lists every function and method of every library in one part", () => {
    run();
    const text = readFileSync(menu(), "utf8");
    const part = text.slice(
      text.indexOf("# 2. EVERY FUNCTION AND METHOD"),
      text.indexOf("# 3. THE NAMES NEAREST"),
    );
    for (const name of ["plainThing()", "typedElsewhere()", "init()"]) {
      expect(part).toContain(name);
    }
    expect(part).not.toContain("devTool()");
  });

  test("each library has its own menu, and a family package read on its own is not repeated", () => {
    run();
    const cookie = readFileSync(own("lib-cookie.tsv"), "utf8");
    const types = readFileSync(own("@lib__types.tsv"), "utf8");
    expect(cookie).toContain("CookieConfig.cookie_domain");
    expect(cookie).not.toContain("ConsentSettings.cross_subdomain_cookie");
    expect(cookie).not.toMatch(/^ConsentSettings\t/mu);
    expect(types).toContain("ConsentSettings.cross_subdomain_cookie");
    expect(types).toMatch(/^# every name in the index/mu);
    expect(existsSync(own("lib-untyped.tsv"))).toBe(false);
    const keys = [menu(), own("lib-cookie.tsv"), own("@lib__types.tsv")].map(
      (f) => /^# draft-vocabulary ([0-9a-f]+)$/mu.exec(readFileSync(f, "utf8"))?.[1],
    );
    expect(new Set(keys).size).toBe(1);
  });

  test("--dev adds the devDependencies", () => {
    const out = run("--dev");
    expect(out.code).toBe(0);
    expect(out.stdout).toContain("6 libraries, 5 read");
    expect(readFileSync(menu(), "utf8")).toContain("devTool()");
  });

  test("an unreadable draft is exit 2", () => {
    const out = cli(root, "--all", "--match", join(tmp, "absent.md"), "--out", menu());
    expect(out.code).toBe(2);
    expect(out.err).toContain("cannot read");
  });

  test("a project that declares no libraries is exit 1", () => {
    const bare = join(tmp, "no-libs");
    put(bare, "package.json", JSON.stringify({ name: "bare" }));
    const out = cli(
      bare,
      "--all",
      "--match",
      join(tmp, "draft.md"),
      "--out",
      join(tmp, "x", "m.tsv"),
    );
    expect(out.code).toBe(1);
    expect(out.err).toContain("no libraries declared");
  });

  test("options that do not fit --all are exit 2", () => {
    expect(cli(root, "--all", "--out", menu()).code).toBe(2);
    expect(
      cli(root, "--all", "--match", join(tmp, "draft.md"), "--out", menu(), "--dir", "x").code,
    ).toBe(2);
  });
});
