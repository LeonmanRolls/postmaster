// Oracle for #408, committed before the change: the user can choose for one
// ticket whether its run gets the technical notes, and the run records which.
// C1 pins the user's value winning over the setting in both directions, and
// the refusal outside the two; C2 pins the value in the run's record with the
// verb that prints it; C3 pins the source, user where named and setting where
// not; C4 pins the scorer reading a user-named held-back record, and leaves
// the fixture run to a dispatched run. Every case drives scripts/run as a
// subprocess.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gitOrThrow, initRepo, machine, RUN } from "./acceptance-408.ts";
import { run, withTempDir } from "./lib/proc.ts";

interface NotesRecord {
  ticket_notes: string;
  ticket_notes_source: string;
  ticket_notes_setting: string;
}

const recordOf = (dispatch: string): NotesRecord =>
  JSON.parse(readFileSync(join(dispatch, "run.json"), "utf8")) as NotesRecord;

const notesVerb = (
  dispatch: string,
  env: Record<string, string>,
): { code: number; out: string } => {
  const v = run(RUN, ["run-meta", "ticket-notes", dispatch], { env });
  return { code: v.code, out: v.out };
};

describe("C1: a value the user names wins over the setting", () => {
  test("the key at given with the user naming held-back records held-back, and the run gets it", () => {
    withTempDir((raw) => {
      const tmp = realpathSync(raw);
      const m = machine(tmp, "winhold", 'ticket_notes = "given"\n');
      const r = run(RUN, ["run-meta", m.dispatch, m.repo, "--ticket-notes", "held-back"], {
        env: m.env,
      });
      expect(r.code).toBe(0);
      expect(recordOf(m.dispatch).ticket_notes).toBe("held-back");
      const v = notesVerb(m.dispatch, m.env);
      expect(v.code).toBe(0);
      expect(v.out).toContain("ticket-notes: held-back");
    });
  });

  test("the key at held-back with the user naming given records given, and the run gets it", () => {
    withTempDir((raw) => {
      const tmp = realpathSync(raw);
      const m = machine(tmp, "wingiven", 'ticket_notes = "held-back"\n');
      const r = run(RUN, ["run-meta", m.dispatch, m.repo, "--ticket-notes", "given"], {
        env: m.env,
      });
      expect(r.code).toBe(0);
      expect(recordOf(m.dispatch).ticket_notes).toBe("given");
      const v = notesVerb(m.dispatch, m.env);
      expect(v.code).toBe(0);
      expect(v.out).toContain("ticket-notes: given");
    });
  });

  test("a value outside the two is refused naming both, and writes nothing", () => {
    withTempDir((raw) => {
      const tmp = realpathSync(raw);
      const m = machine(tmp, "notesbad");
      const r = run(RUN, ["run-meta", m.dispatch, m.repo, "--ticket-notes", "sometimes"], {
        env: m.env,
      });
      expect(r.code).toBe(1);
      expect(r.out + r.err).toContain("given");
      expect(r.out + r.err).toContain("held-back");
      expect(existsSync(join(m.dispatch, "run.json"))).toBe(false);
    });
  });

  test("the user naming both the mode and the notes passes both", () => {
    withTempDir((raw) => {
      const tmp = realpathSync(raw);
      const m = machine(tmp, "both", 'ticket_notes = "given"\n');
      const r = run(
        RUN,
        ["run-meta", m.dispatch, m.repo, "--mode", "single-thread", "--ticket-notes", "held-back"],
        { env: m.env },
      );
      expect(r.code).toBe(0);
      const rec = JSON.parse(readFileSync(join(m.dispatch, "run.json"), "utf8")) as NotesRecord & {
        mode: string;
      };
      expect(rec.mode).toBe("single-thread");
      expect(rec.ticket_notes).toBe("held-back");
      expect(rec.ticket_notes_source).toBe("user");
    });
  });
});

describe("C2: the run's record keeps the value used", () => {
  test("a dispatch with no user value records the setting's value, and the verb prints it", () => {
    withTempDir((raw) => {
      const tmp = realpathSync(raw);
      for (const [name, tail, value] of [
        ["setheld", 'ticket_notes = "held-back"\n', "held-back"],
        ["setplain", "", "given"],
      ] as Array<[string, string, string]>) {
        const m = machine(tmp, name, tail);
        const r = run(RUN, ["run-meta", m.dispatch, m.repo], { env: m.env });
        expect(r.code).toBe(0);
        expect(recordOf(m.dispatch).ticket_notes).toBe(value);
        const v = notesVerb(m.dispatch, m.env);
        expect(v.code).toBe(0);
        expect(v.out).toContain(`ticket-notes: ${value}`);
      }
    });
  });
});

describe("C3: the record says where the value came from", () => {
  test("user where the user named it, setting where no value was named, and the verb prints both", () => {
    withTempDir((raw) => {
      const tmp = realpathSync(raw);
      const named = machine(tmp, "named", 'ticket_notes = "given"\n');
      const r = run(RUN, ["run-meta", named.dispatch, named.repo, "--ticket-notes", "held-back"], {
        env: named.env,
      });
      expect(r.code).toBe(0);
      const nrec = recordOf(named.dispatch);
      expect(nrec.ticket_notes_source).toBe("user");
      expect(nrec.ticket_notes_setting).toBe("given");
      const nv = notesVerb(named.dispatch, named.env);
      expect(nv.code).toBe(0);
      expect(nv.out).toBe(
        "ticket-notes: held-back\nticket-notes source: user\nticket-notes setting: given\n",
      );
      const plain = machine(tmp, "unnamed");
      const p = run(RUN, ["run-meta", plain.dispatch, plain.repo], { env: plain.env });
      expect(p.code).toBe(0);
      const prec = recordOf(plain.dispatch);
      expect(prec.ticket_notes_source).toBe("setting");
      expect(prec.ticket_notes_setting).toBe("given");
      const pv = notesVerb(plain.dispatch, plain.env);
      expect(pv.code).toBe(0);
      expect(pv.out).toBe(
        "ticket-notes: given\nticket-notes source: setting\nticket-notes setting: given\n",
      );
    });
  });
});

describe("C4: the scorer reads a user-named held-back record", () => {
  /** A dispatch whose record says held-back from the user with no key in its config. */
  function userHeldDispatch(
    tmp: string,
    name: string,
    premisesActor: string | null,
  ): { dispatch: string; repo: string } {
    const dispatch = join(tmp, `score-${name}`);
    mkdirSync(dispatch, { recursive: true });
    writeFileSync(
      join(dispatch, "run.json"),
      JSON.stringify({
        ticket_notes: "held-back",
        ticket_notes_source: "user",
        ticket_notes_setting: "given",
        config: { team: { workhorses: ["alpha", "beta"] } },
      }),
      "utf8",
    );
    writeFileSync(join(dispatch, "manifest.json"), JSON.stringify({}), "utf8");
    writeFileSync(join(dispatch, "brief.md"), "# Waybill: x\n", "utf8");
    // The premises line goes through log-action as the flow writes it: a
    // hand-written line passes the score while the script refuses the actor.
    writeFileSync(join(dispatch, "actions.jsonl"), "\n", "utf8");
    if (premisesActor !== null) {
      const logged = run(RUN, [
        "log-action",
        dispatch,
        premisesActor,
        "premises",
        "abc1234",
        "base=abc1234",
        "result=same",
      ]);
      if (logged.code !== 0) throw new Error(`log-action failed: ${logged.err}`);
    }
    const repo = join(tmp, `score-repo-${name}`);
    initRepo(repo);
    writeFileSync(join(repo, "README.md"), "# app\n", "utf8");
    gitOrThrow(repo, "add", ".");
    gitOrThrow(repo, "commit", "-q", "-m", "first");
    return { dispatch, repo };
  }

  function premisesLine(dispatch: string, repo: string): string {
    const r = run(RUN, ["fixture", "score", dispatch, repo]);
    return r.out.split("\n").find((l) => l.includes("premises-order")) ?? "";
  }

  test("held-back from the user with a postmaster premises line scores its premises item", () => {
    withTempDir((raw) => {
      const tmp = realpathSync(raw);
      const { dispatch, repo } = userHeldDispatch(tmp, "held-post", "postmaster");
      expect(premisesLine(dispatch, repo)).toMatch(/^ok +premises-order/u);
    });
  });

  test("held-back from the user with no premises line fails its premises item", () => {
    withTempDir((raw) => {
      const tmp = realpathSync(raw);
      const { dispatch, repo } = userHeldDispatch(tmp, "held-none", null);
      expect(premisesLine(dispatch, repo)).toMatch(/^FAIL premises-order/u);
    });
  });

  test.skipIf(true)(
    "a fixture run on remove with no key and the user naming held-back scores clean",
    () => {
      // Needs a model run from this branch: no key in the config, the user
      // naming held-back, fixture score exit 0, run.json saying held-back from
      // user. The postmaster dispatches and scores it at landing.
    },
  );
});
