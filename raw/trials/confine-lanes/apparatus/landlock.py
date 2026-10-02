#!/usr/bin/env python3
"""Run a command under a Landlock ruleset: read and execute only beneath --ro paths, and
read, execute and write only beneath --rw paths. Everything else on the filesystem is
neither readable nor writable. Linux 5.13 or newer; no privileges, no user namespace.

  landlock.py [--ro <path>]... [--rw <path>]... -- <command> [args...]

A path that does not exist grants nothing. Exit 126 when the ruleset cannot be applied, so a
caller never mistakes an unconfined run for a confined one.
"""
import ctypes, os, sys

SYS_CREATE, SYS_ADD, SYS_RESTRICT = 444, 445, 446   # x86_64 and aarch64 share these numbers
PR_SET_NO_NEW_PRIVS = 38
RULE_PATH_BENEATH = 1

EXECUTE, WRITE_FILE, READ_FILE, READ_DIR = 1 << 0, 1 << 1, 1 << 2, 1 << 3
REMOVE_DIR, REMOVE_FILE, MAKE_CHAR, MAKE_DIR = 1 << 4, 1 << 5, 1 << 6, 1 << 7
MAKE_REG, MAKE_SOCK, MAKE_FIFO, MAKE_BLOCK, MAKE_SYM = 1 << 8, 1 << 9, 1 << 10, 1 << 11, 1 << 12
REFER, TRUNCATE = 1 << 13, 1 << 14                   # ABI 2 and 3

libc = ctypes.CDLL(None, use_errno=True)
libc.syscall.restype = ctypes.c_long


class RulesetAttr(ctypes.Structure):
    _fields_ = [("handled_access_fs", ctypes.c_uint64)]


class PathBeneath(ctypes.Structure):
    _pack_ = 1
    _fields_ = [("allowed_access", ctypes.c_uint64), ("parent_fd", ctypes.c_int32)]


def fail(msg):
    sys.stderr.write("landlock: %s\n" % msg)
    sys.exit(126)


def main(argv):
    ro, rw, i = [], [], 0
    while i < len(argv) and argv[i] != "--":
        if argv[i] in ("--ro", "--rw") and i + 1 < len(argv):
            (ro if argv[i] == "--ro" else rw).append(argv[i + 1]); i += 2
        else:
            fail("usage: landlock.py [--ro <path>]... [--rw <path>]... -- <command...>")
    cmd = argv[i + 1:]
    if not cmd:
        fail("no command")
    abi = libc.syscall(SYS_CREATE, None, 0, 1)
    if abi < 1:
        fail("Landlock is not available on this kernel (errno %d)" % ctypes.get_errno())
    read = EXECUTE | READ_FILE | READ_DIR
    write = (WRITE_FILE | REMOVE_DIR | REMOVE_FILE | MAKE_CHAR | MAKE_DIR | MAKE_REG | MAKE_SOCK
             | MAKE_FIFO | MAKE_BLOCK | MAKE_SYM)
    if abi >= 2: write |= REFER
    if abi >= 3: write |= TRUNCATE
    attr = RulesetAttr(read | write)
    rs = libc.syscall(SYS_CREATE, ctypes.byref(attr), ctypes.sizeof(attr), 0)
    if rs < 0:
        fail("cannot create a ruleset (errno %d)" % ctypes.get_errno())
    file_rights = EXECUTE | READ_FILE | WRITE_FILE | (TRUNCATE if abi >= 3 else 0)
    for paths, rights in ((ro, read), (rw, read | write)):
        for p in paths:
            try:
                fd = os.open(p, os.O_PATH | os.O_CLOEXEC)
            except OSError:
                continue
            allowed = rights if os.path.isdir(p) else rights & file_rights
            rule = PathBeneath(allowed, fd)
            if libc.syscall(SYS_ADD, rs, RULE_PATH_BENEATH, ctypes.byref(rule), 0) < 0:
                fail("cannot add %s (errno %d)" % (p, ctypes.get_errno()))
            os.close(fd)
    if libc.prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0:
        fail("cannot set no_new_privs")
    if libc.syscall(SYS_RESTRICT, rs, 0) < 0:
        fail("cannot restrict this process (errno %d)" % ctypes.get_errno())
    os.close(rs)
    try:
        os.execvp(cmd[0], cmd)
    except OSError as e:
        fail("cannot run %s: %s" % (cmd[0], e.strerror))


if __name__ == "__main__":
    main(sys.argv[1:])
