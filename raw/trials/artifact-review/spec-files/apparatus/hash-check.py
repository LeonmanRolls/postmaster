#!/usr/bin/env python3
"""Check that a doc's code block holds a file byte for byte.

A Claude Docs read prints h='<8 hex>' for each block. For a text block that is the first 8 hex
of the SHA-256 of its text: the empty paragraph a new doc starts with read e3b0c442, the
SHA-256 of nothing (positive control). A file placed as a fenced code block loses the final
newline the fence closes, so the file is hashed without it. A copy with one byte changed must
hash differently (negative control). Run from the repository root.
"""
import hashlib
import subprocess

BASE = "faf18732c1281208d31ea8ee502f8287d75af3a0"
HEAD = "c84220ebcad4ddd08363a22441456b1575269647"
SHOWN = [  # (commit, path, the h the doc printed for the tab's code block)
    (HEAD, "scripts/summary-evidence.ts", "de5353ab"),
    (BASE, "skills/postmaster/workhorse-spec-template.md", "7569516f"),
]


def h(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:8]


print("positive control, empty text:", h(b""), "(the doc printed e3b0c442 for its empty paragraph)")
for commit, path, shown in SHOWN:
    raw = subprocess.run(["git", "show", f"{commit}:{path}"], capture_output=True, check=True).stdout
    body = raw[:-1] if raw.endswith(b"\n") else raw
    print(f"{path}: file {h(body)}, doc {shown}:", "match" if h(body) == shown else "MISMATCH")
    changed = body.replace(body[:1], b"#" if body[:1] != b"#" else b"!", 1)
    print(f"  negative control, first byte changed: {h(changed)}:", "match" if h(changed) == shown else "differs")
