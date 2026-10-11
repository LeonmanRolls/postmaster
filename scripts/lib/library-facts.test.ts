// Tests beside scripts/lib/library-facts.ts: the packument reading, the
// verdict line and the facts assembly, against fixtures and a stub
// registry. The live registry path is the same code with the default
// origin.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packumentFacts, readFacts, verdictText } from "./library-facts.ts";

const CLEAN = async () => [];

describe("packumentFacts", () => {
  test("reads the publish time and the source repository", () => {
    const facts = packumentFacts(
      {
        time: { "1.3.0": "2024-05-01T00:00:00.000Z" },
        versions: {
          "1.3.0": { repository: { type: "git", url: "https://example.invalid/pad.git" } },
        },
      },
      "1.3.0",
    );
    expect(facts).toEqual({
      published: "2024-05-01T00:00:00.000Z",
      source: "https://example.invalid/pad.git",
    });
  });

  test("a string repository and a missing time read through", () => {
    expect(
      packumentFacts(
        { versions: { "1.3.0": { repository: "https://example.invalid/pad" } } },
        "1.3.0",
      ),
    ).toEqual({ published: null, source: "https://example.invalid/pad" });
    expect(packumentFacts({ time: {}, versions: {} }, "9.9.9")).toEqual({
      published: null,
      source: null,
    });
    expect(packumentFacts(null, "1.3.0")).toEqual({ published: null, source: null });
  });
});

describe("verdictText", () => {
  test("clean, flagged and unchecked each read in one line", () => {
    expect(verdictText([])).toBe("clean");
    expect(
      verdictText([
        {
          level: "fatal",
          package: "left-pad",
          url: "https://example.invalid/pad",
          description: "pad is flagged",
        },
      ]),
    ).toBe("flagged: pad is flagged (https://example.invalid/pad)");
    expect(
      verdictText([{ level: "warn", package: "left-pad", url: null, description: null }]),
    ).toBe("flagged: left-pad (no advisory url)");
    expect(verdictText({ unreachable: "socket down" })).toBe("unchecked (socket down)");
  });
});

describe("readFacts", () => {
  test("a fixture packument answers without the network", async () => {
    const dir = mkdtempSync(join(tmpdir(), "postmaster-library-facts-"));
    try {
      writeFileSync(
        join(dir, "left-pad@1.3.0.json"),
        JSON.stringify({
          time: { "1.3.0": "2024-05-01T00:00:00.000Z" },
          versions: {
            "1.3.0": { repository: { type: "git", url: "https://example.invalid/pad.git" } },
          },
        }),
      );
      const facts = await readFacts("left-pad", "1.3.0", { fixtureDir: dir, scan: CLEAN });
      expect(facts).toEqual({
        name: "left-pad",
        version: "1.3.0",
        published: "2024-05-01T00:00:00.000Z",
        source: "https://example.invalid/pad.git",
        verdict: "clean",
        note: null,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a missing fixture record is unknown, not an error", async () => {
    const dir = mkdtempSync(join(tmpdir(), "postmaster-library-facts-"));
    try {
      const facts = await readFacts("left-pad", "1.3.0", { fixtureDir: dir, scan: CLEAN });
      expect(facts.published).toBe(null);
      expect(facts.source).toBe(null);
      expect(facts.note).toContain("no registry record");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a scan that throws reads unchecked", async () => {
    const dir = mkdtempSync(join(tmpdir(), "postmaster-library-facts-"));
    try {
      writeFileSync(
        join(dir, "left-pad@1.3.0.json"),
        JSON.stringify({ time: { "1.3.0": "2024-05-01T00:00:00.000Z" }, versions: {} }),
      );
      const facts = await readFacts("left-pad", "1.3.0", {
        fixtureDir: dir,
        scan: async () => {
          throw new Error("socket down");
        },
      });
      expect(facts.verdict).toBe("unchecked (socket down)");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a stub registry answers the live path", async () => {
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const u = new URL(req.url);
        if (u.pathname === "/left-pad") {
          return Response.json({
            time: { "1.3.0": "2024-05-01T00:00:00.000Z" },
            versions: {
              "1.3.0": { repository: "https://example.invalid/pad" },
            },
          });
        }
        return new Response("not found", { status: 404 });
      },
    });
    try {
      const registry = `http://127.0.0.1:${server.port}`;
      const facts = await readFacts("left-pad", "1.3.0", { registry, scan: CLEAN });
      expect(facts.published).toBe("2024-05-01T00:00:00.000Z");
      expect(facts.source).toBe("https://example.invalid/pad");
      expect(facts.note).toBe(null);
      const missing = await readFacts("is-odd", "3.0.1", { registry, scan: CLEAN });
      expect(missing.note).toContain("no registry record");
    } finally {
      server.stop();
    }
  });

  test("an unreachable registry reads unknown with its note", async () => {
    const facts = await readFacts("left-pad", "1.3.0", {
      registry: "http://127.0.0.1:1",
      scan: CLEAN,
    });
    expect(facts.published).toBe(null);
    expect(facts.note).toContain("cannot reach the registry");
  });
});
