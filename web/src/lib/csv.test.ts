import { describe, expect, it } from "vitest";
import { csvCell, csvRows } from "./csv";

describe("csvCell", () => {
  it.each([
    ["plain", "plain"],
    ["Smith, Jones & Co", '"Smith, Jones & Co"'],
    ['5" bracket', '"5"" bracket"'],
    ["two\nlines", '"two\nlines"'],
    [null, ""],
    [undefined, ""],
    [42, "42"],
  ])("%j -> %s", (value, expected) => expect(csvCell(value)).toBe(expected));

  // A supplier name or invoice number read from a PDF is untrusted: in Excel it must stay text
  it.each(["=HYPERLINK(\"http://x\")", "+1+2", "-2+3", "@SUM(A1)", "\t=1+1", "\r=1+1"])(
    "neutralizes the formula %j", (value) => {
      expect(csvCell(value).replace(/^"/, "")).toMatch(/^'/);
    });

  // Amounts must stay numbers so the accounting software can add them up
  it.each(["-12.50", "-0.01", "1250.00"])("keeps the amount %j as a number", (value) => {
    expect(csvCell(value)).toBe(value);
  });

  it("writes dates as ISO", () => {
    expect(csvCell(new Date("2026-11-02T15:05:00Z"))).toBe("2026-11-02T15:05:00.000Z");
  });
});

describe("csvRows", () => {
  it("writes a header and CRLF-terminated rows, in column order", () => {
    expect(csvRows(["a", "b"], [{ b: 2, a: 1 }, { a: "x,y", b: null }])).toBe('a,b\r\n1,2\r\n"x,y",\r\n');
  });
});
