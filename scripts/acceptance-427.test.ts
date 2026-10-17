// Oracle for #427, committed before the change: the clerk vets the
// libraries a ticket may use, and the instructions welcome a library from
// that list. C1 welcomes a library from the ticket's list in the standing
// instructions, for the tool or its checks, once the user has said yes to
// adding it. C2 says a library used at run time is copied into the
// repository at a fixed version. C3 gives the ticket a ## Libraries section
// with each library's version and the clerk's vetting. C4 tells the clerk
// to consider libraries for every ticket. C5 tells the clerk to vet each
// library before listing it. Covered: C1-C5.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { dirname } from "node:path";
import {
  prepareSection,
  readRepo,
  repoRoot,
  runTool,
  scriptsParagraph,
  templateExample,
  templateGuide,
  writeTempTicket,
} from "./acceptance-427.ts";

describe("C1: the instructions welcome a library from the ticket's list", () => {
  test("no sentence limits runtime imports to the standard modules", () => {
    const r = spawnSync("git", ["grep", "-n", "standard modules only", "--", "AGENTS.md"], {
      cwd: repoRoot(),
      encoding: "utf8",
    });
    expect(r.status).toBe(1);
    expect(String(r.stdout)).toBe("");
  });

  test("the scripts paragraph welcomes a listed library once the user says yes", () => {
    const p = scriptsParagraph();
    expect(p).toContain("ticket");
    expect(p).toContain("librar");
    expect(p).toContain("said yes");
  });

  test("the welcome covers the checks as well as the tool", () => {
    const p = scriptsParagraph();
    expect(p).toContain("run time");
    expect(p).toContain("checks");
  });

  test("the development dependencies are not a closed list", () => {
    expect(readRepo("AGENTS.md")).not.toContain("are the development dependencies");
  });

  test("the Bun declarations state no closed list", () => {
    expect(readRepo("types", "bun.d.ts")).not.toContain("Development dependencies are only");
  });

  // The passage moved from the README to the design principles page it links.
  test("the design principles passage names the clerk's vetting", () => {
    const text = readRepo("docs", "design-principles.md");
    const at = text.indexOf("## Adding a library takes the user's word");
    expect(at).toBeGreaterThanOrEqual(0);
    const end = text.indexOf("\n## ", at + 1);
    expect(text.slice(at, end < 0 ? undefined : end)).toContain("vet");
  });
});

describe("C2: a runtime library is copied into the repository", () => {
  test("the paragraph names the vendored way in with licence and checksum", () => {
    const p = scriptsParagraph();
    expect(p).toContain("copied into the repository");
    expect(p).toContain("licence");
    expect(p).toContain("checksum");
    expect(p).toContain("refresh");
    expect(p).toContain("scripts/lib/vendor");
  });
});

describe("C3: the ticket template carries a Libraries section", () => {
  test("the example shows the section with one line per library", () => {
    const example = templateExample();
    const at = example.indexOf("## Libraries");
    expect(at).toBeGreaterThanOrEqual(0);
    const end = example.indexOf("\n## ", at + 1);
    const section = example.slice(at, end < 0 ? undefined : end);
    const lines = section.split("\n").filter((l) => l.startsWith("- "));
    expect(lines.length).toBeGreaterThanOrEqual(1);
    for (const line of lines) {
      expect(line).toContain("vet");
    }
  });

  test("the guide describes the section with version and vetting", () => {
    const guide = templateGuide();
    expect(guide).toContain("Libraries");
    expect(guide).toContain("version");
    expect(guide).toContain("vetting");
  });

  test("ticket-check and ticket-parts accept the template's ticket with its section", () => {
    const body = templateExample().replace("<base sha>", "0123abc");
    expect(body).toContain("## Libraries");
    const file = writeTempTicket(body);
    try {
      const parts = runTool(["ticket-parts", file, "--final"]);
      expect(parts.code).toBe(0);
      const check = runTool([
        "ticket-check",
        "--body",
        file,
        "--title",
        "T",
        "--project",
        repoRoot(),
      ]);
      expect(check.code).toBe(0);
    } finally {
      rmSync(dirname(file), { recursive: true, force: true });
    }
  });
});

describe("C4: the clerk considers libraries for every ticket", () => {
  test("Prepare the ticket tells the clerk to consider libraries", () => {
    const s = prepareSection();
    expect(s).toContain("librar");
    expect(s).toContain("every ticket");
    expect(s).toContain("hand-written code");
    expect(s).toContain("programming language");
  });

  test("the passage names no project, package manager or library", () => {
    const s = prepareSection();
    // The ruling names the exact npm package name as what each Libraries line
    // carries; that phrase alone may say npm.
    expect(s.replaceAll("npm package name", "")).not.toContain("npm");
    for (const name of ["pnpm", "yarn", "pip", "cargo", "gem", "go get", "PyPI", "crates"]) {
      expect(s).not.toContain(name);
    }
  });
});

describe("C5: the clerk vets each library before listing it", () => {
  test("Prepare the ticket names the vetting checks", () => {
    const s = prepareSection();
    for (const word of [
      "look-alike",
      "publisher",
      "licence",
      "Linux",
      "macOS",
      "upkeep",
      "install script",
      "Socket",
    ]) {
      expect(s).toContain(word);
    }
  });

  test("the vetting uses the facts command and lists only what passes", () => {
    const s = prepareSection();
    expect(s).toContain("libraries facts");
    expect(s).toContain("only those that pass");
    expect(s).toContain("left off the list");
    expect(s).toContain("npm package name");
  });
});
