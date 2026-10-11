// Preloaded by bunfig.toml for every `bun test` run in this repository: the gate, a run's own test
// runs and a person's. A time limit catches a hang, so the default sits far above what any test takes
// on a loaded machine, where every test runs at half speed or less. A test or a hook states a limit
// only when it needs more than this.
import { setDefaultTimeout } from "bun:test";
import "./test-children.ts";

export const DEFAULT_TEST_TIMEOUT_MS = 60_000;

setDefaultTimeout(DEFAULT_TEST_TIMEOUT_MS);
