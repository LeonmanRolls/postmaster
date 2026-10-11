// Tests beside scripts/story-picture.ts. Codex and the converters are stub
// binaries on PATH, so no real picture is ever drawn here; selectConverter is
// called directly. The one real Codex call happens by hand, not in this file.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./lib/proc.ts";
import { selectConverter } from "./story-picture.ts";

const script = join(import.meta.dir, "story-picture.ts");
const KNOWN = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let dir: string;
let bin: string;

function stub(name: string, text: string): void {
  const file = join(bin, name);
  writeFileSync(file, text);
  chmodSync(file, 0o755);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "story-picture-"));
  bin = join(dir, "bin");
  writeFileSync(join(dir, "prompt.txt"), "draw one picture, saved as picture.png\n");
  writeFileSync(join(dir, "style.jpg"), "fake-poster\n");
  writeFileSync(join(dir, "known.png"), KNOWN);
  mkdirSync(bin, { recursive: true });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function picture(args: string[], path: string): { code: number; out: string; err: string } {
  const r = run("bun", [script, ...args], {
    cwd: dir,
    env: {
      PATH: path,
      STUB_CODEX_ARGS: join(dir, "codex-args.txt"),
      STUB_CODEX_STDIN: join(dir, "codex-stdin.txt"),
      STUB_CODEX_IMAGE: join(dir, "known.png"),
      STUB_CODEX_MODE: process.env.STUB_CODEX_MODE,
      STUB_CONVERT_ARGS: join(dir, "convert-args.txt"),
    },
    timeout: 60_000,
  });
  return { code: r.code, out: r.out, err: r.err };
}

const CODEX_STUB = `#!/bin/sh
PATH=$PATH:/bin
echo "$*" >> "$STUB_CODEX_ARGS"
cat > "$STUB_CODEX_STDIN"
if [ "$STUB_CODEX_MODE" = "fail" ]; then echo "quota wall" >&2; exit 3; fi
if [ "$STUB_CODEX_MODE" = "nodraw" ]; then exit 0; fi
cp "$STUB_CODEX_IMAGE" ./picture.png
`;

const CONVERT_STUB = `#!/bin/sh
PATH=$PATH:/bin
echo "$*" >> "$STUB_CONVERT_ARGS"
cp "$1" "$4"
`;

const PYTHON_STUB = `#!/bin/sh
PATH=$PATH:/bin
pwd >> "$STUB_PYTHON_PWD"
if [ $# -eq 2 ]; then exit 0; fi
cp "$3" "$4"
`;

describe("selectConverter", () => {
  test("preference order then nothing", () => {
    const all = { magick: true, convert: true, sips: true, pil: true };
    expect(selectConverter(all)).toBe("magick");
    expect(selectConverter({ ...all, magick: false })).toBe("convert");
    expect(selectConverter({ ...all, magick: false, convert: false })).toBe("sips");
    expect(selectConverter({ magick: false, convert: false, sips: false, pil: true })).toBe("pil");
    expect(selectConverter({ magick: false, convert: false, sips: false, pil: false })).toBeNull();
  });
});

describe("story-picture", () => {
  test("usage without its flags", () => {
    stub("codex", CODEX_STUB);
    const r = picture([], `${bin}:${process.env.PATH ?? ""}`);
    expect(r.code).toBe(1);
    expect(r.err).toContain("usage:");
  });

  test("a missing prompt or style file is named", () => {
    stub("codex", CODEX_STUB);
    const path = `${bin}:${process.env.PATH ?? ""}`;
    const missing = join(dir, "no-prompt.txt");
    const r = picture(
      ["--prompt", missing, "--style", join(dir, "style.jpg"), "--out", join(dir, "o.jpg")],
      path,
    );
    expect(r.code).toBe(1);
    expect(r.err).toContain(missing);
    const r2 = picture(
      [
        "--prompt",
        join(dir, "prompt.txt"),
        "--style",
        join(dir, "no-style.jpg"),
        "--out",
        join(dir, "o.jpg"),
      ],
      path,
    );
    expect(r2.code).toBe(1);
    expect(r2.err).toContain("no-style.jpg");
  });

  test("stub codex plus stub convert writes the picture", () => {
    stub("codex", CODEX_STUB);
    stub("convert", CONVERT_STUB);
    const out = join(dir, "sub", "pic.jpg");
    const r = picture(
      ["--prompt", join(dir, "prompt.txt"), "--style", join(dir, "style.jpg"), "--out", out],
      `${bin}:${process.env.PATH ?? ""}`,
    );
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(r.out).toContain(out);
    expect(readFileSync(out).equals(KNOWN)).toBe(true);
    const args = readFileSync(join(dir, "codex-args.txt"), "utf8");
    for (const needle of [
      "exec",
      "--skip-git-repo-check",
      "--dangerously-bypass-approvals-and-sandbox",
      "-c",
      "model_reasoning_effort=low",
      "-i",
      join(dir, "style.jpg"),
    ]) {
      expect(args).toContain(needle);
    }
    expect(readFileSync(join(dir, "codex-stdin.txt"), "utf8")).toBe(
      "draw one picture, saved as picture.png\n",
    );
    expect(readFileSync(join(dir, "convert-args.txt"), "utf8")).toContain("-quality 82");
  });

  test("a failing codex fails the adapter with its message", () => {
    stub("codex", CODEX_STUB);
    stub("convert", CONVERT_STUB);
    process.env.STUB_CODEX_MODE = "fail";
    try {
      const out = join(dir, "pic.jpg");
      const r = picture(
        ["--prompt", join(dir, "prompt.txt"), "--style", join(dir, "style.jpg"), "--out", out],
        `${bin}:${process.env.PATH ?? ""}`,
      );
      expect(r.code).toBe(1);
      expect(r.err).toContain("codex");
      expect(r.err).toContain("quota wall");
      expect(existsSync(out)).toBe(false);
    } finally {
      delete process.env.STUB_CODEX_MODE;
    }
  });

  test("codex drawing nothing names the missing picture", () => {
    stub("codex", CODEX_STUB);
    stub("convert", CONVERT_STUB);
    process.env.STUB_CODEX_MODE = "nodraw";
    try {
      const out = join(dir, "pic.jpg");
      const r = picture(
        ["--prompt", join(dir, "prompt.txt"), "--style", join(dir, "style.jpg"), "--out", out],
        `${bin}:${process.env.PATH ?? ""}`,
      );
      expect(r.code).toBe(1);
      expect(r.err).toContain("picture.png");
      expect(existsSync(out)).toBe(false);
    } finally {
      delete process.env.STUB_CODEX_MODE;
    }
  });

  test("no converter says so and writes nothing", () => {
    stub("codex", CODEX_STUB);
    stub("python3", "#!/bin/sh\nexit 1\n");
    const out = join(dir, "pic.jpg");
    const r = run(
      process.execPath,
      [
        script,
        "--prompt",
        join(dir, "prompt.txt"),
        "--style",
        join(dir, "style.jpg"),
        "--out",
        out,
      ],
      {
        cwd: dir,
        env: {
          PATH: bin,
          STUB_CODEX_ARGS: join(dir, "codex-args.txt"),
          STUB_CODEX_STDIN: join(dir, "codex-stdin.txt"),
          STUB_CODEX_IMAGE: join(dir, "known.png"),
        },
        timeout: 60_000,
      },
    );
    expect(r.code).toBe(1);
    expect(r.err).toContain("converter");
    expect(existsSync(out)).toBe(false);
  });

  test("python3 runs in the scratch, not the caller directory", () => {
    stub("codex", CODEX_STUB);
    stub("python3", PYTHON_STUB);
    const out = join(dir, "pic.jpg");
    const r = run(
      process.execPath,
      [
        script,
        "--prompt",
        join(dir, "prompt.txt"),
        "--style",
        join(dir, "style.jpg"),
        "--out",
        out,
      ],
      {
        cwd: dir,
        env: {
          PATH: bin,
          STUB_CODEX_ARGS: join(dir, "codex-args.txt"),
          STUB_CODEX_STDIN: join(dir, "codex-stdin.txt"),
          STUB_CODEX_IMAGE: join(dir, "known.png"),
          STUB_PYTHON_PWD: join(dir, "python-pwd.txt"),
        },
        timeout: 60_000,
      },
    );
    expect(r.code).toBe(0);
    expect(readFileSync(out).equals(KNOWN)).toBe(true);
    const pwds = readFileSync(join(dir, "python-pwd.txt"), "utf8").trim().split("\n");
    expect(pwds.length).toBe(2);
    for (const p of pwds) {
      expect(p).not.toBe(dir);
      expect(p).toContain("story-picture-");
    }
  });

  test("a converter that fails is reported", () => {
    stub("codex", CODEX_STUB);
    stub("convert", "#!/bin/sh\necho broken >&2\nexit 1\n");
    stub("python3", "#!/bin/sh\nexit 1\n");
    const out = join(dir, "pic.jpg");
    const r = run(
      process.execPath,
      [
        script,
        "--prompt",
        join(dir, "prompt.txt"),
        "--style",
        join(dir, "style.jpg"),
        "--out",
        out,
      ],
      {
        cwd: dir,
        env: {
          PATH: bin,
          STUB_CODEX_ARGS: join(dir, "codex-args.txt"),
          STUB_CODEX_STDIN: join(dir, "codex-stdin.txt"),
          STUB_CODEX_IMAGE: join(dir, "known.png"),
        },
        timeout: 60_000,
      },
    );
    expect(r.code).toBe(1);
    expect(r.err).toContain("convert");
    expect(existsSync(out)).toBe(false);
  });
});
