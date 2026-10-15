// Tests beside scripts/ticket-capabilities.ts. Every finding has a positive control (a ticket that
// must produce it) and a negative control (the same ticket corrected, which must not), both
// through the identical command: the wrapper, run on a file.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  type Header,
  type IndexEntry,
  draftText,
  formatList,
  vocabulary,
  vocabularyKey,
} from "./lib/index-match.ts";
import { analyze } from "./ticket-capabilities.ts";

const SELF = join(import.meta.dir, "run");
const TICK = "`";
const FENCE = "```";

let tmp = "";
let seq = 0;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "ticket-capabilities-"));
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

interface Out {
  code: number;
  findings: string[];
  stdout: string;
  err: string;
}

function cli(text: string): Out {
  const file = join(tmp, `t${seq++}.md`);
  writeFileSync(file, text);
  const r = spawnSync(SELF, ["ticket-capabilities", file], { encoding: "utf8", timeout: 20000 });
  const stdout = String(r.stdout ?? "");
  return {
    code: r.status ?? 1,
    findings: stdout.split("\n").filter((l) => l.startsWith("line ")),
    stdout,
    err: String(r.stderr ?? ""),
  };
}

const ENTRY = [
  "- **Analytics SDK, consent storage** Offers: a setting that stores the visitor's choice in a",
  "  cookie shared across subdomains (https://example.test/docs/consent and",
  `  ${TICK}types.ts:1373${TICK}). Uses: that setting, for the stored choice. Custom: the banner`,
  "  and the wording, because the SDK has no interface of its own. (C1, D1)",
].join("\n");

function ticket(section: string): string {
  return [
    "## Problem / feature",
    "",
    "A thing is wrong.",
    "",
    "## Acceptance criteria",
    "",
    "1. A thing is right.",
    "",
    "## Decisions",
    "",
    "- **D1 (proposed)** A choice. Why: a reason. Instead of: another choice.",
    "",
    "## Direction",
    "",
    "None: any approach that meets the criteria.",
    "",
    "## Turnpikes",
    "",
    "default",
    "",
    "## For the agents",
    "",
    "### Checks",
    "",
    "- **C1** Do the thing. -> It works. **At the base:** it does not.",
    "",
    "### Technical notes",
    "",
    "- A note. (C1, D1)",
    "",
    section,
    "",
    "### Verified at 0123456789abcdef",
    "",
    "- A premise.",
    "",
  ].join("\n");
}

const FIT = ticket(`### Existing capabilities\n\n${ENTRY}`);

describe("a fit ticket", () => {
  test("exits 0 and prints the entry count", () => {
    const out = cli(FIT);
    expect(out.code).toBe(0);
    expect(out.findings).toEqual([]);
    expect(out.stdout).toContain("existing capabilities: 1 entries");
  });

  test("a None: line with a reason fits", () => {
    const out = cli(
      ticket(
        "### Existing capabilities\n\nNone: nothing outside the repository is involved in this change.",
      ),
    );
    expect(out.code).toBe(0);
    expect(out.stdout).toContain("existing capabilities: 0 entries");
  });

  test("the heading is read in any case", () => {
    expect(cli(ticket(`### EXISTING CAPABILITIES\n\n${ENTRY}`)).code).toBe(0);
  });

  test("two entries both count", () => {
    const out = cli(ticket(`### Existing capabilities\n\n${ENTRY}\n${ENTRY}`));
    expect(out.code).toBe(0);
    expect(out.stdout).toContain("2 entries");
  });
});

describe("the section", () => {
  test("a ticket with no section is a finding at the agents heading", () => {
    const out = cli(ticket("### Other notes\n\n- A note. (C1)"));
    expect(out.code).toBe(1);
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0]).toContain('no "### Existing capabilities" section');
    expect(out.findings[0]).toMatch(/^line 21: /u);
  });

  test("a section with neither an entry nor a None: line is a finding", () => {
    const out = cli(ticket("### Existing capabilities\n\nWe looked."));
    expect(out.code).toBe(1);
    expect(out.findings[0]).toContain("no entry and no None: line");
  });

  test("a None: line beside an entry is a finding", () => {
    const out = cli(
      ticket(`### Existing capabilities\n\nNone: nothing else is involved here.\n${ENTRY}`),
    );
    expect(out.code).toBe(1);
    expect(out.findings.some((f) => f.includes("keep one or the other"))).toBe(true);
  });

  test("a None: line with no reason is a finding", () => {
    const out = cli(ticket("### Existing capabilities\n\nNone:"));
    expect(out.code).toBe(1);
    expect(out.findings[0]).toContain("None: needs a reason");
  });

  test("an entry inside a fenced block is an example, not an entry", () => {
    const out = cli(ticket(`### Existing capabilities\n\n${FENCE}\n${ENTRY}\n${FENCE}`));
    expect(out.code).toBe(1);
    expect(out.findings[0]).toContain("no entry and no None: line");
  });

  test("a heading inside a fenced block does not end the section", () => {
    const out = cli(
      ticket(`### Existing capabilities\n\n${ENTRY}\n\n${FENCE}\n### Not a heading\n${FENCE}`),
    );
    expect(out.code).toBe(0);
  });
});

describe("an entry", () => {
  const broken = (find: string, replace: string): Out =>
    cli(ticket(`### Existing capabilities\n\n${ENTRY.replace(find, replace)}`));

  test("with no bold name is a finding; the named one is not", () => {
    const bad = broken("**Analytics SDK, consent storage**", "Analytics SDK, consent storage");
    expect(bad.findings.some((f) => f.includes("no name in bold"))).toBe(true);
    expect(cli(FIT).findings).toEqual([]);
  });

  for (const label of ["Offers:", "Uses:", "Custom:"]) {
    test(`lacking ${label} is a finding`, () => {
      const out = broken(label, "Note");
      expect(out.code).toBe(1);
      expect(out.findings.some((f) => f.includes(`lacks ${label}`))).toBe(true);
    });
  }

  test("with the labels out of order is a finding", () => {
    const swapped = ENTRY.replace("Uses:", "Custom:").replace(
      "Custom: the banner",
      "Uses: the banner",
    );
    const out = cli(ticket(`### Existing capabilities\n\n${swapped}`));
    expect(out.code).toBe(1);
  });

  test("an empty Uses: part is a finding", () => {
    const out = broken("Uses: that setting, for the stored choice.", "Uses: ");
    expect(out.findings.some((f) => f.includes("empty Uses: part"))).toBe(true);
  });

  test("an Offers: part of fewer than three words is a finding", () => {
    const entry = `- **Analytics SDK** Offers: cookies ${TICK}types.ts:1${TICK}. Uses: nothing. Custom: none. (C1)`;
    const out = cli(ticket(`### Existing capabilities\n\n${entry}`));
    expect(out.findings.some((f) => f.includes("empty Offers: part"))).toBe(true);
  });

  test("Uses: nothing and Custom: none are allowed words", () => {
    const entry = [
      "- **Analytics SDK, banner** Offers: no interface of its own, as the documentation",
      "  (https://example.test/docs/banner) says. Uses: nothing. Custom: none. (C1)",
    ].join("\n");
    expect(cli(ticket(`### Existing capabilities\n\n${entry}`)).code).toBe(0);
  });

  test("citing no source is a finding; a link or a file and line fixes it", () => {
    const noSource = [
      "- **Analytics SDK, consent storage** Offers: a setting that stores the visitor's choice in a",
      "  cookie shared across subdomains. Uses: that setting. Custom: the banner. (C1, D1)",
    ].join("\n");
    const bad = cli(ticket(`### Existing capabilities\n\n${noSource}`));
    expect(bad.findings.some((f) => f.includes("cites no source"))).toBe(true);
    const link = noSource.replace("subdomains.", "subdomains (https://example.test/docs).");
    expect(cli(ticket(`### Existing capabilities\n\n${link}`)).code).toBe(0);
    const file = noSource.replace("subdomains.", `subdomains (${TICK}src/config.ts:1373${TICK}).`);
    expect(cli(ticket(`### Existing capabilities\n\n${file}`)).code).toBe(0);
  });

  test("a source in the Uses: part does not count for Offers:", () => {
    const entry = [
      "- **Analytics SDK, consent storage** Offers: a setting that stores the visitor's choice in a",
      "  cookie shared across subdomains. Uses: that setting (https://example.test/docs). Custom: the",
      "  banner. (C1, D1)",
    ].join("\n");
    const out = cli(ticket(`### Existing capabilities\n\n${entry}`));
    expect(out.findings.some((f) => f.includes("cites no source"))).toBe(true);
  });

  test("with no tag group is a finding; a tag inside a code span does not count", () => {
    const bare = ENTRY.replace(" (C1, D1)", "");
    const out = cli(ticket(`### Existing capabilities\n\n${bare}`));
    expect(out.findings.some((f) => f.includes("no tag group"))).toBe(true);
    const inCode = ENTRY.replace("(C1, D1)", `${TICK}(C1, D1)${TICK}`);
    expect(
      cli(ticket(`### Existing capabilities\n\n${inCode}`)).findings.some((f) =>
        f.includes("no tag group"),
      ),
    ).toBe(true);
  });

  test("a label inside a code span is not a label", () => {
    const entry = ENTRY.replace(
      "Custom: the banner",
      `Custom: the banner (not ${TICK}Custom: x${TICK})`,
    );
    expect(cli(ticket(`### Existing capabilities\n\n${entry}`)).code).toBe(0);
  });
});

describe("the command", () => {
  test("a ticket with no agents heading is not usable", () => {
    const out = cli("## Problem / feature\n\nA thing.\n");
    expect(out.code).toBe(2);
    expect(out.err).toContain('no "## For the agents" section');
  });

  test("no argument and an unreadable file are not usable", () => {
    const none = spawnSync(SELF, ["ticket-capabilities"], { encoding: "utf8", timeout: 20000 });
    expect(none.status).toBe(2);
    expect(String(none.stderr)).toContain("usage: run ticket-capabilities <body-file>");
    const gone = spawnSync(SELF, ["ticket-capabilities", join(tmp, "absent.md")], {
      encoding: "utf8",
      timeout: 20000,
    });
    expect(gone.status).toBe(2);
    expect(String(gone.stderr)).toContain("cannot read");
  });

  test("a flag is refused", () => {
    const r = spawnSync(SELF, ["ticket-capabilities", "--final", "x.md"], {
      encoding: "utf8",
      timeout: 20000,
    });
    expect(r.status).toBe(2);
  });

  test("analyze reads CRLF endings as the readiness check does", () => {
    const report = analyze(FIT.replace(/\n/gu, "\r\n").replace(/\r\n/gu, "\n"));
    expect(report?.findings).toEqual([]);
    expect(report?.entries).toBe(1);
  });
});

// The menus that `run api-index` and `run code-index` make with --match <draft>.

function cliWith(text: string, menus: string[], extra: string[] = []): Out {
  const file = join(tmp, `t${seq++}.md`);
  writeFileSync(file, text);
  const args = ["ticket-capabilities", file];
  for (const menu of menus) {
    const path = join(tmp, `l${seq++}.tsv`);
    writeFileSync(path, menu);
    args.push("--candidates", path);
  }
  const r = spawnSync(SELF, [...args, ...extra], { encoding: "utf8", timeout: 20000 });
  const stdout = String(r.stdout ?? "");
  return {
    code: r.status ?? 1,
    findings: stdout.split("\n").filter((l) => l.startsWith("line ")),
    stdout,
    err: String(r.stderr ?? ""),
  };
}

const entryOf = (symbol: string): IndexEntry => ({
  symbol,
  kind: "property",
  signature: symbol,
  doc: "",
  file: "fake/index.d.ts",
  line: 1,
});

// A menu as the index commands save it, made from the draft `ticketText` as it stands, or with
// the key given (null for a menu made without a draft).
function menuFor(ticketText: string, key?: string | null, names = SYMBOLS): string {
  const k = key === undefined ? vocabularyKey(vocabulary(draftText(ticketText))) : key;
  const header: Header = {
    title: "api-index fake-sdk@1.0.0",
    total: names.length,
    ...(k === null ? {} : { vocabularyKey: k }),
  };
  return formatList(
    header,
    names.slice(0, 2).map((symbol) => ({ entry: entryOf(symbol) })),
    names.map(entryOf),
  );
}

const SYMBOLS = [
  "Config.cross_subdomain_cookie",
  "Config.consent_persistence_name",
  "Config.opt_out_capturing_persistence_type",
];

const SEARCHED_ENTRY = [
  "- **Analytics SDK, consent storage** Offers: a setting that stores the visitor's choice in a",
  "  cookie shared across subdomains (https://example.test/docs/consent and",
  `  ${TICK}types.ts:1373${TICK}). Uses: ${TICK}cross_subdomain_cookie${TICK}, for the stored choice.`,
  "  Custom: the banner and the wording.",
  `  Searched: ${TICK}consent_persistence_name${TICK}, ${TICK}opt_out_capturing_persistence_type${TICK}`,
  "  and the other persistence settings; none keeps the choice per subdomain. (C1, D1)",
].join("\n");

const section = (...parts: string[]): string =>
  ticket(`### Existing capabilities\n\n${parts.join("\n")}`);

describe("with menus", () => {
  const FIT_STRICT = section(SEARCHED_ENTRY);

  test("a menu made from this draft fits, and the count of menus is printed", () => {
    const out = cliWith(FIT_STRICT, [menuFor(FIT_STRICT)]);
    expect(out.findings).toEqual([]);
    expect(out.code).toBe(0);
    expect(out.stdout).toContain("existing capabilities: 1 entries, 1 menus made from this draft");
  });

  test("two menus are both counted", () => {
    const out = cliWith(FIT_STRICT, [menuFor(FIT_STRICT), menuFor(FIT_STRICT)]);
    expect(out.code).toBe(0);
    expect(out.stdout).toContain("2 menus made from this draft");
  });

  test("without a menu nothing changes: no Searched: part is asked for", () => {
    expect(cli(FIT).code).toBe(0);
    expect(cli(FIT).stdout).not.toContain("menus made from this draft");
  });

  test("the section need not mention anything the menu holds", () => {
    const names = Array.from({ length: 300 }, (_, i) => `Config.unused_setting_number_${i}`);
    const out = cliWith(FIT_STRICT, [menuFor(FIT_STRICT, undefined, names)]);
    expect(out.findings).toEqual([]);
    expect(out.code).toBe(0);
  });

  test("a menu made from an older draft is a finding; made from this draft it is not", () => {
    const menu = menuFor(FIT_STRICT);
    const changed = FIT_STRICT.replace("A thing is wrong.", "A cookie is wrong.");
    const stale = cliWith(changed, [menu]);
    expect(stale.code).toBe(1);
    expect(stale.findings).toHaveLength(1);
    expect(stale.findings[0]).toContain("was made from an older draft");
    expect(stale.findings[0]).toContain("api-index or code-index again");
    expect(cliWith(FIT_STRICT, [menu]).code).toBe(0);
  });

  test("a second menu that is old is a finding too", () => {
    const changed = FIT_STRICT.replace("A thing is wrong.", "A cookie is wrong.");
    const out = cliWith(changed, [menuFor(changed), menuFor(FIT_STRICT)]);
    expect(out.code).toBe(1);
    expect(out.findings).toHaveLength(1);
  });

  test("editing the capabilities section does not make a menu old", () => {
    const menu = menuFor(FIT_STRICT);
    const edited = section(
      SEARCHED_ENTRY.replace("the stored choice", "keeping the choice around"),
    );
    expect(cliWith(edited, [menu]).code).toBe(0);
  });

  test("taking the DRAFT: marker off at sign-off does not make a menu old", () => {
    const marked = `DRAFT: awaiting the user's review\n\n${FIT_STRICT}`;
    expect(cliWith(FIT_STRICT, [menuFor(marked)]).code).toBe(0);
  });

  test("a menu made without --match is a finding", () => {
    const out = cliWith(FIT_STRICT, [menuFor(FIT_STRICT, null)]);
    expect(out.code).toBe(1);
    expect(out.findings[0]).toContain("was made without --match");
  });
});

describe("the Searched: part", () => {
  const withCustom = (custom: string): string =>
    section(
      [
        "- **Analytics SDK, consent storage** Offers: a setting that stores the visitor's choice in a",
        "  cookie shared across subdomains (https://example.test/docs/consent).",
        `  Uses: ${TICK}cross_subdomain_cookie${TICK}, for the stored choice. ${custom} (C1, D1)`,
      ].join("\n"),
    );
  const run = (text: string): Out => cliWith(text, [menuFor(text)]);
  const missing = (out: Out): boolean => out.findings.some((f) => f.includes("no Searched: part"));

  test("a Custom: part with nothing searched is a finding", () => {
    expect(missing(run(withCustom("Custom: the banner and the wording.")))).toBe(true);
  });

  test("a Searched: part that names a setting fixes it", () => {
    const text = withCustom(
      `Custom: the banner. Searched: ${TICK}consent_persistence_name${TICK} and the other persistence settings.`,
    );
    expect(missing(run(text))).toBe(false);
  });

  test("a Searched: part that names nothing is a finding", () => {
    expect(missing(run(withCustom("Custom: the banner. Searched: the documentation.")))).toBe(true);
  });

  test("a name with an underscore or a hump counts without a code span", () => {
    expect(
      missing(run(withCustom("Custom: the banner. Searched: consent_persistence_name."))),
    ).toBe(false);
    expect(missing(run(withCustom("Custom: the banner. Searched: optOutCapturing.")))).toBe(false);
  });

  test("Custom: none needs no Searched: part", () => {
    expect(missing(run(withCustom("Custom: none.")))).toBe(false);
    expect(missing(run(withCustom("Custom: None, the setting does it.")))).toBe(false);
  });

  test("Custom: nonetheless is not none", () => {
    expect(missing(run(withCustom("Custom: nonetheless a banner.")))).toBe(true);
  });

  test("Searched: is not a Custom: part: Custom: with only Searched: is empty", () => {
    const out = run(withCustom(`Custom: Searched: ${TICK}consent_persistence_name${TICK}.`));
    expect(out.findings.some((f) => f.includes("empty Custom: part"))).toBe(true);
  });

  test("without a menu a Custom: part needs no Searched: part", () => {
    const text = withCustom("Custom: the banner and the wording.");
    expect(cli(text).findings.some((f) => f.includes("no Searched: part"))).toBe(false);
  });
});

describe("the candidates option", () => {
  test("--candidates with no value is a usage error", () => {
    const file = join(tmp, "usage.md");
    writeFileSync(file, FIT);
    const r = spawnSync(SELF, ["ticket-capabilities", file, "--candidates"], {
      encoding: "utf8",
      timeout: 20000,
    });
    expect(r.status).toBe(2);
    expect(String(r.stderr)).toContain("usage: run ticket-capabilities");
  });

  test("a menu that cannot be read is not usable", () => {
    const file = join(tmp, "unreadable.md");
    writeFileSync(file, FIT);
    const r = spawnSync(
      SELF,
      ["ticket-capabilities", file, "--candidates", join(tmp, "absent.tsv")],
      { encoding: "utf8", timeout: 20000 },
    );
    expect(r.status).toBe(2);
    expect(String(r.stderr)).toContain("cannot read");
  });

  test("two tickets at once are refused", () => {
    const r = spawnSync(SELF, ["ticket-capabilities", "a.md", "b.md"], {
      encoding: "utf8",
      timeout: 20000,
    });
    expect(r.status).toBe(2);
  });
});

describe("the menus the index commands make", () => {
  const repo = () => join(tmp, "flow-repo");

  function put(rel: string, text: string): string {
    const abs = join(repo(), rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
    return abs;
  }

  function library(): void {
    put(
      "node_modules/fake-sdk/package.json",
      JSON.stringify({ name: "fake-sdk", version: "3.0.0", types: "index.d.ts" }),
    );
    put(
      "node_modules/fake-sdk/index.d.ts",
      [
        "export interface SdkConfig {",
        "  /** Share the consent cookie across subdomains. */",
        "  cross_subdomain_cookie?: boolean;",
        "  /** Where the consent choice is persisted. */",
        "  consent_persistence_name?: string;",
        "  api_host?: string;",
        "}",
        "",
      ].join("\n"),
    );
  }

  // A draft whose agents' part is fit under the menus: its entry says what was searched.
  const draft = (eol: string): string =>
    FIT.replace(
      "A thing is wrong.",
      "The consent cookie must be shared across subdomains and persisted.",
    )
      .replace(ENTRY, SEARCHED_ENTRY)
      .replace(/\n/gu, eol);

  function menu(draftPath: string): string {
    const out = join(tmp, `flow-menu-${seq++}.tsv`);
    const r = spawnSync(
      SELF,
      ["api-index", repo(), "fake-sdk", "--match", draftPath, "--out", out],
      { encoding: "utf8", timeout: 30000 },
    );
    expect(r.status).toBe(0);
    return out;
  }

  function check(draftPath: string, menuPath: string): { status: number | null; stdout: string } {
    const r = spawnSync(SELF, ["ticket-capabilities", draftPath, "--candidates", menuPath], {
      encoding: "utf8",
      timeout: 20000,
    });
    return { status: r.status, stdout: String(r.stdout) };
  }

  for (const [name, eol] of [
    ["LF", "\n"],
    ["CRLF", "\r\n"],
  ] as const) {
    test(`a menu made by api-index from a ${name} draft is read as this draft's`, () => {
      library();
      const draftPath = join(tmp, `flow-draft-${seq++}.md`);
      writeFileSync(draftPath, draft(eol));
      const menuPath = menu(draftPath);
      const text = readFileSync(menuPath, "utf8");
      expect(text).toContain("SdkConfig.cross_subdomain_cookie");
      const got = check(draftPath, menuPath);
      expect(got.stdout).toContain("1 menus made from this draft");
      expect(got.status).toBe(0);
    });
  }

  test("the menu holds every name, also those the ranking left out", () => {
    library();
    const draftPath = join(tmp, `flow-draft-${seq++}.md`);
    writeFileSync(draftPath, draft("\n"));
    const out = join(tmp, `flow-menu-${seq++}.tsv`);
    const r = spawnSync(
      SELF,
      ["api-index", repo(), "fake-sdk", "--match", draftPath, "--max", "1", "--out", out],
      { encoding: "utf8", timeout: 30000 },
    );
    expect(r.status).toBe(0);
    const text = readFileSync(out, "utf8");
    const ranked = text.split("\n").filter((l) => l !== "" && !l.startsWith("#"));
    expect(ranked.length).toBeLessThanOrEqual(3);
    expect(text).toContain("api_host");
  });

  test("changing the draft after the menu was made is refused until the menu is made again", () => {
    library();
    const draftPath = join(tmp, `flow-draft-${seq++}.md`);
    writeFileSync(draftPath, draft("\n"));
    const menuPath = menu(draftPath);
    expect(check(draftPath, menuPath).status).toBe(0);
    writeFileSync(
      draftPath,
      draft("\n").replace("and persisted.", "and persisted, with a toggle."),
    );
    const stale = check(draftPath, menuPath);
    expect(stale.status).toBe(1);
    expect(stale.stdout).toContain("older draft");
    expect(check(draftPath, menu(draftPath)).status).toBe(0);
  });
});
