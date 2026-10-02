import { testBesideTarget } from "./test-beside-target.ts";

const plugin = {
  meta: { name: "postmaster" },
  rules: { "test-beside-target": testBesideTarget },
};

export default plugin;
