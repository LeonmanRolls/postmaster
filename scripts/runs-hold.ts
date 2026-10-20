// A run's hold in the watcher's held list, `<runs>/postmaster/held`: the one
// command that sets and releases holds. A helper's hold names the helper and
// the postmaster session that set it; a hand-written hold is the bare ticket,
// for a deliberate pause that must survive a new session. A second hold on
// the run is refused, whatever kind the first is, and each release touches
// only its own kind. The session token lives in `<runs>/postmaster/session`:
// a new postmaster session rotates it and drops every helper hold, since a
// helper ends with the session that started it, while hand-written lines stay.
//
//   run runs-hold hold <runs> <ticket> --helper <name>
//   run runs-hold release <runs> <ticket>
//   run runs-hold hold-hand <runs> <ticket>
//   run runs-hold release-hand <runs> <ticket>
//   run runs-hold release-stale <runs>
//
//   exit 0  done; the changed lines on stdout
//   exit 1  usage, an unreadable run root, a bad ticket or helper name, the
//           held list unreadable, or the lock not taken
//   exit 2  refused: the run is already held, or not held in the kind named
//
// The held list is read and written under `.held.lock`, taken O_EXCL with
// the holder's pid, waited on while the holder lives and taken past a dead
// one, and written atomically, so the watcher's re-read never sees a torn
// list and two holds racing on one run leave exactly one.
import { randomBytes } from "node:crypto";
import { closeSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteFileSync } from "./lib/effective-config.ts";
import {
  addHandHold,
  addHold,
  dropStaleHolds,
  formatHelperHold,
  removeHandHold,
  removeHelperHold,
} from "./lib/held.ts";
import { die } from "./lib/proc.ts";
import { processIsLive } from "./lib/processes.ts";

const USAGE =
  "run runs-hold hold <runs> <ticket> --helper <name> | release <runs> <ticket> | hold-hand <runs> <ticket> | release-hand <runs> <ticket> | release-stale <runs>";

const HELPER_NAME = /^[A-Za-z0-9._-]+$/u;

function postmasterDir(root: string): string {
  const pmDir = join(root, "postmaster");
  try {
    if (!statSync(pmDir).isDirectory()) die(`runs-hold: no such run root: ${root}`, 1);
  } catch {
    die(`runs-hold: no such run root: ${root}`, 1);
  }
  return pmDir;
}

function checkTicket(ticket: string): void {
  // ASCII: a ticket holds no whitespace of any kind.
  if (!/^\S+$/u.test(ticket)) die(`runs-hold: '${ticket}' is not a ticket`, 1);
}

function checkHelper(helper: string): void {
  if (!HELPER_NAME.test(helper)) die(`runs-hold: '${helper}' is not a helper name`, 1);
}

function readHeld(pmDir: string): string {
  const p = join(pmDir, "held");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(p));
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return "";
    die(`runs-hold: cannot read ${p}`, 1);
  }
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Take `.held.lock`, waiting while a live holder works and taking it past a
 * dead one; the deadline bounds both the wait and a fight over a stale lock. */
function withHeldLock<T>(pmDir: string, fn: () => T): T {
  const lock = join(pmDir, ".held.lock");
  const holder = (): number => {
    try {
      const value = Number(readFileSync(lock, "utf8").trim());
      return Number.isInteger(value) && value > 0 ? value : 0;
    } catch {
      return 0;
    }
  };
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      const fd = openSync(lock, "wx");
      writeFileSync(fd, `${process.pid}\n`);
      closeSync(fd);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "EEXIST")
        die(`runs-hold: cannot take ${lock}`, 1);
      const pid = holder();
      if (pid !== 0 && pid !== process.pid && processIsLive(pid)) {
        if (Date.now() >= deadline) die(`runs-hold: ${lock} is held by live pid ${String(pid)}`, 1);
        sleepSync(25);
        continue;
      }
      if (Date.now() >= deadline) die(`runs-hold: cannot take ${lock}: it cannot be replaced`, 1);
      rmSync(lock, { force: true });
    }
  }
  try {
    return fn();
  } finally {
    rmSync(lock, { force: true });
  }
}

function freshToken(): string {
  return randomBytes(16).toString("hex");
}

function sessionToken(pmDir: string): string {
  const p = join(pmDir, "session");
  try {
    const token = readFileSync(p, "utf8").trim();
    // ASCII: the stored token is one whitespace-free blob, renewed when it is not.
    if (/^\S+$/u.test(token)) return token;
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") die(`runs-hold: cannot read ${p}`, 1);
  }
  const token = freshToken();
  atomicWriteFileSync(pmDir, p, `${token}\n`);
  return token;
}

function holdCommand(pmDir: string, ticket: string, helper: string): number {
  return withHeldLock(pmDir, () => {
    const token = sessionToken(pmDir);
    const added = addHold(readHeld(pmDir), ticket, helper, token);
    if (!added.ok) {
      process.stderr.write(`runs-hold: ${ticket} is already held: ${added.held}\n`);
      return 2;
    }
    atomicWriteFileSync(pmDir, join(pmDir, "held"), added.text);
    console.log(formatHelperHold(ticket, helper, token));
    return 0;
  });
}

function releaseCommand(pmDir: string, ticket: string): number {
  return withHeldLock(pmDir, () => {
    const removed = removeHelperHold(readHeld(pmDir), ticket);
    if (!removed.ok) {
      process.stderr.write(
        removed.reason === "hand-held"
          ? `runs-hold: ${ticket} is held by hand, not by a helper\n`
          : `runs-hold: ${ticket} is not held\n`,
      );
      return 2;
    }
    atomicWriteFileSync(pmDir, join(pmDir, "held"), removed.text);
    for (const line of removed.removed) console.log(line);
    return 0;
  });
}

function holdHandCommand(pmDir: string, ticket: string): number {
  return withHeldLock(pmDir, () => {
    const added = addHandHold(readHeld(pmDir), ticket);
    if (!added.ok) {
      process.stderr.write(`runs-hold: ${ticket} is already held: ${added.held}\n`);
      return 2;
    }
    atomicWriteFileSync(pmDir, join(pmDir, "held"), added.text);
    console.log(ticket);
    return 0;
  });
}

function releaseHandCommand(pmDir: string, ticket: string): number {
  return withHeldLock(pmDir, () => {
    const removed = removeHandHold(readHeld(pmDir), ticket);
    if (!removed.ok) {
      process.stderr.write(
        removed.reason === "helper-held"
          ? `runs-hold: ${ticket} is held by a helper, not by hand\n`
          : `runs-hold: ${ticket} is not held\n`,
      );
      return 2;
    }
    atomicWriteFileSync(pmDir, join(pmDir, "held"), removed.text);
    for (const line of removed.removed) console.log(line);
    return 0;
  });
}

function releaseStaleCommand(pmDir: string): number {
  return withHeldLock(pmDir, () => {
    const token = freshToken();
    atomicWriteFileSync(pmDir, join(pmDir, "session"), `${token}\n`);
    const stale = dropStaleHolds(readHeld(pmDir), token);
    if (stale.dropped.length > 0) atomicWriteFileSync(pmDir, join(pmDir, "held"), stale.text);
    for (const line of stale.dropped) console.log(line);
    return 0;
  });
}

export function runsHoldCommand(argv: string[]): number {
  const [verb, ...rest] = argv;
  if (verb === "hold") {
    const [root, ticket, flag, helper, ...extra] = rest;
    if (
      root === undefined ||
      ticket === undefined ||
      flag !== "--helper" ||
      helper === undefined ||
      extra.length > 0
    )
      die(USAGE, 1);
    checkTicket(ticket);
    checkHelper(helper);
    return holdCommand(postmasterDir(root), ticket, helper);
  }
  if (verb === "release") {
    const [root, ticket, ...extra] = rest;
    if (root === undefined || ticket === undefined || extra.length > 0) die(USAGE, 1);
    checkTicket(ticket);
    return releaseCommand(postmasterDir(root), ticket);
  }
  if (verb === "hold-hand") {
    const [root, ticket, ...extra] = rest;
    if (root === undefined || ticket === undefined || extra.length > 0) die(USAGE, 1);
    checkTicket(ticket);
    return holdHandCommand(postmasterDir(root), ticket);
  }
  if (verb === "release-hand") {
    const [root, ticket, ...extra] = rest;
    if (root === undefined || ticket === undefined || extra.length > 0) die(USAGE, 1);
    checkTicket(ticket);
    return releaseHandCommand(postmasterDir(root), ticket);
  }
  if (verb === "release-stale") {
    const [root, ...extra] = rest;
    if (root === undefined || extra.length > 0) die(USAGE, 1);
    return releaseStaleCommand(postmasterDir(root));
  }
  die(USAGE, 1);
}

if (import.meta.main) {
  process.exit(runsHoldCommand(process.argv.slice(2)));
}
