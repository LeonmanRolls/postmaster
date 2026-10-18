// Preloaded by bunfig.toml for every `bun test` run in this repository: the gate, a run's own test
// runs and a person's. A time limit catches a hang, so the default sits far above what any test takes
// on a loaded machine, where every test runs at half speed or less. A test or a hook states a limit
// only when it needs more than this.
import { setDefaultTimeout } from "bun:test";
import "./test-children.ts";

export const DEFAULT_TEST_TIMEOUT_MS = 60_000;

setDefaultTimeout(DEFAULT_TEST_TIMEOUT_MS);

// The gate tells everything it runs where the run's private-data record is, the test suite included,
// and many tests feed the scanner made-up private data on purpose. A test that inherited the path
// would write those findings into the run's record as if the run had made them. Every test run
// passes through this file, so forgetting the path here keeps the whole suite, and anything a test
// starts, out of the record; a test that needs a record names its own.
delete process.env.POSTMASTER_DETECTIONS_LOG;
