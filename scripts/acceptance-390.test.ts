// Oracle for #390, committed before the change: a command writes the ship
// card's printed parts into the card from the run's records, so the coachman
// copies none of them by hand; the card carries a notes section right after
// them; and the coachman runs the command each time it raises the card. Every
// case drives scripts/run as a subprocess. The C4 event ordering and the C5
// fixture run need a dispatched run with model lanes and stay hand-verified
// by the postmaster at landing.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  TICKET,
  addCensusRow,
  cardWrite,
  checkFindings,
  checkPrivateData,
  checkResults,
  coachmanDoc,
  countOccurrences,
  headingOrderOk,
  landing,
  moveRecords,
  paragraph,
  postmasterDoc,
  readCard,
  refuseSwitch,
  removeDir,
  rendered,
  scratchDir,
  scratchLayout,
  stepFive,
  addNoReasonSwitch,
  writeCard,
} from "./acceptance-390.ts";

let tmp = "";

beforeAll(() => {
  tmp = scratchDir("acceptance-390-");
});

afterAll(() => {
  removeDir(tmp);
});

describe("C1: the command writes the printed parts", () => {
  test("a card holding only coachman sections gains each part exactly once", () => {
    const layout = scratchLayout(tmp, "c1");
    const before = readCard(layout);
    const intro = before.slice(0, before.indexOf("## Merge"));
    const rest = before.slice(before.indexOf("## Merge"));
    const written = cardWrite(layout);
    expect(written.code).toBe(0);
    expect(`${written.out}${written.err}`).toBe("");
    const card = readCard(layout);
    const parts = rendered(layout);
    expect(checkResults(layout).out.trim()).toBe("match");
    expect(checkFindings(layout).out.trim()).toBe("match");
    expect(checkPrivateData(layout).out.trim()).toBe("match");
    expect(countOccurrences(card, parts.block)).toBe(1);
    expect(countOccurrences(card, parts.switchOffs)).toBe(1);
    expect(countOccurrences(card, parts.privateData)).toBe(1);
    expect(card).toContain(`${parts.block}\n${parts.switchOffs}`);
    expect(card).toContain(`${parts.switchOffs}\n## Private data findings`);
    expect(card).toContain(`${parts.privateData}\n## Notes\n`);
    // The line one coachman dropped: the empty file name renders as written.
    expect(card).toContain("`` (main checkout)");
    // Everything outside the printed region is untouched.
    expect(card.slice(0, card.indexOf("## Checks"))).toBe(intro);
    expect(card).toContain("## Notes\n\nnone\n\n## Merge");
    expect(card.endsWith(rest)).toBe(true);
  });

  test("a coachman-written notes section moves after the parts with its words", () => {
    const layout = scratchLayout(tmp, "c1b");
    const before = readCard(layout);
    const words = "The reach line names the project folder itself.\n";
    writeCard(layout, before.replace("## Merge", `## Notes\n\n${words}\n## Merge`));
    const written = cardWrite(layout);
    expect(written.code).toBe(0);
    const card = readCard(layout);
    expect(checkResults(layout).out.trim()).toBe("match");
    expect(checkPrivateData(layout).out.trim()).toBe("match");
    const parts = rendered(layout);
    expect(card).toContain(`${parts.privateData}\n## Notes\n`);
    expect(card).toContain(`## Notes\n\n${words}\n## Merge`);
    expect(card).not.toContain(`${words}\n\n## Merge`);
    expect(countOccurrences(card, "## Notes")).toBe(1);
  });

  test("card-write with missing args prints its usage", () => {
    const layout = scratchLayout(tmp, "c1c");
    const r = landing("card-write", layout.dispatch, layout.wt);
    expect(r.code).toBe(1);
    expect(`${r.out}${r.err}`).toContain("usage: run landing card-write");
  });
});

describe("C2: running it again replaces the parts", () => {
  test("a second run changes nothing", () => {
    const layout = scratchLayout(tmp, "c2a");
    expect(cardWrite(layout).code).toBe(0);
    const once = readCard(layout);
    const again = cardWrite(layout);
    expect(again.code).toBe(0);
    expect(readCard(layout)).toBe(once);
    expect(checkResults(layout).out.trim()).toBe("match");
    expect(checkFindings(layout).out.trim()).toBe("match");
    expect(checkPrivateData(layout).out.trim()).toBe("match");
  });

  test("moved records replace the parts and leave everything else alone", () => {
    const layout = scratchLayout(tmp, "c2b");
    expect(cardWrite(layout).code).toBe(0);
    const words = "The gate passed on the second try.\n";
    writeCard(layout, readCard(layout).replace("## Notes\n\nnone\n", `## Notes\n\n${words}`));
    moveRecords(layout);
    const before = readCard(layout);
    const intro = before.slice(0, before.indexOf("## Checks"));
    const notes = before.slice(before.indexOf("## Notes"), before.indexOf("## Merge"));
    const rest = before.slice(before.indexOf("## Merge"));
    const written = cardWrite(layout);
    expect(written.code).toBe(0);
    const card = readCard(layout);
    const parts = rendered(layout);
    expect(parts.block).toContain("## Open findings\n\nnone");
    expect(parts.privateData).toContain(
      "- token at settings.json:2 (bbbbbbbbbbbb) - marked as made-up",
    );
    expect(countOccurrences(card, parts.block)).toBe(1);
    expect(countOccurrences(card, parts.switchOffs)).toBe(1);
    expect(countOccurrences(card, parts.privateData)).toBe(1);
    expect(card).toContain("a second look");
    expect(checkResults(layout).out.trim()).toBe("match");
    expect(checkFindings(layout).out.trim()).toBe("match");
    expect(checkPrivateData(layout).out.trim()).toBe("match");
    expect(card.slice(0, card.indexOf("## Checks"))).toBe(intro);
    expect(card.slice(card.indexOf("## Notes"), card.indexOf("## Merge"))).toBe(notes);
    expect(card.endsWith(rest)).toBe(true);
  });

  test("a paragraph inserted into the block is replaced", () => {
    const layout = scratchLayout(tmp, "c2c");
    expect(cardWrite(layout).code).toBe(0);
    const slip = "\nThe checks all pass because the gate is green.\n";
    writeCard(
      layout,
      readCard(layout).replace(
        "## Open findings\n\n- [P1] bug-1\n",
        `## Open findings\n\n- [P1] bug-1\n${slip}`,
      ),
    );
    expect(checkResults(layout).code).toBe(1);
    expect(cardWrite(layout).code).toBe(0);
    const card = readCard(layout);
    expect(card).not.toContain("the gate is green");
    expect(checkResults(layout).out.trim()).toBe("match");
  });

  test("a dropped reach line is restored", () => {
    const layout = scratchLayout(tmp, "c2d");
    expect(cardWrite(layout).code).toBe(0);
    const card = readCard(layout);
    const dropped = card
      .split("\n")
      .filter((l) => !l.includes("`` (main checkout)"))
      .join("\n");
    expect(dropped).not.toBe(card);
    writeCard(layout, dropped);
    expect(checkResults(layout).code).toBe(1);
    expect(cardWrite(layout).code).toBe(0);
    expect(readCard(layout)).toContain("`` (main checkout)");
    expect(checkResults(layout).out.trim()).toBe("match");
  });

  test("a printed section outside the block stops the command with the card untouched", () => {
    const layout = scratchLayout(tmp, "c2e");
    expect(cardWrite(layout).code).toBe(0);
    const card = readCard(layout);
    writeCard(layout, `${card}\n## Reach\n\n- card: clean\n`);
    const refused = cardWrite(layout);
    expect(refused.code).toBe(1);
    expect(`${refused.out}${refused.err}`).toContain("not one block starting at ## Checks");
    expect(readCard(layout)).toBe(`${card}\n## Reach\n\n- card: clean\n`);
  });

  test("a card holding the notes section twice stops the command with the card untouched", () => {
    const layout = scratchLayout(tmp, "c2f");
    expect(cardWrite(layout).code).toBe(0);
    const card = readCard(layout);
    writeCard(layout, `${card}\n## Notes\n\nMore words.\n`);
    const refused = cardWrite(layout);
    expect(refused.code).toBe(1);
    expect(`${refused.out}${refused.err}`).toContain("holds the notes section twice");
    expect(readCard(layout)).toBe(`${card}\n## Notes\n\nMore words.\n`);
  });

  test("switch-offs without a reason stop the command with the card untouched", () => {
    const layout = scratchLayout(tmp, "c2g");
    const card = readCard(layout);
    addNoReasonSwitch(layout);
    const refused = cardWrite(layout);
    expect(refused.code).toBe(3);
    expect(`${refused.out}${refused.err}`).toContain("no reason");
    expect(readCard(layout)).toBe(card);
  });

  test("refused switch-offs stop the command with the card untouched", () => {
    const layout = scratchLayout(tmp, "c2h");
    const card = readCard(layout);
    refuseSwitch(layout);
    const refused = cardWrite(layout);
    expect(refused.code).toBe(4);
    expect(`${refused.out}${refused.err}`).toContain("refused");
    expect(readCard(layout)).toBe(card);
  });

  test("a block without reach records ends at Not re-reviewed and gains Reach when notes land", () => {
    const layout = scratchLayout(tmp, "c2i", { reach: false });
    expect(cardWrite(layout).code).toBe(0);
    const card = readCard(layout);
    expect(card).not.toContain("## Reach");
    expect(checkResults(layout).out.trim()).toBe("match");
    const before = card;
    const intro = before.slice(0, before.indexOf("## Checks"));
    const rest = before.slice(before.indexOf("## Merge"));
    moveRecords(layout);
    expect(cardWrite(layout).code).toBe(0);
    const grown = readCard(layout);
    const parts = rendered(layout);
    expect(grown).toContain("## Reach");
    expect(countOccurrences(grown, parts.block)).toBe(1);
    expect(checkResults(layout).out.trim()).toBe("match");
    expect(checkFindings(layout).out.trim()).toBe("match");
    expect(grown.slice(0, grown.indexOf("## Checks"))).toBe(intro);
    expect(grown.endsWith(rest)).toBe(true);
  });

  test("a census block replaces cleanly when suspects land", () => {
    const layout = scratchLayout(tmp, "c2j", { census: true });
    expect(cardWrite(layout).code).toBe(0);
    expect(readCard(layout)).toContain("## Main history census");
    expect(checkPrivateData(layout).out.trim()).toBe("match");
    const before = readCard(layout);
    const intro = before.slice(0, before.indexOf("## Checks"));
    const rest = before.slice(before.indexOf("## Merge"));
    addCensusRow(layout);
    expect(cardWrite(layout).code).toBe(0);
    const grown = readCard(layout);
    const parts = rendered(layout);
    expect(parts.privateData).toContain("- suspects: 3");
    expect(countOccurrences(grown, parts.privateData)).toBe(1);
    expect(checkPrivateData(layout).out.trim()).toBe("match");
    expect(grown.slice(0, grown.indexOf("## Checks"))).toBe(intro);
    expect(grown.endsWith(rest)).toBe(true);
  });
});

describe("C3: the notes section follows the printed parts", () => {
  test("the card step names ## Notes as the one place for the coachman's words", () => {
    const step = stepFive(coachmanDoc());
    expect(step).toContain("## Notes");
    expect(step).toContain("the one place for the coachman's own words about the printed parts");
    expect(step).not.toContain("pasted verbatim as the card's `## Checks`");
  });

  test("the heading list orders the notes section after the printed parts", () => {
    const sentence = paragraph(coachmanDoc(), "Each of those is its own `##` section");
    expect(headingOrderOk(sentence)).toBe(true);
    // Negative control: the list before this change names no printed
    // switch-offs or private-data sections and no notes section.
    const old =
      "**Each of those is its own `##` section** — the card-block's four, then " +
      "`## Merge`, `## Turnpikes`, `## Style residue`, `## Branches`, `## Lane outcomes`, " +
      "`## QA and browser suite` (`none` where the project has none) and `## Review link` —";
    expect(headingOrderOk(old)).toBe(false);
  });
});

describe("C4: the coachman runs the command each time it raises the card", () => {
  test("the card step runs the command after any merge, gate or reach check", () => {
    const step = stepFive(coachmanDoc());
    expect(step).toContain("card-write");
    expect(coachmanDoc()).toContain("after any merge, gate or reach check");
  });

  test("both stale paths name the command", () => {
    const stale = paragraph(postmasterDoc(), "raise the card again");
    expect(stale).toContain("card-write");
    const fresh = paragraph(coachmanDoc(), "Ask the freshness question again before the card");
    expect(fresh).toContain("card-write");
  });

  test.skipIf(true)("the fixture run's events show the command last", () => {
    // Needs the C5 fixture run: its leg events show card-write run after the
    // last verify run, after reach check card and after any merge of main,
    // and before .card-ready, with the postmaster's first Stage F check
    // printing match from card-results, card-findings and private-data-card.
    // The postmaster checks it at landing.
  });
});

describe("C5: the fixture run scores clean", () => {
  test.skipIf(true)(`a run from the ${TICKET} branch scores clean`, () => {
    // Needs a model run from this branch against a fixture repository; the
    // postmaster dispatches and scores it at landing, and coachman-contract
    // names this change a contract change.
  });
});
