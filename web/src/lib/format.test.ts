import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatMoney } from "./format";

describe("formatMoney", () => {
  it.each([
    ["1234.5", "$1,234.50"],
    [0, "$0.00"],
    ["20.0000", "$20.00"],
    [-15, "-$15.00"],
  ])("%j -> %s", (value, expected) => expect(formatMoney(value)).toBe(expected));

  it.each([null, undefined, ""])("shows a dash for %j", (value) => expect(formatMoney(value)).toBe("—"));

  it("formats other currencies with their own symbol", () => {
    expect(formatMoney("10", "EUR")).toBe("€10.00");
  });

  it("shows what was printed when it is not a number", () => {
    expect(formatMoney("n/a")).toBe("n/a");
  });
});

describe("formatDate", () => {
  // The classic bug: new Date("2026-10-01") is midnight UTC, which is September 30 in America
  it("never moves a date to the day before", () => {
    expect(formatDate("2026-10-01")).toBe("Oct 1, 2026");
    expect(formatDate("2026-01-01")).toBe("Jan 1, 2026");
  });

  it("ignores a time part", () => {
    expect(formatDate("2026-10-01T23:30:00Z")).toBe("Oct 1, 2026");
  });

  it.each([null, undefined, ""])("shows a dash for %j", (value) => expect(formatDate(value)).toBe("—"));
});

describe("formatDateTime", () => {
  it("shows the clinic's time (America/Chicago)", () => {
    expect(formatDateTime("2026-11-02T15:05:00Z")).toBe("Nov 2, 9:05 AM");
  });
});
