import { expect, test } from "bun:test";
import { keysBySnapshot, sameSet } from "./constancy.ts";

const header = "snapshot\tpath\tline\tcol\trule\tkind\tpage\ttext";

test("keys leave out the line and column, so a place that only moved reads the same", () => {
  const a = keysBySnapshot(`${header}\ns1\tp.ts\t4\t1\tprocess.env\tenv\tyes\tprocess.env\n`);
  const b = keysBySnapshot(`${header}\ns2\tp.ts\t90\t7\tprocess.env\tenv\tyes\tprocess.env\n`);
  expect(sameSet(a.get("s1"), b.get("s2"))).toBe(true);
});

test("a place that appeared or went reads different", () => {
  const a = keysBySnapshot(`${header}\ns1\tp.ts\t4\t1\tprocess.env\tenv\tyes\tprocess.env\n`);
  const b = keysBySnapshot(
    `${header}\ns2\tp.ts\t4\t1\tprocess.env\tenv\tyes\tprocess.env\ns2\tq.ts\t1\t1\timport:fs\tfile\tyes\timport x from "fs"\n`,
  );
  expect(sameSet(a.get("s1"), b.get("s2"))).toBe(false);
});
