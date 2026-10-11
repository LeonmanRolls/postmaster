// Blind acceptance tests for #332: sessions the flow opens for the user run
// the harness as the pane's own process. One case per check the ticket pins:
// the harness leads the terminal's foreground group on a pty and as a tmux
// window's own command, it keeps its environment including the role's env
// file, and the headless launches behave exactly as at the base. The Herdr
// leg of C1 needs a live space, so it stays hand-verified and out of this file.
// The tmux control is gated by test.skipIf with a top notice.
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Layout } from "./launch-interactive-oracle.ts";
import {
  expectEnv,
  expectLead,
  formHarnessArgv,
  haveTmux,
  makeLayout,
  parseProbe,
  printForm,
  ptyInvocation,
  runHeadless,
  runPlain,
  runPty,
  runTmux,
  teamConfig,
} from "./launch-interactive-oracle.ts";

function oracle(name: string, fn: (lay: Layout) => void, timeout = 120000): void {
  test(
    name,
    () => {
      const lay = makeLayout();
      try {
        fn(lay);
      } finally {
        lay.cleanup();
      }
    },
    timeout,
  );
}

function oracleSkipIf(
  cond: boolean,
  name: string,
  fn: (lay: Layout) => void,
  timeout = 120000,
): void {
  test.skipIf(cond)(
    name,
    () => {
      const lay = makeLayout();
      try {
        fn(lay);
      } finally {
        lay.cleanup();
      }
    },
    timeout,
  );
}

oracle("pty: the clerk's harness leads the terminal's foreground group", (lay) => {
  const cfg = teamConfig(
    lay,
    "clerk",
    `clerk = { harness = "claude", model = "m", env_file = "${lay.fooEnv}" }`,
  );
  const text = runPty(lay, printForm(lay, cfg, "clerk"));
  expectLead(parseProbe(text), text);
});

oracle("pty: the clerk's harness keeps its environment", (lay) => {
  const cfg = teamConfig(
    lay,
    "clerk",
    `clerk = { harness = "claude", model = "m", env_file = "${lay.fooEnv}" }`,
  );
  const text = runPty(lay, printForm(lay, cfg, "clerk"));
  expectEnv(parseProbe(text), lay, "1", "bar");
});

oracle("pty: the postmaster's harness leads the terminal's foreground group", (lay) => {
  const cfg = teamConfig(
    lay,
    "pm",
    `postmaster = { harness = "claude", model = "m", env_file = "${lay.fooEnv}" }`,
  );
  const text = runPty(lay, printForm(lay, cfg, "postmaster"));
  expectLead(parseProbe(text), text);
});

oracle("pty: the postmaster's harness keeps its environment", (lay) => {
  const cfg = teamConfig(
    lay,
    "pm",
    `postmaster = { harness = "claude", model = "m", env_file = "${lay.fooEnv}" }`,
  );
  const text = runPty(lay, printForm(lay, cfg, "postmaster"));
  expectEnv(parseProbe(text), lay, "1", "bar");
});

oracleSkipIf(!haveTmux(), "tmux: the clerk's harness is the window's own process", (lay) => {
  const cfg = teamConfig(
    lay,
    "clerk",
    `clerk = { harness = "claude", model = "m", env_file = "${lay.fooEnv}" }`,
  );
  const text = runTmux(lay, printForm(lay, cfg, "clerk"));
  if (text === null) throw new Error("tmux vanished mid-run");
  expectLead(parseProbe(text), text);
});

oracle("an env file that sets FOO hands FOO and SHLVL=1, without the launch names", (lay) => {
  const cfg = teamConfig(
    lay,
    "clerk",
    `clerk = { harness = "claude", model = "m", env_file = "${lay.fooEnv}" }`,
  );
  const form = printForm(lay, cfg, "clerk");
  const r = runPlain(lay, form);
  if (r.code !== 0)
    throw new Error(`form exited ${r.code}\n--- out ---\n${r.out}\n--- err ---\n${r.err}`);
  const p = parseProbe(r.out);
  expectEnv(p, lay, "1", "bar");
  // The file sees the harness argv as $@, as under the headless wrapper: no
  // extra word, no shifted first word.
  const harness = formHarnessArgv(form, lay.fooEnv);
  expect(p.argc).toBe(String(harness.length));
  expect(p.arg1).toBe(harness[0] ?? "");
});

oracle("an env file that sets SHLVL hands it verbatim", (lay) => {
  const cfg = teamConfig(
    lay,
    "clerk",
    `clerk = { harness = "claude", model = "m", env_file = "${lay.shlvlEnv}" }`,
  );
  const r = runPlain(lay, printForm(lay, cfg, "clerk"));
  if (r.code !== 0)
    throw new Error(`form exited ${r.code}\n--- out ---\n${r.out}\n--- err ---\n${r.err}`);
  expectEnv(parseProbe(r.out), lay, "9", "UNSET");
});

oracle("an env file that exits 3 starts no harness and ends 3", (lay) => {
  const cfg = teamConfig(
    lay,
    "clerk",
    `clerk = { harness = "claude", model = "m", env_file = "${lay.exit3Env}" }`,
  );
  const report = join(lay.dir, "report.txt");
  const r = runPlain(lay, printForm(lay, cfg, "clerk"), { ORACLE_REPORT: report });
  expect(r.code).toBe(3);
  expect(existsSync(report)).toBe(false);
});

oracle("without an env file the form is the bare harness command", (lay) => {
  const cfg = teamConfig(lay, "clerk", `clerk = { harness = "claude", model = "m" }`);
  const form = printForm(lay, cfg, "clerk");
  expect(form.includes("bash")).toBe(false);
  expect(form.startsWith(`cd ${lay.repo} && claude `)).toBe(true);
  const r = runPlain(lay, `echo PARENT_SHLVL=$SHLVL; ${form}`);
  if (r.code !== 0)
    throw new Error(`form exited ${r.code}\n--- out ---\n${r.out}\n--- err ---\n${r.err}`);
  // ASCII: the marker line is machine-made ASCII.
  const parent = /PARENT_SHLVL=(\S+)/u.exec(r.out);
  if (!parent) throw new Error(`no parent level in:\n${r.out}`);
  // No wrapper, so the harness sees the parent environment verbatim, as today.
  const p = parseProbe(r.out);
  expect(p.shlvl).toBe(parent[1] ?? "");
  expect(p.foo).toBe("UNSET");
  expect(p.parent).toBe("oracle-yes");
  expect(p.launchName).toBe("oracle-name");
  expect(p.launchRole).toBe("oracle-role");
  expect(p.stream).toBe(lay.stream);
});

for (const harness of ["muse", "claude"]) {
  oracle(
    `headless: a self-TERM harness with an env file exits 143 on ${harness}, not by signal`,
    (lay) => {
      const r = runHeadless(lay, harness);
      expect(r.signal).toBeNull();
      expect(r.status).toBe(143);
    },
  );
}

test("pty invocation: macOS takes the form as the command, Linux feeds it through stdin", () => {
  const mac = ptyInvocation("darwin", "echo hi");
  expect(mac.args).toEqual([
    "-q",
    "/dev/null",
    "bash",
    "--norc",
    "--noprofile",
    "-i",
    "-c",
    "echo hi",
  ]);
  expect(mac.input).toBeNull();
  const linux = ptyInvocation("linux", "echo hi");
  expect(linux.args).toEqual(["-qec", "bash --norc --noprofile -i", "/dev/null"]);
  expect(linux.input).toBe("echo hi\nexit\n");
});
