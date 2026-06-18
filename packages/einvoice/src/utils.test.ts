import { describe, expect, it } from "vitest";
import { composeTaxExclusive, deriveCategory, parseTaipeiDate, splitTaxInclusive, taipeiDateTime } from "./utils.js";

describe("amount helpers", () => {
  it("composeTaxExclusive adds 5% tax", () => {
    expect(composeTaxExclusive(1000)).toEqual({
      salesAmount: 1000,
      taxAmount: 50,
      totalAmount: 1050,
    });
  });

  it("splitTaxInclusive is the inverse for clean numbers", () => {
    expect(splitTaxInclusive(1050)).toEqual({
      salesAmount: 1000,
      taxAmount: 50,
      totalAmount: 1050,
    });
  });

  it("splitTaxInclusive rounds the tax to an integer", () => {
    const r = splitTaxInclusive(105);
    expect(r.salesAmount + r.taxAmount).toBe(105);
    expect(Number.isInteger(r.taxAmount)).toBe(true);
  });

  it("deriveCategory keys off the buyer 統編", () => {
    expect(deriveCategory({})).toBe("B2C");
    expect(deriveCategory({ ubn: "28080623" })).toBe("B2B");
  });
});

describe("Taipei date helpers", () => {
  it("parseTaipeiDate interprets the string as UTC+8", () => {
    expect(parseTaipeiDate("2026-06-18 14:00:00").toISOString()).toBe("2026-06-18T06:00:00.000Z");
  });

  it("parseTaipeiDate trims and accepts a T separator", () => {
    expect(parseTaipeiDate("  2026-01-02T03:04:05  ").toISOString()).toBe("2026-01-01T19:04:05.000Z");
  });

  it("parseTaipeiDate falls back to a Date for unparseable input", () => {
    expect(parseTaipeiDate("nope")).toBeInstanceOf(Date);
  });

  it("taipeiDateTime formats a Date in Asia/Taipei", () => {
    expect(taipeiDateTime(new Date("2026-06-18T06:00:00Z"))).toBe("2026-06-18 14:00:00");
  });

  it("taipeiDateTime round-trips with parseTaipeiDate", () => {
    const s = "2026-12-25 23:59:59";
    expect(taipeiDateTime(parseTaipeiDate(s))).toBe(s);
  });
});
