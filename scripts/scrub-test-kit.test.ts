import { afterEach, expect, test } from "bun:test";
import {
  cleanupScratch,
  email,
  gitAt,
  initRepo,
  marker,
  opaqueId,
  phone,
  privatePath,
  token,
} from "./scrub-test-kit.ts";

afterEach(cleanupScratch);

test("test values are assembled from pieces at runtime", () => {
  expect(
    [email(), phone(), opaqueId(), token(), privatePath()].every((value) => value.length > 0),
  ).toBe(true);
  expect(marker("email").startsWith("private-data")).toBe(true);
});

test("scratch repositories use the required public identity by default", () => {
  const root = initRepo();
  const text = gitAt(root, ["show", "-s", "--format=%an <%ae>%n%cn <%ce>"]);
  expect(text.split("\n")).toEqual([
    "brindlewick <332054101+brindlewick@users.noreply.github.com>",
    "brindlewick <332054101+brindlewick@users.noreply.github.com>",
  ]);
});
