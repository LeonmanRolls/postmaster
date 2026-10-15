// Tests beside scripts/lib/library-approvals.ts: the identity, the
// lockfile reading, the approval cache and the ticket's library list.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  approvedSet,
  isApproved,
  LIBRARY_IDENTITY_RE,
  libraryIdentity,
  parseLockfile,
  readApprovalCache,
  readTicketLibraries,
} from "./library-approvals.ts";

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "postmaster-library-approvals-"));
}

describe("libraryIdentity", () => {
  test("is stable and shaped library:<16 hex>", () => {
    const a = libraryIdentity("left-pad", "1.3.0");
    expect(a).toBe(libraryIdentity("left-pad", "1.3.0"));
    expect(a).toMatch(LIBRARY_IDENTITY_RE);
    expect(libraryIdentity("left-pad", "1.3.1")).not.toBe(a);
    expect(libraryIdentity("is-odd", "1.3.0")).not.toBe(a);
  });
});

const LOCK = `{
  "lockfileVersion": 2,
  "workspaces": {
    "": {
      "name": "probe",
      "dependencies": {
        "left-pad": "1.3.0",
      },
      "devDependencies": {
        "oxlint": "1.86.0",
      },
    },
  },
  "packages": {
    "left-pad": ["left-pad@1.3.0", "https://example.invalid/left-pad.tgz", {}, "sha512-x"],
    "oxlint": ["oxlint@1.86.0", "", { "optionalDependencies": { "bind-x": "1.86.0" } }, "sha512-y"],
    "bind-x": ["bind-x@1.86.0", "", { "os": "linux" }, "sha512-z"],
  },
}
`;

describe("parseLockfile", () => {
  test("reads specs, resolved versions and edges through trailing commas", () => {
    const parsed = parseLockfile(LOCK);
    expect(parsed.specs.get("left-pad")).toBe("1.3.0");
    expect(parsed.specs.get("oxlint")).toBe("1.86.0");
    expect(parsed.resolved.get("left-pad")).toEqual(new Set(["1.3.0"]));
    expect(parsed.resolved.get("bind-x")).toEqual(new Set(["1.86.0"]));
    expect(parsed.edges.get("oxlint")).toEqual(new Set(["bind-x"]));
    expect(parsed.edges.has("left-pad")).toBe(false);
  });

  test("a lockfile that does not parse throws", () => {
    expect(() => parseLockfile("not jsonc {")).toThrow("does not parse");
    expect(() => parseLockfile("[]")).toThrow("not an object");
  });

  test("edges unite the dependency sets of every resolved version", () => {
    const parsed = parseLockfile(`{
  "lockfileVersion": 2,
  "workspaces": {},
  "packages": {
    "foo@1": ["foo@1.9.0", "", { "dependencies": { "left": "1.0.0" } }, "sha512-x"],
    "foo@2": ["foo@1.10.0", "", { "dependencies": { "right": "1.0.0" } }, "sha512-y"],
  },
}
`);
    expect(parsed.resolved.get("foo")).toEqual(new Set(["1.9.0", "1.10.0"]));
    expect(parsed.edges.get("foo")).toEqual(new Set(["left", "right"]));
  });
});

describe("readApprovalCache", () => {
  test("a missing cache holds nothing", () => {
    const dir = scratch();
    try {
      expect(readApprovalCache(dir)).toEqual(new Set());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a malformed cache throws", () => {
    const dir = scratch();
    try {
      mkdirSync(join(dir, ".postmaster"), { recursive: true });
      const path = join(dir, ".postmaster", "library-approvals.json");
      writeFileSync(path, "not json");
      expect(() => readApprovalCache(dir)).toThrow("does not parse");
      writeFileSync(path, JSON.stringify({ version: 1 }));
      expect(() => readApprovalCache(dir)).toThrow("no approvals table");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("approvedSet", () => {
  test("unites the lockfile's resolved set with the cached yeses", () => {
    const dir = scratch();
    try {
      writeFileSync(join(dir, "bun.lock"), LOCK);
      mkdirSync(join(dir, ".postmaster"), { recursive: true });
      writeFileSync(
        join(dir, ".postmaster", "library-approvals.json"),
        JSON.stringify({
          version: 1,
          approvals: { "is-odd@3.0.1": { identity: "library:x", run: "424" } },
        }),
      );
      const set = approvedSet(dir);
      expect(set.has("left-pad@1.3.0")).toBe(true);
      expect(set.has("bind-x@1.86.0")).toBe(true);
      expect(set.has("is-odd@3.0.1")).toBe(true);
      expect(set.has("is-odd@3.0.0")).toBe(false);
      expect(isApproved(dir, "left-pad", "1.3.0")).toBe(true);
      expect(isApproved(dir, "left-pad", "1.3.1")).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("readTicketLibraries", () => {
  test("reads each listed library with its vetting", () => {
    const libs = readTicketLibraries(
      "# T\n\n## Problem\n\nX.\n\n## Libraries\n\n- left-pad 1.3.0 one function, vetted\n- is-odd 3.0.1 odd check\n",
    );
    expect(libs).toEqual([
      { name: "left-pad", version: "1.3.0", vetting: "one function, vetted" },
      { name: "is-odd", version: "3.0.1", vetting: "odd check" },
    ]);
  });

  test("a list past ## For the agents is not the ticket's", () => {
    const libs = readTicketLibraries(
      "# T\n\n## For the agents\n\n## Libraries\n\n- is-odd 3.0.1 decoy\n",
    );
    expect(libs).toEqual([]);
  });

  test("a missing section and malformed lines list nothing", () => {
    expect(readTicketLibraries("# T\n\n## Problem\n\nX.\n")).toEqual([]);
    expect(
      readTicketLibraries(
        "# T\n\n## Libraries\n\n- left-pad ^1.3.0 a range, not exact\n- bareword\n",
      ),
    ).toEqual([]);
  });

  test("a fenced ## Libraries is not a section", () => {
    const libs = readTicketLibraries(
      "# T\n\n```\n## Libraries\n\n- is-odd 3.0.1 fenced\n```\n\n## Libraries\n\n- left-pad 1.3.0 real\n",
    );
    expect(libs).toEqual([{ name: "left-pad", version: "1.3.0", vetting: "real" }]);
  });
});
