# Porting conventions for ticket #109 (read this first)

We are converting every script under scripts/ from bash+Python to TypeScript run by Bun.
Each script keeps its path and interface.

## Files
- `scripts/<name>.sh` becomes EXACTLY this one-line wrapper (preserve the filename):

```bash
#!/usr/bin/env bash
exec bun "$(dirname "$0")/<name>.ts" "$@"
```

- `scripts/<name>.ts` is the full port of the original `.sh` logic (bash and its Python
  heredocs / `python3 -c` one-liners). Read the ORIGINAL `.sh` fully before writing.
- Shared helpers already exist and MUST be reused:
  - `./lib/paths.ts` — `scriptsDir(meta)`, `toolRoot(meta)`, `beside(meta, name)`
  - `./lib/proc.ts` — `run(cmd, args, opts)` (never throws on non-zero), `withTempDir(fn)`,
    `die(msg, code)`, `say(msg)`
  - `./lib/data.ts` — `readJsonFile`, `tryJsonFile`, `readTomlFile`, `tryTomlFile`,
    `readJsonl`, `parseTomlText`
  - `./lib/selftest.ts` — `SelfTest` class: `ok(label)`, `fail(label, detail?)`,
    `check(label, cond, detail?)`, `expect(passOrFail, label, call, expectIn?)`,
    `finish()`
  Import them as `from "./lib/proc.ts"` (allowImportingTsExtensions is on).
  Callers pass `import.meta` into paths helpers.

## Runtime rules
- Runtime imports: ONLY `bun` (e.g. `import { $ } from "bun"`), `node:*` standard modules,
  and `./lib/*.ts`. NO npm runtime dependencies.
- Python is forbidden. TOML = `Bun.TOML.parse` / `readTomlFile`. JSON = `JSON.parse`.
- Keep the same subcommands, argument handling, stdout/stderr text (byte-for-byte where
  practical), and exit codes as the original bash.
- Where bash ran `git ...` / `gh ...` / other tools, use `run()` from `./lib/proc.ts` or
  `Bun.$` so the command line reads like the shell line it replaces.
- Side effects (fs, process, network) at the edges; parse/decide in functions.

## Self-tests (CRITICAL)
- If the original has `--self-test`, the `.ts` MUST accept `--self-test` as the first
  argument and run EVERY control the BASE version had, with the SAME labels and the same
  success/failure text where possible.
- Self-test output format:
  - `  ok   <label>`
  - `  FAIL <label>` with detail lines indented 9 spaces
  - section headers like `positive controls` / `negative controls` where BASE had them
  - end with `self-test: all controls behaved` (exit 0) or
    `self-test: N control(s) misbehaved` (exit 1)
- Use `SelfTest` from `./lib/selftest.ts`.
- When a control re-invokes the script (`$0`, `$SELF`), invoke the `.sh` wrapper path
  (`join(scriptsDir(import.meta), "<name>.sh")`) so the wrapper is what is tested.
- Preserve BASE's fixed clocks via env vars (e.g. `RUN_LOG_NOW`) exactly as BASE did.
- Silence expected stderr in negative controls the way BASE redirected `2>/dev/null`.

## What NOT to do
- Do not change what the script does (no new features, no bug fixes beyond what the port
  requires).
- Do not touch files outside the scripts you are assigned.
- Do not run `bun run check`, `tsc`, `biome`, or `git commit` — the integrator does that.
- Do not add self-tests to scripts that had none at BASE.

## After writing
List each BASE self-test control and where it landed (for the PR table):
`BASE: <label>` → `ported: <label>` (or note if a label was split/merged).
