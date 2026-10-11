import { describe, expect, test } from "bun:test";
import { consistent, countByDay, isTicketTitled, parseTsv, totalsOf, windowCount } from "./pace.ts";

describe("isTicketTitled", () => {
  test("positive control: a number and a comma at the start", () => {
    expect(isTicketTitled("#341, Research: could the flow run on Cloudflare?")).toBe(true);
    expect(isTicketTitled("#7, A thing")).toBe(true);
  });

  test("negative control: no number, no comma, a number later, or an empty title", () => {
    expect(isTicketTitled("Speed up the gate")).toBe(false);
    expect(isTicketTitled("#341 Research without a comma")).toBe(false);
    expect(isTicketTitled("Fix #341, later")).toBe(false);
    expect(isTicketTitled("#, no digits")).toBe(false);
    expect(isTicketTitled("")).toBe(false);
  });
});

describe("countByDay", () => {
  const rows = [
    { mergedAt: "2026-10-10T23:59:59Z", title: "#1, a" },
    { mergedAt: "2026-10-11T00:00:00Z", title: "#2, b" },
    { mergedAt: "2026-10-11T04:00:00Z", title: "a hotfix" },
    { mergedAt: "2026-10-09T12:00:00Z", title: "#3, c" },
  ];

  test("counts by UTC merge day, in day order, and splits ticket-titled from the rest", () => {
    const days = countByDay(rows);
    expect(Object.keys(days)).toEqual(["2026-10-09", "2026-10-10", "2026-10-11"]);
    expect(days["2026-10-11"]).toEqual({ merged: 2, ticketTitled: 1 });
    expect(days["2026-10-10"]).toEqual({ merged: 1, ticketTitled: 1 });
  });

  test("negative control: no pull requests give no days", () => {
    expect(countByDay([])).toEqual({});
  });
});

describe("parseTsv", () => {
  test("reads time and title, keeps tabs inside a title, and drops lines with no tab or no time", () => {
    const text = "2026-10-11T04:00:00Z\t#1, a\tb\nnot a time\tx\nno tab here\n\n2026-10-10T01:00:00Z\tplain";
    expect(parseTsv(text)).toEqual([
      { mergedAt: "2026-10-11T04:00:00Z", title: "#1, a\tb" },
      { mergedAt: "2026-10-10T01:00:00Z", title: "plain" },
    ]);
  });
});

describe("windowCount and consistent", () => {
  const days = { "2026-10-09": { merged: 5, ticketTitled: 4 }, "2026-10-10": { merged: 3, ticketTitled: 3 }, "2026-10-11": { merged: 2, ticketTitled: 0 } };

  test("sums a count over the days from and to, both included", () => {
    expect(windowCount(days, "2026-10-09", "2026-10-10", "ticketTitled")).toBe(7);
    expect(windowCount(days, "2026-10-09", "2026-10-11", "merged")).toBe(10);
  });

  test("negative control: a window with no days is zero", () => {
    expect(windowCount(days, "2026-01-01", "2026-01-31", "merged")).toBe(0);
  });

  test("a day with more ticket-titled than merged is inconsistent", () => {
    expect(consistent(days)).toBe(true);
    expect(consistent({ ...days, "2026-10-12": { merged: 1, ticketTitled: 2 } })).toBe(false);
  });
});

describe("totalsOf", () => {
  test("counts the rows and the ticket-titled rows without going through the days", () => {
    const rows = [
      { mergedAt: "2026-10-10T01:00:00Z", title: "#1, a" },
      { mergedAt: "2026-10-11T01:00:00Z", title: "plain" },
    ];
    expect(totalsOf(rows)).toEqual({ total: 2, ticketTitledTotal: 1 });
    const days = countByDay(rows);
    expect(Object.values(days).reduce((a, c) => a + c.merged, 0)).toBe(totalsOf(rows).total);
  });

  test("negative control: no rows are no totals", () => {
    expect(totalsOf([])).toEqual({ total: 0, ticketTitledTotal: 0 });
  });
});
