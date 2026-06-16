import { describe, expect, it } from "vitest";
import { amegoTaxType, computeAmegoAmounts } from "./amounts.js";

describe("computeAmegoAmounts", () => {
  it("B2B 應稅 splits out untaxed sales + tax (verified: 168 → 160 + 8)", () => {
    expect(computeAmegoAmounts({ total: 168, taxType: "TAXABLE", category: "B2B" })).toMatchObject({
      SalesAmount: 160,
      TaxAmount: 8,
      TotalAmount: 168,
      TaxType: 1,
    });
  });

  it("B2C 應稅 reports the tax-inclusive total with zero tax (verified: 105 → 105 + 0)", () => {
    expect(computeAmegoAmounts({ total: 105, taxType: "TAXABLE", category: "B2C" })).toMatchObject({
      SalesAmount: 105,
      TaxAmount: 0,
      TotalAmount: 105,
    });
  });

  it("免稅 puts the total in FreeTaxSalesAmount", () => {
    expect(computeAmegoAmounts({ total: 100, taxType: "TAX_FREE", category: "B2C" })).toMatchObject({
      FreeTaxSalesAmount: 100,
      SalesAmount: 0,
      TaxAmount: 0,
      TaxType: 3,
    });
  });

  it("零稅率 puts the total in ZeroTaxSalesAmount", () => {
    expect(computeAmegoAmounts({ total: 100, taxType: "ZERO_RATED", category: "B2B" })).toMatchObject({
      ZeroTaxSalesAmount: 100,
      SalesAmount: 0,
      TaxAmount: 0,
      TaxType: 2,
    });
  });

  it("maps each TaxType to its MIG code", () => {
    expect(amegoTaxType("TAXABLE")).toBe(1);
    expect(amegoTaxType("ZERO_RATED")).toBe(2);
    expect(amegoTaxType("TAX_FREE")).toBe(3);
    expect(amegoTaxType("SPECIAL")).toBe(4);
  });
});
