// Tests beside scripts/ticket-capabilities.ts. Every finding has a positive control (a ticket that
// must produce it) and a negative control (the same ticket corrected, which must not), both
// through the identical command: the wrapper, run on a file.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
