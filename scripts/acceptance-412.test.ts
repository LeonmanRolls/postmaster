// Oracle for #412, committed before the change: a clerk's start delivers its
// brief to the new session once, waiting until the session can take it; when
// the session cannot take it in time, the failure names the session and its
// tab and gives one command that delivers the brief as printed; marking the
// ticket ready closes the session once the clerk's turn ends; and a second
// start while one is open is refused. C1-C4 run the ticket's own interface
// (run clerk start, run host send/read, run ticket-ready mark) with the stub
// herdr of host-self-test.ts first on PATH, made to behave as the live
// server does. Not covered: C5 (the fixture run, scored at landing).
import { describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { calls, clerkRepo, fxEnv, makeFx, readHerdr, SELF, sh } from "./acceptance-373.ts";
import {
  clerkEnvConfig,
  clerkSession,
  legacySession,
  markReady,
  placementFor,
  promptEntries,
  promptText,
  splitShell,
  waitFor,
} from "./acceptance-412.ts";

describe("C1: a clerk's start delivers its brief", () => {
  test("start waits for the session, delivers once, and the session answers by name", () => {
    const fx = makeFx("412-c1");
    try {
      const { repo, id } = clerkRepo(fx);
      const env = fxEnv(fx, {
        POSTMASTER_CONFIG: clerkEnvConfig(fx),
        POSTMASTER_CLERK_SEND_WAIT: "60",
      });
      const form = sh(
        SELF,
        ["launch", "interactive", "clerk", "--project", repo, "--name", `#${id}, probe`],
        env,
        fx.root,
      );
      expect(form.code).toBe(0);
      expect(form.out).toContain("&& bash -c");
      const started = sh(SELF, ["clerk", "start", repo, id], env, fx.root);
      expect(started.code).toBe(0);
      const session = clerkSession(repo, id)!;
      expect(`${started.out}\n${started.err}`).toContain("opened");
      expect(started.out).toContain(`(session ${session.handle})`);
      const got = sh("herdr", ["agent", "get", session.handle], env, fx.root);
      expect(got.code).toBe(0);
      const read = sh(SELF, ["host", "read", session.handle, "5"], env, fx.root);
      expect(read.code).toBe(0);
      const prompts = promptEntries(fx);
      expect(prompts.length).toBe(1);
      expect(prompts[0]![0]).toBe(session.handle);
      expect(prompts[0]![1]).toBe(promptText(repo, id));
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  }, 180000);
});

describe("C2: when the session cannot take the brief", () => {
  test("a blocked session fails named with one command, which delivers once made ready", () => {
    const fx = makeFx("412-c2-blocked");
    try {
      const { repo, id } = clerkRepo(fx);
      writeFileSync(join(fx.stub, "agent.blocked"), "");
      const env = fxEnv(fx, {
        POSTMASTER_CONFIG: clerkEnvConfig(fx),
        POSTMASTER_CLERK_SEND_WAIT: "6",
      });
      const started = sh(SELF, ["clerk", "start", repo, id], env, fx.root);
      expect(started.code).toBe(1);
      const session = clerkSession(repo, id)!;
      const placed = placementFor(fx, session.handle);
      const text = `${started.out}\n${started.err}`;
      expect(text).toContain(session.handle);
      expect(text).toContain(session.ticket);
      expect(text).toContain(placed.pane);
      const command = text.trim().split("\n").pop()!;
      expect(command).toContain("host");
      expect(command).toContain("send");
      expect(command).toContain(session.handle);
      expect(promptEntries(fx).length).toBe(0);
      rmSync(join(fx.stub, "agent.blocked"), { force: true });
      const argv = splitShell(command);
      const delivered = sh(argv[0]!, argv.slice(1), env, fx.root);
      expect(delivered.code).toBe(0);
      const prompts = promptEntries(fx);
      expect(prompts.length).toBe(1);
      expect(prompts[0]![0]).toBe(session.handle);
      expect(prompts[0]![1]).toBe(promptText(repo, id));
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  }, 240000);

  test("a session that never shows is still attempted once", () => {
    const fx = makeFx("412-c2-tried");
    try {
      const { repo, id } = clerkRepo(fx);
      writeFileSync(join(fx.stub, "agent.never"), "");
      const env = fxEnv(fx, {
        POSTMASTER_CONFIG: clerkEnvConfig(fx),
        POSTMASTER_CLERK_SEND_WAIT: "3",
      });
      const started = sh(SELF, ["clerk", "start", repo, id], env, fx.root);
      expect(started.code).toBe(1);
      expect(promptEntries(fx).length).toBe(0);
      expect(
        calls(fx, "herdr").filter((line) => line.startsWith("agent\tprompt\t")).length,
      ).toBeGreaterThanOrEqual(1);
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  }, 120000);

  test("a session that never shows fails named with one command, which delivers once shown", () => {
    const fx = makeFx("412-c2-never");
    try {
      const { repo, id } = clerkRepo(fx);
      writeFileSync(join(fx.stub, "agent.never"), "");
      const env = fxEnv(fx, {
        POSTMASTER_CONFIG: clerkEnvConfig(fx),
        POSTMASTER_CLERK_SEND_WAIT: "6",
      });
      const started = sh(SELF, ["clerk", "start", repo, id], env, fx.root);
      expect(started.code).toBe(1);
      const session = clerkSession(repo, id)!;
      const placed = placementFor(fx, session.handle);
      const text = `${started.out}\n${started.err}`;
      expect(text).toContain(session.handle);
      expect(text).toContain(session.ticket);
      expect(text).toContain(placed.pane);
      const command = text.trim().split("\n").pop()!;
      expect(command).toContain("host");
      expect(command).toContain("send");
      expect(command).toContain(session.handle);
      expect(promptEntries(fx).length).toBe(0);
      rmSync(join(fx.stub, "agent.never"), { force: true });
      const argv = splitShell(command);
      const delivered = sh(argv[0]!, argv.slice(1), env, fx.root);
      expect(delivered.code).toBe(0);
      const prompts = promptEntries(fx);
      expect(prompts.length).toBe(1);
      expect(prompts[0]![0]).toBe(session.handle);
      expect(prompts[0]![1]).toBe(promptText(repo, id));
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  }, 240000);
});

describe("C3: marking ready closes the session once its turn ends", () => {
  test("(a) a delivered start closes once and drops its record", async () => {
    const fx = makeFx("412-c3a");
    try {
      const { repo, id } = clerkRepo(fx);
      const env = fxEnv(fx, {
        POSTMASTER_CONFIG: clerkEnvConfig(fx),
        POSTMASTER_CLERK_SEND_WAIT: "60",
      });
      const started = sh(SELF, ["clerk", "start", repo, id], env, fx.root);
      expect(started.code).toBe(0);
      const session = clerkSession(repo, id)!;
      const placed = placementFor(fx, session.handle);
      markReady(fx, repo, id, env);
      expect(
        await waitFor(
          () => clerkSession(repo, id) === null && readHerdr(fx).tabs[placed.tab] === undefined,
          30,
        ),
      ).toBe(true);
      expect(calls(fx, "herdr").filter((line) => line === `tab\tclose\t${placed.tab}`).length).toBe(
        1,
      );
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  }, 240000);

  test("(b) a hand-delivered brief closes the same way", async () => {
    const fx = makeFx("412-c3b");
    try {
      const { repo, id } = clerkRepo(fx);
      writeFileSync(join(fx.stub, "agent.blocked"), "");
      const env = fxEnv(fx, {
        POSTMASTER_CONFIG: clerkEnvConfig(fx),
        POSTMASTER_CLERK_SEND_WAIT: "6",
      });
      const started = sh(SELF, ["clerk", "start", repo, id], env, fx.root);
      expect(started.code).toBe(1);
      const session = clerkSession(repo, id)!;
      const placed = placementFor(fx, session.handle);
      const command = `${started.out}\n${started.err}`.trim().split("\n").pop()!;
      rmSync(join(fx.stub, "agent.blocked"), { force: true });
      const argv = splitShell(command);
      expect(sh(argv[0]!, argv.slice(1), env, fx.root).code).toBe(0);
      markReady(fx, repo, id, env);
      expect(
        await waitFor(
          () => clerkSession(repo, id) === null && readHerdr(fx).tabs[placed.tab] === undefined,
          30,
        ),
      ).toBe(true);
      expect(calls(fx, "herdr").filter((line) => line === `tab\tclose\t${placed.tab}`).length).toBe(
        1,
      );
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  }, 240000);

  test("(c) a session left unnamed closes the same way", async () => {
    const fx = makeFx("412-c3c");
    try {
      const { repo, id } = clerkRepo(fx);
      const env = fxEnv(fx, {
        POSTMASTER_CONFIG: clerkEnvConfig(fx),
        POSTMASTER_HOST_SPAWN_WAIT: "1",
      });
      const legacy = await legacySession(fx, repo, id, env);
      markReady(fx, repo, id, env);
      expect(
        await waitFor(
          () => clerkSession(repo, id) === null && readHerdr(fx).tabs[legacy.tab] === undefined,
          30,
        ),
      ).toBe(true);
      expect(calls(fx, "herdr").filter((line) => line === `tab\tclose\t${legacy.tab}`).length).toBe(
        1,
      );
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  }, 120000);
});

describe("C4: a second start while one is open is refused", () => {
  test("a delivered session refuses another start and opens no second tab", () => {
    const fx = makeFx("412-c4a");
    try {
      const { repo, id } = clerkRepo(fx);
      const env = fxEnv(fx, {
        POSTMASTER_CONFIG: clerkEnvConfig(fx),
        POSTMASTER_CLERK_SEND_WAIT: "60",
      });
      expect(sh(SELF, ["clerk", "start", repo, id], env, fx.root).code).toBe(0);
      expect(Object.keys(readHerdr(fx).tabs).length).toBe(1);
      const again = sh(SELF, ["clerk", "start", repo, id], env, fx.root);
      expect(again.code).toBe(1);
      expect(`${again.out}\n${again.err}`).toContain(
        `one booking clerk session is open for ${id} already; continue it or finish it first`,
      );
      expect(Object.keys(readHerdr(fx).tabs).length).toBe(1);
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  }, 300000);

  test("an unnamed session refuses another start and opens no second tab", async () => {
    const fx = makeFx("412-c4b");
    try {
      const { repo, id } = clerkRepo(fx);
      const env = fxEnv(fx, {
        POSTMASTER_CONFIG: clerkEnvConfig(fx),
        POSTMASTER_HOST_SPAWN_WAIT: "1",
      });
      await legacySession(fx, repo, id, env);
      expect(Object.keys(readHerdr(fx).tabs).length).toBe(1);
      const again = sh(SELF, ["clerk", "start", repo, id], env, fx.root);
      expect(again.code).toBe(1);
      expect(`${again.out}\n${again.err}`).toContain(
        `one booking clerk session is open for ${id} already; continue it or finish it first`,
      );
      expect(Object.keys(readHerdr(fx).tabs).length).toBe(1);
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  }, 180000);
});
