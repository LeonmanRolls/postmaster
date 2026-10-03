# lint

Project custom lint rules live here, as TypeScript plugins against ESLint's rule API,
run through Oxlint.

`test-beside-target` (#158, kept through the #109 merge) fails a `*.test.ts`
that is not beside its target. The functional style rules and the regex
`u` flag rule are #171's, still to come. `plugin.ts` wires the rules
into Oxlint; each rule carries its tests beside it, run by `bun test`.
