import { describe, expect, it } from "vitest";
import { composeTaxExclusive, deriveCategory, splitTaxInclusive } from "./utils.js";

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
    expect(deriveCategory({ taxId: "28080623" })).toBe("B2B");
  });
});
