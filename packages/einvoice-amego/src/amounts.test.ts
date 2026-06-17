import { describe, expect, it } from "vitest";
import { amegoTaxType, computeAmegoAmounts } from "./amounts.js";

describe("computeAmegoAmounts", () => {
  it("B2B 應稅 splits out untaxed sales + tax (verified live: 105 → 100 + 5)", () => {
    expect(
      computeAmegoAmounts({ lines: [{ amount: 105, taxType: 1 }], buyerHasUbn: true }),
    ).toMatchObject({ SalesAmount: 100, TaxAmount: 5, TotalAmount: 105, TaxType: 1 });
  });

  it("B2C 應稅 keeps the tax-inclusive total with zero tax (verified live: 105 → 105 + 0)", () => {
    expect(
      computeAmegoAmounts({ lines: [{ amount: 105, taxType: 1 }], buyerHasUbn: false }),
    ).toMatchObject({ SalesAmount: 105, TaxAmount: 0, TotalAmount: 105 });
  });

  it("B2B tax-exclusive adds tax on top", () => {
    expect(
      computeAmegoAmounts({
        lines: [{ amount: 100, taxType: 1 }],
        buyerHasUbn: true,
        priceExclusive: true,
      }),
    ).toMatchObject({ SalesAmount: 100, TaxAmount: 5, TotalAmount: 105 });
  });

  it("免稅 lines go to FreeTaxSalesAmount", () => {
    expect(
      computeAmegoAmounts({ lines: [{ amount: 100, taxType: 3 }], buyerHasUbn: true }),
    ).toMatchObject({ FreeTaxSalesAmount: 100, SalesAmount: 0, TaxAmount: 0, TaxType: 3 });
  });

  it("零稅率 lines go to ZeroTaxSalesAmount", () => {
    expect(
      computeAmegoAmounts({ lines: [{ amount: 100, taxType: 2 }], buyerHasUbn: true }),
    ).toMatchObject({ ZeroTaxSalesAmount: 100, TaxType: 2 });
  });

  it("mixed item tax types ⇒ invoice TaxType 9, with each bucket summed", () => {
    const r = computeAmegoAmounts({
      lines: [
        { amount: 105, taxType: 1 },
        { amount: 50, taxType: 3 },
      ],
      buyerHasUbn: true,
    });
    expect(r.TaxType).toBe(9);
    expect(r.SalesAmount).toBe(100);
    expect(r.TaxAmount).toBe(5);
    expect(r.FreeTaxSalesAmount).toBe(50);
    expect(r.TotalAmount).toBe(155);
  });

  it("maps each unified TaxType to its MIG code", () => {
    expect(amegoTaxType("TAXABLE")).toBe(1);
    expect(amegoTaxType("ZERO_RATED")).toBe(2);
    expect(amegoTaxType("TAX_FREE")).toBe(3);
    expect(amegoTaxType("SPECIAL")).toBe(4);
  });
});
