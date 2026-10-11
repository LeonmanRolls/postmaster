# Passages

Quoted from the page at the url in `source.md`, retrieved 2026-10-04, read through a fetch tool
that returns the page as text. Only the passages the report relies on are kept. Each passage names
its section or page.

> Keep in mind that Helm is not supposed to contact the Kubernetes API Server during a `helm template|install|upgrade|delete|rollback --dry-run` operation.

Section on the lookup function; checked.

> To test `lookup` against a running cluster, `helm template|install|upgrade|delete|rollback --dry-run=server` should be used instead to allow cluster connection.

Same section; checked.

Paraphrase, not quoted: one read says that when no object is found, lookup returns an empty value (one read only, not checked).
