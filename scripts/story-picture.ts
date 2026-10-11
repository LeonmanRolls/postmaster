// Draw the opening picture of a ticket's story with Codex, in the style of the
// postmaster poster, and convert it to a JPEG near 80% quality. The story
// builder calls this adapter; a session also runs it by hand for the one real
// picture it looks at before publishing. Codex is one adapter behind this
// command (design rule 2), never a case in the launch script.
//
//   scripts/run story-picture --prompt <prompt-file> --style <style-file> --out <out-file>
//
// The prompt asks Codex's image tool for one picture saved as picture.png in
// the scratch folder it runs in; the style file is the poster it draws from.
// Prints one line with the output and its bytes.
//
//   exit 0  drawn and converted
//   exit 1  usage, a missing file, Codex failed or drew nothing, no converter
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { run } from "./lib/proc.ts";

export const USAGE =
  "usage: story-picture.ts --prompt <prompt-file> --style <style-file> --out <out-file>";

const CODEX_TIMEOUT_MS = 20 * 60 * 1000;
const PROBE_TIMEOUT_MS = 10_000;
const PICTURE_NAME = "picture.png";
const JPEG_QUALITY = 82;

const PIL_CONVERT = [
  "import sys",
  "from PIL import Image",
  'Image.open(sys.argv[1]).convert("RGB").save(sys.argv[2], quality=82)',
].join("; ");

/** A JPEG converter the adapter can use, first available wins. */
export type Converter = "magick" | "convert" | "sips" | "pil";

/** The first converter available, in preference order, or null when none is. */
export function selectConverter(has: Record<Converter, boolean>): Converter | null {
  for (const name of ["magick", "convert", "sips", "pil"] as const) {
    if (has[name]) return name;
  }
  return null;
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function onPath(bin: string): boolean {
  const path = process.env.PATH ?? "";
  return path.split(":").some((dir) => dir.length > 0 && existsSync(join(dir, bin)));
}

// Python imports from the working directory first, so the probe and the
// conversion both run in the adapter's scratch, never in the caller's
// checkout, where a PIL.py of its own would be imported instead of Pillow.
function hasPil(cwd: string): boolean {
  if (!onPath("python3")) return false;
  const r = run("python3", ["-c", "import PIL.Image"], { cwd, timeout: PROBE_TIMEOUT_MS });
  return r.code === 0;
}

function available(cwd: string): Record<Converter, boolean> {
  return {
    magick: onPath("magick"),
    convert: onPath("convert"),
    sips: onPath("sips"),
    pil: hasPil(cwd),
  };
}

function convertWith(which: Converter, png: string, jpg: string, cwd: string): void {
  let r: { code: number; err: string };
  if (which === "magick" || which === "convert") {
    r = run(which, [png, "-quality", String(JPEG_QUALITY), jpg], {
      timeout: PROBE_TIMEOUT_MS * 6,
    });
  } else if (which === "sips") {
    r = run(
      "sips",
      ["-s", "format", "jpeg", "-s", "formatOptions", String(JPEG_QUALITY), png, "--out", jpg],
      { timeout: PROBE_TIMEOUT_MS * 6 },
    );
  } else {
    r = run("python3", ["-c", PIL_CONVERT, png, jpg], { cwd, timeout: PROBE_TIMEOUT_MS * 6 });
  }
  if (r.code !== 0) throw new Error(`${which}: ${r.err.trim() || `exit ${r.code}`}`);
}

/** Convert the PNG to a JPEG near 80% quality, trying each converter in turn. */
export function convertPng(
  png: string,
  jpg: string,
  has: Record<Converter, boolean>,
  cwd: string,
): Converter {
  const failures: string[] = [];
  for (const name of ["magick", "convert", "sips", "pil"] as const) {
    if (!has[name]) continue;
    try {
      convertWith(name, png, jpg, cwd);
      return name;
    } catch (e) {
      failures.push(e instanceof Error ? e.message : String(e));
    }
  }
  if (failures.length > 0) throw new Error(`no JPEG converter worked: ${failures.join("; ")}`);
  throw new Error("no JPEG converter available: install ImageMagick, or python3 with Pillow");
}

export function main(args: string[]): number {
  const promptFile = flag(args, "--prompt");
  const styleFile = flag(args, "--style");
  const outFile = flag(args, "--out");
  try {
    if (!promptFile || !styleFile || !outFile) throw new Error(USAGE);
    let prompt: string;
    try {
      prompt = readFileSync(promptFile, "utf8");
    } catch {
      throw new Error(`no prompt file ${promptFile}`);
    }
    if (!existsSync(styleFile)) throw new Error(`no style file ${styleFile}`);
    const scratch = mkdtempSync(join(tmpdir(), "story-picture-"));
    try {
      const codex = run(
        "codex",
        [
          "exec",
          "--skip-git-repo-check",
          "--dangerously-bypass-approvals-and-sandbox",
          "-c",
          "model_reasoning_effort=low",
          "-i",
          resolve(styleFile),
          "-",
        ],
        { cwd: scratch, input: prompt, timeout: CODEX_TIMEOUT_MS },
      );
      if (codex.timedOut) throw new Error("codex took longer than 20 minutes");
      if (codex.code !== 0) {
        throw new Error(`codex: ${codex.err.trim() || `exit ${codex.code}`}`);
      }
      const png = join(scratch, PICTURE_NAME);
      if (!existsSync(png)) {
        throw new Error(
          "codex drew no picture.png: the prompt must ask for one image saved as picture.png",
        );
      }
      const jpg = join(scratch, "picture.jpg");
      convertPng(png, jpg, available(scratch), scratch);
      mkdirSync(dirname(resolve(outFile)), { recursive: true });
      cpSync(jpg, outFile);
      const bytes = readFileSync(outFile).length;
      console.log(`picture: ${outFile}, ${bytes} bytes`);
      return 0;
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  } catch (e) {
    console.error(`story-picture: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
