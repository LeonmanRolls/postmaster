# Passages

Quoted from the page at the url in `source.md`, retrieved 2026-10-04, read through a fetch tool
that returns the page as text. Only the passages the report relies on are kept. Each passage names
its section or page.

> Can't follow non-constant source. Use a directive to specify location

The warning message for SC1090; checked (both reads).

> # shellcheck source=/dev/null

The directive the page gives for the case where the user does not want the sourced file analysed; checked (both reads, as code).

Paraphrase, not quoted: ShellCheck cannot include a sourced file whose path is decided at run time; a directive comment before the source command, for example `# shellcheck source=src/util.sh` (this line checked as code), names a fixed file for it to read. The explanation sentence is not quoted because the two reads differ in wording.
