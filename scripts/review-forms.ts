// Whether a harness has its own code-review skill. The executable half of harnesses.md's Own
// review skills table for code-review, so that run launch, run reviewers and run setup never each
// carry a copy of the list.
//
//   run review-forms has <harness>   exit 0 when the harness has a code-review form, 3 when not
//
//   exit 0  has: the harness has a form
//   exit 3  has: the harness has no code-review form
//   exit 1  usage
const USAGE = "usage: run review-forms has <harness>";
const FORMS = new Set(["claude", "codex", "mimo"]);

const argv = process.argv.slice(2);

if (argv[0] === "has" && argv.length === 2) {
  process.exit(FORMS.has(argv[1]!) ? 0 : 3);
} else {
  console.error(USAGE);
  process.exit(1);
}
