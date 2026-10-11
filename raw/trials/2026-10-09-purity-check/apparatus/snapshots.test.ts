import { expect, test } from "bun:test";
import { snapshotsOf } from "./snapshots.ts";

test("the distinct snapshots of a findings table, in file order", () => {
  const tsv =
    "key\trun\tround\tsnapshot\n202/a\t202\t1\tabc\n202/b\t202\t1\tabc\n202/c\t202\t2\tdef\n";
  expect(snapshotsOf(tsv)).toEqual([
    { run: "202", round: "1", snapshot: "abc" },
    { run: "202", round: "2", snapshot: "def" },
  ]);
});
