// The project's own Oxlint rules. Later rules join this plugin's rules map.

import { testBesideTarget } from "./test-beside-target.ts";

export default {
  meta: { name: "postmaster" },
  rules: {
    "test-beside-target": testBesideTarget,
  },
};
