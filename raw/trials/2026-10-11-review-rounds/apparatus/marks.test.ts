import { describe, expect, test } from "bun:test";
import { agreement, combine, parseMarks } from "./marks.ts";

const a = [
  "1.2.1\tyes\tno\tcontract\tthe ticket is silent",
  "1.2.2\tno\tno\tstate\tcrash",
  "1.3.1\tno\tyes\tsite\tother place",
].join("\n");
const b = [
  "1.2.1\tyes\tno\tcontract\tsilent",
  "1.2.2\tunclear\tno\tstate\tshort",
  "1.3.1\tno\tno\tprose\twords",
].join("\n");

describe("the readers' marks", () => {
  test("lines are read, and one that is not a mark is returned (negative control)", () => {
    const r = parseMarks(`${a}\nnot a mark\n1.4.1\tmaybe\tno\tstate\tx`);
    expect(r.marks).toHaveLength(3);
    expect(r.bad).toHaveLength(2);
  });
  test("agreement counts identical marks and gives kappa 1 for identical readers (positive control)", () => {
    const ma = parseMarks(a).marks;
    const same = agreement(ma, ma);
    expect(same.ticketOpen).toEqual({ same: 3, kappa: 1 });
    const diff = agreement(ma, parseMarks(b).marks);
    expect(diff.n).toBe(3);
    expect(diff.ticketOpen.same).toBe(2);
    expect(diff.kind.same).toBe(2);
    expect(diff.disagrees.same).toBe(2);
  });
  test("both and either bound a mark, and a kind is kept only where the readers give the same", () => {
    const rows = combine(parseMarks(a).marks, parseMarks(b).marks);
    expect(rows.map((r) => r.openBoth)).toEqual([true, false, false]);
    expect(rows.map((r) => r.openEither)).toEqual([true, false, false]);
    expect(rows.map((r) => r.disagreesEither)).toEqual([false, false, true]);
    expect(rows.map((r) => r.disagreesBoth)).toEqual([false, false, false]);
    expect(rows.map((r) => r.kind)).toEqual(["contract", "state", null]);
  });
  test("an item only one reader marked is listed", () => {
    const ag = agreement(parseMarks(a).marks, parseMarks(b).marks.slice(0, 2));
    expect(ag.onlyA).toEqual(["1.3.1"]);
  });
});
