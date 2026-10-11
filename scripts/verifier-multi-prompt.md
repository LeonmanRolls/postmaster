# Make one verifier for each of these surfaces: {{SURFACE_LIST}}

Make {{COUNT}} verifiers in this one session, one after another, in this
working copy:

{{DIR_LINES}}

Rules for the whole session, which win where a per-surface section disagrees:

- Write every verifier under verifier/ at the top of this working copy, one
  folder per surface as above. Every file of every verifier lives under verifier/;
  HANDOVER.md alone sits at the top. Never write a verify-<name>/ folder.
- After every verifier is proven, write verifier/README.md, an index with
  one bullet per verifier naming its folder and its surface in prose (command
  line, web pages, library interface). Each bullet carries a `Files:` list of
  the project files and folders whose change can break that verifier's claims,
  comma-separated, each relative to the top of the working copy; write only
  paths that exist at the commit you prove. Each bullet also carries
  `Confirmed: {{PROVED}}`, the commit its verifier was proved at; a verifier
  without one reads as possibly stale.
- Each verifier/<kind>/README.md opens with an H1 naming the verifier and one
  paragraph describing it, so a person can link it into a coding tool's skills
  folder. Near the top, where an agent reads first, carry this line verbatim:
  "A change which adds, changes or removes a feature updates that feature's page in the same change."
- Make a verifier for ONLY these surfaces.
{{UNLISTED_SENTENCE}}
- Prove each verifier as its section says, one after another; write the single
  HANDOVER.md once at the very end, covering every verifier.
- Commit the verifiers on this branch as you go.

{{PER_SURFACE}}
